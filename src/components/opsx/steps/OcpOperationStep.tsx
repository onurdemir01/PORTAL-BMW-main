// src/components/opsx/steps/OcpOperationStep.tsx — Openshift bacağında hangi işlem
// yapılacağı. Seçenekler sunucudan gelir (/api/opsx/ocp/operations) — şu an SADECE
// restart aktif, diğerleri (thread dump/heap dump/tcpdump) görünür ama tıklanamaz
// placeholder'lar; playbook desteği eklendiğinde sunucu tarafında enabled:true yapılır.
import React, { useEffect, useState } from "react";
import { ArrowPathIcon, DocumentMagnifyingGlassIcon, CircleStackIcon, SignalIcon } from "@heroicons/react/24/outline";
import { opsxApi, type OpsxOcpOperation, type OpsxOcpOperationDef, type OpsxOcpPair } from "@/api/opsxApi";

const ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  restart: ArrowPathIcon,
  threaddump: DocumentMagnifyingGlassIcon,
  heapdump: CircleStackIcon,
  tcpdump: SignalIcon,
};

const OcpOperationStep: React.FC<{
  env: string;
  tenant: string;
  pairs: OpsxOcpPair[];
  busy?: boolean;
  onSelect: (op: OpsxOcpOperation) => void;
}> = ({ env, tenant, pairs, busy, onSelect }) => {
  const [ops, setOps] = useState<OpsxOcpOperationDef[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    opsxApi.getOcpOperations()
      .then((r) => setOps(r.operations))
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="py-8 text-center text-sm text-[var(--text-muted)]">Yükleniyor...</div>;
  if (error) return <div className="bg-red-50 border border-red-100 rounded-xl p-4 text-sm text-red-700">{error}</div>;

  return (
    <div className="space-y-4">
      <div>
        <p className="text-sm text-[var(--text-secondary)]">Hangi işlemi yapmak istiyorsunuz?</p>
        <div className="mt-1 text-xs text-[var(--text-muted)]">
          Cluster: <span className="font-mono text-[var(--text-primary)]">{tenant} / {env}</span>
          {" · "}
          {pairs.length} işlem: <span className="font-mono">{pairs.map((p) => `${p.namespace}/${p.application}`).join(", ")}</span>
        </div>
      </div>

      <div className="space-y-2">
        {ops.map((op) => {
          const Icon = ICONS[op.key] || ArrowPathIcon;
          const disabled = busy || !op.enabled;
          return (
            <button
              key={op.key}
              onClick={() => onSelect(op.key)}
              disabled={disabled}
              title={!op.enabled ? "Bu işlem henüz kullanıma açık değil." : undefined}
              className="w-full flex items-center gap-3 px-4 py-3 border border-[var(--border)] rounded-xl text-left hover:border-[var(--accent)] hover:shadow-sm transition-all active:scale-[0.99] disabled:opacity-50 disabled:pointer-events-none disabled:hover:border-[var(--border)]"
            >
              <Icon className="w-5 h-5 text-[var(--text-primary)] flex-shrink-0" />
              <div className="flex-1">
                <span className="text-sm font-medium text-[var(--text-primary)]">{op.label}</span>
                {!op.enabled && <p className="text-xs text-[var(--text-muted)] mt-0.5">Yakında</p>}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
};

export default OcpOperationStep;
