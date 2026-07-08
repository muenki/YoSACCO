const router = require('express').Router();
const { Op } = require('sequelize');
const { Group, User, Saving, Loan, Repayment, AuditLog, GroupSettings } = require('../models');
const { authenticate, requireRole } = require('../middleware/auth');
const { emails } = require('../utils/email');

router.use(authenticate, requireRole('member','admin','credit_officer','treasurer','chairperson'));

const getBalance = async (memberId) => {
  const rows = await Saving.findAll({ where: { memberId, type: { [Op.ne]: 'share_capital' } }, attributes: ['amount'] });
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
    const rows  = await Saving.findAll({
      where: {
        memberId: m.id,
        // Exclude loan repayment records — those belong in the Loans section
        description: { [require('sequelize').Op.notLike]: '%loan repayment%' },
      },
      order: [['date','ASC']]
    });
    let running = 0;
    const transactions = rows.map(function(t) {
      if ((t.status||'confirmed') === 'confirmed') running += t.amount;
      return { ...t.toJSON(), runningBalance: running };
    }).reverse();
    const pendingAmount = rows.filter(function(t){ return t.status==='pending'; }).reduce(function(s,t){return s+t.amount;},0);
    res.render('member/savings', { user: m.toJSON(), group: group.toJSON(), transactions, balance: running, pendingAmount });
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
    const { Project, ProjectContribution, ProjectPendingContrib, Loan: LoanModel, User: UserModel } = require('../models');
    const projects   = await Project.findAll({ where: { groupId: m.groupId, status: 'active' } });
    const activeLoan = await LoanModel.findOne({ where: { memberId: m.id, status: 'active' } });
    const totalMembers = await UserModel.count({ where: { groupId: m.groupId, active: true, role: { [require('sequelize').Op.notIn]: ['superadmin'] } } });
    // Enrich projects
    const enriched = await Promise.all(projects.map(async p => {
      const allContribs = await ProjectContribution.findAll({ where: { projectId: p.id } });
      const myContribs  = allContribs.filter(c=>c.memberId===m.id);
      const myTotal     = myContribs.reduce((t,c)=>t+c.amount,0);
      const raisedAmount = allContribs.reduce((t,c)=>t+c.amount,0);
      // Per-member equal share = target / total members
      const memberShare = p.targetAmount > 0 && totalMembers > 0 ? Math.ceil(p.targetAmount / totalMembers) : 0;
      const myPending   = await ProjectPendingContrib.findOne({ where: { projectId: p.id, memberId: m.id, status: 'pending' } });
      return { ...p.toJSON(), myTotal, raisedAmount, memberShare, totalMembers, hasPending: !!myPending };
    }));
    res.render('member/deposit', { user: m.toJSON(), group: group.toJSON(), settings, balance, projects: enriched, activeLoan: activeLoan?.toJSON()||null });
  } catch (err) { console.error(err); res.render('error', { message: 'Error', user: req.user }); }
});

