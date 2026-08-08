// server/opsx/__tests__/ocp-target.test.cjs — OpsX/Telnet ortak OpenShift hedef uretimi.
// EN KRITIK TEST: varsayilan 'joined' modun ciktisi, bu degisiklikten ONCEKI OpsX
// payload'i ile BIREBIR ayni olmali (harici playbook'lar kirilmasin).
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const adminData = require('../../logx/v2/admin.cjs');
const { buildOcpTarget } = require('../ocp-target.cjs');

const CFG = {
  terminalHostKey: 'terminal_host',
  terminalHostsKey: 'terminal_hosts',
  namespaceKey: 'namespace',
  appNameKey: 'app_name',
  clustersKey: 'ocp_clusters',
  separator: ',',
  clusterListStyle: 'joined',
};

// getClusterTree + resolveTerminalHosts mock'lanir (DB'ye gidilmez).
function mockAdmin(t, { tree, hosts, missing = [] }) {
  t.mock.method(adminData, 'getClusterTree', async () => tree);
  t.mock.method(adminData, 'resolveTerminalHosts', async () => ({ hosts, missing }));
}

const TREE = { qa: { ark: ['gbocpqa1', 'gbocpqa2'] } };

test("joined (varsayilan): cikti eski payload ile birebir ayni", async (t) => {
  mockAdmin(t, { tree: TREE, hosts: { gbocpqa1: 'GBAOCP01', gbocpqa2: 'GBAOCP01' } });
  const { extraVars } = await buildOcpTarget({
    env: 'qa', tenant: 'ark', clusters: ['gbocpqa1', 'gbocpqa2'],
    namespace: 'ns1', appName: 'app1', cfg: CFG,
  });

  assert.deepEqual(extraVars, {
    terminal_host: 'GBAOCP01',
    namespace: 'ns1',
    app_name: 'app1',
    ocp_clusters: [{ env: 'qa', tenant: 'ark', cluster_name: 'gbocpqa1,gbocpqa2' }],
  });
  assert.ok(!('terminal_hosts' in extraVars), 'joined modda liste alani GONDERILMEZ');
});

test('joined: secilen cluster\'lar farkli bastion\'lara duserse 400 ile reddedilir', async (t) => {
  mockAdmin(t, { tree: TREE, hosts: { gbocpqa1: 'jump01', gbocpqa2: 'jump02' } });
  await assert.rejects(
    () => buildOcpTarget({
      env: 'qa', tenant: 'ark', clusters: ['gbocpqa1', 'gbocpqa2'],
      namespace: 'ns1', appName: 'app1', cfg: CFG,
    }),
    (err) => {
      assert.equal(err.status, 400);
      assert.match(err.message, /jump01, jump02/);
      assert.match(err.message, /Cluster başına/, 'admin\'e cozum yolu soylenmeli');
      return true;
    }
  );
});

test('perCluster: her cluster kendi bastion\'i ile gonderilir + terminal_hosts listesi', async (t) => {
  mockAdmin(t, { tree: TREE, hosts: { gbocpqa1: 'jump02', gbocpqa2: 'jump01' } });
  const { extraVars } = await buildOcpTarget({
    env: 'qa', tenant: 'ark', clusters: ['gbocpqa1', 'gbocpqa2'],
    namespace: 'ns1', appName: 'app1', cfg: { ...CFG, clusterListStyle: 'perCluster' },
  });

  assert.equal(extraVars.terminal_host, 'jump01', 'skaler alan sirali listenin ilki');
  assert.deepEqual(extraVars.terminal_hosts, ['jump01', 'jump02']);
  assert.deepEqual(extraVars.ocp_clusters, [
    { env: 'qa', tenant: 'ark', cluster_name: 'gbocpqa1', terminal_host: 'jump02' },
    { env: 'qa', tenant: 'ark', cluster_name: 'gbocpqa2', terminal_host: 'jump01' },
  ]);
});

test('bastion cozulemeyen cluster varsa 400 + eksik cluster adlari mesajda', async (t) => {
  mockAdmin(t, { tree: TREE, hosts: { gbocpqa1: 'jump01' }, missing: ['gbocpqa2'] });
  await assert.rejects(
    () => buildOcpTarget({
      env: 'qa', tenant: 'ark', clusters: ['gbocpqa1', 'gbocpqa2'],
      namespace: 'ns1', appName: 'app1', cfg: CFG,
    }),
    (err) => { assert.equal(err.status, 400); assert.match(err.message, /gbocpqa2/); return true; }
  );
});

test('katalogda olmayan cluster reddedilir (client girdisine guvenilmez)', async (t) => {
  mockAdmin(t, { tree: TREE, hosts: {} });
  await assert.rejects(
    () => buildOcpTarget({
      env: 'qa', tenant: 'ark', clusters: ['uydurma'],
      namespace: 'ns1', appName: 'app1', cfg: CFG,
    }),
    (err) => { assert.equal(err.status, 400); assert.match(err.message, /uydurma/); return true; }
  );
});

test('Telnet kullanimi: appName gecilmezse app_name alani HIC eklenmez, staticVars korunur', async (t) => {
  mockAdmin(t, { tree: TREE, hosts: { gbocpqa1: 'GBAOCP01' } });
  const { extraVars } = await buildOcpTarget({
    env: 'qa', tenant: 'ark', clusters: ['gbocpqa1'],
    namespace: 'ns1', cfg: CFG, staticVars: { ip: '10.0.0.1', port: '8080' },
  });

  assert.deepEqual(extraVars, {
    ip: '10.0.0.1',
    port: '8080',
    terminal_host: 'GBAOCP01',
    namespace: 'ns1',
    ocp_clusters: [{ env: 'qa', tenant: 'ark', cluster_name: 'gbocpqa1' }],
  });
});

test('tekrarli cluster secimi tekillestirilir', async (t) => {
  mockAdmin(t, { tree: TREE, hosts: { gbocpqa1: 'GBAOCP01' } });
  const { extraVars, requested } = await buildOcpTarget({
    env: 'qa', tenant: 'ark', clusters: ['gbocpqa1', ' gbocpqa1 ', ''],
    namespace: 'ns1', appName: 'a', cfg: CFG,
  });
  assert.deepEqual(requested, ['gbocpqa1']);
  assert.equal(extraVars.ocp_clusters[0].cluster_name, 'gbocpqa1');
});
