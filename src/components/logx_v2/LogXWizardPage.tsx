// src/components/logx_v2/LogXWizardPage.tsx — LogX v2 sihirbazı: platform seçimi →
// Legacy/OpenShift akışı → indirme. Durum HER ZAMAN server'daki logx_v2_requests.state'ten
// senkronize edilir (client kendi gerçeğini icat etmez) — sayfa yenilemesi sonrası
// `?logxRequest=<id>` üzerinden kaldığı yerden devam eder (bkz. plan dosyası I. bölümü).
import React, { useCallback, useEffect, useState } from "react";
import { ExclamationTriangleIcon, ArrowLeftIcon } from "@heroicons/react/24/outline";
import {
  logxV2Api, type Platform, type LogXv2Request, type LogXv2Job, type DownloadInfo,
  type LegacyDiscoveryResult, type OcpNamespaceDiscoveryResult, type OcpFetchTarget,
} from "@/api/logxV2Api";
import PlatformStep from "./steps/PlatformStep";
import AppSearchStep from "./steps/legacy/AppSearchStep";
import HostSelectStep from "./steps/legacy/HostSelectStep";
import FileSelectionStep from "./steps/legacy/FileSelectionStep";
import ClusterSelectStep from "./steps/ocp/ClusterSelectStep";
import NamespacePickerStep from "./steps/ocp/NamespacePickerStep";
import AppNameStep from "./steps/ocp/AppNameStep";
import SelectedTargetsBar from "./steps/ocp/SelectedTargetsBar";
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
  /** Cluster başına HAM hata metni. Bu olmadan kullanıcı yalnızca "erişilemedi" görüyordu;
   *  üretimde gerçek sebep ("'username' is undefined") hiçbir ekranda görünmedi. */
  failedDetails?: { cluster: string; error: string }[];
  /** Önbellekten geldiyse tazelik bilgisi; canlı taramada null. */
  cache: { fetchedAt: string | null; stale: boolean; source?: string | null } | null;
  /** Ad → kaynak ('inventory' | 'discovery'). Envanterde olmayanı rozetlemek için. */
  sources?: Record<string, string>;
  /** Ad → içindeki uygulama sayısı (envanterden). Anahtar yoksa sayı BİLİNMİYOR —
   *  kullanıcı boş bir namespace'i seçip bir dakika beklemesin diye listede gösterilir. */
  counts?: Record<string, number>;
  /** Ad → hangi cluster'larda var. Çoklu cluster seçiminde rozet ve süzgeç bunu kullanır. */
  clusters?: Record<string, string[]>;
}

interface OcpInput { env?: string; tenant?: string; clusters?: string[]; appDiscoveryNamespaces?: string[] }

// BİRİNCİL kaynak: dbo.Openshift_Inventory (portaldan bağımsız, zamanlanmış Ansible
// job'ı besler — bkz. server/logx/v2/ocp-inventory.cjs başlığı). Tek bir senkron DB
// okuması; hiçbir AWX job'ı tetiklenmez. Kayıt yoksa null döner — çağıran o zaman
// (nadiren) canlı keşif fallback'ine düşer — bu karar artık kullanıcıya SORULMAZ, otomatik
// verilir (bkz. resolveNamespaces).
//
// Kayıt VAR ama liste boşsa (kullanıcının yetkisi olan namespace kalmamışsa) boş liste
// döneriz, null DEĞİL: aksi halde kısıtlı kullanıcı canlı taramaya düşer, dakikalarca
// AWX job'ı bekler ve kısıtlamanın amacı da anlamsızlaşırdı.
async function loadNamespaceCache(input: OcpInput | undefined): Promise<NamespaceList | null> {
  const { env, tenant, clusters } = input || {};
  if (!env || !tenant || !clusters?.length) return null;
  let out;
  try {
    out = await logxV2Api.inventoryNamespaces(env, tenant, clusters);
  } catch {
    return null;   // envanter okunamadi -> canlı keşif fallback'ine düş
  }
  if (!out.cached) return null;
  return {
    items: out.items, failed: [],
    cache: { fetchedAt: out.fetchedAt, stale: out.stale, source: out.source },
    sources: out.sources,
    counts: out.counts,
    clusters: out.clusters,
  };
}

