// src/components/opsx/steps/JbossVersionStep.tsx — uygulama seçildikten sonra,
// sunucu listesinden ÖNCE JBoss versiyonu sorulur. Aynı uygulamanın host'ları
// farklı JBoss majör sürümlerinde (7.X / 8.Y) olabiliyor — kullanıcı önce versiyonu
// seçer, HostSelectStep listeyi buna göre filtreler.
import React, { useEffect, useMemo, useState } from "react";
import { ExclamationTriangleIcon } from "@heroicons/react/24/outline";
import { opsxApi, type OpsxHost } from "@/api/opsxApi";

const UNKNOWN_LABEL = "Bilinmiyor";

const JbossVersionStep: React.FC<{
  app: string;
  busy?: boolean;
  onSelect: (version: string) => void;
}> = ({ app, busy, onSelect }) => {
  const [hosts, setHosts] = useState<OpsxHost[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    opsxApi.getHosts(app)
      .then((r) => setHosts(r.hosts))
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  }, [app]);

  // Bu uygulamanın host'larında fiilen görülen versiyonlar — sabit bir liste değil,
  // envanterden gelen gerçek değerler (ör. "7.3.10", "8.0.7"). Boş/"NF" gibi
  // bilinmeyen değerler tek bir "Bilinmiyor" seçeneğinde toplanır.
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
        <p className="text-sm text-[var(--text-secondary)]">Hangi JBoss sürümündeki sunucularla işlem yapmak istiyorsunuz?</p>
        <p className="mt-1 text-xs text-[var(--text-muted)]">
          Uygulama: <span className="font-mono text-[var(--text-primary)]">{app}</span>
        </p>
      </div>

      <div className="space-y-1.5">
        {versions.map(([version, count]) => (
          <button
            key={version || "(unknown)"}
            onClick={() => onSelect(version)}
            disabled={busy}
            className="w-full flex items-center justify-between gap-3 px-4 py-3 border border-[var(--border)] rounded-xl text-left hover:border-[var(--accent)] hover:shadow-sm transition-all active:scale-[0.99] disabled:opacity-50 disabled:pointer-events-none"
          >
            <span className="text-sm font-medium text-[var(--text-primary)] font-mono">
              {version ? `JBoss ${version}` : UNKNOWN_LABEL}
            </span>
            <span className="text-xs text-[var(--text-muted)]">{count} sunucu</span>
          </button>
        ))}
      </div>
    </div>
  );
};

export default JbossVersionStep;
