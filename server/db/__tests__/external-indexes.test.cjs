// server/db/__tests__/external-indexes.test.cjs — EI1..EI3 (2026-09-21).
// Denetim tablolarina scan_date indeksi: yoksa yaratir, varsa dokunmaz, tablo/sutun yoksa atlar,
// hata bir tabloyu atlatir. CREATE INDEX uzun zaman asimli AYRI baglantidan gider (30 sn havuz degil).
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const { ensureExternalIndexes, WANTED } = require('../external-indexes.cjs');

function fakePool(state, executed) {
  return { request: () => ({ query: async (q) => {
    if (/CREATE INDEX/.test(q)) { executed.push(q); return {}; }
    const m = q.match(/t\.name = '(\w+)'/);
    const st = state[m[1]] || { table: 0, index: 0, col: 0 };
    return { recordset: [{ has_table: st.table, has_index: st.index, has_col: st.col }] };
  } }) };
}
// CREATE INDEX icin acilan ayri havuzu da sahte havuza yonlendir
function withFakeMssql(executed, fn) {
  const orig = Module.prototype.require;
  Module.prototype.require = function (id) {
    if (id === 'mssql') return { ConnectionPool: function () { return { connect: async () => ({ request: () => ({ query: async (q) => { executed.push(q); return {}; } }), close: async () => {} }) }; } };
    return orig.apply(this, arguments);
  };
  return fn().finally(() => { Module.prototype.require = orig; });
}
const quiet = { log() {}, warn() {} };

test('EI1: eksik indeks yaratilir, var olan atlanir, tablo yoksa dokunulmaz', async () => {
  const executed = [];
  const state = { Nginx_Audit_Settings: { table: 1, index: 0, col: 1 }, Nginx_Audit_Hosts: { table: 1, index: 1, col: 1 } };
  const done = await withFakeMssql(executed, () => ensureExternalIndexes(fakePool(state, executed), quiet));
  assert.deepEqual(done, ['IX_Nginx_Audit_Settings_scan']);
  assert.equal(executed.length, 1);
  assert.match(executed[0], /CREATE INDEX IX_Nginx_Audit_Settings_scan ON dbo\.Nginx_Audit_Settings \(scan_date, host\)/);
});

test('EI2: scan_date sutunu olmayan tablo atlanir', async () => {
  const executed = [];
  const done = await withFakeMssql(executed, () => ensureExternalIndexes(fakePool({ Nginx_Config_Audit: { table: 1, index: 0, col: 0 } }, executed), quiet));
  assert.deepEqual(done, []);
});

test('EI3: istenen liste Portal\'in scan_date ile okudugu tablolari kapsar', () => {
  const names = WANTED.map((w) => w.table);
  for (const t of ['Nginx_Audit_Hosts', 'Nginx_Audit_Settings', 'Nginx_Audit_Locations', 'Nginx_Config_Audit', 'Nginx_Intranet_Audit']) assert.ok(names.includes(t), t);
  for (const w of WANTED) assert.ok(w.cols.startsWith('scan_date'), `${w.table}: scan_date onde olmali`);
});
