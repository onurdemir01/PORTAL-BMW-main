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
//   2026-11-03 (bant genisligi / bellek ayrisimi, bilgi): adimGorunumu ayrica `ag` (ham.ag camelCase; eski kosu null) ve
//                        `bellekDetay` (ham.bellek_detay + kurala dayali `nedenler`; eski kosu null) ekler. sonucOzeti(adimlar,
//                        analizOzeti, kosuUyarilari) ayrica `agBosta` (ozet.ag_bosta) ve `bellekSizinti` (adimlar boyunca
//                        Anon kurali + analizin nginx_bellek_artisi uyarisi birlesik) verir. Kurallar GORUNUM katmanindadir:
//                        analiz ciktisi ve DB degismez; esikler BELLEK_NEDEN_ESIKLERI.
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

/** 2026-11-03: ham.ag NIC tarafi -> camelCase; olcum yoksa null. */
function nicGorunumu(n) {
  if (!n || typeof n !== 'object' || Array.isArray(n)) return null;
  const o = {
    rxOrtBps: sonlu(n.rx_ort_bps), txOrtBps: sonlu(n.tx_ort_bps), rxMaxBps: sonlu(n.rx_max_bps), txMaxBps: sonlu(n.tx_max_bps),
    hizMbps: sonlu(n.hiz_mbps), kullanimMaxYuzde: sonlu(n.kullanim_max_yuzde),
    arayuz: typeof n.arayuz === 'string' ? n.arayuz.slice(0, 32) : null, secim: typeof n.secim === 'string' ? n.secim.slice(0, 80) : null,
  };
  return o.rxOrtBps !== null || o.txOrtBps !== null ? o : null;
}

/** 2026-11-03: ham.ag -> { testAlinanBps, testGonderilenBps, hedef, yuk }; hic olcum yoksa null (eski kosu). */
function agGorunumu(a) {
  if (!a || typeof a !== 'object' || Array.isArray(a)) return null;
  const o = { testAlinanBps: sonlu(a.test_alinan_bps), testGonderilenBps: sonlu(a.test_gonderilen_bps), hedef: nicGorunumu(a.hedef), yuk: nicGorunumu(a.yuk) };
  return o.testAlinanBps !== null || o.testGonderilenBps !== null || o.hedef || o.yuk ? o : null;
}

/**
 * Bellek ayrisimi kural esikleri (MB; oran). Anon artisi: son - taban >= ANON_MB; dinlenmede inis payi >= INIS_ORAN ->
 * tampon. Shmem / File artisi >= SHMEM_MB / FILE_MB. Sizinti: dinlenme Anon'lari azalmadan artar, toplam artis >= SIZINTI_MB
 * ve >= SIZINTI_ORAN x ilk, her adimda dinlenme >= KALICI_ORAN x son, baglanti ortalamasi en cok / en az <= BAGLANTI_ORAN.
 */
const BELLEK_NEDEN_ESIKLERI = Object.freeze({
  ANON_MB: 5, INIS_ORAN: 0.5, SHMEM_MB: 2, SHMEM_INIS_MB: 1, FILE_MB: 2, SIZINTI_MB: 10, SIZINTI_ORAN: 0.1, KALICI_ORAN: 0.9,
  BAGLANTI_ORAN: 1.5,
});
const E = BELLEK_NEDEN_ESIKLERI;

function noktaGorunumu(x) {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return null;
  return {
    t: sonlu(x.t), anonMb: sonlu(x.anon_mb), shmemMb: sonlu(x.shmem_mb), fileMb: sonlu(x.file_mb), pssMb: sonlu(x.pss_mb),
    baglanti: sonlu(x.baglanti),
  };
}
/** 2026-11-04: nokta ile son arasinda worker kumesi degisti mi (analiz *_isci_degisti; true / false / olculmedi null). */
const evetHayir = (x) => (x === true || x === false ? x : null);
const fark = (a, b) => (a !== null && a !== undefined && b !== null && b !== undefined ? a - b : null);

