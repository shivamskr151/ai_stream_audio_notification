class SSEAudioNotifier {
    constructor() {
        this.eventSource = null;
        this.isConnected = false;
        this.totalEvents = 0;
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
        
        this.initializeElements();
        this.bindEvents();
        this.setupAudio();
        // Preload recent events from SQLite without playing audio
        this.loadInitialEvents();
        this.connect(); // Automatically connect on page load
    }

    initializeElements() {
        this.statusIndicator = document.getElementById('status-indicator');
        this.statusText = document.getElementById('status-text');
        // Stop status elements
        this.stopStatus = document.getElementById('stop-status');
        this.stopCountdown = document.getElementById('stop-countdown');
        this.eventsList = document.getElementById('events-list');
        // Stats elements are optional; guard for absence
        this.totalEventsSpan = document.getElementById('total-events') || null;
        this.lastEventTimeSpan = document.getElementById('last-event-time') || null;
        this.audioCountSpan = document.getElementById('audio-count') || null;
        // Global controls
        this.globalVolume = document.getElementById('volume-slider');
        this.volumeDisplay = document.getElementById('volume-display');
        this.notificationAudio = document.getElementById('notification-audio');
        this.compactEventList = document.getElementById('compact-event-list');
        // Toolbar elements
        this.searchInput = document.getElementById('events-search');
        this.toggleFiltersBtn = document.getElementById('toggle-filters');
        this.audioControls = document.querySelector('.audio-controls-inline');
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
        // Pagination state
        this.currentPage = 1;
        this.totalPages = 1;
        this.pageSize = 5; // Fixed page size
        this.currentSearchQuery = ''; // Current search query
        // Initialize pagination UI with default values
        this.updatePaginationUI();
    }

    async loadInitialEvents() {
        try {
            const resp = await fetch('/api/events?limit=' + ((window.__APP_CONFIG__ && Number(window.__APP_CONFIG__.maxEvents)) || 10), { cache: 'no-store' });
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
        // For preloaded events, use the original timestamp from the data
        this.addEventToList(data, false); // false = use original timestamp
        this.addEventToCompactList(data, false); // false = use original timestamp
    }

    bindEvents() {
        // Toolbar
        if (this.searchInput) {
            this.searchInput.addEventListener('input', () => this.applyFilter());
        }
        if (this.toggleFiltersBtn) {
            this.toggleFiltersBtn.addEventListener('click', () => this.toggleFilters());
        }
        // Compact toggle removed
        // Global controls
        if (this.globalVolume) {
            this.globalVolume.addEventListener('input', () => {
                const v = Math.max(0, Math.min(1, Number(this.globalVolume.value) / 100));
                this.notificationAudio.volume = v;
                this.updateVolumeDisplay();
            });
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
    }

    setupAudio() {
        // Set initial volume
        const defaultVolume = (window.__APP_CONFIG__ && Number(window.__APP_CONFIG__.volume)) || 1.0;
        this.notificationAudio.volume = defaultVolume;
        if (this.globalVolume) this.globalVolume.value = String(Math.round(defaultVolume * 100));
        
        // Set initial volume display
        this.updateVolumeDisplay();
        
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
        const volume = typeof options.volume === 'number' ? options.volume : this.notificationAudio.volume;
        this.playNotificationSequence(volume);
    }

    playNotificationSoundWithUrl(audioUrl, options = {}) {
        // Set the audio source to the specific URL
        if (audioUrl) {
            try {
                this.notificationAudio.src = audioUrl;
            } catch (e) {
                console.warn('Failed to set audio source:', e);
            }
        }
        
        // Orchestrate a sequence using provided per-row options
        const volume = typeof options.volume === 'number' ? options.volume : this.notificationAudio.volume;
        this.playNotificationSequence(volume);
    }

    playNotificationSequence(volume) {
        if (this.isStopping) return;

        const onEnded = () => {
            this.notificationAudio.removeEventListener('ended', onEnded);
            if (this.isStopping) {
                this.isAudioPlaying = false; // Reset flag when stopping
                return;
            }
            // Loop continuously instead of playing fixed number of times
            const t = setTimeout(() => this.playNotificationSequence(volume), 150);
            this.pendingTimeouts.push(t);
        };

        // Try to play the audio file first
        if (this.notificationAudio.src && this.notificationAudio.src !== window.location.href) {
            try {
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
                        this.isAudioPlaying = false; // Reset flag on error
                        this.playFallbackAndMaybeRepeat(volume);
                    });
            } catch (error) {
                console.warn('Audio playback error, using fallback:', error);
                this.notificationAudio.removeEventListener('ended', onEnded);
                this.isAudioPlaying = false; // Reset flag on error
                this.playFallbackAndMaybeRepeat(volume);
            }
        } else {
            // Use fallback audio
            this.playFallbackAndMaybeRepeat(volume);
        }
    }

    playFallbackAndMaybeRepeat(volume) {
        if (this.isStopping) {
            this.isAudioPlaying = false; // Reset flag when stopping
            return;
        }
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
            this.notificationAudio.pause();
            this.notificationAudio.currentTime = 0;
            // Remove any pending event listeners
            this.notificationAudio.removeEventListener('ended', () => {});
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
                this.reconnect();
            };

        } catch (error) {
            console.error('Failed to create SSE connection:', error);
            this.updateConnectionStatus('Connection Failed', 'status-disconnected');
        }
    }


    reconnect() {
        if (this.isConnected) {
            // Close existing connection
            if (this.eventSource) {
                this.eventSource.close();
                this.eventSource = null;
            }
            this.isConnected = false;
            this.updateConnectionStatus('Reconnecting...', 'status-disconnected');
            
            const reconnectMs = (window.__APP_CONFIG__ && Number(window.__APP_CONFIG__.reconnectMs)) || 3000;
            setTimeout(() => {
                this.connect();
            }, reconnectMs); // Reconnect after configured ms
        }
    }

    handleEvent(data) {
        // Ignore the initial connection acknowledgement event from server
        if (data && data.type === 'connection') {
            return;
        }
        
        // If we're in a user-initiated stop period, ignore the event
        if (this.isStoppedByUser && this.stopEndTime && Date.now() < this.stopEndTime) {
            console.log('Audio is stopped by user, ignoring event');
            return;
        }
        
        const key = this.getEventKey(data);
        if (this.seenEventKeys.has(key)) {
            return;
        }
        this.totalEvents++;
        this.updateStats();
        // Always use current timestamp for new events (not original timestamp)
        this.addEventToList(data, true);
        this.addEventToCompactList(data, true);
        
        // If event includes an audio_url, prefer playing it; otherwise use default
        const effectiveAudioUrl = (data && (data.audio_url || (data.data && data.data.audio_url))) || '/notification.wav';
        if (effectiveAudioUrl) {
            const url = effectiveAudioUrl;
            try {
                this.notificationAudio.src = url;
            } catch (e) {
                // keep existing source on error
            }
        }
        
        // Autoplay new events - always allow new events to play audio
        this.seenEventKeys.add(key);
        // Stop any existing audio and start new audio
        this.isStopping = false;
        this.pendingTimeouts.forEach(t => clearTimeout(t));
        this.pendingTimeouts = [];
        this.isAudioPlaying = true; // Mark audio as playing
        this.playNotificationSound();
        
        // Update button states for the newly added event
        setTimeout(() => {
            const latestEventRow = this.eventsList.querySelector('.event-row');
            if (latestEventRow) {
                const startBtn = latestEventRow.querySelector('.start-btn');
                const stopBtn = latestEventRow.querySelector('.stop-btn');
                if (startBtn && stopBtn) {
                    startBtn.style.display = 'none';
                    stopBtn.style.display = 'flex';
                }
            }
        }, 100);
    }

    addEventToList(data, useCurrentTime = true) {
        // Remove "no events" message if it exists
        const noEventsRow = this.eventsList.querySelector('.no-events-row');
        if (noEventsRow) {
            noEventsRow.remove();
        }

        const eventRow = document.createElement('tr');
        eventRow.className = 'event-row';
        
        // Use current timestamp when event is triggered, or original timestamp for preloaded events
        let timestamp;
        if (useCurrentTime) {
            timestamp = new Date();
        } else {
            // Use original timestamp from data
            try {
                timestamp = new Date(data.timestamp);
                if (isNaN(timestamp.getTime())) {
                    console.warn('Invalid timestamp received:', data.timestamp);
                    timestamp = new Date(); // Fallback to current time
                }
            } catch (error) {
                console.warn('Error parsing timestamp:', data.timestamp, error);
                timestamp = new Date(); // Fallback to current time
            }
        }
        
        const dateStr = timestamp.toLocaleDateString('en-US', { 
            month: 'short', 
            day: 'numeric', 
            year: 'numeric' 
        });
        const timeStr = timestamp.toLocaleTimeString('en-US', { 
            hour: 'numeric', 
            minute: '2-digit',
            hour12: true 
        });
        
        // Extract common fields with defaults
        const audioUrl = (data.audio_url || (data.data && data.data.audio_url) || '/notification.wav');
        const imageUrl = (data.image_url || (data.data && data.data.image_url) || '/placeholder.svg');
        
        // Use event_type from backend, fallback to media-based category
        let eventCategory = data.event_type || 'Media Event';
        if (!data.event_type) {
            // Fallback: Generate event category based on available media
            if (audioUrl && imageUrl) {
                eventCategory = 'Audio & Image Event';
            } else if (audioUrl) {
                eventCategory = 'Audio Event';
            } else if (imageUrl) {
                eventCategory = 'Image Event';
            }
        }
        
        
        eventRow.innerHTML = `
            <td class="date-time-column">
                <div class="date">${dateStr}</div>
                <div class="time">${timeStr}</div>
            </td>
            <td class="event-category-column">
                <div class="event-category">${eventCategory}</div>
            </td>
            <td class="media-column">
                <div class="media-buttons">
                    ${imageUrl ? `
                        <button class="media-btn image-btn" data-image-url="${imageUrl}">
                            📷 Image
                        </button>
                    ` : ''}
                    ${audioUrl ? `
                        <button class="media-btn video-btn" data-audio-url="${audioUrl}">
                            🎵 Audio
                        </button>
                    ` : ''}
                </div>
            </td>
            <td class="actions-column">
                <div class="action-buttons">
                    <button class="action-btn start-btn" title="Start audio" style="display: none;">
                        ▶ Start
                    </button>
                    <button class="action-btn stop-btn" title="Stop audio">
                        ■ Stop
                    </button>
                </div>
            </td>
        `;

        // Add to the top of the table
        this.eventsList.insertBefore(eventRow, this.eventsList.firstChild);

        // Wire event handlers
        this.wireEventHandlers(eventRow, data);

        // Keep only the last N events
        const events = this.eventsList.querySelectorAll('.event-row');
        const maxEvents = (window.__APP_CONFIG__ && Number(window.__APP_CONFIG__.maxEvents)) || 10;
        if (events.length > maxEvents) {
            events[events.length - 1].remove();
        }

        // Update last event time
        if (this.lastEventTimeSpan) this.lastEventTimeSpan.textContent = timestamp.toLocaleString();
    }

    wireEventHandlers(eventRow, data) {
        // Image button handler
        const imageBtn = eventRow.querySelector('.image-btn');
        if (imageBtn) {
            imageBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                const imageUrl = imageBtn.getAttribute('data-image-url');
                this.showModal(imageUrl);
            });
        }

        // Audio button handler
        const audioBtn = eventRow.querySelector('.video-btn');
        if (audioBtn) {
            audioBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.isStopping = false;
                this.pendingTimeouts.forEach(t => clearTimeout(t));
                this.pendingTimeouts = [];
                this.isAudioPlaying = true;
                // Use the specific audio_url from this event
                const audioUrl = (data.audio_url || (data.data && data.data.audio_url) || '/notification.wav');
                this.playNotificationSoundWithUrl(audioUrl);
            });
        }

        // Start button handler
        const startBtn = eventRow.querySelector('.start-btn');
        if (startBtn) {
            startBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.isStopping = false;
                this.pendingTimeouts.forEach(t => clearTimeout(t));
                this.pendingTimeouts = [];
                this.isAudioPlaying = true;
                // Use the specific audio_url from this event
                const audioUrl = (data.audio_url || (data.data && data.data.audio_url) || '/notification.wav');
                this.playNotificationSoundWithUrl(audioUrl);
                // Hide start button and show stop button
                startBtn.style.display = 'none';
                const stopBtn = eventRow.querySelector('.stop-btn');
                if (stopBtn) stopBtn.style.display = 'flex';
            });
        }

        // Stop button handler
        const stopBtn = eventRow.querySelector('.stop-btn');
        if (stopBtn) {
            stopBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.stopAudio();
                // Hide stop button and show start button
                stopBtn.style.display = 'none';
                const startBtn = eventRow.querySelector('.start-btn');
                if (startBtn) startBtn.style.display = 'flex';
            });
        }
    }

    // Server-side filtering: reload current page with search query
    async applyFilter() {
        if (!this.searchInput) return;
        const searchQuery = this.searchInput.value.trim();
        
        // Store the search query for pagination
        this.currentSearchQuery = searchQuery;
        
        // Reset to page 1 when searching
        this.currentPage = 1;
        
        // Reload the current page with search
        try {
            await this.loadPage(1);
        } catch (error) {
            console.error('Error applying search filter:', error);
        }
    }

    // Clear search input and reset filter
    async clearSearch() {
        if (this.searchInput) {
            this.searchInput.value = '';
            this.currentSearchQuery = '';
            this.currentPage = 1;
            try {
                await this.loadPage(1);
            } catch (error) {
                console.error('Error clearing search:', error);
            }
        }
    }

    // Toggle visibility of audio controls section
    toggleFilters() {
        if (!this.audioControls || !this.toggleFiltersBtn) return;
        const isHidden = this.audioControls.classList.toggle('hidden');
        this.toggleFiltersBtn.setAttribute('aria-expanded', String(!isHidden));
        this.toggleFiltersBtn.setAttribute('title', isHidden ? 'Show filters' : 'Hide filters');
    }

    // Clear events list safely
    clearEvents() {
        if (!this.eventsList) return;
        this.eventsList.innerHTML = '<tr class="no-events-row"><td colspan="4" class="no-events">No events received yet</td></tr>';
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


    addEventToCompactList(data, useCurrentTime = true) {
        if (!this.compactEventList) return;
        const empty = this.compactEventList.querySelector('.empty');
        if (empty) empty.remove();

        const li = document.createElement('li');
        // Use current timestamp when event is triggered, or original timestamp for preloaded events
        let timestamp;
        if (useCurrentTime) {
            timestamp = new Date().toLocaleTimeString();
        } else {
            // Use original timestamp from data
            try {
                const dateObj = new Date(data.timestamp);
                if (isNaN(dateObj.getTime())) {
                    console.warn('Invalid timestamp in compact list:', data.timestamp);
                    timestamp = new Date().toLocaleTimeString();
                } else {
                    timestamp = dateObj.toLocaleTimeString();
                }
            } catch (error) {
                console.warn('Error parsing timestamp in compact list:', data.timestamp, error);
                timestamp = new Date().toLocaleTimeString();
            }
        }
        const audioUrl = (data.audio_url || (data.data && data.data.audio_url) || '/notification.wav');
        const imageUrl = (data.image_url || (data.data && data.data.image_url) || '/placeholder.svg');
        const label = (audioUrl || imageUrl) ? 'media' : (data.event_type || 'event');
        li.innerHTML = `
            <span class="etype">${label}</span>
            <span class="time">${timestamp}</span>
            <div class="row-audio-controls">
                <button class="btn btn-tiny btn-start start-audio-row" title="Start audio" aria-label="Start audio" style="display: none;">▶ Start</button>
                <button class="btn btn-tiny btn-stop stop-audio-row" title="Stop audio" aria-label="Stop audio">■ Stop</button>
            </div>
        `;
        this.compactEventList.insertBefore(li, this.compactEventList.firstChild);

        // keep last N items
        const items = this.compactEventList.querySelectorAll('li');
        const maxCompact = (window.__APP_CONFIG__ && Number(window.__APP_CONFIG__.maxCompactEvents)) || 20;
        if (items.length > maxCompact) {
            items[items.length - 1].remove();
        }

        // Wire per-row start/stop handlers for compact item
        const startBtn2 = li.querySelector('.start-audio-row');
        if (startBtn2) {
            startBtn2.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.isStopping = false;
                this.pendingTimeouts.forEach(t => clearTimeout(t));
                this.pendingTimeouts = [];
                this.isAudioPlaying = true; // Mark audio as playing
                // Use the specific audio_url from this event
                const audioUrl = (data.audio_url || (data.data && data.data.audio_url) || '/notification.wav');
                this.playNotificationSoundWithUrl(audioUrl);
                // Hide start button and show stop button
                startBtn2.style.display = 'none';
                const stopBtn2 = li.querySelector('.stop-audio-row');
                if (stopBtn2) stopBtn2.style.display = 'inline-block';
            });
        }
        const stopBtn2 = li.querySelector('.stop-audio-row');
        if (stopBtn2) {
            stopBtn2.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.stopAudio();
                // Hide stop button and show start button
                stopBtn2.style.display = 'none';
                const startBtn2 = li.querySelector('.start-audio-row');
                if (startBtn2) startBtn2.style.display = 'inline-block';
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

    updateVolumeDisplay() {
        if (!this.volumeDisplay || !this.globalVolume) return;
        
        const volumeValue = Number(this.globalVolume.value);
        if (volumeValue === 100) {
            this.volumeDisplay.textContent = 'Full';
        } else {
            this.volumeDisplay.textContent = String(volumeValue);
        }
    }

    getEventKey(evt) {
        const ts = evt && evt.timestamp ? String(evt.timestamp) : '';
        const a = (evt && (evt.audio_url || (evt.data && evt.data.audio_url))) || '';
        const i = (evt && (evt.image_url || (evt.data && evt.data.image_url))) || '';
        return `${ts}|${a}|${i}`;
    }

    // Pagination: fetch and render a specific page
    async loadPage(pageNumber = 1) {
        const page = Number.isFinite(pageNumber) && pageNumber > 0 ? pageNumber : 1;
        const limit = Number.isFinite(this.pageSize) && this.pageSize > 0 ? this.pageSize : 10;
        
        // Build URL with search query if present
        let url = `/api/events/page?page=${page}&limit=${limit}&_t=${Date.now()}`;
        if (this.currentSearchQuery) {
            url += `&search=${encodeURIComponent(this.currentSearchQuery)}`;
        }
        
        const resp = await fetch(url, { cache: 'no-store' });
        if (!resp.ok) throw new Error('HTTP ' + resp.status);
        const payload = await resp.json();
        const events = Array.isArray(payload.events) ? payload.events : [];
        this.currentPage = Number(payload.page) || page;
        this.totalPages = Number(payload.totalPages) || 1;
        // Replace list contents with the requested page (render newest first as provided)
        if (this.eventsList) {
            this.eventsList.innerHTML = '';
            if (events.length === 0) {
                const noEventsMessage = this.currentSearchQuery 
                    ? `No events found matching "${this.currentSearchQuery}"`
                    : 'No events found';
                this.eventsList.innerHTML = `<tr class="no-events-row"><td colspan="4" class="no-events">${noEventsMessage}</td></tr>`;
            } else {
                // Reverse the array since addEventToList() adds to the top
                for (const evt of events.slice().reverse()) {
                    this.renderEventSilently(evt);
                }
            }
        }
        this.updatePaginationUI();
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
            // Smart pagination with ellipsis - show first 4 pages, ellipsis, last page
            if (currentPage <= 4) {
                // Show pages 2-4, then ellipsis, then last page
                for (let i = 2; i <= 4; i++) {
                    this.createPageButton(i, currentPage, goTo);
                }
                this.createEllipsis();
                this.createPageButton(totalPages, currentPage, goTo);
            } else if (currentPage >= totalPages - 3) {
                // Show first page, ellipsis, then last 4 pages
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
}

// Initialize the application when the DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    const app = new SSEAudioNotifier();
    
    // Initialize pagination immediately to ensure it loads
    if (typeof app.loadPage === 'function') {
        app.loadPage(1).catch((e) => console.warn('Failed to load initial page:', e));
    }
    
    // Add some helpful console messages
    console.log('SSE Audio Notifier initialized');
    console.log('Automatically connecting to SSE to start receiving events');
    console.log('Audio will play automatically when new events arrive');
});
