const router = require('express').Router();
const bcrypt = require('bcryptjs');
const db = require('../database');
const { authenticate, requireRole } = require('../middleware/auth');
const { emails } = require('../utils/email');

router.use(authenticate, requireRole('admin', 'superadmin'));

// ── Dashboard ─────────────────────────────────────────────────────
router.get('/dashboard', (req, res) => {
  const gid = req.user.groupId;
  const group = db.groups.find(g => g.id === gid);
  const stats = db.getMemberStats(gid);
  const members = db.users.filter(u => u.role === 'member' && u.groupId === gid);
  const pendingLoans = db.loans.filter(l => l.groupId === gid && l.status === 'pending');
  const recentSavings = db.savings.filter(s => s.groupId === gid).sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 5).map(s => ({ ...s, member: db.users.find(u => u.id === s.memberId) }));
  res.render('admin/dashboard', { user: req.user, group, stats, members, pendingLoans, recentSavings });
});

// ── Members ───────────────────────────────────────────────────────
router.get('/members', (req, res) => {
  const gid = req.user.groupId;
  const group = db.groups.find(g => g.id === gid);
  const members = db.users.filter(u => u.role === 'member' && u.groupId === gid).map(m => ({
    ...m,
    savings: db.getSavingsBalance(m.id),
    activeLoan: db.getActiveLoan(m.id),
  }));
  res.render('admin/members', { user: req.user, group, members });
});

router.post('/members/add', async (req, res) => {
  const { name, email, phone, nationalId, monthlyContribution, shareCapitalTarget } = req.body;
  const gid = req.user.groupId;
  const group = db.groups.find(g => g.id === gid);
  if (db.users.find(u => u.email === email)) return res.redirect('/admin/members?error=email_exists');

  const prefix = group.name.replace(/[^A-Za-z]/g, '').slice(0, 3).toUpperCase();
  const num = String(db.users.filter(u => u.groupId === gid).length + 1).padStart(4, '0');
  const memberId = `${prefix}-${num}`;
  const tempPassword = `Yosacco@${Math.floor(1000 + Math.random() * 9000)}`;
  const uid = db.nextId('usr');

  const newMember = {
    id: uid, name, email: email.toLowerCase(), phone, nationalId,
    password: bcrypt.hashSync(tempPassword, 10),
    role: 'member', groupId: gid, memberId,
    joinDate: new Date(), monthlyContribution: parseInt(monthlyContribution) || 10000,
    shareCapitalTarget: parseInt(shareCapitalTarget) || 1000000,
    shareCapitalPaid: 0, active: true, createdAt: new Date(),
  };
  db.users.push(newMember);
  db.log(req.user.id, 'ADD_MEMBER', `Added member: ${name} (${memberId})`, gid);

  // Send welcome email
  emails.welcomeMember(newMember, group, tempPassword).catch(() => {});

  res.redirect('/admin/members?success=member_added');
});

router.get('/members/:id', (req, res) => {
  const gid = req.user.groupId;
  const member = db.users.find(u => u.id === req.params.id && u.groupId === gid && u.role === 'member');
  if (!member) return res.redirect('/admin/members?error=not_found');
  const group = db.groups.find(g => g.id === gid);
  const savings = db.savings.filter(s => s.memberId === member.id).sort((a, b) => new Date(b.date) - new Date(a.date));
  const balance = db.getSavingsBalance(member.id);
  const loans = db.loans.filter(l => l.memberId === member.id);
  res.render('admin/member-detail', { user: req.user, group, member, savings, balance, loans });
});

router.post('/members/:id/toggle', (req, res) => {
  const gid = req.user.groupId;
  const m = db.users.find(u => u.id === req.params.id && u.groupId === gid);
  if (m) { m.active = !m.active; db.log(req.user.id, 'TOGGLE_MEMBER', `${m.active ? 'Activated' : 'Deactivated'} ${m.name}`, gid); }
  res.redirect('/admin/members');
});

// ── Savings ───────────────────────────────────────────────────────
router.get('/savings', (req, res) => {
  const gid = req.user.groupId;
  const group = db.groups.find(g => g.id === gid);
  const members = db.users.filter(u => u.role === 'member' && u.groupId === gid).map(m => ({
    ...m, balance: db.getSavingsBalance(m.id),
    lastContrib: db.savings.filter(s => s.memberId === m.id && s.type === 'contribution').sort((a, b) => new Date(b.date) - new Date(a.date))[0],
  }));
  res.render('admin/savings', { user: req.user, group, members });
});

router.post('/savings/post', async (req, res) => {
  const { memberId, amount, type, description } = req.body;
  const gid = req.user.groupId;
  const member = db.users.find(u => u.id === memberId && u.groupId === gid);
  const group = db.groups.find(g => g.id === gid);
  if (!member) return res.redirect('/admin/savings?error=member_not_found');

  const tx = {
    id: db.nextId('sav'), memberId, groupId: gid,
    amount: parseInt(amount), type: type || 'contribution',
    description: description || `Monthly contribution`, date: new Date(), postedBy: req.user.id,
  };
  db.savings.push(tx);
  db.log(req.user.id, 'POST_SAVINGS', `Posted UGX ${amount} for ${member.name}`, gid);

  const balance = db.getSavingsBalance(memberId);
  emails.savingsReceiptToMember(member, tx, balance, group).catch(() => {});

  res.redirect('/admin/savings?success=savings_posted');
});

