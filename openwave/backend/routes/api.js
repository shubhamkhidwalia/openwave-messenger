const router = require('express').Router();
const { v4: uuidv4 } = require('uuid');
const { q } = require('../db');
const { authMiddleware } = require('../middleware/auth');
const { broadcast, sendToUser } = require('../ws');

router.use(authMiddleware);

// ── Users ─────────────────────────────────────────────────────────────────────
router.get('/users/search', async (req, res) => {
  const pattern = `%${req.query.q || ''}%`;
  const users = await q.searchUsers(pattern, pattern, req.user.id);
  res.json({ users });
});

router.get('/users/:id', async (req, res) => {
  const user = await q.getUserById(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const safe = { ...user }; delete safe.password_hash;
  res.json({ user: safe });
});

router.patch('/users/me', async (req, res) => {
  const { display_name, bio, avatar } = req.body;
  await q.updateProfile(
    display_name || req.user.display_name,
    bio !== undefined ? bio : req.user.bio,
    avatar !== undefined ? avatar : req.user.avatar,
    req.user.id
  );
  const updated = await q.getUserById(req.user.id);
  delete updated.password_hash;
  broadcast({ type: 'user_updated', user: updated });
  res.json({ user: updated });
});

// ── Contacts ─────────────────────────────────────────────────────────────────
router.get('/contacts', async (req, res) => {
  const contacts = await q.getContacts(req.user.id);
  res.json({ contacts });
});

router.post('/contacts', async (req, res) => {
  const { user_id } = req.body;
  if (!user_id) return res.status(400).json({ error: 'user_id required' });
  const target = await q.getUserById(user_id);
  if (!target) return res.status(404).json({ error: 'User not found' });
  await q.addContact(req.user.id, user_id);
  res.json({ ok: true });
});

// ── Chats ─────────────────────────────────────────────────────────────────────
router.get('/chats', async (req, res) => {
  const chats = await q.getUserChats(req.user.id);
  const enriched = await Promise.all(chats.map(async chat => {
    if (chat.type === 'direct') {
      const members = await q.getChatMembers(chat.id);
      const peer = members.find(m => m.id !== req.user.id);
      return { ...chat, peer };
    }
    return { ...chat, members: await q.getChatMembers(chat.id) };
  }));
  res.json({ chats: enriched });
});

router.post('/chats/direct', async (req, res) => {
  const { user_id } = req.body;
  if (!user_id) return res.status(400).json({ error: 'user_id required' });
  if (user_id === req.user.id) return res.status(400).json({ error: 'Cannot chat with yourself' });

  const target = await q.getUserById(user_id);
  if (!target) return res.status(404).json({ error: 'User not found' });

  const existing = await q.getDirectChat(req.user.id, user_id);
  if (existing) {
    const chat = await q.getChatById(existing.id);
    const peer = await q.getUserById(user_id);
    delete peer.password_hash;
    return res.json({ chat: { ...chat, peer, type: 'direct' } });
  }

  const chatId = uuidv4();
  await q.createChat(chatId, 'direct', null, '', '', req.user.id);
  await q.addMember(chatId, req.user.id, 'member');
  await q.addMember(chatId, user_id, 'member');

  const chat = await q.getChatById(chatId);
  const peer = await q.getUserById(user_id);
  delete peer.password_hash;

  sendToUser(user_id, { type: 'chat_created', chat: { ...chat, peer: { ...req.user, password_hash: undefined } } });
  res.status(201).json({ chat: { ...chat, peer, type: 'direct' } });
});

router.post('/chats/group', async (req, res) => {
  const { name, description, member_ids } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });

  const chatId = uuidv4();
  await q.createChat(chatId, 'group', name, '', description||'', req.user.id);
  await q.addMember(chatId, req.user.id, 'owner');

  for (const uid of (member_ids||[]).filter(id => id !== req.user.id)) {
    const u = await q.getUserById(uid);
    if (u) await q.addMember(chatId, uid, 'member');
  }

  const chat = await q.getChatById(chatId);
  const chatMembers = await q.getChatMembers(chatId);

  const sysId = uuidv4();
  await q.insertMessage(sysId, chatId, req.user.id, 'system', `${req.user.display_name} created the group`, null);
  await q.updateChatLastMsg(Date.now(), chatId);

  for (const m of chatMembers) {
    if (m.id !== req.user.id)
      sendToUser(m.id, { type: 'chat_created', chat: { ...chat, members: chatMembers } });
  }

  res.status(201).json({ chat: { ...chat, members: chatMembers } });
});

