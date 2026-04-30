require('dotenv').config();
const {User, Group} = require('./src/models');
const {Op} = require('sequelize');
(async () => {
  const users = await User.findAll({
    where: { memberId: { [Op.or]: [null, ''] } },
    include: [{ model: Group, as: 'group', attributes: ['name'] }]
  });
  console.log('Users without memberId:', users.length);
  for (const u of users) {
    if (!u.group) continue;
    const prefix = u.group.name.replace(/[^A-Za-z]/g,'').slice(0,3).toUpperCase();
    const existing = await User.findAll({ where: { groupId: u.groupId, memberId: { [Op.ne]: null } }, attributes: ['memberId'] });
    const maxNum = existing.reduce((max, x) => {
      const n = parseInt((x.memberId||'').split('-')[1]||'0');
      return n > max ? n : max;
    }, 0);
    const memberId = prefix + '-' + String(maxNum + 1).padStart(4,'0');
    await u.update({ memberId });
    console.log('Assigned', memberId, 'to', u.name, '('+u.role+')');
  }
  console.log('Done');
  process.exit(0);
})();
