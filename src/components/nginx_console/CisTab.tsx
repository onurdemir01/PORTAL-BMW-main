// src/components/nginx_console/CisTab.tsx — Nginx Hub "CIS" (2026-09-22).
//
// Kullanici: "gercek CIS Benchmark maddelerini sunucularin nginx -T ciktisindan kontrol edip
// raporla; istedigim maddeyi istisnaya alip skordan dusureyim, kendi referans degerimi vereyim,
// skoru job ile canli tazeleyeyim." Veri: bmw_nginx/nginx_cis isi -> dbo.Nginx_Cis_*; karar ve
// skor Portal'da (server/nginx-cis/score.cjs) — istisna/kurum referansi ANINDA etkili, job beklemez.
import React, { useCallback, useMemo, useState } from 'react';
import { ArrowPathIcon, ArrowDownTrayIcon, BoltIcon, ChevronDownIcon, ChevronRightIcon, MagnifyingGlassIcon } from '@heroicons/react/24/outline';
import { useAsyncEffect } from '@/hooks/useAsyncEffect';
import { useJobTracker } from '@/contexts/JobTrackerContext';
import { LoadingLogo } from '@/components/common/LoadingLogo';
import { TableEmptyRow } from '@/components/common/EmptyState';
import { Pill } from '@/components/denetim/ui';
import { Modal } from '@/components/common/Modal';
import { toast } from '@/hooks/useToast';
import { fmtNumber } from '@/utils/datetime';
import { nginxCisApi, type NcCisOverview, type NcCisItemRow, type NcCisHostRow, type NcCisHostDetail, type NcCisCell } from '@/api/nginxCisApi';

/** Madde numarasi dogal sirasi: 2.4.3 < 2.10.1 (metin sirasi bunu yanlis yapar). */
function cmpItemId(a: string, b: string) {
  const pa = a.split('.').map(Number); const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) { const d = (pa[i] || 0) - (pb[i] || 0); if (d) return d; }
  return 0;
}

const TERMINAL = new Set(['successful', 'failed', 'error', 'canceled']);
const STATUS_TONE: Record<string, 'success' | 'danger' | 'warning' | 'neutral' | 'info'> = {
  PASS: 'success', FAIL: 'danger', EXCEPTED: 'info', NA: 'neutral', MANUAL: 'warning', NODATA: 'neutral',
};
const STATUS_TR: Record<string, string> = { PASS: 'geçti', FAIL: 'kaldı', EXCEPTED: 'istisna', NA: 'uygulanmaz', MANUAL: 'manuel', NODATA: 'veri yok' };
const scoreColor = (s: number | null) => (s == null ? 'var(--text-muted)' : s >= 90 ? 'var(--status-success)' : s >= 70 ? 'var(--status-warning)' : 'var(--status-danger)');

