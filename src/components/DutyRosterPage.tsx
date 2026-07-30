import React, { useEffect, useState } from "react";
import { nobetciApi, type NobetciResult, type NobetRecord, type QuickLink } from "@/api/nobetciApi";
import { QuestionMarkCircleIcon, PhoneIcon, CalendarIcon, LinkIcon } from "@heroicons/react/24/outline";
import HelpModal, { type HelpSection } from "@/components/common/HelpModal";

const DUTY_ROSTER_HELP_SECTIONS: HelpSection[] = [
  {
    icon: PhoneIcon,
    title: "Bugünün Nöbetçisi",
    body: "Üstteki kart, bugün nöbetçi olan kişiyi dahili/telefon/e-posta bilgileriyle gösterir. Birincil nöbetçiye ulaşılamazsa, kartta gösterilen \"Yedek\" kişi aranmalıdır.",
  },
  {
    icon: CalendarIcon,
    title: "Nöbet Takvimi",
    body: "Tablo, seçilen aya ait tüm nöbet dönemlerini listeler — \"Ay\" filtresiyle geçmiş/gelecek dönemleri görebilir, \"Tümü\" ile filtreyi kaldırabilirsiniz. Bugüne ait satır mavi vurgu ile işaretlenir.",
  },
  {
    icon: LinkIcon,
    title: "Hızlı Bağlantılar",
    body: "Sayfanın altındaki kısayollar, nöbetle ilgili sık kullanılan harici sayfalara (ör. eskalasyon prosedürü) doğrudan erişim sağlar.",
  },
];

