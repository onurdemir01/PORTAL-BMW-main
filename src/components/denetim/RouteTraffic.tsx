// src/components/denetim/RouteTraffic.tsx — "Denetim > Route Trafiği" (2026-09-21).
//
// Kullanici: "SPA uygulamalari var ama kullaniliyor mu? atil mi, emekli mi olmus? ...
// intranet uygulamalarin yasayip yasamadigini ancak route metrikleriyle anlariz."
// Kaynak: route_traffic job'i (Thanos, OCP router sayaclari) -> BMW_Openshift_Route_Traffic;
// siniflama sunucuda (server/audit/route-traffic.cjs). Burasi yalnizca gosterir/suzer.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { LoadingLogo } from '@/components/common/LoadingLogo';
import {
  ArrowPathIcon, ArrowDownTrayIcon, MagnifyingGlassIcon, SignalIcon, SignalSlashIcon,
  QuestionMarkCircleIcon, MoonIcon,
} from '@heroicons/react/24/outline';
import { denetimApi, type RouteTrafficResult, type RouteTrafficRow, type RouteTrafficStatus } from '@/api/denetimApi';
import { Select } from '@/components/ui/Form';
import { fmtNumber, fmtDate } from '@/utils/datetime';
import { TableEmptyRow } from '@/components/common/EmptyState';
import { StatTile, Pill, TableShell, Th, Td, Note, type Tone } from '@/components/denetim/ui';
import { downloadCsv as csvDownload } from '@/utils/csv';

const nf = (n: number) => fmtNumber(n);

const STATUS: Record<RouteTrafficStatus, { label: string; tone: Tone; icon: React.ComponentType<{ className?: string }>; hint: string }> = {
  active: { label: 'aktif', tone: 'success', icon: SignalIcon, hint: 'son 30 günde istek var' },
  silent: { label: 'atıl aday', tone: 'warning', icon: MoonIcon, hint: '30 gündür istek yok, 90 gün içinde vardı' },
  dead: { label: 'emekli aday', tone: 'danger', icon: SignalSlashIcon, hint: '90 gündür (ya da verinin tamamında) hiç istek yok' },
  nodata: { label: 'veri yok', tone: 'neutral', icon: QuestionMarkCircleIcon, hint: 'envanterde var, router sayacında hiç görünmedi' },
};


