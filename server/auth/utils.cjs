'use strict';

function normalizeUsername(username) {
  if (!username) return '';
  return String(username).trim().toLowerCase().replace(/@.*/, '');
}

// Guvenilir ic-servis header auth'u. VARSAYILAN OLARAK KAPALI (guvenli) — yalnizca
// PORTAL_TRUSTED_HEADER_SECRET set edilmisse VE cagiran eslesen secret'i sunuyorsa calisir.
// Bu, onceki `x-portal-role` yetki-yukseltme backdoor'unu kapatir: eskiden session'siz
// herhangi bir istemci `x-portal-role: Admin` yollayip admin olabiliyordu. Mesru servis-servis
// cagrilari secret'i set eder. Rol yalnizca "Admin" ise Admin kabul edilir, aksi hâlde User.
//
// PORTAL_TRUSTED_HEADER_ALLOWED_USERS (virgullu liste) verilmisse, x-portal-user degeri bu
// listede OLMAYAN bir kullanici icin reddedilir — secret ele gecse bile keyfi kullanici adi
// uretilerek Admin/User kimlik taklidi yapilamaz (secret tek basina yeterli olmaz).
function trustedHeaderUser(req) {
  const secret = process.env.PORTAL_TRUSTED_HEADER_SECRET;
  if (!secret) return null;
  if (req.headers["x-portal-auth-secret"] !== secret) return null;
  const username = req.headers["x-portal-user"];
  if (!username) return null;
  const allowlist = String(process.env.PORTAL_TRUSTED_HEADER_ALLOWED_USERS || "")
    .split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (allowlist.length > 0 && !allowlist.includes(String(username).toLowerCase())) {
    return null;
  }
  return {
    username,
    role: req.headers["x-portal-role"] === "Admin" ? "Admin" : "User",
    authSource: "header",
  };
}

// Bir istegin etkin kimligi: once session, sonra (secret'li) guvenilir header. Tum moduller
// header'i DOGRUDAN okumak yerine bunu kullanmali ki secret-kapisi tek yerde zorlansin.
//
// NOT: getRequestUser/getRequestRole burada (server/auth/index.cjs'de degil) tanimlidir ki
// server/auth/visibility.cjs bunlari dongusel bagimlilik OLUSTURMADAN import edebilsin —
// eskiden visibility.cjs, index.cjs'i lazy-require ediyordu, index.cjs de visibility.cjs'i
// require ediyordu (yapisal dongu; bugun zararsizdi ama gelecekte require sirasi degisirse
// yari-yuklenmis modul donebilirdi). Bu dosya HICBIR auth alt-moduluna bagimli degildir.
function getRequestUser(req) {
  if (req.session?.user) return req.session.user;
  const hdr = trustedHeaderUser(req);
  if (hdr) { req.user = hdr; return hdr; }
  return null;
}

function getRequestRole(req) {
  const u = getRequestUser(req);
  return u ? u.role : null;
}

module.exports = { normalizeUsername, trustedHeaderUser, getRequestUser, getRequestRole };
