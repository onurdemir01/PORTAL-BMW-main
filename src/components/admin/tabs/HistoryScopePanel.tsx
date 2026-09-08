// src/components/admin/tabs/HistoryScopePanel.tsx — "Envanter Görünürlüğü > Geçmiş Kapsamı".
//
// Hangi envanter tablosunun GEÇMİŞİ tutulacağını buradan yönetiriz. Açılan tablo hem
// Envanter'de "Geçmiş" düğmesi kazanır hem de Denetim > Envanter Değişim'in tablo
// seçicisinde çıkar.
//
// ANAHTAR KOLON NEDEN SORULUYOR: geçmiş, satırları "aynı satır mı" diye karşılaştırarak
// tutuluyor. Bu karşılaştırma anahtar kolonlar üzerinden yapılır ve YANLIŞ anahtar farkı
// tamamen anlamsız yapar — her satır aynı anda hem "gelen" hem "giden" görünür. Bu yüzden
// açmak için anahtar zorunlu; sunucu da kolonların tabloda gerçekten var olduğunu doğrular.
//
// Tabloların birincil anahtarları `id INT IDENTITY` olduğu için OTOMATİK türetilemiyor:
// o numaralar tablo her yenilendiğinde (TRUNCATE + yeniden doldurma) baştan üretilir,
// yani aynı sunucu her gece başka bir id alır. Doğru anahtar İŞ anahtarıdır (host, app…).
import React, { useCallback, useEffect, useState } from "react";
import { ClockIcon, PlusIcon, CheckIcon, XMarkIcon } from "@heroicons/react/24/outline";
import { inventoryApi, type HistoryConfigRow } from "@/api/inventoryApi";
import { toast } from "@/hooks/useToast";
import { Select } from "@/components/ui/Form";
import { TableEmptyRow } from "@/components/common/EmptyState";

