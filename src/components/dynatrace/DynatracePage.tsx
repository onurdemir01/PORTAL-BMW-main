// src/components/dynatrace/DynatracePage.tsx — Dynatrace MANAGED gözlemlenebilirlik sayfası
//
// Kurumdaki MCP sunucusu dynatrace-managed-mcp: DQL/Grail YOK — yetenekler:
// Problems, Events, Entities, Metrics, Logs. Doğal dil analizi AI Analist sayfasında
// (/ai-analyst) — orada LLM, MCP tool'larını zincirleme çağırarak analiz yapar.
import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { dynatraceApi, friendlyDtError, type DtProblem, type DtEvent, type DtEntity } from "@/api/dynatraceApi";
import { instanaApi, firstArrayField, type InstanaItem } from "@/api/instanaApi";
import { splunkApi, friendlySplunkError, type SplunkSearchResult } from "@/api/splunkApi";
import { seedAiAnalystChat } from "@/utils/aiHandoff";
import { useAuth } from "@/contexts/AuthContext";
import Tabs from "@/components/common/Tabs";
import Card from "@/components/common/Card";
import Badge from "@/components/common/Badge";
import Button from "@/components/common/Button";
import EmptyState from "@/components/common/EmptyState";
import SectionHeader from "@/components/common/SectionHeader";
import StatTile from "@/components/common/StatTile";
import { SparklesIcon, ArrowRightIcon, ArrowPathIcon, QuestionMarkCircleIcon, ChartBarIcon } from "@heroicons/react/24/outline";
import HelpModal, { type HelpSection } from "@/components/common/HelpModal";

const PERFORMANCE_HELP_SECTIONS: HelpSection[] = [
  {
    icon: ChartBarIcon,
    title: "Problemler / Events / Entities / Metrikler",
    body: "Bu dört sekme doğrudan Dynatrace Managed'dan gelir: açık problemler, olay akışı, izlenen varlıklar (host/servis/uygulama) ve seçtiğiniz metriklerin canlı görünümü. Üstteki ortam (environment) seçici, hangi Dynatrace ortamına bakıldığını belirler.",
  },
  {
    icon: SparklesIcon,
    title: "Instana ve Splunk",
    body: "Bu iki sekme Dynatrace bağlantısından bağımsız çalışır — Dynatrace'e erişim olmasa bile Instana metrikleri ve Splunk aramaları kullanılabilir.",
  },
  {
    icon: ArrowRightIcon,
    title: "AI Analist ile Analiz",
    body: "\"AI Analist ile analiz et\" kartı, doğal dilde yazdığınız bir soruyu AI Analist sayfasına taşır — AI orada Dynatrace/Instana araçlarını zincirleme çağırarak kök neden analizi yapar.",
  },
];

// ── Ortak küçük bileşenler ────────────────────────────────────────────────────

