// server/inventory/history-config.cjs — Envanter geçmişi: hangi tablo, hangi anahtar.
//
// NEDEN VAR (2026-09-07, kullanıcı isteği): "20 Ağustos'ta tablo nasıl görünüyordu,
// bugünle arasında ne fark var, hangi satırlar gelmiş" sorusu Portal'da cevaplanamıyordu.
// Envanter tablolarını dolduran Ansible loader'ları (bmw_inventory/...) her çalıştırmada
// TRUNCATE edip yeniden yazıyor; GEÇMİŞ HİÇBİR YERDE TUTULMUYOR. Elde yalnızca
// created_at/updated_at/last_seen_at var — bunlar "hâlâ duran" satırlar için bilgi verir
// ama KAYBOLAN satırlar tamamen yok olur. Bu yüzden geçmiş bugünden itibaren birikir;
// geriye dönük veri üretilemez.
//
// İKİ FARKLI TABLO TİPİ VAR:
//
//   mode: "snapshot"  → Kaynak tablo TRUNCATE/upsert ediliyor, geçmişi yok.
//                       Portal her gece SCD-2 (satır bazlı geçerlilik aralığı) yazar.
//   mode: "native"    → Tablo ZATEN gün gün biriktiriyor (scan_date ile APPEND).
//                       Kopyalamak veriyi iki kez saklamak olurdu; doğrudan okunur.
//
// HASH'TEN DIŞLANAN KOLONLAR — EN KRİTİK AYAR:
// last_seen_at HER başarılı taramada güncellenir. Hash'e dahil edilseydi her satır her
// gece "değişti" sayılır, geçmiş tablosu her gece tüm envanter kadar büyür ve "ne
// değişti" ekranı tamamen kullanılamaz hâle gelirdi. updated_at/created_at de verinin
// KENDİSİ değil, verinin metaverisidir — aynı gerekçeyle dışlanır.
'use strict';

/**
 * Her tabloda hash DIŞINDA tutulan kolonlar. Liste iki tür kolonu kapsar ve ikisi de
 * aynı sonucu doğurur: dahil edilirlerse HER satır HER gece "değişti" sayılır, geçmiş
 * tablosu her gece tüm envanter kadar büyür ve "ne değişti" ekranı kullanılamaz olur.
 *
 * 1) ZAMAN DAMGALARI — verinin kendisi değil, verinin metaverisi.
 *    last_seen_at her başarılı taramada güncellenir.
 *    loaded_at / inserted_at ise DEFAULT SYSUTCDATETIME() ile dolar; loader bu kolonları
 *    YAZMAZ ve tablo her çalıştırmada TRUNCATE edilip yeniden yazıldığı için değer her
 *    gece TAZEDİR. (2026-09-08'de dbo.Openshift_Inventory'de tam bu durum bulundu —
 *    `loaded_at` listede olmadığı için o tablonun geçmişi baştan bozuk toplanacaktı.)
 *
 * 2) YAPAY ANAHTAR — `id INT IDENTITY`. TRUNCATE + yeniden doldurmada numaralar baştan
 *    üretilir, yani aynı sunucu her gece başka bir id alır. Satır kimliği için zaten
 *    `key` alanındaki DOĞAL anahtar kullanılıyor; id'nin hash'te hiçbir işi yok.
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

// Anahtarlar loader'ların KENDİ DELETE/upsert ifadelerinden alındı — yani kaynağın
// "aynı satır" tanımıyla birebir aynı. Tahmin edilmedi:
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
    // Bu tablo TRUNCATE EDİLMİYOR: ratelimit_loader.py her taramada scan_date=bugün ile
    // APPEND ediyor (ve yalnızca aynı günün satırlarını silip yeniden yazıyor). Yani
    // geçmiş ZATEN DB'de. Snapshot almak aynı veriyi ikinci kez saklamak olurdu.
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
  // Anahtar bozuksa/boşsa koddaki DOGRULANMIS anahtara duselim — bos anahtarla
  // calismak tum satirlari tek bir anahtara toplar ve gecmisi bozar.
  if (!Array.isArray(key) || key.length === 0) key = fallback ? fallback.key : null;
  if (!key) return null;
  return {
    table: r.table_name,
    label: r.label || (fallback && fallback.label) || r.table_name,
    mode: r.mode === 'native' ? 'native' : 'snapshot',
    key,
    volatile: Array.isArray(volatile) && volatile.length ? volatile : COMMON_VOLATILE,
    dateColumn: fallback ? fallback.dateColumn : undefined,
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
 * Kaynak satır sayısı bir önceki başarılı çalıştırmaya göre bu oranın ALTINA düşerse
 * snapshot alınmaz. Bozuk/yarım bir tarama (ör. envanter job'ı hata alıp tabloyu yarım
 * doldurdu) binlerce satırı "silinmiş" diye geçmişe yazardı ve bu geri alınamazdı.
 * Loader'ların kendi eşik korumasıyla aynı mantık — bilinmezlik, veri kaybına yazılmaz.
 */
const MIN_ROW_RATIO = 0.5;

module.exports = {
  TABLES, getTable, snapshotTables, COMMON_VOLATILE, MIN_ROW_RATIO,
  effectiveTables, effectiveSnapshotTables, getEffectiveTable, invalidateCache,
};
