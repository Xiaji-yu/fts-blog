'use strict';
/**
 * Centralized database access layer for sql.js (SQLite via WASM).
 *
 * - Single in-memory SQL.Database instance (no per-request WASM reload).
 * - All operations serialized through a queue to avoid file write races.
 * - Writes persist the whole DB file after execution; transactions snapshot
 *   the in-memory DB so a failed transaction is rolled back on the next op.
 */
const fs = require('fs');
const path = require('path');
const initSqlJs = require('sql.js');
const config = require('../config/loader');

const DB_PATH = process.env.FTS_DB_PATH
  ? path.resolve(process.env.FTS_DB_PATH)
  : path.join(__dirname, '..', config.database.path);

const SAVE_TIMEOUT_MS = config.database.saveTimeoutMs || 30000;

let db = null;
let SQL = null;
const opQueue = [];
let processing = false;

function databasePath() {
  return DB_PATH;
}

async function ensureDb() {
  if (db) return db;
  if (!SQL) {
    SQL = await initSqlJs();
  }
  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  db = fs.existsSync(DB_PATH)
    ? new SQL.Database(new Uint8Array(fs.readFileSync(DB_PATH)))
    : new SQL.Database();
  return db;
}

function withTimeout(promise, ms = SAVE_TIMEOUT_MS) {
  let timeoutId;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`Database save timed out after ${ms}ms`));
    }, ms);
  });
  return Promise.race([promise.finally(() => clearTimeout(timeoutId)), timeoutPromise]);
}

async function persist() {
  const data = db.export();
  await withTimeout(fs.promises.writeFile(DB_PATH, Buffer.from(data)));
}

function enqueue(task) {
  return new Promise((resolve, reject) => {
    opQueue.push({ task, resolve, reject });
    drain();
  });
}

async function drain() {
  if (processing) return;
  processing = true;
  try {
    while (opQueue.length) {
      const { task, resolve, reject } = opQueue.shift();
      try {
        resolve(await task());
      } catch (err) {
        reject(err);
      }
    }
  } finally {
    processing = false;
  }
}

/**
 * Read-only query. Returns the same [{ columns, values }] shape as sql.js exec.
 */
async function exec(sql, params = []) {
  return enqueue(async () => {
    const handle = await ensureDb();
    return handle.exec(sql, params);
  });
}

/**
 * Write query; persists the database file after execution.
 */
async function run(sql, params = []) {
  return enqueue(async () => {
    const handle = await ensureDb();
    handle.run(sql, params);
    const changes = handle.getRowsModified();
    await persist();
    return { changes };
  });
}

/**
 * Run a group of statements atomically.
 * fn receives a tx object with exec/run/lastInsertRowid. On success the DB is
 * persisted once; on error the in-memory DB is restored from a pre-transaction
 * snapshot (real rollback) and the error is re-thrown.
 */
async function transaction(fn) {
  return enqueue(async () => {
    const handle = await ensureDb();
    const snapshot = handle.export();
    const tx = {
      exec: (sql, params = []) => handle.exec(sql, params),
      run: (sql, params = []) => {
        handle.run(sql, params);
        return { changes: handle.getRowsModified() };
      },
      lastInsertRowid: () => handle.exec('SELECT last_insert_rowid()')[0].values[0][0]
    };
    try {
      const result = await fn(tx);
      await persist();
      return result;
    } catch (err) {
      db = new SQL.Database(snapshot);
      throw err;
    }
  });
}

module.exports = { exec, run, transaction, databasePath };
