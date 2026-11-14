// server/server-hub/ear-envanter-eslenik.cjs - Uygulama Envanteri eslenik motoru (2026-11-05).
//
// Kullanici kararlari (anket, 2026-11-05):
//   - Uc tur: ORTAM ICI (ayni EAR + ayni ortam + ayni JBoss nesli, en az iki sunucu), ORTAMLAR ARASI
//     (ayni EAR + ayni nesil, en az iki ortam) ve NESIL (ayni sunucuda ayni EAR hem 7 hem 8).
//   - Ortami bos kopya KARSILASTIRILMAZ ("ortam bilinmiyor" listesi). Ortam trim + BUYUK harf.
//   - Tarih farki karari engellemez; gun olarak yazilir.
//   - Ayni jar, ayni surum, farkli boyut: ayri karar AYNI_SURUM_FARKLI_DOSYA.
//
// IKI BAGIMSIZ SONUC: kutuphane (AYNI | FARKLI | AYNI_SURUM_FARKLI_DOSYA | KARSILASTIRILAMADI) ve yapi
// (AYNI | FARKLI | KARSILASTIRILAMADI). Grup karari en kotusudur. Bir kopya bile TAM degilse ikisi de
// KARSILASTIRILAMADI (eksik veri "ayni" ya da "farkli" sayilmaz).
//
// KIP FARKI ENGEL DEGIL: tarayicinin yapi izi (yol + tip) ve kutuphane boyutu iki kipte de ayni olculur
// (ear_tara.py: yapi.ekle(rel, tip); OZET de jar'a lstat yapar).
//
// KARAR = AYRINTI: kutuphane karari, kopyanin (WAR yolu, set izi) listesinden; ayrinti tablosu ayni
// set satirlarindan uretilir. Boylece "kutuphane farkli" deyip ayrintida "ayni" gostermek olanaksizdir
// (testte rastgele gruplarla sinanir).
'use strict';

const crypto = require('node:crypto');

const db = () => require('../db/index.cjs');
const alim = () => require('./ear-envanter-alim.cjs');

const KARAR_SIRA = Object.freeze([
  'FARKLI_KUTUPHANE',
  'AYNI_SURUM_FARKLI_DOSYA',
  'FARKLI_YAPI',
  'EKSIK_TARAMA',
  'AYNI',
  'TEK',
]);
const KUTUPHANE_SONUCLARI = Object.freeze([
  'AYNI',
  'FARKLI',
  'AYNI_SURUM_FARKLI_DOSYA',
  'KARSILASTIRILAMADI',
]);
const YAPI_SONUCLARI = Object.freeze(['AYNI', 'FARKLI', 'KARSILASTIRILAMADI']);
const FARK_KATEGORILERI = Object.freeze(['WAR', 'EKSIK', 'SURUM', 'BOYUT']);
const EAR_KONUM = '';
const GUN_MS = 86400000;
const PARCA = 500;

const ortamOf = (v) =>
  String(v == null ? '' : v)
    .trim()
    .toUpperCase();
const kopyaAnahtari = (k) => `${k.host}|${k.kok}|${k.ad}`;
const iz32 = (v) => crypto.createHash('sha256').update(v).digest('hex').slice(0, 32);
const kucukBuyuk = (a, b) => { if (a < b) return -1; if (a > b) return 1; return 0; };

function hata(status, message, code) {
  return Object.assign(new Error(message), { status, code });
}

// ── SAF KISIM ───────────────────────────────────────────────────────────────────────────────────

/**
 * Kopyanin kutuphane imzalari. warlar: [{ yol, ad, kutuphane_seti }], earSet: iz | null,
 * surumHaritasi: set izi -> surum izi. Konum WAR yolu (yoksa adi); EAR'in kendi lib/'i '' konumudur.
 */
