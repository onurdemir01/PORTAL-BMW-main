// server/nginx-loadtest/analiz.cjs -- Yuk Testi analizi: el kitinin karsilastir.py'sinin Node portu.
//
// KAYNAK: glomo_yuk_testi/f5_rehber/har_yuk_testi/karsilastir.py (sahada kanitli el kiti). Bu dosya
// onun `kosu_hesapla` (TUR basina), `grupla` (tekrar ortalamasi), `karar_ver` (iki kosu arasi
// KALICI/NOTR/RET/GECERSIZ/VERI_YOK) ve `ayristirma` adimlarini AYNI formul ve esiklerle tasir:
//   * yuzdelik = dogrusal ara degerleme ((n-1)*p/100), medyan = statistics.median (cift sayida iki
//     ortanin ortalamasi), toplam = CPython 3.12 sum() (Neumaier), esik karsilastirmalari EPS = 1e-9
//   * olcum penceresi: sunucu logundaki olcum damgalari [min+3, max-2]; log yoksa istemci saati
//   * worker CPU ms/sn = dtik*1000/clk/dt; arka plan = kosu disi >= 8 sn bloklarin medyani
//   * GECERSIZ: k6 rc, 429 (her faz), 5xx (olcum), http2, hata > %0.1, log/istemci farki > %2,
//     kayit:log_dondu, df >= 65, konf ozeti degisti, pencere < 30 sn, reload (pid kumesi/kapanan)
//   * DOYMA: dropped > 0 ya da host CPU ortalamasi > %90 (GECERSIZ > DOYMA > GECERLI)
// Nedenlerdeki sayi bicimleri Python %-bicimiyle birebir (yarim-cifte yuvarlama, -0.0 isareti):
// testler Python'un ciktisini satir satir karsilastirir (__tests__/fixtures/karsilastir-beklenen.json).
//
// PORTAL FARKLARI (bilincli, testte acikca eslenir):
//   1. Bir kosu dizini = tek ADIM (R<id>). Karar iki kosunun ADIM satirlari arasinda verilir; T0/Son/
//      perf ozel adlari yok. Kademeler secilen hizlardan gelir: kademeCpu varsayilani ortak hizlarin
//      ortasi, kademeP95 varsayilani en yuksek ortak hiz (Python 250/400 sabitti).
//   2. Karsilastirilan senaryo/kip/ae: ikisinde de K/yeni/br varsa o (Python ile ayni); yoksa ortak
//      olan baska bir birlesim (Portal kosusu tek kip/ae ile kosar). Python bu durumda VERI_YOK derdi.
//   3. Kademede CPU olcusu yalniz doyma yuzunden yoksa karar DOYMA olur (Python VERI_YOK derdi).
//   4. kos.sh komut onerileri ("TEKRAR=3 ./kos.sh T0 K") Portal diline cevrildi ("tekrar=3 ile").
//   5. TLS mikro testi (tls_olcum.sh) Portal'da kosulmaz: saat farki duzeltmesi ve T3 kurali yok.
//   6. kos.sh'in hatali_ saydigi ya da hic bitmeyen TUR'lar HATALI satiri olarak raporlanir (Python
//      bunlari gormezdi); gruplara ve karara GIRMEZ.
//   7. TUR uyarilari (ham.uyarilar; Python tablo.md'de "uyarili kosular") kosu duzeyi `uyarilar`a da
//      "<tur>: <uyari>" olarak katilir (tekil, en cok MAX_ADIM_UYARI + tek ozet satiri). TUR alanlari,
//      rps_sunucu dahil, DEGISMEZ (Python esdegerligi).
// null = olculmedi (hicbir zaman 0 yerine gecmez). Fonksiyonlar saftir: G/C yok, saat yok.
'use strict';

const EPS = 1e-9;
const LOG_ESIK_GECERSIZ = 0.02;
const HATA_ESIK = 0.001;
const DF_ESIK = 65;
const DOYMA_HOST_CPU = 90.0;
// Sozlesme: yuk_tekrar 1..3. Ek tekrar onerisi bu tavani asmaz.
const MAX_TEKRAR = 3;
const ADIM_RE = /^[A-Za-z0-9-]+$/;
// Kosu duzeyine katilan TUR uyarisi satiri tavani (poller kosu uyarilarinin ilk 100'unu saklar: KOSU_UYARI_TAVANI).
const MAX_ADIM_UYARI = 40;

// GECERSIZ / HATALI / DOYMA neden onekleri -> (anlami, ne yapilir). Ekran yalniz gorulenleri aciklar.
const NEDENLER = Object.freeze([
  { onek: 'k6_rc', anlam: 'k6 hata koduyla bitti.', cozum: 'Is ciktisindaki k6 mesajina bakin; kosuyu tekrarlayin.' },
  { onek: '429', anlam: 'Rate limit (limit_req / limit_conn) asildi.', cozum: "Hizlari dusurun; ayni IP'den baska yuk var mi bakin." },
  { onek: '5xx', anlam: 'Olcum fazinda sunucu hatasi (5xx).', cozum: "error.log'a bakin; nedeni giderip kosuyu tekrarlayin." },
  { onek: 'http2', anlam: 'HTTP/2 ile gidildi.', cozum: 'k6 surumunu ve GODEBUG=http2client=0 ayarini kontrol edin.' },
  { onek: 'hata_', anlam: "Istek hatasi %0.1'i asti (404, zaman asimi ...).", cozum: 'Senaryodaki yollar hala 200 mu (deploy oldu mu)? Gerekirse senaryoyu yenileyin, kosuyu tekrarlayin.' },
  { onek: 'log_istemci_farki', anlam: "Sunucu logundaki istek sayisi k6'nin saydigindan %2'den fazla farkli.", cozum: 'Dogru sunucu ve IP mi? Isteklerin bir kismi baska sunucuya mi gidiyor?' },
  { onek: 'kayit:log_dondu', anlam: 'Kayit sirasinda log dondu ya da kuculdu (rotate).', cozum: 'Kosuyu tekrarlayin.' },
  { onek: 'disk_', anlam: '/web_log %65 ya da ustu dolu; disk_cleaner loglari sifirlayabilir.', cozum: 'Yer acilmasini bekleyin.' },
  { onek: 'konf_degisti', anlam: 'Kayit sirasinda nginx konfigurasyonu degisti.', cozum: 'Deney suresince o sunucuya konf dagitilmamali.' },
  { onek: 'pencere_kisa', anlam: "Kaydedici olcum fazinin 30 sn'den azini gordu (gec basladi / erken durdu).", cozum: 'Kosuyu tekrarlayin; kaydedici erken durduysa is ciktisina bakin.' },
  { onek: 'reload', anlam: 'Olcum penceresinde reload oldu (worker PID kumesi degisti).', cozum: "Eski worker'lar ('shutting down') bitene kadar bekleyip kosuyu tekrarlayin." },
  { onek: 'hatali_kosu', anlam: "kos.sh bu TUR'u durdurdu (429 / http2 / k6 hatasi / olcum yok).", cozum: 'Nedeni giderip yeni kosu baslatin.' },
  { onek: 'tamamlanmadi', anlam: 'TUR baslatildi ama istemci sonucu yazilmadi (kosu kesildi ya da durduruldu).', cozum: 'Yeni kosu baslatin.' },
  { onek: 'doyma:', anlam: 'Istenen hiz tutturulamadi (dropped > 0) ya da hedefin CPU ortalamasi %90 ustunde.', cozum: 'Daha dusuk hizla kosun; kapasite tahmini bu kademede gecerli degil.' },
]);

// istemci_<TUR>.csv'den sayi olarak alinan alanlar (karsilastir.py kosu_hesapla ile ayni liste).
const ISTEMCI_SAYI = Object.freeze([
  'n_olcum', 'rps_gercek', 'p50', 'p95', 'p99', 'ttfb_p95', 'tls_p95', 'connect_p95', 'hata_orani',
  'n_429', 'n_5xx', 'dropped', 'http2', 'bayt_istek', 'p95_js', 'p95_css', 'p95_html', 'p95_json',
  'p95_config', 'p95_buyuk', 'isinma_sn', 'sure_sn',
]);
const GRUP_ORTALAMA = Object.freeze([
  'rps_gercek', 'p50', 'p95', 'p99', 'ttfb_p95', 'tls_p95', 'hata_orani', 'sunucu_rt_p95', 'bayt_istek',
  'govde_bayt_istek', 'host_cpu_ort', 'p95_buyuk', 'diger_rps',
]);
const FARK_ALANLARI = Object.freeze([
  'cpu_ms_istek', 'p50', 'p95', 'p99', 'ttfb_p95', 'hata_orani', 'rps_gercek', 'host_cpu_ort', 'bayt_istek',
  'govde_bayt_istek', 'sunucu_rt_p95',
]);

