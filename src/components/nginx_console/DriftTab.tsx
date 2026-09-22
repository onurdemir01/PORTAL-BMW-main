// src/components/nginx_console/DriftTab.tsx — Nginx Hub "Tutarlılık" (2026-09-22).
//
// Kullanici: "GLOMO'nun eski sunucularinda konfigurasyonlarin esit olup olmadigini gormek
// istiyorum." Ayni servis + ortam sunuculari (envanter services/env) arasinda her conf dosyasinin
// sha256'si karsilastirilir (sunucu tarafi: nginx-console/drift.cjs). Satir = dosya; durum:
// farkli (k surum: hangi sunucu hangi surumde, cogunluk ustte) / eksik (bazi sunucularda yok) /
// sunucuya ozel (yolunda host adi ya da yedek kalibi - beklenen). Ayni olanlar sayilir, listelenmez.
import React, { useCallback, useMemo, useState } from 'react';
import { ArrowPathIcon, MagnifyingGlassIcon, ChevronDownIcon, ChevronRightIcon } from '@heroicons/react/24/outline';
import { useAsyncEffect } from '@/hooks/useAsyncEffect';
import { TableEmptyRow } from '@/components/common/EmptyState';
import { Pill } from '@/components/denetim/ui';
import { fmtNumber } from '@/utils/datetime';
import { nginxConsoleApi, type NcDriftResult, type NcDriftGroup, type NcDriftFile } from '@/api/nginxConsoleApi';

const STATUS: Record<NcDriftFile['status'], { label: string; tone: 'danger' | 'warning' | 'neutral' }> = {
  differ: { label: 'farklı', tone: 'danger' }, missing: { label: 'eksik', tone: 'warning' }, local: { label: 'sunucuya özel', tone: 'neutral' }, same: { label: 'aynı', tone: 'neutral' },
};

