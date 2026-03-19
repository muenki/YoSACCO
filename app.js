require('dotenv').config();
const express = require('express');
const path = require('path');
const cookieParser = require('cookie-parser');

const app = express();

// ── View Engine ────────────────────────────────────────────────────
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// ── Middleware ─────────────────────────────────────────────────────
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

// Pass query params to all views
app.use((req, res, next) => {
  res.locals.query = req.query;
  next();
});

// ── Routes ─────────────────────────────────────────────────────────
app.use('/', require('./src/routes/auth'));
app.use('/super', require('./src/routes/super'));
app.use('/admin', require('./src/routes/admin'));
app.use('/member', require('./src/routes/member'));

// ── 404 ────────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).render('error', { message: 'Page not found (404)', user: null });
});

// ── Start ──────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════════════════════════╗
║              YoSACCO Platform — Running                  ║
╠══════════════════════════════════════════════════════════╣
║  URL:     http://localhost:${PORT}                          ║
║                                                          ║
║  DEMO LOGIN CREDENTIALS:                                 ║
║  Super Admin : superadmin@yosacco.coop / Admin@2025      ║
║  SACCO Admin : admin@kteachers.coop   / Admin@2025      ║
║  Member      : james.kato@gmail.com   / Member@2025     ║
║  Member      : aisha.m@gmail.com      / Member@2025     ║
╚══════════════════════════════════════════════════════════╝
  `);
});

module.exports = app;
