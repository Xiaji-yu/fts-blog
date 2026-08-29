'use strict';
/**
 * Database initialization: apply migrations, ensure the default admin user
 * exists, and seed sample posts if the database is empty.
 * Called once from server.js at startup.
 */
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const config = require('../config/loader');
const db = require('./db');
const { migrate } = require('./migrations');
const { seedIfEmpty } = require('./seed');

async function ensureAdminUser() {
  return db.transaction(async (tx) => {
    const username = config.auth.defaultUsername || 'admin';
    const result = tx.exec('SELECT COUNT(*) AS count FROM users WHERE username = ?', [username]);
    const count = result[0] ? result[0].values[0][0] : 0;
    if (count > 0) return { created: false };

    const randomPassword = (config.auth.defaultPasswordPrefix || 'admin') + '-' + crypto.randomBytes(6).toString('hex');
    const hash = await bcrypt.hash(randomPassword, config.auth.bcryptRounds || 10);
    tx.run('INSERT INTO users (username, password_hash) VALUES (?, ?)', [username, hash]);
    console.log(`✓ Admin user created (username: ${username}, password: ${randomPassword})`);
    console.log('⚠ 请妥善保管此密码，登录后请立即修改');
    return { created: true, password: randomPassword };
  });
}

async function initDatabase() {
  await migrate();
  await ensureAdminUser();
  await seedIfEmpty();
  console.log('✓ Database ready at', db.databasePath());
  return db.databasePath();
}

module.exports = { initDatabase, ensureAdminUser };
