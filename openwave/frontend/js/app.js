'use strict';
const App = (() => {
  let currentUser=null,chats=[],activeChatId=null,messages={};
  let typingTimers={},groupMembers=[],replyTo=null,onlineUsers=new Set();
  let forwardMsg=null,activeReactionMsgId=null;
  let mediaRecorder=null,recordChunks=[],recordTimer=null,recordSeconds=0;
  let starredMessages=JSON.parse(localStorage.getItem('ow_starred')||'[]');
  let reactions=JSON.parse(localStorage.getItem('ow_reactions')||'{}');
  let disappearing=JSON.parse(localStorage.getItem('ow_disappearing')||'{}');
  let _resetToken=null,_resetUserId=null;

  // ─── INIT ───────────────────────────────────────────────────────────────────
  async function init() {
    UI.loadTheme();
    // Fetch config (bot username for invite tip)
    fetch('/api/config').then(r=>r.json()).then(cfg=>{
      if(cfg.bot_username){
        const link=`https://t.me/${cfg.bot_username}`;
        ['bot-link','reg-bot-link'].forEach(id=>{const el=document.getElementById(id);if(el)el.href=link;});
        ['invite-banner','reg-invite-banner'].forEach(id=>{const el=document.getElementById(id);if(el)el.style.display='block';});
      }
    }).catch(()=>{});
    // Check URL for reset token
    const params=new URLSearchParams(location.search);
    const rToken=params.get('token'),rUser=params.get('user');
    if(rToken&&rUser){history.replaceState({},'','/');_resetToken=rToken;_resetUserId=rUser;showAuthView('auth-reset');return;}
    // Check for invite link
    const m=location.pathname.match(/^\/invite\/([a-zA-Z0-9]+)$/);
    if(m){history.replaceState({},'','/');const code=m[1];const tok=localStorage.getItem('ow_token');if(!tok){document.getElementById('reg-invite').value=code;showAuthView('auth-register');return;}}
    // Try auto-login
    const tok=localStorage.getItem('ow_token');
    if(tok){try{const d=await API.me();currentUser=d.user;startApp();}catch(err){if(err.offline)showOffline();else{localStorage.removeItem('ow_token');showAuthScreen();}}}
    else showAuthScreen();
  }

  function showAuthScreen(){
    document.getElementById('auth-screen').style.display='flex';
    document.getElementById('app').classList.add('hidden');
    showAuthView('auth-login');
    setupAuthHandlers();
  }
  function showOffline(){
    document.getElementById('auth-screen').style.display='flex';
    document.getElementById('app').classList.add('hidden');
    showAuthView('auth-login');
    document.getElementById('login-error').textContent='No connection. Please check your internet.';
  }
  function showAuthView(id){
    document.querySelectorAll('.auth-view').forEach(v=>v.classList.remove('active'));
    const el=document.getElementById(id);if(el){el.classList.add('active');el.scrollTop=0;}
    setupAuthHandlers();
  }
  function showLogin(){showAuthView('auth-login');}
  function showRegister(){showAuthView('auth-register');}
  function showForgotPassword(){
    showAuthView('auth-forgot');
    document.getElementById('forgot-error').textContent='';
    document.getElementById('forgot-success').style.display='none';
  }

  async function requestPasswordReset(){
    const u=document.getElementById('forgot-username').value.trim();
    const errEl=document.getElementById('forgot-error');
    const succEl=document.getElementById('forgot-success');
    errEl.textContent='';succEl.style.display='none';
    if(!u){errEl.textContent='Enter your username';return;}
    const btn=document.querySelector('#auth-forgot .btn-main');
    btn.disabled=true;btn.textContent='Sending…';
    try{
      const d=await API.forgotPassword(u);
      succEl.textContent=d.message||'Request submitted.';
      if(d.reset_link)succEl.textContent+='\n\nReset link (dev only):\n'+d.reset_link;
      succEl.style.display='block';
      if(d.token&&d.user_id){_resetToken=d.token;_resetUserId=d.user_id;setTimeout(()=>showAuthView('auth-reset'),2000);}
    }catch(err){errEl.textContent=err.message;}
    finally{btn.disabled=false;btn.textContent='Send Reset Link';}
  }

  async function submitPasswordReset(){
    const pw=document.getElementById('reset-password').value;
    const pw2=document.getElementById('reset-confirm').value;
    const errEl=document.getElementById('reset-error');
    errEl.textContent='';
    if(pw.length<6){errEl.textContent='Password must be at least 6 characters';return;}
    if(pw!==pw2){errEl.textContent='Passwords do not match';return;}
    if(!_resetToken||!_resetUserId){errEl.textContent='Invalid session. Please start over.';return;}
    const btn=document.querySelector('#auth-reset .btn-main');
    btn.disabled=true;btn.textContent='Updating…';
    try{
      const d=await API.resetPassword(_resetToken,_resetUserId,pw);
      localStorage.setItem('ow_token',d.token);currentUser=d.user;
      _resetToken=null;_resetUserId=null;
      startApp();
    }catch(err){errEl.textContent=err.message;btn.disabled=false;btn.textContent='Update Password';}
  }

  function setupAuthHandlers(){
    const lf=document.getElementById('login-form');
    if(lf&&!lf._b){lf._b=true;lf.addEventListener('submit',async e=>{
      e.preventDefault();const btn=lf.querySelector('.btn-main');btn.disabled=true;btn.textContent='Signing in…';
      try{const d=await API.login({username:document.getElementById('login-username').value,password:document.getElementById('login-password').value});localStorage.setItem('ow_token',d.token);currentUser=d.user;startApp();}
      catch(err){document.getElementById('login-error').textContent=err.message;btn.disabled=false;btn.textContent='Sign In';}
    });}
    const rf=document.getElementById('register-form');
    if(rf&&!rf._b){rf._b=true;rf.addEventListener('submit',async e=>{
      e.preventDefault();const btn=rf.querySelector('.btn-main');btn.disabled=true;btn.textContent='Creating…';
      try{
        if(!checkCaptcha()){document.getElementById('reg-error').textContent='Wrong answer. Try again.';refreshCaptcha();btn.disabled=false;btn.textContent='Create Account';return;}
        const d=await API.register({username:document.getElementById('reg-username').value,display_name:document.getElementById('reg-name').value,phone:document.getElementById('reg-phone').value||undefined,password:document.getElementById('reg-password').value,invite_code:document.getElementById('reg-invite').value.trim()});
        localStorage.setItem('ow_token',d.token);currentUser=d.user;startApp();
      }catch(err){document.getElementById('reg-error').textContent=err.message;btn.disabled=false;btn.textContent='Create Account';}
    });}
  }

  // ─── APP START ──────────────────────────────────────────────────────────────
  async function startApp(){
    document.getElementById('auth-screen').style.display='none';
    document.getElementById('app').classList.remove('hidden');
    updateMenuProfile();setupEventListeners();
    WS.connect(localStorage.getItem('ow_token'));setupWSHandlers();
    await loadChats();
  }

  function updateMenuProfile(){
    if(!currentUser)return;
    const av=document.getElementById('menu-avatar');
    if(currentUser.avatar)av.innerHTML=`<img src="${currentUser.avatar}" style="width:100%;height:100%;object-fit:cover">`;
    else{av.style.background=UI.colorForName(currentUser.display_name);av.textContent=UI.initials(currentUser.display_name);}
    document.getElementById('menu-display-name').textContent=currentUser.display_name;
    document.getElementById('menu-username').textContent='@'+currentUser.username;
  }

  function setupEventListeners(){
    document.getElementById('theme-btn').onclick=()=>UI.setTheme(document.documentElement.getAttribute('data-theme')==='light');
    document.getElementById('menu-btn').onclick=openMenu;
    document.getElementById('compose-btn').onclick=()=>{openModal('modal-new-chat');document.getElementById('user-search-input').value='';document.getElementById('user-search-results').innerHTML='';setTimeout(()=>document.getElementById('user-search-input').focus(),100);};
    document.getElementById('starred-btn').onclick=showStarred;
    const si=document.getElementById('search-input');
    si.oninput=e=>{const q=e.target.value;document.getElementById('clear-search').classList.toggle('hidden',!q);filterChatList(q);};
    document.getElementById('clear-search').onclick=()=>{si.value='';document.getElementById('clear-search').classList.add('hidden');renderChatList();};
    const input=document.getElementById('msg-input');
    input.oninput=()=>{autoGrow(input);toggleSendBtn();if(activeChatId)WS.onInputTyping(activeChatId);};
    input.onkeydown=e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();sendMessage();}};
    document.getElementById('send-btn').onclick=sendMessage;
    document.getElementById('attach-btn').onclick=()=>document.getElementById('file-input').click();
    document.getElementById('file-input').onchange=async e=>{const f=e.target.files[0];if(!f||!activeChatId)return;e.target.value='';await sendFile(f);};
    document.getElementById('chat-menu-btn').onclick=()=>document.getElementById('chat-dropdown').classList.toggle('hidden');
    document.getElementById('chat-search-btn').onclick=()=>{const b=document.getElementById('chat-search-bar');b.classList.toggle('open');if(b.classList.contains('open'))document.getElementById('chat-search-input').focus();else closeChatSearch();};
    document.getElementById('reaction-picker').querySelectorAll('.reaction-emoji').forEach(el=>{el.onclick=()=>addReaction(el.dataset.emoji);});
    setupVoiceRecorder();setupSwipeBack();
    document.addEventListener('click',e=>{
      if(!e.target.closest('#chat-dropdown')&&!e.target.closest('#chat-menu-btn'))document.getElementById('chat-dropdown').classList.add('hidden');
      const ctx=document.getElementById('msg-ctx');if(ctx&&!ctx.contains(e.target))ctx.remove();
      const rp=document.getElementById('reaction-picker');if(rp&&!rp.contains(e.target)&&!e.target.closest('[data-msg-id]')){rp.classList.remove('open');activeReactionMsgId=null;}
    });
    document.querySelectorAll('.modal').forEach(m=>{m.onclick=e=>{if(e.target===m)m.classList.add('hidden');};});
  }

  function setupSwipeBack(){
    let sx=0,sy=0,dragging=false;
    const ca=document.getElementById('chat-area');
    ca.addEventListener('touchstart',e=>{sx=e.touches[0].clientX;sy=e.touches[0].clientY;dragging=false;},{passive:true});
    ca.addEventListener('touchmove',e=>{if(!activeChatId)return;const dx=e.touches[0].clientX-sx,dy=Math.abs(e.touches[0].clientY-sy);if(dx>20&&dy<80&&sx<50){dragging=true;ca.style.transform=`translateX(${Math.min(dx,window.innerWidth)}px)`;ca.style.transition='none';}},{passive:true});
    ca.addEventListener('touchend',e=>{const dx=e.changedTouches[0].clientX-sx;ca.style.transition='';ca.style.transform='';if(dragging&&dx>110)closeChat();dragging=false;});
  }

  function setupVoiceRecorder(){
    const btn=document.getElementById('voice-btn'),timer=document.getElementById('record-timer');
    btn.addEventListener('click',async()=>{
      if(mediaRecorder&&mediaRecorder.state==='recording'){mediaRecorder.stop();btn.classList.remove('recording');timer.classList.remove('visible');clearInterval(recordTimer);recordSeconds=0;timer.textContent='0:00';return;}
      try{const stream=await navigator.mediaDevices.getUserMedia({audio:true});recordChunks=[];mediaRecorder=new MediaRecorder(stream);mediaRecorder.ondataavailable=e=>recordChunks.push(e.data);mediaRecorder.onstop=()=>{stream.getTracks().forEach(t=>t.stop());sendVoiceNote();};mediaRecorder.start();btn.classList.add('recording');timer.classList.add('visible');recordSeconds=0;recordTimer=setInterval(()=>{recordSeconds++;timer.textContent=`${Math.floor(recordSeconds/60)}:${String(recordSeconds%60).padStart(2,'0')}`;},1000);}
      catch{UI.toast('Microphone access denied');}
    });
  }

  async function sendVoiceNote(){
    if(!recordChunks.length||!activeChatId)return;
    const blob=new Blob(recordChunks,{type:'audio/webm'});
    const file=new File([blob],`voice-${Date.now()}.webm`,{type:'audio/webm'});
    try{const d=await API.upload(file);const res=await API.sendMessage(activeChatId,{type:'file',content:JSON.stringify({url:d.url,name:'Voice',size:blob.size,voice:true,duration:recordSeconds||1})});if(!messages[activeChatId])messages[activeChatId]=[];messages[activeChatId].push(res.message);appendMessage(res.message);}
    catch{UI.toast('Voice note failed');}
  }

  // ─── WS HANDLERS ────────────────────────────────────────────────────────────
  function setupWSHandlers(){
    WS.on('connected',()=>{if(activeChatId)WS.joinChat(activeChatId);});
    WS.on('new_message',data=>{
      const{message,chat_id}=data;if(!messages[chat_id])messages[chat_id]=[];messages[chat_id].push(message);
      if(chat_id===activeChatId&&!document.hidden){appendMessage(message);API.markRead(message.id).catch(()=>{});}
      else{const c=chats.find(c=>c.id===chat_id);if(c&&chat_id!==activeChatId)c.unread_count=(c.unread_count||0)+1;notify(message,chats.find(c=>c.id===chat_id));}
      updateChatPreview(chat_id,message);
    });
    WS.on('message_edited',data=>{if(messages[data.chat_id]){const i=messages[data.chat_id].findIndex(m=>m.id===data.message.id);if(i!==-1)messages[data.chat_id][i]=data.message;}if(data.chat_id===activeChatId){const el=document.querySelector(`[data-msg-id="${data.message.id}"] .bubble-text`);if(el){el.innerHTML=UI.linkify(data.message.content);el.closest('.bubble').classList.add('edited');};}});
    WS.on('message_deleted',data=>{if(messages[data.chat_id])messages[data.chat_id]=messages[data.chat_id].filter(m=>m.id!==data.message_id);if(data.chat_id===activeChatId)document.querySelector(`[data-msg-id="${data.message_id}"]`)?.remove();});
    WS.on('typing_start',data=>{if(data.chat_id!==activeChatId)return;document.getElementById('typing-text').textContent=`${data.display_name} is typing…`;document.getElementById('typing-banner').classList.remove('hidden');clearTimeout(typingTimers[data.user_id]);typingTimers[data.user_id]=setTimeout(()=>document.getElementById('typing-banner').classList.add('hidden'),3000);});
    WS.on('typing_stop',()=>document.getElementById('typing-banner').classList.add('hidden'));
    WS.on('presence',data=>{if(data.status==='online')onlineUsers.add(data.user_id);else onlineUsers.delete(data.user_id);document.querySelectorAll(`[data-user-id="${data.user_id}"] .online-dot`).forEach(el=>el.style.display=data.status==='online'?'block':'none');if(activeChatId){const c=chats.find(c=>c.id===activeChatId);if(c?.peer?.id===data.user_id){const s=document.getElementById('chat-header-status');s.textContent=data.status==='online'?'online':UI.lastSeen(data.last_seen);s.className='chat-header-status'+(data.status==='online'?' online':'');}}});
    WS.on('message_read',data=>{if(data.chat_id===activeChatId){const el=document.querySelector(`[data-msg-id="${data.message_id}"] .msg-status`);if(el){el.textContent='✓✓';el.classList.add('read');}}});
    WS.on('chat_created',data=>{chats.unshift(data.chat);renderChatList();});
  }

  // ─── CHATS ──────────────────────────────────────────────────────────────────
  async function loadChats(){try{const d=await API.getChats();chats=d.chats||[];renderChatList();}catch{UI.toast('Failed to load chats');}}

  function getChatName(c){return c?.type==='direct'?c.peer?.display_name||'Unknown':c?.name||'Group';}

  function renderChatList(){
    const el=document.getElementById('chat-list');
    if(!chats.length){el.innerHTML=`<div style="text-align:center;padding:3rem 1rem;color:var(--muted);font-size:14px;line-height:2">No chats yet.<br>Tap ✏ to start one</div>`;return;}
    el.innerHTML=chats.map(c=>{
      const name=getChatName(c),online=c.peer&&onlineUsers.has(c.peer.id);
      const src=c.avatar||c.peer?.avatar;
      const prev=c.last_message?trunc(c.last_message,42):'Say hello! 👋';
      return `<div class="chat-item ${c.id===activeChatId?'active':''}" data-chat-id="${c.id}" data-user-id="${c.peer?.id||''}" onclick="App.openChat('${c.id}')">
        <div class="chat-avatar" style="background:${UI.colorForName(name)}">${src?`<img src="${src}" style="width:100%;height:100%;object-fit:cover">`:UI.initials(name)}${online?'<div class="online-dot"></div>':''}</div>
        <div class="chat-item-body">
          <div class="chat-item-top"><div class="chat-item-name">${UI.esc(name)}${disappearing[c.id]?' ⏱':''}</div><div class="chat-item-time">${c.last_msg_ts?UI.fmtDate(c.last_msg_ts):''}</div></div>
          <div class="chat-item-preview"><div class="chat-item-text">${UI.esc(prev)}</div>${c.unread_count>0?`<div class="unread-badge">${c.unread_count}</div>`:''}</div>
        </div></div>`;
    }).join('');
  }

  function filterChatList(q){const f=chats.filter(c=>getChatName(c).toLowerCase().includes(q.toLowerCase()));const el=document.getElementById('chat-list');if(!f.length){el.innerHTML=`<div style="text-align:center;padding:2rem;color:var(--muted)">No results</div>`;return;}const orig=chats;chats=f;renderChatList();chats=orig;}
  function updateChatPreview(id,msg){const c=chats.find(c=>c.id===id);if(!c)return;c.last_message=msg.content;c.last_msg_ts=msg.created_at;chats=[c,...chats.filter(c=>c.id!==id)];renderChatList();}

  async function openChat(chatId){
    if(activeChatId)WS.leaveChat();activeChatId=chatId;
    const chat=chats.find(c=>c.id===chatId);if(!chat)return;
    chat.unread_count=0;renderChatList();
    document.getElementById('splash').classList.add('hidden');
    document.getElementById('chat-view').classList.remove('hidden');
    document.getElementById('chat-area').classList.add('open');
    closeChatSearch();
    const name=getChatName(chat),src=chat.avatar||chat.peer?.avatar;
    const ha=document.getElementById('chat-header-avatar');
    ha.style.background=UI.colorForName(name);ha.innerHTML=src?`<img src="${src}" style="width:100%;height:100%;object-fit:cover">`:UI.initials(name);
    document.getElementById('chat-header-name').textContent=name;
    const s=document.getElementById('chat-header-status');
    if(chat.type==='direct'&&chat.peer){const on=onlineUsers.has(chat.peer.id);s.textContent=on?'online':UI.lastSeen(chat.peer.last_seen);s.className='chat-header-status'+(on?' online':'');}
    else{s.textContent=`${(chat.members||[]).length} members`;s.className='chat-header-status';}
    const exp=disappearing[chatId];
    const eb=document.getElementById('expiry-banner');
    if(exp){eb.classList.remove('hidden');document.getElementById('expiry-text').textContent=`Disappearing: ${fmtExp(exp)}`;}else eb.classList.add('hidden');
    if(!messages[chatId])await loadMessages(chatId);else renderMessages(chatId);
    WS.joinChat(chatId);document.getElementById('msg-input').focus();
  }

  async function loadMessages(id){try{const d=await API.getMessages(id,50,0);messages[id]=d.messages;renderMessages(id);}catch{UI.toast('Failed to load messages');}}

  function renderMessages(chatId){
    const el=document.getElementById('messages-list');const msgs=messages[chatId]||[];
    if(!msgs.length){el.innerHTML=`<div style="text-align:center;padding:2rem;color:var(--muted);font-size:14px">No messages yet. Say hello! 👋</div>`;return;}
    let html='',lastDay=null;
    msgs.forEach((msg,i)=>{
      const day=UI.fmtFullDate(msg.created_at);
      if(day!==lastDay){html+=`<div class="day-divider"><span>${day}</span></div>`;lastDay=day;}
      if(msg.type==='system'){html+=`<div class="system-msg">${UI.esc(msg.content)}</div>`;return;}
      html+=buildMsgHTML(msg,msg.sender_id===currentUser.id,!msgs[i+1]||msgs[i+1].sender_id!==msg.sender_id,chatId);
    });
    el.innerHTML=html;
    el.querySelectorAll('[data-msg-id]').forEach(row=>{
      const msg=(messages[chatId]||[]).find(m=>m.id===row.dataset.msgId);if(!msg)return;
      row.addEventListener('contextmenu',e=>{e.preventDefault();showCtx(e,msg);});
      let lt;row.addEventListener('touchstart',e=>{lt=setTimeout(()=>showCtx(e.touches[0],msg),550);},{passive:true});
      row.addEventListener('touchend',()=>clearTimeout(lt));row.addEventListener('touchmove',()=>clearTimeout(lt));
    });
    scrollToBottom();
  }

  function buildMsgHTML(msg,isMine,showAv,chatId){
    const chat=chats.find(c=>c.id===chatId),isGroup=chat?.type==='group';
    const starred=starredMessages.includes(msg.id);
    const msgR=reactions[msg.id]||{};
    let reply='';
    if(msg.reply_to&&msg.reply_content)reply=`<div class="reply-bubble"><div class="reply-name">${UI.esc(msg.reply_sender_name||'')}</div><div class="reply-text">${UI.esc(msg.reply_content)}</div></div>`;
    let content='';
    if(msg.type==='image')content=`<img class="bubble-image" src="${UI.esc(msg.content)}" onclick="window.open('${UI.esc(msg.content)}')">`;
    else if(msg.type==='file'){try{const f=JSON.parse(msg.content);if(f.voice){const bars=Array.from({length:18},()=>`<div class="voice-bar" style="height:${Math.max(4,Math.random()*20)}px"></div>`).join('');content=`<div class="voice-msg"><button class="voice-play" onclick="playVoice(this,'${f.url}')">▶</button><div class="voice-wave">${bars}</div><span class="voice-duration">${fmtDur(f.duration||0)}</span></div>`;}else{content=`<a href="${UI.esc(f.url)}" target="_blank" style="display:flex;align-items:center;gap:8px;color:inherit;text-decoration:none"><span style="font-size:22px">📎</span><span style="font-size:13px;line-height:1.4">${UI.esc(f.name)}<br><span style="opacity:.6;font-size:11px">${(f.size/1024).toFixed(1)} KB</span></span></a>`;}}catch{content=UI.linkify(msg.content);}}
    else content=`<div class="bubble-text">${UI.linkify(msg.content)}</div>`;
    const rxHTML=Object.keys(msgR).length?`<div class="reactions">${Object.entries(msgR).map(([e,u])=>`<div class="reaction-chip ${u.includes(currentUser.id)?'mine':''}" onclick="App.addReaction('${e}','${msg.id}')">${e}<span>${u.length}</span></div>`).join('')}</div>`:'';
    const status=isMine?`<span class="msg-status ${msg.delivered?'read':''}">${msg.delivered?'✓✓':'✓'}</span>`:'';
    return `<div class="msg-row ${isMine?'outgoing':'incoming'}" data-msg-id="${msg.id}">
      ${!isMine?`<div class="msg-avatar ${showAv?'':'invisible'}" style="background:${UI.colorForName(msg.display_name||'')}">${msg.avatar?`<img src="${msg.avatar}" style="width:100%;height:100%;object-fit:cover">`:UI.initials(msg.display_name||'?')}</div>`:''}
      <div><div class="bubble ${msg.edited?'edited':''} ${starred?'starred':''}">
        ${isGroup&&!isMine?`<div class="bubble-sender">${UI.esc(msg.display_name||'')}</div>`:''}
        ${reply}${content}
        <div class="bubble-meta"><span class="bubble-time">${UI.fmtTime(msg.created_at)}</span>${status}</div>
      </div>${rxHTML}</div></div>`;
  }

  function appendMessage(msg){
    const el=document.getElementById('messages-list');el.querySelector('[style*="No messages"]')?.remove();el.querySelector('[style*="Say hello"]')?.remove();
    const isMine=msg.sender_id===currentUser.id;
    const d=document.createElement('div');d.innerHTML=buildMsgHTML(msg,isMine,true,activeChatId);
    const row=d.firstElementChild;el.appendChild(row);
    row.addEventListener('contextmenu',e=>{e.preventDefault();showCtx(e,msg);});
    let lt;row.addEventListener('touchstart',e=>{lt=setTimeout(()=>showCtx(e.touches[0],msg),550);},{passive:true});
    row.addEventListener('touchend',()=>clearTimeout(lt));row.addEventListener('touchmove',()=>clearTimeout(lt));
    scrollToBottom();
  }

  async function sendMessage(){
    const input=document.getElementById('msg-input');const text=input.value.trim();if(!text||!activeChatId)return;
    input.value='';autoGrow(input);toggleSendBtn();
    const payload={content:text,type:'text'};if(replyTo){payload.reply_to=replyTo.id;cancelReply();}
    try{const d=await API.sendMessage(activeChatId,payload);if(!messages[activeChatId])messages[activeChatId]=[];messages[activeChatId].push(d.message);appendMessage(d.message);updateChatPreview(activeChatId,d.message);}
    catch{UI.toast('Failed to send');input.value=text;toggleSendBtn();}
  }

  async function sendFile(file){
    UI.toast('Uploading…',8000);
    try{const d=await API.upload(file);const isImg=file.type.startsWith('image/');const res=await API.sendMessage(activeChatId,{type:isImg?'image':'file',content:isImg?d.url:JSON.stringify({url:d.url,name:d.name,size:d.size})});if(!messages[activeChatId])messages[activeChatId]=[];messages[activeChatId].push(res.message);appendMessage(res.message);UI.toast('Sent ✓');}
    catch(err){UI.toast('Upload failed: '+err.message);}
  }

  // ─── CONTEXT MENU ───────────────────────────────────────────────────────────
  function showCtx(e,msg){
    document.getElementById('msg-ctx')?.remove();if(!msg)return;
    const isMine=msg.sender_id===currentUser.id;
    const starred=starredMessages.includes(msg.id);
    const menu=document.createElement('div');menu.id='msg-ctx';menu.className='msg-context';
    const x=Math.min((e.clientX||e.pageX||0),window.innerWidth-200);
    const y=Math.min((e.clientY||e.pageY||0),window.innerHeight-280);
    menu.style.cssText=`top:${y}px;left:${x}px`;
    [
      {i:'😊',l:'React',a:()=>{activeReactionMsgId=msg.id;const rp=document.getElementById('reaction-picker');rp.style.left=x+'px';rp.style.top=(y-60)+'px';rp.querySelectorAll('.reaction-emoji').forEach(el=>{el.onclick=()=>addReaction(el.dataset.emoji,msg.id);});rp.classList.add('open');}},
      {i:'↩',l:'Reply',a:()=>startReply(msg)},
      {i:'↗',l:'Forward',a:()=>showForward(msg)},
      {i:starred?'☆':'⭐',l:starred?'Unstar':'Star',a:()=>toggleStar(msg.id)},
      ...(msg.type==='text'?[{i:'📋',l:'Copy',a:()=>{navigator.clipboard?.writeText(msg.content);UI.toast('Copied');}}]:[]),
      ...(isMine&&msg.type==='text'?[{i:'✏',l:'Edit',a:()=>editMsg(msg)}]:[]),
      ...(isMine?[{i:'🗑',l:'Delete',cls:'danger',a:()=>deleteMsg(msg)}]:[]),
    ].forEach(item=>{const d=document.createElement('div');d.className='msg-context-item '+(item.cls||'');d.innerHTML=`<span>${item.i}</span><span>${item.l}</span>`;d.onclick=()=>{menu.remove();item.a();};menu.appendChild(d);});
    document.getElementById('app').appendChild(menu);
    const rect=menu.getBoundingClientRect();if(rect.right>window.innerWidth)menu.style.left=(x-rect.width)+'px';if(rect.bottom>window.innerHeight)menu.style.top=(y-rect.height)+'px';
  }

  function addReaction(emoji,msgId){
    const id=msgId||activeReactionMsgId;if(!id)return;
    document.getElementById('reaction-picker').classList.remove('open');activeReactionMsgId=null;
    if(!reactions[id])reactions[id]={};if(!reactions[id][emoji])reactions[id][emoji]=[];
    const u=reactions[id][emoji],idx=u.indexOf(currentUser.id);
    if(idx!==-1)u.splice(idx,1);else u.push(currentUser.id);
    if(!u.length)delete reactions[id][emoji];if(!Object.keys(reactions[id]).length)delete reactions[id];
    localStorage.setItem('ow_reactions',JSON.stringify(reactions));
    const row=document.querySelector(`[data-msg-id="${id}"]`);if(!row)return;
    const existing=row.querySelector('.reactions');
    const newR=reactions[id]&&Object.keys(reactions[id]).length?`<div class="reactions">${Object.entries(reactions[id]).map(([e,u])=>`<div class="reaction-chip ${u.includes(currentUser.id)?'mine':''}" onclick="App.addReaction('${e}','${id}')">${e}<span>${u.length}</span></div>`).join('')}</div>`:'';
    if(existing)existing.outerHTML=newR||'';else if(newR){const div=document.createElement('div');div.innerHTML=newR;row.querySelector('div')?.appendChild(div.firstElementChild);}
  }

  function toggleStar(id){const i=starredMessages.indexOf(id);if(i!==-1)starredMessages.splice(i,1);else starredMessages.push(id);localStorage.setItem('ow_starred',JSON.stringify(starredMessages));const b=document.querySelector(`[data-msg-id="${id}"] .bubble`);if(b)b.classList.toggle('starred',starredMessages.includes(id));UI.toast(starredMessages.includes(id)?'⭐ Starred':'Unstarred');}
  function showForward(msg){forwardMsg=msg;openModal('modal-forward');const el=document.getElementById('forward-chat-list');el.innerHTML=chats.filter(c=>c.id!==activeChatId).map(c=>{const n=getChatName(c);return`<div class="user-item" onclick="App.forwardTo('${c.id}')">${UI.avatarHTML(n,c.avatar||c.peer?.avatar,46)}<div><div class="user-item-name">${UI.esc(n)}</div></div></div>`;}).join('')||`<div style="padding:2rem;text-align:center;color:var(--muted)">No other chats</div>`;}
  async function forwardTo(chatId){closeModal('modal-forward');if(!forwardMsg)return;try{const res=await API.sendMessage(chatId,{content:forwardMsg.content,type:forwardMsg.type});if(chatId===activeChatId){if(!messages[chatId])messages[chatId]=[];messages[chatId].push(res.message);appendMessage(res.message);}updateChatPreview(chatId,res.message);UI.toast('Forwarded');}catch{UI.toast('Forward failed');}forwardMsg=null;}
  async function editMsg(msg){const nc=prompt('Edit:',msg.content);if(!nc||nc===msg.content)return;try{await API.editMessage(msg.id,nc);}catch{UI.toast('Could not edit');}}
  async function deleteMsg(msg){if(!confirm('Delete?'))return;try{await API.deleteMessage(msg.id);messages[activeChatId]=(messages[activeChatId]||[]).filter(m=>m.id!==msg.id);document.querySelector(`[data-msg-id="${msg.id}"]`)?.remove();}catch{UI.toast('Could not delete');}}

  function startReply(msg){replyTo=msg;document.getElementById('reply-preview').classList.remove('hidden');document.getElementById('reply-to-name').textContent=msg.display_name||'Message';document.getElementById('reply-to-text').textContent=trunc(msg.content||'',60);document.getElementById('msg-input').focus();}
  function cancelReply(){replyTo=null;document.getElementById('reply-preview').classList.add('hidden');}

  function showStarred(){closeMenu();openModal('modal-starred');const el=document.getElementById('starred-list');const all=Object.values(messages).flat(),s=all.filter(m=>starredMessages.includes(m.id));if(!s.length){el.innerHTML=`<div style="text-align:center;padding:2.5rem 1rem;color:var(--muted)">No starred messages yet.<br>Long-press any message to star it ⭐</div>`;return;}el.innerHTML=s.map(m=>{const c=chats.find(c=>c.id===m.chat_id);return`<div class="starred-item" onclick="App.jumpToMessage('${m.chat_id}','${m.id}')"><div class="starred-item-chat">📍 ${UI.esc(getChatName(c)||'')}</div><div class="starred-item-text">${UI.esc(m.content?.substring(0,120)||'')}</div><div class="starred-item-time">${UI.fmtDate(m.created_at)}</div></div>`;}).join('');}
  async function jumpToMessage(chatId,msgId){closeModal('modal-starred');if(chatId!==activeChatId)await openChat(chatId);setTimeout(()=>{const el=document.querySelector(`[data-msg-id="${msgId}"]`);if(el){el.scrollIntoView({behavior:'smooth',block:'center'});el.classList.add('msg-highlight');setTimeout(()=>el.classList.remove('msg-highlight'),2000);}},300);}

  function searchInChat(q){document.querySelectorAll('.msg-highlight').forEach(e=>e.classList.remove('msg-highlight'));if(!q.trim()){document.getElementById('search-count').textContent='';return;}const msgs=messages[activeChatId]||[];const r=msgs.filter(m=>m.content?.toLowerCase().includes(q.toLowerCase())&&m.type==='text');document.getElementById('search-count').textContent=r.length?`${r.length} result${r.length!==1?'s':''}`:' No results';if(r.length){const el=document.querySelector(`[data-msg-id="${r[r.length-1].id}"]`);if(el){el.scrollIntoView({behavior:'smooth',block:'center'});el.classList.add('msg-highlight');}}}
  function closeChatSearch(){document.getElementById('chat-search-bar').classList.remove('open');document.getElementById('chat-search-input').value='';document.getElementById('search-count').textContent='';document.querySelectorAll('.msg-highlight').forEach(e=>e.classList.remove('msg-highlight'));}

  function notify(msg,chat){if(!chat||msg.sender_id===currentUser?.id)return;if(Notification.permission==='default'){Notification.requestPermission();return;}if(Notification.permission!=='granted')return;new Notification(getChatName(chat),{body:msg.content?.substring(0,80),tag:chat.id});}

  // ─── DISAPPEARING ───────────────────────────────────────────────────────────
  function toggleDisappearing(){
    document.getElementById('chat-dropdown').classList.add('hidden');if(!activeChatId)return;
    const cur=disappearing[activeChatId]||0;
    const opts=[{l:'Off',v:0},{l:'1 day',v:86400},{l:'1 week',v:604800},{l:'1 month',v:2592000}];
    const p=document.createElement('div');p.style.cssText='position:absolute;inset:0;background:rgba(0,0,0,.65);display:flex;align-items:flex-end;justify-content:center;z-index:400;backdrop-filter:blur(4px)';
    p.innerHTML=`<div style="background:var(--card);border-radius:24px 24px 0 0;width:100%;padding-bottom:env(safe-area-inset-bottom)"><div style="width:40px;height:4px;background:var(--border);border-radius:2px;margin:12px auto 0"></div><div style="padding:16px 20px;border-bottom:1px solid var(--border)"><div style="font-size:18px;font-weight:800;color:var(--text)">⏱ Disappearing Messages</div><div style="font-size:13.5px;color:var(--muted);margin-top:4px">Only you see this setting.</div></div>${opts.map(o=>`<div onclick="App.setDisappearing(${o.v})" style="display:flex;align-items:center;justify-content:space-between;padding:16px 20px;cursor:pointer;border-bottom:.5px solid var(--border-sub);font-size:15px;color:${o.v===cur?'var(--accent)':'var(--text)'};font-weight:${o.v===cur?700:500}"><span>${o.l}</span>${o.v===cur?'<span style="color:var(--accent);font-size:20px">✓</span>':''}</div>`).join('')}<div onclick="this.closest('[style*=fixed]')?.remove();this.parentElement.parentElement.remove()" style="padding:16px 20px;text-align:center;color:var(--muted);font-size:15px;cursor:pointer">Cancel</div></div>`;
    p.onclick=e=>{if(e.target===p)p.remove();};document.getElementById('app').appendChild(p);
  }
  function setDisappearing(s){
    document.querySelectorAll('[onclick*="setDisappearing"]').forEach(el=>el.closest('[style*="absolute"]')?.remove());
    if(!activeChatId)return;
    if(s===0)delete disappearing[activeChatId];else disappearing[activeChatId]=s;
    localStorage.setItem('ow_disappearing',JSON.stringify(disappearing));
    const eb=document.getElementById('expiry-banner');
    if(s){eb.classList.remove('hidden');document.getElementById('expiry-text').textContent=`Disappearing: ${fmtExp(s)}`;}else eb.classList.add('hidden');
    renderChatList();UI.toast(s?`⏱ ${fmtExp(s)}`:'Disappearing off');
  }
  function fmtExp(s){return s>=2592000?'1 month':s>=604800?'1 week':'1 day';}

  // ─── USER / GROUP SEARCH ────────────────────────────────────────────────────
  let _st;
  async function searchUsers(q){clearTimeout(_st);if(!q.trim()){document.getElementById('user-search-results').innerHTML='';return;}_st=setTimeout(async()=>{try{const d=await API.searchUsers(q);const el=document.getElementById('user-search-results');if(!d.users.length){el.innerHTML=`<div style="padding:2rem;text-align:center;color:var(--muted)">No users found</div>`;return;}el.innerHTML=d.users.map(u=>`<div class="user-item" onclick="App.startDirectChat('${u.id}')">${UI.avatarHTML(u.display_name,u.avatar,46)}<div><div class="user-item-name">${UI.esc(u.display_name)}</div><div class="user-item-sub">@${UI.esc(u.username)}</div></div></div>`).join('');}catch{}},300);}

  async function startDirectChat(userId){closeModal('modal-new-chat');try{const d=await API.openDirect(userId);if(!chats.find(c=>c.id===d.chat.id))chats.unshift(d.chat);else Object.assign(chats.find(c=>c.id===d.chat.id),d.chat);renderChatList();openChat(d.chat.id);API.addContact(userId).catch(()=>{});}catch(err){UI.toast('Could not open chat: '+err.message);}}

  function showNewGroup(){closeMenu();groupMembers=[];openModal('modal-new-group');document.getElementById('group-name-input').value='';document.getElementById('group-user-search').value='';document.getElementById('group-user-results').innerHTML='';renderSelectedMembers();}
  let _gst;
  async function searchGroupUsers(q){clearTimeout(_gst);if(!q.trim()){document.getElementById('group-user-results').innerHTML='';return;}_gst=setTimeout(async()=>{const d=await API.searchUsers(q).catch(()=>({users:[]}));document.getElementById('group-user-results').innerHTML=d.users.map(u=>`<div class="user-item" onclick="App.toggleGroupMember(${JSON.stringify(u).replace(/"/g,'&quot;')})">${UI.avatarHTML(u.display_name,u.avatar,46)}<div><div class="user-item-name">${UI.esc(u.display_name)}</div><div class="user-item-sub">@${UI.esc(u.username)}</div></div>${groupMembers.some(m=>m.id===u.id)?'<span class="user-item-check">✓</span>':''}</div>`).join('');},300);}
  function toggleGroupMember(u){const i=groupMembers.findIndex(m=>m.id===u.id);if(i!==-1)groupMembers.splice(i,1);else groupMembers.push(u);renderSelectedMembers();}
  function renderSelectedMembers(){document.getElementById('selected-members').innerHTML=groupMembers.map(u=>`<div class="selected-chip" style="background:var(--active);border-color:rgba(229,9,20,.3)"><span style="width:24px;height:24px;border-radius:50%;background:${UI.colorForName(u.display_name)};color:#fff;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;flex-shrink:0">${UI.initials(u.display_name)}</span>${UI.esc(u.display_name)}<span class="chip-remove" onclick="App.toggleGroupMember(${JSON.stringify(u).replace(/"/g,'&quot;')})">✕</span></div>`).join('');}
  async function createGroup(){const name=document.getElementById('group-name-input').value.trim();if(!name){UI.toast('Enter a group name');return;}try{const d=await API.createGroup({name,member_ids:groupMembers.map(m=>m.id)});chats.unshift(d.chat);renderChatList();closeModal('modal-new-group');openChat(d.chat.id);}catch(err){UI.toast('Failed: '+err.message);}}

  // ─── CHAT INFO / SETTINGS ───────────────────────────────────────────────────
  async function showChatInfo(){
    const chat=chats.find(c=>c.id===activeChatId);if(!chat)return;
    openModal('modal-chat-info');const sheet=document.getElementById('profile-sheet-content');
    if(chat.type==='direct'&&chat.peer){
      const u=chat.peer;document.getElementById('info-title').textContent='Contact Info';
      sheet.innerHTML=`<div class="profile-hero"><div class="profile-avatar" style="background:${UI.colorForName(u.display_name)}">${u.avatar?`<img src="${u.avatar}" style="width:100%;height:100%;object-fit:cover">`:UI.initials(u.display_name)}</div><div class="profile-name-display">${UI.esc(u.display_name)}</div><div class="profile-username-display">@${UI.esc(u.username)}${onlineUsers.has(u.id)?'<span style="color:var(--online);font-size:12px;margin-left:8px;font-weight:700">● Online</span>':''}</div></div>
      <div class="profile-sections"><div class="profile-section"><div class="profile-section-title">About</div><div class="profile-row"><span class="profile-row-icon">💬</span><div class="profile-row-body"><div class="profile-row-label">Bio</div><div class="profile-row-value">${UI.esc(u.bio||'No bio set')}</div></div></div></div>
      <div class="profile-section"><div class="profile-section-title">Actions</div><div class="profile-row" onclick="App.closeModal('modal-chat-info')"><span class="profile-row-icon">💌</span><div class="profile-row-body"><div class="profile-row-value">Send Message</div></div><span class="profile-row-chevron">›</span></div><div class="profile-row" style="color:var(--danger)" onclick="App.blockUser('${u.id}')"><span class="profile-row-icon">🚫</span><div class="profile-row-body"><div class="profile-row-value" style="color:var(--danger)">Block ${UI.esc(u.display_name)}</div></div></div></div></div>`;
    }else{
      const members=await API.getChatMembers(chat.id).then(d=>d.members).catch(()=>[]);
      const isOwner=members.find(m=>m.id===currentUser.id)?.role==='owner';
      document.getElementById('info-title').textContent='Group Info';
      sheet.innerHTML=`<div class="profile-hero"><div class="profile-avatar" style="background:${UI.colorForName(chat.name||'')};${isOwner?'cursor:pointer':''}">
        ${chat.avatar?`<img src="${chat.avatar}" style="width:100%;height:100%;object-fit:cover">`:UI.initials(chat.name||'?')}
        ${isOwner?'<div class="profile-cam-btn" onclick="document.getElementById(\'gf\').click()">📷</div><input type="file" id="gf" hidden accept="image/*">':''}
      </div><div class="profile-name-display">${UI.esc(chat.name)}</div><div class="profile-username-display">${members.length} members</div></div>
      <div class="profile-sections">${isOwner?`<div class="profile-section"><div class="profile-section-title">Settings</div><div class="profile-row" onclick="App.editGroupName('${chat.id}')"><span class="profile-row-icon">✏️</span><div class="profile-row-body"><div class="profile-row-label">Group name</div><div class="profile-row-value editable">${UI.esc(chat.name)}</div></div><span class="profile-row-chevron">›</span></div></div>`:''}
      <div class="profile-section"><div class="profile-section-title">${members.length} Members</div>${members.map(m=>`<div class="member-item"><div class="chat-avatar" style="background:${UI.colorForName(m.display_name)};width:46px;height:46px;font-size:17px">${m.avatar?`<img src="${m.avatar}" style="width:100%;height:100%;object-fit:cover">`:UI.initials(m.display_name)}</div><div style="flex:1;min-width:0"><div class="user-item-name">${UI.esc(m.display_name)}</div><div class="user-item-sub">@${UI.esc(m.username)}</div></div>${m.role!=='member'?`<span class="member-role-badge ${m.role}">${m.role==='owner'?'👑 Owner':'Admin'}</span>`:''}</div>`).join('')}</div>
      <div class="profile-section"><div class="profile-row" style="color:var(--danger)" onclick="App.deleteChat()"><span class="profile-row-icon">🚪</span><div class="profile-row-body"><div class="profile-row-value" style="color:var(--danger)">Leave Group</div></div></div></div></div>`;
      if(isOwner)document.getElementById('gf')?.addEventListener('change',async e=>{const f=e.target.files[0];if(!f)return;try{const d=await API.upload(f);await API.updateChat(chat.id,{avatar:d.url});const c=chats.find(x=>x.id===chat.id);if(c){c.avatar=d.url;renderChatList();}UI.toast('Photo updated ✓');}catch{UI.toast('Upload failed');}});
    }
  }
  async function editGroupName(chatId){const c=chats.find(c=>c.id===chatId);if(!c)return;const n=prompt('Group name:',c.name);if(!n||n===c.name)return;try{await API.updateChat(chatId,{name:n});c.name=n;document.getElementById('chat-header-name').textContent=n;renderChatList();UI.toast('Renamed ✓');}catch{UI.toast('Failed');}}

  function showSettings(){
    closeMenu();openModal('modal-settings');
    const sc=document.getElementById('settings-content');
    const isDark=document.documentElement.getAttribute('data-theme')!=='light';
    sc.innerHTML=`
      <div class="settings-profile-card" onclick="App.showEditProfile()">
        <div class="settings-profile-avatar" style="background:${UI.colorForName(currentUser.display_name)}">${currentUser.avatar?`<img src="${currentUser.avatar}" style="width:100%;height:100%;object-fit:cover">`:UI.initials(currentUser.display_name)}</div>
        <div><div class="settings-profile-name">${UI.esc(currentUser.display_name)}</div><div class="settings-profile-sub">${UI.esc(currentUser.bio||'Tap to add a bio')}</div></div>
      </div>
      <div class="settings-group"><div class="settings-group-label">General</div>
        <div class="settings-item" onclick="App.showEditProfile()"><div class="settings-item-icon" style="background:rgba(229,9,20,.1)">👤</div><div class="settings-item-body"><div class="settings-item-label">Profile</div><div class="settings-item-sub">Name, photo, bio</div></div><span class="settings-item-right" style="color:var(--muted)">›</span></div>
        <div class="settings-item"><div class="settings-item-icon" style="background:rgba(29,155,240,.1)">${isDark?'🌙':'☀️'}</div><div class="settings-item-body"><div class="settings-item-label">Dark Mode</div><div class="settings-item-sub">Currently ${isDark?'on':'off'}</div></div><div class="ow-toggle ${isDark?'active':''}" id="dark-toggle" onclick="event.stopPropagation();App.toggleThemeSetting()"></div></div>
      </div>
      <div class="settings-group"><div class="settings-group-label">Account</div>
        <div class="settings-item"><div class="settings-item-icon" style="background:rgba(0,186,124,.1)">🔑</div><div class="settings-item-body"><div class="settings-item-label">Username</div><div class="settings-item-sub">@${UI.esc(currentUser.username)}</div></div></div>
        <div class="settings-item" onclick="App.showEditField('display_name','Display Name',${JSON.stringify(currentUser.display_name)})"><div class="settings-item-icon" style="background:rgba(229,9,20,.1)">✏️</div><div class="settings-item-body"><div class="settings-item-label">Change Name</div><div class="settings-item-sub">${UI.esc(currentUser.display_name)}</div></div><span class="settings-item-right" style="color:var(--muted)">›</span></div>
        <div class="settings-item" onclick="App.showEditField('bio','Bio',${JSON.stringify(currentUser.bio||'')})"><div class="settings-item-icon" style="background:rgba(229,9,20,.1)">💬</div><div class="settings-item-body"><div class="settings-item-label">Bio</div><div class="settings-item-sub">${UI.esc(currentUser.bio||'Add a bio…')}</div></div><span class="settings-item-right" style="color:var(--muted)">›</span></div>
      </div>
      <div class="settings-group"><div class="settings-group-label">Privacy</div>
        <div class="settings-item"><div class="settings-item-icon" style="background:rgba(244,33,46,.1)">🔒</div><div class="settings-item-body"><div class="settings-item-label">Invite-only Registration</div><div class="settings-item-sub">Only people you invite can join</div></div><span style="color:var(--online);font-size:12px;font-weight:700">ON</span></div>
      </div>
      <div class="settings-group"><div class="settings-group-label">About</div>
        <div class="settings-item" onclick="window.open('https://github.com/shubhamkhidwalia/openwave-messenger','_blank')"><div class="settings-item-icon" style="background:rgba(255,255,255,.06)">📦</div><div class="settings-item-body"><div class="settings-item-label">GitHub Repository</div><div class="settings-item-sub">View source code</div></div><span class="settings-item-right" style="color:var(--muted)">›</span></div>
        <div class="settings-item"><div class="settings-item-icon" style="background:rgba(229,9,20,.1)">👨‍💻</div><div class="settings-item-body"><div class="settings-item-label">Developed by</div><div class="settings-item-sub">Shubham Khidwalia — OpenWave v1.0</div></div></div>
      </div>
      <div class="settings-group" style="margin-bottom:60px">
        <div class="settings-item" onclick="App.logout()"><div class="settings-item-icon" style="background:rgba(244,33,46,.1)">🚪</div><div class="settings-item-body"><div class="settings-item-label" style="color:var(--danger)">Sign Out</div></div></div>
      </div>`;
  }

  function showEditProfile(){
    const u=currentUser;
    const ov=document.createElement('div');ov.className='edit-field-overlay';
    ov.innerHTML=`<div class="edit-field-box"><div style="text-align:center;margin-bottom:20px"><div id="ep-av" style="width:80px;height:80px;border-radius:50%;background:${UI.colorForName(u.display_name)};display:flex;align-items:center;justify-content:center;font-size:32px;font-weight:800;color:#fff;margin:0 auto 8px;overflow:hidden;cursor:pointer;box-shadow:0 4px 16px var(--accent-glow)" onclick="document.getElementById('ep-file').click()">${u.avatar?`<img src="${u.avatar}" style="width:100%;height:100%;object-fit:cover">`:UI.initials(u.display_name)}</div><input type="file" id="ep-file" hidden accept="image/*"><div style="font-size:13px;color:var(--accent);font-weight:600">Tap to change</div></div><div class="edit-field-title">Edit Profile</div><label style="font-size:11px;font-weight:800;color:var(--muted);text-transform:uppercase;letter-spacing:.08em;display:block;margin-bottom:5px">Name</label><input class="edit-field-input" id="ep-name" value="${UI.esc(u.display_name)}"><label style="font-size:11px;font-weight:800;color:var(--muted);text-transform:uppercase;letter-spacing:.08em;display:block;margin-bottom:5px">Bio</label><input class="edit-field-input" id="ep-bio" value="${UI.esc(u.bio||'')}" placeholder="About you…"><div class="edit-field-actions"><button class="edit-field-btn cancel" onclick="this.closest('.edit-field-overlay').remove()">Cancel</button><button class="edit-field-btn save" onclick="App.saveProfileEdit()">Save</button></div></div>`;
    ov.onclick=e=>{if(e.target===ov)ov.remove();};document.getElementById('app').appendChild(ov);
    document.getElementById('ep-file').addEventListener('change',async e=>{const f=e.target.files[0];if(!f)return;try{const d=await API.upload(f);document.getElementById('ep-av').innerHTML=`<img src="${d.url}" style="width:100%;height:100%;object-fit:cover">`;currentUser.avatar=d.url;UI.toast('Photo updated ✓');}catch{UI.toast('Upload failed');}});
  }
  async function saveProfileEdit(){
    const name=document.getElementById('ep-name')?.value?.trim();const bio=document.getElementById('ep-bio')?.value||'';
    if(!name){UI.toast('Name cannot be empty');return;}
    try{const d=await API.updateProfile({display_name:name,bio,avatar:currentUser.avatar||''});currentUser=d.user;updateMenuProfile();document.querySelector('.edit-field-overlay')?.remove();showSettings();UI.toast('Saved ✓');}
    catch(err){UI.toast('Failed: '+err.message);}
  }
  function toggleThemeSetting(){const isDark=document.documentElement.getAttribute('data-theme')!=='light';UI.setTheme(!isDark);setTimeout(showSettings,50);}
  function showEditField(field,label,val){
    const ov=document.createElement('div');ov.className='edit-field-overlay';
    ov.innerHTML=`<div class="edit-field-box"><div class="edit-field-title">Edit ${label}</div><input class="edit-field-input" id="sef-input" value="${UI.esc(val)}" placeholder="${label}…"><div class="edit-field-actions"><button class="edit-field-btn cancel" onclick="this.closest('.edit-field-overlay').remove()">Cancel</button><button class="edit-field-btn save" onclick="App.saveFieldEdit('${field}')">Save</button></div></div>`;
    ov.onclick=e=>{if(e.target===ov)ov.remove();};document.getElementById('app').appendChild(ov);
    setTimeout(()=>document.getElementById('sef-input')?.focus(),100);
  }
  async function saveFieldEdit(field){
    const val=document.getElementById('sef-input')?.value?.trim()||'';
    if(!val&&field==='display_name'){UI.toast('Name cannot be empty');return;}
    try{const d=await API.updateProfile({...currentUser,[field]:val});currentUser=d.user;updateMenuProfile();document.querySelector('.edit-field-overlay')?.remove();showSettings();UI.toast('Saved ✓');}
    catch(err){UI.toast('Failed: '+err.message);}
  }
  async function blockUser(uid){if(!confirm('Block this user?'))return;try{await API.blockContact(uid);closeModal('modal-chat-info');chats=chats.filter(c=>!(c.type==='direct'&&c.peer?.id===uid));closeChat();renderChatList();UI.toast('Blocked');}catch(err){UI.toast('Could not block: '+err.message);}}

  // ─── NAVIGATION ─────────────────────────────────────────────────────────────
  function openMenu(){document.getElementById('menu-drawer').classList.add('open');document.getElementById('menu-overlay').classList.add('open');}
  function closeMenu(){document.getElementById('menu-drawer').classList.remove('open');document.getElementById('menu-overlay').classList.remove('open');}
  function showContacts(){closeMenu();openModal('modal-new-chat');document.getElementById('user-search-input').value='';document.getElementById('user-search-results').innerHTML='';setTimeout(()=>document.getElementById('user-search-input').focus(),100);}
  function openModal(id){document.getElementById(id)?.classList.remove('hidden');}
  function closeModal(id){document.getElementById(id)?.classList.add('hidden');}

  async function openChat_fn(chatId){return openChat(chatId);}
  function closeChat(){
    document.getElementById('chat-view').classList.add('hidden');
    document.getElementById('splash').classList.remove('hidden');
    document.getElementById('chat-area').classList.remove('open');
    if(activeChatId)WS.leaveChat();activeChatId=null;renderChatList();
  }
  function clearChatHistory(){document.getElementById('chat-dropdown').classList.add('hidden');if(!activeChatId||!confirm('Clear all messages?'))return;messages[activeChatId]=[];renderMessages(activeChatId);UI.toast('Cleared');}
  async function deleteChat(){
    document.getElementById('chat-dropdown').classList.add('hidden');closeModal('modal-chat-info');
    const chat=chats.find(c=>c.id===activeChatId);if(!chat)return;
    if(!confirm(chat.type==='group'?'Leave this group?':'Delete this conversation?'))return;
    try{if(chat.type==='group')await API.leaveGroup(activeChatId).catch(()=>{});else await API.deleteChat(activeChatId).catch(()=>{});}catch{}
    chats=chats.filter(c=>c.id!==activeChatId);closeChat();renderChatList();UI.toast(chat.type==='group'?'Left group':'Deleted');
  }
  function logout(){closeMenu();if(!confirm('Sign out?'))return;WS.disconnect();localStorage.removeItem('ow_token');currentUser=null;chats=[];messages={};activeChatId=null;document.getElementById('app').classList.add('hidden');document.getElementById('chat-view').classList.add('hidden');document.getElementById('splash').classList.remove('hidden');showAuthScreen();}

  // ─── HELPERS ────────────────────────────────────────────────────────────────
  function trunc(s,l){return !s?'':(s.length>l?s.slice(0,l)+'…':s);}
  function autoGrow(el){el.style.height='auto';el.style.height=Math.min(el.scrollHeight,120)+'px';}
  function toggleSendBtn(){const v=document.getElementById('msg-input').value.trim();document.getElementById('send-btn').classList.toggle('idle',!v);document.getElementById('voice-btn').style.display=v?'none':'flex';}
  function scrollToBottom(){const el=document.getElementById('messages-list');el.scrollTop=el.scrollHeight;}
  function fmtDur(s){return`${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}`;}

  return{
    init,openChat,closeChat,startDirectChat,searchUsers,showNewGroup,searchGroupUsers,
    toggleGroupMember,createGroup,showChatInfo,showSettings,showEditProfile,saveProfileEdit,
    toggleThemeSetting,showEditField,saveFieldEdit,showContacts,openMenu,closeMenu,
    openModal,closeModal,logout,clearChatHistory,deleteChat,cancelReply,addReaction,
    showStarred,jumpToMessage,searchInChat,closeChatSearch,forwardTo,blockUser,
    toggleDisappearing,setDisappearing,editGroupName,
    showLogin,showRegister,showForgotPassword,requestPasswordReset,submitPasswordReset,
  };
})();

function playVoice(btn,url){if(btn._a){btn._a.pause();btn._a=null;btn.textContent='▶';return;}const a=new Audio(url);btn._a=a;btn.textContent='⏸';const bars=btn.nextElementSibling?.querySelectorAll('.voice-bar');a.addEventListener('timeupdate',()=>{if(bars){const p=a.currentTime/a.duration;bars.forEach((b,i)=>b.classList.toggle('played',i/bars.length<p));}});a.addEventListener('ended',()=>{btn.textContent='▶';btn._a=null;bars&&bars.forEach(b=>b.classList.remove('played'));});a.play().catch(()=>{btn.textContent='▶';btn._a=null;});}

document.addEventListener('DOMContentLoaded',()=>App.init());
