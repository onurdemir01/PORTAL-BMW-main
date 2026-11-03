// server/nginx-loadtest/__tests__/gorunum.test.cjs -- gorunum.cjs (sade turu, 2026-11-02).
//
//   GR1 eski R2 satirlari: negatif CPU-ms/istek ve kapasite null + cpuOlculemedi; reload nedenli satirin
//       pozitif degeri de null ('reload'); DB disi alanlar AYNEN; yeni analizin kodu (ham.cpu_olculemedi) oncelikli
//   GR2 reloadlar: ham.reloadlar camelCase; bozuk / bilinmeyen faz atlanir; eski satir []
//   GR3 sonucOzeti: toplam istek, p95 en iyi / en kotu (gecerli; yoksa tum), 429 / 5xx / hata, konf, reloadlar
//   GR4 bos / eski kosu: adim yok, ozet yok -> null / 0 / [] (cokmez)
//   GR-H 'olcum_kenari' fazli reload olayi (olcum fazinin basi / sonu, CPU penceresi disi) adim ve ozete gecer
//   GR-K1 kip dogrulamasi protokol: istenen / olculen (protokol kolonu; yoksa http2 sayaci), uyumsuz > 0 uyari; wrk olculmedi
//   GR-K2 baglanti: yeni %5 uyarisi AYNEN (analizin kodu), ka > %20 uyari (esitlik tamam), istek / baglanti = 100 / pay;
//         serbest ve log yok olculmedi
//   GR-K3 sikistirma: br 1 KB ustu payi < %50 uyari (1 KB alti ayri), identity'de sikistirilmis yanit uyari; eski k6 /
//         wrk / n=0 olculmedi; genel durum (uyari > tamam > olculmedi); her uyari kodu KIP_KALIPLARI'ndan birine uyar;
//         uyari yuzdesi tek ondaliga asagi (%49,96 -> 49.9, %0,06 -> 0.0)
//   GR-B  bellek: ham.bellek camelCase; eski satir null (hic anahtar yok ya da hepsi null)
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { adimGorunumu, sonucOzeti, kipDogrulama, KIP_KALIPLARI } = require('../gorunum.cjs');

// Ilk gercek kosu R2 (AWX 3474239) satirlarinin bicimi: 100_r2 ve 250_r2 reload + konf_degisti, negatif CPU.
function r2Satirlari() {
  const ortak = { senaryo: 'K', kip: 'ka', ae: 'identity', deneme: 1, n5xx: 0, ttfbP95: 1.5 };
  return [
    { ...ortak, tur: 'R2_K_ka_identity_100_r1', hiz: 100, gecerlilik: 'GECERSIZ', nedenler: ['konf_degisti'], nIstek: 12001, gercekRps: 100.008, p50: 1.609, p95: 2.126, p99: 2.534, hataOrani: 0, n429: 0, hostCpuOrt: 3.1, cpuMsIstek: 0.21, kapasiteRps: 30476, ham: { uyarilar: [] } },
    { ...ortak, tur: 'R2_K_ka_identity_100_r2', hiz: 100, gecerlilik: 'GECERSIZ', nedenler: ['konf_degisti', 'reload(worker_pid_degisti)'], nIstek: 11996, gercekRps: 99.967, p50: 1.542, p95: 1.984, p99: 5.203, hataOrani: 0, n429: 0, hostCpuOrt: 3.0, cpuMsIstek: -1.372, kapasiteRps: -4665, ham: { uyarilar: ['dropped_iterations=4'] } },
    { ...ortak, tur: 'R2_K_ka_identity_250_r2', hiz: 250, gecerlilik: 'GECERSIZ', nedenler: ['konf_degisti', 'reload(worker_pid_degisti)'], nIstek: 29937, gercekRps: 249.475, p50: 1.227, p95: 1.728, p99: 4.997, hataOrani: 0, n429: 0, hostCpuOrt: 5.2, cpuMsIstek: -0.873, kapasiteRps: -7328, ham: null },
    { ...ortak, tur: 'R2_K_ka_identity_400_r1', hiz: 400, gecerlilik: 'GECERSIZ', nedenler: ['konf_degisti'], nIstek: 48001, gercekRps: 400.008, p50: 1.026, p95: 1.404, p99: 1.953, hataOrani: 0, n429: 0, hostCpuOrt: 7.9, cpuMsIstek: 0.0, kapasiteRps: null, ham: { uyarilar: [] } },
  ];
}