router.get('/chats/:id/members', async (req, res) => {
  if (!await q.isMember(req.params.id, req.user.id))
    return res.status(403).json({ error: 'Not a member' });
  const members = await q.getChatMembers(req.params.id);
  res.json({ members });
});

router.post('/chats/:id/members', async (req, res) => {
  const chat = await q.getChatById(req.params.id);
  if (!chat || chat.type !== 'group') return res.status(400).json({ error: 'Invalid group' });
  const { user_id } = req.body;
  await q.addMember(req.params.id, user_id, 'member');
  const u = await q.getUserById(user_id);
  broadcast({ type: 'member_added', chat_id: req.params.id, user: u }, req.params.id);
  res.json({ ok: true });
});

// ── Messages ──────────────────────────────────────────────────────────────────
router.get('/chats/:id/messages', async (req, res) => {
  if (!await q.isMember(req.params.id, req.user.id))
    return res.status(403).json({ error: 'Not a member' });
  const limit  = Math.min(parseInt(req.query.limit)||50, 100);
  const offset = parseInt(req.query.offset)||0;
  const msgs = await q.getMessages(req.params.id, limit, offset);
  res.json({ messages: msgs.reverse() });
});

router.post('/chats/:id/messages', async (req, res) => {
  if (!await q.isMember(req.params.id, req.user.id))
    return res.status(403).json({ error: 'Not a member' });
  const { content, type='text', reply_to } = req.body;
  if (!content) return res.status(400).json({ error: 'content required' });

  const id = uuidv4();
  await q.insertMessage(id, req.params.id, req.user.id, type, content, reply_to||null);
  await q.updateChatLastMsg(Date.now(), req.params.id);

  const msg = await q.getMessage(id);
  const members = await q.getChatMembers(req.params.id);
  for (const m of members) {
    if (m.id !== req.user.id) await q.upsertStatus(id, m.id, 'delivered');
  }

  broadcast({ type: 'new_message', message: msg, chat_id: req.params.id }, req.params.id, req.user.id);
  res.status(201).json({ message: msg });
});

router.patch('/messages/:id', async (req, res) => {
  const { content } = req.body;
  await q.editMessage(content, req.params.id, req.user.id);
  const msg = await q.getMessage(req.params.id);
  if (!msg) return res.status(404).json({ error: 'Not found' });
  broadcast({ type: 'message_edited', message: msg, chat_id: msg.chat_id });
  res.json({ message: msg });
});

router.delete('/messages/:id', async (req, res) => {
  const msg = await q.getMessage(req.params.id);
  if (!msg) return res.status(404).json({ error: 'Not found' });
  await q.deleteMessage(req.params.id, req.user.id);
  broadcast({ type: 'message_deleted', message_id: req.params.id, chat_id: msg.chat_id });
  res.json({ ok: true });
});

router.post('/messages/:id/read', async (req, res) => {
  const msg = await q.getMessage(req.params.id);
  if (!msg) return res.status(404).json({ error: 'Not found' });
  await q.upsertStatus(req.params.id, req.user.id, 'read');
  sendToUser(msg.sender_id, { type: 'message_read', message_id: req.params.id, reader_id: req.user.id, chat_id: msg.chat_id });
  res.json({ ok: true });
});

module.exports = router;
