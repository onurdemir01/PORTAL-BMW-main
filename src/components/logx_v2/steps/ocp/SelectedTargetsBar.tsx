// src/components/logx_v2/steps/ocp/SelectedTargetsBar.tsx — biriken (namespace, uygulama)
// hedeflerinin "sepeti".
//
// NEDEN ADIM DEĞİL ŞERİT (2026-08-10, kullanıcı kararı): önceki sürümde "Listeye Ekle"
// sonrası AYRI bir "Toplanacak Uygulamalar" ekranına düşülüyordu; yeni bir namespace
// eklemek için oradan geri gelmek gerekiyordu. Şimdi sepet hem namespace hem uygulama
// ekranının ÜSTÜNDE duruyor: kullanıcı ekle → namespace seç → ekle... döngüsünü ekran
// değiştirmeden sürdürüyor ve ne topladığını her an görüyor.
//
// Her hedef AYRI bir arşiv üretir: `<cluster>__<namespace>__<uygulama>__<id>.zip`.
import React from "react";
import { XMarkIcon, ArrowDownTrayIcon } from "@heroicons/react/24/outline";
import type { OcpFetchTarget } from "@/api/logxV2Api";

interface Props {
  targets: OcpFetchTarget[];
  /** Tek çalıştırmada izin verilen azami çift — sunucu da aynı sınırı uygular. */
  max: number;
  busy?: boolean;
  onRemove: (index: number) => void;
  onClear: () => void;
  onSubmit: () => void;
}

const SelectedTargetsBar: React.FC<Props> = ({ targets, max, busy, onRemove, onClear, onSubmit }) => {
  // Sepet boşken hiç yer kaplamaz — kullanıcı henüz bir şey toplamadıysa gösterecek bir şey yok.
  if (targets.length === 0) return null;

  // Namespace'e göre grupla: aynı namespace'ten beş uygulama seçildiğinde ad beş kez
  // tekrarlanmasın, tek başlık altında toplansın.
  const byNamespace = new Map<string, { target: OcpFetchTarget; index: number }[]>();
  targets.forEach((target, index) => {
    if (!byNamespace.has(target.namespace)) byNamespace.set(target.namespace, []);
    byNamespace.get(target.namespace)!.push({ target, index });
  });

  return (
    <div className="rounded-xl border border-[var(--accent)]/30 bg-[var(--bg-elevated)] p-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold text-[var(--text-primary)]">
          Toplanacak {targets.length} hedef
          <span className="ml-1 font-normal text-[var(--text-muted)]">/ {max}</span>
        </span>
        <button
          onClick={onClear}
          disabled={busy}
          className="text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] underline underline-offset-2 disabled:opacity-50"
        >
          Tümünü temizle
        </button>
      </div>

      <div className="max-h-40 overflow-y-auto space-y-1.5">
        {[...byNamespace.entries()].map(([namespace, entries]) => (
          <div key={namespace}>
            <p className="text-[11px] font-mono text-[var(--text-muted)] truncate" title={namespace}>{namespace}</p>
            <div className="flex flex-wrap gap-1.5 mt-0.5">
              {entries.map(({ target, index }) => (
                <span
                  key={`${target.namespace}/${target.appName}`}
                  /* `min-w-0` + `max-w` + `truncate`: uygulama adlari uzun olabiliyor
                     ve rozet seridi yatayda tasiyordu. Tam ad `title`da. */
                  className="inline-flex items-center gap-1 min-w-0 max-w-[16rem] pl-2 pr-1 py-0.5 rounded-full border border-[var(--border)] bg-[var(--bg)] text-[11px] font-mono text-[var(--text-primary)]"
                >
                  {/* `title` KIRPILAN ogenin kendisinde olmali — ebeveyne koymak
                     dogru gorunuyordu ama ipucu, metnin uzerinde degil rozetin
                     bosluklarinda da cikardi. (D7 test bekcisi bunu yakaladi.) */}
                  <span className="min-w-0 truncate" title={`${target.namespace}/${target.appName}`}>{target.appName}</span>
                  <button
                    onClick={() => onRemove(index)}
                    disabled={busy}
                    aria-label={`${target.namespace}/${target.appName} hedefini çıkar`}
                    title="Listeden çıkar"
                    className="p-0.5 rounded-full text-[var(--text-muted)] hover:text-red-600 hover:bg-red-50 transition disabled:opacity-50 disabled:pointer-events-none"
                  >
                    <XMarkIcon className="w-3 h-3" />
                  </button>
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>

      <button
        onClick={onSubmit}
        disabled={busy}
        className="btn-primary w-full inline-flex items-center justify-center gap-1.5"
      >
        <ArrowDownTrayIcon aria-hidden="true" className="w-4 h-4" />
        {busy ? "Başlatılıyor…" : `Logları Getir (${targets.length})`}
      </button>
    </div>
  );
};

export default SelectedTargetsBar;
