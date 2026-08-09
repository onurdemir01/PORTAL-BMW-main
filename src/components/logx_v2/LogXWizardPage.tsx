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

interface NamespaceList {
  items: string[];
  /** Listesi alınamayan cluster'lar — kullanıcı eksik listeyi tam sanmasın. */
  failed: string[];
  /** Önbellekten geldiyse tazelik bilgisi; canlı taramada null. */
  cache: { fetchedAt: string | null; stale: boolean } | null;
}

interface OcpInput { env?: string; tenant?: string; clusters?: string[]; appDiscoveryNamespaces?: string[] }

// Seçili cluster'ların namespace önbelleklerini birleştirir. Hiçbirinde KAYIT yoksa null
// döner — çağıran o zaman canlı taramaya düşer (bugünkü davranış korunur).
//
// Kayıt VAR ama liste boşsa (kullanıcının yetkisi olan namespace kalmamışsa) boş liste
// döneriz, null DEĞİL: aksi halde kısıtlı kullanıcı canlı taramaya düşer, dakikalarca
// AWX job'ı bekler ve kısıtlamanın amacı da anlamsızlaşırdı.
async function loadNamespaceCache(input: OcpInput | undefined): Promise<NamespaceList | null> {
  const { env, tenant, clusters } = input || {};
  if (!env || !tenant || !clusters?.length) return null;
  const results = await Promise.all(
    clusters.map((c) =>
      logxV2Api.cachedNamespaces(env, tenant, c)
        .then((r) => ({ cluster: c, r }))
        .catch(() => ({ cluster: c, r: null }))
    )
  );
  const items: string[] = [];
  const failed: string[] = [];
  let newest: string | null = null;
  let stale = false;
  let anyCached = false;
  for (const { cluster, r } of results) {
    if (!r) { failed.push(cluster); continue; }   // sessiz eksiklik YOK — uyarı gösterilir
    if (!r.cached) continue;
    anyCached = true;
    items.push(...(r.items || []));
    if (r.stale) stale = true;
    if (r.fetchedAt && (!newest || new Date(r.fetchedAt) > new Date(newest))) newest = r.fetchedAt;
  }
  if (!anyCached) return null;
  return { items, failed, cache: { fetchedAt: newest, stale } };
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
  ocp_app_name: "Uygulama Seçimi",
  ocp_app_discovering: "Uygulamalar Taranıyor",
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
  const busyRef = React.useRef(false);
  const [busyError, setBusyError] = useState<string | null>(null);
  const [chosenNamespace, setChosenNamespace] = useState<string | null>(null);
  // ÖNBELLEKTEN gelen namespace listesi. Canlı keşif sonucu sunucudan türetilir
  // (`nsFromServer`); bu state yalnızca "kullanıcı önbelleği seçti" durumunu taşır.
  const [nsList, setNsList] = useState<NamespaceList | null>(null);
  // Uygulama keşfi bittiğinde AppNameStep'in önbelleği yeniden okumasını tetikler.
  // (Bugün `key={step}` zaten remount ediyor; bu, o davranışa bağımlı kalmamak için.)
  const [appCacheToken, setAppCacheToken] = useState(0);

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

  // Canlı keşif sonucu SUNUCUDAN türetilir (client state'ine kopyalanmaz): sayfa
  // yenilendiğinde de kaldığı yerden devam edebilsin. Ölçüt state değil ŞEKİL — sonuç
  // namespace listesi taşıyorsa kullanılır, taşımıyorsa null.
  const nsFromServer = React.useMemo<NamespaceList | null>(() => {
    const result = request?.discoveryResult as OcpNamespaceDiscoveryResult | null;
    if (!Array.isArray(result?.clusters)) return null;
    const items: string[] = [];
    const failed: string[] = [];
    let looksLikeNamespaces = false;
    for (const c of result.clusters) {
      if (!Array.isArray(c?.namespaces)) continue;
      looksLikeNamespaces = true;
      if (c.status === "ok") items.push(...c.namespaces.filter((n) => typeof n === "string"));
      else failed.push(c.cluster_name);
    }
    return looksLikeNamespaces ? { items, failed, cache: null } : null;
  }, [request?.discoveryResult]);

  // Önbellekten gelen liste (varsa) sunucu sonucunu EZER — kullanıcı bilerek onu istedi.
  const namespaceList = nsList ?? nsFromServer;

  // Sayfa yenilendiğinde `chosenNamespace` kaybolur; uygulama keşfi başlatılmışsa hangi
  // namespace için başlatıldığı sunucuda duruyor (`input.appDiscoveryNamespaces`). Onu geri
  // kurmazsak kullanıcı keşif bittikten sonra boş bir "namespace seçin" ekranına düşerdi.
  const serverNamespace = (request?.input as OcpInput | undefined)?.appDiscoveryNamespaces?.[0] ?? null;
  const activeNamespace = chosenNamespace ?? serverNamespace;

  async function startPlatform(platform: Platform) {
    await guarded(async () => {
      const r = await logxV2Api.createRequest(platform);
      setRequestId(r.requestId);
      setUrlParam(r.requestId);
      await refresh(r.requestId);
    });
  }

  // Tüm adım aksiyonları bundan geçer. Yeniden-giriş kilidi aynı aksiyonun in-flight iken
  // ikinci kez tetiklenmesini — dolayısıyla üst üste job açılmasını — KESİN engeller
  // (buton görsel disable'ından bağımsız güvence).
  async function guarded(fn: () => Promise<void>) {
    // Kilit `busy` state'i DEĞİL bir ref: `busy` render anında yakalanır, aynı tick'te gelen
    // iki tık ikisi de `false` görüp İKİ AWX job'ı açabilirdi. Ref anında görünür.
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setBusyError(null);
    try { await fn(); }
    catch (err: unknown) { setBusyError(err instanceof Error ? err.message : String(err)); }
    finally { busyRef.current = false; setBusy(false); }
  }

  function restart() {
    setUrlParam(null);
    setRequestId(null);
    setRequest(null);
    setJobs([]);
    setDownload(null);
    setChosenNamespace(null);
    setNsList(null);
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
      case "ocp_app_discovering":
        return null; // job çalışırken geri yok (iptal ayrı bir aksiyon)
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
    // Liste ÖNBELLEKTEN geldiyse sunucuda geri sarılacak bir durum yok (state hâlâ 'draft'):
    // client listesini temizlemek yeter, gereksiz reset çağrısı yapılmaz.
    if (currentStep === "ocp_namespace_picker" && request?.state === "draft") { setNsList(null); return; }
    if (!requestId) return;
    await guarded(async () => {
      await logxV2Api.resetRequest(requestId, target);
      setChosenNamespace(null);
      setNsList(null);
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
        // Önbellekten liste geldiyse (nsList) sunucu durumu 'draft' kalsa da picker gösterilir.
        step = request.input?.clusters
          ? (activeNamespace ? "ocp_app_name" : (namespaceList ? "ocp_namespace_picker" : "ocp_namespace_step"))
          : "ocp_cluster_select";
      } else if (request.state === "namespace_discovering") step = "ocp_namespace_discovering";
      // Namespace listesi geldiğinde picker gösterilir; kullanıcı bir namespace SEÇİNCE
      // (chosenNamespace set) app_name adımına ilerler. Önceden state hâlâ
      // "namespaces_discovered" olduğu için picker'da takılıp kalıyordu (seçim ilerlemiyordu).
      else if (request.state === "namespaces_discovered") step = activeNamespace ? "ocp_app_name" : "ocp_namespace_picker";
      // Uygulama keşfi namespace SEÇİLDİKTEN sonra çalışır; bitince aynı adıma dönülür
      // (liste artık önbellekte dolu). Namespace listesi client'ta (nsList) korunduğu için
      // "← Geri" ile picker'a dönüş bu durumlarda da çalışır.
      else if (request.state === "app_discovering") step = "ocp_app_discovering";
      else if (request.state === "apps_discovered") step = activeNamespace ? "ocp_app_name" : "ocp_namespace_picker";
      else if (request.state === "transferring") step = "ocp_transferring";
    }
  }

  // Namespace listesi client state'inde durduğu için SAYFA YENİLENDİĞİNDE kaybolur. Picker'a
  // düşen ama listesi olmayan bir durumda kart bomboş kalırdı; bunun yerine kullanıcıyı
  // namespace adımına indiriyoruz — oradan "Hayır, listele" önbellekten anında geri getirir.
  // (Kural: render edemeyeceğimiz bir adımı asla seçme.)
  if (step === "ocp_namespace_picker" && !namespaceList) step = "ocp_namespace_step";

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
              // ÖNCE paylaşımlı önbellek: liste anında gelir, AWX job'ı hiç açılmaz.
              // Boşsa bugünkü canlı keşif davranışı aynen sürer.
              const cached = await loadNamespaceCache(request?.input as OcpInput | undefined);
              if (cached) { setNsList(cached); return; }
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

        {step === "ocp_namespace_picker" && requestId && nsList && (
          <NamespacePickerStep
            namespaces={nsList.items}
            failedClusters={nsList.failed}
            cache={nsList.cache}
            busy={busy}
            onRediscover={() => guarded(async () => {
              await logxV2Api.discoverNamespaces(requestId);
              await refresh(requestId);
              // Önbellek listesini SONRA bırak: önce bıraksaydık arada bir render'da
              // ne önbellek ne sunucu sonucu olurdu ve kullanıcı bir an önceki adımı görürdü.
              setNsList(null);
            })}
            onSelect={(ns) => setChosenNamespace(ns)}
          />
        )}

        {step === "ocp_app_name" && requestId && activeNamespace && (() => {
          const input = request?.input as OcpInput | undefined;
          return (
            <AppNameStep
              busy={busy}
              env={input?.env}
              tenant={input?.tenant}
              clusters={input?.clusters}
              namespace={activeNamespace}
              reloadToken={appCacheToken}
              onDiscover={() => guarded(async () => {
                await logxV2Api.discoverApps(requestId, [activeNamespace]);
                await refresh(requestId);
              })}
              onSubmit={(appName) => guarded(async () => {
                await logxV2Api.discoverFetchOcp(requestId, activeNamespace, appName);
                await refresh(requestId);
              })}
            />
          );
        })()}

        {step === "ocp_app_discovering" && requestId && (() => {
          const job = jobOfType(jobs, "ocp_app_discovery");
          if (!job) return null;
          return (
            <JobProgress
              jobId={job.id}
              discoveringLabel="Namespace içindeki uygulamalar taranıyor…"
              onDone={(r) => {
                setTechnicalDetail(r.technicalDetail ?? null);
                setAppCacheToken((t) => t + 1);   // AppNameStep önbelleği yeniden okusun
                refresh(requestId);
              }}
            />
          );
        })()}

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
