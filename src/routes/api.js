const router = require('express').Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const apiAuth = require('../middleware/apiAuth');
const {
  User, Saving, Loan, Repayment,
  SavingsWithdrawal, Project, ProjectContribution,
  Asset, Expenditure, OtherIncome, Invoice, AuditLog,
  GroupSettings, Group
} = require('../models');
const { Op } = require('sequelize');

// ─── AUTH ──────────────────────────────────────────────────────────────────

router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password)
      return res.status(400).json({ message: 'Email and password required' });
    const user = await User.findOne({
      where: { email: email.trim().toLowerCase(), active: true }
    });
    if (!user || !bcrypt.compareSync(password, user.password))
      return res.status(401).json({ message: 'Invalid email or password' });
    const token = jwt.sign(
      { id: user.id, role: user.role, groupId: user.groupId },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );
    AuditLog.create({
      userId: user.id, action: 'LOGIN',
      detail: `${user.name} logged in (mobile)`, groupId: user.groupId || null
    }).catch(() => {});
    res.json({
      token,
      user: {
        id: user.id, name: user.name, email: user.email,
        role: user.role, groupId: user.groupId,
        mustChangePassword: user.mustChangePassword
      }
    });
  } catch (err) {
    console.error('API login error:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

router.post('/change-password', apiAuth(), async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const user = await User.findByPk(req.user.id);
    if (!bcrypt.compareSync(currentPassword, user.password))
      return res.status(400).json({ message: 'Current password is incorrect' });
    user.password = bcrypt.hashSync(newPassword, 10);
    user.mustChangePassword = false;
    await user.save();
    res.json({ message: 'Password updated' });
  } catch { res.status(500).json({ message: 'Server error' }); }
});

// ─── MEMBER ────────────────────────────────────────────────────────────────

router.get('/member/dashboard', apiAuth('member'), async (req, res) => {
  try {
    const memberId = req.user.id;
    const savings = await Saving.findAll({ where: { memberId } });
    const totalSavings = savings.reduce((s, t) => s + +t.amount, 0);
    const loans = await Loan.findAll({ where: { memberId } });
    const activeLoans = loans.filter(l =>
      ['active', 'approved', 'under_review'].includes(l.status)
    ).length;
    const loanBalance = loans
      .filter(l => l.status === 'active')
      .reduce((s, l) => s + Math.max(0, +l.totalRepayable - +l.amountRepaid), 0);
    const recent = await Saving.findAll({
      where: { memberId }, order: [['createdAt', 'DESC']], limit: 5
    });
    res.json({
      totalSavings, activeLoans, loanBalance, shareValue: totalSavings,
      recentTransactions: recent.map(t => ({
        type: t.type, amount: t.amount,
        description: t.description, date: t.createdAt
      }))
    });
  } catch (e) { console.error(e); res.status(500).json({ message: 'Server error' }); }
});

router.get('/member/savings', apiAuth('member'), async (req, res) => {
  try {
    const txns = await Saving.findAll({
      where: { memberId: req.user.id }, order: [['createdAt', 'DESC']]
    });
    const balance = txns.reduce((s, t) => s + +t.amount, 0);
    res.json({
      balance,
      statement: txns.map(t => ({
        type: t.type, amount: t.amount,
        description: t.description, date: t.createdAt
      }))
    });
  } catch { res.status(500).json({ message: 'Server error' }); }
});

router.get('/member/loans', apiAuth('member'), async (req, res) => {
  try {
    const loans = await Loan.findAll({
      where: { memberId: req.user.id }, order: [['createdAt', 'DESC']]
    });
    res.json({ loans });
  } catch { res.status(500).json({ message: 'Server error' }); }
});

