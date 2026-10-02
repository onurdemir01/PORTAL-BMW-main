// server/audit/__tests__/spa-traffic-pencere.test.cjs - Nginx_Spa_Traffic ORTAK KURALI (2026-10-02).
//
// UC TUKETICI (Denetim > Nginx SPA, Nginx ARK SPA Raporu, Production Tasimalari) durumu
// nginx-migration.cjs spaTrafikDurumu ile verir. KESIN KURAL: "olculemedi" ile "yok" ASLA
// karismaz. Eskiden durum `req7 > 0 ? active : sampled ? unknown : idle` idi; gunluk
// rotasyonlu hostta (nginx_log_rotate 'rotate 3') okuyucu tum dosyalari okuyup veri kisa
// kalinca sampled=0 basiyor, 1-4 gunluk olcum 7 gunluk "idle" (atil / emekli adayi)
// gorunuyordu.
//
// PW1  pencereSaat spa-rp.cjs ile BIREBIR (ayni girdiye ayni cikti; 168 saat esigi ayni)
// PW2  tek sunucu: idle YALNIZ pencere >= 7 gun, sampled=0, first_seen var
// PW3  mirror sunucular: pencere EN DAR olandir (en yeni first_seen)
// PW4  okunamayan mirror (LOADERR: service/env/location NULL, host|vhost ya da host|*)
// PW5  tanimin bir sunucusunun o gun satiri yok -> "yok" denmez
// PW6  hic olcum yok -> null; hepsi okunamadi -> unknown + sayilar null
// PW7  host kipi satirlari (location '@', vhost '_' kovalari) location tanimlarina YAZILMAZ
// PW8  hucre birlestirme: biri yuk aliyorsa active, biri kismi ise unknown
// PW9  sorgu: first_seen kolonu yoksa ADI yazilmaz; host kipi SQL'de de suzulur
// PW10 hic olculmeyen location (null) birlesimde ATILMAZ: digeri idle ise hucre unknown
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  PENCERE_TAM_SA,
  pencereSaat,
  spaTrafikAnahtari,
  spaTrafikSorgusu,
  spaTrafikIndeksi,
  spaTrafikDurumu,
  spaTrafikBirlesik,
} = require('../nginx-migration.cjs');
const spaRp = require('../../nginx-console/spa-rp.cjs');

const GUN = '2026-10-02';
const TAM = '20260924000000'; // 8 gun = 192 saat
const ROT3 = '20260929031500'; // gunluk rotasyon: ~2 gun 20 saat
const K = spaTrafikAnahtari('GLOMO', 'PROD', '/x/');

/** Location kipi LOAD satiri (analyzer'in yazdigi bicim). */
const LOAD = (host, o = {}) => ({
  host,
  vhost: 'GLOMO-PROD',
  service: 'GLOMO',
  env: 'PROD',
  location: '/x/',
  req_24h: 0,
  req_7d: 0,
  hc_24h: 0,
  sampled: 0,
  last_seen: null,
  error: null,
  first_seen: TAM,
  scan_date: GUN,
  ...o,
});
/** Location kipi LOADERR satiri: analyzer service/env/location'i NULL yazar. */
const LOADERR = (host, vhost, error = 'log www ile okunamiyor: /web_log/x.log') => ({
  host,
  vhost,
  service: null,
  env: null,
  location: null,
  req_24h: null,
  req_7d: null,
  hc_24h: null,
  sampled: 0,
  last_seen: null,
  error,
  first_seen: null,
  scan_date: GUN,
});
const durum = (rows, defs) =>
  spaTrafikDurumu(
    spaTrafikIndeksi(rows, (x) => spaTrafikAnahtari(x.service, x.env, x.location)),
    K,
    defs,
  );
const TANIM = (...hosts) => hosts.map((host) => ({ host, vhost: 'GLOMO-PROD' }));