function imzalar(warlar, earSet, surumHaritasi) {
  const girdi = [[EAR_KONUM, earSet || '']];
  for (const w of warlar || []) girdi.push([String(w.yol || w.ad || ''), w.kutuphane_seti || '']);
  girdi.sort((a, b) => kucukBuyuk(a[0], b[0]) || kucukBuyuk(a[1], b[1]));
  const surum = girdi.map(([k, iz]) => {
    if (!iz) return [k, ''];
    const s = surumHaritasi.get(iz);
    if (!s) throw hata(424, `Kütüphane setinin sürüm izi yok: ${iz}`, 'surum_izi_yok');
    return [k, s];
  });
  return { tamImza: iz32(JSON.stringify(girdi)), surumImza: iz32(JSON.stringify(surum)) };
}

/** Kopyalar -> { kutuphane, yapi, karar }. */
function karsilastir(kopyalar) {
  if (kopyalar.some((k) => k.durum !== 'TAM'))
    return { kutuphane: 'KARSILASTIRILAMADI', yapi: 'KARSILASTIRILAMADI', karar: 'EKSIK_TARAMA' };
  const kutuphane =
    (() => { if (new Set(kopyalar.map((k) => k.tamImza)).size === 1) return 'AYNI'; if (new Set(kopyalar.map((k) => k.surumImza)).size === 1) return 'AYNI_SURUM_FARKLI_DOSYA'; return 'FARKLI'; })();
  const yapi = new Set(kopyalar.map((k) => k.yapi_izi || '')).size === 1 ? 'AYNI' : 'FARKLI';
  const karar =
    (() => { if (kutuphane === 'FARKLI') return 'FARKLI_KUTUPHANE'; if (kutuphane === 'AYNI_SURUM_FARKLI_DOSYA') return 'AYNI_SURUM_FARKLI_DOSYA'; if (yapi === 'FARKLI') return 'FARKLI_YAPI'; return 'AYNI'; })();
  return { kutuphane, yapi, karar };
}

