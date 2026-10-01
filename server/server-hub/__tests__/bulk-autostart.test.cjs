// server/server-hub/__tests__/bulk-autostart.test.cjs — TOPLU DUZELTME YOK (2026-10-01).
//
// Kullanici: "jboss jvm auto start da toplu ac toplu kapat sakin getirme o cok riskli.
// Ben oraya girdigim zaman satir satir hangi jvm'lerde auto start kapaliysa onun saginda
// bir buton olsun ben tikladigimda acilsin veya ben tikladigimda kapansin. Toplu islem
// sakin olmasin cok tehlikeli."
//
// 2026-09-28'de iki toplu dugme (BA1..BA6) eklenmisti; kullanici karari tersine cevirdi.
// Bu dosya artik ozelligin GERI GELMEDIGINI kilitler.
//
// NEDEN TEHLIKELI (gerekcesi kayitta kalsin): toplu islem tek tiklamayla yuzlerce
// sunucuda auto-start degistirir. Tarama yanlissa - ki Server Hub'in kendi gecmisinde
// "ss pid'siz", "yetki yuzunden olculemedi" gibi durumlar var - YANLIS SONUC DA yuzlerce
// sunucuya yayilir. Satir bazinda onay, hatanin yaricapini bir sunucuya indirir.
//
// TEK TEK DUZELTME ZATEN VAR: `POST /fix` tek host + tek JVM alir ve duzeltme playbook'u
// virgullu hedef listesini BILEREK reddeder. Toplu uc o korumayi N kez cagirarak deliyordu.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'index.cjs'), 'utf8');
const API = fs.readFileSync(
  path.join(__dirname, '..', '..', '..', 'src', 'api', 'serverHubApi.ts'),
  'utf8',
);
const UI = fs.readFileSync(
  path.join(__dirname, '..', '..', '..', 'src', 'components', 'server_hub', 'ServerHubPage.tsx'),
  'utf8',
);

test('BA1: toplu duzeltme UCLARI YOK', () => {
  for (const yol of ['/bulk-plan', '/bulk-fix']) {
    assert.ok(!SRC.includes(yol), `toplu uc geri gelmis: ${yol}`);
  }
  for (const ad of ['BULK_CODES', 'BULK_MAX', 'bulkPlan(']) {
    assert.ok(!SRC.includes(ad), `toplu mantik geri gelmis: ${ad}`);
  }
});

test('BA2: API toplu cagri TASIMIYOR', () => {
  for (const ad of ['bulkPlan', 'bulkFix', 'ShBulkPlan', 'ShBulkResult', 'ShBulkItem']) {
    assert.ok(!API.includes(ad), `API'de toplu iz: ${ad}`);
  }
});

test('BA3: ekranda toplu dugme / modal YOK', () => {
  assert.ok(!/Bulk/.test(UI), 'ekranda Bulk* bileseni ya da tipi kalmis');
  assert.ok(!UI.includes('Toplu: auto-start'), 'toplu dugme metni kalmis');
});

test('BA4: TEK TEK duzeltme ucu DURUYOR (ozellik kaldirilmadi, daraltildi)', () => {
  // Kullanici toplu islemi reddetti, duzeltmenin KENDISINI degil. Tek tek yol kalkarsa
  // ekran bir sey yapamaz hale gelir - bu bekci onu da korur.
  assert.match(SRC, /router\.post\('\/fix'/, 'tek tek duzeltme ucu kaybolmus');
  assert.match(SRC, /FIX_ACTIONS/, 'izinli duzeltme eylemleri listesi kaybolmus');
  for (const a of ['jboss_autostart_on', 'jboss_autostart_off']) {
    assert.ok(SRC.includes(a), `auto-start eylemi kaybolmus: ${a}`);
  }
});

test('BA5: tek hedef korumasi anlatiliyor (geri getirmek isteyen sebebi gorsun)', () => {
  assert.match(
    SRC,
    /toplu islem sakin olmasin|TOPLU DUZELTME KALDIRILDI/i,
    'kaldirma gerekcesi kodda yazmiyor - bir sonraki gelistirici ayni seyi yeniden ekler',
  );
});

// ── SATIR BAZINDA AUTO-START (SB1..SB5, 2026-10-01) ─────────────────────────────────
//
// Kullanici: "Ben oraya girdigim zaman satir satir hangi jvm'lerde auto start kapaliysa
// onun saginda bir buton olsun ben tikladigimda acilsin veya ben tikladigimda kapansin."
//
// Toplu islemin yerine gecen sey BU: tek (host, jvm), tek tik, tek is.

test('SB1 JVM hedefli uc var ve TEK (host, jvm) aliyor', () => {
  assert.match(SRC, /router\.post\('\/jvm-autostart'/, 'satir bazli uc yok');
  const i = SRC.indexOf("router.post('/jvm-autostart'");
  const blok = SRC.slice(i, i + 3500);
  // Virgullu hedef listesi YOK: duzeltme playbook'u zaten reddediyor, uc de uretmemeli.
  assert.ok(!/join\(','\)/.test(blok), 'uc virgullu hedef listesi uretiyor - toplu islem geri gelmis');
  assert.match(blok, /target_host: host/, 'tek hedef gonderilmiyor');
});

test('SB2 HEDEF TARAMADAN DOGRULANIR (istemciden gelen JVM adi dogrudan gecmez)', () => {
  const i = SRC.indexOf("router.post('/jvm-autostart'");
  const blok = SRC.slice(i, i + 3500);
  assert.match(blok, /HOST_RE\.test\(host\)/, 'sunucu adi dogrulanmiyor');
  assert.match(blok, /JVM_RE\.test\(jvm\)/, 'JVM adi dogrulanmiyor');
  assert.match(
    blok,
    /\(h\.jvms \|\| \[\]\)\.find\(\(x\) => x\.name === jvm && Number\(x\.gen\) === gen\)/,
    'JVM son taramada GERCEKTEN var mi diye bakilmiyor - extra_vars ile keyfi hedef secilebilir',
  );
});

test('SB3 ACIK ONAY sart (kazara gelen istek sunucuyu degistirmemeli)', () => {
  const i = SRC.indexOf("router.post('/jvm-autostart'");
  const blok = SRC.slice(i, i + 3500);
  assert.match(blok, /req\.body\?\.confirmed !== true/, 'onay kapisi yok');
});

test('SB4 ZATEN ISTENEN DURUMDA is ACILMAZ', () => {
  // Gereksiz is acmak, degisiklik yonetimi acisindan gurultu; ustelik kullanici
  // "olmadi galiba" deyip tekrar tiklar.
  const i = SRC.indexOf("router.post('/jvm-autostart'");
  const blok = SRC.slice(i, i + 3500);
  assert.match(blok, /if \(j\.autoStart === hedef\)/, 'mevcut durum kontrolu yok');
  assert.match(blok, /zaten auto-start/, 'kullaniciya sebep soylenmiyor');
});

test('SB5 ekranda SATIR BAZINDA dugme var ve onay istiyor', () => {
  assert.match(UI, /jvmAutoStart\(j\)/, 'satir dugmesi yok');
  assert.match(UI, /window\.confirm\(/, 'tek tikla onaysiz degisiklik yapiliyor');
  assert.match(UI, /Yalnız bu JVM etkilenir/, 'onay metni kapsami soylemiyor');
  // Islem bitince tarama TAZELENIR; yoksa eski deger kalir ve kullanici tekrar tiklar.
  assert.match(UI, /serverHubApi\s*\n?\s*\.host\(host, true\)/, 'islem sonrasi tarama tazelenmiyor');
});
