// src/components/opsx/steps/OcpClusterSelectStep.tsx — restart/stop/start tetiklenmeden
// önce, tenant/env grubundaki gerçek cluster'lardan (bkz. OcpTargetStep dosya başı notu —
// ör. ark_prod → gbocpprod1,gbocpprod2,gbocpprod4) hedeflenecek bir alt-küme seçimi.
//
// NEDEN: gerçek playbook (application_rollout.yaml) hedefi `hosts: "{{ oc_cluster }}_{{
// env }}"` ile TÜM bu cluster'ları TEK grupta hedefliyor — uygulama sahibi bazen SADECE
// birinde işlem yapmak istiyor. oc_cluster/env DEĞİŞTİRİLMEZ (o grup çözümü hâlâ gerekli);
// burada seçilen isimler backend'de AWX'in KENDİ `limit` alanına konur, Ansible bunu grupla
// KESİŞTİRİR. Varsayılan: TÜMÜ seçili (mevcut, kısıtlamasız davranış) — kullanıcı isterse
// bazılarının işaretini kaldırır.
//
// NOT: backend bunu OLDUĞU GİBİ KABUL ETMEZ — resolveOpenshiftTargets'in az önce DB'den
// çözdüğü gerçek cluster listesine karşı yeniden doğrular (anti-TOCTOU).
import React, { useEffect, useState } from "react";
import { opsxApi } from "@/api/opsxApi";

const OcpClusterSelectStep: React.FC<{
  env: string;
  tenant: string;
  busy?: boolean;
  onSubmit: (clusters: string[]) => void;
}> = ({ env, tenant, busy, onSubmit }) => {
  const [clusters, setClusters] = useState<string[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    opsxApi.getClusters()
      .then((r) => {
        const names = r.tree?.[env]?.[tenant] || [];
        setClusters(names);
        setSelected(new Set(names)); // varsayılan: tümü seçili (kısıtlamasız)
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  }, [env, tenant]);

  function toggle(name: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name); else next.add(name);
      return next;
    });
  }

  function toggleAll() {
    setSelected((prev) => (prev.size === clusters.length ? new Set() : new Set(clusters)));
  }

  if (loading) return <div className="py-8 text-center text-sm text-[var(--text-muted)]">Cluster'lar yükleniyor...</div>;
  if (error) return <div className="bg-red-50 border border-red-100 rounded-xl p-4 text-sm text-red-700">{error}</div>;

  if (clusters.length === 0) {
    return (
      <div className="bg-amber-50 border border-amber-100 rounded-xl p-4 text-sm text-amber-800">
        <strong>{tenant} / {env}</strong> için envanterde tanımlı gerçek cluster bulunamadı.
      </div>
    );
  }

  const allSelected = selected.size === clusters.length;

  return (
    <div className="space-y-4">
      <div>
        <p className="text-sm text-[var(--text-secondary)]">
          İşlemin hedefleneceği cluster'ları seçin — tümü işaretliyse kısıtlama uygulanmaz.
        </p>
        <p className="mt-1 text-xs text-[var(--text-muted)]">
          Cluster grubu: <span className="font-mono text-[var(--text-primary)]">{tenant} / {env}</span>
        </p>
      </div>

      <div>
        <div className="flex items-center justify-between mb-1">
          <label className="text-xs font-medium text-[var(--text-secondary)]">
            Gerçek cluster'lar ({clusters.length})
          </label>
          <button onClick={toggleAll} className="text-xs text-[var(--accent)] hover:underline">
            {allSelected ? "Seçimi kaldır" : "Tümünü seç"}
          </button>
        </div>
        <div className="space-y-1 border border-[var(--border)] rounded-xl p-1.5 max-h-80 overflow-y-auto">
          {clusters.map((c) => (
            <label
              key={c}
              className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-[var(--bg-elevated)] cursor-pointer"
            >
              <input
                type="checkbox"
                checked={selected.has(c)}
                onChange={() => toggle(c)}
                className="rounded"
              />
              <span className="text-sm text-[var(--text-primary)] font-mono">{c}</span>
            </label>
          ))}
        </div>
      </div>

      <div className="flex items-center justify-between gap-3">
        <span className="text-xs text-[var(--text-muted)]">
          {allSelected ? "Tüm cluster'lar (kısıtlama yok)" : `${selected.size}/${clusters.length} cluster seçildi`}
        </span>
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

export default OcpClusterSelectStep;
