const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');

const Invoice = sequelize.define('Invoice', {
  id:             { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  groupId:        { type: DataTypes.UUID, allowNull: false },
  invoiceNumber:  { type: DataTypes.STRING, allowNull: false, unique: true },
  type:           { type: DataTypes.ENUM('monthly','annual'), defaultValue: 'monthly' },
  amount:         { type: DataTypes.INTEGER, allowNull: false },
  status:         { type: DataTypes.ENUM('pending','paid','overdue'), defaultValue: 'pending' },
  dueDate:        { type: DataTypes.DATE, allowNull: false },
  paidAt:         { type: DataTypes.DATE, allowNull: true },
  paidAmount:     { type: DataTypes.INTEGER, defaultValue: 0 },
  notes:          { type: DataTypes.TEXT, allowNull: true },
  periodStart:    { type: DataTypes.DATE, allowNull: true },
  periodEnd:      { type: DataTypes.DATE, allowNull: true },
}, { tableName: 'invoices', timestamps: true });

module.exports = Invoice;