function SeverityBadge({ level }: { level: string }) {
  const colors: Record<string, string> = {
    AVAILABILITY: "bg-red-100 text-red-700",
    ERROR: "bg-red-50 text-red-600",
    PERFORMANCE: "bg-amber-100 text-amber-700",
    RESOURCE_CONTENTION: "bg-orange-100 text-orange-700",
    CUSTOM_ALERT: "bg-blue-100 text-blue-700",
    MONITORING_UNAVAILABLE: "bg-gray-100 text-gray-600",
  };
  return (
    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap ${colors[level] || "bg-slate-100 text-slate-600"}`}>
      {level || "?"}
    </span>
  );
}

// Ham MCP metni — LLM'e yönelik formatlı çıktı; kullanıcıya katlanabilir gösterilir
function RawText({ text }: { text?: string }) {
  const [open, setOpen] = useState(false);
  if (!text) return null;
  return (
    <div>
      <button onClick={() => setOpen((v) => !v)} className="text-xs text-slate-400 hover:text-slate-600 underline">
        {open ? "Ham çıktıyı gizle" : "Ham çıktıyı göster"}
      </button>
      {open && (
        <pre className="mt-2 text-xs font-mono rounded-xl p-3 overflow-auto max-h-72 whitespace-pre-wrap" style={{ background: "var(--term-bg)", color: "var(--term-fg)" }}>
          {text}
        </pre>
      )}
    </div>
  );
}

// ── MCP metni içinden gömülü JSON'u çıkarıp okunur hale getiren yardımcılar ─────
// MCP yanıtı LLM'e yönelik: "... in the following json:\n{...}\nNext Steps:..." biçiminde
// düz metin + gömülü bir JSON nesnesi içerir. Kullanıcıya ham JSON yerine yapılandırılmış
// bir özet göstermek için ilk dengeli {...} bloğunu ayıklarız.
function extractEmbeddedJson(text?: string): Record<string, unknown> | null {
  if (!text) return null;
  const start = text.indexOf("{");
  if (start < 0) return null;
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
    } else if (ch === '"') inStr = true;
    else if (ch === "{") depth++;
    else if (ch === "}") { depth--; if (depth === 0) {
      try { return JSON.parse(text.slice(start, i + 1)); } catch { return null; }
    } }
  }
  return null;
}

function extractDtUrl(text: string | undefined, problemId: string): string | null {
  if (!text) return null;
  const m = text.match(/https?:\/\/\S+problemdetails;pid=\S*/i);
  if (!m) return null;
  return m[0].replace(/<problemId>|%3CproblemId%3E/gi, problemId).replace(/[.,)\s]+$/, "");
}

function fmtEpoch(ms: unknown): string {
  const n = Number(ms);
  if (!n || n < 0) return "—";
  try { return new Date(n).toLocaleString("tr-TR", { dateStyle: "short", timeStyle: "short" }); }
  catch { return "—"; }
}

// Kanıt (evidence) satırlarından insan-okur açıklama çıkarır.
function evidenceLines(json: Record<string, unknown>): string[] {
  const ev = (json.evidenceDetails as { details?: unknown[] })?.details;
  if (!Array.isArray(ev)) return [];
  const out: string[] = [];
  for (const d of ev as Record<string, unknown>[]) {
    if (d.evidenceType === "EVENT") {
      const props = ((d.data as { properties?: { key: string; value: string }[] })?.properties) || [];
      const desc = props.find((p) => p.key === "dt.event.description")?.value;
      out.push(desc || String(d.displayName || "Olay"));
    } else if (d.evidenceType === "METRIC") {
      const before = d.valueBeforeChangePoint, after = d.valueAfterChangePoint;
      const name = String(d.displayName || "Metrik");
      const unit = String(d.unit || "");
      if (before !== undefined && after !== undefined) {
        out.push(`${name}: ${Number(before).toFixed(1)}${unit === "Percent" ? "%" : ""} → ${Number(after).toFixed(1)}${unit === "Percent" ? "%" : ""}`);
      } else out.push(name);
    } else if (d.displayName) {
      out.push(String(d.displayName));
    }
  }
  return out;
}

function entityNames(list: unknown): string[] {
  if (!Array.isArray(list)) return [];
  return (list as Record<string, unknown>[]).map((e) => String(e.name || "")).filter(Boolean);
}

// Problem detayını okunur bir panel + ham metin fallback olarak gösterir.
function ProblemDetailBody({ text }: { text: string }) {
  const json = extractEmbeddedJson(text);
  if (!json) {
    // JSON ayıklanamadıysa (ör. hata mesajı) ham metni göster.
    return (
      <div className="px-5 py-4">
        <p className="text-sm text-slate-600 whitespace-pre-wrap">{text}</p>
      </div>
    );
  }
  const affected = entityNames(json.affectedEntities);
  const rootCause = (json.rootCauseEntity as { name?: string })?.name;
  const zones = entityNames(json.managementZones);
  const evidence = evidenceLines(json);
  const dtUrl = extractDtUrl(text, String(json.problemId || ""));

  const Row = ({ label, children }: { label: string; children: React.ReactNode }) => (
    <div className="flex gap-2 text-sm">
      <span className="text-slate-400 w-28 flex-shrink-0">{label}</span>
      <span className="text-slate-700 min-w-0">{children}</span>
    </div>
  );

  return (
    <div className="px-5 py-4 space-y-4 overflow-y-auto">
      <div className="flex items-center gap-2 flex-wrap">
        <SeverityBadge level={String(json.severityLevel || "")} />
        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${json.status === "OPEN" ? "bg-red-50 text-red-600" : "bg-green-50 text-green-600"}`}>
          {String(json.status || "")}
        </span>
        <h3 className="text-base font-bold text-slate-800">{String(json.title || "Problem")}</h3>
      </div>

      <div className="space-y-1.5">
        <Row label="Problem ID">{String(json.displayId || json.problemId || "—")}</Row>
        <Row label="Etki seviyesi">{String(json.impactLevel || "—")}</Row>
        {zones.length > 0 && <Row label="Yönetim bölgesi">{zones.join(", ")}</Row>}
        <Row label="Başlangıç">{fmtEpoch(json.startTime)}</Row>
        {Number(json.endTime) > 0 && <Row label="Bitiş">{fmtEpoch(json.endTime)}</Row>}
      </div>

      {rootCause && (
        <div className="rounded-xl bg-red-50 border border-red-100 p-3">
          <p className="text-[11px] font-semibold text-red-600 uppercase tracking-wide mb-1">Kök Neden</p>
          <p className="text-sm text-slate-700">{rootCause}</p>
        </div>
      )}

      {affected.length > 0 && (
        <div>
          <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-1.5">Etkilenen Sistemler ({affected.length})</p>
          <div className="flex flex-wrap gap-1.5">
            {affected.map((n, i) => (
              <span key={i} className="text-xs bg-slate-100 text-slate-700 px-2 py-1 rounded-lg font-mono">{n}</span>
            ))}
          </div>
        </div>
      )}

      {evidence.length > 0 && (
        <div>
          <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-1.5">Kanıtlar</p>
          <ul className="space-y-1">
            {evidence.map((e, i) => (
              <li key={i} className="text-sm text-slate-700 flex gap-2">
                <span className="text-slate-300">•</span><span className="min-w-0">{e}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {dtUrl && (
        <a href={dtUrl} target="_blank" rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-xs font-medium text-blue-600 hover:underline">
          Dynatrace'te aç <ArrowRightIcon className="w-3.5 h-3.5" />
        </a>
      )}

      <RawText text={text} />
    </div>
  );
}

function ErrorBox({ msg }: { msg: string }) {
  return <div className="text-sm text-red-500 bg-red-50 rounded-xl px-4 py-3">{msg}</div>;
}

function Skeletons({ n = 3 }: { n?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: n }, (_, i) => <div key={i} className="h-14 rounded-xl bg-slate-100 animate-pulse" />)}
    </div>
  );
}

// Bağlantı yok banner'ı — gerçek hata detayıyla
function NotConfigured({ detail }: { detail?: string | null }) {
  return (
    <div className="rounded-2xl border border-amber-100 bg-amber-50 px-5 py-6 text-sm text-amber-800 flex flex-col gap-2">
      <div className="font-semibold text-amber-900">Dynatrace MCP sunucusuna ulaşılamıyor</div>
      <div className="text-amber-700">
        Bu genellikle bir ağ/VPN erişim sorunudur — kurumsal ağda/VPN üzerinde olduğunuzdan emin olun.
        Adres <code className="font-mono bg-amber-100 px-1 rounded">DT_MANAGED_MCP_URL</code> ile
        <code className="font-mono bg-amber-100 px-1 rounded">.env.local</code>'dan yönetilir.
      </div>
      {detail && (
        <div className="text-xs text-amber-600 font-mono bg-amber-100/60 rounded-lg px-2.5 py-1.5 break-all">
          Son hata: {detail}
        </div>
      )}
    </div>
  );
}

// ── Tab 1: Problemler ─────────────────────────────────────────────────────────

function ProblemsTab({ env }: { env: string }) {
  const navigate = useNavigate();
  const [problems, setProblems] = useState<DtProblem[] | null>(null);
  const [rawText, setRawText]   = useState<string>("");
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState<string | null>(null);
  const [status, setStatus]     = useState("OPEN");
  const [host, setHost]         = useState("");
  const [detail, setDetail]     = useState<{ id: string; title: string; text: string } | null>(null);

  const load = (refresh = false) => {
    setLoading(true); setError(null);
    dynatraceApi.problems({ env, status, host: host.trim() || undefined, refresh })
      .then((r) => {
        if (!r.ok) setError(friendlyDtError(r.message));
        else { setProblems(r.problems ?? []); setRawText(r.text ?? ""); }
      })
      .catch((e) => setError(friendlyDtError(e.message)))
      .finally(() => setLoading(false));
  };

  // env/status değişince otomatik yenile; host filtresi Enter'a basılınca tetiklenir
  // (sunucu tarafında başlık bazlı metin araması — bkz. server/dynatrace/index.cjs filterProblems).
  useEffect(() => { load(); }, [env, status]); // eslint-disable-line react-hooks/exhaustive-deps

  async function openDetail(id: string, title: string) {
    setDetail({ id, title, text: "Yükleniyor…" });
    const r = await dynatraceApi.problemDetails(id, env).catch((e) => ({ ok: false, message: e.message, text: "" }));
    setDetail({ id, title, text: r.ok ? (r.text ?? "") : friendlyDtError((r as { message?: string }).message) });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-semibold text-slate-700">Problemler</span>
          {problems != null && <span className="text-xs text-slate-400">({problems.length} kayıt)</span>}
          <select value={status} onChange={(e) => setStatus(e.target.value)}
            className="text-xs border rounded-lg px-2 py-1 outline-none">
            <option value="OPEN">Açık</option>
            <option value="CLOSED">Kapalı</option>
          </select>
          <input value={host} onChange={(e) => setHost(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && load()}
            placeholder="Başlıkta host/servis ara…"
            className="text-xs border rounded-lg px-2 py-1 outline-none w-40 focus:ring-2 focus:ring-blue-200" />
        </div>
        <Button variant="ghost" size="sm" onClick={() => load(true)} disabled={loading}
          icon={<ArrowPathIcon className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />}>
          Yenile
        </Button>
      </div>

      {error && <ErrorBox msg={error} />}
      {loading && !problems && <Skeletons />}

      {problems?.length === 0 && !loading && !error && (
        <EmptyState icon="✓" title={status === "OPEN" ? "Açık problem yok. Sistem normal çalışıyor." : "Kayıt bulunamadı."} />
      )}

      {problems && problems.length > 0 && (
        <div className="space-y-2">
          {problems.map((p) => (
            <Card key={p.problemId} as="button" padding="sm"
              className="w-full text-left flex flex-wrap items-start gap-3 hover:border-blue-200 transition-colors"
              onClick={() => openDetail(p.problemId, p.title)}>
              <SeverityBadge level={p.severityLevel} />
              <div className="flex-1 min-w-0">
                <div className="font-medium text-sm text-slate-800 leading-snug">{p.title}</div>
                <div className="text-xs text-slate-400 mt-0.5">
                  {p.displayId} · {p.status}{p.impactLevel ? ` · ${p.impactLevel}` : ""}
                </div>
              </div>
              {p.startTime && <div className="text-[11px] text-slate-400 flex-shrink-0">{p.startTime}</div>}
            </Card>
          ))}
        </div>
      )}

      <RawText text={rawText} />

      {/* Problem detay modalı */}
      {detail && typeof document !== "undefined" && createPortal(
        <div className="fixed inset-0 z-50 overflow-y-auto p-4" style={{ background: "rgba(3,9,18,0.6)", backdropFilter: "blur(4px)" }}>
          <div className="min-h-full flex items-center justify-center" onClick={(e) => { if (e.target === e.currentTarget) setDetail(null); }}>
            <div className="rounded-2xl w-full max-w-2xl flex flex-col max-h-[calc(100dvh-2rem)] my-4" style={{ background: "var(--bg-surface)", boxShadow: "var(--shadow-lg)" }}>
              <div className="flex items-center justify-between px-5 py-3 border-b flex-shrink-0 gap-2" style={{ borderColor: "var(--border)" }}>
                <span className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>Problem Detayı</span>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => seedAiAnalystChat(navigate,
                      `Dynatrace problemi "${detail.title}" (ID: ${detail.id}) için kök neden analizi yap — problem detayını ve ilişkili event/metrikleri incele.`)}
                    className="text-xs px-3 py-1.5 rounded-lg font-medium flex items-center gap-1.5"
                    style={{ background: "var(--status-info-bg)", color: "var(--status-info)" }}>
                    <SparklesIcon className="w-3.5 h-3.5" /> AI ile kök neden analizi
                  </button>
                  <button onClick={() => setDetail(null)} className="text-slate-400 hover:text-slate-600 text-lg leading-none px-2">×</button>
                </div>
              </div>
              <div className="flex-1 overflow-y-auto">
                {detail.text === "Yükleniyor…"
                  ? <p className="px-5 py-6 text-sm text-slate-400">Yükleniyor…</p>
                  : <ProblemDetailBody text={detail.text} />}
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}

// ── Tab 2: Events ─────────────────────────────────────────────────────────────

const EVENT_TYPES = ["", "CONTAINER_RESTART", "CUSTOM_INFO", "CUSTOM_DEPLOYMENT", "RESOURCE_CONTENTION_EVENT", "PROCESS_RESTART"];

// Dynatrace event tipi → anlaşılır Türkçe etiket + renk sınıfı.
const EVENT_TYPE_INFO: Record<string, { label: string; cls: string }> = {
  PGI_UNAVAILABLE:              { label: "Süreç kullanılamıyor", cls: "bg-red-50 text-red-600" },
  OSI_HIGH_CPU:                 { label: "Yüksek CPU", cls: "bg-orange-50 text-orange-600" },
  OSI_HIGH_MEMORY:              { label: "Yüksek bellek", cls: "bg-orange-50 text-orange-600" },
  ERROR_EVENT:                  { label: "Hata", cls: "bg-red-50 text-red-600" },
  SERVICE_ERROR_RATE_INCREASED: { label: "Hata oranı arttı", cls: "bg-red-50 text-red-600" },
  SERVICE_SLOWDOWN:             { label: "Yavaşlama", cls: "bg-amber-50 text-amber-700" },
  CUSTOM_INFO:                  { label: "Bilgi", cls: "bg-slate-100 text-slate-600" },
  CUSTOM_ALERT:                 { label: "Özel uyarı", cls: "bg-blue-50 text-blue-700" },
  CONTAINER_RESTART:            { label: "Container yeniden başladı", cls: "bg-indigo-50 text-indigo-700" },
  PROCESS_RESTART:              { label: "Süreç yeniden başladı", cls: "bg-indigo-50 text-indigo-700" },
  CUSTOM_DEPLOYMENT:            { label: "Deployment", cls: "bg-teal-50 text-teal-700" },
};
function eventLabel(type: string): { label: string; cls: string } {
  return EVENT_TYPE_INFO[type] || { label: type, cls: "bg-indigo-50 text-indigo-700" };
}
const TIME_RANGES = [
  { label: "Son 1 saat", value: "now-1h" },
  { label: "Son 6 saat", value: "now-6h" },
  { label: "Son 24 saat", value: "now-24h" },
  { label: "Son 3 gün", value: "now-3d" },
];

function EventsTab({ env }: { env: string }) {
  const [events, setEvents]     = useState<DtEvent[] | null>(null);
  const [rawText, setRawText]   = useState("");
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState<string | null>(null);
  const [eventType, setEventType] = useState("");
  const [from, setFrom]         = useState("now-1h");
  const [host, setHost]         = useState("");
  const [tag, setTag]           = useState("");
  const [mz, setMz]             = useState("");

  const load = (refresh = false) => {
    setLoading(true); setError(null);
    dynatraceApi.events({
      env, from, eventType: eventType || undefined, refresh,
      host: host.trim() || undefined, tag: tag.trim() || undefined, managementZone: mz.trim() || undefined,
    })
      .then((r) => {
        if (!r.ok) setError(friendlyDtError(r.message));
        else { setEvents(r.events ?? []); setRawText(r.text ?? ""); }
      })
      .catch((e) => setError(friendlyDtError(e.message)))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, [env, eventType, from]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        <select value={from} onChange={(e) => setFrom(e.target.value)} className="text-xs border rounded-lg px-2 py-1.5 outline-none">
          {TIME_RANGES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
        <select value={eventType} onChange={(e) => setEventType(e.target.value)} className="text-xs border rounded-lg px-2 py-1.5 outline-none">
          <option value="">Tüm event tipleri</option>
          {EVENT_TYPES.filter(Boolean).map((t) => <option key={t} value={t}>{eventLabel(t).label}</option>)}
        </select>
        <input value={host} onChange={(e) => setHost(e.target.value)} onKeyDown={(e) => e.key === "Enter" && load()}
          placeholder="Host" className="text-xs border rounded-lg px-2 py-1.5 outline-none w-28 focus:ring-2 focus:ring-blue-200" />
        <input value={tag} onChange={(e) => setTag(e.target.value)} onKeyDown={(e) => e.key === "Enter" && load()}
          placeholder="Tag (k:v, virgüllü)" className="text-xs border rounded-lg px-2 py-1.5 outline-none w-36 focus:ring-2 focus:ring-blue-200" />
        <input value={mz} onChange={(e) => setMz(e.target.value)} onKeyDown={(e) => e.key === "Enter" && load()}
          placeholder="Management Zone" className="text-xs border rounded-lg px-2 py-1.5 outline-none w-32 focus:ring-2 focus:ring-blue-200" />
        <Button variant="ghost" size="sm" onClick={() => load(true)} disabled={loading}
          icon={<ArrowPathIcon className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />}>
          Yenile
        </Button>
        {events != null && <span className="text-xs text-slate-400">{events.length} event</span>}
      </div>

      {error && <ErrorBox msg={error} />}
      {loading && !events && <Skeletons />}

      {events?.length === 0 && !loading && !error && (
        <EmptyState title="Seçilen aralıkta event bulunamadı." />
      )}

      {events && events.length > 0 && (() => {
        // Aynı tip+başlıktaki event'ler tek satırda sayıyla gruplanır — DT ham akışı
        // çoğu zaman onlarca birbirinin aynı event döner (ör. 50× "disk size less...").
        const groups = new Map<string, { ev: DtEvent; count: number }>();
        for (const ev of events) {
          const key = `${ev.eventType}||${ev.title}`;
          const g = groups.get(key);
          if (g) g.count++;
          else groups.set(key, { ev, count: 1 });
        }
        const list = [...groups.values()];
        return (
          <div className="space-y-2">
            <p className="text-xs text-slate-400">{list.length} benzersiz event ({events.length} toplam)</p>
            {list.map(({ ev, count }) => {
              const info = eventLabel(ev.eventType);
              return (
                <Card key={`${ev.eventType}||${ev.title}`} padding="sm" className="flex flex-wrap items-center gap-3">
                  <Badge className={info.cls}>{info.label}</Badge>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm text-slate-800">{ev.title}</div>
                    <div className="text-xs text-slate-400 mt-0.5">
                      {ev.status === "OPEN" ? "Açık" : ev.status}{ev.startTime ? ` · ${ev.startTime}` : ""}
                    </div>
                  </div>
                  {count > 1 && (
                    <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 flex-shrink-0">×{count}</span>
                  )}
                </Card>
              );
            })}
          </div>
        );
      })()}

      <RawText text={rawText} />
    </div>
  );
}

// ── Tab 3: Entities ───────────────────────────────────────────────────────────

const ENTITY_TYPES = ["SERVICE", "HOST", "PROCESS_GROUP", "APPLICATION", "CLOUD_APPLICATION", "CLOUD_APPLICATION_INSTANCE", "KUBERNETES_CLUSTER"];

function EntitiesTab({ env }: { env: string }) {
  const navigate = useNavigate();
  const [name, setName]       = useState("");
  const [type, setType]       = useState("SERVICE");
  const [tag, setTag]         = useState("");
  const [mz, setMz]           = useState("");
  const [team, setTeam]       = useState("");
  const [entities, setEntities] = useState<DtEntity[] | null>(null);
  const [rawText, setRawText] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState<string | null>(null);

  async function search() {
    if (!name.trim()) return;
    setLoading(true); setError(null); setEntities(null); setRawText("");
    try {
      const r = await dynatraceApi.entities({
        name: name.trim(), type, env,
        tag: tag.trim() || undefined, managementZone: mz.trim() || undefined,
      });
      if (!r.ok) setError(friendlyDtError(r.message));
      else { setEntities(r.entities ?? []); setRawText(r.text ?? ""); }
    } catch (e: unknown) {
      setError(friendlyDtError((e as Error).message));
    } finally { setLoading(false); }
  }

  // Takım filtresi — sunucudan gelen owningTeam alanına göre client-side daraltma
  // (arama sonucu zaten küçük bir sayfa; ayrı bir sunucu round-trip'i gerekmiyor).
  const teamFiltered = team.trim()
    ? (entities ?? []).filter((e) => (e.owningTeam || "").toLowerCase().includes(team.trim().toLowerCase()))
    : entities;
  const teams = Array.from(new Set((entities ?? []).map((e) => e.owningTeam).filter((t): t is string => !!t)));

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        <select value={type} onChange={(e) => setType(e.target.value)} className="text-xs border rounded-lg px-2 py-2 outline-none">
          {ENTITY_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <input value={name} onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && search()}
          placeholder="Entity/host adı ara (örn: payment)"
          className="flex-1 min-w-48 text-sm border rounded-lg px-3 py-1.5 outline-none focus:ring-2 focus:ring-blue-200" />
        <input value={tag} onChange={(e) => setTag(e.target.value)} onKeyDown={(e) => e.key === "Enter" && search()}
          placeholder="Tag" className="text-xs border rounded-lg px-2 py-2 outline-none w-28 focus:ring-2 focus:ring-blue-200" />
        <input value={mz} onChange={(e) => setMz(e.target.value)} onKeyDown={(e) => e.key === "Enter" && search()}
          placeholder="Mgmt Zone" className="text-xs border rounded-lg px-2 py-2 outline-none w-28 focus:ring-2 focus:ring-blue-200" />
        <button onClick={search} disabled={loading || !name.trim()}
          className="text-xs px-4 py-2 rounded-lg bg-[var(--accent)] text-white font-medium disabled:opacity-50">
          {loading ? "Aranıyor…" : "Ara"}
        </button>
      </div>

      {teams.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-slate-400">Ekip:</span>
          <button onClick={() => setTeam("")}
            className={`text-xs px-2.5 py-1 rounded-full border ${!team ? "bg-slate-100 border-slate-300" : "hover:bg-slate-50"}`}>
            Tümü
          </button>
          {teams.map((t) => (
            <button key={t} onClick={() => setTeam(t)}
              className={`text-xs px-2.5 py-1 rounded-full border ${team === t ? "bg-blue-50 border-blue-300 text-blue-700" : "hover:bg-slate-50"}`}>
              {t}
            </button>
          ))}
        </div>
      )}

      {error && <ErrorBox msg={error} />}
      {loading && <Skeletons />}

      {teamFiltered && teamFiltered.length > 0 && (
        <div className="space-y-2">
          {teamFiltered.map((e) => (
            <Card key={e.entityId} padding="sm" className="flex flex-wrap items-center gap-3">
              <Badge className="bg-slate-100 text-slate-600">{e.type}</Badge>
              <div className="flex-1 min-w-0">
                <div className="font-medium text-sm text-slate-800">{e.displayName}</div>
                <div className="text-xs text-slate-400 mt-0.5 font-mono">{e.entityId}</div>
              </div>
              {e.owningTeam ? (
                <Badge className="bg-emerald-50 text-emerald-700">{e.owningTeam}</Badge>
              ) : (
                <Badge weight="normal" className="bg-gray-50 text-gray-400">Atanmamış ekip</Badge>
              )}
              <button
                onClick={() => seedAiAnalystChat(navigate, `"${e.displayName}" (${e.type}, ID: ${e.entityId}) entity'sini analiz et — güncel durumu, ilişkili problem/event'leri özetle.`)}
                className="text-xs px-2 py-1 rounded-lg flex items-center gap-1"
                style={{ background: "var(--status-info-bg)", color: "var(--status-info)" }}>
                <SparklesIcon className="w-3 h-3" /> AI
              </button>
            </Card>
          ))}
        </div>
      )}

      {entities && entities.length === 0 && !loading && !error && (
        <EmptyState title="Eşleşen entity bulunamadı." />
      )}

      <RawText text={rawText} />

      {!entities && !loading && !error && (
        <EmptyState title="Tip seçip ada göre arayın — tag/management zone ile daraltabilir, sonuçlarda ekip sahipliğini görebilirsiniz." />
      )}
    </div>
  );
}

// ── Tab 4: Metrikler ──────────────────────────────────────────────────────────

function MetricsTab({ env }: { env: string }) {
  const [search, setSearch]         = useState("cpu.usage");
  const [listResult, setListResult] = useState("");
  const [selector, setSelector]     = useState("");
  const [queryResult, setQueryResult] = useState("");
  const [loading, setLoading]       = useState(false);
  const [error, setError]           = useState<string | null>(null);

  async function listMetrics() {
    setLoading(true); setError(null); setListResult("");
    try {
      const r = await dynatraceApi.metrics({ search: search.trim() || undefined, env });
      if (!r.ok) setError(friendlyDtError(r.message));
      else setListResult(r.text ?? "");
    } catch (e: unknown) { setError(friendlyDtError((e as Error).message)); }
    finally { setLoading(false); }
  }

  async function runQuery() {
    if (!selector.trim()) return;
    setLoading(true); setError(null); setQueryResult("");
    try {
      const r = await dynatraceApi.metricsQuery({ metricSelector: selector.trim(), env });
      if (!r.ok) setError(friendlyDtError(r.message));
      else setQueryResult(r.text ?? "");
    } catch (e: unknown) { setError(friendlyDtError((e as Error).message)); }
    finally { setLoading(false); }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        <input value={search} onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && listMetrics()}
          placeholder='Metrik ara (örn: "cpu.usage", "response.time", "memory")'
          className="flex-1 min-w-48 text-sm border rounded-lg px-3 py-1.5 outline-none focus:ring-2 focus:ring-blue-200" />
        <button onClick={listMetrics} disabled={loading}
          className="text-xs px-4 py-2 rounded-lg border hover:bg-slate-50 text-slate-600 font-medium disabled:opacity-50">
          Metrikleri Listele
        </button>
      </div>

      {listResult && (
        <pre className="text-xs font-mono rounded-xl p-4 overflow-auto max-h-64 whitespace-pre-wrap" style={{ background: "var(--term-bg)", color: "var(--term-fg)" }}>
          {listResult}
        </pre>
      )}

      <div className="flex items-center gap-2 flex-wrap pt-2 border-t border-slate-100">
        <input value={selector} onChange={(e) => setSelector(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && runQuery()}
          placeholder='Metric selector (örn: builtin:host.cpu.usage:avg) — son 1 saat sorgulanır'
          className="flex-1 min-w-64 text-sm font-mono border rounded-lg px-3 py-1.5 outline-none focus:ring-2 focus:ring-blue-200" />
        <button onClick={runQuery} disabled={loading || !selector.trim()}
          className="text-xs px-4 py-2 rounded-lg bg-[var(--accent)] text-white font-medium disabled:opacity-50">
          Sorgula
        </button>
      </div>

      {error && <ErrorBox msg={error} />}
      {queryResult && (
        <pre className="text-xs font-mono rounded-xl p-4 overflow-auto max-h-[24rem] whitespace-pre-wrap" style={{ background: "var(--term-bg)", color: "var(--term-fg)" }}>
          {queryResult}
        </pre>
      )}
    </div>
  );
}

// ── Tab 5: Instana (roadmap #22 — Dynatrace sekmeleriyle aynı derinlik) ───────
// Instana MCP tool şemaları repo'da bilinmediği için (canlı sunucudan gelir,
// bkz. server/instana/index.cjs üstündeki not) alan adları sabit değil — bu
// yüzden aşağıdaki kart, yaygın alan adı adaylarını dener ve HİÇBİR bilgiyi
// kaybetmemek için ham JSON'u da katlanabilir şekilde altta gösterir.

const TITLE_KEY_CANDIDATES = ["title", "name", "entityName", "host", "hostName", "label", "serviceName", "message", "summary"];
const STATUS_KEY_CANDIDATES = ["status", "severity", "state", "level", "type"];

function pickField(item: Record<string, unknown>, keys: string[]): string | null {
  for (const k of keys) {
    const v = item[k];
    if (typeof v === "string" && v.trim()) return v.trim();
    if (typeof v === "number") return String(v);
  }
  return null;
}

function InstanaItemCard({ item, onAskAi }: { item: InstanaItem; onAskAi: (title: string) => void }) {
  const [open, setOpen] = useState(false);
  const title = pickField(item, TITLE_KEY_CANDIDATES) || "(başlıksız kayıt)";
  const status = pickField(item, STATUS_KEY_CANDIDATES);

  return (
    <Card padding="sm">
      <div className="flex flex-wrap items-center gap-3">
        {status && <Badge className="bg-indigo-50 text-indigo-700">{status}</Badge>}
        <div className="flex-1 min-w-0 font-medium text-sm text-slate-800 truncate" title={title}>{title}</div>
        {item.owningTeam ? (
          <Badge className="bg-emerald-50 text-emerald-700">{item.owningTeam}</Badge>
        ) : (
          <Badge weight="normal" className="bg-gray-50 text-gray-400">Atanmamış ekip</Badge>
        )}
        <button onClick={() => onAskAi(title)}
          className="text-xs px-2 py-1 rounded-lg flex items-center gap-1 flex-shrink-0"
          style={{ background: "var(--status-info-bg)", color: "var(--status-info)" }}>
          <SparklesIcon className="w-3 h-3" /> AI
        </button>
        <button onClick={() => setOpen((v) => !v)} className="text-xs text-slate-400 hover:text-slate-600 underline flex-shrink-0">
          {open ? "detayı gizle" : "detay"}
        </button>
      </div>
      {open && (
        <pre className="mt-2 text-xs font-mono rounded-lg p-3 overflow-auto max-h-56 whitespace-pre-wrap" style={{ background: "var(--term-bg)", color: "var(--term-fg)" }}>
          {JSON.stringify(item, null, 1)}
        </pre>
      )}
    </Card>
  );
}

type InstanaSubTab = "issues" | "events" | "services";
const INSTANA_SUBTABS: { id: InstanaSubTab; label: string }[] = [
  { id: "issues",   label: "Issues"   },
  { id: "events",   label: "Events"   },
  { id: "services", label: "Services" },
];

function InstanaTab() {
  const navigate = useNavigate();
  const [env, setEnv] = useState<"nonprod" | "prod">("nonprod");
  const [sub, setSub] = useState<InstanaSubTab>("issues");
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [items, setItems] = useState<InstanaItem[] | null>(null);
  const [team, setTeam] = useState("");
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = (refresh = false) => {
    setLoading(true); setError(null); setTeam("");
    instanaApi.health(env).then((h) => {
      setConfigured(h.configured);
      if (!h.configured) { setLoading(false); return; }
      const term = q.trim() || undefined;
      const call = sub === "issues" ? instanaApi.problems(env, refresh, term)
        : sub === "events" ? instanaApi.events(env, term)
        : instanaApi.services(env, refresh, term);
      call.then((r) => {
        if (!r.ok) setError(String(r.message || "Instana verisi alınamadı."));
        else setItems(firstArrayField(r));
      }).catch((e) => setError(e.message)).finally(() => setLoading(false));
    }).catch((e) => { setError(e.message); setLoading(false); });
  };

  useEffect(() => { load(); }, [env, sub]); // eslint-disable-line react-hooks/exhaustive-deps

  if (configured === false) {
    return <NotConfigured detail="Instana ortam token/URL değişkenleri (.env.local) tanımlı değil." />;
  }

  const askAi = (title: string) => seedAiAnalystChat(navigate,
    `Instana (${env}) ${sub === "issues" ? "issue" : sub === "events" ? "event" : "servis"}i "${title}" için analiz yap — ilgili Dynatrace verileriyle de korele et.`);

  const teams = Array.from(new Set((items ?? []).map((it) => it.owningTeam).filter((t): t is string => !!t)));
  const teamFiltered = team ? (items ?? []).filter((it) => it.owningTeam === team) : items;

  return (
    <div className="space-y-4">
      <Tabs
        variant="pills" size="sm"
        tabs={INSTANA_SUBTABS.map((t) => ({ id: t.id, label: t.label }))}
        activeTab={INSTANA_SUBTABS.findIndex((t) => t.id === sub)}
        onChange={(i) => setSub(INSTANA_SUBTABS[i].id)}
      />

      <div className="flex items-center gap-2 flex-wrap">
        <select value={env} onChange={(e) => setEnv(e.target.value as "nonprod" | "prod")}
          className="text-xs border rounded-lg px-2 py-1.5 outline-none">
          <option value="nonprod">nonprod</option>
          <option value="prod">prod</option>
        </select>
        <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && load()}
          placeholder="Servis/host ara…"
          className="text-xs border rounded-lg px-2 py-1.5 outline-none w-40 focus:ring-2 focus:ring-blue-200" />
        <Button variant="ghost" size="sm" onClick={() => load(true)} disabled={loading}
          icon={<ArrowPathIcon className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />}>
          Yenile
        </Button>
        {items != null && <span className="text-xs text-slate-400">{teamFiltered?.length ?? 0} kayıt</span>}
        <button
          onClick={() => seedAiAnalystChat(navigate, `Instana (${env}) ortamındaki açık issue'ları özetle ve önceliklendir.`)}
          className="text-xs px-3 py-1.5 rounded-lg font-medium flex items-center gap-1.5 ml-auto"
          style={{ background: "var(--status-info-bg)", color: "var(--status-info)" }}>
          <SparklesIcon className="w-3.5 h-3.5" /> AI ile analiz et
        </button>
      </div>

      {teams.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-slate-400">Ekip:</span>
          <button onClick={() => setTeam("")}
            className={`text-xs px-2.5 py-1 rounded-full border ${!team ? "bg-slate-100 border-slate-300" : "hover:bg-slate-50"}`}>
            Tümü
          </button>
          {teams.map((t) => (
            <button key={t} onClick={() => setTeam(t)}
              className={`text-xs px-2.5 py-1 rounded-full border ${team === t ? "bg-blue-50 border-blue-300 text-blue-700" : "hover:bg-slate-50"}`}>
              {t}
            </button>
          ))}
        </div>
      )}

      {error && <ErrorBox msg={error} />}
      {loading && !items && <Skeletons />}

      {teamFiltered?.length === 0 && !loading && !error && (
        <EmptyState icon="✓" title="Kayıt bulunamadı." />
      )}

      {teamFiltered && teamFiltered.length > 0 && (
        <div className="space-y-2">
          {teamFiltered.map((it, i) => <InstanaItemCard key={i} item={it} onAskAi={askAi} />)}
        </div>
      )}
    </div>
  );
}

// ── Tab 6: Splunk (basitleştirilmiş — keşif-mantığı yok, sabit ürün+zaman aralığı) ──

function SplunkTab() {
  const navigate = useNavigate();
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [products, setProducts] = useState<string[]>([]);
  const [product, setProduct] = useState("");
  const [windowMinutes, setWindowMinutes] = useState(15);
  const [result, setResult] = useState<SplunkSearchResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    splunkApi.health().then((h) => {
      setConfigured(h.configured);
      if (!h.configured) { setLoading(false); return; }
      splunkApi.products().then((r) => {
        const list = r.products ?? [];
        setProducts(list);
        if (list.length > 0) setProduct(list[0]);
        else setLoading(false);
      }).catch(() => setLoading(false));
    }).catch(() => setLoading(false));
  }, []);

  const load = (refresh = false) => {
    if (!product) return;
    setLoading(true); setError(null);
    splunkApi.search({ product, windowMinutes, refresh })
      .then((r) => {
        if (!r.ok) setError(friendlySplunkError(r.message));
        else setResult(r);
      })
      .catch((e) => setError(friendlySplunkError(e.message)))
      .finally(() => setLoading(false));
  };

  useEffect(() => { if (product) load(); }, [product, windowMinutes]); // eslint-disable-line react-hooks/exhaustive-deps

  if (configured === false) {
    return <NotConfigured detail="Splunk ortam değişkenleri (SPLUNK_BASE_URL/SPLUNK_TOKEN, .env.local) tanımlı değil." />;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        <select value={product} onChange={(e) => setProduct(e.target.value)}
          className="text-xs border rounded-lg px-2 py-1.5 outline-none">
          {products.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
        <select value={windowMinutes} onChange={(e) => setWindowMinutes(Number(e.target.value))}
          className="text-xs border rounded-lg px-2 py-1.5 outline-none">
          <option value={15}>Son 15 dk</option>
          <option value={30}>Son 30 dk</option>
          <option value={60}>Son 60 dk</option>
        </select>
        <Button variant="ghost" size="sm" onClick={() => load(true)} disabled={loading}
          icon={<ArrowPathIcon className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />}>
          Yenile
        </Button>
        <button
          onClick={() => seedAiAnalystChat(navigate, `Splunk'ta "${product}" ürünü için son ${windowMinutes} dakikadaki logları/hataları özetle.`)}
          className="text-xs px-3 py-1.5 rounded-lg font-medium flex items-center gap-1.5 ml-auto"
          style={{ background: "var(--status-info-bg)", color: "var(--status-info)" }}>
          <SparklesIcon className="w-3.5 h-3.5" /> AI ile analiz et
        </button>
      </div>

      {error && <ErrorBox msg={error} />}
      {loading && !result && <Skeletons />}

      {result && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatTile label="Event Sayısı" value={result.eventCount ?? 0} />
        </div>
      )}

      {result?.sample && result.sample.length > 0 && (
        <div className="space-y-2">
          {result.sample.map((line, i) => (
            <Card key={i} padding="sm">
              <pre className="text-xs font-mono whitespace-pre-wrap break-all">{line}</pre>
            </Card>
          ))}
        </div>
      )}

      {result && (result.eventCount ?? 0) === 0 && !loading && !error && (
        <EmptyState title="Seçilen ürün/zaman aralığında kayıt bulunamadı." />
      )}

      {result?.query && <RawText text={result.query} />}
    </div>
  );
}

