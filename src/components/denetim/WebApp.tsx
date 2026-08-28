// src/components/denetim/WebApp.tsx — "Denetim > Web-App İlişkisi" (2026-08-23).
//
// Her uygulama satirinin onunde onu SERVIS EDEN web sunucusu: host, ip, port, server_name.
// Eslesmenin NASIL kuruldugu her satirda yaziyor - kural tahmine dayali oldugu icin
// guvenilirlik gizlenmemeli (route eslesmesinde oldugu gibi).
import React, { useCallback, useEffect, useState } from "react";
import {
  ArrowPathIcon, ArrowDownTrayIcon, MagnifyingGlassIcon,
} from "@heroicons/react/24/outline";
import { denetimApi, type WebAppResult } from "@/api/denetimApi";
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

export default function WebApp() {
  const [source, setSource] = useState("mw");
  const [q, setQ] = useState("");
  const [onlyUnmatched, setOnlyUnmatched] = useState(false);
  const [data, setData] = useState<WebAppResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  const load = useCallback(async (s: string, needle: string, unmatched: boolean) => {
    setLoading(true);
    try {
      const r = await denetimApi.webApp(s, needle, unmatched);
      if (r.ok) { setData(r); setErr(""); } else setErr(r.message || "Veri alınamadı.");
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally { setLoading(false); }
  }, []);

  // Arama sunucu tarafinda uygulaniyor (tablo buyuk); yazarken her tusa istek atmamak
  // icin kisa bir gecikme.
  useEffect(() => {
    const t = setTimeout(() => load(source, q, onlyUnmatched), 300);
    return () => clearTimeout(t);
  }, [source, q, onlyUnmatched, load]);

  if (loading && !data) return <div className="py-10 text-center text-sm text-gray-400">Yükleniyor…</div>;
  if (err) return <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-xl px-3 py-2">{err}</div>;
  if (!data) return null;

  const matchedCount = data.matchSummary
    .filter((m) => m.how.includes("server_name ("))
    .reduce((a, m) => a + m.count, 0);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Select sizeVariant="sm" value={source} onChange={(e) => setSource(e.target.value)}>
          {data.sources.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
        </Select>
        <div className="relative">
          <MagnifyingGlassIcon className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            value={q} onChange={(e) => setQ(e.target.value)} placeholder="uygulama ya da sunucu ara"
            className="pl-8 pr-2.5 py-1.5 text-xs border border-gray-200 rounded-lg w-64"
          />
        </div>
        <label className="flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer">
          <input type="checkbox" checked={onlyUnmatched} onChange={(e) => setOnlyUnmatched(e.target.checked)} />
          Sadece eşleşmeyenler
        </label>
        <span className="text-xs text-gray-400 tabular-nums">
          {nf(data.shown)} / {nf(data.total)} satır
        </span>
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={() => csvDownload("web_app_" + source,
              ["uygulama", "uygulama_sunucusu", "ortam", "domain", "tier", "web_sunucusu", "ip", "port", "server_name", "conf_file", "urun", "eslesme"],
              data.rows.flatMap((r) => (r.web.length
                ? r.web.map((w) => [r.app, r.appHost, r.env, r.domain, r.tier, w.host, w.ip, w.port, w.serverName, w.confFile, w.product, r.how])
                : [[r.app, r.appHost, r.env, r.domain, r.tier, r.webHostCandidate, "", "", "", "", "", r.how]])))}
            className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg hover:bg-gray-50"
          >
            <ArrowDownTrayIcon className="w-3.5 h-3.5" /> CSV
          </button>
          <button onClick={() => load(source, q, onlyUnmatched)} className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg hover:bg-gray-50">
            <ArrowPathIcon className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} /> Yenile
          </button>
        </div>
      </div>

      {data.certMissing && (
        <p className="text-[11px] text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          Sertifika envanteri okunamadı — web sunucusu bilgisi çıkarılamıyor.{" "}
          <code className="px-1 rounded bg-white/70 border border-red-200">certificates_inventory</code>{" "}
          job’ı çalıştıktan sonra burası dolar.
        </p>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat n={data.total} l="uygulama satırı" />
        <Stat n={matchedCount} l="web sunucusu bulundu" tone="ok" />
        <Stat n={data.total - matchedCount} l="eşleşmedi" tone={data.total - matchedCount ? "warn" : undefined} />
        <Stat n={data.tierSummary.find((t) => t.tier === "3-tier")?.count ?? 0} l="3-tier uygulama" />
      </div>

      <div className="rounded-xl border border-gray-100 bg-gray-50/60 px-4 py-3">
        <div className="text-xs font-semibold text-gray-700 mb-1.5">Eşleşme nasıl kuruldu?</div>
        <div className="flex flex-wrap gap-2">
          {data.matchSummary.map((m) => (
            <span key={m.how} className={`text-[11px] px-2 py-1 rounded-lg border ${
              m.how.includes("server_name (") ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                : m.how === "eşleşmedi" ? "bg-red-50 text-red-700 border-red-200"
                : "bg-amber-50 text-amber-700 border-amber-200"
            }`}>
              {m.how} · {nf(m.count)}
            </span>
          ))}
        </div>
        <p className="text-[11px] text-gray-400 mt-2 max-w-4xl">
          3-tier sunucularda web sunucusu, uygulama sunucusunun adındaki <b>5. karakter</b>{" "}
          <code className="px-1 rounded bg-white">A</code> →{" "}
          <code className="px-1 rounded bg-white">W</code> çevrilerek bulunur
          (DACR<b>A</b>AP01 → DACR<b>W</b>AP01). 2-tier’de web sunucusu uygulamanın kendi
          sunucusudur. Doğru vhost’u bulmak için uygulama adı küçük harfle{" "}
          <code className="px-1 rounded bg-white">server_name</code> içinde aranır — önce tam
          ad, tutmazsa ortam son eki atılmış taban ad. Hangi biçimin tuttuğu satırda yazar.
        </p>
      </div>

      <div className="overflow-x-auto rounded-xl border border-gray-100">
        <table className="w-full min-w-max text-sm">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-100 text-left">
              <th className="px-3 py-2 text-xs font-semibold text-gray-500">Uygulama</th>
              <th className="px-3 py-2 text-xs font-semibold text-gray-500">Uyg. sunucusu</th>
              <th className="px-3 py-2 text-xs font-semibold text-gray-500">Web sunucusu</th>
              <th className="px-3 py-2 text-xs font-semibold text-gray-500">IP : Port</th>
              <th className="px-3 py-2 text-xs font-semibold text-gray-500">server_name</th>
              <th className="px-3 py-2 text-xs font-semibold text-gray-500">Eşleşme</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {data.rows.length === 0 && (
              <TableEmptyRow colSpan={6} />
            )}
            {data.rows.map((r) => (
              <tr key={`${r.app}|${r.appHost}`} className="hover:bg-gray-50/60 align-top">
                <td className="px-3 py-2 font-mono text-xs text-gray-800 whitespace-nowrap">
                  {r.app}
                  <span className="ml-1.5 text-[10px] px-1 py-0.5 rounded border bg-gray-50 text-gray-500 border-gray-200">{r.tier}</span>
                </td>
                <td className="px-3 py-2 font-mono text-xs text-gray-600 whitespace-nowrap">{r.appHost}</td>
                <td className="px-3 py-2 font-mono text-xs whitespace-nowrap">
                  {r.web.length ? (
                    <div className="flex flex-col gap-0.5">
                      {r.web.map((w, i) => <span key={i} className="text-gray-800">{w.host}</span>)}
                    </div>
                  ) : (
                    <span className="text-gray-400" title="Kurala göre beklenen sunucu; doğrulanamadı">
                      {r.webHostCandidate} <span className="opacity-70">(aday)</span>
                    </span>
                  )}
                </td>
                <td className="px-3 py-2 font-mono text-xs text-gray-600 whitespace-nowrap tabular-nums">
                  {r.web.length ? (
                    <div className="flex flex-col gap-0.5">
                      {r.web.map((w, i) => <span key={i}>{w.ip}{w.port ? `:${w.port}` : ""}</span>)}
                    </div>
                  ) : <span className="text-gray-300">—</span>}
                </td>
                <td className="px-3 py-2 font-mono text-[11px] text-gray-700">
                  {r.web.length ? (
                    <div className="flex flex-col gap-0.5">
                      {r.web.map((w, i) => (
                        <span key={i} title={w.confFile ? `conf: ${w.confFile}` : undefined}>
                          {w.serverName}
                          {w.product && <span className="ml-1 text-[10px] text-gray-400">{w.product}</span>}
                        </span>
                      ))}
                    </div>
                  ) : <span className="text-gray-300">—</span>}
                </td>
                <td className="px-3 py-2">
                  <span className={`text-[10px] px-1.5 py-0.5 rounded border whitespace-nowrap ${
                    r.matched ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                      : r.how === "eşleşmedi" ? "bg-red-50 text-red-700 border-red-200"
                      : "bg-amber-50 text-amber-700 border-amber-200"
                  }`}>
                    {r.how}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {data.capped && (
        <p className="text-xs text-gray-400">
          İlk {nf(data.shown)} satır gösteriliyor — daraltmak için arama kutusunu kullanın ya
          da CSV indirin. Özet sayılar <b>tüm</b> satırlar üzerinden hesaplanır.
        </p>
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