router.post('/deposit', async (req, res) => {
  try {
    const m     = req.user;
    const group = await Group.findByPk(m.groupId);
    const settings = await GroupSettings.findOne({ where: { groupId: m.groupId } });
    const { amount, paymentMethod, paymentType, projectId, phone } = req.body;
    const parsedAmount = parseInt(amount);
    const ref  = `TXN${Date.now()}`;

    // ── PESAPAL ONLINE PAYMENT (MTN MoMo, Airtel, Visa) ──────────
    const onlineMethods = ['MTN MoMo', 'Airtel Money', 'Visa / Mastercard'];
    if (onlineMethods.includes(paymentMethod) && settings?.pesapalConsumerKey && settings?.pesapalConsumerSecret) {
      try {
        // Temporarily use group-specific PesaPal credentials
        const originalKey    = process.env.PESAPAL_CONSUMER_KEY;
        const originalSecret = process.env.PESAPAL_CONSUMER_SECRET;
        process.env.PESAPAL_CONSUMER_KEY    = settings.pesapalConsumerKey;
        process.env.PESAPAL_CONSUMER_SECRET = settings.pesapalConsumerSecret;

        const { getToken, registerIPN, submitOrder } = require('../utils/pesapal');
        const token = await getToken();
        let ipnId = process.env.PESAPAL_IPN_ID;
        if (!ipnId) { ipnId = await registerIPN(token); }

        const reference = `${group.id.slice(0,8)}-${m.id.slice(0,8)}-${Date.now()}`;
        const nameParts = m.name.split(' ');
        const typeLabels = { monthly_contribution: 'Monthly Contribution', share_capital: 'Share Capital', loan_repayment: 'Loan Repayment', annual_subscription: 'Annual Subscription', extra_savings: 'Extra Savings', project_contribution: 'Project Contribution' };
        const callbackUrl = `${process.env.APP_URL}/member/deposit/callback?ref=${reference}&groupId=${group.id}&memberId=${m.id}&type=${paymentType}&projectId=${projectId||''}`;

        const order = await submitOrder({
          token, ipnId,
          amount: parsedAmount,
          currency: 'UGX',
          description: `${typeLabels[paymentType]||'Payment'} — ${group.name}`,
          reference,
          email: m.email,
          phone: phone || m.phone,
          firstName: nameParts[0],
          lastName: nameParts.slice(1).join(' ') || nameParts[0],
          callbackUrl,
        });

        // Restore original env
        process.env.PESAPAL_CONSUMER_KEY    = originalKey;
        process.env.PESAPAL_CONSUMER_SECRET = originalSecret;

        if (order.redirect_url) return res.redirect(order.redirect_url);
      } catch(pesapalErr) {
        console.error('PesaPal error:', pesapalErr.response?.data || pesapalErr.message);
        // Fall through to manual pending deposit if PesaPal fails
      }
    }

    // ── PROJECT CONTRIBUTION — goes to project, NOT savings ───────
    if (paymentType === 'project_contribution') {
      if (!projectId) return res.redirect('/member/deposit?error=select_project');
      const { Project, ProjectPendingContrib } = require('../models');
      const project = await Project.findOne({ where: { id: projectId, groupId: m.groupId } });
      if (!project) return res.redirect('/member/deposit?error=project_not_found');
      await ProjectPendingContrib.create({
        projectId, memberId: m.id, groupId: m.groupId,
        amount: parsedAmount, paymentMethod, transactionRef: ref,
        status: 'pending', date: new Date(),
      });
      await AuditLog.create({ userId: m.id, action: 'PROJECT_CONTRIB_INTENT', detail: `Project contribution intent UGX ${parsedAmount.toLocaleString()} to ${project.name} via ${paymentMethod}`, groupId: m.groupId });
      return res.redirect(`/member/projects?success=contrib_pending&project=${encodeURIComponent(project.name)}&amount=${parsedAmount}`);
    }

    // ── LOAN REPAYMENT — pending saving flagged as loan repayment ─
    if (paymentType === 'loan_repayment') {
      await Saving.create({
        memberId: m.id, groupId: m.groupId, amount: parsedAmount,
        type: 'online_deposit',
        description: `Loan repayment via ${paymentMethod}`,
        date: new Date(), postedBy: m.id, paymentMethod, transactionRef: ref, status: 'pending',
      });
      await AuditLog.create({ userId: m.id, action: 'LOAN_REPAYMENT_INTENT', detail: `Loan repayment intent UGX ${parsedAmount.toLocaleString()} via ${paymentMethod}`, groupId: m.groupId });
      return res.redirect(`/member/loans?success=repayment_pending&ref=${ref.slice(-6)}&amount=${parsedAmount}`);
    }

    // ── ALL OTHER TYPES — go to savings (pending) ─────────────────
    const typeMap = {
      monthly_contribution: { type: 'contribution',   desc: `Monthly contribution via ${paymentMethod}` },
      annual_subscription:  { type: 'contribution',   desc: `Annual subscription via ${paymentMethod}` },
      share_capital:        { type: 'share_capital',  desc: `Share capital payment via ${paymentMethod}` },
      extra_savings:        { type: 'online_deposit', desc: `Extra savings deposit via ${paymentMethod}` },
    };
    const mapped = typeMap[paymentType] || { type: 'online_deposit', desc: `Online deposit via ${paymentMethod}` };

    const tx = await Saving.create({
      memberId: m.id, groupId: m.groupId, amount: parsedAmount,
      type: mapped.type, description: mapped.desc,
      date: new Date(), postedBy: m.id, paymentMethod, transactionRef: ref, status: 'pending',
    });
    await AuditLog.create({ userId: m.id, action: 'ONLINE_DEPOSIT', detail: `Deposit intent UGX ${parsedAmount.toLocaleString()} — ${mapped.desc}`, groupId: m.groupId });
    const balance = await getBalance(m.id);
    emails.savingsReceiptToMember(m.toJSON(), tx.toJSON(), balance, group.toJSON()).catch(()=>{});
    return res.redirect(`/member/savings?success=deposit_pending&ref=${ref.slice(-6)}&method=${encodeURIComponent(paymentMethod)}&amount=${parsedAmount}`);
  } catch (err) { console.error('Deposit error:', err); res.redirect('/member/deposit?error=deposit_failed'); }
});


