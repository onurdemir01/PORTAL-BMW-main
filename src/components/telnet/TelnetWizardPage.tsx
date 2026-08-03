// src/components/telnet/TelnetWizardPage.tsx — Telnet sihirbazı: OpsX'in Legacy/Openshift
// + uygulama/sunucu seçim akışının BİREBİR kopyası (kullanıcı isteği); son adımda bir
// İŞLEM (restart/stop/...) değil, IP + Port sorulur ve tek bir bağlantı testi tetiklenir.
//
// OpsX'ten YAPISAL FARK: Openshift'te "Uygulama Adı" sorulmaz (yalnızca namespace) ve
// extra_vars'a `application` HİÇ eklenmez — Telnet'in AWX gövdesi yalnızca ip/port taşır
// (kullanıcı sartnamesi). Güvenlik OpsX ile AYNI: son POST /api/telnet/run çağrısında
// sunucu uygulama-host eşleşmesini ve cluster'ı envanterden YENİDEN doğrular.
import React, { useEffect, useState } from "react";
import { ArrowLeftIcon, CheckCircleIcon, ExclamationTriangleIcon, ArrowPathIcon } from "@heroicons/react/24/outline";
import { telnetApi, type TelnetPlatform, type TelnetRunResult } from "@/api/telnetApi";
import AnsibleLogTerminal from "@/components/common/AnsibleLogTerminal";
import PlatformStep from "./steps/PlatformStep";
import AppSearchStep from "./steps/AppSearchStep";
import JbossVersionStep from "./steps/JbossVersionStep";
import HostSelectStep from "./steps/HostSelectStep";
import OcpTargetStep from "./steps/OcpTargetStep";
import TelnetInputStep from "./steps/TelnetInputStep";

type Step =
  | "platform"
  | "legacy_app"
  | "legacy_jboss_version"
  | "legacy_hosts"
  | "ocp_target"
  | "telnet_input"
  | "done";

const STEP_TITLES: Record<Step, string> = {
  platform: "",
  legacy_app: "Uygulama Seçimi",
  legacy_jboss_version: "JBoss Sürümü",
  legacy_hosts: "Sunucu Seçimi",
  ocp_target: "Openshift Hedefi",
  telnet_input: "Telnet Hedefi",
  done: "Test Başlatıldı",
};

