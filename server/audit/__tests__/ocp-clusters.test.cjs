// server/audit/__tests__/ocp-clusters.test.cjs
//
// Denetim > Openshift hucresindeki "k/n" ifadesindeki N'in nasil bulundugunu kilitler.
//
// NEDEN VAR (2026-09-10, kullanici bulgusu): hucre yalnizca VAR/YOK gosteriyordu, bu
// yuzden production'in 5 cluster'indan 1'inde olan uygulama 5'inde olanla AYIRT
// EDILEMIYORDU. Cluster bilgisi sadece fare ipucunda duruyordu.
//
// KRITIK TASARIM: cluster kumesi SABIT bir listeden GELMEZ, veriden cikarilir.
// PLATFORM_CLUSTERS ortam ayrimi tasimaz ve tasiyamaz - ayni cluster hem "-dev" hem
// "-test" namespace'i barindirabiliyor (ocp-platforms.cjs'te gercek veriyle belgeli).
// "Prod cluster'lari sunlardir" diye elle liste yazmak yanlis olurdu.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { envClustersFromApps } = require('../ocp-clusters.cjs');

const ENVS = ['dev', 'test', 'qa', 'prod'];
const app = (envs) => ({ envs });

test('kume VERIDEN cikarilir - o ortamda namespace barindiran cluster"lar', () => {
  const out = envClustersFromApps(
    [app({ prod: [{ cluster: 'p1' }, { cluster: 'p2' }] }), app({ prod: [{ cluster: 'p1' }] })],
    ENVS,
  );
  assert.deepEqual(out.prod.map((c) => c.cluster), ['p1', 'p2']);
  assert.deepEqual(out.dev, [], 'veride hic dev yoksa kume BOS - uydurulmaz');
});

test('cluster basina uygulama sayisi - cok kullanilan once', () => {
  const out = envClustersFromApps(
    [
      app({ prod: [{ cluster: 'az' }, { cluster: 'cok' }] }),
      app({ prod: [{ cluster: 'cok' }] }),
      app({ prod: [{ cluster: 'cok' }] }),
    ],
    ENVS,
  );
  assert.deepEqual(out.prod, [
    { cluster: 'cok', apps: 3 },
    { cluster: 'az', apps: 1 },
  ]);
});

test('AYNI cluster"da birden fazla namespace: uygulama BIR kez sayilir', () => {
  // Aksi halde tek uygulamanin iki namespace"i cluster"i iki uygulama gibi gosterirdi.
  const out = envClustersFromApps(
    [app({ prod: [{ cluster: 'p1' }, { cluster: 'p1' }, { cluster: 'p1' }] })],
    ENVS,
  );
  assert.deepEqual(out.prod, [{ cluster: 'p1', apps: 1 }]);
});

test('ortamlar birbirine karismaz', () => {
  const out = envClustersFromApps(
    [app({ prod: [{ cluster: 'ortak' }], test: [{ cluster: 'ortak' }, { cluster: 'yalniz-test' }] })],
    ENVS,
  );
  // AYNI cluster iki ortamda da gorunebilir - bu NORMALDIR, ocp-platforms.cjs'te
  // belgelenen gercek durum budur.
  assert.deepEqual(out.prod.map((c) => c.cluster), ['ortak']);
  assert.deepEqual(out.test.map((c) => c.cluster), ['ortak', 'yalniz-test']);
});

test('ilgilenilmeyen ortam sessizce ATILIR (cokme yok)', () => {
  const out = envClustersFromApps([app({ sandbox: [{ cluster: 'x' }] })], ENVS);
  for (const e of ENVS) assert.deepEqual(out[e], []);
  assert.ok(!('sandbox' in out));
});

test('bozuk/eksik kayitlar cokertmez', () => {
  const out = envClustersFromApps(
    [
      app({ prod: [{ cluster: '' }, { cluster: null }, { cluster: 'gecerli' }] }),
      app(null),
      null,
    ],
    ENVS,
  );
  assert.deepEqual(out.prod, [{ cluster: 'gecerli', apps: 1 }], 'bos cluster adi sayilmaz');
});

test('bos girdi bos kume dondurur', () => {
  const out = envClustersFromApps([], ENVS);
  for (const e of ENVS) assert.deepEqual(out[e], []);
  assert.deepEqual(envClustersFromApps(undefined, ENVS).prod, []);
});

test('DR gibi az uygulamali cluster GIZLENMEZ - gorunur kalir', () => {
  // Kismi kapsam bir HUKUM degil GOZLEMDIR: DR cluster"inda bir uygulamanin olmamasi
  // mesru olabilir. Bu yuzden az uygulamali cluster kumeden ATILMAZ; sayisiyla
  // birlikte gosterilir ki kullanici kendisi yorumlasin.
  const out = envClustersFromApps(
    [
      app({ prod: [{ cluster: 'ana1' }, { cluster: 'ana2' }, { cluster: 'dr' }] }),
      app({ prod: [{ cluster: 'ana1' }, { cluster: 'ana2' }] }),
      app({ prod: [{ cluster: 'ana1' }, { cluster: 'ana2' }] }),
    ],
    ENVS,
  );
  const dr = out.prod.find((c) => c.cluster === 'dr');
  assert.ok(dr, 'az uygulamali cluster kumede DURMALI');
  assert.equal(dr.apps, 1);
  assert.equal(out.prod.length, 3, 'n = 3, yani cogu uygulama 2/3 gorunecek');
});
