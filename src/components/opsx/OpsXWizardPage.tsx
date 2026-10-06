// src/components/opsx/OpsXWizardPage.tsx — OpsX sihirbazı: platform → (Legacy:
// uygulama → sunucular | OpenShift: ortam/cluster) → işlem seçimi → tetikleme.
//
// LogX'ten YAPISAL FARK: LogX her adımı sunucudaki logx_v2_requests.state'e yazar
// (uzun süren discovery/transfer job'ları ve sayfa yenilemesinden sonra devam
// gerektirdiği için). OpsX'te adımlar arası kalıcı bir sunucu durumu YOK — akış
// kısa ve tek bir tetiklemeyle bitiyor, dolayısıyla adım durumu client'ta tutulur.
// Güvenlik buna dayanmaz: son POST /api/opsx/run çağrısında sunucu uygulama-host
// eşleşmesini ve cluster'ı envanterden YENİDEN doğrular.
import React, { useEffect, useState, useRef } from "react";
import { ArrowLeftIcon, CheckCircleIcon, ExclamationTriangleIcon, ArrowPathIcon, ArrowDownTrayIcon, ClockIcon } from "@heroicons/react/24/outline";
import {
  opsxApi,
  type OpsxPlatform, type OpsxOperation, type OpsxOcpOperation, type OpsxOcpPair,
  type OpsxRunResult, type OpsxDumpType, type OpsxDumpLaunchResult, type OpsxDumpStatus,
  type OpsxPodDeleteStatus,
  type OpsxPidSelection, type OpsxServerConfigSelection,
  opsxWasApi, type WasTarget, type WasOperation, type WasRunResult, type WasRunStatus,
} from "@/api/opsxApi";
import { useJobTracker } from "@/contexts/JobTrackerContext";
import AnsibleLogTerminal from "@/components/common/AnsibleLogTerminal";
import PlatformStep from "./steps/PlatformStep";
import AppSearchStep from "./steps/AppSearchStep";
import JbossVersionStep from "./steps/JbossVersionStep";
import HostSelectStep from "./steps/HostSelectStep";
import OcpTargetStep from "./steps/OcpTargetStep";
import OperationStep from "./steps/OperationStep";
import OcpOperationStep from "./steps/OcpOperationStep";
import OcpClusterPickStep from "./steps/OcpClusterPickStep";
import OcpPodSelectStep from "./steps/OcpPodSelectStep";
import LegacyJvmSelectStep from "./steps/LegacyJvmSelectStep";
import ServerConfigSelectStep from "./steps/ServerConfigSelectStep";
import LegacyProductStep from "./steps/LegacyProductStep";
import WasAppSearchStep, { type WasAppSelection } from "./steps/WasAppSearchStep";
import WasJvmSelectStep, { type WasDiscoveryRef } from "./steps/WasJvmSelectStep";
import WasConfirmStep from "./steps/WasConfirmStep";
import WasResultPanel from "./steps/WasResultPanel";

// WAS (WebSphere) akışı JBoss'tan AYRI adımlardan geçer (2026-10-02):
//   legacy_product → was_app (uygulama + keşif sunucuları) → was_jvm (canlı keşif, TEK JVM,
//   işlem) → was_confirm (JVM adı elle yazılır) → was_done (canlı çıktı + sonuç).
// TOPLU İŞLEM YOK: tek sunucu + tek JVM; "tümünü seç" yok. Sunucu (server/opsx/was.cjs)
// aynı kuralları ayrıca uygular — bu ekranlar bir kolaylık katmanıdır, güvenlik sınırı değil.
type Step =
  | "platform"
  | "legacy_product"
  | "was_app"
  | "was_jvm"
  | "was_confirm"
  | "was_done"
  | "legacy_app"
  | "legacy_jboss_version"
  | "legacy_hosts"
  | "legacy_jvm"
  | "legacy_serverconfig"
  | "ocp_target"
  | "operation"
  | "ocp_operation"
  | "ocp_cluster"
  | "ocp_pods"
  | "done";

const STEP_TITLES: Record<Step, string> = {
  platform: "",
  legacy_product: "Uygulama Sunucusu",
  was_app: "WAS Uygulama Seçimi",
  was_jvm: "WAS JVM Seçimi",
  was_confirm: "Onay",
  was_done: "İşlem Başlatıldı",
  legacy_app: "Uygulama Seçimi",
  legacy_jboss_version: "JBoss Sürümü",
  legacy_hosts: "Sunucu Seçimi",
  legacy_jvm: "JVM Seçimi",
  legacy_serverconfig: "JVM Seçimi",
  ocp_target: "Openshift Hedefi",
  operation: "İşlem Seçimi",
  ocp_operation: "İşlem Seçimi",
  ocp_cluster: "Cluster Seçimi",
  ocp_pods: "Pod Seçimi",
  done: "İşlem Başlatıldı",
};

