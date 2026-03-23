<div align="center">

# 🌊 OpenWave

**A private, invite-only messenger built for real use.**

![Node.js](https://img.shields.io/badge/Node.js-20+-339933?style=flat-square&logo=node.js&logoColor=white)
![License](https://img.shields.io/badge/license-MIT-blue?style=flat-square)
![Status](https://img.shields.io/badge/status-production-brightgreen?style=flat-square)

</div>

---

OpenWave is a full-stack real-time messenger. It is invite-only by design — no one can join without a link you generate. Built to be self-hosted, open-source, and dependency-light.

## Features

- Real-time messaging over WebSockets
- Direct messages and group chats
- File and image sharing (up to 50 MB)
- Typing indicators, read receipts, online presence
- Reply, edit, and delete messages
- Invite-only registration with single-use expiring links
- PWA — installable on Android and iOS like a native app
- Dark and light mode
- Mobile-first UI, works on desktop too

## Stack

| Layer | Technology |
|---|---|
| Server | Node.js + Express |
| Real-time | WebSockets (`ws`) |
| Database | [Turso](https://turso.tech) (cloud SQLite) |
| File storage | [Cloudinary](https://cloudinary.com) |
| Auth | JWT + bcrypt |
| Frontend | Vanilla HTML/CSS/JS |
| Hosting | Railway / any Node host |

## Self-hosting

### Requirements

- Node.js 18+
- A free [Turso](https://turso.tech) account
- A free [Cloudinary](https://cloudinary.com) account

### Setup

```bash
git clone https://github.com/shubhamkhidwalia/openwave-messenger
cd openwave-messenger/openwave/backend
npm install
cp ../../.env.example .env
# fill in .env
npm start
```

Open `http://localhost:4000`

### Environment variables

Copy `.env.example` to `backend/.env` and fill in:

```env
JWT_SECRET=           # random 64-char string
ADMIN_SECRET=         # your admin password
TURSO_URL=            # libsql://your-db.turso.io
TURSO_TOKEN=          # turso auth token
CLOUDINARY_NAME=      # cloudinary cloud name
CLOUDINARY_KEY=       # cloudinary api key
CLOUDINARY_SECRET=    # cloudinary api secret
APP_URL=              # your public URL
```

## Inviting users

Only you can add people. Run this from any terminal:

```bash
curl -X POST https://your-domain.com/api/admin/invite \
  -H "x-admin-secret: YOUR_ADMIN_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"expires_days": 7}'
```

Returns a link. Send it to whoever you want to invite. Each link is single-use.

To list all invites and see who used them:

```bash
curl https://your-domain.com/api/admin/invites \
  -H "x-admin-secret: YOUR_ADMIN_SECRET"
```

## Deploying

### Railway (recommended)

1. Fork this repo
2. Create a new project on [Railway](https://railway.com) from your fork
3. Set root directory to `openwave`
4. Add all environment variables
5. Deploy — Railway auto-detects the Dockerfile

### Docker

```bash
docker compose up -d
```

## Limitations

- No end-to-end encryption — messages are encrypted in transit (HTTPS) but not E2E
- No message search
- No voice or video calls
- File uploads require Cloudinary (no built-in object storage)

## License

MIT © [Shubham Khidwalia](https://github.com/shubhamkhidwalia)
