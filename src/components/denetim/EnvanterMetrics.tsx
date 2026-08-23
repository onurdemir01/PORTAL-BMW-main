// src/components/denetim/EnvanterMetrics.tsx — "Denetim > Envanter Metrikleri" (2026-08-23).
//
// Uc kaynak (Sunucular / JBoss uygulamalari / WAS uygulamalari) icin ayni sekil:
//   1) Ozet sayaclar
//   2) Urun kapsami (yalniz Sunucular) - hangi urunden kac sunucuda var, kac ayri surumle
//   3) Boyut dagilimlari - yatay bar, tek bakista oransal karsilastirma
//   4) Capraz tablo - "hangi surum hangi domain/subnet'te" sorusunun cevabi, isi haritasi
//
// Grafikler CSS ile cizilir; projede grafik kutuphanesi YOK ve tek bir dagilim gorseli
// icin bagimlilik eklemek paket boyutuna deger bir kazanc saglamiyor.
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowPathIcon, ArrowDownTrayIcon, MagnifyingGlassIcon, TableCellsIcon,
} from "@heroicons/react/24/outline";
import {
  denetimApi, type EnvanterSummary, type EnvanterPivot,
} from "@/api/denetimApi";
import { Select } from "@/components/ui/Form";

// Sunucu tarafiyla AYNI ayirici (bkz. envanter-metrics.cjs). Bosluk kullanilsaydi
// "a b"+"c" ile "a"+"b c" ayni anahtari uretirdi.
const SEP = "\u0001";

// Sunucu tarafinin bos/NULL degerler icin kullandigi etiketle AYNI olmak ZORUNDA
// (bkz. envanter-metrics.cjs -> NORM). Ayrisirsa filtre sessizce calismaz.
const EMPTY_LABEL = "(boş)";

const nf = (n: number) => n.toLocaleString("tr-TR");

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

export default function EnvanterMetrics() {
  const [source, setSource] = useState("hosts");
  const [sum, setSum] = useState<EnvanterSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  const load = useCallback(async (src: string) => {
    setLoading(true);
    try {
      const r = await denetimApi.envanterSummary(src);
      if (r.ok) { setSum(r); setErr(""); }
      else setErr(r.message || "Veri alınamadı.");
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(source); }, [source, load]);

  if (loading && !sum) return <div className="py-10 text-center text-sm text-gray-400">Yükleniyor…</div>;
  if (err) return <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-xl px-3 py-2">{err}</div>;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Select sizeVariant="sm" value={source} onChange={(e) => setSource(e.target.value)}>
          <option value="hosts">Sunucular · dbo.Inventory</option>
          <option value="mw">JBoss uygulamaları · dbo.MWAppsInventory</option>
          <option value="was">WAS uygulamaları · dbo.WASAppsInventory</option>
        </Select>
        <button
          onClick={() => load(source)}
          className="ml-auto flex items-center gap-1.5 px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg hover:bg-gray-50"
        >
          <ArrowPathIcon className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} /> Yenile
        </button>
      </div>

      {sum && <Totals sum={sum} />}
      {sum && sum.products.length > 0 && <ProductCoverage sum={sum} />}
      {sum && <Distributions sum={sum} />}
      {sum && <Pivot source={source} sum={sum} />}
    </div>
  );
}

// ── Ozet sayaclar ─────────────────────────────────────────────────────────────────────
function Totals({ sum }: { sum: EnvanterSummary }) {
  const cards: { n: number; l: string }[] = [];
  if (sum.source === "hosts") {
    cards.push({ n: sum.totals.rows, l: "sunucu" });
  } else {
    cards.push({ n: sum.totals.rows, l: "uygulama kaydı" });
    cards.push({ n: sum.totals.apps, l: "farklı uygulama" });
    cards.push({ n: sum.totals.hosts, l: "sunucu" });
  }
  const domains = sum.distributions.domain?.length ?? 0;
  if (domains) cards.push({ n: domains, l: "domain" });
  const subnets = sum.distributions.subnet?.length ?? 0;
  if (subnets) cards.push({ n: subnets, l: "subnet" });
  for (const x of sum.totals.numerics) if (x.value) cards.push({ n: x.value, l: x.label });

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {cards.map((c) => (
        <div key={c.l} className="rounded-xl border border-gray-100 bg-white px-4 py-3">
          <div className="text-2xl font-bold tabular-nums text-gray-900">{nf(c.n)}</div>
          <div className="text-xs text-gray-500 mt-0.5">{c.l}</div>
        </div>
      ))}
    </div>
  );
}

