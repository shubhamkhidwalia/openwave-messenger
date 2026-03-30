/**
 * OpenWave Invite Bot — Webhook + Long-polling hybrid
 * Extremely verbose logging to debug any issues
 */
'use strict';

// Load .env only if running locally
try { require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') }); } catch {}

const TOKEN        = (process.env.TELEGRAM_BOT_TOKEN || '').trim();
const ADMIN_ID     = (process.env.TELEGRAM_ADMIN_ID  || '').trim();
const APP_URL      = (process.env.APP_URL             || 'http://localhost:4000').replace(/\/$/, '');
const ADMIN_SECRET = (process.env.ADMIN_SECRET        || '').trim();

console.log('[CONFIG] TOKEN set:', !!TOKEN);
console.log('[CONFIG] ADMIN_ID:', ADMIN_ID);
console.log('[CONFIG] APP_URL:', APP_URL);
console.log('[CONFIG] ADMIN_SECRET set:', !!ADMIN_SECRET);

if (!TOKEN)        { console.error('[FATAL] TELEGRAM_BOT_TOKEN not set'); process.exit(1); }
if (!ADMIN_ID)     { console.error('[FATAL] TELEGRAM_ADMIN_ID not set');  process.exit(1); }
if (!ADMIN_SECRET) { console.error('[FATAL] ADMIN_SECRET not set');       process.exit(1); }

const https = require('https');
const http  = require('http');

// ── Telegram ──────────────────────────────────────────────────────────────────
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
      res.on('end', () => {
        try {
          const parsed = JSON.parse(raw);
          if (!parsed.ok) console.warn(`[TG] ${method} failed:`, parsed.description);
          resolve(parsed);
        } catch { resolve({ ok: false }); }
      });
    });
    req.on('error', e => { console.error(`[TG] ${method} error:`, e.message); resolve({ ok: false }); });
    req.write(data);
    req.end();
  });
}

const send = (chat_id, text, extra = {}) => {
  console.log(`[SEND] → ${chat_id}: ${text.slice(0, 60)}`);
  return tg('sendMessage', { chat_id: Number(chat_id), text, parse_mode: 'HTML', ...extra });
};

// ── OpenWave API ──────────────────────────────────────────────────────────────
function generateInvite() {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ expires_days: 7 });
    let url;
    try { url = new URL(`${APP_URL}/api/admin/invite`); }
    catch (e) { return reject(new Error('Invalid APP_URL: ' + APP_URL)); }

    const lib  = url.protocol === 'https:' ? https : http;
    const opts = {
      hostname: url.hostname,
      port:     url.port ? Number(url.port) : (url.protocol === 'https:' ? 443 : 80),
      path:     url.pathname,
      method:   'POST',
      headers:  {
        'Content-Type':   'application/json',
        'Content-Length': Buffer.byteLength(body),
        'x-admin-secret': ADMIN_SECRET,
      }
    };
    console.log('[INVITE] Requesting from', url.href);
    const req = lib.request(opts, res => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => {
        console.log('[INVITE] Response status:', res.statusCode, 'body:', raw.slice(0, 120));
        try {
          const parsed = JSON.parse(raw);
          if (parsed.error) return reject(new Error(parsed.error));
          resolve(parsed);
        } catch { reject(new Error('Bad JSON from OpenWave: ' + raw.slice(0, 100))); }
      });
    });
    req.on('error', e => { console.error('[INVITE] Request error:', e.message); reject(e); });
    req.write(body);
    req.end();
  });
}

// ── State ─────────────────────────────────────────────────────────────────────
const pending = {}; // userId → { name, username, reason, step }

