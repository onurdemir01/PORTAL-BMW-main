// server/retirement/__tests__/conf-esdeger.test.cjs — ayni dosya, iki yazim (2026-10-23).
//
// Retirement #27 (GBCEPPOSDASHBOARD): "Web sunucusu kolonundaki duplike satirlar niye duplike?" Her
// hedefte ayni vhost 4 satir (2 duz + 2 AJP). Sertifika envanteri (ihs.sh) conf_file'a yalniz dosya
// adini yaziyor ('mod-jk.conf'), Server Hub mutlak yolu ('/usr/IBMIHS/conf/mod-jk.conf'); kesif ikisini
// ayri saydi, web adimi ayni dosyaya IKI is acti.
// Kural BELIRLENIMCI: IHS urunlu goreli 'X' = '/usr/IBMIHS/conf/X' (ihs.sh FILEPATHS + server_hub_fix
// dosya_coz); urun ailesi anahtarda. Is acilmis / running / ok / bilinmeyen durumlu girdi HIC atilmaz;
// yalniz kosmamis kopyalar birlesir ('elle' olmayan tercih); dosyayi kapatan/kapatmis kardes varsa kosmamis
// kopya duser (kullanicinin yeniden denemesi haric). Iki dusmanca inceleme turunun bulgulari CE5-CE18'de.
//   CE1  kesif: sertifika (goreli) + Server Hub AJP (mutlak) -> 2 satir (80/443), 'ad+ajp', mutlak yol, sira korunur
//   CE2  ikinci IHS kokunun '<...>/conf/X'i birlesmez; /usr/IBMIHS/conf/X birlesir
//   CE3  /usr/IBMIHS/conf.d/X birlesmez
//   CE4  web adimi: kosmamis goreli + mutlak -> TEK is, mutlak yol
//   CE5  is acilmis iki 'ok' kaydi ikisi de kalir (geri alma izi bozulmaz)
//   CE5b bilinmeyen durum (geri alma ara durumu) hic birlesmez
//   CE6  Server Hub asil dosyayi AJP'siz (~DYNAMIC) gorup baska kokun dosyasini AJP'li gorurse goreli girdi oraya BAGLANMAZ
//   CE7  farkli ServerName ayni dosyada ayri kalir
//   CE8  kanonik anahtar: IHS goreli = IHS mutlak; RHA, urunsuz ve RHA etiketli /usr/IBMIHS yolu ayri
//   CE9  web kesfini yenile ucu kanonik anahtarla karsilastirir
//   CE10 [goreli failed, mutlak ok]: ikisi de kalir; yeniden deneme KOSAR (zaten yorumlu -> OK), zamanlayici onu atmaz
//   CE10b [goreli failed, mutlak pending]: bekleyen is kosar
//   CE11 [goreli pending, mutlak running]: kosmamis kopya duser, calisan is korunur
//   CE12 in-place: 'elle' goreli + AJP kanitli mutlak (kosmamis) -> AJP kanitli olan kalir
//   CE13 IHS goreli + RHA mutlak ayni ad birlesmez (liste ve kesif)
//   CE14 [goreli failed, mutlak failed]: yeniden denemede TEK is, mutlak yolla; ikinci yazim listeden duser
//   CE15 [goreli ok, mutlak failed]: yeniden deneme secimi BOS DEGIL (onizleme onaylanabilir, dugme takilmaz)
//   CE16 eski kayit [ok j1, running j2] + baska bekleyen: zamanlayici ikisini de korur (geri alma ok'u bulur)
//   CE17 ayni dosyada is suruyorsa yeniden deneme o girdiyi denemez
//   CE18 kosmamis bekleyen kopya + ayni dosyada 'ok': kopya duser (gereksiz ikinci is yok)
//   CE19 RHA / urunsuz goreli girdinin yolu yukseltilmez (is yanlis koke gitmez)
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { buildTargets } = require('../discover.cjs');
const { webTekille, webKanonikAnahtar, webYenidenDeneHazirla } = require('../web-liste.cjs');

const IDX = fs.readFileSync(path.join(__dirname, '..', 'index.cjs'), 'utf8');
const uc = (bas) => {
  const i = IDX.indexOf(bas);
  assert.ok(i > 0, `uc yok: ${bas}`);
  return IDX.slice(i, IDX.indexOf('router.', i + 20));
};

