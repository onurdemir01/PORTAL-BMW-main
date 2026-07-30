// server/dynatrace/cache.cjs — simple TTL in-memory cache
'use strict';

const _store = new Map(); // key → { data, ts }

function get(key, ttlMs) {
  const e = _store.get(key);
  if (e && Date.now() - e.ts < ttlMs) return e.data;
  return null;
}

function set(key, data) {
  _store.set(key, { data, ts: Date.now() });
}

function del(key) {
  _store.delete(key);
}

function clear() {
  _store.clear();
}

module.exports = { get, set, del, clear };
