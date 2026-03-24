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
    const { amount, paymentMethod, paymentType, projectId } = req.body;
    const parsedAmount = parseInt(amount);
    const ref  = `TXN${Date.now()}`;

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

module.exports = router;
