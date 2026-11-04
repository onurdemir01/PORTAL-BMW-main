// server/nginx-loadtest/rapor.cjs -- Yuk Testi "Toplu rapor" (2026-11-04): en cok 100 kosu, tek tablo.
//
// Kullanici: "30 kosuyu tek raporda isterim." GET /rapor'un SAF hesabidir (DB yok, saat yok). Karsilastirma / karar YAPMAZ;
// olculmus degerleri satira dizer. Yeni olcu uretmez: alanlar adim satirlari (gorunum.adimGorunumu), analiz.hizOzeti ve kosu
// parametrelerinden okunur. Satir = kosu x hiz; kombo kosunun kendi kombosu (bir kosu tek senaryo / kip / ae kosar).
//   * Olcu kolonlari: tekrarlarin ortalamasi. Kume coklu.cjs ile ayni: gecerli adimlar, yuk makinesi doymus adim haric.
//     Hic gecerli adim yoksa TUM adimlar (olculmus deger gizlenmez; `gecerlilik` soyler). Tek tekrarda adimin kendisi.
//   * Sayac kolonlari (toplam istek, 429, 5xx, atilan): tekrarlarin TOPLAMI, adi "toplam"; `tekrar` kolonu ile okunur.
//   * NIC en yuksek: tekrarlarin en yuksegi.
//   * CPU-ms/istek ve kapasite: kararVer'in CPU kumesi (DOYMA adimlar disarida); gorunum null'lari olculmedi demektir.
//   * Olculmeyen null. Sunucu ayari kolonlari ayarsiz (eski) kosuda '-'.
//   * Kosu duzeyi gecersizlik (TUR'suz neden, ornek sunucu_ayari_kanitsiz) satiri da gecersiz yapar: adimlar gecerli
//     gorunse bile olcum yanlis ayarin olcumudur. TUR'lu neden yalniz kendi adiminin satirindadir.
//   * Atlananlar: bulunamayan, on kontrol, bitmemis, olcumu olmayan, hesaplanamayan kosu ve kosusu baslamamis kuyruk ogesi
//     `atlananlar`da nedeniyle listelenir; sessizce dusmez.
// Static dosya seviyesi: hazirlik kanitinin dosya_seviye'si (hazirlik.sh dosyalari her kosuda secilen seviyeyle yeniden uretir;
// seviyesiz identity + gzip_static 9). Kanit yoksa secilen seviye, o da yoksa 9; kanitsiz kosu zaten GECERSIZ (analiz.cjs).
// Symlink ve bos kaynak uretilmez (atlanan): sayilar gz/br uretilen kolonundadir.
'use strict';

const MAX_KOSU = 100;
const YOK = '-';
const STATIK_VARSAYILAN_SEVIYE = 9;
const OLCUM_DURUMLARI = new Set(['GECERLI', 'DOYMA', 'GECERSIZ']);
const GECERLI = new Set(['GECERLI', 'DOYMA']);
const MAX_NEDEN = 20;

const sonlu = (x) => (typeof x === 'number' && Number.isFinite(x) ? x : null);
const nesne = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);
const degerler = (xs) => xs.map(sonlu).filter((x) => x !== null);
const ortalama = (xs) => {
  const v = degerler(xs);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
};
const toplam = (xs) => {
  const v = degerler(xs);
  return v.length ? v.reduce((a, b) => a + b, 0) : null;
};
const enCok = (xs) => {
  const v = degerler(xs);
  return v.length ? Math.max(...v) : null;
};
const tekil = (xs) => [...new Set(xs.filter((x) => typeof x === 'string' && x !== ''))].slice(0, MAX_NEDEN);
const zamanMs = (s) => {
  const t = s instanceof Date ? s.getTime() : Date.parse(String(s ?? ''));
  return Number.isFinite(t) ? t : null;
};

/** Hazirlik kaniti disk_kanit: metin aynen, nesne `durum`u ya da JSON'u, mantiksal 'evet' / 'hayir'; yoksa null. */
function diskKanitMetni(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'boolean') return v ? 'evet' : 'hayir';
  if (typeof v === 'object') return String(v.durum ?? JSON.stringify(v)).slice(0, 300);
  return String(v).slice(0, 300);
}

/**
 * Seviye / static kolonlari: istenen parametreler.sunucuAyar, kanit varsa diskteki deger (uyumsuzsa satir zaten gecersiz).
 * Ayarsiz kosuda hepsi '-'. Seviye yalniz secilen sikistirmanin konfunda degisir; static acikken brotli kosusu .br, gzip ve
 * sikistirmasiz kosu .gz sunar (hazirlik.sh).
 */
