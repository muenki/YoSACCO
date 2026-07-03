const router = require('express').Router();
const { authenticate, requireRole } = require('../middleware/auth');
const { Group, User, Saving, GroupSettings, AuditLog } = require('../models');
const { getToken, registerIPN, submitOrder, getTransactionStatus } = require('../utils/pesapal');
const { emails } = require('../utils/email');
const crypto = require('crypto');

// ── Member initiates payment ──────────────────────────────────────
router.get('/pay', authenticate, async (req, res) => {
  try {
    const member = req.user;
    const group  = await Group.findByPk(member.groupId);
    const settings = await GroupSettings.findOne({ where: { groupId: member.groupId } });
    res.render('member/payment', { user: member, group, settings: settings?.toJSON() || {}, query: req.query });
  } catch(err) { console.error(err); res.render('error', { message: 'Error loading payment page', user: req.user }); }
});

router.post('/pay/initiate', authenticate, async (req, res) => {
  try {
    const member = req.user;
    const group  = await Group.findByPk(member.groupId);
    const { amount, paymentType, phone } = req.body;
    const parsedAmount = parseInt(amount);
    if (!parsedAmount || parsedAmount < 1000) return res.redirect('/member/pay?error=invalid_amount');

    const token = await getToken();

    // Register IPN if not done
    let ipnId = process.env.PESAPAL_IPN_ID;
    if (!ipnId) {
      ipnId = await registerIPN(token);
      console.log('IPN registered:', ipnId);
    }

    const reference = `${group.id.slice(0,8)}-${member.id.slice(0,8)}-${Date.now()}`;
    const nameParts = member.name.split(' ');
    const callbackUrl = `${process.env.APP_URL}/member/pay/callback?ref=${reference}&groupId=${group.id}&memberId=${member.id}&type=${paymentType}`;

    const order = await submitOrder({
      token, ipnId,
      amount: parsedAmount,
      currency: 'UGX',
      description: `${paymentType === 'contribution' ? 'Monthly Contribution' : paymentType === 'share_capital' ? 'Share Capital' : 'Payment'} — ${group.name}`,
      reference,
      email: member.email,
      phone: phone || member.phone,
      firstName: nameParts[0],
      lastName: nameParts.slice(1).join(' ') || nameParts[0],
      callbackUrl,
    });

    if (order.redirect_url) {
      return res.redirect(order.redirect_url);
    }
    res.redirect('/member/pay?error=payment_failed');
  } catch(err) {
    console.error('Payment initiation error:', err.response?.data || err.message);
    res.redirect('/member/pay?error=payment_failed');
  }
});

// ── Payment callback (user returns from PesaPal) ──────────────────
router.get('/pay/callback', authenticate, async (req, res) => {
  try {
    const { orderTrackingId, ref, groupId, memberId, type } = req.query;
    const token = await getToken();
    const status = await getTransactionStatus(token, orderTrackingId);

    if (status.payment_status_description === 'Completed') {
      const member = await User.findByPk(memberId);
      const group  = await Group.findByPk(groupId);
      const amount = parseInt(status.amount);

      // Record the payment
      const tx = await Saving.create({
        memberId, groupId, amount,
        type: type || 'contribution',
        description: `${type === 'contribution' ? 'Monthly contribution' : type === 'share_capital' ? 'Share capital' : 'Payment'} via ${status.payment_method || 'Mobile Money'}`,
        date: new Date(), status: 'confirmed',
        postedBy: memberId,
      });

      if (type === 'share_capital') {
        member.shareCapitalPaid = (member.shareCapitalPaid || 0) + amount;
        await member.save();
      }

      await AuditLog.create({ userId: memberId, action: 'ONLINE_PAYMENT', detail: `Online payment UGX ${amount.toLocaleString()} via PesaPal — ${status.payment_method}`, groupId });

      const { Op } = require('sequelize');
      const balanceRows = await Saving.findAll({ where: { memberId, status: 'confirmed', type: { [Op.ne]: 'share_capital' } }, attributes: ['amount'] });
      const balance = balanceRows.reduce((s, r) => s + r.amount, 0);
      emails.savingsReceiptToMember(member.toJSON(), tx.toJSON(), balance, group.toJSON()).catch(() => {});

      return res.redirect('/member/dashboard?success=payment_received');
    }

    res.redirect('/member/pay?error=payment_incomplete');
  } catch(err) {
    console.error('Callback error:', err);
    res.redirect('/member/pay?error=callback_failed');
  }
});

// ── PesaPal IPN Webhook ───────────────────────────────────────────
router.post('/api/pesapal/ipn', async (req, res) => {
  try {
    const { OrderTrackingId, OrderMerchantReference } = req.body;
    console.log('[PesaPal IPN]', req.body);

    const token = await getToken();
    const status = await getTransactionStatus(token, OrderTrackingId);

    if (status.payment_status_description === 'Completed') {
      // Parse groupId and memberId from reference
      const parts = OrderMerchantReference.split('-');
      console.log('[PesaPal IPN] Payment completed:', status.amount, 'UGX');
      // The callback already handles recording — IPN is a backup confirmation
    }

    res.json({ orderNotificationType: 'IPNCHANGE', orderTrackingId: OrderTrackingId, orderMerchantReference: OrderMerchantReference, status: 200 });
  } catch(err) {
    console.error('IPN error:', err);
    res.status(500).json({ status: 500 });
  }
});

module.exports = router;
