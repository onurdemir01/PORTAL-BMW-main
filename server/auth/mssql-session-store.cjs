// server/auth/mssql-session-store.cjs — express-session uyumlu, MSSQL-tabanli session store.
//
// Amac (Sprint 4/D1): MemoryStore'un iki P0 sorununu kaldirmak — (1) restart'ta tum kullanicilar
// logout olur, (2) bellek 3.000 session'da yonetilemez buyur. Harici servis GEREKMEZ (Redis yok) —
// mevcut portal MSSQL kullanilir. VARSAYILAN budur; yalnizca `SESSION_STORE=memory` acikca
// verilirse MemoryStore kullanilir (bkz. server/auth/index.cjs initAuth).
//
// NOT: Yatay olcek (cok-instance) yine de Hazelcast/paylasimli katmana kadar sinirlidir; bu store
// tek-instance'ta restart-dayanikliligi + bellek baskisini cozer, ayrica DB paylasildigi icin
// ileride cok-instance'a da temel olusturur.
'use strict';

const db = require('../db/index.cjs');
const sessionPolicy = require('./session-policy.cjs');

const DEFAULT_TTL_MS = 8 * 60 * 60 * 1000; // kunyesiz (eski) satirlar icin

// Satirin DB omru (2026-10-02): oturum kunyesi varsa MUTLAK bitis. Bosta kalma
// yaptirimi middleware'dedir (session-policy.cjs) — satir bosta kalma suresinde
// silinseydi istemciye "neden" (idle) soylenemez, oturum sebepsizce "yok" olurdu.
// Oturum cerezi artik cogunlukla tarayici-oturumu cerezi (`expires` yok), bu yuzden
// cerezden turetmek kunyesiz satirlar icin geri dusustur.
function expiryFrom(sess) {
  const m = sess && sess.meta;
  if (m && Number.isFinite(m.createdAt) && Number.isFinite(m.lastSeenAt)) {
    return new Date(sessionPolicy.bitisler(m).absoluteExpiresAt);
  }
  const e = sess && sess.cookie && sess.cookie.expires;
  if (e) { const d = new Date(e); if (!isNaN(d.getTime())) return d; }
  return new Date(Date.now() + DEFAULT_TTL_MS);
}

