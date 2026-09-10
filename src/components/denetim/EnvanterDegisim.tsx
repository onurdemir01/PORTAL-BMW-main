// src/components/denetim/EnvanterDegisim.tsx — "Denetim > Envanter Değişim" (2026-09-08).
//
// Mevcut "Envanter Audit" sekmesi ANLIK dağılımları gösterir (bugün ne var). Bu sekme
// ZAMANI gösterir: ne değişti, ne geldi, ne gitti, tarama sağlıklı mı.
//
// Kaynak: Portal'ın gecelik SCD-2 anlık görüntüleri (server/inventory/history.cjs).
// GERİYE DÖNÜK VERİ YOKTUR — envanter tabloları her yenilemede TRUNCATE edilip yeniden
// yazıldığı için geçmiş yalnızca anlık görüntüler başladıktan sonrasını kapsar.
//
// Grafikler CSS ile çizilir; projede grafik kütüphanesi yok ve tek bir trend çubuğu için
// bağımlılık eklemek paket boyutuna değmez (EnvanterMetrics.tsx ile aynı tercih).
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useAsyncEffect } from '@/hooks/useAsyncEffect';
import {
  ArrowPathIcon,
  ArrowTrendingUpIcon,
  PlusCircleIcon,
  MinusCircleIcon,
  PencilSquareIcon,
  HeartIcon,
  MoonIcon,
  ExclamationTriangleIcon,
} from '@heroicons/react/24/outline';
import { Select } from '@/components/ui/Form';
import {
  inventoryApi,
  type HistoryTableInfo,
  type HistoryDiff,
  type HistoryRun,
} from '@/api/inventoryApi';
import { fmtNumber } from '@/utils/datetime';

const nf = (n: number) => fmtNumber(n);
const iso = (d: Date) => d.toISOString().slice(0, 10);
const today = () => iso(new Date());
function daysAgo(n: number) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return iso(d);
}
/** "3 gün önce" gibi kısa bir bağıl süre — ham ISO damgası tabloda okunmuyor. */
function since(ts: string | null): string {
  if (!ts) return '—';
  const ms = Date.now() - new Date(ts).getTime();
  if (!Number.isFinite(ms)) return '—';
  const h = Math.floor(ms / 3_600_000);
  if (h < 1) return 'az önce';
  if (h < 24) return `${h} saat önce`;
  return `${Math.floor(h / 24)} gün önce`;
}

/** Büyük sayı + altında etiket — sayfadaki tüm sayaçlar aynı görsel dili kullanır. */
function Stat({
  icon: Icon,
  label,
  value,
  tone = 'neutral',
  hint,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: React.ReactNode;
  tone?: 'neutral' | 'add' | 'remove' | 'change' | 'warn';
  hint?: string;
}) {
  const tones = {
    neutral: 'text-[var(--text-primary)] border-[var(--border)]',
    add: 'text-emerald-700 border-emerald-200 bg-emerald-50/60',
    remove: 'text-red-700 border-red-200 bg-red-50/60',
    change: 'text-amber-700 border-amber-200 bg-amber-50/60',
    warn: 'text-red-700 border-red-300 bg-red-50',
  } as const;
  return (
    <div className={`rounded-xl border px-4 py-3 ${tones[tone]}`} title={hint}>
      <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide opacity-80">
        <Icon className="w-3.5 h-3.5" />
        {label}
      </div>
      <p className="mt-1 text-2xl font-bold tabular-nums leading-none">{value}</p>
    </div>
  );
}

