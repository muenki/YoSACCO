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

// ── Dashboard ─────────────────────────────────────────────────────
router.get('/dashboard', async (req, res) => {
  try {
    const gid   = req.user.groupId;
    const group = await Group.findByPk(gid);

    const memberCount   = await User.count({ where: { groupId: gid, role: 'member' } });
    const savingsRows   = await Saving.findAll({ where: { groupId: gid }, attributes: ['amount'] });
    const totalSavings  = savingsRows.reduce((s, r) => s + r.amount, 0);
    const activeLoanRows= await Loan.findAll({ where: { groupId: gid, status: 'active' }, attributes: ['totalRepayable','amountRepaid'] });
    const activeLoans   = activeLoanRows.length;
    const loanPortfolio = activeLoanRows.reduce((s, l) => s + (l.totalRepayable - l.amountRepaid), 0);

    // All in-progress loans (pending review by approvers OR fully approved awaiting disbursement)
    const pendingLoans = await Loan.findAll({
      where: { groupId: gid, status: { [Op.in]: ['pending','under_review','approved'] } },
      order: [['appliedAt','DESC']],
    });
    const pendingLoansWithMember = await Promise.all(pendingLoans.map(async l => ({
      ...l.toJSON(), member: (await User.findByPk(l.memberId))?.toJSON() || null,
    })));

    const recentSavings = await Saving.findAll({
      where: { groupId: gid }, order: [['date','DESC']], limit: 5,
    });
    const recentSavingsWithMember = await Promise.all(recentSavings.map(async s => ({
      ...s.toJSON(), member: (await User.findByPk(s.memberId))?.toJSON() || null,
    })));

    const members = await User.findAll({ where: { groupId: gid, role: 'member' } });

    res.render('admin/dashboard', {
      user: req.user, group,
      stats: { memberCount, totalSavings, activeLoans, loanPortfolio, pendingLoans: pendingLoans.length },
      pendingLoans: pendingLoansWithMember,
      recentSavings: recentSavingsWithMember,
      members: members.map(m => m.toJSON()),
    });
  } catch (err) {
    console.error('Admin dashboard error:', err);
    res.render('error', { message: 'Dashboard error', user: req.user });
  }
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
      return { ...m.toJSON(), savings: balance, activeLoan: activeLoan?.toJSON() || null };
    }));
    res.render('admin/members', { user: req.user, group, members, query: req.query });
  } catch (err) {
    console.error('Members error:', err);
    res.render('error', { message: 'Error loading members', user: req.user });
  }
});

router.post('/members/add', async (req, res) => {
  try {
    const { name, email, phone, nationalId, monthlyContribution, shareCapitalTarget } = req.body;
    const gid   = req.user.groupId;
    const group = await Group.findByPk(gid);
    if (await User.findOne({ where: { email: email.toLowerCase() } })) return res.redirect('/admin/members?error=email_exists');
    const count    = await User.count({ where: { groupId: gid, role: 'member' } });
    const prefix   = group.name.replace(/[^A-Za-z]/g,'').slice(0,3).toUpperCase();
    const memberId = `${prefix}-${String(count + 1).padStart(4,'0')}`;
    const tempPass = `Yosacco@${Math.floor(1000 + Math.random() * 9000)}`;
    const newMember = await User.create({
      name, email: email.toLowerCase(), phone, nationalId,
      password: bcrypt.hashSync(tempPass, 10),
      role: 'member', groupId: gid, memberId,
      joinDate: new Date(),
      monthlyContribution: parseInt(monthlyContribution) || 10000,
      shareCapitalTarget:  parseInt(shareCapitalTarget)  || 1000000,
      shareCapitalPaid: 0, active: true,
    });
    await AuditLog.create({ userId: req.user.id, action: 'ADD_MEMBER', detail: `Added member: ${name} (${memberId})`, groupId: gid });
    emails.welcomeMember(newMember.toJSON(), group.toJSON(), tempPass).catch(() => {});
    res.redirect('/admin/members?success=member_added');
  } catch (err) {
    console.error('Add member error:', err);
    res.redirect('/admin/members?error=add_failed');
  }
});

router.get('/members/:id', async (req, res) => {
  try {
    const gid    = req.user.groupId;
    const group  = await Group.findByPk(gid);
    const member = await User.findOne({ where: { id: req.params.id, groupId: gid, role: 'member' } });
    if (!member) return res.redirect('/admin/members?error=not_found');
    const savings = await Saving.findAll({ where: { memberId: member.id }, order: [['date','DESC']] });
    const balance = savings.reduce((s, r) => s + r.amount, 0);
    const loans   = await Loan.findAll({ where: { memberId: member.id }, order: [['appliedAt','DESC']] });
    res.render('admin/member-detail', { user: req.user, group, member: member.toJSON(), savings, balance, loans });
  } catch (err) {
    console.error('Member detail error:', err);
    res.redirect('/admin/members');
  }
});

