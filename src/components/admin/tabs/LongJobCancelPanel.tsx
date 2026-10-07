// src/components/admin/tabs/LongJobCancelPanel.tsx — "Uzun süren işleri iptal" (Admin > Ansible Info).
//
// Kullanıcı kararları (2026-09-14): eşik 60 dk; YALNIZCA burada seçilen template'ler
// iptal edilir; mod: doğrudan iptal + Teams. Sunucu tarafı: server/ansible/long-job-cancel.cjs
// (watcher 5 dk'da bir bakar). Liste boşsa hiçbir şey iptal edilmez.
//
// 2026-10-03 üretim olayı ("süresi dolan işler kesilmiyor"): iptal AWX'te 403 alıyordu ve
// bunu yalnızca sunucu logu biliyordu. Bu ekran artık:
//   - Durum: son taramanın özeti (sunucu başına taranabildi mi, her aday için karar + neden),
//     son 50 iptal denemesi; İPTAL EDİLEMEDİ / iptal sonrası hâlâ çalışıyor satırları KIRMIZI.
//   - "Şimdi kontrol et (kuru)": aynı karar mantığı, hiçbir şey iptal edilmez.
//   - Yetki ön kontrolü: seçili her template'in yanında rozet (Admin / Admin YOK / ölçülemedi).
//     "ölçülemedi" ile "yok" karışmaz. Kaydederken uyarı (engelleme değil).
//   - Workflow template'leri de seçilebilir; "Kuyrukta takılı işler" seçeneği (varsayılan kapalı).
// Doğrulayıcı turu (2026-10-03):
//   - "Admin ✓" rozeti token kapsamını ölçmez: statik/OAuth2 token'da "token kapsamı ölçülemedi" yazar.
//   - Seçili bir workflow iptal edilirse AWX alt işlerini de keser: metin "hiçbir zaman" demez, uyarı gösterir.
//   - Tarama sağlığı: AWX taranamıyorsa kırmızı "OTOMATİK İPTAL ÇALIŞMIYOR" bandı.
// İptal token'ı (2026-10-03, kullanıcı: servis kullanıcısına yetki verilemiyor): sunucu başına kişisel
// token (LongJobCancelTokenSection; yalnız yazılır). Tanımlıysa yetki rozetleri token SAHİBİNE göre
// ölçülür ve sahibi yazılır; token AWX'te geçersizleşirse Durum'da kırmızı "İPTAL TOKEN'I GEÇERSİZ" bandı.
import React, { useCallback, useMemo, useState } from "react";
import type { AwxTemplate } from "@/api/ansibleApi";
import { safeJson } from "@/api/http";
import { fmtDateTime } from "@/utils/datetime";
import { useAsyncEffect } from "@/hooks/useAsyncEffect";
import LongJobCancelTokenSection, { type CancelTokenRow } from "./LongJobCancelTokenSection";

type Kind = "job" | "workflow";
interface TplRef {
  serverId: number;
  templateId: number;
  kind: Kind;
  name: string;
}
interface Cfg {
  enabled: boolean;
  thresholdMinutes: number;
  cancelQueued: boolean;
  templates: TplRef[];
}
interface ListTpl {
  id: number;
  name: string;
  kind: Kind;
}
interface ServerTpls {
  serverId: number;
  serverName: string;
  ok: boolean;
  error?: string;
  templates: ListTpl[];
}
type PermState = "admin" | "no_admin" | "unknown";
interface Perm {
  serverId: number;
  templateId: number;
  kind: Kind;
  name: string;
  state: PermState;
  tokenScope?: "write" | "unknown";
  // "unknown": iptal token kaydı okunamadı — iptalin hangi kimlikle yapılacağı ölçülemedi.
  via?: "service" | "cancel_token" | "unknown";
  tokenOwner?: string | null;
  message: string;
}
interface JobRow {
  serverId: number;
  serverName: string;
  kind: Kind;
  jobId: number;
  jobName: string;
  templateId: number | null;
  status: string | null;
  started: string | null;
  created: string | null;
  executer: string | null;
  url: string | null;
  ageMinutes: number | null;
  decision: string;
  reason: string;
  problem: boolean;
}
interface ServerScan {
  serverId: number;
  serverName: string;
  ok: boolean;
  error: string | null;
  running: number;
  queued: number;
  truncated: boolean;
}
interface Attempt {
  at: string;
  serverName?: string;
  kind?: Kind;
  jobId?: number;
  jobName?: string;
  outcome: string;
  ok: boolean;
  message?: string;
  teams?: string | null;
}
interface ScanHealth {
  serverId: number;
  serverName: string;
  kind: Kind;
  fails: number;
  since: string;
  alerted: boolean;
  lastError: string | null;
  threshold: number;
}
interface ConfigError {
  at: string;
  message: string;
}
interface TickSummary {
  at: string;
  durationMs: number;
  dryRun: boolean;
  skipped?: string;
  config: { enabled: boolean; thresholdMinutes: number; cancelQueued: boolean; templateCount: number } | null;
  configError: ConfigError | null;
  usingLastGoodConfig: boolean;
  servers: ServerScan[] | null;
  verify?: { asked: number; measured: number; unmeasured: number };
  jobsTotal: number;
  jobs: JobRow[];
  attempts: Attempt[];
}
interface WatcherInfo {
  started: boolean;
  pollIntervalSeconds: number;
  inFlight: boolean;
  lastTickStartedAt: string | null;
  lastTickFinishedAt: string | null;
  lastTickError: string | null;
}
interface StatusResp {
  ok: boolean;
  instance: string;
  configError: ConfigError | null;
  usingLastGoodConfig: boolean;
  lastTick: TickSummary | null;
  lastDryRun: TickSummary | null;
  attempts: Attempt[];
  scanHealth?: ScanHealth[];
  cancelTokens?: { measured: boolean; readError: ConfigError | null; tokens: CancelTokenRow[] };
  open: { awaitingVerify: number; stillRunning: number; failed: number; scanFailing?: number; tokenInvalid?: number };
  watcher: WatcherInfo | null;
  message?: string;
}

