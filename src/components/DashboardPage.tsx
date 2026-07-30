// src/components/DashboardPage.tsx — OpenShift Console "Overview" sayfasi deseni:
// Durum (Status) karti + Envanter (Inventory) listesi + Etkinlik (Activity) akisi +
// Baslangic kaynaklari (Getting started resources). Veri akisi ve API cagrilari
// onceki surumle BIREBIR AYNI; degisen yalnizca sunum katmani.
import React, { useEffect, useState, useContext } from "react";
import { useNavigate } from "react-router-dom";
import {
  ShieldCheckIcon,
  CommandLineIcon,
  PhoneIcon,
  LinkIcon,
  ArrowRightIcon,
  SparklesIcon,
  QuestionMarkCircleIcon,
  ServerStackIcon,
  DocumentTextIcon,
  ChartBarIcon,
  Squares2X2Icon,
} from "@heroicons/react/24/outline";
import {
  CheckCircleIcon,
  ExclamationCircleIcon,
  ExclamationTriangleIcon,
  MinusCircleIcon,
} from "@heroicons/react/24/solid";
import { dynatraceApi, type DtProblem } from "@/api/dynatraceApi";
import { linksApi, type PortalLink } from "@/api/linksApi";
import { openExternalUrl } from "@/utils/url";
import { seedAiAnalystChat } from "@/utils/aiHandoff";
import { AuthContext } from "@/contexts/AuthContext";
import { useAppData } from "@/contexts/AppContext";
import HelpModal, { type HelpSection } from "@/components/common/HelpModal";

// ─── Kisayollar ────────────────────────────────────────────

interface QuickLink {
  label: string;
  description: string;
  to: string;
  icon: React.ComponentType<{ className?: string }>;
  pageId: string;
}

const OTHER_TOOLS: QuickLink[] = [
  { label: "Nöbet çizelgesi", description: "Tüm nöbet takvimini görüntüle",   to: "/duty-roster",     icon: PhoneIcon,                 pageId: "Nöbet" },
  { label: "AI Analist",      description: "Analiz sohbetini aç",             to: "/ai-analyst",      icon: SparklesIcon,              pageId: "AI Analist" },
  { label: "Önemli linkler",  description: "Kurumsal bağlantı kataloğu",      to: "/important-links", icon: LinkIcon,                  pageId: "Linkler" },
  { label: "Ansible",         description: "Template yönetimi",               to: "/ansible",         icon: CommandLineIcon,           pageId: "Ansible" },
  { label: "Admin",           description: "Sistem yönetimi",                 to: "/admin",           icon: ShieldCheckIcon,           pageId: "Admin" },
];

const HELP_SECTIONS: HelpSection[] = [
  {
    icon: ChartBarIcon,
    title: "Durum kartı",
    body: "Portalın bağlı olduğu dış sistemlerin (Dynatrace, envanter veritabanı, self service kataloğu) o anki erişilebilirliğini gösterir. Kırmızı veya sarı bir satır, ilgili sayfada veri eksik gelebileceği anlamına gelir.",
  },
  {
    icon: ServerStackIcon,
    title: "Durum özeti (Sayılar)",
    body: "Açık performans sorunu, yayındaki self service sayısı ve görev dağılımı. Her satır ilgili sayfayı açar. Envanter artık Genel menüsünde ayrı bir sayfa olarak erişilebilir.",
  },
  {
    icon: SparklesIcon,
    title: "AI Analist'e soru sorma",
    body: "Doğal dilde yazdığınız soru, AI Analist sohbetine önceden doldurulmuş olarak aktarılır.",
  },
  {
    icon: LinkIcon,
    title: "Başlangıç kaynakları",
    body: "En sık kullanılan sayfaların kısayolları ve Önemli Linkler kataloğunda favori olarak işaretlenmiş bağlantılar.",
  },
  {
    icon: ShieldCheckIcon,
    title: "Yalnızca yöneticilere görünen bölümler",
    body: "Ansible ve Admin kısayolları ile bazı istatistikler Admin rolüne sahip kullanıcılara gösterilir.",
    adminOnly: true,
  },
];

