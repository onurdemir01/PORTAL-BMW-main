// src/components/scalex/steps/PreviewStep.tsx — "ne olacak" tek bakışta.
//
// `/preview` HİÇBİR ŞEY TETİKLEMEZ ve HİÇBİR ŞEY KAYDETMEZ; yalnızca hesaplar. Asıl
// karar `/run`da YENİDEN verilir (Self Service'in `ss/oco/validate` deseni) — bu ekran
// bir söz değil, bir tahmindir ve öyle davranılır.
import React, { useEffect, useState } from "react";
import {
  ExclamationTriangleIcon, CheckCircleIcon, ClockIcon, ShieldCheckIcon, ArrowUturnLeftIcon,
} from "@heroicons/react/24/outline";
import {
  scalexApi, type ScaleXAction, type ScaleXMode, type ScaleXPreview, type ScaleXScope, type ScaleXWorkload,
} from "@/api/scalexApi";

interface Props {
  scope: ScaleXScope;
  action: ScaleXAction;
  executionMode: ScaleXMode;
  targetReplicas?: string;
  verificationTimeout: string;
  workloads: ScaleXWorkload[];
  hpaPin: boolean;
  busy: boolean;
  onConfirm: (v: { writtenConfirm?: string; reason?: string; ocoNumber?: string }) => void;
}

const ACTION_LABEL: Record<ScaleXAction, string> = { stop: "DURDUR", restore: "GERİ AL", scale: "ÖLÇEKLE" };

