const router = require('express').Router();
const { Op }  = require('sequelize');
const { Group, User, Saving, Loan, Repayment, Expenditure, Project, ProjectContribution, GroupSettings, Asset, OtherIncome } = require('../models');
const { authenticate, requireRole } = require('../middleware/auth');

router.use(authenticate, requireRole('admin','superadmin'));

function getRange(period, year, quarter, month) {
  const y = parseInt(year) || new Date().getFullYear();
  let start, end;
  if (period === 'annual') {
    start = new Date(y, 0, 1); end = new Date(y, 11, 31, 23, 59, 59);
  } else if (period === 'quarterly') {
    const q = parseInt(quarter) || Math.ceil((new Date().getMonth()+1)/3);
    start = new Date(y, (q-1)*3, 1); end = new Date(y, q*3, 0, 23, 59, 59);
  } else {
    const m = month !== undefined ? parseInt(month) : new Date().getMonth();
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
    const q = parseInt(quarter) || Math.ceil((new Date().getMonth()+1)/3);
    const m = month !== undefined ? parseInt(month) : new Date().getMonth();
    const { start, end } = getRange(period, y, q, m);
    const dateFilter = { [Op.between]: [start, end] };

    // ── MEMBERS ───────────────────────────────────────────────────
    const allMembers = await User.findAll({
      where: { groupId: gid, role: { [Op.notIn]: ['superadmin'] }, active: true },
      order: [['name','ASC']],
    });

    // ── SAVINGS ───────────────────────────────────────────────────
    const periodSavingsRows = await Saving.findAll({ where:{ groupId:gid, date:dateFilter, status:{ [Op.ne]:'pending' } } });
    const totalPeriodSavings = periodSavingsRows.reduce((t,s)=>t+s.amount,0);

    const memberSavings = await Promise.all(allMembers.map(async mem => {
      const mj = mem.toJSON();
      const periodAmt = periodSavingsRows.filter(s=>s.memberId===mj.id).reduce((t,s)=>t+s.amount,0);
      const allRows   = await Saving.findAll({ where:{ memberId:mj.id, status:{ [Op.ne]:'pending' } }, attributes:['amount'] });
      const totalBalance = allRows.reduce((t,s)=>t+s.amount,0);
      return { ...mj, periodSavings: periodAmt, totalBalance };
    }));

    // ── LOANS ─────────────────────────────────────────────────────
    const loansInPeriodRaw = await Loan.findAll({ where:{ groupId:gid, appliedAt:dateFilter } });
    const loansInPeriod = await Promise.all(loansInPeriodRaw.map(async l => ({
      ...l.toJSON(), member: (await User.findByPk(l.memberId))?.toJSON()||null
    })));

    const activeLoansRaw  = await Loan.findAll({ where:{ groupId:gid, status:'active' } });
    const activeLoans     = await Promise.all(activeLoansRaw.map(async l => ({
      ...l.toJSON(), member: (await User.findByPk(l.memberId))?.toJSON()||null
    })));

    const repaidLoansRaw  = await Loan.findAll({ where:{ groupId:gid, status:'repaid' } });

    // ── INTEREST INCOME ───────────────────────────────────────────
    const interestIncome = [...activeLoansRaw, ...repaidLoansRaw]
      .reduce((t,l) => t + Math.max(0, l.totalRepayable - l.amount), 0);

    const periodRepayments = await Repayment.findAll({ where:{ groupId:gid, date:dateFilter } });
    const totalRepaid = periodRepayments.reduce((t,r)=>t+r.amount,0);

    const interestRate = settings ? settings.newLoanInterestRate/100 : 0.015;
    const periodInterest = Math.round(totalRepaid * (interestRate / (1 + interestRate)));

    const accrualMonths = period==='annual'?12:period==='quarterly'?3:1;
    const accruedInterest = activeLoansRaw.reduce((t,l) => {
      const outstanding = l.totalRepayable - l.amountRepaid;
      return t + Math.round(outstanding * interestRate * accrualMonths);
    }, 0);
    const periodInterestDisplay = periodInterest > 0 ? periodInterest : accruedInterest;

    // ── EXPENDITURE ───────────────────────────────────────────────
    const expenditures = await Expenditure.findAll({ where:{ groupId:gid, date:dateFilter }, order:[['date','ASC']] });
    const totalExpend  = expenditures.reduce((t,e)=>t+e.amount,0);

    // ── PROJECTS ─────────────────────────────────────────────────
    const projects = await Project.findAll({ where:{ groupId:gid } });
    const periodProjectContribs = await ProjectContribution.findAll({ where:{ groupId:gid, date:dateFilter } });
    const totalProjectContribs = periodProjectContribs.reduce((t,c)=>t+c.amount,0);

    // ── OTHER INCOME ──────────────────────────────────────────────
    const otherIncomePeriod  = await OtherIncome.findAll({ where:{ groupId:gid, date:dateFilter } });
    const totalOtherIncomePeriod = otherIncomePeriod.reduce((t,i)=>t+i.amount,0);
    const allOtherIncomeEver = await OtherIncome.findAll({ where:{ groupId:gid }, attributes:['amount'] });
    const totalOtherIncomeEver = allOtherIncomeEver.reduce((t,i)=>t+i.amount,0);

    // ── DISTRIBUTION POOL (interest + other income) ───────────────
    // Both loan interest and other income are distributed to members
    // by the same configured method (share capital, savings, or both)
    const method = settings?.interestDistributionMethod || 'share_capital_and_savings';
    const totalDistributionPool = periodInterestDisplay + totalOtherIncomePeriod;

    const interestDistribution = memberSavings.map(ms => {
      let weight = 0;
      if (method === 'share_capital_only') {
        weight = ms.shareCapitalPaid || 0;
      } else if (method === 'savings_only') {
        weight = ms.totalBalance || 0;
      } else {
        weight = (ms.shareCapitalPaid || 0) + (ms.totalBalance || 0);
      }
      return { ...ms, weight };
    });
    const totalWeight = interestDistribution.reduce((t,m)=>t+m.weight,0);
    const interestDistributionFinal = interestDistribution.map(m => ({
      ...m,
      interestShare: totalWeight > 0 ? Math.round((m.weight / totalWeight) * totalDistributionPool) : 0,
    }));

    // ── AVAILABLE BALANCE ─────────────────────────────────────────
    const allSavingsEver  = await Saving.findAll({ where:{ groupId:gid, status:{ [Op.ne]:'pending' } }, attributes:['amount'] });
    const allExpendsEver  = await Expenditure.findAll({ where:{ groupId:gid }, attributes:['amount'] });
    const totalSavingsEver = allSavingsEver.reduce((t,s)=>t+s.amount,0);
    const totalExpendsEver = allExpendsEver.reduce((t,e)=>t+e.amount,0);
    const loanPortfolio    = activeLoansRaw.reduce((t,l)=>t+(l.totalRepayable-l.amountRepaid),0);
    const availableBalance = totalSavingsEver + totalOtherIncomeEver - totalExpendsEver - loanPortfolio;

    // ── ASSETS ────────────────────────────────────────────────────
    const allAssets = await Asset.findAll({ where:{ groupId:gid }, order:[['purchaseDate','DESC']] });

    const currentYear = new Date().getFullYear();
    const years       = Array.from({length:6},(_,i)=>currentYear-i);
    const months      = ['January','February','March','April','May','June','July','August','September','October','November','December'];

    res.render('admin/reports-full', {
      user: req.user, group,
      period, year: y, quarter: q, month: m,
      tab, start, end,
      memberSavings,
      totalPeriodSavings,
      loansInPeriod,
      activeLoans,
      totalRepaid,
      periodInterest: periodInterestDisplay,
      interestIncome,
      expenditures,
      totalExpend,
      projects,
      totalProjectContribs,
      interestDistribution: interestDistributionFinal,
      totalInterestPool: totalDistributionPool,
      totalDistributionPool,
      totalOtherIncomePeriod,
      totalOtherIncomeEver,
      method,
      availableBalance,
      totalSavingsEver,
      totalExpendsEver,
      loanPortfolio,
      allAssets: allAssets.map(a=>a.toJSON()),
      years, months,
      settings: settings?.toJSON() || {},
    });
  } catch(err) {
    console.error('Reports error:', err);
    res.render('error', { message: 'Error generating report: ' + err.message, user: req.user });
  }
});

module.exports = router;
