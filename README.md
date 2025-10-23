# AI Audio Notification System

Created by Shivam Kumar

A comprehensive real-time AI audio notification system featuring live video streaming, WebRTC integration, Kafka message processing, and advanced audio controls. The system provides real-time event notifications with Server-Sent Events (SSE), live video streaming capabilities, and intelligent audio management with customizable play modes and duration controls.

## Data Persistence (SQLite via Prisma)

- SQLite is used as the primary datastore through Prisma.
- The connection is configured via `DATABASE_URL` in the backend `.env` (e.g., `file:../prod.db` or `file:./prod.db`).
- Prisma schema: `backend/prisma/schema.prisma`.
- Event CRUD is handled through `backend/services/event.service.js` and exposed via the controller/router.

## Features

### Core Notification System
- **SSE stream**: Live event stream on `/events` with automatic reconnection
- **REST API**: Full CRUD endpoints under `/api/events` with pagination and search
- **Webhook Integration**: External system integration via `/api/webhook` endpoint
- **SQLite + Prisma**: Typed access layer with Event model for data persistence
- **Kafka Integration**: Message processing with KafkaJS for scalable event handling

### Live Video Streaming
- **WebRTC Streaming**: Real-time video streaming with WebRTC technology
- **RTSP Support**: Process RTSP streams and convert to WebRTC for browser compatibility
- **HLS Fallback**: HTTP Live Streaming support for broader compatibility
- **Live Video Controls**: Start/stop streaming with real-time status indicators

### Advanced Audio Management
- **Intelligent Audio Controls**: Multiple play modes (infinite, custom duration)
- **Audio Permission Handling**: Automatic browser audio permission management
- **Web Audio API Fallback**: Programmatic audio generation when files are unavailable
- **Individual Event Controls**: Per-event audio start/stop functionality
- **Temporary Stop Controls**: Configurable audio stop duration with countdown timers
- **Volume Management**: Global and per-event volume controls

### User Interface
- **Modern Responsive Design**: Mobile-friendly interface with real-time updates
- **Live Video Panel**: Integrated video streaming with audio control panel
- **Recent Events Display**: Quick access to most recent events
- **Advanced Search & Filtering**: Real-time search across event types, URLs, and timestamps
- **Pagination System**: Efficient handling of large event datasets
- **Modal Dialogs**: Image preview and configuration dialogs

### System Integration
- **Environment-driven Configuration**: All runtime values configurable via `.env`
- **PM2 Process Management**: Production-ready process management
- **Health Monitoring**: System health endpoints and status monitoring
- **Debug Endpoints**: Database inspection and system debugging tools

## Project Structure

