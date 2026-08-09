// src/components/opsx/OpsXWizardPage.tsx — OpsX sihirbazı: platform → (Legacy:
// uygulama → sunucular | OpenShift: ortam/cluster) → işlem seçimi → tetikleme.
//
// LogX'ten YAPISAL FARK: LogX her adımı sunucudaki logx_v2_requests.state'e yazar
// (uzun süren discovery/transfer job'ları ve sayfa yenilemesinden sonra devam
// gerektirdiği için). OpsX'te adımlar arası kalıcı bir sunucu durumu YOK — akış
// kısa ve tek bir tetiklemeyle bitiyor, dolayısıyla adım durumu client'ta tutulur.
// Güvenlik buna dayanmaz: son POST /api/opsx/run çağrısında sunucu uygulama-host
// eşleşmesini ve cluster'ı envanterden YENİDEN doğrular.
import React, { useState } from "react";
import { ArrowLeftIcon, CheckCircleIcon, ExclamationTriangleIcon, ArrowPathIcon } from "@heroicons/react/24/outline";
import { opsxApi, type OpsxPlatform, type OpsxOperation, type OpsxOcpOperation, type OpsxOcpPair, type OpsxRunResult } from "@/api/opsxApi";
import { useJobTracker } from "@/contexts/JobTrackerContext";
import AnsibleLogTerminal from "@/components/common/AnsibleLogTerminal";
import PlatformStep from "./steps/PlatformStep";
import AppSearchStep from "./steps/AppSearchStep";
import JbossVersionStep from "./steps/JbossVersionStep";
import HostSelectStep from "./steps/HostSelectStep";
import OcpTargetStep from "./steps/OcpTargetStep";
import OperationStep from "./steps/OperationStep";
import OcpOperationStep from "./steps/OcpOperationStep";

type Step =
  | "platform"
  | "legacy_app"
  | "legacy_jboss_version"
  | "legacy_hosts"
  | "ocp_target"
  | "operation"
  | "ocp_operation"
  | "done";

const STEP_TITLES: Record<Step, string> = {
  platform: "",
  legacy_app: "Uygulama Seçimi",
  legacy_jboss_version: "JBoss Sürümü",
  legacy_hosts: "Sunucu Seçimi",
  ocp_target: "Openshift Hedefi",
  operation: "İşlem Seçimi",
  ocp_operation: "İşlem Seçimi",
  done: "İşlem Başlatıldı",
};

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
  const [result, setResult] = useState<OpsxRunResult | null>(null);
  const [trackedJobId, setTrackedJobId] = useState<string | null>(null);
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
  }

  function trackJob(r: OpsxRunResult) {
    if (r.jobId == null) return;
    const id = addJob({
      title: `OpsX #${r.jobId}`,
      fetchStatus: () => opsxApi.jobStatus(r.awxServerId, r.jobId as number),
    });
    setTrackedJobId(id);
  }

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

  const canGoBack = backTargetFor(step) !== null;

  const operationSummary = (
    <>
      Uygulama: <span className="font-mono text-[var(--text-primary)]">{app}</span>
      {" · "}
      JBoss: <span className="font-mono text-[var(--text-primary)]">{jbossVersions.map((v) => v || "Bilinmiyor").join(", ")}</span>
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
          <OperationStep summary={operationSummary} application={app} hosts={hosts} busy={busy} onSelect={runLegacy} />
        )}

        {step === "ocp_operation" && (
          <OcpOperationStep env={env} tenant={tenant} pairs={pairs} busy={busy} onSelect={runOpenshift} />
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
