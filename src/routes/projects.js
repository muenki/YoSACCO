const router = require('express').Router();
const { Group, User, Project, ProjectContribution, Asset, Saving, AuditLog, GroupSettings } = require('../models');
const { authenticate, requireRole } = require('../middleware/auth');

router.use(authenticate, requireRole('admin','superadmin'));

// ── PROJECTS ──────────────────────────────────────────────────────
router.get('/projects', async (req, res) => {
  try {
    const gid   = req.user.groupId;
    const group = await Group.findByPk(gid);
    const projects = await Project.findAll({ where: { groupId: gid }, order: [['createdAt','DESC']] });
    const enriched = await Promise.all(projects.map(async p => {
      const contributions = await ProjectContribution.findAll({ where: { projectId: p.id } });
      const totalRaised   = contributions.reduce((s,c)=>s+c.amount,0);
      const memberCount   = [...new Set(contributions.map(c=>c.memberId))].length;
      return { ...p.toJSON(), totalRaised, memberCount, contributorCount: memberCount };
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
    if (p) { p.status = p.status==='active'?'suspended':'active'; await p.save(); }
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

module.exports = router;
