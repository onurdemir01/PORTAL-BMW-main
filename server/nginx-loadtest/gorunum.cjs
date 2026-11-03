// server/nginx-loadtest/gorunum.cjs -- Yuk Testi kosu ayrintisinin GORUNUM alanlari (sade turu, 2026-11-02).
//
// GET /kosular/:id icin saf yardimcilar (DB yok, saat yok):
//   adimGorunumu(adim) : API adim satirina (camelCase, nedenler / ham cozulmus) cpuOlculemedi, reloadlar,
//                        yukCpuBosta (yuk makinesi bosta CPU %, ham.yuk_cpu_bosta; eski kosu null) ve yukDoydu
//                        (nedenlerde doyma:yuk_cpu_bosta_; 2026-11-03), yukCpuOlculemedi (ham.yuk_cpu_olculemedi) ekler; CPU-ms/istek ve kapasite ASLA negatif ya da 0 donmez. Eski satirda (sade
//                        turundan once analiz edilmis, ornek ilk gercek kosu R2) DB'deki negatif / 0 deger
//                        ve nedenlerinde reload olan satirin CPU degeri null'a cevrilir; DB degismez.
//   2026-11-03: adimGorunumu(adim, { motor, hedefTuru, protokol }) ayrica `bellek` (ham.bellek camelCase; eski kosu null)
//                        ve `kipDogrulama` (istenen / gerceklesen: protokol, baglanti, sikistirma; kipDogrulama) ekler.
//                        Kip dogrulamasi analiz ciktisini DEGISTIRMEZ: DB'deki eski adimin ham alanlarindan da kurulur
//                        (ham.protokol / http2 / yeniden_baglanti_yuzde; sikistirma yalniz ham.kodlama varsa).
//   sonucOzeti(adimlar, analizOzeti) : kosu duzeyi ozet satiri (toplam istek, en iyi / en kotu p95, 429,
//                        5xx, hata orani, CPU'su olculemeyen adim, konf degisimi, reload olaylari).
// Sozlesme: scratchpad sade_sozlesme.md 1-2 (arayuz bu adlari okur). Eksik alan null / [] (eski kosular).
'use strict';

const RELOAD_NEDENI = 'reload(worker_pid_degisti)';
const CPU_KODLARI = new Set(['reload', 'sayac_geriledi', 'net_negatif']);
const FAZLAR = new Set(['isinma', 'olcum', 'olcum_kenari', 'bosluk', 'kosu_oncesi']);
const MAX_RELOAD = 50;
const TUR_RE = /^[A-Za-z0-9_-]{1,120}$/;
const YUK_DOYMA_ONEKI = 'doyma:yuk_cpu_bosta_';
const yukDoyduMu = (a) => Array.isArray(a && a.nedenler) && a.nedenler.some((n) => typeof n === 'string' && n.startsWith(YUK_DOYMA_ONEKI));

const sonlu = (x) => (typeof x === 'number' && Number.isFinite(x) ? x : null);
// Kip dogrulamasi esikleri (bilgi; gecerlilik DEGISMEZ): ka kipinde yeni baglantidaki istek payi (%), istenen kodlamanin
// 1 KB ustu yanitlardaki payi (%). analiz.cjs'in yeni kip %5 uyarisi (yeni_kipinde_baglanti_yeniden_kullanilmis_) aynen.
const KIP_KA_YENI_ESIK = 20;
const KIP_SIKISTIRMA_ESIK = 50;
const YENI_YENIDEN_ESIK = 5;
const KODLAMA_ADLARI = Object.freeze(['br', 'gzip', 'deflate', 'zstd', 'yok', 'diger']);
const AE_KODLAMA = Object.freeze({ br: 'br', gzip: 'gzip', identity: 'yok' });
const YENI_UYARI_ONEKI = 'yeni_kipinde_baglanti_yeniden_kullanilmis_%';
/** Kip dogrulamasi uyari kodlari (arayuz nedenler.ts ile duz cumleye esler; testte her kod icin ornek kilitli). */
const KIP_KALIPLARI = Object.freeze([
  { kod: 'kip_protokol', re: /^kip_protokol\(istenen=(h1|h2),olculen=(h1|h2),uyumsuz=(\d+)\)$/ },
  { kod: 'kip_ka_yeni_baglanti', re: /^kip_ka_yeni_baglanti_%(\d+)$/ },
  { kod: 'kip_yeni_yeniden_kullanim', re: /^yeni_kipinde_baglanti_yeniden_kullanilmis_%(\d+)$/ },
  { kod: 'kip_sikistirma_az', re: /^kip_sikistirma_az\(istenen=(br|gzip),%([0-9]+\.[0-9])\)$/ },
  { kod: 'kip_sikistirma_beklenmeyen', re: /^kip_sikistirma_beklenmeyen\(istenen=identity,%([0-9]+\.[0-9])\)$/ },
]);
/** Tek ondaliga asagi, '.' ile (19.96 -> '19.9'). */
const ondalikAsagi = (x) => (Math.floor(x * 10 + 1e-9) / 10).toFixed(1);
const tamSayiVeyaNull = (x) => (typeof x === 'number' && Number.isInteger(x) && x >= 0 ? x : null);
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

