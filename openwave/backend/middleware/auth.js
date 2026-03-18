const jwt = require('jsonwebtoken');
const { q } = require('../db');

const JWT_SECRET = process.env.JWT_SECRET || 'openwave-dev-secret-change-in-prod';

function signToken(userId) {
  return jwt.sign({ sub: userId }, JWT_SECRET, { expiresIn: '30d' });
}
function verifyToken(token) {
  return jwt.verify(token, JWT_SECRET);
}

async function authMiddleware(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer '))
    return res.status(401).json({ error: 'No token provided' });
  try {
    const payload = verifyToken(header.slice(7));
    const user = await q.getUserById(payload.sub);
    if (!user) return res.status(401).json({ error: 'User not found' });
    req.user = user;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

async function authWS(token) {
  try {
    const payload = verifyToken(token);
    return await q.getUserById(payload.sub) || null;
  } catch { return null; }
}

// Admin secret — set ADMIN_SECRET in .env to enable admin routes
function adminMiddleware(req, res, next) {
  const secret = req.headers['x-admin-secret'] || req.query.secret;
  if (!secret || secret !== process.env.ADMIN_SECRET)
    return res.status(403).json({ error: 'Admin access denied' });
  next();
}

module.exports = { signToken, authMiddleware, authWS, adminMiddleware };
