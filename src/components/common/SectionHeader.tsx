import React from "react";

interface SectionHeaderProps {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
}

// PatternFly PageSection basligi: 24px Red Hat Display baslik + gri aciklama satiri,
// sagda birincil aksiyonlar. PF'de baslik altinda ince ayirici yoktur — bosluk yeterlidir.
export default function SectionHeader({ title, subtitle, actions }: SectionHeaderProps) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 mb-1">
      <div>
        <h1 className="page-title">{title}</h1>
        {subtitle && (
          <p className="text-[0.875rem] mt-1" style={{ color: "var(--text-muted)" }}>{subtitle}</p>
        )}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}
