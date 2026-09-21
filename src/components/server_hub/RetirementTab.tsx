// src/components/server_hub/RetirementTab.tsx — Uygulama Retirement (2026-09-21): kayit + kesif + STOP.
//
// Ekibin elle sureci Portal'da: Smart silme kaydi no + (prod) OCO ile kayit acilir; uygulamanin TUM
// sunuculari (tum ortamlar, Pendik + Ankara) envanterden kesfedilir, web sunuculari Web-App kuraliyla;
// her hedef icin STOP once PLAN kosar, onaylaninca uygulanir. Silme tarihi: kaydi acan secer, bos ise
// stop + N gun (varsayilan 45). Silme ve IP/LB/DNS adimlari sonraki surum (kayitta alanlari var).
import React, { useCallback, useEffect, useState } from 'react';
import { PlusIcon, ArrowPathIcon, XMarkIcon, StopCircleIcon, ClipboardDocumentCheckIcon, TrashIcon } from '@heroicons/react/24/outline';
import { retirementApi, type RtRecordRow, type RtRecord, type RtDiscovery, type RtTarget, type RtTargetStatus } from '@/api/retirementApi';
import { useJobTracker } from '@/contexts/JobTrackerContext';
import { Modal } from '@/components/common/Modal';
import { TableEmptyRow } from '@/components/common/EmptyState';
import { fmtDate, fmtDateTime } from '@/utils/datetime';
import { toast } from '@/hooks/useToast';

const SM_BTN = 'inline-flex items-center gap-1 h-7 px-2.5 text-[11px] font-medium leading-none rounded-lg border whitespace-nowrap disabled:opacity-40';
const smBtn = (primary = false): React.CSSProperties => (primary
  ? { background: 'var(--accent)', borderColor: 'var(--accent)', color: 'var(--accent-fg, #fff)' }
  : { borderColor: 'var(--border)', background: 'var(--bg-surface)', color: 'var(--text-primary)' });
const TERMINAL = new Set(['successful', 'failed', 'error', 'canceled']);
const INPUT = 'w-full px-2.5 py-1.5 text-xs border rounded-lg';
const inputStyle: React.CSSProperties = { borderColor: 'var(--border)', background: 'var(--bg-surface)', color: 'var(--text-primary)' };

const TSTATUS: Record<RtTargetStatus, { label: string; color: string }> = {
  pending: { label: 'bekliyor', color: 'var(--status-neutral)' }, planning: { label: 'plan koşuyor', color: 'var(--status-info)' }, planned: { label: 'plan hazır', color: 'var(--status-info)' },
  stopping: { label: 'durduruluyor', color: 'var(--status-warning)' }, stopped: { label: 'DURDURULDU', color: 'var(--status-success)' }, failed: { label: 'başarısız', color: 'var(--status-danger)' }, skipped: { label: 'atlandı', color: 'var(--status-neutral)' },
};
const RSTATUS: Record<string, { label: string; color: string }> = {
  open: { label: 'açık', color: 'var(--status-info)' }, stopping: { label: 'stop sürüyor', color: 'var(--status-warning)' }, stopped: { label: 'durduruldu — silme bekliyor', color: 'var(--status-success)' },
  deleted: { label: 'silindi', color: 'var(--status-neutral)' }, cancelled: { label: 'iptal', color: 'var(--status-neutral)' },
};
const Pill = ({ label, color }: { label: string; color: string }) => <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold border whitespace-nowrap" style={{ color, borderColor: color, background: 'var(--bg-surface)' }}>{label}</span>;