router.post('/member/loans/apply', apiAuth('member'), async (req, res) => {
  try {
    const { amount, purpose, repaymentMonths, loanType } = req.body;
    const loan = await Loan.create({
      memberId: req.user.id, groupId: req.user.groupId,
      amount, purpose, repaymentMonths: repaymentMonths || 12,
      loanType: loanType || 'new_loan', status: 'pending'
    });
    res.json({ message: 'Loan application submitted', loan });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

router.get('/member/withdrawal', apiAuth('member'), async (req, res) => {
  try {
    const withdrawals = await SavingsWithdrawal.findAll({
      where: { memberId: req.user.id }, order: [['createdAt', 'DESC']]
    });
    res.json({ withdrawals });
  } catch { res.status(500).json({ message: 'Server error' }); }
});

router.post('/member/withdrawal', apiAuth('member'), async (req, res) => {
  try {
    const { amount, reason } = req.body;
    const w = await SavingsWithdrawal.create({
      memberId: req.user.id, groupId: req.user.groupId,
      amount, reason, status: 'pending'
    });
    res.json({ message: 'Withdrawal request submitted', withdrawal: w });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

router.get('/member/profile', apiAuth('member'), async (req, res) => {
  try {
    const user = await User.findByPk(req.user.id, {
      attributes: ['id', 'name', 'email', 'role', 'phone', 'memberId',
        'nationalId', 'joinDate', 'monthlyContribution',
        'shareCapitalTarget', 'shareCapitalPaid'],
      include: [{ model: Group, as: 'group', attributes: ['id', 'name'] }]
    });
    res.json(user);
  } catch { res.status(500).json({ message: 'Server error' }); }
});

router.get('/member/projects', apiAuth('member'), async (req, res) => {
  try {
    const projects = await Project.findAll({
      where: { groupId: req.user.groupId }
    });
    res.json({ projects });
  } catch { res.status(500).json({ message: 'Server error' }); }
});

// ─── ADMIN ─────────────────────────────────────────────────────────────────

router.get('/admin/dashboard', apiAuth('admin'), async (req, res) => {
  try {
    const groupId = req.user.groupId;
    const [totalMembers, savings, loans, pendingLoans] = await Promise.all([
      User.count({ where: { groupId, role: 'member', active: true } }),
      Saving.findAll({ where: { groupId } }),
      Loan.findAll({ where: { groupId } }),
      Loan.count({ where: { groupId, status: 'pending' } }),
    ]);
    const totalSavings = savings.reduce((s, t) => s + +t.amount, 0);
    const totalLoans = loans
      .filter(l => l.status === 'active')
      .reduce((s, l) => s + +l.amount, 0);
    res.json({ totalMembers, totalSavings, totalLoans, pendingLoans });
  } catch { res.status(500).json({ message: 'Server error' }); }
});

router.get('/admin/members', apiAuth('admin'), async (req, res) => {
  try {
    const members = await User.findAll({
      where: { groupId: req.user.groupId },
      attributes: ['id', 'name', 'email', 'role', 'phone', 'memberId', 'active'],
      order: [['name', 'ASC']]
    });
    res.json({ members });
  } catch { res.status(500).json({ message: 'Server error' }); }
});

router.post('/admin/members/add', apiAuth('admin'), async (req, res) => {
  try {
    const { name, email, phone, role, memberId } = req.body;
    const password = bcrypt.hashSync('changeme123', 10);
    const user = await User.create({
      name, email: email.trim().toLowerCase(), phone,
      role: role || 'member', memberId, password,
      groupId: req.user.groupId, mustChangePassword: true
    });
    res.json({ message: 'Member added', user });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

router.post('/admin/members/:id/toggle', apiAuth('admin'), async (req, res) => {
  try {
    const user = await User.findByPk(req.params.id);
    user.active = !user.active;
    await user.save();
    res.json({ message: `Member ${user.active ? 'activated' : 'deactivated'}`, active: user.active });
  } catch { res.status(500).json({ message: 'Server error' }); }
});

router.get('/admin/savings', apiAuth('admin'), async (req, res) => {
  try {
    const savings = await Saving.findAll({
      where: { groupId: req.user.groupId },
      include: [{ model: User, as: 'member', attributes: ['name', 'memberId'] }],
      order: [['createdAt', 'DESC']]
    });
    res.json({ savings });
  } catch { res.status(500).json({ message: 'Server error' }); }
});

router.post('/admin/savings/post', apiAuth('admin'), async (req, res) => {
  try {
    const { memberId, amount, type, description } = req.body;
    const saving = await Saving.create({
      memberId, groupId: req.user.groupId, amount, type: type || 'contribution', description
    });
    res.json({ message: 'Saving posted', saving });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

router.get('/admin/loans', apiAuth('admin'), async (req, res) => {
  try {
    const loans = await Loan.findAll({
      where: { groupId: req.user.groupId },
      include: [{ model: User, as: 'member', attributes: ['name', 'memberId'] }],
      order: [['createdAt', 'DESC']]
    });
    res.json({ loans });
  } catch { res.status(500).json({ message: 'Server error' }); }
});

router.post('/admin/loans/:id/approve', apiAuth('admin'), async (req, res) => {
  try {
    const loan = await Loan.findByPk(req.params.id);
    loan.status = 'approved';
    await loan.save();
    res.json({ message: 'Loan approved' });
  } catch { res.status(500).json({ message: 'Server error' }); }
});

router.post('/admin/loans/:id/decline', apiAuth('admin'), async (req, res) => {
  try {
    const loan = await Loan.findByPk(req.params.id);
    loan.status = 'declined';
    await loan.save();
    res.json({ message: 'Loan declined' });
  } catch { res.status(500).json({ message: 'Server error' }); }
});

router.post('/admin/loans/:id/disburse', apiAuth('admin'), async (req, res) => {
  try {
    const loan = await Loan.findByPk(req.params.id);
    loan.status = 'active';
    loan.disbursedAt = new Date();
    await loan.save();
    res.json({ message: 'Loan disbursed' });
  } catch { res.status(500).json({ message: 'Server error' }); }
});

router.post('/admin/loans/:id/repayment', apiAuth('admin'), async (req, res) => {
  try {
    const { amount } = req.body;
    const loan = await Loan.findByPk(req.params.id);
    await Repayment.create({
      loanId: loan.id, memberId: loan.memberId,
      groupId: req.user.groupId, amount
    });
    loan.amountRepaid = (+loan.amountRepaid || 0) + +amount;
    if (loan.amountRepaid >= loan.totalRepayable) loan.status = 'repaid';
    await loan.save();
    res.json({ message: 'Repayment recorded', amountRepaid: loan.amountRepaid });
  } catch { res.status(500).json({ message: 'Server error' }); }
});

router.get('/admin/loan-terms', apiAuth('admin'), async (req, res) => {
  try {
    const settings = await GroupSettings.findOne({ where: { groupId: req.user.groupId } });
    res.json({ settings });
  } catch { res.status(500).json({ message: 'Server error' }); }
});

router.post('/admin/loan-terms', apiAuth('admin'), async (req, res) => {
  try {
    const { maxLoanAmount, interestRate, maxRepaymentMonths } = req.body;
    const [settings] = await GroupSettings.upsert({
      groupId: req.user.groupId, maxLoanAmount, interestRate, maxRepaymentMonths
    });
    res.json({ message: 'Loan terms updated', settings });
  } catch { res.status(500).json({ message: 'Server error' }); }
});

router.get('/admin/expenditure', apiAuth('admin'), async (req, res) => {
  try {
    const [expenditures, incomes] = await Promise.all([
      Expenditure.findAll({ where: { groupId: req.user.groupId }, order: [['createdAt', 'DESC']] }),
      OtherIncome.findAll({ where: { groupId: req.user.groupId }, order: [['createdAt', 'DESC']] }),
    ]);
    res.json({ expenditures, incomes });
  } catch { res.status(500).json({ message: 'Server error' }); }
});

router.post('/admin/expenditure/add', apiAuth('admin'), async (req, res) => {
  try {
    const { description, amount, category } = req.body;
    const exp = await Expenditure.create({
      groupId: req.user.groupId, description, amount,
      category, postedBy: req.user.id
    });
    res.json({ message: 'Expenditure recorded', exp });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

router.post('/admin/expenditure/income/add', apiAuth('admin'), async (req, res) => {
  try {
    const { description, amount, source } = req.body;
    const income = await OtherIncome.create({
      groupId: req.user.groupId, description, amount,
      source, postedBy: req.user.id
    });
    res.json({ message: 'Income recorded', income });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

router.get('/admin/assets', apiAuth('admin'), async (req, res) => {
  try {
    const assets = await Asset.findAll({
      where: { groupId: req.user.groupId }, order: [['createdAt', 'DESC']]
    });
    res.json({ assets });
  } catch { res.status(500).json({ message: 'Server error' }); }
});

router.post('/admin/assets/add', apiAuth('admin'), async (req, res) => {
  try {
    const { name, value, description } = req.body;
    const asset = await Asset.create({
      groupId: req.user.groupId, name, value, description
    });
    res.json({ message: 'Asset added', asset });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

router.get('/admin/projects', apiAuth('admin'), async (req, res) => {
  try {
    const projects = await Project.findAll({
      where: { groupId: req.user.groupId }, order: [['createdAt', 'DESC']]
    });
    res.json({ projects });
  } catch { res.status(500).json({ message: 'Server error' }); }
});

router.get('/admin/invoices', apiAuth('admin'), async (req, res) => {
  try {
    const invoices = await Invoice.findAll({
      where: { groupId: req.user.groupId }, order: [['createdAt', 'DESC']]
    });
    res.json({ invoices });
  } catch { res.status(500).json({ message: 'Server error' }); }
});

router.get('/admin/withdrawals', apiAuth('admin'), async (req, res) => {
  try {
    const withdrawals = await SavingsWithdrawal.findAll({
      where: { groupId: req.user.groupId },
      include: [{ model: User, as: 'member', attributes: ['name', 'memberId'] }],
      order: [['createdAt', 'DESC']]
    });
    res.json({ withdrawals });
  } catch { res.status(500).json({ message: 'Server error' }); }
});

router.post('/admin/withdrawals/:id/disburse', apiAuth('admin'), async (req, res) => {
  try {
    const w = await SavingsWithdrawal.findByPk(req.params.id);
    w.status = 'approved';
    w.disbursedAt = new Date();
    w.disbursedBy = req.user.id;
    await w.save();
    await Saving.create({
      memberId: w.memberId, groupId: w.groupId,
      amount: -w.amount, type: 'payout',
      description: 'Savings withdrawal disbursed'
    });
    res.json({ message: 'Withdrawal disbursed' });
  } catch { res.status(500).json({ message: 'Server error' }); }
});

router.get('/admin/audit', apiAuth('admin'), async (req, res) => {
  try {
    const logs = await AuditLog.findAll({
      where: { groupId: req.user.groupId },
      include: [{ model: User, as: 'user', attributes: ['name'] }],
      order: [['createdAt', 'DESC']], limit: 100
    });
    res.json({ logs });
  } catch { res.status(500).json({ message: 'Server error' }); }
});

router.get('/admin/reports', apiAuth('admin'), async (req, res) => {
  try {
    const groupId = req.user.groupId;
    const [savings, loans, expenditures, incomes, members] = await Promise.all([
      Saving.findAll({ where: { groupId } }),
      Loan.findAll({ where: { groupId } }),
      Expenditure.findAll({ where: { groupId } }),
      OtherIncome.findAll({ where: { groupId } }),
      User.count({ where: { groupId, role: 'member', active: true } }),
    ]);
    const totalSavings = savings.reduce((s, t) => s + +t.amount, 0);
    const totalLoansIssued = loans.filter(l => l.status === 'active' || l.status === 'repaid').reduce((s, l) => s + +l.amount, 0);
    const totalRepaid = loans.reduce((s, l) => s + +l.amountRepaid, 0);
    const totalExpenditure = expenditures.reduce((s, e) => s + +e.amount, 0);
    const totalIncome = incomes.reduce((s, i) => s + +i.amount, 0);
    res.json({ members, totalSavings, totalLoansIssued, totalRepaid, totalExpenditure, totalIncome });
  } catch { res.status(500).json({ message: 'Server error' }); }
});

// ─── APPROVER ──────────────────────────────────────────────────────────────

const APPROVER = ['credit_officer', 'treasurer', 'chairperson'];

router.get('/approver/dashboard', apiAuth(...APPROVER), async (req, res) => {
  try {
    const loans = await Loan.findAll({
      where: { groupId: req.user.groupId, status: ['pending', 'under_review'] },
      include: [{ model: User, as: 'member', attributes: ['name', 'memberId'] }],
      order: [['createdAt', 'DESC']]
    });
    const withdrawals = await SavingsWithdrawal.findAll({
      where: { groupId: req.user.groupId, status: 'pending' },
      include: [{ model: User, as: 'member', attributes: ['name', 'memberId'] }],
    });
    res.json({ loans, withdrawals });
  } catch { res.status(500).json({ message: 'Server error' }); }
});

router.get('/approver/loans/:id', apiAuth(...APPROVER), async (req, res) => {
  try {
    const loan = await Loan.findByPk(req.params.id, {
      include: [{ model: User, as: 'member', attributes: ['name', 'memberId', 'email', 'phone'] }]
    });
    res.json({ loan });
  } catch { res.status(500).json({ message: 'Server error' }); }
});

router.post('/approver/loans/:id/review', apiAuth(...APPROVER), async (req, res) => {
  try {
    const { decision, comment } = req.body;
    const role = req.user.role;
    const loan = await Loan.findByPk(req.params.id);
    const approved = decision === 'approve';
    if (role === 'credit_officer') {
      loan.creditOfficerStatus = approved ? 'approved' : 'rejected';
      loan.creditOfficerNote = comment;
      loan.creditOfficerId = req.user.id;
      loan.creditOfficerAt = new Date();
      if (!approved) loan.status = 'rejected';
      else loan.status = 'under_review';
    } else if (role === 'treasurer') {
      loan.treasurerStatus = approved ? 'approved' : 'rejected';
      loan.treasurerNote = comment;
      loan.treasurerId = req.user.id;
      loan.treasurerAt = new Date();
      if (!approved) loan.status = 'rejected';
    } else if (role === 'chairperson') {
      loan.chairpersonStatus = approved ? 'approved' : 'rejected';
      loan.chairpersonNote = comment;
      loan.chairpersonId = req.user.id;
      if (!approved) loan.status = 'rejected';
      else loan.status = 'approved';
    }
    await loan.save();
    res.json({ message: `Loan ${approved ? 'approved' : 'rejected'} by ${role}` });
  } catch { res.status(500).json({ message: 'Server error' }); }
});

router.post('/approver/withdrawals/:id/approve', apiAuth(...APPROVER), async (req, res) => {
  try {
    const { comment } = req.body;
    const role = req.user.role;
    const w = await SavingsWithdrawal.findByPk(req.params.id);
    if (role === 'credit_officer') { w.creditOfficerStatus = 'approved'; w.creditOfficerNote = comment; w.status = 'credit_approved'; }
    else if (role === 'treasurer') { w.treasurerStatus = 'approved'; w.treasurerNote = comment; w.status = 'treasurer_approved'; }
    else if (role === 'chairperson') { w.chairpersonStatus = 'approved'; w.chairpersonNote = comment; w.status = 'chair_approved'; }
    await w.save();
    res.json({ message: 'Withdrawal approved' });
  } catch { res.status(500).json({ message: 'Server error' }); }
});

router.post('/approver/withdrawals/:id/reject', apiAuth(...APPROVER), async (req, res) => {
  try {
    const { comment } = req.body;
    const w = await SavingsWithdrawal.findByPk(req.params.id);
    w.status = 'rejected';
    w.rejectedBy = req.user.role;
    w.rejectionReason = comment;
    await w.save();
    res.json({ message: 'Withdrawal rejected' });
  } catch { res.status(500).json({ message: 'Server error' }); }
});

// ─── SUPER ─────────────────────────────────────────────────────────────────

router.get('/super/dashboard', apiAuth('superadmin'), async (req, res) => {
  try {
    const [groups, users, activeLoans] = await Promise.all([
      Group.count(),
      User.count({ where: { active: true } }),
      Loan.count({ where: { status: 'active' } }),
    ]);
    res.json({ groups, users, activeLoans });
  } catch { res.status(500).json({ message: 'Server error' }); }
});

router.get('/super/groups', apiAuth('superadmin'), async (req, res) => {
  try {
    const groups = await Group.findAll({ order: [['name', 'ASC']] });
    res.json({ groups });
  } catch { res.status(500).json({ message: 'Server error' }); }
});

router.get('/super/audit', apiAuth('superadmin'), async (req, res) => {
  try {
    const logs = await AuditLog.findAll({
      include: [{ model: User, as: 'user', attributes: ['name'] }],
      order: [['createdAt', 'DESC']], limit: 200
    });
    res.json({ logs });
  } catch { res.status(500).json({ message: 'Server error' }); }
});

router.get('/super/invoices', apiAuth('superadmin'), async (req, res) => {
  try {
    const invoices = await Invoice.findAll({ order: [['createdAt', 'DESC']] });
    res.json({ invoices });
  } catch { res.status(500).json({ message: 'Server error' }); }
});

function getRange(period, year, quarter, month) {
  const y = parseInt(year) || new Date().getFullYear();
  let start, end;
  if (period === "annual") {
    start = new Date(y, 0, 1); end = new Date(y, 11, 31, 23, 59, 59);
  } else if (period === "quarterly") {
    const q = parseInt(quarter) || Math.ceil((new Date().getMonth()+1)/3);
    start = new Date(y, (q-1)*3, 1); end = new Date(y, q*3, 0, 23, 59, 59);
  } else {
    const m = month !== undefined ? parseInt(month) : new Date().getMonth();
    start = new Date(y, m, 1); end = new Date(y, m+1, 0, 23, 59, 59);
  }
  return { start, end };
}
router.get('/admin/reports/full', apiAuth('admin'), async (req, res) => {
  try {
    const gid = req.user.groupId;
    const { period = 'monthly', year, quarter, month } = req.query;
    const y = parseInt(year) || new Date().getFullYear();
    const q = parseInt(quarter) || Math.ceil((new Date().getMonth()+1)/3);
    const m = month !== undefined ? parseInt(month) : new Date().getMonth();
    const { start, end } = getRange(period, y, q, m);
    const dateFilter = { [Op.between]: [start, end] };

    const settings = await GroupSettings.findOne({ where: { groupId: gid } });
    const interestRate = settings ? settings.newLoanInterestRate / 100 : 0.015;

    const allMembers = await User.findAll({
      where: { groupId: gid, role: { [Op.notIn]: ['superadmin'] }, active: true },
      order: [['name', 'ASC']],
    });

    // Period savings
    const periodSavingsRows = await Saving.findAll({ where: { groupId: gid, date: dateFilter, status: { [Op.ne]: 'pending' } } });
    const totalPeriodSavings = periodSavingsRows.reduce((t, s) => t + s.amount, 0);

    // Interest
    const periodRepayments = await Repayment.findAll({ where: { groupId: gid, date: dateFilter } });
    const totalRepaid = periodRepayments.reduce((t, r) => t + r.amount, 0);
    const periodInterest = Math.round(totalRepaid * (interestRate / (1 + interestRate)));
    const activeLoansRaw = await Loan.findAll({ where: { groupId: gid, status: 'active' } });
    const accrualMonths = period === 'annual' ? 12 : period === 'quarterly' ? 3 : 1;
    const accruedInterest = activeLoansRaw.reduce((t, l) =>
      t + Math.round((l.totalRepayable - l.amountRepaid) * interestRate * accrualMonths), 0);
    const periodInterestDisplay = periodInterest > 0 ? periodInterest : accruedInterest;

    // Other income
    const otherIncomePeriod = await OtherIncome.findAll({ where: { groupId: gid, date: dateFilter } });
    const totalOtherIncomePeriod = otherIncomePeriod.reduce((t, i) => t + i.amount, 0);

    // Expenditure
    const expenditures = await Expenditure.findAll({ where: { groupId: gid, date: dateFilter } });
    const totalExpend = expenditures.reduce((t, e) => t + e.amount, 0);

    // Distribution pool
    const method = settings?.interestDistributionMethod || 'share_capital_and_savings';
    const grossPool = periodInterestDisplay + totalOtherIncomePeriod;
    const totalDistributionPool = Math.max(0, grossPool - totalExpend);

    // Member savings balances + distribution weights
    const memberData = await Promise.all(allMembers.map(async mem => {
      const mj = mem.toJSON();
      const allRows = await Saving.findAll({ where: { memberId: mj.id, status: { [Op.ne]: 'pending' } }, attributes: ['amount'] });
      const totalBalance = allRows.reduce((t, s) => t + s.amount, 0);
      const periodAmt = periodSavingsRows.filter(s => s.memberId === mj.id).reduce((t, s) => t + s.amount, 0);
      let weight = 0;
      if (method === 'share_capital_only') weight = mj.shareCapitalPaid || 0;
      else if (method === 'savings_only') weight = totalBalance;
      else weight = (mj.shareCapitalPaid || 0) + totalBalance;
      return { ...mj, totalBalance, periodSavings: periodAmt, weight };
    }));

    const totalWeight = memberData.reduce((t, m) => t + m.weight, 0);
    const distribution = memberData.map(m => ({
      id: m.id, name: m.name, memberId: m.memberId,
      shareCapitalPaid: m.shareCapitalPaid || 0,
      totalBalance: m.totalBalance,
      weight: m.weight,
      sharePct: totalWeight > 0 ? ((m.weight / totalWeight) * 100).toFixed(1) : '0',
      distributionDue: totalWeight > 0 ? Math.round((m.weight / totalWeight) * totalDistributionPool) : 0,
      interestDue: totalWeight > 0 ? Math.round((m.weight / totalWeight) * periodInterestDisplay) : 0,
      otherIncomeDue: totalWeight > 0 ? Math.round((m.weight / totalWeight) * totalOtherIncomePeriod) : 0,
    }));

    // Available balance
    const allExpendsEver = await Expenditure.findAll({ where: { groupId: gid }, attributes: ['amount'] });
    const totalExpendsEver = allExpendsEver.reduce((t, e) => t + e.amount, 0);
    const loanPortfolio = activeLoansRaw.reduce((t, l) => t + (l.totalRepayable - l.amountRepaid), 0);
    const totalShareCapital = allMembers.reduce((t, m) => t + (m.shareCapitalPaid || 0), 0);
    const allSavingsEver = await Saving.findAll({ where: { groupId: gid, status: { [Op.ne]: 'pending' }, type: { [Op.notIn]: ['payout'] } }, attributes: ['amount'] });
    const totalSavingsEver = allSavingsEver.reduce((t, s) => t + s.amount, 0);
    const payoutRows = await Saving.findAll({ where: { groupId: gid, type: 'payout', status: 'confirmed' }, attributes: ['amount'] });
    const totalPayouts = Math.abs(payoutRows.reduce((t, r) => t + r.amount, 0));
    const allLoansEver = await Loan.findAll({ where: { groupId: gid, status: { [Op.in]: ['active', 'repaid'] } }, attributes: ['amount', 'totalRepayable'] });
    const totalInterestEver = allLoansEver.reduce((t, l) => t + Math.max(0, (l.totalRepayable || 0) - (l.amount || 0)), 0);
    const allOtherInc2 = await OtherIncome.findAll({ where: { groupId: gid }, attributes: ['amount'] });
    const totalOtherIncomeBalance = allOtherInc2.reduce((t, i) => t + i.amount, 0);
    const availableBalance = totalSavingsEver + totalShareCapital + totalInterestEver + totalOtherIncomeBalance - totalExpendsEver - loanPortfolio - totalPayouts;

    res.json({
      period, year: y, quarter: q, month: m,
      totalPeriodSavings, periodInterest: periodInterestDisplay,
      totalOtherIncomePeriod, totalExpend, totalDistributionPool,
      availableBalance, method,
      distribution,
    });
  } catch (err) {
    console.error('Reports API error:', err);
    res.status(500).json({ message: err.message });
  }
});

router.post('/admin/reports/distribute', apiAuth('admin'), async (req, res) => {
  try {
    const gid = req.user.groupId;
    const { period, year, quarter, month, description, distribute_type, income_type, custom_amount } = req.body;
    const settings = await GroupSettings.findOne({ where: { groupId: gid } });
    const interestRate = settings ? settings.newLoanInterestRate / 100 : 0.015;

    const { start, end } = getRange(period || 'monthly', year, quarter, month);
    const dateFilter = { [Op.between]: [start, end] };

    const allMembers = await User.findAll({
      where: { groupId: gid, role: { [Op.notIn]: ['superadmin'] }, active: true },
    });

    const memberSavings = await Promise.all(allMembers.map(async m => {
      const mj = m.toJSON();
      const allRows = await Saving.findAll({ where: { memberId: mj.id, status: { [Op.ne]: 'pending' } }, attributes: ['amount'] });
      return { ...mj, totalBalance: allRows.reduce((t, s) => t + s.amount, 0) };
    }));

    const periodRepayments = await Repayment.findAll({ where: { groupId: gid, date: dateFilter } });
    const totalRepaid = periodRepayments.reduce((t, r) => t + r.amount, 0);
    const periodInterest = Math.round(totalRepaid * (interestRate / (1 + interestRate)));
    const activeLoansRaw = await Loan.findAll({ where: { groupId: gid, status: 'active' } });
    const accrualMonths = period === 'annual' ? 12 : period === 'quarterly' ? 3 : 1;
    const accruedInterest = activeLoansRaw.reduce((t, l) =>
      t + Math.round((l.totalRepayable - l.amountRepaid) * interestRate * accrualMonths), 0);
    const periodInterestDisplay = periodInterest > 0 ? periodInterest : accruedInterest;

    const otherIncomes = await OtherIncome.findAll({ where: { groupId: gid, date: dateFilter }, attributes: ['amount'] });
    const totalOtherIncome = otherIncomes.reduce((t, i) => t + i.amount, 0);

    const periodExpenditure = await Expenditure.findAll({ where: { groupId: gid, date: dateFilter }, attributes: ['amount'] });
    const totalPeriodExpend = periodExpenditure.reduce((t, e) => t + e.amount, 0);
    const totalPool = Math.max(0, periodInterestDisplay + totalOtherIncome - totalPeriodExpend);

    let poolToDistribute = totalPool;
    if (income_type === 'interest') poolToDistribute = Math.max(0, periodInterestDisplay);
    else if (income_type === 'other_income') poolToDistribute = Math.max(0, totalOtherIncome);
    else if (custom_amount) poolToDistribute = Math.max(0, parseInt(custom_amount) || 0);

    if (poolToDistribute <= 0)
      return res.status(400).json({ message: 'Nothing to distribute' });

    const method = settings?.interestDistributionMethod || 'share_capital_and_savings';
    const weighted = memberSavings.map(ms => {
      let w = 0;
      if (method === 'share_capital_only') w = ms.shareCapitalPaid || 0;
      else if (method === 'savings_only') w = ms.totalBalance || 0;
      else w = (ms.shareCapitalPaid || 0) + (ms.totalBalance || 0);
      return { ...ms, weight: w };
    });
    const totalWeight = weighted.reduce((t, m) => t + m.weight, 0);
    if (totalWeight <= 0) return res.status(400).json({ message: 'No distribution weight' });

    const isPayout = distribute_type === 'payout';
    const entryType = isPayout ? 'payout' : 'dividend';
    const sourceLabel = income_type === 'interest' ? 'Loan interest' : income_type === 'other_income' ? 'Other income' : 'Income';
    const label = description || (isPayout ? sourceLabel + ' payout' : sourceLabel + ' distribution');

    let posted = 0;
    const results = [];
    for (const ms of weighted) {
      const share = Math.round((ms.weight / totalWeight) * poolToDistribute);
      if (share <= 0) continue;
      await Saving.create({
        memberId: ms.id, groupId: gid,
        amount: isPayout ? -share : share,
        type: entryType, description: label,
        date: new Date(), postedBy: req.user.id, status: 'confirmed',
      });
      results.push({ memberId: ms.id, name: ms.name, share });
      posted++;
    }

    await AuditLog.create({
      userId: req.user.id,
      action: isPayout ? 'INCOME_PAYOUT' : 'INCOME_DISTRIBUTION',
      detail: `${isPayout ? 'Paid out' : 'Distributed'} UGX ${poolToDistribute.toLocaleString()} to ${posted} members (${label})`,
      groupId: gid,
    });

    res.json({ message: `Successfully ${isPayout ? 'paid out' : 'distributed'} UGX ${poolToDistribute.toLocaleString()} to ${posted} members`, results });
  } catch (err) {
    console.error('Distribution error:', err);
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
