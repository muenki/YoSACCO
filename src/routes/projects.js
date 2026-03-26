const router = require('express').Router();
const { Group, User, Project, ProjectContribution, ProjectPendingContrib, Asset, Saving, AuditLog, GroupSettings } = require('../models');
const { authenticate, requireRole } = require('../middleware/auth');

router.use(authenticate, requireRole('admin','superadmin'));

// ── PROJECTS ──────────────────────────────────────────────────────
router.get('/projects', async (req, res) => {
  try {
    const gid   = req.user.groupId;
    const group = await Group.findByPk(gid);
    const projects = await Project.findAll({ where: { groupId: gid }, order: [['createdAt','DESC']] });
    const { Op } = require('sequelize');
    const totalMembers = await User.count({ where: { groupId: gid, active: true, role: { [Op.notIn]: ['superadmin'] } } });
    const enriched = await Promise.all(projects.map(async p => {
      const contributions   = await ProjectContribution.findAll({ where: { projectId: p.id }, include: [{ model: User, as: 'member', attributes: ['id','name','memberId'] }] });
      const pendingContribs = await ProjectPendingContrib.findAll({ where: { projectId: p.id, status: 'pending' }, include: [{ model: User, as: 'member', attributes: ['id','name','memberId'] }] });
      const totalRaised   = contributions.reduce((s,c)=>s+c.amount,0);
      const memberCount   = [...new Set(contributions.map(c=>c.memberId))].length;
      const memberShare   = p.targetAmount > 0 && totalMembers > 0 ? Math.ceil(p.targetAmount / totalMembers) : 0;
      return { ...p.toJSON(), totalRaised, memberCount, contributorCount: memberCount, contributions: contributions.map(c=>c.toJSON()), pendingContribs: pendingContribs.map(c=>c.toJSON()), memberShare, totalMembers };
    }));
    const totalAssetValue = (await Asset.findAll({ where: { groupId: gid, status:'active' } })).reduce((s,a)=>s+a.currentValue,0);
    const members = await User.findAll({ where: { groupId: gid, role: ['member','credit_officer','treasurer','chairperson'] }, attributes: ['id','name','memberId'] });
    res.render('admin/projects', { user: req.user, group, projects: enriched, totalAssetValue, members: members.map(m=>m.toJSON()), query: req.query });
  } catch(err) { console.error(err); res.render('error', { message: 'Error loading projects', user: req.user }); }
});

router.post('/projects/add', async (req, res) => {
  try {
    const gid = req.user.groupId;
    const { name, type, description, targetAmount, startDate, endDate, returnRate } = req.body;
    await Project.create({ groupId:gid, name, type, description, targetAmount:parseInt(targetAmount)||0, startDate:startDate?new Date(startDate):null, endDate:endDate?new Date(endDate):null, returnRate:parseFloat(returnRate)||0, status:'active', createdBy:req.user.id });
    await AuditLog.create({ userId:req.user.id, action:'ADD_PROJECT', detail:`Added project: ${name}`, groupId:gid });
    res.redirect('/admin/projects?success=project_added');
  } catch(err) { console.error(err); res.redirect('/admin/projects?error=add_failed'); }
});

router.post('/projects/:id/contribute', async (req, res) => {
  try {
    const gid     = req.user.groupId;
    const project = await Project.findOne({ where: { id:req.params.id, groupId:gid } });
    if (!project) return res.redirect('/admin/projects?error=not_found');
    const { memberId, amount, notes } = req.body;
    await ProjectContribution.create({ projectId:project.id, memberId, groupId:gid, amount:parseInt(amount), date:new Date(), postedBy:req.user.id, notes });
    project.raisedAmount = (project.raisedAmount||0) + parseInt(amount);
    await project.save();
    await AuditLog.create({ userId:req.user.id, action:'PROJECT_CONTRIBUTION', detail:`Posted UGX ${parseInt(amount).toLocaleString()} contribution to ${project.name}`, groupId:gid });
    res.redirect('/admin/projects?success=contribution_posted');
  } catch(err) { console.error(err); res.redirect('/admin/projects?error=contribute_failed'); }
});

