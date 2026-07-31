import React, { useEffect, useState } from "react";
import {
  ChevronDownIcon,
  PlusIcon,
  PencilIcon,
  TrashIcon,
  CheckIcon,
  XMarkIcon,
  FolderIcon,
  FolderOpenIcon,
  DocumentTextIcon,
} from "@heroicons/react/24/outline";
import { selfServiceApi, type SelfServiceGroup } from "@/api/selfServiceApi";
import { ansibleApi, type AnsibleSsItem } from "@/api/ansibleApi";
import Collapse from "@/components/common/Collapse";
import { Select } from "@/components/ui/Form";
import type { SelfServiceStore, SelfServiceTab, SelfServiceSubTab, SelfServiceItem } from "@/types";

const emptyStore: SelfServiceStore = { version: 1, tabs: [] };

function sortByOrder<T extends { order: number }>(arr: T[]) {
  return [...arr].sort((a, b) => (a.order || 0) - (b.order || 0));
}

// ----- Inline editable text -----
const InlineEdit: React.FC<{
  value: string;
  onSave: (v: string) => Promise<void>;
  className?: string;
}> = ({ value, onSave, className = "" }) => {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!draft.trim()) return;
    setSaving(true);
    try { await onSave(draft.trim()); setEditing(false); }
    finally { setSaving(false); }
  }

  if (!editing) {
    return (
      <span
        className={`cursor-pointer hover:underline decoration-dotted ${className}`}
        onClick={() => { setDraft(value); setEditing(true); }}
      >
        {value}
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1">
      <input
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") save(); if (e.key === "Escape") setEditing(false); }}
        className="border-b border-blue-400 outline-none text-sm px-1 min-w-[120px]"
      />
      <button onClick={save} disabled={saving} className="text-green-600 hover:text-green-700">
        <CheckIcon className="w-3.5 h-3.5" />
      </button>
      <button onClick={() => setEditing(false)} className="text-gray-400 hover:text-gray-600">
        <XMarkIcon className="w-3.5 h-3.5" />
      </button>
    </span>
  );
};

// ----- Item form -----
type ItemFormData = {
  title: string;
  goUrl: string;
  info: string;
  requestExample: string;
  sampleType: "text" | "link";
  sampleValue: string;
};

