// server/audit/__tests__/nginx-host-labels.test.cjs - Nginx Hub > Envanter: elle etiket (2026-11-12).
//
// Kullanici: "sunuculari istedigim gibi label'layabilir miyim? ... conf.d/ altindaki dosyalarin ismine
// bakiyorduk ama benim overwrite edebilecegim sekilde bir feature mi yapsak?"
//   NL1 dogrulama: bos / too_many / gecersiz karakter / 20+ / bilinmeyen kip reddedilir; tekrarlar tekillesir
//   NL2 degistir: otomatik liste (too_many dahil) yerine gecer; ozet service sayimlari ve too_many listesi buna uyar
//   NL3 ekle: otomatik liste korunur, etiket eklenir; otomatik liste satirda `etiket.oto`
//   NL4 etiketsiz satirlar ayni nesne (kopyalanmaz, alan eklenmez)
//   NL5 kablolama: yazma uclari yalniz Admin, onbellegi temizler; tablo kurulumda ve eski sunucu temizliginde
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const et = require('../nginx-host-labels.cjs');
const { summarizeNginxInventory } = require('../nginx-inventory-summary.cjs');

const oku = (rel) => fs.readFileSync(path.join(__dirname, '..', '..', '..', rel), 'utf8');

test('NL1 dogrulama', () => {
  assert.match(et.dogrula({ etiketler: [] }).hata, /En az bir/);
  assert.match(et.dogrula({ etiketler: 'too_many' }).hata, /geçersiz/i);
  assert.match(et.dogrula({ etiketler: 'a b<c' }).hata, /geçersiz/i);
  assert.match(et.dogrula({ etiketler: Array.from({ length: 21 }, (_, i) => `e${i}`) }).hata, /20/);
  assert.match(et.dogrula({ mod: 'sil', etiketler: 'a' }).hata, /Kip/);
  const ok = et.dogrula({ mod: 'ekle', etiketler: 'glomo, glomo mobile-api', not: '  x  ' });
  assert.deepEqual(ok, { mod: 'ekle', etiketler: ['glomo', 'mobile-api'], not: 'x' });
  assert.equal(et.dogrula({ etiketler: ['a,b'] }).etiketler.length, 2);
});

const satirlar = () => [
  { hostname: 'GBNGXP09', env: 'production', services: 'too_many', service_count: 7 },
  { hostname: 'GBNGXP01', env: 'production', services: 'eski-ad,cso', service_count: 2 },
  { hostname: 'GBNGXP02', env: 'production', services: 'glomo', service_count: 1 },
];

test('NL2 degistir otomatik listenin yerine gecer; ozet buna uyar', () => {
  const etiketler = new Map([
    ['GBNGXP09', { mod: 'degistir', etiketler: ['glomo', 'mobile'], not: null, by: 'onur', at: null }],
    ['GBNGXP01', { mod: 'degistir', etiketler: ['glomo'], not: 'eski-ad aslinda glomo', by: 'onur', at: null }],
  ]);
  const rows = et.etiketUygula(satirlar(), etiketler);
  assert.equal(rows[0].services, 'glomo,mobile');
  assert.equal(rows[0].service_count, 2);
  assert.deepEqual(rows[0].etiket.oto, ['too_many']);
  const s = summarizeNginxInventory(rows);
  const glomo = s.byService.find((x) => x.service === 'glomo');
  assert.equal(glomo.hosts, 3);
  assert.equal(s.byService.find((x) => x.service === 'eski-ad'), undefined, 'degistirilen otomatik ad sayimda kaldi');
  assert.deepEqual(s.totals.servicesUnlisted, [], 'etiketlenen too_many sunucusu hala listelenmedi sayiliyor');
});

test('NL3 ekle otomatik listeyi korur', () => {
  const rows = et.etiketUygula(satirlar(), new Map([['GBNGXP02', { mod: 'ekle', etiketler: ['mobile', 'glomo'] }]]));
  assert.equal(rows[2].services, 'glomo,mobile');
  assert.deepEqual(rows[2].etiket.oto, ['glomo']);
  assert.equal(rows[2].etiket.mod, 'ekle');
  // too_many sunucusuna ekle: liste toplanmadi bilgisi kaybolmaz
  const r9 = et.etiketUygula(satirlar(), new Map([['GBNGXP09', { mod: 'ekle', etiketler: ['glomo'] }]]))[0];
  assert.equal(r9.services, 'too_many,glomo');
  assert.equal(r9.service_count, 7);
});

test('NL4 etiketsiz satirlar degismez', () => {
  const s = satirlar();
  const rows = et.etiketUygula(s, new Map([['GBNGXP02', { mod: 'ekle', etiketler: ['x'] }]]));
  assert.equal(rows[0], s[0]);
  assert.equal('etiket' in rows[1], false);
  assert.equal(et.etiketUygula(s, new Map()), s);
});

test('NL5 kablolama', () => {
  const d = oku('server/audit/denetim.cjs');
  assert.match(d, /router\.put\('\/nginx-inventory\/labels\/:host', requireAdmin,/);
  assert.match(d, /router\.delete\('\/nginx-inventory\/labels\/:host', requireAdmin,/);
  const blok = d.slice(d.indexOf("'/nginx-inventory/labels/:host'"), d.indexOf("router.delete('/nginx-audit/exceptions/:host'"));
  assert.equal((blok.match(/responseCache\.clear\(\)/g) || []).length, 2, 'yazinca onbellek temizlenmiyor');
  // envanter ucu etiketi uygular; okunamazsa sayfa dusmez
  assert.match(d, /et\.etiketUygula\(es\.ayir\(r\.recordset/);
  assert.match(d, /etiketHatasi = e\.message/);
  assert.match(oku('server/db/mssql-setup.cjs'), /CREATE TABLE nginx_host_labels \(/);
  assert.match(oku('server/nginx-console/eski-sunucu.cjs'), /\{ tablo: 'nginx_host_labels' \}/);
});
