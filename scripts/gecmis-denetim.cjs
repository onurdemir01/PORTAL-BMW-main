// scripts/gecmis-denetim.cjs — main gecmisi denetimi (kalite kapisi K16; docs/KALITE-KAPILARI.md).
//   node scripts/gecmis-denetim.cjs --konu <mesaj-dosyasi>    commit-msg kancasi: konu satiri kurali
//   node scripts/gecmis-denetim.cjs --aralik A..B             CI, main'e push: araliktaki first-parent
//                                                             commit'ler PR'dan mi geldi + konu satiri
//   node scripts/gecmis-denetim.cjs --aralik A..B --pr        CI, PR: PR'in commit'lerinde konu satiri
//
// NEDEN (2026-11-20): kapilar devreye girdikten sonra (2026-11-15) 39 commit PR acilmadan dogrudan
// main'e gitti; 18'inin konu satiri 120 karakteri asiyordu (kancalar kurulmamisti). Dal korumasi
// (kalite/main-korumasi.json) acilana kadar bunu soyleyen bir sey yoktu. Bu kapi push'u geri almaz;
// ihlali CI'da kirmizi yapar ve is ozetine yazar.
//
// Kural TEK KAYNAK: .husky/commit-msg konu satirini buradan denetler (--konu).
//   - konu satiri 8-120 karakter (Merge / Revert / fixup! / squash! haric);
//   - main'e giden her first-parent commit birlesmis bir PR'a bagli (GitHub commit -> PR iliskisi).
//     Muaf: github-actions[bot] (teslim imzasi / kapsam raporu is akislari, [skip ci]).
// Zorla push'ta (onceki uc yeni gecmisin atasi degil) aralik belirsizdir: yalniz son commit denetlenir
// ve bu acikca yazilir.
'use strict';

const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const { aracYolu } = require('./arac-yolu.cjs');

const KONU_EN_AZ = 8;
const KONU_EN_COK = 120;
const MUAF_KONU = /^(?:Merge |Revert |fixup! |squash! )/;
const BOT = 'github-actions[bot]';
const ALAN = '\u001f';

/** Commit mesaji -> konu satiri: '#' ile baslamayan ilk satir (kancadaki gibi), CR'siz. Saf islev. */
function konuSatiri(mesaj) {
  const satir = String(mesaj ?? '')
    .split('\n')
    .find((s) => !s.startsWith('#'));
  return (satir ?? '').replace(/\r/g, '');
}

/** Konu satiri kurala uyuyor mu? null = uygun, metin = neden. Uzunluk karakter (kod noktasi). */
function konuDenetle(konu) {
  const k = String(konu ?? '');
  if (MUAF_KONU.test(k)) return null;
  const n = [...k].length;
  if (n < KONU_EN_AZ || n > KONU_EN_COK)
    return `konu satiri ${KONU_EN_AZ}-${KONU_EN_COK} karakter olmali (simdi ${n})`;
  return null;
}

function git(args, cwd) {
  return execFileSync(aracYolu('git'), args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
}

/**
 * Aralik -> denetlenecek commit'ler [{ sha, yazar, konu }]. push: first-parent (main'e dogrudan giren
 * her adim); --pr: PR'in tum commit'leri. Onceki uc yeni ucun atasi degilse (zorla push) yalniz son
 * commit, `zorla: true`.
 */
function commitler(aralik, { pr = false, cwd = process.cwd() } = {}) {
  const [onceki, son] = aralik.split(/\.{2,3}/);
  let kapsam = [aralik];
  let zorla = false;
  if (!pr && onceki && son) {
    try {
      git(['merge-base', '--is-ancestor', onceki, son], cwd);
    } catch {
      kapsam = ['-1', son];
      zorla = true;
    }
  }
  const bicim = [
    'log',
    `--format=%H${ALAN}%an${ALAN}%s`,
    ...(pr ? [] : ['--first-parent']),
    ...kapsam,
  ];
  const liste = git(bicim, cwd)
    .split('\n')
    .filter(Boolean)
    .map((s) => {
      const [sha, yazar, konu] = s.split(ALAN);
      return { sha, yazar, konu };
    });
  return { liste, zorla };
}

/** GitHub: commit birlesmis bir PR'a bagli mi? `getir` fetch yerine gecer (test). */
async function prdanMi(sha, { depo, jeton, getir = fetch }) {
  const r = await getir(`https://api.github.com/repos/${depo}/commits/${sha}/pulls`, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${jeton}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'portal-kalite-kapisi',
    },
  });
  if (!r.ok) throw new Error(`GitHub API ${r.status} (${sha.slice(0, 12)})`);
  const prler = await r.json();
  return Array.isArray(prler) && prler.some((p) => p?.merged_at);
}

