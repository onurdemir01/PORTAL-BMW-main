// server/nginx-cis/__tests__/score.test.cjs — CIS skorlamasi (2026-09-22).
// Kullanici istekleri: (1) gercek CIS maddeleri, (2) istedigim maddeyi ISTISNAYA alip SKORDAN
// DUSURMEK, (3) KENDI REFERANS degerimi kullandirmak, (4) skorun job ile canli tazelenmesi.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { scoreAll, HOST_ALL } = require('../score.cjs');
const { ITEMS, BY_ID } = require('../catalog.cjs');

const R = (host, item_id, status, observed = '', detail = '') => ({ host, item_id, status, observed, detail });
const base = () => ({
  hosts: [{ host: 'GBNGXP40', nginx_version: '1.25.3', t_state: 'ok', scan_date: '2026-09-22' }],
  results: [
    R('GBNGXP40', '2.5.1', 'PASS', 'off'),
    R('GBNGXP40', '2.4.3', 'FAIL', '65'),
    R('GBNGXP40', '5.2.2', 'MANUAL', '10m'),
    R('GBNGXP40', '4.1.7', 'FAIL', 'tanimsiz'),
    R('GBNGXP40', '2.2.2', 'NA', '-'),
  ],
});

test('CIS1 katalog: CIS v2.1.0 madde numaralari, her maddede baslik/bolum/duzeltme', () => {
  for (const id of ['2.5.1', '2.4.3', '4.1.4', '4.1.8', '5.2.1', '5.2.2', '5.3.2', '3.3']) assert.ok(BY_ID.has(id), 'eksik madde: ' + id);
  assert.ok(ITEMS.every((i) => i.title && i.section && i.fix && [1, 2].includes(i.level)));
  assert.equal(new Set(ITEMS.map((i) => i.id)).size, ITEMS.length, 'madde numarasi tekrar etmemeli');
});

test('CIS2 skor: yalniz PASS/FAIL sayilir; MANUAL/NA/veri yok paydaya girmez', () => {
  const r = scoreAll(base());
  const h = r.hosts[0];
  assert.equal(h.passed, 1); assert.equal(h.failed, 2);
  assert.equal(h.score, 33, '1 gecen / 3 sayilan');
  const manual = h.items.find((i) => i.id === '5.2.2');
  assert.equal(manual.counts, false, 'CIS scored=false madde skora girmez');
  const na = h.items.find((i) => i.id === '2.2.2');
  assert.equal(na.counts, false);
  const nodata = h.items.find((i) => i.id === '3.7');
  assert.equal(nodata.status, 'NODATA'); assert.equal(nodata.counts, false);
  assert.equal(h.items.length, ITEMS.length, 'her madde satiri var (veri yoksa NODATA)');
});

test('CIS3 istisna: madde skordan DUSER (payda kucultulur), global ve sunucu bazli', () => {
  const g = scoreAll({ ...base(), exceptions: [{ item_id: '2.4.3', host: null, note: 'kurum keepalive 65 kullaniyor' }] });
  const h = g.hosts[0];
  assert.equal(h.items.find((i) => i.id === '2.4.3').status, 'EXCEPTED');
  assert.equal(h.excepted, 1); assert.equal(h.failed, 1); assert.equal(h.score, 50, '1/2');
  assert.match(h.items.find((i) => i.id === '2.4.3').source, /tüm filo/);
  // sunucu bazli istisna yalniz o sunucuda
  const two = { hosts: [...base().hosts, { host: 'GBNGXP41', t_state: 'ok', scan_date: '2026-09-22' }], results: [...base().results, R('GBNGXP41', '2.4.3', 'FAIL', '65')] };
  const s = scoreAll({ ...two, exceptions: [{ item_id: '2.4.3', host: 'gbngxp40', note: 'yalniz bu sunucu' }] });
  assert.equal(s.hosts.find((x) => x.host === 'GBNGXP40').items.find((i) => i.id === '2.4.3').status, 'EXCEPTED');
  assert.equal(s.hosts.find((x) => x.host === 'GBNGXP41').items.find((i) => i.id === '2.4.3').status, 'FAIL');
  assert.match(s.hosts.find((x) => x.host === 'GBNGXP40').items.find((i) => i.id === '2.4.3').source, /bu sunucu/);
});