export default function EnvanterDegisim() {
  const [tables, setTables] = useState<HistoryTableInfo[]>([]);
  const [table, setTable] = useState('');
  const [from, setFrom] = useState(daysAgo(7));
  const [to, setTo] = useState(today());
  const [days, setDays] = useState(30);

  const [series, setSeries] = useState<{ date: string; count: number }[]>([]);
  const [diff, setDiff] = useState<HistoryDiff | null>(null);
  const [runs, setRuns] = useState<HistoryRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  useEffect(() => {
    inventoryApi
      .historyTables()
      .then((r) => {
        if (!r.ok) {
          setErr(r.message || 'Tablo listesi alınamadı.');
          setLoading(false);
          return;
        }
        setTables(r.tables);
        if (r.tables.length) setTable(r.tables[0].table);
      })
      .catch((e: unknown) => {
        setErr(e instanceof Error ? e.message : String(e));
        setLoading(false);
      });
  }, []);

  const load = useCallback(async () => {
    if (!table) return;
    setLoading(true);
    setErr('');
    try {
      const [s, d, r] = await Promise.all([
        inventoryApi.historySeries(table, days),
        inventoryApi.historyDiff(table, from, to),
        inventoryApi.historyRuns(200),
      ]);
      setSeries(s.ok ? s.series : []);
      setDiff(d.ok ? d : null);
      setRuns(r.ok ? r.runs : []);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [table, from, to, days]);

  useAsyncEffect(async () => {
    await load();
  }, [load]);

  // ── Metrik 4: en çok değişen kolonlar ────────────────────────────────────────
  // Gürültü kaynağını gösterir: her gece değişen bir kolon (ör. bir sayaç) farkı
  // kirletiyorsa burada en üstte çıkar ve hash dışına alınmasına karar verilebilir.
  const topColumns = useMemo(() => {
    if (!diff) return [];
    const counts = new Map<string, number>();
    for (const c of diff.changed) {
      for (const col of Object.keys(c.fields)) counts.set(col, (counts.get(col) || 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  }, [diff]);

  // ── Metrik 5: tarama sağlığı (tablo başına son çalıştırma) ───────────────────
  const health = useMemo(() => {
    const last = new Map<string, HistoryRun>();
    for (const r of runs) if (!last.has(r.table_name)) last.set(r.table_name, r); // runs zaten yeniden eskiye
    return tables
      .filter((t) => t.mode === 'snapshot')
      .map((t) => ({ table: t.table, label: t.label, run: last.get(t.table) || null }));
  }, [runs, tables]);

  // ── Metrik 6: sessiz tablolar ────────────────────────────────────────────────
  // Uzun süre HİÇ değişmemiş bir tablo ya gerçekten sabittir ya da taraması kırılmıştır.
  // Ayrımı kod yapamaz; sinyal gösterilir, yorum operatöre bırakılır.
  const quiet = useMemo(() => {
    const lastChange = new Map<string, string>();
    for (const r of runs) {
      const moved = (r.added || 0) + (r.changed || 0) + (r.removed || 0) > 0;
      if (moved && !lastChange.has(r.table_name)) lastChange.set(r.table_name, r.started_at);
    }
    return health
      .map((h) => ({ ...h, lastChange: lastChange.get(h.table) || null }))
      .filter((h) => {
        if (!h.run) return false;
        if (!h.lastChange) return true; // hiç değişiklik görülmemiş
        return Date.now() - new Date(h.lastChange).getTime() > 7 * 86_400_000;
      });
  }, [health, runs]);

  const maxCount = Math.max(1, ...series.map((s) => s.count));
  const noData = !loading && !err && series.every((s) => s.count === 0) && runs.length === 0;

  return (
    <div className="space-y-5">
      {/* Kontroller */}
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-xs font-semibold text-[var(--text-secondary)]">
          Tablo
          <Select
            value={table}
            onChange={(e) => setTable(e.target.value)}
            className="mt-1 min-w-[14rem]"
          >
            {tables.map((t) => (
              <option key={t.table} value={t.table}>
                {t.label}
              </option>
            ))}
          </Select>
        </label>
        <label className="text-xs font-semibold text-[var(--text-secondary)]">
          Başlangıç
          <input
            type="date"
            value={from}
            max={to}
            onChange={(e) => setFrom(e.target.value)}
            className="block mt-1 px-3 py-2 text-sm rounded-lg border border-[var(--border)] bg-[var(--bg-surface)]"
          />
        </label>
        <label className="text-xs font-semibold text-[var(--text-secondary)]">
          Bitiş
          <input
            type="date"
            value={to}
            min={from}
            max={today()}
            onChange={(e) => setTo(e.target.value)}
            className="block mt-1 px-3 py-2 text-sm rounded-lg border border-[var(--border)] bg-[var(--bg-surface)]"
          />
        </label>
        <label className="text-xs font-semibold text-[var(--text-secondary)]">
          Trend aralığı
          <Select
            value={String(days)}
            onChange={(e) => setDays(Number(e.target.value))}
            className="mt-1"
          >
            <option value="14">14 gün</option>
            <option value="30">30 gün</option>
            <option value="90">90 gün</option>
          </Select>
        </label>
        <button
          onClick={load}
          className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text-primary)]"
        >
          <ArrowPathIcon className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          Yenile
        </button>
      </div>

      {err && (
        <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-xl px-3 py-2">
          {err}
        </div>
      )}

      {noData && (
        <div className="rounded-xl border border-dashed border-[var(--border)] px-4 py-8 text-center">
          <ArrowTrendingUpIcon className="w-8 h-8 mx-auto text-[var(--text-muted)]" />
          <p className="mt-2 text-sm font-medium">Henüz geçmiş birikmedi.</p>
          <p className="mt-1 text-xs text-[var(--text-muted)] max-w-lg mx-auto">
            Envanter tabloları her yenilemede sıfırdan yazıldığı için geçmiş, Portal günlük anlık
            görüntü almaya başladıktan <strong>sonrasını</strong> kapsar. İlk birkaç gün bu ekran
            boş görünür; daha eski tarihler geriye dönük üretilemez.
          </p>
        </div>
      )}

      {/* Metrik 2 — iki tarih arası özet */}
      {diff && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Stat
            icon={ArrowTrendingUpIcon}
            label="Bugünkü satır"
            value={nf(series.length ? series[series.length - 1].count : 0)}
          />
          <Stat icon={PlusCircleIcon} label="Gelen" value={nf(diff.added.length)} tone="add" />
          <Stat
            icon={MinusCircleIcon}
            label="Giden"
            value={nf(diff.removed.length)}
            tone="remove"
          />
          <Stat
            icon={PencilSquareIcon}
            label="Değişen"
            value={nf(diff.changed.length)}
            tone="change"
          />
        </div>
      )}

      {/* Metrik 1 — satır sayısı trendi */}
      {series.length > 0 && (
        <section className="rounded-xl border border-[var(--border)] p-4">
          <h3 className="text-sm font-semibold mb-3">Satır sayısı trendi ({days} gün)</h3>
          <div className="flex items-end gap-[2px] h-28">
            {series.map((s) => (
              <div
                key={s.date}
                className="flex-1 rounded-t transition-all"
                style={{
                  height: `${Math.max(2, (s.count / maxCount) * 100)}%`,
                  background: 'var(--accent)',
                  opacity: s.count === 0 ? 0.15 : 0.75,
                }}
                title={`${s.date}: ${nf(s.count)} satır`}
              />
            ))}
          </div>
          <div className="flex justify-between mt-1 text-[10px] text-[var(--text-muted)] tabular-nums">
            <span>{series[0]?.date}</span>
            <span>en yüksek {nf(maxCount)}</span>
            <span>{series[series.length - 1]?.date}</span>
          </div>
        </section>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Metrik 3 — gelen / giden listesi */}
        {diff && (diff.added.length > 0 || diff.removed.length > 0) && (
          <section className="rounded-xl border border-[var(--border)] p-4">
            <h3 className="text-sm font-semibold mb-3">Gelen ve giden kayıtlar</h3>
            <div className="space-y-3 max-h-64 overflow-auto">
              {diff.added.length > 0 && (
                <div>
                  <p className="text-[11px] font-semibold text-emerald-700 mb-1">
                    Gelen ({nf(diff.added.length)})
                  </p>
                  <ul className="space-y-0.5">
                    {diff.added.slice(0, 100).map((r) => (
                      <li
                        key={r.key}
                        className="text-xs font-mono text-[var(--text-primary)] truncate"
                        title={r.key}
                      >
                        + {r.key}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {diff.removed.length > 0 && (
                <div>
                  <p className="text-[11px] font-semibold text-red-700 mb-1">
                    Giden ({nf(diff.removed.length)})
                  </p>
                  <ul className="space-y-0.5">
                    {diff.removed.slice(0, 100).map((r) => (
                      <li
                        key={r.key}
                        className="text-xs font-mono text-[var(--text-primary)] truncate"
                        title={r.key}
                      >
                        − {r.key}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </section>
        )}

        {/* Metrik 4 — en çok değişen kolonlar */}
        {topColumns.length > 0 && (
          <section className="rounded-xl border border-[var(--border)] p-4">
            <h3 className="text-sm font-semibold">En çok değişen kolonlar</h3>
            <p className="text-[11px] text-[var(--text-muted)] mb-3">
              Bir kolon sürekli başı çekiyorsa farkı kirletiyor olabilir — gürültü kaynağını
              gösterir.
            </p>
            <div className="space-y-1.5">
              {topColumns.map(([col, n]) => (
                <div key={col} className="flex items-center gap-2">
                  <span className="text-xs w-40 truncate text-[var(--text-secondary)]" title={col}>
                    {col}
                  </span>
                  <div
                    className="flex-1 h-2 rounded-full"
                    style={{ background: 'var(--bg-elevated)' }}
                  >
                    <div
                      className="h-2 rounded-full"
                      style={{
                        width: `${(n / topColumns[0][1]) * 100}%`,
                        background: 'var(--accent)',
                        opacity: 0.7,
                      }}
                    />
                  </div>
                  <span className="text-xs tabular-nums w-10 text-right text-[var(--text-muted)]">
                    {nf(n)}
                  </span>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>

      {/* Metrik 5 — tarama sağlığı */}
      {health.length > 0 && (
        <section className="rounded-xl border border-[var(--border)] p-4">
          <h3 className="text-sm font-semibold flex items-center gap-1.5">
            <HeartIcon className="w-4 h-4" /> Tarama sağlığı
          </h3>
          <p className="text-[11px] text-[var(--text-muted)] mb-3">
            Anlık görüntü çalıştırmalarının son durumu. <strong>Durduruldu</strong>, satır sayısının
            ani düştüğü ve geçmişe kitlesel silme yazılmadığı anlamına gelir.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-[var(--text-secondary)]">
                  <th className="px-2 py-1.5 font-semibold">Tablo</th>
                  <th className="px-2 py-1.5 font-semibold">Son çalıştırma</th>
                  <th className="px-2 py-1.5 font-semibold">Durum</th>
                  <th className="px-2 py-1.5 font-semibold text-right">Satır</th>
                  <th className="px-2 py-1.5 font-semibold">Not</th>
                </tr>
              </thead>
              <tbody>
                {health.map((h) => {
                  const st = h.run?.status;
                  const bad = st === 'aborted' || st === 'error';
                  return (
                    <tr key={h.table} className="border-t border-[var(--border)]">
                      <td className="px-2 py-1.5 font-medium">{h.label}</td>
                      <td className="px-2 py-1.5 text-[var(--text-muted)]">
                        {since(h.run?.started_at ?? null)}
                      </td>
                      <td className="px-2 py-1.5">
                        <span
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold border ${
                            bad
                              ? 'text-red-700 bg-red-50 border-red-200'
                              : st === 'ok'
                                ? 'text-emerald-700 bg-emerald-50 border-emerald-200'
                                : 'text-[var(--text-muted)] bg-[var(--bg-elevated)] border-[var(--border)]'
                          }`}
                        >
                          {bad && <ExclamationTriangleIcon className="w-3 h-3" />}
                          {st === 'ok'
                            ? 'Sağlıklı'
                            : st === 'aborted'
                              ? 'Durduruldu'
                              : st === 'skipped'
                                ? 'Tablo yok'
                                : st || '—'}
                        </span>
                      </td>
                      <td className="px-2 py-1.5 text-right tabular-nums">
                        {h.run?.source_rows != null ? nf(h.run.source_rows) : '—'}
                      </td>
                      <td
                        className="px-2 py-1.5 text-[var(--text-muted)] max-w-md truncate"
                        title={h.run?.message || ''}
                      >
                        {h.run?.message || '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Metrik 6 — sessiz tablolar */}
      {quiet.length > 0 && (
        <section className="rounded-xl border border-amber-200 bg-amber-50/50 p-4">
          <h3 className="text-sm font-semibold flex items-center gap-1.5 text-amber-800">
            <MoonIcon className="w-4 h-4" /> Sessiz tablolar
          </h3>
          <p className="text-[11px] text-amber-800/80 mb-2">
            Bir haftadır hiç değişiklik görülmedi. Ya gerçekten sabitler ya da taramaları kırılmış
            olabilir — ayrımı ekran yapamaz, kontrol etmekte fayda var.
          </p>
          <ul className="space-y-0.5">
            {quiet.map((q) => (
              <li key={q.table} className="text-xs text-amber-900">
                <strong>{q.label}</strong> — son değişiklik:{' '}
                {q.lastChange ? since(q.lastChange) : 'hiç görülmedi'}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
