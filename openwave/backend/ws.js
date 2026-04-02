'use strict';
const WebSocket=require('ws');
const {authWS}=require('./middleware/auth');
const {q}=require('./db');
const userSockets=new Map();
function setup(server){
  const wss=new WebSocket.Server({server,path:'/ws'});
  wss.on('connection',async(ws,req)=>{
    const url=new URL(req.url,'ws://x');
    const user=await authWS(url.searchParams.get('token'));
    if(!user){ws.close(4001,'Unauthorized');return;}
    ws._userId=user.id;ws._alive=true;
    if(!userSockets.has(user.id))userSockets.set(user.id,new Set());
    userSockets.get(user.id).add(ws);
    q.updateLastSeen(-1,user.id).catch(()=>{});
    broadcastPresence(user.id,'online');
    send(ws,{type:'connected',user_id:user.id});
    ws.on('message',raw=>{try{handle(ws,user,JSON.parse(raw));}catch{}});
    ws.on('pong',()=>{ws._alive=true;});
    ws.on('close',async()=>{
      const s=userSockets.get(user.id);if(s){s.delete(ws);if(s.size===0){userSockets.delete(user.id);await q.updateLastSeen(Math.floor(Date.now()/1000),user.id).catch(()=>{});broadcastPresence(user.id,'offline');}}
    });
  });
  const hb=setInterval(()=>{wss.clients.forEach(ws=>{if(!ws._alive){ws.terminate();return;}ws._alive=false;ws.ping();});},30000);
  wss.on('close',()=>clearInterval(hb));
}
async function handle(ws,user,msg){
  switch(msg.type){
    case 'typing_start':case 'typing_stop':
      if(!msg.chat_id)break;
      if(!await q.isMember(msg.chat_id,user.id).catch(()=>null))break;
      broadcastToChat(msg.chat_id,{type:msg.type,chat_id:msg.chat_id,user_id:user.id,display_name:user.display_name},user.id);
      break;
    case 'join_chat':ws._activeChat=msg.chat_id;break;
    case 'leave_chat':ws._activeChat=null;break;
    case 'ping':send(ws,{type:'pong',ts:Date.now()});break;
  }
}
const send=(ws,data)=>{if(ws.readyState===WebSocket.OPEN)ws.send(JSON.stringify(data));};
function sendToUser(uid,data){const s=userSockets.get(uid);if(!s)return;const p=JSON.stringify(data);for(const ws of s)if(ws.readyState===WebSocket.OPEN)ws.send(p);}
async function broadcastToChat(cid,data,ex=null){
  const members=await q.getChatMembers(cid).catch(()=>[]);const p=JSON.stringify(data);
  for(const m of members){if(m.id===ex)continue;const s=userSockets.get(m.id);if(!s)continue;for(const ws of s)if(ws.readyState===WebSocket.OPEN)ws.send(p);}
}
function broadcast(data,cid=null,ex=null){if(cid){broadcastToChat(cid,data,ex);return;}const p=JSON.stringify(data);userSockets.forEach((s,uid)=>{if(uid===ex)return;for(const ws of s)if(ws.readyState===WebSocket.OPEN)ws.send(p);});}
async function broadcastPresence(uid,status){const u=await q.getUserById(uid).catch(()=>null);if(!u)return;broadcast({type:'presence',user_id:uid,status,last_seen:u.last_seen});}
function onInputTyping(ws,user,chat_id){broadcastToChat(chat_id,{type:'typing_start',chat_id,user_id:user.id,display_name:user.display_name},user.id);}
function getOnlineUsers(){return[...userSockets.keys()];}
module.exports={setup,broadcast,sendToUser,broadcastToChat,getOnlineUsers};
