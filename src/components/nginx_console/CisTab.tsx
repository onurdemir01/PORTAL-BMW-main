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
import { fmtDateTime } from '@/utils/datetime';
import { toast } from '@/hooks/useToast';
import { fmtNumber } from '@/utils/datetime';
import { nginxCisApi, CIS_HOST_ALL, type NcCisOverview, type NcCisItemRow, type NcCisHostRow, type NcCisHostDetail, type NcCisCell, type NcCisOverride, type NcCisObservedValue } from '@/api/nginxCisApi';

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
  // `values`: o maddede filoda OLCULEN degerler — referans penceresinde tek tikla secilir
  // (2026-09-22 kullanici: "bazi maddelerde eklenecek degerde karisiklik var").
  const [rule, setRule] = useState<{ kind: 'exception' | 'override'; itemId: string; title: string; host?: string; value: string; note: string; values?: NcCisObservedValue[] } | null>(null);
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
  // Mevcut kurallar (kullanici, 2026-09-22): "istisna olanlar butonlardan belli olmuyor, ust uste
  // istisnaya al'a basabiliyorum." Dugmeler artik DURUM gosterir: istisna/kurum referansi varsa
  // "kaldir" / "degistir" olur, ayni kural ikinci kez eklenemez.
  const excById = useMemo(() => new Map((data?.exceptions || []).filter((e) => !e.host).map((e) => [e.item_id, e])), [data]);
  const excByHostItem = useMemo(() => new Map((data?.exceptions || []).filter((e) => e.host && e.item_id !== CIS_HOST_ALL).map((e) => [`${String(e.host).toUpperCase()}|${e.item_id}`, e])), [data]);
  // Sunucuyu KOMPLE istisnaya alma (kullanici, 2026-09-24): o sunucudaki her madde istisna
  // sayilir, skoru "—" olur ve filo ortalamasina girmez.
  const excByHostAll = useMemo(() => new Map((data?.exceptions || []).filter((e) => e.host && e.item_id === CIS_HOST_ALL).map((e) => [String(e.host).toUpperCase(), e])), [data]);
  // Bir madde icin BIRDEN FAZLA kabul edilen deger olabilir (kullanici, 2026-09-22).
  const ovrByItem = useMemo(() => {
    const m = new Map<string, NcCisOverride[]>();
    for (const o of data?.overrides || []) { const a = m.get(o.item_id) || []; a.push(o); m.set(o.item_id, a); }
    return m;
  }, [data]);

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

  /** Bir maddenin filoda olculen degerleri (madde satirindan ya da filo ozetinden). */
  const observedOf = (itemId: string): NcCisObservedValue[] =>
    (data?.perItem || []).find((p) => p.id === itemId)?.observedValues || [];

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
      setRule(null);
      const fresh = await nginxCisApi.overview(true);
      if (fresh.ok) setData(fresh);
      // SONUCU SOYLE (2026-09-22): "referansi ekledim ama gectigini yazmiyor" — kaydin
      // ardindan kac sunucunun gectigi/kaldigi dogrudan bildirilir.
      const row = fresh.ok ? (fresh.perItem || []).find((p) => p.id === rule.itemId) : null;
      if (rule.kind === 'exception') toast.success('İstisna kaydedildi; madde skordan düştü.');
      else if (row) toast.success(`Kurum referansı kaydedildi — ${rule.itemId}: ${row.pass} sunucu geçiyor, ${row.fail} sunucu kalıyor.`);
      else toast.success('Kurum referansı kaydedildi; skor yeniden hesaplandı.');
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
          {!!s.exceptedHosts && <Tile n={fmtNumber(s.exceptedHosts)} l="komple istisna sunucu" />}
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
        <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{s?.scannedAt ? `tarama ${fmtDateTime(s.scannedAt)}` : s?.scanDate ? `tarama ${s.scanDate}` : ''}</span>
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
                  <td className="px-3 py-1.5 font-mono font-semibold">
                    {h.host.toLowerCase()}
                    {excByHostAll.has(h.host.toUpperCase()) && (
                      <span className="ml-1.5 font-sans font-normal" title={`Komple istisna — gerekçe: ${excByHostAll.get(h.host.toUpperCase())?.note || ''}`}>
                        <Pill tone="info">komple istisna</Pill>
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-1.5" style={{ color: 'var(--text-secondary)' }}>{h.nginxVersion || '—'}</td>
                  <td className="px-3 py-1.5">{h.tState === 'ok' ? <Pill tone="success">geçerli</Pill> : h.tState === 'fail' ? <Pill tone="danger">HATA</Pill> : '—'}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums font-semibold" style={{ color: scoreColor(h.score) }}>{h.score == null ? '—' : `%${h.score}`}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{h.passed}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums" style={{ color: h.failed ? 'var(--status-danger)' : undefined }}>{h.failed}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums" style={{ color: 'var(--text-muted)' }}>{h.excepted}</td>
                  <td className="px-3 py-1.5" style={{ color: 'var(--text-muted)' }} title={h.scannedAt ? fmtDateTime(h.scannedAt) : ''}>{h.scannedAt ? fmtDateTime(h.scannedAt) : h.scanDate || '—'}</td>
                  <td className="px-3 py-1.5 text-right whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                    {isAdmin && <button onClick={() => rescan([h.host])} className="text-[11px] underline" style={{ color: 'var(--accent)' }} title="Yalnız bu sunucuda CIS taramasını yeniden koş">tazele</button>}
                    {isAdmin && (excByHostAll.has(h.host.toUpperCase())
                      ? <button onClick={() => dropRule('exception', excByHostAll.get(h.host.toUpperCase())!.id)} disabled={busy} className="ml-2 text-[11px] underline" style={{ color: 'var(--status-danger)' }} title={`İstisna gerekçesi: ${excByHostAll.get(h.host.toUpperCase())?.note}`}>istisnadan çıkar</button>
                      : <button onClick={() => setRule({ kind: 'exception', itemId: CIS_HOST_ALL, title: `${h.host.toLowerCase()} — tüm maddeler`, host: h.host, value: '', note: '' })} disabled={busy} className="ml-2 text-[11px] underline" style={{ color: 'var(--text-secondary)' }} title="Bu sunucudaki TÜM maddeler istisna sayılır; skoru “—” olur ve filo ortalamasına girmez">komple istisnaya al</button>)}
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
                  <td className="px-3 py-1.5 font-mono">{i.expected || '—'}{i.expectedSource === 'kurum' && <span className="ml-1"><Pill tone="info">kurum referansı</Pill></span>}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums" style={{ color: 'var(--status-success)' }}>{i.pass}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums font-semibold" style={{ color: i.fail ? 'var(--status-danger)' : undefined }}>{i.fail}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums" style={{ color: 'var(--text-muted)' }}>
                    {i.excepted}{i.exception && <span className="ml-1"><Pill tone="info">tüm filo istisna</Pill></span>}
                  </td>
                  <td className="px-3 py-1.5 text-right whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                    {isAdmin && <>
                      <button onClick={() => setRule({ kind: 'override', itemId: i.id, title: i.title, value: '', note: '', values: i.observedValues || [] })} className="text-[11px] underline mr-2" style={{ color: 'var(--accent)' }} title={(ovrByItem.get(i.id) || []).length ? `Kabul edilen değerler: ${(ovrByItem.get(i.id) || []).map((o) => o.expected).join(', ')} — bu düğme yenisini ekler` : 'CIS önerisi yerine kurum değerini tanımla'}>{(ovrByItem.get(i.id) || []).length ? `referans ekle (${(ovrByItem.get(i.id) || []).length})` : 'kendi referansım'}</button>
                      {excById.get(i.id)
                        ? <button onClick={() => dropRule('exception', excById.get(i.id)!.id)} disabled={busy} className="text-[11px] underline" style={{ color: 'var(--status-danger)' }} title={`İstisna gerekçesi: ${excById.get(i.id)?.note}`}>istisnadan çıkar</button>
                        : <button onClick={() => setRule({ kind: 'exception', itemId: i.id, title: i.title, value: '', note: '' })} className="text-[11px] underline" style={{ color: 'var(--text-secondary)' }}>istisnaya al</button>}
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
          <RuleList title={`İstisnalar (${data?.exceptions.length || 0})`} desc="Skor paydasından düşer; “kaldır” dediğinizde madde yeniden sayılmaya başlar." rows={(data?.exceptions || []).map((e) => ({ id: e.id, a: e.item_id === CIS_HOST_ALL ? 'tüm maddeler' : e.item_id, b: e.host || 'tüm filo', note: e.note, by: e.created_by }))} isAdmin={isAdmin} busy={busy} onDrop={(id) => dropRule('exception', id)} />
          <RuleList title={`Kabul edilen değerler (${data?.overrides.length || 0})`} desc="CIS önerisi yerine bu değerler beklenir; bir maddede birden fazla değer olabilir." rows={(data?.overrides || []).map((o) => ({ id: o.id, a: o.item_id, b: o.expected, note: o.note, by: o.created_by }))} isAdmin={isAdmin} busy={busy} onDrop={(id) => dropRule('override', id)} />
        </div>
      ) : null}

      <Modal open={!!detail} onClose={() => setDetail(null)} title={detail ? `${detail.host} · CIS skoru %${detail.score ?? '—'}` : ''} subtitle={detail ? `${detail.passed} geçti · ${detail.failed} kaldı · ${detail.excepted} istisna · ${detail.skipped} skora girmedi${detail.scannedAt ? ` · tarama ${fmtDateTime(detail.scannedAt)}` : detail.scanDate ? ` · tarama ${detail.scanDate}` : ''}` : undefined} size="wide">
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
                          {(() => {
                            const hx = excByHostItem.get(`${detail.host}|${c.id}`);
                            const gx = excById.get(c.id);
                            if (hx) return <button onClick={() => dropRule('exception', hx.id)} disabled={busy} className="underline" style={{ color: 'var(--status-danger)' }} title={`İstisna gerekçesi: ${hx.note}`}>istisnadan çıkar</button>;
                            if (gx) return <span style={{ color: 'var(--text-muted)' }} title={`Tüm filo için istisna: ${gx.note}`}>tüm filo istisnası</span>;
                            if (c.status !== 'FAIL') return null;
                            return (<>
                              <button onClick={() => setRule({ kind: 'override', itemId: c.id, title: c.title, value: c.observed || '', note: '', values: observedOf(c.id) })} className="underline mr-2" style={{ color: 'var(--accent)' }}>{(ovrByItem.get(c.id) || []).length ? 'referans ekle' : 'referansım'}</button>
                              <button onClick={() => setRule({ kind: 'exception', itemId: c.id, title: c.title, host: detail.host, value: '', note: '' })} className="underline" style={{ color: 'var(--text-secondary)' }}>istisna</button>
                            </>);
                          })()}
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
                {itemOpen.expectedSource === 'kurum' ? (
                  <div className="space-y-0.5">
                    {(ovrByItem.get(itemOpen.id) || []).map((o) => (
                      <div key={o.id} className="flex items-center gap-1.5">
                        <span className="font-mono">{o.expected}</span>
                        {o.note && <span style={{ color: 'var(--text-muted)' }} title={o.note}>· {o.note}</span>}
                        {isAdmin && <button onClick={() => dropRule('override', o.id)} disabled={busy} className="underline text-[11px]" style={{ color: 'var(--status-danger)' }}>kaldır</button>}
                      </div>
                    ))}
                    <Pill tone="info">{(ovrByItem.get(itemOpen.id) || []).length > 1 ? `kurum referansı · ${(ovrByItem.get(itemOpen.id) || []).length} değerden biri yeterli` : 'kurum referansı'}</Pill>
                  </div>
                ) : (<><span className="font-mono">{itemOpen.expected || '—'}</span>{itemOpen.expected ? <Pill tone="neutral">CIS önerisi</Pill> : null}</>)}
              </Box>
              <Box label="Filo durumu">
                <span style={{ color: 'var(--status-success)' }}>{itemOpen.pass} geçti</span> ·{' '}
                <span style={{ color: itemOpen.fail ? 'var(--status-danger)' : undefined }}>{itemOpen.fail} kaldı</span> ·{' '}
                <span style={{ color: 'var(--text-muted)' }}>{itemOpen.excepted} istisna · {itemOpen.other} skor dışı</span>
              </Box>
              <Box label="İstisna">
                {itemOpen.exception ? (
                  <div className="flex items-center gap-2 flex-wrap">
                    <span title={itemOpen.exception.note}>tüm filo için istisna — {itemOpen.exception.note}</span>
                    {isAdmin && excById.get(itemOpen.id) && <button onClick={() => { dropRule('exception', excById.get(itemOpen.id)!.id); setItemOpen(null); }} disabled={busy} className="underline text-[11px]" style={{ color: 'var(--status-danger)' }}>istisnadan çıkar</button>}
                  </div>
                ) : <span style={{ color: 'var(--text-muted)' }}>yok</span>}
              </Box>
            </div>
            {(itemOpen.observedValues || []).length > 0 && (
              <Box label="Filoda ölçülen değerler">
                <div className="flex flex-wrap gap-1.5">
                  {(itemOpen.observedValues || []).map((o) => (
                    <span key={o.value} className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border font-mono text-[11px]" style={{ borderColor: 'var(--border)', background: 'var(--bg-elevated)' }} title={`${o.count} sunucu: ${o.hosts.join(', ')}`}>
                      {o.value}
                      <span className="tabular-nums" style={{ color: 'var(--text-muted)' }}>×{o.count}</span>
                      {isAdmin && (
                        <button
                          onClick={() => { setRule({ kind: 'override', itemId: itemOpen.id, title: itemOpen.title, value: o.value, note: '', values: itemOpen.observedValues || [] }); setItemOpen(null); }}
                          className="underline"
                          style={{ color: 'var(--accent)' }}
                          title="Bu ölçülen değeri kurum referansı olarak ekle"
                        >
                          referans yap
                        </button>
                      )}
                    </span>
                  ))}
                </div>
                <div className="mt-1" style={{ color: 'var(--text-muted)' }}>
                  Kurum referansı, <b>ölçülen değerin tamamıyla</b> karşılaştırılır. Birim ve büyük/küçük harf farkı önemsenmez
                  (20M = 20m, 1024k = 1m, 10 = 10s), ancak “header=10 body=10” gibi birleşik ölçümlerde değeri buradan aynen seçin.
                </div>
              </Box>
            )}
            {itemOpen.rationale && <Box label="Neden önemli?"><span style={{ color: 'var(--text-secondary)' }}>{itemOpen.rationale}</span></Box>}
            {itemOpen.check && <Box label="Nasıl ölçülüyor?"><span className="font-mono text-[11px]" style={{ color: 'var(--text-secondary)' }}>{itemOpen.check}</span></Box>}
            <Box label="Nasıl düzeltilir?"><span className="font-mono text-[11px]">{itemOpen.fix}</span></Box>
            {isAdmin && (
              <div className="flex gap-2 flex-wrap">
                <button onClick={() => { setRule({ kind: 'override', itemId: itemOpen.id, title: itemOpen.title, value: '', note: '', values: itemOpen.observedValues || [] }); setItemOpen(null); }} className="px-2.5 py-1.5 border rounded-lg" style={{ borderColor: 'var(--border)' }}>{(ovrByItem.get(itemOpen.id) || []).length ? 'Kabul edilen değer ekle' : 'Kendi referansımı tanımla'}</button>
                {excById.get(itemOpen.id)
                  ? <button onClick={() => { dropRule('exception', excById.get(itemOpen.id)!.id); setItemOpen(null); }} disabled={busy} className="px-2.5 py-1.5 border rounded-lg" style={{ borderColor: 'var(--border)', color: 'var(--status-danger)' }}>İstisnadan çıkar (madde yeniden sayılsın)</button>
                  : <button onClick={() => { setRule({ kind: 'exception', itemId: itemOpen.id, title: itemOpen.title, value: '', note: '' }); setItemOpen(null); }} className="px-2.5 py-1.5 border rounded-lg" style={{ borderColor: 'var(--border)' }}>Tüm filoda istisnaya al</button>}
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

      <Modal open={!!rule} onClose={() => setRule(null)} title={rule ? (rule.kind === 'exception' ? `İstisna · ${rule.itemId}` : `Kabul edilen değer · ${rule.itemId}`) : ''} subtitle={rule?.title}>
        {rule && (
          <div className="space-y-2 text-xs">
            {rule.kind === 'override' && (ovrByItem.get(rule.itemId) || []).length > 0 && (
              <div className="rounded-lg px-2 py-1.5" style={{ background: 'var(--bg-elevated)', color: 'var(--text-secondary)' }}>
                Bu maddede kabul edilen değer(ler) zaten var: <b className="font-mono">{(ovrByItem.get(rule.itemId) || []).map((o) => o.expected).join(', ')}</b>. Yeni değer <b>listeye eklenir</b>; ölçülen değer bunlardan herhangi birine eşitse madde geçer.
              </div>
            )}
            {rule.kind === 'exception' && (rule.host ? excByHostItem.has(`${rule.host}|${rule.itemId}`) : excById.has(rule.itemId)) && (
              <div className="rounded-lg px-2 py-1.5" style={{ background: 'var(--bg-elevated)', color: 'var(--text-secondary)' }}>
                Bu madde için zaten bir istisna var; kaydettiğinizde <b>gerekçesi güncellenir</b>.
              </div>
            )}
            {rule.kind === 'override' ? (
              <>
                <label className="block">Kabul edilen değer (CIS önerisi yerine; aynı maddeye birden fazla değer ekleyebilirsiniz)
                  <input value={rule.value} onChange={(e) => setRule({ ...rule, value: e.target.value })} className="mt-1 w-full px-2 py-1.5 border rounded-lg font-mono" style={{ borderColor: 'var(--border)' }} placeholder="ör. 10m" />
                </label>
                {(rule.values || []).length > 0 ? (
                  <div>
                    <div style={{ color: 'var(--text-muted)' }}>Filoda ölçülen değerler — tıklayın, alana yazılsın:</div>
                    <div className="flex flex-wrap gap-1.5 mt-1">
                      {(rule.values || []).map((o) => (
                        <button
                          key={o.value}
                          type="button"
                          onClick={() => setRule({ ...rule, value: o.value })}
                          className="px-1.5 py-0.5 rounded border font-mono text-[11px]"
                          style={{ borderColor: rule.value === o.value ? 'var(--accent)' : 'var(--border)', background: 'var(--bg-elevated)' }}
                          title={`${o.count} sunucu: ${o.hosts.join(', ')}`}
                        >
                          {o.value} <span className="tabular-nums" style={{ color: 'var(--text-muted)' }}>×{o.count}</span>
                        </button>
                      ))}
                    </div>
                    <div className="mt-1" style={{ color: 'var(--text-muted)' }}>
                      Değer, ölçülen metnin <b>tamamıyla</b> karşılaştırılır; birim/harf farkı önemsenmez (20M = 20m, 1024k = 1m).
                    </div>
                  </div>
                ) : (
                  <div style={{ color: 'var(--text-muted)' }}>Bu madde için henüz ölçülen bir değer yok — tarama koşmadan referans eşleşmesi görünmez.</div>
                )}
              </>
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
