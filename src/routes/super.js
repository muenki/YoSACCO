const router  = require('express').Router();
const bcrypt  = require('bcryptjs');
const { Group, User, Saving, Loan, AuditLog, Invoice, GroupSettings } = require('../models');
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
    const { name, adminName, adminEmail, adminPassword, accentColor, accountNumber, bankName } = req.body;
    if (!name || !adminName || !adminEmail || !adminPassword) return res.redirect('/super/groups?error=missing_fields');
    if (await User.findOne({ where: { email: adminEmail.toLowerCase() } })) return res.redirect('/super/groups?error=email_exists');
    const slug  = name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const group = await Group.create({ name, slug, accentColor: accentColor||'#0D7377', adminEmail: adminEmail.toLowerCase(), accountNumber: accountNumber||null, bankName: bankName||null, active: true });
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

// ── Super Admin Invoices ──────────────────────────────────────────
router.get('/invoices', async (req, res) => {
  try {
    const { Invoice } = require('../models');
    const invoices = await Invoice.findAll({ order: [['createdAt','DESC']] });
    const enriched = await Promise.all(invoices.map(async i => ({ ...i.toJSON(), group: await Group.findByPk(i.groupId) })));
    const totalRevenue = invoices.filter(i=>i.status==='paid').reduce((s,i)=>s+i.paidAmount,0);
    const pendingRevenue = invoices.filter(i=>i.status==='pending').reduce((s,i)=>s+i.amount,0);
    res.render('super/invoices', { user: req.user, invoices: enriched, totalRevenue, pendingRevenue, query: req.query });
  } catch(err) { console.error(err); res.render('error', { message: 'Error', user: req.user }); }
});

router.post('/invoices/create', async (req, res) => {
  try {
    const { Invoice } = require('../models');
    const { groupId, type, amount, dueDate, periodStart, periodEnd, notes } = req.body;
    const count = await Invoice.count();
    const invoiceNumber = `INV-${new Date().getFullYear()}-${String(count+1).padStart(3,'0')}`;
    await Invoice.create({ groupId, invoiceNumber, type, amount: parseInt(amount), status: 'pending', dueDate: new Date(dueDate), periodStart: periodStart ? new Date(periodStart) : null, periodEnd: periodEnd ? new Date(periodEnd) : null, notes });
    // Email to group admin
    const group = await Group.findByPk(groupId);
    const admin = await User.findOne({ where: { groupId, role: 'admin' } });
    if (admin && group) {
      const { emails } = require('../utils/email');
      const inv = { invoiceNumber, type, amount: parseInt(amount), dueDate, periodStart, periodEnd };
      emails.invoiceToAdmin && emails.invoiceToAdmin(admin.toJSON(), group.toJSON(), inv).catch(()=>{});
    }
    await AuditLog.create({ userId: req.user.id, action: 'CREATE_INVOICE', detail: `Created invoice ${invoiceNumber} for group ${groupId}` });
    res.redirect('/super/invoices?success=created');
  } catch(err) { console.error(err); res.redirect('/super/invoices?error=create_failed'); }
});

router.post('/invoices/:id/mark-paid', async (req, res) => {
  try {
    const { Invoice } = require('../models');
    const inv = await Invoice.findByPk(req.params.id);
    if (inv) { inv.status = 'paid'; inv.paidAt = new Date(); inv.paidAmount = inv.amount; await inv.save(); }
    res.redirect('/super/invoices?success=marked_paid');
  } catch(err) { console.error(err); res.redirect('/super/invoices'); }
});

// ── Edit Group ────────────────────────────────────────────────────
router.get('/groups/:id/edit', async (req, res) => {
  try {
    const group = await Group.findByPk(req.params.id);
    if (!group) return res.redirect('/super/groups?error=not_found');
    const admin = await User.findOne({ where: { groupId: group.id, role: 'admin' } });
    res.render('super/edit-group', { user: req.user, group: group.toJSON(), admin: admin?.toJSON()||null });
  } catch(err) { console.error(err); res.redirect('/super/groups'); }
});

router.post('/groups/:id/edit', async (req, res) => {
  try {
    const group = await Group.findByPk(req.params.id);
    if (!group) return res.redirect('/super/groups?error=not_found');
    const { name, accentColor, accountNumber, bankName, newAdminName, newAdminEmail, newAdminPassword } = req.body;
    group.name = name || group.name;
    group.accentColor = accentColor || group.accentColor;
    group.accountNumber = accountNumber || group.accountNumber;
    group.bankName = bankName || group.bankName;
    await group.save();
    // Change admin if new credentials provided
    if (newAdminEmail && newAdminEmail.trim()) {
      const existing = await User.findOne({ where: { email: newAdminEmail.toLowerCase() } });
      if (existing) {
        existing.groupId = group.id; existing.role = 'admin';
        if (newAdminPassword) existing.password = require('bcryptjs').hashSync(newAdminPassword, 10);
        await existing.save();
      } else if (newAdminName && newAdminPassword) {
        await User.create({ name: newAdminName, email: newAdminEmail.toLowerCase(), password: require('bcryptjs').hashSync(newAdminPassword, 10), role: 'admin', groupId: group.id, active: true });
      }
    }
    await AuditLog.create({ userId: req.user.id, action: 'EDIT_GROUP', detail: `Edited group: ${group.name}` });
    res.redirect('/super/groups?success=group_updated');
  } catch(err) { console.error(err); res.redirect('/super/groups?error=edit_failed'); }
});
