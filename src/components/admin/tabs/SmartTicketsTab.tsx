// src/components/admin/tabs/SmartTicketsTab.tsx — Admin > Smart Talepleri.
// "Kim ne kayit acmis, hangi Smart kaydi tetiklenmis, saat kacta" sorusunu tek ekrandan
// yanitlar (2026-08-20, kullanici talebi). Kullanicinin kendi "Taleplerim" panelinden
// (RequestsSidePanel) farki: TUM kullanicilarin talepleri + sunucu-tarafi filtre/sayfalama.
// Tablo buyuyebilecegi icin filtreleme ve sayfalama SUNUCUDA yapilir (bkz.
// server/ansible/runner.cjs GET /ss/smart-tickets/all).
import React, { useCallback, useEffect, useState } from "react";
import { ArrowPathIcon, MagnifyingGlassIcon, ChevronDownIcon, ArrowDownTrayIcon } from "@heroicons/react/24/outline";
import { ansibleApi, type AdminSmartTicket } from "@/api/ansibleApi";
import { toast } from "@/hooks/useToast";
import { Select } from "@/components/ui/Form";

const STATUS_META: Record<string, { label: string; className: string }> = {
  PENDING:   { label: "Onay Bekliyor",           className: "bg-amber-50 text-amber-700 border-amber-200" },
  LAUNCHED:  { label: "Onaylandı — Çalıştırıldı", className: "bg-green-50 text-green-700 border-green-200" },
  REJECTED:  { label: "Reddedildi",              className: "bg-red-50 text-red-700 border-red-200" },
  TIMEOUT:   { label: "Zaman Aşımı",             className: "bg-gray-100 text-gray-600 border-gray-200" },
  ERROR:     { label: "Hata",                    className: "bg-red-50 text-red-700 border-red-200" },
  CANCELLED: { label: "İptal Edildi",            className: "bg-gray-100 text-gray-600 border-gray-200" },
};

const PAGE_SIZE = 50;

function fmt(iso?: string | null) {
  if (!iso) return "—";
  try { return new Date(iso).toLocaleString("tr-TR"); } catch { return iso; }
}

// Acilis -> sonuclanma arasi gecen sure. Admin "onay ne kadar surmus" ya da
// "zaman asimina mi dusmus" sorusunu tabloya bakarak yanitlayabilsin.
function duration(a: string, b?: string | null) {
  if (!b) return "—";
  const ms = new Date(b).getTime() - new Date(a).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "—";
  const min = Math.floor(ms / 60000);
  const sec = Math.floor((ms % 60000) / 1000);
  if (min >= 60) return `${Math.floor(min / 60)}s ${min % 60}dk`;
  return min > 0 ? `${min}dk ${sec}sn` : `${sec}sn`;
}

function toCsv(rows: AdminSmartTicket[]): string {
  const cols = ["id", "externalTicketId", "username", "status", "smartStateName", "templateName", "flowKey", "jobId", "createdAt", "resolvedAt", "errorMessage"];
  const head = cols.join(",");
  const body = rows.map((r) =>
    cols.map((c) => `"${String((r as unknown as Record<string, unknown>)[c] ?? "").replace(/"/g, '""')}"`).join(",")
  );
  return [head, ...body].join("\n");
}

