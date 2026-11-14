// server/nginx-loadtest/__tests__/sade-uctan.test.cjs -- sade turu uctan uca (2026-11-02): GERCEK
// sonuc.cjs + analiz.cjs + poller.analizNormalle + DB satiri gidis-donusu + index adimApi + gorunum.sonucOzeti.
//
//   SU1 R2 kalibi (ilk gercek kosu: konf degisti, 250_r1 olcumunde reload + eski worker'lar cikinca sayac
//       dususu): API'de hicbir CPU / kapasite <= 0 degil; reload'lu adim cpuOlculemedi 'reload' ve reload
//       ani (faz olcum); ozet: toplam istek, p95 en iyi / en kotu, konfDegisti, reload olayi, CPU'suz adim
//   SU2 temiz kosu: cpuOlculemedi null, reloadlar bos, CPU degerleri analizle ayni (gorunum dokunmaz)
//   SU-H HTTP/2 kosusu: yuk_k6.js'in kendi handleSummary'si (Portal aynasi; YUK_K6 ile baska kopya) 32 kolonlu CSV
//        yazar -> GECERLI, ham protokol, h2 kosu uyarisi; uyumsuz -> h2_disi; h1 satiriyla okunursa protokol_farkli
//   SU-R reload nedeni <=> o adimin 'olcum' olayi (analiz + API)
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

// -- SU-H (h2_sozlesme.md 8.3): HTTP/2 kosusu uctan uca. Istemci dosyalari yuk_k6.js'in KENDI ozet_hesapla /
// handleSummary'siyle (Portal aynasi; YUK_K6 ile baska kopya) 32 kolonlu yazilir; k6 modulleri sahte (A2 deseni).
const { pathToFileURL } = require('node:url');
const YUK_K6 = process.env.YUK_K6 || path.join(__dirname, '..', '..', 'ansible', 'bmw_portal', 'nginx_loadtest', 'files', 'yuk_k6.js');
let k6Sira = 0;
async function k6Yukle(env) {
  globalThis.__k6 = {
    http: { get: () => ({ status: 200, proto: 'HTTP/2.0', headers: {} }), CookieJar: class {} },
    metrics: { Counter: class { add() {} } },
    data: { SharedArray: function (ad, fn) { return fn(); } },
  };
  globalThis.open = (p) => fs.readFileSync(p, 'utf8');
  globalThis.__ENV = env;
  const kod = fs.readFileSync(YUK_K6, 'utf8').replace(/^import .* from 'k6[^']*';\s*$/gm, '').replace(
    /^/, 'const http = globalThis.__k6.http; const { Counter } = globalThis.__k6.metrics; const { SharedArray } = globalThis.__k6.data;\n');
  const dosya = path.join(KOK, `yuk_k6_${k6Sira++}.mjs`);
  fs.writeFileSync(dosya, kod);
  return import(pathToFileURL(dosya).href);
}

/** Fikstur satirini (kurgu.cjs istemci) k6 ozet verisine cevirip yuk_k6.js handleSummary ile CSV + JSON uretir. */
async function k6IstemciDosyalari(dosyalar, k, { protokol, uyumsuz = (_tur) => 0 }) {
  const senaryo = path.join(KOK, 'K.tsv');
  fs.writeFileSync(senaryo, '1\t1\tjs\tkucuk\t/a.js\n');
  const out = new Map(dosyalar);
  for (const d of k.istemci) {
    const m = await k6Yukle({
      HEDEF: 'https://10.0.0.5', HOST_BASLIGI: 'app.test.local', SENARYO: senaryo, TUR: d.tur, ADIM: d.adim, SEN: d.senaryo, KIP: d.kip,
      AE: d.ae, HIZ: String(d.hiz), ISINMA: `${d.isinma_sn}s`, SURE: `${d.sure_sn}s`, CIKTI: '/c', DENEME: String(d.deneme), PROTOKOL: protokol,
    });
    const v = (x) => ({ values: x });
    const n = d.n_olcum;
    const metrics = {
      'http_reqs{scenario:olcum}': v({ count: n }),
      'http_req_duration{scenario:olcum}': v({ count: n, med: d.p50, 'p(95)': d.p95, 'p(99)': d.p99 }),
      'http_req_waiting{scenario:olcum}': v({ count: n, 'p(95)': d.ttfb_p95 }),
      'http_req_tls_handshaking{scenario:olcum}': v({ count: n, 'p(95)': d.tls_p95 }),
      'http_req_connecting{scenario:olcum}': v({ count: n, 'p(95)': d.connect_p95 }),
      'http_req_failed{scenario:olcum}': v({ rate: d.hata_orani }),
      'data_received{scenario:olcum}': v({ count: d.bayt_istek * n }),
      'dropped_iterations{scenario:olcum}': v({ count: 0 }),
      sikistirma_dinamik: v({ count: 5 }),
      // HTTP/2.0 yanit sayisi (isinma + olcum; bilgi) ve beklenen disi yanit.
      http2_kullanildi: v({ count: protokol === 'h2' ? n + 200 : 0 }),
      ...(uyumsuz(d.tur) ? { protokol_uyumsuz: v({ count: uyumsuz(d.tur) }) } : {}),
    };
    const o = m.handleSummary({ metrics });
    out.set(`istemci_${d.tur}.csv`, { ...out.get(`istemci_${d.tur}.csv`), icerik: o[`/c/istemci_${d.tur}.csv`] });
    out.set(`istemci_${d.tur}.json`, { ...out.get(`istemci_${d.tur}.json`), icerik: o[`/c/istemci_${d.tur}.json`] });
  }
  return out;
}

