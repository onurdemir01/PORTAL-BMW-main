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
// IKINCI KAYNAK nginx -T (kullanici, 2026-10-18: "/consent-mng/, /domestic-trf/ tanimlari var ama
// ekrana yansimiyor"). Config taramasi ic ice blok (if/limit_except), tek satirlik blok ya da baska
// dosyadan include edilen location'i kaydetmiyordu; nginx_audit (Nginx_Audit_Locations) goruyor.
//   TL3 yalniz nginx -T'de olan location listede: kaynak isaretli, proxy hedefi upstream'den
//       cozulur, statik/return siniflanir; config'in bildigi location'a sinif EKLENMEZ;
//       nginx.conf altyapisi ve application-confs icerigi listeye girmez; sayima girer
//   TL4 yeni sunucuda yalniz nginx -T'nin gordugu tanim "yok" SAYILMAZ; bosluk farki ayni location
//   TL5 yalniz yeni sunucularda olan location: eskide=false, en sonda, sayima girmez, yalniz eski
//       tarafta da olan vhost'lar
//   TL6 loadMigration nginx -T satirlarini (eski + yeni, server dosyasiyla) okur, tarihini doner
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

// nginx -T satiri (Nginx_Audit_Locations + server blogunun dosyasi)
const T = (host, conf, location, behaviour, target = '', srv = conf) => ({
  host, conf_file: conf, location, behaviour, proxy_target: target, srv_conf: srv,
});
const VH = '/usr/nginx/conf.d/GLOMO-PROD.conf';

function tumGrup(extra) {
  const out = buildMigration({
    proxyRows: [P('GBRVPP07', 'GLOMO', '/bilinen/', 'bilinen-app-v1-glomo-prod' + APPS)],
    upstreamRows: ['GBRVPP07', 'GBRVPP08'].map((host) => ({ host, name: 'consent-ups', server: 'consent-mng-api-glomo-prod' + APPS + ':443' })),
    routeRows: [{ namespace_name: 'glomo-prod', route_address: 'consent-mng-api-glomo-prod' + APPS }],
    ocpRows: [],
    dirRows: [],
    newLocRows: [],
    oldIncludeRows: [
      { host: 'GBRVPP07', vhost: 'GLOMO-PROD', service: 'GLOMO', location: '/inc/', include_name: 'inc-app-v1-glomo-prod', namespace: 'glomo-prod', application: 'inc-app-v1' },
    ],
    ...extra,
  });
  return out.find((x) => x.id === 'glomo');
}

