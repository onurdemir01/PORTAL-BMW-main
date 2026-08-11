// src/components/opsx/steps/HostSelectStep.tsx — seçilen uygulamanın bulunduğu
// sunucular arasından çoklu seçim.
//
// NOT: burada seçilen liste sunucuya gönderilse de backend onu OLDUĞU GİBİ KABUL
// ETMEZ — envanterden yeniden çözüp yalnızca gerçekten bu uygulamaya ait olan
// host'ları geçirir (anti-TOCTOU, bkz. server/opsx/index.cjs). Yani bu ekran bir
// kolaylık katmanıdır, güvenlik sınırı değil.
import React, { useEffect, useMemo, useState } from "react";
import { ExclamationTriangleIcon } from "@heroicons/react/24/outline";
import { opsxApi, type OpsxHost } from "@/api/opsxApi";
import { jbossMajorOf } from "./JbossVersionStep";

const HostSelectStep: React.FC<{
  app: string;
  jbossVersions: string[];
  busy?: boolean;
  onSubmit: (hosts: string[]) => void;
}> = ({ app, jbossVersions, busy, onSubmit }) => {
  const [hosts, setHosts] = useState<OpsxHost[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
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

  // Bir önceki adımda seçilen JBoss MAJÖR sürümlerine (birden fazla olabilir) göre
  // daralt — tam sürüm string'i değil (bkz. JbossVersionStep.tsx dosya başı notu):
  // aynı majörde farklı minör sürümler ("8.0.7" / "8.1.2") aynı seçenek altında toplanır,
  // yoksa biri işaretlenip diğeri seçilmeden o host'lar listeden hiç görünmezdi.
  const filteredHosts = useMemo(() => {
    const wanted = new Set(jbossVersions);
    return hosts.filter((h) => {
      const raw = h.jbossVersion && h.jbossVersion.toUpperCase() !== "NF" ? h.jbossVersion : "";
      return wanted.has(jbossMajorOf(raw));
    });
  }, [hosts, jbossVersions]);

  // Ortama göre grupla — kullanıcı prod/test sunucusunu ayırt edebilsin.
  const grouped = useMemo(() => {
    const g: Record<string, OpsxHost[]> = {};
    for (const h of filteredHosts) {
      const key = h.env || "(ortam belirtilmemiş)";
      (g[key] ||= []).push(h);
    }
    return g;
  }, [filteredHosts]);

  function toggle(host: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(host)) next.delete(host); else next.add(host);
      return next;
    });
  }

  function toggleAllIn(envKey: string) {
    const envHosts = grouped[envKey].map((h) => h.host);
    const allSelected = envHosts.every((h) => selected.has(h));
    setSelected((prev) => {
      const next = new Set(prev);
      for (const h of envHosts) {
        if (allSelected) next.delete(h); else next.add(h);
      }
      return next;
    });
  }

  if (loading) return <div className="py-8 text-center text-sm text-[var(--text-muted)]">Sunucular yükleniyor...</div>;
  if (error) return <div className="bg-red-50 border border-red-100 rounded-xl p-4 text-sm text-red-700">{error}</div>;

  if (filteredHosts.length === 0) {
    return (
      <div className="flex items-start gap-2 bg-amber-50 border border-amber-100 rounded-xl p-4 text-sm text-amber-800">
        <ExclamationTriangleIcon className="w-4 h-4 flex-shrink-0 mt-0.5" />
        <span>
          <strong>{app}</strong> için seçilen JBoss sürümünde ({jbossVersions.map((v) => v ? `${v}.X` : "Bilinmiyor").join(", ")}) sunucu bulunamadı.
        </span>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <p className="text-sm text-[var(--text-secondary)]">Lütfen işlem yapılması istenen sunucuları seçin</p>
        <p className="mt-1 text-xs text-[var(--text-muted)]">
          Uygulama: <span className="font-mono text-[var(--text-primary)]">{app}</span>
        </p>
      </div>

      <div className="space-y-3 max-h-80 overflow-y-auto">
        {Object.keys(grouped).sort().map((envKey) => (
          <div key={envKey}>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs font-medium text-[var(--text-secondary)]">{envKey}</label>
              <button
                onClick={() => toggleAllIn(envKey)}
                className="text-xs text-[var(--accent)] hover:underline"
              >
                {grouped[envKey].every((h) => selected.has(h.host)) ? "Seçimi kaldır" : "Tümünü seç"}
              </button>
            </div>
            <div className="space-y-1 border border-[var(--border)] rounded-xl p-1.5">
              {grouped[envKey].map((h) => (
                <label
                  key={h.host}
                  className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-[var(--bg-elevated)] cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={selected.has(h.host)}
                    onChange={() => toggle(h.host)}
                    className="rounded"
                  />
                  <span className="text-sm text-[var(--text-primary)] font-mono">{h.host}</span>
                </label>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between gap-3">
        <span className="text-xs text-[var(--text-muted)]">{selected.size} sunucu seçildi</span>
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

export default HostSelectStep;
