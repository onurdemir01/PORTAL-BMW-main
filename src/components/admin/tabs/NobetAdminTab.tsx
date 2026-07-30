import React, { useState, useEffect } from "react";
import {
  CalendarIcon,
  PlusIcon,
  TrashIcon,
  PencilSquareIcon,
  ChevronDownIcon,
} from "@heroicons/react/24/outline";
import Collapse from "@/components/common/Collapse";
import {
  DutyRosterItem,
  getDutyRoster,
  upsertDutyRoster,
  deleteDutyRoster,
} from "@/api/dutyRosterApi";
import { nobetciApi } from "@/api/nobetciApi";

// ---- Types ----
// Not: "Hızlı Linkler" bölümü kaldırıldı — nöbet linkleri Admin → Linkler
// sekmesindeki genel PortalLink sisteminin "Nöbet" kategorisinden yönetilir.

type EntryForm = {
  date: string;
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
};

const EMPTY_FORM: EntryForm = { date: "", firstName: "", lastName: "", phone: "", email: "" };

// ---- Helpers ----
function uid() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function toISODate(input: string): string | null {
  const s = (input || "").trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const dmY = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (dmY) return `${dmY[3]}-${dmY[2].padStart(2, "0")}-${dmY[1].padStart(2, "0")}`;
  const d = new Date(s);
  if (!isNaN(d.getTime())) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }
  return null;
}

function formatDate(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return iso;
  return `${m[3]}.${m[2]}.${m[1]}`;
}

function validateForm(f: EntryForm): string[] {
  const e: string[] = [];
  if (!toISODate(f.date)) e.push("Geçerli tarih girin (YYYY-MM-DD veya GG.AA.YYYY)");
  if (!f.firstName.trim()) e.push("Ad zorunlu");
  if (!f.lastName.trim()) e.push("Soyad zorunlu");
  if (!f.phone.trim()) e.push("Telefon zorunlu");
  if (!f.email.trim()) e.push("E-posta zorunlu");
  if (f.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email.trim()))
    e.push("E-posta formatı hatalı");
  return e;
}

const BMW_BLUE = "#1C69D4";

