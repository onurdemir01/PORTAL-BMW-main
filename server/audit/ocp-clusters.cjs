// server/audit/ocp-clusters.cjs - ortam basina GERCEKTE kullanilan cluster kumesi.
//
// NEDEN VERIDEN CIKARILIYOR, SABIT LISTE DEGIL:
// ocp-platforms.cjs'teki PLATFORM_CLUSTERS ortam ayrimi TASIMAZ ve tasiyamaz - ayni
// cluster hem "-dev" hem "-test" namespace'i barindirabiliyor (o dosyada gercek veriyle
// belgelendi). Dolayisiyla "prod cluster'lari sunlardir" diye elle bir liste yazmak
// yanlis olurdu. Bunun yerine: o ortamda GERCEKTEN namespace barindiran cluster'lar
// sayilir.
//
// KISMI KAPSAM BIR HUKUM DEGIL, GOZLEMDIR. Cluster basina uygulama sayisi da dondurulur;
// az uygulamali bir cluster (ornek DR) icin bir uygulamanin orada bulunmamasi cogu zaman
// NORMALDIR. Bu yuzden burada "eksik" damgasi URETILMEZ - yalnizca sayilar verilir,
// yorumu kullaniciya birakilir.
'use strict';

/**
 * @param {Iterable<{envs: Record<string, {cluster: string}[]>}>} apps
 * @param {string[]} envs ilgilenilen ortamlar (sabit sira)
 * @returns {Record<string, {cluster: string, apps: number}[]>} cok uygulamali once
 */
function envClustersFromApps(apps, envs) {
  const counters = {};
  for (const e of envs) counters[e] = new Map();

  for (const app of apps || []) {
    for (const [env, hits] of Object.entries(app?.envs || {})) {
      const m = counters[env];
      if (!m) continue; // ilgilenilmeyen ortam
      // Bir uygulamanin ayni cluster'da BIRDEN FAZLA namespace'i olabilir; cluster
      // basina uygulama sayilirken TEKILLESTIRILIR, aksi halde sayi sisirdi.
      for (const c of new Set((hits || []).map((h) => h && h.cluster).filter(Boolean))) {
        m.set(c, (m.get(c) || 0) + 1);
      }
    }
  }

  const out = {};
  for (const e of envs) {
    out[e] = [...counters[e].entries()]
      .map(([cluster, n]) => ({ cluster, apps: n }))
      .sort((x, y) => y.apps - x.apps || x.cluster.localeCompare(y.cluster));
  }
  return out;
}

/**
 * RESMI KUME UYGULANMIS ortam -> cluster listesi (2026-10-14). Resmi listesi olan ortamda: resmi
 * cluster'larin HEPSI (uygulamasi 0 olsa da - "o cluster'da hic yok" da bilgidir) + o ortamin
 * namespace'inin goruldugu ama listede OLMAYAN cluster'lar `beklenmeyen: true` ile. Resmi listesi
 * olmayan ortam (or. edu) veriden cikarilan listeyle kalir.
 * @returns {{ kumeler: Record<string, {cluster, apps, beklenmeyen?: boolean}[]>, kaynak: Record<string, 'resmi'|'veri'> }}
 */
function envClustersResmi(apps, envs, resmi) {
  const veri = envClustersFromApps(apps, envs);
  const kumeler = {};
  const kaynak = {};
  for (const e of envs) {
    const liste = resmi && resmi[e];
    if (!liste || !liste.length) { kumeler[e] = veri[e]; kaynak[e] = 'veri'; continue; }
    const sayi = new Map((veri[e] || []).map((x) => [x.cluster.toLowerCase(), x.apps]));
    const resmiSet = new Set(liste.map((c) => c.toLowerCase()));
    kumeler[e] = [
      ...liste.map((c) => ({ cluster: c, apps: sayi.get(c.toLowerCase()) || 0 })),
      ...(veri[e] || []).filter((x) => !resmiSet.has(x.cluster.toLowerCase())).map((x) => ({ ...x, beklenmeyen: true })),
    ];
    kaynak[e] = 'resmi';
  }
  return { kumeler, kaynak };
}

module.exports = { envClustersFromApps, envClustersResmi };