// ── Ana sayfa ─────────────────────────────────────────────────────────────────

type TabId = "problems" | "events" | "entities" | "metrics" | "instana" | "splunk";

const TABS: { id: TabId; label: string }[] = [
  { id: "problems", label: "Problemler" },
  { id: "events",   label: "Events"     },
  { id: "entities", label: "Entities"   },
  { id: "metrics",  label: "Metrikler"  },
  { id: "instana",  label: "Instana"    },
  { id: "splunk",   label: "Splunk"     },
];

const DynatracePage: React.FC = () => {
  const navigate = useNavigate();
  const { canViewPage } = useAuth();
  // Her sekme, page-visibility sistemindeki "Perf:<id>" anahtarıyla ayrı ayrı
  // gizlenebilir (admin panel > Sayfa Erişimi). Anahtar tanımlı değilse görünür (varsayılan).
  const visibleTabs = TABS.filter((t) => canViewPage(`Perf:${t.id}`));
  const [activeTab, setActiveTab]       = useState<TabId>("problems");
  // Aktif sekme role gizliyse içerik de ilk görünür sekmeye düşer.
  const effectiveTab: TabId = visibleTabs.some((t) => t.id === activeTab)
    ? activeTab
    : (visibleTabs[0]?.id ?? activeTab);
  const [connected, setConnected]       = useState(false);
  const [healthDetail, setHealthDetail] = useState<string | null>(null);
  const [aliases, setAliases]           = useState<string[]>([]);
  const [env, setEnv]                   = useState<string>("");
  const [showHelp, setShowHelp]         = useState(false);

  useEffect(() => {
    dynatraceApi.health().then((r) => {
      setConnected(!!r.mcpConnected);
      setHealthDetail(r.lastError?.message || r.message || null);
      if (r.mcpConnected) {
        dynatraceApi.environments().then((er) => {
          if (er.ok) {
            setAliases(er.aliases ?? []);
            setEnv(er.defaultAlias || er.aliases?.[0] || "ALL_ENVIRONMENTS");
          }
        }).catch(() => {});
      }
    }).catch(() => {});
  }, []);

  return (
    <div className="space-y-5 pb-8">
      <SectionHeader
        title="Performance"
        subtitle="Dynatrace Managed — problem, event, entity ve metrik gözlemi"
        actions={
          <>
            {connected && aliases.length > 0 && (
              <select value={env} onChange={(e) => setEnv(e.target.value)}
                className="text-xs border rounded-full px-3 py-1.5 outline-none bg-white font-medium text-slate-600">
                {aliases.map((a) => <option key={a} value={a}>{a}</option>)}
                <option value="ALL_ENVIRONMENTS">Tüm Ortamlar</option>
              </select>
            )}
            <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full border text-xs font-medium ${
              connected ? "bg-green-50 border-green-200 text-green-700" : "bg-gray-50 border-gray-200 text-gray-400"
            }`}>
              <span className={`w-2 h-2 rounded-full ${connected ? "bg-green-400 animate-pulse" : "bg-gray-300"}`} />
              {connected ? "Bağlı" : "Bağlantı yok"}
            </div>
            <button
              onClick={() => setShowHelp(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-600 border border-gray-200 rounded-full hover:bg-gray-50 transition-colors"
            >
              <QuestionMarkCircleIcon className="w-4 h-4" />
              Yardım
            </button>
          </>
        }
      />

      {/* AI Analist yönlendirme kartı */}
      <button onClick={() => navigate("/ai-analyst")}
        className="w-full card card-hover p-4 flex items-center gap-3 text-left"
        style={{ borderLeft: "4px solid #5752d155" }}>
        <SparklesIcon className="w-5 h-5 flex-shrink-0" style={{ color: "var(--status-info)" }} />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>AI Analist ile analiz et</p>
          <p className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>
            Doğal dilde sorun — AI, Dynatrace ve Instana araçlarını zincirleme çağırarak kök neden analizi yapar.
          </p>
        </div>
        <ArrowRightIcon className="w-4 h-4 flex-shrink-0" style={{ color: "var(--status-info)" }} />
      </button>

      {/* Tab bar — yalnızca role görünür sekmeler (Perf:<id> page-visibility anahtarı) */}
      {visibleTabs.length > 0 && (
        <Tabs
          variant="pills"
          tabs={visibleTabs.map((t) => ({ id: t.id, label: t.label }))}
          activeTab={Math.max(0, visibleTabs.findIndex((t) => t.id === activeTab))}
          onChange={(i) => setActiveTab(visibleTabs[i].id)}
        />
      )}

      {/* Tab content */}
      {/* Instana ve Splunk bağımsız sistemler — Dynatrace bağlantısı yoksa da erişilebilir
          olmalı, bu yüzden yalnızca diğer 4 sekme Dynatrace `connected` durumuna bağlı. */}
      <div className="card p-5">
        {visibleTabs.length === 0 ? (
          <EmptyState title="Bu sayfada size görünür bir sekme yok." />
        ) : effectiveTab === "instana" || effectiveTab === "splunk" ? (
          <div key={effectiveTab} style={{ animation: "fadeIn 0.15s ease" }}>
            {effectiveTab === "instana" ? <InstanaTab /> : <SplunkTab />}
          </div>
        ) : !connected ? (
          <NotConfigured detail={healthDetail} />
        ) : (
          <div key={effectiveTab} style={{ animation: "fadeIn 0.15s ease" }}>
            {effectiveTab === "problems" && <ProblemsTab env={env} />}
            {effectiveTab === "events"   && <EventsTab   env={env} />}
            {effectiveTab === "entities" && <EntitiesTab env={env} />}
            {effectiveTab === "metrics"  && <MetricsTab  env={env} />}
          </div>
        )}
      </div>

      <style>{`@keyframes fadeIn { from { opacity:0; transform:translateY(4px); } to { opacity:1; transform:translateY(0); } }`}</style>

      <HelpModal
        open={showHelp}
        onClose={() => setShowHelp(false)}
        title="Performance — Nasıl Kullanılır?"
        sections={PERFORMANCE_HELP_SECTIONS}
      />
    </div>
  );
};

export default DynatracePage;
