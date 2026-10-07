// src/components/server_hub/RetirementTab.tsx — Uygulama Retirement (2026-09-21): kayit + kesif + STOP.
//
// Ekibin elle sureci Portal'da: Smart silme kaydi no + (prod) OCO ile kayit acilir; uygulamanin TUM
// sunuculari (tum ortamlar, Pendik + Ankara) envanterden kesfedilir, web sunuculari Web-App kuraliyla;
// her hedef icin STOP once PLAN kosar, onaylaninca uygulanir. Silme tarihi: kaydi acan secer, bos ise
// stop + N gun (varsayilan 45). Silme ve IP/LB/DNS adimlari sonraki surum (kayitta alanlari var).
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { PlusIcon, ArrowPathIcon, XMarkIcon, StopCircleIcon, ClipboardDocumentCheckIcon, TrashIcon, ArrowUturnLeftIcon } from '@heroicons/react/24/outline';
import { retirementApi, type RtRecordRow, type RtRecord, type RtDiscovery, type RtDiscoveredTarget, type RtTarget, type RtTargetStatus } from '@/api/retirementApi';
import { useJobTracker } from '@/contexts/JobTrackerContext';
import { Modal } from '@/components/common/Modal';
import { TableEmptyRow } from '@/components/common/EmptyState';
import { fmtDate, fmtDateTime } from '@/utils/datetime';
import RetirementAkis from './RetirementAkis';
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
  stop_scheduled: { label: 'OCO penceresine zamanlandı', color: 'var(--status-info)' },
  stopping: { label: 'durduruluyor', color: 'var(--status-warning)' }, stopped: { label: 'DURDURULDU', color: 'var(--status-success)' },
  deleting: { label: 'siliniyor', color: 'var(--status-warning)' }, deleted: { label: 'SİLİNDİ', color: 'var(--status-neutral)' },
  // GERI ALMA (2026-10-07). 'active' YESIL ve 'DURDURULDU'dan AYRI okunmali: ikisi de
  // "basarili" ama biri uygulamanin kapali, oteki ACIK oldugu anlamina geliyor.
  rolling_back: { label: 'geri alınıyor', color: 'var(--status-warning)' },
  active: { label: 'GERİ AKTİF', color: 'var(--status-success)' },
  rollback_failed: { label: 'geri alma BAŞARISIZ', color: 'var(--status-danger)' },
  failed: { label: 'başarısız', color: 'var(--status-danger)' }, skipped: { label: 'atlandı', color: 'var(--status-neutral)' },
};
const RSTATUS: Record<string, { label: string; color: string }> = {
  open: { label: 'açık', color: 'var(--status-info)' }, stopping: { label: 'stop sürüyor', color: 'var(--status-warning)' }, stopped: { label: 'durduruldu — silme bekliyor', color: 'var(--status-success)' },
  deleted: { label: 'silindi', color: 'var(--status-neutral)' }, cancelled: { label: 'iptal', color: 'var(--status-neutral)' },
};
const Pill = ({ label, color }: { label: string; color: string }) => <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold border whitespace-nowrap" style={{ color, borderColor: color, background: 'var(--bg-surface)' }}>{label}</span>;

// SERVER HUB CALISMA DURUMU (sozlesme v3, D1-U05): discover.cjs hub.runningKnown tasir
// (running_src !== 'UNMEASURED'). hidepid'li sunucuda gorunmeyen JVM "kapali" DEGIL "bilinmiyor"dur
// - kural 6. Alan yoksa (eski sunucu yaniti) eski davranis. Alan retirementApi.ts'te (istege bagli).
/** Vhost trafigi (Apache/IHS access log, hc HARIC).
 *
 *  UC DURUM UC AYRI GOSTERIM. "olculemedi" ASLA "trafik yok" gibi gosterilmez: retire
 *  karari buna dayaniyor ve yanlis tarafa dusmek, hala istek alan bir uygulamayi
 *  durdurmak demek. `sampled` ise sayi ALT SINIR ("en az N"). */
function TrafikHucresi({ tr }: { tr?: import('@/api/retirementApi').RtVhostTrafik }) {
  if (!tr) return <span style={{ color: 'var(--status-warning)' }} title="trafik bilgisi gelmedi">ölçülemedi</span>;
  if (tr.durum === 'olculemedi')
    return (
      <span style={{ color: 'var(--status-warning)' }} title={`Server Hub: ${tr.sebep || 'sebep bilinmiyor'} — "trafik yok" DEĞİL`}>
        ölçülemedi
      </span>
    );
  if (tr.durum === 'yok')
    return (
      <span style={{ color: 'var(--status-success)' }} title={`7 günde hc hariç istek yok (tarama ${tr.tarama || '?'})`}>
        istek yok (7g)
      </span>
    );
  return (
    <span style={{ color: 'var(--status-danger)', fontWeight: 600 }}
      title={`hc hariç: 24s ${tr.req24 ?? '?'} · 7g ${tr.req7}${tr.hc24 != null ? ` · hc 24s ${tr.hc24}` : ''}${tr.sonIstek ? ` · son istek ${tr.sonIstek}` : ''}${tr.sampled ? ' · log kuyruğu kesildi, sayı ALT SINIR' : ''}`}>
      {tr.sampled ? 'en az ' : ''}{tr.req7} istek (7g)
    </span>
  );
}

