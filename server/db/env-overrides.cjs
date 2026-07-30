// server/db/env-overrides.cjs — Admin Sistem sekmesinin kalici env override'lari.
// portal_env_overrides tablosundaki (beyaz listeli) anahtarlar boot'ta dotenv
// yuklemesinden SONRA, modul init'lerinden ONCE process.env'e uygulanir — boylece
// admin'in yaptigi degisiklikler restart/redeploy sonrasi da gecerli kalir ve
// .env.local dosyasina yazmaya gerek kalmaz.
//
// Guvenlik: yalnizca SYSTEM_CONFIG_KEYS icindeki anahtarlar uygulanir — DB'ye ne
// yazilmis olursa olsun beyaz liste disindaki anahtarlar process.env'e GECMEZ.
'use strict';

const crypto = require('crypto');
const db = require('./index.cjs');
const { SECRET_PATTERN } = require('../config/secret-pattern.cjs');

const ENC_PREFIX = 'enc:v1:';

// Kalici sifreleme anahtari — proses-omurlu, restart'ta degisen bir anahtardan (ornegin
// eskiden LogX otomatik-LDAP-auth icin tutulan ephemeral cred-cache) FARKLI olarak restart'lar
// arasi SABIT olmali (DB'deki sifreli deger sonraki boot'ta da cozulebilmeli). Operator
// tarafindan elle doldurulur.
function getEncryptionKey() {
  const raw = process.env.ENV_OVERRIDES_ENCRYPTION_KEY;
  if (!raw) return null;
  try {
    const buf = /^[0-9a-fA-F]{64}$/.test(raw) ? Buffer.from(raw, 'hex') : Buffer.from(raw, 'base64');
    return buf.length === 32 ? buf : null;
  } catch { return null; }
}

// Anahtar tanimliysa sifreler. PRODUCTION'da anahtar tanimli DEGILSE artik sessizce duz
// metin DONMEZ — firlatir (kurumsal AI kod incelemesi, review.md #17): eskiden
// ENV_OVERRIDES_ENCRYPTION_KEY unutulmus bir production dagitiminda ANTHROPIC_API_KEY/
// OPENAI_API_KEY gibi degerler farkina varilmadan DB'ye duz metin yaziliyordu. Dev/test'te
// (NODE_ENV !== 'production') sifir-kurulum deneyimi icin graceful-degrade korunur.
function encryptSecretValue(plain) {
  const key = getEncryptionKey();
  if (!key) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('ENV_OVERRIDES_ENCRYPTION_KEY tanimli degil: production ortaminda gizli degerler duz metin saklanamaz.');
    }
    return plain;
  }
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  const payload = { iv: iv.toString('base64'), enc: enc.toString('base64'), tag: cipher.getAuthTag().toString('base64') };
  return ENC_PREFIX + Buffer.from(JSON.stringify(payload)).toString('base64');
}

function decryptSecretValue(stored) {
  if (!stored.startsWith(ENC_PREFIX)) return stored; // eski/anahtarsiz-yazilmis duz metin satir
  const key = getEncryptionKey();
  if (!key) throw new Error('ENV_OVERRIDES_ENCRYPTION_KEY tanimli degil');
  const payload = JSON.parse(Buffer.from(stored.slice(ENC_PREFIX.length), 'base64').toString('utf8'));
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(payload.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(payload.tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(payload.enc, 'base64')), decipher.final()]).toString('utf8');
}

