const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');

const Loan = sequelize.define('Loan', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  memberId: {
    type: DataTypes.UUID,
    allowNull: false,
  },
  groupId: {
    type: DataTypes.UUID,
    allowNull: false,
  },
  amount: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  purpose: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  repaymentMonths: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  monthlyInstallment: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
  },
  totalRepayable: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
  },
  amountRepaid: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
  },
  status: {
    type: DataTypes.ENUM('pending', 'active', 'repaid', 'declined'),
    defaultValue: 'pending',
  },
  notes: {
    type: DataTypes.TEXT,
    allowNull: true,
  },
  approvedBy: {
    type: DataTypes.UUID,
    allowNull: true,
  },
  approvedAt: {
    type: DataTypes.DATE,
    allowNull: true,
  },
  disbursedAt: {
    type: DataTypes.DATE,
    allowNull: true,
  },
  appliedAt: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW,
  },
}, {
  tableName: 'loans',
  timestamps: true,
});

module.exports = Loan;
