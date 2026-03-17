const jwt = require('jsonwebtoken');
const { stmts } = require('../db');

const JWT_SECRET = process.env.JWT_SECRET || 'openwave-dev-secret-change-in-prod';

function signToken(userId) {
  return jwt.sign({ sub: userId }, JWT_SECRET, { expiresIn: '30d' });
}

function verifyToken(token) {
  return jwt.verify(token, JWT_SECRET);
}

function authMiddleware(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided' });
  }
  try {
    const payload = verifyToken(header.slice(7));
    const user = stmts.getUserById.get(payload.sub);
    if (!user) return res.status(401).json({ error: 'User not found' });
    req.user = user;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// WebSocket token auth — called during WS upgrade
function authWS(token) {
  try {
    const payload = verifyToken(token);
    return stmts.getUserById.get(payload.sub) || null;
  } catch {
    return null;
  }
}

module.exports = { signToken, authMiddleware, authWS };
