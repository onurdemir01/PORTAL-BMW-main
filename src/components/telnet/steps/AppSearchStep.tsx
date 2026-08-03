// src/components/telnet/steps/AppSearchStep.tsx — uygulama seçimi. OpsX'in
// AppSearchStep'iyle BİREBİR aynı davranış: aranabilir liste, DB erişilemezse
// snapshot fallback uyarısı.
import React, { useEffect, useState } from "react";
import { MagnifyingGlassIcon, ExclamationTriangleIcon } from "@heroicons/react/24/outline";
import { telnetApi } from "@/api/telnetApi";

const AppSearchStep: React.FC<{ onSelect: (app: string) => void; busy?: boolean }> = ({ onSelect, busy }) => {
  const [search, setSearch] = useState("");
  const [apps, setApps] = useState<string[]>([]);
  const [fallbackMode, setFallbackMode] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => {
      setLoading(true);
      setError(null);
      telnetApi.searchApps(search)
        .then((r) => { setApps(r.apps); setFallbackMode(r.fallbackMode); })
        .catch((err) => setError(err instanceof Error ? err.message : String(err)))
        .finally(() => setLoading(false));
    }, 250);
    return () => clearTimeout(timer);
  }, [search]);

  return (
    <div className="space-y-3">
      {fallbackMode && (
        <div className="flex items-start gap-2 bg-amber-50 border border-amber-100 rounded-xl p-3 text-xs text-amber-800">
          <ExclamationTriangleIcon className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <span>Envanter veritabanına şu an erişilemiyor — son bilinen uygulama listesi (snapshot) gösteriliyor.</span>
        </div>
      )}
      <div className="relative">
        <MagnifyingGlassIcon className="w-4 h-4 text-[var(--text-muted)] absolute left-3 top-1/2 -translate-y-1/2" />
        <input
          autoFocus
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Uygulama adı ara..."
          className="w-full pl-9 pr-3 py-2.5 text-sm border border-[var(--border)] rounded-xl outline-none focus:border-[var(--accent)] focus:ring-1 focus:ring-[var(--accent)] transition"
        />
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="max-h-72 overflow-y-auto border border-[var(--border)] rounded-xl divide-y divide-[var(--border)]">
        {loading ? (
          <p className="text-sm text-[var(--text-muted)] text-center py-6">Aranıyor...</p>
        ) : apps.length === 0 ? (
          <p className="text-sm text-[var(--text-muted)] text-center py-6">Sonuç yok.</p>
        ) : (
          apps.map((app) => (
            <button
              key={app}
              onClick={() => onSelect(app)}
              disabled={busy}
              className="w-full text-left px-4 py-2.5 text-sm text-[var(--text-primary)] hover:bg-[var(--bg-elevated)] transition-colors active:bg-[var(--bg-elevated)] disabled:opacity-50 disabled:pointer-events-none"
            >
              {app}
            </button>
          ))
        )}
      </div>
    </div>
  );
};

export default AppSearchStep;
