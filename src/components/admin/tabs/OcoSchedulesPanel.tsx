// src/components/admin/tabs/OcoSchedulesPanel.tsx — Admin > Smart Talepleri >
// "OCO Zamanlamaları".
//
// Soru: ileri tarihli bir OCO'ya istinaden hangi işler tetiklendi, ne zaman çalışacak,
// çalıştı mı? (2026-08-26, kullanıcı talebi.)
//
// İKİ FARKLI TETİKLEYİCİ olabilir ve tabloda AYIRT EDİLİR — çünkü arıza anında
// bakılacak yer değişir:
//   AWX_SCHEDULED : işi AWX'in kendi schedule'ı tetikler. Portal o anda kapalı olsa
//                   bile çalışır; zamanlama AWX arayüzünde de görünür.
//   SCHEDULED     : işi Portal'ın poller'ı tetikler. Yalnızca serviste Smart onayı da
//                   gerekiyorsa bu yol kullanılır (AWX schedule'ı onay kapısını
//                   atlardı). Portal o saatte AYAKTA OLMALI.
import React, { useCallback, useEffect, useState } from "react";
import { ArrowPathIcon, MagnifyingGlassIcon, ClockIcon, XCircleIcon } from "@heroicons/react/24/outline";
import { toast } from "@/hooks/useToast";
import { ansibleApi, type AdminOcoSchedule } from "@/api/ansibleApi";
import { Select } from "@/components/ui/Form";
import { fmtDateTime as fmt } from "@/utils/datetime";
import { TableEmptyRow } from "@/components/common/EmptyState";

const PAGE_SIZE = 50;

const STATUS_META: Record<string, { label: string; className: string }> = {
  AWX_SCHEDULED: { label: "AWX'e zamanlandı", className: "bg-blue-50 text-blue-700 border-blue-200" },
  SCHEDULED:     { label: "Portal zamanladı", className: "bg-indigo-50 text-indigo-700 border-indigo-200" },
  // LAUNCHING: AWX çağrısı uçuşta (saniyeler). PENDING_APPROVAL: kesinti saati geldi
  // ama Smart onayı bekleniyor — iş HENÜZ tetiklenmedi. Eskiden bu durum da "Tetiklendi"
  // yazıyordu; panel yeşil görünürken ortada job yoktu.
  LAUNCHING:        { label: "Tetikleniyor…",   className: "bg-blue-50 text-blue-700 border-blue-200" },
  PENDING_APPROVAL: { label: "Smart onayı bekleniyor", className: "bg-amber-50 text-amber-700 border-amber-200" },
  LAUNCHED:      { label: "Tetiklendi",       className: "bg-green-50 text-green-700 border-green-200" },
  FAILED:        { label: "Hata",             className: "bg-red-50 text-red-700 border-red-200" },
  CANCELLED:     { label: "İptal edildi",     className: "bg-gray-100 text-gray-600 border-gray-200" },
  EXPIRED:       { label: "Pencere kaçtı",    className: "bg-amber-50 text-amber-700 border-amber-200" },
};



// "Ne kadar kaldı / ne kadar geçti" — admin tabloya bakınca sırayı görebilsin.
function relative(iso: string) {
  const ms = new Date(iso).getTime() - Date.now();
  if (!Number.isFinite(ms)) return "";
  const abs = Math.abs(ms);
  const dk = Math.round(abs / 60000);
  const txt = dk >= 1440 ? `${Math.round(dk / 1440)} gün` : dk >= 60 ? `${Math.round(dk / 60)} saat` : `${dk} dk`;
  return ms > 0 ? `${txt} sonra` : `${txt} önce`;
}

