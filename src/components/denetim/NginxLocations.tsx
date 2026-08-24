// src/components/denetim/NginxLocations.tsx — "Nginx SPA Audit > Location Detayı" (2026-08-24).
//
// Servis ve ortam secilerek, o kirilimda TANIMLI her location:
//     /<Path>/   <Namespace>   <Application>   + include dosyasi + durum
//
// DURUST SINIR: location blogunun HAM GOVDESI taranmiyor (nginx_config_scan.sh yalnizca
// "location ... { include ... }" ciftini kaydediyor). Ekran bunu acikca soyluyor; uydurma
// bir blok metni URETILMIYOR.
import React, { useCallback, useEffect, useState } from "react";
import {
  ArrowPathIcon, ArrowDownTrayIcon, MagnifyingGlassIcon,
} from "@heroicons/react/24/outline";
import { denetimApi, type NginxLocationsResult } from "@/api/denetimApi";
import { Select } from "@/components/ui/Form";

const nf = (n: number) => n.toLocaleString("tr-TR");

const STATUS_TR: Record<string, { label: string; cls: string }> = {
  OK:               { label: "Sorunsuz",            cls: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  MULTI_PATH:       { label: "Çoklu bağlama",       cls: "bg-sky-50 text-sky-700 border-sky-200" },
  DUP_SUFFIX:       { label: "Yinelenen ek",        cls: "bg-sky-50 text-sky-700 border-sky-200" },
  NOT_IN_INVENTORY: { label: "Envanterde yok",      cls: "bg-amber-50 text-amber-700 border-amber-200" },
  NAME_MISMATCH:    { label: "Ad/içerik uyuşmuyor", cls: "bg-orange-50 text-orange-700 border-orange-200" },
  NOT_DEPLOYED:     { label: "Paket Nginx'te yok",  cls: "bg-red-50 text-red-700 border-red-200" },
  BROKEN_INCLUDE:   { label: "Kırık include",       cls: "bg-red-100 text-red-800 border-red-300" },
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

export default function NginxLocations() {
  const [service, setService] = useState("");
  const [env, setEnv] = useState("");
  const [status, setStatus] = useState("");
  const [q, setQ] = useState("");
  const [data, setData] = useState<NginxLocationsResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  const load = useCallback(async (p: { service: string; env: string; status: string; q: string }) => {
    setLoading(true);
    try {
      const r = await denetimApi.nginxLocations(p);
      if (r.ok) { setData(r); setErr(""); } else setErr(r.message || "Veri alınamadı.");
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally { setLoading(false); }
  }, []);

  // Arama sunucu tarafinda; yazarken her tusa istek atmamak icin kisa gecikme.
  useEffect(() => {
    const t = setTimeout(() => load({ service, env, status, q }), 300);
    return () => clearTimeout(t);
  }, [service, env, status, q, load]);

  if (loading && !data) return <div className="py-10 text-center text-sm text-gray-400">Yükleniyor…</div>;
  if (err) return <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-xl px-3 py-2">{err}</div>;
  if (!data) return null;

  if (!data.scanDate) {
    return (
      <div className="text-sm text-gray-500 bg-gray-50 border border-gray-100 rounded-xl px-4 py-6 text-center">
        Henüz bir tarama kaydı yok. <code className="font-mono">nginx_config_audit</code> job'ı
        çalıştıktan sonra burası dolacak.
      </div>
    );
  }

  const sorunlu = data.statusCounts
    .filter((s) => s.status !== "OK" && s.status !== "MULTI_PATH")
    .reduce((a, s) => a + s.count, 0);
  const pathUyumsuz = data.rows.filter((r) => !r.pathMatchesApp).length;

  return (
    <div className="space-y-3">
      {/* Servis sekmeleri: kullanici "her servis icin AYRI ekran" istedi. */}
      <div className="flex flex-wrap gap-1">
        {["", ...data.services].map((s) => (
          <button
            key={s || "hepsi"}
            onClick={() => setService(s)}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
              service === s
                ? "bg-[var(--accent)]/10 border-[var(--accent)]/30 text-[var(--accent)]"
                : "bg-white border-gray-200 text-gray-600 hover:bg-gray-50"
            }`}
          >
            {s || "Tüm servisler"}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Select sizeVariant="sm" value={env} onChange={(e) => setEnv(e.target.value)}>
          <option value="">Tüm ortamlar</option>
          {data.envs.map((e) => <option key={e} value={e}>{e}</option>)}
        </Select>
        <Select sizeVariant="sm" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">Tüm durumlar</option>
          {data.statusCounts.map((s) => (
            <option key={s.status} value={s.status}>
              {(STATUS_TR[s.status]?.label || s.status)} ({s.count})
            </option>
          ))}
        </Select>
        <div className="relative">
          <MagnifyingGlassIcon className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            value={q} onChange={(e) => setQ(e.target.value)} placeholder="path, uygulama, namespace ara"
            className="pl-8 pr-2.5 py-1.5 text-xs border border-gray-200 rounded-lg w-64"
          />
        </div>
        <span className="text-xs text-gray-400 tabular-nums">{nf(data.total)} location</span>
        <span className="text-xs text-gray-400">· tarama {data.scanDate}</span>
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={() => csvDownload(`nginx_location_${service || "tum"}`,
              ["servis", "ortam", "path", "namespace", "uygulama", "include_dosyasi",
               "dagitim", "durum", "path_uygulama_uyumu", "vhost", "sunucular"],
              data.rows.map((r) => [r.service, r.env, r.locationPath, r.namespace, r.application,
                r.includeName, r.deployMode, STATUS_TR[r.status]?.label || r.status,
                r.pathMatchesApp ? "uyumlu" : "UYUMSUZ", r.vhosts.join(" "), r.hosts.join(" ")]))}
            className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg hover:bg-gray-50"
          >
            <ArrowDownTrayIcon className="w-3.5 h-3.5" /> CSV
          </button>
          <button onClick={() => load({ service, env, status, q })} className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg hover:bg-gray-50">
            <ArrowPathIcon className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} /> Yenile
          </button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat n={data.total} l="location tanımı" />
        <Stat n={data.total - sorunlu} l="sorunsuz" tone="ok" />
        <Stat n={sorunlu} l="müdahale gerektiren" tone={sorunlu ? "warn" : undefined} />
        <Stat n={pathUyumsuz} l="path ≠ uygulama adı" tone={pathUyumsuz ? "warn" : undefined} />
      </div>

      <p className="text-[11px] text-gray-500 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
        Her satır bir <code className="px-1 rounded bg-white">location</code> bloğudur.
        <b> Bloğun ham içeriği taranmıyor</b> — <code className="px-1 rounded bg-white">nginx_config_scan.sh</code>{" "}
        yalnızca <code className="px-1 rounded bg-white">location …&#123; include … &#125;</code>{" "}
        çiftini kaydeder. Burada path, include edilen dosya adı ve çözülen namespace/uygulama
        gösterilir; bloğun tam metni için tarama script’inin genişletilmesi gerekir.
        {" "}“path ≠ uygulama adı”, location yolunun servis edilen uygulamanın adını
        içermediğini söyler — kopyala-yapıştır hatalarının tipik izidir, tek başına hata
        anlamına gelmez.
      </p>

      <div className="overflow-x-auto rounded-xl border border-gray-100">
        <table className="w-full min-w-max text-sm">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-100 text-left">
              <th className="px-3 py-2 text-xs font-semibold text-gray-500">Path</th>
              <th className="px-3 py-2 text-xs font-semibold text-gray-500">Namespace</th>
              <th className="px-3 py-2 text-xs font-semibold text-gray-500">Uygulama</th>
              {!service && <th className="px-3 py-2 text-xs font-semibold text-gray-500">Servis</th>}
              {!env && <th className="px-3 py-2 text-xs font-semibold text-gray-500">Ortam</th>}
              <th className="px-3 py-2 text-xs font-semibold text-gray-500">include dosyası</th>
              <th className="px-3 py-2 text-xs font-semibold text-gray-500">Dağıtım</th>
              <th className="px-3 py-2 text-xs font-semibold text-gray-500">Durum</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {data.rows.length === 0 && (
              <tr><td colSpan={8} className="px-3 py-8 text-center text-sm text-gray-400">Kayıt bulunamadı.</td></tr>
            )}
            {data.rows.map((r, i) => {
              const meta = STATUS_TR[r.status] || { label: r.status, cls: "bg-gray-100 text-gray-600 border-gray-200" };
              return (
                <tr key={i} className="hover:bg-gray-50/60 align-top">
                  <td className="px-3 py-2 font-mono text-xs text-gray-800 whitespace-nowrap">
                    {r.locationPath || <span className="text-gray-300">—</span>}
                    {!r.pathMatchesApp && r.application && (
                      <span
                        className="ml-1.5 text-[10px] px-1 py-0.5 rounded border bg-amber-50 text-amber-700 border-amber-200"
                        title="Location yolu uygulama adını içermiyor"
                      >
                        ≠
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs text-gray-600 whitespace-nowrap">
                    {r.namespace || <span className="text-gray-300">—</span>}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs text-gray-800 whitespace-nowrap">
                    {r.application || <span className="text-gray-300">—</span>}
                    {!r.inOcpInventory && (
                      <span className="ml-1.5 text-[10px] text-amber-600" title="OpenShift envanterinde bulunamadı">OCP✗</span>
                    )}
                  </td>
                  {!service && <td className="px-3 py-2 text-xs text-gray-600">{r.service}</td>}
                  {!env && <td className="px-3 py-2 text-xs text-gray-600">{r.env}</td>}
                  <td
                    className="px-3 py-2 font-mono text-[11px] text-gray-500 max-w-[22rem] truncate"
                    title={`${r.includeName}.conf\nvhost: ${r.vhosts.join(", ")}\nSunucular: ${r.hosts.join(", ")}`}
                  >
                    {r.includeName}
                    {!r.includeExists && (
                      <span className="ml-1.5 text-[10px] text-red-600">(dosya yok)</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-xs">
                    <span className={`text-[10px] px-1.5 py-0.5 rounded border ${
                      r.deployMode === "namespaced" ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                        : r.deployMode === "flat" ? "bg-amber-50 text-amber-700 border-amber-200"
                        : "bg-red-50 text-red-700 border-red-200"
                    }`}>
                      {r.deployMode === "namespaced" ? "namespaced"
                        : r.deployMode === "flat" ? "flat (eski)" : "yok"}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <span className={`text-[10px] px-1.5 py-0.5 rounded border whitespace-nowrap ${meta.cls}`}>
                      {meta.label}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {data.capped && (
        <p className="text-xs text-gray-400">
          İlk {nf(data.shown)} satır gösteriliyor — servis/ortam seçerek daraltın ya da CSV
          indirin. Üstteki sayılar <b>filtrelenmiş tüm</b> satırlar üzerinden hesaplanır.
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