const TelnetWizardPage: React.FC = () => {
  const [step, setStep] = useState<Step>("platform");
  const [platform, setPlatform] = useState<TelnetPlatform | null>(null);
  const [app, setApp] = useState("");
  const [jbossVersions, setJbossVersions] = useState<string[]>([]);
  const [hosts, setHosts] = useState<string[]>([]);
  const [env, setEnv] = useState("");
  const [tenant, setTenant] = useState("");
  const [clusters, setClusters] = useState<string[]>([]);
  const [namespace, setNamespace] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<TelnetRunResult | null>(null);

  // Canlı iş takibi — OpsX'teki AYNI kendini-zamanlayan adaptif polling deseni.
  const [jobOutput, setJobOutput] = useState("");
  const [jobStatus, setJobStatus] = useState("");
  const [pollErr, setPollErr] = useState("");

  // Çıktı satır filtresi — Self Service'teki output-filter fikrinin istemci-tarafı,
  // ad-hoc karşılığı: kalıcı bir admin ayarı değil, kullanıcı sonuç ekranında istediği
  // an açıp kapatabildiği bir görüntüleme seçeneği (yalnızca EKRANDA gösterileni
  // daraltır, gerçek job çıktısını değiştirmez).
  const [filterEnabled, setFilterEnabled] = useState(false);
  const [filterPrefix, setFilterPrefix] = useState("");

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
    setError(null);
    setResult(null);
    setJobOutput("");
    setJobStatus("");
    setPollErr("");
    setFilterEnabled(false);
    setFilterPrefix("");
  }

  function backTargetFor(s: Step): Step | null {
    switch (s) {
      case "legacy_app":
      case "ocp_target":
        return "platform";
      case "legacy_jboss_version":
        return "legacy_app";
      case "legacy_hosts":
        return "legacy_jboss_version";
      case "telnet_input":
        return platform === "openshift" ? "ocp_target" : "legacy_hosts";
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

  async function runTelnet(ip: string, port: string) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const body = platform === "openshift"
        ? { platform: "openshift" as const, env, tenant, clusters, namespace, ip, port }
        : { platform: "legacy" as const, application: app, hosts, ip, port };
      const r = await telnetApi.run(body);
      setResult(r);
      setStep("done");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const canGoBack = backTargetFor(step) !== null;

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
        const r = await telnetApi.jobStatus(serverId, jobId);
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

  const inputSummary = platform === "openshift" ? (
    <>
      Namespace: <span className="font-mono text-[var(--text-primary)]">{namespace}</span>
      {" · "}
      Cluster(lar): <span className="font-mono">{clusters.join(", ")}</span>
    </>
  ) : (
    <>
      Uygulama: <span className="font-mono text-[var(--text-primary)]">{app}</span>
      {" · "}
      {hosts.length} sunucu: <span className="font-mono">{hosts.join(", ")}</span>
    </>
  );

  const displayedOutput = filterEnabled && filterPrefix
    ? jobOutput.split("\n").filter((l) => l.startsWith(filterPrefix)).join("\n")
    : jobOutput;

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
          <h1 className="page-title">Telnet - Bağlantı Testi</h1>
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
            onSubmit={(h) => { setHosts(h); setStep("telnet_input"); }}
          />
        )}

        {step === "ocp_target" && (
          <OcpTargetStep
            busy={busy}
            onSubmit={(v) => { setEnv(v.env); setTenant(v.tenant); setClusters(v.clusters); setNamespace(v.namespace); setStep("telnet_input"); }}
          />
        )}

        {step === "telnet_input" && (
          <TelnetInputStep summary={inputSummary} busy={busy} onSubmit={(v) => runTelnet(v.ip, v.port)} />
        )}

        {step === "done" && result && (
          <div className="flex flex-col items-center gap-4 py-6 text-center">
            <CheckCircleIcon className="w-10 h-10 text-green-600" />
            <div>
              <p className="text-sm font-medium text-[var(--text-primary)]">Telnet testi başlatıldı.</p>
              {result.jobId != null && (
                <p className="mt-1 text-xs text-[var(--text-muted)]">
                  AWX Job: <span className="font-mono">#{result.jobId}</span>
                </p>
              )}
            </div>

            {result.jobId != null && (
              <div className="w-full text-left space-y-2">
                {/* Çıktı satır filtresi — yalnızca EKRANDA gösterileni daraltır. */}
                <div className="flex items-center gap-2 flex-wrap">
                  <label className="flex items-center gap-1.5 text-xs text-[var(--text-secondary)] cursor-pointer">
                    <input
                      type="checkbox"
                      checked={filterEnabled}
                      onChange={(e) => setFilterEnabled(e.target.checked)}
                      className="rounded"
                    />
                    Sadece şu karakterle başlayan satırları göster:
                  </label>
                  <input
                    value={filterPrefix}
                    onChange={(e) => setFilterPrefix(e.target.value)}
                    disabled={!filterEnabled}
                    placeholder="ör: >"
                    className="w-20 px-2 py-1 text-xs font-mono border border-[var(--border)] rounded-lg outline-none focus:border-[var(--accent)] disabled:opacity-50"
                  />
                </div>
                <AnsibleLogTerminal
                  output={displayedOutput}
                  status={jobStatus || result.status || "pending"}
                  title={`telnet-job-${result.jobId}`}
                />
                {pollErr && <p className="mt-1.5 text-xs text-amber-600">{pollErr}</p>}
              </div>
            )}

            <div className="w-full text-left bg-[var(--bg-elevated)] rounded-xl p-3">
              <div className="text-xs mb-1 text-[var(--text-muted)]">AWX'e gönderilen gövde:</div>
              <pre className="text-xs font-mono whitespace-pre-wrap break-all">
                {JSON.stringify(result.sentBody, null, 2)}
              </pre>
            </div>
            <button onClick={restart} className="btn-primary">
              <ArrowPathIcon className="w-4 h-4" />
              Yeni Test
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default TelnetWizardPage;
