// src/components/server_hub/RetirementCanli.tsx — Retirement: suren islerin CANLI gorunumu (2026-10-09).
//
// Kullanici: "isin halihazirda calisip calismadigini daha guzel, daha interaktif gosterelim."
// Kayit penceresinde is surerken gorunur: hedef basina JBoss isi (on kontrol / STOP / silme / geri
// alma) ve vhost isleri - her biri durum cipi, donen gosterge ve gecen sure ile. Veri, pencerenin
// birkac saniyede bir cagirdigi /canli ucundan gelir (o uc bekleyen vhost islerini de baslatir).
import React, { useEffect, useState } from 'react';
import type { RtTarget, RtWeb2 } from '@/api/retirementApi';

export const GECIS = new Set(['planning', 'stopping', 'deleting', 'rolling_back']);
const IS_ADI: Record<string, string> = { planning: 'Ön kontrol', stopping: 'JBoss STOP', deleting: 'Silme', rolling_back: 'Geri alma' };

/** Bu hedefte izlenecek bir sey var mi (gecis durumu ya da bekleyen/suren vhost isi)? */
export function hedefAktif(t: RtTarget): boolean {
  return GECIS.has(t.status) || (t.webSonuc || []).some((w) => w.status === 'pending' || w.status === 'running');
}

function sure(bas?: string | null, bit?: string | null, simdi = Date.now()): string {
  if (!bas) return '';
  const ms = Math.max(0, (bit ? new Date(bit).getTime() : simdi) - new Date(bas).getTime());
  const s = Math.floor(ms / 1000);
  return s < 60 ? `${s} sn` : `${Math.floor(s / 60)} dk ${String(s % 60).padStart(2, '0')} sn`;
}

function Doner() {
  return <span aria-hidden className="inline-block w-3 h-3 rounded-full border-2 animate-spin motion-reduce:animate-none" style={{ borderColor: 'var(--status-info)', borderTopColor: 'transparent' }} />;
}

const WEB_DURUM: Record<string, { etiket: string; renk: string }> = {
  pending: { etiket: 'sırada', renk: 'var(--text-muted)' },
  running: { etiket: 'çalışıyor', renk: 'var(--status-info)' },
  ok: { etiket: 'kaldırıldı', renk: 'var(--status-success)' },
  skip: { etiket: 'yapılacak şey yoktu', renk: 'var(--text-muted)' },
  failed: { etiket: 'BAŞARISIZ', renk: 'var(--status-danger)' },
  manual: { etiket: 'elle yapılmalı', renk: 'var(--status-warning)' },
};

function WebCip({ w, simdi }: { w: RtWeb2; simdi: number }) {
  const d = WEB_DURUM[w.status] || { etiket: w.status, renk: 'var(--text-muted)' };
  return (
    <div className="flex items-center gap-2 rounded-md border px-2 py-1 text-[11px]" style={{ borderColor: 'var(--border-subtle)' }} title={w.message || undefined}>
      {w.status === 'running' ? <Doner /> : <span className="w-2 h-2 rounded-full" style={{ background: d.renk }} />}
      <span className="font-mono">{w.host} · {w.serverName}</span>
      <span className="font-semibold" style={{ color: d.renk }}>{d.etiket}</span>
      {w.jobId ? <span style={{ color: 'var(--text-muted)' }}>iş #{w.jobId}</span> : null}
      {w.basladi && <span style={{ color: 'var(--text-muted)' }}>{w.status === 'running' ? sure(w.basladi, null, simdi) : w.bitti ? `${sure(w.basladi, w.bitti)} sürdü` : ''}</span>}
    </div>
  );
}

export default function RetirementCanli({ targets }: { targets: RtTarget[] }) {
  const izlenen = targets.filter((t) => hedefAktif(t) || (t.status === 'failed' && (t.webSonuc || []).some((w) => w.status === 'ok')));
  const [simdi, setSimdi] = useState(() => Date.now());
  const aktif = izlenen.some(hedefAktif);
  useEffect(() => {
    if (!aktif) return;
    const z = window.setInterval(() => setSimdi(Date.now()), 1000);
    return () => window.clearInterval(z);
  }, [aktif]);
  if (!izlenen.length) return null;
  return (
    <div className="rounded-lg border p-3 space-y-2" style={{ borderColor: 'var(--status-info)', background: 'var(--status-info-bg)' }} aria-live="polite">
      <div className="flex items-center gap-2 text-[12px] font-semibold">
        {aktif && <Doner />} {aktif ? 'Çalışan işler' : 'İşler bitti'}
        <span className="font-normal text-[11px]" style={{ color: 'var(--text-muted)' }}>— birkaç saniyede bir kendiliğinden tazelenir</span>
      </div>
      {izlenen.map((t) => {
        const web = t.webSonuc || [];
        const gecis = GECIS.has(t.status);
        const yarim = t.status === 'failed' && web.some((w) => w.status === 'ok');
        return (
          <div key={t.id} className="rounded-md px-2.5 py-2 space-y-1.5" style={{ background: 'var(--bg-surface)' }}>
            <div className="flex flex-wrap items-center gap-2 text-[12px]">
              <span className="font-mono font-semibold">{t.host}</span>
              <span style={{ color: 'var(--text-muted)' }}>{t.appName}</span>
              {gecis ? (
                <span className="inline-flex items-center gap-1.5" style={{ color: 'var(--status-info)' }}>
                  <Doner /> <b>{IS_ADI[t.status]}</b> çalışıyor{t.lastJobId && t.status !== 'deleting' && t.status !== 'rolling_back' ? ` · iş #${t.lastJobId}` : ''} · {sure(t.updatedAt, null, simdi)}
                </span>
              ) : (
                <span style={{ color: t.status === 'failed' ? 'var(--status-danger)' : 'var(--status-success)' }}>JBoss: {t.status === 'stopped' ? 'durduruldu' : t.status === 'failed' ? 'BAŞARISIZ' : t.status}</span>
              )}
            </div>
            {yarim && (
              <div role="alert" className="text-[11px] font-semibold" style={{ color: 'var(--status-danger)' }}>
                JBoss STOP başarısız ama vhost kaldırıldı — uygulama çalışıyor olabilir, önüne trafik gelmez. Vhost'u geri açmak ya da STOP'u yeniden denemek gerekir.
              </div>
            )}
            {web.length > 0 && <div className="flex flex-wrap gap-1.5">{web.map((w, i) => <WebCip key={i} w={w} simdi={simdi} />)}</div>}
          </div>
        );
      })}
    </div>
  );
}
