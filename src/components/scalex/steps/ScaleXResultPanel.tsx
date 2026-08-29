// src/components/scalex/steps/ScaleXResultPanel.tsx — yapılandırılmış sonuç.
//
// TelnetResultPanel deseni. Üç şey bilinçli:
//   1. KISMİ BAŞARI GÖRÜNÜR — "6 hedeften 5'i tamam" bilgisi tek bir yeşil/kırmızı
//      rozetin arkasında kaybolmaz.
//   2. `strictBlocked` FAIL'DEN AYRI gösterilir: hiçbir şey uygulanmadı çünkü ön kontrol
//      düştü ve kısmi çalıştırma kapalıydı — cluster'da HİÇBİR değişiklik yok. Bu,
//      kullanıcı için kötü değil İYİ haber ve öyle sunulur.
//   3. `stage: validation` ayrı bir ekran: iş cluster'a hiç dokunmadı, sebebi de belli.
import React from "react";
import {
  CheckCircleIcon, ExclamationTriangleIcon, XCircleIcon, ShieldExclamationIcon, InformationCircleIcon,
} from "@heroicons/react/24/outline";
import type { ScaleXRunResult } from "@/api/scalexApi";

const OVERALL: Record<string, { title: string; cls: string; Icon: typeof CheckCircleIcon }> = {
  OK:   { title: "Başarılı",  cls: "pf-label pf-label--green",  Icon: CheckCircleIcon },
  WARN: { title: "Uyarı",     cls: "pf-label pf-label--gold",   Icon: ExclamationTriangleIcon },
  FAIL: { title: "Başarısız", cls: "pf-label pf-label--red",    Icon: XCircleIcon },
};
const ROW: Record<string, string> = {
  OK: "pf-label pf-label--green", WARN: "pf-label pf-label--gold", FAIL: "pf-label pf-label--red",
};

const ScaleXResultPanel: React.FC<{ result: ScaleXRunResult; catalogWarning?: string | null }> = ({ result, catalogWarning }) => {
  const meta = OVERALL[result.overallStatus] || { title: result.overallStatus || "Bilinmiyor", cls: "pf-label pf-label--grey", Icon: InformationCircleIcon };
  const { Icon } = meta;

  if (result.stage === "validation") {
    return (
      <div className="w-full space-y-3">
        <div className="flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50 p-3">
          <ShieldExclamationIcon aria-hidden="true" className="w-5 h-5 flex-shrink-0 text-amber-700 mt-0.5" />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-amber-900">Girdi doğrulaması başarısız — cluster'a hiç dokunulmadı.</p>
            {/* `validationError` null OLABILIR (tip: string | null) ve o durumda ekranda
                BOS BIR PARAGRAF kaliyordu — kullanici sebebi hic ogrenemiyordu. */}
            <p className="mt-1 text-xs text-amber-900 break-words">
              {result.validationError || "Playbook bir sebep bildirmedi — ayrıntı için aşağıdaki AWX çıktısına bakın."}
            </p>
            {result.failedTask && (
              <p className="mt-1 text-xs text-amber-800">Düşen adım: <span className="font-mono">{result.failedTask}</span></p>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full space-y-3">
      <div className="flex items-start gap-2.5">
        <Icon aria-hidden="true" className="w-5 h-5 flex-shrink-0 mt-0.5 text-[var(--text-secondary)]" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-[var(--text-primary)]">
            {meta.title}
            <span className="ml-2 text-xs font-normal text-[var(--text-muted)] tabular-nums">
              {result.counts.ok} başarılı · {result.counts.warn} uyarı · {result.counts.fail} başarısız
              {result.counts.planned ? ` (${result.counts.planned} hedef)` : ""}
            </span>
          </p>
          {result.mode === "dry_run" && (
            <p className="mt-0.5 text-xs text-[var(--text-muted)]">Ön kontrol çalıştırıldı — hiçbir şey değiştirilmedi.</p>
          )}
          {result.counts.hpaSeen > 0 && (
            <p className="mt-0.5 text-xs text-[var(--text-muted)]">
              {result.counts.hpaSeen} hedefte HPA görüldü; HPA üzerinde değişiklik yapılmadı.
            </p>
          )}
        </div>
      </div>

      {result.strictBlocked && (
        <div className="flex items-start gap-2 rounded-xl border border-blue-200 bg-blue-50 p-3 text-xs text-blue-900">
          <InformationCircleIcon aria-hidden="true" className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <span>
            <strong>Hiçbir değişiklik uygulanmadı.</strong> Ön kontrol hata verdi ve “hepsi ya da hiçbiri”
            seçili olduğu için işlem tamamen durduruldu — cluster'ların hiçbirine dokunulmadı.
          </span>
        </div>
      )}

      {catalogWarning && (
        <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
          <ExclamationTriangleIcon aria-hidden="true" className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <span>{catalogWarning}</span>
        </div>
      )}

      <div className="rounded-xl border border-[var(--border)] divide-y divide-[var(--border-subtle)] overflow-hidden">
        {result.targets.map((t, i) => (
          <div key={`${t.cluster}/${t.app}/${i}`} className="px-3 py-2 text-sm">
            <div className="flex items-center justify-between gap-3">
              <span className="min-w-0 flex items-center gap-2">
                <span className="font-mono truncate text-[var(--text-primary)]" title={`${t.cluster} / ${t.app}`}>
                  {t.app}
                </span>
                {/* `title` KESILEN OGENIN KENDISINDE olmali — ustteki kapsayiciya
                    koymak kesilen degeri okunamaz birakir (bkz. D7 bekcisi). */}
                <span className="text-xs text-[var(--text-muted)] truncate" title={t.cluster}>{t.cluster}</span>
                {t.kind !== "-" && <span className="pf-label pf-label--grey">{t.kind}</span>}
              </span>
              <span className={ROW[t.status] || "pf-label pf-label--grey"}>{t.status}</span>
            </div>
            {/* Ayrıntı YALNIZCA sorunlu satırlarda — başarılı satırlarda gürültü olurdu. */}
            {t.status !== "OK" && t.detail && (
              <p className="mt-1 text-xs text-[var(--text-muted)] break-words">{t.detail}</p>
            )}
          </div>
        ))}
        {result.targets.length === 0 && (
          <p className="px-3 py-6 text-center text-sm text-[var(--text-muted)]">
            Hiçbir hedef sonucu üretilmedi.
          </p>
        )}
      </div>

      {result.targetsTruncated && (
        <p className="text-xs text-[var(--text-muted)]">
          Liste kırpıldı: {result.targets.length}/{result.targetsTotal} hedef gösteriliyor. Tamamı AWX job log'unda.
        </p>
      )}
    </div>
  );
};

export default ScaleXResultPanel;
