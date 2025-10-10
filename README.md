# Quality Assurance - Real-time Event Notifications

Created by Shivam Kumar

A real-time notification system using Server-Sent Events (SSE) backed by a SQLite/Prisma data model, with optional Kafka integration. The backend exposes REST APIs for events, streams live events over SSE, and serves a static frontend UI.

## Data Persistence (SQLite via Prisma)

- SQLite is used as the primary datastore through Prisma.
- The connection is configured via `DATABASE_URL` in the backend `.env` (e.g., `file:../prod.db` or `file:./prod.db`).
- Prisma schema: `backend/prisma/schema.prisma`.
- Event CRUD is handled through `backend/services/event.service.js` and exposed via the controller/router.

## Features

- **SSE stream**: Live event stream on `/events`.
- **REST API**: CRUD endpoints under `/api/events`, plus a paginated listing.
- **Webhook Integration**: External system integration via `/api/webhook` endpoint.
- **SQLite + Prisma**: Typed access layer with relations (e.g., absolute bounding boxes).
- **Optional Kafka**: Consume from Kafka and forward to DB + SSE; optional producer on updates.
- **Frontend UI**: Static SPA served from `frontend/public` with configuration from `/env.js`.
- **Audio Notifications**: Custom audio files with Web Audio API fallback.
- **Environment-driven config**: All runtime values provided via `.env`.

## Project Structure

```text
qa-real-time-events/
├── backend/
│   ├── server.js                  # Express server, routes, SSE registration, static serving
│   ├── config.js                  # Configuration management
│   ├── ecosystem.config.js        # PM2 configuration
│   ├── init_sqlite.sh            # Database initialization script
│   ├── routes/
│   │   ├── events.routes.js       # /api/events routes
│   │   └── webhook.routes.js      # /api/webhook routes
│   ├── controllers/
│   │   ├── event.controller.js    # Event controller (validation + responses)
│   │   └── webhook.controller.js  # Webhook controller for external integrations
│   ├── services/
│   │   ├── app.service.js         # Kafka → DB → SSE bridge
│   │   └── event.service.js       # Prisma-backed event operations
│   ├── lib/
│   │   ├── sse/                   # SSE helpers (register route, broadcast)
│   │   ├── prisma/                # Prisma client wrapper
│   │   ├── kafka/                 # Kafka client/producer/consumer
│   │   └── webhook/               # Webhook utilities (future expansion)
│   ├── prisma/
│   │   └── schema.prisma          # Prisma schema for SQLite
│   ├── postman/
│   │   └── quality_approved.postman_collection.json # API testing collection
│   ├── package.json
│   ├── package-lock.json
│   ├── dev.db                     # SQLite development database
│   └── .env                       # Environment configuration
├── frontend/
│   └── public/
│       ├── index.html             # Main UI
│       ├── styles.css             # Styles
│       ├── app.js                 # SSE client + UI logic
│       ├── audio-generator.js     # Web Audio API fallback for notifications
│       ├── notification.wav       # Audio notification file
│       └── placeholder.svg        # Placeholder image
└── README.md
```

## Quick Start

### 1) Install Dependencies

```bash
cd backend && npm install
```

**Note**: The frontend is a static application served by the backend, so no separate frontend installation is required.

### 2) Configure Environment (backend/.env)

Create `backend/.env` with the following configuration:

```env
# Database Configuration
DATABASE_URL="file:./dev.db"

# Server Configuration
PORT=4021

# SSE Configuration
SSE_URL="http://localhost:4021/events"
MAX_EVENTS=1000
MAX_COMPACT_EVENTS=100
SSE_RECONNECT_MS=3000
DEFAULT_VOLUME=0.5

# Webhook Configuration
WEBHOOK_URL="https://webhook.site/REPLACE-WITH-YOUR-UNIQUE-ID"
WEBHOOK_TIMEOUT=10000
WEBHOOK_RETRY_ATTEMPTS=3
WEBHOOK_RETRY_DELAY=1000

# Optional Kafka (leave unset to disable)
# KAFKA_BROKER=localhost:9092
# KAFKA_CONSUMER_TOPIC=events
# KAFKA_PRODUCER_TOPIC=events-updates
# KAFKA_GROUP_ID=qa-service
```

### 3) Start the Server

```bash
cd backend
npm run dev   # development with nodemon
# npm start   # production
```

### 4) Open the Application

Navigate to `http://localhost:4021` (or the port specified in your `.env` file).

## Backend Overview

### Server (`backend/server.js`)

