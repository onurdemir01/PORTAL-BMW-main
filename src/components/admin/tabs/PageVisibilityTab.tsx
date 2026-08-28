// src/components/admin/tabs/PageVisibilityTab.tsx — Dinamik görünürlük/modülerlik yönetimi.
//
// Tek gerçek kaynak backend `portal_elements` + `portal_element_visibility` (bkz.
// server/auth/elements.cjs, visibility.cjs). Bu ekran öğe ağacını (sayfa → alt-tab/admin-tab)
// gösterir; her öğe için: global kill-switch (enabled), "User rolü görebilir" ve kullanıcı-bazlı
// override'lar. Admin HER enabled öğeyi görür (motor kuralı) — bu yüzden rol kontrolü yalnızca
// User içindir; global kapatma (kill-switch) admin dahil herkesi kapatır. Yeni öğe eklenebilir /
// silinebilir (dinamik "her şeyi ekle/çıkar"). Kaydetme sonrası değişiklik ANINDA yansır.
import React, { useEffect, useMemo, useState } from "react";
import { elementsApi, type PortalElement, type ElementRule } from "@/api/adminApi";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/useToast";
import { Select } from "@/components/ui/Form";
import { CheckIcon, TrashIcon, PlusIcon, ChevronRightIcon, QuestionMarkCircleIcon, XMarkIcon } from "@heroicons/react/24/outline";

interface Editable {
  enabled: boolean;
  userVisible: boolean;                                   // 'User' rol kuralı (allow)
  overrides: { username: string; allow: boolean }[];      // kullanıcı-bazlı override'lar
  defaultVisible: boolean;
}

function deriveEditable(el: PortalElement, rules: ElementRule[]): Editable {
  const userRule = rules.find((r) => r.elementKey === el.key && r.principalType === "role" && r.principalId === "User");
  const overrides = rules
    .filter((r) => r.elementKey === el.key && r.principalType === "user")
    .map((r) => ({ username: r.principalId, allow: r.allow }));
  return {
    enabled: el.enabled,
    userVisible: userRule ? userRule.allow : el.defaultVisible,
    overrides,
    defaultVisible: el.defaultVisible,
  };
}

