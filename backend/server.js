// backend/server.js

const express = require('express');
const path = require('path');
const cors = require('cors');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const eventsRouter = require('./routes/events.routes');
const { registerSseRoute } = require('./lib/sse');
const webhookRouter = require('./routes/webhook.routes');


const app = express();

app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

// Log database URL for debugging
if (process.env.DATABASE_URL) {
	console.log('Using DATABASE_URL:', process.env.DATABASE_URL);
} else {
	console.warn('DATABASE_URL is not set. Prisma will fail to query the database.');
}

// Health
app.get('/health', (req, res) => res.json({ status: 'ok' }));

// API routes
app.use('/api/events', eventsRouter);
app.use('/api/webhook', webhookRouter);

// Debug route to inspect DB tables
try {
	const { prismaService } = require('./lib/prisma');
	app.get('/debug/db', async (req, res) => {
		try {
			const rows = await prismaService.$queryRaw`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`;
			res.json({ databaseUrl: process.env.DATABASE_URL || null, tables: rows });
		} catch (e) {
			res.status(500).json({ error: e.message, databaseUrl: process.env.DATABASE_URL || null });
		}
	});
} catch (_) {}

// SSE endpoint
registerSseRoute(app);

// Serve frontend build from frontend/public
const publicDir = path.join(__dirname, '..', 'frontend', 'public');
app.use(express.static(publicDir));

// env.js for frontend config
app.get('/env.js', (req, res) => {
  res.type('application/javascript');
  const cfg = {
    sseUrl: process.env.SSE_URL,
    maxEvents: Number(process.env.MAX_EVENTS),
    maxCompactEvents: Number(process.env.MAX_COMPACT_EVENTS),
    reconnectMs: Number(process.env.SSE_RECONNECT_MS),
    volume: Number(process.env.DEFAULT_VOLUME)
  };
  res.send(`window.__APP_CONFIG__ = ${JSON.stringify(cfg)};`);
});

// SPA fallback to index.html
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api') || req.path.startsWith('/events')) return next();
  res.sendFile(path.join(publicDir, 'index.html'));
});

const PORT = Number(process.env.PORT);
const server = app.listen(PORT, () => {
	console.log(`Server listening on http://localhost:${PORT}`);
});

// Start background Kafka -> SSE bridge
// const service = new AppService();
// service.start().catch(err => {
//   console.error('Failed to start AppService:', err);
//   process.exitCode = 1;
// });


process.on('SIGINT', async () => {
  try { await service.stop(); } catch (_) {}
  server.close(() => process.exit(0));
});


