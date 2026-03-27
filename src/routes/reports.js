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

    // ── DISTRIBUTION POOL (interest + other income − expenditure) ───
    // Net distributable = income earned minus costs incurred in the period
    const method = settings?.interestDistributionMethod || 'share_capital_and_savings';
    const grossPool = periodInterestDisplay + totalOtherIncomePeriod;
    const totalDistributionPool = Math.max(0, grossPool - totalExpend);

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
    // Available Balance = Total Member Assets - Expenditure - Loans - Cash Payouts
    const allExpendsEver   = await Expenditure.findAll({ where:{ groupId:gid }, attributes:['amount'] });
    const totalExpendsEver = allExpendsEver.reduce((t,e)=>t+e.amount,0);
    const loanPortfolio    = activeLoansRaw.reduce((t,l)=>t+(l.totalRepayable-l.amountRepaid),0);
    const totalShareCapital = allMembers.reduce((t,m) => t + (m.shareCapitalPaid||0), 0);
    // Include dividends in savings total (they are member assets), exclude payouts
    const allSavingsEver   = await Saving.findAll({ where:{ groupId:gid, status:{ [Op.ne]:'pending' }, description:{ [Op.notLike]:'%loan repayment%' }, type:{ [Op.notIn]:['payout'] } }, attributes:['amount'] });
    const totalSavingsEver = allSavingsEver.reduce((t,s)=>t+s.amount,0);
    // Cash payouts reduce available balance
    let totalPayouts = 0;
    try {
      const payoutRows = await Saving.findAll({ where:{ groupId:gid, type:'payout', status:'confirmed' }, attributes:['amount'] });
      totalPayouts = Math.abs(payoutRows.reduce((t,r)=>t+r.amount,0));
    } catch(e) { totalPayouts = 0; }
    const totalMemberAssets = totalSavingsEver + totalShareCapital;
    const availableBalance  = totalMemberAssets - totalExpendsEver - loanPortfolio - totalPayouts;

    // ── ASSETS ────────────────────────────────────────────────────
    const allAssets = await Asset.findAll({ where:{ groupId:gid }, order:[['purchaseDate','DESC']] });

    // ── PROJECT COLLECTIONS ──────────────────────────────────────
    const allProjects = await Project.findAll({ where:{ groupId:gid } });
    const projectCollections = await Promise.all(allProjects.map(async p => {
      const contribs = await ProjectContribution.findAll({ where:{ projectId: p.id } });
      const totalContrib = contribs.reduce((t,c)=>t+c.amount,0);
      // Group by member
      const byMember = {};
      contribs.forEach(c => { byMember[c.memberId]=(byMember[c.memberId]||0)+c.amount; });
      const memberContribs = await Promise.all(Object.entries(byMember).map(async ([mid,amt]) => ({
        member: (await User.findByPk(mid))?.toJSON()||null, amount: amt
      })));
      return { ...p.toJSON(), totalContrib, memberContribs };
    }));

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
      totalShareCapital,
      totalExpendsEver,
      loanPortfolio,
      allAssets: allAssets.map(a=>a.toJSON()),
      projectCollections,
      years, months,
      settings: settings?.toJSON() || {},
    });
  } catch(err) {
    console.error('Reports error:', err);
    res.render('error', { message: 'Error generating report: ' + err.message, user: req.user });
  }
});


