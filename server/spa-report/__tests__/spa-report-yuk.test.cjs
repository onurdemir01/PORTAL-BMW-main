// server/spa-report/__tests__/spa-report-yuk.test.cjs — ARK SPA Raporu "Yuk Durumu" (2026-10-02).
//
// Rapordaki "yuk almiyor (emekli adayi)" suzgeci traffic.state === 'idle' satirlarini
// listeler. Eskiden durum `req7 > 0 ? active : sampled ? unknown : idle` idi: gunluk
// rotasyonlu hostta (nginx_log_rotate 'rotate 3') okunan log 1-4 gun kalip sampled=0 basinca
// bu satirlar EMEKLI ADAYI listesine giriyordu. Kural artik ortak (nginx-migration.cjs
// spaTrafikDurumu); burada loadReport sahte MSSQL ile GERCEKTEN kosulur.
//
// AY1 kisa pencere -> 'unknown' + kismi ['pencere'] (emekli adayi suzgecine GIRMEZ)
// AY2 tam pencere + her mirror olculdu -> 'idle'
// AY3 okunamayan mirror (LOADERR host|vhost) / satirsiz mirror -> 'idle' DEGIL
// AY4 first_seen kolonu yok -> sorgu dusmez, 'idle' DEGIL
// AY5 host kipi satirlari ('@', vhost '_') rapora yazilmaz, "olcum var" saymaz
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const SERVER = path.join(__dirname, '..', '..');
function sahteModul(rel, exportsObj) {
  const p = require.resolve(path.join(SERVER, rel));
  require.cache[p] = { id: p, filename: p, loaded: true, exports: exportsObj, children: [], paths: [] };
}

const GUN = '2026-10-02';
const TAM = '20260924000000'; // 8 gun
const ROT3 = '20260929031500'; // ~3 gun

let DB = null;
const SORGULAR = [];
async function query(text) {
  const t = String(text);
  SORGULAR.push(t);
  const rs = (recordset) => ({ recordset });
  if (t.includes("OBJECT_ID('dbo.Nginx_Spa_Traffic')")) return rs([{ trf: 1, fs: DB.fs }]);
  if (t.includes('FROM dbo.Nginx_Spa_Traffic')) {
    if (!DB.fs && /first_seen/.test(t.replace(/AS first_seen/g, '')))
      throw new Error("Invalid column name 'first_seen'.");
    return rs(DB.trafik);
  }
  if (t.includes('MAX(scan_date), 23) AS d FROM dbo.Nginx_Config_Audit')) return rs([{ d: GUN }]);
  if (t.includes('FROM dbo.Nginx_Config_Audit')) return rs(DB.config);
  return rs([]);
}
sahteModul('inventory/mssql.cjs', { query, sql: new Proxy({}, { get: () => () => 'tip' }) });
sahteModul('db/index.cjs', { query: async () => ({ rows: [] }) });

const { loadReport } = require('../index.cjs');

