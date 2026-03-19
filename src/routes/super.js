const router  = require('express').Router();
const bcrypt  = require('bcryptjs');
const { Group, User, Saving, Loan, AuditLog } = require('../models');
const { authenticate, requireRole } = require('../middleware/auth');

router.use(authenticate, requireRole('superadmin'));

async function groupStats(gid) {
  const memberCount  = await User.count({ where: { groupId: gid, role: 'member' } });
  const savings      = await Saving.findAll({ where: { groupId: gid }, attributes: ['amount'] });
  const totalSavings = savings.reduce((s, r) => s + r.amount, 0);
  const activeLoans  = await Loan.count({ where: { groupId: gid, status: 'active' } });
  const loans        = await Loan.findAll({ where: { groupId: gid, status: 'active' }, attributes: ['totalRepayable','amountRepaid'] });
  const loanPortfolio= loans.reduce((s,l) => s + (l.totalRepayable - l.amountRepaid), 0);
  const pendingLoans = await Loan.count({ where: { groupId: gid, status: 'pending' } });
  const admin        = await User.findOne({ where: { groupId: gid, role: 'admin' } });
  return { memberCount, totalSavings, activeLoans, loanPortfolio, pendingLoans, admin };
}

router.get('/dashboard', async (req, res) => {
  try {
    const groups = await Group.findAll({ order: [['createdAt','DESC']] });
    const groupsWithStats = await Promise.all(groups.map(async g => ({ ...g.toJSON(), stats: await groupStats(g.id), admin: (await groupStats(g.id)).admin })));
    const totalMembers = await User.count({ where: { role: 'member' } });
    const allSavings   = await Saving.findAll({ attributes: ['amount'] });
    const totalSavings = allSavings.reduce((s, r) => s + r.amount, 0);
    const activeL      = await Loan.findAll({ where: { status: 'active' }, attributes: ['totalRepayable','amountRepaid'] });
    const totalLoans   = activeL.reduce((s, l) => s + (l.totalRepayable - l.amountRepaid), 0);
    res.render('super/dashboard', { user: req.user, groups: groupsWithStats, totalMembers, totalSavings, totalLoans, activeGroups: groups.filter(g=>g.active).length });
  } catch (err) { console.error(err); res.render('error', { message: 'Dashboard error', user: req.user }); }
});

router.get('/groups', async (req, res) => {
  try {
    const groups = await Group.findAll({ order: [['createdAt','DESC']] });
    const groupsWithStats = await Promise.all(groups.map(async g => { const s = await groupStats(g.id); return { ...g.toJSON(), stats: s, admin: s.admin }; }));
    res.render('super/groups', { user: req.user, groups: groupsWithStats, query: req.query });
  } catch (err) { console.error(err); res.render('error', { message: 'Error', user: req.user }); }
});

router.post('/groups/create', async (req, res) => {
  try {
    const { name, adminName, adminEmail, adminPassword, accentColor } = req.body;
    if (!name || !adminName || !adminEmail || !adminPassword) return res.redirect('/super/groups?error=missing_fields');
    if (await User.findOne({ where: { email: adminEmail.toLowerCase() } })) return res.redirect('/super/groups?error=email_exists');
    const slug  = name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const group = await Group.create({ name, slug, accentColor: accentColor||'#0D7377', adminEmail: adminEmail.toLowerCase(), active: true });
    await User.create({ name: adminName, email: adminEmail.toLowerCase(), password: bcrypt.hashSync(adminPassword, 10), role: 'admin', groupId: group.id, active: true });
    await AuditLog.create({ userId: req.user.id, action: 'CREATE_GROUP', detail: `Created group: ${name}` });
    res.redirect('/super/groups?success=group_created');
  } catch (err) { console.error(err); res.redirect('/super/groups?error=create_failed'); }
});

router.post('/groups/:id/toggle', async (req, res) => {
  try {
    const group = await Group.findByPk(req.params.id);
    if (group) { group.active = !group.active; await group.save(); await AuditLog.create({ userId: req.user.id, action: 'TOGGLE_GROUP', detail: `${group.active?'Activated':'Suspended'} group: ${group.name}` }); }
    res.redirect('/super/groups');
  } catch (err) { console.error(err); res.redirect('/super/groups'); }
});

router.get('/audit', async (req, res) => {
  try {
    const entries = await AuditLog.findAll({ order: [['timestamp','DESC']], limit: 100 });
    const log = await Promise.all(entries.map(async e => ({ ...e.toJSON(), user: e.userId ? await User.findByPk(e.userId) : null, group: e.groupId ? await Group.findByPk(e.groupId) : null })));
    res.render('super/audit', { user: req.user, log });
  } catch (err) { console.error(err); res.render('error', { message: 'Audit error', user: req.user }); }
});

module.exports = router;
