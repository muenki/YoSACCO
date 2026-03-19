# YoSACCO — Online SACCO Management Platform

A full-stack, multi-tenant web application for managing Savings and Credit Cooperative Organizations (SACCOs). Multiple SACCO groups run independently on a single platform — each with their own admin, members, savings ledger, and loan management.

---

## Features

### Multi-Tenant Platform
- Unlimited SACCO groups, each fully isolated
- Super Admin manages all groups from one console
- Each group has its own admin, members, and financial data

### SACCO Admin Dashboard
- Add and manage members (auto-generates member ID, sends welcome email)
- Post savings contributions individually
- Full savings ledger with arrears tracking
- Loan inbox — approve or decline applications online
- Record loan repayments with automatic receipt emails
- Financial reports and audit trail

### Member Portal
- Personal dashboard with savings balance and loan status
- Full account statement with running balance
- Apply for a loan online (admin notified instantly by email)
- Make online deposits (MTN MoMo, Airtel Money, Visa/Mastercard, Bank)
- Download/print personal statement

### Email Notifications (Automated)
| Trigger | Recipient |
|---|---|
| New member registered | Member (welcome + credentials) |
| Loan application submitted | Admin (alert) + Member (confirmation) |
| Loan approved | Member |
| Loan declined | Member |
| Savings contribution posted | Member (receipt) |
| Online deposit confirmed | Member (receipt) |
| Loan repayment recorded | Member (receipt) |
| Loan fully repaid | Member (congratulations) |
| Monthly contribution reminder | Member |
| Arrears alert | Admin + Member |

### Security
- JWT authentication with 7-day sessions (HttpOnly cookies)
- bcrypt password hashing
- Role-based access control (superadmin / admin / member)
- Auth guards on every route
- Audit trail for all actions

---

## Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js |
| Framework | Express.js |
| Templating | EJS |
| Auth | JWT + bcryptjs |
| Email | Nodemailer (SMTP) |
| Styling | Custom CSS (no framework) |
| Database | In-memory (production: swap for PostgreSQL) |

---

## Quick Start

### 1. Install dependencies
```bash
npm install
```

### 2. Configure environment
Edit `.env`:
```
PORT=3000
JWT_SECRET=your_secret_key_here

# Email (configure with SendGrid, Gmail, etc.)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your@email.com
SMTP_PASS=your_password
EMAIL_FROM=YoSACCO <noreply@yosacco.coop>

APP_URL=http://localhost:3000
```

### 3. Start the server
```bash
node app.js
```

Open: **http://localhost:3000**

---

## Demo Login Credentials

| Role | Email | Password |
|---|---|---|
| Super Admin | superadmin@yosacco.coop | Admin@2025 |
| SACCO Admin (Kampala Teachers) | admin@kteachers.coop | Admin@2025 |
| SACCO Admin (Lira Farmers) | admin@lirafarmers.coop | Admin@2025 |
| Member | james.kato@gmail.com | Member@2025 |
| Member | aisha.m@gmail.com | Member@2025 |
| Member | prossy.n@gmail.com | Member@2025 |

---

## Project Structure

```
yosacco/
├── app.js                    # Entry point — Express server
├── .env                      # Environment config
├── package.json
├── src/
│   ├── database.js           # In-memory DB with seed data
│   ├── middleware/
│   │   └── auth.js           # JWT auth + role guards
│   ├── routes/
│   │   ├── auth.js           # Login / logout
│   │   ├── super.js          # Super admin routes
│   │   ├── admin.js          # SACCO admin routes
│   │   └── member.js         # Member portal routes
│   └── utils/
│       └── email.js          # Email templates + sender
├── views/
│   ├── login.ejs
│   ├── error.ejs
│   ├── partials/
│   │   ├── head.ejs          # HTML head + sidebar layout open
│   │   ├── foot.ejs          # Layout close
│   │   └── sidebar.ejs       # Navigation sidebar
│   ├── super/
│   │   ├── dashboard.ejs
│   │   ├── groups.ejs
│   │   └── audit.ejs
│   ├── admin/
│   │   ├── dashboard.ejs
│   │   ├── members.ejs
│   │   ├── member-detail.ejs
│   │   ├── savings.ejs
│   │   ├── loans.ejs
│   │   ├── reports.ejs
│   │   └── audit.ejs
│   └── member/
│       ├── dashboard.ejs
│       ├── savings.ejs
│       ├── loans.ejs
│       ├── deposit.ejs
│       └── profile.ejs
└── public/
    └── css/
        └── app.css           # Full design system
```

---

## User Roles & Permissions

| Action | Super Admin | SACCO Admin | Member |
|---|---|---|---|
| Create SACCO groups | ✅ | ❌ | ❌ |
| Add/manage members | ❌ | ✅ | ❌ |
| Post savings | ❌ | ✅ | ❌ |
| Approve/decline loans | ❌ | ✅ | ❌ |
| View own account | ❌ | ❌ | ✅ |
| Apply for loan | ❌ | ❌ | ✅ |
| Make online deposit | ❌ | ❌ | ✅ |
| View audit trail | ✅ | ✅ (own group) | ❌ |

---

## Moving to Production

### Replace in-memory database with PostgreSQL
1. Install: `npm install pg sequelize`
2. Replace `src/database.js` with Sequelize models
3. Run migrations to create tables

### Configure real email (SendGrid recommended)
```
SMTP_HOST=smtp.sendgrid.net
SMTP_PORT=587
SMTP_USER=apikey
SMTP_PASS=your_sendgrid_api_key
```

### Configure real payment gateway
- Register at [Flutterwave](https://flutterwave.com) or [Beyonic](https://beyonic.com)
- Replace simulated deposit in `src/routes/member.js` with real API call
- Handle webhooks for payment confirmation

### Deploy
```bash
# Install PM2 for process management
npm install -g pm2
pm2 start app.js --name yosacco
pm2 save
pm2 startup
```

### Environment hardening
- Generate a strong JWT_SECRET: `node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"`
- Set `NODE_ENV=production`
- Use HTTPS (Nginx reverse proxy + Let's Encrypt)
- Enable rate limiting: `npm install express-rate-limit`

---

## Phase 2 — Mobile App

The backend API is structured so a React Native or Flutter mobile app can be added without changes to the server. The same JWT tokens work for mobile clients — pass them in the `Authorization: Bearer <token>` header.

Planned mobile features:
- Biometric login (fingerprint / Face ID)
- Push notifications for loan approvals and payment reminders
- One-tap monthly contribution via MTN/Airtel MoMo
- Loan application with camera document upload
- Offline statement viewing

---

## Support

**YoSACCO** | info@yosacco.coop | www.yosacco.coop  
Built with ❤️ for cooperative financial inclusion in Uganda.
