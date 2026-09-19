// src/components/nginx_console/NginxConsolePage.tsx — Nginx Hub (2026-09-19).
//
// Kullanici hayali: "sol menude bir pencere; tum nginx'lere baglanip kontrol edeyim — bir
// servisin makinelerinin konfigurasyon agaci, dosya icerikleri; ekleyip push'layayim; yeni
// sunucuya konfigurasyon olusturup push'layayim; sertifikalar: kimin imzaladigi, ne kadar
// kaldigi, hangi sunucularda/konfigurasyonlarda kullanildigi."
//
// Portal sunuculara YALNIZ Ansible ile ulasir: okuma = nginx_console_fetch.yml dokumu
// (/sw'den okunur), yazma = nginx_console_push.yml (www, kilit, yedek, nginx -t, geri alma,
// reload). Tum filo dokumu 30-40 dk surdugu icin "Yenile" yalniz secili sunuculari gonderir.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowPathIcon, ChevronDownIcon, ChevronRightIcon, DocumentIcon, DocumentPlusIcon, FolderIcon, FolderOpenIcon,
  MagnifyingGlassIcon, PaperAirplaneIcon, ShieldCheckIcon, ServerStackIcon, ArrowUturnLeftIcon, Squares2X2Icon,
} from '@heroicons/react/24/outline';
import { useAsyncEffect } from '@/hooks/useAsyncEffect';
import { useAuth } from '@/contexts/AuthContext';
import { useJobTracker } from '@/contexts/JobTrackerContext';
import { toast } from '@/hooks/useToast';
import { Modal } from '@/components/common/Modal';
import { Pill, Panel, Code } from '@/components/denetim/ui';
import { fmtDateTime, fmtNumber } from '@/utils/datetime';
import { nginxConsoleApi, type NcHost, type NcTree, type NcTreeDir, type NcFile, type NcCertsResult, type NcAggCert, type NcCert } from '@/api/nginxConsoleApi';

type Tab = 'config' | 'certs';
// Panel basliklarindaki kucuk dugmeler: HEPSI ayni boyut/yazi (2026-09-19: btn-primary'nin buyuk
// dolgusu "Sunucular" basligini eziyordu, iki dugmenin yazisi da farkli buyuklukteydi).
const SM_BTN = 'inline-flex items-center gap-1 h-7 px-2.5 text-[11px] font-medium leading-none rounded-lg border whitespace-nowrap disabled:opacity-40';
const smBtn = (primary = false): React.CSSProperties => (primary
  ? { background: 'var(--accent)', borderColor: 'var(--accent)', color: '#fff' }
  : { borderColor: 'var(--border)', background: 'var(--bg-surface)', color: 'var(--text-primary)' });
const TERMINAL = new Set(['successful', 'failed', 'error', 'canceled']);

const fmtBytes = (n: number | null | undefined) => (n == null ? '—' : n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : n >= 1024 ? `${(n / 1024).toFixed(1)} KB` : `${n} B`);
const shortSha = (s: string | null | undefined) => (s ? s.slice(0, 10) : '—');
const ageOf = (iso: string | null | undefined) => {
  if (!iso) return null;
  const h = (Date.now() - new Date(iso).getTime()) / 3600000;
  return h < 1 ? `${Math.max(1, Math.round(h * 60))} dk` : h < 48 ? `${Math.round(h)} sa` : `${Math.round(h / 24)} gün`;
};
const daysTone = (d: number | null): 'danger' | 'warning' | 'success' | 'neutral' => (d == null ? 'neutral' : d < 0 ? 'danger' : d <= 30 ? 'danger' : d <= 90 ? 'warning' : 'success');
const daysLabel = (d: number | null) => (d == null ? '?' : d < 0 ? `${-d} gün önce DOLDU` : `${d} gün`);

/** Instance group = servis (envanter service / services[0]); yoksa 'diğer'. */
const groupKey = (h: NcHost | null | undefined) => (h ? (h.service || h.services?.[0] || 'diğer').toUpperCase() : '');

