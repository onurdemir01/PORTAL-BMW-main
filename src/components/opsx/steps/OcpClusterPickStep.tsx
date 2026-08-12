// src/components/opsx/steps/OcpClusterPickStep.tsx — restart/rollout tetiklenmeden önce,
// tenant/env grubundaki GERÇEK cluster'lardan (bkz. OcpTargetStep dosya başı notu — ör.
// ark_prod → gbocpprod1, gbocpprod2, gbocpprod4) hedeflenecek TEK birinin seçimi.
//
// NEDEN ZORUNLU TEK SEÇİM (çoklu seçim/"hepsi" YOK): AWX'in `limit` alanı production'da
// sessizce yutulduğu için (bkz. server/opsx/index.cjs dosya başı notu) gerçek kısıtlama
// SADECE playbook'un `hosts:` satırının doğrudan TEK bir gerçek cluster adına
// şablonlanmasıyla mümkün — bu da kullanıcının MUTLAKA birini seçmesini gerektirir.
import React, { useEffect, useState } from "react";
import { ServerStackIcon } from "@heroicons/react/24/outline";
import { opsxApi } from "@/api/opsxApi";

const OcpClusterPickStep: React.FC<{
  env: string;
  tenant: string;
  busy?: boolean;
  onSubmit: (cluster: string) => void;
}> = ({ env, tenant, busy, onSubmit }) => {
  const [clusters, setClusters] = useState<string[]>([]);
  const [selected, setSelected] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    opsxApi.getClusters()
      .then((r) => {
        const names = r.tree?.[env]?.[tenant] || [];
        setClusters(names);
        if (names.length === 1) setSelected(names[0]); // tek seçenek varsa önceden işaretle
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  }, [env, tenant]);

  if (loading) return <div className="py-8 text-center text-sm text-[var(--text-muted)]">Cluster'lar yükleniyor...</div>;
  if (error) return <div className="bg-red-50 border border-red-100 rounded-xl p-4 text-sm text-red-700">{error}</div>;

  if (clusters.length === 0) {
    return (
      <div className="bg-amber-50 border border-amber-100 rounded-xl p-4 text-sm text-amber-800">
        <strong>{tenant} / {env}</strong> için envanterde tanımlı gerçek cluster bulunamadı —
        Admin &gt; LogX Yapılandırma ekranından cluster kataloğunu kontrol edin.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <p className="text-sm text-[var(--text-secondary)]">İşlemin hedefleneceği cluster'ı seçin.</p>
        <p className="mt-1 text-xs text-[var(--text-muted)]">
          Cluster grubu: <span className="font-mono text-[var(--text-primary)]">{tenant} / {env}</span>
        </p>
      </div>

      <div className="border border-[var(--border)] rounded-xl divide-y divide-[var(--border)]">
        {clusters.map((name) => (
          <label
            key={name}
            className="flex items-center gap-3 px-4 py-2.5 hover:bg-[var(--bg-elevated)] transition-colors cursor-pointer"
          >
            <input
              type="radio"
              name="ocp-cluster"
              checked={selected === name}
              onChange={() => setSelected(name)}
              className="rounded-full"
            />
            <ServerStackIcon aria-hidden="true" className="w-4 h-4 text-[var(--text-muted)] flex-shrink-0" />
            <span className="text-sm font-mono text-[var(--text-primary)] flex-1 truncate">{name}</span>
          </label>
        ))}
      </div>

      <button
        onClick={() => onSubmit(selected)}
        disabled={!selected || busy}
        className="btn-primary w-full"
      >
        Devam Et
      </button>
    </div>
  );
};

export default OcpClusterPickStep;