// Sorgulanabilir sutunlar (username/created_at/last_seen_at) setup'ta ALTER ile
// eklenir. Eklenemediyse (yetki/kilit) giris KIRILMAMALI: ilk "Invalid column"
// hatasinda eski sutun kumesine donulur ve bir kez loglanir.
let kolonlarVar = true;
function kolonHatasi(err) {
  return /invalid column name/i.test(String(err && err.message));
}
function satirAlanlari(sess) {
  const m = (sess && sess.meta) || {};
  const u = sess && sess.user && sess.user.username;
  return {
    username: u ? String(u).toLowerCase() : null,
    createdAt: Number.isFinite(m.createdAt) ? new Date(m.createdAt) : null,
    lastSeenAt: Number.isFinite(m.lastSeenAt) ? new Date(m.lastSeenAt) : null,
  };
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
        // express-session bu hatayi next(err)'e verir (bkz. express-session kaynagi) —
        // ama o zincir HTML/JSON'a nasil cevrildigini biz kontrol etmiyoruz (nginx
        // araya girebiliyor) ve global handler'a ulasip ulasmadigini teyit edemedik.
        // Bu yuzden burada da ACIKCA logluyoruz — bir sonraki olayda gercek DB hatasi
        // (timeout/ECONNRESET/vb.) prod.out'ta gorunsun.
        .catch((err) => { console.error("[SessionStore] get() basarisiz:", err.message); cb(err); });
    }

    // Upsert — codebase idiom'u (writeVisibility) ile ayni: once UPDATE, satir yoksa INSERT.
    set(sid, sess, cb) {
      const expires = expiryFrom(sess);
      const json = JSON.stringify(sess);
      const f = satirAlanlari(sess);
      const genis = () =>
        db.query(
          `UPDATE portal_sessions SET sess = $1, expires = $2, username = $3, created_at = $4, last_seen_at = $5 WHERE sid = $6`,
          [json, expires, f.username, f.createdAt, f.lastSeenAt, sid],
        ).then(({ rowCount }) => {
          if (rowCount > 0) return null;
          return db.query(
            `INSERT INTO portal_sessions (sid, sess, expires, username, created_at, last_seen_at) VALUES ($1, $2, $3, $4, $5, $6)`,
            [sid, json, expires, f.username, f.createdAt, f.lastSeenAt],
          );
        });
      const dar = () =>
        db.query(`UPDATE portal_sessions SET sess = $1, expires = $2 WHERE sid = $3`, [json, expires, sid])
          .then(({ rowCount }) => {
            if (rowCount > 0) return null;
            return db.query(`INSERT INTO portal_sessions (sid, sess, expires) VALUES ($1, $2, $3)`, [sid, json, expires]);
          });
      (kolonlarVar ? genis() : dar())
        .catch((err) => {
          if (!kolonlarVar || !kolonHatasi(err)) throw err;
          kolonlarVar = false;
          console.warn("[SessionStore] portal_sessions yeni sutunlari yok — eski sema ile devam:", err.message);
          return dar();
        })
        .then(() => cb && cb(null))
        .catch((err) => { console.error("[SessionStore] set() basarisiz:", err.message); cb && cb(err); });
    }

    destroy(sid, cb) {
      db.query(`DELETE FROM portal_sessions WHERE sid = $1`, [sid])
        .then(() => cb && cb(null))
        .catch((err) => { console.error("[SessionStore] destroy() basarisiz:", err.message); cb && cb(err); });
    }

    // Faz D: bir kullanicinin acik oturumlari ("aktif oturumlarim", admin). Yalnizca
    // `username` sutunu; sutun yoksa bos liste (eski sema — liste ozelligi calismaz ama
    // giris etkilenmez).
    listByUser(username, cb) {
      if (!kolonlarVar) return cb(null, []);
      db.query(
        `SELECT sid, sess FROM portal_sessions WHERE username = $1 AND expires > GETUTCDATE()`,
        [String(username || '').toLowerCase()],
      )
        .then(({ rows }) => {
          const out = [];
          for (const r of rows || []) {
            try { out.push({ sid: r.sid, sess: JSON.parse(r.sess) }); } catch { /* bozuk satir */ }
          }
          cb(null, out);
        })
        .catch((err) => {
          if (kolonHatasi(err)) { kolonlarVar = false; return cb(null, []); }
          cb(err);
        });
    }

    // express-session degismeyen oturumda HER istekte touch cagirir. Kunyeli oturumda
    // satir omru yalnizca kunye degisince degisir — o da `set` ile yazilir. Bu yuzden
    // burada DB'ye gidilmez (eskiden her istek bir UPDATE'ti).
    touch(sid, sess, cb) {
      if (sess && sess.meta && Number.isFinite(sess.meta.createdAt)) return cb && cb(null);
      db.query(`UPDATE portal_sessions SET expires = $1 WHERE sid = $2`, [expiryFrom(sess), sid])
        .then(() => cb && cb(null))
        .catch((err) => { console.warn("[SessionStore] touch() basarisiz (yoksayildi):", err.message); cb && cb(null); }); // touch hatasi oturumu dusurmesin
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

// Bir kullanicinin TUM aktif oturumlarini iptal eder (rol dusurme/silme sonrasi).
// 2026-10-02: `username` SUTUNUYLA eslenir. Eskiden `sess` JSON'u uzerinde LIKE idi:
// JSON'da kacisli bir karakter (`\`, `"`) iceren ad hic eslesmez, `_`/`%` iceren ad
// BASKA kullanicilarin oturumlarini da silerdi. LIKE yalnizca sutunu henuz bos olan
// (bu surumden once yazilmis) satirlar icin kalir.
async function revokeSessionsForUser(username) {
  if (!username) return 0;
  const u = String(username).toLowerCase();
  const needle = `%${JSON.stringify(u).slice(0, -1).replace(/^"/, '"username":"')}"%`;
  if (kolonlarVar) {
    try {
      const { rowCount } = await db.query(
        `DELETE FROM portal_sessions WHERE username = $1 OR (username IS NULL AND LOWER(sess) LIKE $2)`,
        [u, needle],
      );
      return rowCount || 0;
    } catch (err) {
      if (!kolonHatasi(err)) return 0; // tablo yoksa (MemoryStore kurulumu) sessizce yoksay
      kolonlarVar = false;
    }
  }
  try {
    const { rowCount } = await db.query(`DELETE FROM portal_sessions WHERE LOWER(sess) LIKE $1`, [needle]);
    return rowCount || 0;
  } catch {
    return 0;
  }
}

// Rol YUKSELTMESINI kullanicinin acik oturumlarina yazar (oturum dusurulmez). Yarisa
// karsi ikinci katman bellekteki kayittir (session-policy rolYukseltmesiKaydet).
async function rewriteRoleForUser(username, role) {
  if (!username || !kolonlarVar) return 0;
  const u = String(username).toLowerCase();
  let rows;
  try {
    ({ rows } = await db.query(`SELECT sid, sess FROM portal_sessions WHERE username = $1 AND expires > GETUTCDATE()`, [u]));
  } catch {
    return 0;
  }
  let n = 0;
  for (const r of rows || []) {
    let sess;
    try { sess = JSON.parse(r.sess); } catch { continue; }
    if (!sess || !sess.user || sess.user.role === role) continue;
    sess.user.role = role;
    try {
      await db.query(`UPDATE portal_sessions SET sess = $1 WHERE sid = $2`, [JSON.stringify(sess), r.sid]);
      n++;
    } catch { /* tek satir hatasi digerlerini durdurmaz */ }
  }
  return n;
}

function _kolonDurumuSifirla() { kolonlarVar = true; }

module.exports = { createMssqlSessionStore, revokeSessionsForUser, rewriteRoleForUser, expiryFrom, _kolonDurumuSifirla };
