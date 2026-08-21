const crypto = require('crypto');
const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcrypt');

const DB_PATH = path.join(__dirname, '..', 'data', 'blog.db');

async function initDatabase() {
  const SQL = await initSqlJs();

  // Load existing database or create new one
  let db;
  if (fs.existsSync(DB_PATH)) {
    const fileBuffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(fileBuffer);
  } else {
    db = new SQL.Database();
  }

  // Create tables
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT DEFAULT 'admin',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS posts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      title_en TEXT,
      slug TEXT UNIQUE NOT NULL,
      content TEXT NOT NULL,
      excerpt TEXT,
      cover_image TEXT,
      published BOOLEAN DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS tags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS post_tags (
      post_id INTEGER REFERENCES posts(id),
      tag_id INTEGER REFERENCES tags(id),
      PRIMARY KEY (post_id, tag_id)
    )
  `);

  // Seed admin user if not exists
  const result = db.exec("SELECT COUNT(*) as count FROM users WHERE username = 'admin'");
  if (result.length === 0 || result[0].values[0][0] === 0) {
    const randomPassword = 'admin-' + crypto.randomBytes(6).toString('hex');
    const hash = await bcrypt.hash(randomPassword, 10);
    db.run("INSERT INTO users (username, password_hash) VALUES (?, ?)", ['admin', hash]);
    console.log('✓ Admin user created (username: admin, password: ' + randomPassword + ')');
    console.log('⚠ 请妥善保管此密码，登录后请立即修改');
  }

  // Save database
  const data = db.export();
  const buffer = Buffer.from(data);
  fs.writeFileSync(DB_PATH, buffer);
  console.log('✓ Database initialized at', DB_PATH);

  db.close();
}

module.exports = { initDatabase };

initDatabase().catch(err => {
  console.error('Database initialization failed:', err);
  process.exit(1);
});
