import React, { useEffect, useState } from "react";

// ── MARKA ISARETI ────────────────────────────────────────────────────────────
// Tasarim kaynagi: hknisci/bmw_portal `action_list/logos.md` icindeki iki referans
// (kullanici USTTEKINI sectti). Referanslar 800x800 AI uretimi uygulama ikonlari;
// burada elle yazilmis SVG'ye cevrildiler.
//
// NEDEN PNG DEGIL DE SVG: referanslar 800px'te bile yumusak kenarli ve 36px'e
// kuculdugunde detay tamamen kayboluyor. Vektore cevirmek burada kaliteyi
// DUSURMUYOR, ARTIRIYOR — ayni kaynak 36px'te de 512px'te de keskin, ~2KB, ve
// favicon ile birebir ayni isareti kullanabiliyor.
//
// RENKLER UYDURULMADI: referans goruntunun pikselleri orneklenerek alindi.
//   zemin  #002351 (en acik nokta) -> #000f28 (koseler)
//   bulut  #00dba4 (sol/yesil) -> #00f4d1 (tepe/turkuaz) -> #0085fd (sag/mavi)
//   mozaik #00dca0
//
// IKI VARYANT — ve bu bir tercih degil, okunurluk zorunlulugu:
//   * `mark` (varsayilan): lacivert kutu + gradyan bulut + veri mozaigi. Masthead
//     (36px) ve favicon icin. Referanstaki "BMW" yazisi BILEREK YOK: 36px'te o yazi
//     ~7px olur ve okunmaz; ustelik masthead'de logonun HEMEN YANINDA zaten
//     "BMW Portal" yaziyor — ikonda tekrar etmek yalnizca bulaniklik uretirdi.
//   * `withWordmark`: referansin birebir karsiligi (bulut + mozaik + BMW). Logonun
//     TEK BASINA ve BUYUK gorundugu yerlerde (giris ekrani) kullanilir.
//
// Bulut konturu Heroicons'un `CloudIcon` yolundan turetildi (zaten bagimlilikta) —
// elle egri cizmek yerine dogrulugu bilinen bir geometri kullanildi.

// ── LOGO FLASI (2026-08-28) ──────────────────────────────────────────────────
// ESKI DAVRANIS: bilesen ONCE gomulu isareti ciziyor, `/api/branding/meta` yaniti
// gelince yuklenen logoyla DEGISTIRIYORDU — ozel logo yuklemis her kurulumda, her
// sayfa acilisinda gozle gorulur bir "yanlis logo -> dogru logo" flasi vardi.
// YENI: sunucu marka durumunu ILK HTML'e gomer (`window.__BMW_BOOT__`); ilk render
// dogru gorseli cizer, hicbir sey beklemez. Gelistirmede (Vite dev sunucusu) bu bos
// oldugu icin eski yol — `/api/branding/meta` sorgusu — devreye girer.
declare global {
  interface Window {
    __BMW_BOOT__?: { logoUrl?: string | null; theme?: string };
  }
}

const BOOT_LOGO: string | null | undefined =
  typeof window !== "undefined" ? window.__BMW_BOOT__?.logoUrl : undefined;

// `undefined` = sunucu bilgi gomemedi (dev) -> sor. `null` = "ozel logo YOK" -> sorma.
const BOOT_KNOWS = BOOT_LOGO !== undefined;

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

/** Heroicons `CloudIcon` (24x24 outline) yolu — bulut konturunun kaynagi. */
const CLOUD_D =
  "M2.25 15a4.5 4.5 0 0 0 4.5 4.5H18a3.75 3.75 0 0 0 1.332-7.257 3 3 0 0 0-3.758-3.848 " +
  "5.25 5.25 0 0 0-10.233 2.33A4.502 4.502 0 0 0 2.25 15Z";

/** Veri mozaigi: [x, y, kenar, opaklik]. Buyukten kucuge, sol-alttan buluta dogru
 *  "cozulme" hissi. Son kare bulutun sol ucuna DEGER — referanstaki gibi mozaik
 *  buluta akiyor gorunsun. */
type Pixel = [number, number, number, number];
const PIXELS_MARK: Pixel[] = [
  [5.5, 35.0, 7.2, 1],
  [14.8, 36.6, 4.7, 0.92],
  [7.4, 44.8, 5.8, 0.85],
  [15.6, 46.0, 3.4, 0.75],
  [22.0, 40.0, 2.6, 0.65],
  [6.0, 53.4, 3.6, 0.6],
  [13.4, 53.2, 2.3, 0.5],
];
const PIXELS_FULL: Pixel[] = [
  [5.6, 27.0, 6.4, 1],
  [14.0, 28.4, 4.2, 0.92],
  [7.2, 35.6, 5.0, 0.85],
  [14.8, 36.8, 3.0, 0.75],
  [20.6, 31.2, 2.3, 0.65],
  [6.0, 43.4, 3.2, 0.55],
];

