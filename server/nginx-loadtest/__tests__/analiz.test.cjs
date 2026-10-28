// server/nginx-loadtest/__tests__/analiz.test.cjs -- analiz.cjs, el kitinin karsilastir.py'sine KARSI.
//
// FARKLI-GERCEKLESIM TESTI: fixtures/senaryolar.cjs'teki her kosu dizini (R10..R55) kurgu.cjs ile
// Portal duzeninde (duz, log .tsv.gz, SHA256SUMS) uretilir, sonuc.cjs ile okunur ve analiz edilir.
// Ayni uretecin Python duzeni karsilastir.py'nin KENDISIYLE hesaplanmis ve sonucu tam hassasiyetle
// fixtures/karsilastir-beklenen.json'a yazilmistir (fixtures/beklenen-uret.cjs; testte python YOK).
// Her sayi 1e-6 bagil toleransla, her neden/uyari/karar satiri METIN OLARAK karsilastirilir.
// Parmak izi kontrolu (AN1) uretec degisip beklenenler bayatlarsa testi kirmizi yapar.
//
//   AN1  uretec beklenenlerin uretildigi baytlari hala uretiyor (parmak izi)
//   AN2  TUR satirlari: her sayi, durum, neden, uyari Python'la ayni (42 kosu, ~250 TUR)
//   AN3  gruplar (tekrar ortalamasi, gurultu, KISMI/DOYMA), arka plan bloklari, nproc, ayristirma
//   AN4  kararlar (41 durum): karar + satirlar; Portal farklari ACIK eslemeyle
//   AN5  karar DB satirindan da ayni (ham/nedenler JSON metni, camelCase alanlar)
//   AN6  Python uyumlu ilkel islemler: yuzdelik, medyan, Neumaier toplam, %-bicim yarim-cift, round
//   AN7  Portal: HATALI satirlari (hatali_ / tamamlanmadi), kosu gecerliligi, adim suzgeci, JSON guvenli
//   AN8  Portal: kademe varsayilanlari (ortadaki / en yuksek ortak), birlesim secimi, DOYMA, VERI_YOK
//   AN9  sonuc.cjs ve analiz.cjs `sayi` kopyalari esdeger
//   AN10 TUR uyarilari kosu duzeyi uyarilar'da "<tur>: <uyari>" (sonda, adim sirasiyla; S6 / analiz-2)
//   AN11 TUR uyarisi tavani 40 + ozet satiri; HATALI satirlar dahil; tekillestirme tavandan once
//   AN12 suzgecli (poller: adim) ve suzgecsiz okuma fiksturlerde ayni analizi verir
// Tur 3 (hedef turu sunucu | serbest, yuk araci k6 | wrk; analiz.cjs PORTAL FARKLARI 8 / 9):
//   AN13 serbest: yalniz istemci; CPU / log alanlari null, sunucu_olcumu_yok (iki eski uyari yok), sunucu
//        TUR uyarilari yok, 429 / 5xx / hata / http2 / rc istemciden, k6 dropped -> DOYMA
//   AN14 serbest + dizinde sunucu dosyalari: hepsi yok sayilir (sonuc yalniz-istemci diziniyle BIREBIR) + uyari
//   AN15 wrk: wrk_rc= etiketi, dropped null -> DOYMA yok, sunucuda host CPU > %90 DOYMA, http2 0 gecerli
//   AN16 kararVer: farkli yuk araci ve (wrk) farkli is parcacigi sayisi / farkli hiz tavani (tavan_rps) VERI_YOK + neden
//   AN17 kararVer CPU'suz yol: serbest ya da wrk+wrk (kaydedici eksik) -> RET / NOTR, ASLA KALICI; doyma
//        DOYMA; k6+k6 sunucu+sunucu bugunku VERI_YOK
//   AN18 wrk metin birimleri ("baglanti kademesinde") ve istemci bayt etiketi; k6 metinleri aynen
//   AN19 secenek dogrulamasi (TypeError); varsayilanlarla cikti tur 3 oncesiyle BAYT BAYT ayni (altin ozet)
//   AN20 wrk: ayristirma ve cpu_tlsli_pay null; 'yeni' kipinde wrk_tls_payi_hesaplanmaz uyarisi, ka ve k6'da yok
// Python karsilastirmasi (AN1-AN5) kosu duzeyi `uyarilar`i KAPSAMAZ (karsilastir.py'de kosu duzeyi
// uyari listesi yok); TUR uyarilari AN2'de ham.uyarilar uzerinden metin olarak karsilastirilir.
'use strict';

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const sonuc = require('../sonuc.cjs');
const { kosuAnaliz, kararVer, ayristirma, NEDENLER, _pyForTest: py, _adimUyarilariniKatForTest: uyariKat } = require('../analiz.cjs');
const { ADIMLAR, KARARLAR } = require('./fixtures/senaryolar.cjs');
const { parmakIzi, portalDuzeniYaz, standart, Kurgu } = require('./fixtures/kurgu.cjs');
const { WRK_OLCULMEYEN, wrkKosu, wrkDosyalari, serbestDosyalari } = require('./fixtures/wrk-serbest.cjs');
const BEKLENEN = require('./fixtures/karsilastir-beklenen.json');

const KOK = fs.mkdtempSync(path.join(os.tmpdir(), 'yuktesti-analiz-'));
after(() => fs.rmSync(KOK, { recursive: true, force: true }));

let hazir = null;
/** Butun fikstur kosularini bir kez uretir, okur (poller gibi adim suzgeciyle), analiz eder. */
function hazirla() {
  if (!hazir) {
    hazir = (async () => {
      const m = new Map();
      for (const a of ADIMLAR) {
        const dosyalar = a.uret();
        const dizin = portalDuzeniYaz(path.join(KOK, a.ad.slice(1)), dosyalar);
        const veri = await sonuc.kosuDiziniOku(dizin, { adim: a.ad });
        m.set(a.ad, { iz: parmakIzi(dosyalar), dizin, veri, analiz: kosuAnaliz(veri, { adim: a.ad }) });
      }
      return m;
    })();
  }
  return hazir;
}

function yakin(gercek, beklenen, yer) {
  if (beklenen === null || beklenen === undefined) {
    assert.equal(gercek, null, `${yer}: null (olculmedi) bekleniyordu, gelen ${gercek}`);
    return;
  }
  if (typeof beklenen === 'number') {
    assert.equal(typeof gercek, 'number', `${yer}: sayi bekleniyordu (${beklenen}), gelen ${gercek}`);
    const tol = Math.max(1e-9, Math.abs(beklenen) * 1e-6);
    assert.ok(Math.abs(gercek - beklenen) <= tol, `${yer}: ${gercek} != ${beklenen} (tolerans ${tol})`);
    return;
  }
  assert.deepEqual(gercek, beklenen, yer);
}

// Python `r` alani -> Portal adim satiri alani (ust duzey) ya da ham.<alan>.
const UST = {
  tur: 'tur', senaryo: 'senaryo', kip: 'kip', ae: 'ae', hiz: 'hiz', p50: 'p50', p95: 'p95', p99: 'p99',
  ttfb_p95: 'ttfb_p95', tls_p95: 'tls_p95', connect_p95: 'connect_p95', hata_orani: 'hata_orani',
  rps_gercek: 'gercek_rps', bayt_istek: 'bayt_istek', n_olcum: 'n_istek', n_429: 'n_429', n_5xx: 'n_5xx',
  dropped: 'dropped', rps_sunucu: 'rps_sunucu', cpu_ms_istek: 'cpu_ms_istek', host_cpu_ort: 'host_cpu_ort',
  sunucu_rt_p50: 'srt_p50', sunucu_rt_p95: 'srt_p95', sunucu_rt_p99: 'srt_p99',
};
const HAM = {
  adim: 'adim', user_ms: 'user_ms', sys_ms: 'sys_ms', cpu_oran_ms_sn: 'cpu_oran_ms_sn', arka_ms_sn: 'arka_ms_sn',
  host_cpu_max: 'host_cpu_max', pencere_sn: 'pencere_sn', pencere_kaynak: 'pencere_kaynak', diger_rps: 'diger_rps',
  govde_bayt_istek: 'govde_bayt_istek', 'yeniden_baglanti_%': 'yeniden_baglanti_yuzde',
  'log_istemci_fark_%': 'log_istemci_fark_yuzde', n_log_olcum: 'n_log_olcum', http2: 'http2', p95_js: 'p95_js',
  p95_css: 'p95_css', p95_html: 'p95_html', p95_json: 'p95_json', p95_config: 'p95_config', p95_buyuk: 'p95_buyuk',
  isinma_sn: 'isinma_sn', sure_sn: 'sure_sn', gecersiz_nedeni: 'gecersiz_nedeni', deneme: 'deneme_log',
};

test('AN1 uretec, beklenenlerin uretildigi baytlari hala uretiyor (parmak izi)', async () => {
  const m = await hazirla();
  assert.equal(Object.keys(BEKLENEN.parmak_izleri).length, ADIMLAR.length, 'katalog ile beklenen ayni boyda olmali');
  for (const a of ADIMLAR) {
    assert.equal(m.get(a.ad).iz, BEKLENEN.parmak_izleri[a.ad],
      `${a.ad}: uretec degismis; beklenenleri yeniden uretin (node fixtures/beklenen-uret.cjs <karsilastir.py>)`);
  }
  assert.match(BEKLENEN.karsilastir_sha256, /^[0-9a-f]{64}$/);
});

test('AN2 TUR satirlari: her sayi, durum, neden ve uyari karsilastir.py ile ayni', async () => {
  const m = await hazirla();
  let sayac = 0;
  for (const a of ADIMLAR) {
    const py = BEKLENEN.adimlar[a.ad];
    const an = m.get(a.ad).analiz;
    const satirlar = an.adimlar.filter((x) => x.gecerlilik !== 'HATALI');
    assert.equal(satirlar.length, py.kosular.length, `${a.ad}: TUR sayisi`);
    const logVar = m.get(a.ad).veri.loglar.length > 0;
    py.kosular.forEach((r, i) => {
      const n = satirlar[i];
      const yer = `${a.ad}/${r.tur}`;
      for (const [pk, nk] of Object.entries(UST)) yakin(n[nk], r[pk], `${yer}.${nk}`);
      for (const [pk, nk] of Object.entries(HAM)) yakin(n.ham[nk], r[pk], `${yer}.ham.${nk}`);
      assert.equal(n.gecerlilik, r.durum, `${yer}.gecerlilik`);
      assert.equal(n.ham.uyarilar.join(';'), r.uyari, `${yer}.uyarilar`);
      const gecersiz = r.gecersiz_nedeni ? r.gecersiz_nedeni.split(';') : [];
      if (r.durum === 'DOYMA') {
        assert.ok(n.nedenler.length > 0 && n.nedenler.every((x) => x.startsWith('doyma:')), `${yer}: DOYMA nedeni acik yazilmali: ${n.nedenler}`);
      } else {
        assert.deepEqual(n.nedenler, gecersiz, `${yer}.nedenler`);
      }
      assert.equal(n.sikistirma_turu, r.sikistirma_turu || null, `${yer}.sikistirma_turu`);
      // null = olculmedi: log dosyasi hic yoksa sunucu istek sayisi 0 DEGIL null.
      yakin(n.istek_sunucu, logVar ? r.n_log_olcum : null, `${yer}.istek_sunucu`);
      if (r.deneme !== null) assert.equal(n.deneme, r.deneme, `${yer}.deneme`);
      sayac++;
    });
  }
  assert.ok(sayac > 200, `kapsam suphesiz az: ${sayac} TUR`);
});

