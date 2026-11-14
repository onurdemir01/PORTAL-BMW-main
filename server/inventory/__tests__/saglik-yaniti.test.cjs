// server/inventory/__tests__/saglik-yaniti.test.cjs — /api/inventory/health oturumsuz cagirana
// veritabani ayrintisi vermez (2026-11-14: sunucu adi, port, veritabani adi ve havuz sayilari
// oturum istemeyen bu uctan agdaki herkese donuyordu).
//   SY1 oturumsuz: yalniz ok / service / mssqlAvailable
//   SY2 oturumlu ama Admin degil: ayni
//   SY3 Admin: ayrinti da gelir
//   SY4 rota bu islevi kullanir; govdede ayrinti alani elle yazilmaz (kaynak bekcisi)
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { _saglikYaniti: saglikYaniti } = require('../index.cjs');

const ORTAM = { MSSQL_SERVER: 'db.example.test', MSSQL_PORT: '14330', MSSQL_DATABASE: 'ORNEKDB' };
function ortamla(fn) {
  const onceki = {};
  for (const [k, v] of Object.entries(ORTAM)) {
    onceki[k] = process.env[k];
    process.env[k] = v;
  }
  try {
    return fn();
  } finally {
    for (const k of Object.keys(ORTAM)) {
      if (onceki[k] === undefined) delete process.env[k];
      else process.env[k] = onceki[k];
    }
  }
}
const istek = (user) => ({ session: user ? { user } : {}, headers: {}, get: () => undefined });
const TEMEL = ['mssqlAvailable', 'ok', 'service'];

test('SY1 oturumsuz cagri veritabani ayrintisi almaz', () => {
  ortamla(() => {
    for (const req of [istek(null), { headers: {}, get: () => undefined }]) {
      const y = saglikYaniti(req);
      assert.deepEqual(Object.keys(y).sort(), TEMEL);
      assert.equal(y.ok, true);
      assert.equal(typeof y.mssqlAvailable, 'boolean');
      const govde = JSON.stringify(y);
      for (const deger of Object.values(ORTAM)) assert.ok(!govde.includes(deger), deger);
    }
  });
});

test('SY2 oturumlu ama Admin olmayan kullanici da almaz', () => {
  ortamla(() => {
    for (const role of ['User', 'Operator', '', undefined, 'admin']) {
      const y = saglikYaniti(istek({ username: 'u', role }));
      assert.deepEqual(Object.keys(y).sort(), TEMEL, String(role));
    }
  });
});

test('SY3 Admin ayrintiyi gorur', () => {
  ortamla(() => {
    const y = saglikYaniti(istek({ username: 'a', role: 'Admin' }));
    assert.equal(y.server, ORTAM.MSSQL_SERVER);
    assert.equal(y.port, ORTAM.MSSQL_PORT);
    assert.equal(y.database, ORTAM.MSSQL_DATABASE);
    assert.ok('pool' in y);
    assert.equal(y.mssqlAvailable, saglikYaniti(istek(null)).mssqlAvailable);
  });
});

test('SY4 rota saglikYaniti kullanir', () => {
  const kaynak = fs.readFileSync(path.join(__dirname, '..', 'index.cjs'), 'utf8');
  assert.match(
    kaynak,
    /router\.get\('\/health', \(req, res\) => res\.json\(saglikYaniti\(req\)\)\);/,
  );
  assert.equal((kaynak.match(/process\.env\.MSSQL_SERVER/g) || []).length >= 1, true);
  // Sunucu adini yanita koyan tek yer saglikYaniti'dir.
  const i = kaynak.indexOf('function saglikYaniti(req)');
  const govde = kaynak.slice(i, kaynak.indexOf('\n}\n', i));
  assert.ok(govde.indexOf("getRequestRole(req) !== 'Admin'") < govde.indexOf('MSSQL_SERVER'));
});
