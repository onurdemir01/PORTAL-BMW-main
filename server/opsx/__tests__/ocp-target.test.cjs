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

// Bu test resolveTerminalHosts'u MOCK'LAMAZ — gercek cozumleme yolunu (cluster kolonu >
// tenant/env yedegi) db.query seviyesinden dogrular. Diger testler yalnizca payload
// SEKLINI koruyor; burada host DEGERININ dogru secildigini garanti ediyoruz.
test('gercek cozumleme: cluster kolonu doluysa OpsX de tenant/env yedegi yerine onu kullanir', async (t) => {
  const db = require('../../db/index.cjs');
  t.mock.method(adminData, 'getClusterTree', async () => TREE);
  t.mock.method(db, 'query', async (sql) => {
    if (/FROM ocp_cluster_index/i.test(sql)) {
      return { rows: [
        { cluster_name: 'gbocpqa1', terminal_host: 'jumpA' },   // kolon dolu
        { cluster_name: 'gbocpqa2', terminal_host: null },      // kolon bos → yedege duser
      ] };
    }
    if (/FROM ocp_terminal_host_map/i.test(sql)) return { rows: [{ terminal_host: 'yedekHost' }] };
    throw new Error(`beklenmeyen sorgu: ${sql}`);
  });

  // Tek cluster: kolon degeri kazanmali (eskiden her zaman 'yedekHost' giderdi).
  const one = await buildOcpTarget({
    env: 'qa', tenant: 'ark', clusters: ['gbocpqa1'], namespace: 'ns', appName: 'a', cfg: CFG,
  });
  assert.equal(one.extraVars.terminal_host, 'jumpA');

  // Kolonu bos olan cluster yedegi kullanir.
  const two = await buildOcpTarget({
    env: 'qa', tenant: 'ark', clusters: ['gbocpqa2'], namespace: 'ns', appName: 'a', cfg: CFG,
  });
  assert.equal(two.extraVars.terminal_host, 'yedekHost');

  // Ikisi birlikte farkli host'a dustugu icin joined modda ACIK hata verilir
  // (sessizce yanlis sunucuda islem calistirmak yerine).
  await assert.rejects(
    () => buildOcpTarget({
      env: 'qa', tenant: 'ark', clusters: ['gbocpqa1', 'gbocpqa2'], namespace: 'ns', appName: 'a', cfg: CFG,
    }),
    (err) => { assert.equal(err.status, 400); assert.match(err.message, /jumpA|yedekHost/); return true; }
  );
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

// ── 'portal' playbook modu — Faz B ───────────────────────────────────────────
// Portal modunda OpsX, LogX OCP playbook'lariyla AYNI sozlesmeyi kullanir: cluster
// basina bastion + portaldan gelen api_url/credential_key/username. Bu testler iki
// modulun payload'inin AYRISMADIGINI kilitler.

const PORTAL_CFG = {
  ...CFG,
  playbookMode: 'portal',
  operationKey: 'operation',
  objectKindKey: 'object_kind',
  podNameKey: 'pod_name',
  replicasKey: 'replicas',
};

function withCatalog(fn, { meta = {} } = {}) {
  const origTree = adminData.getClusterTree;
  const origHosts = adminData.resolveTerminalHosts;
  const origMeta = adminData.resolveClusterMeta;
  adminData.getClusterTree = async () => ({ prod: { ark: ['gbocpprod2', 'gbocpprod4'] } });
  adminData.resolveTerminalHosts = async (e, t, names) => ({
    hosts: Object.fromEntries(names.map((n) => [n, n === 'gbocpprod4' ? 'GBARKP54' : 'GBARKP52'])),
    missing: [],
  });
  adminData.resolveClusterMeta = async () => meta;
  return Promise.resolve(fn()).finally(() => {
    adminData.getClusterTree = origTree;
    adminData.resolveTerminalHosts = origHosts;
    adminData.resolveClusterMeta = origMeta;
  });
}

const META = {
  gbocpprod2: { api_url: 'https://api.gbocpprod2.fw.garanti.com.tr:6443', vault_credential_key: 'uxmid_gar', ocp_username: 'uxmid' },
  gbocpprod4: { api_url: 'https://api.gbocpprod4.fw.garanti.com.tr:6443', vault_credential_key: 'uxmid_gar', ocp_username: 'uxmid' },
};

test('portal modu: her cluster kendi bastion + api_url + credential_key + username ile gider', async () => {
  await withCatalog(async () => {
    const { extraVars } = await buildOcpTarget({
      env: 'prod', tenant: 'ark', clusters: ['gbocpprod2', 'gbocpprod4'],
      namespace: 'reference-applications-prod', appName: 'parallel-composition-v3',
      cfg: PORTAL_CFG, operation: 'restart',
    });
    assert.equal(extraVars.ocp_clusters.length, 2);
    for (const c of extraVars.ocp_clusters) {
      assert.ok(c.terminal_host, 'her cluster kendi bastion bilgisini tasimali');
      assert.ok(c.api_url, 'api_url portaldan gelmeli');
      assert.equal(c.credential_key, 'uxmid_gar');
      assert.equal(c.username, 'uxmid', "2026-08-09 arizasi: username eksikse tum cluster'lar duser");
    }
    assert.deepEqual(extraVars.terminal_hosts, ['GBARKP52', 'GBARKP54']);
  }, { meta: META });
});

test('portal modu: operation + rezerve-ad kacinmasi (oc_namespace_input) gonderilir', async () => {
  await withCatalog(async () => {
    const { extraVars } = await buildOcpTarget({
      env: 'prod', tenant: 'ark', clusters: ['gbocpprod2'],
      namespace: 'ns1', appName: 'app1', cfg: PORTAL_CFG,
      operation: 'podrestart', objectKind: 'Deployment', podName: 'app1-abc', replicas: 3,
    });
    assert.equal(extraVars.operation, 'podrestart');
    assert.equal(extraVars.object_kind, 'Deployment');
    assert.equal(extraVars.pod_name, 'app1-abc');
    assert.equal(extraVars.replicas, 3);
    // `namespace` Ansible'da REZERVE ad — playbook once bunu okur.
    assert.equal(extraVars.oc_namespace_input, 'ns1');
    assert.equal(extraVars.namespace, 'ns1', 'eski ad geriye uyum icin durmali');
  }, { meta: META });
});

test('portal modu: PAROLA payload\'a HICBIR kosulda girmez', async () => {
  await withCatalog(async () => {
    const { extraVars } = await buildOcpTarget({
      env: 'prod', tenant: 'ark', clusters: ['gbocpprod2'],
      namespace: 'ns1', appName: 'app1', cfg: PORTAL_CFG, operation: 'restart',
    });
    const json = JSON.stringify(extraVars);
    assert.ok(!json.includes('GIZLI'));
    assert.ok(!/"password"/.test(json), 'password anahtari hic olmamali');
  }, { meta: { gbocpprod2: { ...META.gbocpprod2, password: 'GIZLI' } } });
});

test('portal modu: clusterListStyle joined OLSA BILE cluster-basina gonderilir', async () => {
  // Yanlis yapilandirilmis bir blob yuzunden portal playbook'una BIRLESIK cluster adi
  // gitmemeli — playbook onu cozemez ve is sessizce yanlis hedefe gider.
  await withCatalog(async () => {
    const { extraVars } = await buildOcpTarget({
      env: 'prod', tenant: 'ark', clusters: ['gbocpprod2', 'gbocpprod4'],
      namespace: 'ns1', appName: 'app1',
      cfg: { ...PORTAL_CFG, clusterListStyle: 'joined' }, operation: 'restart',
    });
    assert.equal(extraVars.ocp_clusters.length, 2, 'birlesik ada indirgenmemeli');
    assert.ok(!extraVars.ocp_clusters.some((c) => c.cluster_name.includes(',')));
  }, { meta: META });
});

test('external mod: portal alanlarinin HICBIRI govdeye girmez (regresyon)', async () => {
  await withCatalog(async () => {
    const { extraVars } = await buildOcpTarget({
      env: 'prod', tenant: 'ark', clusters: ['gbocpprod2'],
      namespace: 'ns1', appName: 'app1', cfg: CFG,
      operation: 'restart', objectKind: 'Deployment', podName: 'p1', replicas: 2,
    });
    for (const key of ['operation', 'object_kind', 'pod_name', 'replicas', 'oc_namespace_input', 'ocp_username']) {
      assert.ok(!(key in extraVars), `external modda '${key}' gonderilmemeli`);
    }
    // Harici playbook cluster metadata'sini de bilmiyor.
    assert.ok(!('api_url' in extraVars.ocp_clusters[0]));
  }, { meta: META });
});