/** ham.bellek -> camelCase (sayi degilse null); hic alan yoksa null (eski kosu). */
function bellekGorunumu(b) {
  if (!b || typeof b !== 'object' || Array.isArray(b)) return null;
  const o = {
    nginxRssOrtMb: sonlu(b.nginx_rss_ort_mb), nginxRssMaxMb: sonlu(b.nginx_rss_max_mb),
    hedefBellekYuzde: sonlu(b.hedef_bellek_yuzde), hedefBosMinYuzde: sonlu(b.hedef_bos_min_yuzde),
    yukBellekYuzde: sonlu(b.yuk_bellek_yuzde), yukBosMinYuzde: sonlu(b.yuk_bos_min_yuzde), aracRssMaxMb: sonlu(b.arac_rss_max_mb),
  };
  return Object.values(o).some((v) => v !== null) ? o : null;
}

/**
 * Kip dogrulamasi (2026-11-03, YALNIZ BILGI): istenen / gerceklesen. Her bolumun durumu 'tamam' | 'uyari' | 'olculmedi';
 * genel durum: bir uyari varsa 'uyari', yoksa bir tamam varsa 'tamam', yoksa 'olculmedi'.
 *  - protokol: k6 istemci satiri (ham.protokol / protokol_uyumsuz; kolonsuz eski satirda ham.http2 > 0 -> h2). wrk olcmez.
 *  - baglanti: nginx logu (ham.yeniden_baglanti_yuzde; yeni baglanti payi = 100 - yeniden, istek / baglanti = 100 / pay).
 *    yeni kipte analizin %5 uyarisi AYNEN; ka kipinde pay > %20 uyari. Serbest hedefte log yok: olculmedi.
 *  - sikistirma: ham.kodlama (yalniz yeni yuk_k6.js). br / gzip: 1 KB ustu yanitlarin (n - yok_1kb_alti) < %50'si istenen
 *    kodlamada ise uyari; identity: sikistirilmis yanit varsa uyari. wrk / eski k6: olculmedi.
 */
