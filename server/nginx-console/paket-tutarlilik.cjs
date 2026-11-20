// server/nginx-console/paket-tutarlilik.cjs - "Paket tutarliligi" (2026-11-16): ayni yeni PROD
// SPA filosunun (or. Glomo: tasima grubu newHosts) sunuculari arasinda her SPA uygulamasinin
// paketi birebir ayni mi? (SAF, test edilir.)
//
// Kullanici: "Glomo sunucularinin her zaman ve her sartta esit oldugunu bilmek istiyorum."
// Ayni gun elle yapilan karsilastirmada 230 uygulamanin 24'u farkliydi (deployment'lar bazi
// sunuculari atlamis, elle unzip config'i silmis). Veri: Nginx Hub dokumundeki @@SPAPKG bolumu
// (nginx_console_dump.sh; ozetler elle kullanilan glomo_paket_ozeti.sh ile ayni).
//
// HUKUM KURALI (okunamadi != esit):
//   farkli     : en az bir uygulama FARKLI ya da EKSIK (olculemeyen sunucu olsa bile fark kesindir)
//   olculemedi : fark yok ama en az bir sunucu olculemedi (dokum yok, eski betik = @@SPAPKG yok,
//                dokum cok buyuk ve ozet yok, ya da son gorulme TAZE_SAAT'ten eski)
//   esit       : TUM sunucular taze olculdu, en az bir uygulama var ve her uygulama her sunucuda
//                ayni (okunamayan uygulama/dosya yok, bayat sikistirma yok)
// Karsilastirilan uygulama: en az bir sunucuda bir *.conf'un gosterdigi (tanimli) dizin ya da
// conf'un gosterip dizini olmayan (durum=yok). Hicbir sunucuda tanimli olmayan dizinler
// "tanimsiz" olarak ayrica sayilir (artik dizin; hukmu etkilemez).
'use strict';

const { varsayilanSira } = require('../util/siralama.cjs');

const TAZE_SAAT = 3;

const U = (h) =>
  String(h || '')
    .trim()
    .toUpperCase();
const imza = (p) => [p.version || '-', p.icerik || '-', p.config || '-'].join('|');

/**
 * Sunucunun olcum durumu.
 * @param {object|null} ozet loadSummary sonucu (null = dokum yok)
 * @param {string|null} seenAt son gorulme (dokum mtime ile _seen.json'in buyugu)
 * @param {number} nowMs
 * @param {number} tazeSaat
 */
function sunucuDurumu(ozet, seenAt, nowMs, tazeSaat) {
  if (!ozet) return { durum: 'dokum-yok', neden: 'Nginx Hub dökümü yok' };
  if (!Array.isArray(ozet.pkgs)) {
    if (ozet.tooLarge)
      return { durum: 'olculemedi', neden: 'döküm çok büyük, paket özeti okunamadı' };
    return {
      durum: 'eski-betik',
      neden: 'dökümde paket bölümü yok (sunucudaki döküm betiği eski)',
    };
  }
  const t = seenAt ? new Date(seenAt).getTime() : Number.NaN;
  if (!Number.isFinite(t)) return { durum: 'bayat', neden: 'son görülme zamanı bilinmiyor' };
  const yasSaat = (nowMs - t) / 3600000;
  if (yasSaat > tazeSaat) {
    return {
      durum: 'bayat',
      neden: `son ölçüm ${Math.floor(yasSaat)} saat önce (en çok ${tazeSaat} saat)`,
    };
  }
  return { durum: 'olculdu', neden: null };
}

/**
 * @param {{id:string,label:string,hosts:string[]}[]} gruplar
 * @param {Map<string, {ozet: object|null, seenAt: string|null}>} veriler HOST -> olcum
 * @param {{nowMs?: number, tazeSaat?: number}} [opts]
 */
function computePaketTutarlilik(gruplar, veriler, opts = {}) {
  const nowMs = Number.isFinite(opts.nowMs) ? opts.nowMs : Date.now();
  const tazeSaat = Number.isFinite(opts.tazeSaat) && opts.tazeSaat > 0 ? opts.tazeSaat : TAZE_SAAT;
  return {
    tazeSaat,
    groups: gruplar.map((g) => grupHesapla(g, veriler, nowMs, tazeSaat)),
  };
}

