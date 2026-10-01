// src/components/logx_v2/steps/ocp/ClusterSelectStep.tsx — env → tenant → cluster(lar)
// kademeli seçimi. Cluster çoklu-seçilebilir (kullanıcı kararı: "bir ya da birden fazla
// cluster ayrı ayrı seçilebilsin"). Seçim backend'de ocp_cluster_index'e ve
// ocp_terminal_host_map'e karşı yeniden doğrulanır (bkz. server/logx/v2/ocp.cjs selectClusters).
import React, { useCallback, useState } from "react";
import { logxV2Api } from "@/api/logxV2Api";
import { LoadingLogo } from '@/components/common/LoadingLogo';
import { useAsyncEffect } from '@/hooks/useAsyncEffect';

const ClusterSelectStep: React.FC<{ onSubmit: (env: string, tenant: string, clusters: string[]) => void; busy?: boolean }> = ({ onSubmit, busy }) => {
  const [tree, setTree] = useState<Record<string, Record<string, string[]>>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [env, setEnv] = useState("");
  const [tenant, setTenant] = useState("");
  const [clusters, setClusters] = useState<Set<string>>(new Set());

  // "Tekrar dene" de bunu cagirir: yukleme hatasi eskiden yalnizca metin gosteriyordu,
  // sayfayi yenilemekten baska cikis yoktu.
  const yukle = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setTree((await logxV2Api.getClusterTree()).tree);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);
  useAsyncEffect(async (alive) => {
    if (alive()) await yukle();
  }, [yukle]);

  const envs = Object.keys(tree).sort();
  const tenants = env ? Object.keys(tree[env] || {}).sort() : [];
  const availableClusters = env && tenant ? (tree[env]?.[tenant] || []) : [];

  function toggleCluster(c: string) {
    setClusters((prev) => {
      const next = new Set(prev);
      if (next.has(c)) next.delete(c); else next.add(c);
      return next;
    });
  }

  if (loading) return <LoadingLogo compact />;
  if (error) {
    return (
      <div className="bg-red-50 rounded-xl p-4 text-sm text-red-700 space-y-2" data-testid="logx-cluster-hata">
        <p>Cluster listesi okunamadı: {error}</p>
        <button type="button" onClick={() => void yukle()} className="btn-secondary text-xs">
          Tekrar dene
        </button>
      </div>
    );
  }
  if (envs.length === 0) {
    return <div className="bg-amber-50 border border-amber-100 rounded-xl p-4 text-sm text-amber-800">Henüz hiç cluster tanımlanmamış — Admin &gt; OCP Yapılandırma &gt; OCP Cluster Hiyerarşisi&apos;nden eklenmeli.</div>;
  }
  // KAPALI "DEVAM"IN SEBEBI soylenir.
  const devamSebep = !env
    ? 'Önce bir ortam seçin.'
    : !tenant
      ? 'Bir tenant seçin.'
      : availableClusters.length === 0
        ? 'Bu tenant için aktif cluster yok.'
        : clusters.size === 0
          ? 'En az bir cluster işaretleyin.'
          : null;

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">Ortam</label>
        <div className="flex flex-wrap gap-1.5">
          {envs.map((e) => (
            <button
              key={e}
              onClick={() => { setEnv(e); setTenant(""); setClusters(new Set()); }}
              className={`px-3 py-1.5 text-xs rounded-full border transition-colors ${env === e ? "bg-[var(--accent)] text-white border-[var(--accent)]" : "border-[var(--border)] text-[var(--text-secondary)] hover:border-[var(--text-muted)]"}`}
            >
              {e}
            </button>
          ))}
        </div>
      </div>

      {env && (
        <div>
          <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">Tenant / İş Birimi</label>
          <div className="flex flex-wrap gap-1.5">
            {tenants.map((t) => (
              <button
                key={t}
                onClick={() => { setTenant(t); setClusters(new Set()); }}
                className={`px-3 py-1.5 text-xs rounded-full border transition-colors ${tenant === t ? "bg-[var(--accent)] text-white border-[var(--accent)]" : "border-[var(--border)] text-[var(--text-secondary)] hover:border-[var(--text-muted)]"}`}
              >
                {t}
              </button>
            ))}
          </div>
        </div>
      )}

      {tenant && (
        <div>
          <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">Cluster(lar) — birden fazla seçilebilir</label>
          <div className="space-y-1">
            {availableClusters.length === 0 && (
              <p className="text-xs text-[var(--text-muted)]">
                Bu tenant için aktif cluster yok (Admin &gt; OCP Yapılandırma &gt; OCP Cluster Hiyerarşisi).
              </p>
            )}
            {availableClusters.map((c) => (
              <label key={c} className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-[var(--bg-elevated)] cursor-pointer">
                <input type="checkbox" checked={clusters.has(c)} onChange={() => toggleCluster(c)} className="rounded" />
                <span className="text-sm text-[var(--text-primary)] font-mono">{c}</span>
              </label>
            ))}
          </div>
        </div>
      )}

      <button
        onClick={() => onSubmit(env, tenant, [...clusters])}
        disabled={clusters.size === 0 || busy}
        className="btn-primary w-full"
      >
        {busy ? "Doğrulanıyor…" : "Devam Et"}
      </button>
      {!busy && devamSebep && (
        <p className="text-xs text-[var(--text-muted)] text-center" data-testid="logx-cluster-sebep">
          {devamSebep}
        </p>
      )}
    </div>
  );
};

export default ClusterSelectStep;