/**
 * Bir adimin olasi bellek nedenleri (kod listesi; arayuz nedenler.ts ile cumleye cevirir). Veri yetmezse bos liste.
 *  reload: pencerede 'shutting down' worker; tampon: Anon tabandan >= 5 MB artti ve dinlenmede artisin en az yarisi indi
 *  (baglanti tabandan fazla); anon_kalici: Anon artti ama dinlenmede inmedi (tek basina sizinti degil; kosu kurali karar
 *  verir); paylasilan: Shmem tabandan >= 2 MB artti, dinlenmede inmedi (plato); dosya: File tabandan >= 2 MB artti;
 *  artis_yok: olculdu (Anon artisi < ANON_MB), esik ustu artis yok.
 *  2026-11-04 (inceleme B2 / B5): anon_artti_dinlenme_yok: Anon >= ANON_MB artti ama dinlenme olculmedi (bosluk < 3 sn /
 *  kayit erken durdu; 'artis_yok' DEGIL); isci_degisti: taban ya da dinlenme ile son arasinda worker kumesi degisti (reload /
 *  yeniden dogus). Taban degistiyse Anon / Shmem / File kurallari kurulmaz; dinlenme degistiyse dinlenme yok sayilir.
 */
function bellekNedenleri(d) {
  const n = [];
  if (!d) return n;
  if ((d.kapananMax ?? 0) > 0) n.push('reload');
  const { taban, son } = d;
  if (!taban || !son) return n;
  if (d.tabanIsciDegisti === true) {
    n.push('isci_degisti');
    return n;
  }
  const dinlenme = d.dinlenmeIsciDegisti === true ? null : d.dinlenme;
  if (d.dinlenme && d.dinlenmeIsciDegisti === true) n.push('isci_degisti');
  const anon = fark(son.anonMb, taban.anonMb);
  if (anon !== null && anon >= E.ANON_MB) {
    const inis = dinlenme ? fark(son.anonMb, dinlenme.anonMb) : null;
    const bag = d.baglantiOrt === null || taban.baglanti === null || d.baglantiOrt > taban.baglanti;
    if (inis !== null && inis >= E.INIS_ORAN * anon && bag) n.push('tampon');
    else if (inis !== null) n.push('anon_kalici');
    else n.push('anon_artti_dinlenme_yok');
  }
  const sh = fark(son.shmemMb, taban.shmemMb);
  if (sh !== null && sh >= E.SHMEM_MB) {
    const inis = dinlenme ? fark(son.shmemMb, dinlenme.shmemMb) : null;
    if (inis === null || inis < E.SHMEM_INIS_MB) n.push('paylasilan');
  }
  const fi = fark(son.fileMb, taban.fileMb);
  if (fi !== null && fi >= E.FILE_MB) n.push('dosya');
  if (!n.length && anon !== null && anon < E.ANON_MB) n.push('artis_yok');
  return n;
}

/** 2026-11-03: ham.bellek_detay -> camelCase + nedenler; eski kosu null. */
function bellekDetayGorunumu(b) {
  if (!b || typeof b !== 'object' || Array.isArray(b)) return null;
  const d = {
    t0: sonlu(b.t0), anonOrtMb: sonlu(b.anon_ort_mb), pssOrtMb: sonlu(b.pss_ort_mb), baglantiOrt: sonlu(b.baglanti_ort),
    baglantiMax: sonlu(b.baglanti_max), isciMax: sonlu(b.isci_max), kapananMax: sonlu(b.kapanan_max),
    taban: noktaGorunumu(b.taban), son: noktaGorunumu(b.son), dinlenme: noktaGorunumu(b.dinlenme), dinlenmeSn: sonlu(b.dinlenme_sn),
    tabanIsciDegisti: evetHayir(b.taban_isci_degisti), dinlenmeIsciDegisti: evetHayir(b.dinlenme_isci_degisti),
  };
  if (!d.son) return null;
  return { ...d, nedenler: bellekNedenleri(d) };
}

/**
 * 2026-11-03 (bilgi): kosu duzeyi olasi sizinti. Anon kurali (BELLEK_NEDEN_ESIKLERI) + analizin nginx_bellek_artisi uyarisi:
 *  durum 'olasi_sizinti' (kaynak 'anon': Anon kurali tuttu; 'rss': yalniz RSS uyarisi var ve Anon olcumu yok),
 *  'rss_artisi_anon_degil' (RSS uyarisi var ve Anon gercekten iniyor: HER adimda dinlenme olculdu ve her dinlenme Anon'u
 *  <= ilk taban + ANON_MB), 'belirsiz' (2026-11-04, inceleme B1: RSS uyarisi var, Anon kurali karar veremedi; `neden`:
 *  dinlenme_yok (bir adimda dinlenme yok / worker degisti), taban_yok, baglanti_degisti (rampa: en cok / en az > BAGLANTI_ORAN),
 *  anon_inmedi), aksi null.
 */