test('GR1 eski satir: negatif / sifir CPU ve kapasite null + neden; reload nedenli pozitif deger de null', () => {
  const [a, b, c, d] = r2Satirlari().map(adimGorunumu);
  assert.deepEqual([a.cpuMsIstek, a.kapasiteRps, a.cpuOlculemedi], [0.21, 30476, null], 'olculmus pozitif deger kalir');
  assert.deepEqual([b.cpuMsIstek, b.kapasiteRps, b.cpuOlculemedi], [null, null, 'reload']);
  assert.deepEqual([c.cpuMsIstek, c.kapasiteRps, c.cpuOlculemedi], [null, null, 'reload']);
  assert.deepEqual([d.cpuMsIstek, d.kapasiteRps, d.cpuOlculemedi], [null, null, 'negatif_deger'], '0 ms/istek olculmus deger degil');
  // Reload nedeni yok ama negatif: negatif_deger.
  const e = adimGorunumu({ tur: 'R2_x_100_r1', gecerlilik: 'GECERLI', nedenler: [], cpuMsIstek: -0.5, kapasiteRps: null, ham: {} });
  assert.deepEqual([e.cpuMsIstek, e.cpuOlculemedi], [null, 'negatif_deger']);
  const f = adimGorunumu({ tur: 'R2_x_100_r1', gecerlilik: 'GECERLI', nedenler: [], cpuMsIstek: 0.4, kapasiteRps: -3, ham: {} });
  assert.deepEqual([f.cpuMsIstek, f.kapasiteRps, f.cpuOlculemedi], [null, null, 'negatif_deger']);
  // Yeni analizin kodu oncelikli; reload nedenli ama CPU hic yok (null) -> kod uydurulmaz.
  const g = adimGorunumu({ tur: 'R3_x_100_r1', gecerlilik: 'GECERLI', nedenler: [], cpuMsIstek: null, kapasiteRps: null, ham: { cpu_olculemedi: 'net_negatif' } });
  assert.equal(g.cpuOlculemedi, 'net_negatif');
  const h = adimGorunumu({ tur: 'R3_x_100_r1', gecerlilik: 'GECERSIZ', nedenler: ['reload(worker_pid_degisti)'], cpuMsIstek: null, kapasiteRps: null, ham: {} });
  assert.equal(h.cpuOlculemedi, null);
  const i = adimGorunumu({ tur: 'R3_x_100_r1', gecerlilik: 'GECERLI', nedenler: [], cpuMsIstek: 0.3, kapasiteRps: 100, ham: { cpu_olculemedi: 'uydurma' } });
  assert.deepEqual([i.cpuMsIstek, i.cpuOlculemedi], [0.3, null], 'bilinmeyen kod yok sayilir');
  // Diger alanlar aynen.
  const ham = r2Satirlari()[1];
  for (const k of Object.keys(ham)) if (!['cpuMsIstek', 'kapasiteRps'].includes(k)) assert.deepEqual(b[k], ham[k], k);
});

