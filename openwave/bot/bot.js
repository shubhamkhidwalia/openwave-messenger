/**
 * OpenWave Invite Request Bot
 * No dependencies — uses Node.js built-in https module only.
 *
 * Flow:
 *   User → /start → explains what they want → YOU get notified
 *   YOU → tap Approve → invite link auto-sent to them
 *   YOU → tap Deny   → polite decline sent to them
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const TOKEN        = process.env.TELEGRAM_BOT_TOKEN;
const ADMIN_ID     = String(process.env.TELEGRAM_ADMIN_ID);
const APP_URL      = process.env.APP_URL || 'http://localhost:4000';
const ADMIN_SECRET = process.env.ADMIN_SECRET;

if (!TOKEN || !ADMIN_ID || !ADMIN_SECRET) {
  console.error('❌ Missing env vars: TELEGRAM_BOT_TOKEN, TELEGRAM_ADMIN_ID, ADMIN_SECRET');
  process.exit(1);
}

const https = require('https');
const http  = require('http');

// ── Telegram API ──────────────────────────────────────────────────────────────
function tg(method, body = {}) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req  = https.request({
      hostname: 'api.telegram.org',
      path:     `/bot${TOKEN}/${method}`,
      method:   'POST',
      headers:  { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
    }, res => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => { try { resolve(JSON.parse(raw)); } catch { resolve({}); } });
    });
    req.on('error', reject);
    req.write(data); req.end();
  });
}

const send = (chat_id, text, extra = {}) =>
  tg('sendMessage', { chat_id, text, parse_mode: 'HTML', ...extra });

// ── OpenWave API ──────────────────────────────────────────────────────────────
function generateInvite(expires_days = 7) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ expires_days });
    const url  = new URL(`${APP_URL}/api/admin/invite`);
    const lib  = url.protocol === 'https:' ? https : http;
    const req  = lib.request({
      hostname: url.hostname,
      port:     url.port || (url.protocol === 'https:' ? 443 : 80),
      path:     url.pathname,
      method:   'POST',
      headers:  {
        'Content-Type':   'application/json',
        'Content-Length': Buffer.byteLength(body),
        'x-admin-secret': ADMIN_SECRET,
      }
    }, res => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => { try { resolve(JSON.parse(raw)); } catch { reject(new Error('Bad response')); } });
    });
    req.on('error', reject);
    req.write(body); req.end();
  });
}

// ── State (in-memory — survives as long as bot is running) ───────────────────
// pending[userId] = { name, username, reason, step }
const pending = {};

// ── Update handler ────────────────────────────────────────────────────────────
async function handle(update) {

  // Admin taps Approve / Deny button
  if (update.callback_query) {
    const cb = update.callback_query;
    await tg('answerCallbackQuery', { callback_query_id: cb.id });
    const [action, userId] = cb.data.split(':');
    const r = pending[userId];

    const editText = (text) => tg('editMessageText', {
      chat_id:    cb.message.chat.id,
      message_id: cb.message.message_id,
      text,
      parse_mode: 'HTML',
    });

    if (!r) { await editText('⚠️ This request was already handled.'); return; }

    if (action === 'approve') {
      try {
        const inv = await generateInvite(7);
        delete pending[userId];
        await send(userId,
          `🎉 <b>You're in!</b>\n\n` +
          `Here's your personal invite link — valid for 7 days, single use:\n\n` +
          `<code>${inv.link}</code>\n\n` +
          `Open it in your browser, create your account, and welcome to OpenWave 🌊`
        );
        await editText(`${cb.message.text}\n\n✅ <b>Approved</b> — invite link sent`);
      } catch (err) {
        await send(ADMIN_ID, `❌ Failed to generate invite: ${err.message}`);
      }
    }

    if (action === 'deny') {
      delete pending[userId];
      await send(userId,
        `Hi ${r.name},\n\n` +
        `Your request to join OpenWave was declined this time.\n` +
        `If you think this is a mistake, reach out directly.`
      );
      await editText(`${cb.message.text}\n\n❌ <b>Denied</b>`);
    }
    return;
  }

  const msg = update.message;
  if (!msg?.text) return;

  const userId   = String(msg.from.id);
  const name     = [msg.from.first_name, msg.from.last_name].filter(Boolean).join(' ') || 'Unknown';
  const username = msg.from.username ? `@${msg.from.username}` : '(no username)';
  const text     = msg.text.trim();

  // ── /start ────────────────────────────────────────────────────────────────
  if (text === '/start') {
    if (pending[userId]?.step === 'waiting') {
      await send(msg.chat.id, `⏳ Your request is still pending. I'll message you when it's reviewed.`);
      return;
    }
    pending[userId] = { name, username, step: 'awaiting_reason' };
    await send(msg.chat.id,
      `👋 <b>Hey ${name}!</b>\n\n` +
      `This bot handles invite requests for <b>OpenWave</b> — a private, invite-only messenger.\n\n` +
      `Tell me <b>who you are and why you'd like to join</b> in a few sentences. ` +
      `The owner reviews every request personally.`
    );
    return;
  }

  // ── /status ───────────────────────────────────────────────────────────────
  if (text === '/status') {
    if (pending[userId]) await send(msg.chat.id, `⏳ Your request is still pending review. Hang tight!`);
    else                 await send(msg.chat.id, `No pending request found. Send /start to submit one.`);
    return;
  }

  // ── Admin: /invite  ───────────────────────────────────────────────────────
  if (userId === ADMIN_ID && text.startsWith('/invite')) {
    try {
      const inv = await generateInvite(7);
      await send(msg.chat.id, `✅ Invite generated:\n\n<code>${inv.link}</code>\n\nExpires: ${inv.expires_at}`);
    } catch (err) { await send(msg.chat.id, `❌ Failed: ${err.message}`); }
    return;
  }

  // ── Admin: /pending ───────────────────────────────────────────────────────
  if (userId === ADMIN_ID && text === '/pending') {
    const list = Object.entries(pending);
    if (!list.length) { await send(msg.chat.id, `No pending requests right now.`); return; }
    const lines = list.map(([id, r]) =>
      `• <b>${r.name}</b> ${r.username}\n  ID: <code>${id}</code>\n  "${r.reason || 'not yet provided'}"`
    ).join('\n\n');
    await send(msg.chat.id, `<b>${list.length} pending request(s):</b>\n\n${lines}`);
    return;
  }

  // ── Collecting reason ─────────────────────────────────────────────────────
  if (pending[userId]?.step === 'awaiting_reason') {
    if (text.length < 15) {
      await send(msg.chat.id, `Please write a bit more — just a sentence about yourself is enough.`);
      return;
    }
    pending[userId].reason = text;
    pending[userId].step   = 'waiting';

    await send(msg.chat.id,
      `✅ <b>Request sent!</b>\n\n` +
      `The owner will review it personally. ` +
      `You'll get a message here when it's approved or declined.\n\n` +
      `Use /status to check anytime.`
    );

    // Notify admin
    await send(ADMIN_ID,
      `📬 <b>New invite request</b>\n\n` +
      `<b>Name:</b> ${name}\n` +
      `<b>Telegram:</b> ${username}\n` +
      `<b>User ID:</b> <code>${userId}</code>\n\n` +
      `<b>Their message:</b>\n"${text}"`,
      {
        reply_markup: {
          inline_keyboard: [[
            { text: '✅ Approve — send invite', callback_data: `approve:${userId}` },
            { text: '❌ Deny',                  callback_data: `deny:${userId}`    }
          ]]
        }
      }
    );
    return;
  }

  // ── Fallback ──────────────────────────────────────────────────────────────
  if (!pending[userId]) {
    await send(msg.chat.id, `Send /start to request an invite to OpenWave.`);
  } else {
    await send(msg.chat.id, `⏳ Your request is pending. Use /status to check.`);
  }
}

// ── Long-polling loop ─────────────────────────────────────────────────────────
let offset = 0;
async function poll() {
  try {
    const res = await tg('getUpdates', { offset, timeout: 30, allowed_updates: ['message','callback_query'] });
    if (res.ok) {
      for (const u of res.result) {
        offset = u.update_id + 1;
        handle(u).catch(e => console.error('Error:', e.message));
      }
    }
  } catch (e) {
    console.error('Poll error:', e.message);
    await new Promise(r => setTimeout(r, 5000));
  }
  poll();
}

// ── Start ─────────────────────────────────────────────────────────────────────
async function start() {
  const me = await tg('getMe');
  if (!me.ok) { console.error('Invalid bot token'); process.exit(1); }

  await tg('setMyCommands', { commands: [
    { command: 'start',  description: 'Request an invite to OpenWave' },
    { command: 'status', description: 'Check your request status' },
  ]}).catch(() => {});

  await tg('setMyDescription', {
    description: 'Request an invite to OpenWave — a private, secure messenger.\n\nSend /start to apply.'
  }).catch(() => {});

  console.log(`\n  🤖  OpenWave Invite Bot running\n  Bot: @${me.result.username}\n  Admin ID: ${ADMIN_ID}\n  App: ${APP_URL}\n`);
  poll();
}

start().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
