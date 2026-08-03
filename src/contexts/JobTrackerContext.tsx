// src/contexts/JobTrackerContext.tsx — Uygulama-geneli AWX iş takip mekanizması.
//
// NEDEN: OpsX/Telnet/Self Service her biri kendi sayfasında yerel state ile job'ı
// poll ediyordu — sayfadan ayrılınca (Envanter'e geçmek gibi) component unmount olur,
// polling durur, kullanıcı işin sonucunu kaybederdi. Bu context AppLayout seviyesinde
// (route değişikliklerinde UNMOUNT OLMAYAN tek yer) yaşar, böylece bir iş başlatılıp
// "küçültüldükten" sonra kullanıcı başka sayfalara geçse bile polling devam eder ve
// alt çubuktaki sekmeden her an geri açılabilir (bkz. JobTrackerBar.tsx).
//
// Yalnızca TEK bir iş aynı anda "büyütülmüş" (expanded) olabilir — diğerleri otomatik
// küçültülür; bu, ekranı floating panel'lerle doldurmadan "tarayıcı sekmesi" hissini verir.
import React, { createContext, useCallback, useContext, useRef, useState } from "react";

export interface TrackedJobResult {
  status: string;
  output: string;
}

export interface TrackedJob {
  id: string;
  title: string;
  status: string;
  output: string;
  pollErr: string;
  minimized: boolean;
  done: boolean;
  /** Telnet gibi bazı akışlarda: "sadece şu karakterle başlayan satırları göster"
   * filtresi JobTrackerBar'da gösterilsin mi (bkz. TelnetWizardPage.tsx). */
  filterable?: boolean;
}

interface AddJobInput {
  title: string;
  fetchStatus: () => Promise<TrackedJobResult>;
  filterable?: boolean;
}

interface JobTrackerContextValue {
  jobs: TrackedJob[];
  addJob: (input: AddJobInput) => string;
  expand: (id: string) => void;
  minimize: (id: string) => void;
  remove: (id: string) => void;
}

const JobTrackerContext = createContext<JobTrackerContextValue | null>(null);

const TERMINAL = new Set(["successful", "failed", "error", "canceled"]);
const RUN_MS = 1500;   // stdout akıyor → hızlı tazele
const IDLE_MS = 3000;  // koşuyor ama henüz çıktı yok
const MAX_ERRORS = 12; // geçici hataya tolerans (backoff ile ~50sn) — OpsX/Telnet/SS'teki AYNI desen

export function JobTrackerProvider({ children }: { children: React.ReactNode }) {
  const [jobs, setJobs] = useState<TrackedJob[]>([]);
  // Kaldırılan/tamamlanan islerin zamanlayicilarini durdurmak icin — component unmount
  // OLMADIGI (Provider hep yasadigi) icin normal useEffect-cleanup deseni islemez,
  // durdurma acikca bu set uzerinden yapilir.
  const stoppedRef = useRef<Set<string>>(new Set());

  const addJob = useCallback((input: AddJobInput): string => {
    const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    // minimized: true BASTAN — yuzen paneli OTOMATIK ACMAYIZ. Isi tetikleyen sayfa
    // (OpsX/Telnet "done" adimi, Self Service SurveyModal) canli ciktiyi KENDI icinde
    // (bu context'ten okuyarak) inline gosterir; kullanici sayfadan ayrilirsa/modali
    // kapatirsa is arka planda takip edilmeye devam eder (alt cubuktaki sekme), yuzen
    // panel YALNIZCA o sekmeye tiklanirsa (expand()) acilir — boylece ayni is icin
    // ayni anda IKI pencere birden gorunmez.
    setJobs((prev) => [
      ...prev,
      { id, title: input.title, status: "", output: "", pollErr: "", minimized: true, done: false, filterable: input.filterable },
    ]);

    const tick = (errCount: number) => {
      if (stoppedRef.current.has(id)) return;
      input.fetchStatus().then((r) => {
        if (stoppedRef.current.has(id)) return;
        const terminal = TERMINAL.has(r.status);
        setJobs((prev) => prev.map((j) => (j.id === id ? {
          ...j,
          status: r.status,
          output: r.output || j.output,
          pollErr: "",
          done: terminal,
        } : j)));
        if (terminal) {
          if (!r.output && (r.status === "failed" || r.status === "error")) {
            setJobs((prev) => prev.map((j) => (j.id === id
              ? { ...j, output: "Job başarısız oldu ancak AWX bu iş için stdout döndürmedi. AWX arayüzünden job detayını kontrol edin." }
              : j)));
          }
          return;
        }
        window.setTimeout(() => tick(0), r.output ? RUN_MS : IDLE_MS);
      }).catch((e: unknown) => {
        if (stoppedRef.current.has(id)) return;
        const next = errCount + 1;
        if (next >= MAX_ERRORS) {
          setJobs((prev) => prev.map((j) => (j.id === id
            ? { ...j, pollErr: `Durum güncellenemiyor: ${e instanceof Error ? e.message : String(e)}`, done: true }
            : j)));
          return;
        }
        setJobs((prev) => prev.map((j) => (j.id === id
          ? { ...j, pollErr: `Bağlantı yenileniyor… (deneme ${next}/${MAX_ERRORS})` }
          : j)));
        window.setTimeout(() => tick(next), Math.min(RUN_MS * next, 6000));
      });
    };
    tick(0);

    return id;
  }, []);

  const expand = useCallback((id: string) => {
    setJobs((prev) => prev.map((j) => ({ ...j, minimized: j.id !== id })));
  }, []);

  const minimize = useCallback((id: string) => {
    setJobs((prev) => prev.map((j) => (j.id === id ? { ...j, minimized: true } : j)));
  }, []);

  const remove = useCallback((id: string) => {
    stoppedRef.current.add(id);
    setJobs((prev) => prev.filter((j) => j.id !== id));
  }, []);

  return (
    <JobTrackerContext.Provider value={{ jobs, addJob, expand, minimize, remove }}>
      {children}
    </JobTrackerContext.Provider>
  );
}

export function useJobTracker(): JobTrackerContextValue {
  const ctx = useContext(JobTrackerContext);
  if (!ctx) throw new Error("useJobTracker, JobTrackerProvider içinde kullanılmalı.");
  return ctx;
}