type Summary = { serverId: number; serverName: string; ok: boolean; templates: AwxTemplate[]; error?: string }[];

const API = "/api/ansible/longjob-cancel";
const EMPTY: Cfg = { enabled: false, thresholdMinutes: 60, cancelQueued: false, templates: [] };

const DECISION_LABEL: Record<string, string> = {
  disabled: "kapalı",
  not_listed: "izin listesinde değil",
  no_started: "started yok",
  no_created: "created yok",
  queued_option_off: "kuyrukta (seçenek kapalı)",
  below_threshold: "eşik altında",
  would_cancel: "iptal edilirdi (kuru)",
  cancel_requested: "iptal istendi",
  already_terminal: "zaten bitmiş",
  cancel_failed: "İPTAL EDİLEMEDİ",
  still_running: "iptal sonrası hâlâ çalışıyor",
};
const OUTCOME_LABEL: Record<string, string> = {
  requested: "iptal istendi",
  stopped: "iptal edildi (doğrulandı)",
  finished: "kendiliğinden bitti (iptal doğrulanamadı)",
  already_terminal: "zaten bitmiş",
  failed: "İPTAL EDİLEMEDİ",
  token_invalid: "İPTAL EDİLEMEDİ — İPTAL TOKEN'I GEÇERSİZ",
  still_running: "iptal istendi ama durmadı",
  scan_failed: "TARANAMIYOR — otomatik iptal çalışmıyor",
  scan_recovered: "yeniden taranabiliyor",
  watcher_stuck: "TARAMA BİTMİYOR — otomatik iptal çalışmıyor",
};
const KIND_TEXT: Record<Kind, string> = { job: "job", workflow: "workflow job" };
// Kuru çalıştırma ve durum tablosunda varsayılan olarak gizlenen "ilgisiz" kararlar.
const QUIET = new Set(["not_listed", "disabled"]);

const tplKey = (serverId: number, kind: Kind, templateId: number) => `${serverId}:${kind}:${templateId}`;
const normCfg = (c: Partial<Cfg> | null | undefined): Cfg => ({
  enabled: c?.enabled === true,
  thresholdMinutes: Number(c?.thresholdMinutes) || 60,
  cancelQueued: c?.cancelQueued === true,
  templates: (c?.templates || []).map((t) => ({ ...t, kind: t.kind === "workflow" ? "workflow" : "job" })),
});

function TokenOwnerChip({ perm }: { perm: Perm }) {
  if (perm.via !== "cancel_token") return null;
  return (
    <span
      className="ml-1 text-[10px] px-1.5 rounded border border-indigo-200 bg-indigo-50 text-indigo-700"
      title="Yetki iptal token'ının sahibine göre ölçüldü; otomatik iptal bu token'la yapılır."
    >
      {perm.tokenOwner || "?"} token'ı
    </span>
  );
}

