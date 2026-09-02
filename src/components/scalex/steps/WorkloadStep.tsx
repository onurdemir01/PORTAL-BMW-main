// src/components/scalex/steps/WorkloadStep.tsx — CANLI KEŞİF + çoklu uygulama seçimi.
//
// Bu adım sayfanın var oluş sebebi. Bugün kullanıcı uygulama adlarını ELLE yazıyor;
// replica sayısını, HPA olup olmadığını ve uygulamanın zaten durdurulmuş olup olmadığını
// hiç görmüyor. Yazım hatası ancak iş çalıştıktan sonra "workload detection failed"
// olarak ortaya çıkıyor.
//
// Keşif SALT OKUNUR bir AWX işidir (`discovery_mode: workloads`) — hiçbir mutasyon yapmaz.
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowPathIcon, ExclamationTriangleIcon, MagnifyingGlassIcon, BoltSlashIcon,
} from "@heroicons/react/24/outline";
import { scalexApi, type ScaleXWorkload, type ScaleXScope } from "@/api/scalexApi";

interface Props {
  scope: ScaleXScope;
  busy: boolean;
  initial?: string[];
  onSubmit: (v: { apps: string[]; workloads: ScaleXWorkload[]; fetchedAt: number }) => void;
  /** Kesif asilirsa kullaniciya bir CIKIS yolu vermek icin (bkz. bekleme ekrani). */
  onBack: () => void;
}

const POLL_MS = 3000;
const MAX_POLL_ERRORS = 5;

