// src/components/logx_v2/LogXWizardPage.tsx — LogX v2 sihirbazı: platform seçimi →
// Legacy/OpenShift akışı → indirme. Durum HER ZAMAN server'daki logx_v2_requests.state'ten
// senkronize edilir (client kendi gerçeğini icat etmez) — sayfa yenilemesi sonrası
// `?logxRequest=<id>` üzerinden kaldığı yerden devam eder (bkz. plan dosyası I. bölümü).
import React, { useCallback, useEffect, useState } from "react";
import { ExclamationTriangleIcon, ArrowLeftIcon } from "@heroicons/react/24/outline";
import {
  logxV2Api, type Platform, type LogXv2Request, type LogXv2Job, type DownloadInfo,
  type LegacyDiscoveryResult, type OcpNamespaceDiscoveryResult,
} from "@/api/logxV2Api";
import PlatformStep from "./steps/PlatformStep";
import AppSearchStep from "./steps/legacy/AppSearchStep";
import FileSelectionStep from "./steps/legacy/FileSelectionStep";
import ClusterSelectStep from "./steps/ocp/ClusterSelectStep";
import NamespaceStep from "./steps/ocp/NamespaceStep";
import NamespacePickerStep from "./steps/ocp/NamespacePickerStep";
import AppNameStep from "./steps/ocp/AppNameStep";
import JobProgress from "./shared/JobProgress";
import DownloadStep from "./shared/DownloadStep";
import FailedStep from "./shared/FailedStep";

function setUrlParam(id: string | null) {
  const url = new URL(window.location.href);
  if (id) url.searchParams.set("logxRequest", id);
  else url.searchParams.delete("logxRequest");
  window.history.replaceState({}, "", url.toString());
}

function jobOfType(jobs: LogXv2Job[], jobType: string): LogXv2Job | undefined {
  return [...jobs].reverse().find((j) => j.jobType === jobType);
}

// Başarısız ekranında çıktısı gösterilecek job: en son başlatılan (tipi ne olursa olsun).
function lastJob(jobs: LogXv2Job[]): LogXv2Job | undefined {
  return jobs.length ? jobs[jobs.length - 1] : undefined;
}

const STEP_TITLES: Record<string, string> = {
  platform: "",
  legacy_app: "Uygulama Seçimi",
  legacy_discovering: "Log Dosyaları Taranıyor",
  legacy_file_select: "Dosya Seçimi",
  legacy_transferring: "Dosyalar Hazırlanıyor",
  ocp_cluster_select: "Cluster Seçimi",
  ocp_namespace_step: "Namespace",
  ocp_namespace_discovering: "Namespace'ler Taranıyor",
  ocp_namespace_picker: "Namespace Seçimi",
  ocp_app_name: "Uygulama Adı",
  ocp_transferring: "Loglar Toplanıyor",
  ready: "İndirmeye Hazır",
  failed: "Hata",
};

