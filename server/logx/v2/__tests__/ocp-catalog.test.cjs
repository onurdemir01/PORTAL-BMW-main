// server/logx/v2/__tests__/ocp-catalog.test.cjs — envanter ∪ onbellek birlesimi.
//
// COZDUGU KIRIK DONGU: sihirbaz YALNIZCA dbo.Openshift_Inventory'yi okuyordu, ama
// "Bu namespace'i tara" sonucu ocp_*_cache'e yaziliyordu. Yani taramayi tetikleyen
// kullanici bile sonucu goremiyordu; "A tarasin, B faydalansin" hic calismiyordu.
//
// SINIR: bu modul envanter tablosuna YAZMAZ (Onur'un karari — bkz.
// docs/OCP-NAMESPACE-KATALOGU-KARARI.md). Testler bunu da kilitler.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const inventory = require('../ocp-inventory.cjs');
const cache = require('../ocp-cache.cjs');
const catalog = require('../ocp-catalog.cjs');

function withSources({ inv = {}, cached = {} }, fn) {
  const oi = inventory.getNamespaces, oia = inventory.getApps;
  const oc = cache.getNamespaces, oca = cache.getApps;
  inventory.getNamespaces = async () => inv.namespaces ?? { items: [], cached: false, fetchedAt: null, stale: false };
  inventory.getApps = async () => inv.apps ?? { items: [], cached: false, fetchedAt: null, stale: false };
  cache.getNamespaces = async ({ clusterName }) => (cached.namespaces?.[clusterName]
    ?? { items: [], cached: false, fetchedAt: null, stale: false });
  cache.getApps = async ({ clusterName }) => (cached.apps?.[clusterName]
    ?? { items: [], cached: false, fetchedAt: null, stale: false });
  return Promise.resolve(fn()).finally(() => {
    inventory.getNamespaces = oi; inventory.getApps = oia;
    cache.getNamespaces = oc; cache.getApps = oca;
  });
}

const ARGS = { env: 'prod', tenant: 'ark', clusterNames: ['c1', 'c2'] };

test('namespace: iki kaynak BIRLESTIRILIR, envanter kaynak etiketini kazanir', async () => {
  await withSources({
    inv: { namespaces: { items: ['ns-inv', 'ns-both'], cached: true, fetchedAt: '2026-08-09T06:00:00Z', stale: false } },
    cached: {
      namespaces: {
        c1: { items: ['ns-both', 'ns-scan'], cached: true, fetchedAt: '2026-08-09T14:32:00Z', stale: false },
      },
    },
  }, async () => {
    const out = await catalog.getNamespaces(ARGS);
    assert.deepEqual(out.items, ['ns-both', 'ns-inv', 'ns-scan']);
    assert.equal(out.sources['ns-inv'], 'inventory');
    assert.equal(out.sources['ns-scan'], 'discovery', 'kullanici taramasi listede GORUNMELI');
    assert.equal(out.sources['ns-both'], 'inventory', 'iki kaynakta da varsa envanter kazanir');
    assert.equal(out.source, 'mixed');
  });
});

test('namespace: envanter BOS olsa bile kullanici taramasi gorunur (kirik dongunun ozu)', async () => {
  await withSources({
    inv: { namespaces: { items: [], cached: false, fetchedAt: null, stale: false } },
    cached: { namespaces: { c2: { items: ['yeni-ns'], cached: true, fetchedAt: '2026-08-09T14:32:00Z', stale: false } } },
  }, async () => {
    const out = await catalog.getNamespaces(ARGS);
    assert.deepEqual(out.items, ['yeni-ns']);
    assert.equal(out.cached, true, 'liste bos degilse cached=true olmali (aksi halde UI onu yok sayar)');
    assert.equal(out.sources['yeni-ns'], 'discovery');
  });
});

