'use strict';
/**
 * Debounced view counter. Increments are buffered in memory and flushed to the
 * database in one batched transaction periodically, so a single page view does
 * not trigger a full sql.js file export + rewrite.
 */
const db = require('../database/db');

const FLUSH_INTERVAL_MS = 30 * 1000;
const FLUSH_THRESHOLD = 20;

const pending = new Map();
let timer = null;

function scheduleFlush() {
  if (timer) return;
  timer = setInterval(() => {
    flush().catch((err) => console.error('view counter flush error:', err));
  }, FLUSH_INTERVAL_MS);
  if (timer.unref) timer.unref();
}

function increment(postId) {
  pending.set(postId, (pending.get(postId) || 0) + 1);
  scheduleFlush();
  if (pending.size >= FLUSH_THRESHOLD) {
    flush().catch((err) => console.error('view counter flush error:', err));
  }
}

async function flush() {
  if (pending.size === 0) return 0;
  const batch = Array.from(pending.entries());
  pending.clear();
  try {
    await db.transaction(async (tx) => {
      for (const [postId, count] of batch) {
        tx.run('UPDATE posts SET view_count = view_count + ? WHERE id = ?', [count, postId]);
      }
    });
    return batch.length;
  } catch (err) {
    for (const [postId, count] of batch) {
      pending.set(postId, (pending.get(postId) || 0) + count);
    }
    throw err;
  }
}

module.exports = { increment, flush };

/* Graceful shutdown: flush pending counts before exit (PM2 restart / stop). */
function shutdown() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  flush().catch((err) => console.error('view counter shutdown flush error:', err));
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
process.on('beforeExit', shutdown);
