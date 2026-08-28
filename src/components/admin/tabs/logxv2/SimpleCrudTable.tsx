// src/components/admin/tabs/logxv2/SimpleCrudTable.tsx — LogX v2 admin ekranlarının 3'ü
// (cluster-index, terminal-host-map, env-suffix-map) için ortak, jenerik satır-CRUD tablosu.
// InventoryTab.tsx'in form deseninden (rounded-lg border, black focus ring) esinlenir ama
// düşük-trafikli admin config ekranları için kasıtlı olarak daha kompakttır.
import React, { useState } from "react";
import { PlusIcon, PencilIcon, TrashIcon, XMarkIcon, CheckIcon } from "@heroicons/react/24/outline";
import { TableEmptyRow } from "@/components/common/EmptyState";

export interface ColumnDef<T> {
  key: keyof T;
  label: string;
  type?: "text" | "checkbox" | "number";
  placeholder?: string;
  // Hücre BOŞ olduğunda okuma modunda gösterilecek açıklama (ör. devreye girecek fallback
  // değeri). Boş string dönerse "—" gösterilir. Yalnızca görüntüdür, kayda etki etmez.
  emptyHint?: (row: T) => string;
  // Yazarken açılan öneri listesi (datalist). Değerler MEVCUT satırlardan türetilir —
  // sabit bir liste gömmek istemiyoruz, yeni bir vault anahtarı/URL kalıbı çıktığında
  // kod değişmesin. Serbest metin girişi engellenmez, yalnızca yazım hatası azaltılır.
  suggestions?: string[];
  // Uzun değerleri (api_url gibi) okuma modunda kısaltır; tam değer title'da kalır.
  truncate?: boolean;
}

interface Props<T extends { id: number }> {
  columns: ColumnDef<T>[];
  rows: T[];
  emptyRow: Partial<T>;
  onCreate: (data: Partial<T>) => Promise<void>;
  onUpdate: (id: number, data: Partial<T>) => Promise<void>;
  onDelete: (id: number) => Promise<void>;
  // Satıra özel ek aksiyonlar (ör. "Bağlantı Testi"). Düzenle/Sil'in SOLUNA gelir ve
  // yalnızca okuma modundaki satırlarda gösterilir — düzenleme sırasında yan etkili bir
  // işlem tetiklemek kaydedilmemiş değişiklikleri kaybettirirdi.
  rowActions?: (row: T) => React.ReactNode;
}

