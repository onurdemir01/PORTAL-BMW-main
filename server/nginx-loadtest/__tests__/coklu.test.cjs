// server/nginx-loadtest/__tests__/coklu.test.cjs - Yuk Testi "Coklu karsilastirma" (2026-11-04).
//
// SAF (gercek analiz.cjs + gorunum.cjs, DB yok):
//   CK1 analiz.farkDurumu: kararVer'in gurultu x3 / esik kurali hucre basina (CPU-ms iyi / kotu / gurultu ici, p95, hata
//       artisi, kurali olmayan olcu 'renklendirilmez', eksik taraf 'yok'); gurultuEsigi = max(esik, 3 x gurultu)
//   CK2 cokluKarsilastir: aday basina kararVer (KALICI / NOTR), hiz basina ozet, gurultu ici / disi farklar, kademe farki
//   CK3 uyumsuz grup: hedef turu / hedef / motor / wrk tavani / is parcacigi ve VERI_YOK, neden koduyla (protokol farki
//       artik kiyas grubunda: CK11);
//       uyumsuz aday icin kararVer CAGRILMAZ
//   CK4 eski kosu: bant / bellek / kip alanlari null / 'olculmedi'; PSS yoksa RSS; PSS ile RSS arasi yuzde verilmez
// ROUTER (gercek index.cjs; db / kimlik / gorunurluk / denetim sahte):
//   CK5 GET /karsilastir-coklu: 16 siniri (ref dahil; ref listede yoksa eklenir), 400 durumlari, 409 kosu_yok (eksik
//       listesi; on kontrol), kosu ve adim SQL'i TEK sorgu (IN listesi parametreli), kararVer secenekleri satirdan
//   CK6 yetki: Admin olmayan GET /karsilastir-coklu'yu okur; PUT /kosular/:id/etiket 403 ve DB'ye dokunmaz
//   CK7 PUT /kosular/:id/etiket: girdi kapisi (tip, 120 karakter, kontrol karakteri), bos = NULL, 409 kosu_yok,
//       parametreli UPDATE, denetim kaydi (eski / yeni)
// -- inceleme 2026-11-04 --
//   CK8 farkDurumu kor noktalari: p95 kotulesme esigi 3 x gurultu (esikZarar degil), adayda n_5xx tek basina kotu,
//       sunucu tarafi 429 / 5xx (gecersiz_nedeni; istemci sayaci 0) kotu = kararVer'in RET kurali (uctan uca ayni)
//   CK9 kademeFarki: p95 / bant / bellek / hata p95 kademesinden, CPU CPU kademesinden (kademeler farkliyken)
//   CK10 router: 10 haneli / INT ustu numara 400 (DB yok); 409 listeleri ayri: eksik (bulunamayan) / onKontrol / bitmemis (QUEUED /
//       RUNNING / FINALIZING); yalniz on kontrol / bitmemis -> kosu_uygun_degil; FAILED kosu karsilastirilir
// -- tek tabloda karsilastirma 2026-11-04 --
//   CK11 h1 ref + h2 aday kiyas grubunda; ref protokolu iki taraf icin gecer; iki kosulu kararVer protokol farkinda hala VERI_YOK
//   CK12 ka vs yeni, br vs gzip vs identity kiyas grubunda; fark adayin KENDI kombosundaki hiz degerlerinden; kaynak adimlar
//        degismez; ilk neden gercek kip / ae degerlerini yazar; meta kip / ae / sunucuAyar (dizin yok)
//   CK13 senaryo K/B ya da senaryo_id farki 'senaryo' koduyla karsilastirilamaz, kararVer cagrilmaz; bilinmeyen id gecer
//   CK14 ortak kombo varsa kararVer'in secimi korunur (etiketleme yok); router uctan uca h2 + gzip aday
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');

function sahte(rel, exports) {
  const p = Module._resolveFilename(path.join(__dirname, rel), module);
  require.cache[p] = { id: p, filename: p, loaded: true, exports };
}

const analiz = require('../analiz.cjs');
const gorunum = require('../gorunum.cjs');
const coklu = require('../coklu.cjs');

// ── yardimcilar ─────────────────────────────────────────────────────────────────────────
/** DB adim satiri (snake; nedenler / ham JSON metni). */
function adim(kid, hiz, r, o = {}) {
  const ham = { adim: `R${kid}`, ...(o.ham || {}) };
  return {
    id: kid * 1000 + hiz * 10 + r, kosu_id: kid, tur: `R${kid}_K_yeni_br_${hiz}_r${r}`, senaryo: 'K', kip: 'yeni', ae: 'br', hiz, deneme: r,
    gecerlilik: o.g || 'GECERLI', nedenler: JSON.stringify(o.nedenler || []), p50: 5, p95: o.p95 ?? 20, p99: o.p99 ?? 40, cpu_ms_istek: o.cpu ?? 1.0,
    hata_orani: o.hata ?? 0, n_429: o.n429 ?? 0, n_5xx: 0, host_cpu_ort: o.hostCpu ?? 30, kapasite_rps: o.kapasite ?? 8000 / (o.cpu ?? 1.0),
    gercek_rps: hiz, bayt_istek: 5000, ham: JSON.stringify(ham),
  };
}
const deve = (k) => k.replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase());
const gorunumu = (r) => {
  const o = {};
  for (const [k, v] of Object.entries(r)) o[k === 'nedenler' || k === 'ham' ? k : deve(k)] = k === 'nedenler' || k === 'ham' ? JSON.parse(v) : v;
  return gorunum.adimGorunumu(o, {});
};
const analizi = (r) => ({ ...r, nedenler: JSON.parse(r.nedenler), ham: JSON.parse(r.ham) });
function kosu(id, adimlar, m = {}) {
  const { motor = 'k6', protokol = 'h1', parametreler = {}, ...satir } = m;
  return {
    meta: coklu.kosuMeta({ id, etiket: `E${id}`, hedef_host: 'GBNGXT33', hedef_ip: '10.0.0.9', hedef_turu: 'sunucu', ...satir }, { motor, protokol, parametreler }),
    analizAdimlari: adimlar.map(analizi), gorunumAdimlari: adimlar.map(gorunumu),
  };
}
/** Iki hizda (100, 200) iki tekrar: CPU ve p95 degerleri [h100r1, h100r2, h200r1, h200r2]. */
function dortAdim(kid, cpu, p95 = [20, 20, 30, 30], ek = {}) {
  return [adim(kid, 100, 1, { cpu: cpu[0], p95: p95[0], ...ek }), adim(kid, 100, 2, { cpu: cpu[1], p95: p95[1], ...ek }),
    adim(kid, 200, 1, { cpu: cpu[2], p95: p95[2], ...ek }), adim(kid, 200, 2, { cpu: cpu[3], p95: p95[3], ...ek })];
}
const YENI_HAM = { ag: { test_alinan_bps: 1.2e8, test_gonderilen_bps: 7e6 }, bellek_detay: { t0: 1, pss_ort_mb: 50, anon_ort_mb: 30, son: { t: 2, anon_mb: 31 } }, bellek: { nginx_rss_ort_mb: 400 } };

