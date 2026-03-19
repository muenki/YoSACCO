const router  = require('express').Router();
const bcrypt  = require('bcryptjs');
const { Op }  = require('sequelize');
const { Group, User, Saving, Loan, Repayment, AuditLog } = require('../models');
const { authenticate, requireRole } = require('../middleware/auth');
const { emails } = require('../utils/email');

router.use(authenticate, requireRole('admin', 'superadmin'));

const getBalance = async (memberId) => {
  const rows = await Saving.findAll({ where: { memberId }, attributes: ['amount'] });
  return rows.reduce((s, r) => s + r.amount, 0);
};

router.get('/dashboard', async (req, res) => {
  try {
    const gid   = req.user.groupId;
    const group = await Group.findByPk(gid);
    const memberCount  = await User.count({ where: { groupId: gid, role: 'member' } });
    const savings      = await Saving.findAll({ where: { groupId: gid }, attributes: ['amount'] });
    const totalSavings = savings.reduce((s,r) => s + r.amount, 0);
    const activeLoans  = await Loan.count({ where: { groupId: gid, status: 'active' } });
    const loanRows     = await Loan.findAll({ where: { groupId: gid, status: 'active' }, attributes: ['totalRepayable','amountRepaid'] });
    const loanPortfolio= loanRows.reduce((s,l) => s + (l.totalRepayable - l.amountRepaid), 0);
    const pendingLoans = await Loan.findAll({ where: { groupId: gid, status: 'pending' }, include: [{ model: User, as: 'member' }], order: [['appliedAt','DESC']] });
    const recentSavings= await Saving.findAll({ where: { groupId: gid }, include: [{ model: User, as: 'member' }], order: [['date','DESC']], limit: 5 });
    res.render('admin/dashboard', { user: req.user, group, stats: { memberCount, totalSavings, activeLoans, loanPortfolio, pendingLoans: pendingLoans.length }, pendingLoans, recentSavings });
  } catch (err) { console.error(err); res.render('error', { message: 'Dashboard error', user: req.user }); }
});

// ── Members ───────────────────────────────────────────────────────
router.get('/members', async (req, res) => {
  try {
    const gid   = req.user.groupId;
    const group = await Group.findByPk(gid);
    const rawMembers = await User.findAll({ where: { groupId: gid, role: 'member' }, order: [['createdAt','ASC']] });
    const members = await Promise.all(rawMembers.map(async m => {
      const balance    = await getBalance(m.id);
      const activeLoan = await Loan.findOne({ where: { memberId: m.id, status: 'active' } });
      return { ...m.toJSON(), savings: balance, activeLoan };
    }));
    res.render('admin/members', { user: req.user, group, members, query: req.query });
  } catch (err) { console.error(err); res.render('error', { message: 'Error', user: req.user }); }
});

router.post('/members/add', async (req, res) => {
  try {
    const { name, email, phone, nationalId, monthlyContribution, shareCapitalTarget } = req.body;
    const gid   = req.user.groupId;
    const group = await Group.findByPk(gid);
    if (await User.findOne({ where: { email: email.toLowerCase() } })) return res.redirect('/admin/members?error=email_exists');

    const count    = await User.count({ where: { groupId: gid } });
    const prefix   = group.name.replace(/[^A-Za-z]/g,'').slice(0,3).toUpperCase();
    const memberId = `${prefix}-${String(count+1).padStart(4,'0')}`;
    const tempPass = `Yosacco@${Math.floor(1000+Math.random()*9000)}`;

    const newMember = await User.create({
      name, email: email.toLowerCase(), phone, nationalId,
      password: bcrypt.hashSync(tempPass, 10),
      role: 'member', groupId: gid, memberId,
      joinDate: new Date(),
      monthlyContribution: parseInt(monthlyContribution)||10000,
      shareCapitalTarget:  parseInt(shareCapitalTarget)||1000000,
      shareCapitalPaid: 0, active: true,
    });

    await AuditLog.create({ userId: req.user.id, action: 'ADD_MEMBER', detail: `Added member: ${name} (${memberId})`, groupId: gid });
    emails.welcomeMember(newMember.toJSON(), group.toJSON(), tempPass).catch(()=>{});
    res.redirect('/admin/members?success=member_added');
  } catch (err) { console.error(err); res.redirect('/admin/members?error=add_failed'); }
});

