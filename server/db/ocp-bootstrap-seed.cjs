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
const {
  INVENTORY, CLUSTER_JUMP_HOSTS, TERMINAL_HOST_MAP, VAULT_KEYS, DEFAULT_OCP_USERNAME,
} = require('./data/ocp-inventory-seed.cjs');

const SEED_FLAG = 'ocp_bootstrap_seed_v1';
// AYRI isaret: cluster seed'i cok once calismis kurulumlarda da vault katalogu bir kez
// dolsun. Ayni isareti paylassalardi mevcut kurulumlar katalogu HIC gormezdi.
const VAULT_SEED_FLAG = 'ocp_vault_key_seed_v1';

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
        // `oc login --username=...`. Envanterdeki tum anahtarlar ayni servis hesabina ait;
        // farkli olan cluster'da admin satiri duzenler.
        ocp_username: group.username || DEFAULT_OCP_USERNAME,
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
  let failed = 0;
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
           (env, tenant, cluster_name, api_url, vault_credential_key, ocp_username,
            terminal_host, source, is_active)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'inventory-seed',0)`,
        [r.env, r.tenant, r.cluster_name, r.api_url, r.vault_credential_key,
         r.ocp_username, r.terminal_host]
      );
      inserted++;
    } catch (e) {
      failed++;
      console.warn(`[OcpSeed] '${r.tenant}/${r.env}/${r.cluster_name}' eklenemedi:`, e.message);
    }
  }
  return { inserted, skipped, failed };
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

// Vault anahtar katalogu — CLUSTER seed'inden BAGIMSIZ bir-kerelik seed.
// Var olan anahtara dokunulmaz (admin'in duzenledigi aciklama korunur).
async function seedVaultKeys(keys = VAULT_KEYS) {
  let inserted = 0;
  let skipped = 0;
  let failed = 0;
  for (const k of keys) {
    try {
      const { rows } = await db.query(
        `SELECT TOP 1 id FROM ocp_vault_key_catalog WHERE key_name = $1`, [k.key_name]
      );
      if (rows.length) { skipped++; continue; }
      await db.query(
        `INSERT INTO ocp_vault_key_catalog (key_name, default_username, description, is_active)
         VALUES ($1,$2,$3,1)`,
        [k.key_name, k.default_username || null, k.description || null]
      );
      inserted++;
    } catch (e) {
      failed++;
      console.warn(`[OcpSeed] vault anahtari '${k.key_name}' eklenemedi:`, e.message);
    }
  }
  return { inserted, skipped, failed };
}

// Cluster seed'inden AYRI kapi: kendi isaretini tasir, bu yuzden katalog eklenmeden once
// kurulmus portallar da anahtarlari bir kez alir. Admin bir anahtari silerse geri gelmez.
async function seedVaultKeysOnce({ force = false } = {}) {
  if (!force) {
    let flag;
    try {
      flag = await settings.getSettingStrict(VAULT_SEED_FLAG);
    } catch (e) {
      console.warn('[OcpSeed] vault isareti okunamadi, seed atlandi:', e.message);
      return { skipped: true, reason: 'flag_read_failed' };
    }
    if (flag) return { skipped: true, reason: 'already_seeded' };
  }

  const result = await seedVaultKeys();
  // Cluster seed'iyle AYNI kural: hicbiri yazilamadiysa (or. tablo henuz yok) isaret
  // atilmaz ki bir sonraki acilista tekrar denensin.
  if (result.inserted === 0 && result.skipped === 0 && result.failed > 0) {
    console.warn(`[OcpSeed] hicbir vault anahtari yazilamadi (${result.failed} hata) — isaret ATILMADI.`);
    return { skipped: false, incomplete: true, vaultKeys: result };
  }
  await settings.setSetting(VAULT_SEED_FLAG, JSON.stringify({ at: new Date().toISOString(), ...result }), {
    description: 'OCP vault anahtar katalogu ilk kurulumu (bir kerelik).',
  });
  console.log(`[OcpSeed] vault anahtari: ${result.inserted} eklendi / ${result.skipped} zaten vardi.`);
  return { skipped: false, vaultKeys: result };
}

// Boot'ta cagrilir. `force` yalnizca admin "yeniden calistir" ucundan gelir.
async function seedOcpBootstrapOnce({ force = false } = {}) {
  // Cluster isaretinden ONCE ve ONDAN BAGIMSIZ: cluster katalogu coktan seed edilmis
  // kurulumlarda da vault anahtarlari dolsun.
  const vault = await seedVaultKeysOnce({ force }).catch((e) => {
    console.warn('[OcpSeed] vault katalog seed hatasi:', e.message);
    return { skipped: true, reason: 'error' };
  });

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
    if (flag) return { skipped: true, reason: 'already_seeded', vault };
  }

  const rows = buildSeedRows();
  const clusters = await seedClusters(rows);
  const hostMap = await seedTerminalHostMap();

  const summary = {
    at: new Date().toISOString(),
    clusters,
    terminalHostMap: hostMap,
    vault,
    totalCandidates: rows.length,
  };

  // ISARET, SEED GERCEKTEN CALISTIYSA yazilir. Hicbir satir eklenemediyse VE hicbiri zaten
  // yoksa (yani her INSERT patladiysa — or. kolon eksik, DB kesintisi) isaret YAZILMAZ ki
  // bir sonraki boot tekrar denesin. Aksi halde katalog KALICI OLARAK bos kalirdi.
  const nothingWorked = clusters.inserted === 0 && clusters.skipped === 0 && clusters.failed > 0;
  if (nothingWorked) {
    console.warn(
      `[OcpSeed] hicbir cluster yazilamadi (${clusters.failed} hata) — isaret ATILMADI, ` +
      `bir sonraki acilista tekrar denenecek.`
    );
    return { skipped: false, incomplete: true, ...summary };
  }

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
  seedVaultKeysOnce, VAULT_SEED_FLAG,
  // saf yardimcilar — birim testleri icin
  parseInventoryKey, buildSeedRows,
};
