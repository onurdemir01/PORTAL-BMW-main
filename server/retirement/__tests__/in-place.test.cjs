// server/retirement/__tests__/in-place.test.cjs — IN1..IN8 (job_3438186, 2026-10-22, CANLI ETKI).
//
// In-place sunucuda (GBPOSWEBAPI ayni sunucuda hem JBoss 7 hem JBoss 8) JBoss 7 retire edilirken JBoss 8
// de etkilendi. Portal tarafinin payi:
//   - kesif `host|app` ile tekillestiriyordu: IKINCI kurulum satiri atiliyor, hangi surumun gorunecegini
//     SQL satir sirasi seciyordu (betik bunu yakalayamaz: yol ve surum tutarli);
//   - genOf '7.4.8'i JBoss 8 sayiyordu (her yerde '8' ariyordu);
//   - envanterin 'NF' isareti paket yolu gibi gidiyordu;
//   - web adimi yalniz adla eslesen vhost'u surum ayirt etmeden kapatiyordu;
//   - GERI AL betige app_path gondermiyordu (betik in-place'te kurulumu app_path ile dogrular).
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { buildTargets, genOf, kolOf, paketYolu } = require('../discover.cjs');

const IDX = fs.readFileSync(path.join(__dirname, '..', 'index.cjs'), 'utf8');
const dilim = (bas, son) => {
  const i = IDX.indexOf(bas);
  assert.ok(i >= 0, `bulunamadi: ${bas}`);
  const j = IDX.indexOf(son, i + bas.length);
  return IDX.slice(i, j > i ? j : undefined);
};

const r7 = { app: 'GBPOSWEBAPI', host: 'GBJEXP05', env: 'Production', domain: 'x', jboss_version: '7.4.8', app_path: '/vhosting/GBPOSWEBAPI.ear', status: 'running' };
const r8 = { app: 'GBPOSWEBAPI', host: 'GBJEXP05', env: 'Production', domain: 'x', jboss_version: '8.0.0', app_path: '/vhosting8/GBPOSWEBAPI.ear', status: 'running' };

test('IN1 in-place: iki kurulum IKI hedef, satir sirasindan bagimsiz; ikisi de in-place isaretli', () => {
  for (const sira of [[r7, r8], [r8, r7]]) {
    const t = buildTargets('GBPOSWEBAPI', sira, [], [], [], []).targets;
    assert.deepEqual(t.map((x) => [x.host, x.gen, x.appPath]), [['GBJEXP05', 7, '/vhosting/GBPOSWEBAPI.ear'], ['GBJEXP05', 8, '/vhosting8/GBPOSWEBAPI.ear']],
      'in-place sunucuda bir kurulum DUSTU ya da sira degisince farkli hedef cikti');
    assert.ok(t.every((x) => x.inPlace === true), 'in-place isareti yok');
    assert.deepEqual(t.map((x) => x.digerSurumler), [[8], [7]]);
  }
  const tek = buildTargets('GBPOSWEBAPI', [r7], [], [], [], []).targets;
  assert.equal(tek.length, 1);
  assert.ok(!tek[0].inPlace, 'tek kurulumlu sunucu in-place isaretlendi');
});

test('IN2 kurulum kolu = paket dizini (betiklerin GEN\'i); urun surumu yalniz yol yoksa', () => {
  assert.equal(kolOf('/vhosting8/A.ear', '7.4'), 8);
  assert.equal(kolOf('/vhosting/A.ear', '8.0.1'), 7, 'GBJBOP18: /usr/jboss altindaki JBoss 8 urunu 7 kolunda');
  assert.equal(kolOf('NF', '7.4.8'), 7);
  assert.equal(kolOf('', '8.1'), 8);
  assert.equal(kolOf('/baska/A.ear', ''), null);
});

test('IN3 genOf urun majoru: EAP 7.4.8 / 7.3.8 / 7.0.8 JBoss 8 DEGIL', () => {
  for (const v of ['7.4.8', '7.3.8', '7.0.8', 'EAP 7.4.0', '7.4.12', 'jboss7']) assert.equal(genOf(v), 7, v);
  for (const v of ['8.0.1', '8.1', 'EAP 8.0', 'jboss8']) assert.equal(genOf(v), 8, v);
  assert.equal(genOf(''), null);
  assert.equal(genOf('6.4'), null);
});

test('IN4 envanterin NF isareti ve goreli yol paket yolu DEGIL', () => {
  assert.equal(paketYolu('NF'), '');
  assert.equal(paketYolu('vhosting/A.ear'), '');
  assert.equal(paketYolu(' /vhosting/A.ear '), '/vhosting/A.ear');
  const t = buildTargets('GBPOSWEBAPI', [{ ...r7, app_path: 'NF' }], [], [], [], []).targets[0];
  assert.equal(t.appPath, '', "NF AWX'e app_path olarak gidiyordu");
});