export default function PageVisibilityTab() {
  const { toast } = useToast();
  const { refreshVisibility } = useAuth();
  const [elements, setElements] = useState<PortalElement[]>([]);
  const [edit, setEdit] = useState<Record<string, Editable>>({});
  const [dirty, setDirty] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [allRules, setAllRules] = useState<ElementRule[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [adding, setAdding] = useState(false);
  const [newEl, setNewEl] = useState({ key: "", type: "button", label: "", parentKey: "", description: "" });
  const [showHelp, setShowHelp] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const { elements, rules } = await elementsApi.list();
      setElements(elements);
      setAllRules(rules);   // saveAll bu ekranın YÖNETMEDİĞİ kuralları koruyabilsin diye
      const map: Record<string, Editable> = {};
      for (const el of elements) map[el.key] = deriveEditable(el, rules);
      setEdit(map);
      setDirty(new Set());
    } catch (e) {
      toast.error((e as Error).message || "Elementler yüklenemedi.");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function markDirty(key: string) { setDirty((p) => new Set(p).add(key)); }
  function patch(key: string, p: Partial<Editable>) {
    setEdit((prev) => ({ ...prev, [key]: { ...prev[key], ...p } }));
    markDirty(key);
  }
  function toggleExpand(key: string) {
    setExpanded((p) => { const n = new Set(p); n.has(key) ? n.delete(key) : n.add(key); return n; });
  }

  // Ağaç: kök = sayfalar (type=page) + ebeveynsiz diğer öğeler; her kökün altında parent_key ile
  // eşleşen çocuklar (alt-tab, admin-tab, buton...).
  const { roots, childrenOf } = useMemo(() => {
    const childrenOf: Record<string, PortalElement[]> = {};
    const rootList: PortalElement[] = [];
    for (const el of elements) {
      if (el.parentKey) (childrenOf[el.parentKey] ||= []).push(el);
      else rootList.push(el);
    }
    return { roots: rootList, childrenOf };
  }, [elements]);

  async function saveAll() {
    setSaving(true);
    try {
      for (const key of dirty) {
        const e = edit[key];
        if (!e) continue;
        await elementsApi.setEnabled(key, e.enabled);
        // setRules ilgili elementin TÜM kurallarını silip yenisini yazar. Bu ekran yalnız
        // "User" rol kuralını ve kullanıcı override'larını yönetir; bu yüzden DOKUNMADIĞIMIZ
        // diğer principal'lar (ör. seed'den gelen "Admin" rol kuralı veya ileride eklenecek
        // başka roller) korunarak yeniden gönderilir — aksi halde her kayıtta sessizce
        // siliniyorlardı.
        const preserved = allRules
          .filter((r) => r.elementKey === key)
          .filter((r) => !(r.principalType === "role" && r.principalId === "User"))
          .filter((r) => r.principalType !== "user")
          .map((r) => ({ principalType: r.principalType, principalId: r.principalId, allow: r.allow }));
        const nextRules = [
          ...preserved,
          { principalType: "role" as const, principalId: "User", allow: e.userVisible },
          ...e.overrides
            .filter((o) => o.username.trim())
            .map((o) => ({ principalType: "user" as const, principalId: o.username.trim(), allow: o.allow })),
        ];
        await elementsApi.setRules(key, nextRules);
      }
      await refreshVisibility();
      toast.success("Görünürlük kaydedildi — anında yansıdı.");
      setDirty(new Set());
    } catch (e) {
      toast.error((e as Error).message || "Kaydedilemedi.");
    } finally {
      setSaving(false);
    }
  }

  async function createElement() {
    if (!newEl.key.trim()) { toast.error("element_key gerekli."); return; }
    try {
      await elementsApi.create({
        key: newEl.key.trim(), type: newEl.type, label: newEl.label.trim() || newEl.key.trim(),
        parentKey: newEl.parentKey.trim() || null, enabled: true, defaultVisible: true,
        description: newEl.description.trim() || null,
      });
      toast.success("Element eklendi.");
      setAdding(false);
      setNewEl({ key: "", type: "button", label: "", parentKey: "", description: "" });
      await load();
      await refreshVisibility();
    } catch (e) {
      toast.error((e as Error).message || "Eklenemedi.");
    }
  }

  async function removeElement(key: string) {
    if (!window.confirm(`"${key}" öğesini ve tüm görünürlük kurallarını silmek istiyor musunuz?`)) return;
    try {
      await elementsApi.remove(key);
      toast.success("Element silindi.");
      await load();
      await refreshVisibility();
    } catch (e) {
      toast.error((e as Error).message || "Silinemedi.");
    }
  }

  if (loading) return <div className="text-sm text-gray-400 text-center py-8">Yükleniyor…</div>;

  const renderRow = (el: PortalElement, depth: number) => {
    const e = edit[el.key];
    if (!e) return null;
    const kids = childrenOf[el.key] || [];
    const isExpanded = expanded.has(el.key);
    return (
      <React.Fragment key={el.key}>
        <tr className="hover:bg-gray-50/50 border-b border-gray-50">
          <td className="px-3 py-2.5" style={{ paddingLeft: `${12 + depth * 20}px` }}>
            <div className="flex items-center gap-1.5">
              {kids.length > 0 ? (
                <button onClick={() => toggleExpand(el.key)} className="text-gray-400 hover:text-gray-600">
                  <ChevronRightIcon className={`h-3.5 w-3.5 transition-transform ${isExpanded ? "rotate-90" : ""}`} />
                </button>
              ) : <span className="w-3.5" />}
              <span className="font-medium text-gray-700">{el.label || el.key}</span>
              <code className="text-[10px] text-gray-400">{el.key}</code>
              <span className="text-[10px] px-1.5 rounded bg-gray-100 text-gray-500">{el.type}</span>
              {el.description && <span className="text-[10px] text-gray-400 italic truncate max-w-[240px]" title={el.description}>{el.description}</span>}
            </div>
          </td>
          {/* Kill-switch */}
          <td className="px-3 py-2.5 text-center">
            <button
              onClick={() => patch(el.key, { enabled: !e.enabled })}
              className={`w-6 h-6 rounded border-2 flex items-center justify-center mx-auto transition-colors ${
                e.enabled ? "bg-emerald-600 border-emerald-600 text-white" : "border-gray-200 hover:border-emerald-300"
              }`}
              title={e.enabled ? "Aktif — kapatmak için tıkla (herkese, admin dahil, kapanır)" : "Kapalı — açmak için tıkla"}
            >
              {e.enabled && <CheckIcon className="h-3.5 w-3.5" />}
            </button>
          </td>
          {/* User görebilir */}
          <td className="px-3 py-2.5 text-center">
            <button
              onClick={() => patch(el.key, { userVisible: !e.userVisible })}
              disabled={!e.enabled}
              className={`w-6 h-6 rounded border-2 flex items-center justify-center mx-auto transition-colors disabled:opacity-30 ${
                e.userVisible ? "bg-blue-600 border-blue-600 text-white" : "border-gray-200 hover:border-blue-300"
              }`}
              title="User rolü bu öğeyi görebilir mi (Admin her zaman görür)"
            >
              {e.userVisible && <CheckIcon className="h-3.5 w-3.5" />}
            </button>
          </td>
          {/* Override sayısı + sil */}
          <td className="px-3 py-2.5 text-center">
            <button onClick={() => toggleExpand(el.key)} className="text-xs text-gray-500 hover:text-blue-600">
              {e.overrides.length > 0 ? `${e.overrides.length} kullanıcı override` : "override ekle"}
            </button>
          </td>
          <td className="px-3 py-2.5 text-center">
            <button onClick={() => removeElement(el.key)} className="text-gray-300 hover:text-red-500" title="Elementi sil">
              <TrashIcon className="h-4 w-4 mx-auto" />
            </button>
          </td>
        </tr>
        {isExpanded && (
          <tr className="bg-gray-50/40">
            <td colSpan={5} className="px-3 py-3" style={{ paddingLeft: `${32 + depth * 20}px` }}>
              <OverrideEditor
                overrides={e.overrides}
                onChange={(overrides) => patch(el.key, { overrides })}
              />
            </td>
          </tr>
        )}
        {isExpanded && kids.map((k) => renderRow(k, depth + 1))}
      </React.Fragment>
    );
  };

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-gray-800 mb-1">Görünürlük & Modüller</h3>
          <p className="text-xs text-gray-500 max-w-2xl">
            Her sayfa/tab/buton için: <b>Aktif</b> = global kill-switch (kapatınca <i>admin dahil</i> hiçbir
            yerde görünmez), <b>User görür</b> = User rolü görebilir mi (Admin her zaman görür), ve
            kullanıcı-bazlı override. Değişiklikler kaydedilince <b>anında</b> yansır (reload gerekmez).
          </p>
        </div>
        <div className="flex gap-2 flex-shrink-0">
          <button
            onClick={() => setShowHelp(true)}
            className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg border border-gray-200 text-gray-600 hover:border-gray-300 transition-colors"
          >
            <QuestionMarkCircleIcon className="h-4 w-4" /> Yardım
          </button>
          <button
            onClick={() => setAdding((v) => !v)}
            className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg border border-gray-200 text-gray-600 hover:border-blue-300 hover:text-blue-600 transition-colors"
          >
            <PlusIcon className="h-4 w-4" /> Yeni Element
          </button>
        </div>
      </div>

      {showHelp && <VisibilityHelpModal onClose={() => setShowHelp(false)} />}

      {adding && (
        <div className="border border-blue-100 bg-blue-50/40 rounded-xl p-3 grid grid-cols-2 md:grid-cols-4 gap-2 items-end">
          <label className="text-xs text-gray-600 space-y-1">
            <span>element_key *</span>
            <input value={newEl.key} onChange={(e) => setNewEl({ ...newEl, key: e.target.value })}
              placeholder="btn:logx:cancel" className="w-full text-xs border border-gray-200 rounded-lg px-2 py-1.5 font-mono" />
          </label>
          <label className="text-xs text-gray-600 space-y-1">
            <span>tip</span>
            <Select sizeVariant="sm" value={newEl.type} onChange={(e) => setNewEl({ ...newEl, type: e.target.value })}>
              {["page", "tab", "button", "admin_tab", "feature", "nav_group", "mcp", "awx"].map((t) => <option key={t}>{t}</option>)}
            </Select>
          </label>
          <label className="text-xs text-gray-600 space-y-1">
            <span>etiket</span>
            <input value={newEl.label} onChange={(e) => setNewEl({ ...newEl, label: e.target.value })}
              className="w-full text-xs border border-gray-200 rounded-lg px-2 py-1.5" />
          </label>
          <div className="flex gap-2">
            <input value={newEl.parentKey} onChange={(e) => setNewEl({ ...newEl, parentKey: e.target.value })}
              placeholder="parent_key (ops.)" className="flex-1 text-xs border border-gray-200 rounded-lg px-2 py-1.5 font-mono" />
          </div>
          <label className="text-xs text-gray-600 space-y-1 col-span-2 md:col-span-3">
            <span>açıklama (ops. — bu öğe ne işe yarar)</span>
            <input value={newEl.description} onChange={(e) => setNewEl({ ...newEl, description: e.target.value })}
              className="w-full text-xs border border-gray-200 rounded-lg px-2 py-1.5" />
          </label>
          <button onClick={createElement} className="px-3 py-1.5 bg-blue-600 text-white text-xs font-medium rounded-lg hover:bg-blue-700 h-fit">Ekle</button>
        </div>
      )}

      <div className="border border-gray-100 rounded-xl overflow-hidden">
        <table className="w-full text-sm pf-table-sticky">
          <thead className="bg-gray-50 border-b border-gray-100">
            <tr>
              <th className="text-left px-3 py-2.5 text-xs font-semibold text-gray-500">Öğe</th>
              <th className="px-3 py-2.5 text-center text-xs font-semibold text-gray-500">Aktif</th>
              <th className="px-3 py-2.5 text-center text-xs font-semibold text-gray-500">User görür</th>
              <th className="px-3 py-2.5 text-center text-xs font-semibold text-gray-500">Kullanıcı override</th>
              <th className="px-3 py-2.5 text-center text-xs font-semibold text-gray-500"></th>
            </tr>
          </thead>
          <tbody>
            {roots.map((el) => renderRow(el, 0))}
          </tbody>
        </table>
      </div>

      <div className="flex justify-end">
        <button
          onClick={saveAll}
          disabled={saving || dirty.size === 0}
          className="px-5 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
        >
          {saving ? "Kaydediliyor…" : dirty.size > 0 ? `Kaydet (${dirty.size})` : "Kaydet"}
        </button>
      </div>
    </div>
  );
}

