// src/components/nginx_console/OrphansTab.tsx — Nginx Hub "Kullanılmayan" (2026-09-22).
//
// Kullanici: "sertifikaya bakiyorum, hicbir konfigurasyonda kullanilmiyor ama listede." Cunku dokum
// conf.d/conf altindaki HER dosyayi alir; nginx'in gercekten yukledigine (nginx -T) bakmiyordu.
// Dump artik @@LOADED (nginx -T'nin yukledigi dosyalar) ve @@SSLDIR yazar; sunucu tarafi
// (dump-parse.orphansOf) su uc kumeyi cikarir:
//   1) nginx'in YUKLEMEDIGI conf dosyalari (yedek kalibi ayri: <conf>_<job>, .bak/.old, .console_backup/)
//   2) yalniz yuklenmeyen dosyada gecen (ya da hic gecmeyen) sertifikalar
//   3) ssl/ altinda hicbir conf'un referans vermedigi dosyalar (anahtarlar dahil - icerik okunmaz)
// Hicbir sey SILINMEZ; sayfa yalniz gosterir. Eski dokumda @@LOADED yok -> sunucu "belirlenemedi".
import React, { useCallback, useMemo, useState } from 'react';
import { ArrowPathIcon, MagnifyingGlassIcon, ChevronDownIcon, ChevronRightIcon } from '@heroicons/react/24/outline';
import { useAsyncEffect } from '@/hooks/useAsyncEffect';
import { TableEmptyRow } from '@/components/common/EmptyState';
import { Pill } from '@/components/denetim/ui';
import { fmtNumber } from '@/utils/datetime';
import { nginxConsoleApi, type NcOrphansResult, type NcOrphanHost } from '@/api/nginxConsoleApi';

type Kind = 'all' | 'unloaded' | 'backups' | 'certs' | 'ssl' | 'unknown';

function Tile({ n, l, tone, active, onClick }: { n: number; l: string; tone?: 'danger' | 'warning'; active?: boolean; onClick?: () => void }) {
  return (
    <button onClick={onClick} className={`rounded-xl border p-3 text-left ${active ? 'shadow-sm' : ''}`} style={{ borderColor: active ? 'var(--accent)' : 'var(--border-subtle)', background: 'var(--bg-surface)' }}>
      <div className="text-2xl font-semibold tabular-nums" style={{ color: tone === 'danger' && n > 0 ? 'var(--status-danger)' : tone === 'warning' && n > 0 ? 'var(--status-warning)' : undefined }}>{fmtNumber(n)}</div>
      <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>{l}</div>
    </button>
  );
}

const fmtKb = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : n >= 1024 ? `${Math.round(n / 1024)} KB` : `${n} B`);

function countOf(h: NcOrphanHost, kind: Kind): number {
  if (kind === 'unloaded') return h.unloaded.length;
  if (kind === 'backups') return h.backups.length;
  if (kind === 'certs') return h.certs.length;
  if (kind === 'ssl') return h.ssl.length;
  if (kind === 'unknown') return h.known ? 0 : 1;
  return h.unloaded.length + h.backups.length + h.certs.length + h.ssl.length + (h.known ? 0 : 1);
}

