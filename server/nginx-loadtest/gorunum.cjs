// server/nginx-loadtest/gorunum.cjs -- Yuk Testi kosu ayrintisinin GORUNUM alanlari (sade turu, 2026-11-02).
//
// GET /kosular/:id icin saf yardimcilar (DB yok, saat yok):
//   adimGorunumu(adim) : API adim satirina (camelCase, nedenler / ham cozulmus) cpuOlculemedi ve reloadlar
//                        ekler; CPU-ms/istek ve kapasite ASLA negatif ya da 0 donmez. Eski satirda (sade
//                        turundan once analiz edilmis, ornek ilk gercek kosu R2) DB'deki negatif / 0 deger
//                        ve nedenlerinde reload olan satirin CPU degeri null'a cevrilir; DB degismez.
//   sonucOzeti(adimlar, analizOzeti) : kosu duzeyi ozet satiri (toplam istek, en iyi / en kotu p95, 429,
//                        5xx, hata orani, CPU'su olculemeyen adim, konf degisimi, reload olaylari).
// Sozlesme: scratchpad sade_sozlesme.md 1-2 (arayuz bu adlari okur). Eksik alan null / [] (eski kosular).
'use strict';

const RELOAD_NEDENI = 'reload(worker_pid_degisti)';
const CPU_KODLARI = new Set(['reload', 'sayac_geriledi', 'net_negatif']);
const FAZLAR = new Set(['isinma', 'olcum', 'bosluk', 'kosu_oncesi']);
const MAX_RELOAD = 50;
const TUR_RE = /^[A-Za-z0-9_-]{1,120}$/;

const sonlu = (x) => (typeof x === 'number' && Number.isFinite(x) ? x : null);
const turVeyaNull = (x) => (typeof x === 'string' && TUR_RE.test(x) ? x : null);

function reloadAni(x) {
  if (!x || typeof x !== 'object') return null;
  const t = sonlu(x.t);
  const tSon = sonlu(x.t_son);
  if (t === null || tSon === null || !FAZLAR.has(x.faz)) return null;
  return { t, tOnce: sonlu(x.t_once), tSon, tur: turVeyaNull(x.tur), faz: x.faz };
}

function reloadOlayi(x) {
  const a = reloadAni(x);
  if (!a) return null;
  return {
    ...a,
    kesit: typeof x.kesit === 'string' ? x.kesit.slice(0, 120) : '',
    workerOnce: sonlu(x.worker_once),
    workerSonra: sonlu(x.worker_sonra),
    kapananEnCok: sonlu(x.kapanan_en_cok) ?? 0,
    etkilenenTurlar: Array.isArray(x.etkilenen_turlar) ? x.etkilenen_turlar.map(turVeyaNull).filter(Boolean) : [],
  };
}

/** API adim satiri (adimApi ciktisi) -> ayni satir + cpuOlculemedi + reloadlar; CPU / kapasite > 0 ya da null. */
function adimGorunumu(a) {
  const ham = a.ham && typeof a.ham === 'object' && !Array.isArray(a.ham) ? a.ham : null;
  const nedenler = Array.isArray(a.nedenler) ? a.nedenler : [];
  const cpu = sonlu(a.cpuMsIstek);
  const kap = sonlu(a.kapasiteRps);
  let kod = ham && CPU_KODLARI.has(ham.cpu_olculemedi) ? ham.cpu_olculemedi : null;
  if (!kod && (cpu !== null || kap !== null) && nedenler.includes(RELOAD_NEDENI)) kod = 'reload';
  if (!kod && ((cpu !== null && cpu <= 0) || (kap !== null && kap <= 0))) kod = 'negatif_deger';
  const reloadlar = ham && Array.isArray(ham.reloadlar) ? ham.reloadlar.map(reloadAni).filter(Boolean) : [];
  return {
    ...a,
    cpuMsIstek: kod ? null : cpu,
    kapasiteRps: kod ? null : kap,
    cpuOlculemedi: kod,
    reloadlar,
  };
}

function topla(adimlar, alan) {
  let t = null;
  for (const a of adimlar) {
    const v = sonlu(a[alan]);
    if (v !== null) t = (t ?? 0) + v;
  }
  return t;
}

/**
 * Kosu ozeti. `adimlar`: adimGorunumu ciktisi; `analizOzeti`: sonuc.portal_analiz.ozet (yoksa null).
 * p95 en iyi / en kotu GECERLI + DOYMA adimlardan; hic yoksa p95'i olan tum satirlardan (p95Kapsam 'tum').
 */
function sonucOzeti(adimlar, analizOzeti) {
  const liste = Array.isArray(adimlar) ? adimlar : [];
  const gecerli = liste.filter((a) => a.gecerlilik === 'GECERLI' || a.gecerlilik === 'DOYMA');
  const p95li = (xs) => xs.filter((a) => sonlu(a.p95) !== null);
  let kapsam = null;
  let aday = p95li(gecerli);
  if (aday.length) kapsam = 'gecerli';
  else {
    aday = p95li(liste);
    if (aday.length) kapsam = 'tum';
  }
  let iyi = null;
  let kotu = null;
  for (const a of aday) {
    if (!iyi || a.p95 < iyi.deger) iyi = { deger: a.p95, tur: a.tur };
    if (!kotu || a.p95 > kotu.deger) kotu = { deger: a.p95, tur: a.tur };
  }
  let enHata = null;
  for (const a of liste) {
    const v = sonlu(a.hataOrani);
    if (v !== null && (enHata === null || v > enHata)) enHata = v;
  }
  const t429 = topla(liste, 'n429');
  const t5xx = topla(liste, 'n5xx');
  const oz = analizOzeti && typeof analizOzeti === 'object' && !Array.isArray(analizOzeti) ? analizOzeti : null;
  const kesitler = oz && Array.isArray(oz.kesitler) ? oz.kesitler : null;
  const reloadlar = oz && Array.isArray(oz.reloadlar) ? oz.reloadlar.map(reloadOlayi).filter(Boolean) : [];
  reloadlar.sort((x, y) => x.t - y.t);
  return {
    adimSayisi: liste.length,
    gecerliAdimSayisi: gecerli.length,
    toplamIstek: topla(liste, 'nIstek'),
    p95EnIyi: iyi,
    p95EnKotu: kotu,
    p95Kapsam: kapsam,
    toplam429: t429,
    toplam5xx: t5xx,
    enYuksekHataOrani: enHata,
    hataVar: (t429 ?? 0) > 0 || (t5xx ?? 0) > 0 || (enHata ?? 0) > 0,
    cpuOlculemeyenAdim: liste.filter((a) => a.cpuOlculemedi).length,
    konfDegisti: kesitler ? kesitler.some((k) => k && k.konf_degisti === true) : null,
    reloadlar: reloadlar.slice(0, MAX_RELOAD),
  };
}

module.exports = { adimGorunumu, sonucOzeti, RELOAD_NEDENI };
