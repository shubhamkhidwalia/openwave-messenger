/**
 * OpenWave WebSocket Server
 * Handles: presence, typing indicators, real-time message delivery
 * Architecture mirrors Telegram's MTProto update system
 */

const WebSocket = require('ws');
const { authWS } = require('./middleware/auth');
const { stmts } = require('./db');

// userId → Set<ws>  (one user can have multiple tabs/devices)
const userSockets = new Map();

// chatId → Set<userId>  (who is currently in this chat)
const chatPresence = new Map();

function setup(server) {
  const wss = new WebSocket.Server({ server, path: '/ws' });

  wss.on('connection', (ws, req) => {
    // Auth via ?token=... query param
    const url = new URL(req.url, 'ws://x');
    const token = url.searchParams.get('token');
    const user = authWS(token);

    if (!user) {
      ws.close(4001, 'Unauthorized');
      return;
    }

    ws._userId = user.id;
    ws._alive = true;

    // Register socket
    if (!userSockets.has(user.id)) userSockets.set(user.id, new Set());
    userSockets.get(user.id).add(ws);

    // Mark online
    stmts.updateLastSeen.run(-1, user.id); // -1 = online sentinel
    broadcastPresence(user.id, 'online');

    // Send queued/missed updates (simplified: just confirm connection)
    send(ws, { type: 'connected', user_id: user.id });

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw);
        handleMessage(ws, user, msg);
      } catch {}
    });

    ws.on('pong', () => { ws._alive = true; });

    ws.on('close', () => {
      const sockets = userSockets.get(user.id);
      if (sockets) {
        sockets.delete(ws);
        if (sockets.size === 0) {
          userSockets.delete(user.id);
          // Mark last seen
          stmts.updateLastSeen.run(Math.floor(Date.now() / 1000), user.id);
          broadcastPresence(user.id, 'offline');
        }
      }
    });
  });

  // Heartbeat — detect dead connections (Telegram does this every 30s)
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

function handleMessage(ws, user, msg) {
  switch (msg.type) {

    case 'typing_start':
    case 'typing_stop': {
      if (!msg.chat_id) break;
      // Verify membership
      const isMember = stmts.isMember.get(msg.chat_id, user.id);
      if (!isMember) break;
      broadcastToChat(msg.chat_id, {
        type: msg.type,
        chat_id: msg.chat_id,
        user_id: user.id,
        display_name: user.display_name
      }, user.id);
      break;
    }

    case 'read_receipt': {
      if (!msg.message_id) break;
      stmts.upsertStatus.run(msg.message_id, user.id, 'read');
      const m = stmts.getMessage.get(msg.message_id);
      if (m) {
        sendToUser(m.sender_id, {
          type: 'message_read',
          message_id: msg.message_id,
          reader_id: user.id,
          chat_id: m.chat_id
        });
      }
      break;
    }

    case 'join_chat': {
      // Client tells server which chat window is open (for presence)
      if (!msg.chat_id) break;
      const isMember = stmts.isMember.get(msg.chat_id, user.id);
      if (!isMember) break;
      if (!chatPresence.has(msg.chat_id)) chatPresence.set(msg.chat_id, new Set());
      chatPresence.get(msg.chat_id).add(user.id);
      ws._activeChat = msg.chat_id;
      break;
    }

    case 'leave_chat': {
      if (ws._activeChat) {
        const p = chatPresence.get(ws._activeChat);
        if (p) p.delete(user.id);
        ws._activeChat = null;
      }
      break;
    }

    case 'ping':
      send(ws, { type: 'pong', ts: Date.now() });
      break;
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function send(ws, data) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

function sendToUser(userId, data) {
  const sockets = userSockets.get(userId);
  if (!sockets) return;
  const payload = JSON.stringify(data);
  for (const ws of sockets) {
    if (ws.readyState === WebSocket.OPEN) ws.send(payload);
  }
}

// Broadcast to all members of a chat (except optional excludeUserId)
function broadcastToChat(chatId, data, excludeUserId = null) {
  const members = stmts.getChatMembers.all(chatId);
  const payload = JSON.stringify(data);
  for (const m of members) {
    if (m.id === excludeUserId) continue;
    const sockets = userSockets.get(m.id);
    if (!sockets) continue;
    for (const ws of sockets) {
      if (ws.readyState === WebSocket.OPEN) ws.send(payload);
    }
  }
}

// Generic broadcast (to all connected users, or to a chat's members)
function broadcast(data, chatId = null, excludeUserId = null) {
  if (chatId) {
    broadcastToChat(chatId, data, excludeUserId);
    return;
  }
  const payload = JSON.stringify(data);
  userSockets.forEach((sockets, uid) => {
    if (uid === excludeUserId) return;
    for (const ws of sockets) {
      if (ws.readyState === WebSocket.OPEN) ws.send(payload);
    }
  });
}

function broadcastPresence(userId, status) {
  // Notify all users who share a chat with this user
  const user = stmts.getUserById.get(userId);
  if (!user) return;
  // Simple: broadcast to everyone connected (in prod: only to shared chat members)
  broadcast({ type: 'presence', user_id: userId, status, last_seen: user.last_seen });
}

function getOnlineUsers() {
  return [...userSockets.keys()];
}

module.exports = { setup, broadcast, sendToUser, broadcastToChat, getOnlineUsers };