export default function RetirementTab() {
  const [rows, setRows] = useState<RtRecordRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [openId, setOpenId] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);
  const [cfg, setCfg] = useState<{ defaultDays: number; sccMailConfigured: boolean; sccMailTo: string | null } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try { const r = await retirementApi.list(); if (r.ok) { setRows(r.records); setErr(''); } else setErr(r.message || 'Liste alınamadı.'); }
    catch (e: unknown) { setErr(e instanceof Error ? e.message : String(e)); } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); retirementApi.config().then((c) => c.ok && setCfg(c)).catch(() => {}); }, [load]);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <p className="text-[12px] max-w-3xl" style={{ color: 'var(--text-muted)' }}>
          Smart silme kaydı gelince burada kayıt açılır; uygulamanın <b>tüm ortamlardaki ve iki sitedeki</b> sunucuları envanterden bulunur (sahibin yazmadığı Ankara dâhil), web sunucuları Denetim Web-App kuralıyla eşlenir. STOP adımı: auto-start kapat → durdur → paketi <code>.&lt;smart&gt;.old</code> yap. Silme, stop'tan sonra seçilen tarihte (varsayılan {cfg?.defaultDays ?? 45} gün) ayrı adımdır.
          {cfg && !cfg.sccMailConfigured && <span style={{ color: 'var(--status-warning)' }}> · SCC bilgilendirme adresi (RETIREMENT_SCC_MAIL_TO) tanımlı değil — prod STOP'ta mail gitmez.</span>}
        </p>
        <div className="ml-auto flex items-center gap-2">
          <button onClick={load} className={SM_BTN} style={smBtn()}><ArrowPathIcon className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /> Yenile</button>
          <button onClick={() => setCreating(true)} className={SM_BTN} style={smBtn(true)}><PlusIcon className="w-3.5 h-3.5" /> Yeni retirement kaydı</button>
        </div>
      </div>
      {err && <div className="text-sm rounded-xl px-3 py-2 border" style={{ color: 'var(--status-danger)', background: 'var(--status-danger-bg)', borderColor: 'var(--status-danger)' }}>{err}</div>}
      <div className="overflow-auto rounded-xl border" style={{ borderColor: 'var(--border-subtle)' }}>
        <table className="w-full text-xs border-collapse">
          <thead style={{ background: 'var(--bg-elevated)' }}><tr>{['Uygulama', 'Smart', 'OCO', 'Durum', 'Hedefler', 'Stop', 'Silme tarihi', 'Açan', 'Açılış'].map((h) => <th key={h} className="px-3 py-2 text-left text-[11px] font-semibold" style={{ color: 'var(--text-muted)' }}>{h}</th>)}</tr></thead>
          <tbody>
            {rows.length === 0 ? <TableEmptyRow colSpan={9} title="Retirement kaydı yok." description="Smart silme kaydı gelince 'Yeni retirement kaydı' ile açın." /> : rows.map((r) => (
              <tr key={r.id} className="border-t cursor-pointer hover:bg-[var(--bg-elevated)]" style={{ borderColor: 'var(--border-subtle)' }} onClick={() => setOpenId(r.id)}>
                <td className="px-3 py-1.5 font-semibold">{r.app}</td>
                <td className="px-3 py-1.5 font-mono text-[11px]">{r.smartNo}</td>
                <td className="px-3 py-1.5 font-mono text-[11px]">{r.ocoNo || '—'}</td>
                <td className="px-3 py-1.5"><Pill {...(RSTATUS[r.status] || { label: r.status, color: 'var(--text-muted)' })} /></td>
                <td className="px-3 py-1.5 tabular-nums">{r.targets}</td>
                <td className="px-3 py-1.5 tabular-nums">{r.stopped}/{r.targets}{r.stopAt ? <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}> · {fmtDate(r.stopAt)}</span> : null}</td>
                <td className="px-3 py-1.5">{r.effectiveDeleteAt ? fmtDate(r.effectiveDeleteAt) : <span style={{ color: 'var(--text-muted)' }}>stop + {r.deleteAfterDays} gün</span>}</td>
                <td className="px-3 py-1.5">{r.requestedBy}</td>
                <td className="px-3 py-1.5 text-[11px]" style={{ color: 'var(--text-muted)' }}>{fmtDate(r.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {creating && <CreateModal defaultDays={cfg?.defaultDays ?? 45} onClose={() => setCreating(false)} onCreated={(id) => { setCreating(false); load(); setOpenId(id); }} />}
      {openId != null && <RecordModal id={openId} onClose={() => { setOpenId(null); load(); }} />}
    </div>
  );
}

// ── Yeni kayit: uygulama -> kesif -> alanlar ─────────────────────────────────────
function CreateModal({ defaultDays, onClose, onCreated }: { defaultDays: number; onClose: () => void; onCreated: (id: number) => void }) {
  const [q, setQ] = useState('');
  const [apps, setApps] = useState<string[]>([]);
  const [app, setApp] = useState('');
  const [disc, setDisc] = useState<RtDiscovery | null>(null);
  const [discLoading, setDiscLoading] = useState(false);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [f, setF] = useState({ smartNo: '', ocoNo: '', ownerEmail: '', deleteAfterDays: String(defaultDays), plannedDeleteAt: '', dnsReuse: false, lbReuse: false, notes: '' });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (q.trim().length < 2) { setApps([]); return; }
    const t = setTimeout(() => retirementApi.apps(q.trim()).then((r) => r.ok && setApps(r.apps)).catch(() => {}), 250);
    return () => clearTimeout(t);
  }, [q]);
  const pick = async (a: string) => {
    setApp(a); setQ(a); setApps([]); setDisc(null); setDiscLoading(true);
    try { const d = await retirementApi.discover(a); if (d.ok) { setDisc(d); setSel(new Set(d.targets.map((t) => `${t.host}|${t.appName}`))); } else toast.error(d.message || 'Keşif başarısız.'); }
    catch (e: unknown) { toast.error(e instanceof Error ? e.message : String(e)); } finally { setDiscLoading(false); }
  };
  const key = (t: { host: string; appName: string }) => `${t.host}|${t.appName}`;
  const selected = (disc?.targets || []).filter((t) => sel.has(key(t)));
  const needsOco = selected.some((t) => t.env === 'PROD');
  const create = async () => {
    if (!app || !f.smartNo.trim()) { toast.error('Uygulama ve Smart kayıt numarası gerekli.'); return; }
    if (needsOco && !f.ocoNo.trim()) { toast.error('PROD hedef seçili: OCO numarası zorunlu.'); return; }
    if (!selected.length) { toast.error('En az bir hedef seçin.'); return; }
    setBusy(true);
    try {
      const r = await retirementApi.create({ app, smartNo: f.smartNo.trim(), ocoNo: f.ocoNo.trim() || undefined, ownerEmail: f.ownerEmail.trim() || undefined, deleteAfterDays: Number(f.deleteAfterDays) || defaultDays, plannedDeleteAt: f.plannedDeleteAt || null, dnsReuse: f.dnsReuse, lbReuse: f.lbReuse, notes: f.notes, targets: selected.map((t) => ({ host: t.host, appName: t.appName })) });
      if (!r.ok) { toast.error(r.message || 'Kayıt açılamadı.'); return; }
      toast.success(`Retirement kaydı #${r.id} açıldı (${selected.length} hedef).`); onCreated(r.id);
    } catch (e: unknown) { toast.error(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };

  return (
    <Modal open onClose={onClose} title="Yeni retirement kaydı" subtitle="Smart silme kaydı (364244_Delete_6) geldikten sonra açılır; PROD için altyapı OCO'su gerekir." icon={TrashIcon} size="xl"
      footer={<div className="flex items-center gap-2 w-full"><span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>{selected.length} hedef seçili{needsOco ? ' · PROD var: OCO zorunlu' : ''}</span><span className="ml-auto" /><button onClick={onClose} className={SM_BTN} style={smBtn()}>İptal</button><button disabled={busy || !disc} onClick={create} className={SM_BTN} style={smBtn(true)}>Kaydı aç</button></div>}>
      <div className="space-y-3">
        <div className="grid gap-3 md:grid-cols-2">
          <div className="relative">
            <label className="text-[11px] font-semibold" style={{ color: 'var(--text-muted)' }}>Uygulama (taban ad; -D/-T/-Q ortamları otomatik)</label>
            <input value={q} onChange={(e) => { setQ(e.target.value); setApp(''); setDisc(null); }} placeholder="CRM" className={INPUT} style={inputStyle} autoFocus />
            {apps.length > 0 && !app && (
              <ul className="absolute z-10 mt-1 w-full max-h-48 overflow-auto rounded-lg border shadow-sm text-xs" style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)' }}>
                {apps.map((a) => <li key={a}><button onClick={() => pick(a)} className="w-full text-left px-2.5 py-1.5 hover:bg-[var(--bg-elevated)]">{a}</button></li>)}
              </ul>
            )}
          </div>
          <div><label className="text-[11px] font-semibold" style={{ color: 'var(--text-muted)' }}>Smart silme kaydı no *</label><input value={f.smartNo} onChange={(e) => setF({ ...f, smartNo: e.target.value })} className={INPUT} style={inputStyle} placeholder="364244…" /></div>
          <div><label className="text-[11px] font-semibold" style={{ color: 'var(--text-muted)' }}>Altyapı OCO no {needsOco ? '*' : '(prod ise)'}</label><input value={f.ocoNo} onChange={(e) => setF({ ...f, ocoNo: e.target.value })} className={INPUT} style={inputStyle} /></div>
          <div><label className="text-[11px] font-semibold" style={{ color: 'var(--text-muted)' }}>Uygulama sahibi e-posta</label><input value={f.ownerEmail} onChange={(e) => setF({ ...f, ownerEmail: e.target.value })} className={INPUT} style={inputStyle} /></div>
          <div><label className="text-[11px] font-semibold" style={{ color: 'var(--text-muted)' }}>Silme: stop'tan kaç gün sonra</label><input type="number" min={1} value={f.deleteAfterDays} onChange={(e) => setF({ ...f, deleteAfterDays: e.target.value })} className={INPUT} style={inputStyle} /></div>
          <div><label className="text-[11px] font-semibold" style={{ color: 'var(--text-muted)' }}>…ya da kesin silme tarihi (isteğe bağlı)</label><input type="date" value={f.plannedDeleteAt} onChange={(e) => setF({ ...f, plannedDeleteAt: e.target.value })} className={INPUT} style={inputStyle} /></div>
          <label className="flex items-center gap-2 text-xs" style={{ color: 'var(--text-secondary)' }}><input type="checkbox" checked={f.dnsReuse} onChange={(e) => setF({ ...f, dnsReuse: e.target.checked })} /> DNS kullanılmaya devam edecek (DNS silme kaydı açılmaz)</label>
          <label className="flex items-center gap-2 text-xs" style={{ color: 'var(--text-secondary)' }}><input type="checkbox" checked={f.lbReuse} onChange={(e) => setF({ ...f, lbReuse: e.target.checked })} /> LB kullanılmaya devam edecek (member güncelleme kaydı)</label>
          <div className="md:col-span-2"><label className="text-[11px] font-semibold" style={{ color: 'var(--text-muted)' }}>Not</label><textarea value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} rows={2} className={INPUT} style={inputStyle} /></div>
        </div>

        {discLoading && <div className="text-xs" style={{ color: 'var(--text-muted)' }}>Envanter taranıyor…</div>}
        {disc && (
          <div className="space-y-2">
            <div className="flex items-center gap-3 text-[12px]" style={{ color: 'var(--text-secondary)' }}>
              <b>{disc.summary.total}</b> hedef · Pendik {disc.summary.bySite.Pendik} · <b style={disc.summary.bySite.Ankara ? { color: 'var(--status-warning)' } : undefined}>Ankara {disc.summary.bySite.Ankara}</b> · {Object.entries(disc.summary.byEnv).filter(([, n]) => n).map(([e, n]) => `${e} ${n}`).join(' · ')} · web eşlenen {disc.summary.webMatched}
              <button onClick={() => setSel(new Set(disc.targets.map(key)))} className={SM_BTN} style={smBtn()}>tümü</button>
              <button onClick={() => setSel(new Set())} className={SM_BTN} style={smBtn()}>hiçbiri</button>
            </div>
            <div className="overflow-auto rounded-lg border" style={{ borderColor: 'var(--border-subtle)', maxHeight: '18rem' }}>
              <table className="w-full text-xs border-collapse">
                <thead className="sticky top-0" style={{ background: 'var(--bg-elevated)' }}><tr>{['', 'Sunucu', 'Site', 'Ortam', 'Uygulama', 'JBoss', 'Envanter', 'Server Hub', 'Web sunucusu / vhost', 'Paket'].map((h, i) => <th key={h + i} className="px-2 py-1.5 text-left text-[11px] font-semibold" style={{ color: 'var(--text-muted)' }}>{h}</th>)}</tr></thead>
                <tbody>
                  {disc.targets.length === 0 ? <TableEmptyRow colSpan={10} title="Envanterde bu uygulama için sunucu yok." /> : disc.targets.map((t) => (
                    <tr key={key(t)} className="border-t" style={{ borderColor: 'var(--border-subtle)' }}>
                      <td className="px-2 py-1"><input type="checkbox" checked={sel.has(key(t))} onChange={(e) => { const s = new Set(sel); if (e.target.checked) s.add(key(t)); else s.delete(key(t)); setSel(s); }} /></td>
                      <td className="px-2 py-1 font-mono font-semibold">{t.host}</td>
                      <td className="px-2 py-1" style={t.site === 'Ankara' ? { color: 'var(--status-warning)', fontWeight: 600 } : undefined}>{t.site}</td>
                      <td className="px-2 py-1"><b>{t.env}</b></td>
                      <td className="px-2 py-1">{t.appName}</td>
                      <td className="px-2 py-1">{t.gen ? `JBoss ${t.gen}` : <span style={{ color: 'var(--status-danger)' }}>?</span>}</td>
                      <td className="px-2 py-1 text-[10px]" style={{ color: 'var(--text-muted)' }}>{t.inventoryStatus || '—'}</td>
                      <td className="px-2 py-1 text-[10px]">{t.hub ? <span style={{ color: t.hub.running ? 'var(--status-success)' : 'var(--text-muted)' }}>{t.hub.running ? 'çalışıyor' : 'kapalı'} · auto-start {t.hub.autoStart}</span> : <span style={{ color: 'var(--text-muted)' }}>tarama yok</span>}</td>
                      <td className="px-2 py-1 text-[10px]">{t.web.length ? t.web.map((w) => <div key={w.host + w.serverName} title={t.webHow}>{w.host} · {w.serverName}{w.product ? ` (${w.product})` : ''}</div>) : <span style={{ color: 'var(--status-warning)' }} title={t.webHow}>eşlenemedi</span>}</td>
                      <td className="px-2 py-1 font-mono text-[10px]"><div className="truncate max-w-[14rem]" title={t.appPath}>{t.appPath || '—'}</div></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}

// ── Kayit ayrintisi: hedefler + STOP (plan -> onay) + olaylar ─────────────────────
function RecordModal({ id, onClose }: { id: number; onClose: () => void }) {
  const { addJob } = useJobTracker();
  const [rec, setRec] = useState<RtRecord | null>(null);
  const [err, setErr] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<number | null>(null);
  const [ask, setAsk] = useState<{ t: RtTarget } | null>(null);

  const load = useCallback(async () => {
    try { const r = await retirementApi.get(id); if (r.ok) { setRec(r.record); setErr(''); } else setErr(r.message || 'Kayıt alınamadı.'); }
    catch (e: unknown) { setErr(e instanceof Error ? e.message : String(e)); }
  }, [id]);
  useEffect(() => { load(); }, [load]);

  const stop = async (t: RtTarget, confirmed: boolean) => {
    setBusy(t.id); setAsk(null);
    try {
      const r = await retirementApi.stop(id, t.id, confirmed);
      if (!r.ok) { toast.error(r.message || 'İş başlatılamadı.'); return; }
      if (r.sccWarning) toast.error(r.sccWarning);
      toast.success(`${confirmed ? 'STOP' : 'Plan'} işi başladı (#${r.jobId}).`);
      let done = false;
      addJob({
        title: `Retirement: ${confirmed ? 'STOP' : 'plan'} ${t.appName} @ ${t.host}`,
        fetchStatus: async () => {
          const s = await retirementApi.jobStatus(id, t.id, r.awxServerId, r.jobId as number);
          if (!s.ok) throw new Error(s.message || 'Durum okunamadı.');
          if (TERMINAL.has(s.status) && !done) { done = true; load(); }
          return { status: s.status, output: s.output || '', result: s.result };
        },
      });
      await load();
    } catch (e: unknown) { toast.error(e instanceof Error ? e.message : String(e)); } finally { setBusy(null); }
  };
  const cancel = async () => {
    const r = await retirementApi.cancel(id, 'kullanıcı iptal etti');
    if (r.ok) { toast.success('Kayıt iptal edildi.'); setRec(r.record); } else toast.error(r.message || 'İptal edilemedi.');
  };
  const addNote = async () => { if (!note.trim()) return; const r = await retirementApi.note(id, note.trim()); if (r.ok) { setRec(r.record); setNote(''); } };

  return (
    <Modal open onClose={onClose} title={rec ? `Retirement #${rec.id} — ${rec.app}` : `Retirement #${id}`} subtitle={rec ? `Smart ${rec.smartNo}${rec.ocoNo ? ` · OCO ${rec.ocoNo}` : ''} · açan ${rec.requestedBy} · ${fmtDateTime(rec.createdAt)}` : undefined} icon={TrashIcon} size="xl"
      footer={<div className="flex items-center gap-2 w-full">{rec && rec.status !== 'cancelled' && rec.status !== 'deleted' && <button onClick={cancel} className={SM_BTN} style={{ ...smBtn(), color: 'var(--status-danger)', borderColor: 'var(--status-danger)' }}><XMarkIcon className="w-3.5 h-3.5" /> Kaydı iptal et</button>}<span className="ml-auto" /><button onClick={onClose} className={SM_BTN} style={smBtn()}>Kapat</button></div>}>
      {err && <div className="text-sm rounded-xl px-3 py-2 border" style={{ color: 'var(--status-danger)', background: 'var(--status-danger-bg)', borderColor: 'var(--status-danger)' }}>{err}</div>}
      {rec && (
        <div className="space-y-3">
          <div className="grid gap-2 sm:grid-cols-4 text-[12px]">
            <div className="rounded-lg border px-3 py-2" style={{ borderColor: 'var(--border-subtle)' }}><div className="text-[10px] uppercase" style={{ color: 'var(--text-muted)' }}>Durum</div><Pill {...(RSTATUS[rec.status] || { label: rec.status, color: 'var(--text-muted)' })} /></div>
            <div className="rounded-lg border px-3 py-2" style={{ borderColor: 'var(--border-subtle)' }}><div className="text-[10px] uppercase" style={{ color: 'var(--text-muted)' }}>Stop</div>{rec.stopAt ? fmtDateTime(rec.stopAt) : '—'} <span style={{ color: 'var(--text-muted)' }}>({rec.targets.filter((t) => t.status === 'stopped').length}/{rec.targets.length})</span></div>
            <div className="rounded-lg border px-3 py-2" style={{ borderColor: 'var(--border-subtle)' }}><div className="text-[10px] uppercase" style={{ color: 'var(--text-muted)' }}>Silme tarihi</div>{rec.effectiveDeleteAt ? fmtDate(rec.effectiveDeleteAt) : `stop + ${rec.deleteAfterDays} gün`}{rec.plannedDeleteAt ? <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}> (açan belirledi)</span> : null}</div>
            <div className="rounded-lg border px-3 py-2" style={{ borderColor: 'var(--border-subtle)' }}><div className="text-[10px] uppercase" style={{ color: 'var(--text-muted)' }}>SCC / DNS / LB</div>{rec.sccNotifiedAt ? 'SCC bilgilendirildi' : 'SCC bekliyor'} · DNS {rec.dnsReuse ? 'kalacak' : 'silinecek'} · LB {rec.lbReuse ? 'kalacak' : 'silinecek'}</div>
          </div>
          {rec.notes && <div className="text-[12px] rounded-lg border px-3 py-2" style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-secondary)' }}>{rec.notes}</div>}

          <div className="overflow-auto rounded-lg border" style={{ borderColor: 'var(--border-subtle)' }}>
            <table className="w-full text-xs border-collapse">
              <thead style={{ background: 'var(--bg-elevated)' }}><tr>{['Sunucu', 'Site', 'Ortam', 'Uygulama', 'JBoss', 'Web sunucusu', 'Durum', 'Plan / sonuç', ''].map((h, i) => <th key={h + i} className="px-2.5 py-1.5 text-left text-[11px] font-semibold" style={{ color: 'var(--text-muted)' }}>{h}</th>)}</tr></thead>
              <tbody>
                {rec.targets.map((t) => {
                  const st = TSTATUS[t.status] || { label: t.status, color: 'var(--text-muted)' };
                  const canAct = rec.status !== 'cancelled' && t.status !== 'stopped' && t.status !== 'planning' && t.status !== 'stopping';
                  return (
                    <tr key={t.id} className="border-t" style={{ borderColor: 'var(--border-subtle)' }}>
                      <td className="px-2.5 py-1.5 font-mono font-semibold">{t.host}</td>
                      <td className="px-2.5 py-1.5" style={t.site === 'Ankara' ? { color: 'var(--status-warning)', fontWeight: 600 } : undefined}>{t.site}</td>
                      <td className="px-2.5 py-1.5"><b>{t.env}</b></td>
                      <td className="px-2.5 py-1.5">{t.appName}</td>
                      <td className="px-2.5 py-1.5">{t.gen ? `JBoss ${t.gen}` : '?'}</td>
                      <td className="px-2.5 py-1.5 text-[10px]">{t.web.length ? t.web.map((w) => <div key={w.host + w.serverName}>{w.host} · {w.serverName}</div>) : <span style={{ color: 'var(--text-muted)' }}>—</span>}</td>
                      <td className="px-2.5 py-1.5"><Pill label={st.label} color={st.color} /></td>
                      <td className="px-2.5 py-1.5 text-[10px]" style={{ color: 'var(--text-secondary)' }}><div className="max-w-[20rem] truncate" title={t.resultText || t.planText || ''}>{t.resultText || t.planText || (t.lastJobId ? `iş #${t.lastJobId}` : '—')}</div></td>
                      <td className="px-2.5 py-1.5">
                        {canAct && (
                          <div className="flex gap-1">
                            <button disabled={busy != null} onClick={() => stop(t, false)} className={SM_BTN} style={smBtn()} title="Sunucuda plan koş: ne yapılacağını göster, hiçbir şey değişmez"><ClipboardDocumentCheckIcon className="w-3.5 h-3.5" /> Plan</button>
                            {t.status === 'planned' && <button disabled={busy != null} onClick={() => setAsk({ t })} className={SM_BTN} style={{ ...smBtn(true), background: 'var(--status-danger)', borderColor: 'var(--status-danger)' }}><StopCircleIcon className="w-3.5 h-3.5" /> STOP</button>}
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="text-[10px]" style={{ color: 'var(--text-muted)' }}>STOP düğmesi yalnız plan koşup başarıyla döndükten sonra açılır. PROD hedeflerde ilk STOP'ta SCC'ye bilgilendirme maili gider. Silme adımı (JVM/cluster + content repo + mod_jk/workers temizliği) ve IP/LB/DNS Smart kayıtları bir sonraki sürümde bu ekrana eklenecek.</p>

          <div>
            <div className="text-[11px] font-semibold mb-1" style={{ color: 'var(--text-muted)' }}>Olaylar</div>
            <ul className="space-y-0.5 max-h-40 overflow-auto text-[11px]">
              {rec.events.map((e) => <li key={e.id}><span style={{ color: 'var(--text-muted)' }}>{fmtDateTime(e.at)}</span> · <b>{e.kind}</b> {e.username ? `(${e.username})` : ''} — {e.text}</li>)}
            </ul>
            <div className="flex gap-2 mt-2">
              <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="not ekle (LB member listesi, Confluence linki…)" className={INPUT} style={inputStyle} onKeyDown={(e) => e.key === 'Enter' && addNote()} />
              <button onClick={addNote} className={SM_BTN} style={smBtn()}>Ekle</button>
            </div>
          </div>
        </div>
      )}
      {ask && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,.45)' }} onClick={() => setAsk(null)}>
          <div className="w-full max-w-md rounded-2xl border p-5 space-y-3" style={{ background: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }} onClick={(e) => e.stopPropagation()}>
            <div className="text-sm font-semibold">STOP — {ask.t.appName} @ {ask.t.host} ({ask.t.env}, {ask.t.site})</div>
            <div className="text-[12px] rounded-lg border px-3 py-2" style={{ borderColor: 'var(--status-info)', background: 'var(--status-info-bg)' }}><b>Plan:</b> {ask.t.planText}</div>
            <p className="text-[12px]" style={{ color: 'var(--text-secondary)' }}>auto-start kapatılır, JVM durdurulur, paket(ler) <code>.{rec?.smartNo}.old</code> yapılır. {ask.t.env === 'PROD' ? 'PROD: SCC bilgilendirme maili gider.' : ''} Geri almak için JVM elle başlatılır ve paket adı düzeltilir.</p>
            <div className="flex justify-end gap-2"><button onClick={() => setAsk(null)} className={SM_BTN} style={smBtn()}>İptal</button><button onClick={() => stop(ask.t, true)} className={SM_BTN} style={{ ...smBtn(true), background: 'var(--status-danger)', borderColor: 'var(--status-danger)' }}>Onayla ve durdur</button></div>
          </div>
        </div>
      )}
    </Modal>
  );
}
