// server/auth/mssql-session-store.cjs — express-session uyumlu, MSSQL-tabanli session store.
//
// Amac (Sprint 4/D1): MemoryStore'un iki P0 sorununu kaldirmak — (1) restart'ta tum kullanicilar
// logout olur, (2) bellek 3.000 session'da yonetilemez buyur. Harici servis GEREKMEZ (Redis yok) —
// mevcut portal MSSQL kullanilir. **Opt-in:** yalnizca `SESSION_STORE=mssql` iken devreye girer;
// aksi hâlde express-session varsayilan MemoryStore'u kullanir (mevcut davranis, tam geri-alinabilir).
//
// NOT: Yatay olcek (cok-instance) yine de Hazelcast/paylasimli katmana kadar sinirlidir; bu store
// tek-instance'ta restart-dayanikliligi + bellek baskisini cozer, ayrica DB paylasildigi icin
// ileride cok-instance'a da temel olusturur.
'use strict';

const db = require('../db/index.cjs');

const DEFAULT_TTL_MS = 8 * 60 * 60 * 1000; // 8 saat (cookie maxAge ile hizali)

function expiryFrom(sess) {
  const e = sess && sess.cookie && sess.cookie.expires;
  if (e) { const d = new Date(e); if (!isNaN(d.getTime())) return d; }
  return new Date(Date.now() + DEFAULT_TTL_MS);
}

function createMssqlSessionStore(session) {
  const Store = session.Store;

  class MssqlSessionStore extends Store {
    get(sid, cb) {
      db.query(`SELECT sess FROM portal_sessions WHERE sid = $1 AND expires > GETUTCDATE()`, [sid])
        .then(({ rows }) => {
          if (!rows.length) return cb(null, null);
          let parsed = null;
          try { parsed = JSON.parse(rows[0].sess); } catch { /* bozuk satir → session yok say */ }
          cb(null, parsed);
        })
        .catch((err) => cb(err));
    }

    // Upsert — codebase idiom'u (writeVisibility) ile ayni: once UPDATE, satir yoksa INSERT.
    set(sid, sess, cb) {
      const expires = expiryFrom(sess);
      const json = JSON.stringify(sess);
      db.query(`UPDATE portal_sessions SET sess = $1, expires = $2 WHERE sid = $3`, [json, expires, sid])
        .then(({ rowCount }) => {
          if (rowCount > 0) return null;
          return db.query(`INSERT INTO portal_sessions (sid, sess, expires) VALUES ($1, $2, $3)`, [sid, json, expires]);
        })
        .then(() => cb && cb(null))
        .catch((err) => cb && cb(err));
    }

    destroy(sid, cb) {
      db.query(`DELETE FROM portal_sessions WHERE sid = $1`, [sid])
        .then(() => cb && cb(null))
        .catch((err) => cb && cb(err));
    }

    // Aktif kullanimda sureyi uzatir (express-session `touch` — rolling/aktivite yenilemesi).
    touch(sid, sess, cb) {
      db.query(`UPDATE portal_sessions SET expires = $1 WHERE sid = $2`, [expiryFrom(sess), sid])
        .then(() => cb && cb(null))
        .catch(() => cb && cb(null)); // touch hatasi oturumu dusurmesin
    }
  }

  const store = new MssqlSessionStore();

  // Suresi dolan session'lari periyodik temizle (30 dk) — DB sismesin.
  const iv = setInterval(() => {
    db.query(`DELETE FROM portal_sessions WHERE expires < GETUTCDATE()`).catch(() => {});
  }, 30 * 60 * 1000);
  if (iv.unref) iv.unref();

  return store;
}

// Bir kullanicinin TUM aktif oturumlarini iptal eder (rol degisikligi/silinmesi sonrasi —
// actions.md #14: "aktif oturumu sonlandiracak"). `sess` JSON blob'u icinde saklanan
// `user.username` alanina gore eslenir — SESSION_STORE=mssql degilse (MemoryStore
// kullaniliyorsa) portal_sessions bos/yok sayilir, DELETE 0 satir etkiler (sessiz no-op).
async function revokeSessionsForUser(username) {
  if (!username) return 0;
  const needle = `%"username":"${String(username).toLowerCase()}"%`;
  try {
    const { rowCount } = await db.query(`DELETE FROM portal_sessions WHERE LOWER(sess) LIKE $1`, [needle]);
    return rowCount || 0;
  } catch {
    return 0; // tablo yoksa (SESSION_STORE=mssql hic kullanilmadiysa) sessizce yoksay
  }
}

module.exports = { createMssqlSessionStore, revokeSessionsForUser };
