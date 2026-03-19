require('dotenv').config();
const bcrypt = require('bcryptjs');
const { sequelize, Group, User, Saving, Loan, Repayment, AuditLog } = require('../models');

const force = process.argv.includes('--force');
const hash  = (p) => bcrypt.hashSync(p, 10);

async function seed() {
  try {
    console.log('🔌 Connecting to PostgreSQL...');
    await sequelize.authenticate();
    console.log('✅ Connected to database:', process.env.DB_NAME);

    console.log(`\n📦 Syncing models (force=${force})...`);
    await sequelize.sync({ force });
    console.log('✅ All tables created');

    if (!force) {
      const existing = await Group.count();
      if (existing > 0) { console.log('\n⚠️  Data already exists. Use --force to reseed.'); process.exit(0); }
    }

    // ── Groups ────────────────────────────────────────────────────
    console.log('\n🏦 Creating SACCO groups...');
    const grp1 = await Group.create({ name: 'Kampala Teachers SACCO', slug: 'kampala-teachers', accentColor: '#0D7377', adminEmail: 'admin@kteachers.coop', active: true });
    const grp2 = await Group.create({ name: 'Lira Farmers Cooperative', slug: 'lira-farmers', accentColor: '#1A7F4B', adminEmail: 'admin@lirafarmers.coop', active: true });
    console.log('✅ Created 2 SACCO groups');

    // ── Users ─────────────────────────────────────────────────────
    console.log('\n👤 Creating users...');
    const superAdmin = await User.create({ name: 'YoSACCO Admin', email: 'superadmin@yosacco.coop', password: hash('Admin@2025'), role: 'superadmin', active: true });
    const admin1     = await User.create({ name: 'Grace Nakato',  email: 'admin@kteachers.coop',    password: hash('Admin@2025'), role: 'admin',       groupId: grp1.id, active: true });
    await              User.create({ name: 'Moses Okello',  email: 'admin@lirafarmers.coop',  password: hash('Admin@2025'), role: 'admin',       groupId: grp2.id, active: true });

    // 3 approval officers for Kampala Teachers SACCO
    const creditOfficer = await User.create({ name: 'Peter Ssemakula', email: 'credit@kteachers.coop',  password: hash('Admin@2025'), role: 'credit_officer', groupId: grp1.id, active: true });
    const treasurer     = await User.create({ name: 'Sarah Nambi',     email: 'treasurer@kteachers.coop',password: hash('Admin@2025'), role: 'treasurer',      groupId: grp1.id, active: true });
    const chairperson   = await User.create({ name: 'John Musoke',     email: 'chair@kteachers.coop',   password: hash('Admin@2025'), role: 'chairperson',    groupId: grp1.id, active: true });

    const mem1 = await User.create({ name: 'James Kato',      email: 'james.kato@gmail.com', password: hash('Member@2025'), role: 'member', groupId: grp1.id, memberId: 'KTS-0042', phone: '+256701234567', nationalId: 'CM12345678', joinDate: new Date('2025-01-15'), monthlyContribution: 50000,  shareCapitalTarget: 1000000, shareCapitalPaid: 600000,  active: true });
    const mem2 = await User.create({ name: 'Prossy Nabukenya',email: 'prossy.n@gmail.com',   password: hash('Member@2025'), role: 'member', groupId: grp1.id, memberId: 'KTS-0067', phone: '+256702345678', nationalId: 'CF98765432', joinDate: new Date('2025-01-20'), monthlyContribution: 30000,  shareCapitalTarget: 1000000, shareCapitalPaid: 400000,  active: true });
    const mem3 = await User.create({ name: 'Robert Opio',     email: 'robert.opio@gmail.com',password: hash('Member@2025'), role: 'member', groupId: grp1.id, memberId: 'KTS-0091', phone: '+256703456789', nationalId: 'CM44556677', joinDate: new Date('2025-02-01'), monthlyContribution: 20000,  shareCapitalTarget: 1000000, shareCapitalPaid: 200000,  active: true });
    const mem4 = await User.create({ name: 'Aisha Mugisha',   email: 'aisha.m@gmail.com',    password: hash('Member@2025'), role: 'member', groupId: grp1.id, memberId: 'KTS-0105', phone: '+256704567890', nationalId: 'CF11223344', joinDate: new Date('2025-02-10'), monthlyContribution: 100000, shareCapitalTarget: 1000000, shareCapitalPaid: 1000000, active: true });
    console.log('✅ Created 10 users (1 super, 2 admins, 3 officers, 4 members)');

    // ── Savings ───────────────────────────────────────────────────
    console.log('\n💰 Creating savings transactions...');
    await Saving.bulkCreate([
      { memberId: mem1.id, groupId: grp1.id, amount: 50000,  type: 'contribution', description: 'Monthly contribution — March 2025',    date: new Date('2025-03-15'), postedBy: admin1.id },
      { memberId: mem1.id, groupId: grp1.id, amount: 50000,  type: 'contribution', description: 'Monthly contribution — February 2025', date: new Date('2025-02-15'), postedBy: admin1.id },
      { memberId: mem1.id, groupId: grp1.id, amount: 176000, type: 'interest',     description: 'Annual interest credit (8%)',           date: new Date('2025-02-01'), postedBy: admin1.id },
      { memberId: mem1.id, groupId: grp1.id, amount: 50000,  type: 'contribution', description: 'Monthly contribution — January 2025',   date: new Date('2025-01-15'), postedBy: admin1.id },
      { memberId: mem2.id, groupId: grp1.id, amount: 30000,  type: 'contribution', description: 'Monthly contribution — March 2025',    date: new Date('2025-03-15'), postedBy: admin1.id },
      { memberId: mem2.id, groupId: grp1.id, amount: 30000,  type: 'contribution', description: 'Monthly contribution — February 2025', date: new Date('2025-02-15'), postedBy: admin1.id },
      { memberId: mem3.id, groupId: grp1.id, amount: 20000,  type: 'contribution', description: 'Monthly contribution — January 2025',   date: new Date('2025-01-15'), postedBy: admin1.id },
      { memberId: mem4.id, groupId: grp1.id, amount: 100000, type: 'contribution', description: 'Monthly contribution — March 2025',    date: new Date('2025-03-15'), postedBy: admin1.id },
      { memberId: mem4.id, groupId: grp1.id, amount: 100000, type: 'contribution', description: 'Monthly contribution — February 2025', date: new Date('2025-02-15'), postedBy: admin1.id },
    ]);
    console.log('✅ Created 9 savings transactions');

    // ── Loans ─────────────────────────────────────────────────────
    console.log('\n📋 Creating loans...');
    // Active loan — fully approved by all 3
    const loan1 = await Loan.create({
      memberId: mem1.id, groupId: grp1.id, loanType: 'new_loan',
      amount: 3000000, purpose: 'School fees', repaymentMonths: 6,
      monthlyInstallment: 540000, totalRepayable: 3240000, amountRepaid: 1080000,
      status: 'active',
      creditOfficerStatus: 'approved', creditOfficerId: creditOfficer.id, creditOfficerNote: 'Verified savings and eligibility', creditOfficerAt: new Date('2025-01-21'),
      treasurerStatus: 'approved',     treasurerId: treasurer.id,         treasurerNote: 'Funds available',                      treasurerAt:      new Date('2025-01-22'),
      chairpersonStatus: 'approved',   chairpersonId: chairperson.id,     chairpersonNote: 'Approved by board',                  chairpersonAt:    new Date('2025-01-22'),
      approvedBy: admin1.id, approvedAt: new Date('2025-01-22'), disbursedAt: new Date('2025-01-23'),
      appliedAt: new Date('2025-01-20'), notes: 'Approved — member in good standing',
    });

    // Pending loan — at credit officer stage
    await Loan.create({
      memberId: mem3.id, groupId: grp1.id, loanType: 'new_loan',
      amount: 1000000, purpose: 'Medical expenses', repaymentMonths: 3,
      status: 'pending', appliedAt: new Date('2025-03-14'),
      creditOfficerStatus: 'pending', treasurerStatus: 'pending', chairpersonStatus: 'pending',
    });

    // Under review — credit officer approved, waiting treasurer
    await Loan.create({
      memberId: mem4.id, groupId: grp1.id, loanType: 'new_loan',
      amount: 5000000, purpose: 'Business capital', repaymentMonths: 12,
      status: 'under_review', appliedAt: new Date('2025-03-15'),
      creditOfficerStatus: 'approved', creditOfficerId: creditOfficer.id, creditOfficerNote: 'Member eligible', creditOfficerAt: new Date('2025-03-16'),
      treasurerStatus: 'pending', chairpersonStatus: 'pending',
    });
    console.log('✅ Created 3 loans');

    // ── Repayments ────────────────────────────────────────────────
    console.log('\n💳 Creating repayments...');
    await Repayment.bulkCreate([
      { loanId: loan1.id, memberId: mem1.id, groupId: grp1.id, amount: 540000, date: new Date('2025-02-23'), postedBy: admin1.id },
      { loanId: loan1.id, memberId: mem1.id, groupId: grp1.id, amount: 540000, date: new Date('2025-03-23'), postedBy: admin1.id },
    ]);
    console.log('✅ Created 2 repayments');

    // ── Audit ─────────────────────────────────────────────────────
    console.log('\n🔍 Creating audit entries...');
    await AuditLog.bulkCreate([
      { userId: superAdmin.id,     action: 'CREATE_GROUP',      detail: 'Created group: Kampala Teachers SACCO',   groupId: grp1.id, timestamp: new Date('2025-01-10') },
      { userId: admin1.id,         action: 'ADD_MEMBER',        detail: 'Added member: James Kato (KTS-0042)',      groupId: grp1.id, timestamp: new Date('2025-01-15') },
      { userId: creditOfficer.id,  action: 'LOAN_CO_APPROVED',  detail: 'Credit Officer approved loan for James Kato', groupId: grp1.id, timestamp: new Date('2025-01-21') },
      { userId: chairperson.id,    action: 'LOAN_DISBURSED',    detail: 'Loan disbursed to James Kato — UGX 3,000,000', groupId: grp1.id, timestamp: new Date('2025-01-23') },
    ]);
    console.log('✅ Created 4 audit entries');

    console.log(`
╔══════════════════════════════════════════════════════════════╗
║                  ✅  SEED COMPLETE                           ║
╠══════════════════════════════════════════════════════════════╣
║  DATABASE : ${process.env.DB_NAME.padEnd(48)} ║
║                                                              ║
║  ROLE           EMAIL                        PASSWORD        ║
║  Super Admin    superadmin@yosacco.coop       Admin@2025     ║
║  SACCO Admin    admin@kteachers.coop          Admin@2025     ║
║  Credit Officer credit@kteachers.coop         Admin@2025     ║
║  Treasurer      treasurer@kteachers.coop      Admin@2025     ║
║  Chairperson    chair@kteachers.coop          Admin@2025     ║
║  Member         james.kato@gmail.com          Member@2025    ║
║  Member         aisha.m@gmail.com             Member@2025    ║
╚══════════════════════════════════════════════════════════════╝
    `);
    process.exit(0);
  } catch (err) {
    console.error('\n❌ Seed failed:', err.message);
    if (err.original) console.error('   DB error:', err.original.message);
    process.exit(1);
  }
}

seed();