test('SU-H HTTP/2 kosusu: yuk_k6.js 32 kolonlu CSV -> GECERLI, ham protokol, kosu uyarisi; uyumsuz -> h2_disi; h1 okunursa protokol_farkli', async () => {
  const k = standart('R4', { ru: 22, kosuEk: () => ({ kip: 'ka' }) });
  const dosyalar = await k6IstemciDosyalari(k.dosyalar(), k, { protokol: 'h2' });
  const ilk = dosyalar.get(`istemci_${k.istemci[0].tur}.csv`).icerik.split('\n');
  assert.equal(ilk[0].split(',').length, 32, ilk[0]);
  assert.deepEqual(ilk[0].split(',').slice(-2), ['protokol', 'protokol_uyumsuz']);
  const oku = async (ad, d) => sonuc.kosuDiziniOku(portalDuzeniYaz(path.join(KOK, ad), d), { adim: 'R4' });
  const veri = await oku('R4-h2', dosyalar);
  const n = pl.analizNormalle(kosuAnaliz(veri, { adim: 'R4', protokol: 'h2' }));
  assert.equal(n.gecerlilik, 'GECERLI', n.nedenler.join('|'));
  assert.ok(n.uyarilar.includes('h2_vu_basina_tek_akis(tarayici_coklamasi_olculmez)'));
  for (const a of n.adimlar) {
    assert.equal(a.gecerlilik, 'GECERLI', `${a.tur}: ${a.nedenler.join(';')}`);
    const h = JSON.parse(a.ham);
    assert.deepEqual([h.protokol, h.protokol_uyumsuz, h.http2], ['h2', 0, a.n_istek + 200]);
  }
  // API'ye kadar (DB satiri gidis-donusu + adimApi): ham alanlari korunur.
  const api = n.adimlar.map((a, i) => adimApi(JSON.parse(JSON.stringify({ id: i + 1, kosu_id: 4, ...a, nedenler: JSON.stringify(a.nedenler) }))));
  assert.ok(api.every((a) => a.ham.protokol === 'h2' && a.cpuMsIstek > 0));
  // Sayilar 30 kolonlu (h1) okumayla ayni: yeni kolonlar eski alanlari kaydirmaz.
  const eski = pl.analizNormalle(kosuAnaliz(await oku('R4-h1', k.dosyalar()), { adim: 'R4' }));
  for (const [i, a] of n.adimlar.entries()) {
    for (const f of ['p50', 'p95', 'p99', 'n_istek', 'gercek_rps', 'cpu_ms_istek', 'bayt_istek']) assert.equal(a[f], eski.adimlar[i][f], `${a.tur}.${f}`);
  }
  // Bir adimda beklenen disi yanit (protokol_uyumsuz 3): yalniz o adim h2_disi(3).
  const ozel = 'R4_K_ka_br_250_r1';
  const u = await k6IstemciDosyalari(k.dosyalar(), k, { protokol: 'h2', uyumsuz: (t) => (t === ozel ? 3 : 0) });
  const nu = pl.analizNormalle(kosuAnaliz(await oku('R4-uyumsuz', u), { adim: 'R4', protokol: 'h2' }));
  assert.deepEqual(nu.adimlar.map((a) => [a.tur, a.nedenler]).filter(([t]) => t === ozel), [[ozel, ['h2_disi(3)']]]);
  assert.equal(nu.gecerlilik, 'KISMI');
  // Ayni h2 dosyalari h1 satiriyla okunursa protokol_farkli (eski Portal / yanlis satir).
  const nh1 = pl.analizNormalle(kosuAnaliz(veri, { adim: 'R4' }));
  assert.ok(nh1.adimlar.every((a) => a.nedenler.join(';') === 'protokol_farkli(beklenen=h1,olculen=h2)'));
  // h1 kosusu (yuk_k6.js PROTOKOL=h1, http2 0): GECERLI, ham protokol h1.
  const h1 = await k6IstemciDosyalari(k.dosyalar(), k, { protokol: 'h1' });
  const n1 = pl.analizNormalle(kosuAnaliz(await oku('R4-h1-yeni', h1), { adim: 'R4' }));
  assert.ok(n1.adimlar.every((a) => a.gecerlilik === 'GECERLI' && JSON.parse(a.ham).protokol === 'h1' && JSON.parse(a.ham).http2 === 0));
  assert.ok(!n1.uyarilar.includes('h2_vu_basina_tek_akis(tarayici_coklamasi_olculmez)'));
});

test('SU-R reload degismezi uctan uca: reload nedeni <=> o adimin olcum olayi (sade fiksturleri)', async () => {
  const durumlar = [
    ['R5', sayacDusur(standart('R5', { ru: 22, reload: true }).dosyalar({ konf_bit: 'def' }), kosuBas(2) + 45, 5000)],
    ['R6', standart('R6', { ru: 22 }).dosyalar()],
  ];
  for (const [ad, d] of durumlar) {
    const { n, adimlar, ozet } = await apiyeKadar(ad, d);
    for (const a of n.adimlar) {
      const olcum = n.ozet.reloadlar.some((o) => o.tur === a.tur && o.faz === 'olcum');
      assert.equal(a.nedenler.includes('reload(worker_pid_degisti)'), olcum, `${ad}/${a.tur}`);
    }
    for (const a of adimlar) {
      const olcum = ozet.reloadlar.some((o) => o.tur === a.tur && o.faz === 'olcum');
      assert.equal(a.nedenler.includes('reload(worker_pid_degisti)'), olcum, `API ${ad}/${a.tur}`);
    }
  }
});