- Express app with CORS and JSON parsing
- Health endpoint: `GET /health`
- REST routes mounted at `GET/POST/PUT/DELETE /api/events`
- SSE route registered by `registerSseRoute(app)` at `/events`
- Serves static frontend from `frontend/public`
- Frontend runtime config at `GET /env.js` generated from `.env`

### Events API (`/api/events`)

- `GET /api/events` — List events (supports `page`, `pageSize`, `limit`, `severity`, `sensor_id`, `status`)
- `GET /api/events/page` — Paginated list with `{ events, page, totalPages, totalCount, pageSize }`
- `GET /api/events/:id` — Get event by id
- `POST /api/events` — Create event (supports `absolute_bbox` array)
- `PUT /api/events/:id` — Update event (also optionally produces Kafka message if configured)
- `DELETE /api/events/:id` — Delete event

### Webhook API (`/api/webhook`)

- `POST /api/webhook` — Receive webhook data from external systems
  - Accepts JSON payload with event data
  - Automatically saves to database and broadcasts via SSE
  - Returns success confirmation with saved event details

### Services and Libraries

- `services/event.service.js` — Event CRUD via Prisma, bbox serialization helpers
- `services/app.service.js` — Kafka consumer that saves events and broadcasts over SSE
- `lib/prisma` — Prisma client initialization/wrapper
- `lib/kafka` — Kafka client, consumer, and producer services
- `lib/sse` — SSE client management and broadcast helpers

## Frontend (frontend/public/)

- `index.html` — Main page
- `styles.css` — Styles
- `app.js` — Connects to `/events`, renders events, uses `window.__APP_CONFIG__` from `/env.js`

### Event Data Structure (example)

```json
{
  "id": "uuid-string",
  "audio_url": "https://example.com/notification.wav",
  "image_url": "https://example.com/event-image.jpg",
  "timestamp": "2025-01-15T10:30:00.000Z",
  "event_type": "PPE",
  "created_at": "2025-01-15T10:30:00.000Z",
  "updated_at": "2025-01-15T10:30:00.000Z"
}
```

### Database Schema

The application uses SQLite with Prisma ORM. The main `Event` model includes:

- `id`: String (UUID) - Primary key
- `audio_url`: String - URL to audio notification file
- `image_url`: String - URL to event image/thumbnail
- `timestamp`: DateTime - When the event occurred
- `event_type`: String - Type of event (e.g., "PPE", "fire_and_smoke")
- `created_at`: DateTime - Record creation timestamp
- `updated_at`: DateTime - Last update timestamp

**Connection event** (sent on SSE connect):

```json
{
  "type": "connection",
  "message": "Connected to SSE stream",
  "timestamp": "2024-01-15T10:30:00.000Z"
}
```

## UI Notes

- The UI connects to `/events` and auto-reconnects based on `/env.js` values.
- Global settings like volume, max events, and reconnect timing are provided by the backend via `/env.js`.

## User Interface

The application features a modern, responsive interface with the following components:

### Main Interface

- **Header**: Shows connection status with visual indicator, title, and stop countdown timer
- **Events Table**: Displays recent events in a structured table format with pagination controls
- **Search Bar**: Filter events by content, URLs, and timestamps
- **Audio Controls**: Global volume control (inline with toolbar)
- **Toolbar**: Search functionality and filter toggle button

### Event Table

Each event displays in table format:

- **Date & Time**: Formatted timestamp of the event
- **Event Category**: Type of event (e.g., PPE, fire_and_smoke, etc.)
- **Image / Audio**: Thumbnail preview and audio controls
- **Actions**: Start/stop audio buttons for individual events

### Pagination System

- **Page Navigation**: Previous, Next buttons with page numbers
- **Page Size**: Fixed at 10 items per page
- **Page Info**: Current page and total pages display

### Modal Features

- **Image Preview**: Click any image to view in full-screen modal
- **Stop Duration**: Modal dialog for configuring audio stop duration
- **Responsive Design**: Works on desktop and mobile devices

## Customization

### Adding Custom Audio Files

Place your audio files in the `frontend/public/` directory:

- `notification.mp3` (recommended)
- `notification.wav` (fallback)

**Audio Fallback**: If audio files are not available, the application includes a Web Audio API fallback (`audio-generator.js`) that generates a pleasant two-tone notification sound programmatically.

### Modifying Event Frequency

Set `SSE_INTERVAL_MS` in `.env` (e.g., `SSE_INTERVAL_MS=10000` for 10 seconds). No code changes required. Default is 60 seconds.