function PermBadge({ perm }: { perm: Perm | undefined }) {
  if (!perm) return <span className="ml-1 text-[10px] text-gray-400">yetki kontrol ediliyor…</span>;
  if (perm.state === "admin")
    return (
      <>
        <span className="ml-1 text-[10px] px-1.5 rounded border border-emerald-200 bg-emerald-50 text-emerald-700" title={perm.message}>
          Admin ✓
        </span>
        <TokenOwnerChip perm={perm} />
        {perm.tokenScope !== "write" && (
          <span
            className="ml-1 text-[10px] px-1.5 rounded border border-amber-300 bg-amber-50 text-amber-800"
            title="Statik, OAuth2 ya da kişisel token: kapsamı AWX'ten okunamıyor. Token 'read' kapsamlıysa iptal yine 403 alır."
          >
            token kapsamı ölçülemedi
          </span>
        )}
      </>
    );
  if (perm.state === "no_admin")
    return (
      <>
        <span className="ml-1 text-[10px] px-1.5 rounded border border-red-300 bg-red-100 text-red-800 font-semibold" title={perm.message}>
          Admin YOK{perm.via === "cancel_token" ? ` (${perm.tokenOwner || "?"})` : ""} — başkalarının işini iptal edemez
        </span>
        <TokenOwnerChip perm={perm} />
      </>
    );
  return (
    <span className="ml-1 text-[10px] px-1.5 rounded border border-amber-300 bg-amber-50 text-amber-800" title={perm.message}>
      yetki ölçülemedi
    </span>
  );
}

function KindBadge({ kind }: { kind: Kind }) {
  return kind === "workflow" ? (
    <span className="text-[9px] px-1 rounded border border-indigo-200 bg-indigo-50 text-indigo-700" title="Workflow template">
      WF
    </span>
  ) : null;
}

