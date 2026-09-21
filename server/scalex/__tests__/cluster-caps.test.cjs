// server/scalex/__tests__/cluster-caps.test.cjs
//
// CLUSTER YETENEK ENVANTERI — kesifteki en pahali iki kalemin onbellegi.
//
// OLCULEN MALIYET (cluster basina ~110 `oc` cagrisi, ~30 sn):
//   ≈ 14  login/project/hpa/pdb/configmap/api-resources
//   + G   API grubu basina 1 × `oc get --raw`     G ≈ 40-60   ← %45
//   + 2E  ekstra CRD tipi basina probe+jsonpath   E ≈ 20      ← %35
// `G` ve `2E` NAMESPACE'TEN, UYGULAMADAN, KULLANICIDAN BAGIMSIZ.
//
// EN TEHLIKELI HATA SINIFI BURADA "SESSIZ EKSIK": yanlis bir onbellek,
// olceklenebilir operator nesnelerini listeden dusurur ve HICBIR HATA VERMEZ
// (`discovery.yml` yalnizca `error` durumunda fail eder). Bu yuzden bekcilerin
// cogu "ne zaman onbellek KULLANILMAZ" sorusunu olcuyor.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const RUNNER = fs.readFileSync(
  path.join(__dirname, '..', '..', 'ansible', 'bmw_portal', 'scalex', 'scalex_app', 'files', 'scalex_runner.sh'),
  'utf8',
);
const IX = fs.readFileSync(path.join(__dirname, '..', 'index.cjs'), 'utf8');
const CAPS_SRC = fs.readFileSync(path.join(__dirname, '..', 'cluster-caps.cjs'), 'utf8');
const SETUP = fs.readFileSync(path.join(__dirname, '..', '..', 'db', 'mssql-setup.cjs'), 'utf8');
const RESULT = require('../result.cjs');

// `cluster-caps.cjs` DB'ye bagli; saf mantigi sahte bir `db` ile kosturuyoruz.
function capsWith(rows) {
  const Module = require('node:module');
  const file = path.join(__dirname, '..', 'cluster-caps.cjs');
  const m = new Module(file);
  m.filename = file;
  m.paths = Module._nodeModulePaths(path.dirname(file));
  const sahteRequire = (id) =>
    id.includes('db/index') ? { query: async () => ({ rows, rowCount: rows.length }) } : m.require(id);
  const fn = new Function('exports', 'require', 'module', '__filename', '__dirname', CAPS_SRC);
  fn(m.exports, sahteRequire, m, m.filename, path.dirname(file));
  return m.exports;
}

const satir = (over = {}) => ({
  env: 'prod',
  tenant: 'ark',
  cluster_name: 'c1',
  kinds_csv: 'rollouts.argoproj.io,foos.bar.io',
  rbac_json: '{"deployments":true}',
  resources_readable: 1,
  scanned_by: 'admin',
  awx_job_id: 7,
  fetched_at: new Date().toISOString(),
  expires_at: new Date(Date.now() + 86400000).toISOString(),
  ...over,
});

test('CC1 UC DURUM AYRI: hic taranmadi / tarandi-bos / okunamadi', () => {
  const caps = capsWith([]);
  // hic taranmadi -> kinds null
  assert.equal(caps.list.name, 'list');
  const bos = capsWith([satir({ kinds_csv: null })]);
  return bos.list({ env: 'prod', tenant: 'ark' }).then((r) => {
    assert.equal(r[0].kinds, null, '"hic taranmadi" bos dizi ile karistirilmis');
    return capsWith([satir({ kinds_csv: '' })]).list({}).then((r2) => {
      assert.deepEqual(r2[0].kinds, [], '"tarandi, bos" null ile karistirilmis');
    });
  });
});

test('CC2 OKUNAMAMIS tarama kesfi HIZLANDIRMAK icin KULLANILMAZ', async () => {
  // `oc api-resources` dusmusse liste bos gorunur ama bu "CRD yok" DEMEK DEGIL.
  const caps = capsWith([satir({ resources_readable: 0 })]);
  const k = await caps.kindsForScope({ env: 'prod', tenant: 'ark', clusterNames: ['c1'] });
  assert.equal(k, null, 'okunamamis tarama onbellek olarak kullanilmis — SESSIZ EKSIK');
});

test('CC3 KISMI onbellek KULLANILMAZ (onbellek olmamasindan TEHLIKELI)', async () => {
  // Kesif tek bir `SCALEX_EXTRA_KINDS` degeriyle kosuyor ve o deger HER
  // cluster'a gidiyor. Bir cluster'in kaydi varken digerininki yoksa, eksik
  // cluster o listeyle SINIRLANIR ve KENDI CRD'leri sessizce kaybolur.
  const caps = capsWith([satir({ cluster_name: 'c1' })]);
  const k = await caps.kindsForScope({ env: 'prod', tenant: 'ark', clusterNames: ['c1', 'c2'] });
  assert.equal(k, null, 'kismi onbellek kullanilmis — eksik cluster`in CRD`leri kaybolur');
});

