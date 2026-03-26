const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');

const User = sequelize.define('User', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  name: { type: DataTypes.STRING, allowNull: false },
  email: {
    type: DataTypes.STRING, allowNull: false, unique: true,
    set(val) { this.setDataValue('email', val.toLowerCase()); },
  },
  password: { type: DataTypes.STRING, allowNull: false },
  role: {
    type: DataTypes.ENUM('superadmin','admin','credit_officer','treasurer','chairperson','member'),
    defaultValue: 'member',
  },
  groupId:            { type: DataTypes.UUID,    allowNull: true },
  memberId:           { type: DataTypes.STRING,  allowNull: true },
  phone:              { type: DataTypes.STRING,  allowNull: true },
  nationalId:         { type: DataTypes.STRING,  allowNull: true },
  joinDate:           { type: DataTypes.DATE,    allowNull: true },
  monthlyContribution:{ type: DataTypes.INTEGER, defaultValue: 10000 },
  shareCapitalTarget: { type: DataTypes.INTEGER, defaultValue: 1000000 },
  shareCapitalPaid:   { type: DataTypes.INTEGER, defaultValue: 0 },
  active:             { type: DataTypes.BOOLEAN, defaultValue: true },
  mustChangePassword:  { type: DataTypes.BOOLEAN, defaultValue: true },
}, { tableName: 'users', timestamps: true });

module.exports = User;
