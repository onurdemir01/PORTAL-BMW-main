// server/audit/__tests__/nginx-migration-tum-location.test.cjs — Production SPA Tasimalari: TUM
// location'lar (2026-10-18).
//
// Kullanici: "SPA kurali arama, direkt ne kadar location var ve hangileri yoksa hepsini bana goster.
// Isim standardina uymayip tasimadiklarimiz cok buyuk problem oluyor." Uygulama listesi SPA ad
// kalibina (-app-v / -app-emb-v) gore kuruluyordu; kalibina uymayan hedefler "SPA-disi" listesinde
// "eksik" SAYILMIYORDU. Simdi her grup eski sunuculardaki HER location'i tek listede doner.
//   TL1 SPA + ad kalibina uymayan + cozulemeyen + eski sunucuda zaten include: hepsi listede, yeni
//       sunucudaki durumla; mirror sunucu carpilmaz; eksikler basta; sayim listeyle ayni
//   TL2 loadMigration eski sunuculardaki include satirlarini da okur (kind spa / NULL)
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildMigration, loadMigration, MIGRATION_GROUPS } = require('../nginx-migration.cjs');

const APPS = '.apps.fw.garanti.com.tr';
const P = (host, service, location, target) => ({
  host, vhost: service + '-PROD.conf', service, location, upstream_name: 'ups', target_url: target,
});
const N = (host, service, location) => ({ host, service, vhost: service + '-PROD.conf', location });
const glomo = MIGRATION_GROUPS.find((g) => g.id === 'glomo');

test('TL1 tum location listesi: SPA, ad standardina uymayan, cozulemeyen ve include; eksikler basta', () => {
  const yeni = glomo.newHosts;
  const out = buildMigration({
    proxyRows: [
      P('GBRVPP07', 'GLOMO', '/tam/', 'tam-app-v1-glomo-prod' + APPS),
      P('GBRVPP08', 'GLOMO', '/tam/', 'tam-app-v1-glomo-prod' + APPS), // mirror: bir kez sayilir
      P('GBRVPP07', 'GLOMO', '/yarim/', 'yarim-app-v1-glomo-prod' + APPS),
      P('GBRVPP07', 'GLOMO', '/standartsiz/', 'webforms-ui-glomo-prod' + APPS), // ad kalibina UYMUYOR
      P('GBRVPP07', 'GLOMO', '/cozulemez/', 'kayip-app-v1-yok-prod' + APPS), // envanterde yok
      P('GBRVPP01', 'OPEN', '/baska-grup/', 'x-app-v1-open-prod' + APPS), // diger grup: KARISMAZ
    ],
    upstreamRows: [],
    routeRows: [
      ...['tam-app-v1', 'yarim-app-v1', 'webforms-ui'].map((a) => ({ namespace_name: 'glomo-prod', route_address: `${a}-glomo-prod${APPS}` })),
    ],
    ocpRows: [],
    dirRows: [],
    newLocRows: [...yeni.map((h) => N(h, 'GLOMO', '/tam/')), N(yeni[0], 'GLOMO', '/yarim/')],
    oldIncludeRows: [
      { host: 'GBRVPP07', vhost: 'GLOMO-PROD.conf', service: 'GLOMO', location: '/inc/', include_name: 'inc-app-v1-glomo-prod', namespace: 'glomo-prod', application: 'inc-app-v1' },
    ],
  });
  const g = out.find((x) => x.id === 'glomo');
  assert.ok(Array.isArray(g.locations), 'grup tum location listesini donmuyor');
  assert.deepEqual(g.locations.map((l) => [l.location, l.newStatus]), [
    ['/cozulemez/', 'none'], ['/inc/', 'none'], ['/standartsiz/', 'none'], ['/yarim/', 'partial'], ['/tam/', 'defined'],
  ]);
  const by = Object.fromEntries(g.locations.map((l) => [l.location, l]));
  assert.deepEqual(by['/standartsiz/'].siniflar, ['spa-disi'], 'ad standardina uymayan hedef listede ayri sinifla gorunmeli');
  assert.deepEqual(by['/standartsiz/'].apps, ['glomo-prod/webforms-ui']);
  assert.deepEqual(by['/standartsiz/'].targets, ['webforms-ui-glomo-prod' + APPS]);
  assert.deepEqual(by['/cozulemez/'].siniflar, ['cozulemedi']);
  assert.deepEqual(by['/inc/'].siniflar, ['include']);
  assert.deepEqual(by['/inc/'].apps, ['glomo-prod/inc-app-v1']);
  assert.deepEqual(by['/tam/'].siniflar, ['spa']);
  assert.deepEqual(by['/tam/'].oldHosts, ['GBRVPP07', 'GBRVPP08'], 'mirror sunucular birlesmeli');
  assert.deepEqual(by['/tam/'].newHosts, yeni);
  assert.deepEqual(by['/yarim/'].newHosts, [yeni[0]]);
  assert.equal(by['/baska-grup/'], undefined, 'diger grubun location i bu gruba karisti');
  // Sayim listeyle AYNI kaynaktan: include satiri da vhost'un parcasi.
  assert.deepEqual(g.totals.locations, { total: 5, defined: 1, partial: 1, none: 3, notScanned: 0 });
  assert.equal(g.serviceLocations[0].locations, g.locations.length);
});

test('TL2 loadMigration eski sunuculardaki include satirlarini da okur', async () => {
  const sorgular = [];
  const query = async (text) => {
    const t = String(text);
    sorgular.push(t);
    const rs = (recordset) => ({ recordset });
    if (t.includes('MAX(scan_date), 23) AS d')) return rs([{ d: '2026-10-18' }]);
    if (t.includes("kind = 'proxy'")) return rs([P('GBRVPP07', 'GLOMO', '/p/', 'p-app-v1-glomo-prod' + APPS)]);
    if (t.includes("(kind IS NULL OR kind = 'spa')") && t.includes('@o0')) {
      return rs([{ host: 'GBRVPP07', vhost: 'GLOMO-PROD.conf', service: 'GLOMO', location: '/inc/', include_name: 'inc-app-v1-glomo-prod', namespace: 'glomo-prod', application: 'inc-app-v1' }]);
    }
    return rs([]);
  };
  const sql = new Proxy({}, { get: () => () => 'tip' });
  const r = await loadMigration({ query, sql, hasProxyColumns: async () => true });
  const g = r.groups.find((x) => x.id === 'glomo');
  assert.deepEqual(g.locations.map((l) => l.location).sort(), ['/inc/', '/p/']);
  const inc = sorgular.find((t) => t.includes("(kind IS NULL OR kind = 'spa')") && t.includes('@o0'));
  assert.ok(inc, 'eski sunucu include sorgusu yok');
  assert.match(inc, /include_name/);
});