// ── Urun kapsami (yalniz Sunucular) ───────────────────────────────────────────────────
// Bir urunun "kurulu oldugu sunucu sayisi" = surum alani DOLU olan satirlar. Surumler
// acilir liste halinde altta; en yaygin surum ustte.
function ProductCoverage({ sum }: { sum: EnvanterSummary }) {
  const [open, setOpen] = useState<string | null>(null);
  const max = Math.max(1, ...sum.products.map((p) => p.installed));

  return (
    <Section
      title="Ürün kapsamı"
      note="Sürüm alanı dolu olan sunucular sayılır. Bir ürünün sürüm alanı boşsa o sunucuda kurulu değildir."
      right={
        <ExportBtn
          onClick={() => csvDownload("urun_kapsami",
            ["urun", "kurulu_sunucu", "farkli_surum"],
            sum.products.map((p) => [p.label, p.installed, p.versionCount]))}
        />
      }
    >
      <div className="space-y-1.5">
        {sum.products.map((p) => (
          <div key={p.key} className="rounded-lg border border-gray-100 bg-white">
            <button
              onClick={() => setOpen(open === p.key ? null : p.key)}
              className="w-full flex items-center gap-3 px-3 py-2 hover:bg-gray-50/70 text-left"
            >
              <span className="w-20 shrink-0 text-xs font-semibold text-gray-700">{p.label}</span>
              <span className="flex-1 h-4 rounded bg-gray-100 overflow-hidden">
                <span
                  className="block h-full rounded bg-[var(--accent)]/70"
                  style={{ width: `${(p.installed / max) * 100}%` }}
                />
              </span>
              <span className="w-16 shrink-0 text-right text-xs tabular-nums font-semibold text-gray-800">
                {nf(p.installed)}
              </span>
              <span className="w-24 shrink-0 text-right text-[11px] tabular-nums text-gray-400">
                {p.versionCount} sürüm
              </span>
            </button>
            {open === p.key && (
              <div className="px-3 pb-2.5 pt-0.5 border-t border-gray-50">
                <BarList
                  rows={p.versions.map((v) => ({ value: v.value, count: v.hosts }))}
                  unit="sunucu"
                  limit={30}
                />
              </div>
            )}
          </div>
        ))}
      </div>
    </Section>
  );
}

