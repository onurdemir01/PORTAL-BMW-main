// src/components/server_hub/ServerHubPage.tsx — Server Hub (2026-09-21).
//
// Kullanici: "sunucu reboot oldugunda her sey dogru acilacak mi ve sunucularda atil bir sey var mi;
// Nginx Hub gibi ama RAPOR gibi gozuksun: once genel durum bar ve yuvarlak grafiklerle".
// Veri: gunluk server_hub_scan (dbo.Server_Hub_*), degerlendirme sunucuda (server/server-hub/assess.cjs).
// Sunucu satiri -> "Simdi tara" (reboot oncesi tek sunucu) ve "Duzelt" (once PLAN, sonra onay).
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ServerStackIcon, ArrowPathIcon, MagnifyingGlassIcon, BoltIcon, WrenchScrewdriverIcon, XMarkIcon,
  ExclamationTriangleIcon, InformationCircleIcon, CheckCircleIcon, ShieldExclamationIcon, ArrowDownTrayIcon,
} from '@heroicons/react/24/outline';
import { serverHubApi, type ShOverview, type ShHostRow, type ShHostDetail, type ShFinding, type ShSeverity } from '@/api/serverHubApi';
import { useJobTracker } from '@/contexts/JobTrackerContext';
import { Modal } from '@/components/common/Modal';
import { TableEmptyRow } from '@/components/common/EmptyState';
import { fmtNumber, fmtDate } from '@/utils/datetime';
import { toast } from '@/hooks/useToast';

const SM_BTN = 'inline-flex items-center gap-1 h-7 px-2.5 text-[11px] font-medium leading-none rounded-lg border whitespace-nowrap disabled:opacity-40';
const smBtn = (primary = false): React.CSSProperties => (primary
  ? { background: 'var(--accent)', borderColor: 'var(--accent)', color: 'var(--accent-fg, #fff)' }
  : { borderColor: 'var(--border)', background: 'var(--bg-surface)', color: 'var(--text-primary)' });
const TERMINAL = new Set(['successful', 'failed', 'error', 'canceled']);
const nf = (n: number | null | undefined) => (n == null ? '—' : fmtNumber(n));

const SEV: Record<ShSeverity, { label: string; color: string; bg: string; icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }> }> = {
  ok: { label: 'sorun yok', color: 'var(--status-success)', bg: 'var(--status-success-bg)', icon: CheckCircleIcon },
  info: { label: 'bilgi', color: 'var(--status-info)', bg: 'var(--status-info-bg)', icon: InformationCircleIcon },
  warning: { label: 'uyarı', color: 'var(--status-warning)', bg: 'var(--status-warning-bg)', icon: ExclamationTriangleIcon },
  danger: { label: 'kritik', color: 'var(--status-danger)', bg: 'var(--status-danger-bg)', icon: ShieldExclamationIcon },
};
const AREA: Record<string, string> = { init: 'Init script', jboss: 'JBoss', jvm: 'JVM', web: 'Web sunucu', ip: 'IP', ssh: 'SSH', scan: 'Tarama' };

// ── Grafik parcalari (SVG; kutuphane yok) ──────────────────────────────────────────
function Donut({ parts, size = 112, label, sub }: { parts: { value: number; color: string; title: string }[]; size?: number; label: React.ReactNode; sub?: string }) {
  const total = parts.reduce((a, p) => a + p.value, 0) || 1;
  const r = 40, c = 2 * Math.PI * r;
  let acc = 0;
  return (
    <div className="flex items-center gap-3">
      <svg width={size} height={size} viewBox="0 0 100 100" role="img" aria-label={typeof label === 'string' ? label : undefined}>
        <circle cx="50" cy="50" r={r} fill="none" stroke="var(--bg-elevated)" strokeWidth="12" />
        {parts.filter((p) => p.value > 0).map((p, i) => {
          const len = (p.value / total) * c;
          const el = <circle key={i} cx="50" cy="50" r={r} fill="none" stroke={p.color} strokeWidth="12" strokeDasharray={`${len} ${c - len}`} strokeDashoffset={-acc} transform="rotate(-90 50 50)"><title>{p.title}: {p.value}</title></circle>;
          acc += len;
          return el;
        })}
        <text x="50" y="47" textAnchor="middle" fontSize="18" fontWeight="700" fill="var(--text-primary)">{typeof label === 'string' ? label : ''}</text>
        {sub && <text x="50" y="62" textAnchor="middle" fontSize="8" fill="var(--text-muted)">{sub}</text>}
      </svg>
      <ul className="text-[11px] space-y-0.5">
        {parts.map((p, i) => (
          <li key={i} className="flex items-center gap-1.5"><span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: p.color }} /> <span style={{ color: 'var(--text-secondary)' }}>{p.title}</span> <b className="tabular-nums">{nf(p.value)}</b></li>
        ))}
      </ul>
    </div>
  );
}

function Bar({ value, total, color = 'var(--accent)', title }: { value: number; total: number; color?: string; title?: string }) {
  const pct = total > 0 ? Math.round((value / total) * 100) : 0;
  return (
    <div className="h-2 rounded-full overflow-hidden" style={{ background: 'var(--bg-elevated)' }} title={title || `${value}/${total} (%${pct})`}>
      <div className="h-full rounded-full" style={{ width: `${pct}%`, background: color, transition: 'width .3s' }} />
    </div>
  );
}

