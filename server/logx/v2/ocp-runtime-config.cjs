// server/logx/v2/ocp-runtime-config.cjs — OCP playbook'larinin CALISMA ZAMANI ayarlari
// (oc ikilisinin aranacagi yollar + zaman asimlari), admin ekranindan yonetilir.
//
// NEDEN VAR: playbook'ta `oc` yolu SABIT idi (/usr/local/bin/oc). Uretimde sunucularda oc
// /bin/oc konumunda oldugu icin TUM bastion'lar ayni anda dustu ve is hic sonuc uretemedi.
// Artik playbook oc'yi kendi kesfediyor; bu modul o kesfin aday listesini ve zaman
// asimlarini DEPLOY GEREKTIRMEDEN degistirilebilir kilar.
//
// SAKLAMA: portal_config_blobs (name='logx:ocp-runtime') — OpsX'in 'opsx:params' deseniyle
// AYNI (bkz. server/opsx/config.cjs). Yeni tablo/migration YOK.
'use strict';

const BLOB_NAME = 'logx:ocp-runtime';

const DEFAULTS = Object.freeze({
  // Bos = override yok; playbook aday listesi + PATH ile kendi bulur. Doluysa playbook'a
  // `oc_binary` extra_var'i olarak gider ve kesfin ONUNE gecer.
  ocBinary: '',
  // Playbook'un sirayla deneyecegi mutlak yollar (bulunan ILK calistirilabilir kazanir).
  ocBinaryCandidates: ['/usr/local/bin/oc', '/bin/oc', '/usr/bin/oc'],
  // Saniye. Playbook'taki ayni adli degiskenleri ezer.
  ocAsyncTimeout: 120,   // namespace kesfi (oc login + get projects)
  ocListTimeout: 120,    // pod listeleme
  ocLogTimeout: 300,     // pod loglarinin cekilmesi
});

// Playbook'a giden degisken adlari — kod icinde tekrarlanmasin diye tek yerde.
const TIMEOUT_KEYS = Object.freeze({
  ocAsyncTimeout: 'oc_async_timeout',
  ocListTimeout: 'oc_list_timeout',
  ocLogTimeout: 'oc_log_timeout',
});

// Mutlak yol; kabuk metakarakterine izin YOK (deger playbook'a ve oradan komut satirina gider).
const ABS_PATH = /^\/[A-Za-z0-9._\-/]+$/;
const MAX_CANDIDATES = 10;
const MIN_TIMEOUT = 10;
const MAX_TIMEOUT = 3600;

function normalizePath(value) {
  const s = String(value ?? '').trim();
  return ABS_PATH.test(s) ? s : '';
}

function normalizeTimeout(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(MAX_TIMEOUT, Math.max(MIN_TIMEOUT, Math.floor(n)));
}

// Gecersiz girdiler SESSIZCE varsayilana duser — bu ekran bir "ayar" ekrani, kullanicinin
// yanlis yazmasi isi tamamen durdurmamali (playbook zaten kendi kesfini yapabiliyor).
function normalize(raw) {
  const candidates = Array.isArray(raw?.ocBinaryCandidates) ? raw.ocBinaryCandidates : null;
  const cleaned = candidates
    ? [...new Set(candidates.map(normalizePath).filter(Boolean))].slice(0, MAX_CANDIDATES)
    : [];
  return {
    ocBinary: normalizePath(raw?.ocBinary),
    ocBinaryCandidates: cleaned.length ? cleaned : [...DEFAULTS.ocBinaryCandidates],
    ocAsyncTimeout: normalizeTimeout(raw?.ocAsyncTimeout, DEFAULTS.ocAsyncTimeout),
    ocListTimeout: normalizeTimeout(raw?.ocListTimeout, DEFAULTS.ocListTimeout),
    ocLogTimeout: normalizeTimeout(raw?.ocLogTimeout, DEFAULTS.ocLogTimeout),
  };
}

let _cache = null;

function db() {
  return require('../../db/index.cjs');
}

async function getConfig() {
  if (_cache) return _cache;
  let parsed = null;
  try {
    const { rows } = await db().query(`SELECT data FROM portal_config_blobs WHERE name = $1`, [BLOB_NAME]);
    if (rows.length) parsed = JSON.parse(rows[0].data);
  } catch { /* okunamadiysa varsayilana dus (DB kesintisi isi durdurmasin) */ }
  _cache = normalize(parsed || {});
  return _cache;
}

async function saveConfig(input) {
  const next = normalize(input || {});
  const json = JSON.stringify(next);
  const upd = await db().query(
    `UPDATE portal_config_blobs SET data = $1, updated_at = GETUTCDATE() WHERE name = $2`,
    [json, BLOB_NAME]
  );
  if (!upd.rowCount) {
    await db().query(`INSERT INTO portal_config_blobs (name, data) VALUES ($1, $2)`, [BLOB_NAME, json]);
  }
  _cache = next;
  return next;
}

function invalidate() { _cache = null; }

module.exports = { getConfig, saveConfig, invalidate, normalize, DEFAULTS, TIMEOUT_KEYS, BLOB_NAME };
