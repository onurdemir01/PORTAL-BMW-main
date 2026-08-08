// server/db/settings.cjs — `portal_settings` tablosu icin kucuk okuma/yazma yardimcisi.
//
// Tablo (mssql-setup.cjs) uzun suredir TANIMLI ama hicbir yerde kullanilmiyordu; oradaki
// yorum bu dosyaya atif yapiyordu fakat dosya hic yazilmamisti. Ilk gercek kullanici:
// bir-kerelik OCP katalog seed'inin "yapildi" isareti (bkz. server/db/ocp-bootstrap-seed.cjs).
//
// Nerede KULLANILMAZ: gizli degerler (parola/token) — onlar icin portal_env_overrides'in
// AES-256-GCM sifreleme yolu vardir. Buradaki degerler DUZ METINDIR.
'use strict';

const db = require('./index.cjs');

// Deger yoksa (veya DB erisilemezse) `fallback` doner — cagiran taraf DB kesintisinde
// "hic kayit yok" ile "okuyamadim"i ayirt etmek isterse getSettingStrict kullanmali.
async function getSetting(key, fallback = null) {
  try {
    const { rows } = await db.query(
      `SELECT setting_value FROM portal_settings WHERE setting_key = $1`, [String(key)]
    );
    return rows.length ? rows[0].setting_value : fallback;
  } catch (e) {
    console.warn(`[Settings] '${key}' okunamadi:`, e.message);
    return fallback;
  }
}

// DB hatasini YUTMAZ — "deger yok" ile "DB erisilemiyor" ayrimi kritik oldugunda kullanilir
// (or. bir-kerelik seed: DB okunamiyorsa seed'i "yapilmamis" sayip tekrar calistirmak
// yanlis olurdu).
async function getSettingStrict(key) {
  const { rows } = await db.query(
    `SELECT setting_value FROM portal_settings WHERE setting_key = $1`, [String(key)]
  );
  return rows.length ? rows[0].setting_value : null;
}

// UPDATE-once, 0 satir etkilendiyse INSERT (repo genelindeki upsert deseni; TOCTOU
// yarisinda UNIQUE(setting_key) ihlali olusursa cagiran tekrar deneyebilir).
async function setSetting(key, value, { description = null, updatedBy = null } = {}) {
  const k = String(key);
  const v = value == null ? '' : String(value);
  const upd = await db.query(
    `UPDATE portal_settings SET setting_value = $1, description = COALESCE($2, description),
       updated_by = COALESCE($3, updated_by), updated_at = GETUTCDATE()
     WHERE setting_key = $4`,
    [v, description, updatedBy, k]
  );
  if (!upd.rowCount) {
    await db.query(
      `INSERT INTO portal_settings (setting_key, setting_value, description, updated_by)
       VALUES ($1, $2, $3, $4)`,
      [k, v, description, updatedBy]
    );
  }
  return { key: k, value: v };
}

async function deleteSetting(key) {
  const { rowCount } = await db.query(
    `DELETE FROM portal_settings WHERE setting_key = $1`, [String(key)]
  );
  return rowCount > 0;
}

module.exports = { getSetting, getSettingStrict, setSetting, deleteSetting };
