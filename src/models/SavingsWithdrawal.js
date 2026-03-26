const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');

const SavingsWithdrawal = sequelize.define('SavingsWithdrawal', {
  id:          { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  memberId:    { type: DataTypes.UUID, allowNull: false },
  groupId:     { type: DataTypes.UUID, allowNull: false },
  amount:      { type: DataTypes.INTEGER, allowNull: false },
  reason:      { type: DataTypes.TEXT, allowNull: true },
  status:      {
    type: DataTypes.ENUM('pending','credit_approved','treasurer_approved','chair_approved','approved','rejected'),
    defaultValue: 'pending',
  },
  creditOfficerStatus:  { type: DataTypes.STRING, defaultValue: 'pending' },
  treasurerStatus:      { type: DataTypes.STRING, defaultValue: 'pending' },
  chairpersonStatus:    { type: DataTypes.STRING, defaultValue: 'pending' },
  creditOfficerNote:    { type: DataTypes.TEXT, allowNull: true },
  treasurerNote:        { type: DataTypes.TEXT, allowNull: true },
  chairpersonNote:      { type: DataTypes.TEXT, allowNull: true },
  rejectedBy:           { type: DataTypes.STRING, allowNull: true },
  rejectionReason:      { type: DataTypes.TEXT, allowNull: true },
  disbursedAt:          { type: DataTypes.DATE, allowNull: true },
  disbursedBy:          { type: DataTypes.UUID, allowNull: true },
  appliedAt:            { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
}, { tableName: 'savings_withdrawals', timestamps: true });

module.exports = SavingsWithdrawal;