function TickView({ title, tick }: { title: string; tick: TickSummary }) {
  const [showAll, setShowAll] = useState(false);
  const rows = showAll ? tick.jobs : tick.jobs.filter((j) => !QUIET.has(j.decision));
  const hidden = tick.jobs.length - rows.length;
  return (
    <div className="rounded-xl border border-gray-200 p-3 mb-3" data-testid={tick.dryRun ? "ljc-dry" : "ljc-tick"}>
      <div className="flex flex-wrap items-baseline gap-2 mb-2">
        <span className="text-xs font-semibold text-gray-700">{title}</span>
        <span className="text-[11px] text-gray-500">
          {fmtDateTime(tick.at)} · {tick.durationMs} ms
          {tick.config &&
            ` · ${tick.config.enabled ? "AÇIK" : "kapalı"}, eşik ${tick.config.thresholdMinutes} dk, ${tick.config.templateCount} template` +
              (tick.config.cancelQueued ? ", kuyruktakiler dahil" : "")}
        </span>
      </div>
      {tick.skipped && <div className="text-xs text-amber-800 mb-2">{tick.skipped}</div>}
      {tick.configError && (
        <div className="text-xs mb-2 px-2 py-1 rounded border border-red-300 bg-red-50 text-red-700">
          Yapılandırma okunamadı: {tick.configError.message}
          {tick.usingLastGoodConfig ? " — son geçerli yapılandırmayla devam edildi." : " — geçerli yapılandırma yok, otomatik iptal KAPALI sayıldı."}
        </div>
      )}
      {tick.servers && (
        <ul className="mb-2 space-y-0.5">
          {tick.servers.map((s) => (
            <li
              key={s.serverId}
              className={`text-[11px] ${!s.ok ? "text-red-700 font-semibold" : s.truncated ? "text-amber-800" : "text-gray-600"}`}
            >
              {s.ok ? (s.truncated ? "⚠" : "✓") : "✗"} {s.serverName}: {s.ok ? "tarandı" : "TARANAMADI"} — {s.running} çalışan, {s.queued} kuyrukta
              {s.error ? ` — ${s.error}` : ""}
            </li>
          ))}
        </ul>
      )}
      {tick.verify && tick.verify.unmeasured > 0 && (
        <div className="text-[11px] text-amber-800 mb-2" data-testid="ljc-unverified">
          {tick.verify.unmeasured} iptal kaydı doğrulanamadı: iş artık listede yok ama AWX'teki durumu okunamadı — kayıt
          korunuyor, sonraki taramada yeniden bakılacak ("bitti" sayılmadı).
        </div>
      )}
      {tick.jobs.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full text-[11px]">
            <thead>
              <tr className="text-left text-gray-500 border-b border-gray-100">
                <th className="py-1 pr-2">AWX</th>
                <th className="py-1 pr-2">İş</th>
                <th className="py-1 pr-2">Durum</th>
                <th className="py-1 pr-2">Süre</th>
                <th className="py-1 pr-2">Karar</th>
                <th className="py-1">Neden</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((j) => (
                <tr
                  key={`${j.serverId}:${j.kind}:${j.jobId}`}
                  data-problem={j.problem ? "1" : "0"}
                  className={j.problem ? "bg-red-50 text-red-800 font-semibold" : "border-b border-gray-50"}
                >
                  <td className="py-1 pr-2">{j.serverName}</td>
                  <td className="py-1 pr-2">
                    {j.url ? (
                      <a href={j.url} target="_blank" rel="noreferrer" className="underline">
                        #{j.jobId}
                      </a>
                    ) : (
                      `#${j.jobId}`
                    )}{" "}
                    {j.jobName} <KindBadge kind={j.kind} />
                  </td>
                  <td className="py-1 pr-2">{j.status || "—"}</td>
                  <td className="py-1 pr-2">{j.ageMinutes != null ? `${j.ageMinutes} dk` : "—"}</td>
                  <td className="py-1 pr-2 whitespace-nowrap">{DECISION_LABEL[j.decision] || j.decision}</td>
                  <td className="py-1">{j.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {(hidden > 0 || showAll) && (
            <button className="mt-1 text-[11px] underline text-gray-500" onClick={() => setShowAll((v) => !v)}>
              {showAll ? "yalnız ilgili işleri göster" : `izin listesinde olmayan/kapalı ${hidden} işi de göster`}
            </button>
          )}
          {tick.jobsTotal > tick.jobs.length && (
            <div className="text-[11px] text-amber-800 mt-1">
              {tick.jobsTotal} işten ilk {tick.jobs.length} tanesi gösteriliyor (sorunlular önce).
            </div>
          )}
        </div>
      ) : (
        !tick.skipped && <div className="text-[11px] text-gray-500">Çalışan ya da kuyrukta iş yok.</div>
      )}
    </div>
  );
}

function AttemptsView({ attempts }: { attempts: Attempt[] }) {
  if (!attempts.length) return <div className="text-[11px] text-gray-500">Bu Portal örneğinde henüz iptal denemesi yok.</div>;
  return (
    <div className="overflow-x-auto" data-testid="ljc-attempts">
      <table className="w-full text-[11px]">
        <thead>
          <tr className="text-left text-gray-500 border-b border-gray-100">
            <th className="py-1 pr-2">Zaman</th>
            <th className="py-1 pr-2">AWX</th>
            <th className="py-1 pr-2">İş</th>
            <th className="py-1 pr-2">Sonuç</th>
            <th className="py-1 pr-2">Teams</th>
            <th className="py-1">Ayrıntı</th>
          </tr>
        </thead>
        <tbody>
          {attempts.map((a, i) => (
            <tr
              key={`${a.at}:${a.jobId}:${i}`}
              data-problem={a.ok ? "0" : "1"}
              className={a.ok ? "border-b border-gray-50" : "bg-red-50 text-red-800 font-semibold"}
            >
              <td className="py-1 pr-2 whitespace-nowrap">{fmtDateTime(a.at)}</td>
              <td className="py-1 pr-2">{a.serverName || "—"}</td>
              <td className="py-1 pr-2">
                {a.jobId != null ? (
                  <>
                    #{a.jobId} {a.jobName} {a.kind && <KindBadge kind={a.kind} />}
                  </>
                ) : a.kind ? (
                  `${KIND_TEXT[a.kind]} listesi`
                ) : (
                  "—"
                )}
              </td>
              <td className="py-1 pr-2 whitespace-nowrap">{OUTCOME_LABEL[a.outcome] || a.outcome}</td>
              <td className="py-1 pr-2">{a.teams || "—"}</td>
              <td className="py-1">{a.message}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function LongJobCancelPanel({ summary }: { summary: Summary }) {
  const [cfg, setCfg] = useState<Cfg>(EMPTY);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [cfgError, setCfgError] = useState<ConfigError | null>(null);
  const [usingLastGood, setUsingLastGood] = useState(false);
  const [teamsConfigured, setTeamsConfigured] = useState(true);
  const [tplServers, setTplServers] = useState<ServerTpls[] | null>(null);
  const [perms, setPerms] = useState<Record<string, Perm>>({});
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "warn" | "bad"; text: string; details?: string[] } | null>(null);
  const [status, setStatus] = useState<StatusResp | null>(null);
  const [statusErr, setStatusErr] = useState<string | null>(null);
  const [dry, setDry] = useState<TickSummary | null>(null);
  const [dryErr, setDryErr] = useState<string | null>(null);
  const [dryBusy, setDryBusy] = useState(false);

  const mergePerms = useCallback((list: Perm[] | undefined) => {
    if (!list || !list.length) return;
    setPerms((p) => {
      const n = { ...p };
      for (const x of list) n[tplKey(x.serverId, x.kind === "workflow" ? "workflow" : "job", x.templateId)] = x;
      return n;
    });
  }, []);

  const loadStatus = useCallback(async () => {
    try {
      const r: StatusResp = await fetch(`${API}/status`).then(safeJson);
      if (r.ok) {
        setStatus(r);
        setStatusErr(null);
      } else setStatusErr(r.message || "Durum alınamadı.");
    } catch (e: unknown) {
      setStatusErr(e instanceof Error ? e.message : String(e));
    }
  }, []);

  // İptal token'ı kaydedildi/silindi/doğrulandı: yetki rozetleri token sahibine göre YENİDEN ölçülür
  // (eski rozet yanlış kimliği gösterir) ve durum yenilenir.
  const onTokenChanged = useCallback(() => {
    setPerms({});
    void loadStatus();
  }, [loadStatus]);

  useAsyncEffect(
    async (alive) => {
      try {
        const r = await fetch(API).then(safeJson);
        if (!alive()) return;
        if (r.ok) {
          setCfg(normCfg(r.config));
          setCfgError(r.configError || null);
          setUsingLastGood(r.usingLastGoodConfig === true);
          setTeamsConfigured(r.teamsConfigured !== false);
          setLoaded(true);
        } else setLoadError(r.message || "Yapılandırma alınamadı.");
      } catch (e: unknown) {
        if (alive()) setLoadError(e instanceof Error ? e.message : String(e));
      }
      try {
        const t = await fetch(`${API}/templates`).then(safeJson);
        if (alive() && t.ok && Array.isArray(t.servers)) setTplServers(t.servers);
      } catch {
        /* yedek: üst bileşenin job template özeti kullanılır */
      }
      if (alive()) await loadStatus();
    },
    [loadStatus],
  );

  // Yetki rozetleri: seçili ama henüz ölçülmemiş template'ler için (seçim değişince, kısa gecikmeyle).
  const missing = useMemo(
    () => cfg.templates.filter((t) => !perms[tplKey(t.serverId, t.kind, t.templateId)]),
    [cfg.templates, perms],
  );
  const missingQuery = missing.map((t) => `${t.serverId}:${t.templateId}:${t.kind}`).join(",");
  useAsyncEffect(
    async (alive) => {
      if (!loaded || !missingQuery) return;
      await new Promise((r) => setTimeout(r, 400));
      if (!alive()) return;
      try {
        const r = await fetch(`${API}/permissions?t=${encodeURIComponent(missingQuery)}`).then(safeJson);
        if (alive() && r.ok) mergePerms(r.permissions);
      } catch {
        /* rozet "kontrol ediliyor" kalır; kaydetme yanıtı yine ölçer */
      }
    },
    [loaded, missingQuery, mergePerms],
  );

  const servers: ServerTpls[] = useMemo(
    () =>
      tplServers ||
      summary.map((s) => ({
        serverId: s.serverId,
        serverName: s.serverName,
        ok: s.ok,
        error: s.error,
        templates: s.templates.map((t) => ({ id: t.id, name: t.name, kind: "job" as Kind })),
      })),
    [tplServers, summary],
  );
  const serverName = (id: number) => servers.find((s) => s.serverId === id)?.serverName || `sunucu ${id}`;

  const selected = useMemo(
    () => new Set(cfg.templates.map((t) => tplKey(t.serverId, t.kind, t.templateId))),
    [cfg.templates],
  );
  const selectedWorkflows = cfg.templates.filter((t) => t.kind === "workflow");

  const toggle = (serverId: number, tpl: ListTpl) => {
    const k = tplKey(serverId, tpl.kind, tpl.id);
    setCfg((c) => ({
      ...c,
      templates: selected.has(k)
        ? c.templates.filter((t) => tplKey(t.serverId, t.kind, t.templateId) !== k)
        : [...c.templates, { serverId, templateId: tpl.id, kind: tpl.kind, name: tpl.name }],
    }));
  };

  const save = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch(API, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(cfg),
      }).then(safeJson);
      if (r.ok) {
        const c = normCfg(r.config);
        setCfg(c);
        setCfgError(null);
        setUsingLastGood(false);
        mergePerms(r.permissions);
        const base =
          c.enabled && c.templates.length
            ? `Kaydedildi. ${c.templates.length} template için ${c.thresholdMinutes} dk eşiği aktif (en geç 5 dk içinde devreye girer).`
            : "Kaydedildi. Otomatik iptal KAPALI (açık değil ya da liste boş).";
        const warnings: string[] = Array.isArray(r.warnings) ? r.warnings : [];
        if (r.permissionsError) warnings.push(`İptal yetkisi ölçülemedi: ${r.permissionsError}`);
        setMsg(warnings.length ? { tone: "warn", text: `${base} UYARI:`, details: warnings } : { tone: "ok", text: base });
        void loadStatus();
      } else setMsg({ tone: "bad", text: r.message || "Kaydedilemedi." });
    } catch (e: unknown) {
      setMsg({ tone: "bad", text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };

  const runDry = async () => {
    setDryBusy(true);
    setDryErr(null);
    try {
      const r = await fetch(`${API}/dry-run`, { method: "POST" }).then(safeJson);
      if (r.ok) setDry(r.result);
      else setDryErr(r.message || "Kuru çalıştırma başarısız.");
    } catch (e: unknown) {
      setDryErr(e instanceof Error ? e.message : String(e));
    } finally {
      setDryBusy(false);
    }
  };

  const needle = q.trim().toLowerCase();
  const inputCls = "px-2 py-1.5 text-xs border border-gray-200 rounded-lg bg-white";
  const watcher = status?.watcher;
  // Eşiğe ulaşmamış (henüz alarm gitmemiş) tarama hataları da gösterilir: sessiz kalmasın.
  const scanFailing = (status?.scanHealth || []).filter((h) => h.fails > 0);
  const tokenInvalid = (status?.cancelTokens?.tokens || []).filter((t) => t.invalid);

  return (
    <section>
      <h3 className="text-sm font-semibold text-gray-700 mb-1">Uzun süren işleri otomatik iptal</h3>
      <p className="text-xs text-gray-500 mb-3">
        Portal 5 dakikada bir tüm AWX (maestro) sunucularındaki <b>çalışan</b> job ve workflow job'lara bakar; eşiği aşan ve
        <b> aşağıda seçili</b> template'lerden gelen işi <code>cancel</code> eder, Teams'e bildirir ve Denetim Kaydı'na yazar.
        Seçili olmayan template'ler Portal tarafından <b>doğrudan</b> iptal edilmez (yalnızca 30 dk bildirimi gider);{" "}
        <b>ancak seçili bir workflow iptal edilirse AWX o workflow'un çalışan tüm alt işlerini de keser</b> (alt işin
        template'i seçili olmasa bile). Uzun sürmesi normal işleri (envanter, kurulum, upgrade) seçmeyin. AWX'te başkasının
        başlattığı bir işi Portal'ın iptal edebilmesi için Portal'ın AWX kullanıcısının o template'te <b>Admin</b> rolü olmalı
        (Execute yetmez) ve Portal'ın token'ı <b>write</b> kapsamlı olmalı — rozetler Admin rolünü gösterir; statik token'da
        kapsam ölçülemez. Servis kullanıcısına bu yetki verilemiyorsa aşağıdaki <b>İptal token'ı</b> bölümünden (geçici
        olarak) yetkili bir kullanıcının token'ı girilebilir: iptal ve yetki ön kontrolü o token'la yapılır.
        {!teamsConfigured && (
          <span className="block mt-1 text-amber-700">
            Teams webhook (TEAMS_LONGJOB_WEBHOOK_URL) tanımlı değil: iptal yine yapılır ama bildirim gitmez — sonuçlar
            aşağıdaki Durum bölümünde görünür.
          </span>
        )}
      </p>
      {loadError && (
        <div className="text-xs mb-3 px-3 py-2 rounded-lg border border-red-300 bg-red-50 text-red-700">
          Yapılandırma alınamadı: {loadError}. Yanlışlıkla boş liste kaydedilmesin diye Kaydet kapalı.
        </div>
      )}
      {cfgError && (
        <div className="text-xs mb-3 px-3 py-2 rounded-lg border border-red-300 bg-red-50 text-red-700">
          Yapılandırma okunamadı (DB): {cfgError.message} —{" "}
          {usingLastGood
            ? "sunucu son geçerli yapılandırmayla devam ediyor; ekrandaki değerler o yapılandırmadır."
            : "sunucuda geçerli yapılandırma yok, otomatik iptal KAPALI çalışıyor. Kaydetmek DB'deki kaydın yerine bu ekrandakini yazar."}
        </div>
      )}
      <div className="flex flex-wrap items-end gap-3 mb-3">
        <label className="flex items-center gap-2 text-xs cursor-pointer">
          <input type="checkbox" checked={cfg.enabled} onChange={(e) => setCfg((c) => ({ ...c, enabled: e.target.checked }))} />
          <span className={cfg.enabled ? "font-semibold text-red-700" : ""}>Otomatik iptal {cfg.enabled ? "AÇIK" : "kapalı"}</span>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[10px] uppercase tracking-wide text-gray-400">Eşik (dakika)</span>
          <input
            type="number"
            min={5}
            max={1440}
            value={cfg.thresholdMinutes}
            onChange={(e) => setCfg((c) => ({ ...c, thresholdMinutes: Number(e.target.value) || 60 }))}
            className={`${inputCls} w-24`}
          />
        </label>
        <label className="flex items-center gap-2 text-xs cursor-pointer" title="pending/waiting durumundaki izinli işler, kuyruğa girdikleri (created) zamandan itibaren eşiği aşarsa iptal edilir">
          <input
            type="checkbox"
            checked={cfg.cancelQueued}
            onChange={(e) => setCfg((c) => ({ ...c, cancelQueued: e.target.checked }))}
          />
          <span>Kuyrukta takılı işler de (pending/waiting, kuyruk süresine göre)</span>
        </label>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="template ara" aria-label="Template ara" className={`${inputCls} w-56`} />
        <span className="text-xs text-gray-500">{cfg.templates.length} template seçili</span>
        <button
          data-testid="ljc-save"
          onClick={save}
          disabled={busy || !loaded}
          className="px-3 py-1.5 text-xs font-semibold rounded-lg text-white bg-[#1C69D4] disabled:opacity-50"
        >
          {busy ? "Kaydediliyor…" : "Kaydet"}
        </button>
      </div>
      {msg && (
        <div
          data-testid="ljc-msg"
          className={`text-xs mb-3 ${msg.tone === "ok" ? "text-emerald-700" : msg.tone === "warn" ? "text-amber-800" : "text-red-600"}`}
        >
          {msg.text}
          {msg.details && (
            <ul className="list-disc ml-5 mt-1">
              {msg.details.map((d) => (
                <li key={d}>{d}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {selectedWorkflows.length > 0 && (
        <div data-testid="ljc-wf-warning" className="text-xs mb-2 px-3 py-2 rounded-lg border border-amber-300 bg-amber-50 text-amber-900">
          Seçili workflow ({selectedWorkflows.map((t) => t.name || `#${t.templateId}`).join(", ")}) iptal edilirse AWX o
          workflow'un çalışan <b>tüm alt işlerini de keser</b> — alt işlerin template'i bu listede olmasa bile.
        </div>
      )}
      {cfg.templates.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-3">
          {cfg.templates.map((t) => {
            const k = tplKey(t.serverId, t.kind, t.templateId);
            return (
              <span key={k} data-testid={`ljc-chip-${k}`} className="text-[11px] px-2 py-0.5 rounded-full border border-red-200 bg-red-50 text-red-700">
                {t.name || `#${t.templateId}`} <KindBadge kind={t.kind} /> <span className="opacity-70">({serverName(t.serverId)})</span>
                <PermBadge perm={perms[k]} />
                <button
                  className="ml-1 opacity-70 hover:opacity-100"
                  title="listeden çıkar"
                  onClick={() => setCfg((c) => ({ ...c, templates: c.templates.filter((x) => tplKey(x.serverId, x.kind, x.templateId) !== k) }))}
                >
                  ×
                </button>
              </span>
            );
          })}
        </div>
      )}

      <LongJobCancelTokenSection onChanged={onTokenChanged} />

      <div className="grid gap-3 md:grid-cols-2">
        {servers.map((s) => (
          <div key={s.serverId} className="rounded-xl border border-gray-200 p-3">
            <div className="text-xs font-semibold text-gray-700 mb-2">
              {s.serverName} {!s.ok && <span className="text-red-600 font-normal">— {s.error || "template listesi alınamadı"}</span>}
            </div>
            <div className="max-h-64 overflow-auto space-y-0.5">
              {s.templates
                .filter((t) => !needle || t.name.toLowerCase().includes(needle) || String(t.id).includes(needle))
                .map((t) => (
                  <label key={`${t.kind}:${t.id}`} className="flex items-center gap-2 text-xs cursor-pointer hover:bg-gray-50 rounded px-1 py-0.5">
                    <input
                      type="checkbox"
                      aria-label={`${t.kind === "workflow" ? "workflow " : ""}${t.name}`}
                      checked={selected.has(tplKey(s.serverId, t.kind, t.id))}
                      onChange={() => toggle(s.serverId, t)}
                    />
                    <span className="font-mono text-gray-400 w-12">#{t.id}</span>
                    <span>{t.name}</span>
                    <KindBadge kind={t.kind} />
                  </label>
                ))}
              {s.templates.length === 0 && <div className="text-xs text-gray-400">template yok</div>}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-6" aria-label="Uzun süren iş iptali durumu">
        <div className="flex flex-wrap items-center gap-2 mb-2">
          <h4 className="text-sm font-semibold text-gray-700">Durum</h4>
          {status && <span className="text-[11px] text-gray-400">bu Portal örneği: {status.instance}</span>}
          <button onClick={() => void loadStatus()} className="px-2 py-1 text-[11px] border border-gray-200 rounded-lg hover:bg-gray-50">
            Yenile
          </button>
          <button
            onClick={() => void runDry()}
            disabled={dryBusy}
            className="px-2 py-1 text-[11px] border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-50"
            title="Aynı karar mantığını şimdi çalıştırır; hiçbir iş iptal edilmez"
          >
            {dryBusy ? "Kontrol ediliyor…" : "Şimdi kontrol et (kuru)"}
          </button>
        </div>
        <p className="text-[11px] text-gray-400 mb-2">
          Durum bu Portal örneğinin belleğindedir (restart'ta sıfırlanır; birden çok örnek varsa her biri kendi taramasını gösterir).
          Kalıcı kayıt: Denetim Kaydı (awx_long_job_cancel).
        </p>
        {statusErr && <div className="text-xs text-red-600 mb-2">Durum alınamadı: {statusErr}</div>}
        {watcher && !watcher.started && (
          <div className="text-xs mb-2 px-3 py-2 rounded-lg border border-red-300 bg-red-50 text-red-700">
            İzleyici BAŞLATILMAMIŞ — bu Portal örneğinde otomatik iptal ÇALIŞMIYOR.
          </div>
        )}
        {watcher && watcher.started && (
          <div className="text-[11px] text-gray-500 mb-2">
            İzleyici çalışıyor (her {watcher.pollIntervalSeconds} sn){watcher.inFlight ? " · tarama sürüyor" : ""}
            {watcher.lastTickError ? ` · son tarama hatası: ${watcher.lastTickError}` : ""}
          </div>
        )}
        {scanFailing.length > 0 && (
          <div data-testid="ljc-scan-failing" className="text-xs mb-2 px-3 py-2 rounded-lg border border-red-300 bg-red-50 text-red-700 font-semibold">
            OTOMATİK İPTAL ÇALIŞMIYOR —{" "}
            {scanFailing
              .map((h) => `${h.serverName} ${KIND_TEXT[h.kind]} listesi ${h.fails} taramadır okunamıyor${h.lastError ? ` (${h.lastError})` : ""}`)
              .join("; ")}
            . Bu sürede izin listesindeki işler eşiği aşsa da kesilmez.
          </div>
        )}
        {tokenInvalid.length > 0 && (
          <div data-testid="ljc-token-invalid" className="text-xs mb-2 px-3 py-2 rounded-lg border border-red-300 bg-red-50 text-red-700 font-semibold">
            İPTAL TOKEN'I GEÇERSİZ —{" "}
            {tokenInvalid
              .map((t) => `${t.serverName} (${t.owner || "?"})${t.invalidInfo?.message ? `: ${t.invalidInfo.message}` : ""}`)
              .join("; ")}
            . Bu sunucularda otomatik iptal işleri KESEMİYOR; yukarıdaki İptal token'ı bölümünden yeni token girin ya da silin.
          </div>
        )}
        {status && (status.open.stillRunning > 0 || status.open.failed > 0) && (
          <div className="text-xs mb-2 px-3 py-2 rounded-lg border border-red-300 bg-red-50 text-red-700 font-semibold">
            {status.open.failed > 0 && `${status.open.failed} iş İPTAL EDİLEMEDİ ve AWX'te çalışmaya devam ediyor. `}
            {status.open.stillRunning > 0 && `${status.open.stillRunning} iş için iptal istendi ama durmadı.`}
          </div>
        )}
        {dryErr && <div className="text-xs text-red-600 mb-2">Kuru çalıştırma: {dryErr}</div>}
        {dry && <TickView title="Kuru çalıştırma sonucu — hiçbir iş iptal EDİLMEDİ" tick={dry} />}
        {status?.lastTick ? (
          <TickView title="Son tarama" tick={status.lastTick} />
        ) : (
          status && <div className="text-[11px] text-gray-500 mb-2">Bu Portal örneğinde henüz tarama yapılmadı.</div>
        )}
        <div className="text-xs font-semibold text-gray-700 mt-3 mb-1">Son iptal denemeleri (en fazla 50)</div>
        {status && <AttemptsView attempts={status.attempts} />}
      </div>
    </section>
  );
}