// ── Handle update ─────────────────────────────────────────────────────────────
async function handle(update) {
  console.log('[UPDATE]', JSON.stringify(update).slice(0, 200));

  // ── Callback query (Approve / Deny buttons) ─────────────────────────────────
  if (update.callback_query) {
    const cb = update.callback_query;
    await tg('answerCallbackQuery', { callback_query_id: cb.id });

    const parts  = (cb.data || '').split(':');
    const action = parts[0];
    const userId = parts[1];
    console.log('[CB] action:', action, 'userId:', userId);

    const r = pending[userId];
    const editMsg = text => tg('editMessageText', {
      chat_id:    cb.message.chat.id,
      message_id: cb.message.message_id,
      text, parse_mode: 'HTML'
    });

    if (!r) {
      await editMsg('⚠️ This request was already handled or expired.');
      return;
    }

    if (action === 'approve') {
      try {
        const inv = await generateInvite();
        delete pending[userId];
        await send(userId,
          `🎉 <b>You've been approved!</b>\n\n` +
          `Here's your personal invite link — valid for 7 days, one use only:\n\n` +
          `<code>${inv.link}</code>\n\n` +
          `Open it in your browser, create your account, and welcome to OpenWave 🌊`
        );
        await editMsg(`${cb.message.text}\n\n✅ <b>Approved</b> — invite sent to user`);
      } catch (err) {
        console.error('[APPROVE] Error:', err.message);
        await send(ADMIN_ID,
          `❌ Failed to generate invite: ${err.message}\n\n` +
          `Check that APP_URL (${APP_URL}) and ADMIN_SECRET are correct in Railway variables.`
        );
      }
    }

    if (action === 'deny') {
      delete pending[userId];
      await send(userId,
        `Hi ${r.name},\n\n` +
        `Your OpenWave invite request was declined this time.\n` +
        `If you think this is a mistake, feel free to try again.`
      );
      await editMsg(`${cb.message.text}\n\n❌ <b>Denied</b>`);
    }
    return;
  }

  // ── Regular message ──────────────────────────────────────────────────────────
  const msg = update.message;
  if (!msg?.text) return;

  const userId   = String(msg.from.id);
  const name     = [msg.from.first_name, msg.from.last_name].filter(Boolean).join(' ') || 'User';
  const username = msg.from.username ? `@${msg.from.username}` : '(no username)';
  const text     = msg.text.trim();

  console.log(`[MSG] from ${userId} (${name}): ${text.slice(0, 80)}`);
  console.log(`[MSG] ADMIN_ID is "${ADMIN_ID}", userId is "${userId}", match: ${userId === ADMIN_ID}`);

  // /start
  if (text === '/start') {
    if (pending[userId]?.step === 'waiting') {
      await send(msg.chat.id, `⏳ Your request is pending. I'll message you when reviewed.`);
      return;
    }
    pending[userId] = { name, username, step: 'awaiting_reason' };
    await send(msg.chat.id,
      `👋 <b>Hey ${name}!</b>\n\n` +
      `This bot handles invite requests for <b>OpenWave</b> — a private, invite-only messenger.\n\n` +
      `Tell me <b>who you are and why you'd like to join</b>. ` +
      `The owner reviews every request personally.`
    );
    return;
  }

  // /status
  if (text === '/status') {
    await send(msg.chat.id, pending[userId]
      ? `⏳ Your request is still pending. The owner will reply here.`
      : `No pending request. Send /start to apply.`
    );
    return;
  }

  // Admin: /test — verify bot is working and can reach OpenWave
  if (text === '/test' && userId === ADMIN_ID) {
    await send(msg.chat.id, `🔍 Testing...\nAdmin ID: <code>${ADMIN_ID}</code>\nApp URL: <code>${APP_URL}</code>`);
    try {
      const inv = await generateInvite();
      await send(msg.chat.id, `✅ OpenWave connection works!\nTest invite: <code>${inv.link}</code>`);
    } catch (err) {
      await send(msg.chat.id, `❌ OpenWave error: ${err.message}`);
    }
    return;
  }

  // Admin: /invite — generate invite manually
  if (text.startsWith('/invite') && userId === ADMIN_ID) {
    try {
      const inv = await generateInvite();
      await send(msg.chat.id, `✅ Invite:\n<code>${inv.link}</code>\nExpires: ${inv.expires_at}`);
    } catch (err) { await send(msg.chat.id, `❌ ${err.message}`); }
    return;
  }

  // Admin: /pending — list pending requests
  if (text === '/pending' && userId === ADMIN_ID) {
    const list = Object.entries(pending);
    if (!list.length) { await send(msg.chat.id, `No pending requests.`); return; }
    const lines = list.map(([id, r]) =>
      `• <b>${r.name}</b> ${r.username} — ID: <code>${id}</code>\n  "${r.reason || 'no reason yet'}"`
    ).join('\n\n');
    await send(msg.chat.id, `<b>${list.length} pending:</b>\n\n${lines}`);
    return;
  }

  // Admin: /whoami — debug
  if (text === '/whoami' && userId === ADMIN_ID) {
    await send(msg.chat.id,
      `👤 You are the admin\n` +
      `Your ID: <code>${userId}</code>\n` +
      `Pending requests: ${Object.keys(pending).length}\n` +
      `App: ${APP_URL}`
    );
    return;
  }

  // Collecting reason from user
  if (pending[userId]?.step === 'awaiting_reason') {
    if (text.length < 10) {
      await send(msg.chat.id, `Please write a bit more — just a sentence about yourself.`);
      return;
    }
    pending[userId].reason = text;
    pending[userId].step   = 'waiting';

    await send(msg.chat.id,
      `✅ <b>Request submitted!</b>\n\n` +
      `The owner will review it personally and reply here.\n` +
      `Use /status anytime to check.`
    );

    // Notify admin
    const r = pending[userId];
    console.log(`[NOTIFY] Sending to admin ${ADMIN_ID}`);
    const result = await send(ADMIN_ID,
      `📬 <b>New OpenWave invite request</b>\n\n` +
      `<b>Name:</b> ${name}\n` +
      `<b>Telegram:</b> ${username}\n` +
      `<b>User ID:</b> <code>${userId}</code>\n\n` +
      `<b>Message:</b>\n"${text}"`,
      {
        reply_markup: {
          inline_keyboard: [[
            { text: '✅ Approve & send invite', callback_data: `approve:${userId}` },
            { text: '❌ Deny',                  callback_data: `deny:${userId}` }
          ]]
        }
      }
    );
    console.log('[NOTIFY] Admin notification result:', JSON.stringify(result).slice(0, 100));
    return;
  }

  // Fallback
  if (!pending[userId]) {
    await send(msg.chat.id, `Send /start to request an invite to OpenWave.`);
  } else {
    await send(msg.chat.id, `⏳ Your request is pending. Use /status to check.`);
  }
}

