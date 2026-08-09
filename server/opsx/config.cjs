// server/opsx/config.cjs — OpsX'in AWX'e GONDERDIGI parametrelerin admin tarafindan
// duzenlenebilir yapilandirmasi.
//
// NEDEN VAR: parametre adlari ('application', 'limit', 'operation') onceden KOD ICINDE
// sabitti — playbook farkli isimler bekliyorsa kod degistirip yeniden deploy etmek
// gerekiyordu. Artik Admin > OpsX Yapilandirma ekranindan degistirilebilir.
//
// SAKLAMA: portal_config_blobs (name='opsx:params'). Tablo zaten yapisiz JSON icin var;
// yeni sema gerektirmez ve deploy uygulama dizinini ezse bile DB'de kalir.
//
// TEMPLATE/SUNUCU BURADA DEGIL: onlar Admin > Playbook Kayitlari'nda (ansible_playbook_registry
// satirlari opsx_legacy_operation / opsx_openshift_operation) yonetilir — LogX ile ayni desen.
'use strict';

const BLOB_NAME = 'opsx:params';

// Kod icindeki mantiksal alan adlari -> playbook'un bekledigi extra_vars anahtarlari.
// Varsayilanlar kullanicinin ilk sartnamesiyle ayni (application / limit / operation).
// Legacy ve Openshift govdeleri YAPISAL OLARAK farkli oldugu icin alan setleri de farkli:
//   Legacy    -> extra_vars: { application, operation };  sunucu listesi AWX'in `limit` alaninda
//   Openshift -> extra_vars: { terminal_host, namespace, app_name, ocp_clusters[] }; limit YOK
const DEFAULTS = Object.freeze({
  legacy: {
    applicationKey: 'application',
    operationKey: 'operation',
    // Her calistirmaya eklenen sabit degiskenler ("key: value" satirlari).
    extraVars: '',
    // Sunucu listesi ayiraci (AWX `limit` alaninda kullanilir).
    separator: ',',
  },
  openshift: {
    terminalHostKey: 'terminal_host',
    // Cok-bastion payload'inda bastion LISTESININ anahtari (v2 sozlesmesi).
    terminalHostsKey: 'terminal_hosts',
    namespaceKey: 'namespace',
    appNameKey: 'app_name',
    clustersKey: 'ocp_clusters',
    // Yalniz 'portal' modunda gonderilir (harici playbook bunlari bilmiyor).
    operationKey: 'operation',
    objectKindKey: 'object_kind',
    podNameKey: 'pod_name',
    replicasKey: 'replicas',
    extraVars: '',
    // Coklu cluster secimindeki cluster_name ayiraci ('joined' modda kullanilir).
    separator: ',',
    // Cluster listesinin AWX'e hangi SEKILDE gonderilecegi:
    //   'joined'     → bugunku davranis: TEK oge, cluster_name'ler `separator` ile birlesik.
    //                  Mevcut OpsX/Telnet playbook'lari bunu bekler — VARSAYILAN budur ki
    //                  bu surum canliya ciktiginda hicbir sey degismesin.
    //   'perCluster' → LogX ile ayni v2 sozlesmesi: her cluster ayri oge + kendi
    //                  terminal_host'u + terminal_hosts[] listesi. Playbook cok-bastion'a
    //                  guncellendikten SONRA admin ekranindan secilir (deploy gerekmez).
    clusterListStyle: 'joined',

    // Hangi playbook calisir:
    //   'external' → BUGUNKU davranis: Playbook Kayitlari'ndaki `opsx_openshift_operation`
    //                satiri (portalin sahip OLMADIGI, harici, tek-bastion playbook).
    //                `operation` govdeye KONMAZ (sartnamedeki ornek govdelerde yok).
    //                VARSAYILAN budur ki bu surum canliya ciktiginda hicbir sey degismesin.
    //   'portal'   → `opsx_ocp_operation` satiri: portalin sahip oldugu, LogX OCP
    //                playbook'lariyla ayni iskeletteki cok-bastion playbook. Cluster
    //                basina api_url/credential_key/username gonderilir, `operation`
    //                (ve gerekiyorsa object_kind/pod_name/replicas) govdeye eklenir.
    //                Bu modda cluster listesi HER ZAMAN cluster-basinadir.
    playbookMode: 'external',
  },
});

// Openshift tarafinda hangi playbook kaydinin (Playbook Kayitlari) kullanilacagi.
const PLAYBOOK_MODES = Object.freeze(['external', 'portal']);
const REGISTRY_KEY_BY_MODE = Object.freeze({
  external: 'opsx_openshift_operation',
  portal: 'opsx_ocp_operation',
});

