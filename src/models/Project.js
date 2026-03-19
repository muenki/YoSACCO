const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');

const Project = sequelize.define('Project', {
  id:           { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  groupId:      { type: DataTypes.UUID, allowNull: false },
  name:         { type: DataTypes.STRING, allowNull: false },
  type:         { type: DataTypes.ENUM('unit_trust','property','equipment','other'), defaultValue: 'other' },
  description:  { type: DataTypes.TEXT, allowNull: true },
  targetAmount: { type: DataTypes.INTEGER, defaultValue: 0 },
  raisedAmount: { type: DataTypes.INTEGER, defaultValue: 0 },
  status:       { type: DataTypes.ENUM('active','completed','suspended'), defaultValue: 'active' },
  startDate:    { type: DataTypes.DATE, allowNull: true },
  endDate:      { type: DataTypes.DATE, allowNull: true },
  returnRate:   { type: DataTypes.FLOAT, defaultValue: 0 }, // % annual return
  createdBy:    { type: DataTypes.UUID, allowNull: true },
}, { tableName: 'projects', timestamps: true });

module.exports = Project;
