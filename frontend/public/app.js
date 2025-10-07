class SSEAudioNotifier {
    constructor() {
        this.eventSource = null;
        this.isConnected = false;
        this.totalEvents = 0;
        this.totalCount = 0; // total items for current filter (from API), used for pagination
        this.audioCount = 0;
        this.currentAudio = null;
        this.isStopping = false;
        this.pendingTimeouts = [];
        this.seenEventKeys = new Set();
        this.isAudioPlaying = false; // Track if audio is currently playing
        this.stopTimer = null; // Timer for stop duration
        this.stopEndTime = null; // When the stop period ends
        this.isStoppedByUser = false; // Track if stopped by user (vs automatic stop)
        this.countdownTimer = null; // Timer for countdown display
        this.statusFilter = 'LABELLED'; // Default status filter
        this.reconnectTimeout = null; // Track reconnect timeout to prevent multiple reconnects
        this.lastReconnectAttempt = 0; // Track last reconnect attempt to prevent rapid reconnects
        
        this.initializeElements();
        this.bindEvents();
        this.setupAudio();
        // Preload removed to avoid duplicate API calls; pagination handles initial load
        this.connect(); // Automatically connect on page load
    }

    initializeElements() {
        this.statusIndicator = document.getElementById('status-indicator');
        this.statusText = document.getElementById('status-text');
        // Stop status elements
        this.stopStatus = document.getElementById('stop-status');
        this.stopCountdown = document.getElementById('stop-countdown');
        this.eventsList = document.getElementById('events-grid');
        // Stats elements are optional; guard for absence
        this.totalEventsSpan = document.getElementById('total-events') || null;
        this.lastEventTimeSpan = document.getElementById('last-event-time') || null;
        this.audioCountSpan = document.getElementById('audio-count') || null;
      
        this.compactEventList = document.getElementById('compact-event-list');
        // Toolbar elements
        this.searchInput = document.getElementById('events-search');
        // Compact toggle removed
        // Modal elements
        this.imageModal = document.getElementById('image-modal');
        this.modalImage = document.getElementById('modal-image');
        this.modalClose = document.getElementById('modal-close');
        // Stop duration modal elements
        this.stopDurationModal = document.getElementById('stop-duration-modal');
        this.stopMinutesInput = document.getElementById('stop-minutes');
        this.stopSecondsInput = document.getElementById('stop-seconds');
        this.stopDurationCancel = document.getElementById('stop-duration-cancel');
        this.stopDurationConfirm = document.getElementById('stop-duration-confirm');
        // Pagination elements
        this.pagePrevBtn = document.getElementById('page-prev');
        this.pageNextBtn = document.getElementById('page-next');
        this.pageNumbersContainer = document.getElementById('page-numbers');
        this.pageSizeSelect = document.getElementById('page-size');
        // Pagination state
        this.currentPage = 1;
        this.totalPages = 1;
        // Load preferred page size from localStorage, default to 4
        const savedPageSize = parseInt(localStorage.getItem('pageSize') || '', 8);
        this.pageSize = Number.isFinite(savedPageSize) && savedPageSize > 0 ? savedPageSize : 8;
        // Reflect current page size in the selector if present
        if (this.pageSizeSelect) {
            const valueStr = String(this.pageSize);
            if (Array.from(this.pageSizeSelect.options).some(o => o.value === valueStr)) {
                this.pageSizeSelect.value = valueStr;
            }
        }
        // Initialize pagination UI with default values
        this.updatePaginationUI();
    }

    async loadInitialEvents() {
        try {
            // Build query parameters
            const params = new URLSearchParams();
            params.set('limit', ((window.__APP_CONFIG__ && Number(window.__APP_CONFIG__.maxEvents)) || 8).toString());
            
            // Add status filter if active
            if (this.statusFilter) {
                params.set('status', this.statusFilter);
            }
            
            const resp = await fetch(`/api/events?${params.toString()}`, { cache: 'no-store' });
            if (!resp.ok) throw new Error('HTTP ' + resp.status);
            const payload = await resp.json();
            const events = Array.isArray(payload.events) ? payload.events : [];
            // Render newest to oldest with in-memory dedupe
            // Reverse the array since addEventToList() adds to the top
            for (const evt of events.slice().reverse()) {
                const key = this.getEventKey(evt);
                if (this.seenEventKeys.has(key)) continue;
                this.renderEventSilently(evt);
                this.seenEventKeys.add(key);
            }
        } catch (e) {
            console.warn('Failed to preload events:', e);
        }
    }

    renderEventSilently(data) {
        // Do not increment counters or play audio for preloaded history
        this.addEventToList(data);
        this.addEventToCompactList(data);
    }

    bindEvents() {
        // Toolbar
        if (this.searchInput) {
            this.searchInput.addEventListener('input', () => this.applyFilter());
        }
        
        // Filter buttons
        this.filterLabelledBtn = document.getElementById('filter-labelled');
        this.clearFilterBtn = document.getElementById('clear-filter');
        
        if (this.filterLabelledBtn) {
            this.filterLabelledBtn.addEventListener('click', () => this.filterByLabelled());
        }
        if (this.clearFilterBtn) {
            this.clearFilterBtn.addEventListener('click', () => this.clearStatusFilter());
        }
        // No global Start/Stop; only row-level controls remain

        // Modal
        if (this.modalClose) {
            this.modalClose.addEventListener('click', () => this.hideModal());
        }
        if (this.imageModal) {
            this.imageModal.addEventListener('click', (e) => {
                if (e.target.classList.contains('modal-backdrop')) this.hideModal();
            });
        }

        // Stop duration modal
        if (this.stopDurationCancel) {
            this.stopDurationCancel.addEventListener('click', () => this.hideStopDurationModal());
        }
        if (this.stopDurationConfirm) {
            this.stopDurationConfirm.addEventListener('click', () => this.confirmStopDuration());
        }
        if (this.stopDurationModal) {
            this.stopDurationModal.addEventListener('click', (e) => {
                if (e.target.classList.contains('modal-backdrop')) this.hideStopDurationModal();
            });
        }

        // Pagination controls
        const goTo = (n) => this.loadPage(n).catch((e) => console.warn('Pagination load failed:', e));
        if (this.pagePrevBtn) this.pagePrevBtn.addEventListener('click', () => goTo(Math.max(1, this.currentPage - 1)));
        if (this.pageNextBtn) this.pageNextBtn.addEventListener('click', () => goTo(Math.min(this.totalPages, this.currentPage + 1)));

        // Page size change
        if (this.pageSizeSelect) {
            this.pageSizeSelect.addEventListener('change', () => {
                const nextSize = parseInt(this.pageSizeSelect.value, 10);
                if (Number.isFinite(nextSize) && nextSize > 0) {
                    this.pageSize = nextSize;
                    localStorage.setItem('pageSize', String(nextSize));
                    // Reset to first page and reload with new size
                    this.currentPage = 1;
                    this.loadPage(1).catch((e) => console.warn('Failed to reload with new page size:', e));
                }
            });
        }
    }

    setupAudio() {
        // Set initial volume (guard if no audio element available)
        const defaultVolume = (window.__APP_CONFIG__ && Number(window.__APP_CONFIG__.volume)) || 1.0;
        if (this.notificationAudio) {
            this.notificationAudio.volume = defaultVolume;
        }
        
        // Create a simple notification sound using Web Audio API if no audio file is available
        this.createFallbackAudio();
    }

    createFallbackAudio() {
        // Create a simple beep sound using Web Audio API as fallback
        this.audioContext = null;
        this.gainNode = null;
        this.oscillator = null;
        
        try {
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
            this.gainNode = this.audioContext.createGain();
            this.gainNode.connect(this.audioContext.destination);
        } catch (error) {
            console.warn('Web Audio API not supported:', error);
        }
    }

    playFallbackAudio(volume) {
        if (!this.audioContext || !this.gainNode) return;

        try {
            // Resume audio context if suspended
            if (this.audioContext.state === 'suspended') {
                this.audioContext.resume();
            }

            // Stop any existing oscillator
            if (this.oscillator) {
                this.oscillator.stop();
            }

            // Create new oscillator
            this.oscillator = this.audioContext.createOscillator();
            this.oscillator.type = 'sine';
            this.oscillator.frequency.setValueAtTime(800, this.audioContext.currentTime);
            this.oscillator.frequency.setValueAtTime(600, this.audioContext.currentTime + 0.1);
            this.oscillator.frequency.setValueAtTime(800, this.audioContext.currentTime + 0.2);

            // Set volume
            const vol = Number.isFinite(volume) ? volume : 0.5;
            this.gainNode.gain.setValueAtTime(vol * 0.3, this.audioContext.currentTime);

            // Connect and play
            this.oscillator.connect(this.gainNode);
            this.oscillator.start();
            this.oscillator.stop(this.audioContext.currentTime + 0.3);

            this.audioCount++;
            this.updateStats();
        } catch (error) {
            console.error('Error playing fallback audio:', error);
        }
    }

    playNotificationSound(options = {}) {
        // Orchestrate a sequence using provided per-row options
        const volume = typeof options.volume === 'number' ? options.volume : (this.notificationAudio ? this.notificationAudio.volume : 1.0);
        this.playNotificationSequence(volume);
    }

    playNotificationSequence(volume) {
        if (this.isStopping) return;

        const onEnded = () => {
            this.notificationAudio.removeEventListener('ended', onEnded);
            if (this.isStopping) return;
            // Loop continuously instead of playing fixed number of times
            const t = setTimeout(() => this.playNotificationSequence(volume), 150);
            this.pendingTimeouts.push(t);
        };

        // Try to play the audio file first
        if (this.notificationAudio && this.notificationAudio.src && this.notificationAudio.src !== window.location.href) {
            try {
                if (!this.notificationAudio) throw new Error('No audio element');
                this.notificationAudio.currentTime = 0;
                this.notificationAudio.volume = typeof volume === 'number' ? volume : this.notificationAudio.volume;
                this.notificationAudio.addEventListener('ended', onEnded);
                this.notificationAudio.play()
                    .then(() => {
                        this.audioCount++;
                        this.updateStats();
                    })
                    .catch(error => {
                        console.warn('Audio file playback failed, using fallback:', error);
                        this.notificationAudio.removeEventListener('ended', onEnded);
                        this.playFallbackAndMaybeRepeat(volume);
                    });
            } catch (error) {
                console.warn('Audio playback error, using fallback:', error);
                this.notificationAudio.removeEventListener('ended', onEnded);
                this.playFallbackAndMaybeRepeat(volume);
            }
        } else {
            // Use fallback audio
            this.playFallbackAndMaybeRepeat(volume);
        }
    }

    playFallbackAndMaybeRepeat(volume) {
        if (this.isStopping) return;
        this.playFallbackAudio(volume);
        // Loop continuously instead of playing fixed number of times
        const t = setTimeout(() => this.playNotificationSequence(volume), 400);
        this.pendingTimeouts.push(t);
    }

    stopAudio() {
        // Show stop duration modal instead of immediately stopping
        this.showStopDurationModal();
    }

    stopAudioImmediate() {
        // Stop pending sequence scheduling
        this.isStopping = true;
        this.pendingTimeouts.forEach(t => clearTimeout(t));
        this.pendingTimeouts = [];

        // Stop audio file
        if (this.notificationAudio) {
            try {
                this.notificationAudio.pause();
                this.notificationAudio.currentTime = 0;
                // Remove any pending event listeners
                this.notificationAudio.removeEventListener('ended', () => {});
            } catch (e) {
                // ignore
            }
        }

        // Stop fallback audio
        if (this.oscillator) {
            try {
                this.oscillator.stop();
                this.oscillator = null;
            } catch (error) {
                // Oscillator might already be stopped
            }
        }

        // Allow new events to be processed again
        this.isAudioPlaying = false;

		// Allow future sequences after a brief delay
		setTimeout(() => {
			this.isStopping = false;
		}, 300);
    }

    connect() {
        if (this.isConnected) return;

        try {
            const sseUrl = (window.__APP_CONFIG__ && window.__APP_CONFIG__.sseUrl) || '/events';
            this.eventSource = new EventSource(sseUrl);
            
            this.eventSource.onopen = () => {
                this.isConnected = true;
                this.updateConnectionStatus('Connected', 'status-connected');
                console.log('SSE connection opened');
            };

            this.eventSource.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);
                    // Support single event or an array of events
                    if (Array.isArray(data)) {
                        data.forEach(evt => this.handleEvent(evt));
                    } else {
                        this.handleEvent(data);
                    }
                } catch (error) {
                    console.error('Error parsing SSE data:', error);
                }
            };

            this.eventSource.onerror = (error) => {
                console.error('SSE connection error:', error);
                this.updateConnectionStatus('Connection Error', 'status-disconnected');
                // Prevent rapid reconnection attempts
                const now = Date.now();
                if (now - this.lastReconnectAttempt < 5000) { // Wait at least 5 seconds between attempts
                    console.log('Skipping reconnect - too soon since last attempt');
                    return;
                }
                this.reconnect();
            };

        } catch (error) {
            console.error('Failed to create SSE connection:', error);
            this.updateConnectionStatus('Connection Failed', 'status-disconnected');
        }
    }


    reconnect() {
        // Clear any existing reconnect timeout
        if (this.reconnectTimeout) {
            clearTimeout(this.reconnectTimeout);
            this.reconnectTimeout = null;
        }
        
        if (this.isConnected) {
            // Close existing connection
            if (this.eventSource) {
                this.eventSource.close();
                this.eventSource = null;
            }
            this.isConnected = false;
            this.updateConnectionStatus('Reconnecting...', 'status-disconnected');
            
            const reconnectMs = (window.__APP_CONFIG__ && Number(window.__APP_CONFIG__.reconnectMs)) || 3000;
            this.lastReconnectAttempt = Date.now();
            this.reconnectTimeout = setTimeout(() => {
                this.connect();
            }, reconnectMs); // Reconnect after configured ms
        } else {
            // If not connected, try to connect immediately
            this.lastReconnectAttempt = Date.now();
            this.connect();
        }
    }

    handleEvent(data) {
        // Ignore the initial connection acknowledgement event from server
        if (data && data.type === 'connection') {
            return;
        }
        
        const key = this.getEventKey(data);
        if (this.seenEventKeys.has(key)) {
            return;
        }
        
        this.totalEvents++;
        this.updateStats();
        // Only count towards pagination if item matches active status filter (if any)
        const matchesStatusFilter = !this.statusFilter || (data && data.status === this.statusFilter);

        // Render into lists regardless to maintain real-time view
        this.addEventToList(data);
        this.addEventToCompactList(data);
        this.seenEventKeys.add(key);

        // Keep first page stable: if we're viewing page 1 and have more than pageSize items, trim the tail
        if (this.currentPage === 1 && this.eventsList) {
            const items = this.eventsList.querySelectorAll('.event-item');
            const limit = Number.isFinite(this.pageSize) && this.pageSize > 0 ? this.pageSize : items.length;
            if (items.length > limit) {
                // Remove extras from the bottom until length === limit
                for (let i = items.length - 1; i >= limit; i--) {
                    items[i].remove();
                }
            }
        }

        // Update pagination totals dynamically for matching items
        if (matchesStatusFilter) {
            const nextTotal = (Number.isFinite(this.totalCount) && this.totalCount >= 0) ? (this.totalCount + 1) : this.totalCount;
            if (Number.isFinite(nextTotal)) {
                this.totalCount = nextTotal;
                const size = Number.isFinite(this.pageSize) && this.pageSize > 0 ? this.pageSize : 1;
                this.totalPages = Math.max(1, Math.ceil(this.totalCount / size));
                this.updatePaginationUI();
            }
        }
    }

    addEventToList(data) {
        // Remove "no events" message if it exists
        const noEventsItem = this.eventsList.querySelector('.no-events-item');
        if (noEventsItem) {
            noEventsItem.remove();
        }

        const eventItem = document.createElement('div');
        eventItem.className = 'event-item';
        eventItem.setAttribute('data-event-id', String(data.id ?? ''));
        
        // Extract only the required fields
        const status = data.status || 'Unknown';
        const orgImgLocal = data.org_img || '/placeholder.svg';
        const timestampRaw = this.resolveTimestamp(data);
        const timestampStr = this.formatTimestamp(timestampRaw);
        const subcategoriesRaw = Array.isArray(data?.absolute_bbox)
            ? data.absolute_bbox.map(b => b && b.subcategory).filter(Boolean)
            : [];
        const groupedByCategory = new Map();
        subcategoriesRaw.forEach((value) => {
            const str = String(value);
            const parts = str.split('-', 2);
            const category = parts[0] || str;
            const suffix = parts.length > 1 ? parts[1] : str;
            if (!groupedByCategory.has(category)) {
                groupedByCategory.set(category, { items: [], seenSuffixes: new Set() });
            }
            const group = groupedByCategory.get(category);
            if (group.items.length === 0) {
                group.items.push(str); // first occurrence: full value e.g., PPE-Helmet
                group.seenSuffixes.add(suffix);
            } else if (!group.seenSuffixes.has(suffix)) {
                group.items.push(suffix); // subsequent unique suffix only
                group.seenSuffixes.add(suffix);
            }
        });
        const subcategoriesHtml = Array.from(groupedByCategory.values())
            .map(group => `<div class="event-subcategories-row">${group.items.join(', ')}</div>`)
            .join('');
        
        eventItem.innerHTML = `
            <img src="${orgImgLocal}" alt="Event Image" class="event-image">
            <div class="event-meta">
                <span class="event-timestamp" title="Event time">${timestampStr}</span>
            </div>
            <div class="event-subcategories" title="Detected subcategories">${subcategoriesHtml}</div>
            <div class="event-actions">
                <button class="action-btn approve-btn" data-event-id="${data.id}" title="Approve Event">
                    ✅ APPROVE
                </button>
                <button class="action-btn reject-btn" data-event-id="${data.id}" title="Reject Event">
                    ❌ REJECT
                </button>
            </div>
        `;

        // Add to the top of the grid
        this.eventsList.insertBefore(eventItem, this.eventsList.firstChild);

        // Wire event handlers
        this.wireEventHandlers(eventItem, data);

        // Apply search filter only (status filtering handled by backend)
        this.applyFilter();

        // Keep only the last N events
        const events = this.eventsList.querySelectorAll('.event-item');
        const maxEvents = (window.__APP_CONFIG__ && Number(window.__APP_CONFIG__.maxEvents)) || 10;
        if (events.length > maxEvents) {
            events[events.length - 1].remove();
        }
    }

    wireEventHandlers(eventRow, data) {
        // Image click handler to show in modal
        const eventImage = eventRow.querySelector('.event-image');
        if (eventImage) {
            eventImage.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                const imageUrl = eventImage.src;
                this.showModal(imageUrl);
            });
        }

        // Approve button handler
        const approveBtn = eventRow.querySelector('.approve-btn');
        if (approveBtn) {
            approveBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                const eventId = approveBtn.getAttribute('data-event-id');
                this.updateEventStatus(eventId, 'APPROVED');
            });
        }

        // Reject button handler
        const rejectBtn = eventRow.querySelector('.reject-btn');
        if (rejectBtn) {
            rejectBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                const eventId = rejectBtn.getAttribute('data-event-id');
                this.updateEventStatus(eventId, 'REJECTED');
            });
        }
    }

    // Filtering: hide grid items not matching the search text (status filtering handled by backend)
    applyFilter() {
        if (!this.eventsList) return;
        const q = (this.searchInput && this.searchInput.value || '').toLowerCase().trim();
        const items = this.eventsList.querySelectorAll('.event-item');
        
        if (!q) {
            // Show all items if no search text
            items.forEach(el => el.style.display = '');
            return;
        }
        
        // Apply search filter only
        items.forEach(el => {
            const text = el.textContent.toLowerCase();
            el.style.display = text.includes(q) ? '' : 'none';
        });
    }

    // Clear search input and reset filter
    clearSearch() {
        if (this.searchInput) {
            this.searchInput.value = '';
            this.applyFilter();
        }
    }

    // Filter by LABELLED status
    async filterByLabelled() {
        this.statusFilter = 'LABELLED';
        this.updateFilterButtons();
        // Reload data from backend with status filter
        await this.reloadData();
    }

    // Clear status filter
    async clearStatusFilter() {
        this.statusFilter = null;
        this.updateFilterButtons();
        // Reload data from backend without status filter
        await this.reloadData();
    }

    // Reload data from backend based on current filters
    async reloadData() {
        try {
            // Clear current events
            if (this.eventsList) {
                this.eventsList.innerHTML = '<div class="no-events-item"><div class="no-events">Loading...</div></div>';
            }
            
            // Reset pagination to first page
            this.currentPage = 1;
            
            // Load first page with current filters
            await this.loadPage(1);
        } catch (error) {
            console.error('Failed to reload data:', error);
            if (this.eventsList) {
                this.eventsList.innerHTML = '<tr class="no-events-row"><td colspan="3" class="no-events">Error loading events</td></tr>';
            }
        }
    }

    // Update filter button states
    updateFilterButtons() {
        if (this.filterLabelledBtn && this.clearFilterBtn) {
            if (this.statusFilter === 'LABELLED') {
                this.filterLabelledBtn.style.display = 'none';
                this.clearFilterBtn.style.display = 'inline-block';
            } else {
                this.filterLabelledBtn.style.display = 'inline-block';
                this.clearFilterBtn.style.display = 'none';
            }
        }
    }


    // Clear events list safely
    clearEvents() {
        if (!this.eventsList) return;
        this.eventsList.innerHTML = '<div class="no-events-item"><div class="no-events">No events received yet</div></div>';
    }

    // Compact density toggle removed

    // Modal helpers
    showModal(src) {
        if (!this.imageModal || !this.modalImage) return;
        this.modalImage.src = src;
        this.imageModal.setAttribute('aria-hidden', 'false');
        this.imageModal.classList.add('open');
    }
    hideModal() {
        if (!this.imageModal || !this.modalImage) return;
        this.imageModal.setAttribute('aria-hidden', 'true');
        this.imageModal.classList.remove('open');
        this.modalImage.src = '';
    }

    // Stop duration modal methods
    showStopDurationModal() {
        if (!this.stopDurationModal) return;
        this.stopDurationModal.setAttribute('aria-hidden', 'false');
        this.stopDurationModal.classList.add('open');
        // Focus on minutes input
        if (this.stopMinutesInput) {
            this.stopMinutesInput.focus();
            this.stopMinutesInput.select();
        }
    }

    hideStopDurationModal() {
        if (!this.stopDurationModal) return;
        this.stopDurationModal.setAttribute('aria-hidden', 'true');
        this.stopDurationModal.classList.remove('open');
    }

    confirmStopDuration() {
        const minutes = parseInt(this.stopMinutesInput.value) || 0;
        const seconds = parseInt(this.stopSecondsInput.value) || 0;
        const totalSeconds = minutes * 60 + seconds;
        
        if (totalSeconds <= 0) {
            alert('Please enter a valid duration (at least 1 second)');
            return;
        }

        // Stop audio immediately
        this.stopAudioImmediate();
        
        // Set up stop timer
        this.isStoppedByUser = true;
        this.stopEndTime = Date.now() + (totalSeconds * 1000);
        
        // Clear any existing timer
        if (this.stopTimer) {
            clearTimeout(this.stopTimer);
        }
        
        // Set timer to automatically resume
        this.stopTimer = setTimeout(() => {
            this.resumeAudioAfterStop();
        }, totalSeconds * 1000);
        
        // Start countdown display
        this.startCountdown(totalSeconds);
        
        console.log(`Audio stopped for ${totalSeconds} seconds`);
        this.hideStopDurationModal();
        
        // Update button states
        this.updateAllStopButtons();
    }

    resumeAudioAfterStop() {
        console.log('Stop period ended, resuming audio');
        this.isStoppedByUser = false;
        this.stopEndTime = null;
        this.stopTimer = null;
        
        // Stop countdown timer
        if (this.countdownTimer) {
            clearInterval(this.countdownTimer);
            this.countdownTimer = null;
        }
        
        // Hide stop status
        if (this.stopStatus) {
            this.stopStatus.classList.add('hidden');
        }
        
        // No queue processing needed - events are ignored during stop period
        
        // Update button states
        this.updateAllStopButtons();
    }


    updateAllStopButtons() {
        // Update all stop buttons to show correct state
        const stopButtons = document.querySelectorAll('.stop-btn');
        stopButtons.forEach(btn => {
            if (this.isStoppedByUser) {
                btn.textContent = '⏸';
                btn.title = 'Audio stopped by user';
            } else {
                btn.textContent = '■';
                btn.title = 'Stop audio';
            }
        });
    }

    startCountdown(totalSeconds) {
        // Show stop status
        if (this.stopStatus) {
            this.stopStatus.classList.remove('hidden');
        }
        
        // Clear any existing countdown timer
        if (this.countdownTimer) {
            clearInterval(this.countdownTimer);
        }
        
        // Update countdown every second
        this.countdownTimer = setInterval(() => {
            const now = Date.now();
            const remaining = Math.max(0, this.stopEndTime - now);
            const remainingSeconds = Math.ceil(remaining / 1000);
            
            if (remainingSeconds <= 0) {
                clearInterval(this.countdownTimer);
                this.countdownTimer = null;
                return;
            }
            
            const minutes = Math.floor(remainingSeconds / 60);
            const seconds = remainingSeconds % 60;
            const timeString = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
            
            if (this.stopCountdown) {
                this.stopCountdown.textContent = timeString;
            }
        }, 1000);
        
        // Initial update
        const minutes = Math.floor(totalSeconds / 60);
        const seconds = totalSeconds % 60;
        const timeString = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
        if (this.stopCountdown) {
            this.stopCountdown.textContent = timeString;
        }
    }


    addEventToCompactList(data) {
        if (!this.compactEventList) return;
        const empty = this.compactEventList.querySelector('.empty');
        if (empty) empty.remove();

        const li = document.createElement('li');
        const status = data.status || 'Unknown';
        const orgImgLocal = data.org_img || '/placeholder.svg';
        const timestampRaw = this.resolveTimestamp(data);
        const timestampStr = this.formatTimestamp(timestampRaw);
        li.innerHTML = `
            <span class="status">${status}</span>
            <img src="${orgImgLocal}" alt="Event Image" class="compact-event-image" style="max-width: 50px; max-height: 50px; object-fit: cover; border-radius: 4px;">
            <span class="timestamp" title="Event time" style="font-size: 12px; color: #666; margin-left: 8px;">${timestampStr}</span>
            <div class="compact-actions">
                <button class="btn btn-tiny approve-btn" data-event-id="${data.id}" title="Approve Event">✅</button>
                <button class="btn btn-tiny reject-btn" data-event-id="${data.id}" title="Reject Event">❌</button>
            </div>
        `;
        this.compactEventList.insertBefore(li, this.compactEventList.firstChild);

        // keep last N items
        const items = this.compactEventList.querySelectorAll('li');
        const maxCompact = (window.__APP_CONFIG__ && Number(window.__APP_CONFIG__.maxCompactEvents)) || 20;
        if (items.length > maxCompact) {
            items[items.length - 1].remove();
        }

        // Wire image click handler for compact item
        const compactImage = li.querySelector('.compact-event-image');
        if (compactImage) {
            compactImage.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                const imageUrl = compactImage.src;
                this.showModal(imageUrl);
            });
        }

        // Wire status button handlers for compact item
        const compactApproveBtn = li.querySelector('.approve-btn');
        if (compactApproveBtn) {
            compactApproveBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                const eventId = compactApproveBtn.getAttribute('data-event-id');
                this.updateEventStatus(eventId, 'APPROVED');
            });
        }

        const compactRejectBtn = li.querySelector('.reject-btn');
        if (compactRejectBtn) {
            compactRejectBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                const eventId = compactRejectBtn.getAttribute('data-event-id');
                this.updateEventStatus(eventId, 'REJECTED');
            });
        }
    }

    updateConnectionStatus(text, className) {
        this.statusText.textContent = text;
        this.statusIndicator.className = `status-indicator ${className}`;
    }

    updateStats() {
        if (this.totalEventsSpan) this.totalEventsSpan.textContent = this.totalEvents;
        if (this.audioCountSpan) this.audioCountSpan.textContent = this.audioCount;
    }


    getEventKey(evt) {
        const tsCandidate = (evt && (evt.timestamp || evt.created_at || evt.datetimestamp_trackerid)) || '';
        const ts = String(tsCandidate);
        const status = evt && evt.status ? String(evt.status) : '';
        const orgImgLocal = evt && evt.org_img ? String(evt.org_img) : '';
        return `${ts}|${status}|${orgImgLocal}`;
    }

    // Format timestamps into a readable local date/time string
    formatTimestamp(ts) {
        if (!ts) return '—';
        try {
            const date = new Date(ts);
            if (Number.isNaN(date.getTime())) return '—';
            return date.toLocaleString(undefined, {
                year: 'numeric',
                month: 'short',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit'
            });
        } catch (_) {
            return '—';
        }
    }

    // Resolve a usable timestamp from multiple possible backend fields
    resolveTimestamp(evt) {
        if (!evt) return null;
        if (evt.timestamp) return evt.timestamp;
        if (evt.created_at) return evt.created_at;
        // Some payloads may embed ISO date before a '#'
        if (evt.datetimestamp_trackerid) {
            const raw = String(evt.datetimestamp_trackerid);
            const maybeIso = raw.split('#')[0];
            if (maybeIso) return maybeIso;
        }
        return null;
    }

    async updateEventStatus(eventId, newStatus) {
        try {
            console.log(`Updating event ${eventId} status to ${newStatus}`);
            
            const response = await fetch(`/api/events/${eventId}`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ status: newStatus })
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const updatedEvent = await response.json();
            console.log(`Event ${eventId} status updated to ${newStatus}`, updatedEvent);

            // Update the UI optimistically
            this.updateEventStatusInUI(eventId, newStatus);
            // If current filter would exclude this item now, remove it and backfill
            this.maybeRemoveAndBackfill(eventId, newStatus);

        } catch (error) {
            console.error('Failed to update event status:', error);
            alert(`Failed to update event status: ${error.message}`);
        }
    }

    updateEventStatusInUI(eventId, newStatus) {
        console.log(`Updating UI for event ${eventId} to status ${newStatus}`);
        console.log('eventsList exists:', !!this.eventsList);
        console.log('compactEventList exists:', !!this.compactEventList);
        
        // Update main event list
        if (this.eventsList) {
            const eventItems = this.eventsList.querySelectorAll('.event-item');
            console.log(`Found ${eventItems.length} event items in main list`);
            
            for (const item of eventItems) {
                const approveBtn = item.querySelector('.approve-btn');
                const rejectBtn = item.querySelector('.reject-btn');
                
                if (approveBtn && approveBtn.getAttribute('data-event-id') === eventId) {
                    console.log(`Found matching event item for ${eventId} in main list`);
                    
                    // No badge anymore; just log success
                    console.log(`Updated status for ${eventId} to ${newStatus}`);

                    // Disable both buttons after status change
                    if (approveBtn) {
                        approveBtn.disabled = true;
                        approveBtn.textContent = newStatus === 'APPROVED' ? '✅ APPROVED' : '✅ APPROVE';
                    }
                    if (rejectBtn) {
                        rejectBtn.disabled = true;
                        rejectBtn.textContent = newStatus === 'REJECTED' ? '❌ REJECTED' : '❌ REJECT';
                    }
                    break;
                }
            }
        } else {
            console.warn('eventsList is null, cannot update main list');
        }

        // Update compact event list
        if (this.compactEventList) {
            const compactItems = this.compactEventList.querySelectorAll('li');
            console.log(`Found ${compactItems.length} compact items`);
            
            for (const item of compactItems) {
                const approveBtn = item.querySelector('.approve-btn');
                const rejectBtn = item.querySelector('.reject-btn');
                
                if (approveBtn && approveBtn.getAttribute('data-event-id') === eventId) {
                    console.log(`Found matching event item for ${eventId} in compact list`);
                    
                    // Update the status display
                    const statusSpan = item.querySelector('.status');
                    if (statusSpan) {
                        statusSpan.textContent = newStatus;
                        console.log(`Updated compact status display to ${newStatus}`);
                    }

                    // Disable both buttons after status change
                    if (approveBtn) {
                        approveBtn.disabled = true;
                        approveBtn.textContent = newStatus === 'APPROVED' ? '✅' : '✅';
                    }
                    if (rejectBtn) {
                        rejectBtn.disabled = true;
                        rejectBtn.textContent = newStatus === 'REJECTED' ? '❌' : '❌';
                    }
                    break;
                }
            }
        } else {
            console.warn('compactEventList is null, cannot update compact list');
        }
    }

    // If an item no longer matches the active filter (e.g., filter LABELLED but status becomes APPROVED),
    // remove it from the grid and fetch the next page item to keep the grid full.
    maybeRemoveAndBackfill(eventId, newStatus) {
        const isFiltered = this.statusFilter && typeof this.statusFilter === 'string';
        if (!isFiltered) return;
        // If filter is LABELLED and item is no longer LABELLED, remove it
        if (this.statusFilter === 'LABELLED' && newStatus !== 'LABELLED') {
            const node = this.eventsList && this.eventsList.querySelector(`.event-item[data-event-id="${eventId}"]`);
            if (node) node.remove();
            // If grid has fewer items than pageSize, try to backfill by reloading current page
            const currentCount = this.eventsList ? this.eventsList.querySelectorAll('.event-item').length : 0;
            if (currentCount < this.pageSize) {
                // Reload current page to backfill; keep same page number
                this.loadPage(this.currentPage).catch((e) => console.warn('Backfill failed:', e));
            }
        }
    }

    // Pagination: fetch and render a specific page
    async loadPage(pageNumber = 1) {
        const page = Number.isFinite(pageNumber) && pageNumber > 0 ? pageNumber : 1;
        const limit = Number.isFinite(this.pageSize) && this.pageSize > 0 ? this.pageSize : 4;
        
        // Build query parameters
        const params = new URLSearchParams();
        params.set('page', page.toString());
        // Use pageSize to align with backend pagination semantics
        params.set('pageSize', limit.toString());
        params.set('_t', Date.now().toString());
        
        // Default status filter LABELLED unless explicitly cleared
        if (this.statusFilter) {
            params.set('status', this.statusFilter);
        }
        
        // Use paginated endpoint to receive page metadata (totalPages, etc.)
        const url = `/api/events/page?${params.toString()}`;
        const resp = await fetch(url, { cache: 'no-store' });
        if (!resp.ok) throw new Error('HTTP ' + resp.status);
        const payload = await resp.json();
        const events = Array.isArray(payload.events) ? payload.events : [];
        this.currentPage = Number(payload.page) || page;
        // Update totals from API if provided
        if (Number.isFinite(Number(payload.totalCount))) {
            this.totalCount = Number(payload.totalCount);
        }
        this.totalPages = Number(payload.totalPages) || (Number.isFinite(this.totalCount) && this.pageSize ? Math.max(1, Math.ceil(this.totalCount / this.pageSize)) : (this.totalPages || 1));
        // Replace list contents with the requested page (render newest first as provided)
        if (this.eventsList) {
            this.eventsList.innerHTML = '';
            if (events.length === 0) {
                this.eventsList.innerHTML = '<div class="no-events-item"><div class="no-events">No events found</div></div>';
            } else {
                // Reverse the array since addEventToList() adds to the top
                for (const evt of events.slice().reverse()) {
                    this.renderEventSilently(evt);
                }
                // Ensure the page is capped at pageSize for consistency
                const items = this.eventsList.querySelectorAll('.event-item');
                const limit = Number.isFinite(this.pageSize) && this.pageSize > 0 ? this.pageSize : items.length;
                if (items.length > limit) {
                    for (let i = items.length - 1; i >= limit; i--) {
                        items[i].remove();
                    }
                }
            }
        }
        this.updatePaginationUI();
        // Apply current filter on the new page (for search text only, status is handled by backend)
        this.applyFilter();
    }

    updatePaginationUI() {
        // Update navigation buttons
        const atFirst = this.currentPage <= 1;
        const atLast = this.currentPage >= this.totalPages;
        if (this.pagePrevBtn) this.pagePrevBtn.disabled = atFirst;
        if (this.pageNextBtn) this.pageNextBtn.disabled = atLast;
        
        // Generate page numbers with ellipsis
        this.generatePageNumbers();
    }

    generatePageNumbers() {
        if (!this.pageNumbersContainer) return;
        
        const currentPage = this.currentPage;
        const totalPages = this.totalPages;
        
        // Clear existing page numbers
        this.pageNumbersContainer.innerHTML = '';
        
        if (totalPages <= 1) return;
        
        const goTo = (n) => this.loadPage(n).catch((e) => console.warn('Pagination load failed:', e));
        
        // Always show first page
        this.createPageButton(1, currentPage, goTo);
        
        if (totalPages <= 7) {
            // Show all pages if 7 or fewer
            for (let i = 2; i <= totalPages - 1; i++) {
                this.createPageButton(i, currentPage, goTo);
            }
        } else {
            // Complex pagination with ellipsis
            if (currentPage <= 4) {
                // Show pages 2-4, then ellipsis, then last page
                for (let i = 2; i <= 4; i++) {
                    this.createPageButton(i, currentPage, goTo);
                }
                this.createEllipsis();
                this.createPageButton(totalPages, currentPage, goTo);
            } else if (currentPage >= totalPages - 3) {
                // Show first page, ellipsis, then last 3 pages
                this.createEllipsis();
                for (let i = totalPages - 3; i <= totalPages; i++) {
                    this.createPageButton(i, currentPage, goTo);
                }
            } else {
                // Show first page, ellipsis, current-1, current, current+1, ellipsis, last page
                this.createEllipsis();
                for (let i = currentPage - 1; i <= currentPage + 1; i++) {
                    this.createPageButton(i, currentPage, goTo);
                }
                this.createEllipsis();
                this.createPageButton(totalPages, currentPage, goTo);
            }
        }
    }

    createPageButton(pageNumber, currentPage, onClickHandler) {
        const button = document.createElement('button');
        button.className = 'btn btn-pagination';
        button.textContent = pageNumber;
        button.setAttribute('aria-label', `Go to page ${pageNumber}`);
        
        if (pageNumber === currentPage) {
            button.classList.add('active');
            button.setAttribute('aria-current', 'page');
        }
        
        button.addEventListener('click', () => onClickHandler(pageNumber));
        
        this.pageNumbersContainer.appendChild(button);
    }

    createEllipsis() {
        const ellipsis = document.createElement('div');
        ellipsis.className = 'page-ellipsis';
        ellipsis.textContent = '...';
        ellipsis.setAttribute('aria-hidden', 'true');
        this.pageNumbersContainer.appendChild(ellipsis);
    }

    // Cleanup method to properly close connections
    destroy() {
        if (this.reconnectTimeout) {
            clearTimeout(this.reconnectTimeout);
            this.reconnectTimeout = null;
        }
        
        if (this.eventSource) {
            this.eventSource.close();
            this.eventSource = null;
        }
        
        this.isConnected = false;
    }
}

// Initialize the application when the DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    const app = new SSEAudioNotifier();
    
    // Initialize pagination immediately to ensure it loads
    if (typeof app.loadPage === 'function') {
        app.loadPage(1).catch((e) => console.warn('Failed to load initial page:', e));
    }
    
    
    // Cleanup on page unload
    window.addEventListener('beforeunload', () => {
        app.destroy();
    });
});
