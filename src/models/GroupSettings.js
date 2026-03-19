const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');

const GroupSettings = sequelize.define('GroupSettings', {
  id:                    { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  groupId:               { type: DataTypes.UUID, allowNull: false, unique: true },
  accountNumber:         { type: DataTypes.STRING, allowNull: true },
  bankName:              { type: DataTypes.STRING, allowNull: true },
  mtnMomoNumber:         { type: DataTypes.STRING, allowNull: true },
  airtelMoneyNumber:     { type: DataTypes.STRING, allowNull: true },
  // Loan terms
  newLoanInterestRate:   { type: DataTypes.FLOAT, defaultValue: 1.5 },
  topupInterestRate:     { type: DataTypes.FLOAT, defaultValue: 1.5 },
  emergencyInterestRate: { type: DataTypes.FLOAT, defaultValue: 2.0 },
  newLoanMaxMultiplier:  { type: DataTypes.FLOAT, defaultValue: 3.0 },
  emergencyMaxMultiplier:{ type: DataTypes.FLOAT, defaultValue: 1.0 },
  loanProcessingFee:     { type: DataTypes.FLOAT, defaultValue: 0 },
  loanTermsText:         { type: DataTypes.TEXT, allowNull: true },
  minMonthlySavings:     { type: DataTypes.INTEGER, defaultValue: 10000 },
  shareCapitalTarget:    { type: DataTypes.INTEGER, defaultValue: 1000000 },
  // Interest distribution method
  interestDistributionMethod: {
    type: DataTypes.ENUM('share_capital_only','share_capital_and_savings','savings_only'),
    defaultValue: 'share_capital_and_savings',
  },
  // Subscription
  subscriptionType:      { type: DataTypes.ENUM('monthly','annual'), defaultValue: 'monthly' },
  subscriptionAmount:    { type: DataTypes.INTEGER, defaultValue: 50000 },
}, { tableName: 'group_settings', timestamps: true });

module.exports = GroupSettings;
