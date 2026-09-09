// src/components/denetim/NginxApiEnvanteri.tsx — "Nginx API Envanteri" sekmesi.
//
// Kaynak: dbo.NginxRateLimitInventory (nginx_ratelimit_inventory job'ı doldurur).
// Bir satır = (sunucu, konfigürasyon dosyası, API location) + o günkü rate limit zone'ları.
//
// Bu sekmenin ZOR sorusu sayı saymak değil, FARKI bulmak: konfigürasyon dosya adları
// ortamdan bağımsız olarak AYNIDIR (aynı "x.conf" hem DEV hem PROD sunucusunda bulunur),
// dolayısıyla "aynı conf her yerde aynı mı?" ancak ortam ve sunucu kırılımları
// karşılaştırılarak cevaplanır. İki tür sürüklenme ayrı ayrı işaretlenir:
//   · sunucular arası — aynı ortamdaki sunucular birbirinden farklı
//   · ortamlar arası  — ortamların beklenen API sayısı birbirinden farklı
//
// Ortam bilgisi TABLODA YOKTUR; sunucu adından türetilir (server/audit/nginx-hosts.cjs).
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowDownTrayIcon,
  ArrowPathIcon,
  MagnifyingGlassIcon,
  ServerStackIcon,
  DocumentTextIcon,
  Squares2X2Icon,
  ShieldExclamationIcon,
} from "@heroicons/react/24/outline";
import { denetimApi, type NginxApiResult, type NginxApiConfigRow } from "@/api/denetimApi";
import { Panel, StatTile, Pill, TableShell, Th, Td, Code, Note } from "./ui";
import { NginxInternetExpose } from "./NginxInternetExpose";
import { NginxApiLocations } from "./NginxApiLocations";

const nf = (n: number) => new Intl.NumberFormat("tr-TR").format(n);