export function OrphansTab({ onOpen }: { onOpen: (host: string) => void }) {
  const [data, setData] = useState<NcOrphansResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [kind, setKind] = useState<Kind>('all');
  const [open, setOpen] = useState<Set<string>>(new Set());
  const load = useCallback(async () => { setLoading(true); try { setData(await nginxConsoleApi.orphans()); } finally { setLoading(false); } }, []);
  useAsyncEffect(async () => { await load(); }, [load]);

  const rows = useMemo(() => {
    if (!data) return [];
    const needle = q.trim().toLowerCase();
    return data.hosts.filter((h) => {
      if (countOf(h, kind) === 0) return false;
      if (!needle) return true;
      return [h.host, ...h.unloaded.map((f) => f.path), ...h.backups.map((f) => f.path), ...h.certs.map((c) => `${c.path} ${c.cn || ''}`), ...h.ssl.map((f) => f.path)].some((x) => String(x || '').toLowerCase().includes(needle));
    });
  }, [data, q, kind]);
  const toggle = (host: string) => { const s = new Set(open); s.has(host) ? s.delete(host) : s.add(host); setOpen(s); };

  const csv = () => {
    const head = ['sunucu', 'tur', 'yol', 'boyut', 'mtime', 'not'];
    const body: (string | number)[][] = [];
    for (const h of rows) {
      for (const f of h.unloaded) body.push([h.host, 'yuklenmeyen_conf', f.path, f.size, f.mtime || '', '']);
      for (const f of h.backups) body.push([h.host, 'yedek', f.path, f.size, f.mtime || '', '']);
      for (const c of h.certs) body.push([h.host, 'kullanilmayan_sertifika', c.path, '', c.notAfter ? c.notAfter.slice(0, 10) : '', `${c.cn || ''} ${c.usedBy.length ? 'yalniz: ' + c.usedBy.join(' ') : 'hic referans yok'}`]);
      for (const f of h.ssl) body.push([h.host, f.isKey ? 'referanssiz_anahtar' : 'referanssiz_ssl_dosyasi', f.path, f.size, f.mtime || '', '']);
    }
    const text = [head, ...body].map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(';')).join('\n');
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['﻿' + text], { type: 'text/csv;charset=utf-8' })); a.download = `nginx_kullanilmayan_${new Date().toISOString().slice(0, 10)}.csv`; a.click();
  };

  return (
    <div className="space-y-3">
      {data && (
        <div className="grid gap-3 md:grid-cols-6">
          <Tile n={data.summary.hostsScanned} l="taranan sunucu" active={kind === 'all'} onClick={() => setKind('all')} />
          <Tile n={data.summary.unloaded} l="nginx'in yüklemediği conf" tone="warning" active={kind === 'unloaded'} onClick={() => setKind('unloaded')} />
          <Tile n={data.summary.backups} l="yedek / eski kopya" active={kind === 'backups'} onClick={() => setKind('backups')} />
          <Tile n={data.summary.certs} l="kullanılmayan sertifika" tone="warning" active={kind === 'certs'} onClick={() => setKind('certs')} />
          <Tile n={data.summary.ssl} l="referanssız ssl/ dosyası" active={kind === 'ssl'} onClick={() => setKind('ssl')} />
          <Tile n={data.summary.hostsUnknown} l="belirlenemedi (eski dokum)" tone="danger" active={kind === 'unknown'} onClick={() => setKind('unknown')} />
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <MagnifyingGlassIcon className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-muted)' }} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="sunucu / dosya yolu / CN" className="pl-8 pr-2 py-1.5 text-xs border rounded-lg w-80" style={{ borderColor: 'var(--border)' }} />
        </div>
        <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{rows.length} sunucu</span>
        <div className="ml-auto flex gap-2">
          <button onClick={csv} className="px-2.5 py-1.5 text-xs border rounded-lg" style={{ borderColor: 'var(--border)' }}>CSV</button>
          <button onClick={load} className="px-2.5 py-1.5 text-xs border rounded-lg" style={{ borderColor: 'var(--border)' }}><ArrowPathIcon className={`w-3.5 h-3.5 inline ${loading ? 'animate-spin' : ''}`} /> Yenile</button>
        </div>
      </div>
      <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
        Kaynak: sunucunun son dokumu. "Yüklenmeyen" = <code>conf.d</code>/<code>conf</code> altında duruyor ama <code>nginx -T</code> çıktısında yok (include edilmiyor). Yedek kalıbı: <code>&lt;conf&gt;_&lt;job&gt;</code> (deployment yedeği), <code>.bak/.old</code>, <code>.console_backup/</code>. Sertifika: yalnız yüklenmeyen dosyada geçiyor ya da hiç geçmiyor. Sayfa hiçbir şeyi silmez.
      </div>
      <div className="overflow-x-auto rounded-xl border" style={{ borderColor: 'var(--border-subtle)' }}>
        <table className="w-full text-xs">
          <thead><tr className="text-left" style={{ background: 'var(--bg-elevated)', color: 'var(--text-muted)' }}>
            <th className="px-3 py-2 w-6" />
            <th className="px-3 py-2">Sunucu</th><th className="px-3 py-2 text-right">Yüklenmeyen</th><th className="px-3 py-2 text-right">Yedek</th><th className="px-3 py-2 text-right">Sertifika</th><th className="px-3 py-2 text-right">ssl/ referanssız</th><th className="px-3 py-2">Durum</th>
          </tr></thead>
          <tbody>
            {rows.map((h) => (
              <React.Fragment key={h.host}>
                <tr onClick={() => toggle(h.host)} className="border-t cursor-pointer hover:bg-[var(--bg-elevated)]" style={{ borderColor: 'var(--border-subtle)' }}>
                  <td className="px-3 py-1.5">{open.has(h.host) ? <ChevronDownIcon className="w-3.5 h-3.5" /> : <ChevronRightIcon className="w-3.5 h-3.5" />}</td>
                  <td className="px-3 py-1.5"><button className="underline font-medium" style={{ color: 'var(--accent)' }} onClick={(e) => { e.stopPropagation(); onOpen(h.host); }}>{h.host.toLowerCase()}</button></td>
                  <td className="px-3 py-1.5 text-right tabular-nums" style={{ color: h.unloaded.length ? 'var(--status-warning)' : undefined }}>{h.known ? h.unloaded.length : '—'}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{h.known ? h.backups.length : '—'}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums" style={{ color: h.certs.length ? 'var(--status-warning)' : undefined }}>{h.known ? h.certs.length : '—'}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{h.known ? h.ssl.length : '—'}</td>
                  <td className="px-3 py-1.5">{h.known ? <Pill tone="success">nginx -T ile ayrıldı</Pill> : <Pill tone="danger">{h.reason || 'belirlenemedi'}</Pill>}</td>
                </tr>
                {open.has(h.host) && h.known && (
                  <tr className="border-t" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-elevated)' }}>
                    <td colSpan={7} className="px-4 py-3">
                      <div className="grid gap-4 lg:grid-cols-2">
                        <Section title={`nginx'in yüklemediği conf dosyaları (${h.unloaded.length})`} empty="Yüklenmeyen dosya yok.">
                          {h.unloaded.map((f) => <FileRow key={f.path} path={f.path} size={f.size} mtime={f.mtime} owner={f.owner} />)}
                        </Section>
                        <Section title={`Yedek / eski kopya (${h.backups.length})`} empty="Yedek dosya yok.">
                          {h.backups.map((f) => <FileRow key={f.path} path={f.path} size={f.size} mtime={f.mtime} owner={f.owner} />)}
                        </Section>
                        <Section title={`Kullanılmayan sertifikalar (${h.certs.length})`} empty="Her sertifika yüklü bir conf'ta kullanılıyor.">
                          {h.certs.map((c) => (
                            <div key={c.path} className="flex items-start gap-2 py-1 border-t" style={{ borderColor: 'var(--border-subtle)' }}>
                              <div className="min-w-0 flex-1">
                                <div className="font-semibold truncate" title={c.cn || c.path}>{c.cn || (c.exists ? c.path.split('/').pop() : 'DOSYA YOK')}</div>
                                <div className="font-mono text-[10px] truncate" title={c.path} style={{ color: 'var(--text-muted)' }}>{c.path}</div>
                                <div className="text-[10px]" style={{ color: 'var(--text-muted)' }}>{c.usedBy.length ? <>yalnız yüklenmeyen dosyada: <span className="font-mono">{c.usedBy.map((p) => p.split('/').pop()).join(', ')}</span></> : 'hiçbir conf referans vermiyor'}</div>
                              </div>
                              <Pill tone={c.daysLeft == null ? 'neutral' : c.daysLeft < 0 ? 'danger' : c.daysLeft <= 30 ? 'warning' : 'success'}>{c.daysLeft == null ? (c.exists ? '?' : 'dosya yok') : c.daysLeft < 0 ? `${-c.daysLeft} gün önce doldu` : `${c.daysLeft} gün`}</Pill>
                            </div>
                          ))}
                        </Section>
                        <Section title={`ssl/ altında referanssız dosyalar (${h.ssl.length})`} empty="ssl/ altında referanssız dosya yok.">
                          {h.ssl.map((f) => <FileRow key={f.path} path={f.path} size={f.size} mtime={f.mtime} tag={f.isKey ? 'anahtar' : undefined} />)}
                        </Section>
                      </div>
                    </td>
                  </tr>
                )}
              </React.Fragment>
            ))}
            {!loading && rows.length === 0 && <TableEmptyRow colSpan={7} title={data?.summary.hostsScanned ? 'Süzgeçle eşleşen sunucu yok.' : 'Henüz dokum yok.'} description={data?.summary.hostsScanned ? 'Bu kümede kullanılmayan dosya bulunmadı.' : 'Instances sekmesinden sunucuları yenileyin.'} />}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Section({ title, empty, children }: { title: string; empty: string; children: React.ReactNode[] }) {
  return (
    <div className="rounded-lg border p-3" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-surface)' }}>
      <div className="font-semibold mb-1">{title}</div>
      <div className="max-h-64 overflow-auto">{children.length ? children : <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>{empty}</div>}</div>
    </div>
  );
}
function FileRow({ path, size, mtime, owner, tag }: { path: string; size: number; mtime: string | null; owner?: string | null; tag?: string }) {
  return (
    <div className="flex items-center gap-2 py-1 border-t font-mono text-[11px]" style={{ borderColor: 'var(--border-subtle)' }}>
      <div className="truncate flex-1" title={path}>{path}</div>
      {tag && <Pill tone="neutral">{tag}</Pill>}
      <span className="tabular-nums" style={{ color: 'var(--text-muted)' }}>{fmtKb(size)}</span>
      <span className="tabular-nums" style={{ color: 'var(--text-muted)' }} title={mtime || ''}>{mtime ? mtime.slice(0, 10) : ''}</span>
      {owner && <span style={{ color: 'var(--text-muted)' }}>{owner}</span>}
    </div>
  );
}
