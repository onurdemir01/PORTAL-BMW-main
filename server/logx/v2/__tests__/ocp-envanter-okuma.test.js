'use strict';
// OCP ENVANTER OKUMASI (server/logx/v2/ocp-inventory.cjs) — dbo.Openshift_Inventory'den namespace ve
// uygulama katalogu. Gercek DB yok: envanter havuzu (inventory/mssql.cjs `getPool`, cagri aninda
// okunur) sahte bir havuz doner; sorgu metni, parametreler ve sonucun kurulusu dogrulanir.
//   OI1 cluster listesi kirpilir ve tekillesir; bossa ya da havuz yoksa sorgusuz bos yanit.
//   OI2 namespace'ler: ilk gorulme sirasi, uygulama sayisi cluster'lar arasi EN YUKSEK (toplam
//       degil), cluster kirilimi tekil; bos namespace atlanir; son yukleme ani.
//   OI3 uygulamalar: namespace parametreli, cluster kirilimi, tur 'Unknown'; bos ad atlanir.
//   OI4 sonuc yoksa cached=false; son yukleme ani okunamazsa null (katalog yine doner).
const test = require('node:test');
const assert = require('node:assert/strict');

const envanter = require('../../../inventory/mssql.cjs');
const { getNamespaces, getApps } = require('../ocp-inventory.cjs');

const BOS = { items: [], cached: false, fetchedAt: null, stale: false, source: null };

/** Sahte havuz: her request() girdileri ve sorguyu kaydeder; yanit sorgu metnine gore. */
function havuz(t, { satirlar = [], enSon = '2026-11-27T03:00:00Z', enSonHata } = {}) {
  const istekler = [];
  const p = {
    request() {
      const r = { girdiler: {}, sorgu: null };
      istekler.push(r);
      return {
        input(ad, deger) {
          r.girdiler[ad] = deger;
          return this;
        },
        async query(metin) {
          r.sorgu = metin.replace(/\s+/g, ' ').trim();
          if (r.sorgu.startsWith('SELECT MAX(loaded_at)')) {
            if (enSonHata) throw enSonHata;
            return { recordset: [{ latest: enSon }] };
          }
          return { recordset: satirlar };
        },
      };
    },
  };
  const getPool = t.mock.method(envanter, 'getPool', async () => p);
  return { istekler, getPool };
}

test('OI1 cluster listesi kirpilir ve tekillesir; bos ya da havuzsuz istek sorgusuz', async (t) => {
  const h = havuz(t);
  for (const clusterNames of [undefined, [], ['', '  ', null]]) {
    assert.deepEqual(await getNamespaces({ clusterNames }), BOS);
    assert.deepEqual(await getApps({ clusterNames, namespace: 'ns' }), BOS);
  }
  assert.deepEqual(await getApps({ clusterNames: ['c1'], namespace: '  ' }), BOS);
  assert.deepEqual(await getApps({ clusterNames: ['c1'] }), BOS);
  assert.equal(h.getPool.mock.callCount(), 0, 'gecerli girdi yokken havuz istendi');

  await getNamespaces({ clusterNames: [' c1 ', 'c2', 'c1', ''] });
  assert.deepEqual(h.istekler[0].girdiler, { c0: 'c1', c1: 'c2' });
  assert.match(h.istekler[0].sorgu, /WHERE cluster IN \(@c0, @c1\) GROUP BY cluster, namespace/);

  t.mock.method(envanter, 'getPool', async () => null);
  assert.deepEqual(await getNamespaces({ clusterNames: ['c1'] }), BOS);
  assert.deepEqual(await getApps({ clusterNames: ['c1'], namespace: 'ns' }), BOS);
});