const ItemForm: React.FC<{
  initial?: Partial<SelfServiceItem>;
  onSave: (data: Partial<SelfServiceItem>) => Promise<void>;
  onCancel: () => void;
}> = ({ initial = {}, onSave, onCancel }) => {
  const [form, setForm] = useState<ItemFormData>({
    title: initial.title || "",
    goUrl: initial.goUrl || "",
    info: initial.info || "",
    requestExample: initial.requestExample || "",
    sampleType: (initial.sample?.type as "text" | "link") || "text",
    sampleValue: initial.sample?.value || "",
  });
  const [saving, setSaving] = useState(false);

  function set<K extends keyof ItemFormData>(k: K, v: ItemFormData[K]) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  async function submit() {
    if (!form.title.trim() || !form.goUrl.trim() || !form.sampleValue.trim()) return;
    setSaving(true);
    try {
      await onSave({
        title: form.title.trim(),
        goUrl: form.goUrl.trim(),
        info: form.info.trim(),
        requestExample: form.requestExample.trim(),
        sample: { type: form.sampleType, value: form.sampleValue.trim() },
      });
    } finally {
      setSaving(false);
    }
  }

  const inputCls = "w-full px-3 py-2 text-sm border border-gray-200 rounded-xl outline-none focus:border-blue-400 transition";

  return (
    <div className="bg-gray-50 rounded-xl p-4 space-y-3 border border-gray-100">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs font-medium text-gray-500 block mb-1">Başlık *</label>
          <input value={form.title} onChange={(e) => set("title", e.target.value)} className={inputCls} placeholder="Servis adı" />
        </div>
        <div>
          <label className="text-xs font-medium text-gray-500 block mb-1">Ansible Launch URL *</label>
          <input value={form.goUrl} onChange={(e) => set("goUrl", e.target.value)} className={inputCls} placeholder="https://awx/..." />
        </div>
      </div>
      <div>
        <label className="text-xs font-medium text-gray-500 block mb-1">Açıklama</label>
        <input value={form.info} onChange={(e) => set("info", e.target.value)} className={inputCls} placeholder="Kısa açıklama" />
      </div>
      <div>
        <label className="text-xs font-medium text-gray-500 block mb-1">İstek Örneği</label>
        <input value={form.requestExample} onChange={(e) => set("requestExample", e.target.value)} className={inputCls} placeholder="Örnek istek açıklaması" />
      </div>
      <div className="grid grid-cols-3 gap-3">
        <div>
          <label className="text-xs font-medium text-gray-500 block mb-1">Örnek Tip *</label>
          <Select value={form.sampleType} onChange={(e) => set("sampleType", e.target.value as "text" | "link")}>
            <option value="text">Metin</option>
            <option value="link">Link</option>
          </Select>
        </div>
        <div className="col-span-2">
          <label className="text-xs font-medium text-gray-500 block mb-1">Örnek Değer *</label>
          <input value={form.sampleValue} onChange={(e) => set("sampleValue", e.target.value)} className={inputCls} placeholder={form.sampleType === "link" ? "https://..." : "Örnek metin"} />
        </div>
      </div>
      <div className="flex gap-2 justify-end">
        <button onClick={onCancel} className="px-3 py-1.5 text-sm border border-gray-200 rounded-xl hover:bg-gray-100 transition">İptal</button>
        <button
          onClick={submit}
          disabled={saving || !form.title.trim() || !form.goUrl.trim() || !form.sampleValue.trim()}
          className="px-4 py-1.5 text-sm bg-black text-white rounded-xl hover:bg-gray-800 disabled:opacity-50 transition"
        >
          {saving ? "Kaydediliyor..." : "Kaydet"}
        </button>
      </div>
    </div>
  );
};