const LogXWizardPage: React.FC = () => {
  const [requestId, setRequestId] = useState<string | null>(null);
  const [request, setRequest] = useState<LogXv2Request | null>(null);
  const [jobs, setJobs] = useState<LogXv2Job[]>([]);
  const [download, setDownload] = useState<DownloadInfo | null>(null);
  // Çok-bastion'lu OCP çekiminde bir istek birden çok arşiv üretebilir; tekil `download`
  // sözleşme olarak korunur (ilk arşiv), liste hepsini taşır.
  const [downloadList, setDownloadList] = useState<DownloadInfo[]>([]);
  // Yalnızca Admin yanıtında gelir; başarısız ekranında yönetici notu olarak gösterilir.
  const [technicalDetail, setTechnicalDetail] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [busyError, setBusyError] = useState<string | null>(null);
  const [chosenNamespace, setChosenNamespace] = useState<string | null>(null);

  const refresh = useCallback(async (id: string) => {
    const r = await logxV2Api.getRequest(id);
    setRequest(r.request);
    setJobs(r.jobs);
    setDownload(r.download);
    setDownloadList(r.downloads ?? []);
    return r;
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const existing = params.get("logxRequest");
    if (!existing) { setLoading(false); return; }
    setRequestId(existing);
    refresh(existing)
      .catch(() => { setUrlParam(null); setRequestId(null); })
      .finally(() => setLoading(false));
  }, [refresh]);

  async function startPlatform(platform: Platform) {
    if (busy) return;
    setBusy(true);
    setBusyError(null);
    try {
      const r = await logxV2Api.createRequest(platform);
      setRequestId(r.requestId);
      setUrlParam(r.requestId);
      await refresh(r.requestId);
    } catch (err: unknown) {
      setBusyError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  // Tüm adım aksiyonları bundan geçer. Yeniden-giriş kilidi (`if (busy) return`) aynı
  // aksiyonun in-flight iken ikinci kez tetiklenmesini — dolayısıyla üst üste job
  // açılmasını — KESİN engeller (buton görsel disable'ından bağımsız güvence).
  async function guarded(fn: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setBusyError(null);
    try { await fn(); }
    catch (err: unknown) { setBusyError(err instanceof Error ? err.message : String(err)); }
    finally { setBusy(false); }
  }

  function restart() {
    setUrlParam(null);
    setRequestId(null);
    setRequest(null);
    setJobs([]);
    setDownload(null);
    setChosenNamespace(null);
  }

  // Adıma göre "← Geri": client-state adımları anında geri alınır; sunucu-durumlu adımlar
  // reset endpoint'iyle bir önceki seçim adımına sarılır. İlk seçim adımından geri = platform
  // seçimine dönüş (restart). Bir back hedefi olmayan adımlarda buton hiç render edilmez.
  function backTargetFor(s: string): "restart" | "client" | "legacy_app" | "ocp_cluster_select" | "ocp_namespace_step" | null {
    switch (s) {
      case "legacy_app":
      case "ocp_cluster_select":
        return "restart";
      case "ocp_app_name":
        return "client"; // sadece chosenNamespace temizle
      case "legacy_file_select":
        return "legacy_app";
      case "ocp_namespace_step":
        return "ocp_cluster_select";
      case "ocp_namespace_picker":
        return "ocp_namespace_step";
      default:
        return null;
    }
  }

  async function back(currentStep: string) {
    if (busy) return;
    const target = backTargetFor(currentStep);
    if (!target) return;
    if (target === "restart") { restart(); return; }
    if (target === "client") { setChosenNamespace(null); return; }
    if (!requestId) return;
    await guarded(async () => {
      await logxV2Api.resetRequest(requestId, target);
      setChosenNamespace(null);
      await refresh(requestId);
    });
  }

  if (loading) {
    return <div className="max-w-2xl mx-auto py-16 text-center text-sm text-[var(--text-muted)]">Yükleniyor...</div>;
  }

  // ── Adım türetme: her zaman server state'inden, client kendi gerçeğini icat etmez ──
  let step = "platform";
  if (request) {
    if (request.state === "failed") step = "failed";
    else if (request.state === "ready" && download) step = "ready";
    else if (request.platform === "legacy") {
      if (request.state === "draft") step = "legacy_app";
      else if (request.state === "discovering") step = "legacy_discovering";
      else if (request.state === "discovered") step = "legacy_file_select";
      else if (request.state === "transferring") step = "legacy_transferring";
    } else if (request.platform === "openshift") {
      if (request.state === "draft") {
        step = request.input?.clusters ? (chosenNamespace ? "ocp_app_name" : "ocp_namespace_step") : "ocp_cluster_select";
      } else if (request.state === "namespace_discovering") step = "ocp_namespace_discovering";
      // Namespace listesi geldiğinde picker gösterilir; kullanıcı bir namespace SEÇİNCE
      // (chosenNamespace set) app_name adımına ilerler. Önceden state hâlâ
      // "namespaces_discovered" olduğu için picker'da takılıp kalıyordu (seçim ilerlemiyordu).
      else if (request.state === "namespaces_discovered") step = chosenNamespace ? "ocp_app_name" : "ocp_namespace_picker";
      else if (request.state === "transferring") step = "ocp_transferring";
    }
  }

  const canGoBack = backTargetFor(step) !== null;

  return (
    <div className="max-w-2xl mx-auto space-y-5">
      <div className="flex items-start gap-3">
        {canGoBack && (
          <button
            onClick={() => back(step)}
            disabled={busy}
            title="Önceki adıma dön"
            className="mt-0.5 flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-lg border border-[var(--border)] text-[var(--text-secondary)] hover:border-[var(--accent)] hover:text-[var(--text-primary)] transition-colors active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none"
          >
            <ArrowLeftIcon className="w-3.5 h-3.5" />
            Geri
          </button>
        )}
        <div className="flex-1">
          <h1 className="page-title">LogX v2 — Güvenli Log İndirme</h1>
          {STEP_TITLES[step] && <p className="mt-1 text-sm font-medium text-[var(--text-muted)]">{STEP_TITLES[step]}</p>}
        </div>
      </div>

      {busyError && (
        <div className="flex items-start gap-2 bg-red-50 border border-red-100 rounded-xl p-3 text-sm text-red-700">
          <ExclamationTriangleIcon className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <span>{busyError}</span>
        </div>
      )}

      <div key={step} className="card p-5 animate-slide-up">
        {step === "platform" && <PlatformStep busy={busy} onSelect={startPlatform} />}

        {step === "legacy_app" && requestId && (
          <AppSearchStep
            busy={busy}
            onSelect={(app) => guarded(async () => {
              await logxV2Api.discoverLegacy(requestId, app);
              await refresh(requestId);
            })}
          />
        )}

        {step === "legacy_discovering" && requestId && (() => {
          const job = jobOfType(jobs, "legacy_discovery");
          if (!job) return null;
          return (
            <JobProgress
              jobId={job.id}
              discoveringLabel="Dosyalar taranıyor…"
              onDone={(r) => { setTechnicalDetail(r.technicalDetail ?? null); refresh(requestId); }}
            />
          );
        })()}

        {step === "legacy_file_select" && requestId && request?.discoveryResult && (
          <FileSelectionStep
            busy={busy}
            result={request.discoveryResult as LegacyDiscoveryResult}
            onSubmit={(selected) => guarded(async () => {
              await logxV2Api.transferLegacy(requestId, selected);
              await refresh(requestId);
            })}
          />
        )}

        {step === "legacy_transferring" && requestId && (() => {
          const job = jobOfType(jobs, "legacy_transfer");
          if (!job) return null;
          return <JobProgress jobId={job.id} discoveringLabel="Dosyalar aktarılıyor ve zip'leniyor…" onDone={(r) => { setTechnicalDetail(r.technicalDetail ?? null); refresh(requestId); }} />;
        })()}

        {step === "ocp_cluster_select" && requestId && (
          <ClusterSelectStep
            busy={busy}
            onSubmit={(env, tenant, clusters) => guarded(async () => {
              await logxV2Api.selectClusters(requestId, env, tenant, clusters);
              await refresh(requestId);
            })}
          />
        )}

        {step === "ocp_namespace_step" && requestId && (
          <NamespaceStep
            busy={busy}
            onKnown={(ns) => setChosenNamespace(ns)}
            onTriggerDiscovery={() => guarded(async () => {
              await logxV2Api.discoverNamespaces(requestId);
              await refresh(requestId);
            })}
          />
        )}

        {step === "ocp_namespace_discovering" && requestId && (() => {
          const job = jobOfType(jobs, "ocp_namespace_discovery");
          if (!job) return null;
          return <JobProgress jobId={job.id} discoveringLabel="Namespace'ler taranıyor…" onDone={(r) => { setTechnicalDetail(r.technicalDetail ?? null); refresh(requestId); }} />;
        })()}

        {step === "ocp_namespace_picker" && request?.discoveryResult && (
          <NamespacePickerStep
            result={request.discoveryResult as OcpNamespaceDiscoveryResult}
            onSelect={(ns) => setChosenNamespace(ns)}
          />
        )}

        {step === "ocp_app_name" && requestId && chosenNamespace && (
          <AppNameStep
            busy={busy}
            onSubmit={(appName) => guarded(async () => {
              await logxV2Api.discoverFetchOcp(requestId, chosenNamespace, appName);
              await refresh(requestId);
            })}
          />
        )}

        {step === "ocp_transferring" && requestId && (() => {
          const job = jobOfType(jobs, "ocp_discover_fetch");
          if (!job) return null;
          return <JobProgress jobId={job.id} discoveringLabel="Pod'lar taranıyor ve loglar toplanıyor…" onDone={(r) => { setTechnicalDetail(r.technicalDetail ?? null); refresh(requestId); }} />;
        })()}

        {step === "ready" && download && <DownloadStep download={download} downloads={downloadList} onRestart={restart} />}

        {step === "failed" && (
          <FailedStep
            jobId={lastJob(jobs)?.id}
            message={request?.errorMessage || "İşlem tamamlanamadı. Lütfen sistem yöneticinize başvurun."}
            technicalDetail={technicalDetail ?? undefined}
            onRestart={restart}
          />
        )}
      </div>
    </div>
  );
};

export default LogXWizardPage;
