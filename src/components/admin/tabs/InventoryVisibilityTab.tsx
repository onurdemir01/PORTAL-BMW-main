// src/components/admin/tabs/InventoryVisibilityTab.tsx — actions.md #12 (Bölüm K):
// Kullanıcı Tablo Görünürlüğü. Eskiden yalnızca 2 satırlık (rol → CSV liste) bir model
// SystemConfigTab içinde yaşıyordu; artık HER tabloya bir satır (aktif/pasif/sıra/açıklama),
// kullanıcı-bazlı override ve kolon-seviyesi görünürlük için ayrı bir yönetim ekranı.
// Rol-bazlı ("User görür mü") ayar hâlâ SystemConfigTab'de kalır (backend uyumluluğu
// korunuyor) — bu ekran onun ÜZERİNE inşa edilen ince taneli katmanları yönetir.
import React, { useEffect, useState } from "react";
import { PencilSquareIcon, PlusIcon, TrashIcon, TableCellsIcon, UsersIcon, EyeSlashIcon } from "@heroicons/react/24/outline";
import { inventoryApi, type TableVisibilityRow, type TableUserOverride } from "@/api/inventoryApi";
import { toast } from "@/hooks/useToast";
import { Select } from "@/components/ui/Form";

export default function InventoryVisibilityTab() {
  const [tables, setTables] = useState<TableVisibilityRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [editId, setEditId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState<{ displayName: string; description: string; sortOrder: string }>({ displayName: "", description: "", sortOrder: "0" });
  const [detailId, setDetailId] = useState<number | null>(null);
  const [detailTab, setDetailTab] = useState<"overrides" | "columns">("overrides");

  async function reload() {
    setLoading(true);
    try {
      const r = await inventoryApi.tableVisibilityList();
      setTables(r.tables || []);
    } catch {
      toast.error("Tablolar yüklenemedi.");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { reload(); }, []);

  async function toggleActive(row: TableVisibilityRow) {
    try {
      await inventoryApi.updateTableVisibility(row.id, {
        isActive: !row.isActive, displayName: row.displayName || undefined,
        description: row.description || undefined, sortOrder: row.sortOrder,
      });
      setTables((prev) => prev.map((t) => (t.id === row.id ? { ...t, isActive: !t.isActive } : t)));
    } catch {
      toast.error("Güncellenemedi.");
    }
  }

  function openEdit(row: TableVisibilityRow) {
    setEditId(row.id);
    setEditForm({ displayName: row.displayName || "", description: row.description || "", sortOrder: String(row.sortOrder) });
  }

  async function saveEdit(row: TableVisibilityRow) {
    try {
      await inventoryApi.updateTableVisibility(row.id, {
        isActive: row.isActive, displayName: editForm.displayName.trim() || undefined,
        description: editForm.description.trim() || undefined, sortOrder: Number(editForm.sortOrder) || 0,
      });
      setTables((prev) => prev.map((t) => (t.id === row.id
        ? { ...t, displayName: editForm.displayName.trim() || null, description: editForm.description.trim() || null, sortOrder: Number(editForm.sortOrder) || 0 }
        : t)));
      setEditId(null);
      toast.success("Kaydedildi.");
    } catch {
      toast.error("Kaydedilemedi.");
    }
  }

  if (loading) return <div className="py-8 text-center text-sm text-gray-400">Yükleniyor…</div>;

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-gray-800 mb-1">Envanter Tablo Görünürlüğü</h3>
        <p className="text-xs text-gray-500 max-w-2xl">
          Her fiziksel tablo için ayrı bir kayıt: aktif/pasif (Pasif bir tablo hiç kimseye —
          "*" rolüne sahip kullanıcılara bile — görünmez), sıralama, açıklama. Rol-bazlı temel
          görünürlük (User/Admin) Admin &gt; Sistem sekmesinde kalır; buradaki "Detay" ile her
          tablo için kullanıcı-bazlı istisna ve kolon-seviyesi gizleme yönetilir.
        </p>
      </div>

      <div className="overflow-x-auto rounded-xl border border-gray-100">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-100 text-left">
              <th className="px-3 py-2 text-xs font-semibold text-gray-500">Aktif</th>
              <th className="px-3 py-2 text-xs font-semibold text-gray-500">Tablo</th>
              <th className="px-3 py-2 text-xs font-semibold text-gray-500">Görünen Ad / Açıklama</th>
              <th className="px-3 py-2 text-xs font-semibold text-gray-500">Sıra</th>
              <th className="px-3 py-2 text-xs font-semibold text-gray-500">Override</th>
              <th className="px-3 py-2 text-xs font-semibold text-gray-500" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {tables.map((row) => (
              <React.Fragment key={row.id}>
                <tr className="hover:bg-gray-50/50">
                  <td className="px-3 py-2">
                    <button
                      onClick={() => toggleActive(row)}
                      className={`w-6 h-6 rounded border-2 flex items-center justify-center transition-colors ${row.isActive ? "bg-emerald-600 border-emerald-600 text-white" : "border-gray-200"}`}
                      title={row.isActive ? "Pasif yap (herkesten gizler)" : "Aktif yap"}
                    >
                      {row.isActive && <span className="text-xs">✓</span>}
                    </button>
                  </td>
                  <td className="px-3 py-2 font-mono text-xs text-gray-700">{row.tableName}</td>
                  <td className="px-3 py-2">
                    {editId === row.id ? (
                      <div className="flex flex-col gap-1">
                        <input value={editForm.displayName} onChange={(e) => setEditForm((f) => ({ ...f, displayName: e.target.value }))}
                          placeholder="Görünen ad" className="px-2 py-1 text-xs border border-gray-200 rounded-lg" />
                        <input value={editForm.description} onChange={(e) => setEditForm((f) => ({ ...f, description: e.target.value }))}
                          placeholder="Açıklama" className="px-2 py-1 text-xs border border-gray-200 rounded-lg" />
                      </div>
                    ) : (
                      <div>
                        <div className="text-xs text-gray-700">{row.displayName || <span className="text-gray-300 italic">isim yok</span>}</div>
                        {row.description && <div className="text-[11px] text-gray-400">{row.description}</div>}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {editId === row.id ? (
                      <input type="number" value={editForm.sortOrder} onChange={(e) => setEditForm((f) => ({ ...f, sortOrder: e.target.value }))}
                        className="w-16 px-2 py-1 text-xs border border-gray-200 rounded-lg" />
                    ) : (
                      <span className="text-xs text-gray-500">{row.sortOrder}</span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {row.overrideCount > 0
                      ? <span className="text-xs px-1.5 py-0.5 rounded-full bg-blue-50 text-blue-700">{row.overrideCount} kullanıcı</span>
                      : <span className="text-xs text-gray-300">—</span>}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-1 justify-end">
                      {editId === row.id ? (
                        <>
                          <button onClick={() => saveEdit(row)} className="text-xs text-emerald-600 hover:underline">Kaydet</button>
                          <button onClick={() => setEditId(null)} className="text-xs text-gray-400 hover:underline ml-1">Vazgeç</button>
                        </>
                      ) : (
                        <>
                          <button onClick={() => openEdit(row)} className="p-1 text-gray-400 hover:text-blue-500" title="Düzenle">
                            <PencilSquareIcon className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => { setDetailId(detailId === row.id ? null : row.id); setDetailTab("overrides"); }}
                            className="p-1 text-gray-400 hover:text-blue-500" title="Kullanıcı override / kolon görünürlüğü"
                          >
                            <TableCellsIcon className="w-4 h-4" />
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
                {detailId === row.id && (
                  <tr className="bg-gray-50/40">
                    <td colSpan={6} className="px-4 py-3">
                      <TableDetailPanel tableVisibilityId={row.id} tab={detailTab} setTab={setDetailTab} />
                    </td>
                  </tr>
                )}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function TableDetailPanel({
  tableVisibilityId, tab, setTab,
}: { tableVisibilityId: number; tab: "overrides" | "columns"; setTab: (t: "overrides" | "columns") => void }) {
  return (
    <div className="space-y-3">
      <div className="flex gap-1 rounded-lg p-1 bg-white border border-gray-100 w-fit">
        <button onClick={() => setTab("overrides")}
          className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md ${tab === "overrides" ? "bg-gray-100 text-black" : "text-gray-500"}`}>
          <UsersIcon className="w-3.5 h-3.5" /> Kullanıcı Override
        </button>
        <button onClick={() => setTab("columns")}
          className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md ${tab === "columns" ? "bg-gray-100 text-black" : "text-gray-500"}`}>
          <EyeSlashIcon className="w-3.5 h-3.5" /> Kolon Görünürlüğü
        </button>
      </div>
      {tab === "overrides" ? <UserOverridesSection tableVisibilityId={tableVisibilityId} /> : <ColumnVisibilitySection tableVisibilityId={tableVisibilityId} />}
    </div>
  );
}

function UserOverridesSection({ tableVisibilityId }: { tableVisibilityId: number }) {
  const [overrides, setOverrides] = useState<TableUserOverride[]>([]);
  const [loading, setLoading] = useState(true);
  const [username, setUsername] = useState("");
  const [overrideType, setOverrideType] = useState<"allow" | "deny">("allow");

  async function load() {
    setLoading(true);
    try {
      const r = await inventoryApi.listTableUserOverrides(tableVisibilityId);
      setOverrides(r.overrides || []);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, [tableVisibilityId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function add() {
    if (!username.trim()) return;
    try {
      await inventoryApi.addTableUserOverride(tableVisibilityId, username.trim(), overrideType);
      setUsername("");
      await load();
      toast.success("Override eklendi.");
    } catch {
      toast.error("Eklenemedi.");
    }
  }

  async function remove(u: string) {
    try {
      await inventoryApi.removeTableUserOverride(tableVisibilityId, u);
      await load();
    } catch {
      toast.error("Silinemedi.");
    }
  }

  if (loading) return <div className="text-xs text-gray-400 py-2">Yükleniyor…</div>;

  return (
    <div className="space-y-2">
      <p className="text-[11px] text-gray-400">
        "allow" rol kuralının üstüne geçip tabloyu AÇAR (o kullanıcı rolü görmese bile). "deny"
        rol kuralının üstüne geçip tabloyu KAPATIR (rolü görse bile o kullanıcıdan gizler).
      </p>
      <div className="flex gap-2 items-center">
        <input value={username} onChange={(e) => setUsername(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()}
          placeholder="kullanıcı adı" className="px-2 py-1.5 text-xs border border-gray-200 rounded-lg font-mono w-48" />
        <Select sizeVariant="sm" value={overrideType} onChange={(e) => setOverrideType(e.target.value as "allow" | "deny")}>
          <option value="allow">allow (aç)</option>
          <option value="deny">deny (kapat)</option>
        </Select>
        <button onClick={add} className="flex items-center gap-1 px-2.5 py-1.5 bg-black text-white text-xs rounded-lg hover:bg-gray-800">
          <PlusIcon className="w-3.5 h-3.5" /> Ekle
        </button>
      </div>
      {overrides.length === 0 ? (
        <p className="text-xs text-gray-400 py-2">Hiç override yok.</p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {overrides.map((o) => (
            <span key={o.username} className="flex items-center gap-1.5 text-xs bg-white border border-gray-200 rounded-full pl-2.5 pr-1 py-1">
              <code>{o.username}</code>
              <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${o.override_type === "allow" ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"}`}>
                {o.override_type}
              </span>
              <button onClick={() => remove(o.username)} className="text-gray-300 hover:text-red-500"><TrashIcon className="w-3 h-3" /></button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function ColumnVisibilitySection({ tableVisibilityId }: { tableVisibilityId: number }) {
  const [columns, setColumns] = useState<{ name: string; isVisible: boolean }[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      const r = await inventoryApi.listTableColumnVisibility(tableVisibilityId);
      setColumns(r.columns || []);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, [tableVisibilityId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function toggle(col: { name: string; isVisible: boolean }) {
    try {
      await inventoryApi.setColumnVisibility(tableVisibilityId, col.name, !col.isVisible);
      setColumns((prev) => prev.map((c) => (c.name === col.name ? { ...c, isVisible: !c.isVisible } : c)));
    } catch {
      toast.error("Güncellenemedi.");
    }
  }

  if (loading) return <div className="text-xs text-gray-400 py-2">Yükleniyor…</div>;

  return (
    <div className="space-y-2">
      <p className="text-[11px] text-gray-400">
        Gizlenen kolonlar TÜM kullanıcılardan (Admin hariç) — hem tablo görüntüsünden hem
        indirilen/API verisinden — çıkarılır.
      </p>
      <div className="flex flex-wrap gap-1.5">
        {columns.map((c) => (
          <button
            key={c.name}
            onClick={() => toggle(c)}
            className={`text-xs px-2.5 py-1 rounded-full border font-mono ${c.isVisible ? "bg-white border-gray-200 text-gray-700" : "bg-red-50 border-red-100 text-red-500 line-through"}`}
            title={c.isVisible ? "Gizle" : "Göster"}
          >
            {c.name}
          </button>
        ))}
      </div>
    </div>
  );
}