test('CK1 farkDurumu: kararVer kurali hucre basina; gurultuEsigi', () => {
  assert.equal(analiz.gurultuEsigi(10, null), 0.1);
  assert.equal(analiz.gurultuEsigi(10, 0.05), 0.15000000000000002);
  assert.equal(analiz.gurultuEsigi(5, 0.01), 0.05);
  const g = (o) => ({ cpu_ms_istek: 1, gurultu_cpu: 0.02, p95: 100, gurultu_p95: 0.02, hata_max: 0, n_429: 0, n_5xx: 0, p99: 200, host_cpu_ort: 40, ...o });
  // CPU: %12 az (esik max(10, 3x2=6) = 10) -> iyi; %8 az -> gurultu ici; %7 cok (zarar esigi max(5, 6) = 6) -> kotu.
  assert.equal(analiz.farkDurumu('cpu_ms_istek', g(), g({ cpu_ms_istek: 0.88 })).durum, 'iyi');
  assert.equal(analiz.farkDurumu('cpu_ms_istek', g(), g({ cpu_ms_istek: 0.92 })).durum, 'gurultu_ici');
  assert.equal(analiz.farkDurumu('cpu_ms_istek', g(), g({ cpu_ms_istek: 1.07 })).durum, 'kotu');
  assert.equal(analiz.farkDurumu('cpu_ms_istek', g(), g({ cpu_ms_istek: 1.055 })).durum, 'gurultu_ici', 'zarar esigi 3 x gurultu (%6)');
  // Gurultu buyukse esik buyur: gurultu %5 -> iyilesme esigi %15; %12 az artik gurultu ici.
  const gurultulu = g({ gurultu_cpu: 0.05 });
  const d = analiz.farkDurumu('cpu_ms_istek', gurultulu, g({ cpu_ms_istek: 0.88 }));
  assert.deepEqual([d.durum, Math.round(d.esikYuzde), Math.round(d.yuzde)], ['gurultu_ici', 15, -12]);
  // Esik secenegi: esikCpu 5 -> %8 az iyi (3 x %2 = %6 < %8).
  assert.equal(analiz.farkDurumu('cpu_ms_istek', g(), g({ cpu_ms_istek: 0.92 }), { esikCpu: 5 }).durum, 'iyi');
  // Tek tekrar: gurultu bilinmiyor (0 kabul, kararVer gibi) ve isaretli.
  const t = analiz.farkDurumu('cpu_ms_istek', g({ gurultu_cpu: null }), g({ cpu_ms_istek: 0.85 }));
  assert.deepEqual([t.durum, t.gurultuBilinmiyor], ['iyi', true]);
  // p95: %11 az iyi, %6 cok kotu (zarar esigi %6), %4 cok gurultu ici.
  assert.equal(analiz.farkDurumu('p95', g(), g({ p95: 89 })).durum, 'iyi');
  assert.equal(analiz.farkDurumu('p95', g(), g({ p95: 106.5 })).durum, 'kotu');
  assert.equal(analiz.farkDurumu('p95', g(), g({ p95: 104 })).durum, 'gurultu_ici');
  // Hata: ref + %0.1'i asan artis ya da 429 kotu; iyilesme kurali yok (gurultu ici).
  assert.equal(analiz.farkDurumu('hata_orani', g(), g({ hata_max: 0.002 })).durum, 'kotu');
  assert.equal(analiz.farkDurumu('hata_orani', g(), g({ hata_max: 0.0009 })).durum, 'gurultu_ici');
  assert.equal(analiz.farkDurumu('hata_orani', g(), g({ n_429: 3 })).durum, 'kotu');
  assert.equal(analiz.farkDurumu('hata_orani', g({ hata_max: 0.01 }), g({ hata_max: 0 })).durum, 'gurultu_ici');
  // Kurali olmayan olcu: yuzde var, renk yok.
  const p99 = analiz.farkDurumu('p99', g(), g({ p99: 100 }));
  assert.deepEqual([p99.durum, p99.yuzde], ['renklendirilmez', -50]);
  assert.equal(analiz.farkDurumu('host_cpu_ort', g(), g({ host_cpu_ort: 90 })).durum, 'renklendirilmez');
  // Eksik taraf / olculmeyen.
  assert.equal(analiz.farkDurumu('p95', g(), null).durum, 'yok');
  assert.equal(analiz.farkDurumu('cpu_ms_istek', g({ cpu_ms_istek: null }), g()).durum, 'yok');
  assert.equal(analiz.farkDurumu('p99', g(), g({ p99: null })).durum, 'yok');
  assert.deepEqual([...analiz.FARK_KURALLI], ['cpu_ms_istek', 'p95', 'hata_orani']);
});

