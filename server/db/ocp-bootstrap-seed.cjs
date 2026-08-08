// server/db/ocp-bootstrap-seed.cjs — OCP katalogunun BIR KERELIK ilk kurulumu.
//
// NEDEN BIR KERELIK: repodaki diger seed'ler her boot'ta "yoksa ekle" calisir. Burada bu
// YANLIS olurdu — admin bir cluster'i bilerek sildiginde bir sonraki restart onu geri
// getirirdi. Bu yuzden `portal_settings` uzerinde bir isaret tutulur ve isaret varsa
// seed HIC calismaz. Yeniden calistirmak icin isaret silinir (admin ekranindan da olur).
//
// GUVENLIK: yeni eklenen satirlar `is_active = 0` (PASIF) baslar. getClusterTree/
// clusterExists yalnizca aktif satirlari okudugu icin, admin gozden gecirip aktive edene
// kadar bu cluster'lar sihirbazlarda GORUNMEZ. Mevcut satirlara HIC DOKUNULMAZ.
'use strict';

const db = require('./index.cjs');
const settings = require('./settings.cjs');
const { INVENTORY, CLUSTER_JUMP_HOSTS, TERMINAL_HOST_MAP } = require('./data/ocp-inventory-seed.cjs');

const SEED_FLAG = 'ocp_bootstrap_seed_v1';

// Inventory anahtarini tenant/env'e ayirir: SON alt cizgi env, oncesi tenant.
// Alt cizgi yoksa ikisi de anahtarin kendisidir ('cicd' → cicd/cicd).
// Saf fonksiyon — dogrudan test edilir.
function parseInventoryKey(key) {
  const k = String(key || '').trim();
  const i = k.lastIndexOf('_');
  if (i <= 0 || i === k.length - 1) return { tenant: k, env: k };
  return { tenant: k.slice(0, i), env: k.slice(i + 1) };
}

// Seed edilecek cluster satirlarini uretir (DB'ye dokunmaz) — test edilebilir.
function buildSeedRows(inventory = INVENTORY, jumpHosts = CLUSTER_JUMP_HOSTS) {
  const rows = [];
  for (const [key, group] of Object.entries(inventory)) {
    const { tenant, env } = parseInventoryKey(key);
    for (const [clusterName, apiUrl] of Object.entries(group.clusters || {})) {
      rows.push({
        env,
        tenant,
        cluster_name: clusterName,
        api_url: apiUrl,
        vault_credential_key: group.credentialKey || null,
        // Cluster'a ozel jump server yoksa NULL birakilir; calisma aninda
        // ocp_terminal_host_map(tenant, env) yedegi devreye girer.
        terminal_host: jumpHosts[clusterName] || null,
      });
    }
  }
  return rows;
}

async function seedClusters(rows) {
  let inserted = 0;
  let skipped = 0;
  for (const r of rows) {
    try {
      const { rows: existing } = await db.query(
        `SELECT TOP 1 id FROM ocp_cluster_index WHERE env=$1 AND tenant=$2 AND cluster_name=$3`,
        [r.env, r.tenant, r.cluster_name]
      );
      // VAR OLAN SATIRA DOKUNULMAZ: admin'in yaptigi duzenlemeler (aktiflik, jump server,
      // gorunen ad) korunur — seed yalnizca EKSIK olani tamamlar.
      if (existing.length) { skipped++; continue; }

      await db.query(
        `INSERT INTO ocp_cluster_index
           (env, tenant, cluster_name, api_url, vault_credential_key, terminal_host, source, is_active)
         VALUES ($1,$2,$3,$4,$5,$6,'inventory-seed',0)`,
        [r.env, r.tenant, r.cluster_name, r.api_url, r.vault_credential_key, r.terminal_host]
      );
      inserted++;
    } catch (e) {
      console.warn(`[OcpSeed] '${r.tenant}/${r.env}/${r.cluster_name}' eklenemedi:`, e.message);
    }
  }
  return { inserted, skipped };
}

async function seedTerminalHostMap(map = TERMINAL_HOST_MAP) {
  let inserted = 0;
  let skipped = 0;
  for (const [key, host] of Object.entries(map)) {
    const { tenant, env } = parseInventoryKey(key);
    try {
      const { rows } = await db.query(
        `SELECT TOP 1 id FROM ocp_terminal_host_map WHERE tenant=$1 AND env=$2`, [tenant, env]
      );
      if (rows.length) { skipped++; continue; }
      await db.query(
        `INSERT INTO ocp_terminal_host_map (tenant, env, terminal_host, is_active) VALUES ($1,$2,$3,1)`,
        [tenant, env, host]
      );
      inserted++;
    } catch (e) {
      console.warn(`[OcpSeed] yedek esleme '${tenant}/${env}' eklenemedi:`, e.message);
    }
  }
  return { inserted, skipped };
}

// Boot'ta cagrilir. `force` yalnizca admin "yeniden calistir" ucundan gelir.
async function seedOcpBootstrapOnce({ force = false } = {}) {
  if (!force) {
    // DIKKAT: getSettingStrict hatayi YUTMAZ. DB okunamiyorsa seed'i "yapilmamis" sayip
    // calistirmak yanlis olurdu (mukerrer satir riski) — bu yuzden hata durumunda atlanir.
    let flag;
    try {
      flag = await settings.getSettingStrict(SEED_FLAG);
    } catch (e) {
      console.warn('[OcpSeed] isaret okunamadi, seed atlandi:', e.message);
      return { skipped: true, reason: 'flag_read_failed' };
    }
    if (flag) return { skipped: true, reason: 'already_seeded' };
  }

  const rows = buildSeedRows();
  const clusters = await seedClusters(rows);
  const hostMap = await seedTerminalHostMap();

  const summary = {
    at: new Date().toISOString(),
    clusters,
    terminalHostMap: hostMap,
    totalCandidates: rows.length,
  };
  await settings.setSetting(SEED_FLAG, JSON.stringify(summary), {
    description: 'OCP katalog ilk kurulumu (bir kerelik). Silinirse bir sonraki boot yeniden calisir.',
  });

  console.log(
    `[OcpSeed] cluster: ${clusters.inserted} eklendi (pasif) / ${clusters.skipped} zaten vardi; ` +
    `yedek esleme: ${hostMap.inserted} eklendi / ${hostMap.skipped} zaten vardi.`
  );
  return { skipped: false, ...summary };
}

module.exports = {
  seedOcpBootstrapOnce, SEED_FLAG,
  // saf yardimcilar — birim testleri icin
  parseInventoryKey, buildSeedRows,
};
