#!/usr/bin/env node
'use strict';
// scripts/repo-hijyeni.cjs — repo hijyeni bekcisi: hicbir yerden ulasilamayan (yetim) dosyalari bulur.
//
// Kural (docs/KALITE-KAPILARI.md "Repo hijyeni", herkes ve her ajan icin): repoda kullanilmayan
// belge, betik ya da kaynak modulu kalmaz. Yeni dosya bir referansla gelir; isi biten dosya silinir
// (git gecmisinde durur). Bu bekci kurali CI'da zorlar: `server/__tests__/repo-hijyeni.test.cjs`.
//
// Iki kapsam:
//   1. Belge ve betikler (docs/, kokteki *.md, scripts/, deploy/): kod, test, yapilandirma ve kok
//      standart dosyalardan baslayan referans zinciriyle ULASILABILIR olmali. Birbirini anan iki
//      bayat belge (A <-> B) disaridan kimse anmiyorsa ikisi de yetimdir.
//   2. Kaynak modulleri (server/, src/, shared/; testler ve AWX agaci haric): test DISI bir dosya
//      tarafindan anilmali (require/import, tembel yukleme adi, package.json betigi). Yalniz testlerin
//      yukledigi modul olu koddur.
//
// "Anma" = dosyanin yolu ya da uzantili taban adi metinde gecer; modul icin ayrica uzantisiz import
// belirteci ('@/utils/x', '../x'). kalite/kapsam/ (uretilen kapsam raporu tum dosyalari listeler) ve
// CHANGELOG.md (tarihce; anmasi kullanim degildir) referans kaynagi sayilmaz.
//
// Kullanim: node scripts/repo-hijyeni.cjs   (yetim varsa listeler, exit 1)

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

/** Kokteki standart dosyalar: kimse anmasa da kalir (GitHub ve araclar onlari adiyla bulur). */
const KOK_STANDART = new Set([
  'README.md',
  'CHANGELOG.md',
  'CONTRIBUTING.md',
  'SECURITY.md',
  'AGENTS.md',
  'CLAUDE.md',
  'GEMINI.md',
]);

/** Testlerin ortak yardimcisi olup test agaci disinda duran moduller (gerekceli). */
const YALNIZ_TEST_IZINLI = new Map([
  ['server/util/guard-text.cjs', 'bekci testlerinin ortak kaynak-metin okuyucusu'],
]);

/** Referans kaynagi SAYILMAYAN dosyalar. */
const REFERANS_DEGIL = (f) => f.startsWith('kalite/kapsam/') || f === 'CHANGELOG.md';

const testMi = (f) => /(^|\/)__tests__\/|\.test\.|^src\/test\//.test(f);
const belgeKapsami = (f) =>
  f.startsWith('docs/') ||
  f.startsWith('scripts/') ||
  f.startsWith('deploy/') ||
  /^[^/]+\.md$/.test(f);
const modulKapsami = (f) =>
  /^(server|src|shared)\//.test(f) &&
  /\.(c?js|mjs|tsx?)$/.test(f) &&
  !testMi(f) &&
  !f.startsWith('server/ansible/bmw_portal/');

