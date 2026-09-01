#!/usr/bin/env node
// scripts/run-tests.cjs — test kosucusu (npm test).
//
// NEDEN AYRI BIR KOSUCU VAR: suit `node --test` ile calisiyor, ama TEK bir dosya
// (server/inventory/__tests__/visible-tables.test.cjs) `mock.module` kullaniyor ve o
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

const ROOT = path.join(__dirname, '..');

// npm script'indeki desenlerle AYNI kapsam. Yeni bir modul eklendiginde burasi da
// guncellenmeli — `TEST_DIRS` bekcisi bunu kilitler.
const TEST_DIRS = [
  'server/logx/v2/__tests__', 'server/auth/__tests__', 'server/db/__tests__',
  'server/ai-analyst/__tests__', 'server/ai/__tests__', 'server/inventory/__tests__',
  'server/ansible/__tests__', 'server/admin/__tests__', 'server/opsx/__tests__',
  'server/filex/__tests__', 'server/smart/__tests__', 'server/oco/__tests__',
  'server/telnet/__tests__', 'server/scalex/__tests__', 'server/audit/__tests__',
  'server/selfservice/__tests__', 'server/__tests__', 'src/__tests__',
];

function collect() {
  const files = [];
  for (const d of TEST_DIRS) {
    const abs = path.join(ROOT, d);
    if (!fs.existsSync(abs)) continue;
    for (const f of fs.readdirSync(abs)) {
      if (f.endsWith('.test.cjs')) files.push(path.join(d, f));
    }
  }
  return files.sort();
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

const needsMocks = all.filter((f) => /mock\.module/.test(fs.readFileSync(path.join(ROOT, f), 'utf8')));
const canMock = supportsModuleMocks();

let files = all;
const args = ['--test'];
if (canMock) {
  args.unshift('--experimental-test-module-mocks');
} else if (needsMocks.length) {
  files = all.filter((f) => !needsMocks.includes(f));
  console.warn(
    `[test] Node ${process.versions.node} \`--experimental-test-module-mocks\` desteklemiyor `
    + `(22.3+ gerekli). ATLANAN ${needsMocks.length} dosya:\n`
    + needsMocks.map((f) => `  - ${f}`).join('\n')
    + '\n[test] Kalan suit KOSUYOR; tam kapsam icin Node 22.3+ kullanin.'
  );
}

console.log(`[test] Node ${process.versions.node} · ${files.length}/${all.length} dosya`);
const r = spawnSync(process.execPath, [...args, ...files], { cwd: ROOT, stdio: 'inherit' });
process.exit(r.status == null ? 1 : r.status);
