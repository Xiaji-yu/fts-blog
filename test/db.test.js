'use strict';
// Database layer tests — runs against an isolated temp DB file.
const path = require('path');
const fs = require('fs');

// Own subdirectory: node --test runs files in parallel, so this file must not
// share its temp dir with api.test.js (each after() removes its own dir).
process.env.FTS_DB_PATH = path.join(__dirname, '.tmp', 'db', 'test-' + process.pid + '.db');

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const db = require('../database/db');
const { migrate } = require('../database/migrations');

before(async () => {
  await migrate();
});

after(() => {
  try {
    fs.rmSync(path.dirname(process.env.FTS_DB_PATH), { recursive: true, force: true });
  } catch (err) {
    // ignore cleanup errors
  }
});

test('migrations are idempotent', async () => {
  await migrate(); // second run must be a no-op
  const result = await db.exec('SELECT version FROM schema_migrations ORDER BY version');
  assert.ok(result[0].values.length >= 2);
});

test('run() persists rows and exec() reads them back', async () => {
  await db.run('INSERT INTO tags (name) VALUES (?)', ['db-test-tag']);
  const result = await db.exec('SELECT id, name FROM tags WHERE name = ?', ['db-test-tag']);
  assert.equal(result[0].values.length, 1);
  assert.equal(result[0].values[0][1], 'db-test-tag');
});

test('posts table has view_count column (migration v2)', async () => {
  const cols = await db.exec('PRAGMA table_info(posts)');
  const names = cols[0].values.map((r) => r[1]);
  assert.ok(names.includes('view_count'));
});

test('transaction rolls back on error', async () => {
  await assert.rejects(
    db.transaction(async (tx) => {
      tx.run('INSERT INTO tags (name) VALUES (?)', ['ghost-tag']);
      throw new Error('boom');
    }),
    /boom/
  );
  const result = await db.exec('SELECT COUNT(*) AS c FROM tags WHERE name = ?', ['ghost-tag']);
  assert.equal(result[0].values[0][0], 0);
});

test('transaction commits on success', async () => {
  await db.transaction(async (tx) => {
    tx.run('INSERT INTO tags (name) VALUES (?)', ['commit-tag']);
  });
  const result = await db.exec('SELECT COUNT(*) AS c FROM tags WHERE name = ?', ['commit-tag']);
  assert.equal(result[0].values[0][0], 1);
});

test('run() returns changes count', async () => {
  const { changes } = await db.run('UPDATE tags SET name = name WHERE name = ?', ['commit-tag']);
  assert.equal(typeof changes, 'number');
});
