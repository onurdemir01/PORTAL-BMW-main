// server/logx/v2/__tests__/ocp-sync-tur.test.js - periyodik OCP onbellek beslemesinin (ocp-sync.cjs)
// AcIK bir turu: bastion basina gruplama, cluster basina durum, namespace / uygulama onbellegi,
// teknik istek satirinin her yolda silinmesi, yoklama ve zaman asimi, ust uste tur, zamanlayici.
//
// Gercek DB / AWX yok: modulun cagri aninda okudugu islevler (db.query, requests, ocp, jobs,
// ocp-cache, ocp-app-parse, ocp-runtime-config) sahte. Varsayilan kapali / acil kacis / bos liste
// garantileri ocp-sync.test.js'te.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const db = require('../../../db/index.cjs');
const cfgMod = require('../ocp-runtime-config.cjs');
const requests = require('../requests.cjs');
const ocp = require('../ocp.cjs');
const jobs = require('../jobs.cjs');
const cache = require('../ocp-cache.cjs');
const parse = require('../ocp-app-parse.cjs');
const sync = require('../ocp-sync.cjs');

const ACIK = {
  periodicSyncEnabled: true,
  periodicSyncMaxClusters: 5,
  periodicSyncMaxNamespaces: 0,
  periodicSyncIntervalMin: 30,
};
const K = (ad, host = 'b1', ek = {}) => ({
  env: 'prod',
  tenant: 'bmw',
  cluster_name: ad,
  terminal_host: host,
  api_url: `https://${ad}.ornek.invalid:6443`,
  vault_credential_key: `vk_${ad}`,
  ...ek,
});

/**
 * @param {any} t
 * @param {{ kumeler?: any[], cfg?: any, artefaktlar?: any[], updateHata?: any }} [s]
 */
function hazirla(t, s = {}) {
  const yazilan = [];
  const silinen = [];
  const sorgu = [];
  t.mock.method(cfgMod, 'getConfig', async () => s.cfg ?? ACIK);
  t.mock.method(db, 'query', async (q, p) => {
    sorgu.push(q);
    if (q.includes('FROM ocp_cluster_index')) return { rows: s.kumeler ?? [] };
    if (q.startsWith('UPDATE ocp_cluster_index')) {
      if (s.updateHata) throw s.updateHata;
      yazilan.push(p);
      return { rowCount: 1 };
    }
    if (q.startsWith('DELETE FROM logx_v2_requests')) {
      silinen.push(p);
      return { rowCount: 1 };
    }
    throw new Error(`beklenmeyen sorgu: ${q}`);
  });
  let no = 0;
  const olustur = t.mock.method(requests, 'createRequest', async () => ({ id: `r${++no}` }));
  const guncelle = t.mock.method(requests, 'updateRequest', async () => {});
  t.mock.method(requests, 'getRequestRow', async (id) => ({ request_id: id }));
  const sira = [...(s.artefaktlar ?? [])];
  const nsKesif = t.mock.method(ocp, 'discoverNamespaces', async (row) => ({
    status: 'successful',
    row,
    artifacts: sira.shift() ?? { clusters: [] },
  }));
  const uygKesif = t.mock.method(ocp, 'discoverApps', async () => ({
    status: 'successful',
    artifacts: { apps: 1 },
  }));
  const nsYaz = t.mock.method(cache, 'putNamespaces', async () => {});
  const uygYaz = t.mock.method(cache, 'putApps', async (x) => ({ written: x.entries.length }));
  t.mock.method(parse, 'parseAppDiscoveryResult', () => ({ entries: [{ a: 1 }, { a: 2 }] }));
  const uyari = t.mock.method(console, 'warn', () => {});
  t.mock.method(console, 'log', () => {});
  return { yazilan, silinen, sorgu, olustur, guncelle, nsKesif, uygKesif, nsYaz, uygYaz, uyari };
}

const durumlar = (yazilan) => yazilan.map((p) => `${p[4]}=${p[0]}${p[1] ? `:${p[1]}` : ''}`);