const STEP_TITLES: Record<string, string> = {
  platform: "",
  legacy_app: "Uygulama Seçimi",
  legacy_hosts: "Sunucu Seçimi",
  legacy_discovering: "Log Dosyaları Taranıyor",
  legacy_file_select: "Dosya Seçimi",
  legacy_transferring: "Dosyalar Hazırlanıyor",
  ocp_cluster_select: "Cluster Seçimi",
  ocp_namespace_resolving: "Namespace Hazırlanıyor",
  ocp_namespace_discovering: "Namespace'ler Taranıyor",
  ocp_namespace_picker: "Namespace Seçimi",
  ocp_app_name: "Uygulama Seçimi",
  ocp_app_discovering: "Uygulamalar Taranıyor",
  ocp_transferring: "Loglar Toplanıyor",
  ready: "İndirmeye Hazır",
  failed: "Hata",
};

// Tek calistirmada izin verilen azami (namespace, uygulama) cifti. SUNUCU da ayni siniri
// uygular (server/logx/v2/ocp.cjs MAX_TARGETS) — buradaki deger yalnizca kullaniciyi
// gereksiz bir 400'e dusurmemek icin.
const MAX_OCP_TARGETS = 20;

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
  // Tek çalıştırmada toplanacak (namespace, uygulama) çiftleri. Kullanıcı "Listeye Ekle"
  // ile biriktirir; her çift AYRI bir arşiv üretir. Tek çift eklemek bugünkü akışla aynı
  // sonucu verir — çoklu hedef, tekilin genel hâlidir.
  const [targets, setTargets] = useState<OcpFetchTarget[]>([]);
  // Legacy: uygulama seçildi ama keşif henüz başlamadı — araya sunucu seçimi girer.
  // Sunucu seçimi client state'idir; sunucu durumu bu aşamada hâlâ 'draft'tir.
  const [legacyApp, setLegacyApp] = useState<string | null>(null);
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
    const failedDetails: { cluster: string; error: string }[] = [];
    let looksLikeNamespaces = false;
    for (const c of result.clusters) {
      if (!Array.isArray(c?.namespaces)) continue;
      looksLikeNamespaces = true;
      if (c.status === "ok") { items.push(...c.namespaces.filter((n) => typeof n === "string")); continue; }
      failed.push(c.cluster_name);
      // Playbook hata metnini cluster başına döndürüyor; eskiden okunmuyordu.
      const detail = String((c as { error?: string }).error || "").trim();
      failedDetails.push({ cluster: c.cluster_name, error: detail || "Bilinmeyen hata." });
    }
    return looksLikeNamespaces ? { items, failed, failedDetails, cache: null } : null;
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
    setTargets([]);
    setLegacyApp(null);
  }

  // Adıma göre "← Geri": client-state adımları anında geri alınır; sunucu-durumlu adımlar
  // reset endpoint'iyle bir önceki seçim adımına sarılır. İlk seçim adımından geri = platform
  // seçimine dönüş (restart). Bir back hedefi olmayan adımlarda buton hiç render edilmez.
  function backTargetFor(s: string): "restart" | "client" | "legacy_app" | "ocp_cluster_select" | null {
    switch (s) {
      case "legacy_app":
      case "ocp_cluster_select":
        return "restart";
      case "legacy_hosts":
        return "client";   // uygulama seçimine dön (keşif henüz başlamadı)
      case "ocp_app_name":
        return "client"; // namespace seçimine dön; sepet KORUNUR
      case "legacy_file_select":
        return "legacy_app";
      case "ocp_namespace_resolving":
        return "ocp_cluster_select";
      case "ocp_namespace_picker":
        return "ocp_cluster_select";
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
    if (target === "client") {
      // Legacy sunucu adımından geri = uygulama seçimine dön.
      if (currentStep === "legacy_hosts") { setLegacyApp(null); return; }
      // Uygulama adımından geri = namespace seçimi. Sepet (targets) korunur: kullanıcı
      // topladıklarını kaybetmeden başka bir namespace'e geçebilsin.
      setChosenNamespace(null);
      return;
    }
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

  // ── Adım türetme: her zaman server state'inden, client kendi gerçeğini icat etmez ──
  let step = "platform";
  if (request) {
    if (request.state === "failed") step = "failed";
    else if (request.state === "ready" && download) step = "ready";
    else if (request.platform === "legacy") {
      if (request.state === "draft") step = legacyApp ? "legacy_hosts" : "legacy_app";
      else if (request.state === "discovering") step = "legacy_discovering";
      else if (request.state === "discovered") step = "legacy_file_select";
      else if (request.state === "transferring") step = "legacy_transferring";
    } else if (request.platform === "openshift") {
      if (request.state === "draft") {
        // Önbellekten liste geldiyse (nsList) sunucu durumu 'draft' kalsa da picker gösterilir.
        step = request.input?.clusters
          ? (activeNamespace ? "ocp_app_name" : (namespaceList ? "ocp_namespace_picker" : "ocp_namespace_resolving"))
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
  // düşen ama listesi olmayan bir durumda kart bomboş kalırdı; bunun yerine çözümleme
  // adımına indiriyoruz — orası listeyi kendiliğinden geri getirir.
  // (Kural: render edemeyeceğimiz bir adımı asla seçme.)
  if (step === "ocp_namespace_picker" && !namespaceList) step = "ocp_namespace_resolving";

  // Sepet (biriken hedefler) SEÇİM adımlarının üstünde şerit olarak durur — ayrı bir
  // "Toplanacak Uygulamalar" adımı YOK. Kullanıcı ekle → namespace seç → ekle döngüsünü
  // ekran değiştirmeden sürdürür (2026-08-10 kullanıcı kararı).
  const SELECTION_STEPS = ["ocp_namespace_resolving", "ocp_namespace_picker", "ocp_app_name"];
  const showBasket = SELECTION_STEPS.includes(step);

  // Namespace çözümlemesi KULLANICIYA SORULMADAN yapılır: önce paylaşımlı katalog
  // (envanter ∪ önbellek) okunur; kayıt yoksa canlı keşif job'ı otomatik başlatılır ve
  // sonucu kataloğa yazılır (sonraki kullanıcı anında görür).
  //
  // Tekrar-tetikleme koruması `nsResolveRef`: bu etki her render'da yeniden değerlendirilen
  // `step` değerine bakar; ref olmadan aynı seçim için birden fazla AWX job'ı açılabilirdi.
  const nsResolveRef = React.useRef<string | null>(null);
  useEffect(() => {
    // `loading` sırasında hiçbir şey tetiklenmez: istek henüz sunucudan okunmadı.
    if (loading || step !== "ocp_namespace_resolving" || !requestId || busy) return;
    const input = request?.input as OcpInput | undefined;
    const key = `${requestId}|${(input?.clusters || []).join(",")}`;
    if (nsResolveRef.current === key) return;
    nsResolveRef.current = key;
    guarded(async () => {
      const cached = await loadNamespaceCache(input);
      if (cached) { setNsList(cached); return; }
      await logxV2Api.discoverNamespaces(requestId);
      await refresh(requestId);
    });
  }, [loading, step, requestId, request?.input, busy]);   // eslint-disable-line react-hooks/exhaustive-deps

  // ERKEN ÇIKIŞ BURADA — TÜM hook'ların ALTINDA. Yukarı taşımayın.
  //
  // GERÇEK ARIZA (2026-08-10): bu blok hook'ların ÜSTÜNDEYDİ. İlk render `loading === true`
  // ile erken dönüp 17 hook çalıştırıyor, `setLoading(false)` sonrası ikinci render 19 hook
  // çalıştırıyordu → React "Rendered more hooks than during the previous render." fırlattı,
  // ağaç unmount oldu, /logx BEMBEYAZ açıldı. TypeScript de build de bunu yakalamaz;
  // src/__tests__/hook-order.test.cjs yakalar.
  if (loading) {
    return <div className="max-w-2xl mx-auto py-16 text-center text-sm text-[var(--text-muted)]">Yükleniyor...</div>;
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

      {showBasket && requestId && (
        <SelectedTargetsBar
          targets={targets}
          max={MAX_OCP_TARGETS}
          busy={busy}
          onRemove={(i) => setTargets((prev) => prev.filter((_, idx) => idx !== i))}
          onClear={() => setTargets([])}
          onSubmit={() => guarded(async () => {
            await logxV2Api.discoverFetchOcp(requestId, targets);
            await refresh(requestId);
          })}
        />
      )}

      <div key={step} className="card p-5 animate-slide-up">
        {step === "platform" && <PlatformStep busy={busy} onSelect={startPlatform} />}

        {step === "legacy_app" && requestId && (
          <AppSearchStep
            busy={busy}
            // Uygulama seçimi artık DOĞRUDAN tarama başlatmaz: araya sunucu seçimi girer.
            // Eskiden uygulamanın TÜM sunucuları (30'a kadar) taranıyordu.
            onSelect={(app) => setLegacyApp(app)}
          />
        )}

        {step === "legacy_hosts" && requestId && legacyApp && (
          <HostSelectStep
            app={legacyApp}
            busy={busy}
            onSubmit={(hosts) => guarded(async () => {
              await logxV2Api.discoverLegacy(requestId, legacyApp, hosts);
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

        {/* "Namespace'i biliyor musun?" SORUSU KALDIRILDI. Cluster seçiminden sonra akış
            kendi ilerler: DB'de kayıt varsa liste anında gelir, yoksa tarama kullanıcıya
            sorulmadan başlar. Bu adım yalnızca o kararın verildiği kısa aradır (sayfa
            yenilendiğinde de aynı yoldan geçilir). */}
        {step === "ocp_namespace_resolving" && requestId && (
          <div className="py-10 flex flex-col items-center gap-3 text-center">
            <div className="w-6 h-6 border-2 border-[var(--border)] border-t-[var(--accent)] rounded-full animate-spin" />
            <p className="text-sm text-[var(--text-secondary)]">Namespace listesi hazırlanıyor…</p>
            <p className="text-xs text-[var(--text-muted)]">
              Kayıtlı liste varsa anında gelir; yoksa cluster'lar taranır (bir kez — sonraki
              kullanıcılar hazır listeyi görür).
            </p>
          </div>
        )}

        {step === "ocp_namespace_discovering" && requestId && (() => {
          const job = jobOfType(jobs, "ocp_namespace_discovery");
          if (!job) return null;
          return <JobProgress jobId={job.id} discoveringLabel="Namespace'ler taranıyor…" onDone={(r) => { setTechnicalDetail(r.technicalDetail ?? null); refresh(requestId); }} />;
        })()}

        {/* `namespaceList` = önbellek (nsList) ?? CANLI keşif sonucu (nsFromServer).
            Burada eskiden yalnızca `nsList` vardı: canlı keşiften dönen kullanıcı adım
            olarak picker'a geçiyor ama koşul sağlanmadığı için ekranda HİÇBİR ŞEY
            görmüyordu (üretimde "boş ekran" olarak raporlandı). Adım seçimi zaten
            `namespaceList` üzerinden yapılıyordu — ikisi artık aynı kaynağa bakıyor. */}
        {step === "ocp_namespace_picker" && requestId && namespaceList && (
          <NamespacePickerStep
            namespaces={namespaceList.items}
            failedClusters={namespaceList.failed}
            failedDetails={namespaceList.failedDetails}
            cache={namespaceList.cache}
            sources={namespaceList.sources}
            counts={namespaceList.counts}
            clusterMembership={namespaceList.clusters}
            selectedClusters={(request?.input as OcpInput | undefined)?.clusters || []}
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
              // Sepette kalan yer: kullanıcı sunucudan 400 almadan önce ekranda görsün.
              remainingSlots={MAX_OCP_TARGETS - targets.length}
              // Seçim JOB BAŞLATMAZ: çiftler sepete eklenir ve NAMESPACE EKRANINA dönülür —
              // kullanıcı başka bir namespace'ten de ekleyebilsin (2026-08-10 kullanıcı kararı).
              onSubmit={(appNames) => {
                setTargets((prev) => {
                  const next = [...prev];
                  for (const appName of appNames) {
                    if (next.length >= MAX_OCP_TARGETS) break;
                    if (next.some((t) => t.namespace === activeNamespace && t.appName === appName)) continue;
                    next.push({ namespace: activeNamespace, appName });
                  }
                  return next;
                });
                setChosenNamespace(null);
              }}
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
