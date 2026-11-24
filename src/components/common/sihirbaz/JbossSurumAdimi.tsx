// src/components/common/sihirbaz/JbossSurumAdimi.tsx — OpsX, Telnet ve FileX sihirbazlarinin ORTAK JBoss
// surum adimi (2026-11-24; uc kopyaydi). Uygulama secildikten sonra, sunucu listesinden ONCE JBoss surumu
// sorulur; ayni uygulamanin host'lari farkli majör surumlerde (7.X / 8.Y) olabilir, birden fazla surum
// birlikte secilebilir, sunucu adimi listeyi buna gore suzer.
//
// MAJÖR SURUM BAZINDA GRUPLANIR (tam surum string'i DEGIL): eskiden TAM envanter degeri ("8.0.7", "8.1.2")
// tek tek secenekti; ayni majörde iki yama varsa kullanici birini isaretleyince digerindeki host'lar sunucu
// listesinde HIC gorunmuyordu ("Jboss8 sunuculari listelenmedi"). Tek "JBoss 8" secenegi o majördeki TUM
// host'lari kapsar; sunucu tarafi (opsx resolveLegacyTargets) zaten majör bazinda calisir.
import React, { useMemo, useState } from 'react';
import { ExclamationTriangleIcon } from '@heroicons/react/24/outline';
import { useAsyncEffect } from '@/hooks/useAsyncEffect';
import type { JbossSunucu } from './tipler';
import { majorOfHost, normalizeJbossVersion } from '@/utils/jboss';

const UNKNOWN_LABEL = 'Bilinmiyor';

const JbossSurumAdimi: React.FC<{
  app: string;
  busy?: boolean;
  onSubmit: (versions: string[]) => void;
  /** Modulun sunucu listesi ucu (getHosts). */
  sunuculariGetir: (app: string) => Promise<{ hosts?: JbossSunucu[] }>;
  /** Kullaniciya sorulan soru (modulun isi). */
  soru: string;
  /** Gruptaki gercek surumler satira sigmazsa kirpilmaz, sarar. Varsayilan: tek satir + title. */
  surumlerSarar?: boolean;
}> = ({ app, busy, onSubmit, sunuculariGetir, soru, surumlerSarar = false }) => {
  const [hosts, setHosts] = useState<JbossSunucu[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useAsyncEffect(
    async (alive) => {
      setLoading(true);
      setError(null);
      try {
        const r = await sunuculariGetir(app);
        if (alive()) setHosts(r.hosts ?? []);
      } catch (err) {
        if (alive()) setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (alive()) setLoading(false);
      }
    },
    [app],
  );

  // Bu uygulamanin host'larinda fiilen gorulen MAJOR surumler (sabit liste degil, envanterden). Bos / "NF" /
  // taninmayan bicim tek "Bilinmiyor" seceneginde toplanir. Secim majör bazinda, ama gruptaki GERCEK surumler
  // de gosterilir (or. "JBoss 8 · 8.0.7, 8.1.2"): asil degeri gizlemek hangi sunucunun hangi yamada oldugunu
  // goremez hale getirirdi.
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
      if (next.has(version)) next.delete(version);
      else next.add(version);
      return next;
    });
  }

  if (loading)
    return (
      <div className="py-8 text-center text-sm text-[var(--text-muted)]">
        Sunucular yükleniyor...
      </div>
    );
  if (error)
    return (
      <div className="bg-red-50 border border-red-100 rounded-xl p-4 text-sm text-red-700">
        {error}
      </div>
    );

  if (hosts.length === 0) {
    return (
      <div className="flex items-start gap-2 bg-amber-50 border border-amber-100 rounded-xl p-4 text-sm text-amber-800">
        <ExclamationTriangleIcon className="w-4 h-4 flex-shrink-0 mt-0.5" />
        <span>
          <strong>{app}</strong> için envanterde sunucu bulunamadı.
        </span>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <p className="text-sm text-[var(--text-secondary)]">{soru}</p>
        <p className="mt-1 text-xs text-[var(--text-muted)]">
          Uygulama: <span className="font-mono text-[var(--text-primary)]">{app}</span> · birden
          fazla sürüm birlikte seçilebilir
        </p>
      </div>

      <div className="space-y-1.5">
        {versions.map(({ major, count, actual }) => (
          <label
            key={major || '(unknown)'}
            className="w-full flex items-center gap-3 px-4 py-3 border border-[var(--border)] rounded-xl cursor-pointer hover:border-[var(--accent)] hover:shadow-sm transition-all has-[:checked]:border-[var(--accent)]"
          >
            <input
              type="checkbox"
              checked={selected.has(major)}
              onChange={() => toggle(major)}
              disabled={busy}
              className="rounded"
            />
            <span className="flex-1 min-w-0">
              <span className="block text-sm font-medium text-[var(--text-primary)] font-mono">
                {major ? `JBoss ${major}` : UNKNOWN_LABEL}
              </span>
              {actual.length > 0 && (
                <span
                  className={`block mt-0.5 text-[11px] text-[var(--text-muted)] font-mono ${surumlerSarar ? 'break-all whitespace-normal' : 'truncate'}`}
                  title={actual.join(', ')}
                >
                  {actual.join(', ')}
                </span>
              )}
            </span>
            <span className="text-xs text-[var(--text-muted)] flex-shrink-0">{count} sunucu</span>
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

export default JbossSurumAdimi;