// ── PesaPal Payment Callback ──────────────────────────────────────
router.get('/deposit/callback', authenticate, async (req, res) => {
  try {
    const { orderTrackingId, groupId, memberId, type, projectId } = req.query;
    const { getToken, getTransactionStatus } = require('../utils/pesapal');
    const settings = await GroupSettings.findOne({ where: { groupId } });

    // Use group-specific credentials
    if (settings?.pesapalConsumerKey) {
      process.env.PESAPAL_CONSUMER_KEY    = settings.pesapalConsumerKey;
      process.env.PESAPAL_CONSUMER_SECRET = settings.pesapalConsumerSecret;
    }

    const token  = await getToken();
    const status = await getTransactionStatus(token, orderTrackingId);

    if (status.payment_status_description === 'Completed') {
      const member = await User.findByPk(memberId);
      const group  = await Group.findByPk(groupId);
      const amount = Math.round(parseFloat(status.amount));

      // ── Project contribution ──
      if (type === 'project_contribution' && projectId) {
        const { Project, ProjectContribution } = require('../models');
        const project = await Project.findByPk(projectId);
        if (project) {
          await ProjectContribution.create({ projectId, memberId, groupId, amount, date: new Date(), postedBy: memberId, notes: `Online payment via ${status.payment_method}` });
          project.raisedAmount = (project.raisedAmount||0) + amount;
          await project.save();
        }
        await AuditLog.create({ userId: memberId, action: 'ONLINE_PAYMENT', detail: `Online project contribution UGX ${amount.toLocaleString()}`, groupId });
        return res.redirect('/member/projects?success=payment_received');
      }

      // ── Loan repayment ──
      if (type === 'loan_repayment') {
        const activeLoan = await Loan.findOne({ where: { memberId, status: 'active' }, order: [['disbursedAt','DESC']] });
        if (activeLoan) {
          const repayment = await Repayment.create({ loanId: activeLoan.id, memberId, groupId, amount, date: new Date(), postedBy: memberId });
          activeLoan.amountRepaid = (activeLoan.amountRepaid||0) + amount;
          const remaining = Math.max(0, activeLoan.totalRepayable - activeLoan.amountRepaid);
          if (remaining === 0) activeLoan.status = 'repaid';
          await activeLoan.save();
          emails.loanRepaymentReceipt(member.toJSON(), repayment.toJSON(), remaining, group.toJSON()).catch(()=>{});
        }
        await AuditLog.create({ userId: memberId, action: 'ONLINE_PAYMENT', detail: `Online loan repayment UGX ${amount.toLocaleString()}`, groupId });
        return res.redirect('/member/loans?success=payment_received');
      }

      // ── Savings / share capital ──
      const typeMap = {
        monthly_contribution: { type: 'contribution',  desc: `Monthly contribution via ${status.payment_method||'online'}` },
        annual_subscription:  { type: 'contribution',  desc: `Annual subscription via ${status.payment_method||'online'}` },
        share_capital:        { type: 'share_capital', desc: `Share capital via ${status.payment_method||'online'}` },
        extra_savings:        { type: 'online_deposit',desc: `Extra savings via ${status.payment_method||'online'}` },
      };
      const mapped = typeMap[type] || { type: 'online_deposit', desc: `Online payment via ${status.payment_method||'online'}` };

      const tx = await Saving.create({
        memberId, groupId, amount,
        type: mapped.type, description: mapped.desc,
        date: new Date(), postedBy: memberId, status: 'confirmed',
      });

      if (type === 'share_capital') {
        member.shareCapitalPaid = (member.shareCapitalPaid||0) + amount;
        await member.save();
      }

      await AuditLog.create({ userId: memberId, action: 'ONLINE_PAYMENT', detail: `Online payment UGX ${amount.toLocaleString()} via ${status.payment_method||'PesaPal'}`, groupId });
      const balance = await getBalance(memberId);
      emails.savingsReceiptToMember(member.toJSON(), tx.toJSON(), balance, group.toJSON()).catch(()=>{});
      return res.redirect('/member/savings?success=payment_received');
    }

    // Payment not completed
    res.redirect('/member/deposit?error=payment_incomplete');
  } catch(err) {
    console.error('Deposit callback error:', err);
    res.redirect('/member/deposit?error=callback_failed');
  }
});


