const WebRTCSignalingServer = require('./signaling-server');
const RTSPProcessor = require('./rtsp-processor');
const WebRTCPeerManager = require('./peer-manager');
const EventEmitter = require('events');
const path = require('path');
const fs = require('fs');

class WebRTCStreamingService extends EventEmitter {
    constructor(server, options = {}) {
        super();
        this.server = server;
        this.options = {
            rtspUrl: options.rtspUrl || process.env.RTSP_URL,
            frameRate: options.frameRate || 30,
            width: options.width || 1280,
            height: options.height || 720,
            bitrate: options.bitrate || '2000k',
            ...options
        };

        // Initialize components
        this.signalingServer = new WebRTCSignalingServer(server);
        this.rtspProcessor = new RTSPProcessor(this.options);
        this.peerManager = new WebRTCPeerManager();

        // Setup event handlers
        this.setupEventHandlers();

        // Ensure stream directory exists
        this.ensureStreamDirectory();
    }

    setupEventHandlers() {
        // Signaling server events
        this.signalingServer.on('sdp-offer', async (data) => {
            try {
                await this.handleSDPOffer(data);
            } catch (error) {
                console.error('Error handling SDP offer:', error);
                this.signalingServer.sendError(data.socketId, { message: error.message });
            }
        });

        this.signalingServer.on('ice-candidate', async (data) => {
            try {
                await this.handleICECandidate(data);
            } catch (error) {
                console.error('Error handling ICE candidate:', error);
                this.signalingServer.sendError(data.socketId, { message: error.message });
            }
        });

        this.signalingServer.on('start-stream', (socketId) => {
            this.startStreaming(socketId);
        });

        this.signalingServer.on('stop-stream', (socketId) => {
            this.stopStreaming(socketId);
        });

        this.signalingServer.on('client-disconnect', (socketId) => {
            this.handleClientDisconnect(socketId);
        });

        // Peer manager events
        this.peerManager.on('sdp-answer', (data) => {
            this.signalingServer.sendSDPAnswer(data.socketId, data.answer);
        });

        this.peerManager.on('ice-candidate', (data) => {
            this.signalingServer.sendICECandidate(data.socketId, data.candidate);
        });

        this.peerManager.on('connection-state-change', (data) => {
            this.signalingServer.sendStreamStatus(data.socketId, {
                type: 'connection-state',
                state: data.state
            });
        });

        this.peerManager.on('ice-connection-state-change', (data) => {
            this.signalingServer.sendStreamStatus(data.socketId, {
                type: 'ice-connection-state',
                state: data.state
            });
        });

        this.peerManager.on('error', (data) => {
            this.signalingServer.sendError(data.socketId, { message: data.error });
        });

        // RTSP processor events
        this.rtspProcessor.on('stream-started', () => {
            console.log('RTSP stream started successfully');
            this.broadcastStreamStatus('stream-started');
        });

        this.rtspProcessor.on('stream-stopped', () => {
            console.log('RTSP stream stopped');
            this.broadcastStreamStatus('stream-stopped');
        });

        this.rtspProcessor.on('stream-error', (error) => {
            console.error('RTSP stream error:', error);
            this.broadcastStreamStatus('stream-error', { error: error.message });
        });

        this.rtspProcessor.on('frame', (frameData) => {
            // Process frame for WebRTC transmission
            this.processFrameForWebRTC(frameData);
        });
    }

    async handleSDPOffer(data) {
        const { socketId, offer } = data;
        console.log(`Handling SDP offer from ${socketId}`);

        // Create peer connection and handle offer
        const answer = await this.peerManager.handleSDPOffer(socketId, offer);
        
        // Send answer back to client
        this.signalingServer.sendSDPAnswer(socketId, answer.toJSON());
    }

    async handleICECandidate(data) {
        const { socketId, candidate } = data;
        console.log(`Handling ICE candidate from ${socketId}`);

        await this.peerManager.handleICECandidate(socketId, candidate);
    }

    async startStreaming(socketId) {
        try {
            console.log(`Starting streaming for ${socketId}`);

            // Start RTSP processor if not already running
            if (!this.rtspProcessor.isStreaming) {
                await this.rtspProcessor.startStream();
            }

            // Send stream status to client
            this.signalingServer.sendStreamStatus(socketId, {
                type: 'stream-started',
                message: 'Stream started successfully'
            });

        } catch (error) {
            console.error(`Failed to start streaming for ${socketId}:`, error);
            this.signalingServer.sendError(socketId, { message: error.message });
        }
    }

    async stopStreaming(socketId) {
        try {
            console.log(`Stopping streaming for ${socketId}`);

            // Remove peer connection
            this.peerManager.removePeerConnection(socketId);

            // Send stream status to client
            this.signalingServer.sendStreamStatus(socketId, {
                type: 'stream-stopped',
                message: 'Stream stopped'
            });

        } catch (error) {
            console.error(`Failed to stop streaming for ${socketId}:`, error);
            this.signalingServer.sendError(socketId, { message: error.message });
        }
    }

    handleClientDisconnect(socketId) {
        console.log(`Handling client disconnect for ${socketId}`);
        this.peerManager.removePeerConnection(socketId);
    }

    processFrameForWebRTC(frameData) {
        // This would process the frame data for WebRTC transmission
        // For now, we'll use HLS streaming as an alternative
        console.log('Processing frame for WebRTC transmission');
    }

    broadcastStreamStatus(type, data = {}) {
        this.signalingServer.broadcast('stream-status', {
            type,
            timestamp: new Date().toISOString(),
            ...data
        });
    }

    ensureStreamDirectory() {
        const streamDir = path.join(__dirname, '../../public/stream');
        if (!fs.existsSync(streamDir)) {
            fs.mkdirSync(streamDir, { recursive: true });
            console.log('Created stream directory:', streamDir);
        }
    }

    // Get service status
    getStatus() {
        return {
            rtsp: this.rtspProcessor.getStatus(),
            signaling: {
                connectionCount: this.signalingServer.getConnectionCount(),
                connectedClients: this.signalingServer.getConnectedClients()
            },
            peerConnections: this.peerManager.getAllPeerConnectionsStatus()
        };
    }

    // Update configuration
    updateConfig(config) {
        this.rtspProcessor.updateConfig(config);
        console.log('Updated streaming service configuration');
    }

    // Test RTSP connection
    async testRTSPConnection() {
        try {
            await this.rtspProcessor.testConnection();
            return { success: true, message: 'RTSP connection test successful' };
        } catch (error) {
            return { success: false, message: error.message };
        }
    }

    // Start the service
    async start() {
        console.log('Starting WebRTC streaming service...');
        
        // Test RTSP connection
        const testResult = await this.testRTSPConnection();
        if (!testResult.success) {
            console.warn('RTSP connection test failed:', testResult.message);
        }

        console.log('WebRTC streaming service started');
        this.emit('service-started');
    }

    // Stop the service
    async stop() {
        console.log('Stopping WebRTC streaming service...');
        
        // Stop RTSP processor
        await this.rtspProcessor.stopStream();
        
        // Close all peer connections
        this.peerManager.closeAllConnections();
        
        // Close signaling server
        this.signalingServer.close();
        
        console.log('WebRTC streaming service stopped');
        this.emit('service-stopped');
    }
}

module.exports = WebRTCStreamingService;