test('PW1 pencereSaat spa-rp.cjs ile BIREBIR; esik 168 saat', () => {
  assert.equal(PENCERE_TAM_SA, spaRp.PENCERE_TAM_SA);
  assert.equal(PENCERE_TAM_SA, 168);
  const gunler = [GUN, '2026-01-01', new Date(Date.UTC(2026, 9, 2)), '', null, 'bozuk'];
  const ilkler = [
    TAM,
    ROT3,
    '20260925000000',
    '20260925010000',
    '20261002050000', // tarama gununden SONRA -> 0 (negatif degil)
    '20260101',
    '',
    null,
    'x',
    ' 20260924000000',
  ];
  for (const g of gunler)
    for (const f of ilkler)
      assert.equal(pencereSaat(g, f), spaRp.pencereSaat(g, f), `ayrisma: ${String(g)} / ${f}`);
  assert.equal(pencereSaat(GUN, TAM), 192);
  assert.equal(pencereSaat(GUN, ROT3), 68);
});

test('PW2 tek sunucu: idle YALNIZ tam pencere + sampled=0 + first_seen var', () => {
  assert.equal(durum([LOAD('A', { req_7d: 3 })], TANIM('A')).state, 'active');
  // Kisa pencerede bile istek GORULDUYSE yuk vardir.
  assert.equal(durum([LOAD('A', { req_7d: 3, first_seen: ROT3 })], TANIM('A')).state, 'active');

  const tam = durum([LOAD('A')], TANIM('A'));
  assert.equal(tam.state, 'idle');
  assert.equal(tam.pencereSaat, 192);
  assert.equal(tam.kismi, undefined);

  // GUNLUK ROTASYON: tum dosyalar okundu, sampled=0 ama veri ~3 gun -> idle DEGIL.
  const rot = durum([LOAD('A', { first_seen: ROT3 })], TANIM('A'));
  assert.equal(rot.state, 'unknown', 'kisa pencere "7 gundur yuk yok" gosteriliyor');
  assert.deepEqual(rot.kismi, ['pencere']);
  assert.equal(rot.pencereSaat, 68);
  assert.equal(rot.req7, 0, 'olculen 0 sayi olarak korunmali (alt sinir)');
  assert.equal(rot.hosts, 1);

  // Esik: tam 168 saat idle, 167 saat degil.
  assert.equal(durum([LOAD('A', { first_seen: '20260925000000' })], TANIM('A')).state, 'idle');
  assert.equal(durum([LOAD('A', { first_seen: '20260925010000' })], TANIM('A')).state, 'unknown');

  // first_seen YOK (eski analyzer: kolon yok -> NULL secilir; eski betik: alan bos).
  const yok = durum([LOAD('A', { first_seen: null })], TANIM('A'));
  assert.equal(yok.state, 'unknown', 'pencere bilinmeden "yok" iddia ediliyor');
  assert.deepEqual(yok.kismi, ['pencere-bilinmiyor']);
  assert.equal(yok.pencereSaat, null);
  // scan_date secilmemis satir da pencereyi bilinmez yapar.
  assert.equal(durum([LOAD('A', { scan_date: undefined })], TANIM('A')).state, 'unknown');

  // sampled=1 (butce / donmus dosya) - pencere tam gorunse bile alt sinir.
  const smp = durum([LOAD('A', { sampled: 1 })], TANIM('A'));
  assert.equal(smp.state, 'unknown');
  assert.deepEqual(smp.kismi, ['sampled']);
  // Saglik kontrolu YUK DEGILDIR.
  assert.equal(durum([LOAD('A', { hc_24h: 8640 })], TANIM('A')).state, 'idle');
});