interface Props {
  className?: string;
  /** Referansin birebir karsiligi (BMW wordmark dahil). Yalnizca logonun TEK BASINA
   *  ve buyuk (>= ~48px) gorundugu yerlerde kullanin; masthead'de okunmaz. */
  withWordmark?: boolean;
  showText?: boolean;
  textColor?: string;
}

export function PortalLogo({
  className = "h-8 w-8", withWordmark = false, showText = false, textColor = "text-white",
}: Props) {
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
  // Gradyan id'leri BENZERSIZ olmali: ayni sayfada iki logo varsa (masthead + giris
  // gecisi, ya da admin onizlemesi) ayni id iki kez tanimlanir ve tarayici ILKINI
  // kullanir — ikinci logo yanlis renkte cizilirdi.
  const uid = React.useId().replace(/:/g, "");
  const pixels = withWordmark ? PIXELS_FULL : PIXELS_MARK;
  // Olculer referansin oranlarindan turetildi. `mark` varyantinda bulut BILEREK daha
  // buyuk: wordmark olmadigi icin kutuda yer var ve 36px'te dolgunluk okunurlugu
  // dogrudan artiriyor.
  const cloud = withWordmark
    ? { t: "translate(17.08 -0.72) scale(1.744)", w: 2.06 }
    : { t: "translate(14.5 2.5) scale(2.0)", w: 2.05 };

  return (
    <span className="flex items-center gap-2 select-none">
      {useCustom ? (
        // KIRPMA YOK: yuklenen logo `object-contain` ile TAM gorunur. Eskiden
        // `object-cover scale-[1.16]` ile buyutulup kirpiliyordu ve kare olmayan
        // her logo (ornegin genis bir wordmark) kenarlarindan kesiliyordu.
        <span
          className={`${className} relative inline-block overflow-hidden flex-shrink-0`}
          style={{ borderRadius: "var(--radius-sm)" }}
        >
          <img
            src={logoSrc!}
            alt="Portal Logo"
            className="absolute inset-0 w-full h-full object-contain p-px"
            onError={() => setLogoSrc(null)}
          />
        </span>
      ) : (
        <svg viewBox="0 0 64 64" className={`${className} flex-shrink-0`} role="img" aria-label="BMW Portal">
          <defs>
            <linearGradient id={`tile${uid}`} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="#00204a" />
              <stop offset="0.45" stopColor="#002351" />
              <stop offset="1" stopColor="#000c22" />
            </linearGradient>
            {/* Referanstaki hafif ic parlaklik — kutuyu duz bir blok olmaktan cikarir. */}
            <radialGradient id={`glow${uid}`} cx="0.42" cy="0.3" r="0.72">
              <stop offset="0" stopColor="#1a56a8" stopOpacity="0.38" />
              <stop offset="1" stopColor="#1a56a8" stopOpacity="0" />
            </radialGradient>
            {/* Bulut ve mozaik AYNI gradyan ailesini paylasir: mozaik buluttan
                kopmus parcalar gibi okunsun. */}
            <linearGradient id={`aq${uid}`} x1="0" y1="1" x2="1" y2="0">
              <stop offset="0" stopColor="#00dba4" />
              <stop offset="0.45" stopColor="#00f4d1" />
              <stop offset="1" stopColor="#0085fd" />
            </linearGradient>
          </defs>

          <rect width="64" height="64" rx="13.5" fill={`url(#tile${uid})`} />
          <rect width="64" height="64" rx="13.5" fill={`url(#glow${uid})`} />

          {pixels.map(([x, y, s, o], i) => (
            <rect key={i} x={x} y={y} width={s} height={s} rx={Math.min(1.6, s / 3.6)}
                  fill={`url(#aq${uid})`} opacity={o} />
          ))}

          <g transform={cloud.t}>
            <path d={CLOUD_D} fill="none" stroke={`url(#aq${uid})`} strokeWidth={cloud.w}
                  strokeLinecap="round" strokeLinejoin="round" />
          </g>

          {withWordmark && (
            // Wordmark ORTAK tipografiden gelir (Red Hat Display, kendi sunucumuzdan
            // yuklenir — bkz. src/fonts.css). Yola cevirmek yerine metin birakildi:
            // font zaten preload ediliyor ve metin her boyutta hinting'li cizilir.
            <text
              x="35" y="54.5" textAnchor="middle" fill="#ffffff"
              style={{ fontFamily: "var(--font-display)", fontSize: "16.5px", fontWeight: 700, letterSpacing: "-0.6px" }}
            >
              BMW
            </text>
          )}
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
