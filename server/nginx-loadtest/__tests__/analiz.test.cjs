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
// Sade turu (2026-11-02; PORTAL FARKLARI 10 / 11):
//   AN21 CPU-ms/istek ve kapasite asla negatif (reload sayac dususu, sayac gerilemesi, net negatif; DB'deki eski deger)
//   AN22 reload anlari: zaman, faz, etkilenen TUR'lar (ozet.reloadlar, ham.reloadlar)
//   AN23 her neden / uyari NEDEN_KALIPLARI'ndan birine uyar
// HTTP/2 secimi ve reload penceresi (2026-11-02, h2_sozlesme.md; PORTAL FARKLARI 11 / 12):
//   AN-H1..H5 protokol kolonlari, h2_disi / protokol_farkli, kararVer farkli protokol, kosuAnaliz secenegi
//   AN-R1 reload fazi CPU penceresiyle kesin (olcum_kenari); AN-R2 reload nedeni <=> olcum olayi degismezi
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
const { kosuAnaliz, kararVer, ayristirma, NEDENLER, NEDEN_KALIPLARI, CPU_YOK_NGINXSIZ, _pyForTest: py, _adimUyarilariniKatForTest: uyariKat } = require('../analiz.cjs');
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
  let reloadSayisi = 0;
  for (const a of ADIMLAR) {
    const py = BEKLENEN.adimlar[a.ad];
    const an = m.get(a.ad).analiz;
    const satirlar = an.adimlar.filter((x) => x.gecerlilik !== 'HATALI');
    assert.equal(satirlar.length, py.kosular.length, `${a.ad}: TUR sayisi`);
    const logVar = m.get(a.ad).veri.loglar.length > 0;
    py.kosular.forEach((r, i) => {
      const n = satirlar[i];
      const yer = `${a.ad}/${r.tur}`;
      // PORTAL FARKLARI 10 (ACIK esleme): pencerede reload olan TUR'da CPU alanlari null + tek uyari;
      // karsilastir.py sayac sifirlanmasini fark etmeden sayi yazar. Baska hicbir alan farkli degil.
      const reloadlu = String(r.gecersiz_nedeni || '').split(';').includes('reload(worker_pid_degisti)');
      const PORTAL_NULL = new Set(['cpu_ms_istek', 'user_ms', 'sys_ms', 'cpu_oran_ms_sn']);
      const bek = (pk) => (reloadlu && PORTAL_NULL.has(pk) ? null : r[pk]);
      for (const [pk, nk] of Object.entries(UST)) yakin(n[nk], bek(pk), `${yer}.${nk}`);
      for (const [pk, nk] of Object.entries(HAM)) yakin(n.ham[nk], bek(pk), `${yer}.ham.${nk}`);
      assert.equal(n.gecerlilik, r.durum, `${yer}.gecerlilik`);
      const cpuUyari = n.ham.uyarilar.filter((u) => u.startsWith('cpu_olculemedi('));
      assert.deepEqual(cpuUyari, reloadlu ? ['cpu_olculemedi(reload)'] : [], `${yer}: cpu_olculemedi uyarisi`);
      assert.equal(n.ham.cpu_olculemedi, reloadlu ? 'reload' : null, `${yer}.ham.cpu_olculemedi`);
      if (reloadlu) {
        assert.equal(n.kapasite_rps, null, `${yer}: reload'lu adimda kapasite yok`);
        reloadSayisi++;
      }
      assert.equal(n.ham.uyarilar.filter((u) => !u.startsWith('cpu_olculemedi(')).join(';'), r.uyari, `${yer}.uyarilar`);
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
  assert.ok(reloadSayisi >= 3, `reload'lu TUR kapsami az: ${reloadSayisi}`);
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
    "kos.sh / wrk_kos.sh bu TUR'u durdurdu (429 / 5xx / soket / hata orani / http2 / protokol / hata kodu / olcum yok).");
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
// Sade turu (2026-11-02): reload'lu TUR'da CPU null + cpu_olculemedi uyarisi, ham.cpu_olculemedi / ham.reloadlar,
// ozet.reloadlar eklendi (PORTAL FARKLARI 10 / 11); farklar AN2 ve AN21-AN23'te acik eslemeyle sinanir.
// Onceki ozet (tur 3 oncesi): d07d5a3e84093cddbc98a09daa8550c3c6ebbdb2b9ab16c791a74000d26ea4f9.
const ALTIN_OZET = '6f70a1ef7902800e1bda1d2b5d0581d669e7239b96dc91b229ac56a377ca1c11';
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

// ---------------------------------------------------------------------------------------------
// Sade turu (2026-11-02; analiz.cjs PORTAL FARKLARI 10 / 11, sade_sozlesme.md)
//   AN21 CPU-ms/istek ve kapasite ASLA negatif: reload'da sayac dususu (R2), PID'siz sayac gerilemesi,
//        arka plan > pencere (net negatif) -> null + cpu_olculemedi(kod); DB'deki negatif deger kararda null
//   AN22 reload anlari: olay zamani, fazi (isinma / olcum / bosluk / kosu_oncesi), etkilenen TUR'lar
//   AN23 uretilen her neden / uyari NEDEN_KALIPLARI'ndan birine uyar (arayuz esleme listesi tam)
// ---------------------------------------------------------------------------------------------

/** sunucu_*.csv'de t >= esik orneklerinin worker utime'ini `dusus` kadar azaltir (eski worker'lar cikti). */
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

function negatifYok(an, yer) {
  for (const a of an.adimlar) {
    for (const k of ['cpu_ms_istek', 'kapasite_rps']) assert.ok(a[k] === null || a[k] > 0, `${yer}/${a.tur}.${k} = ${a[k]}`);
    if (a.ham.cpu_olculemedi === 'reload' || a.ham.cpu_olculemedi === 'sayac_geriledi') {
      for (const k of ['user_ms', 'sys_ms', 'cpu_oran_ms_sn']) assert.equal(a.ham[k], null, `${yer}/${a.tur}.ham.${k}`);
    }
  }
  for (const g of an.ozet.gruplar) {
    for (const k of ['cpu_ms_istek', 'kapasite_tahmini_rps']) assert.ok(g[k] === null || g[k] > 0, `${yer}/grup ${g.hiz}.${k} = ${g[k]}`);
  }
}

const T0 = 1800000000;
// standart(): bosta 60, her kosu 92 sn (bas, isinma 10, olcum 60, zaman bit = bas + 72, bosluk 20).
const kosuBas = (sira) => T0 + 60 + sira * 92;

test('AN21 CPU-ms/istek ve kapasite asla negatif; sayac sifirlanmasi / gerilemesi / net negatif null + neden', async () => {
  // (a) R2 kalibi: 250_r1 olcumunde reload, 5 sn sonra eski worker'lar cikar -> sayac 5000 tik duser.
  const kA = standart('R93', { ru: 22, reload: true });
  const a = (await t3Analiz(kA, { donustur: (d) => sayacDusur(d, kosuBas(2) + 45, 5000) })).analiz;
  const aR = turla(a).get('R93_K_yeni_br_250_r1');
  assert.equal(aR.gecerlilik, 'GECERSIZ');
  assert.ok(aR.nedenler.includes('reload(worker_pid_degisti)'), aR.nedenler.join(';'));
  assert.deepEqual([aR.cpu_ms_istek, aR.kapasite_rps, aR.ham.user_ms, aR.ham.sys_ms, aR.ham.cpu_oran_ms_sn], [null, null, null, null, null]);
  assert.equal(aR.ham.cpu_olculemedi, 'reload');
  assert.ok(aR.ham.uyarilar.includes('cpu_olculemedi(reload)'));
  assert.ok(aR.host_cpu_ort !== null, 'host CPU (/proc/stat) reload ile bozulmaz, kalir');
  assert.ok(a.uyarilar.includes('R93_K_yeni_br_250_r1: cpu_olculemedi(reload)'), 'kosu duzeyine de katlanir');
  negatifYok(a, 'R93');
  for (const x of a.adimlar.filter((y) => y.tur !== aR.tur)) assert.equal(x.ham.cpu_olculemedi, null, `${x.tur}: digerleri olculur`);

  // (b) PID kumesi ayni ama sayac geriye gitti (kaydedici anomalisi): reload nedeni YOK, CPU null.
  const kB = standart('R94', { ru: 22 });
  const b = (await t3Analiz(kB, { donustur: (d) => sayacDusur(d, kosuBas(2) + 40, 5000) })).analiz;
  const bR = turla(b).get('R94_K_yeni_br_250_r1');
  assert.ok(!bR.nedenler.some((n) => n.startsWith('reload')), bR.nedenler.join(';'));
  assert.equal(bR.gecerlilik, 'GECERLI', 'gecikme olcumu gecerli kalir');
  assert.deepEqual([bR.cpu_ms_istek, bR.kapasite_rps, bR.ham.cpu_oran_ms_sn], [null, null, null]);
  assert.equal(bR.ham.cpu_olculemedi, 'sayac_geriledi');
  assert.ok(bR.ham.uyarilar.includes('cpu_olculemedi(sayac_geriledi)'));
  negatifYok(b, 'R94');

  // (c) Arka plan (40+10 tik/sn) kosudan (22+6) buyuk: net negatif -> null; ham oran olculur, kalir.
  const kC = standart('R95', { ru: 22, kurgu: { bg: [40, 10] } });
  const c = (await t3Analiz(kC)).analiz;
  assert.ok(c.adimlar.length === 6 && c.adimlar.every((x) => x.ham.cpu_olculemedi === 'net_negatif' && x.cpu_ms_istek === null),
    c.adimlar.map((x) => x.ham.cpu_olculemedi).join(','));
  assert.ok(c.adimlar.every((x) => x.ham.cpu_oran_ms_sn > 0 && x.gecerlilik === 'GECERLI'));
  negatifYok(c, 'R95');
  assert.ok(c.ozet.gruplar.every((g) => g.cpu_ms_istek === null && g.kapasite_tahmini_rps === null));
  assert.equal(kararVer(c.adimlar, c.adimlar).karar, 'VERI_YOK', 'olculemeyen CPU ile karar verilmez');

  // (d) Eski DB satiri (R2): negatif cpu_ms_istek kararda null sayilir (KALICI'ya donusmez).
  const ref = (await hazirla()).get('R10').analiz.adimlar;
  const eski = ref.map((x) => ({ ...x, cpu_ms_istek: x.cpu_ms_istek === null ? null : -1.372 }));
  const k = kararVer(ref, eski);
  assert.equal(k.karar, 'VERI_YOK', k.nedenler.join('\n'));
  assert.ok(!k.nedenler.some((s) => /-1\.372/.test(s)), 'negatif deger karar metnine girmez');
});

test('AN22 reload anlari: zaman, faz, etkilenen TUR (gosterim; gecerlilik degismez)', async () => {
  const a = (await t3Analiz(standart('R96', { ru: 22, reload: true }))).analiz;
  assert.deepEqual(a.ozet.reloadlar, [{
    kesit: 'R96_test', t: kosuBas(2) + 40, t_once: kosuBas(2) + 39, t_son: kosuBas(2) + 40, worker_once: 2, worker_sonra: 2,
    kapanan_en_cok: 0, tur: 'R96_K_yeni_br_250_r1', faz: 'olcum', etkilenen_turlar: ['R96_K_yeni_br_250_r1'],
  }]);
  for (const x of a.adimlar) {
    const bek = x.tur === 'R96_K_yeni_br_250_r1'
      ? [{ t: kosuBas(2) + 40, t_once: kosuBas(2) + 39, t_son: kosuBas(2) + 40, tur: 'R96_K_yeni_br_250_r1', faz: 'olcum' }] : [];
    assert.deepEqual(x.ham.reloadlar, bek, x.tur);
  }
  // R58: kosular ARASINDA kapanan worker (100_r1 bas+83..85) ve reload (250_r1 bas+85): faz bosluk, etkilenen yok.
  const r58 = (await hazirla()).get('R58').analiz;
  assert.deepEqual(r58.ozet.reloadlar.map((o) => [o.t - T0, o.t_son - T0, o.kapanan_en_cok, o.tur, o.faz, o.etkilenen_turlar]), [
    [60 + 83, 60 + 85, 1, 'R58_K_yeni_br_100_r1', 'bosluk', []],
    [60 + 2 * 92 + 85, 60 + 2 * 92 + 85, 0, 'R58_K_yeni_br_250_r1', 'bosluk', []],
  ]);
  assert.ok(r58.adimlar.every((x) => x.ham.reloadlar.length === 0));
  // Isinmada reload; kosu oncesinde reload; kayit 'shutting down' worker'la basliyor (t_once null).
  const isinma = new Kurgu('R97');
  isinma.kosu({ hiz: 100, reload: true, reloadOfs: 5 });
  isinma.kosu({ hiz: 100, r: 2 });
  const i = (await t3Analiz(isinma)).analiz;
  assert.deepEqual(i.ozet.reloadlar.map((o) => [o.tur, o.faz, o.etkilenen_turlar]), [['R97_K_yeni_br_100_r1', 'isinma', ['R97_K_yeni_br_100_r1']]]);
  assert.ok(!turla(i).get('R97_K_yeni_br_100_r1').nedenler.some((n) => n.startsWith('reload')), 'isinmadaki reload olcum penceresinde degil');
  const once = new Kurgu('R98');
  once.kosu({ hiz: 100, reload: true, reloadOfs: -30, kapanan: [-60, -55] });
  const o = (await t3Analiz(once)).analiz;
  assert.deepEqual(o.ozet.reloadlar.map((x) => [x.t - T0, x.t_once, x.t_son - T0, x.kapanan_en_cok, x.tur, x.faz]), [
    [0, null, 4, 1, null, 'kosu_oncesi'],
    [30, T0 + 29, 30, 0, null, 'kosu_oncesi'],
  ]);
  // Serbest hedefte kaydedici yok sayilir: reload listesi bos.
  const s = (await t3Analiz(standart('R99', { ru: 22, reload: true }), { secenek: { hedefTuru: 'serbest' } })).analiz;
  assert.deepEqual(s.ozet.reloadlar, []);
  assert.ok(s.adimlar.every((x) => x.ham.reloadlar.length === 0 && x.ham.cpu_olculemedi === null));
});

test('AN23 her neden / uyari NEDEN_KALIPLARI listesinden birine uyar (arayuz eslemesi tam)', async () => {
  const kodlar = NEDEN_KALIPLARI.map((k) => k.kod);
  assert.equal(new Set(kodlar).size, kodlar.length, 'kodlar tekil');
  const bul = (s, tur) => NEDEN_KALIPLARI.find((k) => k.tur === tur && k.re.test(s));
  const analizler = [...(await hazirla()).values()].map((x) => x.analiz);
  const kA = standart('R93', { ru: 22, reload: true });
  analizler.push((await t3Analiz(kA, { donustur: (d) => sayacDusur(d, kosuBas(2) + 45, 5000) })).analiz);
  analizler.push((await t3Analiz(standart('R94', { ru: 22 }), { donustur: (d) => sayacDusur(d, kosuBas(2) + 40, 5000) })).analiz);
  analizler.push((await t3Analiz(standart('R95', { ru: 22, kurgu: { bg: [40, 10] } }))).analiz);
  const wk = wrkKurgu('R91');
  wrkKosu(wk, { hiz: 16, r: 1, hatali: true });
  analizler.push((await t3Analiz(wk, { donustur: (d) => wrkDosyalari(wk, d), secenek: { motor: 'wrk' } })).analiz);
  // HTTP/2 (PORTAL FARKLARI 12): h2_disi(n) ve protokol_farkli(...) kodlari.
  analizler.push((await t3Analiz(kaKurgu('R77'), {
    donustur: (d) => protokolKolonu(d, (tur) => ({ protokol: 'h2', protokol_uyumsuz: tur.endsWith('_250_r1') ? 2 : 0 })), secenek: { protokol: 'h2' },
  })).analiz);
  analizler.push((await t3Analiz(kaKurgu('R78'), { secenek: { protokol: 'h2' } })).analiz);
  analizler.push((await t3Analiz(kaKurgu('R79'), { donustur: (d) => protokolKolonu(d, () => ({ protokol: 'h2' })) })).analiz);
  const gorulen = new Set();
  let n = 0;
  for (const an of analizler) {
    for (const a of an.adimlar) {
      for (const x of a.nedenler) {
        const k = bul(x, 'neden');
        assert.ok(k, `eslenmeyen neden: ${x}`);
        gorulen.add(k.kod);
        n++;
      }
      for (const x of a.ham.uyarilar) {
        const k = bul(x, 'uyari');
        assert.ok(k, `eslenmeyen uyari: ${x}`);
        gorulen.add(k.kod);
      }
    }
    for (const x of an.nedenler) {
      if (x === 'istemci_sonucu_yok') continue;
      const m = /^[A-Za-z0-9_-]+\((.*)\)$/.exec(x);
      assert.ok(m, `kosu nedeni bicimi: ${x}`);
      for (const ic of m[1].split(';')) assert.ok(bul(ic, 'neden'), `kosu nedeninde eslenmeyen: ${ic}`);
    }
  }
  assert.ok(n > 50, `kapsam az: ${n}`);
  for (const k of ['reload', 'konf_degisti', '429', '5xx', 'hata', 'doyma_dropped', 'doyma_host_cpu', 'hatali_kosu', 'tamamlanmadi',
    'cpu_olculemedi', 'disk', 'kayit', 'h2_disi', 'protokol_farkli']) {
    assert.ok(gorulen.has(k), `fikstur kapsami: ${k} hic uretilmedi`);
  }
});

// ---------------------------------------------------------------------------------------------
// HTTP/2 secimi ve reload penceresi (h2_sozlesme.md 4.4 / 6; analiz.cjs PORTAL FARKLARI 11 / 12)
//   AN-H1 h2 satiri (http2 = n, protokol h2, uyumsuz 0) GECERLI; http2 kolonu bilgi
//   AN-H2 h2 protokol_uyumsuz > 0 -> h2_disi(n); h1 yeni satir protokol_uyumsuz > 0 -> http2
//   AN-H3 protokol_farkli: beklenen h2 kolon yok / beklenen h1 satir h2; beklenen h1 kolon yok -> bugunku kural
//   AN-H4 kararVer farkli protokol VERI_YOK (motor kuralindan sonra); gecersiz deger TypeError
//   AN-H5 kosuAnaliz: h2 kosu uyarisi; wrk + h2 / gecersiz protokol TypeError; h1 + eski satir ham'da protokol YOK
//   AN-R1 reload fazi CPU penceresiyle kesin: [bas+isinma, w0) / (w1, bit] olcum_kenari (adim GECERLI), pencere ici olcum
//   AN-R2 degismez: reload nedeni <=> o TUR'a yazilmis 'olcum' olayi (tum fiksturler)
// ---------------------------------------------------------------------------------------------

/** istemci_ / hatali_istemci_ CSV'lerine yuk_k6.js 32 kolon semasinin son iki kolonunu ekler; `f(tur)` -> { protokol, protokol_uyumsuz, http2 }. */
function protokolKolonu(dosyalar, f) {
  const out = new Map(dosyalar);
  for (const [ad, x] of dosyalar) {
    if (!/^(hatali_)?istemci_.*\.csv$/.test(ad)) continue;
    const [bas, veri, ...kalan] = x.icerik.split('\n');
    const kol = bas.split(',');
    const deger = veri.split(',');
    const e = f(deger[kol.indexOf('tur')]) || {};
    if (e.http2 !== undefined) deger[kol.indexOf('http2')] = String(e.http2);
    const satirlar = e.protokol === undefined ? [bas, deger.join(',')]
      : [`${bas},protokol,protokol_uyumsuz`, `${deger.join(',')},${e.protokol},${e.protokol_uyumsuz ?? 0}`];
    out.set(ad, { ...x, icerik: [...satirlar, ...kalan].join('\n') });
  }
  return out;
}
const H2_KOSU = 'h2_vu_basina_tek_akis(tarayici_coklamasi_olculmez)';
const kaKurgu = (ad) => standart(ad, { kosuEk: () => ({ kip: 'ka' }) });
const KA = (h, r) => `_K_ka_br_${h}_r${r}`;

test('AN-H1 h2 satiri: http2 = yanit sayisi (bilgi), protokol h2, uyumsuz 0 -> GECERLI; ham protokol alanlari', async () => {
  const k = kaKurgu('R70');
  const { analiz: a } = await t3Analiz(k, { donustur: (d) => protokolKolonu(d, () => ({ protokol: 'h2', protokol_uyumsuz: 0, http2: 1300 })), secenek: { protokol: 'h2' } });
  assert.equal(a.adimlar.length, 6);
  for (const x of a.adimlar) {
    assert.equal(x.gecerlilik, 'GECERLI', `${x.tur}: ${x.nedenler.join(';')}`);
    assert.deepEqual([x.ham.http2, x.ham.protokol, x.ham.protokol_uyumsuz], [1300, 'h2', 0]);
  }
  // Ayni dizin h1 olarak (yeni satir, uyumsuz 0) okunursa protokol_farkli; eski kural (http2 > 0) h2'de UYGULANMAZ.
  const { analiz: b } = await t3Analiz(k, { donustur: (d) => protokolKolonu(d, () => ({ protokol: 'h2', protokol_uyumsuz: 0, http2: 1300 })) });
  assert.ok(b.adimlar.every((x) => x.nedenler.includes('protokol_farkli(beklenen=h1,olculen=h2)') && !x.nedenler.includes('http2')));
});

test('AN-H2 protokol_uyumsuz > 0: h2 -> h2_disi(n); h1 yeni satir -> http2 (eski neden kodu)', async () => {
  const k = kaKurgu('R71');
  const ozel = `R71${KA(250, 1)}`;
  const { analiz: a } = await t3Analiz(k, {
    donustur: (d) => protokolKolonu(d, (tur) => ({ protokol: 'h2', protokol_uyumsuz: tur === ozel ? 3 : 0, http2: 1197 })), secenek: { protokol: 'h2' },
  });
  const t = turla(a);
  assert.deepEqual([t.get(ozel).gecerlilik, t.get(ozel).nedenler], ['GECERSIZ', ['h2_disi(3)']]);
  assert.equal(t.get(ozel).ham.protokol_uyumsuz, 3);
  assert.ok([...t.values()].filter((x) => x.tur !== ozel).every((x) => x.gecerlilik === 'GECERLI'));
  aciklamali(a);
  // h1 kosusu, yeni (32 kolon) satir: http2 kolonu 0 olsa da karar protokol_uyumsuz'dan -> 'http2'.
  const h1 = standart('R72');
  const o1 = 'R72_K_yeni_br_250_r1';
  const { analiz: b } = await t3Analiz(h1, { donustur: (d) => protokolKolonu(d, (tur) => ({ protokol: 'h1', protokol_uyumsuz: tur === o1 ? 2 : 0, http2: 0 })) });
  assert.deepEqual(turla(b).get(o1).nedenler, ['http2']);
  assert.ok(b.adimlar.filter((x) => x.tur !== o1).every((x) => x.gecerlilik === 'GECERLI'));
  // h1 yeni satir: http2 > 0 ama uyumsuz 0 -> GECERLI (eski kolon karar vermez).
  const { analiz: c } = await t3Analiz(h1, { donustur: (d) => protokolKolonu(d, () => ({ protokol: 'h1', protokol_uyumsuz: 0, http2: 5 })) });
  assert.ok(c.adimlar.every((x) => x.gecerlilik === 'GECERLI'), c.adimlar.map((x) => x.nedenler.join(';')).join('|'));
  // HATALI (kos.sh DUR) satirinda da: hatali_kosu + h2_disi.
  const kh = kaKurgu('R73');
  kh.kosu({ kip: 'ka', hiz: 400, r: 3, hatali: true });
  const { analiz: h } = await t3Analiz(kh, { donustur: (d) => protokolKolonu(d, (tur) => ({ protokol: 'h2', protokol_uyumsuz: tur === `R73${KA(400, 3)}` ? 7 : 0 })), secenek: { protokol: 'h2' } });
  assert.deepEqual(turla(h).get(`R73${KA(400, 3)}`).nedenler, ['hatali_kosu(kos.sh_durdurdu)', 'k6_rc=99', 'h2_disi(7)']);
});

test('AN-H3 protokol_farkli: beklenen h2 kolon yok (eski playbook) / beklenen h1 satir h2; h1 + kolon yok bugunku kural', async () => {
  const k = kaKurgu('R74');
  // Eski yuk_k6.js (30 kolon) h1 kosmus, Portal h2 istemis.
  const { analiz: a } = await t3Analiz(k, { secenek: { protokol: 'h2' } });
  assert.ok(a.adimlar.every((x) => x.gecerlilik === 'GECERSIZ' && x.nedenler.join(';') === 'protokol_farkli(beklenen=h2,olculen=yok)'), a.adimlar.map((x) => x.nedenler).join('|'));
  assert.ok(a.adimlar.every((x) => !('protokol' in x.ham)), 'kolonsuz satirda ham protokol alani yok');
  // Kolon yok + http2 > 0 + beklenen h2: yine protokol_farkli (eski http2 kurali h2'de yok).
  const { analiz: b } = await t3Analiz(k, { donustur: (d) => protokolKolonu(d, () => ({ http2: 9 })), secenek: { protokol: 'h2' } });
  assert.ok(b.adimlar.every((x) => x.nedenler.join(';') === 'protokol_farkli(beklenen=h2,olculen=yok)'));
  // Kolon yok + beklenen h1: bugunku kural (http2 > 0 -> http2; 0 -> GECERLI).
  const { analiz: c } = await t3Analiz(k, { donustur: (d) => protokolKolonu(d, () => ({ http2: 9 })) });
  assert.ok(c.adimlar.every((x) => x.nedenler.join(';') === 'http2'));
  assert.ok((await t3Analiz(k)).analiz.adimlar.every((x) => x.gecerlilik === 'GECERLI'));
  // Tanimsiz protokol degeri ('h3', bos) kolon yok sayilir.
  const { analiz: d } = await t3Analiz(k, { donustur: (x) => protokolKolonu(x, () => ({ protokol: 'h3' })), secenek: { protokol: 'h2' } });
  assert.ok(d.adimlar.every((x) => x.nedenler.join(';') === 'protokol_farkli(beklenen=h2,olculen=yok)'));
  // Hic sonuc yazmayan (tamamlanmadi) TUR protokol hakkinda bir sey soylemez.
  const kk = kaKurgu('R75');
  kk.kesik({ hiz: 450 });
  const { analiz: e } = await t3Analiz(kk, { donustur: (x) => protokolKolonu(x, () => ({ protokol: 'h2' })), secenek: { protokol: 'h2' } });
  const kesik = turla(e).get('R75_K_yeni_br_450_r1').nedenler;
  assert.equal(kesik[0], 'tamamlanmadi(istemci_sonucu_yok)');
  assert.ok(!kesik.some((n) => n.startsWith('protokol_farkli')), kesik.join(';'));
});

test('AN-H4 kararVer: farkli protokol VERI_YOK (motor kuralindan sonra), ayni protokol sonucu degismez, gecersiz TypeError', async () => {
  const m = await hazirla();
  const ra = m.get('R10').analiz.adimlar;
  const aa = m.get('R11').analiz.adimlar;
  const k = kararVer(ra, aa, { refProtokol: 'h1', adayProtokol: 'h2' });
  assert.equal(k.karar, 'VERI_YOK');
  assert.deepEqual(k.nedenler.slice(1), ['farkli protokol: referans HTTP/1.1, aday HTTP/2; ayni protokolle yeniden kosun']);
  assert.equal(k.nedenler[0], kararVer(ra, aa).nedenler[0], 'ilk satir degismez');
  assert.equal(kararVer(ra, aa, { refProtokol: 'h2', adayProtokol: 'h1' }).nedenler[1], 'farkli protokol: referans HTTP/2, aday HTTP/1.1; ayni protokolle yeniden kosun');
  assert.equal(kararVer(ra, aa, { adayProtokol: 'h2' }).karar, 'VERI_YOK', 'verilmeyen taraf h1');
  for (const s of [{ refProtokol: 'h2', adayProtokol: 'h2' }, { refProtokol: 'h1', adayProtokol: 'h1' }]) {
    assert.equal(JSON.stringify(kararVer(ra, aa, s)), JSON.stringify(kararVer(ra, aa)), JSON.stringify(s));
  }
  // Motor farki once gelir.
  const km = kararVer(ra, aa, { refMotor: 'wrk', adayMotor: 'k6', refProtokol: 'h1', adayProtokol: 'h2' });
  assert.match(km.nedenler[1], /^farkli yuk araci:/);
  assert.equal(km.nedenler.length, 2);
  // wrk farkli tavan / is parcacigindan ONCE.
  const kw = kararVer(ra, aa, { ...WRK, refTavanRps: 200, adayTavanRps: 450, refIsParcacigi: 2, adayIsParcacigi: 4, refProtokol: 'h1', adayProtokol: 'h2' });
  assert.match(kw.nedenler[1], /^farkli protokol:/);
  for (const s of [{ refProtokol: 'h3' }, { adayProtokol: 'H2' }, { refProtokol: null }, { adayProtokol: 2 }]) {
    assert.throws(() => kararVer(ra, aa, s), TypeError, JSON.stringify(s));
  }
});

test('AN-H5 kosuAnaliz protokol secenegi: h2 kosu uyarisi; wrk + h2 / gecersiz TypeError; h1 + eski fikstur birebir', async () => {
  const m = await hazirla();
  const veri = m.get('R10').veri;
  assert.throws(() => kosuAnaliz(veri, { adim: 'R10', motor: 'wrk', protokol: 'h2' }), { name: 'TypeError', message: 'kosuAnaliz: wrk yalniz h1' });
  for (const p of ['h3', 'H1', null, 2]) {
    assert.throws(() => kosuAnaliz(veri, { adim: 'R10', protokol: p }), { name: 'TypeError', message: 'kosuAnaliz: protokol gecersiz (h1 | h2)' }, String(p));
  }
  // h1 acik = varsayilan; eski fiksturde ham'da protokol anahtari YOK, uyari yok.
  for (const a of ADIMLAR) {
    const x = m.get(a.ad);
    assert.equal(JSON.stringify(kosuAnaliz(x.veri, { adim: a.ad, protokol: 'h1' })), JSON.stringify(x.analiz), a.ad);
    assert.ok(x.analiz.adimlar.every((s) => !('protokol' in s.ham) && !('protokol_uyumsuz' in s.ham)), a.ad);
    assert.ok(!x.analiz.uyarilar.includes(H2_KOSU), a.ad);
  }
  // h2: kosu uyarisi bir kez, katlanan TUR uyarilarindan ONCE; adim satirlari h1 yeni satirla ayni (protokol disinda).
  const k = kaKurgu('R76');
  const h2 = (await t3Analiz(k, { donustur: (d) => protokolKolonu(d, () => ({ protokol: 'h2' })), secenek: { protokol: 'h2' } })).analiz;
  assert.equal(h2.uyarilar.filter((u) => u === H2_KOSU).length, 1);
  const ilkKatli = h2.uyarilar.findIndex((u) => KATLI.test(u));
  assert.ok(ilkKatli === -1 || h2.uyarilar.indexOf(H2_KOSU) < ilkKatli, h2.uyarilar.join(' | '));
  const h1 = (await t3Analiz(k, { donustur: (d) => protokolKolonu(d, () => ({ protokol: 'h1' })) })).analiz;
  assert.deepEqual(h2.uyarilar.filter((u) => u !== H2_KOSU), h1.uyarilar);
  assert.equal(JSON.stringify(h2.adimlar).replaceAll('"protokol":"h2"', '"protokol":"h1"'), JSON.stringify(h1.adimlar));
  assert.equal(require('../analiz.cjs').H2_UYARISI, H2_KOSU);
  assert.ok(NEDENLER.some((d) => d.onek === 'h2_disi') && NEDENLER.some((d) => d.onek === 'protokol_farkli'));
});

/** Reload faz / neden degismezi (h2_sozlesme 6.5): reload nedeni <=> o TUR'a yazilmis 'olcum' olayi. */
function reloadDegismezi(an, yer) {
  const olcum = new Set(an.ozet.reloadlar.filter((o) => o.faz === 'olcum').map((o) => o.tur));
  for (const a of an.adimlar) {
    assert.equal(a.nedenler.includes('reload(worker_pid_degisti)'), olcum.has(a.tur), `${yer}/${a.tur}: neden ${a.nedenler.join(';')} / olaylar ${JSON.stringify(an.ozet.reloadlar.map((o) => [o.tur, o.faz]))}`);
  }
  for (const o of an.ozet.reloadlar) {
    assert.ok(['isinma', 'olcum', 'olcum_kenari', 'bosluk', 'kosu_oncesi'].includes(o.faz), `${yer}: faz ${o.faz}`);
    assert.ok(!('_kanit' in o), `${yer}: ic alan cikti`);
  }
  for (const a of an.adimlar) assert.ok(!('_cpu_pencere' in a) && !('_cpu_pencere' in a.ham), `${yer}/${a.tur}: ic alan cikti`);
}

test('AN-R1 reload fazi CPU penceresiyle kesin: olcum basi / sonu olcum_kenari (adim GECERLI), pencere ici olcum', async () => {
  // Kurgu: bas+1..bas+70 log (isinma 10), olcum log bas+11..bas+70 -> CPU penceresi [bas+14, bas+68]; olcum fazi [bas+10, bas+72].
  const tek = async (ad, ofs, dosya = {}) => {
    const k = new Kurgu(ad);
    k.kosu({ hiz: 100, reload: true, reloadOfs: ofs });
    k.kosu({ hiz: 100, r: 2 });
    return (await t3Analiz(k, { dosya })).analiz;
  };
  const T1 = (ad) => `${ad}_K_yeni_br_100_r1`;
  // (a) Olcumun ilk saniyeleri (bitisik farkli-PID cifti [bas+11, bas+12], w0 = bas+14 oncesi).
  const a = await tek('R60', 12);
  assert.deepEqual(a.ozet.reloadlar.map((o) => [o.t - T0, o.tur, o.faz, o.etkilenen_turlar]), [[60 + 12, T1('R60'), 'olcum_kenari', [T1('R60')]]]);
  assert.equal(turla(a).get(T1('R60')).gecerlilik, 'GECERLI', turla(a).get(T1('R60')).nedenler.join(';'));
  assert.deepEqual(turla(a).get(T1('R60')).ham.reloadlar.map((o) => o.faz), ['olcum_kenari']);
  // w0 sinirinda: cift [bas+13, bas+14] pencerede degil (a.t < w0) -> kenar; [bas+14, bas+15] pencerede -> olcum + neden.
  assert.equal((await tek('R61', 14)).ozet.reloadlar[0].faz, 'olcum_kenari');
  const b = await tek('R62', 15);
  assert.deepEqual(b.ozet.reloadlar.map((o) => [o.tur, o.faz]), [[T1('R62'), 'olcum']]);
  assert.ok(turla(b).get(T1('R62')).nedenler.includes('reload(worker_pid_degisti)'));
  // (b) Olcumun ortasi: olcum (eskisi gibi).
  assert.equal((await tek('R63', 40)).ozet.reloadlar[0].faz, 'olcum');
  // (c) Son saniyeler: cift [bas+68, bas+69] (w1 = bas+68 sonrasi) -> kenar; [bas+67, bas+68] -> olcum.
  const c = await tek('R64', 69);
  assert.deepEqual(c.ozet.reloadlar.map((o) => [o.tur, o.faz]), [[T1('R64'), 'olcum_kenari']]);
  assert.equal(turla(c).get(T1('R64')).gecerlilik, 'GECERLI');
  assert.equal((await tek('R65', 68)).ozet.reloadlar[0].faz, 'olcum');
  // (d) Isinma (olcum fazina degmez) isinma kalir.
  assert.equal((await tek('R66', 5)).ozet.reloadlar[0].faz, 'isinma');
  // (e) Ikinci kesit (ayni an): adimin CPU penceresi ana kesitten -> ana kesitteki olay olcum, digeri olcum_kenari.
  const e = await tek('R67', 40, { ekKesit: [T0 + 60 + 20, T0 + 60 + 60] });
  assert.deepEqual(e.ozet.reloadlar.map((o) => [o.kesit, o.faz]), [['R67_test', 'olcum'], ['R67_test_2', 'olcum_kenari']]);
  for (const an of [a, b, c, e]) reloadDegismezi(an, 'AN-R1');
  // 'shutting down' (k > 0) ornegi pencerede: tek ornek kanit; pencere disinda kenar.
  const kk = new Kurgu('R68');
  kk.kosu({ hiz: 100, kapanan: [12, 13] });
  kk.kosu({ hiz: 100, r: 2 });
  const k1 = (await t3Analiz(kk)).analiz;
  assert.deepEqual(k1.ozet.reloadlar.map((o) => [o.tur, o.faz]), [[T1('R68'), 'olcum_kenari']]);
  const kp = new Kurgu('R69');
  kp.kosu({ hiz: 100, kapanan: [30, 31] });
  kp.kosu({ hiz: 100, r: 2 });
  const k2 = (await t3Analiz(kp)).analiz;
  assert.deepEqual(k2.ozet.reloadlar.map((o) => [o.tur, o.faz]), [[T1('R69'), 'olcum']]);
  assert.ok(turla(k2).get(T1('R69')).nedenler.includes('reload(worker_pid_degisti)'));
  reloadDegismezi(k1, 'R68');
  reloadDegismezi(k2, 'R69');
});

test('AN-R2 degismez: reload nedeni <=> o TUR\'a yazilmis olcum olayi (kurgu fiksturleri + reload kaliplari)', async () => {
  const m = await hazirla();
  for (const [ad, x] of m) reloadDegismezi(x.analiz, ad);
  const ekler = [
    standart('R93', { ru: 22, reload: true }),
    standart('R96', { ru: 22, reload: true }),
  ];
  const isinma = new Kurgu('R97');
  isinma.kosu({ hiz: 100, reload: true, reloadOfs: 5 });
  isinma.kosu({ hiz: 100, r: 2 });
  const once = new Kurgu('R98');
  once.kosu({ hiz: 100, reload: true, reloadOfs: -30, kapanan: [-60, -55] });
  // Isinmada reload, eski worker'lar olcume tasar (RG3 kalibi).
  const tasan = new Kurgu('R59');
  tasan.kosu({ hiz: 100, reload: true, reloadOfs: 5, kapanan: [5, 25] });
  tasan.kosu({ hiz: 100, r: 2 });
  // CPU penceresinin tam sinirinda (w0 = bas+14) gorulen reload: cift [bas+13, bas+14] pencerede degil, olay [t, t_son]
  // pencereye degiyor -> ortusme kurali 'olcum' der ama adim dusmez (degismez bozulur); kanit kurali 'olcum_kenari'.
  const sinir = new Kurgu('R58');
  sinir.kosu({ hiz: 100, reload: true, reloadOfs: 14 });
  sinir.kosu({ hiz: 100, r: 2 });
  for (const k of [...ekler, isinma, once, tasan, sinir]) reloadDegismezi((await t3Analiz(k)).analiz, k.adim);
  const t = (await t3Analiz(tasan)).analiz;
  assert.deepEqual(t.ozet.reloadlar.map((o) => [o.tur, o.faz]), [['R59_K_yeni_br_100_r1', 'olcum']]);
});

// ---------------------------------------------------------------------------------------------
// 2026-11-03 (K3): yuk makinesi CPU'su (yukcpu_*.csv). Olcum penceresi bosta CPU < %20 -> DOYMA (YUK_DOYDU):
// neden doyma:yuk_cpu_bosta_%x(<%20), ham.yuk_cpu_bosta; p95 / kapasite kararina girmez. Kayit yoksa alanlar YOK.
//   AN-Y1 esik: %19,9 DOYMA + neden, %20,0 isaret yok; GECERSIZ onceligi; ham ve ozet alanlari; serbestte de
//   AN-Y2 kayitsiz kosu: ham'da yuk_cpu_bosta YOK, ozet.yuk_kesitler YOK, cikti kayitli kosunun yuk alanlari disinda ayni
//   AN-Y3 grup p95 ortalamasi ve kararVer: YUK_DOYDU adim p95'e girmez; DOYMA mesaji yuk makinesini soyler
// ---------------------------------------------------------------------------------------------
// B2 karar nedeni (analiz.cjs YUK_DOYDU_KARARI ile BIREBIR; metin burada kilitli).
const YUK_DOYDU_KARARI = 'Yük makinesi doydu: p95 karşılaştırılamadı; yük makinesini rahatlatın ya da hızı düşürüp yeniden koşun';
/** zaman.csv'den TUR pencereleri; `bosta(tur)` o TUR'un [bas, bit] icinde saniyelik bosta orani (tik / 1000). */
function yukCpuEkle(dosyalar, bosta, { adim = null, host = 'ymak01', bilgi = true, olcek = 1, atla = (_t, _tur) => false } = {}) {
  const z = dosyalar.get('zaman.csv').icerik.trim().split('\n').slice(1).map((s) => s.split(','));
  const ad = adim || z[0][0].split('_')[0];
  const bas = Math.min(...z.map((x) => Number(x[1]))) - 30;
  const bit = Math.max(...z.map((x) => Number(x[2]))) + 30;
  let busy = 0;
  let idle = 0;
  const satirlar = ['epoch,cpu_user,cpu_nice,cpu_system,cpu_idle,cpu_iowait,cpu_irq,cpu_softirq,cpu_steal'];
  for (let t = bas; t <= bit; t++) {
    const tur = z.find((x) => Number(x[1]) <= t && t < Number(x[2]));
    // bosta(tur, TUR basindan saniye, TUR bitisine saniye): faza gore farkli deger (isinma / kenar).
    const b = tur ? bosta(tur[0], t - Number(tur[1]), Number(tur[2]) - t) : 600;
    idle += Math.round(b * olcek);
    busy += Math.round((1000 - b) * olcek);
    if (atla(t, tur ? tur[0] : null)) continue;
    satirlar.push(`${t}.000100,${busy},0,0,${idle},0,0,0,0`);
  }
  const out = new Map(dosyalar);
  out.set(`yukcpu_${ad}_${host}.csv`, { icerik: satirlar.join('\n') + '\n', py: false, portal: true, log: false });
  if (bilgi) out.set(`yukcpu_${ad}_${host}.txt`, { icerik: `surum=1\nadim=${ad}\nhost=${host}\nnproc=16\nclk_tck=100\nbas_epoch=${bas}\nbit_epoch=${bit}\nornek_sayisi=${bit - bas + 1}\n`, py: false, portal: true, log: false });
  return out;
}

test('AN-Y1 yuk makinesi bosta CPU esigi %20: %19,9 DOYMA + neden, %20,0 isaret yok; GECERSIZ onceligi; serbestte de', async () => {
  const k = standart('R96', { n429: 1 });
  const bosta = (tur) => { if (tur.endsWith('_400_r1')) return 199; if (tur.endsWith('_400_r2')) return 200; if (tur.endsWith('_250_r1')) return 50; return 600; };
  const { veri, analiz: a } = await t3Analiz(k, { donustur: (d) => yukCpuEkle(d, bosta) });
  assert.deepEqual(veri.yukKesitler.map((x) => [x.anahtar, x.bilgiVar]), [['R96_ymak01', true]]);
  const t = turla(a);
  const d = t.get('R96_K_yeni_br_400_r1');
  assert.equal(d.gecerlilik, 'DOYMA');
  assert.deepEqual(d.nedenler, ['doyma:yuk_cpu_bosta_%19.9(<%20)']);
  assert.ok(Math.abs(d.ham.yuk_cpu_bosta - 19.9) < 1e-9, String(d.ham.yuk_cpu_bosta));
  // Esitlik (%20,0) isaret degil.
  const e = t.get('R96_K_yeni_br_400_r2');
  assert.equal(e.gecerlilik, 'GECERLI');
  assert.ok(Math.abs(e.ham.yuk_cpu_bosta - 20) < 1e-9);
  // GECERSIZ onceligi: 429'lu 250_r1 yuk makinesi doysa da GECERSIZ, doyma nedeni yok.
  const g = t.get('R96_K_yeni_br_250_r1');
  assert.equal(g.gecerlilik, 'GECERSIZ');
  assert.ok(!g.nedenler.some((n) => n.startsWith('doyma:')), String(g.nedenler));
  assert.ok(Math.abs(g.ham.yuk_cpu_bosta - 5) < 1e-9);
  assert.ok(Math.abs(t.get('R96_K_yeni_br_100_r1').ham.yuk_cpu_bosta - 60) < 1e-9);
  assert.deepEqual(a.ozet.yuk_kesitler, [{ anahtar: 'R96_ymak01', ornek: veri.yukKesitler[0].ornekler.length, bilgi_var: true, nproc: 16 }]);
  // Her neden NEDEN_KALIPLARI'ndan (arayuz eslemesi) ve NEDENLER onekinden.
  assert.ok(NEDEN_KALIPLARI.some((x) => x.kod === 'doyma_yuk_cpu' && x.re.test(d.nedenler[0])));
  aciklamali(a);
  // Serbest hedefte de (yuk makinesi ayni makine).
  const s = await t3Analiz(standart('R97'), { donustur: (dd) => yukCpuEkle(serbestDosyalari(dd), (tur) => (tur.endsWith('_100_r1') ? 100 : 600)), secenek: { hedefTuru: 'serbest' } });
  const st = turla(s.analiz).get('R97_K_yeni_br_100_r1');
  assert.deepEqual([st.gecerlilik, st.nedenler], ['DOYMA', ['doyma:yuk_cpu_bosta_%10.0(<%20)']]);
});

test('AN-Y2 kayitsiz kosu: ham yuk_cpu_bosta YOK, ozet.yuk_kesitler YOK; kayitli kosu yuk alanlari disinda ayni', async () => {
  const k = standart('R98');
  const eski = (await t3Analiz(k)).analiz;
  assert.ok(eski.adimlar.every((x) => !('yuk_cpu_bosta' in x.ham)));
  assert.ok(!('yuk_kesitler' in eski.ozet));
  const yeni = (await t3Analiz(k, { donustur: (d) => yukCpuEkle(d, () => 600) })).analiz;
  const temiz = (an) => {
    const x = JSON.parse(JSON.stringify(an));
    for (const s of x.adimlar) delete s.ham.yuk_cpu_bosta;
    delete x.ozet.yuk_kesitler;
    x.ozet.okunan_bayt = null;
    x.ozet.sha256 = null;
    return x;
  };
  assert.deepEqual(temiz(yeni), temiz(eski));
  // Bilgi dosyasi olmadan da okunur (nproc null); pencere 10 sn'den kisa ise olculmez (null, isaret yok).
  const bilgisiz = (await t3Analiz(k, { donustur: (d) => yukCpuEkle(d, () => 100, { bilgi: false }) })).analiz;
  assert.deepEqual(bilgisiz.ozet.yuk_kesitler.map((x) => [x.bilgi_var, x.nproc]), [[false, null]]);
  assert.ok(bilgisiz.adimlar.every((x) => x.gecerlilik === 'DOYMA'));
});

test('AN-Y3 grup p95 ve kararVer: YUK_DOYDU adim p95 ortalamasina girmez; DOYMA mesaji yuk makinesini soyler; eski mesaj aynen', async () => {
  const k = standart('R99', { kosuEk: (h, r) => (h === 250 && r === 1 ? { p95: 500 } : {}) });
  const { analiz: a } = await t3Analiz(k, { donustur: (d) => yukCpuEkle(d, (tur) => (tur.endsWith('_250_r1') ? 100 : 600)) });
  const g250 = a.ozet.gruplar.find((x) => x.hiz === 250);
  assert.equal(g250.p95, 50, 'YUK_DOYDU adimin p95 (500) ortalamaya girdi');
  assert.equal(g250.yuk_doydu, 1);
  assert.equal(g250.durum, 'DOYMA');
  assert.ok(a.ozet.gruplar.filter((x) => x.hiz !== 250).every((x) => !('yuk_doydu' in x)));
  // B2: CPU-ms/istek hedefin olcusu: yalniz yuk makinesi doymus tekrar CPU ortalamasina GIRER (250_r1 DOYMA ama sayilir).
  const tek = (await t3Analiz(standart('R99', { kosuEk: (h, r) => (h === 250 && r === 1 ? { p95: 500 } : {}) }), { donustur: (d) => yukCpuEkle(d, () => 600) })).analiz;
  const g250tek = tek.ozet.gruplar.find((x) => x.hiz === 250);
  assert.ok(g250.cpu_ms_istek !== null && Math.abs(g250.cpu_ms_istek - g250tek.cpu_ms_istek) < 1e-9, `${g250.cpu_ms_istek} / ${g250tek.cpu_ms_istek}`);
  // kararVer: aday kademe 250'de iki kosu da yuk makinesinde doydu -> CPU-ms GECERLI (CPU satiri var), p95@250
  // karsilastirilamaz -> DOYMA (yeni neden metni).
  const ref = (await t3Analiz(standart('R100'))).analiz.adimlar;
  const ady = (await t3Analiz(standart('R101'), { donustur: (d) => yukCpuEkle(d, (tur) => (/_250_/.test(tur) ? 100 : 600)) })).analiz.adimlar;
  const kr = kararVer(ref, ady);
  assert.equal(kr.karar, 'DOYMA');
  assert.ok(kr.nedenler.some((n) => /^CPU-ms\/istek @250: ref=/.test(n)), kr.nedenler.join(' | '));
  assert.ok(kr.nedenler.includes('p95 @250: yük makinesi doydu, karşılaştırılmadı'), kr.nedenler.join(' | '));
  assert.ok(kr.nedenler.includes(YUK_DOYDU_KARARI), kr.nedenler.join(' | '));
  // Hedef tarafi doyma (dropped) CPU kumesine girmez: eski mesaj BIREBIR.
  const kd = kararVer(ref, (await t3Analiz(standart('R102', { kosuEk: (h) => (h === 250 ? { dropped: 50 } : {}) }))).analiz.adimlar);
  assert.equal(kd.karar, 'DOYMA');
  assert.equal(kd.nedenler.at(-1), '250 istek/sn kademesinde CPU-ms/istek yok: aday R102 doydu (dropped>0 ya da host CPU>%90); daha dusuk bir kademeyle tekrar kosun');
});

// 2026-11-03 dogrulayici TUR 1 duzeltmeleri:
//   AN-Y4 pencere ISINMAYI ve son 2 sn'yi dislar (P17 korlugu): isinma / kenar bosta 0, olcum fazi %60 -> tam %60
//   AN-Y5 'olculemedi' notu: yeni playbook (yukKaydedici ya da dosya) + olcum yok -> kosu uyarisi ve ozet nedeni;
//         kismen olculmus -> adim uyarisi; eski kosu -> hicbiri; bozuk dosya kosuyu OKUNAMADI yapmaz
//   AN-Y6 kademenin tum tekrarlari YUK_DOYDU -> p95 sessiz atlanmaz: satir + not, KALICI YOK (DOYMA/ RET aynen)
//   AN-Y7 neden metni asagi yuvarlanir: %19,96 -> '%19.9(<%20)' (esikle celismez)
test('AN-Y4 yuk CPU penceresi isinma + 3 sn ve bitis - 2 sn disinda: isinma / kenar ornekleri ortalamaya girmez', async () => {
  const k = standart('R110');
  const isinma = (await t3Analiz(k)).analiz.adimlar[0].ham.isinma_sn;
  assert.ok(isinma >= 2, `kurgu isinmasi ${isinma}: test anlamsiz`);
  const bosta = (_tur, ofsBas, ofsBit) => (ofsBas < isinma + 4 || ofsBit < 3 ? 0 : 600);
  const { analiz: a } = await t3Analiz(k, { donustur: (d) => yukCpuEkle(d, bosta) });
  for (const x of a.adimlar) {
    assert.ok(Math.abs(x.ham.yuk_cpu_bosta - 60) < 1e-9, `${x.tur}: ${x.ham.yuk_cpu_bosta} (isinma ya da kenar pencereye girdi)`);
    assert.equal(x.gecerlilik, 'GECERLI', x.tur);
  }
});

test('AN-Y5 yuk kaydi beklenip olculemedi: kosu uyarisi + ozet nedeni; kismi olcumde adim uyarisi; eski kosu birebir; bozuk dosya OKUNAMADI degil', async () => {
  const k = standart('R111');
  const eski = (await t3Analiz(k)).analiz;
  const yukUyari = (an) => an.uyarilar.filter((u) => /yuk_cpu_olculemedi/.test(u));
  // Eski playbook (alan yok, dosya yok): hicbir sey eklenmez.
  assert.deepEqual(yukUyari(eski), []);
  assert.ok(!('yuk_cpu_olculemedi' in eski.ozet));
  for (const [secenek, donustur, neden] of [
    [{ yukKaydedici: 'basladi' }, (d) => d, 'kayit_yok'],
    [{ yukKaydedici: 'baslamadi' }, (d) => d, 'kaydedici_baslamadi'],
    [{}, (d) => yukCpuEkle(d, () => 600, { atla: () => true }), 'pencerede_ornek_yok'],
    [{ yukKaydedici: 'basladi' }, (d) => new Map([...d, ['yukcpu_R111_ymak01.csv', { icerik: '1800000000,1,0,0,1,0,0,0,0\n', py: false, portal: true, log: false }]]), 'kayit_bozuk'],
  ]) {
    const { veri, analiz: a } = await t3Analiz(k, { donustur, secenek });
    assert.deepEqual(yukUyari(a), [`yuk_cpu_olculemedi(${neden})`], neden);
    assert.equal(a.ozet.yuk_cpu_olculemedi, neden);
    // Tek kosu uyarisi: adimlara tek tek yazilmaz (gurultu yok); gecerlilik degismez.
    assert.ok(a.adimlar.every((x) => !x.ham.uyarilar.includes('yuk_cpu_olculemedi')), neden);
    assert.deepEqual(a.adimlar.map((x) => x.gecerlilik), eski.adimlar.map((x) => x.gecerlilik), neden);
    if (neden === 'kayit_bozuk') assert.match(veri.yukKesitler[0].sorun, /eksik kolon/);
  }
  // Kismi: bir TUR'un ornekleri yok -> yalniz o adima uyari, kosu uyarisi yok.
  const hedefTur = eski.adimlar[0].tur;
  const { analiz: kis } = await t3Analiz(k, { donustur: (d) => yukCpuEkle(d, () => 600, { atla: (_t, tur) => tur === hedefTur }), secenek: { yukKaydedici: 'basladi' } });
  assert.deepEqual(yukUyari(kis).filter((u) => !u.startsWith(`${hedefTur}: `)), []);
  const t = turla(kis);
  assert.ok(t.get(hedefTur).ham.uyarilar.includes('yuk_cpu_olculemedi'));
  assert.ok(!('yuk_cpu_bosta' in t.get(hedefTur).ham));
  assert.ok(kis.adimlar.filter((x) => x.tur !== hedefTur).every((x) => !x.ham.uyarilar.includes('yuk_cpu_olculemedi')));
  assert.ok(NEDEN_KALIPLARI.some((x) => x.kod === 'yuk_cpu_olculemedi' && x.tur === 'uyari' && x.re.test('yuk_cpu_olculemedi')));
  aciklamali(kis);
});

test('AN-Y6 (B2) kademenin tum tekrarlari YUK_DOYDU: satir + karar DOYMA (KALICI asla); baska kademede zarar RET; referans tarafinda da; serbest yolda da', async () => {
  const ref = (await t3Analiz(standart('R112'))).analiz.adimlar;
  const adayK = () => standart('R113', { ru: 12, p95_400: 500 });
  const kontrol = kararVer(ref, (await t3Analiz(adayK())).analiz.adimlar);
  assert.equal(kontrol.karar, 'RET');
  // Ayni aday, 400'de yuk makinesi doymus: p95@400 karsilastirilamaz -> DOYMA.
  const yukAdy = (await t3Analiz(adayK(), { donustur: (d) => yukCpuEkle(d, (tur) => (/_400_/.test(tur) ? 100 : 600)) })).analiz.adimlar;
  const kr = kararVer(ref, yukAdy);
  assert.equal(kr.karar, 'DOYMA', kr.nedenler.join(' | '));
  assert.ok(kr.nedenler.includes('p95 @400: yük makinesi doydu, karşılaştırılmadı'), kr.nedenler.join(' | '));
  assert.ok(kr.nedenler.includes(YUK_DOYDU_KARARI), kr.nedenler.join(' | '));
  // Isaretsiz kosuda bu satirlar YOK.
  assert.ok(!kontrol.nedenler.some((n) => /ük makinesi doydu/.test(n)));
  // Baska kademede (250) gercek zarar: RET degismez (satir yine yazilir).
  const zararAdy = (await t3Analiz(standart('R119', { ru: 12, kosuEk: (h) => (h === 250 ? { p95: 500 } : {}) }), { donustur: (d) => yukCpuEkle(d, (tur) => (/_400_/.test(tur) ? 100 : 600)) })).analiz.adimlar;
  const krz = kararVer(ref, zararAdy);
  assert.equal(krz.karar, 'RET', krz.nedenler.join(' | '));
  assert.ok(krz.nedenler.includes('p95 @400: yük makinesi doydu, karşılaştırılmadı'), krz.nedenler.join(' | '));
  // Referans tarafi doymussa da: yuk kaydi olmadan bu kurgu KALICI (CPU kazanci) -> yuk ile DOYMA.
  const ady115 = (await t3Analiz(standart('R115', { ru: 12 }))).analiz.adimlar;
  assert.equal(kararVer((await t3Analiz(standart('R114'))).analiz.adimlar, ady115).karar, 'KALICI', 'kurgu anlamsiz: yuk kaydi olmadan KALICI olmali');
  const yukRef = (await t3Analiz(standart('R114'), { donustur: (d) => yukCpuEkle(d, (tur) => (/_400_/.test(tur) ? 100 : 600)) })).analiz.adimlar;
  const kr2 = kararVer(yukRef, ady115);
  assert.equal(kr2.karar, 'DOYMA', kr2.nedenler.join(' | '));
  assert.ok(kr2.nedenler.includes('p95 @400: yük makinesi doydu, karşılaştırılmadı'), kr2.nedenler.join(' | '));
  // CPU'suz (serbest) yol: DOYMA (NOTR degil).
  const sr = (await t3Analiz(standart('R116'), { donustur: (d) => serbestDosyalari(d), secenek: { hedefTuru: 'serbest' } })).analiz.adimlar;
  const sa = (await t3Analiz(standart('R117'), { donustur: (d) => yukCpuEkle(serbestDosyalari(d), (tur) => (/_400_/.test(tur) ? 100 : 600)), secenek: { hedefTuru: 'serbest' } })).analiz.adimlar;
  const kr3 = kararVer(sr, sa, { refHedefTuru: 'serbest', adayHedefTuru: 'serbest' });
  assert.equal(kr3.karar, 'DOYMA', kr3.nedenler.join(' | '));
  assert.ok(kr3.nedenler.includes(YUK_DOYDU_KARARI), kr3.nedenler.join(' | '));
});

// B2 probe (dogrulayici scratchpad probe_p95.test.cjs): p95 gerilemesi yuk-doymus en ust kademede. Eskiden kademe sessiz
// atlanip KALICI cikabiliyordu; artik RET ya da DOYMA, KALICI asla. dropped'li (hedef tarafi) DOYMA kiyasi eskisi gibi RET.
test('AN-Y8 probe: yuk makinesi doymus en ust kademede p95 gerilemesi KALICI vermez (RET ya da DOYMA)', async () => {
  const ref = (await t3Analiz(standart('R200'))).analiz.adimlar;
  const adayK = () => standart('R201', { ru: 12, p95_400: 500 });
  const yuk = kararVer(ref, (await t3Analiz(adayK(), { donustur: (d) => yukCpuEkle(d, (tur) => (/_400_/.test(tur) ? 100 : 600)) })).analiz.adimlar);
  assert.ok(['RET', 'DOYMA'].includes(yuk.karar), `${yuk.karar}: ${yuk.nedenler.join(' | ')}`);
  assert.ok(yuk.nedenler.includes('p95 @400: yük makinesi doydu, karşılaştırılmadı'), yuk.nedenler.join(' | '));
  const drop = kararVer(ref, (await t3Analiz(standart('R202', { ru: 12, p95_400: 500, kosuEk: (h) => (h === 400 ? { dropped: 50 } : {}) }))).analiz.adimlar);
  assert.equal(drop.karar, 'RET', drop.nedenler.join(' | '));
});

// B1: yeni playbook kaydedici son satiri olculemedi notuna eklenir (ASCII, 200); kayit beklenip olcumu olmayan her
// HATALI disi adimda ham.yuk_cpu_olculemedi true. Eski playbook (secenek / dosya yok): alan da not da YOK.
test('AN-Y9 (B1) olculemedi: son satir notta ve ozette; adim ham.yuk_cpu_olculemedi; eski kosu birebir', async () => {
  const k = standart('R120');
  const eski = (await t3Analiz(k)).analiz;
  assert.ok(eski.adimlar.every((x) => !('yuk_cpu_olculemedi' in x.ham)));
  assert.ok(!('yuk_cpu_son_satir' in eski.ozet));
  // Son satir verilse bile eski playbook (yukKaydedici yok, dosya yok): hicbir sey eklenmez.
  const sadeceSon = (await t3Analiz(k, { secenek: { yukSonSatir: 'HATA: x' } })).analiz;
  assert.deepEqual(JSON.parse(JSON.stringify(sadeceSon.adimlar)), JSON.parse(JSON.stringify(eski.adimlar)));
  assert.deepEqual(sadeceSon.uyarilar, eski.uyarilar);
  const son = 'HATA: /proc/stat okunamiyor ç' + 'x'.repeat(300);
  const { analiz: a } = await t3Analiz(k, { secenek: { yukKaydedici: 'baslamadi', yukSonSatir: son } });
  const bek = ('HATA: /proc/stat okunamiyor ?' + 'x'.repeat(300)).slice(0, 200);
  assert.deepEqual(a.uyarilar.filter((u) => u.startsWith('yuk_cpu_olculemedi')), [`yuk_cpu_olculemedi(kaydedici_baslamadi;son=${bek})`]);
  assert.equal(a.ozet.yuk_cpu_son_satir, bek);
  assert.ok(a.adimlar.every((x) => x.ham.yuk_cpu_olculemedi === true), 'kayit beklenip olcum yok: her adim olculemedi');
  // Son satir yoksa eski bicim (parantez icinde yalniz neden).
  const { analiz: b } = await t3Analiz(k, { secenek: { yukKaydedici: 'basladi' } });
  assert.deepEqual(b.uyarilar.filter((u) => u.startsWith('yuk_cpu_olculemedi')), ['yuk_cpu_olculemedi(kayit_yok)']);
  // Kismi: yalniz olcumu olmayan adim isaretli; olculen adimda alan YOK.
  const hedefTur = eski.adimlar[0].tur;
  const { analiz: kis } = await t3Analiz(k, { donustur: (d) => yukCpuEkle(d, () => 600, { atla: (_t, tur) => tur === hedefTur }), secenek: { yukKaydedici: 'basladi' } });
  const t = turla(kis);
  assert.equal(t.get(hedefTur).ham.yuk_cpu_olculemedi, true);
  assert.ok(kis.adimlar.filter((x) => x.tur !== hedefTur).every((x) => !('yuk_cpu_olculemedi' in x.ham)));
});

test('AN-Y7 YUK_DOYDU neden metni asagi yuvarlanir: %19,96 -> %19.9(<%20); %19,99 de %19.9', async () => {
  const k = standart('R118');
  const bosta = (tur) => { if (tur.endsWith('_400_r1')) return 199.6; if (tur.endsWith('_400_r2')) return 199.9; return 600; };
  const { analiz: a } = await t3Analiz(k, { donustur: (d) => yukCpuEkle(d, bosta, { olcek: 10 }) });
  const t = turla(a);
  for (const [tur, ham] of [['R118_K_yeni_br_400_r1', 19.96], ['R118_K_yeni_br_400_r2', 19.99]]) {
    const x = t.get(tur);
    assert.ok(Math.abs(x.ham.yuk_cpu_bosta - ham) < 1e-9, `${tur}: ${x.ham.yuk_cpu_bosta}`);
    assert.deepEqual([x.gecerlilik, x.nedenler], ['DOYMA', ['doyma:yuk_cpu_bosta_%19.9(<%20)']], tur);
  }
});

// ---------------------------------------------------------------------------------------------
// 2026-11-03 bellek olcumu ve kip dogrulamasi girdisi (analiz.cjs PORTAL FARKLARI 13 / 14)
//   AN-B1 hedef bellek_*.csv + yukcpu bellek kolonlari -> ham.bellek (MB / %); kayitsiz kosu: ham.bellek YOK, ozet
//         bellek_kesitler YOK, geri kalan cikti BIREBIR; serbestte hedef bellegi yok sayilir
//   AN-B2 bos bellek %10 altinda TUR uyarisi bellek_bos_az(hedef|yuk,%x); %10 esitlik uyari degil; gecerlilik DEGISMEZ
//   AN-B3 olasi sizinti: monoton artis + >= %20 + >= 50 MB + kosu sonu geri inmedi -> kosu uyarisi; her kosul tek tek
//         bozulunca uyari yok
//   AN-K1 istemci_<TUR>.json kodlama -> ham.kodlama (yalniz varsa); bozuk JSON kosuyu OKUNAMADI yapmaz; analiz ciktisi
//         kodlama anahtari disinda BIREBIR
//   AN-KS karisik surum: 6e33e5a (eski Portal) sonuc.cjs + analiz.cjs yeni playbook dosyalarini (bellek_*, yukcpu_* yeni
//         kolonlar, istemci JSON kodlama, SHA256SUMS'ta listeli) REDDETMEZ ve ciktisi dosyalarsiz dizinle ayni; yeni Portal
//         eski playbook dizininde eski Portal'la ayni analiz (ozet.sha256 / okunan_bayt haric)
// ---------------------------------------------------------------------------------------------

/** Hedef bellek kaydi: sunucu_*.csv'nin ornek zamanlariyla bellek_<anahtar>.csv; `rss(t, i)` kB, son ornek `son`. */
function bellekEkle(dosyalar, rss, { mt = 16000000, ma = (_t) => 8000000, son = null } = {}) {
  const ad = [...dosyalar.keys()].find((x) => /^sunucu_.*\.csv$/.test(x));
  const anahtar = ad.slice('sunucu_'.length, -'.csv'.length);
  const ts = dosyalar.get(ad).icerik.trim().split('\n').slice(1).map((s) => Number(s.split(',')[0]));
  const satirlar = ['epoch,nginx_rss_kb,isci_sayi,mem_total_kb,mem_available_kb'];
  ts.forEach((t, i) => satirlar.push(`${t},${i === ts.length - 1 && son !== null ? son : Math.round(rss(t, i, ts.length))},2,${mt},${ma(t)}`));
  const out = new Map(dosyalar);
  out.set(`bellek_${anahtar}.csv`, { icerik: satirlar.join('\n') + '\n', py: false, portal: true, log: false });
  return out;
}
/** yukcpu_*.csv'ye mem_total_kb, mem_available_kb, arac_rss_kb kolonlari (yukCpuEkle'den sonra). */
function yukBellekEkle(dosyalar, { mt = 32000000, ma = (_t) => 20000000, ar = (_t) => 500000 } = {}) {
  const out = new Map(dosyalar);
  for (const [ad, f] of dosyalar) {
    if (!/^yukcpu_.*\.csv$/.test(ad)) continue;
    const [bas, ...gov] = f.icerik.trim().split('\n');
    const yeni = [`${bas},mem_total_kb,mem_available_kb,arac_rss_kb`, ...gov.map((s) => {
      const t = Number(s.split(',')[0]);
      return `${s},${mt},${ma(t)},${ar(t)}`;
    })];
    out.set(ad, { ...f, icerik: yeni.join('\n') + '\n' });
  }
  return out;
}
/** Her istemci_<TUR>.csv icin istemci_<TUR>.json (yeni yuk_k6.js: kodlama anahtari; `kodlama(tur)` null ise anahtar yok). */
function kodlamaEkle(dosyalar, kodlama) {
  const out = new Map(dosyalar);
  for (const ad of dosyalar.keys()) {
    const m = /^istemci_(.+)\.csv$/.exec(ad);
    if (!m) continue;
    const k = kodlama(m[1]);
    out.set(`istemci_${m[1]}.json`, { icerik: JSON.stringify({ tur: m[1], hiz: 1, ...(k ? { kodlama: k } : {}) }, null, 2) + '\n', py: false, portal: true, log: false });
  }
  return out;
}
const yeniAlanlarsiz = (an) => {
  const x = JSON.parse(JSON.stringify(an));
  for (const s of x.adimlar) {
    delete s.ham.bellek;
    delete s.ham.kodlama;
    s.ham.uyarilar = s.ham.uyarilar.filter((u) => !u.startsWith('bellek_bos_az('));
  }
  x.uyarilar = x.uyarilar.filter((u) => !/(^|: )(bellek_bos_az\(|nginx_bellek_artisi\()/.test(u));
  delete x.ozet.bellek_kesitler;
  x.ozet.okunan_bayt = null;
  x.ozet.sha256 = null;
  return x;
};

test('AN-B1 bellek: ham.bellek hedef (CPU penceresi) + yuk makinesi (yuk penceresi); kayitsiz kosu birebir; serbestte hedef yok sayilir', async () => {
  const k = standart('R120');
  const eski = (await t3Analiz(k)).analiz;
  assert.ok(eski.adimlar.every((x) => !('bellek' in x.ham) && !('kodlama' in x.ham)));
  assert.ok(!('bellek_kesitler' in eski.ozet));
  const { veri, analiz: a } = await t3Analiz(k, {
    donustur: (d) => yukBellekEkle(yukCpuEkle(bellekEkle(d, () => 200 * 1024, { ma: () => 4000000 }), () => 600), { ar: () => 300 * 1024 }),
  });
  assert.deepEqual(veri.bellekKesitler.map((x) => [x.anahtar, x.ornekler.length > 100, 'sorun' in x]), [['R120_test', true, false]]);
  assert.deepEqual(a.ozet.bellek_kesitler.map((x) => x.anahtar), ['R120_test']);
  for (const s of a.adimlar) {
    assert.deepEqual(s.ham.bellek, {
      nginx_rss_ort_mb: 200, nginx_rss_max_mb: 200, hedef_bellek_yuzde: 75, hedef_bos_min_yuzde: 25,
      yuk_bellek_yuzde: 37.5, yuk_bos_min_yuzde: 62.5, arac_rss_max_mb: 300,
    }, s.tur);
  }
  // Bellek alanlari disinda (gecerlilik, nedenler, CPU, karar girdileri) ayni.
  const yukYok = (an) => {
    const x = yeniAlanlarsiz(an);
    for (const s of x.adimlar) delete s.ham.yuk_cpu_bosta;
    delete x.ozet.yuk_kesitler;
    return x;
  };
  assert.deepEqual(yukYok(a), yukYok(eski));
  // Yalniz yuk makinesi bellegi (hedef dosyasi yok): hedef alanlari null, yuk alanlari dolu.
  const y = (await t3Analiz(k, { donustur: (d) => yukBellekEkle(yukCpuEkle(d, () => 600)) })).analiz;
  assert.deepEqual([y.adimlar[0].ham.bellek.nginx_rss_ort_mb, y.adimlar[0].ham.bellek.yuk_bos_min_yuzde, y.adimlar[0].ham.bellek.arac_rss_max_mb], [null, 62.5, 500000 / 1024]);
  // Bos hucreli bellek kolonlari (meminfo okunamadi): olcum yok -> ham.bellek YOK.
  const bos = (await t3Analiz(k, { donustur: (d) => yukBellekEkle(yukCpuEkle(d, () => 600), { mt: '', ma: () => '', ar: () => '' }) })).analiz;
  assert.ok(bos.adimlar.every((x) => !('bellek' in x.ham)));
  // Serbest hedef: dizinde hedef bellek dosyasi olsa da yok sayilir (sunucu dosyalari gibi).
  const sk = standart('R121');
  const sr = (await t3Analiz(sk, { donustur: (d) => bellekEkle(d, () => 1024), secenek: { hedefTuru: 'serbest' } })).analiz;
  assert.ok(sr.adimlar.every((x) => !('bellek' in x.ham)) && !('bellek_kesitler' in sr.ozet));
});

test('AN-B2 bos bellek %10 altinda TUR uyarisi (hedef / yuk), %10 esitlik uyari degil; gecerlilik degismez', async () => {
  const k = standart('R122');
  const az = (await t3Analiz(k, { donustur: (d) => yukBellekEkle(yukCpuEkle(bellekEkle(d, () => 1024, { ma: () => 1599999 }), () => 600), { ma: () => 3000000 }) })).analiz;
  for (const s of az.adimlar) {
    assert.ok(s.ham.uyarilar.includes('bellek_bos_az(hedef,%9.9)'), `${s.tur}: ${s.ham.uyarilar}`);
    assert.ok(s.ham.uyarilar.includes('bellek_bos_az(yuk,%9.3)'), `${s.tur}: ${s.ham.uyarilar}`);
    assert.ok(NEDEN_KALIPLARI.some((x) => x.kod === 'bellek_bos_az' && x.tur === 'uyari' && x.re.test('bellek_bos_az(hedef,%9.9)')));
  }
  assert.ok(az.uyarilar.some((u) => /^R122_K_yeni_br_100_r1: bellek_bos_az\(hedef,%9\.9\)$/.test(u)), 'kosu duzeyine katlanir');
  const esit = (await t3Analiz(k, { donustur: (d) => bellekEkle(d, () => 1024, { ma: () => 1600000 }) })).analiz;
  assert.ok(esit.adimlar.every((s) => !s.ham.uyarilar.some((u) => u.startsWith('bellek_bos_az('))));
  const eski = (await t3Analiz(k)).analiz;
  assert.deepEqual(az.adimlar.map((s) => [s.gecerlilik, s.nedenler]), eski.adimlar.map((s) => [s.gecerlilik, s.nedenler]));
  assert.equal(az.gecerlilik, eski.gecerlilik);
});

test('AN-B3 olasi bellek sizintisi: monoton + %20 + 50 MB + kosu sonu inmedi; her kosul bozulunca yok', async () => {
  const k = standart('R123');
  const t0 = 1800000000;
  // 100 MB'tan baslayip saniyede ~0,2 MB artar (623 sn'lik kayitta adim ortalamalari ~90 MB artar).
  const artan = (t) => 100 * 1024 + (t - t0) * 200;
  const sizinti = (a) => a.uyarilar.find((u) => u.startsWith('nginx_bellek_artisi('));
  const var_ = (await t3Analiz(k, { donustur: (d) => bellekEkle(d, artan) })).analiz;
  const u = sizinti(var_);
  assert.ok(u, var_.uyarilar.join(' | '));
  const m = /^nginx_bellek_artisi\(ilk=(\d+)MB,son=(\d+)MB,kosu_sonu=(\d+)MB\)$/.exec(u);
  assert.ok(m && Number(m[2]) - Number(m[1]) >= 50 && Number(m[3]) >= Number(m[2]), u);
  assert.ok(NEDEN_KALIPLARI.some((x) => x.kod === 'nginx_bellek_artisi' && x.re.test(u)));
  assert.ok(!var_.adimlar.some((s) => s.ham.uyarilar.some((x) => x.startsWith('nginx_bellek_artisi'))), 'adim uyarisi degil');
  // Kosu sonu geri indi (son ornek ilk degere dondu): uyari yok.
  assert.equal(sizinti((await t3Analiz(k, { donustur: (d) => bellekEkle(d, artan, { son: 100 * 1024 }) })).analiz), undefined);
  // Artis 50 MB'tan az (saniyede ~0,05 MB: ~22 MB).
  assert.equal(sizinti((await t3Analiz(k, { donustur: (d) => bellekEkle(d, (t) => 100 * 1024 + (t - t0) * 50) })).analiz), undefined);
  // Oran %20'den az (2 GB taban + ayni ~90 MB artis).
  assert.equal(sizinti((await t3Analiz(k, { donustur: (d) => bellekEkle(d, (t) => 2048 * 1024 + (t - t0) * 200) })).analiz), undefined);
  // Monoton degil: kaydin orta ucte birinde RSS 150 MB duser (son adimlar ve kosu sonu yine yuksek).
  const dalgali = (x, i, n) => artan(x) - (i > n / 3 && i < (2 * n) / 3 ? 150 * 1024 : 0);
  const d3 = (await t3Analiz(k, { donustur: (d) => bellekEkle(d, dalgali) })).analiz;
  const noktalar = d3.adimlar.map((s) => s.ham.bellek.nginx_rss_ort_mb);
  assert.ok(noktalar.some((v, i) => i > 0 && v < noktalar[i - 1]), `kurgu monoton olmamali: ${noktalar.join(',')}`);
  assert.equal(sizinti(d3), undefined, noktalar.join(','));
  // Kayitsiz kosu: uyari yok (cikti birebir eskisi; AN-B1).
  assert.equal(sizinti((await t3Analiz(k)).analiz), undefined);
});

test('AN-K1 istemci JSON kodlama -> ham.kodlama; bozuk / kodlamasiz JSON: anahtar yok, OKUNAMADI degil; geri kalan birebir', async () => {
  const k = standart('R124');
  const kd = { br: 900, gzip: 0, deflate: 0, zstd: 0, yok: 100, diger: 0, yok_1kb_alti: 80 };
  const a = (await t3Analiz(k, { donustur: (d) => kodlamaEkle(d, () => kd) })).analiz;
  assert.ok(a.adimlar.length > 0 && a.adimlar.every((s) => JSON.stringify(s.ham.kodlama) === JSON.stringify(kd)), JSON.stringify(a.adimlar[0].ham));
  const eski = (await t3Analiz(k)).analiz;
  assert.deepEqual(yeniAlanlarsiz(a), yeniAlanlarsiz(eski));
  // Eski yuk_k6.js JSON'u (kodlama yok) ve bozuk JSON: anahtar yok.
  const kodsuz = (await t3Analiz(k, { donustur: (d) => kodlamaEkle(d, () => null) })).analiz;
  assert.ok(kodsuz.adimlar.every((s) => !('kodlama' in s.ham)));
  const bozuk = (await t3Analiz(k, {
    donustur: (d) => {
      const out = kodlamaEkle(d, () => kd);
      for (const [ad, f] of out) if (/^istemci_.*_100_r1\.json$/.test(ad)) out.set(ad, { ...f, icerik: '{"tur": "x", "kodlama": {' });
      return out;
    },
  })).analiz;
  const t = turla(bozuk);
  assert.ok(!('kodlama' in t.get('R124_K_yeni_br_100_r1').ham));
  assert.ok('kodlama' in t.get('R124_K_yeni_br_100_r2').ham);
  // Negatif / ondalik sayac null olur (gorunum 0 sayar).
  const tuhaf = (await t3Analiz(k, { donustur: (d) => kodlamaEkle(d, () => ({ ...kd, br: -1, gzip: 1.5 })) })).analiz;
  assert.deepEqual([tuhaf.adimlar[0].ham.kodlama.br, tuhaf.adimlar[0].ham.kodlama.gzip], [null, null]);
});

test('AN-KS karisik surum: eski Portal (6e33e5a) yeni dosyalari reddetmez, ciktisi ayni; yeni Portal eski dizinde eskiyle ayni', async (t) => {
  const { execFileSync } = require('node:child_process');
  const kok = path.join(__dirname, '..', '..', '..');
  const eskiDizin = path.join(KOK, 'eski-portal');
  try {
    fs.mkdirSync(eskiDizin, { recursive: true });
    for (const ad of ['sonuc.cjs', 'analiz.cjs']) {
      fs.writeFileSync(path.join(eskiDizin, ad), execFileSync('git', ['show', `6e33e5a:server/nginx-loadtest/${ad}`], { cwd: kok }));
    }
  } catch (e) {
    t.skip(`6e33e5a okunamadi (git yok ya da sig klon): ${e.message}`);
    return;
  }
  const eskiSonuc = require(path.join(eskiDizin, 'sonuc.cjs'));
  const eskiAnaliz = require(path.join(eskiDizin, 'analiz.cjs'));
  // HEAD (eski) okuyucusunda yeni adlar YOK: bellek_ / yukcpu_ desenleri ve istemci JSON'u okunmaz (yalniz ozetlenir).
  const kaynak = fs.readFileSync(path.join(eskiDizin, 'sonuc.cjs'), 'utf8');
  assert.ok(!/bellek_|yukcpu_/.test(kaynak), 'eski okuyucu bellek_ / yukcpu_ desenini taniyor olmamali');
  assert.match(kaynak, /\[\/\^\(hatali_\)\?istemci_\.\*\\\.json\$\/, 'yalniz_ozet'\]/);
  const k = standart('R125');
  const yeniPlaybook = (d) => kodlamaEkle(yukBellekEkle(yukCpuEkle(bellekEkle(d, (x) => 100 * 1024 + (x - 1800000000) * 100), () => 600)), () => ({ br: 9, gzip: 0, deflate: 0, zstd: 0, yok: 1, diger: 0, yok_1kb_alti: 1 }));
  const yaz = (ad, donustur) => portalDuzeniYaz(path.join(KOK, `ks-${ad}`), donustur(k.dosyalar({})));
  const dYeni = yaz('yeni', yeniPlaybook);
  const dEski = yaz('eski', (d) => d);
  const sums = fs.readFileSync(path.join(dYeni, 'SHA256SUMS'), 'utf8');
  for (const ad of ['bellek_R125_test.csv', 'yukcpu_R125_ymak01.csv', 'istemci_R125_K_yeni_br_100_r1.json']) assert.ok(sums.includes(`  ${ad}\n`), `${ad} SHA256SUMS'ta`);
  const vY = await eskiSonuc.kosuDiziniOku(dYeni, { adim: 'R125' });
  const vE = await eskiSonuc.kosuDiziniOku(dEski, { adim: 'R125' });
  assert.equal(vY.sha256.durum, 'dogrulandi');
  assert.ok(vY.sha256.dosya_sayisi > vE.sha256.dosya_sayisi);
  const temiz = (an) => ({ ...an, ozet: { ...an.ozet, okunan_bayt: null, sha256: null } });
  const aY = eskiAnaliz.kosuAnaliz(vY, { adim: 'R125' });
  const aE = eskiAnaliz.kosuAnaliz(vE, { adim: 'R125' });
  assert.deepEqual(temiz(aY), temiz(aE), 'eski Portal: yeni dosyalarla analiz ayni');
  // (b) yeni Portal + eski playbook dizini: eski Portal'in analiziyle ayni (bellek / kodlama / yuk alanlari yok).
  const nE = kosuAnaliz(await sonuc.kosuDiziniOku(dEski, { adim: 'R125' }), { adim: 'R125' });
  assert.deepEqual(temiz(nE), temiz(aE), 'yeni Portal eski playbook dizininde eski ciktiyi uretir');
});

// ---------------------------------------------------------------------------------------------
// Tek hedef modeli (2026-11-13): nginx olmayan SUNUCU hedefi (kosuAnaliz hedefNginx:false; playbook yuk_cpu_kaydedici.sh
// ROL=hedef -> hedefcpu_*, yukcpu_ ile ayni sema).
//   AN-NX1 sunucu + hedefNginx false: host CPU ortalamasi / en yuksegi adimda, > %90 DOYMA (doyma:host_cpu_), cpu_ms_istek
//          ve kapasite null, log / sunucu_ / bellek yok sayilir (dosya varsa uyari), kosu uyarisi nginx_yok(...);
//          ozet.hedef_nginx false + hedef_cpu_kesitler + nproc; karar CPU'suz yoldan (adayNginx false: KALICI yok)
//   AN-NX2 secenek yoksa (true) ya da serbest hedefte hedefcpu_ dosyalari analize girmez: cikti BIREBIR eskisi;
//          gecersiz secenek TypeError
//   AN-NX3 kayit yok / bozuk: kosu uyarisi, adimlar olcumsuz, kosu OKUNAMADI olmaz
//   AN-NX4 kesit var ama bir TUR'un penceresinde ornek yok: o adimda host_cpu_ort null + 'hedef_cpu_olculemedi'
//          adim uyarisi (docs 5.3), diger adimlar etkilenmez (mutasyon: push satiri silinince kirmizi)
// ---------------------------------------------------------------------------------------------
/** yukCpuEkle ile uretilen yukcpu_* dosyalarini hedefcpu_* adina tasir (ayni sema). */
function hedefCpuEkle(dosyalar, bosta, ek = {}) {
  const y = yukCpuEkle(dosyalar, bosta, { host: 'GBJWLT01', ...ek });
  const out = new Map();
  for (const [ad, v] of y) out.set(dosyalar.has(ad) ? ad : ad.replace(/^yukcpu_/, 'hedefcpu_'), v);
  return out;
}
const NGINXSIZ = { hedefTuru: 'sunucu', hedefNginx: false };

test('AN-NX1 nginx olmayan sunucu hedefi: host CPU, DOYMA > %90, istek basina CPU yok, uyari ve ozet, karar CPUsuz', async () => {
  const bosta = (tur) => (tur.endsWith('_400_r1') ? 50 : 600);
  const { veri, analiz: a } = await t3Analiz(standart('R130'), { donustur: (d) => hedefCpuEkle(serbestDosyalari(d), bosta), secenek: NGINXSIZ });
  assert.deepEqual(veri.hedefCpuKesitler.map((x) => [x.anahtar, x.bilgiVar]), [['R130_GBJWLT01', true]]);
  assert.deepEqual(veri.yukKesitler, []);
  const t = turla(a);
  const d = t.get('R130_K_yeni_br_400_r1');
  assert.equal(d.gecerlilik, 'DOYMA');
  assert.deepEqual(d.nedenler, ['doyma:host_cpu_%95.0(>%90)']);
  assert.ok(NEDEN_KALIPLARI.some((x) => x.kod === 'doyma_host_cpu' && x.re.test(d.nedenler[0])));
  const g = t.get('R130_K_yeni_br_100_r1');
  assert.equal(g.gecerlilik, 'GECERLI');
  assert.ok(Math.abs(g.host_cpu_ort - 40) < 1e-9, String(g.host_cpu_ort));
  assert.ok(Math.abs(g.ham.host_cpu_max - 40) < 1e-9, String(g.ham.host_cpu_max));
  for (const x of a.adimlar) {
    assert.equal(x.cpu_ms_istek, null, x.tur);
    assert.equal(x.kapasite_rps, null, x.tur);
    assert.equal(x.istek_sunucu, null, x.tur);
  }
  for (const gr of a.ozet.gruplar) assert.equal(gr.kapasite_tahmini_rps, null);
  assert.ok(a.uyarilar.includes('nginx_yok(istek_basina_cpu_ve_kapasite_yok)'), a.uyarilar.join('|'));
  assert.ok(!a.uyarilar.includes('sunucu_olcumu_yok(serbest_hedef)'));
  assert.ok(!a.uyarilar.some((u) => /^sunucu_kaydi_yok|^sunucu_logu_yok/.test(u)), a.uyarilar.join('|'));
  assert.equal(a.ozet.hedef_nginx, false);
  assert.equal(a.ozet.nproc, 16);
  assert.equal(a.ozet.hedef_cpu_host, undefined);
  assert.deepEqual(a.ozet.hedef_cpu_kesitler, [{ anahtar: 'R130_GBJWLT01', ornek: veri.hedefCpuKesitler[0].ornekler.length, bilgi_var: true, nproc: 16 }]);
  assert.deepEqual(a.ozet.loglar, []);
  aciklamali(a);
  // Dizinde yine de nginx dosyalari (sunucu_ / log_) varsa yok sayilir ve sayisi soylenir; sonuc ayni.
  const karisik = await t3Analiz(standart('R130'), { donustur: (d) => hedefCpuEkle(d, bosta), secenek: NGINXSIZ });
  assert.ok(karisik.analiz.uyarilar.some((u) => /^nginxsiz_kosuda_sunucu_dosyalari_yok_sayildi\(\d+\)$/.test(u)), karisik.analiz.uyarilar.join('|'));
  assert.deepEqual(karisik.analiz.adimlar.map((x) => [x.tur, x.gecerlilik, x.host_cpu_ort, x.cpu_ms_istek]), a.adimlar.map((x) => [x.tur, x.gecerlilik, x.host_cpu_ort, x.cpu_ms_istek]));
  // Karar: nginx'siz taraf CPU'suz yol (host CPU kademe kararina girmez), KALICI yok; iki yonde de.
  for (const s of [{ adayNginx: false }, { refNginx: false }, { refNginx: false, adayNginx: false }]) {
    const k = kararVer(a.adimlar, a.adimlar, s);
    assert.notEqual(k.karar, 'KALICI', JSON.stringify(s));
    assert.ok(k.nedenler.some((n) => n.includes(CPU_YOK_NGINXSIZ)), k.nedenler.join('|'));
  }
  // Varsayilan (true) karar BIREBIR eskisi.
  assert.deepEqual(kararVer(a.adimlar, a.adimlar, { refNginx: true, adayNginx: true }), kararVer(a.adimlar, a.adimlar));
  assert.throws(() => kararVer(a.adimlar, a.adimlar, { adayNginx: 'hayir' }), TypeError);
});

test('AN-NX2 secenek yoksa ya da serbest hedefte hedefcpu_ dosyalari analize girmez (cikti birebir); gecersiz secenek TypeError', async () => {
  const bosta = () => 50;
  const temiz = (an) => JSON.parse(JSON.stringify({ ...an, ozet: { ...an.ozet, sha256: null, okunan_bayt: null } }));
  // Sunucu + secenek yok / true: nginx kosusu (hedefcpu_ sunucu kesiti DEGIL).
  const sn = await t3Analiz(standart('R132'), { donustur: (d) => hedefCpuEkle(d, bosta), secenek: { hedefTuru: 'sunucu' } });
  const st = await t3Analiz(standart('R132'), { donustur: (d) => hedefCpuEkle(d, bosta), secenek: { hedefTuru: 'sunucu', hedefNginx: true } });
  const sz = await t3Analiz(standart('R132'), { secenek: { hedefTuru: 'sunucu' } });
  assert.deepEqual(temiz(sn.analiz), temiz(sz.analiz));
  assert.deepEqual(temiz(st.analiz), temiz(sz.analiz));
  assert.equal(sz.analiz.ozet.hedef_nginx, undefined);
  // Serbest hedefte secenek yok sayilir (sunucu tarafi zaten yok).
  const ile = await t3Analiz(standart('R131'), { donustur: (d) => hedefCpuEkle(serbestDosyalari(d), bosta), secenek: { hedefTuru: 'serbest', hedefNginx: false } });
  const siz = await t3Analiz(standart('R131'), { donustur: (d) => serbestDosyalari(d), secenek: { hedefTuru: 'serbest' } });
  assert.deepEqual(temiz(ile.analiz), temiz(siz.analiz));
  for (const x of ile.analiz.adimlar) assert.equal(x.host_cpu_ort, null);
  for (const kotu of [null, 'false', 0]) {
    assert.throws(() => kosuAnaliz(sz.veri, { adim: 'R132', hedefNginx: kotu }), TypeError, String(kotu));
  }
});

test('AN-NX4 hedef CPU kesiti bir TURun penceresini kapsamiyor: o adimda hedef_cpu_olculemedi, digerleri olculu', async () => {
  const bosta = () => 600;
  const tam = (await t3Analiz(standart('R135'), { donustur: (d) => hedefCpuEkle(serbestDosyalari(d), bosta), secenek: NGINXSIZ })).analiz;
  const hedefTur = 'R135_K_yeni_br_250_r1';
  assert.ok(tam.adimlar.some((x) => x.tur === hedefTur), tam.adimlar.map((x) => x.tur).join('|'));
  const { analiz: a } = await t3Analiz(standart('R135'), {
    donustur: (d) => hedefCpuEkle(serbestDosyalari(d), bosta, { atla: (_t, tur) => tur === hedefTur }),
    secenek: NGINXSIZ,
  });
  const t = turla(a);
  const d = t.get(hedefTur);
  assert.equal(d.host_cpu_ort, null);
  assert.ok(d.ham.uyarilar.includes('hedef_cpu_olculemedi'), JSON.stringify(d.ham.uyarilar));
  for (const x of a.adimlar) {
    if (x.tur === hedefTur) continue;
    const y = turla(tam).get(x.tur);
    assert.deepEqual([x.host_cpu_ort, x.gecerlilik], [y.host_cpu_ort, y.gecerlilik], x.tur);
    assert.ok(x.host_cpu_ort != null, x.tur);
    assert.ok(!x.ham.uyarilar.includes('hedef_cpu_olculemedi'), x.tur);
  }
  // Tam kesitte hicbir adimda uyari yok.
  for (const x of tam.adimlar) assert.ok(!x.ham.uyarilar.includes('hedef_cpu_olculemedi'), x.tur);
});

test('AN-NX3 hedef CPU kaydi yok / bozuk: kosu uyarisi, adimlar olcumsuz, OKUNAMADI yok', async () => {
  const yok = (await t3Analiz(standart('R133'), { donustur: (d) => serbestDosyalari(d), secenek: NGINXSIZ })).analiz;
  assert.ok(yok.uyarilar.includes('hedef_cpu_kaydi_yok'), yok.uyarilar.join('|'));
  assert.ok(yok.uyarilar.includes('nginx_yok(istek_basina_cpu_ve_kapasite_yok)'));
  assert.deepEqual(yok.ozet.hedef_cpu_kesitler, []);
  for (const x of yok.adimlar) assert.equal(x.host_cpu_ort, null);
  const { veri, analiz: bozuk } = await t3Analiz(standart('R134'), {
    donustur: (d) => new Map([...serbestDosyalari(d), ['hedefcpu_R134_GBJWLT01.csv', { icerik: '1800000000,1,0,0,1,0,0,0,0\n', py: false, portal: true, log: false }]]),
    secenek: NGINXSIZ,
  });
  assert.match(veri.hedefCpuKesitler[0].sorun, /eksik kolon/);
  assert.ok(bozuk.uyarilar.includes('hedef_cpu_kaydi_bozuk'), bozuk.uyarilar.join('|'));
  for (const x of bozuk.adimlar) assert.equal(x.host_cpu_ort, null);
  assert.notEqual(bozuk.gecerlilik, 'OKUNAMADI');
});
