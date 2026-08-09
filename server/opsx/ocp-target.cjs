// server/opsx/ocp-target.cjs — OpsX ve Telnet'in ORTAK OpenShift hedef dogrulama +
// extra_vars uretimi.
//
// NEDEN VAR: bu mantik (katalog agacina karsi env/tenant/cluster dogrulama, bastion
// cozumleme, extra_vars kurulumu) OpsX ve Telnet'te BIREBIR kopyalanmisti; Telnet
// kopyasinda anahtar adlari ayrica koda sabitlenmisti (OpsX'te admin-yonetimli).
// Kopyalar zamanla birbirinden ayrisiyordu — tek kaynak burasi.
//
// Bastion cozumlemesi LogX ile AYNI kapidan gecer (logx/v2/admin.cjs resolveTerminalHosts):
// once cluster satirinin kendi terminal_host'u, yoksa tenant/env yedek eslemesi.
'use strict';

// Girdi dogrulamasi + bastion cozumlemesi + extra_vars uretimi. Hata durumunda
// `status` tasiyan Error firlatir (cagiran res.status(err.status).json(...) yapar).
//
// cfg: opsx/config.cjs'in openshift bolumu (anahtar adlari + clusterListStyle).
// Donus: { extraVars, requested, hosts, logSummary }
async function buildOcpTarget({ env, tenant, clusters, namespace, appName, cfg, staticVars = {} }) {
  const adminData = require('../logx/v2/admin.cjs');

  const envKey = String(env || '').trim();
  const tenantKey = String(tenant || '').trim();
  const ns = String(namespace || '').trim();
  const appN = String(appName || '').trim();

  if (!ns) throw Object.assign(new Error('Namespace gerekli.'), { status: 400 });
  if (!Array.isArray(clusters) || clusters.length === 0) {
    throw Object.assign(new Error('En az bir cluster seçilmeli.'), { status: 400 });
  }

  // Secim katalog agacina karsi yeniden dogrulanir — client'in gonderdigine guvenilmez.
  let tree;
  try {
    tree = await adminData.getClusterTree();
  } catch (err) {
    throw Object.assign(new Error(`Cluster kataloğu okunamadı: ${err.message}`), { status: 503 });
  }
  if (!envKey || !tree[envKey]) {
    throw Object.assign(new Error(`Ortam tanımlı değil: ${envKey || '(boş)'}`), { status: 400 });
  }
  if (!tenantKey || !tree[envKey][tenantKey]) {
    throw Object.assign(new Error(`Tenant tanımlı değil: ${tenantKey || '(boş)'}`), { status: 400 });
  }
  const validClusters = new Set(tree[envKey][tenantKey] || []);
  const requested = [...new Set(clusters.map((c) => String(c || '').trim()).filter(Boolean))];
  const notValid = requested.filter((c) => !validClusters.has(c));
  if (notValid.length) {
    throw Object.assign(
      new Error(`Bu cluster'lar "${envKey}/${tenantKey}" altında tanımlı değil: ${notValid.join(', ')}`),
      { status: 400 }
    );
  }

  // Bastion(lar) SUNUCUDA cozulur — kullanici girmez, client gondermez.
  const { hosts, missing } = await adminData.resolveTerminalHosts(envKey, tenantKey, requested);
  if (missing.length) {
    throw Object.assign(
      new Error(
        `Şu cluster'lar için Jump Server (bastion) tanımlı değil: ${missing.join(', ')} — ` +
        `Admin > LogX Yapılandırma ekranından cluster satırına Jump Server girin ` +
        `veya "${tenantKey}/${envKey}" için yedek eşleme tanımlayın.`
      ),
      { status: 400 }
    );
  }

  const uniqueHosts = [...new Set(requested.map((c) => hosts[c]))].sort();
  const perCluster = cfg.clusterListStyle === 'perCluster';

  if (!perCluster && uniqueHosts.length > 1) {
    // 'joined' modda playbook'a TEK bastion gider; birden fazla cozulduyse sessizce
    // birini secmek yanlis sunucuda islem calistirmak demektir — acikca reddedilir.
    throw Object.assign(
      new Error(
        `Seçilen cluster'lar farklı Jump Server'lar kullanıyor (${uniqueHosts.join(', ')}). ` +
        `Tek çalıştırmada birden fazla jump server kullanabilmek için Admin > OpsX Yapılandırma ` +
        `ekranından "Cluster listesi biçimi" ayarını "Cluster başına" yapın (playbook'un çoklu ` +
        `bastion desteklemesi gerekir), ya da bu cluster'ları ayrı ayrı çalıştırın.`
      ),
      { status: 400 }
    );
  }

  const extraVars = {
    ...staticVars,
    [cfg.terminalHostKey]: uniqueHosts[0],
    [cfg.namespaceKey]: ns,
    ...(appN ? { [cfg.appNameKey]: appN } : {}),
    [cfg.clustersKey]: perCluster
      ? requested.map((name) => ({
          env: envKey, tenant: tenantKey, cluster_name: name, terminal_host: hosts[name],
        }))
      // Bugunku sozlesme: TEK oge, cluster_name'ler ayirac ile birlesik.
      : [{ env: envKey, tenant: tenantKey, cluster_name: requested.join(cfg.separator) }],
    ...(perCluster ? { [cfg.terminalHostsKey]: uniqueHosts } : {}),
  };

  const logSummary = `ns=${ns}${appN ? ` app_name=${appN}` : ''} clusters=${requested.join(',')} `
                   + `terminal=${uniqueHosts.join('+')}`;
  return { extraVars, requested, hosts, logSummary };
}

module.exports = { buildOcpTarget };