test('CK2 cokluKarsilastir: aday basina kararVer, hiz ozeti, gurultu ici / disi, kademe farki', () => {
  const ref = kosu(1, dortAdim(1, [1.0, 1.02, 1.0, 1.02], [20, 20, 30, 30.5], { ham: YENI_HAM }));
  const iyi = kosu(2, dortAdim(2, [0.8, 0.81, 0.8, 0.81], [20, 20, 30, 30], { ham: YENI_HAM }));
  const ayni = kosu(3, dortAdim(3, [1.01, 1.0, 1.01, 1.0], [20, 20.2, 30.2, 30], { ham: YENI_HAM }));
  const r = coklu.cokluKarsilastir({ ref, adaylar: [iyi, ayni], analiz });
  assert.equal(r.karsilastirilamaz.length, 0);
  assert.deepEqual(r.adaylar.map((a) => [a.id, a.karar]), [[2, 'KALICI'], [3, 'NOTR']]);
  assert.deepEqual(r.ref.hizlar.map((h) => h.hiz), [100, 200]);
  assert.deepEqual(r.ref.kombinasyon, { senaryo: 'K', kip: 'yeni', ae: 'br' });
  const h200 = r.adaylar[0].hizlar.find((h) => h.hiz === 200);
  assert.equal(h200.fark.cpuMsIstek.durum, 'iyi');
  assert.equal(Math.round(h200.fark.cpuMsIstek.yuzde), -20);
  assert.equal(h200.fark.p95.durum, 'gurultu_ici');
  assert.equal(h200.fark.p99.durum, 'renklendirilmez');
  assert.deepEqual([h200.tekrar, h200.gecerliTekrar, h200.gecerlilik], [2, 2, 'GECERLI']);
  assert.equal(r.adaylar[1].hizlar.find((h) => h.hiz === 200).fark.cpuMsIstek.durum, 'gurultu_ici');
  // Kademe farki: CPU kademesi ortak hizlarin ortasi (200), p95 en yuksek ortak hiz (200); ref degeri yaninda.
  const kf = r.adaylar[0].kademeFarki;
  assert.deepEqual([kf.cpu.hiz, kf.cpu.durum, kf.p95.hiz, kf.p95.durum], [200, 'iyi', 200, 'gurultu_ici']);
  assert.equal(kf.cpu.ref, 1.01);
  assert.equal(kf.cpu.aday, 0.805);
  assert.deepEqual([kf.bant.aday, kf.bant.durum, kf.bellek.aday, kf.bellek.durum], [1.2e8, 'renklendirilmez', 50, 'renklendirilmez']);
  // Gurultu disi kotulesme: p95 %20 artis -> RET ve kotu.
  const kotu = kosu(4, dortAdim(4, [1.0, 1.0, 1.0, 1.0], [24, 24, 36, 36]));
  const r2 = coklu.cokluKarsilastir({ ref, adaylar: [kotu], analiz });
  assert.equal(r2.adaylar[0].karar, 'RET');
  assert.equal(r2.adaylar[0].hizlar.find((h) => h.hiz === 200).fark.p95.durum, 'kotu');
  assert.deepEqual(r2.esikler, { esikCpu: 10, esikP95: 10, esikZarar: 5 });
  // Esikler kararVer'e AYNEN gider (esikCpu 25: %20 kazanc artik KALICI degil).
  const r3 = coklu.cokluKarsilastir({ ref, adaylar: [iyi], analiz, esikler: { esikCpu: 25 } });
  assert.equal(r3.adaylar[0].karar, 'NOTR');
  assert.equal(r3.adaylar[0].hizlar.find((h) => h.hiz === 200).fark.cpuMsIstek.durum, 'gurultu_ici');
  assert.equal(r3.esikler.esikCpu, 25);
});

