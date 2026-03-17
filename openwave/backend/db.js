/**
 * OpenWave DB — Node.js built-in sqlite (Node 22.5+, no compilation needed)
 */
const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new DatabaseSync(path.join(DATA_DIR, 'openwave.db'));

db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA synchronous = NORMAL');
db.exec('PRAGMA foreign_keys = ON');
db.exec('PRAGMA cache_size = -32000');
db.exec('PRAGMA temp_store = MEMORY');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id           TEXT PRIMARY KEY,
    username     TEXT UNIQUE NOT NULL COLLATE NOCASE,
    phone        TEXT UNIQUE,
    display_name TEXT NOT NULL,
    bio          TEXT DEFAULT '',
    avatar       TEXT DEFAULT '',
    password_hash TEXT NOT NULL,
    public_key   TEXT DEFAULT '',
    last_seen    INTEGER DEFAULT 0,
    created_at   INTEGER DEFAULT (unixepoch())
  );

  CREATE TABLE IF NOT EXISTS chats (
    id          TEXT PRIMARY KEY,
    type        TEXT NOT NULL CHECK(type IN ('direct','group','channel')),
    name        TEXT,
    avatar      TEXT DEFAULT '',
    description TEXT DEFAULT '',
    created_by  TEXT REFERENCES users(id),
    created_at  INTEGER DEFAULT (unixepoch()),
    last_msg_at INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS chat_members (
    chat_id   TEXT REFERENCES chats(id) ON DELETE CASCADE,
    user_id   TEXT REFERENCES users(id) ON DELETE CASCADE,
    role      TEXT DEFAULT 'member' CHECK(role IN ('owner','admin','member')),
    joined_at INTEGER DEFAULT (unixepoch()),
    PRIMARY KEY (chat_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS messages (
    id         TEXT PRIMARY KEY,
    chat_id    TEXT REFERENCES chats(id) ON DELETE CASCADE,
    sender_id  TEXT REFERENCES users(id),
    type       TEXT DEFAULT 'text' CHECK(type IN ('text','image','file','system','reply')),
    content    TEXT NOT NULL,
    reply_to   TEXT REFERENCES messages(id),
    edited     INTEGER DEFAULT 0,
    deleted    INTEGER DEFAULT 0,
    created_at INTEGER DEFAULT (unixepoch('now','subsec') * 1000)
  );

  CREATE TABLE IF NOT EXISTS message_status (
    message_id TEXT REFERENCES messages(id) ON DELETE CASCADE,
    user_id    TEXT REFERENCES users(id),
    status     TEXT CHECK(status IN ('delivered','read')),
    updated_at INTEGER DEFAULT (unixepoch()),
    PRIMARY KEY (message_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS contacts (
    owner_id   TEXT REFERENCES users(id),
    contact_id TEXT REFERENCES users(id),
    nickname   TEXT,
    blocked    INTEGER DEFAULT 0,
    added_at   INTEGER DEFAULT (unixepoch()),
    PRIMARY KEY (owner_id, contact_id)
  );

  CREATE INDEX IF NOT EXISTS idx_messages_chat    ON messages(chat_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_messages_sender  ON messages(sender_id);
  CREATE INDEX IF NOT EXISTS idx_chat_members_user ON chat_members(user_id);
  CREATE INDEX IF NOT EXISTS idx_users_username   ON users(username);
`);

// ── Prepared Statements ──────────────────────────────────────────────────────
// node:sqlite uses the same .get() / .all() / .run() API as better-sqlite3
// Named params use @name syntax

const stmts = {
  // Users
  createUser: db.prepare(`
    INSERT INTO users (id, username, phone, display_name, password_hash, public_key)
    VALUES (@id, @username, @phone, @display_name, @password_hash, @public_key)
  `),
  getUserById:       db.prepare('SELECT * FROM users WHERE id = ?'),
  getUserByUsername: db.prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE'),
  getUserByPhone:    db.prepare('SELECT * FROM users WHERE phone = ?'),
  updateLastSeen:    db.prepare('UPDATE users SET last_seen = ? WHERE id = ?'),
  updateProfile:     db.prepare('UPDATE users SET display_name=@display_name, bio=@bio, avatar=@avatar WHERE id=@id'),
  updatePublicKey:   db.prepare('UPDATE users SET public_key = ? WHERE id = ?'),
  searchUsers:       db.prepare(`
    SELECT id, username, display_name, bio, avatar, last_seen, public_key
    FROM users WHERE (username LIKE ? OR display_name LIKE ?) AND id != ?
    LIMIT 20
  `),

  // Chats
  createChat: db.prepare(`
    INSERT INTO chats (id, type, name, avatar, description, created_by)
    VALUES (@id, @type, @name, @avatar, @description, @created_by)
  `),
  getChatById:       db.prepare('SELECT * FROM chats WHERE id = ?'),
  getUserChats:      db.prepare(`
    SELECT c.*, cm.role,
      (SELECT content    FROM messages WHERE chat_id=c.id AND deleted=0 ORDER BY created_at DESC LIMIT 1) as last_message,
      (SELECT sender_id  FROM messages WHERE chat_id=c.id AND deleted=0 ORDER BY created_at DESC LIMIT 1) as last_sender,
      (SELECT created_at FROM messages WHERE chat_id=c.id AND deleted=0 ORDER BY created_at DESC LIMIT 1) as last_msg_ts,
      (SELECT COUNT(*) FROM messages m
       WHERE m.chat_id=c.id AND m.deleted=0
       AND NOT EXISTS(SELECT 1 FROM message_status ms WHERE ms.message_id=m.id AND ms.user_id=? AND ms.status='read')
       AND m.sender_id != ?) as unread_count
    FROM chats c
    JOIN chat_members cm ON cm.chat_id=c.id AND cm.user_id=?
    ORDER BY COALESCE(c.last_msg_at, c.created_at) DESC
  `),
  updateChatLastMsg: db.prepare('UPDATE chats SET last_msg_at = ? WHERE id = ?'),
  addMember:         db.prepare('INSERT OR IGNORE INTO chat_members (chat_id, user_id, role) VALUES (@chat_id, @user_id, @role)'),
  removeMember:      db.prepare('DELETE FROM chat_members WHERE chat_id=? AND user_id=?'),
  getChatMembers:    db.prepare(`
    SELECT u.id, u.username, u.display_name, u.avatar, u.last_seen, cm.role
    FROM chat_members cm JOIN users u ON u.id=cm.user_id
    WHERE cm.chat_id=?
  `),
  isMember:          db.prepare('SELECT 1 FROM chat_members WHERE chat_id=? AND user_id=?'),
  getDirectChat:     db.prepare(`
    SELECT c.id FROM chats c
    JOIN chat_members a ON a.chat_id=c.id AND a.user_id=?
    JOIN chat_members b ON b.chat_id=c.id AND b.user_id=?
    WHERE c.type='direct' LIMIT 1
  `),

  // Messages
  insertMessage: db.prepare(`
    INSERT INTO messages (id, chat_id, sender_id, type, content, reply_to)
    VALUES (@id, @chat_id, @sender_id, @type, @content, @reply_to)
  `),
  getMessages: db.prepare(`
    SELECT m.*, u.username, u.display_name, u.avatar,
      r.content as reply_content, ru.display_name as reply_sender_name
    FROM messages m
    JOIN users u ON u.id=m.sender_id
    LEFT JOIN messages r ON r.id=m.reply_to
    LEFT JOIN users ru ON ru.id=r.sender_id
    WHERE m.chat_id=? AND m.deleted=0
    ORDER BY m.created_at DESC LIMIT ? OFFSET ?
  `),
  getMessage: db.prepare(`
    SELECT m.*, u.username, u.display_name, u.avatar
    FROM messages m JOIN users u ON u.id=m.sender_id
    WHERE m.id=?
  `),
  editMessage:   db.prepare('UPDATE messages SET content=?, edited=1 WHERE id=? AND sender_id=?'),
  deleteMessage: db.prepare('UPDATE messages SET deleted=1 WHERE id=? AND sender_id=?'),

  // Status
  upsertStatus: db.prepare(`
    INSERT INTO message_status (message_id, user_id, status, updated_at)
    VALUES (?, ?, ?, unixepoch())
    ON CONFLICT(message_id, user_id) DO UPDATE SET
      status=excluded.status, updated_at=excluded.updated_at
  `),
  getStatus: db.prepare('SELECT * FROM message_status WHERE message_id=?'),

  // Contacts
  addContact:   db.prepare('INSERT OR IGNORE INTO contacts (owner_id, contact_id) VALUES (?, ?)'),
  getContacts:  db.prepare(`
    SELECT u.id, u.username, u.display_name, u.bio, u.avatar, u.last_seen, c.nickname, c.blocked
    FROM contacts c JOIN users u ON u.id=c.contact_id
    WHERE c.owner_id=? AND c.blocked=0 ORDER BY u.display_name
  `),
  blockContact: db.prepare('UPDATE contacts SET blocked=1 WHERE owner_id=? AND contact_id=?'),
};

module.exports = { db, stmts };
