// src/components/telnet/TelnetWizardPage.tsx — Telnet sihirbazı: Legacy OpsX'in
// uygulama/sunucu seçim akışının BİREBİR kopyası (kullanıcı isteği); son adımda bir
// İŞLEM (restart/stop/...) değil, IP + Port sorulur ve bir bağlantı testi tetiklenir.
//
// Legacy: OpsX'ten YAPISAL FARK — "Uygulama Adı" sorulur ama extra_vars'a HİÇ eklenmez
// (yalnız ip/port taşır, kullanıcı şartnamesi). TEK AWX job'i tetiklenir.
//
// Openshift: ortam + tenant/iş birimi + bir veya daha fazla namespace seçilir, ardından
// OpsX Openshift Rollout'la AYNI UX'te bir cluster seçimi (OcpClusterPickStep) — tenant/env
// grubundaki GERÇEK cluster'lardan biri YA DA "Tüm cluster'lar". TEK bir AWX job'i tetiklenir;
// playbook (cluster x namespace) çapraz çarpımını kendi içinde işler (bkz.
// server/telnet/index.cjs) — bu yüzden "done" adımı Legacy ile AYNI: tek sonuç/log gösterir.
//
// Güvenlik OpsX ile AYNI: son POST /api/telnet/run çağrısında sunucu uygulama-host
// eşleşmesini ve namespace/tenant'ı envanterden YENİDEN doğrular.
import React, { useContext, useEffect, useRef, useState } from "react";
import {
  ArrowLeftIcon, ExclamationTriangleIcon, ArrowPathIcon, StopCircleIcon, ClockIcon,
} from "@heroicons/react/24/outline";
import { telnetApi, type TelnetPlatform, type TelnetRunResult, type TelnetResult } from "@/api/telnetApi";
import { useJobTracker } from "@/contexts/JobTrackerContext";
import { AuthContext } from "@/contexts/AuthContext";
import TelnetResultPanel from "./steps/TelnetResultPanel";
import AnsibleLogTerminal from "@/components/common/AnsibleLogTerminal";
import PlatformStep from "./steps/PlatformStep";
import AppSearchStep from "./steps/AppSearchStep";
import JbossVersionStep from "./steps/JbossVersionStep";
import HostSelectStep from "./steps/HostSelectStep";
import OcpTargetStep from "./steps/OcpTargetStep";
import OcpClusterPickStep from "./steps/OcpClusterPickStep";
import TelnetInputStep from "./steps/TelnetInputStep";

type Step =
  | "platform"
  | "legacy_app"
  | "legacy_jboss_version"
  | "legacy_hosts"
  | "ocp_target"
  | "ocp_cluster"
  | "telnet_input"
  | "done";

const STEP_TITLES: Record<Step, string> = {
  platform: "",
  legacy_app: "Uygulama Seçimi",
  legacy_jboss_version: "JBoss Sürümü",
  legacy_hosts: "Sunucu Seçimi",
  ocp_target: "Openshift Hedefi",
  ocp_cluster: "Cluster Seçimi",
  telnet_input: "Telnet Hedefi",
  done: "Test Sonucu",
};