// ── Boyut dagilimlari ─────────────────────────────────────────────────────────────────
function Distributions({ sum }: { sum: EnvanterSummary }) {
  const [dim, setDim] = useState(sum.dims[0]?.key || "env");
  const [q, setQ] = useState("");

  // Kaynak degisince onceki boyut anahtari gecersiz kalabilir.
  useEffect(() => {
    if (!sum.dims.some((d) => d.key === dim)) setDim(sum.dims[0]?.key || "");
  }, [sum, dim]);

  // "(bos)" satiri LISTEDEN cikarilir (kullanici talebi): urun surumu boyutlarinda bu
  // kova cogu zaman en buyuk satir olup gercek surum dagilimini gorunmez kiliyordu.
  // Sayisi tamamen atilmaz - listenin altinda tek satirlik not olarak durur, cunku
  // "kac sunucuda bu alan hic yok" gercek bir denetim bilgisi. Yuzdeler artik DOLU
  // degerler uzerinden hesaplanir, ki asil merak edilen oran budur.
  const emptyRow = useMemo(
    () => (sum.distributions[dim] || []).find((r) => r.value === EMPTY_LABEL) || null,
    [sum, dim],
  );

  const rows = useMemo(() => {
    const all = (sum.distributions[dim] || []).filter((r) => r.value !== EMPTY_LABEL);
    const needle = q.trim().toLowerCase();
    return needle ? all.filter((r) => r.value.toLowerCase().includes(needle)) : all;
  }, [sum, dim, q]);

  const label = sum.dims.find((d) => d.key === dim)?.label || dim;

  return (
    <Section
      title="Dağılımlar"
      right={
        <div className="flex items-center gap-2">
          <div className="relative">
            <MagnifyingGlassIcon className="w-3.5 h-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              value={q} onChange={(e) => setQ(e.target.value)} placeholder="değer ara"
              className="pl-7 pr-2 py-1 text-xs border border-gray-200 rounded-lg w-40"
            />
          </div>
          <ExportBtn
            onClick={() => csvDownload(`dagilim_${dim}`,
              [label, sum.unit === "sunucu" ? "sunucu" : "kayit", "sunucu"],
              rows.map((r) => [r.value, r.count, r.hosts]))}
          />
        </div>
      }
    >
      <div className="flex flex-wrap gap-1 mb-3">
        {sum.dims.map((d) => (
          <button
            key={d.key}
            onClick={() => setDim(d.key)}
            className={`px-2.5 py-1 text-[11px] font-medium rounded-lg border transition-colors ${
              dim === d.key
                ? "bg-[var(--accent)]/10 border-[var(--accent)]/30 text-[var(--accent)]"
                : "bg-white border-gray-200 text-gray-600 hover:bg-gray-50"
            }`}
          >
            {d.label}
            <span className="ml-1.5 tabular-nums text-gray-400">
              {(sum.distributions[d.key] || []).length}
            </span>
          </button>
        ))}
      </div>
      <BarList rows={rows} unit={sum.unit} limit={40} showHosts={sum.source !== "hosts"} />
      {emptyRow && (
        <p className="mt-2 text-[11px] text-gray-400">
          Ayrıca {nf(emptyRow.count)} kayıtta bu alan boş — listede gösterilmiyor, yüzdeler
          dolu değerler üzerinden hesaplanıyor.
        </p>
      )}
    </Section>
  );
}

function BarList({
  rows, unit, limit = 30, showHosts = false,
}: {
  rows: { value: string; count: number; hosts?: number }[];
  unit: string; limit?: number; showHosts?: boolean;
}) {
  const [all, setAll] = useState(false);
  const max = Math.max(1, ...rows.map((r) => r.count));
  const total = rows.reduce((a, r) => a + r.count, 0) || 1;
  const shown = all ? rows : rows.slice(0, limit);

  if (rows.length === 0) return <div className="py-6 text-center text-sm text-gray-400">Kayıt yok.</div>;

  return (
    <div className="space-y-1">
      {shown.map((r) => (
        <div key={r.value} className="flex items-center gap-2.5">
          <span
            className={`w-52 shrink-0 truncate text-xs ${
              r.value === "(boş)" ? "text-gray-400 italic" : "text-gray-700 font-mono"
            }`}
            title={r.value}
          >
            {r.value}
          </span>
          <span className="flex-1 h-3.5 rounded bg-gray-100 overflow-hidden">
            <span
              className={`block h-full rounded ${r.value === "(boş)" ? "bg-gray-300" : "bg-[var(--accent)]/70"}`}
              style={{ width: `${(r.count / max) * 100}%` }}
            />
          </span>
          <span className="w-14 shrink-0 text-right text-xs tabular-nums font-semibold text-gray-800">
            {nf(r.count)}
          </span>
          <span className="w-12 shrink-0 text-right text-[11px] tabular-nums text-gray-400">
            %{((r.count / total) * 100).toFixed(1)}
          </span>
          {showHosts && (
            <span className="w-24 shrink-0 text-right text-[11px] tabular-nums text-gray-400">
              {nf(r.hosts ?? 0)} sunucu
            </span>
          )}
        </div>
      ))}
      {rows.length > limit && (
        <button
          onClick={() => setAll(!all)}
          className="mt-1 text-[11px] text-[var(--accent)] hover:underline"
        >
          {all ? "daha az göster" : `tümünü göster (${nf(rows.length)} ${unit === "sunucu" ? "değer" : "değer"})`}
        </button>
      )}
    </div>
  );
}

