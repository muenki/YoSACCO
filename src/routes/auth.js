const router  = require('express').Router();
const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
const { User, AuditLog } = require('../models');

const getDest = (role) => {
  if (role === 'member')   return '/member/dashboard';
  if (role === 'admin')    return '/admin/dashboard';
  if (['credit_officer','treasurer','chairperson'].includes(role)) return '/approver/dashboard';
  return '/super/dashboard';
};

router.get('/login', (req, res) => {
  // Only redirect if token is valid — avoid redirect loop by NOT redirecting on error params
  if (req.cookies?.token && !req.query.error && !req.query.success) {
    try {
      const d = jwt.verify(req.cookies.token, process.env.JWT_SECRET);
      if (d && d.role) return res.redirect(getDest(d.role));
    } catch {
      res.clearCookie('token');
    }
  }
  res.render('login', { error: req.query.error || null, success: req.query.success || null });
});

router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.render('login', { error: 'Please enter your email and password.', success: null });

    const user = await User.findOne({ where: { email: email.trim().toLowerCase(), active: true } });
    if (!user || !bcrypt.compareSync(password, user.password)) {
      return res.render('login', { error: 'Invalid email or password.', success: null });
    }

    const token = jwt.sign({ id: user.id, role: user.role }, process.env.JWT_SECRET, { expiresIn: '7d' });
    res.cookie('token', token, { httpOnly: true, maxAge: 7 * 24 * 60 * 60 * 1000, sameSite: 'lax' });

    AuditLog.create({ userId: user.id, action: 'LOGIN', detail: `${user.name} logged in`, groupId: user.groupId || null }).catch(() => {});

    // If first login, redirect to change password
    if (user.mustChangePassword) {
      return res.redirect('/change-password');
    }
    return res.redirect(getDest(user.role));
  } catch (err) {
    console.error('Login error:', err);
    return res.render('login', { error: 'Something went wrong. Please try again.', success: null });
  }
});

router.get('/logout', (req, res) => {
  res.clearCookie('token');
  res.redirect('/login?success=logged_out');
});

router.get('/', (req, res) => res.redirect('/login'));
// ── Forgot Password ───────────────────────────────────────────────
router.get('/forgot-password', (req, res) => {
  res.render('auth/forgot-password', { error: null, success: null });
});

router.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;
    const { User } = require('../models');
    const { sendEmail } = require('../utils/email');
    const crypto = require('crypto');

    const user = await User.findOne({ where: { email: email.toLowerCase() } });
    // Always show success to prevent email enumeration
    if (!user) return res.render('auth/forgot-password', { error: null, success: 'If that email exists, a reset link has been sent.' });

    const token = crypto.randomBytes(32).toString('hex');
    const expiry = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
    await user.update({ resetToken: token, resetTokenExpiry: expiry });

    const appUrl = process.env.APP_URL || 'http://localhost:3000';
    const resetUrl = `${appUrl}/reset-password?token=${token}`;

    await sendEmail({
      to: user.email,
      subject: 'Password Reset Request — YoSACCO',
      html: `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
        body{font-family:Arial,sans-serif;background:#f5f7fa;margin:0;padding:20px;}
        .container{max-width:580px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e0e0e0;}
        .header{background:#0A2342;padding:28px 32px;color:#fff;}.header h1{margin:0;font-size:22px;}
        .body{padding:28px 32px;}.body p{font-size:15px;line-height:1.7;color:#333;margin:0 0 14px;}
        .btn{display:inline-block;background:#D35050;color:#fff;padding:14px 28px;border-radius:8px;text-decoration:none;font-size:15px;font-weight:600;margin-top:8px;}
        .note{font-size:13px;color:#888;margin-top:16px;}
        .footer{background:#f0f0f0;padding:16px 32px;font-size:12px;color:#999;text-align:center;}
      </style></head><body><div class="container">
        <div class="header"><h1>YoSACCO</h1><p>Online SACCO Management Platform</p></div>
        <div class="body">
          <p>Dear <strong>${user.name}</strong>,</p>
          <p>We received a request to reset your YoSACCO password. Click the button below to set a new password:</p>
          <a class="btn" href="${resetUrl}">Reset My Password</a>
          <p class="note">This link expires in <strong>1 hour</strong>. If you did not request a password reset, you can safely ignore this email.</p>
          <p class="note">Or copy this link: ${resetUrl}</p>
        </div>
        <div class="footer">YoSACCO · This is an automated message, please do not reply.</div>
      </div></body></html>`,
    });

    res.render('auth/forgot-password', { error: null, success: 'A password reset link has been sent to your email address.' });
  } catch(err) {
    console.error('Forgot password error:', err);
    res.render('auth/forgot-password', { error: 'Something went wrong. Please try again.', success: null });
  }
});