/**
 * Commit listesi -> ihlaller [{ sha, konu, neden }]. `prDenetimi` null ise PR iliskisine bakilmaz
 * (PR olayi ya da yerel kosu).
 */
async function denetle(liste, prDenetimi) {
  const ihlaller = [];
  for (const c of liste) {
    const konuNedeni = konuDenetle(c.konu);
    if (konuNedeni) ihlaller.push({ sha: c.sha, konu: c.konu, neden: konuNedeni });
    if (prDenetimi && c.yazar !== BOT && !(await prdanMi(c.sha, prDenetimi)))
      ihlaller.push({ sha: c.sha, konu: c.konu, neden: "PR'siz: dogrudan main'e gitti" });
  }
  return ihlaller;
}

function ozetYaz(satirlar) {
  const dosya = process.env.GITHUB_STEP_SUMMARY;
  if (dosya) fs.appendFileSync(dosya, `${satirlar.join('\n')}\n`);
}

async function main(argv) {
  if (argv.includes('--konu')) {
    const dosya = argv[argv.indexOf('--konu') + 1];
    const konu = konuSatiri(fs.readFileSync(dosya, 'utf8'));
    const neden = konuDenetle(konu);
    if (neden) {
      console.error(`[commit-msg] HATA: ${neden}: '${konu}'`);
      return 1;
    }
    return 0;
  }
  if (!argv.includes('--aralik')) {
    console.error('kullanim: gecmis-denetim.cjs --konu <dosya> | --aralik A..B [--pr]');
    return 2;
  }
  const aralik = argv[argv.indexOf('--aralik') + 1];
  const pr = argv.includes('--pr');
  const { liste, zorla } = commitler(aralik, { pr });
  if (zorla)
    console.warn(
      `[gecmis] UYARI: onceki uc yeni gecmisin atasi degil (zorla push); yalniz son commit denetlenir.`,
    );
  const jeton = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  const depo = process.env.GITHUB_REPOSITORY;
  let prDenetimi = null;
  if (!pr) {
    if (jeton && depo) prDenetimi = { depo, jeton };
    else if (process.env.CI) throw new Error('CI: GITHUB_TOKEN ve GITHUB_REPOSITORY gerekli');
    else
      console.warn(
        "[gecmis] PR iliskisi yalniz CI'da denetlenir (jeton yok); konu satiri denetlendi.",
      );
  }
  const ihlaller = await denetle(liste, prDenetimi);
  const baslik = `[gecmis] K16 ${aralik}${pr ? ' (PR)' : ''}: ${liste.length} commit, ${ihlaller.length} ihlal`;
  console.log(baslik);
  for (const i of ihlaller) console.error(`  - ${i.sha.slice(0, 12)} ${i.neden}: ${i.konu}`);
  ozetYaz([
    `### K16 main gecmisi`,
    '',
    `${liste.length} commit, ${ihlaller.length} ihlal${zorla ? ' (zorla push: yalniz son commit)' : ''}.`,
    ...(ihlaller.length ? ['', '| commit | neden |', '| --- | --- |'] : []),
    ...ihlaller.map((i) => `| \`${i.sha.slice(0, 12)}\` | ${i.neden} |`),
  ]);
  return ihlaller.length ? 1 : 0;
}

if (require.main === module)
  main(process.argv.slice(2)).then(
    (rc) => {
      process.exitCode = rc;
    },
    (err) => {
      console.error(`[gecmis] HATA: ${err?.message}`);
      process.exitCode = 1;
    },
  );

module.exports = {
  konuSatiri,
  konuDenetle,
  commitler,
  prdanMi,
  denetle,
  KONU_EN_AZ,
  KONU_EN_COK,
  BOT,
};
