// server/nginx-console/__tests__/admin-kapisi.test.cjs
//
// URETIM (2026-10-14): Admin > "Nginx Hub Erisimi"nden yalniz "SPA Kesfi & Kapsam" acilan Admin
// olmayan kullanici "SPA kesfi okunamadi: Unexpected token '<'" aldi. Router'in 2026-09-19'dan kalma
// "yalniz Admin" kapisi panelin verdigi izni 403 ile geri cevirmisti.
//   AK1 Admin her uca gecer
//   AK2 Admin olmayan YALNIZ salt okunur SPA kesfi uclarina (GET) gecer; ardindan sayfa + sekme kapisi
//   AK3 yazan uclar ve dokum sekmeleri Admin'de kalir
//   AK4 gorunurluk kapisi kurulamadiysa Admin olmayan hicbir yere gecemez (kapi acik kalmaz)
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { _adminKapisi } = require('../index.cjs');

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

test('AK2 Admin olmayan salt okunur SPA kesfi uclarina gecer', () => {
  const k = _adminKapisi(() => true);
  assert.equal(kos(k, { rol: 'User', path: '/spa-discovery' }).gecti, true);
  assert.equal(kos(k, { rol: 'User', path: '/spa-discovery/rp' }).gecti, true);
});

test('AK3 yazan uclar ve dokum sekmeleri Admin disina kapali (403 JSON)', () => {
  const k = _adminKapisi(() => true);
  for (const [method, path] of [
    ['POST', '/spa-discovery'],
    ['POST', '/push'],
    ['POST', '/refresh'],
    ['GET', '/hosts'],
    ['GET', '/tree/GBNGXP40'],
    ['GET', '/file/GBNGXP40'],
    ['GET', '/spa-discovery-x'],
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
