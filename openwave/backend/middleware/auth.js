const jwt=require('jsonwebtoken');
const {q}=require('../db');
const SECRET=process.env.JWT_SECRET||'openwave-dev-secret';
const signToken=uid=>jwt.sign({sub:uid},SECRET,{expiresIn:'30d'});
const verifyToken=tok=>jwt.verify(tok,SECRET);
async function authMiddleware(req,res,next){
  const h=req.headers.authorization;
  if(!h||!h.startsWith('Bearer '))return res.status(401).json({error:'No token'});
  try{const p=verifyToken(h.slice(7));const u=await q.getUserById(p.sub);if(!u)return res.status(401).json({error:'User not found'});req.user=u;next();}
  catch{res.status(401).json({error:'Invalid token'});}
}
async function authWS(tok){try{const p=verifyToken(tok);return await q.getUserById(p.sub)||null;}catch{return null;}}
function adminMiddleware(req,res,next){
  const s=req.headers['x-admin-secret']||req.query.secret;
  if(!s||s!==process.env.ADMIN_SECRET)return res.status(403).json({error:'Admin access denied'});
  next();
}
module.exports={signToken,authMiddleware,authWS,adminMiddleware};
