// server/spa-report/__tests__/spa-report.test.cjs — Nginx ARK SPA Raporu.
//
// Kullanici (2026-09-28): "SPA Tasimalari sayfasinin birebir aynisini Glomo / Webforms /
// Saklama / Geintdigital vb. TUM servislerimiz icin, sol menuye yeni bir bolum ekleyerek
// 'Nginx ARK SPA Raporu' adiyla istiyorum. Buraya ekiplerin giris yapabilmesini istiyorum.
// Kolonlar: Ekip Beyani, Uygulama, Namespace, Ekip, Yuk Durumu, Location, Aciklama."
// Beyan alani icin: "senin eski yazimin olarak kullaniyor/kullanmiyor/bilmiyor olarak
// devam ettirelim" - yani SPA Tasimalari'ndaki ALANIN AYNISI.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { buildSpaReport } = require('../build.cjs');
const { flatten } = require('../../util/guard-text.cjs');

const satir = (o) => ({
  service: 'GLOMO',
  env: 'PROD',
  application: 'x-app-v1',
  namespace: 'ns1-prod',
  location_path: '/x/',
  host: 'GBNGXP40',
  vhost: 'GLOMO-PROD.conf',
  ...o,
});

test('AR1: ayni tanim mirror sunucularda TEKRAR ETMEZ, sunucular toplanir', () => {
  // Prod'da ayni vhost 4-8 nginx'te durur. Tekillestirmezsek ekip ayni uygulamayi
  // sekiz kez gorur ve listeyi okuyamaz.
  const r = buildSpaReport({
    rows: [satir({ host: 'GBNGXP40' }), satir({ host: 'GBNGXP41' }), satir({ host: 'GBNGXP48' })],
  });
  assert.equal(r.rows.length, 1);
  assert.deepEqual(r.rows[0].hosts, ['GBNGXP40', 'GBNGXP41', 'GBNGXP48']);
});

test('AR2: yalniz PROD; baska ortamlar rapora GIRMEZ', () => {
  const r = buildSpaReport({
    rows: [satir({}), satir({ env: 'TEST', application: 'y-app-v1' })],
  });
  assert.deepEqual(
    r.rows.map((x) => x.application),
    ['x-app-v1'],
  );
});

test('AR3: uygulama/namespace bilgisi olmayan satir listeye girmez ama SAYILIR', () => {
  // Uzerinde beyan verilemeyecek bir satir listeyi uzatmaktan baska ise yaramaz; ama
  // sessizce dusurmek de "envanterin tamami bu" izlenimi verirdi.
  const r = buildSpaReport({ rows: [satir({}), satir({ application: '', namespace: '' })] });
  assert.equal(r.rows.length, 1);
  assert.equal(r.skipped, 1, 'atlanan satir sayisi soylenmiyor');
});

test('AR4: OLCUM ile BEYAN ayri tasinir ve biri digerini EZMEZ', () => {
  // Kullanicinin kurali: yilda bir kosan bir is olcumde "yuk almiyor" gorunur ama ekip
  // kullaniyordur. Celiski BILGIDIR.
  const r = buildSpaReport({
    rows: [satir({})],
    trafficOf: () => ({
      state: 'idle',
      req7: 0,
      req24: 0,
      sampled: false,
      lastSeen: null,
      hosts: 4,
      unknownHosts: 0,
    }),
    beyanlar: new Map([
      ['ns1-prod/x-app-v1', { inUse: 'yes', inUseBy: 'onur', note: 'yilda bir kosar' }],
    ]),
  });
  const row = r.rows[0];
  assert.equal(row.traffic.state, 'idle', 'olcum beyanla degistirilmis');
  assert.equal(row.inUse, 'yes', 'beyan olcumle degistirilmis');
  assert.equal(row.inUseBy, 'onur', 'kimin beyan ettigi tasinmiyor');
  assert.equal(row.note, 'yilda bir kosar');
});