test('GR2 reloadlar: ham.reloadlar camelCase, bozuk girdi atlanir, eski satir bos', () => {
  const a = adimGorunumu({ tur: 'R5_K_ka_br_250_r1', nedenler: [], ham: { reloadlar: [
    { t: 1800000284.5, t_once: 1800000283.5, t_son: 1800000290, tur: 'R5_K_ka_br_250_r1', faz: 'olcum' },
    { t: 1800000300, t_once: null, t_son: 1800000301, tur: null, faz: 'kosu_oncesi' },
    { t: 'x', t_son: 1, faz: 'olcum' },
    { t: 1, t_son: 2, faz: 'baska' },
    null,
  ] } });
  assert.deepEqual(a.reloadlar, [
    { t: 1800000284.5, tOnce: 1800000283.5, tSon: 1800000290, tur: 'R5_K_ka_br_250_r1', faz: 'olcum' },
    { t: 1800000300, tOnce: null, tSon: 1800000301, tur: null, faz: 'kosu_oncesi' },
  ]);
  assert.deepEqual(adimGorunumu({ tur: 'R2_x', ham: null }).reloadlar, []);
  assert.deepEqual(adimGorunumu({ tur: 'R2_x', ham: { uyarilar: [] } }).reloadlar, []);
});

test('GR3 sonucOzeti: toplam istek, p95 en iyi / en kotu, 429 / 5xx / hata, konf, reloadlar', () => {
  const adimlar = r2Satirlari().map(adimGorunumu);
  const ozet = {
    kesitler: [{ anahtar: 'R2_gbngxt33', konf_degisti: true }],
    reloadlar: [
      { kesit: 'R2_gbngxt33', t: 20, t_once: 19, t_son: 25, worker_once: 8, worker_sonra: 16, kapanan_en_cok: 8, tur: 'R2_K_ka_identity_250_r2', faz: 'olcum', etkilenen_turlar: ['R2_K_ka_identity_250_r2'] },
      { kesit: 'R2_gbngxt33', t: 10, t_once: 9, t_son: 12, worker_once: 8, worker_sonra: 8, kapanan_en_cok: 0, tur: 'R2_K_ka_identity_100_r2', faz: 'olcum', etkilenen_turlar: ['R2_K_ka_identity_100_r2', 'bozuk ad'] },
      { t: 'bozuk' },
    ],
  };
  const o = sonucOzeti(adimlar, ozet);
  assert.deepEqual(o, {
    adimSayisi: 4,
    gecerliAdimSayisi: 0,
    toplamIstek: 12001 + 11996 + 29937 + 48001,
    p95EnIyi: { deger: 1.404, tur: 'R2_K_ka_identity_400_r1' },
    p95EnKotu: { deger: 2.126, tur: 'R2_K_ka_identity_100_r1' },
    p95Kapsam: 'tum',
    toplam429: 0,
    toplam5xx: 0,
    enYuksekHataOrani: 0,
    hataVar: false,
    cpuOlculemeyenAdim: 3,
    yukDoyduAdim: 0,
    konfDegisti: true,
    reloadlar: [
      { t: 10, tOnce: 9, tSon: 12, tur: 'R2_K_ka_identity_100_r2', faz: 'olcum', kesit: 'R2_gbngxt33', workerOnce: 8, workerSonra: 8, kapananEnCok: 0, etkilenenTurlar: ['R2_K_ka_identity_100_r2'] },
      { t: 20, tOnce: 19, tSon: 25, tur: 'R2_K_ka_identity_250_r2', faz: 'olcum', kesit: 'R2_gbngxt33', workerOnce: 8, workerSonra: 16, kapananEnCok: 8, etkilenenTurlar: ['R2_K_ka_identity_250_r2'] },
    ],
  });
  // Gecerli adim varsa p95 yalniz onlardan; hata / 429 / 5xx toplanir, HATALI satir sayilir.
  const k = [
    { tur: 'R7_a_100_r1', gecerlilik: 'GECERLI', p95: 9, nIstek: 100, n429: 0, n5xx: 0, hataOrani: 0 },
    { tur: 'R7_a_250_r1', gecerlilik: 'DOYMA', p95: 30, nIstek: 200, n429: null, n5xx: 2, hataOrani: 0.002 },
    { tur: 'R7_a_400_r1', gecerlilik: 'GECERSIZ', p95: 1, nIstek: null, n429: 3, n5xx: null, hataOrani: null },
    { tur: 'R7_a_400_r2', gecerlilik: 'HATALI', p95: null, nIstek: 7, n429: 1, n5xx: 0, hataOrani: 0.5, cpuOlculemedi: 'reload' },
  ];
  const p = sonucOzeti(k, { kesitler: [{ konf_degisti: false }] });
  assert.deepEqual(
    [p.adimSayisi, p.gecerliAdimSayisi, p.toplamIstek, p.p95EnIyi, p.p95EnKotu, p.p95Kapsam, p.toplam429, p.toplam5xx, p.enYuksekHataOrani, p.hataVar, p.cpuOlculemeyenAdim, p.konfDegisti, p.reloadlar],
    [4, 2, 307, { deger: 9, tur: 'R7_a_100_r1' }, { deger: 30, tur: 'R7_a_250_r1' }, 'gecerli', 4, 2, 0.5, true, 1, false, []],
  );
  // Yalniz 429 hata sayilir.
  assert.equal(sonucOzeti([{ tur: 'R8_a', gecerlilik: 'GECERLI', n429: 1, n5xx: 0, hataOrani: 0 }], null).hataVar, true);
  assert.equal(sonucOzeti([{ tur: 'R8_a', gecerlilik: 'GECERLI', n429: 0, n5xx: 1, hataOrani: 0 }], null).hataVar, true);
});

