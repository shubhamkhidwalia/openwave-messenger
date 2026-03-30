'use strict';
const App = (() => {
  let currentUser=null,chats=[],activeChatId=null,messages={};
  let typingTimers={},groupMembers=[],replyTo=null,onlineUsers=new Set();
  let notifCounts={},forwardMsg=null,searchResults=[],searchIdx=0;
  let activeReactionMsgId=null;
  let mediaRecorder=null,recordChunks=[],recordTimer=null,recordSeconds=0;
  let starredMessages=JSON.parse(localStorage.getItem('ow_starred')||'[]');
  let reactions=JSON.parse(localStorage.getItem('ow_reactions')||'{}');
  let disappearingChats=JSON.parse(localStorage.getItem('ow_disappearing')||'{}');
  // Unique feature: disappearing messages per chat (in seconds)
  // 0 = off, 86400 = 1 day, 604800 = 1 week

  // ── Init ─────────────────────────────────────────────────────────────────
  async function init() {
    UI.loadTheme();
    // Load config (bot username)
    try {
      const cfg = await fetch('/api/config').then(r=>r.json());
      if (cfg.bot_username) {
        const link = document.getElementById('bot-link');
        if (link) link.href = `https://t.me/${cfg.bot_username}`;
        document.getElementById('invite-banner').style.display='block';
      }
    } catch {}

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
      catch (err) {
        if (err.isNetworkError) showNetworkError();
        else { localStorage.removeItem('ow_token'); showAuth(); }
      }
    } else showAuth();
  }

  function showNetworkError() {
    document.getElementById('auth-screen').style.display='flex';
    document.getElementById('app').classList.add('hidden');
    document.querySelector('.auth-card').innerHTML=`
      <span class="auth-logo">🌊</span>
      <h1 class="auth-title">OpenWave</h1>
      <p class="auth-sub" style="color:var(--danger)">No connection</p>
      <p style="font-size:14px;color:var(--muted);margin-bottom:1.5rem;line-height:1.6">Could not reach the server. Check your internet and try again.</p>
      <button class="btn-primary" onclick="location.reload()">Try Again</button>
    `;
  }

  function showAuth(tab='login', prefillInvite='') {
    document.getElementById('auth-screen').style.display='flex';
    document.getElementById('app').classList.add('hidden');
    setupAuthHandlers();
    if (tab==='register' || prefillInvite) {
      document.querySelectorAll('.auth-tab').forEach(t=>t.classList.remove('active'));
      document.querySelectorAll('.auth-form').forEach(f=>f.classList.remove('active'));
      document.querySelector('.auth-tab[data-tab="register"]').classList.add('active');
      document.getElementById('register-form').classList.add('active');
      document.getElementById('invite-banner').style.display='block';
    }
    if (prefillInvite) document.getElementById('reg-invite').value=prefillInvite;
  }

  function setupAuthHandlers() {
    document.querySelectorAll('.auth-tab').forEach(tab => {
      tab.onclick = () => {
        document.querySelectorAll('.auth-tab').forEach(t=>t.classList.remove('active'));
        document.querySelectorAll('.auth-form').forEach(f=>f.classList.remove('active'));
        tab.classList.add('active');
        document.getElementById(tab.dataset.tab+'-form').classList.add('active');
        const banner = document.getElementById('invite-banner');
        if (banner) banner.style.display = tab.dataset.tab==='register'?'block':'none';
      };
    });
    const lf=document.getElementById('login-form');
    if (!lf._b) { lf._b=true; lf.addEventListener('submit', async e=>{
      e.preventDefault(); const btn=e.target.querySelector('button'); btn.disabled=true; btn.textContent='Signing in…';
      try { const d=await API.login({username:document.getElementById('login-username').value,password:document.getElementById('login-password').value}); localStorage.setItem('ow_token',d.token); currentUser=d.user; startApp(); }
      catch(err){ document.getElementById('login-error').textContent=err.message; btn.disabled=false; btn.textContent='Sign In'; }
    }); }
    const rf=document.getElementById('register-form');
    if (!rf._b) { rf._b=true; rf.addEventListener('submit', async e=>{
      e.preventDefault(); const btn=e.target.querySelector('button'); btn.disabled=true; btn.textContent='Creating…';
      try {
        if (typeof checkCaptcha==='function' && !checkCaptcha()) {
          document.getElementById('reg-error').textContent='Wrong answer — try again'; if(typeof refreshCaptcha==='function')refreshCaptcha(); btn.disabled=false; btn.textContent='Create Account'; return;
        }
        const d=await API.register({username:document.getElementById('reg-username').value,display_name:document.getElementById('reg-name').value,phone:document.getElementById('reg-phone').value||undefined,password:document.getElementById('reg-password').value,invite_code:document.getElementById('reg-invite').value.trim()});
        localStorage.setItem('ow_token',d.token); currentUser=d.user; startApp();
      } catch(err){ document.getElementById('reg-error').textContent=err.message; btn.disabled=false; btn.textContent='Create Account'; }
    }); }
  }

  async function startApp() {
    document.getElementById('auth-screen').style.display='none';
    document.getElementById('app').classList.remove('hidden');
    updateMenuProfile(); setupEventListeners();
    WS.connect(localStorage.getItem('ow_token')); setupWSHandlers();
    await loadChats();
  }

  function updateMenuProfile() {
    if (!currentUser) return;
    const av=document.getElementById('menu-avatar');
    if (currentUser.avatar) av.innerHTML=`<img src="${currentUser.avatar}" style="width:100%;height:100%;object-fit:cover">`;
    else { av.style.background=UI.colorForName(currentUser.display_name); av.textContent=UI.initials(currentUser.display_name); }
    document.getElementById('menu-display-name').textContent=currentUser.display_name;
    document.getElementById('menu-username').textContent='@'+currentUser.username;
    document.getElementById('menu-phone').textContent=currentUser.phone||'';
  }

  function setupEventListeners() {
    document.getElementById('theme-btn').onclick=()=>UI.setTheme(document.documentElement.getAttribute('data-theme')!=='dark');
    document.getElementById('menu-btn').onclick=openMenu;
    document.getElementById('compose-btn').onclick=()=>{ openModal('modal-new-chat'); document.getElementById('user-search-input').value=''; document.getElementById('user-search-results').innerHTML=''; setTimeout(()=>document.getElementById('user-search-input').focus(),100); };
    document.getElementById('starred-btn').onclick=showStarred;
    const si=document.getElementById('search-input');
    si.oninput=e=>{ const q=e.target.value; document.getElementById('clear-search').classList.toggle('hidden',!q); filterChatList(q); };
    document.getElementById('clear-search').onclick=()=>{ si.value=''; document.getElementById('clear-search').classList.add('hidden'); renderChatList(); };
    const input=document.getElementById('msg-input');
    input.oninput=()=>{ autoGrow(input); toggleSendBtn(); if(activeChatId)WS.onInputTyping(activeChatId); };
    input.onkeydown=e=>{ if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();sendMessage();} };
    document.getElementById('send-btn').onclick=sendMessage;
    document.getElementById('attach-btn').onclick=()=>document.getElementById('file-input').click();
    document.getElementById('file-input').onchange=async e=>{ const f=e.target.files[0]; if(!f||!activeChatId)return; e.target.value=''; await sendFile(f); };
    document.getElementById('chat-menu-btn').onclick=()=>document.getElementById('chat-dropdown').classList.toggle('hidden');
    document.getElementById('chat-search-btn').onclick=()=>{ const b=document.getElementById('chat-search-bar'); b.classList.toggle('open'); if(b.classList.contains('open'))document.getElementById('chat-search-input').focus(); else closeChatSearch(); };
    setupVoiceRecorder();
    setupSwipeBack();
    // Reaction picker
    document.getElementById('reaction-picker').querySelectorAll('.reaction-emoji').forEach(el=>{
      el.onclick=()=>addReaction(el.dataset.emoji);
    });
    document.addEventListener('click', e=>{
      if(!e.target.closest('#chat-dropdown')&&!e.target.closest('#chat-menu-btn')) document.getElementById('chat-dropdown').classList.add('hidden');
      const ctx=document.getElementById('msg-ctx'); if(ctx&&!ctx.contains(e.target))ctx.remove();
      const rp=document.getElementById('reaction-picker'); if(rp&&!rp.contains(e.target)&&!e.target.closest('[data-msg-id]')){ rp.classList.remove('open'); activeReactionMsgId=null; }
    });
    document.querySelectorAll('.modal').forEach(m=>{ m.onclick=e=>{ if(e.target===m)m.classList.add('hidden'); }; });
  }

  // ── Swipe back ─────────────────────────────────────────────────────────────
  function setupSwipeBack() {
    let sx=0,sy=0,dragging=false;
    const ca=document.getElementById('chat-area');
    ca.addEventListener('touchstart',e=>{ sx=e.touches[0].clientX; sy=e.touches[0].clientY; dragging=false; },{passive:true});
    ca.addEventListener('touchmove',e=>{
      if(!activeChatId)return;
      const dx=e.touches[0].clientX-sx, dy=Math.abs(e.touches[0].clientY-sy);
      if(dx>20&&dy<80&&sx<50){ dragging=true; const c=Math.min(dx,window.innerWidth); ca.style.transform=`translateX(${c}px)`; ca.style.transition='none'; }
    },{passive:true});
    ca.addEventListener('touchend',e=>{
      const dx=e.changedTouches[0].clientX-sx; ca.style.transition=''; ca.style.transform='';
      if(dragging&&dx>110)closeChat(); dragging=false;
    });
  }

  // ── Voice recorder ──────────────────────────────────────────────────────────
  function setupVoiceRecorder() {
    const btn=document.getElementById('voice-btn'), timerEl=document.getElementById('record-timer');
    const start=async()=>{
      if(!navigator.mediaDevices){UI.toast('Microphone not available');return;}
      try {
        const stream=await navigator.mediaDevices.getUserMedia({audio:true});
        recordChunks=[]; recordSeconds=0;
        mediaRecorder=new MediaRecorder(stream);
        mediaRecorder.ondataavailable=e=>recordChunks.push(e.data);
        mediaRecorder.onstop=()=>{ stream.getTracks().forEach(t=>t.stop()); sendVoiceNote(); };
        mediaRecorder.start();
        btn.classList.add('recording'); timerEl.classList.add('visible');
        recordTimer=setInterval(()=>{ recordSeconds++; timerEl.textContent=`${Math.floor(recordSeconds/60)}:${String(recordSeconds%60).padStart(2,'0')}`; },1000);
      } catch { UI.toast('Microphone access denied'); }
    };
    const stop=()=>{
      if(mediaRecorder&&mediaRecorder.state==='recording')mediaRecorder.stop();
      btn.classList.remove('recording'); timerEl.classList.remove('visible');
      clearInterval(recordTimer); recordSeconds=0; timerEl.textContent='0:00';
    };
    btn.addEventListener('click',()=>{ if(mediaRecorder&&mediaRecorder.state==='recording')stop(); else start(); });
  }

  async function sendVoiceNote() {
    if(!recordChunks.length||!activeChatId)return;
    const blob=new Blob(recordChunks,{type:'audio/webm'});
    const file=new File([blob],`voice-${Date.now()}.webm`,{type:'audio/webm'});
    UI.toast('Sending voice note…',5000);
    try {
      const data=await API.upload(file);
      const dur=recordSeconds||1;
      const res=await API.sendMessage(activeChatId,{type:'file',content:JSON.stringify({url:data.url,name:'Voice message',size:blob.size,voice:true,duration:dur})});
      if(!messages[activeChatId])messages[activeChatId]=[];
      messages[activeChatId].push(res.message); appendMessage(res.message);
    } catch { UI.toast('Failed to send voice note'); }
  }

  // ── WS ──────────────────────────────────────────────────────────────────────
  function setupWSHandlers() {
    WS.on('connected',()=>{ if(activeChatId)WS.joinChat(activeChatId); });
    WS.on('new_message',data=>{
      const {message,chat_id}=data;
      if(!messages[chat_id])messages[chat_id]=[];
      messages[chat_id].push(message);
      const isActive=chat_id===activeChatId, isVisible=!document.hidden;
      if(isActive&&isVisible){ appendMessage(message); API.markRead(message.id).catch(()=>{}); }
      else {
        if(!isActive){ const c=chats.find(c=>c.id===chat_id); if(c)c.unread_count=(c.unread_count||0)+1; }
        notifyMessage(message, chats.find(c=>c.id===chat_id));
        if(isActive){ appendMessage(message); API.markRead(message.id).catch(()=>{}); }
      }
      updateChatPreview(chat_id,message);
    });
    WS.on('message_edited',data=>{
      const {message,chat_id}=data;
      if(messages[chat_id]){ const i=messages[chat_id].findIndex(m=>m.id===message.id); if(i!==-1)messages[chat_id][i]=message; }
      if(chat_id===activeChatId){ const el=document.querySelector(`[data-msg-id="${message.id}"] .bubble-text`); if(el){ el.innerHTML=UI.linkify(message.content); el.closest('.bubble').classList.add('edited'); } }
    });
    WS.on('message_deleted',data=>{
      if(messages[data.chat_id])messages[data.chat_id]=messages[data.chat_id].filter(m=>m.id!==data.message_id);
      if(data.chat_id===activeChatId)document.querySelector(`[data-msg-id="${data.message_id}"]`)?.remove();
    });
    WS.on('typing_start',data=>{ if(data.chat_id!==activeChatId)return; document.getElementById('typing-text').textContent=`${data.display_name} is typing…`; document.getElementById('typing-banner').classList.remove('hidden'); clearTimeout(typingTimers[data.user_id]); typingTimers[data.user_id]=setTimeout(hideTyping,3000); });
    WS.on('typing_stop',data=>{ clearTimeout(typingTimers[data.user_id]); hideTyping(); });
    WS.on('presence',data=>{
      if(data.status==='online')onlineUsers.add(data.user_id); else onlineUsers.delete(data.user_id);
      document.querySelectorAll(`[data-user-id="${data.user_id}"] .online-dot`).forEach(el=>el.style.display=data.status==='online'?'block':'none');
      if(activeChatId){ const c=chats.find(c=>c.id===activeChatId); if(c?.peer?.id===data.user_id){ const s=document.getElementById('chat-header-status'); s.textContent=data.status==='online'?'online':UI.lastSeen(data.last_seen); s.className='chat-header-status'+(data.status==='online'?' online':''); } }
    });
    WS.on('message_read',data=>{ if(data.chat_id===activeChatId){ const el=document.querySelector(`[data-msg-id="${data.message_id}"] .msg-status`); if(el){el.textContent='✓✓';el.classList.add('read');} } });
    WS.on('chat_created',data=>{ chats.unshift(data.chat); renderChatList(); });
    WS.on('chat_updated',data=>{ const c=chats.find(c=>c.id===data.chat.id); if(c)Object.assign(c,data.chat); renderChatList(); });
  }

  // ── Chats ───────────────────────────────────────────────────────────────────
  async function loadChats() {
    try { const d=await API.getChats(); chats=d.chats||[]; renderChatList(); }
    catch { UI.toast('Failed to load chats'); }
  }

  function renderChatList() {
    const el=document.getElementById('chat-list');
    if(!chats.length){ el.innerHTML=`<div style="text-align:center;padding:3rem 1rem;color:var(--muted);font-size:14px;line-height:2">No chats yet.<br>Tap ✏ to start one</div>`; return; }
    el.innerHTML=chats.map(chat=>{
      const name=getChatName(chat), isOnline=chat.peer&&onlineUsers.has(chat.peer.id);
      const avatarSrc=chat.avatar||chat.peer?.avatar;
      const preview=chat.last_message?truncate(chat.last_message,42):'Say hello! 👋';
      const isDisappearing=disappearingChats[chat.id];
      return `<div class="chat-item ${chat.id===activeChatId?'active':''}" data-chat-id="${chat.id}" data-user-id="${chat.peer?.id||''}" onclick="App.openChat('${chat.id}')">
        <div class="chat-avatar" style="background:${UI.colorForName(name)}">${avatarSrc?`<img src="${avatarSrc}" style="width:100%;height:100%;object-fit:cover">`:UI.initials(name)}${isOnline?'<div class="online-dot"></div>':''}</div>
        <div class="chat-item-body">
          <div class="chat-item-top">
            <div class="chat-item-name">${UI.esc(name)}${isDisappearing?' ⏱':''}</div>
            <div class="chat-item-time">${chat.last_msg_ts?UI.fmtDate(chat.last_msg_ts):''}</div>
          </div>
          <div class="chat-item-preview">
            <div class="chat-item-text">${UI.esc(preview)}</div>
            ${chat.unread_count>0?`<div class="unread-badge">${chat.unread_count}</div>`:''}
          </div>
        </div></div>`;
    }).join('');
  }

  function filterChatList(q) {
    const f=chats.filter(c=>getChatName(c).toLowerCase().includes(q.toLowerCase()));
    const el=document.getElementById('chat-list');
    if(!f.length){ el.innerHTML=`<div style="text-align:center;padding:2rem;color:var(--muted)">No results</div>`; return; }
    const orig=chats; chats=f; renderChatList(); chats=orig;
  }

  function updateChatPreview(chatId,msg) {
    const c=chats.find(c=>c.id===chatId); if(!c)return;
    c.last_message=msg.content; c.last_msg_ts=msg.created_at;
    chats=[c,...chats.filter(c=>c.id!==chatId)]; renderChatList();
  }

  async function openChat(chatId) {
    if(activeChatId)WS.leaveChat();
    activeChatId=chatId;
    const chat=chats.find(c=>c.id===chatId); if(!chat)return;
    const badgeEl=document.querySelector(`[data-chat-id="${chatId}"] .unread-badge`); if(badgeEl)badgeEl.remove();
    chat.unread_count=0; clearNotifCount(chatId); renderChatList();
    document.getElementById('splash').classList.add('hidden');
    document.getElementById('chat-view').classList.remove('hidden');
    document.getElementById('chat-area').classList.add('open');
    closeChatSearch();
    const name=getChatName(chat), avatarSrc=chat.avatar||chat.peer?.avatar;
    const ha=document.getElementById('chat-header-avatar');
    ha.style.background=UI.colorForName(name);
    ha.innerHTML=avatarSrc?`<img src="${avatarSrc}" style="width:100%;height:100%;object-fit:cover">`:UI.initials(name);
    document.getElementById('chat-header-name').textContent=name;
    const s=document.getElementById('chat-header-status');
    if(chat.type==='direct'&&chat.peer){ const on=onlineUsers.has(chat.peer.id); s.textContent=on?'online':UI.lastSeen(chat.peer.last_seen); s.className='chat-header-status'+(on?' online':''); }
    else { s.textContent=`${(chat.members||[]).length} members`; s.className='chat-header-status'; }
    // Disappearing banner
    const expiry=disappearingChats[chatId];
    const eb=document.getElementById('expiry-banner'), et=document.getElementById('expiry-text');
    if(expiry){ eb.classList.remove('hidden'); et.textContent=`Disappearing messages: ${formatExpiry(expiry)}`; }
    else eb.classList.add('hidden');
    if(!messages[chatId])await loadMessages(chatId); else renderMessages(chatId);
    WS.joinChat(chatId); document.getElementById('msg-input').focus();
  }

  async function loadMessages(chatId) {
    try { const d=await API.getMessages(chatId,50,0); messages[chatId]=d.messages; renderMessages(chatId); }
    catch { UI.toast('Failed to load messages'); }
  }

  function renderMessages(chatId) {
    const el=document.getElementById('messages-list');
    const msgs=messages[chatId]||[];
    if(!msgs.length){ el.innerHTML=`<div style="text-align:center;padding:2rem;color:var(--muted);font-size:14px">No messages yet.<br>Say hello 👋</div>`; return; }
    let html='',lastDay=null;
    msgs.forEach((msg,i)=>{
      const day=UI.fmtFullDate(msg.created_at);
      if(day!==lastDay){ html+=`<div class="day-divider"><span>${day}</span></div>`; lastDay=day; }
      if(msg.type==='system'){ html+=`<div class="system-msg">${UI.esc(msg.content)}</div>`; return; }
      html+=buildMsgHTML(msg,msg.sender_id===currentUser.id,!msgs[i+1]||msgs[i+1].sender_id!==msg.sender_id,chatId);
    });
    el.innerHTML=html;
    el.querySelectorAll('[data-msg-id]').forEach(row=>{
      const msg=(messages[chatId]||[]).find(m=>m.id===row.dataset.msgId);
      row.addEventListener('contextmenu',e=>{ e.preventDefault(); showMsgContext(e,msg); });
      let lt; row.addEventListener('touchstart',e=>{ lt=setTimeout(()=>{ const t=e.touches[0]; showReactionPicker(t,msg,row.classList.contains('outgoing')); },550); },{passive:true});
      row.addEventListener('touchend',()=>clearTimeout(lt));
      row.addEventListener('touchmove',()=>clearTimeout(lt));
    });
    scrollToBottom();
  }

  function buildMsgHTML(msg,isMine,showAvatar,chatId) {
    const chat=chats.find(c=>c.id===chatId), isGroup=chat?.type==='group';
    const isStarred=starredMessages.includes(msg.id);
    const msgReactions=reactions[msg.id]||{};
    const isExpiring=disappearingChats[chatId]>0;
    let replyHTML='';
    if(msg.reply_to&&msg.reply_content) replyHTML=`<div class="reply-bubble"><div class="reply-name">${UI.esc(msg.reply_sender_name||'')}</div><div class="reply-text">${UI.esc(msg.reply_content)}</div></div>`;
    let content='';
    if(msg.type==='image') content=`<img class="bubble-image" src="${UI.esc(msg.content)}" onclick="window.open('${UI.esc(msg.content)}')">`;
    else if(msg.type==='file'){
      try {
        const f=JSON.parse(msg.content);
        if(f.voice){
          const bars=Array.from({length:20},()=>`<div class="voice-bar" style="height:${Math.max(4,Math.random()*22)}px"></div>`).join('');
          content=`<div class="voice-msg"><button class="voice-play" onclick="playVoice(this,'${f.url}')">▶</button><div class="voice-wave">${bars}</div><span class="voice-duration">${fmtDur(f.duration||0)}</span></div>`;
        } else {
          content=`<a href="${UI.esc(f.url)}" target="_blank" style="display:flex;align-items:center;gap:8px;color:inherit;text-decoration:none"><span style="font-size:22px">📎</span><span style="font-size:13px;line-height:1.4">${UI.esc(f.name)}<br><span style="opacity:.6;font-size:11px">${(f.size/1024).toFixed(1)} KB</span></span></a>`;
        }
      } catch { content=UI.linkify(msg.content); }
    } else content=`<div class="bubble-text">${UI.linkify(msg.content)}</div>`;
    const reactionsHTML=Object.keys(msgReactions).length?`<div class="reactions">${Object.entries(msgReactions).map(([e,users])=>`<div class="reaction-chip ${users.includes(currentUser.id)?'mine':''}" onclick="App.addReaction('${e}','${msg.id}')">${e}<span>${users.length}</span></div>`).join('')}</div>`:'';
    const statusIcon=isMine?`<span class="msg-status${msg.delivered?' delivered':''}">${msg.delivered?'✓✓':'✓'}</span>`:'';
    return `<div class="msg-row ${isMine?'outgoing':'incoming'}" data-msg-id="${msg.id}">
      ${!isMine?`<div class="msg-avatar ${showAvatar?'':'invisible'}" style="background:${UI.colorForName(msg.display_name||'')}">${msg.avatar?`<img src="${msg.avatar}" style="width:100%;height:100%;object-fit:cover">`:UI.initials(msg.display_name||'?')}</div>`:''}
      <div>
        <div class="bubble ${msg.edited?'edited':''} ${isStarred?'starred':''} ${isExpiring?'expiring':''}">
          ${isGroup&&!isMine?`<div class="bubble-sender">${UI.esc(msg.display_name||'')}</div>`:''}
          ${replyHTML}${content}
          <div class="bubble-meta"><span class="bubble-time">${UI.fmtTime(msg.created_at)}</span>${statusIcon}</div>
        </div>
        ${reactionsHTML}
      </div></div>`;
  }

  function appendMessage(msg) {
    const el=document.getElementById('messages-list');
    el.querySelector('[style*="No messages"]')?.remove();
    const isMine=msg.sender_id===currentUser.id;
    const div=document.createElement('div'); div.innerHTML=buildMsgHTML(msg,isMine,true,activeChatId);
    const row=div.firstElementChild; el.appendChild(row);
    row.addEventListener('contextmenu',e=>{ e.preventDefault(); showMsgContext(e,msg); });
    let lt; row.addEventListener('touchstart',e=>{ lt=setTimeout(()=>{ const t=e.touches[0]; showReactionPicker(t,msg,row.classList.contains('outgoing')); },550); },{passive:true});
    row.addEventListener('touchend',()=>clearTimeout(lt));
    row.addEventListener('touchmove',()=>clearTimeout(lt));
    scrollToBottom();
  }

  // ── Send ────────────────────────────────────────────────────────────────────
  async function sendMessage() {
    const input=document.getElementById('msg-input');
    const text=input.value.trim(); if(!text||!activeChatId)return;
    input.value=''; autoGrow(input); toggleSendBtn();
    const payload={content:text,type:'text'};
    if(replyTo){payload.reply_to=replyTo.id;cancelReply();}
    try {
      const d=await API.sendMessage(activeChatId,payload);
      if(!messages[activeChatId])messages[activeChatId]=[];
      messages[activeChatId].push(d.message); appendMessage(d.message); updateChatPreview(activeChatId,d.message);
    } catch { UI.toast('Failed to send'); input.value=text; toggleSendBtn(); }
  }

  async function sendFile(file) {
    UI.toast('Uploading…',10000);
    try {
      const d=await API.upload(file);
      const isImage=file.type.startsWith('image/');
      const res=await API.sendMessage(activeChatId,{type:isImage?'image':'file',content:isImage?d.url:JSON.stringify({url:d.url,name:d.name,size:d.size})});
      if(!messages[activeChatId])messages[activeChatId]=[];
      messages[activeChatId].push(res.message); appendMessage(res.message); UI.toast('Sent ✓');
    } catch(err){ UI.toast('Upload failed: '+err.message); }
  }

  // ── Unique Feature: Disappearing Messages ───────────────────────────────────
  function toggleDisappearing() {
    document.getElementById('chat-dropdown').classList.add('hidden');
    if(!activeChatId)return;
    const current=disappearingChats[activeChatId]||0;
    const options=[
      {label:'Off', value:0},
      {label:'1 day', value:86400},
      {label:'1 week', value:604800},
      {label:'1 month', value:2592000},
    ];
    const picker=document.createElement('div');
    picker.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.6);display:flex;align-items:flex-end;justify-content:center;z-index:400;backdrop-filter:blur(4px)';
    picker.innerHTML=`<div style="background:var(--card);border-radius:24px 24px 0 0;width:100%;max-width:480px;padding-bottom:env(safe-area-inset-bottom)">
      <div style="width:40px;height:4px;background:var(--border);border-radius:2px;margin:12px auto 0"></div>
      <div style="padding:16px 20px;border-bottom:1px solid var(--border)"><div style="font-size:18px;font-weight:800;color:var(--text)">⏱ Disappearing Messages</div><div style="font-size:13.5px;color:var(--muted);margin-top:4px">Messages will auto-delete after being sent. Only you can see this setting.</div></div>
      ${options.map(o=>`<div onclick="App.setDisappearing(${o.value})" style="display:flex;align-items:center;justify-content:space-between;padding:16px 20px;cursor:pointer;border-bottom:.5px solid var(--border-sub);font-size:15px;color:${o.value===current?'var(--accent)':'var(--text)'};font-weight:${o.value===current?700:500}"><span>${o.label}</span>${o.value===current?'<span style="color:var(--accent);font-size:20px">✓</span>':''}</div>`).join('')}
      <div onclick="this.parentElement.parentElement.remove()" style="padding:16px 20px;text-align:center;color:var(--muted);font-size:15px;cursor:pointer">Cancel</div>
    </div>`;
    picker.onclick=e=>{ if(e.target===picker)picker.remove(); };
    document.body.appendChild(picker);
  }

  function setDisappearing(seconds) {
    document.querySelectorAll('[onclick*="setDisappearing"]').forEach(el=>el.closest('[style*="fixed"]')?.remove());
    if(!activeChatId)return;
    if(seconds===0) { delete disappearingChats[activeChatId]; }
    else { disappearingChats[activeChatId]=seconds; }
    localStorage.setItem('ow_disappearing',JSON.stringify(disappearingChats));
    // Update banner and chat list
    const eb=document.getElementById('expiry-banner'),et=document.getElementById('expiry-text');
    if(seconds){ eb.classList.remove('hidden'); et.textContent=`Disappearing messages: ${formatExpiry(seconds)}`; }
    else eb.classList.add('hidden');
    renderChatList();
    UI.toast(seconds?`⏱ Disappearing messages: ${formatExpiry(seconds)}`:'Disappearing messages off');
  }

  function formatExpiry(s) { return s>=2592000?'1 month':s>=604800?'1 week':s>=86400?'1 day':'Custom'; }

  // ── Reactions ───────────────────────────────────────────────────────────────
  function showReactionPicker(touch,msg,isOutgoing) {
    if(!msg)return; activeReactionMsgId=msg.id;
    const picker=document.getElementById('reaction-picker');
    picker.classList.toggle('outgoing-picker',isOutgoing);
    const x=Math.min(touch.clientX,window.innerWidth-230), y=Math.max(touch.clientY-80,10);
    picker.style.left=x+'px'; picker.style.top=y+'px';
    picker.querySelectorAll('.reaction-emoji').forEach(el=>{ el.onclick=()=>addReaction(el.dataset.emoji,msg.id); });
    picker.classList.add('open');
  }

  function addReaction(emoji,msgId) {
    const id=msgId||activeReactionMsgId; if(!id)return;
    document.getElementById('reaction-picker').classList.remove('open'); activeReactionMsgId=null;
    if(!reactions[id])reactions[id]={};
    if(!reactions[id][emoji])reactions[id][emoji]=[];
    const users=reactions[id][emoji], idx=users.indexOf(currentUser.id);
    if(idx!==-1)users.splice(idx,1); else users.push(currentUser.id);
    if(!users.length)delete reactions[id][emoji];
    if(!Object.keys(reactions[id]).length)delete reactions[id];
    localStorage.setItem('ow_reactions',JSON.stringify(reactions));
    const row=document.querySelector(`[data-msg-id="${id}"]`); if(!row)return;
    const existing=row.querySelector('.reactions');
    const newR=reactions[id]&&Object.keys(reactions[id]).length?`<div class="reactions">${Object.entries(reactions[id]).map(([e,users])=>`<div class="reaction-chip ${users.includes(currentUser.id)?'mine':''}" onclick="App.addReaction('${e}','${id}')">${e}<span>${users.length}</span></div>`).join('')}</div>`:'';
    if(existing)existing.outerHTML=newR||''; else if(newR){ const d=document.createElement('div'); d.innerHTML=newR; row.querySelector('div')?.appendChild(d.firstElementChild); }
  }

  // ── Star ────────────────────────────────────────────────────────────────────
  function toggleStar(msgId) {
    const i=starredMessages.indexOf(msgId);
    if(i!==-1)starredMessages.splice(i,1); else starredMessages.push(msgId);
    localStorage.setItem('ow_starred',JSON.stringify(starredMessages));
    const b=document.querySelector(`[data-msg-id="${msgId}"] .bubble`);
    if(b)b.classList.toggle('starred',starredMessages.includes(msgId));
    UI.toast(starredMessages.includes(msgId)?'⭐ Starred':'Unstarred');
  }

  function showStarred() {
    closeMenu(); openModal('modal-starred');
    const el=document.getElementById('starred-list');
    const all=Object.values(messages).flat(), starred=all.filter(m=>starredMessages.includes(m.id));
    if(!starred.length){ el.innerHTML=`<div style="text-align:center;padding:2.5rem 1rem;color:var(--muted);font-size:14px">No starred messages yet.<br>Long-press any message to star it ⭐</div>`; return; }
    el.innerHTML=starred.map(m=>{
      const chat=chats.find(c=>c.id===m.chat_id);
      return `<div class="starred-item" onclick="App.jumpToMessage('${m.chat_id}','${m.id}')">
        <div class="starred-item-chat">📍 ${UI.esc(getChatName(chat)||'')}</div>
        <div class="starred-item-text">${UI.esc(m.content?.substring(0,120)||'')}</div>
        <div class="starred-item-time">${UI.fmtDate(m.created_at)}</div>
      </div>`;
    }).join('');
  }

  async function jumpToMessage(chatId,msgId) {
    closeModal('modal-starred');
    if(chatId!==activeChatId)await openChat(chatId);
    setTimeout(()=>{ const el=document.querySelector(`[data-msg-id="${msgId}"]`); if(el){ el.scrollIntoView({behavior:'smooth',block:'center'}); el.classList.add('msg-highlight'); setTimeout(()=>el.classList.remove('msg-highlight'),2000); } },300);
  }

  // ── In-chat search ──────────────────────────────────────────────────────────
  function searchInChat(q) {
    const msgs=messages[activeChatId]||[];
    document.querySelectorAll('.msg-highlight').forEach(e=>e.classList.remove('msg-highlight'));
    if(!q.trim()){ document.getElementById('search-count').textContent=''; searchResults=[]; return; }
    searchResults=msgs.filter(m=>m.content?.toLowerCase().includes(q.toLowerCase())&&m.type==='text');
    searchIdx=searchResults.length-1;
    document.getElementById('search-count').textContent=searchResults.length?`${searchResults.length} result${searchResults.length!==1?'s':''}`:' No results';
    if(searchResults.length)highlightSearchResult();
  }
  function highlightSearchResult(){ const m=searchResults[searchIdx]; if(!m)return; const el=document.querySelector(`[data-msg-id="${m.id}"]`); if(el){el.scrollIntoView({behavior:'smooth',block:'center'});el.classList.add('msg-highlight');} }
  function closeChatSearch(){ document.getElementById('chat-search-bar').classList.remove('open'); document.getElementById('chat-search-input').value=''; document.getElementById('search-count').textContent=''; document.querySelectorAll('.msg-highlight').forEach(e=>e.classList.remove('msg-highlight')); searchResults=[]; }

  // ── Forward ─────────────────────────────────────────────────────────────────
  function showForward(msg) {
    forwardMsg=msg; openModal('modal-forward');
    const el=document.getElementById('forward-chat-list');
    el.innerHTML=chats.filter(c=>c.id!==activeChatId).map(c=>{
      const name=getChatName(c);
      return `<div class="user-item" onclick="App.forwardTo('${c.id}')"><div class="user-item-avatar" style="background:${UI.colorForName(name)}">${UI.initials(name)}</div><div><div class="user-item-name">${UI.esc(name)}</div></div></div>`;
    }).join('')||`<div style="padding:2rem;text-align:center;color:var(--muted)">No other chats</div>`;
  }
  async function forwardTo(chatId) {
    closeModal('modal-forward'); if(!forwardMsg)return;
    try { const res=await API.sendMessage(chatId,{content:forwardMsg.content,type:forwardMsg.type}); if(chatId===activeChatId){if(!messages[chatId])messages[chatId]=[];messages[chatId].push(res.message);appendMessage(res.message);} updateChatPreview(chatId,res.message); UI.toast('Forwarded'); }
    catch { UI.toast('Forward failed'); }
    forwardMsg=null;
  }

  // ── Context menu ────────────────────────────────────────────────────────────
  function showMsgContext(e,msg) {
    document.getElementById('msg-ctx')?.remove(); if(!msg)return;
    const isMine=msg.sender_id===currentUser.id, isStarred=starredMessages.includes(msg.id);
    const menu=document.createElement('div'); menu.id='msg-ctx'; menu.className='msg-context';
    const cx=Math.min(e.clientX,window.innerWidth-200), cy=Math.min(e.clientY,window.innerHeight-280);
    menu.style.cssText=`top:${cy}px;left:${cx}px`;
    const items=[
      {icon:'😊',label:'React',action:()=>{ const ft={clientX:e.clientX,clientY:e.clientY}; showReactionPicker(ft,msg,isMine); }},
      {icon:'↩',label:'Reply',action:()=>startReply(msg)},
      {icon:'↗',label:'Forward',action:()=>showForward(msg)},
      {icon:isStarred?'☆':'⭐',label:isStarred?'Unstar':'Star',action:()=>toggleStar(msg.id)},
      ...(msg.type==='text'?[{icon:'📋',label:'Copy',action:()=>{ navigator.clipboard?.writeText(msg.content); UI.toast('Copied'); }}]:[]),
      ...(isMine&&msg.type==='text'?[{icon:'✏',label:'Edit',action:()=>editMsg(msg)}]:[]),
      ...(isMine?[{icon:'🗑',label:'Delete',cls:'danger',action:()=>deleteMsg(msg)}]:[]),
    ];
    items.forEach(item=>{ const d=document.createElement('div'); d.className='msg-context-item '+(item.cls||''); d.innerHTML=`<span>${item.icon}</span><span>${item.label}</span>`; d.onclick=()=>{ menu.remove(); item.action(); }; menu.appendChild(d); });
    document.body.appendChild(menu);
    const rect=menu.getBoundingClientRect();
    if(rect.right>window.innerWidth)menu.style.left=(e.clientX-rect.width)+'px';
    if(rect.bottom>window.innerHeight)menu.style.top=(e.clientY-rect.height)+'px';
  }

  async function editMsg(msg) { const nc=prompt('Edit:',msg.content); if(!nc||nc===msg.content)return; try{await API.editMessage(msg.id,nc);}catch{UI.toast('Could not edit');} }
  async function deleteMsg(msg) { if(!confirm('Delete?'))return; try{await API.deleteMessage(msg.id);messages[activeChatId]=(messages[activeChatId]||[]).filter(m=>m.id!==msg.id);document.querySelector(`[data-msg-id="${msg.id}"]`)?.remove();}catch{UI.toast('Could not delete');} }

  // ── Reply ────────────────────────────────────────────────────────────────────
  function startReply(msg) { replyTo=msg; document.getElementById('reply-preview').classList.remove('hidden'); document.getElementById('reply-to-name').textContent=msg.display_name||'Message'; document.getElementById('reply-to-text').textContent=truncate(msg.content||'',60); document.getElementById('msg-input').focus(); }
  function cancelReply() { replyTo=null; document.getElementById('reply-preview').classList.add('hidden'); }
  function hideTyping() { document.getElementById('typing-banner').classList.add('hidden'); }

  // ── Notifications ────────────────────────────────────────────────────────────
  function notifyMessage(msg,chat) {
    if(!chat||msg.sender_id===currentUser?.id)return;
    if(msg.chat_id===activeChatId&&!document.hidden)return;
    if(Notification.permission==='default'){Notification.requestPermission();return;}
    if(Notification.permission!=='granted')return;
    notifCounts[chat.id]=(notifCounts[chat.id]||0)+1;
    const count=notifCounts[chat.id];
    const title=chat.type==='group'?getChatName(chat):(msg.display_name||getChatName(chat));
    const body=chat.type==='group'?`${msg.display_name||''}: ${msgPreview(msg)}`:(count>1?`${count} new messages`:msgPreview(msg));
    const n=new Notification(title,{body,tag:chat.id,renotify:count===1,silent:count>1});
    n.onclick=()=>{ window.focus(); notifCounts[chat.id]=0; openChat(chat.id); n.close(); };
  }
  function clearNotifCount(id){notifCounts[id]=0;}
  function msgPreview(msg){return msg.type==='image'?'📷 Photo':msg.type==='file'?'📎 File':msg.content?.substring(0,60)||'';}

  // ── User search ──────────────────────────────────────────────────────────────
  let _st;
  async function searchUsers(q) {
    clearTimeout(_st); if(!q.trim()){document.getElementById('user-search-results').innerHTML='';return;}
    _st=setTimeout(async()=>{
      try { const d=await API.searchUsers(q); const el=document.getElementById('user-search-results');
        if(!d.users.length){el.innerHTML=`<div style="padding:2rem;text-align:center;color:var(--muted)">No users found</div>`;return;}
        el.innerHTML=d.users.map(u=>`<div class="user-item" onclick="App.startDirectChat('${u.id}')">${UI.avatarHTML(u.display_name,u.avatar,46)}<div><div class="user-item-name">${UI.esc(u.display_name)}</div><div class="user-item-sub">@${UI.esc(u.username)}</div></div></div>`).join('');
      } catch {}
    },300);
  }

  async function startDirectChat(userId) {
    closeModal('modal-new-chat');
    try { const d=await API.openDirect(userId); if(!chats.find(c=>c.id===d.chat.id))chats.unshift(d.chat); else Object.assign(chats.find(c=>c.id===d.chat.id),d.chat); renderChatList(); openChat(d.chat.id); API.addContact(userId).catch(()=>{}); }
    catch(err){UI.toast('Could not open chat: '+err.message);}
  }

  // ── Groups ───────────────────────────────────────────────────────────────────
  function showNewGroup(){closeMenu();groupMembers=[];openModal('modal-new-group');document.getElementById('group-name-input').value='';document.getElementById('group-user-search').value='';document.getElementById('group-user-results').innerHTML='';renderSelectedMembers();}
  let _gst;
  async function searchGroupUsers(q){clearTimeout(_gst);if(!q.trim()){document.getElementById('group-user-results').innerHTML='';return;}_gst=setTimeout(async()=>{const d=await API.searchUsers(q).catch(()=>({users:[]}));document.getElementById('group-user-results').innerHTML=d.users.map(u=>`<div class="user-item" onclick="App.toggleGroupMember(${JSON.stringify(u).replace(/"/g,'&quot;')})">${UI.avatarHTML(u.display_name,u.avatar,46)}<div><div class="user-item-name">${UI.esc(u.display_name)}</div><div class="user-item-sub">@${UI.esc(u.username)}</div></div>${groupMembers.some(m=>m.id===u.id)?'<span class="user-item-check">✓</span>':''}</div>`).join('');},300);}
  function toggleGroupMember(user){const i=groupMembers.findIndex(m=>m.id===user.id);if(i!==-1)groupMembers.splice(i,1);else groupMembers.push(user);renderSelectedMembers();}
  function renderSelectedMembers(){document.getElementById('selected-members').innerHTML=groupMembers.map(u=>`<div class="selected-chip"><div class="chip-avatar" style="background:${UI.colorForName(u.display_name)}">${UI.initials(u.display_name)}</div>${UI.esc(u.display_name)}<span class="chip-remove" onclick="App.toggleGroupMember(${JSON.stringify(u).replace(/"/g,'&quot;')})">✕</span></div>`).join('');}
  async function createGroup(){const name=document.getElementById('group-name-input').value.trim();if(!name){UI.toast('Enter a group name');return;}try{const d=await API.createGroup({name,member_ids:groupMembers.map(m=>m.id)});chats.unshift(d.chat);renderChatList();closeModal('modal-new-group');openChat(d.chat.id);}catch(err){UI.toast('Failed: '+err.message);}}

  // ── WhatsApp-style Profile/Info ───────────────────────────────────────────
  async function showChatInfo() {
    const chat=chats.find(c=>c.id===activeChatId); if(!chat)return;
    openModal('modal-chat-info');
    const sheet=document.getElementById('profile-sheet-content');

    if(chat.type==='direct'&&chat.peer) {
      const u=chat.peer;
      document.getElementById('info-title').textContent='Contact Info';
      sheet.innerHTML=`
        <div class="profile-hero">
          <div class="profile-avatar-wrap">
            <div class="profile-avatar" style="background:${UI.colorForName(u.display_name)}">${u.avatar?`<img src="${u.avatar}" style="width:100%;height:100%;object-fit:cover">`:UI.initials(u.display_name)}</div>
          </div>
          <div class="profile-name-display">${UI.esc(u.display_name)}</div>
          <div class="profile-username-display">@${UI.esc(u.username)}</div>
          ${onlineUsers.has(u.id)?'<div class="profile-status-display">🟢 Online</div>':''}
        </div>
        <div class="profile-sections">
          <div class="profile-section">
            <div class="profile-section-title">About</div>
            <div class="profile-row"><span class="profile-row-icon">💬</span><div class="profile-row-body"><div class="profile-row-label">Bio</div><div class="profile-row-value">${UI.esc(u.bio||'No bio set')}</div></div></div>
            ${u.phone?`<div class="profile-row"><span class="profile-row-icon">📱</span><div class="profile-row-body"><div class="profile-row-label">Phone</div><div class="profile-row-value">${UI.esc(u.phone)}</div></div></div>`:''}
          </div>
          <div class="profile-section">
            <div class="profile-section-title">Actions</div>
            <div class="profile-row" onclick="App.closeModal('modal-chat-info')"><span class="profile-row-icon">💌</span><div class="profile-row-body"><div class="profile-row-value">Send Message</div></div><span class="profile-row-chevron">›</span></div>
            <div class="profile-row" style="color:var(--danger)" onclick="App.blockUser('${u.id}')"><span class="profile-row-icon">🚫</span><div class="profile-row-body"><div class="profile-row-value" style="color:var(--danger)">Block ${UI.esc(u.display_name)}</div></div></div>
          </div>
        </div>`;
    } else {
      const members=await API.getChatMembers(chat.id).then(d=>d.members).catch(()=>[]);
      document.getElementById('info-title').textContent='Group Info';
      const isOwner=members.find(m=>m.id===currentUser.id)?.role==='owner';
      sheet.innerHTML=`
        <div class="profile-hero">
          <div class="profile-avatar-wrap">
            <div class="profile-avatar" id="group-avatar-btn" style="background:${UI.colorForName(chat.name||'')};cursor:${isOwner?'pointer':'default'}">${chat.avatar?`<img src="${chat.avatar}" style="width:100%;height:100%;object-fit:cover">`:UI.initials(chat.name||'?')}</div>
            ${isOwner?'<div class="profile-cam-btn" onclick="document.getElementById(\'group-avatar-input\').click()">📷</div><input type="file" id="group-avatar-input" hidden accept="image/*">':''}
          </div>
          <div class="profile-name-display" id="group-name-display">${UI.esc(chat.name)}</div>
          <div class="profile-username-display">${members.length} members</div>
        </div>
        <div class="profile-sections">
          ${isOwner?`<div class="profile-section">
            <div class="profile-section-title">Group Settings</div>
            <div class="profile-row" onclick="App.editGroupName('${chat.id}')"><span class="profile-row-icon">✏</span><div class="profile-row-body"><div class="profile-row-label">Group name</div><div class="profile-row-value editable">${UI.esc(chat.name)}</div></div><span class="profile-row-chevron">›</span></div>
          </div>`:''}
          <div class="profile-section">
            <div class="profile-section-title">${members.length} Members</div>
            ${members.map(m=>`<div class="member-item"><div class="chat-avatar" style="background:${UI.colorForName(m.display_name)};width:46px;height:46px;font-size:17px">${m.avatar?`<img src="${m.avatar}" style="width:100%;height:100%;object-fit:cover">`:UI.initials(m.display_name)}</div><div style="flex:1;min-width:0"><div class="user-item-name">${UI.esc(m.display_name)}</div><div class="user-item-sub">@${UI.esc(m.username)}</div></div>${m.role!=='member'?`<span class="member-role-badge ${m.role}">${m.role==='owner'?'👑 Owner':'Admin'}</span>`:''}</div>`).join('')}
          </div>
          <div class="profile-section">
            <div class="profile-row" style="color:var(--danger)" onclick="App.deleteChat()"><span class="profile-row-icon">🚪</span><div class="profile-row-body"><div class="profile-row-value" style="color:var(--danger)">Leave Group</div></div></div>
          </div>
        </div>`;

      // Wire up group avatar upload
      if(isOwner) {
        document.getElementById('group-avatar-input')?.addEventListener('change',async e=>{
          const f=e.target.files[0]; if(!f)return;
          try {
            const d=await API.upload(f);
            await fetch(`/api/chats/${chat.id}`,{method:'PATCH',headers:{'Content-Type':'application/json','Authorization':'Bearer '+localStorage.getItem('ow_token')},body:JSON.stringify({avatar:d.url})});
            document.getElementById('group-avatar-btn').innerHTML=`<img src="${d.url}" style="width:100%;height:100%;object-fit:cover">`;
            const c=chats.find(x=>x.id===chat.id); if(c){c.avatar=d.url;renderChatList();document.getElementById('chat-header-avatar').innerHTML=`<img src="${d.url}" style="width:100%;height:100%;object-fit:cover">`;}
            UI.toast('Group photo updated ✓');
          } catch { UI.toast('Upload failed'); }
        });
      }
    }
  }

  async function editGroupName(chatId) {
    const chat=chats.find(c=>c.id===chatId); if(!chat)return;
    const newName=prompt('Group name:',chat.name); if(!newName||newName===chat.name)return;
    try {
      await fetch(`/api/chats/${chatId}`,{method:'PATCH',headers:{'Content-Type':'application/json','Authorization':'Bearer '+localStorage.getItem('ow_token')},body:JSON.stringify({name:newName})});
      chat.name=newName; document.getElementById('group-name-display').textContent=newName;
      document.getElementById('chat-header-name').textContent=newName; renderChatList(); UI.toast('Group renamed ✓');
    } catch { UI.toast('Failed to rename'); }
  }

  // ── Settings ──────────────────────────────────────────────────────────────
  function showSettings() {
    closeMenu(); openModal('modal-settings');
    const sc=document.getElementById('settings-content');
    const isDark=document.documentElement.getAttribute('data-theme')==='dark';
    sc.innerHTML=`
      <div class="settings-section">
        <div class="settings-section-title">Profile</div>
        <div style="text-align:center;padding:1.5rem 1rem">
          <div style="position:relative;display:inline-block">
            <div id="settings-avatar" style="width:86px;height:86px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:34px;font-weight:700;color:#fff;overflow:hidden;margin:0 auto;cursor:pointer;background:${UI.colorForName(currentUser.display_name)};box-shadow:0 6px 20px var(--accent-glow)" onclick="document.getElementById('avatar-file').click()">${currentUser.avatar?`<img src="${currentUser.avatar}" style="width:100%;height:100%;object-fit:cover">`:UI.initials(currentUser.display_name)}</div>
            <div style="position:absolute;bottom:0;right:0;width:28px;height:28px;border-radius:50%;background:var(--accent);color:#fff;display:flex;align-items:center;justify-content:center;font-size:13px;border:2px solid var(--card);cursor:pointer" onclick="document.getElementById('avatar-file').click()">📷</div>
          </div>
          <input type="file" id="avatar-file" hidden accept="image/*" onchange="App.uploadAvatar(this)">
          <div style="font-size:18px;font-weight:800;color:var(--text);margin-top:10px">${UI.esc(currentUser.display_name)}</div>
          <div style="font-size:13px;color:var(--muted)">@${UI.esc(currentUser.username)}</div>
        </div>
        <div class="settings-row" onclick="App.editField('display_name')"><span class="settings-row-icon">👤</span><div class="settings-row-body"><div class="settings-row-label">Display Name</div><div class="settings-row-sub">${UI.esc(currentUser.display_name)}</div></div><span class="settings-row-right">›</span></div>
        <div class="settings-row" onclick="App.editField('bio')"><span class="settings-row-icon">💬</span><div class="settings-row-body"><div class="settings-row-label">Bio</div><div class="settings-row-sub">${UI.esc(currentUser.bio||'Add a bio…')}</div></div><span class="settings-row-right">›</span></div>
      </div>
      <div class="settings-section">
        <div class="settings-section-title">Appearance</div>
        <div class="settings-row" onclick="UI.setTheme(!${isDark});App.showSettings()"><span class="settings-row-icon">${isDark?'☀️':'🌙'}</span><div class="settings-row-body"><div class="settings-row-label">Dark Mode</div><div class="settings-row-sub">Currently ${isDark?'on':'off'}</div></div><div class="settings-toggle ${isDark?'on':''}"></div></div>
      </div>
      <div class="settings-section">
        <div class="settings-section-title">Account</div>
        <div class="settings-row"><span class="settings-row-icon">🔑</span><div class="settings-row-body"><div class="settings-row-label">Username</div><div class="settings-row-sub">@${UI.esc(currentUser.username)}</div></div></div>
        ${currentUser.phone?`<div class="settings-row"><span class="settings-row-icon">📱</span><div class="settings-row-body"><div class="settings-row-label">Phone</div><div class="settings-row-sub">${UI.esc(currentUser.phone)}</div></div></div>`:''}
      </div>
      <div class="settings-section" style="margin-bottom:60px">
        <div class="settings-row danger" onclick="App.logout()" style="color:var(--danger)"><span class="settings-row-icon">↩</span><div class="settings-row-body"><div class="settings-row-label" style="color:var(--danger)">Sign Out</div></div></div>
      </div>`;
  }

  async function editField(field) {
    const labels={display_name:'Display Name',bio:'Bio'};
    const current=currentUser[field]||'';
    const val=prompt(`Edit ${labels[field]}:`,current); if(val===null||val===current)return;
    try {
      const d=await API.updateProfile({...currentUser,[field]:val}); currentUser=d.user;
      updateMenuProfile(); showSettings(); UI.toast('Saved ✓');
    } catch(err){UI.toast('Failed: '+err.message);}
  }

  async function uploadAvatar(input) {
    const f=input.files[0]; if(!f)return;
    try { const d=await API.upload(f); const av=document.getElementById('settings-avatar'); if(av){av.innerHTML=`<img src="${d.url}" style="width:100%;height:100%;object-fit:cover">`;} currentUser.avatar=d.url; updateMenuProfile(); UI.toast('Photo updated ✓'); }
    catch { UI.toast('Upload failed'); }
  }

  async function blockUser(userId) {
    if(!confirm('Block this user?'))return;
    try { await API.blockContact(userId); closeModal('modal-chat-info'); chats=chats.filter(c=>!(c.type==='direct'&&c.peer?.id===userId)); closeChat(); renderChatList(); UI.toast('User blocked'); }
    catch(err){UI.toast('Could not block: '+err.message);}
  }

  // ── Menu ─────────────────────────────────────────────────────────────────────
  function openMenu(){document.getElementById('menu-drawer').classList.add('open');document.getElementById('menu-overlay').classList.add('open');}
  function closeMenu(){document.getElementById('menu-drawer').classList.remove('open');document.getElementById('menu-overlay').classList.remove('open');}
  function showContacts(){closeMenu();openModal('modal-new-chat');document.getElementById('user-search-input').value='';document.getElementById('user-search-results').innerHTML='';setTimeout(()=>document.getElementById('user-search-input').focus(),100);}
  function openModal(id){document.getElementById(id)?.classList.remove('hidden');}
  function closeModal(id){document.getElementById(id)?.classList.add('hidden');}

  function closeChat(){
    document.getElementById('chat-view').classList.add('hidden');
    document.getElementById('splash').classList.remove('hidden');
    document.getElementById('chat-area').classList.remove('open');
    if(activeChatId)WS.leaveChat(); activeChatId=null; renderChatList();
  }

  function clearChatHistory(){
    document.getElementById('chat-dropdown').classList.add('hidden');
    if(!activeChatId||!confirm('Clear all messages?'))return;
    messages[activeChatId]=[]; renderMessages(activeChatId); UI.toast('Cleared');
  }

  async function deleteChat(){
    document.getElementById('chat-dropdown').classList.add('hidden'); closeModal('modal-chat-info');
    const chat=chats.find(c=>c.id===activeChatId); if(!chat)return;
    const isGroup=chat.type==='group';
    if(!confirm(isGroup?'Leave this group?':'Delete this conversation?'))return;
    try { if(isGroup)await API.leaveGroup(activeChatId).catch(()=>{}); else await API.deleteChat(activeChatId).catch(()=>{}); }
    catch {}
    chats=chats.filter(c=>c.id!==activeChatId); closeChat(); renderChatList();
    UI.toast(isGroup?'Left group':'Chat deleted');
  }

  function getChatName(chat){return chat?.type==='direct'?chat.peer?.display_name||'Unknown':chat?.name||'Group';}
  function truncate(s,l){return !s?'':(s.length>l?s.slice(0,l)+'…':s);}
  function autoGrow(el){el.style.height='auto';el.style.height=Math.min(el.scrollHeight,120)+'px';}
  function toggleSendBtn(){const v=document.getElementById('msg-input').value.trim();document.getElementById('send-btn').classList.toggle('idle',!v);document.getElementById('voice-btn').style.display=v?'none':'flex';}
  function scrollToBottom(){const el=document.getElementById('messages-list');el.scrollTop=el.scrollHeight;}
  function fmtDur(s){return `${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}`;}

  function logout(){closeMenu();if(!confirm('Sign out?'))return;WS.disconnect();localStorage.removeItem('ow_token');currentUser=null;chats=[];messages={};activeChatId=null;document.getElementById('app').classList.add('hidden');document.getElementById('chat-view').classList.add('hidden');document.getElementById('splash').classList.remove('hidden');showAuth();}

  return {
    init,openChat,closeChat,startDirectChat,searchUsers,showNewGroup,searchGroupUsers,
    toggleGroupMember,createGroup,showChatInfo,showSettings,editField,uploadAvatar,
    showContacts,openMenu,closeMenu,openModal,closeModal,logout,
    clearChatHistory,deleteChat,cancelReply,addReaction,showStarred,jumpToMessage,
    searchInChat,closeChatSearch,forwardTo,blockUser,toggleDisappearing,setDisappearing,
    editGroupName,
  };
})();

function playVoice(btn,url){
  if(btn._audio){btn._audio.pause();btn._audio=null;btn.textContent='▶';return;}
  const a=new Audio(url);btn._audio=a;btn.textContent='⏸';
  const bars=btn.nextElementSibling?.querySelectorAll('.voice-bar');
  a.addEventListener('timeupdate',()=>{ if(bars){const p=a.currentTime/a.duration;bars.forEach((b,i)=>b.classList.toggle('played',i/bars.length<p));} });
  a.addEventListener('ended',()=>{btn.textContent='▶';btn._audio=null;if(bars)bars.forEach(b=>b.classList.remove('played'));});
  a.play().catch(()=>{btn.textContent='▶';btn._audio=null;});
}

document.addEventListener('DOMContentLoaded',()=>App.init());
