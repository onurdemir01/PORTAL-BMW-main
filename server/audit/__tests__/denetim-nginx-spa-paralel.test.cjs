// server/audit/__tests__/denetim-nginx-spa-paralel.test.cjs - NP1..NP4 (2026-11-12).
//
// Hiz isi (davranis degismez):
//   NP1 GET /nginx-spa: tarih listesi, proxy kolon tespiti ve trafik semasi, tarih sorgusu
//       COZULMEDEN once baslar (ilk dalga paralel). Yanit icerigi eski sirali akisla ayni.
//   NP2 Tarih yoksa bos yanit; tarih listesi sorgusu dusse bile 500 olmaz, islenmemis red yok.
//   NP3 spaSinyali sema yoklamasi 10 dk onbellekte; hata ve "tablo yok" onbellege alinmaz.
//   NP4 Gercek SPA Kesfi route envanteri sorgusu DB'de ARK cluster listesiyle suzulur.
'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const SERVER = path.join(__dirname, '..', '..');
function sahteModul(rel, exportsObj) {
  const p = require.resolve(path.join(SERVER, rel));
  require.cache[p] = { id: p, filename: p, loaded: true, exports: exportsObj, children: [], paths: [] };
}
const gec = (_req, _res, next) => next();

const GUN = '2026-11-12';
const rs = (recordset) => ({ recordset });
const SORGULAR = [];
let dateBekle = null; // tarih sorgusunu bekleten kapi
let dateDeger = GUN;
let datesDus = false;
let spaSemaDus = false;
let spaSemaOid = 1;
const redler = [];
process.on('unhandledRejection', (e) => redler.push(e));

async function query(text) {
  const t = String(text);
  SORGULAR.push(t);
  if (t.includes('FROM sys.columns') && t.includes('Nginx_Config_Audit')) return rs([{ n: 0 }]);
  if (t.includes("OBJECT_ID('dbo.Nginx_Spa_Traffic')")) return rs([{ trf: 1, fs: 1 }]);
  if (t.includes('FROM dbo.Nginx_Spa_Traffic'))
    return rs([
      {
        host: 'GBNGXT33', vhost: 'GLOMO-TEST', service: 'GLOMO', env: 'TEST', location: '/kart/',
        req_24h: 5, req_7d: 40, hc_24h: 1, sampled: 1, last_seen: '20261111100000', error: null,
        first_seen: '20261101000000', scan_date: GUN,
      },
    ]);
  if (t.includes('MAX(scan_date), 23) AS d FROM dbo.Nginx_Config_Audit')) {
    if (dateBekle) await dateBekle;
    return rs([{ d: dateDeger }]);
  }
  if (t.includes('SELECT DISTINCT TOP 30')) {
    if (datesDus) throw new Error('tarih listesi dustu');
    return rs([{ d: GUN }]);
  }
  if (t.includes('FROM dbo.Nginx_Config_Audit'))
    return rs([
      {
        service: 'GLOMO', env: 'TEST', application: 'kart-app-v1', namespace: 'kart-test',
        include_name: 'kart-app-v1', location_path: '/kart/', host: 'GBNGXT33', vhost: 'GLOMO-TEST',
        deploy_mode: 'namespaced', include_exists: 1, app_deployed: 1, in_ocp_inventory: 1, status: 'OK',
      },
    ]);
  if (t.includes("OBJECT_ID('dbo.BMW_Spa_Discovery') AS oid")) {
    if (spaSemaDus) throw new Error('sema dustu');
    return rs([{ oid: spaSemaOid, mb: 1 }]);
  }
  return rs([]);
}
sahteModul('inventory/mssql.cjs', { query, queryLong: query, sql: new Proxy({}, { get: () => () => 'tip' }) });
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

const al = async (yol) => {
  const r = await fetch(taban + yol);
  return { code: r.status, body: await r.json() };
};
const say = (parca) => SORGULAR.filter((t) => t.includes(parca)).length;

