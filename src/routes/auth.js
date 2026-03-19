const router  = require('express').Router();
const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
const { User, AuditLog } = require('../models');

router.get('/login', (req, res) => {
  if (req.cookies?.token) {
    try {
      const d = jwt.verify(req.cookies.token, process.env.JWT_SECRET);
      if (d) {
        const dest = d.role === 'member' ? '/member/dashboard' : d.role === 'admin' ? '/admin/dashboard' : '/super/dashboard';
        return res.redirect(dest);
      }
    } catch {}
  }
  res.render('login', { error: req.query.error || null, success: req.query.success || null });
});

router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ where: { email: email?.toLowerCase(), active: true } });
    if (!user || !bcrypt.compareSync(password, user.password)) {
      return res.render('login', { error: 'Invalid email or password', success: null });
    }
    const token = jwt.sign({ id: user.id, role: user.role }, process.env.JWT_SECRET, { expiresIn: '7d' });
    res.cookie('token', token, { httpOnly: true, maxAge: 7 * 24 * 60 * 60 * 1000 });
    await AuditLog.create({ userId: user.id, action: 'LOGIN', detail: `${user.name} logged in`, groupId: user.groupId });
    const dest = user.role === 'member' ? '/member/dashboard' : user.role === 'admin' ? '/admin/dashboard' : '/super/dashboard';
    res.redirect(dest);
  } catch (err) {
    console.error('Login error:', err);
    res.render('login', { error: 'Something went wrong. Please try again.', success: null });
  }
});

router.get('/logout', (req, res) => { res.clearCookie('token'); res.redirect('/login?success=logged_out'); });
router.get('/', (req, res) => res.redirect('/login'));
module.exports = router;