// ── Reset Password ────────────────────────────────────────────────
router.get('/reset-password', async (req, res) => {
  try {
    const { token } = req.query;
    const { User } = require('../models');
    const user = await User.findOne({ where: { resetToken: token } });
    if (!user || !user.resetTokenExpiry || new Date() > new Date(user.resetTokenExpiry)) {
      return res.render('auth/reset-password', { error: 'This reset link has expired or is invalid. Please request a new one.', token: null });
    }
    res.render('auth/reset-password', { error: null, token });
  } catch(err) {
    res.render('auth/reset-password', { error: 'Something went wrong.', token: null });
  }
});

router.post('/reset-password', async (req, res) => {
  try {
    const { token, password, confirmPassword } = req.body;
    const { User } = require('../models');
    const bcrypt = require('bcryptjs');

    if (!password || password.length < 6) return res.render('auth/reset-password', { error: 'Password must be at least 6 characters.', token });
    if (password !== confirmPassword) return res.render('auth/reset-password', { error: 'Passwords do not match.', token });

    const user = await User.findOne({ where: { resetToken: token } });
    if (!user || !user.resetTokenExpiry || new Date() > new Date(user.resetTokenExpiry)) {
      return res.render('auth/reset-password', { error: 'This reset link has expired. Please request a new one.', token: null });
    }

    await user.update({
      password: bcrypt.hashSync(password, 10),
      resetToken: null,
      resetTokenExpiry: null,
      mustChangePassword: false,
    });

    res.redirect('/login?success=password_reset');
  } catch(err) {
    console.error('Reset password error:', err);
    res.render('auth/reset-password', { error: 'Something went wrong. Please try again.', token: req.body.token });
  }
});




// ── Change password on first login ───────────────────────────────
router.get('/change-password', (req, res) => {
  const token = req.cookies.token;
  if (!token) return res.redirect('/login');
  try {
    const jwt = require('jsonwebtoken');
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    res.render('change-password', { error: null, userId: decoded.id });
  } catch { res.redirect('/login'); }
});

router.post('/change-password', async (req, res) => {
  try {
    const jwt = require('jsonwebtoken');
    const bcrypt = require('bcryptjs');
    const { User } = require('../models');
    const token = req.cookies.token;
    if (!token) return res.redirect('/login');
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const { newPassword, confirmPassword } = req.body;
    if (!newPassword || newPassword.length < 8) {
      return res.render('change-password', { error: 'Password must be at least 8 characters.', userId: decoded.id });
    }
    if (newPassword !== confirmPassword) {
      return res.render('change-password', { error: 'Passwords do not match.', userId: decoded.id });
    }
    const user = await User.findByPk(decoded.id);
    user.password = bcrypt.hashSync(newPassword, 10);
    user.mustChangePassword = false;
    await user.save();
    const dest = getDest(user.role);
    res.redirect(dest + '?success=password_changed');
  } catch(err) { console.error(err); res.redirect('/login'); }
});
module.exports = router;
