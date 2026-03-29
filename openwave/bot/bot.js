/**
 * OpenWave Invite Bot — Zero dependencies version
 * Railway injects env vars directly. Dotenv loaded only if available (local dev).
 */
try { require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') }); } catch {}

const TOKEN        = process.env.TELEGRAM_BOT_TOKEN;
const ADMIN_ID     = String(process.env.TELEGRAM_ADMIN_ID || '');
const APP_URL      = (process.env.APP_URL || 'http://localhost:4000').replace(/\/$/, '');
const ADMIN_SECRET = process.env.ADMIN_SECRET;

if (!TOKEN)        { console.error('❌ TELEGRAM_BOT_TOKEN missing'); process.exit(1); }
if (!ADMIN_ID)     { console.error('❌ TELEGRAM_ADMIN_ID missing');  process.exit(1); }
if (!ADMIN_SECRET) { console.error('❌ ADMIN_SECRET missing');       process.exit(1); }

const https = require('https');
const http  = require('http');

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
    req.on('error', e => { console.error('Telegram API error:', e.message); resolve({}); });
    req.write(data); req.end();
  });
}

const send = (chat_id, text, extra = {}) =>
  tg('sendMessage', { chat_id, text, parse_mode: 'HTML', ...extra });

function generateInvite(expires_days = 7) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ expires_days });
    const url  = new URL(`${APP_URL}/api/admin/invite`);
    const lib  = url.protocol === 'https:' ? https : http;
    const opts = {
      hostname: url.hostname,
      port:     url.port || (url.protocol === 'https:' ? 443 : 80),
      path:     url.pathname,
      method:   'POST',
      headers:  {
        'Content-Type':   'application/json',
        'Content-Length': Buffer.byteLength(body),
        'x-admin-secret': ADMIN_SECRET,
      }
    };
    const req = lib.request(opts, res => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => {
        try { resolve(JSON.parse(raw)); }
        catch { reject(new Error('Bad response from OpenWave: ' + raw)); }
      });
    });
    req.on('error', reject);
    req.write(body); req.end();
  });
}

// pending[userId] = { name, username, reason, step }
const pending = {};

