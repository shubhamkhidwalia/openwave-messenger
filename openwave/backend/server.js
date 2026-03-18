require('dotenv').config();
const express = require('express');
const http    = require('http');
const cors    = require('cors');
const path    = require('path');
const fs      = require('fs');

const app    = express();
const server = http.createServer(app);

// WebSocket (must attach before routes)
const ws = require('./ws');
ws.setup(server);

// ── Core middleware ───────────────────────────────────────────────────────────
app.use(cors({
  origin: process.env.CLIENT_ORIGIN || '*',
  methods: ['GET','POST','PATCH','DELETE','OPTIONS'],
  allowedHeaders: ['Content-Type','Authorization','x-admin-secret'],
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ── File uploads (Cloudinary in prod, local disk in dev) ──────────────────────
const { uploadMiddleware } = require('./upload');
uploadMiddleware(app);

// ── API routes ────────────────────────────────────────────────────────────────
app.use('/api/auth',  require('./routes/auth'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api',       require('./routes/api'));

// ── Validate invite (called by frontend before showing register form) ─────────
const { q, initSchema } = require('./db');
app.get('/api/invite/:code', async (req, res) => {
  const invite = await q.getInvite(req.params.code).catch(() => null);
  if (!invite)            return res.status(404).json({ valid: false, error: 'Invalid invite code' });
  if (invite.used_by)     return res.status(410).json({ valid: false, error: 'This invite has already been used' });
  if (invite.expires_at && invite.expires_at < Math.floor(Date.now()/1000))
                          return res.status(410).json({ valid: false, error: 'This invite has expired' });
  res.json({ valid: true });
});

// ── Health check ──────────────────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({
    status:   'ok',
    ts:       Date.now(),
    online:   ws.getOnlineUsers().length,
    storage:  process.env.CLOUDINARY_NAME ? 'cloudinary' : 'local',
    database: process.env.TURSO_URL && !process.env.TURSO_URL.startsWith('file:') ? 'turso' : 'local-sqlite',
  });
});

// ── Serve frontend (SPA — all unknown paths → index.html) ────────────────────
// Check both: local dev (../frontend) and Docker (./frontend)
const FRONTEND_DEV    = path.join(__dirname, '..', 'frontend');
const FRONTEND_DOCKER = path.join(__dirname, 'frontend');
const FRONTEND = fs.existsSync(FRONTEND_DEV) ? FRONTEND_DEV : FRONTEND_DOCKER;
console.log('Frontend path:', FRONTEND, '| exists:', fs.existsSync(FRONTEND));
if (fs.existsSync(FRONTEND)) {
  app.use(express.static(FRONTEND));
  app.get('*', (req, res) => res.sendFile(path.join(FRONTEND, 'index.html')));
} else {
  console.error('ERROR: Frontend folder not found!');
  app.get('*', (req, res) => res.status(404).send('Frontend not found. Check deployment.'));
}

// ── Boot ──────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 4000;

async function start() {
  try {
    await initSchema();
    const dbMode = process.env.TURSO_URL && !process.env.TURSO_URL.startsWith('file:') ? 'Turso Cloud ☁️ ' : 'Local SQLite  ';
    const fileMode = process.env.CLOUDINARY_NAME ? 'Cloudinary ☁️ ' : 'Local disk    ';
    server.listen(PORT, () => {
      console.log(`
  ╔══════════════════════════════════════════╗
  ║  🌊  OpenWave Messenger                  ║
  ║  URL      →  http://localhost:${PORT}      ║
  ║  Database →  ${dbMode}             ║
  ║  Files    →  ${fileMode}             ║
  ╚══════════════════════════════════════════╝
      `);
    });
  } catch (err) {
    console.error('❌ Failed to start:', err.message);
    process.exit(1);
  }
}

start();
module.exports = { app, server };