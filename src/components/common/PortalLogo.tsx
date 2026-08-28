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
        // KIRPMA KALDIRILDI (2026-08-28). Eskiden `object-cover scale-[1.16]` ile gorsel
        // buyutulup KIRPILIYORDU; gerekce PNG'lerin tam saydam olmayan kose piksellerini
        // gizlemekti. Ama bu, KARE OLMAYAN her logoyu bozuyordu: geniS bir wordmark'in
        // (ornegin "BMW Group IT") sol ve sag kenarlari tamamen kesiliyor, ekranda
        // ortasindan bir serit kaliyordu. Artik `object-contain`: logo NE ISE O
        // gorunur, en-boy orani korunur. Kose artefakti riski, iceriden ufak bir
        // padding ile karsilanir — bir logoyu kirpmaktansa 1px cerceve kaybi yeglenir.
        <span className={`${className} relative inline-block overflow-hidden flex-shrink-0`}
              style={{ borderRadius: "var(--radius-sm)" }}>
          <img
            src={logoSrc!}
            alt="Portal Logo"
            className="absolute inset-0 w-full h-full object-contain p-px"
            onError={() => setLogoSrc(null)}
          />
        </span>
      ) : (
        // GOMULU VARSAYILAN. Karsit ceyreklerin opakligi 0.35'ti; 28px'te dort-bolme
        // motifi bulanik bir kirmizi kareye donusuyordu. 0.60'a cikarildi: motif kucuk
        // boyutta da OKUNUR, ama iki ton arasindaki fark korunur (duz beyaz yapmak
        // BMW'nin donusumlu deseni yerine bir pencere izlenimi verirdi).
        // Bosluklar da 12/32'den 10/36'ya genisletildi — daha az bosluk, daha buyuk
        // bolmeler, kucuk boyutta daha net kenar.
        <svg viewBox="0 0 100 100" className={className} aria-label="BMW Portal" role="img">
          <rect x="0" y="0" width="100" height="100" rx="6" ry="6" fill="#ee0000" />
          <rect x="10" y="10" width="36" height="36" fill="#ffffff" />
          <rect x="54" y="10" width="36" height="36" fill="#ffffff" opacity="0.6" />
          <rect x="10" y="54" width="36" height="36" fill="#ffffff" opacity="0.6" />
          <rect x="54" y="54" width="36" height="36" fill="#ffffff" />
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