test('AN3 gruplar, arka plan bloklari, nproc ve ayristirma karsilastir.py ile ayni', async () => {
  const m = await hazirla();
  const ALAN = ['n_kosu', 'n_gecerli', 'durum', 'doyma', 'gecersizler', 'hata_max', 'n_429', 'n_5xx', 'gurultu_cpu',
    'gurultu_p95', 'host_cpu_max', 'cpu_ms_istek', 'user_ms', 'sys_ms', 'rps_gercek', 'p50', 'p95', 'p99', 'ttfb_p95',
    'tls_p95', 'hata_orani', 'sunucu_rt_p95', 'bayt_istek', 'govde_bayt_istek', 'host_cpu_ort', 'p95_buyuk', 'diger_rps',
    'turlar', 'kapasite_tahmini_rps'];
  for (const a of ADIMLAR) {
    const an = m.get(a.ad).analiz;
    const pyG = BEKLENEN.gruplar.filter((g) => g.adim === a.ad);
    assert.equal(an.ozet.gruplar.length, pyG.length, `${a.ad}: grup sayisi`);
    pyG.forEach((g, i) => {
      const n = an.ozet.gruplar[i];
      const yer = `${a.ad}/${g.senaryo}/${g.kip}/${g.ae}/${g.hiz}`;
      for (const k of ['senaryo', 'kip', 'ae', 'hiz']) assert.equal(n[k], g[k], `${yer}.${k}`);
      for (const k of ALAN) yakin(n[k], g[k], `${yer}.${k}`);
    });
    const py = BEKLENEN.adimlar[a.ad];
    yakin(an.ozet.nproc, py.nproc, `${a.ad}.nproc`);
    assert.equal(an.ozet.not, py.not, `${a.ad}.not`);
    const arka = Object.fromEntries(an.ozet.kesitler.map((k) => [k.anahtar, k.arka_plan]));
    assert.deepEqual(Object.keys(arka).sort(), Object.keys(py.arka).sort(), `${a.ad}: kesitler`);
    for (const [k, v] of Object.entries(py.arka)) {
      if (v === null) assert.equal(arka[k], null, `${a.ad}/${k}: arka plan yok`);
      else for (const x of ['user', 'sys', 'blok', 'sn']) yakin(arka[k][x], v[x], `${a.ad}/${k}.arka.${x}`);
    }
    const ayr = BEKLENEN.ayristirma[a.ad];
    if (ayr === null) assert.equal(an.ozet.ayristirma, null, `${a.ad}: ayristirma yok`);
    else for (const [k, v] of Object.entries(ayr)) yakin(an.ozet.ayristirma[k], v, `${a.ad}.ayristirma.${k}`);
  }
  // Kitin kabul testindeki altin sayilar (test_karsilastir.py): T0 = TAM 10.000 ms/istek, 8/2 ayrimi,
  // ayristirma 10/5/2.5/2.5, arka plan cikmazsa 15.000, kapasite 8*1000*0.8/10 = 640.
  const r10 = m.get('R10').analiz;
  const t0 = r10.adimlar.find((x) => x.tur === 'R10_K_yeni_br_250_r1');
  yakin(t0.cpu_ms_istek, 10.0, 'T0 cpu');
  yakin(t0.ham.user_ms, 8.0, 'T0 user');
  yakin(t0.ham.sys_ms, 2.0, 'T0 sys');
  yakin(t0.kapasite_rps, 640, 'T0 kapasite');
  assert.deepEqual(r10.ozet.ayristirma, { hiz: 250, toplam: 10, tls: 5, sik: 2.5, kalan: 2.5, user: 8, sys: 2 });
  yakin(r10.ozet.cpu_tlsli_pay, 0.5, 'T0 TLS payi');
  const r42 = m.get('R42').analiz.adimlar.find((x) => x.tur === 'R42_K_yeni_br_250_r1');
  yakin(r42.cpu_ms_istek, 15.0, 'arka plan cikarilmazsa 15');
  assert.ok(r42.ham.uyarilar.includes('arka_plan_yok(0_kabul)'));
});

// kos.sh komut onerileri Portal diline cevrilir (analiz.cjs basligi madde 4); esleme ACIK ve dar.
function portalSatiri(s) {
  let m = /^once referansi duzeltin \(hata_ ise: yollar hala 200 mu\?\), sonra ek tekrar: TEKRAR=(\d+) \.\/kos\.sh \S+ K$/.exec(s);
  if (m) return `once referansi duzeltin (hata_ ise: yollar hala 200 mu?), sonra referansi tekrar=${Math.min(3, Number(m[1]))} ile yeniden kosun`;
  m = /^(.*) istek\/sn kademesinde yeterli gecerli kosu yok \(en az 2\)\. Ek tekrar: TEKRAR=(\d+) \.\/kos\.sh \S+ K \(tamamlananlar atlanir, GECERSIZ kosu kararda dislanir\)$/.exec(s);
  if (m) return `${m[1]} istek/sn kademesinde yeterli gecerli kosu yok (en az 2). Adayi tekrar=${Math.min(3, Number(m[2]))} ile yeniden kosun (GECERSIZ kosu kararda dislanir)`;
  return s;
}

/** Satirdaki sayilari (isaret/yuzde dahil) # yapar; harfe bitisik rakam (p95, R10) korunur. */
function kalip(s) {
  return s.replace(/(?<![A-Za-z0-9])[+-]?%?[+-]?[0-9][0-9.,]*/g, '#');
}

test('AN4 kararlar: karar ve her satir karsilastir.py ile ayni (Portal farklari acik eslemeyle)', async () => {
  const m = await hazirla();
  assert.equal(BEKLENEN.kararlar.length, KARARLAR.length);
  const gorulen = new Set();
  KARARLAR.forEach((k, i) => {
    const p = BEKLENEN.kararlar[i];
    assert.equal(p.durum.ref, k.ref);
    assert.equal(p.durum.aday, k.aday);
    const yer = `${k.ref}->${k.aday} (${k.py_ad})`;
    const n = kararVer(m.get(k.ref).analiz.adimlar, m.get(k.aday).analiz.adimlar, k.node || {});
    if (k.yalnizPython) {
      // Portal farki 2: ortak birlesim B/yeni/br ise o karsilastirilir; Python VERI_YOK derdi.
      assert.equal(p.karar, 'VERI_YOK', yer);
      assert.deepEqual(n.kombinasyon, { senaryo: 'B', kip: 'yeni', ae: 'br' }, yer);
      assert.ok(n.nedenler.some((x) => x.startsWith('B (buyuk dosya) TTFB p95 @10')), yer);
      return;
    }
    gorulen.add(p.karar);
    const beklenenSatir = p.satirlar.map(portalSatiri);
    if (k.portalKarar) {
      // Portal farki 3: kademede CPU yalniz doyma yuzunden yoksa DOYMA (Python VERI_YOK).
      assert.equal(p.karar, 'VERI_YOK', `${yer}: Python karari`);
      assert.equal(n.karar, k.portalKarar, yer);
      assert.deepEqual(n.nedenler.slice(0, -1), beklenenSatir.slice(0, -1), yer);
      assert.match(n.nedenler[n.nedenler.length - 1], /^250 istek\/sn kademesinde CPU-ms\/istek yok: aday R43 doydu/);
      return;
    }
    assert.equal(n.karar, p.karar, `${yer}: karar`);
    assert.deepEqual(n.nedenler, beklenenSatir, `${yer}: satirlar`);
    for (const s of p.satirlar) gorulen.add(kalip(s));
  });
  for (const k of ['KALICI', 'NOTR', 'RET', 'GECERSIZ', 'VERI_YOK']) assert.ok(gorulen.has(k), `kapsam: ${k} karari sinanmadi`);
  // Kapsam: iki KALICI kurali, CPU ve p95 zarari, ag maliyeti, gurultu notu (sayilar kaliba cevrilir).
  for (const s of ['kural: CPU kazanci esigi gecti ve zarar yok', "kural: p95 kazanci esigi gecti ve CPU %5'ten fazla kotulesmedi",
    'zarar: p95 @400 %+20.0', 'zarar: CPU-ms/istek @250 %+11.1', 'not: ag maliyeti: bayt/istek %+15.0 (> %12)',
    'not: CPU kazanci esige 3 puandan yakin: 3. tekrar onerilir']) {
    assert.ok(gorulen.has(kalip(s)), `kapsam: '${s}' bicimli satir hicbir durumda uretilmedi`);
  }
  assert.ok([...gorulen].some((s) => s.startsWith('hata artti: ')), 'kapsam: hata artti');
  assert.ok([...gorulen].some((s) => s.startsWith('not: dislanan GECERSIZ kosu: ')), 'kapsam: dislanan kosu');
});

test('AN5 karar DB satirlarindan da ayni: ham/nedenler JSON metni, sayilar metin, camelCase alanlar', async () => {
  const m = await hazirla();
  const dbSatiri = (a) => ({ ...a, ham: JSON.stringify(a.ham), nedenler: JSON.stringify(a.nedenler), hiz: String(a.hiz) });
  const camel = (a) => {
    const o = {};
    for (const [k, v] of Object.entries(a)) o[k.replace(/_([a-z0-9])/g, (_x, c) => c.toUpperCase())] = v;
    return o;
  };
  for (const k of KARARLAR) {
    const ref = m.get(k.ref).analiz.adimlar;
    const ady = m.get(k.aday).analiz.adimlar;
    const nesne = kararVer(ref, ady, k.node || {});
    assert.deepEqual(kararVer(ref.map(dbSatiri), ady.map(dbSatiri), k.node || {}), nesne, `${k.ref}->${k.aday} DB`);
    assert.deepEqual(kararVer(ref.map(camel), ady.map(camel), k.node || {}), nesne, `${k.ref}->${k.aday} camelCase`);
  }
});

