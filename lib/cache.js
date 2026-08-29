'use strict';
/**
 * Tiny in-memory TTL cache used for read-heavy public pages (e.g. homepage).
 * Call invalidateAll() after any write to keep cached reads fresh.
 */
const cache = new Map();

const DEFAULT_TTL_MS = 60 * 1000;

function get(key) {
  const entry = cache.get(key);
  if (!entry) return undefined;
  if (Date.now() - entry.at > entry.ttl) {
    cache.delete(key);
    return undefined;
  }
  return entry.value;
}

function set(key, value, ttlMs = DEFAULT_TTL_MS) {
  cache.set(key, { value, at: Date.now(), ttl: ttlMs });
}

function invalidateAll() {
  cache.clear();
}

module.exports = { get, set, invalidateAll };
