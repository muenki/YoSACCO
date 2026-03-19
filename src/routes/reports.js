const router = require('express').Router();
const { Op } = require('sequelize');
const { Group, User, Saving, Loan, Repayment, Expenditure, Project, ProjectContribution, GroupSettings } = require('../models');
const { authenticate, requireRole } = require('../middleware/auth');

router.use(authenticate, requireRole('admin','superadmin'));

// Helper: date range filter
function getRange(period, year, quarter, month) {
  const y = parseInt(year) || new Date().getFullYear();
  let start, end;
  if (period === 'annual') {
    start = new Date(y, 0, 1); end = new Date(y, 11, 31, 23, 59, 59);
  } else if (period === 'quarterly') {
    const q = parseInt(quarter) || Math.ceil((new Date().getMonth()+1)/3);
    start = new Date(y, (q-1)*3, 1); end = new Date(y, q*3, 0, 23, 59, 59);
  } else {
    const m = parseInt(month) || new Date().getMonth();
    start = new Date(y, m, 1); end = new Date(y, m+1, 0, 23, 59, 59);
  }
  return { start, end };
}

router.get('/', async (req, res) => {
  try {
    const gid      = req.user.groupId;
    const group    = await Group.findByPk(gid);
    const settings = await GroupSettings.findOne({ where:{ groupId:gid } });

    const { period='monthly', year, quarter, month, tab='savings' } = req.query;
    const y = parseInt(year) || new Date().getFullYear();
    const { start, end } = getRange(period, y, quarter, month);
    const dateFilter = { [Op.between]: [start, end] };

    // ── SAVINGS REPORT ───────────────────────────────────────────
    const allMembers  = await User.findAll({ where:{ groupId:gid, role:['member','credit_officer','treasurer','chairperson'] } });
    const savingsRows = await Saving.findAll({ where:{ groupId:gid, date:dateFilter }, order:[['date','ASC']] });

    const memberSavings = await Promise.all(allMembers.map(async m => {
      const periodSavings = savingsRows.filter(s=>s.memberId===m.id).reduce((t,s)=>t+s.amount,0);
      const allSavings    = await Saving.findAll({ where:{ memberId:m.id }, attributes:['amount'] });
      const totalBalance  = allSavings.reduce((t,s)=>t+s.amount,0);
      return { ...m.toJSON(), periodSavings, totalBalance };
    }));
    const totalPeriodSavings = savingsRows.reduce((t,s)=>t+s.amount,0);

    // ── LOAN PORTFOLIO REPORT ─────────────────────────────────────
    const loansInPeriod = await Loan.findAll({ where:{ groupId:gid, appliedAt:dateFilter }, order:[['appliedAt','ASC']] });
    const activeLoans   = await Loan.findAll({ where:{ groupId:gid, status:'active' } });
    const repaidLoans   = await Loan.findAll({ where:{ groupId:gid, status:'repaid' } });

    // Interest income calculation
    const repayments = await Repayment.findAll({ where:{ groupId:gid, date:dateFilter } });
    const totalRepaid = repayments.reduce((t,r)=>t+r.amount,0);
    // Interest = total repaid - principal portion (approx: total repayable - loan amount)
    const interestIncome = activeLoans.concat(repaidLoans).reduce((t,l)=> t + Math.max(0,(l.totalRepayable-l.amount)), 0);
    const periodInterest = repayments.length > 0 ? Math.round(totalRepaid * 0.12) : 0; // approx 12% of repayments is interest

    // ── EXPENDITURE REPORT ────────────────────────────────────────
    const expenditures = await Expenditure.findAll({ where:{ groupId:gid, date:dateFilter }, order:[['date','ASC']] });
    const totalExpend  = expenditures.reduce((t,e)=>t+e.amount,0);

    // ── PROJECTS ──────────────────────────────────────────────────
    const projects = await Project.findAll({ where:{ groupId:gid } });
    const projectContribs = await ProjectContribution.findAll({ where:{ groupId:gid, date:dateFilter } });
    const totalProjectContribs = projectContribs.reduce((t,c)=>t+c.amount,0);

    // ── INTEREST DISTRIBUTION ─────────────────────────────────────
    const method = settings?.interestDistributionMethod || 'share_capital_and_savings';
    const totalInterestPool = periodInterest;
    const memberShares = allMembers.map(m => {
      let weight = 0;
      if (method === 'share_capital_only')        weight = m.shareCapitalPaid || 0;
      else if (method === 'savings_only')         weight = memberSavings.find(ms=>ms.id===m.id)?.totalBalance || 0;
      else /* share_capital_and_savings */        weight = (m.shareCapitalPaid||0) + (memberSavings.find(ms=>ms.id===m.id)?.totalBalance||0);
      return { ...m, weight };
    });
    const totalWeight = memberShares.reduce((t,m)=>t+m.weight,0);
    const interestDistribution = memberShares.map(m => ({
      ...m,
      interestShare: totalWeight > 0 ? Math.round((m.weight/totalWeight)*totalInterestPool) : 0,
    }));

    // ── AVAILABLE BALANCE ─────────────────────────────────────────
    const allSavingsEver = await Saving.findAll({ where:{ groupId:gid }, attributes:['amount'] });
    const allExpendsEver = await Expenditure.findAll({ where:{ groupId:gid }, attributes:['amount'] });
    const totalSavingsEver = allSavingsEver.reduce((t,s)=>t+s.amount,0);
    const totalExpendsEver = allExpendsEver.reduce((t,e)=>t+e.amount,0);
    const loanPortfolio    = activeLoans.reduce((t,l)=>t+(l.totalRepayable-l.amountRepaid),0);
    const availableBalance = totalSavingsEver - totalExpendsEver - loanPortfolio;

    const currentYear  = new Date().getFullYear();
    const years        = Array.from({length:5},(_,i)=>currentYear-i);
    const quarters     = [1,2,3,4];
    const months       = ['January','February','March','April','May','June','July','August','September','October','November','December'];

    res.render('admin/reports-full', {
      user:req.user, group,
      period, year:y, quarter: parseInt(quarter)||Math.ceil((new Date().getMonth()+1)/3),
      month: parseInt(month)||new Date().getMonth(),
      tab, start, end,
      memberSavings, totalPeriodSavings,
      loansInPeriod: await Promise.all(loansInPeriod.map(async l=>({ ...l.toJSON(), member:(await User.findByPk(l.memberId))?.toJSON()||null }))),
      activeLoans: await Promise.all(activeLoans.map(async l=>({ ...l.toJSON(), member:(await User.findByPk(l.memberId))?.toJSON()||null }))),
      totalRepaid, periodInterest, interestIncome,
      expenditures, totalExpend,
      projects, totalProjectContribs,
      interestDistribution, totalInterestPool, method,
      availableBalance, totalSavingsEver, totalExpendsEver, loanPortfolio,
      years, quarters, months, settings: settings?.toJSON()||{},
    });
  } catch(err) {
    console.error('Reports error:', err);
    res.render('error', { message:'Error generating report', user:req.user });
  }
});

module.exports = router;
