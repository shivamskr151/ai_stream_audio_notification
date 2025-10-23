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
        this.audioContext = null; // Web Audio API context
        this.audioPermissionGranted = false; // Track audio permission status
        this.audioDurationTimer = null; // Timer for duration-based audio stopping
        this.audioSettings = null; // Store audio control settings
        
        this.initializeElements();
        this.bindEvents();
        this.setupAudio();
        this.initializeAudioPermission(); // Initialize audio permission handling
        // Show/hide video streaming section based on configuration
        this.initializeVideoStreaming();
        // Load saved alarm settings from Local Storage
        this.loadAlarmSettings();
        // Preload recent events from SQLite without playing audio
        this.loadInitialEvents();
        this.loadInitialRecentEvents(); // Load initial recent events
        this.connect(); // Automatically connect on page load
    }

    initializeElements() {
        this.statusIndicator = document.getElementById('status-indicator');
        this.statusText = document.getElementById('status-text');
        // Stop status elements
        this.stopStatus = document.getElementById('stop-status');
        this.stopCountdown = document.getElementById('stop-countdown');
        this.eventsList = document.getElementById('events-list');
        
        // WebRTC video streaming section
        this.videoStreamingSection = document.getElementById('video-streaming-section');
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
        
        // Audio Control elements
        this.playModeInfinite = document.getElementById('play-mode-infinite');
        this.playModeCustom = document.getElementById('play-mode-custom');
        this.customDurationGroup = document.getElementById('custom-duration-group');
        this.customDurationMinutes = document.getElementById('custom-duration-minutes');
        this.applyAudioSettingsBtn = document.getElementById('apply-audio-settings');
        this.stopAudioNowBtn = document.getElementById('stop-audio-now');
        this.audioControlStatus = document.getElementById('audio-control-status');
        this.countdownTimer = document.getElementById('countdown-timer');
        this.timerDisplay = document.getElementById('timer-display');
        
        // Stop Alarm Until elements
        // this.stopAlarmEnabled = document.getElementById('stop-alarm-enabled');
        // this.stopAlarmDatetimeFields = document.getElementById('stop-alarm-datetime-fields');
        // this.stopFromDate = document.getElementById('stop-from-date');
        // this.stopFromTime = document.getElementById('stop-from-time');
        // this.stopToDate = document.getElementById('stop-to-date');
        // this.stopToTime = document.getElementById('stop-to-time');
        
        // Recent Events elements
        this.recentEventsList = document.getElementById('recent-events-list');
        // Pagination state
        this.currentPage = 1;
        this.totalPages = 1;
        this.pageSize = (window.__APP_CONFIG__ && Number(window.__APP_CONFIG__.maxEvents)) || 5; // Use MAX_EVENTS as page size
        this.currentSearchQuery = ''; // Current search query
        this.realTimeTotalEvents = 0; // Track total events from SSE
        this.eventsPerPage = new Map(); // Track events per page for real-time updates
        this.isRealTimeMode = true; // Flag to indicate if we're in real-time mode
        this.realTimeEvents = []; // Store real-time events for pagination
        // Initialize pagination UI with default values
        this.updatePaginationUI();
    }

    async loadInitialEvents() {
        try {
            // Use MAX_EVENTS from configuration, fallback to 5 if not set
            const maxEvents = (window.__APP_CONFIG__ && Number(window.__APP_CONFIG__.maxEvents)) || 5;
            const resp = await fetch(`/api/events?limit=${maxEvents}`, { cache: 'no-store' });
            if (!resp.ok) throw new Error('HTTP ' + resp.status);
            const payload = await resp.json();
            const events = Array.isArray(payload.events) ? payload.events : [];
            
            // Update real-time total events count
            this.realTimeTotalEvents = events.length;
            
            // Render newest to oldest with in-memory dedupe
            // Reverse the array since addEventToList() adds to the top
            for (const evt of events.slice().reverse()) {
                const key = this.getEventKey(evt);
                if (this.seenEventKeys.has(key)) continue;
                this.renderEventSilently(evt);
                this.seenEventKeys.add(key);
                
                // Store in real-time events array for pagination
                this.realTimeEvents.unshift(evt);
            }
            
            // Update pagination after loading initial events
            this.updatePaginationForNewEvent();
        } catch (e) {
            console.warn('Failed to preload events:', e);
        }
    }

    async loadInitialRecentEvents() {
        try {
            // Load only the single most recent event for the recent events panel
            const resp = await fetch(`/api/events?limit=1`, { cache: 'no-store' });
            if (!resp.ok) throw new Error('HTTP ' + resp.status);
            const payload = await resp.json();
            const events = Array.isArray(payload.events) ? payload.events : [];
            
            // Clear the recent events list first
            if (this.recentEventsList) {
                this.recentEventsList.innerHTML = '';
            }
            
            // Add only the most recent event if it exists
            if (events.length > 0) {
                this.addToRecentEvents(events[0]);
            }
        } catch (e) {
            console.warn('Failed to preload recent events:', e);
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
        
        // Audio Control event bindings
        if (this.playModeInfinite) {
            this.playModeInfinite.addEventListener('change', () => this.handlePlayModeChange());
        }
        if (this.playModeCustom) {
            this.playModeCustom.addEventListener('change', () => this.handlePlayModeChange());
        }
        if (this.customDurationMinutes) {
            this.customDurationMinutes.addEventListener('input', () => this.saveAlarmSettings());
        }
        // Stop Alarm Until event listeners
        // if (this.stopAlarmEnabled) {
        //     this.stopAlarmEnabled.addEventListener('change', () => this.handleStopAlarmToggle());
        // }
        // if (this.stopFromDate) {
        //     this.stopFromDate.addEventListener('change', () => this.handleStopAlarmChange());
        // }
        // if (this.stopFromTime) {
        //     this.stopFromTime.addEventListener('change', () => this.handleStopAlarmChange());
        // }
        // if (this.stopToDate) {
        //     this.stopToDate.addEventListener('change', () => this.handleStopAlarmChange());
        // }
        // if (this.stopToTime) {
        //     this.stopToTime.addEventListener('change', () => this.handleStopAlarmChange());
        // }
        if (this.applyAudioSettingsBtn) {
            this.applyAudioSettingsBtn.addEventListener('click', () => this.applyAudioSettings());
        }
        if (this.stopAudioNowBtn) {
            this.stopAudioNowBtn.addEventListener('click', () => this.stopAudioNow());
        }
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

    initializeAudioPermission() {
        // Initialize audio context and handle permission
        try {
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
            console.log('Audio context created, state:', this.audioContext.state);
            
            // Check if audio context is suspended (requires user interaction)
            if (this.audioContext.state === 'suspended') {
                console.log('Audio context is suspended - user interaction required');
                this.audioPermissionGranted = false;
                this.showAudioPermissionPrompt();
            } else {
                this.audioPermissionGranted = true;
                console.log('Audio context is ready');
            }
            
            // Set up fallback audio
            this.gainNode = this.audioContext.createGain();
            this.gainNode.connect(this.audioContext.destination);
            
        } catch (error) {
            console.warn('Web Audio API not supported:', error);
            this.audioPermissionGranted = false;
        }
    }

    showAudioPermissionPrompt() {
        // Create a visual prompt for audio permission
        const prompt = document.createElement('div');
        prompt.id = 'audio-permission-prompt';
        prompt.className = 'audio-permission-prompt';
        prompt.innerHTML = `
            <div class="permission-content">
                <button class="btn btn-close" id="close-audio-prompt" aria-label="Close modal">✕</button>
                <h3>🔊 Audio Permission Required</h3>
                <p>Click the button below to enable audio notifications</p>
                <button class="btn btn-primary" id="enable-audio-btn">Enable Audio</button>
            </div>
        `;
        
        document.body.appendChild(prompt);
        
        // Add click handler to enable audio
        const enableBtn = document.getElementById('enable-audio-btn');
        enableBtn.addEventListener('click', () => this.requestAudioPermission());
        
        // Add click handler to close modal
        const closeBtn = document.getElementById('close-audio-prompt');
        closeBtn.addEventListener('click', () => this.hideAudioPermissionPrompt());
    }

    async requestAudioPermission() {
        if (!this.audioContext) return;
        
        try {
            await this.audioContext.resume();
            console.log('Audio context resumed, state:', this.audioContext.state);
            
            if (this.audioContext.state === 'running') {
                this.audioPermissionGranted = true;
                this.hideAudioPermissionPrompt();
                console.log('Audio permission granted - notifications will play automatically');
            }
        } catch (error) {
            console.error('Failed to resume audio context:', error);
        }
    }

    hideAudioPermissionPrompt() {
        const prompt = document.getElementById('audio-permission-prompt');
        if (prompt) {
            prompt.remove();
        }
    }

    createFallbackAudio() {
        // This method is now handled by initializeAudioPermission()
        // Keep for backward compatibility but functionality moved
    }

    initializeVideoStreaming() {
        // Always show video streaming section since it now contains Audio Control and Recent Events
        if (this.videoStreamingSection) {
            this.videoStreamingSection.style.display = 'block';
            console.log('Video streaming section enabled (contains Audio Control and Recent Events)');
        }
    }

    playFallbackAudio(volume) {
        if (!this.audioContext || !this.gainNode) return;

        // Only play if audio permission is granted
        if (!this.audioPermissionGranted) {
            return;
        }

        try {
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

        // Only play if audio permission is granted
        if (!this.audioPermissionGranted) {
            return;
        }

        const onEnded = () => {
            this.notificationAudio.removeEventListener('ended', onEnded);
            if (this.isStopping) {
                this.isAudioPlaying = false; // Reset flag when stopping
                return;
            }
            
            // Check if we should stop after this event ends
            if (this.audioSettings && this.audioSettings.stopCondition === 'event-end') {
                console.log('Event ended, stopping audio as configured');
                this.stopAudioImmediate();
                this.showAudioStatus('Audio stopped - event ended', 'warning');
                return;
            }
            
            // Check if duration-based stopping is active and should continue looping
            if (this.audioSettings && this.audioSettings.stopCondition === 'duration') {
                // For duration-based stopping, we let the timer handle the stopping
                // Continue looping until the timer expires
                const t = setTimeout(() => this.playNotificationSequence(volume), 150);
                this.pendingTimeouts.push(t);
                return;
            }
            
            // For manual stop condition, continue looping indefinitely
            if (this.audioSettings && this.audioSettings.stopCondition === 'manual') {
                const t = setTimeout(() => this.playNotificationSequence(volume), 150);
                this.pendingTimeouts.push(t);
                return;
            }
            
            // Default behavior: Loop continuously
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
                        // Start duration timer if configured and not already set
                        this.startDurationTimerIfNeeded();
                    })
                    .catch(error => {
                        console.warn('Audio file playback failed:', error);
                        this.notificationAudio.removeEventListener('ended', onEnded);
                        this.isAudioPlaying = false; // Reset flag on error
                    });
            } catch (error) {
                console.warn('Audio playback error:', error);
                this.notificationAudio.removeEventListener('ended', onEnded);
                this.isAudioPlaying = false; // Reset flag on error
            }
        } else {
            // Use fallback audio
            this.playFallbackAndMaybeRepeat(volume);
            // Start duration timer if configured and not already set
            this.startDurationTimerIfNeeded();
        }
    }

    playFallbackAndMaybeRepeat(volume) {
        if (this.isStopping) {
            this.isAudioPlaying = false; // Reset flag when stopping
            return;
        }
        
        // Only play if audio permission is granted
        if (!this.audioPermissionGranted) {
            return;
        }
        
        this.playFallbackAudio(volume);
        
        // Check if we should stop after this event ends
        if (this.audioSettings && this.audioSettings.stopCondition === 'event-end') {
            console.log('Fallback audio event ended, stopping audio as configured');
            this.stopAudioImmediate();
            this.showAudioStatus('Audio stopped - event ended', 'warning');
            return;
        }
        
        // For duration-based stopping, continue looping until timer expires
        if (this.audioSettings && this.audioSettings.stopCondition === 'duration') {
            const t = setTimeout(() => this.playNotificationSequence(volume), 400);
            this.pendingTimeouts.push(t);
            return;
        }
        
        // For manual stop condition, continue looping indefinitely
        if (this.audioSettings && this.audioSettings.stopCondition === 'manual') {
            const t = setTimeout(() => this.playNotificationSequence(volume), 400);
            this.pendingTimeouts.push(t);
            return;
        }
        
        // Default behavior: Loop continuously
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

        // Clear audio duration timer
        if (this.audioDurationTimer) {
            clearTimeout(this.audioDurationTimer);
            this.audioDurationTimer = null;
        }

        // Hide countdown timer
        this.hideCountdownTimer();

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

        // Reset all audio button states
        const audioButtons = document.querySelectorAll('.video-btn[data-playing="true"]');
        audioButtons.forEach(btn => {
            btn.setAttribute('data-playing', 'false');
            btn.innerHTML = '🎵 Audio';
            btn.title = 'Start audio';
        });


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
        
        // If we're in a scheduled stop alarm period, ignore the event
        // if (this.isInStopAlarmPeriod()) {
        //     console.log('Audio is stopped by schedule, ignoring event');
        //     return;
        // }
        
        const key = this.getEventKey(data);
        if (this.seenEventKeys.has(key)) {
            return;
        }
        this.totalEvents++;
        this.realTimeTotalEvents++; // Track real-time total
        
        // Store event data for pagination
        this.realTimeEvents.unshift(data); // Add to beginning (newest first)
        
        // Limit stored events to prevent memory issues (keep last 1000 events)
        if (this.realTimeEvents.length > 1000) {
            this.realTimeEvents = this.realTimeEvents.slice(0, 1000);
        }
        
        this.updateStats();
        
        // Update pagination based on new event
        this.updatePaginationForNewEvent();
        
        // Always use current timestamp for new events (not original timestamp)
        // Only add to DOM if we're on page 1 in real-time mode
        if (this.isRealTimeMode && this.currentPage === 1) {
            this.addEventToList(data, true);
        }
        this.addEventToCompactList(data, true);
        
        // Add to recent events list
        this.addToRecentEvents(data);
        
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
        
        // Apply audio settings BEFORE starting audio
        this.applySettingsToCurrentAudio();
        
        // Start audio playback
        this.playNotificationSound();
        
        // Update button states for the newly added event
        setTimeout(() => {
            const latestEventRow = this.eventsList.querySelector('.event-row');
            if (latestEventRow) {
                const audioBtn = latestEventRow.querySelector('.video-btn');
                
                // Update audio button state to show it's playing
                if (audioBtn) {
                    audioBtn.setAttribute('data-playing', 'true');
                    audioBtn.innerHTML = '⏸ Audio';
                    audioBtn.title = 'Stop audio';
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
            second: '2-digit',
            hour12: true 
        });
        
        // Extract common fields with defaults
        const audioUrl = (data.audio_url || (data.data && data.data.audio_url) || '/notification.wav');
        const imageUrl = (data.image_url || (data.data && data.data.image_url) || data.imageUrl || (data.data && data.data.imageUrl) || null);
        
        // Validate image URL - only show if it's a real URL and not empty
        const isValidImageUrl = imageUrl && imageUrl !== '/placeholder.svg' && imageUrl !== '' && imageUrl !== null && imageUrl !== undefined;
        
        // Debug logging for image URL (can be removed in production)
        // console.log('Event data:', data);
        // console.log('Extracted imageUrl:', imageUrl);
        // console.log('Image URL exists:', !!imageUrl);
        
        // Use event_type from backend, fallback to media-based category
        let eventCategory = data.event_type || 'Media Event';
        if (!data.event_type) {
            // Fallback: Generate event category based on available media
            if (audioUrl && isValidImageUrl) {
                eventCategory = 'Audio & Image Event';
            } else if (audioUrl) {
                eventCategory = 'Audio Event';
            } else if (isValidImageUrl) {
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
                    ${isValidImageUrl ? `
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
        `;

        // Add to the top of the table
        this.eventsList.insertBefore(eventRow, this.eventsList.firstChild);

        // Wire event handlers
        this.wireEventHandlers(eventRow, data);

        // Keep only the last N events
        const events = this.eventsList.querySelectorAll('.event-row');
        const maxEvents = (window.__APP_CONFIG__ && Number(window.__APP_CONFIG__.maxEvents)) || 5;
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

        // Audio button handler - now toggles between play and stop
        const audioBtn = eventRow.querySelector('.video-btn');
        if (audioBtn) {
            // Add data attribute to track state
            audioBtn.setAttribute('data-playing', 'false');
            
            audioBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                
                const isCurrentlyPlaying = audioBtn.getAttribute('data-playing') === 'true';
                
                if (isCurrentlyPlaying) {
                    // Stop audio
                    this.stopAudioImmediate();
                    audioBtn.setAttribute('data-playing', 'false');
                    audioBtn.innerHTML = '🎵 Audio';
                    audioBtn.title = 'Start audio';
                } else {
                    // Start audio
                    this.isStopping = false;
                    this.pendingTimeouts.forEach(t => clearTimeout(t));
                    this.pendingTimeouts = [];
                    this.isAudioPlaying = true;
                    // Use the specific audio_url from this event
                    const audioUrl = (data.audio_url || (data.data && data.data.audio_url) || '/notification.wav');
                    // Apply audio settings BEFORE starting audio
                    this.applySettingsToCurrentAudio();
                    this.playNotificationSoundWithUrl(audioUrl);
                    audioBtn.setAttribute('data-playing', 'true');
                    audioBtn.innerHTML = '⏸ Audio';
                    audioBtn.title = 'Stop audio';
                }
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
        
        // If search query is empty, return to real-time mode
        if (!searchQuery) {
            this.isRealTimeMode = true;
            // Reload page 1 to show real-time events
            this.loadRealTimePage(1);
            return;
        }
        
        // Reload the current page with search (switches to API mode)
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
            this.isRealTimeMode = true; // Return to real-time mode
            try {
                this.loadRealTimePage(1);
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
        this.eventsList.innerHTML = '<tr class="no-events-row"><td colspan="3" class="no-events">No events received yet</td></tr>';
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
            timestamp = new Date().toLocaleTimeString('en-US', { 
                hour: 'numeric', 
                minute: '2-digit',
                second: '2-digit',
                hour12: true 
            });
        } else {
            // Use original timestamp from data
            try {
                const dateObj = new Date(data.timestamp);
                if (isNaN(dateObj.getTime())) {
                    console.warn('Invalid timestamp in compact list:', data.timestamp);
                    timestamp = new Date().toLocaleTimeString('en-US', { 
                        hour: 'numeric', 
                        minute: '2-digit',
                        second: '2-digit',
                        hour12: true 
                    });
                } else {
                    timestamp = dateObj.toLocaleTimeString('en-US', { 
                        hour: 'numeric', 
                        minute: '2-digit',
                        second: '2-digit',
                        hour12: true 
                    });
                }
            } catch (error) {
                console.warn('Error parsing timestamp in compact list:', data.timestamp, error);
                timestamp = new Date().toLocaleTimeString('en-US', { 
                    hour: 'numeric', 
                    minute: '2-digit',
                    second: '2-digit',
                    hour12: true 
                });
            }
        }
        const audioUrl = (data.audio_url || (data.data && data.data.audio_url) || '/notification.wav');
        const imageUrl = (data.image_url || (data.data && data.data.image_url) || data.imageUrl || (data.data && data.data.imageUrl) || null);
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
                // Apply audio settings BEFORE starting audio
                this.applySettingsToCurrentAudio();
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

    updatePaginationForNewEvent() {
        if (!this.isRealTimeMode) return;
        
        // Calculate new total pages based on real-time event count
        const newTotalPages = Math.max(1, Math.ceil(this.realTimeTotalEvents / this.pageSize));
        
        // Always update total pages and pagination UI for real-time mode
        this.totalPages = newTotalPages;
        
        // If current page is beyond new total, go to last page
        if (this.currentPage > this.totalPages) {
            this.currentPage = this.totalPages;
        }
        
        // Always update pagination UI to ensure buttons are in correct state
        this.updatePaginationUI();
        
        // Update events per page tracking
        this.updateEventsPerPageTracking();
    }

    updateEventsPerPageTracking() {
        if (!this.isRealTimeMode) return;
        
        // Count events currently displayed on each page
        const events = this.eventsList.querySelectorAll('.event-row');
        const currentPageEvents = events.length;
        
        // Update the map with current page event count
        this.eventsPerPage.set(this.currentPage, currentPageEvents);
        
        // If we're on page 1 and have more events than page size, remove excess
        if (this.currentPage === 1 && currentPageEvents > this.pageSize) {
            // Keep only the most recent events (page size limit)
            const eventsToRemove = Array.from(events).slice(this.pageSize);
            eventsToRemove.forEach(event => event.remove());
        }
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
        const i = (evt && (evt.image_url || (evt.data && evt.data.image_url) || evt.imageUrl || (evt.data && evt.data.imageUrl))) || '';
        return `${ts}|${a}|${i}`;
    }

    // Pagination: fetch and render a specific page
    async loadPage(pageNumber = 1) {
        const page = Number.isFinite(pageNumber) && pageNumber > 0 ? pageNumber : 1;
        const limit = Number.isFinite(this.pageSize) && this.pageSize > 0 ? this.pageSize : 10;
        
        // If in real-time mode and no search query, handle pagination differently
        if (this.isRealTimeMode && !this.currentSearchQuery) {
            this.loadRealTimePage(page);
            return;
        }
        
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
        
        // Switch to API mode when loading specific pages
        this.isRealTimeMode = false;
        
        // Replace list contents with the requested page (render newest first as provided)
        if (this.eventsList) {
            this.eventsList.innerHTML = '';
            if (events.length === 0) {
                const noEventsMessage = this.currentSearchQuery 
                    ? `No events found matching "${this.currentSearchQuery}"`
                    : 'No events found';
                this.eventsList.innerHTML = `<tr class="no-events-row"><td colspan="3" class="no-events">${noEventsMessage}</td></tr>`;
            } else {
                // Reverse the array since addEventToList() adds to the top
                for (const evt of events.slice().reverse()) {
                    this.renderEventSilently(evt);
                }
            }
        }
        this.updatePaginationUI();
    }

    loadRealTimePage(pageNumber) {
        this.currentPage = pageNumber;
        
        // Clear current events
        if (this.eventsList) {
            this.eventsList.innerHTML = '';
            
            if (this.realTimeTotalEvents === 0) {
                this.eventsList.innerHTML = '<tr class="no-events-row"><td colspan="3" class="no-events">No events received yet</td></tr>';
            } else {
                // Calculate the slice of events for this page
                const startIndex = (pageNumber - 1) * this.pageSize;
                const endIndex = startIndex + this.pageSize;
                const pageEvents = this.realTimeEvents.slice(startIndex, endIndex);
                
                if (pageEvents.length === 0) {
                    this.eventsList.innerHTML = '<tr class="no-events-row"><td colspan="3" class="no-events">No events on this page</td></tr>';
                } else {
                    // Render events for this page
                    pageEvents.forEach(eventData => {
                        this.renderEventSilently(eventData);
                    });
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
        
        // Debug logging
        console.log(`Pagination UI Update: currentPage=${this.currentPage}, totalPages=${this.totalPages}, atLast=${atLast}, realTimeTotalEvents=${this.realTimeTotalEvents}, pageSize=${this.pageSize}`);
        
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
            for (let i = 2; i <= totalPages; i++) {
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

    // Audio Control Methods
    handlePlayModeChange() {
        const infiniteChecked = this.playModeInfinite.checked;
        const customChecked = this.playModeCustom.checked;
        
        // Ensure only one checkbox is selected at a time
        if (infiniteChecked && customChecked) {
            // If both are checked, uncheck the one that wasn't just clicked
            if (event.target === this.playModeInfinite) {
                this.playModeCustom.checked = false;
            } else {
                this.playModeInfinite.checked = false;
            }
        }
        
        // Show/hide custom duration input based on custom event selection
        if (this.playModeCustom.checked) {
            this.customDurationGroup.style.display = 'block';
        } else {
            this.customDurationGroup.style.display = 'none';
        }
        
        // Save UI state to Local Storage (without applying audio settings)
        this.saveAlarmSettings();
    }
    
    applyAudioSettings() {
        const infiniteChecked = this.playModeInfinite.checked;
        const customChecked = this.playModeCustom.checked;
        
        // Only validate play mode if either checkbox is checked
        if (infiniteChecked || customChecked) {
            let totalSeconds = 0;
            let stopCondition = 'manual';
            let playMode = 'infinite';
            
            if (customChecked) {
                const minutes = parseInt(this.customDurationMinutes.value) || 0;
                totalSeconds = minutes * 60;
                
                if (totalSeconds <= 0) {
                    alert('Please enter a valid duration (at least 1 minute) for custom event');
                    return;
                }
                stopCondition = 'duration';
                playMode = 'custom-event';
            } else if (infiniteChecked) {
                stopCondition = 'manual';
                playMode = 'infinite';
            }
            
            // Store the settings for use in audio playback
            this.audioSettings = {
                duration: totalSeconds,
                stopCondition: stopCondition,
                playMode: playMode,
                minutes: playMode === 'custom-event' ? parseInt(this.customDurationMinutes.value) || 0 : 0
            };
            
            console.log('Audio settings applied:', this.audioSettings);
            
            // Show countdown timer if custom event is selected
            if (playMode === 'custom-event' && totalSeconds > 0) {
                this.showCountdownTimer(totalSeconds);
            } else {
                this.hideCountdownTimer();
            }
            
            // Apply the settings to current audio if playing
            if (this.isAudioPlaying) {
                this.applySettingsToCurrentAudio();
            } else {
                // If audio is not playing, just show the settings feedback
                this.showAudioSettingsFeedback();
            }
        } else {
            // If no play mode is selected, clear any existing audio settings to prevent interference
            console.log('No play mode selected, clearing audio settings to prevent interference');
            this.audioSettings = null;
            this.showAudioStatus('Stop alarm settings saved', 'success');
        }
        
        // Always save settings to Local Storage
        this.saveAlarmSettings();
    }
    
    applySettingsToCurrentAudio() {
        if (!this.audioSettings) return;
        
        const { duration, stopCondition } = this.audioSettings;
        
        // Clear any existing duration timer
        if (this.audioDurationTimer) {
            clearTimeout(this.audioDurationTimer);
            this.audioDurationTimer = null;
        }
        
        // Apply duration-based stopping if configured
        if (stopCondition === 'duration' && duration > 0) {
            // Only set timer if audio is currently playing
            if (this.isAudioPlaying && !this.isStopping) {
                this.startDurationTimer(duration);
            } else {
                console.log('Duration timer will be set when audio starts');
                this.showAudioStatus(`Duration set: ${duration} seconds`, 'success');
            }
        }
        
        // For event-end condition, we'll handle this in the event handling logic
        if (stopCondition === 'event-end') {
            console.log('Audio will stop when current event ends');
            this.showAudioStatus('Audio will stop when event ends', 'success');
        }
        
        // For manual stop condition
        if (stopCondition === 'manual') {
            this.showAudioStatus('Audio will continue until manually stopped', 'success');
        }
    }
    
    startDurationTimerIfNeeded() {
        console.log('startDurationTimerIfNeeded called:', {
            audioSettings: this.audioSettings,
            stopCondition: this.audioSettings ? this.audioSettings.stopCondition : 'none',
            duration: this.audioSettings ? this.audioSettings.duration : 'none'
        });
        
        if (!this.audioSettings || this.audioSettings.stopCondition !== 'duration') {
            console.log('No duration timer needed - audioSettings:', this.audioSettings);
            return;
        }
        if (this.audioDurationTimer) {
            console.log('Duration timer already set, skipping');
            return; // Timer already set
        }
        
        const { duration } = this.audioSettings;
        if (duration > 0) {
            console.log('Starting duration timer for:', duration, 'seconds');
            this.startDurationTimer(duration);
        }
    }
    
    startDurationTimer(duration) {
        this.audioDurationTimer = setTimeout(() => {
            console.log('Audio duration reached, stopping audio');
            this.stopAudioImmediate();
            this.audioDurationTimer = null;
            this.showAudioStatus('Audio stopped after duration reached', 'warning');
        }, duration * 1000);
        
        console.log(`Audio will stop automatically after ${duration} seconds`);
        this.showAudioStatus(`Audio will stop in ${duration} seconds`, 'success');
    }
    
    showAudioSettingsFeedback() {
        const btn = this.applyAudioSettingsBtn;
        const originalText = btn.textContent;
        btn.textContent = 'Settings Applied!';
        btn.style.background = '#27ae60';
        
        // Show status message
        this.showAudioStatus('Settings applied successfully!', 'success');
        
        setTimeout(() => {
            btn.textContent = originalText;
            btn.style.background = '';
        }, 2000);
    }
    
    showAudioStatus(message, type = 'success') {
        if (!this.audioControlStatus) return;
        
        this.audioControlStatus.textContent = message;
        this.audioControlStatus.className = `audio-control-status ${type} show`;
        
        // Auto-hide after 3 seconds
        setTimeout(() => {
            this.audioControlStatus.classList.remove('show');
        }, 3000);
    }
    
    showCountdownTimer(totalSeconds, isRestoring = false) {
        if (!this.countdownTimer || !this.timerDisplay) return;
        
        this.countdownTimer.style.display = 'block';
        
        // If not restoring, set new end time
        if (!isRestoring) {
            this.countdownEndTime = Date.now() + (totalSeconds * 1000);
        }
        
        // Clear any existing countdown timer
        if (this.countdownInterval) {
            clearInterval(this.countdownInterval);
        }
        
        // Update countdown every second
        this.countdownInterval = setInterval(() => {
            const now = Date.now();
            const remaining = Math.max(0, this.countdownEndTime - now);
            const remainingSeconds = Math.ceil(remaining / 1000);
            
            if (remainingSeconds <= 0) {
                this.hideCountdownTimer();
                return;
            }
            
            const minutes = Math.floor(remainingSeconds / 60);
            const seconds = remainingSeconds % 60;
            const timeString = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
            
            this.timerDisplay.textContent = timeString;
            
            // Save countdown state every 5 seconds to ensure persistence
            if (remainingSeconds % 5 === 0) {
                this.saveAlarmSettings();
            }
        }, 1000);
        
        // Initial update
        const minutes = Math.floor(totalSeconds / 60);
        const seconds = totalSeconds % 60;
        const timeString = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
        this.timerDisplay.textContent = timeString;
    }
    
    hideCountdownTimer() {
        if (!this.countdownTimer) return;
        
        this.countdownTimer.style.display = 'none';
        
        if (this.countdownInterval) {
            clearInterval(this.countdownInterval);
            this.countdownInterval = null;
        }
        
        this.countdownEndTime = null;
    }
    
    // Stop Alarm Until Methods
    // handleStopAlarmToggle() {
    //     const isEnabled = this.stopAlarmEnabled.checked;
    //     
    //     if (isEnabled) {
    //         this.stopAlarmDatetimeFields.style.display = 'block';
    //         console.log('Stop alarm enabled - showing datetime fields');
    //     } else {
    //         this.stopAlarmDatetimeFields.style.display = 'none';
    //         console.log('Stop alarm disabled - hiding datetime fields');
    //         
    //         // Clear the datetime values when disabled
    //         if (this.stopFromDate) this.stopFromDate.value = '';
    //         if (this.stopFromTime) this.stopFromTime.value = '';
    //         if (this.stopToDate) this.stopToDate.value = '';
    //         if (this.stopToTime) this.stopToTime.value = '';
    //     }
    //     
    //     // Save settings
    //     this.saveAlarmSettings();
    // }
    
    // handleStopAlarmChange() {
    //     // Only validate if stop alarm is enabled
    //     if (!this.stopAlarmEnabled || !this.stopAlarmEnabled.checked) {
    //         return;
    //     }
    //     
    //     const fromDate = this.stopFromDate ? this.stopFromDate.value : '';
    //     const fromTime = this.stopFromTime ? this.stopFromTime.value : '';
    //     const toDate = this.stopToDate ? this.stopToDate.value : '';
    //     const toTime = this.stopToTime ? this.stopToTime.value : '';
    //     
    //     console.log('Stop alarm change detected:', { fromDate, fromTime, toDate, toTime });
    //     
    //     // Validate that both from and to are filled if either is filled
    //     if ((fromDate || fromTime) && (!toDate || !toTime)) {
    //         this.showAudioStatus('Please set both "To" date and time when setting "From"', 'warning');
    //         return;
    //     }
    //     
    //     if ((toDate || toTime) && (!fromDate || !fromTime)) {
    //         this.showAudioStatus('Please set both "From" date and time when setting "To"', 'warning');
    //         return;
    //     }
    //     
    //     // If both are set, validate the time range
    //     if (fromDate && fromTime && toDate && toTime) {
    //         const fromDateTime = new Date(`${fromDate}T${fromTime}`);
    //         const toDateTime = new Date(`${toDate}T${toTime}`);
    //         
    //         console.log('Stop alarm period:', { fromDateTime, toDateTime, now: new Date() });
    //         
    //         if (fromDateTime >= toDateTime) {
    //             this.showAudioStatus('"From" time must be before "To" time', 'warning');
    //             return;
    //         }
    //         
    //         // Just log the status without showing UI messages
    //         const isInPeriod = this.isInStopAlarmPeriod();
    //         console.log('Currently in stop period:', isInPeriod);
    //         
    //         if (isInPeriod) {
    //             this.showAudioStatus('Alarm is currently stopped until the scheduled time', 'info');
    //         } else {
    //             this.showAudioStatus('Stop alarm period set successfully', 'success');
    //         }
    //     }
    //     
    //     // Save settings
    //     this.saveAlarmSettings();
    // }
    
    // checkStopAlarmPeriod() {
    //     const fromDate = this.stopFromDate ? this.stopFromDate.value : '';
    //     const fromTime = this.stopFromTime ? this.stopFromTime.value : '';
    //     const toDate = this.stopToDate ? this.stopToDate.value : '';
    //     const toTime = this.stopToTime ? this.stopToTime.value : '';
    //     
    //     if (!fromDate || !fromTime || !toDate || !toTime) {
    //         return false;
    //     }
    //     
    //     const now = new Date();
    //     const fromDateTime = new Date(`${fromDate}T${fromTime}`);
    //     const toDateTime = new Date(`${toDate}T${toTime}`);
    //     
    //     const isInStopPeriod = now >= fromDateTime && now <= toDateTime;
    //     
    //     if (isInStopPeriod) {
    //         console.log('Currently in stop alarm period - audio will be blocked');
    //         this.showAudioStatus('Alarm is currently stopped until the scheduled time', 'info');
    //     } else {
    //         console.log('Not in stop alarm period - audio will play normally');
    //     }
    //     
    //     return isInStopPeriod;
    // }
    
    // Silent version for checking without showing status messages
    // isInStopAlarmPeriod() {
    //     // First check if stop alarm is enabled
    //     if (!this.stopAlarmEnabled || !this.stopAlarmEnabled.checked) {
    //         return false;
    //     }
    //     
    //     const fromDate = this.stopFromDate ? this.stopFromDate.value : '';
    //     const fromTime = this.stopFromTime ? this.stopFromTime.value : '';
    //     const toDate = this.stopToDate ? this.stopToDate.value : '';
    //     const toTime = this.stopToTime ? this.stopToTime.value : '';
    //     
    //     if (!fromDate || !fromTime || !toDate || !toTime) {
    //         return false;
    //     }
    //     
    //     const now = new Date();
    //     const fromDateTime = new Date(`${fromDate}T${fromTime}`);
    //     const toDateTime = new Date(`${toDate}T${toTime}`);
    //     
    //     // Debug logging
    //     console.log('Stop alarm check:', {
    //         enabled: this.stopAlarmEnabled.checked,
    //         now: now.toISOString(),
    //         fromDateTime: fromDateTime.toISOString(),
    //         toDateTime: toDateTime.toISOString(),
    //         isInPeriod: now >= fromDateTime && now <= toDateTime
    //     });
    //     
    //     return now >= fromDateTime && now <= toDateTime;
    // }
    
    
    // Local Storage Methods for Alarm Settings
    saveAlarmSettings() {
        const settingsToSave = {
            // Save current audio settings if they exist
            playMode: this.audioSettings ? this.audioSettings.playMode : null,
            duration: this.audioSettings ? this.audioSettings.duration : 0,
            stopCondition: this.audioSettings ? this.audioSettings.stopCondition : 'manual',
            minutes: this.audioSettings ? this.audioSettings.minutes : 0,
            // Save current UI state
            infiniteChecked: this.playModeInfinite ? this.playModeInfinite.checked : false,
            customChecked: this.playModeCustom ? this.playModeCustom.checked : false,
            customDurationMinutes: this.customDurationMinutes ? this.customDurationMinutes.value : '5',
            // Save stop alarm settings
            // stopAlarmEnabled: this.stopAlarmEnabled ? this.stopAlarmEnabled.checked : false,
            // stopFromDate: this.stopFromDate ? this.stopFromDate.value : '',
            // stopFromTime: this.stopFromTime ? this.stopFromTime.value : '',
            // stopToDate: this.stopToDate ? this.stopToDate.value : '',
            // stopToTime: this.stopToTime ? this.stopToTime.value : '',
            // Save countdown timer state
            countdownEndTime: this.countdownEndTime,
            isAudioPlaying: this.isAudioPlaying,
            timestamp: Date.now()
        };
        
        try {
            localStorage.setItem('alarmControlSettings', JSON.stringify(settingsToSave));
            console.log('Alarm settings saved to Local Storage:', settingsToSave);
        } catch (error) {
            console.warn('Failed to save alarm settings to Local Storage:', error);
        }
    }
    
    loadAlarmSettings() {
        try {
            const savedSettings = localStorage.getItem('alarmControlSettings');
            if (!savedSettings) return;
            
            const settings = JSON.parse(savedSettings);
            console.log('Loading alarm settings from Local Storage:', settings);
            
            // Restore checkbox states
            if (this.playModeInfinite && settings.infiniteChecked !== undefined) {
                this.playModeInfinite.checked = settings.infiniteChecked;
            }
            if (this.playModeCustom && settings.customChecked !== undefined) {
                this.playModeCustom.checked = settings.customChecked;
            }
            
            // Restore custom duration input
            if (this.customDurationMinutes && settings.customDurationMinutes !== undefined) {
                this.customDurationMinutes.value = settings.customDurationMinutes;
            }
            
            // Show/hide custom duration group based on checkbox state
            if (this.customDurationGroup) {
                this.customDurationGroup.style.display = this.playModeCustom && this.playModeCustom.checked ? 'block' : 'none';
            }
            
            // Restore stop alarm settings
            // if (this.stopAlarmEnabled && settings.stopAlarmEnabled !== undefined) {
            //     this.stopAlarmEnabled.checked = settings.stopAlarmEnabled;
            //     // Show/hide datetime fields based on checkbox state
            //     if (this.stopAlarmDatetimeFields) {
            //         this.stopAlarmDatetimeFields.style.display = settings.stopAlarmEnabled ? 'block' : 'none';
            //     }
            // }
            // if (this.stopFromDate && settings.stopFromDate !== undefined) {
            //     this.stopFromDate.value = settings.stopFromDate;
            // }
            // if (this.stopFromTime && settings.stopFromTime !== undefined) {
            //     this.stopFromTime.value = settings.stopFromTime;
            // }
            // if (this.stopToDate && settings.stopToDate !== undefined) {
            //     this.stopToDate.value = settings.stopToDate;
            // }
            // if (this.stopToTime && settings.stopToTime !== undefined) {
            //     this.stopToTime.value = settings.stopToTime;
            // }
            
            // Restore audio settings object only if a play mode is actually selected
            if (settings.playMode && settings.duration !== undefined && settings.stopCondition && 
                (settings.infiniteChecked || settings.customChecked)) {
                this.audioSettings = {
                    playMode: settings.playMode,
                    duration: settings.duration,
                    stopCondition: settings.stopCondition,
                    minutes: settings.minutes || 0
                };
                
                console.log('Alarm settings restored:', this.audioSettings);
            } else {
                // Clear audio settings if no play mode is selected
                this.audioSettings = null;
                console.log('No play mode selected, clearing audio settings');
            }
            
            // Restore countdown timer and audio playback if applicable
            this.restoreCountdownTimer(settings);
            
        } catch (error) {
            console.warn('Failed to load alarm settings from Local Storage:', error);
        }
    }
    
    restoreCountdownTimer(settings) {
        // Check if we have a saved countdown timer state
        if (settings.countdownEndTime && settings.timestamp) {
            const now = Date.now();
            const timeElapsed = now - settings.timestamp;
            const originalEndTime = settings.countdownEndTime;
            const adjustedEndTime = originalEndTime - timeElapsed;
            
            // Only restore if there's still time remaining
            if (adjustedEndTime > now) {
                const remainingSeconds = Math.ceil((adjustedEndTime - now) / 1000);
                
                console.log(`Restoring countdown timer with ${remainingSeconds} seconds remaining`);
                
                // Restore the countdown timer
                this.countdownEndTime = adjustedEndTime;
                this.showCountdownTimer(remainingSeconds, true);
                
                // If audio was playing, resume it
                if (settings.isAudioPlaying && this.audioSettings && this.audioSettings.playMode === 'custom-event') {
                    console.log('Resuming audio playback from saved state');
                    this.isAudioPlaying = true;
                    this.isStopping = false;
                    this.applySettingsToCurrentAudio();
                    this.playNotificationSound();
                }
            } else {
                console.log('Countdown timer has expired, not restoring');
            }
        }
    }
    
    clearAlarmSettings() {
        try {
            localStorage.removeItem('alarmControlSettings');
            console.log('Alarm settings cleared from Local Storage');
        } catch (error) {
            console.warn('Failed to clear alarm settings from Local Storage:', error);
        }
    }
    
    
    stopAudioNow() {
        this.stopAudioImmediate();
        console.log('Audio stopped immediately by user');
        
        // Show feedback to user
        this.showStopNowFeedback();
    }
    
    showStopNowFeedback() {
        const btn = this.stopAudioNowBtn;
        const originalText = btn.textContent;
        btn.textContent = 'Stopped!';
        btn.style.background = '#e74c3c';
        
        // Show status message
        this.showAudioStatus('Audio stopped immediately', 'warning');
        
        setTimeout(() => {
            btn.textContent = originalText;
            btn.style.background = '';
        }, 1500);
    }
    
    // Test function to create a sample event with image URL
    createTestEvent() {
        const testEvent = {
            id: 'test-' + Date.now(),
            audio_url: '/notification.wav',
            image_url: '/placeholder.svg',
            event_type: 'Test Event',
            timestamp: new Date().toISOString()
        };
        
        console.log('Creating test event:', testEvent);
        this.handleEvent(testEvent);
    }
    
    // Test function with a real image URL
    createTestEventWithRealImage() {
        const testEvent = {
            id: 'test-real-' + Date.now(),
            audio_url: '/notification.wav',
            image_url: 'https://via.placeholder.com/300x200/007bff/ffffff?text=Test+Image',
            event_type: 'Test Event with Real Image',
            timestamp: new Date().toISOString()
        };
        
        console.log('Creating test event with real image:', testEvent);
        this.handleEvent(testEvent);
    }
    
    // Recent Events Methods
    addToRecentEvents(data) {
        if (!this.recentEventsList) return;
        
        // Remove "no recent events" message if it exists
        const noEventsMsg = this.recentEventsList.querySelector('.no-recent-events');
        if (noEventsMsg) {
            noEventsMsg.remove();
        }
        
        const eventItem = document.createElement('div');
        eventItem.className = 'recent-event-item';
        
        const timestamp = new Date();
        const dateStr = timestamp.toLocaleDateString('en-US', { 
            month: 'short', 
            day: 'numeric', 
            year: 'numeric' 
        });
        const timeStr = timestamp.toLocaleTimeString('en-US', { 
            hour: 'numeric', 
            minute: '2-digit',
            second: '2-digit',
            hour12: true 
        });
        
        // Extract event type - use the same logic as the main events table
        let eventType = data.event_type || 'Media Event';
        if (!data.event_type) {
            const audioUrl = (data.audio_url || (data.data && data.data.audio_url));
            const imageUrl = (data.image_url || (data.data && data.data.image_url) || data.imageUrl || (data.data && data.data.imageUrl) || null);
            const isValidImageUrl = imageUrl && imageUrl !== '/placeholder.svg' && imageUrl !== '' && imageUrl !== null && imageUrl !== undefined;
            if (audioUrl && isValidImageUrl) {
                eventType = 'Audio & Image Event';
            } else if (audioUrl) {
                eventType = 'Audio Event';
            } else if (isValidImageUrl) {
                eventType = 'Image Event';
            }
        }
        
        // Create media buttons similar to the main table
        const audioUrl = (data.audio_url || (data.data && data.data.audio_url) || '/notification.wav');
        const imageUrl = (data.image_url || (data.data && data.data.image_url) || data.imageUrl || (data.data && data.data.imageUrl) || null);
        
        // Validate image URL - only show if it's a real URL and not empty
        const isValidImageUrl = imageUrl && imageUrl !== '/placeholder.svg' && imageUrl !== '' && imageUrl !== null && imageUrl !== undefined;
        
        // Debug logging for recent events image URL (can be removed in production)
        // console.log('Recent event data:', data);
        // console.log('Recent event imageUrl:', imageUrl);
        // console.log('Recent event image URL exists:', !!imageUrl);
        
        eventItem.innerHTML = `
            <div class="recent-event-header">
                <div class="recent-event-datetime">
                    <div class="recent-event-date">${dateStr}</div>
                    <div class="recent-event-time">${timeStr}</div>
                </div>
            </div>
            <div class="recent-event-media">
                ${isValidImageUrl ? `
                    <div class="recent-event-image-container">
                        <img src="${imageUrl}" alt="Event image" class="recent-event-image" />
                    </div>
                ` : ''}
            </div>
        `;
        
        // Add event listeners for the image
        const imageElement = eventItem.querySelector('.recent-event-image');
        
        if (imageElement) {
            imageElement.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.showModal(imageUrl);
            });
        }
        
        // Clear all existing events and show only the latest one
        this.recentEventsList.innerHTML = '';
        this.recentEventsList.appendChild(eventItem);
    }
    
}

// Initialize the application when the DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    const app = new SSEAudioNotifier();
    
    // Make app available globally for testing
    window.app = app;
    
    // Initialize pagination immediately to ensure it loads
    if (typeof app.loadPage === 'function') {
        app.loadPage(1).catch((e) => console.warn('Failed to load initial page:', e));
    }
    
    // Add some helpful console messages
    console.log('SSE Audio Notifier initialized');
    console.log('Automatically connecting to SSE to start receiving events');
    console.log('Audio will play automatically when new events arrive');
    console.log('Test functions available: app.createTestEvent() and app.createTestEventWithRealImage()');
});
