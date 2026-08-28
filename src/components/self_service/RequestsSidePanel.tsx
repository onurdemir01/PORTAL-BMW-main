// src/components/self_service/RequestsSidePanel.tsx — "Taleplerim": eskiden modal olarak
// açılan bu ekran artık Self Service sayfasının SAĞINA sabit ayrılmış bir alan (MyRequestsModal
// yerine geçti). Kullanıcı isteğe bağlı daraltabilir (ince bir şerite küçülür, tekrar
// tıklayınca büyür) — durum localStorage'da tutulur, sayfa yenilense de hatırlanır.
import React, { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { ClipboardDocumentListIcon, ChevronDoubleRightIcon, ChevronDoubleLeftIcon, XCircleIcon, ChevronDownIcon, CommandLineIcon, XMarkIcon } from "@heroicons/react/24/outline";
import { ansibleApi, type SmartTicketSummary } from "@/api/ansibleApi";
import AnsibleLogTerminal from "@/components/common/AnsibleLogTerminal";

interface TicketDetail {
  externalTicketId?: string | null;
  flowKey?: string | null;
  templateName?: string | null;
  extraVars?: Record<string, string>;
  awxServerId?: number | null;
}

interface JobOutput {
  status: string;
  output: string;
}

const STATUS_LABELS: Record<string, { label: string; className: string }> = {
  PENDING:   { label: "Onay Bekliyor", className: "bg-amber-50 text-amber-700 border-amber-200" },
  LAUNCHING: { label: "Onaylandı — başlatılıyor", className: "bg-blue-50 text-blue-700 border-blue-200" },
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
  // Bir talebe tıklandığında hangi otomasyonun hangi extraVars ile tetiklendiğini ve hangi
  // Smart kaydını açtığını göstermek için — talep sayısı küçük olduğundan lazy-fetch +
  // basit bir bellek-içi cache yeterli (2026-08-20, kullanıcı talebi).
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [detailCache, setDetailCache] = useState<Record<number, TicketDetail>>({});
  const [detailLoadingId, setDetailLoadingId] = useState<number | null>(null);
  // Onaylanip calistirilmis (LAUNCHED) bir talebin AWX job stdout'u — istege bagli, ayri
  // bir tikla-goster (2026-08-20, kullanici talebi): her talep genisletildiginde otomatik
  // cekilmez, kullanici acikca "Job Çıktısını Gör" demeli (gereksiz AWX cagrisi olmasin).
  const [jobOutputCache, setJobOutputCache] = useState<Record<number, JobOutput>>({});
  const [jobOutputLoadingId, setJobOutputLoadingId] = useState<number | null>(null);
  const [jobOutputOpenId, setJobOutputOpenId] = useState<number | null>(null);

  const toggleDetail = async (id: number) => {
    if (expandedId === id) { setExpandedId(null); return; }
    setExpandedId(id);
    if (detailCache[id]) return;
    setDetailLoadingId(id);
    try {
      const r = await ansibleApi.smartTicketDetail(id);
      if (r.ok) {
        setDetailCache((prev) => ({
          ...prev,
          [id]: { externalTicketId: r.externalTicketId, flowKey: r.flowKey, templateName: r.templateName, extraVars: r.extraVars, awxServerId: r.awxServerId },
        }));
      }
    } catch { /* detay alinamazsa sessizce yoksay - panel yine de kapatilabilir */ }
    finally { setDetailLoadingId(null); }
  };

  const loadJobOutput = async (ticketId: number, serverId: number, jobId: number) => {
    if (jobOutputOpenId === ticketId) { setJobOutputOpenId(null); return; }
    setJobOutputOpenId(ticketId);
    setJobOutputLoadingId(ticketId);
    try {
      const r = await ansibleApi.ssJobStatus(serverId, jobId);
      if (r.ok) {
        setJobOutputCache((prev) => ({ ...prev, [ticketId]: { status: r.status, output: r.output || "" } }));
      }
    } catch { /* yoksay - buton tekrar denemeye izin verir */ }
    finally { setJobOutputLoadingId(null); }
  };

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
    // Gerekce opsiyonel: bos birakilirsa (ya da Iptal'e basilirsa prompt null doner)
    // yine de iptal edilir - not zorunlu tutulmuyor, sadece imkan taniniyor.
    const note = window.prompt(
      "Bu talebi iptal etmek üzeresiniz. Onay gelse bile otomasyon artık tetiklenmeyecek.\n\n" +
      "NOT: Smart tarafındaki kayıt açık kalır, onu Smart ekranından ayrıca kapatmanız gerekir.\n\n" +
      "İptal gerekçesi (opsiyonel):",
      ""
    );
    if (note === null) return; // kullanici vazgecti
    setCancellingId(id);
    try {
      const r = await ansibleApi.cancelSmartTicket(id, note.trim());
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
          <ClipboardDocumentListIcon className="w-5 h-5 text-[var(--accent)]" />
          <span className="text-[11px] font-semibold text-gray-600" style={{ writingMode: "vertical-rl" }}>
            Taleplerim
          </span>
        </button>
      </div>
    );
  }

  return (
    <>
    <div className="flex-shrink-0 w-[340px] sticky top-6 self-start">
      <div className="border border-gray-200 rounded-xl bg-white shadow-[var(--shadow-sm)] overflow-hidden">
        <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-gray-100">
          <div className="flex items-center gap-2 min-w-0">
            <ClipboardDocumentListIcon className="w-5 h-5 text-[var(--accent)] flex-shrink-0" />
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
              <div className="w-5 h-5 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
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
                const isExpanded = expandedId === t.id;
                const detail = detailCache[t.id];
                return (
                  <div key={t.id} className="border border-gray-100 rounded-lg overflow-hidden">
                    <button
                      type="button"
                      onClick={() => toggleDetail(t.id)}
                      title="Hangi otomasyonun hangi bilgilerle tetiklendiğini gör"
                      className="w-full text-left p-2.5 hover:bg-gray-50 transition-colors"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="font-semibold text-sm truncate">{t.templateName || `Talep #${t.id}`}</div>
                        <ChevronDownIcon className={`w-3.5 h-3.5 mt-0.5 flex-shrink-0 text-gray-400 transition-transform ${isExpanded ? "rotate-180" : ""}`} />
                      </div>
                      <div className="text-[11px] mt-0.5" style={{ color: "var(--text-muted)" }}>
                        {formatDate(t.createdAt)}
                        {t.externalTicketId ? ` · Smart #${t.externalTicketId}` : ""}
                        {t.smartStateName ? ` · ${t.smartStateName}` : ""}
                        {t.jobId ? ` · Job #${t.jobId}` : ""}
                      </div>
                      {t.status === "ERROR" && t.errorMessage && (
                        <div className="text-[11px] mt-1 text-red-600">{t.errorMessage}</div>
                      )}
                      <div className="flex items-center justify-between gap-2 mt-2">
                        <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-lg border ${meta.className}`}>{meta.label}</span>
                      </div>
                    </button>

                    {isExpanded && (
                      <div className="px-2.5 pb-2.5 pt-1 border-t border-gray-100 bg-gray-50/60">
                        {detailLoadingId === t.id && !detail && (
                          <div className="flex items-center justify-center py-3">
                            <div className="w-4 h-4 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
                          </div>
                        )}
                        {detail && (
                          <div className="space-y-1.5 text-[11px]">
                            {detail.externalTicketId && (
                              <div><span className="font-semibold text-gray-700">Smart Kayıt No:</span> <span className="font-mono">{detail.externalTicketId}</span></div>
                            )}
                            {detail.flowKey && (
                              <div><span className="font-semibold text-gray-700">Flow:</span> {detail.flowKey}</div>
                            )}
                            <div className="font-semibold text-gray-700 pt-1">Girilen Bilgiler:</div>
                            {detail.extraVars && Object.keys(detail.extraVars).length > 0 ? (
                              <div className="space-y-0.5">
                                {Object.entries(detail.extraVars).map(([k, v]) => (
                                  <div key={k} className="flex gap-1.5">
                                    <span className="text-gray-500 flex-shrink-0">{k}:</span>
                                    <span className="text-gray-800 break-all">{String(v)}</span>
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <div className="text-gray-500">Bu talepte kullanıcı girdisi (extraVars) yok.</div>
                            )}

                            {t.status === "LAUNCHED" && t.jobId && detail.awxServerId && (
                              <div className="pt-2">
                                <button
                                  type="button"
                                  onClick={() => loadJobOutput(t.id, detail.awxServerId!, t.jobId!)}
                                  className="flex items-center gap-1.5 text-[11px] font-semibold px-2 py-1 rounded-lg border border-gray-200 text-gray-700 hover:bg-white transition-colors"
                                >
                                  <CommandLineIcon className="w-3.5 h-3.5" />
                                  Job Çıktısını Gör
                                </button>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )}

                    {t.status === "PENDING" && (
                      <div className="px-2.5 pb-2.5 flex justify-end">
                        <button
                          onClick={() => cancel(t.id)}
                          disabled={cancellingId === t.id}
                          title="Otomasyon tetiklenmeden talebi iptal et"
                          className="flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-lg border border-red-200 text-red-600 hover:bg-red-50 transition-colors disabled:opacity-50"
                        >
                          <XCircleIcon className="w-3.5 h-3.5" />
                          İptal
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {jobOutputOpenId != null && typeof document !== "undefined" && createPortal(
        (() => {
          const t = tickets.find((x) => x.id === jobOutputOpenId);
          const out = jobOutputCache[jobOutputOpenId];
          return (
            <div
              className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-6"
              onClick={(e) => { if (e.target === e.currentTarget) setJobOutputOpenId(null); }}
            >
              <div className="bg-[var(--bg-surface)] rounded-2xl shadow-2xl w-full max-w-5xl h-[80vh] flex flex-col overflow-hidden">
                <div className="flex items-center justify-between gap-3 px-5 py-3 border-b border-[var(--border)] flex-shrink-0">
                  <div className="min-w-0">
                    <div className="font-bold text-sm truncate">{t?.templateName || "Job Çıktısı"}</div>
                    <div className="text-xs" style={{ color: "var(--text-muted)" }}>
                      Job #{t?.jobId}{t?.externalTicketId ? ` · Smart #${t.externalTicketId}` : ""}
                    </div>
                  </div>
                  <button
                    onClick={() => setJobOutputOpenId(null)}
                    className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-elevated)] transition-colors flex-shrink-0"
                    aria-label="Kapat"
                  >
                    <XMarkIcon className="w-5 h-5" />
                  </button>
                </div>
                <div className="flex-1 min-h-0 p-4">
                  {jobOutputLoadingId === jobOutputOpenId && !out ? (
                    <div className="h-full flex items-center justify-center">
                      <div className="w-6 h-6 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
                    </div>
                  ) : out ? (
                    <AnsibleLogTerminal
                      output={out.output}
                      status={out.status}
                      title={`job-${t?.jobId ?? ""}`}
                      size="fill"
                      className="h-full"
                    />
                  ) : null}
                </div>
              </div>
            </div>
          );
        })(),
        document.body
      )}
    </div>
    </>
  );
}
