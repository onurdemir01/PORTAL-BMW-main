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

/** Her tabloda dışlanan ortak metaveri kolonları (bkz. yukarıdaki not). */
const COMMON_VOLATILE = ['created_at', 'updated_at', 'last_seen_at'];

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

/**
 * Kaynak satır sayısı bir önceki başarılı çalıştırmaya göre bu oranın ALTINA düşerse
 * snapshot alınmaz. Bozuk/yarım bir tarama (ör. envanter job'ı hata alıp tabloyu yarım
 * doldurdu) binlerce satırı "silinmiş" diye geçmişe yazardı ve bu geri alınamazdı.
 * Loader'ların kendi eşik korumasıyla aynı mantık — bilinmezlik, veri kaybına yazılmaz.
 */
const MIN_ROW_RATIO = 0.5;

module.exports = { TABLES, getTable, snapshotTables, COMMON_VOLATILE, MIN_ROW_RATIO };