export default function SimpleCrudTable<T extends { id: number }>({ columns, rows, emptyRow, onCreate, onUpdate, onDelete, rowActions }: Props<T>) {
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<Partial<T>>(emptyRow);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null);

  function startEdit(row: T) {
    setEditingId(row.id);
    setAdding(false);
    setForm({ ...row });
  }

  function startAdd() {
    setAdding(true);
    setEditingId(null);
    setForm(emptyRow);
  }

  function cancel() {
    setAdding(false);
    setEditingId(null);
    setForm(emptyRow);
  }

  async function save() {
    setSaving(true);
    try {
      if (editingId !== null) await onUpdate(editingId, form);
      else await onCreate(form);
      cancel();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  function renderFormRow() {
    return (
      <tr className="bg-blue-50/60">
        {columns.map((col) => (
          <td key={String(col.key)} className="px-3 py-2">
            {col.type === "checkbox" ? (
              <input
                type="checkbox"
                checked={!!form[col.key]}
                onChange={(e) => setForm((prev) => ({ ...prev, [col.key]: e.target.checked }))}
                className="rounded"
              />
            ) : (
              <>
                <input
                  type={col.type === "number" ? "number" : "text"}
                  list={col.suggestions?.length ? `sct-${String(col.key)}` : undefined}
                  value={String(form[col.key] ?? "")}
                  placeholder={col.placeholder}
                  onChange={(e) =>
                    setForm((prev) => ({ ...prev, [col.key]: col.type === "number" ? Number(e.target.value) : e.target.value }))
                  }
                  className="w-full min-w-[7rem] px-2 py-1.5 text-sm border border-gray-200 rounded-lg outline-none focus:border-black focus:ring-1 focus:ring-black transition"
                />
                {col.suggestions?.length ? (
                  <datalist id={`sct-${String(col.key)}`}>
                    {col.suggestions.map((s) => <option key={s} value={s} />)}
                  </datalist>
                ) : null}
              </>
            )}
          </td>
        ))}
        <td className="px-3 py-2 text-right whitespace-nowrap">
          <button onClick={save} disabled={saving} className="p-1.5 text-emerald-600 hover:bg-emerald-50 rounded-lg transition disabled:opacity-50">
            <CheckIcon className="w-4 h-4" />
          </button>
          <button onClick={cancel} className="p-1.5 text-gray-400 hover:bg-gray-100 rounded-lg transition">
            <XMarkIcon className="w-4 h-4" />
          </button>
        </td>
      </tr>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        {!adding && editingId === null && (
          <button
            onClick={startAdd}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-black text-white text-xs rounded-lg hover:bg-gray-800 transition-colors"
          >
            <PlusIcon className="w-3.5 h-3.5" />
            Ekle
          </button>
        )}
      </div>
      <div className="overflow-x-auto rounded-xl border border-gray-100">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 text-gray-500 text-xs font-medium">
              {columns.map((col) => (
                <th key={String(col.key)} className="text-left px-3 py-2">{col.label}</th>
              ))}
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {adding && renderFormRow()}
            {rows.map((row) =>
              editingId === row.id ? (
                <React.Fragment key={row.id}>{renderFormRow()}</React.Fragment>
              ) : (
                <tr key={row.id} className="hover:bg-gray-50/50 transition-colors">
                  {columns.map((col) => {
                    const raw = row[col.key];
                    const isEmpty = raw === null || raw === undefined || raw === "";
                    return (
                      <td
                        key={String(col.key)}
                        title={col.truncate ? String(raw ?? "") : undefined}
                        className={`px-3 py-2 text-gray-700 ${col.truncate ? "max-w-[14rem] truncate" : ""}`}
                      >
                        {col.type === "checkbox"
                          ? (raw ? "✓" : "—")
                          : isEmpty && col.emptyHint
                            ? <span className="text-gray-400 italic">{col.emptyHint(row) || "—"}</span>
                            : String(raw ?? "")}
                      </td>
                    );
                  })}
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    {rowActions?.(row)}
                    <button onClick={() => startEdit(row)} aria-label="Satırı düzenle" title="Düzenle"
                      className="p-1.5 text-gray-400 hover:bg-gray-100 rounded-lg transition">
                      <PencilIcon className="w-3.5 h-3.5" />
                    </button>
                    {confirmDelete === row.id ? (
                      <>
                        {/* Silme hatası eskiden SESSİZCE yutuluyordu: satır ekranda kalıyor,
                            kullanıcı neden silinmediğini anlamıyordu. */}
                        <button
                          onClick={async () => {
                            try {
                              await onDelete(row.id);
                              setConfirmDelete(null);
                            } catch (err) {
                              alert(err instanceof Error ? err.message : String(err));
                            }
                          }}
                          className="p-1.5 text-red-600 hover:bg-red-50 rounded-lg transition text-xs"
                        >
                          Emin misin?
                        </button>
                        <button onClick={() => setConfirmDelete(null)} aria-label="Silmeyi iptal et" title="İptal"
                          className="p-1.5 text-gray-400 hover:bg-gray-100 rounded-lg transition">
                          <XMarkIcon className="w-3.5 h-3.5" />
                        </button>
                      </>
                    ) : (
                      <button onClick={() => setConfirmDelete(row.id)} aria-label="Satırı sil" title="Sil"
                        className="p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-600 rounded-lg transition">
                        <TrashIcon className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </td>
                </tr>
              )
            )}
            {rows.length === 0 && !adding && (
              <TableEmptyRow colSpan={columns.length + 1} title="Kayıt yok." />
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
