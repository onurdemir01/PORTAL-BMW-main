import React from "react";
import { ArrowUpIcon, ArrowDownIcon, MinusIcon } from "@heroicons/react/24/outline";

interface StatTileProps {
  label: string;
  value: string | number;
  unit?: string;
  trend?: { direction: "up" | "down" | "flat"; value: string; isGood?: boolean };
  icon?: React.ReactNode;
  loading?: boolean;
}

const TREND_ICON = { up: ArrowUpIcon, down: ArrowDownIcon, flat: MinusIcon };

// OpenShift Console "Status/Utilization" karti: ustte kucuk gri etiket,
// altinda 28px Red Hat Display sayi, en altta trend satiri.
export default function StatTile({ label, value, unit, trend, icon, loading }: StatTileProps) {
  if (loading) {
    return <div className="h-20 card skeleton" />;
  }
  const TrendIcon = trend ? TREND_ICON[trend.direction] : null;
  const trendColor = trend?.isGood === undefined
    ? "var(--text-muted)"
    : trend.isGood ? "var(--status-success)" : "var(--status-danger)";
  return (
    <div className="card px-4 py-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[0.875rem]" style={{ color: "var(--text-muted)" }}>{label}</span>
        {icon && <span style={{ color: "var(--text-muted)" }} className="flex-shrink-0">{icon}</span>}
      </div>
      <div className="mt-1 flex items-baseline gap-1.5">
        <span style={{ fontFamily: "var(--font-display)", fontSize: "1.75rem", fontWeight: 500, color: "var(--text-primary)" }}>
          {value}
        </span>
        {unit && <span className="text-[0.875rem]" style={{ color: "var(--text-muted)" }}>{unit}</span>}
      </div>
      {trend && TrendIcon && (
        <div className="mt-1 flex items-center gap-1 text-[0.875rem]" style={{ color: trendColor }}>
          <TrendIcon className="w-3.5 h-3.5" />
          {trend.value}
        </div>
      )}
    </div>
  );
}
