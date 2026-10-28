// server/nginx-loadtest/__tests__/fixtures/wrk-serbest.cjs -- tur 3 fiksturleri: wrk istemci dosyalari
// ve serbest hedef kosu dizini (analiz.test AN13-AN20, sonuc.test SN21).
//
// wrk (sozlesme tur 3, 5.4): istemci_<TUR>.csv / .json'u wrk_kos.sh'in awk bicimleyicisi yazar; sema
// yuk_k6.js ile AYNI (30 kolon, ayni dosya adlari) ama wrk'nin olcemedigi alanlar BOS hucre / null'dur,
// ASLA 0: ttfb_p95, tls_p95, connect_p95, dropped, p95_js..p95_config, p95_buyuk. http2 olculmus 0 (wrk
// yalniz HTTP/1.1 konusur). `hiz` = baglanti sayisi. CSV sayi hucresi %.15g(int(v*1000+0.5)/1000) (k6
// `hucre` ile ayni yuvarlama); JSON JSON_ANAHTARLARI sirasiyla, 2 bosluk girinti, sayi %.15g YUVARLANMAMIS.
// Serbest hedef (hedefe SSH yok, kaydedici yok): kosu dizininde yalniz yuk makinesinin dosyalari olur:
// istemci_*, hatali_istemci_*, zaman.csv, baslatilan.csv (+ Play 6'nin SHA256SUMS'i).
// Rastgelelik, saat ya da ortam okunmaz; dosyalar kurgu.cjs portalDuzeniYaz ile gecici dizine yazilir.
'use strict';

const { KOLON } = require('./kurgu.cjs');

// wrk_kos.sh JSON_ANAHTARLARI (sozlesme 5.1): yuk_k6.js ozet_hesapla ciktisinin anahtar sirasi.
const JSON_ANAHTARLARI = Object.freeze(('tur adim senaryo kip ae hiz n_olcum rps_gercek p50 p95 p99 ttfb_p95 tls_p95 ' +
  'connect_p95 hata_orani n_429 n_5xx dropped http2 bayt_istek p95_buyuk sikistirma_turu isinma_sn sure_sn deneme ' +
  'p95_js p95_css p95_html p95_json p95_config').split(' '));
// wrk'nin olcemedigi istemci alanlari (5.4): null, CSV'de bos hucre.
const WRK_OLCULMEYEN = Object.freeze(['ttfb_p95', 'tls_p95', 'connect_p95', 'dropped', 'p95_js', 'p95_css', 'p95_html',
  'p95_json', 'p95_config', 'p95_buyuk']);
/** wrk satirinda ZORLA yazilan alanlar: olculmeyenler null, http2 0. */
const WRK_ALANLARI = Object.freeze({ ...Object.fromEntries(WRK_OLCULMEYEN.map((k) => [k, null])), http2: 0 });

/** C printf %.15g (fikstur buyuklukleri icin; ussel bicim gerektiren deger fikstur hatasidir). */
function g15(x) {
  if (x === 0) return '0';
  const us = Math.floor(Math.log10(Math.abs(x)));
  if (us < -4 || us >= 15) throw new Error(`fikstur: %.15g ussel bicim desteklenmez (${x})`);
  return String(Number(x.toPrecision(15)));
}

/** wrk_kos.sh CSV hucresi: sayi %.15g(int(v*1000+0.5)/1000), null bos, metinde virgul / CR / LF bosluk. */
function wrkHucre(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return g15(Math.trunc(v * 1000 + 0.5) / 1000);
  return String(v).replace(/[,\r\n]/g, ' ');
}

/**
 * wrk_kos.sh istemci dosyalari (5.4). `d`: istemci satiri (KOLON adlari); olculmeyen alanlar ve http2
 * verilse de WRK_ALANLARI ile ezilir. Doner { csv, json } (ikisi de satir sonuyla biter).
 */
function wrkIstemci(d) {
  const x = { ...Object.fromEntries(KOLON.map((k) => [k, null])), ...d, ...WRK_ALANLARI };
  const csv = KOLON.join(',') + '\n' + KOLON.map((k) => wrkHucre(x[k])).join(',') + '\n';
  const j = {};
  for (const k of JSON_ANAHTARLARI) j[k] = typeof x[k] === 'number' ? Number(g15(x[k])) : x[k] === undefined ? null : x[k];
  return { csv, json: JSON.stringify(j, null, 2) + '\n' };
}

/** Kurgu.kosu'nun wrk esi: istemci satirina WRK_ALANLARI yazilir (sunucu verisi Kurgu'daki gibi uretilir). */
function wrkKosu(kurgu, o = {}) {
  return kurgu.kosu({ ...o, istemciAlan: { ...(o.istemciAlan || {}), ...WRK_ALANLARI } });
}