test('TL3 yalniz nginx -T de olan location listede; kaynak, hedef ve sinif dogru', () => {
  const g = tumGrup({
    auditLocRows: [
      // ic ice if yuzunden config taramasinin KACIRDIGI proxy location (upstream takma adi)
      T('GBRVPP07', VH, '/consent-mng/', 'proxy', 'consent-ups'),
      T('GBRVPP08', VH, '/consent-mng/', 'proxy', 'consent-ups'),
      // baska dosyadan include edilen parca: vhost server blogunun dosyasindan
      T('GBRVPP07', '/usr/nginx/conf.d/parcalar/transfer.conf', '/domestic-trf/', 'proxy', 'domestic-trf-svc', VH),
      // Root conf.d include parcasi da dosya gibi gorunur; servis gercek server blogundan gelmeli.
      T('GBRVPP07', '/usr/nginx/conf.d/cors.conf', '/root-fragment/', 'static', '', VH),
      T('GBRVPP07', VH, '= /robots.txt', 'static'),
      T('GBRVPP07', VH, '/eski/', 'return'),
      // config'in bildigi location: sinif degismez, yalniz kaynak eklenir
      T('GBRVPP07', VH, '/inc/', 'other'),
      // altyapi ve application-confs: listeye GIRMEZ
      T('GBRVPP07', '/usr/nginx/nginx.conf', '/nginx_status', 'other'),
      T('GBRVPP07', '/usr/nginx/conf.d/application-confs/inc-app-v1-glomo-prod.conf', '/ic/', 'static', '', '/usr/nginx/conf.d/application-confs/inc-app-v1-glomo-prod.conf'),
      // baska grubun eski sunucusu: karismaz
      T('GBRVPP01', '/usr/nginx/conf.d/OPEN-PROD.conf', '/open-x/', 'proxy', 'x'),
    ],
  });
  const by = Object.fromEntries(g.locations.map((l) => [l.location, l]));
  const c = by['/consent-mng/'];
  assert.ok(c, 'config taramasinin kacirdigi /consent-mng/ listede yok');
  assert.deepEqual(c.kaynaklar, ['nginx-T']);
  assert.deepEqual(c.oldHosts, ['GBRVPP07', 'GBRVPP08']);
  assert.deepEqual(c.targets, ['consent-mng-api-glomo-prod' + APPS], 'upstream takma adi server satirindan cozulmeli');
  assert.deepEqual(c.written, ['consent-ups']);
  assert.deepEqual(c.siniflar, ['spa-disi']);
  assert.deepEqual(c.apps, ['glomo-prod/consent-mng-api']);
  assert.equal(c.newStatus, 'not-scanned');
  const d = by['/domestic-trf/'];
  assert.ok(d, 'baska dosyadan include edilen /domestic-trf/ listede yok');
  assert.equal(d.service, 'GLOMO');
  assert.equal(by['/root-fragment/'].service, 'GLOMO');
  assert.equal(g.locations.some((l) => l.service === 'CORS'), false);
  assert.deepEqual(by['= /robots.txt'].siniflar, ['statik']);
  assert.deepEqual(by['/eski/'].siniflar, ['yonlendirme']);
  assert.deepEqual(by['/inc/'].siniflar, ['include'], 'nginx -T config in bildigi location a sinif eklememeli');
  assert.deepEqual(by['/inc/'].kaynaklar, ['config', 'nginx-T']);
  assert.deepEqual(by['/bilinen/'].kaynaklar, ['config']);
  for (const yok of ['/nginx_status', '/ic/', '/open-x/']) assert.equal(by[yok], undefined, yok + ' listeye girmemeli');
  assert.equal(g.totals.locations.total, 7);
  assert.ok(g.locations.every((l) => l.eskide === true));
});

test('TL4 yeni sunucuda yalniz nginx -T nin gordugu tanim "yok" sayilmaz; bosluk farki ayni location', () => {
  const yeni = glomo.newHosts;
  const g = tumGrup({
    newLocRows: yeni.map((h) => N(h, 'GLOMO', '/bilinen/')),
    auditLocRows: [
      T('GBRVPP07', VH, '=  /tek', 'proxy', 'tek-ups'),
      ...yeni.map((h) => T(h, VH, '/inc/', 'other')),
      ...yeni.map((h) => T(h, VH, '= /tek', 'proxy', 'tek-ups')),
    ],
  });
  const by = Object.fromEntries(g.locations.map((l) => [l.location, l]));
  assert.equal(by['/inc/'].newStatus, 'defined', 'yeni sunucudaki nginx -T tanimi sayilmadi');
  assert.ok(by['= /tek'], 'bosluklar tek bicime indirilmeli');
  assert.equal(by['=  /tek'], undefined);
  assert.equal(by['= /tek'].newStatus, 'defined');
  assert.equal(by['/bilinen/'].newStatus, 'defined');
});

test('TL5 yalniz yeni sunucularda olan location: eskide=false, en sonda, sayima girmez', () => {
  const yeni = glomo.newHosts;
  const g = tumGrup({
    newLocRows: [N(yeni[0], 'GLOMO', '/yeni-eklenen/'), N(yeni[0], 'BASKA', '/baska-vhost/')],
    auditLocRows: [T(yeni[1], VH, '/yeni-eklenen/', 'proxy', 'y')],
  });
  const son = g.locations[g.locations.length - 1];
  assert.equal(son.location, '/yeni-eklenen/');
  assert.equal(son.eskide, false);
  assert.deepEqual(son.oldHosts, []);
  assert.deepEqual(son.newHosts, [yeni[0], yeni[1]]);
  assert.equal(g.locations.filter((l) => !l.eskide).length, 1, 'eski tarafta olmayan vhost listeye girdi');
  assert.equal(g.totals.locations.total, g.locations.filter((l) => l.eskide).length);
});