export default function RouteTraffic() {
  const [data, setData] = useState<RouteTrafficResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [q, setQ] = useState('');
  const [env, setEnv] = useState('all');
  const [kind, setKind] = useState<'all' | 'spa' | 'nonspa'>('all');
  const [status, setStatus] = useState<'all' | RouteTrafficStatus | 'problem'>('all');

  const load = useCallback(async (fresh = false) => {
    setLoading(true);
    try {
      const r = await denetimApi.routeTraffic(fresh);
      if (r.ok) { setData(r); setErr(''); } else setErr(r.message || 'Veri alınamadı.');
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const envs = useMemo(() => {
    const s = new Set<string>();
    for (const r of data?.rows || []) if (r.env) s.add(r.env);
    return [...s].sort();
  }, [data]);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (data?.rows || []).filter((r) => {
      if (env !== 'all' && (r.env || '') !== env) return false;
      if (kind === 'spa' && !r.spa) return false;
      if (kind === 'nonspa' && r.spa) return false;
      if (status === 'problem' ? !(r.status === 'silent' || r.status === 'dead') : status !== 'all' && r.status !== status) return false;
      if (needle && !(r.namespace.toLowerCase().includes(needle) || r.route.toLowerCase().includes(needle) || r.address.toLowerCase().includes(needle))) return false;
      return true;
    });
  }, [data, q, env, kind, status]);

  if (loading && !data) return <LoadingLogo />;
  if (err) return <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-xl px-3 py-2">{err}</div>;
  if (!data) return null;

  const s = data.summary;
  const coverageShort = data.daysCovered > 0 && data.daysCovered < data.deadDays;

  return (
    <div className="space-y-3">
      {data.tableMissing && (
        <Note tone="warning">{data.message}</Note>
      )}
      {coverageShort && (
        <Note tone="info">
          Veri şimdilik <b>{data.daysCovered} gün</b> kapsıyor ({data.earliestScan ? fmtDate(data.earliestScan) : '?'} – {data.latestScan ? fmtDate(data.latestScan) : '?'}).
          "Emekli aday" hükmü {data.deadDays} günlük sessizlik ister; job günlük koştukça kesinleşir. Şimdilik "bu {data.daysCovered} günde hiç istek almadı" diye okuyun.
        </Note>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <StatTile label="route" value={nf(s.routes)} hint="envanter ∪ trafik tablosu" />
        <StatTile label="aktif" value={nf(s.active)} tone="success" icon={SignalIcon} hint={STATUS.active.hint} />
        <StatTile label="atıl aday" value={nf(s.silent)} tone="warning" icon={MoonIcon} hint={STATUS.silent.hint} />
        <StatTile label="emekli aday" value={nf(s.dead)} tone="danger" icon={SignalSlashIcon} hint={STATUS.dead.hint} />
        <StatTile label="SPA — sessiz" value={`${nf(s.spaDead)} / ${nf(s.spa)}`} tone={s.spaDead ? 'warning' : 'neutral'} hint="atıl ya da emekli aday SPA / tüm SPA route'ları" />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <MagnifyingGlassIcon className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
          <input
            value={q} onChange={(e) => setQ(e.target.value)} placeholder="namespace, route ya da adres"
            className="pl-8 pr-2.5 py-1.5 text-xs border border-[var(--border)] rounded-lg w-64"
          />
        </div>
        <Select sizeVariant="sm" value={env} onChange={(e) => setEnv(e.target.value)}>
          <option value="all">tüm ortamlar</option>
          {envs.map((e) => <option key={e} value={e}>{e}</option>)}
        </Select>
        <Select sizeVariant="sm" value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
          <option value="all">SPA + diğer</option>
          <option value="spa">sadece SPA</option>
          <option value="nonspa">SPA olmayan</option>
        </Select>
        <Select sizeVariant="sm" value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
          <option value="all">tüm durumlar</option>
          <option value="problem">sessiz (atıl + emekli aday)</option>
          <option value="active">aktif</option>
          <option value="silent">atıl aday</option>
          <option value="dead">emekli aday</option>
          <option value="nodata">veri yok</option>
        </Select>
        <span className="text-xs text-[var(--text-muted)] tabular-nums">{nf(rows.length)} / {nf(data.rows.length)} route</span>
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={() => csvDownload('route_trafigi',
              ['namespace', 'route', 'adres', 'ortam', 'spa', 'cluster', 'durum', 'son7g', 'son30g', 'son90g', 'gunluk_ort', '4xx_pct', '5xx_pct', 'son_istek', 'son_tarama'],
              rows.map((r) => [r.namespace, r.route, r.address, r.env || '', r.spa ? 'evet' : 'hayır', r.clusters.join(' '), STATUS[r.status].label, r.req7, r.req30, r.req90, r.perDay, r.err4xxPct, r.err5xxPct, r.lastSeen || '', r.lastScan || '']))}
            className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs border border-[var(--border)] rounded-lg hover:bg-[var(--bg-elevated)]"
          >
            <ArrowDownTrayIcon className="w-3.5 h-3.5" /> CSV
          </button>
          <button onClick={() => load(true)} className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs border border-[var(--border)] rounded-lg hover:bg-[var(--bg-elevated)]">
            <ArrowPathIcon className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /> Yenile
          </button>
        </div>
      </div>

      <TableShell maxHeight="40rem">
        <thead className="sticky top-0" style={{ background: 'var(--bg-elevated)' }}>
          <tr>
            <Th>Namespace</Th>
            <Th>Route</Th>
            <Th>Ortam</Th>
            <Th>Durum</Th>
            <Th align="right">7 gün</Th>
            <Th align="right">30 gün</Th>
            <Th align="right">90 gün</Th>
            <Th align="right">gün/ort</Th>
            <Th align="right">4xx</Th>
            <Th align="right">5xx</Th>
            <Th>Son istek</Th>
            <Th>Cluster</Th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <TableEmptyRow colSpan={12} title={data.rows.length ? 'Süzgeçle eşleşen route yok.' : 'Henüz trafik verisi yok.'} description={data.rows.length ? undefined : 'route_traffic job’ı bir kez koşunca burası dolar.'} />
          ) : rows.map((r: RouteTrafficRow) => {
            const st = STATUS[r.status];
            return (
              <tr key={r.namespace + '|' + r.route} className="border-t" style={{ borderColor: 'var(--border-subtle)' }}>
                <Td><span className="font-mono text-[11px]">{r.namespace}</span></Td>
                <Td>
                  <div className="font-medium truncate max-w-[16rem]" title={r.route}>{r.route}</div>
                  {r.address && <div className="text-[10px] font-mono truncate max-w-[16rem]" style={{ color: 'var(--text-muted)' }} title={r.address}>{r.address}</div>}
                </Td>
                <Td>
                  <span className="uppercase text-[10px] font-semibold">{r.env || '—'}</span>
                  {r.spa && <span className="ml-1 text-[10px] px-1 rounded border" style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-muted)' }}>SPA</span>}
                </Td>
                <Td><Pill tone={st.tone} icon={st.icon} title={st.hint}>{st.label}</Pill></Td>
                <Td align="right" className="tabular-nums">{nf(r.req7)}</Td>
                <Td align="right" className="tabular-nums">{nf(r.req30)}</Td>
                <Td align="right" className="tabular-nums">{nf(r.req90)}</Td>
                <Td align="right" className="tabular-nums">{nf(r.perDay)}</Td>
                <Td align="right" className="tabular-nums">{r.req90 ? `${r.err4xxPct}%` : '—'}</Td>
                <Td align="right" className="tabular-nums"><span style={r.err5xxPct >= 5 ? { color: 'var(--status-danger)', fontWeight: 600 } : undefined}>{r.req90 ? `${r.err5xxPct}%` : '—'}</span></Td>
                <Td>{r.lastSeen ? fmtDate(r.lastSeen) : <span style={{ color: 'var(--text-muted)' }}>hiç</span>}</Td>
                <Td><span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>{r.clusters.join(', ') || '—'}</span></Td>
              </tr>
            );
          })}
        </tbody>
      </TableShell>

      <p className="text-[11px] max-w-4xl" style={{ color: 'var(--text-muted)' }}>
        Sayılar OCP router'ının (HAProxy) route başına yanıt sayacından gelir; internet SPA'ları GBNGX'e taşındıkça
        paket doğrudan nginx'ten sunulur ve o route'ların sayacı düşer — bu "atıl" demek değildir (nginx erişim logu sayımı ayrıca planlı).
        4xx/5xx yüzdeleri son {data.deadDays} günün toplamına göredir; %100 4xx alan bir route "trafik var ama uygulama yok" demektir.
      </p>
    </div>
  );
}