test('AN6 Python uyumlu ilkel islemler', () => {
  // yuzdelik: dogrusal ara degerleme ((n-1)*p/100), siralama ici
  assert.equal(py.yuzdelik([4, 1, 3, 2], 50), 2.5);
  assert.equal(py.yuzdelik([1, 2, 3, 4], 95), 3.85);
  assert.equal(py.yuzdelik([7], 99), 7);
  assert.equal(py.yuzdelik([], 50), null);
  // medyan: cift sayida iki ortanin ortalamasi
  assert.equal(py.medyan([3, 1, 2]), 2);
  assert.equal(py.medyan([4, 1, 3, 2]), 2.5);
  // CPython 3.12 sum (Neumaier): saf toplam 0.9999999999999999 verirdi
  assert.equal(py.pyToplam(Array(10).fill(0.1)), 1.0);
  assert.equal(py.pyToplam([1e100, 1.0, -1e100]), 1.0);
  assert.equal(py.ortalama([null, 2, 4]), 3);
  assert.equal(py.ortalama([null]), null);
  assert.equal(py.gurultu([9, 11]), 0.2);
  assert.equal(py.gurultu([5]), null);
  assert.equal(py.gurultu([1, -1]), null, 'ortalama 0 -> gurultu bilinmiyor');
  assert.equal(py.oran(9, 10), -0.1);
  assert.equal(py.oran(1, 0), null);
  // EPS: esige ESIT kazanc gecer; kayan nokta payi 1e-9
  assert.equal(py.esikGecti(0.1 - 1e-10, 0.1), true);
  assert.equal(py.esikGecti(0.1 - 1e-8, 0.1), false);
  // '%.nf' yarim-cift (toFixed yukari giderdi) ve isaretli sifir
  for (const [x, n, s] of [[0.125, 2, '0.12'], [0.375, 2, '0.38'], [2.5, 0, '2'], [3.5, 0, '4'], [1.005, 2, '1.00'],
    [-0.04, 1, '-0.0'], [-0, 1, '-0.0'], [0, 1, '0.0'], [1000.5, 0, '1000'], [10, 3, '10.000'], [-2.25, 1, '-2.2'],
    [1e21, 1, '1000000000000000000000.0']]) {
    assert.equal(py.fx(x, n), s, `fx(${x}, ${n})`);
  }
  assert.equal(py.fxs(0, 1), '+0.0');
  assert.equal(py.fxs(-0, 1), '-0.0');
  assert.equal(py.fxs(12.34, 1), '+12.3');
  assert.equal(py.fd(2.7), '2');
  assert.equal(py.fd(-2.7), '-2');
  assert.equal(py.fd(-0.5), '0');
  for (const [x, y] of [[2.5, 2], [3.5, 4], [-2.5, -2], [16.0, 16], [15.6, 16], [-0.4, 0]]) assert.equal(py.pyYuvarla(x), y, `round(${x})`);
  // Python max: esitlikte ilki
  assert.ok(Object.is(py.pyMax(-0, 0), -0));
});

test('AN6b time_local ayristirma: saat dilimi, ay adi, takvim tasmasi (calendar.timegm gibi)', () => {
  const z = sonuc.zamanEpoch;
  assert.equal(z('27/Oct/2026:10:00:00 +0300'), Date.UTC(2026, 9, 27, 7, 0, 0) / 1000);
  assert.equal(z('27/Oct/2026:10:00:00 -0500'), Date.UTC(2026, 9, 27, 15, 0, 0) / 1000);
  assert.equal(z(' 01/Jan/2027:00:00:00 +0530 '), Date.UTC(2026, 11, 31, 18, 30, 0) / 1000);
  assert.equal(z('31/Feb/2026:00:00:00 +0000'), Date.UTC(2026, 2, 3) / 1000, 'gun tasmasi Mart 3 olur');
  for (const s of ['27/oct/2026:10:00:00 +0300', '27/Okt/2026:10:00:00 +0300', '27/Oct/2026:10:00:00', '2026-10-27T10:00:00Z',
    '27/Oct/2026:10:00:00 +03:00', '', null, '27/Oct/0000:10:00:00 +0000']) {
    assert.equal(z(s), null, `taninmamali: ${s}`);
  }
});

test('AN7 HATALI satirlari, kosu gecerliligi, adim suzgeci ve JSON guvenligi', async () => {
  const m = await hazirla();
  // R55: 250_r1 kos.sh tarafindan 429 ile durduruldu -> HATALI; 100'ler gecerli -> KISMI.
  const r55 = m.get('R55').analiz;
  const h = r55.adimlar.find((x) => x.tur === 'R55_K_yeni_br_250_r1');
  assert.equal(h.gecerlilik, 'HATALI');
  assert.equal(h.nedenler[0], 'hatali_kosu(kos.sh_durdurdu)');
  assert.ok(h.nedenler.includes('k6_rc=99') && h.nedenler.some((x) => x.startsWith('429(istemci=3,sunucu=3)')), h.nedenler.join(' | '));
  assert.equal(r55.gecerlilik, 'KISMI');
  assert.ok(r55.nedenler.some((x) => x.startsWith('R55_K_yeni_br_250_r1(hatali_kosu')));
  // R54: son TUR baslatildi ama bitmedi -> HATALI tamamlanmadi.
  const r54 = m.get('R54').analiz;
  const k = r54.adimlar.find((x) => x.tur === 'R54_K_yeni_br_400_r1');
  assert.equal(k.gecerlilik, 'HATALI');
  assert.equal(k.nedenler[0], 'tamamlanmadi(istemci_sonucu_yok)');
  assert.equal(k.n_istek, null, 'istemci sonucu yok -> null, 0 DEGIL');
  assert.equal(r54.gecerlilik, 'KISMI');
  // R13: ayni TUR'un hatali_ denemesi + basarili denemesi -> HATALI satiri YOK (basarili olan kullanilir).
  const r13 = m.get('R13').analiz;
  assert.equal(r13.adimlar.filter((x) => x.gecerlilik === 'HATALI').length, 0);
  assert.equal(r13.adimlar.find((x) => x.tur === 'R13_K_yeni_br_250_r1').deneme, 2);
  // Gecerlilik: hepsi gecerli -> GECERLI; DOYMA gecerli sayilir; biri GECERSIZ -> KISMI; hepsi -> GECERSIZ.
  assert.equal(m.get('R10').analiz.gecerlilik, 'GECERLI');
  assert.equal(m.get('R38').analiz.gecerlilik, 'GECERLI');
  assert.equal(m.get('R20').analiz.gecerlilik, 'KISMI');
  assert.equal(m.get('R35').analiz.gecerlilik, 'GECERSIZ');
  assert.ok(m.get('R35').analiz.nedenler.every((x) => x.includes('kayit:log_dondu:access.log')));
  const d38 = m.get('R38').analiz.adimlar.find((x) => x.tur === 'R38_K_yeni_br_400_r1');
  assert.deepEqual(d38.nedenler, ['doyma:dropped=5']);
  const d23 = m.get('R23').analiz.adimlar.find((x) => x.tur === 'R23_K_yeni_br_400_r2');
  assert.deepEqual(d23.nedenler, ['doyma:host_cpu_%95.0(>%90)']);
  // Eksik deger null, asla 0: R39 sunucu kaydi yok.
  const r39 = m.get('R39').analiz;
  for (const a of r39.adimlar) {
    for (const f of ['cpu_ms_istek', 'host_cpu_ort', 'kapasite_rps', 'rps_sunucu']) assert.equal(a[f], null, `R39 ${a.tur}.${f}`);
  }
  assert.ok(r39.uyarilar.includes('sunucu_kaydi_yok(cpu_olculmedi)'));
  assert.equal(r39.ozet.nproc, null);
  // R40: log yok -> istek_sunucu null, uyari; pencere istemci saatinden.
  const r40 = m.get('R40').analiz;
  assert.ok(r40.uyarilar.includes('sunucu_logu_yok(log_istemci_karsilastirmasi_yapilmadi)'));
  assert.ok(r40.adimlar.every((x) => x.istek_sunucu === null && x.ham.pencere_kaynak === 'istemci_saati'));
  // Kayit uyarilari kosu duzeyinde gorunur (Python bunlari okumazdi).
  assert.ok(m.get('R36').analiz.uyarilar.includes('kayit:R36_test:konf_degisti(kayit_sirasinda):abc->def'));
  // Adim suzgeci: baska ADIM'in TUR'lari atlanir ve soylenir; hic TUR kalmazsa GECERSIZ.
  const yabanci = kosuAnaliz(m.get('R10').veri, { adim: 'R99' });
  assert.equal(yabanci.gecerlilik, 'GECERSIZ');
  assert.deepEqual(yabanci.adimlar, []);
  assert.ok(yabanci.uyarilar.includes('baska_adim_atlandi:R10_K_yeni_br_250_r1'));
  assert.ok(yabanci.uyarilar.includes('kesit_baska_adimin:R10_test'));
  assert.throws(() => kosuAnaliz(m.get('R10').veri, {}), /adim gecersiz/);
  assert.throws(() => kosuAnaliz(m.get('R10').veri, { adim: 'R1_x' }), /adim gecersiz/);
  // Bos kosu dizini (her sey eksik) -> GECERSIZ, istemci_sonucu_yok; hata atmaz.
  const bos = path.join(KOK, 'bos');
  fs.mkdirSync(bos);
  const b = kosuAnaliz(await sonuc.kosuDiziniOku(bos), { adim: 'R1' });
  assert.equal(b.gecerlilik, 'GECERSIZ');
  assert.deepEqual(b.nedenler, ['istemci_sonucu_yok']);
  // JSON guvenli: NaN/Infinity/undefined yok (DB FLOAT + JSON kolonlari).
  for (const [ad, x] of m) {
    const j = JSON.stringify(x.analiz);
    assert.deepEqual(JSON.parse(j), x.analiz, `${ad}: JSON gidis-donus`);
    assert.ok(!/NaN|Infinity/.test(j), `${ad}: sayi olmayan deger`);
  }
  // Her neden onekinin aciklamasi var (ekran sozlugu).
  for (const [, x] of m) {
    for (const a of x.analiz.adimlar) {
      for (const n of a.nedenler) assert.ok(NEDENLER.some((d) => n.startsWith(d.onek)), `aciklamasiz neden: ${n}`);
    }
  }
});

/** Katalog disi kucuk bir kurgu: Portal duzenine yazar, okur, analiz eder. */
async function analiz(adim, kurguYaDaSecenek, dosyaSecenek) {
  const k = kurguYaDaSecenek instanceof Kurgu ? kurguYaDaSecenek : standart(adim, kurguYaDaSecenek);
  const dizin = portalDuzeniYaz(path.join(KOK, `ek-${adim}`), k.dosyalar(dosyaSecenek));
  return kosuAnaliz(await sonuc.kosuDiziniOku(dizin), { adim });
}

