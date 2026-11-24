// scripts/kapsam-yayinla.cjs — kapsam raporunu kurumsal SonarQube'un okuyacagi yere, REPOYA yazar.
//   node scripts/kapsam-yayinla.cjs             coverage/lcov.info -> kalite/kapsam/{lcov.info,ozet.json}
//   node scripts/kapsam-yayinla.cjs --dogrula   rapor kaynakla ayni mi (bayatsa cikis 1)
//   node scripts/kapsam-yayinla.cjs --kurumsal  kurumsal Jenkins isi: guncel raporu coverage/lcov.info'ya koyar
//
// NEDEN REPODA (2026-11-14, docs/adr/0004-kapsam-raporu-repoda.md):
//   Kurumsal pipeline testleri kosturamiyor (Node 16; test asamasi yok). SonarQube kapsami ancak
//   analiz anindaki calisma agacinda bir lcov dosyasi bulursa gorur; `coverage/` git disidir ve
//   kurumsal agaca hic ulasmaz -> kapsam %0. Kurum pipeline'a test asamasi ekleyene kadar rapor
//   repoda tasinir ve main'e her push'tan sonra yenilenir (.github/workflows/kapsam-raporu.yml).
//
// YALNIZ KAYNAK DOSYALARI: test dosyalari rapordan cikarilir (Sonar onlari sonar.tests sayar).
// KAYNAK = KURUMUN KAYNAK SAYDIGI (2026-11-24, PR-2): kurumsal tarama sonar.sources=. verir ve yalniz
// *.test.js / *.test.tsx'i test sayar (kalite/kurumsal-sonar.json). scripts/ ve __tests__ altindaki
// yardimcilar (fixtures, harness) kurumda KAYNAKTIR; rapor onlari tasimadiginda kurum, testlerin
// calistirdigi bu kodu %0 sayiyordu (olcum: ~12 bin satir; yardimcilar %98, scripts %77 kapsaniyor).
// Kuruma gitmeyen dizinler (scripts/teslim.cjs KURUMA_GITMEYEN) rapora girmez. K13'un kendi
// siniflandirmasi (sonar-project.properties: src, server, shared) bu kumenin alt kumesidir; SonarQube
// taramadigi dosyanin satirlarini yok sayar.
// Yalniz SonarQube'un kullandigi satirlar yazilir (SF, DA, BRDA, LF, LH, BRF, BRH): islev
// satirlari (FN*) kullanilmaz ve depoyu buyutur.
//
// VURUS SAYISI 0/1: SonarQube yalniz "kapsandi mi" bilgisini kullanir. Ham sayilar ortamdan ortama
// degisir (her tazelemede ~50 bin satirlik fark uretiyordu); 0/1'e indirilince rapor yalniz kapsam
// gercekten degisince degisir.
//
// BAYATLIK: ozet.json, raporun uretildigi kaynak agacinin ozetini (dosya yolu + icerik sha256)
// tasir. Kaynak degisip rapor yenilenmezse SonarQube satirlari yanlis eslestirir; --dogrula bunu
// yakalar (teslimden once ve CI'da).
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { aracYolu } = require('./arac-yolu.cjs');
const { KURUMA_GITMEYEN } = require('./teslim.cjs');

const KOK = path.join(__dirname, '..');
const GIRDI = path.join(KOK, 'coverage', 'lcov.info');
const HEDEF_DIZIN = path.join(KOK, 'kalite', 'kapsam');
// Kaynak dizinleri (kok dizindeki dosyalar da kaynak: eslint.config.js gibi). Derleme ciktilari (dist/,
// coverage/) git disidir; kurum da .gitignore'u uygular. Izlenen her kod dosyasi bu dizinlerde (bekci KP5).
const KAYNAK_DIZINLERI = ['src', 'server', 'shared', 'scripts'];
const KOD = /\.(c?js|mjs|tsx?)$/;
// Test dosyasi ADINDAN taninir (kurum gibi); __tests__ altindaki yardimcilar kaynaktir. src/test/
// Vitest kurulumudur; kurum onu kapsamdan cikarir (coverageExclusions **/test/**).
const TEST = /\.(test|spec)\.(c?js|mjs|tsx?)$|^src\/test\//;
const TUTULAN = /^(SF|DA|BRDA|LF|LH|BRF|BRH):|^end_of_record$/;

