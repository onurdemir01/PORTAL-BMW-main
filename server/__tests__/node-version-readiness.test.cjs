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
// DEGIL), (2) `engines` projenin GERCEKTEN calistigi en eski surumleri soyler; guvenlik tabani
// AYRIDIR (acilis uyarisi + telafi korumalari, server/node-guvenlik.cjs).
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..', '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

test('NV1 `engines` gercek uyumluluk araligi; guvenlik tabani ayri', () => {
  // 2026-10-23: portalin calistigi makine Node 22.22.2'de kaliyor (yukseltme simdilik yok).
  // `engines` = projenin derleme dahil GERCEKTEN calistigi en eski surumler (jsdom
  // `^22.22.2 || ^24.15.0 || >=26.0.0` istiyor). Guvenlik tabani (YAMALI) AYRI: acilista
  // `[Guvenlik]` uyarisi ve yamasiz surumde telafi korumalari. Ikisini tek alana koymak, calisan
  // bir makinede her `npm ci`yi EBADENGINE uyarisina gomuyordu.
  const semver = require('semver');
  const pkg = JSON.parse(read('package.json'));
  const range = pkg.engines && pkg.engines.node;
  assert.ok(range, 'engines.node yok');
  const tabanlar = new semver.Range(range).set.map((cs) =>
    semver.minVersion(new semver.Range(cs.map((c) => c.value).join(' '))).version,
  );
  // (1) TAAHHUT DURUST: her hattin en eski surumu kilitteki HER paketin engines'ini karsilar.
  const kilit = JSON.parse(read('package-lock.json')).packages;
  const karsilamayan = [];
  for (const [yol, bilgi] of Object.entries(kilit)) {
    const e = yol && bilgi.engines && bilgi.engines.node;
    if (!e) continue;
    for (const t of tabanlar) if (!semver.satisfies(t, e)) karsilamayan.push(`${t} < ${yol} (${e})`);
  }
  assert.deepEqual(karsilamayan, [], `engines desteklenmeyen surumu vaat ediyor:\n${karsilamayan.join('\n')}`);
  // (2) Portalin calistigi makine (22.22.2) kapsaniyor.
  assert.ok(semver.satisfies('22.22.2', range), `engines (${range}) 22.22.2'yi kapsamiyor`);
  // (3) Her hatta guvenlik tabani, uyumluluk tabaninin ALTINDA olamaz.
  const { YAMALI } = require('../node-guvenlik.cjs');
  for (const t of tabanlar) {
    const ana = semver.major(t);
    if (YAMALI[ana]) assert.ok(semver.gte(YAMALI[ana].join('.'), t), `${ana} hattinda guvenlik tabani ${YAMALI[ana].join('.')} < uyumluluk tabani ${t}`);
  }
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
