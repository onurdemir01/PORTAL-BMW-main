// server/audit/__tests__/app-owners-uctan.test.cjs - uygulama sahibi UCTAN UCA (2026-11-02).
//
// Kullanici: namespace sahibini uygulamanin sahibi gibi yazmak geri donus almada sorun cikariyor;
// uygulama bazli sahip, "bulunamazsa namespace sahibi gosterilsin".
// AO14 (app-owners.test.cjs) yalniz kaynak metnine bakar; bir cagiran uygulama adi yerine
// namespace'i verse (ownersForApp(owners, nss[0], nss)) ve dogru cagriyi yorumda birakirsa metin
// bekcisi kandirilabilirdi. Bu dosya GERCEK initDenetim'i sahte DB ile kosar ve sonucu API
// ciktisinda olcer: ayni namespace'te uygulama tablosunda 'GT-Uyg' (SI51_AGILE), namespace
// tablosunda 'GT-NS' var; uygulama adi dogru gitmezse cikti 'GT-NS' / NAMESPACE olur.
//   AU1 /nginx-spa: satir owner'i uygulama sahibi; kendi satiri olmayan uygulama namespace yedegi
//   AU2 /nginx-spa-coverage: eksik-liste (detailOf) owner'i uygulama sahibi
//   AU3 /nginx-spa-coverage?platform=ark: intranet hucresi (ownerOf lambdasi) owner'i uygulama sahibi
//   AU4 namespace tablosu gecici okunamaz: kendi sahibi olmayan uygulama veriYokNs ("veri yok")
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');
const express = require('express');

const { buildIntranetRapor } = require('../../spa-report/intranet.cjs');

const KOK = path.join(__dirname, '..', '..');
const sahte = (rel, exports) => {
  const yol = path.join(KOK, rel);
  require.cache[Module._resolveFilename(yol, module)] = { id: yol, filename: yol, loaded: true, exports };
};

const NS = 'kart-prod';
const APP_ROWS = [
  { cluster: 'gbocpprod1', namespace: NS, application: 'kart-app-v1', owner_group_name: 'GT-Uyg', owner_email: 'uyg@banka.com', kaynak: 'SI51_AGILE', configuration_id: '4177193', lookup_status: 'OK', lookup_message: '' },
  { cluster: 'gbocpprod1', namespace: 'rotasiz-prod', application: 'rotasiz-app-v1', owner_group_name: 'GT-Uyg', owner_email: 'uyg@banka.com', kaynak: 'SI51_AGILE', configuration_id: '1', lookup_status: 'OK', lookup_message: '' },
  { cluster: 'gbocpprod1', namespace: NS, application: 'yok-ui', owner_group_name: 'GT-Uyg', owner_email: 'uyg@banka.com', kaynak: 'ARK997_AGILE', configuration_id: '2', lookup_status: 'OK', lookup_message: '' },
];
const NS_ROWS = [
  { namespace: NS, owner_group_name: 'GT-NS', owner_email: 'ns@banka.com', lookup_status: 'OK' },
  { namespace: 'rotasiz-prod', owner_group_name: 'GT-NS', owner_email: 'ns@banka.com', lookup_status: 'OK' },
];

const CFG = (application, o = {}) => ({
  service: 'GLOMO', env: 'PROD', application, namespace: NS, include_name: application, location_path: `/${application}/`,
  host: 'H1', vhost: 'GLOMO-PROD', deploy_mode: 'namespaced', include_exists: 1, app_deployed: 1, in_ocp_inventory: 1, status: 'OK', ...o,
});
// Kapsam: rotasiz-prod namespace'inde hic route yok -> rotasiz-app-v1 / ns-app-v1 route'suz listede
// (detailOf); kart-prod'da eski-app-v1 reencrypt.
const OCP = [
  { namespace: NS, application: 'eski-app-v1' },
  { namespace: 'rotasiz-prod', application: 'rotasiz-app-v1' },
  { namespace: 'rotasiz-prod', application: 'ns-app-v1' },
];
const ROUTES = [{ namespace_name: NS, route_name: 'eski-app-v1', route_address: 'eski-app-v1-kart-prod.apps.fw.garanti.com.tr', termination_type: 'reencrypt' }];

const IA = (application, o = {}) => ({
  application, namespace: NS, env: 'prod', spa: 'evet', ag: 'intranet', istek: 'var', reqShown: 1,
  usage: null, hosts: [], clusters: ['gbocpprod1'], staleClusters: [], weakEvidence: false, pattern: 'uymuyor', ...o,
});
const rapor = () => ({
  ok: true, notScanned: false, kesifTarihi: '2026-10-18',
  // yok-ui (uygulama sahibi var) ve sahipsiz-ui (yok) hic kurulmamis -> intranet eksik listesi
  // GBNGXP50 taranmis (baska bir uygulamanin dizini var) -> kurulmamislar "eksik", olculemedi degil.
  ...buildIntranetRapor({
    apps: [IA('yok-ui'), IA('sahipsiz-ui')], ownersByNs: new Map(), beyanlar: new Map(), hosts: ['GBNGXP50'],
    dirRows: [{ host: 'GBNGXP50', namespace: NS, application: 'baska-ui', hys_deployed: 1, app_deployed: 1, conf_exists: 1, status: 'OK', scan_date: '2026-10-18' }],
  }),
});

