// src/components/opsx/OpsXWizardPage.tsx — OpsX sihirbazı: platform → (Legacy:
// uygulama → sunucular | OpenShift: ortam/cluster) → işlem seçimi → tetikleme.
//
// LogX'ten YAPISAL FARK: LogX her adımı sunucudaki logx_v2_requests.state'e yazar
// (uzun süren discovery/transfer job'ları ve sayfa yenilemesinden sonra devam
// gerektirdiği için). OpsX'te adımlar arası kalıcı bir sunucu durumu YOK — akış
// kısa ve tek bir tetiklemeyle bitiyor, dolayısıyla adım durumu client'ta tutulur.
// Güvenlik buna dayanmaz: son POST /api/opsx/run çağrısında sunucu uygulama-host
// eşleşmesini ve cluster'ı envanterden YENİDEN doğrular.
import React, { useEffect, useState } from "react";
import { ArrowLeftIcon, CheckCircleIcon, ExclamationTriangleIcon, ArrowPathIcon, ArrowDownTrayIcon } from "@heroicons/react/24/outline";
import {
  opsxApi,
  type OpsxPlatform, type OpsxOperation, type OpsxOcpOperation, type OpsxOcpPair,
  type OpsxRunResult, type OpsxDumpType, type OpsxDumpLaunchResult, type OpsxDumpStatus,
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
import OcpPodSelectStep from "./steps/OcpPodSelectStep";

type Step =
  | "platform"
  | "legacy_app"
  | "legacy_jboss_version"
  | "legacy_hosts"
  | "ocp_target"
  | "operation"
  | "ocp_operation"
  | "ocp_pods"
  | "done";

const STEP_TITLES: Record<Step, string> = {
  platform: "",
  legacy_app: "Uygulama Seçimi",
  legacy_jboss_version: "JBoss Sürümü",
  legacy_hosts: "Sunucu Seçimi",
  ocp_target: "Openshift Hedefi",
  operation: "İşlem Seçimi",
  ocp_operation: "İşlem Seçimi",
  ocp_pods: "Pod Seçimi",
  done: "İşlem Başlatıldı",
};

const DUMP_OPERATIONS = new Set(["threaddump", "heapdump"]);

const OpsXWizardPage: React.FC = () => {
  const [step, setStep] = useState<Step>("platform");
  const [platform, setPlatform] = useState<OpsxPlatform | null>(null);
  const [app, setApp] = useState("");
  const [jbossVersions, setJbossVersions] = useState<string[]>([]);
  const [hosts, setHosts] = useState<string[]>([]);
  const [env, setEnv] = useState("");
  const [tenant, setTenant] = useState("");
  const [pairs, setPairs] = useState<OpsxOcpPair[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<OpsxRunResult | OpsxDumpLaunchResult | null>(null);
  const [trackedJobId, setTrackedJobId] = useState<string | null>(null);
  // Dump akışı restart/stop/start'tan FARKLI: iş bitince indirilecek bir dosya üretir.
  // dumpJob dolu olduğu sürece ayrı bir interval bu bilgiyi (server/opsx/index.cjs
  // GET /dump/:serverId/:jobId/status) poll eder — trackJob'un genel AWX log takibinden
  // BAĞIMSIZ, aynı SelfServicePage.tsx'teki Smart ticket polling deseni.
  const [dumpJob, setDumpJob] = useState<{ awxServerId: number; jobId: number } | null>(null);
  const [dumpStatus, setDumpStatus] = useState<OpsxDumpStatus | null>(null);
  // Openshift'te işlem seçimi ile dump'ın tetiklenmesi arasında bir pod seçim adımı
  // olduğu için, seçilen dump tipi o adım boyunca burada tutulur.
  const [dumpType, setDumpType] = useState<OpsxDumpType | null>(null);
  const { addJob, jobs } = useJobTracker();
  // Bu sayfa açıkken CANLI çıktıyı kendi içinde (inline) gösterir — takipçiden aynı
  // job'ın güncel verisini okur, kendi polling'ini yapmaz. Sayfadan ayrılınca (ya da
  // "Yeni İşlem" ile sıfırlanınca) bu inline görünüm kaybolur ama job arka planda
  // takip edilmeye devam eder (alt çubuktaki sekme) — AYNI iş için iki ayrı pencere
  // birden açılmaz (bkz. JobTrackerContext.tsx).
  const trackedJob = trackedJobId ? jobs.find((j) => j.id === trackedJobId) : undefined;

  function restart() {
    setStep("platform");
    setPlatform(null);
    setApp("");
    setJbossVersions([]);
    setHosts([]);
    setEnv("");
    setTenant("");
    setPairs([]);
    setError(null);
    setResult(null);
    setTrackedJobId(null);
    setDumpJob(null);
    setDumpStatus(null);
    setDumpType(null);
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
      case "legacy_app":
      case "ocp_target":
        return "platform";
      case "legacy_jboss_version":
        return "legacy_app";
      case "legacy_hosts":
        return "legacy_jboss_version";
      case "operation":
        return "legacy_hosts";
      case "ocp_operation":
        return "ocp_target";
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

  // Legacy: uygulama + sunucular + islem. Openshift: env/oc_cluster + oc_input (bir veya
  // daha fazla namespace/uygulama cifti) + islem (su an SADECE restart aktif).
  async function runLegacy(operation: OpsxOperation) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await opsxApi.run({ platform: "legacy", application: app, operation, hosts });
      setResult(r);
      setStep("done");
      trackJob(r);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  // threaddump/heapdump AYRI bir AWX template'ine (opsx_legacy_dump) gider — restart'ın
  // /api/opsx/run'ından farklı olarak sonucu bir indirme listesine dönüşür (bkz. dumpStatus
  // polling'i yukarıda).
  async function runLegacyDump(dumpType: OpsxDumpType) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await opsxApi.dumpLegacy(app, hosts, dumpType);
      setResult(r);
      setStep("done");
      if (r.jobId != null) {
        setDumpJob({ awxServerId: r.awxServerId, jobId: r.jobId });
        trackJob(r);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  // OperationStep'in tek onSelect'i restart/stop/start İLE threaddump/heapdump'ı AYNI
  // listede sunar (bkz. server/opsx/index.cjs ALLOWED_OPERATIONS) — burada hangi backend
  // yoluna gideceğine ayrılır.
  function handleLegacyOperation(operation: OpsxOperation) {
    if (DUMP_OPERATIONS.has(operation)) {
      runLegacyDump(operation as OpsxDumpType);
    } else {
      runLegacy(operation);
    }
  }

  function submitOcpTarget(v: { env: string; tenant: string; pairs: OpsxOcpPair[] }) {
    setEnv(v.env); setTenant(v.tenant); setPairs(v.pairs);
    setStep("ocp_operation");
  }

  async function runOpenshift(ocOperation: OpsxOcpOperation) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await opsxApi.run({ platform: "openshift", env, tenant, pairs, ocOperation });
      setResult(r);
      setStep("done");
      trackJob(r);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  // Openshift dump POD seviyesinde çalışır — işlem seçildikten sonra doğrudan
  // tetiklenmez, önce pod seçim adımına (canlı AWX keşfi) gidilir.
  async function runOpenshiftDump(
    dumpType: OpsxDumpType,
    selectedPods: string[],
    threadDumpCount: number,
    threadDumpInterval: number,
  ) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await opsxApi.dumpOpenshift(
        env, tenant, pairs[0].namespace, selectedPods, dumpType,
        dumpType === "threaddump" ? threadDumpCount : undefined,
        dumpType === "threaddump" ? threadDumpInterval : undefined,
      );
      setResult(r);
      setStep("done");
      if (r.jobId != null) {
        setDumpJob({ awxServerId: r.awxServerId, jobId: r.jobId });
        trackJob(r);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  function handleOcpOperation(ocOperation: OpsxOcpOperation) {
    if (DUMP_OPERATIONS.has(ocOperation)) {
      // Dump tek bir namespace hedefler (playbook pod bazlı çalışır); OcpTargetStep
      // birden fazla çift biriktirmeye izin verdiği için burada açıkça engellenir —
      // aksi halde kullanıcı sessizce yalnızca ilk çiftin pod'larını görürdü.
      if (pairs.length !== 1) {
        setError("Dump işlemi tek seferde yalnızca bir namespace hedefleyebilir — lütfen geri dönüp tek bir namespace/uygulama bırakın.");
        return;
      }
      setDumpType(ocOperation as OpsxDumpType);
      setStep("ocp_pods");
    } else {
      runOpenshift(ocOperation);
    }
  }

  const canGoBack = backTargetFor(step) !== null;

  const operationSummary = (
    <>
      Uygulama: <span className="font-mono text-[var(--text-primary)]">{app}</span>
      {" · "}
      JBoss: <span className="font-mono text-[var(--text-primary)]">{jbossVersions.map((v) => v ? `${v}.X` : "Bilinmiyor").join(", ")}</span>
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
              setStep(p === "legacy" ? "legacy_app" : "ocp_target");
            }}
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
            onSubmit={(v) => { setJbossVersions(v); setHosts([]); setStep("legacy_hosts"); }}
          />
        )}

        {step === "legacy_hosts" && (
          <HostSelectStep
            app={app}
            jbossVersions={jbossVersions}
            busy={busy}
            onSubmit={(h) => { setHosts(h); setStep("operation"); }}
          />
        )}

        {step === "ocp_target" && (
          <OcpTargetStep busy={busy} onSubmit={submitOcpTarget} />
        )}

        {step === "operation" && (
          <OperationStep summary={operationSummary} application={app} hosts={hosts} busy={busy} onSelect={handleLegacyOperation} />
        )}

        {step === "ocp_operation" && (
          <OcpOperationStep env={env} tenant={tenant} pairs={pairs} busy={busy} onSelect={handleOcpOperation} />
        )}

        {step === "ocp_pods" && dumpType && pairs.length === 1 && (
          <OcpPodSelectStep
            env={env}
            tenant={tenant}
            namespace={pairs[0].namespace}
            application={pairs[0].application}
            dumpType={dumpType}
            busy={busy}
            onSubmit={(v) => runOpenshiftDump(dumpType, v.pods, v.threadDumpCount, v.threadDumpInterval)}
          />
        )}

        {step === "done" && result && (
          <div className="flex flex-col items-center gap-4 py-6 text-center">
            <CheckCircleIcon className="w-10 h-10 text-green-600" />
            <div>
              <p className="text-sm font-medium text-[var(--text-primary)]">İşlem başlatıldı.</p>
              {result.jobId != null && (
                <p className="mt-1 text-xs text-[var(--text-muted)]">
                  AWX Job: <span className="font-mono">#{result.jobId}</span>
                </p>
              )}
            </div>

            {trackedJob && (
              <div className="w-full text-left">
                <AnsibleLogTerminal
                  output={trackedJob.output}
                  status={trackedJob.status || result.status || "pending"}
                  title={trackedJob.title}
                />
                {trackedJob.pollErr && <p className="mt-1.5 text-xs text-amber-600">{trackedJob.pollErr}</p>}
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
                      {/* Etiket kaynağa göre değişir: Legacy host bazlı; Openshift'te
                          arşiv kaydı pod LİSTESİ, başarısız kayıtlar tek pod taşır. */}
                      <span className="text-sm font-mono text-[var(--text-primary)] truncate">
                        {r.host
                          || (r.pods?.length ? `${r.namespace} · ${r.pods.length} pod` : null)
                          || (r.pod ? `${r.namespace}/${r.pod}` : null)
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
                gittiğini doğrulayabilsin (özellikle virgülle ayrılmış sunucu listesi). */}
            <div className="w-full text-left bg-[var(--bg-elevated)] rounded-xl p-3">
              <div className="text-xs mb-1 text-[var(--text-muted)]">AWX'e gönderilen gövde:</div>
              <pre className="text-xs font-mono whitespace-pre-wrap break-all">
                {JSON.stringify(result.sentBody, null, 2)}
              </pre>
            </div>
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
