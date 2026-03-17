# 🌊 OpenWave Messenger

A production-grade, open-source messenger built exactly like Telegram.
Real-time messaging · WebSocket-driven · JWT auth · SQLite · File sharing · Group chats

---

## Tech Stack

| Layer | Technology | Why (same reason as Telegram) |
|---|---|---|
| **Backend Language** | Node.js | Fast I/O, massive concurrency |
| **Real-time** | WebSockets (ws) | Persistent connections, same as MTProto transport |
| **Database** | SQLite (WAL mode) | Telegram uses SQLite on clients; WAL = concurrent reads |
| **Auth** | JWT (RS256 in prod) | Stateless, scales horizontally |
| **Media** | Multer + local/S3 | Swap to S3/R2 for prod CDN |
| **Frontend** | Vanilla JS + HTML | Zero build step, fast load |
| **Container** | Docker + Compose | Deploy anywhere |

---

## Features

- ✅ User registration & login (JWT, bcrypt)
- ✅ Direct messages (1:1)
- ✅ Group chats with roles (owner / admin / member)
- ✅ Real-time delivery via WebSockets
- ✅ Typing indicators (live)
- ✅ Online/offline presence
- ✅ Message delivery receipts (✓ / ✓✓)
- ✅ Read receipts
- ✅ Reply to messages
- ✅ Edit & delete messages
- ✅ File & image sharing (up to 50 MB)
- ✅ Chat search
- ✅ User profile with avatar
- ✅ Dark mode (Telegram-style dark theme)
- ✅ Browser push notifications
- ✅ Mobile responsive
- ✅ WAL-mode SQLite (high-performance)
- ✅ Docker deployment

---

## Quick Start

### Option 1 — Docker (recommended)

```bash
git clone https://github.com/yourname/openwave
cd openwave

cp .env.example .env
# Edit .env and set JWT_SECRET to a random string

docker-compose up -d
# Open http://localhost:4000
```

### Option 2 — Run locally

```bash
cd openwave/backend
npm install
node server.js
# Open http://localhost:4000
```

---

## Project Structure

```
openwave/
├── backend/
│   ├── server.js           # Express + HTTP server entry
│   ├── db.js               # SQLite schema + prepared statements
│   ├── ws.js               # WebSocket hub (presence, typing, push)
│   ├── middleware/
│   │   └── auth.js         # JWT middleware
│   └── routes/
│       ├── auth.js         # /api/auth/register, /login, /me
│       └── api.js          # /api/users, /api/chats, /api/messages
├── frontend/
│   ├── index.html          # App shell
│   ├── css/
│   │   ├── main.css        # All UI components
│   │   └── theme.css       # Light + Dark CSS variables
│   └── js/
│       ├── api.js          # REST API client
│       ├── ws.js           # WebSocket client (auto-reconnect)
│       ├── ui.js           # UI helpers (avatars, time, themes)
│       └── app.js          # Main app controller
├── Dockerfile
├── docker-compose.yml
└── .env.example
```

---

## API Reference

### Auth
| Method | Endpoint | Body |
|---|---|---|
| POST | `/api/auth/register` | `{ username, display_name, password, phone? }` |
| POST | `/api/auth/login` | `{ username, password }` |
| GET | `/api/auth/me` | — |

### Users
| Method | Endpoint | |
|---|---|---|
| GET | `/api/users/search?q=` | Search users |
| PATCH | `/api/users/me` | Update profile |

### Chats
| Method | Endpoint | |
|---|---|---|
| GET | `/api/chats` | Get all chats |
| POST | `/api/chats/direct` | `{ user_id }` — open/find DM |
| POST | `/api/chats/group` | `{ name, member_ids[] }` |

### Messages
| Method | Endpoint | |
|---|---|---|
| GET | `/api/chats/:id/messages` | Load history |
| POST | `/api/chats/:id/messages` | `{ content, type, reply_to? }` |
| PATCH | `/api/messages/:id` | Edit |
| DELETE | `/api/messages/:id` | Delete |
| POST | `/api/messages/:id/read` | Mark read |

### WebSocket Events (client → server)
```json
{ "type": "typing_start", "chat_id": "..." }
{ "type": "typing_stop",  "chat_id": "..." }
{ "type": "read_receipt", "message_id": "..." }
{ "type": "join_chat",    "chat_id": "..." }
{ "type": "leave_chat" }
```

### WebSocket Events (server → client)
```json
{ "type": "new_message",    "message": {...}, "chat_id": "..." }
{ "type": "message_edited", "message": {...} }
{ "type": "message_deleted","message_id": "..." }
{ "type": "typing_start",   "chat_id": "...", "user_id": "...", "display_name": "..." }
{ "type": "presence",       "user_id": "...", "status": "online|offline" }
{ "type": "message_read",   "message_id": "...", "reader_id": "..." }
```

---

## Production Hardening

To make this fully production-ready, add:

1. **TLS** — Put behind Nginx or Caddy with HTTPS
2. **PostgreSQL** — Replace SQLite with pg for multi-node
3. **Redis** — For WS session state across nodes (pub/sub)
4. **S3/R2** — Replace local file storage with object storage
5. **Rate limiting** — Add `express-rate-limit` on auth routes
6. **E2E Encryption** — Add Signal Protocol via `@signalapp/libsignal-client`
7. **Push notifications** — Firebase FCM for mobile
8. **Nginx config**:

```nginx
server {
    listen 443 ssl;
    server_name yourdomain.com;

    location / {
        proxy_pass http://localhost:4000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_read_timeout 86400;
    }
}
```

---

## License

MIT — free to use, modify, and deploy.