test('PW3 mirror: pencere EN DAR olan (en yeni first_seen) - "7 gun olctuk" yalani yok', () => {
  const t = durum([LOAD('A'), LOAD('B', { first_seen: ROT3 })], TANIM('A', 'B'));
  assert.equal(t.state, 'unknown', 'bir mirror 3 gun gormusken "7 gundur yok" denmis');
  assert.equal(t.pencereSaat, 68);
  assert.equal(t.firstSeen, ROT3, 'en eski first_seen alinmis');
  assert.equal(t.hosts, 2);
  // Birinin first_seen'i yoksa toplam pencere de bilinmez.
  const n = durum([LOAD('A'), LOAD('B', { first_seen: null })], TANIM('A', 'B'));
  assert.equal(n.state, 'unknown');
  assert.equal(n.pencereSaat, null);
  assert.equal(n.firstSeen, null);
  // Kenar: ilk mirror'in penceresi 0 saat (log tarama gunu rotasyona girmis), ikincisinin
  // first_seen'i yok -> toplam pencere BILINMEZ ("bugunku kayitta yok" denmez).
  const sifir = durum([LOAD('A', { first_seen: '20261002050000' }), LOAD('B', { first_seen: null })], TANIM('A', 'B'));
  assert.equal(sifir.pencereSaat, null, 'first_seen yok mirror pencereyi zehirlemedi');
  assert.deepEqual(sifir.kismi, ['pencere-bilinmiyor']);
  // Ayni sunucuda ayni anahtara iki satir (iki vhost dosyasi): toplanir, pencere EN DAR;
  // birinin first_seen'i yoksa o sunucunun penceresi bilinmez.
  const cift = durum([LOAD('A', { req_24h: 1 }), LOAD('A', { first_seen: ROT3, req_24h: 2 })], TANIM('A'));
  assert.equal(cift.pencereSaat, 68, 'ayni sunucunun iki satirinda genis pencere alindi');
  assert.equal(cift.req24, 3);
  assert.equal(cift.hosts, 1);
  const ciftYok = durum([LOAD('A', { first_seen: ROT3 }), LOAD('A', { first_seen: null })], TANIM('A'));
  assert.equal(ciftYok.pencereSaat, null);
  const ciftSifir = durum([LOAD('A', { first_seen: '20261002050000' }), LOAD('A', { first_seen: null })], TANIM('A'));
  assert.equal(ciftSifir.pencereSaat, null, 'ayni sunucuda first_seen yok satir pencereyi zehirlemedi');
  // Ikisi de tam: idle; sayilar toplanir, son istek en yeni.
  const iki = durum(
    [
      LOAD('A', { req_7d: 0, last_seen: '20260920000000' }),
      LOAD('B', { req_7d: 0, last_seen: '20260921000000' }),
    ],
    TANIM('A', 'B'),
  );
  assert.equal(iki.state, 'idle');
  assert.equal(iki.lastSeen, '20260921000000');
  const yuk = durum([LOAD('A', { req_7d: 5, req_24h: 1 }), LOAD('B', { req_7d: 7 })], TANIM('A', 'B'));
  assert.equal(yuk.req7, 12);
  assert.equal(yuk.req24, 1);
});

test('PW4 okunamayan mirror: LOADERR (host|vhost, host|*) tanimin o sunucusunu olculemedi yapar', () => {
  // Eskiden LOADERR satiri SERVICE|ENV|location = '||' anahtarina yaziliyor, hicbir tanima
  // ulasmiyordu: B okunamadigi halde A'nin 0'i "idle" gosteriliyordu.
  const t = durum([LOAD('A'), LOADERR('B', 'GLOMO-PROD')], TANIM('A', 'B'));
  assert.equal(t.state, 'unknown', 'okunamayan mirror sessizce yok sayildi');
  assert.ok(t.kismi.includes('okunamayan-sunucu'));
  assert.equal(t.unknownHosts, 1);
  assert.equal(t.hosts, 1);
  // Betik basinda tarih hatasi: HOST|* tum vhost'lari olculemedi yapar.
  const yildiz = durum([LOAD('A'), LOADERR('B', '*', 'tarih hesaplanamadi')], TANIM('A', 'B'));
  assert.equal(yildiz.state, 'unknown');
  assert.equal(yildiz.unknownHosts, 1);
  // BASKA vhost'un hatasi bu tanimi zehirlemez (B'de bu tanimin satiri da yok -> satirsiz).
  const baska = durum([LOAD('A'), LOAD('B'), LOADERR('B', 'WEBFORMS-PROD')], TANIM('A', 'B'));
  assert.equal(baska.state, 'idle', 'baska vhost hatasi bu tanima yazilmis');
  assert.equal(baska.unknownHosts, 0);
  // Yuk goruldu: biri okunamasa da ACTIVE.
  const aktif = durum([LOAD('A', { req_7d: 9 }), LOADERR('B', 'GLOMO-PROD')], TANIM('A', 'B'));
  assert.equal(aktif.state, 'active');
  assert.equal(aktif.unknownHosts, 1);
  // Location'i DOLU hata satiri (anahtara ozel) de sayilir.
  const anahtar = durum([LOAD('A'), LOAD('B', { error: 'izin yok' })], TANIM('A', 'B'));
  assert.equal(anahtar.state, 'unknown');
  assert.equal(anahtar.unknownHosts, 1);
});

