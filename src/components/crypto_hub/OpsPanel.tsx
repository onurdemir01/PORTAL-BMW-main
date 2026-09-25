// src/components/crypto_hub/OpsPanel.tsx — Crypto Hub işlemleri: pod listesi, log, pod
// silme, rollout ve replika (2026-09-26).
//
// Kullanıcı: "seçilen pod'un loglarını hızlıca gösterecek bir yapı kur — LogX'e girmelerini
// istemiyorum. Pod silme veya rollout için de OpsX'e girmelerine gerek kalmasın. Ayrıca
// deployment/statefulset replika sayılarını da ayarlayabilsinler."
//
// ÜÇ KURAL:
//  1) OKUYAN işlem (pod listesi, log) doğrudan koşar; YAZAN işlem (sil / rollout / replika)
//     önce KOŞACAK KOMUTU gösteren bir onay penceresinden geçer. Sunucu da onaysız isteği
//     reddeder (HTTP 428) — ekranın onayı atlaması yetmez.
//  2) HEDEF AÇIKÇA SEÇİLİR. "Hepsini sil" gibi bir kestirme YOK: bu ekranda en pahalı hata,
//     yanlış seçimle tüm namespace'i söndürmektir.
//  3) İş AWX'te koşar; sonuç gelene kadar ekran "çalışıyor" der. Sonuç boş dönerse bu
//     "sorun yok" DEĞİLDİR — hata satırları ayrıca gösterilir.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowPathIcon, TrashIcon, DocumentTextIcon, ArrowPathRoundedSquareIcon,
  AdjustmentsHorizontalIcon, ExclamationTriangleIcon, CheckCircleIcon, XCircleIcon,
  ClipboardDocumentIcon, CheckIcon,
} from '@heroicons/react/24/outline';
import { Modal } from '@/components/common/Modal';
import { TableEmptyRow } from '@/components/common/EmptyState';
import { cryptoOpsApi, type CryptoOpsAction, type CryptoOpsResult, type CryptoPod } from '@/api/cryptoHubApi';
import { toast } from '@/hooks/useToast';

const SM_BTN = 'inline-flex items-center gap-1 h-7 px-2.5 text-[11px] font-medium leading-none rounded-lg border whitespace-nowrap disabled:opacity-40';
const btn = (tone?: 'primary' | 'danger'): React.CSSProperties => {
  if (tone === 'primary') return { background: 'var(--accent)', borderColor: 'var(--accent)', color: 'var(--accent-fg, #fff)' };
  if (tone === 'danger') return { borderColor: 'var(--status-danger)', background: 'var(--status-danger-bg)', color: 'var(--status-danger)' };
  return { borderColor: 'var(--border)', background: 'var(--bg-surface)', color: 'var(--text-primary)' };
};

export interface OpsRequest {
  action: CryptoOpsAction;
  targets: string[];
  tail?: number;
  container?: string;
  previous?: boolean;
  replicas?: number;
}

/** İşlemin koşacağı komutun İNSAN OKUNUR karşılığı — onay penceresinde gösterilir. */
export function opsCommand(req: OpsRequest, namespace: string): string {
  const ns = `-n ${namespace}`;
  switch (req.action) {
    case 'pods': return `oc get pods ${ns}`;
    case 'logs': return req.targets.map((t) => `oc logs ${t} ${ns} --tail=${req.tail || 200}${req.container ? ` -c ${req.container}` : ''}${req.previous ? ' --previous' : ''}`).join('\n');
    case 'pod_delete': return req.targets.map((t) => `oc delete pod ${t} ${ns} --force --grace-period=0 --timeout=60s`).join('\n');
    case 'rollout': return req.targets.map((t) => `oc rollout restart ${t} ${ns}`).join('\n');
    case 'scale': return req.targets.map((t) => `oc scale ${t} ${ns} --replicas=${req.replicas}`).join('\n');
    default: return '';
  }
}

const WRITES: Record<CryptoOpsAction, boolean> = {
  pods: false, logs: false, pod_delete: true, rollout: true, scale: true,
};

