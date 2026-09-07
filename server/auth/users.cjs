// server/auth/users.cjs — Kullanici profili (portal_users) ve kullanici tercihleri
// (portal_user_preferences) veri erisimi. Login basarisinda recordLogin() ile profil
// MERGE edilir (last_login/login_count); UI tercihleri (tema, envanter kolonlari,
// filtreler, aktif admin sekmesi...) generic KV olarak saklanir — restart ve tarayici
// degisiminde korunur.
'use strict';

const db = require('../db/index.cjs');

// Login basarisinda cagirilir — best-effort (DB yoksa login bloklanmaz).
async function recordLogin(user) {
  const username = String(user.username || '')
    .trim()
    .toLowerCase();
  if (!username) return;
  try {
    const upd = await db.query(
      `UPDATE portal_users
         SET display_name = $1, mail = $2, auth_source = $3,
             last_login = GETUTCDATE(), login_count = login_count + 1
       WHERE username = $4`,
      [user.displayName || '', user.mail || '', user.authSource || 'local', username],
    );
    if (!upd.rowCount) {
      await db.query(
        `INSERT INTO portal_users (username, display_name, mail, auth_source)
         VALUES ($1, $2, $3, $4)`,
        [username, user.displayName || '', user.mail || '', user.authSource || 'local'],
      );
    }
  } catch (e) {
    console.warn('[Users] login kaydi yazilamadi:', e.message);
  }
}

/**
 * Bir kullanici adindan IS ATFI icin kimlik cozer: { username, displayName, mail }.
 *
 * NEDEN VAR: AWX isleri `requester_email`/`requester_name` ile etiketlenir ve Teams
 * bildirimi bu adrese gider. LogX v2'nin istek satiri (`logx_v2_requests`) yalnizca
 * `username` tasir — e-posta HICBIR yerde durmaz. Bos kalinca `withRequesterVars`
 * DEFAULT_REQUESTER'a duser, yani kod deposundaki SABIT bir calisanin adresine:
 * 2026-09-07'de kullanici kendi actigi iste baskasinin adini gordu.
 *
 * KAYNAK LDAP'TIR. `portal_users` login'de LDAP'tan doldurulur (bkz. recordLogin),
 * yani LDAP'in ONBELLEGIDIR — once oraya bakariz ki launch yoluna AG CAGRISI girmesin.
 * Satir yoksa ya da `mail` bossa CANLI LDAP'a gidilir. Ikisi de vermezse `null` doner
 * ve cagiran taraf varsayilana duser; bu durum `requester_is_fallback` ile VERIDE
 * gorunur kalir.
 *
 * Hicbir dalda hata firlatmaz: atif ikincildir, isi durdurmaz.
 */
async function getUserIdentity(username) {
  const uname = String(username || '').trim();
  if (!uname) return null;

  let displayName = '';
  let mail = '';

  try {
    const { rows } = await db.query(
      `SELECT display_name, mail FROM portal_users WHERE username = $1`,
      [uname.toLowerCase()],
    );
    displayName = String(rows[0]?.display_name || '').trim();
    mail = String(rows[0]?.mail || '').trim();
  } catch (e) {
    console.warn('[Users] kimlik okunamadi (portal_users):', e.message);
  }

  // E-POSTA ASIL ALANDIR: bildirim ona gider. Bos ise LDAP'a sorulur — `display_name`
  // dolu olsa bile, cunku eksik olan seyi tamamlamak icin buradayiz.
  if (!mail) {
    try {
      const ldap = await require('./ldap.cjs').findLdapUserByUsername(uname);
      if (ldap) {
        mail = String(ldap.mail || '').trim() || mail;
        displayName = displayName || String(ldap.displayName || '').trim();
      }
    } catch (e) {
      console.warn('[Users] LDAP kimlik aramasi basarisiz:', e.message);
    }
  }

  if (!displayName && !mail) return null;
  return { username: uname, displayName, mail };
}

async function listUsers() {
  const { rows } = await db.query(
    `SELECT username, display_name, mail, department, title, auth_source, first_seen, last_login, login_count
     FROM portal_users ORDER BY last_login DESC`,
  );
  return rows;
}

// ── Tercihler (generic KV) ───────────────────────────────────────────────────
const PREF_KEY_MAX = 200;
const PREF_VALUE_MAX = 64 * 1024; // tek tercih icin ust sinir (kotuye kullanim onlemi)

function validPrefKey(key) {
  const k = String(key || '').trim();
  return k && k.length <= PREF_KEY_MAX ? k : null;
}

async function getPrefs(username) {
  const uname = String(username || '')
    .trim()
    .toLowerCase();
  const { rows } = await db.query(
    `SELECT pref_key, pref_value FROM portal_user_preferences WHERE username = $1`,
    [uname],
  );
  const prefs = {};
  for (const r of rows) prefs[r.pref_key] = r.pref_value;
  return prefs;
}

async function setPref(username, key, value) {
  const uname = String(username || '')
    .trim()
    .toLowerCase();
  const k = validPrefKey(key);
  if (!uname || !k) return false;
  const v = value == null ? null : String(value).slice(0, PREF_VALUE_MAX);
  if (v === null) {
    await db.query(`DELETE FROM portal_user_preferences WHERE username = $1 AND pref_key = $2`, [
      uname,
      k,
    ]);
    return true;
  }
  const upd = await db.query(
    `UPDATE portal_user_preferences SET pref_value = $1, updated_at = GETUTCDATE()
     WHERE username = $2 AND pref_key = $3`,
    [v, uname, k],
  );
  if (!upd.rowCount) {
    await db.query(
      `INSERT INTO portal_user_preferences (username, pref_key, pref_value) VALUES ($1, $2, $3)`,
      [uname, k, v],
    );
  }
  return true;
}

// Toplu yazim: { key: value, silinecekKey: null } — null deger tercihi siler.
async function setPrefs(username, obj) {
  const entries = Object.entries(obj || {});
  let written = 0;
  for (const [key, value] of entries) {
    if (await setPref(username, key, value)) written++;
  }
  return written;
}

module.exports = { recordLogin, listUsers, getUserIdentity, getPrefs, setPref, setPrefs };