const APP = 'GBCEPPOSDASHBOARD';
const SN = 'gbcepposdashboard.fw.garantibbva.com.tr';
const MUTLAK = '/usr/IBMIHS/conf/mod-jk.conf';
const inv = [{ app: APP, host: 'GBJBOAP13', env: 'Production', domain: 'fw.garantibbva.com.tr', jboss_version: '7.4.8', app_path: '/vhosting/GBCEPPOSDASHBOARD.ear', status: 'running' }];
const cert = (conf, product = 'IHS', portlar = ['80', '443']) => portlar.map((port) => ({ host: 'GBJBOAP13', ip: '10.0.0.13', port, server_name: SN, conf_file: conf, product, env: '' }));
const jvm = [{ host: 'GBJBOAP13', jvm: APP, gen: 7, ports: '', cfg_ports: '8109,8180' }];
const hub = (conf, { product = 'IHS', px = 'localhost:8109', portlar = ['80', '443'] } = {}) =>
  portlar.map((p) => ({ host: 'GBJBOAP13', server_name: SN, aliases: '', listen: `*:${p}`, conf_file: conf, product, proxy_targets: px }));
const web = (vhosts, certs = cert('mod-jk.conf')) => buildTargets(APP, inv, certs, jvm, vhosts).targets[0].web;
const g = (ek) => ({ host: 'GBJBOAP13', serverName: SN, product: 'IHS', ...ek });

test('CE1 sertifika goreli + Server Hub mutlak ayni dosya: 2 satir, ad+ajp, mutlak yol, sira korunur', () => {
  const w = web(hub(MUTLAK));
  assert.deepEqual(w.map((x) => `${x.port}|${x.kaynak}|${x.confFile}`), [`80|ad+ajp|${MUTLAK}`, `443|ad+ajp|${MUTLAK}`]);
  assert.ok(w.every((x) => x.ajpHedef === 'localhost:8109'));
});

test('CE2 ikinci IHS kokunun dosyasi birlesmez; /usr/IBMIHS/conf/X birlesir', () => {
  const w = web([...hub(MUTLAK), ...hub('/opt/IHS2/conf/mod-jk.conf')]);
  assert.deepEqual(w.map((x) => `${x.kaynak}|${x.confFile}`), [
    `ad+ajp|${MUTLAK}`, `ad+ajp|${MUTLAK}`, 'ajp|/opt/IHS2/conf/mod-jk.conf', 'ajp|/opt/IHS2/conf/mod-jk.conf',
  ]);
});

test('CE3 /usr/IBMIHS/conf.d/X birlesmez', () => {
  assert.deepEqual(web(hub('/usr/IBMIHS/conf.d/mod-jk.conf')).map((x) => x.kaynak), ['ad', 'ad', 'ajp', 'ajp']);
});

test('CE4 web adimi: kosmamis goreli + mutlak -> TEK is, mutlak yol', () => {
  const t = webTekille([g({ confFile: 'mod-jk.conf', status: 'pending' }), g({ host: 'gbjboap13', serverName: SN.toUpperCase(), confFile: MUTLAK, status: 'pending' })]);
  assert.equal(t.atilan, 1);
  assert.deepEqual(t.liste.map((x) => x.confFile), [MUTLAK]);
});

test('CE5 is acilmis iki ok kaydi ikisi de kalir, nesneler aynen', () => {
  const a = g({ confFile: 'mod-jk.conf', status: 'ok', jobId: 1 });
  const b = g({ confFile: MUTLAK, status: 'ok', jobId: 2 });
  const t = webTekille([a, b]);
  assert.equal(t.atilan, 0);
  assert.equal(t.liste[0], a);
  assert.equal(t.liste[1], b);
});

test('CE5b bilinmeyen durum (geri alma ara durumu) hic birlesmez', () => {
  const r = g({ confFile: MUTLAK, status: 'restoring' });
  const t = webTekille([g({ confFile: 'mod-jk.conf', status: 'pending' }), r]);
  assert.ok(t.liste.includes(r));
  assert.equal(t.liste.length, 2);
});

test('CE6 asil dosya AJP siz (~DYNAMIC), baska kokun dosyasi AJP li: goreli girdi baska koke BAGLANMAZ', () => {
  const w = web([...hub(MUTLAK, { px: '~DYNAMIC', portlar: ['443'] }), ...hub('/usr/IBMIHS/inst2/conf/mod-jk.conf', { portlar: ['443'] })], cert('mod-jk.conf', 'IHS', ['443']));
  assert.deepEqual(w.map((x) => `${x.kaynak}|${x.confFile}`), ['ad|mod-jk.conf', 'ajp|/usr/IBMIHS/inst2/conf/mod-jk.conf']);
  const tek = webTekille(w).liste;
  assert.deepEqual(tek.map((x) => x.confFile), [MUTLAK, '/usr/IBMIHS/inst2/conf/mod-jk.conf'], 'asil blok kapatilmadan kalir');
});

