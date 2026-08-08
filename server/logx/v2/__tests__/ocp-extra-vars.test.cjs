// server/logx/v2/__tests__/ocp-extra-vars.test.cjs — extra_vars v2 sozlesmesi.
// En kritik test: TEK bastion'da uretilen payload, cok-bastion ozelliginden ONCEKI
// payload'in ustkumesi olmali (golden test) — playbook eski surumde kalsa bile
// davranis birebir aynidir.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildOcpExtraVars } = require('../ocp.cjs');

test('buildOcpExtraVars(): tek bastion — eski payload birebir korunur (golden)', () => {
  const vars = buildOcpExtraVars({
    env: 'lab', tenant: 'ark',
    clusters: ['c1', 'c2'],
    hosts: { c1: 'GBAOCP01', c2: 'GBAOCP01' },
  });

  // Eski sozlesme: skaler terminal_host + cluster basina oge.
  assert.equal(vars.terminal_host, 'GBAOCP01');
  assert.deepEqual(vars.ocp_clusters.map((c) => ({ env: c.env, tenant: c.tenant, cluster_name: c.cluster_name })), [
    { env: 'lab', tenant: 'ark', cluster_name: 'c1' },
    { env: 'lab', tenant: 'ark', cluster_name: 'c2' },
  ]);
  // Yeni alanlar ustkume olarak eklenir.
  assert.deepEqual(vars.terminal_hosts, ['GBAOCP01']);
  assert.equal(vars.ocp_clusters[0].terminal_host, 'GBAOCP01');
});

test('buildOcpExtraVars(): cok bastion — her cluster kendi bastion bilgisini tasir', () => {
  const vars = buildOcpExtraVars({
    env: 'dev', tenant: 'ark',
    clusters: ['c1', 'c2', 'c3'],
    hosts: { c1: 'jump02', c2: 'jump01', c3: 'jump02' },
  });

  assert.deepEqual(vars.ocp_clusters, [
    { env: 'dev', tenant: 'ark', cluster_name: 'c1', terminal_host: 'jump02' },
    { env: 'dev', tenant: 'ark', cluster_name: 'c2', terminal_host: 'jump01' },
    { env: 'dev', tenant: 'ark', cluster_name: 'c3', terminal_host: 'jump02' },
  ]);
});

test('buildOcpExtraVars(): terminal_hosts benzersiz + sirali, skaler = ilk oge (deterministik)', () => {
  const vars = buildOcpExtraVars({
    env: 'dev', tenant: 'ark',
    clusters: ['c1', 'c2', 'c3'],
    hosts: { c1: 'jump05', c2: 'jump01', c3: 'jump05' },
  });

  assert.deepEqual(vars.terminal_hosts, ['jump01', 'jump05']);
  assert.equal(vars.terminal_host, 'jump01', 'skaler alan her zaman terminal_hosts[0] olmali');

  // Ayni girdi, farkli cluster sirasi → ayni bastion listesi (siralama girdiye bagli degil).
  const other = buildOcpExtraVars({
    env: 'dev', tenant: 'ark',
    clusters: ['c3', 'c2', 'c1'],
    hosts: { c1: 'jump05', c2: 'jump01', c3: 'jump05' },
  });
  assert.deepEqual(other.terminal_hosts, vars.terminal_hosts);
  assert.equal(other.terminal_host, vars.terminal_host);
});

test('buildOcpExtraVars(): tek cluster — payload minimal ve tutarli', () => {
  const vars = buildOcpExtraVars({ env: 'lab', tenant: 'ark', clusters: ['solo'], hosts: { solo: 'gbaocp01' } });
  assert.deepEqual(vars, {
    terminal_host: 'gbaocp01',
    terminal_hosts: ['gbaocp01'],
    ocp_clusters: [{ env: 'lab', tenant: 'ark', cluster_name: 'solo', terminal_host: 'gbaocp01' }],
  });
});
