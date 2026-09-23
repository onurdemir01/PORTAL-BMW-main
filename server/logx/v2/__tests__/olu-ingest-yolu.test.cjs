// server/logx/v2/__tests__/olu-ingest-yolu.test.cjs
//
// OLU OZELLIK ICIN ACIK SALDIRI YUZEYI TASIMA.
//
// A4 "fetch-back" (ingest) su varsayimla yazilmisti: kaynak host paylasilan NFS'e
// yazamazsa arsivi portala HTTP ile PUSH eder. Uygulamada:
//
//   * HICBIR playbook `ingest_url`i okumuyor (`grep` playbook agacinda 0 sonuc),
//   * uretilen URL portalin KENDI adresini isaret ediyor ve kaynak host bastion
//     arkasinda oldugu icin oraya zaten ULASAMIYOR.
//
// `ocp.cjs` bunu birakmis ve yorumuna "legacy de dahil" yazmisti — AMA
// `legacy.cjs` HALA her transfer'de token + DB satiri uretiyordu. Yani yorum
// gercegi anlatmiyordu ve portalin KIMLIK DOGRULAMASIZ tek yazma ucu,
// calismayan bir ozellik icin acik duruyordu.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..', '..', '..');
const oku = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const kodOnly = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

test('OI1 HICBIR kod yolu artik `ingest_url` URETMIYOR', () => {
  const uretenler = [];
  for (const f of fs.readdirSync(path.join(ROOT, 'server/logx/v2')).filter((x) => x.endsWith('.cjs'))) {
    if (f === 'ingest.cjs') continue; // modulun kendisi tanimi tasiyabilir
    const kod = kodOnly(oku(path.join('server/logx/v2', f)));
    if (/ingest_url\s*:/.test(kod) || /issueIngestToken\s*\(/.test(kod)) uretenler.push(f);
  }
  assert.deepEqual(
    uretenler,
    [],
    `hala token/URL ureten dosya(lar): ${uretenler.join(', ')} — her transfer'de bosuna DB satiri`,
  );
});

test('OI2 auth`suz yukleme ucu VARSAYILAN OLARAK kapali', () => {
  const kod = kodOnly(oku('server/logx/v2/index.cjs'));
  const i = kod.indexOf("router.post('/ingest/:token'");
  assert.ok(i > 0, 'ingest route tanimi bulunamadi');
  // Mount BIR KOSULUN icinde olmali ve kosul bir ortam bayragi olmali.
  const once = kod.slice(Math.max(0, i - 400), i);
  assert.match(
    once,
    /if\s*\(\s*process\.env\.LOGX_V2_INGEST_ENABLED\s*===\s*'1'\s*\)/,
    'uc kosulsuz mount ediliyor — kimlik dogrulamasiz yazma yolu acik',
  );
  assert.doesNotMatch(once, /if\s*\(\s*(true|1)\s*\)/, 'kosul sabit dogru');
});

test('OI3 uc `requireAuth`tan ONCE kaldigi icin KOSULU da ondan once olmali', () => {
  // Bayrak `router.use(requireAuth)` SONRASINA kayarsa, acildiginda kaynak host
  // (oturumu yok) 401 alir ve ozellik acilmis gibi gorunup CALISMAZ.
  const kod = kodOnly(oku('server/logx/v2/index.cjs'));
  const bayrak = kod.indexOf('LOGX_V2_INGEST_ENABLED');
  const auth = kod.indexOf('router.use(requireAuth)');
  assert.ok(bayrak > 0 && auth > 0, 'isaretler bulunamadi');
  assert.ok(bayrak < auth, 'ingest kosulu requireAuth SONRASINA kaymis');
});

test('OI4 acikken SESSIZ olmasin — uyari loglanir', () => {
  const ham = oku('server/logx/v2/index.cjs');
  const i = ham.indexOf('LOGX_V2_INGEST_ENABLED');
  const d = ham.slice(i, i + 600);
  assert.match(d, /console\.warn/, 'kimlik dogrulamasiz uc sessizce aciliyor');
});

test('OI5 `ocp.cjs` yorumu artik GERCEGI anlatiyor', () => {
  // Yorum "legacy de dahil" diyordu ama legacy uretmeye devam ediyordu; bu bekci
  // iddiayi koda baglar.
  const ocp = oku('server/logx/v2/ocp.cjs');
  assert.match(ocp, /legacy de dahil/, 'ocp.cjs notu degismis — iddia kaybolmus');
  const legacy = kodOnly(oku('server/logx/v2/legacy.cjs'));
  assert.doesNotMatch(legacy, /issueIngestToken/, 'yorum hala yalan soyluyor');
});

test('OI6 teslim yolu BOZULMADI: staging + fallback duruyor', () => {
  // Ingest kaldirildi diye asil teslim yolu zarar gormemeli.
  const legacy = kodOnly(oku('server/logx/v2/legacy.cjs'));
  assert.match(legacy, /staging_dir:/, 'staging yolu kaybolmus');
  assert.match(legacy, /fallback_dir:/, 'fallback yolu kaybolmus');
  assert.match(legacy, /archive_name:/, 'arsiv adi kaybolmus');
});
