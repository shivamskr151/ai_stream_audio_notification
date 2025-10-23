class WebRTCVideoStreamer {
    constructor() {
        this.socket = null;
        this.videoElement = null;
        this.isConnected = false;
        this.isStreaming = false;
        this.connectionStatus = 'disconnected';
        this.hls = null;
        
        // Wait for DOM to be ready
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => {
                this.initializeElements();
                this.setupEventHandlers();
            });
        } else {
            this.initializeElements();
            this.setupEventHandlers();
        }
    }

    initializeElements() {
        this.videoElement = document.getElementById('webrtc-video');
        this.statusIndicator = document.getElementById('webrtc-status-indicator');
        this.statusText = document.getElementById('webrtc-status-text');
        this.startButton = document.getElementById('start-stream-btn');
        this.stopButton = document.getElementById('stop-stream-btn');
        this.connectionInfo = document.getElementById('connection-info');
        
        // Configure video element for better HLS playback
        if (this.videoElement) {
            this.videoElement.setAttribute('autoplay', 'true');
            this.videoElement.setAttribute('muted', 'true');
            this.videoElement.setAttribute('playsinline', 'true');
            this.videoElement.setAttribute('controls', 'true');
            console.log('Video element configured:', this.videoElement);
            
            // Add event listeners for debugging
            this.videoElement.addEventListener('loadstart', () => {
                console.log('Video loadstart event');
            });
            
            this.videoElement.addEventListener('loadeddata', () => {
                console.log('Video loadeddata event');
            });
            
            this.videoElement.addEventListener('canplay', () => {
                console.log('Video canplay event');
            });
            
            this.videoElement.addEventListener('play', () => {
                console.log('Video play event');
            });
            
            this.videoElement.addEventListener('error', (e) => {
                console.error('Video error event:', e);
            });
            
            // Ensure video element is properly configured for HLS
            console.log('Video element ready for HLS streaming');
        } else {
            console.error('Video element not found!');
        }
    }

    setupEventHandlers() {
        if (this.startButton) {
            this.startButton.addEventListener('click', () => this.startStream());
        }
        
        if (this.stopButton) {
            this.stopButton.addEventListener('click', () => this.stopStream());
        }
    }

    async initializeSocket() {
        if (this.socket) {
            return;
        }

        try {
            // Import socket.io client
            const { io } = await import('https://cdn.socket.io/4.7.5/socket.io.esm.min.js');
            
            this.socket = io();
            
            this.socket.on('connect', () => {
                console.log('WebRTC socket connected');
                this.updateConnectionStatus('connected', 'Connected to signaling server');
            });

            this.socket.on('disconnect', () => {
                console.log('WebRTC socket disconnected');
                this.updateConnectionStatus('disconnected', 'Disconnected from signaling server');
            });

            this.socket.on('sdp-answer', async (data) => {
                console.log('Received SDP answer');
                await this.handleSDPAnswer(data.answer);
            });

            this.socket.on('ice-candidate', async (data) => {
                console.log('Received ICE candidate');
                await this.handleICECandidate(data.candidate);
            });

            this.socket.on('stream-status', (data) => {
                console.log('Stream status:', data);
                this.handleStreamStatus(data);
            });

            this.socket.on('error', (error) => {
                console.error('WebRTC socket error:', error);
                this.updateConnectionStatus('error', `Error: ${error.message}`);
            });

        } catch (error) {
            console.error('Failed to initialize socket:', error);
            this.updateConnectionStatus('error', 'Failed to connect to signaling server');
        }
    }


    async startStream() {
        try {
            console.log('Starting video stream...');
            
            // Initialize socket if not already done
            if (!this.socket) {
                await this.initializeSocket();
            }

            // Request stream start
            this.socket.emit('start-stream');

            // Wait a moment for the backend to start streaming
            await new Promise(resolve => setTimeout(resolve, 2000));

            // Start HLS stream
            await this.startHLSStream();

            this.updateStreamStatus('connecting', 'Connecting to stream...');
            this.updateButtonStates(true);

        } catch (error) {
            console.error('Failed to start stream:', error);
            this.updateConnectionStatus('error', `Failed to start stream: ${error.message}`);
        }
    }

    async startHLSStream() {
        try {
            const streamUrl = window.__APP_CONFIG__?.streamUrl || '/stream/stream.m3u8';
            console.log('Starting HLS stream from:', streamUrl);
            console.log('Video element:', this.videoElement);
            console.log('HLS available:', typeof Hls !== 'undefined');
            console.log('HLS supported:', typeof Hls !== 'undefined' && Hls.isSupported());
            console.log('App config:', window.__APP_CONFIG__);
            console.log('Browser:', navigator.userAgent);
            console.log('Current URL:', window.location.href);

            if (this.videoElement) {
                // Check if HLS is supported
                if (this.videoElement.canPlayType('application/vnd.apple.mpegurl')) {
                    // Native HLS support (Safari)
                    console.log('Using native HLS support');
                    this.videoElement.src = streamUrl;
                    this.videoElement.load();
                    
                    // Add timeout for native HLS loading
                    const nativeLoadTimeout = setTimeout(() => {
                        if (!this.isStreaming) {
                            console.error('Native HLS stream load timeout');
                            this.updateConnectionStatus('error', 'Native HLS load timeout - check RTSP connection');
                        }
                    }, 10000); // 10 second timeout
                    
                    this.videoElement.addEventListener('loadeddata', () => {
                        clearTimeout(nativeLoadTimeout);
                        console.log('Native HLS video loaded');
                        this.isStreaming = true;
                        this.updateStreamStatus('streaming', 'Video stream active');
                    });
                    
                    this.videoElement.addEventListener('error', (e) => {
                        clearTimeout(nativeLoadTimeout);
                        console.error('Native HLS video error:', e);
                        this.updateConnectionStatus('error', 'Video playback error');
                    });
                } else if (typeof Hls !== 'undefined' && Hls.isSupported()) {
                    // HLS.js support (Chrome, Firefox, etc.)
                    console.log('Using HLS.js support');
                    this.hls = new Hls({
                        debug: true, // Enable debug for troubleshooting
                        enableWorker: true,
                        lowLatencyMode: true,
                        backBufferLength: 90
                    });
                    this.hls.loadSource(streamUrl);
                    this.hls.attachMedia(this.videoElement);
                    
                    this.hls.on(Hls.Events.MANIFEST_PARSED, () => {
                        console.log('HLS manifest parsed, starting playback');
                        this.isStreaming = true;
                        this.updateStreamStatus('streaming', 'Video stream active');
                    });
                    
                    this.hls.on(Hls.Events.ERROR, (event, data) => {
                        console.error('HLS error:', data);
                        
                        if (data.fatal) {
                            switch (data.type) {
                                case Hls.ErrorTypes.NETWORK_ERROR:
                                    console.log('Fatal network error, trying to recover...');
                                    this.hls.startLoad();
                                    break;
                                case Hls.ErrorTypes.MEDIA_ERROR:
                                    console.log('Fatal media error, trying to recover...');
                                    this.hls.recoverMediaError();
                                    break;
                                default:
                                    console.log('Fatal error, destroying HLS...');
                                    this.hls.destroy();
                                    this.updateConnectionStatus('error', `Fatal error: ${data.details}`);
                                    break;
                            }
                        } else {
                            // Non-fatal error, just log it
                            console.warn('Non-fatal HLS error:', data.details);
                        }
                    });
                    
                    // Add timeout for stream loading
                    const loadTimeout = setTimeout(() => {
                        if (!this.isStreaming) {
                            console.error('HLS stream load timeout');
                            this.updateConnectionStatus('error', 'Stream load timeout - check RTSP connection');
                        }
                    }, 10000); // 10 second timeout
                    
                    this.hls.on(Hls.Events.MANIFEST_PARSED, () => {
                        clearTimeout(loadTimeout);
                    });
                    
                    this.hls.on(Hls.Events.BUFFER_STALLED, () => {
                        console.log('Buffer stalled, attempting recovery...');
                        this.hls.startLoad();
                    });
                } else {
                    console.error('HLS not supported in this browser');
                    throw new Error('HLS not supported in this browser');
                }
            } else {
                console.error('Video element not found');
                throw new Error('Video element not found');
            }
        } catch (error) {
            console.error('Failed to start HLS stream:', error);
            throw error;
        }
    }

    async stopStream() {
        try {
            console.log('Stopping video stream...');

            // Request stream stop
            if (this.socket) {
                this.socket.emit('stop-stream');
            }

            // Stop HLS stream
            if (this.hls) {
                this.hls.destroy();
                this.hls = null;
            }

            // Clear video element
            if (this.videoElement) {
                this.videoElement.src = '';
                this.videoElement.load();
            }

            this.isStreaming = false;
            this.updateStreamStatus('stopped', 'Stream stopped');
            this.updateButtonStates(false);

        } catch (error) {
            console.error('Failed to stop stream:', error);
            this.updateConnectionStatus('error', `Failed to stop stream: ${error.message}`);
        }
    }

    async handleSDPAnswer(answer) {
        try {
            console.log('SDP answer received (simplified for HLS)');
            // For HLS streaming, we don't need to process SDP answers
        } catch (error) {
            console.error('Failed to handle SDP answer:', error);
        }
    }

    async handleICECandidate(candidate) {
        try {
            console.log('ICE candidate received (simplified for HLS)');
            // For HLS streaming, we don't need to process ICE candidates
        } catch (error) {
            console.error('Failed to handle ICE candidate:', error);
        }
    }

    handleStreamStatus(data) {
        switch (data.type) {
            case 'stream-started':
                this.updateStreamStatus('streaming', 'Stream started successfully');
                break;
            case 'stream-stopped':
                this.updateStreamStatus('stopped', 'Stream stopped');
                break;
            case 'stream-error':
                this.updateStreamStatus('error', `Stream error: ${data.error}`);
                break;
            case 'connection-state':
                this.updateConnectionStatus(data.state, `Connection: ${data.state}`);
                break;
            case 'ice-connection-state':
                console.log('ICE connection state:', data.state);
                break;
        }
    }

    updateConnectionStatus(status, message) {
        this.connectionStatus = status;
        
        if (this.statusIndicator) {
            this.statusIndicator.className = `status-indicator status-${status}`;
        }
        
        if (this.statusText) {
            this.statusText.textContent = message;
        }

        // Update connection info
        if (this.connectionInfo) {
            this.connectionInfo.innerHTML = `
                <div class="connection-detail">
                    <strong>Status:</strong> ${status}
                </div>
                <div class="connection-detail">
                    <strong>Message:</strong> ${message}
                </div>
                <div class="connection-detail">
                    <strong>Streaming:</strong> ${this.isStreaming ? 'Yes' : 'No'}
                </div>
            `;
        }
    }

    updateStreamStatus(status, message) {
        console.log(`Stream status: ${status} - ${message}`);
        
        // Update UI based on stream status
        if (status === 'streaming') {
            this.updateConnectionStatus('streaming', message);
        } else if (status === 'error') {
            this.updateConnectionStatus('error', message);
        }
    }

    updateButtonStates(isStreaming) {
        if (this.startButton) {
            this.startButton.disabled = isStreaming;
            this.startButton.textContent = isStreaming ? 'Starting...' : 'Start Stream';
        }
        
        if (this.stopButton) {
            this.stopButton.disabled = !isStreaming;
            this.stopButton.textContent = isStreaming ? 'Stop Stream' : 'Stopped';
        }
    }

    // Get current status
    getStatus() {
        return {
            isConnected: this.isConnected,
            isStreaming: this.isStreaming,
            connectionStatus: this.connectionStatus,
            peerConnectionState: this.peerConnection ? this.peerConnection.connectionState : null
        };
    }

    // Cleanup
    destroy() {
        this.stopStream();
        if (this.socket) {
            this.socket.disconnect();
            this.socket = null;
        }
    }
}

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    // Only initialize if WebRTC is enabled
    if (window.__APP_CONFIG__ && window.__APP_CONFIG__.webrtcEnabled) {
        window.webrtcStreamer = new WebRTCVideoStreamer();
        console.log('WebRTC Video Streamer initialized');
    }
});
