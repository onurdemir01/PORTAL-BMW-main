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

// ── OTURUM BITTI ISARETI ─────────────────────────────────────────────────────
//
// NEDEN BIR ISARET GEREKIYOR: istemcinin "401 gordum → oturum bitti" demesi
// YANLIS olurdu. Bu depoda 401 iki AYRI anlama geliyor:
//
//   1. Portal oturumu yok            → kullanici giris ekranina dusmeli
//   2. UST SERVISIN kimligi gecersiz → kullanicinin oturumuyla ILGISI YOK
//
// Ikincisi gercek bir yol: `server/ansible/runner.cjs` AWX hatasini
// `Object.assign(new Error(...), { status: res.statusCode })` ile sariyor ve
// 22 ayri route `res.status(err.status || 500)` yaziyor. Yani AWX token'i
// duserse tarayici 401 gorur. Ciplak durum koduna bakan bir kapi, AWX token'i
// doldugunda TUM KULLANICILARI portaldan atardi.
//
// Bu yuzden oturum 401'leri — ve YALNIZCA onlar — bu baslikla imzalanir.
// Giris denemesinin basarisizligi (yanlis parola) BU DEGILDIR: ortada bitmis
// bir oturum yoktur, bu yuzden orasi bilerek imzalanmaz.
const SESSION_HEADER = 'X-Portal-Session';

/**
 * Yanita "bu 401 OTURUM 401'idir" imzasini basar ve `res`i geri dondurur —
 * boylece cagiran taraf kendi govdesini AYNEN korur:
 *
 *     return oturumYok(res).status(401).json({ ok: false, error: '...' });
 *
 * Govde SEKLI DEGISMEZ. Mevcut istemci kodu bu degisiklikten etkilenmez;
 * yeni kapi yalnizca baslik uzerinden calisir (tek mekanizma, tek dogruluk).
 * Govdesiz 401'ler (`res.status(401).end()`) de imzalanabilir — baslik
 * content-type'tan bagimsizdir.
 */
function oturumYok(res) {
  res.setHeader(SESSION_HEADER, 'expired');
  return res;
}

module.exports = { normalizeUsername, trustedHeaderUser, getRequestUser, getRequestRole, oturumYok, SESSION_HEADER };
