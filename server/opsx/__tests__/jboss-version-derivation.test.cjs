// server/opsx/__tests__/jboss-version-derivation.test.cjs — J7..J11.
//
// NE OLDU: AWX'e giden `jboss_version` extra_var'i host adiyla ANAHTARLI bir Map'ten
// turetiliyordu:
//     const versionByHost = new Map(appHosts.map((h) => [h.host, h.jbossVersion]));
// Kurumsal envanter (`MWAppsInventory`) ayni sunucu icin BIRDEN COK satir donduruyor —
// biri JBoss 7 kurulumu, digeri JBoss 8. Map'te ikinci satir birincisini eziyordu,
// yani cift kurulumlu bir host'ta turetilen major `ORDER BY host` siralamasinin
// RASTGELE sonucuydu. Kullanicinin "yalnizca bu sunucunun JBoss 8 kurulumu" demesinin
// de bir yolu yoktu.
//
// SONUCU URETIMDE: kullanici JBoss 8 icin restart isteyip JBoss 7 kurulumunda islem
// gormus olabilirdi ve ekranda bunu gosteren hicbir sey yoktu.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { deriveJbossVersion } = require('../index.cjs');

// Cift kurulumlu bir sunucu: envanter GBCJAP01 icin IKI satir donduruyor.
const DUAL = [
  { host: 'GBCJAP01', jbossVersion: '7.3.10' },
  { host: 'GBCJAP01', jbossVersion: '8.0.7' },
  { host: 'GBCJAP02', jbossVersion: '8.1.2' },
  { host: 'GBCJAP03', jbossVersion: '7.3.10' },
];

// ── J7: kullanicinin secimi turetmeyi EZER ──────────────────────────────────
test('J7: cift kurulumlu host + yalniz JBoss 8 isaretlendi -> jboss8', () => {
  assert.equal(
    deriveJbossVersion(DUAL, ['GBCJAP01'], ['8']),
    'jboss8',
    'kullanici JBoss 8 dedi; JBoss 7 kurulumuna islem gitmemeli'
  );
  assert.equal(deriveJbossVersion(DUAL, ['GBCJAP01'], ['7']), 'jboss7');
});

test('J8: iki kurulum da isaretlendiyse "all" — bu kullanicinin karari', () => {
  assert.equal(deriveJbossVersion(DUAL, ['GBCJAP01'], ['7', '8']), 'all');
});

test('J9: farkli sunucular ama TEK major -> "all" DEGIL, o major', () => {
  // Eski kodun en gorunur zarari: GBCJAP01 (cift) + GBCJAP02 (yalniz 8) secilip
  // yalniz JBoss 8 satirlari isaretlendiginde "all" gidiyordu ve islem GBCJAP01'in
  // JBoss 7 kurulumuna da uzaniyordu.
  assert.equal(deriveJbossVersion(DUAL, ['GBCJAP01', 'GBCJAP02'], ['8']), 'jboss8');
});

// ── J10: iddia edilen major envanterde YOKSA reddedilir ─────────────────────
test('J10: secilen sunuculardaki kurulumlarda olmayan major reddedilir', () => {
  // GBCJAP02 yalniz JBoss 8 — "7" iddiasi envanterde karsiliksiz.
  assert.throws(
    () => deriveJbossVersion(DUAL, ['GBCJAP02'], ['7']),
    (err) => err.status === 400 && /bulunmayan JBoss/i.test(err.message),
    'istemcinin uydurdugu major 400 ile reddedilmeli'
  );
});

// ── J11: cift gondermeyen ESKI istemci kirilmaz ─────────────────────────────
test('J11: hostMajors gonderilmezse envanterden turetilir (eski istemci)', () => {
  assert.equal(deriveJbossVersion(DUAL, ['GBCJAP02'], undefined), 'jboss8');
  assert.equal(deriveJbossVersion(DUAL, ['GBCJAP03'], undefined), 'jboss7');
  // Cift kurulumlu host: artik IKI major de sayilir. Eski Map birini sessizce
  // dusuruyordu ve sonuc siralamaya bagliydi — bu davranis KORUNMAZ.
  assert.equal(
    deriveJbossVersion(DUAL, ['GBCJAP01'], undefined),
    'all',
    'cift kurulumlu host tek majore cokuyor — eski Map hatasi geri gelmis'
  );
});

test('J11b: JBoss olmayan uygulama (WAS) null doner — extra_var hic gonderilmez', () => {
  const was = [{ host: 'WASHOST01', jbossVersion: 'NF' }, { host: 'WASHOST02', jbossVersion: '' }];
  assert.equal(deriveJbossVersion(was, ['WASHOST01', 'WASHOST02'], undefined), null);
  // Bos dizi de "iddia yok" sayilmali (ekran hicbir major isaretlemediyse).
  assert.equal(deriveJbossVersion(was, ['WASHOST01'], []), null);
});

test('J11c: 7/8 disindaki majorler (9, 6) yok sayilir', () => {
  const odd = [{ host: 'H1', jbossVersion: '9.0.1' }, { host: 'H1', jbossVersion: '8.0.7' }];
  assert.equal(
    deriveJbossVersion(odd, ['H1'], undefined),
    'jboss8',
    'taninmayan major turetmeye karismamali'
  );
});
