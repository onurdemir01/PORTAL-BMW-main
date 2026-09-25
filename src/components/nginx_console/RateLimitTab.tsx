// src/components/nginx_console/RateLimitTab.tsx — Nginx Hub › Rate Limit (2026-09-26).
//
// Kullanıcı: "tüm Nginx sunucularının rate limitlerini de Nginx Hub'da ayrı bir sekmede
// görüntülemek, raporu indirebilmek istiyorum."
//
// Denetim'deki "API Envanteri" ekranıyla aynı tabloyu okur ama farklı soruyu cevaplar:
// orası "hangi API hangi sunucuda", burası "limit ne". Bu yüzden satır düzeyinde ve
// limit değerleriyle.
//
// İKİ AYRIM EKRANDA KORUNUR:
//  * "limit YOK" ile "ölçülmedi" aynı şey değildir. Tarama hiç koşmamışsa tablo boş gelir
//    ve ekran bunu açıkça söyler; satır varsa ve iki alan da boşsa gerçekten limit yoktur.
//  * server seviyesindeki limit location'a MİRAS kalır; "Kaynak" sütunu bunu görünür kılar,
//    yoksa "benim location'ımda limit yazmıyor, demek ki limitsizim" yanılgısı doğuyor.
import React, { useMemo, useState } from 'react';
import {
  ArrowDownTrayIcon, ArrowPathIcon, MagnifyingGlassIcon, ShieldExclamationIcon,
  InformationCircleIcon, FunnelIcon,
} from '@heroicons/react/24/outline';
import { nginxConsoleApi, type NginxRateLimitResult, type NginxRateLimitRow } from '@/api/nginxConsoleApi';
import { useAsyncEffect } from '@/hooks/useAsyncEffect';
import { LoadingLogo } from '@/components/common/LoadingLogo';
import { TableEmptyRow } from '@/components/common/EmptyState';
import { toast } from '@/hooks/useToast';

const SM = 'inline-flex items-center gap-1 h-7 px-2.5 text-[11px] font-medium leading-none rounded-lg border whitespace-nowrap disabled:opacity-40';
const btn = (primary = false): React.CSSProperties => (primary
  ? { background: 'var(--accent)', borderColor: 'var(--accent)', color: 'var(--accent-fg, #fff)' }
  : { borderColor: 'var(--border)', background: 'var(--bg-surface)', color: 'var(--text-primary)' });

const DURUM: Record<NginxRateLimitRow['state'], { label: string; color: string; bg: string }> = {
  yok: { label: 'limit YOK', color: 'var(--status-danger)', bg: 'var(--status-danger-bg)' },
  ip: { label: 'IP', color: 'var(--status-success)', bg: 'var(--status-success-bg)' },
  server: { label: 'server (miras)', color: 'var(--status-info)', bg: 'var(--status-info-bg)' },
  ikisi: { label: 'IP + server', color: 'var(--status-success)', bg: 'var(--status-success-bg)' },
};

