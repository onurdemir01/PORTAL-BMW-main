// scripts/kapsam-esik.cjs — birlesik kapsam raporu esigin altindaysa kirmizi (kalite kapisi K9).
//   node scripts/kapsam-esik.cjs [lcov yolu]     varsayilan coverage/lcov.info
//
// Esik kalite/esikler.json `kapsam.satirMin` (tek kaynak). Olcum SonarQube'un okudugu sekilde:
// yalniz kaynak dosyalari (testler haric; scripts/kapsam-yayinla.cjs kaynakMi) ve DA satirlari.
// Dal kapsami bilgi icin yazilir, kapi satir kapsamidir.
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { kaynakMi } = require('./kapsam-yayinla.cjs');

const KOK = path.join(__dirname, '..');

/**
 * lcov metni -> { satir: {toplam, kapsanan}, dal: {toplam, kapsanan}, dosya }. Saf islev.
 * Ayni dosya birden fazla kayitta gecerse satir bazinda birlestirilir (en az bir vurus yeter).
 */
function kapsamOlc(metin) {
  const satirlar = new Map(); // dosya -> Map(satirNo -> vuruldu mu)
  const dallar = new Map(); // dosya -> Map(anahtar -> vuruldu mu)
  let cur = null;
  for (const satir of String(metin).split(/\r?\n/)) {
    if (satir.startsWith('SF:')) {
      const yol = satir.slice(3).replaceAll('\\', '/');
      cur = kaynakMi(yol) ? yol : null;
      if (cur && !satirlar.has(cur)) {
        satirlar.set(cur, new Map());
        dallar.set(cur, new Map());
      }
    } else if (satir === 'end_of_record') {
      cur = null;
    } else if (cur && satir.startsWith('DA:')) {
      const [no, vurus] = satir.slice(3).split(',');
      const m = satirlar.get(cur);
      m.set(no, m.get(no) || Number(vurus) > 0);
    } else if (cur && satir.startsWith('BRDA:')) {
      const p = satir.slice(5).split(',');
      const anahtar = p.slice(0, 3).join(',');
      const m = dallar.get(cur);
      m.set(anahtar, m.get(anahtar) || (p[3] !== '-' && Number(p[3]) > 0));
    }
  }
  const say = (harita) => {
    let toplam = 0;
    let kapsanan = 0;
    for (const m of harita.values())
      for (const v of m.values()) {
        toplam += 1;
        if (v) kapsanan += 1;
      }
    return { toplam, kapsanan };
  };
  return { satir: say(satirlar), dal: say(dallar), dosya: satirlar.size };
}

const oran = ({ toplam, kapsanan }) => (toplam ? (100 * kapsanan) / toplam : 0);

function esikOku(kok = KOK) {
  const e = JSON.parse(fs.readFileSync(path.join(kok, 'kalite', 'esikler.json'), 'utf8'));
  return Number(e.kapsam.satirMin);
}

function main(argv) {
  const yol = path.resolve(KOK, argv[0] || path.join('coverage', 'lcov.info'));
  if (!fs.existsSync(yol)) {
    console.error(`[kapsam-esik] ${path.relative(KOK, yol)} yok. Once: npm run test:coverage`);
    return 1;
  }
  const o = kapsamOlc(fs.readFileSync(yol, 'utf8'));
  const esik = esikOku();
  const s = oran(o.satir);
  const ozet = `satir %${s.toFixed(1)} (${o.satir.kapsanan}/${o.satir.toplam}), dal %${oran(o.dal).toFixed(1)}, ${o.dosya} kaynak dosya`;
  if (!o.dosya || s < esik) {
    console.error(`[kapsam-esik] KIRMIZI: ${ozet}; esik satir %${esik} (kalite/esikler.json).`);
    return 1;
  }
  console.log(`[kapsam-esik] tamam: ${ozet}; esik %${esik}.`);
  return 0;
}

if (require.main === module) process.exitCode = main(process.argv.slice(2));

module.exports = { kapsamOlc, oran, esikOku };