test('CC4 HIC TARANMAMIS kayit onbellek sayilmaz', async () => {
  const caps = capsWith([satir({ kinds_csv: null })]);
  const k = await caps.kindsForScope({ env: 'prod', tenant: 'ark', clusterNames: ['c1'] });
  assert.equal(k, null);
});

test('CC5 GUVENILIR onbellek kullanilir ve BIRLESIM alinir', async () => {
  const caps = capsWith([
    satir({ cluster_name: 'c1', kinds_csv: 'a.io,b.io' }),
    satir({ cluster_name: 'c2', kinds_csv: 'b.io,c.io' }),
  ]);
  const k = await caps.kindsForScope({ env: 'prod', tenant: 'ark', clusterNames: ['c1', 'c2'] });
  assert.deepEqual([...k].sort(), ['a.io', 'b.io', 'c.io']);
});

test('CC6 okunamamis tarama YINE YAZILIR ama kinds NULL kalir', async () => {
  const yazilan = [];
  const file = path.join(__dirname, '..', 'cluster-caps.cjs');
  const Module = require('node:module');
  const m = new Module(file);
  m.filename = file;
  m.paths = Module._nodeModulePaths(path.dirname(file));
  const sahte = {
    query: async (sql, p) => {
      yazilan.push({ sql, p });
      return { rows: [], rowCount: sql.startsWith('UPDATE') ? 0 : 1 };
    },
  };
  const fn = new Function('exports', 'require', 'module', '__filename', '__dirname', CAPS_SRC);
  fn(m.exports, (id) => (id.includes('db/index') ? sahte : m.require(id)), m, m.filename, path.dirname(file));
  await m.exports.save({
    env: 'prod', tenant: 'ark', clusterName: 'c1',
    kinds: ['x.io'], rbac: {}, resourcesReadable: false, scannedBy: 'a', awxJobId: 1,
  });
  // 4. parametre = kinds_csv
  assert.equal(yazilan[0].p[3], null, 'okunamamis tarama kinds YAZMIS — sessiz eksik uretir');
  assert.equal(yazilan[0].p[5], 0, '`resources_readable` bayragi yazilmamis');
});

// ── RUNNER SOZLESMESI ───────────────────────────────────────────────────────

test('CC7 runner onbellek doluysa HIC `oc` cagirmiyor', () => {
  const i = RUNNER.indexOf('load_extra_scalable_resources() {');
  const govde = RUNNER.slice(i, RUNNER.indexOf('resource_candidates()', i));
  // Kisa devre, `oc` cagrilarindan ONCE olmali; sonra olsaydi hic ates almazdi.
  const kisaDevre = govde.indexOf('if [ -n "$EXTRA_KINDS_TEXT" ]; then');
  const ilkOc = govde.indexOf('load_preferred_group_versions');
  assert.ok(kisaDevre > 0, 'onbellek kisa devresi YOK');
  assert.ok(kisaDevre < ilkOc, 'kisa devre `oc` cagrilarindan SONRA — hic ates almaz');
  assert.ok(
    govde.includes('printf \'%s\\n\' "$EXTRA_KINDS_TEXT"'),
    'onbellek listesi dondurulmuyor',
  );
});

test('CC8 BOS onbellek ESKI yolu kosturuyor (fail-safe)', () => {
  const i = RUNNER.indexOf('load_extra_scalable_resources() {');
  const govde = RUNNER.slice(i, RUNNER.indexOf('resource_candidates()', i));
  // Kisa devre `-n` ile: BOS string eski yola duser. `-z` olsaydi ters calisirdi.
  assert.match(govde, /if \[ -n "\$EXTRA_KINDS_TEXT" \]/, 'bos onbellek eski yolu kosturmuyor');
  assert.match(govde, /load_preferred_group_versions/, 'eski yol SILINMIS — fail-safe yok');
});

