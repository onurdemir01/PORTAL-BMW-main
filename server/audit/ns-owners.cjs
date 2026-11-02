// server/audit/ns-owners.cjs - uygulama -> sorumlu ekip.
//
// Iki kaynak (TBMWANS, bmw_inventory/openshift_inventory akislari):
//   1. dbo.Openshift_App_Owners (2026-11-02): UYGULAMA basina sahip. CMDB Code Repository
//      (typeID 51) ya da ARK Application (typeID 997) kaydinin Agile Takim (17) / Yazilim
//      Gelistirme Sorumlusu (1) iliskisi -> Smart getgroupbyid. `kaynak` sutunu hangi yoldan
//      bulundugunu soyler: SI51_AGILE | SI51_YAZILIM | ARK997_AGILE | ARK997_YAZILIM |
//      NAMESPACE (uygulama icin CMDB'de bulunamadi, namespace sahibi yazildi) | YOK.
//   2. dbo.Openshift_Namespace_Owners: NAMESPACE basina sahip (eski tek kaynak). Uygulama
//      satiri yoksa ya da uygulama icin sahip bulunamadiysa YEDEK olarak kullanilir ve ekran
//      bunu "(namespace sahibi)" diye ayrica isaretler (kullanici, 2026-11-02: namespace
//      sahibini uygulamanin sahibi gibi yazmak geri donus almada sorun cikariyor;
//      "bulunamazsa namespace sahibi gosterilsin").
//
// Kullanici talebi (2026-09-14): Denetim > Nginx SPA'da uygulamanin yaninda ekip.
// Ayni harita Prod Tasima, SPA Raporu, Glomo gecis plani ve Intranet SPA'da da kullanilir.
//
// Namespace tablosu YOKSA ya da sorgu duserse: bos harita + ready=false. Ekran "ekip
// bilinmiyor" yerine "ekip verisi yok" der - ikisi farkli sey. Uygulama tablosu YOKSA
// (dagitim sirasi: Portal once cikabilir) appReady=false ve davranis birebir eskisi gibidir:
// ownersForApp kaynak bilgisi uretmez, sahip namespace'ten gelir.
//
// Namespace tablosu OKUNAMAZ ama uygulama tablosu okunursa (nsReady=false, ready=true): kendi
// uygulama sahibi ve yedegi olmayan namespace "bilinmiyor" (unknownNs) DEGIL "veri yok"
// (veriYokNs) sayilir - yedek kaynak hic okunmadi. Kaynaklardan biri HATAYLA okunamadiysa
// sonuc onbellege ALINMAZ (gecici dusus TTL boyunca "veri yok" gostermesin); tablo YOK
// (Invalid object name, 208) kalici durumdur, onbellege alinir.
'use strict';

const TTL_MS = 5 * 60 * 1000;
let _cache = null;
let _cacheAt = 0;

const L = (s) => String(s || '').trim().toLowerCase();

/** Namespace yedegi etiketi (uygulama tablosundaki ile ayni yazim). */
const KAYNAK_NAMESPACE = 'NAMESPACE';
// Uygulama icin GERCEK bir sahip uretmeyen kaynaklar: bu satirin grubu (varsa) namespace
// sahibidir ya da hic sahip yoktur.
const YEDEK_KAYNAK = new Set([KAYNAK_NAMESPACE, 'YOK', '']);

/** Ham satirlardan harita: ns(lower) -> {group, email, status}. */
function indexOwners(rows) {
  const byNs = new Map();
  for (const r of rows || []) {
    const ns = L(r.namespace);
    if (!ns) continue;
    byNs.set(ns, {
      group: String(r.owner_group_name || '').trim() || null,
      email: String(r.owner_email || '').trim() || null,
      status: String(r.lookup_status || '').trim() || 'BILINMIYOR',
    });
  }
  return byNs;
}

const appKey = (ns, app) => L(ns) + '/' + L(app);

