const router = require('express').Router();
const { Group, User, Saving, Loan, Repayment, AuditLog } = require('../models');
const { authenticate, requireRole } = require('../middleware/auth');
const { emails } = require('../utils/email');

router.use(authenticate, requireRole('member'));

const getBalance = async (memberId) => {
  const rows = await Saving.findAll({ where: { memberId }, attributes: ['amount'] });
  return rows.reduce((s, r) => s + r.amount, 0);
};

router.get('/dashboard', async (req, res) => {
  try {
    const m     = req.user;
    const group = await Group.findByPk(m.groupId);
    const balance     = await getBalance(m.id);
    const activeLoan  = await Loan.findOne({ where: { memberId: m.id, status: 'active' } });
    const pendingLoan = await Loan.findOne({ where: { memberId: m.id, status: 'pending' } });
    const recentTx    = await Saving.findAll({ where: { memberId: m.id }, order: [['date','DESC']], limit: 5 });
    const shareProgress = Math.round((m.shareCapitalPaid / m.shareCapitalTarget) * 100);
    res.render('member/dashboard', { user: m.toJSON(), group: group.toJSON(), balance, activeLoan: activeLoan?.toJSON()||null, pendingLoan: pendingLoan?.toJSON()||null, recentTx, shareProgress });
  } catch (err) { console.error(err); res.render('error', { message: 'Error', user: req.user }); }
});

router.get('/savings', async (req, res) => {
  try {
    const m     = req.user;
    const group = await Group.findByPk(m.groupId);
    const rows  = await Saving.findAll({ where: { memberId: m.id }, order: [['date','ASC']] });
    let running = 0;
    const transactions = rows.map(t => { running += t.amount; return { ...t.toJSON(), runningBalance: running }; }).reverse();
    const balance = running;
    res.render('member/savings', { user: m.toJSON(), group: group.toJSON(), transactions, balance });
  } catch (err) { console.error(err); res.render('error', { message: 'Error', user: req.user }); }
});

router.get('/loans', async (req, res) => {
  try {
    const m     = req.user;
    const group = await Group.findByPk(m.groupId);
    const balance      = await getBalance(m.id);
    const loans        = await Loan.findAll({ where: { memberId: m.id }, order: [['appliedAt','DESC']] });
    const repayments   = await Repayment.findAll({ where: { memberId: m.id } });
    const eligibleAmount = balance * 3;
    const hasActiveLoan  = loans.some(l => l.status === 'active');
    const hasPendingLoan = loans.some(l => l.status === 'pending');
    res.render('member/loans', { user: m.toJSON(), group: group.toJSON(), loans: loans.map(l=>l.toJSON()), repayments, balance, eligibleAmount, hasActiveLoan, hasPendingLoan, query: req.query });
  } catch (err) { console.error(err); res.render('error', { message: 'Error', user: req.user }); }
});

router.post('/loans/apply', async (req, res) => {
  try {
    const m     = req.user;
    const group = await Group.findByPk(m.groupId);
    const admin = await User.findOne({ where: { groupId: m.groupId, role: 'admin' } });
    const balance = await getBalance(m.id);

    const existing = await Loan.findOne({ where: { memberId: m.id, status: ['pending','active'] } });
    if (existing) return res.redirect('/member/loans?error=existing_loan');

    const amount = parseInt(req.body.amount);
    if (amount > balance * 3) return res.redirect('/member/loans?error=exceeds_limit');

    const loan = await Loan.create({
      memberId: m.id, groupId: m.groupId, amount,
      purpose: req.body.purpose,
      repaymentMonths: parseInt(req.body.repaymentMonths),
      status: 'pending', appliedAt: new Date(),
    });

    await AuditLog.create({ userId: m.id, action: 'LOAN_APPLICATION', detail: `Applied for loan of UGX ${amount.toLocaleString()}`, groupId: m.groupId });
    if (admin) emails.loanRequestToAdmin(admin.toJSON(), m.toJSON(), loan.toJSON(), group.toJSON()).catch(()=>{});
    emails.loanRequestConfirmToMember(m.toJSON(), loan.toJSON(), group.toJSON()).catch(()=>{});
    res.redirect('/member/loans?success=loan_applied');
  } catch (err) { console.error(err); res.redirect('/member/loans?error=apply_failed'); }
});

router.get('/deposit', async (req, res) => {
  try {
    const m     = req.user;
    const group = await Group.findByPk(m.groupId);
    const balance = await getBalance(m.id);
    res.render('member/deposit', { user: m.toJSON(), group: group.toJSON(), balance });
  } catch (err) { console.error(err); res.render('error', { message: 'Error', user: req.user }); }
});

router.post('/deposit', async (req, res) => {
  try {
    const m     = req.user;
    const group = await Group.findByPk(m.groupId);
    const { amount, paymentMethod, description } = req.body;
    const parsedAmount = parseInt(amount);
    const ref = `TXN${Date.now()}`;

    const tx = await Saving.create({
      memberId: m.id, groupId: m.groupId,
      amount: parsedAmount, type: 'online_deposit',
      description: description || `Online deposit via ${paymentMethod}`,
      date: new Date(), postedBy: m.id, paymentMethod, transactionRef: ref,
    });

    await AuditLog.create({ userId: m.id, action: 'ONLINE_DEPOSIT', detail: `Deposited UGX ${parsedAmount.toLocaleString()} via ${paymentMethod}`, groupId: m.groupId });
    const balance = await getBalance(m.id);
    emails.savingsReceiptToMember(m.toJSON(), tx.toJSON(), balance, group.toJSON()).catch(()=>{});
    res.redirect(`/member/savings?success=deposit_confirmed&ref=${ref.slice(-6)}`);
  } catch (err) { console.error(err); res.redirect('/member/deposit?error=deposit_failed'); }
});

router.get('/profile', async (req, res) => {
  try {
    const group = await Group.findByPk(req.user.groupId);
    res.render('member/profile', { user: req.user.toJSON(), group: group.toJSON() });
  } catch (err) { console.error(err); res.render('error', { message: 'Error', user: req.user }); }
});

module.exports = router;
