// server/audit/__tests__/route-stats.test.cjs - ortam basina route / SPA / IP istatistigi.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildRouteStats } = require('../route-stats.cjs');

const R = (ns, route, addr, ip, tt = 'passthrough', cluster = 'ark-prod-1') => ({
  namespace_name: ns, route_name: route, route_address: addr, resolved_ip: ip, termination_type: tt, cluster_name: cluster,
});
const A = '.apps.fw.garanti.com.tr';

test('ortam namespace son ekinden; SPA/SPA-disi ayrimi; IP kovalari; cozulmeyen IP ve ortam ayri sayilir', () => {
  const out = buildRouteStats([
    R('glomo-prod', 'x-app-v1', 'x-app-v1-glomo-prod' + A, '10.1.1.1'),
    R('glomo-prod', 'y-app-emb-v2', 'y-app-emb-v2-glomo-prod' + A, '10.1.1.1'),
    R('glomo-prod', 'glomo-api', 'glomo-api-glomo-prod' + A, '10.1.1.2', 'reencrypt'),
    // adres kaliba uymuyor (elle verilmis) -> route ADI: SPA
    R('glomo-prod', 'z-app-v3', 'ozel-adres.garanti.com.tr', '', 'edge'),
    R('glomo-test', 'x-app-v1', 'x-app-v1-glomo-test' + A, '10.2.2.2', 'passthrough', 'ark-test-1'),
    // ortam cozulemez
    R('sandbox', 'x-app-v1', 'x' + A, '10.9.9.9'),
    // hem adres hem ad bos -> siniflandirilamadi
    R('glomo-prod', '', '', '10.1.1.3'),
  ]);
  assert.deepEqual(out.envs.map((e) => e.env), ['TEST', 'PROD']);
  const prod = out.envs.find((e) => e.env === 'PROD');
  assert.equal(prod.routes, 5);
  assert.equal(prod.spa, 3);
  assert.equal(prod.nonSpa, 1);
  assert.equal(prod.unclassified, 1);
  assert.deepEqual(prod.spaIps, [{ ip: '10.1.1.1', count: 2, samples: ['glomo-prod/x-app-v1', 'glomo-prod/y-app-emb-v2'] }]);
  assert.deepEqual(prod.nonSpaIps, [{ ip: '10.1.1.2', count: 1, samples: ['glomo-prod/glomo-api'] }]);
  assert.deepEqual(prod.unresolvedIp, { spa: 1, nonSpa: 0 });
  assert.deepEqual(prod.terminations.map((t) => t.type), ['passthrough', 'reencrypt', 'edge']);
  assert.deepEqual(prod.clusters, ['ark-prod-1']);
  assert.equal(out.totals.noEnv, 1);
  assert.equal(out.totals.routes, 6);
});