test('CK3 uyumsuz grup: neden kodlari, VERI_YOK; uyumsuz aday icin kararVer cagrilmaz', () => {
  const ref = kosu(1, dortAdim(1, [1, 1, 1, 1]));
  const adaylar = [
    kosu(2, dortAdim(2, [1, 1, 1, 1]), { motor: 'wrk' }),
    kosu(4, dortAdim(4, [1, 1, 1, 1]), { hedef_host: 'GBNGXT34' }),
    kosu(5, dortAdim(5, [1, 1, 1, 1]), { hedef_turu: 'serbest', hedef_host: '', hedef_ip: '10.0.0.9' }),
    kosu(6, [adim(6, 999, 1)]),
    kosu(7, dortAdim(7, [1, 1, 1, 1])),
  ];
  const cagri = [];
  const izli = { ...analiz, kararVer: (...a) => { cagri.push(a[2]); return analiz.kararVer(...a); } };
  const r = coklu.cokluKarsilastir({ ref, adaylar, analiz: izli });
  assert.deepEqual(r.adaylar.map((a) => a.id), [7]);
  const kod = Object.fromEntries(r.karsilastirilamaz.map((k) => [k.id, k.nedenler.map((n) => n.kod)]));
  assert.deepEqual(kod, { 2: ['motor'], 4: ['hedef'], 5: ['hedef_turu', 'hedef'], 6: ['veri_yok'] });
  assert.match(r.karsilastirilamaz.find((k) => k.id === 6).nedenler[0].metin, /^Karşılaştırılacak ortak ölçüm yok \(/);
  assert.equal(r.karsilastirilamaz.find((k) => k.id === 6).karar, 'VERI_YOK');
  // Uyumsuz (2, 4, 5) icin kararVer cagrilmadi; 6 (VERI_YOK) ve 7 icin cagrildi, secenekler satirdan.
  assert.equal(cagri.length, 2);
  assert.deepEqual(cagri[0], {
    refMotor: 'k6', adayMotor: 'k6', refHedefTuru: 'sunucu', adayHedefTuru: 'sunucu', refIsParcacigi: null, adayIsParcacigi: null,
    refTavanRps: null, adayTavanRps: null, refProtokol: 'h1', adayProtokol: 'h1',
  });
  // wrk: farkli tavan / is parcacigi; bilinmeyen (null) taraf karsilastirilmaz.
  const wref = kosu(10, dortAdim(10, [1, 1, 1, 1]), { motor: 'wrk', parametreler: { tavan_rps: 450, is_parcacigi: 2 } });
  const w = coklu.cokluKarsilastir({ ref: wref, analiz, adaylar: [
    kosu(11, dortAdim(11, [1, 1, 1, 1]), { motor: 'wrk', parametreler: { tavan_rps: 90, is_parcacigi: 2 } }),
    kosu(12, dortAdim(12, [1, 1, 1, 1]), { motor: 'wrk', parametreler: { tavan_rps: 450, is_parcacigi: 4 } }),
    kosu(13, dortAdim(13, [1, 1, 1, 1]), { motor: 'wrk', parametreler: {} }),
  ] });
  assert.deepEqual(w.karsilastirilamaz.map((k) => [k.id, k.nedenler.map((n) => n.kod)]), [[11, ['tavan']], [12, ['is_parcacigi']]]);
  assert.deepEqual(w.adaylar.map((a) => a.id), [13]);
  // kararVer hata atarsa (gecersiz secenek) aday 'hesaplanamadi' ile ayrilir, digerleri hesaplanir.
  const bozuk = { ...analiz, kararVer: () => { throw new TypeError('kararVer: refMotor gecersiz'); } };
  const b = coklu.cokluKarsilastir({ ref, adaylar: [kosu(20, dortAdim(20, [1, 1, 1, 1]))], analiz: bozuk });
  assert.deepEqual(b.karsilastirilamaz.map((k) => k.nedenler[0].kod), ['hesaplanamadi']);
});

test('CK4 eski kosu: bant / bellek null; PSS yoksa RSS; PSS-RSS arasi yuzde yok; kip durumu', () => {
  const ref = kosu(1, dortAdim(1, [1, 1, 1, 1], undefined, { ham: YENI_HAM }));
  const eski = kosu(2, dortAdim(2, [1, 1, 1, 1]));
  const rss = kosu(3, dortAdim(3, [1, 1, 1, 1], undefined, { ham: { bellek: { nginx_rss_ort_mb: 410 } } }));
  const r = coklu.cokluKarsilastir({ ref, adaylar: [eski, rss], analiz });
  const h = r.adaylar[0].hizlar[0];
  assert.deepEqual([h.bantBps, h.bellekMb, h.bellekKaynak, h.kip], [null, null, null, 'olculmedi']);
  assert.deepEqual([h.fark.bantBps.durum, h.fark.bantBps.yuzde, h.fark.bellekMb.durum], ['yok', null, 'yok']);
  assert.deepEqual([r.ref.hizlar[0].bantBps, r.ref.hizlar[0].bellekMb, r.ref.hizlar[0].bellekKaynak], [1.2e8, 50, 'pss']);
  const h3 = r.adaylar[1].hizlar[0];
  assert.deepEqual([h3.bellekMb, h3.bellekKaynak, h3.fark.bellekMb.durum, h3.fark.bellekMb.yuzde], [410, 'rss', 'yok', null]);
  // Kip dogrulamasi: ka kipinde yeni baglanti payi > %20 -> 'uyari' (gorunum.kipDogrulama); olcum yoksa 'olculmedi'.
  const ka = [adim(5, 100, 1, { ham: { yeniden_baglanti_yuzde: 50 } })].map((x) => ({ ...x, kip: 'ka' }));
  const e = coklu._ekOlculerForTest(ka.map(gorunumu), { senaryo: 'K', kip: 'ka', ae: 'br' }, 100);
  assert.equal(e.kip, 'uyari');
  // Kapasite yalniz GECERLI adimlardan (CPU kumesi); DOYMA adimin kapasitesi ortalamaya girmez.
  const k2 = [adim(6, 100, 1, { kapasite: 1000 }), adim(6, 100, 2, { kapasite: 3000, g: 'DOYMA', nedenler: ['doyma:host_cpu_92'] })];
  assert.equal(coklu._ekOlculerForTest(k2.map(gorunumu), { senaryo: 'K', kip: 'yeni', ae: 'br' }, 100).kapasite, 1000);
  assert.equal(coklu.MAX_KOSU, 16);
  assert.deepEqual(coklu.OLCULER, ['p95', 'p99', 'cpuMsIstek', 'hostCpu', 'hata', 'kapasite', 'bantBps', 'bellekMb']);
});

// ── ROUTER ─────────────────────────────────────────────────────────────────────────────
const D = { kosular: [], adimlar: [], sorgular: [], denetim: [], dbHata: null };
function sifirla() {
  Object.assign(D, { kosular: [], adimlar: [], sorgular: [], denetim: [], dbHata: null });
}
sahte('../../db/index.cjs', {
  query: async (sql, params = []) => {
    const q = String(sql).replace(/\s+/g, ' ').trim();
    D.sorgular.push({ q, params });
    if (D.dbHata) throw D.dbHata;
    let m = /^SELECT k\.id, k\.senaryo_id, k\.islem, k\.etiket, .* FROM nginx_loadtest_kosular k LEFT JOIN nginx_loadtest_senaryolar s ON s\.id = k\.senaryo_id WHERE k\.id IN \((\$\d+(?:, \$\d+)*)\)$/.exec(q);
    if (m) {
      const yer = m[1].split(', ').map((x) => Number(x.slice(1)));
      assert.deepEqual(yer, params.map((_, i) => i + 1), 'IN listesi $1..$n olmali');
      assert.ok(!/ sonuc,| on_kontrol_ozet/.test(q), 'buyuk JSON kolonu tasinmamali');
      return { rows: D.kosular.filter((k) => params.includes(k.id)).map((k) => ({ senaryo_ad: null, ...k })) };
    }
    m = /^SELECT \* FROM nginx_loadtest_adimlar WHERE kosu_id IN \((\$\d+(?:, \$\d+)*)\) ORDER BY kosu_id ASC, id ASC$/.exec(q);
    if (m) return { rows: D.adimlar.filter((a) => params.includes(a.kosu_id)).sort((a, b) => a.kosu_id - b.kosu_id || a.id - b.id) };
    if (/FROM nginx_loadtest_kosular k LEFT JOIN nginx_loadtest_senaryolar s ON s\.id = k\.senaryo_id WHERE k\.id = \$1$/.test(q)) {
      return { rows: D.kosular.filter((k) => k.id === params[0]).map((k) => ({ senaryo_ad: null, ...k })) };
    }
    if (/^UPDATE nginx_loadtest_kosular SET etiket = \$2 WHERE id = \$1$/.test(q)) {
      const k = D.kosular.find((x) => x.id === params[0]);
      if (k) k.etiket = params[1];
      return { rows: [], rowCount: k ? 1 : 0 };
    }
    throw new Error(`beklenmeyen sorgu: ${q}`);
  },
});
sahte('../../auth/index.cjs', { requireAuth: (req, res, next) => (req.session && req.session.user ? next() : res.status(401).json({ ok: false })) });
sahte('../../auth/visibility.cjs', { requireVisiblePrefix: () => (req, res, next) => next(), requireVisible: () => (req, res, next) => next() });
sahte('../../audit/index.cjs', { auditPortal: (req, eylem, o) => D.denetim.push({ eylem, ...o }) });

const yt = require('../index.cjs');
const router = yt._yonlendiriciKurForTest();
const ADMIN = { user: { username: 'onur', role: 'Admin' } };
const KULLANICI = { user: { username: 'veli', role: 'User' } };
function istek(method, url, { session = ADMIN, body } = {}) {
  const [yol, qs] = url.split('?');
  const query = Object.fromEntries(new URLSearchParams(qs || ''));
  return new Promise((resolve) => {
    const res = {
      statusCode: 200, body: null, headersSent: false,
      status(c) { this.statusCode = c; return this; },
      json(b) { this.body = b; this.headersSent = true; resolve(this); return this; },
      setHeader() {}, getHeader() {},
    };
    const req = { method, url, headers: {}, session, body, query, get path() { return yol; } };
    router.handle(req, res, (err) => resolve({ statusCode: 'sonraki', body: { err: err && err.message } }));
  });
}
function kosuSatiri(id, o = {}) {
  return { id, senaryo_id: 1, islem: 'kosu', etiket: `E${id}`, hedef_host: 'GBNGXT33', hedef_ip: '10.0.0.9', vhost: 'app.test.local', parametreler: JSON.stringify({ hizlar: [100, 200] }), durum: 'DONE', gecerlilik: 'GECERLI', created_by: 'onur', created_at: new Date('2026-11-03T22:00:00Z'), hedef_turu: 'sunucu', motor: 'k6', ...o };
}
function kosulariKur(n) {
  for (let i = 1; i <= n; i += 1) {
    D.kosular.push(kosuSatiri(i));
    D.adimlar.push(...dortAdim(i, [1 - i * 0.01, 1 - i * 0.01, 1 - i * 0.01, 1 - i * 0.01]));
  }
}

test('CK5 GET /karsilastir-coklu: 16 siniri, 400 / 409, tek sorgu, ozet', { timeout: 20000 }, async () => {
  sifirla();
  kosulariKur(18);
  // 15 aday + ref = 16: gecer; ref listede de olabilir (tekrar sayilmaz).
  let r = await istek('GET', `/karsilastir-coklu?ref=1&kosular=${Array.from({ length: 15 }, (_, i) => i + 2).join(',')}`);
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  assert.equal(r.body.adaylar.length, 15);
  assert.equal(r.body.ref.id, 1);
  // IKI sorgu: kosular ve adimlar (IN listesi, 16 parametre).
  assert.equal(D.sorgular.length, 2);
  assert.deepEqual(D.sorgular.map((s) => s.params.length), [16, 16]);
  r = await istek('GET', `/karsilastir-coklu?ref=1&kosular=1,${Array.from({ length: 15 }, (_, i) => i + 2).join(',')},2,3`);
  assert.equal(r.statusCode, 200, 'ref listede ve tekrarlar tekil sayilir');
  // 17 kosu: 400 ve DB'ye gidilmez.
  D.sorgular = [];
  r = await istek('GET', `/karsilastir-coklu?ref=1&kosular=${Array.from({ length: 16 }, (_, i) => i + 2).join(',')}`);
  assert.deepEqual([r.statusCode, r.body.code], [400, 'gecersiz_istek']);
  assert.match(r.body.message, /En çok 16 koşu/);
  assert.equal(D.sorgular.length, 0);
  for (const u of ['/karsilastir-coklu', '/karsilastir-coklu?ref=1', '/karsilastir-coklu?ref=x&kosular=2', '/karsilastir-coklu?ref=1&kosular=2,abc',
    '/karsilastir-coklu?ref=1&kosular=1', '/karsilastir-coklu?ref=1&kosular=2&esikCpu=500', '/karsilastir-coklu?ref=1&kosular=-2', '/karsilastir-coklu?ref=1.5&kosular=2']) {
    const x = await istek('GET', u);
    assert.equal(x.statusCode, 400, `${u}: ${JSON.stringify(x.body)}`);
  }
  assert.equal(D.sorgular.length, 0, '400 yolunda DB okunmaz');
  // 409: bulunamayan ve on kontrol satiri, eksik listesiyle.
  D.kosular.push(kosuSatiri(30, { islem: 'on_kontrol' }));
  r = await istek('GET', '/karsilastir-coklu?ref=1&kosular=2,30,99');
  assert.deepEqual([r.statusCode, r.body.code, r.body.eksik, r.body.onKontrol], [409, 'kosu_yok', [99], [30]]);
  r = await istek('GET', '/karsilastir-coklu?ref=99&kosular=2');
  assert.deepEqual([r.statusCode, r.body.eksik], [409, [99]]);
  // Uyumsuz aday (wrk, farkli hedef) ayri grupta; esik secenegi gecer.
  D.kosular.push(kosuSatiri(40, { motor: 'wrk', parametreler: JSON.stringify({ motor: 'wrk', tavan_rps: 450 }) }), kosuSatiri(41, { hedef_host: 'GBNGXT34' }));
  r = await istek('GET', '/karsilastir-coklu?ref=1&kosular=2,40,41&esikCpu=5&esikP95=7');
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body.karsilastirilamaz.map((k) => [k.id, k.nedenler[0].kod]), [[40, 'motor'], [41, 'hedef']]);
  assert.deepEqual([r.body.esikler.esikCpu, r.body.esikler.esikP95], [5, 7]);
  assert.equal(r.body.adaylar[0].etiket, 'E2');
  assert.equal(r.body.ref.createdAt, '2026-11-03T22:00:00.000Z');
  // DB hatasi 424.
  D.dbHata = new Error('baglanti yok');
  r = await istek('GET', '/karsilastir-coklu?ref=1&kosular=2');
  assert.deepEqual([r.statusCode, r.body.code], [424, 'db_okunamadi']);
});

