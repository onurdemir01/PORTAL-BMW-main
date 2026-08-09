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
//   Openshift -> extra_vars: { env, oc_cluster, oc_input }; limit YOK. oc_input coklu
//   namespace/uygulama ciftini "ns1,app1;ns2,app2" formatinda tasir (bkz. bmw_openshift_jobs
//   production playbook'lariyla ayni sartname).
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
    envKey: 'env',
    ocClusterKey: 'oc_cluster',
    ocInputKey: 'oc_input',
    extraVars: '',
    // Coklu namespace/uygulama ciftleri arasindaki ayirac (oc_input icinde ";").
    separator: ',',
  },
});

// Hangi platformda hangi anahtar alanlari duzenlenebilir.
const KEY_FIELDS = Object.freeze({
  legacy: ['applicationKey', 'operationKey'],
  openshift: ['envKey', 'ocClusterKey', 'ocInputKey'],
});

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

module.exports = { getConfig, saveConfig, invalidate, parseExtraVarLines, DEFAULTS, KEY_FIELDS, BLOB_NAME };
