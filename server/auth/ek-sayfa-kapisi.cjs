// server/auth/ek-sayfa-kapisi.cjs - tasinan sayfanin YENI anahtari eski gorunurluk kapisina EK olarak gecer (2026-11-13).
//
// Kullanici (2026-11-13): "Reboot Kontrolu ile Retirement'i BMW Hub'a eklemeni istemistim" - iki akis BMW Hub
// sol menusunde AYRI sayfa oldu (RebootKontrolu, Retirement). Uclarin bugunku kapisi (ServerHub sayfa gorunurlugu)
// KALIR: kimse erisimini kaybetmez. Yeni sayfa anahtari ek bir yol acar: Server Hub'i genel kapatan (kill-switch)
// admin yeni sayfayi kapatmadikca Reboot Kontrolu / Retirement calismaya devam eder.
//
// Karar sirasi (eslesen istekte):
//   1) oturum yok / canSee yok (motor sahte ya da eski) -> eski kapi karar verir (401 / 403 / fail-closed)
//   2) canSee(user, anahtar) true                        -> gecer
//   3) aksi halde ya da motor okunamazsa                 -> eski kapi karar verir
// Eslesmeyen istek dogrudan eski kapiya gider (Server Hub'in diger uclari yalniz ServerHub ile acilir).
'use strict';

function ekSayfaKapisi({ anahtar, ana, canSee, eslesir = () => true }) {
  if (typeof ana !== 'function') throw new Error('ekSayfaKapisi: ana kapi yok');
  if (!anahtar) throw new Error('ekSayfaKapisi: anahtar yok');
  return async (req, res, next) => {
    if (!eslesir(req)) return ana(req, res, next);
    if (typeof canSee !== 'function') return ana(req, res, next);
    let user = null;
    try {
      user = require('./utils.cjs').getRequestUser(req);
    } catch {
      user = null;
    }
    if (!user) return ana(req, res, next);
    try {
      if ((await canSee(user, anahtar)) === true) return next();
    } catch {
      /* motor okunamadi: eski kapinin fail-closed kurali (Admin muaf) */
    }
    return ana(req, res, next);
  };
}

module.exports = { ekSayfaKapisi };