/** Satir uygulamanin KENDI sahibini mi tasiyor (namespace yedegi / bos degil)? */
const uygulamaSahibiMi = (o) => !!(o && o.group && !YEDEK_KAYNAK.has(o.kaynak));

/**
 * Uygulama satirlarindan harita: "ns/app"(lower) -> {group, email, kaynak, status, message,
 * configurationId, cluster}. Ayni ns/app birden cok cluster'da olabilir: uygulamanin kendi
 * sahibini tasiyan satir, namespace yedegi / bos satira tercih edilir.
 */
function indexAppOwners(rows) {
  const byApp = new Map();
  for (const r of rows || []) {
    const ns = L(r.namespace);
    const app = L(r.application);
    if (!ns || !app) continue;
    const o = {
      group: String(r.owner_group_name || '').trim() || null,
      email: String(r.owner_email || '').trim() || null,
      kaynak: String(r.kaynak || '').trim().toUpperCase(),
      status: String(r.lookup_status || '').trim() || 'BILINMIYOR',
      message: String(r.lookup_message || '').trim(),
      configurationId: r.configuration_id == null ? null : String(r.configuration_id).trim() || null,
      cluster: String(r.cluster || '').trim() || null,
    };
    const k = ns + '/' + app;
    const prev = byApp.get(k);
    if (!prev || (!uygulamaSahibiMi(prev) && (uygulamaSahibiMi(o) || (!prev.group && o.group)))) {
      byApp.set(k, o);
    }
  }
  return byApp;
}

/** "Tablo yok" (dagitim sirasi) kalici durum; diger hatalar gecici. */
const tabloYok = (e) =>
  !!e && (Number(e.number) === 208 || /Invalid object name/i.test(String(e.message || '')));

/** DB'den (onbellekli) yukler. query: mssql query(text). */
async function loadNamespaceOwners(query) {
  if (_cache && Date.now() - _cacheAt < TTL_MS) return _cache;
  let ready = false;
  let gecici = false;
  let byNs = new Map();
  try {
    const r = await query(
      `SELECT namespace, owner_group_name, owner_email, lookup_status
         FROM dbo.Openshift_Namespace_Owners`,
    );
    byNs = indexOwners(r.recordset || []);
    ready = true;
  } catch (e) {
    /* tablo yok / sorgu dustu: ready=false */
    if (!tabloYok(e)) gecici = true;
  }
  let appReady = false;
  let byApp = new Map();
  try {
    const r = await query(
      `SELECT cluster, namespace, application, owner_group_name, owner_email, kaynak,
              configuration_id, lookup_status, lookup_message
         FROM dbo.Openshift_App_Owners`,
    );
    byApp = indexAppOwners(r.recordset || []);
    appReady = true;
  } catch (e) {
    /* tablo henuz yok (dagitim sirasi): eski davranis */
    if (!tabloYok(e)) gecici = true;
  }
  // ready: en az bir sahiplik kaynagi okundu (ekran "veri yok" demesin). Uygulama tablosu
  // yokken bu birebir eski anlamdir (namespace tablosu okundu mu).
  const out = { ready: ready || appReady, nsReady: ready, byNs, appReady, byApp };
  if (!gecici) {
    _cache = out;
    _cacheAt = Date.now();
  }
  return out;
}

/**
 * Bir uygulamanin (birden fazla ortamda birden fazla namespace'i olabilir) ekip ozeti -
 * YALNIZ namespace sahibine bakar (eski imza; ownersForApp uygulama sahibini de kullanir).
 * @returns {{groups:string[], emails:string[], unknownNs:string[]}}
 *   groups   : benzersiz AD grup adlari (bos = hicbir namespace icin sahip cozulmemis)
 *   unknownNs: haritada olmayan ya da grubu bos olan namespace'ler (gorunur kalsin)
 */
