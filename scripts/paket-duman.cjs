#!/usr/bin/env node
// scripts/paket-duman.cjs — calisma zamani paketinde `npm test` (2026-11-12).
//
// Paket test dosyasi tasimaz (testler repoda, gelistirme araclariyla kosar). Bu duman testi kurulan
// paketin calisabilir oldugunu sinar: her calisma zamani bagimliligi cozulebiliyor, sunucu giris
// dosyasi sozdizimi gecerli, dist dogrulamasi geciyor. Veritabanina ya da aga baglanmaz.
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const KOK = process.cwd();
const pkg = JSON.parse(fs.readFileSync(path.join(KOK, 'package.json'), 'utf8'));
const hatalar = [];

for (const ad of Object.keys(pkg.dependencies || {})) {
  try {
    require.resolve(`${ad}/package.json`, { paths: [KOK] });
  } catch {
    // package.json'u "exports" ile disari vermeyen paketler: kok giris noktasi denenir.
    try {
      require.resolve(ad, { paths: [KOK] });
    } catch {
      if (!fs.existsSync(path.join(KOK, 'node_modules', ad, 'package.json')))
        hatalar.push(`cozulemedi: ${ad}`);
    }
  }
}
if (pkg.devDependencies)
  hatalar.push('package.json devDependencies tasiyor (calisma zamani paketi degil)');

for (const giris of ['server/index.cjs', 'server/service.cjs']) {
  const tam = path.join(KOK, giris);
  if (!fs.existsSync(tam)) {
    hatalar.push(`${giris} yok`);
    continue;
  }
  try {
    execFileSync(process.execPath, ['--check', tam], { stdio: 'pipe' });
  } catch (e) {
    hatalar.push(`${giris} sozdizimi: ${String(e.stderr || e.message).split('\n')[0]}`);
  }
}

try {
  execFileSync(process.execPath, [path.join(KOK, 'scripts', 'dist-dogrula.cjs')], {
    stdio: 'inherit',
  });
} catch {
  hatalar.push('dist dogrulamasi gecmedi');
}

if (hatalar.length) {
  console.error(`[duman] BASARISIZ:\n- ${hatalar.join('\n- ')}`);
  process.exit(1);
}
console.log(
  `[duman] tamam: ${Object.keys(pkg.dependencies || {}).length} calisma zamani bagimliligi, sunucu girisi, dist`,
);