export default function SmartTicketsTab() {
  const [rows, setRows] = useState<AdminSmartTicket[]>([]);
  const [summary, setSummary] = useState<Record<string, number>>({});
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [status, setStatus] = useState("");
  const [username, setUsername] = useState("");
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [expanded, setExpanded] = useState<number | null>(null);

  const load = useCallback(async (nextOffset = offset) => {
    setLoading(true);
    try {
      const r = await ansibleApi.smartTicketsAll({ limit: PAGE_SIZE, offset: nextOffset, status, username, q });
      if (r.ok) {
        setRows(r.tickets || []);
        setTotal(r.total || 0);
        setSummary(r.summary || {});
        setErr("");
      } else {
        setErr(r.message || "Talepler alınamadı.");
      }
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offset, status, username, q]);

  useEffect(() => { load(0); setOffset(0); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [status]);
  useEffect(() => { load(offset); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  function applyFilters() {
    setOffset(0);
    load(0);
  }

  function page(dir: -1 | 1) {
    const next = Math.max(0, offset + dir * PAGE_SIZE);
    setOffset(next);
    load(next);
  }

  function exportCsv() {
    if (rows.length === 0) { toast.error("Dışa aktarılacak kayıt yok."); return; }
    const blob = new Blob(["﻿" + toCsv(rows)], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `smart_talepleri_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const shown = `${total === 0 ? 0 : offset + 1}–${Math.min(offset + rows.length, total)} / ${total}`;

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h3 className="text-sm font-semibold text-gray-800 mb-1">Smart Talepleri</h3>
          <p className="text-xs text-gray-500 max-w-2xl">
            Self Service üzerinden açılan tüm Smart onay taleplerinin kalıcı kaydı: kim açtı,
            hangi otomasyon için, hangi Smart kaydı oluştu, ne zaman ve sonucu ne oldu.
            Bir satıra tıklayınca o talebin gönderilen parametreleri açılır.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={exportCsv}
            className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium border border-gray-200 rounded-lg hover:bg-gray-50">
            <ArrowDownTrayIcon className="w-3.5 h-3.5" /> CSV
          </button>
          <button onClick={() => load(offset)}
            className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium border border-gray-200 rounded-lg hover:bg-gray-50">
            <ArrowPathIcon className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} /> Yenile
          </button>
        </div>
      </div>

      {/* Durum ozeti — sayfalamadan bagimsiz, TUM tabloyu kapsar */}
      <div className="flex flex-wrap gap-2">
        {Object.entries(STATUS_META).map(([key, meta]) => {
          const n = summary[key] || 0;
          const active = status === key;
          return (
            <button
              key={key}
              onClick={() => setStatus(active ? "" : key)}
              title={active ? "Filtreyi kaldır" : `Yalnızca "${meta.label}" olanları göster`}
              className={`text-xs font-medium px-2.5 py-1 rounded-lg border transition-colors ${meta.className} ${active ? "ring-2 ring-offset-1 ring-[#1A56DB]" : "opacity-90 hover:opacity-100"}`}
            >
              {meta.label} <span className="font-bold tabular-nums">{n}</span>
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap gap-2 items-center">
        <input
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && applyFilters()}
          placeholder="kullanıcı adı"
          className="px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg font-mono w-44"
        />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && applyFilters()}
          placeholder="Smart kayıt no / servis / parametre"
          className="px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg w-64"
        />
        <Select sizeVariant="sm" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">Tüm durumlar</option>
          {Object.entries(STATUS_META).map(([k, m]) => <option key={k} value={k}>{m.label}</option>)}
        </Select>
        <button onClick={applyFilters}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-black text-white text-xs rounded-lg hover:bg-gray-800">
          <MagnifyingGlassIcon className="w-3.5 h-3.5" /> Ara
        </button>
        {(username || q || status) && (
          <button onClick={() => { setUsername(""); setQ(""); setStatus(""); setOffset(0); }}
            className="text-xs text-gray-400 hover:text-gray-600 underline">temizle</button>
        )}
      </div>

      {err && <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-xl px-3 py-2">{err}</div>}

      <div className="overflow-x-auto rounded-xl border border-gray-100">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-100 text-left">
              <th className="px-3 py-2 text-xs font-semibold text-gray-500">Açılış</th>
              <th className="px-3 py-2 text-xs font-semibold text-gray-500">Kullanıcı</th>
              <th className="px-3 py-2 text-xs font-semibold text-gray-500">Otomasyon</th>
              <th className="px-3 py-2 text-xs font-semibold text-gray-500">Smart Kayıt</th>
              <th className="px-3 py-2 text-xs font-semibold text-gray-500">Durum</th>
              <th className="px-3 py-2 text-xs font-semibold text-gray-500">Sonuçlanma</th>
              <th className="px-3 py-2 text-xs font-semibold text-gray-500">Süre</th>
              <th className="px-3 py-2 text-xs font-semibold text-gray-500">Job</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {loading && rows.length === 0 && (
              <tr><td colSpan={8} className="px-3 py-8 text-center text-sm text-gray-400">Yükleniyor…</td></tr>
            )}
            {!loading && rows.length === 0 && (
              <tr><td colSpan={8} className="px-3 py-8 text-center text-sm text-gray-400">Kayıt bulunamadı.</td></tr>
            )}
            {rows.map((t) => {
              const meta = STATUS_META[t.status] || { label: t.status, className: "bg-gray-100 text-gray-600 border-gray-200" };
              const open = expanded === t.id;
              return (
                <React.Fragment key={t.id}>
                  <tr
                    onClick={() => setExpanded(open ? null : t.id)}
                    className="hover:bg-gray-50/60 cursor-pointer"
                    title="Gönderilen parametreleri göster"
                  >
                    <td className="px-3 py-2 text-xs text-gray-600 whitespace-nowrap">{fmt(t.createdAt)}</td>
                    <td className="px-3 py-2 text-xs font-mono text-gray-800">{t.username}</td>
                    <td className="px-3 py-2 text-xs text-gray-800">
                      <div className="flex items-center gap-1.5">
                        <ChevronDownIcon className={`w-3 h-3 text-gray-300 transition-transform ${open ? "rotate-180" : ""}`} />
                        {t.templateName || <span className="text-gray-300 italic">isimsiz</span>}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-xs font-mono text-gray-700">{t.externalTicketId || "—"}</td>
                    <td className="px-3 py-2">
                      <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-lg border whitespace-nowrap ${meta.className}`}>{meta.label}</span>
                      {t.smartStateName && <div className="text-[10px] text-gray-400 mt-0.5">{t.smartStateName}</div>}
                    </td>
                    <td className="px-3 py-2 text-xs text-gray-600 whitespace-nowrap">{fmt(t.resolvedAt)}</td>
                    <td className="px-3 py-2 text-xs text-gray-600 whitespace-nowrap tabular-nums">{duration(t.createdAt, t.resolvedAt)}</td>
                    <td className="px-3 py-2 text-xs font-mono text-gray-700">{t.jobId ? `#${t.jobId}` : "—"}</td>
                  </tr>
                  {open && (
                    <tr className="bg-gray-50/50">
                      <td colSpan={8} className="px-4 py-3">
                        <div className="space-y-2 text-xs">
                          <div className="flex flex-wrap gap-x-6 gap-y-1 text-gray-500">
                            <span>Flow: <span className="font-mono text-gray-700">{t.flowKey || "—"}</span></span>
                            <span>AWX sunucu: <span className="font-mono text-gray-700">{t.awxServerId ?? "—"}</span></span>
                            <span>Template: <span className="font-mono text-gray-700">{t.awxTemplateId ?? "—"}</span></span>
                            <span>Portal talep no: <span className="font-mono text-gray-700">#{t.id}</span></span>
                          </div>
                          {t.errorMessage && (
                            <div className="text-red-600 bg-red-50 border border-red-100 rounded-lg px-2.5 py-1.5">{t.errorMessage}</div>
                          )}
                          <div>
                            <div className="font-semibold text-gray-700 mb-1">Gönderilen parametreler</div>
                            {t.extraVars && Object.keys(t.extraVars).length > 0 ? (
                              <div className="grid gap-0.5" style={{ gridTemplateColumns: "max-content 1fr" }}>
                                {Object.entries(t.extraVars).map(([k, v]) => (
                                  <React.Fragment key={k}>
                                    <span className="text-gray-500 font-mono pr-3">{k}</span>
                                    <span className="text-gray-800 font-mono break-all">{String(v)}</span>
                                  </React.Fragment>
                                ))}
                              </div>
                            ) : (
                              <span className="text-gray-400">Bu talepte kullanıcı girdisi yok.</span>
                            )}
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between gap-3">
        <span className="text-xs text-gray-400 tabular-nums">{shown}</span>
        <div className="flex items-center gap-2">
          <button onClick={() => page(-1)} disabled={offset === 0 || loading}
            className="px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed">
            Önceki
          </button>
          <button onClick={() => page(1)} disabled={offset + rows.length >= total || loading}
            className="px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed">
            Sonraki
          </button>
        </div>
      </div>
    </div>
  );
}