// ---- Component ----
const NobetAdminTab: React.FC = () => {
  // -- Schedule state --
  const [items, setItems] = useState<DutyRosterItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // -- Add entry form --
  const [addOpen, setAddOpen] = useState(false);
  const [form, setForm] = useState<EntryForm>(EMPTY_FORM);
  const [formErrors, setFormErrors] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  // -- Inline edit state --
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<EntryForm>(EMPTY_FORM);
  const [editErrors, setEditErrors] = useState<string[]>([]);

  // -- Veri kaynağı durumu (actions.md #6) --
  const [sourceStatus, setSourceStatus] = useState<Awaited<ReturnType<typeof nobetciApi.sourceStatus>> | null>(null);

  // -- Load schedule --
  useEffect(() => {
    setLoading(true);
    getDutyRoster()
      .then((list) =>
        setItems(Array.isArray(list) ? [...list].sort((a, b) => a.date.localeCompare(b.date)) : [])
      )
      .catch((e: any) => setError(e?.message || "Veri alınamadı"))
      .finally(() => setLoading(false));
    nobetciApi.sourceStatus().then(setSourceStatus).catch(() => {});
  }, []);

  // -- Add entry handler --
  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    const errs = validateForm(form);
    setFormErrors(errs);
    if (errs.length > 0) return;

    const item: DutyRosterItem = {
      id: uid(),
      date: toISODate(form.date)!,
      firstName: form.firstName.trim(),
      lastName: form.lastName.trim(),
      phone: form.phone.trim(),
      email: form.email.trim(),
    };

    try {
      setSaving(true);
      setError(null);
      const next = await upsertDutyRoster(item);
      setItems([...next].sort((a, b) => a.date.localeCompare(b.date)));
      setForm(EMPTY_FORM);
      setFormErrors([]);
      setAddOpen(false);
    } catch (err: any) {
      setFormErrors([err?.message || "Kayıt eklenemedi"]);
    } finally {
      setSaving(false);
    }
  }

  // -- Delete entry --
  async function handleDelete(id: string) {
    if (!window.confirm("Bu kaydı silmek istediğine emin misin?")) return;
    try {
      setLoading(true);
      setError(null);
      const next = await deleteDutyRoster(id);
      setItems([...next].sort((a, b) => a.date.localeCompare(b.date)));
    } catch (err: any) {
      setError(err?.message || "Silinemedi");
    } finally {
      setLoading(false);
    }
  }

  // -- Start inline edit --
  function startEdit(item: DutyRosterItem) {
    setEditingId(item.id);
    setEditForm({
      date: item.date,
      firstName: item.firstName,
      lastName: item.lastName,
      phone: item.phone,
      email: item.email,
    });
    setEditErrors([]);
  }

  // -- Save inline edit --
  async function saveEdit(id: string) {
    const errs = validateForm(editForm);
    setEditErrors(errs);
    if (errs.length > 0) return;

    const item: DutyRosterItem = {
      id,
      date: toISODate(editForm.date)!,
      firstName: editForm.firstName.trim(),
      lastName: editForm.lastName.trim(),
      phone: editForm.phone.trim(),
      email: editForm.email.trim(),
    };

    try {
      setSaving(true);
      setError(null);
      const next = await upsertDutyRoster(item);
      setItems([...next].sort((a, b) => a.date.localeCompare(b.date)));
      setEditingId(null);
      setEditErrors([]);
    } catch (err: any) {
      setEditErrors([err?.message || "Güncellenemedi"]);
    } finally {
      setSaving(false);
    }
  }

  // ---- Render ----
  return (
    <div className="space-y-10">
      {/* ============ Veri Kaynağı (actions.md #6) ============ */}
      {sourceStatus && (
        <div className={`flex items-center gap-3 px-4 py-2.5 rounded-xl border text-xs ${
          sourceStatus.currentSource === "api_live" ? "bg-emerald-50 border-emerald-100 text-emerald-700" :
          sourceStatus.currentSource === "db_fallback" ? "bg-amber-50 border-amber-100 text-amber-700" :
          "bg-gray-50 border-gray-100 text-gray-500"
        }`}>
          <span className="font-semibold">Veri Kaynağı:</span>
          <span>
            {sourceStatus.currentSource === "api_live" && "Canlı (harici gbnys API'sinden)"}
            {sourceStatus.currentSource === "db_fallback" && "DB önbelleği (harici API şu an erişilemiyor)"}
            {sourceStatus.currentSource === "none" && "Hiçbir kaynak yok"}
          </span>
          {sourceStatus.dbLastSyncedAt && (
            <span className="text-[11px] opacity-70">
              · Son başarılı senkronizasyon: {new Date(sourceStatus.dbLastSyncedAt).toLocaleString("tr-TR")}
            </span>
          )}
        </div>
      )}

      {/* ============ Schedule Section ============ */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <CalendarIcon className="w-5 h-5" style={{ color: BMW_BLUE }} />
            <h2 className="text-base font-semibold text-gray-800">Nöbet Listesi</h2>
            {loading && <span className="text-xs text-gray-400 ml-2">yükleniyor…</span>}
          </div>
          <button
            onClick={() => {
              setAddOpen((v) => !v);
              setFormErrors([]);
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg text-white transition-colors"
            style={{ backgroundColor: BMW_BLUE }}
          >
            <PlusIcon className="w-4 h-4" />
            Yeni Kayıt
            <ChevronDownIcon
              className={`w-3 h-3 transition-transform duration-200 ${addOpen ? "rotate-180" : ""}`}
            />
          </button>
        </div>

        {error && (
          <div className="mb-3 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {error}
          </div>
        )}

        {/* Add form — collapsible */}
        <Collapse open={addOpen}>
          <form onSubmit={handleAdd} className="mb-4 rounded-xl border border-blue-100 bg-blue-50 p-4">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <div>
                <label className="text-xs font-medium text-gray-600">Tarih</label>
                <input
                  value={form.date}
                  onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
                  placeholder="YYYY-MM-DD"
                  className="mt-1 w-full rounded-lg border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-200"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600">Telefon</label>
                <input
                  value={form.phone}
                  onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                  placeholder="+90 5xx xxx xx xx"
                  className="mt-1 w-full rounded-lg border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-200"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600">Ad</label>
                <input
                  value={form.firstName}
                  onChange={(e) => setForm((f) => ({ ...f, firstName: e.target.value }))}
                  className="mt-1 w-full rounded-lg border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-200"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600">Soyad</label>
                <input
                  value={form.lastName}
                  onChange={(e) => setForm((f) => ({ ...f, lastName: e.target.value }))}
                  className="mt-1 w-full rounded-lg border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-200"
                />
              </div>
              <div className="md:col-span-2">
                <label className="text-xs font-medium text-gray-600">E-posta</label>
                <input
                  value={form.email}
                  onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                  className="mt-1 w-full rounded-lg border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-200"
                />
              </div>
            </div>
            {formErrors.length > 0 && (
              <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                <ul className="list-disc pl-4 space-y-0.5">
                  {formErrors.map((err, i) => (
                    <li key={i}>{err}</li>
                  ))}
                </ul>
              </div>
            )}
            <div className="mt-3 flex gap-2 justify-end">
              <button
                type="button"
                onClick={() => setAddOpen(false)}
                className="px-3 py-1.5 text-sm rounded-lg border text-gray-600 hover:bg-gray-50"
              >
                İptal
              </button>
              <button
                type="submit"
                disabled={saving}
                className="px-4 py-1.5 text-sm rounded-lg text-white font-medium disabled:opacity-50"
                style={{ backgroundColor: BMW_BLUE }}
              >
                {saving ? "Kaydediliyor…" : "Kaydet"}
              </button>
            </div>
          </form>
        </Collapse>

        {/* Schedule table */}
        <div className="overflow-hidden rounded-xl border bg-white">
          <div className="overflow-auto max-h-[420px]">
            <table className="w-full text-left text-sm">
              <thead className="sticky top-0 bg-gray-50 z-10">
                <tr className="border-b">
                  <th className="px-3 py-2.5 font-medium text-gray-600">Tarih</th>
                  <th className="px-3 py-2.5 font-medium text-gray-600">Ad Soyad</th>
                  <th className="px-3 py-2.5 font-medium text-gray-600">Telefon</th>
                  <th className="px-3 py-2.5 font-medium text-gray-600">E-posta</th>
                  <th className="px-3 py-2.5 font-medium text-gray-600 text-right">İşlem</th>
                </tr>
              </thead>
              <tbody>
                {items.length === 0 && !loading ? (
                  <tr>
                    <td colSpan={5} className="px-3 py-8 text-center text-gray-400 text-sm">
                      Kayıt bulunamadı.
                    </td>
                  </tr>
                ) : (
                  items.map((item) =>
                    editingId === item.id ? (
                      /* ---- inline edit row ---- */
                      <React.Fragment key={item.id}>
                        <tr className="border-b bg-blue-50">
                          <td className="px-2 py-2">
                            <input
                              value={editForm.date}
                              onChange={(e) => setEditForm((f) => ({ ...f, date: e.target.value }))}
                              className="w-28 rounded border px-2 py-1 text-xs"
                            />
                          </td>
                          <td className="px-2 py-2">
                            <div className="flex gap-1">
                              <input
                                value={editForm.firstName}
                                onChange={(e) => setEditForm((f) => ({ ...f, firstName: e.target.value }))}
                                placeholder="Ad"
                                className="w-20 rounded border px-2 py-1 text-xs"
                              />
                              <input
                                value={editForm.lastName}
                                onChange={(e) => setEditForm((f) => ({ ...f, lastName: e.target.value }))}
                                placeholder="Soyad"
                                className="w-24 rounded border px-2 py-1 text-xs"
                              />
                            </div>
                          </td>
                          <td className="px-2 py-2">
                            <input
                              value={editForm.phone}
                              onChange={(e) => setEditForm((f) => ({ ...f, phone: e.target.value }))}
                              className="w-32 rounded border px-2 py-1 text-xs"
                            />
                          </td>
                          <td className="px-2 py-2">
                            <input
                              value={editForm.email}
                              onChange={(e) => setEditForm((f) => ({ ...f, email: e.target.value }))}
                              className="w-44 rounded border px-2 py-1 text-xs"
                            />
                          </td>
                          <td className="px-2 py-2">
                            <div className="flex items-center justify-end gap-1">
                              <button
                                onClick={() => saveEdit(item.id)}
                                disabled={saving}
                                className="px-2 py-1 text-xs rounded text-white disabled:opacity-50"
                                style={{ backgroundColor: BMW_BLUE }}
                              >
                                Kaydet
                              </button>
                              <button
                                onClick={() => setEditingId(null)}
                                className="px-2 py-1 text-xs rounded border text-gray-600 hover:bg-gray-100"
                              >
                                İptal
                              </button>
                            </div>
                          </td>
                        </tr>
                        {editErrors.length > 0 && (
                          <tr className="border-b">
                            <td colSpan={5} className="px-3 py-1 text-xs text-red-600 bg-red-50">
                              {editErrors.join(" • ")}
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    ) : (
                      /* ---- normal row ---- */
                      <tr key={item.id} className="border-b last:border-b-0 hover:bg-gray-50">
                        <td className="px-3 py-2.5 text-gray-700 whitespace-nowrap">
                          {formatDate(item.date)}
                        </td>
                        <td className="px-3 py-2.5 font-medium text-gray-900">
                          {item.firstName} {item.lastName}
                        </td>
                        <td className="px-3 py-2.5 text-gray-600">{item.phone}</td>
                        <td className="px-3 py-2.5 text-gray-600">{item.email}</td>
                        <td className="px-3 py-2.5">
                          <div className="flex items-center justify-end gap-1.5">
                            <button
                              onClick={() => startEdit(item)}
                              title="Düzenle"
                              className="p-1.5 rounded-lg text-gray-400 hover:text-blue-600 hover:bg-blue-50 transition-colors"
                            >
                              <PencilSquareIcon className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => handleDelete(item.id)}
                              title="Sil"
                              className="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                            >
                              <TrashIcon className="w-4 h-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    )
                  )
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

    </div>
  );
};

export default NobetAdminTab;
