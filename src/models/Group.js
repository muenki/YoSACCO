const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');

const Group = sequelize.define('Group', {
  id:           { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  name:         { type: DataTypes.STRING, allowNull: false },
  slug:         { type: DataTypes.STRING, unique: true },
  logo:         { type: DataTypes.STRING, allowNull: true },
  accentColor:  { type: DataTypes.STRING, defaultValue: '#0D7377' },
  adminEmail:   { type: DataTypes.STRING, allowNull: false },
  accountNumber:{ type: DataTypes.STRING, allowNull: true },
  bankName:     { type: DataTypes.STRING, allowNull: true },
  active:       { type: DataTypes.BOOLEAN, defaultValue: true },
}, { tableName: 'groups', timestamps: true });

module.exports = Group;