// ── Capraz tablo ──────────────────────────────────────────────────────────────────────
// Kullanicinin asil sordugu sey: "bu urunlerin surumlerinin domain'lerdeki/subnet'lerdeki
// dagilimi". X = kirilim (domain/subnet/ortam), Y = olculen sey (surum/JRE/durum).
function Pivot({ source, sum }: { source: string; sum: EnvanterSummary }) {
  // Varsayilan satir boyutu: once GERCEK bir urun surumu (Sunucular kaynaginda
  // products dolu gelir), yoksa adi _version ile biten ilk boyut. Yalnizca son eke
  // bakmak "os_version"i secip urun kirilimini kaciriyordu - tarayicida goruldu.
  const firstY =
    sum.dims.find((d) => d.key === sum.products[0]?.key)
    || sum.dims.find((d) => d.key !== "os_version" && d.key.endsWith("_version"))
    || sum.dims[1] || sum.dims[0];
  const [x, setX] = useState(sum.dims.some((d) => d.key === "domain") ? "domain" : sum.dims[0].key);
  const [y, setY] = useState(firstY.key);
  const [metric, setMetric] = useState<"rows" | "hosts">(source === "hosts" ? "rows" : "hosts");
  const [hideEmpty, setHideEmpty] = useState(true);
  const [data, setData] = useState<EnvanterPivot | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  // Kaynak degisince eski boyut anahtarlari gecersiz olabilir - varsayilanlara don.
  useEffect(() => {
    if (!sum.dims.some((d) => d.key === x)) setX(sum.dims[0].key);
    if (!sum.dims.some((d) => d.key === y)) setY(firstY.key);
    setMetric(source === "hosts" ? "rows" : "hosts");
  }, [sum, source]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    let alive = true;
    setLoading(true);
    denetimApi.envanterPivot({ source, x, y, metric, hideEmpty })
      .then((r) => {
        if (!alive) return;
        if (r.ok) { setData(r); setErr(""); } else setErr(r.message || "Çapraz tablo alınamadı.");
      })
      .catch((e) => alive && setErr(e instanceof Error ? e.message : String(e)))
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [source, x, y, metric, hideEmpty]);

  const xs = (data?.x.values || []).slice(0, 25);
  const ys = (data?.y.values || []).slice(0, 40);
  const max = Math.max(1, ...Object.values(data?.cells || {}));

  return (
    <Section
      title="Çapraz dağılım"
      note="Satır ve sütunu seçerek istediğiniz kırılımı kurun. Hücre koyulaştıkça sayı büyür."
      right={
        <ExportBtn
          disabled={!data}
          onClick={() => data && csvDownload(`capraz_${y}_x_${x}`,
            [data.y.label, ...xs.map((c) => c.value), "TOPLAM"],
            ys.map((r) => [
              r.value,
              ...xs.map((c) => data.cells[c.value + SEP + r.value] ?? 0),
              r.count,
            ]))}
        />
      }
    >
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <label className="text-[11px] text-gray-500">Sütun</label>
        <Select sizeVariant="sm" value={x} onChange={(e) => setX(e.target.value)}>
          {sum.dims.map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}
        </Select>
        <label className="text-[11px] text-gray-500 ml-1">Satır</label>
        <Select sizeVariant="sm" value={y} onChange={(e) => setY(e.target.value)}>
          {sum.dims.map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}
        </Select>
        {source !== "hosts" && (
          <>
            <label className="text-[11px] text-gray-500 ml-1">Sayım</label>
            <Select sizeVariant="sm" value={metric} onChange={(e) => setMetric(e.target.value as "rows" | "hosts")}>
              <option value="rows">uygulama</option>
              <option value="hosts">sunucu</option>
            </Select>
          </>
        )}
        <label className="flex items-center gap-1.5 text-[11px] text-gray-600 cursor-pointer ml-1">
          <input type="checkbox" checked={hideEmpty} onChange={(e) => setHideEmpty(e.target.checked)} />
          Boş satırı gizle
        </label>
        {loading && <span className="text-[11px] text-gray-400">yükleniyor…</span>}
      </div>

      {err && <div className="text-xs text-red-600">{err}</div>}

      {data && ys.length > 0 ? (
        <>
          <div className="overflow-x-auto rounded-xl border border-gray-100">
            {/* w-full + min-w-max: sutun sayisi AZ oldugunda tablo kapsayiciyi doldurur
                (eskiden sagda genis bir bosluk kaliyordu), COK oldugunda min-width
                kazanir ve tablo yatay kayar. Tek basina w-full ikinci durumu bozardi. */}
            <table className="w-full min-w-max text-xs border-collapse">
              <thead>
                <tr className="bg-gray-50">
                  <th className="sticky left-0 z-10 bg-gray-50 px-3 py-2 text-left font-semibold text-gray-500 border-b border-gray-100 min-w-[180px]">
                    {data.y.label} \ {data.x.label}
                  </th>
                  {xs.map((c) => (
                    <th
                      key={c.value}
                      className="px-2 py-2 font-semibold text-gray-500 border-b border-gray-100 whitespace-nowrap max-w-[140px] truncate"
                      title={`${c.value} — ${nf(c.count)}`}
                    >
                      {c.value}
                    </th>
                  ))}
                  <th className="px-2 py-2 font-semibold text-gray-500 border-b border-l border-gray-100 whitespace-nowrap">Toplam</th>
                </tr>
              </thead>
              <tbody>
                {ys.map((r) => (
                  <tr key={r.value} className="hover:bg-gray-50/40">
                    <td
                      className={`sticky left-0 z-10 bg-white px-3 py-1.5 border-b border-gray-50 whitespace-nowrap max-w-[220px] truncate ${
                        r.value === "(boş)" ? "text-gray-400 italic" : "font-mono text-gray-800"
                      }`}
                      title={r.value}
                    >
                      {r.value}
                    </td>
                    {xs.map((c) => {
                      const n = data.cells[c.value + SEP + r.value] ?? 0;
                      return (
                        <td key={c.value} className="px-2 py-1.5 text-center border-b border-gray-50 tabular-nums">
                          {n === 0 ? (
                            <span className="text-gray-200">·</span>
                          ) : (
                            <span
                              className="inline-block min-w-[2rem] rounded px-1.5 py-0.5 font-semibold"
                              style={{
                                // Isi haritasi: karekok olcekleme, tek bir buyuk hucrenin
                                // digerlerini gorunmez kilmasini onler.
                                backgroundColor: `color-mix(in srgb, var(--accent) ${Math.round(Math.sqrt(n / max) * 78) + 8}%, transparent)`,
                                color: n / max > 0.45 ? "#fff" : "var(--text)",
                              }}
                            >
                              {nf(n)}
                            </span>
                          )}
                        </td>
                      );
                    })}
                    <td className="px-2 py-1.5 text-center border-b border-l border-gray-50 tabular-nums font-semibold text-gray-700">
                      {nf(r.count)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {(data.x.values.length > xs.length || data.y.values.length > ys.length) && (
            <p className="mt-2 text-[11px] text-gray-400">
              En kalabalık {xs.length} sütun ve {ys.length} satır gösteriliyor
              (toplam {nf(data.x.values.length)} × {nf(data.y.values.length)}). Tamamı için CSV indirin.
            </p>
          )}
        </>
      ) : !loading && (
        <div className="py-8 text-center text-sm text-gray-400">
          <TableCellsIcon className="w-6 h-6 mx-auto mb-1.5 text-gray-300" />
          Bu kırılımda veri yok.
        </div>
      )}
    </Section>
  );
}

// ── Ortak kabuk ───────────────────────────────────────────────────────────────────────
function Section({
  title, note, right, children,
}: {
  title: string; note?: string; right?: React.ReactNode; children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-gray-100 bg-white px-4 py-3.5">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div>
          <h3 className="text-sm font-semibold text-gray-800">{title}</h3>
          {note && <p className="text-[11px] text-gray-400 mt-0.5 max-w-2xl">{note}</p>}
        </div>
        {right}
      </div>
      {children}
    </div>
  );
}

function ExportBtn({ onClick, disabled }: { onClick: () => void; disabled?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-40"
    >
      <ArrowDownTrayIcon className="w-3.5 h-3.5" /> CSV
    </button>
  );
}
