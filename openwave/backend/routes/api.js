'use strict';
const router=require('express').Router();
const {v4:uuidv4}=require('uuid');
const {q,db}=require('../db');
const {authMiddleware}=require('../middleware/auth');
const {broadcast,sendToUser}=require('../ws');
router.use(authMiddleware);

router.get('/users/search',async(req,res)=>{
  const p=`%${req.query.q||''}%`;
  res.json({users:await q.searchUsers(p,p,req.user.id)});
});
router.get('/users/:id',async(req,res)=>{
  const u=await q.getUserById(req.params.id);if(!u)return res.status(404).json({error:'Not found'});
  const s={...u};delete s.password_hash;res.json({user:s});
});
router.patch('/users/me',async(req,res)=>{
  const{display_name,bio,avatar}=req.body;
  await q.updateProfile(display_name||req.user.display_name,bio!==undefined?bio:req.user.bio,avatar!==undefined?avatar:req.user.avatar,req.user.id);
  const u=await q.getUserById(req.user.id);delete u.password_hash;
  broadcast({type:'user_updated',user:u});res.json({user:u});
});

router.get('/contacts',async(req,res)=>{res.json({contacts:await q.getContacts(req.user.id)});});
router.post('/contacts',async(req,res)=>{
  const{user_id}=req.body;if(!user_id)return res.status(400).json({error:'user_id required'});
  await q.addContact(req.user.id,user_id);res.json({ok:true});
});
router.post('/contacts/:id/block',async(req,res)=>{
  await q.addContact(req.user.id,req.params.id).catch(()=>{});
  await q.blockContact(req.user.id,req.params.id);res.json({ok:true});
});

router.get('/chats',async(req,res)=>{
  const chats=await q.getUserChats(req.user.id);
  const enriched=await Promise.all(chats.map(async c=>{
    if(c.type==='direct'){const m=await q.getChatMembers(c.id);return{...c,peer:m.find(x=>x.id!==req.user.id)};}
    return{...c,members:await q.getChatMembers(c.id)};
  }));
  res.json({chats:enriched});
});
router.post('/chats/direct',async(req,res)=>{
  const{user_id}=req.body;
  if(!user_id||user_id===req.user.id)return res.status(400).json({error:'Invalid user_id'});
  const target=await q.getUserById(user_id);if(!target)return res.status(404).json({error:'User not found'});
  const ex=await q.getDirectChat(req.user.id,user_id);
  if(ex){const c=await q.getChatById(ex.id);const p=await q.getUserById(user_id);delete p.password_hash;return res.json({chat:{...c,peer:p,type:'direct'}});}
  const cid=uuidv4();
  await q.createChat(cid,'direct',null,'','',req.user.id);
  await q.addMember(cid,req.user.id,'member');await q.addMember(cid,user_id,'member');
  const c=await q.getChatById(cid);const p=await q.getUserById(user_id);delete p.password_hash;
  sendToUser(user_id,{type:'chat_created',chat:{...c,peer:{...req.user,password_hash:undefined}}});
  res.status(201).json({chat:{...c,peer:p,type:'direct'}});
});
router.post('/chats/group',async(req,res)=>{
  const{name,description,member_ids}=req.body;
  if(!name)return res.status(400).json({error:'name required'});
  const cid=uuidv4();
  await q.createChat(cid,'group',name,'',description||'',req.user.id);
  await q.addMember(cid,req.user.id,'owner');
  for(const uid of(member_ids||[]).filter(id=>id!==req.user.id)){const u=await q.getUserById(uid);if(u)await q.addMember(cid,uid,'member');}
  const c=await q.getChatById(cid);const members=await q.getChatMembers(cid);
  const sysId=uuidv4();await q.insertMessage(sysId,cid,req.user.id,'system',`${req.user.display_name} created the group`,null);
  await q.updateChatLastMsg(Date.now(),cid);
  for(const m of members){if(m.id!==req.user.id)sendToUser(m.id,{type:'chat_created',chat:{...c,members}});}
  res.status(201).json({chat:{...c,members}});
});
router.patch('/chats/:id',async(req,res)=>{
  try{
    const c=await q.getChatById(req.params.id);
    if(!c)return res.status(404).json({error:'Not found'});
    if(!await q.isMember(req.params.id,req.user.id))return res.status(403).json({error:'Not a member'});
    const{name,avatar,description}=req.body;
    await db.execute({sql:'UPDATE chats SET name=COALESCE(?,name),avatar=COALESCE(?,avatar),description=COALESCE(?,description)WHERE id=?',args:[name||null,avatar||null,description||null,req.params.id]});
    const updated=await q.getChatById(req.params.id);
    broadcast({type:'chat_updated',chat:updated},req.params.id);
    res.json({chat:updated});
  }catch(err){res.status(500).json({error:err.message});}
});
router.delete('/chats/:id',async(req,res)=>{
  try{
    if(!await q.isMember(req.params.id,req.user.id))return res.status(403).json({error:'Not a member'});
    await q.removeMember(req.params.id,req.user.id);res.json({ok:true});
  }catch(err){res.status(500).json({error:err.message});}
});
router.post('/chats/:id/leave',async(req,res)=>{
  try{
    if(!await q.isMember(req.params.id,req.user.id))return res.status(403).json({error:'Not a member'});
    await q.removeMember(req.params.id,req.user.id);
    const sysId=uuidv4();await q.insertMessage(sysId,req.params.id,req.user.id,'system',`${req.user.display_name} left the group`,null);
    broadcast({type:'member_left',chat_id:req.params.id,user_id:req.user.id},req.params.id);
    res.json({ok:true});
  }catch(err){res.status(500).json({error:err.message});}
});
router.get('/chats/:id/members',async(req,res)=>{
  if(!await q.isMember(req.params.id,req.user.id))return res.status(403).json({error:'Not a member'});
  res.json({members:await q.getChatMembers(req.params.id)});
});
router.post('/chats/:id/members',async(req,res)=>{
  const{user_id}=req.body;await q.addMember(req.params.id,user_id,'member');res.json({ok:true});
});

