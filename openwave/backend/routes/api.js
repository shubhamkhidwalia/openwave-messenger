const router = require('express').Router();
const { v4: uuidv4 } = require('uuid');
const { stmts } = require('../db');
const { authMiddleware } = require('../middleware/auth');
const { broadcast, sendToUser } = require('../ws');

router.use(authMiddleware);

// ── Users ────────────────────────────────────────────────────────────────────

// GET /api/users/search?q=...
router.get('/users/search', (req, res) => {
  const q = `%${req.query.q || ''}%`;
  const users = stmts.searchUsers.all(q, q, req.user.id);
  res.json({ users });
});

// GET /api/users/:id
router.get('/users/:id', (req, res) => {
  const user = stmts.getUserById.get(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const safe = { ...user };
  delete safe.password_hash;
  res.json({ user: safe });
});

// PATCH /api/users/me
router.patch('/users/me', (req, res) => {
  const { display_name, bio, avatar } = req.body;
  stmts.updateProfile.run({
    id: req.user.id,
    display_name: display_name || req.user.display_name,
    bio: bio !== undefined ? bio : req.user.bio,
    avatar: avatar !== undefined ? avatar : req.user.avatar,
  });
  const updated = stmts.getUserById.get(req.user.id);
  delete updated.password_hash;
  // Broadcast profile update to all connected
  broadcast({ type: 'user_updated', user: updated });
  res.json({ user: updated });
});

// ── Contacts ─────────────────────────────────────────────────────────────────

// GET /api/contacts
router.get('/contacts', (req, res) => {
  const contacts = stmts.getContacts.all(req.user.id);
  res.json({ contacts });
});

// POST /api/contacts
router.post('/contacts', (req, res) => {
  const { user_id } = req.body;
  if (!user_id) return res.status(400).json({ error: 'user_id required' });
  const target = stmts.getUserById.get(user_id);
  if (!target) return res.status(404).json({ error: 'User not found' });
  stmts.addContact.run(req.user.id, user_id);
  res.json({ ok: true });
});

// ── Chats ─────────────────────────────────────────────────────────────────────

// GET /api/chats
router.get('/chats', (req, res) => {
  const chats = stmts.getUserChats.all(req.user.id, req.user.id, req.user.id);
  // For direct chats, inject the other user's info
  const enriched = chats.map(chat => {
    if (chat.type === 'direct') {
      const members = stmts.getChatMembers.all(chat.id);
      const other = members.find(m => m.id !== req.user.id);
      if (other) {
        return { ...chat, peer: other };
      }
    }
    return { ...chat, members: stmts.getChatMembers.all(chat.id) };
  });
  res.json({ chats: enriched });
});

// POST /api/chats/direct — open or find direct chat with a user
router.post('/chats/direct', (req, res) => {
  const { user_id } = req.body;
  if (!user_id) return res.status(400).json({ error: 'user_id required' });
  if (user_id === req.user.id) return res.status(400).json({ error: 'Cannot chat with yourself' });

  const target = stmts.getUserById.get(user_id);
  if (!target) return res.status(404).json({ error: 'User not found' });

  // Check existing
  const existing = stmts.getDirectChat.get(req.user.id, user_id);
  if (existing) {
    const chat = stmts.getChatById.get(existing.id);
    const peer = stmts.getUserById.get(user_id);
    delete peer.password_hash;
    return res.json({ chat: { ...chat, peer, type: 'direct' } });
  }

  // Create new direct chat
  const chatId = uuidv4();
  stmts.createChat.run({
    id: chatId, type: 'direct',
    name: null, avatar: '', description: '',
    created_by: req.user.id
  });
  stmts.addMember.run({ chat_id: chatId, user_id: req.user.id, role: 'member' });
  stmts.addMember.run({ chat_id: chatId, user_id, role: 'member' });

  const chat = stmts.getChatById.get(chatId);
  const peer = stmts.getUserById.get(user_id);
  delete peer.password_hash;

  // Notify the other user
  sendToUser(user_id, { type: 'chat_created', chat: { ...chat, peer: { id: req.user.id, ...req.user, password_hash: undefined } } });

  res.status(201).json({ chat: { ...chat, peer, type: 'direct' } });
});

// POST /api/chats/group — create group
router.post('/chats/group', (req, res) => {
  const { name, description, member_ids } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });

  const chatId = uuidv4();
  stmts.createChat.run({
    id: chatId, type: 'group',
    name, avatar: '', description: description || '',
    created_by: req.user.id
  });
  stmts.addMember.run({ chat_id: chatId, user_id: req.user.id, role: 'owner' });

  const members = [req.user.id, ...(member_ids || []).filter(id => id !== req.user.id)];
  for (const uid of members.slice(1)) {
    const u = stmts.getUserById.get(uid);
    if (u) stmts.addMember.run({ chat_id: chatId, user_id: uid, role: 'member' });
  }

  const chat = stmts.getChatById.get(chatId);
  const chatMembers = stmts.getChatMembers.all(chatId);

  // System message
  const sysId = uuidv4();
  stmts.insertMessage.run({
    id: sysId, chat_id: chatId, sender_id: req.user.id,
    type: 'system', content: `${req.user.display_name} created the group`,
    reply_to: null
  });
  stmts.updateChatLastMsg.run(Date.now(), chatId);

  // Notify all members
  for (const m of chatMembers) {
    if (m.id !== req.user.id) {
      sendToUser(m.id, { type: 'chat_created', chat: { ...chat, members: chatMembers } });
    }
  }

  res.status(201).json({ chat: { ...chat, members: chatMembers } });
});

