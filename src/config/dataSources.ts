// src/config/dataSources.ts — modül başına veri kaynağı kataloğu.
//
// `SourceNote` bileşeni kaynağı PROP olarak alır; katalog burada, tek yerde
// durur. Bir iş adı değişirse ekranlar değil bu dosya güncellenir.
//
// ── BURADAKİ HER CÜMLE DOĞRULANMIŞ OLMALI ───────────────────────────────────
// Yanlış bir iş adı yazmak, notu hiç yazmamaktan KÖTÜDÜR: kullanıcı olmayan
// bir job'ı arar ve portala güveni azalır. Aşağıdaki girdiler kaynak koddan
// teyit edilerek yazıldı (dosya:satır referansları yorumlarda).
import type { DataSource } from '@/components/common/SourceNote';

/**
 * ScaleX cluster yetenek envanteri — `scalex_cluster_caps`.
 * Teyit: `server/scalex/cluster-caps.cjs`, `server/scalex/index.cjs` (capabilities modu).
 */
export const SCALEX_CAPS: DataSource = {
  job: 'scalex_discovery (capabilities)',
  what: 'scalex_cluster_caps — ölçeklenebilir CRD listesi ve okunamayan kaynaklar',
  refresh: 'Aşağıdaki “Tara” düğmesi; kapsam (ortam + tenant) seçip çalıştırın.',
};

/**
 * LogX OCP namespace/uygulama kataloğu.
 * Teyit: `server/logx/v2/ocp-inventory.cjs` (dbo.Openshift_Inventory, portal
 * DIŞINDA AWX'te zamanlanmış bir job yazar) ∪ `ocp-cache.cjs` (canlı keşif
 * sonuçlarının paylaşılan önbelleği).
 */
export const LOGX_OCP_CATALOG: DataSource = {
  job: 'openshift_inventory (AWX zamanlı) + logx_ocp_namespace_discovery (canlı)',
  what: 'dbo.Openshift_Inventory ∪ paylaşılan keşif önbelleği (cluster/namespace/uygulama)',
  refresh: 'Aradığınız namespace listede yoksa “Canlı tara” ile AWX keşfi başlatın; tam liste gece koşan envanter job’ından gelir.',
};

/**
 * Telnet/LogX/OpsX/ScaleX'in ORTAK cluster kataloğu — portal DB'sinde,
 * admin tarafından düzenlenir (AWX taraması DEĞİL).
 * Teyit: `server/logx/v2/admin.cjs` (`listClusterIndex`), Admin > OCP Yapılandırma.
 */
export const OCP_CLUSTER_INDEX: DataSource = {
  job: 'portal ayarı (tarama değil)',
  what: 'Admin > Otomasyon > OCP Yapılandırma > Cluster Hiyerarşisi tablosu',
  refresh: 'Bir cluster eksikse Admin > OCP Yapılandırma ekranından ekleyin; AWX job’ı beklemeye gerek yok.',
};

/**
 * ScaleX uygulama/iş yükü listesi — AWX'e DOKUNMAYAN katalog okuması.
 * Teyit: `src/components/scalex/steps/WorkloadStep.tsx` (loadCatalog notu) ve
 * `server/scalex/index.cjs` `/apps` ucu.
 *
 * Bu not ekranda YOKTU; kaynak yalnızca KOD YORUMUNDA yazılıydı — yani onu
 * yalnızca kodu okuyan biri görebiliyordu.
 */
export const SCALEX_APPS: DataSource = {
  job: 'openshift_inventory (AWX zamanlı) + ocp_app_cache (portal önbelleği)',
  what: 'dbo.Openshift_Inventory ∪ ocp_app_cache — yalnızca ad ve tip; replika/HPA CANLI DEĞİL',
  refresh: 'Replika, HPA ve geri alınabilirlik gibi CANLI alanlar yalnızca “Kontrol et” ile gelir.',
};

/**
 * ScaleX keşif SÜRE ölçümü — `scalex_discovery_timing`.
 * Teyit: `server/scalex/discovery-timing.cjs` (yazan yer:
 * `server/scalex/index.cjs` `/discover/:s/:j/status`, iş bittiğinde),
 * kaynak satır: `scalex_runner.sh` `TIMING;INFO;...`.
 */
export const SCALEX_TIMING: DataSource = {
  job: 'scalex_discovery (her keşif kendi süresini bildirir)',
  what: 'scalex_discovery_timing — cluster başına setup/keşif/toplam süre ve önbellek isabeti; iş başına kuyruk/açılış/hazırlık/taşıma/yayın kırılımı',
  refresh: 'Kendiliğinden dolar: her keşif işi bittiğinde bir satır yazılır. Elle tetiklenmez.',
};