// ---------------------------------------------------------------------------------------------
// Python uyumlu ilkel islemler
// ---------------------------------------------------------------------------------------------

const PY_FLOAT_RE = /^[+-]?(?:[0-9](?:_?[0-9])*(?:\.(?:[0-9](?:_?[0-9])*)?)?|\.[0-9](?:_?[0-9])*)(?:[eE][+-]?[0-9](?:_?[0-9])*)?$/;

/**
 * karsilastir.py `sayi`: bos, nan, -, none, null -> null; sonlu olmayan -> null. JS sayisi da kabul
 * eder (DB satiri). sonuc.cjs'teki kopyasiyla esdegerligi testte kilitlidir (modul bagimliligi yok).
 */
function sayi(x) {
  if (x === null || x === undefined) return null;
  if (typeof x === 'number') return Number.isFinite(x) ? x : null;
  const s = String(x).trim();
  const k = s.toLowerCase();
  if (s === '' || k === 'nan' || k === '-' || k === 'none' || k === 'null') return null;
  if (!PY_FLOAT_RE.test(s)) return null;
  const v = Number(s.replace(/_/g, ''));
  return Number.isFinite(v) ? v : null;
}

/** CPython 3.12 sum() (float listesi): Neumaier telafili toplam. */
function pyToplam(xs) {
  if (!xs.length) return 0;
  let f = 0 + xs[0];
  let c = 0;
  for (let i = 1; i < xs.length; i++) {
    const x = xs[i];
    const t = f + x;
    if (Math.abs(f) >= Math.abs(x)) c += (f - t) + x;
    else c += (x - t) + f;
    f = t;
  }
  if (c !== 0 && Number.isFinite(c)) f += c;
  return f;
}

/** Python max(a, b): esitlikte ILKI (isaretli sifirda fark eder). */
function pyMax(a, b) {
  return b > a ? b : a;
}

function esikGecti(deger, esik) {
  return deger >= esik - EPS;
}

function yuzdelik(degerler, p) {
  if (!degerler.length) return null;
  const d = Float64Array.from(degerler).sort();
  const k = ((d.length - 1) * p) / 100.0;
  const a = Math.floor(k);
  const b = Math.ceil(k);
  return d[a] + (d[b] - d[a]) * (k - a);
}

/** statistics.median */
function medyan(xs) {
  const d = Float64Array.from(xs).sort();
  const n = d.length;
  if (!n) return null;
  if (n % 2 === 1) return d[(n - 1) / 2];
  return (d[n / 2 - 1] + d[n / 2]) / 2;
}

function ortalama(xs) {
  const v = xs.filter((x) => x !== null && x !== undefined);
  return v.length ? pyToplam(v) / v.length : null;
}

function gurultu(xs) {
  const v = xs.filter((x) => x !== null && x !== undefined);
  if (v.length < 2) return null;
  const m = pyToplam(v) / v.length;
  return m ? (Math.max(...v) - Math.min(...v)) / m : null;
}

function oran(a, b) {
  if (a === null || a === undefined || b === null || b === undefined || b === 0) return null;
  return (a - b) / b;
}

/** Python round(float) -> int (yarim-cifte). */
function pyYuvarla(x) {
  const f = Math.floor(x);
  const d = x - f;
  if (d > 0.5) return f + 1;
  if (d < 0.5) return f;
  return f % 2 === 0 ? f : f + 1;
}

/**
 * Python '%.nf': ikili degerin TAM ondalik acilimina gore yuvarlar, tam yarida cifte gider
 * (toFixed yukari gider: 0.125 -> '0.13', Python '0.12'). Negatif sifir isaretini korur ('-0.0').
 */
function fx(x, n) {
  if (Number.isNaN(x)) return 'nan';
  if (!Number.isFinite(x)) return x > 0 ? 'inf' : '-inf';
  const neg = x < 0 || Object.is(x, -0);
  const a = Math.abs(x);
  let s;
  if (a >= 1e21) {
    s = BigInt(a).toString() + (n > 0 ? '.' + '0'.repeat(n) : '');
  } else {
    s = a.toFixed(n);
    const tam = a.toFixed(100);
    const nokta = tam.indexOf('.');
    const kalan = tam.slice(nokta + 1 + n);
    if (/^50*$/.test(kalan)) {
      const kesik = n > 0 ? tam.slice(0, nokta + 1 + n) : tam.slice(0, nokta);
      if (Number(kesik[kesik.length - 1]) % 2 === 0) s = kesik;
    }
  }
  return (neg ? '-' : '') + s;
}

/** Python '%+.nf' */
function fxs(x, n) {
  const s = fx(x, n);
  return s.startsWith('-') ? s : '+' + s;
}

/** Python '%d' (float -> int: sifira dogru keser). */
function fd(x) {
  const t = Math.trunc(x);
  return Math.abs(t) >= 1e21 ? BigInt(t).toString() : String(t === 0 ? 0 : t);
}

// ---------------------------------------------------------------------------------------------
// TUR hesaplari (karsilastir.py kosu_hesapla ve yardimcilari)
// ---------------------------------------------------------------------------------------------

function kesitSec(kesitler, w0, w1) {
  let enIyi = null;
  let enCok = 0;
  for (const k of kesitler) {
    let c = 0;
    for (const o of k.ornekler) if (w0 <= o.t && o.t <= w1) c++;
    if (c > enCok) {
      enIyi = k;
      enCok = c;
    }
  }
  return enIyi;
}

function clkAl(kesit) {
  const v = sayi(kesit.bilgi ? kesit.bilgi.clk_tck : null);
  return v && v > 0 ? v : 100.0;
}

function pencereCpu(ornekler, w0, w1, clk) {
  const ic = ornekler.filter((o) => w0 <= o.t && o.t <= w1);
  if (ic.length < 2) return null;
  const a = ic[0];
  const b = ic[ic.length - 1];
  const dt = b.t - a.t;
  if (dt <= 0) return null;
  const reload = new Set(ic.map((o) => o.p)).size > 1 || ic.some((o) => o.k > 0);
  const hostOrt = b.tot > a.tot ? (100.0 * (b.busy - a.busy)) / (b.tot - a.tot) : null;
  let hostMax = null;
  for (let i = 0; i < ic.length - 5; i++) {
    const x = ic[i];
    const y = ic[i + 5];
    if (y.tot > x.tot) {
      const v = (100.0 * (y.busy - x.busy)) / (y.tot - x.tot);
      hostMax = hostMax === null ? v : pyMax(hostMax, v);
    }
  }
  if (hostMax === null) hostMax = hostOrt;
  return {
    t0: a.t, t1: b.t, dt, reload,
    user: ((b.u - a.u) * 1000.0) / clk / dt,
    sys: ((b.s - a.s) * 1000.0) / clk / dt,
    host_ort: hostOrt, host_max: hostMax,
  };
}

/** Kosu disi (dislama araliklari disi, kapanan worker yok, ayni pid kumesi) >= 8 sn bloklarin medyani. */
function arkaPlan(ornekler, dislama, clk) {
  const disarida = (o) => o.k === 0 && !dislama.some(([a, b]) => a <= o.t && o.t <= b);
  const bloklar = [];
  let cur = [];
  for (const o of ornekler) {
    const d = disarida(o);
    if (d && (!cur.length || cur[cur.length - 1].p === o.p)) {
      cur.push(o);
      continue;
    }
    if (cur.length >= 2) bloklar.push(cur);
    cur = d ? [o] : [];
  }
  if (cur.length >= 2) bloklar.push(cur);
  const us = [];
  const ss = [];
  let sure = 0.0;
  for (const b of bloklar) {
    const dt = b[b.length - 1].t - b[0].t;
    if (dt < 8) continue;
    us.push(((b[b.length - 1].u - b[0].u) * 1000.0) / clk / dt);
    ss.push(((b[b.length - 1].s - b[0].s) * 1000.0) / clk / dt);
    sure += dt;
  }
  if (!us.length) return null;
  return { user: medyan(us), sys: medyan(ss), blok: us.length, sn: sure };
}

