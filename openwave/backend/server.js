'use strict';
try{require('dotenv').config();}catch{}
const express=require('express');
const http=require('http');
const cors=require('cors');
const path=require('path');
const fs=require('fs');
const app=express();
const server=http.createServer(app);
const ws=require('./ws');ws.setup(server);
app.use(cors({origin:process.env.CLIENT_ORIGIN||'*',methods:['GET','POST','PATCH','DELETE','OPTIONS'],allowedHeaders:['Content-Type','Authorization','x-admin-secret']}));
app.use(express.json({limit:'10mb'}));
app.use(express.urlencoded({extended:true,limit:'10mb'}));
require('./upload').uploadMiddleware(app);
app.use('/api/auth',require('./routes/auth'));
app.use('/api/admin',require('./routes/admin'));
app.use('/api',require('./routes/api'));
const{q,initSchema}=require('./db');
app.get('/api/config',(req,res)=>res.json({bot_username:process.env.TELEGRAM_BOT_USERNAME||null,app_name:'OpenWave'}));
app.get('/api/invite/:code',async(req,res)=>{
  const inv=await q.getInvite(req.params.code).catch(()=>null);
  if(!inv)return res.status(404).json({valid:false,error:'Invalid invite'});
  if(inv.used_by)return res.status(410).json({valid:false,error:'Already used'});
  if(inv.expires_at&&inv.expires_at<Math.floor(Date.now()/1000))return res.status(410).json({valid:false,error:'Expired'});
  res.json({valid:true});
});
app.get('/health',(req,res)=>res.json({status:'ok',ts:Date.now(),online:ws.getOnlineUsers().length,storage:process.env.CLOUDINARY_NAME?'cloudinary':'local',database:process.env.TURSO_URL?'turso':'local'}));
const FRONTEND=path.join(__dirname,'frontend');
if(fs.existsSync(FRONTEND)){app.use(express.static(FRONTEND));app.get('*',(req,res)=>res.sendFile(path.join(FRONTEND,'index.html')));}
const PORT=process.env.PORT||4000;
async function start(){try{await initSchema();console.log('DB ready');server.listen(PORT,()=>console.log(`OpenWave running on :${PORT}`));}catch(err){console.error('Start failed:',err.message);process.exit(1);}}
start();module.exports={app,server};
