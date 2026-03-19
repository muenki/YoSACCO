const jwt = require('jsonwebtoken');
const db = require('../database');

function authenticate(req, res, next) {
  const token = req.cookies?.token || req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.redirect('/login?error=session_expired');

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = db.users.find(u => u.id === decoded.id && u.active);
    if (!user) return res.redirect('/login?error=user_not_found');
    req.user = user;
    next();
  } catch {
    res.clearCookie('token');
    return res.redirect('/login?error=session_expired');
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).render('error', { message: 'Access denied', user: req.user });
    }
    next();
  };
}

function apiAuth(req, res, next) {
  const token = req.cookies?.token || req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = db.users.find(u => u.id === decoded.id && u.active);
    if (!user) return res.status(401).json({ error: 'User not found' });
    req.user = user;
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

module.exports = { authenticate, requireRole, apiAuth };