/** 0 -> A, 25 -> Z, 26 -> AA ... */
function harf(i) {
  let s = '';
  let n = i + 1;
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/**
 * Kopyalari anahtara gore degiskenlere ayirir. Sira: cok kopyali once, esitlikte en kucuk sunucu adi.
 * Donus: { harfOf: Map<kopyaAnahtari, harf>, liste: [{ harf, hostlar, kopya_sayisi }] }
 */
function degiskenler(kopyalar, anahtarOf) {
  const gruplar = new Map();
  for (const k of kopyalar) {
    const a = anahtarOf(k);
    if (!gruplar.has(a)) gruplar.set(a, []);
    gruplar.get(a).push(k);
  }
  const sirali = [...gruplar.values()]
    .map((ks) => ({ ks, enKucuk: ks.map(kopyaAnahtari).sort()[0] }))
    .sort((a, b) => b.ks.length - a.ks.length || kucukBuyuk(a.enKucuk, b.enKucuk));
  const harfOf = new Map();
  const liste = sirali.map(({ ks }, i) => {
    const h = harf(i);
    for (const k of ks) harfOf.set(kopyaAnahtari(k), h);
    return {
      harf: h,
      hostlar: [...new Set(ks.map((k) => k.host))].sort(),
      kopya_sayisi: ks.length,
    };
  });
  return { harfOf, liste };
}

function tarihFarki(kopyalar) {
  const t = kopyalar
    .map((k) => (k.taranma_utc ? Date.parse(zamanUtc(k.taranma_utc)) : NaN))
    .filter(Number.isFinite);
  return {
    tarih_farki_gun: t.length > 1 ? Math.floor((Math.max(...t) - Math.min(...t)) / GUN_MS) : 0,
    tarih_bilinmeyen: kopyalar.length - t.length,
  };
}

function zamanUtc(v) {
  if (v instanceof Date) return v.toISOString();
  const s = String(v);
  return /Z$|[+-]\d\d:?\d\d$/.test(s) ? s : `${s}Z`;
}

function kopyaOzeti(k, harfOf) {
  return {
    anahtar: kopyaAnahtari(k),
    host: k.host,
    ortam: ortamOf(k.ortam),
    kok: k.kok,
    jboss: k.jboss,
    durum: k.durum,
    kip: k.kip,
    bag_hedefi: k.bag_hedefi || null,
    taranma_utc: k.taranma_utc || null,
    kosu_id: k.kosu_id,
    uyg_no: k.uyg_no,
    degisken: harfOf ? harfOf.get(kopyaAnahtari(k)) || null : null,
  };
}

function grupla(kopyalar, anahtarOf) {
  const m = new Map();
  for (const k of kopyalar) {
    const a = anahtarOf(k);
    if (a == null) continue;
    if (!m.has(a)) m.set(a, []);
    m.get(a).push(k);
  }
  return m;
}

const kararSirasi = (a, b) =>
  KARAR_SIRA.indexOf(a.karar) - KARAR_SIRA.indexOf(b.karar) ||
  kucukBuyuk(a.uygulama, b.uygulama) ||
  kucukBuyuk(a.ortam || '', b.ortam || '') ||
  kucukBuyuk(a.jboss || '', b.jboss || '') ||
  kucukBuyuk(a.host || '', b.host || '');

/**
 * Kopyalar (imzalari hesaplanmis) -> { ortamIci, ortamlarArasi, nesil, ortamYok, kopyaKarari }.
 * kopya: { host, ortam, kok, jboss, ad, durum, kip, yapi_izi, taranma_utc, kosu_id, uyg_no, bag_hedefi,
 *          tamImza, surumImza }
 */
function analizEt(kopyalar, { tumu = false } = {}) {
  const bilinen = [];
  const bilinmeyen = [];
  for (const k of kopyalar || []) (ortamOf(k.ortam) ? bilinen : bilinmeyen).push(k);
  const kopyaKarari = new Map();
  const isle = (k, alan, karar) => {
    const a = kopyaAnahtari(k);
    if (!kopyaKarari.has(a))
      kopyaKarari.set(a, { ortam_ici: null, ortamlar_arasi: null, nesil: null });
    kopyaKarari.get(a)[alan] = karar;
  };
  const tamAnahtar = (k) => `${k.tamImza}/${k.yapi_izi || ''}`;

  const ortamIci = [];
  for (const ks of grupla(
    bilinen,
    (k) => `${k.ad}\u0000${ortamOf(k.ortam)}\u0000${k.jboss}`,
  ).values()) {
    const hostlar = [...new Set(ks.map((k) => k.host))].sort();
    if (hostlar.length < 2 && !tumu) continue;
    const s = hostlar.length < 2 ? { kutuphane: null, yapi: null, karar: 'TEK' } : karsilastir(ks);
    const d = degiskenler(ks, tamAnahtar);
    if (hostlar.length >= 2) for (const k of ks) isle(k, 'ortam_ici', s.karar);
    ortamIci.push({
      tur: 'ORTAM_ICI',
      uygulama: ks[0].ad,
      ortam: ortamOf(ks[0].ortam),
      jboss: ks[0].jboss,
      ...s,
      host_sayisi: hostlar.length,
      kopya_sayisi: ks.length,
      hostlar,
      eksik: ks.filter((k) => k.durum !== 'TAM').map((k) => `${k.host}:${k.durum}`),
      kipler: [...new Set(ks.map((k) => k.kip))].sort(),
      ...tarihFarki(ks),
      degiskenler: d.liste,
      kopyalar: ks
        .map((k) => kopyaOzeti(k, d.harfOf))
        .sort((a, b) => kucukBuyuk(a.anahtar, b.anahtar)),
    });
  }
  ortamIci.sort(kararSirasi);

  const ortamlarArasi = [];
  for (const ks of grupla(bilinen, (k) => `${k.ad}\u0000${k.jboss}`).values()) {
    const ortamlar = [...new Set(ks.map((k) => ortamOf(k.ortam)))].sort();
    if (ortamlar.length < 2) continue;
    const s = karsilastir(ks);
    const d = degiskenler(ks, (k) => k.tamImza);
    for (const k of ks) isle(k, 'ortamlar_arasi', s.karar);
    const cogunluk = d.liste[0] ? d.liste[0].harf : null;
    const ortamDetay = ortamlar.map((o) => {
      const oks = ks.filter((k) => ortamOf(k.ortam) === o);
      const harfler = [...new Set(oks.map((k) => d.harfOf.get(kopyaAnahtari(k))))].sort();
      return {
        ortam: o,
        hostlar: [...new Set(oks.map((k) => k.host))].sort(),
        harfler,
        eksik: oks.filter((k) => k.durum !== 'TAM').length,
      };
    });
    ortamlarArasi.push({
      tur: 'ORTAMLAR_ARASI',
      uygulama: ks[0].ad,
      jboss: ks[0].jboss,
      ...s,
      ortam_sayisi: ortamlar.length,
      host_sayisi: new Set(ks.map((k) => k.host)).size,
      kopya_sayisi: ks.length,
      ortamlar: ortamDetay,
      // Karsilastirilabildiyse cogunluk degiskeninden ayri ortamlar; eksikte bos (karar zaten verilmedi).
      farkli_ortamlar:
        s.karar === 'EKSIK_TARAMA' || s.kutuphane === 'AYNI'
          ? []
          : ortamDetay.filter((o) => o.harfler.some((h) => h !== cogunluk)).map((o) => o.ortam),
      eksik: ks.filter((k) => k.durum !== 'TAM').map((k) => `${k.host}:${k.durum}`),
      kipler: [...new Set(ks.map((k) => k.kip))].sort(),
      ...tarihFarki(ks),
      degiskenler: d.liste,
      kopyalar: ks
        .map((k) => kopyaOzeti(k, d.harfOf))
        .sort((a, b) => kucukBuyuk(a.anahtar, b.anahtar)),
    });
  }
  ortamlarArasi.sort(kararSirasi);

  // NESIL: ayni host + ayni EAR, hem 7 hem 8 (ortam gerekmez: ayni sunucu).
  const nesil = [];
  for (const ks of grupla(kopyalar || [], (k) =>
    k.jboss === '7' || k.jboss === '8' ? `${k.host}\u0000${k.ad}` : null,
  ).values()) {
    const n = new Set(ks.map((k) => k.jboss));
    if (!(n.has('7') && n.has('8'))) continue;
    const s = karsilastir(ks);
    for (const k of ks) isle(k, 'nesil', s.karar);
    nesil.push({
      tur: 'NESIL',
      host: ks[0].host,
      uygulama: ks[0].ad,
      ortam: ortamOf(ks[0].ortam),
      ...s,
      // Eski ekran alani: true ayni, false farkli, null karsilastirilamadi.
      ayni_kutuphane: s.kutuphane === 'KARSILASTIRILAMADI' ? null : s.kutuphane === 'AYNI',
      ...tarihFarki(ks),
      kopyalar: ks.map((k) => kopyaOzeti(k, null)).sort((a, b) => kucukBuyuk(a.jboss, b.jboss)),
    });
  }
  nesil.sort(kararSirasi);

  const ortamYok = [];
  for (const ks of grupla(bilinmeyen, (k) => `${k.ad}\u0000${k.jboss}`).values())
    ortamYok.push({
      tur: 'ORTAM_YOK',
      uygulama: ks[0].ad,
      jboss: ks[0].jboss,
      karar: null,
      host_sayisi: new Set(ks.map((k) => k.host)).size,
      kopya_sayisi: ks.length,
      hostlar: [...new Set(ks.map((k) => k.host))].sort(),
      kopyalar: ks.map((k) => kopyaOzeti(k, null)).sort((a, b) => kucukBuyuk(a.anahtar, b.anahtar)),
    });
  ortamYok.sort((a, b) => kucukBuyuk(a.uygulama, b.uygulama) || kucukBuyuk(a.jboss, b.jboss));

  return { ortamIci, ortamlarArasi, nesil, ortamYok, kopyaKarari };
}

/**
 * Kutuphane fark tablosu. kopyalar: [{ anahtar, konumlar: Map<konum, Array<[ad, surum, boyut]>> }]
 * (EAR lib konumu '' her kopyada vardir). Kategoriler:
 *   WAR   konum (WAR) yalniz bazi kopyalarda
 *   EKSIK kutuphane yalniz bazi kopyalarda (konum hepsinde var)
 *   SURUM ayni kutuphanenin surumleri farkli
 *   BOYUT surumler ayni, dosya boyutlari farkli
 * degerler: { [anahtar]: [[surum, boyut], ...] | null }  (WAR satirinda [] = var, null = yok)
 */
function farkSatirlari(kopyalar) {
  const satirlar = [];
  const konumlar = new Set();
  for (const k of kopyalar) for (const konum of k.konumlar.keys()) konumlar.add(konum);
  for (const konum of [...konumlar].sort()) {
    const olan = kopyalar.filter((k) => k.konumlar.has(konum));
    if (olan.length !== kopyalar.length) {
      satirlar.push({
        kategori: 'WAR',
        konum,
        kutuphane: '',
        degerler: Object.fromEntries(
          kopyalar.map((k) => [k.anahtar, k.konumlar.has(konum) ? [] : null]),
        ),
      });
      continue;
    }
    const libler = new Map();
    for (const k of kopyalar) {
      const m = new Map();
      for (const [ad, surum, boyut] of k.konumlar.get(konum)) {
        if (!m.has(ad)) m.set(ad, []);
        m.get(ad).push([String(surum), boyut == null ? null : Number(boyut)]);
      }
      for (const [ad, v] of m) {
        v.sort((x, y) => kucukBuyuk(x[0], y[0]) || (x[1] ?? -1) - (y[1] ?? -1));
        if (!libler.has(ad)) libler.set(ad, new Map());
        libler.get(ad).set(k.anahtar, v);
      }
    }
    for (const ad of [...libler.keys()].sort()) {
      const her = libler.get(ad);
      const degerler = Object.fromEntries(
        kopyalar.map((k) => [k.anahtar, her.get(k.anahtar) || null]),
      );
      let kategori = null;
      if (her.size !== kopyalar.length) kategori = 'EKSIK';
      else {
        const surumler = new Set([...her.values()].map((v) => JSON.stringify(v.map((x) => x[0]))));
        const tamlar = new Set([...her.values()].map((v) => JSON.stringify(v)));
        if (surumler.size > 1) kategori = 'SURUM';
        else if (tamlar.size > 1) kategori = 'BOYUT';
      }
      if (kategori) satirlar.push({ kategori, konum, kutuphane: ad, degerler });
    }
  }
  return satirlar;
}

/** Python Iz sinifinin JS esi (yol + tip): ear_tara.py ucucu() ile ayni dislama. */
const UCUCU_SEGMENT = new Set(['logs', 'log', 'tmp', 'temp', 'work']);
const UCUCU_AD = /(\.(log|tmp|swp|out)(\.\d+)?$)|(^\.nfs)/i;
function ucucu(rel) {
  const p = String(rel).toLowerCase().split('/');
  return (
    p.slice(0, -1).some((x) => UCUCU_SEGMENT.has(x)) ||
    UCUCU_SEGMENT.has(p[p.length - 1]) ||
    UCUCU_AD.test(p[p.length - 1])
  );
}
function yapiIzi(agacSatirlari) {
  const h = crypto.createHash('sha256');
  let n = 0;
  for (const s of agacSatirlari || []) {
    if (ucucu(s[0])) continue;
    h.update(Buffer.from(JSON.stringify([String(s[0]), String(s[1])]), 'utf8'));
    h.update('\n');
    n += 1;
  }
  return n ? h.digest('hex').slice(0, 16) : '';
}

/**
 * Iki TAM kopyanin dosya farki (agac satirlarindan). Ucucu yollar (log, tmp, work) disarida: yapi izi
 * de onlari saymaz. Boyut farki BILGIDIR, yapi kararina girmez.
 */
function yapiFarki(a, b) {
  const harita = (satirlar) => {
    const m = new Map();
    for (const s of satirlar || []) if (!ucucu(s[0])) m.set(String(s[0]), s);
    return m;
  };
  const A = harita(a);
  const B = harita(b);
  const yalnizA = [];
  const yalnizB = [];
  const tipFarkli = [];
  const boyutFarkli = [];
  for (const [yol, s] of A) {
    const t = B.get(yol);
    if (!t) yalnizA.push(yol);
    else if (String(s[1]) !== String(t[1])) tipFarkli.push({ yol, a: s[1], b: t[1] });
    else if (String(s[5]) !== String(t[5])) boyutFarkli.push({ yol, a: s[5], b: t[5] });
  }
  for (const yol of B.keys()) if (!A.has(yol)) yalnizB.push(yol);
  return {
    yalnizA: yalnizA.sort(),
    yalnizB: yalnizB.sort(),
    tipFarkli: tipFarkli.sort((x, y) => kucukBuyuk(x.yol, y.yol)),
    boyutFarkli: boyutFarkli.sort((x, y) => kucukBuyuk(x.yol, y.yol)),
  };
}

// ── DB KISMI ────────────────────────────────────────────────────────────────────────────────────

const sonCte = () => require('./ear-envanter-sorgu.cjs').SON_CTE;
const kosuNo = (v) => {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : 0;
};

/** Eski setlerin (surum_izi NULL) surum izini set satirlarindan hesaplar ve yazar. */
async function surumIzleriniTamamla(izler) {
  const out = new Map();
  for (let i = 0; i < izler.length; i += PARCA) {
    const parca = izler.slice(i, i + PARCA);
    const { rows } = await db().query(
      `SELECT iz, sira, ad, surum FROM ear_envanter_set_kutuphaneleri
        WHERE iz IN (SELECT value FROM OPENJSON($1)) ORDER BY iz, sira`,
      [JSON.stringify(parca)],
    );
    const listeler = new Map(parca.map((iz) => [iz, []]));
    for (const r of rows || []) {
      const iz = String(r.iz).trim();
      if (listeler.has(iz)) listeler.get(iz).push([String(r.ad), String(r.surum)]);
    }
    const yazilacak = [];
    for (const [iz, l] of listeler) {
      const s = alim().surumIzi(l);
      out.set(iz, s);
      yazilacak.push({ iz, surum_izi: s });
    }
    await db().query(
      `UPDATE s SET surum_izi = j.surum_izi FROM ear_envanter_kutuphane_setleri s
         JOIN OPENJSON($1) WITH (iz CHAR(32), surum_izi CHAR(32)) j ON j.iz = s.iz
        WHERE s.surum_izi IS NULL`,
      [JSON.stringify(yazilacak)],
    );
  }
  return out;
}

/** Son durumun (ya da tek kosunun) kopyalari, imzalariyla. */
async function kopyalariOku({ kosu } = {}) {
  const k = kosuNo(kosu);
  const SON = sonCte();
  const [u, w, s] = await Promise.all([
    db().query(
      `WITH ${SON}
       SELECT u.kosu_id, u.host, h.ortam, u.uyg_no, u.kok, u.jboss, u.ad, u.durum, u.kip, u.yapi_izi,
              u.ear_kutuphane_seti, u.bag_hedefi, h.taranma_utc
         FROM ear_envanter_uygulamalari u
         JOIN son ON son.host = u.host AND son.kosu_id = u.kosu_id
         JOIN ear_envanter_hostlari h ON h.kosu_id = u.kosu_id AND h.host = u.host`,
      [k],
    ),
    db().query(
      `WITH ${SON}
       SELECT w.kosu_id, w.host, w.uyg_no, w.yol, w.ad, w.kutuphane_seti
         FROM ear_envanter_warlari w
         JOIN son ON son.host = w.host AND son.kosu_id = w.kosu_id`,
      [k],
    ),
    db().query(
      `WITH ${SON}
       SELECT s.iz, s.surum_izi FROM ear_envanter_kutuphane_setleri s
        WHERE s.iz IN (SELECT w.kutuphane_seti FROM ear_envanter_warlari w
                         JOIN son ON son.host = w.host AND son.kosu_id = w.kosu_id
                       UNION SELECT u.ear_kutuphane_seti FROM ear_envanter_uygulamalari u
                         JOIN son ON son.host = u.host AND son.kosu_id = u.kosu_id)`,
      [k],
    ),
  ]);
  const surum = new Map();
  const eksik = [];
  for (const r of s.rows || []) {
    const iz = String(r.iz).trim();
    if (r.surum_izi) surum.set(iz, String(r.surum_izi).trim());
    else eksik.push(iz);
  }
  if (eksik.length) for (const [iz, v] of await surumIzleriniTamamla(eksik)) surum.set(iz, v);
  const warlar = new Map();
  for (const r of w.rows || []) {
    const a = `${r.kosu_id}|${r.host}|${r.uyg_no}`;
    if (!warlar.has(a)) warlar.set(a, []);
    warlar
      .get(a)
      .push({ ...r, kutuphane_seti: r.kutuphane_seti ? String(r.kutuphane_seti).trim() : null });
  }
  return (u.rows || []).map((r) => {
    const ear = r.ear_kutuphane_seti ? String(r.ear_kutuphane_seti).trim() : null;
    return {
      ...r,
      ear_kutuphane_seti: ear,
      ...imzalar(warlar.get(`${r.kosu_id}|${r.host}|${r.uyg_no}`) || [], ear, surum),
    };
  });
}

// Analiz onbellegi: yeni veri gelmedikce (veri imzasi ayni) yeniden hesaplanmaz; tek ucus.
let _onbellek = { imza: null, deger: null };
let _ucus = null;

async function veriImzasi() {
  const { rows } = await db().query(
    `SELECT COUNT(*) AS n, MAX(id) AS m FROM ear_envanter_hostlari WHERE veri_var = 1`,
  );
  const r = (rows && rows[0]) || {};
  return `${Number(r.n || 0)}:${Number(r.m || 0)}`;
}

/** { ortamIci (tumu dahil TEK), ortamlarArasi, nesil, ortamYok, kopyaKarari, imza } */
async function analiz({ kosu } = {}) {
  const k = kosuNo(kosu);
  if (k) return { ...analizEt(await kopyalariOku({ kosu: k }), { tumu: true }), imza: null };
  const imza = await veriImzasi();
  if (_onbellek.imza === imza && _onbellek.deger) return _onbellek.deger;
  if (_ucus && _ucus.imza === imza) return _ucus.p;
  const p = (async () => {
    const deger = { ...analizEt(await kopyalariOku({}), { tumu: true }), imza };
    _onbellek = { imza, deger };
    return deger;
  })();
  _ucus = { imza, p };
  try {
    return await p;
  } finally {
    if (_ucus && _ucus.p === p) _ucus = null;
  }
}

/** Gruplari tur adina gore dondurur. */
function turListesi(a, tur) {
  if (tur === 'ORTAMLAR_ARASI') return a.ortamlarArasi;
  if (tur === 'NESIL') return a.nesil;
  if (tur === 'ORTAM_YOK') return a.ortamYok;
  return a.ortamIci;
}

/** Tek grup: tur + kimlik. */
function grupBul(a, { tur, ad, ortam, jboss, host }) {
  const o = ortamOf(ortam);
  const l = turListesi(a, tur);
  if (tur === 'NESIL') return l.find((g) => g.uygulama === ad && g.host === host) || null;
  if (tur === 'ORTAMLAR_ARASI' || tur === 'ORTAM_YOK')
    return l.find((g) => g.uygulama === ad && g.jboss === jboss) || null;
  return l.find((g) => g.uygulama === ad && g.ortam === o && g.jboss === jboss) || null;
}

/** Grubun kopyalarinin konum -> kutuphane listeleri (iki sorgu: WAR'lar, set satirlari). */
async function kopyaKutuphaneleri(kopyalar) {
  const anahtarlar = kopyalar.map((k) => ({ kosu_id: k.kosu_id, host: k.host, uyg_no: k.uyg_no }));
  const [u, w] = await Promise.all([
    db().query(
      `SELECT u.kosu_id, u.host, u.uyg_no, u.ear_kutuphane_seti FROM ear_envanter_uygulamalari u
         JOIN OPENJSON($1) WITH (kosu_id INT, host NVARCHAR(128), uyg_no INT) k
           ON k.kosu_id = u.kosu_id AND k.host = u.host AND k.uyg_no = u.uyg_no`,
      [JSON.stringify(anahtarlar)],
    ),
    db().query(
      `SELECT w.kosu_id, w.host, w.uyg_no, w.yol, w.ad, w.kutuphane_seti FROM ear_envanter_warlari w
         JOIN OPENJSON($1) WITH (kosu_id INT, host NVARCHAR(128), uyg_no INT) k
           ON k.kosu_id = w.kosu_id AND k.host = w.host AND k.uyg_no = w.uyg_no`,
      [JSON.stringify(anahtarlar)],
    ),
  ]);
  const anah = (r) => `${r.kosu_id}|${r.host}|${r.uyg_no}`;
  const izler = new Set();
  const earOf = new Map();
  for (const r of u.rows || []) {
    const iz = r.ear_kutuphane_seti ? String(r.ear_kutuphane_seti).trim() : null;
    earOf.set(anah(r), iz);
    if (iz) izler.add(iz);
  }
  const warOf = new Map();
  for (const r of w.rows || []) {
    const iz = r.kutuphane_seti ? String(r.kutuphane_seti).trim() : null;
    if (!warOf.has(anah(r))) warOf.set(anah(r), []);
    warOf.get(anah(r)).push({ konum: String(r.yol || r.ad || ''), iz });
    if (iz) izler.add(iz);
  }
  const setler = new Map();
  const liste = [...izler];
  for (let i = 0; i < liste.length; i += PARCA) {
    const { rows } = await db().query(
      `SELECT iz, sira, ad, surum, boyut FROM ear_envanter_set_kutuphaneleri
        WHERE iz IN (SELECT value FROM OPENJSON($1)) ORDER BY iz, sira`,
      [JSON.stringify(liste.slice(i, i + PARCA))],
    );
    for (const r of rows || []) {
      const iz = String(r.iz).trim();
      if (!setler.has(iz)) setler.set(iz, []);
      setler
        .get(iz)
        .push([String(r.ad), String(r.surum), r.boyut == null ? null : Number(r.boyut)]);
    }
  }
  return kopyalar.map((k) => {
    const a = `${k.kosu_id}|${k.host}|${k.uyg_no}`;
    const konumlar = new Map([[EAR_KONUM, setler.get(earOf.get(a)) || []]]);
    for (const x of warOf.get(a) || []) konumlar.set(x.konum, (x.iz && setler.get(x.iz)) || []);
    return { anahtar: k.anahtar, konumlar };
  });
}

/** Grubun ayrintisi: kopyalar + sayfali fark satirlari (kesilme yok: toplam her zaman doner). */
async function farkAyrintisi({
  tur = 'ORTAM_ICI',
  ad,
  ortam,
  jboss,
  host,
  kosu,
  limit,
  offset,
} = {}) {
  const a = await analiz({ kosu });
  const g = grupBul(a, { tur, ad, ortam, jboss, host });
  if (!g) throw hata(409, 'Eşlenik grubu bulunamadı; veri yenilenmiş olabilir.', 'grup_yok');
  const satirlar = farkSatirlari(await kopyaKutuphaneleri(g.kopyalar));
  const lim = Math.max(1, Math.min(2000, Number(limit) || 500));
  const off = Math.max(0, Number(offset) || 0);
  const sayilar = Object.fromEntries(FARK_KATEGORILERI.map((k) => [k, 0]));
  for (const s of satirlar) sayilar[s.kategori] += 1;
  return {
    grup: { ...g, kopyalar: undefined },
    kopyalar: g.kopyalar,
    farklar: satirlar.slice(off, off + lim),
    toplam: satirlar.length,
    sayilar,
  };
}

module.exports = {
  KARAR_SIRA,
  KUTUPHANE_SONUCLARI,
  YAPI_SONUCLARI,
  FARK_KATEGORILERI,
  ortamOf,
  kopyaAnahtari,
  imzalar,
  karsilastir,
  harf,
  degiskenler,
  analizEt,
  farkSatirlari,
  ucucu,
  yapiIzi,
  yapiFarki,
  surumIzleriniTamamla,
  kopyalariOku,
  analiz,
  turListesi,
  grupBul,
  farkAyrintisi,
  _sifirlaForTest: () => {
    _onbellek = { imza: null, deger: null };
    _ucus = null;
  },
};
