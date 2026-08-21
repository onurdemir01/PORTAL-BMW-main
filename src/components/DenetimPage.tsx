// src/components/DenetimPage.tsx — "Denetim" sayfasi (2026-08-21, kullanici talebi).
// Iki ayri denetim konusu, ust seviyede iki sekme:
//   1) Nginx SPA Audit  -> Teams bildirimindeki ozetin AYRINTILI hali; servis bazinda
//      alt sekmeler, ortam (DEV/TEST/QA/PROD) karsilastirmali uygulama matrisi,
//      uygulamanin OpenShift envanterinde olup olmadigi.
//   2) OpenShift Kapsam -> bir uygulamanin bir platformun HANGI ortamlarinda EKSIK
//      oldugu (ornek: prod'da var, non-prod'da yok).
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ShieldCheckIcon, ArrowPathIcon, MagnifyingGlassIcon, ServerStackIcon,
  Squares2X2Icon, QuestionMarkCircleIcon, ArrowDownTrayIcon,
} from "@heroicons/react/24/outline";
import {
  denetimApi, type NginxSpaResult, type OcpCoverageResult, type NginxSpaEnvCell,
} from "@/api/denetimApi";
import { Select } from "@/components/ui/Form";
import HelpModal, { type HelpSection } from "@/components/common/HelpModal";
import { toast } from "@/hooks/useToast";

const HELP: HelpSection[] = [
  {
    icon: ServerStackIcon,
    title: "Nginx SPA Audit",
    body: "nginx_config_audit job'ının günlük taramasını gösterir. Her satır bir uygulama; sütunlar ortamlar (DEV/TEST/QA/PROD). Hücre rengi o ortamdaki durumu anlatır: yeşil sorunsuz, kırmızı kırık include ya da eksik dağıtım, sarı OpenShift envanterinde bulunamadı. Üstteki servis sekmeleriyle (GLOMO, WEBFORMS…) tek tek inceleyebilirsiniz.",
  },
  {
    icon: Squares2X2Icon,
    title: "OpenShift Kapsam",
    body: "Bir uygulamanın bir platformun hangi ortamlarında var, hangilerinde eksik olduğunu gösterir. Ortam bilgisi cluster'dan DEĞİL, namespace son ekinden (-dev/-test/-qa/-prod) gelir — çünkü ark_dev ile ark_test aynı cluster'ları paylaşır, cluster tek başına ortam bilgisi taşımaz.",
  },
];

