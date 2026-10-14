// server/auth/admin-okuma-kapisi.cjs - "Admin her yere, digerleri yalniz salt okunur uclara" kapisi.
//
// Nginx Hub ve CIS router'lari 2026-09-19'da "yalniz Admin" kapisiyla acildi; 2026-09-23'te
// Admin > "Nginx Hub Erisimi" paneli kullaniciya/AD grubuna SEKME acmaya basladi ama bu kapilar
// gevsetilmedi: panel izin veriyor, sunucu 403 donuyordu (uretim, 2026-10-14). Kullanici karari
// (2026-10-14): panelden acilan sekmeler Admin olmayana SALT OKUNUR calissin.
//
// KURAL: Admin her yere. Admin olmayan YALNIZ verilen listedeki GET yollarina gecer ve ardindan
// router'in sayfa + sekme kapisindan (requireVisible) yine gecmek zorundadir. Gorunurluk motoru
// kurulamadiysa (`hazir()` false) Admin olmayan HICBIR yere gecemez - kapi acik kalmaz. Yazan
// her uc (POST/PUT/DELETE: push, refresh, temizlik, istisna, yeniden tarama) Admin'de kalir.
'use strict';

const isAdmin = (req) => req.session?.user?.role === 'Admin';

/**
 * @param {{ okuma: RegExp[], mesaj: string, hazir: () => boolean }} p
 *   okuma: Admin olmayana acik GET yollari (router'a gore, req.path)
 */
function adminOkumaKapisi({ okuma, mesaj, hazir }) {
  return (req, res, next) => {
    if (isAdmin(req)) return next();
    if (hazir() && req.method === 'GET' && okuma.some((re) => re.test(req.path))) return next();
    return res.status(403).json({ ok: false, message: mesaj });
  };
}

module.exports = { adminOkumaKapisi, isAdmin };
