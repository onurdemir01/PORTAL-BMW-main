// scripts/arac-kontrol.cjs — gelistirme araci isteyen komutlardan once (predev, prebuild,
// pretest:ui, prelint). Kokteki manifest yalniz calisma zamani paketlerini tasir
// (scripts/manifest.cjs): kokte `npm ci` / `npm install` gelistirme araclarini KURMAZ, kuruluysa
// SILER; komut o zaman "vite: command not found" gibi nedeni soylemeyen bir hatayla duserdi.
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const KOK = path.join(__dirname, '..');
const ARACLAR = ['vite', 'vitest', 'eslint', 'typescript'];

/** Saf islev: kurulu olmayan araclarin listesi. */
function eksikAraclar(kok = KOK, araclar = ARACLAR) {
  return araclar.filter((a) => !fs.existsSync(path.join(kok, 'node_modules', a, 'package.json')));
}

if (require.main === module) {
  const eksik = eksikAraclar();
  if (eksik.length) {
    console.error(
      `[arac-kontrol] gelistirme araclari kurulu degil (${eksik.join(', ')}).\n` +
        '  Kurulum: npm run kur\n' +
        '  Neden: kok manifest yalniz calisma zamani paketlerini tasir; tam agac gelistirme/ altindadir.',
    );
    process.exit(1);
  }
}

module.exports = { eksikAraclar, ARACLAR };
