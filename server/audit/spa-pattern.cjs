// server/audit/spa-pattern.cjs — "bu uygulama bir SPA mi?" sorusunun TEK kaynagi.
//
// NEDEN TEK DOSYA: ayni kural BES yerde ayri ayri yaziliydi (nginx-migration, route-stats,
// route-traffic, denetim, ansible/choice-sources). Birini duzeltip otekini unutmak, ayni
// uygulamanin bir ekranda SPA, digerinde "SPA degil" gorunmesi demekti; sayilar birbirini
// tutmayinca da hangisinin dogru oldugu anlasilmiyordu. Artik hepsi burayi cagirir ve
// SP4 bekcisi yeni bir kopya acilmasini engeller.
//
// ── KURAL: yalnizca kurumsal ad kalibi ───────────────────────────────────────────────
// Ad "-app-v" ya da "-app-emb-v" ICERIYORSA o uygulama bir SPA'dir. Baska olcut YOK.
//
// ── GENISLETME DENENDI VE GERI ALINDI (2026-09-28) ───────────────────────────────────
// Once "ad -v0/-v1 ile de bitebilir" diye genisletilmisti; boylece non-core-assets-v0,
// doc-acceptance-frontend-v0, digital-fast-limit-cf-v0, disney-bonus-cfa-v0,
// dlyd-prdct-rstrctring-v0 ve investor-dps-mngmnt-v0 tasima listesine giriyordu.
// Kullanici ayni gun GERI ALDIRDI: "bu geliştirmeyi direkt geri alalım, -app-v ve
// -app-emb-v kuralı tekrar geçerli olsun."
//
// Gerekce, kuralin kendisinden daha onemli: SURUM EKI SPA'YA OZGU DEGIL. Bir API de
// "-v1" ile biter; ada bakarak SPA demek, uydurma bir olcute guvenmekti. Yanlis alarm
// uretmesi (ekranda "dizin eksik") tek basina zararsiz gorunse de, ekip listeye
// guvenemez hale gelir - ve guvenilmeyen liste, atlanan gercek bir tasimayi gizler.
//
// ── SIRADAKI: ada DEGIL, kanita bakmak ───────────────────────────────────────────────
// Kullanici: "elimde bir kod var, container'larin icinde Nginx process'i var mi yok mu
// diye bakiyor; bu sekilde bir uygulamanin SPA olup olmadigini gosteriyor."
//
// DOGRU OLCUT BUDUR: SPA, statik dosyalari nginx ile sunulan uygulamadir - container'da
// nginx process'inin BULUNMASI bunun kanitidir, adi ne olursa olsun. Betik gelince akis
// sudur: tarama sonucu bir tabloya yazilir, `isSpaApp` once O TABLOYA bakar, kayit YOKSA
// ad kalibina duser. "Taranmadi" ile "SPA degil" AYRI kalmali - olculmemis bir uygulamayi
// "SPA degil" saymak, tasimanin sessizce unutulmasi demek olurdu.
//
// Degisiklik TEK YERDEDIR: asagidaki iki fonksiyon. Bes cagiran dosyanin hicbirine
// dokunmak gerekmeyecek.
//
// (dbo.Openshift_Inventory yalnizca cluster/namespace/application tutuyor; "bu SPA mi"
// diyen bir sutun YOK - ada bakmak zorunda olmamizin sebebi bu.)
'use strict';

/** Kurumsal standart kalip: ad icinde "-app-v" / "-app-emb-v" GECER. */
const SPA_RE = /-app(-emb)?-v/i;

/** "app-ns.apps.fw.garanti.com.tr" -> "app-ns"; nokta yoksa dizginin kendisi. */
const labelOf = (s) =>
  String(s == null ? '' : s)
    .trim()
    .toLowerCase()
    .split('.')[0];

/**
 * UYGULAMA ADI icin: "bu uygulama SPA mi / yeni sunucuda dizin ister mi?"
 *
 * Nginx-process taramasi devreye girdiginde ONCE o kayda bakilacak, kayit yoksa buraya
 * dusulecek (bkz. dosya basligi).
 */
const isSpaApp = (app) => SPA_RE.test(String(app == null ? '' : app).trim());

/**
 * ROUTE ADRESI / ETIKET icin: "<app>-<ns>" kalibinda, uygulama adi henuz ayrilmamis.
 * Yalniz ILK ETIKETE bakar — "apps.fw.garanti.com.tr" kuyrugu her adreste ayni ve
 * alan adindan SPA cikarimi yapilmamali.
 *
 * isSpaApp ile AYNI kurali uyguluyor olmasi bugunku kuralin "icerir" tipinde olmasindan;
 * ikisi AYRI SORULAR oldugu icin ayri duruyorlar (uygulama adi vs. cozulmemis etiket) ve
 * nginx-process olcutu geldiginde yollari ayrilacak.
 */
const isSpaLabel = (s) => SPA_RE.test(labelOf(s));

/** Ekranda gosterilen kalip metni — kural degisirse BURASI da degisir. */
const SPA_PATTERN_LABEL = '-app-v / -app-emb-v';

module.exports = {
  SPA_RE,
  SPA_PATTERN_LABEL,
  labelOf,
  isSpaApp,
  isSpaLabel,
};