test('OS1 tur: bastion basina tek job, cluster basina durum, namespace onbellegi, teknik satir silinir', async (t) => {
  const h = hazirla(t, {
    kumeler: [K('c1'), K('c2'), K('c3', 'b2')],
    artefaktlar: [
      {
        clusters: [
          { cluster_name: 'c1', status: 'ok', namespaces: ['proj/ns-a', ' ns-b '] },
          { cluster_name: 'c2', status: 'failed', error: 'erisim yok' },
        ],
      },
      { clusters: [] },
    ],
  });
  const r = await sync.runOnce();
  assert.deepEqual(r, { scanned: 3, ok: 1, failed: 2 });
  assert.match(h.sorgu[0], /SELECT TOP \(5\) env, tenant, cluster_name/);
  assert.deepEqual(durumlar(h.yazilan), [
    'c1=ok',
    'c2=error:erisim yok',
    'c3=error:Playbook bu cluster icin sonuc dondurmedi.',
  ]);
  assert.deepEqual(h.yazilan[0].slice(2), ['prod', 'bmw', 'c1']);
  assert.equal(h.nsKesif.mock.callCount(), 2, 'iki bastion: iki job');
  assert.deepEqual(h.olustur.mock.calls[0].arguments, [
    { username: 'system:ocp-sync', sessionToken: 'ocp-sync', role: 'System' },
    'openshift',
  ]);
  assert.deepEqual(
    h.guncelle.mock.calls.map((c) => c.arguments),
    [
      ['r1', { state: 'draft', input: { env: 'prod', tenant: 'bmw', clusters: ['c1', 'c2'] } }],
      ['r2', { state: 'draft', input: { env: 'prod', tenant: 'bmw', clusters: ['c3'] } }],
    ],
  );
  assert.deepEqual(h.nsKesif.mock.calls[0].arguments, [{ request_id: 'r1' }]);
  assert.deepEqual(
    h.nsYaz.mock.calls.map((c) => c.arguments[0]),
    [
      {
        env: 'prod',
        tenant: 'bmw',
        clusterName: 'c1',
        namespaces: ['ns-a', 'ns-b'],
        source: 'periodic',
      },
    ],
  );
  assert.deepEqual(h.silinen, [
    ['r1', 'system:ocp-sync'],
    ['r2', 'system:ocp-sync'],
  ]);
  assert.equal(
    h.sorgu.filter(
      (q) => q === 'DELETE FROM logx_v2_requests WHERE request_id = $1 AND username = $2',
    ).length,
    2,
  );
  assert.equal(h.uygKesif.mock.callCount(), 0, 'namespace tavani 0: uygulama kesfi kapali');
});

test('OS2 grup hatasi: gruptaki her cluster hatali yazilir, digeri surer; teknik satir yine silinir', async (t) => {
  const h = hazirla(t, { kumeler: [K('c1'), K('c2'), K('c3', 'b2')] });
  ocp.discoverNamespaces.mock.mockImplementation(async (row) => {
    if (row.request_id === 'r1') throw new Error('AWX 503');
    return { status: 'failed', artifacts: null, errorMessage: 'job dustu' };
  });
  const r = await sync.runOnce();
  assert.deepEqual(r, { scanned: 3, ok: 0, failed: 3 });
  assert.deepEqual(durumlar(h.yazilan), [
    'c1=error:AWX 503',
    'c2=error:AWX 503',
    'c3=error:job dustu',
  ]);
  assert.equal(h.silinen.length, 2);
  assert.match(String(h.uyari.mock.calls[0].arguments[0]), /grup taramasi basarisiz \(bmw\/prod\)/);

  ocp.discoverNamespaces.mock.mockImplementation(async () => ({
    status: 'failed',
    artifacts: null,
  }));
  h.yazilan.length = 0;
  await sync.runOnce();
  assert.equal(durumlar(h.yazilan)[0], 'c1=error:Tarama sonuc uretmedi.');
});

test('OS3 teknik istek satiri guncellenemezse de silinir (her turda birikmez)', async (t) => {
  const h = hazirla(t, { kumeler: [K('c1')] });
  h.guncelle.mock.mockImplementation(async () => {
    throw new Error('updateRequest dustu');
  });
  const r = await sync.runOnce();
  assert.deepEqual(r, { scanned: 1, ok: 0, failed: 1 });
  assert.deepEqual(durumlar(h.yazilan), ['c1=error:updateRequest dustu']);
  assert.deepEqual(h.silinen, [['r1', 'system:ocp-sync']]);
  assert.equal(h.nsKesif.mock.callCount(), 0);
});

/** Bekleyen mikro gorevler ve sahte zamanlayicinin tetikledigi isler bitsin. */
const bosalt = async () => {
  for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r));
};