test('GR4 bos / eski kosu: adim ve analiz ozeti yok -> null / 0 / [] (cokmez)', () => {
  const bos = {
    adimSayisi: 0, gecerliAdimSayisi: 0, toplamIstek: null, p95EnIyi: null, p95EnKotu: null, p95Kapsam: null, toplam429: null,
    toplam5xx: null, enYuksekHataOrani: null, hataVar: false, cpuOlculemeyenAdim: 0, yukDoyduAdim: 0, konfDegisti: null, reloadlar: [],
  };
  assert.deepEqual(sonucOzeti([], null), bos);
  assert.deepEqual(sonucOzeti(undefined, undefined), bos);
  assert.deepEqual(sonucOzeti([], { kirpildi: true }), bos);
  assert.deepEqual(sonucOzeti([], []), bos);
});

// -- h2_sozlesme.md 4.5 / 6: 'olcum_kenari' fazi (olcum fazinin basi / sonu, CPU penceresi disinda) API'ye gecer.
test('GR-H olcum_kenari fazli reload olayi adim ve ozet gorunumune gecer', () => {
  const ham = { t: 1800000072, t_once: 1800000071, t_son: 1800000072, tur: 'R60_K_yeni_br_100_r1', faz: 'olcum_kenari' };
  const a = adimGorunumu({ tur: 'R60_K_yeni_br_100_r1', nedenler: [], ham: { reloadlar: [ham] } });
  assert.deepEqual(a.reloadlar, [{ t: 1800000072, tOnce: 1800000071, tSon: 1800000072, tur: 'R60_K_yeni_br_100_r1', faz: 'olcum_kenari' }]);
  const o = sonucOzeti([a], { reloadlar: [{ ...ham, kesit: 'R60_test', worker_once: 2, worker_sonra: 2, kapanan_en_cok: 0, etkilenen_turlar: ['R60_K_yeni_br_100_r1'] }] });
  assert.deepEqual(o.reloadlar.map((x) => [x.faz, x.tur, x.kesit, x.etkilenenTurlar]), [['olcum_kenari', 'R60_K_yeni_br_100_r1', 'R60_test', ['R60_K_yeni_br_100_r1']]]);
});

