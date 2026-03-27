const router  = require('express').Router();
const bcrypt  = require('bcryptjs');
const { Op }  = require('sequelize');
const { Group, User, Saving, Loan, Repayment, AuditLog } = require('../models');
const { authenticate, requireRole } = require('../middleware/auth');
const { emails } = require('../utils/email');

router.use(authenticate, requireRole('admin', 'superadmin'));

const getBalance = async (memberId) => {
  // Exclude pending and loan repayment records — repayments go to Repayment table only
  const rows = await Saving.findAll({
    where: {
      memberId,
      status: { [Op.ne]: 'pending' },
      description: { [Op.notLike]: '%loan repayment%' },
    },
    attributes: ['amount']
  });
  return rows.reduce((s, r) => s + r.amount, 0);
};

// ── Dashboard ─────────────────────────────────────────────────────
router.get('/dashboard', async (req, res) => {
  try {
    const gid   = req.user.groupId;
    const group = await Group.findByPk(gid);

    const memberCount   = await User.count({ where: { groupId: gid, role: { [Op.notIn]: ['superadmin'] } } });
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

    const members = await User.findAll({ where: { groupId: gid, role: { [Op.notIn]: ['superadmin'] } } });

    // Build chart data
    const allGroupSavings = await Saving.findAll({ where: { groupId: gid, type: 'contribution' }, order: [['date','ASC']] });
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const mSums = Array(12).fill(0);
    allGroupSavings.forEach(s => { const m = new Date(s.date).getMonth(); mSums[m] += s.amount; });
    const qSums = [mSums.slice(0,3).reduce((a,b)=>a+b,0), mSums.slice(3,6).reduce((a,b)=>a+b,0), mSums.slice(6,9).reduce((a,b)=>a+b,0), mSums.slice(9,12).reduce((a,b)=>a+b,0)];
    const annualTotal = mSums.reduce((a,b)=>a+b,0);
    const allLoansForChart = await Loan.findAll({ where: { groupId: gid } });
    const loanChartData = { repaid: allLoansForChart.filter(l=>l.status==='repaid').reduce((s,l)=>s+l.totalRepayable,0), active: allLoansForChart.filter(l=>l.status==='active').reduce((s,l)=>s+(l.totalRepayable-l.amountRepaid),0), pending: allLoansForChart.filter(l=>['pending','under_review','approved'].includes(l.status)).reduce((s,l)=>s+l.amount,0) };
    const chartData = { savings: { monthly: { labels: months, values: mSums }, quarterly: { labels: ['Q1','Q2','Q3','Q4'], values: qSums }, annual: { labels: [new Date().getFullYear().toString()], values: [annualTotal] } }, loans: loanChartData };

    const pendingDepositCount = await Saving.count({ where: { groupId: gid, status: 'pending' } });

    res.render('admin/dashboard', {
      user: req.user, group,
      stats: { memberCount, totalSavings, activeLoans, loanPortfolio, pendingLoans: pendingLoans.length },
      pendingLoans: pendingLoansWithMember,
      recentSavings: recentSavingsWithMember,
      members: members.map(m => m.toJSON()),
      chartData,
      pendingDepositCount,
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
    const rawMembers = await User.findAll({ where: { groupId: gid, role: { [Op.notIn]: ['superadmin'] } }, order: [['name','ASC']] });
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
    const count    = await User.count({ where: { groupId: gid } });
    const prefix   = group.name.replace(/[^A-Za-z]/g,'').slice(0,3).toUpperCase();
    const memberId = `${prefix}-${String(count + 1).padStart(4,'0')}`;
    const tempPass = `Yosacco@${Math.floor(1000 + Math.random() * 9000)}`;
    const newMember = await User.create({
      name, email: email.toLowerCase(), phone, nationalId,
      password: bcrypt.hashSync(tempPass, 10),
      role: req.body.role || 'member', groupId: gid, memberId,
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
    const member = await User.findOne({ where: { id: req.params.id, groupId: gid } });
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

router.post('/members/:id/edit', async (req, res) => {
  try {
    const gid = req.user.groupId;
    const m   = await User.findOne({ where: { id: req.params.id, groupId: gid } });
    if (!m) return res.redirect('/admin/members?error=not_found');
    const { name, email, phone, nationalId, role, monthlyContribution, shareCapitalTarget, shareCapitalPaid } = req.body;
    await m.update({ name, email: email.toLowerCase(), phone, nationalId, role: role||m.role, monthlyContribution: parseInt(monthlyContribution)||m.monthlyContribution, shareCapitalTarget: parseInt(shareCapitalTarget)||m.shareCapitalTarget, shareCapitalPaid: parseInt(shareCapitalPaid)||m.shareCapitalPaid });
    await AuditLog.create({ userId: req.user.id, action: 'EDIT_MEMBER', detail: `Updated member: ${name}`, groupId: gid });
    res.redirect('/admin/members?success=member_updated');
  } catch (err) { console.error(err); res.redirect('/admin/members?error=edit_failed'); }
});

// ── Savings ───────────────────────────────────────────────────────
router.get('/savings', async (req, res) => {
  try {
    const gid   = req.user.groupId;
    const group = await Group.findByPk(gid);
    const rawMembers = await User.findAll({ where: { groupId: gid, role: { [Op.notIn]: ['superadmin'] } }, order: [['name','ASC']] });
    const members = await Promise.all(rawMembers.map(async m => {
      const balance    = await getBalance(m.id);
      const lastContrib   = await Saving.findOne({ where: { memberId: m.id, type: 'contribution' }, order: [['date','DESC']] });
      const transactions  = await Saving.findAll({ where: { memberId: m.id }, order: [['date','ASC']] });
      return { ...m.toJSON(), balance, lastContrib: lastContrib?.toJSON() || null, transactions: transactions.map(function(t){return t.toJSON();}) };
    }));
    const pendingDeposits = await Saving.findAll({
      where: { groupId: gid, status: 'pending' },
      order: [['date','DESC']],
    });
    const pendingWithMember = await Promise.all(pendingDeposits.map(async s => ({
      ...s.toJSON(), member: (await User.findByPk(s.memberId))?.toJSON()||null
    })));
    res.render('admin/savings', { user: req.user, group, members, pendingDeposits: pendingWithMember, query: req.query });
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


// ── Confirm pending deposit ───────────────────────────────────────
router.post('/savings/:id/confirm', async (req, res) => {
  try {
    const gid   = req.user.groupId;
    const group = await Group.findByPk(gid);
    const tx    = await Saving.findOne({ where: { id: req.params.id, groupId: gid, status: 'pending' } });
    if (!tx) return res.redirect('/admin/savings?error=not_found');
    const member = await User.findByPk(tx.memberId);

    // ── If it's a loan repayment — REMOVE from savings, record in Repayments only ──
    if (tx.description && tx.description.toLowerCase().includes('loan repayment')) {
      const activeLoan = await Loan.findOne({ where: { memberId: tx.memberId, status: 'active' }, order: [['disbursedAt','DESC']] });
      if (activeLoan) {
        activeLoan.amountRepaid = (activeLoan.amountRepaid||0) + tx.amount;
        const remaining = Math.max(0, activeLoan.totalRepayable - activeLoan.amountRepaid);
        if (remaining === 0) activeLoan.status = 'repaid';
        await activeLoan.save();
        const { Repayment } = require('../models');
        await Repayment.create({ loanId: activeLoan.id, memberId: tx.memberId, groupId: gid, amount: tx.amount, date: new Date(), postedBy: req.user.id });
        await AuditLog.create({ userId: req.user.id, action: 'CONFIRM_LOAN_REPAYMENT', detail: `Confirmed loan repayment UGX ${tx.amount.toLocaleString()} for ${member?.name}`, groupId: gid });
      }
      // DELETE the pending saving record — loan repayments must NOT appear in savings balance
      await tx.destroy();
      return res.redirect('/admin/savings?success=deposit_confirmed');
    }

    // ── If it's a project contribution, credit the project ────────
    if (tx.projectId) {
      const { Project, ProjectContribution } = require('../models');
      const project = await Project.findByPk(tx.projectId);
      if (project) {
        await ProjectContribution.create({ projectId: tx.projectId, memberId: tx.memberId, groupId: gid, amount: tx.amount, date: new Date(), postedBy: req.user.id, notes: 'Via online payment' });
        project.raisedAmount = (project.raisedAmount||0) + tx.amount;
        await project.save();
        await AuditLog.create({ userId: req.user.id, action: 'CONFIRM_PROJECT_CONTRIB', detail: `Confirmed project contribution UGX ${tx.amount.toLocaleString()} to ${project.name} for ${member?.name}`, groupId: gid });
      }
    }

    // ── If it's a share capital payment, update member share capital ──
    if (tx.type === 'share_capital') {
      member.shareCapitalPaid = (member.shareCapitalPaid||0) + tx.amount;
      await member.save();
    }

    // ── Mark the saving as confirmed (THIS IS THE KEY STEP) ──────
    tx.status   = 'confirmed';
    tx.postedBy = req.user.id;
    await tx.save();

    await AuditLog.create({ userId: req.user.id, action: 'CONFIRM_DEPOSIT', detail: `Confirmed deposit of UGX ${tx.amount.toLocaleString()} for ${member?.name}`, groupId: gid });
    const balance = await getBalance(tx.memberId);
    emails.savingsReceiptToMember(member.toJSON(), tx.toJSON(), balance, group.toJSON()).catch(()=>{});
    res.redirect('/admin/savings?success=deposit_confirmed');
  } catch(err) { console.error(err); res.redirect('/admin/savings?error=confirm_failed'); }
});

router.post('/savings/:id/reject', async (req, res) => {
  try {
    const gid = req.user.groupId;
    const tx  = await Saving.findOne({ where: { id: req.params.id, groupId: gid, status: 'pending' } });
    if (tx) { await tx.destroy(); await AuditLog.create({ userId: req.user.id, action: 'REJECT_DEPOSIT', detail: 'Rejected pending deposit', groupId: gid }); }
    res.redirect('/admin/savings?success=deposit_rejected');
  } catch(err) { console.error(err); res.redirect('/admin/savings?error=reject_failed'); }
});
// ── Loan Terms Settings ───────────────────────────────────────────
router.get('/loan-terms', async (req, res) => {
  try {
    const gid   = req.user.groupId;
    const group = await Group.findByPk(gid);
    const { GroupSettings } = require('../models');
    let settings = await GroupSettings.findOne({ where: { groupId: gid } });
    if (!settings) settings = await GroupSettings.create({ groupId: gid });
    res.render('admin/loan-terms', { user: req.user, group, settings: settings.toJSON(), query: req.query });
  } catch(err) { console.error(err); res.render('error', { message: 'Error loading loan terms', user: req.user }); }
});

router.post('/loan-terms', async (req, res) => {
  try {
    const gid = req.user.groupId;
    const { GroupSettings } = require('../models');
    const {
      newLoanInterestRate, topupInterestRate, emergencyInterestRate,
      newLoanMaxMultiplier, emergencyMaxMultiplier, loanProcessingFee,
      loanTermsText, mtnMomoNumber, airtelMoneyNumber, accountNumber, bankName
    } = req.body;

    const newRate  = parseFloat(newLoanInterestRate)  || 1.5;
    const topRate  = parseFloat(topupInterestRate)     || 1.5;
    const emerRate = parseFloat(emergencyInterestRate) || 2.0;
    const newMult  = parseFloat(newLoanMaxMultiplier)  || 3;
    const emerMult = parseFloat(emergencyMaxMultiplier)|| 1;
    const procFee  = parseFloat(loanProcessingFee)     || 0;

    // Auto-generate terms text from the actual rate values
    const autoTerms = [
      '1. All loans must be repaid within the agreed repayment period.',
      '2. New loans and top-up loans attract an interest rate of ' + newRate + '% per month on the outstanding balance.',
      '3. Emergency loans attract an interest rate of ' + emerRate + '% per month on the outstanding balance.',
      '4. Members may borrow up to ' + newMult + '× their total savings balance for new and top-up loans.',
      '5. Emergency loans are limited to ' + emerMult + '× the member\'s total savings balance.',
      procFee > 0
        ? '6. A loan processing fee of ' + procFee + '% of the loan amount is charged at disbursement.'
        : '6. No processing fee is charged on loans.',
      '7. Guarantors must be active members in good standing with no outstanding overdue obligations.',
      '8. Defaulting members will be reported to the credit reference bureau and may have their membership suspended.',
      '9. Top-up loans are only available to members with an active existing loan in good standing.',
      '10. The SACCO reserves the right to recover outstanding loan balances from the member\'s savings.',
    ].join('\n');

    // Use auto-generated terms if admin left it blank or if rates changed
    const finalTerms = (loanTermsText && loanTermsText.trim()) ? loanTermsText : autoTerms;

    await GroupSettings.upsert({
      groupId: gid,
      newLoanInterestRate: newRate,
      topupInterestRate:   topRate,
      emergencyInterestRate: emerRate,
      newLoanMaxMultiplier: newMult,
      emergencyMaxMultiplier: emerMult,
      loanProcessingFee: procFee,
      loanTermsText: finalTerms,
      mtnMomoNumber, airtelMoneyNumber, accountNumber, bankName
    });

    await AuditLog.create({ userId: req.user.id, action: 'UPDATE_LOAN_TERMS', detail: 'Updated loan terms and payment settings', groupId: gid });
    res.redirect('/admin/loan-terms?success=saved');
  } catch(err) { console.error(err); res.redirect('/admin/loan-terms?error=save_failed'); }
});

// ── Income & Expenditure ─────────────────────────────────────────
router.get('/expenditure', async (req, res) => {
  try {
    const gid   = req.user.groupId;
    const group = await Group.findByPk(gid);
    const { Expenditure, OtherIncome } = require('../models');
    const expenditures   = await Expenditure.findAll({ where: { groupId: gid }, order: [['date','DESC']] });
    const otherIncomes   = await OtherIncome.findAll({ where: { groupId: gid }, order: [['date','DESC']] });
    // Exclude pending and loan repayment records (repayments live in Repayment table, not savings)
    const savings        = await Saving.findAll({
      where: {
        groupId: gid,
        status: { [Op.ne]: 'pending' },
        description: { [Op.notLike]: '%loan repayment%' },
        type: { [Op.ne]: 'dividend' },
      },
      attributes: ['amount']
    });
    const activeLoans    = await Loan.findAll({ where: { groupId: gid, status: 'active' }, attributes: ['totalRepayable','amountRepaid'] });
    const loanPortfolio  = activeLoans.reduce((s,l) => s + (l.totalRepayable - l.amountRepaid), 0);

    const totalSavingsIncome = savings.reduce((s,r) => s+r.amount, 0);
    const totalOtherIncome   = otherIncomes.reduce((s,r) => s+r.amount, 0);
    const totalIncome        = totalSavingsIncome + totalOtherIncome;
    const totalExpend        = expenditures.reduce((s,r) => s+r.amount, 0);
    // Net balance = Savings + Share Capital - Expenditure - Loans
    // Other income is NOT included because it gets distributed to members immediately
    const totalShareCapital  = (await User.findAll({ where: { groupId: gid, active: true, role: { [Op.ne]: 'superadmin' } }, attributes: ['shareCapitalPaid'] })).reduce((t,m)=>t+(m.shareCapitalPaid||0),0);
    const netBalance         = totalSavingsIncome + totalShareCapital - totalExpend - loanPortfolio;
    res.render('admin/expenditure', { user: req.user, group, expenditures, otherIncomes, totalSavingsIncome, totalOtherIncome, totalIncome, totalExpend, netBalance, loanPortfolio, totalShareCapital, query: req.query });
  } catch(err) { console.error(err); res.render('error', { message: 'Error', user: req.user }); }
});


router.post('/expenditure/income/add', async (req, res) => {
  try {
    const gid = req.user.groupId;
    const { OtherIncome } = require('../models');
    const { amount, source, description, date } = req.body;
    const parsedAmount = parseInt(amount);
    await OtherIncome.create({ groupId: gid, amount: parsedAmount, source, description, date: date ? new Date(date) : new Date(), postedBy: req.user.id });
    await AuditLog.create({ userId: req.user.id, action: 'ADD_INCOME', detail: 'Recorded income: UGX ' + parsedAmount.toLocaleString() + ' from ' + source, groupId: gid });
    // Redirect to reports distribution tab to prompt immediate distribution
    res.redirect('/admin/reports?tab=interest&success=income_added&prompt_distribute=1&income_amount=' + parsedAmount + '&income_source=' + encodeURIComponent(source));
  } catch(err) { console.error(err); res.redirect('/admin/expenditure?error=income_failed'); }
});

router.post('/expenditure/add', async (req, res) => {
  try {
    const gid = req.user.groupId;
    const { Expenditure } = require('../models');
    const { amount, category, description, date } = req.body;
    await Expenditure.create({ groupId: gid, amount: parseInt(amount), category, description, date: date ? new Date(date) : new Date(), postedBy: req.user.id });
    await AuditLog.create({ userId: req.user.id, action: 'ADD_EXPENDITURE', detail: `Added expenditure: UGX ${parseInt(amount).toLocaleString()} — ${category}`, groupId: gid });
    res.redirect('/admin/expenditure?success=added');
  } catch(err) { console.error(err); res.redirect('/admin/expenditure?error=add_failed'); }
});

// ── Admin Invoices ────────────────────────────────────────────────
router.get('/invoices', async (req, res) => {
  try {
    const gid   = req.user.groupId;
    const group = await Group.findByPk(gid);
    const { Invoice } = require('../models');
    const invoices = await Invoice.findAll({ where: { groupId: gid }, order: [['createdAt','DESC']] });
    res.render('admin/invoices', { user: req.user, group, invoices, query: req.query });
  } catch(err) { console.error(err); res.render('error', { message: 'Error', user: req.user }); }
});


// ── Member Savings Statement (printable) ──────────────────────────
router.get('/savings/statement/:memberId', async (req, res) => {
  try {
    const gid    = req.user.groupId;
    const group  = await Group.findByPk(gid);
    const member = await User.findOne({ where: { id: req.params.memberId, groupId: gid } });
    if (!member) return res.redirect('/admin/savings?error=not_found');
    const rows = await Saving.findAll({
      where: { memberId: member.id, status: { [Op.ne]: 'pending' }, description: { [Op.notLike]: '%loan repayment%' } },
      order: [['date','ASC']]
    });
    let running = 0;
    const transactions = rows.map(t => { running += t.amount; return { ...t.toJSON(), runningBalance: running }; });
    res.render('admin/savings-statement', { user: req.user, group, member: member.toJSON(), transactions, balance: running });
  } catch(err) { console.error(err); res.redirect('/admin/savings'); }
});

// ── Loan Repayment Statement (printable) ─────────────────────────
router.get('/loans/:id/statement', async (req, res) => {
  try {
    const gid  = req.user.groupId;
    const group = await Group.findByPk(gid);
    const loan  = await Loan.findOne({ where: { id: req.params.id, groupId: gid } });
    if (!loan) return res.redirect('/admin/loans');
    const member = await User.findByPk(loan.memberId);
    const { Repayment } = require('../models');
    const repayments = await Repayment.findAll({ where: { loanId: loan.id }, order: [['date','ASC']] });
    let totalRepaid = 0;
    const rows = repayments.map(r => { totalRepaid += r.amount; return { ...r.toJSON(), runningBalance: Math.max(0, loan.totalRepayable - totalRepaid) }; });
    res.render('admin/loan-statement', { user: req.user, group, loan: loan.toJSON(), member: member.toJSON(), repayments: rows, totalRepaid });
  } catch(err) { console.error(err); res.redirect('/admin/loans'); }
});

// ── Savings Withdrawals (Admin) ───────────────────────────────────
router.get('/withdrawals', async (req, res) => {
  try {
    const gid = req.user.groupId;
    const group = await Group.findByPk(gid);
    const { SavingsWithdrawal } = require('../models');
    const all = await SavingsWithdrawal.findAll({ where: { groupId: gid }, order: [['appliedAt','DESC']] });
    const enriched = await Promise.all(all.map(async w => ({
      ...w.toJSON(), member: (await User.findByPk(w.memberId))?.toJSON()||null
    })));
    res.render('admin/withdrawals', { user: req.user, group, withdrawals: enriched, query: req.query });
  } catch(err) { console.error(err); res.render('error', { message: 'Error', user: req.user }); }
});

router.post('/withdrawals/:id/disburse', async (req, res) => {
  try {
    const gid = req.user.groupId;
    const { SavingsWithdrawal } = require('../models');
    const w = await SavingsWithdrawal.findOne({ where: { id: req.params.id, groupId: gid, status: 'chair_approved' } });
    if (!w) return res.redirect('/admin/withdrawals?error=not_ready');
    const member = await User.findByPk(w.memberId);
    const balance = await getBalance(w.memberId);
    if (w.amount > balance) return res.redirect('/admin/withdrawals?error=insufficient_balance');
    // Deduct from savings
    await Saving.create({
      memberId: w.memberId, groupId: gid, amount: -w.amount,
      type: 'other', description: 'Savings withdrawal — approved',
      date: new Date(), postedBy: req.user.id, status: 'confirmed',
    });
    w.status = 'approved'; w.disbursedAt = new Date(); w.disbursedBy = req.user.id;
    await w.save();
    await AuditLog.create({ userId: req.user.id, action: 'WITHDRAWAL_DISBURSED', detail: 'Disbursed savings withdrawal UGX ' + w.amount.toLocaleString() + ' to ' + member?.name, groupId: gid });
    res.redirect('/admin/withdrawals?success=disbursed');
  } catch(err) { console.error(err); res.redirect('/admin/withdrawals?error=failed'); }
});
module.exports = router;
