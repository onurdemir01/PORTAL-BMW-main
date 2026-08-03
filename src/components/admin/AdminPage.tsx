import React, { useEffect, useState } from "react";
import { prefsApi } from "../../api/prefsApi";
import {
  ServerStackIcon,
  ClipboardDocumentListIcon,
  WrenchScrewdriverIcon,
  CommandLineIcon,
  CogIcon,
  UsersIcon,
  EyeIcon,
  PhotoIcon,
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
import OpsxConfigTab from "./tabs/OpsxConfigTab";

// Eski port-1111 LogX admin yüzeyleri (Oturumlar, İzinler, LogX Inventory) tamamen
// kaldırıldı — yeni yapıda log akışı "LogX v2 Yapılandırma" (OCP cluster/terminal
// haritası, Legacy ortam eşlemesi, erişim kısıtı) üzerinden yönetilir. "Linkler" sekmesi
// de kaldırıldı (Yardımcı Araçlar sayfası zaten inline admin CRUD sağlıyor).
const TABS = [
  { id: "logxv2",      label: "LogX Yapılandırma", icon: ServerStackIcon },
  { id: "audit",       label: "Denetim Kaydı",     icon: ClipboardDocumentListIcon },
  { id: "selfservice", label: "Self Service",     icon: WrenchScrewdriverIcon },
  { id: "ansible",     label: "Ansible Info",     icon: CommandLineIcon },
  { id: "playbooks",   label: "Playbook Kayıtları", icon: CommandLineIcon },
  { id: "system",      label: "Sistem",           icon: CogIcon },
  { id: "users",       label: "Kullanıcılar",     icon: UsersIcon },
  { id: "visibility",  label: "Sayfa Erişimi",    icon: EyeIcon },
  { id: "inventoryvis", label: "Envanter Görünürlüğü", icon: ServerStackIcon },
  { id: "opsxconfig",  label: "OpsX Yapılandırma", icon: CommandLineIcon },
  { id: "branding",    label: "Marka",            icon: PhotoIcon },
] as const;

type TabId = (typeof TABS)[number]["id"];

const ADMIN_TAB_PREF = "admin_active_tab";

const AdminPage: React.FC = () => {
  const [activeTab, setActiveTabState] = useState<TabId>("logxv2");

  // Aktif sekme sunucu tercihinden gelir (restart/tarayici degisiminde ayni sekme acilir).
  useEffect(() => {
    prefsApi.getAll().then((prefs) => {
      const saved = prefs[ADMIN_TAB_PREF];
      if (saved && TABS.some((t) => t.id === saved)) setActiveTabState(saved as TabId);
    }).catch(() => {});
  }, []);

  const setActiveTab = (id: TabId) => {
    setActiveTabState(id);
    prefsApi.set({ [ADMIN_TAB_PREF]: id }).catch(() => {});
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="page-title">Admin Merkezi</h1>
        <p className="mt-1 text-sm font-medium" style={{ color: "var(--text-muted)" }}>
          LogX, Self Service ve sistem yönetimi.
        </p>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 rounded-xl p-1 flex-wrap" style={{ background: "var(--bg-elevated)" }}>
        {TABS.map((tab) => {
          const Icon = tab.icon;
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-lg transition-all duration-200
                ${active ? "bg-white text-[#0066CC]" : "text-[var(--text-muted)] hover:text-[var(--text-primary)]"}`}
              style={active ? { boxShadow: "var(--shadow-sm)" } : {}}
            >
              <Icon className="w-4 h-4" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Tab content */}
      <div className="card p-5">
        <div key={activeTab} style={{ animation: "fadeIn 0.18s ease" }}>
          {activeTab === "audit"       && <AuditLogTab />}
          {activeTab === "selfservice" && <SelfServiceAdminTab />}
          {activeTab === "ansible"     && <AnsibleConfigTab />}
          {activeTab === "playbooks"   && <PlaybookRegistryTab />}
          {activeTab === "system"      && <SystemConfigTab />}
          {activeTab === "users"       && <UserManagementTab />}
          {activeTab === "visibility"  && <PageVisibilityTab />}
          {activeTab === "logxv2"      && <LogXv2AdminTab />}
          {activeTab === "inventoryvis" && <InventoryVisibilityTab />}
          {activeTab === "opsxconfig"  && <OpsxConfigTab />}
          {activeTab === "branding"    && <BrandingTab />}
        </div>
      </div>

      <style>{`@keyframes fadeIn { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: translateY(0); } }`}</style>
    </div>
  );
};

export default AdminPage;