test('tazelik: en YENI zaman damgasi; herhangi biri bayatsa BAYAT', async () => {
  await withSources({
    inv: { namespaces: { items: ['a'], cached: true, fetchedAt: '2026-08-09T06:00:00Z', stale: false } },
    cached: { namespaces: { c1: { items: ['b'], cached: true, fetchedAt: '2026-08-09T14:32:00Z', stale: true } } },
  }, async () => {
    const out = await catalog.getNamespaces(ARGS);
    assert.equal(new Date(out.fetchedAt).toISOString(), '2026-08-09T14:32:00.000Z');
    assert.equal(out.stale, true, 'bayat kaynak varsa iyimser gosterip kullaniciyi yaniltma');
  });
});

test('uygulama: ONBELLEK kaydi envanterin yalin kaydini EZER (kind/replica tasir)', async () => {
  await withSources({
    inv: { apps: { items: [{ kind: 'Unknown', name: 'app1', replicas: null }], cached: true, fetchedAt: null, stale: false } },
    cached: {
      apps: {
        c1: { items: [{ kind: 'Deployment', name: 'app1', replicas: 3 }], cached: true, fetchedAt: null, stale: false },
      },
    },
  }, async () => {
    const out = await catalog.getApps({ ...ARGS, namespace: 'ns1' });
    assert.equal(out.items.length, 1);
    assert.equal(out.items[0].kind, 'Deployment', 'daha zengin kayit kazanmali');
    assert.equal(out.items[0].replicas, 3);
    assert.equal(out.sources.app1, 'inventory', 'kaynak etiketi yine envanterdir');
  });
});

test('bir kaynak PATLARSA digeri yine doner (kesinti buyutulmez)', async () => {
  const oi = inventory.getNamespaces;
  const oc = cache.getNamespaces;
  inventory.getNamespaces = async () => { throw new Error('envanter DB kapali'); };
  cache.getNamespaces = async ({ clusterName }) => (clusterName === 'c1'
    ? { items: ['ns-scan'], cached: true, fetchedAt: null, stale: false }
    : { items: [], cached: false, fetchedAt: null, stale: false });
  try {
    const out = await catalog.getNamespaces(ARGS);
    assert.deepEqual(out.items, ['ns-scan']);
  } finally {
    inventory.getNamespaces = oi;
    cache.getNamespaces = oc;
  }
});

test('bos cluster listesinde HIC sorgu yapilmaz', async () => {
  const oi = inventory.getNamespaces;
  let called = false;
  inventory.getNamespaces = async () => { called = true; return { items: [] }; };
  try {
    const out = await catalog.getNamespaces({ env: 'prod', tenant: 'ark', clusterNames: [] });
    assert.deepEqual(out.items, []);
    assert.equal(called, false);
  } finally {
    inventory.getNamespaces = oi;
  }
});

test('envanter tablosuna YAZAN bir yol YOK (Onur karari)', () => {
  const src = require('node:fs').readFileSync(require.resolve('../ocp-catalog.cjs'), 'utf8');
  // SQL ANAHTAR SOZCUGU olarak arariz: `mergeFreshness` gibi kimlikler yanlis pozitif
  // vermesin diye kelime siniri + ardindan bosluk sarti.
  assert.ok(
    !/\b(INSERT\s+INTO|UPDATE\s+\w|DELETE\s+FROM|MERGE\s+\w)/i.test(src),
    'katalog birlestiricisi salt-okunur olmali'
  );
  // Tabloya dogrudan erisim yok: yalnizca ocp-inventory.cjs uzerinden okunur.
  // Yorum satirlari haric tutulur — dosya basindaki mimari not tabloyu ADIYLA aniyor.
  const code = src.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
  assert.ok(!/dbo\.Openshift_Inventory/i.test(code), 'tabloya dogrudan SQL erisimi olmamali');
  assert.ok(/require\('\.\/ocp-inventory\.cjs'\)/.test(code), 'okuma ocp-inventory.cjs uzerinden');
});
