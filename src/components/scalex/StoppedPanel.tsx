// src/components/scalex/StoppedPanel.tsx — "şu an durdurulmuş" + SAPMA.
//
// Gerçeğin kaynağı cluster'daki `scalex-state-<app>` ConfigMap'idir; portal ayna
// tutar. İki kaynak ayrışabilir ve bu NORMAL:
//   * biri AWX'ten elle geri almıştır → portalda kayıt var, cluster'da yok
//   * biri AWX'ten elle durdurmuştur  → cluster'da var, portalda yok
// Ekran bunu GİZLEMEZ. Gizlemek "portal yanılıyor" demek olurdu; göstermek "birisi portal
// dışından iş yapmış" demek — ikincisi kullanıcının bilmesi gereken şey.
import React, { useEffect, useState } from "react";
import { ArrowPathIcon, ExclamationTriangleIcon, ArrowUturnLeftIcon } from "@heroicons/react/24/outline";
import { scalexApi, type ScaleXStoppedItem } from "@/api/scalexApi";
import { fmtRelative } from "@/utils/datetime";

interface Props {
  env: string; tenant: string;
  onRestore?: (item: ScaleXStoppedItem) => void;
}

// Bu esigi asan bir durdurma "unutulmus" olabilir. Sert bir kural degil, bir hatirlatma:
// kimse bir uygulamayi haftalarca kapali birakmayi planlamaz, ama olur.
const STALE_DAYS = 7;

function daysSince(iso: string | null): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return null;
  return Math.floor((Date.now() - t) / 86_400_000);
}

const DRIFT_TEXT: Record<string, string> = {
  missing_on_cluster: "Portal kaydı var, cluster'da ConfigMap YOK — biri elle geri almış olabilir.",
  unknown_to_portal: "Cluster'da durdurulmuş ama portal kaydı yok — AWX'ten elle durdurulmuş.",
};

const StoppedPanel: React.FC<Props> = ({ env, tenant, onRestore }) => {
  const [items, setItems] = useState<ScaleXStoppedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true); setError(null);
    try {
      const r = await scalexApi.stopped(env, tenant);
      if (r.ok) setItems(r.items || []); else setError(r.message || "Liste alınamadı.");
    } catch (e) { setError((e as Error).message); } finally { setLoading(false); }
  }

  useEffect(() => { if (env && tenant) load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [env, tenant]);

  if (!env || !tenant) return null;
  if (loading) return <p className="text-sm text-[var(--text-muted)]">Durdurulmuş uygulamalar yükleniyor…</p>;
  if (error) {
    return (
      <div className="flex items-start gap-2 bg-red-50 border border-red-100 rounded-xl p-3 text-sm text-red-700">
        <ExclamationTriangleIcon aria-hidden="true" className="w-4 h-4 flex-shrink-0 mt-0.5" /><span>{error}</span>
      </div>
    );
  }
  if (!items.length) {
    return <p className="text-sm text-[var(--text-muted)]">Bu ortam/tenant için portalda durdurulmuş uygulama kaydı yok.</p>;
  }

  const drifted = items.filter((i) => i.driftStatus !== "in_sync");

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-semibold text-[var(--text-primary)]">
          Şu an durdurulmuş <span className="text-xs font-normal text-[var(--text-muted)]">({items.length})</span>
        </p>
        <button type="button" onClick={load}
          className="inline-flex items-center gap-1.5 text-xs text-[var(--accent)] hover:underline">
          <ArrowPathIcon aria-hidden="true" className="w-3.5 h-3.5" /> Durumu tazele
        </button>
      </div>

      {drifted.length > 0 && (
        <p className="text-xs text-amber-800">
          {drifted.length} kayıt cluster gerçeğiyle ayrışmış — aşağıda işaretli.
        </p>
      )}

      <div className="rounded-xl border border-[var(--border)] divide-y divide-[var(--border-subtle)]">
        {items.map((it) => (
          <div key={it.id} className="px-3 py-2.5 text-sm">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <span className="min-w-0 flex items-center gap-2">
                <span className="font-mono truncate text-[var(--text-primary)]" title={it.appName}>{it.appName}</span>
                {/* `title` KESILEN OGENIN KENDISINDE (bkz. D7 bekcisi). */}
                <span className="text-xs text-[var(--text-muted)] truncate"
                  title={`${it.clusterName}/${it.namespace}`}>{it.clusterName}/{it.namespace}</span>
              </span>
              <span className="flex items-center gap-2 text-xs text-[var(--text-muted)] whitespace-nowrap">
                {(() => {
                  const d = daysSince(it.stoppedAt);
                  return d != null && d >= STALE_DAYS
                    ? <span className="pf-label pf-label--gold">{d} gündür durdurulmuş</span>
                    : null;
                })()}
                {it.previousReplicas != null && <span className="tabular-nums">{it.previousReplicas} → 0</span>}
                {it.stoppedBy && <span>· {it.stoppedBy}</span>}
                {it.stoppedAt && <span>· {fmtRelative(it.stoppedAt)}</span>}
                {it.driftStatus === "in_sync" && onRestore && (
                  <button type="button" onClick={() => onRestore(it)}
                    className="inline-flex items-center gap-1 text-[var(--accent)] hover:underline">
                    <ArrowUturnLeftIcon aria-hidden="true" className="w-3.5 h-3.5" /> Geri Al
                  </button>
                )}
              </span>
            </div>
            {DRIFT_TEXT[it.driftStatus] && (
              <p className="mt-1 flex items-start gap-1.5 text-xs text-amber-800">
                <ExclamationTriangleIcon aria-hidden="true" className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                {DRIFT_TEXT[it.driftStatus]}
              </p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};

export default StoppedPanel;
