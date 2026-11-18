#!/usr/bin/env node
// scripts/teslim.cjs — kurumsal teslim butunlugu: kurumsal daldaki kod main'in BIREBIR kopyasi mi?
//
//   node scripts/teslim.cjs --yaz       kalite/teslim.json'u git indeksinden yazar
//                                       (CI: .github/workflows/teslim-imzasi.yml, main'e her push'tan sonra)
//   node scripts/teslim.cjs --dogrula   git indeksi kalite/teslim.json ile ayni mi (kurumsal:derle 1. adimi;
//                                       kurumsal PC'de `git add -A`'dan sonra da kosturulabilir)
//
// NEDEN (2026-11-18, kurumsal is #48): kod kurumsal depoya main ZIP'i klasore kopyalanarak aktariliyor.
// Is #48'de kurumsal dal main'in YARIM bir kopyasiydi: scripts/kurumsal-derle.cjs gelmis, ayni commit'te
// eklenen package.json satiri gelmemisti -> "npm error Missing script". Yarim kopya baska bicimlerde
// de olur (eski betik, eksik dosya, main'de silinmis ama kalmis dosya) ve isi anlasilmaz yerlerde
// dusurur. Bu denetim kurumsal derlemenin ILK adimidir; farki dosya dosya soyler.
//
// NE KARSILASTIRILIR: `git ls-files -s` blob sha'lari (icerik). Calisma agaci okunmaz: CRLF donusumu
// yanlis alarm uretmez, dosya okunmadigi icin hizlidir. Mod bitleri karsilastirilmaz: Windows'tan
// yapilan commit'ler calistirma bitini kaybeder.
// KURUMA GITMEYENLER (iki yonde de yok sayilir: kurumsal depoda olsalar da olmasalar da denetim gecer):
//   kalite/                       kapsam raporu kendi parmak iziyle denetlenir (scripts/kapsam-yayinla.cjs);
//                                 imza kendini iceremez. Kapsam / imza tazeleme commit'leri imzayi bayatlatmaz.
//   .github/ .claude/ .agent/     GitHub CI ve ajan talimatlari: kurumsal derlemede kullanilmaz.
//   sunum/                        tanitim sunumu (ikili dosyalar): derlemede ve pakette yok.
// Kurumsal is #50 (2026-11-18) bu dort dizin kurumsal dalda olmadigi icin dustu; kurumsal depoya
// gitmemeleri karar (kullanici). Kod, betik, yapilandirma ve package.json bu listeye GIREMEZ (TS1).
//
// SINIR: package.json'in kendisi eskiyse `npm run kurumsal:derle` hic calismaz (is #48 tam olarak
// buydu); onu aktarim yontemi onler (docs/KALITE-KAPILARI.md "Kurumsal aktarim").
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const KOK = path.join(__dirname, '..');
const IMZA = 'kalite/teslim.json';
const KURUMA_GITMEYEN = ['kalite/', '.github/', '.claude/', '.agent/', 'sunum/'];
const GOSTER = 20;
const ACIKLAMA =
  'Kurumsal teslim imzasi: main agacindaki her izlenen dosyanin git blob sha degeri (kuruma gitmeyenler haric). ' +
  "Elle duzenlenmez: main'e her push'tan sonra .github/workflows/teslim-imzasi.yml yazar. " +
  'Kurumsal derleme ilk adimda bununla karsilastirir: node scripts/teslim.cjs --dogrula';

