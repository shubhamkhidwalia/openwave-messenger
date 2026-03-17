const router = require('express').Router();
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const { stmts } = require('../db');
const { signToken } = require('../middleware/auth');

// POST /api/auth/register
router.post('/register', async (req, res) => {
  try {
    const { username, display_name, phone, password, public_key } = req.body;
    if (!username || !password || !display_name) {
      return res.status(400).json({ error: 'username, display_name and password are required' });
    }
    if (username.length < 3 || username.length > 32) {
      return res.status(400).json({ error: 'Username must be 3–32 characters' });
    }
    if (!/^[a-zA-Z0-9_]+$/.test(username)) {
      return res.status(400).json({ error: 'Username: letters, numbers and underscores only' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    const existing = stmts.getUserByUsername.get(username);
    if (existing) return res.status(409).json({ error: 'Username already taken' });

    if (phone) {
      const byPhone = stmts.getUserByPhone.get(phone);
      if (byPhone) return res.status(409).json({ error: 'Phone number already registered' });
    }

    const password_hash = await bcrypt.hash(password, 12);
    const id = uuidv4();

    stmts.createUser.run({
      id, username, phone: phone || null,
      display_name, password_hash,
      public_key: public_key || ''
    });

    const token = signToken(id);
    const user = stmts.getUserById.get(id);
    delete user.password_hash;

    res.status(201).json({ token, user });
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password required' });
    }

    const user = stmts.getUserByUsername.get(username);
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

    const token = signToken(user.id);
    const safe = { ...user };
    delete safe.password_hash;

    res.json({ token, user: safe });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Login failed' });
  }
});

// GET /api/auth/me
router.get('/me', require('../middleware/auth').authMiddleware, (req, res) => {
  const user = { ...req.user };
  delete user.password_hash;
  res.json({ user });
});

module.exports = router;
