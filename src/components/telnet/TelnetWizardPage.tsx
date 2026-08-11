// src/components/telnet/TelnetWizardPage.tsx — Telnet sihirbazı: Legacy OpsX'in
// uygulama/sunucu seçim akışının BİREBİR kopyası (kullanıcı isteği); son adımda bir
// İŞLEM (restart/stop/...) değil, IP + Port sorulur ve bir bağlantı testi tetiklenir.
//
// Legacy: OpsX'ten YAPISAL FARK — "Uygulama Adı" sorulur ama extra_vars'a HİÇ eklenmez
// (yalnız ip/port taşır, kullanıcı şartnamesi). TEK AWX job'i tetiklenir.
//
// Openshift: cluster/bastion seçimi YOK (kullanıcı kararıyla kaldırıldı) — ortam + tenant/
// iş birimi + bir veya daha fazla namespace seçilir, HER namespace için AYRI bir AWX
// job'i tetiklenir (bkz. server/telnet/index.cjs). Bu yüzden "done" adımı Legacy'de TEK
// bir sonuç/log, Openshift'te namespace başına bir sonuç/log gösterir.
//
// Güvenlik OpsX ile AYNI: son POST /api/telnet/run çağrısında sunucu uygulama-host
// eşleşmesini ve namespace/tenant'ı envanterden YENİDEN doğrular.
import React, { useState } from "react";
import { ArrowLeftIcon, CheckCircleIcon, ExclamationTriangleIcon, ArrowPathIcon } from "@heroicons/react/24/outline";
import { telnetApi, type TelnetPlatform, type TelnetRunResult, type TelnetOcpJobResult } from "@/api/telnetApi";
import { useJobTracker } from "@/contexts/JobTrackerContext";
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

interface OcpTrackedJob {
  namespace: string;
  trackedId: string | null;
  message?: string; // launch bu namespace için başarısız olduysa
}

