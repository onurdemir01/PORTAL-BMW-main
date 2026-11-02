// server/nginx-loadtest/__tests__/r2-gercek.test.cjs -- ilk gercek kosu R2 (GBNGXT33, AWX 3474239) sayilariyla
// uctan uca: kos.sh / cpu_kaydedici.sh dosyalari -> sonuc.cjs -> analiz.cjs -> poller.analizNormalle -> DB satiri
// -> index adimApi -> gorunum.sonucOzeti (GET /kosular/:id'nin dondurdugu adimlar + sonucOzeti).
//
// GERCEK (is ciktisindan, yuk-testi-2-3474239.txt): 6 adimin baslangic saati (14:49:46 .. 15:05:10, +0300), olcum
// istek sayisi, gercek hiz, p50 / p95 / p99 / ttfb_p95, dropped (4 ve 63), bayt/istek, kip ka / ae identity,
// 30 sn isinma + 120 sn olcum + 30 sn bosluk; kaydedici ozeti (konf 0dc6843c88ef3f73 -> 648462d7a1358dd1, worker 8
// -> 8, reload notu).
// SENTETIK (is ciktisinda yok): kaydedici ornekleri (worker / host CPU tikleri), reload anlari (100_r2 ve 250_r2
// olcumunun ortasi; R2'nin ekraninda bu iki adim reload nedeniyle dusmustu) ve reload'da eski worker'lar cikinca
// toplam sayacin dusmesi (R2'de negatif CPU-ms / kapasiteyi ureten durum), nginx log satirlari (saniyede hiz kadar).
//
//   RG1 API: ozet tablo kolonlari (istek, gercek hiz, p50, p95, p99, hata, 429, 5xx, host CPU) is ciktisiyla
//       AYNI; reload'lu iki adimda CPU-ms/istek ve kapasite null + cpuOlculemedi 'reload' (eski analiz -1.372 /
//       -0.873 yazmisti), hicbir adimda <= 0 yok; her adim konf_degisti ile GECERSIZ; reload anlari faz 'olcum'
//   RG2 kosu ozeti: toplam istek 179.936, en iyi / en kotu p95 (kapsam 'tum'), hata yok, 2 CPU'suz adim, iki
//       reload olayi; arayuz fikstur dosyasi (fixtures/r2-gercek-api.json) bu ciktiyla BAYT BAYT ayni
//       (YUK_R2_FIKSTUR_YAZ=1 ile yeniden yazilir; arayuz testi SD11 ayni dosyayi cizer)
//   RG3 olcume TASAN reload (inceleme bulgusu 1): reload isinmada / bir onceki adimin boslugunda / kosu oncesinde olur,
//       eski worker'lar ('shutting down') olcum penceresine kadar yasar -> adim reload'la GECERSIZ; olay ve adimin
//       reloadlar'i o adimin 'olcum'u (eskiden baslangic anina gore 'isinma' / 'bosluk' / 'kosu_oncesi' yazilip ekran
//       "olcum etkilenmedi" diyordu). Kontrol: isinmada baslayip isinmada biten reload 'isinma' kalir, adim dusmez.
'use strict';

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const sonuc = require('../sonuc.cjs');
const { kosuAnaliz } = require('../analiz.cjs');
const pl = require('../poller.cjs');
const { _adimApiForTest: adimApi } = require('../index.cjs');
const { sonucOzeti } = require('../gorunum.cjs');
const { Kurgu, portalDuzeniYaz } = require('./fixtures/kurgu.cjs');

const KOK = fs.mkdtempSync(path.join(os.tmpdir(), 'yuktesti-r2-'));
after(() => fs.rmSync(KOK, { recursive: true, force: true }));
const FIKSTUR = path.join(__dirname, 'fixtures', 'r2-gercek-api.json');

