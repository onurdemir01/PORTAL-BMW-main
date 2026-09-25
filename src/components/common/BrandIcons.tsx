// src/components/crypto_hub/BrandIcons.tsx — Crypto Hub / Hub menüsü simgeleri (2026-09-26).
//
// Kullanıcı: "yan barda Crypto Hub'ın yanında Bitcoin, Nginx Hub'ın yanında Nginx, Server
// Hub'ın yanında Tux; Crypto Hub içinde Metaco'nun yanında Ripple, Wyden'ın yanında Wyden
// logosu görünsün."
//
// BUNLAR ELDE ÇİZİLMİŞ SADE İŞARETLERDİR, RESMÎ MARKA DOSYALARI DEĞİL. Portal kapalı ağda
// çalışıyor; dışarıdan logo indirilmiyor ve bir markanın resmî SVG'sini ezberden "aynısı"
// diye üretmek yanlış olur. Bitcoin (₿), Nginx (N) ve Tux herkesin tanıdığı genel biçimler;
// Ripple ve Wyden için sade birer monogram kullanılıyor.
//
// RESMÎ DOSYA GELİRSE: ilgili bileşenin içindeki <svg> gövdesini değiştirmek yeterli —
// çağrı yerleri (boyut, renk, hizalama) aynı kalır.
import React from 'react';

type IconProps = { className?: string; style?: React.CSSProperties; title?: string };

const BTC_ORANGE = '#F7931A';
const NGINX_GREEN = '#009639';
const TUX_DARK = '#1B1B1B';
const TUX_YELLOW = '#F5B400';
const RIPPLE_BLUE = '#0085C0';
const WYDEN_INK = '#101C3D';

/** Bitcoin — ₿ işareti (turuncu daire içinde). */
export function BitcoinIcon({ className = 'h-4 w-4', style, title = 'Crypto' }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} style={style} role="img" aria-label={title}>
      <title>{title}</title>
      <circle cx="12" cy="12" r="11" fill={BTC_ORANGE} />
      <path
        fill="#fff"
        d="M16.1 10.4c.2-1.4-.85-2.15-2.3-2.65l.47-1.88-1.15-.28-.46 1.83c-.3-.08-.62-.15-.93-.22l.46-1.84-1.14-.29-.47 1.88c-.25-.06-.5-.12-.74-.18v-.01l-1.58-.39-.3 1.22s.85.2.83.21c.46.12.55.42.53.67l-.53 2.14c.03.01.07.02.12.04l-.12-.03-.75 3c-.06.14-.2.35-.52.27.01.02-.83-.21-.83-.21l-.57 1.31 1.49.37c.28.07.55.14.82.21l-.47 1.9 1.14.28.47-1.88c.31.09.61.17.91.24l-.47 1.87 1.15.29.47-1.9c1.95.37 3.42.22 4.03-1.54.5-1.42-.02-2.24-1.05-2.77.75-.17 1.32-.67 1.47-1.7zm-2.63 3.66c-.36 1.42-2.75.65-3.53.46l.63-2.52c.78.2 3.27.58 2.9 2.06zm.35-3.68c-.32 1.29-2.31.63-2.96.47l.57-2.29c.65.16 2.73.46 2.39 1.82z"
      />
    </svg>
  );
}

/** Nginx — yeşil "N" işareti (altıgen gövde). */
export function NginxIcon({ className = 'h-4 w-4', style, title = 'Nginx' }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} style={style} role="img" aria-label={title}>
      <title>{title}</title>
      <path d="M12 1.5 21.5 7v10L12 22.5 2.5 17V7z" fill={NGINX_GREEN} />
      <path d="M8.6 16.4V7.6h1.9l4 5.6V7.6h1.9v8.8h-1.9l-4-5.6v5.6z" fill="#fff" />
    </svg>
  );
}

/** Tux — sade penguen silüeti (Linux). */
export function TuxIcon({ className = 'h-4 w-4', style, title = 'Linux' }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} style={style} role="img" aria-label={title}>
      <title>{title}</title>
      {/* gövde */}
      <path d="M12 2c2.5 0 4 1.9 4 4.3 0 1.3-.3 2 .4 2.9 1.4 1.8 2.4 3.9 2.4 6.2 0 3.3-2.9 5.6-6.8 5.6S5.2 18.7 5.2 15.4c0-2.3 1-4.4 2.4-6.2.7-.9.4-1.6.4-2.9C8 3.9 9.5 2 12 2z" fill={TUX_DARK} />
      {/* karın */}
      <ellipse cx="12" cy="15" rx="4.1" ry="4.6" fill="#fff" />
      {/* gözler */}
      <ellipse cx="10.4" cy="6.4" rx="1.1" ry="1.4" fill="#fff" />
      <ellipse cx="13.6" cy="6.4" rx="1.1" ry="1.4" fill="#fff" />
      <circle cx="10.6" cy="6.6" r=".55" fill={TUX_DARK} />
      <circle cx="13.4" cy="6.6" r=".55" fill={TUX_DARK} />
      {/* gaga */}
      <path d="M12 7.4c.9 0 1.6.5 1.6 1s-.7 1-1.6 1-1.6-.5-1.6-1 .7-1 1.6-1z" fill={TUX_YELLOW} />
      {/* ayaklar */}
      <path d="M8.6 20.2c-.6.9-1.7 1.2-2.2.9-.5-.3-.2-1.2.5-1.9.5-.5 1.2-.8 1.7-.7zM15.4 20.2c.6.9 1.7 1.2 2.2.9.5-.3.2-1.2-.5-1.9-.5-.5-1.2-.8-1.7-.7z" fill={TUX_YELLOW} />
    </svg>
  );
}

/**
 * Ripple (Metaco'nun sahibi) — dalga halkaları işareti.
 * Resmî marka dosyası DEĞİL; sade bir temsil.
 */
export function RippleIcon({ className = 'h-4 w-4', style, title = 'Ripple (Metaco)' }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} style={style} role="img" aria-label={title}>
      <title>{title}</title>
      <circle cx="12" cy="12" r="11" fill={RIPPLE_BLUE} />
      <g fill="none" stroke="#fff" strokeWidth="1.5" strokeLinecap="round">
        <circle cx="12" cy="12" r="2.2" />
        <path d="M7.4 12a4.6 4.6 0 0 1 9.2 0" />
        <path d="M5 12a7 7 0 0 1 14 0" opacity=".65" />
      </g>
    </svg>
  );
}

/**
 * Wyden — monogram "W".
 * Şirketin resmî logosu elimde YOK; bu bir YER TUTUCU. Resmî SVG gelince burası değişir.
 */
export function WydenIcon({ className = 'h-4 w-4', style, title = 'Wyden' }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} style={style} role="img" aria-label={title}>
      <title>{title}</title>
      <rect x="1" y="1" width="22" height="22" rx="5" fill={WYDEN_INK} />
      <path d="M5 8.2h2.3l1.7 6 1.9-6h1.9l1.9 6 1.7-6H19l-2.7 8.4h-2.1L12.4 11l-1.8 5.6H8.5z" fill="#fff" />
    </svg>
  );
}

/** Uygulama anahtarından simge (crypto hub içi). */
export function AppIcon({ app, className, style }: { app: string; className?: string; style?: React.CSSProperties }) {
  if (app === 'metaco') return <RippleIcon className={className} style={style} />;
  if (app === 'wyden') return <WydenIcon className={className} style={style} />;
  return <BitcoinIcon className={className} style={style} />;
}
