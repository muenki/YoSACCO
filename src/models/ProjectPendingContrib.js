const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');

// Pending project contributions submitted by members via deposit page
// Admin confirms → becomes a real ProjectContribution
const ProjectPendingContrib = sequelize.define('ProjectPendingContrib', {
  id:            { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  projectId:     { type: DataTypes.UUID, allowNull: false },
  memberId:      { type: DataTypes.UUID, allowNull: false },
  groupId:       { type: DataTypes.UUID, allowNull: false },
  amount:        { type: DataTypes.INTEGER, allowNull: false },
  paymentMethod: { type: DataTypes.STRING, allowNull: true },
  transactionRef:{ type: DataTypes.STRING, allowNull: true },
  status:        { type: DataTypes.ENUM('pending','confirmed','rejected'), defaultValue: 'pending' },
  date:          { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
  confirmedBy:   { type: DataTypes.UUID, allowNull: true },
  confirmedAt:   { type: DataTypes.DATE, allowNull: true },
  notes:         { type: DataTypes.STRING, allowNull: true },
}, { tableName: 'project_pending_contribs', timestamps: true });

module.exports = ProjectPendingContrib;
