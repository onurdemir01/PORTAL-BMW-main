// src/config/elements.ts — Kontrol edilebilir arayüz elemanlarının TEK kaynağı (frontend).
//
// Önceden bu bilgi 5 ayrı yerde tekrarlanıyordu (Sidebar ALL_NAV_ITEMS+NAV_GROUPS, App.tsx
// route'ları, DashboardPage OTHER_TOOLS, admin PageVisibilityTab PAGES, backend
// DEFAULT_VISIBILITY+seed). Artık nav (Sidebar) ve görünürlük ağacı (admin) buradan türetilir.
// Element anahtarları backend `portal_elements.element_key` ile BİREBİR aynıdır (bkz.
// server/db/mssql-setup.cjs ELEMENT_SEED) — böylece canSee/canViewPage ve sunucu-tarafı
// requireVisible aynı anahtarı paylaşır.

export interface PageElement {
  id: string;      // element_key (aynı zamanda page-visibility anahtarı)
  label: string;
  route: string;
}

export interface NavGroupDef {
  id: string;
  label: string;
  itemIds: string[];
}

export interface TabElement {
  id: string;      // element_key, ör. "Perf:instana" | "admintab:users"
  label: string;
}

// ── Sayfalar ──────────────────────────────────────────────────────────────────
export const PAGES: PageElement[] = [
  { id: "Dashboard",    label: "Dashboard",    route: "/dashboard"       },
  { id: "Envanter",     label: "Envanter",     route: "/envanter"        },
  { id: "LogX",         label: "LogX",         route: "/logx"            },
  { id: "OpsX",         label: "OpsX",         route: "/opsx"            },
  { id: "Telnet",       label: "Telnet",       route: "/telnet"          },
  // element_key ("Self Service") DEGISMEDI — portal_element_visibility kurallari ve
  // canViewPage() cagrilari bu anahtara bagli. Yalniz GORUNEN etiket "Otomasyon" oldu.
  { id: "Self Service", label: "Otomasyon",    route: "/self-service"    },
  { id: "Ansible",      label: "Ansible",      route: "/ansible"         },
  { id: "Performance",  label: "Performance",  route: "/performance"     },
  { id: "AI Analist",   label: "AI Analist",   route: "/ai-analyst"      },
  { id: "Nöbet",        label: "Nöbet",        route: "/duty-roster"     },
  { id: "Linkler",      label: "Linkler",      route: "/important-links" },
  { id: "Admin",        label: "Admin",        route: "/admin"           },
];

// ── Navigasyon grupları (Sidebar render'ı) ────────────────────────────────────
// "Gözlemlenebilirlik" grubu kaldırıldı (actions.md #19) — LogX ve Performance
// artık kendi tek-öğeli üst-seviye gruplarında, tek bir belirsiz şemsiye altında
// gizlenmiyor. Bölüm O.2 (actions.md #19): grup yapısı artık DB'de (nav_group elementleri,
// bkz. server/auth/visibility-routes.cjs GET /api/visibility/nav-groups) — Sidebar.tsx onu
// çeker ve BU sabiti yalnızca backend erişilemezse/boş dönerse FALLBACK olarak kullanır.
//
// 2026-07-26: Envanter "Genel" grubundan ayrıldı — Dashboard direkt Genel grubu (alt menü YOK),
// Envanter ayrı bir grup oldu. Her biri direkt açılır.
export const NAV_GROUPS: NavGroupDef[] = [
  { id: "genel",       label: "Genel",            itemIds: ["Dashboard"] },
  { id: "envanter",    label: "Envanter",         itemIds: ["Envanter"] },
  { id: "performance", label: "Performance",      itemIds: ["Performance"] },
  { id: "operasyon",   label: "Nöbetçiler",       itemIds: ["Nöbet"] },
  // 2026-07-28: "LogX" ust-seviye grubu KALDIRILDI; LogX artik bu grubun alt ogesi.
  // Grup etiketi "Otomasyon" -> "Self Servis"; grup ANAHTARI ("otomasyon") degismedi
  // (DB'deki nav_group element_key'i ve ona bagli kayitlar korunsun diye).
  { id: "otomasyon",   label: "Self Servis",      itemIds: ["Self Service", "Ansible", "LogX", "OpsX", "Telnet"] },
  { id: "ai",          label: "AI Analist",       itemIds: ["AI Analist"] },
  { id: "kaynaklar",   label: "Yardımcı Araçlar", itemIds: ["Linkler"] },
  { id: "admin",       label: "Admin",            itemIds: ["Admin"] },
];

// ── Performance alt-tab'ları (görünürlük anahtarı "Perf:*") ────────────────────
export const PERF_TABS: TabElement[] = [
  { id: "Perf:problems", label: "Problems" },
  { id: "Perf:events",   label: "Events" },
  { id: "Perf:entities", label: "Entities" },
  { id: "Perf:metrics",  label: "Metrics" },
  { id: "Perf:instana",  label: "Instana" },
  { id: "Perf:splunk",   label: "Splunk" },
];

// ── Admin sekmeleri (görünürlük anahtarı "admintab:*") ────────────────────────
export const ADMIN_TABS: TabElement[] = [
  { id: "admintab:logxv2",      label: "LogX Yapılandırma" },
  { id: "admintab:audit",       label: "Denetim Kaydı" },
  { id: "admintab:selfservice", label: "Self Service" },
  { id: "admintab:ansible",     label: "Ansible Config" },
  { id: "admintab:playbooks",   label: "Playbook Kayıtları" },
  { id: "admintab:system",      label: "Sistem" },
  { id: "admintab:users",       label: "Kullanıcılar" },
  { id: "admintab:visibility",  label: "Görünürlük" },
  { id: "admintab:inventoryvis", label: "Envanter Görünürlüğü" },
];
