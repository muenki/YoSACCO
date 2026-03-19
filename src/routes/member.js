const router = require('express').Router();
const db = require('../database');
const { authenticate, requireRole } = require('../middleware/auth');
const { emails } = require('../utils/email');

router.use(authenticate, requireRole('member'));

// ── Dashboard ─────────────────────────────────────────────────────
router.get('/dashboard', (req, res) => {
  const m = req.user;
  const group = db.groups.find(g => g.id === m.groupId);
  const balance = db.getSavingsBalance(m.id);
  const activeLoan = db.getActiveLoan(m.id);
  const recentTx = db.savings.filter(s => s.memberId === m.id).sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 5);
  const pendingLoan = db.loans.find(l => l.memberId === m.id && l.status === 'pending');
  const shareProgress = Math.round((m.shareCapitalPaid / m.shareCapitalTarget) * 100);
  res.render('member/dashboard', { user: m, group, balance, activeLoan, recentTx, pendingLoan, shareProgress });
});

// ── Savings Statement ─────────────────────────────────────────────
router.get('/savings', (req, res) => {
  const m = req.user;
  const group = db.groups.find(g => g.id === m.groupId);
  const transactions = db.savings.filter(s => s.memberId === m.id).sort((a, b) => new Date(b.date) - new Date(a.date));
  let running = 0;
  const withBalance = [...transactions].reverse().map(t => { running += t.amount; return { ...t, runningBalance: running }; }).reverse();
  const balance = db.getSavingsBalance(m.id);
  res.render('member/savings', { user: m, group, transactions: withBalance, balance });
});

// ── Loans ─────────────────────────────────────────────────────────
router.get('/loans', (req, res) => {
  const m = req.user;
  const group = db.groups.find(g => g.id === m.groupId);
  const balance = db.getSavingsBalance(m.id);
  const loans = db.loans.filter(l => l.memberId === m.id).sort((a, b) => new Date(b.appliedAt) - new Date(a.appliedAt));
  const repayments = db.repayments.filter(r => r.memberId === m.id);
  const eligibleAmount = balance * 3;
  const hasActiveLoan = loans.some(l => l.status === 'active');
  const hasPendingLoan = loans.some(l => l.status === 'pending');
  res.render('member/loans', { user: m, group, loans, repayments, balance, eligibleAmount, hasActiveLoan, hasPendingLoan });
});

router.post('/loans/apply', async (req, res) => {
  const m = req.user;
  const group = db.groups.find(g => g.id === m.groupId);
  const admin = db.users.find(u => u.role === 'admin' && u.groupId === m.groupId);
  const balance = db.getSavingsBalance(m.id);

  if (db.loans.find(l => l.memberId === m.id && (l.status === 'pending' || l.status === 'active'))) {
    return res.redirect('/member/loans?error=existing_loan');
  }

  const amount = parseInt(req.body.amount);
  if (amount > balance * 3) return res.redirect('/member/loans?error=exceeds_limit');

  const loan = {
    id: db.nextId('loan'), memberId: m.id, groupId: m.groupId,
    amount, purpose: req.body.purpose,
    repaymentMonths: parseInt(req.body.repaymentMonths),
    monthlyInstallment: 0, totalRepayable: 0, amountRepaid: 0,
    status: 'pending', appliedAt: new Date(),
    approvedAt: null, approvedBy: null, disbursedAt: null, notes: '',
  };
  db.loans.push(loan);
  db.log(m.id, 'LOAN_APPLICATION', `Applied for loan of UGX ${amount.toLocaleString()}`, m.groupId);

  if (admin) emails.loanRequestToAdmin(admin, m, loan, group).catch(() => {});
  emails.loanRequestConfirmToMember(m, loan, group).catch(() => {});

  res.redirect('/member/loans?success=loan_applied');
});

// ── Deposit (Simulated) ───────────────────────────────────────────
router.get('/deposit', (req, res) => {
  const m = req.user;
  const group = db.groups.find(g => g.id === m.groupId);
  const balance = db.getSavingsBalance(m.id);
  res.render('member/deposit', { user: m, group, balance });
});

router.post('/deposit', async (req, res) => {
  const m = req.user;
  const group = db.groups.find(g => g.id === m.groupId);
  const { amount, paymentMethod, description } = req.body;
  const parsedAmount = parseInt(amount);

  // Simulate payment gateway success
  const tx = {
    id: db.nextId('sav'), memberId: m.id, groupId: m.groupId,
    amount: parsedAmount, type: 'online_deposit',
    description: description || `Online deposit via ${paymentMethod}`,
    date: new Date(), postedBy: m.id,
    paymentMethod, transactionRef: `TXN${Date.now()}`,
  };
  db.savings.push(tx);
  db.log(m.id, 'ONLINE_DEPOSIT', `Deposited UGX ${parsedAmount.toLocaleString()} via ${paymentMethod}`, m.groupId);

  const balance = db.getSavingsBalance(m.id);
  emails.savingsReceiptToMember(m, tx, balance, group).catch(() => {});

  res.redirect('/member/savings?success=deposit_confirmed&ref=' + tx.transactionRef.slice(-6));
});

// ── Profile ───────────────────────────────────────────────────────
router.get('/profile', (req, res) => {
  const group = db.groups.find(g => g.id === req.user.groupId);
  res.render('member/profile', { user: req.user, group });
});

module.exports = router;