test('PW5 tanimin bir sunucusunun o gun olcum satiri yok -> "istek yok" DENMEZ', () => {
  const t = durum([LOAD('A')], TANIM('A', 'B'));
  assert.equal(t.state, 'unknown', 'olculmeyen mirror sifir sayilmis');
  assert.deepEqual(t.kismi, ['satirsiz-sunucu']);
  assert.equal(t.missingHosts, 1);
  // Tanim verilmezse (eski cagiran) yalniz satiri olan sunucular bilinir.
  assert.equal(durum([LOAD('A')]).state, 'idle');
  // Tanimda OLMAYAN ama olcumu olan sunucu da sayilir (yuk gercektir).
  assert.equal(durum([LOAD('A'), LOAD('C', { req_7d: 4 })], TANIM('A')).req7, 4);
});

test('PW6 hic olcum yok -> null ("olcum yok"); hepsi okunamadi -> unknown, sayi YOK', () => {
  assert.equal(durum([], TANIM('A', 'B')), null);
  assert.equal(spaTrafikDurumu(null, K, TANIM('A')), null, 'tablo yokken uydurma');
  const t = durum([LOADERR('A', 'GLOMO-PROD'), LOADERR('B', '*')], TANIM('A', 'B'));
  assert.equal(t.state, 'unknown');
  assert.equal(t.hosts, 0);
  assert.equal(t.req7, null, 'okunamayan sunucuya sayi yazilmis');
  assert.equal(t.unknownHosts, 2);
});

test('PW7 host kipi satirlari ve kovalar location tanimlarina YAZILMAZ', () => {
  const hostKipi = [
    // uygulama basina vhost olcumu (service/env NULL, location '@' + server_name)
    { host: 'A', vhost: 'x-app-v1-ns-prod', service: null, env: null, location: '@x.irp.local', req_7d: 500, req_24h: 50, error: null, first_seen: TAM, scan_date: GUN },
    // kovalar: vhost '_'
    { host: 'A', vhost: '_', service: null, env: null, location: '@_', req_7d: 240, error: null, first_seen: TAM, scan_date: GUN },
    { host: 'A', vhost: '_', service: null, env: null, location: '@ip', req_7d: 29, error: null, first_seen: TAM, scan_date: GUN },
    { host: 'A', vhost: '_', service: null, env: null, location: '@-', req_7d: 3, error: null, first_seen: TAM, scan_date: GUN },
    // host kipi hata satiri (location '@' - tam ad yok)
    { host: 'B', vhost: 'wild', service: null, env: null, location: '@', req_7d: null, error: "server_name'de tam ad yok", first_seen: null, scan_date: GUN },
    // '_' vhost'lu ama '/' yollu bozuk satir da kova sayilir
    { host: 'A', vhost: '_', service: 'GLOMO', env: 'PROD', location: '/x/', req_7d: 77, error: null, first_seen: TAM, scan_date: GUN },
  ];
  const idx = spaTrafikIndeksi(hostKipi, (x) => spaTrafikAnahtari(x.service, x.env, x.location));
  assert.equal(idx.satir, 0, 'host kipi satiri "olcum var" sayildi');
  assert.equal(idx.hostKipi, hostKipi.length);
  assert.equal(idx.olcum.size, 0);
  assert.equal(idx.hata.size, 0);
  assert.equal(idx.anahtarHata.size, 0);
  // Ayni sunucunun location kipi olcumu etkilenmez.
  const t = durum([...hostKipi, LOAD('A'), LOAD('B')], TANIM('A', 'B'));
  assert.equal(t.state, 'idle');
  assert.equal(t.req7, 0, 'kova/host kipi sayisi location tanimina eklendi');
});

