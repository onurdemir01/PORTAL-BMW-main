import React from "react";
import { statusColor, statusClasses, type StatusLevel } from "@/utils/statusColor";

interface BadgeProps {
  /** Ham durum metni (or. Dynatrace severityLevel, Instana status) — statusColor() ile eslenir. */
  level?: string | StatusLevel;
  variant?: "solid" | "soft";
  size?: "xs" | "sm";
  weight?: "normal" | "semibold";
  className?: string;
  children: React.ReactNode;
}

// PatternFly Label: hap seklinde, 1px renkli cerceve + acik renkli zemin.
// "solid" varyanti PF'de yoktur; dolu zeminli vurgu gerektiginde ayni palet kullanilir.
const SIZE_CLASSES: Record<NonNullable<BadgeProps["size"]>, string> = {
  xs: "text-[0.75rem] px-2 py-0",
  sm: "text-[0.875rem] px-2 py-0.5",
};

const SOLID_CLASSES: Record<StatusLevel, string> = {
  critical: "bg-[#c9190b] text-white border-[#c9190b]",
  error:    "bg-[#c9190b] text-white border-[#c9190b]",
  warning:  "bg-[#f0ab00] text-[#151515] border-[#f0ab00]",
  info:     "bg-[#0066cc] text-white border-[#0066cc]",
  success:  "bg-[#3e8635] text-white border-[#3e8635]",
  neutral:  "bg-[#6a6e73] text-white border-[#6a6e73]",
};

const KNOWN_LEVELS = new Set(["critical", "error", "warning", "info", "success", "neutral"]);

export default function Badge({ level, variant = "soft", size = "xs", weight = "normal", className = "", children }: BadgeProps) {
  let colorClasses = "";
  if (level !== undefined) {
    const resolved: StatusLevel = KNOWN_LEVELS.has(level) ? (level as StatusLevel) : statusColor(level);
    colorClasses = variant === "solid" ? SOLID_CLASSES[resolved] : statusClasses(resolved);
  }
  const weightClass = weight === "semibold" ? "font-bold" : "font-normal";
  return (
    <span className={`inline-flex items-center gap-1 border rounded-full whitespace-nowrap ${weightClass} ${SIZE_CLASSES[size]} ${colorClasses} ${className}`}>
      {children}
    </span>
  );
}
