#!/usr/bin/env node
// scripts/run-tests.cjs — test kosucusu (npm test).
//
// NEDEN AYRI BIR KOSUCU VAR: suit `node --test` ile calisiyor, ama TEK bir dosya
// (server/inventory/__tests__/visible-tables.test.js) `mock.module` kullaniyor ve o
// da `--experimental-test-module-mocks` bayragini gerektiriyor. Bayrak Node 22.3+
// ile geldi; Jenkins ise "node20" araciyla calisiyor ve Node 20'de BILINMEYEN bir
// bayrak surecin tamamini basta oldurur — yani `npm test` CI'da hic kosamazdi.
// Sonuc: 900+ bekci yalnizca gelistirici makinesinde calisiyordu.
//
// Bu kosucu surumu OKUR ve karar verir:
//   * Node >= 22.3 → bayrakla, TUM dosyalar.
//   * daha eski    → bayraksiz, mock.module kullanan dosya(lar) HARIC.
//
// SESSIZ KIRPMA YOK: atlanan her dosya adiyla birlikte yazdirilir ve cikti "eksik
// kosuldu" oldugunu acikca soyler. Bir bekcinin kosmadigini bilmemek, o bekcinin
// hic olmamasindan daha tehlikelidir.
'use strict';

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { varsayilanSira } = require('../server/util/siralama.cjs');

const ROOT = path.join(__dirname, '..');

// npm script'indeki desenlerle AYNI kapsam. Yeni bir modul eklendiginde burasi da
// guncellenmeli — `TEST_DIRS` bekcisi bunu kilitler.
const TEST_DIRS = [
  'server/logx/v2/__tests__',
  'server/logx/__tests__',
  'server/auth/__tests__',
  'server/db/__tests__',
  'server/ai-analyst/__tests__',
  'server/ai/__tests__',
  'server/inventory/__tests__',
  'server/ansible/__tests__',
  'server/nginx-expose/__tests__',
  'server/nginx-migration/__tests__',
  'server/nginx-cis/__tests__',
  'server/nginx-console/__tests__',
  'server/nginx-loadtest/__tests__',
  'server/server-hub/__tests__',
  'server/retirement/__tests__',
  'server/admin/__tests__',
  'server/opsx/__tests__',
  'server/crypto-hub/__tests__',
  'server/bmw-hub/__tests__',
  'server/app-hub/__tests__',
  'server/filex/__tests__',
  'server/smart/__tests__',
  'server/oco/__tests__',
  'server/spa-report/__tests__',
  'server/telnet/__tests__',
  'server/scalex/__tests__',
  'server/audit/__tests__',
  'server/util/__tests__',
  'server/mcp/__tests__',
  'server/selfservice/__tests__',
  'server/__tests__',
  'src/__tests__',
  'server/nobetci/__tests__',
  // TS-ONLY (vitest) dizin: `collect()` yalnizca `.test.js` topladigi icin
  // buradan `node --test`e dosya GITMEZ; liste "hicbir test dizini sessizce
  // kosmadan kalmasin" bekcisi (test-glob-coverage) icin gerekli.
  'src/api/__tests__',
  'src/components/scalex/__tests__',
  'src/components/filex/__tests__',
  'src/components/logx_v2/__tests__',
  'src/components/__tests__',
  'src/contexts/__tests__',
  'src/components/oturum/__tests__',
  'src/components/oco/__tests__',
  'src/components/opsx/__tests__',
  'src/components/server_hub/__tests__',
  'src/components/app_hub/__tests__',
  'src/components/bmw_hub/__tests__',
  'src/components/admin/__tests__',
  'src/components/admin/tabs/sistem/__tests__',
  'src/components/admin/tabs/logxv2/__tests__',
  'src/components/common/__tests__',
  'src/components/self_service/__tests__',
  'src/components/denetim/__tests__',
  'src/components/nginx_console/__tests__',
  'src/hooks/__tests__',
  'src/utils/__tests__',
];

// Node testleri `*.test.js` (2026-11-18, kurumsal is #49): kurumsal Sonar testi YALNIZ `*.test.js` /
// `*.test.tsx` adindan tanir (scanOnSonar sonar.test.inclusions'i ezer). `.test.cjs` test olarak
// sayilmaz, uretim kodu sayilir: kapsam yariya iner, testteki sahte parola zafiyet olur. Klasorlerdeki
// package.json ({"type":"commonjs"}) `.test.js`'i CommonJS yapar. Eski adla yeni test SESSIZCE atlanmaz.
function collect() {
  const files = [];
  const eskiAd = [];
  for (const d of TEST_DIRS) {
    const abs = path.join(ROOT, d);
    if (!fs.existsSync(abs)) continue;
    for (const f of fs.readdirSync(abs)) {
      if (f.endsWith('.test.js')) files.push(path.join(d, f));
      else if (f.endsWith('.test.cjs')) eskiAd.push(path.join(d, f));
    }
  }
  if (eskiAd.length) {
    console.error(
      `[test] ESKI AD: Node testleri *.test.js olmali (kurumsal Sonar yalniz onu test sayar):\n` +
        eskiAd.map((f) => `  - ${f} -> ${f.replace(/\.test\.cjs$/, '.test.js')}`).join('\n'),
    );
    process.exit(1);
  }
  return files.sort(varsayilanSira);
}

function supportsModuleMocks() {
  const [maj, min] = process.versions.node.split('.').map(Number);
  return maj > 22 || (maj === 22 && min >= 3);
}

const all = collect();
if (!all.length) {
  console.error('[test] hicbir test dosyasi bulunamadi — TEST_DIRS bozulmus olabilir.');
  process.exit(1);
}

const needsMocks = all.filter((f) =>
  /mock\.module/.test(fs.readFileSync(path.join(ROOT, f), 'utf8')),
);
const canMock = supportsModuleMocks();

let files = all;
const args = ['--test'];
if (process.argv.includes('--coverage')) {
  fs.mkdirSync(path.join(ROOT, 'coverage'), { recursive: true });
  args.push(
    '--experimental-test-coverage',
    '--test-reporter=spec',
    '--test-reporter-destination=stdout',
    '--test-reporter=lcov',
    '--test-reporter-destination=coverage/node-lcov.info',
  );
}
if (canMock) {
  args.unshift('--experimental-test-module-mocks');
} else if (needsMocks.length) {
  files = all.filter((f) => !needsMocks.includes(f));
  console.warn(
    `[test] Node ${process.versions.node} \`--experimental-test-module-mocks\` desteklemiyor ` +
      `(22.3+ gerekli). ATLANAN ${needsMocks.length} dosya:\n` +
      needsMocks.map((f) => `  - ${f}`).join('\n') +
      '\n[test] Kalan suit KOSUYOR; tam kapsam icin Node 22.3+ kullanin.',
  );
}

console.log(`[test] Node ${process.versions.node} · ${files.length}/${all.length} dosya`);
// Testler kurum ayarinin KURGUSAL ornegiyle kosar (server/util/kurum-ayari.cjs; gercek sunucu adlari repoda
// yok, K17). Ayri bir dosya verilmisse (ornek: belirli bir ayarin testi) o kullanilir.
const env = {
  ...process.env,
  KURUM_AYAR_DOSYASI:
    process.env.KURUM_AYAR_DOSYASI || path.join(ROOT, 'deploy', 'kurum-ayari.ornek.json'),
};
const r = spawnSync(process.execPath, [...args, ...files], { cwd: ROOT, stdio: 'inherit', env });
process.exit(r.status == null ? 1 : r.status);
