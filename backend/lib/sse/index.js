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
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Cache-Control'
    });

    clients.add(res);

    res.write(`data: ${JSON.stringify({
      type: 'connection',
      message: 'Connected to SSE stream',
      timestamp: new Date().toISOString()
    })}\n\n`);

    req.on('close', () => {
      clients.delete(res);
      // eslint-disable-next-line no-console
      console.log('Client disconnected. Active connections:', clients.size);
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