export function CisTab({ isAdmin, onOpenHost }: { isAdmin: boolean; onOpenHost: (host: string) => void }) {
  const [data, setData] = useState<NcCisOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<'hosts' | 'items'>('hosts');
  const [q, setQ] = useState('');
  const [only, setOnly] = useState<'all' | 'fail' | 'under80'>('all');
  const [detail, setDetail] = useState<NcCisHostDetail | null>(null);
  const [itemOpen, setItemOpen] = useState<NcCisItemRow | null>(null);
  // Siralama (kullanici, 2026-09-22): maddeler varsayilan MADDE NUMARASINA gore; istenirse
  // en cok kalan / en az gecen / bolum. Sunucularda: skor, ad, kalan.
  const [itemSort, setItemSort] = useState<'id' | 'fail' | 'pass' | 'section'>('id');
  const [hostSort, setHostSort] = useState<'score' | 'host' | 'failed'>('score');
  const [rule, setRule] = useState<{ kind: 'exception' | 'override'; itemId: string; title: string; host?: string; value: string; note: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const { addJob } = useJobTracker();

  const load = useCallback(async (fresh = false) => {
    setLoading(true);
    try { const r = await nginxCisApi.overview(fresh); if (r.ok) setData(r); else toast.error(r.message || 'CIS verisi alınamadı.'); }
    catch (e) { toast.error(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  }, []);
  useAsyncEffect(async () => { await load(); }, [load]);

  const hosts = useMemo(() => {
    const n = q.trim().toLowerCase();
    const list = (data?.hosts || []).filter((h) => (!n || h.host.toLowerCase().includes(n))
      && (only === 'all' || (only === 'fail' ? h.failed > 0 : h.score != null && h.score < 80)));
    return [...list].sort((a, b) => (hostSort === 'host' ? a.host.localeCompare(b.host)
      : hostSort === 'failed' ? b.failed - a.failed || a.host.localeCompare(b.host)
      : (a.score ?? 101) - (b.score ?? 101) || a.host.localeCompare(b.host)));
  }, [data, q, only, hostSort]);
  const items = useMemo(() => {
    const n = q.trim().toLowerCase();
    const list = (data?.perItem || []).filter((i) => !n || i.id.includes(n) || i.title.toLowerCase().includes(n) || i.section.toLowerCase().includes(n));
    return [...list].sort((a, b) => (itemSort === 'fail' ? b.fail - a.fail || cmpItemId(a.id, b.id)
      : itemSort === 'pass' ? a.pass - b.pass || cmpItemId(a.id, b.id)
      : itemSort === 'section' ? a.section.localeCompare(b.section) || cmpItemId(a.id, b.id)
      : cmpItemId(a.id, b.id)));
  }, [data, q, itemSort]);

  const rescan = async (list: string[]) => {
    try {
      const r = await nginxCisApi.rescan(list);
      if (!r.ok) { toast.error(r.message || 'Tarama başlatılamadı.'); return; }
      toast.success(`CIS taraması başladı (iş #${r.jobId}).`);
      if (r.jobId != null) {
        let done = false;
        addJob({ title: `Nginx CIS · ${list.length ? list.join(', ') : 'tüm filo'} #${r.jobId}`, fetchStatus: async () => {
          const s = await nginxCisApi.jobStatus(r.awxServerId, r.jobId as number);
          if (!s.ok) throw new Error(s.message || 'Durum okunamadı.');
          if (TERMINAL.has(s.status) && !done) { done = true; load(true); }
          return { status: s.status, output: s.output || '' };
        } });
      }
    } catch (e) { toast.error(e instanceof Error ? e.message : String(e)); }
  };

  const openHost = async (host: string) => {
    try { const r = await nginxCisApi.host(host); if (r.ok) setDetail(r.host); else toast.error(r.message || 'Sunucu detayı alınamadı.'); }
    catch (e) { toast.error(e instanceof Error ? e.message : String(e)); }
  };

  const saveRule = async () => {
    if (!rule) return;
    setBusy(true);
    try {
      const r = rule.kind === 'exception'
        ? await nginxCisApi.setException(rule.itemId, rule.host || null, rule.note)
        : await nginxCisApi.setOverride(rule.itemId, rule.value, rule.note);
      if (!r.ok) { toast.error(r.message || 'Kaydedilemedi.'); return; }
      toast.success(rule.kind === 'exception' ? 'İstisna kaydedildi; skor yeniden hesaplandı.' : 'Kurum referansı kaydedildi; skor yeniden hesaplandı.');
      setRule(null);
      await load(true);
      if (detail) await openHost(detail.host);
    } catch (e) { toast.error(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };
  const dropRule = async (kind: 'exception' | 'override', id: number) => {
    setBusy(true);
    try {
      const r = kind === 'exception' ? await nginxCisApi.clearException(id) : await nginxCisApi.clearOverride(id);
      if (!r.ok) { toast.error(r.message || 'Kaldırılamadı.'); return; }
      await load(true);
      if (detail) await openHost(detail.host);
    } catch (e) { toast.error(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };

  const csv = () => {
    const head = ['sunucu', 'skor', 'gecen', 'kalan', 'istisna', 'atlanan', 'nginx_-T', 'tarama'];
    const body = (data?.hosts || []).map((h) => [h.host, h.score ?? '', h.passed, h.failed, h.excepted, h.skipped, h.tState || '', h.scanDate || '']);
    const text = [head, ...body].map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(';')).join('\n');
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['﻿' + text], { type: 'text/csv;charset=utf-8' })); a.download = `nginx_cis_${new Date().toISOString().slice(0, 10)}.csv`; a.click();
  };

  if (loading && !data) return <LoadingLogo label="CIS skorları hesaplanıyor…" />;
  if (data?.tableMissing) {
    return (
      <div className="rounded-xl border p-4 text-sm" style={{ borderColor: 'var(--status-warning)', background: 'var(--bg-surface)' }}>
        <b>CIS taraması henüz koşmadı.</b> <span style={{ color: 'var(--text-secondary)' }}>{data.message}</span>
        {isAdmin && <div className="mt-2"><button onClick={() => rescan([])} className="px-3 py-1.5 text-xs rounded-lg" style={{ background: 'var(--accent)', color: 'var(--accent-fg, #fff)' }}><BoltIcon className="w-3.5 h-3.5 inline" /> Tüm filoyu tara</button></div>}
      </div>
    );
  }
  const s = data?.summary;

  return (
    <div className="space-y-3">
      {s && (
        <div className="grid gap-3 md:grid-cols-6">
          <Tile n={s.avgScore == null ? '—' : `%${s.avgScore}`} l="ortalama skor" color={scoreColor(s.avgScore)} />
          <Tile n={fmtNumber(s.hosts)} l="sunucu" />
          <Tile n={fmtNumber(s.perfect)} l="tam uyumlu (%100)" color="var(--status-success)" />
          <Tile n={fmtNumber(s.under80)} l="%80 altı" color={s.under80 ? 'var(--status-danger)' : undefined} />
          <Tile n={fmtNumber(s.failCells)} l="kalan kontrol" color={s.failCells ? 'var(--status-warning)' : undefined} />
          <Tile n={fmtNumber(s.exceptedCells)} l="istisna hücre" />
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1 rounded-lg p-0.5" style={{ background: 'var(--bg-elevated)' }}>
          {([['hosts', 'Sunucular'], ['items', 'Maddeler']] as const).map(([id, label]) => (
            <button key={id} onClick={() => setView(id)} className={`px-3 py-1.5 text-xs font-medium rounded-md ${view === id ? 'shadow-sm' : ''}`} style={{ background: view === id ? 'var(--bg-surface)' : 'transparent', color: view === id ? 'var(--text-primary)' : 'var(--text-muted)' }}>{label}</button>
          ))}
        </div>
        <div className="relative">
          <MagnifyingGlassIcon className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-muted)' }} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={view === 'hosts' ? 'sunucu ara' : 'madde no / başlık'} className="pl-8 pr-2 py-1.5 text-xs border rounded-lg w-56" style={{ borderColor: 'var(--border)' }} />
        </div>
        <select value={view === 'hosts' ? hostSort : itemSort} onChange={(e) => (view === 'hosts' ? setHostSort(e.target.value as typeof hostSort) : setItemSort(e.target.value as typeof itemSort))} className="h-8 px-2 text-xs border rounded-lg" style={{ borderColor: 'var(--border)', background: 'var(--bg-surface)' }} aria-label="sıralama">
          {view === 'hosts'
            ? (<>
                <option value="score">sırala: skora göre (düşükten)</option>
                <option value="failed">sırala: kalan madde sayısı</option>
                <option value="host">sırala: sunucu adı</option>
              </>)
            : (<>
                <option value="id">sırala: madde numarası</option>
                <option value="fail">sırala: en çok kalan</option>
                <option value="pass">sırala: en az geçen</option>
                <option value="section">sırala: bölüm</option>
              </>)}
        </select>
        {view === 'hosts' && (
          <div className="flex gap-1 rounded-lg p-0.5" style={{ background: 'var(--bg-elevated)' }}>
            {([['all', 'Hepsi'], ['fail', 'Kalan maddesi olan'], ['under80', 'Skor < %80']] as const).map(([id, label]) => (
              <button key={id} onClick={() => setOnly(id)} className={`px-2.5 py-1 text-[11px] rounded-md ${only === id ? 'shadow-sm' : ''}`} style={{ background: only === id ? 'var(--bg-surface)' : 'transparent', color: only === id ? 'var(--text-primary)' : 'var(--text-muted)' }}>{label}</button>
            ))}
          </div>
        )}
        <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{s?.scanDate ? `tarama ${s.scanDate}` : ''}</span>
        <div className="ml-auto flex gap-2">
          {isAdmin && <button onClick={() => rescan([])} className="px-2.5 py-1.5 text-xs border rounded-lg" style={{ borderColor: 'var(--border)' }} title="Tüm filoda CIS taramasını yeniden koş (canlı skor)"><BoltIcon className="w-3.5 h-3.5 inline" /> Skoru tazele</button>}
          <button onClick={csv} className="px-2.5 py-1.5 text-xs border rounded-lg" style={{ borderColor: 'var(--border)' }}><ArrowDownTrayIcon className="w-3.5 h-3.5 inline" /> CSV</button>
          <button onClick={() => load(true)} className="px-2.5 py-1.5 text-xs border rounded-lg" style={{ borderColor: 'var(--border)' }}><ArrowPathIcon className={`w-3.5 h-3.5 inline ${loading ? 'animate-spin' : ''}`} /> Yenile</button>
        </div>
      </div>

      {view === 'hosts' ? (
        <div className="overflow-x-auto rounded-xl border" style={{ borderColor: 'var(--border-subtle)' }}>
          <table className="w-full text-xs">
            <thead><tr className="text-left" style={{ background: 'var(--bg-elevated)', color: 'var(--text-muted)' }}>
              <th className="px-3 py-2">Sunucu</th><th className="px-3 py-2">nginx sürümü</th><th className="px-3 py-2">nginx -T</th><th className="px-3 py-2 text-right">Skor</th><th className="px-3 py-2 text-right">Geçen</th><th className="px-3 py-2 text-right">Kalan</th><th className="px-3 py-2 text-right">İstisna</th><th className="px-3 py-2">Tarama</th><th className="px-3 py-2" />
            </tr></thead>
            <tbody>
              {hosts.map((h: NcCisHostRow) => (
                <tr key={h.host} className="border-t hover:bg-[var(--bg-elevated)] cursor-pointer" style={{ borderColor: 'var(--border-subtle)' }} onClick={() => openHost(h.host)}>
                  <td className="px-3 py-1.5 font-mono font-semibold">{h.host.toLowerCase()}</td>
                  <td className="px-3 py-1.5" style={{ color: 'var(--text-secondary)' }}>{h.nginxVersion || '—'}</td>
                  <td className="px-3 py-1.5">{h.tState === 'ok' ? <Pill tone="success">geçerli</Pill> : h.tState === 'fail' ? <Pill tone="danger">HATA</Pill> : '—'}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums font-semibold" style={{ color: scoreColor(h.score) }}>{h.score == null ? '—' : `%${h.score}`}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{h.passed}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums" style={{ color: h.failed ? 'var(--status-danger)' : undefined }}>{h.failed}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums" style={{ color: 'var(--text-muted)' }}>{h.excepted}</td>
                  <td className="px-3 py-1.5" style={{ color: 'var(--text-muted)' }}>{h.scanDate || '—'}</td>
                  <td className="px-3 py-1.5 text-right" onClick={(e) => e.stopPropagation()}>
                    {isAdmin && <button onClick={() => rescan([h.host])} className="text-[11px] underline" style={{ color: 'var(--accent)' }} title="Yalnız bu sunucuda CIS taramasını yeniden koş">tazele</button>}
                  </td>
                </tr>
              ))}
              {!loading && hosts.length === 0 && <TableEmptyRow colSpan={9} title="Eşleşen sunucu yok." />}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border" style={{ borderColor: 'var(--border-subtle)' }}>
          <table className="w-full text-xs">
            <thead><tr className="text-left" style={{ background: 'var(--bg-elevated)', color: 'var(--text-muted)' }}>
              <th className="px-3 py-2">Madde</th><th className="px-3 py-2">Başlık</th><th className="px-3 py-2">Bölüm</th><th className="px-3 py-2">Beklenen</th><th className="px-3 py-2 text-right">Geçen</th><th className="px-3 py-2 text-right">Kalan</th><th className="px-3 py-2 text-right">İstisna</th><th className="px-3 py-2" />
            </tr></thead>
            <tbody>
              {items.map((i: NcCisItemRow) => (
                <tr key={i.id} className="border-t align-top cursor-pointer hover:bg-[var(--bg-elevated)]" style={{ borderColor: 'var(--border-subtle)' }} onClick={() => setItemOpen(i)} title="Madde detayını aç">
                  <td className="px-3 py-1.5 font-mono">{i.id}{i.scored ? '' : <span title="CIS'te puanlanmayan (manuel) madde" style={{ color: 'var(--text-muted)' }}> ·m</span>}</td>
                  <td className="px-3 py-1.5"><div className="max-w-[24rem] underline decoration-dotted underline-offset-2">{i.title}</div></td>
                  <td className="px-3 py-1.5" style={{ color: 'var(--text-muted)' }}>{i.section} · L{i.level}</td>
                  <td className="px-3 py-1.5 font-mono">{i.expected || '—'}{i.expectedSource === 'kurum' && <Pill tone="info">kurum</Pill>}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums" style={{ color: 'var(--status-success)' }}>{i.pass}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums font-semibold" style={{ color: i.fail ? 'var(--status-danger)' : undefined }}>{i.fail}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums" style={{ color: 'var(--text-muted)' }}>{i.excepted}{i.exception && <span title={i.exception.note}> ·g</span>}</td>
                  <td className="px-3 py-1.5 text-right whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                    {isAdmin && <>
                      <button onClick={() => setRule({ kind: 'override', itemId: i.id, title: i.title, value: i.expected || '', note: '' })} className="text-[11px] underline mr-2" style={{ color: 'var(--accent)' }}>kendi referansım</button>
                      <button onClick={() => setRule({ kind: 'exception', itemId: i.id, title: i.title, value: '', note: '' })} className="text-[11px] underline" style={{ color: 'var(--text-secondary)' }}>istisnaya al</button>
                    </>}
                  </td>
                </tr>
              ))}
              {!loading && items.length === 0 && <TableEmptyRow colSpan={8} title="Eşleşen madde yok." />}
            </tbody>
          </table>
        </div>
      )}

      {(data?.exceptions?.length || data?.overrides?.length) ? (
        <div className="grid gap-3 md:grid-cols-2">
          <RuleList title={`İstisnalar (${data?.exceptions.length || 0})`} desc="Bu maddeler skor paydasından düşer." rows={(data?.exceptions || []).map((e) => ({ id: e.id, a: e.item_id, b: e.host || 'tüm filo', note: e.note, by: e.created_by }))} isAdmin={isAdmin} busy={busy} onDrop={(id) => dropRule('exception', id)} />
          <RuleList title={`Kurum referansları (${data?.overrides.length || 0})`} desc="CIS değeri yerine bu değer beklenir." rows={(data?.overrides || []).map((o) => ({ id: o.id, a: o.item_id, b: o.expected, note: o.note, by: o.created_by }))} isAdmin={isAdmin} busy={busy} onDrop={(id) => dropRule('override', id)} />
        </div>
      ) : null}

      <Modal open={!!detail} onClose={() => setDetail(null)} title={detail ? `${detail.host} · CIS skoru %${detail.score ?? '—'}` : ''} subtitle={detail ? `${detail.passed} geçti · ${detail.failed} kaldı · ${detail.excepted} istisna · ${detail.skipped} skora girmedi${detail.scanDate ? ` · tarama ${detail.scanDate}` : ''}` : undefined} size="wide">
        {detail && (
          <div className="space-y-2">
            <div className="flex gap-2">
              <button onClick={() => { onOpenHost(detail.host); setDetail(null); }} className="px-2.5 py-1.5 text-xs border rounded-lg" style={{ borderColor: 'var(--border)' }}>Konfigürasyonu aç</button>
              {isAdmin && <button onClick={() => rescan([detail.host])} className="px-2.5 py-1.5 text-xs rounded-lg" style={{ background: 'var(--accent)', color: 'var(--accent-fg, #fff)' }}><BoltIcon className="w-3.5 h-3.5 inline" /> Bu sunucuyu yeniden tara</button>}
            </div>
            <div className="overflow-x-auto rounded-lg border" style={{ borderColor: 'var(--border-subtle)' }}>
              <table className="w-full text-[11px]">
                <thead><tr className="text-left" style={{ background: 'var(--bg-elevated)', color: 'var(--text-muted)' }}><th className="px-2 py-1">Madde</th><th className="px-2 py-1">Durum</th><th className="px-2 py-1">Ölçülen</th><th className="px-2 py-1">Beklenen</th><th className="px-2 py-1">Açıklama</th>{isAdmin && <th className="px-2 py-1" />}</tr></thead>
                <tbody>
                  {[...detail.items].sort((a, b) => cmpItemId(a.id, b.id)).map((c: NcCisCell) => (
                    <tr key={c.id} className="border-t align-top" style={{ borderColor: 'var(--border-subtle)' }}>
                      <td className="px-2 py-1 font-mono whitespace-nowrap" title={c.title}>{c.id}</td>
                      <td className="px-2 py-1"><Pill tone={STATUS_TONE[c.status] || 'neutral'}>{STATUS_TR[c.status] || c.status}</Pill>{!c.counts && c.status !== 'EXCEPTED' && <span style={{ color: 'var(--text-muted)' }} title="skora girmez"> ·</span>}</td>
                      <td className="px-2 py-1 font-mono"><div className="max-w-[14rem] truncate" title={c.observed}>{c.observed || '—'}</div></td>
                      <td className="px-2 py-1 font-mono">{c.expected || '—'}{c.expectedSource === 'kurum' && <span title="kurum referansı" style={{ color: 'var(--accent)' }}> *</span>}</td>
                      <td className="px-2 py-1"><div className="max-w-[22rem]" title={c.fix}>{c.status === 'EXCEPTED' ? <i>{c.exceptionNote}</i> : c.title}{c.detail ? <span style={{ color: 'var(--text-muted)' }}> — {c.detail}</span> : null}</div></td>
                      {isAdmin && (
                        <td className="px-2 py-1 text-right whitespace-nowrap">
                          {c.status === 'FAIL' && <>
                            <button onClick={() => setRule({ kind: 'override', itemId: c.id, title: c.title, value: c.observed || '', note: '' })} className="underline mr-2" style={{ color: 'var(--accent)' }}>referansım</button>
                            <button onClick={() => setRule({ kind: 'exception', itemId: c.id, title: c.title, host: detail.host, value: '', note: '' })} className="underline" style={{ color: 'var(--text-secondary)' }}>istisna</button>
                          </>}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </Modal>

      <Modal open={!!itemOpen} onClose={() => setItemOpen(null)} title={itemOpen ? `CIS ${itemOpen.id} · ${itemOpen.title}` : ''} subtitle={itemOpen ? `${itemOpen.section} · Seviye ${itemOpen.level}${itemOpen.scored ? '' : ' · CIS’te puanlanmayan (manuel) madde'}` : undefined} size="wide">
        {itemOpen && (
          <div className="space-y-3 text-xs">
            <div className="grid gap-2 md:grid-cols-3">
              <Box label="Beklenen değer">
                <span className="font-mono">{itemOpen.expected || '—'}</span>
                {itemOpen.expectedSource === 'kurum' ? <Pill tone="info">kurum referansı</Pill> : itemOpen.expected ? <Pill tone="neutral">CIS önerisi</Pill> : null}
              </Box>
              <Box label="Filo durumu">
                <span style={{ color: 'var(--status-success)' }}>{itemOpen.pass} geçti</span> ·{' '}
                <span style={{ color: itemOpen.fail ? 'var(--status-danger)' : undefined }}>{itemOpen.fail} kaldı</span> ·{' '}
                <span style={{ color: 'var(--text-muted)' }}>{itemOpen.excepted} istisna · {itemOpen.other} skor dışı</span>
              </Box>
              <Box label="İstisna">
                {itemOpen.exception ? <span title={itemOpen.exception.note}>tüm filo için istisna — {itemOpen.exception.note}</span> : <span style={{ color: 'var(--text-muted)' }}>yok</span>}
              </Box>
            </div>
            {itemOpen.rationale && <Box label="Neden önemli?"><span style={{ color: 'var(--text-secondary)' }}>{itemOpen.rationale}</span></Box>}
            {itemOpen.check && <Box label="Nasıl ölçülüyor?"><span className="font-mono text-[11px]" style={{ color: 'var(--text-secondary)' }}>{itemOpen.check}</span></Box>}
            <Box label="Nasıl düzeltilir?"><span className="font-mono text-[11px]">{itemOpen.fix}</span></Box>
            {isAdmin && (
              <div className="flex gap-2">
                <button onClick={() => { setRule({ kind: 'override', itemId: itemOpen.id, title: itemOpen.title, value: itemOpen.expected || '', note: '' }); setItemOpen(null); }} className="px-2.5 py-1.5 border rounded-lg" style={{ borderColor: 'var(--border)' }}>Kendi referansımı tanımla</button>
                <button onClick={() => { setRule({ kind: 'exception', itemId: itemOpen.id, title: itemOpen.title, value: '', note: '' }); setItemOpen(null); }} className="px-2.5 py-1.5 border rounded-lg" style={{ borderColor: 'var(--border)' }}>Tüm filoda istisnaya al</button>
              </div>
            )}
            <div>
              <div className="font-semibold mb-1">Sunucular ({(itemOpen.hosts || []).length})</div>
              <div className="max-h-[45vh] overflow-auto rounded-lg border" style={{ borderColor: 'var(--border-subtle)' }}>
                <table className="w-full text-[11px]">
                  <thead><tr className="text-left" style={{ background: 'var(--bg-elevated)', color: 'var(--text-muted)' }}><th className="px-2 py-1">Sunucu</th><th className="px-2 py-1">Durum</th><th className="px-2 py-1">Ölçülen</th><th className="px-2 py-1">Açıklama</th></tr></thead>
                  <tbody>
                    {[...(itemOpen.hosts || [])]
                      .sort((a, b) => (a.status === 'FAIL' ? 0 : a.status === 'EXCEPTED' ? 2 : 1) - (b.status === 'FAIL' ? 0 : b.status === 'EXCEPTED' ? 2 : 1) || a.host.localeCompare(b.host))
                      .map((h) => (
                        <tr key={h.host} className="border-t" style={{ borderColor: 'var(--border-subtle)' }}>
                          <td className="px-2 py-1 font-mono"><button className="underline" style={{ color: 'var(--accent)' }} onClick={() => { setItemOpen(null); openHost(h.host); }}>{h.host.toLowerCase()}</button></td>
                          <td className="px-2 py-1"><Pill tone={STATUS_TONE[h.status] || 'neutral'}>{STATUS_TR[h.status] || h.status}</Pill></td>
                          <td className="px-2 py-1 font-mono"><div className="max-w-[16rem] truncate" title={h.observed}>{h.observed || '—'}</div></td>
                          <td className="px-2 py-1"><div className="max-w-[22rem] truncate" title={h.exceptionNote || h.detail}>{h.status === 'EXCEPTED' ? <i>{h.exceptionNote}</i> : h.detail}</div></td>
                        </tr>
                      ))}
                    {(itemOpen.hosts || []).length === 0 && <TableEmptyRow colSpan={4} title="Bu madde için sunucu verisi yok." />}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </Modal>

      <Modal open={!!rule} onClose={() => setRule(null)} title={rule ? (rule.kind === 'exception' ? `İstisna · ${rule.itemId}` : `Kurum referansı · ${rule.itemId}`) : ''} subtitle={rule?.title}>
        {rule && (
          <div className="space-y-2 text-xs">
            {rule.kind === 'override' ? (
              <label className="block">Beklenen değer (CIS yerine bu değer aranır)
                <input value={rule.value} onChange={(e) => setRule({ ...rule, value: e.target.value })} className="mt-1 w-full px-2 py-1.5 border rounded-lg font-mono" style={{ borderColor: 'var(--border)' }} placeholder="ör. 10m" />
              </label>
            ) : (
              <div style={{ color: 'var(--text-secondary)' }}>{rule.host ? <>Yalnız <b>{rule.host}</b> için istisna.</> : <>Tüm filo için istisna (madde hiçbir sunucunun skorunda sayılmaz).</>}</div>
            )}
            <label className="block">Not (zorunlu — gerekçe)
              <input value={rule.note} onChange={(e) => setRule({ ...rule, note: e.target.value })} className="mt-1 w-full px-2 py-1.5 border rounded-lg" style={{ borderColor: 'var(--border)' }} placeholder="neden?" />
            </label>
            <div className="flex justify-end gap-2 pt-1">
              <button onClick={() => setRule(null)} className="px-3 py-1.5 border rounded-lg" style={{ borderColor: 'var(--border)' }}>İptal</button>
              <button onClick={saveRule} disabled={busy || !rule.note.trim() || (rule.kind === 'override' && !rule.value.trim())} className="px-3 py-1.5 rounded-lg disabled:opacity-40" style={{ background: 'var(--accent)', color: 'var(--accent-fg, #fff)' }}>Kaydet</button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

function Box({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border p-2" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-surface)' }}>
      <div className="text-[10px] uppercase tracking-wide mb-0.5" style={{ color: 'var(--text-muted)' }}>{label}</div>
      <div>{children}</div>
    </div>
  );
}

function Tile({ n, l, color }: { n: string; l: string; color?: string }) {
  return (
    <div className="rounded-xl border p-3" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-surface)' }}>
      <div className="text-2xl font-semibold tabular-nums" style={{ color }}>{n}</div>
      <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>{l}</div>
    </div>
  );
}

function RuleList({ title, desc, rows, isAdmin, busy, onDrop }: { title: string; desc: string; rows: { id: number; a: string; b: string; note: string | null; by?: string | null }[]; isAdmin: boolean; busy: boolean; onDrop: (id: number) => void }) {
  return (
    <div className="rounded-xl border p-3" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-surface)' }}>
      <div className="text-xs font-semibold">{title}</div>
      <div className="text-[11px] mb-1" style={{ color: 'var(--text-muted)' }}>{desc}</div>
      <div className="max-h-48 overflow-auto">
        {rows.length === 0 ? <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>Kayıt yok.</div> : rows.map((r) => (
          <div key={r.id} className="flex items-center gap-2 py-1 border-t text-[11px]" style={{ borderColor: 'var(--border-subtle)' }}>
            <span className="font-mono">{r.a}</span>
            <span className="font-mono" style={{ color: 'var(--text-secondary)' }}>{r.b}</span>
            <span className="truncate flex-1" title={r.note || ''} style={{ color: 'var(--text-muted)' }}>{r.note}</span>
            {r.by && <span style={{ color: 'var(--text-muted)' }}>{r.by}</span>}
            {isAdmin && <button onClick={() => onDrop(r.id)} disabled={busy} className="underline" style={{ color: 'var(--status-danger)' }}>kaldır</button>}
          </div>
        ))}
      </div>
    </div>
  );
}