router.get('/chats/:id/messages',async(req,res)=>{
  if(!await q.isMember(req.params.id,req.user.id))return res.status(403).json({error:'Not a member'});
  const limit=Math.min(parseInt(req.query.limit)||50,100);
  const offset=parseInt(req.query.offset)||0;
  res.json({messages:(await q.getMessages(req.params.id,limit,offset)).reverse()});
});
router.post('/chats/:id/messages',async(req,res)=>{
  if(!await q.isMember(req.params.id,req.user.id))return res.status(403).json({error:'Not a member'});
  const{content,type='text',reply_to}=req.body;
  if(!content)return res.status(400).json({error:'content required'});
  const id=uuidv4();
  await q.insertMessage(id,req.params.id,req.user.id,type,content,reply_to||null);
  await q.updateChatLastMsg(Date.now(),req.params.id);
  const msg=await q.getMessage(id);const members=await q.getChatMembers(req.params.id);
  for(const m of members){if(m.id!==req.user.id)await q.upsertStatus(id,m.id,'delivered');}
  broadcast({type:'new_message',message:msg,chat_id:req.params.id},req.params.id,req.user.id);
  res.status(201).json({message:msg});
});
router.patch('/messages/:id',async(req,res)=>{
  const{content}=req.body;await q.editMessage(content,req.params.id,req.user.id);
  const msg=await q.getMessage(req.params.id);if(!msg)return res.status(404).json({error:'Not found'});
  broadcast({type:'message_edited',message:msg,chat_id:msg.chat_id});res.json({message:msg});
});
router.delete('/messages/:id',async(req,res)=>{
  const msg=await q.getMessage(req.params.id);if(!msg)return res.status(404).json({error:'Not found'});
  await q.deleteMessage(req.params.id,req.user.id);
  broadcast({type:'message_deleted',message_id:req.params.id,chat_id:msg.chat_id});res.json({ok:true});
});
router.post('/messages/:id/read',async(req,res)=>{
  const msg=await q.getMessage(req.params.id);if(!msg)return res.status(404).json({error:'Not found'});
  await q.upsertStatus(req.params.id,req.user.id,'read');
  sendToUser(msg.sender_id,{type:'message_read',message_id:req.params.id,reader_id:req.user.id,chat_id:msg.chat_id});
  res.json({ok:true});
});
module.exports=router;
