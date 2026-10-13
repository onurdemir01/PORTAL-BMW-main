// src/components/server_hub/RetirementCanli.tsx — Retirement: suren islerin CANLI gorunumu (2026-10-09).
//
// Kullanici: "isin halihazirda calisip calismadigini daha guzel, daha interaktif gosterelim."
// Kayit penceresinde is surerken gorunur: hedef basina JBoss isi (on kontrol / STOP / silme / geri
// alma) ve vhost isleri - her biri durum cipi, donen gosterge ve gecen sure ile. Veri, pencerenin
// birkac saniyede bir cagirdigi /canli ucundan gelir (o uc bekleyen vhost islerini de baslatir).
import React, { useEffect, useState } from 'react';
import type { RtIsler, RtTarget, RtWeb2, RtZamanlayici } from '@/api/retirementApi';

export const GECIS = new Set(['planning', 'stopping', 'deleting', 'rolling_back']);
const IS_ADI: Record<string, string> = { planning: 'Ön kontrol', stopping: 'JBoss STOP', deleting: 'Silme', rolling_back: 'Geri alma' };

export function gecisJobId(t: RtTarget): number | null {
  if (t.status === 'deleting') return t.deleteJobId;
  if (t.status === 'rolling_back') return t.rollbackJobId;
  return t.status === 'planning' || t.status === 'stopping' ? t.lastJobId : null;
}

export function gecisBelirsiz(t: RtTarget): boolean {
  return GECIS.has(t.status) && !gecisJobId(t);
}

/** SILME SIRADA (2026-10-12): beklemesi atlanmis (hedef basina ya da kayit duzeyinde) ve henuz
 *  zamanlayicinin almadigi durdurulmus hedef. Zamanlayici aldiginda 'deleting' olur. */
export function silmeSirada(t: RtTarget, kayitAtladi?: string | null): boolean {
  return t.status === 'stopped' && !t.deletedAt && !!(t.deleteNowAt || kayitAtladi);
}

/** Bu hedefte izlenecek bir sey var mi (gecis durumu, sirada bekleyen silme ya da bekleyen/suren vhost isi)? */
export function hedefAktif(t: RtTarget, kayitAtladi?: string | null): boolean {
  return (GECIS.has(t.status) && !gecisBelirsiz(t)) || silmeSirada(t, kayitAtladi) || (t.webSonuc || []).some((w) => w.status === 'pending' || w.status === 'running');
}

/** Spinner gercegiyle veri yenilemeyi ayir: claim sonrasi job ID yazimi kisa sure gecikebilir. */
export function hedefTazelenmeli(t: RtTarget, kayitAtladi?: string | null): boolean {
  return GECIS.has(t.status) || silmeSirada(t, kayitAtladi) || (t.webSonuc || []).some((w) => w.status === 'pending' || w.status === 'running');
}

// AWX is durumu -> ekran. Okunmamis (status yok) != calismiyor.
const AWX_KUYRUK = new Set(['new', 'pending', 'waiting']);
function awxEtiket(st?: string): { etiket: string; calisiyor: boolean } {
  if (!st) return { etiket: 'AWX durumu okunuyor…', calisiyor: false };
  if (AWX_KUYRUK.has(st)) return { etiket: 'AWX kuyruğunda bekliyor', calisiyor: false };
  if (st === 'running') return { etiket: 'AWX’te çalışıyor', calisiyor: true };
  return { etiket: `AWX: ${st}`, calisiyor: false };
}

function geriSayim(z: RtZamanlayici | undefined, simdi: number): { metin: string; oran: number } {
  if (!z) return { metin: 'zamanlayıcı bilgisi bekleniyor', oran: 0 };
  if (!z.calisiyor) return { metin: 'ZAMANLAYICI ÇALIŞMIYOR — Portal yeniden başlatılmalı', oran: 0 };
  if (z.turSuruyor) return { metin: 'zamanlayıcı turu şu an çalışıyor', oran: 1 };
  if (!z.sonrakiTurAt) return { metin: `en geç ~${Math.ceil(z.aralikSn / 60)} dk`, oran: 0 };
  const kalan = Math.round((new Date(z.sonrakiTurAt).getTime() - simdi) / 1000);
  const oran = Math.min(1, Math.max(0, 1 - kalan / z.aralikSn));
  if (kalan <= 0) return { metin: 'tur zamanı geldi — birkaç saniye içinde', oran: 1 };
  return { metin: `~${kalan < 60 ? `${kalan} sn` : `${Math.floor(kalan / 60)} dk ${String(kalan % 60).padStart(2, '0')} sn`} içinde`, oran };
}

