// src/components/admin/AdminPage.tsx — Admin Merkezi.
//
// 2026-09-20 SADELESTIRME (kullanici: "giren admin arkadaslar ne kadar basit bir panel olmus
// desin"): 14 sekmelik sarmalanan "hap" seridi ve surukle-birak siralama KALDIRILDI. Yerine
// sol tarafta DORT BOLUME ayrilmis sabit bir menu (Erisim / Otomasyon / Kayitlar / Sistem),
// sagda tek icerik karti; kartin basliginda sekmenin adi ve tek cumlelik aciklamasi.
// Sekme KIMLIKLERI (id) ve gorunurluk anahtarlari (`admintab:<id>`) DEGISMEDI: kayitli
// kurallar ve `admin_active_tab` tercihi aynen calisir. `admin_tab_order` tercihi artik
// okunmaz (siralama sabit); eski kayit DB'de zararsiz durur.
//
// 2026-09-07: "Test Senaryolari" ve "Akis Testleri" sekmeleri kaldirildi — bilesen dosyalari
// duruyor (TestScenariosTab.tsx / FlowTestsTab.tsx), yalnizca baglantilari kesik.
import React, { useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { prefsApi } from '../../api/prefsApi';
import {
  ServerStackIcon,
  ClipboardDocumentListIcon,
  CommandLineIcon,
  CogIcon,
  UsersIcon,
  EyeIcon,
  PhotoIcon,
  ArchiveBoxIcon,
  ShieldCheckIcon,
  KeyIcon,
  TicketIcon,
  CircleStackIcon,
  ArrowsPointingOutIcon,
  TableCellsIcon,
  ExclamationTriangleIcon,
  BookOpenIcon,
} from '@heroicons/react/24/outline';
import AuditLogTab from './tabs/AuditLogTab';
import AnsibleConfigTab from './tabs/AnsibleConfigTab';
import PlaybookRegistryTab from './tabs/PlaybookRegistryTab';
import SystemConfigTab from './tabs/SystemConfigTab';
import UserManagementTab from './tabs/UserManagementTab';
import PageVisibilityTab from './tabs/PageVisibilityTab';
import DenetimAccessTab from './tabs/DenetimAccessTab';
import LogXv2AdminTab from './tabs/LogXv2AdminTab';
import ScaleXAdminTab from './tabs/ScaleXAdminTab';
import InventoryVisibilityTab from './tabs/InventoryVisibilityTab';
import InventoryGapsTab from './tabs/InventoryGapsTab';
import BrandingTab from './tabs/BrandingTab';
import DbBackupTab from './tabs/DbBackupTab';
import SmartTicketsTab from './tabs/SmartTicketsTab';

// Sekme tanimlari. `id` = gorunurluk anahtari (`admintab:<id>`) — DEGISTIRME.
// (Bicim `{ id: '...', label: '...' }` bekciler tarafindan okunur: scalex-validation S3/S4,
// denetim-access.)
const DEFAULT_TABS = [
  // ORTAK SEKME: cluster / vault / bastion / kisitlama tablolari LogX'e ozel degil,
  // LogX + OpsX + Telnet + ScaleX tarafindan PAYLASILIYOR. Kimlik (`logxv2`) bilerek korunuyor.
  { id: 'logxv2', label: 'OCP Yapılandırma', icon: ServerStackIcon, hint: 'OpenShift cluster, vault anahtarı ve bastion tanımları — LogX, OpsX, Telnet ve ScaleX ortak kullanır.' },
  { id: 'scalex', label: 'ScaleX Yönetimi', icon: ArrowsPointingOutIcon, hint: 'Replica durdurma/ölçekleme kuralları ve RBAC bulguları.' },
  { id: 'audit', label: 'Denetim Kaydı', icon: ClipboardDocumentListIcon, hint: 'Kim, ne zaman, ne yaptı — hash zincirli, değiştirilemez kayıt.' },
  { id: 'smarttickets', label: 'Smart Talepleri', icon: TicketIcon, hint: 'Smart üzerinden açılan taleplerin durumu ve eşleşen işler.' },
  { id: 'dbbackup', label: 'DB Yedekleme', icon: CircleStackIcon, hint: 'Günlük tam yedek, veritabanı doluluğu ve gece temizliği.' },
  { id: 'ansible', label: 'Ansible Info', icon: CommandLineIcon, hint: 'AWX sunucuları ve bağlantı bilgileri.' },
  { id: 'playbooks', label: 'Playbook Kayıtları', icon: BookOpenIcon, hint: 'Portal işlerinin hangi AWX job template ile koştuğu.' },
  { id: 'system', label: 'Sistem', icon: CogIcon, hint: 'Ortam değişkenleri ve çalışma zamanı ayarları.' },
  { id: 'users', label: 'Kullanıcılar', icon: UsersIcon, hint: 'Yerel kullanıcılar, roller ve LDAP eşleşmeleri.' },
  { id: 'visibility', label: 'Sayfa Erişimi', icon: EyeIcon, hint: 'Hangi sayfa/sekme kime görünür — rol, kullanıcı ve grup kuralları.' },
  { id: 'denetimaccess', label: 'Denetim Erişimi', icon: ShieldCheckIcon, hint: 'Denetim sekmelerini kişi ya da LDAP grubu bazında açma.' },
  { id: 'inventoryvis', label: 'Envanter Görünürlüğü', icon: TableCellsIcon, hint: 'Envanter tablolarının ve sütunlarının kimlere açık olduğu.' },
  { id: 'inventorygaps', label: 'Envanter Boşlukları', icon: ExclamationTriangleIcon, hint: 'Envanterde eksik ya da tutarsız kayıtlar.' },
  { id: 'branding', label: 'Logo', icon: PhotoIcon, hint: 'Portal logosu ve sekme simgesi.' },
] as const;

type TabId = (typeof DEFAULT_TABS)[number]['id'];
const DEFAULT_TAB_IDS = DEFAULT_TABS.map((t) => t.id) as TabId[];
const TAB_BY_ID = new Map<TabId, (typeof DEFAULT_TABS)[number]>(DEFAULT_TABS.map((t) => [t.id, t]));

// Dort bolum — sira sabit, surukleme yok. Bir sekme gorunmezse (admintab kurali) bolumden
// duser; bolum bosalirsa basligi da gizlenir.
const SECTIONS: { title: string; icon: React.ElementType; ids: TabId[] }[] = [
  { title: 'Erişim', icon: KeyIcon, ids: ['users', 'visibility', 'denetimaccess', 'inventoryvis'] },
  { title: 'Otomasyon', icon: CommandLineIcon, ids: ['playbooks', 'ansible', 'logxv2', 'scalex'] },
  { title: 'Kayıtlar', icon: ArchiveBoxIcon, ids: ['audit', 'smarttickets', 'dbbackup', 'inventorygaps'] },
  { title: 'Sistem', icon: CogIcon, ids: ['system', 'branding'] },
];

const ADMIN_TAB_PREF = 'admin_active_tab';

const AdminPage: React.FC = () => {
  const { canSee } = useAuth();
  const [activeTab, setActiveTabState] = useState<TabId>('users');

  // Aktif sekme sunucu tercihinden gelir (restart/tarayici degisiminde korunur).
  useEffect(() => {
    prefsApi
      .getAll()
      .then((prefs) => {
        const saved = prefs[ADMIN_TAB_PREF];
        if (saved && DEFAULT_TAB_IDS.includes(saved as TabId)) setActiveTabState(saved as TabId);
      })
      .catch(() => {});
  }, []);

  const setActiveTab = (id: TabId) => {
    setActiveTabState(id);
    prefsApi.set({ [ADMIN_TAB_PREF]: id }).catch(() => {
      /* aktif sekme tercihi - sessiz hata kabul edilebilir */
    });
  };

  // Admin sekmeleri de gorunurluk motoruna tabidir (`admintab:<id>`).
  // KACIS KAPISI: "Sayfa Erisimi" ASLA gizlenmez — kurallar oradan yonetilir; o da
  // gizlenebilseydi geri almanin UI yolu kalmazdi.
  const visibleIds = new Set(DEFAULT_TAB_IDS.filter((id) => id === 'visibility' || canSee(`admintab:${id}`)));
  const sections = SECTIONS.map((s) => ({ ...s, tabs: s.ids.filter((id) => visibleIds.has(id)).map((id) => TAB_BY_ID.get(id)!) })).filter((s) => s.tabs.length > 0);
  const orderedTabs = sections.flatMap((s) => s.tabs);

  // Aktif sekme gizlenmisse ilk gorunur sekmeye dus.
  useEffect(() => {
    if (!orderedTabs.length) return;
    if (!orderedTabs.some((t) => t.id === activeTab)) setActiveTab(orderedTabs[0].id);
  }, [orderedTabs, activeTab]);

  const current = TAB_BY_ID.get(activeTab);
  const CurrentIcon = current?.icon;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="page-title">Admin Merkezi</h1>
        <p className="mt-1 text-sm" style={{ color: 'var(--text-muted)' }}>
          Erişim, otomasyon, kayıtlar ve sistem ayarları tek yerde.
        </p>
      </div>

      <div className="grid gap-5 admin-grid" style={{ gridTemplateColumns: 'minmax(13rem, 16rem) 1fr' }}>
        {/* Sol: bolumlu menu */}
        <nav aria-label="Admin bölümleri" className="space-y-4 self-start lg:sticky lg:top-4">
          {sections.map((s) => {
            const SIcon = s.icon;
            return (
              <div key={s.title}>
                <div className="flex items-center gap-1.5 px-2 mb-1 text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
                  <SIcon className="w-3.5 h-3.5" /> {s.title}
                </div>
                <ul className="space-y-0.5">
                  {s.tabs.map((tab) => {
                    const Icon = tab.icon;
                    const active = activeTab === tab.id;
                    return (
                      <li key={tab.id}>
                        <button
                          onClick={() => setActiveTab(tab.id)}
                          aria-current={active ? 'page' : undefined}
                          className="w-full flex items-center gap-2.5 px-2.5 py-2 text-sm rounded-lg text-left transition-colors"
                          style={{
                            background: active ? 'var(--bg-elevated)' : 'transparent',
                            color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
                            fontWeight: active ? 600 : 500,
                            boxShadow: active ? 'inset 3px 0 0 var(--accent)' : 'none',
                          }}
                        >
                          <Icon className="w-4 h-4 flex-shrink-0" style={{ color: active ? 'var(--accent)' : 'var(--text-muted)' }} />
                          <span className="truncate" title={tab.label}>{tab.label}</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </nav>

        {/* Sag: icerik */}
        <section className="card overflow-hidden min-w-0">
          {current && (
            <header className="flex items-center gap-3 px-5 py-4 border-b" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-elevated)' }}>
              {CurrentIcon && (
                <span className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: 'var(--bg-surface)', color: 'var(--accent)', boxShadow: 'var(--shadow-sm)' }}>
                  <CurrentIcon className="w-5 h-5" />
                </span>
              )}
              <div className="min-w-0">
                <h2 className="text-base font-semibold leading-tight">{current.label}</h2>
                <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>{current.hint}</p>
              </div>
            </header>
          )}
          <div className="p-5">
            <div key={activeTab} style={{ animation: 'fadeIn 0.18s ease' }}>
              {activeTab === 'audit' && <AuditLogTab />}
              {activeTab === 'smarttickets' && <SmartTicketsTab />}
              {activeTab === 'dbbackup' && <DbBackupTab />}
              {activeTab === 'ansible' && <AnsibleConfigTab />}
              {activeTab === 'playbooks' && <PlaybookRegistryTab />}
              {activeTab === 'system' && <SystemConfigTab />}
              {activeTab === 'users' && <UserManagementTab />}
              {activeTab === 'visibility' && <PageVisibilityTab />}
              {activeTab === 'denetimaccess' && <DenetimAccessTab />}
              {activeTab === 'logxv2' && <LogXv2AdminTab />}
              {activeTab === 'scalex' && <ScaleXAdminTab />}
              {activeTab === 'inventoryvis' && <InventoryVisibilityTab />}
              {activeTab === 'inventorygaps' && <InventoryGapsTab />}
              {activeTab === 'branding' && <BrandingTab />}
            </div>
          </div>
        </section>
      </div>

      <style>{`@keyframes fadeIn { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: translateY(0); } }
        @media (max-width: 900px) { .admin-grid { grid-template-columns: 1fr !important; } }`}</style>
    </div>
  );
};

export default AdminPage;
