// server/nginx-console/__tests__/admin-kapisi.test.cjs
//
// URETIM (2026-10-14): Admin > "Nginx Hub Erisimi"nden yalniz "SPA Kesfi & Kapsam" acilan Admin
// olmayan kullanici "SPA kesfi okunamadi: Unexpected token '<'" aldi. Router'in 2026-09-19'dan kalma
// "yalniz Admin" kapisi panelin verdigi izni 403 ile geri cevirmisti.
//   AK1 Admin her uca gecer
//   AK2 Admin olmayan YALNIZ salt okunur uclara (GET) gecer; ardindan sayfa + sekme kapisi
//       (2026-10-14 kullanici karari: panelden acilan TUM Nginx Hub sekmeleri salt okunur)
//   AK3 yazan uclar ve Admin'in islerini izleyen /job-status Admin'de kalir
//   AK6 acilan her uc (/hosts haric) bir sekmeye bagli: kullanici yalniz kendi sekmesini okur
//   AK7 CIS: skor ve sunucu ayrintisi okunur; istisna/kabul/yeniden tarama Admin'de
//   AK4 gorunurluk kapisi kurulamadiysa Admin olmayan hicbir yere gecemez (kapi acik kalmaz)
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { _adminKapisi, _ADMIN_DISI_OKUMA, _SEKME_YOLLARI } = require('../index.cjs');
const { adminOkumaKapisi } = require('../../auth/admin-okuma-kapisi.cjs');
const { _CIS_ADMIN_DISI_OKUMA } = require('../../nginx-cis/index.cjs');

/** Admin olmayana ACIK olmasi gereken salt okunur uclar (ornek yollar). */
const ACIK = [
  '/hosts',
  '/tree/GBNGXP40',
  '/file/GBNGXP40',
  '/compare',
  '/certs',
  '/drift',
  '/orphans',
  '/ratelimit',
  '/ratelimit.csv',
  '/changes',
  '/history/GBNGXP40',
  '/blob/abc123',
  '/spa-discovery',
  '/spa-discovery/rp',
];

function kos(kapi, { rol, method = 'GET', path }) {
  let gecti = false;
  let durum = 200;
  let govde = null;
  const req = { method, path, session: { user: { role: rol } } };
  const res = {
    status(s) {
      durum = s;
      return this;
    },
    json(b) {
      govde = b;
      return this;
    },
  };
  kapi(req, res, () => {
    gecti = true;
  });
  return { gecti, durum, govde };
}

test('AK1 Admin her uca gecer', () => {
  const k = _adminKapisi(() => true);
  for (const [method, path] of [['GET', '/hosts'], ['POST', '/push'], ['GET', '/file/GBNGXP40']])
    assert.equal(kos(k, { rol: 'Admin', method, path }).gecti, true, path);
});

test('AK2 Admin olmayan salt okunur uclara gecer', () => {
  const k = _adminKapisi(() => true);
  for (const path of ACIK) assert.equal(kos(k, { rol: 'User', path }).gecti, true, path);
});

test('AK3 yazan uclar ve dokum sekmeleri Admin disina kapali (403 JSON)', () => {
  const k = _adminKapisi(() => true);
  for (const [method, path] of [
    ['POST', '/spa-discovery'],
    ['POST', '/push'],
    ['POST', '/refresh'],
    ['POST', '/orphans/cleanup'],
    ['GET', '/job-status/1/2'],
    ['GET', '/spa-discovery-x'],
    ['GET', '/blob'],
  ]) {
    const r = kos(k, { rol: 'User', method, path });
    assert.equal(r.gecti, false, `${method} ${path}`);
    assert.equal(r.durum, 403);
    assert.equal(r.govde.ok, false);
  }
});

test('AK4 gorunurluk kapisi yoksa Admin olmayan SPA kesfine de gecemez', () => {
  const k = _adminKapisi(() => false);
  assert.equal(kos(k, { rol: 'User', path: '/spa-discovery' }).gecti, false);
  assert.equal(kos(k, { rol: 'Admin', path: '/spa-discovery' }).gecti, true);
});

test('AK5 router kapiyi kullanir; gorunurluk kapisi (sayfa + sekme) ondan SONRA ve hazir isareti en sonda', () => {
  const s = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'index.cjs'), 'utf8');
  const kapi = s.indexOf('router.use(adminKapisi(() => gorunurlukKapisi));');
  const sayfa = s.indexOf("router.use(requireVisiblePrefix('NginxConsole'));");
  const sekme = s.indexOf("requireVisible('tab:nginx:' + hit[1])");
  const hazir = s.indexOf('gorunurlukKapisi = true;');
  assert.ok(kapi > 0 && sayfa > kapi && sekme > sayfa && hazir > sekme, `${kapi} ${sayfa} ${sekme} ${hazir}`);
  // "hazir" yalniz kapilar BASARIYLA kurulunca (try icinde, catch'ten once) isaretlenir.
  assert.ok(hazir < s.indexOf('} catch {', sekme), 'gorunurluk hazir isareti catch icinde/sonrasinda');
  assert.ok(s.includes("[/^\\/spa-discovery(\\/|$)/, 'spadiscovery']"), 'SPA kesfi sekme kapisina bagli degil');
});

test('AK6 acilan her uc (/hosts haric) bir sekmeye bagli; /hosts hicbir sekmeye bagli degil', () => {
  for (const path of ACIK) {
    const sekme = _SEKME_YOLLARI.find(([re]) => re.test(path));
    if (path === '/hosts') assert.equal(sekme, undefined, '/hosts bir sekmeye baglanmis - diger sekmeler kirilir');
    else assert.ok(sekme, `${path} acik ama hicbir sekmeye bagli degil (sayfa erisimi olan herkes okur)`);
  }
  // Listedeki her desen en az bir ornekle sinanmis olmali (yeni acilan uc testsiz kalmasin).
  for (const re of _ADMIN_DISI_OKUMA) assert.ok(ACIK.some((p) => re.test(p)), `ornegi olmayan desen: ${re}`);
});

test('AK7 CIS: skor ve sunucu ayrintisi okunur; istisna, kabul edilen deger ve yeniden tarama Admin de', () => {
  const k = adminOkumaKapisi({ okuma: _CIS_ADMIN_DISI_OKUMA, mesaj: 'CIS denetimi yalnız Admin.', hazir: () => true });
  assert.equal(kos(k, { rol: 'User', path: '/overview' }).gecti, true);
  assert.equal(kos(k, { rol: 'User', path: '/host/GBNGXP40' }).gecti, true);
  for (const [method, path] of [
    ['PUT', '/exceptions'],
    ['DELETE', '/exceptions/5'],
    ['PUT', '/overrides'],
    ['DELETE', '/overrides/5'],
    ['POST', '/rescan'],
    ['GET', '/job-status/1/2'],
  ]) assert.equal(kos(k, { rol: 'User', method, path }).gecti, false, `${method} ${path}`);
  const cis = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', '..', 'nginx-cis', 'index.cjs'), 'utf8');
  const kapi = cis.indexOf('adminOkumaKapisi({');
  assert.ok(kapi > 0 && cis.indexOf("requireVisible('tab:nginx:cis')") > kapi, 'CIS kapisi sekme kapisindan once degil');
  const sekme = cis.indexOf("requireVisible('tab:nginx:cis')");
  const hazir = cis.indexOf('gorunurlukKapisi = true;');
  assert.ok(hazir > sekme && hazir < cis.indexOf('} catch', sekme), 'CIS hazir isareti try disinda (motor yokken de acik)');
});