const STATUS_META: Record<string, { label: string; cls: string }> = {
  OK:               { label: "Sorunsuz",              cls: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  DUP_SUFFIX:       { label: "Yinelenen ek",          cls: "bg-sky-50 text-sky-700 border-sky-200" },
  NOT_IN_INVENTORY: { label: "Envanterde yok",        cls: "bg-amber-50 text-amber-700 border-amber-200" },
  NAME_MISMATCH:    { label: "Ad/içerik uyuşmuyor",   cls: "bg-orange-50 text-orange-700 border-orange-200" },
  NOT_DEPLOYED:     { label: "Dağıtılmamış",          cls: "bg-red-50 text-red-700 border-red-200" },
  BROKEN_INCLUDE:   { label: "Kırık include",         cls: "bg-red-100 text-red-800 border-red-300" },
};

function csvDownload(name: string, header: string[], rows: (string | number)[][]) {
  const body = [header, ...rows]
    .map((r) => r.map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(","))
    .join("\n");
  const blob = new Blob(["﻿" + body], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${name}_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export default function DenetimPage() {
  const [tab, setTab] = useState<"nginx" | "ocp">("nginx");
  const [showHelp, setShowHelp] = useState(false);

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <div className="flex items-center gap-2">
            <ShieldCheckIcon className="w-6 h-6 text-[var(--accent)]" />
            <h1 className="text-xl font-bold">Denetim</h1>
          </div>
          <p className="text-sm mt-1" style={{ color: "var(--text-muted)" }}>
            Nginx SPA tanımlarının ve OpenShift ortam kapsamının denetimi.
          </p>
        </div>
        <button
          onClick={() => setShowHelp(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-gray-200 rounded-lg hover:bg-gray-50"
        >
          <QuestionMarkCircleIcon className="w-4 h-4" /> Nasıl kullanılır?
        </button>
      </div>

      <div className="flex gap-1 rounded-xl p-1 bg-gray-100 w-fit">
        {([
          { id: "nginx", label: "Nginx SPA Audit", icon: ServerStackIcon },
          { id: "ocp", label: "OpenShift Kapsam", icon: Squares2X2Icon },
        ] as const).map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
              tab === t.id ? "bg-white shadow-sm text-black" : "text-gray-500 hover:text-gray-700"
            }`}
          >
            <t.icon className="w-4 h-4" /> {t.label}
          </button>
        ))}
      </div>

      {tab === "nginx" ? <NginxSpaAudit /> : <OcpCoverage />}

      <HelpModal open={showHelp} onClose={() => setShowHelp(false)} title="Denetim — Nasıl Kullanılır?" sections={HELP} />
    </div>
  );
}

// ── 1) NGINX SPA AUDIT ────────────────────────────────────────────────────────────────
function NginxSpaAudit() {
  const [data, setData] = useState<NginxSpaResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [service, setService] = useState<string>("");
  const [scanDate, setScanDate] = useState<string>("");
  const [q, setQ] = useState("");
  const [onlyProblems, setOnlyProblems] = useState(false);

  const load = useCallback(async (d?: string) => {
    setLoading(true);
    try {
      const r = await denetimApi.nginxSpa(d);
      if (r.ok) {
        setData(r);
        setErr("");
        setScanDate(r.scanDate || "");
        setService((prev) => (prev && r.services.includes(prev) ? prev : r.services[0] || ""));
      } else setErr(r.message || "Veri alınamadı.");
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const envs = data?.envs || ["DEV", "TEST", "QA", "PROD"];
  const rows = useMemo(() => {
    if (!data) return [];
    const needle = q.trim().toLowerCase();
    return data.rows.filter((r) => {
      if (service && r.service !== service) return false;
      if (needle && !r.application.toLowerCase().includes(needle)) return false;
      if (onlyProblems) {
        const bad = Object.values(r.envs).some((c) => c.status && c.status !== "OK");
        if (!bad) return false;
      }
      return true;
    });
  }, [data, service, q, onlyProblems]);

  if (loading && !data) return <div className="py-10 text-center text-sm text-gray-400">Yükleniyor…</div>;
  if (err) return <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-xl px-3 py-2">{err}</div>;
  if (!data?.scanDate) {
    return (
      <div className="text-sm text-gray-500 bg-gray-50 border border-gray-100 rounded-xl px-4 py-6 text-center">
        Henüz bir tarama kaydı yok. <code className="font-mono">nginx_config_audit</code> job'ı çalıştıktan sonra burası dolacak.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Select sizeVariant="sm" value={scanDate} onChange={(e) => { setScanDate(e.target.value); load(e.target.value); }}>
          {data.availableDates.map((d) => <option key={d} value={d}>{d}</option>)}
        </Select>
        <div className="relative">
          <MagnifyingGlassIcon className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            value={q} onChange={(e) => setQ(e.target.value)} placeholder="uygulama ara"
            className="pl-8 pr-2.5 py-1.5 text-xs border border-gray-200 rounded-lg w-56"
          />
        </div>
        <label className="flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer">
          <input type="checkbox" checked={onlyProblems} onChange={(e) => setOnlyProblems(e.target.checked)} />
          Sadece sorunlular
        </label>
        <span className="text-xs text-gray-400 tabular-nums">{rows.length} uygulama</span>
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={() => csvDownload(
              `nginx_spa_audit_${service || "tum"}`,
              ["service", "application", ...envs],
              rows.map((r) => [r.service, r.application, ...envs.map((e) => r.envs[e]?.status || "-")])
            )}
            className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg hover:bg-gray-50"
          >
            <ArrowDownTrayIcon className="w-3.5 h-3.5" /> CSV
          </button>
          <button onClick={() => load(scanDate)} className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg hover:bg-gray-50">
            <ArrowPathIcon className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} /> Yenile
          </button>
        </div>
      </div>

      {/* Servis sekmeleri — kullanici talebi: "yan yana sekme sekme <Servis>" */}
      <div className="flex gap-1 flex-wrap border-b border-gray-200">
        {data.services.map((s) => (
          <button
            key={s}
            onClick={() => setService(s)}
            className={`px-3 py-1.5 text-xs font-semibold rounded-t-lg border-b-2 -mb-px transition-colors ${
              service === s ? "border-[var(--accent)] text-[var(--accent)]" : "border-transparent text-gray-500 hover:text-gray-700"
            }`}
          >
            {s}
          </button>
        ))}
      </div>

      <div className="overflow-x-auto rounded-xl border border-gray-100">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-100 text-left">
              <th className="px-3 py-2 text-xs font-semibold text-gray-500">Uygulama</th>
              {envs.map((e) => <th key={e} className="px-3 py-2 text-xs font-semibold text-gray-500">{e}</th>)}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {rows.length === 0 && (
              <tr><td colSpan={envs.length + 1} className="px-3 py-8 text-center text-sm text-gray-400">Kayıt bulunamadı.</td></tr>
            )}
            {rows.map((r) => (
              <tr key={r.service + r.application} className="hover:bg-gray-50/60">
                <td className="px-3 py-2 font-mono text-xs text-gray-800">{r.application}</td>
                {envs.map((e) => <EnvCell key={e} cell={r.envs[e]} />)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function EnvCell({ cell }: { cell?: NginxSpaEnvCell }) {
  if (!cell) return <td className="px-3 py-2"><span className="text-xs text-gray-300">—</span></td>;
  const meta = STATUS_META[cell.status] || { label: cell.status, cls: "bg-gray-100 text-gray-600 border-gray-200" };
  return (
    <td className="px-3 py-2">
      <div
        className={`inline-flex flex-col gap-0.5 text-[11px] px-2 py-1 rounded-lg border ${meta.cls}`}
        title={[
          `Durum: ${meta.label}`,
          cell.namespace ? `Namespace: ${cell.namespace}` : null,
          cell.deployMode ? `Dağıtım: ${cell.deployMode}` : null,
          `Context path: ${cell.locationPath}`,
          `Sunucular: ${cell.hosts.join(", ")}`,
        ].filter(Boolean).join("\n")}
      >
        <span className="font-semibold">{meta.label}</span>
        {!cell.inOcpInventory && <span className="opacity-80">OCP'de yok</span>}
      </div>
    </td>
  );
}

// ── 2) OPENSHIFT KAPSAM ───────────────────────────────────────────────────────────────
function OcpCoverage() {
  const [platform, setPlatform] = useState("ark");
  const [data, setData] = useState<OcpCoverageResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [q, setQ] = useState("");
  const [onlyMissing, setOnlyMissing] = useState(true);

  const load = useCallback(async (p: string) => {
    setLoading(true);
    try {
      const r = await denetimApi.ocpCoverage(p);
      if (r.ok) { setData(r); setErr(""); }
      else setErr(r.message || "Veri alınamadı.");
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(platform); }, [platform, load]);

  const envs = data?.envs || ["dev", "test", "qa", "prod"];
  const rows = useMemo(() => {
    if (!data) return [];
    const needle = q.trim().toLowerCase();
    return data.rows.filter((r) => {
      if (onlyMissing && r.missingCount === 0) return false;
      if (needle && !r.application.toLowerCase().includes(needle)) return false;
      return true;
    });
  }, [data, q, onlyMissing]);

  if (loading && !data) return <div className="py-10 text-center text-sm text-gray-400">Yükleniyor…</div>;
  if (err) return <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-xl px-3 py-2">{err}</div>;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Select sizeVariant="sm" value={platform} onChange={(e) => setPlatform(e.target.value)}>
          {(data?.platforms || ["ark"]).map((p) => <option key={p} value={p}>{p}</option>)}
        </Select>
        <div className="relative">
          <MagnifyingGlassIcon className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            value={q} onChange={(e) => setQ(e.target.value)} placeholder="uygulama ara"
            className="pl-8 pr-2.5 py-1.5 text-xs border border-gray-200 rounded-lg w-56"
          />
        </div>
        <label className="flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer">
          <input type="checkbox" checked={onlyMissing} onChange={(e) => setOnlyMissing(e.target.checked)} />
          Sadece eksiği olanlar
        </label>
        <span className="text-xs text-gray-400 tabular-nums">{rows.length} uygulama</span>
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={() => csvDownload(
              `ocp_kapsam_${platform}`,
              ["application", ...envs, "eksik"],
              rows.map((r) => [r.application, ...envs.map((e) => (r.envs[e]?.length ? "VAR" : "YOK")), r.missing.join(" ")])
            )}
            className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg hover:bg-gray-50"
          >
            <ArrowDownTrayIcon className="w-3.5 h-3.5" /> CSV
          </button>
          <button onClick={() => load(platform)} className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg hover:bg-gray-50">
            <ArrowPathIcon className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} /> Yenile
          </button>
        </div>
      </div>

      {data && (
        <div className="grid gap-3 md:grid-cols-4">
          <Stat n={data.totalApplications} l="toplam uygulama" />
          <Stat n={data.completeCount} l="tüm ortamlarda var" tone="ok" />
          <Stat n={data.totalApplications - data.completeCount} l="en az bir ortamda eksik" tone="warn" />
          <Stat n={data.clusters.length} l="cluster" />
        </div>
      )}

      {data && data.patterns.length > 0 && (
        <div className="rounded-xl border border-gray-100 bg-gray-50/60 px-4 py-3">
          <div className="text-xs font-semibold text-gray-700 mb-1.5">En sık eksik ortam desenleri</div>
          <div className="flex flex-wrap gap-2">
            {data.patterns.map((p) => (
              <span key={p.missing.join(",")} className="text-[11px] px-2 py-1 rounded-lg bg-white border border-gray-200">
                eksik: <b className="font-mono">{p.missing.join(", ")}</b> · {p.count} uygulama
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border border-gray-100">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-100 text-left">
              <th className="px-3 py-2 text-xs font-semibold text-gray-500">Uygulama</th>
              {envs.map((e) => <th key={e} className="px-3 py-2 text-xs font-semibold text-gray-500 uppercase">{e}</th>)}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {rows.length === 0 && (
              <tr><td colSpan={envs.length + 1} className="px-3 py-8 text-center text-sm text-gray-400">Kayıt bulunamadı.</td></tr>
            )}
            {rows.slice(0, 500).map((r) => (
              <tr key={r.application} className="hover:bg-gray-50/60">
                <td className="px-3 py-2 font-mono text-xs text-gray-800">{r.application}</td>
                {envs.map((e) => {
                  const hit = r.envs[e];
                  return (
                    <td key={e} className="px-3 py-2">
                      {hit?.length ? (
                        <span
                          className="text-[11px] px-2 py-0.5 rounded-lg border bg-emerald-50 text-emerald-700 border-emerald-200"
                          title={hit.map((h) => `${h.cluster} / ${h.namespace}`).join("\n")}
                        >
                          VAR
                        </span>
                      ) : (
                        <span className="text-[11px] px-2 py-0.5 rounded-lg border bg-red-50 text-red-600 border-red-200">YOK</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length > 500 && (
        <p className="text-xs text-gray-400">İlk 500 satır gösteriliyor — daraltmak için arama kutusunu kullanın ya da CSV indirin.</p>
      )}
    </div>
  );
}

function Stat({ n, l, tone }: { n: number; l: string; tone?: "ok" | "warn" }) {
  const color = tone === "ok" ? "text-emerald-600" : tone === "warn" ? "text-amber-600" : "text-gray-900";
  return (
    <div className="rounded-xl border border-gray-100 bg-white px-4 py-3">
      <div className={`text-2xl font-bold tabular-nums ${color}`}>{n.toLocaleString("tr-TR")}</div>
      <div className="text-xs text-gray-500 mt-0.5">{l}</div>
    </div>
  );
}
