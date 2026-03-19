const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');

const ProjectContribution = sequelize.define('ProjectContribution', {
  id:        { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  projectId: { type: DataTypes.UUID, allowNull: false },
  memberId:  { type: DataTypes.UUID, allowNull: false },
  groupId:   { type: DataTypes.UUID, allowNull: false },
  amount:    { type: DataTypes.INTEGER, allowNull: false },
  date:      { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
  postedBy:  { type: DataTypes.UUID, allowNull: true },
  notes:     { type: DataTypes.STRING, allowNull: true },
}, { tableName: 'project_contributions', timestamps: true });

module.exports = ProjectContribution;