const CFG = (host, o = {}) => ({
  service: 'GLOMO',
  env: 'PROD',
  application: 'kart-app-v1',
  namespace: 'kart-prod',
  location_path: '/kart/',
  host,
  vhost: 'GLOMO-PROD',
  ...o,
});
const LOAD = (host, o = {}) => ({
  host,
  vhost: 'GLOMO-PROD',
  service: 'GLOMO',
  env: 'PROD',
  location: '/kart/',
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
const LOADERR = (host, vhost) => ({
  ...LOAD(host),
  vhost,
  service: null,
  env: null,
  location: null,
  req_24h: null,
  req_7d: null,
  hc_24h: null,
  error: 'log www ile okunamiyor: /web_log/glomo.log',
  first_seen: null,
});

async function rapor(db) {
  DB = { fs: 40, ...db };
  SORGULAR.length = 0;
  const r = await loadReport(true);
  assert.equal(r.ok, true);
  return r;
}
// Ekranin "yuk almiyor (emekli adayi)" suzgeci ile AYNI kosul (ArkSpaRaporuPage.tsx).
const emekliAdayi = (r) => r.rows.filter((x) => (x.traffic ? x.traffic.state : 'none') === 'idle');
const IKI = [CFG('H1'), CFG('H2')];

test('AY1 gunluk rotasyon (~3 gun, sampled=0) emekli adayi suzgecine GIRMEZ', async () => {
  const r = await rapor({ config: IKI, trafik: [LOAD('H1', { first_seen: ROT3 }), LOAD('H2', { first_seen: ROT3 })] });
  const t = r.rows[0].traffic;
  assert.equal(t.state, 'unknown', '3 gunluk olcum "yuk almiyor" gosterildi');
  assert.deepEqual(t.kismi, ['pencere']);
  assert.equal(t.pencereSaat, 68);
  assert.equal(emekliAdayi(r).length, 0, 'kisa pencere emekli adayi listesine girdi');
});

test('AY2 tam pencere + her mirror olculdu + istek yok -> idle (emekli adayi)', async () => {
  const r = await rapor({ config: IKI, trafik: [LOAD('H1'), LOAD('H2')] });
  assert.equal(r.rows[0].traffic.state, 'idle');
  assert.equal(emekliAdayi(r).length, 1);
  const yuk = await rapor({ config: IKI, trafik: [LOAD('H1', { first_seen: ROT3, req_7d: 3 }), LOAD('H2')] });
  assert.equal(yuk.rows[0].traffic.state, 'active');
  assert.equal(yuk.rows[0].traffic.req7, 3);
});

test('AY3 okunamayan / satirsiz mirror -> idle DEGIL', async () => {
  const ok = await rapor({ config: IKI, trafik: [LOAD('H1'), LOADERR('H2', 'GLOMO-PROD')] });
  assert.equal(ok.rows[0].traffic.state, 'unknown', 'okunamayan mirror sessizce yok sayildi');
  assert.equal(ok.rows[0].traffic.unknownHosts, 1);
  const eksik = await rapor({ config: IKI, trafik: [LOAD('H1')] });
  assert.equal(eksik.rows[0].traffic.state, 'unknown');
  assert.equal(eksik.rows[0].traffic.missingHosts, 1);
  assert.equal(emekliAdayi(eksik).length, 0);
});

test('AY4 first_seen kolonu YOK: sorgu dusmez ve "yuk almiyor" denmez', async () => {
  const r = await rapor({ config: IKI, fs: null, trafik: [LOAD('H1', { first_seen: null }), LOAD('H2', { first_seen: null })] });
  assert.equal(r.trafficReady, true, 'kolon yokken trafik sorgusu dustu');
  assert.equal(r.rows[0].traffic.state, 'unknown');
  assert.deepEqual(r.rows[0].traffic.kismi, ['pencere-bilinmiyor']);
});

test('AY6 tanim sunuculari rapor satiriyla AYNI normalizasyonla bulunur (bosluk / harf)', async () => {
  // build.cjs satiri U(service) / U(env) / T(location) ile kurar; tanim sunuculari baska
  // anahtarla tutulsaydi bulunamaz, H2'nin satirsizligi gorulmez ve 0 "idle" olurdu.
  const cfg = [CFG('H1', { service: ' glomo', env: 'prod ' }), CFG('H2', { service: 'Glomo', location_path: '/kart/ ' })];
  const r = await rapor({ config: cfg, trafik: [LOAD('H1')] });
  assert.equal(r.rows.length, 1);
  assert.equal(r.rows[0].traffic.state, 'unknown', 'tanim sunuculari kayboldu: satirsiz mirror gorulmedi');
  assert.equal(r.rows[0].traffic.missingHosts, 1);
});

test('AY5 host kipi satirlari ve kovalar rapora yazilmaz, "olcum var" saymaz', async () => {
  const hk = [
    { ...LOAD('H1', { service: null, env: null, location: '@kart.irp.local', req_7d: 900 }), vhost: 'kart-app-v1-kart-prod' },
    { ...LOAD('H1', { service: null, env: null, location: '@_', req_7d: 240 }), vhost: '_' },
  ];
  const yalniz = await rapor({ config: [CFG('H1')], trafik: hk });
  assert.equal(yalniz.trafficReady, false, 'host kipi satiri "yuk olcumu var" sayildi');
  assert.equal(yalniz.rows[0].traffic, null);
  const karisik = await rapor({ config: [CFG('H1')], trafik: [...hk, LOAD('H1')] });
  assert.equal(karisik.rows[0].traffic.state, 'idle');
  assert.equal(karisik.rows[0].traffic.req7, 0);
  const trf = SORGULAR.find((s) => s.includes('FROM dbo.Nginx_Spa_Traffic') && s.includes('req_7d'));
  assert.match(trf, /location NOT LIKE '@%'/, 'host kipi satirlari SQL de suzulmuyor');
  assert.match(trf, /scan_date, 23\) AS scan_date/);
});