test('CC9 `capabilities` modu onbellegi URETIR, TUKETMEZ', () => {
  const i = RUNNER.indexOf('discover_capabilities() {');
  assert.ok(i > 0, 'capabilities modu yok');
  const govde = RUNNER.slice(i, RUNNER.indexOf('\nrc=0', i));
  assert.match(govde, /EXTRA_KINDS_TEXT=""/, 'onbellegi tuketiyor — bayat liste kendini dogrular');
  assert.match(govde, /CAP_SUMMARY/, 'ozet satiri yok — "okunamadi" ayrimi kaybolur');
  assert.match(govde, /resources_readable=/, 'okunabilirlik bildirilmiyor');
  // Portal da onu gecirmemeli.
  // Portal da onu TUKETMEMELI: `capabilities` modunda onbellek HIC okunmaz.
  assert.match(
    IX,
    /if \(mode !== 'capabilities'\) \{[\s\S]{0,400}?kindsForScope/,
    'portal `capabilities` modunda da onbellek okuyor — bayat liste kendini dogrular',
  );
});

test('CC10 `capabilities` NAMESPACE istemiyor (cluster duzeyi)', () => {
  assert.match(
    RUNNER,
    /\[ -z "\$NS" \] && \[ "\$DISCOVERY_MODE" != "capabilities" \]/,
    'namespace hala kosulsuz zorunlu — cluster duzeyi tarama alakasiz sebeple duser',
  );
  assert.match(
    RUNNER,
    /if \[ "\$DISCOVERY_MODE" != "capabilities" \]; then\n  if ! oc project/,
    '`oc project` capabilities modunda da kosuyor',
  );
});

test('CC11 `resources_readable` YALNIZCA "yes" iken true sayiliyor', () => {
  // Eksik/bilinmeyen degeri "okunabildi" saymak, okunamamis bir taramayi
  // GECERLI onbellek olarak yazdirirdi.
  const r = RESULT.extractDiscoveryResult({
    scalex_discovery_result: {
      mode: 'capabilities',
      overall_status: 'ok',
      items: [
        { cluster: 'c1', step: 'CAP_KIND', status: 'OK', detail: 'kind=a.io' },
        { cluster: 'c1', step: 'CAP_SUMMARY', status: 'WARN', detail: 'kinds=1 resources_readable=no' },
        { cluster: 'c2', step: 'CAP_SUMMARY', status: 'OK', detail: 'kinds=0 resources_readable=yes' },
      ],
    },
  });
  const c1 = r.capabilities.find((c) => c.cluster === 'c1');
  const c2 = r.capabilities.find((c) => c.cluster === 'c2');
  assert.equal(c1.resourcesReadable, false, '"no" okunabilir sayilmis');
  assert.equal(c2.resourcesReadable, true);
  assert.deepEqual(c1.kinds, ['a.io']);

  // ASIL TEHLIKE "no" DEGIL, EKSIK/BEKLENMEDIK DEGER.
  //
  // Mutasyon turunda `=== 'yes'` yerine `!== 'no'` yazmak HICBIR BEKCIYI ates
  // almadi: test yalnizca 'yes'/'no' deniyordu ve iki uygulama o iki degerde
  // AYNI davraniyor. Oysa alan hic gelmezse (eski runner, kirpilmis satir,
  // bicim degisikligi) `!== 'no'` onu OKUNABILIR sayar ve OKUNAMAMIS bir
  // taramayi GECERLI onbellek olarak yazdirir — tam kacindigimiz sey.
  const eksik = RESULT.extractDiscoveryResult({
    scalex_discovery_result: {
      mode: 'capabilities',
      overall_status: 'ok',
      items: [
        { cluster: 'c3', step: 'CAP_SUMMARY', status: 'OK', detail: 'kinds=5' },
        { cluster: 'c4', step: 'CAP_SUMMARY', status: 'OK', detail: 'kinds=5 resources_readable=maybe' },
      ],
    },
  });
  assert.equal(
    eksik.capabilities.find((c) => c.cluster === 'c3').resourcesReadable,
    false,
    'EKSIK `resources_readable` okunabilir sayilmis — okunamamis tarama onbellege girer',
  );
  assert.equal(
    eksik.capabilities.find((c) => c.cluster === 'c4').resourcesReadable,
    false,
    'BEKLENMEDIK deger okunabilir sayilmis',
  );
});

test('CC12 tablo CREATE + INDEX ile tanimli, tanecik CLUSTER duzeyi', () => {
  assert.match(SETUP, /CREATE TABLE scalex_cluster_caps/, 'tablo yok');
  assert.match(
    SETUP,
    /CONSTRAINT UQ_scalex_cluster_caps UNIQUE \(env, tenant, cluster_name\)/,
    'tanecik yanlis — cluster duzeyi olmali',
  );
  assert.match(SETUP, /IX_scalexcaps_scope/, 'indeks yok');
  // Tablo YENI oldugu icin `alters` girdisi GEREKMEZ (kolonlar CREATE ile gelir);
  // ama ileride kolon eklenirse o kural gecerli.
});

test('CC13 envanter okuma SINIRLI (sinirsiz okuma yedi OOM`un sinifiydi)', () => {
  assert.match(CAPS_SRC, /SELECT TOP 500 \* FROM scalex_cluster_caps/, 'okuma sinirsiz');
});