// -- 2026-11-03 (K3): yuk makinesi doymus adim (doyma:yuk_cpu_bosta_) p95 en iyi / en kotuya girmez; alanlar gorunumde.
test('GR5 YUK_DOYDU: yukCpuBosta / yukDoydu adim gorunumunde; p95 en iyi / en kotu disinda; eski satir null / false', () => {
  const a = adimGorunumu({ tur: 'R9_K_yeni_br_5000_r1', gecerlilik: 'DOYMA', p95: 1, nedenler: ['doyma:yuk_cpu_bosta_%12.5(<%20)'], ham: { yuk_cpu_bosta: 12.5 } });
  assert.equal(a.yukCpuBosta, 12.5);
  assert.equal(a.yukDoydu, true);
  const eski = adimGorunumu({ tur: 'R9_K_yeni_br_100_r1', gecerlilik: 'DOYMA', p95: 5, nedenler: ['doyma:dropped=3'], ham: {} });
  assert.equal(eski.yukCpuBosta, null);
  assert.equal(eski.yukDoydu, false);
  const g = adimGorunumu({ tur: 'R9_K_yeni_br_1000_r1', gecerlilik: 'GECERLI', p95: 9, nedenler: [], ham: { yuk_cpu_bosta: 55 } });
  const o = sonucOzeti([a, eski, g], null);
  assert.deepEqual([o.p95EnIyi, o.p95EnKotu, o.p95Kapsam, o.yukDoyduAdim, o.gecerliAdimSayisi],
    [{ deger: 5, tur: 'R9_K_yeni_br_100_r1' }, { deger: 9, tur: 'R9_K_yeni_br_1000_r1' }, 'gecerli', 1, 3]);
  // Yalniz YUK_DOYDU adim varsa p95 tum satirlardan (kapsam 'tum'): bos kalmaz.
  const y = sonucOzeti([a], null);
  assert.deepEqual([y.p95EnIyi, y.p95Kapsam], [{ deger: 1, tur: 'R9_K_yeni_br_5000_r1' }, 'tum']);
  // B1: kayit beklenip olculemeyen adim (ham.yuk_cpu_olculemedi true) -> yukCpuOlculemedi; eski / olculmus satir false.
  assert.equal(adimGorunumu({ tur: 'R9_K_yeni_br_100_r2', gecerlilik: 'GECERLI', nedenler: [], ham: { yuk_cpu_olculemedi: true } }).yukCpuOlculemedi, true);
  assert.equal(adimGorunumu({ tur: 'R9_K_yeni_br_100_r2', gecerlilik: 'GECERLI', nedenler: [], ham: { yuk_cpu_olculemedi: 'evet' } }).yukCpuOlculemedi, false);
  assert.deepEqual([a.yukCpuOlculemedi, eski.yukCpuOlculemedi, adimGorunumu({ tur: 'R9_K_yeni_br_100_r2', gecerlilik: 'GECERLI' }).yukCpuOlculemedi], [false, false, false]);
});

// ---------------------------------------------------------------------------------------------
// 2026-11-03: kip dogrulamasi ve bellek (yalniz gorunum; analiz ciktisi DEGISMEZ)
// ---------------------------------------------------------------------------------------------
const kipKodu = (u) => KIP_KALIPLARI.find((k) => k.re.test(u));

test('GR-K1 kip protokol: kolon ya da http2 sayaci; uyumsuz > 0 uyari; wrk olculmedi', () => {
  const k = (ham, s = {}) => kipDogrulama({ kip: 'ka', ae: 'br', ham }, s).protokol;
  assert.deepEqual(k({ protokol: 'h1', protokol_uyumsuz: 0 }), { istenen: 'h1', olculen: 'h1', uyumsuz: 0, durum: 'tamam' });
  assert.deepEqual(k({ protokol: 'h2', protokol_uyumsuz: 3 }, { protokol: 'h2' }), { istenen: 'h2', olculen: 'h2', uyumsuz: 3, durum: 'uyari' });
  assert.deepEqual(k({ http2: 0 }), { istenen: 'h1', olculen: 'h1', uyumsuz: null, durum: 'tamam' }, 'kolonsuz eski satir: http2 sayaci');
  assert.deepEqual(k({ http2: 12 }), { istenen: 'h1', olculen: 'h2', uyumsuz: null, durum: 'uyari' });
  assert.equal(k({}).durum, 'olculmedi');
  assert.equal(k({ protokol: 'h1', protokol_uyumsuz: 0 }, { motor: 'wrk' }).durum, 'olculmedi', 'wrk protokolu olcmez');
  const u = kipDogrulama({ kip: 'ka', ae: 'br', ham: { http2: 12 } }).uyarilar;
  assert.deepEqual(u, ['kip_protokol(istenen=h1,olculen=h2,uyumsuz=0)']);
  assert.equal(kipKodu(u[0]).kod, 'kip_protokol');
});