test('TL6 loadMigration nginx -T satirlarini eski + yeni sunucular icin okur', async () => {
  const sorgular = [];
  const query = async (text, params) => {
    const t = String(text);
    sorgular.push({ t, params });
    const rs = (recordset) => ({ recordset });
    if (t.includes('MAX(scan_date), 23) AS d')) return rs([{ d: '2026-10-18' }]);
    if (t.includes('FROM dbo.Nginx_Audit_Locations l')) return rs([T('GBRVPP07', VH, '/consent-mng/', 'proxy', 'c')]);
    return rs([]);
  };
  const sql = new Proxy({}, { get: () => () => 'tip' });
  const r = await loadMigration({ query, sql, hasProxyColumns: async () => true });
  const g = r.groups.find((x) => x.id === 'glomo');
  assert.deepEqual(g.locations.map((l) => l.location), ['/consent-mng/']);
  assert.equal(r.auditScanDate, '2026-10-18');
  assert.equal(r.auditReady, true);
  const q = sorgular.find((x) => x.t.includes('FROM dbo.Nginx_Audit_Locations l'));
  assert.match(q.t, /LEFT JOIN dbo\.Nginx_Audit_Servers s/);
  assert.match(q.t, /s\.seq = l\.srv_seq/);
  const hosts = q.params.map((p) => p.value);
  assert.ok(hosts.includes('GBRVPP07') && hosts.includes(glomo.newHosts[0]), 'eski ve yeni sunucular sorguda olmali');
});

test('TL7 bos ama basarili nginx -T detail sorgusu kaynak hazir sayilir', async () => {
  const query = async (text) => {
    const t = String(text);
    const rs = (recordset) => ({ recordset });
    if (t.includes('MAX(scan_date), 23) AS d')) return rs([{ d: '2026-10-18' }]);
    return rs([]);
  };
  const sql = new Proxy({}, { get: () => () => 'tip' });
  const r = await loadMigration({ query, sql, hasProxyColumns: async () => true });
  assert.equal(r.auditReady, true, 'bos sonuc sorgu hatasi sayildi');
});

test('TL8 nginx -T tarihi varken detail sorgusu duserse kaynak hazir sayilmaz', async () => {
  const query = async (text) => {
    const t = String(text);
    const rs = (recordset) => ({ recordset });
    if (t.includes('MAX(scan_date), 23) AS d')) return rs([{ d: '2026-10-18' }]);
    if (t.includes('FROM dbo.Nginx_Audit_Locations l')) throw new Error('ETIMEOUT');
    return rs([]);
  };
  const sql = new Proxy({}, { get: () => () => 'tip' });
  const r = await loadMigration({ query, sql, hasProxyColumns: async () => true });
  assert.equal(r.auditScanDate, '2026-10-18', 'tarih sorgusu basarili kaniti korunmali');
  assert.equal(r.auditReady, false, 'detail hatasi bos ama basarili sonuc gibi sunuldu');
});

test('TL9 config proxy kolonlari yoksa bagimsiz nginx -T kaynagi yine okunur', async () => {
  let auditCalls = 0;
  const query = async (text) => {
    const t = String(text);
    const rs = (recordset) => ({ recordset });
    if (t.includes('MAX(scan_date), 23) AS d')) return rs([{ d: '2026-10-18' }]);
    if (t.includes('FROM dbo.Nginx_Audit_Locations l')) {
      auditCalls++;
      return rs([T('GBRVPP07', VH, '/audit-only/', 'static')]);
    }
    return rs([]);
  };
  const sql = new Proxy({}, { get: () => () => 'tip' });
  const r = await loadMigration({ query, sql, hasProxyColumns: async () => false });
  assert.equal(r.proxyReady, false);
  assert.equal(r.auditReady, true);
  assert.equal(auditCalls, 1, 'nginx-T detail sorgusu erken donusle atlandi');
  assert.ok(
    r.groups.find((g) => g.id === 'glomo').locations.some((l) => l.location === '/audit-only/'),
    'bagimsiz nginx-T location kayboldu',
  );
});
