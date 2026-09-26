// src/api/nginxMigrationApi.ts — "Production Taşımaları > Tanım oluştur".
//
// Eski GBRVP* sunucusundaki bir proxy_pass location'ını yeni prod SPA sunucularında SPA
// tanımı olarak oluşturan AWX job'ını tetikler. Playbook:
//   gar_bmt_ansible_scripts/bmw_nginx/nginx_ops/nginx_prod_migration.yml
import { safeJson } from "./http";

const BASE = "/api/nginx-migration";

export interface NginxMigrationConfig {
  awxServerId: number;
  /** nginx_ops/nginx_prod_migration.yml (Tanım oluştur) */
  templateId: number;
  /** nginx_ops/nginx_ops.yml (Eski tanımı kaldır: action=delete, env=prod — 23:00'e zamanlanır) */
  deleteTemplateId?: number;
}

export interface NginxMigrationJobStatus {
  ok: boolean;
  status: string;
  output: string;
  finished?: string | null;
  failed?: boolean;
  message?: string;
}

export interface NginxMigrationCreateResult {
  ok: boolean;
  job?: { id?: number | null; status?: string; [k: string]: unknown };
  awxServerId?: number;
  extraVars?: Record<string, string>;
  targetHosts?: string[];
  message?: string;
  /** true = bu is paketi OpenShift'ten cekerek basladi */
  fetchPackage?: boolean;
  /** paketin cekildigi OpenShift cluster'i (envanterden cozuldu, tahmin degil) */
  ocpCluster?: string;
  /** true = is sunuculara dokunmadi, kendini 23:00 kesinti penceresine zamanladi */
  scheduled?: boolean;
}

export interface NginxMigrationDeleteResult {
  ok: boolean;
  job?: { id?: number | null; status?: string; [k: string]: unknown };
  awxServerId?: number;
  extraVars?: Record<string, string>;
  oldHosts?: string[];
  scheduled?: boolean;
  message?: string;
}

export const nginxMigrationApi = {
  config: (): Promise<{ ok: boolean; config: NginxMigrationConfig }> =>
    fetch(`${BASE}/config`).then(safeJson),

  // Tetiklenen job'in canli durumu + stdout'u (izleme penceresi, 2026-09-18). Sunucu terminal
  // durumu takip tablosuna da isler - ekran "tanim olusturuldu / job hatali" gosterir.
  jobStatus: (jobId: number): Promise<NginxMigrationJobStatus> =>
    fetch(`${BASE}/job-status/${jobId}`).then(safeJson),

  remove: (body: {
    group: string;
    namespace: string;
    application: string;
    service: string;
    inputPath: string;
  }): Promise<NginxMigrationDeleteResult> =>
    fetch(`${BASE}/delete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then(safeJson),

  saveConfig: (cfg: NginxMigrationConfig): Promise<{ ok: boolean; message?: string }> =>
    fetch(`${BASE}/config`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(cfg),
    }).then(safeJson),

  create: (body: {
    group: string;
    namespace: string;
    application: string;
    service: string;
    inputPath: string;
    /** true = tanım zaten varken BİLEREK yeniden oluştur (bozuk tanımı düzeltmek için) */
    force?: boolean;
    /** true = paketi önce OpenShift'teki çalışan pod'dan çek (deployment hiç geçmemiş SPA'lar) */
    fetchPackage?: boolean;
    /** pod içindeki web kök dizini; boş bırakılırsa playbook index.html'e bakarak KEŞFEDER */
    podWebroot?: string;
  }): Promise<NginxMigrationCreateResult> =>
    fetch(`${BASE}/create`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then(safeJson),
};

// ── Gecis takibi ────────────────────────────────────────────────────────────────────
export type MigrationTrackState = 'none' | 'planned' | 'migrated' | 'cancelled';

export interface MigrationTracking {
  group: string;
  namespace: string;
  application: string;
  state: MigrationTrackState;
  plannedDate: string | null;
  migratedDate: string | null;
  note: string | null;
  /** "Tanım oluştur" ile başlatılan son job */
  configJobId: number | null;
  configCreatedAt: string | null;
  configCreatedBy: string | null;
  /** AWX durumu (pending/running/successful/failed…) — sunucu job-status/uzlaştırma ile yazar */
  configJobStatus?: string | null;
  configJobFinishedAt?: string | null;
  /** job'ın oluşturduğu (servis, location) — tarama doğrulayana kadar chip'te "oluşturuldu" */
  configService?: string | null;
  configLocation?: string | null;
  deleteJobStatus?: string | null;
  /** "Eski tanımı kaldır" ile başlatılan son job (23:00'e zamanlanır) */
  deleteJobId?: number | null;
  deleteRequestedAt?: string | null;
  deleteRequestedBy?: string | null;
  updatedBy: string | null;
  updatedAt: string | null;
}

/**
 * YOL BAZINDA tanim job'i (2026-09-23): "Tanim olustur" dugmesi, o (servis, location) icin
 * tanim ZATEN olusturulduysa pasif olur. Uygulama basina tek satir tutan `MigrationTracking`
 * cok yollu uygulamalarda son yolu ezdigi icin ayri kayit tutulur.
 */
export interface MigrationPathJob {
  group: string;
  namespace: string;
  application: string;
  service: string;
  location: string;
  jobId: number | null;
  status: string | null;
  createdAt: string | null;
  createdBy: string | null;
  finishedAt: string | null;
}

export const nginxMigrationScanApi = {
  /**
   * Tarama tazeleme (2026-09-24): gunluk nginx_config_audit isini SIMDI, yalniz verilen
   * sunucular icin kosturur. Yeni acilan bir tanim ertesi gunu beklemeden ekrana duser.
   */
  rescan: (hosts: string[], label?: string): Promise<{ ok: boolean; jobId?: number | null; awxServerId?: number; message?: string }> =>
    fetch(`${BASE}/rescan`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ hosts, label }),
    }).then(safeJson),
};

export const nginxMigrationTrackingApi = {
  list: (): Promise<{ ok: boolean; rows: MigrationTracking[]; pathJobs?: MigrationPathJob[]; message?: string }> =>
    fetch(`${BASE}/tracking`).then(safeJson),

  /**
   * TOPLU kayit (2026-09-24): ayni durum/tarih/not birden fazla uygulamaya yazilir.
   * Dogrulama once TUM ogeler icin yapilir - biri gecersizse HICBIRI yazilmaz.
   */
  saveBulk: (body: {
    items: { group: string; namespace: string; application: string }[];
    state: MigrationTrackState;
    plannedDate?: string | null;
    migratedDate?: string | null;
    note?: string | null;
  }): Promise<{ ok: boolean; written?: number; failed?: { namespace: string; application: string; message: string }[]; rows?: MigrationTracking[]; message?: string }> =>
    fetch(`${BASE}/tracking/bulk`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then(safeJson),

  save: (body: {
    group: string;
    namespace: string;
    application: string;
    state: MigrationTrackState;
    plannedDate?: string | null;
    migratedDate?: string | null;
    note?: string | null;
  }): Promise<{ ok: boolean; row?: MigrationTracking; message?: string }> =>
    fetch(`${BASE}/tracking`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then(safeJson),
};
