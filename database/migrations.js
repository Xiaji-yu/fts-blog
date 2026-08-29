'use strict';
/**
 * Minimal sequential schema migrations backed by a schema_migrations table.
 */
const db = require('./db');

const migrations = [
  {
    version: 1,
    name: 'create initial schema',
    up: (tx) => {
      tx.run(`
        CREATE TABLE IF NOT EXISTS users (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          username TEXT UNIQUE NOT NULL,
          password_hash TEXT NOT NULL,
          role TEXT DEFAULT 'admin',
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);
      tx.run(`
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
      tx.run(`
        CREATE TABLE IF NOT EXISTS tags (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT UNIQUE NOT NULL
        )
      `);
      tx.run(`
        CREATE TABLE IF NOT EXISTS post_tags (
          post_id INTEGER REFERENCES posts(id),
          tag_id INTEGER REFERENCES tags(id),
          PRIMARY KEY (post_id, tag_id)
        )
      `);
    }
  },
  {
    version: 2,
    name: 'add view_count to posts',
    up: (tx) => {
      const cols = tx.exec('PRAGMA table_info(posts)');
      const names = cols[0] ? cols[0].values.map((r) => r[1]) : [];
      if (!names.includes('view_count')) {
        tx.run('ALTER TABLE posts ADD COLUMN view_count INTEGER NOT NULL DEFAULT 0');
      }
    }
  }
];

async function migrate() {
  return db.transaction(async (tx) => {
    tx.run(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
    const appliedResult = tx.exec('SELECT version FROM schema_migrations');
    const applied = new Set(appliedResult[0] ? appliedResult[0].values.map((r) => r[0]) : []);
    for (const m of migrations) {
      if (applied.has(m.version)) continue;
      await m.up(tx);
      tx.run('INSERT INTO schema_migrations (version, name) VALUES (?, ?)', [m.version, m.name]);
      console.log(`✓ Migration ${m.version} applied: ${m.name}`);
    }
  });
}

module.exports = { migrate, migrations };
