// Routes for Credit Officer, Treasurer, and Chairperson
const router = require('express').Router();
const { Group, User, Loan, AuditLog } = require('../models');
const { authenticate, requireRole } = require('../middleware/auth');
const { emails } = require('../utils/email');

router.use(authenticate, requireRole('credit_officer','treasurer','chairperson','admin','superadmin'));


// ── Dashboard for approvers ───────────────────────────────────────
router.get('/dashboard', async (req, res) => {
  try {
    const gid   = req.user.groupId;
    const group = await Group.findByPk(gid);
    const role  = req.user.role;

    // Show loans that are waiting for THIS role
    let pendingFilter = {};
    if (role === 'credit_officer') pendingFilter = { creditOfficerStatus: 'pending', status: 'pending' };
    if (role === 'treasurer')      pendingFilter = { treasurerStatus: 'pending', creditOfficerStatus: 'approved', status: 'under_review' };
    if (role === 'chairperson')    pendingFilter = { chairpersonStatus: 'pending', treasurerStatus: 'approved', status: 'under_review' };

    const myQueue = await Loan.findAll({ where: { groupId: gid, ...pendingFilter }, order: [['appliedAt','DESC']] });
    const myQueueWithMember = await Promise.all(myQueue.map(async l => ({ ...l.toJSON(), member: await User.findByPk(l.memberId) })));

    // Stats
    const totalReviewed = await Loan.count({ where: { groupId: gid, [`${role === 'credit_officer' ? 'creditOfficer' : role === 'treasurer' ? 'treasurer' : 'chairperson'}Id`]: req.user.id } });

    res.render('approver/dashboard', { user: req.user.toJSON(), group: group.toJSON(), myQueue: myQueueWithMember, totalReviewed, role });
  } catch (err) { console.error(err); res.render('error', { message: 'Dashboard error', user: req.user }); }
});

// ── View a single loan application ───────────────────────────────
router.get('/loans/:id', async (req, res) => {
  try {
    const gid   = req.user.groupId;
    const group = await Group.findByPk(gid);
    const loan  = await Loan.findOne({ where: { id: req.params.id, groupId: gid } });
    if (!loan) return res.redirect('/approver/dashboard?error=not_found');
    const member = await User.findByPk(loan.memberId);
    const { Saving } = require('../models');
    const savings = await Saving.findAll({ where: { memberId: loan.memberId }, attributes: ['amount'] });
    const balance = savings.reduce((s, r) => s + r.amount, 0);

    // Get approver names
    const coUser  = loan.creditOfficerId  ? await User.findByPk(loan.creditOfficerId)  : null;
    const trUser  = loan.treasurerId      ? await User.findByPk(loan.treasurerId)      : null;
    const chUser  = loan.chairpersonId    ? await User.findByPk(loan.chairpersonId)    : null;

    res.render('approver/loan-detail', { user: req.user.toJSON(), group: group.toJSON(), loan: loan.toJSON(), member: member.toJSON(), balance, coUser, trUser, chUser });
  } catch (err) { console.error(err); res.redirect('/approver/dashboard'); }
});

// ── Approve / Reject ─────────────────────────────────────────────
router.post('/loans/:id/review', async (req, res) => {
  try {
    const gid    = req.user.groupId;
    const group  = await Group.findByPk(gid);
    const loan   = await Loan.findOne({ where: { id: req.params.id, groupId: gid } });
    if (!loan) return res.redirect('/approver/dashboard?error=not_found');
    const member = await User.findByPk(loan.memberId);
    const { decision, note } = req.body;   // decision = 'approved' | 'rejected'
    const role   = req.user.role;
    const now    = new Date();

    if (role === 'credit_officer') {
      if (loan.creditOfficerStatus !== 'pending') return res.redirect('/approver/dashboard?error=already_reviewed');
      loan.creditOfficerStatus = decision;
      loan.creditOfficerId     = req.user.id;
      loan.creditOfficerNote   = note || '';
      loan.creditOfficerAt     = now;
      // If approved → move to under_review for treasurer; if rejected → reject whole loan
      loan.status = decision === 'approved' ? 'under_review' : 'rejected';
    } else if (role === 'treasurer') {
      if (loan.treasurerStatus !== 'pending' || loan.creditOfficerStatus !== 'approved') return res.redirect('/approver/dashboard?error=not_your_turn');
      loan.treasurerStatus = decision;
      loan.treasurerId     = req.user.id;
      loan.treasurerNote   = note || '';
      loan.treasurerAt     = now;
      if (decision === 'rejected') loan.status = 'rejected';
    } else if (role === 'chairperson') {
      if (loan.chairpersonStatus !== 'pending' || loan.treasurerStatus !== 'approved') return res.redirect('/approver/dashboard?error=not_your_turn');
      loan.chairpersonStatus = decision;
      loan.chairpersonId     = req.user.id;
      loan.chairpersonNote   = note || '';
      loan.chairpersonAt     = now;
      if (decision === 'approved') {
        // All 3 approved → ready for admin disbursement
        loan.status = 'approved';
      } else {
        loan.status = 'rejected';
      }
    }

    await loan.save();
    await AuditLog.create({ userId: req.user.id, action: `LOAN_${role.toUpperCase()}_${decision.toUpperCase()}`, detail: `${req.user.name} (${role}) ${decision} loan for ${member.name}`, groupId: gid });

    // Notify member of rejection immediately
    if (decision === 'rejected') {
      loan.notes = note || `Rejected at ${role.replace('_',' ')} stage`;
      await loan.save();
      emails.loanDeclinedToMember(member.toJSON(), loan.toJSON(), group.toJSON()).catch(()=>{});
    }

    // Notify member when all 3 approved (ready for disbursement)
    if (loan.status === 'approved') {
      emails.loanApprovedToMember(member.toJSON(), loan.toJSON(), group.toJSON()).catch(()=>{});
    }

    res.redirect('/approver/dashboard?success=reviewed');
  } catch (err) { console.error(err); res.redirect('/approver/dashboard?error=review_failed'); }
});

module.exports = router;