// GET /api/chats/:id/members
router.get('/chats/:id/members', (req, res) => {
  if (!stmts.isMember.get(req.params.id, req.user.id)) {
    return res.status(403).json({ error: 'Not a member' });
  }
  const members = stmts.getChatMembers.all(req.params.id);
  res.json({ members });
});

// POST /api/chats/:id/members — add member to group
router.post('/chats/:id/members', (req, res) => {
  const chat = stmts.getChatById.get(req.params.id);
  if (!chat || chat.type !== 'group') return res.status(400).json({ error: 'Invalid group' });
  const { user_id } = req.body;
  stmts.addMember.run({ chat_id: req.params.id, user_id, role: 'member' });
  const u = stmts.getUserById.get(user_id);
  broadcast({ type: 'member_added', chat_id: req.params.id, user: u }, req.params.id);
  res.json({ ok: true });
});

// ── Messages ──────────────────────────────────────────────────────────────────

// GET /api/chats/:id/messages?limit=50&offset=0
router.get('/chats/:id/messages', (req, res) => {
  if (!stmts.isMember.get(req.params.id, req.user.id)) {
    return res.status(403).json({ error: 'Not a member' });
  }
  const limit = Math.min(parseInt(req.query.limit) || 50, 100);
  const offset = parseInt(req.query.offset) || 0;
  const msgs = stmts.getMessages.all(req.params.id, limit, offset);
  res.json({ messages: msgs.reverse() });
});

// POST /api/chats/:id/messages
router.post('/chats/:id/messages', (req, res) => {
  if (!stmts.isMember.get(req.params.id, req.user.id)) {
    return res.status(403).json({ error: 'Not a member' });
  }
  const { content, type = 'text', reply_to } = req.body;
  if (!content) return res.status(400).json({ error: 'content required' });

  const id = uuidv4();
  stmts.insertMessage.run({
    id, chat_id: req.params.id,
    sender_id: req.user.id,
    type, content,
    reply_to: reply_to || null
  });
  stmts.updateChatLastMsg.run(Date.now(), req.params.id);

  const msg = stmts.getMessage.get(id);

  // Push to all members via WebSocket
  const members = stmts.getChatMembers.all(req.params.id);
  for (const m of members) {
    if (m.id !== req.user.id) {
      stmts.upsertStatus.run(id, m.id, 'delivered');
    }
  }
  broadcast({ type: 'new_message', message: msg, chat_id: req.params.id }, req.params.id, req.user.id);

  res.status(201).json({ message: msg });
});

// PATCH /api/messages/:id — edit
router.patch('/messages/:id', (req, res) => {
  const { content } = req.body;
  stmts.editMessage.run(content, req.params.id, req.user.id);
  const msg = stmts.getMessage.get(req.params.id);
  if (!msg) return res.status(404).json({ error: 'Not found' });
  broadcast({ type: 'message_edited', message: msg, chat_id: msg.chat_id });
  res.json({ message: msg });
});

// DELETE /api/messages/:id
router.delete('/messages/:id', (req, res) => {
  const msg = stmts.getMessage.get(req.params.id);
  if (!msg) return res.status(404).json({ error: 'Not found' });
  stmts.deleteMessage.run(req.params.id, req.user.id);
  broadcast({ type: 'message_deleted', message_id: req.params.id, chat_id: msg.chat_id });
  res.json({ ok: true });
});

// POST /api/messages/:id/read
router.post('/messages/:id/read', (req, res) => {
  const msg = stmts.getMessage.get(req.params.id);
  if (!msg) return res.status(404).json({ error: 'Not found' });
  stmts.upsertStatus.run(req.params.id, req.user.id, 'read');
  // Notify sender
  sendToUser(msg.sender_id, {
    type: 'message_read', message_id: req.params.id,
    reader_id: req.user.id, chat_id: msg.chat_id
  });
  res.json({ ok: true });
});

module.exports = router;
