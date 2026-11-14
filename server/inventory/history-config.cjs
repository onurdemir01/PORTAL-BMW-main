// server/inventory/history-config.cjs — Envanter gecmisi: hangi tablo, hangi anahtar.
//
// NEDEN VAR (2026-09-07, kullanici istegi): "20 Agustos'ta tablo nasil gorunuyordu,
// bugunle arasinda ne fark var, hangi satirlar gelmis" sorusu Portal'da cevaplanamiyordu.
// Envanter tablolarini dolduran Ansible loader'lari (bmw_inventory/...) her calistirmada
// TRUNCATE edip yeniden yaziyor; GECMIS HICBIR YERDE TUTULMUYOR. Elde yalnizca
// created_at/updated_at/last_seen_at var — bunlar "hâlâ duran" satirlar icin bilgi verir
// ama KAYBOLAN satirlar tamamen yok olur. Bu yuzden gecmis bugunden itibaren birikir;
// geriye donuk veri uretilemez.
//
// IKI FARKLI TABLO TIPI VAR:
//
//   mode: "snapshot"  → Kaynak tablo TRUNCATE/upsert ediliyor, gecmisi yok.
//                       Portal her gece SCD-2 (satir bazli gecerlilik araligi) yazar.
//   mode: "native"    → Tablo ZATEN gun gun biriktiriyor (scan_date ile APPEND).
//                       Kopyalamak veriyi iki kez saklamak olurdu; dogrudan okunur.
//
// HASH'TEN DISLANAN KOLONLAR — EN KRITIK AYAR:
// last_seen_at HER basarili taramada guncellenir. Hash'e dahil edilseydi her satir her
// gece "degisti" sayilir, gecmis tablosu her gece tum envanter kadar buyur ve "ne
// degisti" ekrani tamamen kullanilamaz hâle gelirdi. updated_at/created_at de verinin
// KENDISI degil, verinin metaverisidir — ayni gerekceyle dislanir.
'use strict';

/**
 * Her tabloda hash DISINDA tutulan kolonlar. Liste iki tur kolonu kapsar ve ikisi de
 * ayni sonucu dogurur: dahil edilirlerse HER satir HER gece "degisti" sayilir, gecmis
 * tablosu her gece tum envanter kadar buyur ve "ne degisti" ekrani kullanilamaz olur.
 *
 * 1) ZAMAN DAMGALARI — verinin kendisi degil, verinin metaverisi.
 *    last_seen_at her basarili taramada guncellenir.
 *    loaded_at / inserted_at ise DEFAULT SYSUTCDATETIME() ile dolar; loader bu kolonlari
 *    YAZMAZ ve tablo her calistirmada TRUNCATE edilip yeniden yazildigi icin deger her
 *    gece TAZEDIR. (2026-09-08'de dbo.Openshift_Inventory'de tam bu durum bulundu —
 *    `loaded_at` listede olmadigi icin o tablonun gecmisi bastan bozuk toplanacakti.)
 *
 * 2) YAPAY ANAHTAR — `id INT IDENTITY`. TRUNCATE + yeniden doldurmada numaralar bastan
 *    uretilir, yani ayni sunucu her gece baska bir id alir. Satir kimligi icin zaten
 *    `key` alanindaki DOGAL anahtar kullaniliyor; id'nin hash'te hicbir isi yok.
 *    (dbo.Openshift_Inventory ve dbo.WASAppsInventory'de var.)
 */
const COMMON_VOLATILE = [
  'id',
  'created_at',
  'updated_at',
  'last_seen_at',
  'loaded_at',
  'inserted_at',
];

// Anahtarlar loader'larin KENDI DELETE/upsert ifadelerinden alindi — yani kaynagin
// "ayni satir" tanimiyla birebir ayni. Tahmin edilmedi:
//   Inventory                     -> inventory_loader.py, old_by_key host ile kurulur
//   MWAppsInventory               -> DELETE ... WHERE host=? AND app=? AND app_path=?
//   BMW_Certificates_Inventory    -> DELETE ... WHERE env=? AND host=? AND conf_file=? AND cert_file=?
//   Openshift_Inventory           -> INSERT (cluster, namespace, application)
//   NginxRateLimitInventory       -> PK (host, config_file, api_location) + scan_date
const TABLES = [
  {
    table: 'Inventory',
    label: 'Sunucular',
    mode: 'snapshot',
    key: ['host'],
    volatile: COMMON_VOLATILE,
  },
  {
    table: 'MWAppsInventory',
    label: 'JBoss Uygulamaları',
    mode: 'snapshot',
    key: ['host', 'app', 'app_path'],
    volatile: COMMON_VOLATILE,
  },
  {
    table: 'BMW_Certificates_Inventory',
    label: 'Sertifikalar',
    mode: 'snapshot',
    key: ['env', 'host', 'conf_file', 'cert_file'],
    volatile: COMMON_VOLATILE,
  },
  {
    table: 'Openshift_Inventory',
    label: 'OpenShift Uygulamaları',
    mode: 'snapshot',
    key: ['cluster', 'namespace', 'application'],
    volatile: COMMON_VOLATILE,
  },
  {
    // Bu tablo TRUNCATE EDILMIYOR: ratelimit_loader.py her taramada scan_date=bugun ile
    // APPEND ediyor (ve yalnizca ayni gunun satirlarini silip yeniden yaziyor). Yani
    // gecmis ZATEN DB'de. Snapshot almak ayni veriyi ikinci kez saklamak olurdu.
    table: 'NginxRateLimitInventory',
    label: 'Nginx Rate Limit',
    mode: 'native',
    dateColumn: 'scan_date',
    key: ['host', 'config_file', 'api_location'],
    volatile: ['id', 'inserted_at'],
  },
];

