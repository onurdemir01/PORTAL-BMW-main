// src/components/opsx/steps/OcpPodSelectStep.tsx — Openshift dump bacağında pod seçimi.
//
// NEDEN AYRI BİR KEŞİF JOB'I: pod adları efemeraldir (her deploy'da değişir), portalın
// envanterinde tutulamaz. Bu adım açılır açılmaz bir AWX job'ı (opsx_openshift_pods.yaml)
// tetiklenir, iş bitene kadar beklenir ve çıkan liste kullanıcıya sunulur — namespace/
// uygulama seçiminin aksine burada ÖNBELLEK YOKTUR, liste her zaman canlıdır.
//
// COK-CLUSTER: bir tenant'a birden fazla gerçek OCP cluster'ı bağlı olabilir — keşif
// ARTIK HEPSİNE bakıyor (bkz. server/opsx/index.cjs resolveOcpClusterFanout), bu yüzden
// pod'lar CLUSTER BAZINDA gruplanır (LegacyJvmSelectStep'in host bazlı gruplamasıyla AYNI
// desen) ve seçim {cluster,pod} çifti olarak backend'e gider — dump playbook'u her pod'u
// KENDİ cluster'ına login olarak alır.
//
// Thread dump seçildiyse ayrıca "kaç dump, kaç saniye arayla" sorulur (varsayılan 1 dump,
// beklemesiz; sınırlar backend ve playbook ile AYNI: 1-100 adet, 0-3600 sn).
import React, { useEffect, useMemo, useState } from "react";
import { ExclamationTriangleIcon, ArrowPathIcon } from "@heroicons/react/24/outline";
import { opsxApi, type OpsxPod, type OpsxDumpType } from "@/api/opsxApi";

const TERMINAL = new Set(["successful", "failed", "error", "canceled"]);

function podKey(cluster: string, name: string): string {
  return `${cluster}::${name}`;
}

