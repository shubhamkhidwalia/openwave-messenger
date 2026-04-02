'use strict';
const WS = (() => {
  let ws=null,token=null,handlers={},reconnectDelay=1000,alive=false;
  let typingTimer=null;
  function connect(tok){token=tok;_connect();}
  function _connect(){
    if(!token)return;
    const proto=location.protocol==='https:'?'wss:':'ws:';
    ws=new WebSocket(`${proto}//${location.host}/ws?token=${token}`);
    ws.onopen=()=>{reconnectDelay=1000;alive=true;emit('connected',{});};
    ws.onmessage=e=>{try{const d=JSON.parse(e.data);emit(d.type,d);}catch{}};
    ws.onclose=()=>{alive=false;setTimeout(_connect,reconnectDelay=Math.min(reconnectDelay*2,30000));};
    ws.onerror=()=>ws.close();
  }
  function emit(type,data){(handlers[type]||[]).forEach(fn=>fn(data));}
  function on(type,fn){if(!handlers[type])handlers[type]=[];handlers[type].push(fn);}
  function send(data){if(ws&&ws.readyState===WebSocket.OPEN)ws.send(JSON.stringify(data));}
  function joinChat(id){send({type:'join_chat',chat_id:id});}
  function leaveChat(){send({type:'leave_chat'});}
  function onInputTyping(chatId){clearTimeout(typingTimer);send({type:'typing_start',chat_id:chatId});typingTimer=setTimeout(()=>send({type:'typing_stop',chat_id:chatId}),2500);}
  function disconnect(){if(ws)ws.close();ws=null;token=null;}
  return{connect,on,send,joinChat,leaveChat,onInputTyping,disconnect};
})();