/** AWX işini başlatır ve bitene kadar yoklar. Sonuç ile hata AYRI döner. */
export function useOps(tenantKey: string) {
  const [busy, setBusy] = useState<CryptoOpsAction | null>(null);
  const timer = useRef<number | null>(null);
  useEffect(() => () => { if (timer.current) window.clearTimeout(timer.current); }, []);

  const run = useCallback(async (req: OpsRequest): Promise<CryptoOpsResult | null> => {
    setBusy(req.action);
    try {
      const started = await cryptoOpsApi.run({
        tenant: tenantKey,
        ...req,
        // Yazan islem SUNUCUDA da onay ister; ekran buraya geldiyse onay verilmistir.
        confirmed: WRITES[req.action] ? true : undefined,
      });
      if (!started.ok || started.jobId == null || started.awxServerId == null) {
        toast.error(started.message || 'İş başlatılamadı.');
        return null;
      }
      const serverId = started.awxServerId;
      const jobId = started.jobId;
      // AWX isi birkac saniye surer; 3 saniyede bir yoklanir, 5 dakikada vazgecilir.
      const bitis = Date.now() + 5 * 60 * 1000;
      for (;;) {
        // eslint-disable-next-line no-await-in-loop
        const r = await cryptoOpsApi.result(serverId, jobId);
        if (!r.ok) { toast.error(r.message || 'Sonuç okunamadı.'); return null; }
        if (r.result) return r.result;
        if (['failed', 'error', 'canceled'].includes(r.status)) {
          toast.error(`İş ${r.status} durumunda bitti (#${jobId}).`);
          return null;
        }
        if (Date.now() > bitis) { toast.error(`İş hâlâ sürüyor (#${jobId}); Ansible ekranından izleyebilirsiniz.`); return null; }
        // eslint-disable-next-line no-await-in-loop
        await new Promise((res) => { timer.current = window.setTimeout(res, 3000); });
      }
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : String(e));
      return null;
    } finally {
      setBusy(null);
    }
  }, [tenantKey]);

  return { run, busy };
}

function CopyBtn({ text }: { text: string }) {
  const [ok, setOk] = useState(false);
  return (
    <button type="button" className={SM_BTN} style={btn()} onClick={async () => {
      try { await navigator.clipboard.writeText(text); setOk(true); setTimeout(() => setOk(false), 1500); } catch { toast.error('Kopyalanamadı.'); }
    }}>
      {ok ? <CheckIcon className="h-3.5 w-3.5" /> : <ClipboardDocumentIcon className="h-3.5 w-3.5" />} {ok ? 'kopyalandı' : 'Kopyala'}
    </button>
  );
}

