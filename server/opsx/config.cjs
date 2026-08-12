// server/opsx/config.cjs — OpsX'in AWX'e GONDERDIGI parametrelerin admin tarafindan
// duzenlenebilir yapilandirmasi. Telnet modulu de bu blob'un openshift bolumunu
// PAYLASIR (bkz. server/opsx/ocp-target.cjs + server/telnet/index.cjs) — bu yuzden
// terminalHost*/namespaceKey/appNameKey/clustersKey/clusterListStyle alanlari
// SILINEMEZ, sadece OpsX'in KENDI /api/opsx/run yolu bunlari artik KULLANMIYOR
// (bkz. asagidaki not).
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
// Legacy ve Openshift govdeleri YAPISAL OLARAK farkli oldugu icin alan setleri de farkli:
//   Legacy    -> extra_vars: { application, operation };  sunucu listesi AWX'in `limit` alaninda
//
//   Openshift -> OpsX'in KENDI /api/opsx/run'i artik SADECE ocClusterKey/ocInputKey
//   kullanir: extra_vars: { oc_environment, oc_cluster, oc_input }; limit YOK, terminal_host YOK.
//   oc_input coklu namespace/uygulama ciftini "ns1,app1;ns2,app2" formatinda tasir — gercek
//   bmw_openshift_jobs/application_rollout.yaml production playbook'unun BEKLEDIGI AYNI
//   sartname (playbook hedefi kendisi `hosts: "{{ oc_cluster }}_{{ oc_environment }}"` ile cozer).
//
//   `env` alaninin AWX'e giden anahtar ADI ('oc_environment') ARTIK BURADA YAPILANDIRILAMAZ —
//   index.cjs'de SABIT yazilir (2026-08-12, uretimde 3. kez yasandi: kaldirilmis "OpsX
//   Yapilandirma" admin ekraninden DB'ye eskiden kaydedilmis 'env' degeri, koddaki DEFAULT
//   duzeltilse bile DB satirinin oncelikli olmasi yuzunden gerci ezmeye devam ediyordu).
//
//   terminalHostKey/terminalHostsKey/namespaceKey/appNameKey/clustersKey/clusterListStyle
//   alanlari OpsX tarafindan artik OKUNMUYOR ama Telnet modulu (server/telnet/index.cjs)
//   hala buradan okuyup server/opsx/ocp-target.cjs'e gecirdigi icin KORUNUR.
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
    // OpsX'in KENDI /api/opsx/run yolunun kullandigi alanlar (env HARIC — yukaridaki nota bak).
    ocClusterKey: 'oc_cluster',
    ocInputKey: 'oc_input',
    // Asagidakiler artik SADECE Telnet icin (bkz. dosya basi notu).
    terminalHostKey: 'terminal_host',
    terminalHostsKey: 'terminal_hosts',
    namespaceKey: 'namespace',
    appNameKey: 'app_name',
    clustersKey: 'ocp_clusters',
    extraVars: '',
    // Coklu namespace/uygulama ciftleri arasindaki ayirac (OpsX'in oc_input'unda ";").
    // Telnet tarafinda ise cluster_name listesini birlestirmek icin kullanilir.
    separator: ',',
    // Telnet'in cluster listesini AWX'e hangi SEKILDE gonderecegi (bkz. ocp-target.cjs).
    //   'joined'     → TEK oge, cluster_name'ler `separator` ile birlesik (varsayilan).
    //   'perCluster' → her cluster ayri oge + kendi terminal_host'u + terminal_hosts[].
    clusterListStyle: 'joined',
  },
});

// Hangi platformda hangi anahtar alanlari duzenlenebilir.
const KEY_FIELDS = Object.freeze({
  legacy: ['applicationKey', 'operationKey'],
  openshift: [
    'ocClusterKey', 'ocInputKey',
    'terminalHostKey', 'terminalHostsKey', 'namespaceKey', 'appNameKey', 'clustersKey',
  ],
});

// Anahtar-adi olmayan, sabit secenekli alanlar (Telnet icin).
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
  DEFAULTS, KEY_FIELDS, CLUSTER_LIST_STYLES, BLOB_NAME,
};
