// src/components/denetim/NginxEnvanteri.tsx — Denetim > "Nginx Envanteri".
//
// Kaynak: dbo.nginx_inventory (bmw_nginx/nginx_metadata job'ı doldurur). Her sunucuda
// bir .metadata dosyası üretilip toplanıyor.
//
// Tablo her koşuda TRUNCATE edilip yeniden yazılıyor — yani GEÇMİŞ YOK, tablo her zaman
// "şu anki hâl". Bu yüzden burada tarih seçici yok; tazelik göstergesi olarak en yeni
// `source_last_update` gösteriliyor.
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowDownTrayIcon,
  ArrowPathIcon,
  MagnifyingGlassIcon,
  ServerStackIcon,
  CpuChipIcon,
  CircleStackIcon,
  Squares2X2Icon,
} from "@heroicons/react/24/outline";
import {
  denetimApi,
  type NginxInventoryResult,
  type NginxInvDist,
} from "@/api/denetimApi";
import { Panel, StatTile, Pill, TableShell, Th, Td, Note } from "./ui";

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

/** Bir alanın değer dağılımı — oransal bar + sayı. */
function DistBars({ title, items, total }: { title: string; items: NginxInvDist[]; total: number }) {
  const max = Math.max(1, ...items.map((i) => i.count));
  return (
    <div>
      <div className="text-[11px] font-semibold uppercase tracking-wide mb-1.5" style={{ color: "var(--text-muted)" }}>
        {title}
      </div>
      <div className="space-y-1">
        {items.slice(0, 12).map((i) => (
          <div key={i.value} className="flex items-center gap-2">
            <span
              className="w-40 shrink-0 truncate text-[11px] font-mono"
              style={{ color: "var(--text-primary)" }}
              title={i.value}
            >
              {i.value}
            </span>
            <span className="flex-1 h-3.5 rounded overflow-hidden" style={{ background: "var(--bg-elevated)" }}>
              <span
                className="block h-full"
                style={{ width: `${(i.count / max) * 100}%`, background: "var(--accent)", opacity: 0.7 }}
              />
            </span>
            <span
              className="w-16 shrink-0 text-right text-[11px] tabular-nums"
              style={{ color: "var(--text-secondary)" }}
            >
              {nf(i.count)}
              <span style={{ color: "var(--text-muted)" }}>
                {" "}
                %{total ? Math.round((i.count / total) * 100) : 0}
              </span>
            </span>
          </div>
        ))}
        {items.length > 12 && (
          <div className="text-[10px]" style={{ color: "var(--text-muted)" }}>
            +{items.length - 12} değer daha
          </div>
        )}
      </div>
    </div>
  );
}

type View = "ortam" | "versiyon" | "service" | "kaynak" | "sunucular";