/** Kurgu dosyalarindaki istemci_*.csv / .json ve hatali_istemci_*.csv'yi wrk_kos.sh bicimiyle yeniden yazar. */
function wrkDosyalari(kurgu, dosyalar) {
  const out = new Map(dosyalar);
  const yaz = (ad, icerik) => {
    if (out.has(ad)) out.set(ad, { ...out.get(ad), icerik });
  };
  for (const d of kurgu.istemci) {
    const { csv, json } = wrkIstemci(d);
    yaz(`istemci_${d.tur}.csv`, csv);
    yaz(`istemci_${d.tur}.json`, json);
  }
  for (const d of kurgu.hatali) yaz(`hatali_istemci_${d.tur}.csv`, wrkIstemci(d).csv);
  return out;
}

// Serbest kosu dizinine giren (yuk makinesinin yazdigi) dosyalar; gerisi (sunucu_, bilgi_, log_, diger_, konf_,
// NOT.txt: hedef kaydedicisinin ciktilari) serbest hedefte YOKTUR.
const YUK_MAKINESI_RE = /^(?:(?:hatali_)?istemci_.*\.(?:csv|json)|zaman\.csv|baslatilan\.csv)$/;

/** Kurgu dosyalarindan serbest hedef kosu dizini: yalniz yuk makinesinin dosyalari. */
function serbestDosyalari(dosyalar) {
  return new Map([...dosyalar].filter(([ad]) => YUK_MAKINESI_RE.test(ad)));
}

// ELLE yazilmis wrk_kos.sh ciktisi (5.4; SN21): 4 baglanti, 2 is parcacigi, ka, br; olcum ozeti
// istek=22812 bayt=35004321 s2xx=22805 s4xx=7 e_timeout=1 p50_us=12346 p95_us=25512 p99_us=40125, SURE 120 sn;
// isinma s429=0. rps 22812/120; hata (7+1)/22812 -> CSV'de 3 haneye yuvarlanir (0), JSON'da tam.
const WRK_ORNEK = Object.freeze({
  tur: 'R70_K_ka_br_4_r1',
  satir: Object.freeze({
    tur: 'R70_K_ka_br_4_r1', adim: 'R70', senaryo: 'K', kip: 'ka', ae: 'br', hiz: 4, n_olcum: 22812, rps_gercek: 22812 / 120,
    p50: 12.346, p95: 25.512, p99: 40.125, hata_orani: 8 / 22812, n_429: 0, n_5xx: 0, bayt_istek: 35004321 / 22812,
    sikistirma_turu: 'STATIK', isinma_sn: 30, sure_sn: 120, deneme: 1,
  }),
  csv: KOLON.join(',') + '\n' +
    'R70_K_ka_br_4_r1,R70,K,ka,br,4,22812,190.1,12.346,25.512,40.125,,,,0,0,0,,0,1534.47,,,,,,,STATIK,30,120,1\n',
  json: [
    '{',
    '  "tur": "R70_K_ka_br_4_r1",',
    '  "adim": "R70",',
    '  "senaryo": "K",',
    '  "kip": "ka",',
    '  "ae": "br",',
    '  "hiz": 4,',
    '  "n_olcum": 22812,',
    '  "rps_gercek": 190.1,',
    '  "p50": 12.346,',
    '  "p95": 25.512,',
    '  "p99": 40.125,',
    '  "ttfb_p95": null,',
    '  "tls_p95": null,',
    '  "connect_p95": null,',
    '  "hata_orani": 0.000350692617920393,',
    '  "n_429": 0,',
    '  "n_5xx": 0,',
    '  "dropped": null,',
    '  "http2": 0,',
    '  "bayt_istek": 1534.46962125197,',
    '  "p95_buyuk": null,',
    '  "sikistirma_turu": "STATIK",',
    '  "isinma_sn": 30,',
    '  "sure_sn": 120,',
    '  "deneme": 1,',
    '  "p95_js": null,',
    '  "p95_css": null,',
    '  "p95_html": null,',
    '  "p95_json": null,',
    '  "p95_config": null',
    '}',
    '',
  ].join('\n'),
  zaman: 'tur,bas_epoch,bit_epoch,rc,deneme\nR70_K_ka_br_4_r1,1800000060,1800000211,0,1\n',
  baslatilan: 'tur,bas_epoch,deneme\nR70_K_ka_br_4_r1,1800000060,1\n',
});

/** WRK_ORNEK'in serbest kosu dizini dosyalari (portalDuzeniYaz bicimi; SHA256SUMS'i o yazar). */
function wrkOrnekDosyalari() {
  const f = (icerik) => ({ icerik, py: false, portal: true, log: false });
  return new Map([
    [`istemci_${WRK_ORNEK.tur}.csv`, f(WRK_ORNEK.csv)],
    [`istemci_${WRK_ORNEK.tur}.json`, f(WRK_ORNEK.json)],
    ['zaman.csv', f(WRK_ORNEK.zaman)],
    ['baslatilan.csv', f(WRK_ORNEK.baslatilan)],
  ]);
}

module.exports = {
  JSON_ANAHTARLARI, WRK_OLCULMEYEN, WRK_ALANLARI, WRK_ORNEK, g15, wrkHucre, wrkIstemci, wrkKosu, wrkDosyalari,
  serbestDosyalari, wrkOrnekDosyalari,
};