test('CIS4 kendi referansim: olculen deger kurum degerine esitse PASS, degilse FAIL (tarayicinin karari ezilir)', () => {
  const r = scoreAll({ ...base(), overrides: [{ item_id: '2.4.3', expected: '65', note: 'kurum standardi' }, { item_id: '5.2.2', expected: '10m', note: 'SPA paket yukleme' }] });
  const h = r.hosts[0];
  const kt = h.items.find((i) => i.id === '2.4.3');
  assert.equal(kt.status, 'PASS'); assert.equal(kt.expected, '65'); assert.equal(kt.expectedSource, 'kurum'); assert.equal(kt.source, 'kurum referansı');
  // KURUM REFERANSI OLAN MADDE SKORA GIRER (2026-09-22, kullanici: "kendi referansimi
  // ekledigim halde tablo guncellenip gectigini yazmiyor"): CIS'te "manuel" (scored:false)
  // isaretli 5.2.2, kurum kendi beklenen degerini tanimladiginda olculebilir hale gelir.
  const cmb = h.items.find((i) => i.id === '5.2.2');
  assert.equal(cmb.status, 'PASS'); assert.equal(cmb.counts, true); assert.equal(cmb.measurable, true);
  assert.equal(h.score, 75, '3 gecen (2.5.1, 2.4.3, 5.2.2) / 4 sayilan (4.1.7 kaldi)');
  // deger tutmuyorsa FAIL; buyuk/kucuk harf ve ; farki gozetilmez
  const r2 = scoreAll({ ...base(), overrides: [{ item_id: '2.5.1', expected: 'OFF;', note: '' }] });
  assert.equal(r2.hosts[0].items.find((i) => i.id === '2.5.1').status, 'PASS');
  const r3 = scoreAll({ ...base(), overrides: [{ item_id: '2.5.1', expected: 'on', note: '' }] });
  assert.equal(r3.hosts[0].items.find((i) => i.id === '2.5.1').status, 'FAIL');
});

test('CIS5 istisna kurum referansindan ONCE gelir; madde ozeti ve filo ozeti', () => {
  const r = scoreAll({ ...base(), exceptions: [{ item_id: '2.4.3', host: null, note: 'x' }], overrides: [{ item_id: '2.4.3', expected: '10', note: '' }] });
  assert.equal(r.hosts[0].items.find((i) => i.id === '2.4.3').status, 'EXCEPTED');
  const item = r.perItem.find((i) => i.id === '4.1.7');
  assert.equal(item.fail, 1);
  assert.equal(r.perItem[0].fail >= r.perItem[r.perItem.length - 1].fail, true, 'en cok kalan madde ustte');
  assert.equal(r.summary.hosts, 1);
  assert.equal(r.summary.exceptedCells, 1);
  assert.equal(r.summary.avgScore, r.hosts[0].score);
  assert.equal(r.summary.scanDate, '2026-09-22');
});

