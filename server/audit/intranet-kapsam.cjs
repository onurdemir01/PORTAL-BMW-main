// server/audit/intranet-kapsam.cjs - Nginx Hub > Kapsam & Tasima'nin intranet kurulum hucresi =
// Nginx ARK SPA > Intranet SPA ile AYNI hesap (2026-10-19).
//
// Kullanici: "Kapsamin eslesmesini duzeltelim lutfen, farkli sayfada farkli veri gozukmesi bizim
// yanlis raporlama yapmamiza sebep oluyor." (Intranet SPA'da 95 kurulmamis, Kapsam'da 50.)
// Onceki hesap (nginx-intranet.cjs coverageForEnv) dort yerde ayrisiyordu:
//   SPA tanimi  ad kalibi (-app-v)                -> Intranet SPA: pod'da nginx (Gercek SPA Kesfi)
//   ag          route envanteri, ada gore          -> kesfin kendi route termination'i
//   eslesme     yalniz uygulama ADI                -> (namespace, uygulama), '-prod' eksiz ns
//   "tam"       ortamin HERHANGI bir sunucusunda   -> ortamin TARANAN HER intranet sunucusunda
// Artik hucre ve tikla-listesi Intranet SPA raporunun SATIRLARINDAN uretilir (ayni onbellek):
// sayilar tanim geregi ayni. Bu modul yalniz donusturur, veritabani yok.
'use strict';

const { envOfHost } = require('./nginx-hosts.cjs');

const PARCA = [
  ['hys', 'hysdeploy'],
  ['app', 'applications'],
  ['conf', 'conf'],
];
const sortTr = (a, b) => a.localeCompare(b, 'tr');
const sirala = (a, b) => sortTr(a.application, b.application) || sortTr(a.namespace, b.namespace);

/** Rapor satir uretebildi mi (kesif tablosu var, satir dizisi geldi). */
function raporHazir(rapor) {
  return !!(rapor && rapor.ok && !rapor.notScanned && Array.isArray(rapor.rows));
}

/** Raporun hucreye cevrilemedigi durumun nedeni (ekranda yazilir). */
function raporHatasi(rapor, hata) {
  if (hata) return `Intranet SPA raporu okunamadı: ${hata}`;
  if (!rapor) return 'Intranet SPA raporu okunamadı.';
  if (rapor.notScanned) return rapor.message || 'Gerçek SPA Keşfi tablosu yok.';
  return 'Intranet SPA raporu okunamadı.';
}

/** Rapor yokken hucre: OLCULEMEDI (eski ad kalibi hesabina DONULMEZ - iki ekran yine ayrisirdi). */
function olculemediHucre(neden) {
  return {
    alanlar: {
      intranetKaynak: 'intranet-spa',
      intranetKaynakHata: neden,
      intranetKurulumToplam: 0,
      measuredIntranet: false,
      intranetFull: 0,
      intranetPartialCount: 0,
      intranetPartial: [],
      intranetMissingCount: 0,
      intranetMissing: [],
      intranetOlculemediCount: 0,
      intranetSunucuYokCount: 0,
      intranetOnlyOnServerCount: 0,
      intranetOnlyOnServer: [],
      intranetHosts: [],
      intranetCoverage: null,
    },
    detay: [],
  };
}

/**
 * Bir ortamin intranet kurulum hucresi (Kapsam satirinin alanlari) + tikla-listesi.
 * @param {object}   rapor    loadIntranet ciktisi (raporHazir)
 * @param {string}   env      'PROD', 'TEST' ...
 * @param {Function} ownerOf  (namespaces[]) => OwnerCell sekli ({groups, emails, unknownNs, namespaces})
 * @param {number}   [cap]
 */
function intranetHucresi(rapor, env, ownerOf, cap = 300) {
  const rows = rapor.rows.filter((r) => r.env === env);
  const kova = (d) => rows.filter((r) => r.kurulum && r.kurulum.durum === d).sort(sirala);
  const tamam = kova('tamam');
  const kismi = kova('kismi');
  const yok = kova('yok');
  const olculen = tamam.length + kismi.length + yok.length;
  // OLCULEBILIRLIK raporla ayni: ortamin intranet sunucularindan en az biri son taramada var.
  // Dizin okunamadiysa raporun taranmayanSunucu'su listenin TAMAMIDIR (buildIntranetRapor).
  // Ortam listesi ayrica genisletilmez: rapor ortami envOfNamespace'ten gelir, Kapsam'in ENVS'i.
  const taranmayan = new Set(rapor.taranmayanSunucu || []);
  const taranan = (rapor.intranetSunuculari || []).filter((h) => envOfHost(h) === env && !taranmayan.has(h));
  const eksikler = (r) =>
    r.kurulum.sunucular
      .filter((s) => s.status !== 'OK')
      .map((s) => ({ host: s.host, missing: PARCA.filter(([k]) => !s[k]).map(([, ad]) => ad) }));
  const detay = (r, kind) => ({
    app: r.application,
    namespaces: [r.namespace],
    owner: { ...ownerOf([r.namespace]), namespaces: [r.namespace] },
    kind,
    namespace: r.namespace,
    ...(kind === 'partial' ? { hosts: eksikler(r) } : {}),
  });
  const fazla = (rapor.sunucudaFazla || []).filter((f) => f.env === env);
  return {
    alanlar: {
      intranetKaynak: 'intranet-spa',
      intranetKaynakHata: rapor.dizinDurum === 'var' ? '' : 'Intranet dizin taraması (Nginx_Intranet_Audit) okunamadı.',
      // PAYDA: ortamin intranet SPA satirlari (Intranet SPA sayfasindaki "uygulama").
      intranetKurulumToplam: rows.length,
      measuredIntranet: taranan.length > 0,
      intranetFull: tamam.length,
      intranetPartialCount: kismi.length,
      intranetPartial: kismi
        .slice(0, cap)
        .map((r) => ({ app: r.application, namespace: r.namespace, hosts: eksikler(r) })),
      intranetMissingCount: yok.length,
      intranetMissing: yok.slice(0, cap).map((r) => r.application),
      // Ayri kovalar: "kurulmamis" SAYILMAZ.
      intranetOlculemediCount: rows.filter((r) => r.kurulum && r.kurulum.durum === 'olculemedi').length,
      intranetSunucuYokCount: rows.filter((r) => r.kurulum && r.kurulum.durum === 'sunucu-yok').length,
      intranetOnlyOnServerCount: fazla.length,
      intranetOnlyOnServer: fazla.slice(0, cap).map((f) => `${f.namespace}/${f.application}`),
      intranetHosts: taranan,
      intranetCoverage: olculen ? Math.round((tamam.length / olculen) * 1000) / 10 : null,
    },
    // Tikla-listesi: hic kurulmamis + yarim (OwnerCell sekli, Kapsam'in eski listesiyle ayni).
    detay: [...yok.slice(0, cap).map((r) => detay(r, 'missing')), ...kismi.slice(0, cap).map((r) => detay(r, 'partial'))],
  };
}

module.exports = { raporHazir, raporHatasi, olculemediHucre, intranetHucresi };
