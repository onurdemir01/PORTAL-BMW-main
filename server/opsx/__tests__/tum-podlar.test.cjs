// server/opsx/__tests__/tum-podlar.test.cjs — "Tum pod'lar" (batch / job) secimi (2026-10-14).
//
// Kullanici: "OpenShift cluster'larinda bazen batch pod'lari olusuyor ve insanlar bunlari silmek
// istiyor; biz yalniz envanterdeki uygulamayi secip pod'larini getiriyoruz." Envanter yalniz
// deployment / rollout / dc tutar; batch-only namespace'te cift kurulamiyordu.
//   TP1 '*' varsayilan olarak REDDEDILIR (restart / rollout '*' ile calismaz)
//   TP2 '*' yalniz izin verilen cagride gecer; erisim kisitlamasi AYNEN uygulanir
//   TP3 izin YALNIZ pod uclarinda: pod kesfi, dump, pod silme; /api/opsx/run (restart) DEGIL
'use strict';

const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const KOK = path.join(__dirname, '..', '..');
const sahte = (rel, exports) => {
  const p = require.resolve(path.join(KOK, rel));
  require.cache[p] = { id: p, filename: p, loaded: true, exports };
};
let izinli;
beforeEach(() => {
  izinli = true;
  sahte('logx/v2/admin.cjs', { getClusterTree: async () => ({ PROD: { ark: ['gbocpprod1', 'gbocpprod2'] } }) });
  sahte('logx/v2/restrictions.cjs', { isAllowed: async () => izinli });
});
const { _resolveOpenshiftTargets: coz, TUM_PODLAR } = require('../index.cjs');

test('TP1 tum pod\'lar varsayilan olarak reddedilir', async () => {
  assert.equal(TUM_PODLAR, '*');
  await assert.rejects(
    coz('PROD', 'ark', [{ namespace: 'kart-batch-prod', application: '*' }], { username: 'u' }),
    (e) => e.status === 400 && /yalnız pod işlemlerinde/.test(e.message),
  );
  // normal uygulama etkilenmez
  const r = await coz('PROD', 'ark', [{ namespace: 'kart-prod', application: 'kart-ui' }], { username: 'u' });
  assert.equal(r.cleanPairs[0].application, 'kart-ui');
});

test('TP2 izinle gecer; erisim kisitlamasi yine uygulanir', async () => {
  const r = await coz('PROD', 'ark', [{ namespace: 'kart-batch-prod', application: '*' }], { username: 'u' }, { tumPodlarIzinli: true });
  assert.deepEqual(r.cleanPairs.map((p) => p.namespace), ['kart-batch-prod']);
  assert.deepEqual(r.clusterNames, ['gbocpprod1', 'gbocpprod2']);
  izinli = false;
  await assert.rejects(
    coz('PROD', 'ark', [{ namespace: 'kart-batch-prod', application: '*' }], { username: 'u' }, { tumPodlarIzinli: true }),
    (e) => e.status === 403,
  );
});

test('TP3 izin yalniz pod uclarinda; restart (run) ucu vermez', () => {
  const s = fs.readFileSync(path.join(__dirname, '..', 'index.cjs'), 'utf8');
  const ucBlok = (yol) => {
    const i = s.indexOf(`'${yol}'`);
    assert.ok(i > 0, yol);
    const j = s.indexOf('app.post(', i + 1);
    return s.slice(i, j > 0 ? j : undefined);
  };
  for (const yol of ['/api/opsx/ocp/pods/discover', '/api/opsx/dump/openshift', '/api/opsx/poddelete/openshift'])
    assert.match(ucBlok(yol), /resolveOpenshiftTargets\([\s\S]{0,120}\{ tumPodlarIzinli: true \}/, yol);
  assert.doesNotMatch(ucBlok('/api/opsx/run'), /tumPodlarIzinli/);
});