// ─── Kucuk yardimci bilesenler ─────────────────────────────

function CardShell({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="card flex flex-col">
      <div className="flex items-center justify-between gap-2 px-6 pt-5 pb-3">
        <h2 className="pf-card-title p-0">{title}</h2>
        {action}
      </div>
      <div className="px-6 pb-5 flex-1">{children}</div>
    </div>
  );
}

function StatusRow({
  state, label, detail, onClick,
}: {
  state: "ok" | "warn" | "error" | "unknown";
  label: string;
  detail?: string;
  onClick?: () => void;
}) {
  const MAP = {
    ok:      { Icon: CheckCircleIcon,       color: "var(--status-success)" },
    warn:    { Icon: ExclamationTriangleIcon, color: "var(--status-warning)" },
    error:   { Icon: ExclamationCircleIcon, color: "var(--status-danger)" },
    unknown: { Icon: MinusCircleIcon,       color: "var(--status-neutral)" },
  } as const;
  const { Icon, color } = MAP[state];
  return (
    <div
      className={`flex items-start gap-2 py-2 ${onClick ? "cursor-pointer" : ""}`}
      onClick={onClick}
      style={{ borderBottom: "1px solid var(--border)" }}
    >
      <Icon className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color }} />
      <div className="min-w-0">
        <p className="text-[0.875rem]" style={{ color: "var(--text-primary)" }}>{label}</p>
        {detail && <p className="text-[0.8125rem] mt-0.5" style={{ color: "var(--text-muted)" }}>{detail}</p>}
      </div>
    </div>
  );
}

function InventoryRow({
  icon: Icon, label, value, hint, onClick,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: React.ReactNode;
  hint?: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="flex w-full items-center gap-3 py-3 text-left"
      style={{ borderBottom: "1px solid var(--border)" }}
    >
      <Icon className="w-5 h-5 flex-shrink-0" style={{ color: "var(--text-muted)" }} />
      <span className="flex-1 min-w-0">
        <span className="block text-[0.875rem]" style={{ color: "var(--accent)" }}>{label}</span>
        {hint && <span className="block text-[0.8125rem]" style={{ color: "var(--text-muted)" }}>{hint}</span>}
      </span>
      <span
        className="flex-shrink-0"
        style={{ fontFamily: "var(--font-display)", fontSize: "1.25rem", fontWeight: 500, color: "var(--text-primary)" }}
      >
        {value}
      </span>
    </button>
  );
}

// ─── Sayfa ─────────────────────────────────────────────────

