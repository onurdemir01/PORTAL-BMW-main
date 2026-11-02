// server/nginx-loadtest/__tests__/sade-uctan.test.cjs -- sade turu uctan uca (2026-11-02): GERCEK
// sonuc.cjs + analiz.cjs + poller.analizNormalle + DB satiri gidis-donusu + index adimApi + gorunum.sonucOzeti.
//
//   SU1 R2 kalibi (ilk gercek kosu: konf degisti, 250_r1 olcumunde reload + eski worker'lar cikinca sayac
//       dususu): API'de hicbir CPU / kapasite <= 0 degil; reload'lu adim cpuOlculemedi 'reload' ve reload
//       ani (faz olcum); ozet: toplam istek, p95 en iyi / en kotu, konfDegisti, reload olayi, CPU'suz adim
//   SU2 temiz kosu: cpuOlculemedi null, reloadlar bos, CPU degerleri analizle ayni (gorunum dokunmaz)
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
const { portalDuzeniYaz, standart } = require('./fixtures/kurgu.cjs');

const KOK = fs.mkdtempSync(path.join(os.tmpdir(), 'yuktesti-sade-'));
after(() => fs.rmSync(KOK, { recursive: true, force: true }));

const T0 = 1800000000;
const kosuBas = (sira) => T0 + 60 + sira * 92;

function sayacDusur(dosyalar, esik, dusus) {
  const out = new Map(dosyalar);
  for (const [ad, f] of dosyalar) {
    if (!/^sunucu_.*\.csv$/.test(ad)) continue;
    const satirlar = f.icerik.split('\n').map((s, i) => {
      if (i === 0 || !s) return s;
      const p = s.split(',');
      if (Number(p[0]) >= esik) p[1] = String(Number(p[1]) - dusus);
      return p.join(',');
    });
    out.set(ad, { ...f, icerik: satirlar.join('\n') });
  }
  return out;
}

/** Poller'in yazdigi gibi DB satiri (nedenler / ham JSON metni), sonra GET /kosular/:id'nin okudugu gibi API. */
async function apiyeKadar(adim, dosyalar) {
  const dizin = portalDuzeniYaz(path.join(KOK, adim), dosyalar);
  const veri = await sonuc.kosuDiziniOku(dizin, { adim });
  const n = pl.analizNormalle(kosuAnaliz(veri, { adim }));
  const satirlar = n.adimlar.map((a, i) => JSON.parse(JSON.stringify({ id: i + 1, kosu_id: 7, ...a, nedenler: JSON.stringify(a.nedenler) })));
  const adimlar = satirlar.map(adimApi);
  // poller: sonuc = { ...stats, portal_analiz: { ozet, uyarilar } } -> k.sonuc JSON metni.
  const kSonuc = JSON.parse(JSON.stringify({ durum: 'OK', portal_analiz: { ozet: n.ozet, uyarilar: n.uyarilar } }));
  return { n, adimlar, ozet: sonucOzeti(adimlar, kSonuc.portal_analiz.ozet) };
}

test('SU1 R2 kalibi: negatif CPU / kapasite yok, reload ani ve nedeni, kosu ozeti', async () => {
  const k = standart('R2', { ru: 22, reload: true });
  const { adimlar, ozet } = await apiyeKadar('R2', sayacDusur(k.dosyalar({ konf_bit: 'def' }), kosuBas(2) + 45, 5000));
  assert.equal(adimlar.length, 6);
  for (const a of adimlar) {
    assert.ok(a.cpuMsIstek === null || a.cpuMsIstek > 0, `${a.tur} cpu ${a.cpuMsIstek}`);
    assert.ok(a.kapasiteRps === null || a.kapasiteRps > 0, `${a.tur} kapasite ${a.kapasiteRps}`);
    assert.ok(a.nedenler.includes('konf_degisti'), `${a.tur}: konf degisimi her adima yazilir (ani bilinmez)`);
  }
  const r = adimlar.find((a) => a.tur === 'R2_K_yeni_br_250_r1');
  assert.ok(r.nedenler.includes('reload(worker_pid_degisti)'));
  assert.deepEqual([r.cpuMsIstek, r.kapasiteRps, r.cpuOlculemedi], [null, null, 'reload']);
  assert.deepEqual(r.reloadlar, [{ t: kosuBas(2) + 40, tOnce: kosuBas(2) + 39, tSon: kosuBas(2) + 40, tur: 'R2_K_yeni_br_250_r1', faz: 'olcum' }]);
  assert.ok(adimlar.filter((a) => a !== r).every((a) => a.cpuOlculemedi === null && a.reloadlar.length === 0 && a.cpuMsIstek > 0));
  // Ozet tablo alanlari dolu (istek, rps, p50/p95/p99, hata, 429, 5xx, host CPU).
  for (const a of adimlar) {
    for (const f of ['nIstek', 'gercekRps', 'p50', 'p95', 'p99', 'hataOrani', 'n429', 'n5xx', 'hostCpuOrt']) {
      assert.equal(typeof a[f], 'number', `${a.tur}.${f}`);
    }
  }
  assert.equal(ozet.toplamIstek, adimlar.reduce((t, a) => t + a.nIstek, 0));
  assert.deepEqual([ozet.adimSayisi, ozet.gecerliAdimSayisi, ozet.p95Kapsam, ozet.konfDegisti, ozet.cpuOlculemeyenAdim, ozet.hataVar],
    [6, 0, 'tum', true, 1, false]);
  assert.equal(ozet.p95EnIyi.deger, 50);
  assert.deepEqual(ozet.reloadlar.map((o) => [o.t, o.tur, o.faz, o.etkilenenTurlar, o.kesit]),
    [[kosuBas(2) + 40, 'R2_K_yeni_br_250_r1', 'olcum', ['R2_K_yeni_br_250_r1'], 'R2_test']]);
});

test('SU2 temiz kosu: gorunum CPU degerine dokunmaz, reload yok', async () => {
  const k = standart('R3', { ru: 22 });
  const { n, adimlar, ozet } = await apiyeKadar('R3', k.dosyalar());
  adimlar.forEach((a, i) => {
    assert.equal(a.cpuOlculemedi, null);
    assert.deepEqual(a.reloadlar, []);
    assert.equal(a.cpuMsIstek, n.adimlar[i].cpu_ms_istek);
    assert.equal(a.kapasiteRps, n.adimlar[i].kapasite_rps);
    assert.ok(a.cpuMsIstek > 0 && a.kapasiteRps > 0);
  });
  assert.deepEqual([ozet.gecerliAdimSayisi, ozet.p95Kapsam, ozet.konfDegisti, ozet.reloadlar, ozet.cpuOlculemeyenAdim], [6, 'gecerli', false, [], 0]);
});