test('CK6 yetki: Admin olmayan coklu karsilastirmayi okur, etiket yazamaz', { timeout: 10000 }, async () => {
  sifirla();
  kosulariKur(3);
  assert.ok(yt._ADMIN_DISI_OKUMA.some((re) => re.test('/karsilastir-coklu')));
  let r = await istek('GET', '/karsilastir-coklu?ref=1&kosular=2,3', { session: KULLANICI });
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  D.sorgular = [];
  r = await istek('PUT', '/kosular/1/etiket', { session: KULLANICI, body: { etiket: 'x' } });
  assert.equal(r.statusCode, 403);
  assert.equal(D.sorgular.length, 0);
  assert.equal(D.kosular[0].etiket, 'E1');
  assert.equal((await istek('GET', '/karsilastir-coklu?ref=1&kosular=2', { session: null })).statusCode, 401);
});

test('CK7 PUT /kosular/:id/etiket: girdi kapisi, NULL, 409, denetim', { timeout: 10000 }, async () => {
  sifirla();
  kosulariKur(2);
  let r = await istek('PUT', '/kosular/2/etiket', { body: { etiket: '  [K3] A3 brotli 4  ' } });
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  assert.deepEqual([r.body.etiket, D.kosular[1].etiket], ['[K3] A3 brotli 4', '[K3] A3 brotli 4']);
  const u = D.sorgular.find((s) => s.q.startsWith('UPDATE'));
  assert.deepEqual(u.params, [2, '[K3] A3 brotli 4']);
  const d = D.denetim.at(-1);
  assert.equal(d.eylem, 'nginx_loadtest_etiket');
  assert.deepEqual(JSON.parse(d.detail), { kosuId: 2, eski: 'E2', yeni: '[K3] A3 brotli 4' });
  assert.deepEqual([d.targetHost, d.targetIp], ['GBNGXT33', '10.0.0.9']);
  // Bos ve null etiketi kaldirir (NULL).
  r = await istek('PUT', '/kosular/2/etiket', { body: { etiket: '   ' } });
  assert.deepEqual([r.statusCode, r.body.etiket, D.kosular[1].etiket], [200, null, null]);
  r = await istek('PUT', '/kosular/2/etiket', { body: { etiket: null } });
  assert.equal(r.statusCode, 200);
  // 120 karakter (kod noktasi) gecer, 121 gecmez; kontrol karakteri / satir sonu / U+2028; tip.
  assert.equal((await istek('PUT', '/kosular/2/etiket', { body: { etiket: 'ş'.repeat(120) } })).statusCode, 200);
  D.sorgular = [];
  const denetimOnce = D.denetim.length;
  for (const etiket of ['ş'.repeat(121), 'a\nb', 'a\tb', `a${String.fromCharCode(0x2028)}b`, `a${String.fromCharCode(0x85)}b`, 5, ['x'], undefined]) {
    const x = await istek('PUT', '/kosular/2/etiket', { body: etiket === undefined ? {} : { etiket } });
    assert.equal(x.statusCode, 400, `${JSON.stringify(etiket)}: ${JSON.stringify(x.body)}`);
  }
  assert.equal(D.sorgular.length, 0, '400 yolunda DB okunmaz');
  assert.equal(D.denetim.length, denetimOnce, '400 (girdi) denetime yazilmaz (belge: Denetim)');
  assert.equal((await istek('PUT', '/kosular/abc/etiket', { body: { etiket: 'x' } })).statusCode, 400);
  r = await istek('PUT', '/kosular/77/etiket', { body: { etiket: 'x' } });
  assert.deepEqual([r.statusCode, r.body.code], [409, 'kosu_yok']);
  assert.equal(D.denetim.at(-1).result, 'fail', 'ret denetime yazilir');
});

