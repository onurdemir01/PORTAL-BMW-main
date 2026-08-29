// src/components/scalex/ScaleXPage.tsx — ScaleX sihirbazı.
//
// OpenShift uygulamalarında replica durdurma / geri alma / ölçekleme. Otomasyonun kendisi
// AWX'te zaten çalışıyordu; bu sayfa ona GÜVENLİ ve GÖRÜNÜR bir giriş veriyor:
// seçimler canlı veriden gelir, prod'da kurumsal kapılar devreye girer, sonuç
// yapılandırılmış görünür ve "şu an ne durdurulmuş" her an okunabilir.
//
// İskelet TelnetWizardPage'ten: `STEP_TITLES`, `backTargetFor`, `busyRef` (state DEĞİL —
// aynı tick'teki iki tık iki AWX işi açardı), `<div key={step}>` ile adım sıfırlama.
// ERKEN `return` TÜM HOOK'LARIN ALTINDA olmak zorunda (bkz. src/__tests__/hook-order.test.cjs).
import React, { useEffect, useRef, useState } from "react";
import { ArrowLeftIcon, ClockIcon, ExclamationTriangleIcon, StopCircleIcon } from "@heroicons/react/24/outline";
import { scalexApi, type ScaleXAction, type ScaleXMode, type ScaleXRunResult, type ScaleXWorkload, type ScaleXStoppedItem } from "@/api/scalexApi";
import { useJobTracker } from "@/contexts/JobTrackerContext";
import AnsibleLogTerminal from "@/components/common/AnsibleLogTerminal";
import ScopeStep from "./steps/ScopeStep";
import NamespaceStep from "./steps/NamespaceStep";
import WorkloadStep from "./steps/WorkloadStep";
import OperationStep from "./steps/OperationStep";
import PreviewStep from "./steps/PreviewStep";
import ScaleXResultPanel from "./steps/ScaleXResultPanel";
import StoppedPanel from "./StoppedPanel";

type Step = "scope" | "namespace" | "workloads" | "operation" | "preview" | "done";

const STEP_TITLES: Record<Step, string> = {
  scope: "Kapsam",
  namespace: "Namespace",
  workloads: "Uygulamalar",
  operation: "İşlem",
  preview: "Önizleme",
  done: "Sonuç",
};

function backTargetFor(s: Step): Step | null {
  switch (s) {
    case "namespace": return "scope";
    case "workloads": return "namespace";
    case "operation": return "workloads";
    case "preview": return "operation";
    default: return null;   // `scope` ilk adım, `done`dan geri dönülmez (yeni işlem başlatılır)
  }
}

function fmtElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

