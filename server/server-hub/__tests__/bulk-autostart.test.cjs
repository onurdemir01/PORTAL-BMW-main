// server/server-hub/__tests__/bulk-autostart.test.cjs - ESKI toplu duzeltme YOK, KONTROLLU toplu VAR.
//
// 2026-10-01 kullanici: "jboss jvm auto start da toplu ac toplu kapat sakin getirme o cok riskli ...
// Toplu islem sakin olmasin cok tehlikeli." 2026-09-28'deki iki toplu dugme (eski BA1..BA6: /bulk-plan,
// /bulk-fix) yanlis bir taramanin sonucunu tek tikla yuzlerce sunucuya yayiyordu: /fix korumasini N kez
// cagirarak deliyordu.
//
// 2026-11-14 kullanici KARARI DEGISTI: "auto-start'lari toplu duzeltebilmek icin bir sayfa ve tek bir buton".
// Secilen guvenlik modeli (toplu-autostart.cjs): yalniz TAZE taramadaki uyumsuz JVM'ler, /jvm-autostart ile
// AYNI kapilar, ONCE salt okunur PLAN (canli deger CLI ile), onay, ust sinir (limit:toplu_autostart), host
// basina TEK is (target_host yine tek sunucu), hostlar SIRAYLA, yeniden baslatmada sessiz yeniden kosma YOK.
//
// Bu dosya: (BA1-BA3) ESKI tasarimin izleri geri gelmedi; (BA4) tek tek yol duruyor; (BA5) iki karar da kodda
// yaziyor; (BA6-BA9) kontrollu toplunun guvenlik modeli kaynakta duruyor (davranis: toplu-autostart.test.cjs);
// (SB*) satir bazinda tek JVM ucu.
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
const TOPLU = fs.readFileSync(path.join(__dirname, '..', 'toplu-autostart.cjs'), 'utf8');
const KAPI = fs.readFileSync(path.join(__dirname, '..', 'autostart-dogrulama.cjs'), 'utf8');
/** Bir fonksiyonun govdesi: `function ad(` ile bir sonraki ust duzey kapanis satiri arasi. */
function fonksiyon(src, ad) {
  const i = src.indexOf(`function ${ad}(`);
  assert.ok(i >= 0, `${ad} yok`);
  const son = src.indexOf('\n}\n', i);
  return src.slice(i, son > i ? son : undefined);
}

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

test('BA5: iki karar da kodda anlatiliyor (kaldirma gerekcesi + kontrollu model)', () => {
  assert.match(SRC, /TOPLU DUZELTME KALDIRILDI/, 'kaldirma gerekcesi kodda yazmiyor');
  assert.match(SRC, /KONTROLLU TOPLU AUTO-START/, '2026-11-14 kontrollu toplu karari kodda yazmiyor');
  assert.match(TOPLU, /YENIDEN BASLATMADA SESSIZ YENIDEN KOSMA YOK/, 'toplu modul basligi yeniden baslatma kuralini anlatmiyor');
});

