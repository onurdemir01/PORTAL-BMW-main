// src/api/telnetApi.ts — Telnet (Uygulama Sunucularında Bağlantı Testi) istemcisi.
//
// OpsX'in aynı Legacy/Openshift + uygulama/sunucu seçim akışının birebir kopyası —
// uygulama listesi/host listesi/cluster kataloğu OpsX/LogX ile AYNI kaynaktan gelir
// (backend server/telnet/index.cjs OpsX'in hostsForApp'ini yeniden kullanır).
import { safeJson } from "./http";

const BASE = "/api/telnet";

export type TelnetPlatform = "legacy" | "openshift";

export interface TelnetHost {
  host: string;
  env: string;
  jbossVersion: string;
  status: string;
}

export interface TelnetRunResult {
  ok: boolean;
  jobId: number | null;
  status: string | null;
  awxServerId: number;
  templateId: number;
  sentBody: { limit?: string; extra_vars: Record<string, unknown> };
  // ok:false ise backend'in ürettiği hata metni — ÇAĞIRAN BUNU KONTROL ETMELİ (safeJson()
  // 4xx/5xx'te reddetmez, bkz. src/api/http.ts ve OpsX'teki aynı desen/opsxApi.ts).
  message?: string;
}

/** Playbook'un `set_stats` ile yayinladigi SONUC SOZLESMESI (bkz.
 *  server/ansible/playbooks/ocp_telnet_control.yml son play'i).
 *
 *  NEDEN VAR: playbook AÇIK/KAPALI satirlarini yalnizca `debug` mesaji olarak
 *  uretiyordu ve portal bunlari HIC okumuyordu. Sonuc: tum portlar KAPALI olsa bile
 *  AWX job'i `successful` dondugu icin ekranda YESIL TIK cikiyordu — "sonuc yok"tan
 *  kotu, cunku aktif olarak YANLIS bilgi veriyordu. */
export interface TelnetTargetResult {
  cluster: string;
  bastion: string;
  namespace: string;
  ip: string;
  port: string;
  /** `error` = test YAPILAMADI (pod acilamadi/hazir olmadi). `closed` ile AYNI SEY DEGIL. */
  state: "open" | "closed" | "error";
  rc: number;
  detail: string;
}

export interface TelnetResult {
  overallStatus: "open" | "partial" | "closed" | "error";
  target: { host: string; port: string };
  counts: { total: number; open: number; closed: number; error: number };
  targets: TelnetTargetResult[];
}

export interface TelnetJobStatus {
  ok: boolean;
  status: string;
  output: string;
  finished?: string;
  failed?: boolean;
  /** Playbook AWX'e henuz kopyalanmadiysa ya da is bitmediyse null. */
  result?: TelnetResult | null;
}

export const telnetApi = {
  searchApps: (search: string): Promise<{ ok: boolean; apps: string[]; fallbackMode: boolean }> =>
    fetch(`${BASE}/apps?search=${encodeURIComponent(search)}`).then(safeJson),

  getHosts: (app: string): Promise<{ ok: boolean; hosts: TelnetHost[] }> =>
    fetch(`${BASE}/hosts?app=${encodeURIComponent(app)}`).then(safeJson),

  getClusters: (): Promise<{ ok: boolean; tree: Record<string, Record<string, string[]>> }> =>
    fetch(`${BASE}/clusters`).then(safeJson),

  // Openshift_Inventory'den, seçilen env/tenant'a ait cluster'larda GÖRÜLMÜŞ namespace'ler
  // (erişim kısıtlamaları uygulanmış) — OpsX'in AYNI kaynağı (server/opsx/index.cjs
  // namespacesForCluster, doğrudan yeniden kullanılır).
  getOcpNamespaces: (env: string, tenant: string): Promise<{ ok: boolean; namespaces: string[] }> =>
    fetch(`${BASE}/ocp/namespaces?env=${encodeURIComponent(env)}&tenant=${encodeURIComponent(tenant)}`).then(safeJson),

  // Testi tetikler. AWX job template'i tanımlı değilse sunucu 501 + açıklayıcı mesaj döner.
  // Legacy ve Openshift AYNI şekli döner (TelnetRunResult, tek job) — Openshift'te birden
  // fazla namespace seçilse bile TEK job tetiklenir, playbook (cluster x namespace) çapraz
  // çarpımını kendi içinde işler (bkz. server/telnet/index.cjs dosya başı notu).
  run: (body: {
    platform: TelnetPlatform;
    // Legacy alanları
    application?: string;
    hosts?: string[];
    // Openshift alanları
    env?: string;
    tenant?: string;
    namespaces?: string[];
    // Tenant/env grubundaki GERÇEK cluster'lardan (bkz. getClusters) TEK birinin adı — YA DA
    // "" (boş, "Tüm cluster'lar" seçilirse; bkz. OcpClusterPickStep.tsx). OpsX Openshift
    // Rollout'la AYNI UX, ama AWX `limit`e ihtiyaç duymaz (bkz. server/telnet/index.cjs).
    cluster?: string;
    // Ortak
    ip: string;
    port: string;
  }): Promise<TelnetRunResult> =>
    fetch(`${BASE}/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then(safeJson),

  jobStatus: (serverId: number, jobId: number): Promise<TelnetJobStatus> =>
    fetch(`${BASE}/job-status/${serverId}/${jobId}`).then(safeJson),

  // Calisan testi durdurur. Telnet OCP cluster'inda GECICI POD actigi icin yanlis bir
  // IP/port girildiginde iptal edebilmek gercek bir ihtiyac (is, her birim icin 60 sn
  // pod bekleme + 10 sn telnet timeout suresince surer).
  cancel: (serverId: number, jobId: number): Promise<{ ok: boolean; message?: string }> =>
    fetch(`${BASE}/cancel/${serverId}/${jobId}`, { method: "POST" }).then(safeJson),
};