function kosuAyir(tur, ist) {
  const p = tur.split('_');
  const alti = p.length >= 6;
  return {
    adim: ist.adim || (alti ? p[0] : ''),
    senaryo: ist.senaryo || (alti ? p[1] : ''),
    kip: ist.kip || (alti ? p[2] : ''),
    ae: ist.ae || (alti ? p[3] : ''),
    hiz: Math.trunc(sayi(ist.hiz) || (alti ? sayi(p[4]) : 0) || 0),
  };
}

/** Kosu araliklari (+ -2/+8 sn): log denemeleri ve zaman.csv satirlari. TLS saat farki Portal'da yok. */
function dislamaListesi(ctx) {
  const d = [];
  for (const k of ctx.log.values()) {
    const denemeler = new Map();
    for (let i = 0; i < k.n; i++) {
      const anahtar = Number.isNaN(k.d[i]) ? 'yok' : k.d[i];
      const t = k.t[i];
      const x = denemeler.get(anahtar);
      if (!x) denemeler.set(anahtar, [t, t]);
      else {
        if (t < x[0]) x[0] = t;
        if (t > x[1]) x[1] = t;
      }
    }
    for (const [a, b] of denemeler.values()) d.push([a - 2, b + 8]);
  }
  for (const [, b, e] of ctx.zamanTum) d.push([b - 2, e + 8]);
  return d;
}

/**
 * Ayni TUR durup tekrar kosulduysa logda iki denemenin satirlari olur: yalniz istemci csv'sinin
 * denemesi (yoksa en son deneme) kullanilir. Deneme kolonu yoksa hepsi. Doner: { idx, hedef }.
 */
function denemeSec(ctx, tur, ist, uyari) {
  const k = ctx.log.get(tur);
  const n = k ? k.n : 0;
  const kume = new Set();
  for (let i = 0; i < n; i++) if (!Number.isNaN(k.d[i])) kume.add(k.d[i]);
  const denemeler = [...kume].sort((a, b) => a - b);
  if (!denemeler.length) {
    if (n && (ctx.zamanN.get(tur) || 0) > 1) uyari.push("tekrar_kosu_ayristirilamadi(log'da_deneme_kolonu_yok)");
    const idx = new Array(n);
    for (let i = 0; i < n; i++) idx[i] = i;
    return { idx, hedef: null };
  }
  const istD = sayi(ist.deneme);
  const hedef = istD !== null ? Math.trunc(istD) : denemeler[denemeler.length - 1];
  const idx = [];
  for (let i = 0; i < n; i++) if (k.d[i] === hedef) idx.push(i);
  if (idx.length < n) uyari.push(`tekrar_kosu:deneme_${fd(hedef)}_kullanildi(${n - idx.length}_eski_satir_atildi)`);
  return { idx, hedef };
}

/** karsilastir.py `kosu_hesapla`. Python'un `r` sozlugu + Portal icin birkac ek alan (_ onekli). */
function kosuHesapla(ctx, tur, ist, arkaKesit) {
  const r = { tur };
  Object.assign(r, kosuAyir(tur, ist));
  for (const k of ISTEMCI_SAYI) r[k] = sayi(ist[k]);
  r.sikistirma_turu = ist.sikistirma_turu !== undefined ? ist.sikistirma_turu : '';
  const gecersiz = [];
  const uyari = [];
  const sec = denemeSec(ctx, tur, ist, uyari);
  r.deneme = sec.hedef;
  const kayit = ctx.log.get(tur);
  const satirlar = sec.idx;
  const olcum = kayit ? satirlar.filter((i) => kayit.faz[i] === ctx.olcumKod) : [];
  const zaman = ctx.zaman.get(tur);
  if (zaman && zaman[2] !== '' && zaman[2] !== '0') gecersiz.push(`k6_rc=${zaman[2]}`);
  let w0 = null;
  let w1 = null;
  let kaynak;
  if (olcum.length >= 10) {
    let mn = Infinity;
    let mx = -Infinity;
    for (const i of olcum) {
      const t = kayit.t[i];
      if (t < mn) mn = t;
      if (t > mx) mx = t;
    }
    w0 = mn + 3;
    w1 = mx - 2;
    kaynak = 'log';
    if (zaman && r.isinma_sn !== null) {
      const fark = mn - (zaman[0] + r.isinma_sn);
      if (Math.abs(fark - 2) > 10) uyari.push(`saat_farki~${fd(pyYuvarla(fark))}s(sunucu-istemci)`);
    }
  } else if (zaman) {
    const isinma = r.isinma_sn || 30;
    w0 = zaman[0] + isinma + 5;
    w1 = zaman[1] - 5;
    kaynak = 'istemci_saati';
    uyari.push('log_satiri_yok:pencere_istemci_saatinden');
  } else {
    kaynak = '-';
  }
  r.pencere_kaynak = kaynak;
  for (const k of ['rps_sunucu', 'cpu_ms_istek', 'user_ms', 'sys_ms', 'cpu_oran_ms_sn', 'arka_ms_sn', 'host_cpu_ort',
    'host_cpu_max', 'pencere_sn', 'diger_rps']) r[k] = null;
  const rts = [];
  const bls = [];
  const crs = [];
  let s5xx = 0;
  for (const i of olcum) {
    if (!Number.isNaN(kayit.rt[i])) rts.push(kayit.rt[i] * 1000.0);
    if (!Number.isNaN(kayit.bl[i])) bls.push(kayit.bl[i]);
    if (!Number.isNaN(kayit.cr[i])) crs.push(kayit.cr[i]);
    const dr = kayit.durum[i];
    if (dr >= 500 && dr < 600) s5xx++;
  }
  r.sunucu_rt_p50 = yuzdelik(rts, 50);
  r.sunucu_rt_p95 = yuzdelik(rts, 95);
  r.sunucu_rt_p99 = yuzdelik(rts, 99);
  r.n_log_olcum = olcum.length;
  r.govde_bayt_istek = bls.length ? pyToplam(bls) / bls.length : null;
  r['yeniden_baglanti_%'] = crs.length ? (100.0 * crs.filter((c) => c > 1).length) / crs.length : null;
  // 429 her fazda sayilir (k6 ilk 429'da kosuyu keser); 5xx yalniz olcum fazinda (istemci sayaci da oyle)
  let s429 = 0;
  for (const i of satirlar) if (kayit.durum[i] === 429) s429++;
  if ((r.n_429 || 0) > 0 || s429) gecersiz.push(`429(istemci=${fd(r.n_429 || 0)},sunucu=${s429})`);
  if ((r.n_5xx || 0) > 0 || s5xx) gecersiz.push(`5xx(istemci=${fd(r.n_5xx || 0)},sunucu=${s5xx})`);
  if ((r.http2 || 0) > 0) gecersiz.push('http2');
  if ((r.hata_orani || 0) > HATA_ESIK + EPS) gecersiz.push(`hata_%${fx(100 * r.hata_orani, 2)}(>%${fx(100 * HATA_ESIK, 1)})`);
  if (r.n_olcum) {
    const fark = Math.abs(olcum.length - r.n_olcum) / r.n_olcum;
    r['log_istemci_fark_%'] = 100.0 * fark;
    if (satirlar.length && fark > LOG_ESIK_GECERSIZ) gecersiz.push(`log_istemci_farki_%${fx(100 * fark, 1)}`);
    if (!satirlar.length) uyari.push('sunucu_logunda_bu_tur_yok');
  } else {
    r['log_istemci_fark_%'] = null;
  }
  if (r.kip === 'yeni' && r['yeniden_baglanti_%'] !== null && r['yeniden_baglanti_%'] > 5) {
    uyari.push(`yeni_kipinde_baglanti_yeniden_kullanilmis_%${fx(r['yeniden_baglanti_%'], 0)}`);
  }
  if ((r.dropped || 0) > 0) uyari.push(`dropped_iterations=${fd(r.dropped)}`);
  let doyma = (r.dropped || 0) > 0;
  let kesitAdi = null;
  if (w0 !== null && w1 !== null && w1 > w0) {
    const kesit = kesitSec(ctx.kesitler, w0, w1);
    if (kesit === null) {
      uyari.push('sunucu_kaydi_yok');
    } else {
      kesitAdi = kesit.anahtar;
      const clk = clkAl(kesit);
      const pc = pencereCpu(kesit.ornekler, w0, w1, clk);
      const b = kesit.bilgi || {};
      for (const g of b.gecersiz || []) gecersiz.push('kayit:' + g);
      for (const nm of ['df_bas', 'df_bit']) {
        const v = sayi(b[nm]);
        if (v !== null && v >= DF_ESIK) {
          gecersiz.push(`disk_%${fd(v)}`);
          break;
        }
      }
      if (b.konf_hash_bas && b.konf_hash_bit && b.konf_hash_bas !== b.konf_hash_bit) gecersiz.push('konf_degisti');
      if (pc === null) {
        uyari.push('pencerede_ornek_yok');
      } else {
        r.pencere_sn = pc.dt;
        if (pc.dt < 30) gecersiz.push(`pencere_kisa(${fd(pc.dt)}s)`);
        if (pc.reload) gecersiz.push('reload(worker_pid_degisti)');
        r.host_cpu_ort = pc.host_ort;
        r.host_cpu_max = pc.host_max;
        if (pc.host_ort !== null && pc.host_ort > DOYMA_HOST_CPU) doyma = true;
        let ap = arkaKesit.get(kesit.anahtar);
        if (ap === null || ap === undefined) {
          uyari.push('arka_plan_yok(0_kabul)');
          ap = { user: 0.0, sys: 0.0, sn: 0 };
        } else if (ap.sn < 30) {
          uyari.push(`arka_plan_az(${fd(ap.sn)}s)`);
        }
        r.cpu_oran_ms_sn = pc.user + pc.sys;
        r.arka_ms_sn = ap.user + ap.sys;
        const f0 = Math.floor(pc.t0);
        const f1 = Math.floor(pc.t1);
        let rps;
        if (kaynak === 'log' && f1 > f0) {
          let n = 0;
          for (const i of olcum) {
            const t = kayit.t[i];
            if (f0 <= t && t < f1) n++;
          }
          rps = n / (f1 - f0);
          // range(f0, f1) uzerinden toplam; bozuk bir damga dev bir araliga yol acmasin diye kisa yoldan.
          let toplam = 0;
          if (f1 - f0 > ctx.diger.size) {
            for (const [t, adet] of ctx.diger) if (f0 <= t && t < f1) toplam += adet;
          } else {
            for (let t = f0; t < f1; t++) toplam += ctx.diger.get(t) || 0;
          }
          r.diger_rps = toplam / (f1 - f0);
        } else {
          rps = r.rps_gercek;
        }
        r.rps_sunucu = rps;
        if (rps) {
          const netUser = pc.user - ap.user;
          const netSys = pc.sys - ap.sys;
          r.user_ms = netUser / rps;
          r.sys_ms = netSys / rps;
          r.cpu_ms_istek = (netUser + netSys) / rps;
        }
        if (r.diger_rps && rps && r.diger_rps > 0.02 * rps) uyari.push(`diger_trafik_%${fx((100 * r.diger_rps) / rps, 0)}`);
      }
    }
  }
  if (r.adim.toLowerCase().includes('perf')) uyari.push('perf_ek_yuku(kararda_kullanilmaz)');
  r.durum = gecersiz.length ? 'GECERSIZ' : doyma ? 'DOYMA' : 'GECERLI';
  r.gecersiz_nedeni = gecersiz.join(';');
  r.uyari = uyari.join(';');
  r._gecersiz = gecersiz;
  r._uyari = uyari;
  r._s429 = s429;
  r._s5xx = s5xx;
  r._kesit = kesitAdi;
  return r;
}