// Hangi platformda hangi anahtar alanlari duzenlenebilir.
const KEY_FIELDS = Object.freeze({
  legacy: ['applicationKey', 'operationKey'],
  openshift: [
    'terminalHostKey', 'terminalHostsKey', 'namespaceKey', 'appNameKey', 'clustersKey',
    'operationKey', 'objectKindKey', 'podNameKey', 'replicasKey',
  ],
});

// Anahtar-adi olmayan, sabit secenekli alanlar.
const CLUSTER_LIST_STYLES = Object.freeze(['joined', 'perCluster']);

// extra_vars anahtarlari playbook'a AYNEN gecer — bicim kontrolu olmadan serbest metin
// kabul etmek, YAML'i bozan veya beklenmedik degisken enjekte eden degerlere yol acardi.
const SAFE_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/;

let _cache = null;

function db() {
  return require('../db/index.cjs');
}

function normalizePlatform(platform, raw, fallback) {
  const out = { ...fallback };
  for (const k of KEY_FIELDS[platform]) {
    const v = String(raw?.[k] || '').trim();
    if (v && SAFE_KEY.test(v)) out[k] = v;
  }
  if (typeof raw?.extraVars === 'string') out.extraVars = raw.extraVars;
  const sep = raw?.separator;
  // Ayirac tek bir noktalama/bosluk karakteri olmali.
  if (typeof sep === 'string' && sep.length >= 1 && sep.length <= 3) out.separator = sep;
  if (platform === 'openshift' && CLUSTER_LIST_STYLES.includes(raw?.clusterListStyle)) {
    out.clusterListStyle = raw.clusterListStyle;
  }
  if (platform === 'openshift' && PLAYBOOK_MODES.includes(raw?.playbookMode)) {
    out.playbookMode = raw.playbookMode;
  }
  // 'portal' modundaki playbook cluster-basina payload BEKLER; 'joined' ile calistirmak
  // tum cluster'lari tek bir birlesik ada indirger ve is sessizce yanlis hedefe gider.
  // Bu yuzden mod secimi stili DE belirler — admin iki ayri kutuyu tutturmak zorunda kalmasin.
  if (platform === 'openshift' && out.playbookMode === 'portal') {
    out.clusterListStyle = 'perCluster';
  }
  return out;
}

async function getConfig() {
  if (_cache) return _cache;
  let parsed = null;
  try {
    const { rows } = await db().query(
      `SELECT data FROM portal_config_blobs WHERE name = $1`, [BLOB_NAME]
    );
    if (rows.length) parsed = JSON.parse(rows[0].data);
  } catch { /* okunamadiysa varsayilana dus */ }

  _cache = {
    legacy: normalizePlatform('legacy', parsed?.legacy, DEFAULTS.legacy),
    openshift: normalizePlatform('openshift', parsed?.openshift, DEFAULTS.openshift),
  };
  return _cache;
}

async function saveConfig(input) {
  const next = {
    legacy: normalizePlatform('legacy', input?.legacy, DEFAULTS.legacy),
    openshift: normalizePlatform('openshift', input?.openshift, DEFAULTS.openshift),
  };
  const json = JSON.stringify(next);
  const upd = await db().query(
    `UPDATE portal_config_blobs SET data = $1, updated_at = GETUTCDATE() WHERE name = $2`,
    [json, BLOB_NAME]
  );
  if (!upd.rowCount) {
    await db().query(
      `INSERT INTO portal_config_blobs (name, data) VALUES ($1, $2)`, [BLOB_NAME, json]
    );
  }
  _cache = next;
  return next;
}

function invalidate() { _cache = null; }

// "key: value" satirlarini nesneye cevirir. Bilincli olarak BASIT: tam YAML parser
// eklemek (yeni bagimlilik + genis saldiri yuzeyi) bu ihtiyac icin gereksiz.
// Gecersiz anahtarlar SESSIZCE ATLANMAZ — cagirana bildirilir.
function parseExtraVarLines(text) {
  const out = {};
  const rejected = [];
  for (const line of String(text || '').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf(':');
    if (idx <= 0) { rejected.push(trimmed); continue; }
    const key = trimmed.slice(0, idx).trim();
    const value = trimmed.slice(idx + 1).trim();
    if (!SAFE_KEY.test(key)) { rejected.push(trimmed); continue; }
    out[key] = value;
  }
  return { vars: out, rejected };
}

module.exports = {
  getConfig, saveConfig, invalidate, parseExtraVarLines,
  DEFAULTS, KEY_FIELDS, CLUSTER_LIST_STYLES, PLAYBOOK_MODES, REGISTRY_KEY_BY_MODE, BLOB_NAME,
};