const PreviewStep: React.FC<Props> = ({
  scope, action, executionMode, targetReplicas, verificationTimeout, workloads, hpaPin, busy, onConfirm,
}) => {
  const [preview, setPreview] = useState<ScaleXPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [written, setWritten] = useState("");
  const [reason, setReason] = useState("");
  const [ocoNumber, setOcoNumber] = useState("");

  useEffect(() => {
    let alive = true;
    scalexApi.preview({ ...scope, action, executionMode, targetReplicas, verificationTimeout })
      .then((r) => { if (!alive) return; if (r.ok) setPreview(r); else setError(r.message || "Önizleme alınamadı."); })
      .catch((e) => alive && setError((e as Error).message));
    return () => { alive = false; };
  }, [scope.clusters.join(","), scope.apps?.join(","), action, executionMode, targetReplicas]);

  if (error) {
    return (
      <div className="flex items-start gap-2 bg-red-50 border border-red-100 rounded-xl p-3 text-sm text-red-700">
        <ExclamationTriangleIcon aria-hidden="true" className="w-4 h-4 flex-shrink-0 mt-0.5" /><span>{error}</span>
      </div>
    );
  }
  if (!preview) return <div className="py-8 text-center text-sm text-[var(--text-muted)]">Önizleme hesaplanıyor…</div>;

  const r = preview.blastRadius;
  const g = preview.gatePolicy;
  const picked = workloads.filter((w) => (scope.apps || []).includes(w.name));
  // Prod'da eşik aşıldığında patlama yarıçapı görsel olarak da ağırlaşır — sayı tek
  // başına küçük görünebilir, etkilenen cluster'ları TEK TEK göstermek gerçeği taşır.
  const heavy = r.requiresWrittenConfirm;

  const writtenOk = !r.requiresWrittenConfirm || written.trim() === scope.namespace;
  const reasonOk = g.oco !== "warn" || reason.trim().length > 0;

  return (
    <div className="space-y-4">
      <div className={`rounded-xl border p-4 ${heavy ? "border-red-200 bg-red-50" : "border-[var(--border)] bg-[var(--bg-inset)]"}`}>
        <div className="flex items-baseline justify-between gap-3 flex-wrap">
          <p className="text-sm font-semibold text-[var(--text-primary)]">
            {ACTION_LABEL[action]}
            {action === "scale" && targetReplicas != null ? ` → ${targetReplicas} replica` : ""}
            {" · "}
            <span className="tabular-nums">
              {r.clusterCount} cluster × {r.appCount} uygulama = {r.targets} hedef
            </span>
          </p>
          {r.isProd && <span className="pf-label pf-label--red">PROD ortamı</span>}
          {executionMode === "dry_run" && <span className="pf-label pf-label--blue">Sadece kontrol — değişiklik yok</span>}
        </div>
        {heavy && (
          <p className="mt-2 text-xs text-red-800">
            Etkilenecek cluster'lar: <span className="font-mono">{scope.clusters.join(", ")}</span>
          </p>
        )}
      </div>

      <div className="rounded-xl border border-[var(--border)] divide-y divide-[var(--border-subtle)]">
        {picked.map((w) => {
          const to = action === "stop" ? 0 : action === "restore" ? w.previousReplicas : Number(targetReplicas);
          return (
            <div key={w.name} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
              <span className="font-mono truncate text-[var(--text-primary)]" title={w.name}>{w.name}</span>
              <span className="flex items-center gap-2 whitespace-nowrap text-[var(--text-muted)] tabular-nums">
                <span>{w.specReplicas} → {to ?? "?"}</span>
                {w.hasHpa && (
                  <span className="pf-label pf-label--gold">
                    {hpaPin ? "HPA sabitlenecek" : action === "stop" ? "HPA devre dışı kalacak" : "HPA devralabilir"}
                  </span>
                )}
                {w.gitops && <span className="pf-label pf-label--orange">GitOps</span>}
              </span>
            </div>
          );
        })}
      </div>

      {/* KAPI DURUMU. Kullanıcı ne isteneceğini ÖNCEDEN bilsin — ortada sürpriz olmasın. */}
      <div className="rounded-xl border border-[var(--border)] p-3 space-y-1.5 text-xs">
        <p className="flex items-center gap-1.5 text-[var(--text-secondary)]">
          <ShieldCheckIcon aria-hidden="true" className="w-4 h-4 flex-shrink-0" />
          {g.oco === "require" && "OCO penceresi kontrol edilecek — numara istenecek."}
          {g.oco === "warn" && "Geri alma bir onarım işlemidir: OCO penceresi dışında da çalışır, ama gerekçe zorunlu."}
          {g.oco === "skip" && "OCO kontrolü yok — bu çalıştırma hiçbir şeyi değiştirmiyor."}
        </p>
        <p className="flex items-center gap-1.5 text-[var(--text-secondary)]">
          <CheckCircleIcon aria-hidden="true" className="w-4 h-4 flex-shrink-0" />
          {g.smart === "require" ? "SMART kaydı açılacak ve onay beklenecek." : "SMART kaydı açılmayacak."}
        </p>
        {r.requiresSecondPerson && (
          <p className="flex items-center gap-1.5 text-[var(--text-secondary)]">
            <ClockIcon aria-hidden="true" className="w-4 h-4 flex-shrink-0" />
            Prod + birden fazla cluster: ikinci kişi onayı gerekiyor.
          </p>
        )}
        {picked.some((w) => w.gitops) && (
          <p className="flex items-start gap-1.5 text-amber-800">
            <ExclamationTriangleIcon aria-hidden="true" className="w-4 h-4 flex-shrink-0 mt-0.5" />
            Seçilenlerden bazıları GitOps ile yönetiliyor — değişiklik birkaç dakika içinde
            otomatik senkronla geri alınabilir.
          </p>
        )}
        {hpaPin && (
          <p className="flex items-start gap-1.5 text-amber-800">
            <ExclamationTriangleIcon aria-hidden="true" className="w-4 h-4 flex-shrink-0 mt-0.5" />
            HPA geçici olarak sabitlenecek; mevcut min/max saklanıp işlem bitince iade edilecek.
          </p>
        )}
        <p className="flex items-center gap-1.5 text-[var(--text-secondary)]">
          <ArrowUturnLeftIcon aria-hidden="true" className="w-4 h-4 flex-shrink-0" />
          {action === "stop"
            ? "Geri alınabilir: EVET — her uygulamanın önceki replica sayısı cluster'da saklanacak."
            : action === "restore"
              ? "Bu zaten bir geri alma işlemi."
              : "Ölçekleme sonrası önceki değer sonuç raporunda görünür."}
        </p>
      </div>

      {g.oco === "require" && executionMode === "apply" && (
        <div>
          <label htmlFor="scalex-oco" className="block text-xs font-medium text-[var(--text-muted)] mb-1.5">OCO numarası</label>
          <input id="scalex-oco" type="text" value={ocoNumber} disabled={busy} inputMode="numeric"
            onChange={(e) => setOcoNumber(e.target.value)} placeholder="1234567"
            className="w-56 px-3 py-2 text-sm rounded-lg border border-[var(--border)] bg-[var(--bg-surface)]
                       text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]" />
        </div>
      )}

      {g.oco === "warn" && (
        <div>
          <label htmlFor="scalex-reason" className="block text-xs font-medium text-[var(--text-muted)] mb-1.5">
            Gerekçe (zorunlu)
          </label>
          <input id="scalex-reason" type="text" value={reason} disabled={busy}
            onChange={(e) => setReason(e.target.value)} placeholder="INC0042311 — ödeme servisi kesintisi"
            className="w-full px-3 py-2 text-sm rounded-lg border border-[var(--border)] bg-[var(--bg-surface)]
                       text-[var(--text-primary)] placeholder-[var(--text-muted)]
                       focus:outline-none focus:ring-2 focus:ring-[var(--accent)]" />
          <p className="mt-1 text-xs text-[var(--text-muted)]">Gerekçe hem portal kaydına hem SMART talebine yazılır.</p>
        </div>
      )}

      {r.requiresWrittenConfirm && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-3">
          <label htmlFor="scalex-written" className="block text-xs font-medium text-red-900 mb-1.5">
            Bu işlem {r.targets} hedefi etkiliyor ve ortam prod. Onaylamak için namespace adını yaz:
            {" "}<span className="font-mono">{scope.namespace}</span>
          </label>
          <input id="scalex-written" type="text" value={written} disabled={busy} autoComplete="off"
            onChange={(e) => setWritten(e.target.value)}
            /* `bg-white` DEGIL: uyum katmani onu bilerek eslemiyor (renkli zemin ustunde
               kullanilsin diye) ve koyu temada beyaz bir girdi kutusu okunamaz olurdu. */
            className="w-full px-3 py-2 text-sm font-mono rounded-lg border border-red-300
                       bg-[var(--bg-surface)] text-[var(--text-primary)]
                       focus:outline-none focus:ring-2 focus:ring-red-400" />
        </div>
      )}

      <div className="flex justify-end border-t border-[var(--border)] pt-4">
        <button type="button" className="btn-primary" disabled={busy || !writtenOk || !reasonOk}
          onClick={() => onConfirm({
            ...(r.requiresWrittenConfirm ? { writtenConfirm: written.trim() } : {}),
            ...(reason.trim() ? { reason: reason.trim() } : {}),
            ...(ocoNumber.trim() ? { ocoNumber: ocoNumber.trim() } : {}),
          })}>
          {executionMode === "dry_run" ? "Kontrolü başlat" : "Çalıştır"}
        </button>
      </div>
    </div>
  );
};

export default PreviewStep;
