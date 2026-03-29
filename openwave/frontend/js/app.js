const App = (() => {
  let currentUser = null;
  let chats = [];
  let activeChatId = null;
  let messages = {};
  let typingTimers = {};
  let groupMembers = [];
  let replyTo = null;
  let msgOffset = {};
  let onlineUsers = new Set();
  let notifCounts = {};
  let starredMessages = JSON.parse(localStorage.getItem('ow_starred') || '[]');
  let reactions = JSON.parse(localStorage.getItem('ow_reactions') || '{}');
  let activeReactionMsgId = null;
  let mediaRecorder = null;
  let recordChunks = [];
  let recordTimer = null;
  let recordSeconds = 0;
  let forwardMsg = null;
  let searchResults = [];
  let searchIdx = 0;

  // ── Init ───────────────────────────────────────────────────────────────────
  async function init() {
    UI.loadTheme();
    const inviteMatch = location.pathname.match(/^\/invite\/([a-zA-Z0-9]+)$/);
    if (inviteMatch) {
      const code = inviteMatch[1];
      history.replaceState({}, '', '/');
      const token = localStorage.getItem('ow_token');
      if (!token) { showAuth('register', code); return; }
    }
    const token = localStorage.getItem('ow_token');
    if (token) {
      try { const d = await API.me(); currentUser = d.user; startApp(); }
      catch { localStorage.removeItem('ow_token'); showAuth(); }
    } else showAuth();
  }

  function showAuth(tab = 'login', prefillInvite = '') {
    document.getElementById('auth-screen').style.display = 'flex';
    document.getElementById('app').classList.add('hidden');
    setupAuthHandlers();
    if (tab === 'register' || prefillInvite) {
      document.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.auth-form').forEach(f => f.classList.remove('active'));
      document.querySelector('.auth-tab[data-tab="register"]').classList.add('active');
      document.getElementById('register-form').classList.add('active');
    }
    if (prefillInvite) {
      document.getElementById('reg-invite').value = prefillInvite;
      const b = document.getElementById('invite-banner');
      b.textContent = '🎉 You have been invited! Fill in your details to join.';
      b.style.display = 'block';
    }
  }

  function setupAuthHandlers() {
    document.querySelectorAll('.auth-tab').forEach(tab => {
      tab.onclick = () => {
        document.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.auth-form').forEach(f => f.classList.remove('active'));
        tab.classList.add('active');
        document.getElementById(tab.dataset.tab + '-form').classList.add('active');
      };
    });
    const lf = document.getElementById('login-form');
    if (!lf._bound) { lf._bound = true; lf.addEventListener('submit', async e => {
      e.preventDefault(); const btn = e.target.querySelector('button'); btn.disabled = true; btn.textContent = 'Signing in…';
      try { const d = await API.login({ username: document.getElementById('login-username').value, password: document.getElementById('login-password').value }); localStorage.setItem('ow_token', d.token); currentUser = d.user; startApp(); }
      catch (err) { document.getElementById('login-error').textContent = err.message; btn.disabled = false; btn.textContent = 'Sign In'; }
    }); }
    const rf = document.getElementById('register-form');
    if (!rf._bound) { rf._bound = true; rf.addEventListener('submit', async e => {
      e.preventDefault(); const btn = e.target.querySelector('button'); btn.disabled = true; btn.textContent = 'Creating…';
      try {
        // Human verification
        if (typeof checkCaptcha === 'function' && !checkCaptcha()) {
          document.getElementById('reg-error').textContent = 'Wrong answer — try the math question again';
          if (typeof refreshCaptcha === 'function') refreshCaptcha();
          btn.disabled = false; btn.textContent = 'Create Account'; return;
        }
        const d = await API.register({ username: document.getElementById('reg-username').value, display_name: document.getElementById('reg-name').value, phone: document.getElementById('reg-phone').value || undefined, password: document.getElementById('reg-password').value, invite_code: document.getElementById('reg-invite').value.trim() });
        localStorage.setItem('ow_token', d.token); currentUser = d.user; startApp();
      }
      catch (err) { document.getElementById('reg-error').textContent = err.message; btn.disabled = false; btn.textContent = 'Create Account'; }
    }); }
  }

  async function startApp() {
    document.getElementById('auth-screen').style.display = 'none';
    document.getElementById('app').classList.remove('hidden');
    updateMenuProfile(); setupEventListeners();
    WS.connect(localStorage.getItem('ow_token')); setupWSHandlers();
    await loadChats();
  }

  function updateMenuProfile() {
    if (!currentUser) return;
    const av = document.getElementById('menu-avatar');
    if (currentUser.avatar) av.innerHTML = `<img src="${currentUser.avatar}" style="width:100%;height:100%;object-fit:cover">`;
    else { av.style.background = UI.colorForName(currentUser.display_name); av.textContent = UI.initials(currentUser.display_name); }
    document.getElementById('menu-display-name').textContent = currentUser.display_name;
    document.getElementById('menu-username').textContent = '@' + currentUser.username;
  }

  function setupEventListeners() {
    document.getElementById('theme-btn').onclick = () => UI.setTheme(document.documentElement.getAttribute('data-theme') !== 'dark');
    document.getElementById('menu-btn').onclick = openMenu;
    document.getElementById('compose-btn').onclick = () => { document.getElementById('modal-new-chat').classList.remove('hidden'); document.getElementById('user-search-input').value = ''; document.getElementById('user-search-results').innerHTML = ''; setTimeout(() => document.getElementById('user-search-input').focus(), 50); };
    document.getElementById('starred-btn').onclick = showStarred;

    const si = document.getElementById('search-input');
    si.oninput = e => { const q = e.target.value; document.getElementById('clear-search').classList.toggle('hidden', !q); filterChatList(q); };
    document.getElementById('clear-search').onclick = () => { si.value = ''; document.getElementById('clear-search').classList.add('hidden'); renderChatList(); };

    const input = document.getElementById('msg-input');
    input.oninput = () => { autoGrow(input); toggleSendBtn(); if (activeChatId) WS.onInputTyping(activeChatId); };
    input.onkeydown = e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } };
    document.getElementById('send-btn').onclick = sendMessage;
    document.getElementById('attach-btn').onclick = () => document.getElementById('file-input').click();
    document.getElementById('file-input').onchange = async e => { const f = e.target.files[0]; if (!f || !activeChatId) return; e.target.value = ''; await sendFile(f); };
    document.getElementById('chat-menu-btn').onclick = () => document.getElementById('chat-dropdown').classList.toggle('hidden');
    document.getElementById('chat-search-btn').onclick = () => { const bar = document.getElementById('chat-search-bar'); bar.classList.toggle('open'); if (bar.classList.contains('open')) { document.getElementById('chat-search-input').focus(); } else { closeChatSearch(); } };

    // Voice recording
    setupVoiceRecorder();

    // Close reaction picker when clicking outside
    document.addEventListener('click', e => {
      if (!e.target.closest('#chat-dropdown') && !e.target.closest('#chat-menu-btn')) document.getElementById('chat-dropdown').classList.add('hidden');
      const ctx = document.getElementById('msg-ctx'); if (ctx && !ctx.contains(e.target)) ctx.remove();
      const rp = document.getElementById('reaction-picker');
      if (rp && !rp.contains(e.target) && !e.target.closest('[data-msg-id]')) { rp.classList.remove('open'); activeReactionMsgId = null; }
    });
    document.querySelectorAll('.modal').forEach(m => { m.onclick = e => { if (e.target === m) m.classList.add('hidden'); }; });
  }

  // ── Voice Recorder ─────────────────────────────────────────────────────────
  function setupVoiceRecorder() {
    const btn = document.getElementById('voice-btn');
    const timerEl = document.getElementById('record-timer');
    let pressTimer = null;

    const startRecord = async () => {
      if (!navigator.mediaDevices) { UI.toast('Microphone not available'); return; }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        recordChunks = []; recordSeconds = 0;
        mediaRecorder = new MediaRecorder(stream);
        mediaRecorder.ondataavailable = e => recordChunks.push(e.data);
        mediaRecorder.onstop = () => { stream.getTracks().forEach(t => t.stop()); sendVoiceNote(); };
        mediaRecorder.start();
        btn.classList.add('recording');
        timerEl.classList.add('visible');
        recordTimer = setInterval(() => { recordSeconds++; timerEl.textContent = `${Math.floor(recordSeconds/60)}:${String(recordSeconds%60).padStart(2,'0')}`; }, 1000);
      } catch { UI.toast('Microphone access denied'); }
    };

    const stopRecord = () => {
      if (mediaRecorder && mediaRecorder.state === 'recording') { mediaRecorder.stop(); }
      btn.classList.remove('recording');
      timerEl.classList.remove('visible');
      clearInterval(recordTimer); recordSeconds = 0; timerEl.textContent = '0:00';
    };

    // Touch and hold on mobile, click toggle on desktop
    btn.addEventListener('touchstart', e => { e.preventDefault(); pressTimer = setTimeout(startRecord, 200); }, { passive: false });
    btn.addEventListener('touchend', e => { e.preventDefault(); clearTimeout(pressTimer); if (mediaRecorder && mediaRecorder.state === 'recording') stopRecord(); else startRecord().then(stopRecord); });
    btn.addEventListener('click', () => {
      if (mediaRecorder && mediaRecorder.state === 'recording') stopRecord();
      else startRecord();
    });
  }

  async function sendVoiceNote() {
    if (!recordChunks.length || !activeChatId) return;
    const blob = new Blob(recordChunks, { type: 'audio/webm' });
    const file = new File([blob], `voice-${Date.now()}.webm`, { type: 'audio/webm' });
    UI.toast('Sending voice note…', 5000);
    try {
      const data = await API.upload(file);
      const duration = recordSeconds || 1;
      const res = await API.sendMessage(activeChatId, { type: 'file', content: JSON.stringify({ url: data.url, name: 'Voice message', size: blob.size, voice: true, duration }) });
      if (!messages[activeChatId]) messages[activeChatId] = [];
      messages[activeChatId].push(res.message);
      appendMessage(res.message);
    } catch { UI.toast('Failed to send voice note'); }
  }

  // ── WS Handlers ────────────────────────────────────────────────────────────
  function setupWSHandlers() {
    WS.on('connected', () => { if (activeChatId) WS.joinChat(activeChatId); });
    WS.on('new_message', data => {
      const { message, chat_id } = data;
      if (!messages[chat_id]) messages[chat_id] = [];
      messages[chat_id].push(message);
      const isActive = chat_id === activeChatId, isVisible = !document.hidden;
      if (isActive && isVisible) { appendMessage(message); API.markRead(message.id).catch(() => {}); }
      else { if (!isActive) { const c = chats.find(c => c.id === chat_id); if (c) c.unread_count = (c.unread_count||0)+1; } notifyMessage(message, chats.find(c => c.id === chat_id)); if (isActive) { appendMessage(message); API.markRead(message.id).catch(() => {}); } }
      updateChatPreview(chat_id, message);
    });
    WS.on('message_edited', data => {
      const { message, chat_id } = data;
      if (messages[chat_id]) { const i = messages[chat_id].findIndex(m => m.id === message.id); if (i !== -1) messages[chat_id][i] = message; }
      if (chat_id === activeChatId) { const el = document.querySelector(`[data-msg-id="${message.id}"] .bubble-text`); if (el) { el.innerHTML = UI.linkify(message.content); el.closest('.bubble').classList.add('edited'); } }
    });
    WS.on('message_deleted', data => {
      if (messages[data.chat_id]) messages[data.chat_id] = messages[data.chat_id].filter(m => m.id !== data.message_id);
      if (data.chat_id === activeChatId) document.querySelector(`[data-msg-id="${data.message_id}"]`)?.remove();
    });
    WS.on('typing_start', data => { if (data.chat_id !== activeChatId) return; document.getElementById('typing-text').textContent = `${data.display_name} is typing…`; document.getElementById('typing-banner').classList.remove('hidden'); clearTimeout(typingTimers[data.user_id]); typingTimers[data.user_id] = setTimeout(hideTyping, 3000); });
    WS.on('typing_stop', data => { clearTimeout(typingTimers[data.user_id]); hideTyping(); });
    WS.on('presence', data => {
      if (data.status === 'online') onlineUsers.add(data.user_id); else onlineUsers.delete(data.user_id);
      document.querySelectorAll(`[data-user-id="${data.user_id}"] .online-dot`).forEach(el => el.style.display = data.status==='online'?'block':'none');
      if (activeChatId) { const c = chats.find(c => c.id === activeChatId); if (c?.peer?.id === data.user_id) { const s = document.getElementById('chat-header-status'); s.textContent = data.status==='online'?'online':UI.lastSeen(data.last_seen); s.className = 'chat-header-status'+(data.status==='online'?' online':''); } }
    });
    WS.on('message_read', data => { if (data.chat_id === activeChatId) { const el = document.querySelector(`[data-msg-id="${data.message_id}"] .msg-status`); if (el) { el.textContent = '✓✓'; el.classList.add('read'); } } });
    WS.on('chat_created', data => { chats.unshift(data.chat); renderChatList(); });
  }

  // ── Chats ──────────────────────────────────────────────────────────────────
  async function loadChats() {
    try { const d = await API.getChats(); chats = d.chats||[]; renderChatList(); }
    catch { UI.toast('Failed to load chats'); }
  }

  function renderChatList() {
    const el = document.getElementById('chat-list');
    if (!chats.length) { el.innerHTML = `<div style="text-align:center;padding:3rem 1rem;color:var(--muted);font-size:14px;line-height:1.8">No chats yet<br>Tap ✏ to start one</div>`; return; }
    el.innerHTML = chats.map(chat => {
      const name = getChatName(chat), isOnline = chat.peer && onlineUsers.has(chat.peer.id);
      const avatarSrc = chat.avatar || chat.peer?.avatar;
      const preview = chat.last_message ? truncate(chat.last_message, 42) : 'No messages yet';
      return `<div class="chat-item ${chat.id===activeChatId?'active':''}" data-chat-id="${chat.id}" data-user-id="${chat.peer?.id||''}" onclick="App.openChat('${chat.id}')">
        <div class="chat-avatar" style="background:${UI.colorForName(name)}">${avatarSrc?`<img src="${avatarSrc}" style="width:100%;height:100%;object-fit:cover">`:UI.initials(name)}${isOnline?'<div class="online-dot"></div>':''}</div>
        <div class="chat-item-body">
          <div class="chat-item-top"><div class="chat-item-name">${UI.esc(name)}</div><div class="chat-item-time">${chat.last_msg_ts?UI.fmtDate(chat.last_msg_ts):''}</div></div>
          <div class="chat-item-preview"><div class="chat-item-text">${UI.esc(preview)}</div>${chat.unread_count>0?`<div class="unread-badge">${chat.unread_count}</div>`:''}</div>
        </div></div>`;
    }).join('');
  }

  function filterChatList(q) {
    const f = chats.filter(c => getChatName(c).toLowerCase().includes(q.toLowerCase()));
    const el = document.getElementById('chat-list');
    if (!f.length) { el.innerHTML = `<div style="text-align:center;padding:2rem;color:var(--muted);font-size:13px">No results</div>`; return; }
    const orig = chats; chats = f; renderChatList(); chats = orig;
  }

  function updateChatPreview(chatId, msg) {
    const chat = chats.find(c => c.id === chatId); if (!chat) return;
    chat.last_message = msg.content; chat.last_msg_ts = msg.created_at;
    chats = [chat, ...chats.filter(c => c.id !== chatId)]; renderChatList();
  }

  async function openChat(chatId) {
    if (activeChatId) WS.leaveChat();
    activeChatId = chatId;
    const chat = chats.find(c => c.id === chatId); if (!chat) return;
    chat.unread_count = 0; clearNotifCount(chatId);
    // Clear notification badge immediately before async ops
    const badgeEl = document.querySelector(`[data-chat-id="${chatId}"] .unread-badge`);
    if (badgeEl) badgeEl.remove();
    renderChatList();
    document.getElementById('splash').classList.add('hidden');
    document.getElementById('chat-view').classList.remove('hidden');
    document.getElementById('chat-area').classList.add('open');
    closeChatSearch();
    const name = getChatName(chat), avatarSrc = chat.avatar || chat.peer?.avatar;
    const ha = document.getElementById('chat-header-avatar');
    ha.style.background = UI.colorForName(name);
    ha.innerHTML = avatarSrc ? `<img src="${avatarSrc}" style="width:100%;height:100%;object-fit:cover">` : UI.initials(name);
    document.getElementById('chat-header-name').textContent = name;
    const s = document.getElementById('chat-header-status');
    if (chat.type === 'direct' && chat.peer) { const on = onlineUsers.has(chat.peer.id); s.textContent = on?'online':UI.lastSeen(chat.peer.last_seen); s.className = 'chat-header-status'+(on?' online':''); }
    else { s.textContent = `${(chat.members||[]).length} members`; s.className = 'chat-header-status'; }
    msgOffset[chatId] = 0;
    if (!messages[chatId]) await loadMessages(chatId); else renderMessages(chatId);
    WS.joinChat(chatId); document.getElementById('msg-input').focus();
  }

  async function loadMessages(chatId) {
    try { const d = await API.getMessages(chatId, 50, msgOffset[chatId]||0); messages[chatId] = d.messages; renderMessages(chatId); }
    catch { UI.toast('Failed to load messages'); }
  }

  function renderMessages(chatId) {
    const el = document.getElementById('messages-list');
    const msgs = messages[chatId]||[];
    if (!msgs.length) { el.innerHTML = `<div style="text-align:center;padding:2rem;color:var(--muted);font-size:13.5px">No messages yet.<br>Say hello! 👋</div>`; return; }
    let html = '', lastDay = null;
    msgs.forEach((msg, i) => {
      const day = UI.fmtFullDate(msg.created_at);
      if (day !== lastDay) { html += `<div class="day-divider"><span>${day}</span></div>`; lastDay = day; }
      if (msg.type === 'system') { html += `<div class="system-msg">${UI.esc(msg.content)}</div>`; return; }
      html += buildMsgHTML(msg, msg.sender_id===currentUser.id, !msgs[i+1]||msgs[i+1].sender_id!==msg.sender_id, chatId);
    });
    el.innerHTML = html;
    el.querySelectorAll('[data-msg-id]').forEach(row => {
      row.addEventListener('contextmenu', e => { e.preventDefault(); showMsgContext(e, msgs.find(m => m.id === row.dataset.msgId)); });
      row.addEventListener('touchstart', makeLongPress(row, msgs.find(m => m.id === row.dataset.msgId)), { passive: true });
    });
    scrollToBottom();
  }

  function makeLongPress(row, msg) {
    let timer;
    return (e) => {
      timer = setTimeout(() => { showReactionPicker(e.touches[0], msg, row.classList.contains('outgoing')); }, 500);
      row.addEventListener('touchend', () => clearTimeout(timer), { once: true });
      row.addEventListener('touchmove', () => clearTimeout(timer), { once: true });
    };
  }

  function buildMsgHTML(msg, isMine, showAvatar, chatId) {
    const chat = chats.find(c => c.id === chatId), isGroup = chat?.type === 'group';
    const isStarred = starredMessages.includes(msg.id);
    const msgReactions = reactions[msg.id] || {};

    let replyHTML = '';
    if (msg.reply_to && msg.reply_content) replyHTML = `<div class="reply-bubble"><div class="reply-name">${UI.esc(msg.reply_sender_name||'')}</div><div class="reply-text">${UI.esc(msg.reply_content)}</div></div>`;

    let content = '';
    if (msg.type === 'image') content = `<img class="bubble-image" src="${UI.esc(msg.content)}" onclick="window.open('${UI.esc(msg.content)}')">`;
    else if (msg.type === 'file') {
      try {
        const f = JSON.parse(msg.content);
        if (f.voice) {
          const bars = Array.from({length:20}, (_,i) => `<div class="voice-bar" style="height:${Math.max(4, Math.random()*22)}px"></div>`).join('');
          content = `<div class="voice-msg"><button class="voice-play" onclick="playVoice(this,'${f.url}')">▶</button><div class="voice-wave" onclick="playVoice(this.previousElementSibling,'${f.url}')">${bars}</div><span class="voice-duration">${formatDuration(f.duration||0)}</span></div>`;
        } else {
          content = `<a href="${UI.esc(f.url)}" target="_blank" style="display:flex;align-items:center;gap:8px;color:inherit;text-decoration:none"><span style="font-size:22px">📎</span><span style="font-size:13px">${UI.esc(f.name)}<br><span style="opacity:.6;font-size:11px">${(f.size/1024).toFixed(1)} KB</span></span></a>`;
        }
      } catch { content = UI.linkify(msg.content); }
    } else content = `<div class="bubble-text">${UI.linkify(msg.content)}</div>`;

    const reactionsHTML = Object.keys(msgReactions).length ? `<div class="reactions">${Object.entries(msgReactions).map(([emoji, users]) => `<div class="reaction-chip ${users.includes(currentUser.id)?'mine':''}" onclick="App.addReaction('${emoji}','${msg.id}')">${emoji}<span>${users.length}</span></div>`).join('')}</div>` : '';
    const statusIcon = isMine ? `<span class="msg-status">${msg.delivered?'✓✓':'✓'}</span>` : '';

    return `<div class="msg-row ${isMine?'outgoing':'incoming'}" data-msg-id="${msg.id}">
      ${!isMine?`<div class="msg-avatar ${showAvatar?'':'invisible'}" style="background:${UI.colorForName(msg.display_name||'')}">${msg.avatar?`<img src="${msg.avatar}" style="width:100%;height:100%;object-fit:cover">`:UI.initials(msg.display_name||'?')}</div>`:''}
      <div>
        <div class="bubble ${msg.edited?'edited':''} ${isStarred?'starred':''}">
          ${isGroup&&!isMine?`<div class="bubble-sender">${UI.esc(msg.display_name||'')}</div>`:''}
          ${replyHTML}${content}
          <div class="bubble-meta"><span class="bubble-time">${UI.fmtTime(msg.created_at)}</span>${statusIcon}</div>
        </div>
        ${reactionsHTML}
      </div>
    </div>`;
  }

  function appendMessage(msg) {
    const el = document.getElementById('messages-list');
    el.querySelector('[style*="No messages"]')?.remove();
    const isMine = msg.sender_id === currentUser.id;
    const div = document.createElement('div');
    div.innerHTML = buildMsgHTML(msg, isMine, true, activeChatId);
    const row = div.firstElementChild;
    el.appendChild(row);
    row.addEventListener('contextmenu', e => { e.preventDefault(); showMsgContext(e, msg); });
    row.addEventListener('touchstart', makeLongPress(row, msg), { passive: true });
    scrollToBottom();
  }

  // ── Send ───────────────────────────────────────────────────────────────────
  async function sendMessage() {
    const input = document.getElementById('msg-input');
    const text = input.value.trim(); if (!text || !activeChatId) return;
    input.value = ''; autoGrow(input); toggleSendBtn();
    const payload = { content: text, type: 'text' };
    if (replyTo) { payload.reply_to = replyTo.id; cancelReply(); }
    try {
      const d = await API.sendMessage(activeChatId, payload);
      if (!messages[activeChatId]) messages[activeChatId] = [];
      messages[activeChatId].push(d.message);
      appendMessage(d.message); updateChatPreview(activeChatId, d.message);
    } catch { UI.toast('Failed to send'); input.value = text; }
  }

  async function sendFile(file) {
    UI.toast('Uploading…', 10000);
    try {
      const d = await API.upload(file);
      const isImage = file.type.startsWith('image/');
      const res = await API.sendMessage(activeChatId, { type: isImage?'image':'file', content: isImage?d.url:JSON.stringify({url:d.url,name:d.name,size:d.size}) });
      if (!messages[activeChatId]) messages[activeChatId] = [];
      messages[activeChatId].push(res.message);
      appendMessage(res.message); UI.toast('Sent');
    } catch (err) { UI.toast('Upload failed: '+err.message); }
  }

  // ── Reactions ──────────────────────────────────────────────────────────────
  function showReactionPicker(touch, msg, isOutgoing) {
    if (!msg) return;
    activeReactionMsgId = msg.id;
    const picker = document.getElementById('reaction-picker');
    picker.classList.toggle('outgoing-picker', isOutgoing);
    const x = Math.min(touch.clientX, window.innerWidth - 220);
    const y = Math.max(touch.clientY - 80, 10);
    picker.style.left = x + 'px'; picker.style.top = y + 'px';
    picker.classList.add('open');
    // Set onclick handlers with current msg
    picker.querySelectorAll('.reaction-emoji').forEach(el => {
      el.onclick = () => addReaction(el.textContent, msg.id);
    });
  }

  function addReaction(emoji, msgId) {
    const id = msgId || activeReactionMsgId; if (!id) return;
    document.getElementById('reaction-picker').classList.remove('open');
    activeReactionMsgId = null;
    if (!reactions[id]) reactions[id] = {};
    if (!reactions[id][emoji]) reactions[id][emoji] = [];
    const users = reactions[id][emoji];
    const idx = users.indexOf(currentUser.id);
    if (idx !== -1) users.splice(idx, 1); else users.push(currentUser.id);
    if (!users.length) delete reactions[id][emoji];
    if (!Object.keys(reactions[id]).length) delete reactions[id];
    localStorage.setItem('ow_reactions', JSON.stringify(reactions));
    // Re-render reactions for this message
    const row = document.querySelector(`[data-msg-id="${id}"]`); if (!row) return;
    const msgData = Object.values(messages).flat().find(m => m.id === id); if (!msgData) return;
    const existingReactions = row.querySelector('.reactions');
    const newReactions = reactions[id] && Object.keys(reactions[id]).length
      ? `<div class="reactions">${Object.entries(reactions[id]).map(([e, users]) => `<div class="reaction-chip ${users.includes(currentUser.id)?'mine':''}" onclick="App.addReaction('${e}','${id}')">${e}<span>${users.length}</span></div>`).join('')}</div>` : '';
    if (existingReactions) existingReactions.outerHTML = newReactions || '';
    else if (newReactions) { const div = document.createElement('div'); div.innerHTML = newReactions; row.querySelector('div')?.appendChild(div.firstElementChild); }
  }

  // ── Star messages ──────────────────────────────────────────────────────────
  function toggleStar(msgId) {
    const idx = starredMessages.indexOf(msgId);
    if (idx !== -1) starredMessages.splice(idx, 1); else starredMessages.push(msgId);
    localStorage.setItem('ow_starred', JSON.stringify(starredMessages));
    const row = document.querySelector(`[data-msg-id="${msgId}"] .bubble`);
    if (row) row.classList.toggle('starred', starredMessages.includes(msgId));
    UI.toast(starredMessages.includes(msgId) ? '⭐ Starred' : 'Unstarred');
  }

  function showStarred() {
    closeMenu();
    document.getElementById('modal-starred').classList.remove('hidden');
    const el = document.getElementById('starred-list');
    const allMsgs = Object.values(messages).flat();
    const starred = allMsgs.filter(m => starredMessages.includes(m.id));
    if (!starred.length) { el.innerHTML = `<div style="text-align:center;padding:2rem;color:var(--muted);font-size:14px">No starred messages yet.<br>Long-press a message and tap ⭐</div>`; return; }
    el.innerHTML = starred.map(m => {
      const chat = chats.find(c => c.id === m.chat_id);
      return `<div class="starred-item" onclick="App.jumpToMessage('${m.chat_id}','${m.id}')">
        <div class="starred-item-name">${UI.esc(m.display_name||'')} · ${UI.esc(getChatName(chat)||'')}</div>
        <div class="starred-item-text">${UI.esc(m.content?.substring(0,100)||'')}</div>
        <div class="starred-item-time">${UI.fmtDate(m.created_at)}</div>
      </div>`;
    }).join('');
  }

  async function jumpToMessage(chatId, msgId) {
    closeModal('modal-starred');
    if (chatId !== activeChatId) await openChat(chatId);
    setTimeout(() => {
      const el = document.querySelector(`[data-msg-id="${msgId}"]`);
      if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); el.classList.add('msg-highlight'); setTimeout(() => el.classList.remove('msg-highlight'), 2000); }
    }, 300);
  }

  // ── In-chat search ─────────────────────────────────────────────────────────
  function searchInChat(q) {
    const msgs = messages[activeChatId]||[];
    document.querySelectorAll('.msg-highlight').forEach(e => e.classList.remove('msg-highlight'));
    if (!q.trim()) { document.getElementById('search-count').textContent = ''; searchResults = []; return; }
    searchResults = msgs.filter(m => m.content?.toLowerCase().includes(q.toLowerCase()) && m.type === 'text');
    searchIdx = searchResults.length - 1;
    document.getElementById('search-count').textContent = searchResults.length ? `${searchResults.length} result${searchResults.length!==1?'s':''}` : 'No results';
    if (searchResults.length) highlightSearchResult();
  }

  function highlightSearchResult() {
    document.querySelectorAll('.msg-highlight').forEach(e => e.classList.remove('msg-highlight'));
    const msg = searchResults[searchIdx]; if (!msg) return;
    const el = document.querySelector(`[data-msg-id="${msg.id}"]`);
    if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); el.classList.add('msg-highlight'); }
  }

  function closeChatSearch() {
    document.getElementById('chat-search-bar').classList.remove('open');
    document.getElementById('chat-search-input').value = '';
    document.getElementById('search-count').textContent = '';
    document.querySelectorAll('.msg-highlight').forEach(e => e.classList.remove('msg-highlight'));
    searchResults = [];
  }

  // ── Forward ────────────────────────────────────────────────────────────────
  function showForward(msg) {
    forwardMsg = msg;
    document.getElementById('modal-forward').classList.remove('hidden');
    const el = document.getElementById('forward-chat-list');
    el.innerHTML = chats.filter(c => c.id !== activeChatId).map(c => {
      const name = getChatName(c);
      return `<div class="user-item" onclick="App.forwardTo('${c.id}')">
        <div class="user-item-avatar" style="background:${UI.colorForName(name)}">${UI.initials(name)}</div>
        <div><div class="user-item-name">${UI.esc(name)}</div></div>
      </div>`;
    }).join('');
    if (!el.innerHTML) el.innerHTML = `<div style="padding:1.5rem;text-align:center;color:var(--muted);font-size:13.5px">No other chats to forward to</div>`;
  }

  async function forwardTo(chatId) {
    closeModal('modal-forward');
    if (!forwardMsg) return;
    try {
      const res = await API.sendMessage(chatId, { content: forwardMsg.content, type: forwardMsg.type });
      if (chatId === activeChatId) { if (!messages[chatId]) messages[chatId] = []; messages[chatId].push(res.message); appendMessage(res.message); }
      updateChatPreview(chatId, res.message);
      UI.toast('Forwarded');
    } catch { UI.toast('Forward failed'); }
    forwardMsg = null;
  }

  // ── Context menu ───────────────────────────────────────────────────────────
  function showMsgContext(e, msg) {
    document.getElementById('msg-ctx')?.remove();
    if (!msg) return;
    const isMine = msg.sender_id === currentUser.id;
    const isStarred = starredMessages.includes(msg.id);
    const menu = document.createElement('div');
    menu.id = 'msg-ctx'; menu.className = 'msg-context';
    menu.style.cssText = `top:${Math.min(e.clientY, window.innerHeight-260)}px;left:${Math.min(e.clientX, window.innerWidth-200)}px`;
    const items = [
      { label: '😊 React', action: () => { const fakeTouch = { clientX: e.clientX, clientY: e.clientY }; showReactionPicker(fakeTouch, msg, isMine); } },
      { label: '↩ Reply', action: () => startReply(msg) },
      { label: '↗ Forward', action: () => showForward(msg) },
      { label: isStarred ? '☆ Unstar' : '⭐ Star', action: () => toggleStar(msg.id) },
      ...(msg.type === 'text' ? [{ label: '📋 Copy', action: () => { navigator.clipboard?.writeText(msg.content); UI.toast('Copied'); } }] : []),
      ...(isMine && msg.type === 'text' ? [{ label: '✏ Edit', action: () => editMessagePrompt(msg) }] : []),
      ...(isMine ? [{ label: '🗑 Delete', cls: 'danger', action: () => deleteMessage(msg) }] : []),
    ];
    items.forEach(item => {
      const div = document.createElement('div');
      div.className = 'msg-context-item ' + (item.cls||'');
      div.textContent = item.label;
      div.onclick = () => { menu.remove(); item.action(); };
      menu.appendChild(div);
    });
    document.body.appendChild(menu);
  }

  async function editMessagePrompt(msg) {
    const nc = prompt('Edit message:', msg.content); if (!nc || nc === msg.content) return;
    try { await API.editMessage(msg.id, nc); }
    catch { UI.toast('Could not edit'); }
  }

  async function deleteMessage(msg) {
    if (!confirm('Delete this message?')) return;
    try {
      await API.deleteMessage(msg.id);
      messages[activeChatId] = (messages[activeChatId]||[]).filter(m => m.id !== msg.id);
      document.querySelector(`[data-msg-id="${msg.id}"]`)?.remove();
    } catch { UI.toast('Could not delete'); }
  }

  // ── Reply ──────────────────────────────────────────────────────────────────
  function startReply(msg) {
    replyTo = msg;
    document.getElementById('reply-preview').classList.remove('hidden');
    document.getElementById('reply-to-name').textContent = msg.display_name || 'Message';
    document.getElementById('reply-to-text').textContent = truncate(msg.content||'', 60);
    document.getElementById('msg-input').focus();
  }
  function cancelReply() { replyTo = null; document.getElementById('reply-preview').classList.add('hidden'); }

  // ── Typing ─────────────────────────────────────────────────────────────────
  function hideTyping() { document.getElementById('typing-banner').classList.add('hidden'); }

  // ── Notifications ──────────────────────────────────────────────────────────
  function notifyMessage(msg, chat) {
    if (!chat || msg.sender_id === currentUser?.id) return;
    if (msg.chat_id === activeChatId && !document.hidden) return;
    if (Notification.permission === 'default') { Notification.requestPermission(); return; }
    if (Notification.permission !== 'granted') return;
    notifCounts[chat.id] = (notifCounts[chat.id]||0)+1;
    const count = notifCounts[chat.id];
    const title = chat.type === 'group' ? getChatName(chat) : (msg.display_name||getChatName(chat));
    const body = chat.type === 'group' ? `${msg.display_name||''}: ${msgPreview(msg)}` : (count>1?`${count} new messages`:msgPreview(msg));
    const n = new Notification(title, { body, tag: chat.id, renotify: count===1, silent: count>1 });
    n.onclick = () => { window.focus(); notifCounts[chat.id]=0; openChat(chat.id); n.close(); };
  }
  function clearNotifCount(chatId) { notifCounts[chatId] = 0; }
  function msgPreview(msg) { return msg.type==='image'?'📷 Photo':msg.type==='file'?'📎 File':msg.content?.substring(0,60)||''; }

  // ── User search ────────────────────────────────────────────────────────────
  let searchTimer;
  async function searchUsers(q) {
    clearTimeout(searchTimer); if (!q.trim()) { document.getElementById('user-search-results').innerHTML=''; return; }
    searchTimer = setTimeout(async () => {
      try {
        const d = await API.searchUsers(q); const el = document.getElementById('user-search-results');
        if (!d.users.length) { el.innerHTML = `<div style="padding:2rem;text-align:center;color:var(--muted);font-size:13.5px">No users found</div>`; return; }
        el.innerHTML = d.users.map(u => `<div class="user-item" onclick="App.startDirectChat('${u.id}'">${UI.avatarHTML(u.display_name,u.avatar,44)}<div><div class="user-item-name">${UI.esc(u.display_name)}</div><div class="user-item-sub">@${UI.esc(u.username)}</div></div></div>`).join('');
      } catch {}
    }, 300);
  }

  async function startDirectChat(userId) {
    closeModal('modal-new-chat');
    try {
      const d = await API.openDirect(userId);
      if (!chats.find(c => c.id === d.chat.id)) chats.unshift(d.chat); else Object.assign(chats.find(c => c.id === d.chat.id), d.chat);
      renderChatList(); openChat(d.chat.id); API.addContact(userId).catch(()=>{});
    } catch (err) { UI.toast('Could not open chat: '+err.message); }
  }

  // ── Groups ─────────────────────────────────────────────────────────────────
  function showNewGroup() {
    closeMenu(); groupMembers = [];
    document.getElementById('modal-new-group').classList.remove('hidden');
    document.getElementById('group-name-input').value = '';
    document.getElementById('group-user-search').value = '';
    document.getElementById('group-user-results').innerHTML = '';
    renderSelectedMembers();
  }

  let gst;
  async function searchGroupUsers(q) {
    clearTimeout(gst); if (!q.trim()) { document.getElementById('group-user-results').innerHTML=''; return; }
    gst = setTimeout(async () => {
      const d = await API.searchUsers(q).catch(()=>({users:[]}));
      document.getElementById('group-user-results').innerHTML = d.users.map(u => `<div class="user-item" onclick="App.toggleGroupMember(${JSON.stringify(u).replace(/"/g,'&quot;')})">${UI.avatarHTML(u.display_name,u.avatar,44)}<div><div class="user-item-name">${UI.esc(u.display_name)}</div><div class="user-item-sub">@${UI.esc(u.username)}</div></div>${groupMembers.some(m=>m.id===u.id)?'<span class="user-item-check">✓</span>':''}</div>`).join('');
    }, 300);
  }

  function toggleGroupMember(user) {
    const i = groupMembers.findIndex(m=>m.id===user.id);
    if (i!==-1) groupMembers.splice(i,1); else groupMembers.push(user);
    renderSelectedMembers();
  }

  function renderSelectedMembers() {
    document.getElementById('selected-members').innerHTML = groupMembers.map(u => `<div class="selected-chip"><div class="chip-avatar" style="background:${UI.colorForName(u.display_name)}">${UI.initials(u.display_name)}</div>${UI.esc(u.display_name)}<span class="chip-remove" onclick="App.toggleGroupMember(${JSON.stringify(u).replace(/"/g,'&quot;')})">✕</span></div>`).join('');
  }

  async function createGroup() {
    const name = document.getElementById('group-name-input').value.trim();
    if (!name) { UI.toast('Enter a group name'); return; }
    try { const d = await API.createGroup({name, member_ids: groupMembers.map(m=>m.id)}); chats.unshift(d.chat); renderChatList(); closeModal('modal-new-group'); openChat(d.chat.id); }
    catch (err) { UI.toast('Failed: '+err.message); }
  }

  // ── Chat Info ──────────────────────────────────────────────────────────────
  async function showChatInfo() {
    const chat = chats.find(c=>c.id===activeChatId); if (!chat) return;
    document.getElementById('modal-chat-info').classList.remove('hidden');
    if (chat.type==='direct'&&chat.peer) {
      const u=chat.peer; document.getElementById('info-title').textContent='Profile';
      document.getElementById('info-avatar').innerHTML=UI.avatarHTML(u.display_name,u.avatar,86).replace('display:flex;','display:flex;margin:0 auto;');
      document.getElementById('info-name').textContent=u.display_name; document.getElementById('info-sub').textContent='@'+u.username;
      document.getElementById('info-bio').textContent=u.bio||'No bio'; document.getElementById('info-bio-section').style.display='block'; document.getElementById('info-actions').innerHTML='';
    } else {
      const members=await API.getChatMembers(chat.id).then(d=>d.members).catch(()=>[]);
      document.getElementById('info-title').textContent='Group Info';
      const avatarEl = document.getElementById('info-avatar');
      avatarEl.style.cssText=`background:${UI.colorForName(chat.name||'')};display:flex;align-items:center;justify-content:center;font-size:34px;font-weight:800;color:#fff;width:90px;height:90px;border-radius:50%;margin:0 auto;cursor:pointer;overflow:hidden;position:relative`;
      if (chat.avatar) { avatarEl.innerHTML=`<img src="${chat.avatar}" style="width:100%;height:100%;object-fit:cover"><div class="profile-avatar-edit">✎</div>`; }
      else { avatarEl.textContent=UI.initials(chat.name||'?'); }
      avatarEl.onclick = async () => {
        const inp = document.createElement('input'); inp.type='file'; inp.accept='image/*';
        inp.onchange = async e => {
          const f = e.target.files[0]; if (!f) return;
          try {
            const uploadData = await API.upload(f);
            await fetch(`/api/chats/${chat.id}`, { method:'PATCH', headers:{'Content-Type':'application/json','Authorization':'Bearer '+localStorage.getItem('ow_token')}, body: JSON.stringify({avatar: uploadData.url}) });
            avatarEl.innerHTML=`<img src="${uploadData.url}" style="width:100%;height:100%;object-fit:cover"><div class="profile-avatar-edit">✎</div>`;
            const c = chats.find(x=>x.id===chat.id); if (c) { c.avatar=uploadData.url; renderChatList(); const ha=document.getElementById('chat-header-avatar'); if (ha) { ha.innerHTML=`<img src="${uploadData.url}" style="width:100%;height:100%;object-fit:cover">`; } }
            UI.toast('Group photo updated ✓');
          } catch { UI.toast('Upload failed'); }
        };
        inp.click();
      };
      document.getElementById('info-name').textContent=chat.name; document.getElementById('info-sub').textContent=`${members.length} members`;
      document.getElementById('info-bio-section').style.display='none';
      const ae=document.getElementById('info-actions'); ae.innerHTML='<div style="padding:.5rem 0;font-size:12.5px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.05em">Members</div>';
      members.forEach(m=>{const div=document.createElement('div');div.className='user-item';div.style.padding='8px 0';div.innerHTML=`${UI.avatarHTML(m.display_name,m.avatar,40)}<div><div class="user-item-name">${UI.esc(m.display_name)}${m.role==='owner'?' 👑':''}</div><div class="user-item-sub">@${UI.esc(m.username)}</div></div>`;ae.appendChild(div);});
    }
  }

  // ── Settings ───────────────────────────────────────────────────────────────
  function showSettings() {
    closeMenu(); document.getElementById('modal-settings').classList.remove('hidden');
    const av=document.getElementById('settings-avatar');
    if (currentUser.avatar) av.innerHTML=`<img src="${currentUser.avatar}" style="width:100%;height:100%;object-fit:cover">`;
    else { av.style.background=UI.colorForName(currentUser.display_name); av.textContent=UI.initials(currentUser.display_name); }
    document.getElementById('settings-name').value=currentUser.display_name;
    document.getElementById('settings-bio').value=currentUser.bio||'';
    document.getElementById('settings-username-display').textContent='@'+currentUser.username;
  }

  async function uploadAvatar(input) {
    const f=input.files[0]; if (!f) return;
    try { const d=await API.upload(f); document.getElementById('settings-avatar').innerHTML=`<img src="${d.url}" style="width:100%;height:100%;object-fit:cover">`; currentUser.avatar=d.url; }
    catch { UI.toast('Upload failed'); }
  }

  async function saveSettings() {
    const name=document.getElementById('settings-name').value.trim(); if (!name) { UI.toast('Name cannot be empty'); return; }
    try { const d=await API.updateProfile({display_name:name, bio:document.getElementById('settings-bio').value, avatar:currentUser.avatar||''}); currentUser=d.user; updateMenuProfile(); closeModal('modal-settings'); UI.toast('Profile saved ✓'); }
    catch (err) { UI.toast('Failed: '+err.message); }
  }

  // ── Helpers ────────────────────────────────────────────────────────────────
  function openMenu() { document.getElementById('menu-drawer').classList.add('open'); document.getElementById('menu-overlay').classList.add('open'); }
  function closeMenu() { document.getElementById('menu-drawer').classList.remove('open'); document.getElementById('menu-overlay').classList.remove('open'); }
  function showContacts() { closeMenu(); document.getElementById('modal-new-chat').classList.remove('hidden'); document.getElementById('user-search-input').value=''; document.getElementById('user-search-results').innerHTML=''; setTimeout(()=>document.getElementById('user-search-input').focus(),50); }
  function closeChat() { document.getElementById('chat-view').classList.add('hidden'); document.getElementById('splash').classList.remove('hidden'); document.getElementById('chat-area').classList.remove('open'); if (activeChatId) WS.leaveChat(); activeChatId=null; renderChatList(); }
  function clearChatHistory() { document.getElementById('chat-dropdown').classList.add('hidden'); if (!activeChatId) return; messages[activeChatId]=[]; renderMessages(activeChatId); UI.toast('Cleared'); }
  function deleteChat() { document.getElementById('chat-dropdown').classList.add('hidden'); if (!confirm('Remove chat?')) return; chats=chats.filter(c=>c.id!==activeChatId); closeChat(); renderChatList(); }
  function getChatName(chat) { return chat?.type==='direct'?chat.peer?.display_name||'Unknown':chat?.name||'Group'; }
  function truncate(s,l) { return !s?'':(s.length>l?s.slice(0,l)+'…':s); }
  function autoGrow(el) { el.style.height='auto'; el.style.height=Math.min(el.scrollHeight,120)+'px'; }
  function toggleSendBtn() { const v=document.getElementById('msg-input').value.trim(); document.getElementById('send-btn').classList.toggle('idle',!v); document.getElementById('voice-btn').style.display=v?'none':'flex'; }
  function scrollToBottom() { const el=document.getElementById('messages-list'); el.scrollTop=el.scrollHeight; }
  function closeModal(id) { document.getElementById(id)?.classList.add('hidden'); }
  function formatDuration(s) { return `${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}`; }
  function logout() { closeMenu(); if (!confirm('Sign out?')) return; WS.disconnect(); localStorage.removeItem('ow_token'); currentUser=null; chats=[]; messages={}; activeChatId=null; document.getElementById('app').classList.add('hidden'); document.getElementById('chat-view').classList.add('hidden'); document.getElementById('splash').classList.remove('hidden'); showAuth(); }

  return { init, openChat, closeChat, startDirectChat, searchUsers, showNewGroup, searchGroupUsers, toggleGroupMember, createGroup, showChatInfo, showSettings, saveSettings, uploadAvatar, showContacts, openMenu, closeMenu, closeModal, logout, clearChatHistory, deleteChat, cancelReply, addReaction, showStarred, jumpToMessage, searchInChat, closeChatSearch, forwardTo };
})();

// Voice playback
function playVoice(btn, url) {
  if (btn._audio) { btn._audio.pause(); btn._audio=null; btn.textContent='▶'; return; }
  const audio = new Audio(url); btn._audio=audio; btn.textContent='⏸';
  const bars = btn.nextElementSibling?.querySelectorAll('.voice-bar');
  audio.addEventListener('timeupdate', () => { if (bars) { const p=audio.currentTime/audio.duration; bars.forEach((b,i) => b.classList.toggle('played', i/bars.length < p)); } });
  audio.addEventListener('ended', () => { btn.textContent='▶'; btn._audio=null; if (bars) bars.forEach(b=>b.classList.remove('played')); });
  audio.play().catch(()=>{ btn.textContent='▶'; btn._audio=null; });
}

document.addEventListener('DOMContentLoaded', () => App.init());
