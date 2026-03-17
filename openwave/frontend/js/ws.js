/**
 * OpenWave WebSocket Client
 * Handles connection, reconnection, and event dispatching
 */
const WS = (() => {
  let socket = null;
  let userId = null;
  let reconnectTimer = null;
  let reconnectDelay = 1000;
  const MAX_DELAY = 30000;
  const handlers = {};

  function on(type, fn) {
    if (!handlers[type]) handlers[type] = [];
    handlers[type].push(fn);
  }

  function off(type, fn) {
    if (!handlers[type]) return;
    handlers[type] = handlers[type].filter(h => h !== fn);
  }

  function emit(type, data) {
    (handlers[type] || []).forEach(fn => fn(data));
    (handlers['*'] || []).forEach(fn => fn({ type, ...data }));
  }

  function send(data) {
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(data));
    }
  }

  function connect(token) {
    if (socket) socket.close();

    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${proto}//${location.host}/ws?token=${encodeURIComponent(token)}`;

    socket = new WebSocket(url);

    socket.onopen = () => {
      console.log('[WS] Connected');
      reconnectDelay = 1000;
      clearTimeout(reconnectTimer);
      emit('connected', {});
    };

    socket.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        emit(msg.type, msg);
      } catch {}
    };

    socket.onclose = (e) => {
      if (e.code === 4001) return; // Unauthorized — don't retry
      console.log('[WS] Disconnected — retrying in', reconnectDelay, 'ms');
      emit('disconnected', {});
      reconnectTimer = setTimeout(() => {
        reconnectDelay = Math.min(reconnectDelay * 1.5, MAX_DELAY);
        const t = localStorage.getItem('ow_token');
        if (t) connect(t);
      }, reconnectDelay);
    };

    socket.onerror = () => emit('error', {});
  }

  function disconnect() {
    clearTimeout(reconnectTimer);
    if (socket) { socket.close(); socket = null; }
  }

  // Typing helpers
  let typingTimer = null;
  function sendTypingStart(chat_id) {
    send({ type: 'typing_start', chat_id });
  }
  function sendTypingStop(chat_id) {
    send({ type: 'typing_stop', chat_id });
  }
  function onInputTyping(chat_id) {
    sendTypingStart(chat_id);
    clearTimeout(typingTimer);
    typingTimer = setTimeout(() => sendTypingStop(chat_id), 2500);
  }

  function joinChat(chat_id) { send({ type: 'join_chat', chat_id }); }
  function leaveChat() { send({ type: 'leave_chat' }); }

  return { connect, disconnect, on, off, send, onInputTyping, joinChat, leaveChat };
})();
