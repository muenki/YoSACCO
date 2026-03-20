require('dotenv').config();
const bcrypt = require('bcryptjs');
const { sequelize, Group, User, Saving, Loan, Repayment, AuditLog, GroupSettings, Expenditure, Invoice, Project, ProjectContribution, Asset } = require('../models');
const force = process.argv.includes('--force');
const hash  = p => bcrypt.hashSync(p, 10);

async function seed() {
  try {
    console.log('🔌 Connecting to PostgreSQL...');
    await sequelize.authenticate();
    console.log('✅ Connected:', process.env.DB_NAME);
    console.log(`\n📦 Syncing models (force=${force})...`);
    await sequelize.sync({ force });
    console.log('✅ All tables created');
    if (!force && await Group.count() > 0) { console.log('\n⚠️  Data exists. Use --force.'); process.exit(0); }

    // Groups
    const grp1 = await Group.create({ name:'Kampala Teachers SACCO', slug:'kampala-teachers', accentColor:'#0D7377', adminEmail:'admin@kteachers.coop', accountNumber:'0012345678901', bankName:'Stanbic Bank Uganda', active:true });
    const grp2 = await Group.create({ name:'Lira Farmers Cooperative', slug:'lira-farmers', accentColor:'#1A7F4B', adminEmail:'admin@lirafarmers.coop', accountNumber:'0098765432100', bankName:'Centenary Bank', active:true });
    await GroupSettings.create({ groupId:grp1.id, accountNumber:'0012345678901', bankName:'Stanbic Bank Uganda', mtnMomoNumber:'0771234567', airtelMoneyNumber:'0701234567', newLoanInterestRate:1.5, topupInterestRate:1.5, emergencyInterestRate:2.0, newLoanMaxMultiplier:3, emergencyMaxMultiplier:1, loanProcessingFee:1, interestDistributionMethod:'share_capital_and_savings', loanTermsText:'1. All loans must be repaid within the agreed period.\n2. Interest is charged at 1.5% per month on outstanding balance.\n3. Emergency loans attract 2% per month.\n4. A processing fee of 1% applies to all loans.\n5. Guarantors must be active members in good standing.\n6. Defaulting members will be reported to the credit bureau.', minMonthlySavings:10000, shareCapitalTarget:1000000, subscriptionType:'monthly', subscriptionAmount:50000 });
    await GroupSettings.create({ groupId:grp2.id, accountNumber:'0098765432100', bankName:'Centenary Bank', mtnMomoNumber:'0772345678', airtelMoneyNumber:'0702345678', newLoanInterestRate:2.0, topupInterestRate:2.0, emergencyInterestRate:2.5, newLoanMaxMultiplier:3, emergencyMaxMultiplier:1, loanProcessingFee:0, interestDistributionMethod:'share_capital_only', minMonthlySavings:5000, shareCapitalTarget:500000, subscriptionType:'annual', subscriptionAmount:500000 });
    console.log('✅ Created 2 groups + settings');

    // Users
    const superAdmin    = await User.create({ name:'YoSACCO Admin',    email:'superadmin@yosacco.coop',      password:hash('Admin@2025'), role:'superadmin',     active:true });
    const admin1        = await User.create({ name:'Grace Nakato',     email:'admin@kteachers.coop',   password:hash('Admin@2025'), role:'admin',          groupId:grp1.id, memberId:'KTS-0000', phone:'+256700000000', monthlyContribution:50000, shareCapitalTarget:1000000, shareCapitalPaid:1000000, joinDate:new Date('2025-01-01'), active:true });
    await               User.create({ name:'Moses Okello',     email:'admin@lirafarmers.coop',       password:hash('Admin@2025'), role:'admin',          groupId:grp2.id, active:true });
    const creditOfficer = await User.create({ name:'Peter Ssemakula',  email:'credit@kteachers.coop',  password:hash('Admin@2025'), role:'credit_officer', groupId:grp1.id, memberId:'KTS-0001', phone:'+256700111111', monthlyContribution:50000, shareCapitalTarget:1000000, shareCapitalPaid:500000, joinDate:new Date('2025-01-10'), active:true });
    const treasurer     = await User.create({ name:'Sarah Nambi',      email:'treasurer@kteachers.coop', password:hash('Admin@2025'), role:'treasurer',      groupId:grp1.id, memberId:'KTS-0002', phone:'+256700222222', monthlyContribution:50000, shareCapitalTarget:1000000, shareCapitalPaid:800000, joinDate:new Date('2025-01-10'), active:true });
    const chairperson   = await User.create({ name:'John Musoke',      email:'chair@kteachers.coop',   password:hash('Admin@2025'), role:'chairperson',    groupId:grp1.id, memberId:'KTS-0003', phone:'+256700333333', monthlyContribution:50000, shareCapitalTarget:1000000, shareCapitalPaid:1000000, joinDate:new Date('2025-01-10'), active:true });
    const mem1 = await User.create({ name:'James Kato',     email:'james.kato@gmail.com', password:hash('Member@2025'), role:'member', groupId:grp1.id, memberId:'KTS-0042', phone:'+256701234567', nationalId:'CM12345678', joinDate:new Date('2025-01-15'), monthlyContribution:50000,  shareCapitalTarget:1000000, shareCapitalPaid:600000,  active:true });
    const mem2 = await User.create({ name:'Prossy Nabukenya',email:'prossy.n@gmail.com',   password:hash('Member@2025'), role:'member', groupId:grp1.id, memberId:'KTS-0067', phone:'+256702345678', nationalId:'CF98765432', joinDate:new Date('2025-01-20'), monthlyContribution:30000,  shareCapitalTarget:1000000, shareCapitalPaid:400000,  active:true });
    const mem3 = await User.create({ name:'Robert Opio',    email:'robert.opio@gmail.com', password:hash('Member@2025'), role:'member', groupId:grp1.id, memberId:'KTS-0091', phone:'+256703456789', nationalId:'CM44556677', joinDate:new Date('2025-02-01'), monthlyContribution:20000,  shareCapitalTarget:1000000, shareCapitalPaid:200000,  active:true });
    const mem4 = await User.create({ name:'Aisha Mugisha',  email:'aisha.m@gmail.com',     password:hash('Member@2025'), role:'member', groupId:grp1.id, memberId:'KTS-0105', phone:'+256704567890', nationalId:'CF11223344', joinDate:new Date('2025-02-10'), monthlyContribution:100000, shareCapitalTarget:1000000, shareCapitalPaid:1000000, active:true });
    console.log('✅ Created 10 users');

    // Savings
    const savData = [
      {memberId:mem1.id,groupId:grp1.id,amount:50000, type:'contribution',description:'Monthly contribution — March 2025',   date:new Date('2025-03-15'),postedBy:admin1.id},
      {memberId:mem1.id,groupId:grp1.id,amount:50000, type:'contribution',description:'Monthly contribution — February 2025',date:new Date('2025-02-15'),postedBy:admin1.id},
      {memberId:mem1.id,groupId:grp1.id,amount:176000,type:'interest',    description:'Annual interest credit (8%)',          date:new Date('2025-02-01'),postedBy:admin1.id},
      {memberId:mem1.id,groupId:grp1.id,amount:50000, type:'contribution',description:'Monthly contribution — January 2025',  date:new Date('2025-01-15'),postedBy:admin1.id},
      {memberId:mem2.id,groupId:grp1.id,amount:30000, type:'contribution',description:'Monthly contribution — March 2025',   date:new Date('2025-03-15'),postedBy:admin1.id},
      {memberId:mem2.id,groupId:grp1.id,amount:30000, type:'contribution',description:'Monthly contribution — February 2025',date:new Date('2025-02-15'),postedBy:admin1.id},
      {memberId:mem3.id,groupId:grp1.id,amount:20000, type:'contribution',description:'Monthly contribution — January 2025', date:new Date('2025-01-15'),postedBy:admin1.id},
      {memberId:mem4.id,groupId:grp1.id,amount:100000,type:'contribution',description:'Monthly contribution — March 2025',   date:new Date('2025-03-15'),postedBy:admin1.id},
      {memberId:mem4.id,groupId:grp1.id,amount:100000,type:'contribution',description:'Monthly contribution — February 2025',date:new Date('2025-02-15'),postedBy:admin1.id},
    ];
    await Saving.bulkCreate(savData);

    // Loans
    const loan1 = await Loan.create({ memberId:mem1.id, groupId:grp1.id, loanType:'new_loan', amount:3000000, purpose:'School fees', repaymentMonths:6, monthlyInstallment:540000, totalRepayable:3240000, amountRepaid:1080000, status:'active', creditOfficerStatus:'approved', creditOfficerId:creditOfficer.id, creditOfficerNote:'Verified', creditOfficerAt:new Date('2025-01-21'), treasurerStatus:'approved', treasurerId:treasurer.id, treasurerNote:'Funds available', treasurerAt:new Date('2025-01-22'), chairpersonStatus:'approved', chairpersonId:chairperson.id, chairpersonNote:'Board approved', chairpersonAt:new Date('2025-01-22'), approvedBy:admin1.id, approvedAt:new Date('2025-01-22'), disbursedAt:new Date('2025-01-23'), appliedAt:new Date('2025-01-20'), notes:'Approved' });
    await Loan.create({ memberId:mem3.id, groupId:grp1.id, loanType:'new_loan', amount:1000000, purpose:'Medical expenses', repaymentMonths:3, status:'pending', appliedAt:new Date('2025-03-14'), creditOfficerStatus:'pending', treasurerStatus:'pending', chairpersonStatus:'pending' });
    await Loan.create({ memberId:mem4.id, groupId:grp1.id, loanType:'new_loan', amount:5000000, purpose:'Business capital', repaymentMonths:12, status:'under_review', appliedAt:new Date('2025-03-15'), creditOfficerStatus:'approved', creditOfficerId:creditOfficer.id, creditOfficerNote:'Eligible', creditOfficerAt:new Date('2025-03-16'), treasurerStatus:'pending', chairpersonStatus:'pending' });
    await Repayment.bulkCreate([
      {loanId:loan1.id, memberId:mem1.id, groupId:grp1.id, amount:540000, date:new Date('2025-02-23'), postedBy:admin1.id},
      {loanId:loan1.id, memberId:mem1.id, groupId:grp1.id, amount:540000, date:new Date('2025-03-23'), postedBy:admin1.id},
    ]);
    console.log('✅ Created loans and savings');

    // Expenditures
    await Expenditure.bulkCreate([
      {groupId:grp1.id, amount:150000, category:'Administration', description:'Office stationery', date:new Date('2025-03-01'), postedBy:admin1.id},
      {groupId:grp1.id, amount:300000, category:'Meetings',       description:'AGM refreshments',  date:new Date('2025-02-15'), postedBy:admin1.id},
      {groupId:grp1.id, amount:50000,  category:'Subscription',   description:'YoSACCO monthly',   date:new Date('2025-03-01'), postedBy:admin1.id},
    ]);

    // Invoices
    await Invoice.bulkCreate([
      {groupId:grp1.id, invoiceNumber:'INV-2025-001', type:'monthly', amount:50000, status:'paid',    dueDate:new Date('2025-02-01'), paidAt:new Date('2025-02-01'), paidAmount:50000, periodStart:new Date('2025-02-01'), periodEnd:new Date('2025-02-28')},
      {groupId:grp1.id, invoiceNumber:'INV-2025-002', type:'monthly', amount:50000, status:'paid',    dueDate:new Date('2025-03-01'), paidAt:new Date('2025-03-03'), paidAmount:50000, periodStart:new Date('2025-03-01'), periodEnd:new Date('2025-03-31')},
      {groupId:grp1.id, invoiceNumber:'INV-2025-003', type:'monthly', amount:50000, status:'pending', dueDate:new Date('2025-04-01'), periodStart:new Date('2025-04-01'), periodEnd:new Date('2025-04-30')},
      {groupId:grp2.id, invoiceNumber:'INV-2025-004', type:'annual',  amount:500000,status:'pending', dueDate:new Date('2025-04-01'), periodStart:new Date('2025-01-01'), periodEnd:new Date('2025-12-31')},
    ]);

    // Projects
    const proj1 = await Project.create({ groupId:grp1.id, name:'KTS Unit Trust Fund', type:'unit_trust', description:'Pooled investment fund for members generating annual returns', targetAmount:50000000, raisedAmount:12000000, status:'active', startDate:new Date('2025-01-01'), returnRate:12, createdBy:admin1.id });
    const proj2 = await Project.create({ groupId:grp1.id, name:'SACCO Office Building', type:'property', description:'Construction of a permanent SACCO office and meeting hall', targetAmount:200000000, raisedAmount:35000000, status:'active', startDate:new Date('2025-02-01'), returnRate:0, createdBy:admin1.id });
    await ProjectContribution.bulkCreate([
      {projectId:proj1.id, memberId:mem1.id, groupId:grp1.id, amount:500000, date:new Date('2025-02-15'), postedBy:admin1.id},
      {projectId:proj1.id, memberId:mem4.id, groupId:grp1.id, amount:1000000,date:new Date('2025-02-15'), postedBy:admin1.id},
      {projectId:proj2.id, memberId:mem2.id, groupId:grp1.id, amount:200000, date:new Date('2025-03-01'), postedBy:admin1.id},
    ]);

    // Assets
    await Asset.bulkCreate([
      {groupId:grp1.id, name:'Dell Laptop', category:'equipment', description:'Admin laptop for record keeping', purchaseValue:2500000, currentValue:2000000, purchaseDate:new Date('2024-06-01'), condition:'good', status:'active', createdBy:admin1.id},
      {groupId:grp1.id, name:'Office Furniture Set', category:'furniture', description:'Chairs, tables and shelving for SACCO office', purchaseValue:1800000, currentValue:1500000, purchaseDate:new Date('2024-08-15'), condition:'good', status:'active', createdBy:admin1.id},
      {groupId:grp1.id, name:'Toyota Hiace Van', category:'vehicle', description:'Group transport vehicle', purchaseValue:45000000, currentValue:38000000, purchaseDate:new Date('2023-01-01'), condition:'good', status:'active', createdBy:admin1.id},
    ]);
    console.log('✅ Created projects, contributions and assets');

    await AuditLog.bulkCreate([
      {userId:superAdmin.id, action:'CREATE_GROUP', detail:'Created group: Kampala Teachers SACCO', groupId:grp1.id, timestamp:new Date('2025-01-10')},
      {userId:admin1.id,     action:'ADD_MEMBER',   detail:'Added member: James Kato (KTS-0042)',   groupId:grp1.id, timestamp:new Date('2025-01-15')},
    ]);

    console.log(`
╔══════════════════════════════════════════════════════════════╗
║                   ✅  SEED COMPLETE                          ║
╠══════════════════════════════════════════════════════════════╣
║  superadmin@yosacco.coop     Admin@2025  (Super Admin)       ║
║  admin@kteachers.coop        Admin@2025  (SACCO Admin)       ║
║  credit@kteachers.coop       Admin@2025  (Credit Officer)    ║
║  treasurer@kteachers.coop    Admin@2025  (Treasurer)         ║
║  chair@kteachers.coop        Admin@2025  (Chairperson)       ║
║  james.kato@gmail.com        Member@2025 (Member)            ║
║  aisha.m@gmail.com           Member@2025 (Member)            ║
╚══════════════════════════════════════════════════════════════╝`);
    process.exit(0);
  } catch(err) {
    console.error('\n❌ Seed failed:', err.message);
    if(err.original) console.error('   DB:', err.original.message);
    process.exit(1);
  }
}
seed();
