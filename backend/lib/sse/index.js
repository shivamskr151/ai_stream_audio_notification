// Central SSE state
const clients = new Set();

function getActiveConnectionsCount() {
  return clients.size;
}

function broadcastEvent(data) {
  const eventData = `data: ${JSON.stringify(data)}\n\n`;
  clients.forEach(client => {
    try {
      client.write(eventData);
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('Error sending to client:', error);
      clients.delete(client);
    }
  });
}

function registerSseRoute(app) {
  app.get('/events', (req, res) => {
    // Set headers for SSE with proper proxy/HTTPS support
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Cache-Control',
      'Access-Control-Allow-Credentials': 'true',
      'X-Accel-Buffering': 'no', // Disable nginx buffering
      'Content-Encoding': 'none' // Prevent compression
    });

    // Disable compression for this response
    res.socket.setTimeout(0);
    res.socket.setNoDelay(true);
    res.socket.setKeepAlive(true);

    clients.add(res);

    // Send initial connection message
    res.write(`data: ${JSON.stringify({
      type: 'connection',
      message: 'Connected to SSE stream',
      timestamp: new Date().toISOString()
    })}\n\n`);

    // Send periodic heartbeat to keep connection alive
    const heartbeatInterval = setInterval(() => {
      if (clients.has(res)) {
        try {
          res.write(`:heartbeat\n\n`);
        } catch (error) {
          console.error('Error sending heartbeat:', error);
          clearInterval(heartbeatInterval);
          clients.delete(res);
        }
      } else {
        clearInterval(heartbeatInterval);
      }
    }, 30000); // Send heartbeat every 30 seconds

    req.on('close', () => {
      clearInterval(heartbeatInterval);
      clients.delete(res);
      // eslint-disable-next-line no-console
      console.log('Client disconnected. Active connections:', clients.size);
    });

    req.on('error', () => {
      clearInterval(heartbeatInterval);
      clients.delete(res);
    });

    // eslint-disable-next-line no-console
    console.log('New client connected. Active connections:', clients.size);
  });
}

module.exports = {
  registerSseRoute,
  broadcastEvent,
  getActiveConnectionsCount
};


