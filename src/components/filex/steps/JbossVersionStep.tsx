// src/components/filex/steps/JbossVersionStep.tsx — OpsX'in JbossVersionStep'iyle
// BİREBİR aynı davranış: aynı uygulamanın host'ları farklı JBoss majör sürümlerinde
// olabiliyor, kullanıcı birden fazla sürümü BİRLİKTE seçebilir.
//
// MAJÖR SÜRÜM BAZINDA GRUPLANIR. Burası uzun süre TAM sürüm string'ine ("8.0.7",
// "8.1.2") göre gruplanıyordu — OpsX ve Telnet'te düzeltilen hatanın kardeşi:
// aynı majörde iki yama varsa liste ikiye bölünüyor, kullanıcı birini işaretlediğinde
// diğer yamadaki sunucular sunucu listesinde HİÇ görünmüyordu.
import React, { useEffect, useMemo, useState } from "react";
import { ExclamationTriangleIcon } from "@heroicons/react/24/outline";
import { filexApi, type FilexHost } from "@/api/filexApi";
import { majorOfHost, normalizeJbossVersion } from "@/utils/jboss";

const UNKNOWN_LABEL = "Bilinmiyor";

const JbossVersionStep: React.FC<{
  app: string;
  busy?: boolean;
  onSubmit: (versions: string[]) => void;
}> = ({ app, busy, onSubmit }) => {
  const [hosts, setHosts] = useState<FilexHost[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    filexApi.getHosts(app)
      .then((r) => setHosts(r.hosts))
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  }, [app]);

  // Seçim majör bazında yapılır ama gruptaki GERÇEK sürümler de gösterilir
  // (ör. "JBoss 8 · 8.0.7, 8.1.2") — envanterdeki asıl değeri gizlemek, hangi
  // sunucunun hangi yamada olduğunu göremez hale getirirdi.
  const versions = useMemo(() => {
    const buckets = new Map<string, { count: number; actual: Set<string> }>();
    for (const h of hosts) {
      const raw = normalizeJbossVersion(h.jbossVersion);
      const major = majorOfHost(h);
      const b = buckets.get(major) || { count: 0, actual: new Set<string>() };
      b.count += 1;
      if (raw) b.actual.add(raw);
      buckets.set(major, b);
    }
    return [...buckets.entries()]
      .map(([major, b]) => ({
        major,
        count: b.count,
        actual: [...b.actual].sort((a, c) => a.localeCompare(c, undefined, { numeric: true })),
      }))
      .sort((a, b) => {
        if (!a.major) return 1;
        if (!b.major) return -1;
        return a.major.localeCompare(b.major, undefined, { numeric: true });
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
        <p className="text-sm text-[var(--text-secondary)]">Hangi JBoss sürümündeki sunucularda dosya listelemek istiyorsunuz?</p>
        <p className="mt-1 text-xs text-[var(--text-muted)]">
          Uygulama: <span className="font-mono text-[var(--text-primary)]">{app}</span> · birden fazla sürüm birlikte seçilebilir
        </p>
      </div>

      <div className="space-y-1.5">
        {versions.map(({ major, count, actual }) => (
          <label
            key={major || "(unknown)"}
            className="w-full flex items-center gap-3 px-4 py-3 border border-[var(--border)] rounded-xl cursor-pointer hover:border-[var(--accent)] hover:shadow-sm transition-all has-[:checked]:border-[var(--accent)]"
          >
            <input
              type="checkbox"
              checked={selected.has(major)}
              onChange={() => toggle(major)}
              disabled={busy}
              className="rounded"
            />
            <span className="flex-1 text-sm font-medium text-[var(--text-primary)]">
              <span className="font-mono">{major ? `JBoss ${major}` : UNKNOWN_LABEL}</span>
              {actual.length > 0 && (
                <span className="ml-2 text-xs font-normal text-[var(--text-muted)] font-mono">
                  {actual.join(", ")}
                </span>
              )}
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
