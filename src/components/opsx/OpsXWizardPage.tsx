// src/components/opsx/OpsXWizardPage.tsx — OpsX sihirbazı: platform → (Legacy:
// uygulama → sunucular | OpenShift: ortam/cluster) → işlem seçimi → tetikleme.
//
// LogX'ten YAPISAL FARK: LogX her adımı sunucudaki logx_v2_requests.state'e yazar
// (uzun süren discovery/transfer job'ları ve sayfa yenilemesinden sonra devam
// gerektirdiği için). OpsX'te adımlar arası kalıcı bir sunucu durumu YOK — akış
// kısa ve tek bir tetiklemeyle bitiyor, dolayısıyla adım durumu client'ta tutulur.
// Güvenlik buna dayanmaz: son POST /api/opsx/run çağrısında sunucu uygulama-host
// eşleşmesini ve cluster'ı envanterden YENİDEN doğrular.
import React, { useEffect, useRef, useState } from "react";
import { ArrowLeftIcon, CheckCircleIcon, ExclamationTriangleIcon, ArrowPathIcon } from "@heroicons/react/24/outline";
import { opsxApi, type OpsxPlatform, type OpsxOperation, type OpsxRunResult } from "@/api/opsxApi";
import AnsibleLogTerminal from "@/components/common/AnsibleLogTerminal";
import PlatformStep from "./steps/PlatformStep";
import AppSearchStep from "./steps/AppSearchStep";
import JbossVersionStep from "./steps/JbossVersionStep";
import HostSelectStep from "./steps/HostSelectStep";
import OcpTargetStep from "./steps/OcpTargetStep";
import OperationStep from "./steps/OperationStep";

type Step =
  | "platform"
  | "legacy_app"
  | "legacy_jboss_version"
  | "legacy_hosts"
  | "ocp_target"
  | "operation"
  | "done";

const STEP_TITLES: Record<Step, string> = {
  platform: "",
  legacy_app: "Uygulama Seçimi",
  legacy_jboss_version: "JBoss Sürümü",
  legacy_hosts: "Sunucu Seçimi",
  ocp_target: "Openshift Hedefi",
  operation: "İşlem Seçimi",
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
  const [clusters, setClusters] = useState<string[]>([]);
  const [namespace, setNamespace] = useState("");
  const [appName, setAppName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<OpsxRunResult | null>(null);
  // Canlı iş takibi — Self Service'teki ssJobStatus polling'inin OpsX karşılığı.
  const [jobOutput, setJobOutput] = useState("");
  const [jobStatus, setJobStatus] = useState("");
  const [pollErr, setPollErr] = useState("");

  function restart() {
    setStep("platform");
    setPlatform(null);
    setApp("");
    setJbossVersions([]);
    setHosts([]);
    setEnv("");
    setTenant("");
    setClusters([]);
    setNamespace("");
    setAppName("");
    setError(null);
    setResult(null);
    setJobOutput("");
    setJobStatus("");
    setPollErr("");
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

  // Legacy: uygulama + sunucular + islem. Openshift: env/tenant/cluster + namespace +
  // app_name (islem SEÇİMİ YOK — sartnamedeki Openshift gövdesinde `operation` alanı
  // bulunmuyor; gerekirse Admin > OpsX Yapılandırma'dan sabit değişken olarak eklenir).
  async function runLegacy(operation: OpsxOperation) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await opsxApi.run({ platform: "legacy", application: app, operation, hosts });
      setResult(r);
      setStep("done");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function runOpenshift(v: { env: string; tenant: string; clusters: string[]; namespace: string; appName: string }) {
    if (busy) return;
    setBusy(true);
    setError(null);
    setEnv(v.env); setTenant(v.tenant); setClusters(v.clusters);
    setNamespace(v.namespace); setAppName(v.appName);
    try {
      const r = await opsxApi.run({ platform: "openshift", ...v });
      setResult(r);
      setStep("done");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const canGoBack = backTargetFor(step) !== null;

  // Canlı log polling'i — Self Service'in SurveyModal'ındaki AYNI desen: SSE değil,
  // kendini-zamanlayan uyarlanabilir döngü. Stdout akarken hızlı yoklar, henüz
  // çıktı yokken biraz daha yavaş, geçici hatada (oturum yenilenmesi/ağ titremesi)
  // hemen pes etmez — artan gecikmeyle ~50sn boyunca tekrar dener.
  useEffect(() => {
    if (step !== "done" || result?.jobId == null) return;
    const serverId = result.awxServerId;
    const jobId = result.jobId;

    let stopped = false;
    let consecutiveErrors = 0;
    let timer: number | undefined;

    const RUN_MS = 1500;
    const IDLE_MS = 3000;
    const MAX_ERRORS = 12;

    const schedule = (ms: number) => { if (!stopped) timer = window.setTimeout(tick, ms); };

    const tick = async () => {
      if (stopped) return;
      try {
        const r = await opsxApi.jobStatus(serverId, jobId);
        consecutiveErrors = 0;
        setPollErr("");
        setJobStatus(r.status);
        if (r.output) setJobOutput(r.output);
        const terminal = r.status === "successful" || r.status === "failed" || r.status === "error" || r.status === "canceled";
        if (terminal) {
          if (!r.output && (r.status === "failed" || r.status === "error")) {
            setJobOutput("Job başarısız oldu ancak AWX bu iş için stdout döndürmedi. AWX arayüzünden job detayını kontrol edin.");
          }
          stopped = true;
          return;
        }
        schedule(r.output ? RUN_MS : IDLE_MS);
      } catch (e: unknown) {
        consecutiveErrors++;
        if (consecutiveErrors >= MAX_ERRORS) {
          setPollErr(`Durum güncellenemiyor: ${e instanceof Error ? e.message : String(e)}`);
          stopped = true;
          return;
        }
        setPollErr(`Bağlantı yenileniyor… (deneme ${consecutiveErrors}/${MAX_ERRORS})`);
        schedule(Math.min(RUN_MS * consecutiveErrors, 6000));
      }
    };

    tick();
    return () => { stopped = true; if (timer) window.clearTimeout(timer); };
  }, [step, result]);

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
          <OcpTargetStep busy={busy} onSubmit={runOpenshift} />
        )}

        {step === "operation" && (
          <OperationStep summary={operationSummary} application={app} hosts={hosts} busy={busy} onSelect={runLegacy} />
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

            {/* Canlı iş takibi — Self Service'teki aynı terminal bileşeni. */}
            {result.jobId != null && (
              <div className="w-full text-left">
                <AnsibleLogTerminal
                  output={jobOutput}
                  status={jobStatus || result.status || "pending"}
                  title={`opsx-job-${result.jobId}`}
                />
                {pollErr && <p className="mt-1.5 text-xs text-amber-600">{pollErr}</p>}
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
