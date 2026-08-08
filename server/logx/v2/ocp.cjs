// server/logx/v2/ocp.cjs — OpenShift akisi: cluster/tenant/env secimi (admin-yonetimli
// ocp_cluster_index'e karsi dogrulanir), namespace iki-asamali cozumleme, pod kesfi+log
// cekme.
//
// CLUSTER METADATA'SI (v3): cluster'in API URL'i ve hangi vault anahtarini kullandigi
// artik portal DB'sinde (ocp_cluster_index) tutulur ve extra_vars ile gonderilir — boylece
// playbook AWX'teki openshift_inventory_vars.yaml dosyasina BAGIMLI DEGILDIR.
// PAROLA hicbir zaman DB'ye girmez: yalnizca anahtarin ADI (`vault_credential_key`)
// tasinir, parolayi playbook lookup('vars', <ad>) ile AWX vault'undan cozer.
// Alanlar bos ise extra_vars'a HIC konmaz → playbook eski inventory yoluna duser.
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
function buildOcpExtraVars({ env, tenant, clusters, hosts, meta }) {
  // Adlar resolveTerminalHosts ile AYNI sekilde normalize edilir (trim + tekillestirme);
  // aksi halde " c1" gibi bir ad hosts[] icinde bulunamaz ve terminal_host undefined
  // kalir (playbook'ta "sahipsiz cluster" kovasina duser).
  const names = [...new Set((clusters || []).map((n) => String(n || '').trim()).filter(Boolean))];
  const items = names.map((name) => {
    const m = (meta && meta[name]) || {};
    return {
      env, tenant, cluster_name: name, terminal_host: hosts[name],
      // v3: cluster metadata'si DB'den gelir. Bos olan alan HIC gonderilmez —
      // playbook o zaman eski inventory yoluna (clusters[tenant_env][ad]) duser.
      ...(m.api_url ? { api_url: m.api_url } : {}),
      ...(m.vault_credential_key ? { credential_key: m.vault_credential_key } : {}),
    };
  });
  const terminalHosts = [...new Set(items.map((i) => i.terminal_host))].sort();
  return { terminal_host: terminalHosts[0], terminal_hosts: terminalHosts, ocp_clusters: items };
}

// Admin-yonetimli calisma zamani degiskenleri (oc yolu + zaman asimlari) → extra_vars.
// Saf fonksiyon (DB'ye dokunmaz). `ocBinary` BOSSA anahtar HIC gonderilmez; boylece
// playbook kendi kesfini yapar. Doluysa kesfin onune gecer.
function buildOcpRuntimeVars(cfg) {
  const c = cfg || {};
  return {
    ...(c.ocBinary ? { oc_binary: c.ocBinary } : {}),
    ...(Array.isArray(c.ocBinaryCandidates) && c.ocBinaryCandidates.length
      ? { oc_binary_candidates: c.ocBinaryCandidates }
      : {}),
    ...(c.ocAsyncTimeout ? { oc_async_timeout: c.ocAsyncTimeout } : {}),
    ...(c.ocListTimeout ? { oc_list_timeout: c.ocListTimeout } : {}),
    ...(c.ocLogTimeout ? { oc_log_timeout: c.ocLogTimeout } : {}),
  };
}

// Secilen cluster'lar icin bastion'lari cozer; eksik varsa anlasilir 400 firlatir.
// Cagiran her yerde (select + her job launch'i) TEKRAR calisir: admin verisi degismis
// olabilir, client'in gonderdigi input_json'a asla guvenilmez.
// Bastion + cluster metadata'sini (api_url, vault anahtari) BIRLIKTE cozer.
// Bastion eksikse 400 firlatir; api_url/credential_key eksikse HATA DEGIL — o cluster icin
// alanlar gonderilmez ve playbook eski inventory yoluna duser (asamali gecis).
async function resolveClusterContextOrThrow(env, tenant, clusters) {
  const hosts = await resolveHostsOrThrow(env, tenant, clusters);
  const meta = await adminData.resolveClusterMeta(env, tenant, clusters).catch(() => ({}));
  return { hosts, meta };
}

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
  const { hosts, meta } = await resolveClusterContextOrThrow(input.env, input.tenant, input.clusters);
  const runtimeCfg = await require('./ocp-runtime-config.cjs').getConfig().catch(() => ({}));
  const job = await jobs.launchJob(
    requestRow.request_id,
    'ocp_namespace_discovery',
    {
      ...buildOcpExtraVars({ env: input.env, tenant: input.tenant, clusters: input.clusters, hosts, meta }),
      ...buildOcpRuntimeVars(runtimeCfg),
    }
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
  const { hosts, meta } = await resolveClusterContextOrThrow(input.env, input.tenant, input.clusters);

  const archiveName = `${require('crypto').randomBytes(16).toString('hex')}.zip`;
  // A4 fetch-back: terminal/kaynak host NFS'e yazamazsa arsivi bu URL'ye push edebilir.
  const ingestInfo = await require('./ingest.cjs')
    .issueIngestToken({ requestId: requestRow.request_id, filename: archiveName })
    .catch(() => null);
  const runtimeCfg = await require('./ocp-runtime-config.cjs').getConfig().catch(() => ({}));
  const job = await jobs.launchJob(requestRow.request_id, 'ocp_discover_fetch', {
    ...buildOcpExtraVars({ env: input.env, tenant: input.tenant, clusters: input.clusters, hosts, meta }),
    ...buildOcpRuntimeVars(runtimeCfg),
    namespace: ns,
    app_name: app,
    staging_dir: process.env.LOGX_V2_STAGING_OCP_DIR || '/sw/BMW_PORTAL/logs/ocp',
    fallback_dir: require('./downloads.cjs').remoteFallbackDir(),
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
  buildOcpExtraVars, buildOcpRuntimeVars,
};