function grupHesapla(g, veriler, nowMs, tazeSaat) {
  const hosts = [...new Set((g.hosts || []).map(U))].sort(varsayilanSira);
  const sunucular = hosts.map((h) => {
    const v = veriler.get(h) || { ozet: null, seenAt: null };
    const d = sunucuDurumu(v.ozet, v.seenAt, nowMs, tazeSaat);
    const pkgs = v.ozet && Array.isArray(v.ozet.pkgs) ? v.ozet.pkgs : null;
    return {
      host: h,
      durum: d.durum,
      neden: d.neden,
      seenAt: v.seenAt || null,
      dumpedAt: v.ozet?.dumpedAt || null,
      paketSayisi: pkgs ? pkgs.filter((p) => p.durum === 'var').length : null,
      pkgs,
    };
  });
  // Paketleri okunabilen (bayat olsa da) sunucular karsilastirmaya girer: bayat veri farki
  // gosterebilir; "esit" hukmu ise yalniz hepsi taze olculmusken verilir.
  const okunan = sunucular.filter((s) => s.pkgs);
  const harita = new Map(); // key -> Map(host -> pkg)
  const tanimliKey = new Set();
  for (const s of okunan) {
    for (const p of s.pkgs) {
      const key = `${p.ns}/${p.app}`;
      if (!harita.has(key)) harita.set(key, new Map());
      harita.get(key).set(s.host, p);
      if (p.tanimli || p.durum === 'yok') tanimliKey.add(key);
    }
  }
  const apps = [];
  const ayni = [];
  const tanimsiz = [];
  for (const [key, m] of harita) {
    if (!tanimliKey.has(key)) {
      tanimsiz.push({ key, hosts: [...m.keys()].sort(varsayilanSira) });
      continue;
    }
    const satir = uygulamaSatiri(key, m, okunan);
    if (satir.durum === 'ayni')
      ayni.push({ key, version: satir.cogunluk ? satir.cogunluk.version : null });
    else apps.push(satir);
  }
  const SIRA = { eksik: 0, farkli: 1, olculemedi: 2 };
  apps.sort((a, b) => SIRA[a.durum] - SIRA[b.durum] || a.key.localeCompare(b.key));
  ayni.sort((a, b) => a.key.localeCompare(b.key));
  tanimsiz.sort((a, b) => a.key.localeCompare(b.key));
  const olculmeyen = sunucular.filter((s) => s.durum !== 'olculdu');
  const kesinFark = apps.some((a) => a.durum === 'farkli' || a.durum === 'eksik');
  const uygulamaSayisi = ayni.length + apps.length;
  // Karsilastirilan uygulama yoksa (her sunucuda bos bolum: dizin yok/okunamadi/baglanti dusmus)
  // "esit" denmez: esitlik iddiasi en az bir uygulamanin her sunucuda ayni gorulmesini ister.
  let hukum = 'esit';
  if (kesinFark) hukum = 'farkli';
  else if (olculmeyen.length > 0 || apps.length > 0 || uygulamaSayisi === 0) hukum = 'olculemedi';
  return {
    id: g.id,
    label: g.label,
    hosts,
    hukum,
    sunucular: sunucular.map(({ pkgs, ...s }) => s),
    sayac: {
      uygulama: uygulamaSayisi,
      ayni: ayni.length,
      farkli: apps.filter((a) => a.durum === 'farkli').length,
      eksik: apps.filter((a) => a.durum === 'eksik').length,
      olculemedi: apps.filter((a) => a.durum === 'olculemedi').length,
      tanimsiz: tanimsiz.length,
      olculen: sunucular.length - olculmeyen.length,
      sunucu: sunucular.length,
    },
    apps,
    ayni,
    tanimsiz,
  };
}

function uygulamaSatiri(key, m, okunan) {
  const [ns, ...rest] = key.split('/');
  const app = rest.join('/');
  const hostlar = okunan.map((s) => s.host);
  const varOlan = hostlar.filter((h) => m.has(h) && m.get(h).durum === 'var');
  const okunamayan = hostlar.filter((h) => m.has(h) && m.get(h).durum === 'okunamadi');
  const yok = hostlar.filter((h) => !varOlan.includes(h) && !okunamayan.includes(h));
  // Kaynagindan eski .gz/.br: gzip_static istemciye eski icerigi sunar (tum sunucularda ayni olsa da).
  const bayatSikistirma = varOlan.filter((h) => (m.get(h).bayatSikistirma || 0) > 0);
  const varyant = new Map(); // imza -> {version, icerik, config, dosya, hosts[]}
  for (const h of varOlan) {
    const p = m.get(h);
    const k = imza(p);
    if (!varyant.has(k))
      varyant.set(k, {
        version: p.version,
        icerik: p.icerik,
        config: p.config,
        dosya: p.dosya,
        hosts: [],
      });
    varyant.get(k).hosts.push(h);
  }
  const varyantlar = [...varyant.values()].sort(
    (a, b) => b.hosts.length - a.hosts.length || String(a.version).localeCompare(String(b.version)),
  );
  const cogunluk = varyantlar[0] || null;
  const fark = [];
  if (varyantlar.length > 1) {
    for (const alan of ['version', 'icerik', 'config']) {
      if (new Set(varyantlar.map((v) => v[alan] || '-')).size > 1) fark.push(alan);
    }
  }
  if (bayatSikistirma.length > 0) fark.push('sikistirma');
  // Sira: eksik (kesin) > farkli (okunabilenler arasinda kesin fark) > olculemedi (okunamayan
  // sunucu varken okunabilenler ayni: esit DENEMEZ) > ayni.
  let durum = 'ayni';
  if (yok.length > 0) durum = 'eksik';
  else if (varyantlar.length > 1 || bayatSikistirma.length > 0) durum = 'farkli';
  else if (okunamayan.length > 0) durum = 'olculemedi';
  return {
    key,
    ns,
    app,
    durum,
    fark,
    yalnizVersion: fark.length === 1 && fark[0] === 'version',
    yok,
    okunamayan,
    bayatSikistirma,
    varyantlar,
    cogunluk,
    sunucular: hostlar.map((h) => {
      const p = m.get(h);
      if (p?.durum === 'var') {
        return {
          host: h,
          version: p.version,
          icerik: p.icerik,
          config: p.config,
          dosya: p.dosya,
          versionZamani: p.versionZamani,
          bayatSikistirma: p.bayatSikistirma || 0,
        };
      }
      if (p?.durum === 'okunamadi') return { host: h, okunamadi: true, version: p.version };
      return { host: h, yok: true };
    }),
  };
}

module.exports = { computePaketTutarlilik, sunucuDurumu, TAZE_SAAT };
