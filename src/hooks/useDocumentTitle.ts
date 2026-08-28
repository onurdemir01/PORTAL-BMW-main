// src/hooks/useDocumentTitle.ts — sekme basligi.
//
// SORUN: `document.title` repoda HIC kullanilmiyordu; 15+ sayfanin hepsi "BMW Portal"
// diye goruonuyordu. Sonuclari:
//   * Birden fazla sekme acan kullanici (bu portalda normal: bir yanda Envanter, bir
//     yanda calisan bir job) hangi sekmenin hangisi oldugunu ANLAYAMIYORDU.
//   * Tarayici gecmisi ve yer imleri tamamen ayirt edilemez hale geliyordu.
//
// LISTE KOPYALANMADI: baslik, menuyu ve gorunurluk agacini da besleyen TEK kaynaktan
// (src/config/elements.ts PAGES) turetilir. Yeni bir sayfa eklendiginde basligi
// kendiliginden gelir; ayri bir eslemeyi guncellemeyi unutma ihtimali yok.
import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { PAGES } from "@/config/elements";

export const APP_NAME = "BMW Portal";

/** Yol -> sayfa etiketi. En UZUN eslesme kazanir: "/admin/users" gibi alt yollar da
 *  dogru sayfaya baglansin, ama "/" her seyle eslesmesin. */
export function titleForPath(pathname: string): string {
  let best: { label: string; len: number } | null = null;
  for (const p of PAGES) {
    if (p.route === "/") continue;
    if (pathname === p.route || pathname.startsWith(p.route + "/")) {
      if (!best || p.route.length > best.len) best = { label: p.label, len: p.route.length };
    }
  }
  return best ? `${best.label} · ${APP_NAME}` : APP_NAME;
}

export function useDocumentTitle() {
  const { pathname } = useLocation();
  useEffect(() => {
    document.title = titleForPath(pathname);
  }, [pathname]);
}
