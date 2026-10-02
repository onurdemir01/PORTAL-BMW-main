// server/audit/__tests__/spa-traffic-proxy.test.cjs - Denetim > Nginx SPA, PROD PROXY satirlarinin
// yuk olcumu (2026-10-02 dogrulama bulgusu).
//
// Eski GBRVP* sunucularindaki proxy_pass satirlari (kind='proxy') cozulup PROD matrisine
// status='PROXY' SPA satiri gibi katilir (denetim.cjs). Bu satirlar trafik tanimina da
// (trafikTanim: anahtar -> tanimin sunuculari) GIRMELIDIR: yoksa o gun satiri olmayan eski
// mirror (zaman asimi) yok sayilir ve hucre "yuk yok - atil aday" olur.
//
// NEDEN AYRI DOSYA: spa-traffic.test.cjs sahte DB'si proxy kolon sorgusuna n:0 doner ve
// denetim.cjs hasProxyColumns sonucunu SUREC BASINA onbellege alir (PROXY_COLS_TTL). Ayni
// surecte n:4 donmek o onbellek yuzunden PROD proxy dalini hic acmazdi; node --test her
// dosyayi ayri surecte kosar.
//
//   T10 proxy satirlari tanimin sunucularina girer: GBRVPP08'in o gun satiri yoksa idle DEGIL
'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const SERVER = path.join(__dirname, '..', '..');
function sahteModul(rel, exportsObj) {
  const p = require.resolve(path.join(SERVER, rel));
  require.cache[p] = { id: p, filename: p, loaded: true, exports: exportsObj, children: [], paths: [] };
}
const gec = (_req, _res, next) => next();

const GUN = '2026-10-02';
const TAM = '20260924000000'; // 8 gun

let DB = null; // { trafik }
async function query(text) {
  const t = String(text);
  const rs = (recordset) => ({ recordset });
  // hasProxyColumns: proxy kolonlari VAR -> PROD proxy dali acilir.
  if (t.includes('FROM sys.columns') && t.includes('Nginx_Config_Audit')) return rs([{ n: 4 }]);
  if (t.includes("OBJECT_ID('dbo.Nginx_Spa_Traffic')")) return rs([{ trf: 1, fs: 40 }]);
  if (t.includes('FROM dbo.Nginx_Spa_Traffic')) return rs(DB.trafik);
  if (t.includes('MAX(scan_date), 23) AS d FROM dbo.Nginx_Config_Audit')) return rs([{ d: GUN }]);
  if (t.includes('SELECT DISTINCT TOP 30')) return rs([{ d: GUN }]);
  if (t.includes('FROM dbo.Nginx_Config_Audit') && t.includes("kind = 'proxy'")) {
    return rs(
      ['GBRVPP07', 'GBRVPP08'].map((host) => ({
        service: 'GLOMO',
        env: 'PROD',
        host,
        vhost: 'GLOMO-PROD',
        location_path: '/kart/',
        upstream_name: 'kart-app-v1-kart-prod.apps.fw.garanti.com.tr',
        target_url: 'https://kart-app-v1-kart-prod.apps.fw.garanti.com.tr/',
      })),
    );
  }
  if (t.includes('FROM dbo.Openshift_Inventory'))
    return rs([{ namespace: 'kart-prod', application: 'kart-app-v1' }]);
  if (t.includes('FROM dbo.Nginx_Config_Audit')) return rs([]); // SPA satiri yok: yalniz proxy
  return rs([]); // route envanteri, dizin bayraklari, ekip sahipligi, tarama saati
}
sahteModul('inventory/mssql.cjs', {
  query,
  queryLong: query,
  sql: new Proxy({}, { get: () => () => 'tip' }),
});
sahteModul('auth/index.cjs', { requireAuth: gec, requireAdmin: gec, getRequestUser: () => null });
sahteModul('auth/visibility.cjs', { requireVisiblePrefix: () => gec, requireVisible: () => gec });

let sunucu = null;
let taban = '';
before(async () => {
  const express = require('express');
  const app = express();
  require('../denetim.cjs').initDenetim(app);
  await new Promise((ok) => {
    sunucu = app.listen(0, '127.0.0.1', ok);
  });
  taban = `http://127.0.0.1:${sunucu.address().port}`;
});
after(() => new Promise((ok) => sunucu.close(ok)));

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

async function getir(trafik) {
  DB = { trafik };
  const r = await fetch(`${taban}/api/denetim/nginx-spa?fresh=1`);
  const j = await r.json();
  assert.equal(j.ok, true, `uc dustu: ${j.message}`);
  return j;
}
const hucre = (j) => {
  const row = j.rows.find((r) => r.application === 'kart-app-v1');
  assert.ok(row, `PROD proxy satiri matrise katilmadi: ${JSON.stringify(j.prodProxy)}`);
  return row.envs.PROD;
};

test('T10 PROD proxy satirlari tanimin sunucularina girer: satirsiz eski mirror varken idle DEGIL', async () => {
  // Kontrol: iki eski sunucu da 8 gun olculmus, istek yok -> gercekten idle (dal aciliyor).
  const iki = await getir([LOAD('GBRVPP07'), LOAD('GBRVPP08')]);
  const c0 = hucre(iki);
  assert.equal(c0.status, 'PROXY');
  assert.equal(c0.traffic.state, 'idle');
  assert.equal(c0.traffic.hosts, 2);

  // GBRVPP08'in o gun satiri yok (trafik adimi zaman asimina dustu): "yuk yok" DENMEZ.
  const tek = await getir([LOAD('GBRVPP07')]);
  const c = hucre(tek);
  assert.equal(c.status, 'PROXY');
  assert.equal(c.traffic.state, 'unknown', 'satiri olmayan eski mirror yok sayildi - "atil aday"');
  assert.deepEqual(c.traffic.kismi, ['satirsiz-sunucu']);
  assert.equal(c.traffic.missingHosts, 1);
  assert.equal(tek.trafficStats.idle, 0);
});