function csvDownload(name: string, header: string[], rows: (string | number)[][]) {
  const esc = (v: string | number) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const csv = [header, ...rows].map((r) => r.map(esc).join(";")).join("\r\n");
  const url = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `${name}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

type View = "ortam" | "sunucu" | "konfig" | "apibazli" | "internet";

export function NginxApiEnvanteri() {
  const [data, setData] = useState<NginxApiResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [view, setView] = useState<View>("ortam");
  const [q, setQ] = useState("");
  const [onlyProblem, setOnlyProblem] = useState(false);
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(async (d?: string) => {
    setLoading(true);
    try {
      const r = await denetimApi.nginxApi(d);
      if (r.ok) {
        setData(r);
        setErr("");
      } else setErr(r.message || "Veri alınamadı.");
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const configRows = useMemo(() => {
    if (!data) return [];
    const needle = q.trim().toLowerCase();
    return data.byConfig.filter((c) => {
      if (needle && !c.config.toLowerCase().includes(needle)) return false;
      if (onlyProblem && !(c.hostInconsistent || c.envInconsistent || c.missingEnvs.length > 0 || c.noLimitEverywhere))
        return false;
      return true;
    });
  }, [data, q, onlyProblem]);

  if (loading && !data)
    return <div className="py-10 text-center text-sm text-[var(--text-muted)]">Yükleniyor…</div>;
  if (err)
    return <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-xl px-3 py-2">{err}</div>;
  if (!data) return null;

  if (!data.scanDate) {
    return (
      <Note tone="info" title="Henüz tarama kaydı yok">
        <code className="font-mono">nginx_ratelimit_inventory</code> job&apos;ı çalıştıktan sonra
        burası dolacak.
      </Note>
    );
  }

  const envs = data.envs;
  const t = data.totals;

  const viewTabs = (
    <div className="flex gap-1 rounded-lg p-0.5 bg-[var(--bg-elevated)] w-fit">
      {(
        [
          { id: "ortam", label: "Ortama Göre" },
          { id: "sunucu", label: "Sunucuya Göre" },
          { id: "konfig", label: "Konfigürasyon Karşılaştırma" },
          // Konfigurasyon gorunumu "dosya her yerde ayni mi" sorusunu cevapliyor;
          // bu gorunum "SU API nerede var" sorusunu - farkli soru, ayri gorunum.
          { id: "apibazli", label: "API Bazlı" },
          // Denetim'in geri kalanı SALT OKUNUR; bu görünüm EYLEM içeriyor (bir API'yi
          // internete açar). Ayrı bir sekme olarak durması, kazayla tıklanma ihtimalini
          // azaltır ve okuma ile yazmayı görsel olarak ayırır.
          { id: "internet", label: "İnternete Açma" },
        ] as const
      ).map((v) => (
        <button
          key={v.id}
          onClick={() => setView(v.id)}
          className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
            view === v.id
              ? "bg-[var(--bg-surface)] shadow-sm text-[var(--text-primary)]"
              : "text-[var(--text-muted)] hover:text-[var(--text-primary)]"
          }`}
        >
          {v.label}
        </button>
      ))}
    </div>
  );

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <StatTile icon={ServerStackIcon} label="sunucu" value={nf(t.hosts)} />
        <StatTile icon={DocumentTextIcon} label="konfigürasyon" value={nf(t.configs)} />
        <StatTile icon={Squares2X2Icon} label="API (location) bloğu" value={nf(t.locations)} tone="accent" />
        <StatTile
          icon={ShieldExclamationIcon}
          label="rate limit'siz konfig."
          value={nf(t.configsWithoutLimit)}
          tone={t.configsWithoutLimit ? "warning" : "neutral"}
          hint="Hiçbir location'ında ne IP ne de sunucu bazlı limit tanımlı olmayan konfigürasyonlar"
        />
        <StatTile
          label="tutarsız konfig."
          value={nf(t.inconsistentConfigs)}
          tone={t.inconsistentConfigs ? "warning" : "neutral"}
          hint="Ortamlar veya aynı ortamdaki sunucular arasında API sayısı farklı olanlar"
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {viewTabs}
        <span className="text-xs text-[var(--text-muted)]">
          tarama <span className="tabular-nums">{data.scanDate}</span>
        </span>
        <button
          onClick={() => load()}
          className="ml-auto flex items-center gap-1.5 px-2.5 py-1.5 text-xs border border-[var(--border)] rounded-lg hover:bg-[var(--bg-elevated)]"
        >
          <ArrowPathIcon className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} /> Yenile
        </button>
      </div>

      {view === "apibazli" && <NginxApiLocations />}

      {view === "internet" && <NginxInternetExpose />}

      {view === "ortam" && (
        <Panel
          title="Ortama göre"
          description="Her ortamda kaç konfigürasyonda toplam kaç API (location) bloğu tanımlı."
          actions={
            <button
              onClick={() =>
                csvDownload(
                  "nginx_api_ortam",
                  ["ortam", "sunucu", "konfigurasyon", "api_blogu", "limitsiz_location", "limitsiz_konfig"],
                  data.byEnv.map((r) => [
                    r.env, r.hosts, r.configs, r.locations, r.noLimitLocations, r.configsWithoutLimit,
                  ]),
                )
              }
              className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs border border-[var(--border)] rounded-lg hover:bg-[var(--bg-elevated)]"
            >
              <ArrowDownTrayIcon className="w-3.5 h-3.5" /> CSV
            </button>
          }
          dense
        >
          <TableShell>
            <thead>
              <tr>
                <Th>Ortam</Th>
                <Th align="right">Sunucu</Th>
                <Th align="right">Konfigürasyon</Th>
                <Th align="right">API bloğu</Th>
                <Th align="right">Limitsiz location</Th>
                <Th align="right">Limitsiz konfig.</Th>
              </tr>
            </thead>
            <tbody>
              {data.byEnv.map((r) => (
                <tr key={r.env}>
                  <Td>
                    <span className="font-semibold">{r.env}</span>
                  </Td>
                  <Td align="right" className="tabular-nums">{nf(r.hosts)}</Td>
                  <Td align="right" className="tabular-nums">{nf(r.configs)}</Td>
                  <Td align="right" className="tabular-nums font-semibold">{nf(r.locations)}</Td>
                  <Td align="right" className="tabular-nums">{nf(r.noLimitLocations)}</Td>
                  <Td align="right" className="tabular-nums">
                    {r.configsWithoutLimit > 0 ? (
                      <Pill tone="warning">{nf(r.configsWithoutLimit)}</Pill>
                    ) : (
                      <span className="text-[var(--text-muted)]">0</span>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </TableShell>
        </Panel>
      )}

      {view === "sunucu" && (
        <Panel
          title="Sunucuya göre"
          description="Her sunucuda kaç konfigürasyonda toplam kaç API (location) bloğu tanımlı. Aynı ortamdaki sunucuların birbirine eşit olması beklenir."
          actions={
            <button
              onClick={() =>
                csvDownload(
                  "nginx_api_sunucu",
                  ["sunucu", "ortam", "lokasyon", "konfigurasyon", "api_blogu", "limitsiz_location"],
                  data.byHost.map((r) => [
                    r.host, r.env, r.site, r.configs, r.locations, r.noLimitLocations,
                  ]),
                )
              }
              className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs border border-[var(--border)] rounded-lg hover:bg-[var(--bg-elevated)]"
            >
              <ArrowDownTrayIcon className="w-3.5 h-3.5" /> CSV
            </button>
          }
          dense
        >
          <TableShell maxHeight="34rem">
            <thead>
              <tr>
                <Th>Sunucu</Th>
                <Th>Ortam</Th>
                <Th>Lokasyon</Th>
                <Th align="right">Konfigürasyon</Th>
                <Th align="right">API bloğu</Th>
                <Th align="right">Limitsiz location</Th>
              </tr>
            </thead>
            <tbody>
              {data.byHost.map((r) => (
                <tr key={r.host}>
                  <Td className="font-mono">{r.host}</Td>
                  <Td>{r.env}</Td>
                  <Td className="text-[var(--text-muted)]">{r.site || "—"}</Td>
                  <Td align="right" className="tabular-nums">{nf(r.configs)}</Td>
                  <Td align="right" className="tabular-nums font-semibold">{nf(r.locations)}</Td>
                  <Td align="right" className="tabular-nums">{nf(r.noLimitLocations)}</Td>
                </tr>
              ))}
            </tbody>
          </TableShell>
        </Panel>
      )}

      {view === "konfig" && (
        <>
          <Note tone="info" title="Bu tablo nasıl okunur?">
            Konfigürasyon dosya adları ortamdan bağımsız olarak <b>aynıdır</b>, bu yüzden her
            satır tek bir dosyanın <b>tüm ortamlardaki</b> hâlini gösterir. Hücredeki sayı o
            ortamdaki API (location) bloğu sayısıdır; <Code>—</Code> o ortamda dosyanın{" "}
            <b>hiç bulunmadığı</b> anlamına gelir. Bir satıra tıklayınca sunucu kırılımı açılır.
            <div className="mt-1.5 flex flex-wrap gap-2">
              <Pill tone="warning">ortam farkı</Pill>
              <span>ortamların API sayısı birbirinden farklı ·</span>
              <Pill tone="danger">sunucu farkı</Pill>
              <span>aynı ortamdaki sunucular birbirinden farklı</span>
            </div>
          </Note>

          <Panel
            title="Konfigürasyon karşılaştırma"
            description={`${nf(configRows.length)} konfigürasyon gösteriliyor.`}
            actions={
              <div className="flex items-center gap-2">
                <div className="relative">
                  <MagnifyingGlassIcon className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
                  <input
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    placeholder="konfigürasyon ara"
                    className="pl-8 pr-2.5 py-1.5 text-xs border border-[var(--border)] rounded-lg w-52"
                  />
                </div>
                <label className="flex items-center gap-1.5 text-xs text-[var(--text-secondary)] cursor-pointer whitespace-nowrap">
                  <input
                    type="checkbox"
                    checked={onlyProblem}
                    onChange={(e) => setOnlyProblem(e.target.checked)}
                  />
                  Sadece sorunlular
                </label>
                <button
                  onClick={() =>
                    csvDownload(
                      "nginx_api_konfigurasyon",
                      ["konfigurasyon", ...envs, "eksik_ortam", "ortam_farki", "sunucu_farki", "limitsiz"],
                      configRows.map((c) => [
                        c.config,
                        ...envs.map((e) => (c.envs[e] ? c.envs[e].maxLoc : "")),
                        c.missingEnvs.join(" "),
                        c.envInconsistent ? "EVET" : "",
                        c.hostInconsistent ? "EVET" : "",
                        c.noLimitEverywhere ? "EVET" : "",
                      ]),
                    )
                  }
                  className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs border border-[var(--border)] rounded-lg hover:bg-[var(--bg-elevated)]"
                >
                  <ArrowDownTrayIcon className="w-3.5 h-3.5" /> CSV
                </button>
              </div>
            }
            dense
          >
            <TableShell maxHeight="34rem">
              <thead>
                <tr>
                  <Th>Konfigürasyon</Th>
                  {envs.map((e) => (
                    <Th key={e} align="right">{e}</Th>
                  ))}
                  <Th>Bulgu</Th>
                </tr>
              </thead>
              <tbody>
                {configRows.map((c) => (
                  <ConfigRow
                    key={c.config}
                    row={c}
                    envs={envs}
                    open={open === c.config}
                    onToggle={() => setOpen(open === c.config ? null : c.config)}
                  />
                ))}
              </tbody>
            </TableShell>
          </Panel>
        </>
      )}

      {data.noLimitConfigs.length > 0 && (
        <Panel
          title="Rate limit tanımı olmayan konfigürasyonlar"
          description="Bu dosyaların hiçbir location'ında ne IP bazlı ne de sunucu bazlı limit tanımlı."
          dense
        >
          <div className="p-4 flex flex-wrap gap-2">
            {data.noLimitConfigs.map((c) => (
              <Pill key={c} tone="warning">{c}</Pill>
            ))}
          </div>
        </Panel>
      )}
    </div>
  );
}

/** Bir konfigürasyonun ortam satırı + açılınca sunucu kırılımı. */
function ConfigRow({
  row,
  envs,
  open,
  onToggle,
}: {
  row: NginxApiConfigRow;
  envs: string[];
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <>
      <tr
        className="cursor-pointer hover:bg-[var(--bg-elevated)]/60"
        onClick={onToggle}
      >
        <Td className="font-mono whitespace-nowrap" title={row.config}>
          {row.config}
        </Td>
        {envs.map((e) => {
          const cell = row.envs[e];
          if (!cell)
            return (
              <Td key={e} align="right" className="text-[var(--text-muted)]" title="bu ortamda yok">
                —
              </Td>
            );
          // min != max ise aynı ortamın sunucuları arasında fark var: aralık gösterilir,
          // tek bir sayı göstermek farkı GİZLERDİ.
          const drift = cell.minLoc !== cell.maxLoc;
          return (
            <Td
              key={e}
              align="right"
              className={`tabular-nums ${drift ? "font-semibold text-[var(--status-danger)]" : ""}`}
              title={`${cell.hosts} sunucu · toplam ${cell.locations} location`}
            >
              {drift ? `${cell.minLoc}–${cell.maxLoc}` : cell.maxLoc}
            </Td>
          );
        })}
        <Td>
          <span className="flex flex-wrap gap-1">
            {row.missingEnvs.length > 0 && (
              <Pill tone="info">eksik: {row.missingEnvs.join(", ")}</Pill>
            )}
            {row.envInconsistent && <Pill tone="warning">ortam farkı</Pill>}
            {row.hostInconsistent && <Pill tone="danger">sunucu farkı</Pill>}
            {row.noLimitEverywhere && <Pill tone="warning">limitsiz</Pill>}
          </span>
        </Td>
      </tr>
      {open && (
        <tr>
          <td colSpan={envs.length + 2} className="p-0">
            <div className="px-4 py-3 bg-[var(--bg-elevated)]/50 border-t border-[var(--border-subtle)]">
              <div className="text-[11px] font-semibold text-[var(--text-secondary)] mb-1.5">
                Sunucu kırılımı — {row.config}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {row.hosts.map((h) => (
                  <span
                    key={h.host}
                    className="text-[11px] px-2 py-1 rounded-lg border font-mono"
                    style={{
                      borderColor: "var(--border-subtle)",
                      background: "var(--bg-surface)",
                      color: "var(--text-secondary)",
                    }}
                    title={`${h.env}${h.site ? " · " + h.site : ""} · ${h.noLimit} limitsiz location`}
                  >
                    {h.host}
                    <span className="ml-1.5 tabular-nums font-semibold text-[var(--text-primary)]">
                      {h.locations}
                    </span>
                  </span>
                ))}
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