// ---------------------------------------------------------------------------------------------
// Gruplama (tekrar ortalamasi) ve karar
// ---------------------------------------------------------------------------------------------

/** karsilastir.py `grupla`nin tek grup hesabi. `rs` = ayni (adim, senaryo, kip, ae, hiz) kosulari. */
function grupHesapla(rs) {
  const gecerli = rs.filter((r) => r.durum !== 'GECERSIZ');
  const cpuKume = gecerli.filter((r) => r.durum === 'GECERLI' && !String(r.adim).toLowerCase().includes('perf'));
  const o = { n_kosu: rs.length, n_gecerli: gecerli.length };
  for (const k of GRUP_ORTALAMA) o[k] = ortalama(gecerli.map((r) => r[k]));
  const hm = gecerli.map((r) => r.host_cpu_max).filter((x) => x !== null && x !== undefined);
  o.host_cpu_max = hm.length ? hm.reduce((a, b) => pyMax(a, b)) : null;
  for (const k of ['cpu_ms_istek', 'user_ms', 'sys_ms']) o[k] = ortalama(cpuKume.map((r) => r[k]));
  o.gurultu_cpu = gurultu(cpuKume.map((r) => r.cpu_ms_istek));
  o.gurultu_p95 = gurultu(gecerli.map((r) => r.p95));
  o.n_429 = rs.reduce((t, r) => t + (r.n_429 || 0), 0);
  o.n_5xx = rs.reduce((t, r) => t + (r.n_5xx || 0), 0);
  o.hata_max = rs.length ? rs.map((r) => r.hata_orani || 0).reduce((a, b) => pyMax(a, b)) : 0;
  o.gecersizler = rs.filter((r) => r.durum === 'GECERSIZ').map((r) => r.gecersiz_nedeni);
  o.doyma = rs.some((r) => r.durum === 'DOYMA');
  o.kosular = rs;
  if (!gecerli.length) o.durum = `GECERSIZ(${rs.length}/${rs.length})`;
  else if (gecerli.length < rs.length) o.durum = `KISMI(${gecerli.length}/${rs.length} gecerli)`;
  else o.durum = o.doyma ? 'DOYMA' : 'GECERLI';
  return o;
}

/** karsilastir.py `grupla`: anahtar (adim, senaryo, kip, ae, hiz), ilk gorulme sirasi. */
function grupla(kosular) {
  const gruplar = new Map();
  for (const r of kosular) {
    const anahtar = JSON.stringify([r.adim, r.senaryo, r.kip, r.ae, r.hiz]);
    if (!gruplar.has(anahtar)) gruplar.set(anahtar, { adim: r.adim, senaryo: r.senaryo, kip: r.kip, ae: r.ae, hiz: r.hiz, rs: [] });
    gruplar.get(anahtar).rs.push(r);
  }
  return [...gruplar.values()].map((g) => ({ adim: g.adim, senaryo: g.senaryo, kip: g.kip, ae: g.ae, hiz: g.hiz, o: grupHesapla(g.rs) }));
}

/** Tek kosunun (adimin) bir senaryo/kip/ae birlesimindeki gruplari: hiz -> grup (ilk gorulme sirasi). */
function hizGruplari(kosular, kombo) {
  const secili = kosular.filter((r) => r.senaryo === kombo.senaryo && r.kip === kombo.kip && r.ae === kombo.ae);
  const m = new Map();
  for (const g of grupla(secili)) if (!m.has(g.hiz)) m.set(g.hiz, g.o);
  return m;
}

function yeterliMi(g) {
  return g.n_gecerli >= Math.min(2, g.n_kosu);
}

function nedenMetni(kosular) {
  return kosular.filter((k) => k.durum === 'GECERSIZ').map((k) => `${k.tur}(${k.gecersiz_nedeni})`).join('; ');
}