// actions.md #16 — YENİ yardım/dokümantasyon özelliği. İçerik tamamen statik (bu, DB'de
// tutulması gereken "iş verisi" değil, salt-okunur dokümantasyondur) — 3 örnek dummy tablo +
// düzyazı açıklama.
function VisibilityHelpModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/30 py-8 px-4">
      <div className="bg-white rounded-2xl shadow-xl max-w-3xl w-full p-6 space-y-6">
        <div className="flex items-start justify-between">
          <h3 className="text-base font-semibold text-gray-800">Görünürlük & Modüller — Nasıl Çalışır?</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700"><XMarkIcon className="h-5 w-5" /></button>
        </div>

        <div className="space-y-3 text-sm text-gray-700 leading-relaxed">
          <p><b>Aktif (kill-switch):</b> Kapatılırsa bu öğe <i>admin dahil</i> hiç kimseye görünmez. Bir modülü tamamen devre dışı bırakmak için kullanılır (ör. bakım sırasında).</p>
          <p><b>User görür:</b> "User" rolündeki kullanıcıların bu öğeyi görüp göremeyeceğini belirler. Admin rolü, öğe Aktif olduğu sürece HER ZAMAN görür — bu kural Admin'i etkilemez.</p>
          <p><b>Kullanıcı override:</b> Belirli bir kullanıcı için rol kuralının üzerine yazar. "allow" değeri true ise o kullanıcı rol kuralı ne olursa olsun görür; false ise rol kuralı ne olursa olsun görmez.</p>
          <p><b>Üst-alt (parent-child) ilişkisi:</b> Bir sayfa (page) kapatılırsa, altındaki tüm tab/buton/admin_tab öğeleri de otomatik olarak görünmez olur — alt öğeleri tek tek kapatmaya gerek yoktur.</p>
          <p><b>Değişikliklerin yansıması:</b> "Kaydet" tıklandığı an tüm açık oturumlarda anında geçerli olur (sayfa yenilemesi/yeniden giriş gerekmez) — motor bir versiyon sayacı tutar, istemciler bunu düzenli kontrol eder.</p>
          <p><b>Yeni element nasıl eklenir:</b> "Yeni Element" ile bir element_key + tip (page/tab/button/admin_tab/feature/nav_group) tanımlanır. parent_key opsiyoneldir — bir sayfanın altına bağlamak için o sayfanın element_key'i girilir.</p>
          <p><b>element_key nasıl belirlenir:</b> Sayfalar için sade isim (ör. <code>Dashboard</code>), alt-öğeler için <code>tip:sayfa:isim</code> deseni önerilir (ör. <code>btn:logx:cancel</code>, <code>admintab:users</code>) — kod tarafında bu anahtarla eşleştiği için oluşturulduktan sonra değiştirilmemelidir.</p>
        </div>

        <div className="space-y-4">
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Örnek: Element tablosu (portal_elements)</p>
            <div className="overflow-x-auto rounded-lg border border-gray-100">
              <table className="w-full text-xs pf-table-sticky">
                <thead><tr className="bg-gray-50 text-left text-gray-500">
                  <th className="px-2 py-1.5">element_key</th><th className="px-2 py-1.5">type</th>
                  <th className="px-2 py-1.5">parent_key</th><th className="px-2 py-1.5">enabled</th><th className="px-2 py-1.5">default_visible</th>
                </tr></thead>
                <tbody className="divide-y divide-gray-50 font-mono">
                  <tr><td className="px-2 py-1.5">LogX</td><td className="px-2 py-1.5">page</td><td className="px-2 py-1.5">—</td><td className="px-2 py-1.5">1</td><td className="px-2 py-1.5">1</td></tr>
                  <tr><td className="px-2 py-1.5">admintab:users</td><td className="px-2 py-1.5">admin_tab</td><td className="px-2 py-1.5">Admin</td><td className="px-2 py-1.5">1</td><td className="px-2 py-1.5">0</td></tr>
                  <tr><td className="px-2 py-1.5">btn:logx:cancel</td><td className="px-2 py-1.5">button</td><td className="px-2 py-1.5">LogX</td><td className="px-2 py-1.5">0</td><td className="px-2 py-1.5">1</td></tr>
                </tbody>
              </table>
            </div>
          </div>

          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Örnek: Kullanıcı-bazlı override (portal_element_visibility, principal_type=user)</p>
            <div className="overflow-x-auto rounded-lg border border-gray-100">
              <table className="w-full text-xs pf-table-sticky">
                <thead><tr className="bg-gray-50 text-left text-gray-500">
                  <th className="px-2 py-1.5">element_key</th><th className="px-2 py-1.5">principal_id (kullanıcı)</th><th className="px-2 py-1.5">allow</th>
                </tr></thead>
                <tbody className="divide-y divide-gray-50 font-mono">
                  <tr><td className="px-2 py-1.5">LogX</td><td className="px-2 py-1.5">ahmet.yilmaz</td><td className="px-2 py-1.5">0 (gizli)</td></tr>
                  <tr><td className="px-2 py-1.5">btn:logx:cancel</td><td className="px-2 py-1.5">mehmet.demir</td><td className="px-2 py-1.5">1 (görür)</td></tr>
                </tbody>
              </table>
            </div>
          </div>

          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Örnek: Rol-bazlı kural (portal_element_visibility, principal_type=role)</p>
            <div className="overflow-x-auto rounded-lg border border-gray-100">
              <table className="w-full text-xs pf-table-sticky">
                <thead><tr className="bg-gray-50 text-left text-gray-500">
                  <th className="px-2 py-1.5">element_key</th><th className="px-2 py-1.5">principal_id (rol)</th><th className="px-2 py-1.5">allow</th>
                </tr></thead>
                <tbody className="divide-y divide-gray-50 font-mono">
                  <tr><td className="px-2 py-1.5">LogX</td><td className="px-2 py-1.5">User</td><td className="px-2 py-1.5">1 (görür)</td></tr>
                  <tr><td className="px-2 py-1.5">admintab:users</td><td className="px-2 py-1.5">User</td><td className="px-2 py-1.5">0 (görmez)</td></tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div className="flex justify-end">
          <button onClick={onClose} className="px-4 py-2 text-xs font-medium bg-gray-900 text-white rounded-lg hover:bg-gray-800">Kapat</button>
        </div>
      </div>
    </div>
  );
}

