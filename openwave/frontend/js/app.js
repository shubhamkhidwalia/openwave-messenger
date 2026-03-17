/**
 * OpenWave — Main Application Controller
 */
const App = (() => {
  // ── State ──────────────────────────────────────────────────────────────────
  let currentUser = null;
  let chats = [];
  let activeChatId = null;
  let messages = {};         // chatId → Message[]
  let typingTimers = {};     // chatId → timer
  let groupMembers = [];     // for new group modal
  let replyTo = null;        // Message being replied to
  let msgOffset = {};        // chatId → offset for pagination
  let onlineUsers = new Set();

  // ── Init ───────────────────────────────────────────────────────────────────
  async function init() {
    UI.loadTheme();
    const token = localStorage.getItem('ow_token');
    if (token) {
      try {
        const data = await API.me();
        currentUser = data.user;
        startApp();
      } catch {
        localStorage.removeItem('ow_token');
        showAuth();
      }
    } else {
      showAuth();
    }
  }

  function showAuth() {
    document.getElementById('auth-screen').style.display = 'flex';
    document.getElementById('app').classList.add('hidden');
    setupAuthHandlers();
  }

  function setupAuthHandlers() {
    document.querySelectorAll('.auth-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.auth-form').forEach(f => f.classList.remove('active'));
        tab.classList.add('active');
        document.getElementById(tab.dataset.tab + '-form').classList.add('active');
      });
    });

    document.getElementById('login-form').addEventListener('submit', async e => {
      e.preventDefault();
      const btn = e.target.querySelector('button');
      btn.disabled = true; btn.textContent = 'Signing in…';
      try {
        const data = await API.login({
          username: document.getElementById('login-username').value,
          password: document.getElementById('login-password').value,
        });
        localStorage.setItem('ow_token', data.token);
        currentUser = data.user;
        startApp();
      } catch (err) {
        document.getElementById('login-error').textContent = err.message;
        btn.disabled = false; btn.textContent = 'Sign In';
      }
    });

    document.getElementById('register-form').addEventListener('submit', async e => {
      e.preventDefault();
      const btn = e.target.querySelector('button');
      btn.disabled = true; btn.textContent = 'Creating…';
      try {
        const data = await API.register({
          username: document.getElementById('reg-username').value,
          display_name: document.getElementById('reg-name').value,
          phone: document.getElementById('reg-phone').value || undefined,
          password: document.getElementById('reg-password').value,
        });
        localStorage.setItem('ow_token', data.token);
        currentUser = data.user;
        startApp();
      } catch (err) {
        document.getElementById('reg-error').textContent = err.message;
        btn.disabled = false; btn.textContent = 'Create Account';
      }
    });
  }

  async function startApp() {
    document.getElementById('auth-screen').style.display = 'none';
    document.getElementById('app').classList.remove('hidden');

    updateMenuProfile();
    setupEventListeners();

    // Connect WebSocket
    WS.connect(localStorage.getItem('ow_token'));
    setupWSHandlers();

    // Load chats
    await loadChats();
  }

  function updateMenuProfile() {
    if (!currentUser) return;
    const avatarEl = document.getElementById('menu-avatar');
    const color = UI.colorForName(currentUser.display_name);
    if (currentUser.avatar) {
      avatarEl.innerHTML = `<img src="${currentUser.avatar}" style="width:100%;height:100%;object-fit:cover">`;
    } else {
      avatarEl.style.background = color;
      avatarEl.textContent = UI.initials(currentUser.display_name);
    }
    document.getElementById('menu-display-name').textContent = currentUser.display_name;
    document.getElementById('menu-username').textContent = '@' + currentUser.username;
  }

  // ── Event Listeners ────────────────────────────────────────────────────────
  function setupEventListeners() {
    // Theme toggle
    document.getElementById('theme-btn').addEventListener('click', () => {
      const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
      UI.setTheme(!isDark);
    });

    // Menu
    document.getElementById('menu-btn').addEventListener('click', openMenu);

    // Compose (new message)
    document.getElementById('compose-btn').addEventListener('click', () => {
      document.getElementById('modal-new-chat').classList.remove('hidden');
      document.getElementById('user-search-input').value = '';
      document.getElementById('user-search-results').innerHTML = '';
      setTimeout(() => document.getElementById('user-search-input').focus(), 50);
    });

    // Search
    const searchInput = document.getElementById('search-input');
    searchInput.addEventListener('input', e => {
      const q = e.target.value;
      document.getElementById('clear-search').classList.toggle('hidden', !q);
      filterChatList(q);
    });
    document.getElementById('clear-search').addEventListener('click', () => {
      searchInput.value = '';
      document.getElementById('clear-search').classList.add('hidden');
      renderChatList();
    });

    // Message input
    const input = document.getElementById('msg-input');
    input.addEventListener('input', () => {
      autoGrow(input);
      toggleSendBtn();
      if (activeChatId) WS.onInputTyping(activeChatId);
    });
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
    });

    // Send button
    document.getElementById('send-btn').addEventListener('click', sendMessage);

    // Attach
    document.getElementById('attach-btn').addEventListener('click', () => {
      document.getElementById('file-input').click();
    });
    document.getElementById('file-input').addEventListener('change', async e => {
      const file = e.target.files[0];
      if (!file || !activeChatId) return;
      e.target.value = '';
      await sendFile(file);
    });

    // Chat dropdown menu
    document.getElementById('chat-menu-btn').addEventListener('click', () => {
      document.getElementById('chat-dropdown').classList.toggle('hidden');
    });
    document.addEventListener('click', e => {
      if (!e.target.closest('#chat-dropdown') && !e.target.closest('#chat-menu-btn')) {
        document.getElementById('chat-dropdown').classList.add('hidden');
      }
      // Close msg context
      const ctx = document.getElementById('msg-ctx');
      if (ctx && !ctx.contains(e.target)) ctx.remove();
    });

    // Close modals on backdrop click
    document.querySelectorAll('.modal').forEach(m => {
      m.addEventListener('click', e => { if (e.target === m) m.classList.add('hidden'); });
    });
  }

  // ── WebSocket Handlers ─────────────────────────────────────────────────────
  function setupWSHandlers() {
    WS.on('connected', () => {
      if (activeChatId) WS.joinChat(activeChatId);
    });

    WS.on('new_message', data => {
      const { message, chat_id } = data;
      if (!messages[chat_id]) messages[chat_id] = [];
      messages[chat_id].push(message);
      if (chat_id === activeChatId) {
        appendMessage(message);
        API.markRead(message.id).catch(() => {});
      } else {
        // Update unread badge
        const chat = chats.find(c => c.id === chat_id);
        if (chat) { chat.unread_count = (chat.unread_count || 0) + 1; }
        notifyMessage(message, chat);
      }
      // Update preview in sidebar
      updateChatPreview(chat_id, message);
    });

    WS.on('message_edited', data => {
      const { message, chat_id } = data;
      if (messages[chat_id]) {
        const i = messages[chat_id].findIndex(m => m.id === message.id);
        if (i !== -1) messages[chat_id][i] = message;
      }
      if (chat_id === activeChatId) {
        const el = document.querySelector(`[data-msg-id="${message.id}"] .bubble`);
        if (el) {
          el.querySelector('.bubble-text').innerHTML = UI.linkify(message.content);
          el.classList.add('edited');
        }
      }
    });

    WS.on('message_deleted', data => {
      const { message_id, chat_id } = data;
      if (messages[chat_id]) {
        messages[chat_id] = messages[chat_id].filter(m => m.id !== message_id);
      }
      if (chat_id === activeChatId) {
        const el = document.querySelector(`[data-msg-id="${message_id}"]`);
        if (el) el.remove();
      }
    });

    WS.on('typing_start', data => {
      if (data.chat_id !== activeChatId) return;
      showTyping(data.display_name);
      clearTimeout(typingTimers[data.user_id]);
      typingTimers[data.user_id] = setTimeout(() => hideTyping(), 3000);
    });

    WS.on('typing_stop', data => {
      clearTimeout(typingTimers[data.user_id]);
      hideTyping();
    });

    WS.on('presence', data => {
      if (data.status === 'online') onlineUsers.add(data.user_id);
      else onlineUsers.delete(data.user_id);

      // Update avatar dot
      document.querySelectorAll(`[data-user-id="${data.user_id}"] .online-dot`).forEach(el => {
        el.style.display = data.status === 'online' ? 'block' : 'none';
      });

      // Update chat header if it's active
      if (activeChatId) {
        const chat = chats.find(c => c.id === activeChatId);
        if (chat?.peer?.id === data.user_id) {
          const statusEl = document.getElementById('chat-header-status');
          if (data.status === 'online') {
            statusEl.textContent = 'online';
            statusEl.classList.add('online');
          } else {
            statusEl.textContent = UI.lastSeen(data.last_seen);
            statusEl.classList.remove('online');
          }
        }
      }
    });

    WS.on('message_read', data => {
      if (data.chat_id === activeChatId) {
        const el = document.querySelector(`[data-msg-id="${data.message_id}"] .msg-status`);
        if (el) { el.textContent = '✓✓'; el.classList.add('read'); }
      }
    });

    WS.on('chat_created', data => {
      chats.unshift(data.chat);
      renderChatList();
    });
  }

  // ── Chat Loading ───────────────────────────────────────────────────────────
  async function loadChats() {
    try {
      const data = await API.getChats();
      chats = data.chats || [];
      renderChatList();
    } catch (err) {
      UI.toast('Failed to load chats');
    }
  }

  function renderChatList() {
    const el = document.getElementById('chat-list');
    if (!chats.length) {
      el.innerHTML = `<div style="text-align:center;padding:3rem 1rem;color:var(--text-muted);font-size:13.5px">No chats yet.<br>Tap ✏ to start a conversation</div>`;
      return;
    }

    el.innerHTML = chats.map(chat => {
      const name = getChatName(chat);
      const isOnline = chat.peer && onlineUsers.has(chat.peer.id);
      const avatarSrc = chat.avatar || chat.peer?.avatar;
      const preview = chat.last_message ? truncate(chat.last_message, 40) : 'No messages yet';
      return `
      <div class="chat-item ${chat.id === activeChatId ? 'active' : ''}" data-chat-id="${chat.id}" data-user-id="${chat.peer?.id || ''}" onclick="App.openChat('${chat.id}')">
        <div class="chat-avatar" style="background:${UI.colorForName(name)}">
          ${avatarSrc ? `<img src="${avatarSrc}" style="width:100%;height:100%;object-fit:cover">` : UI.initials(name)}
          ${isOnline ? '<div class="online-dot"></div>' : ''}
        </div>
        <div class="chat-item-body">
          <div class="chat-item-top">
            <div class="chat-item-name">${UI.esc(name)}</div>
            <div class="chat-item-time">${chat.last_msg_ts ? UI.fmtDate(chat.last_msg_ts) : ''}</div>
          </div>
          <div class="chat-item-preview">
            <div class="chat-item-text">${UI.esc(preview)}</div>
            ${chat.unread_count > 0 ? `<div class="unread-badge">${chat.unread_count}</div>` : ''}
          </div>
        </div>
      </div>`;
    }).join('');
  }

  function filterChatList(q) {
    const filtered = chats.filter(c => getChatName(c).toLowerCase().includes(q.toLowerCase()));
    const el = document.getElementById('chat-list');
    if (!filtered.length) {
      el.innerHTML = `<div style="text-align:center;padding:2rem;color:var(--text-muted);font-size:13px">No results for "${q}"</div>`;
      return;
    }
    // Temporarily swap chats for render
    const orig = chats;
    chats = filtered;
    renderChatList();
    chats = orig;
  }

  function updateChatPreview(chatId, msg) {
    const chat = chats.find(c => c.id === chatId);
    if (!chat) return;
    chat.last_message = msg.content;
    chat.last_msg_ts = msg.created_at;
    // Move to top
    chats = [chat, ...chats.filter(c => c.id !== chatId)];
    renderChatList();
  }

  // ── Open Chat ──────────────────────────────────────────────────────────────
  async function openChat(chatId) {
    if (activeChatId) WS.leaveChat();
    activeChatId = chatId;

    const chat = chats.find(c => c.id === chatId);
    if (!chat) return;

    // Reset unread
    chat.unread_count = 0;
    renderChatList();

    // Show chat view
    document.getElementById('splash').classList.add('hidden');
    document.getElementById('chat-view').classList.remove('hidden');

    // Header
    const name = getChatName(chat);
    const avatarSrc = chat.avatar || chat.peer?.avatar;
    const headerAvatar = document.getElementById('chat-header-avatar');
    headerAvatar.style.background = UI.colorForName(name);
    headerAvatar.innerHTML = avatarSrc
      ? `<img src="${avatarSrc}" style="width:100%;height:100%;object-fit:cover">`
      : UI.initials(name);

    document.getElementById('chat-header-name').textContent = name;

    const statusEl = document.getElementById('chat-header-status');
    if (chat.type === 'direct' && chat.peer) {
      const isOnline = onlineUsers.has(chat.peer.id);
      statusEl.textContent = isOnline ? 'online' : UI.lastSeen(chat.peer.last_seen);
      statusEl.className = 'chat-header-status' + (isOnline ? ' online' : '');
    } else if (chat.type === 'group') {
      const members = chat.members || [];
      statusEl.textContent = `${members.length} members`;
      statusEl.className = 'chat-header-status';
    }

    // Load messages
    msgOffset[chatId] = 0;
    if (!messages[chatId]) {
      await loadMessages(chatId);
    } else {
      renderMessages(chatId);
    }

    WS.joinChat(chatId);
    document.getElementById('msg-input').focus();

    // Mobile
    if (window.innerWidth <= 700) {
      document.getElementById('sidebar').classList.add('hidden-mobile');
    }
  }

  async function loadMessages(chatId) {
    try {
      const data = await API.getMessages(chatId, 50, msgOffset[chatId] || 0);
      messages[chatId] = data.messages;
      renderMessages(chatId);
    } catch {
      UI.toast('Failed to load messages');
    }
  }

  function renderMessages(chatId) {
    const el = document.getElementById('messages-list');
    const msgs = messages[chatId] || [];

    if (!msgs.length) {
      el.innerHTML = `<div style="text-align:center;padding:2rem;color:var(--text-muted);font-size:13px">No messages yet. Say hello!</div>`;
      return;
    }

    let html = '';
    let lastDay = null;

    msgs.forEach((msg, i) => {
      const day = UI.fmtFullDate(msg.created_at);
      if (day !== lastDay) {
        html += `<div class="day-divider"><span>${day}</span></div>`;
        lastDay = day;
      }

      if (msg.type === 'system') {
        html += `<div class="system-msg">${UI.esc(msg.content)}</div>`;
        return;
      }

      const isMine = msg.sender_id === currentUser.id;
      const showAvatar = !isMine && (i === msgs.length - 1 || msgs[i + 1]?.sender_id !== msg.sender_id);

      html += buildMessageHTML(msg, isMine, showAvatar, chatId);
    });

    el.innerHTML = html;

    // Context menu on right-click / long press
    el.querySelectorAll('[data-msg-id]').forEach(el => {
      el.addEventListener('contextmenu', e => {
        e.preventDefault();
        const msgId = el.dataset.msgId;
        const msg = (messages[chatId] || []).find(m => m.id === msgId);
        if (msg) showMsgContext(e, msg);
      });
    });

    scrollToBottom();
  }

  function buildMessageHTML(msg, isMine, showAvatar, chatId) {
    const chat = chats.find(c => c.id === chatId);
    const isGroup = chat?.type === 'group';

    let replyHTML = '';
    if (msg.reply_to && msg.reply_content) {
      replyHTML = `<div class="reply-bubble">
        <div class="reply-name">${UI.esc(msg.reply_sender_name || 'Unknown')}</div>
        <div class="reply-text">${UI.esc(msg.reply_content)}</div>
      </div>`;
    }

    let contentHTML = '';
    if (msg.type === 'image') {
      contentHTML = `<img class="bubble-image" src="${UI.esc(msg.content)}" onclick="window.open('${UI.esc(msg.content)}')">`;
    } else if (msg.type === 'file') {
      try {
        const f = JSON.parse(msg.content);
        contentHTML = `<a href="${UI.esc(f.url)}" target="_blank" style="display:flex;align-items:center;gap:8px;color:inherit;text-decoration:none">
          <span style="font-size:24px">📎</span>
          <span style="font-size:13px">${UI.esc(f.name)}<br><span style="opacity:.6;font-size:11px">${(f.size/1024).toFixed(1)} KB</span></span>
        </a>`;
      } catch { contentHTML = UI.linkify(msg.content); }
    } else {
      contentHTML = `<div class="bubble-text">${UI.linkify(msg.content)}</div>`;
    }

    const statusIcon = isMine ? `<span class="msg-status">${msg.delivered ? '✓✓' : '✓'}</span>` : '';

    return `
    <div class="msg-row ${isMine ? 'outgoing' : 'incoming'}" data-msg-id="${msg.id}">
      ${!isMine ? `<div class="msg-avatar ${showAvatar ? '' : 'invisible'}" style="background:${UI.colorForName(msg.display_name || '')}">${msg.avatar ? `<img src="${msg.avatar}" style="width:100%;height:100%;object-fit:cover">` : UI.initials(msg.display_name || '?')}</div>` : ''}
      <div class="bubble ${msg.edited ? 'edited' : ''}">
        ${isGroup && !isMine ? `<div class="bubble-sender">${UI.esc(msg.display_name || '')}</div>` : ''}
        ${replyHTML}
        ${contentHTML}
        <div class="bubble-meta">
          <span class="bubble-time">${UI.fmtTime(msg.created_at)}</span>
          ${statusIcon}
        </div>
      </div>
    </div>`;
  }

  function appendMessage(msg) {
    const el = document.getElementById('messages-list');
    const isMine = msg.sender_id === currentUser.id;
    const placeholder = el.querySelector('[style*="No messages"]');
    if (placeholder) placeholder.remove();

    const div = document.createElement('div');
    const chat = chats.find(c => c.id === activeChatId);
    div.innerHTML = buildMessageHTML(msg, isMine, true, activeChatId);
    const msgRow = div.firstElementChild;
    el.appendChild(msgRow);

    msgRow.addEventListener('contextmenu', e => {
      e.preventDefault();
      showMsgContext(e, msg);
    });

    scrollToBottom();
  }

  // ── Send ───────────────────────────────────────────────────────────────────
  async function sendMessage() {
    const input = document.getElementById('msg-input');
    const text = input.value.trim();
    if (!text || !activeChatId) return;

    input.value = '';
    autoGrow(input);
    toggleSendBtn();

    const payload = { content: text, type: 'text' };
    if (replyTo) { payload.reply_to = replyTo.id; cancelReply(); }

    try {
      const data = await API.sendMessage(activeChatId, payload);
      if (!messages[activeChatId]) messages[activeChatId] = [];
      messages[activeChatId].push(data.message);
      appendMessage(data.message);
      updateChatPreview(activeChatId, data.message);
    } catch (err) {
      UI.toast('Failed to send message');
      input.value = text;
    }
  }

  async function sendFile(file) {
    UI.toast('Uploading…', 10000);
    try {
      const data = await API.upload(file);
      const isImage = file.type.startsWith('image/');
      const payload = {
        type: isImage ? 'image' : 'file',
        content: isImage ? data.url : JSON.stringify({ url: data.url, name: data.name, size: data.size })
      };
      const res = await API.sendMessage(activeChatId, payload);
      if (!messages[activeChatId]) messages[activeChatId] = [];
      messages[activeChatId].push(res.message);
      appendMessage(res.message);
      UI.toast('File sent');
    } catch (err) {
      UI.toast('Upload failed: ' + err.message);
    }
  }

  // ── Reply ──────────────────────────────────────────────────────────────────
  function startReply(msg) {
    replyTo = msg;
    document.getElementById('reply-preview').classList.remove('hidden');
    document.getElementById('reply-to-name').textContent = msg.display_name || 'Message';
    document.getElementById('reply-to-text').textContent = truncate(msg.content, 60);
    document.getElementById('msg-input').focus();
  }

  function cancelReply() {
    replyTo = null;
    document.getElementById('reply-preview').classList.add('hidden');
  }

  // ── Context Menu ───────────────────────────────────────────────────────────
  function showMsgContext(e, msg) {
    const existing = document.getElementById('msg-ctx');
    if (existing) existing.remove();

    const isMine = msg.sender_id === currentUser.id;
    const menu = document.createElement('div');
    menu.id = 'msg-ctx';
    menu.className = 'msg-context';
    menu.style.cssText = `top:${e.clientY}px;left:${e.clientX}px`;

    const items = [
      { label: '↩ Reply', action: () => startReply(msg) },
      ...(isMine && msg.type === 'text' ? [{ label: '✏ Edit', action: () => editMessagePrompt(msg) }] : []),
      { label: '📋 Copy', action: () => { navigator.clipboard?.writeText(msg.content); UI.toast('Copied'); } },
      ...(isMine ? [{ label: '🗑 Delete', cls: 'danger', action: () => deleteMessage(msg) }] : []),
    ];

    items.forEach(item => {
      const div = document.createElement('div');
      div.className = 'msg-context-item ' + (item.cls || '');
      div.textContent = item.label;
      div.onclick = () => { menu.remove(); item.action(); };
      menu.appendChild(div);
    });

    document.body.appendChild(menu);

    // Adjust position if off-screen
    const rect = menu.getBoundingClientRect();
    if (rect.right > window.innerWidth) menu.style.left = (e.clientX - rect.width) + 'px';
    if (rect.bottom > window.innerHeight) menu.style.top = (e.clientY - rect.height) + 'px';
  }

  async function editMessagePrompt(msg) {
    const newContent = prompt('Edit message:', msg.content);
    if (!newContent || newContent === msg.content) return;
    try {
      await API.editMessage(msg.id, newContent);
      const idx = (messages[activeChatId] || []).findIndex(m => m.id === msg.id);
      if (idx !== -1) messages[activeChatId][idx].content = newContent;
    } catch { UI.toast('Could not edit message'); }
  }

  async function deleteMessage(msg) {
    if (!confirm('Delete this message?')) return;
    try {
      await API.deleteMessage(msg.id);
      messages[activeChatId] = (messages[activeChatId] || []).filter(m => m.id !== msg.id);
      document.querySelector(`[data-msg-id="${msg.id}"]`)?.remove();
    } catch { UI.toast('Could not delete message'); }
  }

  // ── Typing ─────────────────────────────────────────────────────────────────
  function showTyping(name) {
    const banner = document.getElementById('typing-banner');
    document.getElementById('typing-text').textContent = `${name} is typing…`;
    banner.classList.remove('hidden');
  }
  function hideTyping() {
    document.getElementById('typing-banner').classList.add('hidden');
  }

  // ── User Search (new chat) ─────────────────────────────────────────────────
  let searchTimer = null;
  async function searchUsers(q) {
    clearTimeout(searchTimer);
    if (!q.trim()) { document.getElementById('user-search-results').innerHTML = ''; return; }
    searchTimer = setTimeout(async () => {
      try {
        const data = await API.searchUsers(q);
        const el = document.getElementById('user-search-results');
        if (!data.users.length) { el.innerHTML = `<div style="padding:2rem;text-align:center;color:var(--text-muted);font-size:13px">No users found</div>`; return; }
        el.innerHTML = data.users.map(u => `
          <div class="user-item" onclick="App.startDirectChat('${u.id}')">
            ${UI.avatarHTML(u.display_name, u.avatar, 40)}
            <div>
              <div class="user-item-name">${UI.esc(u.display_name)}</div>
              <div class="user-item-sub">@${UI.esc(u.username)}</div>
            </div>
          </div>`).join('');
      } catch {}
    }, 300);
  }

  async function startDirectChat(userId) {
    closeModal('modal-new-chat');
    try {
      const data = await API.openDirect(userId);
      const existing = chats.find(c => c.id === data.chat.id);
      if (!existing) chats.unshift(data.chat);
      else Object.assign(existing, data.chat);
      renderChatList();
      openChat(data.chat.id);
      API.addContact(userId).catch(() => {});
    } catch (err) {
      UI.toast('Could not open chat: ' + err.message);
    }
  }

  // ── Group ──────────────────────────────────────────────────────────────────
  function showNewGroup() {
    closeMenu();
    groupMembers = [];
    document.getElementById('modal-new-group').classList.remove('hidden');
    document.getElementById('group-name-input').value = '';
    document.getElementById('group-user-search').value = '';
    document.getElementById('group-user-results').innerHTML = '';
    renderSelectedMembers();
  }

  let groupSearchTimer = null;
  async function searchGroupUsers(q) {
    clearTimeout(groupSearchTimer);
    if (!q.trim()) { document.getElementById('group-user-results').innerHTML = ''; return; }
    groupSearchTimer = setTimeout(async () => {
      const data = await API.searchUsers(q).catch(() => ({ users: [] }));
      const el = document.getElementById('group-user-results');
      el.innerHTML = data.users.map(u => {
        const selected = groupMembers.some(m => m.id === u.id);
        return `<div class="user-item" onclick="App.toggleGroupMember(${JSON.stringify(u).replace(/"/g,'&quot;')})">
          ${UI.avatarHTML(u.display_name, u.avatar, 40)}
          <div>
            <div class="user-item-name">${UI.esc(u.display_name)}</div>
            <div class="user-item-sub">@${UI.esc(u.username)}</div>
          </div>
          ${selected ? '<span class="user-item-check">✓</span>' : ''}
        </div>`;
      }).join('');
    }, 300);
  }

  function toggleGroupMember(user) {
    const idx = groupMembers.findIndex(m => m.id === user.id);
    if (idx !== -1) groupMembers.splice(idx, 1);
    else groupMembers.push(user);
    renderSelectedMembers();
  }

  function renderSelectedMembers() {
    const el = document.getElementById('selected-members');
    el.innerHTML = groupMembers.map(u => `
      <div class="selected-chip">
        <div class="chip-avatar" style="background:${UI.colorForName(u.display_name)}">${UI.initials(u.display_name)}</div>
        ${UI.esc(u.display_name)}
        <span class="chip-remove" onclick="App.toggleGroupMember(${JSON.stringify(u).replace(/"/g,'&quot;')})">✕</span>
      </div>`).join('');
  }

  async function createGroup() {
    const name = document.getElementById('group-name-input').value.trim();
    if (!name) { UI.toast('Enter a group name'); return; }
    try {
      const data = await API.createGroup({ name, member_ids: groupMembers.map(m => m.id) });
      chats.unshift(data.chat);
      renderChatList();
      closeModal('modal-new-group');
      openChat(data.chat.id);
    } catch (err) {
      UI.toast('Failed to create group: ' + err.message);
    }
  }

  // ── Chat Info ──────────────────────────────────────────────────────────────
  async function showChatInfo() {
    const chat = chats.find(c => c.id === activeChatId);
    if (!chat) return;

    const modal = document.getElementById('modal-chat-info');
    modal.classList.remove('hidden');

    if (chat.type === 'direct' && chat.peer) {
      const u = chat.peer;
      document.getElementById('info-title').textContent = 'Profile';
      document.getElementById('info-avatar').innerHTML = UI.avatarHTML(u.display_name, u.avatar, 80).replace('display:flex;', 'display:flex;margin:0 auto;');
      document.getElementById('info-avatar').style.background = UI.colorForName(u.display_name);
      document.getElementById('info-name').textContent = u.display_name;
      document.getElementById('info-sub').textContent = '@' + u.username;
      document.getElementById('info-bio').textContent = u.bio || 'No bio';
      document.getElementById('info-bio-section').style.display = 'block';
      document.getElementById('info-actions').innerHTML = '';
    } else {
      const members = await API.getChatMembers(chat.id).then(d => d.members).catch(() => []);
      document.getElementById('info-title').textContent = 'Group Info';
      document.getElementById('info-avatar').innerHTML = '';
      document.getElementById('info-avatar').style.background = UI.colorForName(chat.name || '');
      document.getElementById('info-avatar').style.display = 'flex';
      document.getElementById('info-avatar').style.alignItems = 'center';
      document.getElementById('info-avatar').style.justifyContent = 'center';
      document.getElementById('info-avatar').style.fontSize = '32px';
      document.getElementById('info-avatar').style.color = '#fff';
      document.getElementById('info-avatar').textContent = UI.initials(chat.name || '?');
      document.getElementById('info-name').textContent = chat.name;
      document.getElementById('info-sub').textContent = `${members.length} members`;
      document.getElementById('info-bio').textContent = chat.description || '';
      document.getElementById('info-bio-section').style.display = chat.description ? 'block' : 'none';

      const actionsEl = document.getElementById('info-actions');
      actionsEl.innerHTML = '<div style="padding:0.5rem 0;font-size:13px;font-weight:600;color:var(--text-secondary)">Members</div>';
      members.forEach(m => {
        const div = document.createElement('div');
        div.className = 'user-item';
        div.style.padding = '8px 0';
        div.innerHTML = `${UI.avatarHTML(m.display_name, m.avatar, 38)}
          <div>
            <div class="user-item-name">${UI.esc(m.display_name)}${m.role==='owner'?' 👑':''}</div>
            <div class="user-item-sub">@${UI.esc(m.username)}</div>
          </div>`;
        actionsEl.appendChild(div);
      });
    }
  }

  // ── Settings ───────────────────────────────────────────────────────────────
  function showSettings() {
    closeMenu();
    const modal = document.getElementById('modal-settings');
    modal.classList.remove('hidden');

    const av = document.getElementById('settings-avatar');
    if (currentUser.avatar) {
      av.innerHTML = `<img src="${currentUser.avatar}" style="width:100%;height:100%;object-fit:cover">`;
    } else {
      av.style.background = UI.colorForName(currentUser.display_name);
      av.textContent = UI.initials(currentUser.display_name);
    }
    document.getElementById('settings-name').value = currentUser.display_name;
    document.getElementById('settings-bio').value = currentUser.bio || '';
    document.getElementById('settings-username-display').textContent = 'Username: @' + currentUser.username;
  }

  async function uploadAvatar(input) {
    const file = input.files[0];
    if (!file) return;
    try {
      const data = await API.upload(file);
      const av = document.getElementById('settings-avatar');
      av.innerHTML = `<img src="${data.url}" style="width:100%;height:100%;object-fit:cover">`;
      currentUser.avatar = data.url;
    } catch { UI.toast('Upload failed'); }
  }

  async function saveSettings() {
    const name = document.getElementById('settings-name').value.trim();
    if (!name) { UI.toast('Name cannot be empty'); return; }
    try {
      const data = await API.updateProfile({
        display_name: name,
        bio: document.getElementById('settings-bio').value,
        avatar: currentUser.avatar || ''
      });
      currentUser = data.user;
      updateMenuProfile();
      closeModal('modal-settings');
      UI.toast('Profile saved');
    } catch (err) { UI.toast('Failed to save: ' + err.message); }
  }

  // ── Notifications ──────────────────────────────────────────────────────────
  function notifyMessage(msg, chat) {
    if (!chat) return;
    if (Notification.permission === 'granted') {
      new Notification(getChatName(chat), {
        body: msg.content?.substring(0, 80),
        icon: '/favicon.ico',
        tag: chat.id
      });
    } else if (Notification.permission !== 'denied') {
      Notification.requestPermission();
    }
  }

  // ── Menu ───────────────────────────────────────────────────────────────────
  function openMenu() {
    document.getElementById('menu-drawer').classList.remove('hidden');
    document.getElementById('menu-overlay').classList.remove('hidden');
  }
  function closeMenu() {
    document.getElementById('menu-drawer').classList.add('hidden');
    document.getElementById('menu-overlay').classList.add('hidden');
  }

  function showContacts() {
    closeMenu();
    document.getElementById('modal-new-chat').classList.remove('hidden');
    document.getElementById('user-search-input').value = '';
    document.getElementById('user-search-results').innerHTML = '';
    setTimeout(() => document.getElementById('user-search-input').focus(), 50);
  }

  // ── Chat actions ───────────────────────────────────────────────────────────
  function closeChat() {
    document.getElementById('chat-view').classList.add('hidden');
    document.getElementById('splash').classList.remove('hidden');
    document.getElementById('sidebar').classList.remove('hidden-mobile');
    if (activeChatId) WS.leaveChat();
    activeChatId = null;
    renderChatList();
  }

  function clearChatHistory() {
    document.getElementById('chat-dropdown').classList.add('hidden');
    if (!activeChatId) return;
    messages[activeChatId] = [];
    renderMessages(activeChatId);
    UI.toast('Chat history cleared');
  }

  function deleteChat() {
    document.getElementById('chat-dropdown').classList.add('hidden');
    if (!confirm('Remove this chat from your list?')) return;
    chats = chats.filter(c => c.id !== activeChatId);
    closeChat();
    renderChatList();
  }

  // ── Helpers ────────────────────────────────────────────────────────────────
  function getChatName(chat) {
    if (chat.type === 'direct') return chat.peer?.display_name || 'Unknown';
    return chat.name || 'Group';
  }

  function truncate(str, len) {
    if (!str) return '';
    return str.length > len ? str.slice(0, len) + '…' : str;
  }

  function autoGrow(el) {
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 120) + 'px';
  }

  function toggleSendBtn() {
    const val = document.getElementById('msg-input').value.trim();
    document.getElementById('send-btn').classList.toggle('idle', !val);
  }

  function scrollToBottom() {
    const el = document.getElementById('messages-list');
    el.scrollTop = el.scrollHeight;
  }

  function closeModal(id) {
    document.getElementById(id)?.classList.add('hidden');
  }

  function logout() {
    closeMenu();
    if (!confirm('Sign out of OpenWave?')) return;
    WS.disconnect();
    localStorage.removeItem('ow_token');
    currentUser = null;
    chats = []; messages = {}; activeChatId = null;
    document.getElementById('app').classList.add('hidden');
    showAuth();
  }

  // Expose public interface
  return {
    init, openChat, closeChat, startDirectChat, searchUsers,
    showNewGroup, searchGroupUsers, toggleGroupMember, createGroup,
    showChatInfo, showSettings, saveSettings, uploadAvatar,
    showContacts, openMenu, closeMenu, closeModal, logout,
    clearChatHistory, deleteChat, cancelReply,
  };
})();

// Boot
document.addEventListener('DOMContentLoaded', () => App.init());
