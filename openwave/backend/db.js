/**
 * OpenWave DB — Turso (libSQL) cloud database
 * Same SQLite syntax, runs in the cloud, zero local storage
 */
const { createClient } = require('@libsql/client');

// Turso credentials from environment variables
// Get them free at: https://turso.tech
const db = createClient({
  url:       process.env.TURSO_URL   || 'file:local.db', // falls back to local for dev
  authToken: process.env.TURSO_TOKEN || undefined,
});

// ── Schema bootstrap (runs once on first start) ──────────────────────────────
async function initSchema() {
  const pragmas = [
    'PRAGMA journal_mode = WAL',
    'PRAGMA foreign_keys = ON',
  ];
  for (const p of pragmas) {
    await db.execute(p).catch(() => {}); // Turso cloud ignores some pragmas — that's fine
  }

  await db.executeMultiple(`
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

    CREATE TABLE IF NOT EXISTS invite_codes (
      code        TEXT PRIMARY KEY,
      created_by  TEXT DEFAULT 'admin',
      used_by     TEXT REFERENCES users(id),
      used_at     INTEGER,
      expires_at  INTEGER,
      created_at  INTEGER DEFAULT (unixepoch())
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

    CREATE INDEX IF NOT EXISTS idx_messages_chat     ON messages(chat_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_messages_sender   ON messages(sender_id);
    CREATE INDEX IF NOT EXISTS idx_chat_members_user ON chat_members(user_id);
    CREATE INDEX IF NOT EXISTS idx_users_username    ON users(username);
  `);
}

// ── Query helpers ─────────────────────────────────────────────────────────────
// Turso uses positional args: execute({ sql, args: [...] })
// We wrap common patterns for convenience

async function get(sql, args = []) {
  const res = await db.execute({ sql, args });
  return res.rows[0] || null;
}

async function all(sql, args = []) {
  const res = await db.execute({ sql, args });
  return res.rows;
}

async function run(sql, args = []) {
  return db.execute({ sql, args });
}

