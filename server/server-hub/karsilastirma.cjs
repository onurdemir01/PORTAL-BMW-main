// server/server-hub/karsilastirma.cjs - Retirement etiket motoru (A) ile Analiz grup karari (B) karsilastirmasi
// (Faz 4, 2026-11-11; docs/RETIREMENT-MOTOR-BIRLESTIRME.md). Saf fonksiyon; uc index.cjs'te.
//
// Gozlem doneminde iki motorun NEREDE ayristigini sayar; etiket motoru kaldirilmadan once KRITIK ve
// B_ADAY_A_ENGEL satirlari sifir olmali ve B_ADAY_A_YOK satirlari elle incelenmis olmali.
//   KRITIK_A_KESIN_B_KULLANIMDA  etiket "kesin retire" diyor, Analiz kullanim goruyor (en tehlikeli ayrisma)
//   A_KESIN_B_KARARSIZ           etiket kesin, Analiz aday degil (supheli / karar verilemez / sorun yok)
//   B_ADAY_A_YOK                 Analiz grubu aday, etiket yok
//   B_ADAY_A_ENGEL               Analiz aday ama etiket supheliye inmis (zincir nedeni var)
//   A_ONLY_EAR_GIRDI             EAR / kok girdi etiketi (Analiz'de karsiligi yok; disk temizligi listesi)
//   ANAHTAR_ESLENEMEDI           JVM etiketi Analiz grubuna eslenemedi
//   UYUM                         ikisi ayni yonde
'use strict';

const { tabanAd } = require('./capraz.cjs');

const SINIFLAR = Object.freeze([
  'KRITIK_A_KESIN_B_KULLANIMDA',
  'A_KESIN_B_KARARSIZ',
  'B_ADAY_A_YOK',
  'B_ADAY_A_ENGEL',
  'A_ONLY_EAR_GIRDI',
  'ANAHTAR_ESLENEMEDI',
  'UYUM',
]);

/** Etiketin Analiz grup anahtari (JVM: taban ad + ortam + nesil). */
function grupAnahtari(e) {
  const nesil = e.gen == null || e.gen === '' || Number(e.gen) === 0 ? '?' : String(e.gen);
  return `grup:${String(tabanAd(e.ad) || e.ad).toUpperCase()}|${e.ortam || '?'}|${nesil}`;
}

/**
 * @param {{ etiketler: object[], gruplar: Map<string, object> }} girdi
 * @returns {{ sayilar: Record<string, number>, satirlar: object[] }}
 */
function karsilastir({ etiketler, gruplar }) {
  const satirlar = [];
  const etiketliGrup = new Map();
  for (const e of etiketler || []) {
    const temel = { etiket: e.anahtar, etiketSeviye: e.seviye, kurallar: e.kurallar || [], konu: e.ad, ortam: e.ortam, nesil: e.gen ?? null };
    if (e.tur !== 'JVM') {
      satirlar.push({ ...temel, sinif: 'A_ONLY_EAR_GIRDI', grup: null, grupKarar: null });
      continue;
    }
    const gk = grupAnahtari(e);
    const g = gruplar.get(gk);
    if (!g) {
      satirlar.push({ ...temel, sinif: 'ANAHTAR_ESLENEMEDI', grup: gk, grupKarar: null });
      continue;
    }
    if (!etiketliGrup.has(gk)) etiketliGrup.set(gk, []);
    etiketliGrup.get(gk).push(e);
    let sinif = 'UYUM';
    if (e.seviye === 'KESIN' && g.karar === 'KULLANIMDA') sinif = 'KRITIK_A_KESIN_B_KULLANIMDA';
    else if (e.seviye === 'KESIN' && g.karar !== 'RETIRE_ADAYI') sinif = 'A_KESIN_B_KARARSIZ';
    else if (g.karar === 'RETIRE_ADAYI' && e.seviye !== 'KESIN' && (e.nedenler || []).length) sinif = 'B_ADAY_A_ENGEL';
    satirlar.push({ ...temel, sinif, grup: gk, grupKarar: g.karar, nedenler: (e.nedenler || []).slice(0, 3) });
  }
  for (const g of gruplar.values()) {
    if (g.karar !== 'RETIRE_ADAYI' || etiketliGrup.has(g.anahtar)) continue;
    satirlar.push({ etiket: null, etiketSeviye: null, kurallar: [], konu: g.ad, ortam: g.ortam, nesil: g.nesil, sinif: 'B_ADAY_A_YOK', grup: g.anahtar, grupKarar: g.karar });
  }
  const sira = new Map(SINIFLAR.map((s, i) => [s, i]));
  satirlar.sort((a, b) => sira.get(a.sinif) - sira.get(b.sinif) || String(a.konu).localeCompare(String(b.konu)));
  const sayilar = Object.fromEntries(SINIFLAR.map((s) => [s, satirlar.filter((x) => x.sinif === s).length]));
  return { sayilar, satirlar };
}

module.exports = { karsilastir, grupAnahtari, SINIFLAR };
