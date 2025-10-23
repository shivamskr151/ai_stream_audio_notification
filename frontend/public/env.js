// Application configuration
window.__APP_CONFIG__ = {
    // Maximum number of events to display
    maxEvents: 5,
    
    // Maximum number of compact events to show
    maxCompactEvents: 20,
    
    // Default audio volume (0.0 to 1.0)
    volume: 1.0,
    
    // SSE (Server-Sent Events) URL
    sseUrl: '/events',
    
    // Reconnection interval in milliseconds
    reconnectMs: 3000,
    
    // WebRTC streaming configuration
    webrtcEnabled: true,
    streamUrl: '/public/stream/stream.m3u8'
};
