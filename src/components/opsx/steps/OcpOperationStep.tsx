// src/components/opsx/steps/OcpOperationStep.tsx — Openshift bacağında hangi işlem
// yapılacağı. Seçenekler sunucudan gelir (/api/opsx/ocp/operations) — şu an SADECE
// restart aktif, diğerleri (thread dump/heap dump/tcpdump) görünür ama tıklanamaz
// placeholder'lar; playbook desteği eklendiğinde sunucu tarafında enabled:true yapılır.
import React, { useEffect, useState } from "react";
import { ArrowPathIcon, DocumentMagnifyingGlassIcon, CircleStackIcon, SignalIcon, TrashIcon } from "@heroicons/react/24/outline";
import { opsxApi, type OpsxOcpOperation, type OpsxOcpOperationDef, type OpsxOcpPair } from "@/api/opsxApi";
import { LoadingLogo } from '@/components/common/LoadingLogo';

const ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  restart: ArrowPathIcon,
  threaddump: DocumentMagnifyingGlassIcon,
  heapdump: CircleStackIcon,
  tcpdump: SignalIcon,
  poddelete: TrashIcon,
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

  // env/tenant SORGUYA EKLENIR: sunucu boylece production islemlere `needsApproval`
  // dondurur (bkz. server/opsx/prod-approval.cjs). Kural BURADA TEKRARLANMAZ - ayni
  // desenin iki kopyasi olsa biri zamanla kayar. Bu ekran yalnizca sunucunun kararini
  // ONCEDEN gosterir ki kullanici "neden hemen baslamadi" diye sormasin; gercek kapi
  // POST uclarindadir (istemciye guvenilmez).
  useEffect(() => {
    opsxApi
      .getOcpOperations(env, tenant)
      .then((r) => setOps(r.operations))
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  }, [env, tenant]);

  if (loading) return <LoadingLogo compact />;
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

      {/* ONAY UYARISI ONCEDEN: is tiklamayla BASLAMAYACAK, talep acilacak. Bunu
          soylememek "tikladim hicbir sey olmadi" demek olurdu. Mesaj SUNUCUDAN gelir. */}
      {ops.some((o) => o.needsApproval) && (
        <div
          className="rounded-xl border px-3 py-2 text-xs"
          style={{
            borderColor: 'var(--status-warning)',
            background: 'var(--bg-surface)',
            color: 'var(--text-secondary)',
          }}
        >
          {ops.find((o) => o.needsApproval)?.approvalMessage}
        </div>
      )}

      <div className="space-y-2">
        {ops.map((op) => {
          const Icon = ICONS[op.key] || ArrowPathIcon;
          // "Kullanima acik degil" (enabled:false) islemi KAPATIR; "onay gerekli"
          // (needsApproval) KAPATMAZ - is baslar, sadece once onaydan geceer. Ikisini
          // ayni gostermek, kullaniciya yapamayacagini sanmasina yol acardi.
          const disabled = busy || !op.enabled;
          return (
            <button
              key={op.key}
              onClick={() => onSelect(op.key)}
              disabled={disabled}
              title={
                op.needsApproval
                  ? op.approvalMessage || 'Production işlemi: Smart onayından geçer.'
                  : !op.enabled
                    ? "Bu işlem henüz kullanıma açık değil."
                    : undefined
              }
              className="w-full flex items-center gap-3 px-4 py-3 border border-[var(--border)] rounded-xl text-left hover:border-[var(--accent)] hover:shadow-sm transition-all active:scale-[0.99] disabled:opacity-50 disabled:pointer-events-none disabled:hover:border-[var(--border)]"
            >
              <Icon className="w-5 h-5 text-[var(--text-primary)] flex-shrink-0" />
              <div className="flex-1">
                <span className="text-sm font-medium text-[var(--text-primary)]">{op.label}</span>
                {op.needsApproval ? (
                  <p className="text-xs text-[var(--status-warning)] mt-0.5">
                    Smart onayı gerekir
                    {op.approvalReason ? ` (${op.approvalReason})` : ''}
                  </p>
                ) : (
                  !op.enabled && (
                    <p className="text-xs text-[var(--text-muted)] mt-0.5">Yakında</p>
                  )
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
};

export default OcpOperationStep;