test('OI2 namespace katalogu: sira, en yuksek sayi, cluster kirilimi, son yukleme', async (t) => {
  const h = havuz(t, {
    satirlar: [
      { cluster: 'c2', namespace: 'odeme', app_count: 3 },
      { cluster: 'c1', namespace: ' odeme ', app_count: 5 },
      { cluster: 'c1', namespace: 'cari', app_count: '2' },
      { cluster: ' c1 ', namespace: 'cari', app_count: null },
      { cluster: '', namespace: 'kasa', app_count: 1 },
      { cluster: 'c1', namespace: '  ', app_count: 9 },
      { cluster: 'c1', namespace: null, app_count: 9 },
    ],
  });
  const r = await getNamespaces({ clusterNames: ['c1', 'c2'] });
  assert.deepEqual(r, {
    items: ['odeme', 'cari', 'kasa'],
    counts: { odeme: 5, cari: 2, kasa: 1 },
    clusters: { odeme: ['c2', 'c1'], cari: ['c1'], kasa: [] },
    cached: true,
    fetchedAt: '2026-11-27T03:00:00Z',
    stale: false,
    source: 'openshift_inventory',
  });
  assert.equal(
    h.istekler[0].sorgu,
    'SELECT cluster, namespace, COUNT(DISTINCT application) AS app_count FROM dbo.Openshift_Inventory ' +
      'WHERE cluster IN (@c0, @c1) GROUP BY cluster, namespace ORDER BY namespace',
  );
  assert.equal(
    h.istekler[1].sorgu,
    'SELECT MAX(loaded_at) AS latest FROM dbo.Openshift_Inventory WHERE cluster IN (@c0, @c1)',
  );
  assert.deepEqual(h.istekler[1].girdiler, { c0: 'c1', c1: 'c2' });
});

test('OI3 uygulama katalogu: namespace parametreli, cluster kirilimi, tur bilinmiyor', async (t) => {
  const h = havuz(t, {
    satirlar: [
      { cluster: 'c1', application: 'odeme-api' },
      { cluster: 'c2', application: ' odeme-api ' },
      { cluster: 'c2', application: 'odeme-api' },
      { cluster: null, application: 'odeme-web' },
      { cluster: 'c1', application: '' },
    ],
  });
  const r = await getApps({ clusterNames: ['c1', 'c2'], namespace: ' odeme ' });
  const tur = (name) => ({ kind: 'Unknown', name, replicas: null, image: null, labelApp: null });
  assert.deepEqual(r, {
    items: [tur('odeme-api'), tur('odeme-web')],
    clusters: { 'odeme-api': ['c1', 'c2'], 'odeme-web': [] },
    cached: true,
    fetchedAt: '2026-11-27T03:00:00Z',
    stale: false,
    source: 'openshift_inventory',
  });
  assert.deepEqual(h.istekler[0].girdiler, { ns: 'odeme', c0: 'c1', c1: 'c2' });
  assert.equal(
    h.istekler[0].sorgu,
    'SELECT DISTINCT cluster, application FROM dbo.Openshift_Inventory ' +
      'WHERE namespace = @ns AND cluster IN (@c0, @c1) ORDER BY application',
  );
});

test('OI4 sonuc yoksa cached=false; son yukleme okunamazsa null', async (t) => {
  havuz(t, { satirlar: [], enSon: null });
  let r = await getNamespaces({ clusterNames: ['c1'] });
  assert.deepEqual([r.items, r.cached, r.fetchedAt], [[], false, null]);
  r = await getApps({ clusterNames: ['c1'], namespace: 'ns' });
  assert.deepEqual([r.items, r.cached, r.fetchedAt], [[], false, null]);

  havuz(t, {
    satirlar: [{ cluster: 'c1', namespace: 'ns', application: 'a', app_count: 1 }],
    enSonHata: new Error('zaman asimi'),
  });
  r = await getNamespaces({ clusterNames: ['c1'] });
  assert.deepEqual([r.items, r.fetchedAt], [['ns'], null]);
  r = await getApps({ clusterNames: ['c1'], namespace: 'ns' });
  assert.deepEqual([r.items.map((x) => x.name), r.fetchedAt], [['a'], null]);
});
