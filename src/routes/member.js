const router = require('express').Router();
const { Group, User, Saving, Loan, Repayment, AuditLog, GroupSettings } = require('../models');
const { authenticate, requireRole } = require('../middleware/auth');
const { emails } = require('../utils/email');

router.use(authenticate, requireRole('member','credit_officer','treasurer','chairperson'));

const getBalance = async (memberId) => {
  const rows = await Saving.findAll({ where: { memberId }, attributes: ['amount'] });
  return rows.reduce((s, r) => s + r.amount, 0);
};

const getSettings = async (groupId) => {
  let s = await GroupSettings.findOne({ where: { groupId } });
  if (!s) s = await GroupSettings.create({ groupId });
  return s.toJSON();
};

router.get('/dashboard', async (req, res) => {
  try {
    const m     = req.user;
    const group = await Group.findByPk(m.groupId);
    const balance     = await getBalance(m.id);
    const activeLoan  = await Loan.findOne({ where: { memberId: m.id, status: 'active' } });
    const pendingLoan = await Loan.findOne({ where: { memberId: m.id, status: ['pending','under_review','approved'] } });
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
    res.render('member/savings', { user: m.toJSON(), group: group.toJSON(), transactions, balance: running });
  } catch (err) { console.error(err); res.render('error', { message: 'Error', user: req.user }); }
});

router.get('/loans', async (req, res) => {
  try {
    const m        = req.user;
    const group    = await Group.findByPk(m.groupId);
    const settings = await getSettings(m.groupId);
    const balance       = await getBalance(m.id);
    const loans         = await Loan.findAll({ where: { memberId: m.id }, order: [['appliedAt','DESC']] });
    const repayments    = await Repayment.findAll({ where: { memberId: m.id } });
    const eligibleAmount= balance * (settings.newLoanMaxMultiplier || 3);
    const activeLoan    = loans.find(l => l.status === 'active');
    const hasActiveLoan = !!activeLoan;
    const hasPendingLoan= loans.some(l => ['pending','under_review','approved'].includes(l.status));

    const enriched = await Promise.all(loans.map(async l => {
      const co = l.creditOfficerId ? await User.findByPk(l.creditOfficerId, { attributes: ['name'] }) : null;
      const tr = l.treasurerId     ? await User.findByPk(l.treasurerId,     { attributes: ['name'] }) : null;
      const ch = l.chairpersonId   ? await User.findByPk(l.chairpersonId,   { attributes: ['name'] }) : null;
      return { ...l.toJSON(), coUser: co?.name||null, trUser: tr?.name||null, chUser: ch?.name||null };
    }));

    res.render('member/loans', { user: m.toJSON(), group: group.toJSON(), settings, loans: enriched, repayments, balance, eligibleAmount, hasActiveLoan, hasPendingLoan, activeLoan: activeLoan?.toJSON()||null, query: req.query });
  } catch (err) { console.error(err); res.render('error', { message: 'Error', user: req.user }); }
});

router.post('/loans/apply', async (req, res) => {
  try {
    const m        = req.user;
    const group    = await Group.findByPk(m.groupId);
    const settings = await getSettings(m.groupId);
    const admin         = await User.findOne({ where: { groupId: m.groupId, role: 'admin' } });
    const creditOfficer = await User.findOne({ where: { groupId: m.groupId, role: 'credit_officer' } });
    const balance = await getBalance(m.id);
    const { loanType, amount, purpose, repaymentMonths } = req.body;
    const parsedAmount = parseInt(amount);

    const inProgress = await Loan.findOne({ where: { memberId: m.id, status: ['pending','under_review','approved'] } });
    if (inProgress) return res.redirect('/member/loans?error=existing_pending');

    const activeLoan = await Loan.findOne({ where: { memberId: m.id, status: 'active' } });
    if (loanType !== 'top_up' && activeLoan) return res.redirect('/member/loans?error=existing_loan');
    if (loanType === 'top_up' && !activeLoan) return res.redirect('/member/loans?error=no_active_loan_for_topup');

    const multiplier = loanType === 'emergency' ? (settings.emergencyMaxMultiplier||1) : (settings.newLoanMaxMultiplier||3);
    if (parsedAmount > balance * multiplier) return res.redirect('/member/loans?error=exceeds_limit');

    const loan = await Loan.create({
      memberId: m.id, groupId: m.groupId, loanType: loanType||'new_loan',
      amount: parsedAmount, purpose, repaymentMonths: parseInt(repaymentMonths),
      status: 'pending', appliedAt: new Date(),
      parentLoanId: loanType==='top_up' && activeLoan ? activeLoan.id : null,
    });

    await AuditLog.create({ userId: m.id, action: 'LOAN_APPLICATION', detail: `Applied for ${loanType} of UGX ${parsedAmount.toLocaleString()}`, groupId: m.groupId });
    const notifyUser = creditOfficer || admin;
    if (notifyUser) emails.loanRequestToAdmin(notifyUser.toJSON(), m.toJSON(), loan.toJSON(), group.toJSON()).catch(()=>{});
    emails.loanRequestConfirmToMember(m.toJSON(), loan.toJSON(), group.toJSON()).catch(()=>{});
    res.redirect('/member/loans?success=loan_applied');
  } catch (err) { console.error(err); res.redirect('/member/loans?error=apply_failed'); }
});

router.get('/deposit', async (req, res) => {
  try {
    const m        = req.user;
    const group    = await Group.findByPk(m.groupId);
    const settings = await getSettings(m.groupId);
    const balance  = await getBalance(m.id);
    res.render('member/deposit', { user: m.toJSON(), group: group.toJSON(), settings, balance });
  } catch (err) { console.error(err); res.render('error', { message: 'Error', user: req.user }); }
});

router.post('/deposit', async (req, res) => {
  try {
    const m     = req.user;
    const group = await Group.findByPk(m.groupId);
    const { amount, paymentMethod, description } = req.body;
    const parsedAmount = parseInt(amount);
    const ref  = `TXN${Date.now()}`;
    const tx   = await Saving.create({ memberId: m.id, groupId: m.groupId, amount: parsedAmount, type: 'online_deposit', description: description||`Online deposit via ${paymentMethod}`, date: new Date(), postedBy: m.id, paymentMethod, transactionRef: ref });
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