const UZANTILI = /[\w.@-]+(?:\/[\w.@-]+)*\.[A-Za-z0-9]{1,8}\b/g;
const BELIRTEC = /['"`]((?:\.{1,2}\/|@\/|\/)?[\w.@-]+(?:\/[\w.@-]+)*)['"`]/g;

/** Bir metnin andigi adlar: uzantili yollar + taban adlari, ve modul belirteclerinin son parcasi. */
function anilanlar(metin) {
  const adlar = new Set();
  for (const m of metin.matchAll(UZANTILI)) {
    adlar.add(m[0]);
    adlar.add(path.posix.basename(m[0]));
  }
  const belirtec = new Set();
  for (const m of metin.matchAll(BELIRTEC)) {
    const parcalar = m[1].split('/');
    const son = parcalar[parcalar.length - 1].replace(/\.(c?js|mjs|tsx?)$/, '');
    belirtec.add(son);
    if (son === 'index' && parcalar.length > 1) belirtec.add(parcalar[parcalar.length - 2]);
  }
  return { adlar, belirtec };
}

/**
 * Saf islev: dosya listesi + metin okuyucu -> yetimler.
 * @param {string[]} dosyalar izlenen dosyalar (repo kokune gore, '/' ayracli)
 * @param {(f: string) => string | null} oku metin (ikili / okunamayan dosya icin null)
 * @returns {{ dosya: string, tur: 'belge' | 'modul', neden: string }[]}
 */
function yetimler(dosyalar, oku) {
  const anma = new Map();
  for (const f of dosyalar) {
    if (REFERANS_DEGIL(f)) continue;
    const t = oku(f);
    if (t != null) anma.set(f, anilanlar(t));
  }
  const anar = (kaynak, hedef, modul) => {
    const a = anma.get(kaynak);
    if (!a || kaynak === hedef) return false;
    if (a.adlar.has(hedef) || a.adlar.has(path.posix.basename(hedef))) return true;
    if (!modul) return false;
    const ad = path.posix.basename(hedef).replace(/\.(c?js|mjs|tsx?)$/, '');
    if (ad === 'index') return a.belirtec.has(path.posix.basename(path.posix.dirname(hedef)));
    return a.belirtec.has(ad);
  };
  const sonuc = [];

  // 1. Belge ve betikler: kok kumesinden ulasilabilirlik (donguler disaridan anilmadikca yetim).
  const belgeler = dosyalar.filter(belgeKapsami);
  const canli = new Set(dosyalar.filter((f) => !belgeKapsami(f) || KOK_STANDART.has(f)));
  let degisti = true;
  while (degisti) {
    degisti = false;
    for (const b of belgeler) {
      if (canli.has(b)) continue;
      for (const k of canli) {
        if (anar(k, b, false)) {
          canli.add(b);
          degisti = true;
          break;
        }
      }
    }
  }
  for (const b of belgeler) {
    if (!canli.has(b))
      sonuc.push({
        dosya: b,
        tur: 'belge',
        neden: 'hicbir kod, test, yapilandirma ya da canli belge anmiyor',
      });
  }

  // 2. Kaynak modulleri: test disi bir dosya anmali.
  for (const m of dosyalar.filter(modulKapsami)) {
    if (YALNIZ_TEST_IZINLI.has(m)) continue;
    let urun = false;
    let test = false;
    for (const k of anma.keys()) {
      if (!anar(k, m, true)) continue;
      if (testMi(k)) test = true;
      else {
        urun = true;
        break;
      }
    }
    if (!urun)
      sonuc.push({
        dosya: m,
        tur: 'modul',
        neden: test ? 'yalniz testler yukluyor (olu kod)' : 'hicbir dosya yuklemiyor',
      });
  }
  return sonuc.sort((a, b) => (a.dosya < b.dosya ? -1 : 1));
}

function repoTaramasi(kok = path.join(__dirname, '..')) {
  const dosyalar = execFileSync('git', ['ls-files'], { cwd: kok, encoding: 'utf8' })
    .split('\n')
    .filter(Boolean);
  return yetimler(dosyalar, (f) => {
    try {
      const b = fs.readFileSync(path.join(kok, f));
      if (b.length > 4e6 || b.includes(0)) return null;
      return b.toString('utf8');
    } catch {
      return null;
    }
  });
}

if (require.main === module) {
  const y = repoTaramasi();
  if (!y.length) {
    console.log('[repo-hijyeni] temiz: yetim belge, betik ya da modul yok.');
    process.exit(0);
  }
  console.error(`[repo-hijyeni] ${y.length} yetim dosya (bagla ya da sil):`);
  for (const x of y) console.error(`  ${x.tur.padEnd(5)} ${x.dosya} — ${x.neden}`);
  process.exit(1);
}

module.exports = { yetimler, repoTaramasi, anilanlar, KOK_STANDART, YALNIZ_TEST_IZINLI };
