// ─── YoSACCO In-Memory Database ───────────────────────────────────────────────
// In production, replace with PostgreSQL + Sequelize/Prisma

const bcrypt = require('bcryptjs');

const hash = (p) => bcrypt.hashSync(p, 10);

const db = {
  // ── SACCO Groups ────────────────────────────────────────────────
  groups: [
    {
      id: 'grp-001',
      name: 'Kampala Teachers SACCO',
      slug: 'kampala-teachers',
      logo: null,
      accentColor: '#0D7377',
      adminEmail: 'admin@kteachers.coop',
      memberCount: 0,
      totalSavings: 0,
      active: true,
      createdAt: new Date('2025-01-10'),
    },
    {
      id: 'grp-002',
      name: 'Lira Farmers Cooperative',
      slug: 'lira-farmers',
      logo: null,
      accentColor: '#1A7F4B',
      adminEmail: 'admin@lirafarmers.coop',
      memberCount: 0,
      totalSavings: 0,
      active: true,
      createdAt: new Date('2025-02-01'),
    },
  ],

  // ── Users (Super Admin + SACCO Admins + Members) ────────────────
  users: [
    {
      id: 'usr-superadmin',
      name: 'YoSACCO Admin',
      email: 'superadmin@yosacco.coop',
      password: hash('Admin@2025'),
      role: 'superadmin',
      groupId: null,
      active: true,
      createdAt: new Date('2025-01-01'),
    },
    {
      id: 'usr-admin-001',
      name: 'Grace Nakato',
      email: 'admin@kteachers.coop',
      password: hash('Admin@2025'),
      role: 'admin',
      groupId: 'grp-001',
      active: true,
      createdAt: new Date('2025-01-10'),
    },
    {
      id: 'usr-admin-002',
      name: 'Moses Okello',
      email: 'admin@lirafarmers.coop',
      password: hash('Admin@2025'),
      role: 'admin',
      groupId: 'grp-002',
      active: true,
      createdAt: new Date('2025-02-01'),
    },
    {
      id: 'usr-mem-001',
      name: 'James Kato',
      email: 'james.kato@gmail.com',
      password: hash('Member@2025'),
      role: 'member',
      groupId: 'grp-001',
      memberId: 'KTS-0042',
      phone: '+256701234567',
      nationalId: 'CM12345678',
      joinDate: new Date('2025-01-15'),
      monthlyContribution: 50000,
      shareCapitalTarget: 1000000,
      shareCapitalPaid: 600000,
      active: true,
      createdAt: new Date('2025-01-15'),
    },
    {
      id: 'usr-mem-002',
      name: 'Prossy Nabukenya',
      email: 'prossy.n@gmail.com',
      password: hash('Member@2025'),
      role: 'member',
      groupId: 'grp-001',
      memberId: 'KTS-0067',
      phone: '+256702345678',
      nationalId: 'CF98765432',
      joinDate: new Date('2025-01-20'),
      monthlyContribution: 30000,
      shareCapitalTarget: 1000000,
      shareCapitalPaid: 400000,
      active: true,
      createdAt: new Date('2025-01-20'),
    },
    {
      id: 'usr-mem-003',
      name: 'Robert Opio',
      email: 'robert.opio@gmail.com',
      password: hash('Member@2025'),
      role: 'member',
      groupId: 'grp-001',
      memberId: 'KTS-0091',
      phone: '+256703456789',
      nationalId: 'CM44556677',
      joinDate: new Date('2025-02-01'),
      monthlyContribution: 20000,
      shareCapitalTarget: 1000000,
      shareCapitalPaid: 200000,
      active: true,
      createdAt: new Date('2025-02-01'),
    },
    {
      id: 'usr-mem-004',
      name: 'Aisha Mugisha',
      email: 'aisha.m@gmail.com',
      password: hash('Member@2025'),
      role: 'member',
      groupId: 'grp-001',
      memberId: 'KTS-0105',
      phone: '+256704567890',
      nationalId: 'CF11223344',
      joinDate: new Date('2025-02-10'),
      monthlyContribution: 100000,
      shareCapitalTarget: 1000000,
      shareCapitalPaid: 1000000,
      active: true,
      createdAt: new Date('2025-02-10'),
    },
  ],

  // ── Savings Transactions ─────────────────────────────────────────
  savings: [
    { id: 'sav-001', memberId: 'usr-mem-001', groupId: 'grp-001', amount: 50000, type: 'contribution', description: 'Monthly contribution — March 2025', date: new Date('2025-03-15'), postedBy: 'usr-admin-001' },
    { id: 'sav-002', memberId: 'usr-mem-001', groupId: 'grp-001', amount: 50000, type: 'contribution', description: 'Monthly contribution — February 2025', date: new Date('2025-02-15'), postedBy: 'usr-admin-001' },
    { id: 'sav-003', memberId: 'usr-mem-001', groupId: 'grp-001', amount: 176000, type: 'interest', description: 'Annual interest credit (8%)', date: new Date('2025-02-01'), postedBy: 'usr-admin-001' },
    { id: 'sav-004', memberId: 'usr-mem-001', groupId: 'grp-001', amount: 50000, type: 'contribution', description: 'Monthly contribution — January 2025', date: new Date('2025-01-15'), postedBy: 'usr-admin-001' },
    { id: 'sav-005', memberId: 'usr-mem-002', groupId: 'grp-001', amount: 30000, type: 'contribution', description: 'Monthly contribution — March 2025', date: new Date('2025-03-15'), postedBy: 'usr-admin-001' },
    { id: 'sav-006', memberId: 'usr-mem-002', groupId: 'grp-001', amount: 30000, type: 'contribution', description: 'Monthly contribution — February 2025', date: new Date('2025-02-15'), postedBy: 'usr-admin-001' },
    { id: 'sav-007', memberId: 'usr-mem-003', groupId: 'grp-001', amount: 20000, type: 'contribution', description: 'Monthly contribution — January 2025', date: new Date('2025-01-15'), postedBy: 'usr-admin-001' },
    { id: 'sav-008', memberId: 'usr-mem-004', groupId: 'grp-001', amount: 100000, type: 'contribution', description: 'Monthly contribution — March 2025', date: new Date('2025-03-15'), postedBy: 'usr-admin-001' },
    { id: 'sav-009', memberId: 'usr-mem-004', groupId: 'grp-001', amount: 100000, type: 'contribution', description: 'Monthly contribution — February 2025', date: new Date('2025-02-15'), postedBy: 'usr-admin-001' },
  ],

  // ── Loan Applications ────────────────────────────────────────────
  loans: [
    {
      id: 'loan-001',
      memberId: 'usr-mem-001',
      groupId: 'grp-001',
      amount: 3000000,
      purpose: 'School fees',
      repaymentMonths: 6,
      monthlyInstallment: 540000,
      totalRepayable: 3240000,
      amountRepaid: 1080000,
      status: 'active',
      appliedAt: new Date('2025-01-20'),
      approvedAt: new Date('2025-01-22'),
      approvedBy: 'usr-admin-001',
      disbursedAt: new Date('2025-01-23'),
      notes: 'Approved — member in good standing',
    },
    {
      id: 'loan-002',
      memberId: 'usr-mem-003',
      groupId: 'grp-001',
      amount: 1000000,
      purpose: 'Medical expenses',
      repaymentMonths: 3,
      monthlyInstallment: 0,
      totalRepayable: 0,
      amountRepaid: 0,
      status: 'pending',
      appliedAt: new Date('2025-03-14'),
      approvedAt: null,
      approvedBy: null,
      disbursedAt: null,
      notes: '',
    },
    {
      id: 'loan-003',
      memberId: 'usr-mem-004',
      groupId: 'grp-001',
      amount: 5000000,
      purpose: 'Business capital',
      repaymentMonths: 12,
      monthlyInstallment: 0,
      totalRepayable: 0,
      amountRepaid: 0,
      status: 'pending',
      appliedAt: new Date('2025-03-15'),
      approvedAt: null,
      approvedBy: null,
      disbursedAt: null,
      notes: '',
    },
  ],

  // ── Loan Repayments ──────────────────────────────────────────────
  repayments: [
    { id: 'rep-001', loanId: 'loan-001', memberId: 'usr-mem-001', groupId: 'grp-001', amount: 540000, date: new Date('2025-02-23'), postedBy: 'usr-admin-001' },
    { id: 'rep-002', loanId: 'loan-001', memberId: 'usr-mem-001', groupId: 'grp-001', amount: 540000, date: new Date('2025-03-23'), postedBy: 'usr-admin-001' },
  ],

  // ── Audit Log ────────────────────────────────────────────────────
  auditLog: [],

  // ── Helpers ──────────────────────────────────────────────────────
  nextId(prefix) {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2,7)}`;
  },

  getSavingsBalance(memberId) {
    return this.savings
      .filter(s => s.memberId === memberId)
      .reduce((sum, s) => sum + s.amount, 0);
  },

  getActiveLoan(memberId) {
    return this.loans.find(l => l.memberId === memberId && l.status === 'active') || null;
  },

  getMemberStats(groupId) {
    const members = this.users.filter(u => u.role === 'member' && u.groupId === groupId);
    const totalSavings = members.reduce((sum, m) => sum + this.getSavingsBalance(m.id), 0);
    const activeLoans = this.loans.filter(l => l.groupId === groupId && l.status === 'active');
    const pendingLoans = this.loans.filter(l => l.groupId === groupId && l.status === 'pending');
    const loanPortfolio = activeLoans.reduce((sum, l) => sum + (l.totalRepayable - l.amountRepaid), 0);
    return { memberCount: members.length, totalSavings, activeLoans: activeLoans.length, loanPortfolio, pendingLoans: pendingLoans.length };
  },

  log(userId, action, detail, groupId = null) {
    this.auditLog.unshift({ id: this.nextId('log'), userId, action, detail, groupId, timestamp: new Date() });
  },
};

// Calculate balances dynamically
Object.defineProperty(db, 'memberBalances', {
  get() {
    const balances = {};
    for (const u of this.users.filter(u => u.role === 'member')) {
      balances[u.id] = this.getSavingsBalance(u.id);
    }
    return balances;
  }
});

module.exports = db;
