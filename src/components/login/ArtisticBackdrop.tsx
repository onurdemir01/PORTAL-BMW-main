import React from "react";

// Login ekranının sağ (form) panelinin arka planı — kartın etrafını saran,
// yavaşça biçim değiştiren organik "blob" ışık kütleleri + ince nokta ızgarası
// + film grain dokusu. Renk paleti, portalın modül renkleriyle birebir aynı
// (mavi=accent, mor=LogX/AI Analist, yeşil=Self Service) — sol paneldeki
// teknik/ağ temasıyla akraba ama sanatsal/organik bir karşıtlık kurar.
export default function ArtisticBackdrop() {
  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none" aria-hidden="true">
      <div
        className="absolute animate-blob-a"
        style={{
          top: "-16%", right: "-14%", width: "58%", height: "58%",
          // DEKORATIF, giris ekranina ozel — bkz. LoginBackgroundCanvas notu.
          background: "radial-gradient(circle at 35% 35%, rgba(79,142,255,0.55), rgba(79,142,255,0.14) 55%, transparent 75%)",
          filter: "blur(38px)",
        }}
      />
      <div
        className="absolute animate-blob-b"
        style={{
          bottom: "-18%", left: "-14%", width: "62%", height: "62%",
          background: "radial-gradient(circle at 60% 40%, rgba(167,139,250,0.5), rgba(167,139,250,0.12) 55%, transparent 75%)",
          filter: "blur(42px)",
        }}
      />
      <div
        className="absolute animate-blob-c rounded-full"
        style={{
          top: "54%", right: "6%", width: "26%", height: "26%",
          background: "radial-gradient(circle, rgba(52,211,153,0.5), rgba(52,211,153,0.1) 55%, transparent 75%)",
          filter: "blur(28px)",
        }}
      />

      {/* İnce nokta ızgarası — ritim/yapı */}
      <div
        className="absolute inset-0"
        style={{
          backgroundImage: "radial-gradient(rgba(11,25,41,0.055) 1px, transparent 1px)",
          backgroundSize: "26px 26px",
        }}
      />

      {/* Film grain — düz gradyanın "üretilmiş" değil "basılmış" hissetmesini sağlar */}
      <div
        className="absolute inset-0"
        style={{
          opacity: 0.05,
          mixBlendMode: "overlay",
          backgroundImage:
            "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")",
        }}
      />
    </div>
  );
}