test('GR-K2 kip baglanti: yeni %5 aynen, ka > %20, istek / baglanti; serbest / log yok olculmedi', () => {
  const b = (kip, ham, s = {}) => kipDogrulama({ kip, ae: 'br', ham }, s);
  const y = b('yeni', { yeniden_baglanti_yuzde: 0 });
  assert.deepEqual(y.baglanti, { istenen: 'yeni', yeniBaglantiYuzde: 100, istekBaglanti: 1, durum: 'tamam' });
  // Analiz %5 ustunde TUR uyarisini yazdi: ayni kod (fx yuvarlamasi analizinki) kip uyarisina gecer.
  const y2 = b('yeni', { yeniden_baglanti_yuzde: 12.4, uyarilar: ['yeni_kipinde_baglanti_yeniden_kullanilmis_%12'] });
  assert.deepEqual([y2.baglanti.durum, y2.uyarilar], ['uyari', ['yeni_kipinde_baglanti_yeniden_kullanilmis_%12']]);
  assert.equal(kipKodu(y2.uyarilar[0]).kod, 'kip_yeni_yeniden_kullanim');
  assert.equal(b('yeni', { yeniden_baglanti_yuzde: 5 }).baglanti.durum, 'tamam', '%5 esitlik uyari degil (analizle ayni)');
  const ka = b('ka', { yeniden_baglanti_yuzde: 80 });
  assert.deepEqual([ka.baglanti.yeniBaglantiYuzde, ka.baglanti.istekBaglanti, ka.baglanti.durum], [20, 5, 'tamam'], '%20 esitlik tamam (R2 gercek)');
  const ka2 = b('ka', { yeniden_baglanti_yuzde: 64.6 });
  assert.deepEqual([ka2.baglanti.durum, ka2.uyarilar], ['uyari', ['kip_ka_yeni_baglanti_%35']]);
  assert.equal(kipKodu(ka2.uyarilar[0]).kod, 'kip_ka_yeni_baglanti');
  assert.equal(b('ka', { yeniden_baglanti_yuzde: 64.6 }, { hedefTuru: 'serbest' }).baglanti.durum, 'olculmedi', 'serbest: log yok');
  assert.equal(b('ka', { yeniden_baglanti_yuzde: null }).baglanti.durum, 'olculmedi');
  assert.equal(b('ka', {}).baglanti.yeniBaglantiYuzde, null);
});