const BY_NAME = new Map(TABLES.map((t) => [t.table.toLowerCase(), t]));

function getTable(name) {
  return BY_NAME.get(String(name || '').toLowerCase()) || null;
}

function snapshotTables() {
  return TABLES.filter((t) => t.mode === 'snapshot');
}

// ── DB'den yonetilen kapsam ───────────────────────────────────────────────────────
// Yukaridaki TABLES artik yalnizca VARSAYILAN ve YEDEK: gercek kapsam
// `inventory_history_config` tablosundan gelir (Admin > Envanter Gorunurlugu).
// DB okunamazsa koddaki listeye DUSULUR — bir DB hiccup'i yuzunden gecmis toplama
// tamamen durmasin; kaybedilen gun geriye donuk uretilemez.
let _cache = null;
let _cacheAt = 0;
const CACHE_TTL = 60_000;

function normalizeRow(r) {
  const fallback = getTable(r.table_name);
  let key = [];
  let volatile = null;
  try {
    key = JSON.parse(r.key_columns || '[]');
  } catch {
    key = [];
  }
  try {
    volatile = r.volatile_columns ? JSON.parse(r.volatile_columns) : null;
  } catch {
    volatile = null;
  }
  // Anahtar bozuksa/bossa koddaki DOGRULANMIS anahtara duselim — bos anahtarla
  // calismak tum satirlari tek bir anahtara toplar ve gecmisi bozar.
  if (!Array.isArray(key) || key.length === 0) key = (fallback?.key ?? null);
  if (!key) return null;
  return {
    table: r.table_name,
    label: r.label || (fallback?.label) || r.table_name,
    mode: r.mode === 'native' ? 'native' : 'snapshot',
    key,
    volatile: Array.isArray(volatile) && volatile.length ? volatile : COMMON_VOLATILE,
    dateColumn: fallback?.dateColumn,
  };
}

/** Gecerli (ACIK) kapsam. DB'den okur, olmazsa koddaki varsayilanlara duser. */
async function effectiveTables() {
  if (_cache && Date.now() - _cacheAt < CACHE_TTL) return _cache;
  try {
    const { rows } = await require('../db/index.cjs').query(
      `SELECT table_name, label, mode, key_columns, volatile_columns, enabled
       FROM inventory_history_config`,
    );
    const list = rows
      .filter((r) => r.enabled === true || r.enabled === 1)
      .map(normalizeRow)
      .filter(Boolean);
    // Tablo BOS ise (henuz seed edilmemis) koddaki varsayilanlar kullanilir; aksi halde
    // ilk boot'ta hicbir tablonun gecmisi tutulmaz ve o gun kaybedilirdi.
    _cache = list.length ? list : TABLES;
    _cacheAt = Date.now();
    return _cache;
  } catch (e) {
    console.warn('[EnvanterGecmis] kapsam DB\'den okunamadi, kod varsayilanlari:', e.message);
    return TABLES;
  }
}

async function effectiveSnapshotTables() {
  return (await effectiveTables()).filter((t) => t.mode === 'snapshot');
}

async function getEffectiveTable(name) {
  const n = String(name || '').toLowerCase();
  return (await effectiveTables()).find((t) => t.table.toLowerCase() === n) || null;
}

function invalidateCache() {
  _cache = null;
  _cacheAt = 0;
}

/**
 * Kaynak satir sayisi bir onceki basarili calistirmaya gore bu oranin ALTINA duserse
 * snapshot alinmaz. Bozuk/yarim bir tarama (or. envanter job'i hata alip tabloyu yarim
 * doldurdu) binlerce satiri "silinmis" diye gecmise yazardi ve bu geri alinamazdi.
 * Loader'larin kendi esik korumasiyla ayni mantik — bilinmezlik, veri kaybina yazilmaz.
 */
const MIN_ROW_RATIO = 0.5;

module.exports = {
  TABLES, getTable, snapshotTables, COMMON_VOLATILE, MIN_ROW_RATIO,
  effectiveTables, effectiveSnapshotTables, getEffectiveTable, invalidateCache,
};
