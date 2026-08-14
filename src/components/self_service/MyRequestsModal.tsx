// src/components/self_service/MyRequestsModal.tsx — "Taleplerim": kullanıcının açtığı TÜM
// Smart taleplerinin kalıcı geçmişi (SurveyModal'daki pendingTicket sadece o modal açıkken/
// o oturumda tek bir talebi izler — bu ekran DB'deki tam geçmişi, sayfa yenilense/oturum
// değişse bile gösterir). PENDING durumundaki bir talep, otomasyon (AWX job'ı) henüz
// TETİKLENMEDİĞİ için buradan iptal edilebilir.
import React, { useCallback, useEffect, useState } from "react";
import { ClipboardDocumentListIcon, XCircleIcon } from "@heroicons/react/24/outline";
import { Modal } from "@/components/common/Modal";
import { ansibleApi, type SmartTicketSummary } from "@/api/ansibleApi";

const STATUS_LABELS: Record<string, { label: string; className: string }> = {
  PENDING:   { label: "Onay Bekliyor", className: "bg-amber-50 text-amber-700 border-amber-200" },
  LAUNCHED:  { label: "Onaylandı — Çalıştırıldı", className: "bg-green-50 text-green-700 border-green-200" },
  REJECTED:  { label: "Reddedildi", className: "bg-red-50 text-red-700 border-red-200" },
  TIMEOUT:   { label: "Zaman Aşımı", className: "bg-gray-100 text-gray-600 border-gray-200" },
  ERROR:     { label: "Hata", className: "bg-red-50 text-red-700 border-red-200" },
  CANCELLED: { label: "İptal Edildi", className: "bg-gray-100 text-gray-600 border-gray-200" },
};

function formatDate(iso: string) {
  try {
    return new Date(iso).toLocaleString("tr-TR");
  } catch {
    return iso;
  }
}

export default function MyRequestsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [tickets, setTickets] = useState<SmartTicketSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [cancellingId, setCancellingId] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErr("");
    try {
      const r = await ansibleApi.smartTicketsMine();
      if (r.ok) setTickets(r.tickets || []);
      else setErr(r.message || "Talepler alınamadı.");
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) load();
  }, [open, load]);

  const cancel = async (id: number) => {
    if (!window.confirm("Bu talebi iptal etmek istediğinize emin misiniz? Onay gelse bile artık işlem tetiklenmeyecek.")) return;
    setCancellingId(id);
    try {
      const r = await ansibleApi.cancelSmartTicket(id);
      if (r.ok) {
        await load();
      } else {
        window.alert(r.message || "İptal edilemedi.");
      }
    } catch (e: unknown) {
      window.alert(e instanceof Error ? e.message : String(e));
    } finally {
      setCancellingId(null);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Taleplerim"
      subtitle="Açtığınız Smart onay taleplerinin durumu"
      icon={ClipboardDocumentListIcon}
      size="lg"
      footer={<button onClick={onClose} className="btn-secondary">Kapat</button>}
    >
      {loading && (
        <div className="flex items-center justify-center py-8">
          <div className="w-5 h-5 border-2 border-[#0066CC] border-t-transparent rounded-full animate-spin" />
        </div>
      )}

      {!loading && err && (
        <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-xl px-4 py-3">{err}</div>
      )}

      {!loading && !err && tickets.length === 0 && (
        <div className="text-sm text-center py-8" style={{ color: "var(--text-muted)" }}>
          Henüz açtığınız bir Smart talebi yok.
        </div>
      )}

      {!loading && !err && tickets.length > 0 && (
        <div className="space-y-2 max-h-[60vh] overflow-y-auto">
          {tickets.map((t) => {
            const meta = STATUS_LABELS[t.status] || { label: t.status, className: "bg-gray-100 text-gray-600 border-gray-200" };
            return (
              <div key={t.id} className="flex items-start justify-between gap-3 p-3 border border-gray-100 rounded-xl">
                <div className="min-w-0">
                  <div className="font-semibold text-sm truncate">{t.templateName || `Talep #${t.id}`}</div>
                  <div className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>
                    Açılış: {formatDate(t.createdAt)}
                    {t.smartStateName ? ` · Smart durumu: ${t.smartStateName}` : ""}
                    {t.jobId ? ` · Job #${t.jobId}` : ""}
                  </div>
                  {t.status === "ERROR" && t.errorMessage && (
                    <div className="text-xs mt-1 text-red-600">{t.errorMessage}</div>
                  )}
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <span className={`text-xs font-semibold px-2 py-1 rounded-lg border ${meta.className}`}>{meta.label}</span>
                  {t.status === "PENDING" && (
                    <button
                      onClick={() => cancel(t.id)}
                      disabled={cancellingId === t.id}
                      title="Otomasyon tetiklenmeden talebi iptal et"
                      className="flex items-center gap-1 text-xs font-semibold px-2 py-1 rounded-lg border border-red-200 text-red-600 hover:bg-red-50 transition-colors disabled:opacity-50"
                    >
                      <XCircleIcon className="w-4 h-4" />
                      İptal
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Modal>
  );
}
