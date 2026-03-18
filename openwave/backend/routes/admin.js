/**
 * OpenWave Admin Routes
 * Protected by ADMIN_SECRET header.
 * Use these to generate invite links for your friends.
 *
 * Example:
 *   curl -X POST http://localhost:4000/api/admin/invite \
 *     -H "x-admin-secret: YOUR_SECRET" \
 *     -H "Content-Type: application/json" \
 *     -d '{"expires_days": 7}'
 */
const router = require('express').Router();
const { v4: uuidv4 } = require('uuid');
const { q } = require('../db');
const { adminMiddleware } = require('../middleware/auth');

router.use(adminMiddleware);

// POST /api/admin/invite — generate one invite link
router.post('/invite', async (req, res) => {
  try {
    const { expires_days } = req.body;
    const code = uuidv4().replace(/-/g, '').slice(0, 16); // 16-char code
    const expires_at = expires_days
      ? Math.floor(Date.now()/1000) + (expires_days * 86400)
      : null;

    await q.createInvite(code, expires_at);

    const base = process.env.APP_URL || `http://localhost:${process.env.PORT||4000}`;
    const link = `${base}/invite/${code}`;

    res.json({
      code,
      link,
      expires_at: expires_at ? new Date(expires_at*1000).toISOString() : 'never',
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/admin/invite/bulk — generate multiple invites at once
router.post('/invite/bulk', async (req, res) => {
  try {
    const { count = 1, expires_days } = req.body;
    const base = process.env.APP_URL || `http://localhost:${process.env.PORT||4000}`;
    const results = [];

    for (let i = 0; i < Math.min(count, 50); i++) {
      const code = uuidv4().replace(/-/g, '').slice(0, 16);
      const expires_at = expires_days
        ? Math.floor(Date.now()/1000) + (expires_days * 86400)
        : null;
      await q.createInvite(code, expires_at);
      results.push({ code, link: `${base}/invite/${code}` });
    }

    res.json({ invites: results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/admin/invites — list all invites and their status
router.get('/invites', async (req, res) => {
  try {
    const invites = await q.listInvites();
    res.json({ invites });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/admin/users — list all registered users
router.get('/users', async (req, res) => {
  try {
    const { all } = require('../db');
    const users = await require('../db').q.searchUsers('%', '%', 'nobody');
    res.json({ users });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
