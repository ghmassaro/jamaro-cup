// db.js
const { Sequelize } = require('sequelize');
try { require('dotenv').config(); } catch (_) {}

const DATABASE_URL = "postgresql://jamaro_dc_user:g6qqeNOQchEnQqqW6VKZ5dk42QLdyLbq@dpg-d2k65gvdiees73dbd9dg-a.oregon-postgres.render.com/jamaro_dc";
if (!DATABASE_URL) { console.error('❌ DATABASE_URL não definida'); process.exit(1); }

const isExternal = DATABASE_URL.includes('render.com') && !DATABASE_URL.includes('.internal');

const sequelize = new Sequelize(DATABASE_URL, {
  dialect: 'postgres',
  logging: false,
  dialectOptions: isExternal ? { ssl: { require: true, rejectUnauthorized: false } } : {}
});

module.exports = { sequelize };