const DashboardPage: React.FC = () => {
  const navigate = useNavigate();
  const { user, canViewPage, visibilityReady } = useContext(AuthContext);
  const isAdmin = user?.role === "Admin";
  const displayName = (user as { displayName?: string })?.displayName || user?.username || "—";

  const [showHelp, setShowHelp] = useState(false);

  const { nobetci, dtHealth, selfSrvCount, selfSrvLoading } = useAppData();

  const [dtProblems, setDtProblems] = useState<DtProblem[]>([]);
  const [onlineUsers, setOnlineUsers] = useState<{ username: string; displayName: string; hasAvatar: boolean }[]>([]);
  const [aiQuestion, setAiQuestion] = useState("");
  const [spotlightLinks, setSpotlightLinks] = useState<PortalLink[]>([]);

  useEffect(() => {
    linksApi.list()
      .then((r) => {
        if (!r.ok) return;
        setSpotlightLinks((r.links || []).filter((l) => l.isActive && l.isFavorite).sort((a, b) => a.order - b.order));
      })
      .catch(() => {});
  }, []);

  function handleAskAi(e?: React.FormEvent) {
    e?.preventDefault();
    const q = aiQuestion.trim();
    if (!q) return;
    seedAiAnalystChat(navigate, q);
  }

  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch("/api/users/online")
        .then((r) => r.json())
        .then((d: { ok?: boolean; users?: { username: string; displayName: string; hasAvatar: boolean }[] }) => {
          if (alive && d.ok) setOnlineUsers(d.users ?? []);
        })
        .catch(() => {});
    load();
    const iv = setInterval(load, 25_000);
    return () => { alive = false; clearInterval(iv); };
  }, []);

  useEffect(() => {
    // Gorunurluk sunucudan yuklenene kadar gated uc'lara istek atma (403 cascade onlemi).
    if (!visibilityReady) return;
  }, [isAdmin, canViewPage, visibilityReady]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (dtHealth?.mcpConnected && canViewPage("Performance")) {
      dynatraceApi.problems().then((p) => setDtProblems(p.problems ?? [])).catch(() => {});
    } else {
      setDtProblems([]);
    }
  }, [dtHealth, canViewPage]);

  const visibleTools = OTHER_TOOLS.filter((l) => canViewPage(l.pageId));

  const today = new Date().toLocaleDateString("tr-TR", {
    weekday: "long", year: "numeric", month: "long", day: "numeric",
  });

  return (
    <div className="space-y-6 pb-6">

      {/* ── Sayfa basligi (PF PageSection header) ───────────────── */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="page-title">Genel bakış</h1>
          <p className="text-[0.875rem] mt-1" style={{ color: "var(--text-muted)" }}>
            {displayName} · {today}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className={`badge ${isAdmin ? "pf-label--red" : "pf-label--blue"}`}>{user?.role}</span>
          <button className="pf-btn-link" onClick={() => setShowHelp(true)}>
            <QuestionMarkCircleIcon className="w-4 h-4" />
            Bu sayfa nasıl kullanılır?
          </button>
        </div>
      </div>

      {/* ── Durum + Envanter ────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

        {/* Durum */}
        <CardShell title="Durum">
          <div style={{ borderTop: "1px solid var(--border)" }}>
            {canViewPage("Performance") && (
              dtHealth === null ? (
                <StatusRow state="unknown" label="Dynatrace" detail="Bağlantı kontrol ediliyor" />
              ) : dtHealth.mcpConnected ? (
                <StatusRow
                  state={dtProblems.length > 0 ? "warn" : "ok"}
                  label="Dynatrace"
                  detail={dtProblems.length > 0 ? `${dtProblems.length} açık sorun` : "Açık sorun yok"}
                  onClick={() => navigate("/performance")}
                />
              ) : (
                <StatusRow
                  state="error"
                  label="Dynatrace"
                  detail={dtHealth.message || "MCP sunucusuna ulaşılamıyor"}
                  onClick={() => navigate("/performance")}
                />
              )
            )}

            {canViewPage("Self Service") && (
              selfSrvLoading ? (
                <StatusRow state="unknown" label="Self service kataloğu" detail="Yükleniyor" />
              ) : selfSrvCount === null ? (
                <StatusRow state="error" label="Self service kataloğu" detail="Katalog okunamadı" onClick={() => navigate("/self-service")} />
              ) : selfSrvCount === 0 ? (
                <StatusRow state="warn" label="Self service kataloğu" detail="Yayında servis yok" onClick={() => navigate("/self-service")} />
              ) : (
                <StatusRow state="ok" label="Self service kataloğu" detail={`${selfSrvCount} servis yayında`} onClick={() => navigate("/self-service")} />
              )
            )}

            {canViewPage("Nöbet") && (
              !nobetci ? (
                <StatusRow state="unknown" label="Nöbet servisi" detail="Sorgulanıyor" />
              ) : nobetci.ok ? (
                <StatusRow state="ok" label="Nöbet servisi" detail={`Bugün: ${nobetci.name ?? "—"}`} onClick={() => navigate("/duty-roster")} />
              ) : (
                <StatusRow state="warn" label="Nöbet servisi" detail={nobetci.message || "Bilgi alınamadı"} onClick={() => navigate("/duty-roster")} />
              )
            )}
          </div>
        </CardShell>

        {/* Envanter ozeti */}
        <CardShell title="Envanter">
          <div style={{ borderTop: "1px solid var(--border)" }}>
            {canViewPage("Performance") && (
              <InventoryRow
                icon={ChartBarIcon}
                label="Açık performans sorunu"
                hint="Dynatrace problems"
                value={dtHealth?.mcpConnected ? dtProblems.length : "—"}
                onClick={() => navigate("/performance")}
              />
            )}
            {canViewPage("Self Service") && (
              <InventoryRow
                icon={Squares2X2Icon}
                label="Self service"
                hint="Yayındaki servisler"
                value={selfSrvLoading ? "…" : selfSrvCount ?? "—"}
                onClick={() => navigate("/self-service")}
              />
            )}
            {canViewPage("LogX") && (
              <InventoryRow
                icon={DocumentTextIcon}
                label="LogX"
                hint="Legacy ve OpenShift log indirme"
                value={<ArrowRightIcon className="w-4 h-4" />}
                onClick={() => navigate("/logx")}
              />
            )}
          </div>
        </CardShell>

        {/* Bugunun nobetcisi */}
        {canViewPage("Nöbet") && (
          <CardShell
            title="Bugünün nöbetçisi"
            action={<button className="pf-btn-link" onClick={() => navigate("/duty-roster")}>Takvim</button>}
          >
            {!nobetci ? (
              <div className="space-y-2">
                <div className="h-11 w-11 rounded-full skeleton" />
                <div className="h-4 skeleton w-2/3" />
                <div className="h-3 skeleton w-1/2" />
              </div>
            ) : nobetci.ok ? (
              <div className="flex items-center gap-3">
                {nobetci.avatarUrl ? (
                  <img src={nobetci.avatarUrl} alt="" className="h-12 w-12 rounded-full object-cover" />
                ) : (
                  <div
                    className="h-12 w-12 rounded-full flex items-center justify-center text-white"
                    style={{ background: "var(--accent)", fontFamily: "var(--font-display)", fontSize: "1.125rem" }}
                  >
                    {nobetci.name?.[0]?.toUpperCase() ?? "?"}
                  </div>
                )}
                <div className="min-w-0">
                  <p style={{ fontFamily: "var(--font-display)", fontSize: "1rem", color: "var(--text-primary)" }}>
                    {nobetci.name}
                  </p>
                  {nobetci.title && <p className="text-[0.8125rem]" style={{ color: "var(--text-muted)" }}>{nobetci.title}</p>}
                  {nobetci.intercom && (
                    <p className="text-[0.875rem] mt-0.5" style={{ color: "var(--text-secondary)" }}>
                      Dahili: {nobetci.intercom}
                    </p>
                  )}
                </div>
              </div>
            ) : (
              <p className="text-[0.875rem]" style={{ color: "var(--text-muted)" }}>
                {nobetci.message || "Bilgi alınamadı"}
              </p>
            )}
          </CardShell>
        )}
      </div>

      {/* ── Etkinlik: acik Dynatrace sorunlari ───────────────────── */}
      {canViewPage("Performance") && dtHealth?.mcpConnected && dtProblems.length > 0 && (
        <CardShell
          title="Açık performans sorunları"
          action={
            canViewPage("AI Analist") ? (
              <button
                className="pf-btn-link"
                onClick={() =>
                  seedAiAnalystChat(
                    navigate,
                    `Açık Dynatrace problemlerini (${dtProblems.map((p) => p.title).join("; ")}) önceliklendir ve kısa bir özet çıkar.`
                  )
                }
              >
                <SparklesIcon className="w-4 h-4" /> AI ile özetle
              </button>
            ) : undefined
          }
        >
          <ul style={{ borderTop: "1px solid var(--border)" }}>
            {dtProblems.slice(0, 5).map((p, i) => (
              <li key={i} className="flex items-start gap-2 py-2" style={{ borderBottom: "1px solid var(--border)" }}>
                <ExclamationCircleIcon className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: "var(--status-danger)" }} />
                <button className="text-left text-[0.875rem]" style={{ color: "var(--accent)" }} onClick={() => navigate("/performance")}>
                  {p.title}
                </button>
              </li>
            ))}
          </ul>
          {dtProblems.length > 5 && (
            <button className="pf-btn-link mt-2 px-0" onClick={() => navigate("/performance")}>
              Tümünü görüntüle ({dtProblems.length})
            </button>
          )}
        </CardShell>
      )}

      {/* ── AI Analist + aktif kullanicilar ──────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {canViewPage("AI Analist") && (
          <CardShell title="AI Analist'e soru sor">
            <form onSubmit={handleAskAi} className="flex gap-2">
              <input
                value={aiQuestion}
                onChange={(e) => setAiQuestion(e.target.value)}
                placeholder="Örn: X sunucusunda bugün neden yavaşlık var?"
                className="pf-input flex-1"
                aria-label="AI Analist sorusu"
              />
              <button type="submit" disabled={!aiQuestion.trim()} className="btn-primary flex-shrink-0">
                Sor
              </button>
            </form>
            <p className="pf-helper-text">Soru, AI Analist sohbetine önceden doldurulmuş olarak aktarılır.</p>
          </CardShell>
        )}

        {onlineUsers.length > 0 && (
          <CardShell
            title="Şu an aktif"
            action={<span className="badge pf-label--green">{onlineUsers.length} kullanıcı</span>}
          >
            <div className="flex flex-wrap gap-2">
              {onlineUsers.map((u) => (
                <span
                  key={u.username}
                  title={u.displayName}
                  className="flex items-center gap-2 px-2 py-1"
                  style={{ border: "1px solid var(--border)", borderRadius: "var(--radius-full)" }}
                >
                  {u.hasAvatar ? (
                    <img
                      src={`/api/users/avatar/${encodeURIComponent(u.username)}`}
                      alt=""
                      className="h-6 w-6 rounded-full object-cover"
                      onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
                    />
                  ) : (
                    <span
                      className="h-6 w-6 rounded-full flex items-center justify-center text-white text-[0.6875rem]"
                      style={{ background: "var(--status-neutral)" }}
                    >
                      {u.displayName.split(" ").map((p) => p[0]).slice(0, 2).join("").toUpperCase()}
                    </span>
                  )}
                  <span className="text-[0.8125rem]" style={{ color: "var(--text-primary)" }}>{u.displayName}</span>
                </span>
              ))}
            </div>
          </CardShell>
        )}
      </div>

      {/* ── Baslangic kaynaklari ─────────────────────────────────── */}
      <CardShell title="Başlangıç kaynakları">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8" style={{ borderTop: "1px solid var(--border)" }}>
          {visibleTools.map((link) => {
            const Icon = link.icon;
            return (
              <button
                key={link.to}
                onClick={() => navigate(link.to)}
                className="flex items-center gap-3 py-3 text-left"
                style={{ borderBottom: "1px solid var(--border)" }}
              >
                <Icon className="w-5 h-5 flex-shrink-0" style={{ color: "var(--text-muted)" }} />
                <span className="min-w-0">
                  <span className="block text-[0.875rem]" style={{ color: "var(--accent)" }}>{link.label}</span>
                  <span className="block text-[0.8125rem]" style={{ color: "var(--text-muted)" }}>{link.description}</span>
                </span>
              </button>
            );
          })}
        </div>

        {spotlightLinks.length > 0 && (
          <div className="mt-4">
            <p className="text-[0.8125rem] mb-2" style={{ color: "var(--text-muted)" }}>Favori bağlantılar</p>
            <div className="flex flex-wrap gap-2">
              {spotlightLinks.slice(0, 8).map((l) => (
                <button
                  key={l.id}
                  onClick={() => openExternalUrl(l.url)}
                  className="flex items-center gap-1.5 px-3 py-1 text-[0.875rem]"
                  style={{ border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", color: "var(--accent)" }}
                  title={l.description || l.url}
                >
                  <LinkIcon className="w-3.5 h-3.5" />
                  {l.label}
                </button>
              ))}
            </div>
          </div>
        )}
      </CardShell>

      <HelpModal
        open={showHelp}
        onClose={() => setShowHelp(false)}
        title="Genel bakış — nasıl kullanılır?"
        sections={HELP_SECTIONS}
      />
    </div>
  );
};

export default DashboardPage;
