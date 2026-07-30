// server/logx/v2/ocp.cjs — OpenShift akisi: cluster/tenant/env secimi (admin-yonetimli
// ocp_cluster_index'e karsi dogrulanir), namespace iki-asamali cozumleme, pod kesfi+log
// cekme. Cluster URL/credential bu dosyada veya DB'de HICBIR ZAMAN tutulmaz — playbook
// bunlari kendi (bu repo disindaki) vault verisinden cozer; biz yalnizca
// env/tenant/cluster_name/namespace/app_name gibi tanimlayicilari extra_vars olarak geceriz.
'use strict';

const jobs = require('./jobs.cjs');
const requests = require('./requests.cjs');
const adminData = require('./admin.cjs');

async function getClusterTree() {
  return adminData.getClusterTree();
}

// POST /ocp/:requestId/select — { env, tenant, clusters: [name,...] }
async function selectClusters(requestRow, env, tenant, clusters) {
  if (!env || !tenant || !Array.isArray(clusters) || clusters.length === 0) {
    throw Object.assign(new Error('env, tenant ve en az bir cluster gerekli.'), { status: 400 });
  }
  for (const clusterName of clusters) {
    const exists = await adminData.clusterExists(env, tenant, clusterName);
    if (!exists) {
      throw Object.assign(new Error(`Cluster tanımlı/aktif değil: ${clusterName}`), { status: 400 });
    }
  }
  const terminalHost = await adminData.getTerminalHost(tenant, env);
  if (!terminalHost) {
    throw Object.assign(
      new Error(`"${tenant}/${env}" için terminal/bastion host tanımlı değil — admin panelinden eklenmeli.`),
      { status: 400 }
    );
  }

  await requests.updateRequest(requestRow.request_id, {
    state: 'draft',
    input: { env, tenant, clusters, terminalHost },
  });
  return { terminalHost };
}

// POST /ocp/:requestId/namespaces/discover
async function discoverNamespaces(requestRow) {
  const input = requestRow.input_json ? JSON.parse(requestRow.input_json) : null;
  if (!input?.terminalHost || !Array.isArray(input?.clusters)) {
    throw Object.assign(new Error('Önce cluster seçimi tamamlanmalı.'), { status: 400 });
  }
  const job = await jobs.launchJob(requestRow.request_id, 'ocp_namespace_discovery', {
    terminal_host: input.terminalHost,
    ocp_clusters: input.clusters.map((name) => ({ env: input.env, tenant: input.tenant, cluster_name: name })),
  });
  await requests.updateRequest(requestRow.request_id, { state: 'namespace_discovering' });
  return job;
}

// `oc get projects -o name` ciktisi ortama gore `project/<ad>` VEYA
// `project.project.openshift.io/<ad>` oneki tasir (API-group'lu tam ad). Namespace ADI
// her zaman son `/`'ten SONRASIDIR — oneki ne olursa olsun guvenle siyiririz. Boslari
// atip tekillestiririz. (Playbook'u degistirmeden portal tarafinda normalize — kuruma
// ozgu playbook'a dokunmadan temiz gorunum + dogru `-n <namespace>` degeri.)
function cleanNamespaceName(ns) {
  return String(ns == null ? '' : ns).replace(/^.*\//, '').trim();
}

function normalizeDiscoveryResult(artifacts) {
  if (!artifacts || !Array.isArray(artifacts.clusters)) return artifacts;
  const clusters = artifacts.clusters.map((c) => {
    const cleaned = (c.namespaces || []).map(cleanNamespaceName).filter(Boolean);
    return { ...c, namespaces: [...new Set(cleaned)].sort() };
  });
  return { ...artifacts, clusters };
}

async function finalizeNamespaceDiscovery(requestRow, job) {
  if (!job.artifacts) {
    await requests.updateRequest(requestRow.request_id, { state: 'failed', errorMessage: job.errorMessage || 'Namespace keşfi başarısız oldu.' });
    return;
  }
  await requests.updateRequest(requestRow.request_id, {
    state: 'namespaces_discovered',
    discoveryResult: normalizeDiscoveryResult(job.artifacts),
  });
}

// POST /ocp/:requestId/discover-fetch — { namespace, appName }. Pod adi hicbir zaman
// client'tan gelmez — playbook kendi `oc get pods` ciktisindan bulur.
async function discoverFetch(requestRow, namespace, appName) {
  const input = requestRow.input_json ? JSON.parse(requestRow.input_json) : null;
  if (!input?.terminalHost || !Array.isArray(input?.clusters)) {
    throw Object.assign(new Error('Önce cluster seçimi tamamlanmalı.'), { status: 400 });
  }
  const ns = String(namespace || '').trim();
  const app = String(appName || '').trim();
  if (!ns || !app) {
    throw Object.assign(new Error('namespace ve appName zorunlu.'), { status: 400 });
  }
  // Terminal host'u client input'undan degil, taze bir DB sorgusuyla yeniden dogrular
  // (client'in gonderdigi input_json'a degil, admin verisine guveniriz).
  const terminalHost = await adminData.getTerminalHost(input.tenant, input.env);
  if (!terminalHost) {
    throw Object.assign(new Error('Terminal host artık tanımlı değil.'), { status: 400 });
  }

  const archiveName = `${require('crypto').randomBytes(16).toString('hex')}.zip`;
  // A4 fetch-back: terminal/kaynak host NFS'e yazamazsa arsivi bu URL'ye push edebilir.
  const ingestInfo = await require('./ingest.cjs')
    .issueIngestToken({ requestId: requestRow.request_id, filename: archiveName })
    .catch(() => null);
  const job = await jobs.launchJob(requestRow.request_id, 'ocp_discover_fetch', {
    terminal_host: terminalHost,
    namespace: ns,
    app_name: app,
    ocp_clusters: input.clusters.map((name) => ({ env: input.env, tenant: input.tenant, cluster_name: name })),
    staging_dir: process.env.LOGX_V2_STAGING_OCP_DIR || '/sw/BMW_PORTAL/logs/ocp',
    fallback_dir: process.env.LOGX_STAGING_FALLBACK_DIR || '/tmp/logx-v2-fallback',
    archive_name: archiveName,
    ...(ingestInfo ? { ingest_url: ingestInfo.url } : {}),
  });

  await requests.updateRequest(requestRow.request_id, {
    state: 'transferring',
    input: { ...input, namespace: ns, appName: app },
  });
  return job;
}

module.exports = { getClusterTree, selectClusters, discoverNamespaces, finalizeNamespaceDiscovery, discoverFetch };