export default function OcoSchedulesPanel() {
  const [rows, setRows] = useState<AdminOcoSchedule[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [status, setStatus] = useState("");
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  // Iptal edilen kaydin id'si — buton bazinda kilitleme icin (tum tabloyu kilitlemek
  // gereksiz, admin baska bir satirla ilgilenebilir).
  const [cancelling, setCancelling] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErr("");
    try {
      const r = await ansibleApi.ocoScheduledAll({ limit: PAGE_SIZE, offset, status, q });
      if (!r.ok) { setErr(r.message || "Liste alınamadı."); return; }
      setRows(r.items || []);
      setTotal(r.total || 0);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [offset, status, q]);

  useEffect(() => { load(); }, [load]);

  // AWX tarafi sunucuda temizlenir; burada yalnizca ONAY alinir. Onay metni ne
  // olacagini ACIKCA yaziyor - "iptal" kelimesi tek basina, calisan bir job'in da
  // durdurulacagini anlatmiyor.
  async function adminCancel(r: AdminOcoSchedule) {
    const willStopJob = r.status === "LAUNCHED" || (r.status === "AWX_SCHEDULED" && new Date(r.runAt).getTime() <= Date.now());
    const msg = [
      `#${r.id} — ${r.templateName || "servis"} (OCO ${r.ocoNumber}) iptal edilecek.`,
      r.awxScheduleId ? `AWX schedule #${r.awxScheduleId} SILINECEK.` : "",
      willStopJob ? "AWX'te ÇALIŞAN bir job varsa DURDURULACAK." : "",
      "Devam edilsin mi?",
    ].filter(Boolean).join("\n\n");
    if (!window.confirm(msg)) return;

    setCancelling(r.id);
    try {
      const res = await ansibleApi.ocoScheduledAdminCancel(r.id);
      if (!res.ok) { toast.error(res.message || "İptal edilemedi."); return; }
      toast.success(res.note ? `İptal edildi — ${res.note}` : "İptal edildi.");
      await load();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setCancelling(null);
    }
  }

  const pending = rows.filter((r) => r.status === "AWX_SCHEDULED" || r.status === "SCHEDULED").length;

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-surface)] px-4 py-3">
        <p className="text-sm text-[var(--text-secondary)] leading-relaxed">
          OCO kesinti saatine zamanlanmış işler (Self Service, ScaleX…). <b>AWX'e zamanlandı</b> olanları
          AWX'in kendi schedule'ı tetikler — Portal o anda kapalı olsa bile çalışırlar.
          <b> Portal zamanladı</b> olanlar yalnızca serviste Smart onayı da gerektiğinde
          oluşur; onları Portal'ın poller'ı tetikler, yani Portal o saatte ayakta olmalıdır.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[220px]">
          <MagnifyingGlassIcon className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
          <input
            value={q}
            onChange={(e) => { setOffset(0); setQ(e.target.value); }}
            placeholder="OCO numarası, konu veya servis ara…"
            className="w-full pl-9 pr-3 py-2 text-sm rounded-xl border border-[var(--border)] bg-[var(--bg-surface)]"
          />
        </div>
        <Select value={status} onChange={(e) => { setOffset(0); setStatus(e.target.value); }}>
          <option value="">Tüm durumlar</option>
          {Object.entries(STATUS_META).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </Select>
        <button onClick={load} className="flex items-center gap-1.5 px-3 py-2 text-sm rounded-xl border border-[var(--border)] hover:bg-[var(--bg-elevated)]">
          <ArrowPathIcon className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          Yenile
        </button>
      </div>

      <div className="flex flex-wrap gap-2 text-xs">
        <span className="px-2.5 py-1 rounded-lg bg-[var(--bg-elevated)] text-[var(--text-secondary)]">{total} kayıt</span>
        {pending > 0 && (
          <span className="px-2.5 py-1 rounded-lg bg-blue-50 text-blue-700 flex items-center gap-1">
            <ClockIcon className="w-3.5 h-3.5" /> Bu sayfada bekleyen: {pending}
          </span>
        )}
      </div>

      {err && <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-xl px-4 py-3">{err}</div>}

      <div className="overflow-x-auto rounded-xl border border-[var(--border)]">
        <table className="w-full text-sm pf-table-sticky">
          <thead>
            <tr className="bg-[var(--bg-elevated)] text-left">
              <th className="px-3 py-2 font-semibold">#</th>
              <th className="px-3 py-2 font-semibold">Kullanıcı</th>
              <th className="px-3 py-2 font-semibold">Modül</th>
              <th className="px-3 py-2 font-semibold">Servis</th>
              <th className="px-3 py-2 font-semibold">OCO</th>
              <th className="px-3 py-2 font-semibold">Çalışma zamanı</th>
              <th className="px-3 py-2 font-semibold">Pencere sonu</th>
              <th className="px-3 py-2 font-semibold">Durum</th>
              <th className="px-3 py-2 font-semibold">AWX</th>
              <th className="px-3 py-2 font-semibold"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const meta = STATUS_META[r.status] || { label: r.status, className: "bg-gray-100 text-gray-600 border-gray-200" };
              const waiting = r.status === "AWX_SCHEDULED" || r.status === "SCHEDULED";
              return (
                <tr key={r.id} className="border-t border-[var(--border)] hover:bg-[var(--bg-elevated)] align-top">
                  <td className="px-3 py-2 tabular-nums text-[var(--text-muted)]">{r.id}</td>
                  <td className="px-3 py-2">{r.username}</td>
                  {/* MODUL: ekran Self Service varsayimiyla yazilmisti; ScaleX
                      kayitlari ayni listede, ayirt edilmeden goruntyordu. */}
                  <td className="px-3 py-2 whitespace-nowrap">
                    <span className={r.module === "ScaleX" ? "pf-label pf-label--blue" : "pf-label pf-label--grey"}>
                      {r.module || "—"}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    {r.templateName || `template ${r.awxTemplateId}`}
                    {r.errorMessage && <div className="text-xs text-red-600 mt-0.5">{r.errorMessage}</div>}
                  </td>
                  <td className="px-3 py-2">
                    <span className="font-mono tabular-nums">{r.ocoNumber}</span>
                    {r.ocoSubject && <div className="text-xs text-[var(--text-muted)] mt-0.5">{r.ocoSubject}</div>}
                  </td>
                  <td className="px-3 py-2 tabular-nums whitespace-nowrap">
                    {fmt(r.runAt)}
                    {waiting && <div className="text-xs text-[var(--text-muted)]">{relative(r.runAt)}</div>}
                  </td>
                  <td className="px-3 py-2 tabular-nums whitespace-nowrap text-[var(--text-muted)]">{fmt(r.windowEnd)}</td>
                  <td className="px-3 py-2">
                    <span className={`inline-block text-[11px] font-semibold px-2 py-0.5 rounded-full border ${meta.className}`}>
                      {meta.label}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-xs text-[var(--text-muted)] whitespace-nowrap">
                    {r.awxScheduleId ? <div>schedule #{r.awxScheduleId}</div> : null}
                    {r.awxJobId ? <div>job #{r.awxJobId}</div> : null}
                    {!r.awxScheduleId && !r.awxJobId ? "—" : null}
                    {r.cancelledBy && (
                      <div className="mt-0.5 text-[11px]">
                        iptal: {r.cancelledBy}
                        {r.cancelNote && <div className="text-[10px] opacity-80">{r.cancelNote}</div>}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {["SCHEDULED", "AWX_SCHEDULED", "PENDING_APPROVAL", "LAUNCHED"].includes(r.status) && (
                      <button
                        type="button"
                        disabled={cancelling === r.id}
                        onClick={() => adminCancel(r)}
                        className="flex items-center gap-1 px-2 py-1 text-[11px] font-semibold rounded-lg border border-red-200 text-red-700 hover:bg-red-50 disabled:opacity-50"
                        title="Zamanlamayı iptal et ve AWX tarafını temizle"
                      >
                        <XCircleIcon className="w-3.5 h-3.5" />
                        {cancelling === r.id ? "İptal ediliyor…" : "İptal et"}
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && !loading && (
              <TableEmptyRow colSpan={10} title="Zamanlanmış iş yok." description="OCO penceresine zamanlanan işler burada listelenir." />
            )}
          </tbody>
        </table>
      </div>

      {total > PAGE_SIZE && (
        <div className="flex items-center justify-between text-sm">
          <button
            disabled={offset === 0}
            onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
            className="px-3 py-1.5 rounded-xl border border-[var(--border)] disabled:opacity-40"
          >
            ← Önceki
          </button>
          <span className="text-[var(--text-muted)]">
            {offset + 1}–{Math.min(offset + PAGE_SIZE, total)} / {total}
          </span>
          <button
            disabled={offset + PAGE_SIZE >= total}
            onClick={() => setOffset(offset + PAGE_SIZE)}
            className="px-3 py-1.5 rounded-xl border border-[var(--border)] disabled:opacity-40"
          >
            Sonraki →
          </button>
        </div>
      )}
    </div>
  );
}