test('CK8 farkDurumu: p95 kotulesme 3 x gurultu, n_5xx, sunucu tarafi 429 / 5xx (kararVer ile ayni)', () => {
  const g = (o) => ({ cpu_ms_istek: 1, gurultu_cpu: 0.02, p95: 100, gurultu_p95: 0.04, hata_max: 0, n_429: 0, n_5xx: 0, ...o });
  // gurultu_p95 %4 -> zarar esigi max(5, 12) = %12: %8 artis gurultu ici (esikZarar %5 olsaydi kotu olurdu); %13 kotu.
  const p = analiz.farkDurumu('p95', g(), g({ p95: 108 }));
  assert.deepEqual([p.durum, Math.round(p.esikYuzde)], ['gurultu_ici', 12]);
  assert.equal(analiz.farkDurumu('p95', g(), g({ p95: 113 })).durum, 'kotu');
  // Hata orani ayni, adayda tek 5xx (istemci sayaci) -> kotu.
  assert.equal(analiz.farkDurumu('hata_orani', g(), g({ n_5xx: 1 })).durum, 'kotu');
  // Istemci sayaclari 0, hata orani ayni; sunucu tarafi 429 / 5xx gecersiz_nedeni'nde -> kotu (kararVer'in RET kurali).
  assert.equal(analiz.farkDurumu('hata_orani', g(), g({ kosular: [{ gecersiz_nedeni: '' }, { gecersiz_nedeni: '5xx(istemci=0, sunucu=4)' }] })).durum, 'kotu');
  assert.equal(analiz.farkDurumu('hata_orani', g(), g({ kosular: [{ gecersiz_nedeni: '429(istemci=0, sunucu=2)' }] })).durum, 'kotu');
  assert.equal(analiz.farkDurumu('hata_orani', g(), g({ kosular: [{ gecersiz_nedeni: 'hata_orani(%0.5)' }] })).durum, 'gurultu_ici');
  assert.equal(analiz.farkDurumu('hata_orani', g(), g({ gecersizler: ['5xx(sunucu=1)'] })).durum, 'kotu', 'kosular yoksa gecersizler');
  // Uctan uca: kararVer RET diyorsa (sunucu 5xx) hucre de kotu.
  const ref = kosu(1, dortAdim(1, [1, 1, 1, 1]));
  const ad = dortAdim(2, [1, 1, 1, 1]);
  ad[3] = adim(2, 200, 2, { g: 'GECERSIZ', nedenler: ['5xx(istemci=0, sunucu=4)'] });
  const r = coklu.cokluKarsilastir({ ref, adaylar: [kosu(2, ad)], analiz });
  assert.equal(r.adaylar[0].karar, 'RET', JSON.stringify(r.adaylar[0].kararNedenleri));
  assert.match(r.adaylar[0].kararNedenleri.join(' '), /hata artti/);
  assert.equal(r.adaylar[0].hizlar.find((h) => h.hiz === 200).fark.hata.durum, 'kotu');
  assert.equal(r.adaylar[0].hizlar.find((h) => h.hiz === 100).fark.hata.durum, 'gurultu_ici');
});

test('CK9 kademeFarki: CPU kademesi ile p95 kademesi farkliyken her olcu kendi kademesinden', () => {
  const ref = kosu(1, dortAdim(1, [1, 1, 1, 1], [20, 20, 30, 30], { ham: YENI_HAM }));
  const ad = kosu(2, dortAdim(2, [0.8, 0.8, 0.9, 0.9], [20, 20, 40, 40], { ham: YENI_HAM }));
  const izli = { ...analiz, kararVer: (...a) => ({ ...analiz.kararVer(...a), kademe: { cpu: 100, p95: 200 } }) };
  const kf = coklu.cokluKarsilastir({ ref, adaylar: [ad], analiz: izli }).adaylar[0].kademeFarki;
  assert.deepEqual([kf.cpu.hiz, kf.p95.hiz, kf.bant.hiz, kf.bellek.hiz, kf.hata.hiz], [100, 200, 200, 200, 200]);
  assert.deepEqual([kf.cpu.aday, kf.p95.aday], [0.8, 40]);
  // p95 kademesi yoksa CPU kademesi.
  const izli2 = { ...analiz, kararVer: (...a) => ({ ...analiz.kararVer(...a), kademe: { cpu: 100, p95: null } }) };
  assert.equal(coklu.cokluKarsilastir({ ref, adaylar: [ad], analiz: izli2 }).adaylar[0].kademeFarki.p95.hiz, 100);
});

