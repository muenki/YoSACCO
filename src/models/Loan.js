const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');

const Loan = sequelize.define('Loan', {
  id:                 { type: DataTypes.UUID,    defaultValue: DataTypes.UUIDV4, primaryKey: true },
  memberId:           { type: DataTypes.UUID,    allowNull: false },
  groupId:            { type: DataTypes.UUID,    allowNull: false },
  loanType: {
    type: DataTypes.ENUM('new_loan','top_up','emergency'),
    defaultValue: 'new_loan',
  },
  amount:             { type: DataTypes.INTEGER, allowNull: false },
  purpose:            { type: DataTypes.STRING,  allowNull: false },
  repaymentMonths:    { type: DataTypes.INTEGER, allowNull: false },
  monthlyInstallment: { type: DataTypes.INTEGER, defaultValue: 0 },
  totalRepayable:     { type: DataTypes.INTEGER, defaultValue: 0 },
  amountRepaid:       { type: DataTypes.INTEGER, defaultValue: 0 },

  // 3-level approval
  status: {
    type: DataTypes.ENUM('pending','under_review','approved','rejected','active','repaid','declined'),
    defaultValue: 'pending',
  },

  // Stage 1 — Credit Officer
  creditOfficerStatus:  { type: DataTypes.ENUM('pending','approved','rejected'), defaultValue: 'pending' },
  creditOfficerId:      { type: DataTypes.UUID,   allowNull: true },
  creditOfficerNote:    { type: DataTypes.TEXT,   allowNull: true },
  creditOfficerAt:      { type: DataTypes.DATE,   allowNull: true },

  // Stage 2 — Treasurer
  treasurerStatus:      { type: DataTypes.ENUM('pending','approved','rejected'), defaultValue: 'pending' },
  treasurerId:          { type: DataTypes.UUID,   allowNull: true },
  treasurerNote:        { type: DataTypes.TEXT,   allowNull: true },
  treasurerAt:          { type: DataTypes.DATE,   allowNull: true },

  // Stage 3 — Chairperson
  chairpersonStatus:    { type: DataTypes.ENUM('pending','approved','rejected'), defaultValue: 'pending' },
  chairpersonId:        { type: DataTypes.UUID,   allowNull: true },
  chairpersonNote:      { type: DataTypes.TEXT,   allowNull: true },
  chairpersonAt:        { type: DataTypes.DATE,   allowNull: true },

  // Final disbursement (done by admin after all 3 approve)
  approvedBy:           { type: DataTypes.UUID,   allowNull: true },
  approvedAt:           { type: DataTypes.DATE,   allowNull: true },
  disbursedAt:          { type: DataTypes.DATE,   allowNull: true },
  notes:                { type: DataTypes.TEXT,   allowNull: true },
  appliedAt:            { type: DataTypes.DATE,   defaultValue: DataTypes.NOW },

  // For top-ups: reference to parent loan
  parentLoanId:         { type: DataTypes.UUID,   allowNull: true },
}, { tableName: 'loans', timestamps: true });

module.exports = Loan;