router.post('/projects/:id/toggle', async (req, res) => {
  try {
    const gid = req.user.groupId;
    const p   = await Project.findOne({ where: { id:req.params.id, groupId:gid } });
    if (!p) return res.redirect('/admin/projects');

    const wasActive = p.status === 'active';
    p.status = wasActive ? 'suspended' : 'active';
    await p.save();

    // If suspending a savings-funded project, refund each member proportionally
    if (wasActive && p.fundingSource === 'member_savings' && p.raisedAmount > 0) {
      const contribs = await ProjectContribution.findAll({ where: { projectId: p.id } });
      // Group by member and refund
      const byMember = {};
      contribs.forEach(c => { byMember[c.memberId] = (byMember[c.memberId]||0) + c.amount; });
      for (const [memberId, amount] of Object.entries(byMember)) {
        await Saving.create({
          memberId, groupId: gid, amount,
          type: 'other',
          description: 'Project refund — ' + p.name + ' (suspended)',
          date: new Date(), postedBy: req.user.id, status: 'confirmed',
        });
      }
      await AuditLog.create({ userId: req.user.id, action: 'PROJECT_SUSPENDED', detail: 'Suspended project ' + p.name + ' and refunded savings to ' + Object.keys(byMember).length + ' members', groupId: gid });
      return res.redirect('/admin/projects?success=project_suspended_refunded');
    }

    res.redirect('/admin/projects');
  } catch(err) { console.error(err); res.redirect('/admin/projects'); }
});

// ── ASSETS ────────────────────────────────────────────────────────
router.get('/assets', async (req, res) => {
  try {
    const gid   = req.user.groupId;
    const group = await Group.findByPk(gid);
    const assets = await Asset.findAll({ where: { groupId:gid }, order: [['purchaseDate','DESC']] });
    const totalPurchase = assets.reduce((s,a)=>s+a.purchaseValue,0);
    const totalCurrent  = assets.filter(a=>a.status==='active').reduce((s,a)=>s+a.currentValue,0);
    res.render('admin/assets', { user:req.user, group, assets, totalPurchase, totalCurrent, query:req.query });
  } catch(err) { console.error(err); res.render('error', { message:'Error loading assets', user:req.user }); }
});

router.post('/assets/add', async (req, res) => {
  try {
    const gid = req.user.groupId;
    const { name, category, description, purchaseValue, currentValue, purchaseDate, location, condition } = req.body;
    await Asset.create({ groupId:gid, name, category, description, purchaseValue:parseInt(purchaseValue)||0, currentValue:parseInt(currentValue)||parseInt(purchaseValue)||0, purchaseDate:purchaseDate?new Date(purchaseDate):null, location, condition, status:'active', createdBy:req.user.id });
    await AuditLog.create({ userId:req.user.id, action:'ADD_ASSET', detail:`Added asset: ${name}`, groupId:gid });
    res.redirect('/admin/assets?success=asset_added');
  } catch(err) { console.error(err); res.redirect('/admin/assets?error=add_failed'); }
});

router.post('/assets/:id/edit', async (req, res) => {
  try {
    const gid   = req.user.groupId;
    const asset = await Asset.findOne({ where:{ id:req.params.id, groupId:gid } });
    if (!asset) return res.redirect('/admin/assets?error=not_found');
    const { name, category, description, currentValue, condition, status, location } = req.body;
    await asset.update({ name, category, description, currentValue:parseInt(currentValue)||asset.currentValue, condition, status, location });
    res.redirect('/admin/assets?success=asset_updated');
  } catch(err) { console.error(err); res.redirect('/admin/assets?error=update_failed'); }
});


router.post('/projects/pending/:id/confirm', async (req, res) => {
  try {
    const gid = req.user.groupId;
    const pending = await ProjectPendingContrib.findOne({ where: { id: req.params.id } });
    if (!pending) return res.redirect('/admin/projects?error=not_found');
    const project = await Project.findByPk(pending.projectId);
    const member  = await User.findByPk(pending.memberId);
    // Create confirmed contribution
    await ProjectContribution.create({ projectId: pending.projectId, memberId: pending.memberId, groupId: gid, amount: pending.amount, date: new Date(), postedBy: req.user.id, notes: 'Confirmed online payment via ' + pending.paymentMethod });
    // Update project raised amount
    project.raisedAmount = (project.raisedAmount||0) + pending.amount;
    await project.save();
    // Mark pending as confirmed
    pending.status = 'confirmed'; pending.confirmedBy = req.user.id; pending.confirmedAt = new Date();
    await pending.save();
    await AuditLog.create({ userId: req.user.id, action: 'CONFIRM_PROJECT_CONTRIB', detail: `Confirmed UGX ${pending.amount.toLocaleString()} from ${member?.name} to ${project?.name}`, groupId: gid });
    res.redirect('/admin/projects?success=contribution_confirmed');
  } catch(err) { console.error(err); res.redirect('/admin/projects?error=confirm_failed'); }
});

router.post('/projects/pending/:id/reject', async (req, res) => {
  try {
    const pending = await ProjectPendingContrib.findOne({ where: { id: req.params.id } });
    if (pending) { pending.status = 'rejected'; await pending.save(); }
    res.redirect('/admin/projects?success=contribution_rejected');
  } catch(err) { console.error(err); res.redirect('/admin/projects?error=reject_failed'); }
});
module.exports = router;