router.post('/members/:id/toggle', async (req, res) => {
  try {
    const gid = req.user.groupId;
    const m   = await User.findOne({ where: { id: req.params.id, groupId: gid } });
    if (m) { m.active = !m.active; await m.save(); await AuditLog.create({ userId: req.user.id, action: 'TOGGLE_MEMBER', detail: `${m.active ? 'Activated' : 'Deactivated'} ${m.name}`, groupId: gid }); }
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
      const balance    = await getBalance(m.id);
      const lastContrib= await Saving.findOne({ where: { memberId: m.id, type: 'contribution' }, order: [['date','DESC']] });
      return { ...m.toJSON(), balance, lastContrib: lastContrib?.toJSON() || null };
    }));
    res.render('admin/savings', { user: req.user, group, members, query: req.query });
  } catch (err) {
    console.error('Savings error:', err);
    res.render('error', { message: 'Error loading savings', user: req.user });
  }
});

router.post('/savings/post', async (req, res) => {
  try {
    const { memberId, amount, type, description } = req.body;
    const gid    = req.user.groupId;
    const member = await User.findOne({ where: { id: memberId, groupId: gid } });
    const group  = await Group.findByPk(gid);
    if (!member) return res.redirect('/admin/savings?error=member_not_found');
    const tx = await Saving.create({
      memberId, groupId: gid, amount: parseInt(amount),
      type: type || 'contribution',
      description: description || 'Monthly contribution',
      date: new Date(), postedBy: req.user.id,
    });
    await AuditLog.create({ userId: req.user.id, action: 'POST_SAVINGS', detail: `Posted UGX ${amount} for ${member.name}`, groupId: gid });
    const balance = await getBalance(memberId);
    emails.savingsReceiptToMember(member.toJSON(), tx.toJSON(), balance, group.toJSON()).catch(() => {});
    res.redirect('/admin/savings?success=savings_posted');
  } catch (err) {
    console.error('Post savings error:', err);
    res.redirect('/admin/savings?error=post_failed');
  }
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
      const co = l.creditOfficerId ? await User.findByPk(l.creditOfficerId, { attributes: ['name'] }) : null;
      const tr = l.treasurerId     ? await User.findByPk(l.treasurerId,     { attributes: ['name'] }) : null;
      const ch = l.chairpersonId   ? await User.findByPk(l.chairpersonId,   { attributes: ['name'] }) : null;
      return { ...l.toJSON(), member: member?.toJSON() || null, savingsBalance, coUser: co?.name||null, trUser: tr?.name||null, chUser: ch?.name||null };
    }));
    res.render('admin/loans', { user: req.user, group, loans, query: req.query });
  } catch (err) {
    console.error('Loans error:', err);
    res.render('error', { message: 'Error loading loans', user: req.user });
  }
});

// Admin can still approve old-style (direct) if no approvers set up
router.post('/loans/:id/approve', async (req, res) => {
  try {
    const gid  = req.user.groupId;
    const loan = await Loan.findOne({ where: { id: req.params.id, groupId: gid, status: { [Op.in]: ['pending','under_review','approved'] } } });
    if (!loan) return res.redirect('/admin/loans?error=not_found');
    const group  = await Group.findByPk(gid);
    const member = await User.findByPk(loan.memberId);
    const rate   = loan.loanType === 'emergency' ? 0.02 : 0.015;
    loan.status             = 'active';
    loan.approvedAt         = new Date();
    loan.approvedBy         = req.user.id;
    loan.disbursedAt        = new Date();
    loan.notes              = req.body.notes || '';
    loan.monthlyInstallment = Math.round(loan.amount * (1 + rate * loan.repaymentMonths) / loan.repaymentMonths);
    loan.totalRepayable     = loan.monthlyInstallment * loan.repaymentMonths;
    // Mark all stages as approved if admin overrides
    loan.creditOfficerStatus = 'approved';
    loan.treasurerStatus     = 'approved';
    loan.chairpersonStatus   = 'approved';
    await loan.save();
    await AuditLog.create({ userId: req.user.id, action: 'APPROVE_LOAN', detail: `Admin approved loan for ${member.name} — UGX ${loan.amount.toLocaleString()}`, groupId: gid });
    emails.loanApprovedToMember(member.toJSON(), loan.toJSON(), group.toJSON()).catch(() => {});
    res.redirect('/admin/loans?success=loan_approved');
  } catch (err) { console.error(err); res.redirect('/admin/loans?error=approve_failed'); }
});