test('CE7 farkli ServerName ayni dosyada ayri kalir', () => {
  const t = webTekille([g({ confFile: 'mod-jk.conf', status: 'pending' }), g({ serverName: 'baska.fw.garantibbva.com.tr', confFile: MUTLAK, status: 'pending' })]);
  assert.equal(t.atilan, 0);
});

test('CE8 kanonik anahtar: IHS goreli = IHS mutlak; RHA, urunsuz ve RHA etiketli /usr/IBMIHS yolu ayri', () => {
  assert.equal(webKanonikAnahtar(g({ confFile: 'mod-jk.conf' })), webKanonikAnahtar(g({ confFile: MUTLAK })));
  assert.equal(webKanonikAnahtar(g({ product: 'IBMIHS', confFile: 'mod-jk.conf' })), webKanonikAnahtar(g({ confFile: MUTLAK })));
  assert.notEqual(webKanonikAnahtar(g({ product: 'RHA', confFile: 'mod-jk.conf' })), webKanonikAnahtar(g({ confFile: MUTLAK })));
  assert.notEqual(webKanonikAnahtar(g({ product: '', confFile: 'mod-jk.conf' })), webKanonikAnahtar(g({ confFile: MUTLAK })));
  assert.notEqual(webKanonikAnahtar(g({ confFile: 'httpd.conf' })), webKanonikAnahtar(g({ product: 'RHA', confFile: '/usr/IBMIHS/conf/httpd.conf' })));
});

test('CE9 web kesfini yenile ucu kanonik anahtarla karsilastirir', () => {
  const k = uc("router.post('/:id/web-kesif'");
  assert.match(k, /const eskiK = new Set\(\(t\.web \|\| \[\]\)\.map\(\(w\) => webKanonikAnahtar\(w\)\)\)/);
  assert.match(k, /const eklenen = yeniWeb\.filter\(\(w\) => !eskiK\.has\(webKanonikAnahtar\(w\)\)\)/, 'eklenen ham anahtarla bulunuyor');
});

test('CE10 [goreli failed, mutlak ok]: ikisi de kalir; yeniden deneme kosar ve zamanlayici onu atmaz', () => {
  const fail = g({ confFile: 'mod-jk.conf', status: 'failed', jobId: 4001 });
  const ok = g({ confFile: MUTLAK, status: 'ok', jobId: 4002 });
  assert.deepEqual(webTekille([fail, ok]).liste, [fail, ok], 'is acilmis girdi atildi');
  const h = webYenidenDeneHazirla([fail, ok]);
  assert.deepEqual(h.secilen.map((x) => `${x.status}|${x.confFile}|${x.oncekiJobId}`), [`pending|${MUTLAK}|4001`]);
  assert.ok(webTekille(h.liste).liste.includes(h.secilen[0]), 'zamanlayici yeniden denemeyi dosya kapali diye atiyor');
  assert.ok(h.liste.includes(ok));
});

test('CE10b [goreli failed, mutlak pending]: bekleyen is kosar', () => {
  const t = webTekille([g({ confFile: 'mod-jk.conf', status: 'failed', jobId: 4001 }), g({ confFile: MUTLAK, status: 'pending' })]);
  assert.ok(t.liste.some((x) => x.status === 'pending' && x.confFile === MUTLAK));
});

test('CE11 [goreli pending, mutlak running]: kosmamis kopya duser, calisan is korunur', () => {
  const kosan = g({ confFile: MUTLAK, status: 'running', jobId: 4002 });
  assert.deepEqual(webTekille([g({ confFile: 'mod-jk.conf', status: 'pending' }), kosan]).liste, [kosan]);
});

test('CE12 in-place: elle goreli + AJP kanitli mutlak (kosmamis) -> AJP kanitli olan kalir', () => {
  const t = webTekille([g({ confFile: 'mod-jk.conf', port: '443', kaynak: 'ad', elle: 'in-place: yalniz ad' }), g({ confFile: MUTLAK, port: '80', kaynak: 'ajp' })]);
  assert.equal(t.liste.length, 1);
  assert.equal(t.liste[0].kaynak, 'ajp');
  assert.ok(!t.liste[0].elle, 'AJP kanitli vhost elle kaldi - otomatik kapatilmaz');
});

