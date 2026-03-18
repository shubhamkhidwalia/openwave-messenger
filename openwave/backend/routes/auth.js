const router = require('express').Router();
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const { q } = require('../db');
const { signToken } = require('../middleware/auth');

// POST /api/auth/register  — requires a valid invite code
router.post('/register', async (req, res) => {
  try {
    const { username, display_name, phone, password, invite_code } = req.body;

    if (!username || !password || !display_name)
      return res.status(400).json({ error: 'username, display_name and password are required' });
    if (username.length < 3 || username.length > 32)
      return res.status(400).json({ error: 'Username must be 3–32 characters' });
    if (!/^[a-zA-Z0-9_]+$/.test(username))
      return res.status(400).json({ error: 'Username: letters, numbers and underscores only' });
    if (password.length < 6)
      return res.status(400).json({ error: 'Password must be at least 6 characters' });

    // ── Invite code check ────────────────────────────────────────────────────
    if (!invite_code)
      return res.status(403).json({ error: 'An invite code is required to register' });

    const invite = await q.getInvite(invite_code);
    if (!invite)
      return res.status(403).json({ error: 'Invalid invite code' });
    if (invite.used_by)
      return res.status(403).json({ error: 'This invite has already been used' });
    if (invite.expires_at && invite.expires_at < Math.floor(Date.now()/1000))
      return res.status(403).json({ error: 'This invite has expired' });

    // ── Duplicate check ──────────────────────────────────────────────────────
    const existing = await q.getUserByUsername(username);
    if (existing) return res.status(409).json({ error: 'Username already taken' });

    if (phone) {
      const byPhone = await q.getUserByPhone(phone);
      if (byPhone) return res.status(409).json({ error: 'Phone number already registered' });
    }

    // ── Create user ──────────────────────────────────────────────────────────
    const password_hash = await bcrypt.hash(password, 12);
    const id = uuidv4();
    await q.createUser(id, username, phone||null, display_name, password_hash, '');
    await q.useInvite(invite_code, id);   // mark invite as consumed

    const token = signToken(id);
    const user = await q.getUserById(id);
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
    if (!username || !password)
      return res.status(400).json({ error: 'Username and password required' });

    const user = await q.getUserByUsername(username);
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

    const token = signToken(user.id);
    const safe = { ...user }; delete safe.password_hash;
    res.json({ token, user: safe });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Login failed' });
  }
});

// GET /api/auth/me
router.get('/me', require('../middleware/auth').authMiddleware, async (req, res) => {
  const user = { ...req.user }; delete user.password_hash;
  res.json({ user });
});

module.exports = router;
