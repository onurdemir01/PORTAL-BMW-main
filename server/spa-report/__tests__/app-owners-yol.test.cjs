// server/spa-report/__tests__/app-owners-yol.test.cjs - uygulama sahibi SPA Raporu ve Intranet SPA
// yukleyicilerinde UCTAN UCA (2026-11-02).
//
// Kullanici: namespace sahibini uygulamanin sahibi gibi yazmak geri donus almada sorun cikariyor;
// uygulama bazli sahip, "bulunamazsa namespace sahibi gosterilsin".
// Metin bekcisi (AO14) bir cagiranin namespace'i uygulama adi yerine vermesini, dogru cagri
// yorumda kaldiginda goremezdi. Burada GERCEK loadReport / loadIntranet sahte DB ile kosar:
// ayni namespace'te uygulama tablosunda 'GT-Uyg' (SI51_AGILE), namespace tablosunda 'GT-NS'.
//   AY-S1 loadReport (SPA Raporu): satir team / teamKaynak uygulama sahibinden; satiri olmayan
//         uygulama namespace yedegi
//   AY-S2 loadIntranet (Intranet SPA): ekip / ekipKaynak uygulama sahibinden; yedek isaretli
//   AY-S3 namespace tablosu gecici okunamaz: kendi sahibi olmayan satir "veri yok" bayragi
//         (teamVeriYok / ekipVeriYok), sahibi olan etkilenmez
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const SERVER = path.join(__dirname, '..', '..');
function sahteModul(rel, exportsObj) {
  const p = require.resolve(path.join(SERVER, rel));
  require.cache[p] = { id: p, filename: p, loaded: true, exports: exportsObj, children: [], paths: [] };
}

const NS = 'kart-prod';
const GUN = '2026-10-02';
const APP_ROWS = [
  { cluster: 'gbocpprod1', namespace: NS, application: 'kart-app-v1', owner_group_name: 'GT-Uyg', owner_email: 'uyg@banka.com', kaynak: 'SI51_AGILE', configuration_id: '4177193', lookup_status: 'OK', lookup_message: '' },
  { cluster: 'gbocpprod1', namespace: NS, application: 'kart-ui', owner_group_name: 'GT-Uyg', owner_email: 'uyg@banka.com', kaynak: 'SI51_AGILE', configuration_id: '4177193', lookup_status: 'OK', lookup_message: '' },
];
const NS_ROWS = [{ namespace: NS, owner_group_name: 'GT-NS', owner_email: 'ns@banka.com', lookup_status: 'OK' }];
const DB = { nsHata: null };
async function query(text) {
  const t = String(text);
  const rs = (recordset) => ({ recordset });
  if (t.includes('Openshift_Namespace_Owners')) {
    if (DB.nsHata) throw DB.nsHata;
    return rs(NS_ROWS);
  }
  if (t.includes('Openshift_App_Owners')) return rs(APP_ROWS);
  if (t.includes("OBJECT_ID('dbo.Nginx_Spa_Traffic')")) return rs([{ trf: 1, fs: 40 }]);
  if (t.includes('FROM dbo.Nginx_Spa_Traffic')) return rs([]);
  if (t.includes('MAX(scan_date), 23) AS d FROM dbo.Nginx_Config_Audit')) return rs([{ d: GUN }]);
  if (t.includes('FROM dbo.Nginx_Config_Audit')) {
    const C = (application, location_path) => ({ service: 'GLOMO', env: 'PROD', application, namespace: NS, location_path, host: 'H1', vhost: 'GLOMO-PROD' });
    return rs([C('kart-app-v1', '/kart/'), C('baska-app-v1', '/baska/')]);
  }
  return rs([]);
}
const SQL = new Proxy({}, { get: () => () => 'tip' });
sahteModul('inventory/mssql.cjs', { query, sql: SQL });
sahteModul('db/index.cjs', { query: async () => ({ rows: [] }) });

const { loadReport } = require('../index.cjs');
const { loadIntranet, onbellekSil } = require('../intranet.cjs');
const nsOwners = require('../../audit/ns-owners.cjs');

const IA = (application) => ({
  application, namespace: NS, env: 'prod', spa: 'evet', ag: 'intranet', istek: 'var', reqShown: 1,
  usage: null, hosts: [], clusters: ['gbocpprod1'], staleClusters: [], weakEvidence: false, pattern: 'uymuyor',
});
const intranet = async () => {
  onbellekSil();
  nsOwners._resetCache();
  const r = await loadIntranet(true, {
    mssql: { query, sql: SQL },
    loadBeyanlar: async () => new Map(),
    spaKesfi: async () => ({ scanDate: '2026-10-18', apps: [IA('kart-ui'), IA('baska-ui')], coverage: { clusters: [] } }),
  });
  assert.equal(r.ok, true);
  return Object.fromEntries(r.rows.map((x) => [x.application, x]));
};
const rapor = async () => {
  nsOwners._resetCache();
  const r = await loadReport(true);
  assert.equal(r.ok, true, r.message);
  return Object.fromEntries(r.rows.map((x) => [x.application, x]));
};

test('AY-S1 loadReport: team / teamKaynak UYGULAMA sahibinden, satiri olmayan uygulama namespace yedegi', async () => {
  const by = await rapor();
  assert.ok(by['kart-app-v1'] && by['baska-app-v1'], 'satirlar: ' + Object.keys(by));
  assert.deepEqual([by['kart-app-v1'].team, by['kart-app-v1'].teamKaynak], [['GT-Uyg'], ['SI51_AGILE']], 'ekipOf uygulama adini vermedi');
  assert.deepEqual([by['baska-app-v1'].team, by['baska-app-v1'].teamKaynak], [['GT-NS'], ['NAMESPACE']]);
  assert.equal(by['baska-app-v1'].teamVeriYok, undefined);
});

test('AY-S2 loadIntranet: ekip / ekipKaynak UYGULAMA sahibinden, yedek isaretli', async () => {
  const by = await intranet();
  assert.ok(by['kart-ui'] && by['baska-ui'], 'satirlar: ' + Object.keys(by));
  assert.deepEqual([by['kart-ui'].ekip, by['kart-ui'].ekipKaynak, by['kart-ui'].ekipEposta], [['GT-Uyg'], ['SI51_AGILE'], ['uyg@banka.com']], 'ownersForApp uygulama adini almadi');
  assert.deepEqual([by['baska-ui'].ekip, by['baska-ui'].ekipKaynak], [['GT-NS'], ['NAMESPACE']]);
  assert.equal(by['baska-ui'].ekipVeriYok, undefined);
});

test('AY-S3 namespace tablosu gecici okunamaz: sahipsiz satir "veri yok" bayragi tasir', async () => {
  DB.nsHata = new Error('Login timeout expired');
  try {
    const r = await rapor();
    assert.deepEqual([r['kart-app-v1'].team, r['kart-app-v1'].teamVeriYok], [['GT-Uyg'], undefined]);
    assert.deepEqual([r['baska-app-v1'].team, r['baska-app-v1'].teamVeriYok], [[], true]);
    const i = await intranet();
    assert.deepEqual([i['kart-ui'].ekip, i['kart-ui'].ekipVeriYok], [['GT-Uyg'], undefined]);
    assert.deepEqual([i['baska-ui'].ekip, i['baska-ui'].ekipVeriYok], [[], true]);
  } finally {
    DB.nsHata = null;
    nsOwners._resetCache();
    onbellekSil();
  }
});
