// ── YoSACCO Database Seeder ───────────────────────────────────────
// Run once: node src/seeders/seed.js
// Re-run:   node src/seeders/seed.js --force  (drops & recreates all tables)

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
      if (existing > 0) {
        console.log('\n⚠️  Data already exists. Use --force to reseed.');
        process.exit(0);
      }
    }

    // ── SACCO Groups ──────────────────────────────────────────────
    console.log('\n🏦 Creating SACCO groups...');
    const grp1 = await Group.create({
      id: '11111111-1111-1111-1111-111111111111',
      name: 'Kampala Teachers SACCO',
      slug: 'kampala-teachers',
      accentColor: '#0D7377',
      adminEmail: 'admin@kteachers.coop',
      active: true,
    });
    const grp2 = await Group.create({
      id: '22222222-2222-2222-2222-222222222222',
      name: 'Lira Farmers Cooperative',
      slug: 'lira-farmers',
      accentColor: '#1A7F4B',
      adminEmail: 'admin@lirafarmers.coop',
      active: true,
    });
    console.log('✅ Created 2 SACCO groups');

    // ── Users ─────────────────────────────────────────────────────
    console.log('\n👤 Creating users...');
    await User.create({
      id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      name: 'YoSACCO Admin',
      email: 'superadmin@yosacco.coop',
      password: hash('Admin@2025'),
      role: 'superadmin',
      groupId: null,
      active: true,
    });

    await User.create({
      id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
      name: 'Grace Nakato',
      email: 'admin@kteachers.coop',
      password: hash('Admin@2025'),
      role: 'admin',
      groupId: grp1.id,
      active: true,
    });

    await User.create({
      id: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
      name: 'Moses Okello',
      email: 'admin@lirafarmers.coop',
      password: hash('Admin@2025'),
      role: 'admin',
      groupId: grp2.id,
      active: true,
    });

    const mem1 = await User.create({
      id: 'dddddddd-dddd-dddd-dddd-dddddddddddd',
      name: 'James Kato',
      email: 'james.kato@gmail.com',
      password: hash('Member@2025'),
      role: 'member',
      groupId: grp1.id,
      memberId: 'KTS-0042',
      phone: '+256701234567',
      nationalId: 'CM12345678',
      joinDate: new Date('2025-01-15'),
      monthlyContribution: 50000,
      shareCapitalTarget: 1000000,
      shareCapitalPaid: 600000,
      active: true,
    });

    const mem2 = await User.create({
      id: 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
      name: 'Prossy Nabukenya',
      email: 'prossy.n@gmail.com',
      password: hash('Member@2025'),
      role: 'member',
      groupId: grp1.id,
      memberId: 'KTS-0067',
      phone: '+256702345678',
      nationalId: 'CF98765432',
      joinDate: new Date('2025-01-20'),
      monthlyContribution: 30000,
      shareCapitalTarget: 1000000,
      shareCapitalPaid: 400000,
      active: true,
    });

    const mem3 = await User.create({
      id: 'ffffffff-ffff-ffff-ffff-ffffffffffff',
      name: 'Robert Opio',
      email: 'robert.opio@gmail.com',
      password: hash('Member@2025'),
      role: 'member',
      groupId: grp1.id,
      memberId: 'KTS-0091',
      phone: '+256703456789',
      nationalId: 'CM44556677',
      joinDate: new Date('2025-02-01'),
      monthlyContribution: 20000,
      shareCapitalTarget: 1000000,
      shareCapitalPaid: 200000,
      active: true,
    });

    const mem4 = await User.create({
      id: '44444444-4444-4444-4444-444444444444',
      name: 'Aisha Mugisha',
      email: 'aisha.m@gmail.com',
      password: hash('Member@2025'),
      role: 'member',
      groupId: grp1.id,
      memberId: 'KTS-0105',
      phone: '+256704567890',
      nationalId: 'CF11223344',
      joinDate: new Date('2025-02-10'),
      monthlyContribution: 100000,
      shareCapitalTarget: 1000000,
      shareCapitalPaid: 1000000,
      active: true,
    });
    console.log('✅ Created 7 users (1 super admin, 2 admins, 4 members)');

    // ── Savings ───────────────────────────────────────────────────
    console.log('\n💰 Creating savings transactions...');
    const savingsData = [
      { memberId: mem1.id, groupId: grp1.id, amount: 50000,  type: 'contribution', description: 'Monthly contribution — March 2025',    date: new Date('2025-03-15'), postedBy: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' },
      { memberId: mem1.id, groupId: grp1.id, amount: 50000,  type: 'contribution', description: 'Monthly contribution — February 2025', date: new Date('2025-02-15'), postedBy: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' },
      { memberId: mem1.id, groupId: grp1.id, amount: 176000, type: 'interest',      description: 'Annual interest credit (8%)',           date: new Date('2025-02-01'), postedBy: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' },
      { memberId: mem1.id, groupId: grp1.id, amount: 50000,  type: 'contribution', description: 'Monthly contribution — January 2025',   date: new Date('2025-01-15'), postedBy: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' },
      { memberId: mem2.id, groupId: grp1.id, amount: 30000,  type: 'contribution', description: 'Monthly contribution — March 2025',    date: new Date('2025-03-15'), postedBy: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' },
      { memberId: mem2.id, groupId: grp1.id, amount: 30000,  type: 'contribution', description: 'Monthly contribution — February 2025', date: new Date('2025-02-15'), postedBy: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' },
      { memberId: mem3.id, groupId: grp1.id, amount: 20000,  type: 'contribution', description: 'Monthly contribution — January 2025',   date: new Date('2025-01-15'), postedBy: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' },
      { memberId: mem4.id, groupId: grp1.id, amount: 100000, type: 'contribution', description: 'Monthly contribution — March 2025',    date: new Date('2025-03-15'), postedBy: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' },
      { memberId: mem4.id, groupId: grp1.id, amount: 100000, type: 'contribution', description: 'Monthly contribution — February 2025', date: new Date('2025-02-15'), postedBy: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' },
    ];
    await Saving.bulkCreate(savingsData);
    console.log(`✅ Created ${savingsData.length} savings transactions`);

    // ── Loans ─────────────────────────────────────────────────────
    console.log('\n📋 Creating loans...');
    const loan1 = await Loan.create({
      id: 'loan1111-1111-1111-1111-111111111111',
      memberId: mem1.id,
      groupId: grp1.id,
      amount: 3000000,
      purpose: 'School fees',
      repaymentMonths: 6,
      monthlyInstallment: 540000,
      totalRepayable: 3240000,
      amountRepaid: 1080000,
      status: 'active',
      appliedAt: new Date('2025-01-20'),
      approvedAt: new Date('2025-01-22'),
      approvedBy: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
      disbursedAt: new Date('2025-01-23'),
      notes: 'Approved — member in good standing',
    });

    await Loan.create({
      id: 'loan2222-2222-2222-2222-222222222222',
      memberId: mem3.id,
      groupId: grp1.id,
      amount: 1000000,
      purpose: 'Medical expenses',
      repaymentMonths: 3,
      status: 'pending',
      appliedAt: new Date('2025-03-14'),
    });

    await Loan.create({
      id: 'loan3333-3333-3333-3333-333333333333',
      memberId: mem4.id,
      groupId: grp1.id,
      amount: 5000000,
      purpose: 'Business capital',
      repaymentMonths: 12,
      status: 'pending',
      appliedAt: new Date('2025-03-15'),
    });
    console.log('✅ Created 3 loans (1 active, 2 pending)');

    // ── Repayments ────────────────────────────────────────────────
    console.log('\n💳 Creating repayments...');
    await Repayment.bulkCreate([
      { loanId: loan1.id, memberId: mem1.id, groupId: grp1.id, amount: 540000, date: new Date('2025-02-23'), postedBy: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' },
      { loanId: loan1.id, memberId: mem1.id, groupId: grp1.id, amount: 540000, date: new Date('2025-03-23'), postedBy: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' },
    ]);
    console.log('✅ Created 2 repayments');

    // ── Audit Log ─────────────────────────────────────────────────
    console.log('\n🔍 Creating audit entries...');
    await AuditLog.bulkCreate([
      { userId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', action: 'CREATE_GROUP', detail: 'Created SACCO group: Kampala Teachers SACCO',  groupId: grp1.id, timestamp: new Date('2025-01-10') },
      { userId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', action: 'CREATE_GROUP', detail: 'Created SACCO group: Lira Farmers Cooperative', groupId: grp2.id, timestamp: new Date('2025-02-01') },
      { userId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', action: 'ADD_MEMBER',   detail: 'Added member: James Kato (KTS-0042)',           groupId: grp1.id, timestamp: new Date('2025-01-15') },
      { userId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', action: 'APPROVE_LOAN', detail: 'Approved loan for James Kato — UGX 3,000,000',  groupId: grp1.id, timestamp: new Date('2025-01-22') },
    ]);
    console.log('✅ Created 4 audit entries');

    console.log(`
╔══════════════════════════════════════════════════════════╗
║              ✅  SEED COMPLETE                           ║
╠══════════════════════════════════════════════════════════╣
║  Database: ${process.env.DB_NAME.padEnd(44)} ║
║                                                          ║
║  LOGIN CREDENTIALS:                                      ║
║  Super Admin : superadmin@yosacco.coop / Admin@2025      ║
║  SACCO Admin : admin@kteachers.coop   / Admin@2025       ║
║  Member      : james.kato@gmail.com   / Member@2025      ║
║  Member      : aisha.m@gmail.com      / Member@2025      ║
╚══════════════════════════════════════════════════════════╝
    `);
    process.exit(0);

  } catch (err) {
    console.error('\n❌ Seed failed:', err.message);
    if (err.original) console.error('   DB error:', err.original.message);
    process.exit(1);
  }
}

seed();
