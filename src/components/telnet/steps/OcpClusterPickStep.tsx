// src/components/telnet/steps/OcpClusterPickStep.tsx — OpsX'in OcpClusterPickStep.tsx'iyle
// AYNI UX (bkz. src/components/opsx/steps/OcpClusterPickStep.tsx): tenant/env grubundaki
// GERÇEK cluster'lardan (ör. ark_prod → gbocpprod1, gbocpprod2, gbocpprod4) hedeflenecek
// TEK birinin YA DA grubun TAMAMININ seçimi.
//
// OpsX'TEN FARKI: Telnet OCP'nin playbook'u (ocp_telnet_control.yml) AWX `limit`e HİÇ
// ihtiyaç duymaz — bastion fan-out modelinde (terminal_hosts[]/ocp_clusters[]) çalışır, bu
// yüzden burada "belirli bir cluster" seçimi sadece backend'in `ocp_clusters[]` VERİSİNİ
// daraltması demektir (bkz. server/telnet/index.cjs). Yine de kullanıcı deneyimi OpsX
// Openshift Rollout'la BİREBİR aynı olsun diye aynı bileşen deseni kullanılır.
import React, { useEffect, useState } from "react";
import { ServerStackIcon, Squares2X2Icon } from "@heroicons/react/24/outline";
import { telnetApi } from "@/api/telnetApi";

const ALL = "__all__";

const OcpClusterPickStep: React.FC<{
  env: string;
  tenant: string;
  busy?: boolean;
  // Belirli bir cluster adı YA DA "" (tüm grup).
  onSubmit: (cluster: string) => void;
}> = ({ env, tenant, busy, onSubmit }) => {
  const [clusters, setClusters] = useState<string[]>([]);
  // null = henüz seçim yok (buton kapalı); ALL = "tüm cluster'lar"; aksi halde gerçek cluster adı.
  const [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    telnetApi.getClusters()
      .then((r) => {
        const names = r.tree?.[env]?.[tenant] || [];
        setClusters(names);
        setSelected(names.length === 1 ? names[0] : null);
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

  function submit() {
    if (selected == null) return;
    onSubmit(selected === ALL ? "" : selected);
  }

  return (
    <div className="space-y-4">
      <div>
        <p className="text-sm text-[var(--text-secondary)]">Testin hedefleneceği cluster'ı seçin.</p>
        <p className="mt-1 text-xs text-[var(--text-muted)]">
          Cluster grubu: <span className="font-mono text-[var(--text-primary)]">{tenant} / {env}</span>
        </p>
      </div>

      <div className="border border-[var(--border)] rounded-xl divide-y divide-[var(--border)]">
        {clusters.length > 1 && (
          <label className="flex items-center gap-3 px-4 py-2.5 hover:bg-[var(--bg-elevated)] transition-colors cursor-pointer">
            <input
              type="radio"
              name="telnet-ocp-cluster"
              checked={selected === ALL}
              onChange={() => setSelected(ALL)}
              className="rounded-full"
            />
            <Squares2X2Icon aria-hidden="true" className="w-4 h-4 text-[var(--text-muted)] flex-shrink-0" />
            <span className="text-sm font-medium text-[var(--text-primary)] flex-1">
              Tüm cluster'lar <span className="text-[var(--text-muted)] font-normal">({clusters.length})</span>
            </span>
          </label>
        )}
        {clusters.map((name) => (
          <label
            key={name}
            className="flex items-center gap-3 px-4 py-2.5 hover:bg-[var(--bg-elevated)] transition-colors cursor-pointer"
          >
            <input
              type="radio"
              name="telnet-ocp-cluster"
              checked={selected === name}
              onChange={() => setSelected(name)}
              className="rounded-full"
            />
            <ServerStackIcon aria-hidden="true" className="w-4 h-4 text-[var(--text-muted)] flex-shrink-0" />
            <span className="text-sm font-mono text-[var(--text-primary)] flex-1 truncate">{name}</span>
          </label>
        ))}
      </div>

      {selected === ALL && (
        <p className="text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
          Test grubun TÜM cluster'larında ({clusters.join(", ")}) çalışacak.
        </p>
      )}

      <button
        onClick={submit}
        disabled={selected == null || busy}
        className="btn-primary w-full"
      >
        Devam Et
      </button>
    </div>
  );
};

export default OcpClusterPickStep;