test('AR5: beyan YOKSA bos kalir - "kullanmiyor" UYDURULMAZ', () => {
  const r = buildSpaReport({ rows: [satir({})], beyanlar: new Map() });
  assert.equal(r.rows[0].inUse, null, 'beyan verilmemisken bir deger uydurulmus');
});

test('AR6: servis ozetinde beyan BEKLEYEN sayisi gorunur', () => {
  const r = buildSpaReport({
    rows: [
      satir({ application: 'a-app-v1' }),
      satir({ application: 'b-app-v1' }),
      satir({ service: 'WEBFORMS', application: 'c-app-v1' }),
    ],
    beyanlar: new Map([['ns1-prod/a-app-v1', { inUse: 'yes' }]]),
  });
  const glomo = r.services.find((s) => s.service === 'GLOMO');
  assert.equal(glomo.apps, 2);
  assert.equal(glomo.declared, 1, 'beyan sayisi yanlis - ekip "ne kadari bekliyor" goremiyor');
  assert.ok(
    r.services.some((s) => s.service === 'WEBFORMS'),
    'servisler ayri ayri listelenmiyor',
  );
});

test('AR7: uc sozlesmesi - beyan TEK ALANDIR ve kim yazdigi kaydedilir', () => {
  const src = flatten(
    fs
      .readFileSync(path.join(__dirname, '..', 'index.cjs'), 'utf8')
      .split('\n')
      .filter((l) => !l.trim().startsWith('//'))
      .join('\n'),
  );
  // AYNI ALAN: SPA Tasimalari'nin tablosuna yazilir, ikinci bir tablo acilmaz.
  assert.match(
    src,
    /nginx_migration_tracking/,
    'beyan ayri bir yere yaziliyor - iki ekranda iki cevap olur',
  );
  // Okuma group_id'ye BAKMAZ: ayni uygulamanin tasima satiri varsa o beyan gorunmeli.
  assert.match(src, /ORDER BY updated_at ASC/, 'en yeni beyanin kazandigi garanti degil');
  // Yazarken MEVCUT satir guncellenir (yeni satir acmak ikinci bir cevap uretirdi).
  assert.match(
    src,
    /SELECT TOP 1 group_id FROM nginx_migration_tracking/,
    'mevcut satir aranmiyor',
  );
  // KIM yazdi: beyan bir olcum degil, ifadedir - kimin soyledigi bilinmeden degeri olmaz.
  assert.match(src, /in_use_by = \$4/, 'beyani kimin yazdigi kaydedilmiyor');
  // Gecersiz beyan reddedilir.
  assert.match(src, /new Set\(\['yes', 'no', 'unknown'\]\)/, 'beyan degerleri dogrulanmiyor');
  // SALT OKUNUR DEGIL ama YETKI KAPISI VAR: gorunurluk motorundan gecer.
  assert.match(src, /requireVisible\('ArkSpaRaporu'\)/, 'gorunurluk kapisi yok');
  // Tarama yoksa BOS LISTE degil, "taranmadi" doner.
  assert.match(src, /notScanned: true/, '"hic SPA yok" ile "henuz taranmadi" ayrilmamis');
});

test('AR8: sayfa UC YERDE de kayitli (menu sessizce dusmesin)', () => {
  const KOK = path.join(__dirname, '..', '..', '..');
  const oku = (p) => fs.readFileSync(path.join(KOK, p), 'utf8').replace(/"/g, "'");
  assert.match(oku('server/db/mssql-setup.cjs'), /element_key: 'ArkSpaRaporu'/, 'DB seed');
  assert.match(oku('src/config/elements.ts'), /id: 'ArkSpaRaporu'/, 'elements.ts PAGES');
  assert.match(oku('src/config/elements.ts'), /itemIds: \['ArkSpaRaporu'\]/, 'NAV_GROUPS');
  assert.match(oku('src/App.tsx'), /path='\/ark-spa-raporu'/, 'App.tsx route');
  assert.match(oku('server/index.cjs'), /spa-report/, 'sunucu modulu baglanmamis');
});