test('IN5 in-place hedefte yalniz AD ile eslesen vhost otomatik kapatilmaz (elle); AJP / mod_cluster eslesmesi otomatik kalir', () => {
  const certs = [
    { host: 'GOJBWP05', ip: '', port: '443', server_name: 'gbposwebapi.garanti.com.tr', conf_file: '/ihs/GBPOSWEBAPI.conf', product: 'IHS', env: 'PROD' },
  ];
  const ips = [{ host: 'GOJBAP05', ip: '10.0.0.5' }];
  const jvm = [
    { host: 'GOJBAP05', jvm: 'GBPOSWEBAPI', gen: 7, running: 1, auto_start: 'true', scan_date: '2026-10-21', ports: '', cfg_ports: '8009' },
    { host: 'GOJBAP05', jvm: 'GBPOSWEBAPI', gen: 8, running: 1, auto_start: 'true', scan_date: '2026-10-21', ports: '', cfg_ports: '8108' },
  ];
  const vh = [
    { host: 'GOJBWP05', server_name: 'pos7.garanti.com.tr', aliases: '', listen: '*:443', conf_file: '/ihs/pos7.conf', product: 'IHS', proxy_targets: '10.0.0.5:8009' },
    { host: 'GOJBWP05', server_name: 'pos8.garanti.com.tr', aliases: '', listen: '*:443', conf_file: '/rha/GBPOSWEBAPI.conf', product: 'RHA', proxy_targets: '~DYNAMIC,gbposwebapi' },
  ];
  const a7 = { ...r7, host: 'GOJBAP05', domain: 'garanti.com.tr' };
  const a8 = { ...r8, host: 'GOJBAP05', domain: 'garanti.com.tr' };
  const t = buildTargets('GBPOSWEBAPI', [a7, a8], certs, jvm, vh, ips).targets;
  const yedi = t.find((x) => x.gen === 7);
  const sekiz = t.find((x) => x.gen === 8);
  const otomatik = (x) => x.web.filter((w) => !w.elle).map((w) => w.serverName).sort();
  const elle = (x) => x.web.filter((w) => w.elle).map((w) => w.serverName).sort();
  assert.ok(!otomatik(yedi).includes('pos8.garanti.com.tr'), 'JBoss 7 retire JBoss 8 (mod_cluster) vhostunu otomatik kapatacak');
  assert.ok(otomatik(yedi).includes('pos7.garanti.com.tr'), 'JBoss 7 AJP vhostu (kendi JVM portu) otomatik kalmali');
  assert.ok(otomatik(sekiz).includes('pos8.garanti.com.tr'), 'JBoss 8 mod_cluster vhostu otomatik kalmali');
  assert.ok(!otomatik(sekiz).includes('pos7.garanti.com.tr'), 'JBoss 8 retire JBoss 7 AJP vhostunu otomatik kapatacak');
  for (const x of [yedi, sekiz]) {
    assert.ok(elle(x).includes('gbposwebapi.garanti.com.tr'), `JBoss ${x.gen}: yalniz adla eslesen vhost elle isaretlenmedi`);
    assert.match(x.web.find((w) => w.elle).elle, /in-place: .*elle kontrol edilmeli/);
  }
  // in-place DEGILSE ad eslesmesi eskisi gibi otomatik
  const tek = buildTargets('GBPOSWEBAPI', [a7], certs, jvm, vh, ips).targets[0];
  assert.ok(tek.web.every((w) => !w.elle), 'tek kurulumlu hedefte vhost elle isaretlendi (davranis degismemeli)');
});

test('IN6 elle isaretli vhost web adiminda manual donar, on kontrol plani baslatilmaz', () => {
  const wd = dilim('function webDondur(web) {', '\n}\n');
  assert.match(wd, /status: w\.elle \? 'manual' : 'pending'/, 'elle girdi pending donuyor - web adimi otomatik kapatir');
  const vp = dilim('async function vhostPlanBaslat(', '\n}\n');
  const i = vp.indexOf('if (w.elle)');
  assert.ok(i > 0 && i < vp.indexOf('await launch('), 'elle vhost icin on kontrolde kapatma plani isi baslatiliyor');
});