// actions.md #5 (Bolum D) — Smart/Ansible/Diğerleri grup metadata'sı (etiket/sıra/aktiflik)
// artık DB'de; eskiden SelfServicePage.tsx'te hardcoded bir dizi olarak yaşıyordu.
const GroupsSection: React.FC<{ groups: SelfServiceGroup[]; onChange: (groups: SelfServiceGroup[]) => void }> = ({ groups, onChange }) => {
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState({ label: "", sortOrder: "0" });

  function openEdit(g: SelfServiceGroup) {
    setEditing(g.id);
    setDraft({ label: g.label, sortOrder: String(g.sortOrder) });
  }

  async function save(g: SelfServiceGroup) {
    try {
      const r = await selfServiceApi.updateGroup(g.id, { label: draft.label.trim() || g.label, sortOrder: Number(draft.sortOrder) || 0 });
      onChange(groups.map((x) => (x.id === g.id ? r.group : x)).sort((a, b) => a.sortOrder - b.sortOrder));
      setEditing(null);
    } catch {
      /* ignore — kullanici tekrar deneyebilir */
    }
  }

  async function toggleActive(g: SelfServiceGroup) {
    try {
      const r = await selfServiceApi.updateGroup(g.id, { isActive: !g.isActive });
      onChange(groups.map((x) => (x.id === g.id ? r.group : x)));
    } catch {
      /* ignore */
    }
  }

  return (
    <div className="border border-gray-100 rounded-2xl p-4 space-y-2 bg-gray-50/50">
      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Üst-Seviye Gruplar (Smart / Ansible / Diğerleri)</p>
      <p className="text-[11px] text-gray-400">Bu 3 grubun görünen adı, sırası ve aktifliği burada değiştirilir — sayfa üstündeki sekmeler anında güncellenir.</p>
      <div className="space-y-1.5">
        {groups.sort((a, b) => a.sortOrder - b.sortOrder).map((g) => (
          <div key={g.id} className="flex items-center gap-2 bg-white border border-gray-100 rounded-lg px-3 py-1.5">
            <code className="text-[10px] text-gray-400 w-16">{g.groupKey}</code>
            {editing === g.id ? (
              <>
                <input value={draft.label} onChange={(e) => setDraft((d) => ({ ...d, label: e.target.value }))}
                  className="flex-1 px-2 py-1 text-xs border border-gray-200 rounded-lg" />
                <input type="number" value={draft.sortOrder} onChange={(e) => setDraft((d) => ({ ...d, sortOrder: e.target.value }))}
                  className="w-14 px-2 py-1 text-xs border border-gray-200 rounded-lg" />
                <button onClick={() => save(g)} className="text-xs text-emerald-600 hover:underline">Kaydet</button>
                <button onClick={() => setEditing(null)} className="text-xs text-gray-400 hover:underline">Vazgeç</button>
              </>
            ) : (
              <>
                <span className="flex-1 text-sm text-gray-700">{g.label}</span>
                <span className="text-xs text-gray-400">sıra: {g.sortOrder}</span>
                <button onClick={() => toggleActive(g)} className={`text-xs px-2 py-0.5 rounded-full ${g.isActive ? "bg-emerald-50 text-emerald-700" : "bg-gray-100 text-gray-400"}`}>
                  {g.isActive ? "aktif" : "pasif"}
                </button>
                <button onClick={() => openEdit(g)} className="text-gray-400 hover:text-blue-500"><PencilIcon className="w-3.5 h-3.5" /></button>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};

// Otomasyon > Ansible sekmesindeki liste hem admin hem normal kullanıcı icin
// `enabled` alanına göre filtrelenir (bkz. SelfServicePage.tsx AnsibleSection) —
// yani bir servis kapatıldığında admin de onu o ekrandan bir daha göremez/geri
// açamaz. Burası (Admin > Self Service) TÜM kayıtlı Ansible servislerini
// (enabled=false dahil) listeleyip görünürlüğü tek tıkla açıp kapatmayı sağlar.
const AnsibleVisibilitySection: React.FC = () => {
  const [items, setItems] = useState<AnsibleSsItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  async function reload() {
    try {
      setLoading(true);
      setError(null);
      const r = await ansibleApi.ssItems();
      setItems(r.items || []);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { reload(); }, []);

  async function toggleEnabled(item: AnsibleSsItem) {
    setTogglingId(item.id);
    try {
      const r = await ansibleApi.saveSsItem({ ...item, enabled: !item.enabled });
      if (r.ok) setItems(r.items || items.map((i) => (i.id === item.id ? { ...i, enabled: !i.enabled } : i)));
    } catch {
      /* kullanici tekrar deneyebilir */
    } finally {
      setTogglingId(null);
    }
  }

  return (
    <div className="border border-gray-100 rounded-2xl p-4 space-y-2 bg-gray-50/50">
      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Ansible Servis Görünürlüğü</p>
      <p className="text-[11px] text-gray-400">
        Otomasyon &gt; Ansible sekmesinde kullanıcılara hangi servislerin gösterileceğini burada
        açıp kapatabilirsiniz — kapatılan bir servis kullanıcı listesinden kalkar ama kaydı silinmez.
      </p>

      {loading ? (
        <div className="py-4 text-center text-xs text-gray-400">Yükleniyor...</div>
      ) : error ? (
        <div className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-xl px-3 py-2">{error}</div>
      ) : items.length === 0 ? (
        <div className="py-4 text-center text-xs text-gray-400">Henüz Ansible servisi tanımlanmamış.</div>
      ) : (
        <div className="space-y-1.5">
          {[...items].sort((a, b) => a.order - b.order).map((item) => (
            <div key={item.id} className="flex items-center gap-2 bg-white border border-gray-100 rounded-lg px-3 py-1.5">
              <span className="flex-1 text-sm text-gray-700 truncate">{item.title}</span>
              <span className="text-xs text-gray-400">Template #{item.awxTemplateId} · Server {item.awxServerId}</span>
              <button
                onClick={() => toggleEnabled(item)}
                disabled={togglingId === item.id}
                title={item.enabled ? "Kullanıcılara kapat" : "Kullanıcılara aç"}
                className={`text-xs px-2 py-0.5 rounded-full transition disabled:opacity-50 ${
                  item.enabled ? "bg-emerald-50 text-emerald-700 hover:bg-emerald-100" : "bg-gray-100 text-gray-400 hover:bg-gray-200"
                }`}
              >
                {item.enabled ? "kullanıcılara açık" : "kullanıcılara kapalı"}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

// ----- Main component -----
const SelfServiceAdminTab: React.FC = () => {
  const [store, setStore] = useState<SelfServiceStore>(emptyStore);
  const [groups, setGroups] = useState<SelfServiceGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [openTabs, setOpenTabs] = useState<Set<string>>(new Set());
  const [openSubTabs, setOpenSubTabs] = useState<Set<string>>(new Set());

  const [addingTab, setAddingTab] = useState(false);
  const [newTabName, setNewTabName] = useState("");
  const [addingSubTab, setAddingSubTab] = useState<string | null>(null);
  const [newSubTabName, setNewSubTabName] = useState("");
  const [addingItem, setAddingItem] = useState<{ tabId: string; subTabId: string } | null>(null);
  const [editingItem, setEditingItem] = useState<{ tabId: string; subTabId: string; item: SelfServiceItem } | null>(null);

  async function reload() {
    try {
      setLoading(true);
      setError(null);
      const r = await selfServiceApi.get();
      setStore(r.store);
      setGroups(r.groups || []);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { reload(); }, []);

  function toggleTab(id: string) {
    setOpenTabs((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }

  function toggleSubTab(id: string) {
    setOpenSubTabs((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }

  async function createTab() {
    if (!newTabName.trim()) return;
    const r = await selfServiceApi.createTab({ name: newTabName.trim() } as Partial<SelfServiceTab>);
    setStore(r.store);
    setNewTabName("");
    setAddingTab(false);
    setOpenTabs((s) => new Set([...s, r.tab.id]));
  }

  async function deleteTab(tabId: string) {
    if (!confirm("Bu tab ve tüm içeriği silinecek. Devam et?")) return;
    const r = await selfServiceApi.deleteTab(tabId);
    setStore(r.store);
  }

  async function createSubTab(tabId: string) {
    if (!newSubTabName.trim()) return;
    const r = await selfServiceApi.createSubTab(tabId, { name: newSubTabName.trim() } as Partial<SelfServiceSubTab>);
    setStore(r.store);
    setNewSubTabName("");
    setAddingSubTab(null);
    setOpenSubTabs((s) => new Set([...s, r.subTab.id]));
  }

  async function deleteSubTab(tabId: string, subTabId: string) {
    if (!confirm("Bu alt-tab ve tüm öğeleri silinecek. Devam et?")) return;
    const r = await selfServiceApi.deleteSubTab(tabId, subTabId);
    setStore(r.store);
  }

  async function createItem(tabId: string, subTabId: string, data: Partial<SelfServiceItem>) {
    const r = await selfServiceApi.createItem(tabId, subTabId, data);
    setStore(r.store);
    setAddingItem(null);
  }

  async function updateItem(tabId: string, subTabId: string, itemId: string, data: Partial<SelfServiceItem>) {
    const r = await selfServiceApi.updateItem(tabId, subTabId, itemId, data);
    setStore(r.store);
    setEditingItem(null);
  }

  async function deleteItem(tabId: string, subTabId: string, itemId: string) {
    if (!confirm("Bu öğe silinecek. Devam et?")) return;
    const r = await selfServiceApi.deleteItem(tabId, subTabId, itemId);
    setStore(r.store);
  }

  if (loading) return <div className="py-8 text-center text-sm text-gray-400">Yükleniyor...</div>;
  if (error)  return <div className="py-4 text-sm text-red-600 bg-red-50 rounded-xl px-4">{error}</div>;

  const tabs = sortByOrder(store.tabs);

  return (
    <div className="space-y-3">
      <GroupsSection groups={groups} onChange={setGroups} />
      <AnsibleVisibilitySection />

      <div className="flex items-center justify-between mb-2">
        <p className="text-sm text-gray-500">{tabs.length} tab</p>
        <button
          onClick={() => setAddingTab(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-black text-white rounded-xl hover:bg-gray-800 transition"
        >
          <PlusIcon className="w-4 h-4" />
          Yeni Tab
        </button>
      </div>

      {addingTab && (
        <div className="flex gap-2 items-center bg-blue-50 border border-blue-100 rounded-xl px-4 py-3">
          <input
            autoFocus
            value={newTabName}
            onChange={(e) => setNewTabName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") createTab(); if (e.key === "Escape") setAddingTab(false); }}
            placeholder="Tab adı"
            className="flex-1 px-3 py-1.5 text-sm border border-gray-200 rounded-lg outline-none focus:border-blue-400"
          />
          <button onClick={createTab} className="px-3 py-1.5 text-sm bg-black text-white rounded-lg hover:bg-gray-800">Ekle</button>
          <button onClick={() => setAddingTab(false)} className="text-gray-400 hover:text-gray-600"><XMarkIcon className="w-4 h-4" /></button>
        </div>
      )}

      {tabs.map((tab) => {
        const tabOpen = openTabs.has(tab.id);
        const subTabs = sortByOrder(tab.subTabs);

        return (
          <div key={tab.id} className="border border-gray-100 rounded-2xl overflow-hidden">
            <div
              role="button"
              tabIndex={0}
              className="w-full flex items-center gap-3 px-4 py-3 bg-white hover:bg-gray-50 transition-colors text-left cursor-pointer"
              onClick={() => toggleTab(tab.id)}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggleTab(tab.id); } }}
            >
              <ChevronDownIcon
                className={`w-4 h-4 text-gray-400 transition-transform duration-300 ${tabOpen ? "rotate-0" : "-rotate-90"}`}
              />
              {tabOpen
                ? <FolderOpenIcon className="w-4 h-4 text-blue-500 flex-shrink-0" />
                : <FolderIcon className="w-4 h-4 text-gray-400 flex-shrink-0" />}
              <span className="flex-1 text-sm font-semibold text-gray-800">
                <InlineEdit
                  value={tab.name}
                  onSave={async (v) => { const r = await selfServiceApi.updateTab(tab.id, { name: v } as Partial<SelfServiceTab>); setStore(r.store); }}
                />
              </span>
              <span className="text-xs text-gray-400">{subTabs.length} alt-tab</span>
              <button
                onClick={(e) => { e.stopPropagation(); deleteTab(tab.id); }}
                className="ml-2 p-1 text-gray-300 hover:text-red-500 rounded transition-colors"
              >
                <TrashIcon className="w-3.5 h-3.5" />
              </button>
            </div>

            <Collapse open={tabOpen}>
              <div className="bg-gray-50 border-t border-gray-100 px-4 py-3 space-y-2">
                {subTabs.map((sub) => {
                  const subOpen = openSubTabs.has(sub.id);
                  const items = sortByOrder(sub.items);

                  return (
                    <div key={sub.id} className="border border-gray-200 rounded-xl bg-white overflow-hidden">
                      <div
                        role="button"
                        tabIndex={0}
                        className="w-full flex items-center gap-2 px-3 py-2.5 hover:bg-gray-50 transition-colors text-left cursor-pointer"
                        onClick={() => toggleSubTab(sub.id)}
                        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggleSubTab(sub.id); } }}
                      >
                        <ChevronDownIcon
                          className={`w-3.5 h-3.5 text-gray-400 transition-transform duration-300 ${subOpen ? "rotate-0" : "-rotate-90"}`}
                        />
                        <span className="flex-1 text-sm font-medium text-gray-700">
                          <InlineEdit
                            value={sub.name}
                            onSave={async (v) => { const r = await selfServiceApi.updateSubTab(tab.id, sub.id, { name: v } as Partial<SelfServiceSubTab>); setStore(r.store); }}
                          />
                        </span>
                        <span className="text-xs text-gray-400">{items.length} öğe</span>
                        <button
                          onClick={(e) => { e.stopPropagation(); deleteSubTab(tab.id, sub.id); }}
                          className="ml-1 p-1 text-gray-300 hover:text-red-500 rounded transition-colors"
                        >
                          <TrashIcon className="w-3 h-3" />
                        </button>
                      </div>

                      <Collapse open={subOpen}>
                        <div className="border-t border-gray-100 px-3 py-2 space-y-1.5">
                          {items.map((item) => (
                            <div key={item.id}>
                              {editingItem?.item.id === item.id ? (
                                <ItemForm
                                  initial={item}
                                  onSave={(data) => updateItem(tab.id, sub.id, item.id, data)}
                                  onCancel={() => setEditingItem(null)}
                                />
                              ) : (
                                <div className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-gray-50 transition-colors group">
                                  <DocumentTextIcon className="w-3.5 h-3.5 text-gray-300 flex-shrink-0" />
                                  <span className="flex-1 text-sm text-gray-700 truncate">{item.title}</span>
                                  {item.goUrl && (
                                    <span className="text-xs text-gray-400 truncate max-w-[160px]" title={item.goUrl}>
                                      {item.goUrl}
                                    </span>
                                  )}
                                  <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                    <button
                                      onClick={() => setEditingItem({ tabId: tab.id, subTabId: sub.id, item })}
                                      className="p-1 text-gray-400 hover:text-blue-500 rounded"
                                    >
                                      <PencilIcon className="w-3 h-3" />
                                    </button>
                                    <button
                                      onClick={() => deleteItem(tab.id, sub.id, item.id)}
                                      className="p-1 text-gray-400 hover:text-red-500 rounded"
                                    >
                                      <TrashIcon className="w-3 h-3" />
                                    </button>
                                  </div>
                                </div>
                              )}
                            </div>
                          ))}

                          {addingItem?.tabId === tab.id && addingItem?.subTabId === sub.id ? (
                            <ItemForm
                              onSave={(data) => createItem(tab.id, sub.id, data)}
                              onCancel={() => setAddingItem(null)}
                            />
                          ) : (
                            <button
                              onClick={() => setAddingItem({ tabId: tab.id, subTabId: sub.id })}
                              className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-blue-600 px-2 py-1 rounded-lg hover:bg-blue-50 transition-colors w-full"
                            >
                              <PlusIcon className="w-3 h-3" />
                              Öğe ekle
                            </button>
                          )}
                        </div>
                      </Collapse>
                    </div>
                  );
                })}

                {addingSubTab === tab.id ? (
                  <div className="flex gap-2 items-center bg-white border border-gray-200 rounded-xl px-3 py-2">
                    <input
                      autoFocus
                      value={newSubTabName}
                      onChange={(e) => setNewSubTabName(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") createSubTab(tab.id); if (e.key === "Escape") setAddingSubTab(null); }}
                      placeholder="Alt-tab adı"
                      className="flex-1 text-sm outline-none"
                    />
                    <button onClick={() => createSubTab(tab.id)} className="text-green-600"><CheckIcon className="w-4 h-4" /></button>
                    <button onClick={() => setAddingSubTab(null)} className="text-gray-400"><XMarkIcon className="w-4 h-4" /></button>
                  </div>
                ) : (
                  <button
                    onClick={() => { setAddingSubTab(tab.id); setNewSubTabName(""); }}
                    className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-blue-600 px-2 py-1 rounded-lg hover:bg-blue-50 transition-colors"
                  >
                    <PlusIcon className="w-3 h-3" />
                    Alt-tab ekle
                  </button>
                )}
              </div>
            </Collapse>
          </div>
        );
      })}

      {tabs.length === 0 && !addingTab && (
        <div className="py-10 text-center text-sm text-gray-400">
          Henüz servis tanımlanmamış.
          <button onClick={() => setAddingTab(true)} className="ml-2 text-blue-600 underline">İlk tab'ı ekle</button>
        </div>
      )}
    </div>
  );
};

export default SelfServiceAdminTab;
