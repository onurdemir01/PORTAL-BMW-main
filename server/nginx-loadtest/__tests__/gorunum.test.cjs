// server/nginx-loadtest/__tests__/gorunum.test.cjs -- gorunum.cjs (sade turu, 2026-11-02).
//
//   GR1 eski R2 satirlari: negatif CPU-ms/istek ve kapasite null + cpuOlculemedi; reload nedenli satirin
//       pozitif degeri de null ('reload'); DB disi alanlar AYNEN; yeni analizin kodu (ham.cpu_olculemedi) oncelikli
//   GR2 reloadlar: ham.reloadlar camelCase; bozuk / bilinmeyen faz atlanir; eski satir []
//   GR3 sonucOzeti: toplam istek, p95 en iyi / en kotu (gecerli; yoksa tum), 429 / 5xx / hata, konf, reloadlar
//   GR4 bos / eski kosu: adim yok, ozet yok -> null / 0 / [] (cokmez)
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { adimGorunumu, sonucOzeti } = require('../gorunum.cjs');

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
    toplam5xx: null, enYuksekHataOrani: null, hataVar: false, cpuOlculemeyenAdim: 0, konfDegisti: null, reloadlar: [],
  };
  assert.deepEqual(sonucOzeti([], null), bos);
  assert.deepEqual(sonucOzeti(undefined, undefined), bos);
  assert.deepEqual(sonucOzeti([], { kirpildi: true }), bos);
  assert.deepEqual(sonucOzeti([], []), bos);
});
