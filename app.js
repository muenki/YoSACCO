require('dotenv').config();
const express    = require('express');
const path       = require('path');
const cookieParser = require('cookie-parser');
const { sequelize } = require('./src/models');

const app = express();

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));
app.use((req, res, next) => { res.locals.query = req.query; next(); });

app.use('/',       require('./src/routes/auth'));
app.use('/super',  require('./src/routes/super'));
app.use('/admin',  require('./src/routes/admin'));
app.use('/member',   require('./src/routes/member'));
app.use('/approver', require('./src/routes/approver'));
app.use('/admin', require('./src/routes/projects'));
app.use('/admin/reports',  require('./src/routes/reports'));

app.use((req, res) => res.status(404).render('error', { message: 'Page not found (404)', user: null }));

const PORT = process.env.PORT || 3000;

async function start() {
  try {
    await sequelize.authenticate();
    console.log('✅ Database connected');
    // Sync tables (does NOT drop existing data — use seed.js for that)
    await sequelize.sync({ alter: false });
    app.listen(PORT, () => {
      console.log(`
╔══════════════════════════════════════════════════════════╗
║              YoSACCO Platform — Running                  ║
╠══════════════════════════════════════════════════════════╣
║  URL:     http://localhost:${PORT}                          ║
║  DB:      ${(process.env.DB_NAME||'').padEnd(44)} ║
╚══════════════════════════════════════════════════════════╝`);
    });
  } catch (err) {
    console.error('❌ Failed to start:', err.message);
    process.exit(1);
  }
}

start();
module.exports = app;