// ── Loans ─────────────────────────────────────────────────────────
router.get('/loans', (req, res) => {
  const gid = req.user.groupId;
  const group = db.groups.find(g => g.id === gid);
  const loans = db.loans.filter(l => l.groupId === gid).sort((a, b) => new Date(b.appliedAt) - new Date(a.appliedAt)).map(l => ({
    ...l, member: db.users.find(u => u.id === l.memberId),
    savingsBalance: db.getSavingsBalance(l.memberId),
  }));
  res.render('admin/loans', { user: req.user, group, loans });
});

router.post('/loans/:id/approve', async (req, res) => {
  const gid = req.user.groupId;
  const loan = db.loans.find(l => l.id === req.params.id && l.groupId === gid && l.status === 'pending');
  if (!loan) return res.redirect('/admin/loans?error=not_found');
  const group = db.groups.find(g => g.id === gid);
  const member = db.users.find(u => u.id === loan.memberId);

  const rate = 0.015; // 1.5% per month
  loan.status = 'active';
  loan.approvedAt = new Date();
  loan.approvedBy = req.user.id;
  loan.disbursedAt = new Date();
  loan.notes = req.body.notes || '';
  loan.monthlyInstallment = Math.round(loan.amount * (1 + rate * loan.repaymentMonths) / loan.repaymentMonths);
  loan.totalRepayable = loan.monthlyInstallment * loan.repaymentMonths;

  db.log(req.user.id, 'APPROVE_LOAN', `Approved loan ${loan.id} for ${member.name} — UGX ${loan.amount.toLocaleString()}`, gid);
  emails.loanApprovedToMember(member, loan, group).catch(() => {});

  res.redirect('/admin/loans?success=loan_approved');
});

router.post('/loans/:id/decline', async (req, res) => {
  const gid = req.user.groupId;
  const loan = db.loans.find(l => l.id === req.params.id && l.groupId === gid && l.status === 'pending');
  if (!loan) return res.redirect('/admin/loans?error=not_found');
  const group = db.groups.find(g => g.id === gid);
  const member = db.users.find(u => u.id === loan.memberId);

  loan.status = 'declined';
  loan.notes = req.body.notes || 'Application declined';
  db.log(req.user.id, 'DECLINE_LOAN', `Declined loan for ${member.name}`, gid);
  emails.loanDeclinedToMember(member, loan, group).catch(() => {});

  res.redirect('/admin/loans?success=loan_declined');
});

router.post('/loans/:id/repayment', async (req, res) => {
  const gid = req.user.groupId;
  const loan = db.loans.find(l => l.id === req.params.id && l.groupId === gid && l.status === 'active');
  if (!loan) return res.redirect('/admin/loans?error=not_found');
  const group = db.groups.find(g => g.id === gid);
  const member = db.users.find(u => u.id === loan.memberId);
  const amount = parseInt(req.body.amount);

  const repayment = { id: db.nextId('rep'), loanId: loan.id, memberId: loan.memberId, groupId: gid, amount, date: new Date(), postedBy: req.user.id };
  db.repayments.push(repayment);
  loan.amountRepaid += amount;

  const remaining = Math.max(0, loan.totalRepayable - loan.amountRepaid);
  if (remaining === 0) loan.status = 'repaid';

  db.log(req.user.id, 'LOAN_REPAYMENT', `Recorded UGX ${amount.toLocaleString()} repayment for ${member.name}`, gid);
  emails.loanRepaymentReceipt(member, repayment, remaining, group).catch(() => {});

  res.redirect('/admin/loans?success=repayment_recorded');
});

// ── Reports ───────────────────────────────────────────────────────
router.get('/reports', (req, res) => {
  const gid = req.user.groupId;
  const group = db.groups.find(g => g.id === gid);
  const members = db.users.filter(u => u.role === 'member' && u.groupId === gid);
  const stats = db.getMemberStats(gid);
  const totalContribs = db.savings.filter(s => s.groupId === gid && s.type === 'contribution').reduce((s, x) => s + x.amount, 0);
  const allLoans = db.loans.filter(l => l.groupId === gid);
  const loansByStatus = { pending: 0, active: 0, repaid: 0, declined: 0 };
  allLoans.forEach(l => loansByStatus[l.status]++);
  res.render('admin/reports', { user: req.user, group, stats, members, totalContribs, allLoans, loansByStatus });
});

// ── Audit ─────────────────────────────────────────────────────────
router.get('/audit', (req, res) => {
  const gid = req.user.groupId;
  const group = db.groups.find(g => g.id === gid);
  const log = db.auditLog.filter(e => e.groupId === gid || !e.groupId).slice(0, 100).map(e => ({
    ...e, user: db.users.find(u => u.id === e.userId),
  }));
  res.render('admin/audit', { user: req.user, group, log });
});

module.exports = router;