// server/admin/system-config.cjs ile paylasilir (tek dogruluk kaynagi burasi).
//
// GUVENLIK NOTU (kurumsal AI kod incelemesi Finding 24): NODE_ENV BILEREK bu listede
// DEGIL. NODE_ENV, secure-cookie davranisini (server/auth/index.cjs) HER ISTEKTE canli
// okunarak belirliyor — DB'den hot-swap edilebilir olsaydi, DB'ye yazma erisimi olan biri
// (veya calinmis bir Admin oturumu) restart'a gerek KALMADAN NODE_ENV=development yazip
// production'da secure cookie'yi devre disi birakabilirdi. NODE_ENV zaten deploy/run.sh +
// .env.<ortam> tarafindan yonetiliyor (bkz. docs/DEPLOYMENT.md) — DB'den degistirilebilir
// olmasinin hicbir operasyonel faydasi yok, yalniz risk var.
//
// ANTHROPIC_API_KEY/OPENAI_API_KEY/DT_MANAGED_MCP_URL/INSTANA_MCP_URL/AWX_URL/LDAP_URL
// BILINCLI OLARAK listede KALDI — projenin "her sey admin panelinden DB'ye yazilsin"
// gereksinimi bunlari kapsiyor; yalniz requireAdmin gorebiliyor/degistirebiliyor ve her
// degisiklik auditPortal ile denetim kaydina yaziliyor (server/admin/system-config.cjs).
// Bu, kod incelemesinin "hepsini cikar" onerisinden BILINCLI bir sapmadir.
//
// GUVENLIK NOTU (2. tur kurumsal AI kod incelemesi, review.md #7): SECRET_PATTERN'e
// uyan anahtarlar (…_KEY, …_SECRET, …_TOKEN, …_PASSWORD — su an ANTHROPIC_API_KEY ve
// OPENAI_API_KEY) artik DB'de duz metin DEGIL, AES-256-GCM ile sifreli saklanir
// (bkz. encryptSecretValue/decryptSecretValue, ENV_OVERRIDES_ENCRYPTION_KEY). Diger
// (gizli olmayan) anahtarlar duz metin kalir.
const SYSTEM_CONFIG_KEYS = [
  'PORT',
  'MSSQL_SERVER', 'MSSQL_DATABASE', 'MSSQL_RO_USER', 'MSSQL_RO_PASSWORD',
  'LOGX_APPS_TABLE',
  'OPSX_LEGACY_TEMPLATE_ID', 'OPSX_OPENSHIFT_TEMPLATE_ID', 'OPSX_AWX_SERVER_ID',
  'LDAP_URL', 'LDAP_BASE_DN',
  'AWX_URL', 'AWX_LOG_FETCH_TEMPLATE_ID', 'AWX_USER', 'AWX_PASSWORD', 'AWX_READ_ONLY_TEMPLATE_IDS',
  'NOBETCI_API_URL', 'NOBETCI_TEAM_NAME', 'NOBETCI_TEAM_ID', 'NOBETCI_TEAM_TYPE', 'NOBETCI_API_HOST',
  'DT_MANAGED_MCP_URL', 'INSTANA_MCP_URL',
  'AI_PROVIDER', 'ANTHROPIC_MODEL', 'OPENAI_MODEL', 'ANTHROPIC_API_KEY', 'OPENAI_API_KEY',
  'LOGX_V2_STAGING_LEGACY_DIR', 'LOGX_V2_STAGING_OCP_DIR', 'LOGX_STAGING_FALLBACK_DIR',
];

const LOAD_TIMEOUT_MS = 8000; // olu DB boot'u sonsuza dek bloklamasin

// DB'den uygulanan anahtarlarin kaydi — system-config GET'i "kaynak: DB" isaretler.
const _appliedFromDb = new Set();

async function loadEnvOverrides() {
  try {
    const rows = await Promise.race([
      db.query(`SELECT env_key, env_value FROM portal_env_overrides`).then((r) => r.rows),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), LOAD_TIMEOUT_MS)),
    ]);
    let applied = 0;
    let warnedNoKey = false;
    for (const r of rows) {
      if (!SYSTEM_CONFIG_KEYS.includes(r.env_key)) continue;
      let value = String(r.env_value ?? '');
      if (SECRET_PATTERN.test(r.env_key) && value.startsWith(ENC_PREFIX)) {
        try {
          value = decryptSecretValue(value);
        } catch (e) {
          if (!warnedNoKey) {
            console.warn(`[EnvOverrides] '${r.env_key}' sifresi cozulemedi (ENV_OVERRIDES_ENCRYPTION_KEY eksik/yanlis olabilir), atlaniyor:`, e.message);
            warnedNoKey = true;
          }
          continue;
        }
      }
      process.env[r.env_key] = value;
      _appliedFromDb.add(r.env_key);
      applied++;
    }
    if (applied) console.log(`[EnvOverrides] ${applied} env override DB'den uygulandi.`);
  } catch (e) {
    console.warn('[EnvOverrides] DB override yuklenemedi (env dosyalari gecerli):', e.message);
  }
}

async function setEnvOverride(key, value, updatedBy) {
  if (!SYSTEM_CONFIG_KEYS.includes(key)) throw new Error('Bu anahtar duzenlenemez.');
  const v = String(value ?? '');
  const stored = SECRET_PATTERN.test(key) ? encryptSecretValue(v) : v;
  const upd = await db.query(
    `UPDATE portal_env_overrides SET env_value = $1, updated_by = $2, updated_at = GETUTCDATE()
     WHERE env_key = $3`,
    [stored, updatedBy || null, key]
  );
  if (!upd.rowCount) {
    await db.query(
      `INSERT INTO portal_env_overrides (env_key, env_value, updated_by) VALUES ($1, $2, $3)`,
      [key, stored, updatedBy || null]
    );
  }
  process.env[key] = v; // process.env'e her zaman duz deger yazilir, sifreli metin degil
  _appliedFromDb.add(key);
}

async function deleteEnvOverride(key) {
  await db.query(`DELETE FROM portal_env_overrides WHERE env_key = $1`, [key]);
  _appliedFromDb.delete(key);
}

function isFromDb(key) {
  return _appliedFromDb.has(key);
}

module.exports = { SYSTEM_CONFIG_KEYS, loadEnvOverrides, setEnvOverride, deleteEnvOverride, isFromDb };
