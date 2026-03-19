const router = require('express').Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../database');

router.get('/login', (req, res) => {
  if (req.cookies?.token) {
    try {
      const d = jwt.verify(req.cookies.token, process.env.JWT_SECRET);
      const u = db.users.find(u => u.id === d.id && u.active);
      if (u) return res.redirect(u.role === 'member' ? '/member/dashboard' : u.role === 'admin' ? '/admin/dashboard' : '/super/dashboard');
    } catch {}
  }
  res.render('login', { error: req.query.error, success: req.query.success });
});

router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  const user = db.users.find(u => u.email === email?.toLowerCase() && u.active);

  if (!user || !bcrypt.compareSync(password, user.password)) {
    return res.render('login', { error: 'Invalid email or password' });
  }

  const token = jwt.sign({ id: user.id, role: user.role }, process.env.JWT_SECRET, { expiresIn: '7d' });
  res.cookie('token', token, { httpOnly: true, maxAge: 7 * 24 * 60 * 60 * 1000 });
  db.log(user.id, 'LOGIN', `User logged in`, user.groupId);

  const redirect = user.role === 'member' ? '/member/dashboard' : user.role === 'admin' ? '/admin/dashboard' : '/super/dashboard';
  res.redirect(redirect);
});

router.get('/logout', (req, res) => {
  res.clearCookie('token');
  res.redirect('/login?success=logged_out');
});

router.get('/', (req, res) => res.redirect('/login'));

module.exports = router;
