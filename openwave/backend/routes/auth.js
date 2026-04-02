const router=require('express').Router();
const bcrypt=require('bcryptjs');
const {v4:uuidv4}=require('uuid');
const {q}=require('../db');
const {signToken}=require('../middleware/auth');
router.post('/register',async(req,res)=>{
  try{
    const{username,display_name,phone,password,invite_code}=req.body;
    if(!username||!password||!display_name)return res.status(400).json({error:'username, display_name and password required'});
    if(username.length<3||username.length>32)return res.status(400).json({error:'Username must be 3–32 chars'});
    if(!/^[a-zA-Z0-9_]+$/.test(username))return res.status(400).json({error:'Username: letters, numbers, underscores only'});
    if(password.length<6)return res.status(400).json({error:'Password min 6 characters'});
    if(!invite_code)return res.status(403).json({error:'Invite code required'});
    const invite=await q.getInvite(invite_code);
    if(!invite)return res.status(403).json({error:'Invalid invite code'});
    if(invite.used_by)return res.status(403).json({error:'Invite already used'});
    if(invite.expires_at&&invite.expires_at<Math.floor(Date.now()/1000))return res.status(403).json({error:'Invite expired'});
    if(await q.getUserByUsername(username))return res.status(409).json({error:'Username taken'});
    if(phone&&await q.getUserByPhone(phone))return res.status(409).json({error:'Phone already registered'});
    const pw=await bcrypt.hash(password,12);
    const id=uuidv4();
    await q.createUser(id,username,phone||null,display_name,pw,'');
    await q.useInvite(invite_code,id);
    const token=signToken(id);
    const user=await q.getUserById(id);delete user.password_hash;
    res.status(201).json({token,user});
  }catch(err){console.error(err);res.status(500).json({error:'Registration failed'});}
});
router.post('/login',async(req,res)=>{
  try{
    const{username,password}=req.body;
    if(!username||!password)return res.status(400).json({error:'Username and password required'});
    const user=await q.getUserByUsername(username);
    if(!user)return res.status(401).json({error:'Invalid credentials'});
    if(!await bcrypt.compare(password,user.password_hash))return res.status(401).json({error:'Invalid credentials'});
    const token=signToken(user.id);
    const safe={...user};delete safe.password_hash;
    res.json({token,user:safe});
  }catch(err){res.status(500).json({error:'Login failed'});}
});
router.get('/me',require('../middleware/auth').authMiddleware,async(req,res)=>{
  const u={...req.user};delete u.password_hash;res.json({user:u});
});
module.exports=router;