async function handle(update) {
  if (update.callback_query) {
    const cb = update.callback_query;
    await tg('answerCallbackQuery', { callback_query_id: cb.id });
    const [action, userId] = (cb.data || '').split(':');
    const r = pending[userId];

    const edit = text => tg('editMessageText', {
      chat_id: cb.message.chat.id, message_id: cb.message.message_id,
      text, parse_mode: 'HTML'
    });

    if (!r) { await edit('⚠️ This request was already handled.'); return; }

    if (action === 'approve') {
      try {
        const inv = await generateInvite(7);
        delete pending[userId];
        await send(userId,
          `🎉 <b>You're invited to OpenWave!</b>\n\n` +
          `Your personal invite link — valid 7 days, single use:\n\n` +
          `<code>${inv.link}</code>\n\n` +
          `Open it in your browser, create your account, and welcome 🌊`
        );
        await edit(`${cb.message.text}\n\n✅ <b>Approved</b> — invite sent to user`);
      } catch (err) {
        await send(ADMIN_ID, `❌ Failed to generate invite: ${err.message}\n\nMake sure APP_URL and ADMIN_SECRET are correct.`);
      }
    }

    if (action === 'deny') {
      delete pending[userId];
      await send(userId,
        `Hi, your OpenWave invite request was declined this time.\n` +
        `If you think this is a mistake, try again or reach out directly.`
      );
      await edit(`${cb.message.text}\n\n❌ <b>Denied</b>`);
    }
    return;
  }

  const msg = update.message;
  if (!msg?.text) return;

  const userId   = String(msg.from.id);
  const name     = [msg.from.first_name, msg.from.last_name].filter(Boolean).join(' ') || 'User';
  const username = msg.from.username ? `@${msg.from.username}` : '(no username)';
  const text     = msg.text.trim();

  if (text === '/start') {
    if (pending[userId]?.step === 'waiting') {
      await send(msg.chat.id, `⏳ Your request is still pending. I'll message you when reviewed.`);
      return;
    }
    pending[userId] = { name, username, step: 'awaiting_reason' };
    await send(msg.chat.id,
      `👋 <b>Hey ${name}!</b>\n\n` +
      `This bot handles invite requests for <b>OpenWave</b> — a private messenger.\n\n` +
      `Tell me <b>who you are and why you'd like to join</b>. ` +
      `The owner reviews every request personally and will reply here.`
    );
    return;
  }

  if (text === '/status') {
    await send(msg.chat.id, pending[userId]
      ? `⏳ Your request is pending review.`
      : `No pending request. Send /start to apply.`
    );
    return;
  }

  if (userId === ADMIN_ID && text.startsWith('/invite')) {
    try {
      const inv = await generateInvite(7);
      await send(msg.chat.id, `✅ Invite link:\n\n<code>${inv.link}</code>\n\nExpires: ${inv.expires_at}`);
    } catch (err) { await send(msg.chat.id, `❌ Failed: ${err.message}`); }
    return;
  }

  if (userId === ADMIN_ID && text === '/pending') {
    const list = Object.entries(pending);
    if (!list.length) { await send(msg.chat.id, `No pending requests.`); return; }
    const lines = list.map(([id, r]) =>
      `• <b>${r.name}</b> ${r.username}\n  ID: <code>${id}</code>\n  "${r.reason || 'not yet provided'}"`
    ).join('\n\n');
    await send(msg.chat.id, `<b>${list.length} pending:</b>\n\n${lines}`);
    return;
  }

  if (pending[userId]?.step === 'awaiting_reason') {
    if (text.length < 15) {
      await send(msg.chat.id, `Please write a bit more — just a sentence about yourself.`);
      return;
    }
    pending[userId].reason = text;
    pending[userId].step   = 'waiting';

    await send(msg.chat.id,
      `✅ <b>Request submitted!</b>\n\n` +
      `The owner will review it personally. ` +
      `You'll get a message here when approved or declined.\n\n` +
      `Use /status to check anytime.`
    );

    await send(ADMIN_ID,
      `📬 <b>New invite request</b>\n\n` +
      `<b>Name:</b> ${name}\n` +
      `<b>Telegram:</b> ${username}\n` +
      `<b>User ID:</b> <code>${userId}</code>\n\n` +
      `<b>Message:</b>\n"${text}"`,
      {
        reply_markup: {
          inline_keyboard: [[
            { text: '✅ Approve — send invite', callback_data: `approve:${userId}` },
            { text: '❌ Deny',                  callback_data: `deny:${userId}` }
          ]]
        }
      }
    );
    return;
  }

  if (!pending[userId]) {
    await send(msg.chat.id, `Send /start to request an invite to OpenWave.`);
  } else {
    await send(msg.chat.id, `⏳ Your request is pending. Use /status to check.`);
  }
}

let offset = 0;
async function poll() {
  try {
    const res = await tg('getUpdates', {
      offset, timeout: 30,
      allowed_updates: ['message', 'callback_query']
    });
    if (res.ok && res.result?.length) {
      for (const u of res.result) {
        offset = u.update_id + 1;
        handle(u).catch(e => console.error('Handler error:', e.message));
      }
    }
  } catch (e) {
    console.error('Poll error:', e.message);
    await new Promise(r => setTimeout(r, 5000));
  }
  setTimeout(poll, 100);
}

async function start() {
  const me = await tg('getMe');
  if (!me.ok) {
    console.error('❌ Invalid bot token — check TELEGRAM_BOT_TOKEN');
    process.exit(1);
  }

  await tg('setMyCommands', { commands: [
    { command: 'start',  description: 'Request an invite to OpenWave' },
    { command: 'status', description: 'Check your request status' },
  ]}).catch(() => {});

  console.log(`\n  🤖  OpenWave Invite Bot\n  Bot: @${me.result.username}\n  Admin: ${ADMIN_ID}\n  App:   ${APP_URL}\n`);

  // Test connection to OpenWave
  try {
    const testUrl = new URL(`${APP_URL}/health`);
    const lib = testUrl.protocol === 'https:' ? https : http;
    await new Promise((resolve) => {
      const req = lib.get(testUrl.href, res => { res.resume(); resolve(); });
      req.on('error', e => { console.warn('⚠️  Could not reach OpenWave at', APP_URL, '—', e.message); resolve(); });
    });
    console.log('  ✓ OpenWave reachable\n');
  } catch {}

  poll();
}

start();
