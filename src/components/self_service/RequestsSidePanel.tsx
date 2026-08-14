// src/components/self_service/RequestsSidePanel.tsx — "Taleplerim": eskiden modal olarak
// açılan bu ekran artık Self Service sayfasının SAĞINA sabit ayrılmış bir alan (MyRequestsModal
// yerine geçti). Kullanıcı isteğe bağlı daraltabilir (ince bir şerite küçülür, tekrar
// tıklayınca büyür) — durum localStorage'da tutulur, sayfa yenilense de hatırlanır.
import React, { useCallback, useEffect, useState } from "react";
import { ClipboardDocumentListIcon, ChevronDoubleRightIcon, ChevronDoubleLeftIcon, XCircleIcon } from "@heroicons/react/24/outline";
import { ansibleApi, type SmartTicketSummary } from "@/api/ansibleApi";

const STATUS_LABELS: Record<string, { label: string; className: string }> = {
  PENDING:   { label: "Onay Bekliyor", className: "bg-amber-50 text-amber-700 border-amber-200" },
  LAUNCHED:  { label: "Onaylandı — Çalıştırıldı", className: "bg-green-50 text-green-700 border-green-200" },
  REJECTED:  { label: "Reddedildi", className: "bg-red-50 text-red-700 border-red-200" },
  TIMEOUT:   { label: "Zaman Aşımı", className: "bg-gray-100 text-gray-600 border-gray-200" },
  ERROR:     { label: "Hata", className: "bg-red-50 text-red-700 border-red-200" },
  CANCELLED: { label: "İptal Edildi", className: "bg-gray-100 text-gray-600 border-gray-200" },
};

const COLLAPSE_KEY = "portal.selfService.myRequestsPanel.collapsed";

function formatDate(iso: string) {
  try {
    return new Date(iso).toLocaleString("tr-TR");
  } catch {
    return iso;
  }
}

export default function RequestsSidePanel() {
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try { return window.localStorage.getItem(COLLAPSE_KEY) === "1"; } catch { return false; }
  });
  const [tickets, setTickets] = useState<SmartTicketSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [cancellingId, setCancellingId] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await ansibleApi.smartTicketsMine();
      if (r.ok) { setTickets(r.tickets || []); setErr(""); }
      else setErr(r.message || "Talepler alınamadı.");
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Panel açıkken ve hâlâ PENDING bir talep varken hafifçe otomatik yenilenir — kullanıcı
  // manuel sayfa yenilemeden onay/red durumunu görsün. Kapalıyken (collapsed) veya bekleyen
  // talep yokken gereksiz istek atılmaz.
  useEffect(() => {
    if (collapsed) return;
    if (!tickets.some((t) => t.status === "PENDING")) return;
    const timer = setInterval(load, 30_000);
    return () => clearInterval(timer);
  }, [collapsed, tickets, load]);

  const toggle = () => {
    setCollapsed((prev) => {
      const next = !prev;
      try { window.localStorage.setItem(COLLAPSE_KEY, next ? "1" : "0"); } catch { /* yoksay */ }
      if (!next) load();
      return next;
    });
  };

  const cancel = async (id: number) => {
    if (!window.confirm("Bu talebi iptal etmek istediğinize emin misiniz? Onay gelse bile artık işlem tetiklenmeyecek.")) return;
    setCancellingId(id);
    try {
      const r = await ansibleApi.cancelSmartTicket(id);
      if (r.ok) await load();
      else window.alert(r.message || "İptal edilemedi.");
    } catch (e: unknown) {
      window.alert(e instanceof Error ? e.message : String(e));
    } finally {
      setCancellingId(null);
    }
  };

  const pendingCount = tickets.filter((t) => t.status === "PENDING").length;

  if (collapsed) {
    return (
      <div className="flex-shrink-0 sticky top-6 self-start">
        <button
          onClick={toggle}
          title="Taleplerim'i genişlet"
          className="relative flex flex-col items-center gap-2 py-4 px-2 w-11 rounded-xl border border-gray-200 bg-white hover:bg-gray-50 transition-colors shadow-[var(--shadow-sm)]"
        >
          {pendingCount > 0 && (
            <span className="absolute -top-1.5 -right-1.5 flex items-center justify-center w-4 h-4 text-[10px] font-bold text-white bg-amber-500 rounded-full">
              {pendingCount}
            </span>
          )}
          <ChevronDoubleLeftIcon className="w-4 h-4 text-gray-400" />
          <ClipboardDocumentListIcon className="w-5 h-5 text-[#0066CC]" />
          <span className="text-[11px] font-semibold text-gray-600" style={{ writingMode: "vertical-rl" }}>
            Taleplerim
          </span>
        </button>
      </div>
    );
  }

  return (
    <div className="flex-shrink-0 w-[340px] sticky top-6 self-start">
      <div className="border border-gray-200 rounded-xl bg-white shadow-[var(--shadow-sm)] overflow-hidden">
        <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-gray-100">
          <div className="flex items-center gap-2 min-w-0">
            <ClipboardDocumentListIcon className="w-5 h-5 text-[#0066CC] flex-shrink-0" />
            <div className="min-w-0">
              <div className="font-bold text-sm">Taleplerim</div>
              <div className="text-xs" style={{ color: "var(--text-muted)" }}>Açtığınız Smart talepleri</div>
            </div>
          </div>
          <button
            onClick={toggle}
            title="Daralt"
            className="flex-shrink-0 p-1.5 rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors"
          >
            <ChevronDoubleRightIcon className="w-4 h-4" />
          </button>
        </div>

        <div className="p-3 max-h-[70vh] overflow-y-auto">
          {loading && (
            <div className="flex items-center justify-center py-8">
              <div className="w-5 h-5 border-2 border-[#0066CC] border-t-transparent rounded-full animate-spin" />
            </div>
          )}

          {!loading && err && (
            <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-xl px-3 py-2">{err}</div>
          )}

          {!loading && !err && tickets.length === 0 && (
            <div className="text-sm text-center py-6" style={{ color: "var(--text-muted)" }}>
              Henüz açtığınız bir Smart talebi yok.
            </div>
          )}

          {!loading && !err && tickets.length > 0 && (
            <div className="space-y-2">
              {tickets.map((t) => {
                const meta = STATUS_LABELS[t.status] || { label: t.status, className: "bg-gray-100 text-gray-600 border-gray-200" };
                return (
                  <div key={t.id} className="p-2.5 border border-gray-100 rounded-lg">
                    <div className="font-semibold text-sm truncate">{t.templateName || `Talep #${t.id}`}</div>
                    <div className="text-[11px] mt-0.5" style={{ color: "var(--text-muted)" }}>
                      {formatDate(t.createdAt)}
                      {t.smartStateName ? ` · ${t.smartStateName}` : ""}
                      {t.jobId ? ` · Job #${t.jobId}` : ""}
                    </div>
                    {t.status === "ERROR" && t.errorMessage && (
                      <div className="text-[11px] mt-1 text-red-600">{t.errorMessage}</div>
                    )}
                    <div className="flex items-center justify-between gap-2 mt-2">
                      <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-lg border ${meta.className}`}>{meta.label}</span>
                      {t.status === "PENDING" && (
                        <button
                          onClick={() => cancel(t.id)}
                          disabled={cancellingId === t.id}
                          title="Otomasyon tetiklenmeden talebi iptal et"
                          className="flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-lg border border-red-200 text-red-600 hover:bg-red-50 transition-colors disabled:opacity-50"
                        >
                          <XCircleIcon className="w-3.5 h-3.5" />
                          İptal
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