/** Kapsam raporuna girecek kaynak dosya mi? (repo-goreli, `/` ayracli yol) */
function kaynakMi(yol) {
  const ust = yol.includes('/') ? yol.slice(0, yol.indexOf('/')) : null; // null: kok dizinde
  return (
    KOD.test(yol) &&
    !TEST.test(yol) &&
    !yol.endsWith('.d.ts') &&
    (ust === null || KAYNAK_DIZINLERI.includes(ust)) && // repo disi yol (mutlak, ../) da elenir
    !/(^|\/)node_modules\//.test(yol) &&
    !KURUMA_GITMEYEN.some((d) => yol.startsWith(d))
  );
}

/** `DA:satir,sayi` ve `BRDA:satir,blok,dal,sayi` satirlarinda sayiyi 0/1'e indirir ('-' aynen). */
function vurusIndir(satir) {
  // Kalan kisim rakamla baslayamaz (\d+ hepsini aldi): `(\d+)(.*)$` belirsizdi (Sonar S8786).
  const m = /^(DA:\d+,|BRDA:\d+,\d+,\d+,)(\d+)(\D.*)?$/.exec(satir);
  if (!m) return satir;
  return `${m[1]}${Number(m[2]) > 0 ? 1 : 0}${m[3] ?? ''}`;
}

/**
 * Birlestirilmis lcov metni -> yalniz kaynak dosyalarinin, yalniz Sonar'in okudugu satirlari.
 * Kayitlar dosya yoluna gore sirali (cikti kararli: ayni kapsam = ayni bayt). Saf islev.
 * @returns {{ metin: string, dosyalar: string[], lf: number, lh: number }}
 */
function lcovSuz(metin) {
  const kayitlar = new Map();
  let cur = null;
  for (const satir of String(metin).split(/\r?\n/)) {
    if (satir.startsWith('SF:')) {
      const yol = satir.slice(3).replaceAll('\\', '/');
      cur = kaynakMi(yol) ? { yol, satirlar: [satir.replaceAll('\\', '/')] } : null;
    } else if (satir === 'end_of_record') {
      if (cur) {
        cur.satirlar.push(satir);
        kayitlar.set(cur.yol, cur.satirlar);
      }
      cur = null;
    } else if (cur && TUTULAN.test(satir)) {
      cur.satirlar.push(vurusIndir(satir));
    }
  }
  const dosyalar = [...kayitlar.keys()].sort((a, b) => Number(a > b) - Number(a < b));
  let lf = 0;
  let lh = 0;
  for (const d of dosyalar)
    for (const s of kayitlar.get(d)) {
      if (s.startsWith('LF:')) lf += Number(s.slice(3)) || 0;
      else if (s.startsWith('LH:')) lh += Number(s.slice(3)) || 0;
    }
  const govde = dosyalar.map((d) => kayitlar.get(d).join('\n')).join('\n');
  return { metin: govde ? `${govde}\n` : '', dosyalar, lf, lh };
}