test('AN8 kademe varsayilanlari, birlesim secimi, DOYMA ve VERI_YOK', async () => {
  const m = await hazirla();
  // Iki hiz (50, 120): kademeCpu = ortadaki (len//2 -> 120), kademeP95 = en yuksek ortak (120).
  const k31 = kararVer(m.get('R30').analiz.adimlar, m.get('R31').analiz.adimlar);
  assert.deepEqual(k31.kademe, { cpu: 120, p95: 120 });
  assert.equal(k31.karar, 'KALICI');
  // Uc hiz: 160 / 320.
  assert.deepEqual(kararVer(m.get('R32').analiz.adimlar, m.get('R33').analiz.adimlar).kademe, { cpu: 160, p95: 320 });
  // Tablo: her hiz icin ref/aday ozeti ve yuzde fark (null = olculmedi).
  const t = kararVer(m.get('R10').analiz.adimlar, m.get('R11').analiz.adimlar).tablo;
  assert.deepEqual(t.map((x) => x.hiz), [100, 250, 400]);
  yakin(t[1].fark_yuzde.cpu_ms_istek, -10, 'T1 cpu farki %');
  yakin(t[1].fark_yuzde.govde_bayt_istek, 10, 'T1 govde farki %');
  assert.equal(t[1].ref.n_kosu, 2);
  assert.deepEqual(t[1].aday.turlar, ['R11_K_yeni_br_250_r1', 'R11_K_yeni_br_250_r2']);
  // Referans bos -> VERI_YOK; HATALI satirlar karara hic girmez.
  assert.equal(kararVer([], m.get('R11').analiz.adimlar).karar, 'VERI_YOK');
  const yalnizHatali = m.get('R55').analiz.adimlar.filter((x) => x.gecerlilik === 'HATALI');
  const vy = kararVer(m.get('R10').analiz.adimlar, yalnizHatali);
  assert.equal(vy.karar, 'VERI_YOK');
  assert.equal(vy.nedenler[1], 'K/yeni/br kosusu eksik (referans 3 kademe, aday 0 kademe)');
  // Kademe varsayilani ortak hizdan: R55 (yalniz 100 gecerli) -> 100'de karar verilir (Python 250'de VERI_YOK).
  assert.deepEqual(kararVer(m.get('R10').analiz.adimlar, m.get('R55').analiz.adimlar).kademe, { cpu: 100, p95: 100 });
  // Birlesim: ikisi de yalniz K/ka/br ise o karsilastirilir (Portal kosusu tek kip ile kosar).
  const kaRef = new Kurgu('R61');
  const kaAdy = new Kurgu('R62');
  for (const r of [1, 2]) {
    kaRef.kosu({ kip: 'ka', hiz: 250, r, ru: 16, rs: 4 });
    kaAdy.kosu({ kip: 'ka', hiz: 250, r, ru: 14, rs: 4 });
  }
  const kaAdySatir = (await analiz('R62', kaAdy, {})).adimlar;
  const kaRefSatir = (await analiz('R61', kaRef, {})).adimlar;
  const ka = kararVer(kaRefSatir, kaAdySatir);
  assert.deepEqual(ka.kombinasyon, { senaryo: 'K', kip: 'ka', ae: 'br' });
  assert.equal(ka.karar, 'KALICI', ka.nedenler.join('\n'));
  // Adayda siralamada once gelen ama referansta OLMAYAN birlesim (K/yeni/gzip) varken de ORTAK olan secilir.
  const gzip = new Kurgu('R64');
  gzip.kosu({ ae: 'gzip', hiz: 250 });
  const karisik = kararVer(kaRefSatir, [...(await analiz('R64', gzip, {})).adimlar, ...kaAdySatir]);
  assert.deepEqual(karisik.kombinasyon, { senaryo: 'K', kip: 'ka', ae: 'br' });
  // Ortak birlesim yok -> VERI_YOK ve hangi birlesimin eksik oldugu yazilir.
  const yok = kararVer(m.get('R10').analiz.adimlar.filter((x) => x.kip === 'yeni' && x.ae === 'br'),
    (await analiz('R63', (() => { const x = new Kurgu('R63'); x.kosu({ ae: 'gzip', hiz: 250 }); return x; })(), {})).adimlar);
  assert.equal(yok.karar, 'VERI_YOK');
  assert.equal(yok.nedenler[1], 'K/yeni/br kosusu eksik (referans 3 kademe, aday 0 kademe)');
  // DOYMA: referans tarafinda doyma da DOYMA verir.
  const d = kararVer(m.get('R43').analiz.adimlar, m.get('R10').analiz.adimlar);
  assert.equal(d.karar, 'DOYMA');
  assert.match(d.nedenler[1], /referans R43 doydu/);
  // Esik secenekleri metin olarak da gelebilir (sorgu dizgisi).
  assert.equal(kararVer(m.get('R10').analiz.adimlar, m.get('R12').analiz.adimlar, { esikCpu: '5' }).karar, 'KALICI');
  assert.equal(kararVer(m.get('R10').analiz.adimlar, m.get('R12').analiz.adimlar, { esikCpu: 'abc' }).karar, 'NOTR', 'gecersiz esik -> varsayilan 10');
  // ayristirma birden cok kosunun satirlarini birlestirebilir (ayni kosuda tek kip/ae oldugu icin).
  const ayr = ayristirma([...m.get('R10').analiz.adimlar]);
  assert.deepEqual(ayr, { hiz: 250, toplam: 10, tls: 5, sik: 2.5, kalan: 2.5, user: 8, sys: 2 });
  assert.equal(ayristirma(m.get('R11').analiz.adimlar), null);
});

test('AN9 sonuc.cjs ve analiz.cjs `sayi` kopyalari esdeger (iki modul birbirini require etmez)', () => {
  const girdiler = ['', ' ', 'nan', 'NaN', '-', 'none', 'None', 'null', 'NULL', '1', ' 2.5 ', '+3', '-4e2', '.5', '5.',
    '1_000', '1__0', '_1', '0x10', 'inf', '-Infinity', '1e400', '12abc', 0, -0, 7.5, NaN, Infinity, null, undefined];
  for (const g of girdiler) assert.ok(Object.is(sonuc.sayi(g), py.sayi(g)), `sayi(${String(g)}): ${sonuc.sayi(g)} vs ${py.sayi(g)}`);
  assert.equal(py.sayi('1_000'), 1000);
  assert.equal(py.sayi('0x10'), null);
  assert.equal(py.sayi('1e400'), null);
});

const KATLI = /^R[0-9]+_[^ ]*: /;

test('AN10 TUR uyarilari kosu duzeyinde "<tur>: <uyari>": sonda, adim sirasiyla; onceki uyarilar ve adim satirlari degismez', async () => {
  const m = await hazirla();
  let toplam = 0;
  for (const a of ADIMLAR) {
    const an = m.get(a.ad).analiz;
    const beklenen = an.adimlar.flatMap((s) => s.ham.uyarilar.map((u) => `${s.tur}: ${u}`));
    assert.ok(beklenen.length <= 40, `${a.ad}: fikstur tavanin altinda kalmali`);
    const once = an.uyarilar.slice(0, an.uyarilar.length - beklenen.length);
    assert.deepEqual(an.uyarilar.slice(once.length), beklenen, `${a.ad}: TUR uyarilari sonda ve adim sirasiyla`);
    assert.ok(!once.some((u) => KATLI.test(u)), `${a.ad}: katlanmis satir yalniz sonda`);
    toplam += beklenen.length;
  }
  assert.ok(toplam >= 30, `kapsam: ${toplam} katlanmis satir`);
  // analiz-2 senaryolari, tam liste: diger trafik (tek uyari yoktu), sunucu kaydi yok, log yok.
  const hizlar = ['100_r1', '100_r2', '250_r1', '250_r2', '400_r1', '400_r2'];
  assert.deepEqual(m.get('R52').analiz.uyarilar, hizlar.map((x) => `R52_K_yeni_br_${x}: diger_trafik_%5`));
  assert.deepEqual(m.get('R39').analiz.uyarilar, ['sunucu_kaydi_yok(cpu_olculmedi)', ...hizlar.map((x) => `R39_K_yeni_br_${x}: sunucu_kaydi_yok`)]);
  assert.deepEqual(m.get('R40').analiz.uyarilar, ['sunucu_logu_yok(log_istemci_karsilastirmasi_yapilmadi)',
    ...hizlar.flatMap((x) => [`R40_K_yeni_br_${x}: log_satiri_yok:pencere_istemci_saatinden`, `R40_K_yeni_br_${x}: sunucu_logunda_bu_tur_yok`])]);
  // Yalniz kosu uyarilari degisir: adim satirlarinin gecerliligi / nedenleri ayni (rps_sunucu AN2'de Python'la).
  assert.ok(m.get('R52').analiz.adimlar.every((x) => x.gecerlilik === 'GECERLI' && x.nedenler.length === 0));
  assert.equal(m.get('R52').analiz.gecerlilik, 'GECERLI');
});

/** Bellekte KosuVerisi: n istemci + h hatali TUR'u; log ve kesit yok -> her TUR'da tek uyari. */
function bellekVerisi(n, h = 0) {
  const satir = (i) => ({ tur: `R7_K_yeni_br_${i}_r1`, adim: 'R7', senaryo: 'K', kip: 'yeni', ae: 'br', hiz: String(i), n_olcum: '10' });
  return {
    istemci: Array.from({ length: n }, (_, i) => ({ dosya: 'i', satir: satir(i + 1) })),
    hataliIstemci: Array.from({ length: h }, (_, i) => ({ dosya: 'h', satir: satir(401 + i) })),
    zaman: null, baslatilan: null, kesitler: [], log: { fazlar: [], turlar: new Map() }, loglar: [], diger: new Map(), uyarilar: [],
  };
}

test('AN11 TUR uyarisi tavani: en cok 40 satir + "… ve <n> adım uyarısı daha"; HATALI dahil; tekillestirme tavandan once', () => {
  const ON = ['sunucu_kaydi_yok(cpu_olculmedi)', 'sunucu_logu_yok(log_istemci_karsilastirmasi_yapilmadi)'];
  const sat = (i) => `R7_K_yeni_br_${i}_r1: sunucu_logunda_bu_tur_yok`;
  const k40 = kosuAnaliz(bellekVerisi(40), { adim: 'R7' });
  assert.deepEqual(k40.uyarilar, [...ON, ...Array.from({ length: 40 }, (_, i) => sat(i + 1))], 'tam 40: ozet satiri yok');
  const k41 = kosuAnaliz(bellekVerisi(41), { adim: 'R7' });
  assert.deepEqual(k41.uyarilar.slice(-2), [sat(40), '… ve 1 adım uyarısı daha']);
  assert.equal(k41.uyarilar.length, ON.length + 41);
  // HATALI satirlarin uyarisi da katilir (sira: istemci TUR'lari, sonra HATALI).
  const h = kosuAnaliz(bellekVerisi(2, 1), { adim: 'R7' });
  assert.equal(h.adimlar[2].gecerlilik, 'HATALI');
  assert.deepEqual(h.uyarilar.slice(ON.length), [sat(1), sat(2), sat(401)]);
  const kh = kosuAnaliz(bellekVerisi(45, 2), { adim: 'R7' });
  assert.deepEqual(kh.uyarilar.slice(-2), [sat(40), '… ve 7 adım uyarısı daha']);
  // JSON / poller metin listesi: ozet satiri dahil her satir kisa metin.
  assert.ok(kh.uyarilar.every((u) => typeof u === 'string' && u.length < 500));
  // Tekillestirme (yardimci dogrudan; kosuAnaliz ayni TUR'u iki kez uretmez). Var olan liste korunur.
  assert.deepEqual(uyariKat(['once'], [
    { tur: 'T1', ham: { uyarilar: ['a', 'b', 'a'] } }, { tur: 'T1', ham: { uyarilar: ['b', 'c'] } },
    { tur: 'T2', ham: { uyarilar: ['a'] } }, { tur: 'T3', ham: {} },
  ]), ['once', 'T1: a', 'T1: b', 'T1: c', 'T2: a']);
  const tekrarli = Array.from({ length: 40 }, (_, i) => ({ tur: `T${i}`, ham: { uyarilar: ['u'] } }));
  tekrarli.push({ tur: 'T0', ham: { uyarilar: ['u'] } }, { tur: 'T1', ham: { uyarilar: ['u'] } });
  assert.equal(uyariKat([], tekrarli).length, 40, '42 ham satir, 40 tekil: ozet satiri yok');
});