test('NP1 ilk dalga tarih sorgusu cozulmeden baslar; yanit tam', async () => {
  SORGULAR.length = 0;
  let ac;
  dateBekle = new Promise((ok) => {
    ac = ok;
  });
  const yanitP = al('/api/denetim/nginx-spa?fresh=1');
  // Tarih sorgusu beklerken bagimsiz sorgular cikmis olmali.
  for (let i = 0; i < 100 && say("OBJECT_ID('dbo.Nginx_Spa_Traffic')") === 0; i++) {
    await new Promise((ok) => setTimeout(ok, 5));
  }
  assert.equal(say('MAX(scan_date), 23) AS d FROM dbo.Nginx_Config_Audit'), 1, 'tarih sorgusu yok');
  assert.equal(say('SELECT DISTINCT TOP 30'), 1, 'tarih listesi ilk dalgada baslamadi');
  assert.equal(say("OBJECT_ID('dbo.Nginx_Spa_Traffic')"), 1, 'trafik semasi ilk dalgada baslamadi');
  assert.equal(say('WHERE scan_date = @d'), 0, 'tarihe bagli sorgu tarih cozulmeden kostu');
  ac();
  dateBekle = null;
  const { code, body } = await yanitP;
  assert.equal(code, 200);
  assert.equal(body.scanDate, GUN);
  assert.deepEqual(body.availableDates, [GUN]);
  assert.ok(Array.isArray(body.rows) && body.rows.length > 0, 'satir yok');
  assert.ok(JSON.stringify(body).includes('kart-app-v1'));
});

test('NP2 tarih yoksa bos yanit; tarih listesi hatasi 500 yapmaz, islenmemis red yok', async () => {
  dateDeger = null;
  datesDus = true;
  try {
    const { code, body } = await al('/api/denetim/nginx-spa?fresh=1');
    assert.equal(code, 200);
    assert.deepEqual(body, { ok: true, scanDate: null, services: [], rows: [], availableDates: [] });
    await new Promise((ok) => setTimeout(ok, 20));
    assert.deepEqual(redler, [], 'islenmemis red');
    // Tarih VARKEN tarih listesi hatasi eskisi gibi 500.
    dateDeger = GUN;
    const r2 = await al('/api/denetim/nginx-spa?fresh=1');
    assert.equal(r2.code, 500);
  } finally {
    dateDeger = GUN;
    datesDus = false;
  }
});

test('NP3 spaSinyali sema yoklamasi onbellekte; hata ve tablo yok onbellege girmez', async () => {
  const SEMA = "OBJECT_ID('dbo.BMW_Spa_Discovery') AS oid";
  SORGULAR.length = 0;
  spaSemaDus = true;
  await al('/api/denetim/route-stats?fresh=1');
  spaSemaDus = false;
  spaSemaOid = null;
  await al('/api/denetim/route-stats?fresh=1');
  spaSemaOid = 1;
  await al('/api/denetim/route-stats?fresh=1');
  await al('/api/denetim/route-stats?fresh=1');
  await al('/api/denetim/route-stats?fresh=1');
  assert.equal(say(SEMA), 3, 'hata/tablo-yok onbellege alindi ya da gecerli sema onbellege alinmadi');
});

test('NP4 SPA Kesfi route envanteri ARK cluster IN suzgecli, JS bekci duruyor', () => {
  const src = fs.readFileSync(path.join(SERVER, 'nginx-console', 'index.cjs'), 'utf8');
  assert.match(
    src,
    /FROM dbo\.BMW_Openshift_Route_Inventory` \+ ` WHERE cluster_name IN \(\$\{arkInv\.sqlText\}\)`,\s*arkInv\.params/,
  );
  assert.match(src, /PLATFORM_CLUSTERS\.ark/);
  assert.match(src, /const inv = arkSuz\(invHam, 'cluster_name'\);/, 'JS bekci kaldirilmis');
});