/** Izlenen kaynak dosyalari (git ls-files) -> tek ozet. Yol listesi ve icerikler degisirse degisir. */
function kaynakOzeti(kok = KOK) {
  const cikti = execFileSync(aracYolu('git'), ['ls-files', '-z'], {
    cwd: kok,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  const dosyalar = cikti
    .split('\0')
    .filter((f) => f && kaynakMi(f))
    .sort((a, b) => Number(a > b) - Number(a < b));
  const h = crypto.createHash('sha256');
  for (const f of dosyalar) {
    const icerik = fs.readFileSync(path.join(kok, f));
    h.update(`${f}\0${crypto.createHash('sha256').update(icerik).digest('hex')}\n`);
  }
  return { ozet: h.digest('hex'), dosya: dosyalar.length };
}

function yayinla() {
  if (!fs.existsSync(GIRDI)) {
    console.error('[kapsam] coverage/lcov.info yok. Once: npm run test:coverage');
    process.exit(1);
  }
  const { metin, dosyalar, lf, lh } = lcovSuz(fs.readFileSync(GIRDI, 'utf8'));
  if (!dosyalar.length) {
    console.error('[kapsam] raporda kaynak dosya yok (yollar repo-goreli degil mi?)');
    process.exit(1);
  }
  const kaynak = kaynakOzeti();
  fs.mkdirSync(HEDEF_DIZIN, { recursive: true });
  fs.writeFileSync(path.join(HEDEF_DIZIN, 'lcov.info'), metin);
  const ozet = {
    aciklama:
      'Kurumsal SonarQube icin kapsam raporu. Elle duzenlenmez: npm run test:coverage && npm run kapsam:yayinla',
    kaynakOzeti: kaynak.ozet,
    kaynakDosya: kaynak.dosya,
    raporDosya: dosyalar.length,
    satir: { toplam: lf, kapsanan: lh, oran: lf ? Number(((100 * lh) / lf).toFixed(1)) : 0 },
  };
  fs.writeFileSync(path.join(HEDEF_DIZIN, 'ozet.json'), `${JSON.stringify(ozet, null, 2)}\n`);
  console.log(
    `[kapsam] kalite/kapsam yazildi: ${dosyalar.length} kaynak dosya, satir %${ozet.satir.oran} (${lh}/${lf}).`,
  );
}

/** Repodaki rapor kaynak agaciyla ayni mi? Cikmaz; durumu doner. */
function raporDurumu() {
  const yol = path.join(HEDEF_DIZIN, 'ozet.json');
  if (!fs.existsSync(yol) || !fs.existsSync(path.join(HEDEF_DIZIN, 'lcov.info')))
    return { durum: 'yok' };
  const kayitli = JSON.parse(fs.readFileSync(yol, 'utf8'));
  const simdi = kaynakOzeti();
  return { durum: kayitli.kaynakOzeti === simdi.ozet ? 'guncel' : 'bayat', kayitli, simdi };
}

function dogrula() {
  const r = raporDurumu();
  if (r.durum === 'yok') {
    console.error(
      '[kapsam] kalite/kapsam raporu yok. Uret: npm run test:coverage && npm run kapsam:yayinla',
    );
    process.exit(1);
  }
  if (r.durum === 'bayat') {
    console.error(
      `[kapsam] rapor BAYAT: kaynak agaci rapordan sonra degismis (${r.kayitli.kaynakDosya} -> ${r.simdi.dosya} dosya).\n` +
        '  Yenile: npm run test:coverage && npm run kapsam:yayinla',
    );
    process.exit(1);
  }
  console.log(`[kapsam] rapor guncel (satir %${r.kayitli.satir.oran}).`);
}

/**
 * Kurumsal Jenkins isi (deploy/jenkins/DVL_JAVASCRIPT_GAR_BMW_PORTAL.groovy) icin. Testler orada
 * KOSTURULMAZ: npm komutlarinin hepsi tek bir 15 dk zaman asimi icinde ve takim yerelde bile ~6 dk.
 * Kapsami CI uretir (her main push'unda gercek testlerle, kalite/kapsam/); bu adim o raporu
 * kurumsal Sonar adiminin aradigi coverage/lcov.info'ya koyar.
 *   - rapor guncel  -> kopyalar, cikis 0
 *   - bayat / yok + Sonar kosusu (BUILD_NOTE "sonarqube...") -> cikis 1: yanlis eslesen kapsam yuklenmez
 *   - bayat / yok + normal derleme -> uyarir, kopyalamaz, cikis 0 (kapsam yalniz Sonar kosusunda okunur)
 */
function kurumsal() {
  const r = raporDurumu();
  const sonarKosusu = /^sonarqube/i.test(process.env.BUILD_NOTE || '');
  if (r.durum === 'guncel') {
    fs.mkdirSync(path.dirname(GIRDI), { recursive: true });
    fs.copyFileSync(path.join(HEDEF_DIZIN, 'lcov.info'), GIRDI);
    console.log(
      `[kapsam] kurumsal: kalite/kapsam/lcov.info -> coverage/lcov.info (satir %${r.kayitli.satir.oran}).`,
    );
    return 0;
  }
  const neden =
    r.durum === 'yok'
      ? 'kalite/kapsam raporu yok'
      : 'kalite/kapsam raporu BAYAT (kaynak rapordan sonra degismis)';
  if (sonarKosusu) {
    console.error(
      `[kapsam] Sonar kosusu: ${neden}; yanlis eslesen kapsam yuklenmez. CI tazelemesini bekleyip yeniden kosturun.`,
    );
    return 1;
  }
  console.warn(`[kapsam] ${neden}; Sonar kosusu degil, kapsam kopyalanmadi (derleme surer).`);
  return 0;
}

if (require.main === module) {
  if (process.argv.includes('--dogrula')) dogrula();
  else if (process.argv.includes('--kurumsal')) process.exit(kurumsal());
  else yayinla();
}

module.exports = { lcovSuz, kaynakMi, kaynakOzeti, vurusIndir, KOD, TEST };