test('CIS6 uc/sekme/is sozlesmesi: rescan job, istisna/override uclari, sekme, playbook kaydi, tablolar', () => {
  const idx = fs.readFileSync(path.join(__dirname, '..', 'index.cjs'), 'utf8');
  for (const must of ["router.post('/rescan'", "router.put('/exceptions'", "router.put('/overrides'", "router.delete('/exceptions/:id'", "router.delete('/overrides/:id'", "REGISTRY_KEY = 'nginx_cis_scan'"]) {
    assert.ok(idx.includes(must), 'eksik: ' + must);
  }
  assert.ok(/_cache = \{ at: 0, value: null \}/.test(idx), 'kural degisince onbellek dusmeli');
  const page = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'src', 'components', 'nginx_console', 'NginxConsolePage.tsx'), 'utf8');
  // 2026-09-23'ten beri sekme icerigi GORUNURLUK KAPISIYLA birlikte ciziliyor:
  // `{tab === 'cis' && canSee('tab:nginx:cis') && <CisTab ...`
  assert.ok(/tab === 'cis' &&[^\n]*<CisTab/.test(page) && page.includes("label: 'CIS'"), 'CIS sekmesi');
  assert.ok(/tab === 'cis' && canSee\('tab:nginx:cis'\)/.test(page), 'CIS sekmesi gorunurluk kapisina bagli degil');
  const setup = fs.readFileSync(path.join(__dirname, '..', '..', 'db', 'mssql-setup.cjs'), 'utf8');
  for (const must of ["name: 'nginx_cis_exceptions'", "name: 'nginx_cis_overrides'", "key_name: 'nginx_cis_scan'"]) assert.ok(setup.includes(must), 'seed eksik: ' + must);
  const server = fs.readFileSync(path.join(__dirname, '..', '..', 'index.cjs'), 'utf8');
  assert.ok(server.includes("initNginxCis(app)"), 'modul init edilmemis');
  const tab = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'src', 'components', 'nginx_console', 'CisTab.tsx'), 'utf8');
  assert.ok(!/confirm\(|alert\(/.test(tab), 'tarayici popup yok');
  assert.ok(tab.includes('LoadingLogo'), 'yuklemede donen logo');
  assert.ok(tab.includes('İptal'), 'modal iptal metni');
});

test('CIS7 siralama ve madde detayi: maddeler DOGAL numara sirasinda, her maddede sunucu dokumu + neden/nasil alanlari', () => {
  const { cmpItemId } = require('../catalog.cjs');
  assert.deepEqual(['2.10.1', '2.4.3', '1.1.1', '2.4.4', '5.3.2'].sort(cmpItemId), ['1.1.1', '2.4.3', '2.4.4', '2.10.1', '5.3.2']);
  const r = scoreAll({
    hosts: [{ host: 'H1', scan_date: '2026-09-22' }, { host: 'H2', scan_date: '2026-09-22' }],
    results: [R('H1', '2.5.1', 'FAIL', 'on'), R('H2', '2.5.1', 'PASS', 'off'), R('H1', '2.4.3', 'FAIL', '65')],
    exceptions: [{ item_id: '2.4.3', host: 'H2', note: 'yalniz bu sunucu' }],
  });
  // dogal sira
  const ids = r.perItem.map((i) => i.id);
  assert.deepEqual(ids, [...ids].sort(cmpItemId), 'perItem madde numarasina gore sirali dondurulmeli');
  assert.equal(ids[0], '1.1.1');
  // madde detayi: sunucu dokumu
  const tok = r.perItem.find((i) => i.id === '2.5.1');
  assert.equal(tok.hosts.length, 2);
  assert.deepEqual(tok.hosts.find((h) => h.host === 'H1'), { host: 'H1', status: 'FAIL', observed: 'on', detail: '', exceptionNote: null });
  assert.equal(tok.hosts.find((h) => h.host === 'H2').status, 'PASS');
  const kt = r.perItem.find((i) => i.id === '2.4.3');
  assert.equal(kt.hosts.find((h) => h.host === 'H2').status, 'EXCEPTED');
  assert.equal(kt.hosts.find((h) => h.host === 'H2').exceptionNote, 'yalniz bu sunucu');
  // neden onemli / nasil olculuyor her maddede
  assert.ok(r.perItem.every((i) => i.rationale && i.check), 'her maddede rationale + check olmali');
  assert.ok(r.hosts[0].items.every((c) => c.rationale && c.check), 'sunucu hucrelerinde de tasinmali');
  // UI sozlesmesi
  const tab = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'src', 'components', 'nginx_console', 'CisTab.tsx'), 'utf8');
  assert.ok(/aria-label="sıralama"/.test(tab), 'siralama secici');
  assert.ok(/setItemOpen\(i\)/.test(tab) && /Nasıl düzeltilir\?/.test(tab) && /Neden önemli\?/.test(tab), 'madde detay penceresi');
  assert.ok(/\[\.\.\.detail\.items\]\.sort\(\(a, b\) => cmpItemId/.test(tab), 'sunucu detayinda maddeler dogal sirali');
});

