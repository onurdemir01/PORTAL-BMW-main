// server/logx/v2/__tests__/ocp-runtime-config.test.cjs — OCP calisma zamani ayarlari.
// Bu ayarlar playbook'a extra_vars olarak gider ve oradan KOMUT SATIRINA dusebilir;
// bu yuzden normalize()'in gecersiz/tehlikeli girdileri elemesi kritik.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const cfg = require('../ocp-runtime-config.cjs');
const { buildOcpRuntimeVars } = require('../ocp.cjs');

test('normalize(): bos girdi varsayilanlara duser', () => {
  const c = cfg.normalize({});
  assert.equal(c.ocBinary, '');
  assert.deepEqual(c.ocBinaryCandidates, cfg.DEFAULTS.ocBinaryCandidates);
  assert.equal(c.ocAsyncTimeout, 120);
  assert.equal(c.ocLogTimeout, 300);
});

test('normalize(): mutlak olmayan / kabuk metakarakterli yollar REDDEDILIR', () => {
  const c = cfg.normalize({
    ocBinary: 'oc; rm -rf /',
    ocBinaryCandidates: ['relative/oc', '/ok/oc', '/bad/oc$(whoami)', '/tmp/oc`id`'],
  });
  assert.equal(c.ocBinary, '', 'gecersiz override bos birakilmali (kesif devreye girsin)');
  assert.deepEqual(c.ocBinaryCandidates, ['/ok/oc'], 'yalniz gecerli mutlak yol kalmali');
});

test('normalize(): aday listesi tekillestirilir ve 10 ile sinirlanir', () => {
  const many = Array.from({ length: 15 }, (_, i) => `/opt/p${i}/oc`);
  const c = cfg.normalize({ ocBinaryCandidates: ['/bin/oc', '/bin/oc', ...many] });
  assert.equal(c.ocBinaryCandidates.length, 10);
  assert.equal(c.ocBinaryCandidates[0], '/bin/oc');
  assert.equal(new Set(c.ocBinaryCandidates).size, c.ocBinaryCandidates.length);
});

test('normalize(): aday listesi tamamen gecersizse varsayilanlara doner (bos liste ASLA)', () => {
  const c = cfg.normalize({ ocBinaryCandidates: ['bad', '../x'] });
  assert.deepEqual(c.ocBinaryCandidates, cfg.DEFAULTS.ocBinaryCandidates);
});

test('normalize(): zaman asimlari 10-3600 araligina kirpilir, sayi olmayan varsayilana duser', () => {
  const c = cfg.normalize({ ocAsyncTimeout: 1, ocListTimeout: 99999, ocLogTimeout: 'abc' });
  assert.equal(c.ocAsyncTimeout, 10);
  assert.equal(c.ocListTimeout, 3600);
  assert.equal(c.ocLogTimeout, cfg.DEFAULTS.ocLogTimeout);
});

// ── extra_vars aktarimi ────────────────────────────────────────────────────────

test('buildOcpRuntimeVars(): ocBinary BOSSA oc_binary anahtari HIC gonderilmez (kesif calissin)', () => {
  const vars = buildOcpRuntimeVars(cfg.normalize({}));
  assert.ok(!('oc_binary' in vars), 'bos override playbook kesfini ezmemeli');
  assert.deepEqual(vars.oc_binary_candidates, cfg.DEFAULTS.ocBinaryCandidates);
  assert.equal(vars.oc_async_timeout, 120);
});

test('buildOcpRuntimeVars(): ocBinary DOLUYSA oc_binary gonderilir (kesfin onune gecer)', () => {
  const vars = buildOcpRuntimeVars(cfg.normalize({ ocBinary: '/bin/oc' }));
  assert.equal(vars.oc_binary, '/bin/oc');
});

test('buildOcpRuntimeVars(): bos/yok config ile cagrilirsa hicbir anahtar uretmez (guvenli)', () => {
  assert.deepEqual(buildOcpRuntimeVars(null), {});
  assert.deepEqual(buildOcpRuntimeVars({}), {});
});