test('OS4 yoklama: is bitene kadar 5 sn arayla sorulur; 10 dk asilirsa zaman asimi', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 });
  const h = hazirla(t, { kumeler: [K('c1')] });
  ocp.discoverNamespaces.mock.mockImplementation(async () => ({ status: 'running' }));
  let soruldu = 0;
  const yokla = t.mock.method(jobs, 'pollJob', async () =>
    ++soruldu < 2
      ? { status: 'running' }
      : { status: 'successful', artifacts: { clusters: [{ cluster_name: 'c1', status: 'ok' }] } },
  );
  let p = sync.runOnce();
  await bosalt();
  t.mock.timers.tick(4999);
  await bosalt();
  assert.equal(yokla.mock.callCount(), 0, '5 sn dolmadan sorulmaz');
  t.mock.timers.tick(1);
  await bosalt();
  assert.equal(yokla.mock.callCount(), 1, '5. saniyede sorulur');
  t.mock.timers.tick(5000);
  await bosalt();
  assert.deepEqual(await p, { scanned: 1, ok: 1, failed: 0 });
  assert.equal(yokla.mock.callCount(), 2);
  assert.deepEqual(h.nsYaz.mock.calls[0].arguments[0].namespaces, []);

  yokla.mock.mockImplementation(async () => ({ status: 'running' }));
  h.yazilan.length = 0;
  p = sync.runOnce();
  await bosalt();
  for (let i = 0; i <= 120; i++) {
    t.mock.timers.tick(5000);
    await bosalt();
  }
  assert.deepEqual(await p, { scanned: 1, ok: 0, failed: 1 });
  assert.deepEqual(durumlar(h.yazilan), ['c1=error:Tarama zaman asimina ugradi.']);
});

test('OS5 uygulama kesfi: yalniz basarili clusterlarin namespaceleri, tekil, sirali, tavana kirpilir; hatasi turu dusurmez', async (t) => {
  const h = hazirla(t, {
    cfg: { ...ACIK, periodicSyncMaxNamespaces: 2 },
    kumeler: [K('c1'), K('c2')],
    artefaktlar: [
      {
        clusters: [
          { cluster_name: 'c1', status: 'ok', namespaces: ['b', 'x/a', 'proj/c', '', 'a'] },
          { cluster_name: 'c2', status: 'failed', namespaces: ['0-gizli'] },
        ],
      },
    ],
  });
  let r = await sync.runOnce();
  assert.deepEqual(r, { scanned: 2, ok: 1, failed: 1 });
  assert.deepEqual(h.uygKesif.mock.calls[0].arguments, [{ request_id: 'r1' }, ['a', 'b']]);
  assert.deepEqual(h.uygYaz.mock.calls[0].arguments, [
    { env: 'prod', tenant: 'bmw', entries: [{ a: 1 }, { a: 2 }], source: 'periodic' },
  ]);
  assert.match(String(h.uyari.mock.calls[0].arguments[0]), /3 namespace'ten ilk 2 tanesi tarandi/);

  // Uygulama kesfi sonuc uretmezse ya da duserse namespace sonucu gecerli kalir.
  for (const davranis of [
    async () => ({ status: 'failed', artifacts: null }),
    async () => {
      throw new Error('AWX yok');
    },
  ]) {
    h.uygKesif.mock.mockImplementation(davranis);
    ocp.discoverNamespaces.mock.mockImplementation(async () => ({
      status: 'successful',
      artifacts: { clusters: [{ cluster_name: 'c1', status: 'ok', namespaces: ['a'] }] },
    }));
    h.uyari.mock.resetCalls();
    r = await sync.runOnce();
    assert.equal(r.failed, 1, 'yalniz sonucsuz c2');
    assert.match(String(h.uyari.mock.calls.at(-1).arguments[0]), /uygulama kesfi atlandi/);
  }

  // Basarili namespace yoksa uygulama kesfi hic baslamaz.
  h.uygKesif.mock.resetCalls();
  ocp.discoverNamespaces.mock.mockImplementation(async () => ({
    status: 'successful',
    artifacts: { clusters: [{ cluster_name: 'c1', status: 'ok', namespaces: [] }] },
  }));
  await sync.runOnce();
  assert.equal(h.uygKesif.mock.callCount(), 0);
});

test('OS6 uygulama kesfi yoklamasi ve 15 dk zaman asimi', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 });
  const h = hazirla(t, {
    cfg: { ...ACIK, periodicSyncMaxNamespaces: 5 },
    kumeler: [K('c1')],
    artefaktlar: [{ clusters: [{ cluster_name: 'c1', status: 'ok', namespaces: ['a'] }] }],
  });
  h.uygKesif.mock.mockImplementation(async () => ({ status: 'running' }));
  const yokla = t.mock.method(jobs, 'pollJob', async () => ({ status: 'running' }));
  const p = sync.runOnce();
  await bosalt();
  for (let i = 0; i <= 180; i++) {
    t.mock.timers.tick(5000);
    await bosalt();
  }
  assert.deepEqual(await p, { scanned: 1, ok: 1, failed: 0 });
  assert.ok(yokla.mock.callCount() >= 179);
  assert.match(
    String(h.uyari.mock.calls.at(-1).arguments[1]),
    /Uygulama kesfi zaman asimina ugradi\./,
  );
  assert.equal(h.uygYaz.mock.callCount(), 0);
});