### Customizing Event Data

The server generates events by reading from the SQLite database. To customize event data:

1. **Database Events**: Events are generated from the most recent database entry
2. **Fallback Events**: If database is empty, generates placeholder events with default URLs
3. **Event Types**: Configure `EVENT_TYPES` in `.env` to cycle through different event types
4. **Custom URLs**: Modify the database directly or implement custom event generation logic

### Webhook Integration

The application supports webhook integration for external systems:

1. **Endpoint**: `POST /api/webhook`
2. **Payload**: JSON data with event information
3. **Processing**: Automatically saves to database and broadcasts via SSE
4. **Response**: Returns success confirmation with saved event details

Example webhook payload:

```json
{
  "audio_url": "https://example.com/notification.wav",
  "image_url": "https://example.com/event-image.jpg",
  "timestamp": "2025-01-15T10:30:00.000Z",
  "event_type": "PPE"
}
```

## Endpoints

- `GET /` — Frontend
- `GET /events` — SSE stream
- `GET /env.js` — Frontend runtime config
- `GET /health` — Health check
- `GET /debug/db` — Database debug information
- `GET /api/events` — List events
- `GET /api/events/page` — Paginated listing
- `GET /api/events/:id` — Get by ID
- `POST /api/events` — Create event
- `PUT /api/events/:id` — Update event
- `DELETE /api/events/:id` — Delete event
- `POST /api/webhook` — Webhook endpoint for external integrations

## Browser Compatibility

- SSE, Web Audio API, and modern CSS are supported in all modern browsers (Chrome, Firefox, Safari, Edge).

## Development

Run the backend in watch mode using `npm run dev` (nodemon). The frontend is static and served by the backend.

### Testing

1. Open multiple browser tabs to test concurrent SSE clients
2. Check browser console and network tab for SSE
3. Hit `/health` to verify server status

### API Testing with Postman

A Postman collection is included in `backend/postman/quality_approved.postman_collection.json` for testing all API endpoints:

1. Import the collection into Postman
2. Update the base URL to match your server (default: `http://localhost:4021`)
3. Test all CRUD operations for events
4. Test webhook integration
5. Verify SSE stream connectivity

## Troubleshooting

### Audio Not Playing

1. Check browser audio permissions (click to allow audio)
2. Ensure audio files are in the `frontend/public/` directory
3. Check browser console for audio errors
4. The fallback Web Audio API will work if audio files fail
5. Try clicking the "Start" button on individual events
6. Check that volume slider is not set to 0

### Connection Issues

1. Check that the server is running on the port set in `PORT`
2. Verify no firewall is blocking the connection
3. Check browser console for SSE errors
4. Try refreshing the page and reconnecting
5. Check `/health` endpoint to see active connections
6. Verify `FRONTEND_SSE_URL` matches server endpoint
7. Verify server status at `http://localhost:4021/health` (or `curl -s http://localhost:4021/health`)

### Database Issues

1. Verify `DATABASE_URL` in `backend/.env`
2. Check server logs for Prisma errors
3. Ensure the SQLite file path is writable

### Config Not Applying

1. Ensure `backend/.env` exists and values are set correctly
2. Restart the server after changing `.env`
3. Visit `/env.js` to inspect live frontend config

### UI Issues

1. Clear browser cache if UI doesn't update
2. Check that all CSS and JS files are loading
3. Try different page sizes if pagination seems broken
4. Use browser dev tools to check for JavaScript errors

### Performance

- The application is optimized for multiple concurrent connections
- Events are paginated to handle large datasets efficiently
- Audio is preloaded for better performance
- Database queries are optimized with prepared statements

## Deployment

Consider the following for production:

1. **Process Manager**: PM2 or systemd

   ```bash
   pm2 start backend/server.js --name qa-server
   pm2 startup
   pm2 save
   ```

2. **Reverse Proxy**: nginx/Apache with TLS
3. **Environment Variables**: Configure `backend/.env`
4. **Monitoring**: Health checks and logging

### Database Management

```bash
# Create backup before deployment (adjust path if your DATABASE_URL uses a different file)
cp backend/dev.db backend/dev_backup_$(date +%Y%m%d_%H%M%S).db

# Check database tables via debug endpoint
curl -s http://localhost:4021/debug/db | jq .

# Reset database (WARNING: deletes data)
rm backend/dev.db
# Then restart the server; Prisma will recreate tables on next run
```

## License

MIT License.
