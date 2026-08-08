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

// extra_vars v2 sozlesmesi (OCP dinamik yapi). Playbook'a HER ZAMAN uc alan birden gider:
//   terminal_host  : legacy SKALER (= terminal_hosts[0]) — eski playbook surumleriyle uyum
//   terminal_hosts : benzersiz + sirali bastion listesi (deterministik payload)
//   ocp_clusters[] : { env, tenant, cluster_name, terminal_host } — cluster-BASINA bastion
// Tek bastion'li kurulumda uretilen payload, eski payload'in ustkumesidir; playbook
// per-cluster alanlari yoksayarsa davranis birebir eskisi gibi kalir.
// Saf fonksiyon — DB'ye dokunmaz, dogrudan test edilir.
function buildOcpExtraVars({ env, tenant, clusters, hosts }) {
  const items = clusters.map((name) => ({
    env, tenant, cluster_name: name, terminal_host: hosts[name],
  }));
  const terminalHosts = [...new Set(items.map((i) => i.terminal_host))].sort();
  return { terminal_host: terminalHosts[0], terminal_hosts: terminalHosts, ocp_clusters: items };
}

// Secilen cluster'lar icin bastion'lari cozer; eksik varsa anlasilir 400 firlatir.
// Cagiran her yerde (select + her job launch'i) TEKRAR calisir: admin verisi degismis
// olabilir, client'in gonderdigi input_json'a asla guvenilmez.
async function resolveHostsOrThrow(env, tenant, clusters) {
  const { hosts, missing } = await adminData.resolveTerminalHosts(env, tenant, clusters);
  if (missing.length) {
    throw Object.assign(
      new Error(
        `Şu cluster'lar için Jump Server (bastion) tanımlı değil: ${missing.join(', ')} — ` +
        `Admin > LogX Yapılandırma ekranından cluster satırına Jump Server girin ` +
        `veya "${tenant}/${env}" için yedek eşleme tanımlayın.`
      ),
      { status: 400 }
    );
  }
  return hosts;
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
  const hosts = await resolveHostsOrThrow(env, tenant, clusters);
  // `terminalHost` (tekil) yalnizca geriye donuk uyum icin saklanir: bu alani okuyan eski
  // istek satirlari ve UI hala calissin diye. Gercek kaynak her launch'ta taze cozulur.
  const terminalHost = [...new Set(Object.values(hosts))].sort()[0];

  await requests.updateRequest(requestRow.request_id, {
    state: 'draft',
    input: { env, tenant, clusters, terminalHost, clusterHosts: hosts },
  });
  return { terminalHost, clusterHosts: hosts };
}

// POST /ocp/:requestId/namespaces/discover
async function discoverNamespaces(requestRow) {
  const input = requestRow.input_json ? JSON.parse(requestRow.input_json) : null;
  if (!Array.isArray(input?.clusters) || !input.clusters.length) {
    throw Object.assign(new Error('Önce cluster seçimi tamamlanmalı.'), { status: 400 });
  }
  const hosts = await resolveHostsOrThrow(input.env, input.tenant, input.clusters);
  const job = await jobs.launchJob(
    requestRow.request_id,
    'ocp_namespace_discovery',
    buildOcpExtraVars({ env: input.env, tenant: input.tenant, clusters: input.clusters, hosts })
  );
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
  if (!Array.isArray(input?.clusters) || !input.clusters.length) {
    throw Object.assign(new Error('Önce cluster seçimi tamamlanmalı.'), { status: 400 });
  }
  const ns = String(namespace || '').trim();
  const app = String(appName || '').trim();
  if (!ns || !app) {
    throw Object.assign(new Error('namespace ve appName zorunlu.'), { status: 400 });
  }
  // Bastion'lar client input'undan degil, taze bir DB sorgusuyla yeniden cozulur
  // (client'in gonderdigi input_json'a degil, admin verisine guveniriz).
  const hosts = await resolveHostsOrThrow(input.env, input.tenant, input.clusters);

  const archiveName = `${require('crypto').randomBytes(16).toString('hex')}.zip`;
  // A4 fetch-back: terminal/kaynak host NFS'e yazamazsa arsivi bu URL'ye push edebilir.
  const ingestInfo = await require('./ingest.cjs')
    .issueIngestToken({ requestId: requestRow.request_id, filename: archiveName })
    .catch(() => null);
  const job = await jobs.launchJob(requestRow.request_id, 'ocp_discover_fetch', {
    ...buildOcpExtraVars({ env: input.env, tenant: input.tenant, clusters: input.clusters, hosts }),
    namespace: ns,
    app_name: app,
    staging_dir: process.env.LOGX_V2_STAGING_OCP_DIR || '/sw/BMW_PORTAL/logs/ocp',
    fallback_dir: require('./downloads.cjs').fallbackStagingDir(),
    archive_name: archiveName,
    ...(ingestInfo ? { ingest_url: ingestInfo.url } : {}),
  });

  await requests.updateRequest(requestRow.request_id, {
    state: 'transferring',
    input: { ...input, namespace: ns, appName: app },
  });
  return job;
}

module.exports = {
  getClusterTree, selectClusters, discoverNamespaces, finalizeNamespaceDiscovery, discoverFetch,
  buildOcpExtraVars,
};