// Geçen süre "2:07" biçiminde — saniye cinsinden ham sayı okunmuyor.
function fmtElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const sec = total % 60;
  return `${m}:${String(sec).padStart(2, "0")}`;
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
  // Openshift: OpsX Openshift Rollout ile AYNI UX (OcpClusterPickStep) — "" = tüm cluster'lar.
  const [cluster, setCluster] = useState("");
  const [busy, setBusy] = useState(false);
  // ÇİFT TIKLAMA KORUMASI (H1). `busy` bir React state'idir ve render'da yakalanır;
  // aynı tick'te gelen iki tık ikisi de `busy === false` görüp İKİ AWX JOB'I açabilir.
  // LogX'te bu bilinçli olarak ref'e çevrilmişti (LogXWizardPage.tsx); desen buraya
  // taşındı — Telnet her job'da OCP cluster'ında geçici pod açtığı için maliyeti gerçek.
  const busyRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  // "Takıldı mı?" sorusu için geçen süre. Kullanıcı bunu görmek için AWX'e gitmesin.
  const [elapsed, setElapsed] = useState(0);

  // Legacy ve Openshift AYNI: tek job/sonuç (bkz. dosya başı notu).
  const [result, setResult] = useState<TelnetRunResult | null>(null);
  const [trackedJobId, setTrackedJobId] = useState<string | null>(null);

  const { addJob, jobs } = useJobTracker();
  const trackedJob = trackedJobId ? jobs.find((j) => j.id === trackedJobId) : undefined;

  // Geçen süre sayacı. İş BİTİNCE durur — bitmiş bir işin "süresi" artmaya devam
  // ederse ekran yalan söyler. Başlangıç anı JobTracker'ın kaydettiği `startedAt`tir.
  const jobStartedAt = trackedJob?.startedAt;
  const jobFinished = !!trackedJob?.done;
  useEffect(() => {
    if (!jobStartedAt) return;
    setElapsed(Date.now() - jobStartedAt);
    if (jobFinished) return;
    const t = setInterval(() => setElapsed(Date.now() - jobStartedAt), 1000);
    return () => clearInterval(t);
  }, [jobStartedAt, jobFinished]);
  const [filterEnabled, setFilterEnabled] = useState(false);
  const [filterPrefix, setFilterPrefix] = useState("");

  function restart() {
    setStep("platform");
    setCancelling(false);
    setElapsed(0);
    setPlatform(null);
    setApp("");
    setJbossVersions([]);
    setHosts([]);
    setEnv("");
    setTenant("");
    setNamespaces([]);
    setCluster("");
    setError(null);
    setResult(null);
    setTrackedJobId(null);
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

  function backTargetFor(s: Step): Step | null {
    switch (s) {
      case "legacy_app":
      case "ocp_target":
        return "platform";
      case "legacy_jboss_version":
        return "legacy_app";
      case "legacy_hosts":
        return "legacy_jboss_version";
      case "ocp_cluster":
        return "ocp_target";
      case "telnet_input":
        return platform === "openshift" ? "ocp_cluster" : "legacy_hosts";
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
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      const r = platform === "openshift"
        ? await telnetApi.run({ platform: "openshift", env, tenant, namespaces, cluster, ip, port })
        : await telnetApi.run({ platform: "legacy", application: app, hosts, ip, port });
      // safeJson() 4xx/5xx'te reddetmez — backend'in ok:false + message ile döndüğü
      // hatalar burada kontrol edilmezse kullanıcıya sahte bir "başlatıldı" ekranı gösterilir.
      if (!r.ok) {
        setError(r.message || "İşlem başlatılamadı.");
        return;
      }
      setResult(r);
      setLastTarget({ ip, port });
      setStep("done");
      trackJob(r);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  // E7 · "Aynı hedeflerle tekrar çalıştır". Eskiden tek buton `restart()` ile HER ŞEYİ
  // sıfırlıyordu: yalnızca portu değiştirmek için altı adım baştan yapılıyordu.
  const [lastTarget, setLastTarget] = useState<{ ip: string; port: string } | null>(null);

  function rerunSameTargets() {
    if (!lastTarget) return;
    setResult(null);
    setTrackedJobId(null);
    setElapsed(0);
    setStep("telnet_input");
  }

  async function cancelJob() {
    if (!result || result.jobId == null || cancelling) return;
    setCancelling(true);
    try {
      const r = await telnetApi.cancel(result.awxServerId, result.jobId);
      if (!r.ok) setError(r.message || "İş iptal edilemedi.");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setCancelling(false);
    }
  }

  const canGoBack = backTargetFor(step) !== null;

  // JobTracker `result`i YORUMLAMAZ, yalnızca taşır (bkz. JobTrackerContext notu) —
  // tipe burada, tüketen tarafta indirgenir.
  const telnetResult = (trackedJob?.result as TelnetResult | undefined) ?? null;
  const jobDone = !!trackedJob?.done;

  const { user } = useContext(AuthContext);
  const isAdmin = user?.role === "Admin";

  const inputSummary = platform === "openshift" ? (
    <>
      Ortam: <span className="font-mono text-[var(--text-primary)]">{env}</span>
      {" · "}
      Tenant: <span className="font-mono text-[var(--text-primary)]">{tenant}</span>
      {" · "}
      Cluster: <span className="font-mono text-[var(--text-primary)]">{cluster || "tümü"}</span>
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
            onSubmit={(v) => { setEnv(v.env); setTenant(v.tenant); setNamespaces(v.namespaces); setStep("ocp_cluster"); }}
          />
        )}

        {step === "ocp_cluster" && (
          <OcpClusterPickStep
            env={env}
            tenant={tenant}
            busy={busy}
            onSubmit={(c) => { setCluster(c); setStep("telnet_input"); }}
          />
        )}

        {step === "telnet_input" && (
          <TelnetInputStep summary={inputSummary} busy={busy} initial={lastTarget} onSubmit={(v) => runTelnet(v.ip, v.port)} />
        )}

        {step === "done" && result && (
          <div className="flex flex-col items-center gap-4 py-2">
            {/* E4 · YANILTICI YEŞİL TİK KALDIRILDI. Eskiden burada koşulsuz bir yeşil
                CheckCircle + "Telnet testi başlatıldı." vardı: iş HENÜZ BİTMEMİŞKEN de,
                tüm portlar KAPALI çıktığında da aynı yeşil tik görünüyordu. Artık durum
                gerçekten ne ise o gösterilir. */}
            {telnetResult ? (
              <TelnetResultPanel result={telnetResult} />
            ) : (
              <div className="w-full flex items-center gap-2.5">
                {jobDone ? (
                  <ExclamationTriangleIcon aria-hidden="true" className="w-5 h-5 flex-shrink-0 text-[var(--status-warning)]" />
                ) : (
                  <span aria-hidden="true" className="w-5 h-5 flex-shrink-0 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
                )}
                <div className="min-w-0">
                  <p className="text-sm font-medium text-[var(--text-primary)]">
                    {jobDone ? "İş bitti ama yapılandırılmış sonuç gelmedi." : "Test çalışıyor…"}
                  </p>
                  <p className="text-xs text-[var(--text-muted)] mt-0.5">
                    {jobDone
                      ? "Playbook'un güncel sürümü AWX'e kopyalanmamış olabilir (sonuç `set_stats` ile yayınlanır). Aşağıdaki ham log yine de okunabilir."
                      : "Her (cluster × namespace) birimi için pod açılıyor ve telnet deneniyor."}
                  </p>
                </div>
              </div>
            )}

            {/* E6 · GİRDİ ÖZETİ sonuç ekranında da görünür. Zaten üretiliyordu ama
                yalnızca "telnet_input" adımında gösteriliyordu; sonuca bakan kullanıcı
                "hangi namespace'lerdi?" sorusunu cevaplayamıyordu. */}
            <div className="w-full text-xs text-[var(--text-muted)] border-t border-[var(--border)] pt-3">
              {inputSummary}
            </div>

            <div className="w-full flex items-center justify-between gap-2 text-xs text-[var(--text-muted)]">
              <span>
                {result.jobId != null && <>AWX Job: <span className="font-mono">#{result.jobId}</span></>}
              </span>
              <span className="inline-flex items-center gap-1 tabular-nums">
                <ClockIcon aria-hidden="true" className="w-3.5 h-3.5" />
                {fmtElapsed(elapsed)}
                {trackedJob?.status ? ` · ${trackedJob.status}` : ""}
              </span>
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

            {/* E5 · "AWX'e gönderilen gövde" son kullanıcıdan KALDIRILDI, yalnızca
                yöneticide. Normal kullanıcı için hata ayıklama gürültüsüydü ve ekranın
                yarısını kaplıyordu; yönetici için hâlâ en hızlı teşhis aracı. */}
            {isAdmin && (
              <details className="w-full text-left bg-[var(--bg-elevated)] rounded-xl p-3">
                <summary className="text-xs text-[var(--text-muted)] cursor-pointer">
                  AWX'e gönderilen gövde (yönetici)
                </summary>
                <pre className="mt-2 text-xs font-mono whitespace-pre-wrap break-all">
                  {JSON.stringify(result.sentBody, null, 2)}
                </pre>
              </details>
            )}

            <div className="flex items-center gap-2 flex-wrap justify-center">
              {/* E8 · İPTAL. Telnet OCP cluster'ında GEÇİCİ POD açıyor; yanlış bir IP
                  girildiğinde iş, her birim için 60 sn pod bekleme + 10 sn telnet
                  timeout süresince sürüyordu ve durdurmanın HİÇBİR yolu yoktu. */}
              {!jobDone && result.jobId != null && (
                <button onClick={cancelJob} disabled={cancelling} className="btn-secondary">
                  <StopCircleIcon className="w-4 h-4" />
                  {cancelling ? "İptal ediliyor…" : "Testi durdur"}
                </button>
              )}
              {/* E7 · Aynı hedeflerle tekrar — yalnızca portu değiştirmek için altı adım
                  baştan yapılmasın. */}
              {jobDone && lastTarget && (
                <button onClick={rerunSameTargets} className="btn-secondary">
                  <ArrowPathIcon className="w-4 h-4" />
                  Aynı hedeflerle tekrar
                </button>
              )}
              <button onClick={restart} className="btn-primary">
                <ArrowPathIcon className="w-4 h-4" />
                Yeni Test
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default TelnetWizardPage;
