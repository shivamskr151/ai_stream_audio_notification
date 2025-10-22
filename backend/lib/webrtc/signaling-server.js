const { Server } = require('socket.io');
const EventEmitter = require('events');

class WebRTCSignalingServer extends EventEmitter {
    constructor(server) {
        super();
        this.io = new Server(server, {
            cors: {
                origin: "*",
                methods: ["GET", "POST"]
            }
        });
        this.connections = new Map();
        this.setupSocketHandlers();
    }

    setupSocketHandlers() {
        this.io.on('connection', (socket) => {
            console.log(`WebRTC client connected: ${socket.id}`);
            
            // Store connection info
            this.connections.set(socket.id, {
                socket,
                connected: true,
                peerConnection: null
            });

            // Handle SDP offer from client
            socket.on('sdp-offer', async (data) => {
                console.log(`Received SDP offer from ${socket.id}`);
                try {
                    // Forward the offer to the RTSP stream processor
                    this.emit('sdp-offer', {
                        socketId: socket.id,
                        offer: data.offer,
                        socket
                    });
                } catch (error) {
                    console.error('Error handling SDP offer:', error);
                    socket.emit('error', { message: 'Failed to process SDP offer' });
                }
            });

            // Handle ICE candidates from client
            socket.on('ice-candidate', (data) => {
                console.log(`Received ICE candidate from ${socket.id}`);
                this.emit('ice-candidate', {
                    socketId: socket.id,
                    candidate: data.candidate,
                    socket
                });
            });

            // Handle client disconnect
            socket.on('disconnect', () => {
                console.log(`WebRTC client disconnected: ${socket.id}`);
                this.connections.delete(socket.id);
                this.emit('client-disconnect', socket.id);
            });

            // Handle stream start request
            socket.on('start-stream', () => {
                console.log(`Stream start requested by ${socket.id}`);
                this.emit('start-stream', socket.id);
            });

            // Handle stream stop request
            socket.on('stop-stream', () => {
                console.log(`Stream stop requested by ${socket.id}`);
                this.emit('stop-stream', socket.id);
            });
        });
    }

    // Send SDP answer to client
    sendSDPAnswer(socketId, answer) {
        const connection = this.connections.get(socketId);
        if (connection && connection.connected) {
            connection.socket.emit('sdp-answer', { answer });
            console.log(`Sent SDP answer to ${socketId}`);
        }
    }

    // Send ICE candidate to client
    sendICECandidate(socketId, candidate) {
        const connection = this.connections.get(socketId);
        if (connection && connection.connected) {
            connection.socket.emit('ice-candidate', { candidate });
            console.log(`Sent ICE candidate to ${socketId}`);
        }
    }

    // Send error to client
    sendError(socketId, error) {
        const connection = this.connections.get(socketId);
        if (connection && connection.connected) {
            connection.socket.emit('error', error);
            console.log(`Sent error to ${socketId}:`, error);
        }
    }

    // Send stream status to client
    sendStreamStatus(socketId, status) {
        const connection = this.connections.get(socketId);
        if (connection && connection.connected) {
            connection.socket.emit('stream-status', status);
            console.log(`Sent stream status to ${socketId}:`, status);
        }
    }

    // Broadcast to all connected clients
    broadcast(event, data) {
        this.io.emit(event, data);
    }

    // Get connection count
    getConnectionCount() {
        return this.connections.size;
    }

    // Get all connected socket IDs
    getConnectedClients() {
        return Array.from(this.connections.keys());
    }

    // Close all connections
    close() {
        this.connections.forEach((connection) => {
            if (connection.connected) {
                connection.socket.disconnect();
            }
        });
        this.connections.clear();
        this.io.close();
    }
}

module.exports = WebRTCSignalingServer;