test('CK10 router: INT ustu numara 400; 409 listeleri ayri (eksik / onKontrol / bitmemis)', { timeout: 20000 }, async () => {
  sifirla();
  kosulariKur(3);
  for (const u of ['/karsilastir-coklu?ref=1&kosular=2147483648', '/karsilastir-coklu?ref=2147483648&kosular=2', '/karsilastir-coklu?ref=1&kosular=9999999999']) {
    const x = await istek('GET', u);
    assert.deepEqual([x.statusCode, x.body.code], [400, 'gecersiz_istek'], `${u}: ${JSON.stringify(x.body)}`);
  }
  assert.equal(D.sorgular.length, 0, 'INT ustu numara DB okunmaz');
  // Metin numara en cok 9 hane (dg.tamSayi): 10 hane 400; 9 hane gecerli numara (bulunamazsa 409).
  let r = await istek('GET', '/karsilastir-coklu?ref=1&kosular=999999999');
  assert.deepEqual([r.statusCode, r.body.eksik], [409, [999999999]]);
  D.kosular.push(kosuSatiri(30, { islem: 'on_kontrol' }), kosuSatiri(31, { durum: 'RUNNING' }), kosuSatiri(32, { durum: 'QUEUED' }), kosuSatiri(33, { durum: 'FINALIZING' }));
  r = await istek('GET', '/karsilastir-coklu?ref=1&kosular=30,31,32,33');
  assert.deepEqual([r.statusCode, r.body.code, r.body.eksik, r.body.onKontrol, r.body.bitmemis], [409, 'kosu_uygun_degil', [], [30], [31, 32, 33]], JSON.stringify(r.body));
  assert.match(r.body.message, /ön kontrol kaydı \(karşılaştırılmaz\): #30; henüz bitmedi: #31, #32, #33/);
  r = await istek('GET', '/karsilastir-coklu?ref=99&kosular=30,2');
  assert.deepEqual([r.statusCode, r.body.code, r.body.eksik, r.body.onKontrol, r.body.bitmemis], [409, 'kosu_yok', [99], [30], []]);
  assert.match(r.body.message, /bulunamadı \(silinmiş olabilir\): #99/);
  // Bitmis ama basarisiz (FAILED / CANCELED / OKUNAMADI) kosu karsilastirilir.
  D.kosular.push(kosuSatiri(40, { durum: 'FAILED' }), kosuSatiri(41, { durum: 'OKUNAMADI' }));
  D.adimlar.push(...dortAdim(40, [1, 1, 1, 1]), ...dortAdim(41, [1, 1, 1, 1]));
  r = await istek('GET', '/karsilastir-coklu?ref=1&kosular=40,41');
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body.adaylar.map((a) => a.id), [40, 41]);
});

/** Adim listesini baska kip / ae ile yazar (kosunun gercek kombosu). */
const kombolu = (adimlar, kip, ae) => adimlar.map((x) => ({ ...x, kip, ae, tur: `R${x.kosu_id}_K_${kip}_${ae}_${x.hiz}_r${x.deneme}` }));

test('CK11 protokol: h1 ref + h2 aday kiyas grubunda, karar ve fark dogru; kararVer varsayilani degismedi', () => {
  const ref = kosu(1, kombolu(dortAdim(1, [1, 1, 1, 1], [20, 20, 30, 30]), 'ka', 'br'), { protokol: 'h1' });
  const h2 = kosu(2, kombolu(dortAdim(2, [0.7, 0.7, 0.7, 0.7], [20, 20, 30, 30]), 'ka', 'br'), { protokol: 'h2' });
  const cagri = [];
  const izli = { ...analiz, kararVer: (...a) => { cagri.push(a[2]); return analiz.kararVer(...a); } };
  const r = coklu.cokluKarsilastir({ ref, adaylar: [h2], analiz: izli });
  assert.deepEqual(r.karsilastirilamaz, []);
  assert.deepEqual(r.adaylar.map((a) => [a.id, a.karar, a.protokol]), [[2, 'KALICI', 'h2']]);
  assert.deepEqual([cagri[0].refProtokol, cagri[0].adayProtokol], ['h1', 'h1']);
  assert.equal(Math.round(r.adaylar[0].kademeFarki.cpu.yuzde), -30);
  assert.equal(r.adaylar[0].kademeFarki.cpu.durum, 'iyi');
  assert.match(r.adaylar[0].kararNedenleri[0], /kip=ka ae=br \(referans HTTP\/1\.1, aday HTTP\/2\)$/);
  // Tersi de: h2 ref + h1 aday.
  const t = coklu.cokluKarsilastir({ ref: h2, adaylar: [ref], analiz });
  assert.deepEqual(t.adaylar.map((a) => a.karar), ['RET']);
  // Iki kosulu kural AYNEN: kararVer protokol farkinda VERI_YOK.
  const k = analiz.kararVer(ref.analizAdimlari, h2.analizAdimlari, { refProtokol: 'h1', adayProtokol: 'h2' });
  assert.equal(k.karar, 'VERI_YOK');
  assert.match(k.nedenler.join(' '), /farkli protokol: referans HTTP\/1\.1, aday HTTP\/2; ayni protokolle yeniden kosun/);
});

test('CK12 kip / ae: ka vs yeni, br vs gzip vs identity kendi kombosundan okunur; kaynak degismez; ilk neden gercek', () => {
  const YENI = { ag: { test_alinan_bps: 1e8 }, bellek_detay: { t0: 1, pss_ort_mb: 50, anon_ort_mb: 30, son: { t: 2, anon_mb: 31 } } };
  const refAdim = kombolu(dortAdim(1, [1, 1, 1, 1], [20, 20, 40, 40], { ham: YENI }), 'yeni', 'br');
  const ref = kosu(1, refAdim, { parametreler: { kip: 'yeni', ae: 'br', sunucuAyar: { seviye: 6, static: true, dizin: '/usr/nginx/applications/x' } } });
  const ka = kosu(2, kombolu(dortAdim(2, [0.5, 0.5, 0.5, 0.5], [10, 10, 20, 20], { ham: { ...YENI, ag: { test_alinan_bps: 2e8 } } }), 'ka', 'br'), { parametreler: { kip: 'ka', ae: 'br' } });
  const gzip = kosu(3, kombolu(dortAdim(3, [1.2, 1.2, 1.2, 1.2], [20, 20, 40, 40], { ham: YENI }), 'yeni', 'gzip'), { parametreler: { kip: 'yeni', ae: 'gzip', sunucuAyar: { seviye: 4, static: false, dizin: '/usr/nginx/applications/x' } } });
  const ident = kosu(4, kombolu(dortAdim(4, [0.9, 0.9, 0.9, 0.9], [22, 22, 44, 44], { ham: YENI }), 'yeni', 'identity'));
  const once = JSON.stringify([ka.analizAdimlari, gzip.analizAdimlari, ident.analizAdimlari]);
  const r = coklu.cokluKarsilastir({ ref, adaylar: [ka, gzip, ident], analiz });
  assert.equal(JSON.stringify([ka.analizAdimlari, gzip.analizAdimlari, ident.analizAdimlari]), once, 'kaynak adimlar degismez');
  assert.deepEqual(r.karsilastirilamaz, []);
  assert.deepEqual(r.adaylar.map((a) => [a.id, a.karar]), [[2, 'KALICI'], [3, 'RET'], [4, 'RET']]);
  const [a2, a3, a4] = r.adaylar;
  // Degerler adayin KENDI kombosundan; ref degeri ref'in kombosundan.
  assert.deepEqual(a2.hizlar.map((h) => [h.hiz, h.cpuMsIstek, h.p95, h.bantBps]), [[100, 0.5, 10, 2e8], [200, 0.5, 20, 2e8]]);
  assert.deepEqual([a2.kademeFarki.cpu.ref, a2.kademeFarki.cpu.aday, Math.round(a2.kademeFarki.cpu.yuzde)], [1, 0.5, -50]);
  assert.deepEqual([a2.kademeFarki.p95.ref, a2.kademeFarki.p95.aday, Math.round(a2.kademeFarki.p95.yuzde)], [40, 20, -50]);
  assert.equal(Math.round(a2.kademeFarki.bant.yuzde), 100, 'bant: ekOlculer adayin kombosuyla');
  assert.equal(a3.kademeFarki.cpu.aday, 1.2);
  assert.equal(a4.kademeFarki.p95.aday, 44);
  assert.equal(a3.kademeFarki.bellek.aday, 50);
  assert.deepEqual(a3.kombinasyon, { senaryo: 'K', kip: 'yeni', ae: 'gzip' });
  assert.deepEqual(a3.refKombinasyon, { senaryo: 'K', kip: 'yeni', ae: 'br' });
  // Ilk neden ref'in etiketini aday diye yazmaz.
  assert.match(a2.kararNedenleri[0], /senaryo=K \(referans kip=yeni ae=br, aday kip=ka ae=br\)$/);
  assert.doesNotMatch(a3.kararNedenleri[0], /senaryo=K kip=yeni ae=br/);
  // Meta: Fark metninin alanlari; dizin tasinmaz; eski kosuda kip / ae kombodan.
  assert.deepEqual([r.ref.kip, r.ref.ae, r.ref.sunucuAyar], ['yeni', 'br', { seviye: 6, static: true }]);
  assert.deepEqual([a3.kip, a3.ae, a3.sunucuAyar], ['yeni', 'gzip', { seviye: 4, static: false }]);
  assert.deepEqual([a4.kip, a4.ae, a4.sunucuAyar], ['yeni', 'identity', null]);
  assert.ok(!JSON.stringify(r).includes('/usr/nginx/applications'));
  // Tek tekrar: gurultu bilinmiyor isareti karsilastirmada da gelir (tek hiz, tek deneme).
  const t = coklu.cokluKarsilastir({ ref: kosu(5, [adim(5, 100, 1, { cpu: 1 })]), adaylar: [kosu(6, kombolu([adim(6, 100, 1, { cpu: 0.97 })], 'ka', 'gzip'))], analiz });
  assert.deepEqual([t.adaylar[0].karar, t.adaylar[0].hizlar[0].tekrar, t.adaylar[0].hizlar[0].fark.cpuMsIstek.gurultuBilinmiyor], ['NOTR', 1, true]);
});

test('CK13 senaryo: K/B ya da senaryo_id farki karsilastirilamaz, kararVer cagrilmaz; bilinmeyen id karsilastirilir', () => {
  const ref = kosu(1, dortAdim(1, [1, 1, 1, 1]), { senaryo_id: 7, senaryo_ad: 'Ana HAR' });
  const b = kosu(2, dortAdim(2, [1, 1, 1, 1]).map((x) => ({ ...x, senaryo: 'B' })), { senaryo_id: 7 });
  const baskaHar = kosu(3, dortAdim(3, [1, 1, 1, 1]), { senaryo_id: 8, senaryo_ad: 'Yeni HAR' });
  const baskaHarVeB = kosu(4, dortAdim(4, [1, 1, 1, 1]).map((x) => ({ ...x, senaryo: 'B', kip: 'ka' })), { senaryo_id: 8 });
  const bilinmeyen = kosu(5, dortAdim(5, [1, 1, 1, 1]));
  const cagri = [];
  const izli = { ...analiz, kararVer: (...a) => { cagri.push(a[2]); return analiz.kararVer(...a); } };
  const r = coklu.cokluKarsilastir({ ref, adaylar: [b, baskaHar, baskaHarVeB, bilinmeyen], analiz: izli });
  assert.deepEqual(r.karsilastirilamaz.map((k) => [k.id, k.nedenler.map((n) => n.kod)]), [[2, ['senaryo']], [3, ['senaryo']], [4, ['senaryo']]]);
  assert.match(r.karsilastirilamaz[0].nedenler[0].metin, /^Senaryo farklı \(referans K, bu koşu B\)/);
  assert.match(r.karsilastirilamaz[1].nedenler[0].metin, /^Senaryo farklı \(referans Ana HAR, bu koşu Yeni HAR\)/);
  assert.deepEqual(r.adaylar.map((a) => a.id), [5]);
  assert.equal(cagri.length, 1);
});

test('CK14 ortak kombo kararVer secimiyle kalir; router uctan uca h2 + gzip aday', { timeout: 10000 }, async () => {
  // Ref iki kombo (br, gzip), aday yalniz gzip: ortak gzip kiyaslanir, br'ye etiketlenmez (eski davranis).
  const refAdim = [...kombolu(dortAdim(1, [1, 1, 1, 1]), 'ka', 'br'), ...kombolu(dortAdim(1, [2, 2, 2, 2]), 'ka', 'gzip')];
  const r = coklu.cokluKarsilastir({ ref: kosu(1, refAdim), adaylar: [kosu(2, kombolu(dortAdim(2, [2, 2, 2, 2]), 'ka', 'gzip'))], analiz });
  assert.deepEqual([r.adaylar[0].karar, r.adaylar[0].kombinasyon.ae, r.adaylar[0].kademeFarki.cpu.ref], ['NOTR', 'gzip', 2]);
  // Aday iki kombo, ortak yok: kendi kombosu (hizOzeti varsayilani) okunur, oteki kombo karismaz.
  const iki = kosu(3, [...kombolu(dortAdim(3, [3, 3, 3, 3]), 'yeni', 'gzip'), ...kombolu(dortAdim(3, [9, 9, 9, 9]), 'yeni', 'identity')]);
  const r2 = coklu.cokluKarsilastir({ ref: kosu(4, kombolu(dortAdim(4, [3, 3, 3, 3]), 'ka', 'br')), adaylar: [iki], analiz });
  assert.deepEqual([r2.adaylar[0].kademeFarki.cpu.aday, r2.adaylar[0].karar, r2.adaylar[0].hizlar[0].tekrar], [3, 'NOTR', 2]);
  sifirla();
  D.kosular.push(kosuSatiri(1, { parametreler: JSON.stringify({ protokol: 'h1', kip: 'yeni', ae: 'br', sunucuAyar: { seviye: 6, static: false, dizin: '/usr/nginx/applications/x' } }) }));
  D.kosular.push(kosuSatiri(2, { parametreler: JSON.stringify({ protokol: 'h2', kip: 'ka', ae: 'gzip', sunucuAyar: { seviye: 4, static: true, dizin: '/usr/nginx/applications/x' } }) }));
  D.adimlar.push(...dortAdim(1, [1, 1, 1, 1]), ...kombolu(dortAdim(2, [0.8, 0.8, 0.8, 0.8]), 'ka', 'gzip'));
  const x = await istek('GET', '/karsilastir-coklu?ref=1&kosular=2');
  assert.equal(x.statusCode, 200, JSON.stringify(x.body));
  assert.deepEqual(x.body.karsilastirilamaz, []);
  const a = x.body.adaylar[0];
  assert.deepEqual([a.protokol, a.kip, a.ae, a.sunucuAyar, a.karar], ['h2', 'ka', 'gzip', { seviye: 4, static: true }, 'KALICI']);
  assert.equal(a.kademeFarki.cpu.aday, 0.8);
  assert.ok(!JSON.stringify(x.body).includes('/usr/nginx/applications'));
});