test('OS7 ust uste tur atlanir; yapilandirma okunamazsa tur hatayla biter ve kilit acilir', async (t) => {
  hazirla(t, { kumeler: [K('c1')] });
  let birak;
  ocp.discoverNamespaces.mock.mockImplementation(
    () =>
      new Promise((r) => (birak = () => r({ status: 'successful', artifacts: { clusters: [] } }))),
  );
  const ilk = sync.runOnce();
  await bosalt();
  assert.deepEqual(await sync.runOnce(), { skipped: true, reason: 'already_running' });
  birak();
  await ilk;

  cfgMod.getConfig.mock.mockImplementation(async () => {
    throw new Error('ayar tablosu yok');
  });
  assert.deepEqual(await sync.runOnce(), {
    skipped: true,
    reason: 'error',
    error: 'ayar tablosu yok',
  });
  cfgMod.getConfig.mock.mockImplementation(async () => ({ ...ACIK }));
  ocp.discoverNamespaces.mock.mockImplementation(async () => ({
    status: 'successful',
    artifacts: { clusters: [] },
  }));
  assert.equal((await sync.runOnce()).scanned, 1, 'kilit acildi');
});

test('OS8 durum yazilamazsa tur surer; durum 32, hata 1000 karakterle sinirli', async (t) => {
  const h = hazirla(t, { kumeler: [K('c1'), K('c2')], updateHata: new Error('kilit') });
  const r = await sync.runOnce();
  assert.equal(r.scanned, 2);
  assert.equal(h.uyari.mock.calls.filter((c) => /durum yazilamadi/.test(c.arguments[0])).length, 2);

  const h2 = hazirla(t, { kumeler: [K('c1')] });
  ocp.discoverNamespaces.mock.mockImplementation(async () => {
    throw new Error('e'.repeat(1500));
  });
  await sync.runOnce();
  assert.equal(h2.yazilan[0][1].length, 1000);
  assert.equal(h2.yazilan[0][0], 'error');
});

test('OS9 zamanlayici: ilk tur 5 dk sonra, sonra ayarli aralikla; ayar okunamazsa 6 saat; durdurulur', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  hazirla(t, { kumeler: [] });
  const tur = () => cfgMod.getConfig.mock.callCount();
  sync.startOcpSync();
  t.mock.timers.tick(5 * 60_000 - 1);
  await bosalt();
  assert.equal(tur(), 0, '5 dk dolmadan baslamaz');
  t.mock.timers.tick(1);
  await bosalt();
  assert.equal(tur(), 2, 'acilis ayari + ilk tur');
  t.mock.timers.tick(30 * 60_000);
  await bosalt();
  assert.equal(tur(), 3, 'ayarli aralik (30 dk) sonra yeni tur');
  sync.startOcpSync();
  sync.stopOcpSync();
  t.mock.timers.tick(60 * 60_000);
  await bosalt();
  assert.equal(tur(), 3, 'durdurulunca tur yok');

  cfgMod.getConfig.mock.mockImplementation(async () => {
    throw new Error('yok');
  });
  cfgMod.getConfig.mock.resetCalls();
  sync.startOcpSync();
  t.mock.timers.tick(5 * 60_000);
  await bosalt();
  t.mock.timers.tick(359 * 60_000);
  await bosalt();
  assert.equal(tur(), 2, 'varsayilan 360 dk dolmadi');
  t.mock.timers.tick(60_000);
  await bosalt();
  assert.equal(tur(), 3);
  sync.stopOcpSync();
});
