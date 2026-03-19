const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');

const Asset = sequelize.define('Asset', {
  id:             { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  groupId:        { type: DataTypes.UUID, allowNull: false },
  name:           { type: DataTypes.STRING, allowNull: false },
  category:       { type: DataTypes.ENUM('property','vehicle','equipment','furniture','investment','other'), defaultValue: 'other' },
  description:    { type: DataTypes.TEXT, allowNull: true },
  purchaseValue:  { type: DataTypes.INTEGER, defaultValue: 0 },
  currentValue:   { type: DataTypes.INTEGER, defaultValue: 0 },
  purchaseDate:   { type: DataTypes.DATE, allowNull: true },
  location:       { type: DataTypes.STRING, allowNull: true },
  condition:      { type: DataTypes.ENUM('excellent','good','fair','poor'), defaultValue: 'good' },
  status:         { type: DataTypes.ENUM('active','disposed','under_maintenance'), defaultValue: 'active' },
  createdBy:      { type: DataTypes.UUID, allowNull: true },
}, { tableName: 'assets', timestamps: true });

module.exports = Asset;