export function RateLimitTab() {
  const [data, setData] = useState<NginxRateLimitResult | null>(null);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  const [scanDate, setScanDate] = useState('');
  const [q, setQ] = useState('');
  const [env, setEnv] = useState<'all' | string>('all');
  const [sadeceLimitsiz, setSadeceLimitsiz] = useState(false);

  useAsyncEffect(async (alive) => {
    setLoading(true); setErr('');
    try {
      const r = await nginxConsoleApi.rateLimit(scanDate || undefined);
      if (!alive()) return;
      if (!r.ok && !r.tableMissing) { setErr(r.message || 'Rate limit verisi alınamadı.'); setData(null); return; }
      setData(r);
    } catch (e: unknown) { if (alive()) setErr(e instanceof Error ? e.message : String(e)); } finally { if (alive()) setLoading(false); }
  }, [scanDate, tick]);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (data?.rows || []).filter((r) => {
      if (sadeceLimitsiz && r.state !== 'yok') return false;
      if (env !== 'all' && r.env !== env) return false;
      if (!needle) return true;
      return r.host.toLowerCase().includes(needle)
        || r.configFile.toLowerCase().includes(needle)
        || r.location.toLowerCase().includes(needle)
        || (r.ipLimit || '').toLowerCase().includes(needle)
        || (r.serverLimit || '').toLowerCase().includes(needle);
    });
  }, [data, q, env, sadeceLimitsiz]);

  const s = data?.summary;
  const envler = useMemo(() => Object.keys(s?.byEnv || {}).sort(), [s]);

  const indir = () => {
    // Rapor SUNUCUDA uretilir; burada yalnizca tarayiciyi o adrese yolluyoruz.
    const qs = scanDate ? `?scanDate=${encodeURIComponent(scanDate)}` : '';
    window.location.href = `/api/nginx-console/ratelimit.csv${qs}`;
    toast.success('Rapor indiriliyor (CSV).');
  };

  if (loading && !data) return <LoadingLogo compact />;
  if (err) {
    return <div className="text-sm rounded-xl px-3 py-2 border" style={{ color: 'var(--status-danger)', background: 'var(--status-danger-bg)', borderColor: 'var(--status-danger)' }}>{err}</div>;
  }

  return (
    <div className="space-y-3">
      {data?.tableMissing && (
        <div className="text-[12px] rounded-lg px-3 py-2 border flex items-start gap-2"
          style={{ color: 'var(--status-warning)', background: 'var(--status-warning-bg)', borderColor: 'var(--status-warning)' }}>
          <InformationCircleIcon className="h-4 w-4 mt-0.5 shrink-0" />
          <span>{data.message}</span>
        </div>
      )}

      {/* ÖZET: "kaç location limitsiz" sorusu en üstte cevaplanır. */}
      {s && (
        <div className="grid sm:grid-cols-4 gap-3">
          <Kpi title="Sunucu" value={s.hosts} />
          <Kpi title="Location" value={s.rows} />
          <Kpi title="Limitli" value={s.limitli} tone="ok" />
          <Kpi title="Limitsiz" value={s.limitsiz} tone={s.limitsiz > 0 ? 'danger' : 'ok'} />
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <MagnifyingGlassIcon className="h-4 w-4 absolute left-2 top-1.5" style={{ color: 'var(--text-muted)' }} />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="sunucu / konfigürasyon / location / zone ara"
            className="h-7 pl-7 pr-2 text-[12px] rounded-lg border w-72"
            style={{ borderColor: 'var(--border)', background: 'var(--bg-surface)', color: 'var(--text-primary)' }}
          />
        </div>
        <select value={env} onChange={(e) => setEnv(e.target.value)} className="h-7 text-[12px] rounded-lg border px-1.5"
          style={{ borderColor: 'var(--border)', background: 'var(--bg-surface)', color: 'var(--text-primary)' }}>
          <option value="all">tüm ortamlar</option>
          {envler.map((e) => <option key={e} value={e}>{e}</option>)}
        </select>
        <label className="inline-flex items-center gap-1 text-[11px]" style={{ color: 'var(--text-secondary)' }}>
          <input type="checkbox" checked={sadeceLimitsiz} onChange={(e) => setSadeceLimitsiz(e.target.checked)} />
          yalnız limitsizler
        </label>
        {(data?.availableDates || []).length > 1 && (
          <select value={scanDate} onChange={(e) => setScanDate(e.target.value)} className="h-7 text-[12px] rounded-lg border px-1.5"
            style={{ borderColor: 'var(--border)', background: 'var(--bg-surface)', color: 'var(--text-primary)' }}>
            <option value="">son tarama ({data?.scanDate})</option>
            {(data?.availableDates || []).map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
        )}
        <span className="flex-1" />
        <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
          {rows.length} / {data?.rows?.length ?? 0} satır
        </span>
        <button type="button" className={SM} style={btn()} onClick={() => setTick((n) => n + 1)}>
          <ArrowPathIcon className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} /> Yenile
        </button>
        <button type="button" className={SM} style={btn(true)} disabled={!data?.rows?.length} onClick={indir}>
          <ArrowDownTrayIcon className="h-3.5 w-3.5" /> Rapor indir (CSV)
        </button>
      </div>

      {s && s.topZones.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] inline-flex items-center gap-1" style={{ color: 'var(--text-muted)' }}>
            <FunnelIcon className="h-3.5 w-3.5" /> en çok kullanılan zone:
          </span>
          {s.topZones.map((z) => (
            <button key={z.zone} type="button" onClick={() => setQ(z.zone)}
              className="px-2 py-0.5 rounded-md text-[11px] border"
              style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-elevated)', color: 'var(--text-secondary)' }}>
              {z.zone} <b className="tabular-nums">{z.count}</b>
            </button>
          ))}
        </div>
      )}

      <div className="rounded-xl border overflow-hidden" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-surface)' }}>
        <div className="overflow-x-auto" style={{ maxHeight: '62vh' }}>
          <table className="w-full text-sm">
            <thead className="sticky top-0" style={{ background: 'var(--bg-elevated)' }}>
              <tr className="text-[11px] uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>
                <th className="text-left font-medium px-3 py-2">Sunucu</th>
                <th className="text-left font-medium px-3 py-2">Ortam</th>
                <th className="text-left font-medium px-3 py-2">Konfigürasyon</th>
                <th className="text-left font-medium px-3 py-2">Location</th>
                <th className="text-left font-medium px-3 py-2">IP limiti</th>
                <th className="text-left font-medium px-3 py-2">Server limiti</th>
                <th className="text-left font-medium px-3 py-2">Durum</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <TableEmptyRow
                  colSpan={7}
                  title={(data?.rows?.length ?? 0) === 0 ? 'Rate limit kaydı yok' : 'Süzgece uyan satır yok'}
                  description={(data?.rows?.length ?? 0) === 0
                    ? 'nginx_ratelimit_inventory job\'ı henüz koşmamış olabilir. Bu, "limit yok" anlamına GELMEZ.'
                    : 'Arama ya da ortam süzgecini gevşetin.'}
                />
              )}
              {rows.map((r, i) => {
                const d = DURUM[r.state];
                return (
                  <tr key={`${r.host}|${r.configFile}|${r.location}|${i}`} className="border-t" style={{ borderColor: 'var(--border-subtle)' }}>
                    <td className="px-3 py-1.5 font-medium" style={{ color: 'var(--text-primary)' }}>{r.host}</td>
                    <td className="px-3 py-1.5 text-[11px]" style={{ color: 'var(--text-muted)' }}>{r.env}</td>
                    <td className="px-3 py-1.5 text-[11px]" style={{ color: 'var(--text-secondary)' }}>{r.configFile}</td>
                    <td className="px-3 py-1.5 text-[11px] break-all" style={{ color: 'var(--text-secondary)' }}>{r.location}</td>
                    <td className="px-3 py-1.5 text-[11px] tabular-nums">{r.ipLimit || '—'}</td>
                    <td className="px-3 py-1.5 text-[11px] tabular-nums">{r.serverLimit || '—'}</td>
                    <td className="px-3 py-1.5">
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium"
                        style={{ color: d.color, background: d.bg, border: `1px solid ${d.color}` }}>
                        {r.state === 'yok' && <ShieldExclamationIcon className="h-3.5 w-3.5" />}
                        {d.label}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
        <b>server (miras)</b>: limit location'da değil <b>server bloğunda</b> tanımlı; nginx onu bu location'a da uygular.
        Location'ında satır görmemek limitsiz olduğunuz anlamına gelmez.
        Kaynak: <code>dbo.NginxRateLimitInventory</code> · tarama: {data?.scanDate || '—'}
      </p>
    </div>
  );
}

function Kpi({ title, value, tone }: { title: string; value: number; tone?: 'ok' | 'danger' }) {
  const color = tone === 'danger' ? 'var(--status-danger)' : tone === 'ok' ? 'var(--status-success)' : 'var(--text-primary)';
  return (
    <section className="rounded-xl border p-3" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-surface)' }}>
      <div className="text-[11px] uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>{title}</div>
      <div className="text-2xl font-semibold tabular-nums mt-0.5" style={{ color }}>{value}</div>
    </section>
  );
}

export default RateLimitTab;
