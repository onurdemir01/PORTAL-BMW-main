// src/components/telnet/steps/JbossVersionStep.tsx — uygulama seçildikten sonra,
// sunucu listesinden ÖNCE JBoss versiyonu sorulur. OpsX'in JbossVersionStep'iyle
// BİREBİR aynı davranış — birden fazla sürüm birlikte seçilebilir.
import React, { useEffect, useMemo, useState } from "react";
import { ExclamationTriangleIcon } from "@heroicons/react/24/outline";
import { telnetApi, type TelnetHost } from "@/api/telnetApi";

const UNKNOWN_LABEL = "Bilinmiyor";

const JbossVersionStep: React.FC<{
  app: string;
  busy?: boolean;
  onSubmit: (versions: string[]) => void;
}> = ({ app, busy, onSubmit }) => {
  const [hosts, setHosts] = useState<TelnetHost[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    telnetApi.getHosts(app)
      .then((r) => setHosts(r.hosts))
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  }, [app]);

  const versions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const h of hosts) {
      const v = h.jbossVersion && h.jbossVersion.toUpperCase() !== "NF" ? h.jbossVersion : "";
      counts.set(v, (counts.get(v) || 0) + 1);
    }
    return [...counts.entries()].sort(([a], [b]) => {
      if (!a) return 1;
      if (!b) return -1;
      return a.localeCompare(b, undefined, { numeric: true });
    });
  }, [hosts]);

  function toggle(version: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(version)) next.delete(version); else next.add(version);
      return next;
    });
  }

  if (loading) return <div className="py-8 text-center text-sm text-[var(--text-muted)]">Sunucular yükleniyor...</div>;
  if (error) return <div className="bg-red-50 border border-red-100 rounded-xl p-4 text-sm text-red-700">{error}</div>;

  if (hosts.length === 0) {
    return (
      <div className="flex items-start gap-2 bg-amber-50 border border-amber-100 rounded-xl p-4 text-sm text-amber-800">
        <ExclamationTriangleIcon className="w-4 h-4 flex-shrink-0 mt-0.5" />
        <span><strong>{app}</strong> için envanterde sunucu bulunamadı.</span>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <p className="text-sm text-[var(--text-secondary)]">Hangi JBoss sürümündeki sunucularla test yapmak istiyorsunuz?</p>
        <p className="mt-1 text-xs text-[var(--text-muted)]">
          Uygulama: <span className="font-mono text-[var(--text-primary)]">{app}</span> · birden fazla sürüm birlikte seçilebilir
        </p>
      </div>

      <div className="space-y-1.5">
        {versions.map(([version, count]) => (
          <label
            key={version || "(unknown)"}
            className="w-full flex items-center gap-3 px-4 py-3 border border-[var(--border)] rounded-xl cursor-pointer hover:border-[var(--accent)] hover:shadow-sm transition-all has-[:checked]:border-[var(--accent)]"
          >
            <input
              type="checkbox"
              checked={selected.has(version)}
              onChange={() => toggle(version)}
              disabled={busy}
              className="rounded"
            />
            <span className="flex-1 text-sm font-medium text-[var(--text-primary)] font-mono">
              {version ? `JBoss ${version}` : UNKNOWN_LABEL}
            </span>
            <span className="text-xs text-[var(--text-muted)]">{count} sunucu</span>
          </label>
        ))}
      </div>

      <div className="flex items-center justify-between gap-3">
        <span className="text-xs text-[var(--text-muted)]">{selected.size} sürüm seçildi</span>
        <button
          onClick={() => onSubmit([...selected])}
          disabled={selected.size === 0 || busy}
          className="btn-primary"
        >
          Devam Et
        </button>
      </div>
    </div>
  );
};

export default JbossVersionStep;
