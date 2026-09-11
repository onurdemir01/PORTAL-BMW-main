// src/components/denetim/NginxLegacy.tsx — "Nginx Legacy (PROD)".
//
// ESKI TIP prod nginx sunuculari: tanimlar SPA include deseniyle degil
//   location X { proxy_pass https://<upstream>; }
//   upstream <ad> { server <fqdn>:443 resolve; keepalive 10; zone ...; }
// seklinde kurulu ve upstream'ler cogunlukla AYRI bir dosyada
// (<service>-<env>-upstreams.conf).
//
// TANE SERVIS'TIR, location degil: sorulan sorular servis duzeyinde ("kac location
// var, kaci upstream kullaniyor, upstream'lerin kacinda resolve yok, eslenik
// sunucuyla farki ne"). Her satir bir servis; acilinca sunucu kirilimini verir.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowDownTrayIcon, ArrowPathIcon, MagnifyingGlassIcon } from '@heroicons/react/24/outline';
import {
  denetimApi,
  type NginxLegacyResult,
  type NginxLegacyService,
} from '@/api/denetimApi';
import { Panel, StatTile, Pill, TableShell, Th, Td, Code, Note } from './ui';

const nf = (n: number) => new Intl.NumberFormat('tr-TR').format(n);

function csvDownload(name: string, header: string[], rows: (string | number)[][]) {
  const esc = (v: string | number) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const csv = [header, ...rows].map((r) => r.map(esc).join(';')).join('\r\n');
  const url = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `${name}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export function NginxLegacy() {
  const [data, setData] = useState<NginxLegacyResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [q, setQ] = useState('');
  const [onlyProblem, setOnlyProblem] = useState(false);
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await denetimApi.nginxLegacy();
      if (r.ok) {
        setData(r);
        setErr('');
      } else setErr(r.message || 'Veri alınamadı.');
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  // Ilk yukleme effect ICINDE kurulur (React 19 set-state-in-effect kurali):
  // ilk ifade `await`, yani hicbir setState senkron degil. `load` Yenile dugmesi
  // icin duruyor - olay isleyicisinde setState tamamen mesru.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await denetimApi.nginxLegacy();
        if (!alive) return;
        if (r.ok) {
          setData(r);
          setErr('');
        } else setErr(r.message || 'Veri alınamadı.');
      } catch (e: unknown) {
        if (alive) setErr(e instanceof Error ? e.message : String(e));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const rows = useMemo(() => {
    if (!data) return [];
    const needle = q.trim().toLowerCase();
    return data.services.filter((s) => {
      if (needle && !s.service.toLowerCase().includes(needle)) return false;
      if (onlyProblem && s.findings === 0 && s.consistent) return false;
      return true;
    });
  }, [data, q, onlyProblem]);

  if (loading && !data)
    return <div className="py-10 text-center text-sm text-[var(--text-muted)]">Yükleniyor…</div>;
  if (err)
    return (
      <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-xl px-3 py-2">
        {err}
      </div>
    );
  if (!data) return null;

  if (!data.schemaReady) {
    return (
      <Note tone="warning" title="Legacy denetimi henüz açık değil">
        Bu görünüm <Code>dbo.Nginx_Legacy_Audit</Code> ve <Code>dbo.Nginx_Legacy_Findings</Code>{' '}
        tablolarını kullanır; henüz yoklar. Tek seferlik DDL:{' '}
        <Code>bmw_nginx/nginx_legacy_audit/files/nginx_legacy_audit_schema.sql</Code>.
        Çalıştırıldıktan sonra <Code>nginx_legacy_audit</Code> job&apos;ının ilk koşusunda burası
        dolar. <b>Diğer ekranlar etkilenmez.</b>
      </Note>
    );
  }

  if (!data.scanDate) {
    return (
      <Note tone="info" title="Henüz tarama kaydı yok">
        Şema hazır ancak <Code>nginx_legacy_audit</Code> job&apos;ı henüz çalışmamış. Bir
        koşudan sonra burası dolar.
      </Note>
    );
  }

  const t = data.totals;

  return (
    <div className="space-y-3">
      <Note tone="info" title="Bu ekran ne gösteriyor?">
        Eski tip production nginx sunucuları (<Code>GBRVPP*</Code> / <Code>GBRVPAP*</Code>).
        Burada SPA include deseni <b>yoktur</b>; tanımlar{' '}
        <Code>location … &#123; proxy_pass https://&lt;upstream&gt;; &#125;</Code> ve upstream
        blokları çoğunlukla ayrı bir dosyadadır. Her satır bir <b>servis</b>; açınca sunucu
        kırılımını ve bulguları verir.
        <div className="mt-1.5">
          <b>Sayılar toplanmaz, en yüksek sunucudan alınır.</b> Aynı tanım her eşlenik sunucuda
          tekrar ettiği için toplamak, sunucu adedi kadar şişirilmiş bir sayı üretirdi.
        </div>
      </Note>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="servis" value={nf(t?.services || 0)} hint={`${nf(t?.hosts || 0)} sunucu`} />
        <StatTile
          label="location / upstream"
          value={`${nf(t?.locations || 0)} / ${nf(t?.upstreams || 0)}`}
        />
        <StatTile
          label="upstream katmanını atlayan"
          value={nf(t?.proxyWithoutUpstream || 0)}
          tone={t?.proxyWithoutUpstream ? 'danger' : 'neutral'}
          hint="proxy_pass hedefi tanımlı bir upstream değil — doğrudan DNS adına gidiyor"
        />
        <StatTile
          label="eşlenikler arasında fark"
          value={nf(t?.inconsistent || 0)}
          tone={t?.inconsistent ? 'danger' : 'neutral'}
          hint="aynı grubun sunucuları aynı sayıları taşımıyor"
        />
      </div>

      {data.byType.length > 0 && (
        <Panel title="Bulgu türleri" dense>
          <div className="flex flex-wrap gap-1.5 px-3 py-2">
            {data.byType.map((b) => (
              <span
                key={b.type}
                title={b.type}
                className={`text-[11px] px-2 py-0.5 rounded border tabular-nums ${
                  b.severity <= 1
                    ? 'bg-red-50 text-red-700 border-red-200'
                    : b.severity === 2
                      ? 'bg-amber-50 text-amber-700 border-amber-200'
                      : 'bg-[var(--bg-elevated)] text-[var(--text-muted)] border-[var(--border)]'
                }`}
              >
                {b.label}: {nf(b.count)}
              </span>
            ))}
          </div>
        </Panel>
      )}

      <Panel
        title="Servisler"
        description={`${nf(rows.length)} servis gösteriliyor · tarama ${data.scanDate}`}
        actions={
          <div className="flex items-center gap-2">
            <div className="relative">
              <MagnifyingGlassIcon className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="servis ara"
                className="pl-8 pr-2.5 py-1.5 text-xs border border-[var(--border)] rounded-lg w-48"
              />
            </div>
            <label className="flex items-center gap-1.5 text-xs text-[var(--text-secondary)] cursor-pointer whitespace-nowrap">
              <input
                type="checkbox"
                checked={onlyProblem}
                onChange={(e) => setOnlyProblem(e.target.checked)}
              />
              Sadece bulgulular
            </label>
            <button
              onClick={() =>
                csvDownload(
                  'nginx_legacy_' + (data.scanDate || ''),
                  [
                    'servis',
                    'grup',
                    'sunucu',
                    'location',
                    'location_proxy',
                    'upstream',
                    'upstream_ana_dosyada',
                    'upstream_atlayan',
                    'kullanilmayan_upstream',
                    'resolve_yok',
                    'keepalive_yok',
                    'zone_yok',
                    'tutarli',
                    'bulgu',
                  ],
                  rows.map((s) => [
                    s.service,
                    s.peerGroup,
                    s.hostCount,
                    s.locationsTotal,
                    s.locationsProxy,
                    s.upstreamsTotal,
                    s.upstreamsInVhost,
                    s.proxyWithoutUpstream,
                    s.unusedUpstreams,
                    s.upsNoResolve,
                    s.upsNoKeepalive,
                    s.upsNoZone,
                    s.consistent ? 'EVET' : 'HAYIR',
                    s.findings,
                  ]),
                )
              }
              className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs border border-[var(--border)] rounded-lg hover:bg-[var(--bg-elevated)]"
            >
              <ArrowDownTrayIcon className="w-3.5 h-3.5" /> CSV
            </button>
            <button
              onClick={load}
              className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs border border-[var(--border)] rounded-lg hover:bg-[var(--bg-elevated)]"
            >
              <ArrowPathIcon className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /> Yenile
            </button>
          </div>
        }
        dense
      >
        <TableShell maxHeight="36rem">
          <thead>
            <tr>
              <Th>Servis</Th>
              <Th>Grup</Th>
              <Th align="right">Sunucu</Th>
              <Th align="right">Location</Th>
              <Th align="right">Upstream</Th>
              <Th align="right">Ana dosyada</Th>
              <Th align="right">Atlayan</Th>
              <Th align="right">Kullanılmayan</Th>
              <Th>Eşlenikler</Th>
              <Th align="right">Bulgu</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((s) => (
              <LegacyRow key={s.service} s={s} open={open === s.service} onToggle={() =>
                setOpen(open === s.service ? null : s.service)} />
            ))}
          </tbody>
        </TableShell>
      </Panel>
    </div>
  );
}

function LegacyRow({
  s,
  open,
  onToggle,
}: {
  s: NginxLegacyService;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <>
      <tr
        className="hover:bg-[var(--bg-elevated)]/60 cursor-pointer"
        onClick={onToggle}
        title="Sunucu kırılımı ve bulgular için tıklayın"
      >
        <Td className="whitespace-nowrap font-medium">{s.service}</Td>
        <Td className="whitespace-nowrap">{s.peerGroup}</Td>
        <Td align="right" className="tabular-nums">
          {nf(s.hostCount)}
        </Td>
        <Td align="right" className="tabular-nums" title={`${nf(s.locationsProxy)} tanesi proxy`}>
          {nf(s.locationsTotal)}
        </Td>
        <Td align="right" className="tabular-nums">
          {nf(s.upstreamsTotal)}
        </Td>
        <Td align="right" className="tabular-nums">
          {s.upstreamsInVhost ? nf(s.upstreamsInVhost) : <span className="text-[var(--text-muted)]">—</span>}
        </Td>
        <Td align="right" className="tabular-nums">
          {s.proxyWithoutUpstream ? (
            <span className="text-red-600 font-semibold">{nf(s.proxyWithoutUpstream)}</span>
          ) : (
            <span className="text-[var(--text-muted)]">—</span>
          )}
        </Td>
        <Td align="right" className="tabular-nums">
          {s.unusedUpstreams ? nf(s.unusedUpstreams) : <span className="text-[var(--text-muted)]">—</span>}
        </Td>
        <Td>
          {s.consistent ? (
            <Pill tone="success">aynı</Pill>
          ) : (
            <Pill tone="danger">farklı</Pill>
          )}
        </Td>
        <Td align="right" className="tabular-nums">
          {s.findings ? nf(s.findings) : <span className="text-[var(--text-muted)]">—</span>}
        </Td>
      </tr>
      {open && (
        <tr>
          <td colSpan={10} className="px-3 py-3 bg-[var(--bg-elevated)]/40">
            {/* Sunucu kirilimi: farkin HANGI sunucuda oldugu ancak burada gorunur. */}
            <div className="overflow-x-auto">
              <table className="text-[11px] w-full">
                <thead>
                  <tr className="text-[var(--text-muted)]">
                    <th className="text-left pr-4 pb-1">Sunucu</th>
                    <th className="text-left pr-4 pb-1">Dosyalar</th>
                    <th className="text-right pr-4 pb-1">location</th>
                    <th className="text-right pr-4 pb-1">proxy</th>
                    <th className="text-right pr-4 pb-1">diğer</th>
                    <th className="text-right pr-4 pb-1">upstream</th>
                    <th className="text-right pr-4 pb-1">resolve yok</th>
                    <th className="text-right pr-4 pb-1">keepalive yok</th>
                    <th className="text-right pb-1">zone yok</th>
                  </tr>
                </thead>
                <tbody>
                  {s.hosts.map((h) => (
                    <tr key={h.host} className="border-t border-[var(--border-subtle)]">
                      <td className="pr-4 py-1 font-mono whitespace-nowrap">{h.host}</td>
                      <td className="pr-4 py-1 font-mono text-[var(--text-muted)] whitespace-nowrap">
                        {[h.vhostFiles, h.upstreamFiles].filter(Boolean).join(' + ') || '—'}
                      </td>
                      <td className="pr-4 py-1 text-right tabular-nums">{nf(h.locationsTotal)}</td>
                      <td className="pr-4 py-1 text-right tabular-nums">{nf(h.locationsProxy)}</td>
                      <td className="pr-4 py-1 text-right tabular-nums">{nf(h.locationsOther)}</td>
                      <td className="pr-4 py-1 text-right tabular-nums">{nf(h.upstreamsTotal)}</td>
                      <td className="pr-4 py-1 text-right tabular-nums">{nf(h.upsNoResolve)}</td>
                      <td className="pr-4 py-1 text-right tabular-nums">{nf(h.upsNoKeepalive)}</td>
                      <td className="py-1 text-right tabular-nums">{nf(h.upsNoZone)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {s.hosts.some((h) => h.findings.length > 0) && (
              <div className="mt-3 space-y-2">
                {s.hosts
                  .filter((h) => h.findings.length > 0)
                  .map((h) => (
                    <div key={h.host}>
                      <div className="text-[11px] font-semibold text-[var(--text-secondary)] mb-1">
                        {h.host} — {nf(h.findings.length)} bulgu
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {h.findings.slice(0, 60).map((f, i) => (
                          <span
                            key={h.host + i}
                            title={`${f.label}${f.detail ? ' · ' + f.detail : ''}`}
                            className={`text-[10px] px-1.5 py-0.5 rounded border font-mono ${
                              f.severity <= 1
                                ? 'bg-red-50 text-red-700 border-red-200'
                                : f.severity === 2
                                  ? 'bg-amber-50 text-amber-700 border-amber-200'
                                  : 'bg-[var(--bg-surface)] text-[var(--text-muted)] border-[var(--border)]'
                            }`}
                          >
                            {f.item}
                          </span>
                        ))}
                        {h.findings.length > 60 && (
                          <span className="text-[10px] text-[var(--text-muted)]">
                            +{nf(h.findings.length - 60)} tane daha
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
              </div>
            )}
          </td>
        </tr>
      )}
    </>
  );
}