const ScaleXPage: React.FC = () => {
  const [step, setStep] = useState<Step>("scope");
  const [env, setEnv] = useState("");
  const [tenant, setTenant] = useState("");
  const [clusters, setClusters] = useState<string[]>([]);
  const [namespace, setNamespace] = useState("");
  const [apps, setApps] = useState<string[]>([]);
  const [workloads, setWorkloads] = useState<ScaleXWorkload[]>([]);
  const [action, setAction] = useState<ScaleXAction>("stop");
  const [executionMode, setExecutionMode] = useState<ScaleXMode>("dry_run");
  const [targetReplicas, setTargetReplicas] = useState<string | undefined>(undefined);
  const [verificationTimeout, setVerificationTimeout] = useState("60");
  const [allowPartial, setAllowPartial] = useState(true);
  const [mailCc, setMailCc] = useState("");
  const [hpaPin, setHpaPin] = useState(false);

  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [elapsed, setElapsed] = useState(0);

  const [job, setJob] = useState<{ serverId: number; jobId: number } | null>(null);
  const [runResult, setRunResult] = useState<ScaleXRunResult | null>(null);
  const [catalogWarning, setCatalogWarning] = useState<string | null>(null);
  const [trackedJobId, setTrackedJobId] = useState<string | null>(null);
  // İŞLEM SONRASI SAĞLIK (C4). `main.yml` yalnızca `spec.replicas` eşitliğine bakar —
  // "replica geldi ama pod CrashLoopBackOff" durumunu BAŞARILI sayar. Bu boşluğu
  // `health` keşfi kapatıyor; `Durdur`da anlamsız (0 pod bekleniyor), o yüzden
  // yalnızca `Geri Al`/`Ölçekle` sonrası koşar.
  const [health, setHealth] = useState<{ app: string; step: string; status: string; detail: string }[] | null>(null);
  const healthStartedRef = useRef(false);

  const { addJob, jobs } = useJobTracker();
  const trackedJob = trackedJobId ? jobs.find((j) => j.id === trackedJobId) : undefined;

  // Geçen süre sayacı. İş BİTİNCE durur — bitmiş bir işin süresi artmaya devam ederse
  // ekran yalan söyler.
  const startedAt = trackedJob?.startedAt;
  const finished = !!trackedJob?.done;
  useEffect(() => {
    if (!startedAt) return;
    setElapsed(Date.now() - startedAt);
    if (finished) return;
    const t = setInterval(() => setElapsed(Date.now() - startedAt), 1000);
    return () => clearInterval(t);
  }, [startedAt, finished]);

  // Sağlık kontrolü: iş bitince, yalnızca gerçek bir değişiklik yapıldıysa ve
  // uygulama ayağa kalkması bekleniyorsa.
  useEffect(() => {
    if (!finished || !runResult || healthStartedRef.current) return;
    if (runResult.mode !== "apply" || runResult.action === "stop") return;
    if (runResult.overallStatus === "FAIL") return;   // zaten başarısız, sağlık sormanın anlamı yok
    healthStartedRef.current = true;
    let alive = true;
    (async () => {
      try {
        const launched = await scalexApi.discover({ env, tenant, namespace, clusters, apps }, "health");
        if (!launched.ok) return;
        for (let i = 0; i < 20; i++) {
          await new Promise((r) => setTimeout(r, 3000));
          if (!alive) return;
          const st = await scalexApi.discoverStatus(launched.serverId, launched.jobId);
          if (!st.finished) continue;
          if (alive) setHealth(st.result?.health || []);
          return;
        }
      } catch { /* sağlık kontrolü BEST-EFFORT: başarısız olması asıl sonucu gizlemez */ }
    })();
    return () => { alive = false; };
  }, [finished, runResult, env, tenant, namespace, clusters, apps]);

  // İş bitince yapılandırılmış sonucu bir kez çek.
  useEffect(() => {
    if (!job || !finished) return;
    let alive = true;
    scalexApi.runStatus(job.serverId, job.jobId)
      .then((s) => { if (!alive) return; setRunResult(s.result); setCatalogWarning(s.catalogWarning); })
      .catch(() => { /* ham log yine görünür */ });
    return () => { alive = false; };
  }, [job, finished]);

  // `env`/`tenant`/`clusters` BILEREK korunur: kullanici genellikle ayni kapsamda ikinci
  // bir islem yapar. Ama CALISTIRMAYA OZEL her alan sifirlanmali — kalan bir deger
  // (or. onceki islemin "hepsi ya da hicbiri" secimi ya da CC adresi) sonraki isleme
  // SESSIZCE tasinir ve kullanici bunu fark etmez.
  function restart() {
    setStep("scope");
    setNamespace(""); setApps([]); setWorkloads([]);
    setAction("stop"); setExecutionMode("dry_run"); setTargetReplicas(undefined);
    setVerificationTimeout("60"); setAllowPartial(true); setMailCc(""); setHpaPin(false);
    setError(null); setNotice(null); setJob(null); setRunResult(null);
    setCatalogWarning(null); setTrackedJobId(null); setCancelling(false); setElapsed(0);
    setHealth(null); healthStartedRef.current = false;
  }

  async function guarded(fn: () => Promise<void>) {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true); setError(null);
    try { await fn(); } catch (e) { setError((e as Error).message); }
    finally { busyRef.current = false; setBusy(false); }
  }

  function run(extra: { writtenConfirm?: string; reason?: string; ocoNumber?: string }) {
    return guarded(async () => {
      const r = await scalexApi.run({
        env, tenant, namespace, clusters, apps,
        action, executionMode, targetReplicas, verificationTimeout, allowPartial, mailCc, hpaPin,
        // GERI ALMA HEDEFLERI: sunucu bu sayilari kendisi bilmiyor (deger cluster'daki
        // durum kaydinda) ve HPA sabitlemesine izin verip vermeyecegine bunlara bakarak
        // karar veriyor. Liste yalnizca KISITLAYICI yonde is gorur: hedeflerden biri 0
        // ya da bilinmiyorsa sabitleme reddedilir — cunku `minReplicas: 0` ya API
        // tarafindan reddedilir ya da uygulamayi 0'da kilitler.
        ...(action === "restore"
          ? { restoreTargets: workloads.filter((w) => apps.includes(w.name)).map((w) => w.previousReplicas) }
          : {}),
        ...extra,
      });
      if (!r.ok) {
        // KAPI YANITLARI HATA DEGIL, bir EL SIKISMA adimidir. Yalnizca `setError`
        // yapip birakmak kullaniciyi cikmaza sokardi: "OCO numarasi gerekli" yazar ama
        // numara girecegi alan onizleme ekraninda kalir ve kullanici oraya nasil
        // donecegini bilemez. Bu yuzden kapi yanitlarinda ONIZLEMEYE geri donuyoruz —
        // gerekli alanlar (OCO numarasi, gerekce, yazili onay) orada zaten var.
        const handshake = r.ocoRequired || r.ocoDecisionRequired || r.ocoExpired
          || r.writtenConfirmRequired || r.reasonRequired;
        if (handshake) {
          setStep("preview");
          setError(
            r.ocoExpired
              ? `${r.message || "OCO penceresi kapandı."} Yeni bir OCO kaydı girin ya da pencere açıldığında tekrar deneyin.`
              : r.message || "İşlem için ek bilgi gerekiyor — aşağıdaki alanı doldurun."
          );
          return;
        }
        setError(r.message || "İşlem başlatılamadı.");
        return;
      }
      // OCO penceresi henuz acilmadiysa sunucu 200 + `ocoDeferred` doner: is
      // BASLATILMADI ve bu bir hata degil.
      if (r.ocoDeferred) {
        // Pencere bilgisini METINDE veriyoruz: "tekrar deneyin" demek, NE ZAMAN
        // denenecegini soylemedigi surece kullaniciyi tahmine birakir.
        const w = r.oco?.windowStartText;
        setNotice(
          `OCO penceresi henüz açılmadı — işlem başlatılmadı, cluster'a dokunulmadı.`
          + (w ? ` Pencere ${w} tarihinde açılıyor; o saatten sonra tekrar deneyin.` : " Pencere açıldığında tekrar deneyin.")
        );
        setStep("done");
        return;
      }
      // SAVUNMA: ortak kapi zamanlama yaptiysa ortada AWX job'i YOKTUR. Bu dal
      // ScaleX'te olusmamali (zamanlama kapali) ama olusursa asagidaki `setJob`
      // `serverId: undefined` yazar ve ekran sonsuza dek "calisiyor" spinner'i
      // gosterirdi — sessiz bir kilitlenme yerine net bir mesaj.
      if (r.ocoScheduled || r.jobId == null || r.serverId == null) {
        setNotice(r.message || "İşlem başlatılmadı — AWX iş numarası dönmedi. Lütfen tekrar deneyin.");
        setStep("done");
        return;
      }
      if (r.pendingApproval) {
        setNotice(`SMART kaydı açıldı (${r.externalTicketId}). Onay geldiğinde iş otomatik başlayacak.`);
        setStep("done");
        return;
      }
      setJob({ serverId: r.serverId, jobId: r.jobId });
      const id = addJob({
        title: `ScaleX ${action} — ${namespace}`,
        fetchStatus: async () => {
          const s = await scalexApi.runStatus(r.serverId, r.jobId);
          return { status: s.status, output: s.output, result: s.result };
        },
      });
      setTrackedJobId(id);
      setStep("done");
    });
  }

  function cancel() {
    if (!job) return;
    return guarded(async () => {
      setCancelling(true);
      try {
        await scalexApi.cancel(job.serverId, job.jobId);
      } catch (e) {
        // BAYRAK GERI ALINMALI: `guarded` hatayi yakalayip `setError` yapiyor ama
        // `cancelling` true kaliyordu — buton sonsuza dek "Durduruluyor…" ve pasif
        // olur, kullanici iptali BIR DAHA deneyemezdi. Ustelik iptalin gerceklesip
        // gerceklesmedigini de anlayamazdi.
        setCancelling(false);
        throw e;
      }
    });
  }

  // "Geri Al" kısayolu: durdurulmuş bir kaydı doğrudan geri alma akışına taşır.
  function restoreFromPanel(item: ScaleXStoppedItem) {
    setClusters([item.clusterName]);
    setNamespace(item.namespace);
    setApps([item.appName]);
    setWorkloads([{
      cluster: item.clusterName, name: item.appName, kind: item.workloadKind || "-",
      resource: "", specReplicas: 0, statusReplicas: 0, readyReplicas: 0,
      hasHpa: false, image: null, statePhase: item.phase,
      previousReplicas: item.previousReplicas, restorable: true,
      // "Şu an durdurulmuş" listesinde GitOps bilgisi yok (o keşif `state` modundan
      // geliyor, `workloads`tan değil). `null` = bilinmiyor; önizleme bu yüzden
      // GitOps uyarısı göstermez — yanlış bir "temiz" iddiası yerine sessizlik.
      gitops: null,
    }]);
    setAction("restore");
    setExecutionMode("apply");
    setHpaPin(false);
    setStep("preview");
  }

  const back = backTargetFor(step);
  const scope = { env, tenant, namespace, clusters, apps };

  return (
    <div className="max-w-3xl mx-auto space-y-5">
      <div className="flex items-start gap-3">
        {back && (
          <button type="button" onClick={() => setStep(back)} disabled={busy} aria-label="Geri"
            className="mt-1 p-1.5 rounded-lg text-[var(--text-muted)] hover:bg-[var(--bg-inset)]">
            <ArrowLeftIcon aria-hidden="true" className="w-4 h-4" />
          </button>
        )}
        <div className="min-w-0">
          <h1 className="page-title">ScaleX</h1>
          <p className="text-sm font-medium text-[var(--text-muted)]">{STEP_TITLES[step]}</p>
        </div>
      </div>

      {/* role="alert" + aria-live: kapi yanitlari (OCO/gerekce/yazili onay) bu banner'a
          dusuyor ve banner sayfanin EN USTUNDE. Uzun bir onizlemede `Çalıştır` ekranin
          altindadir; duyurulmazsa kullanici hicbir sey olmamis gibi butona tekrar tekrar
          basar. */}
      {error && (
        <div role="alert" aria-live="assertive"
             className="flex items-start gap-2 bg-red-50 border border-red-100 rounded-xl p-3 text-sm text-red-700">
          <ExclamationTriangleIcon aria-hidden="true" className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      <div key={step} className="card p-5 animate-slide-up">
        {step === "scope" && (
          <ScopeStep busy={busy} initial={{ env, tenant, clusters }}
            onSubmit={(v) => { setEnv(v.env); setTenant(v.tenant); setClusters(v.clusters); setStep("namespace"); }} />
        )}

        {step === "namespace" && (
          <NamespaceStep env={env} tenant={tenant} clusters={clusters} busy={busy} initial={namespace}
            onSubmit={(ns) => { setNamespace(ns); setApps([]); setStep("workloads"); }} />
        )}

        {step === "workloads" && (
          <WorkloadStep scope={{ env, tenant, namespace, clusters }} busy={busy} initial={apps}
            onSubmit={(v) => { setApps(v.apps); setWorkloads(v.workloads); setStep("operation"); }} />
        )}

        {step === "operation" && (
          <OperationStep apps={apps} workloads={workloads} clusterCount={clusters.length} busy={busy}
            onSubmit={(v) => {
              setAction(v.action); setExecutionMode(v.executionMode);
              setTargetReplicas(v.targetReplicas); setVerificationTimeout(v.verificationTimeout);
              setAllowPartial(v.allowPartial); setMailCc(v.mailCc); setHpaPin(v.hpaPin);
              setStep("preview");
            }} />
        )}

        {step === "preview" && (
          <PreviewStep scope={scope} action={action} executionMode={executionMode}
            targetReplicas={targetReplicas} verificationTimeout={verificationTimeout}
            workloads={workloads} hpaPin={hpaPin} busy={busy} onConfirm={run} />
        )}

        {step === "done" && (
          <div className="space-y-4">
            {notice && (
              <div className="flex items-start gap-2 rounded-xl border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900">
                <ClockIcon aria-hidden="true" className="w-4 h-4 flex-shrink-0 mt-0.5" /><span>{notice}</span>
              </div>
            )}

            {runResult ? (
              <ScaleXResultPanel result={runResult} catalogWarning={catalogWarning} />
            ) : !notice ? (
              <div className="flex items-center gap-2.5">
                {finished ? (
                  <ExclamationTriangleIcon aria-hidden="true" className="w-5 h-5 flex-shrink-0 text-[var(--status-warning)]" />
                ) : (
                  <span aria-hidden="true" className="w-5 h-5 flex-shrink-0 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
                )}
                <div className="min-w-0">
                  <p className="text-sm font-medium text-[var(--text-primary)]">
                    {finished ? "İş bitti ama yapılandırılmış sonuç gelmedi." : "İşlem çalışıyor…"}
                  </p>
                  <p className="text-xs text-[var(--text-muted)] mt-0.5">
                    {finished
                      ? "Playbook'un güncel sürümü AWX'e kopyalanmamış olabilir (sonuç `set_stats` ile yayınlanır). Aşağıdaki ham log yine de okunabilir."
                      : `${clusters.length} cluster × ${apps.length} uygulama işleniyor.`}
                  </p>
                </div>
              </div>
            ) : null}

            {job && (
              <div className="flex items-center justify-between gap-2 text-xs text-[var(--text-muted)]">
                <span>AWX Job: <span className="font-mono">#{job.jobId}</span></span>
                <span className="inline-flex items-center gap-2">
                  <span className="inline-flex items-center gap-1 tabular-nums">
                    <ClockIcon aria-hidden="true" className="w-3.5 h-3.5" />{fmtElapsed(elapsed)}
                  </span>
                  {!finished && (
                    <button type="button" onClick={cancel} disabled={busy || cancelling}
                      className="inline-flex items-center gap-1 text-[var(--status-danger)] hover:underline">
                      <StopCircleIcon aria-hidden="true" className="w-3.5 h-3.5" />
                      {cancelling ? "Durduruluyor…" : "İşlemi durdur"}
                    </button>
                  )}
                </span>
              </div>
            )}

            {health && health.length > 0 && (
              <div className="rounded-xl border border-[var(--border)] p-3 space-y-1.5">
                <p className="text-xs font-semibold text-[var(--text-primary)]">İşlem sonrası sağlık</p>
                {health.map((h, i) => (
                  <p key={i} className={`text-xs ${h.status === "OK" ? "text-[var(--text-muted)]" : "text-amber-800"}`}>
                    <span className="font-mono">{h.app}</span> · {h.step} · {h.detail}
                  </p>
                ))}
              </div>
            )}

            {trackedJob && (
              <AnsibleLogTerminal output={trackedJob.output} status={trackedJob.status || "pending"} title={trackedJob.title} />
            )}

            <div className="flex justify-end border-t border-[var(--border)] pt-4">
              <button type="button" className="btn-secondary" onClick={restart}>Yeni işlem</button>
            </div>
          </div>
        )}
      </div>

      {/* "Şu an durdurulmuş" GERÇEKTEN her adımda görünür — SONUÇ EKRANI DAHİL.
          Eskiden `step !== "done"` ile sonuç ekranında gizleniyordu; oysa panele en çok
          orada ihtiyaç var: 6 hedeften 4'ü başarılı, 2'si başarısız olduğunda kullanıcı
          "şimdi ne yapmalıyım?" sorusunun cevabını ekranda bulamıyordu ve geri almak
          için tüm sihirbazı (kapsam → namespace → keşif → işlem → önizleme) baştan
          doldurmak, üstelik yeni bir keşif işi başlatmak zorunda kalıyordu. */}
      {env && tenant && (
        <div className="card p-5">
          <StoppedPanel env={env} tenant={tenant} onRestore={restoreFromPanel} />
        </div>
      )}
    </div>
  );
};

export default ScaleXPage;