export function DriftTab({ onOpen }: { onOpen: (host: string) => void }) {
  const [data, setData] = useState<NcDriftResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [service, setService] = useState<string>('');
  const [env, setEnv] = useState<string>('');
  const [q, setQ] = useState('');
  const [showLocal, setShowLocal] = useState(false);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const load = useCallback(async () => { setLoading(true); try { setData(await nginxConsoleApi.drift(service || undefined, env || undefined)); } finally { setLoading(false); } }, [service, env]);
  useAsyncEffect(async () => { await load(); }, [load]);

  const groups = useMemo(() => (data?.groups || []).filter((g) => g.dumped.length >= 2 && (!q || g.service.toLowerCase().includes(q.toLowerCase()) || g.hosts.some((h) => h.toLowerCase().includes(q.toLowerCase())))), [data, q]);
  const skipped = useMemo(() => (data?.groups || []).filter((g) => g.dumped.length < 2), [data]);
  const envs = useMemo(() => [...new Set((data?.groups || []).map((g) => g.env))].sort(), [data]);
  const toggle = (k: string) => { const s = new Set(open); s.has(k) ? s.delete(k) : s.add(k); setOpen(s); };
  const tot = (k: keyof NcDriftGroup['counts']) => groups.reduce((a, g) => a + g.counts[k], 0);

  return (
    <div className="space-y-3">
      <div className="grid gap-3 md:grid-cols-5">
        {([['grup', groups.length, undefined], ['aynı dosya', tot('same'), undefined], ['farklı dosya', tot('differ'), 'danger'], ['eksik dosya', tot('missing'), 'warning'], ['sunucuya özel', tot('local'), undefined]] as const).map(([l, n, tone]) => (
          <div key={l} className="rounded-xl border p-3" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-surface)' }}>
            <div className="text-2xl font-semibold tabular-nums" style={{ color: tone === 'danger' && n > 0 ? 'var(--status-danger)' : tone === 'warning' && n > 0 ? 'var(--status-warning)' : undefined }}>{fmtNumber(n)}</div>
            <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>{l}</div>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <MagnifyingGlassIcon className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-muted)' }} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="servis ya da sunucu" className="pl-8 pr-2 py-1.5 text-xs border rounded-lg w-64" style={{ borderColor: 'var(--border)' }} />
        </div>
        <select value={service} onChange={(e) => setService(e.target.value)} className="h-8 px-2 text-xs border rounded-lg" style={{ borderColor: 'var(--border)', background: 'var(--bg-surface)' }} aria-label="servis">
          <option value="">tüm servisler</option>
          {(data?.services || []).map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={env} onChange={(e) => setEnv(e.target.value)} className="h-8 px-2 text-xs border rounded-lg" style={{ borderColor: 'var(--border)', background: 'var(--bg-surface)' }} aria-label="ortam">
          <option value="">tüm ortamlar</option>
          {envs.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <label className="flex items-center gap-1 text-xs" style={{ color: 'var(--text-secondary)' }}><input type="checkbox" checked={showLocal} onChange={(e) => setShowLocal(e.target.checked)} /> sunucuya özel dosyaları da göster</label>
        <div className="ml-auto"><button onClick={load} className="px-2.5 py-1.5 text-xs border rounded-lg" style={{ borderColor: 'var(--border)' }}><ArrowPathIcon className={`w-3.5 h-3.5 inline ${loading ? 'animate-spin' : ''}`} /> Yenile</button></div>
      </div>
      <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
        Grup = envanterdeki servis + ortam; karşılaştırma yalnız <b>dokumu olan</b> sunucular arasında. "Farklı" = aynı yol, birden fazla sha256 (çoğunluk üstte). "Sunucuya özel" = yolunda sunucu adı geçen ya da yedek kalıbındaki dosyalar (beklenen fark). {skipped.length > 0 && <>{skipped.length} grup tek sunuculu/dokumsuz olduğu için karşılaştırılmadı.</>}
      </div>
      <div className="overflow-x-auto rounded-xl border" style={{ borderColor: 'var(--border-subtle)' }}>
        <table className="w-full text-xs">
          <thead><tr className="text-left" style={{ background: 'var(--bg-elevated)', color: 'var(--text-muted)' }}>
            <th className="px-3 py-2 w-6" /><th className="px-3 py-2">Servis</th><th className="px-3 py-2">Ortam</th><th className="px-3 py-2">Sunucular</th><th className="px-3 py-2 text-right">Aynı</th><th className="px-3 py-2 text-right">Farklı</th><th className="px-3 py-2 text-right">Eksik</th><th className="px-3 py-2 text-right">Özel</th>
          </tr></thead>
          <tbody>
            {groups.map((g) => (
              <React.Fragment key={g.key}>
                <tr onClick={() => toggle(g.key)} className="border-t cursor-pointer hover:bg-[var(--bg-elevated)]" style={{ borderColor: 'var(--border-subtle)' }}>
                  <td className="px-3 py-1.5">{open.has(g.key) ? <ChevronDownIcon className="w-3.5 h-3.5" /> : <ChevronRightIcon className="w-3.5 h-3.5" />}</td>
                  <td className="px-3 py-1.5 font-semibold">{g.service}</td>
                  <td className="px-3 py-1.5">{g.env}</td>
                  <td className="px-3 py-1.5"><div className="truncate max-w-[28rem]" title={g.hosts.join(', ')}>{g.dumped.map((h) => h.toLowerCase()).join(', ')}{g.dumpMissing.length > 0 && <span style={{ color: 'var(--text-muted)' }}> · dokumsuz: {g.dumpMissing.map((h) => h.toLowerCase()).join(', ')}</span>}</div></td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{fmtNumber(g.counts.same)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums font-semibold" style={{ color: g.counts.differ ? 'var(--status-danger)' : undefined }}>{fmtNumber(g.counts.differ)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums" style={{ color: g.counts.missing ? 'var(--status-warning)' : undefined }}>{fmtNumber(g.counts.missing)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums" style={{ color: 'var(--text-muted)' }}>{fmtNumber(g.counts.local)}</td>
                </tr>
                {open.has(g.key) && (
                  <tr className="border-t" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-elevated)' }}>
                    <td colSpan={8} className="px-4 py-3">
                      {g.files.filter((f) => showLocal || f.status !== 'local').length === 0 ? <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>Bu grupta fark yok: {g.counts.same} dosya {g.dumped.length} sunucuda birebir aynı.</div> : (
                        <table className="w-full text-[11px]">
                          <thead><tr className="text-left" style={{ color: 'var(--text-muted)' }}><th className="px-2 py-1">Dosya</th><th className="px-2 py-1">Durum</th><th className="px-2 py-1">Sürümler (çoğunluk üstte) / eksik sunucular</th></tr></thead>
                          <tbody>
                            {g.files.filter((f) => showLocal || f.status !== 'local').map((f) => (
                              <tr key={f.path} className="border-t align-top" style={{ borderColor: 'var(--border-subtle)' }}>
                                <td className="px-2 py-1 font-mono"><div className="truncate max-w-[26rem]" title={f.path}>{f.path}</div></td>
                                <td className="px-2 py-1"><Pill tone={STATUS[f.status].tone}>{STATUS[f.status].label}{f.status === 'differ' ? ` · ${f.variants.length} sürüm` : ''}</Pill></td>
                                <td className="px-2 py-1">
                                  {f.variants.map((v, i) => (
                                    <div key={v.sha || i} className="flex flex-wrap items-center gap-1 py-0.5">
                                      <span className="font-mono text-[10px]" style={{ color: 'var(--text-muted)' }} title={v.sha}>{(v.sha || '?').slice(0, 10)}</span>
                                      {i === 0 && f.variants.length > 1 && <Pill tone="info">çoğunluk</Pill>}
                                      {v.hosts.map((h) => <button key={h} onClick={() => onOpen(h)} className="underline" style={{ color: 'var(--accent)' }}>{h.toLowerCase()}</button>)}
                                      <span style={{ color: 'var(--text-muted)' }}>· {v.size} B{v.mtime ? ` · ${v.mtime.slice(0, 10)}` : ''}</span>
                                    </div>
                                  ))}
                                  {f.missing.length > 0 && <div className="py-0.5" style={{ color: 'var(--status-warning)' }}>yok: {f.missing.map((h) => h.toLowerCase()).join(', ')}</div>}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </td>
                  </tr>
                )}
              </React.Fragment>
            ))}
            {!loading && groups.length === 0 && <TableEmptyRow colSpan={8} title="Karşılaştırılacak grup yok." description="En az iki dokumlu sunucusu olan bir servis+ortam gerekir; Instances'tan dokum alın." />}
          </tbody>
        </table>
      </div>
    </div>
  );
}
