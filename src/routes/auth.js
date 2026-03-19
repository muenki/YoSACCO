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

module.exports = router;
