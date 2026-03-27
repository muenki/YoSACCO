const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');

const Saving = sequelize.define('Saving', {
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
    // Can be negative for deductions (e.g. project funding from savings)
  },
  type: {
    type: DataTypes.ENUM('contribution', 'share_capital', 'interest', 'dividend', 'payout', 'online_deposit', 'project_deduction', 'other'),
    defaultValue: 'contribution',
  },
  description: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  paymentMethod: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  transactionRef: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  postedBy: {
    type: DataTypes.UUID,
    allowNull: true,
  },
  projectId: {
    type: DataTypes.UUID,
    allowNull: true,
  },
  status: {
    type: DataTypes.ENUM('confirmed', 'pending'),
    defaultValue: 'confirmed',
  },
  date: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW,
  },
}, {
  tableName: 'savings',
  timestamps: true,
});

module.exports = Saving;
