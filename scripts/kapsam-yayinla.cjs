// scripts/kapsam-yayinla.cjs — kapsam raporunu kurumsal SonarQube'un okuyacagi yere, REPOYA yazar.
//   node scripts/kapsam-yayinla.cjs             coverage/lcov.info -> kalite/kapsam/{lcov.info,ozet.json}
//   node scripts/kapsam-yayinla.cjs --dogrula   rapor kaynakla ayni mi (bayatsa cikis 1)
//
// NEDEN REPODA (2026-11-14, docs/adr/0004-kapsam-raporu-repoda.md):
//   Kurumsal pipeline testleri kosturamiyor (Node 16; test asamasi yok). SonarQube kapsami ancak
//   analiz anindaki calisma agacinda bir lcov dosyasi bulursa gorur; `coverage/` git disidir ve
//   kurumsal agaca hic ulasmaz -> kapsam %0. Kurum pipeline'a test asamasi ekleyene kadar rapor
//   repoda tasinir ve main'e her push'tan sonra yenilenir (.github/workflows/kapsam-raporu.yml).
//
// YALNIZ KAYNAK DOSYALARI: test dosyalari rapordan cikarilir (Sonar onlari sonar.tests sayar).
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

const KOK = path.join(__dirname, '..');
const GIRDI = path.join(KOK, 'coverage', 'lcov.info');
const HEDEF_DIZIN = path.join(KOK, 'kalite', 'kapsam');
const KAYNAK_DIZINLERI = ['src', 'server', 'shared']; // sonar-project.properties sonar.sources
const KOD = /\.(c?js|mjs|tsx?)$/;
const TEST = /(^|\/)__tests__\/|\.(test|spec)\.(c?js|mjs|tsx?)$|^src\/test\//;
const TUTULAN = /^(SF|DA|BRDA|LF|LH|BRF|BRH):|^end_of_record$/;

/** Kapsam raporuna girecek kaynak dosya mi? (repo-goreli, `/` ayracli yol) */
function kaynakMi(yol) {
  return (
    KAYNAK_DIZINLERI.some((d) => yol.startsWith(`${d}/`)) &&
    KOD.test(yol) &&
    !TEST.test(yol) &&
    !yol.endsWith('.d.ts')
  );
}

/** `DA:satir,sayi` ve `BRDA:satir,blok,dal,sayi` satirlarinda sayiyi 0/1'e indirir ('-' aynen). */
function vurusIndir(satir) {
  const m = /^(DA:\d+,|BRDA:\d+,\d+,\d+,)(\d+)(.*)$/.exec(satir);
  if (!m) return satir;
  return `${m[1]}${Number(m[2]) > 0 ? 1 : 0}${m[3]}`;
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
  const cikti = execFileSync('git', ['ls-files', '-z', '--', ...KAYNAK_DIZINLERI], {
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

function dogrula() {
  const yol = path.join(HEDEF_DIZIN, 'ozet.json');
  if (!fs.existsSync(yol) || !fs.existsSync(path.join(HEDEF_DIZIN, 'lcov.info'))) {
    console.error(
      '[kapsam] kalite/kapsam raporu yok. Uret: npm run test:coverage && npm run kapsam:yayinla',
    );
    process.exit(1);
  }
  const kayitli = JSON.parse(fs.readFileSync(yol, 'utf8'));
  const simdi = kaynakOzeti();
  if (kayitli.kaynakOzeti !== simdi.ozet) {
    console.error(
      `[kapsam] rapor BAYAT: kaynak agaci rapordan sonra degismis (${kayitli.kaynakDosya} -> ${simdi.dosya} dosya).\n` +
        '  Yenile: npm run test:coverage && npm run kapsam:yayinla',
    );
    process.exit(1);
  }
  console.log(`[kapsam] rapor guncel (satir %${kayitli.satir.oran}).`);
}

if (require.main === module) {
  if (process.argv.includes('--dogrula')) dogrula();
  else yayinla();
}

module.exports = { lcovSuz, kaynakMi, kaynakOzeti, vurusIndir };
