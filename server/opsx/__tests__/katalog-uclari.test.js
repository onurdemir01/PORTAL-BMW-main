// server/opsx/__tests__/katalog-uclari.test.js - OpsX / Telnet / FileX ortak katalog uclari (2026-11-24).
//   KU1 uygulama arama: LogX legacy.searchApps sonucu aynen; hata err.status (yoksa 500)
//   KU2 sunucular: verilen hostsForApp ile; hata yolu
//   KU3 cluster agaci: LogX katalogu; hata yolu
//   KU4 namespace'ler: env / tenant yoksa 400; kullanici namespacesForCluster'a gider; hata yolu
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const durum = { legacy: null, admin: null };
function stub(rel, exports) {
  const p = require.resolve(rel);
  require.cache[p] = { id: p, filename: p, loaded: true, exports };
}
stub('../../logx/v2/legacy.cjs', { searchApps: (q) => durum.legacy(q) });
stub('../../logx/v2/admin.cjs', { getClusterTree: () => durum.admin() });
const K = require('../katalog-uclari.cjs');

const res = () => ({
  kod: 200,
  status(c) {
    this.kod = c;
    return this;
  },
  json(b) {
    this.govde = b;
    return this;
  },
});
const hata = (status) => Object.assign(new Error('okunamadi'), status ? { status } : {});

test('KU1 uygulama arama LogX kaynagindan; hata durumu korunur', async () => {
  durum.legacy = async (q) => ({ apps: [{ name: `pay-${q}` }], kaynak: 'envanter' });
  let r = res();
  await K.uygulamaAra({ query: { search: 'api' } }, r);
  assert.deepEqual(
    [r.kod, r.govde],
    [200, { ok: true, apps: [{ name: 'pay-api' }], kaynak: 'envanter' }],
  );
  durum.legacy = async () => {
    throw hata(503);
  };
  r = res();
  await K.uygulamaAra({ query: {} }, r);
  assert.deepEqual([r.kod, r.govde], [503, { ok: false, message: 'okunamadi' }]);
});

test('KU2 sunucular verilen hostsForApp ile', async () => {
  const sorulan = [];
  const uc = K.sunucular(async (app) => {
    sorulan.push(app);
    if (app === 'yok') throw hata();
    return [{ host: 'APP01' }];
  });
  let r = res();
  await uc({ query: { app: 'pay-api' } }, r);
  assert.deepEqual(r.govde, { ok: true, hosts: [{ host: 'APP01' }] });
  r = res();
  await uc({ query: { app: 'yok' } }, r);
  assert.deepEqual([r.kod, r.govde], [500, { ok: false, message: 'okunamadi' }]);
  assert.deepEqual(sorulan, ['pay-api', 'yok']);
});

test('KU3 cluster agaci LogX katalogundan', async () => {
  durum.admin = async () => ({ dev: { pay: ['ocp-dev-01'] } });
  let r = res();
  await K.clusterAgaci({}, r);
  assert.deepEqual(r.govde, { ok: true, tree: { dev: { pay: ['ocp-dev-01'] } } });
  durum.admin = async () => {
    throw hata(502);
  };
  r = res();
  await K.clusterAgaci({}, r);
  assert.equal(r.kod, 502);
});

test("KU4 namespace'ler: env / tenant zorunlu, kullanici kapiya gider", async () => {
  const cagri = [];
  const uc = K.ocpNamespaceleri(async (env, tenant, user) => {
    cagri.push([env, tenant, user.username]);
    if (tenant === 'kirik') throw hata(409);
    return ['ns-a'];
  });
  for (const query of [{}, { env: 'dev' }, { tenant: 'pay' }, { env: ' ', tenant: 'pay' }]) {
    const r = res();
    await uc({ query, session: { user: { username: 'u' } } }, r);
    assert.deepEqual([r.kod, r.govde], [400, { ok: false, message: 'env ve tenant gerekli.' }]);
  }
  let r = res();
  await uc({ query: { env: ' dev ', tenant: 'pay' }, session: { user: { username: 'u' } } }, r);
  assert.deepEqual(r.govde, { ok: true, namespaces: ['ns-a'] });
  r = res();
  await uc({ query: { env: 'dev', tenant: 'kirik' } }, r);
  assert.equal(r.kod, 409);
  assert.deepEqual(cagri, [
    ['dev', 'pay', 'u'],
    ['dev', 'kirik', undefined],
  ]);
});