const yerel = (s) => Date.parse(`2026-11-02T${s}+03:00`) / 1000;
// Is ciktisi "== <TUR> ... olcum istek=.. gercek=.. p50=.. p95=.. p99=.. ttfb_p95=.. / dropped=.. bayt/istek=..".
const GERCEK = [
  { hiz: 100, r: 1, bas: '14:49:46', n: 12001, rps: 100.008, p50: 1.609, p95: 2.126, p99: 2.534, ttfb: 1.967, dropped: 0, bayt: 4915.262 },
  { hiz: 100, r: 2, bas: '14:52:51', n: 11996, rps: 99.967, p50: 1.542, p95: 1.984, p99: 5.203, ttfb: 1.801, dropped: 4, bayt: 4920.738 },
  { hiz: 250, r: 1, bas: '14:55:55', n: 30001, rps: 250.008, p50: 1.252, p95: 1.594, p99: 1.872, ttfb: 1.458, dropped: 0, bayt: 4917.652 },
  { hiz: 250, r: 2, bas: '14:59:00', n: 29937, rps: 249.475, p50: 1.227, p95: 1.728, p99: 4.997, ttfb: 1.554, dropped: 63, bayt: 4925.632 },
  { hiz: 400, r: 1, bas: '15:02:05', n: 48001, rps: 400.008, p50: 1.026, p95: 1.404, p99: 1.953, ttfb: 1.262, dropped: 0, bayt: 4914.741 },
  { hiz: 400, r: 2, bas: '15:05:10', n: 48000, rps: 400, p50: 1.033, p95: 1.346, p99: 1.662, ttfb: 1.227, dropped: 0, bayt: 4904.413 },
];
const KONF_BAS = '0dc6843c88ef3f73';
const KONF_BIT = '648462d7a1358dd1';
// Sentetik reload anlari: 100_r2 ve 250_r2 olcumunun 60. saniyesi (bas + 1 + 30 isinma + 60).
const RELOAD = [yerel('14:52:51') + 91, yerel('14:59:00') + 91];
// Worker tikleri (clk 100): arka plan (8, 2) = 100 ms/sn; adim hizina gore net ~0,2 ms/istek.
const TIK = { 100: [10, 2], 250: [12, 3], 400: [14, 4] };

function r2Dosyalari() {
  const k = new Kurgu('R2', { t0: yerel('14:49:46') - 90, host: 'gbngxt33' });
  for (const g of GERCEK) {
    k.t = yerel(g.bas);
    k.rps = g.hiz;
    k.kosu({
      sen: 'K', kip: 'ka', ae: 'identity', hiz: g.hiz, r: g.r, ru: TIK[g.hiz][0], rs: TIK[g.hiz][1], host: 32,
      isinma: 30, olcum: 120, bosluk: 30, dropped: g.dropped, bayt: g.bayt, hata: 0,
      istemciAlan: { n_olcum: g.n, rps_gercek: g.rps, p50: g.p50, p95: g.p95, p99: g.p99, ttfb_p95: g.ttfb, tls_p95: 0, sikistirma_turu: 'YOK' },
    });
  }
  const dosyalar = k.dosyalar({ konf_bit: KONF_BIT, uyari: [`konf_degisti(kayit_sirasinda):${KONF_BAS}->${KONF_BIT}`] });
  const out = new Map(dosyalar);
  for (const [ad, f] of dosyalar) {
    if (ad === 'sunucu_R2_gbngxt33.csv') {
      // Reload: worker PID kumesi degisir, eski worker'lar 3 sn "shutting down" kalir, cikinca toplam sayac duser.
      const satirlar = f.icerik.split('\n').map((s, i) => {
        if (i === 0 || !s) return s;
        const p = s.split(',');
        const t = Number(p[0]);
        const kac = RELOAD.filter((r) => t >= r).length;
        p[5] = ['101+102', '201+202', '301+302'][kac];
        p[4] = RELOAD.some((r) => t >= r && t < r + 3) ? '2' : '0';
        p[1] = String(Number(p[1]) - 9000 * RELOAD.filter((r) => t >= r + 3).length);
        return p.join(',');
      });
      out.set(ad, { ...f, icerik: satirlar.join('\n') });
    } else if (ad === 'bilgi_R2_gbngxt33.txt') {
      out.set(ad, { ...f, icerik: f.icerik.replace('konf_hash_bas=abc', `konf_hash_bas=${KONF_BAS}`).replace('isci_pid_bit=101+102', 'isci_pid_bit=301+302') });
    }
  }
  return out;
}

let hazir = null;
/** Poller'in yazdigi DB satiri (nedenler / ham JSON metni) -> GET /kosular/:id'nin okudugu API. */
function apiyeKadar() {
  if (!hazir) {
    hazir = (async () => {
      const dizin = portalDuzeniYaz(path.join(KOK, 'R2'), r2Dosyalari());
      const veri = await sonuc.kosuDiziniOku(dizin, { adim: 'R2' });
      const n = pl.analizNormalle(kosuAnaliz(veri, { adim: 'R2' }));
      const satirlar = n.adimlar.map((a, i) => JSON.parse(JSON.stringify({ id: i + 1, kosu_id: 2, ...a, nedenler: JSON.stringify(a.nedenler) })));
      const adimlar = satirlar.map(adimApi);
      const kSonuc = JSON.parse(JSON.stringify({ durum: 'OK', portal_analiz: { ozet: n.ozet, uyarilar: n.uyarilar } }));
      return { n, adimlar, ozet: sonucOzeti(adimlar, kSonuc.portal_analiz.ozet) };
    })();
  }
  return hazir;
}

