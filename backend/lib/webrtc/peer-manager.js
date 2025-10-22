const EventEmitter = require('events');

class WebRTCPeerManager extends EventEmitter {
    constructor() {
        super();
        this.connections = new Map();
    }

    async createPeerConnection(socketId) {
        try {
            // Store connection info (simplified for HLS streaming)
            this.connections.set(socketId, {
                connected: false,
                streaming: false,
                socketId
            });

            console.log(`Created connection for ${socketId}`);
            return { socketId, connected: true };

        } catch (error) {
            console.error(`Failed to create connection for ${socketId}:`, error);
            throw error;
        }
    }

    async handleSDPOffer(socketId, offer) {
        try {
            console.log(`Handling SDP offer from ${socketId} (simplified for HLS)`);
            
            // For HLS streaming, we don't need complex WebRTC negotiation
            // Just acknowledge the connection
            const connection = this.connections.get(socketId);
            if (connection) {
                connection.connected = true;
            }

            // Emit a simple response
            this.emit('sdp-answer', {
                socketId,
                answer: { type: 'answer', sdp: 'v=0\r\no=- 0 0 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\n' }
            });

            return { type: 'answer', sdp: 'v=0\r\no=- 0 0 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\n' };

        } catch (error) {
            console.error(`Failed to handle SDP offer for ${socketId}:`, error);
            this.emit('error', {
                socketId,
                error: error.message
            });
            throw error;
        }
    }

    async handleICECandidate(socketId, candidate) {
        try {
            console.log(`Handling ICE candidate from ${socketId} (simplified for HLS)`);
            // For HLS streaming, we don't need ICE candidates
        } catch (error) {
            console.error(`Failed to handle ICE candidate for ${socketId}:`, error);
            this.emit('error', {
                socketId,
                error: error.message
            });
        }
    }

    // Remove connection
    removePeerConnection(socketId) {
        const connection = this.connections.get(socketId);
        if (connection) {
            this.connections.delete(socketId);
            console.log(`Removed connection for ${socketId}`);
        }
    }

    // Get connection status
    getPeerConnectionStatus(socketId) {
        const connection = this.connections.get(socketId);
        if (!connection) {
            return null;
        }

        return {
            connected: connection.connected,
            streaming: connection.streaming,
            connectionState: connection.connected ? 'connected' : 'disconnected',
            iceConnectionState: 'completed',
            iceGatheringState: 'complete',
            signalingState: 'stable'
        };
    }

    // Get all connections status
    getAllPeerConnectionsStatus() {
        const status = {};
        for (const [socketId, connection] of this.connections) {
            status[socketId] = this.getPeerConnectionStatus(socketId);
        }
        return status;
    }

    // Get connection count
    getConnectionCount() {
        return this.connections.size;
    }

    // Close all connections
    closeAllConnections() {
        this.connections.clear();
        console.log('Closed all connections');
    }
}

module.exports = WebRTCPeerManager;
