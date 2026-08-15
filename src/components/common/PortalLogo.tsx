import React, { useEffect, useState } from "react";

interface Props {
  className?: string;
  showText?: boolean;
  textColor?: string;
}

// /api/branding/meta modul-seviyesinde BIR KEZ sorgulanir (Masthead + LoginPage ayni
// anda mount olsa bile tek istek atilir) — sonuc butun PortalLogo ornekleri arasinda
// paylasilir, cache'lenir.
let metaPromise: Promise<boolean> | null = null;
function hasCustomLogo(): Promise<boolean> {
  if (!metaPromise) {
    metaPromise = fetch("/api/branding/meta")
      .then((r) => r.json())
      .then((d) => !!d.hasLogo)
      .catch(() => false);
  }
  return metaPromise;
}

// Marka isareti — Admin > Marka'dan ozel bir logo yuklenmisse (bkz. server/admin/branding.cjs
// "logo" slotu) o gorsel kullanilir; aksi halde Red Hat paletinde (kirmizi #ee0000), duz,
// gradyansiz, BMW'nin dort-bolme motifini koruyan gomulu SVG'ye dusulur.
export function PortalLogo({ className = "h-8 w-8", showText = false, textColor = "text-white" }: Props) {
  const [useCustom, setUseCustom] = useState(false);

  useEffect(() => {
    let alive = true;
    hasCustomLogo().then((v) => { if (alive) setUseCustom(v); });
    return () => { alive = false; };
  }, []);

  return (
    <span className="flex items-center gap-2 select-none">
      {useCustom ? (
        <img
          src="/api/branding/logo"
          alt="Portal Logo"
          className={`${className} object-contain`}
          onError={() => setUseCustom(false)}
        />
      ) : (
        <svg viewBox="0 0 100 100" className={className} aria-label="BMW Portal" role="img">
          <rect x="0" y="0" width="100" height="100" rx="4" ry="4" fill="#ee0000" />
          <rect x="12" y="12" width="32" height="32" fill="#ffffff" />
          <rect x="56" y="12" width="32" height="32" fill="#ffffff" opacity="0.35" />
          <rect x="12" y="56" width="32" height="32" fill="#ffffff" opacity="0.35" />
          <rect x="56" y="56" width="32" height="32" fill="#ffffff" />
        </svg>
      )}

      {showText && (
        <span className={`text-base ${textColor}`} style={{ fontFamily: "var(--font-display)", fontWeight: 500 }}>
          BMW Portal
        </span>
      )}
    </span>
  );
}