// ── Post Distribution to Member Savings OR Payout ────────────────
router.post('/distribute', async (req, res) => {
  try {
    const gid      = req.user.groupId;
    const group    = await Group.findByPk(gid);
    const settings = await GroupSettings.findOne({ where:{ groupId:gid } });
    const { period, year, quarter, month, description, distribute_type } = req.body;
    // distribute_type: 'savings' (add to member savings) or 'payout' (cash out, no savings change)

    // Rebuild the same calculation as the reports route
    const { start, end } = (() => {
      const y = parseInt(year) || new Date().getFullYear();
      const q = parseInt(quarter) || Math.ceil((new Date().getMonth()+1)/3);
      const m = month !== undefined ? parseInt(month) : new Date().getMonth();
      if (period === 'annual')    return { start: new Date(y,0,1), end: new Date(y,11,31,23,59,59) };
      if (period === 'quarterly') return { start: new Date(y,(q-1)*3,1), end: new Date(y,q*3,0,23,59,59) };
      return { start: new Date(y,m,1), end: new Date(y,m+1,0,23,59,59) };
    })();
    const dateFilter = { [Op.between]: [start, end] };

    // Get all members
    const allMembers = await User.findAll({
      where:{ groupId:gid, role:{ [Op.notIn]:['superadmin'] }, active:true },
    });

    // Calculate savings balances
    const memberSavings = await Promise.all(allMembers.map(async m => {
      const mj = m.toJSON();
      const allRows = await Saving.findAll({ where:{ memberId:mj.id, status:{ [Op.ne]:'pending' } }, attributes:['amount'] });
      return { ...mj, totalBalance: allRows.reduce((t,s)=>t+s.amount,0) };
    }));

    // Interest
    const interestRate = settings ? settings.newLoanInterestRate/100 : 0.015;
    const periodRepayments = await Repayment.findAll({ where:{ groupId:gid, date:dateFilter } });
    const totalRepaid = periodRepayments.reduce((t,r)=>t+r.amount,0);
    const periodInterest = Math.round(totalRepaid * (interestRate / (1 + interestRate)));
    const activeLoansRaw = await Loan.findAll({ where:{ groupId:gid, status:'active' } });
    const accrualMonths = period==='annual'?12:period==='quarterly'?3:1;
    const accruedInterest = activeLoansRaw.reduce((t,l)=>t+Math.round((l.totalRepayable-l.amountRepaid)*interestRate*accrualMonths),0);
    const periodInterestDisplay = periodInterest > 0 ? periodInterest : accruedInterest;

    // Other income
    const otherIncomes = await OtherIncome.findAll({ where:{ groupId:gid, date:dateFilter }, attributes:['amount'] });
    const totalOtherIncome = otherIncomes.reduce((t,i)=>t+i.amount,0);

    // Deduct period expenditure from income before distribution
    const periodExpenditure = await Expenditure.findAll({ where:{ groupId:gid, date:dateFilter }, attributes:['amount'] });
    const totalPeriodExpend = periodExpenditure.reduce((t,e)=>t+e.amount,0);
    const totalPool = Math.max(0, periodInterestDisplay + totalOtherIncome - totalPeriodExpend);
    if (totalPool <= 0) return res.redirect('/admin/reports?tab=interest&error=nothing_to_distribute&period='+period+'&year='+year);

    // Distribution weights
    const method = settings?.interestDistributionMethod || 'share_capital_and_savings';
    const weighted = memberSavings.map(ms => {
      let w = 0;
      if (method === 'share_capital_only') w = ms.shareCapitalPaid || 0;
      else if (method === 'savings_only')  w = ms.totalBalance || 0;
      else w = (ms.shareCapitalPaid||0) + (ms.totalBalance||0);
      return { ...ms, weight: w };
    });
    const totalWeight = weighted.reduce((t,m)=>t+m.weight,0);
    if (totalWeight <= 0) return res.redirect('/admin/reports?tab=interest&error=no_weight&period='+period+'&year='+year);

    const isPayout  = distribute_type === 'payout';
    const entryType = isPayout ? 'payout' : 'dividend';
    const label     = description || (isPayout ? 'Cash payout — ' : 'Income distribution — ') + period + ' ' + year;

    let posted = 0;
    for (const ms of weighted) {
      const share = Math.round((ms.weight / totalWeight) * totalPool);
      if (share <= 0) continue;

      if (isPayout) {
        // Payout: record a NEGATIVE saving entry (reduces pool) but does NOT increase member savings
        // We track it as type='payout' with negative amount so available balance drops
        await Saving.create({
          memberId: ms.id,
          groupId: gid,
          amount: -share,          // negative — reduces pool
          type: 'payout',
          description: label,
          date: new Date(),
          postedBy: req.user.id,
          status: 'confirmed',
        });
      } else {
        // Add to savings: credit member savings with their share
        await Saving.create({
          memberId: ms.id,
          groupId: gid,
          amount: share,
          type: 'dividend',
          description: label,
          date: new Date(),
          postedBy: req.user.id,
          status: 'confirmed',
        });
      }
      posted++;
    }

    await AuditLog.create({
      userId: req.user.id,
      action: isPayout ? 'INCOME_PAYOUT' : 'INCOME_DISTRIBUTION',
      detail: (isPayout ? 'Paid out' : 'Distributed') + ' UGX ' + totalPool.toLocaleString() + ' to ' + posted + ' members (' + label + ')',
      groupId: gid,
    });

    res.redirect('/admin/reports?tab=interest&success=distributed&period='+period+'&year='+year+'&quarter='+quarter+'&month='+month);
  } catch(err) {
    console.error('Distribution error:', err);
    res.redirect('/admin/reports?tab=interest&error=distribution_failed');
  }
});
module.exports = router;