const DB = { config: [], nsHata: null };
function db() {
  const query = async (q) => {
    const s = String(q);
    if (s.includes('MAX(scan_date), 23) AS d FROM dbo.Nginx_Config_Audit')) return { recordset: [{ d: '2026-10-18' }] };
    if (s.includes('SELECT DISTINCT TOP 30')) return { recordset: [{ d: '2026-10-18' }] };
    if (s.includes('sys.columns')) return { recordset: [{ n: 0 }] };
    if (s.includes('Openshift_Namespace_Owners')) {
      if (DB.nsHata) throw DB.nsHata;
      return { recordset: NS_ROWS };
    }
    if (s.includes('Openshift_App_Owners')) return { recordset: APP_ROWS };
    if (s.includes('FROM dbo.Openshift_Inventory')) return { recordset: OCP };
    if (s.includes('FROM dbo.Nginx_Config_Audit')) return { recordset: DB.config };
    if (s.includes('FROM dbo.BMW_Openshift_Route_Inventory')) return { recordset: ROUTES };
    return { recordset: [] };
  };
  return { query, queryLong: query, sql: new Proxy({}, { get: () => () => 'tip' }) };
}

let _srv = null;
async function sunucu() {
  if (_srv) return _srv;
  sahte('auth/index.cjs', { requireAuth: (_q, _s, n) => n() });
  sahte('auth/visibility.cjs', {});
  sahte('inventory/mssql.cjs', db());
  sahte('spa-report/index.cjs', { intranetOzeti: async () => rapor() });
  const { initDenetim } = require('../denetim.cjs');
  const app = express();
  initDenetim(app);
  const s = app.listen(0);
  await new Promise((r) => s.once('listening', r));
  _srv = { s, base: `http://127.0.0.1:${s.address().port}/api/denetim` };
  return _srv;
}
test.after(() => _srv && _srv.s.close());
const nsOwners = () => require('../ns-owners.cjs');
const al = async (yol) => {
  const { base } = await sunucu();
  nsOwners()._resetCache();
  const j = await fetch(`${base}${yol}${yol.includes('?') ? '&' : '?'}fresh=1`).then((x) => x.json());
  assert.equal(j.ok, true, j.message);
  return j;
};
const sahip = (o) => [o.groups, o.kaynaklar];

test('AU1 /nginx-spa: owner UYGULAMA sahibinden; satiri olmayan uygulama namespace yedegi', async () => {
  DB.config = [CFG('kart-app-v1'), CFG('baska-app-v1')];
  try {
    const j = await al('/nginx-spa');
    const by = Object.fromEntries(j.rows.map((r) => [r.application, r]));
    assert.ok(by['kart-app-v1'] && by['baska-app-v1'], 'satirlar yok: ' + Object.keys(by));
    assert.deepEqual(sahip(by['kart-app-v1'].owner), [['GT-Uyg'], ['SI51_AGILE']], 'uygulama adi ownersForApp\'a gitmedi');
    assert.deepEqual(by['kart-app-v1'].owner.namespaces, [NS]);
    assert.deepEqual(sahip(by['baska-app-v1'].owner), [['GT-NS'], ['NAMESPACE']]);
    assert.equal(j.ownersReady, true);
  } finally {
    DB.config = [];
  }
});

test('AU2 /nginx-spa-coverage: eksik-liste owner\'i uygulama sahibi (detailOf)', async () => {
  const j = await al('/nginx-spa-coverage?platform=ark');
  const p = j.rows.find((x) => x.env === 'PROD');
  assert.ok(p, 'PROD satiri yok');
  const by = Object.fromEntries((p.missingDetail.noRoute || []).map((d) => [d.app, d]));
  assert.ok(by['rotasiz-app-v1'] && by['ns-app-v1'], 'route\'suz liste: ' + JSON.stringify(p.missingDetail.noRoute));
  assert.deepEqual(sahip(by['rotasiz-app-v1'].owner), [['GT-Uyg'], ['SI51_AGILE']], 'detailOf uygulama adini vermedi');
  assert.deepEqual(by['rotasiz-app-v1'].owner.namespaces, ['rotasiz-prod']);
  assert.deepEqual(sahip(by['ns-app-v1'].owner), [['GT-NS'], ['NAMESPACE']]);
});

test('AU3 /nginx-spa-coverage?platform=ark: intranet hucresi owner\'i uygulama sahibi (ownerOf)', async () => {
  const j = await al('/nginx-spa-coverage?platform=ark');
  const p = j.rows.find((x) => x.env === 'PROD');
  const by = Object.fromEntries(p.missingDetail.intranet.map((d) => [d.app, d]));
  assert.ok(by['yok-ui'] && by['sahipsiz-ui'], 'intranet listesi: ' + JSON.stringify(Object.keys(by)));
  assert.deepEqual(sahip(by['yok-ui'].owner), [['GT-Uyg'], ['ARK997_AGILE']], 'ownerOf uygulama adini vermedi');
  assert.deepEqual(sahip(by['sahipsiz-ui'].owner), [['GT-NS'], ['NAMESPACE']]);
});

test('AU4 namespace tablosu gecici okunamaz: kendi sahibi olmayan uygulama "veri yok" (veriYokNs)', async () => {
  DB.config = [CFG('kart-app-v1'), CFG('baska-app-v1')];
  DB.nsHata = new Error('Login timeout expired');
  try {
    const j = await al('/nginx-spa');
    const by = Object.fromEntries(j.rows.map((r) => [r.application, r]));
    assert.deepEqual(sahip(by['kart-app-v1'].owner), [['GT-Uyg'], ['SI51_AGILE']]);
    const b = by['baska-app-v1'].owner;
    assert.deepEqual([b.groups, b.unknownNs, b.veriYokNs], [[], [], [NS]], '"bilinmiyor" ile "veri yok" karisti');
  } finally {
    DB.config = [];
    DB.nsHata = null;
    nsOwners()._resetCache();
  }
});