router.post('/loans/:id/decline', async (req, res) => {
  try {
    const gid  = req.user.groupId;
    const loan = await Loan.findOne({ where: { id: req.params.id, groupId: gid, status: { [Op.in]: ['pending','under_review','approved'] } } });
    if (!loan) return res.redirect('/admin/loans?error=not_found');
    const group  = await Group.findByPk(gid);
    const member = await User.findByPk(loan.memberId);
    loan.status = 'declined';
    loan.notes  = req.body.notes || 'Declined by admin';
    await loan.save();
    await AuditLog.create({ userId: req.user.id, action: 'DECLINE_LOAN', detail: `Admin declined loan for ${member.name}`, groupId: gid });
    emails.loanDeclinedToMember(member.toJSON(), loan.toJSON(), group.toJSON()).catch(() => {});
    res.redirect('/admin/loans?success=loan_declined');
  } catch (err) { console.error(err); res.redirect('/admin/loans?error=decline_failed'); }
});

// Disburse a fully approved loan (all 3 stages done)
router.post('/loans/:id/disburse', async (req, res) => {
  try {
    const gid  = req.user.groupId;
    const loan = await Loan.findOne({ where: { id: req.params.id, groupId: gid, status: 'approved' } });
    if (!loan) return res.redirect('/admin/loans?error=not_approved_yet');
    const group  = await Group.findByPk(gid);
    const member = await User.findByPk(loan.memberId);
    const rate   = loan.loanType === 'emergency' ? 0.02 : 0.015;
    loan.monthlyInstallment = Math.round(loan.amount * (1 + rate * loan.repaymentMonths) / loan.repaymentMonths);
    loan.totalRepayable     = loan.monthlyInstallment * loan.repaymentMonths;
    loan.status             = 'active';
    loan.approvedBy         = req.user.id;
    loan.approvedAt         = new Date();
    loan.disbursedAt        = new Date();
    loan.notes              = req.body.notes || '';
    await loan.save();
    await AuditLog.create({ userId: req.user.id, action: 'LOAN_DISBURSED', detail: `Disbursed UGX ${loan.amount.toLocaleString()} to ${member.name}`, groupId: gid });
    emails.loanApprovedToMember(member.toJSON(), loan.toJSON(), group.toJSON()).catch(() => {});
    res.redirect('/admin/loans?success=loan_disbursed');
  } catch (err) { console.error(err); res.redirect('/admin/loans?error=disburse_failed'); }
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
    emails.loanRepaymentReceipt(member.toJSON(), repayment.toJSON(), remaining, group.toJSON()).catch(() => {});
    res.redirect('/admin/loans?success=repayment_recorded');
  } catch (err) { console.error(err); res.redirect('/admin/loans?error=repayment_failed'); }
});

// ── Reports ───────────────────────────────────────────────────────
router.get('/reports', async (req, res) => {
  try {
    const gid   = req.user.groupId;
    const group = await Group.findByPk(gid);
    const members      = await User.findAll({ where: { groupId: gid, role: 'member' } });
    const savingsRows  = await Saving.findAll({ where: { groupId: gid }, attributes: ['amount'] });
    const totalSavings = savingsRows.reduce((s, r) => s + r.amount, 0);
    const contribRows  = await Saving.findAll({ where: { groupId: gid, type: 'contribution' }, attributes: ['amount'] });
    const totalContribs= contribRows.reduce((s, r) => s + r.amount, 0);
    const activeLoanRows = await Loan.findAll({ where: { groupId: gid, status: 'active' }, attributes: ['totalRepayable','amountRepaid'] });
    const loanPortfolio  = activeLoanRows.reduce((s, l) => s + (l.totalRepayable - l.amountRepaid), 0);
    const allLoans     = await Loan.findAll({ where: { groupId: gid } });
    const loansByStatus= { pending: 0, under_review: 0, approved: 0, active: 0, repaid: 0, declined: 0, rejected: 0 };
    allLoans.forEach(l => { if (loansByStatus[l.status] !== undefined) loansByStatus[l.status]++; });
    res.render('admin/reports', {
      user: req.user, group,
      stats: { memberCount: members.length, totalSavings, loanPortfolio, activeLoans: activeLoanRows.length },
      members: members.map(m => m.toJSON()),
      totalContribs, allLoans, loansByStatus,
    });
  } catch (err) {
    console.error('Reports error:', err);
    res.render('error', { message: 'Error loading reports', user: req.user });
  }
});

// ── Audit ─────────────────────────────────────────────────────────
router.get('/audit', async (req, res) => {
  try {
    const gid   = req.user.groupId;
    const group = await Group.findByPk(gid);
    const entries = await AuditLog.findAll({ where: { groupId: gid }, order: [['timestamp','DESC']], limit: 100 });
    const log = await Promise.all(entries.map(async e => ({
      ...e.toJSON(), user: e.userId ? (await User.findByPk(e.userId))?.toJSON() || null : null,
    })));
    res.render('admin/audit', { user: req.user, group, log });
  } catch (err) {
    console.error('Audit error:', err);
    res.render('error', { message: 'Error loading audit trail', user: req.user });
  }
});

module.exports = router;
