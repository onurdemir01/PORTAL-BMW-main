import React from "react";

interface Props {
  className?: string;
  showText?: boolean;
  textColor?: string;
}

// Marka isareti — Red Hat paletinde (kirmizi #ee0000), duz, gradyansiz.
// BMW'nin dort-bolme motifi korunur; renkler ve kose yaricapi PatternFly'a uyarlandi.
export function PortalLogo({ className = "h-8 w-8", showText = false, textColor = "text-white" }: Props) {
  return (
    <span className="flex items-center gap-2 select-none">
      <svg viewBox="0 0 100 100" className={className} aria-label="BMW Portal" role="img">
        <rect x="0" y="0" width="100" height="100" rx="4" ry="4" fill="#ee0000" />
        <rect x="12" y="12" width="32" height="32" fill="#ffffff" />
        <rect x="56" y="12" width="32" height="32" fill="#ffffff" opacity="0.35" />
        <rect x="12" y="56" width="32" height="32" fill="#ffffff" opacity="0.35" />
        <rect x="56" y="56" width="32" height="32" fill="#ffffff" />
      </svg>

      {showText && (
        <span className={`text-base ${textColor}`} style={{ fontFamily: "var(--font-display)", fontWeight: 500 }}>
          BMW Portal
        </span>
      )}
    </span>
  );
}
