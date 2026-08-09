// src/components/filex/FileXWizardPage.tsx — FileX sihirbazı: uygulama → JBoss sürümü →
// sunucular → dosya listesi (salt-okunur). SADECE Legacy sunucularda çalışır (kullanıcı
// kararı) — bu yüzden OpsX'teki gibi bir platform seçim adımı YOK.
//
// OpsX'ten YAPISAL FARK: FileX hiçbir işlem tetiklemez, sadece BİLGİ gösterir. Bu yüzden
// "işlem seçimi" adımı yok, sonuç ekranı da AWX job'ının sentBody'sini değil GERÇEK dosya
// listesini gösterir. Güvenlik OpsX ile AYNI ilkeye dayanır: son POST /api/filex/run
// çağrısında sunucu uygulama-host eşleşmesini envanterden YENİDEN doğrular.
import React, { useEffect, useRef, useState } from "react";
import { ArrowLeftIcon, ExclamationTriangleIcon } from "@heroicons/react/24/outline";
import { filexApi, type FilexResult } from "@/api/filexApi";
import AppSearchStep from "./steps/AppSearchStep";
import JbossVersionStep from "./steps/JbossVersionStep";
import HostSelectStep from "./steps/HostSelectStep";
import FileListResultStep from "./steps/FileListResultStep";

type Step = "app" | "jboss_version" | "hosts" | "running" | "result";

const STEP_TITLES: Record<Step, string> = {
  app: "Uygulama Seçimi",
  jboss_version: "JBoss Sürümü",
  hosts: "Sunucu Seçimi",
  running: "Dosyalar Taranıyor",
  result: "Dosya Listesi",
};

const POLL_INTERVAL_MS = 2500;

const FileXWizardPage: React.FC = () => {
  const [step, setStep] = useState<Step>("app");
  const [app, setApp] = useState("");
  const [jbossVersions, setJbossVersions] = useState<string[]>([]);
  const [hosts, setHosts] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<FilexResult | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

  function restart() {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    setStep("app");
    setApp("");
    setJbossVersions([]);
    setHosts([]);
    setBusy(false);
    setError(null);
    setResult(null);
  }

  function backTargetFor(s: Step): Step | null {
    switch (s) {
      case "jboss_version": return "app";
      case "hosts": return "jboss_version";
      default: return null;
    }
  }

  function back() {
    const target = backTargetFor(step);
    if (target) setStep(target);
  }

  async function runQuery(selectedHosts: string[]) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await filexApi.run(app, selectedHosts);
      if (!r.ok || r.jobId == null) {
        setError("İş başlatılamadı.");
        setBusy(false);
        return;
      }
      setStep("running");
      pollRef.current = setInterval(async () => {
        try {
          const s = await filexApi.jobStatus(r.awxServerId, r.jobId as number);
          if (!s.finished) return;
          if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
          setBusy(false);
          if (s.failed || !s.result) {
            setError("İşlem tamamlanamadı — sonuç okunamadı. Lütfen sistem yöneticinize başvurun.");
            setStep("hosts");
            return;
          }
          setResult(s.result);
          setStep("result");
        } catch (err: unknown) {
          if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
          setBusy(false);
          setError(err instanceof Error ? err.message : String(err));
          setStep("hosts");
        }
      }, POLL_INTERVAL_MS);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  const canGoBack = backTargetFor(step) !== null;
  // Sonuc adiminda binlerce dosya olabilir — dar sihirbaz sutunu (max-w-2xl) veriyi
  // ezerdi. Sadece bu adimda tam genislik (sol menu + ust bar disindaki tum alan)
  // kullanilir; diger adimlar (form niteligindeki secimler) dar/ortali kalir.
  const isFullWidth = step === "result";

  return (
    <div className={isFullWidth ? "w-full space-y-5" : "max-w-2xl mx-auto space-y-5"}>
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
          <h1 className="page-title">FileX - Dosya Listeleme</h1>
          <p className="mt-1 text-sm font-medium text-[var(--text-muted)]">{STEP_TITLES[step]}</p>
        </div>
      </div>

      {error && (
        <div className="flex items-start gap-2 bg-red-50 border border-red-100 rounded-xl p-3 text-sm text-red-700">
          <ExclamationTriangleIcon className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      <div key={step} className={`card p-5 animate-slide-up ${isFullWidth ? "w-full" : ""}`}>
        {step === "app" && (
          <AppSearchStep
            busy={busy}
            onSelect={(a) => { setApp(a); setJbossVersions([]); setHosts([]); setStep("jboss_version"); }}
          />
        )}

        {step === "jboss_version" && (
          <JbossVersionStep
            app={app}
            busy={busy}
            onSubmit={(v) => { setJbossVersions(v); setHosts([]); setStep("hosts"); }}
          />
        )}

        {step === "hosts" && (
          <HostSelectStep
            app={app}
            jbossVersions={jbossVersions}
            busy={busy}
            onSubmit={(h) => { setHosts(h); runQuery(h); }}
          />
        )}

        {step === "running" && (
          <div className="py-10 text-center space-y-3">
            <div className="inline-block w-6 h-6 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
            <p className="text-sm text-[var(--text-muted)]">
              {hosts.length} sunucuda .ear dizini taranıyor…
            </p>
          </div>
        )}

        {step === "result" && result && (
          <FileListResultStep result={result} onRestart={restart} />
        )}
      </div>
    </div>
  );
};

export default FileXWizardPage;