test('BA6: kontrollu toplu - ust sinir ayardan, ONCE plan (plan_only: true), uygulama yalniz onaydan sonra', () => {
  assert.match(TOPLU, /_d\.ayarlar\.limit\('toplu_autostart'\)/, 'ust sinir Admin ayarindan okunmuyor');
  // 2026-11-15 host XML: extra_vars tek yerde (isDegiskenleri; CLI ve host XML dali ayni plan_only'yi tasir)
  assert.match(fonksiyon(TOPLU, 'planIlerlet'), /isDegiskenleri\(host, parca, true\)/, 'plan isi plan_only: true acmiyor');
  assert.match(fonksiyon(TOPLU, 'uygulaIlerlet'), /isDegiskenleri\(host, tazeListe, false\)/, 'uygulama isi plan_only: false degil');
  assert.equal((fonksiyon(TOPLU, 'isDegiskenleri').match(/plan_only: planOnly,/g) || []).length, 2, 'extra_vars dallarindan biri plan_only tasimiyor');
  // uygulama ogesi yalniz CALISIYOR (onaylanmis) isin BEKLIYOR ogesinden sahiplenilir
  assert.match(fonksiyon(TOPLU, 'uygulaIlerlet'), /durum = 'BEKLIYOR'[\s\S]*durum = 'CALISIYOR' AND kira_id/, 'uygulama onaysiz ise acilabiliyor');
  assert.match(fonksiyon(TOPLU, 'onayla'), /durum !== 'PLAN_HAZIR'/, 'onay plan hazir olmadan veriliyor');
  assert.match(fonksiyon(TOPLU, 'onayla'), /if \(planEskiMi\(is\)\) \{\s*await planEskit\(req, id\);\s*throw/, 'eski plan onaylanabiliyor');
  assert.match(TOPLU, /const planEskiMi = \(is\) => !is\.plan_bitis_at \|\| Date\.now\(\) - new Date\(is\.plan_bitis_at\)\.getTime\(\) > PLAN_YAS_MS;/);
});

test('BA7: kontrollu toplu - parca basina TEK is, virgullu hedef YOK, isler SIRAYLA', () => {
  assert.ok(!/join\(','\)/.test(TOPLU), 'toplu modul virgullu hedef listesi uretiyor');
  for (const ad of ['planIlerlet', 'uygulaIlerlet']) assert.match(fonksiyon(TOPLU, ad), /isDegiskenleri\(host, /, `${ad} tek hedef gondermiyor`);
  assert.equal((fonksiyon(TOPLU, 'isDegiskenleri').match(/target_host: host,/g) || []).length, 2, 'extra_vars dallarindan biri tek hedef gondermiyor');
  // 2026-11-15 parcalama: ayni hostun parcalari da birbirini bekler (host kosulu yok; parca disi tum ogeler)
  assert.match(
    fonksiyon(TOPLU, 'uygulaIlerlet'),
    /NOT EXISTS \(SELECT 1 FROM server_hub_toplu_ogeler x[\s\S]*x\.is_id = \$1 AND x\.id NOT IN \(\$\{yerTutucu\(ids, 3\)\}\) AND x\.durum IN \('BASLATILIYOR', 'CALISIYOR'\)/,
    'baska parca calisirken yeni parca baslatilabiliyor (sira yok)',
  );
  assert.match(fonksiyon(TOPLU, 'uygulaIlerlet'), /\.slice\(0, n\)/, 'uygulama parcasi isBasinaJvm ile sinirlanmiyor');
  assert.match(fonksiyon(TOPLU, 'planIlerlet'), /parcala\(tazeOg\.filter\(\(o\) => o\.durum === 'ADAY'\), n\)/, 'plan parcalanmiyor');
  // belirsiz launch isareti olmazsa toplu is "durdur" yolu uretimde olu kalir
  assert.match(fonksiyon(SRC, 'launch'), /!\(st >= 400 && st < 500\)\) e\.launchBelirsiz = true;/, 'Server Hub launch belirsiz hatayi isaretlemiyor');
  assert.match(fonksiyon(TOPLU, 'uygulaIlerlet'), /e\.launchBelirsiz === true[\s\S]*topluDurdur\(is,/, 'belirsiz launch toplu isi durdurmuyor');
});

test('BA8: kontrollu toplu - kapilar /jvm-autostart ile AYNI fonksiyon', () => {
  const t = fonksiyon(TOPLU, 'adaylariTuret');
  assert.match(t, /sunucuYazmaKapisi\(a, h, h\.host\)/, 'toplu aday sunucu kapisindan gecmiyor');
  assert.match(t, /jvmAutoStartKapisi\(j,/, 'toplu aday JVM kapisindan gecmiyor');
  const i = SRC.indexOf("router.post('/jvm-autostart'");
  const blok = rotaBlogu(i);
  assert.match(blok, /sunucuYazmaKapisi\(a, h, host\)/, '/jvm-autostart ortak sunucu kapisini kullanmiyor');
  assert.match(blok, /jvmAutoStartKapisi\(j, \{ host, jvm, gen, enable \}\)/, '/jvm-autostart ortak JVM kapisini kullanmiyor');
  // Istemciden gelen secim TAZE degerlendirmeden yeniden turetilir: 2026-11-14'ten beri istekte degil, yurutucunun
  // secimDogrula adiminda (istek yalniz secimi yazar; uretimde 33 JVM'lik istek taze okumada 500 donmustu).
  assert.match(fonksiyon(TOPLU, 'secimDogrula'), /_d\.getAssessment\(true\)[\s\S]*adaylariTuret\(a\)[\s\S]*c\.action !== o\.eylem/, 'secim taze taramadan turetilmiyor');
  assert.match(fonksiyon(TOPLU, 'planIlerlet'), /secimDogrula\(is, og\)/, 'plan secimi dogrulamadan ilerliyor');
  assert.doesNotMatch(fonksiyon(TOPLU, 'olustur'), /getAssessment/, 'istek yine tum filoyu taze okuyor');
});

test('BA9: kontrollu toplu - kirasi dusen is DEVAM ETTIRILMEZ (YARIM_KALDI)', () => {
  const t = fonksiyon(TOPLU, 'tick');
  assert.match(t, /is\.kira_id !== SUREC_ID[\s\S]*yarimBirak\(is\)[\s\S]*continue;/, 'baska surecin isi ilerletiliyor');
  const y = fonksiyon(TOPLU, 'yarimBirak');
  assert.ok(!/_d\.launch|launch\(/.test(y), 'yarim birakma is baslatiyor');
  assert.match(y, /awx_job_id IS NULL/, 'is numarasiz BASLATILIYOR oge ayrica isaretlenmiyor');
});

// ── SATIR BAZINDA AUTO-START (SB1..SB5, 2026-10-01) ─────────────────────────────────
//
// Kullanici: "Ben oraya girdigim zaman satir satir hangi jvm'lerde auto start kapaliysa
// onun saginda bir buton olsun ben tikladigimda acilsin veya ben tikladigimda kapansin."
//
// Toplu islemin yerine gecen sey BU: tek (host, jvm), tek tik, tek is.

/** `router.post('/jvm-autostart'` ile baslayan rota govdesi: bir sonraki `router.` cagrisina
 * kadar (sabit 3500 karakterlik pencere, rotaya yeni kapi eklenince sonunu kaciriyordu). */
function rotaBlogu(i) {
  assert.ok(i >= 0, 'jvm-autostart rotasi yok');
  const son = SRC.indexOf('\n  router.', i + 1);
  return SRC.slice(i, son > i ? son : undefined);
}

test('SB1 JVM hedefli uc var ve TEK (host, jvm) aliyor', () => {
  assert.match(SRC, /router\.post\('\/jvm-autostart'/, 'satir bazli uc yok');
  const i = SRC.indexOf("router.post('/jvm-autostart'");
  const blok = rotaBlogu(i);
  // Virgullu hedef listesi YOK: duzeltme playbook'u zaten reddediyor, uc de uretmemeli.
  assert.ok(!/join\(','\)/.test(blok), 'uc virgullu hedef listesi uretiyor - toplu islem geri gelmis');
  assert.match(blok, /target_host: host/, 'tek hedef gonderilmiyor');
});

test('SB2 HEDEF TARAMADAN DOGRULANIR (istemciden gelen JVM adi dogrudan gecmez)', () => {
  const i = SRC.indexOf("router.post('/jvm-autostart'");
  const blok = rotaBlogu(i);
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
  const blok = rotaBlogu(i);
  assert.match(blok, /req\.body\?\.confirmed !== true/, 'onay kapisi yok');
});

test('SB4 ZATEN ISTENEN DURUMDA is ACILMAZ', () => {
  // Gereksiz is acmak, degisiklik yonetimi acisindan gurultu; ustelik kullanici
  // "olmadi galiba" deyip tekrar tiklar. Kapi 2026-11-14'ten beri Toplu Auto-Start ile ORTAK fonksiyonda.
  const i = SRC.indexOf("router.post('/jvm-autostart'");
  const blok = rotaBlogu(i);
  assert.match(blok, /jvmAutoStartKapisi\(j, /, 'uc JVM kapisini cagirmiyor');
  const k = fonksiyon(KAPI, 'jvmAutoStartKapisi');
  assert.match(k, /if \(j\.autoStart === hedef\)/, 'mevcut durum kontrolu yok');
  assert.match(k, /zaten auto-start/, 'kullaniciya sebep soylenmiyor');
});

test('SB5 ekranda SATIR BAZINDA dugme var ve onay istiyor', () => {
  assert.match(UI, /jvmAutoStart\(j\)/, 'satir dugmesi yok');
  // Onay 2026-11-08'den beri portal ici pencereden (useOnay; eskiden window.confirm).
  assert.match(UI, /await onayla\(\{/, 'tek tikla onaysiz degisiklik yapiliyor');
  assert.doesNotMatch(UI, /window\.confirm\(/, 'tarayici onayi geri gelmis');
  assert.match(UI, /Yalnız bu JVM etkilenir/, 'onay metni kapsami soylemiyor');
  // Islem bitince tarama TAZELENIR; yoksa eski deger kalir ve kullanici tekrar tiklar.
  assert.match(UI, /serverHubApi\s*\n?\s*\.host\(host, true\)/, 'islem sonrasi tarama tazelenmiyor');
});
