// src/components/logx_v2/steps/ocp/ClusterSelectStep.tsx — env → tenant → cluster(lar)
// kademeli seçimi. Cluster çoklu-seçilebilir (kullanıcı kararı: "bir ya da birden fazla
// cluster ayrı ayrı seçilebilsin"). Seçim backend'de ocp_cluster_index'e ve
// ocp_terminal_host_map'e karşı yeniden doğrulanır (bkz. server/logx/v2/ocp.cjs selectClusters).
import React, { useEffect, useState } from "react";
import { logxV2Api } from "@/api/logxV2Api";

const ClusterSelectStep: React.FC<{ onSubmit: (env: string, tenant: string, clusters: string[]) => void; busy?: boolean }> = ({ onSubmit, busy }) => {
  const [tree, setTree] = useState<Record<string, Record<string, string[]>>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [env, setEnv] = useState("");
  const [tenant, setTenant] = useState("");
  const [clusters, setClusters] = useState<Set<string>>(new Set());

  useEffect(() => {
    logxV2Api.getClusterTree()
      .then((r) => setTree(r.tree))
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  }, []);

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

  if (loading) return <div className="py-8 text-center text-sm text-[var(--text-muted)]">Yükleniyor...</div>;
  if (error) return <div className="bg-red-50 rounded-xl p-4 text-sm text-red-700">{error}</div>;
  if (envs.length === 0) {
    return <div className="bg-amber-50 border border-amber-100 rounded-xl p-4 text-sm text-amber-800">Henüz hiç cluster tanımlanmamış — admin panelinden "LogX v2 Yapılandırma" sekmesinden eklenmeli.</div>;
  }

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
    </div>
  );
};

export default ClusterSelectStep;
