// server/__tests__/node-version-readiness.test.cjs — Node surumu hazirligi.
//
// Prod Node 20.20.2 kosuyor ve `npm ci` dokuz pakette EBADENGINE uyariyor. Uyarilarin
// coğu gurultudur (vitest, jsdom, lint-staged... yalnizca gelistirici makinesinde
// kosar) — AMA biri degil:
//
//   tedious (>=22) — MSSQL SURUCUSU. `mssql` uzerinden gelir ve portal HER DB
//   cagrisinda onu kullanir. Yani uretimde desteklenmeyen bir Node surumunde
//   calisan bir veritabani surucusu var.
//
// Bu bekci iki seyi kilitler: (1) on kontrol bu ayrimi OLCUYOR (liste kodda gomulu
// DEGIL), (2) `engines` Node guvenlik tabaninda (2026-10-23: prod 22.23.4'e gecti; 20 destek
// disi ve yamasiz, kullanici "her seyi en guncele getir" dedi).
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..', '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

test('NV1 `engines` Node guvenlik tabaninda (acilis uyarisiyla ayni taban)', () => {
  // 2026-10-23: prod Node 22.23.4'e gecti; Node 20 Nisan 2026'da destek disi kaldi ve Ekim
  // 2026 guvenlik yamasini almadi. Calisma zamani paketleri (tedious, ldapts 9) zaten Node 22
  // istiyor. `engines` alt siniri, acilista `[Guvenlik]` uyarisi veren tabanla
  // (server/node-guvenlik.cjs YAMALI[22]) AYNI olmali: biri yukselir de digeri kalirsa ikisi
  // farkli seyler soyler.
  const pkg = JSON.parse(read('package.json'));
  const range = pkg.engines && pkg.engines.node;
  assert.ok(range, 'engines.node yok');
  const m = /^>=(\d+)\.(\d+)\.(\d+)$/.exec(range);
  assert.ok(m, `engines bicimi >=X.Y.Z degil: ${range}`);
  const { YAMALI } = require('../node-guvenlik.cjs');
  assert.deepEqual(m.slice(1).map(Number), YAMALI[22], `engines (${range}) guvenlik tabanindan (${YAMALI[22].join('.')}) farkli`);
});

test('NV2 on kontrol uyumsuzlugu OLCUYOR (liste gomulu degil)', () => {
  const pf = read('scripts/preflight.cjs');
  assert.match(pf, /package-lock\.json/, 'lock dosyasindan okumuyor — liste elle yazilmis olur');
  assert.match(pf, /engines/, 'engines araliklari karsilastirilmiyor');
  assert.match(pf, /semver/, 'aralik karsilastirmasi semver ile yapilmiyor');
  // Uyumsuz paket ADLARI koda gomulmemeli (bagimliliklar degisince yalan soyler).
  const code = pf
    .split('\n')
    .filter((l) => !/^\s*(\/\/|\*)/.test(l))
    .join('\n');
  assert.doesNotMatch(code, /'vitest'/, 'uyumsuz paket adi koda gomulmus');
  assert.doesNotMatch(code, /'jsdom'/, 'uyumsuz paket adi koda gomulmus');
});

test('NV3 CALISMA ZAMANI / gelistirme ayrimi yapiliyor', () => {
  const pf = read('scripts/preflight.cjs');
  assert.match(pf, /CALISMA ZAMANI/, 'iki kume ayirt edilmiyor — tedious gurultuye karisir');
  // `tedious` gecisli geldigi icin ADIYLA taninmali; aksi halde "gelistirme"
  // kovasina duser ve tek gercek uretim riski gozden kacar.
  assert.match(pf, /RUNTIME_TRANSITIVE/, 'gecisli calisma zamani paketleri taninmiyor');
  assert.match(pf, /'tedious'/, 'tedious calisma zamani olarak isaretlenmemis');
});

test('NV4 prod surumu SIMULE edilebiliyor (ajanin surumu prod`u gizlemesin)', () => {
  const pf = read('scripts/preflight.cjs');
  assert.match(pf, /PREFLIGHT_NODE_VERSION/, 'surum override`i yok');
  // CI de bunu GERCEKTEN cagirmali; yoksa override olu kod olur.
  assert.match(read('Jenkinsfile'), /PREFLIGHT_NODE_VERSION=/, 'CI prod surumunu sormuyor');
});

test('NV5 simulasyon prod surumunde tedious`u CALISMA ZAMANI olarak raporluyor', () => {
  // GERCEKTEN KOSULUR — kaynak taramak, ciktinin dogru oldugunu KANITLAMAZ.
  const out = execFileSync(process.execPath, ['scripts/preflight.cjs'], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, PREFLIGHT_NODE_VERSION: '20.20.2' },
  });
  const line = out.split('\n').find((l) => /CALISMA ZAMANI/.test(l)) || '';
  assert.match(line, /tedious/, `tedious calisma zamani kumesinde degil:\n${out.slice(0, 600)}`);
  // Ve gelistirme paketleri o kumeye SIZMAMALI.
  assert.doesNotMatch(
    line.split('|')[0],
    /vitest|jsdom|lint-staged/,
    'gelistirme paketleri calisma zamani kumesine karismis — gercek risk gurultuye gomulur',
  );
});

test('NV6 Jenkins matrisi UYDURULMADI (var olmayan arac adi boru hattini duserir)', () => {
  const jf = read('Jenkinsfile');
  // `node22` yalnizca YORUMDA gecebilir; `tools` blogunda GECMEMELI.
  const code = jf
    .split('\n')
    .filter((l) => !/^\s*\/\//.test(l))
    .join('\n');
  assert.doesNotMatch(code, /nodejs\s+'node22'/, 'dogrulanmamis bir Global Tool adina baglanilmis');
  assert.match(read('docs/DEVREYE-ALMA.md'), /node22/, 'gecis adimi belgelenmemis');
});