function ownersFor(byNs, namespaces) {
  const groups = [];
  const emails = [];
  const unknownNs = [];
  for (const ns0 of namespaces || []) {
    const ns = L(ns0);
    if (!ns) continue;
    const o = byNs.get(ns);
    if (!o || !o.group) {
      if (!unknownNs.includes(ns)) unknownNs.push(ns);
      continue;
    }
    if (!groups.includes(o.group)) groups.push(o.group);
    if (o.email && !emails.includes(o.email)) emails.push(o.email);
  }
  return { groups, emails, unknownNs };
}

/**
 * Uygulama sahibi, namespace yedegiyle.
 * @param {object}   owners      loadNamespaceOwners ciktisi ({ready, byNs, appReady, byApp})
 * @param {string}   app         uygulama adi (dbo.Openshift_Inventory.application)
 * @param {string[]} namespaces  uygulamanin namespace'leri (ortam basina)
 * @returns {{groups:string[], emails:string[], unknownNs:string[], veriYokNs:string[],
 *            kaynaklar:string[], nsSahibi:string[], appReady:boolean}}
 *   kaynaklar: groups ile AYNI SIRADA her grubun kaynagi (SI51_AGILE ... / NAMESPACE).
 *              appReady=false iken BOS dizi: kaynak bilinmiyor, ekran eskisi gibi gosterir.
 *   nsSahibi : sahibi namespace yedeginden gelen namespace'ler.
 *   veriYokNs: uygulama sahibi yok VE namespace tablosu okunamadi (nsReady=false): sahibi
 *              "bilinmiyor" degil, "veri yok" (yedek kaynak hic okunmadi).
 */
function ownersForApp(owners, app, namespaces) {
  const byNs = (owners && owners.byNs) || new Map();
  const appReady = !!(owners && owners.appReady && owners.byApp);
  if (!appReady || !L(app)) {
    // Uygulama tablosu yok (ya da uygulama adi yok): birebir eski davranis.
    return { ...ownersFor(byNs, namespaces), veriYokNs: [], kaynaklar: [], nsSahibi: [], appReady };
  }
  const byApp = owners.byApp;
  const groups = [];
  const kaynaklar = [];
  const emails = [];
  const unknownNs = [];
  const veriYokNs = [];
  const nsSahibi = [];
  // Namespace tablosu okunamadi (uygulama tablosu okundu): yedek bilinemez.
  const nsOkunamadi = owners.nsReady === false;
  const ekle = (group, email, kaynak) => {
    const i = groups.indexOf(group);
    if (i < 0) {
      groups.push(group);
      kaynaklar.push(kaynak);
    } else if (kaynaklar[i] === KAYNAK_NAMESPACE && kaynak !== KAYNAK_NAMESPACE) {
      // Ayni grup bir ortamda uygulama kaydindan da bulunduysa kaynak uygulamanindir.
      kaynaklar[i] = kaynak;
    }
    if (email && !emails.includes(email)) emails.push(email);
  };
  for (const ns0 of namespaces || []) {
    const ns = L(ns0);
    if (!ns) continue;
    const a = byApp.get(appKey(ns, app));
    if (uygulamaSahibiMi(a)) {
      ekle(a.group, a.email, a.kaynak);
      continue;
    }
    // YEDEK: namespace sahibi (namespace tablosu daha guncel; o yoksa uygulama satirinin
    // kendi yazdigi namespace sahibi).
    const n = byNs.get(ns);
    const yedek = n && n.group ? n : a && a.group ? a : null;
    if (!yedek) {
      const liste = nsOkunamadi ? veriYokNs : unknownNs;
      if (!liste.includes(ns)) liste.push(ns);
      continue;
    }
    ekle(yedek.group, yedek.email, KAYNAK_NAMESPACE);
    if (!nsSahibi.includes(ns)) nsSahibi.push(ns);
  }
  return { groups, emails, unknownNs, veriYokNs, kaynaklar, nsSahibi, appReady };
}

function _resetCache() {
  _cache = null;
  _cacheAt = 0;
}

module.exports = {
  loadNamespaceOwners,
  indexOwners,
  indexAppOwners,
  ownersFor,
  ownersForApp,
  KAYNAK_NAMESPACE,
  _resetCache,
};
