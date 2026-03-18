/**
 * OpenWave Upload Handler
 * Uses Cloudinary when credentials are set, falls back to local disk for dev
 */
const multer = require('multer');
const path   = require('path');
const fs     = require('fs');

const ALLOWED_MIME = [
  'image/jpeg','image/png','image/gif','image/webp',
  'video/mp4','audio/mpeg','audio/ogg',
  'application/pdf','application/zip','text/plain'
];

// ── Cloudinary (production) ───────────────────────────────────────────────────
async function uploadToCloudinary(filePath, originalName, mimeType) {
  const { v2: cloudinary } = require('cloudinary');
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_NAME,
    api_key:    process.env.CLOUDINARY_KEY,
    api_secret: process.env.CLOUDINARY_SECRET,
  });

  const isImage = mimeType.startsWith('image/');
  const result  = await cloudinary.uploader.upload(filePath, {
    folder:        'openwave',
    resource_type: isImage ? 'image' : 'raw',
    public_id:     path.parse(originalName).name + '_' + Date.now(),
    overwrite:     false,
  });

  fs.unlink(filePath, () => {}); // remove temp file after upload
  return result.secure_url;
}

// ── Local disk (dev fallback) ─────────────────────────────────────────────────
const UPLOADS_DIR = process.env.UPLOADS_DIR || path.join(__dirname, 'data', 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

// Multer always writes to temp first, then we decide where it goes
const upload = multer({
  dest: path.join(__dirname, 'data', 'tmp'),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50 MB
  fileFilter: (req, file, cb) => {
    cb(null, ALLOWED_MIME.includes(file.mimetype));
  }
});

// ── Route handler ─────────────────────────────────────────────────────────────
function uploadMiddleware(app) {
  // Ensure tmp dir exists
  const tmpDir = path.join(__dirname, 'data', 'tmp');
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

  const { authMiddleware } = require('./middleware/auth');

  app.post('/api/upload', authMiddleware, upload.single('file'), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file or unsupported type' });

    try {
      let url;
      const useCloudinary = process.env.CLOUDINARY_NAME && process.env.CLOUDINARY_KEY && process.env.CLOUDINARY_SECRET;

      if (useCloudinary) {
        // Upload to Cloudinary — permanent cloud URL
        url = await uploadToCloudinary(req.file.path, req.file.originalname, req.file.mimetype);
      } else {
        // Move to local uploads folder
        const dest = path.join(UPLOADS_DIR, req.file.filename);
        fs.renameSync(req.file.path, dest);
        url = `/media/${req.file.filename}`;
      }

      res.json({
        url,
        name: req.file.originalname,
        size: req.file.size,
        mime: req.file.mimetype,
      });
    } catch (err) {
      console.error('Upload error:', err);
      fs.unlink(req.file.path, () => {});
      res.status(500).json({ error: 'Upload failed: ' + err.message });
    }
  });

  // Serve local files (only used when Cloudinary is not configured)
  app.use('/media', require('express').static(UPLOADS_DIR));
}

module.exports = { uploadMiddleware };