router.get('/members/:id', async (req, res) => {
  try {
    const gid    = req.user.groupId;
    const group  = await Group.findByPk(gid);
    const member = await User.findOne({ where: { id: req.params.id, groupId: gid, role: 'member' } });
    if (!member) return res.redirect('/admin/members?error=not_found');
    const savings = await Saving.findAll({ where: { memberId: member.id }, order: [['date','DESC']] });
    const balance = savings.reduce((s,r) => s + r.amount, 0);
    const loans   = await Loan.findAll({ where: { memberId: member.id }, order: [['appliedAt','DESC']] });
    res.render('admin/member-detail', { user: req.user, group, member: member.toJSON(), savings, balance, loans });
  } catch (err) { console.error(err); res.redirect('/admin/members'); }
});

router.post('/members/:id/toggle', async (req, res) => {
  try {
    const gid = req.user.groupId;
    const m   = await User.findOne({ where: { id: req.params.id, groupId: gid } });
    if (m) { m.active = !m.active; await m.save(); await AuditLog.create({ userId: req.user.id, action: 'TOGGLE_MEMBER', detail: `${m.active?'Activated':'Deactivated'} ${m.name}`, groupId: gid }); }
    res.redirect('/admin/members');
  } catch (err) { console.error(err); res.redirect('/admin/members'); }
});

// ── Savings ───────────────────────────────────────────────────────
router.get('/savings', async (req, res) => {
  try {
    const gid   = req.user.groupId;
    const group = await Group.findByPk(gid);
    const rawMembers = await User.findAll({ where: { groupId: gid, role: 'member' }, order: [['createdAt','ASC']] });
    const members = await Promise.all(rawMembers.map(async m => {
      const balance   = await getBalance(m.id);
      const lastRow   = await Saving.findOne({ where: { memberId: m.id, type: 'contribution' }, order: [['date','DESC']] });
      return { ...m.toJSON(), balance, lastContrib: lastRow };
    }));
    res.render('admin/savings', { user: req.user, group, members, query: req.query });
  } catch (err) { console.error(err); res.render('error', { message: 'Error', user: req.user }); }
});

router.post('/savings/post', async (req, res) => {
  try {
    const { memberId, amount, type, description } = req.body;
    const gid    = req.user.groupId;
    const member = await User.findOne({ where: { id: memberId, groupId: gid } });
    const group  = await Group.findByPk(gid);
    if (!member) return res.redirect('/admin/savings?error=member_not_found');

    const tx = await Saving.create({ memberId, groupId: gid, amount: parseInt(amount), type: type||'contribution', description: description||'Monthly contribution', date: new Date(), postedBy: req.user.id });
    await AuditLog.create({ userId: req.user.id, action: 'POST_SAVINGS', detail: `Posted UGX ${amount} for ${member.name}`, groupId: gid });
    const balance = await getBalance(memberId);
    emails.savingsReceiptToMember(member.toJSON(), tx.toJSON(), balance, group.toJSON()).catch(()=>{});
    res.redirect('/admin/savings?success=savings_posted');
  } catch (err) { console.error(err); res.redirect('/admin/savings?error=post_failed'); }
});

// ── Loans ─────────────────────────────────────────────────────────
router.get('/loans', async (req, res) => {
  try {
    const gid   = req.user.groupId;
    const group = await Group.findByPk(gid);
    const rawLoans = await Loan.findAll({ where: { groupId: gid }, order: [['appliedAt','DESC']] });
    const loans = await Promise.all(rawLoans.map(async l => {
      const member = await User.findByPk(l.memberId);
      const savingsBalance = await getBalance(l.memberId);
      return { ...l.toJSON(), member: member?.toJSON(), savingsBalance };
    }));
    res.render('admin/loans', { user: req.user, group, loans, query: req.query });
  } catch (err) { console.error(err); res.render('error', { message: 'Error', user: req.user }); }
});

router.post('/loans/:id/approve', async (req, res) => {
  try {
    const gid  = req.user.groupId;
    const loan = await Loan.findOne({ where: { id: req.params.id, groupId: gid, status: 'pending' } });
    if (!loan) return res.redirect('/admin/loans?error=not_found');
    const group  = await Group.findByPk(gid);
    const member = await User.findByPk(loan.memberId);
    const rate   = 0.015;
    loan.status           = 'active';
    loan.approvedAt       = new Date();
    loan.approvedBy       = req.user.id;
    loan.disbursedAt      = new Date();
    loan.notes            = req.body.notes || '';
    loan.monthlyInstallment = Math.round(loan.amount * (1 + rate * loan.repaymentMonths) / loan.repaymentMonths);
    loan.totalRepayable   = loan.monthlyInstallment * loan.repaymentMonths;
    await loan.save();
    await AuditLog.create({ userId: req.user.id, action: 'APPROVE_LOAN', detail: `Approved loan for ${member.name} — UGX ${loan.amount.toLocaleString()}`, groupId: gid });
    emails.loanApprovedToMember(member.toJSON(), loan.toJSON(), group.toJSON()).catch(()=>{});
    res.redirect('/admin/loans?success=loan_approved');
  } catch (err) { console.error(err); res.redirect('/admin/loans?error=approve_failed'); }
});