test('AN12 suzgecli (poller: adim) ve suzgecsiz okuma fiksturlerde ayni analizi verir (suzgec gercek veriyi atmaz)', async () => {
  const m = await hazirla();
  for (const a of ADIMLAR) {
    const x = m.get(a.ad);
    assert.ok(!x.veri.uyarilar.some((u) => u.startsWith('log_baska_adim_satiri')), `${a.ad}: elenen satir olmamali`);
    assert.deepEqual(kosuAnaliz(await sonuc.kosuDiziniOku(x.dizin), { adim: a.ad }), x.analiz, a.ad);
  }
});

// ---------------------------------------------------------------------------------------------
// Tur 3: hedef turu (sunucu | serbest) ve yuk araci (k6 | wrk) -- analiz.cjs PORTAL FARKLARI 8 / 9
// ---------------------------------------------------------------------------------------------

const SERBEST_UYARI = 'sunucu_olcumu_yok(serbest_hedef)';
const WRK_TLS = 'wrk_tls_payi_hesaplanmaz(oturum_devami_ya_da_tls13_olabilir)';
const CPU_YOK_SERBEST = 'CPU olculmedi (serbest hedef): KALICI verilmez; karar p95 ve hata oranina gore';
const CPU_YOK_WRK = 'CPU olculmedi (wrk, sunucu kaydi eksik): KALICI verilmez; karar p95 ve hata oranina gore';
// Sunucu verisine dayanan TUR uyarilari: serbest hedefte HIC uretilmez.
const SUNUCU_TUR_UYARISI = /^(log_satiri_yok|sunucu_kaydi_yok|sunucu_logunda_bu_tur_yok|pencerede_ornek_yok|arka_plan_)/;
// Sunucu verisinden gelen adim alanlari (ust duzey ve ham): serbest hedefte hepsi null (olculmedi, 0 DEGIL).
const SUNUCU_ALANLARI = ['cpu_ms_istek', 'host_cpu_ort', 'kapasite_rps', 'rps_sunucu', 'istek_sunucu', 'srt_p50', 'srt_p95', 'srt_p99'];
const SUNUCU_HAM = ['kesit', 'n_log_olcum', 'n_429_sunucu', 'n_5xx_sunucu', 'log_istemci_fark_yuzde', 'pencere_sn', 'user_ms',
  'sys_ms', 'cpu_oran_ms_sn', 'arka_ms_sn', 'host_cpu_max', 'diger_rps', 'govde_bayt_istek', 'yeniden_baglanti_yuzde'];
const WRK = { refMotor: 'wrk', adayMotor: 'wrk' };

let t3Sira = 0;
/** Tur 3 kurgusu: dosyalar (`donustur` ile wrk / serbest bicimine) -> Portal duzeni -> okuma -> secenekli analiz. */
async function t3Analiz(k, { dosya = {}, donustur = (d) => d, secenek = {} } = {}) {
  const dizin = portalDuzeniYaz(path.join(KOK, `t3-${k.adim}-${++t3Sira}`), donustur(k.dosyalar(dosya)));
  const veri = await sonuc.kosuDiziniOku(dizin, { adim: k.adim });
  return { veri, analiz: kosuAnaliz(veri, { adim: k.adim, ...secenek }) };
}
const turla = (an) => new Map(an.adimlar.map((a) => [a.tur, a]));
function aciklamali(an) {
  for (const a of an.adimlar) for (const n of a.nedenler) assert.ok(NEDENLER.some((d) => n.startsWith(d.onek)), `aciklamasiz neden: ${n}`);
}

/** wrk kosusu: 2 / 4 / 8 baglanti x 2 tekrar, ka kipi; `kosuEk(n, r)` kosu ayarini degistirir. */
function wrkKurgu(ad, kosuEk = null) {
  const k = new Kurgu(ad);
  for (const n of [2, 4, 8]) for (const r of [1, 2]) wrkKosu(k, { kip: 'ka', hiz: n, r, ...(kosuEk ? kosuEk(n, r) : {}) });
  return k;
}
/** wrk bicimli dosyalarla sunucu kipinde motor wrk analizi; adim satirlarini dondurur. */
async function wrkAdimlari(k, { dosya = {} } = {}) {
  return (await t3Analiz(k, { dosya, donustur: (d) => wrkDosyalari(k, d), secenek: { motor: 'wrk' } })).analiz.adimlar;
}
/** Serbest k6 kosusu (yalniz yuk makinesi dosyalari): 50 / 100 / 200 istek/sn x 2 tekrar. */
async function serbestK6(ad, kosuEk) {
  const k = standart(ad, { hizlar: [50, 100, 200], kosuEk });
  return (await t3Analiz(k, { donustur: serbestDosyalari, secenek: { hedefTuru: 'serbest' } })).analiz.adimlar;
}

test('AN13 serbest: yalniz istemci olcumu; CPU / log alanlari null, sunucu_olcumu_yok, sunucu uyarilari yok, istemci kurallari calisir', async () => {
  const k = new Kurgu('R71');
  for (const r of [1, 2]) k.kosu({ hiz: 50, r });
  k.kosu({ hiz: 100, r: 1, n429: 3 });
  k.kosu({ hiz: 100, r: 2, istemciAlan: { n_5xx: 2 } });
  k.kosu({ hiz: 200, r: 1, hata: 0.002 });
  k.kosu({ hiz: 200, r: 2, istemciAlan: { http2: 1 } });
  k.kosu({ hiz: 300, r: 1, dropped: 5 });
  k.kosu({ hiz: 300, r: 2, hatali: true });
  const { veri, analiz: a } = await t3Analiz(k, { donustur: serbestDosyalari, secenek: { hedefTuru: 'serbest' } });
  assert.ok(veri.dosyalar.every((d) => /^(?:(?:hatali_)?istemci_|zaman\.csv$|baslatilan\.csv$|SHA256SUMS$)/.test(d.ad)),
    `fikstur: serbest dizininde yalniz yuk makinesi dosyalari: ${veri.dosyalar.map((d) => d.ad).join(' ')}`);
  const t = turla(a);
  // Gecerlilik yalniz istemci kurallarindan; 429 / 5xx nedeninde sunucu sayisi YOK (olculmedi). (Hata orani
  // istemci CSV'sinde 3 haneye yuvarlidir: 3/1200 -> 0.003.)
  const bekle = {
    R71_K_yeni_br_50_r1: ['GECERLI', []],
    R71_K_yeni_br_50_r2: ['GECERLI', []],
    R71_K_yeni_br_100_r1: ['GECERSIZ', ['429(istemci=3)', 'hata_%0.30(>%0.1)']],
    R71_K_yeni_br_100_r2: ['GECERSIZ', ['5xx(istemci=2)']],
    R71_K_yeni_br_200_r1: ['GECERSIZ', ['hata_%0.20(>%0.1)']],
    R71_K_yeni_br_200_r2: ['GECERSIZ', ['http2']],
    R71_K_yeni_br_300_r1: ['DOYMA', ['doyma:dropped=5']],
    R71_K_yeni_br_300_r2: ['HATALI', ['hatali_kosu(kos.sh_durdurdu)', 'k6_rc=99']],
  };
  assert.deepEqual([...t.keys()].sort(), Object.keys(bekle).sort());
  for (const [tur, [gecerlilik, nedenler]] of Object.entries(bekle)) {
    assert.equal(t.get(tur).gecerlilik, gecerlilik, tur);
    assert.deepEqual(t.get(tur).nedenler, nedenler, tur);
  }
  for (const s of a.adimlar) {
    for (const f of SUNUCU_ALANLARI) assert.equal(s[f], null, `${s.tur}.${f}`);
    for (const f of SUNUCU_HAM) assert.equal(s.ham[f], null, `${s.tur}.ham.${f}`);
    assert.equal(s.ham.pencere_kaynak, '-', `${s.tur}: serbestte olcum penceresi kurulmaz`);
    assert.ok(!s.ham.uyarilar.some((u) => SUNUCU_TUR_UYARISI.test(u)), `${s.tur}: ${s.ham.uyarilar}`);
  }
  // Istemci alanlari aynen (null yalniz olculmeyende).
  const g = t.get('R71_K_yeni_br_50_r1');
  assert.deepEqual([g.p95, g.n_istek, g.gercek_rps, g.bayt_istek, g.ttfb_p95, g.deneme], [50, 1200, 20, 10000, 40, 1]);
  // Kosu uyarilari: tam liste; sunucu_kaydi_yok(cpu_olculmedi) / sunucu_logu_yok(...) YERINE tek uyari.
  assert.deepEqual(a.uyarilar, [SERBEST_UYARI, 'R71_K_yeni_br_300_r1: dropped_iterations=5']);
  assert.equal(a.gecerlilik, 'KISMI');
  assert.equal(a.nedenler.length, 5);
  assert.deepEqual([a.ozet.nproc, a.ozet.kesitler, a.ozet.loglar, a.ozet.ayristirma, a.ozet.cpu_tlsli_pay], [null, [], [], null, null]);
  assert.ok(a.ozet.gruplar.every((x) => x.cpu_ms_istek === null && x.host_cpu_ort === null && x.kapasite_tahmini_rps === null));
  // Ayni dizin sunucu kipinde (varsayilan) bugunku gibi: iki eski uyari, sunucu sayili metin, sunucu TUR uyarilari.
  const s = kosuAnaliz(veri, { adim: 'R71' });
  assert.deepEqual(s.uyarilar.slice(0, 2), ['sunucu_kaydi_yok(cpu_olculmedi)', 'sunucu_logu_yok(log_istemci_karsilastirmasi_yapilmadi)']);
  assert.ok(!s.uyarilar.includes(SERBEST_UYARI));
  assert.deepEqual(turla(s).get('R71_K_yeni_br_100_r1').nedenler, ['429(istemci=3,sunucu=0)', 'hata_%0.30(>%0.1)']);
  assert.ok(s.adimlar.every((x) => x.ham.uyarilar.includes('log_satiri_yok:pencere_istemci_saatinden')));
  assert.deepEqual(Object.keys(a.ozet), Object.keys(s.ozet), 'ozet semasi degismez');
  assert.deepEqual(Object.keys(a.adimlar[0]), Object.keys(s.adimlar[0]), 'adim semasi degismez');
  aciklamali(a);
});