export default function HistoryScopePanel() {
  const [rows, setRows] = useState<HistoryConfigRow[]>([]);
  const [candidates, setCandidates] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");

  // Yeni tablo ekleme formu
  const [newTable, setNewTable] = useState("");
  const [newCols, setNewCols] = useState<string[]>([]);
  const [newKey, setNewKey] = useState<string[]>([]);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const r = await inventoryApi.historyConfig();
      if (!r.ok) { toast.error(r.message || "Kapsam okunamadı."); return; }
      setRows(r.configured || []);
      setCandidates(r.candidates || []);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { reload(); }, [reload]);

  async function save(row: { table: string; label?: string; mode?: string; key: string[]; enabled: boolean }) {
    setBusy(row.table);
    try {
      const r = await inventoryApi.historyConfigSave(row);
      if (!r.ok) { toast.error(r.message || "Kaydedilemedi."); return; }
      toast.success(`${row.table}: geçmiş ${row.enabled ? "açıldı" : "kapatıldı"}.`);
      await reload();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally { setBusy(""); }
  }

  async function pickTable(t: string) {
    setNewTable(t);
    setNewKey([]);
    setNewCols([]);
    if (!t) return;
    try {
      const r = await inventoryApi.historyColumns(t);
      if (r.ok) setNewCols(r.columns || []);
    } catch { /* kolonlar alinamazsa kullanici elle secemez; sessiz gecilir */ }
  }

  return (
    <section className="rounded-xl border border-gray-200 p-4 space-y-4">
      <div className="flex items-start gap-2">
        <ClockIcon className="w-5 h-5 text-gray-400 flex-shrink-0 mt-0.5" />
        <div>
          <h3 className="text-sm font-semibold text-gray-700">Geçmiş Kapsamı</h3>
          <p className="text-[11px] text-gray-500 mt-0.5 max-w-3xl">
            Açtığınız tablo için Portal her gün bir anlık görüntü alır; tablo Envanter'de
            "Geçmiş" düğmesi kazanır ve Denetim &gt; Envanter Değişim'de listelenir.
            <strong> Geçmiş açıldığı andan itibaren birikir</strong> — geriye dönük veri
            üretilemez, çünkü envanter tabloları her yenilemede sıfırdan yazılıyor.
          </p>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-16">
          <div className="w-5 h-5 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-gray-500">
                <th className="px-3 py-2 font-semibold">Tablo</th>
                <th className="px-3 py-2 font-semibold">Görünen ad</th>
                <th className="px-3 py-2 font-semibold">Anahtar kolonlar</th>
                <th className="px-3 py-2 font-semibold">Son değişiklik</th>
                <th className="px-3 py-2 font-semibold text-right">Geçmiş</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.table} className="border-t border-gray-100">
                  <td className="px-3 py-2 font-mono">{r.table}</td>
                  <td className="px-3 py-2">{r.label || "—"}</td>
                  <td className="px-3 py-2 font-mono text-gray-600">{r.key.join(", ") || "—"}</td>
                  <td className="px-3 py-2 text-gray-400">
                    {r.updatedBy ? `${r.updatedBy}` : "—"}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <button
                      disabled={busy === r.table}
                      onClick={() => save({ table: r.table, label: r.label || r.table, mode: r.mode, key: r.key, enabled: !r.enabled })}
                      className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full border text-[11px] font-semibold disabled:opacity-50 ${
                        r.enabled
                          ? "bg-emerald-50 border-emerald-200 text-emerald-700"
                          : "bg-gray-50 border-gray-200 text-gray-500"
                      }`}
                      title={r.enabled ? "Geçmiş tutuluyor — kapatmak için tıklayın" : "Geçmişi tutmaya başla"}
                    >
                      {r.enabled ? <CheckIcon className="w-3 h-3" /> : <XMarkIcon className="w-3 h-3" />}
                      {r.enabled ? "Açık" : "Kapalı"}
                    </button>
                  </td>
                </tr>
              ))}
              {/* Bos durum ORTAK bilesenden (bkz. G23 bekcisi): her tablonun kendi
                  bos satirini yazmasi, sayfadan sayfaya farkli gorunum uretiyordu. */}
              {rows.length === 0 && (
                <TableEmptyRow
                  colSpan={5}
                  title="Kapsamda tablo yok."
                  description="Aşağıdan bir tablo ekleyip geçmişini tutmaya başlayabilirsiniz."
                />
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Yeni tablo ekleme */}
      <div className="rounded-lg border border-dashed border-gray-200 p-3 space-y-2">
        <p className="text-[11px] font-semibold text-gray-600">Kapsama tablo ekle</p>
        <div className="flex flex-wrap items-end gap-2">
          <Select value={newTable} onChange={(e) => pickTable(e.target.value)} className="min-w-[16rem]">
            <option value="">Tablo seçin…</option>
            {candidates.map((c) => <option key={c} value={c}>{c}</option>)}
          </Select>
          <button
            disabled={!newTable || newKey.length === 0 || busy === newTable}
            onClick={async () => {
              await save({ table: newTable, label: newTable, mode: "snapshot", key: newKey, enabled: true });
              setNewTable(""); setNewCols([]); setNewKey([]);
            }}
            className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg bg-[var(--accent)] text-white disabled:opacity-40"
          >
            <PlusIcon className="w-4 h-4" /> Ekle ve aç
          </button>
        </div>

        {newTable && (
          <div>
            <p className="text-[11px] text-gray-500 mb-1">
              <strong>Anahtar kolonları seçin</strong> — birlikte bir satırı tekil olarak
              tanımlayan kolonlar (ör. <code>host</code> + <code>app</code>). Otomatik
              seçilmiyor: tabloların birincil anahtarı her yenilemede baştan üretilen bir
              <code> id</code> olduğu için satır kimliği olarak kullanılamaz.
            </p>
            <div className="flex flex-wrap gap-1.5">
              {newCols.map((c) => {
                const on = newKey.includes(c);
                return (
                  <button
                    key={c}
                    onClick={() => setNewKey((p) => (on ? p.filter((x) => x !== c) : [...p, c]))}
                    className={`text-xs px-2.5 py-1 rounded-full border font-mono ${
                      on ? "bg-[var(--accent)] text-white border-[var(--accent)]" : "bg-white border-gray-200 text-gray-700"
                    }`}
                  >
                    {c}
                  </button>
                );
              })}
              {newCols.length === 0 && <span className="text-[11px] text-gray-400">Kolonlar okunuyor…</span>}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
