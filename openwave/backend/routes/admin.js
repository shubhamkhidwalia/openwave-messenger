const router=require('express').Router();
const {v4:uuidv4}=require('uuid');
const {q}=require('../db');
const {adminMiddleware}=require('../middleware/auth');
router.use(adminMiddleware);
router.post('/invite',async(req,res)=>{
  try{
    const{expires_days}=req.body;
    const code=uuidv4().replace(/-/g,'').slice(0,16);
    const exp=expires_days?Math.floor(Date.now()/1000)+(expires_days*86400):null;
    await q.createInvite(code,exp);
    const base=process.env.APP_URL||`http://localhost:${process.env.PORT||4000}`;
    res.json({code,link:`${base}/invite/${code}`,expires_at:exp?new Date(exp*1000).toISOString():'never'});
  }catch(err){res.status(500).json({error:err.message});}
});
router.get('/invites',async(req,res)=>{
  try{res.json({invites:await q.listInvites()});}catch(err){res.status(500).json({error:err.message});}
});
module.exports=router;
