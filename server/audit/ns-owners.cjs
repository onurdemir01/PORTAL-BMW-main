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
//
// ONBELLEK (2026-11-13, SlowQuery: App_Owners 61k satir, uzun havuzda 25-237 sn): TTL 30 dk
// (tablolar gunde bir yazilir). Tek-ucus: ayni anda gelen cagrilar tek okumayi paylasir. Deger
// varsa (bayat olsa da) HEMEN doner, bayatsa arka planda tek yenileme baslar (kimse beklemez).
// Iki tablo paralel okunur. Yenilemede gecici hata ONCEKI iyi degeri korur; onceki deger yoksa
// sonuc doner ama onbellege alinmaz ve gecici dusen kaynak `appError` / `nsError: 'gecici'`
// alaniyla isaretlenir.
//
// INCELEME (2026-11-13):
//   - HAVUZ: okuma HER ZAMAN uzun havuzdan (queryLong, 180 sn) yapilir. Cagiranlarin cogu ana
//     havuz `query`'sini (30 sn) verir; App_Owners prod'da 25-237 sn surdugu icin ana havuzda
//     duser, tek-ucus da bu hatayi uzun havuz cagiranina (nginx-migration) gecirirdi. Verilen
//     fonksiyon mssql.cjs'nin ana `query`'si ise queryLong'a cevrilir; baska (test sahtesi,
//     zaten queryLong) ise oldugu gibi kullanilir.
//   - GERI CEKILME: onbellekte iyi deger varken basarisiz yenilemeden sonra GERI_CEKILME_MS icinde
//     yeni yenileme baslamaz (her istek yeni bir 61k satirlik okuma tetiklemesin). Onbellek YOKSA
//     geri cekilme yok: tablo geri gelince ilk istek hemen dogru sahibi almali (AO15); tek-ucus
//     ayni anda gelenleri yine tek okumada toplar.
//   - YAS: donen nesne `asOf` (ISO; deger yoksa null), `yasMs` ve `stale` (yas >= TTL ya da son
//     yenileme gecici dustu) tasir; bayat sahip verisi gorunur olur.
//   - BEKLE: loadNamespaceOwners(query, { bekle: true }) bayat degeri dondurmez, yenilemeyi bekler
//     (arka plan hesaplari - nginx-migration sicak onbellegi - bayat sahibi 60 dk saklamasin).
'use strict';

const TTL_MS = 30 * 60 * 1000;
let _cache = null;
let _cacheAt = 0;
let _inflight = null;
let _nesil = 0;
const GERI_CEKILME_MS = 2 * 60 * 1000;
let _sonHataAt = 0;

/** Ana havuz query'si verildiyse uzun havuza cevirir (yorum: HAVUZ). */
function okuyucu(query) {
  try {
    const m = require('../inventory/mssql.cjs');
    if (m && query === m.query && typeof m.queryLong === 'function') return m.queryLong;
  } catch {
    /* mssql modulu yok: verilen fonksiyon */
  }
  return query;
}

/** Donen nesneye yas bilgisi yazar (onbellek nesnesi paylasilir; alanlar her cagrida tazelenir). */
function yasli(o, at, hatali) {
  if (!o) return o;
  const yasMs = at ? Math.max(0, Date.now() - at) : null;
  o.asOf = at ? new Date(at).toISOString() : null;
  o.yasMs = yasMs;
  o.stale = !at || yasMs >= TTL_MS || !!hatali;
  return o;
}

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

/** Iki tabloyu PARALEL okur. { out, gecici } doner; asla firlatmaz. */
async function oku(query) {
  const nsP = query(
    `SELECT namespace, owner_group_name, owner_email, lookup_status
       FROM dbo.Openshift_Namespace_Owners`,
  ).then(
    (r) => ({ ok: true, map: indexOwners(r.recordset || []) }),
    // tablo yok / sorgu dustu: ready=false
    (e) => ({ ok: false, gecici: !tabloYok(e) }),
  );
  const appP = query(
    `SELECT cluster, namespace, application, owner_group_name, owner_email, kaynak,
            configuration_id, lookup_status, lookup_message
       FROM dbo.Openshift_App_Owners`,
  ).then(
    (r) => ({ ok: true, map: indexAppOwners(r.recordset || []) }),
    // tablo henuz yok (dagitim sirasi): eski davranis
    (e) => ({ ok: false, gecici: !tabloYok(e) }),
  );
  const [ns, app] = await Promise.all([nsP, appP]);
  // ready: en az bir sahiplik kaynagi okundu (ekran "veri yok" demesin). Uygulama tablosu
  // yokken bu birebir eski anlamdir (namespace tablosu okundu mu).
  const out = {
    ready: ns.ok || app.ok,
    nsReady: ns.ok,
    byNs: ns.ok ? ns.map : new Map(),
    appReady: app.ok,
    byApp: app.ok ? app.map : new Map(),
  };
  return { out, nsGecici: !!ns.gecici, appGecici: !!app.gecici };
}

/** Tek-ucus yenileme. Tam okuma onbellege girer; gecici dususte onceki iyi deger korunur. */
function yenile(query) {
  if (_inflight) return _inflight;
  const nesil = _nesil;
  const p = oku(okuyucu(query))
    .then(({ out, nsGecici, appGecici }) => {
      if (nesil !== _nesil) return out; // _resetCache arada cagrildi: eski sonuc yazilmaz
      if (!nsGecici && !appGecici) {
        _cache = out;
        _cacheAt = Date.now();
        _sonHataAt = 0;
        return yasli(out, _cacheAt, false);
      }
      _sonHataAt = Date.now();
      if (_cache) return yasli(_cache, _cacheAt, true);
      return yasli(
        {
          ...out,
          ...(appGecici ? { appError: 'gecici' } : {}),
          ...(nsGecici ? { nsError: 'gecici' } : {}),
        },
        0,
        true,
      );
    })
    .finally(() => {
      if (_inflight === p) _inflight = null;
    });
  _inflight = p;
  return p;
}

const geriCekilmede = () => _sonHataAt > 0 && Date.now() - _sonHataAt < GERI_CEKILME_MS;

/**
 * DB'den (onbellekli) yukler. query: mssql query(text) (ana havuz verilse de uzun havuz okunur).
 * @param {{bekle?: boolean}} [o]  bekle: bayat degeri dondurme, yenilemeyi bekle (arka plan hesaplari)
 */
async function loadNamespaceOwners(query, { bekle = false } = {}) {
  const hatali = _sonHataAt > 0;
  if (_cache) {
    if (Date.now() - _cacheAt >= TTL_MS) {
      if (_inflight || !geriCekilmede()) {
        const p = yenile(query);
        if (bekle) return p;
        p.catch((e) => console.warn('[ns-owners] arka plan yenileme hatasi:', e?.message));
      }
    }
    return yasli(_cache, _cacheAt, hatali);
  }
  return yenile(query);
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
    if (!o?.group) {
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
    const yedek = (() => { if (n && n.group) return n; if (a && a.group) return a; return null; })();
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
  _inflight = null;
  _sonHataAt = 0;
  _nesil += 1;
}

/** Test icin: onbellek yasini geri alir (TTL asimi); geri cekilme suresini de geri alir. */
function _yaslandir(ms) {
  _cacheAt -= ms;
  if (_sonHataAt) _sonHataAt -= ms;
}

module.exports = {
  loadNamespaceOwners,
  indexOwners,
  indexAppOwners,
  ownersFor,
  ownersForApp,
  KAYNAK_NAMESPACE,
  TTL_MS,
  GERI_CEKILME_MS,
  _resetCache,
  _yaslandir,
};
