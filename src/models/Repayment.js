const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');

const Repayment = sequelize.define('Repayment', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  loanId: {
    type: DataTypes.UUID,
    allowNull: false,
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
  postedBy: {
    type: DataTypes.UUID,
    allowNull: true,
  },
  date: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW,
  },
}, {
  tableName: 'repayments',
  timestamps: true,
});

module.exports = Repayment;