const TelnetWizardPage: React.FC = () => {
  const [step, setStep] = useState<Step>("platform");
  const [platform, setPlatform] = useState<TelnetPlatform | null>(null);
  const [app, setApp] = useState("");
  const [jbossVersions, setJbossVersions] = useState<string[]>([]);
  const [hosts, setHosts] = useState<string[]>([]);
  const [env, setEnv] = useState("");
  const [tenant, setTenant] = useState("");
  const [namespaces, setNamespaces] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Legacy: tek job/sonuç.
  const [result, setResult] = useState<TelnetRunResult | null>(null);
  const [trackedJobId, setTrackedJobId] = useState<string | null>(null);

  // Openshift: namespace başına bir job/sonuç.
  const [ocpTrackedJobs, setOcpTrackedJobs] = useState<OcpTrackedJob[]>([]);

  const { addJob, jobs } = useJobTracker();
  const trackedJob = trackedJobId ? jobs.find((j) => j.id === trackedJobId) : undefined;
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
    setNamespaces([]);
    setError(null);
    setResult(null);
    setTrackedJobId(null);
    setOcpTrackedJobs([]);
    setFilterEnabled(false);
    setFilterPrefix("");
  }

  function trackJob(r: TelnetRunResult) {
    if (r.jobId == null) return;
    const id = addJob({
      title: `Telnet #${r.jobId}`,
      fetchStatus: () => telnetApi.jobStatus(r.awxServerId, r.jobId as number),
      filterable: true,
    });
    setTrackedJobId(id);
  }

  function trackOcpJobs(results: TelnetOcpJobResult[]) {
    setOcpTrackedJobs(results.map((r) => {
      if (r.jobId == null) return { namespace: r.namespace, trackedId: null, message: r.message };
      const id = addJob({
        title: `Telnet #${r.jobId} (${r.namespace})`,
        fetchStatus: () => telnetApi.jobStatus(r.awxServerId, r.jobId as number),
        filterable: true,
      });
      return { namespace: r.namespace, trackedId: id };
    }));
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
      if (platform === "openshift") {
        const r = await telnetApi.run({ platform: "openshift", env, tenant, namespaces, ip, port });
        if ("results" in r) {
          setStep("done");
          trackOcpJobs(r.results);
        }
      } else {
        const r = await telnetApi.run({ platform: "legacy", application: app, hosts, ip, port });
        if (!("results" in r)) {
          // safeJson() 4xx/5xx'te reddetmez — backend'in ok:false + message ile döndüğü
          // hatalar burada kontrol edilmezse kullanıcıya sahte bir "başlatıldı" ekranı gösterilir.
          if (!r.ok) {
            setError(r.message || "İşlem başlatılamadı.");
            return;
          }
          setResult(r);
          setStep("done");
          trackJob(r);
        }
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const canGoBack = backTargetFor(step) !== null;

  const inputSummary = platform === "openshift" ? (
    <>
      Ortam: <span className="font-mono text-[var(--text-primary)]">{env}</span>
      {" · "}
      Tenant: <span className="font-mono text-[var(--text-primary)]">{tenant}</span>
      {" · "}
      {namespaces.length} namespace: <span className="font-mono">{namespaces.join(", ")}</span>
    </>
  ) : (
    <>
      Uygulama: <span className="font-mono text-[var(--text-primary)]">{app}</span>
      {" · "}
      {hosts.length} sunucu: <span className="font-mono">{hosts.join(", ")}</span>
    </>
  );

  const filterLine = (
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
            onSubmit={(v) => { setEnv(v.env); setTenant(v.tenant); setNamespaces(v.namespaces); setStep("telnet_input"); }}
          />
        )}

        {step === "telnet_input" && (
          <TelnetInputStep summary={inputSummary} busy={busy} onSubmit={(v) => runTelnet(v.ip, v.port)} />
        )}

        {step === "done" && platform === "legacy" && result && (
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

            {trackedJob && (
              <div className="w-full text-left space-y-2">
                {filterLine}
                <AnsibleLogTerminal
                  output={filterEnabled && filterPrefix
                    ? trackedJob.output.split("\n").filter((l) => l.startsWith(filterPrefix)).join("\n")
                    : trackedJob.output}
                  status={trackedJob.status || result.status || "pending"}
                  title={trackedJob.title}
                />
                {trackedJob.pollErr && <p className="mt-1.5 text-xs text-amber-600">{trackedJob.pollErr}</p>}
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

        {/* Openshift: namespace başına bir kart — her biri kendi job'ının canlı çıktısını
            ve gönderilen gövdesini gösterir. Bir namespace'in launch'ı başarısız olsa bile
            (r.message dolu) diğerleri etkilenmez — kısmi başarı normal bir durumdur. */}
        {step === "done" && platform === "openshift" && ocpTrackedJobs.length > 0 && (
          <div className="flex flex-col items-center gap-4 py-6 text-center">
            <CheckCircleIcon className="w-10 h-10 text-green-600" />
            <p className="text-sm font-medium text-[var(--text-primary)]">
              {ocpTrackedJobs.length} namespace için Telnet testi başlatıldı.
            </p>

            {ocpTrackedJobs.length > 1 && <div className="w-full text-left">{filterLine}</div>}

            <div className="w-full space-y-4 text-left">
              {ocpTrackedJobs.map((t) => {
                const job = t.trackedId ? jobs.find((j) => j.id === t.trackedId) : undefined;
                return (
                  <div key={t.namespace} className="border border-[var(--border)] rounded-xl p-3 space-y-2">
                    <div className="text-xs font-semibold text-[var(--text-primary)] font-mono">{t.namespace}</div>
                    {t.message ? (
                      <p className="text-xs text-red-600">{t.message}</p>
                    ) : job ? (
                      <>
                        <AnsibleLogTerminal
                          output={filterEnabled && filterPrefix
                            ? job.output.split("\n").filter((l) => l.startsWith(filterPrefix)).join("\n")
                            : job.output}
                          status={job.status || "pending"}
                          title={job.title}
                        />
                        {job.pollErr && <p className="mt-1.5 text-xs text-amber-600">{job.pollErr}</p>}
                      </>
                    ) : (
                      <p className="text-xs text-[var(--text-muted)]">İş başlatılamadı.</p>
                    )}
                  </div>
                );
              })}
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