type HubV3 = NonNullable<RtDiscoveredTarget['hub']>;
function hubDurumu(hub: HubV3): { metin: string; renk: string; aciklama: string } {
  if (hub.runningKnown === false)
    return { metin: 'bilinmiyor', renk: 'var(--status-warning)', aciklama: 'Server Hub çalışma durumunu ölçemedi (süreç görünmüyor) — kapalı sayılmadı.' };
  if (hub.running) return { metin: 'çalışıyor', renk: 'var(--status-success)', aciklama: '' };
  return { metin: 'kapalı', renk: 'var(--text-muted)', aciklama: '' };
}

// SERVER HUB OKUNAMADI (kural 6): discover.cjs Server_Hub_Jvms sorgusu duserse
// summary.hubUnavailable=true dondurur; o zaman TUM hedeflerin hub alani null'dur. Bu "tarama yok"
// (sunucu taranmadi) DEGIL, "olculemedi"dir. Alan yoksa (eski sunucu yaniti) okundu sayilir.
const hubOkunamadi = (d: RtDiscovery | null | undefined): boolean => d?.summary?.hubUnavailable === true;

/** Kesif tablosundaki Server Hub hucresi: okunamadi > olcum (hubDurumu) > tarama yok. */
function hubHucresi(hub: HubV3 | null, okunamadi: boolean): { metin: string; renk: string; aciklama: string } {
  if (okunamadi)
    return { metin: 'Server Hub okunamadı', renk: 'var(--status-warning)', aciklama: "Server Hub verisi okunamadı — JVM'in çalışıp çalışmadığı ölçülemedi (taranmamış ya da kapalı SAYILMADI)." };
  if (!hub) return { metin: 'tarama yok', renk: 'var(--text-muted)', aciklama: '' };
  const d = hubDurumu(hub);
  return { metin: `${d.metin} · auto-start ${hub.autoStart}`, renk: d.renk, aciklama: d.aciklama };
}
function HubHucresi({ hub, okunamadi }: { hub: HubV3 | null; okunamadi: boolean }) {
  const hc = hubHucresi(hub, okunamadi);
  return <span style={{ color: hc.renk }} title={hc.aciklama || undefined}>{hc.metin}</span>;
}

// STOP ONAYINDA SERVER HUB: kayit acilirken alinan kesif saklanmaz; onay penceresi acilinca
// kesif yeniden okunur. Yanit gelmezse, ok degilse ya da hubUnavailable ise "okunamadi".
type StopHubDurumu = 'denetleniyor' | 'okundu' | 'okunamadi';
function stopHubDurumu(d: RtDiscovery | null | undefined): StopHubDurumu {
  if (!d || d.ok !== true) return 'okunamadi';
  return hubOkunamadi(d) ? 'okunamadi' : 'okundu';
}
/** STOP onay metnine eklenen uyari; Server Hub okunduysa null. Dugmeyi KAPATMAZ (yalniz bilgi). */
function stopHubUyarisi(durum: StopHubDurumu): string | null {
  if (durum === 'okundu') return null;
  if (durum === 'denetleniyor') return 'Server Hub durumu denetleniyor…';
  return "Server Hub okunamadı — JVM'in çalışıp çalışmadığı ölçülemedi (kapalı ya da taranmamış SAYILMADI). Durdurmadan önce sunucuda doğrulayın.";
}
/** STOP onay penceresindeki uyari kutusu (ayri bilesen: ekrana cikip cikmadigi bekcide CAGRILARAK
 *  sinanir). Okunamadiysa role=alert; okunduysa hicbir sey basilmaz. Gizlenmez (hidden yok). */
