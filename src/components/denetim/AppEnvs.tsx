// src/components/denetim/AppEnvs.tsx — "Denetim > Uygulama Ortamlari" (2026-08-23).
//
// SPA tarafindaki matrisin ayni'si, ama kaynak MWAppsInventory / WASAppsInventory ve
// ortam bilgisi UYGULAMA ADINDAN geliyor:
//   <Uygulama>-D / -T / -Q  -> dev / test / qa,  eksiz ad -> production
//
// Uc bolum: matris, ad kuralina uymayanlar, ad ile env sutununun celistigi kayitlar.
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowPathIcon, ArrowDownTrayIcon, MagnifyingGlassIcon, ExclamationTriangleIcon,
} from "@heroicons/react/24/outline";
import { denetimApi, type AppEnvsResult } from "@/api/denetimApi";
import { Select } from "@/components/ui/Form";
import { fmtNumber } from "@/utils/datetime";
import { TableEmptyRow } from "@/components/common/EmptyState";

const nf = (n: number) => fmtNumber(n);

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

export default function AppEnvs() {
  const [source, setSource] = useState("mw");
  const [data, setData] = useState<AppEnvsResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [view, setView] = useState<"matris" | "sapma" | "celiski">("matris");
  const [q, setQ] = useState("");
  const [onlyMissing, setOnlyMissing] = useState(false);

  const load = useCallback(async (s: string) => {
    setLoading(true);
    try {
      const r = await denetimApi.appEnvs(s);
      if (r.ok) { setData(r); setErr(""); } else setErr(r.message || "Veri alınamadı.");
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(source); }, [source, load]);

  const rows = useMemo(() => {
    if (!data) return [];
    const needle = q.trim().toLowerCase();
    return data.rows.filter((r) => {
      if (onlyMissing && r.missingCount === 0) return false;
      if (needle && !r.base.toLowerCase().includes(needle)) return false;
      return true;
    });
  }, [data, q, onlyMissing]);

  const filtered = <T extends { app: string }>(list: T[]) => {
    const needle = q.trim().toLowerCase();
    return needle ? list.filter((x) => x.app.toLowerCase().includes(needle)) : list;
  };

  if (loading && !data) return <div className="py-10 text-center text-sm text-gray-400">Yükleniyor…</div>;
  if (err) return <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-xl px-3 py-2">{err}</div>;
  if (!data) return null;

  const envs = data.envs;
  const sapma = filtered(data.nonStandard);
  const celiski = filtered(data.conflicts);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Select sizeVariant="sm" value={source} onChange={(e) => setSource(e.target.value)}>
          {data.sources.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
        </Select>

        <div className="flex gap-1 rounded-lg p-0.5 bg-gray-100">
          {([
            { id: "matris", label: `Matris (${nf(data.totalApps)})` },
            { id: "sapma", label: `Ad kuralı dışı (${nf(data.nonStandard.length)})` },
            { id: "celiski", label: `Çelişki (${nf(data.conflicts.length)})` },
          ] as const).map((v) => (
            <button
              key={v.id}
              onClick={() => setView(v.id)}
              className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                view === v.id ? "bg-white shadow-sm text-black" : "text-gray-500 hover:text-gray-700"
              }`}
            >
              {v.label}
            </button>
          ))}
        </div>

        <div className="relative">
          <MagnifyingGlassIcon className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            value={q} onChange={(e) => setQ(e.target.value)} placeholder="uygulama ara"
            className="pl-8 pr-2.5 py-1.5 text-xs border border-gray-200 rounded-lg w-56"
          />
        </div>
        {view === "matris" && (
          <label className="flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer">
            <input type="checkbox" checked={onlyMissing} onChange={(e) => setOnlyMissing(e.target.checked)} />
            Sadece eksiği olanlar
          </label>
        )}

        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={() => (view === "matris"
              ? csvDownload("uygulama_ortamlari_" + source,
                  ["uygulama", ...envs, "eksik"],
                  rows.map((r) => [r.base, ...envs.map((e) => (r.envs[e] ? "VAR" : "YOK")), r.missing.join(" ")]))
              : view === "sapma"
                ? csvDownload("ad_kurali_disi_" + source,
                    ["uygulama", "sebep", "env_sutunu", "sunucular"],
                    sapma.map((n) => [n.app, n.reason, n.envColumn.join(" "), n.hosts.join(" ")]))
                : csvDownload("ortam_celiskisi_" + source,
                    ["uygulama", "ad_ortami", "env_sutunu", "sunucular"],
                    celiski.map((c) => [c.app, c.nameEnv, c.envColumn, c.hosts.join(" ")])))}
            className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg hover:bg-gray-50"
          >
            <ArrowDownTrayIcon className="w-3.5 h-3.5" /> CSV
          </button>
          <button onClick={() => load(source)} className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg hover:bg-gray-50">
            <ArrowPathIcon className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} /> Yenile
          </button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat n={data.totalApps} l="uygulama (taban ad)" />
        <Stat n={data.completeCount} l="dört ortamda da var" tone="ok" />
        <Stat n={data.totalApps - data.completeCount} l="en az bir ortamda eksik" tone="warn" />
        <Stat n={data.nonStandard.length + data.conflicts.length} l="ad kuralı dışı + çelişki"
              tone={data.nonStandard.length + data.conflicts.length ? "warn" : undefined} />
      </div>

      <p className="text-[11px] text-gray-400">
        Ortam, uygulama adının son ekinden türer:{" "}
        <code className="px-1 rounded bg-gray-100">-D</code> geliştirme,{" "}
        <code className="px-1 rounded bg-gray-100">-T</code> test,{" "}
        <code className="px-1 rounded bg-gray-100">-Q</code> QA, eksiz ad production.
        Satırlar son ek atılmış <b>taban ada</b> göre gruplanır.
      </p>

      {data.outOfScopeEnvColumns.length > 0 && (
        <p className="text-[11px] text-gray-500 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
          Şu ortamların ad kuralında karşılığı yok:{" "}
          {data.outOfScopeEnvColumns.map((u) => `${u.envColumn} (${nf(u.appCount)} uygulama)`).join(", ")}.
          Bu uygulamaların adında son ek olmadığı için matriste <b>production</b> kutusunda
          görünürler; çelişki sayılmazlar ama gerçekte o ortamın sunucularında çalışıyorlar.
        </p>
      )}

      {view === "matris" && (
        <>
          {data.patterns.length > 0 && (
            <div className="rounded-xl border border-gray-100 bg-gray-50/60 px-4 py-3">
              <div className="text-xs font-semibold text-gray-700 mb-1.5">En sık eksik ortam desenleri</div>
              <div className="flex flex-wrap gap-2">
                {data.patterns.map((p) => (
                  <span key={p.missing.join(",")} className="text-[11px] px-2 py-1 rounded-lg bg-white border border-gray-200">
                    eksik: <b className="font-mono">{p.missing.join(", ")}</b> · {nf(p.count)} uygulama
                  </span>
                ))}
              </div>
            </div>
          )}

          <div className="overflow-x-auto rounded-xl border border-gray-100">
            <table className="w-full min-w-max text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100 text-left">
                  <th className="px-3 py-2 text-xs font-semibold text-gray-500">Uygulama</th>
                  {envs.map((e) => <th key={e} className="px-3 py-2 text-xs font-semibold text-gray-500">{e}</th>)}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {rows.length === 0 && (
                  <TableEmptyRow colSpan={envs.length + 1} />
                )}
                {rows.slice(0, 500).map((r) => (
                  <tr key={r.base} className="hover:bg-gray-50/60">
                    <td className="px-3 py-2 font-mono text-xs text-gray-800">{r.base}</td>
                    {envs.map((e) => {
                      const hit = r.envs[e];
                      return (
                        <td key={e} className="px-3 py-2">
                          {hit ? (
                            <span
                              className="text-[11px] px-2 py-0.5 rounded-lg border bg-emerald-50 text-emerald-700 border-emerald-200"
                              title={`${hit.rows} kayıt\nSunucular: ${hit.hosts.join(", ")}`}
                            >
                              VAR
                              {hit.hosts.length > 1 && (
                                <span className="ml-1 opacity-70 tabular-nums">×{hit.hosts.length}</span>
                              )}
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
        </>
      )}

      {view === "sapma" && (
        <div className="overflow-x-auto rounded-xl border border-gray-100">
          <table className="w-full min-w-max text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100 text-left">
                <th className="px-3 py-2 text-xs font-semibold text-gray-500">Uygulama</th>
                <th className="px-3 py-2 text-xs font-semibold text-gray-500">Sebep</th>
                <th className="px-3 py-2 text-xs font-semibold text-gray-500">env sütunu</th>
                <th className="px-3 py-2 text-xs font-semibold text-gray-500">Sunucular</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {sapma.length === 0 && (
                <tr><td colSpan={4} className="px-3 py-8 text-center text-sm text-gray-400">
                  Ad kuralına uymayan uygulama yok.
                </td></tr>
              )}
              {sapma.slice(0, 500).map((n) => (
                <tr key={n.app} className="hover:bg-gray-50/60 align-top">
                  <td className="px-3 py-2 font-mono text-xs text-gray-800 whitespace-nowrap">{n.app}</td>
                  <td className="px-3 py-2 text-xs text-amber-700">{n.reason}</td>
                  <td className="px-3 py-2 text-xs text-gray-500">{n.envColumn.join(", ") || "—"}</td>
                  <td className="px-3 py-2 text-[11px] font-mono text-gray-500">{n.hosts.slice(0, 6).join(", ")}{n.hosts.length > 6 && ` … (+${n.hosts.length - 6})`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {view === "celiski" && (
        <>
          <p className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 flex gap-2">
            <ExclamationTriangleIcon className="w-4 h-4 shrink-0 mt-0.5" />
            <span>
              Uygulama adının söylediği ortam ile envanterdeki <code className="px-1 rounded bg-white/70 border border-amber-200">env</code>{" "}
              sütunu uyuşmuyor. env sütunu <b>sunucu adından</b> türetilir, yani bu uygulamalar
              adlarının işaret ettiğinden başka bir ortamın sunucusunda çalışıyor olabilir.
              Not: sunucu adı geliştirme ile testi ayırt edemediği için (ikisi de “Test” yazar)
              <code className="px-1 rounded bg-white/70 border border-amber-200 mx-1">-D</code>
              uygulamaları bu listeye <b>girmez</b> — sahte uyarı üretmemek için.
            </span>
          </p>
          <div className="overflow-x-auto rounded-xl border border-gray-100">
            <table className="w-full min-w-max text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100 text-left">
                  <th className="px-3 py-2 text-xs font-semibold text-gray-500">Uygulama</th>
                  <th className="px-3 py-2 text-xs font-semibold text-gray-500">Ada göre ortam</th>
                  <th className="px-3 py-2 text-xs font-semibold text-gray-500">env sütunu</th>
                  <th className="px-3 py-2 text-xs font-semibold text-gray-500">Sunucular</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {celiski.length === 0 && (
                  <TableEmptyRow colSpan={4} title="Çelişki bulunamadı." description="Bu tarama turunda ortamlar arasında ad çakışması saptanmadı." />
                )}
                {celiski.slice(0, 500).map((c) => (
                  <tr key={c.app} className="hover:bg-gray-50/60 align-top">
                    <td className="px-3 py-2 font-mono text-xs text-gray-800 whitespace-nowrap">{c.app}</td>
                    <td className="px-3 py-2">
                      <span className="text-[11px] px-2 py-0.5 rounded-lg border bg-sky-50 text-sky-700 border-sky-200">{c.nameEnv}</span>
                    </td>
                    <td className="px-3 py-2">
                      <span className="text-[11px] px-2 py-0.5 rounded-lg border bg-red-50 text-red-700 border-red-200">{c.envColumn}</span>
                    </td>
                    <td className="px-3 py-2 text-[11px] font-mono text-gray-500">{c.hosts.slice(0, 6).join(", ")}{c.hosts.length > 6 && ` … (+${c.hosts.length - 6})`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

function Stat({ n, l, tone }: { n: number; l: string; tone?: "ok" | "warn" }) {
  const color = tone === "ok" ? "text-emerald-600" : tone === "warn" ? "text-amber-600" : "text-gray-900";
  return (
    <div className="rounded-xl border border-gray-100 bg-white px-4 py-3">
      <div className={`text-2xl font-bold tabular-nums ${color}`}>{nf(n)}</div>
      <div className="text-xs text-gray-500 mt-0.5">{l}</div>
    </div>
  );
}
