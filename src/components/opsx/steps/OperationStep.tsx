// src/components/opsx/steps/OperationStep.tsx — hangi işlem yapılacak.
//
// Seçenekler SUNUCUDAN gelir (/api/opsx/operations) — ön yüz listeyi hardcode etmez,
// böylece izin verilen işlem kümesi tek yerde (server/opsx/index.cjs ALLOWED_OPERATIONS)
// tanımlı kalır. Sunucu her durumda gelen değeri o beyaz listeye karşı yeniden doğrular.
import React, { useEffect, useState } from "react";
import { ArrowPathIcon, StopCircleIcon, PlayCircleIcon } from "@heroicons/react/24/outline";
import { opsxApi, type OpsxOperation, type OpsxOperationDef } from "@/api/opsxApi";

const ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  restart: ArrowPathIcon,
  stop: StopCircleIcon,
  start: PlayCircleIcon,
};

const OperationStep: React.FC<{
  summary: React.ReactNode;
  busy?: boolean;
  onSelect: (op: OpsxOperation) => void;
}> = ({ summary, busy, onSelect }) => {
  const [ops, setOps] = useState<OpsxOperationDef[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    opsxApi.getOperations()
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
        <div className="mt-1 text-xs text-[var(--text-muted)]">{summary}</div>
      </div>

      <div className="space-y-2">
        {ops.map((op) => {
          const Icon = ICONS[op.key] || ArrowPathIcon;
          return (
            <button
              key={op.key}
              onClick={() => onSelect(op.key)}
              disabled={busy}
              className="w-full flex items-center gap-3 px-4 py-3 border border-[var(--border)] rounded-xl text-left hover:border-[var(--accent)] hover:shadow-sm transition-all active:scale-[0.99] disabled:opacity-50 disabled:pointer-events-none"
            >
              <Icon className="w-5 h-5 text-[var(--text-primary)] flex-shrink-0" />
              <span className="text-sm font-medium text-[var(--text-primary)]">{op.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
};

export default OperationStep;
