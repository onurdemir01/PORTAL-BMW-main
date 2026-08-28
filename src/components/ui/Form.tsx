// src/components/ui/Form.tsx — Portal-geneli TEK form dili (Faz 5 UI overhaul).
//
// Amaç: her ekranın aynı, Apple/GPT/AWX kalitesinde form bileşenlerini kullanması. Native
// `<select>` (OS-default, tutarsız) yerine stillendirilmiş kontrol; dağınık kırmızı yıldız yerine
// SESSİZ gerekli/opsiyonel işareti; her alanda **satır-içi hata** (aria-invalid). Tasarım
// tokenları (`var(--*)`) kullanır → light/dark tema-uyumlu, mevcut `.input-modern` diliyle hizalı.
import React, { forwardRef, useId } from "react";
import { ChevronUpDownIcon, ExclamationCircleIcon } from "@heroicons/react/24/outline";

export type ControlSize = "sm" | "md";

// Kontrol boyutu — `md` (varsayılan) standart form alanları; `sm` yoğun bağlamlar
// (tablo hücresi, araç çubuğu filtresi, kompakt admin formları) için. className ile
// override güvenilmez (aynı specificity) olduğundan boyut prop üzerinden verilir.
function baseControl(size: ControlSize = "md") {
  const sizing =
    size === "sm"
      ? "text-xs px-3 py-1.5 min-h-[2.1rem]"
      : "text-sm px-3.5 py-2.5 min-h-[2.6rem]";
  return (
    "w-full rounded-xl border transition-all outline-none " +
    sizing + " " +
    "text-[var(--text-primary)] placeholder:text-[var(--text-muted)] " +
    "focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent-glow)]"
  );
}

function controlTone(error?: boolean) {
  return error
    ? "border-red-400 bg-red-50/40 focus:border-red-400 focus:ring-red-100"
    : "border-[var(--border)] bg-[var(--bg-surface)] hover:border-[color:var(--accent)]/40";
}

// ── Field: label + gerekli/opsiyonel + hint + kontrol + satır-içi hata ────────
export const Field: React.FC<{
  label: string;
  htmlFor?: string;
  required?: boolean;
  hint?: string;
  error?: string | null;
  children: React.ReactNode;
  className?: string;
}> = ({ label, htmlFor, required, hint, error, children, className = "" }) => (
  <div className={`space-y-1.5 ${className}`}>
    <div className="flex items-baseline justify-between gap-2">
      <label htmlFor={htmlFor} className="text-[13px] font-semibold text-[var(--text-primary)]">
        {label}
        {required && <span className="ml-1 align-middle inline-block w-1.5 h-1.5 rounded-full bg-[var(--accent)]" title="zorunlu" />}
      </label>
      {!required && <span className="text-[11px] text-[var(--text-muted)]">opsiyonel</span>}
    </div>
    {/* whitespace-pre-line: Survey Tasarımcısı'nda açıklamaya alt alta örnek yazılabiliyor.
        HTML normalde satır sonlarını boşluğa çevirip hepsini tek satıra dizerdi. `pre-line`
        satır sonlarını KORUR ama girinti/arka arkaya boşlukları yine sadeleştirir — tek
        satırlık mevcut hint'lerin görünümü değişmez. */}
    {hint && <p className="text-[11px] leading-snug text-[var(--text-muted)] whitespace-pre-line">{hint}</p>}
    {children}
    {error && (
      <p className="flex items-center gap-1 text-[11px] text-red-600" role="alert">
        <ExclamationCircleIcon className="w-3.5 h-3.5 flex-shrink-0" />
        {error}
      </p>
    )}
  </div>
);

// ── TextInput ─────────────────────────────────────────────────────────────────
export const TextInput = forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement> & { error?: boolean; sizeVariant?: ControlSize }>(
  ({ error, sizeVariant, className = "", ...props }, ref) => (
    <input ref={ref} aria-invalid={!!error} className={`${baseControl(sizeVariant)} ${controlTone(error)} ${className}`} {...props} />
  )
);
TextInput.displayName = "TextInput";

// ── Textarea ──────────────────────────────────────────────────────────────────
export const Textarea = forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement> & { error?: boolean; sizeVariant?: ControlSize }>(
  ({ error, sizeVariant, className = "", ...props }, ref) => (
    <textarea ref={ref} aria-invalid={!!error} className={`${baseControl(sizeVariant)} resize-y ${controlTone(error)} ${className}`} {...props} />
  )
);
Textarea.displayName = "Textarea";

// ── Select: native <select> yerine STİLLENDİRİLMİŞ (appearance-none + chevron) ──
// Native'in tam klavye/erişilebilirliğini korur ama OS-default görünümü değil, tutarlı
// portal dilini gösterir. Chevron ikonu overlay; hata durumunda kırmızı ton.
export const Select = forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement> & { error?: boolean; sizeVariant?: ControlSize }>(
  ({ error, sizeVariant, className = "", children, ...props }, ref) => (
    <div className="relative">
      <select
        ref={ref}
        aria-invalid={!!error}
        className={`${baseControl(sizeVariant)} ${controlTone(error)} appearance-none pr-10 cursor-pointer ${className}`}
        {...props}
      >
        {children}
      </select>
      <ChevronUpDownIcon className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-muted)]" />
    </div>
  )
);
Select.displayName = "Select";

// ── useFieldId: label ↔ control bağlama için stabil id ────────────────────────
export function useFieldId(name?: string) {
  const auto = useId();
  return name ? `f-${name}` : auto;
}
