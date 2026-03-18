/**
 * OpenWave WebSocket Server — real-time hub
 */
const WebSocket = require('ws');
const { authWS } = require('./middleware/auth');
const { q } = require('./db');

const userSockets = new Map();  // userId → Set<ws>
const chatPresence = new Map(); // chatId → Set<userId>

function setup(server) {
  const wss = new WebSocket.Server({ server, path: '/ws' });

  wss.on('connection', async (ws, req) => {
    const url = new URL(req.url, 'ws://x');
    const token = url.searchParams.get('token');
    const user = await authWS(token);

    if (!user) { ws.close(4001, 'Unauthorized'); return; }

    ws._userId = user.id;
    ws._alive = true;

    if (!userSockets.has(user.id)) userSockets.set(user.id, new Set());
    userSockets.get(user.id).add(ws);

    q.updateLastSeen(-1, user.id).catch(() => {});
    broadcastPresence(user.id, 'online');
    send(ws, { type: 'connected', user_id: user.id });

    ws.on('message', raw => {
      try { handleMessage(ws, user, JSON.parse(raw)); } catch {}
    });

    ws.on('pong', () => { ws._alive = true; });

    ws.on('close', async () => {
      const sockets = userSockets.get(user.id);
      if (sockets) {
        sockets.delete(ws);
        if (sockets.size === 0) {
          userSockets.delete(user.id);
          await q.updateLastSeen(Math.floor(Date.now()/1000), user.id).catch(() => {});
          broadcastPresence(user.id, 'offline');
        }
      }
    });
  });

  const heartbeat = setInterval(() => {
    wss.clients.forEach(ws => {
      if (!ws._alive) { ws.terminate(); return; }
      ws._alive = false;
      ws.ping();
    });
  }, 30000);

  wss.on('close', () => clearInterval(heartbeat));
  return wss;
}

async function handleMessage(ws, user, msg) {
  switch (msg.type) {
    case 'typing_start':
    case 'typing_stop': {
      if (!msg.chat_id) break;
      const member = await q.isMember(msg.chat_id, user.id).catch(() => null);
      if (!member) break;
      broadcastToChat(msg.chat_id, { type: msg.type, chat_id: msg.chat_id, user_id: user.id, display_name: user.display_name }, user.id);
      break;
    }
    case 'read_receipt': {
      if (!msg.message_id) break;
      await q.upsertStatus(msg.message_id, user.id, 'read').catch(() => {});
      const m = await q.getMessage(msg.message_id).catch(() => null);
      if (m) sendToUser(m.sender_id, { type: 'message_read', message_id: msg.message_id, reader_id: user.id, chat_id: m.chat_id });
      break;
    }
    case 'join_chat': {
      if (!msg.chat_id) break;
      const member = await q.isMember(msg.chat_id, user.id).catch(() => null);
      if (!member) break;
      if (!chatPresence.has(msg.chat_id)) chatPresence.set(msg.chat_id, new Set());
      chatPresence.get(msg.chat_id).add(user.id);
      ws._activeChat = msg.chat_id;
      break;
    }
    case 'leave_chat':
      if (ws._activeChat) {
        const p = chatPresence.get(ws._activeChat);
        if (p) p.delete(user.id);
        ws._activeChat = null;
      }
      break;
    case 'ping':
      send(ws, { type: 'pong', ts: Date.now() });
      break;
  }
}

function send(ws, data) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(data));
}

function sendToUser(userId, data) {
  const sockets = userSockets.get(userId);
  if (!sockets) return;
  const payload = JSON.stringify(data);
  for (const ws of sockets) if (ws.readyState === WebSocket.OPEN) ws.send(payload);
}

async function broadcastToChat(chatId, data, excludeUserId=null) {
  const members = await q.getChatMembers(chatId).catch(() => []);
  const payload = JSON.stringify(data);
  for (const m of members) {
    if (m.id === excludeUserId) continue;
    const sockets = userSockets.get(m.id);
    if (!sockets) continue;
    for (const ws of sockets) if (ws.readyState === WebSocket.OPEN) ws.send(payload);
  }
}

function broadcast(data, chatId=null, excludeUserId=null) {
  if (chatId) { broadcastToChat(chatId, data, excludeUserId); return; }
  const payload = JSON.stringify(data);
  userSockets.forEach((sockets, uid) => {
    if (uid === excludeUserId) return;
    for (const ws of sockets) if (ws.readyState === WebSocket.OPEN) ws.send(payload);
  });
}

async function broadcastPresence(userId, status) {
  const user = await q.getUserById(userId).catch(() => null);
  if (!user) return;
  broadcast({ type: 'presence', user_id: userId, status, last_seen: user.last_seen });
}

function getOnlineUsers() { return [...userSockets.keys()]; }

module.exports = { setup, broadcast, sendToUser, broadcastToChat, getOnlineUsers };