const OcpPodSelectStep: React.FC<{
  env: string;
  tenant: string;
  namespace: string;
  /** Keşif listesinde ilgili pod'ları öne çıkarmak için ön-doldurulan arama metni. */
  application?: string;
  dumpType: OpsxDumpType;
  busy?: boolean;
  onSubmit: (v: { pods: { cluster: string; pod: string }[]; threadDumpCount: number; threadDumpInterval: number }) => void;
}> = ({ env, tenant, namespace, application, dumpType, busy, onSubmit }) => {
  const [pods, setPods] = useState<OpsxPod[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Kısmi başarı: bazı cluster'lar başarısız olsa da başarılı olanların pod'ları gösterilir,
  // bu sadece bir UYARI olarak eklenir (r.pods VE r.message BİRLİKTE gelebilir).
  const [warning, setWarning] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState(application || "");
  const [nonce, setNonce] = useState(0);

  const [threadDumpCount, setThreadDumpCount] = useState(1);
  const [threadDumpInterval, setThreadDumpInterval] = useState(0);

  // Keşif job'ı: tetikle → terminal duruma gelene kadar poll et → listeyi göster.
  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;

    setLoading(true);
    setError(null);
    setWarning(null);
    setPods([]);
    setSelected(new Set());

    async function poll(awxServerId: number, jobId: number) {
      try {
        const r = await opsxApi.ocpPodsStatus(awxServerId, jobId);
        if (cancelled) return;
        if (!TERMINAL.has(r.status)) {
          timer = window.setTimeout(() => poll(awxServerId, jobId), 3000);
          return;
        }
        if (r.pods && r.pods.length > 0) {
          setPods(r.pods);
          if (r.message) setWarning(r.message);
        } else {
          setError(r.message || "Pod listesi alınamadı.");
        }
        setLoading(false);
      } catch (err: unknown) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
        setLoading(false);
      }
    }

    opsxApi.discoverOcpPods(env, tenant, namespace)
      .then((r) => {
        if (cancelled) return;
        if (r.jobId == null) {
          setError(r.message || "Pod keşfi işi başlatılamadı.");
          setLoading(false);
          return;
        }
        poll(r.awxServerId, r.jobId);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
        setLoading(false);
      });

    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [env, tenant, namespace, nonce]);

  const filteredPods = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return pods;
    return pods.filter((p) => p.name.toLowerCase().includes(q));
  }, [pods, search]);

  const grouped = useMemo(() => {
    const g: Record<string, OpsxPod[]> = {};
    for (const p of filteredPods) (g[p.cluster] ||= []).push(p);
    return g;
  }, [filteredPods]);

  function toggle(cluster: string, name: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      const k = podKey(cluster, name);
      if (next.has(k)) next.delete(k); else next.add(k);
      return next;
    });
  }

  const invalidCount = !Number.isInteger(threadDumpCount) || threadDumpCount < 1 || threadDumpCount > 100;
  const invalidInterval = !Number.isInteger(threadDumpInterval) || threadDumpInterval < 0 || threadDumpInterval > 3600;
  const threadOptionsInvalid = dumpType === "threaddump" && (invalidCount || invalidInterval);
  const ready = selected.size > 0 && !threadOptionsInvalid;

  function submit() {
    const targets = pods
      .filter((p) => selected.has(podKey(p.cluster, p.name)))
      .map((p) => ({ cluster: p.cluster, pod: p.name }));
    onSubmit({ pods: targets, threadDumpCount, threadDumpInterval });
  }

  if (loading) {
    return (
      <div className="py-8 text-center space-y-2">
        <ArrowPathIcon className="w-5 h-5 mx-auto animate-spin text-[var(--text-muted)]" />
        <p className="text-sm text-[var(--text-muted)]">
          <span className="font-mono text-[var(--text-primary)]">{namespace}</span> namespace'i tüm cluster'larda taranıyor…
        </p>
        <p className="text-xs text-[var(--text-muted)]">Bunun için bir Ansible işi çalıştırılıyor, birkaç saniye sürebilir.</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-3">
        <div className="flex items-start gap-2 bg-red-50 border border-red-100 rounded-xl p-4 text-sm text-red-700">
          <ExclamationTriangleIcon className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
        <button onClick={() => setNonce((n) => n + 1)} className="btn-secondary w-full text-sm">
          <ArrowPathIcon className="w-4 h-4" />
          Tekrar dene
        </button>
      </div>
    );
  }

  if (pods.length === 0) {
    return (
      <div className="space-y-3">
        <div className="flex items-start gap-2 bg-amber-50 border border-amber-100 rounded-xl p-4 text-sm text-amber-800">
          <ExclamationTriangleIcon className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <span><strong>{namespace}</strong> namespace'inde çalışan pod bulunamadı.</span>
        </div>
        <button onClick={() => setNonce((n) => n + 1)} className="btn-secondary w-full text-sm">
          <ArrowPathIcon className="w-4 h-4" />
          Tekrar dene
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <p className="text-sm text-[var(--text-secondary)]">
          Hangi pod'lardan {dumpType === "heapdump" ? "heap" : "thread"} dump alınsın?
        </p>
        <p className="mt-1 text-xs text-[var(--text-muted)]">
          Namespace: <span className="font-mono text-[var(--text-primary)]">{namespace}</span>
          {" · "}birden fazla pod seçilebilir
        </p>
      </div>

      {warning && (
        <div className="flex items-start gap-2 bg-amber-50 border border-amber-100 rounded-xl p-3 text-xs text-amber-800">
          <ExclamationTriangleIcon className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
          <span>Bazı cluster'lara ulaşılamadı: {warning}. Aşağıda erişilebilen cluster'lardaki pod'lar listelendi.</span>
        </div>
      )}

      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Pod adında ara…"
        className="w-full px-3 py-2 text-sm border border-[var(--border)] rounded-xl outline-none focus:border-[var(--accent)] focus:ring-1 focus:ring-[var(--accent)] transition"
      />

      <div className="space-y-3 max-h-72 overflow-y-auto">
        {Object.keys(grouped).length === 0 ? (
          <p className="text-xs text-[var(--text-muted)] px-2 py-3 text-center">Aramayla eşleşen pod yok.</p>
        ) : Object.keys(grouped).sort().map((cluster) => (
          <div key={cluster}>
            <label className="text-xs font-medium text-[var(--text-secondary)]">{cluster}</label>
            <div className="mt-1 space-y-1 border border-[var(--border)] rounded-xl p-1.5">
              {grouped[cluster].map((p) => (
                <label
                  key={p.name}
                  className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-[var(--bg-elevated)] cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={selected.has(podKey(p.cluster, p.name))}
                    onChange={() => toggle(p.cluster, p.name)}
                    disabled={busy}
                    className="rounded"
                  />
                  <span className="flex-1 text-sm text-[var(--text-primary)] font-mono truncate" title={p.name}>{p.name}</span>
                  <span className="text-[10px] text-[var(--text-muted)] font-mono">{p.ready}</span>
                  <span
                    className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${
                      p.status === "Running"
                        ? "bg-emerald-50 text-emerald-700 border-emerald-100"
                        : "bg-amber-50 text-amber-700 border-amber-100"
                    }`}
                  >
                    {p.status}
                  </span>
                </label>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Çoklu thread dump — YALNIZ thread dump için anlamlı (heap dump'ta pod başına
          tek dosya üretilir). Sınırlar backend + playbook ile aynı. */}
      {dumpType === "threaddump" && (
        <div className="space-y-2 border border-[var(--border)] rounded-xl p-3">
          <p className="text-xs font-medium text-[var(--text-secondary)]">Çoklu Thread Dump</p>
          <div className="flex items-center gap-3 flex-wrap">
            <label className="flex items-center gap-1.5 text-xs text-[var(--text-secondary)]">
              Adet:
              <input
                type="number"
                min={1}
                max={100}
                value={threadDumpCount}
                onChange={(e) => setThreadDumpCount(Number(e.target.value))}
                disabled={busy}
                className={`w-20 px-2 py-1 text-xs font-mono border rounded-lg outline-none focus:border-[var(--accent)] ${invalidCount ? "border-red-400" : "border-[var(--border)]"}`}
              />
            </label>
            <label className="flex items-center gap-1.5 text-xs text-[var(--text-secondary)]">
              Aralık (sn):
              <input
                type="number"
                min={0}
                max={3600}
                value={threadDumpInterval}
                onChange={(e) => setThreadDumpInterval(Number(e.target.value))}
                disabled={busy}
                className={`w-20 px-2 py-1 text-xs font-mono border rounded-lg outline-none focus:border-[var(--accent)] ${invalidInterval ? "border-red-400" : "border-[var(--border)]"}`}
              />
            </label>
          </div>
          <p className="text-[11px] text-[var(--text-muted)]">
            Varsayılan tek dump. Örnek: 10 adet / 10 sn aralık → her pod için 10 saniye arayla 10 thread dump alınır.
            {threadDumpCount > 1 && threadDumpInterval > 0 && (
              <> Tahmini süre: ~{Math.round(((threadDumpCount - 1) * threadDumpInterval) / 60 * 10) / 10} dk.</>
            )}
          </p>
          {threadOptionsInvalid && (
            <p className="text-[11px] text-red-600">Adet 1-100, aralık 0-3600 saniye arasında olmalı.</p>
          )}
        </div>
      )}

      <div className="flex items-center justify-between gap-3">
        <span className="text-xs text-[var(--text-muted)]">{selected.size} pod seçildi</span>
        <button
          onClick={submit}
          disabled={!ready || busy}
          className="btn-primary"
        >
          Dump Al
        </button>
      </div>
    </div>
  );
};

export default OcpPodSelectStep;
