// src/components/denetim/RouteStats.tsx — OpenShift route istatistikleri (Nginx SPA > Internet).
//
// Kullanici (2026-09-14): ortam basina kac route, kaci SPA / SPA-disi; SPA'lar ve
// SPA olmayanlar hangi IP'lere cozuyor. Hesap sunucuda (route-stats.cjs); burada gosterim.
import React, { useEffect, useState } from 'react';
import { denetimApi, type RouteStatsResult, type RouteStatsEnv } from '@/api/denetimApi';
import { Panel, StatTile, Code, Note } from './ui';

const nf = (n: number) => new Intl.NumberFormat('tr-TR').format(n);

export default function RouteStats() {
  const [data, setData] = useState<RouteStatsResult | null>(null);
  const [err, setErr] = useState('');
  const [openIps, setOpenIps] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    denetimApi
      .routeStats('ark')
      .then((r) => {
        if (!alive) return;
        if (r.ok) setData(r);
        else setErr(r.message || 'Route istatistikleri alınamadı.');
      })
      .catch((e: unknown) => alive && setErr(e instanceof Error ? e.message : String(e)));
    return () => {
      alive = false;
    };
  }, []);

  if (err) return <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-xl px-3 py-2">{err}</div>;
  if (!data) return null;
  if (data.routeTableMissing) {
    return (
      <Note tone="warning" title="Route envanteri yok">
        <Code>dbo.BMW_Openshift_Route_Inventory</Code> okunamadı; <Code>route_inventory</Code> job&apos;ı koşmalı.
      </Note>
    );
  }

  return (
    <Panel
      title="OpenShift route istatistikleri (ortam başına)"
      description={
        <>
          Kaynak: <Code>BMW_Openshift_Route_Inventory</Code> (ARK cluster&apos;ları) · ortam namespace son ekinden ·
          SPA = adında <Code>-app-v</Code> / <Code>-app-emb-v</Code> geçen uygulama (route adresinden, olmazsa route adından) ·
          IP = route adresinin nslookup sonucu. Toplam {nf(data.totals.routes)} route
          {data.totals.noEnv ? ` · ${nf(data.totals.noEnv)} route ortamı çözülemeyen namespace'te (sayılmadı)` : ''}.
        </>
      }
      dense
    >
      <div className="p-3 space-y-3">
        <div className="overflow-x-auto">
          <table className="text-[11px] w-full">
            <thead>
              <tr className="text-[var(--text-muted)]">
                <th className="text-left pr-3 pb-1">Ortam</th>
                <th className="text-right pr-3 pb-1">Route</th>
                <th className="text-right pr-3 pb-1">SPA</th>
                <th className="text-right pr-3 pb-1">SPA değil</th>
                <th className="text-right pr-3 pb-1" title="ne adresten ne route adından uygulama adı çıkarılamadı">sınıflanamadı</th>
                <th className="text-right pr-3 pb-1">namespace</th>
                <th className="text-left pr-3 pb-1">termination</th>
                <th className="text-left pr-3 pb-1" title="SPA route'larının çözüldüğü IP'ler (route sayısı)">SPA → IP</th>
                <th className="text-left pb-1" title="SPA olmayan route'ların çözüldüğü IP'ler (route sayısı)">SPA değil → IP</th>
              </tr>
            </thead>
            <tbody>
              {data.envs.map((e) => (
                <React.Fragment key={e.env}>
                  <tr className="border-t border-[var(--border-subtle)]">
                    <td className="pr-3 py-1 font-semibold">{e.env}</td>
                    <td className="pr-3 py-1 text-right tabular-nums">{nf(e.routes)}</td>
                    <td className="pr-3 py-1 text-right tabular-nums text-emerald-700">{nf(e.spa)}</td>
                    <td className="pr-3 py-1 text-right tabular-nums">{nf(e.nonSpa)}</td>
                    <td className="pr-3 py-1 text-right tabular-nums text-[var(--text-muted)]">{e.unclassified ? nf(e.unclassified) : '—'}</td>
                    <td className="pr-3 py-1 text-right tabular-nums">{nf(e.namespaces)}</td>
                    <td className="pr-3 py-1 text-[var(--text-muted)] whitespace-nowrap">{e.terminations.map((t) => `${t.type} ${nf(t.count)}`).join(' · ')}</td>
                    <td className="pr-3 py-1"><IpList ips={e.spaIps} unresolved={e.unresolvedIp.spa} onMore={() => setOpenIps(openIps === e.env + ':spa' ? null : e.env + ':spa')} open={openIps === e.env + ':spa'} /></td>
                    <td className="py-1"><IpList ips={e.nonSpaIps} unresolved={e.unresolvedIp.nonSpa} onMore={() => setOpenIps(openIps === e.env + ':non' ? null : e.env + ':non')} open={openIps === e.env + ':non'} /></td>
                  </tr>
                  {openIps && openIps.startsWith(e.env + ':') && (
                    <tr>
                      <td colSpan={9} className="pb-2">
                        <IpDetail env={e} kind={openIps.endsWith(':spa') ? 'spa' : 'non'} />
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
              {data.envs.length === 0 && (
                <tr><td colSpan={9} className="py-2 text-[var(--text-muted)]">Route kaydı yok.</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="grid gap-2 sm:grid-cols-4">
          <StatTile label="route (tüm ortamlar)" value={nf(data.totals.routes)} />
          <StatTile label="SPA" value={nf(data.totals.spa)} tone="success" />
          <StatTile label="SPA değil" value={nf(data.totals.nonSpa)} />
          <StatTile label="sınıflanamadı" value={nf(data.totals.unclassified)} tone={data.totals.unclassified ? 'warning' : 'neutral'} hint="adres kalıba uymuyor ve route adı boş" />
        </div>
      </div>
    </Panel>
  );
}

function IpList({ ips, unresolved, onMore, open }: { ips: { ip: string; count: number }[]; unresolved: number; onMore: () => void; open: boolean }) {
  const shown = ips.slice(0, 3);
  return (
    <span className="inline-flex flex-wrap gap-1 items-center">
      {shown.map((x) => (
        <span key={x.ip} className="font-mono text-[10px] px-1.5 py-0.5 rounded border" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-elevated)' }}>
          {x.ip} <span className="text-[var(--text-muted)]">×{nf(x.count)}</span>
        </span>
      ))}
      {ips.length === 0 && <span className="text-[var(--text-muted)]">—</span>}
      {unresolved > 0 && <span className="text-[10px] text-amber-700" title="nslookup sonucu boş">çözülmeyen {nf(unresolved)}</span>}
      {ips.length > 0 && (
        <button onClick={onMore} className="text-[10px] underline decoration-dotted text-[var(--text-muted)]">
          {open ? 'gizle' : ips.length > 3 ? `+${ips.length - 3} IP / ayrıntı` : 'ayrıntı'}
        </button>
      )}
    </span>
  );
}

function IpDetail({ env, kind }: { env: RouteStatsEnv; kind: 'spa' | 'non' }) {
  const ips = kind === 'spa' ? env.spaIps : env.nonSpaIps;
  return (
    <div className="rounded-lg border px-3 py-2 text-[11px]" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-elevated)' }}>
      <div className="font-semibold mb-1">{env.env} · {kind === 'spa' ? 'SPA' : 'SPA olmayan'} route&apos;larının IP dağılımı</div>
      <table className="w-full">
        <thead><tr className="text-[var(--text-muted)]"><th className="text-left pr-3">IP</th><th className="text-right pr-3">route</th><th className="text-left">örnek (namespace/uygulama)</th></tr></thead>
        <tbody>
          {ips.map((x) => (
            <tr key={x.ip} className="border-t border-[var(--border-subtle)]">
              <td className="pr-3 py-0.5 font-mono">{x.ip}</td>
              <td className="pr-3 py-0.5 text-right tabular-nums">{nf(x.count)}</td>
              <td className="py-0.5 font-mono text-[var(--text-muted)]">{x.samples.join(', ')}{x.count > x.samples.length ? ' …' : ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