const git = (args, kok) =>
  execFileSync('git', args, {
    cwd: kok,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

/** git indeksi -> { yol: blobSha } (kuruma gitmeyenler haric; git'in sirasiyla). */
function imza(kok = KOK) {
  const dosyalar = {};
  for (const kayit of git(['ls-files', '-s', '-z'], kok).split('\0')) {
    if (!kayit) continue;
    // "<mod> <sha> <asama>\t<yol>"
    const sekme = kayit.indexOf('\t');
    const yol = kayit.slice(sekme + 1);
    if (KURUMA_GITMEYEN.some((h) => yol.startsWith(h))) continue;
    dosyalar[yol] = kayit.slice(0, sekme).split(' ')[1];
  }
  return dosyalar;
}

/** Beklenen (imza) ve mevcut (indeks) -> farklar. Saf islev. */
function karsilastir(beklenen, mevcut) {
  const farkli = [];
  const eksik = [];
  const fazla = [];
  for (const [yol, sha] of Object.entries(beklenen)) {
    if (!Object.hasOwn(mevcut, yol)) eksik.push(yol);
    else if (mevcut[yol] !== sha) farkli.push(yol);
  }
  for (const yol of Object.keys(mevcut)) if (!Object.hasOwn(beklenen, yol)) fazla.push(yol);
  return { farkli, eksik, fazla };
}

function imzaOku(kok) {
  const kayit = JSON.parse(fs.readFileSync(path.join(kok, IMZA), 'utf8'));
  if (!kayit || typeof kayit.dosyalar !== 'object' || kayit.dosyalar === null)
    throw new Error('dosyalar alani yok');
  return kayit;
}

/**
 * kalite/teslim.json'u indeksten yazar. Dosya kumesi ayniysa dokunmaz (kaynak commit'i de degismez):
 * yalniz kalite/ degistiren push'lar bos commit uretmez.
 */
function imzaYaz(kok = KOK) {
  const dosyalar = imza(kok);
  const sayi = Object.keys(dosyalar).length;
  try {
    const eski = imzaOku(kok);
    const f = karsilastir(eski.dosyalar, dosyalar);
    if (!f.farkli.length && !f.eksik.length && !f.fazla.length)
      return { degisti: false, kaynak: eski.kaynak, dosyaSayisi: sayi };
  } catch {
    // imza yok ya da bozuk: yeniden yazilir
  }
  const kaynak = git(['rev-parse', 'HEAD'], kok).trim();
  const icerik = { aciklama: ACIKLAMA, kaynak, dosyaSayisi: sayi, dosyalar };
  fs.mkdirSync(path.join(kok, path.dirname(IMZA)), { recursive: true });
  fs.writeFileSync(path.join(kok, IMZA), `${JSON.stringify(icerik, null, 2)}\n`);
  return { degisti: true, kaynak, dosyaSayisi: sayi };
}

const liste = (ad, yollar) => {
  const ek = yollar.length > GOSTER ? ` ... ve ${yollar.length - GOSTER} dosya daha` : '';
  return `  ${ad} (${yollar.length}): ${yollar.slice(0, GOSTER).join(', ')}${ek}`;
};

const NEDENLER = [
  '  Olasi nedenler:',
  "   1. Aktarim yarim ya da karisik. Kurumsal klonda: `git rm -r -q .`, main ZIP'inin ICERIGINI koke",
  '      kopyala, `git add -A`, commit, push (docs/KALITE-KAPILARI.md "Kurumsal aktarim").',
  "   2. ZIP, main'deki son degisiklikten hemen sonra, imza tazelenmeden indirildi: GitHub Actions",
  '      "Teslim imzasi" isi bitince ZIP\'i yeniden indirip aktar.',
];

/** Indeks imzayla ayni mi? 0 = birebir, 1 = fark / imza yok / git yok. */
function imzaDogrula(kok = KOK, { yaz = console.log, hata = console.error } = {}) {
  let kayit;
  try {
    kayit = imzaOku(kok);
  } catch (e) {
    hata(`[teslim] ${IMZA} okunamadi (${e.code || e.message}): kod main ZIP'inden aktarilmamis.`);
    hata(NEDENLER.slice(0, 3).join('\n'));
    return 1;
  }
  let mevcut;
  try {
    mevcut = imza(kok);
  } catch (e) {
    hata(
      `[teslim] git indeksi okunamadi (${e.message.split('\n')[0]}): git klonunda kosturulmali.`,
    );
    return 1;
  }
  const f = karsilastir(kayit.dosyalar, mevcut);
  const fark = f.farkli.length + f.eksik.length + f.fazla.length;
  const kaynak = String(kayit.kaynak || '?').slice(0, 12);
  const sayi = Object.keys(kayit.dosyalar).length;
  if (!fark) {
    yaz(`[teslim] BIREBIR: ${sayi} dosya, main ${kaynak} ile ayni.`);
    return 0;
  }
  const satirlar = [
    `[teslim] KOD MAIN'IN BIREBIR KOPYASI DEGIL: ${fark} fark (imza: main ${kaynak}, ${sayi} dosya)`,
  ];
  if (f.farkli.length) satirlar.push(liste('icerigi farkli', f.farkli));
  if (f.eksik.length) satirlar.push(liste("eksik (main'de var, burada yok)", f.eksik));
  if (f.fazla.length) satirlar.push(liste("fazla (main'de yok, burada var)", f.fazla));
  hata([...satirlar, ...NEDENLER].join('\n'));
  return 1;
}

function main(argv, kok = KOK, { yaz = console.log, hata = console.error } = {}) {
  if (argv[0] === '--dogrula' && argv.length === 1) return imzaDogrula(kok, { yaz, hata });
  if (argv[0] === '--yaz' && argv.length === 1) {
    const s = imzaYaz(kok);
    yaz(
      s.degisti
        ? `[teslim] ${IMZA} yazildi: ${s.dosyaSayisi} dosya (main ${s.kaynak.slice(0, 12)}).`
        : `[teslim] ${IMZA} guncel: ${s.dosyaSayisi} dosya.`,
    );
    return 0;
  }
  hata('kullanim: node scripts/teslim.cjs --yaz | --dogrula');
  return 2;
}

if (require.main === module) process.exit(main(process.argv.slice(2)));

module.exports = { IMZA, KURUMA_GITMEYEN, imza, karsilastir, imzaYaz, imzaDogrula, main };