// SILME ADIMLARI: Sırada -> AWX'e gönderildi -> Çalışıyor -> Silindi. Her adim tamam/su an/bekliyor.
type AdimDurum = 'tamam' | 'simdi' | 'bekliyor';
function Adimlar({ adimlar }: { adimlar: { ad: string; durum: AdimDurum; alt?: string }[] }) {
  return (
    <ol className="flex flex-wrap items-start gap-x-1 gap-y-1 text-[11px]" aria-label="Silme adımları">
      {adimlar.map((a, i) => (
        <li key={a.ad} className="flex items-center gap-1">
          {i > 0 && <span aria-hidden className="w-4 h-px" style={{ background: a.durum === 'bekliyor' ? 'var(--border-subtle)' : 'var(--status-info)' }} />}
          <span className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5" style={{
            borderColor: a.durum === 'bekliyor' ? 'var(--border-subtle)' : a.durum === 'tamam' ? 'var(--status-success)' : 'var(--status-info)',
            color: a.durum === 'bekliyor' ? 'var(--text-muted)' : a.durum === 'tamam' ? 'var(--status-success)' : 'var(--status-info)',
            fontWeight: a.durum === 'simdi' ? 600 : 400,
          }}>
            {a.durum === 'tamam' ? <span aria-hidden>✓</span> : a.durum === 'simdi' ? <span aria-hidden className="w-1.5 h-1.5 rounded-full animate-pulse motion-reduce:animate-none" style={{ background: 'var(--status-info)' }} /> : <span aria-hidden className="w-1.5 h-1.5 rounded-full" style={{ background: 'var(--border-subtle)' }} />}
            {a.ad}{a.alt ? <span className="font-normal" style={{ color: 'var(--text-muted)' }}> · {a.alt}</span> : null}
          </span>
        </li>
      ))}
    </ol>
  );
}