test('AN14 serbest: dizindeki sunucu dosyalari (kesit, bilgi, log, diger) yok sayilir ve tek uyariyla soylenir; sonuc yalniz-istemci diziniyle ayni', async () => {
  const yap = () => {
    const k = standart('R72', {
      ru: 22,
      hizlar: [100, 250],
      kosuEk: (h, r) => {
        if (h === 100 && r === 2) return { n429: 3, istemciAlan: { n_429: 0, hata_orani: 0 } }; // 429 yalniz sunucu logunda
        if (h === 250 && r === 1) return { host: 760 }; // host CPU %95
        if (h === 250 && r === 2) return { fark: 1.05 }; // log / istemci farki %5
        return {};
      },
    });
    k.digerEkle(k.t0, k.t, 1);
    return k;
  };
  const tam = await t3Analiz(yap(), { secenek: { hedefTuru: 'serbest' } });
  const yalniz = await t3Analiz(yap(), { donustur: serbestDosyalari, secenek: { hedefTuru: 'serbest' } });
  // Sunucu dosyalari gercekten veri tasiyor: ayni dizin sunucu kipinde CPU, DOYMA, 429 ve log farki gorur.
  const sun = turla(kosuAnaliz(tam.veri, { adim: 'R72' }));
  assert.equal(sun.get('R72_K_yeni_br_250_r1').gecerlilik, 'DOYMA');
  assert.deepEqual(sun.get('R72_K_yeni_br_100_r2').nedenler, ['429(istemci=0,sunucu=3)']);
  assert.deepEqual(sun.get('R72_K_yeni_br_250_r2').nedenler, ['log_istemci_farki_%4.8']);
  assert.ok(sun.get('R72_K_yeni_br_100_r1').cpu_ms_istek > 0);
  // Serbest kipte hicbiri etkilemez: adim satirlari yalniz-istemci diziniyle BIREBIR, hepsi GECERLI.
  assert.deepEqual(tam.analiz.adimlar, yalniz.analiz.adimlar);
  assert.ok(tam.analiz.adimlar.every((x) => x.gecerlilik === 'GECERLI' && x.cpu_ms_istek === null && x.istek_sunucu === null));
  assert.deepEqual([tam.analiz.gecerlilik, tam.analiz.nedenler], ['GECERLI', []]);
  const sunucuDosyasi = tam.veri.dosyalar.map((d) => d.ad).filter((ad) => /^(sunucu|bilgi|log|diger)_/.test(ad));
  assert.deepEqual(sunucuDosyasi, ['bilgi_R72_test.txt', 'diger_R72_test.tsv', 'log_R72_test.tsv.gz', 'sunucu_R72_test.csv']);
  assert.deepEqual(tam.analiz.uyarilar, ['serbest_kosuda_sunucu_dosyalari_yok_sayildi(4)', SERBEST_UYARI]);
  assert.deepEqual(yalniz.analiz.uyarilar, [SERBEST_UYARI]);
  // ozet: kesit / log / nproc yok; geri kalani (okunan bayt, sha ozeti ve NOT.txt disinda) ayni.
  const ozetKiyas = (o) => ({ ...o, okunan_bayt: null, sha256: null, not: null });
  assert.deepEqual(ozetKiyas(tam.analiz.ozet), ozetKiyas(yalniz.analiz.ozet));
  assert.deepEqual([tam.analiz.ozet.kesitler, tam.analiz.ozet.loglar, tam.analiz.ozet.nproc], [[], [], null]);
  // Dosya listesi olmayan (bellekte kurulmus) veri: en az kesit + log + diger kaynagi kadar sayilir.
  const bellek = kosuAnaliz({ ...tam.veri, dosyalar: undefined }, { adim: 'R72', hedefTuru: 'serbest' });
  assert.deepEqual(bellek.uyarilar, ['serbest_kosuda_sunucu_dosyalari_yok_sayildi(3)', SERBEST_UYARI]);
  assert.deepEqual(bellek.adimlar, yalniz.analiz.adimlar);
});

test('AN15 wrk: rc etiketi wrk_rc=, dropped olculmez (null, DOYMA yok), sunucuda host CPU > %90 DOYMA aynen, http2 0 gecerli', async () => {
  const k = new Kurgu('R73');
  for (const n of [2, 4]) for (const r of [1, 2]) wrkKosu(k, { kip: 'ka', hiz: n, r, host: n === 4 && r === 2 ? 760 : 400 });
  wrkKosu(k, { kip: 'ka', hiz: 8, r: 1, hatali: true });
  const { veri, analiz: a } = await t3Analiz(k, { donustur: (d) => wrkDosyalari(k, d), secenek: { motor: 'wrk' } });
  const ist = veri.istemci.find((x) => x.satir.tur === 'R73_K_ka_br_2_r1').satir;
  for (const f of WRK_OLCULMEYEN) assert.equal(ist[f], '', `fikstur: wrk CSV'sinde ${f} bos hucre`);
  assert.equal(ist.http2, '0');
  const t = turla(a);
  for (const tur of ['R73_K_ka_br_2_r1', 'R73_K_ka_br_2_r2', 'R73_K_ka_br_4_r1']) {
    const s = t.get(tur);
    assert.equal(s.gecerlilik, 'GECERLI', `${tur}: ${s.nedenler}`);
    assert.deepEqual(s.nedenler, []);
    for (const f of ['dropped', 'ttfb_p95', 'tls_p95', 'connect_p95']) assert.equal(s[f], null, `${tur}.${f}: olculmedi (0 DEGIL)`);
    for (const f of ['p95_js', 'p95_css', 'p95_html', 'p95_json', 'p95_config', 'p95_buyuk']) assert.equal(s.ham[f], null, `${tur}.ham.${f}`);
    assert.equal(s.ham.http2, 0);
    assert.ok(s.cpu_ms_istek > 0, `${tur}: sunucu kipinde CPU olculur`);
    assert.ok(!s.ham.uyarilar.some((u) => u.startsWith('dropped_iterations')), `${tur}: ${s.ham.uyarilar}`);
  }
  assert.equal(t.get('R73_K_ka_br_4_r2').gecerlilik, 'DOYMA');
  assert.deepEqual(t.get('R73_K_ka_br_4_r2').nedenler, ['doyma:host_cpu_%95.0(>%90)']);
  const h = t.get('R73_K_ka_br_8_r1');
  assert.equal(h.gecerlilik, 'HATALI');
  assert.deepEqual(h.nedenler, ['hatali_kosu(kos.sh_durdurdu)', 'wrk_rc=99']);
  // Ayni veri k6 diye okunursa etiket k6_rc= (bugunku); TEK fark etiket (ka kipi: TLS kurali devreye girmez).
  const k6 = kosuAnaliz(veri, { adim: 'R73' });
  assert.deepEqual(turla(k6).get('R73_K_ka_br_8_r1').nedenler, ['hatali_kosu(kos.sh_durdurdu)', 'k6_rc=99']);
  assert.equal(JSON.stringify(k6.adimlar).replaceAll('k6_rc=', 'wrk_rc='), JSON.stringify(a.adimlar));
  assert.deepEqual(a.uyarilar, k6.uyarilar);
  assert.ok(!a.uyarilar.includes(WRK_TLS), 'ka kipinde TLS payi uyarisi yok');
  assert.deepEqual(NEDENLER.find((d) => d.onek === 'wrk_rc'),
    { onek: 'wrk_rc', anlam: 'wrk hata koduyla bitti.', cozum: 'Is ciktisindaki wrk mesajina bakin; kosuyu tekrarlayin.' });
  assert.equal(NEDENLER.find((d) => d.onek === 'hatali_kosu').anlam,
    "kos.sh / wrk_kos.sh bu TUR'u durdurdu (429 / 5xx / soket / hata orani / http2 / hata kodu / olcum yok).");
  aciklamali(a);
});

