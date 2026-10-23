// server/logx/v2/__tests__/fixtures/nginx-red.cjs — HTTP katmaninda red beklentisi.
//
// Kurumsal nginx 403 / 404 govdesini HTML sayfasiyla degistirdigi icin LogX bu redleri
// 409 + `upstreamStatus` (asil kod) ile doner (server/util/nginx-red.cjs, 2026-10-23).
// Modul duzeyindeki `err.status === 403` beklentileri DEGISMEZ; cevrim yalniz HTTP yanitinda.
'use strict';

const assert = require('node:assert/strict');

function govdeOf(r) {
  return typeof r.body === 'string' ? JSON.parse(r.body || '{}') : r.body || {};
}

function reddedildi(r, asil = 403, mesaj) {
  const g = govdeOf(r);
  assert.equal(r.status, 409, mesaj || JSON.stringify(g));
  assert.equal(g.upstreamStatus, asil, mesaj || JSON.stringify(g));
  assert.equal(g.ok, false, mesaj);
}

module.exports = { reddedildi, govdeOf };
