// src/components/denetim/ui.tsx — Denetim sayfasının ortak görsel dili (2026-09-08).
//
// NEDEN VAR: Denetim'in altı sekmesi ayrı ayrı yazıldığı için her biri kendi kartını,
// kendi tablo başlığını, kendi rozetini elle kuruyordu; sayfa hem kalabalık hem de
// portalın geri kalanından KOPUK duruyordu. Somut sebep: 288 yerde sabit Tailwind grisi
// (`bg-gray-100`, `text-gray-500`, `border-gray-200`) kullanılmış, portalın PF6 token'ları
// (`--bg-elevated`, `--text-muted`, `--border`) hiç kullanılmamıştı. Sabit griler tema
// değiştiğinde de yerinde kalır.
//
// Buradaki parçalar TASARIM kararıdır, davranış taşımaz — mevcut mantığa dokunmadan
// sekmelerin aynı ritmi paylaşmasını sağlar.
import React from "react";

/** Bölüm kartı: başlık + (isteğe bağlı) açıklama + sağ üstte aksiyon alanı. */
export function Panel({
  title, description, actions, children, className = "", dense = false,
}: {
  title?: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  dense?: boolean;
}) {
  return (
    <section
      className={`rounded-xl border overflow-hidden ${className}`}
      style={{ borderColor: "var(--border-subtle)", background: "var(--bg-surface)" }}
    >
      {(title || actions) && (
        <header
          className="flex items-start gap-3 px-4 py-3 border-b"
          style={{ borderColor: "var(--border-subtle)" }}
        >
          <div className="min-w-0 flex-1">
            {title && (
              <h3 className="text-sm font-semibold leading-tight" style={{ color: "var(--text-primary)" }}>
                {title}
              </h3>
            )}
            {description && (
              <p className="mt-0.5 text-[11px] leading-snug" style={{ color: "var(--text-muted)" }}>
                {description}
              </p>
            )}
          </div>
          {actions && <div className="flex items-center gap-2 flex-shrink-0">{actions}</div>}
        </header>
      )}
      <div className={dense ? "" : "p-4"}>{children}</div>
    </section>
  );
}

/** Büyük sayı + etiket. Sayılar tabular — sütun hâlinde dizildiğinde kaymasın. */
export function StatTile({
  icon: Icon, label, value, tone = "neutral", hint,
}: {
  icon?: React.ComponentType<{ className?: string }>;
  label: string;
  value: React.ReactNode;
  tone?: Tone;
  hint?: string;
}) {
  const t = TONES[tone];
  return (
    <div
      className="rounded-xl border px-4 py-3"
      style={{ borderColor: t.border, background: t.bg }}
      title={hint}
    >
      <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide" style={{ color: t.fg }}>
        {Icon && <Icon className="w-3.5 h-3.5 flex-shrink-0" />}
        {/* title SART: etiket kesildiginde uzerine gelmeden okunamaz/kopyalanamazdi
            (bkz. src/__tests__/accessibility.test.cjs — D7). */}
        <span className="truncate" title={label}>{label}</span>
      </div>
      <p className="mt-1 text-2xl font-bold leading-none tabular-nums" style={{ color: t.fg }}>
        {value}
      </p>
    </div>
  );
}

export type Tone = "neutral" | "success" | "danger" | "warning" | "info" | "accent";

// Tonlar PF6 durum token'larindan gelir — sekmeler arasi ayni anlam ayni renkle anlatilsin.
const TONES: Record<Tone, { fg: string; bg: string; border: string }> = {
  neutral: { fg: "var(--text-primary)", bg: "var(--bg-surface)", border: "var(--border-subtle)" },
  success: { fg: "var(--status-success)", bg: "var(--status-success-bg)", border: "var(--status-success)" },
  danger:  { fg: "var(--status-danger)",  bg: "var(--status-danger-bg)",  border: "var(--status-danger)" },
  warning: { fg: "var(--status-warning)", bg: "var(--status-warning-bg)", border: "var(--status-warning)" },
  info:    { fg: "var(--status-info)",    bg: "var(--bg-elevated)",       border: "var(--border-subtle)" },
  accent:  { fg: "var(--accent)",         bg: "var(--accent-bg)",         border: "var(--accent-light)" },
};

/** Küçük durum rozeti. */
export function Pill({
  tone = "neutral", icon: Icon, children, title,
}: {
  tone?: Tone;
  icon?: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
  title?: string;
}) {
  const t = TONES[tone];
  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold border whitespace-nowrap"
      style={{ color: t.fg, background: t.bg, borderColor: t.border }}
      title={title}
    >
      {Icon && <Icon className="w-3 h-3 flex-shrink-0" />}
      {children}
    </span>
  );
}

/**
 * Tablo kabuğu: yatay kaydırma KENDİ içinde olur — sayfa gövdesi asla yana kaymasın.
 * Başlık satırı yapışkan, böylece uzun listelerde sütun adı kaybolmaz.
 */
export function TableShell({
  children, maxHeight = "28rem",
}: {
  children: React.ReactNode;
  maxHeight?: string;
}) {
  return (
    <div
      className="overflow-auto rounded-lg border"
      style={{ borderColor: "var(--border-subtle)", maxHeight }}
    >
      <table className="w-full text-xs border-collapse">{children}</table>
    </div>
  );
}

// DIKKAT: Tailwind sinif adlarini KAYNAKTA metin olarak tarar; `text-${align}` gibi
// calisma aninda kurulan bir ad uretim derlemesinde HIC olusmaz. Bu yuzden hizalama
// siniflari tam adlariyla bir eslemede tutulur.
const ALIGN = { left: "text-left", right: "text-right", center: "text-center" } as const;

export function Th({ children, align = "left", className = "" }: {
  children?: React.ReactNode; align?: "left" | "right" | "center"; className?: string;
}) {
  return (
    <th
      className={`sticky top-0 z-10 px-3 py-2 font-semibold ${ALIGN[align]} whitespace-nowrap ${className}`}
      style={{ background: "var(--bg-elevated)", color: "var(--text-secondary)" }}
    >
      {children}
    </th>
  );
}

export function Td({ children, align = "left", className = "", title }: {
  children?: React.ReactNode; align?: "left" | "right" | "center"; className?: string; title?: string;
}) {
  return (
    <td
      className={`px-3 py-1.5 ${ALIGN[align]} ${className}`}
      style={{ color: "var(--text-primary)", borderTop: "1px solid var(--border-subtle)" }}
      title={title}
    >
      {children}
    </td>
  );
}

/** Satır içi kod parçası — sayfada onlarca yerde elle kuruluyordu. */
export function Code({ children }: { children: React.ReactNode }) {
  return (
    <code
      className="px-1 py-0.5 rounded text-[0.9em] font-mono"
      style={{ background: "var(--bg-elevated)", color: "var(--text-secondary)" }}
    >
      {children}
    </code>
  );
}

/** Açıklama/uyarı şeridi — sekmelerdeki uzun "nasıl okunur" metinleri için. */
export function Note({
  tone = "info", title, children,
}: {
  tone?: Tone;
  title?: React.ReactNode;
  children: React.ReactNode;
}) {
  const t = TONES[tone];
  return (
    <div
      className="rounded-xl border px-4 py-3 text-[12px] leading-relaxed"
      style={{ borderColor: t.border, background: t.bg, color: "var(--text-secondary)" }}
    >
      {title && <p className="font-semibold mb-1" style={{ color: t.fg }}>{title}</p>}
      {children}
    </div>
  );
}