test('IN7 kayit acarken secim KURULUMU da icerir; in-place hedefte kurulumsuz secim reddedilir; web kesfi kurulumla eslesir', () => {
  const ep = dilim("router.post('/', async (req, res) => {", "router.post('/:id");
  assert.match(ep, /kolAnahtar\(t\.host, t\.appName, t\.gen\)/, 'secim host|app ile eslesiyor - in-place iki kurulumdan biri ya da ikisi birden alinir');
  assert.match(ep, /if \(belirsiz\.length\)\s*return res\.status\(400\)\.json\(\{ ok: false, message: [\s\S]{0,200}hangi kurulumun retire edileceğini seçin/, 'in-place hedefte kurulum belirtilmeden kayit acilabiliyor');
  assert.ok(ep.indexOf('if (belirsiz.length)') < ep.indexOf('INSERT INTO retirement_records'), 'belirsiz secim kontrolu kayit yazildiktan sonra');
  const wk = dilim("router.post('/:id/web-kesif'", "router.post('/:id");
  assert.match(wk, /\(x\.gen \?\? null\) === \(t\.gen == null \? null : Number\(t\.gen\)\)/, 'web kesfi diger kurulumun web listesini bu hedefe ekleyebilir');
});

test('IN8 GERI AL betige app_path gonderir (in-place dogrulamasi)', () => {
  const ep = dilim("router.post('/:id/targets/:tid/rollback'", "const r = await launch(");
  assert.match(ep, /app_path: t\.appPath \|\| ''/, "GERI AL app_path gondermiyor - in-place'te betik durur ya da yanlis kurulumu isler");
});

// IN9 (2026-10-27, kullanici: "Jboss7 sectim gidip Redhat Apache'yi de bulup islem yapmaya calisiyor gibi"):
// JBoss 7 hedefi RHA mod_cluster vhost'unu yalniz adiyla buluyordu; ayni vhost'u JBoss 8 hedefi mod_cluster ile
// kesin eslestiriyor. Diger kurulumun ajp/mc ile sahiplendigi ad-eslesmesi bu hedeften CIKAR; sahipsiz olan elle kalir.
test('IN9 diger kurulumun kesin (ajp/mc) vhost u bu hedefin listesinden cikar; sahipsiz ad eslesmesi elle kalir', () => {
  const { inPlaceIsaretle } = require('../discover.cjs');
  const rha = { host: 'GBJBWT03', serverName: 'gbcorporatebankingservice-d.fw.garanti.com.tr', product: 'RHA', port: '8543', confFile: '/usr/apache/conf.d/GBCORPORATEBANKINGSERVICE-D.conf' };
  const ihs = { host: 'GBJBWT03', serverName: 'gbcorporatebankingservice-d.fw.garanti.com.tr', product: 'IHS', port: '80', confFile: 'mod-jk.conf' };
  const t7 = { host: 'GBJBAT03', appName: 'GBCORPORATEBANKINGSERVICE-D', gen: 7, web: [{ ...ihs, kaynak: 'ad' }, { ...rha, kaynak: 'ad' }] };
  const t8 = { host: 'GBJBAT03', appName: 'GBCORPORATEBANKINGSERVICE-D', gen: 8, web: [{ ...rha, kaynak: 'ad+mc', mcBalancer: 'x' }] };
  inPlaceIsaretle([t7, t8]);
  assert.deepEqual(t7.web.map((w) => w.product), ['IHS'], 'JBoss 7 hedefi JBoss 8 in mod_cluster vhost unu hala listeliyor');
  assert.ok(t7.web[0].elle, 'sahipsiz ad eslesmesi elle isaretlenmedi');
  assert.deepEqual(t8.web.map((w) => [w.product, !!w.elle]), [['RHA', false]], 'JBoss 8 in kesin vhost u bozuldu');
  // Kimse kesin sahiplenmiyorsa iki hedefte de elle kalir (eski davranis)
  const a7 = { ...t7, web: [{ ...rha, kaynak: 'ad' }] };
  const a8 = { ...t8, web: [{ ...rha, kaynak: 'ad' }] };
  inPlaceIsaretle([a7, a8]);
  assert.ok(a7.web.length === 1 && a7.web[0].elle && a8.web.length === 1 && a8.web[0].elle, 'sahipsiz vhost dusuruldu');
});

// IN10 (2026-10-27, kullanici: "Jboss7 secimi yaptigimda neden gidip Redhat Apache'deki vhost'u kesfedip kullaniciya
// yansitiyoruz?"): JBoss 7 hedefinde yalniz ad/sertifika ile eslesen RHA vhost'u listelenmez (in-place olsun olmasin);
// AJP/proxy ile kesin eslesen RHA kalir; JBoss 8 hedefinde RHA ad eslesmesi aynen kalir.
test('IN10 JBoss 7 hedefi yalniz adla eslesen Red Hat Apache vhost unu listelemez; JBoss 8 listeler', () => {
  const certs = [
    { host: 'GOJBWP05', ip: '', port: '443', server_name: 'gbposwebapi.garanti.com.tr', conf_file: '/ihs/GBPOSWEBAPI.conf', product: 'IHS', env: 'PROD' },
    { host: 'GOJBWP05', ip: '', port: '8543', server_name: 'gbposwebapi.garanti.com.tr', conf_file: '/usr/apache/conf.d/GBPOSWEBAPI.conf', product: 'RHA', env: 'PROD' },
  ];
  const a7 = { ...r7, host: 'GOJBAP05', domain: 'garanti.com.tr' };
  const yedi = buildTargets('GBPOSWEBAPI', [a7], certs, [], [], []).targets[0];
  assert.deepEqual(yedi.web.map((w) => w.product), ['IHS'], 'JBoss 7 hedefi RHA ad eslesmesini hala listeliyor');
  assert.match(yedi.webHow, /yalnız adla eşleşen 1 Red Hat Apache vhost'u sayılmadı/);
  const a8 = { ...r8, host: 'GOJBAP05', domain: 'garanti.com.tr' };
  const sekiz = buildTargets('GBPOSWEBAPI', [a8], certs, [], [], []).targets[0];
  assert.ok(sekiz.web.some((w) => w.product === 'RHA'), 'JBoss 8 hedefinde RHA ad eslesmesi kayboldu');
});