const KOMBO_SIRA = { senaryo: ['K', 'B'], kip: ['yeni', 'ka'], ae: ['br', 'gzip', 'identity'] };
function komboSirasi(a, b) {
  for (const k of ['senaryo', 'kip', 'ae']) {
    const ia = KOMBO_SIRA[k].indexOf(a[k]);
    const ib = KOMBO_SIRA[k].indexOf(b[k]);
    const x = (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    if (x) return x;
    if (a[k] !== b[k]) return a[k] < b[k] ? -1 : 1;
  }
  return 0;
}

function komboSec(ref, ady) {
  const kombo = (r) => ({ senaryo: r.senaryo, kip: r.kip, ae: r.ae });
  const ad = (k) => `${k.senaryo}|${k.kip}|${k.ae}`;
  const rk = new Map(ref.map((r) => [ad(r), kombo(r)]));
  const ak = new Map(ady.map((r) => [ad(r), kombo(r)]));
  const varsayilan = { senaryo: 'K', kip: 'yeni', ae: 'br' };
  const v = ad(varsayilan);
  if (rk.has(v) && ak.has(v)) return varsayilan;
  const ortak = [...rk.keys()].filter((k) => ak.has(k)).map((k) => rk.get(k));
  if (ortak.length) return ortak.sort(komboSirasi)[0];
  if (rk.has(v) || ak.has(v) || (!rk.size && !ak.size)) return varsayilan;
  return [...ak.values(), ...rk.values()].sort(komboSirasi)[0];
}

function jsonNesne(x) {
  if (x && typeof x === 'object' && !Array.isArray(x)) return x;
  if (typeof x === 'string' && x.trim()) {
    try {
      const v = JSON.parse(x);
      return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
    } catch {
      return {};
    }
  }
  return {};
}

function jsonDizi(x) {
  if (Array.isArray(x)) return x;
  if (typeof x === 'string' && x.trim()) {
    try {
      const v = JSON.parse(x);
      return Array.isArray(v) ? v : [];
    } catch {
      return [];
    }
  }
  return [];
}

function al(s, k) {
  if (s[k] !== undefined) return s[k];
  return s[k.replace(/_([a-z0-9])/g, (_m, c) => c.toUpperCase())];
}

/**
 * Adim satirlarini (kosuAnaliz ciktisi ya da nginx_loadtest_adimlar DB satiri; snake_case ya da
 * camelCase; ham/nedenler JSON metni olabilir) Python `r` bicimine cevirir. HATALI satirlar
 * (ve bilinmeyen gecerlilik) karara girmez: Python onlari hic gormezdi.
 */
function kosulariHazirla(satirlar) {
  if (!Array.isArray(satirlar)) return [];
  const out = [];
  for (const s of satirlar) {
    if (!s || typeof s !== 'object') continue;
    const durum = String(al(s, 'gecerlilik') || '');
    if (durum !== 'GECERLI' && durum !== 'DOYMA' && durum !== 'GECERSIZ') continue;
    const ham = jsonNesne(al(s, 'ham'));
    const nedenler = jsonDizi(al(s, 'nedenler'));
    const tur = String(al(s, 'tur') || '');
    const p = tur.split('_');
    const gecersizNedeni = typeof ham.gecersiz_nedeni === 'string'
      ? ham.gecersiz_nedeni
      : nedenler.filter((n) => typeof n === 'string' && !n.startsWith('doyma:')).join(';');
    out.push({
      tur,
      adim: String(ham.adim || (p.length >= 6 ? p[0] : '')),
      senaryo: String(al(s, 'senaryo') || ''),
      kip: String(al(s, 'kip') || ''),
      ae: String(al(s, 'ae') || ''),
      hiz: Math.trunc(sayi(al(s, 'hiz')) || 0),
      durum,
      gecersiz_nedeni: gecersizNedeni,
      rps_gercek: sayi(al(s, 'gercek_rps')),
      p50: sayi(al(s, 'p50')),
      p95: sayi(al(s, 'p95')),
      p99: sayi(al(s, 'p99')),
      ttfb_p95: sayi(al(s, 'ttfb_p95')),
      tls_p95: sayi(al(s, 'tls_p95')),
      hata_orani: sayi(al(s, 'hata_orani')),
      sunucu_rt_p95: sayi(al(s, 'srt_p95')),
      bayt_istek: sayi(al(s, 'bayt_istek')),
      govde_bayt_istek: sayi(ham.govde_bayt_istek),
      host_cpu_ort: sayi(al(s, 'host_cpu_ort')),
      p95_buyuk: sayi(ham.p95_buyuk),
      diger_rps: sayi(ham.diger_rps),
      host_cpu_max: sayi(ham.host_cpu_max),
      cpu_ms_istek: sayi(al(s, 'cpu_ms_istek')),
      user_ms: sayi(ham.user_ms),
      sys_ms: sayi(ham.sys_ms),
      n_429: sayi(al(s, 'n_429')),
      n_5xx: sayi(al(s, 'n_5xx')),
    });
  }
  return out;
}

function grupOzeti(o) {
  const x = {};
  for (const [k, v] of Object.entries(o)) if (k !== 'kosular') x[k] = Array.isArray(v) ? v.slice() : v;
  x.turlar = o.kosular.map((r) => r.tur);
  return x;
}

function tabloYap(rG, aG) {
  const hizlar = [...new Set([...rG.keys(), ...aG.keys()])].sort((a, b) => a - b);
  return hizlar.map((h) => {
    const r = rG.get(h) || null;
    const a = aG.get(h) || null;
    const fark = {};
    for (const k of FARK_ALANLARI) {
      const v = r && a ? oran(a[k], r[k]) : null;
      fark[k] = v === null ? null : 100 * v;
    }
    return { hiz: h, ref: r && grupOzeti(r), aday: a && grupOzeti(a), fark_yuzde: fark };
  });
}

function secenekSayi(x, varsayilan) {
  const v = sayi(x);
  return v === null ? varsayilan : v;
}

function kademeSec(x, varsayilan) {
  const v = sayi(x);
  return v === null ? varsayilan : Math.trunc(v);
}

/**
 * Iki kosunun adim satirlari arasinda karar (karsilastir.py `karar_ver`).
 * @param {object[]} refAdimlar  referans kosunun adim satirlari
 * @param {object[]} adayAdimlar aday kosunun adim satirlari
 * @param {{esikCpu?: number, esikP95?: number, esikZarar?: number, kademeCpu?: number, kademeP95?: number}} [secenek]
 */
function kararVer(refAdimlar, adayAdimlar, secenek = {}) {
  const s = secenek || {};
  const esikCpu = secenekSayi(s.esikCpu, 10);
  const esikP95 = secenekSayi(s.esikP95, 10);
  const esikZarar = secenekSayi(s.esikZarar, 5);
  const ref = kosulariHazirla(refAdimlar);
  const ady = kosulariHazirla(adayAdimlar);
  const refAd = (ref.find((r) => r.adim) || {}).adim || 'referans';
  const adyAd = (ady.find((r) => r.adim) || {}).adim || 'aday';
  const kombo = komboSec(ref, ady);
  const rG = hizGruplari(ref, kombo);
  const aG = hizGruplari(ady, kombo);
  const ortak = [...rG.keys()].filter((h) => aG.has(h)).sort((a, b) => a - b);
  const kc = kademeSec(s.kademeCpu, ortak.length ? ortak[Math.floor(ortak.length / 2)] : null);
  const kp = kademeSec(s.kademeP95, ortak.length ? ortak[ortak.length - 1] : null);
  const tablo = tabloYap(rG, aG);
  const bitir = (karar, satirlar) => ({ karar, nedenler: satirlar, tablo, kademe: { cpu: kc, p95: kp }, kombinasyon: kombo });

  const sat = [];
  const adyKosular = [...aG.values()].flatMap((g) => g.kosular);
  sat.push(`referans=${refAd} aday=${adyAd} senaryo=${kombo.senaryo} kip=${kombo.kip} ae=${kombo.ae}`);
  if (!aG.size || !rG.size) {
    return bitir('VERI_YOK', [...sat, `${kombo.senaryo}/${kombo.kip}/${kombo.ae} kosusu eksik (referans ${rG.size} kademe, aday ${aG.size} kademe)`]);
  }
  // Hata referansa gore kiyaslanir: ayni kademedeki referans kosularinin en yuksek hata orani + %0.1.
  // (Bayat bir yolun 404'u referansta da varsa aday RET olmaz; referansin kendisi asagida GECERSIZ olur.)
  const hata = [];
  for (const k of adyKosular) {
    const rg = rG.get(k.hiz);
    const refHata = rg ? rg.kosular.map((x) => x.hata_orani || 0).reduce((a, b) => pyMax(a, b)) : 0;
    if ((k.n_429 || 0) > 0 || (k.n_5xx || 0) > 0 || k.gecersiz_nedeni.includes('429(') || k.gecersiz_nedeni.includes('5xx(')
      || (k.hata_orani || 0) > refHata + HATA_ESIK + EPS) hata.push([k, refHata]);
  }
  if (hata.length) {
    return bitir('RET', [...sat,
      'hata artti: ' + hata.map(([k, rh]) => `${k.tur} 429=${fd(k.n_429 || 0)} 5xx=${fd(k.n_5xx || 0)} hata=%${fx(100 * (k.hata_orani || 0), 2)} (referans %${fx(100 * rh, 2)})`).join('; '),
      'not: 429 = rate limit (yuk ayari) olabilir; nedeni giderip adimi tekrar kosun.']);
  }
  const ekTekrar = (gruplar, hizlar) => Math.min(MAX_TEKRAR, Math.max(...hizlar.map((h) => gruplar.get(h).n_kosu)) + 1);
  const eksikR = ortak.filter((h) => !yeterliMi(rG.get(h)));
  if (eksikR.length) {
    return bitir('GECERSIZ', [...sat,
      `referans ${refAd} kullanilamaz: ${eksikR.join(',')} istek/sn kademesinde yeterli gecerli kosu yok (en az 2): ${nedenMetni(eksikR.flatMap((h) => rG.get(h).kosular))}`,
      `once referansi duzeltin (hata_ ise: yollar hala 200 mu?), sonra referansi tekrar=${ekTekrar(rG, eksikR)} ile yeniden kosun`]);
  }
  const eksikA = [...aG.keys()].sort((a, b) => a - b).filter((h) => !yeterliMi(aG.get(h)));
  if (eksikA.length) {
    return bitir('GECERSIZ', [...sat,
      'tekrar kosun: ' + nedenMetni(adyKosular),
      `${eksikA.join(',')} istek/sn kademesinde yeterli gecerli kosu yok (en az 2). Adayi tekrar=${ekTekrar(aG, eksikA)} ile yeniden kosun (GECERSIZ kosu kararda dislanir)`]);
  }
  const notlar = [];
  const dislanan = nedenMetni(adyKosular);
  if (dislanan) notlar.push(`dislanan GECERSIZ kosu: ${dislanan} (her kademede en az 2 gecerli kosu kaldi)`);
  const rKc = kc === null ? undefined : rG.get(kc);
  const aKc = kc === null ? undefined : aG.get(kc);
  if (!rKc || !aKc || !rKc.cpu_ms_istek || rKc.cpu_ms_istek <= 0 || aKc.cpu_ms_istek === null) {
    if (rKc && aKc) {
      const doyan = [];
      if (rKc.doyma && rKc.cpu_ms_istek === null) doyan.push(`referans ${refAd}`);
      if (aKc.doyma && aKc.cpu_ms_istek === null) doyan.push(`aday ${adyAd}`);
      if (doyan.length) {
        return bitir('DOYMA', [...sat, `${fd(kc)} istek/sn kademesinde CPU-ms/istek yok: ${doyan.join(' ve ')} doydu (dropped>0 ya da host CPU>%90); daha dusuk bir kademeyle tekrar kosun`]);
      }
    }
    return bitir('VERI_YOK', [...sat, kc === null ? 'ortak istek/sn kademesi yok' : `${fd(kc)} istek/sn kademesinde CPU-ms/istek yok (sunucu kaydi?)`]);
  }
  let gCpu = rKc.gurultu_cpu;
  if (gCpu === null) {
    notlar.push('referansta tek tekrar: gurultu bilinmiyor (0 kabul)');
    gCpu = 0.0;
  }
  const esik1 = pyMax(esikCpu / 100.0, 3 * gCpu);
  const cpuKazanc = -oran(aKc.cpu_ms_istek, rKc.cpu_ms_istek);
  sat.push(`CPU-ms/istek @${fd(kc)}: ref=${fx(rKc.cpu_ms_istek, 3)} aday=${fx(aKc.cpu_ms_istek, 3)} kazanc=%${fx(100 * cpuKazanc, 1)} esik=%${fx(100 * esik1, 1)} (gurultu %${fx(100 * gCpu, 1)})`);
  const zarar = [];
  let cpuKotuMax = null;
  for (const h of ortak) {
    const rp = rG.get(h).p95;
    const ap = aG.get(h).p95;
    if (rp && ap !== null) {
      const kotu = oran(ap, rp);
      const ez = pyMax(esikZarar / 100.0, 3 * (rG.get(h).gurultu_p95 || 0));
      sat.push(`p95 @${fd(h)}: ref=${fx(rp, 1)} aday=${fx(ap, 1)} degisim=%${fxs(100 * kotu, 1)} (zarar esigi %${fx(100 * ez, 1)})`);
      if (kotu > ez + EPS) zarar.push(`p95 @${fd(h)} %${fxs(100 * kotu, 1)}`);
    }
    const rc = rG.get(h).cpu_ms_istek;
    const ac = aG.get(h).cpu_ms_istek;
    if (rc && ac !== null) {
      const v = oran(ac, rc);
      cpuKotuMax = cpuKotuMax === null ? v : pyMax(cpuKotuMax, v);
    }
  }
  const ezCpu = pyMax(esikZarar / 100.0, 3 * gCpu);
  if (-cpuKazanc > ezCpu + EPS) zarar.push(`CPU-ms/istek @${fd(kc)} %${fxs(-100 * cpuKazanc, 1)}`);
  const kosul1 = esikGecti(cpuKazanc, esik1) && !zarar.length;
  let kosul2 = false;
  const rKp = kp === null ? undefined : rG.get(kp);
  const aKp = kp === null ? undefined : aG.get(kp);
  if (rKp && aKp && rKp.p95 && aKp.p95 !== null) {
    const esik2 = pyMax(esikP95 / 100.0, 3 * (rKp.gurultu_p95 || 0));
    const p95Kazanc = -oran(aKp.p95, rKp.p95);
    kosul2 = esikGecti(p95Kazanc, esik2) && (cpuKotuMax === null || cpuKotuMax <= 0.05 + EPS);
    sat.push(`p95 kazanci @${fd(kp)}: %${fx(100 * p95Kazanc, 1)} esik=%${fx(100 * esik2, 1)}`);
  }
  if (Math.abs(cpuKazanc - esik1) <= 0.03) notlar.push('CPU kazanci esige 3 puandan yakin: 3. tekrar onerilir');
  // Ag maliyeti sunucu logundaki govde baytindan ($body_bytes_sent): k6 data_received yeni kipte her istegin
  // TLS el sikismasini (sertifika zinciri) ve basliklarini da sayar, sikistirma farkini kucuk gosterir.
  let rb = rKc.govde_bayt_istek;
  let ab = aKc.govde_bayt_istek;
  let kaynak = 'govde, sunucu logu';
  if (!rb || ab === null) {
    rb = rKc.bayt_istek;
    ab = aKc.bayt_istek;
    kaynak = 'istemci data_received: TLS + baslik dahil, fark kucuk gorunur';
  }
  if (rb && ab !== null) {
    const bd = oran(ab, rb);
    sat.push(`bayt/istek @${fd(kc)} [${kaynak}]: ref=${fx(rb, 0)} aday=${fx(ab, 0)} degisim=%${fxs(100 * bd, 1)}`);
    if (bd > 0.12 + EPS) notlar.push(`ag maliyeti: bayt/istek %${fxs(100 * bd, 1)} (> %12)`);
  }
  const bKombo = { senaryo: 'B', kip: 'yeni', ae: 'br' };
  const rB = hizGruplari(ref, bKombo);
  const aB = hizGruplari(ady, bKombo);
  for (const h of [...rB.keys()].filter((x) => aB.has(x)).sort((a, b) => a - b)) {
    const rt = rB.get(h).ttfb_p95;
    const at = aB.get(h).ttfb_p95;
    if (rt && at !== null) sat.push(`B (buyuk dosya) TTFB p95 @${fd(h)}: ref=${fx(rt, 1)} aday=${fx(at, 1)} degisim=%${fxs(100 * oran(at, rt), 1)}`);
  }
  let karar;
  if (zarar.length) {
    karar = 'RET';
    sat.push('zarar: ' + zarar.join('; '));
  } else if (kosul1 || kosul2) {
    karar = 'KALICI';
    sat.push('kural: ' + (kosul1 ? 'CPU kazanci esigi gecti ve zarar yok' : "p95 kazanci esigi gecti ve CPU %5'ten fazla kotulesmedi"));
  } else {
    karar = 'NOTR';
  }
  return bitir(karar, [...sat, ...notlar.map((n) => 'not: ' + n)]);
}

/**
 * T0 ayristirmasi (karsilastir.py `ayristirma`): ayni kademede K/yeni/br, K/ka/br ve K/yeni/identity
 * varsa CPU'yu TLS + TCP, sikistirma ve kalan olarak boler. Satirlar birden cok kosudan gelebilir.
 */
function ayristirma(adimlar, { kademe } = {}) {
  const k = kosulariHazirla(adimlar);
  const y = hizGruplari(k, { senaryo: 'K', kip: 'yeni', ae: 'br' });
  const ka = hizGruplari(k, { senaryo: 'K', kip: 'ka', ae: 'br' });
  const idn = hizGruplari(k, { senaryo: 'K', kip: 'yeni', ae: 'identity' });
  return ayristirmaGruplardan(y, ka, idn, kademe);
}

function ayristirmaGruplardan(y, ka, idn, kademe) {
  const ortak = [...y.keys()].filter((h) => ka.has(h) && idn.has(h)).sort((a, b) => a - b)
    .filter((h) => [y, ka, idn].every((g) => g.get(h).cpu_ms_istek !== null));
  if (!ortak.length) return null;
  const h = ortak.includes(kademe) ? kademe : ortak[Math.floor(ortak.length / 2)];
  const top = y.get(h).cpu_ms_istek;
  const tls = top - ka.get(h).cpu_ms_istek;
  const sik = top - idn.get(h).cpu_ms_istek;
  return { hiz: h, toplam: top, tls, sik, kalan: top - tls - sik, user: y.get(h).user_ms, sys: y.get(h).sys_ms };
}

// ---------------------------------------------------------------------------------------------
// Kosu analizi (Portal): KosuVerisi -> adim satirlari + kosu gecerliligi + ozet
// ---------------------------------------------------------------------------------------------

function adimHazirla(veri) {
  const istemci = new Map();
  for (const x of veri.istemci || []) if (x && x.satir && x.satir.tur) istemci.set(x.satir.tur, x.satir);
  const hatali = new Map();
  for (const x of veri.hataliIstemci || []) if (x && x.satir && x.satir.tur) hatali.set(x.satir.tur, x.satir);
  const zaman = new Map();
  const zamanTum = [];
  const zamanN = new Map();
  for (const s of veri.zaman || []) {
    const b = sayi(s.bas_epoch);
    const e = sayi(s.bit_epoch);
    if (s.tur && b !== null && e !== null) {
      zaman.set(s.tur, [b, e, s.rc !== undefined ? s.rc : '']);
      zamanTum.push([s.tur, b, e]);
      zamanN.set(s.tur, (zamanN.get(s.tur) || 0) + 1);
    }
  }
  const log = veri.log && veri.log.turlar instanceof Map ? veri.log : { fazlar: [], turlar: new Map() };
  return {
    istemci, hatali, zaman, zamanTum, zamanN,
    kesitler: Array.isArray(veri.kesitler) ? veri.kesitler : [],
    log: log.turlar,
    olcumKod: log.fazlar.indexOf('olcum'),
    diger: veri.diger instanceof Map ? veri.diger : new Map(),
  };
}

function tamVeyaNull(x) {
  const v = sayi(x);
  return v === null ? null : Math.trunc(v);
}

/** Python `r` -> nginx_loadtest_adimlar satiri (sozlesme 6/7). */
function adimSatiri(r, gecerlilik, nedenler, nproc, logVar, ist) {
  const tekrar = /_r([0-9]+)$/.exec(r.tur);
  const kapasite = nproc && r.cpu_ms_istek ? (nproc * 1000 * 0.8) / r.cpu_ms_istek : null;
  return {
    tur: r.tur,
    senaryo: r.senaryo,
    kip: r.kip,
    ae: r.ae,
    hiz: r.hiz,
    deneme: r.deneme !== null ? r.deneme : tamVeyaNull(ist.deneme),
    gecerlilik,
    nedenler,
    p50: r.p50,
    p95: r.p95,
    p99: r.p99,
    ttfb_p95: r.ttfb_p95,
    tls_p95: r.tls_p95,
    connect_p95: r.connect_p95,
    hata_orani: r.hata_orani,
    gercek_rps: r.rps_gercek,
    bayt_istek: r.bayt_istek,
    n_istek: r.n_olcum,
    n_429: r.n_429,
    n_5xx: r.n_5xx,
    dropped: r.dropped,
    istek_sunucu: logVar ? r.n_log_olcum : null,
    rps_sunucu: r.rps_sunucu,
    cpu_ms_istek: r.cpu_ms_istek,
    host_cpu_ort: r.host_cpu_ort,
    kapasite_rps: kapasite,
    srt_p50: r.sunucu_rt_p50,
    srt_p95: r.sunucu_rt_p95,
    srt_p99: r.sunucu_rt_p99,
    sikistirma_turu: r.sikistirma_turu ? String(r.sikistirma_turu) : null,
    ham: {
      adim: r.adim,
      tekrar: tekrar ? Number(tekrar[1]) : null,
      deneme_log: r.deneme,
      gecersiz_nedeni: r.gecersiz_nedeni,
      uyarilar: r._uyari.slice(),
      pencere_kaynak: r.pencere_kaynak,
      pencere_sn: r.pencere_sn,
      kesit: r._kesit,
      user_ms: r.user_ms,
      sys_ms: r.sys_ms,
      cpu_oran_ms_sn: r.cpu_oran_ms_sn,
      arka_ms_sn: r.arka_ms_sn,
      host_cpu_max: r.host_cpu_max,
      diger_rps: r.diger_rps,
      govde_bayt_istek: r.govde_bayt_istek,
      yeniden_baglanti_yuzde: r['yeniden_baglanti_%'],
      log_istemci_fark_yuzde: r['log_istemci_fark_%'],
      n_log_olcum: r.n_log_olcum,
      n_429_sunucu: r._s429,
      n_5xx_sunucu: r._s5xx,
      http2: r.http2,
      p95_js: r.p95_js,
      p95_css: r.p95_css,
      p95_html: r.p95_html,
      p95_json: r.p95_json,
      p95_config: r.p95_config,
      p95_buyuk: r.p95_buyuk,
      isinma_sn: r.isinma_sn,
      sure_sn: r.sure_sn,
    },
  };
}

/** DOYMA'nin nedeni Python'da nedenlere yazilmaz (yalniz uyari); Portal satirinda acikca gorunsun. */
function doymaNedenleri(r) {
  const n = [];
  if ((r.dropped || 0) > 0) n.push(`doyma:dropped=${fd(r.dropped)}`);
  if (r.host_cpu_ort !== null && r.host_cpu_ort > DOYMA_HOST_CPU) n.push(`doyma:host_cpu_%${fx(r.host_cpu_ort, 1)}(>%90)`);
  return n;
}

/**
 * TUR uyarilarini (adim satirlarinin ham.uyarilar'i, HATALI dahil, adim sirasiyla) kosu duzeyi listeye
 * "<tur>: <uyari>" olarak ekler: tekillestirilir, en cok MAX_ADIM_UYARI satir; fazlasi tek ozet satiri.
 * Yalniz `uyarilar`i degistirir (sona ekler); adim satirlari ve karar girdileri ayni kalir.
 */
function adimUyarilariniKat(uyarilar, adimlar) {
  const tekil = [];
  const gorulen = new Set();
  for (const a of adimlar) {
    for (const u of (a && a.ham && Array.isArray(a.ham.uyarilar) ? a.ham.uyarilar : [])) {
      const s = `${a.tur}: ${u}`;
      if (gorulen.has(s)) continue;
      gorulen.add(s);
      tekil.push(s);
    }
  }
  for (const s of tekil.slice(0, MAX_ADIM_UYARI)) uyarilar.push(s);
  if (tekil.length > MAX_ADIM_UYARI) uyarilar.push(`… ve ${tekil.length - MAX_ADIM_UYARI} adım uyarısı daha`);
  return uyarilar;
}

/** NaN/Infinity/undefined -> null (JSON ve DB FLOAT icin). */
function temizle(x) {
  if (x === undefined) return null;
  if (typeof x === 'number') return Number.isFinite(x) ? x : null;
  if (Array.isArray(x)) return x.map(temizle);
  if (x && typeof x === 'object') {
    const o = {};
    for (const [k, v] of Object.entries(x)) o[k] = temizle(v);
    return o;
  }
  return x;
}

/**
 * Bir kosu dizininin (tek ADIM) analizi. Kosu `uyarilar`i: okuma uyarilari, kesit/kayit uyarilari,
 * atlanan baska ADIM TUR'lari, sonra TUR uyarilari ("<tur>: <uyari>", bkz. adimUyarilariniKat).
 * @param {object} veri  sonuc.cjs kosuDiziniOku ciktisi
 * @param {{adim: string}} secenek  ornek 'R17'; bu ADIM'a ait olmayan TUR'lar atlanir (uyari)
 */
function kosuAnaliz(veri, { adim } = {}) {
  if (!veri || typeof veri !== 'object') throw new TypeError('kosuAnaliz: veri yok');
  if (typeof adim !== 'string' || !ADIM_RE.test(adim)) throw new TypeError('kosuAnaliz: adim gecersiz');
  const ctx = adimHazirla(veri);
  const uyarilar = Array.isArray(veri.uyarilar) ? veri.uyarilar.slice() : [];
  const dislama = dislamaListesi(ctx);
  const arka = new Map();
  for (const k of ctx.kesitler) {
    const ap = arkaPlan(k.ornekler || [], dislama, clkAl(k));
    arka.set(k.anahtar, ap);
    if (ap === null) uyarilar.push(`arka_plan_yok:${k.anahtar}(kosu_disi_bosluk_bulunamadi)`);
    for (const u of (k.bilgi && k.bilgi.uyari) || []) uyarilar.push(`kayit:${k.anahtar}:${u}`);
    if (!k.anahtar.startsWith(adim + '_')) uyarilar.push(`kesit_baska_adimin:${k.anahtar}`);
  }
  let nproc = null;
  for (const k of ctx.kesitler) {
    const v = sayi(k.bilgi ? k.bilgi.nproc : null);
    if (v) {
      nproc = v;
      break;
    }
  }
  const logVar = Array.isArray(veri.loglar) ? veri.loglar.length > 0 : ctx.log.size > 0;
  if (!ctx.kesitler.length) uyarilar.push('sunucu_kaydi_yok(cpu_olculmedi)');
  if (!logVar) uyarilar.push('sunucu_logu_yok(log_istemci_karsilastirmasi_yapilmadi)');

  const kosular = [];
  const adimlar = [];
  const atlanan = [];
  for (const [tur, ist] of ctx.istemci) {
    const r = kosuHesapla(ctx, tur, ist, arka);
    if (r.adim !== adim) {
      atlanan.push(tur);
      continue;
    }
    kosular.push(r);
    const nedenler = r.durum === 'DOYMA' ? doymaNedenleri(r) : r._gecersiz.slice();
    adimlar.push(adimSatiri(r, r.durum, nedenler, nproc, logVar, ist));
  }
  // kos.sh'in DUR dedigi (hatali_) ya da baslayip hic istemci sonucu yazmayan TUR'lar: HATALI.
  const hataliSatirlar = [];
  const gorulen = new Set(ctx.istemci.keys());
  const hataliEkle = (tur, ist, neden) => {
    if (gorulen.has(tur)) return;
    gorulen.add(tur);
    const r = kosuHesapla(ctx, tur, ist, arka);
    if (r.adim !== adim) {
      atlanan.push(tur);
      return;
    }
    hataliSatirlar.push(adimSatiri(r, 'HATALI', [neden, ...r._gecersiz], nproc, logVar, ist));
  };
  for (const [tur, ist] of ctx.hatali) hataliEkle(tur, ist, 'hatali_kosu(kos.sh_durdurdu)');
  const baslayanlar = [...(veri.baslatilan || []).map((s) => s.tur), ...ctx.zamanTum.map((z) => z[0])];
  for (const tur of baslayanlar) if (tur) hataliEkle(tur, Object.create(null), 'tamamlanmadi(istemci_sonucu_yok)');
  adimlar.push(...hataliSatirlar);
  for (const tur of atlanan) uyarilar.push(`baska_adim_atlandi:${tur}`);
  adimUyarilariniKat(uyarilar, adimlar);

  const gruplar = grupla(kosular).map((g) => {
    const x = grupOzeti(g.o);
    x.kapasite_tahmini_rps = nproc && g.o.cpu_ms_istek ? (nproc * 1000 * 0.8) / g.o.cpu_ms_istek : null;
    return { senaryo: g.senaryo, kip: g.kip, ae: g.ae, hiz: g.hiz, ...x };
  });
  const yG = hizGruplari(kosular, { senaryo: 'K', kip: 'yeni', ae: 'br' });
  const yHiz = [...yG.keys()].sort((a, b) => a - b);
  const ayr = ayristirmaGruplardan(
    yG,
    hizGruplari(kosular, { senaryo: 'K', kip: 'ka', ae: 'br' }),
    hizGruplari(kosular, { senaryo: 'K', kip: 'yeni', ae: 'identity' }),
    yHiz.length ? yHiz[Math.floor(yHiz.length / 2)] : null,
  );

  const sayac = { GECERLI: 0, DOYMA: 0, GECERSIZ: 0, HATALI: 0 };
  for (const a of adimlar) sayac[a.gecerlilik]++;
  const gecerli = sayac.GECERLI + sayac.DOYMA;
  let gecerlilik;
  const nedenler = [];
  if (!adimlar.length) {
    gecerlilik = 'GECERSIZ';
    nedenler.push('istemci_sonucu_yok');
  } else {
    gecerlilik = gecerli === 0 ? 'GECERSIZ' : gecerli < adimlar.length ? 'KISMI' : 'GECERLI';
    for (const a of adimlar) {
      if (a.gecerlilik === 'GECERSIZ' || a.gecerlilik === 'HATALI') nedenler.push(`${a.tur}(${a.nedenler.join(';')})`);
    }
  }
  const ozet = {
    adim,
    nproc,
    not: typeof veri.not === 'string' ? veri.not : '',
    turlar: { toplam: adimlar.length, ...sayac },
    kesitler: ctx.kesitler.map((k) => {
      const b = k.bilgi || {};
      const ap = arka.get(k.anahtar);
      return {
        anahtar: k.anahtar,
        ornek: (k.ornekler || []).length,
        bilgi_var: k.bilgiVar !== false,
        nproc: sayi(b.nproc),
        clk_tck: sayi(b.clk_tck),
        df_bas: sayi(b.df_bas),
        df_bit: sayi(b.df_bit),
        konf_degisti: !!(b.konf_hash_bas && b.konf_hash_bit && b.konf_hash_bas !== b.konf_hash_bit),
        test_satiri: sayi(b.test_satiri),
        diger_satiri: sayi(b.diger_satiri),
        bozuk_ua_satiri: sayi(b.bozuk_ua_satiri),
        gecersiz: (b.gecersiz || []).slice(),
        uyari: (b.uyari || []).slice(),
        arka_plan: ap ? { user: ap.user, sys: ap.sys, blok: ap.blok, sn: ap.sn } : null,
      };
    }),
    gruplar,
    ayristirma: ayr,
    cpu_tlsli_pay: ayr && ayr.toplam ? ayr.tls / ayr.toplam : null,
    loglar: Array.isArray(veri.loglar) ? veri.loglar.map((l) => ({ dosya: l.dosya, satir: l.satir, atlanan: l.atlanan })) : [],
    sha256: veri.sha256 || null,
    okunan_bayt: typeof veri.okunanBayt === 'number' ? veri.okunanBayt : null,
  };
  return temizle({ gecerlilik, nedenler, uyarilar, adimlar, ozet });
}

module.exports = {
  kosuAnaliz,
  kararVer,
  ayristirma,
  NEDENLER,
  EPS,
  _pyForTest: { sayi, pyToplam, pyMax, esikGecti, yuzdelik, medyan, ortalama, gurultu, oran, pyYuvarla, fx, fxs, fd },
  _kosulariHazirlaForTest: kosulariHazirla,
  _adimUyarilariniKatForTest: adimUyarilariniKat,
};