// ── Polling ───────────────────────────────────────────────────────────────────
let offset = 0;
let polling = true;

async function poll() {
  if (!polling) return;
  try {
    const res = await tg('getUpdates', {
      offset,
      timeout: 25,
      allowed_updates: ['message', 'callback_query']
    });
    if (res.ok && Array.isArray(res.result)) {
      for (const u of res.result) {
        offset = u.update_id + 1;
        handle(u).catch(e => console.error('[HANDLE] Error:', e.message));
      }
    }
  } catch (e) {
    console.error('[POLL] Error:', e.message);
    await new Promise(r => setTimeout(r, 3000));
  }
  setTimeout(poll, 200);
}

// ── Start ─────────────────────────────────────────────────────────────────────
async function start() {
  console.log('[START] Fetching bot info...');
  const me = await tg('getMe');
  if (!me.ok) {
    console.error('[FATAL] Invalid token. getMe returned:', JSON.stringify(me));
    process.exit(1);
  }

  console.log(`[START] Bot: @${me.result.username} (ID: ${me.result.id})`);

  // Delete any existing webhook so long-polling works
  await tg('deleteWebhook', { drop_pending_updates: false });
  console.log('[START] Webhook cleared');

  await tg('setMyCommands', { commands: [
    { command: 'start',  description: 'Request an invite to OpenWave' },
    { command: 'status', description: 'Check your request status' },
  ]}).catch(() => {});

  // Send startup message to admin
  await send(ADMIN_ID,
    `🟢 <b>OpenWave Bot started</b>\n\n` +
    `Connected to: <code>${APP_URL}</code>\n` +
    `Your admin ID: <code>${ADMIN_ID}</code>\n\n` +
    `Commands:\n/test — verify connection\n/invite — generate invite\n/pending — list requests\n/whoami — debug info`
  );

  console.log('[START] Polling started...');
  poll();
}

process.on('SIGTERM', () => { polling = false; console.log('[EXIT] SIGTERM received'); });
process.on('SIGINT',  () => { polling = false; console.log('[EXIT] SIGINT received'); process.exit(0); });

start().catch(e => { console.error('[FATAL]', e.message); process.exit(1); });