// ---------- helpers ----------
function formatDate(iso: string | null): string {
  if (!iso) return "-";
  const d = new Date(iso);
  return isNaN(d.getTime()) ? iso : d.toLocaleDateString("tr-TR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function getYearMonth(iso: string | null): string {
  if (!iso) return "";
  const m = iso.match(/^(\d{4}-\d{2})/);
  return m ? m[1] : "";
}

// ---------- Avatar helper ----------
function Avatar({ name, avatarUrl, size = "md" }: { name?: string | null; avatarUrl?: string | null; size?: "sm" | "md" | "lg" }) {
  const cls = size === "lg" ? "h-16 w-16 text-xl" : size === "md" ? "h-12 w-12 text-lg" : "h-8 w-8 text-sm";
  if (avatarUrl) {
    return <img src={avatarUrl} alt={name ?? ""} className={`${cls} rounded-full object-cover flex-shrink-0 ring-2 ring-white`} style={{ boxShadow: "var(--shadow-md)" }} />;
  }
  return (
    <div className={`${cls} rounded-full flex items-center justify-center text-white font-bold flex-shrink-0`} style={{ background: "var(--accent)", boxShadow: "var(--shadow-md)" }}>
      {name?.[0]?.toUpperCase() ?? "?"}
    </div>
  );
}

// ============================================================
export default function DutyRosterPage() {
  // ── Bugünün nöbetçisi
  const [nobetci, setNobetci] = useState<NobetciResult | null>(null);

  // ── Nöbet takvimi
  const [nobetList, setNobetList]           = useState<NobetRecord[]>([]);
  const [nobetListLoading, setNobetListLoading] = useState(true);

  // ── Ay filtresi
  const today = new Date();
  const defaultMonth = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;
  const [filterMonth, setFilterMonth] = useState<string>(defaultMonth);

  // ── Quick links
  const [quickLinks, setQuickLinks] = useState<QuickLink[]>([]);

  const [showHelp, setShowHelp] = useState(false);

  useEffect(() => {
    nobetciApi.today().then(setNobetci).catch(() => setNobetci({ ok: false, message: "Bağlanılamadı" }));
    setNobetListLoading(true);
    nobetciApi.list()
      .then((r) => setNobetList(r.records ?? []))
      .catch(() => setNobetList([]))
      .finally(() => setNobetListLoading(false));
    nobetciApi.links().then(setQuickLinks).catch(() => setQuickLinks([]));
  }, []);

  // Client-side filtreleme
  const filtered = filterMonth
    ? nobetList.filter((r) => getYearMonth(r.startDate) === filterMonth)
    : nobetList;

  return (
    <div className="space-y-5 pb-8">

      {/* ── Başlık ────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-4">
        <h1 className="page-title">Nöbet Çizelgesi</h1>
        <button
          onClick={() => setShowHelp(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-xl border transition-colors flex-shrink-0"
          style={{ color: "var(--text-muted)", borderColor: "var(--border)" }}
        >
          <QuestionMarkCircleIcon className="w-4 h-4" />
          Yardım
        </button>
      </div>

      {/* ── Bugünün Nöbetçisi ─────────────────────────────────────── */}
      {nobetci && (
        nobetci.ok ? (
          <div
            className="rounded-2xl px-6 py-5 border"
            style={{
              background: "linear-gradient(135deg, rgba(79,142,255,0.06) 0%, rgba(139,92,246,0.04) 100%)",
              borderColor: "rgba(79,142,255,0.15)",
              boxShadow: "var(--shadow-md)"
            }}
          >
            <div className="flex flex-wrap items-start gap-4">

              {/* Canlı indicator */}
              <div className="flex items-center gap-2 pt-1">
                <span className="relative flex h-3 w-3">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75" />
                  <span className="relative inline-flex h-3 w-3 rounded-full bg-blue-500" />
                </span>
              </div>

              <Avatar name={nobetci.name} avatarUrl={nobetci.avatarUrl} size="lg" />

              <div className="flex-1 min-w-0">
                <div className="section-label mb-1" style={{ color: "var(--accent)" }}>
                  Bugünün Nöbetçisi
                </div>
                <div className="text-2xl font-black leading-tight truncate" style={{ color: "var(--text-primary)" }}>
                  {nobetci.name ?? "-"}
                </div>
                {(nobetci.title || nobetci.department) && (
                  <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-0.5">
                    {nobetci.title      && <span className="text-sm text-blue-700 font-medium">{nobetci.title}</span>}
                    {nobetci.department && <span className="text-sm text-slate-500">{nobetci.department}</span>}
                  </div>
                )}
                <div className="flex flex-wrap gap-x-6 gap-y-1 mt-2 text-sm text-slate-600">
                  {nobetci.intercom && (
                    <span className="flex items-center gap-1.5">
                      <span className="text-slate-400">☎</span>
                      <span>Dahili: <b className="text-slate-800">{nobetci.intercom}</b></span>
                    </span>
                  )}
                  {nobetci.phone && (
                    <span className="flex items-center gap-1.5">
                      <span className="text-slate-400">📱</span>
                      <span>{nobetci.phone}</span>
                    </span>
                  )}
                  {nobetci.email && (
                    <span className="flex items-center gap-1.5">
                      <span className="text-slate-400">@</span>
                      <span className="truncate">{nobetci.email}</span>
                    </span>
                  )}
                </div>

                {nobetci.yedekName && (
                  <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl bg-white/60 px-3 py-2 text-sm border border-blue-100">
                    <span className="text-slate-400 text-xs font-semibold uppercase tracking-wide">Yedek</span>
                    <span className="font-semibold text-slate-700">{nobetci.yedekName}</span>
                    {nobetci.yedekIntercom && <span className="text-slate-500">Dahili: <b>{nobetci.yedekIntercom}</b></span>}
                    {nobetci.yedekEmail    && <span className="text-slate-500">{nobetci.yedekEmail}</span>}
                  </div>
                )}
              </div>

              {/* Tarih badge */}
              {nobetci.date && (
                <div className="text-right text-xs text-slate-400 flex-shrink-0">
                  <div className="text-2xl font-bold text-slate-200">{today.getDate()}</div>
                  <div>{nobetci.date}</div>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="card px-5 py-4 text-sm flex items-center gap-3" style={{ color: "var(--text-muted)" }}>
            <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: "var(--text-muted)" }} />
            {nobetci.message ?? "Nöbet bilgisi alınamadı"}
          </div>
        )
      )}

      {/* ── Nöbet Takvimi ─────────────────────────────────────────── */}
      <div className="card overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 border-b" style={{ background: "var(--bg-base)", borderColor: "var(--border)" }}>
          <div>
            <div className="text-base font-bold" style={{ color: "var(--text-primary)" }}>Nöbet Takvimi</div>
            <div className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>
              {filtered.length} kayıt
              {nobetListLoading && " • yükleniyor..."}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs font-medium" style={{ color: "var(--text-muted)" }}>Ay</label>
            <input
              type="month"
              value={filterMonth}
              onChange={(e) => setFilterMonth(e.target.value)}
              className="rounded-xl border px-3 py-1.5 text-sm outline-none bg-white transition-all"
              style={{ borderColor: "var(--border)", color: "var(--text-primary)" }}
              onFocus={e => { (e.target as HTMLInputElement).style.borderColor = "var(--accent)"; (e.target as HTMLInputElement).style.boxShadow = "0 0 0 3px var(--accent-glow)"; }}
              onBlur={e => { (e.target as HTMLInputElement).style.borderColor = "var(--border)"; (e.target as HTMLInputElement).style.boxShadow = ""; }}
            />
            {filterMonth && (
              <button
                onClick={() => setFilterMonth("")}
                className="text-xs px-2 py-1.5 rounded-lg transition-colors"
                style={{ color: "var(--text-muted)" }}
              >
                Tümü
              </button>
            )}
          </div>
        </div>

        {nobetList.length === 0 && !nobetListLoading ? (
          <div className="px-5 py-10 text-sm text-center" style={{ color: "var(--text-muted)" }}>
            Nöbet takvimine ulaşılamadı veya kayıt yok.
          </div>
        ) : filtered.length === 0 ? (
          <div className="px-5 py-10 text-sm text-center" style={{ color: "var(--text-muted)" }}>
            Bu ay için nöbet kaydı bulunamadı.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm min-w-[640px]" style={{ borderCollapse: "separate", borderSpacing: 0 }}>
              <thead>
                <tr style={{ background: "var(--bg-base)", borderBottom: "1px solid var(--border)" }}>
                  {["Başlangıç", "Bitiş", "Nöbetçi", "Dahili", "Telefon", "E-posta", "Yedek"].map(h => (
                    <th key={h} className="px-4 py-3 whitespace-nowrap" style={{ fontSize: "10px", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-muted)" }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((r, i) => (
                  <tr
                    key={r.asRecordId ?? i}
                    className="transition-colors"
                    style={{
                      borderBottom: "1px solid var(--border)",
                      ...(r.isToday
                        ? { background: "rgba(79,142,255,0.06)", borderLeft: "4px solid var(--accent)" }
                        : {}
                      )
                    }}
                    onMouseEnter={e => { if (!r.isToday) (e.currentTarget as HTMLTableRowElement).style.background = "rgba(79,142,255,0.03)"; }}
                    onMouseLeave={e => { if (!r.isToday) (e.currentTarget as HTMLTableRowElement).style.background = ""; }}
                  >
                    <td className="px-4 py-3.5 whitespace-nowrap" style={{ color: "var(--text-secondary)" }}>
                      {r.isToday && (
                        <span className="mr-2 inline-flex h-2 w-2 rounded-full align-middle" style={{ background: "var(--accent)" }} />
                      )}
                      {formatDate(r.startDate)}
                    </td>
                    <td className="px-4 py-3.5 whitespace-nowrap" style={{ color: "var(--text-muted)" }}>{formatDate(r.endDate)}</td>
                    <td className="px-4 py-3.5 font-semibold" style={{ color: "var(--text-primary)" }}>{r.asNobetci?.name ?? "-"}</td>
                    <td className="px-4 py-3.5" style={{ color: "var(--text-secondary)" }}>{r.asNobetci?.intercom ?? "-"}</td>
                    <td className="px-4 py-3.5" style={{ color: "var(--text-secondary)" }}>{r.asNobetci?.phone ?? "-"}</td>
                    <td className="px-4 py-3.5 max-w-[180px] truncate" style={{ color: "var(--text-muted)" }}>{r.asNobetci?.email ?? "-"}</td>
                    <td className="px-4 py-3.5">
                      {r.yedekNobetci?.name
                        ? <span style={{ color: "var(--text-muted)" }}>{r.yedekNobetci.name}</span>
                        : <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded" style={{ background: "var(--bg-elevated)", color: "var(--text-muted)" }}>Yedek Yok</span>
                      }
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Quick Links ──────────────────────────────────────────── */}
      {quickLinks.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {quickLinks.map((link) => (
            <a
              key={link.id}
              href={link.url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl border bg-white transition-all text-sm font-medium"
              style={{ borderColor: "var(--border)", color: "var(--accent)", boxShadow: "var(--shadow-xs)" }}
            >
              {link.icon && <span className="leading-none">{link.icon}</span>}
              {link.label}
            </a>
          ))}
        </div>
      )}

      <HelpModal
        open={showHelp}
        onClose={() => setShowHelp(false)}
        title="Nöbet Çizelgesi — Nasıl Kullanılır?"
        sections={DUTY_ROSTER_HELP_SECTIONS}
      />
    </div>
  );
}
