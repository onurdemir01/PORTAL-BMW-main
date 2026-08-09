// src/components/logx_v2/steps/ocp/TargetListStep.tsx — tek çalıştırmada toplanacak
// (namespace, uygulama) çiftlerinin listesi.
//
// NEDEN VAR: LogX bir çalıştırmada tek çift alıyordu; üç uygulamanın logunu isteyen
// kullanıcı sihirbazı üç kez baştan çalıştırmak zorundaydı. OpsX'te aynı ihtiyaç
// "Listeye Ekle" ile biriktirme deseniyle çözülmüş (src/components/opsx/steps/
// OcpTargetStep.tsx) — burada aynı desen LogX'e uyarlanır.
//
// Her çift AYRI bir arşiv üretir: `<cluster>__<namespace>__<uygulama>__<id>.zip`.
// Böylece indirilen zip'in neye ait olduğu adından bellidir.
import React from "react";
import { TrashIcon, PlusIcon, ArrowDownTrayIcon } from "@heroicons/react/24/outline";
import type { OcpFetchTarget } from "@/api/logxV2Api";

interface Props {
  targets: OcpFetchTarget[];
  /** Tek çalıştırmada izin verilen azami çift — sunucu da aynı sınırı uygular. */
  max: number;
  busy?: boolean;
  onRemove: (index: number) => void;
  /** Namespace adımına dönüp yeni bir çift eklemek için. */
  onAddMore: () => void;
  onSubmit: () => void;
}

const TargetListStep: React.FC<Props> = ({ targets, max, busy, onRemove, onAddMore, onSubmit }) => {
  const full = targets.length >= max;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-[var(--text-secondary)]">
          Toplanacak uygulamalar — her biri için <strong>ayrı arşiv</strong> oluşur
        </p>
        <span className="text-xs text-[var(--text-muted)]">
          {targets.length} / {max}
        </span>
      </div>

      <div className="border border-[var(--border)] rounded-xl divide-y divide-[var(--border)]">
        {targets.map((t, i) => (
          <div key={`${t.namespace}/${t.appName}`} className="flex items-center gap-3 px-4 py-2.5">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-mono text-[var(--text-primary)] truncate">{t.appName}</p>
              <p className="text-xs font-mono text-[var(--text-muted)] truncate">{t.namespace}</p>
            </div>
            <button
              onClick={() => onRemove(i)}
              disabled={busy}
              aria-label={`${t.namespace}/${t.appName} çiftini listeden çıkar`}
              title="Listeden çıkar"
              className="p-1.5 text-[var(--text-muted)] hover:text-red-600 hover:bg-red-50 rounded-lg transition disabled:opacity-50 disabled:pointer-events-none"
            >
              <TrashIcon className="w-4 h-4" />
            </button>
          </div>
        ))}
        {targets.length === 0 && (
          <p className="px-4 py-6 text-center text-sm text-[var(--text-muted)]">
            Henüz uygulama eklenmedi.
          </p>
        )}
      </div>

      <button
        onClick={onAddMore}
        disabled={busy || full}
        title={full ? `Tek çalıştırmada en fazla ${max} uygulama seçilebilir.` : undefined}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-[var(--border)] text-[var(--text-secondary)] hover:border-[var(--accent)] hover:text-[var(--text-primary)] transition-colors active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none"
      >
        <PlusIcon aria-hidden="true" className="w-4 h-4" />
        Başka uygulama ekle
      </button>
      {full && (
        <p className="text-xs text-[var(--text-muted)]">
          Sınıra ulaşıldı — her çift ayrı bir <span className="font-mono">oc login</span> + pod
          taraması demek, bu yüzden tek çalıştırma {max} çiftle sınırlı.
        </p>
      )}

      <button
        onClick={onSubmit}
        disabled={busy || targets.length === 0}
        className="btn-primary w-full inline-flex items-center justify-center gap-1.5"
      >
        <ArrowDownTrayIcon aria-hidden="true" className="w-4 h-4" />
        {busy ? "Başlatılıyor…" : `Logları Getir (${targets.length})`}
      </button>
    </div>
  );
};

export default TargetListStep;
