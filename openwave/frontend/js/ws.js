'use strict';
const WS = (() => {
  let ws=null,token=null,handlers={},delay=1000;
  let typingTimer=null;
  function connect(tok){token=tok;_go();}
  function _go(){
    if(!token)return;
    const proto=location.protocol==='https:'?'wss:':'ws:';
    ws=new WebSocket(`${proto}//${location.host}/ws?token=${token}`);
    ws.onopen=()=>{delay=1000;_emit('connected',{});};
    ws.onmessage=e=>{try{const d=JSON.parse(e.data);_emit(d.type,d);}catch{}};
    ws.onclose=()=>{setTimeout(_go,delay=Math.min(delay*2,30000));};
    ws.onerror=()=>ws.close();
  }
  function _emit(t,d){(handlers[t]||[]).forEach(fn=>fn(d));}
  function on(t,fn){if(!handlers[t])handlers[t]=[];handlers[t].push(fn);}
  function send(d){if(ws&&ws.readyState===WebSocket.OPEN)ws.send(JSON.stringify(d));}
  function joinChat(id){send({type:'join_chat',chat_id:id});}
  function leaveChat(){send({type:'leave_chat'});}
  function onInputTyping(chatId){
    clearTimeout(typingTimer);
    send({type:'typing_start',chat_id:chatId});
    typingTimer=setTimeout(()=>send({type:'typing_stop',chat_id:chatId}),2500);
  }
  function disconnect(){if(ws)ws.close();ws=null;token=null;}
  return{connect,on,send,joinChat,leaveChat,onInputTyping,disconnect};
})();
