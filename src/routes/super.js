const upload = require("../middleware/upload");
const router  = require('express').Router();
const bcrypt  = require('bcryptjs');
const { Group, User, Saving, Loan, AuditLog, Invoice, GroupSettings } = require('../models');
const { authenticate, requireRole } = require('../middleware/auth');

router.use(authenticate, requireRole('superadmin'));

async function groupStats(gid) {
  const memberCount  = await User.count({ where: { groupId: gid, role: { [require('sequelize').Op.notIn]: ['superadmin'] } } });
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
    const totalMembers = await User.count({ where: { role: { [require('sequelize').Op.notIn]: ['superadmin'] } } });
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

router.post('/groups/create', upload.single("logo"), async (req, res) => {
  try {
    const { name, adminName, adminEmail, adminPassword, accentColor, accountNumber, bankName } = req.body;
    if (!name || !adminName || !adminEmail || !adminPassword) return res.redirect('/super/groups?error=missing_fields');
    if (await User.findOne({ where: { email: adminEmail.toLowerCase() } })) return res.redirect('/super/groups?error=email_exists');
    const slug  = name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const logoPath = req.file ? "/uploads/logos/" + req.file.filename : null;
    const group = await Group.create({ name, slug, accentColor: accentColor||'#0D7377', adminEmail: adminEmail.toLowerCase(), accountNumber: accountNumber||null, bankName: bankName||null, logo: logoPath, active: true });
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


// ── Quotations ────────────────────────────────────────────────────
router.get('/quotations', async (req, res) => {
  try {
    const groups = await Group.findAll({ order: [['createdAt','DESC']] });
    res.render('super/quotations', { user: req.user, groups: groups.map(g=>g.toJSON()), query: req.query });
  } catch(err) { console.error(err); res.render('error', { message: 'Error', user: req.user }); }
});

router.post('/quotations/generate', async (req, res) => {
  try {
    const {
      clientName, clientEmail, clientContact, saccoType,
      setupFee, dataEntryFee, dataEntryMembers,
      monthlyFee, annualFee,
      includeSetup, includeDataEntry, includeMonthly, includeAnnual,
      notes, validDays
    } = req.body;

    const quoteNumber = 'QT-' + new Date().getFullYear() + '-' + String(Date.now()).slice(-5);
    const today = new Date();
    const validUntil = new Date(today.getTime() + (parseInt(validDays)||30) * 24*60*60*1000);

    const items = [];
    if (includeSetup) {
      items.push({
        desc: 'One-off System Setup & Onboarding Fee',
        detail: 'Includes system configuration, admin training, and go-live support',
        qty: 1, unit: parseInt(setupFee)||500000,
        total: parseInt(setupFee)||500000,
        type: 'once-off'
      });
    }
    if (includeDataEntry) {
      const members = parseInt(dataEntryMembers)||50;
      const fee = parseInt(dataEntryFee)||300000;
      items.push({
        desc: 'Data Entry & Migration (up to ' + members + ' members)',
        detail: 'Digitisation of member records, savings history, and loan data',
        qty: 1, unit: fee, total: fee, type: 'once-off'
      });
    }
    if (includeMonthly) {
      const mFee = parseInt(monthlyFee)||50000;
      items.push({
        desc: 'Monthly Subscription — YoSACCO Platform',
        detail: 'Full platform access: savings, loans, reports, member portal, email notifications',
        qty: 1, unit: mFee, total: mFee, type: 'monthly'
      });
    }
    if (includeAnnual) {
      const aFee = parseInt(annualFee)||500000;
      items.push({
        desc: 'Annual Subscription — YoSACCO Platform (12 months)',
        detail: 'Full platform access billed annually. Saves ' + Math.round(100 - (aFee / (parseInt(monthlyFee||50000) * 12) * 100)) + '% vs monthly',
        qty: 12, unit: Math.round(aFee/12), total: aFee, type: 'annual'
      });
    }

    const subtotal = items.reduce((t,i)=>t+i.total, 0);
    const total    = subtotal;

    res.render('super/quotation-print', {
      user: req.user, quoteNumber, today, validUntil,
      clientName: clientName||'SACCO Group',
      clientEmail: clientEmail||'',
      clientContact: clientContact||'',
      saccoType: saccoType||'',
      items, subtotal, total,
      notes: notes||'',
    });
  } catch(err) {
    console.error('Quotation error:', err);
    res.render('error', { message: 'Error generating quotation', user: req.user });
  }
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


// ── Cancel Invoice ────────────────────────────────────────────────
router.post('/invoices/:id/cancel', async (req, res) => {
  try {
    const { Invoice } = require('../models');
    const inv = await Invoice.findByPk(req.params.id);
    if (!inv) return res.redirect('/super/invoices?error=not_found');
    if (inv.status === 'paid') return res.redirect('/super/invoices?error=cannot_cancel_paid');

    const group = await Group.findByPk(inv.groupId);
    const admin = await User.findOne({ where: { groupId: inv.groupId, role: 'admin' } });

    inv.status = 'cancelled';
    await inv.save();

    await AuditLog.create({
      userId: req.user.id,
      action: 'CANCEL_INVOICE',
      detail: 'Cancelled invoice ' + inv.invoiceNumber + ' for ' + (group ? group.name : inv.groupId),
    });

    // Send cancellation email to SACCO group admin
    if (admin && group) {
      const nodemailer = require('nodemailer');
      const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
      });
      const html = '<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;">'
        + '<img src="https://yosacco.coop/assets/logo.png" style="height:40px;margin-bottom:16px;" onerror="this.style.display=none">'
        + '<h2 style="color:#0A2342;">Invoice Cancelled</h2>'
        + '<p>Dear ' + admin.name + ',</p>'
        + '<p>Invoice <strong>' + inv.invoiceNumber + '</strong> for <strong>' + group.name + '</strong> has been <span style="color:#c53030;font-weight:700;">CANCELLED</span> by YoSACCO.</p>'
        + '<table style="width:100%;border-collapse:collapse;margin:16px 0;font-size:14px;">'
        + '<tr style="background:#f6f8fa;"><td style="padding:10px;font-weight:700;border:1px solid #eee;">Invoice #</td><td style="padding:10px;border:1px solid #eee;">' + inv.invoiceNumber + '</td></tr>'
        + '<tr><td style="padding:10px;font-weight:700;border:1px solid #eee;">Type</td><td style="padding:10px;border:1px solid #eee;">' + (inv.type === 'annual' ? 'Annual' : 'Monthly') + ' Subscription</td></tr>'
        + '<tr style="background:#f6f8fa;"><td style="padding:10px;font-weight:700;border:1px solid #eee;">Amount</td><td style="padding:10px;border:1px solid #eee;">UGX ' + inv.amount.toLocaleString() + '</td></tr>'
        + '<tr><td style="padding:10px;font-weight:700;border:1px solid #eee;">Status</td><td style="padding:10px;border:1px solid #eee;color:#c53030;font-weight:700;">CANCELLED</td></tr>'
        + '</table>'
        + '<p style="background:#fff5f5;border-left:4px solid #c53030;padding:12px 16px;font-size:13px;">This invoice has been cancelled. No payment is required. If you believe this is an error, please contact us immediately.</p>'
        + '<hr style="margin:24px 0;border:none;border-top:1px solid #eee;">'
        + '<p style="font-size:12px;color:#888;">YoSACCO &middot; info@yosacco.coop &middot; +256 756 683 141</p>'
        + '</div>';

      transporter.sendMail({
        from: '"YoSACCO Platform" <' + process.env.EMAIL_USER + '>',
        to: admin.email,
        subject: 'Invoice Cancelled: ' + inv.invoiceNumber + ' | YoSACCO',
        html,
      }).catch(() => {});
    }

    res.redirect('/super/invoices?success=cancelled');
  } catch(err) {
    console.error('Cancel invoice error:', err);
    res.redirect('/super/invoices?error=cancel_failed');
  }
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

router.post('/groups/:id/edit', upload.single("logo"), async (req, res) => {
  try {
    const group = await Group.findByPk(req.params.id);
    if (!group) return res.redirect('/super/groups?error=not_found');
    const { name, accentColor, accountNumber, bankName, newAdminName, newAdminEmail, newAdminPassword } = req.body;
    group.name = name || group.name;
    group.accentColor = accentColor || group.accentColor;
    group.accountNumber = accountNumber || group.accountNumber;
    group.bankName = bankName || group.bankName;
    if (req.file) group.logo = "/uploads/logos/" + req.file.filename;
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
