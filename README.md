# QualityAssurance - Real-time Event Notifications

Created by Shivam Kumar

A real-time notification system using Server-Sent Events (SSE) backed by a SQLite/Prisma data model. The backend exposes REST APIs for events, streams live events over SSE, and serves a static frontend UI with pagination, search, and audio controls.

## Data Persistence (SQLite via Prisma)

- SQLite is used as the primary datastore through Prisma.
- The connection is configured via `DATABASE_URL` in the backend `.env` (e.g., `file:../prod.db` or `file:./prod.db`).
- Prisma schema: `backend/prisma/schema.prisma`.
- Event CRUD is handled through `backend/services/event.service.js` and exposed via the controller/router.

## Features

- **SSE stream**: Live event stream on `/events` with automatic reconnection.
- **REST API**: Full CRUD endpoints under `/api/events` with pagination and search.
- **Webhook Integration**: External system integration via `/api/webhook` endpoint.
- **SQLite + Prisma**: Typed access layer with simple Event model.
- **Frontend UI**: Modern responsive interface with pagination, search, and audio controls.
- **Audio Notifications**: Custom audio files with Web Audio API fallback and individual event controls.
- **Search & Filtering**: Real-time search across event types, URLs, and timestamps.
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

# Additional Configuration (optional)
# MAX_EVENTS=1000
# MAX_COMPACT_EVENTS=100
# SSE_RECONNECT_MS=3000
# DEFAULT_VOLUME=0.5
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

- `GET /api/events` — List events (supports `page`, `pageSize`, `limit`, `event_type`, `search`)
- `GET /api/events/page` — Paginated list with `{ events, page, totalPages, totalCount, pageSize }`
- `GET /api/events/:id` — Get event by id
- `POST /api/events` — Create event
- `POST /api/events/upsert` — Create or update event by image_url or audio_url
- `PUT /api/events/:id` — Update event
- `DELETE /api/events/:id` — Delete event
- `DELETE /api/events` — Delete all events

### Webhook API (`/api/webhook`)

- `POST /api/webhook` — Receive webhook data from external systems
  - Accepts JSON payload with event data
  - Automatically saves to database and broadcasts via SSE
  - Returns success confirmation with saved event details

### Services and Libraries

- `services/event.service.js` — Event CRUD via Prisma with search and pagination
- `lib/prisma` — Prisma client initialization/wrapper
- `lib/sse` — SSE client management and broadcast helpers

## Frontend (frontend/public/)

- `index.html` — Main page with responsive design and modal dialogs
- `styles.css` — Modern CSS with responsive layout and animations
- `app.js` — SSE client with pagination, search, audio controls, and event management
- `audio-generator.js` — Web Audio API fallback for notifications

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

The schema is defined in `backend/prisma/schema.prisma` and uses Prisma's SQLite provider.

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
- **Events Table**: Displays events in a structured table format with pagination controls
- **Search Bar**: Real-time search across event types, URLs, and timestamps
- **Connection Status**: Visual indicator showing SSE connection state
- **Stop Timer**: Shows countdown when audio is temporarily stopped

### Event Table

Each event displays in table format:

- **Date & Time**: Formatted timestamp of the event
- **Event Category**: Type of event (e.g., PPE, fire_and_smoke, etc.)
- **Image / Audio**: Media buttons for viewing images and playing audio
- **Actions**: Individual start/stop audio buttons for each event

### Pagination System

- **Page Navigation**: Previous, Next buttons with smart page numbering
- **Page Size**: Configurable (default 5 items per page)
- **Page Info**: Current page and total pages display with ellipsis for large datasets
- **Search Integration**: Pagination works with search results

### Modal Features

- **Image Preview**: Click any image button to view in full-screen modal
- **Stop Duration**: Modal dialog for configuring temporary audio stop duration
- **Responsive Design**: Works on desktop and mobile devices

### Audio Controls

- **Individual Event Controls**: Each event has its own start/stop buttons
- **Temporary Stop**: Stop audio for a configurable duration with countdown timer
- **Audio Fallback**: Web Audio API generates notification sounds if audio files fail
- **Volume Control**: Global volume slider for all audio playback

## Customization

### Adding Custom Audio Files

Place your audio files in the `frontend/public/` directory:

- `notification.mp3` (recommended)
- `notification.wav` (fallback)

**Audio Fallback**: If audio files are not available, the application includes a Web Audio API fallback (`audio-generator.js`) that generates a pleasant two-tone notification sound programmatically.

### Modifying Event Behavior

Events are generated from the SQLite database and broadcast via SSE. To customize event data:

1. **Database Events**: Events are read from the database and broadcast in real-time
2. **Webhook Integration**: External systems can send events via `/api/webhook`
3. **Event Types**: Configure different event types in your data
4. **Custom URLs**: Modify the database directly or use the API endpoints

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

- `GET /` — Frontend application
- `GET /events` — SSE stream for real-time events
- `GET /env.js` — Frontend runtime configuration
- `GET /health` — Health check endpoint
- `GET /debug/db` — Database debug information
- `GET /api/events` — List events with search and filtering
- `GET /api/events/page` — Paginated event listing
- `GET /api/events/:id` — Get event by ID
- `POST /api/events` — Create new event
- `POST /api/events/upsert` — Create or update event
- `PUT /api/events/:id` — Update existing event
- `DELETE /api/events/:id` — Delete specific event
- `DELETE /api/events` — Delete all events
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

- The application is optimized for multiple concurrent SSE connections
- Events are paginated to handle large datasets efficiently
- Audio is preloaded for better performance
- Database queries are optimized with Prisma ORM
- Search functionality uses database-level filtering for better performance

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

# Generate Prisma client after schema changes
cd backend && npm run prisma:generate
```

## License

MIT License.
