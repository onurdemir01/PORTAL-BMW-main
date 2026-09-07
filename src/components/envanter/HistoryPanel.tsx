// src/components/envanter/HistoryPanel.tsx — "Envanter > Geçmiş" (2026-09-08).
//
// NEDEN AYRI BİR PANEL: ana ızgara aramayı, filtreyi, sıralamayı ve sayfalamayı
// SUNUCUDA yapıyor (canlı tabloya SQL atarak). Geçmiş verisi ise satırların JSON
// anlık görüntüsünden gelir; aynı boruya bağlamak o SQL katmanını geçmiş için baştan
// yazmak demekti. Ayrı panel hem ana ızgarayı riske atmıyor hem de geçmişe özgü
// soruları (iki tarih farkı) doğal biçimde soruyor.
//
// GERİYE DÖNÜK VERİ YOKTUR: kaynak tablolar her yenilemede TRUNCATE edilip yeniden
// yazıldığı için geçmiş yalnızca Portal'ın gecelik anlık görüntüleri başladıktan
// SONRASINI bilir. Panel bunu boş durumda açıkça söyler — kullanıcı "veri mi yok,
// özellik mi bozuk" ikilemine düşmesin.
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ClockIcon, ArrowsRightLeftIcon, MagnifyingGlassIcon, PlusCircleIcon,
  MinusCircleIcon, PencilSquareIcon, ArrowDownTrayIcon,
} from "@heroicons/react/24/outline";
import { Modal } from "@/components/common/Modal";
import { TextInput } from "@/components/ui/Form";
import { inventoryApi, type HistoryRow, type HistoryDiff } from "@/api/inventoryApi";
import { fmtNumber } from "@/utils/datetime";

type Mode = "at" | "diff";

function today() {
  return new Date().toISOString().slice(0, 10);
}
function daysAgo(n: number) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