test('CE13 IHS goreli + RHA mutlak ayni ad birlesmez (liste ve kesif)', () => {
  const t = webTekille([g({ confFile: 'httpd.conf', status: 'pending' }), g({ product: 'RHA', confFile: '/usr/apache/conf/httpd.conf', status: 'pending' })]);
  assert.equal(t.atilan, 0);
  const t2 = webTekille([g({ confFile: 'httpd.conf', status: 'pending' }), g({ product: 'RHA', confFile: '/usr/IBMIHS/conf/httpd.conf', status: 'pending' })]);
  assert.equal(t2.atilan, 0, 'IHS girdisi RHA etiketli girdiyle birlesti');
  const w = web(hub('/usr/IBMIHS/conf/httpd.conf', { product: 'RHA' }), cert('httpd.conf'));
  assert.ok(w.every((x) => !(x.product === 'IHS' && x.confFile.startsWith('/usr/IBMIHS') && x.kaynak === 'ad+ajp')), 'IHS girdisi RHA satiriyla birlesti');
});

test('CE14 [goreli failed, mutlak failed]: yeniden denemede TEK is, mutlak yolla; ikinci yazim duser', () => {
  const ham = [g({ confFile: 'mod-jk.conf', status: 'failed', jobId: 1 }), g({ confFile: MUTLAK, status: 'failed', jobId: 2 })];
  assert.equal(webTekille(ham).liste.length, 2, 'is acilmis girdiler listede kalmali');
  const h = webYenidenDeneHazirla(ham);
  assert.deepEqual(h.secilen.map((x) => `${x.status}|${x.confFile}`), [`pending|${MUTLAK}`]);
  assert.equal(h.liste.length, 1);
});

test('CE15 [goreli ok, mutlak failed]: yeniden deneme secimi bos degil (onay acik, dugme takilmaz)', () => {
  const h = webYenidenDeneHazirla([g({ confFile: 'mod-jk.conf', status: 'ok', jobId: 1 }), g({ confFile: MUTLAK, status: 'failed', jobId: 2 })]);
  assert.equal(h.secilen.length, 1);
  assert.equal(h.secilen[0].oncekiJobId, 2);
});

test('CE16 eski kayit [ok j1, running j2] + baska bekleyen: zamanlayici ikisini de korur', () => {
  const ok = g({ confFile: 'mod-jk.conf', status: 'ok', jobId: 1 });
  const kosan = g({ confFile: MUTLAK, status: 'running', jobId: 2 });
  const baska = g({ serverName: 'baska.fw.garantibbva.com.tr', confFile: MUTLAK, status: 'pending' });
  const t = webTekille([ok, kosan, baska]);
  assert.deepEqual(t.liste, [ok, kosan, baska]);
});

test('CE17 ayni dosyada is suruyorsa yeniden deneme o girdiyi denemez', () => {
  const h = webYenidenDeneHazirla([g({ confFile: 'mod-jk.conf', status: 'failed', jobId: 1 }), g({ confFile: MUTLAK, status: 'running', jobId: 2 })]);
  assert.equal(h.secilen.length, 0);
  assert.equal(h.surenYuzunden, 1);
  assert.equal(h.liste.length, 2);
});

test('CE18 kosmamis bekleyen kopya + ayni dosyada ok: kopya duser (gereksiz ikinci is yok)', () => {
  const ok = g({ confFile: MUTLAK, status: 'ok', jobId: 2 });
  assert.deepEqual(webTekille([g({ confFile: 'mod-jk.conf', status: 'pending' }), ok]).liste, [ok]);
});

test('CE19 RHA ve urunsuz goreli girdinin yolu HIC yukseltilmez (is yanlis koke gitmez)', () => {
  const rha = g({ product: 'RHA', confFile: 'httpd.conf', status: 'pending' });
  const urunsuz = g({ product: '', serverName: 'b.fw.garantibbva.com.tr', confFile: 'x.conf' });
  assert.deepEqual(webTekille([rha, urunsuz]).liste.map((x) => x.confFile), ['httpd.conf', 'x.conf']);
  const h = webYenidenDeneHazirla([g({ product: 'RHA', confFile: 'httpd.conf', status: 'failed', jobId: 7 })]);
  assert.equal(h.secilen[0].confFile, 'httpd.conf');
});