```text
ai_audio_notification/
├── backend/
│   ├── server.js                  # Express server with WebRTC, SSE, and static serving
│   ├── config.js                  # Kafka configuration management
│   ├── ecosystem.config.js        # PM2 configuration for production
│   ├── init_sqlite.sh            # Database initialization script
│   ├── routes/
│   │   ├── events.routes.js       # /api/events routes
│   │   └── webhook.routes.js      # /api/webhook routes
│   ├── controllers/
│   │   ├── event.controller.js    # Event controller (validation + responses)
│   │   └── webhook.controller.js  # Webhook controller for external integrations
│   ├── services/
│   │   ├── app.service.js         # Kafka → DB → SSE bridge service
│   │   └── event.service.js       # Prisma-backed event operations
│   ├── lib/
│   │   ├── sse/                   # SSE helpers (register route, broadcast)
│   │   ├── prisma/                # Prisma client wrapper and service
│   │   ├── kafka/                 # Kafka client, producer, and consumer services
│   │   └── webrtc/                # WebRTC streaming components
│   │       ├── streaming-service.js    # Main WebRTC streaming service
│   │       ├── signaling-server.js     # WebRTC signaling server
│   │       ├── peer-manager.js         # WebRTC peer connection management
│   │       └── rtsp-processor.js      # RTSP to WebRTC conversion
│   ├── prisma/
│   │   └── schema.prisma          # Prisma schema for SQLite
│   ├── public/                    # Backend public files (HLS streams)
│   │   └── stream/               # HLS streaming files
│   ├── postman/
│   │   └── quality_approved.postman_collection.json # API testing collection
│   ├── package.json
│   ├── package-lock.json
│   ├── dev.db                     # SQLite development database
│   └── .env                       # Environment configuration
├── frontend/
│   └── public/
│       ├── index.html             # Main UI with video streaming and audio controls
│       ├── styles.css             # Modern responsive styles
│       ├── app.js                 # SSE client + advanced audio management
│       ├── webrtc-client.js       # WebRTC video streaming client
│       ├── env.js                 # Runtime configuration (generated)
│       ├── placeholder.svg        # Placeholder image
│       └── stream/                # HLS streaming files (fallback)
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

# WebRTC Streaming Configuration
WEBRTC_ENABLED=true
RTSP_URL="rtsp://your-rtsp-server:554/stream"
RTSP_FRAME_RATE=30
RTSP_WIDTH=1280
RTSP_HEIGHT=720
RTSP_BITRATE=2000k
STREAM_URL="/stream/stream.m3u8"

# Kafka Configuration (optional)
KAFKA_BROKER="localhost:9092"
KAFKA_BROKERS="localhost:9092,localhost:9093"

# Webhook Configuration
WEBHOOK_URL="https://webhook.site/REPLACE-WITH-YOUR-UNIQUE-ID"
WEBHOOK_TIMEOUT=10000
WEBHOOK_RETRY_ATTEMPTS=3
WEBHOOK_RETRY_DELAY=1000
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
- WebRTC streaming service with RTSP processing
- Kafka integration for message processing
- Serves static frontend from `frontend/public`
- Frontend runtime config at `GET /env.js` generated from `.env`
- HLS streaming support with `/public` static serving

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
- `services/app.service.js` — Kafka to database to SSE bridge service
- `lib/prisma` — Prisma client initialization/wrapper and service
- `lib/sse` — SSE client management and broadcast helpers
- `lib/kafka` — Kafka client, producer, and consumer services
- `lib/webrtc/streaming-service.js` — Main WebRTC streaming service
- `lib/webrtc/signaling-server.js` — WebRTC signaling server
- `lib/webrtc/peer-manager.js` — WebRTC peer connection management
- `lib/webrtc/rtsp-processor.js` — RTSP to WebRTC conversion

## Frontend (frontend/public/)

### Core Files
- `index.html` — Main page with video streaming, audio controls, and responsive design
- `styles.css` — Modern CSS with responsive layout, animations, and video streaming styles
- `app.js` — SSE client with advanced audio management, pagination, and event controls
- `webrtc-client.js` — WebRTC video streaming client with HLS fallback
- `env.js` — Runtime configuration (generated by backend)

### Key Features
- **Live Video Streaming**: WebRTC video player with start/stop controls
- **Advanced Audio Management**: Multiple play modes (infinite, custom duration)
- **Recent Events Panel**: Quick access to most recent events
- **Audio Control Panel**: Comprehensive audio settings and controls
- **Event History Table**: Paginated event display with search and filtering
- **Modal Dialogs**: Image preview and configuration dialogs
- **Responsive Design**: Mobile-friendly interface with real-time updates

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

### Core Application
- `GET /` — Frontend application with video streaming and audio controls
- `GET /events` — SSE stream for real-time events
- `GET /env.js` — Frontend runtime configuration
- `GET /health` — Health check endpoint
- `GET /debug/db` — Database debug information

### Event Management API
- `GET /api/events` — List events with search and filtering
- `GET /api/events/page` — Paginated event listing
- `GET /api/events/:id` — Get event by ID
- `POST /api/events` — Create new event
- `POST /api/events/upsert` — Create or update event
- `PUT /api/events/:id` — Update existing event
- `DELETE /api/events/:id` — Delete specific event
- `DELETE /api/events` — Delete all events
- `POST /api/webhook` — Webhook endpoint for external integrations

### WebRTC Streaming API
- `GET /api/streaming/status` — Get streaming service status
- `GET /api/streaming/test-rtsp` — Test RTSP connection
- `GET /public/stream/stream.m3u8` — HLS stream endpoint (fallback)

### Static Files
- `GET /public/*` — Backend public files (HLS streams)
- `GET /stream/*` — Frontend stream files (HLS fallback)

## WebRTC Streaming Features

### Features
- **Real-time Video Streaming**: WebRTC-based video streaming with low latency
- **RTSP Integration**: Process RTSP streams and convert to WebRTC for browser compatibility
- **HLS Fallback**: HTTP Live Streaming support for broader device compatibility
- **Streaming Controls**: Start/stop streaming with real-time status indicators
- **Connection Management**: Automatic reconnection and error handling

### Configuration
- Set `WEBRTC_ENABLED=true` in your `.env` file
- Configure `RTSP_URL` to point to your RTSP stream source
- Adjust streaming parameters (frame rate, resolution, bitrate) as needed
- The system will automatically start the streaming service on server startup

### Usage
1. Navigate to the application in your browser
2. The video streaming section will appear if WebRTC is enabled
3. Click "Start Stream" to begin video streaming
4. Use "Stop Stream" to halt the video feed
5. Monitor connection status through the status indicators

## Browser Compatibility

- SSE, Web Audio API, WebRTC, and modern CSS are supported in all modern browsers (Chrome, Firefox, Safari, Edge).
- WebRTC requires HTTPS in production environments.
- HLS fallback ensures compatibility with older browsers and devices.

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
6. Verify `SSE_URL` matches server endpoint
7. Verify server status at `http://localhost:4021/health` (or `curl -s http://localhost:4021/health`)

### WebRTC Streaming Issues

1. **Video Not Loading**:
   - Check that `WEBRTC_ENABLED=true` in your `.env` file
   - Verify `RTSP_URL` is correct and accessible
   - Check browser console for WebRTC errors
   - Ensure RTSP stream is active and accessible

2. **Streaming Connection Problems**:
   - Test RTSP connection using `/api/streaming/test-rtsp` endpoint
   - Check streaming status via `/api/streaming/status` endpoint
   - Verify firewall settings for RTSP port (usually 554)
   - Check server logs for streaming service errors

3. **Browser Compatibility**:
   - WebRTC requires HTTPS in production
   - Some browsers may require user interaction before allowing video
   - Try different browsers if WebRTC fails
   - HLS fallback should work in most browsers

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