const WorkloadStep: React.FC<Props> = ({ scope, busy, initial, onSubmit, onBack }) => {
  const [phase, setPhase] = useState<"idle" | "running" | "done" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [workloads, setWorkloads] = useState<ScaleXWorkload[]>([]);
  // Kesfin TAMAMLANDIGI an — onizlemedeki tazelik damgasi buradan gelir.
  const fetchedAtRef = useRef<number | null>(null);
  const [failedClusters, setFailedClusters] = useState<string[]>([]);
  const [problems, setProblems] = useState<{ cluster: string; detail: string }[]>([]);
  const [pdbWarning, setPdbWarning] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>(initial || []);
  const [query, setQuery] = useState("");
  // ÇİFT TIK KORUMASI ref ile — `busy` state'i render'da yakalanır ve aynı tick'teki
  // iki tık iki AWX işi açabilirdi (LogX/Telnet'te bu bilinçli olarak ref).
  const startingRef = useRef(false);
  // UNMOUNT KORUMASI. `poll()` bir `for(;;)` dongusudur; bilesen unmount olduktan sonra
  // da donmeye devam ederse (a) her 3 saniyede bir gereksiz istek atar, (b) unmount
  // sonrasi `setState` cagirir. Sihirbaz `key={step}` ile remount ettigi icin bu yol
  // gercekten yasaniyor: kullanici adimlar arasinda gidip geldikce eski dongulerin
  // hepsi arka planda kosmaya devam ederdi.
  const aliveRef = useRef(true);
  useEffect(() => () => { aliveRef.current = false; }, []);

  // KESIF ASILIRSA KULLANICI CIKMAZDA KALMASIN. `poll()` bir `for(;;)` dongusu ve
  // `MAX_POLL_ERRORS` yalnizca HTTP hatalarini sayiyor — AWX isi `pending`/`running`da
  // asili kalirsa `finished` hic true olmaz ve dongu SONSUZA DEK doner. Ekranda ise
  // yalnizca bir spinner vardi: gecen sure yok, AWX is numarasi yok, vazgecme yolu yok.
  // Tek cikis sayfayi yenilemekti ve o da sihirbazi bastan baslatiyordu.
  const [job, setJob] = useState<{ serverId: number; jobId: number } | null>(null);
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (phase !== "running") return;
    const t = setInterval(() => setElapsed((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [phase]);

  async function startDiscovery() {
    if (startingRef.current) return;
    startingRef.current = true;
    setPhase("running"); setMessage(null); setProblems([]); setFailedClusters([]);
    setJob(null); setElapsed(0);
    try {
      const launched = await scalexApi.discover(scope, "workloads");
      if (!aliveRef.current) return;
      if (!launched.ok) { setPhase("error"); setMessage(launched.message || "Keşif başlatılamadı."); return; }
      setJob({ serverId: launched.serverId, jobId: launched.jobId });
      await poll(launched.serverId, launched.jobId);
    } catch (e) {
      setPhase("error"); setMessage((e as Error).message);
    } finally {
      startingRef.current = false;
    }
  }

  async function poll(serverId: number, jobId: number) {
    let errors = 0;
    for (;;) {
      await new Promise((r) => setTimeout(r, POLL_MS));
      if (!aliveRef.current) return;
      try {
        const s = await scalexApi.discoverStatus(serverId, jobId);
        errors = 0;
        if (!s.finished) continue;
        if (s.result) {
          // KAYNAK ISARETLENIYOR: bu satirlar CANLI kesiften geliyor, yani
          // `specReplicas`/`readyReplicas`/`image`/`hasHpa` gercek degerler ve
          // onizlemede gosterilebilir. Aynadan turetilen sentetik satirlarda
          // (`mirror`) o alanlar uydurma olur.
          setWorkloads((s.result.workloads || []).map((w) => ({ ...w, source: "discovery" as const })));
          fetchedAtRef.current = Date.now();
          setFailedClusters(s.result.failedClusters || []);
          setProblems((s.result.problems || []).map((p) => ({ cluster: p.cluster, detail: p.detail })));
          setPdbWarning(s.result.pdbWarning || null);
          // Kısmi başarı GERÇEKTİR: üç cluster'dan biri düştüyse diğer ikisinin
          // uygulamaları gösterilir ama sorun da söylenir.
          setPhase("done");
        } else {
          setPhase("error");
          setMessage("İş bitti ama yapılandırılmış sonuç gelmedi — playbook'un güncel sürümü AWX'e kopyalanmamış olabilir.");
        }
        return;
      } catch (e) {
        if (++errors >= MAX_POLL_ERRORS) {
          setPhase("error"); setMessage(`Keşif durumu okunamadı: ${(e as Error).message}`);
          return;
        }
      }
    }
  }

  useEffect(() => { startDiscovery(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q ? workloads.filter((w) => w.name.toLowerCase().includes(q)) : workloads;
    // Aynı uygulama birden çok cluster'da olabilir — ada göre TEKİLLEŞTİRİLİR, çünkü
    // seçim uygulama adı bazındadır ve playbook (cluster × uygulama) çarpımını kendi yapar.
    const byName = new Map<string, ScaleXWorkload>();
    for (const w of filtered) if (!byName.has(w.name)) byName.set(w.name, w);
    return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name, "tr"));
  }, [workloads, query]);

  const toggle = (name: string) =>
    setSelected((prev) => (prev.includes(name) ? prev.filter((x) => x !== name) : [...prev, name]));

  if (phase === "running") {
    return (
      <div className="py-10 flex flex-col items-center gap-3">
        <span aria-hidden="true" className="w-6 h-6 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
        <p className="text-sm font-medium text-[var(--text-primary)]">Uygulamalar keşfediliyor…</p>
        <p className="text-xs text-[var(--text-muted)]">
          {scope.clusters.length} cluster · <span className="font-mono">{scope.namespace}</span> — salt okunur, hiçbir şey değiştirilmiyor.
        </p>
        <p className="text-xs text-[var(--text-muted)] tabular-nums">
          {Math.floor(elapsed / 60)} dk {String(elapsed % 60).padStart(2, "0")} sn
          {job && <> · AWX işi <span className="font-mono">#{job.jobId}</span></>}
        </p>
        {elapsed >= 90 && (
          <p role="status" className="max-w-md text-center text-xs text-amber-700">
            Beklenenden uzun sürüyor — AWX kuyruğunda bekliyor olabilir. Keşif salt okunur
            olduğu için vazgeçmek hiçbir şeyi bozmaz.
          </p>
        )}
        {elapsed >= 30 && (
          <button type="button" className="btn-secondary" onClick={() => { aliveRef.current = false; onBack(); }}>
            İptal et ve geri dön
          </button>
        )}
      </div>
    );
  }

  if (phase === "error") {
    return (
      <div className="space-y-4">
        <div className="flex items-start gap-2 bg-red-50 border border-red-100 rounded-xl p-3 text-sm text-red-700">
          <ExclamationTriangleIcon aria-hidden="true" className="w-4 h-4 flex-shrink-0 mt-0.5" /><span>{message}</span>
        </div>
        <button type="button" className="btn-secondary inline-flex items-center gap-1.5" onClick={startDiscovery}>
          <ArrowPathIcon aria-hidden="true" className="w-4 h-4" /> Tekrar dene
        </button>
      </div>
    );
  }

  // Taranamayan cluster sayisi secilen cluster sayisina esitse ortada "kismi basari"
  // yoktur — hicbir sey taranmamistir.
  const allClustersFailed = failedClusters.length > 0
    && failedClusters.length >= scope.clusters.length;

  return (
    <div className="space-y-4">
      {allClustersFailed && (
        <div role="alert" className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-800">
          <ExclamationTriangleIcon aria-hidden="true" className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <span>
            Seçilen cluster'ların <strong>hiçbiri</strong> taranamadı — aşağıdaki liste
            boş olduğu için değil, tarama yapılamadığı için boş.
          </span>
        </div>
      )}

      {!allClustersFailed && !!failedClusters.length && (
        <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
          <ExclamationTriangleIcon aria-hidden="true" className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <span>
            <strong>{failedClusters.join(", ")}</strong> taranamadı — aşağıdaki liste EKSİK olabilir.
            {problems[0] ? ` (${problems[0].detail})` : ""}
          </span>
        </div>
      )}

      {pdbWarning && (
        <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
          <ExclamationTriangleIcon aria-hidden="true" className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <span>{pdbWarning}</span>
        </div>
      )}

      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <MagnifyingGlassIcon aria-hidden="true" className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
          <input
            type="text" value={query} onChange={(e) => setQuery(e.target.value)} disabled={busy}
            placeholder="Uygulama ara…" aria-label="Uygulama ara"
            className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-[var(--border)] bg-[var(--bg-surface)]
                       text-[var(--text-primary)] placeholder-[var(--text-muted)]
                       focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
          />
        </div>
        <button type="button" onClick={startDiscovery} disabled={busy}
          title="Listeyi yeniden tara"
          className="p-2 rounded-lg border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text-primary)]">
          <ArrowPathIcon aria-hidden="true" className="w-4 h-4" />
        </button>
      </div>

      <div className="rounded-xl border border-[var(--border)] divide-y divide-[var(--border-subtle)] max-h-96 overflow-y-auto">
        {list.map((w) => (
          <label key={w.name} className="flex items-start gap-3 px-3 py-2.5 text-sm cursor-pointer hover:bg-[var(--bg-inset)]">
            <input type="checkbox" className="mt-1" disabled={busy}
              checked={selected.includes(w.name)} onChange={() => toggle(w.name)} />
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-2 flex-wrap">
                <span className="font-mono text-[var(--text-primary)] truncate" title={w.name}>{w.name}</span>
                <span className="pf-label pf-label--grey">{w.kind}</span>
                {/* HPA bir GÜVENLİK SİNYALİ: kullanıcı "bu uygulamayı durdurursam
                    otomatik ölçekleyici ne yapar?" sorusunu sormadan geçmemeli.
                    Playbook HPA'ya dokunmuyor — bunu açıkça yazıyoruz. */}
                {w.hasHpa && <span className="pf-label pf-label--gold">HPA var</span>}
                {/* GitOps: ArgoCD auto-sync acikken replica 0 birkac DAKIKADA sessizce
                    geri alinir. Dogrula-ve-tut penceresi (15 sn) bunu genellikle
                    yakalayamaz — o yuzden ONCEDEN uyariyoruz. */}
                {w.gitops && <span className="pf-label pf-label--orange" title={w.gitops}>GitOps ile yönetiliyor</span>}
                {w.specReplicas === 0 && w.restorable && (
                  <span className="pf-label pf-label--blue">durdurulmuş · geri alınabilir ({w.previousReplicas})</span>
                )}
                {w.specReplicas === 0 && !w.restorable && (
                  <span className="pf-label pf-label--grey">replica 0</span>
                )}
              </span>
              <span className="block mt-0.5 text-xs text-[var(--text-muted)] tabular-nums">
                replica {w.specReplicas} · hazır {w.readyReplicas}/{w.statusReplicas}
                {w.image ? <> · <span className="font-mono">{w.image}</span></> : null}
              </span>
            </span>
          </label>
        ))}
        {list.length === 0 && (
          <div className="px-3 py-10 text-center">
            <BoltSlashIcon aria-hidden="true" className="w-6 h-6 mx-auto text-[var(--text-muted)]" />
            {/* "HİÇBİRİ TARANAMADI" ile "NAMESPACE BOŞ" AYNI EKRAN DEĞİLDİR.
                Tüm cluster'lar düştüğünde `workloads` boş gelir ve akış yine "done"
                olur; ayırt edilmezse kullanıcı doğru namespace'i seçtiği halde yanlış
                seçtiğini sanıp oradan ayrılabilir. */}
            <p className="mt-2 text-sm text-[var(--text-muted)]">
              {query
                ? "Aramanla eşleşen uygulama yok."
                : allClustersFailed
                  ? "Hiçbir cluster taranamadı — bu, namespace'in boş olduğu anlamına GELMEZ."
                  : "Bu namespace'te dc/deploy/sts/rollout bulunamadı."}
            </p>
            {!query && !allClustersFailed && (
              <p className="mt-1 text-xs text-[var(--text-muted)]">
                Liste yalnızca dc/deploy/sts/rollout türlerini kapsar. Namespace adını ve
                bu namespace için yetkinizi de kontrol edin.
              </p>
            )}
            {!query && allClustersFailed && (
              <p className="mt-1 text-xs text-[var(--text-muted)]">
                Yukarıdaki hata ayrıntısına bakın; bağlantı düzeldiğinde tekrar deneyin.
              </p>
            )}
          </div>
        )}
      </div>

      <div className="flex items-center justify-between border-t border-[var(--border)] pt-4">
        <span className="text-xs text-[var(--text-muted)]">
          {selected.length} uygulama × {scope.clusters.length} cluster ={" "}
          <strong className="text-[var(--text-primary)]">{selected.length * scope.clusters.length} hedef</strong>
        </span>
        <button type="button" className="btn-primary" disabled={busy || !selected.length}
          onClick={() => onSubmit({ apps: selected, workloads, fetchedAt: fetchedAtRef.current || Date.now() })}>
          Devam
        </button>
      </div>
    </div>
  );
};

export default WorkloadStep;