test('RG1 gercek R2 sayilari: ozet tablo kolonlari is ciktisiyla ayni; reload adiminda CPU / kapasite null, hicbiri <= 0', async () => {
  const { adimlar } = await apiyeKadar();
  assert.deepEqual(adimlar.map((a) => a.tur), GERCEK.map((g) => `R2_K_ka_identity_${g.hiz}_r${g.r}`));
  GERCEK.forEach((g, i) => {
    const a = adimlar[i];
    assert.deepEqual([a.nIstek, a.gercekRps, a.p50, a.p95, a.p99, a.hataOrani, a.n429, a.n5xx, a.dropped],
      [g.n, g.rps, g.p50, g.p95, g.p99, 0, 0, 0, g.dropped], a.tur);
    assert.equal(typeof a.hostCpuOrt, 'number', `${a.tur} host CPU`);
    assert.ok(a.cpuMsIstek === null || a.cpuMsIstek > 0, `${a.tur} cpu ${a.cpuMsIstek}`);
    assert.ok(a.kapasiteRps === null || a.kapasiteRps > 0, `${a.tur} kapasite ${a.kapasiteRps}`);
    assert.equal(a.gecerlilik, 'GECERSIZ', a.tur);
    assert.ok(a.nedenler.includes('konf_degisti'), `${a.tur}: konf degisimi her adima yazilir (ani bilinmez)`);
  });
  const reloadlu = adimlar.filter((a) => a.nedenler.includes('reload(worker_pid_degisti)')).map((a) => a.tur);
  assert.deepEqual(reloadlu, ['R2_K_ka_identity_100_r2', 'R2_K_ka_identity_250_r2']);
  for (const a of adimlar) {
    const r = reloadlu.includes(a.tur);
    assert.deepEqual([a.cpuMsIstek === null, a.kapasiteRps === null, a.cpuOlculemedi], r ? [true, true, 'reload'] : [false, false, null], a.tur);
    assert.deepEqual(a.reloadlar.map((x) => [x.t, x.faz]), r ? [[RELOAD[reloadlu.indexOf(a.tur)], 'olcum']] : [], a.tur);
    if (r) assert.ok(a.ham.uyarilar.includes('cpu_olculemedi(reload)'), a.tur);
    else assert.ok(Math.abs(a.cpuMsIstek - 0.2) < 0.02, `${a.tur} cpu ${a.cpuMsIstek}`);
  }
  // Dropped (4 / 63): GECERSIZ adimda doyma nedeni yazilmaz, adim uyarisi olarak kalir.
  assert.ok(adimlar[1].ham.uyarilar.includes('dropped_iterations=4') && adimlar[3].ham.uyarilar.includes('dropped_iterations=63'));
  assert.ok(adimlar.every((a) => a.hostCpuOrt === 4), 'sentetik host CPU %4 (32 / 800 tik)');
});

test('RG2 gercek R2 kosu ozeti; arayuz fikstur dosyasi bu ciktiyla ayni', async () => {
  const { n, adimlar, ozet } = await apiyeKadar();
  assert.deepEqual([ozet.adimSayisi, ozet.gecerliAdimSayisi, ozet.toplamIstek, ozet.p95Kapsam], [6, 0, 179936, 'tum']);
  assert.deepEqual([ozet.p95EnIyi, ozet.p95EnKotu], [{ deger: 1.346, tur: 'R2_K_ka_identity_400_r2' }, { deger: 2.126, tur: 'R2_K_ka_identity_100_r1' }]);
  assert.deepEqual([ozet.toplam429, ozet.toplam5xx, ozet.enYuksekHataOrani, ozet.hataVar, ozet.cpuOlculemeyenAdim, ozet.konfDegisti], [0, 0, 0, false, 2, true]);
  assert.deepEqual(ozet.reloadlar.map((r) => [r.t, r.tur, r.faz, r.etkilenenTurlar, r.kesit]), [
    [RELOAD[0], 'R2_K_ka_identity_100_r2', 'olcum', ['R2_K_ka_identity_100_r2'], 'R2_gbngxt33'],
    [RELOAD[1], 'R2_K_ka_identity_250_r2', 'olcum', ['R2_K_ka_identity_250_r2'], 'R2_gbngxt33'],
  ]);
  assert.ok(n.uyarilar.includes(`kayit:R2_gbngxt33:konf_degisti(kayit_sirasinda):${KONF_BAS}->${KONF_BIT}`));
  const fikstur = JSON.stringify({ gecerlilik: n.gecerlilik, gecersizNedenleri: n.nedenler, uyarilar: n.uyarilar, sonucOzeti: ozet, adimlar }, null, 1) + '\n';
  if (process.env.YUK_R2_FIKSTUR_YAZ === '1') fs.writeFileSync(FIKSTUR, fikstur);
  assert.equal(fs.readFileSync(FIKSTUR, 'utf8'), fikstur, 'fixtures/r2-gercek-api.json bayat: YUK_R2_FIKSTUR_YAZ=1 ile yeniden yazin');
});

