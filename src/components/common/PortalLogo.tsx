import React, { useEffect, useState } from "react";

interface Props {
  className?: string;
  showText?: boolean;
  textColor?: string;
}

// ── LOGO FLASI (2026-08-28) ──────────────────────────────────────────────────
// ESKI DAVRANIS: bilesen ONCE gomulu kirmizi BMW SVG'sini ciziyor, `/api/branding/meta`
// yaniti gelince yuklenen logoyla DEGISTIRIYORDU. Yani ozel logo yuklemis her
// kurulumda, her sayfa acilisinda gozle gorulur bir "yanlis logo -> dogru logo" flasi
// vardi. Sekme ikonunda ayni sorun ZATEN cozulmustu (server/index.cjs, ?v=<hash>
// enjeksiyonu); ayni desen buraya da uygulandi.
//
// YENI DAVRANIS: sunucu, marka durumunu ILK HTML'e gomer (`window.__BMW_BOOT__`).
// Ilk render dogru gorseli cizer, hicbir sey beklemez, hicbir sey degismez. Adres
// icerige bagli surum tasidigi icin (`?v=<hash>`) tarayici degismedikce istek de atmaz.
//
// Gelistirmede (Vite dev sunucusu) `__BMW_BOOT__` bostur; o zaman ESKI yol —
// `/api/branding/meta` sorgusu— devreye girer. Yani davranis kaybi yok.
declare global {
  interface Window {
    __BMW_BOOT__?: { logoUrl?: string | null; theme?: string };
  }
}

const BOOT_LOGO: string | null | undefined =
  typeof window !== "undefined" ? window.__BMW_BOOT__?.logoUrl : undefined;

// `undefined` = sunucu bilgi gomemedi (dev) -> sor. `null` = "ozel logo YOK" -> sorma.
const BOOT_KNOWS = BOOT_LOGO !== undefined;

// /api/branding/meta modul-seviyesinde BIR KEZ sorgulanir (Masthead + LoginPage ayni
// anda mount olsa bile tek istek atilir) — sonuc butun PortalLogo ornekleri arasinda
// paylasilir, cache'lenir. Yalnizca sunucu gomemediginde kullanilir.
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
  // Baslangic degeri SENKRON: sunucu gomduyse ilk render zaten dogru gorseli cizer.
  const [logoSrc, setLogoSrc] = useState<string | null>(BOOT_KNOWS ? (BOOT_LOGO ?? null) : null);

  useEffect(() => {
    if (BOOT_KNOWS) return;   // sunucu zaten soyledi — istek atma
    let alive = true;
    hasCustomLogo().then((v) => {
      if (alive) setLogoSrc(v ? "/api/branding/logo" : null);
    });
    return () => { alive = false; };
  }, []);

  const useCustom = !!logoSrc;

  return (
    <span className="flex items-center gap-2 select-none">
      {useCustom ? (
        // Yuklenen gorselin kenarlarinda sik gorulen sorun: PNG'nin disa export
        // edilirken tam saydam olmayan (hafif beyaz/gri) kose pikselleri kalmasi —
        // object-contain bunlari OLDUGU GIBI gosterirdi. overflow-hidden'li bir
        // cerceve icinde gorseli hafifce buyutup (scale) kirparak bu kenar
        // artefaktlari gorunmez kilinir; object-cover cerceveyi tam doldurur.
        <span className={`${className} relative inline-block overflow-hidden rounded-[3px] flex-shrink-0`}>
          <img
            src={logoSrc!}
            alt="Portal Logo"
            className="absolute inset-0 w-full h-full object-cover scale-[1.16]"
            onError={() => setLogoSrc(null)}
          />
        </span>
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
