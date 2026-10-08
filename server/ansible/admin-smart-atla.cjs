// server/ansible/admin-smart-atla.cjs — ADMIN: "benim tetiklemelerimde Smart onayi istenmesin" (2026-10-08).
//
// Kullanici: "Admin'ler istedigi zaman SADECE KENDI tetiklemelerinde Smart onayini kapatabilsin.
// Deneme yapacagimiz zaman tekrar acip akisi test edebiliyor olalim."
//
// KAPSAM DAR:
//   * Yalniz ROLU Admin olan kullanicinin KENDI baslattigi istekte gecerli. Tercih kullanici
//     basina (portal_user_preferences); karar HER istekte oturumdaki role ile verilir - rolu
//     dusurulen birinin eski tercihi ise yaramaz.
//   * Yalniz SMART onayi atlanir. OCO (kesinti penceresi) kapisi, survey/girdi dogrulamalari ve
//     diger her kapi AYNEN calisir.
//   * Servis/platform duzeyindeki Smart ayari DEGISMEZ: digerlerinin talepleri onaya gitmeye
//     devam eder.
// IZ BIRAKIR: atlanan her onay denetime ('smart_onayi_admin_atladi') yazilir - "bu prod isini
// kim onaysiz calistirdi" sorusunun cevabi kalir.
// FAIL-CLOSED: tercih okunamazsa (DB yok/hata) atlama YOK, onay istenir.
//
// Tercih anahtari genel /prefs ucuyla YAZILAMAZ (auth/users.cjs KORUNAN_ONEK); yalniz admin
// ucundan (/api/auth/smart-atla) degisir.
'use strict';

const ANAHTAR = 'guvenlik.smart_onayi_atla';

const adminMi = (req) => req?.session?.user?.role === 'Admin';

/** Bu istek, Smart onayini atlamis bir Admin'den mi geliyor? (okunamazsa false) */
async function adminSmartAtliyor(req) {
  if (!adminMi(req)) return false;
  const kim = req.session.user.username;
  if (!kim) return false;
  try {
    const prefs = await require('../auth/users.cjs').getPrefs(kim);
    return prefs?.[ANAHTAR] === '1';
  } catch (e) {
    console.warn('[Smart] admin atlama tercihi okunamadi - onay istenecek:', e.message);
    return false;
  }
}

/** Atlanan onayi denetime yazar (hata yutulur: denetim yazilamadi diye is durmaz, ama loglanir). */
function atlamayiDenetle(req, yer, ayrinti = {}) {
  try {
    require('../audit/index.cjs').auditPortal(req, 'smart_onayi_admin_atladi', {
      detail: JSON.stringify({ yer, kim: req?.session?.user?.username || null, ...ayrinti }),
    });
  } catch (e) {
    console.warn('[Smart] admin atlama denetimi yazilamadi:', e.message);
  }
}

module.exports = { ANAHTAR, adminSmartAtliyor, atlamayiDenetle };