// ── Request Loan Extension ────────────────────────────────────────
router.post('/loans/:id/request-extension', authenticate, async (req, res) => {
  try {
    const loan = await Loan.findOne({ where: { id: req.params.id, memberId: req.user.id, status: 'active' } });
    if (!loan) return res.redirect('/member/loans?error=loan_not_found');
    if (loan.extensionRequested && loan.extensionStatus === 'pending') {
      return res.redirect('/member/loans?error=extension_already_pending');
    }
    const { extensionMonths, reason } = req.body;
    const months = parseInt(extensionMonths);
    if (!months || months < 1 || months > 24) return res.redirect('/member/loans?error=invalid_months');

    await loan.update({
      extensionRequested: true,
      extensionMonths: months,
      extensionReason: reason || '',
      extensionStatus: 'pending',
      extensionRequestedAt: new Date(),
      originalMonths: loan.originalMonths || loan.repaymentMonths,
    });

    await AuditLog.create({ userId: req.user.id, action: 'LOAN_EXTENSION_REQUEST', detail: `Requested ${months} month extension for loan`, groupId: req.user.groupId });

    // Notify admin via email
    const { User, Group } = require('../models');
    const group = await Group.findByPk(req.user.groupId);
    const admins = await User.findAll({ where: { groupId: req.user.groupId, role: 'admin' } });
    const { sendEmail } = require('../utils/email');
    for (const admin of admins) {
      sendEmail({
        to: admin.email,
        subject: `Loan Extension Request — ${req.user.name} — ${months} months — ${group.name}`,
        html: `<p>Dear ${admin.name},</p>
        <p>${req.user.name} (${req.user.memberId}) has requested a <strong>${months}-month extension</strong> on their active loan.</p>
        <p><strong>Reason:</strong> ${reason || 'Not provided'}</p>
        <p><strong>Outstanding balance:</strong> UGX ${(loan.totalRepayable - loan.amountRepaid).toLocaleString()}</p>
        <p><strong>Current monthly installment:</strong> UGX ${loan.monthlyInstallment.toLocaleString()}</p>
        <p>Please log in to review and approve or reject this request.</p>`,
      }).catch(() => {});
    }

    res.redirect('/member/loans?success=extension_requested');
  } catch(err) { console.error('Extension request error:', err); res.redirect('/member/loans?error=extension_failed'); }
});

router.get('/profile', async (req, res) => {
  try {
    const group = await Group.findByPk(req.user.groupId);
    res.render('member/profile', { user: req.user.toJSON(), group: group.toJSON() });
  } catch (err) { console.error(err); res.render('error', { message: 'Error', user: req.user }); }
});