function sunucuAlanlari(parametreler, analizOzeti) {
  const sa = nesne(nesne(parametreler) && parametreler.sunucuAyar);
  if (!sa) {
    return {
      brotliSeviye: YOK, gzipSeviye: YOK, gzipStatikSeviye: YOK, gzipStatik: YOK, brotliStatikSeviye: YOK, brotliStatik: YOK,
      gzUretilen: null, brUretilen: null, diskKanit: null,
    };
  }
  const k = nesne(nesne(analizOzeti) && analizOzeti.sunucu_ayar);
  const seviye = sonlu(k && k.seviye) ?? sonlu(sa.seviye);
  const statik = k && typeof k.static === 'boolean' ? k.static : sa.static === true;
  const br = parametreler.ae === 'br';
  const gzStatik = statik && !br;
  const brStatik = statik && br;
  const dosyaSeviye = sonlu(k && k.dosya_seviye) ?? seviye ?? STATIK_VARSAYILAN_SEVIYE;
  return {
    brotliSeviye: br ? seviye ?? YOK : YOK,
    gzipSeviye: parametreler.ae === 'gzip' ? seviye ?? YOK : YOK,
    gzipStatikSeviye: gzStatik ? dosyaSeviye : YOK,
    gzipStatik: gzStatik,
    brotliStatikSeviye: brStatik ? dosyaSeviye : YOK,
    brotliStatik: brStatik,
    gzUretilen: sonlu(k && k.gz_uretilen),
    brUretilen: sonlu(k && k.br_uretilen),
    diskKanit: diskKanitMetni(k && k.disk_kanit),
  };
}