function StopHubUyari({ durum }: { durum: StopHubDurumu }) {
  const metin = stopHubUyarisi(durum);
  if (!metin) return null;
  return <div role={durum === 'okunamadi' ? 'alert' : undefined} className="text-[12px] rounded-lg border px-3 py-2" style={durum === 'okunamadi' ? { color: 'var(--status-warning)', borderColor: 'var(--status-warning)', background: 'var(--status-warning-bg)' } : { color: 'var(--text-muted)', borderColor: 'var(--border-subtle)' }}>{metin}</div>;
}

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
  const hubYok = hubOkunamadi(disc);
  // ── TRAFIK UYARISI (kullanici, 2026-10-08) ──────────────────────────────────────────
  // "Retirement kaydi girilirken sunucunun Apache loglarinda hc istegi disinda istegin
  // olup olmadigi kontrol edilip kaydi acana gosterilebilir mi? 'Bak halen istek var,
  // yine de retire prosedurune devam etmek istiyor musun?' gibi soru sorulabilir."
  //
  // YALNIZ SECILI HEDEFLER sayilir: secmedigi bir sunucunun trafigi karari etkilemez.
  // "olculemedi" AYRI tutulur - "trafik yok" sayilamaz ama "var" da denemez; ikisi icin
  // AYRI metin gosterilir, tek bir uyariya karistirmak ikisini de anlamsizlastirirdi.
  const trafikli = selected.flatMap((t) => (t.web || []).filter((w) => w.trafik?.durum === 'var').map((w) => ({ t, w })));
  const trafikOlculemedi = selected.flatMap((t) => (t.web || []).filter((w) => !w.trafik || w.trafik.durum === 'olculemedi').map((w) => ({ t, w })));
  const [trafikOnay, setTrafikOnay] = useState(false);

  const create = async () => {
    if (!app || !f.smartNo.trim()) { toast.error('Uygulama ve Smart kayıt numarası gerekli.'); return; }
    if (needsOco && !f.ocoNo.trim()) { toast.error('PROD hedef seçili: OCO numarası zorunlu.'); return; }
    if (!selected.length) { toast.error('En az bir hedef seçin.'); return; }
    // ONAY KUTUSU ZORUNLU, kayit ACILMAZ. Uyariyi yalnizca gostermek, kaydi aciklamadan
    // gecilebilir bir metne cevirirdi; kullanici "soru sorulabilir" dedi.
    if (trafikli.length && !trafikOnay) {
      toast.error('Seçili vhost’larda hâlâ istek var — devam etmek için onay kutusunu işaretleyin.');
      return;
    }
    setBusy(true);
    try {
      const r = await retirementApi.create({ app, smartNo: f.smartNo.trim(), ocoNo: f.ocoNo.trim() || undefined, ownerEmail: f.ownerEmail.trim() || undefined, deleteAfterDays: Number(f.deleteAfterDays) || defaultDays, plannedDeleteAt: f.plannedDeleteAt || null, dnsReuse: f.dnsReuse, lbReuse: f.lbReuse, notes: f.notes, targets: selected.map((t) => ({ host: t.host, appName: t.appName })) });
      if (!r.ok) { toast.error(r.message || 'Kayıt açılamadı.'); return; }
      toast.success(`Retirement kaydı #${r.id} açıldı (${selected.length} hedef).`); onCreated(r.id);
    } catch (e: unknown) { toast.error(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };

  return (
    <Modal open onClose={onClose} title="Yeni retirement kaydı" subtitle="Smart silme kaydı (364244_Delete_6) geldikten sonra açılır; PROD için altyapı OCO'su gerekir." icon={TrashIcon} size="wide"
      footer={<div className="flex items-center gap-2 w-full"><span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>{selected.length} hedef seçili{needsOco ? ' · PROD var: OCO zorunlu' : ''}</span><span className="ml-auto" /><button onClick={onClose} className={SM_BTN} style={smBtn()}>İptal</button><button disabled={busy || !disc} onClick={create} className={SM_BTN} style={smBtn(true)}>Kaydı aç</button></div>}>
      <div className="space-y-3">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
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
          <div className="md:col-span-2 xl:col-span-3"><label className="text-[11px] font-semibold" style={{ color: 'var(--text-muted)' }}>Not</label><textarea value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} rows={2} className={INPUT} style={inputStyle} /></div>
        </div>

        {discLoading && <div className="text-xs" style={{ color: 'var(--text-muted)' }}>Envanter taranıyor…</div>}
        {disc && (
          <div className="space-y-2">
            <div className="flex items-center gap-3 text-[12px]" style={{ color: 'var(--text-secondary)' }}>
              <b>{disc.summary.total}</b> hedef · Pendik {disc.summary.bySite.Pendik} · <b style={disc.summary.bySite.Ankara ? { color: 'var(--status-warning)' } : undefined}>Ankara {disc.summary.bySite.Ankara}</b> · {Object.entries(disc.summary.byEnv).filter(([, n]) => n).map(([e, n]) => `${e} ${n}`).join(' · ')} · web eşlenen {disc.summary.webMatched}
              <button onClick={() => setSel(new Set(disc.targets.map(key)))} className={SM_BTN} style={smBtn()}>tümü</button>
              <button onClick={() => setSel(new Set())} className={SM_BTN} style={smBtn()}>hiçbiri</button>
            </div>
            {/* HALA ISTEK VAR MI? Apache/IHS access log'undan, hc HARIC (Server Hub
                taramasi: dbo.Server_Hub_Vhosts). Olculemeyenler AYRI kutuda. */}
            {trafikli.length > 0 && (
              <div className="rounded-lg border px-3 py-2 text-[12px] space-y-1.5" style={{ borderColor: 'var(--status-danger)', color: 'var(--status-danger)' }}>
                <div className="font-semibold">
                  Dikkat: seçili {trafikli.length} vhost’ta hâlâ istek var (health-check hariç)
                </div>
                <div className="font-mono text-[11px]" style={{ color: 'var(--text-secondary)' }}>
                  {trafikli.slice(0, 6).map(({ t, w }) => (
                    <div key={`uy-${t.host}-${w.serverName}`}>
                      {w.serverName} @ {w.host} — {w.trafik?.sampled ? 'en az ' : ''}{w.trafik?.req7} istek / 7 gün
                      {w.trafik?.req24 != null ? ` · 24s ${w.trafik.req24}` : ''}
                    </div>
                  ))}
                  {trafikli.length > 6 && <div>… +{trafikli.length - 6} vhost</div>}
                </div>
                <label className="flex items-start gap-2 cursor-pointer" style={{ color: 'var(--text-primary)' }}>
                  <input type="checkbox" checked={trafikOnay} onChange={(e) => setTrafikOnay(e.target.checked)} className="mt-0.5" />
                  <span className="text-[11px]">
                    İstek olmasına rağmen retirement prosedürüne <b>devam etmek istiyorum</b>
                  </span>
                </label>
              </div>
            )}
            {trafikOlculemedi.length > 0 && (
              <div className="rounded-lg border px-3 py-2 text-[11px]" style={{ borderColor: 'var(--status-warning)', color: 'var(--status-warning)' }}>
                {trafikOlculemedi.length} vhost’un trafiği <b>ölçülemedi</b> — bu “istek yok” DEMEK DEĞİL.
                {disc.summary.trafik?.okunamadi
                  ? ` Server Hub vhost tablosu okunamadı: ${disc.summary.trafik.okunamadi}`
                  : ' Server Hub taramasında log okunamamış olabilir (izin, bütçe ya da log formatı); durdurmadan önce sunucuda doğrulayın.'}
              </div>
            )}
            {/* Pencere genisledi: tablo da yukseldi. 18rem'de 4-5 satir gorunuyordu ve
                hedef secimi kaydirmayla yapiliyordu. */}
            <div className="overflow-auto rounded-lg border" style={{ borderColor: 'var(--border-subtle)', maxHeight: '32rem' }}>
              <table className="w-full text-xs border-collapse">
                <thead className="sticky top-0" style={{ background: 'var(--bg-elevated)' }}><tr>{['', 'Sunucu', 'Site', 'Ortam', 'Uygulama', 'JBoss', 'Envanter', 'Server Hub', 'Web sunucusu / vhost', 'Trafik (hc hariç)', 'Paket'].map((h, i) => <th key={h + i} className="px-2 py-1.5 text-left text-[11px] font-semibold" style={{ color: 'var(--text-muted)' }}>{h}</th>)}</tr></thead>
                <tbody>
                  {disc.targets.length === 0 ? <TableEmptyRow colSpan={11} title="Envanterde bu uygulama için sunucu yok." /> : disc.targets.map((t) => (
                    <tr key={key(t)} className="border-t" style={{ borderColor: 'var(--border-subtle)' }}>
                      <td className="px-2 py-1"><input type="checkbox" checked={sel.has(key(t))} onChange={(e) => { const s = new Set(sel); if (e.target.checked) s.add(key(t)); else s.delete(key(t)); setSel(s); }} /></td>
                      <td className="px-2 py-1 font-mono font-semibold">{t.host}</td>
                      <td className="px-2 py-1" style={t.site === 'Ankara' ? { color: 'var(--status-warning)', fontWeight: 600 } : undefined}>{t.site}</td>
                      <td className="px-2 py-1"><b>{t.env}</b></td>
                      <td className="px-2 py-1">{t.appName}</td>
                      <td className="px-2 py-1">{t.gen ? `JBoss ${t.gen}` : <span style={{ color: 'var(--status-danger)' }}>?</span>}</td>
                      <td className="px-2 py-1 text-[10px]" style={{ color: 'var(--text-muted)' }}>{t.inventoryStatus || '—'}</td>
                      <td className="px-2 py-1 text-[10px]"><HubHucresi hub={t.hub} okunamadi={hubYok} /></td>
                      <td className="px-2 py-1 text-[10px]">{t.web.length ? t.web.map((w) => <div key={w.host + w.serverName} title={t.webHow}>{w.host} · {w.serverName}{w.product ? ` (${w.product})` : ''}</div>) : <span style={{ color: 'var(--status-warning)' }} title={t.webHow}>eşlenemedi</span>}</td>
                      <td className="px-2 py-1 text-[10px]">
                        {t.web.length
                          ? t.web.map((w) => <div key={`tr-${w.host}-${w.serverName}`}><TrafikHucresi tr={w.trafik} /></div>)
                          : <span style={{ color: 'var(--text-muted)' }}>—</span>}
                      </td>
                      <td className="px-2 py-1 font-mono text-[10px]"><div className="truncate max-w-[28rem]" title={t.appPath}>{t.appPath || '—'}</div></td>
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
  const [geriAl, setGeriAl] = useState<{ t: RtTarget } | null>(null);
  const [iptalSor, setIptalSor] = useState(false);
  // AKIS PANELI: satira tiklaninca altinda asamalar acilir (tek satir acik).
  const [akis, setAkis] = useState<number | null>(null);
  const [hubDurum, setHubDurum] = useState<StopHubDurumu>('denetleniyor');
  const hubIstek = useRef(0);

  const load = useCallback(async () => {
    try { const r = await retirementApi.get(id); if (r.ok) { setRec(r.record); setErr(''); } else setErr(r.message || 'Kayıt alınamadı.'); }
    catch (e: unknown) { setErr(e instanceof Error ? e.message : String(e)); }
  }, [id]);
  useEffect(() => { load(); }, [load]);

  // STOP onayi acilinca Server Hub kesifle yeniden okunur; yalniz SON istegin yaniti yazilir.
  const stopSor = (t: RtTarget) => {
    if (!rec) return;
    setAsk({ t });
    setHubDurum('denetleniyor');
    const no = ++hubIstek.current;
    retirementApi.discover(rec.app)
      .then((d) => { if (hubIstek.current === no) setHubDurum(stopHubDurumu(d)); })
      .catch(() => { if (hubIstek.current === no) setHubDurum('okunamadi'); });
  };

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
  // ── GERI AL (kullanici, 2026-10-07) ─────────────────────────────────────────────
  // "Uygulamami geri aktif et vs ve yaptigimiz degisiklikler geri alinmali."
  // Hedef 'rolling_back' olur olmaz zamanlanmis SILME devre disi kalir.
  const rollback = async (t: RtTarget, confirmed: boolean) => {
    setBusy(t.id); setGeriAl(null);
    try {
      const r = await retirementApi.rollback(id, t.id, confirmed);
      if (!r.ok) { toast.error(r.message || 'İş başlatılamadı.'); return; }
      toast.success(`${confirmed ? 'Geri alma' : 'Geri alma planı'} işi başladı (#${r.jobId}).`);
      // VHOST GERI ACMA SESSIZ KALMAZ: atlanan/hatali girdiler kullaniciya soylenir,
      // yoksa uygulama ayaga kalkar ama onune trafik gelmez ve sebebi gorunmez.
      if (confirmed && r.web) {
        if (r.web.hata) toast.error(`${r.web.hata} vhost geri açılamadı — Olaylar listesine bakın.`);
        else if (r.web.denendi) toast.success(`${r.web.denendi} vhost geri açma işi başlatıldı.`);
      }
      let done = false;
      addJob({
        title: `Retirement: ${confirmed ? 'GERİ AL' : 'geri alma planı'} ${t.appName} @ ${t.host}`,
        fetchStatus: async () => {
          const st = await retirementApi.jobStatus(id, t.id, r.awxServerId, r.jobId as number);
          if (!st.ok) throw new Error(st.message || 'Durum okunamadı.');
          if (TERMINAL.has(st.status) && !done) { done = true; load(); }
          return { status: st.status, output: st.output || '', result: st.result };
        },
      });
      await load();
    } catch (e: unknown) { toast.error(e instanceof Error ? e.message : String(e)); } finally { setBusy(null); }
  };
  // ── IPTAL, GERI ALMA DEGILDIR (kullanici bulgusu 2026-10-08) ────────────────────
  // "Kaydi iptal ettim de otomatik geri donecek mi? Sanki su an iptal ettim ama geri
  // donmedi." Iptal YALNIZCA kaydi kapatir: zamanlanmis SILME bir daha tetiklenmez
  // (deleteTick `r.status NOT IN ('cancelled','deleted')` suzuyor) ama SUNUCUYA
  // DOKUNULMAZ - uygulama durdurulmus halde KALIR.
  //
  // Eskiden bu dugmenin ONAYI DA YOKTU: tek tikla iptal oluyor ve ekran uygulamanin
  // kapali kaldigini SOYLEMIYORDU. Simdi onay penceresi iki ayri eylem sunuyor;
  // "iptal = geri getir" varsayimi sessizce dogru ya da yanlis olmaktan cikti.
  // GECIS DURUMUNDA TAKILMIS hedefi cozer: AWX isini OKUR, gercek sonucu yazar.
  // Poller tabanli sonuclandirma uzun sure bozuktu (6177b4e) ve onyuz yoklamasi yalniz
  // ekranda bekleyen biri varken kosuyor; hedef 'stopping'de kalinca EKRANDA HICBIR
  // DUGME KALMIYORDU (kullanici bulgusu 2026-10-08: "dokunamiyorum").
  const tazele = async (t: RtTarget) => {
    setBusy(t.id);
    try {
      const r = await retirementApi.refreshStatus(id, t.id);
      if (!r.ok) { toast.error(r.message || 'Durum tazelenemedi.'); return; }
      if (r.degisti) {
        toast.success(`${t.appName} @ ${t.host}: ${r.from} → ${r.to}`);
        if (r.record) setRec(r.record); else await load();
      } else {
        toast.success(r.message || 'Durum değişmedi.');
      }
    } catch (e: unknown) { toast.error(e instanceof Error ? e.message : String(e)); } finally { setBusy(null); }
  };
  const cancel = async (geriAlDa: boolean) => {
    setIptalSor(false);
    const durdurulmus = (rec?.targets || []).filter(
      (t) => (t.status === 'stopped' || t.status === 'rollback_failed') && !t.deletedAt,
    );
    const r = await retirementApi.cancel(id, 'kullanıcı iptal etti');
    if (!r.ok) { toast.error(r.message || 'İptal edilemedi.'); return; }
    setRec(r.record);
    if (!geriAlDa) {
      toast.success(
        durdurulmus.length
          ? `Kayıt iptal edildi. ${durdurulmus.length} uygulama DURDURULMUŞ halde kaldı — geri getirmek için "Geri aktif et".`
          : 'Kayıt iptal edildi.',
      );
      return;
    }
    // HER HEDEF ICIN SIRAYLA: rollback() kendi hatasini kendi bildirir ve durumu
    // 'rolling_back' yapar, yani silme kapisi zaten kapanir.
    for (const t of durdurulmus) await rollback(t, true);
    await load();
  };
  const addNote = async () => { if (!note.trim()) return; const r = await retirementApi.note(id, note.trim()); if (r.ok) { setRec(r.record); setNote(''); } };

  return (
    <Modal open onClose={onClose} title={rec ? `Retirement #${rec.id} — ${rec.app}` : `Retirement #${id}`} subtitle={rec ? `Smart ${rec.smartNo}${rec.ocoNo ? ` · OCO ${rec.ocoNo}` : ''} · açan ${rec.requestedBy} · ${fmtDateTime(rec.createdAt)}` : undefined} icon={TrashIcon} size="wide"
      footer={<div className="flex items-center gap-2 w-full">{rec && rec.status !== 'cancelled' && rec.status !== 'deleted' && <button onClick={() => setIptalSor(true)} className={SM_BTN} style={{ ...smBtn(), color: 'var(--status-danger)', borderColor: 'var(--status-danger)' }}><XMarkIcon className="w-3.5 h-3.5" /> Kaydı iptal et</button>}<span className="ml-auto" /><button onClick={onClose} className={SM_BTN} style={smBtn()}>Kapat</button></div>}>
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
                      <td className="px-2.5 py-1.5 text-[10px]" style={{ color: 'var(--text-secondary)' }}><div className="max-w-[40rem] truncate" title={t.resultText || t.planText || ''}>{t.resultText || t.planText || (t.lastJobId ? `iş #${t.lastJobId}` : '—')}</div></td>
                      <td className="px-2.5 py-1.5">
                        {canAct && (
                          <div className="flex gap-1">
                            <button disabled={busy != null} onClick={() => stop(t, false)} className={SM_BTN} style={smBtn()} title="Sunucuda plan koş: ne yapılacağını göster, hiçbir şey değişmez"><ClipboardDocumentCheckIcon className="w-3.5 h-3.5" /> Plan</button>
                            {t.status === 'planned' && <button disabled={busy != null} onClick={() => stopSor(t)} className={SM_BTN} style={{ ...smBtn(true), background: 'var(--status-danger)', borderColor: 'var(--status-danger)' }}><StopCircleIcon className="w-3.5 h-3.5" /> STOP</button>}
                          </div>
                        )}
                        {/* GERI AL: yalniz durdurulmus ve HENUZ SILINMEMIS hedeflerde.
                            'rollback_failed' tekrar denemeye acik - yarim kalmis bir geri
                            almayi kilitlemek uygulamayi erisilemez birakirdi. */}
                        <div className="flex gap-1 mt-1">
                          <button onClick={() => setAkis((x) => (x === t.id ? null : t.id))} className={SM_BTN} style={smBtn()} title="Akış: hangi adımda, hangi komut, ne kadar kaldı">
                            {akis === t.id ? 'Akışı kapat' : 'Akış'}
                          </button>
                          {/* GECIS DURUMU: tek cikis yolu durumu TAZELEMEK. Bu durumlarda
                              ne STOP ne geri alma dugmesi gorunur; tazelemeden sonra
                              gercek duruma gore dugmeler acilir. */}
                          {['planning', 'stopping', 'rolling_back', 'deleting'].includes(t.status) && (
                            <button disabled={busy != null} onClick={() => tazele(t)} className={SM_BTN} style={{ ...smBtn(), color: 'var(--status-warning)', borderColor: 'var(--status-warning)' }} title="AWX işini oku ve gerçek sonucu yaz (okunamazsa hiçbir şey yazılmaz)">
                              <ArrowPathIcon className="w-3.5 h-3.5" /> Durumu tazele
                            </button>
                          )}
                        </div>
                        {(t.status === 'stopped' || t.status === 'rollback_failed') && !t.deletedAt && (
                          <div className="flex gap-1 mt-1">
                            <button disabled={busy != null} onClick={() => rollback(t, false)} className={SM_BTN} style={smBtn()} title="Geri alma planı: ne yapılacağını göster, hiçbir şey değişmez"><ClipboardDocumentCheckIcon className="w-3.5 h-3.5" /> Geri alma planı</button>
                            <button disabled={busy != null} onClick={() => setGeriAl({ t })} className={SM_BTN} style={{ ...smBtn(true), background: 'var(--status-ok, #15803d)', borderColor: 'var(--status-ok, #15803d)' }} title="Uygulamayı geri aktif et: paketler geri adlandırılır, auto-start açılır, JVM başlatılır, vhost'lar geri açılır"><ArrowUturnLeftIcon className="w-3.5 h-3.5" /> Geri aktif et</button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {/* AKIS SATIRI: secili hedefin asamalari. React fragment yerine AYRI bir
                    <tr> cunku tablo yapisi icinde kalmasi gerekiyor. */}
                {akis != null && rec.targets.some((t) => t.id === akis) && (() => {
                  const t = rec.targets.find((x) => x.id === akis) as RtTarget;
                  return (
                    <tr key={`akis-${t.id}`} className="border-t" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-elevated)' }}>
                      <td colSpan={6} className="px-3 py-2.5">
                        <div className="text-[11px] font-semibold mb-1.5" style={{ color: 'var(--text-secondary)' }}>
                          {t.appName} @ {t.host} — akış
                        </div>
                        <RetirementAkis rec={rec} t={t} />
                      </td>
                    </tr>
                  );
                })()}
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
            {/* PLAN AYRINTISI: ozet "2 paket yeniden adlandirilacak" diyor ama HANGI iki
                paket oldugunu soylemiyordu. Islem geri alinamaz; onay vermeden once
                dokunulacak dosyalar GORUNMELI. Alan gelmediyse (eski playbook) hic
                cizilmez - bos bir kutu "ayrinti yok" diye okunurdu. */}
            {ask.t.detail && ask.t.detail.steps.length > 0 && (
              <div className="text-[11px] rounded-lg border px-3 py-2 space-y-1" style={{ borderColor: 'var(--border-subtle)' }}>
                <div className="font-semibold" style={{ color: 'var(--text-muted)' }}>Playbook planı (adım adım)</div>
                {ask.t.detail.steps.map((x, i) => {
                  const p = x.split('	');
                  const ad = p[1] || '';
                  const dur = p[2] || '';
                  const mesaj = p.slice(3).join(' ');
                  return (
                    <div key={i} className="flex gap-2">
                      <span className="font-mono shrink-0" style={{ color: dur === 'FAIL' ? 'var(--status-danger)' : dur === 'SKIP' ? 'var(--text-muted)' : 'var(--status-info)' }}>{ad} · {dur}</span>
                      <span className="break-all">{mesaj}</span>
                    </div>
                  );
                })}
              </div>
            )}
            <p className="text-[12px]" style={{ color: 'var(--text-secondary)' }}>auto-start kapatılır, JVM durdurulur, paket(ler) <code>.{rec?.smartNo}.old</code> yapılır. {ask.t.env === 'PROD' ? 'PROD: SCC bilgilendirme maili gider.' : ''} Geri almak için JVM elle başlatılır ve paket adı düzeltilir.</p>
            <StopHubUyari durum={hubDurum} />
            <div className="flex justify-end gap-2"><button onClick={() => setAsk(null)} className={SM_BTN} style={smBtn()}>İptal</button><button onClick={() => stop(ask.t, true)} className={SM_BTN} style={{ ...smBtn(true), background: 'var(--status-danger)', borderColor: 'var(--status-danger)' }}>Onayla ve durdur</button></div>
          </div>
        </div>
      )}
      {/* GERI ALMA ONAYI. Plan dugmesi ayri duruyor; bu pencere GERCEK islemi onaylatir
          ve NE OLACAGINI madde madde yazar - "geri aktif et" tek kelimeyle gecilecek
          kadar kucuk bir islem degil (JVM baslatilir, trafik geri doner). */}
      {/* IPTAL ONAYI (2026-10-08). Kullanici "iptal ettim ama geri donmedi" dedi; iptalin
          NE YAPTIGI ve NE YAPMADIGI burada yazili, ve geri getirme AYNI pencereden
          tetiklenebiliyor - sessiz bir varsayim kalmiyor. */}
      {iptalSor && rec && (() => {
        const durdurulmus = rec.targets.filter(
          (t) => (t.status === 'stopped' || t.status === 'rollback_failed') && !t.deletedAt,
        );
        return (
          <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,.45)' }} onClick={() => setIptalSor(false)}>
            <div className="rounded-xl border p-4 max-w-xl w-full space-y-3" style={{ background: 'var(--bg-elevated)', borderColor: 'var(--border)' }} onClick={(e) => e.stopPropagation()}>
              <div className="text-sm font-semibold">Retirement #{rec.id} — {rec.app} kaydı iptal edilecek</div>
              <ul className="text-[12px] space-y-1 list-disc pl-4" style={{ color: 'var(--text-secondary)' }}>
                <li>Zamanlanmış <b>silme</b> bir daha tetiklenmez</li>
                <li>Bekleyen <b>STOP</b> zamanlaması düşer</li>
                <li><b>Sunucuya dokunulmaz</b> — iptal, yapılmış değişiklikleri geri almaz</li>
              </ul>
              {durdurulmus.length > 0 ? (
                <div className="text-[12px] rounded-lg px-3 py-2 border" style={{ color: 'var(--status-danger)', borderColor: 'var(--status-danger)' }}>
                  <b>{durdurulmus.length} uygulama şu an DURDURULMUŞ</b> ve iptal onları ayağa kaldırmaz:
                  <div className="font-mono text-[11px] mt-1" style={{ color: 'var(--text-secondary)' }}>
                    {durdurulmus.map((t) => `${t.appName} @ ${t.host}`).join(' · ')}
                  </div>
                </div>
              ) : (
                <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                  Durdurulmuş hedef yok — geri alınacak bir şey de yok.
                </div>
              )}
              <div className="flex justify-end gap-2 flex-wrap">
                {/* "KAPAT", "Iptal" DEGIL: hemen yaninda "Yalniz kaydi iptal et" var. Evin
                    standart kapatma fiili "Iptal" burada "kaydi iptal eden dugme hangisi?"
                    belirsizligini yaratir. ("Vazgec" G29 ile yasak.) */}
                <button onClick={() => setIptalSor(false)} className={SM_BTN} style={smBtn()}>Kapat</button>
                <button onClick={() => cancel(false)} className={SM_BTN} style={{ ...smBtn(), color: 'var(--status-danger)', borderColor: 'var(--status-danger)' }}>
                  Yalnız kaydı iptal et
                </button>
                {durdurulmus.length > 0 && (
                  <button onClick={() => cancel(true)} className={SM_BTN} style={{ ...smBtn(true), background: 'var(--status-ok, #15803d)', borderColor: 'var(--status-ok, #15803d)' }}>
                    İptal et ve {durdurulmus.length} uygulamayı geri aktif et
                  </button>
                )}
              </div>
            </div>
          </div>
        );
      })()}
      {geriAl && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,.45)' }} onClick={() => setGeriAl(null)}>
          <div className="rounded-xl border p-4 max-w-xl w-full space-y-3" style={{ background: 'var(--bg-elevated)', borderColor: 'var(--border)' }} onClick={(e) => e.stopPropagation()}>
            <div className="text-sm font-semibold">{geriAl.t.appName} @ {geriAl.t.host} geri aktif edilecek</div>
            <ul className="text-[12px] space-y-1 list-disc pl-4" style={{ color: 'var(--text-secondary)' }}>
              <li>Paketler <code>.{rec?.smartNo}.old</code> sonekinden kurtarılır (hedefte aynı adlı yeni bir paket varsa <b>üzerine yazılmaz, atlanır</b>)</li>
              <li><code>auto-start=true</code> yapılır</li>
              <li>JVM başlatılır ve RUNNING olması beklenir</li>
              <li>STOP'ta kaldırılan Apache/IHS vhost'ları geri açılır (<code>apachectl -t</code> geçmezse geri alınır)</li>
              <li><b>Zamanlanmış silme devre dışı kalır</b> — hedef artık "stopped" olmadığı için silme işi hiç tetiklenmez</li>
            </ul>
            <div className="text-[11px] rounded-lg px-3 py-2 border" style={{ color: 'var(--text-secondary)', borderColor: 'var(--border-subtle)' }}>
              Uygulama <b>canlıya geri döner</b>. PROD hedefte trafik almaya başlar — bunun planlı olduğundan emin olun.
            </div>
            <div className="flex justify-end gap-2">
              <button onClick={() => setGeriAl(null)} className={SM_BTN} style={smBtn()}>İptal</button>
              <button onClick={() => rollback(geriAl.t, true)} className={SM_BTN} style={{ ...smBtn(true), background: 'var(--status-ok, #15803d)', borderColor: 'var(--status-ok, #15803d)' }}>Onayla ve geri aktif et</button>
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}
