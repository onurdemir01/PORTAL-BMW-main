// src/components/layout/PageNav.tsx — PatternFly Nav (OpenShift Console sol navigasyonu).
//
// Icerik kaynagi ESKI Sidebar.tsx ile birebir ayni: nav gruplari once
// /api/visibility/nav-groups'tan cekilir, backend erisilemezse src/config/elements.ts
// icindeki NAV_GROUPS sabiti fallback olur; her oge canViewPage() ile filtrelenir.
// Degisen tek sey sunum: ust yatay menu yerine koyu dikey nav + acilir bolumler.
import React, { useContext, useEffect, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { ChevronDownIcon, ChevronRightIcon } from "@heroicons/react/24/outline";
import { AuthContext } from "@/contexts/AuthContext";
import { PAGES, NAV_GROUPS } from "@/config/elements";
import { visibilityApi, type NavGroup } from "@/api/adminApi";

const ALL_NAV_ITEMS = PAGES.map((p) => ({ id: p.id, label: p.label, to: p.route }));

function toDisplayGroups(dbGroups: NavGroup[]): { id: string; label: string; itemIds: string[] }[] {
  // Siralama backend'de sortOrder'a gore uygulandi — burada TEKRAR siralanmaz.
  return dbGroups.map((g) => ({ id: g.key.replace(/^navgroup:/, ""), label: g.label, itemIds: g.pageKeys }));
}

interface Props {
  /** Mobil/daraltilmis modda bir baglantiya tiklaninca nav'i kapatmak icin. */
  onNavigate?: () => void;
}

export default function PageNav({ onNavigate }: Props) {
  const { canViewPage, pageVisibilityLoaded, user } = useContext(AuthContext);
  const location = useLocation();
  const [dbNavGroups, setDbNavGroups] = useState<{ id: string; label: string; itemIds: string[] }[] | null>(null);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  useEffect(() => {
    visibilityApi.getNavGroups()
      .then((groups) => { if (groups.length) setDbNavGroups(toDisplayGroups(groups)); })
      .catch(() => { /* NAV_GROUPS fallback */ });
  }, []);

  const activeNavGroups = dbNavGroups && dbNavGroups.length ? dbNavGroups : NAV_GROUPS;

  const visible = ALL_NAV_ITEMS.filter((item) => canViewPage(item.id));
  const visibleIds = new Set(visible.map((i) => i.id));
  const itemById = new Map(visible.map((i) => [i.id, i]));

  const visibleGroups = activeNavGroups
    .map((g) => ({ ...g, items: g.itemIds.filter((id) => visibleIds.has(id)).map((id) => itemById.get(id)!) }))
    .filter((g) => g.items.length > 0);

  const linkClass = ({ isActive }: { isActive: boolean }) =>
    `pf-nav-link no-underline ${isActive ? "is-current" : ""}`;

  return (
    <nav className="pf-nav" aria-label="Ana navigasyon">
      {/* Perspektif satiri — OpenShift'teki Administrator/Developer secicisinin karsiligi:
          kullanicinin hangi rolun gorunum kapsaminda oldugunu gosterir. */}
      <div
        className="flex items-center gap-2 px-4 h-12 text-[0.875rem]"
        style={{ borderBottom: "1px solid #3c3f42", color: "#e0e0e0" }}
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
              return (
                <li key={group.id}>
                  <NavLink
                    to={item.to}
                    className={linkClass}
                    style={{ paddingLeft: "1rem" }}
                    onClick={onNavigate}
                  >
                    {group.label}
                  </NavLink>
                </li>
              );
            }

            const groupActive = group.items.some((i) => location.pathname.startsWith(i.to));
            // Bolumler varsayilan olarak ACIK (OpenShift davranisi); kullanici daraltabilir.
            const isOpen = !collapsed[group.id];

            return (
              <li key={group.id}>
                <button
                  className="pf-nav-toggle"
                  aria-expanded={isOpen}
                  onClick={() => setCollapsed((c) => ({ ...c, [group.id]: !c[group.id] }))}
                >
                  <span style={{ fontWeight: groupActive ? 700 : 400, color: groupActive ? "#fff" : undefined }}>
                    {group.label}
                  </span>
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