/** Yazan işlem onayı: KOŞACAK KOMUT aynen gösterilir. */
export function OpsConfirm({ req, namespace, tenantLabel, onCancel, onConfirm }: {
  req: OpsRequest; namespace: string; tenantLabel: string;
  onCancel: () => void; onConfirm: () => void;
}) {
  const baslik = req.action === 'pod_delete' ? 'Pod silme'
    : req.action === 'rollout' ? 'Rollout restart' : 'Replika değişikliği';
  const komut = opsCommand(req, namespace);
  return (
    <Modal
      open
      onClose={onCancel}
      size="xl"
      dismissOnBackdrop={false}
      title={`${baslik} — onay`}
      subtitle={`${tenantLabel} · ${req.targets.length} hedef`}
      footer={(
        <div className="flex items-center gap-2 w-full">
          <button type="button" className="h-9 px-4 text-sm font-medium rounded-lg border"
            style={{ borderColor: 'var(--status-danger)', background: 'var(--status-danger)', color: '#fff' }}
            onClick={onConfirm}>
            Onayla ve çalıştır
          </button>
          <CopyBtn text={komut} />
          <span className="flex-1" />
          <button type="button" className="h-9 px-3 text-xs font-medium rounded-lg border" style={btn()} onClick={onCancel}>Vazgeç</button>
        </div>
      )}
    >
      <div className="space-y-3">
        <div className="text-[12px] rounded-lg px-3 py-2 border flex items-start gap-2"
          style={{ color: 'var(--status-danger)', background: 'var(--status-danger-bg)', borderColor: 'var(--status-danger)' }}>
          <ExclamationTriangleIcon className="h-4 w-4 mt-0.5 shrink-0" />
          <span>
            Bu işlem <b>ortamda gerçek değişiklik yapar</b>. Aşağıdaki komut(lar) {namespace} namespace'inde koşacak.
            {req.action === 'scale' && req.replicas === 0 && ' Replika 0 demek, bileşenin KAPATILMASI demektir.'}
          </span>
        </div>
        <div>
          <div className="text-[11px] uppercase tracking-wide mb-1" style={{ color: 'var(--text-muted)' }}>Koşacak komut</div>
          <pre className="text-[12px] leading-relaxed rounded-lg px-3 py-2.5 overflow-x-auto"
            style={{ background: 'var(--bg-elevated)', color: 'var(--text-primary)', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>{komut}</pre>
        </div>
        <div>
          <div className="text-[11px] uppercase tracking-wide mb-1" style={{ color: 'var(--text-muted)' }}>Hedefler ({req.targets.length})</div>
          <div className="flex flex-wrap gap-1.5">
            {req.targets.map((t) => (
              <span key={t} className="px-2 py-0.5 rounded-md text-[11px] border"
                style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-elevated)', color: 'var(--text-secondary)' }}>{t}</span>
            ))}
          </div>
        </div>
      </div>
    </Modal>
  );
}

/** Log penceresi. Salt okunur; `-f` (follow) yok — iş asılı kalmasın. */
export function LogModal({ tenantKey, tenantLabel, targets, onClose }: {
  tenantKey: string; tenantLabel: string; targets: string[]; onClose: () => void;
}) {
  const { run, busy } = useOps(tenantKey);
  const [tail, setTail] = useState(200);
  const [previous, setPrevious] = useState(false);
  const [container, setContainer] = useState('');
  const [res, setRes] = useState<CryptoOpsResult | null>(null);

  const getir = useCallback(async () => {
    const r = await run({ action: 'logs', targets, tail, previous, container: container || undefined });
    if (r) setRes(r);
  }, [run, targets, tail, previous, container]);

  useEffect(() => { void getir(); /* ilk acilista otomatik getir */ }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const metin = (res?.logs || []).map((l) => (targets.length > 1 ? `[${l.target}] ${l.line}` : l.line)).join('\n');

  return (
    <Modal
      open
      onClose={onClose}
      size="wide"
      title="Pod logu"
      subtitle={`${tenantLabel} · ${targets.join(', ')}`}
      footer={(
        <div className="flex items-center gap-2 w-full flex-wrap">
          <label className="text-[11px] inline-flex items-center gap-1" style={{ color: 'var(--text-secondary)' }}>
            satır
            <select value={tail} onChange={(e) => setTail(Number(e.target.value))}
              className="h-7 text-[12px] rounded-lg border px-1"
              style={{ borderColor: 'var(--border)', background: 'var(--bg-surface)', color: 'var(--text-primary)' }}>
              {[100, 200, 500, 2000, 5000].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
          <label className="text-[11px] inline-flex items-center gap-1" style={{ color: 'var(--text-secondary)' }}>
            <input type="checkbox" checked={previous} onChange={(e) => setPrevious(e.target.checked)} />
            önceki koşu (--previous)
          </label>
          <input value={container} onChange={(e) => setContainer(e.target.value)} placeholder="kap adı (isteğe bağlı)"
            className="h-7 text-[12px] rounded-lg border px-2 w-44"
            style={{ borderColor: 'var(--border)', background: 'var(--bg-surface)', color: 'var(--text-primary)' }} />
          <button type="button" className={SM_BTN} style={btn('primary')} disabled={!!busy} onClick={getir}>
            <ArrowPathIcon className={`h-3.5 w-3.5 ${busy ? 'animate-spin' : ''}`} /> {busy ? 'getiriliyor…' : 'Yeniden getir'}
          </button>
          {metin && <CopyBtn text={metin} />}
          <span className="flex-1" />
          <button type="button" className="h-8 px-3 text-xs rounded-lg border" style={btn()} onClick={onClose}>Kapat</button>
        </div>
      )}
    >
      <div className="space-y-2">
        {(res?.errors || []).map((e, i) => (
          <div key={i} className="text-[12px] rounded-lg px-3 py-2 border flex items-start gap-2"
            style={{ color: 'var(--status-danger)', background: 'var(--status-danger-bg)', borderColor: 'var(--status-danger)' }}>
            <ExclamationTriangleIcon className="h-4 w-4 mt-0.5 shrink-0" />
            <span><b>{e.stage}</b> — {e.message}</span>
          </div>
        ))}
        {busy && !res && <div className="text-sm py-6 text-center" style={{ color: 'var(--text-muted)' }}>Log getiriliyor… (AWX işi birkaç saniye sürebilir)</div>}
        {res && metin.length === 0 && (res.errors || []).length === 0 && (
          <div className="text-sm py-6 text-center" style={{ color: 'var(--text-muted)' }}>
            Log boş döndü. Bu, hata olmadığı anlamına gelir; kap hiç satır yazmamış olabilir.
          </div>
        )}
        {metin && (
          <pre className="text-[11.5px] leading-relaxed rounded-lg px-3 py-2.5 overflow-auto"
            style={{ background: 'var(--bg-elevated)', color: 'var(--text-primary)', maxHeight: '58vh', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>{metin}</pre>
        )}
      </div>
    </Modal>
  );
}

/** Podlar sekmesi: liste + seçime göre log ve silme. */
export function PodsTab({ tenantKey, tenantLabel, namespace }: { tenantKey: string; tenantLabel: string; namespace: string }) {
  const { run, busy } = useOps(tenantKey);
  const [pods, setPods] = useState<CryptoPod[] | null>(null);
  const [errors, setErrors] = useState<CryptoOpsResult['errors']>([]);
  const [sec, setSec] = useState<string[]>([]);
  const [logFor, setLogFor] = useState<string[] | null>(null);
  const [onay, setOnay] = useState<OpsRequest | null>(null);
  const [sonuc, setSonuc] = useState<CryptoOpsResult['results']>([]);

  const listele = useCallback(async () => {
    const r = await run({ action: 'pods', targets: [] });
    if (r) { setPods(r.pods); setErrors(r.errors); setSec([]); }
  }, [run]);

  useEffect(() => { void listele(); }, [tenantKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = (name: string) => setSec((s) => (s.includes(name) ? s.filter((x) => x !== name) : [...s, name]));

  const sil = async () => {
    if (!onay) return;
    const r = await run(onay);
    setOnay(null);
    if (r) {
      setSonuc(r.results);
      const bas = r.results.filter((x) => x.ok).length;
      toast.success(`${bas}/${r.results.length} pod silindi. OpenShift yerine yenisini açar.`);
      setTimeout(() => { void listele(); }, 4000);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={SM_BTN} style={btn()} disabled={!!busy} onClick={listele}>
          <ArrowPathIcon className={`h-3.5 w-3.5 ${busy === 'pods' ? 'animate-spin' : ''}`} /> Listeyi yenile
        </button>
        <button type="button" className={SM_BTN} style={btn('primary')} disabled={sec.length === 0 || !!busy}
          onClick={() => setLogFor(sec)}>
          <DocumentTextIcon className="h-3.5 w-3.5" /> Log göster ({sec.length})
        </button>
        <button type="button" className={SM_BTN} style={btn('danger')} disabled={sec.length === 0 || !!busy}
          onClick={() => setOnay({ action: 'pod_delete', targets: sec })}>
          <TrashIcon className="h-3.5 w-3.5" /> Seçilenleri sil ({sec.length})
        </button>
        <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
          silme, pod'u yeniden başlatır: OpenShift yerine yenisini açar
        </span>
      </div>

      {errors.map((e, i) => (
        <div key={i} className="text-[12px] rounded-lg px-3 py-2 border flex items-start gap-2"
          style={{ color: 'var(--status-danger)', background: 'var(--status-danger-bg)', borderColor: 'var(--status-danger)' }}>
          <ExclamationTriangleIcon className="h-4 w-4 mt-0.5 shrink-0" />
          <span><b>{e.stage}</b> — {e.message}</span>
        </div>
      ))}

      {sonuc.length > 0 && (
        <ul className="space-y-1">
          {sonuc.map((r, i) => (
            <li key={i} className="text-[12px] flex items-center gap-2" style={{ color: r.ok ? 'var(--status-success)' : 'var(--status-danger)' }}>
              {r.ok ? <CheckCircleIcon className="h-4 w-4" /> : <XCircleIcon className="h-4 w-4" />}
              <b>{r.target}</b> — {r.message}
            </li>
          ))}
        </ul>
      )}

      <div className="rounded-xl border overflow-hidden" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-surface)' }}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[11px] uppercase tracking-wide" style={{ color: 'var(--text-muted)', background: 'var(--bg-elevated)' }}>
                <th className="px-3 py-2 w-8">
                  <input
                    type="checkbox"
                    checked={!!pods && pods.length > 0 && sec.length === pods.length}
                    onChange={(e) => setSec(e.target.checked ? (pods || []).map((p) => p.name) : [])}
                  />
                </th>
                <th className="text-left font-medium px-3 py-2">Pod</th>
                <th className="text-left font-medium px-3 py-2">Durum</th>
                <th className="text-left font-medium px-3 py-2">Hazır</th>
                <th className="text-right font-medium px-3 py-2">Restart</th>
                <th className="text-left font-medium px-3 py-2">Başlangıç</th>
                <th className="text-left font-medium px-3 py-2">Node</th>
                <th className="text-left font-medium px-3 py-2"> </th>
              </tr>
            </thead>
            <tbody>
              {pods === null && (
                <TableEmptyRow colSpan={8} title="Pod listesi getiriliyor" description="AWX işi birkaç saniye sürebilir." />
              )}
              {pods !== null && pods.length === 0 && (
                <TableEmptyRow colSpan={8} title="Pod bulunamadı" description={`${namespace} namespace'inde pod yok ya da listeleme yetkisi verilmemiş (yukarıdaki hata satırlarına bakın).`} />
              )}
              {(pods || []).map((p) => (
                <tr key={p.name} className="border-t" style={{ borderColor: 'var(--border-subtle)' }}>
                  <td className="px-3 py-2"><input type="checkbox" checked={sec.includes(p.name)} onChange={() => toggle(p.name)} /></td>
                  <td className="px-3 py-2 font-medium break-all" style={{ color: 'var(--text-primary)' }}>{p.name}</td>
                  <td className="px-3 py-2">
                    <span className="text-[11px] font-medium" style={{ color: p.phase === 'Running' ? 'var(--status-success)' : p.phase === 'Succeeded' ? 'var(--text-muted)' : 'var(--status-warning)' }}>{p.phase}</span>
                  </td>
                  <td className="px-3 py-2 text-[11px]" style={{ color: p.ready ? 'var(--status-success)' : 'var(--status-warning)' }}>
                    {p.ready ? 'hazır' : 'hazır değil'} <span style={{ color: 'var(--text-muted)' }}>({p.containers} kap)</span>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums" style={{ color: p.restarts > 0 ? 'var(--status-warning)' : 'var(--text-secondary)' }}>{p.restarts}</td>
                  <td className="px-3 py-2 text-[11px]" style={{ color: 'var(--text-muted)' }}>{p.startedAt?.replace('T', ' ').replace('Z', '') || '—'}</td>
                  <td className="px-3 py-2 text-[11px]" style={{ color: 'var(--text-muted)' }}>{p.node || '—'}</td>
                  <td className="px-3 py-2">
                    <button type="button" className={SM_BTN} style={btn()} disabled={!!busy} onClick={() => setLogFor([p.name])}>
                      <DocumentTextIcon className="h-3.5 w-3.5" /> Log
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {logFor && <LogModal tenantKey={tenantKey} tenantLabel={tenantLabel} targets={logFor} onClose={() => setLogFor(null)} />}
      {onay && (
        <OpsConfirm req={onay} namespace={namespace} tenantLabel={tenantLabel} onCancel={() => setOnay(null)} onConfirm={sil} />
      )}
    </div>
  );
}

/** Durum tablosundaki satır işlemleri: rollout restart ve replika. */
export function ComponentOps({ tenantKey, tenantLabel, namespace, kind, name, want, onDone }: {
  tenantKey: string; tenantLabel: string; namespace: string;
  kind: string; name: string; want: number | null; onDone: () => void;
}) {
  const { run, busy } = useOps(tenantKey);
  const [onay, setOnay] = useState<OpsRequest | null>(null);
  const [replika, setReplika] = useState(false);
  const [sayi, setSayi] = useState(String(want ?? 1));
  const hedef = `${String(kind).toLowerCase().startsWith('stateful') ? 'statefulset' : 'deployment'}/${name}`;

  const calistir = async () => {
    if (!onay) return;
    const r = await run(onay);
    setOnay(null);
    setReplika(false);
    if (r) {
      const bas = r.results.filter((x) => x.ok).length;
      if (bas === r.results.length && r.results.length > 0) toast.success(`${hedef}: tamam.`);
      else toast.error(r.results.map((x) => `${x.target}: ${x.message}`).join(' · ') || 'Sonuç boş döndü.');
      onDone();
    }
  };

  return (
    <div className="inline-flex items-center gap-1">
      <button type="button" className={SM_BTN} style={btn()} disabled={!!busy}
        title="Rollout restart: podlar sırayla yenilenir"
        onClick={() => setOnay({ action: 'rollout', targets: [hedef] })}>
        <ArrowPathRoundedSquareIcon className="h-3.5 w-3.5" /> Rollout
      </button>
      <button type="button" className={SM_BTN} style={btn()} disabled={!!busy}
        title="Replika sayısını değiştir"
        onClick={() => setReplika(true)}>
        <AdjustmentsHorizontalIcon className="h-3.5 w-3.5" /> Replika
      </button>

      {replika && (
        <Modal open onClose={() => setReplika(false)} size="sm" title="Replika sayısı" subtitle={hedef}
          footer={(
            <div className="flex items-center gap-2 w-full">
              <button type="button" className="h-9 px-4 text-sm font-medium rounded-lg border" style={btn('primary')}
                disabled={!/^\d+$/.test(sayi) || Number(sayi) > 50}
                onClick={() => setOnay({ action: 'scale', targets: [hedef], replicas: Number(sayi) })}>
                Devam
              </button>
              <span className="flex-1" />
              <button type="button" className="h-9 px-3 text-xs rounded-lg border" style={btn()} onClick={() => setReplika(false)}>Vazgeç</button>
            </div>
          )}>
          <div className="space-y-2">
            <div className="text-sm" style={{ color: 'var(--text-secondary)' }}>
              Şu anki istenen replika: <b>{want ?? '—'}</b>
            </div>
            <input value={sayi} onChange={(e) => setSayi(e.target.value.replace(/[^0-9]/g, ''))}
              className="h-9 px-3 text-sm rounded-lg border w-28 tabular-nums"
              style={{ borderColor: 'var(--border)', background: 'var(--bg-surface)', color: 'var(--text-primary)' }} />
            <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
              0–50 arası. <b>0</b> girmek bileşeni kapatır. Bir sonraki adımda koşacak komutu göreceksiniz.
            </div>
          </div>
        </Modal>
      )}

      {onay && (
        <OpsConfirm req={onay} namespace={namespace} tenantLabel={tenantLabel} onCancel={() => setOnay(null)} onConfirm={calistir} />
      )}
    </div>
  );
}
