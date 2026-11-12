// src/components/layout/PageNav.tsx — PatternFly Nav (OpenShift Console sol navigasyonu).
//
// Icerik kaynagi ESKI Sidebar.tsx ile birebir ayni: nav gruplari once
// /api/visibility/nav-groups'tan cekilir, backend erisilemezse src/config/elements.ts
// icindeki NAV_GROUPS sabiti fallback olur; her oge canViewPage() ile filtrelenir.
// Degisen tek sey sunum: ust yatay menu yerine koyu dikey nav + acilir bolumler.
import React, { useContext, useEffect, useRef, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { ChevronDownIcon, ChevronRightIcon, ClipboardDocumentCheckIcon, Squares2X2Icon } from "@heroicons/react/24/outline";
// Hub girisleri kendi markalariyla ayrisir (kullanici, 2026-09-26): Nginx, Tux, Bitcoin.
import { NginxIcon, TuxIcon, BitcoinIcon } from "@/components/common/BrandIcons";
import { AuthContext } from "@/contexts/AuthContext";
import { PAGES, NAV_GROUPS } from "@/config/elements";
import { visibilityApi, type NavGroup } from "@/api/adminApi";

const ALL_NAV_ITEMS = PAGES.map((p) => ({ id: p.id, label: p.label, to: p.route }));

function toDisplayGroups(dbGroups: NavGroup[]): { id: string; label: string; itemIds: string[] }[] {
  // Siralama backend'de sortOrder'a gore uygulandi — burada TEKRAR siralanmaz.
  return dbGroups.map((g) => ({ id: g.key.replace(/^navgroup:/, ""), label: g.label, itemIds: g.pageKeys }));
}

// DARALTILAN BOLUMLER HATIRLANIR (2026-11-08). Eskiden her yenilemede butun bolumler yeniden
// aciliyordu; kullanicinin kapattigi bolum (or. hic girmedigi Nginx ARK SPA) her seferinde geri
// geliyordu. Tercih yalniz bu tarayicida (RequestsSidePanel ile ayni desen); okunamazsa hepsi acik.
export const NAV_DARALTMA_ANAHTARI = "portal.nav.daraltilan";

function daraltilanlariOku(): Record<string, boolean> {
  try {
    const v: unknown = JSON.parse(window.localStorage.getItem(NAV_DARALTMA_ANAHTARI) || "{}");
    // Dizi kayit ayrica elenmez: dizide bolum anahtari (metin) bulunmaz, hepsi acik okunur.
    return v && typeof v === "object" ? (v as Record<string, boolean>) : {};
  } catch {
    return {};
  }
}

interface Props {
  /** Mobil/daraltilmis modda bir baglantiya tiklaninca nav'i kapatmak icin. */
  onNavigate?: () => void;
}

export default function PageNav({ onNavigate }: Props) {
  const { canViewPage, pageVisibilityLoaded, user } = useContext(AuthContext);
  const location = useLocation();
  const [dbNavGroups, setDbNavGroups] = useState<{ id: string; label: string; itemIds: string[] }[] | null>(null);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(daraltilanlariOku);
  // Etkin sayfanin bolumu daraltilmis olsa da ACIK cizilir (yoksa bulunulan yer menude gorunmez).
  // Kullanici o bolumu BU sayfadayken kapatirsa kapali kalir; anahtar "bolum|yol" - baska bir
  // sayfaya gecince kural yeniden isler. Effect + setState yerine turetilir (set-state-in-effect).
  const [aktifteKapatilan, setAktifteKapatilan] = useState<string | null>(null);
  const navRef = useRef<HTMLElement>(null);

  function bolumuDegistir(id: string, acikMi: boolean, aktifMi: boolean) {
    const next = { ...collapsed };
    if (acikMi) next[id] = true;
    else delete next[id];
    setCollapsed(next);
    setAktifteKapatilan(acikMi && aktifMi ? `${id}|${location.pathname}` : null);
    try {
      window.localStorage.setItem(NAV_DARALTMA_ANAHTARI, JSON.stringify(next));
    } catch {
      /* depolama yoksa yalniz bu oturumda */
    }
  }

  useEffect(() => {
    visibilityApi.getNavGroups()
      .then((groups) => { if (groups.length) setDbNavGroups(toDisplayGroups(groups)); })
      .catch(() => { /* NAV_GROUPS fallback */ });
  }, []);

  const activeNavGroups = dbNavGroups && dbNavGroups.length ? dbNavGroups : NAV_GROUPS;

  // ETKIN OGE GORUNUR ALANDA (2026-11-08). Uzun menunun altindaki sayfalarda (ScaleX, Telnet)
  // yenilemeden sonra etkin oge ekranin altinda kaliyordu. Yalniz menunun KENDI kaydirmasi
  // ayarlanir: scrollIntoView, menu kapaliyken (genislik 0, overflow hidden) sarmalayiciyi
  // yatayda kaydirip menuyu kaymis acabilirdi.
  useEffect(() => {
    const nav = navRef.current;
    const el = nav?.querySelector<HTMLElement>(".pf-nav-link.is-current");
    if (!nav || !el) return;
    const n = nav.getBoundingClientRect();
    const e = el.getBoundingClientRect();
    if (e.top < n.top) nav.scrollTop += e.top - n.top - 8;
    else if (e.bottom > n.bottom) nav.scrollTop += e.bottom - n.bottom + 8;
  }, [location.pathname, pageVisibilityLoaded, dbNavGroups]);

  const visible = ALL_NAV_ITEMS.filter((item) => canViewPage(item.id));
  const visibleIds = new Set(visible.map((i) => i.id));
  const itemById = new Map(visible.map((i) => [i.id, i]));

  const visibleGroups = activeNavGroups
    .map((g) => ({ ...g, items: g.itemIds.filter((id) => visibleIds.has(id)).map((id) => itemById.get(id)!) }))
    .filter((g) => g.items.length > 0);

  const linkClass = ({ isActive }: { isActive: boolean }) =>
    `pf-nav-link no-underline ${isActive ? "is-current" : ""}`;

  return (
    <nav ref={navRef} className="pf-nav" aria-label="Ana navigasyon">
      {/* Perspektif satiri — OpenShift'teki Administrator/Developer secicisinin karsiligi:
          kullanicinin hangi rolun gorunum kapsaminda oldugunu gosterir. */}
      <div
        className="flex items-center gap-2 px-4 h-12 text-[0.875rem]"
        /* Sabit renkler token'a (2026-08-28): sol menu artik temayi izliyor
           (PF6 page.css sidebar = floating--secondary), acik temada #e0e0e0 metin
           beyazimsi zeminde okunmazdi. */
        style={{ borderBottom: "1px solid var(--masthead-border)", color: "var(--nav-text)" }}
      >
        <span className="h-2 w-2 rounded-full" style={{ background: user?.role === "Admin" ? "var(--rh-red)" : "var(--accent)" }} />
        {user?.role === "Admin" ? "Yönetici görünümü" : "Kullanıcı görünümü"}
      </div>

      {!pageVisibilityLoaded ? (
        <div className="p-4 space-y-2">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} className="h-4 skeleton" style={{ width: `${55 + i * 6}%`, opacity: 0.25 }} />
          ))}
        </div>
      ) : (
        <ul className="py-2">
          {visibleGroups.map((group) => {
            // Tek ogeli grup: ust seviye baglanti (OpenShift'teki "Home" gibi tekil girisler).
            if (group.items.length === 1) {
              const item = group.items[0];
              // Nginx Hub (2026-09-19): nginx yesili "lazer" cerceve + parlayan "Hub" (bkz. index.css .nginx-hub-*)
              const isHub = item.id === "NginxConsole";
              // Server Hub (2026-09-21): ayni "hub" cercevesi, accent tonunda (.server-hub-link)
              const isServerHub = item.id === "ServerHub";
              // Crypto Hub (2026-09-25): ayni "hub" cercevesi (bkz. index.css .crypto-hub-link)
              const isCryptoHub = item.id === "CryptoHub";
              // BMW Hub (2026-11-08): ayni "hub" cercevesi, camgobegi (bkz. index.css .bmw-hub-link)
              const isBmwHub = item.id === "BmwHub";
              // Application Hub (2026-11-08): ayni "hub" cercevesi, kehribar (bkz. index.css .app-hub-link)
              const isAppHub = item.id === "AppHub";
              return (
                <li key={group.id}>
                  <NavLink
                    to={item.to}
                    className={({ isActive }) => `${linkClass({ isActive })}${isHub ? " nginx-hub-link" : ""}${isServerHub ? " nginx-hub-link server-hub-link" : ""}${isCryptoHub ? " nginx-hub-link crypto-hub-link" : ""}${isBmwHub ? " nginx-hub-link bmw-hub-link" : ""}${isAppHub ? " nginx-hub-link app-hub-link" : ""}`}
                    style={{ paddingLeft: "0.75rem" }}
                    onClick={onNavigate}
                  >
                    {isHub ? <span className="nginx-hub-label"><NginxIcon className="h-4 w-4 shrink-0" /><span>Nginx</span> <span className="nginx-hub-word">Hub</span></span>
                      : isServerHub ? <span className="nginx-hub-label"><TuxIcon className="h-4 w-4 shrink-0" /><span>Server</span> <span className="nginx-hub-word">Hub</span></span>
                      : isCryptoHub ? <span className="nginx-hub-label"><BitcoinIcon className="h-4 w-4 shrink-0" /><span>Crypto</span> <span className="nginx-hub-word">Hub</span></span>
                      : isAppHub ? <span className="nginx-hub-label"><Squares2X2Icon className="h-4 w-4 shrink-0" /><span>Application</span> <span className="nginx-hub-word">Hub</span></span>
                      : isBmwHub ? <span className="nginx-hub-label"><ClipboardDocumentCheckIcon className="h-4 w-4 shrink-0" /><span>BMW</span> <span className="nginx-hub-word">Hub</span></span>
                      : group.label}
                  </NavLink>
                </li>
              );
            }

            const groupActive = group.items.some((i) => location.pathname.startsWith(i.to));
            // Bolumler varsayilan olarak ACIK (OpenShift davranisi); kullanici daraltabilir.
            const zorlaAcik = groupActive && aktifteKapatilan !== `${group.id}|${location.pathname}`;
            const isOpen = !collapsed[group.id] || zorlaAcik;

            return (
              <li key={group.id}>
                <button
                  className={`pf-nav-toggle${group.id === "bmwhub" ? ` nginx-hub-link bmw-hub-link${groupActive ? " is-current" : ""}` : ""}`}
                  aria-expanded={isOpen}
                  onClick={() => bolumuDegistir(group.id, isOpen, groupActive)}
                >
                  {/* BMW Hub (2026-11-08): cok sayfali grup; baslik diger Hub'larla ayni cerceve */}
                  {group.id === "bmwhub" ? (
                    <span className="nginx-hub-label"><ClipboardDocumentCheckIcon className="h-4 w-4 shrink-0" /><span>BMW</span> <span className="nginx-hub-word">Hub</span></span>
                  ) : (
                    <span style={{ fontWeight: groupActive ? 700 : 400, color: groupActive ? "var(--nav-text)" : undefined }}>
                      {group.label}
                    </span>
                  )}
                  {isOpen ? <ChevronDownIcon className="h-3.5 w-3.5" /> : <ChevronRightIcon className="h-3.5 w-3.5" />}
                </button>
                {isOpen && (
                  <ul>
                    {group.items.map((item) => (
                      <li key={item.id}>
                        <NavLink to={item.to} className={linkClass} onClick={onNavigate}>
                          {item.label}
                        </NavLink>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </nav>
  );
}
