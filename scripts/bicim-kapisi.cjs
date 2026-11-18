// scripts/bicim-kapisi.cjs — bicim (prettier) cirigi: BICIMLI DOSYA BICIMLI KALIR (kalite kapisi, commit oncesi).
//   node scripts/bicim-kapisi.cjs            sahnelenen dosyalar (pre-commit)
//
// NEDEN CIRIK, NEDEN `prettier --write` DEGIL: depo tumuyle bicimli degil. Commit aninda dokunulan
// dosyanin TAMAMINI yeniden bicimlemek ilgisiz satirlari degistirir, ortak calisanin farkini
// sisirir ve kaynak metnini okuyan bekci testlerini kirar. Kural bu yuzden:
//   - yeni dosya bicimli olmali;
//   - HEAD'de bicimli olan dosya bicimli kalmali;
//   - HEAD'de bicimsiz dosyaya dokunmak serbest (toplu bicimleme ayri, tek commit'te yapilir).
//   - yeniden adlandirilan dosya YENI degildir: HEAD bicimi ESKI yoldan okunur (2026-11-18: 511 Node
//     testi .test.cjs -> .test.js; yeni sayilsaydi 330 bicimsiz test toplu bicimlemeye zorlanirdi).
// Dosyayi duzeltmek icin: npx prettier --write <dosya>
'use strict';

const path = require('node:path');
const { execFileSync } = require('node:child_process');

const KOD = /\.(?:[cm]?js|tsx?)$/;

/** HEAD bicimi + sahnelenen bicim -> ihlal mi? Saf islev. `headBicimli` null = yeni dosya. */
function ihlalMi(headBicimli, sahneBicimli) {
  if (sahneBicimli) return false;
  return headBicimli === null || headBicimli === true;
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

const git = (args) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });

/** `git show <spec>`; dosya o surumde yoksa (yeni dosya) null. Git'in hata metni yazdirilmaz. */
function gitOku(spec) {
  try {
    return execFileSync('git', ['show', spec], {
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

async function main() {
  let prettier;
  try {
    prettier = require('prettier');
  } catch {
    console.error('[bicim] prettier kurulu degil: npm run kur');
    return 1;
  }
  const kok = git(['rev-parse', '--show-toplevel']).trim();
  const dosyalar = degisenler(
    git(['diff', '--cached', '--name-status', '-z', '-M', '--diff-filter=ACMR']),
  ).filter((d) => KOD.test(d.yol));
  const ihlaller = [];
  for (const { yol: f, eski } of dosyalar) {
    const tam = path.join(kok, f);
    const info = await prettier.getFileInfo(tam, { ignorePath: path.join(kok, '.prettierignore') });
    if (info.ignored || !info.inferredParser) continue;
    const sahne = gitOku(`:${f}`);
    if (sahne === null) continue;
    const head = gitOku(`HEAD:${eski}`);
    const headBicimli = head === null ? null : await bicimliMi(prettier, head, tam);
    if (ihlalMi(headBicimli, await bicimliMi(prettier, sahne, tam)))
      ihlaller.push({ f, yeni: headBicimli === null });
  }
  if (!ihlaller.length) return 0;
  console.error('[bicim] KIRMIZI: bicimli kalmasi gereken dosyalar bicimsiz:');
  for (const { f, yeni } of ihlaller) console.error(`  - ${f}${yeni ? ' (yeni dosya)' : ''}`);
  console.error(`  Duzelt: npx prettier --write ${ihlaller.map((i) => i.f).join(' ')}`);
  return 1;
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
