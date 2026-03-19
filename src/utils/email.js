const nodemailer = require('nodemailer');
require('dotenv').config();

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: parseInt(process.env.SMTP_PORT || '587'),
  secure: false,
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
});

const APP_URL = process.env.APP_URL || 'http://localhost:3000';
const APP_NAME = process.env.APP_NAME || 'YoSACCO';

function emailWrapper(title, accentColor, bodyHtml) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
  body{font-family:Arial,sans-serif;background:#f5f7fa;margin:0;padding:20px;}
  .container{max-width:580px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e0e0e0;}
  .header{background:${accentColor||'#0A2342'};padding:28px 32px;color:#fff;}
  .header h1{margin:0;font-size:22px;font-weight:600;}
  .header p{margin:6px 0 0;font-size:13px;opacity:0.8;}
  .body{padding:28px 32px;}
  .body p{font-size:15px;line-height:1.7;color:#333;margin:0 0 14px;}
  .info-box{background:#f6f8fa;border-radius:8px;padding:16px 20px;margin:16px 0;}
  .info-row{display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #e8e8e8;font-size:14px;}
  .info-row:last-child{border-bottom:none;}
  .info-key{color:#666;}
  .info-val{font-weight:600;color:#111;}
  .btn{display:inline-block;background:${accentColor||'#0A2342'};color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-size:14px;font-weight:600;margin-top:12px;}
  .footer{background:#f0f0f0;padding:16px 32px;font-size:12px;color:#999;text-align:center;}
  .badge-approved{background:#d6f0e4;color:#1a7f4b;padding:4px 10px;border-radius:6px;font-weight:600;font-size:13px;}
  .badge-declined{background:#fde8e8;color:#a32d2d;padding:4px 10px;border-radius:6px;font-weight:600;font-size:13px;}
  </style></head><body>
  <div class="container">
    <div class="header"><h1>${APP_NAME}</h1><p>Online SACCO Management Platform</p></div>
    <div class="body">${bodyHtml}</div>
    <div class="footer">${APP_NAME} · <a href="${APP_URL}" style="color:#666;">${APP_URL}</a> · This is an automated message, please do not reply.</div>
  </div></body></html>`;
}

async function sendEmail({ to, subject, html, text }) {
  try {
    await transporter.sendMail({
      from: process.env.EMAIL_FROM || `${APP_NAME} <noreply@yosacco.coop>`,
      to, subject, html, text,
    });
    console.log(`[EMAIL] Sent to ${to}: ${subject}`);
    return true;
  } catch (err) {
    // Log but don't crash — email is non-blocking
    console.warn(`[EMAIL] Failed to send to ${to}:`, err.message);
    return false;
  }
}

// ── Email Templates ───────────────────────────────────────────────────────────

const emails = {
  async welcomeMember(member, group, tempPassword) {
    return sendEmail({
      to: member.email,
      subject: `Welcome to ${group.name} — Your YoSACCO Account is Ready`,
      html: emailWrapper('Welcome to ' + group.name, group.accentColor, `
        <p>Dear <strong>${member.name}</strong>,</p>
        <p>Welcome to <strong>${group.name}</strong> on the YoSACCO platform! Your member account has been created.</p>
        <div class="info-box">
          <div class="info-row"><span class="info-key">Member ID</span><span class="info-val">${member.memberId}</span></div>
          <div class="info-row"><span class="info-key">Your login email</span><span class="info-val">${member.email}</span></div>
          <div class="info-row"><span class="info-key">Temporary password</span><span class="info-val">${tempPassword}</span></div>
          <div class="info-row"><span class="info-key">Monthly contribution</span><span class="info-val">UGX ${member.monthlyContribution.toLocaleString()}</span></div>
        </div>
        <p>Please log in and change your password immediately.</p>
        <a class="btn" href="${APP_URL}/member/login">Log In to Your Portal</a>
        <p style="font-size:13px;color:#888;margin-top:16px;">If you did not expect this email, please contact your SACCO admin.</p>
      `),
    });
  },

  async loanRequestToAdmin(admin, member, loan, group) {
    return sendEmail({
      to: admin.email,
      subject: `New Loan Request — ${member.name} (${member.memberId}) — UGX ${loan.amount.toLocaleString()}`,
      html: emailWrapper('New Loan Request', group.accentColor, `
        <p>Dear <strong>${admin.name}</strong>,</p>
        <p>A new loan application has been submitted by a member of <strong>${group.name}</strong> and requires your review.</p>
        <div class="info-box">
          <div class="info-row"><span class="info-key">Member name</span><span class="info-val">${member.name}</span></div>
          <div class="info-row"><span class="info-key">Member ID</span><span class="info-val">${member.memberId}</span></div>
          <div class="info-row"><span class="info-key">Loan amount requested</span><span class="info-val">UGX ${loan.amount.toLocaleString()}</span></div>
          <div class="info-row"><span class="info-key">Purpose</span><span class="info-val">${loan.purpose}</span></div>
          <div class="info-row"><span class="info-key">Repayment period</span><span class="info-val">${loan.repaymentMonths} months</span></div>
          <div class="info-row"><span class="info-key">Applied at</span><span class="info-val">${new Date(loan.appliedAt).toLocaleString()}</span></div>
        </div>
        <a class="btn" href="${APP_URL}/admin/loans">Review in Dashboard</a>
      `),
    });
  },

  async loanRequestConfirmToMember(member, loan, group) {
    return sendEmail({
      to: member.email,
      subject: `Loan Application Received — UGX ${loan.amount.toLocaleString()} — ${group.name}`,
      html: emailWrapper('Loan Application Received', group.accentColor, `
        <p>Dear <strong>${member.name}</strong>,</p>
        <p>Your loan application has been received by <strong>${group.name}</strong> and is currently under review.</p>
        <div class="info-box">
          <div class="info-row"><span class="info-key">Application reference</span><span class="info-val">${loan.id.toUpperCase()}</span></div>
          <div class="info-row"><span class="info-key">Amount requested</span><span class="info-val">UGX ${loan.amount.toLocaleString()}</span></div>
          <div class="info-row"><span class="info-key">Purpose</span><span class="info-val">${loan.purpose}</span></div>
          <div class="info-row"><span class="info-key">Status</span><span class="info-val">⏳ Pending Review</span></div>
        </div>
        <p>You will receive an email notification once a decision has been made. Expected processing time: 1–3 business days.</p>
        <a class="btn" href="${APP_URL}/member/loans">View Your Application</a>
      `),
    });
  },

  async loanApprovedToMember(member, loan, group) {
    return sendEmail({
      to: member.email,
      subject: `🎉 Loan Approved — UGX ${loan.amount.toLocaleString()} — ${group.name}`,
      html: emailWrapper('Loan Approved', group.accentColor, `
        <p>Dear <strong>${member.name}</strong>,</p>
        <p>We are pleased to inform you that your loan application to <strong>${group.name}</strong> has been <span class="badge-approved">Approved</span>.</p>
        <div class="info-box">
          <div class="info-row"><span class="info-key">Loan amount</span><span class="info-val">UGX ${loan.amount.toLocaleString()}</span></div>
          <div class="info-row"><span class="info-key">Monthly installment</span><span class="info-val">UGX ${loan.monthlyInstallment.toLocaleString()}</span></div>
          <div class="info-row"><span class="info-key">Repayment period</span><span class="info-val">${loan.repaymentMonths} months</span></div>
          <div class="info-row"><span class="info-key">Total repayable</span><span class="info-val">UGX ${loan.totalRepayable.toLocaleString()}</span></div>
          <div class="info-row"><span class="info-key">Purpose</span><span class="info-val">${loan.purpose}</span></div>
        </div>
        ${loan.notes ? `<p><strong>Note from admin:</strong> ${loan.notes}</p>` : ''}
        <p>Please contact your SACCO admin to confirm disbursement arrangements.</p>
        <a class="btn" href="${APP_URL}/member/loans">View Loan Schedule</a>
      `),
    });
  },

  async loanDeclinedToMember(member, loan, group) {
    return sendEmail({
      to: member.email,
      subject: `Loan Application Update — ${group.name}`,
      html: emailWrapper('Loan Application Update', group.accentColor, `
        <p>Dear <strong>${member.name}</strong>,</p>
        <p>We regret to inform you that your loan application to <strong>${group.name}</strong> has been <span class="badge-declined">Declined</span> at this time.</p>
        <div class="info-box">
          <div class="info-row"><span class="info-key">Amount requested</span><span class="info-val">UGX ${loan.amount.toLocaleString()}</span></div>
          <div class="info-row"><span class="info-key">Purpose</span><span class="info-val">${loan.purpose}</span></div>
          ${loan.notes ? `<div class="info-row"><span class="info-key">Reason</span><span class="info-val">${loan.notes}</span></div>` : ''}
        </div>
        <p>You may contact your SACCO admin for more information or reapply after improving your savings standing.</p>
        <a class="btn" href="${APP_URL}/member/loans">View Your Account</a>
      `),
    });
  },

  async savingsReceiptToMember(member, transaction, balance, group) {
    return sendEmail({
      to: member.email,
      subject: `Savings Receipt — UGX ${transaction.amount.toLocaleString()} — ${group.name}`,
      html: emailWrapper('Savings Receipt', group.accentColor, `
        <p>Dear <strong>${member.name}</strong>,</p>
        <p>Your savings account has been credited. Here is your receipt:</p>
        <div class="info-box">
          <div class="info-row"><span class="info-key">Transaction type</span><span class="info-val">${transaction.description}</span></div>
          <div class="info-row"><span class="info-key">Amount credited</span><span class="info-val">UGX ${transaction.amount.toLocaleString()}</span></div>
          <div class="info-row"><span class="info-key">Date</span><span class="info-val">${new Date(transaction.date).toLocaleDateString()}</span></div>
          <div class="info-row"><span class="info-key">New balance</span><span class="info-val">UGX ${balance.toLocaleString()}</span></div>
        </div>
        <a class="btn" href="${APP_URL}/member/savings">View Full Statement</a>
      `),
    });
  },

  async loanRepaymentReceipt(member, repayment, remaining, group) {
    return sendEmail({
      to: member.email,
      subject: `Loan Repayment Receipt — UGX ${repayment.amount.toLocaleString()} — ${group.name}`,
      html: emailWrapper('Repayment Receipt', group.accentColor, `
        <p>Dear <strong>${member.name}</strong>,</p>
        <p>Your loan repayment has been recorded successfully.</p>
        <div class="info-box">
          <div class="info-row"><span class="info-key">Amount paid</span><span class="info-val">UGX ${repayment.amount.toLocaleString()}</span></div>
          <div class="info-row"><span class="info-key">Payment date</span><span class="info-val">${new Date(repayment.date).toLocaleDateString()}</span></div>
          <div class="info-row"><span class="info-key">Outstanding balance</span><span class="info-val">UGX ${remaining.toLocaleString()}</span></div>
        </div>
        ${remaining === 0 ? '<p style="color:#1a7f4b;font-weight:600;">🎉 Congratulations! Your loan has been fully repaid!</p>' : ''}
        <a class="btn" href="${APP_URL}/member/loans">View Loan Account</a>
      `),
    });
  },
};

module.exports = { sendEmail, emails };