function KumSaati() {
  return (
    <span aria-hidden className="inline-flex w-3.5 h-3.5 items-center justify-center animate-pulse motion-reduce:animate-none" style={{ color: 'var(--status-warning)' }}>
      <svg viewBox="0 0 16 16" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M4 1.5h8M4 14.5h8M5 1.5c0 3.5 6 3.5 6 6.5s-6 3-6 6.5M11 1.5c0 3.5-6 3.5-6 6.5s6 3 6 6.5" /></svg>
    </span>
  );
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

export default function RetirementCanli({ targets, kayitAtladi, zamanlayici, isler }: { targets: RtTarget[]; kayitAtladi?: string | null; zamanlayici?: RtZamanlayici; isler?: RtIsler }) {
  const izlenen = targets.filter((t) => hedefAktif(t, kayitAtladi) || gecisBelirsiz(t) || (t.status === 'failed' && (t.webSonuc || []).some((w) => w.status === 'ok')));
  const [simdi, setSimdi] = useState(() => Date.now());
  const aktif = izlenen.some((t) => hedefAktif(t, kayitAtladi));
  useEffect(() => {
    if (!aktif) return;
    const z = window.setInterval(() => setSimdi(Date.now()), 1000);
    return () => window.clearInterval(z);
  }, [aktif]);
  if (!izlenen.length) return null;
  const belirsizVar = izlenen.some(gecisBelirsiz);
  return (
    <div className="rounded-lg border p-3 space-y-2" style={{ borderColor: 'var(--status-info)', background: 'var(--status-info-bg)' }} aria-live="polite">
      <div className="flex items-center gap-2 text-[12px] font-semibold">
        {aktif && <Doner />} {aktif ? (belirsizVar ? 'Çalışan, sıradaki ve doğrulanamayan işler' : 'Çalışan ve sıradaki işler') : belirsizVar ? 'Doğrulanamayan işler' : 'İşler bitti'}
        <span className="font-normal text-[11px]" style={{ color: 'var(--text-muted)' }}>— birkaç saniyede bir kendiliğinden tazelenir{belirsizVar ? '; belirsiz işler operatör uzlaştırması gerektirir' : ''}</span>
      </div>
      {izlenen.map((t) => {
        const web = t.webSonuc || [];
        const gecis = GECIS.has(t.status);
        const belirsiz = gecisBelirsiz(t);
        const sirada = silmeSirada(t, kayitAtladi);
        const yarim = t.status === 'failed' && web.some((w) => w.status === 'ok');
        const is = isler?.[t.id];
        const jobId = gecisJobId(t);
        const awx = awxEtiket(is?.status);
        const gs = geriSayim(zamanlayici, simdi);
        return (
          <div key={t.id} className="rounded-md px-2.5 py-2 space-y-1.5" style={{ background: 'var(--bg-surface)' }}>
            <div className="flex flex-wrap items-center gap-2 text-[12px]">
              <span className="font-mono font-semibold">{t.host}</span>
              <span style={{ color: 'var(--text-muted)' }}>{t.appName}</span>
              {sirada ? (
                <span className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 font-semibold" style={{ color: 'var(--status-warning)', background: 'var(--status-warning-bg)' }}>
                  <KumSaati /> SİLME SIRADA
                </span>
              ) : gecis && !belirsiz ? (
                <span className="inline-flex items-center gap-1.5" style={{ color: 'var(--status-info)' }}>
                  {awx.calisiyor ? <Doner /> : <KumSaati />} <b>{IS_ADI[t.status]}</b>
                  <> · iş #{is?.jobId ?? jobId} · <b>{awx.etiket}</b></>
                  {' '}· {sure(t.updatedAt, null, simdi)}
                </span>
              ) : (
                <span style={{ color: t.status === 'failed' ? 'var(--status-danger)' : 'var(--status-success)' }}>JBoss: {t.status === 'stopped' ? 'durduruldu' : t.status === 'failed' ? 'BAŞARISIZ' : t.status}</span>
              )}
            </div>
            {belirsiz && (
              <div role="alert" className="text-[11px] font-semibold" style={{ color: 'var(--status-warning)' }}>
                {IS_ADI[t.status]} claim’i var fakat iş numarası yazılamadı; AWX başlangıç sonucu doğrulanamıyor. Aynı dış işlem otomatik yeniden başlatılmaz; operatör AWX geçmişiyle uzlaştırmalıdır.
              </div>
            )}
            {sirada && (
              <div className="space-y-1">
                <Adimlar adimlar={[
                  { ad: 'Sırada', durum: 'simdi', alt: t.deleteNowAt ? 'bu sunucu için bekleme atlandı' : 'kayıtta bekleme atlandı' },
                  { ad: 'AWX’e gönderildi', durum: 'bekliyor' },
                  { ad: 'Çalışıyor', durum: 'bekliyor' },
                  { ad: 'Silindi', durum: 'bekliyor' },
                ]} />
                <div className="text-[11px]" style={{ color: zamanlayici && !zamanlayici.calisiyor ? 'var(--status-danger)' : 'var(--text-secondary)' }}>
                  Zamanlayıcının sonraki turunda başlar: <b>{gs.metin}</b>
                  {zamanlayici?.calisiyor ? <span style={{ color: 'var(--text-muted)' }}> (tur her {Math.round(zamanlayici.aralikSn / 60)} dk’da bir; ortalama bekleme ~{Math.round(zamanlayici.aralikSn / 120)} dk)</span> : null}
                </div>
                {zamanlayici?.calisiyor && (
                  <div className="h-1 rounded-full overflow-hidden" style={{ background: 'var(--border-subtle)' }} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(gs.oran * 100)} aria-label="Sonraki tura kalan süre">
                    <div className="h-full rounded-full transition-[width] duration-1000 ease-linear motion-reduce:transition-none" style={{ width: `${Math.round(gs.oran * 100)}%`, background: 'var(--status-warning)' }} />
                  </div>
                )}
              </div>
            )}
            {t.status === 'deleting' && !belirsiz && (
              <Adimlar adimlar={[
                { ad: 'Sırada', durum: 'tamam' },
                { ad: 'AWX’e gönderildi', durum: 'tamam', alt: `iş #${is?.jobId ?? jobId}` },
                { ad: 'Çalışıyor', durum: awx.calisiyor ? 'simdi' : 'bekliyor', alt: is && !awx.calisiyor ? awx.etiket : undefined },
                { ad: 'Silindi', durum: 'bekliyor' },
              ]} />
            )}
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
