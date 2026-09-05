// server/logx/v2/__tests__/ocp-scan-cooldown.test.cjs — SONSUZ KESIF DONGUSU bekcileri.
//
// URETIMDE NE OLDU: DB'de kaydi olmayan bir namespace'e girildiginde sihirbaz otomatik
// kesif baslatiyor, ama taradigini ISLEYEMEDEN yenisini basliyordu. Kullanici "1 dk 36 sn"
// bekleyip ayni ekrani tekrar goruyordu. Bes ayri kusur ayni donguyu besliyordu; bu dosya
// SUNUCU tarafindaki ucunu kilitler (ekran tarafi src/__tests__/logx-autoscan-memo).
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const jobs = require('../jobs.cjs');

// YORUMLARI AT — ZORUNLU. Bu bekcinin ilk surumu YORUM SATIRINI de tariyordu:
// karar satiri `//` ile devre disi birakildiginda desen hala esliyor ve bekci YESIL
// kaliyordu (mutasyonla yakalandi). Kaynak tarayan her bekci once yorumlari atmali.
const codeOnly = (s) =>
  s
    .split('\n')
    .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
    .join('\n');

const read = (p) => codeOnly(fs.readFileSync(path.join(__dirname, '..', p), 'utf8'));
// Bicim degil KURAL olculur (prettier bu depoda tek seferde 14 bekci kirdi).
const norm = (s) => s.replace(/\s+/g, ' ').replace(/'/g, '"');

// ── SOGUMA PENCERESI ────────────────────────────────────────────────────────

test('CD1 soguma penceresi ICINDEKI terminal is yeni launch actirmaz', () => {
  const justFinished = { finishedAt: new Date(Date.now() - 5_000).toISOString() };
  assert.equal(jobs.isWithinCooldown(justFinished), true);
});

test('CD2 pencere DISINDAKI terminal is yeni launch acilmasini engellemez', () => {
  const old = {
    finishedAt: new Date(Date.now() - (jobs.LAUNCH_COOLDOWN_MS + 5_000)).toISOString(),
  };
  assert.equal(jobs.isWithinCooldown(old), false);
});

test('CD3 `finishedAt` YOKSA pencere UYGULANMAZ (calisan yolu kapatma)', () => {
  // Zamani bilinmeyen bir isi gerekcesiz engellemek, kullaniciyi calisan bir yoldan
  // mahrum birakirdi. Bilinmezlikte ENGELLEME yonu secildi.
  assert.equal(jobs.isWithinCooldown({ finishedAt: null }), false);
  assert.equal(jobs.isWithinCooldown({}), false);
  assert.equal(jobs.isWithinCooldown(null), false);
  assert.equal(jobs.isWithinCooldown(undefined), false);
});

test('CD4 bozuk/gelecek tarihli damga pencereyi SONSUZ yapmaz', () => {
  assert.equal(jobs.isWithinCooldown({ finishedAt: 'bu bir tarih degil' }), false);
  // Sunucu saati kaymasi: gelecek tarihli damga negatif yas uretir; pencere acilmamali.
  const future = { finishedAt: new Date(Date.now() + 600_000).toISOString() };
  assert.equal(jobs.isWithinCooldown(future), false);
});

test('CD5 launchJob soguma penceresini GERCEKTEN uyguluyor (karar noktasi)', () => {
  // Tanimin VARLIGI degil, KARAR SATIRI aranir: bu depoda bekciler defalarca
  // fonksiyon tanimiyla eslesip kullanim silindiginde yesil kaldi.
  const src = norm(read('jobs.cjs'));
  assert.match(
    src,
    /if \(isWithinCooldown\(lastTerminal\)\) return lastTerminal;/,
    'launchJob soguma penceresini uygulamiyor — terminal is biter bitmez yeni launch serbest',
  );
  // ZINCIR KIRILMASINA IZIN VER: prettier `[...existing].reverse().find(` zincirini
  // satirlara boluyor ve `norm` bunlari BOSLUGA cevirdigi icin bitisik desen tutmuyor.
  // Olculen kural: son TERMINAL is, mevcut isler arasindan aranıyor mu?
  assert.match(
    src,
    /const lastTerminal = \[\.\.\.existing\] ?\.reverse\(\) ?\.find\(/,
    'son terminal is hic aranmiyor',
  );
  assert.match(
    src,
    /lastTerminal[\s\S]{0,160}TERMINAL_STATUSES\.has\(j\.status\)/,
    'son terminal is TERMINAL_STATUSES ile suzulmuyor',
  );
});

// ── TARAMA KAYDI: "YOK" ile "OKUYAMADIM" AYRI ───────────────────────────────

test('CD6 getAppScan DB hatasinda `unknown` isaretiyle doner, null DEGIL', () => {
  // Ikisi de null donuyordu: okunamayan bir tablo "hic taranmamis" sayiliyor,
  // sihirbaz otomatik tarama aciyor, kayit yine okunamiyor -> SONSUZ DONGU.
  const src = norm(read('ocp-cache.cjs'));
  assert.match(
    src,
    /return \{ unknown: true, appCount: 0, scannedAt: null \};/,
    'DB hatasi hala "satir yok" ile ayni sekilde ele aliniyor',
  );
});

test('CD7 `scannedEmpty` bilinmeyen tarama kaydinda TRUE olamaz', () => {
  const src = norm(read('ocp-cache.cjs'));
  assert.match(
    src,
    /scannedEmpty: Boolean\(scan && !scan\.unknown &&/,
    '`unknown` tarama kaydi "tarandi ve bos" sayiliyor — yanlis bilgi',
  );
  assert.match(src, /scanUnknown: Boolean\(scan && scan\.unknown\)/, 'scanUnknown yayinlanmiyor');
});

test('CD8 katalog birlestiricisi `scanUnknown` bayragini TASIYOR', () => {
  // Tasimazsa ekran bayragi hic gormez ve dongu geri gelir.
  const src = norm(read('ocp-catalog.cjs'));
  assert.match(
    src,
    /scanUnknown: cachedPerCluster\.some\(\(c\) => c\.scanUnknown\)/,
    'cluster basina scanUnknown birlestirilmiyor',
  );
});

// ── TARAMA KAYDI YAZIMI, UYGULAMA YAZIMINDAN BAGIMSIZ ───────────────────────

test('CD9 `putAppScan` ayri bir try icinde — `putApps` patlasa da calisir', () => {
  // Ikisi tek `try` icindeyken: uzun bir uygulama adi (NVARCHAR(150) asimi) `putApps`i
  // dusuruyor, `putAppScan` HIC calismiyor, `scannedEmpty` false kaliyor ve o namespace
  // SONSUZ tarama dongusune giriyordu. Tarama KAYDI, listeden daha kritiktir.
  const src = read('ocp.cjs');
  const i = src.indexOf('async function finalizeAppDiscovery');
  assert.ok(i > 0, 'finalizeAppDiscovery bulunamadi');
  const body = src.slice(i, src.indexOf('\n}', i));
  const putAppsAt = body.indexOf('cache.putApps(');
  const putScanAt = body.indexOf('cache.putAppScan(');
  assert.ok(putAppsAt > 0 && putScanAt > 0, 'iki yazim da bulunamadi');
  // Aralarinda bir `catch` OLMALI: ayni try'da olsalardi arada catch bulunmazdi.
  const between = body.slice(putAppsAt, putScanAt);
  assert.match(
    between,
    /catch/,
    'putApps ve putAppScan hala AYNI try icinde — putApps patlarsa tarama kaydi yazilmaz (dongu)',
  );
});