/** Basit satir farki (LCS). 3000 satir ustunde yalniz sayilar. */
function lineDiff(a: string, b: string): { added: number; removed: number; hunks: string[] } {
  const A = a.replace(/\r\n/g, '\n').split('\n');
  const B = b.replace(/\r\n/g, '\n').split('\n');
  if (A.length * B.length > 9_000_000) {
    const sa = new Set(A), sb = new Set(B);
    return { added: B.filter((l) => !sa.has(l)).length, removed: A.filter((l) => !sb.has(l)).length, hunks: ['(dosya büyük — satır satır fark gösterilmiyor)'] };
  }
  const n = A.length, m = B.length;
  const dp: Uint16Array[] = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out: string[] = [];
  let i = 0, j = 0, added = 0, removed = 0;
  while (i < n && j < m) {
    if (A[i] === B[j]) { out.push('  ' + A[i]); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { out.push('- ' + A[i]); i++; removed++; }
    else { out.push('+ ' + B[j]); j++; added++; }
  }
  while (i < n) { out.push('- ' + A[i++]); removed++; }
  while (j < m) { out.push('+ ' + B[j++]); added++; }
  // Yalniz degisen satirlar + 2 satir baglam
  const keep = new Set<number>();
  out.forEach((l, k) => { if (l[0] !== ' ') for (let c = k - 2; c <= k + 2; c++) keep.add(c); });
  const hunks: string[] = [];
  let last = -2;
  out.forEach((l, k) => { if (!keep.has(k)) return; if (k !== last + 1 && hunks.length) hunks.push('…'); hunks.push(l); last = k; });
  return { added, removed, hunks };
}

export default function NginxConsolePage() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'Admin';
  const [tab, setTab] = useState<Tab>('config');

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold flex items-center gap-2"><ServerStackIcon className="w-6 h-6" style={{ color: 'var(--nginx-green)' }} /> <span className="nginx-hub-label"><span>Nginx</span> <span className="nginx-hub-word">Hub</span></span></h1>
          <p className="text-sm mt-0.5" style={{ color: 'var(--text-muted)' }}>
            Tüm nginx sunucularının konfigürasyon ağacı, dosya içerikleri ve sertifikaları; tek dosya değişikliği push (nginx -t, geri alma, reload). Veriler Ansible dokumundan gelir; zamanlanmış tarama yalnız değişen sunucuları döker (parmak izi), "Yenile" tam dokum alır.
          </p>
        </div>
        <div className="flex gap-1 rounded-lg p-0.5" style={{ background: 'var(--bg-elevated)' }}>
          {([{ id: 'config', label: 'Konfigürasyon', icon: Squares2X2Icon }, { id: 'certs', label: 'Sertifikalar', icon: ShieldCheckIcon }] as const).map((t) => (
            <button key={t.id} onClick={() => setTab(t.id)} className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md ${tab === t.id ? 'shadow-sm' : ''}`} style={{ background: tab === t.id ? 'var(--bg-surface)' : 'transparent', color: tab === t.id ? 'var(--text-primary)' : 'var(--text-muted)' }}>
              <t.icon className="w-4 h-4" /> {t.label}
            </button>
          ))}
        </div>
      </div>
      {tab === 'config' ? <ConfigTab isAdmin={isAdmin} /> : <CertsTab />}
    </div>
  );
}

// ── Konfigurasyon ─────────────────────────────────────────────────────────────────────
function ConfigTab({ isAdmin }: { isAdmin: boolean }) {
  const { addJob } = useJobTracker();
  const [hosts, setHosts] = useState<NcHost[]>([]);
  const [hostsErr, setHostsErr] = useState('');
  const [q, setQ] = useState('');
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [openSvc, setOpenSvc] = useState<Set<string>>(new Set());
  const [cur, setCur] = useState<string | null>(null);
  const [tree, setTree] = useState<NcTree | null>(null);
  const [treeLoading, setTreeLoading] = useState(false);
  const [file, setFile] = useState<NcFile | null>(null);
  const [draft, setDraft] = useState('');
  const [mode, setMode] = useState<'update' | 'create'>('update');
  const [newPath, setNewPath] = useState('');
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [newModal, setNewModal] = useState(false);
  // Publish hedefleri (NIM "instance group"): varsayilan yalniz acik sunucu; ayni servisin
  // dokumu olan diger sunuculari da secilebilir. Host basina beklenen sha karsilastirmadan gelir.
  const [pubHosts, setPubHosts] = useState<Set<string>>(new Set());
  const [pubShas, setPubShas] = useState<Record<string, { sha256: string | null; exists: boolean }>>({});
  const [compare, setCompare] = useState<{ path: string; rows: { host: string; exists: boolean; sha256: string | null; mtime: string | null }[]; variants: number } | null>(null);

  const loadHosts = useCallback(async () => {
    try {
      const r = await nginxConsoleApi.hosts();
      if (r.ok) { setHosts(r.hosts); setHostsErr(r.inventoryError ? `Envanter okunamadı (${r.inventoryError}); yalnız dokumu olan sunucular listelendi.` : ''); }
      else setHostsErr('Sunucu listesi alınamadı.');
    } catch (e) { setHostsErr(e instanceof Error ? e.message : String(e)); }
  }, []);
  useAsyncEffect(async () => { await loadHosts(); }, [loadHosts]);

  const loadTree = useCallback(async (h: string) => {
    setTreeLoading(true);
    try { setTree(await nginxConsoleApi.tree(h)); } finally { setTreeLoading(false); }
  }, []);
  useEffect(() => { if (cur) { setFile(null); setDraft(''); setMode('update'); loadTree(cur); } }, [cur, loadTree]);

  const openFile = async (p: string) => {
    if (!cur) return;
    const f = await nginxConsoleApi.file(cur, p);
    if (!f.ok) { toast.error(f.message || 'Dosya okunamadı.'); return; }
    setFile(f); setDraft(f.content || ''); setMode('update'); setNewPath('');
  };

  // Servis -> sunucular
  const groups = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const g = new Map<string, NcHost[]>();
    for (const h of hosts) {
      if (needle && !(h.host.toLowerCase().includes(needle) || (h.service || '').toLowerCase().includes(needle) || (h.env || '').includes(needle))) continue;
      const key = groupKey(h);
      if (!g.has(key)) g.set(key, []);
      g.get(key)!.push(h);
    }
    return [...g.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [hosts, q]);

  function trackJob(title: string, r: { jobId: number | null; awxServerId: number }, onDone?: () => void) {
    if (r.jobId == null) return;
    let done = false;
    addJob({
      title,
      fetchStatus: async () => {
        const s = await nginxConsoleApi.jobStatus(r.awxServerId, r.jobId as number);
        if (!s.ok) throw new Error(s.message || 'Durum okunamadı.');
        if (TERMINAL.has(s.status) && !done) { done = true; onDone?.(); }
        return { status: s.status, output: s.output || '', result: s.result };
      },
    });
  }

  // Onaylar Portal'in kendi penceresinde (tarayici confirm'i YOK — kullanici, 2026-09-19)
  const [ask, setAsk] = useState<{ title: string; body: React.ReactNode; okLabel: string; onOk: () => void } | null>(null);
  const refresh = async (list: string[], all = false, confirmed = false) => {
    if (!all && !list.length) return;
    if (!confirmed && all) {
      setAsk({ title: 'Tüm filoyu yenile', okLabel: 'Başlat', onOk: () => refresh([], true, true), body: <>Tüm nginx sunucuları envanterden keşfedilip dokumu alınacak (<b>{hosts.length}</b> sunucu). Sunucu başına birkaç saniye; filo geneli AWX forks ayarına göre dakikalar sürebilir. İş penceresinden izlenebilir.</> });
      return;
    }
    if (!confirmed && !all && list.length > 20) {
      setAsk({ title: `${list.length} sunucuyu yenile`, okLabel: 'Başlat', onOk: () => refresh(list, false, true), body: <>{list.length} sunucunun dokumu alınacak. Devam edilsin mi?</> });
      return;
    }
    setBusy(true);
    try {
      const r = await nginxConsoleApi.refresh(all ? [] : list, all);
      if (!r.ok) { toast.error(r.message || 'Başlatılamadı.'); return; }
      toast.success(`Dokum başlatıldı (job ${r.jobId}) — bitince liste kendini yeniler.`);
      trackJob(all ? `Nginx dokum · TÜM filo #${r.jobId}` : `Nginx dokum · ${list.length} sunucu #${r.jobId}`, r, () => { loadHosts(); if (cur && (all || list.includes(cur))) loadTree(cur); });
    } catch (e) { toast.error(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };

  // Onay penceresi acilirken: hedef = acik sunucu; ayni servisin diger sunucularinda bu dosya var mi/sha ne?
  const openConfirm = async () => {
    if (!cur) return;
    const p = mode === 'create' ? newPath.trim() : file?.path || '';
    const group = hosts.filter((h) => h.dumpedAt && groupKey(h) === groupKey(curHost)).map((h) => h.host);
    setPubHosts(new Set([cur]));
    try {
      const r = await nginxConsoleApi.compare(p, group.length ? group : [cur]);
      if (r.ok) setPubShas(Object.fromEntries(r.rows.map((x) => [x.host, { sha256: x.sha256, exists: x.exists }])));
    } catch { setPubShas({}); }
    setConfirm(true);
  };

  const doPush = async (force = false) => {
    if (!cur) return;
    const p = mode === 'create' ? newPath.trim() : file?.path || '';
    const targets = [...pubHosts];
    const expectedSha: Record<string, string> = {};
    for (const h of targets) { const sha = h === cur && file ? file.sha256 : pubShas[h]?.sha256; if (sha) expectedSha[h] = sha; }
    setBusy(true);
    try {
      const r = await nginxConsoleApi.push({ hosts: targets, path: p, mode, content: draft, expectedSha, force });
      if (!r.ok) {
        if (r.conflicts?.length) {
          setAsk({ title: 'Ön kontrol uyarısı', okLabel: 'Yine de yayınla (force)', onOk: () => { doPush(true); }, body: <><div>{r.message}</div><div className="mt-1" style={{ color: 'var(--text-muted)' }}>Force ile sunucudaki mevcut hal üzerine yazılır; yedek yine alınır.</div></> });
          return;
        }
        toast.error(r.message || 'Publish başlatılamadı.'); return;
      }
      setConfirm(false);
      toast.success(`Publish başlatıldı (job ${r.jobId}, ${targets.length} sunucu) — sonuç iş penceresinde; bitince dosya yeniden okunur.`);
      trackJob(`Nginx publish · ${p.split('/').pop()} → ${targets.length === 1 ? targets[0] : targets.length + ' sunucu'} #${r.jobId}`, r, async () => { await loadTree(cur); if (mode === 'create') { setMode('update'); await openFile(p); } else await openFile(p); loadHosts(); });
    } catch (e) { toast.error(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };

  const dirty = mode === 'create' ? draft.trim().length > 0 : !!file && draft !== (file.content || '');
  const diff = useMemo(() => (confirm ? lineDiff(mode === 'create' ? '' : file?.content || '', draft) : null), [confirm, draft, file, mode]);
  const curHost = hosts.find((h) => h.host === cur) || null;
  const groupHosts = useMemo(() => hosts.filter((h) => h.dumpedAt && h.host !== cur && groupKey(h) === groupKey(curHost)), [hosts, cur, curHost]);

  return (
    <div className="grid gap-3 grid-cols-1 xl:[grid-template-columns:minmax(16rem,20rem)_minmax(16rem,22rem)_1fr]">
      {/* Sol: sunucular */}
      <Panel dense title={<span className="flex items-center gap-2">Sunucular <span className="text-[10px] font-normal" style={{ color: 'var(--text-muted)' }}>{hosts.length}</span></span>}>
        <div className="p-2 space-y-2">
          <div className="relative">
            <MagnifyingGlassIcon className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-muted)' }} />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="sunucu / servis / ortam" className="w-full pl-8 pr-2 py-1.5 text-xs border rounded-lg" style={{ borderColor: 'var(--border)' }} />
          </div>
          {/* Dokum araclari: baslik satirinda DEGIL, arama kutusunun altinda kendi satirinda */}
          <div className="flex items-center gap-1.5 flex-wrap">
            <button disabled={busy || checked.size === 0} onClick={() => refresh([...checked])} className={SM_BTN} style={smBtn(true)} title="Seçili sunucuların dokumunu Ansible ile yenile (sunucu başına saniyeler)">
              <ArrowPathIcon className="w-3.5 h-3.5" />Seçilileri yenile{checked.size ? ` (${checked.size})` : ''}
            </button>
            <button disabled={busy} onClick={() => refresh([], true)} className={SM_BTN} style={smBtn()} title="Tüm nginx filosu envanterden keşfedilir (nginx_audit ile aynı betik) — 30-40 dk">Tüm filo</button>
            {checked.size > 0 && <button onClick={() => setChecked(new Set())} className={SM_BTN} style={smBtn()} title="seçimi temizle">Temizle</button>}
          </div>
          {hostsErr && <div className="text-[11px] text-amber-700">{hostsErr}</div>}
          <div className="max-h-[70vh] overflow-y-auto space-y-1">
            {groups.map(([svc, list]) => {
              const open = openSvc.has(svc) || !!q;
              const allChecked = list.every((h) => checked.has(h.host));
              return (
                <div key={svc} className="rounded-lg border" style={{ borderColor: 'var(--border-subtle)' }}>
                  <div className="flex items-center gap-1 px-2 py-1">
                    <button onClick={() => setOpenSvc((s) => { const n = new Set(s); n.has(svc) ? n.delete(svc) : n.add(svc); return n; })} className="flex items-center gap-1 text-xs font-semibold flex-1 text-left">
                      {open ? <ChevronDownIcon className="w-3.5 h-3.5" /> : <ChevronRightIcon className="w-3.5 h-3.5" />}{svc}
                      <span className="text-[10px] font-normal" style={{ color: 'var(--text-muted)' }}>{list.length}</span>
                    </button>
                    <input type="checkbox" checked={allChecked} onChange={(e) => setChecked((s) => { const n = new Set(s); list.forEach((h) => (e.target.checked ? n.add(h.host) : n.delete(h.host))); return n; })} title="servisin tüm sunucularını seç" />
                  </div>
                  {open && list.map((h) => (
                    <div key={h.host} className={`flex items-center gap-1.5 px-2 py-1 text-xs cursor-pointer ${cur === h.host ? 'font-semibold' : ''}`} style={{ background: cur === h.host ? 'var(--bg-elevated)' : undefined }} onClick={() => setCur(h.host)}>
                      <input type="checkbox" checked={checked.has(h.host)} onClick={(e) => e.stopPropagation()} onChange={(e) => setChecked((s) => { const n = new Set(s); e.target.checked ? n.add(h.host) : n.delete(h.host); return n; })} />
                      <span className="font-mono flex-1 truncate" title={`${h.host}${h.ip ? ' · ' + h.ip : ''}${h.nginxVersion ? ' · nginx ' + h.nginxVersion : ''}`}>{h.host}</span>
                      {h.env && <span className="text-[9px] uppercase px-1 rounded border" style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-muted)' }}>{h.env}</span>}
                      {h.dumpedAt ? (
                        <span className={`w-2 h-2 rounded-full ${h.nginxT === 'fail' ? 'bg-red-500' : 'bg-green-500'}`} title={`dokum ${ageOf(h.dumpedAt)} önce · nginx -t ${h.nginxT || '?'}${h.certMinDays != null ? ` · en yakın sertifika ${daysLabel(h.certMinDays)}` : ''}`} />
                      ) : (
                        <span className="w-2 h-2 rounded-full bg-gray-300" title="dokum yok — Yenile" />
                      )}
                    </div>
                  ))}
                </div>
              );
            })}
            {groups.length === 0 && <div className="text-xs p-2" style={{ color: 'var(--text-muted)' }}>Sunucu yok.</div>}
          </div>
        </div>
      </Panel>

      {/* Orta: agac */}
      <Panel dense title={cur ? <span className="font-mono">{cur}</span> : 'Konfigürasyon ağacı'}
        actions={cur && (
          <div className="flex items-center gap-1">
            <button disabled={busy} onClick={() => refresh([cur])} className={SM_BTN} style={smBtn()} title="Bu sunucunun dokumunu yenile"><ArrowPathIcon className="w-3.5 h-3.5" />Yenile</button>
            {isAdmin && <button disabled={busy || !tree?.dumped} onClick={() => { setNewModal(true); }} className={SM_BTN} style={smBtn()} title="Bu sunucuda yeni konfigürasyon dosyası"><DocumentPlusIcon className="w-3.5 h-3.5" />Yeni dosya</button>}
          </div>
        )}>
        <div className="p-2 max-h-[75vh] overflow-auto text-xs">
          {!cur && <div style={{ color: 'var(--text-muted)' }}>Soldan bir sunucu seçin.</div>}
          {cur && treeLoading && <div style={{ color: 'var(--text-muted)' }}>Yükleniyor…</div>}
          {cur && tree && !tree.dumped && <div className="text-amber-700">{tree.message}</div>}
          {cur && tree?.dumped && (
            <>
              <div className="mb-2 flex flex-wrap gap-2 items-center" style={{ color: 'var(--text-muted)' }}>
                <span>dokum {fmtDateTime(tree.dumpedAt || null)} ({ageOf(tree.dumpedAt)} önce)</span>
                <Pill tone={tree.nginxT?.status === 'ok' ? 'success' : 'danger'} title={tree.nginxT?.output}>nginx -t {tree.nginxT?.status}</Pill>
                <span>{tree.fileCount} dosya · {tree.certs?.length || 0} sertifika</span>
                {curHost?.service && <span>servis {curHost.service}</span>}
              </div>
              {tree.tree && <TreeNode node={tree.tree} depth={0} onOpen={openFile} current={file?.path || null} defaultOpen />}
            </>
          )}
        </div>
      </Panel>

      {/* Sag: editor */}
      <Panel dense title={
        mode === 'create' ? <span title={newPath}>Yeni dosya · <span className="font-mono text-[11px]">{newPath.split('/').pop()}</span></span> : file ? <span className="font-mono text-[12px]" title={file.path}>{file.path.split('/').pop()}</span> : 'Dosya'
      } actions={(file || mode === 'create') && (
        <div className="flex items-center gap-1">
          {file && mode === 'update' && (
            <button onClick={async () => { const r = await nginxConsoleApi.compare(file.path); if (r.ok) setCompare(r); }} className={SM_BTN} style={smBtn()} title="Bu yol diğer sunucularda aynı mı?">Diğer sunucularda</button>
          )}
          <button disabled={!dirty} onClick={() => { if (mode === 'create') { setMode('update'); setDraft(file?.content || ''); } else setDraft(file?.content || ''); }} className={SM_BTN} style={smBtn()}><ArrowUturnLeftIcon className="w-3.5 h-3.5" />Geri al</button>
          {isAdmin && <button disabled={!dirty || busy} onClick={openConfirm} className={SM_BTN} style={smBtn(true)} title="Sunucuya yayınla: kilit → yedek → yaz → nginx -t → reload"><PaperAirplaneIcon className="w-3.5 h-3.5" />Yayınla (Publish)</button>}
        </div>
      )}>
        <div className="p-2">
          {!file && mode !== 'create' && <div className="text-xs" style={{ color: 'var(--text-muted)' }}>Ağaçtan bir dosya seçin{isAdmin ? ' ya da "Yeni dosya" oluşturun' : ''}.</div>}
          {(file || mode === 'create') && (
            <>
              {file && mode === 'update' && (
                <div className="mb-1 text-[11px] flex flex-wrap gap-3" style={{ color: 'var(--text-muted)' }}>
                  <span className="font-mono break-all">{file.path}</span>
                  <span>sha {shortSha(file.sha256)}</span><span>{fmtBytes(file.size)}</span><span>değişim {file.mtime || '—'}</span>
                  {dirty && <Pill tone="warning">değişti — push'lanmadı</Pill>}
                  {file.tooLarge && <Pill tone="danger">512 KB üstü — içerik dokumde yok</Pill>}
                </div>
              )}
              <textarea value={draft} onChange={(e) => setDraft(e.target.value)} readOnly={!isAdmin || !!file?.tooLarge} spellCheck={false} className="w-full font-mono text-[12px] leading-5 p-2 border rounded-lg" style={{ minHeight: '65vh', borderColor: 'var(--border)', background: 'var(--bg-base)', color: 'var(--text-primary)', tabSize: 4 }} />
              {!isAdmin && <div className="text-[11px] mt-1" style={{ color: 'var(--text-muted)' }}>Salt okunur — değişiklik yalnız Admin.</div>}
            </>
          )}
        </div>
      </Panel>

      {/* Onay */}
      <Modal open={confirm} onClose={() => setConfirm(false)} title={`Publish · ${mode === 'create' ? 'yeni dosya' : 'değişiklik'}`} subtitle={mode === 'create' ? newPath : file?.path} size="lg"
        footer={<div className="flex justify-end gap-2"><button onClick={() => setConfirm(false)} className="px-3 py-1.5 text-xs rounded-lg border" style={{ borderColor: 'var(--border)' }}>İptal</button><button disabled={busy || pubHosts.size === 0} onClick={() => doPush(false)} className="btn-primary px-3 py-1.5 text-xs rounded-lg disabled:opacity-40">Yayınla ({pubHosts.size} sunucu)</button></div>}>
        <div className="space-y-2 text-xs">
          {/* Hedefler: acik sunucu + ayni servisin (instance group) diger sunuculari */}
          <div className="rounded-lg border p-2" style={{ borderColor: 'var(--border-subtle)' }}>
            <div className="font-semibold mb-1">Hedef sunucular <span className="font-normal" style={{ color: 'var(--text-muted)' }}>— {groupKey(curHost)} grubu</span></div>
            <div className="flex flex-wrap gap-2">
              {[curHost, ...groupHosts].filter(Boolean).map((h) => {
                const hh = h as NcHost; const st = pubShas[hh.host];
                const mySha = hh.host === cur && file ? file.sha256 : st?.sha256;
                const same = !!mySha && !!file && mode === 'update' && mySha === file.sha256;
                return (
                  <label key={hh.host} className="flex items-center gap-1.5 px-2 py-1 rounded-lg border cursor-pointer" style={{ borderColor: 'var(--border-subtle)' }} title={st ? (st.exists ? `sha ${shortSha(st.sha256)}${same ? ' (aynı)' : ' (FARKLI sürüm)'}` : 'dosya bu sunucuda yok') : ''}>
                    <input type="checkbox" checked={pubHosts.has(hh.host)} onChange={(e) => setPubHosts((sset) => { const n = new Set(sset); e.target.checked ? n.add(hh.host) : n.delete(hh.host); return n; })} />
                    <span className="font-mono">{hh.host}</span>
                    {hh.host !== cur && st && (st.exists ? <Pill tone={same ? 'success' : 'warning'}>{same ? 'aynı' : 'farklı'}</Pill> : <Pill tone={mode === 'create' ? 'neutral' : 'danger'}>{mode === 'create' ? 'yeni' : 'yok'}</Pill>)}
                  </label>
                );
              })}
            </div>
            {groupHosts.length > 0 && <div className="mt-1" style={{ color: 'var(--text-muted)' }}>"farklı": o sunucudaki dosya buradakinden başka bir sürüm — üzerine yazılır. "yok": update ile publish edilemez (önce create).</div>}
          </div>
          <div>Sunucuda sırayla: deployment kilidi → yedek (<Code>conf.d/.console_backup/</Code>) → yaz → <Code>nginx -t</Code> (düşerse GERİ ALINIR) → <Code>nginx -s reload</Code> → dokum yenilenir. Canlı log sağ alttaki iş penceresinde.</div>
          {diff && (
            <>
              <div><Pill tone="success">+{diff.added}</Pill> <Pill tone="danger">−{diff.removed}</Pill> satır</div>
              <pre className="max-h-[40vh] overflow-auto p-2 rounded-lg border font-mono text-[11px] leading-4" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-elevated)' }}>
                {diff.hunks.map((l, i) => (<div key={i} style={{ color: l.startsWith('+') ? 'var(--status-success)' : l.startsWith('-') ? 'var(--status-danger)' : undefined }}>{l}</div>))}
              </pre>
            </>
          )}
        </div>
      </Modal>

      {/* Yeni dosya */}
      <NewFileModal open={newModal} onClose={() => setNewModal(false)} host={cur} prefix={tree?.prefix || '/usr/nginx'} hosts={hosts.filter((h) => h.dumpedAt)} onCreate={(p, content) => { setMode('create'); setNewPath(p); setFile(null); setDraft(content); setNewModal(false); }} />

      {/* Portal ici onay penceresi (tarayici confirm'i yerine) */}
      <Modal open={!!ask} onClose={() => setAsk(null)} title={ask?.title} size="sm"
        footer={<div className="flex justify-end gap-2"><button onClick={() => setAsk(null)} className={SM_BTN} style={smBtn()}>İptal</button><button onClick={() => { const a = ask; setAsk(null); a?.onOk(); }} className={SM_BTN} style={smBtn(true)}>{ask?.okLabel}</button></div>}>
        <div className="text-xs">{ask?.body}</div>
      </Modal>

      {/* Karsilastirma */}
      <Modal open={!!compare} onClose={() => setCompare(null)} title="Diğer sunucularda" subtitle={compare?.path} size="lg">
        {compare && (
          <div className="text-xs space-y-2">
            <div>{compare.rows.filter((r) => r.exists).length} sunucuda var · {compare.variants} farklı sürüm</div>
            <table className="w-full"><thead><tr className="text-left" style={{ color: 'var(--text-muted)' }}><th className="py-1">Sunucu</th><th>sha</th><th>değişim</th></tr></thead>
              <tbody>{compare.rows.map((r) => (<tr key={r.host} className="border-t" style={{ borderColor: 'var(--border-subtle)' }}><td className="py-1 font-mono">{r.host}</td><td className="font-mono">{r.exists ? shortSha(r.sha256) : <span className="text-red-600">yok</span>}</td><td>{r.mtime || ''}</td></tr>))}</tbody></table>
          </div>
        )}
      </Modal>
    </div>
  );
}

function TreeNode({ node, depth, onOpen, current, defaultOpen = false }: { node: NcTreeDir; depth: number; onOpen: (p: string) => void; current: string | null; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen || depth < 2);
  return (
    <div>
      <button onClick={() => setOpen((o) => !o)} className="flex items-center gap-1 py-0.5 w-full text-left hover:underline" style={{ paddingLeft: depth * 12 }}>
        {open ? <FolderOpenIcon className="w-3.5 h-3.5 text-amber-600" /> : <FolderIcon className="w-3.5 h-3.5 text-amber-600" />}
        <span className="font-semibold">{node.name}</span>
        <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>{node.files.length}</span>
      </button>
      {open && (
        <>
          {node.dirs.map((d) => <TreeNode key={d.path} node={d} depth={depth + 1} onOpen={onOpen} current={current} />)}
          {node.files.map((f) => (
            <button key={f.path} onClick={() => onOpen(f.path)} className={`flex items-center gap-1 py-0.5 w-full text-left rounded ${current === f.path ? 'font-semibold' : ''}`} style={{ paddingLeft: (depth + 1) * 12, background: current === f.path ? 'var(--bg-elevated)' : undefined }} title={`${fmtBytes(f.size)} · ${f.mtime} · sha ${shortSha(f.sha256)}`}>
              <DocumentIcon className="w-3.5 h-3.5" style={{ color: 'var(--text-muted)' }} />
              <span className="font-mono truncate" title={f.name}>{f.name}</span>
              <span className="ml-auto text-[10px]" style={{ color: 'var(--text-muted)' }}>{fmtBytes(f.size)}</span>
            </button>
          ))}
        </>
      )}
    </div>
  );
}

function NewFileModal({ open, onClose, host, prefix, hosts, onCreate }: { open: boolean; onClose: () => void; host: string | null; prefix: string; hosts: NcHost[]; onCreate: (path: string, content: string) => void }) {
  const [p, setP] = useState('');
  const [srcHost, setSrcHost] = useState('');
  const [srcTree, setSrcTree] = useState<NcTree | null>(null);
  const [srcPath, setSrcPath] = useState('');
  const [content, setContent] = useState('');
  useEffect(() => { if (open) { setP(`${prefix}/conf.d/application-confs/`); setSrcHost(''); setSrcTree(null); setSrcPath(''); setContent(''); } }, [open, prefix]);
  useEffect(() => { if (srcHost) nginxConsoleApi.tree(srcHost).then(setSrcTree); else setSrcTree(null); }, [srcHost]);
  const srcFiles = useMemo(() => { const out: string[] = []; const walk = (n: NcTreeDir) => { n.files.forEach((f) => out.push(f.path)); n.dirs.forEach(walk); }; if (srcTree?.tree) walk(srcTree.tree); return out; }, [srcTree]);
  const valid = /^\/usr\/nginx\/(conf\.d|conf)\/.+/.test(p) && !p.endsWith('/') && !p.includes('..');
  return (
    <Modal open={open} onClose={onClose} title={`${host} · yeni konfigürasyon dosyası`} size="lg"
      footer={<div className="flex justify-end gap-2"><button onClick={onClose} className="px-3 py-1.5 text-xs rounded-lg border" style={{ borderColor: 'var(--border)' }}>İptal</button><button disabled={!valid} onClick={() => onCreate(p.trim(), content)} className="btn-primary px-3 py-1.5 text-xs rounded-lg disabled:opacity-40">Editöre al</button></div>}>
      <div className="space-y-3 text-xs">
        <label className="block">Dosya yolu (yalnız <Code>/usr/nginx/conf.d/</Code> ve <Code>/usr/nginx/conf/</Code> altı)
          <input value={p} onChange={(e) => setP(e.target.value)} className="mt-1 w-full font-mono px-2 py-1.5 border rounded-lg" style={{ borderColor: valid ? 'var(--border)' : 'var(--status-danger)' }} />
        </label>
        <div className="rounded-lg border p-2 space-y-2" style={{ borderColor: 'var(--border-subtle)' }}>
          <div className="font-semibold">Başlangıç içeriği: başka sunucudan kopyala (isteğe bağlı)</div>
          <div className="flex gap-2">
            <select value={srcHost} onChange={(e) => setSrcHost(e.target.value)} className="px-2 py-1 border rounded-lg" style={{ borderColor: 'var(--border)' }}>
              <option value="">— sunucu —</option>
              {hosts.map((h) => <option key={h.host} value={h.host}>{h.host}{h.service ? ` (${h.service})` : ''}</option>)}
            </select>
            <select value={srcPath} disabled={!srcFiles.length} onChange={async (e) => { setSrcPath(e.target.value); if (e.target.value && srcHost) { const f = await nginxConsoleApi.file(srcHost, e.target.value); if (f.ok && f.content != null) { setContent(f.content); if (p.endsWith('/')) setP(p + e.target.value.split('/').pop()); } } }} className="flex-1 px-2 py-1 border rounded-lg font-mono" style={{ borderColor: 'var(--border)' }}>
              <option value="">— dosya —</option>
              {srcFiles.map((f) => <option key={f} value={f}>{f.replace(prefix + '/', '')}</option>)}
            </select>
          </div>
        </div>
        <textarea value={content} onChange={(e) => setContent(e.target.value)} spellCheck={false} placeholder="# içerik (boş bırakıp editörde de yazabilirsiniz)" className="w-full font-mono text-[12px] p-2 border rounded-lg" style={{ minHeight: '30vh', borderColor: 'var(--border)' }} />
      </div>
    </Modal>
  );
}

// ── Sertifikalar ──────────────────────────────────────────────────────────────────────
function CertsTab() {
  const [data, setData] = useState<NcCertsResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [only, setOnly] = useState<'all' | 'expiring' | 'expired' | 'missing' | 'self'>('all');
  const [sel, setSel] = useState<NcAggCert | null>(null);
  const load = useCallback(async () => { setLoading(true); try { setData(await nginxConsoleApi.certs()); } finally { setLoading(false); } }, []);
  useAsyncEffect(async () => { await load(); }, [load]);

  const rows = useMemo(() => {
    if (!data) return [];
    const needle = q.trim().toLowerCase();
    return data.certs.filter((c) => {
      if (only === 'expiring' && !(c.daysLeft != null && c.daysLeft <= 90)) return false;
      if (only === 'expired' && !(c.daysLeft != null && c.daysLeft < 0)) return false;
      if (only === 'missing' && c.exists) return false;
      if (only === 'self' && !c.selfSigned) return false;
      if (!needle) return true;
      return [c.cn, c.issuerCn, c.subject, c.issuer, ...(c.san || []), ...c.hosts.map((h) => h.host), ...c.hosts.map((h) => h.path), ...c.hosts.flatMap((h) => h.uses.map((u) => u.serverName + ' ' + u.conf))].some((x) => String(x || '').toLowerCase().includes(needle));
    });
  }, [data, q, only]);

  const csv = () => {
    const head = ['cn', 'issuer', 'notAfter', 'kalan_gun', 'keybits', 'sigalg', 'sunucu_sayisi', 'kullanim', 'sunucular', 'san'];
    const body = rows.map((c) => [c.cn || '', c.issuerCn || c.issuer || '', c.notAfter ? c.notAfter.slice(0, 10) : '', c.daysLeft ?? '', c.keybits ?? '', c.sigalg || '', c.hostCount, c.useCount, c.hosts.map((h) => h.host).join(' '), (c.san || []).join(' ')]);
    const text = [head, ...body].map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(';')).join('\n');
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['﻿' + text], { type: 'text/csv;charset=utf-8' })); a.download = `nginx_sertifikalar_${new Date().toISOString().slice(0, 10)}.csv`; a.click();
  };

  return (
    <div className="space-y-3">
      {data && (
        <div className="grid gap-3 md:grid-cols-6">
          <Tile n={data.summary.total} l="sertifika" />
          <Tile n={data.summary.expired} l="süresi dolmuş" tone="danger" onClick={() => setOnly('expired')} />
          <Tile n={data.summary.within30} l="≤ 30 gün" tone="danger" onClick={() => setOnly('expiring')} />
          <Tile n={data.summary.within90} l="31–90 gün" tone="warning" onClick={() => setOnly('expiring')} />
          <Tile n={data.summary.missing} l="dosyası yok" tone="danger" onClick={() => setOnly('missing')} />
          <Tile n={data.hostsScanned} l="taranan sunucu" />
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <MagnifyingGlassIcon className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-muted)' }} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="CN / imzalayan / sunucu / server_name / dosya" className="pl-8 pr-2 py-1.5 text-xs border rounded-lg w-80" style={{ borderColor: 'var(--border)' }} />
        </div>
        <div className="flex gap-1 rounded-lg p-0.5" style={{ background: 'var(--bg-elevated)' }}>
          {([['all', 'Hepsi'], ['expiring', '≤ 90 gün'], ['expired', 'Dolmuş'], ['missing', 'Dosyası yok'], ['self', 'Self-signed']] as const).map(([id, label]) => (
            <button key={id} onClick={() => setOnly(id)} className={`px-2.5 py-1 text-xs rounded-md ${only === id ? 'shadow-sm' : ''}`} style={{ background: only === id ? 'var(--bg-surface)' : 'transparent', color: only === id ? 'var(--text-primary)' : 'var(--text-muted)' }}>{label}</button>
          ))}
        </div>
        <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{rows.length} sertifika</span>
        <div className="ml-auto flex gap-2">
          <button onClick={csv} className="px-2.5 py-1.5 text-xs border rounded-lg" style={{ borderColor: 'var(--border)' }}>CSV</button>
          <button onClick={load} className="px-2.5 py-1.5 text-xs border rounded-lg" style={{ borderColor: 'var(--border)' }}><ArrowPathIcon className={`w-3.5 h-3.5 inline ${loading ? 'animate-spin' : ''}`} /> Yenile</button>
        </div>
      </div>
      <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>Kaynak: sunucuların son dokumu (Konfigürasyon sekmesinde "Yenile"). Aynı sertifika = aynı SHA-256 parmak izi; farklı sunuculardaki kopyalar tek satırda toplanır.</div>
      <div className="overflow-x-auto rounded-xl border" style={{ borderColor: 'var(--border-subtle)' }}>
        <table className="w-full text-xs">
          <thead><tr className="text-left" style={{ background: 'var(--bg-elevated)', color: 'var(--text-muted)' }}>
            <th className="px-3 py-2">Sertifika (CN)</th><th className="px-3 py-2">İmzalayan</th><th className="px-3 py-2">Bitiş</th><th className="px-3 py-2">Kalan</th><th className="px-3 py-2">Anahtar</th><th className="px-3 py-2 text-right">Sunucu</th><th className="px-3 py-2 text-right">Kullanım</th><th className="px-3 py-2 text-right">SAN</th>
          </tr></thead>
          <tbody>
            {rows.map((c, i) => (
              <tr key={(c.fingerprint || 'x') + i} onClick={() => setSel(c)} className="border-t cursor-pointer hover:bg-[var(--bg-elevated)]" style={{ borderColor: 'var(--border-subtle)' }}>
                <td className="px-3 py-1.5"><div className="font-semibold">{c.cn || (c.exists ? c.subject : 'DOSYA YOK')}</div><div className="font-mono text-[10px]" style={{ color: 'var(--text-muted)' }}>{c.hosts[0]?.path}{c.hosts.length > 1 && new Set(c.hosts.map((h) => h.path)).size > 1 ? ' (+farklı yollar)' : ''}</div></td>
                <td className="px-3 py-1.5">{c.selfSigned ? <Pill tone="warning">self-signed</Pill> : (c.issuerCn || c.issuer || '—')}</td>
                <td className="px-3 py-1.5 tabular-nums">{c.notAfter ? c.notAfter.slice(0, 10) : '—'}</td>
                <td className="px-3 py-1.5"><Pill tone={daysTone(c.daysLeft)}>{daysLabel(c.daysLeft)}</Pill></td>
                <td className="px-3 py-1.5">{c.keybits ? `${c.keybits} bit` : ''} <span style={{ color: 'var(--text-muted)' }}>{c.sigalg || ''}</span></td>
                <td className="px-3 py-1.5 text-right tabular-nums">{c.hostCount}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{c.useCount}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{c.san?.length || 0}</td>
              </tr>
            ))}
            {!loading && rows.length === 0 && <tr><td colSpan={8} className="px-3 py-6 text-center" style={{ color: 'var(--text-muted)' }}>{data?.hostsScanned ? 'Eşleşen sertifika yok.' : 'Henüz dokum yok — Konfigürasyon sekmesinden sunucuları yenileyin.'}</td></tr>}
          </tbody>
        </table>
      </div>
      <CertModal cert={sel} onClose={() => setSel(null)} />
    </div>
  );
}

function Tile({ n, l, tone, onClick }: { n: number; l: string; tone?: 'danger' | 'warning'; onClick?: () => void }) {
  return (
    <button onClick={onClick} className="rounded-xl border p-3 text-left" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-surface)' }}>
      <div className="text-2xl font-semibold tabular-nums" style={{ color: tone === 'danger' && n > 0 ? 'var(--status-danger)' : tone === 'warning' && n > 0 ? 'var(--status-warning)' : undefined }}>{fmtNumber(n)}</div>
      <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>{l}</div>
    </button>
  );
}

function CertModal({ cert, onClose }: { cert: NcAggCert | null; onClose: () => void }) {
  return (
    <Modal open={!!cert} onClose={onClose} title={cert?.cn || cert?.subject || 'Sertifika'} subtitle={cert?.fingerprint || undefined} size="wide">
      {cert && (
        <div className="grid gap-4 md:grid-cols-2 text-xs">
          <div className="space-y-1">
            <Row k="Subject" v={cert.subject} /><Row k="İmzalayan (issuer)" v={cert.issuer} />
            <Row k="Geçerlilik" v={`${cert.notBefore ? cert.notBefore.slice(0, 10) : '?'} → ${cert.notAfter ? cert.notAfter.slice(0, 10) : '?'}`} extra={<Pill tone={daysTone(cert.daysLeft)}>{daysLabel(cert.daysLeft)}</Pill>} />
            <Row k="Seri" v={cert.serial} /><Row k="Parmak izi (SHA-256)" v={cert.fingerprint} mono />
            <Row k="Anahtar / imza" v={`${cert.keybits || '?'} bit · ${cert.sigalg || '?'}`} />
            <Row k="Zincir" v={cert.chain > 1 ? `${cert.chain} sertifika: ${cert.chainSubjects.join(' ← ')}` : 'tek sertifika (zincir dosyada yok)'} />
            <Row k="Self-signed" v={cert.selfSigned ? 'EVET' : 'hayır'} />
            <div><div className="font-semibold mb-1">SAN ({cert.san?.length || 0})</div><div className="flex flex-wrap gap-1">{(cert.san || []).map((s) => <span key={s} className="font-mono px-1.5 py-0.5 rounded border text-[10px]" style={{ borderColor: 'var(--border-subtle)' }}>{s}</span>)}</div></div>
          </div>
          <div>
            <div className="font-semibold mb-1">Sunucular ({cert.hostCount}) ve kullanıldığı konfigürasyonlar ({cert.useCount})</div>
            <div className="max-h-[55vh] overflow-auto space-y-2">
              {cert.hosts.map((h) => (
                <div key={h.host + h.path} className="rounded-lg border p-2" style={{ borderColor: 'var(--border-subtle)' }}>
                  <div className="flex items-center gap-2"><span className="font-mono font-semibold">{h.host}</span><span className="font-mono text-[10px]" style={{ color: 'var(--text-muted)' }}>{h.path}</span></div>
                  {h.uses.length === 0 && <div className="text-[10px]" style={{ color: 'var(--text-muted)' }}>hiçbir konfigürasyonda referans yok (yetim dosya)</div>}
                  {h.uses.map((u, i) => (
                    <div key={i} className="ml-2 mt-1 text-[11px] flex flex-wrap gap-2">
                      <span className="font-mono">{u.conf.replace('/usr/nginx/', '')}</span>
                      <span style={{ color: 'var(--text-muted)' }}>server_name {u.serverName}</span>
                      <Pill tone={u.keyState === 'present' ? 'success' : 'danger'}>key {u.keyState === 'present' ? 'var' : 'YOK'}</Pill>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}
function Row({ k, v, mono, extra }: { k: string; v: string | null | undefined; mono?: boolean; extra?: React.ReactNode }) {
  return <div className="flex gap-2"><span className="w-36 shrink-0" style={{ color: 'var(--text-muted)' }}>{k}</span><span className={`break-all ${mono ? 'font-mono' : ''}`}>{v || '—'} {extra}</span></div>;
}
// NcCert tipi tree ucunda kullaniliyor (sunucu bazli sertifika listesi) — ileride sunucu paneline eklenecek
export type { NcCert as _NcCertRef };
