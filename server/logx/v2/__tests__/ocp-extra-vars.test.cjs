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

// ── v3: cluster metadata'si (api_url + vault anahtari) extra_vars'a ────────────
// AMAC: playbook AWX'teki openshift_inventory_vars.yaml'a bagimli olmasin. Alanlar BOSSA
// hic gonderilmez → playbook eski inventory yoluna duser (asamali gecis guvencesi).

test('buildOcpExtraVars(): meta verilmezse cikti v2 ile BIREBIR ayni (regresyon)', () => {
  const v2 = buildOcpExtraVars({ env: 'lab', tenant: 'ark', clusters: ['c1'], hosts: { c1: 'b1' } });
  assert.deepEqual(v2.ocp_clusters, [{ env: 'lab', tenant: 'ark', cluster_name: 'c1', terminal_host: 'b1' }]);
  assert.ok(!('api_url' in v2.ocp_clusters[0]), 'meta yokken api_url anahtari OLMAMALI');
  assert.ok(!('credential_key' in v2.ocp_clusters[0]));
});

test('buildOcpExtraVars(): meta doluysa api_url + credential_key tasinir', () => {
  const vars = buildOcpExtraVars({
    env: 'prod', tenant: 'ark', clusters: ['gbocpprod1'], hosts: { gbocpprod1: 'gbarkp51' },
    meta: { gbocpprod1: { api_url: 'https://api.gbocpprod1.fw.garanti.com.tr:6443', vault_credential_key: 'uxmid_gar' } },
  });
  assert.deepEqual(vars.ocp_clusters[0], {
    env: 'prod', tenant: 'ark', cluster_name: 'gbocpprod1', terminal_host: 'gbarkp51',
    api_url: 'https://api.gbocpprod1.fw.garanti.com.tr:6443',
    credential_key: 'uxmid_gar',
  });
});

test('buildOcpExtraVars(): PAROLA hicbir kosulda payload\'a girmez', () => {
  const vars = buildOcpExtraVars({
    env: 'prod', tenant: 'ark', clusters: ['c1'], hosts: { c1: 'b1' },
    meta: { c1: { api_url: 'https://api.x:6443', vault_credential_key: 'uxmid_gar', password: 'GIZLI' } },
  });
  const json = JSON.stringify(vars);
  assert.ok(!json.includes('GIZLI'), 'meta icinde parola gelse bile payload\'a KOPYALANMAMALI');
  assert.ok(!json.includes('password'), 'password anahtari hic olmamali');
});

test('buildOcpExtraVars(): kismi meta — yalniz dolu alan gonderilir', () => {
  const vars = buildOcpExtraVars({
    env: 'qa', tenant: 'ark', clusters: ['a', 'b'], hosts: { a: 'b1', b: 'b1' },
    meta: { a: { api_url: 'https://api.a:6443', vault_credential_key: null }, b: {} },
  });
  assert.equal(vars.ocp_clusters[0].api_url, 'https://api.a:6443');
  assert.ok(!('credential_key' in vars.ocp_clusters[0]), 'bos anahtar gonderilmemeli');
  assert.ok(!('api_url' in vars.ocp_clusters[1]), 'metasi olmayan cluster eski yola duser');
});