function csvDownload(name: string, header: string[], rows: (string | number)[][]) {
  const body = [header, ...rows]
    .map((r) => r.map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(","))
    .join("\n");
  const blob = new Blob(["﻿" + body], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${name}_${today()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

/** Küçük, tekrar eden başlık şeridi — üç fark bölümü de aynı görsel dili kullanır. */
function SectionHead({
  icon: Icon, title, count, tone,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  count: number;
  tone: "add" | "remove" | "change";
}) {
  const tones = {
    add: "text-emerald-700 bg-emerald-50 border-emerald-200",
    remove: "text-red-700 bg-red-50 border-red-200",
    change: "text-amber-700 bg-amber-50 border-amber-200",
  } as const;
  return (
    <div className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-xs font-semibold ${tones[tone]}`}>
      <Icon className="w-4 h-4 flex-shrink-0" />
      <span>{title}</span>
      <span className="ml-auto font-mono tabular-nums">{fmtNumber(count)}</span>
    </div>
  );
}

export default function HistoryPanel({
  open, onClose, table, label,
}: {
  open: boolean;
  onClose: () => void;
  table: string;
  label?: string;
}) {
  const [mode, setMode] = useState<Mode>("at");
  const [atDate, setAtDate] = useState(today());
  const [fromDate, setFromDate] = useState(daysAgo(7));
  const [toDate, setToDate] = useState(today());
  const [rows, setRows] = useState<HistoryRow[]>([]);
  const [diff, setDiff] = useState<HistoryDiff | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [q, setQ] = useState("");

  const loadAt = useCallback(async () => {
    setLoading(true); setErr("");
    try {
      const r = await inventoryApi.historyAt(table, atDate);
      if (r.ok) setRows(r.rows);
      else { setRows([]); setErr(r.message || "Veri alınamadı."); }
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally { setLoading(false); }
  }, [table, atDate]);

  const loadDiff = useCallback(async () => {
    setLoading(true); setErr("");
    try {
      const r = await inventoryApi.historyDiff(table, fromDate, toDate);
      if (r.ok) setDiff(r);
      else { setDiff(null); setErr(r.message || "Veri alınamadı."); }
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally { setLoading(false); }
  }, [table, fromDate, toDate]);

  useEffect(() => {
    if (!open) return;
    if (mode === "at") loadAt();
    else loadDiff();
  }, [open, mode, loadAt, loadDiff]);

  // Sunucuda arama YOK: geçmiş satırları JSON olarak zaten bellekte, istemcide filtrelemek
  // hem anında hem de ek uç gerektirmiyor.
  const shownRows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((r) => JSON.stringify(r.data).toLowerCase().includes(needle));
  }, [rows, q]);

  const cols = useMemo(() => {
    const set = new Set<string>();
    for (const r of shownRows.slice(0, 50)) Object.keys(r.data).forEach((k) => set.add(k));
    return [...set].slice(0, 8);
  }, [shownRows]);

  const noHistoryYet = !loading && !err &&
    ((mode === "at" && rows.length === 0) ||
     (mode === "diff" && diff !== null &&
      diff.added.length === 0 && diff.removed.length === 0 && diff.changed.length === 0));

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Geçmiş — ${label || table}`}
      subtitle="Tablonun geçmiş bir tarihteki hâli ve iki tarih arasındaki fark"
      icon={ClockIcon}
      size="xl"
    >
      <div className="space-y-4">
        {/* Mod seçici */}
        <div className="flex gap-1 rounded-xl p-1 w-fit" style={{ background: "var(--bg-elevated)" }}>
          {([
            { id: "at" as Mode, label: "Tarihteki Hâli", icon: ClockIcon },
            { id: "diff" as Mode, label: "İki Tarih Farkı", icon: ArrowsRightLeftIcon },
          ]).map((m) => {
            const Icon = m.icon;
            const active = mode === m.id;
            return (
              <button
                key={m.id}
                onClick={() => setMode(m.id)}
                className={`flex items-center gap-2 px-3 py-1.5 text-sm font-medium rounded-lg transition-colors ${
                  active ? "bg-white text-[var(--accent)]" : "text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                }`}
                style={active ? { boxShadow: "var(--shadow-sm)" } : {}}
              >
                <Icon className="w-4 h-4" />
                {m.label}
              </button>
            );
          })}
        </div>

        {/* Tarih girdileri */}
        <div className="flex flex-wrap items-end gap-3">
          {mode === "at" ? (
            <label className="text-xs font-semibold text-[var(--text-secondary)]">
              Tarih
              <input
                type="date"
                value={atDate}
                max={today()}
                onChange={(e) => setAtDate(e.target.value)}
                className="block mt-1 px-3 py-2 text-sm rounded-lg border border-[var(--border)] bg-[var(--bg-surface)]"
              />
            </label>
          ) : (
            <>
              <label className="text-xs font-semibold text-[var(--text-secondary)]">
                Başlangıç
                <input
                  type="date"
                  value={fromDate}
                  max={toDate}
                  onChange={(e) => setFromDate(e.target.value)}
                  className="block mt-1 px-3 py-2 text-sm rounded-lg border border-[var(--border)] bg-[var(--bg-surface)]"
                />
              </label>
              <label className="text-xs font-semibold text-[var(--text-secondary)]">
                Bitiş
                <input
                  type="date"
                  value={toDate}
                  min={fromDate}
                  max={today()}
                  onChange={(e) => setToDate(e.target.value)}
                  className="block mt-1 px-3 py-2 text-sm rounded-lg border border-[var(--border)] bg-[var(--bg-surface)]"
                />
              </label>
            </>
          )}

          {mode === "at" && (
            <div className="relative flex-1 min-w-[12rem]">
              <MagnifyingGlassIcon className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
              <TextInput
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Satırlarda ara…"
                className="pl-9"
              />
            </div>
          )}

          {mode === "at" && shownRows.length > 0 && (
            <button
              onClick={() =>
                csvDownload(
                  `${table}_${atDate}`,
                  cols,
                  shownRows.map((r) => cols.map((c) => String(r.data[c] ?? ""))),
                )
              }
              className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text-primary)]"
            >
              <ArrowDownTrayIcon className="w-3.5 h-3.5" />
              CSV
            </button>
          )}
        </div>

        {err && (
          <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-xl px-3 py-2">{err}</div>
        )}

        {loading && (
          <div className="flex items-center justify-center h-24">
            <div className="w-5 h-5 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
          </div>
        )}

        {/* GEÇMİŞ YOK: özelliğin bozuk olduğu izlenimi vermemek için sebebi açıkça yazılır. */}
        {noHistoryYet && (
          <div className="rounded-xl border border-dashed border-[var(--border)] px-4 py-6 text-center">
            <ClockIcon className="w-8 h-8 mx-auto text-[var(--text-muted)]" />
            <p className="mt-2 text-sm font-medium text-[var(--text-primary)]">
              Bu tarih için kayıtlı geçmiş yok.
            </p>
            <p className="mt-1 text-xs text-[var(--text-muted)] max-w-md mx-auto">
              Envanter tabloları her yenilemede sıfırdan yazıldığı için geçmiş, Portal
              günlük anlık görüntü almaya başladıktan <strong>sonrasını</strong> kapsar.
              Daha eski tarihler geriye dönük üretilemez.
            </p>
          </div>
        )}

        {/* Mod 1 — tarihteki hâli */}
        {!loading && mode === "at" && shownRows.length > 0 && (
          <>
            <p className="text-xs text-[var(--text-muted)]">
              <strong className="text-[var(--text-primary)]">{fmtNumber(shownRows.length)}</strong> satır
              {q && ` (${fmtNumber(rows.length)} içinden)`} · {atDate} tarihindeki hâli
            </p>
            <div className="overflow-auto max-h-[26rem] rounded-xl border border-[var(--border)]">
              <table className="w-full text-xs">
                <thead className="sticky top-0" style={{ background: "var(--bg-elevated)" }}>
                  <tr>
                    {cols.map((c) => (
                      <th key={c} className="px-3 py-2 text-left font-semibold text-[var(--text-secondary)] whitespace-nowrap">{c}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {shownRows.slice(0, 500).map((r) => (
                    <tr key={r.key} className="border-t border-[var(--border)]">
                      {cols.map((c) => (
                        <td key={c} className="px-3 py-1.5 text-[var(--text-primary)] whitespace-nowrap max-w-xs truncate" title={String(r.data[c] ?? "")}>
                          {String(r.data[c] ?? "")}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {shownRows.length > 500 && (
              <p className="text-[11px] text-[var(--text-muted)]">
                İlk 500 satır gösteriliyor — tamamı için CSV indirin.
              </p>
            )}
          </>
        )}

        {/* Mod 2 — iki tarih farkı */}
        {!loading && mode === "diff" && diff && !noHistoryYet && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <SectionHead icon={PlusCircleIcon} title="Gelen" count={diff.added.length} tone="add" />
              <SectionHead icon={MinusCircleIcon} title="Giden" count={diff.removed.length} tone="remove" />
              <SectionHead icon={PencilSquareIcon} title="Değişen" count={diff.changed.length} tone="change" />
            </div>

            {diff.added.length > 0 && (
              <details open className="rounded-xl border border-[var(--border)]">
                <summary className="px-3 py-2 text-xs font-semibold cursor-pointer text-emerald-700">
                  Gelen satırlar ({fmtNumber(diff.added.length)})
                </summary>
                <ul className="px-3 pb-3 space-y-1 max-h-52 overflow-auto">
                  {diff.added.slice(0, 300).map((r) => (
                    <li key={r.key} className="text-xs font-mono text-[var(--text-primary)]">{r.key}</li>
                  ))}
                </ul>
              </details>
            )}

            {diff.removed.length > 0 && (
              <details open className="rounded-xl border border-[var(--border)]">
                <summary className="px-3 py-2 text-xs font-semibold cursor-pointer text-red-700">
                  Giden satırlar ({fmtNumber(diff.removed.length)})
                </summary>
                <ul className="px-3 pb-3 space-y-1 max-h-52 overflow-auto">
                  {diff.removed.slice(0, 300).map((r) => (
                    <li key={r.key} className="text-xs font-mono text-[var(--text-primary)]">{r.key}</li>
                  ))}
                </ul>
              </details>
            )}

            {diff.changed.length > 0 && (
              <details open className="rounded-xl border border-[var(--border)]">
                <summary className="px-3 py-2 text-xs font-semibold cursor-pointer text-amber-700">
                  Değişen satırlar ({fmtNumber(diff.changed.length)})
                </summary>
                <div className="px-3 pb-3 space-y-2 max-h-72 overflow-auto">
                  {diff.changed.slice(0, 200).map((c) => (
                    <div key={c.key} className="rounded-lg border border-[var(--border)] p-2">
                      <p className="text-xs font-mono font-semibold text-[var(--text-primary)] mb-1">{c.key}</p>
                      {Object.entries(c.fields).map(([col, v]) => (
                        <p key={col} className="text-[11px] text-[var(--text-muted)]">
                          <span className="font-semibold text-[var(--text-secondary)]">{col}:</span>{" "}
                          <span className="line-through">{String(v.before ?? "—")}</span>
                          {" → "}
                          <span className="text-[var(--text-primary)] font-medium">{String(v.after ?? "—")}</span>
                        </p>
                      ))}
                    </div>
                  ))}
                </div>
              </details>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
