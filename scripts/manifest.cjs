// scripts/manifest.cjs — kok manifestleri (calisma zamani) tam manifestten (gelistirme/) turetir.
// `npm run manifest` yazar, `npm run manifest -- --dogrula` yalniz karsilastirir.
//
// NEDEN IKI MANIFEST (2026-11-14, docs/GUVENLIK-0-ZAFIYET.md):
//   Kurumsal pipeline repo kokunde `npm install` calistirir ve kurulan BUTUN agaci tarar. Gelistirme
//   araclarinin (vite, vitest, eslint) bir alt paketinin duzeltmesi yok ve bakimcisi yayimlamiyor.
//   Kokteki package.json + package-lock.json bu yuzden YALNIZ calisma zamani paketlerini tasir:
//   kurumda ve uretim sunucusunda gelistirme araci kurulmaz, tarama sunucuda calisan agaci gorur.
//
//   gelistirme/package.json + package-lock.json  TEK KAYNAK: calisma zamani + gelistirme, tam agac.
//   package.json (dependencies, overrides) + package-lock.json  TURETILIR; elle duzenlenmez.
//
// Kokteki `scripts`, `engines`, `lint-staged` gibi alanlar kokte yasar ve turetmeye girmez.
// Paket ekleme / guncelleme gelistirme/ icinde yapilir, ardindan `npm run manifest`.
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { kilitBudama } = require('./paket.cjs');

const KOK = path.join(__dirname, '..');
const TAM_DIZIN = path.join(KOK, 'gelistirme');

const oku = (dosya) => JSON.parse(fs.readFileSync(dosya, 'utf8'));
const tamPaket = () => oku(path.join(TAM_DIZIN, 'package.json'));
const tamKilit = () => oku(path.join(TAM_DIZIN, 'package-lock.json'));
const kokPaket = () => oku(path.join(KOK, 'package.json'));
const kokKilit = () => oku(path.join(KOK, 'package-lock.json'));

/**
 * Tam manifest + mevcut kok package.json -> turetilmis kok package.json. Saf islev.
 * Yalniz `dependencies` ve `overrides` yazilir; `devDependencies` kokte OLMAZ.
 */
function kokPaketTuret(tam, kok) {
  const p = JSON.parse(JSON.stringify(kok));
  delete p.devDependencies;
  p.dependencies = { ...(tam.dependencies || {}) };
  // Yalniz calisma zamani agacini ilgilendiren override'lar (ust paketi calisma zamaninda olanlar).
  const calisma = new Set(Object.keys(p.dependencies));
  const o = {};
  for (const [k, v] of Object.entries(tam.overrides || {})) if (calisma.has(k)) o[k] = v;
  if (Object.keys(o).length) p.overrides = o;
  else delete p.overrides;
  return p;
}

/** Tam kilit + turetilmis kok package.json -> kok kilidi (surumler birebir). Saf islev. */
function kokKilitTuret(kilit, kok) {
  const budanmis = kilitBudama(kilit, kok);
  const kokGirdi = { ...budanmis.packages[''] };
  kokGirdi.name = kok.name;
  kokGirdi.version = kok.version;
  if (kok.engines) kokGirdi.engines = { ...kok.engines };
  return {
    ...budanmis,
    name: kok.name,
    version: kok.version,
    packages: { ...budanmis.packages, '': kokGirdi },
  };
}

/** Diskteki kok manifestler turetilenle ayni mi? -> fark listesi (bos = esit). */
function farklar() {
  const kok = kokPaket();
  const beklenenPaket = kokPaketTuret(tamPaket(), kok);
  const beklenenKilit = kokKilitTuret(tamKilit(), beklenenPaket);
  const out = [];
  const ayni = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  if ('devDependencies' in kok) out.push('package.json: devDependencies kokte olmamali');
  for (const alan of ['dependencies', 'overrides'])
    if (!ayni(kok[alan], beklenenPaket[alan]))
      out.push(`package.json: ${alan} gelistirme/ ile ayni degil`);
  const mevcutKilit = kokKilit();
  const mP = mevcutKilit.packages || {};
  const bP = beklenenKilit.packages;
  for (const k of new Set([...Object.keys(mP), ...Object.keys(bP)])) {
    if (!bP[k]) out.push(`package-lock.json: fazla girdi ${k || '(kok)'}`);
    else if (!mP[k]) out.push(`package-lock.json: eksik girdi ${k || '(kok)'}`);
    else if (!ayni(mP[k], bP[k])) out.push(`package-lock.json: ${k || '(kok)'} farkli`);
  }
  return out;
}

function yaz() {
  const paket = kokPaketTuret(tamPaket(), kokPaket());
  const kilit = kokKilitTuret(tamKilit(), paket);
  fs.writeFileSync(path.join(KOK, 'package.json'), `${JSON.stringify(paket, null, 2)}\n`);
  fs.writeFileSync(path.join(KOK, 'package-lock.json'), `${JSON.stringify(kilit, null, 2)}\n`);
  return {
    paket: Object.keys(paket.dependencies).length,
    kilit: Object.keys(kilit.packages).length - 1,
  };
}

if (require.main === module) {
  if (process.argv.includes('--dogrula')) {
    const f = farklar();
    if (f.length) {
      console.error(`[manifest] kok manifestler gelistirme/ ile ESIT DEGIL (${f.length} fark):`);
      for (const s of f.slice(0, 20)) console.error(`  - ${s}`);
      console.error('  Duzeltme: npm run manifest');
      process.exit(1);
    }
    console.log('[manifest] kok manifestler gelistirme/ ile esit.');
  } else {
    const s = yaz();
    console.log(
      `[manifest] yazildi: ${s.paket} calisma zamani bagimliligi, kilitte ${s.kilit} paket.`,
    );
  }
}

module.exports = {
  kokPaketTuret,
  kokKilitTuret,
  farklar,
  tamPaket,
  tamKilit,
  kokPaket,
  kokKilit,
  TAM_DIZIN,
};