test('PW8 hucre birlestirme: biri yuk aliyorsa active, biri kismi ise unknown', () => {
  const idle = durum([LOAD('A')], TANIM('A'));
  const aktif = durum([LOAD('A', { req_7d: 5 })], TANIM('A'));
  const kisa = durum([LOAD('A', { first_seen: ROT3 })], TANIM('A'));
  const okunamadi = durum([LOADERR('A', 'GLOMO-PROD')], TANIM('A'));
  assert.equal(spaTrafikBirlesik([idle, aktif]).state, 'active');
  assert.equal(spaTrafikBirlesik([idle, aktif]).req7, 5);
  assert.equal(spaTrafikBirlesik([idle, aktif]).locations, 2);
  const k = spaTrafikBirlesik([idle, kisa]);
  assert.equal(k.state, 'unknown', 'kisa pencereli location birlesince "idle" oldu');
  assert.deepEqual(k.kismi, ['pencere']);
  assert.equal(k.pencereSaat, 68);
  assert.equal(spaTrafikBirlesik([idle, idle]).state, 'idle');
  const o = spaTrafikBirlesik([idle, okunamadi]);
  assert.equal(o.state, 'unknown');
  assert.ok(o.kismi.includes('okunamayan-sunucu'));
  assert.equal(spaTrafikBirlesik([idle]), idle, 'tek olcum aynen donmeli');
  assert.equal(spaTrafikBirlesik([null, null]), null, 'hic olcum yokken uydurma');
  assert.equal(spaTrafikBirlesik([]), null);
});

test('PW10 hic olculmeyen location (null) atilmaz: digeri idle olsa da hucre UNKNOWN', () => {
  // Dogrulama bulgusu (2026-10-02): eskiden `[null, idle] -> idle` KILITLIYDI. /a/ 7 gun olculmus
  // 0, /b/ yalniz o gun satiri olmayan H2'de tanimli: hucre "yuk yok - atil aday" gorunuyordu.
  const idle = durum([LOAD('A')], TANIM('A'));
  const aktif = durum([LOAD('A', { req_7d: 5 })], TANIM('A'));
  for (const sira of [
    [null, idle],
    [idle, null],
  ]) {
    const t = spaTrafikBirlesik(sira, sira.map((x) => (x ? 1 : 2)));
    assert.equal(t.state, 'unknown', `olculmeyen location "yuk yok" sayildi (${sira.map(Boolean)})`);
    assert.deepEqual(t.kismi, ['satirsiz-sunucu']);
    assert.equal(t.missingHosts, 2, 'olculmeyen tanimin sunuculari missingHosts a eklenmeli');
    assert.equal(t.hosts, 1);
    assert.equal(t.req7, 0, 'olculen kisim tasinmali');
    assert.equal(t.locations, 2);
  }
  // Sunucu sayisi verilmezse en az 1 sayilir; kismi nedenler birlesir.
  const kisa = durum([LOAD('A', { first_seen: ROT3 })], TANIM('A'));
  const kb = spaTrafikBirlesik([kisa, null]);
  assert.equal(kb.state, 'unknown');
  assert.deepEqual(new Set(kb.kismi), new Set(['pencere', 'satirsiz-sunucu']));
  assert.equal(kb.missingHosts, 1);
  // Bir location yuk aliyorsa olculmeyen location bunu degistirmez.
  const a = spaTrafikBirlesik([aktif, null], [1, 3]);
  assert.equal(a.state, 'active');
  assert.equal(a.req7, 5);
  assert.equal(a.kismi, undefined);
});

test('PW9 sorgu: first_seen kolonu yoksa ADI yazilmaz; host kipi SQL de suzulur', () => {
  const yok = spaTrafikSorgusu(false);
  assert.ok(
    !/first_seen/.test(yok.replace(/AS first_seen/g, '')),
    "kolon yokken first_seen adi yazilmis - 'Invalid column name' ile sorgu duser",
  );
  assert.match(yok, /CAST\(NULL AS NVARCHAR\(20\)\) AS first_seen/);
  assert.match(spaTrafikSorgusu(true), /,\s*first_seen,/);
  for (const q of [yok, spaTrafikSorgusu(true)]) {
    assert.match(q, /AND \(location IS NULL OR location NOT LIKE '@%'\)/, 'host kipi SQL de alinmali');
    assert.match(q, /CONVERT\(varchar\(10\), scan_date, 23\) AS scan_date/, 'pencere icin scan_date');
    assert.match(q, /scan_date = \(SELECT MAX\(scan_date\) FROM dbo\.Nginx_Spa_Traffic\)/);
  }
  assert.match(spaTrafikSorgusu(true, ' AND host IN (@o0)'), /NOT LIKE '@%'\) AND host IN \(@o0\)$/);
});
