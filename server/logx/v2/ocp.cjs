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

// Tek calistirmada izin verilen azami (namespace, uygulama) cifti. Ust sinir olmadan bir
// kullanici yuzlerce cift gonderip AWX'i ve bastion'lari doldurabilirdi; her cift ayri bir
// `oc login` + pod listeleme + log cekme demek.
const MAX_TARGETS = 20;

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
      // `oc login --username`. Bu alan eksik oldugu icin uretimde (2026-08-09) TUM
      // cluster'lar "'username' is undefined" ile dustu: playbook degeri yalnizca
      // AWX'teki openshift_inventory_vars.yaml'dan okuyabiliyordu, o dosya ise yok.
      // Bos ise anahtar KONMAZ → playbook genel `ocp_username` varsayilanina duser.
      ...(m.ocp_username ? { username: m.ocp_username } : {}),
    };
  });
  const terminalHosts = [...new Set(items.map((i) => i.terminal_host))].sort();
  return { terminal_host: terminalHosts[0], terminal_hosts: terminalHosts, ocp_clusters: items };
}

// Admin-yonetimli calisma zamani degiskenleri (oc yolu + kullanici adi + zaman asimlari)
// → extra_vars.
// Saf fonksiyon (DB'ye dokunmaz). `ocBinary` BOSSA anahtar HIC gonderilmez; boylece
// playbook kendi kesfini yapar. Doluysa kesfin onune gecer.
function buildOcpRuntimeVars(cfg) {
  const c = cfg || {};
  return {
    ...(c.ocBinary ? { oc_binary: c.ocBinary } : {}),
    // Cluster satirinda kullanici adi girilmemisse playbook buna duser. Portalin
    // gonderdigi TEK genel varsayilan; AWX inventory dosyasi artik gerekmez.
    ...(c.defaultOcpUsername ? { ocp_username: c.defaultOcpUsername } : {}),
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

// POST /ocp/:requestId/apps/discover — { namespaces: [ad,...] }
// Secilen cluster'larda VERILEN namespace'lerdeki uygulama/objeleri tarar. Sonuc
// portalda onbellege yazilir (ocp_app_cache) — bir sonraki kullanici listeyi ANINDA gorur.
async function discoverApps(requestRow, namespaces) {
  const input = requestRow.input_json ? JSON.parse(requestRow.input_json) : null;
  if (!Array.isArray(input?.clusters) || !input.clusters.length) {
    throw Object.assign(new Error('Önce cluster seçimi tamamlanmalı.'), { status: 400 });
  }
  const nsList = [...new Set((namespaces || []).map((n) => String(n || '').trim()).filter(Boolean))];
  if (!nsList.length) {
    throw Object.assign(new Error('En az bir namespace gerekli.'), { status: 400 });
  }

  const { hosts, meta } = await resolveClusterContextOrThrow(input.env, input.tenant, input.clusters);
  const runtimeCfg = await require('./ocp-runtime-config.cjs').getConfig().catch(() => ({}));
  const base = buildOcpExtraVars({
    env: input.env, tenant: input.tenant, clusters: input.clusters, hosts, meta,
  });
  // Her cluster ayni namespace kumesini tarar; playbook cluster-basina `namespaces`
  // alanini okur (yoksa genel `ocp_namespaces` listesine duser).
  const job = await jobs.launchJob(requestRow.request_id, 'ocp_app_discovery', {
    ...base,
    ocp_clusters: base.ocp_clusters.map((c) => ({ ...c, namespaces: nsList })),
    ocp_namespaces: nsList,
    ...buildOcpRuntimeVars(runtimeCfg),
  });
  await requests.updateRequest(requestRow.request_id, {
    state: 'app_discovering',
    input: { ...input, appDiscoveryNamespaces: nsList },
  });
  return job;
}

async function finalizeAppDiscovery(requestRow, job) {
  if (!job.artifacts) {
    await requests.updateRequest(requestRow.request_id, {
      state: 'failed',
      errorMessage: job.errorMessage || 'Uygulama keşfi başarısız oldu.',
    });
    return;
  }
  const parsed = require('./ocp-app-parse.cjs').parseAppDiscoveryResult(job.artifacts);

  // Onbellege yaz — kesif sonucu artik kullanicilar arasi paylasilir (best-effort:
  // onbellek yazimi basarisiz olsa da sihirbaz akisi durmamali).
  try {
    const input = requestRow.input_json ? JSON.parse(requestRow.input_json) : {};
    await require('./ocp-cache.cjs').putApps({
      env: input.env, tenant: input.tenant, entries: parsed.entries, source: 'discovery',
    });
  } catch (e) {
    console.warn('[LogXv2] uygulama onbellegi yazilamadi:', e.message);
  }

  // `discovery_result_json` BILEREK YAZILMAZ: o sutun namespace kesfinin sonucunu tutar ve
  // sayfa yenilendiginde sihirbazin namespace listesini geri kurmasini saglar. Uygulama
  // sonucunu oraya yazmak namespace listesini kalici olarak silerdi. Uygulamalarin kalici
  // yeri onbellektir (yukarida yazildi); sihirbaz listeyi oradan okur.
  await requests.updateRequest(requestRow.request_id, { state: 'apps_discovered' });
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
  const normalized = normalizeDiscoveryResult(job.artifacts);

  // Onbellege yaz — sonuc artik kullanicilar arasi paylasilir (best-effort: onbellek
  // yazimi basarisiz olsa da sihirbaz akisi durmamali).
  try {
    const input = requestRow.input_json ? JSON.parse(requestRow.input_json) : {};
    const cache = require('./ocp-cache.cjs');
    for (const c of normalized.clusters || []) {
      // Yalnizca BASARILI taramalar yazilir; hatali cluster icin "namespace yok" yazmak
      // kullaniciyi yanlis yonlendirirdi.
      if (c.status !== 'ok') continue;
      await cache.putNamespaces({
        env: input.env, tenant: input.tenant, clusterName: c.cluster_name,
        namespaces: c.namespaces, source: 'discovery',
      });
    }
  } catch (e) {
    console.warn('[LogXv2] namespace onbellegi yazilamadi:', e.message);
  }

  await requests.updateRequest(requestRow.request_id, {
    state: 'namespaces_discovered',
    discoveryResult: normalized,
  });
}

// Cagirandan gelen (namespace, appName) ciftlerini normalize eder: kirpar, bos olanlari
// atar, tekillestirir. Saf fonksiyon — dogrudan test edilir.
// Tek cift gonderen ESKI cagrilar da buradan gecer (dizi haline getirilir), boylece
// tek-hedef davranisi coklu-hedefin ozel hali olur ve iki ayri kod yolu olusmaz.
function normalizeTargets(targets) {
  const list = Array.isArray(targets) ? targets : [targets];
  const seen = new Set();
  const out = [];
  for (const t of list) {
    const namespace = String(t?.namespace ?? '').trim();
    const appName = String(t?.appName ?? t?.app_name ?? '').trim();
    if (!namespace || !appName) continue;
    const key = `${namespace}\u0000${appName}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ namespace, appName });
  }
  return out;
}

// Arsiv adinin parcalari dosya adina girer: yalnizca guvenli karakterler kalir ve her
// parca kirpilir. Playbook ayni kurali uygular; buradaki amac portalin urettigi degerin
// de daha bastan guvenli olmasi (assert'e takilip is yarida kalmasin).
const ARCHIVE_PART_MAX = 60;
function slugPart(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, ARCHIVE_PART_MAX) || 'x';
}

// POST /ocp/:requestId/discover-fetch — { targets: [{namespace, appName}, ...] }.
// Pod adi hicbir zaman client'tan gelmez — playbook kendi `oc get pods` ciktisindan bulur.
//
// COKLU HEDEF: kullanici tek calistirmada birden fazla (namespace, uygulama) cifti
// secebilir. Is birimi (cluster × namespace × uygulama) basina AYRI bir arsiv uretilir —
// boylece hangi zip'in ne oldugu ADINDAN bellidir.
async function discoverFetch(requestRow, targets) {
  const input = requestRow.input_json ? JSON.parse(requestRow.input_json) : null;
  if (!Array.isArray(input?.clusters) || !input.clusters.length) {
    throw Object.assign(new Error('Önce cluster seçimi tamamlanmalı.'), { status: 400 });
  }
  const list = normalizeTargets(targets);
  if (!list.length) {
    throw Object.assign(new Error('En az bir (namespace, uygulama) çifti gerekli.'), { status: 400 });
  }
  if (list.length > MAX_TARGETS) {
    throw Object.assign(
      new Error(`Tek çalıştırmada en fazla ${MAX_TARGETS} (namespace, uygulama) çifti seçilebilir.`),
      { status: 400 }
    );
  }
  // Bastion'lar client input'undan degil, taze bir DB sorgusuyla yeniden cozulur
  // (client'in gonderdigi input_json'a degil, admin verisine guveniriz).
  const { hosts, meta } = await resolveClusterContextOrThrow(input.env, input.tenant, input.clusters);

  // Arsiv ADINI artik playbook kurar (cluster/ns/app bilgisi orada). Portal yalnizca
  // calistirmayi benzersizlestiren kisa bir kimlik uretir.
  const archiveId = require('crypto').randomBytes(4).toString('hex');
  const first = list[0];
  // INGEST (fetch-back) BILEREK KULLANILMIYOR: hicbir playbook `ingest_url`'i cagirmiyor
  // (legacy de dahil — `grep ingest_url` playbook'larda 0 sonuc). Her calistirmada bosuna
  // token + DB satiri uretiliyordu ve uretilen URL portalin KENDI localhost'unu isaret
  // ettigi icin bastion'dan zaten erisilemezdi. Teslim yolu legacy ile ayni: arsiv
  // paylasimli staging dizinine (NFS) yazilir, portal oradan okur.
  const runtimeCfg = await require('./ocp-runtime-config.cjs').getConfig().catch(() => ({}));
  const job = await jobs.launchJob(requestRow.request_id, 'ocp_discover_fetch', {
    ...buildOcpExtraVars({ env: input.env, tenant: input.tenant, clusters: input.clusters, hosts, meta }),
    ...buildOcpRuntimeVars(runtimeCfg),
    // Coklu hedef sozlesmesi.
    ocp_targets: list.map((t) => ({ namespace: t.namespace, app_name: t.appName })),
    archive_id: archiveId,
    // GERIYE UYUM: eski playbook surumu `ocp_targets`i bilmez; ilk hedefi eski alanlarla
    // da gondeririz ki en azindan tek hedef calissin. `namespace` Ansible'da REZERVE bir
    // addir ("Found variable using reserved name" uyarisi) — playbook once
    // `oc_namespace_input`a bakar.
    oc_namespace_input: first.namespace,
    namespace: first.namespace,
    app_name: first.appName,
    staging_dir: process.env.LOGX_V2_STAGING_OCP_DIR || '/sw/BMW_PORTAL/logs/ocp',
    fallback_dir: require('./downloads.cjs').remoteFallbackDir(),
  });

  await requests.updateRequest(requestRow.request_id, {
    state: 'transferring',
    // `targets` yeni kaynak; `namespace`/`appName` ILK hedeften turetilerek yazilmaya
    // devam eder — bu alanlari okuyan eski istek satirlari ve ekranlar kirilmasin.
    input: { ...input, targets: list, namespace: first.namespace, appName: first.appName },
  });
  return job;
}

module.exports = {
  getClusterTree, selectClusters, discoverNamespaces, finalizeNamespaceDiscovery, discoverFetch,
  discoverApps, finalizeAppDiscovery,
  buildOcpExtraVars, buildOcpRuntimeVars, normalizeTargets, slugPart, MAX_TARGETS,
};