// RG3: R2'nin ilk iki adimi (14:49:46, 14:52:51; 30 sn isinma + 120 sn olcum + 30 sn bosluk), sentetik tek reload.
// `ani`: worker PID kumesinin degistigi ilk ornek; `sure`: eski worker'larin 'shutting down' kaldigi saniye.
async function tasanReload(ad, ani, sure) {
  const k = new Kurgu(ad, { t0: yerel(GERCEK[0].bas) - 90, host: 'gbngxt33' });
  for (const g of GERCEK.slice(0, 2)) {
    k.t = yerel(g.bas);
    k.rps = 100;
    k.kosu({
      sen: 'K', kip: 'ka', ae: 'identity', hiz: 100, r: g.r, ru: 10, rs: 2, host: 32, isinma: 30, olcum: 120, bosluk: 30, dropped: 0, bayt: 4900, hata: 0,
      istemciAlan: { n_olcum: 12000, rps_gercek: 100, p50: 1, p95: 2, p99: 3, ttfb_p95: 1, tls_p95: 0 },
    });
  }
  const out = new Map(k.dosyalar({}));
  const csv = `sunucu_${ad}_gbngxt33.csv`;
  const f = out.get(csv);
  out.set(csv, { ...f, icerik: f.icerik.split('\n').map((s, i) => {
    if (i === 0 || !s) return s;
    const p = s.split(',');
    const t = Number(p[0]);
    p[5] = t >= ani ? '201+202' : '101+102';
    p[4] = t >= ani && t < ani + sure ? '2' : '0';
    p[1] = String(Number(p[1]) - (t >= ani + sure ? 9000 : 0));
    return p.join(',');
  }).join('\n') });
  const veri = await sonuc.kosuDiziniOku(portalDuzeniYaz(path.join(KOK, ad), out), { adim: ad });
  const n = pl.analizNormalle(kosuAnaliz(veri, { adim: ad }));
  const adimlar = n.adimlar.map((a, i) => adimApi(JSON.parse(JSON.stringify({ id: i + 1, kosu_id: 3, ...a, nedenler: JSON.stringify(a.nedenler) }))));
  return { adimlar, ozet: sonucOzeti(adimlar, JSON.parse(JSON.stringify(n.ozet))) };
}

test('RG3 isinmada / boslukta / kosu oncesinde baslayip olcume tasan reload: adim dusurulur, olay o adimin olcumu', async () => {
  const b1 = yerel(GERCEK[0].bas);
  const b2 = yerel(GERCEK[1].bas);
  const bit1 = b1 + 1 + 30 + 120;
  const DURUMLAR = [
    // [ad, reload ani, shutting down sn, dusen adim (index), etkilenen]; eski faz sirasiyla isinma, bosluk, kosu_oncesi
    ['RI', b2 + 1 + 25, 10, 1, ['R2_K_ka_identity_100_r2']],
    ['RB', bit1 + 20, 60, 1, ['R2_K_ka_identity_100_r2']],
    ['RO', b1 - 10, 50, 0, ['R2_K_ka_identity_100_r1']],
  ];
  for (const [ad, ani, sure, dusen, etkilenen] of DURUMLAR) {
    const { adimlar, ozet } = await tasanReload(ad, ani, sure);
    const tur = (i) => `${ad}_K_ka_identity_100_r${i + 1}`;
    const etk = etkilenen.map((x) => x.replace('R2', ad));
    adimlar.forEach((a, i) => {
      const r = i === dusen;
      assert.equal(a.gecerlilik, r ? 'GECERSIZ' : 'GECERLI', `${ad} ${a.tur} ${a.nedenler}`);
      assert.deepEqual(a.nedenler.includes('reload(worker_pid_degisti)'), r, `${ad} ${a.tur}`);
      assert.deepEqual(a.reloadlar.map((x) => [x.t, x.tSon, x.tur, x.faz]), etk.includes(a.tur) ? [[ani, ani + sure - 1, tur(dusen), 'olcum']] : [], `${ad} ${a.tur}`);
    });
    assert.deepEqual(ozet.reloadlar.map((x) => [x.t, x.tur, x.faz, x.etkilenenTurlar]), [[ani, tur(dusen), 'olcum', etk]], ad);
  }
  // Kontrol: isinmada baslayip (25. sn) isinmada biten (2 sn) reload olcumu etkilemez; 'isinma' kalir.
  const { adimlar, ozet } = await tasanReload('RK', b2 + 1 + 25, 2);
  assert.ok(adimlar.every((a) => a.gecerlilik === 'GECERLI'), adimlar.map((a) => a.nedenler).join('|'));
  assert.deepEqual(ozet.reloadlar.map((x) => [x.tur, x.faz]), [['RK_K_ka_identity_100_r2', 'isinma']]);
});