router.post('/loans/:id/decline', async (req, res) => {
  try {
    const gid  = req.user.groupId;
    const loan = await Loan.findOne({ where: { id: req.params.id, groupId: gid, status: 'pending' } });
    if (!loan) return res.redirect('/admin/loans?error=not_found');
    const group  = await Group.findByPk(gid);
    const member = await User.findByPk(loan.memberId);
    loan.status = 'declined';
    loan.notes  = req.body.notes || 'Application declined';
    await loan.save();
    await AuditLog.create({ userId: req.user.id, action: 'DECLINE_LOAN', detail: `Declined loan for ${member.name}`, groupId: gid });
    emails.loanDeclinedToMember(member.toJSON(), loan.toJSON(), group.toJSON()).catch(()=>{});
    res.redirect('/admin/loans?success=loan_declined');
  } catch (err) { console.error(err); res.redirect('/admin/loans?error=decline_failed'); }
});

router.post('/loans/:id/repayment', async (req, res) => {
  try {
    const gid  = req.user.groupId;
    const loan = await Loan.findOne({ where: { id: req.params.id, groupId: gid, status: 'active' } });
    if (!loan) return res.redirect('/admin/loans?error=not_found');
    const group  = await Group.findByPk(gid);
    const member = await User.findByPk(loan.memberId);
    const amount = parseInt(req.body.amount);
    const repayment = await Repayment.create({ loanId: loan.id, memberId: loan.memberId, groupId: gid, amount, date: new Date(), postedBy: req.user.id });
    loan.amountRepaid += amount;
    const remaining = Math.max(0, loan.totalRepayable - loan.amountRepaid);
    if (remaining === 0) loan.status = 'repaid';
    await loan.save();
    await AuditLog.create({ userId: req.user.id, action: 'LOAN_REPAYMENT', detail: `Recorded UGX ${amount.toLocaleString()} repayment for ${member.name}`, groupId: gid });
    emails.loanRepaymentReceipt(member.toJSON(), repayment.toJSON(), remaining, group.toJSON()).catch(()=>{});
    res.redirect('/admin/loans?success=repayment_recorded');
  } catch (err) { console.error(err); res.redirect('/admin/loans?error=repayment_failed'); }
});

// ── Reports ───────────────────────────────────────────────────────
router.get('/reports', async (req, res) => {
  try {
    const gid   = req.user.groupId;
    const group = await Group.findByPk(gid);
    const members      = await User.findAll({ where: { groupId: gid, role: 'member' } });
    const memberCount  = members.length;
    const savingsRows  = await Saving.findAll({ where: { groupId: gid }, attributes: ['amount'] });
    const totalSavings = savingsRows.reduce((s,r) => s + r.amount, 0);
    const contribRows  = await Saving.findAll({ where: { groupId: gid, type: 'contribution' }, attributes: ['amount'] });
    const totalContribs= contribRows.reduce((s,r) => s + r.amount, 0);
    const activeL      = await Loan.findAll({ where: { groupId: gid, status: 'active' }, attributes: ['totalRepayable','amountRepaid'] });
    const loanPortfolio= activeL.reduce((s,l) => s + (l.totalRepayable - l.amountRepaid), 0);
    const allLoans     = await Loan.findAll({ where: { groupId: gid } });
    const loansByStatus= { pending:0, active:0, repaid:0, declined:0 };
    allLoans.forEach(l => loansByStatus[l.status]++);
    res.render('admin/reports', { user: req.user, group, stats: { memberCount, totalSavings, loanPortfolio, activeLoans: activeL.length }, members: members.map(m=>m.toJSON()), totalContribs, allLoans, loansByStatus });
  } catch (err) { console.error(err); res.render('error', { message: 'Error', user: req.user }); }
});

// ── Audit ─────────────────────────────────────────────────────────
router.get('/audit', async (req, res) => {
  try {
    const gid   = req.user.groupId;
    const group = await Group.findByPk(gid);
    const entries = await AuditLog.findAll({ where: { groupId: gid }, order: [['timestamp','DESC']], limit: 100 });
    const log = await Promise.all(entries.map(async e => ({ ...e.toJSON(), user: e.userId ? await User.findByPk(e.userId) : null })));
    res.render('admin/audit', { user: req.user, group, log });
  } catch (err) { console.error(err); res.render('error', { message: 'Error', user: req.user }); }
});

module.exports = router;
