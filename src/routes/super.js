const router = require('express').Router();
const bcrypt = require('bcryptjs');
const db = require('../database');
const { authenticate, requireRole } = require('../middleware/auth');
const { emails } = require('../utils/email');

router.use(authenticate, requireRole('superadmin'));

router.get('/dashboard', (req, res) => {
  const groups = db.groups.map(g => ({
    ...g,
    stats: db.getMemberStats(g.id),
    admin: db.users.find(u => u.role === 'admin' && u.groupId === g.id),
  }));
  const totalMembers = db.users.filter(u => u.role === 'member').length;
  const totalSavings = db.users.filter(u => u.role === 'member').reduce((s, m) => s + db.getSavingsBalance(m.id), 0);
  const totalLoans = db.loans.filter(l => l.status === 'active').reduce((s, l) => s + (l.totalRepayable - l.amountRepaid), 0);
  res.render('super/dashboard', { user: req.user, groups, totalMembers, totalSavings, totalLoans, activeGroups: groups.filter(g => g.active).length });
});

router.get('/groups', (req, res) => {
  const groups = db.groups.map(g => ({ ...g, stats: db.getMemberStats(g.id), admin: db.users.find(u => u.role === 'admin' && u.groupId === g.id) }));
  res.render('super/groups', { user: req.user, groups });
});

router.post('/groups/create', (req, res) => {
  const { name, adminName, adminEmail, adminPassword, accentColor } = req.body;
  if (!name || !adminName || !adminEmail || !adminPassword) return res.redirect('/super/groups?error=missing_fields');

  const id = db.nextId('grp');
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-');

  db.groups.push({ id, name, slug, logo: null, accentColor: accentColor || '#0D7377', adminEmail, memberCount: 0, totalSavings: 0, active: true, createdAt: new Date() });

  const adminId = db.nextId('usr');
  db.users.push({ id: adminId, name: adminName, email: adminEmail, password: bcrypt.hashSync(adminPassword, 10), role: 'admin', groupId: id, active: true, createdAt: new Date() });

  db.log(req.user.id, 'CREATE_GROUP', `Created SACCO group: ${name}`);
  res.redirect('/super/groups?success=group_created');
});

router.post('/groups/:id/toggle', (req, res) => {
  const g = db.groups.find(g => g.id === req.params.id);
  if (g) { g.active = !g.active; db.log(req.user.id, 'TOGGLE_GROUP', `${g.active ? 'Activated' : 'Suspended'} group: ${g.name}`); }
  res.redirect('/super/groups');
});

router.get('/audit', (req, res) => {
  const log = db.auditLog.slice(0, 100).map(entry => ({
    ...entry,
    user: db.users.find(u => u.id === entry.userId),
    group: db.groups.find(g => g.id === entry.groupId),
  }));
  res.render('super/audit', { user: req.user, log });
});

module.exports = router;
