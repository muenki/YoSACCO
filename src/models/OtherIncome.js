const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');

const OtherIncome = sequelize.define('OtherIncome', {
  id:          { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  groupId:     { type: DataTypes.UUID, allowNull: false },
  amount:      { type: DataTypes.INTEGER, allowNull: false },
  source:      { type: DataTypes.STRING, allowNull: false },
  description: { type: DataTypes.TEXT, allowNull: true },
  date:        { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
  postedBy:    { type: DataTypes.UUID, allowNull: true },
}, { tableName: 'other_incomes', timestamps: true });

module.exports = OtherIncome;