const DUMP_OPERATIONS = new Set(["threaddump", "heapdump"]);
// Pod silme de dump ile AYNI kesif/secim adimini kullanir (2026-09-18)
const POD_SELECT_OPERATIONS = new Set(["threaddump", "heapdump", "poddelete"]);

const OpsXWizardPage: React.FC = () => {
  const [step, setStep] = useState<Step>("platform");
  const [platform, setPlatform] = useState<OpsxPlatform | null>(null);
  const [app, setApp] = useState("");
  const [jbossVersions, setJbossVersions] = useState<string[]>([]);
  const [hosts, setHosts] = useState<string[]>([]);
  // KULLANICININ FIILEN ISARETLEDIGI JBoss MAJORLERI. Backend eskiden bunu envanterden
  // TURETIYORDU; ayni host hem 7 hem 8 satiriyla gelince turetme keyfi bir sonuc veriyordu
  // (bkz. server/opsx/index.cjs resolveLegacyTargets). Artik secim dogrudan tasiniyor.
  const [hostMajors, setHostMajors] = useState<string[]>([]);
  const [env, setEnv] = useState("");
  const [tenant, setTenant] = useState("");
  const [pairs, setPairs] = useState<OpsxOcpPair[]>([]);
  // restart/rollout "ocp_operation"da secilir ama hemen tetiklenmez — araya "ocp_cluster"
  // adimi girdigi icin secim burada bekletilir (dump'in dumpType'i ile AYNI desen).
  const [ocOperationPending, setOcOperationPending] = useState<OpsxOcpOperation | null>(null);
  const [busy, setBusy] = useState(false);
  // ÇİFT TIKLAMA KORUMASI (2026-08-28). `busy` bir React STATE'idir: değeri render
  // sırasında yakalanır, `setBusy(true)` ise ASENKRON uygulanır. Aynı tick içindeki iki
  // tık (çift tıklama, yavaş ağda sabırsız kullanıcı, tuş+fare) ikisi de `busy === false`
  // görür ve İKİ AWX JOB'I birden açılabilir. LogX'te bu bilinçli olarak ref'e
  // çevrilmişti (LogXWizardPage.tsx); desen buraya da taşındı — bu sayfalar da gerçek
  // altyapı işleri (restart/dump/dosya taraması) tetikliyor.
  const busyRef = useRef(false);

  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<OpsxRunResult | OpsxDumpLaunchResult | null>(null);
  const [trackedJobId, setTrackedJobId] = useState<string | null>(null);
  // Dump akışı restart/stop/start'tan FARKLI: iş bitince indirilecek bir dosya üretir.
  // dumpJob dolu olduğu sürece ayrı bir interval bu bilgiyi (server/opsx/index.cjs
  // GET /dump/:serverId/:jobId/status) poll eder — trackJob'un genel AWX log takibinden
  // BAĞIMSIZ, aynı SelfServicePage.tsx'teki Smart ticket polling deseni.
  const [dumpJob, setDumpJob] = useState<{ awxServerId: number; jobId: number } | null>(null);
  const [dumpStatus, setDumpStatus] = useState<OpsxDumpStatus | null>(null);
  // Pod silme (2026-09-18): ayri durum ucu, pod basina Silindi / Bulunamadi / Hata
  const [podDeleteJob, setPodDeleteJob] = useState<{ awxServerId: number; jobId: number } | null>(null);
  const [podDeleteStatus, setPodDeleteStatus] = useState<OpsxPodDeleteStatus | null>(null);
  const [podDeleteMode, setPodDeleteMode] = useState(false);
  useEffect(() => {
    if (!podDeleteJob) return;
    let cancelled = false;
    const TERMINAL = new Set(["successful", "failed", "error", "canceled"]);
    const tick = async () => {
      try {
        const r = await opsxApi.podDeleteStatus(podDeleteJob.awxServerId, podDeleteJob.jobId);
        if (cancelled) return;
        setPodDeleteStatus(r);
        if (r.ok && TERMINAL.has(r.status)) return;
      } catch (e) {
        if (!cancelled) setPodDeleteStatus({ ok: false, status: "unknown", message: e instanceof Error ? e.message : String(e) });
      }
      if (!cancelled) timer = window.setTimeout(tick, 5000);
    };
    let timer = window.setTimeout(tick, 3000);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [podDeleteJob]);
  // Openshift'te işlem seçimi ile dump'ın tetiklenmesi arasında bir pod seçim adımı
  // olduğu için, seçilen dump tipi o adım boyunca burada tutulur.
  const [dumpType, setDumpType] = useState<OpsxDumpType | null>(null);
  // restart/stop/start artık doğrudan tetiklenmez — önce hangi JVM(ler)e (server-config)
  // dokunulacağı seçilir (dumpType'ın restart/stop/start için AYNI amaçlı karşılığı).
  const [pendingOperation, setPendingOperation] = useState<OpsxOperation | null>(null);
  // WAS akışının durumu — JBoss alanlarından AYRI tutulur.
  const [wasSel, setWasSel] = useState<WasAppSelection | null>(null);
  const [wasTarget, setWasTarget] = useState<WasTarget | null>(null);
  const [wasOperation, setWasOperation] = useState<WasOperation | null>(null);
  const [wasDiscovery, setWasDiscovery] = useState<WasDiscoveryRef | null>(null);
  const [wasRun, setWasRun] = useState<WasRunResult | null>(null);
  const { addJob, jobs } = useJobTracker();
  // Bu sayfa açıkken CANLI çıktıyı kendi içinde (inline) gösterir — takipçiden aynı
  // job'ın güncel verisini okur, kendi polling'ini yapmaz. Sayfadan ayrılınca (ya da
  // "Yeni İşlem" ile sıfırlanınca) bu inline görünüm kaybolur ama job arka planda
  // takip edilmeye devam eder (alt çubuktaki sekme) — AYNI iş için iki ayrı pencere
  // birden açılmaz (bkz. JobTrackerContext.tsx).
  const trackedJob = trackedJobId ? jobs.find((j) => j.id === trackedJobId) : undefined;

  function restart() {
    setStep("platform");
    setPodDeleteJob(null);
    setPodDeleteStatus(null);
    setPodDeleteMode(false);
    setPlatform(null);
    setApp("");
    setJbossVersions([]);
    setHosts([]);
    setEnv("");
    setTenant("");
    setPairs([]);
    setOcOperationPending(null);
    setError(null);
    setResult(null);
    setTrackedJobId(null);
    setDumpJob(null);
    setDumpStatus(null);
    setDumpType(null);
    setPendingOperation(null);
    setWasSel(null);
    setWasTarget(null);
    setWasOperation(null);
    setWasDiscovery(null);
    setWasRun(null);
  }

  function trackJob(r: OpsxRunResult | OpsxDumpLaunchResult) {
    if (r.jobId == null) return;
    const id = addJob({
      title: `OpsX #${r.jobId}`,
      fetchStatus: () => opsxApi.jobStatus(r.awxServerId, r.jobId as number),
    });
    setTrackedJobId(id);
  }

  // Dump job'ı bitene kadar aralıklı olarak sonucu (indirme token'ları dahil) sorgular.
  // Genel AWX log takibinden (trackJob/JobTrackerContext) BAĞIMSIZ — o sadece stdout
  // gösterir, bu ise set_stats'tan gelen yapılandırılmış sonucu (dosya hazır mı?) okur.
  useEffect(() => {
    if (!dumpJob) return;
    let cancelled = false;
    let timer: number | undefined;
    const TERMINAL = new Set(["successful", "failed", "error", "canceled"]);

    async function tick() {
      try {
        const r = await opsxApi.dumpStatus(dumpJob!.awxServerId, dumpJob!.jobId);
        if (cancelled) return;
        setDumpStatus(r);
        if (!TERMINAL.has(r.status)) {
          timer = window.setTimeout(tick, 3000);
        }
      } catch {
        if (cancelled) return;
        timer = window.setTimeout(tick, 5000);
      }
    }
    tick();
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [dumpJob]);

  // Adıma göre "← Geri" hedefi. Hedefi olmayan adımlarda buton hiç render edilmez.
  function backTargetFor(s: Step): Step | null {
    switch (s) {
      case "legacy_product":
      case "ocp_target":
        return "platform";
      case "legacy_app":
      case "was_app":
        return "legacy_product";
      case "was_jvm":
        return "was_app";
      case "was_confirm":
        return "was_jvm";
      case "legacy_jboss_version":
        return "legacy_app";
      case "legacy_hosts":
        return "legacy_jboss_version";
      case "operation":
        return "legacy_hosts";
      case "legacy_jvm":
      case "legacy_serverconfig":
        return "operation";
      case "ocp_operation":
        return "ocp_target";
      case "ocp_cluster":
        return "ocp_operation";
      case "ocp_pods":
        return "ocp_operation";
      default:
        return null;
    }
  }

  function back() {
    const target = backTargetFor(step);
    if (!target) return;
    setError(null);
    if (target === "platform") { restart(); return; }
    setStep(target);
  }

  // Legacy: uygulama + sunucular + islem + (restart/stop/start icin) serverConfigMap —
  // kullanicinin ServerConfigSelectStep'te sectigi {HOST: [{name,jbossMajor}]} eslemesi.
  // Openshift: env/oc_cluster + oc_input (bir veya daha fazla namespace/uygulama cifti) +
  // islem (su an SADECE restart aktif).
  async function runLegacy(operation: OpsxOperation, serverConfigMap?: Record<string, OpsxServerConfigSelection[]>) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      const r = await opsxApi.run({ platform: "legacy", application: app, operation, hosts, hostMajors, serverConfigMap });
      // safeJson() 4xx/5xx'te reddetmez (bkz. src/api/http.ts) — backend'in ok:false +
      // message ile döndüğü hatalar burada AÇIKÇA kontrol edilmezse kullanıcıya "İşlem
      // başlatıldı" yeşil onayı gösterilir (job hiç tetiklenmemiş olsa bile).
      if (!r.ok) {
        setError(r.message || "İşlem başlatılamadı.");
        return;
      }
      setResult(r);
      setStep("done");
      trackJob(r);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  // threaddump/heapdump AYRI bir AWX template'ine (opsx_legacy_dump) gider — restart'ın
  // /api/opsx/run'ından farklı olarak sonucu bir indirme listesine dönüşür (bkz. dumpStatus
  // polling'i yukarıda). pidMap, bir önceki "legacy_jvm" adımında kullanıcının seçtiği
  // {HOST: [pid,...]} eşlemesi — aynı uygulamaya ait bir host'ta birden fazla JVM varsa
  // birden fazla PID seçilmiş olabilir.
  async function runLegacyDump(dumpType: OpsxDumpType, pidMap: Record<string, OpsxPidSelection[]>) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      const r = await opsxApi.dumpLegacy(app, hosts, dumpType, pidMap, hostMajors);
      if (!r.ok) {
        setError(r.message || "Dump işi başlatılamadı.");
        return;
      }
      setResult(r);
      setStep("done");
      if (r.jobId != null) {
        setDumpJob({ awxServerId: r.awxServerId, jobId: r.jobId });
        trackJob(r);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  // OperationStep'in tek onSelect'i restart/stop/start İLE threaddump/heapdump'ı AYNI
  // listede sunar (bkz. server/opsx/index.cjs ALLOWED_OPERATIONS) — burada hangi backend
  // yoluna gideceğine ayrılır. HİÇBİRİ doğrudan tetiklenmez — ikisi de önce bir JVM seçim
  // adımına (canlı AWX keşfi) gider: dump PID bazlı (LegacyJvmSelectStep), restart/stop/
  // start server-config bazlı (ServerConfigSelectStep) — Openshift'in handleOcpOperation'ıyla
  // AYNI yönlendirme deseni.
  function handleLegacyOperation(operation: OpsxOperation) {
    if (DUMP_OPERATIONS.has(operation)) {
      setDumpType(operation as OpsxDumpType);
      setStep("legacy_jvm");
    } else {
      setPendingOperation(operation);
      setStep("legacy_serverconfig");
    }
  }

  // WAS işinin canlı çıktısı + yapılandırılmış sonucu. Takipçi (JobTrackerContext) sonucu
  // `result` alanında TAŞIR; sayfadan ayrılınca da iş alt çubukta izlenmeye devam eder.
  // Durum ucu 4xx/5xx döndürürse hata FIRLATILIR ki takipçi bunu "çalışıyor" sanmasın.
  function trackWasJob(awxServerId: number, jobId: number, label: string) {
    const id = addJob({
      title: `OpsX WAS ${label} #${jobId}`,
      fetchStatus: async () => {
        const s = await opsxWasApi.runStatus(awxServerId, jobId);
        if (!s.ok) throw new Error(s.message || "Durum okunamadı.");
        return { status: s.status, output: s.output || "", result: s.result ? s : undefined };
      },
    });
    setTrackedJobId(id);
  }

  // WAS: TEK sunucu + TEK JVM. Sunucu; onayı, JVM adını, keşfin sahibini/yaşını (≤15 dk),
  // ölçülen durumu ve kilidi YENİDEN doğrular — bu fonksiyon yalnız gövdeyi kurar.
  async function runWas(v: { confirmed: boolean; confirmText: string; ackWarnings: boolean }) {
    if (!wasSel || !wasTarget || !wasOperation || !wasDiscovery) return;
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      const r = await opsxWasApi.run({
        app: wasSel.app,
        host: wasTarget.host,
        profile: wasTarget.profile,
        cell: wasTarget.cell,
        node: wasTarget.node,
        server: wasTarget.server,
        operation: wasOperation,
        confirmed: v.confirmed,
        confirmText: v.confirmText,
        discoverJobId: wasDiscovery.jobId,
        discoverServerId: wasDiscovery.awxServerId,
        ackWarnings: v.ackWarnings,
      });
      if (!r.ok || r.jobId == null || r.awxServerId == null) {
        setError(r.message || "İşlem başlatılamadı.");
        return;
      }
      setWasRun(r);
      setStep("was_done");
      trackWasJob(r.awxServerId, r.jobId, `${wasOperation} ${wasTarget.server}@${wasTarget.host}`);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  const wasEnv = (wasSel && wasTarget && wasSel.hostInfo.find((h) => h.host === wasTarget.host)?.env) || "";

  function submitOcpTarget(v: { env: string; tenant: string; pairs: OpsxOcpPair[] }) {
    setEnv(v.env); setTenant(v.tenant); setPairs(v.pairs);
    setStep("ocp_operation");
  }

  async function runOpenshift(ocOperation: OpsxOcpOperation, cluster: string) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      const r = await opsxApi.run({ platform: "openshift", env, tenant, pairs, ocOperation, cluster });
      if (!r.ok) {
        setError(r.message || "İşlem başlatılamadı.");
        return;
      }
      setResult(r);
      setStep("done");
      trackJob(r);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  // Openshift dump POD seviyesinde çalışır — işlem seçildikten sonra doğrudan
  // tetiklenmez, önce pod seçim adımına (canlı AWX keşfi) gidilir. Artık TEK namespace'e
  // zorlanmıyor — pairs'teki TÜM (namespace,uygulama) çiftleri kesif+dump'a geçiyor.
  async function runOpenshiftDump(
    dumpType: OpsxDumpType,
    selectedPods: { cluster: string; namespace: string; pod: string }[],
    threadDumpCount: number,
    threadDumpInterval: number,
  ) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      const r = await opsxApi.dumpOpenshift(
        env, tenant, pairs, selectedPods, dumpType,
        dumpType === "threaddump" ? threadDumpCount : undefined,
        dumpType === "threaddump" ? threadDumpInterval : undefined,
      );
      if (!r.ok) {
        setError(r.message || "Dump işi başlatılamadı.");
        return;
      }
      setResult(r);
      setStep("done");
      if (r.jobId != null) {
        setDumpJob({ awxServerId: r.awxServerId, jobId: r.jobId });
        trackJob(r);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  async function runOpenshiftPodDelete(selectedPods: { cluster: string; namespace: string; pod: string }[], consent: boolean) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      const r = await opsxApi.podDeleteOpenshift(env, tenant, pairs, selectedPods, consent);
      if (!r.ok) {
        setError(r.message || "Pod silme işi başlatılamadı.");
        return;
      }
      setResult(r);
      setStep("done");
      if (r.jobId != null) {
        setPodDeleteJob({ awxServerId: r.awxServerId, jobId: r.jobId });
        trackJob(r);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  function handleOcpOperation(ocOperation: OpsxOcpOperation) {
    if (ocOperation === "poddelete") {
      // Pod silme: dump ile ayni kesif + secim adimi, dump secenekleri yerine onay kutusu.
      setPodDeleteMode(true);
      setDumpType("threaddump"); // adimin zorunlu prop'u; poddelete modunda kullanilmaz
      setStep("ocp_pods");
      return;
    }
    if (DUMP_OPERATIONS.has(ocOperation)) {
      // Pod keşfi/dump artık pairs'teki TÜM (namespace,uygulama) çiftlerini birden
      // hedefleyebiliyor (bkz. opsx_openshift_pods.yaml/opsx_openshift_dump.yaml'ın
      // cluster × namespace çapraz çarpımı) — eskiden burada tek çifte zorlanıyordu.
      setDumpType(ocOperation as OpsxDumpType);
      setStep("ocp_pods");
    } else {
      // restart/rollout: hemen tetiklenmez, önce hedeflenecek TEK gerçek cluster sorulur
      // (bkz. OcpClusterPickStep dosya başı notu — AWX `limit` yerine playbook'un `hosts:`
      // satırı doğrudan bu cluster'a şablonlanır, server/opsx/index.cjs).
      setOcOperationPending(ocOperation);
      setStep("ocp_cluster");
    }
  }

  function submitOcpCluster(cluster: string) {
    if (!ocOperationPending) return;
    runOpenshift(ocOperationPending, cluster);
  }

  const canGoBack = backTargetFor(step) !== null;

  const operationSummary = (
    <>
      Uygulama: <span className="font-mono text-[var(--text-primary)]">{app}</span>
      {" · "}
      JBoss: <span className="font-mono text-[var(--text-primary)]">{jbossVersions.map((v) => v ? `JBoss ${v}` : "Bilinmiyor").join(", ")}</span>
      {" · "}
      {hosts.length} sunucu: <span className="font-mono">{hosts.join(", ")}</span>
    </>
  );

  return (
    <div className="max-w-2xl mx-auto space-y-5">
      <div className="flex items-start gap-3">
        {canGoBack && (
          <button
            onClick={back}
            disabled={busy}
            title="Önceki adıma dön"
            className="mt-0.5 flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-lg border border-[var(--border)] text-[var(--text-secondary)] hover:border-[var(--accent)] hover:text-[var(--text-primary)] transition-colors active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none"
          >
            <ArrowLeftIcon className="w-3.5 h-3.5" />
            Geri
          </button>
        )}
        <div className="flex-1">
          <h1 className="page-title">OpsX - Güvenli Uygulama Operasyonları</h1>
          {STEP_TITLES[step] && <p className="mt-1 text-sm font-medium text-[var(--text-muted)]">{STEP_TITLES[step]}</p>}
        </div>
      </div>

      {error && (
        <div className="flex items-start gap-2 bg-red-50 border border-red-100 rounded-xl p-3 text-sm text-red-700">
          <ExclamationTriangleIcon className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      <div key={step} className="card p-5 animate-slide-up">
        {step === "platform" && (
          <PlatformStep
            busy={busy}
            onSelect={(p) => {
              setPlatform(p);
              setStep(p === "legacy" ? "legacy_product" : "ocp_target");
            }}
          />
        )}

        {step === "legacy_product" && (
          <LegacyProductStep busy={busy} onSelect={(p) => { setError(null); setStep(p === "was" ? "was_app" : "legacy_app"); }} />
        )}

        {step === "was_app" && (
          <WasAppSearchStep
            busy={busy}
            onSubmit={(v) => {
              setError(null);
              setWasSel(v);
              setWasTarget(null);
              setWasOperation(null);
              setWasDiscovery(null);
              setStep("was_jvm");
            }}
          />
        )}

        {step === "was_jvm" && wasSel && (
          <WasJvmSelectStep
            app={wasSel.app}
            hosts={wasSel.hosts}
            hostInfo={wasSel.hostInfo}
            busy={busy}
            resume={wasDiscovery ? { jobId: wasDiscovery.jobId, awxServerId: wasDiscovery.awxServerId } : null}
            onSubmit={(v) => {
              setError(null);
              setWasTarget(v.target);
              setWasOperation(v.operation);
              setWasDiscovery(v.discovery);
              setStep("was_confirm");
            }}
          />
        )}

        {step === "was_confirm" && wasSel && wasTarget && wasOperation && (
          <WasConfirmStep
            app={wasSel.app}
            target={wasTarget}
            operation={wasOperation}
            env={wasEnv}
            busy={busy}
            onConfirm={runWas}
          />
        )}

        {step === "was_done" && wasTarget && wasOperation && wasRun?.jobId != null && (
          <WasResultPanel
            target={wasTarget}
            operation={wasOperation}
            env={wasEnv}
            jobId={wasRun.jobId}
            awxStatus={trackedJob?.status || wasRun.status || "pending"}
            output={trackedJob?.output || ""}
            run={trackedJob?.result as WasRunStatus | undefined}
            pollErr={trackedJob?.pollErr}
            title={trackedJob?.title || `OpsX WAS #${wasRun.jobId}`}
            onNew={restart}
            launchWarning={wasRun.historyWritten === false ? wasRun.warning : undefined}
          />
        )}

        {step === "legacy_app" && (
          <AppSearchStep
            busy={busy}
            onSelect={(a) => { setApp(a); setJbossVersions([]); setHosts([]); setStep("legacy_jboss_version"); }}
          />
        )}

        {step === "legacy_jboss_version" && (
          <JbossVersionStep
            app={app}
            busy={busy}
            onSubmit={(v) => { setJbossVersions(v); setHosts([]); setHostMajors([]); setStep("legacy_hosts"); }}
          />
        )}

        {step === "legacy_hosts" && (
          <HostSelectStep
            app={app}
            jbossVersions={jbossVersions}
            busy={busy}
            onSubmit={(v) => { setHosts(v.hosts); setHostMajors(v.hostMajors); setStep("operation"); }}
          />
        )}

        {step === "ocp_target" && (
          <OcpTargetStep busy={busy} onSubmit={submitOcpTarget} />
        )}

        {step === "operation" && (
          <OperationStep summary={operationSummary} application={app} hosts={hosts} busy={busy} onSelect={handleLegacyOperation} />
        )}

        {step === "legacy_jvm" && dumpType && (
          <LegacyJvmSelectStep
            application={app}
            hosts={hosts}
            hostMajors={hostMajors}
            busy={busy}
            onSubmit={(v) => runLegacyDump(dumpType, v.pidMap)}
          />
        )}

        {step === "legacy_serverconfig" && pendingOperation && (
          <ServerConfigSelectStep
            application={app}
            hosts={hosts}
            hostMajors={hostMajors}
            operation={pendingOperation}
            busy={busy}
            onSubmit={(v) => runLegacy(pendingOperation, v.serverConfigMap)}
          />
        )}

        {step === "ocp_operation" && (
          <OcpOperationStep env={env} tenant={tenant} pairs={pairs} busy={busy} onSelect={handleOcpOperation} />
        )}

        {step === "ocp_cluster" && (
          <OcpClusterPickStep env={env} tenant={tenant} busy={busy} onSubmit={submitOcpCluster} />
        )}

        {step === "ocp_pods" && dumpType && pairs.length > 0 && (
          <OcpPodSelectStep
            env={env}
            tenant={tenant}
            pairs={pairs}
            dumpType={dumpType}
            mode={podDeleteMode ? "poddelete" : "dump"}
            busy={busy}
            onSubmit={(v) => (podDeleteMode ? runOpenshiftPodDelete(v.pods, v.consent) : runOpenshiftDump(dumpType, v.pods, v.threadDumpCount, v.threadDumpInterval))}
          />
        )}

        {step === "done" && result && (
          <div className="flex flex-col items-center gap-4 py-6 text-center">
            {/* ONAY BEKLEYEN TALEP "BASLATILDI" DEGILDIR (2026-10-06): production
                islemleri Smart onayindan geciyor ve o anda AWX'te is YOK. Yesil
                "Islem baslatildi" yazmak, kullanicinin isin kostugunu sanmasi
                demekti - sonra da "neden hicbir sey olmadi" sorusu. */}
            {/* `result` bir BIRLESIM: dump sonuclari onay kapisina HIC girmez (salt tani),
                o yuzden alan varligiyla daraltiliyor. */}
            {'pendingApproval' in result && result.pendingApproval ? (
              <>
                <ClockIcon className="w-10 h-10 text-amber-500" />
                <div>
                  <p className="text-sm font-medium text-[var(--text-primary)]">
                    Onay bekleniyor — iş henüz başlamadı.
                  </p>
                  <p className="mt-1 text-xs text-[var(--text-secondary)]">{result.message}</p>
                  {'externalTicketId' in result && result.externalTicketId && (
                    <p className="mt-1 text-xs text-[var(--text-muted)]">
                      Smart kayıt no: <span className="font-mono">{result.externalTicketId}</span>
                    </p>
                  )}
                  {'staleWarning' in result && result.staleWarning && (
                    <p className="mt-2 text-xs text-amber-600">{result.staleWarning}</p>
                  )}
                </div>
              </>
            ) : (
              <>
                <CheckCircleIcon className="w-10 h-10 text-green-600" />
                <div>
                  <p className="text-sm font-medium text-[var(--text-primary)]">İşlem başlatıldı.</p>
                  {result.jobId != null && (
                    <p className="mt-1 text-xs text-[var(--text-muted)]">
                      AWX Job: <span className="font-mono">#{result.jobId}</span>
                    </p>
                  )}
                </div>
              </>
            )}

            {/* Ham AWX log terminali dump akışlarında GÖSTERİLMEZ — aşağıdaki "Dump
                Sonuçları" zaten sonucu (indirme butonu/hata) net gösteriyor, ham stdout
                kullanıcının kafasını karıştırıyordu. restart/stop/start'ta (dumpJob null)
                canlı ilerlemeyi görmek hâlâ faydalı, orada aynen kalır. */}
            {trackedJob && !dumpJob && (
              <div className="w-full text-left">
                <AnsibleLogTerminal
                  output={trackedJob.output}
                  status={trackedJob.status || result.status || "pending"}
                  title={trackedJob.title}
                />
                {trackedJob.pollErr && <p className="mt-1.5 text-xs text-amber-600">{trackedJob.pollErr}</p>}
              </div>
            )}

            {/* Pod silme sonuçları (2026-09-18): pod başına Silindi / Bulunamadı / Hata */}
            {podDeleteJob && (
              <div className="w-full text-left bg-[var(--bg-elevated)] rounded-xl p-3 space-y-2">
                <div className="text-xs font-medium text-[var(--text-muted)]">
                  Pod Silme Sonuçları
                  {podDeleteStatus?.overallStatus && (
                    <span className={`ml-2 px-1.5 py-0.5 rounded text-[10px] ${podDeleteStatus.overallStatus === "ok" ? "bg-green-100 text-green-700" : podDeleteStatus.overallStatus === "partial" ? "bg-amber-100 text-amber-800" : "bg-red-100 text-red-700"}`}>
                      {podDeleteStatus.overallStatus === "ok" ? "hepsi silindi" : podDeleteStatus.overallStatus === "partial" ? "kısmen" : "başarısız"}
                    </span>
                  )}
                </div>
                {podDeleteStatus?.results && podDeleteStatus.results.length > 0 ? (
                  podDeleteStatus.results.map((r, i) => (
                    <div key={i} className="flex items-center justify-between gap-2 px-3 py-2 border border-[var(--border)] rounded-lg bg-[var(--bg-base)]">
                      <span className="text-sm font-mono text-[var(--text-primary)] truncate" title={`${r.cluster} / ${r.namespace}`}>
                        {r.pod} <span className="text-xs text-[var(--text-muted)]">· {r.namespace} · {r.cluster}</span>
                      </span>
                      {r.ok ? (
                        <span className="text-xs text-green-700">Silindi · yeni pod ayağa kalkıyor</span>
                      ) : (
                        <span className="text-xs text-red-600">{r.existence === "Not Exist" ? "Bulunamadı" : "Başarısız"}{r.error ? ` — ${r.error}` : ""}</span>
                      )}
                    </div>
                  ))
                ) : podDeleteStatus?.message ? (
                  <p className="text-xs text-amber-700">{podDeleteStatus.message}</p>
                ) : (
                  <p className="text-xs text-[var(--text-muted)]">Pod'lar siliniyor, lütfen bekleyin…</p>
                )}
              </div>
            )}

            {/* Dump indirme sonuçları — restart/stop/start'ta HİÇ görünmez (dumpJob null
                kalır). Job tamamlanana kadar "alınıyor" mesajı, sonra host/namespace başına
                bir indirme butonu ya da hata gösterilir. */}
            {dumpJob && (
              <div className="w-full text-left bg-[var(--bg-elevated)] rounded-xl p-3 space-y-2">
                <div className="text-xs font-medium text-[var(--text-muted)]">Dump Sonuçları</div>
                {dumpStatus?.results && dumpStatus.results.length > 0 ? (
                  dumpStatus.results.map((r, i) => (
                    <div
                      key={i}
                      className="flex items-center justify-between gap-2 px-3 py-2 border border-[var(--border)] rounded-lg bg-[var(--bg-base)]"
                    >
                      {/* Etiket kaynağa göre değişir: Legacy host (+PID) bazlı; Openshift'te
                          arşiv kaydı cluster+namespace(ler)+pod LİSTESİ, başarısız kayıtlar
                          tek cluster/pod taşır. */}
                      <span className="text-sm font-mono text-[var(--text-primary)] truncate">
                        {r.host
                          ? `${r.host}${r.pid ? ` · PID ${r.pid}` : ""}`
                          : (r.pods?.length
                              ? `${r.cluster ? `${r.cluster} · ` : ""}${r.namespaces?.join(",") ? `${r.namespaces.join(",")} · ` : ""}${r.pods.length} pod`
                              : null)
                          || (r.pod ? `${r.cluster ? `${r.cluster}/` : ""}${r.pod}` : null)
                          || (r.application ? `${r.namespace}/${r.application}` : r.namespace)}
                      </span>
                      {r.ok && r.downloadToken ? (
                        <a
                          href={opsxApi.dumpDownloadUrl(r.downloadToken)}
                          className="btn-secondary text-xs flex items-center gap-1"
                        >
                          <ArrowDownTrayIcon className="w-3.5 h-3.5" />
                          İndir
                        </a>
                      ) : (
                        <span className="text-xs text-red-600">{r.error || "Başarısız"}</span>
                      )}
                    </div>
                  ))
                ) : dumpStatus?.message ? (
                  <p className="text-xs text-amber-700">{dumpStatus.message}</p>
                ) : (
                  <p className="text-xs text-[var(--text-muted)]">Dump alınıyor, lütfen bekleyin…</p>
                )}
              </div>
            )}

            {/* Job'a gerçekten NE gönderildiğini göster — kullanıcı beklediği parametrelerin
                gittiğini doğrulayabilsin (özellikle virgülle ayrılmış sunucu listesi).
                Dump akışlarında GÖSTERİLMEZ — ham extra_vars JSON'u kullanıcının kafasını
                karıştırıyordu, "Dump Sonuçları" zaten yeterli. */}
            {!dumpJob && (
              <div className="w-full text-left bg-[var(--bg-elevated)] rounded-xl p-3">
                <div className="text-xs mb-1 text-[var(--text-muted)]">AWX'e gönderilen gövde:</div>
                <pre className="text-xs font-mono whitespace-pre-wrap break-all">
                  {JSON.stringify(result.sentBody, null, 2)}
                </pre>
              </div>
            )}
            <button onClick={restart} className="btn-primary">
              <ArrowPathIcon className="w-4 h-4" />
              Yeni İşlem
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default OpsXWizardPage;