function Kpi({ title, children, tone }: { title: string; children: React.ReactNode; tone?: ShSeverity }) {
  return (
    <section className="rounded-xl border p-4" style={{ borderColor: tone && tone !== 'ok' ? SEV[tone].color : 'var(--border-subtle)', background: 'var(--bg-surface)' }}>
      <h3 className="text-[11px] font-semibold uppercase tracking-wide mb-2 truncate" style={{ color: 'var(--text-muted)' }} title={title}>{title}</h3>
      {children}
    </section>
  );
}

function SevPill({ s, n }: { s: ShSeverity; n?: number }) {
  const t = SEV[s]; const I = t.icon;
  return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold border whitespace-nowrap" style={{ color: t.color, background: t.bg, borderColor: t.color }}><I className="w-3 h-3" />{t.label}{n != null ? ` · ${n}` : ''}</span>;
}

// ── Sayfa ────────────────────────────────────────────────────────────────────────────
export default function ServerHubPage() {
  const { addJob } = useJobTracker();
  const [data, setData] = useState<ShOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [q, setQ] = useState('');
  const [sev, setSev] = useState<'all' | ShSeverity>('all');
  const [product, setProduct] = useState('all');
  const [openHost, setOpenHost] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async (fresh = false) => {
    setLoading(true);
    try {
      const r = await serverHubApi.overview(fresh);
      if (r.ok) { setData(r); setErr(''); } else setErr(r.message || 'Veri alınamadı.');
    } catch (e: unknown) { setErr(e instanceof Error ? e.message : String(e)); } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  function trackJob(title: string, r: { jobId: number | null; awxServerId: number }, onDone?: (status: string, result: unknown) => void) {
    if (r.jobId == null) return;
    let done = false;
    addJob({
      title,
      fetchStatus: async () => {
        const s = await serverHubApi.jobStatus(r.awxServerId, r.jobId as number);
        if (!s.ok) throw new Error(s.message || 'Durum okunamadı.');
        if (TERMINAL.has(s.status) && !done) { done = true; onDone?.(s.status, s.result); }
        return { status: s.status, output: s.output || '', result: s.result };
      },
    });
  }

  const scanNow = async (hosts: string[]) => {
    setBusy('scan');
    try {
      const r = await serverHubApi.scan(hosts);
      if (!r.ok) { toast.error(r.message || 'Tarama başlatılamadı.'); return; }
      toast.success(`Tarama başladı (iş #${r.jobId}). Bitince liste yenilenir.`);
      trackJob(`Server Hub: tara ${hosts.length === 1 ? hosts[0] : hosts.length + ' sunucu'}`, r, () => load(true));
    } catch (e: unknown) { toast.error(e instanceof Error ? e.message : String(e)); } finally { setBusy(null); }
  };

  const products = useMemo(() => { const s = new Set<string>(); for (const h of data?.hosts || []) h.products.forEach((p) => s.add(p)); return [...s].sort(); }, [data]);
  const rows = useMemo(() => {
    const needle = q.trim().toUpperCase();
    return (data?.hosts || []).filter((h) => (sev === 'all' || h.status === sev) && (product === 'all' || h.products.includes(product)) && (!needle || h.host.includes(needle) || (h.topFinding || '').toUpperCase().includes(needle)));
  }, [data, q, sev, product]);

  if (loading && !data) return <div className="py-10 text-center text-sm" style={{ color: 'var(--text-muted)' }}>Yükleniyor…</div>;
  if (err) return <div className="text-sm rounded-xl px-3 py-2 border" style={{ color: 'var(--status-danger)', background: 'var(--status-danger-bg)', borderColor: 'var(--status-danger)' }}>{err}</div>;
  if (!data) return null;
  const s = data.summary;

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold flex items-center gap-2"><ServerStackIcon className="w-6 h-6" style={{ color: 'var(--accent)' }} /> <span className="nginx-hub-label"><span>Server</span> <span className="nginx-hub-word" style={{ color: 'var(--accent)', textShadow: 'none', animation: 'none' }}>Hub</span></span></h1>
          <p className="text-sm mt-0.5 max-w-4xl" style={{ color: 'var(--text-muted)' }}>
            Reboot sonrası her şey doğru açılacak mı, sunucularda atıl bir şey var mı? Günlük tarama: init script referans uyumu, JBoss 7/8 JVM'leri (auto-start, kapalı, restart-required), RHA/IHS/Nginx sözdizimi ve vhost yükü (hc.html/hc.jsp hariç), boşta IP. Son tarama: <b>{data.latestScan ? fmtDate(data.latestScan) : '—'}</b>.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => load(true)} className={SM_BTN} style={smBtn()}><ArrowPathIcon className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /> Yenile</button>
        </div>
      </div>

      {data.tableMissing && (
        <div className="rounded-xl border px-4 py-3 text-[12px]" style={{ borderColor: 'var(--status-warning)', background: 'var(--status-warning-bg)', color: 'var(--text-secondary)' }}>{data.message}</div>
      )}

      {s && (
        <>
          {/* ── Genel durum: yuvarlak + bar ── */}
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <Kpi title="Sunucular" tone={s.hosts.danger ? 'danger' : s.hosts.warning ? 'warning' : 'ok'}>
              <Donut label={String(s.hosts.total)} sub="sunucu" parts={[
                { value: s.hosts.ok, color: SEV.ok.color, title: 'sorun yok' }, { value: s.hosts.info, color: SEV.info.color, title: 'bilgi' },
                { value: s.hosts.warning, color: SEV.warning.color, title: 'uyarı' }, { value: s.hosts.danger, color: SEV.danger.color, title: 'kritik' },
              ]} />
            </Kpi>
            <Kpi title="JBoss JVM auto-start" tone={s.jvm.rebootRisk ? 'danger' : 'ok'}>
              <Donut label={String(s.jvm.total)} sub="JVM" parts={[
                { value: s.jvm.autoOn, color: SEV.ok.color, title: 'auto-start açık' }, { value: s.jvm.autoOff, color: SEV.warning.color, title: 'auto-start kapalı' }, { value: s.jvm.autoUnknown, color: 'var(--status-neutral)', title: 'bilinmiyor' },
              ]} />
              <div className="mt-2 text-[11px]" style={{ color: 'var(--text-secondary)' }}><b style={{ color: SEV.danger.color }}>{s.jvm.rebootRisk}</b> reboot riski (çalışıyor + auto-start kapalı) · <b>{s.jvm.restartRequired}</b> restart gerekli</div>
            </Kpi>
            <Kpi title="JVM çalışma / yük" tone={s.jvm.retireCandidates ? 'warning' : 'ok'}>
              <Donut label={String(s.jvm.running)} sub="çalışıyor" parts={[
                { value: s.jvm.running, color: SEV.ok.color, title: 'çalışıyor' }, { value: s.jvm.stopped, color: 'var(--status-neutral)', title: 'kapalı' },
              ]} />
              <div className="mt-2 text-[11px]" style={{ color: 'var(--text-secondary)' }}><b style={{ color: SEV.warning.color }}>{s.jvm.retireCandidates}</b> retire adayı · <b>{s.jvm.noLoad}</b> yük yok · {s.jvm.mapped}/{s.jvm.total} web katmanına eşlendi</div>
            </Kpi>
            <Kpi title="Boşta IP" tone={s.ips.unused ? 'warning' : 'ok'}>
              <Donut label={String(s.ips.unused)} sub="boşta" parts={[
                { value: s.ips.total - s.ips.unused, color: SEV.ok.color, title: 'kullanımda' }, { value: s.ips.unused, color: SEV.warning.color, title: 'boşta' },
              ]} />
              {s.ssh && s.ssh.hosts > 0 && (
                <div className="mt-2 text-[11px]" style={{ color: 'var(--text-secondary)' }} title="sshd MaxSessions ≤ 10 olan sunucular — Ansible delegate/forks ile mux_client_request_session hatası verir">
                  SSH: <b style={s.ssh.near ? { color: SEV.warning.color } : undefined}>{s.ssh.near}</b> sınıra yakın · <b>{s.ssh.lowMaxSessions}</b>/{s.ssh.hosts} MaxSessions ≤ 10
                </div>
              )}
            </Kpi>
          </div>

          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <Kpi title="Init script uyumu" tone={s.init.diffFiles ? 'warning' : 'ok'}>
              <div className="text-2xl font-bold tabular-nums">{s.init.compliant} <span className="text-sm font-normal" style={{ color: 'var(--text-muted)' }}>/ {s.init.hosts} sunucu referansla aynı</span></div>
              <div className="mt-2"><Bar value={s.init.compliant} total={s.init.hosts} color={SEV.ok.color} /></div>
              <div className="mt-1 text-[11px]" style={{ color: 'var(--text-secondary)' }}>{s.init.diffFiles} dosya referanstan farklı</div>
            </Kpi>
            {(['RHA', 'IHS', 'NGINX'] as const).map((p) => {
              const w = s.web[p]; if (!w) return null;
              return (
                <Kpi key={p} title={`${p === 'RHA' ? 'Red Hat Apache' : p === 'IHS' ? 'IBM HTTP Server' : 'Nginx'} sözdizimi`} tone={w.syntaxFail ? 'danger' : 'ok'}>
                  <div className="text-2xl font-bold tabular-nums">{w.syntaxOk} <span className="text-sm font-normal" style={{ color: 'var(--text-muted)' }}>/ {w.hosts} sunucu OK</span></div>
                  <div className="mt-2"><Bar value={w.syntaxOk} total={w.hosts} color={w.syntaxFail ? SEV.danger.color : SEV.ok.color} /></div>
                  <div className="mt-1 text-[11px]" style={{ color: 'var(--text-secondary)' }}>{w.syntaxFail} hatalı · {w.notRunning} çalışmıyor · {w.vhosts} vhost, {w.idleVhosts} yüksüz</div>
                </Kpi>
              );
            })}
          </div>
        </>
      )}

      {/* ── Sunucu listesi ── */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <MagnifyingGlassIcon className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-muted)' }} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="sunucu ya da bulgu ara" className="pl-8 pr-2.5 py-1.5 text-xs border rounded-lg w-64" style={{ borderColor: 'var(--border)', background: 'var(--bg-surface)', color: 'var(--text-primary)' }} />
        </div>
        <div className="flex gap-1 rounded-lg p-0.5" style={{ background: 'var(--bg-elevated)' }}>
          {(['all', 'danger', 'warning', 'info', 'ok'] as const).map((k) => (
            <button key={k} onClick={() => setSev(k)} className="px-2.5 py-1 text-[11px] font-medium rounded-md" style={{ background: sev === k ? 'var(--bg-surface)' : 'transparent', color: sev === k ? 'var(--text-primary)' : 'var(--text-muted)' }}>
              {k === 'all' ? 'tümü' : SEV[k].label}{s ? ` · ${k === 'all' ? s.hosts.total : s.hosts[k]}` : ''}
            </button>
          ))}
        </div>
        <select value={product} onChange={(e) => setProduct(e.target.value)} className="text-xs border rounded-lg px-2 py-1.5" style={{ borderColor: 'var(--border)', background: 'var(--bg-surface)', color: 'var(--text-primary)' }}>
          <option value="all">tüm ürünler</option>
          {products.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
        <span className="text-xs tabular-nums" style={{ color: 'var(--text-muted)' }}>{nf(rows.length)} / {nf(data.hosts.length)} sunucu</span>
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={() => {
              const header = ['sunucu', 'tarama', 'urunler', 'durum', 'kritik', 'uyari', 'bilgi', 'jvm', 'calisan_jvm', 'vhost', 'bosta_ip', 'tarama_cpu_s', 'en_onemli_bulgu'];
              const body = [header, ...rows.map((h) => [h.host, h.scanDate || '', h.products.join(' '), SEV[h.status].label, h.counts.danger, h.counts.warning, h.counts.info, h.jvms, h.jvmsRunning, h.vhosts, h.unusedIps, h.cpuS ?? '', h.topFinding || ''])]
                .map((r) => r.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
              const url = URL.createObjectURL(new Blob(['﻿' + body], { type: 'text/csv;charset=utf-8;' }));
              const a = document.createElement('a'); a.href = url; a.download = `server_hub_${new Date().toISOString().slice(0, 10)}.csv`; a.click(); URL.revokeObjectURL(url);
            }}
            className={SM_BTN} style={smBtn()}
          ><ArrowDownTrayIcon className="w-3.5 h-3.5" /> CSV</button>
          <button disabled={busy != null || rows.length === 0 || rows.length > 50} onClick={() => scanNow(rows.map((h) => h.host))} className={SM_BTN} style={smBtn(true)} title="Listedeki sunucuları şimdi tara (en çok 50)"><BoltIcon className="w-3.5 h-3.5" /> Listedekileri tara</button>
        </div>
      </div>

      <div className="overflow-auto rounded-xl border" style={{ borderColor: 'var(--border-subtle)', maxHeight: '44rem' }}>
        <table className="w-full text-xs border-collapse">
          <thead className="sticky top-0" style={{ background: 'var(--bg-elevated)' }}>
            <tr>
              {['Sunucu', 'Durum', 'Ürünler', 'JVM', 'vhost', 'Boşta IP', 'En önemli bulgu', 'Tarama', ''].map((t, i) => (
                <th key={t + i} className={`px-3 py-2 text-[11px] font-semibold ${i >= 3 && i <= 5 ? 'text-right' : 'text-left'}`} style={{ color: 'var(--text-muted)' }}>{t}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <TableEmptyRow colSpan={9} title={data.hosts.length ? 'Süzgeçle eşleşen sunucu yok.' : 'Henüz tarama verisi yok.'} description={data.hosts.length ? undefined : 'server_hub_scan job’ı bir kez koşunca burası dolar.'} />
            ) : rows.map((h) => (
              <tr key={h.host} className="border-t cursor-pointer hover:bg-[var(--bg-elevated)]" style={{ borderColor: 'var(--border-subtle)' }} onClick={() => setOpenHost(h.host)}>
                <td className="px-3 py-1.5 font-mono font-semibold">{h.host}</td>
                <td className="px-3 py-1.5"><SevPill s={h.status} n={h.status === 'ok' ? undefined : h.counts.danger + h.counts.warning + h.counts.info} /></td>
                <td className="px-3 py-1.5"><span className="text-[10px]" style={{ color: 'var(--text-secondary)' }}>{h.products.join(' · ') || '—'}</span></td>
                <td className="px-3 py-1.5 text-right tabular-nums">{h.jvms ? `${h.jvmsRunning}/${h.jvms}` : '—'}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{h.vhosts || '—'}</td>
                <td className="px-3 py-1.5 text-right tabular-nums" style={h.unusedIps ? { color: SEV.warning.color, fontWeight: 600 } : undefined}>{h.unusedIps || '—'}</td>
                <td className="px-3 py-1.5"><div className="truncate max-w-[28rem]" title={h.topFinding || ''} style={{ color: 'var(--text-secondary)' }}>{h.topFinding || <span style={{ color: SEV.ok.color }}>temiz</span>}</div></td>
                <td className="px-3 py-1.5 text-[10px]" style={{ color: 'var(--text-muted)' }}>{h.scanDate ? fmtDate(h.scanDate) : '—'}{h.cpuS != null ? ` · ${h.cpuS.toFixed(1)}s cpu` : ''}</td>
                <td className="px-3 py-1.5" onClick={(e) => e.stopPropagation()}>
                  <button disabled={busy != null} onClick={() => scanNow([h.host])} className={SM_BTN} style={smBtn()} title="Reboot öncesi şimdi tara (geceden beri değişiklik olmuş olabilir)"><BoltIcon className="w-3.5 h-3.5" /> Şimdi tara</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {openHost && <HostModal host={openHost} onClose={() => setOpenHost(null)} onScan={() => scanNow([openHost])} trackJob={trackJob} reload={() => load(true)} />}
    </div>
  );
}

// ── Sunucu ayrintisi + Duzelt ────────────────────────────────────────────────────
function HostModal({ host, onClose, onScan, trackJob, reload }: {
  host: string; onClose: () => void; onScan: () => void;
  trackJob: (title: string, r: { jobId: number | null; awxServerId: number }, onDone?: (status: string, result: unknown) => void) => void;
  reload: () => void;
}) {
  const [d, setD] = useState<ShHostDetail | null>(null);
  const [err, setErr] = useState('');
  const [tab, setTab] = useState<'findings' | 'jvm' | 'web' | 'init' | 'ip'>('findings');
  const [fix, setFix] = useState<{ f: ShFinding; phase: 'ask' | 'planning' | 'planned' | 'applying'; plan?: string; jobId?: number; reload: boolean } | null>(null);

  useEffect(() => {
    let alive = true;
    serverHubApi.host(host).then((r) => { if (!alive) return; if (r.ok) setD(r.host); else setErr(r.message || 'Sunucu verisi alınamadı.'); }).catch((e) => alive && setErr(e.message));
    return () => { alive = false; };
  }, [host]);

  const runFix = async (confirmed: boolean) => {
    if (!fix) return;
    setFix({ ...fix, phase: confirmed ? 'applying' : 'planning' });
    try {
      const r = await serverHubApi.fix({ host, code: fix.f.code, fix: fix.f.fix!, confirmed, reload: fix.reload });
      if (!r.ok) { toast.error(r.message || 'İş başlatılamadı.'); setFix({ ...fix, phase: 'ask' }); return; }
      trackJob(`Server Hub: ${confirmed ? 'düzelt' : 'plan'} ${fix.f.fix!.action} @ ${host}`, r, (status, result) => {
        const line = (result as { line?: string } | null)?.line || '';
        const msg = line.split('\t').slice(2).join(' — ') || status;
        if (!confirmed) setFix((cur) => (cur ? { ...cur, phase: 'planned', plan: msg, jobId: r.jobId ?? undefined } : cur));
        else {
          if (status === 'successful') { toast.success(`Uygulandı: ${msg}`); setFix(null); reload(); serverHubApi.host(host, true).then((x) => x.ok && setD(x.host)).catch(() => {}); }
          else { toast.error(`Düzeltme başarısız: ${msg}`); setFix((cur) => (cur ? { ...cur, phase: 'planned', plan: msg } : cur)); }
        }
      });
      toast.success(`${confirmed ? 'Düzeltme' : 'Plan'} işi başladı (#${r.jobId}). Sonuç bu pencerede görünecek.`);
    } catch (e: unknown) { toast.error(e instanceof Error ? e.message : String(e)); setFix({ ...fix, phase: 'ask' }); }
  };

  const tabs = [
    { id: 'findings', label: `Bulgular${d ? ` · ${d.findings.length}` : ''}` }, { id: 'jvm', label: `JVM${d ? ` · ${d.jvms.length}` : ''}` },
    { id: 'web', label: `Web / vhost${d ? ` · ${d.vhosts.length}` : ''}` }, { id: 'init', label: `Init${d ? ` · ${d.init.length}` : ''}` }, { id: 'ip', label: `IP${d ? ` · ${d.ips.length}` : ''}` },
  ] as const;

  return (
    <Modal open onClose={onClose} title={host} subtitle={d ? `${d.products.join(' · ') || 'ürün yok'} · son tarama ${d.scanDate ? fmtDate(d.scanDate) : '—'}${d.cpuS != null ? ` · tarama ${d.cpuS.toFixed(1)} sn CPU` : ''}` : undefined} icon={ServerStackIcon} size="xl"
      footer={<div className="flex items-center gap-2 w-full"><button onClick={onScan} className={SM_BTN} style={smBtn()}><BoltIcon className="w-3.5 h-3.5" /> Şimdi tara</button><span className="ml-auto" /><button onClick={onClose} className={SM_BTN} style={smBtn()}>Kapat</button></div>}>
      {err && <div className="text-sm px-3 py-2 rounded-xl border" style={{ color: 'var(--status-danger)', background: 'var(--status-danger-bg)', borderColor: 'var(--status-danger)' }}>{err}</div>}
      {!d && !err && <div className="py-6 text-center text-sm" style={{ color: 'var(--text-muted)' }}>Yükleniyor…</div>}
      {d && (
        <div className="space-y-3">
          <div className="flex gap-1 rounded-lg p-0.5 w-fit" style={{ background: 'var(--bg-elevated)' }}>
            {tabs.map((t) => (
              <button key={t.id} onClick={() => setTab(t.id)} className="px-3 py-1.5 text-xs font-medium rounded-md" style={{ background: tab === t.id ? 'var(--bg-surface)' : 'transparent', color: tab === t.id ? 'var(--text-primary)' : 'var(--text-muted)' }}>{t.label}</button>
            ))}
          </div>

          {tab === 'findings' && (
            d.findings.length === 0 ? <div className="rounded-xl border px-4 py-3 text-sm" style={{ borderColor: SEV.ok.color, background: SEV.ok.bg, color: 'var(--text-secondary)' }}><b style={{ color: SEV.ok.color }}>Sorun yok.</b> Reboot için engel görünmüyor.</div> : (
              <ul className="space-y-1.5">
                {d.findings.map((f, i) => {
                  const t = SEV[f.severity]; const I = t.icon;
                  return (
                    <li key={i} className="flex items-start gap-2.5 rounded-xl border px-3 py-2" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-surface)', boxShadow: `inset 3px 0 0 ${t.color}` }}>
                      <I className="w-4 h-4 shrink-0 mt-0.5" style={{ color: t.color }} />
                      <div className="min-w-0 flex-1">
                        <div className="text-[13px]" style={{ color: 'var(--text-primary)' }}>{f.text}</div>
                        <div className="text-[10px] mt-0.5" style={{ color: 'var(--text-muted)' }}>{AREA[f.area] || f.area} · {f.code}</div>
                      </div>
                      {f.fix && (
                        <button onClick={() => setFix({ f, phase: 'ask', reload: false })} className={SM_BTN} style={smBtn(true)} title={`Düzelt: ${f.fix.action}`}><WrenchScrewdriverIcon className="w-3.5 h-3.5" /> Düzelt</button>
                      )}
                    </li>
                  );
                })}
              </ul>
            )
          )}

          {tab === 'jvm' && (
            <div className="overflow-auto rounded-lg border" style={{ borderColor: 'var(--border-subtle)' }}>
              <table className="w-full text-xs border-collapse">
                <thead style={{ background: 'var(--bg-elevated)' }}><tr>{['Nesil', 'JVM', 'Grup', 'Durum', 'Auto-start', 'server-state', 'Portlar', 'Web katmanı', '24 sa', '7 gün'].map((h) => <th key={h} className="px-2.5 py-1.5 text-left text-[11px] font-semibold" style={{ color: 'var(--text-muted)' }}>{h}</th>)}</tr></thead>
                <tbody>
                  {d.jvms.length === 0 ? <TableEmptyRow colSpan={10} title="Bu sunucuda JBoss JVM tanımı yok." /> : d.jvms.map((j) => (
                    <tr key={j.gen + j.name} className="border-t" style={{ borderColor: 'var(--border-subtle)' }}>
                      <td className="px-2.5 py-1.5">JBoss {j.gen}</td>
                      <td className="px-2.5 py-1.5 font-mono font-semibold">{j.name}</td>
                      <td className="px-2.5 py-1.5" style={{ color: 'var(--text-muted)' }}>{j.group || '—'}</td>
                      <td className="px-2.5 py-1.5"><span style={{ color: j.running ? SEV.ok.color : 'var(--status-neutral)', fontWeight: 600 }}>{j.running ? 'çalışıyor' : 'kapalı'}</span></td>
                      <td className="px-2.5 py-1.5"><span style={{ color: j.autoStart === 'true' ? SEV.ok.color : j.autoStart === 'false' ? SEV.warning.color : 'var(--status-neutral)', fontWeight: 600 }}>{j.autoStart === 'true' ? 'açık' : j.autoStart === 'false' ? 'kapalı' : '?'}</span></td>
                      <td className="px-2.5 py-1.5" style={/required/.test(j.serverState) ? { color: SEV.warning.color, fontWeight: 600 } : undefined}>{j.serverState}</td>
                      <td className="px-2.5 py-1.5 font-mono text-[10px]">{j.ports.join(', ') || '—'}</td>
                      <td className="px-2.5 py-1.5 text-[10px]">
                        {j.vhosts.length ? j.vhosts.map((v) => <div key={v.host + v.serverName} title={`${v.product} @ ${v.host} (${j.matchKind === 'proxy' ? 'proxy hedefi' : 'ad eşleşmesi'})`}>{v.serverName} <span style={{ color: 'var(--text-muted)' }}>@{v.host}</span></div>) : <span style={{ color: 'var(--text-muted)' }}>eşlenemedi</span>}
                      </td>
                      <td className="px-2.5 py-1.5 tabular-nums text-right">{nf(j.req24h)}</td>
                      <td className="px-2.5 py-1.5 tabular-nums text-right" style={j.req7d === 0 ? { color: SEV.warning.color, fontWeight: 600 } : undefined}>{nf(j.req7d)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {d.jboss.map((b) => <div key={b.gen} className="px-2.5 py-1.5 text-[10px] border-t" style={{ color: 'var(--text-muted)', borderColor: 'var(--border-subtle)' }}>JBoss {b.gen} host controller "{b.hostName}": {b.hostState} · CLI {b.cli}{b.note ? ` — ${b.note}` : ''}</div>)}
            </div>
          )}

          {tab === 'web' && (
            <div className="space-y-2">
              {d.web.map((w) => (
                <div key={w.product} className="rounded-lg border px-3 py-2 text-xs flex items-center gap-3" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-surface)' }}>
                  <b>{w.product}</b>
                  <span style={{ color: w.running ? SEV.ok.color : SEV.warning.color }}>{w.running ? 'çalışıyor' : 'çalışmıyor'}</span>
                  <span style={{ color: w.syntax === 'OK' ? SEV.ok.color : w.syntax === 'FAIL' ? SEV.danger.color : 'var(--text-muted)', fontWeight: 600 }}>sözdizimi {w.syntax}</span>
                  <span className="truncate" style={{ color: 'var(--text-muted)' }} title={w.detail}>{w.detail}</span>
                </div>
              ))}
              <div className="overflow-auto rounded-lg border" style={{ borderColor: 'var(--border-subtle)' }}>
                <table className="w-full text-xs border-collapse">
                  <thead style={{ background: 'var(--bg-elevated)' }}><tr>{['Ürün', 'Listen', 'server_name', 'Proxy hedefi', 'JVM', '24 sa', '7 gün', 'hc 24 sa', 'Log'].map((h) => <th key={h} className="px-2.5 py-1.5 text-left text-[11px] font-semibold" style={{ color: 'var(--text-muted)' }}>{h}</th>)}</tr></thead>
                  <tbody>
                    {d.vhosts.length === 0 ? <TableEmptyRow colSpan={9} title="vhost tanımı yok." /> : d.vhosts.map((v, i) => (
                      <tr key={i} className="border-t" style={{ borderColor: 'var(--border-subtle)' }}>
                        <td className="px-2.5 py-1.5">{v.product}</td>
                        <td className="px-2.5 py-1.5 font-mono text-[10px]">{v.listen}</td>
                        <td className="px-2.5 py-1.5"><div className="truncate max-w-[16rem]" title={`${v.serverName} ${v.aliases}`}>{v.serverName}{v.aliases ? <span style={{ color: 'var(--text-muted)' }}> +{v.aliases.split(' ').filter(Boolean).length}</span> : null}</div></td>
                        <td className="px-2.5 py-1.5 font-mono text-[10px]"><div className="truncate max-w-[14rem]" title={v.proxyTargets}>{v.proxyTargets || '—'}</div></td>
                        <td className="px-2.5 py-1.5 text-[10px]">{v.jvm || <span style={{ color: 'var(--text-muted)' }}>—</span>}</td>
                        <td className="px-2.5 py-1.5 tabular-nums text-right">{v.req24h == null || v.req24h < 0 ? '?' : nf(v.req24h)}</td>
                        <td className="px-2.5 py-1.5 tabular-nums text-right" style={v.req7d === 0 ? { color: SEV.warning.color, fontWeight: 600 } : undefined}>{v.req7d == null || v.req7d < 0 ? '?' : nf(v.req7d)}{v.sampled ? '~' : ''}</td>
                        <td className="px-2.5 py-1.5 tabular-nums text-right" style={{ color: 'var(--text-muted)' }}>{v.hc24h == null || v.hc24h < 0 ? '?' : nf(v.hc24h)}</td>
                        <td className="px-2.5 py-1.5 font-mono text-[10px]"><div className="truncate max-w-[14rem]" title={v.accessLog}>{v.accessLog || '—'}{v.shared ? ' (paylaşımlı)' : ''}</div></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-[10px]" style={{ color: 'var(--text-muted)' }}>"~" = log kuyruğu 7 günü kapsamadı (örneklem). Sayılar hc.html/hc.jsp hariç; "?" = log okunamadı.</p>
            </div>
          )}

          {tab === 'init' && (
            <div className="overflow-auto rounded-lg border" style={{ borderColor: 'var(--border-subtle)' }}>
              <table className="w-full text-xs border-collapse">
                <thead style={{ background: 'var(--bg-elevated)' }}><tr>{['Kök', 'Dosya', 'Durum'].map((h) => <th key={h} className="px-2.5 py-1.5 text-left text-[11px] font-semibold" style={{ color: 'var(--text-muted)' }}>{h}</th>)}</tr></thead>
                <tbody>
                  {d.init.length === 0 ? <TableEmptyRow colSpan={3} title="Init script dizini yok ya da referans verilmedi." /> : d.init.map((i, k) => (
                    <tr key={k} className="border-t" style={{ borderColor: 'var(--border-subtle)' }}>
                      <td className="px-2.5 py-1.5 font-mono text-[10px]">{i.root}</td>
                      <td className="px-2.5 py-1.5 font-mono">{i.file}</td>
                      <td className="px-2.5 py-1.5"><span style={{ color: i.status === 'OK' ? SEV.ok.color : i.status === 'DIFF' ? SEV.warning.color : 'var(--status-neutral)', fontWeight: 600 }}>{i.status === 'OK' ? 'referansla aynı' : i.status === 'DIFF' ? 'FARKLI' : 'yok'}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {tab === 'ip' && (
            <div className="overflow-auto rounded-lg border" style={{ borderColor: 'var(--border-subtle)' }}>
              <table className="w-full text-xs border-collapse">
                <thead style={{ background: 'var(--bg-elevated)' }}><tr>{['IP', 'Arayüz', 'Kullanan', ''].map((h, i) => <th key={h + i} className="px-2.5 py-1.5 text-left text-[11px] font-semibold" style={{ color: 'var(--text-muted)' }}>{h}</th>)}</tr></thead>
                <tbody>
                  {d.ips.length === 0 ? <TableEmptyRow colSpan={4} title="IP bilgisi yok." /> : d.ips.map((ip) => (
                    <tr key={ip.ip} className="border-t" style={{ borderColor: 'var(--border-subtle)' }}>
                      <td className="px-2.5 py-1.5 font-mono">{ip.ip}</td>
                      <td className="px-2.5 py-1.5">{ip.iface}</td>
                      <td className="px-2.5 py-1.5"><span style={{ color: ip.usedBy === 'none' ? SEV.warning.color : 'var(--text-primary)', fontWeight: ip.usedBy === 'none' ? 600 : 400 }}>{ip.usedBy === 'none' ? 'BOŞTA' : ip.usedBy === 'wildcard' ? 'joker dinleyici (*)' : ip.usedBy === 'other' ? 'web dışı soket' : ip.usedBy.toUpperCase()}</span></td>
                      <td className="px-2.5 py-1.5 text-[10px]" style={{ color: 'var(--text-muted)' }}>{ip.primary ? 'birincil' : ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {d.sshd && (
                <div className="px-2.5 py-1.5 text-[11px] border-t" style={{ color: 'var(--text-secondary)', borderColor: 'var(--border-subtle)' }}>
                  sshd: MaxSessions <b>{d.sshd.maxSessions ?? '?'}</b> · MaxStartups <b>{d.sshd.maxStartups || '?'}</b> · açık ssh oturumu <b>{d.sshd.activeSessions ?? '?'}</b>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── Duzelt: once PLAN, sonra onay ── */}
      {fix && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,.45)' }} onClick={() => fix.phase === 'ask' || fix.phase === 'planned' ? setFix(null) : null}>
          <div className="w-full max-w-lg rounded-2xl border p-5 space-y-3" style={{ background: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }} onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start gap-2">
              <WrenchScrewdriverIcon className="w-5 h-5 shrink-0" style={{ color: 'var(--accent)' }} />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold">Düzelt — {fix.f.fix!.action}</div>
                <div className="text-[12px] mt-0.5" style={{ color: 'var(--text-secondary)' }}>{fix.f.text}</div>
              </div>
              <button onClick={() => setFix(null)} className="p-1 rounded-lg" style={{ color: 'var(--text-muted)' }}><XMarkIcon className="w-4 h-4" /></button>
            </div>
            <div className="rounded-xl border px-3 py-2 text-[12px] font-mono" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-elevated)' }}>
              {Object.entries(fix.f.fix!).filter(([k]) => k !== 'action').map(([k, v]) => <div key={k}><span style={{ color: 'var(--text-muted)' }}>{k}=</span>{String(v)}</div>)}
              <div><span style={{ color: 'var(--text-muted)' }}>host=</span>{host}</div>
            </div>
            {fix.f.fix!.action.startsWith('apache_') && (
              <label className="flex items-center gap-2 text-[12px]" style={{ color: 'var(--text-secondary)' }}><input type="checkbox" checked={fix.reload} onChange={(e) => setFix({ ...fix, reload: e.target.checked })} disabled={fix.phase !== 'ask' && fix.phase !== 'planned'} /> Sözdizimi geçerse <b>graceful reload</b> da yap</label>
            )}
            {fix.phase === 'ask' && <p className="text-[12px]" style={{ color: 'var(--text-secondary)' }}>Önce sunucuda <b>plan</b> koşulur: ne değişeceği gösterilir, hiçbir şey değişmez. Planı gördükten sonra onaylarsınız. Her değişiklikten önce yedek alınır; sözdizimi/doğrulama geçmezse geri alınır.</p>}
            {fix.phase === 'planning' && <p className="text-[12px]" style={{ color: 'var(--text-secondary)' }}>Plan koşuyor… (iş penceresinden izlenebilir)</p>}
            {fix.phase === 'planned' && <div className="rounded-xl border px-3 py-2 text-[12px]" style={{ borderColor: 'var(--status-info)', background: 'var(--status-info-bg)', color: 'var(--text-primary)' }}><b>Plan:</b> {fix.plan}</div>}
            {fix.phase === 'applying' && <p className="text-[12px]" style={{ color: 'var(--text-secondary)' }}>Uygulanıyor…</p>}
            <div className="flex items-center gap-2 justify-end">
              <button onClick={() => setFix(null)} className={SM_BTN} style={smBtn()} disabled={fix.phase === 'planning' || fix.phase === 'applying'}>İptal</button>
              {fix.phase === 'ask' && <button onClick={() => runFix(false)} className={SM_BTN} style={smBtn(true)}>Planı göster</button>}
              {fix.phase === 'planned' && !/FAIL/.test(fix.plan || '') && <button onClick={() => runFix(true)} className={SM_BTN} style={{ ...smBtn(true), background: 'var(--status-danger)', borderColor: 'var(--status-danger)' }}>Onayla ve uygula</button>}
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}