function bellekSizinti(adimlar, kosuUyarilari) {
  const rss = (Array.isArray(kosuUyarilari) ? kosuUyarilari : []).find((u) => typeof u === 'string' && u.startsWith('nginx_bellek_artisi(')) || null;
  const d = adimlar.map((a) => a.bellekDetay).filter((x) => x && x.t0 !== null && x.son && x.son.anonMb !== null).sort((x, y) => x.t0 - y.t0);
  const anonVar = d.length > 0;
  let anon = false;
  const din = d.filter((x) => x.dinlenme && x.dinlenme.anonMb !== null && x.dinlenmeIsciDegisti !== true);
  const tumu = anonVar && din.length === d.length;
  const bag = din.map((x) => x.baglantiOrt).filter((x) => x !== null && x > 0);
  const sabit = bag.length < 2 || Math.max(...bag) / Math.min(...bag) <= E.BAGLANTI_ORAN;
  const t0 = anonVar && d[0].taban && d[0].tabanIsciDegisti !== true ? d[0].taban.anonMb : null;
  if (din.length >= 2 && tumu) {
    const v = din.map((x) => x.dinlenme.anonMb);
    const artan = v.every((x, i) => i === 0 || x >= v[i - 1]);
    const ilk = t0 !== null ? t0 : v[0];
    const toplam = v[v.length - 1] - ilk;
    const kalici = din.every((x) => x.dinlenme.anonMb >= E.KALICI_ORAN * x.son.anonMb);
    anon = artan && kalici && sabit && toplam >= E.SIZINTI_MB && toplam >= E.SIZINTI_ORAN * ilk;
  }
  if (anon) return { durum: 'olasi_sizinti', kaynak: 'anon', rssUyarisi: rss };
  if (rss && !anonVar) return { durum: 'olasi_sizinti', kaynak: 'rss', rssUyarisi: rss };
  if (!rss) return null;
  let neden = null;
  if (!tumu) neden = 'dinlenme_yok';
  else if (t0 === null) neden = 'taban_yok';
  else if (!din.every((x) => x.dinlenme.anonMb <= t0 + E.ANON_MB)) neden = sabit ? 'anon_inmedi' : 'baglanti_degisti';
  if (neden) return { durum: 'belirsiz', kaynak: 'anon', rssUyarisi: rss, neden };
  return { durum: 'rss_artisi_anon_degil', kaynak: 'anon', rssUyarisi: rss };
}

/** 2026-11-03: ozet.ag_bosta -> camelCase; yoksa null. */
function agBostaGorunumu(x) {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return null;
  const taraf = (t) => {
    if (!t || typeof t !== 'object') return null;
    const o = {
      rxBps: sonlu(t.rx_bps), txBps: sonlu(t.tx_bps), sn: sonlu(t.sn), hizMbps: sonlu(t.hiz_mbps),
      arayuz: typeof t.arayuz === 'string' ? t.arayuz.slice(0, 32) : null, secim: typeof t.secim === 'string' ? t.secim.slice(0, 80) : null,
    };
    return o.rxBps !== null || o.txBps !== null ? o : null;
  };
  const o = { hedef: taraf(x.hedef), yuk: taraf(x.yuk) };
  return o.hedef || o.yuk ? o : null;
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
  const durum = (() => { if (durumlar.includes('uyari')) return 'uyari'; if (durumlar.includes('tamam')) return 'tamam'; return 'olculmedi'; })();
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
    // 2026-11-03 (bilgi): bant genisligi ve bellek ayrisimi (eski kosu null).
    ag: agGorunumu(ham && ham.ag),
    bellekDetay: bellekDetayGorunumu(ham && ham.bellek_detay),
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
function sonucOzeti(adimlar, analizOzeti, kosuUyarilari = []) {
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
    // 2026-11-03 (bilgi): bosta NIC tabani ve olasi bellek sizintisi (eski kosu null).
    agBosta: agBostaGorunumu(oz && oz.ag_bosta),
    bellekSizinti: bellekSizinti(liste, kosuUyarilari),
  };
}

const GERI_ALMA_DURUMLARI = new Set(['ok', 'uyari', 'hata']);
const GERI_ALMA_SONUCU_YOK = 'Geri alma sonucu yok: iş temizlik adımına ulaşmadan bitmiş (AWX zaman aşımı, iptal ya da hata) ve hedefteki nginx ayarı değişmiş kalmış olabilir. Durdur ile geri alın.';