test('AN16 kararVer: farkli yuk araci (k6 / wrk), farkli is parcacigi sayisi ve farkli hiz tavani (wrk) VERI_YOK; ilk satir degismez', async () => {
  const m = await hazirla();
  const r10 = m.get('R10').analiz.adimlar;
  const r11 = m.get('R11').analiz.adimlar;
  const ilk = 'referans=R10 aday=R11 senaryo=K kip=yeni ae=br';
  for (const [refMotor, adayMotor] of [['k6', 'wrk'], ['wrk', 'k6']]) {
    const x = kararVer(r10, r11, { refMotor, adayMotor });
    assert.equal(x.karar, 'VERI_YOK');
    assert.deepEqual(x.nedenler, [ilk,
      `farkli yuk araci: referans ${refMotor}, aday ${adayMotor}; k6 (acik dongu, istek/sn) ve wrk (kapali dongu, baglanti) sonuclari karsilastirilmaz`]);
    assert.deepEqual(Object.keys(x), ['karar', 'nedenler', 'tablo', 'kademe', 'kombinasyon']);
    assert.equal(x.tablo.length, 3, 'tablo yine kurulur');
  }
  // Motor farki adim eksikliginden ONCE denetlenir; serbest + sunucu farki VERI_YOK DEGIL (AN17: CPU'suz yol).
  assert.match(kararVer([], [], { refMotor: 'wrk' }).nedenler[1], /^farkli yuk araci: referans wrk, aday k6;/);
  assert.notEqual(kararVer(r10, r11, { adayHedefTuru: 'serbest' }).karar, 'VERI_YOK');
  // wrk + wrk: is parcacigi farki VERI_YOK (sayi metin olarak da gelebilir); ayni ya da bilinmeyen (null) -> karar verilir.
  for (const [refIsParcacigi, adayIsParcacigi] of [[2, 4], ['2', '4']]) {
    const x = kararVer(r10, r11, { ...WRK, refIsParcacigi, adayIsParcacigi });
    assert.equal(x.karar, 'VERI_YOK');
    assert.deepEqual(x.nedenler, [ilk, 'farkli is parcacigi sayisi: referans 2, aday 4; ayni is parcacigi sayisiyla yeniden kosun']);
  }
  const bugun = kararVer(r10, r11);
  assert.equal(bugun.karar, 'KALICI');
  for (const ip of [{ refIsParcacigi: 2, adayIsParcacigi: 2 }, { refIsParcacigi: 2, adayIsParcacigi: null }, {}]) {
    assert.deepEqual(kararVer(r10, r11, { ...WRK, ...ip }), bugun, `wrk + wrk ${JSON.stringify(ip)}: CPU varken bugunku akis`);
  }
  // k6'da is parcacigi karsilastirilmaz.
  assert.deepEqual(kararVer(r10, r11, { refIsParcacigi: 2, adayIsParcacigi: 4 }), bugun);

  // wrk + wrk, ayni N 2/4/8 ve T=2, farkli hiz tavani (tavan_rps 450 / 90): ayni kademe farkli sunulan yuk
  // (Lua delay = N * 1000 / tavan; dusuk tavanda p95 dusuk cikar). Denetim yokken bu cift KALICI aliyordu.
  const wRef = await wrkAdimlari(wrkKurgu('R93'));
  const wAday = await wrkAdimlari(wrkKurgu('R94', () => ({ ru: 21 })));
  const T2 = { ...WRK, refIsParcacigi: 2, adayIsParcacigi: 2 };
  const tavansiz = kararVer(wRef, wAday, T2);
  assert.equal(tavansiz.karar, 'KALICI', 'fikstur: tavan bilinmeden karar KALICI');
  const wIlk = 'referans=R93 aday=R94 senaryo=K kip=ka ae=br';
  for (const [refTavanRps, adayTavanRps, a, b] of [[450, 90, 450, 90], [90, 450, 90, 450], ['450', '90', 450, 90]]) {
    const x = kararVer(wRef, wAday, { ...T2, refTavanRps, adayTavanRps });
    assert.equal(x.karar, 'VERI_YOK', `${refTavanRps} -> ${adayTavanRps}`);
    assert.deepEqual(x.nedenler, [wIlk, `farkli hiz tavani: referans ${a} istek/sn, aday ${b} istek/sn; ayni tavanla yeniden kosun`]);
    assert.deepEqual(Object.keys(x), ['karar', 'nedenler', 'tablo', 'kademe', 'kombinasyon']);
  }
  // CPU'suz yolda da (bir taraf serbest: sunucu 450 -> serbest 200) once tavan denetimi.
  const karisik = kararVer(wRef, wAday, { ...T2, adayHedefTuru: 'serbest', refTavanRps: 450, adayTavanRps: 200 });
  assert.deepEqual([karisik.karar, karisik.nedenler[1]], ['VERI_YOK', 'farkli hiz tavani: referans 450 istek/sn, aday 200 istek/sn; ayni tavanla yeniden kosun']);
  // Is parcacigi farki once soylenir (ilk VERI_YOK nedeni).
  assert.match(kararVer(wRef, wAday, { ...WRK, refIsParcacigi: 2, adayIsParcacigi: 4, refTavanRps: 450, adayTavanRps: 90 }).nedenler[1], /^farkli is parcacigi sayisi:/);
  // Ayni tavan ya da bilinmeyen (null / verilmedi) tavan: karar DEGISMEZ (eski satir, tur 3 oncesi cagiran).
  for (const tv of [{ refTavanRps: 450, adayTavanRps: 450 }, { refTavanRps: 450, adayTavanRps: null }, { refTavanRps: null, adayTavanRps: 90 }, {}]) {
    assert.deepEqual(kararVer(wRef, wAday, { ...T2, ...tv }), tavansiz, JSON.stringify(tv));
  }
  // k6'da tavan karsilastirilmaz (k6 adimi istek/sn'dir).
  assert.deepEqual(kararVer(r10, r11, { refTavanRps: 450, adayTavanRps: 90 }), bugun);
});

test('AN17 kararVer CPU\'suz yol: serbest ya da wrk+wrk (kaydedici eksik) -> RET / NOTR, ASLA KALICI; doyma DOYMA; k6+k6 bugunku VERI_YOK', async () => {
  const m = await hazirla();
  const S = { refHedefTuru: 'serbest', adayHedefTuru: 'serbest' };
  const ref = await serbestK6('R74');
  const ayni = await serbestK6('R75');
  const kotu = await serbestK6('R76', (h) => (h === 200 ? { p95: 60 } : {}));
  const iyi = await serbestK6('R77', () => ({ p95: 35 }));
  const hatali = await serbestK6('R78', (h, r) => (h === 100 && r === 1 ? { istemciAlan: { n_5xx: 2 } } : {}));
  const p95 = (h, a, d) => `p95 @${h}: ref=50.0 aday=${a} degisim=%${d} (zarar esigi %5.0)`;
  const bayt = 'bayt/istek @100 [istemci data_received: TLS + baslik dahil, fark kucuk gorunur]: ref=10000 aday=10000 degisim=%+0.0';
  const cpuSatiri = (n) => n.some((x) => x.startsWith('CPU-ms/istek') || x.startsWith('p95 kazanci') || x.startsWith('kural:'));
  // Fark yok -> NOTR + CPU olculmedi notu (tam satirlar: bugunku p95 satirlari, CPU satiri YOK).
  const n = kararVer(ref, ayni, S);
  assert.equal(n.karar, 'NOTR');
  assert.deepEqual(n.nedenler, ['referans=R74 aday=R75 senaryo=K kip=yeni ae=br', p95(50, '50.0', '+0.0'), p95(100, '50.0', '+0.0'),
    p95(200, '50.0', '+0.0'), bayt, CPU_YOK_SERBEST]);
  // p95 esik ustu kotulesme -> RET (bugunku zarar satiri).
  const r = kararVer(ref, kotu, S);
  assert.equal(r.karar, 'RET');
  assert.deepEqual(r.nedenler.slice(1), [p95(50, '50.0', '+0.0'), p95(100, '50.0', '+0.0'), p95(200, '60.0', '+20.0'), bayt, 'zarar: p95 @200 %+20.0']);
  // Buyuk p95 kazanci (%30, CPU'lu yolda p95 kurali KALICI derdi): yine NOTR.
  const k = kararVer(ref, iyi, S);
  assert.equal(k.karar, 'NOTR');
  assert.deepEqual(k.nedenler.slice(1), [p95(50, '35.0', '-30.0'), p95(100, '35.0', '-30.0'), p95(200, '35.0', '-30.0'), bayt, CPU_YOK_SERBEST]);
  // Hata (istemci 5xx) -> RET (bugunku hata kurali CPU'dan once).
  const h = kararVer(ref, hatali, S);
  assert.equal(h.karar, 'RET');
  assert.equal(h.nedenler[1], 'hata artti: R78_K_yeni_br_100_r1 429=0 5xx=2 hata=%0.00 (referans %0.00)');
  for (const x of [n, r, k, h]) assert.ok(!cpuSatiri(x.nedenler), x.nedenler.join('\n'));
  // Tek taraf serbest yeter: CPU'lu R10 -> R11 (bugun KALICI) CPU'suz yoldan NOTR olur; CPU satiri yok.
  for (const sec of [{ adayHedefTuru: 'serbest' }, { refHedefTuru: 'serbest' }]) {
    const x = kararVer(m.get('R10').analiz.adimlar, m.get('R11').analiz.adimlar, sec);
    assert.equal(x.karar, 'NOTR', JSON.stringify(sec));
    assert.equal(x.nedenler[x.nedenler.length - 1], CPU_YOK_SERBEST);
    assert.ok(!cpuSatiri(x.nedenler));
  }
  // wrk + wrk sunucu: kademede adayin CPU'su kaydedici eksik oldugu icin yok (doyma DEGIL) -> CPU'suz yol.
  const wRef = await wrkAdimlari(wrkKurgu('R79'));
  const wYok = await wrkAdimlari(wrkKurgu('R80'), { dosya: { sunucuYok: true, bilgiYok: true } });
  assert.ok(wYok.every((x) => x.cpu_ms_istek === null && x.gecerlilik === 'GECERLI'), 'fikstur: aday CPU olcusuz, gecerli');
  const wn = kararVer(wRef, wYok, WRK);
  assert.equal(wn.karar, 'NOTR');
  const wp95 = (x, a, d) => `p95 @${x}: ref=50.0 aday=${a} degisim=%${d} (zarar esigi %5.0)`;
  assert.deepEqual(wn.nedenler, ['referans=R79 aday=R80 senaryo=K kip=ka ae=br', wp95(2, '50.0', '+0.0'), wp95(4, '50.0', '+0.0'),
    wp95(8, '50.0', '+0.0'), 'bayt/istek @4 [govde, sunucu logu]: ref=1000 aday=1000 degisim=%+0.0', CPU_YOK_WRK]);
  // Ayni veri k6 + k6: bugunku gibi VERI_YOK (D4'ten bilincli sapma, sozlesme K25).
  const k6 = kararVer(wRef, wYok);
  assert.equal(k6.karar, 'VERI_YOK');
  assert.equal(k6.nedenler[k6.nedenler.length - 1], '4 istek/sn kademesinde CPU-ms/istek yok (sunucu kaydi?)');
  // wrk CPU'suz yolda p95 zarari -> RET.
  const wKotu = await wrkAdimlari(wrkKurgu('R81', (x) => (x === 8 ? { p95: 60 } : {})), { dosya: { sunucuYok: true, bilgiYok: true } });
  const wr = kararVer(wRef, wKotu, WRK);
  assert.equal(wr.karar, 'RET');
  assert.equal(wr.nedenler[wr.nedenler.length - 1], 'zarar: p95 @8 %+20.0');
  assert.ok(!wr.nedenler.includes(CPU_YOK_WRK));
  // Doyma yuzunden CPU yoksa bugunku gibi DOYMA ("daha dusuk kademe" yonlendirmesi), birim baglanti.
  const wDoyma = await wrkAdimlari(wrkKurgu('R82', (x) => (x === 4 ? { host: 760 } : {})));
  const wd = kararVer(wRef, wDoyma, WRK);
  assert.equal(wd.karar, 'DOYMA');
  assert.equal(wd.nedenler[1], '4 baglanti kademesinde CPU-ms/istek yok: aday R82 doydu (dropped>0 ya da host CPU>%90); daha dusuk bir kademeyle tekrar kosun');
  // wrk + wrk iki tarafta CPU varsa bugunku tam akis (KALICI dahil).
  const wIyi = await wrkAdimlari(wrkKurgu('R85', () => ({ ru: 21 })));
  const wk = kararVer(wRef, wIyi, WRK);
  assert.equal(wk.karar, 'KALICI');
  assert.ok(wk.nedenler.some((x) => x.startsWith('CPU-ms/istek @4: ')));
  // k6 + k6 sunucu + sunucu, CPU yok: bugunku VERI_YOK metni (acik varsayilanlarla da).
  for (const sec of [{}, { refMotor: 'k6', adayMotor: 'k6', refHedefTuru: 'sunucu', adayHedefTuru: 'sunucu' }]) {
    const v = kararVer(m.get('R10').analiz.adimlar, m.get('R39').analiz.adimlar, sec);
    assert.equal(v.karar, 'VERI_YOK');
    assert.equal(v.nedenler[v.nedenler.length - 1], '250 istek/sn kademesinde CPU-ms/istek yok (sunucu kaydi?)');
  }
});

