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

// POST /api/auth/forgot-password — request a password reset
// Generates a time-limited token and sends it via email (if SMTP configured)
// or stores it for admin to retrieve
router.post('/forgot-password', async (req, res) => {
  try {
    const { username } = req.body;
    if (!username) return res.status(400).json({ error: 'Username required' });

    const user = await q.getUserByUsername(username);
    if (!user) {
      // Don't reveal if user exists — security best practice
      return res.json({ ok: true, message: 'If that username exists, a reset link has been sent.' });
    }

    const { v4: uuidv4 } = require('uuid');
    const token = uuidv4().replace(/-/g, '');
    const expiresAt = Math.floor(Date.now() / 1000) + 3600; // 1 hour

    // Store reset token (reuse invite_codes table with a prefix)
    const { q: dbq } = require('../db');
    await dbq.createInvite('reset_' + token, expiresAt);

    const base = process.env.APP_URL || `http://localhost:${process.env.PORT || 4000}`;
    const resetLink = `${base}/reset-password?token=${token}&user=${encodeURIComponent(user.id)}`;

    // Try to send email if SMTP configured
    let emailSent = false;
    if (process.env.SMTP_HOST && process.env.SMTP_USER && user.phone) {
      // Email sending placeholder — works if SMTP env vars set
      try {
        const nodemailer = require('nodemailer');
        const transporter = nodemailer.createTransport({
          host: process.env.SMTP_HOST,
          port: parseInt(process.env.SMTP_PORT) || 587,
          auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
        });
        await transporter.sendMail({
          from: process.env.SMTP_FROM || process.env.SMTP_USER,
          to: user.phone, // if phone is actually an email
          subject: 'Reset your OpenWave password',
          html: `<h2>Password Reset</h2><p>Click to reset: <a href="${resetLink}">${resetLink}</a></p><p>Expires in 1 hour.</p>`,
        });
        emailSent = true;
      } catch (e) {
        console.warn('Email send failed:', e.message);
      }
    }

    // Always return the token in dev / when no email
    const isDev = process.env.NODE_ENV !== 'production';
    console.log(`[RESET] Token for ${username}: ${token} (link: ${resetLink})`);

    res.json({
      ok: true,
      message: emailSent
        ? 'Reset link sent to your registered email.'
        : 'Contact the admin with your username to get a reset link.',
      // In development, expose the link directly for testing
      ...(isDev && { reset_link: resetLink, token }),
    });
  } catch (err) {
    console.error('Forgot password error:', err);
    res.status(500).json({ error: 'Reset request failed' });
  }
});

// POST /api/auth/reset-password — set new password using token
router.post('/reset-password', async (req, res) => {
  try {
    const { token, user_id, new_password } = req.body;
    if (!token || !user_id || !new_password)
      return res.status(400).json({ error: 'token, user_id and new_password required' });
    if (new_password.length < 6)
      return res.status(400).json({ error: 'Password must be at least 6 characters' });

    // Validate token
    const invite = await q.getInvite('reset_' + token);
    if (!invite) return res.status(400).json({ error: 'Invalid or expired reset token' });
    if (invite.used_by) return res.status(400).json({ error: 'Reset token already used' });
    if (invite.expires_at && invite.expires_at < Math.floor(Date.now() / 1000))
      return res.status(400).json({ error: 'Reset token expired' });

    const user = await q.getUserById(user_id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    // Update password
    const bcrypt = require('bcryptjs');
    const hash = await bcrypt.hash(new_password, 12);
    const { db } = require('../db');
    await db.execute({ sql: 'UPDATE users SET password_hash=? WHERE id=?', args: [hash, user_id] });

    // Mark token as used
    await q.useInvite('reset_' + token, user_id);

    const { signToken } = require('../middleware/auth');
    const tok = signToken(user_id);
    const safe = { ...user }; delete safe.password_hash;
    res.json({ ok: true, message: 'Password updated. You are now logged in.', token: tok, user: safe });
  } catch (err) {
    console.error('Reset password error:', err);
    res.status(500).json({ error: 'Password reset failed' });
  }
});
