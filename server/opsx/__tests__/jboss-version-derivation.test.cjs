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

// ── J12-J14: KURULUM DIZINI (uretim 2026-10-08, GBJBOP18 / GBCCSECURETRACKER) ──────────────
// Standart disi sunucu: /usr/jboss altina da JBoss 8 kurulmus. Envanter iki satir donduruyor,
// IKISI DE 8.x; ayirt eden tek alan app_path. Playbook'lar dizine gore dallanir ("7" kolu =
// /usr/jboss, "8" kolu = /usr/jboss8), kol da oradan okunmali.
const { kurulumKolu } = require('../index.cjs');
const GBJBOP18 = [
  { host: 'GBJBOP18', jbossVersion: '8.0', appPath: '/vhosting/GBCCSECURETRACKER.ear', kurulum: '7' },
  { host: 'GBJBOP18', jbossVersion: '8.1', appPath: '/vhosting8/GBCCSECURETRACKER.ear', kurulum: '8' },
];

test('J12: kol app_path dizininden; app_path yok/NF ise urun surumune dusulur', () => {
  assert.equal(kurulumKolu('/vhosting/GBCCSECURETRACKER.ear', '8.0'), '7', '/usr/jboss altindaki JBoss 8 "8" koluna gidiyor');
  assert.equal(kurulumKolu('/vhosting8/GBCCSECURETRACKER.ear', '8.1'), '8');
  assert.equal(kurulumKolu('/VHOSTING8/X.ear', '7.3'), '8', 'kasa');
  assert.equal(kurulumKolu('NF', '8.1.2'), '8');
  assert.equal(kurulumKolu('', '7.3.10'), '7');
  assert.equal(kurulumKolu('', 'NF'), '');
});

test('J13: standart disi sunucuda /usr/jboss kurulumu AYRI hedeflenir', () => {
  assert.equal(deriveJbossVersion(GBJBOP18, ['GBJBOP18'], ['7']), 'jboss7', '/usr/jboss secildi, /usr/jboss8 kolu gitti');
  assert.equal(deriveJbossVersion(GBJBOP18, ['GBJBOP18'], ['8']), 'jboss8');
  assert.equal(deriveJbossVersion(GBJBOP18, ['GBJBOP18'], ['7', '8']), 'all');
});

test('J14: urun surumu 8 olsa da "7" kolu (/usr/jboss) bu sunucuda GECERLI bir iddia', () => {
  assert.doesNotThrow(() => deriveJbossVersion(GBJBOP18, ['GBJBOP18'], ['7']));
  const yalniz8 = [GBJBOP18[1]];
  assert.throws(() => deriveJbossVersion(yalniz8, ['GBJBOP18'], ['7']), /bulunmayan JBoss/);
});
