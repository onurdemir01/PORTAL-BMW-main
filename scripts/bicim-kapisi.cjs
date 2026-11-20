// scripts/bicim-kapisi.cjs — bicim (prettier) kapisi: HER izlenen JS/TS dosyasi bicimli.
//   node scripts/bicim-kapisi.cjs            sahnelenen dosyalar (pre-commit)
//   node scripts/bicim-kapisi.cjs --tum      izlenen BUTUN dosyalar (npm run lint -> K2 ve CI)
//
// KURAL (2026-11-20, kurumsal is #52): depo bir kez tumuyle bicimlendi (commit bb7a4d27,
// .git-blame-ignore-revs). Artik istisna yok: sahnelenen her JS/TS dosyasi bicimli olmali; HEAD'deki
// durumu fark etmez. Eski kural ("HEAD'de bicimsiz dosyaya dokunmak serbest") 1044 bicimsiz dosya
// birakmisti; Sonar'in S2681 / S3972 bulgularinin cogu o dosyalardaki tek satirlik bloklardandi.
// --tum CI'da ayni kurali butun agaca uygular: kancasiz (ornegin dogrudan main'e) gelen bicimsiz dosya
// da kirmizi olur. Dislananlar .prettierignore'da (Ansible agaci AWX ile bayt bayt ayni kalir).
// Dosyayi duzeltmek icin: npx prettier --write <dosya>
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { aracYolu } = require('./arac-yolu.cjs');

const KOD = /\.(?:[cm]?js|tsx?)$/;

/** Sahnelenen (ya da izlenen) dosya bicimsiz mi? Istisna yok (2026-11-20). Saf islev. */
function ihlalMi(bicimli) {
  return bicimli !== true;
}

/**
 * `git diff --cached --name-status -z -M` ciktisi -> [{ yol, eski }]. Yeniden adlandirmada (R)
 * `eski` kaynak yoldur, HEAD bicimi oradan okunur; digerlerinde yolun kendisi. Saf islev.
 */
function degisenler(cikti) {
  const p = cikti.split('\0');
  const out = [];
  for (let i = 0; i < p.length;) {
    const durum = p[i++];
    if (!durum) continue;
    if (durum.startsWith('R')) {
      const eski = p[i++];
      out.push({ yol: p[i++], eski });
    } else {
      const yol = p[i++];
      out.push({ yol, eski: yol });
    }
  }
  return out;
}

const git = (args) =>
  execFileSync(aracYolu('git'), args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });

/** `git show <spec>`; dosya o surumde yoksa (yeni dosya) null. Git'in hata metni yazdirilmaz. */
function gitOku(spec) {
  try {
    return execFileSync(aracYolu('git'), ['show', spec], {
      encoding: 'utf8',
      maxBuffer: 256 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    return null;
  }
}

async function bicimliMi(prettier, metin, dosya) {
  const ayar = (await prettier.resolveConfig(dosya)) || {};
  return prettier.check(metin, { ...ayar, filepath: dosya });
}

async function prettierYukle() {
  try {
    return require('prettier');
  } catch {
    console.error('[bicim] prettier kurulu degil: npm run kur');
    return null;
  }
}

/** Denetlenecek dosya mi? (JS/TS, .prettierignore disi, ayristiricisi var) */
async function denetlenir(prettier, kok, f) {
  if (!KOD.test(f)) return false;
  const info = await prettier.getFileInfo(path.join(kok, f), {
    ignorePath: path.join(kok, '.prettierignore'),
  });
  return !info.ignored && Boolean(info.inferredParser);
}

function rapor(ihlaller, kapsam) {
  if (!ihlaller.length) {
    if (kapsam) console.log(`[bicim] tamam: ${kapsam} dosya bicimli.`);
    return 0;
  }
  console.error('[bicim] KIRMIZI: bicimsiz dosyalar (istisna yok):');
  for (const f of ihlaller.slice(0, 50)) console.error(`  - ${f}`);
  if (ihlaller.length > 50) console.error(`  ... ve ${ihlaller.length - 50} dosya daha`);
  console.error(`  Duzelt: npx prettier --write ${ihlaller.slice(0, 50).join(' ')}`);
  return 1;
}

async function main(argv = process.argv.slice(2)) {
  const prettier = await prettierYukle();
  if (!prettier) return 1;
  const kok = git(['rev-parse', '--show-toplevel']).trim();
  const ihlaller = [];
  if (argv[0] === '--tum') {
    const izlenen = git(['ls-files', '-z']).split('\0').filter(Boolean);
    let sayi = 0;
    for (const f of izlenen) {
      const tam = path.join(kok, f);
      if (!fs.existsSync(tam) || !(await denetlenir(prettier, kok, f))) continue;
      sayi += 1;
      if (ihlalMi(await bicimliMi(prettier, fs.readFileSync(tam, 'utf8'), tam))) ihlaller.push(f);
    }
    return rapor(ihlaller, sayi);
  }
  if (argv.length) {
    console.error('kullanim: node scripts/bicim-kapisi.cjs [--tum]');
    return 2;
  }
  const dosyalar = degisenler(
    git(['diff', '--cached', '--name-status', '-z', '-M', '--diff-filter=ACMR']),
  );
  for (const { yol: f } of dosyalar) {
    if (!(await denetlenir(prettier, kok, f))) continue;
    const sahne = gitOku(`:${f}`);
    if (sahne === null) continue;
    if (ihlalMi(await bicimliMi(prettier, sahne, path.join(kok, f)))) ihlaller.push(f);
  }
  return rapor(ihlaller, null);
}

if (require.main === module)
  main().then(
    (rc) => {
      process.exitCode = rc;
    },
    (e) => {
      console.error(`[bicim] HATA: ${e && e.message}`);
      process.exitCode = 1;
    },
  );

module.exports = { ihlalMi, degisenler, KOD };