function kipDogrulama(a, { motor = 'k6', hedefTuru = 'sunucu', protokol = 'h1' } = {}) {
  const ham = a && a.ham && typeof a.ham === 'object' && !Array.isArray(a.ham) ? a.ham : {};
  const uyarilar = [];
  const p = { istenen: protokol === 'h2' ? 'h2' : 'h1', olculen: null, uyumsuz: null, durum: 'olculmedi' };
  if (motor !== 'wrk') {
    if (ham.protokol === 'h1' || ham.protokol === 'h2') {
      p.olculen = ham.protokol;
      p.uyumsuz = sonlu(ham.protokol_uyumsuz);
    } else if (sonlu(ham.http2) !== null) {
      p.olculen = ham.http2 > 0 ? 'h2' : 'h1';
    }
    if (p.olculen !== null) {
      const tamam = p.olculen === p.istenen && !(p.uyumsuz > 0);
      p.durum = tamam ? 'tamam' : 'uyari';
      if (!tamam) uyarilar.push(`kip_protokol(istenen=${p.istenen},olculen=${p.olculen},uyumsuz=${Math.trunc(p.uyumsuz || 0)})`);
    }
  }
  const kip = a && (a.kip === 'yeni' || a.kip === 'ka') ? a.kip : null;
  const b = { istenen: kip, yeniBaglantiYuzde: null, istekBaglanti: null, durum: 'olculmedi' };
  const yeniden = sonlu(ham.yeniden_baglanti_yuzde);
  if (hedefTuru !== 'serbest' && yeniden !== null && kip) {
    b.yeniBaglantiYuzde = Math.min(100, Math.max(0, 100 - yeniden));
    b.istekBaglanti = b.yeniBaglantiYuzde > 0 ? 100 / b.yeniBaglantiYuzde : null;
    if (kip === 'yeni') {
      const mevcut = (Array.isArray(ham.uyarilar) ? ham.uyarilar : []).find((u) => typeof u === 'string' && u.startsWith(YENI_UYARI_ONEKI));
      const fazla = !!mevcut || yeniden > YENI_YENIDEN_ESIK;
      if (fazla) uyarilar.push(mevcut || `${YENI_UYARI_ONEKI}${Math.round(yeniden)}`);
      b.durum = fazla ? 'uyari' : 'tamam';
    } else {
      const fazla = b.yeniBaglantiYuzde > KIP_KA_YENI_ESIK;
      if (fazla) uyarilar.push(`kip_ka_yeni_baglanti_%${Math.round(b.yeniBaglantiYuzde)}`);
      b.durum = fazla ? 'uyari' : 'tamam';
    }
  }
  const ae = a && typeof a.ae === 'string' ? a.ae : null;
  const k = { istenen: ae, n: null, dagilim: null, yok1kbAlti: null, kucukYuzde: null, istenenYuzde: null, durum: 'olculmedi' };
  const kod = ham.kodlama && typeof ham.kodlama === 'object' && !Array.isArray(ham.kodlama) ? ham.kodlama : null;
  const istenen = AE_KODLAMA[ae];
  if (motor !== 'wrk' && kod && istenen) {
    const dagilim = {};
    let n = 0;
    for (const ad of KODLAMA_ADLARI) {
      dagilim[ad] = tamSayiVeyaNull(kod[ad]) ?? 0;
      n += dagilim[ad];
    }
    if (n > 0) {
      const kucuk = Math.min(dagilim.yok, tamSayiVeyaNull(kod.yok_1kb_alti) ?? 0);
      Object.assign(k, { n, dagilim, yok1kbAlti: kucuk, kucukYuzde: (100 * kucuk) / n, durum: 'tamam' });
      if (istenen === 'yok') {
        const sik = dagilim.br + dagilim.gzip + dagilim.deflate + dagilim.zstd;
        k.istenenYuzde = (100 * dagilim.yok) / n;
        if (sik > 0) {
          uyarilar.push(`kip_sikistirma_beklenmeyen(istenen=identity,%${ondalikAsagi((100 * sik) / n)})`);
          k.durum = 'uyari';
        }
      } else {
        const buyuk = n - kucuk;
        k.istenenYuzde = buyuk > 0 ? (100 * dagilim[istenen]) / buyuk : null;
        if (k.istenenYuzde !== null && k.istenenYuzde < KIP_SIKISTIRMA_ESIK) {
          uyarilar.push(`kip_sikistirma_az(istenen=${istenen},%${ondalikAsagi(k.istenenYuzde)})`);
          k.durum = 'uyari';
        }
      }
    }
  }
  const durumlar = [p.durum, b.durum, k.durum];
  const durum = durumlar.includes('uyari') ? 'uyari' : durumlar.includes('tamam') ? 'tamam' : 'olculmedi';
  return { protokol: p, baglanti: b, sikistirma: k, uyarilar, durum };
}

/** API adim satiri (adimApi ciktisi) -> ayni satir + cpuOlculemedi + reloadlar; CPU / kapasite > 0 ya da null. */
function adimGorunumu(a, secenek = {}) {
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
    yukCpuBosta: ham ? sonlu(ham.yuk_cpu_bosta) : null,
    // B1: yeni playbook (kayit bekleniyordu) ama bu adimda olcum yok; eski kosu false.
    yukCpuOlculemedi: !!(ham && ham.yuk_cpu_olculemedi === true),
    yukDoydu: yukDoyduMu(a),
    // 2026-11-03 (bilgi): bellek (eski kosu null) ve kip dogrulamasi (istenen / gerceklesen).
    bellek: bellekGorunumu(ham && ham.bellek),
    kipDogrulama: kipDogrulama(a, secenek),
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
 * p95 en iyi / en kotu GECERLI + DOYMA adimlardan (yuk makinesi doymus adim HARIC, 2026-11-03); hic yoksa p95'i olan
 * tum satirlardan (p95Kapsam 'tum'). yukDoyduAdim: YUK_DOYDU isaretli adim sayisi.
 */
function sonucOzeti(adimlar, analizOzeti) {
  const liste = Array.isArray(adimlar) ? adimlar : [];
  const gecerli = liste.filter((a) => a.gecerlilik === 'GECERLI' || a.gecerlilik === 'DOYMA');
  const p95li = (xs) => xs.filter((a) => sonlu(a.p95) !== null);
  let kapsam = null;
  let aday = p95li(gecerli.filter((a) => !yukDoyduMu(a)));
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
    yukDoyduAdim: liste.filter(yukDoyduMu).length,
    konfDegisti: kesitler ? kesitler.some((k) => k && k.konf_degisti === true) : null,
    reloadlar: reloadlar.slice(0, MAX_RELOAD),
  };
}

module.exports = { adimGorunumu, sonucOzeti, kipDogrulama, bellekGorunumu, RELOAD_NEDENI, KIP_KALIPLARI };
