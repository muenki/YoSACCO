const sequelize = require('../config/db');
const Group     = require('./Group');
const User      = require('./User');
const Saving    = require('./Saving');
const Loan      = require('./Loan');
const Repayment = require('./Repayment');
const AuditLog  = require('./AuditLog');

// ── Associations ──────────────────────────────────────────────────
Group.hasMany(User,      { foreignKey: 'groupId', as: 'members' });
User.belongsTo(Group,    { foreignKey: 'groupId', as: 'group' });

Group.hasMany(Saving,    { foreignKey: 'groupId' });
User.hasMany(Saving,     { foreignKey: 'memberId' });
Saving.belongsTo(User,   { foreignKey: 'memberId', as: 'member' });

Group.hasMany(Loan,      { foreignKey: 'groupId' });
User.hasMany(Loan,       { foreignKey: 'memberId' });
Loan.belongsTo(User,     { foreignKey: 'memberId', as: 'member' });

Loan.hasMany(Repayment,  { foreignKey: 'loanId' });
Repayment.belongsTo(Loan,{ foreignKey: 'loanId' });

module.exports = { sequelize, Group, User, Saving, Loan, Repayment, AuditLog };