// Kullanıcı-bazlı override mini editörü — username + görünür/gizli.
function OverrideEditor({
  overrides, onChange,
}: {
  overrides: { username: string; allow: boolean }[];
  onChange: (o: { username: string; allow: boolean }[]) => void;
}) {
  const [username, setUsername] = useState("");
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {overrides.map((o, i) => (
          <span key={i} className="inline-flex items-center gap-1.5 text-xs bg-white border border-gray-200 rounded-full pl-2.5 pr-1 py-1">
            <code>{o.username}</code>
            <button
              onClick={() => onChange(overrides.map((x, j) => j === i ? { ...x, allow: !x.allow } : x))}
              className={`text-[10px] px-1.5 py-0.5 rounded-full ${o.allow ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"}`}
            >
              {o.allow ? "görür" : "gizli"}
            </button>
            <button onClick={() => onChange(overrides.filter((_, j) => j !== i))} className="text-gray-300 hover:text-red-500">
              <TrashIcon className="h-3 w-3" />
            </button>
          </span>
        ))}
      </div>
      <div className="flex gap-2">
        <input
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="kullanıcı adı"
          className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 font-mono"
        />
        <button
          onClick={() => { if (username.trim()) { onChange([...overrides, { username: username.trim(), allow: false }]); setUsername(""); } }}
          className="px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg hover:border-blue-300 hover:text-blue-600"
        >
          + gizle (override)
        </button>
      </div>
    </div>
  );
}