export function NginxEnvanteri() {
  const [data, setData] = useState<NginxInventoryResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [view, setView] = useState<View>("ortam");
  const [q, setQ] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await denetimApi.nginxInventory();
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

  const hostRows = useMemo(() => {
    if (!data) return [];
    const needle = q.trim().toLowerCase();
    if (!needle) return data.hosts;
    return data.hosts.filter((h) =>
      `${h.hostname} ${h.fqdn || ""} ${h.env} ${h.location || ""} ${h.services || ""} ${h.ip || ""}`
        .toLowerCase()
        .includes(needle),
    );
  }, [data, q]);

  if (loading && !data)
    return <div className="py-10 text-center text-sm text-[var(--text-muted)]">Yükleniyor…</div>;
  if (err)
    return <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-xl px-3 py-2">{err}</div>;
  if (!data) return null;

  if (data.totals.hosts === 0) {
    return (
      <Note tone="info" title="Henüz kayıt yok">
        <code className="font-mono">nginx_metadata</code> job&apos;ı çalıştıktan sonra burası
        dolacak.
      </Note>
    );
  }

  const t = data.totals;
  const n = t.hosts;

  const viewTabs = (
    <div className="flex gap-1 rounded-lg p-0.5 bg-[var(--bg-elevated)] w-fit">
      {(
        [
          { id: "ortam", label: "Ortam" },
          { id: "versiyon", label: "Versiyonlar" },
          { id: "service", label: "Service'ler" },
          { id: "kaynak", label: "Kaynaklar" },
          { id: "sunucular", label: "Sunucular" },
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
        <StatTile icon={ServerStackIcon} label="nginx sunucusu" value={nf(t.hosts)} tone="accent" />
        <StatTile icon={Squares2X2Icon} label="service" value={nf(t.services)} />
        <StatTile label="farklı nginx sürümü" value={nf(t.nginxVersions)} hint="Sürüm dağılımı için Versiyonlar sekmesi" />
        <StatTile icon={CpuChipIcon} label="toplam çekirdek" value={nf(t.cpuTotal)} />
        <StatTile
          icon={CircleStackIcon}
          label="toplam bellek"
          value={`${nf(t.memory.totalGiB)} GiB`}
          hint={
            t.memory.unparsed
              ? `${t.memory.unparsed} sunucunun bellek değeri çözümlenemedi, toplama dahil değil`
              : undefined
          }
          tone={t.memory.unparsed ? "warning" : "neutral"}
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {viewTabs}
        {data.lastUpdate && (
          <span className="text-xs text-[var(--text-muted)]">
            son güncelleme <span className="tabular-nums">{data.lastUpdate.slice(0, 19).replace("T", " ")}</span>
          </span>
        )}
        <button
          onClick={load}
          className="ml-auto flex items-center gap-1.5 px-2.5 py-1.5 text-xs border border-[var(--border)] rounded-lg hover:bg-[var(--bg-elevated)]"
        >
          <ArrowPathIcon className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} /> Yenile
        </button>
      </div>

      {view === "ortam" && (
        <Panel
          title="Ortam ve lokasyon"
          description="Hangi ortamda kaç nginx sunucusu var, bunlar hangi lokasyonlara dağılmış."
          dense
        >
          <TableShell>
            <thead>
              <tr>
                <Th>Ortam</Th>
                <Th align="right">Sunucu</Th>
                <Th>Lokasyon dağılımı</Th>
              </tr>
            </thead>
            <tbody>
              {data.byEnv.map((e) => (
                <tr key={e.env}>
                  <Td className="font-semibold">{e.env}</Td>
                  <Td align="right" className="tabular-nums">{nf(e.hosts)}</Td>
                  <Td>
                    <span className="flex flex-wrap gap-1.5">
                      {e.locations.map((l) => (
                        <Pill key={l.location} tone="info">
                          {l.location}: {nf(l.hosts)}
                        </Pill>
                      ))}
                    </span>
                  </Td>
                </tr>
              ))}
            </tbody>
          </TableShell>
        </Panel>
      )}

      {view === "versiyon" && (
        <Panel title="Versiyonlar" description="nginx, işletim sistemi, çekirdek ve mimari dağılımı." >
          <div className="grid gap-5 md:grid-cols-2">
            <DistBars title="nginx sürümü" items={data.versions.nginx} total={n} />
            <DistBars title="işletim sistemi" items={data.versions.os} total={n} />
            <DistBars title="çekirdek (kernel)" items={data.versions.kernel} total={n} />
            <DistBars title="mimari" items={data.versions.architecture} total={n} />
            <DistBars title="metadata sürümü" items={data.versions.metadata} total={n} />
            <DistBars title="nginx kullanıcısı" items={data.other.nginxUser} total={n} />
          </div>
        </Panel>
      )}

      {view === "service" && (
        <Panel
          title="Service'ler"
          description="Bir service birden çok sunucuda bulunabilir; sayı o service'i barındıran sunucu sayısıdır."
          actions={
            <button
              onClick={() =>
                csvDownload(
                  "nginx_envanter_service",
                  ["service", "sunucu", "ortamlar"],
                  data.byService.map((s) => [s.service, s.hosts, s.envs.join(" ")]),
                )
              }
              className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs border border-[var(--border)] rounded-lg hover:bg-[var(--bg-elevated)]"
            >
              <ArrowDownTrayIcon className="w-3.5 h-3.5" /> CSV
            </button>
          }
          dense
        >
          <TableShell maxHeight="30rem">
            <thead>
              <tr>
                <Th>Service</Th>
                <Th align="right">Sunucu</Th>
                <Th>Ortamlar</Th>
              </tr>
            </thead>
            <tbody>
              {data.byService.map((s) => (
                <tr key={s.service}>
                  <Td className="font-mono">{s.service}</Td>
                  <Td align="right" className="tabular-nums">{nf(s.hosts)}</Td>
                  <Td>
                    <span className="flex flex-wrap gap-1">
                      {s.envs.map((e) => (
                        <Pill key={e} tone="info">{e}</Pill>
                      ))}
                    </span>
                  </Td>
                </tr>
              ))}
            </tbody>
          </TableShell>
        </Panel>
      )}

      {view === "kaynak" && (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <StatTile
              label="/usr/nginx toplam"
              value={`${nf(t.diskNginx.totalGiB)} GiB`}
              tone={t.diskNginx.unparsed ? "warning" : "neutral"}
              hint={t.diskNginx.unparsed ? `${t.diskNginx.unparsed} sunucu çözümlenemedi` : undefined}
            />
            <StatTile
              label="/web_log toplam"
              value={`${nf(t.diskWebLog.totalGiB)} GiB`}
              tone={t.diskWebLog.unparsed ? "warning" : "neutral"}
              hint={t.diskWebLog.unparsed ? `${t.diskWebLog.unparsed} sunucu çözümlenemedi` : undefined}
            />
            <StatTile label="ortam sayısı" value={nf(t.envs)} />
          </div>
          <Panel title="Kaynak dağılımı" description="Değerler sunucudan toplandığı gibi gruplanır.">
            <div className="grid gap-5 md:grid-cols-2">
              <DistBars title="çekirdek (cpu)" items={data.resources.cpu} total={n} />
              <DistBars title="bellek" items={data.resources.memory} total={n} />
              <DistBars title="/usr/nginx disk" items={data.resources.diskNginx} total={n} />
              <DistBars title="/web_log disk" items={data.resources.diskWebLog} total={n} />
              <DistBars title="konfigürasyon sayısı" items={data.resources.configCount} total={n} />
              <DistBars title="service sayısı" items={data.resources.serviceCount} total={n} />
            </div>
          </Panel>
        </>
      )}

      {view === "sunucular" && (
        <Panel
          title="Sunucular"
          description={`${nf(hostRows.length)} sunucu gösteriliyor.`}
          actions={
            <div className="flex items-center gap-2">
              <div className="relative">
                <MagnifyingGlassIcon className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
                <input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="sunucu, ortam, service, IP ara"
                  className="pl-8 pr-2.5 py-1.5 text-xs border border-[var(--border)] rounded-lg w-60"
                />
              </div>
              <button
                onClick={() =>
                  csvDownload(
                    "nginx_envanteri",
                    ["hostname", "fqdn", "ortam", "lokasyon", "ip", "subnet", "os", "kernel",
                     "mimari", "cpu", "bellek", "nginx_surum", "nginx_kullanici", "konf_sayisi",
                     "service_sayisi", "services", "disk_usr_nginx", "disk_web_log"],
                    hostRows.map((h) => [
                      h.hostname, h.fqdn || "", h.env, h.location || "", h.ip || "", h.subnet || "",
                      h.os || "", h.kernel || "", h.architecture || "", String(h.cpu ?? ""),
                      h.memory || "", h.nginx_version || "", h.nginx_user || "",
                      String(h.config_count ?? ""), String(h.service_count ?? ""), h.services || "",
                      h.disk_usr_nginx || "", h.disk_web_log || "",
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
                <Th>Sunucu</Th>
                <Th>Ortam</Th>
                <Th>Lokasyon</Th>
                <Th>nginx</Th>
                <Th>OS</Th>
                <Th align="right">CPU</Th>
                <Th align="right">Bellek</Th>
                <Th align="right">Konf.</Th>
                <Th>Service&apos;ler</Th>
              </tr>
            </thead>
            <tbody>
              {hostRows.map((h) => (
                <tr key={h.hostname}>
                  <Td className="font-mono whitespace-nowrap" title={h.fqdn || h.hostname}>
                    {h.hostname}
                  </Td>
                  <Td className="whitespace-nowrap">{h.env}</Td>
                  <Td className="whitespace-nowrap" >{h.location || "—"}</Td>
                  <Td className="font-mono whitespace-nowrap">{h.nginx_version || "—"}</Td>
                  <Td className="whitespace-nowrap" title={h.kernel || ""}>{h.os || "—"}</Td>
                  <Td align="right" className="tabular-nums">{h.cpu ?? "—"}</Td>
                  <Td align="right" className="tabular-nums">{h.memory || "—"}</Td>
                  <Td align="right" className="tabular-nums">{h.config_count ?? "—"}</Td>
                  <Td className="text-[11px]" title={h.services || ""}>
                    {h.services || "—"}
                  </Td>
                </tr>
              ))}
            </tbody>
          </TableShell>
        </Panel>
      )}
    </div>
  );
}