router.get('/projects', async (req, res) => {
  try {
    const m     = req.user;
    const group = await Group.findByPk(m.groupId);
    const { Project, ProjectContribution, ProjectPendingContrib, User: UserModel } = require('../models');
    const { Op } = require('sequelize');

    const totalMembers = await UserModel.count({ where: { groupId: m.groupId, active: true, role: { [Op.notIn]: ['superadmin'] } } });
    const rawProjects  = await Project.findAll({ where: { groupId: m.groupId }, order: [['createdAt','DESC']] });

    const projects = await Promise.all(rawProjects.map(async function(p) {
      const allContribs    = await ProjectContribution.findAll({ where: { projectId: p.id } });
      const raisedAmount   = allContribs.reduce(function(t,c){return t+c.amount;},0);
      const contributorCount = [...new Set(allContribs.map(function(c){return c.memberId;}))].length;
      const myHistory      = await ProjectContribution.findAll({ where: { projectId: p.id, memberId: m.id }, order: [['date','ASC']] });
      const myContributions = myHistory.reduce(function(t,c){return t+c.amount;},0);
      const memberShare    = p.targetAmount > 0 && totalMembers > 0 ? Math.ceil(p.targetAmount / totalMembers) : 0;
      const myPending      = await ProjectPendingContrib.findAll({ where: { projectId: p.id, memberId: m.id, status: 'pending' } });
      const myPendingTotal = myPending.reduce(function(t,c){return t+c.amount;},0);
      return { ...p.toJSON(), raisedAmount, contributorCount, myContributions, myPendingTotal, memberShare, totalMembers, myHistory: myHistory.map(function(c){return c.toJSON();}) };
    }));

    const myTotalContributions = projects.reduce(function(t,p){return t+p.myContributions;},0);
    res.render('member/projects', { user: m.toJSON(), group: group.toJSON(), projects, myTotalContributions, query: req.query });
  } catch(err) { console.error(err); res.render('error', { message: 'Error loading projects', user: req.user }); }
});


// ── Savings Withdrawal ────────────────────────────────────────────
router.get('/withdrawal', async (req, res) => {
  try {
    const m = req.user;
    const { SavingsWithdrawal, Loan: LoanModel } = require('../models');
    const group = await Group.findByPk(m.groupId);
    const balance = await getBalance(m.id);
    const activeLoan = await LoanModel.findOne({ where: { memberId: m.id, status: 'active' } });
    const withdrawals = await SavingsWithdrawal.findAll({ where: { memberId: m.id }, order: [['appliedAt','DESC']] });
    res.render('member/withdrawal', { user: m.toJSON(), group: group.toJSON(), balance, activeLoan: activeLoan?.toJSON()||null, withdrawals: withdrawals.map(w=>w.toJSON()), query: req.query });
  } catch(err) { console.error(err); res.render('error', { message: 'Error', user: req.user }); }
});

router.post('/withdrawal', async (req, res) => {
  try {
    const m = req.user;
    const { SavingsWithdrawal, Loan: LoanModel } = require('../models');
    // Cannot withdraw if active loan
    const activeLoan = await LoanModel.findOne({ where: { memberId: m.id, status: 'active' } });
    if (activeLoan) return res.redirect('/member/withdrawal?error=has_active_loan');
    const balance = await getBalance(m.id);
    const amount = parseInt(req.body.amount);
    if (!amount || amount <= 0) return res.redirect('/member/withdrawal?error=invalid_amount');
    if (amount > balance) return res.redirect('/member/withdrawal?error=insufficient_balance');
    await SavingsWithdrawal.create({ memberId: m.id, groupId: m.groupId, amount, reason: req.body.reason||'', appliedAt: new Date() });
    await AuditLog.create({ userId: m.id, action: 'WITHDRAWAL_REQUEST', detail: 'Savings withdrawal request UGX ' + amount.toLocaleString(), groupId: m.groupId });
    res.redirect('/member/withdrawal?success=submitted');
  } catch(err) { console.error(err); res.redirect('/member/withdrawal?error=failed'); }
});

router.post('/change-password', async (req, res) => {
  try {
    const bcrypt = require('bcryptjs');
    const { currentPassword, newPassword, confirmPassword } = req.body;
    const user = await User.findByPk(req.user.id);
    if (!bcrypt.compareSync(currentPassword, user.password))
      return res.redirect('/member/profile?pwd_error=Current+password+is+incorrect');
    if (!newPassword || newPassword.length < 8)
      return res.redirect('/member/profile?pwd_error=Password+must+be+at+least+8+characters');
    if (newPassword !== confirmPassword)
      return res.redirect('/member/profile?pwd_error=Passwords+do+not+match');
    const bcrypt2 = require('bcryptjs');
    user.password = bcrypt2.hashSync(newPassword, 10);
    user.mustChangePassword = false;
    await user.save();
    res.redirect('/member/profile?pwd_success=1');
  } catch(err) { console.error(err); res.redirect('/member/profile?pwd_error=Error+occurred'); }
});
module.exports = router;
