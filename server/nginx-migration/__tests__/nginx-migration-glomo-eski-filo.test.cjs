// server/nginx-migration/__tests__/nginx-migration-glomo-eski-filo.test.cjs - Production
// Tasimalari: GLOMO'nun eski filosu KAPALI (2026-10-20).
//
// Kullanici: "Glomo icin tasarladigin tum islerde eski filoya gitmeyi kaldirabilirsin." Ekranin
// "Eski tanimi kaldir" dugmesi nginx_ops'u action=delete + new_fleet=false ile eski filoya
// gonderiyordu; GLOMO'da bu artik AWX'e GITMEZ.
//   EF1 GLOMO satiri: POST /delete 409 eski_filo_kapali; AWX'e hicbir istek yok (launch dahil),
//       denetim kaydi da yok (is baslamadi)
//   EF2 GLOMO DISI satir: silme eskisi gibi AWX'e gider (launch 1)
//   EF3 GLOMO tanim olusturma (yeni filo) reddedilmez
//   EF4 ekran ile sunucu ayni grup listesini tasir; GLOMO satirinda dugme pasif + gerekce
'use strict';

const h = require('./_harness.cjs');
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

before(h.start);
after(h.stop);
beforeEach(h.reset);

test('EF1 GLOMO eski tanim kaldirma AWX e gitmez', async () => {
  const r = await h.call('POST', '/api/nginx-migration/delete', h.GLOMO_BODY);
  assert.equal(r.status, 409);
  assert.equal(r.json.code, 'eski_filo_kapali');
  assert.match(r.json.message, /GLOMO için eski filoya .* hiçbir işte gidilmez/);
  assert.equal(h.awx.istekler.length, 0, 'GLOMO silmesi AWX e istek gonderdi: ' + JSON.stringify(h.awx.istekler.map((x) => x.yol)));
  assert.equal(h.launches().length, 0);
  assert.equal(h.audits.filter((a) => a.action === 'nginx_prod_migration_delete').length, 0);
  // harf varyanti da kapali degil: grup id sabit kucuk harf (ekran gonderir); bilinmeyen grup
  // eski davranisla validateRequest'te reddedilir
  const r2 = await h.call('POST', '/api/nginx-migration/delete', { ...h.GLOMO_BODY, group: 'GLOMO' });
  assert.notEqual(r2.status, 200);
  assert.equal(h.launches().length, 0);
});

test('EF2 GLOMO disi silme eskisi gibi AWX e gider', async () => {
  const r = await h.call('POST', '/api/nginx-migration/delete', h.BODY);
  assert.equal(r.status, 200, r.body);
  assert.equal(h.launches().length, 1);
});

test('EF3 GLOMO tanim olusturma (yeni filo) reddedilmez', async () => {
  const r = await h.call('POST', '/api/nginx-migration/create', { ...h.GLOMO_BODY, inputPath: '/yeni/' });
  assert.notEqual(r.json.code, 'eski_filo_kapali');
  assert.equal(r.status, 200, r.body);
});

test('EF4 ekran ve sunucu ayni grup listesi; GLOMO satirinda dugme pasif + gerekce', () => {
  const sunucu = [...require('../index.cjs').ESKI_FILO_KAPALI].sort();
  const ui = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'src', 'components', 'denetim', 'NginxProdMigration.tsx'), 'utf8');
  const m = ui.match(/const ESKI_FILO_KAPALI = new Set\(\[([^\]]*)\]\)/);
  assert.ok(m, 'ekranda ESKI_FILO_KAPALI yok');
  const ekran = [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]).sort();
  assert.deepEqual(ekran, sunucu, 'ekran ile sunucu farkli grup listesi tasiyor');
  assert.deepEqual(sunucu, ['glomo']);
  assert.match(ui, /canDelete=\{deleteConfigured && !ESKI_FILO_KAPALI\.has\(g\.id\)\}/);
  assert.match(ui, /silmeKapali=\{ESKI_FILO_KAPALI\.has\(g\.id\) \? ESKI_FILO_KAPALI_SEBEP : undefined\}/);
  assert.match(ui, /\{silmeKapali \? 'Eski filo kapalı' : 'Eski tanımı kaldır'\}/);
  assert.match(ui, /silmeKapali\s*\? silmeKapali\s*:/);
});
