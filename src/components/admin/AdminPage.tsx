import React, { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { prefsApi } from "../../api/prefsApi";
import { toast } from "@/hooks/useToast";
import {
  ServerStackIcon,
  ClipboardDocumentListIcon,
  WrenchScrewdriverIcon,
  CommandLineIcon,
  CogIcon,
  UsersIcon,
  EyeIcon,
  PhotoIcon,
  Bars3Icon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CheckIcon,
  BeakerIcon,
} from "@heroicons/react/24/outline";
import AuditLogTab from "./tabs/AuditLogTab";
import SelfServiceAdminTab from "./tabs/SelfServiceAdminTab";
import AnsibleConfigTab from "./tabs/AnsibleConfigTab";
import PlaybookRegistryTab from "./tabs/PlaybookRegistryTab";
import SystemConfigTab from "./tabs/SystemConfigTab";
import UserManagementTab from "./tabs/UserManagementTab";
import PageVisibilityTab from "./tabs/PageVisibilityTab";
import LogXv2AdminTab from "./tabs/LogXv2AdminTab";
import InventoryVisibilityTab from "./tabs/InventoryVisibilityTab";
import BrandingTab from "./tabs/BrandingTab";
import TestScenariosTab from "./tabs/TestScenariosTab";

// Eski port-1111 LogX admin yüzeyleri (Oturumlar, İzinler, LogX Inventory) tamamen
// kaldırıldı — yeni yapıda log akışı "LogX v2 Yapılandırma" (OCP cluster/terminal
// haritası, Legacy ortam eşlemesi, erişim kısıtı) üzerinden yönetilir. "Linkler" sekmesi
// de kaldırıldı (Yardımcı Araçlar sayfası zaten inline admin CRUD sağlıyor).
const DEFAULT_TABS = [
  { id: "logxv2",      label: "LogX Yapılandırma", icon: ServerStackIcon },
  { id: "audit",       label: "Denetim Kaydı",     icon: ClipboardDocumentListIcon },
  { id: "selfservice", label: "Self Service",     icon: WrenchScrewdriverIcon },
  { id: "testscenarios", label: "Test Senaryoları", icon: BeakerIcon },
  { id: "ansible",     label: "Ansible Info",     icon: CommandLineIcon },
  { id: "playbooks",   label: "Playbook Kayıtları", icon: CommandLineIcon },
  { id: "system",      label: "Sistem",           icon: CogIcon },
  { id: "users",       label: "Kullanıcılar",     icon: UsersIcon },
  { id: "visibility",  label: "Sayfa Erişimi",    icon: EyeIcon },
  { id: "inventoryvis", label: "Envanter Görünürlüğü", icon: ServerStackIcon },
  { id: "branding",    label: "Marka",            icon: PhotoIcon },
] as const;

type TabId = (typeof DEFAULT_TABS)[number]["id"];
const DEFAULT_TAB_IDS = DEFAULT_TABS.map((t) => t.id) as TabId[];
const TAB_BY_ID = new Map(DEFAULT_TABS.map((t) => [t.id, t]));

const ADMIN_TAB_PREF = "admin_active_tab";
const ADMIN_TAB_ORDER_PREF = "admin_tab_order";

// Kaydedilmis sirayi gecerli sekle sokar: bilinmeyen id'leri atar, eksik kalan
// (ornegin ileride eklenen yeni bir sekme) id'leri sonuna ekler — boylece kayitli
// sira asla "kayip sekme" uretmez.
function normalizeTabOrder(saved: unknown): TabId[] {
  const validSaved = Array.isArray(saved)
    ? saved.filter((id): id is TabId => typeof id === "string" && TAB_BY_ID.has(id as TabId))
    : [];
  const missing = DEFAULT_TAB_IDS.filter((id) => !validSaved.includes(id));
  return [...validSaved, ...missing];
}

const AdminPage: React.FC = () => {
  const { canSee } = useAuth();
  const [activeTab, setActiveTabState] = useState<TabId>("logxv2");
  const [tabOrder, setTabOrder] = useState<TabId[]>(DEFAULT_TAB_IDS);
  const [reordering, setReordering] = useState(false);

  // Aktif sekme + sekme sirasi sunucu tercihinden gelir (restart/tarayici degisiminde korunur).
  useEffect(() => {
    prefsApi.getAll().then((prefs) => {
      const saved = prefs[ADMIN_TAB_PREF];
      if (saved && DEFAULT_TAB_IDS.includes(saved as TabId)) setActiveTabState(saved as TabId);
      const savedOrder = prefs[ADMIN_TAB_ORDER_PREF];
      if (savedOrder) {
        try { setTabOrder(normalizeTabOrder(JSON.parse(savedOrder))); } catch { /* bozuk kayit -> varsayilan */ }
      }
    }).catch(() => {});
  }, []);

  const setActiveTab = (id: TabId) => {
    setActiveTabState(id);
    prefsApi.set({ [ADMIN_TAB_PREF]: id }).catch(() => { /* aktif sekme tercihi - sessiz hata kabul edilebilir */ });
  };

  function moveTab(id: TabId, direction: -1 | 1) {
    setTabOrder((prev) => {
      const idx = prev.indexOf(id);
      const swapWith = idx + direction;
      if (idx < 0 || swapWith < 0 || swapWith >= prev.length) return prev;
      const next = [...prev];
      [next[idx], next[swapWith]] = [next[swapWith], next[idx]];
      // Basarisiz bir kayit artik SESSIZCE yutulmuyor — reverse proxy PUT'u engelliyorsa/
      // oturum dolmussa vb. kullaniciya HEMEN gorunur olsun (aksi halde "kaydettim ama
      // sayfa yenilenince eski haline donuyor" hatasi teshis edilemezdi).
      prefsApi.set({ [ADMIN_TAB_ORDER_PREF]: JSON.stringify(next) })
        .catch((e: unknown) => toast.error(`Sekme sırası kaydedilemedi: ${e instanceof Error ? e.message : String(e)}`));
      return next;
    });
  }

  // Admin sekmeleri de görünürlük motoruna tabidir (`admintab:<id>` element anahtarları).
  // Bu anahtarlar Sayfa Erişimi ekranında zaten yönetilebiliyordu ama HİÇBİR YERDE
  // uygulanmıyordu — kapatmak hiçbir şey değiştirmiyordu. Kayıtsız anahtar → görünür.
  // KAÇIŞ KAPISI: "Sayfa Erişimi" sekmesi ASLA gizlenmez. Görünürlük kurallarını buradan
  // yönetiyoruz; kendisi de gizlenebilseydi (ör. yanlışlıkla kill-switch kapatılınca)
  // geri almanın UI yolu kalmaz, DB müdahalesi gerekirdi.
  const orderedTabs = tabOrder
    .map((id) => TAB_BY_ID.get(id)!)
    .filter(Boolean)
    .filter((tab) => tab.id === "visibility" || canSee(`admintab:${tab.id}`));

  // Aktif sekme gizlenmişse ilk görünür sekmeye düş (boş içerik gösterme).
  useEffect(() => {
    if (!orderedTabs.length) return;
    if (!orderedTabs.some((t) => t.id === activeTab)) setActiveTab(orderedTabs[0].id);
  }, [orderedTabs, activeTab]);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="page-title">Admin Merkezi</h1>
          <p className="mt-1 text-sm font-medium" style={{ color: "var(--text-muted)" }}>
            LogX, Self Service ve sistem yönetimi.
          </p>
        </div>
        <button
          onClick={() => setReordering((v) => !v)}
          className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg border transition-colors flex-shrink-0 ${
            reordering ? "bg-[#0066CC] text-white border-[#0066CC]" : "text-[var(--text-muted)] hover:text-[var(--text-primary)]"
          }`}
          style={reordering ? {} : { borderColor: "var(--border)" }}
        >
          {reordering ? <CheckIcon className="w-3.5 h-3.5" /> : <Bars3Icon className="w-3.5 h-3.5" />}
          {reordering ? "Bitti" : "Sekmeleri Sırala"}
        </button>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 rounded-xl p-1 flex-wrap" style={{ background: "var(--bg-elevated)" }}>
        {orderedTabs.map((tab, i) => {
          const Icon = tab.icon;
          const active = activeTab === tab.id;
          return (
            <div
              key={tab.id}
              className={`flex items-center rounded-lg transition-all duration-200 ${
                !reordering && active ? "bg-white" : ""
              }`}
              style={!reordering && active ? { boxShadow: "var(--shadow-sm)" } : {}}
            >
              {reordering && (
                <button
                  onClick={() => moveTab(tab.id, -1)}
                  disabled={i === 0}
                  className="px-1 py-2 text-[var(--text-muted)] hover:text-[var(--text-primary)] disabled:opacity-25 disabled:pointer-events-none"
                  title="Sola taşı"
                >
                  <ChevronLeftIcon className="w-3.5 h-3.5" />
                </button>
              )}
              <button
                onClick={() => !reordering && setActiveTab(tab.id)}
                className={`flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-lg
                  ${!reordering && active ? "text-[#0066CC]" : "text-[var(--text-muted)] hover:text-[var(--text-primary)]"}
                  ${reordering ? "cursor-default" : ""}`}
              >
                <Icon className="w-4 h-4" />
                {tab.label}
              </button>
              {reordering && (
                <button
                  onClick={() => moveTab(tab.id, 1)}
                  disabled={i === orderedTabs.length - 1}
                  className="px-1 py-2 text-[var(--text-muted)] hover:text-[var(--text-primary)] disabled:opacity-25 disabled:pointer-events-none"
                  title="Sağa taşı"
                >
                  <ChevronRightIcon className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          );
        })}
      </div>

      {/* Tab content */}
      <div className="card p-5">
        <div key={activeTab} style={{ animation: "fadeIn 0.18s ease" }}>
          {activeTab === "audit"       && <AuditLogTab />}
          {activeTab === "selfservice" && <SelfServiceAdminTab />}
          {activeTab === "testscenarios" && <TestScenariosTab />}
          {activeTab === "ansible"     && <AnsibleConfigTab />}
          {activeTab === "playbooks"   && <PlaybookRegistryTab />}
          {activeTab === "system"      && <SystemConfigTab />}
          {activeTab === "users"       && <UserManagementTab />}
          {activeTab === "visibility"  && <PageVisibilityTab />}
          {activeTab === "logxv2"      && <LogXv2AdminTab />}
          {activeTab === "inventoryvis" && <InventoryVisibilityTab />}
          {activeTab === "branding"    && <BrandingTab />}
        </div>
      </div>

      <style>{`@keyframes fadeIn { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: translateY(0); } }`}</style>
    </div>
  );
};

export default AdminPage;