test('GR-K3 kip sikistirma: br payi 1 KB ustu yanitlarda, identity sikistirilmis yanit; olculmedi durumlari; genel durum', () => {
  const kd = (o) => ({ br: 0, gzip: 0, deflate: 0, zstd: 0, yok: 0, diger: 0, yok_1kb_alti: 0, ...o });
  const s = (ae, kodlama, sec = {}) => kipDogrulama({ kip: 'ka', ae, ham: { protokol: 'h1', protokol_uyumsuz: 0, yeniden_baglanti_yuzde: 95, kodlama } }, sec);
  // 100 yanit: 40 br, 60 yok (50'si 1 KB alti) -> 1 KB ustu 50 yanitin 40'i br: %80 tamam.
  const t = s('br', kd({ br: 40, yok: 60, yok_1kb_alti: 50 }));
  assert.deepEqual([t.sikistirma.n, t.sikistirma.yok1kbAlti, t.sikistirma.kucukYuzde, t.sikistirma.istenenYuzde, t.sikistirma.durum], [100, 50, 50, 80, 'tamam']);
  assert.equal(t.durum, 'tamam');
  const az = s('br', kd({ br: 20, gzip: 30, yok: 50, yok_1kb_alti: 10 }));
  assert.deepEqual([az.sikistirma.durum, az.uyarilar], ['uyari', ['kip_sikistirma_az(istenen=br,%22.2)']], '20 / 90 = %22,2 (asagi)');
  assert.equal(az.durum, 'uyari');
  assert.equal(kipKodu(az.uyarilar[0]).kod, 'kip_sikistirma_az');
  // Hepsi 1 KB alti: karsilastirilacak yanit yok -> pay null, uyari yok.
  const kucuk = s('gzip', kd({ yok: 10, yok_1kb_alti: 10 }));
  assert.deepEqual([kucuk.sikistirma.istenenYuzde, kucuk.sikistirma.durum, kucuk.uyarilar], [null, 'tamam', []]);
  // yok_1kb_alti yok'tan buyuk gelemez (bozuk sayac kirpilir).
  assert.equal(s('br', kd({ br: 5, yok: 1, yok_1kb_alti: 9 })).sikistirma.yok1kbAlti, 1);
  const id = s('identity', kd({ yok: 97, br: 3 }));
  assert.deepEqual([id.sikistirma.istenenYuzde, id.uyarilar], [97, ['kip_sikistirma_beklenmeyen(istenen=identity,%3.0)']]);
  assert.equal(kipKodu(id.uyarilar[0]).kod, 'kip_sikistirma_beklenmeyen');
  assert.equal(s('identity', kd({ yok: 10 })).sikistirma.durum, 'tamam');
  // B6 yuvarlama sinirlari (D23): uyari yuzdesi tek ondaliga ASAGI (toFixed yukari yuvarlardi: %49,96 -> 50.0 esige
  // esit gorunurdu; %0,06 -> 0.1).
  assert.deepEqual(s('br', kd({ br: 4996, yok: 5004 })).uyarilar, ['kip_sikistirma_az(istenen=br,%49.9)']);
  assert.deepEqual(s('identity', kd({ yok: 9994, gzip: 6 })).uyarilar, ['kip_sikistirma_beklenmeyen(istenen=identity,%0.0)']);
  // Olculmedi: eski k6 (kodlama yok), wrk, n = 0.
  assert.equal(kipDogrulama({ kip: 'ka', ae: 'br', ham: {} }).sikistirma.durum, 'olculmedi');
  assert.equal(s('br', kd({ br: 10 }), { motor: 'wrk' }).sikistirma.durum, 'olculmedi');
  assert.equal(s('br', kd({})).sikistirma.durum, 'olculmedi');
  // Genel durum: hicbiri olculmedi -> olculmedi (eski HATALI satir).
  assert.equal(kipDogrulama({ kip: null, ae: null, ham: null }).durum, 'olculmedi');
  // adimGorunumu kipDogrulama ve bellek alanlarini ekler.
  const a = adimGorunumu({ tur: 'R5_K_ka_br_250_r1', kip: 'ka', ae: 'br', nedenler: [], ham: { protokol: 'h1', protokol_uyumsuz: 0 } }, { protokol: 'h1' });
  assert.deepEqual([a.kipDogrulama.protokol.durum, a.bellek], ['tamam', null]);
});

test('GR-B bellek: ham.bellek camelCase; eski satir null', () => {
  const a = adimGorunumu({ tur: 'R5_K_ka_br_250_r1', nedenler: [], ham: { bellek: { nginx_rss_ort_mb: 120.5, nginx_rss_max_mb: 130, hedef_bellek_yuzde: 60, hedef_bos_min_yuzde: 40, yuk_bellek_yuzde: null, yuk_bos_min_yuzde: null, arac_rss_max_mb: 'x' } } });
  assert.deepEqual(a.bellek, { nginxRssOrtMb: 120.5, nginxRssMaxMb: 130, hedefBellekYuzde: 60, hedefBosMinYuzde: 40, yukBellekYuzde: null, yukBosMinYuzde: null, aracRssMaxMb: null });
  assert.equal(adimGorunumu({ tur: 'R5_K_ka_br_250_r1', nedenler: [], ham: { bellek: { nginx_rss_ort_mb: null } } }).bellek, null);
  assert.equal(adimGorunumu({ tur: 'R5_K_ka_br_250_r1', nedenler: [], ham: null }).bellek, null);
});
