# OpenWave Messenger

A fast, secure, invite-only messenger app built from scratch. Real-time messaging with WebSockets, cloud database, and cloud file storage — no data stored locally.

## What it does

- Real-time messaging between users with instant delivery
- Direct messages and group chats
- File and image sharing
- Typing indicators and online presence
- Message replies, edits, and deletes
- Read receipts (✓ delivered, ✓✓ read)
- Dark and light mode
- Invite-only registration — only people you invite can join
- Works on any device through the browser

## How it works

The app has three parts working together. The backend is a Node.js server that handles all logic — authentication, message routing, and real-time events. The frontend is plain HTML, CSS, and JavaScript that runs in the browser. The database is Turso (cloud SQLite) which stores all users, messages, and chats remotely. File uploads go to Cloudinary so nothing is stored on the server's disk.

When you send a message, it goes to the server over HTTP, gets saved to the database, and is instantly pushed to the recipient through an open WebSocket connection. This is the same architecture used by production messaging apps.

Registration is invite-only. The server generates one-time invite links that you share with people you want to let in. Each link can only be used once and expires after a set number of days.

## Tech stack

- **Runtime** — Node.js
- **Server** — Express
- **Real-time** — WebSockets (ws)
- **Database** — Turso (cloud SQLite via libSQL)
- **File storage** — Cloudinary
- **Auth** — JWT tokens + bcrypt password hashing
- **Frontend** — Vanilla HTML, CSS, JavaScript (no framework)
- **Hosting** — Railway

## Capabilities

- Unlimited users (within Turso's free 500 MB — enough for millions of messages)
- Up to 50 MB per file upload
- 25 GB total file storage on Cloudinary free tier
- Multiple devices per user (open on phone and laptop simultaneously)
- Groups with owner, admin, and member roles
- User profiles with avatars
- Browser push notifications

## Limitations

- No end-to-end encryption — messages are encrypted in transit (HTTPS/WSS) but readable by the server. Do not use for sensitive communications.
- No message search yet
- No voice or video calls
- No message forwarding
- File uploads are permanent on Cloudinary — no delete from storage yet
- Railway free tier ($5/month credit) will suspend the app if credit runs out

## Running locally

```
cd backend
npm install
cp ../.env.example .env
# fill in .env with your Turso, Cloudinary credentials
npm start
```

Open `http://localhost:4000`

## Generating invite links

```
curl -X POST https://your-domain.up.railway.app/api/admin/invite \
  -H "x-admin-secret: YOUR_ADMIN_SECRET" \
  -H "Content-Type: application/json" \
  -d "{\"expires_days\": 7}"
```

Send the returned link to whoever you want to invite. Each link works once.

## Environment variables

| Variable | What it is |
|---|---|
| `JWT_SECRET` | Secret key for signing login tokens |
| `ADMIN_SECRET` | Your password for generating invite links |
| `TURSO_URL` | Your Turso database URL |
| `TURSO_TOKEN` | Your Turso auth token |
| `CLOUDINARY_NAME` | Cloudinary cloud name |
| `CLOUDINARY_KEY` | Cloudinary API key |
| `CLOUDINARY_SECRET` | Cloudinary API secret |
| `APP_URL` | Your deployed app URL |

## License

MIT
