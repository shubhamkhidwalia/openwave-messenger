# 🌊 OpenWave Messenger

Private. Invite-only. Yours.

![Status](https://img.shields.io/badge/status-production-brightgreen?style=flat-square)
![License](https://img.shields.io/badge/license-MIT-blue?style=flat-square)

OpenWave is a self-hosted real-time messenger. No phone number required. No ads. No strangers — every user is personally invited by you.

## Stack
Node.js · Express · WebSockets · Turso (cloud SQLite) · Cloudinary · Vanilla JS PWA · Railway

## Quick start
```bash
cd openwave/backend && npm install
cp ../.env.example .env  # fill in your values
npm start  # open http://localhost:4000
```

## Generate your first invite
```bash
curl -X POST https://your-app.up.railway.app/api/admin/invite \
  -H "x-admin-secret: YOUR_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"expires_days": 7}'
```

## License
MIT © Shubham Khidwalia