/**
 * Kosu ayrintisinin "Sunucu ayari" satiri (yalniz parametreler.sunucuAyar dolu kosu; yoksa null). Istenen kanonik
 * parametreden; kanit analizin ozetinden (ozet.sunucu_ayar, on kontrolde yok); geri alma set_stats'tan (sunucu_ayar.geri_alma:
 * 'ok' | 'uyari' | 'hata', metni geri_alma_metin). Bilinmeyen geri alma durumu 'hata' sayilir (sessizce yutulmaz).
 * `satir` ({ terminal, isVar, durdurIs }): is AWX'e gitti ve bitti ama geri alma sonucu yoksa 'hata' (Play 7 kosmamis olabilir);
 * durdurma isi sonucu bekleniyorsa 'bekliyor'. Durdurma isinin sonucu (sonuc.durdur_geri_alma, poller yazar; `is` satirdaki is)
 * ana isin sonucunun ONUNE gecer. `uyarilar`: on kontrolde de gorunsun diye kanit + set_stats uyarilari.
 */
function sunucuAyari(p, sonucOzet, analizOzeti, satir = {}) {
  const sa = p && typeof p === 'object' ? p.sunucuAyar : null;
  if (!sa || typeof sa !== 'object') return null;
  const nesne = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);
  const k = nesne(nesne(analizOzeti) && analizOzeti.sunucu_ayar);
  const st = nesne(nesne(sonucOzet) && sonucOzet.sunucu_ayar);
  const ga = st && typeof st.geri_alma === 'string' ? st.geri_alma.trim().toLowerCase() : '';
  const metin = st && typeof st.geri_alma_metin === 'string' ? st.geri_alma_metin.slice(0, 500) : null;
  const dgr = nesne(nesne(sonucOzet) && sonucOzet.durdur_geri_alma);
  const durdurIs = satir.durdurIs == null ? null : Number(satir.durdurIs);
  let geriAlma = (() => { if (ga) return { durum: GERI_ALMA_DURUMLARI.has(ga) ? ga : 'hata', metin }; return null; })();
  if (dgr && (durdurIs === null || Number(dgr.is) === durdurIs)) {
    geriAlma = { durum: GERI_ALMA_DURUMLARI.has(dgr.durum) ? dgr.durum : 'hata', metin: typeof dgr.metin === 'string' ? dgr.metin.slice(0, 500) : null };
  } else if (satir.terminal && durdurIs !== null && (!geriAlma || geriAlma.durum === 'hata')) {
    geriAlma = { durum: 'bekliyor', metin: `Geri alma durdurma işinde (AWX #${durdurIs}); sonucu bekleniyor.` };
  } else if (satir.terminal && satir.isVar && !geriAlma) {
    geriAlma = { durum: 'hata', metin: GERI_ALMA_SONUCU_YOK };
  }
  const liste = (v) => (Array.isArray(v) ? v.map((x) => String(x).slice(0, 300)) : []);
  const uyarilar = [...new Set([...liste(k && k.uyarilar), ...liste(st && st.uyarilar)])].slice(0, 20);
  return {
    http2: p.protokol === 'h2',
    ae: p.ae ?? null,
    seviye: sonlu(sa.seviye),
    static: sa.static === true,
    dizin: typeof sa.dizin === 'string' ? sa.dizin : null,
    kanit: (() => { if (k) return {
      durum: k.durum === 'uyumlu' ? 'uyumlu' : 'kanitsiz',
      sapmalar: Array.isArray(k.sapmalar) ? k.sapmalar.map(String).slice(0, 10) : [],
      gzUretilen: sonlu(k.gz_uretilen),
      brUretilen: sonlu(k.br_uretilen),
      atlanan: sonlu(k.atlanan),
      uyarilar: Array.isArray(k.uyarilar) ? k.uyarilar.map(String).slice(0, 20) : [],
    }; return null; })(),
    geriAlma,
    uyarilar,
  };
}

module.exports = {
  sunucuAyari,
  adimGorunumu, sonucOzeti, kipDogrulama, bellekGorunumu, agGorunumu, bellekDetayGorunumu, bellekNedenleri, bellekSizinti,
  BELLEK_NEDEN_ESIKLERI, RELOAD_NEDENI, KIP_KALIPLARI,
};
