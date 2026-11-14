// scripts/kur.cjs — gelistirici kurulumu. `npm run kur`.
//
// Kokteki manifest YALNIZ calisma zamani paketlerini tasir (scripts/manifest.cjs); duz `npm ci`
// vite / vitest / eslint KURMAZ. Tam agac (calisma zamani + gelistirme) gelistirme/ altindaki tam
// manifestten kurulur ve kokteki `node_modules` ona BAGLANIR: kokteki her dosya (vite.config.ts,
// testler, sunucu) paketleri bugunku gibi `node_modules`tan cozer.
//
//   node scripts/kur.cjs                  gelistirme/ icinde `npm ci` + bag + git kancalari
//   node scripts/kur.cjs --calisma-zamani bagi ve gelistirme agacini KALDIRIR, kokte yalniz calisma
//                                         zamani kurar (kaynak agactan dagitim: derlemeden sonra)
//
// Kokte yanlislikla `npm install` / `npm ci` calistirilirsa gelistirme araclari silinir (kok
// manifestte yoklar); `npm run kur` geri getirir. Bunu `scripts/arac-kontrol.cjs` soyler.
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const KOK = path.join(__dirname, '..');

function npm(args, cwd) {
  const r = spawnSync('npm', args, { cwd, stdio: 'inherit', shell: process.platform === 'win32' });
  if (r.status !== 0) {
    console.error(
      `[kur] HATA: npm ${args.join(' ')} (${path.relative(KOK, cwd) || '.'}) basarisiz.`,
    );
    process.exit(r.status || 1);
  }
}

/** `yol` bir bag mi (symlink / Windows junction)? Yoksa null. */
function durum(yol) {
  try {
    return fs.lstatSync(yol);
  } catch {
    return null;
  }
}

/**
 * kok/node_modules -> gelistirme/node_modules bagini kurar. Gercek bir dizin varsa (eski duzen ya
 * da kokte yapilmis kurulum) silinir: icerigi tam agacin alt kumesidir.
 */
function bagla(kok = KOK) {
  const hedef = path.join(kok, 'gelistirme', 'node_modules');
  const bag = path.join(kok, 'node_modules');
  const s = durum(bag);
  if (s && s.isSymbolicLink()) fs.unlinkSync(bag);
  else if (s) fs.rmSync(bag, { recursive: true, force: true });
  // Goreli hedef: depo tasinsa da bag gecerli kalir. Windows'ta yonetici izni istemeyen junction
  // (junction mutlak yol ister).
  if (process.platform === 'win32') fs.symlinkSync(hedef, bag, 'junction');
  else fs.symlinkSync(path.join('gelistirme', 'node_modules'), bag, 'dir');
}

/** Bagi (yalniz bagi; hedefin icerigine dokunmadan) ve gelistirme agacini kaldirir. */
function coz(kok = KOK) {
  const bag = path.join(kok, 'node_modules');
  const s = durum(bag);
  if (s && s.isSymbolicLink()) fs.unlinkSync(bag);
  fs.rmSync(path.join(kok, 'gelistirme', 'node_modules'), { recursive: true, force: true });
}

function main(argv) {
  const ek = argv.filter((a) => a !== '--calisma-zamani');
  if (argv.includes('--calisma-zamani')) {
    coz();
    npm(['ci', '--omit=dev', '--no-audit', '--no-fund', ...ek], KOK);
    console.log('[kur] calisma zamani agaci kuruldu (gelistirme araclari yok).');
    return;
  }
  npm(['ci', '--no-audit', '--no-fund', ...ek], path.join(KOK, 'gelistirme'));
  bagla();
  const kanca = spawnSync(process.execPath, [path.join(__dirname, 'kanca-kur.mjs')], {
    cwd: KOK,
    stdio: 'inherit',
  });
  if (kanca.status !== 0) process.exit(kanca.status || 1);
  console.log('[kur] tam agac kuruldu: node_modules -> gelistirme/node_modules');
}

if (require.main === module) main(process.argv.slice(2));

module.exports = { bagla, coz };