/** TUR'suz kosu nedenleri (kosu geneli). "<TUR>(...)" bicimi adimin nedenidir; adim satirinda zaten var. */
const kosuGeneliNedenler = (liste) => (Array.isArray(liste) ? liste : []).filter((s) => typeof s === 'string' && !/^R\d+_[A-Za-z0-9_-]+\(/.test(s));

function kipOzeti(satir) {
  const d = satir.map((a) => (a.kipDogrulama && a.kipDogrulama.durum) || 'olculmedi');
  return d.includes('uyari') ? 'uyari' : d.includes('tamam') ? 'tamam' : 'olculmedi';
}

function bellekArtisi(d) {
  if (!d || d.tabanIsciDegisti === true || !d.taban || !d.son) return null;
  const son = sonlu(d.son.anonMb);
  const taban = sonlu(d.taban.anonMb);
  return son === null || taban === null ? null : son - taban;
}

/** Bir kosunun bir hizdaki satiri. `g`: analiz.hizOzeti grubu; `satir`: ayni kombo + hizdaki gorunum adimlari. */
function raporSatiri(k, kombo, hiz, g, satir, ortak) {
  const gecerli = satir.filter((a) => GECERLI.has(a.gecerlilik));
  const doymamis = gecerli.filter((a) => !a.yukDoydu);
  const kume = doymamis.length ? doymamis : gecerli.length ? gecerli : satir;
  const al = (f, xs = kume) => xs.map(f);
  const ort = (alan) => ortalama(al((a) => a[alan]));
  const cpuVar = gecerli.length > 0;
  const pss = ortalama(al((a) => a.bellekDetay && a.bellekDetay.pssOrtMb));
  const rss = pss === null ? ortalama(al((a) => a.bellek && a.bellek.nginxRssOrtMb)) : null;
  const m = k.meta;
  const durumKodu = /^[A-Z]+/.exec(String(g.durum || ''));
  return {
    kosuNo: m.id,
    etiket: m.etiket,
    hiz,
    protokol: m.protokol,
    kip: kombo.kip,
    ae: kombo.ae,
    brotliSeviye: ortak.sunucu.brotliSeviye,
    gzipSeviye: ortak.sunucu.gzipSeviye,
    gzipStatikSeviye: ortak.sunucu.gzipStatikSeviye,
    gzipStatik: ortak.sunucu.gzipStatik,
    brotliStatikSeviye: ortak.sunucu.brotliStatikSeviye,
    brotliStatik: ortak.sunucu.brotliStatik,
    toplamIstek: toplam(al((a) => a.nIstek, satir)),
    p50: ort('p50'),
    p95: ort('p95'),
    p99: ort('p99'),
    hostCpu: ort('hostCpuOrt'),
    bantBps: ortalama(al((a) => a.ag && a.ag.testAlinanBps)),
    tarih: m.createdAt,
    sureSn: ortak.sureSn,
    durum: m.durum,
    gecerlilik: ortak.kosuNedenleri.length && m.gecerlilik === 'GECERSIZ' ? 'GECERSIZ' : durumKodu ? durumKodu[0] : null,
    tekrar: g.n_kosu,
    gecerliTekrar: g.n_gecerli,
    gercekRps: ort('gercekRps'),
    nedenler: tekil(satir.flatMap((a) => (Array.isArray(a.nedenler) ? a.nedenler : []))),
    uyarilar: tekil(satir.flatMap((a) => [
      ...(a.ham && Array.isArray(a.ham.uyarilar) ? a.ham.uyarilar : []),
      ...(a.kipDogrulama && Array.isArray(a.kipDogrulama.uyarilar) ? a.kipDogrulama.uyarilar : []),
    ])),
    kosuNedenleri: ortak.kosuNedenleri,
    kipDogrulama: kipOzeti(satir),
    ttfbP95: ort('ttfbP95'),
    tlsP95: ort('tlsP95'),
    connectP95: ort('connectP95'),
    sunucuP95: ort('srtP95'),
    hataOrani: ort('hataOrani'),
    n429: toplam(al((a) => a.n429, satir)),
    n5xx: toplam(al((a) => a.n5xx, satir)),
    atilan: toplam(al((a) => a.dropped, satir)),
    cpuMsIstek: cpuVar ? (sonlu(g.cpu_ms_istek) > 0 ? g.cpu_ms_istek : null) : ortalama(al((a) => a.cpuMsIstek, satir)),
    kapasite: ortalama(al((a) => a.kapasiteRps, cpuVar ? satir.filter((a) => a.gecerlilik === 'GECERLI') : satir)),
    bellekMb: pss !== null ? pss : rss,
    bellekKaynak: pss !== null ? 'pss' : rss !== null ? 'rss' : null,
    bellekArtisiMb: ortalama(al((a) => bellekArtisi(a.bellekDetay))),
    bellekNedenleri: tekil(satir.flatMap((a) => (a.bellekDetay && Array.isArray(a.bellekDetay.nedenler) ? a.bellekDetay.nedenler : []))),
    bellekSizinti: ortak.bellekSizinti,
    testGonderilenBps: ortalama(al((a) => a.ag && a.ag.testGonderilenBps)),
    nicOrtBps: ortalama(al((a) => a.ag && a.ag.hedef && a.ag.hedef.txOrtBps)),
    nicMaxBps: enCok(al((a) => a.ag && a.ag.hedef && a.ag.hedef.txMaxBps)),
    baytIstek: ort('baytIstek'),
    yukCpuBosta: ortalama(al((a) => a.yukCpuBosta, satir)),
    yukBellekYuzde: ortalama(al((a) => a.bellek && a.bellek.yukBellekYuzde, satir)),
    yukDoydu: satir.some((a) => a.yukDoydu === true),
    gzUretilen: ortak.sunucu.gzUretilen,
    brUretilen: ortak.sunucu.brUretilen,
    diskKanit: ortak.sunucu.diskKanit,
  };
}

/** Tek kosunun satirlari (hiz artan); olcum yoksa bos dizi. */
function kosuSatirlari(k, { analiz, gorunum }) {
  const hazir = k.gorunumAdimlari.filter((a) => OLCUM_DURUMLARI.has(a.gecerlilik));
  if (!hazir.length) return [];
  const { kombo, gruplar } = analiz.hizOzeti(k.analizAdimlari);
  const bas = zamanMs(k.startedAt);
  const son = zamanMs(k.finishedAt);
  const ortak = {
    sunucu: sunucuAlanlari(k.parametreler, k.analizOzeti),
    sureSn: bas !== null && son !== null && son >= bas ? Math.round((son - bas) / 1000) : null,
    kosuNedenleri: tekil(kosuGeneliNedenler(k.gecersizNedenleri)),
    bellekSizinti: gorunum.bellekSizinti(k.gorunumAdimlari, k.kosuUyarilari),
  };
  return [...gruplar.keys()].sort((a, b) => a - b).map((hiz) => raporSatiri(
    k, kombo, hiz, gruplar.get(hiz),
    hazir.filter((a) => a.senaryo === kombo.senaryo && a.kip === kombo.kip && a.ae === kombo.ae && Math.trunc(Number(a.hiz)) === hiz),
    ortak,
  ));
}

/**
 * @param {{ kosular: object[], analiz: object, gorunum: object }} p kosular istek sirasiyla; her biri
 *   { meta, parametreler, analizAdimlari, gorunumAdimlari, analizOzeti, kosuUyarilari, gecersizNedenleri, startedAt, finishedAt }.
 * @returns {{ satirlar: object[], atlananlar: object[] }} atlananlar: { kosuId, etiket, neden: 'olcum_yok' | 'hesaplanamadi' }.
 */
function raporKur({ kosular, analiz, gorunum }) {
  const satirlar = [];
  const atlananlar = [];
  for (const k of kosular) {
    let s;
    try {
      s = kosuSatirlari(k, { analiz, gorunum });
    } catch {
      atlananlar.push({ kosuId: k.meta.id, etiket: k.meta.etiket, neden: 'hesaplanamadi', durum: k.meta.durum });
      continue;
    }
    if (s.length) satirlar.push(...s);
    else atlananlar.push({ kosuId: k.meta.id, etiket: k.meta.etiket, neden: 'olcum_yok', durum: k.meta.durum });
  }
  return { satirlar, atlananlar };
}

module.exports = { raporKur, sunucuAlanlari, diskKanitMetni, MAX_KOSU, STATIK_VARSAYILAN_SEVIYE, YOK };
