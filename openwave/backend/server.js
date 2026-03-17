require('dotenv').config();
const express = require('express');
const http = require('http');
const cors = require('cors');
const path = require('path');
const multer = require('multer');
const fs = require('fs');

const app = express();
const server = http.createServer(app);

// WebSocket setup (must be before routes)
const ws = require('./ws');
ws.setup(server);

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(cors({
  origin: process.env.CLIENT_ORIGIN || '*',
  methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ── Media uploads ─────────────────────────────────────────────────────────────
const UPLOADS_DIR = process.env.UPLOADS_DIR || path.join(__dirname, 'data', 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const upload = multer({
  dest: UPLOADS_DIR,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50 MB
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg','image/png','image/gif','image/webp',
                     'video/mp4','audio/mpeg','audio/ogg','application/pdf',
                     'application/zip','text/plain'];
    cb(null, allowed.includes(file.mimetype));
  }
});

const { authMiddleware } = require('./middleware/auth');

app.post('/api/upload', authMiddleware, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file' });
  const url = `/media/${path.basename(req.file.path)}`;
  res.json({ url, name: req.file.originalname, size: req.file.size, mime: req.file.mimetype });
});

app.use('/media', express.static(UPLOADS_DIR));

// ── API Routes ────────────────────────────────────────────────────────────────
app.use('/api/auth', require('./routes/auth'));
app.use('/api', require('./routes/api'));

// ── Health check ──────────────────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({ status: 'ok', ts: Date.now(), online: ws.getOnlineUsers().length });
});

// ── Serve frontend (production) ───────────────────────────────────────────────
const FRONTEND = path.join(__dirname, '..', 'frontend');
if (fs.existsSync(FRONTEND)) {
  app.use(express.static(FRONTEND));
  app.get('*', (req, res) => {
    res.sendFile(path.join(FRONTEND, 'index.html'));
  });
}

// ── Start ─────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 4000;
server.listen(PORT, () => {
  console.log(`
  ╔═══════════════════════════════════════╗
  ║   🌊  OpenWave Messenger              ║
  ║   Server  →  http://localhost:${PORT}   ║
  ║   WS      →  ws://localhost:${PORT}/ws  ║
  ╚═══════════════════════════════════════╝
  `);
});

module.exports = { app, server };