test('AN18 wrk metin birimleri ("baglanti kademesinde") ve istemci bayt etiketi (baslik + govde, TLS haric); k6 metinleri aynen', async () => {
  // Referansin 4 baglanti kademesinde tek gecerli tekrar (r1: log / istemci farki %5 -> GECERSIZ).
  const kotuRef = await wrkAdimlari(wrkKurgu('R83', (n, r) => (n === 4 && r === 1 ? { fark: 1.05 } : {})));
  const iyi = await wrkAdimlari(wrkKurgu('R86'));
  const gr = kararVer(kotuRef, iyi, WRK);
  assert.equal(gr.karar, 'GECERSIZ');
  assert.equal(gr.nedenler[1], 'referans R83 kullanilamaz: 4 baglanti kademesinde yeterli gecerli kosu yok (en az 2): R83_K_ka_br_4_r1(log_istemci_farki_%4.8)');
  assert.equal(kararVer(kotuRef, iyi).nedenler[1], 'referans R83 kullanilamaz: 4 istek/sn kademesinde yeterli gecerli kosu yok (en az 2): R83_K_ka_br_4_r1(log_istemci_farki_%4.8)');
  const ga = kararVer(iyi, kotuRef, WRK);
  assert.equal(ga.karar, 'GECERSIZ');
  assert.deepEqual(ga.nedenler.slice(1), ['tekrar kosun: R83_K_ka_br_4_r1(log_istemci_farki_%4.8)',
    '4 baglanti kademesinde yeterli gecerli kosu yok (en az 2). Adayi tekrar=3 ile yeniden kosun (GECERSIZ kosu kararda dislanir)']);
  assert.equal(kararVer(iyi, kotuRef).nedenler[2],
    '4 istek/sn kademesinde yeterli gecerli kosu yok (en az 2). Adayi tekrar=3 ile yeniden kosun (GECERSIZ kosu kararda dislanir)');
  // Ortak kademe yok: CPU'lu ve CPU'suz (serbest) yolda ayni birimli metin.
  const k16 = new Kurgu('R87');
  for (const r of [1, 2]) wrkKosu(k16, { kip: 'ka', hiz: 16, r });
  const az = await wrkAdimlari(k16);
  for (const sec of [WRK, { ...WRK, adayHedefTuru: 'serbest' }]) {
    const x = kararVer(iyi, az, sec);
    assert.deepEqual([x.karar, x.nedenler[1]], ['VERI_YOK', 'ortak baglanti kademesi yok'], JSON.stringify(sec));
  }
  assert.equal(kararVer(iyi, az).nedenler[1], 'ortak istek/sn kademesi yok');
  // Bayt satiri istemci yedegi (sunucu logu yok): wrk etiketi; k6 etiketi aynen; baska satir farki yok.
  const lr = await wrkAdimlari(wrkKurgu('R88'), { dosya: { logYok: true } });
  const la = await wrkAdimlari(wrkKurgu('R89', () => ({ ru: 21 })), { dosya: { logYok: true } });
  const ETIKET_WRK = 'bayt/istek @4 [istemci (wrk): baslik + govde, TLS haric]: ref=10000 aday=10000 degisim=%+0.0';
  const ETIKET_K6 = 'bayt/istek @4 [istemci data_received: TLS + baslik dahil, fark kucuk gorunur]: ref=10000 aday=10000 degisim=%+0.0';
  const w = kararVer(lr, la, WRK);
  const k6 = kararVer(lr, la);
  assert.ok(w.nedenler.includes(ETIKET_WRK) && !w.nedenler.includes(ETIKET_K6), w.nedenler.join('\n'));
  assert.ok(k6.nedenler.includes(ETIKET_K6));
  assert.deepEqual(w.nedenler.map((x) => (x === ETIKET_WRK ? ETIKET_K6 : x)), k6.nedenler);
  assert.equal(w.karar, k6.karar);
  // CPU'suz (serbest) yolda da wrk etiketi.
  assert.ok(kararVer(lr, la, { ...WRK, refHedefTuru: 'serbest' }).nedenler.includes(ETIKET_WRK));
});

// Tur 3 oncesi (946ec3b) analiz.cjs'in fikstur katalogundaki TAM ciktisinin (her ADIM'in kosuAnaliz'i + her
// KARAR'in kararVer'i, JSON) sha256'si. Varsayilan secenekler bu ciktiyi BAYT BAYT korur (sozlesme tur 3,
// 10.1 / 10.2). Analiz bilincli olarak degisirse yeniden hesaplanir: ciktiOzeti(await hazirla()).
const ALTIN_OZET = 'd07d5a3e84093cddbc98a09daa8550c3c6ebbdb2b9ab16c791a74000d26ea4f9';
function ciktiOzeti(m) {
  const h = crypto.createHash('sha256');
  for (const a of ADIMLAR) h.update(`${a.ad}\n${JSON.stringify(m.get(a.ad).analiz)}\n`);
  for (const k of KARARLAR) {
    h.update(`${k.ref}>${k.aday}\n${JSON.stringify(kararVer(m.get(k.ref).analiz.adimlar, m.get(k.aday).analiz.adimlar, k.node || {}))}\n`);
  }
  return h.digest('hex');
}

test('AN19 secenek dogrulamasi (TypeError); varsayilanlarla cikti tur 3 oncesiyle BAYT BAYT ayni (altin ozet, acik varsayilanlar)', async () => {
  const m = await hazirla();
  const veri = m.get('R10').veri;
  for (const s of [{ hedefTuru: 'Sunucu' }, { hedefTuru: 'x' }, { hedefTuru: null }, { hedefTuru: 1 }, { motor: 'K6' }, { motor: 'wrk2' },
    { motor: null }, { motor: ['k6'] }]) {
    assert.throws(() => kosuAnaliz(veri, { adim: 'R10', ...s }), TypeError, JSON.stringify(s));
  }
  const r10 = m.get('R10').analiz.adimlar;
  const r11 = m.get('R11').analiz.adimlar;
  for (const s of [{ refMotor: 'x' }, { adayMotor: null }, { refHedefTuru: 'Serbest' }, { adayHedefTuru: 0 }, { refIsParcacigi: 0 },
    { adayIsParcacigi: -2 }, { refIsParcacigi: 1.5 }, { refIsParcacigi: 'abc' }, { adayIsParcacigi: {} },
    { refTavanRps: 0 }, { adayTavanRps: -90 }, { refTavanRps: 4.5 }, { adayTavanRps: 'abc' }]) {
    assert.throws(() => kararVer(r10, r11, s), TypeError, JSON.stringify(s));
  }
  // Altin ozet: bugunku (varsayilan) cikti tur 3 oncesiyle ayni.
  assert.equal(ciktiOzeti(m), ALTIN_OZET);
  // Varsayilanlar ACIKCA verildiginde de cikti ayni (her fikstur, her karar).
  for (const a of ADIMLAR) {
    const x = m.get(a.ad);
    assert.equal(JSON.stringify(kosuAnaliz(x.veri, { adim: a.ad, hedefTuru: 'sunucu', motor: 'k6' })), JSON.stringify(x.analiz), a.ad);
  }
  const VARS = { refMotor: 'k6', adayMotor: 'k6', refHedefTuru: 'sunucu', adayHedefTuru: 'sunucu', refIsParcacigi: null, adayIsParcacigi: null, refTavanRps: null, adayTavanRps: null };
  for (const k of KARARLAR) {
    const ra = m.get(k.ref).analiz.adimlar;
    const aa = m.get(k.aday).analiz.adimlar;
    assert.equal(JSON.stringify(kararVer(ra, aa, { ...(k.node || {}), ...VARS })), JSON.stringify(kararVer(ra, aa, k.node || {})), `${k.ref}->${k.aday}`);
  }
});

test('AN20 wrk: ayristirma ve cpu_tlsli_pay HER ZAMAN null; yeni kipinde wrk_tls_payi_hesaplanmaz uyarisi, ka ve k6da yok', async () => {
  // R10'un wrk esi: ayni kademede K/yeni/br x2, K/ka/br, K/yeni/identity x2 (k6 olarak okunsa TLS payi cikardi).
  const k = new Kurgu('R84');
  for (const r of [1, 2]) wrkKosu(k, { hiz: 4, r });
  wrkKosu(k, { kip: 'ka', hiz: 4, r: 1, ru: 16, rs: 4 });
  for (const r of [1, 2]) wrkKosu(k, { ae: 'identity', hiz: 4, r, ru: 20, rs: 5 });
  const { veri, analiz: w } = await t3Analiz(k, { donustur: (d) => wrkDosyalari(k, d), secenek: { motor: 'wrk' } });
  const k6 = kosuAnaliz(veri, { adim: 'R84' });
  assert.deepEqual(k6.ozet.ayristirma, { hiz: 4, toplam: 10, tls: 5, sik: 2.5, kalan: 2.5, user: 8, sys: 2 }, 'fikstur: k6 olarak TLS payi hesaplanir');
  yakin(k6.ozet.cpu_tlsli_pay, 0.5, 'k6 TLS payi');
  assert.deepEqual([w.ozet.ayristirma, w.ozet.cpu_tlsli_pay], [null, null]);
  assert.deepEqual(Object.keys(w.ozet), Object.keys(k6.ozet), 'ozet semasi degismez');
  // Uyari: bir kez, kosu duzeyinde, katlanan TUR uyarilarindan ONCE; adim satirlari ve diger uyarilar k6 analiziyle ayni.
  assert.equal(w.uyarilar.filter((u) => u === WRK_TLS).length, 1);
  const ilkKatli = w.uyarilar.findIndex((u) => KATLI.test(u));
  assert.ok(ilkKatli === -1 || w.uyarilar.indexOf(WRK_TLS) < ilkKatli, w.uyarilar.join(' | '));
  assert.deepEqual(w.uyarilar.filter((u) => u !== WRK_TLS), k6.uyarilar);
  assert.deepEqual(w.adimlar, k6.adimlar);
  assert.ok(!k6.uyarilar.includes(WRK_TLS), "k6'da TLS payi uyarisi hic yok");
  // Serbest + wrk + yeni: uyari var, ayristirma null.
  const s = kosuAnaliz(veri, { adim: 'R84', hedefTuru: 'serbest', motor: 'wrk' });
  assert.ok(s.uyarilar.includes(WRK_TLS));
  assert.equal(s.ozet.ayristirma, null);
  // Yalniz ka kipi: uyari yok; HATALI bir 'yeni' adim da adimdir (uyari var).
  const kaK = wrkKurgu('R90');
  const ka = (await t3Analiz(kaK, { donustur: (d) => wrkDosyalari(kaK, d), secenek: { motor: 'wrk' } })).analiz;
  assert.ok(ka.adimlar.length === 6 && ka.adimlar.every((x) => x.kip === 'ka'));
  assert.ok(!ka.uyarilar.includes(WRK_TLS));
  const kh = wrkKurgu('R92');
  wrkKosu(kh, { hiz: 16, r: 1, hatali: true });
  const hh = await t3Analiz(kh, { donustur: (d) => wrkDosyalari(kh, d), secenek: { motor: 'wrk' } });
  assert.equal(turla(hh.analiz).get('R92_K_yeni_br_16_r1').gecerlilik, 'HATALI');
  assert.ok(hh.analiz.uyarilar.includes(WRK_TLS));
});
