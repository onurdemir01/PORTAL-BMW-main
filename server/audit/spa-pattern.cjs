// server/audit/spa-pattern.cjs — "bu uygulama bir SPA mi?" sorusunun TEK kaynagi.
//
// NEDEN TEK DOSYA: ayni kural BES yerde ayri ayri yaziliydi (nginx-migration, route-stats,
// route-traffic, denetim, ansible/choice-sources). Birini duzeltip otekini unutmak, ayni
// uygulamanin bir ekranda SPA, digerinde "SPA degil" gorunmesi demekti; sayilar birbirini
// tutmayinca da hangisinin dogru oldugu anlasilmiyordu. Artik hepsi burayi cagirir ve
// spa-pattern-tek-kaynak bekcisi yeni bir kopya acilmasini engeller.
//
// KURAL (kullanici, 2026-09-28: "bazi SPA uygulamalarinin standarta uymayan kalibi var,
// bence genisletelim"):
//
//   1) Ad "-app-v" ya da "-app-emb-v" ICERIYORSA SPA'dir.  (kurumsal standart)
//   2) Ad SURUM EKIYLE bitiyorsa da SPA'dir: -v0, -v1, …    (standarta uymayanlar)
//
// Ikinci kural birincinin YERINE GECMEZ, USTUNE EKLENIR — boylece once SPA sayilan hicbir
// uygulama listeden dusmez. Ornekler (hepsi uretimde, envanterde cozuluyor ama eski kurala
// takiliyordu): non-core-assets-v0, doc-acceptance-frontend-v0, digital-fast-limit-cf-v0,
// disney-bonus-cfa-v0, dlyd-prdct-rstrctring-v0, investor-dps-mngmnt-v0.
//
// KABUL EDILEN RISK: "-v1" ile biten GERCEK bir API de artik SPA sayilir. Yanlis alarm
// uretir (ekranda "dizin eksik" gorunur), sessiz kayip uretmez — tanim ancak kullanici
// dugmeye basarsa olusur. Tersi, yani gercek bir SPA'yi listeden dusurmek, tasimanin
// sessizce unutulmasi demekti.
//
// DBO.OPENSHIFT_INVENTORY'DE "BU SPA MI" SUTUNU YOK; ada bakmak zorunda oldugumuz icin
// kural ADIN kendisinden okunur. Envanterde boyle bir sutun acilirsa dogru cozum bu
// dosyayi silip oraya bakmaktir.
'use strict';

/** Kurumsal standart kalip: ad icinde "-app-v" / "-app-emb-v" GECER. */
const SPA_RE = /-app(-emb)?-v/i;
/** Standarta uymayanlar: ad surum ekiyle BITER ("non-core-assets-v0"). */
const SPA_VER_RE = /-v\d+$/i;
/** FQDN/etiket icinde surum eki: "<app>-v0-<ns>" ya da sonda "<app>-v0". */
const SPA_LABEL_VER_RE = /-v\d+(-|$)/i;

/** "app-ns.apps.fw.garanti.com.tr" -> "app-ns"; nokta yoksa dizginin kendisi. */
const labelOf = (s) =>
  String(s == null ? '' : s)
    .trim()
    .toLowerCase()
    .split('.')[0];

/** UYGULAMA ADI icin: "bu uygulama yeni sunucuda dizin ister mi / SPA mi?" */
const isSpaApp = (app) => {
  const a = String(app == null ? '' : app).trim();
  return SPA_RE.test(a) || SPA_VER_RE.test(a);
};

/**
 * ROUTE ADRESI / ETIKET icin: "<app>-<ns>" kalibinda, uygulama adi henuz ayrilmamis.
 * Yalniz ILK ETIKETE bakar — "apps.fw.garanti.com.tr" kuyrugu her adreste ayni.
 */
const isSpaLabel = (s) => {
  const l = labelOf(s);
  return SPA_RE.test(l) || SPA_LABEL_VER_RE.test(l);
};

/** Ekranda gosterilen kalip metni — kural degisirse BURASI da degisir. */
const SPA_PATTERN_LABEL = '-app-v / -app-emb-v / -v<surum>';

module.exports = {
  SPA_RE,
  SPA_VER_RE,
  SPA_LABEL_VER_RE,
  SPA_PATTERN_LABEL,
  labelOf,
  isSpaApp,
  isSpaLabel,
};