// ── Prepared query functions (replaces stmts.*) ───────────────────────────────
const q = {
  // Users
  createUser:       (id, username, phone, display_name, password_hash, public_key) =>
    run('INSERT INTO users (id,username,phone,display_name,password_hash,public_key) VALUES (?,?,?,?,?,?)',
        [id, username, phone||null, display_name, password_hash, public_key||'']),

  getUserById:      (id)       => get('SELECT * FROM users WHERE id=?', [id]),
  getUserByUsername:(username) => get('SELECT * FROM users WHERE username=? COLLATE NOCASE', [username]),
  getUserByPhone:   (phone)    => get('SELECT * FROM users WHERE phone=?', [phone]),
  updateLastSeen:   (ts, id)   => run('UPDATE users SET last_seen=? WHERE id=?', [ts, id]),
  updateProfile:    (display_name, bio, avatar, id) =>
    run('UPDATE users SET display_name=?,bio=?,avatar=? WHERE id=?', [display_name, bio, avatar, id]),
  updatePublicKey:  (key, id)  => run('UPDATE users SET public_key=? WHERE id=?', [key, id]),
  searchUsers:      (q1, q2, excludeId) =>
    all('SELECT id,username,display_name,bio,avatar,last_seen,public_key FROM users WHERE (username LIKE ? OR display_name LIKE ?) AND id!=? LIMIT 20',
        [q1, q2, excludeId]),

  // Invite codes
  getInvite:        (code) => get('SELECT * FROM invite_codes WHERE code=?', [code]),
  createInvite:     (code, expires_at) =>
    run('INSERT INTO invite_codes (code, expires_at) VALUES (?,?)', [code, expires_at||null]),
  useInvite:        (code, user_id) =>
    run('UPDATE invite_codes SET used_by=?,used_at=unixepoch() WHERE code=?', [user_id, code]),
  listInvites:      () =>
    all('SELECT ic.*, u.username as used_by_name FROM invite_codes ic LEFT JOIN users u ON u.id=ic.used_by ORDER BY ic.created_at DESC'),

  // Chats
  createChat: (id, type, name, avatar, description, created_by) =>
    run('INSERT INTO chats (id,type,name,avatar,description,created_by) VALUES (?,?,?,?,?,?)',
        [id, type, name||null, avatar||'', description||'', created_by]),
  getChatById: (id) => get('SELECT * FROM chats WHERE id=?', [id]),
  getUserChats: (uid) =>
    all(`SELECT c.*, cm.role,
      (SELECT content    FROM messages WHERE chat_id=c.id AND deleted=0 ORDER BY created_at DESC LIMIT 1) AS last_message,
      (SELECT sender_id  FROM messages WHERE chat_id=c.id AND deleted=0 ORDER BY created_at DESC LIMIT 1) AS last_sender,
      (SELECT created_at FROM messages WHERE chat_id=c.id AND deleted=0 ORDER BY created_at DESC LIMIT 1) AS last_msg_ts,
      (SELECT COUNT(*) FROM messages m WHERE m.chat_id=c.id AND m.deleted=0
        AND NOT EXISTS(SELECT 1 FROM message_status ms WHERE ms.message_id=m.id AND ms.user_id=? AND ms.status='read')
        AND m.sender_id!=?) AS unread_count
    FROM chats c
    JOIN chat_members cm ON cm.chat_id=c.id AND cm.user_id=?
    ORDER BY COALESCE(c.last_msg_at,c.created_at) DESC`, [uid, uid, uid]),
  updateChatLastMsg: (ts, id)        => run('UPDATE chats SET last_msg_at=? WHERE id=?', [ts, id]),
  addMember:         (chat_id, user_id, role) =>
    run('INSERT OR IGNORE INTO chat_members (chat_id,user_id,role) VALUES (?,?,?)', [chat_id, user_id, role||'member']),
  removeMember:      (chat_id, user_id) => run('DELETE FROM chat_members WHERE chat_id=? AND user_id=?', [chat_id, user_id]),
  getChatMembers:    (chat_id) =>
    all('SELECT u.id,u.username,u.display_name,u.avatar,u.last_seen,cm.role FROM chat_members cm JOIN users u ON u.id=cm.user_id WHERE cm.chat_id=?', [chat_id]),
  isMember:          (chat_id, user_id) => get('SELECT 1 FROM chat_members WHERE chat_id=? AND user_id=?', [chat_id, user_id]),
  getDirectChat:     (uid1, uid2) =>
    get(`SELECT c.id FROM chats c
         JOIN chat_members a ON a.chat_id=c.id AND a.user_id=?
         JOIN chat_members b ON b.chat_id=c.id AND b.user_id=?
         WHERE c.type='direct' LIMIT 1`, [uid1, uid2]),

  // Messages
  insertMessage: (id, chat_id, sender_id, type, content, reply_to) =>
    run('INSERT INTO messages (id,chat_id,sender_id,type,content,reply_to) VALUES (?,?,?,?,?,?)',
        [id, chat_id, sender_id, type||'text', content, reply_to||null]),
  getMessages: (chat_id, limit, offset) =>
    all(`SELECT m.*,u.username,u.display_name,u.avatar,
          r.content AS reply_content, ru.display_name AS reply_sender_name
         FROM messages m
         JOIN users u ON u.id=m.sender_id
         LEFT JOIN messages r ON r.id=m.reply_to
         LEFT JOIN users ru ON ru.id=r.sender_id
         WHERE m.chat_id=? AND m.deleted=0
         ORDER BY m.created_at DESC LIMIT ? OFFSET ?`, [chat_id, limit, offset]),
  getMessage: (id) =>
    get('SELECT m.*,u.username,u.display_name,u.avatar FROM messages m JOIN users u ON u.id=m.sender_id WHERE m.id=?', [id]),
  editMessage:   (content, id, sender_id) => run('UPDATE messages SET content=?,edited=1 WHERE id=? AND sender_id=?', [content, id, sender_id]),
  deleteMessage: (id, sender_id)          => run('UPDATE messages SET deleted=1 WHERE id=? AND sender_id=?', [id, sender_id]),

  // Status
  upsertStatus: (message_id, user_id, status) =>
    run(`INSERT INTO message_status (message_id,user_id,status,updated_at) VALUES (?,?,?,unixepoch())
         ON CONFLICT(message_id,user_id) DO UPDATE SET status=excluded.status,updated_at=excluded.updated_at`,
        [message_id, user_id, status]),

  // Contacts
  addContact:   (owner_id, contact_id) => run('INSERT OR IGNORE INTO contacts (owner_id,contact_id) VALUES (?,?)', [owner_id, contact_id]),
  getContacts:  (owner_id) =>
    all('SELECT u.id,u.username,u.display_name,u.bio,u.avatar,u.last_seen,c.nickname,c.blocked FROM contacts c JOIN users u ON u.id=c.contact_id WHERE c.owner_id=? AND c.blocked=0 ORDER BY u.display_name', [owner_id]),
  blockContact: (owner_id, contact_id) => run('UPDATE contacts SET blocked=1 WHERE owner_id=? AND contact_id=?', [owner_id, contact_id]),
};

module.exports = { db, q, initSchema };