test('CIS8 coklu kurum referansi: olculen deger kabul edilen degerlerden HERHANGI BIRINE esitse gecer', () => {
  const d = { hosts: [{ host: 'H' }], results: [R('H', '5.2.2', 'MANUAL', '10m'), R('H', '2.4.3', 'FAIL', '65')] };
  const r = scoreAll({ ...d, overrides: [{ item_id: '5.2.2', expected: '1m' }, { item_id: '5.2.2', expected: '10M;' }, { item_id: '2.4.3', expected: '75' }] });
  const c = r.hosts[0].items.find((i) => i.id === '5.2.2');
  assert.equal(c.status, 'PASS', 'ikinci kabul edilen degere esit');
  assert.equal(c.expected, '1m | 10M;');
  assert.match(c.source, /2 kabul edilen/);
  assert.equal(r.hosts[0].items.find((i) => i.id === '2.4.3').status, 'FAIL', 'tek deger tutmuyorsa kalir');
  assert.deepEqual(r.perItem.find((i) => i.id === '5.2.2').expectedValues, ['1m', '10M;']);
  // UI/uc sozlesmesi: ayni maddeye ikinci deger EKLENIR (uzerine yazilmaz), istisna kaldirilabilir
  const idx = fs.readFileSync(path.join(__dirname, '..', 'index.cjs'), 'utf8');
  assert.ok(/WHERE item_id = \$1 AND expected = \$2/.test(idx), 'ayni deger iki kez eklenmemeli, farkli deger EKLENMELI');
  assert.ok(/async function rulesStamp\(\)/.test(idx) && /_cache\.stamp === stamp/.test(idx), 'kural degisince onbellek damgasi duser');
  const tab = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'src', 'components', 'nginx_console', 'CisTab.tsx'), 'utf8');
  assert.ok(/istisnadan çıkar/.test(tab), 'istisnayi kaldirma dugmesi');
  assert.ok(/referans ekle/.test(tab), 'ikinci kabul edilen deger ekleme dugmesi');
  assert.ok(!/ovrById/.test(tab), 'tekil referans haritasi kalmamali');
});


