'use strict';
const multer=require('multer');
const path=require('path');
const fs=require('fs');
const ALLOWED=['image/jpeg','image/png','image/gif','image/webp','video/mp4','audio/mpeg','audio/ogg','audio/webm','application/pdf','application/zip','text/plain'];
async function uploadToCloudinary(fp,name,mime){
  const{v2:c}=require('cloudinary');
  c.config({cloud_name:process.env.CLOUDINARY_NAME,api_key:process.env.CLOUDINARY_KEY,api_secret:process.env.CLOUDINARY_SECRET});
  const r=await c.uploader.upload(fp,{folder:'openwave',resource_type:mime.startsWith('image/')?'image':'raw',public_id:path.parse(name).name+'_'+Date.now(),overwrite:false});
  fs.unlink(fp,()=>{});return r.secure_url;
}
function uploadMiddleware(app){
  const tmp=path.join(__dirname,'data','tmp');
  if(!fs.existsSync(tmp))fs.mkdirSync(tmp,{recursive:true});
  const up=multer({dest:tmp,limits:{fileSize:50*1024*1024},fileFilter:(req,f,cb)=>cb(null,ALLOWED.includes(f.mimetype))});
  const{authMiddleware}=require('./middleware/auth');
  app.post('/api/upload',authMiddleware,up.single('file'),async(req,res)=>{
    if(!req.file)return res.status(400).json({error:'No file or unsupported type'});
    try{
      let url;
      if(process.env.CLOUDINARY_NAME&&process.env.CLOUDINARY_KEY&&process.env.CLOUDINARY_SECRET){
        url=await uploadToCloudinary(req.file.path,req.file.originalname,req.file.mimetype);
      }else{
        const ud=path.join(__dirname,'data','uploads');if(!fs.existsSync(ud))fs.mkdirSync(ud,{recursive:true});
        fs.renameSync(req.file.path,path.join(ud,req.file.filename));url=`/media/${req.file.filename}`;
      }
      res.json({url,name:req.file.originalname,size:req.file.size,mime:req.file.mimetype});
    }catch(err){fs.unlink(req.file.path,()=>{});res.status(500).json({error:'Upload failed: '+err.message});}
  });
  app.use('/media',require('express').static(path.join(__dirname,'data','uploads')));
}
module.exports={uploadMiddleware};