// ── CIS9 — "kendi referansimi ekledim ama gectigini yazmiyor" (2026-09-22) ────
//
// Iki ayri sebep vardi:
//   1) CIS'te manuel (scored:false) isaretli maddeler kurum referansi tanimlansa da
//      skora girmiyordu -> skor hic kipirdamiyordu.
//   2) Karsilastirma duz metin esitligiydi: "20M" ile "20m", "10" ile "10s",
//      "1024k" ile "1m" tutmuyordu.
// Ayrica bazi maddelerde OLCULEN deger birlesik ("header=10 body=10"); kullanici ne
// yazacagini bilemiyordu -> filoda olculen degerler listelenir, tek tikla secilir.
test('CIS9 kurum referansi: birim/harf farki gozetilmez, madde skora girer, olculen degerler listelenir', () => {
  const { sameVal } = require('../catalog.cjs');
  assert.equal(sameVal('20M', '20m'), true, 'buyuk/kucuk harf');
  assert.equal(sameVal('20m;', '20m'), true, 'noktali virgul');
  assert.equal(sameVal('10', '10s'), true, 'birimi yazilmamis sayi');
  assert.equal(sameVal('1024k', '1m'), true, 'bayt birimi donusumu');
  assert.equal(sameVal('20m', '10m'), false, 'farkli deger gecmemeli');
  assert.equal(sameVal('header=10 body=10', '10'), false, 'birlesik olcum parcasiyla gecmemeli');

  const hosts = [{ host: 'H1', scan_date: '2026-09-22' }, { host: 'H2', scan_date: '2026-09-22' }];
  const results = [
    R('H1', '5.2.2', 'MANUAL', '20M'),
    R('H2', '5.2.2', 'MANUAL', '1m'),
  ];
  const r = scoreAll({ hosts, results, overrides: [{ item_id: '5.2.2', expected: '20m', note: 'kurum' }] });
  const h1 = r.hosts.find((h) => h.host === 'H1');
  const h2 = r.hosts.find((h) => h.host === 'H2');
  assert.equal(h1.items.find((i) => i.id === '5.2.2').status, 'PASS');
  assert.equal(h2.items.find((i) => i.id === '5.2.2').status, 'FAIL');
  assert.equal(h1.score, 100, 'referans tanimli madde skora girmeli');
  assert.equal(h2.score, 0);

  const item = r.perItem.find((i) => i.id === '5.2.2');
  assert.equal(item.pass, 1);
  assert.equal(item.fail, 1);
  assert.deepEqual(
    item.observedValues.map((o) => o.value).sort(),
    ['1m', '20M'],
    'filoda olculen degerler madde ozetinde olmali',
  );
  assert.equal(item.observedValues.find((o) => o.value === '1m').hosts[0], 'H2');

  // Ekran sozlesmesi: olculen degerler tek tikla secilir, kayittan sonra sonuc soylenir.
  const tab = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'src', 'components', 'nginx_console', 'CisTab.tsx'), 'utf8');
  assert.ok(/Filoda ölçülen değerler/.test(tab), 'madde detayinda olculen degerler kutusu');
  assert.ok(/setRule\(\{ \.\.\.rule, value: o\.value \}\)/.test(tab), 'olculen deger tek tikla alana yazilmali');
  assert.ok(/sunucu geçiyor, \$\{row\.fail\} sunucu kalıyor/.test(tab), 'kayittan sonra kac sunucunun gectigi soylenmeli');
});

// CIS10 (2026-09-24, kullanici: "bir sunucuyu komple istisnaya alabilmek istiyorum").
// item_id '*' + host: o sunucudaki HER madde istisna; skoru null olur ve filo ortalamasina,
// "skor < %80" ve "tam puan" sayimlarina GIRMEZ. Ayri tablo yok - ayni istisna tablosunda
// sentinel, boylece kural listesi / kaldirma / denetim kaydi tek yerde kalir.
test('CIS10 sunucuyu komple istisnaya alma: skor null, ortalama disi, her madde istisna', () => {
  const hosts = [{ host: 'A' }, { host: 'B' }];
  const results = [
    { host: 'A', item_id: '2.1.3', status: 'FAIL', observed: 'on' },
    { host: 'B', item_id: '2.1.3', status: 'FAIL', observed: 'on' },
  ];
  const once = scoreAll({ results, hosts, exceptions: [], overrides: [] });
  assert.equal(once.summary.under80, 2);

  const r = scoreAll({ results, hosts, exceptions: [{ item_id: HOST_ALL, host: 'b', note: 'emekliye ayrildi' }], overrides: [] });
  const B = r.hosts.find((h) => h.host === 'B');
  const A = r.hosts.find((h) => h.host === 'A');

  assert.equal(B.score, null, 'komple istisnali sunucunun skoru olmamali');
  assert.equal(B.exceptedHost, true);
  assert.equal(B.exceptionNote, 'emekliye ayrildi');
  assert.equal(B.failed, 0, 'kalan madde sayilmamali');
  assert.ok(B.items.every((i) => i.status === 'EXCEPTED'), 'her madde istisna olmali');
  assert.match(B.items[0].source, /sunucu komple/);

  // host adi kucuk harf girilse de tutar
  assert.equal(A.score, 0, 'diger sunucu etkilenmemeli');
  assert.equal(r.summary.under80, 1, 'komple istisnali sunucu "skor < %80" sayiminda olmamali');
  assert.equal(r.summary.exceptedHosts, 1);
  assert.equal(r.summary.hosts, 2, 'sunucu listeden kaybolmamali');
});
