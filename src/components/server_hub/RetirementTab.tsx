// src/components/server_hub/RetirementTab.tsx — Uygulama Retirement (2026-09-21): kayit + kesif + STOP.
//
// Ekibin elle sureci Portal'da: Smart silme kaydi no + (prod) OCO ile kayit acilir; uygulamanin TUM
// sunuculari (tum ortamlar, Pendik + Ankara) envanterden kesfedilir, web sunuculari Web-App kuraliyla;
// her hedef icin STOP once PLAN kosar, onaylaninca uygulanir. Silme tarihi: kaydi acan secer, bos ise
// stop + N gun (varsayilan 45). Silme ve IP/LB/DNS adimlari sonraki surum (kayitta alanlari var).
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PlusIcon, ArrowPathIcon, XMarkIcon, StopCircleIcon, ClipboardDocumentCheckIcon, TrashIcon, ArrowUturnLeftIcon, CommandLineIcon, InformationCircleIcon, ChevronDownIcon } from '@heroicons/react/24/outline';
import { retirementApi, type SccKaynak, type RtRecordRow, type RtRecord, type RtDiscovery, type RtDiscoveredTarget, type RtTarget, type RtTargetStatus, type RtLaunch, type RtWeb, type RtWeb2, type RtZamanlayici, type RtIsler } from '@/api/retirementApi';
import { useJobTracker } from '@/contexts/JobTrackerContext';
import { Modal } from '@/components/common/Modal';
import { TableEmptyRow } from '@/components/common/EmptyState';
import { fmtDate, fmtDateTime, fmtNumber } from '@/utils/datetime';
import { useAsyncEffect } from '@/hooks/useAsyncEffect';
import { kalanGun } from './RetirementAkis';
import RetirementDnsIp from './RetirementDnsIp';
import RetirementCanli, { GECIS, hedefTazelenmeli, orphanUzlastirilabilir } from './RetirementCanli';
import { BOS_FILTRE, kayitFiltrele, type KayitFiltre } from './retirementFiltre';
import { retirementAdimi } from './retirementAdim';
import OnKontrolListesi, { onKontrolHazir, OnKontrolGorunumu, geriAlHazir, geriAlinabilir, onKontrolSuruyor } from './RetirementOnKontrol';
import { stopTrafikOzeti, stopOnayAcikMi, type TrafikIsDurumu } from './retirementTrafik';
import { WebKaynak, WebVhostListesi, webKey } from './RetirementWebSatir';
import { ACIK_ZEMIN, BTN_BASARI, BTN_BASARI_IKINCIL, BTN_TEHLIKE, BTN_UYARI, LINK, SECILI_ZEMIN, SM_BTN, TBL_BTN, TON, WEB_DURUM, smBtn, type Ton } from './retirementStil';
import { Cip, Hap, OzetHucre, Sayac, SonucMetni, TabloIskelet, UyariKutusu, type Kolon } from './RetirementUi';
import { InPlaceUyari, inPlaceAsamasi, inPlaceBilgisi, inPlaceHaritasi, inPlaceIpucu, inPlaceSatirNotu, type InPlaceHarita } from './RetirementInPlace';
import { gecisAdimi, hedefteCanliIs, sonrakiAdim, webSonuclari } from './retirementSatir';
import RetirementHedefAyrinti, { type AyrintiSekme } from './RetirementHedefAyrinti';
import type { CiktiOnbellegi } from './RetirementIsCiktisi';
import type { IsIpucu } from './retirementCikti';
import { blokAyristir, bloklaraBol, degisimTuru, jkAyristir, jkDegAyristir, JK_ETIKET, kipAyristir, sonraMetni, sonucAyristir, YORUM_ONEKI, type BlokSatiri, type DegisimTuru, type JkDeg, type JkSatiri, type Kip } from './retirementVhostPlan';

/** On kontrolde vhost basina kapatma plani (ekran durumu). */
interface VhostPlanDurumu {
  host: string; serverName: string; confFile: string;
  durum: 'suruyor' | 'hazir' | 'hata' | 'elle';
  mesaj?: string; satirlar?: BlokSatiri[]; jk?: JkSatiri[]; jkdeg?: JkDeg[]; kip?: { kip: Kip; hedef?: string }; jobId?: number | null;
}

/** STOP onayinda KAPATILACAK VirtualHost bloklari (2026-10-08, kullanici: "tetiklemeden once
 *  disabled edilecek virtualhost blogunu gormek istiyorum"). Bloklar web adimiyla AYNI
 *  betikten (apache_retire_vhost plan) gelir. Plan basarisizsa (blok bulunamadi vb.) KIRMIZI:
 *  web adimi da ayni sebeple dusecek - JBoss STOP'u engellemez ama gorunur. */
/** Bloga bagli mod_jk satirlari (tespit). Temizlik JkOnceSonra'da; PAYLASILAN varsa yapilmaz. Alan hic gelmediyse
 *  (eski server_hub_fix) acikca soylenir - bos liste "bagli satir yok" diye okunmasin. */
// Renkler: SONRA sutununda yesil = eklenen / geri acilan satir, sari = yorum satirina alinan, kirmizi = kalkan.
const DEG_RENK: Record<DegisimTuru, { renk?: string; zemin?: string; etiket: string }> = {
  eklenen: { renk: 'var(--status-success)', zemin: 'var(--status-success-bg, transparent)', etiket: 'eklenecek' },
  acilan: { renk: 'var(--status-success)', zemin: 'var(--status-success-bg, transparent)', etiket: 'geri açılacak' },
  yorumlanan: { renk: 'var(--status-warning-text)', zemin: 'var(--status-warning-bg, transparent)', etiket: 'yorum satırına alınacak' },
  kalkan: { renk: 'var(--status-danger-text)', etiket: 'kalkacak' },
  ayni: { etiket: 'değişmiyor' },
};
function RenkAciklama() {
  const kutu = (t: DegisimTuru) => (
    <span className="inline-flex items-center gap-1"><span className="inline-block w-3 h-3 rounded-sm border" style={{ background: DEG_RENK[t].zemin || 'transparent', borderColor: DEG_RENK[t].renk || 'var(--border)' }} />{DEG_RENK[t].etiket}</span>
  );
  return <div className="flex flex-wrap gap-3 text-[11px]" style={{ color: 'var(--text-secondary)' }}>{kutu('eklenen')}{kutu('yorumlanan')}{kutu('kalkan')}</div>;
}

/** mod_jk satirlari ONCE / SONRA (onayda vhost ile AYNI koşuda uygulanir). */
function JkOnceSonra({ deg }: { deg?: JkDeg[] }) {
  if (!deg || !deg.length) return null;
  const dosyalar = [...new Set(deg.map((d) => d.dosya))];
  const satir = (no: number, metin: string, renk?: string, zemin?: string) => (
    <div className="flex font-mono text-[11px] leading-5" style={{ background: zemin }}>
      <span className="shrink-0 w-14 pr-2 text-right select-none" style={{ color: 'var(--text-muted)' }}>{no || ''}</span>
      <span className="whitespace-pre pr-3" style={{ color: renk || 'var(--text-primary)' }}>{metin}</span>
    </div>
  );
  return (
    <div className="space-y-2">
      <div className="font-semibold" style={{ color: 'var(--text-muted)' }}>mod_jk satırları — onayda vhost ile birlikte değişir</div>
      {dosyalar.map((f) => {
        const l = deg.filter((d) => d.dosya === f);
        return (
          <div key={f} className="space-y-1">
            <div className="font-mono" style={{ color: 'var(--text-secondary)' }}>{f}</div>
            <div className="grid gap-2 md:grid-cols-2">
              <div className="rounded-lg border overflow-auto max-h-[40vh]" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-elevated)' }}>
                <div className="sticky top-0 px-2 py-1 text-[11px] font-semibold border-b" style={{ background: 'var(--bg-elevated)', borderColor: 'var(--border-subtle)' }}>ÖNCE</div>
                {l.map((d, i) => <div key={i}>{d.once ? satir(d.no, d.once) : satir(0, '', undefined, undefined)}</div>)}
              </div>
              <div className="rounded-lg border overflow-auto max-h-[40vh]" style={{ borderColor: 'var(--status-warning)', background: 'var(--bg-elevated)' }}>
                <div className="sticky top-0 px-2 py-1 text-[11px] font-semibold border-b" style={{ background: 'var(--bg-elevated)', borderColor: 'var(--border-subtle)' }}>SONRA</div>
                {l.map((d, i) => {
                  const r = DEG_RENK[degisimTuru(d.once, d.sonra)];
                  return <div key={i} title={r.etiket}>{d.sonra ? satir(d.once ? d.no : 0, d.sonra, r.renk, r.zemin) : satir(d.no, '(satır kalkar)', r.renk)}</div>;
                })}
              </div>
            </div>
          </div>
        );
      })}
      <div style={{ color: 'var(--text-muted)' }}><span className="font-mono">worker.list</span> yorumlanmaz: eski hali üstte yorum olarak kalır, aktif satırdan yalnız bu uygulamanın adı çıkar. “Geri aktif et” hepsini geri açar.</div>
    </div>
  );
}

function JkBaglantilari({ jk }: { jk?: JkSatiri[] }) {
  if (!jk || !jk.length) return <div style={{ color: 'var(--text-muted)' }}>mod_jk bağlantıları okunmadı (eski server_hub_fix sürümü).</div>;
  const notlar = jk.filter((j) => j.tur === 'NOT');
  const satirlar = jk.filter((j) => j.tur !== 'NOT');
  const renk = (t: JkSatiri['tur']) => (t === 'GLOBAL' || t === 'OKUNAMADI' ? 'var(--status-warning-text)' : t === 'PAYLASILAN' ? 'var(--status-danger-text)' : 'var(--text-secondary)');
  return (
    <div className="space-y-1">
      <div className="font-semibold" style={{ color: 'var(--text-muted)' }}>Bağlı mod_jk satırları (tespit) — PAYLASILAN varsa mod_jk'ya dokunulmaz</div>
      {notlar.map((n, i) => <div key={`n${i}`} style={{ color: 'var(--text-muted)' }}>{n.metin}</div>)}
      {satirlar.length === 0 ? <div style={{ color: 'var(--text-muted)' }}>Blok dışında bu worker'lara bağlı satır bulunmadı.</div> : (
        <div className="overflow-auto max-h-56 rounded px-2 py-1.5 text-[10px] leading-snug" style={{ background: 'var(--bg-elevated)' }}>
          {satirlar.map((j, i) => (
            <div key={i} className="flex gap-2">
              <span className="shrink-0 font-semibold" style={{ color: renk(j.tur) }} title={JK_ETIKET[j.tur]}>{j.tur}</span>
              <span className="shrink-0 font-mono" style={{ color: 'var(--text-muted)' }}>{(j.dosya.split('/').pop() || '')}:{j.no || ''}</span>
              <span className="font-mono break-all" style={{ color: 'var(--text-primary)' }}>{j.metin}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function OnceSonra({ v }: { v: VhostPlanDurumu }) {
  const satirlar = v.satirlar || [];
  const { kip, hedef } = v.kip || { kip: 'bilinmiyor' as Kip };
  if (!satirlar.length) return <div style={{ color: 'var(--status-warning-text)' }}>Plan blok satırı döndürmedi (eski server_hub_fix sürümü?) — kapatılacak blok gösterilemiyor.</div>;
  const gruplar = bloklaraBol(satirlar);
  const sutun = 'rounded-lg border overflow-auto max-h-[55vh]';
  const satir = (no: number, metin: string, renk?: string, zemin?: string) => (
    <div className="flex font-mono text-[11px] leading-5" style={{ background: zemin }}>
      <span className="shrink-0 w-14 pr-2 text-right select-none" style={{ color: 'var(--text-muted)' }}>{no || ''}</span>
      <span className="whitespace-pre pr-3" style={{ color: renk || 'var(--text-primary)' }}>{metin}</span>
    </div>
  );
  return (
    <div className="space-y-3">
      {gruplar.length > 1 && <div style={{ color: 'var(--text-secondary)' }}>Bu ServerName dosyada <b>{gruplar.length} ayrı blokta</b> geçiyor (ör. :80 ve :443); hepsi işlenir.</div>}
      {gruplar.map((g, gi) => (
        <div key={gi} className="space-y-1">
          <div className="font-semibold" style={{ color: 'var(--text-muted)' }}>Blok {gi + 1}{g.bas ? ` · satır ${g.bas}–${g.son}` : ''}</div>
          <div className="grid gap-2 md:grid-cols-2">
            <div className={sutun} style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-elevated)' }}>
              <div className="sticky top-0 px-2 py-1 text-[11px] font-semibold border-b" style={{ background: 'var(--bg-elevated)', borderColor: 'var(--border-subtle)' }}>ÖNCE — şu an dosyada</div>
              {g.satirlar.map((s, i) => <div key={i}>{satir(s.no, s.metin)}</div>)}
            </div>
            <div className={sutun} style={{ borderColor: kip === 'bilinmiyor' ? 'var(--status-danger)' : 'var(--status-warning)', background: 'var(--bg-elevated)' }}>
              <div className="sticky top-0 px-2 py-1 text-[11px] font-semibold border-b" style={{ background: 'var(--bg-elevated)', borderColor: 'var(--border-subtle)' }}>
                SONRA — onaydan sonra {kip === 'yorumla' ? '(yorum satırına alınır)' : kip === 'yok' ? '(değişiklik yok)' : kip === 'tasi' ? '(dosya taşınır)' : ''}
              </div>
              {kip === 'tasi' && <div className="px-2 py-2 text-[11px]" style={{ color: 'var(--status-warning-text)' }}>Dosyada yalnız bu vhost var: dosyanın <b>tamamı</b> {hedef ? <span className="font-mono">{hedef}</span> : '.retired/'} altına taşınır, <span className="font-mono">{v.confFile}</span> artık okunmaz.</div>}
              {kip === 'bilinmiyor' && <div className="px-2 py-2 text-[11px]" style={{ color: 'var(--status-danger-text)' }}>Yapılacak işlem plan çıktısından okunamadı (eski server_hub_fix sürümü?) — sonraki hal gösterilemiyor.</div>}
              {(kip === 'yorumla' || kip === 'yok') && g.satirlar.map((s, i) => {
                const m = sonraMetni(s.metin, kip) as string;
                const r = DEG_RENK[kip === 'yorumla' ? 'yorumlanan' : 'ayni'];
                return <div key={i} title={r.etiket}>{satir(s.no, m, r.renk, r.zemin)}</div>;
              })}
            </div>
          </div>
        </div>
      ))}
      {kip === 'yorumla' && <div style={{ color: 'var(--text-muted)' }}><span className="font-mono">{YORUM_ONEKI}</span>öneki gerçek koşunun zaman damgasıyla yazılır; “Geri aktif et” bu öneki kaldırır.</div>}
    </div>
  );
}

// ELLE AYRI BASLIKTA (2026-10-27, kullanici: "Jboss7 sectim gidip Redhat Apache'yi de bulup islem yapmaya
// calisiyor gibi"): 'elle' girdiler web adiminda KAPATILMAZ ama "Kapatilacak" basligi altinda gorunuyordu.
function VhostBloklar({ liste }: { liste?: VhostPlanDurumu[] }) {
  if (!liste || !liste.length) return null;
  const kapatilacak = liste.filter((v) => v.durum !== 'elle');
  const elle = liste.filter((v) => v.durum === 'elle');
  return (
    <div className="text-[12px] rounded-lg border px-3 py-2 space-y-3" style={{ borderColor: liste.some((v) => v.durum === 'hata') ? 'var(--status-danger)' : 'var(--border-subtle)' }}>
      {kapatilacak.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="font-semibold" style={{ color: 'var(--text-muted)' }}>Kapatılacak VirtualHost blokları (web adımı)</div>
          <RenkAciklama />
        </div>
      )}
      {kapatilacak.map((v) => (
        <div key={v.host + v.serverName + v.confFile} className="space-y-2">
          <div>
            <span className="font-mono font-semibold">{v.serverName}</span>
            <span style={{ color: 'var(--text-muted)' }}> @ {v.host} · <span className="font-mono">{v.confFile || '?'}</span></span>
          </div>
          {v.durum === 'suruyor' && <div style={{ color: 'var(--text-muted)' }}>plan okunuyor… (server_hub_fix #{v.jobId ?? '?'})</div>}
          {(v.durum === 'hata' || v.durum === 'elle') && <div style={{ color: v.durum === 'hata' ? 'var(--status-danger-text)' : 'var(--status-warning-text)' }}>{v.durum === 'elle' ? 'ELLE: ' : 'PLAN BAŞARISIZ — web adımı da düşecek: '}{v.mesaj}</div>}
          {v.durum === 'hazir' && (
            <>
              {v.mesaj && <div style={{ color: 'var(--text-secondary)' }}>{v.mesaj}</div>}
              <OnceSonra v={v} />
              <JkOnceSonra deg={v.jkdeg} />
              <JkBaglantilari jk={v.jk} />
            </>
          )}
        </div>
      ))}
      {elle.length > 0 && (
        <div className="space-y-2" data-testid="rt-vhost-elle">
          <div className="font-semibold" style={{ color: 'var(--status-warning-text)' }}>Otomatik kapatılmayacak — dokunulmaz, gerekirse elle kontrol edin</div>
          {elle.map((v) => (
            <div key={v.host + v.serverName + v.confFile}>
              <span className="font-mono font-semibold">{v.serverName}</span>
              <span style={{ color: 'var(--text-muted)' }}> @ {v.host} · <span className="font-mono">{v.confFile || '?'}</span></span>
              <div style={{ color: 'var(--text-secondary)' }}>{v.mesaj}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
import { toast } from '@/hooks/useToast';

// SM_BTN / smBtn retirementStil.ts'e tasindi (smBtn(true) metni --text-on-accent).
const TERMINAL = new Set(['successful', 'failed', 'error', 'canceled']);
const INPUT = 'w-full px-2.5 py-1.5 text-xs border rounded-lg';
const inputStyle: React.CSSProperties = { borderColor: 'var(--border)', background: 'var(--bg-surface)', color: 'var(--text-primary)' };

// Durum -> ton (retirementStil.ts TON); metin rengi tondan gelir (Hap). Pill kalkti (2026-10-26).
const TSTATUS: Record<RtTargetStatus, { label: string; ton: Ton }> = {
  pending: { label: 'bekliyor', ton: 'notr' }, planning: { label: 'ön kontrol sürüyor', ton: 'bilgi' }, planned: { label: 'onay bekliyor', ton: 'aksan' },
  stop_scheduled: { label: 'OCO penceresine zamanlandı', ton: 'bilgi' },
  stopping: { label: 'durduruluyor', ton: 'uyari' }, stopped: { label: 'DURDURULDU', ton: 'basari' },
  deleting: { label: 'siliniyor', ton: 'uyari' }, deleted: { label: 'SİLİNDİ', ton: 'notr' },
  // GERI ALMA (2026-10-07). 'active' YESIL ve 'DURDURULDU'dan AYRI okunmali: ikisi de
  // "basarili" ama biri uygulamanin kapali, oteki ACIK oldugu anlamina geliyor (hapta ikon).
  rolling_back: { label: 'geri alınıyor', ton: 'uyari' },
  active: { label: 'GERİ AKTİF', ton: 'basari' },
  rollback_failed: { label: 'geri alma BAŞARISIZ', ton: 'hata' },
  failed: { label: 'başarısız', ton: 'hata' }, skipped: { label: 'atlandı', ton: 'notr' },
};
const RSTATUS: Record<string, { label: string; ton: Ton }> = {
  open: { label: 'açık', ton: 'aksan' }, stopping: { label: 'stop sürüyor', ton: 'uyari' }, stopped: { label: 'durduruldu — silme bekliyor', ton: 'basari' },
  deleted: { label: 'silindi', ton: 'notr' }, cancelled: { label: 'iptal', ton: 'notr' },
};

// SERVER HUB CALISMA DURUMU (sozlesme v3, D1-U05): discover.cjs hub.runningKnown tasir
// (running_src !== 'UNMEASURED'). hidepid'li sunucuda gorunmeyen JVM "kapali" DEGIL "bilinmiyor"dur
// - kural 6. Alan yoksa (eski sunucu yaniti) eski davranis. Alan retirementApi.ts'te (istege bagli).
/** Vhost trafigi (Apache/IHS access log, hc HARIC).
 *
 *  UC DURUM UC AYRI GOSTERIM. "olculemedi" ASLA "trafik yok" gibi gosterilmez: retire
 *  karari buna dayaniyor ve yanlis tarafa dusmek, hala istek alan bir uygulamayi
 *  durdurmak demek. `sampled` ise sayi ALT SINIR ("en az N"). Uc durum renk disinda da
 *  ayrisir: var = dolu kirmizi, yok = duz yesil, olculemedi = kesikli sari. */
const TR_CIP = 'inline-flex h-4 items-center rounded px-1.5 text-[11px] font-medium leading-none whitespace-nowrap tabular-nums';
const TR_OLCULEMEDI: React.CSSProperties = { color: 'var(--status-warning-text)', background: 'var(--status-warning-bg)', border: '1px dashed var(--status-warning)' };
function TrafikHucresi({ tr }: { tr?: import('@/api/retirementApi').RtVhostTrafik }) {
  if (!tr) return <span className={TR_CIP} style={TR_OLCULEMEDI} title="Trafik bilgisi gelmedi — “trafik yok” DEĞİL">ölçülemedi</span>;
  if (tr.durum === 'olculemedi')
    return (
      <span className={TR_CIP} style={TR_OLCULEMEDI} title={`Server Hub: ${tr.sebep || 'sebep bilinmiyor'} — "trafik yok" DEĞİL`}>
        ölçülemedi
      </span>
    );
  if (tr.durum === 'yok')
    return (
      <span className={TR_CIP} style={{ color: 'var(--status-success)' }} title={`7 günde hc hariç istek yok (tarama ${tr.tarama || '?'})`}>
        istek yok (7g)
      </span>
    );
  return (
    <span className={TR_CIP} style={{ color: 'var(--status-danger-text)', background: 'var(--status-danger-bg)', fontWeight: 600 }}
      title={`hc hariç: 24s ${tr.req24 ?? '?'} · 7g ${tr.req7}${tr.hc24 != null ? ` · hc 24s ${tr.hc24}` : ''}${tr.sonIstek ? ` · son istek ${tr.sonIstek}` : ''}${tr.sampled ? ' · log kuyruğu kesildi, sayı ALT SINIR' : ''}`}>
      {tr.sampled ? 'en az ' : ''}{fmtNumber(tr.req7)} istek (7g)
    </span>
  );
}

type HubV3 = NonNullable<RtDiscoveredTarget['hub']>;
function hubDurumu(hub: HubV3): { metin: string; renk: string; aciklama: string } {
  if (hub.runningKnown === false)
    return { metin: 'bilinmiyor', renk: 'var(--status-warning-text)', aciklama: 'Server Hub çalışma durumunu ölçemedi (süreç görünmüyor) — kapalı sayılmadı.' };
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
    return { metin: 'Server Hub okunamadı', renk: 'var(--status-warning-text)', aciklama: "Server Hub verisi okunamadı — JVM'in çalışıp çalışmadığı ölçülemedi (taranmamış ya da kapalı SAYILMADI)." };
  if (!hub) return { metin: 'tarama yok', renk: 'var(--text-muted)', aciklama: '' };
  const d = hubDurumu(hub);
  return { metin: `${d.metin} · auto-start ${hub.autoStart}`, renk: d.renk, aciklama: d.aciklama };
}
function HubHucresi({ hub, okunamadi }: { hub: HubV3 | null; okunamadi: boolean }) {
  const hc = hubHucresi(hub, okunamadi);
  // Renkler yalniz dosya ici literal (ui-v2 bekcisi ust duzeyi sahte require ile calistirir).
  return <span className="inline-flex items-start gap-1.5" style={{ color: hc.renk }} title={hc.aciklama || undefined}><span aria-hidden className="mt-[5px] h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: 'currentColor' }} />{hc.metin}</span>;
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
/** STOP onayinda vhost trafigi (2026-10-08). On kontrolle baslatilan Server Hub taramasi
 *  SURERKEN "olculuyor", bitince TAZE sayi; istek varsa onay kutusu ZORUNLU (kapi:
 *  stopOnayAcikMi). Olculemedi "yok" DEGIL ve STOP'u kilitlemez - uyari olarak durur. */
function StopTrafik({ t, disc, is, onay, setOnay, bekleme, setBekleme }: {
  t: RtTarget; disc: RtDiscovery | null;
  is?: { durum: TrafikIsDurumu; jobId?: number | null; mesaj?: string; bitti?: string };
  onay: boolean; setOnay: (v: boolean) => void; bekleme: boolean; setBekleme: (v: boolean) => void;
}) {
  const o = stopTrafikOzeti(t, disc);
  if (!o.satirlar.length) return null;
  const suruyor = is?.durum === 'suruyor';
  return (
    <div className="text-[11px] rounded-lg border px-3 py-2 space-y-1" style={{ borderColor: o.var ? 'var(--status-danger)' : 'var(--border-subtle)' }}>
      <div className="font-semibold" style={{ color: 'var(--text-muted)' }}>
        Web trafiği (hc hariç)
        {suruyor ? ` — ölçülüyor… (Server Hub taraması #${is?.jobId ?? '?'})`
          : is?.durum === 'bitti' ? ` — bu ön kontrolde ölçüldü${is.bitti ? ` (${fmtDateTime(is.bitti)})` : ''}`
          : is?.durum === 'hata' ? ' — TAZELENEMEDİ, son tarama verisi' : ' — son Server Hub taraması'}
      </div>
      {is?.durum === 'hata' && is.mesaj && <div style={{ color: 'var(--status-warning-text)' }}>{is.mesaj}</div>}
      {o.satirlar.map((s) => {
        const tr = s.trafik;
        return (
          <div key={s.host + s.serverName} className="flex gap-2">
            <span className="font-mono shrink-0">{s.serverName}</span>
            <span style={{ color: tr?.durum === 'var' ? 'var(--status-danger-text)' : 'var(--text-muted)' }}>
              {!tr || tr.durum === 'olculemedi' ? `ölçülemedi${tr?.sebep ? ` (${tr.sebep})` : ''} — “istek yok” DEĞİL`
                : tr.durum === 'var' ? `${tr.sampled ? 'en az ' : ''}${tr.req7} istek / 7 gün${tr.req24 != null ? `, ${tr.req24} / 24 saat` : ''}`
                : 'son 7 günde istek yok'}
              {tr?.tarama ? ` · tarama ${tr.tarama}` : ''}
            </span>
          </div>
        );
      })}
      {suruyor && (
        <label className="flex items-center gap-1.5" style={{ color: 'var(--text-muted)' }}>
          <input type="checkbox" checked={bekleme} onChange={(e) => setBekleme(e.target.checked)} />
          Ölçümü bekleme, son tarama verisiyle devam et
        </label>
      )}
      {o.var > 0 && (
        <label className="flex items-center gap-1.5 font-semibold" style={{ color: 'var(--status-danger-text)' }}>
          <input type="checkbox" checked={onay} onChange={(e) => setOnay(e.target.checked)} />
          Halen istek alan {o.var} vhost var; yine de durdurmak istiyorum
        </label>
      )}
    </div>
  );
}

/** STOP onay penceresindeki uyari kutusu (ayri bilesen: ekrana cikip cikmadigi bekcide CAGRILARAK
 *  sinanir). Okunamadiysa role=alert; okunduysa hicbir sey basilmaz. Gizlenmez (hidden yok). */
function StopHubUyari({ durum }: { durum: StopHubDurumu }) {
  const metin = stopHubUyarisi(durum);
  if (!metin) return null;
  return <div role={durum === 'okunamadi' ? 'alert' : undefined} className="text-[12px] rounded-lg border px-3 py-2" style={durum === 'okunamadi' ? { color: 'var(--status-warning-text)', borderColor: 'var(--status-warning)', background: 'var(--status-warning-bg)' } : { color: 'var(--text-muted)', borderColor: 'var(--border-subtle)' }}>{metin}</div>;
}

// ── TABLO YENIDEN TASARIMI (2026-10-26) ─────────────────────────────────────────────
// table-fixed + colgroup: kolon genislikleri sabit, Web kolonu kalan alani alir (1280'de yatay
// kaydirma yok). Hedef hucresi iki kayitta da ayni (HedefHucresi).
const HEDEF_IPUCU = 'Sunucu · ortam · JBoss sürümü · site; altında uygulama adı';
const CM_KOLONLAR: Kolon[] = [
  { anahtar: 'sec', baslik: '', genislik: '2.25rem' },
  { anahtar: 'hedef', baslik: 'Hedef', genislik: '18rem', ipucu: HEDEF_IPUCU },
  { anahtar: 'hub', baslik: 'Server Hub · envanter', genislik: '12rem' },
  { anahtar: 'web', baslik: 'Web sunucusu · vhost', sag: 'Trafik · 7 gün, hc hariç' },
  { anahtar: 'paket', baslik: 'Paket', genislik: '12rem' },
];
// inPlace null = bilinmiyor (eski kayit); digerSurumler 0 = surumu bilinmeyen kurulum.
type HedefOzet = { host: string; env: string; site: string; gen: number | null; appName: string; inPlace?: boolean | null; digerSurumler?: number[] | null };
// Ust satir: sunucu · ortam · JB · site · in-place cipi (sabit kolonlar, 18rem'de sigar); alt satir uygulama
// adi TAM genislikte - cip ayni satirdayken adi kesiyordu ("GBCORPORATEBANKINGSERVI…", ana ajan olcumu V1).
function HedefHucresi({ h }: { h: HedefOzet }) {
  const prod = h.env === 'PROD';
  return (
    <div className="min-w-0">
      <div className="grid h-5 grid-cols-[4.75rem_2.5rem_2rem_2.5rem_max-content] items-center gap-x-1">
        <span className="truncate font-mono font-semibold" title={h.host}>{h.host}</span>
        <span className="inline-flex h-4 items-center justify-center rounded text-[11px] font-semibold leading-none" title={`Ortam: ${h.env}`} data-rt-ortam style={prod ? { color: 'var(--status-danger-text)', background: 'var(--status-danger-bg)', boxShadow: 'inset 0 0 0 1px var(--status-danger)' } : { color: 'var(--text-secondary)', boxShadow: 'inset 0 0 0 1px var(--border)' }}>{h.env}</span>
        <span className="inline-flex h-4 items-center justify-center rounded text-[11px] font-semibold leading-none tabular-nums" title={h.gen ? `JBoss ${h.gen}` : 'JBoss sürümü envanterden okunamadı'} style={h.gen && h.gen >= 8 ? { color: 'var(--accent)', background: 'var(--accent-bg)' } : h.gen ? { color: 'var(--text-secondary)', background: 'var(--bg-elevated)' } : { color: 'var(--status-danger-text)', background: 'var(--status-danger-bg)' }}>JB {h.gen ?? '?'}</span>
        <span className="truncate text-[11px]" title={`Site: ${h.site}`} style={h.site === 'Ankara' ? { color: 'var(--status-warning-text)', fontWeight: 600 } : { color: 'var(--text-secondary)' }}>{h.site}</span>
        {/* IN-PLACE: Cip whitespace-nowrap ('in-/place' kirilmaz); ipucu diger kurulumu ve dokunulmayanlari soyler. */}
        {h.inPlace && <Cip ton="uyari" title={inPlaceIpucu(h.digerSurumler)}>in-place</Cip>}
      </div>
      <div className="min-h-4 truncate text-[11px] leading-4" style={{ color: 'var(--text-secondary)' }} title={h.appName} data-rt-uygulama>{h.appName}</div>
    </div>
  );
}
/** Paket: once dosya adi (asil ayirt edici), altinda dizin; tam yol ipucunda. Dosya adi sigmazsa BASTAN
 *  kisaltilir (rtl kap + ltr izole metin): ayirt edici sonek ("-Q.ear" / "-T.ear") her genislikte gorunur. */
function PaketHucresi({ yol }: { yol: string | null }) {
  if (!yol) return <span className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>—</span>;
  const temiz = yol.replace(/\/+$/, '');
  const ad = temiz.split('/').pop() || temiz;
  const dizin = temiz.slice(0, temiz.length - ad.length);
  return (
    <div className="min-w-0 font-mono text-[11px]">
      <div className="truncate text-left leading-5" style={{ color: 'var(--text-primary)', direction: 'rtl' }} title={yol} data-rt-paket-ad><bdi dir="ltr">{ad}</bdi></div>
      {dizin && <div className="truncate leading-4" style={{ color: 'var(--text-secondary)' }} title={yol}>{dizin}</div>}
    </div>
  );
}

// ── KAYIT TABLOSU (RecordModal) ─────────────────────────────────────────────────────────
// Toplu secim yoksa secim kolonu daralir (yalniz secili / acik cizgisi kalir). Web kolonu esnek.
const rmKolonlar = (toplu: boolean): Kolon[] => [
  { anahtar: 'sec', baslik: '', genislik: toplu ? '2.25rem' : '0.75rem', ipucu: toplu ? 'Birlikte çalıştırmak için seç' : undefined },
  { anahtar: 'hedef', baslik: 'Hedef', genislik: '18rem', ipucu: HEDEF_IPUCU },
  { anahtar: 'web', baslik: 'Web sunucusu · vhost', sag: 'Web adımı' },
  { anahtar: 'durum', baslik: 'Durum · sonuç', genislik: '16rem' },
  { anahtar: 'eylem', baslik: 'Eylem', genislik: '14rem' },
];
/** Vhost satirinin web adimi: en kotu girdi (WEB_DURUM.oncelik); birden cok conf ' ×n'. STOP'tan once bos (gurultu yok).
 *  Isi varsa ve `onAc` verildiyse dugme: o girdinin is ciktisini acar (`i` webSonuc'taki OZGUN sira). */
function WebSonucCip({ l, onAc }: { l: { w: RtWeb2; i: number }[]; onAc?: (i: number) => void }) {
  if (!l.length) return null;
  const d = (w: RtWeb2) => WEB_DURUM[w.status] || { etiket: w.status, ton: 'notr' as Ton, oncelik: 3 };
  const enKotu = l.reduce((a, b) => (d(b.w).oncelik > d(a.w).oncelik ? b : a));
  const v = d(enKotu.w);
  const ipucu = l.map(({ w }) => `${w.confFile || '?'}: ${d(w).etiket}${w.jobId ? ` · iş #${w.jobId}` : ''}${w.message ? ` — ${w.message}` : ''}`).join('\n');
  const sinif = 'inline-flex h-4 items-center gap-1 rounded-full px-1.5 text-[11px] font-medium leading-none whitespace-nowrap';
  const stil = { background: TON[v.ton].zemin, color: TON[v.ton].metin };
  const ic = <><span aria-hidden className={`h-1.5 w-1.5 shrink-0 rounded-full ${v.canli ? 'animate-status-pulse motion-reduce:animate-none' : ''}`} style={{ background: TON[v.ton].renk, color: TON[v.ton].renk }} />{v.etiket}{l.length > 1 ? ` ×${l.length}` : ''}</>;
  if (enKotu.w.jobId && onAc) return <button type="button" onClick={() => onAc(enKotu.i)} className={`${sinif} focus-visible:outline-offset-2!`} style={stil} title={`${ipucu}\n— iş çıktısını aç`} aria-label={`Web adımı: ${v.etiket}${l.length > 1 ? ` ×${l.length}` : ''} — iş çıktısını aç`}>{ic}</button>;
  return <span className={sinif} style={stil} title={ipucu}>{ic}</span>;
}
/** Durdurulmus hedefin silme durumu (Durum kolonu): bekleme atlandi mi + silme on kontrolu; liste penceresini acar. */
function SilmeDurumu({ t, onListe }: { t: RtTarget; onListe: () => void }) {
  const k = t.silmeOnKontrol;
  const dosya = k ? k.onkontrol.filter((x) => x.startsWith('ONKONTROL\tdosya\t') && !x.startsWith('ONKONTROL\tdosya\t-\t')).length : 0;
  return (
    <div className="flex flex-wrap items-center gap-x-1.5 text-[11px] leading-4">
      {t.deleteNowAt && (
        <span className="inline-flex items-center gap-1 font-semibold" style={{ color: 'var(--status-warning-text)' }} title={`Bekleme ${fmtDateTime(t.deleteNowAt)} tarihinde atlandı`}>
          <span aria-hidden className="h-1.5 w-1.5 rounded-full animate-pulse motion-reduce:animate-none" style={{ background: 'var(--status-warning)' }} />silme sırada — yukarıdaki panelde geri sayım
        </span>
      )}
      {!k ? <span style={{ color: 'var(--text-secondary)' }} title="Zamanlayıcı silme saatinden bir saat önce koşar">silme ön kontrolü: henüz yok</span>
        : onKontrolSuruyor(k) ? <span style={{ color: 'var(--status-warning-text)' }}>silme ön kontrolü sürüyor{k.jobId ? ` (#${k.jobId})` : ''}…</span>
        : (
          <button type="button" onClick={onListe} className={LINK} style={{ color: k.durum !== 'ok' ? 'var(--status-danger-text)' : k.hazir ? 'var(--status-success)' : 'var(--text-secondary)' }} title="Silinecek dosyalar, kaldırılacak JBoss tanımları, komutlar ve dokunulmayacaklar">
            {k.durum === 'ok' ? `silme listesi: ${dosya} dosya${k.hazir ? '' : k.kullanildi ? ' (kullanıldı)' : ' (bayat — silmeden önce yenilenir)'}` : 'silme ön kontrolü BAŞARISIZ'}{k.at ? ` · ${fmtDateTime(k.at)}` : ''}
          </button>
        )}
    </div>
  );
}

export default function RetirementTab() {
  const [rows, setRows] = useState<RtRecordRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [openId, setOpenId] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);
  const [cfg, setCfg] = useState<{ defaultDays: number; sccMailConfigured: boolean; sccMailTo: string | null; sccMailCc?: string | null; sccKaynak?: SccKaynak; sccGuncelleyen?: string | null; sccGuncellendi?: string | null; sccDbHatasi?: string | null } | null>(null);
  // SCC ADRESI EKRANDAN (2026-10-08, kullanici: "bunu application retirement sayfasinda girmek
  // istiyorum"). Eskiden yalniz Portal sunucusunun ortam degiskeniydi.
  const [sccAc, setSccAc] = useState(false);
  const [sccForm, setSccForm] = useState({ to: '', cc: '' });
  const [sccKayit, setSccKayit] = useState(false);
  const sccAcik = () => { setSccForm({ to: (cfg?.sccMailTo || '').split(',').join(', '), cc: (cfg?.sccMailCc || '').split(',').filter(Boolean).join(', ') }); setSccAc(true); };
  const sccKaydet = async () => {
    setSccKayit(true);
    try {
      const r = await retirementApi.sccKaydet(sccForm.to, sccForm.cc);
      if (!r.ok) { toast.error(r.message || 'Kaydedilemedi.'); return; }
      setCfg((c) => (c ? { ...c, sccMailConfigured: !!r.sccMailTo, sccMailTo: r.sccMailTo ?? null, sccMailCc: r.sccMailCc ?? null, sccKaynak: r.sccKaynak, sccGuncelleyen: r.sccGuncelleyen, sccGuncellendi: r.sccGuncellendi } : c));
      setSccAc(false);
      toast.success(r.sccKaynak === 'ekran' ? 'SCC adresi kaydedildi; bir sonraki PROD STOP’ta kullanılır.' : r.sccKaynak === 'env' ? 'Ekran değeri kaldırıldı; Portal ortam değişkenindeki adres kullanılacak.' : 'SCC adresi kaldırıldı; PROD STOP’ta mail gitmeyecek.');
    } catch (e: unknown) { toast.error(e instanceof Error ? e.message : String(e)); } finally { setSccKayit(false); }
  };

  const [filtre, setFiltre] = useState<KayitFiltre>(BOS_FILTRE);
  const filtreAktif = Object.values(filtre).some((v) => v.trim());
  const gorunen = useMemo(() => kayitFiltrele(rows, filtre), [rows, filtre]);
  const secenek = useMemo(() => ({
    durum: [...new Set(rows.map((r) => r.status))],
    ortam: [...new Set(rows.flatMap((r) => (r.envs || []).map((e) => e.env)))],
    acan: [...new Set(rows.map((r) => r.requestedBy).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'tr')),
  }), [rows]);
  const fAyarla = (k: keyof KayitFiltre) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setFiltre((f) => ({ ...f, [k]: e.target.value }));
  const fInput = 'w-full px-1.5 py-1 text-[11px] font-normal border rounded-md';
  const fStil = { borderColor: 'var(--border)', background: 'var(--bg-surface)', color: 'var(--text-primary)' };

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
        </p>
        {/* SCC ADRESI: ne oldugu, NEREDEN geldigi ve duzenleme tek satirda. */}
        {cfg && (
          <div className="text-[11px] flex items-center gap-1.5 flex-wrap" style={{ color: cfg.sccMailConfigured ? 'var(--text-muted)' : 'var(--status-warning-text)' }}>
            <span>SCC bilgilendirme (PROD ilk STOP):</span>
            {cfg.sccMailConfigured
              ? <b className="font-mono" style={{ color: 'var(--text-secondary)' }}>{cfg.sccMailTo}{cfg.sccMailCc ? ` · cc ${cfg.sccMailCc}` : ''}</b>
              : <b>tanımlı değil — prod STOP'ta mail gitmez</b>}
            {cfg.sccKaynak === 'env' && <span>(Portal ortam değişkeninden)</span>}
            {cfg.sccKaynak === 'ekran' && cfg.sccGuncelleyen && <span>({cfg.sccGuncelleyen}{cfg.sccGuncellendi ? `, ${fmtDateTime(cfg.sccGuncellendi)}` : ''})</span>}
            {cfg.sccDbHatasi && <span style={{ color: 'var(--status-warning-text)' }}>(ayar okunamadı: {cfg.sccDbHatasi})</span>}
            <button onClick={sccAcik} className="underline decoration-dotted" style={{ color: 'var(--accent)' }}>{cfg.sccMailConfigured ? 'düzenle' : 'adres gir'}</button>
          </div>
        )}
        <div className="ml-auto flex items-center gap-2">
          <button onClick={load} className={SM_BTN} style={smBtn()}><ArrowPathIcon className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /> Yenile</button>
          <button onClick={() => setCreating(true)} className={SM_BTN} style={smBtn(true)}><PlusIcon className="w-3.5 h-3.5" /> Yeni retirement kaydı</button>
        </div>
      </div>
      <Modal open={sccAc} onClose={() => setSccAc(false)} title="SCC bilgilendirme adresi" size="sm"
        footer={<div className="flex justify-end gap-2"><button onClick={() => setSccAc(false)} className={SM_BTN} style={smBtn()}>Kapat</button><button disabled={sccKayit} onClick={sccKaydet} className={`${SM_BTN} disabled:opacity-50`} style={smBtn(true)}>{sccKayit ? 'Kaydediliyor…' : 'Kaydet'}</button></div>}>
        <div className="space-y-2.5 text-[12px]" style={{ color: 'var(--text-secondary)' }}>
          <p>PROD hedefte kaydın <b>ilk gerçek STOP</b>'unda bu adreslere bilgilendirme maili gider (AWX, smtpappv1). Birden çok adres için virgül kullanın.</p>
          <label className="block">Kime *
            <input value={sccForm.to} onChange={(e) => setSccForm((f) => ({ ...f, to: e.target.value }))} className={`${INPUT} mt-1 font-mono`} style={inputStyle} placeholder="ornek@garantibbva.com.tr" autoFocus />
          </label>
          <label className="block">Bilgi (CC) <span style={{ color: 'var(--text-muted)' }}>(opsiyonel)</span>
            <input value={sccForm.cc} onChange={(e) => setSccForm((f) => ({ ...f, cc: e.target.value }))} className={`${INPUT} mt-1 font-mono`} style={inputStyle} />
          </label>
          <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>“Kime”yi boş bırakıp kaydederseniz ekran değeri kalkar; varsa Portal ortam değişkenindeki (RETIREMENT_SCC_MAIL_TO) adres kullanılır. Değişiklik yeniden başlatma gerektirmez.</p>
        </div>
      </Modal>
      {err && <div className="text-sm rounded-xl px-3 py-2 border" style={{ color: 'var(--status-danger-text)', background: 'var(--status-danger-bg)', borderColor: 'var(--status-danger)' }}>{err}</div>}
      <div className="overflow-auto rounded-xl border" style={{ borderColor: 'var(--border-subtle)' }}>
        <table className="w-full text-xs border-collapse">
          <thead style={{ background: 'var(--bg-elevated)' }}>
            <tr>{['Uygulama', 'Smart', 'OCO', 'Durum', 'Hedefler', 'Stop', 'Silme tarihi', 'Açan', 'Açılış'].map((h) => <th key={h} className="px-3 py-2 text-left text-[11px] font-semibold" style={{ color: 'var(--text-muted)' }}>{h}</th>)}</tr>
            {/* FILTRE SATIRI: her kolonun altinda kendi filtresi. */}
            <tr className="border-t" style={{ borderColor: 'var(--border-subtle)' }}>
              <th className="px-3 pb-2 pt-0.5 min-w-[11rem]">
                <input value={filtre.app} onChange={fAyarla('app')} placeholder="uygulama ara" className={fInput} style={fStil} aria-label="Uygulama adına göre süz" />
                <select value={filtre.ortam} onChange={fAyarla('ortam')} className={`${fInput} mt-1`} style={fStil} aria-label="Ortama göre süz">
                  <option value="">ortam: hepsi</option>
                  {secenek.ortam.map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
              </th>
              <th className="px-3 pb-2 pt-0.5"><input value={filtre.smart} onChange={fAyarla('smart')} placeholder="Smart no" className={`${fInput} font-mono`} style={fStil} aria-label="Smart numarasına göre süz" /></th>
              <th className="px-3 pb-2 pt-0.5"><input value={filtre.oco} onChange={fAyarla('oco')} placeholder="OCO no" className={`${fInput} font-mono`} style={fStil} aria-label="OCO numarasına göre süz" /></th>
              <th className="px-3 pb-2 pt-0.5">
                <select value={filtre.durum} onChange={fAyarla('durum')} className={fInput} style={fStil} aria-label="Duruma göre süz">
                  <option value="">hepsi</option>
                  {secenek.durum.map((d) => <option key={d} value={d}>{RSTATUS[d]?.label || d}</option>)}
                </select>
              </th>
              <th colSpan={3} className="px-3 pb-2 pt-0.5 text-left text-[11px] font-normal" style={{ color: 'var(--text-muted)' }}>
                {filtreAktif && (
                  <span className="inline-flex items-center gap-2">
                    <span className="tabular-nums"><b style={{ color: 'var(--text-primary)' }}>{gorunen.length}</b> / {rows.length} kayıt</span>
                    <button onClick={() => setFiltre(BOS_FILTRE)} className="underline decoration-dotted" style={{ color: 'var(--accent)' }}>filtreleri temizle</button>
                  </span>
                )}
              </th>
              <th className="px-3 pb-2 pt-0.5 min-w-[9rem]">
                <input value={filtre.acan} onChange={fAyarla('acan')} placeholder="açan kişi" list="rt-acan-liste" className={fInput} style={fStil} aria-label="Açan kişiye göre süz" />
                <datalist id="rt-acan-liste">{secenek.acan.map((a) => <option key={a} value={a} />)}</datalist>
              </th>
              <th className="px-3 pb-2 pt-0.5" />
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? <TableEmptyRow colSpan={9} title="Retirement kaydı yok." description="Smart silme kaydı gelince 'Yeni retirement kaydı' ile açın." />
              : gorunen.length === 0 ? <TableEmptyRow colSpan={9} title="Filtrelere uyan kayıt yok." description="Filtreleri gevşetin ya da temizleyin." />
              : gorunen.map((r) => (
              <tr key={r.id} className="border-t cursor-pointer hover:bg-[var(--bg-elevated)]" style={{ borderColor: 'var(--border-subtle)' }} onClick={() => setOpenId(r.id)}>
                <td className="px-3 py-1.5">
                  <div className="font-semibold">{r.app}</div>
                  {/* ORTAM ROZETLERI (2026-10-08): kayit TABAN adla tutuluyor; hangi ortamin
                      retire edildigi tiklamadan gorunsun. Ipucunda gercek uygulama adlari. */}
                  {r.envs && r.envs.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-0.5">
                      {r.envs.map((e) => (
                        <span key={e.env} className="text-[10px] font-semibold px-1.5 py-px rounded border tabular-nums"
                          style={{ color: e.env === 'PROD' ? 'var(--status-danger-text)' : 'var(--text-secondary)', borderColor: e.env === 'PROD' ? 'var(--status-danger)' : 'var(--border-subtle)' }}
                          title={`${e.env}: ${e.uygulamalar.join(', ')} · ${e.durdurulan} durduruldu${e.silinen ? `, ${e.silinen} silindi` : ''} / ${e.toplam}`}>
                          {e.env}{e.toplam > 1 ? ` ×${e.toplam}` : ''}
                        </span>
                      ))}
                    </div>
                  )}
                </td>
                <td className="px-3 py-1.5 font-mono text-[11px]">{r.smartNo}</td>
                <td className="px-3 py-1.5 font-mono text-[11px]">{r.ocoNo || '—'}</td>
                <td className="px-3 py-1.5"><Hap {...(RSTATUS[r.status] || { label: r.status, ton: 'notr' as Ton })} /></td>
                <td className="px-3 py-1.5 tabular-nums">{r.targets}</td>
                <td className="px-3 py-1.5 tabular-nums">{r.stopped}/{r.targets}{r.stopAt ? <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}> · {fmtDate(r.stopAt)}</span> : null}</td>
                <td className="px-3 py-1.5">{r.effectiveDeleteAt ? <>{fmtDate(r.effectiveDeleteAt)} <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>{r.deleteAt?.saat || '23:00'}</span></> : <span style={{ color: 'var(--text-muted)' }}>stop + {r.deleteAfterDays} gün</span>}</td>
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
    // JBOSS SURUMU KARISIKSA HICBIRI ON SECILI DEGIL (2026-10-13, kullanici: "yalniz JBoss 7'yi
    // retirement'a dahil etmek isterken JBoss 8'i de istemim disi surece soktu"). Ayni uygulama goc
    // doneminde iki surumde birden calisiyor; hangisinin retire edildigini kullanici ACIKCA secer.
    try {
      const d = await retirementApi.discover(a);
      if (d.ok) {
        setDisc(d);
        const surumler = new Set(d.targets.map((t) => t.gen ?? 0));
        // IN-PLACE (job_3438186): ayni sunucuda iki kurulum iki ayri hedef; anahtar kurulumu da icerir.
        setSel(surumler.size > 1 ? new Set() : new Set(d.targets.map((t) => `${t.host}|${t.appName}|${t.gen ?? ''}`)));
      } else toast.error(d.message || 'Keşif başarısız.');
    }
    catch (e: unknown) { toast.error(e instanceof Error ? e.message : String(e)); } finally { setDiscLoading(false); }
  };
  const key = (t: { host: string; appName: string; gen: number | null }) => `${t.host}|${t.appName}|${t.gen ?? ''}`;
  const selected = (disc?.targets || []).filter((t) => sel.has(key(t)));
  const surumler = [...new Set((disc?.targets || []).map((t) => t.gen ?? 0))].sort();
  const surumEtiket = (g: number) => (g ? `JBoss ${g}` : 'sürümü bilinmeyen');
  const seciliSurumler = [...new Set(selected.map((t) => t.gen ?? 0))];
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
  const webYokHedefler = (disc?.targets || []).filter((t) => !t.web.length);
  // IN-PLACE (2026-10-26): yalniz BILGI - kaydi acmayi engellemez (create() ve "Kaydı aç" inPlace'e bakmaz).
  const inPlaceSecili = selected.filter((t) => t.inPlace === true).length;
  const secimDegistir = (k: string) => setSel((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const hepsiSecili = !!disc && disc.targets.length > 0 && disc.targets.every((x) => sel.has(key(x)));

  const create = async () => {
    if (!app || !f.smartNo.trim()) { toast.error('Uygulama ve Smart kayıt numarası gerekli.'); return; }
    if (needsOco && !f.ocoNo.trim()) { toast.error('PROD hedef seçili: OCO numarası zorunlu.'); return; }
    if (!selected.length) { toast.error(surumler.length > 1 ? 'Uygulama birden fazla JBoss sürümünde: hangi sürümün retire edileceğini seçin.' : 'En az bir hedef seçin.'); return; }
    // ONAY KUTUSU ZORUNLU, kayit ACILMAZ. Uyariyi yalnizca gostermek, kaydi aciklamadan
    // gecilebilir bir metne cevirirdi; kullanici "soru sorulabilir" dedi.
    if (trafikli.length && !trafikOnay) {
      toast.error('Seçili vhost’larda hâlâ istek var — devam etmek için onay kutusunu işaretleyin.');
      return;
    }
    setBusy(true);
    try {
      const r = await retirementApi.create({ app, smartNo: f.smartNo.trim(), ocoNo: f.ocoNo.trim() || undefined, ownerEmail: f.ownerEmail.trim() || undefined, deleteAfterDays: Number(f.deleteAfterDays) || defaultDays, plannedDeleteAt: f.plannedDeleteAt || null, dnsReuse: f.dnsReuse, lbReuse: f.lbReuse, notes: f.notes, targets: selected.map((t) => ({ host: t.host, appName: t.appName, gen: t.gen })) });
      if (!r.ok) { toast.error(r.message || 'Kayıt açılamadı.'); return; }
      toast.success(`Retirement kaydı #${r.id} açıldı (${selected.length} hedef).`); onCreated(r.id);
    } catch (e: unknown) { toast.error(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };

  const etiket = { color: 'var(--text-secondary)' };
  return (
    <Modal open onClose={onClose} title="Yeni retirement kaydı" subtitle="Smart silme kaydı (364244_Delete_6) geldikten sonra açılır; PROD için altyapı OCO'su gerekir." icon={TrashIcon} size="wide"
      footer={
        <div className="flex w-full flex-wrap items-center gap-x-3 gap-y-1">
          <span className="text-[12px] tabular-nums" style={{ color: 'var(--text-secondary)' }}><b style={{ color: 'var(--text-primary)' }}>{selected.length}</b> hedef seçili{seciliSurumler.length ? ` · ${seciliSurumler.map(surumEtiket).join(' + ')}` : ''}{needsOco ? ' · PROD var: OCO zorunlu' : ''}</span>
          {inPlaceSecili > 0 && <span className="text-[12px] font-semibold" style={{ color: 'var(--status-warning-text)' }}>{inPlaceSecili} in-place hedef — uyarıya bakın</span>}
          {trafikli.length > 0 && !trafikOnay && <span className="text-[12px] font-semibold" style={{ color: 'var(--status-danger-text)' }}>Trafik onayı bekleniyor</span>}
          <span className="ml-auto" />
          <button type="button" onClick={onClose} className={SM_BTN} style={smBtn()}>İptal</button>
          <button type="button" disabled={busy || !disc} onClick={create} className={SM_BTN} style={smBtn(true)}>Kaydı aç</button>
        </div>
      }>
      <div className="space-y-3">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          <div className="relative">
            <label htmlFor="rt-cm-uygulama" className="text-[11px] font-semibold" style={etiket}>Uygulama (taban ad; -D/-T/-Q ortamları otomatik)</label>
            <input id="rt-cm-uygulama" value={q} onChange={(e) => { setQ(e.target.value); setApp(''); setDisc(null); }} placeholder="CRM" className={INPUT} style={inputStyle} autoFocus />
            {apps.length > 0 && !app && (
              <ul className="absolute z-10 mt-1 w-full max-h-48 overflow-auto rounded-lg border shadow-sm text-xs" style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)' }}>
                {apps.map((a) => <li key={a}><button onClick={() => pick(a)} className="w-full text-left px-2.5 py-1.5 hover:bg-[var(--bg-elevated)]">{a}</button></li>)}
              </ul>
            )}
          </div>
          <div><label htmlFor="rt-cm-smart" className="text-[11px] font-semibold" style={etiket}>Smart silme kaydı no *</label><input id="rt-cm-smart" value={f.smartNo} onChange={(e) => setF({ ...f, smartNo: e.target.value })} className={INPUT} style={inputStyle} placeholder="364244…" /></div>
          <div><label htmlFor="rt-cm-oco" className="text-[11px] font-semibold" style={etiket}>Altyapı OCO no {needsOco ? '*' : '(prod ise)'}</label><input id="rt-cm-oco" value={f.ocoNo} onChange={(e) => setF({ ...f, ocoNo: e.target.value })} className={INPUT} style={inputStyle} /></div>
          <div><label htmlFor="rt-cm-sahip" className="text-[11px] font-semibold" style={etiket}>Uygulama sahibi e-posta</label><input id="rt-cm-sahip" value={f.ownerEmail} onChange={(e) => setF({ ...f, ownerEmail: e.target.value })} className={INPUT} style={inputStyle} /></div>
          <div><label htmlFor="rt-cm-gun" className="text-[11px] font-semibold" style={etiket}>Silme: stop'tan kaç gün sonra</label><input id="rt-cm-gun" type="number" min={1} value={f.deleteAfterDays} onChange={(e) => setF({ ...f, deleteAfterDays: e.target.value })} className={INPUT} style={inputStyle} /></div>
          <div><label htmlFor="rt-cm-tarih" className="text-[11px] font-semibold" style={etiket}>…ya da kesin silme tarihi (isteğe bağlı)</label><input id="rt-cm-tarih" type="date" value={f.plannedDeleteAt} onChange={(e) => setF({ ...f, plannedDeleteAt: e.target.value })} className={INPUT} style={inputStyle} /></div>
          <label className="flex items-center gap-2 text-xs" style={{ color: 'var(--text-secondary)' }}><input type="checkbox" checked={f.dnsReuse} onChange={(e) => setF({ ...f, dnsReuse: e.target.checked })} /> DNS kullanılmaya devam edecek (DNS silme kaydı açılmaz)</label>
          <label className="flex items-center gap-2 text-xs" style={{ color: 'var(--text-secondary)' }}><input type="checkbox" checked={f.lbReuse} onChange={(e) => setF({ ...f, lbReuse: e.target.checked })} /> LB kullanılmaya devam edecek (member güncelleme kaydı)</label>
          <div className="md:col-span-2 xl:col-span-3"><label htmlFor="rt-cm-not" className="text-[11px] font-semibold" style={etiket}>Not</label><textarea id="rt-cm-not" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} rows={2} className={INPUT} style={inputStyle} /></div>
        </div>

        {!disc && !discLoading && <p className="text-[12px] leading-5" style={{ color: 'var(--text-secondary)' }}>Uygulamanın taban adını yazıp listeden seçin; tüm ortam ve iki sitedeki sunucular burada listelenir.</p>}
        {discLoading && (
          <div aria-busy="true" className="space-y-1.5">
            <div className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>Envanter taranıyor…</div>
            {[0, 1, 2, 3].map((i) => <div key={i} className="skeleton h-9 rounded-md" />)}
          </div>
        )}
        {disc && (
          <div className="space-y-2">
            {/* ARAC CUBUGU: sayilar. Tumu / hicbiri basliktaki kutuda, surum secimi surum uyarisinda. */}
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[13px] font-semibold tabular-nums" style={{ color: 'var(--text-primary)' }}>{fmtNumber(disc.summary.total)} hedef</span>
              <Sayac etiket="Pendik" n={disc.summary.bySite.Pendik} />
              <Sayac etiket="Ankara" n={disc.summary.bySite.Ankara} ton={disc.summary.bySite.Ankara ? 'uyari' : undefined} />
              {Object.entries(disc.summary.byEnv).filter(([, n]) => n).map(([e, n]) => <Sayac key={e} etiket={e} n={n} ton={e === 'PROD' ? 'hata' : undefined} />)}
              <Sayac etiket="web eşlenen" n={disc.summary.webMatched} />
            </div>
            {/* UYARI YIGINI: once karar isteyenler (surum secimi, trafik onayi), sonra bilgi. */}
            {surumler.length > 1 && (
              <UyariKutusu ton="uyari" rol="alert"
                baslik={`Bu uygulama birden fazla JBoss sürümünde çalışıyor: ${surumler.map((g) => `${surumEtiket(g)} (${disc.targets.filter((t) => (t.gen ?? 0) === g).length} sunucu)`).join(' · ')}`}
                eylem={<>
                  {surumler.map((g) => (
                    <button key={g} type="button" onClick={() => setSel(new Set(disc.targets.filter((t) => (t.gen ?? 0) === g).map(key)))} className={TBL_BTN} style={smBtn(seciliSurumler.length === 1 && seciliSurumler[0] === g)}>
                      Yalnız {surumEtiket(g)}
                    </button>
                  ))}
                  <button type="button" onClick={() => setSel(new Set(disc.targets.map(key)))} className={TBL_BTN} style={smBtn(seciliSurumler.length === surumler.length)}>Hepsi</button>
                </>}>
                <p>Hangisinin retire edileceğini seçin — hiçbir hedef ön seçili değil. Göç döneminde eski sürüm kapatılırken yenisi çalışmaya devam ediyor olabilir.</p>
                {seciliSurumler.length > 1 && <p className="font-semibold" style={{ color: 'var(--status-danger-text)' }}>Seçimde birden fazla sürüm var: {seciliSurumler.map(surumEtiket).join(' + ')}.</p>}
              </UyariKutusu>
            )}
            {/* IN-PLACE (2026-10-26, kullanici: "Hicbir sey engellemesin ama insanlar yine de bilincinde olsun"). Surum
                kutusundan HEMEN sonra (ikisi de ayni sunucudaki kurulumlar); kalin sol cizgi + IN-PLACE cipiyle ayrisir. */}
            <InPlaceUyari hedefler={selected} />
            {/* HALA ISTEK VAR MI? Apache/IHS access log'undan, hc HARIC (Server Hub
                taramasi: dbo.Server_Hub_Vhosts). Olculemeyenler AYRI kutuda. */}
            {trafikli.length > 0 && (
              <UyariKutusu ton="hata" baslik={`Dikkat: seçili ${trafikli.length} vhost’ta hâlâ istek var (health-check hariç)`}
                eylem={
                  <label className="flex cursor-pointer items-start gap-2 text-[12px] leading-5" style={{ color: 'var(--text-primary)' }}>
                    <input type="checkbox" checked={trafikOnay} onChange={(e) => setTrafikOnay(e.target.checked)} className="mt-1 accent-[var(--accent)]" />
                    <span>İstek olmasına rağmen retirement prosedürüne <b>devam etmek istiyorum</b></span>
                  </label>
                }>
                <ul className="font-mono text-[11px] leading-4" style={{ color: 'var(--text-secondary)' }}>
                  {trafikli.slice(0, 6).map(({ t, w }, i) => {
                    const m = `${w.serverName} @ ${w.host} — ${w.trafik?.sampled ? 'en az ' : ''}${fmtNumber(w.trafik?.req7)} istek / 7 gün${w.trafik?.req24 != null ? ` · 24s ${fmtNumber(w.trafik.req24)}` : ''}`;
                    return <li key={`uy-${key(t)}-${webKey(w, i)}`} className="truncate" title={m}>{m}</li>;
                  })}
                  {trafikli.length > 6 && <li>… +{trafikli.length - 6} vhost</li>}
                </ul>
              </UyariKutusu>
            )}
            {/* WEB BULUNAMADI (2026-10-12): 3-tier uygulamada web katmani sessizce atlaniyordu. */}
            {webYokHedefler.length > 0 && (
              <UyariKutusu ton="hata" rol="alert" baslik={`${webYokHedefler.length} hedefte web vhost’u BULUNAMADI`}>
                <p>
                  Retirement bu hedeflerin vhost’unu <b>kapatmaz</b> ve trafiğini kontrol edemez. 3-tier uygulamalarda web sunucusu
                  ad kuralıyla aranır (5. harf A→W, ayrıca son harf P; Pendik 6 harf: GOJBAB03 → GOJBWP03, Ankara 7 harf: DACRAAB01 → DACRWAP01); aday sunucu Server Hub taramasında
                  ya da sertifika envanterinde yoksa bulunamaz. Devam etmeden önce web sunucusunu elle doğrulayın.
                </p>
                <ul className="mt-1 space-y-0.5 font-mono text-[11px] leading-4" style={{ color: 'var(--text-secondary)' }}>
                  {webYokHedefler.slice(0, 6).map((t) => {
                    const m = `${t.host} · ${t.appName}: ${t.webUyari || ''}`;
                    return <li key={key(t)} className="truncate" title={m}>{m}</li>;
                  })}
                  {webYokHedefler.length > 6 && <li>… +{webYokHedefler.length - 6} hedef</li>}
                </ul>
              </UyariKutusu>
            )}
            {trafikOlculemedi.length > 0 && (
              <UyariKutusu ton="uyari" baslik={<>{trafikOlculemedi.length} vhost’un trafiği <b>ölçülemedi</b> — bu “istek yok” DEMEK DEĞİL.</>}>
                {disc.summary.trafik?.okunamadi
                  ? `Server Hub vhost tablosu okunamadı: ${disc.summary.trafik.okunamadi}`
                  : 'Server Hub taramasında log okunamamış olabilir (izin, bütçe ya da log formatı); durdurmadan önce sunucuda doğrulayın.'}
              </UyariKutusu>
            )}
            {/* TABLO: >=1280px'te kap kaydirma kabi degil (xl:overflow-clip), baslik Modal govdesine yapisir. */}
            <div className="rounded-lg border overflow-auto max-h-[calc(100dvh-16rem)] xl:overflow-clip xl:max-h-none" style={{ borderColor: 'var(--border-subtle)' }}>
              <table className="pf-table-sticky w-full min-w-[60rem] table-fixed border-collapse" aria-label="Keşfedilen hedefler">
                <TabloIskelet kolonlar={CM_KOLONLAR} secimBasligi={
                  <input type="checkbox" className="accent-[var(--accent)]" aria-label="Tüm hedefleri seç" checked={hepsiSecili}
                    ref={(el) => { if (el) el.indeterminate = sel.size > 0 && !hepsiSecili; }}
                    onChange={(e) => setSel(e.target.checked ? new Set(disc.targets.map(key)) : new Set())} />
                } />
                <tbody className="text-[12px]" style={{ color: 'var(--text-primary)' }}>
                  {disc.targets.length === 0 ? <TableEmptyRow colSpan={CM_KOLONLAR.length} title="Envanterde bu uygulama için sunucu yok." description="Taban adı (-D/-T/-Q eki olmadan) yazıldı mı?" /> : disc.targets.map((t) => (
                    <tr key={key(t)} className="border-t align-top cursor-pointer" style={{ borderColor: 'var(--border-subtle)', background: sel.has(key(t)) ? SECILI_ZEMIN : undefined }}
                      onClick={(e) => { if ((e.target as HTMLElement).closest('input,button,a,label') || window.getSelection()?.toString()) return; secimDegistir(key(t)); }}>
                      <td className="pl-2.5 pr-0 py-1.5" style={sel.has(key(t)) ? { boxShadow: 'inset 2px 0 0 var(--accent)' } : undefined}>
                        <div className="h-5 flex items-center"><input type="checkbox" className="accent-[var(--accent)]" aria-label={`${t.host} · ${t.appName} hedefini seç`} checked={sel.has(key(t))} onChange={() => secimDegistir(key(t))} /></div>
                      </td>
                      <td className="px-2.5 py-1.5"><HedefHucresi h={t} /></td>
                      <td className="px-2.5 py-1.5">
                        <div className="flex min-w-0 text-[11px] leading-5 break-words"><HubHucresi hub={t.hub} okunamadi={hubYok} /></div>
                        <div className="text-[11px] leading-4 truncate" style={{ color: 'var(--text-secondary)' }} title={`MWAppsInventory durumu: ${t.inventoryStatus || 'yok'}`}>envanter: {t.inventoryStatus || '—'}</div>
                      </td>
                      <td className="px-2.5 py-1.5">
                        {t.web.length
                          ? <WebVhostListesi web={t.web} ipucu={t.webHow} sag={(s) => <TrafikHucresi tr={s.trafik} />} />
                          : <div className="text-[11px] leading-4 font-semibold line-clamp-2" style={{ color: 'var(--status-danger-text)' }} title={[t.webUyari, t.webHow].filter(Boolean).join('\n')}>⚠ {t.webUyari || 'web vhost’u bulunamadı — elle doğrulayın'}</div>}
                      </td>
                      <td className="px-2.5 py-1.5"><PaketHucresi yol={t.appPath} /></td>
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
  // STOP ONAY PENCERESI: bir ya da (TOPLU) birden fazla hedef - hepsi TEK iste durdurulur.
  const [ask, setAsk] = useState<{ ts: RtTarget[] } | null>(null);
  // TOPLU SECIM (2026-10-08, kullanici: "2 ya da 4 sunucuyu ayni anda sectim; hepsi icin ayri
  // ayri job tetiklemek istemiyorum, tek seferde calistiralim ve SCC'ye tek e-posta gitsin").
  const [secim, setSecim] = useState<Set<number>>(new Set());
  // PROD STOP ZAMANI (2026-10-09): varsayilan OCO penceresine zamanla; "simdi" yalniz acik secimle.
  const [stopZamani, setStopZamani] = useState<'oco' | 'simdi'>('oco');
  const [geriAl, setGeriAl] = useState<{ t: RtTarget } | null>(null);
  // GERI ALMA ON KONTROLU BEKLEYENLER (2026-10-22): "Geri aktif et" once on kontrolu baslatir; bitince
  // onay penceresi BU oturumda baslatilan hedef icin kendiliginden acilir (STOP'taki onayBekleyen gibi).
  // Bekleyen = (hedef, baslatilan on kontrol isi): pencere YALNIZ o isin sonucu geldiginde acilir (eski kayit
  // eski bir listeyi ya da yanlis "basarisiz" bildirimini getirmesin).
  const geriAlBekleyen = useRef<{ tid: number; jobId: number | null }[]>([]);
  // SILME ON KONTROLU LISTESI (2026-10-22): durdurulmus hedefin "neyin silinecegi" listesi.
  const [silmeListe, setSilmeListe] = useState<number | null>(null);
  const [iptalSor, setIptalSor] = useState(false);
  // BEKLEMEYI ATLA (admin): silme tarihini bugune ceker; onay icin uygulama adi yazilir.
  // HEDEF BASINA (2026-10-12): hangi sunucunun beklemesi atlanacak.
  const [atlaSor, setAtlaSor] = useState<RtTarget | null>(null);
  // TOPLU (kayit duzeyi) beklemeyi atla da KALIR (kullanici 2026-10-12: "toplu da kalsin, sunucu bazli da").
  const [atlaTopluSor, setAtlaTopluSor] = useState(false);
  // WEB KESFINI YENILE (2026-10-13): kayit acilirken dondurulan web listesi bugunku kesifle tamamlanir.
  type WebKesifSonuc = Awaited<ReturnType<typeof retirementApi.webKesif>>;
  const [webKesif, setWebKesif] = useState<WebKesifSonuc | null>(null);
  // HEDEFI KAYITTAN CIKAR (2026-10-13): istem disi kayda giren (ornegin JBoss 8) ve henuz dokunulmamis hedef.
  const [cikarSor, setCikarSor] = useState<RtTarget | null>(null);
  const [cikarNeden, setCikarNeden] = useState('');
  const [uzlastir, setUzlastir] = useState<RtTarget | null>(null);
  const [uzlastirJob, setUzlastirJob] = useState('');
  const cikarilabilir = (t: RtTarget) => ['pending', 'planned', 'failed', 'stop_scheduled', 'active'].includes(t.status) && !(t.status === 'failed' && (t.webSonuc || []).some((w) => w.status === 'ok'));
  const hedefCikar = async () => {
    if (!cikarSor) return;
    const r = await retirementApi.cikar(id, cikarSor.id, cikarNeden.trim());
    if (!r.ok) { toast.error(r.message || 'Hedef çıkarılamadı.'); return; }
    if (r.record) setRec(r.record);
    toast.success(`${cikarSor.host} kayıttan çıkarıldı.`);
    setCikarSor(null); setCikarNeden('');
  };
  const [webKesifBusy, setWebKesifBusy] = useState(false);
  const webKesifCalistir = async (uygula: boolean) => {
    setWebKesifBusy(true);
    try {
      const r = await retirementApi.webKesif(id, uygula);
      if (!r.ok) { toast.error(r.message || 'Web keşfi yenilenemedi.'); return; }
      if (uygula) {
        if (r.record) setRec(r.record);
        setWebKesif(null);
        toast.success(r.eklenenToplam ? `${r.eklenenToplam} vhost kayda eklendi.` : 'Eklenecek yeni vhost yoktu.');
      } else setWebKesif(r);
    } catch (e: unknown) { toast.error(e instanceof Error ? e.message : String(e)); }
    finally { setWebKesifBusy(false); }
  };
  const [atlaAd, setAtlaAd] = useState('');
  // Zamanlayici araligi bilgilendirme metni icin (sunucu ayari; okunamazsa genel metin).
  const [cfgSaat, setCfgSaat] = useState<{ poll: number | null }>({ poll: null });
  useEffect(() => {
    retirementApi.config().then((c) => { if (c.ok) setCfgSaat({ poll: c.pollSeconds ?? null }); }).catch(() => {});
  }, []);
  // AYRINTI SATIRI (2026-10-26): tiklanan hedefin ALTINDA tek acik satir, sekmeler Akış | İş çıktısı. `ipucu`
  // hangi isin secilecegini soyler (#is no, web cipi, "Canlı çıktıyı izle"); ipucusuz ayni tiklama kapatir.
  const [ayrinti, setAyrinti] = useState<{ tid: number; sekme: AyrintiSekme; ipucu?: IsIpucu } | null>(null);
  const ayrintiAc = (tid: number, sekme: AyrintiSekme, ipucu?: IsIpucu) =>
    setAyrinti((a) => (a && a.tid === tid && a.sekme === sekme && !ipucu ? null : { tid, sekme, ipucu }));
  const ciktiAc = (t: RtTarget, ipucu?: IsIpucu) => ayrintiAc(t.id, 'cikti', ipucu ?? {});
  const acikTid = ayrinti?.tid;
  const acikSekme = ayrinti?.sekme;
  useEffect(() => { if (acikTid != null) document.getElementById(`rt-ayrinti-${acikTid}`)?.scrollIntoView?.({ block: 'nearest' }); }, [acikTid, acikSekme]);
  // Bitmis islerin ciktisi pencere omru boyunca (sekme / satir degisince yeniden indirilmez).
  const [ciktiOnbellegi] = useState<CiktiOnbellegi>(() => new Map());
  const [hubDurum, setHubDurum] = useState<StopHubDurumu>('denetleniyor');
  const hubIstek = useRef(0);
  // ON KONTROLDE TAZE TRAFIK (2026-10-08): hedef basina Server Hub tarama isi; onay penceresi
  // kesifi okur ve tarama bitince YENIDEN okur. Ayrinti: retirementTrafik.ts.
  const [askDisc, setAskDisc] = useState<RtDiscovery | null>(null);
  const [vhostPlanlar, setVhostPlanlar] = useState<Record<number, VhostPlanDurumu[]>>({});
  const [webSor, setWebSor] = useState<{ t: RtTarget } | null>(null);
  const [trafikIs, setTrafikIs] = useState<Record<number, { durum: TrafikIsDurumu; jobId?: number | null; mesaj?: string; bitti?: string }>>({});
  const [trafikOnay, setTrafikOnay] = useState(false);
  const [olcumuBekleme, setOlcumuBekleme] = useState(false);
  const askRef = useRef<{ ts: RtTarget[] } | null>(null);
  useEffect(() => { askRef.current = ask; }, [ask]);

  // KUYRUK GORUNUMU (2026-10-12): zamanlayicinin sonraki turu + suren islerin AWX durumu.
  const [kuyruk, setKuyruk] = useState<{ zamanlayici?: RtZamanlayici; isler?: RtIsler }>({});
  const load = useCallback(async () => {
    try { const r = await retirementApi.get(id); if (r.ok) { setRec(r.record); setKuyruk({ zamanlayici: r.zamanlayici, isler: r.isler }); setErr(''); } else setErr(r.message || 'Kayıt alınamadı.'); }
    catch (e: unknown) { setErr(e instanceof Error ? e.message : String(e)); }
  }, [id]);
  useEffect(() => { load(); }, [load]);
  // IN-PLACE (2026-10-26): isaret kayitla saklanir (RtTarget.inPlace). Bu alandan ONCE acilmis kayitta null:
  // bugunku kesiften BIR kez, tembel hesaplanir (host|uygulama|surum). Kesif duserse bilgi "bilinmiyor" kalir.
  const [ipKesif, setIpKesif] = useState<InPlaceHarita | null>(null);
  const ipIstendi = useRef(false);
  const ipGerek = !!rec && rec.targets.some((t) => t.inPlace == null && !t.deletedAt && t.status !== 'skipped');
  const recApp = rec?.app;
  useAsyncEffect(async (alive) => {
    if (!ipGerek || !recApp || ipIstendi.current) return;
    ipIstendi.current = true;
    try {
      const d = await retirementApi.discover(recApp);
      if (alive()) setIpKesif(inPlaceHaritasi(d));
    } catch { /* kesif dustu: in-place bilinmiyor kalir, ekran calisir */ }
  }, [ipGerek, recApp]);
  // CANLI TAZELEME (2026-10-09): suren is ya da bekleyen/suren vhost isi varken 4 sn'de bir /canli
  // (o uc bekleyen vhost islerini de baslatir ve sonuclarini okur). Is yokken istek atilmaz.
  const canliGerek = !!rec && rec.targets.some((t) => hedefTazelenmeli(t, rec.deleteNowAt));
  useEffect(() => {
    if (!canliGerek) return;
    const z = window.setInterval(() => {
      retirementApi.canli(id).then((r) => { if (r.ok && r.record) { setRec(r.record); setKuyruk({ zamanlayici: r.zamanlayici, isler: r.isler }); } }).catch(() => {});
    }, 4000);
    return () => window.clearInterval(z);
  }, [canliGerek, id]);

  // TEK DUGMELI AKIS (2026-10-08): "Retirement'i baslat" on kontrolu baslatir; on kontrol
  // BASARIYLA bitince onay penceresi KENDILIGINDEN acilir (2. adim). Yalniz bu oturumda
  // baslatilan hedef icin: sayfayi yeniden acan birinin onune pencere firlamasin.
  // Basarisizsa pencere ACILMAZ - geri alinamaz adim yalniz basarili on kontrolden sonra.
  const onayBekleyen = useRef<number[] | null>(null);

  // STOP onayi acilinca Server Hub kesifle yeniden okunur; yalniz SON istegin yaniti yazilir.
  const stopSor = (ts: RtTarget[]) => {
    if (!rec || !ts.length) return;
    setAsk({ ts });
    setStopZamani('oco');
    setAskDisc(null); setTrafikOnay(false); setOlcumuBekleme(false);
    setHubDurum('denetleniyor');
    const no = ++hubIstek.current;
    retirementApi.discover(rec.app)
      .then((d) => { if (hubIstek.current === no) { setHubDurum(stopHubDurumu(d)); setAskDisc(d); } })
      .catch(() => { if (hubIstek.current === no) setHubDurum('okunamadi'); });
  };
  useEffect(() => {
    const tids = onayBekleyen.current;
    if (!rec || !tids) return;
    const ts = tids.map((tid) => rec.targets.find((x) => x.id === tid)).filter((x): x is RtTarget => !!x);
    if (!ts.length || ts.some((t) => t.status === 'planning')) return;
    onayBekleyen.current = null;
    // TOPLU: biri dustuyse sebebi soylenir; basarili olanlar icin pencere yine acilir (onlar tek iste durdurulur).
    for (const t of ts.filter((x) => x.status !== 'planned'))
      toast.error(`${t.appName} @ ${t.host}: ön kontrol başarısız — ${t.resultText || t.planText || 'ayrıntı için Olaylar / iş çıktısı'}`);
    const hazir = ts.filter((x) => x.status === 'planned');
    if (hazir.length) stopSor(hazir);
    // stopSor her render'da yeniden tanimlaniyor; tetik YALNIZ kayit degisimi.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rec]);

  // VHOST PLAN ISLERI: STOP on kontrolu VE web yeniden deneme onizlemesi ayni izleyiciyi kullanir.
  const vhostPlanIzle = (t: RtTarget, vp: RtLaunch['vhostPlan'] | undefined) => {
    if (vp && vp.length) {
      const ilk: VhostPlanDurumu[] = vp.map((v) => ({
        host: v.host, serverName: v.serverName, confFile: v.confFile, jobId: v.jobId ?? null,
        durum: v.ok ? 'suruyor' : v.elle ? 'elle' : 'hata',
        mesaj: v.ok ? undefined : v.message,
      }));
      setVhostPlanlar((m) => ({ ...m, [t.id]: ilk }));
      vp.forEach((v, i) => {
        if (!v.ok || !v.jobId) return;
        let bitti3 = false;
        addJob({
          title: `Retirement: vhost planı ${v.serverName} @ ${v.host}`,
          fetchStatus: async () => {
            const s = await retirementApi.jobStatus(id, t.id, v.awxServerId as number, v.jobId as number);
            if (!s.ok) throw new Error(s.message || 'Durum okunamadı.');
            if (TERMINAL.has(s.status) && !bitti3) {
              bitti3 = true;
              const sonuc = sonucAyristir(s.fixResult?.line);
              const hazir = sonuc.durum === 'PLAN';
              setVhostPlanlar((m) => {
                const l = [...(m[t.id] || ilk)];
                l[i] = { ...l[i], durum: hazir ? 'hazir' : 'hata', mesaj: sonuc.mesaj, satirlar: hazir ? blokAyristir(s.fixResult?.blok) : undefined, jk: jkAyristir(s.fixResult?.jk), jkdeg: jkDegAyristir(s.fixResult?.jkdeg), kip: kipAyristir(s.fixResult?.kip) };
                return { ...m, [t.id]: l };
              });
            }
            return { status: s.status, output: s.output || '', result: s.result };
          },
        });
      });
    }
  };
  // STOP / ON KONTROL: bir ya da birden fazla hedef TEK iste. Toplu iste is BIR, ama her hedef
  // kendi sonucuyla sonuclanir: is bitince her hedefin job-status'u ayri okunur.
  const stopCalistir = async (ts: RtTarget[], confirmed: boolean, simdiCalistir = false) => {
    if (!ts.length) return;
    const coklu = ts.length > 1;
    const etiket = coklu ? `${ts[0].appName} @ ${ts.map((x) => x.host).join(', ')}` : `${ts[0].appName} @ ${ts[0].host}`;
    setBusy(ts[0].id); setAsk(null);
    try {
      const r = coklu ? await retirementApi.stopToplu(id, ts.map((x) => x.id), confirmed, simdiCalistir) : await retirementApi.stop(id, ts[0].id, confirmed, simdiCalistir);
      if (!r.ok) { toast.error(r.message || 'İş başlatılamadı.'); return; }
      if (r.sccWarning) toast.error(r.sccWarning);
      if (r.scheduled) { toast.success(`STOP OCO penceresine zamanlandı${r.runAtText ? `: ${r.runAtText}` : ''}${coklu ? ` — ${ts.length} sunucu tek işte` : ''}.`); setSecim(new Set()); await load(); return; }
      const kac = coklu ? ` — ${ts.length} sunucu tek işte${confirmed ? ', SCC’ye tek mail' : ''}` : '';
      toast.success(confirmed ? `STOP işi başladı (#${r.jobId})${kac}.` : `Ön kontrol başladı (#${r.jobId})${kac} — bitince onay penceresi açılacak.`);
      if (!confirmed) onayBekleyen.current = ts.map((x) => x.id);
      setSecim(new Set());
      // WEB TRAFIGI TAZELEME ISI: baslatilamadiysa sebep pencereye tasinir (on kontrol DUSMEZ).
      const tt = !confirmed ? r.trafikTarama : null;
      if (tt && tt.ok && tt.jobId) {
        setTrafikIs((m) => ({ ...m, ...Object.fromEntries(ts.map((x) => [x.id, { durum: 'suruyor' as TrafikIsDurumu, jobId: tt.jobId }])) }));
        let bitti2 = false;
        addJob({
          title: `Retirement: trafik ölçümü ${ts[0].appName} (${tt.hosts.join(', ')})`,
          fetchStatus: async () => {
            const s = await retirementApi.jobStatus(id, ts[0].id, tt.awxServerId as number, tt.jobId as number);
            if (!s.ok) throw new Error(s.message || 'Durum okunamadı.');
            if (TERMINAL.has(s.status) && !bitti2) {
              bitti2 = true;
              const son = { durum: (s.status === 'successful' ? 'bitti' : 'hata') as TrafikIsDurumu, jobId: tt.jobId, mesaj: s.status === 'successful' ? undefined : `Server Hub taraması ${s.status}`, bitti: new Date().toISOString() };
              setTrafikIs((m) => ({ ...m, ...Object.fromEntries(ts.map((x) => [x.id, son])) }));
              // Pencere bu hedef(ler) icin aciksa kesif TAZE veriyle yeniden okunur.
              if (askRef.current?.ts.some((a) => ts.some((x) => x.id === a.id)) && rec) retirementApi.discover(rec.app).then(setAskDisc).catch(() => {});
            }
            return { status: s.status, output: s.output || '', result: s.result };
          },
        });
      } else if (tt && !tt.ok) {
        setTrafikIs((m) => ({ ...m, ...Object.fromEntries(ts.map((x) => [x.id, { durum: 'hata' as TrafikIsDurumu, mesaj: tt.message }])) }));
      }
      // KAPATILACAK VHOST BLOKLARI: vhost basina plan isi izlenir, bitince blok okunur.
      if (!confirmed) for (const x of ts) vhostPlanIzle(x, coklu ? r.vhostPlanlar?.[x.id] ?? null : r.vhostPlan);
      let done = false;
      addJob({
        title: `Retirement: ${confirmed ? 'STOP' : 'ön kontrol'} ${etiket}`,
        fetchStatus: async () => {
          const s = await retirementApi.jobStatus(id, ts[0].id, r.awxServerId, r.jobId as number);
          if (!s.ok) throw new Error(s.message || 'Durum okunamadı.');
          if (TERMINAL.has(s.status) && !done) {
            done = true;
            // Diger hedefler de KENDI sonuclariyla sonuclanir (ayni is, sunucu basina sonuc).
            await Promise.all(ts.slice(1).map((x) => retirementApi.jobStatus(id, x.id, r.awxServerId, r.jobId as number).catch(() => null)));
            load();
          }
          return { status: s.status, output: s.output || '', result: s.result };
        },
      });
      await load();
    } catch (e: unknown) { toast.error(e instanceof Error ? e.message : String(e)); } finally { setBusy(null); }
  };
  const stop = (t: RtTarget, confirmed: boolean) => stopCalistir([t], confirmed);
  // ── GERI AL (kullanici, 2026-10-07) ─────────────────────────────────────────────
  // "Uygulamami geri aktif et vs ve yaptigimiz degisiklikler geri alinmali."
  // Hedef 'rolling_back' olur olmaz zamanlanmis SILME devre disi kalir.
  // ON KONTROL (2026-10-22, kullanici: "DELETE ve GERI AL icin de on kontrol listesini yap"): confirmed=false
  // geri alma ON KONTROLUNU baslatir (hicbir sey degismez); bitince onay penceresi listeyle acilir. Onay
  // YALNIZ o listeyi betige gonderir (sunucu da ayni kurali uygular, bir liste bir onaya).
  // Donus: is baslatildi mi (iptal + geri al akisi kac hedefin basladigini durust soylesin).
  const rollback = async (t: RtTarget, confirmed: boolean, onKontrolJobId: number | null = null): Promise<boolean> => {
    setBusy(t.id);
    // Yalniz ONAY penceresi kapanir: on kontrol baslatmak (ornegin iptal + geri al dongusunde) baska bir hedef
    // icin acilmis pencereyi kapatmaz.
    if (confirmed) setGeriAl(null);
    try {
      const r = await retirementApi.rollback(id, t.id, confirmed, onKontrolJobId);
      if (!r.ok) { toast.error(r.message || 'İş başlatılamadı.'); return false; }
      if (!confirmed) geriAlBekleyen.current = [...geriAlBekleyen.current.filter((x) => x.tid !== t.id), { tid: t.id, jobId: r.jobId ?? null }];
      toast.success(confirmed ? `Geri alma işi başladı (#${r.jobId}).` : `${t.appName} @ ${t.host}: geri alma ön kontrolü başladı (#${r.jobId}) — bitince onay penceresi açılacak.`);
      // VHOST GERI ACMA SESSIZ KALMAZ: atlanan/hatali girdiler kullaniciya soylenir,
      // yoksa uygulama ayaga kalkar ama onune trafik gelmez ve sebebi gorunmez.
      if (confirmed && r.web) {
        if (r.web.hata) toast.error(`${r.web.hata} vhost geri açılamadı — Olaylar listesine bakın.`);
        else if (r.web.denendi) toast.success(`${r.web.denendi} vhost geri açma işi başlatıldı.`);
      }
      let done = false;
      addJob({
        title: `Retirement: ${confirmed ? 'GERİ AL' : 'geri alma ön kontrolü'} ${t.appName} @ ${t.host}`,
        fetchStatus: async () => {
          const st = await retirementApi.jobStatus(id, t.id, r.awxServerId, r.jobId as number);
          if (!st.ok) throw new Error(st.message || 'Durum okunamadı.');
          if (TERMINAL.has(st.status) && !done) { done = true; load(); }
          return { status: st.status, output: st.output || '', result: st.result };
        },
      });
      await load();
      return true;
    } catch (e: unknown) { toast.error(e instanceof Error ? e.message : String(e)); return false; } finally { setBusy(null); }
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
  const beklemeyiTopluAtla = async () => {
    if (!rec) return;
    const r = await retirementApi.deleteNow(id, atlaAd);
    if (!r.ok) { toast.error(r.message || 'Silme tarihi çekilemedi.'); return; }
    setAtlaTopluSor(false); setAtlaAd('');
    if (r.record) setRec(r.record);
    toast.success(`Silme tarihi bugüne çekildi. Zamanlayıcı en geç ~${Math.ceil((r.pollSaniye || 300) / 60)} dk içinde ${r.hedefSayisi} hedefi silecek — Olaylar ve hedef durumunu izleyin.`);
  };
  const beklemeyiAtla = async () => {
    if (!rec || !atlaSor) return;
    const t = atlaSor;
    const r = await retirementApi.deleteNowTarget(id, t.id, atlaAd);
    if (!r.ok) { toast.error(r.message || 'Bekleme atlanamadı.'); return; }
    setAtlaSor(null); setAtlaAd('');
    if (r.record) setRec(r.record);
    toast.success(`${t.appName} @ ${t.host}: zamanlayıcı en geç ~${Math.ceil((r.pollSaniye || 300) / 60)} dk içinde YALNIZ bu hedefi silecek — diğer hedefler kendi tarihini bekler.`);
  };
  // WEB ADIMI YENIDEN DENEME ONIZLEMESI (2026-10-08, kullanici: "yeniden denemeye de onizleme ekle"):
  // once yalniz failed/skip vhost'lar icin PLAN isleri; pencere KAPATILACAK blogu gosterir,
  // kuyruga alma yalniz "Onayla ve yeniden dene" ile. Onizleme hicbir seyi degistirmez.
  const webOnizle = async (t: RtTarget) => {
    setBusy(t.id);
    try {
      const r = await retirementApi.webRetryPlan(id, t.id);
      if (!r.ok) { toast.error(r.message || 'Önizleme başlatılamadı.'); return; }
      setVhostPlanlar((m) => ({ ...m, [t.id]: [] }));
      vhostPlanIzle(t, r.vhostPlan);
      setWebSor({ t });
    } catch (e: unknown) { toast.error(e instanceof Error ? e.message : String(e)); } finally { setBusy(null); }
  };
  // WEB ADIMINI YENIDEN DENE (2026-10-08): basarisiz/atlanmis vhost'lar kuyruga geri alinir.
  const webYeniden = async (t: RtTarget) => {
    setWebSor(null);
    setBusy(t.id);
    try {
      const r = await retirementApi.webRetry(id, t.id);
      if (!r.ok) { toast.error(r.message || 'Yeniden denenemedi.'); return; }
      if (r.record) setRec(r.record);
      // ISIN BASLADIGI GORUNUR: onaydan sonra is hemen baslatilir; baslayanlar is panelinde izlenir.
      // Baslamadiysa NEDEN ve ne kadar beklenecegi yazilir - sessiz bekleme yok.
      const nt = r.record?.targets.find((x) => x.id === t.id);
      const kosan = (nt?.webSonuc || []).filter((w) => w.status === 'running' && w.jobId);
      for (const w of kosan) {
        let bitti = false;
        addJob({
          title: `Retirement: web adımı ${w.serverName} @ ${w.host}`,
          fetchStatus: async () => {
            const s = await retirementApi.jobStatus(id, t.id, Number(w.awxServerId ?? 0), w.jobId as number);
            if (!s.ok) throw new Error(s.message || 'Durum okunamadı.');
            if (TERMINAL.has(s.status) && !bitti) { bitti = true; setTimeout(() => { load(); }, 1500); }
            return { status: s.status, output: s.output || '', result: s.result };
          },
        });
      }
      const dk = Math.max(1, Math.ceil((r.pollSaniye || 300) / 60));
      if (r.basladi) toast.success(`${r.basladi} vhost işi başladı (${kosan.map((w) => `#${w.jobId}`).join(', ') || 'iş no bekleniyor'}) — satırdaki ‘İş çıktısı’ndan izleyebilirsiniz.`);
      else if (r.kilitli) toast.success(`${r.adet} vhost kuyrukta: zamanlayıcı şu an çalışıyor, iş bu turda başlar (en geç ~${dk} dk).`);
      else toast.error(`${r.adet} vhost kuyrukta ama iş HENÜZ BAŞLATILAMADI${r.baslatmaHatasi ? `: ${r.baslatmaHatasi}` : ''} — zamanlayıcı en geç ~${dk} dk içinde yeniden dener; Olaylar listesine bakın.`);
    } catch (e: unknown) { toast.error(e instanceof Error ? e.message : String(e)); } finally { setBusy(null); }
  };
  const tazele = async (t: RtTarget) => {
    setBusy(t.id);
    try {
      const r = await retirementApi.refreshStatus(id, t.id);
      if (!r.ok) {
        if (r.jobMissing && orphanUzlastirilabilir(t)) { setUzlastir(t); setUzlastirJob(''); }
        else toast.error(r.message || 'Durum tazelenemedi.');
        return;
      }
      if (r.degisti) {
        toast.success(`${t.appName} @ ${t.host}: ${r.from} → ${r.to}`);
        if (r.record) setRec(r.record); else await load();
      } else {
        toast.success(r.message || 'Durum değişmedi.');
      }
    } catch (e: unknown) { toast.error(e instanceof Error ? e.message : String(e)); } finally { setBusy(null); }
  };
  const jobUzlastir = async () => {
    if (!uzlastir) return;
    const jobId = Number(uzlastirJob);
    if (!Number.isInteger(jobId) || jobId <= 0) { toast.error('Geçerli bir AWX job ID girin.'); return; }
    setBusy(uzlastir.id);
    try {
      const r = await retirementApi.reconcileJob(id, uzlastir.id, jobId);
      if (!r.ok) { toast.error(r.message || 'AWX işi uzlaştırılamadı.'); return; }
      if (r.record) setRec(r.record); else await load();
      toast.success(r.message || `AWX işi #${jobId} hedefe bağlandı.`);
      setUzlastir(null); setUzlastirJob('');
    } catch (e: unknown) { toast.error(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(null); }
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
    // HER HEDEF ICIN SIRAYLA ON KONTROL (2026-10-22): onayli geri alma artik yalniz kendi on kontrolunun
    // listesiyle kosar. Kayit iptal edildigi icin zamanlanmis silme zaten tetiklenmez; her hedefin on
    // kontrolu bitince onay penceresi sirayla acilir.
    let basladi = 0;
    for (const t of durdurulmus) if (await rollback(t, false)) basladi += 1;
    if (basladi === durdurulmus.length) toast.success(`Kayıt iptal edildi. ${basladi} hedef için geri alma ön kontrolü başladı — her biri bitince onay penceresi açılır.`);
    else if (basladi) toast.error(`Kayıt iptal edildi. ${basladi}/${durdurulmus.length} hedef için geri alma ön kontrolü başladı; diğerleri başlatılamadı (yukarıdaki hatalar) — onlar DURDURULMUŞ kaldı.`);
    else toast.error('Kayıt iptal edildi ama hiçbir hedef için geri alma ön kontrolü başlatılamadı — uygulamalar DURDURULMUŞ kaldı.');
    await load();
  };
  // GERI ALMA ON KONTROLU BITTI: hazirsa onay penceresi acilir, basarisizsa sebebi soylenir (bekleyenler sirayla).
  useEffect(() => {
    if (!rec || geriAl || !geriAlBekleyen.current.length) return;
    for (const b of [...geriAlBekleyen.current]) {
      const t = rec.targets.find((x) => x.id === b.tid);
      const k = t?.geriAlOnKontrol;
      // Bu isin sonucu henuz kayitta yok (eski kayit / baska is) ya da suruyor: bekle.
      if (t && (!k || (b.jobId != null && k.jobId !== b.jobId) || onKontrolSuruyor(k))) continue;
      geriAlBekleyen.current = geriAlBekleyen.current.filter((x) => x.tid !== b.tid);
      if (!t) continue;
      if (!geriAlinabilir(t)) { toast.error(`${t.appName} @ ${t.host}: hedef artık geri alınabilir durumda değil (${t.status}) — onay penceresi açılmadı.`); continue; }
      if (geriAlHazir(t)) { setGeriAl({ t }); return; }
      toast.error(`${t.appName} @ ${t.host}: geri alma ön kontrolü başarısız — ${t.geriAlOnKontrol?.mesaj || 'ayrıntı için Olaylar / iş çıktısı'}`);
    }
  }, [rec, geriAl]);
  // SILME ON KONTROLU (elle): hicbir sey silinmez; liste hedef satirinda / pencerede gorunur.
  const silmeOnKontrol = async (t: RtTarget) => {
    setBusy(t.id);
    try {
      const r = await retirementApi.deletePlan(id, t.id);
      if (!r.ok) { toast.error(r.message || 'Silme ön kontrolü başlatılamadı.'); return; }
      if (r.record) setRec(r.record);
      toast.success(`${t.appName} @ ${t.host}: silme ön kontrolü başladı (#${r.jobId}) — hiçbir şey silinmez, liste bitince görünür.`);
      let done = false;
      addJob({
        title: `Retirement: silme ön kontrolü ${t.appName} @ ${t.host}`,
        fetchStatus: async () => {
          const st = await retirementApi.jobStatus(id, t.id, r.awxServerId, r.jobId as number);
          if (!st.ok) throw new Error(st.message || 'Durum okunamadı.');
          if (TERMINAL.has(st.status) && !done) { done = true; await load(); setSilmeListe(t.id); }
          return { status: st.status, output: st.output || '', result: st.result };
        },
      });
    } catch (e: unknown) { toast.error(e instanceof Error ? e.message : String(e)); } finally { setBusy(null); }
  };
  const addNote = async () => { if (!note.trim()) return; const r = await retirementApi.note(id, note.trim()); if (r.ok) { setRec(r.record); setNote(''); } };

  // ── EKRAN SABITLERI (duz; erken return YOK: hook sirasi ve yerlesim bekcileri, RTU5) ──────────
  const kayitKapali = !!rec && (rec.status === 'cancelled' || rec.status === 'deleted');
  const topluUygun = rec ? rec.targets.filter((t) => ['baslat', 'onayla'].includes(retirementAdimi(t.status, kayitKapali).tur)) : [];
  const topluVar = topluUygun.length >= 2;
  const kolonlar = rmKolonlar(topluVar);
  const durumSayilari = rec ? Object.entries(rec.targets.reduce<Record<string, number>>((m, t) => ({ ...m, [t.status]: (m[t.status] || 0) + 1 }), {})) : [];
  const webYok = rec ? rec.targets.filter((t) => !t.web.length && !t.deletedAt).length : 0;
  // Durdurulan = STOP'u bitmis (silinenler dahil); ilerleme cubugu silmeden sonra sifira dusmesin.
  const durdurulan = rec ? rec.targets.filter((t) => ['stopped', 'deleting', 'deleted'].includes(t.status)).length : 0;
  const silinen = rec ? rec.targets.filter((t) => t.status === 'deleted').length : 0;
  const saat = rec?.deleteAt?.saat || '23:00';
  const kg = rec ? kalanGun(rec.effectiveDeleteAt) : null;
  // IN-PLACE: kayittaki isaret; eski kayitta tembel kesif, STOP onayinda onayin kesfi. Diger kurulum da bu
  // kayitta (atlanmamis) hedefse `kayitta`: metin "o da durdurulacak" der, "hala calisiyor mu" DEMEZ.
  const ipHarita = ipKesif ?? inPlaceHaritasi(askDisc);
  const ipOf = (t: RtTarget) => inPlaceBilgisi(t, ipHarita, rec?.targets);

  return (
    <Modal open onClose={onClose} title={rec ? `Retirement #${rec.id} — ${rec.app}` : `Retirement #${id}`} subtitle={rec ? `Smart ${rec.smartNo}${rec.ocoNo ? ` · OCO ${rec.ocoNo}` : ''} · açan ${rec.requestedBy} · ${fmtDateTime(rec.createdAt)}` : undefined} icon={TrashIcon} size="wide"
      footer={<div className="flex items-center gap-2 w-full">{rec && rec.status !== 'cancelled' && rec.status !== 'deleted' && <button onClick={() => setIptalSor(true)} className={SM_BTN} style={{ ...smBtn(), color: 'var(--status-danger-text)', borderColor: 'var(--status-danger)' }}><XMarkIcon className="w-3.5 h-3.5" /> Kaydı iptal et</button>}<span className="ml-auto" /><button onClick={onClose} className={SM_BTN} style={smBtn()}>Kapat</button></div>}>
      <Modal open={!!uzlastir} onClose={() => { setUzlastir(null); setUzlastirJob(''); }} title="Mevcut AWX işini uzlaştır" size="sm"
        footer={<div className="flex justify-end gap-2"><button onClick={() => { setUzlastir(null); setUzlastirJob(''); }} className={SM_BTN} style={smBtn()}>İptal</button><button disabled={busy != null} onClick={jobUzlastir} className={`${SM_BTN} disabled:opacity-50`} style={smBtn(true)}>Doğrula ve bağla</button></div>}>
        <div className="space-y-3 text-[12px]" style={{ color: 'var(--text-secondary)' }}>
          <div role="alert" className="rounded-lg border px-3 py-2" style={{ borderColor: 'var(--status-warning)', background: 'var(--status-warning-bg)' }}>
            Portal job ID’yi kaydedemediği için işin başlayıp başlamadığı bilinmiyor. Bu işlem <b>yeni STOP/DELETE başlatmaz</b>. Yalnız Portal iş geçmişi ve AWX metadata’sı server, template, eylem, hedef ve launch zamanında tam eşleşirse mevcut job ID bağlanır.
          </div>
          <div><b>{uzlastir?.appName}</b> @ <span className="font-mono">{uzlastir?.host}</span> · {uzlastir?.status === 'deleting' ? 'DELETE' : 'STOP'}</div>
          <label className="block font-semibold">AWX job ID
            <input type="number" min={1} value={uzlastirJob} onChange={(e) => setUzlastirJob(e.target.value)} className={`${INPUT} mt-1 font-mono`} style={inputStyle} autoFocus />
          </label>
          <p>AWX iş geçmişindeki numarayı girin. Kanıtlardan biri eksik veya çelişkiliyse claim değişmeden kalır.</p>
        </div>
      </Modal>
      {err && <UyariKutusu ton="hata" rol="alert" baslik="Kayıt okunamadı">{err}</UyariKutusu>}
      {!rec && !err && <div aria-busy="true" className="space-y-2"><span className="sr-only">Kayıt yükleniyor…</span>{[0, 1, 2].map((i) => <div key={i} className="skeleton h-10 rounded-md" />)}</div>}
      {rec && (
        <div className="space-y-3">
          {/* OZET SERIDI: kayit · stop · silme · SCC/DNS/LB. */}
          <dl className="grid gap-px overflow-clip rounded-lg border sm:grid-cols-2 xl:grid-cols-4" style={{ borderColor: 'var(--border-subtle)', background: 'var(--border-subtle)' }}>
            <OzetHucre etiket="Kayıt" alt={`${rec.targets.length} hedef · ${durdurulan} durduruldu${silinen ? ` · ${silinen} silindi` : ''}`}>
              <Hap {...(RSTATUS[rec.status] ?? { label: rec.status, ton: 'notr' as Ton })} nabiz={rec.status === 'stopping'} />
            </OzetHucre>
            <OzetHucre etiket="Stop" alt={`${durdurulan}/${rec.targets.length} hedef durduruldu`}>
              <span>{rec.stopAt ? fmtDateTime(rec.stopAt) : '—'}</span>
              <span role="progressbar" aria-label="Durdurulan hedefler" aria-valuemin={0} aria-valuemax={rec.targets.length} aria-valuenow={durdurulan} className="block h-1 w-full overflow-clip rounded-full" style={{ background: 'var(--bg-inset)' }}>
                <span className="block h-full rounded-full" style={{ width: `${rec.targets.length ? Math.round((durdurulan / rec.targets.length) * 100) : 0}%`, background: 'var(--status-success)' }} />
              </span>
            </OzetHucre>
            <OzetHucre etiket="Silme" alt={rec.plannedDeleteAt ? 'açan belirledi' : undefined}
              eylem={rec.status !== 'cancelled' && rec.status !== 'deleted' && rec.targets.some((t) => t.status === 'stopped' && !t.deletedAt)
                ? <button type="button" onClick={() => { setAtlaAd(''); setAtlaTopluSor(true); }} className={LINK} style={{ color: 'var(--status-danger-text)' }} title="Admin: kaydın silme tarihini bugüne çek — TÜM durdurulmuş hedefler ilk zamanlayıcı turunda silinir">beklemeyi atla — tümü (admin)</button>
                : undefined}>
              <span>{rec.effectiveDeleteAt ? `${fmtDate(rec.effectiveDeleteAt)} ${saat}` : `stop + ${rec.deleteAfterDays} gün, ${saat}`}</span>
              {kg !== null && <Cip ton={kg <= 1 ? 'uyari' : 'notr'}>{kg > 0 ? `${kg} gün kaldı` : kg === 0 ? 'BUGÜN' : 'günü geçti'}</Cip>}
            </OzetHucre>
            <OzetHucre etiket="SCC · DNS · LB" alt={<span className="text-[12px] font-normal">DNS {rec.dnsReuse ? 'kalacak' : 'silinecek'} · LB {rec.lbReuse ? 'kalacak' : 'silinecek'}</span>}>
              {rec.sccNotifiedAt ? 'SCC bilgilendirildi' : 'SCC bekliyor'}
            </OzetHucre>
          </dl>
          {/* SILME NASIL TETIKLENIR (kullanici, 2026-10-08: "zamani geldigini nasil anlayacaksin?"). Ayri bir
              Ansible taramasi YOK: kayit Portal DB'de, Portal'in zamanlayicisi bakar. Ozet satiri kapali da okunur. */}
          {rec.status !== 'cancelled' && rec.status !== 'deleted' && (
            <>
              <details className="group rounded-lg px-3 py-2 text-[11px] leading-4" style={{ background: 'var(--bg-surface)', boxShadow: 'inset 0 0 0 1px var(--border-subtle)', color: 'var(--text-secondary)' }}>
                <summary className="flex cursor-pointer list-none items-center gap-1.5 [&::-webkit-details-marker]:hidden">
                  <InformationCircleIcon className="h-4 w-4 shrink-0" style={{ color: 'var(--accent)' }} aria-hidden />
                  <b style={{ color: 'var(--text-primary)' }}>Silme nasıl başlar?</b>
                  <span className="min-w-0 truncate" title="Zamanlayıcı birkaç dakikada bir bakar; silme günü saatinden sonraki ilk turda başlar, ek onay istenmez, önce silme ön kontrolü koşar">{`zamanlayıcı ${cfgSaat.poll ? `~${Math.round(cfgSaat.poll / 60)} dk’da bir` : 'birkaç dakikada bir'} · silme günü ${saat} (TR) sonrası ilk tur · ek onay yok · önce silme ön kontrolü`}</span>
                  <ChevronDownIcon className="ml-auto h-3.5 w-3.5 shrink-0 transition-transform group-open:rotate-180 motion-reduce:transition-none" aria-hidden />
                </summary>
                <div className="mt-1.5 pl-5">
                  Kayıt Portal veritabanında tutulur; Portal’ın zamanlayıcısı
                  {cfgSaat.poll ? ` ${Math.round(cfgSaat.poll / 60)} dakikada bir` : ' birkaç dakikada bir'} bakar.
                  Durdurulmuş hedeflerin silme günü geldiğinde, o gün <b>{saat} (TR)</b>’den sonraki
                  ilk turda AWX’te silme işi başlatılır — ek onay istenmez. Portal o saatte kapalıysa iş <b>ertesi gece</b>
                  {' '}{saat}’e kalır, gündüze kaymaz.
                  {' '}<b>Silme ön kontrolü:</b> silme saatinden bir saat önce zamanlayıcı neyin silineceğini okur (hiçbir şey
                  silinmez) ve liste hedef satırında görünür; silme <b>yalnız bu listedeki</b> dosya ve JBoss tanımlarını siler,
                  liste dışında bir işlem gerekirse hiçbir şey silmeden durur.
                </div>
              </details>
              {rec.deleteNowAt && <UyariKutusu ton="hata" baslik={`Admin beklemeyi atladı (${fmtDateTime(rec.deleteNowAt)})`}>Saat beklenmez; silme zamanlayıcının ilk turunda başlar.</UyariKutusu>}
            </>
          )}
          {rec.notes && <p className="border-l-2 pl-3 text-[12px] leading-5" style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}>{rec.notes}</p>}

          <RetirementCanli targets={rec.targets} kayitAtladi={rec.deleteNowAt} zamanlayici={kuyruk.zamanlayici} isler={kuyruk.isler} onCikti={(tid, ipucu) => ayrintiAc(tid, 'cikti', ipucu)} />
          {/* HEDEFLER ARAC CUBUGU: durum sayilari + web keşfi. */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 pt-1">
            <h3 className="text-[13px] font-semibold leading-5" style={{ color: 'var(--text-primary)' }}>Hedefler <span className="font-normal tabular-nums" style={{ color: 'var(--text-secondary)' }}>{rec.targets.length}</span></h3>
            {durumSayilari.map(([s, n]) => {
              const d = TSTATUS[s as RtTargetStatus] || { label: s, ton: 'notr' as Ton };
              return <Hap key={s} label={`${d.label} ${n}`} ton={d.ton} />;
            })}
            {rec.status !== 'cancelled' && webYok > 0 && <Cip ton="hata" title="Liste kayıt açılırken donduruldu; “Web keşfini yenile” bugünkü kurallarla tamamlar">⚠ {webYok} hedefte web vhost’u yok</Cip>}
            <span className="ml-auto" />
            {rec.status !== 'cancelled' && (
              <button disabled={webKesifBusy} onClick={() => webKesifCalistir(false)} className={TBL_BTN} style={smBtn()} title="Web keşfini BUGÜNKÜ kurallarla (3-tier adayları, Server Hub, AJP, alt çizgili adlar) yeniden koşturur ve önce neyin ekleneceğini gösterir; onay vermeden hiçbir şey değişmez">
                <ArrowPathIcon className={`w-3.5 h-3.5 ${webKesifBusy ? 'animate-spin motion-reduce:animate-none' : ''}`} aria-hidden /> Web keşfini yenile
              </button>
            )}
          </div>
          {(() => {
            // TOPLU ARAC CUBUGU: yalniz birden fazla uygun hedef varken. Secilenler TEK iste
            // (sunucu ayni kapilari her hedefte uygular; farkli ortam / ayni sunucu reddedilir).
            if (!topluVar) return null;
            const secili = rec.targets.filter((t) => secim.has(t.id));
            const ortamlar = new Set(secili.map((t) => t.env));
            const karisik = ortamlar.size > 1;
            const hepsiHazir = secili.length >= 2 && secili.every((t) => t.status === 'planned');
            const baslatilir = secili.length >= 2 && !karisik && secili.every((t) => ['baslat', 'onayla'].includes(retirementAdimi(t.status, kayitKapali).tur));
            return (
              <div className="flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2 text-[12px]" style={secili.length ? { background: SECILI_ZEMIN, borderColor: 'var(--accent)' } : { background: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }}>
                <b style={{ color: 'var(--text-primary)' }}>Birlikte çalıştır</b>
                <span style={{ color: 'var(--text-secondary)' }}>{secili.length ? `${secili.length} hedef seçili` : 'satırlardan hedef seçin'} — seçilenler tek işte; PROD’da SCC’ye tek mail</span>
                {karisik && <span className="font-semibold" style={{ color: 'var(--status-warning-text)' }}>Farklı ortamlar birlikte çalıştırılamaz ({[...ortamlar].join(', ')})</span>}
                <span className="ml-auto" />
                {[...new Set(topluUygun.map((t) => t.env))].map((env) => (
                  <button key={env} type="button" onClick={() => setSecim(new Set(topluUygun.filter((t) => t.env === env).map((t) => t.id)))} className={LINK} style={{ color: 'var(--accent)' }}>
                    tüm {env} hedeflerini seç
                  </button>
                ))}
                {secili.length > 0 && <button type="button" onClick={() => setSecim(new Set())} className={LINK} style={{ color: 'var(--text-secondary)' }}>temizle</button>}
                <button disabled={busy != null || !baslatilir} onClick={() => stopCalistir(secili, false)} className={TBL_BTN} style={smBtn(true)} title="Seçilen hedeflerde ön kontrol TEK işte — hiçbir şey değişmez; bitince ortak onay penceresi açılır">
                  <ClipboardDocumentCheckIcon className="w-3.5 h-3.5" aria-hidden /> Seçilenlerde Retirement’ı başlat ({secili.length})
                </button>
                <button disabled={busy != null || !hepsiHazir || karisik} onClick={() => stopSor(secili)} className={TBL_BTN} style={smBtn(true)} title={hepsiHazir ? 'Ortak onay penceresi: hepsi tek işte durdurulur (son onay pencerede)' : 'Önce seçilen hedeflerin hepsinde ön kontrol başarıyla bitmeli'}>
                  <StopCircleIcon className="w-3.5 h-3.5" aria-hidden /> Seçilenleri gör ve onayla ({secili.length})
                </button>
              </div>
            );
          })()}
          {/* TABLO: table-fixed + colgroup; >=1280px'te kap kaydirma kabi degil (xl:overflow-clip), baslik
              Modal govdesine yapisir. Ayrinti satiri TIKLANAN satirin ALTINDA, colSpan = kolon sayisi. */}
          <div className="rounded-lg border overflow-auto max-h-[calc(100dvh-16rem)] xl:overflow-clip xl:max-h-none" style={{ borderColor: 'var(--border-subtle)' }}>
            <table className="pf-table-sticky w-full min-w-[64rem] table-fixed border-collapse" aria-label="Retirement hedefleri">
              <TabloIskelet kolonlar={kolonlar} />
              <tbody className="text-[12px]" style={{ color: 'var(--text-primary)' }}>
                {rec.targets.length === 0 ? <TableEmptyRow colSpan={kolonlar.length} title="Bu kayıtta hedef kalmadı." description="Hedefler kayıttan çıkarılmış olabilir; Olaylar listesine bakın." /> : rec.targets.map((t) => {
                  const st = TSTATUS[t.status] || { label: t.status, ton: 'notr' as Ton };
                  const adim = retirementAdimi(t.status, kayitKapali);
                  const isId = t.status === 'deleting' ? t.deleteJobId : t.status === 'rolling_back' ? t.rollbackJobId : t.lastJobId;
                  const isBelirsiz = ['planning', 'stopping', 'deleting', 'rolling_back'].includes(t.status) && !isId;
                  const isVar = (t.awxIsleri || []).length > 0;
                  const canliIs = hedefteCanliIs(t);
                  const acik = ayrinti?.tid === t.id;
                  const secili = secim.has(t.id);
                  const silmeAcik = t.status === 'stopped' && !t.deletedAt && !kayitKapali;
                  const sonuc = t.resultText || t.planText || '';
                  const sonucHata = t.status === 'failed' || t.status === 'rollback_failed';
                  const sa = sonrakiAdim(t, { kayitKapali, kayitIptal: rec.status === 'cancelled', effectiveDeleteAt: rec.effectiveDeleteAt, saat, kayitAtladi: rec.deleteNowAt });
                  const ip = ipOf(t);
                  const ipAsama = ip.inPlace ? inPlaceAsamasi(t) : null;
                  // Is ciktisi girisleri yalniz istenen is LISTEDEYSE: yoksa varsayilan secim baska bir ise duserdi
                  // ("Canlı çıktıyı izle" bitmis on kontrolu acardi, denetim D1-1).
                  const isListede = isId != null && (t.awxIsleri || []).some((x) => x.jobId === isId);
                  const gecisIsi = GECIS.has(t.status) && isId != null && (t.awxIsleri || []).some((x) => x.adim === gecisAdimi(t.status));
                  return (
                    <React.Fragment key={t.id}>
                      <tr data-tid={t.id} className="border-t align-top" style={{ borderColor: 'var(--border-subtle)', background: secili ? SECILI_ZEMIN : acik ? ACIK_ZEMIN : undefined }}>
                        <td className="pl-2.5 pr-0 py-1.5" style={acik || secili ? { boxShadow: 'inset 2px 0 0 var(--accent)' } : undefined}>
                          {topluVar && (adim.tur === 'baslat' || adim.tur === 'onayla') && (
                            <div className="h-5 flex items-center"><input type="checkbox" className="accent-[var(--accent)]" aria-label={`${t.host} birlikte çalıştırılacaklara ekle`} checked={secili}
                              onChange={(e) => setSecim((m) => { const n = new Set(m); if (e.target.checked) n.add(t.id); else n.delete(t.id); return n; })} /></div>
                          )}
                        </td>
                        <td className="px-2.5 py-1.5"><HedefHucresi h={{ ...t, inPlace: ip.inPlace, digerSurumler: ip.digerSurumler }} /></td>
                        <td className="px-2.5 py-1.5">
                          {t.web.length
                            ? <WebVhostListesi web={t.web} sag={(s) => <WebSonucCip l={webSonuclari(t.webSonuc, s.host, s.serverName)} onAc={isVar ? (i) => ciktiAc(t, { adim: 'web', web: i }) : undefined} />} />
                            : <div className="text-[11px] leading-5 font-semibold" style={{ color: 'var(--status-danger-text)' }} title="Keşifte web vhost’u bulunamadı: retirement vhost kapatmaz, web sunucusunu elle doğrulayın">⚠ web bulunamadı — elle doğrulayın</div>}
                        </td>
                        <td className="px-2.5 py-1.5">
                          <div className="flex min-w-0 flex-col items-start gap-1">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <Hap label={st.label} ton={st.ton} nabiz={GECIS.has(t.status)} ikon={t.status === 'active' ? ArrowUturnLeftIcon : undefined} />
                              {isId != null && (isListede
                                ? <button type="button" onClick={() => ciktiAc(t, { jobId: isId })} className={`${LINK} font-mono tabular-nums`} style={{ color: 'var(--accent)' }} title="Bu işin AWX çıktısını aç" aria-label={`AWX iş #${isId} çıktısını aç`}>#{isId}</button>
                                : <span className="font-mono text-[11px] tabular-nums" style={{ color: 'var(--text-secondary)' }}>#{isId}</span>)}
                            </div>
                            <div className="text-[11px] leading-4" style={{ color: sa.ton === 'aksan' ? 'var(--accent)' : sa.ton === 'uyari' ? 'var(--status-warning-text)' : 'var(--text-secondary)', fontWeight: sa.ton === 'notr' ? 400 : 600 }}>{sa.metin}</div>
                            {isBelirsiz && <div className="text-[11px] leading-4 font-semibold" style={{ color: 'var(--status-warning-text)' }}>iş numarası yazılamadı — durum doğrulanamıyor</div>}
                            {sonuc && <SonucMetni metin={sonuc} hata={sonucHata} onCikti={sonucHata && isVar ? () => ciktiAc(t) : undefined} />}
                            {/* IN-PLACE IS SONRASI (yalniz yonlendirme): suren isten sonra / durdurulunca / geri alininca diger kurulumu kontrol et. */}
                            {ipAsama && (
                              <div className="flex flex-wrap items-center gap-x-1.5 text-[11px] leading-4" data-rt-inplace-not>
                                <span className="font-semibold" style={{ color: 'var(--status-warning-text)' }}>{inPlaceSatirNotu(ipAsama, ip.digerSurumler, ip.kayitta)}</span>
                                <button type="button" onClick={() => setAyrinti({ tid: t.id, sekme: 'akis' })} className={LINK} style={{ color: 'var(--accent)' }} aria-controls={`rt-ayrinti-${t.id}`}>kontrol listesi</button>
                              </div>
                            )}
                            {silmeAcik && <SilmeDurumu t={t} onListe={() => setSilmeListe(t.id)} />}
                          </div>
                        </td>
                        <td className="px-2.5 py-1.5">
                          {/* Her ust duzey oge 24px satir (dugme h-6; metin / bag satirlari min-h-6) ve kap -2px: ilk
                              satirin ORTASI diger kolonlarin 20px ilk satiriyla hizali (denetim B14). */}
                          <div className="-mt-0.5 flex min-w-0 flex-col items-start gap-1">
                            {/* TEK BIRINCIL EYLEM, durumdan turetilir (retirementAdim.ts). */}
                            {adim.tur === 'baslat' && (
                              <button disabled={busy != null} onClick={() => stop(t, false)} className={TBL_BTN} style={smBtn(true)} title={adim.ipucu}><ClipboardDocumentCheckIcon className="w-3.5 h-3.5" aria-hidden /> {adim.etiket}</button>
                            )}
                            {adim.tur === 'onayla' && (
                              <>
                                <button disabled={busy != null} onClick={() => stopSor([t])} className={TBL_BTN} style={smBtn(true)} title={adim.ipucu}><StopCircleIcon className="w-3.5 h-3.5" aria-hidden /> {adim.etiket}</button>
                                <button disabled={busy != null} onClick={() => stop(t, false)} className={LINK} style={{ color: 'var(--text-secondary)' }} title="Ön kontrolü yeniden koş (sunucu durumu değişmiş olabilir); hiçbir şey değişmez">ön kontrolü yenile</button>
                              </>
                            )}
                            {adim.tur === 'suruyor' && <span className="inline-flex min-h-6 items-center text-[11px] leading-4" style={{ color: 'var(--text-secondary)' }}>ön kontrol sürüyor… bitince onay penceresi açılır</span>}
                            {gecisIsi && (
                              <button type="button" onClick={() => ciktiAc(t, { adim: gecisAdimi(t.status) })} aria-expanded={acik && ayrinti?.sekme === 'cikti'} aria-controls={`rt-ayrinti-${t.id}`} className={TBL_BTN} style={smBtn(true)}>
                                <span aria-hidden className="h-1.5 w-1.5 rounded-full animate-status-pulse motion-reduce:animate-none" style={{ background: 'var(--text-on-accent)', color: 'var(--text-on-accent)' }} /> Canlı çıktıyı izle
                              </button>
                            )}
                            {/* GECIS DURUMU: tek cikis yolu durumu TAZELEMEK (AWX isini okur, gercek sonucu yazar). */}
                            {['planning', 'stopping', 'rolling_back', 'deleting'].includes(t.status) && (
                              <button disabled={busy != null} onClick={() => tazele(t)} className={TBL_BTN} style={BTN_UYARI} title="AWX işini oku ve gerçek sonucu yaz (okunamazsa hiçbir şey yazılmaz)"><ArrowPathIcon className="w-3.5 h-3.5" aria-hidden /> Durumu tazele</button>
                            )}
                            {t.status === 'stopped' && (t.webSonuc || []).some((w) => w.status === 'failed' || w.status === 'skip') && (
                              <button disabled={busy != null} onClick={() => webOnizle(t)} className={TBL_BTN} style={BTN_UYARI} title="Önce kapatılacak VirtualHost bloklarını gösterir; kuyruğa alma yalnız onayla. Süren işlere dokunmaz"><ArrowPathIcon className="w-3.5 h-3.5" aria-hidden /> Web adımını yeniden dene</button>
                            )}
                            {/* GERI AL: durdurulmus ve HENUZ SILINMEMIS; 'rollback_failed' tekrar denemeye acik. On kontrol once. */}
                            {(t.status === 'stopped' || t.status === 'rollback_failed' || (t.status === 'failed' && (t.webSonuc || []).some((w) => w.status === 'ok'))) && !t.deletedAt && (
                              <div className="flex min-h-6 flex-wrap items-center gap-x-2 gap-y-1">
                                {onKontrolSuruyor(t.geriAlOnKontrol)
                                  ? <span className="text-[11px] leading-4" style={{ color: 'var(--text-secondary)' }}>geri alma ön kontrolü sürüyor… bitince onay penceresi açılır</span>
                                  : <button disabled={busy != null} onClick={() => rollback(t, false)} className={TBL_BTN} style={t.status === 'rollback_failed' ? BTN_BASARI : BTN_BASARI_IKINCIL} title="Önce ön kontrol: hangi paketlerin geri adlandırılacağı, hangi komutların çalışacağı sunucudan okunur (hiçbir şey değişmez); bitince onay penceresi bu listeyle açılır"><ArrowUturnLeftIcon className="w-3.5 h-3.5" aria-hidden /> Geri aktif et</button>}
                                {geriAlHazir(t) && !onKontrolSuruyor(t.geriAlOnKontrol) && (
                                  <button onClick={() => setGeriAl({ t })} className={LINK} style={{ color: 'var(--accent)' }} title="Son geri alma ön kontrolünün listesiyle onay penceresini aç">onay penceresini aç</button>
                                )}
                              </div>
                            )}
                            <div className="flex min-h-6 flex-wrap items-center gap-x-2 gap-y-1 not-first:pt-0.5">
                              {isVar && !gecisIsi && (
                                <button type="button" onClick={() => ayrintiAc(t.id, 'cikti')} aria-expanded={acik && ayrinti?.sekme === 'cikti'} aria-controls={`rt-ayrinti-${t.id}`} className={TBL_BTN} style={smBtn()} title="AWX işinin standart çıktısı (sürüyorsa canlı)">
                                  <CommandLineIcon className="w-3.5 h-3.5" aria-hidden />{canliIs && <span aria-hidden className="h-1.5 w-1.5 rounded-full animate-status-pulse motion-reduce:animate-none" style={{ background: 'var(--accent)', color: 'var(--accent)' }} />} İş çıktısı{canliIs ? ' · canlı' : ''}
                                </button>
                              )}
                              {/* AYRINTI bir eylem DEGIL, gorunum: bag olarak. */}
                              <button type="button" onClick={() => ayrintiAc(t.id, 'akis')} aria-expanded={acik && ayrinti?.sekme === 'akis'} aria-controls={`rt-ayrinti-${t.id}`} className={LINK} style={{ color: 'var(--accent)' }} title="Hangi adımda, hangi komut, ne kadar kaldı">Akış <span aria-hidden>{acik && ayrinti?.sekme === 'akis' ? '▴' : '▾'}</span></button>
                              {silmeAcik && !onKontrolSuruyor(t.silmeOnKontrol) && <button disabled={busy != null} onClick={() => silmeOnKontrol(t)} className={LINK} style={{ color: 'var(--accent)' }} title="Neyin silineceğini sunucudan şimdi oku (hiçbir şey silinmez)">silme ön kontrolü</button>}
                              {rec.status !== 'cancelled' && cikarilabilir(t) && <button onClick={() => { setCikarNeden(''); setCikarSor(t); }} className={LINK} style={{ color: 'var(--text-secondary)' }} title="Bu hedefi retirement'tan çıkar (ör. istem dışı kayda giren JBoss 8 sunucusu). Hedef 'atlandı' olur; zamanlanmış STOP iptal edilir.">kayıttan çıkar</button>}
                              {/* BEKLEMEYI ATLA (admin, HEDEF BASINA): yalniz bu sunucu ilk zamanlayici turunda silinir. Yikici bag en sonda. */}
                              {silmeAcik && !t.deleteNowAt && <button onClick={() => { setAtlaAd(''); setAtlaSor(t); }} className={LINK} style={{ color: 'var(--status-danger-text)' }} title="Admin: YALNIZ bu sunucunun silme beklemesini atla; zamanlayıcı ilk turda siler, diğer hedefler kendi tarihini bekler">beklemeyi atla (admin)</button>}
                            </div>
                          </div>
                        </td>
                      </tr>
                      {acik && ayrinti && (
                        <tr data-rt-ayrinti className="align-top" style={{ background: ACIK_ZEMIN }}>
                          <td id={`rt-ayrinti-${t.id}`} colSpan={kolonlar.length} className="px-3 pb-3 pt-1" style={{ boxShadow: 'inset 2px 0 0 var(--accent)' }}>
                            <RetirementHedefAyrinti rec={rec} t={t} sekme={ayrinti.sekme} ipucu={ayrinti.ipucu} onSekme={(s) => setAyrinti({ tid: t.id, sekme: s })} onKapat={() => setAyrinti(null)} onIsBitti={load} onbellek={ciktiOnbellegi} inPlace={ip} />
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
          <RetirementDnsIp id={rec.id} app={rec.app} />
          <p className="text-[11px] leading-4" style={{ color: 'var(--text-secondary)' }}>“Retirement'ı başlat” önce sunucuda <b>ön kontrol</b> koşar (hiçbir şey değişmez); başarıyla dönerse dokunulacak dosyalarla birlikte onay penceresi açılır, durdurma ancak orada onaylanınca başlar. PROD hedeflerde ilk STOP'ta SCC'ye bilgilendirme maili gider. Silinecek DNS'ler ve iade edilecek IP'ler “DNS silme / IP iadesi” bölümünde; o Smart kayıtları ekip tarafından açılır.</p>

          <div>
            <h3 className="text-[13px] font-semibold leading-5 mb-1" style={{ color: 'var(--text-primary)' }}>Olaylar</h3>
            <ul className="max-h-48 overflow-auto text-[11px] leading-4">
              {rec.events.map((e) => (
                <li key={e.id} className="grid grid-cols-[8.5rem_minmax(0,1fr)] gap-x-3 border-t py-1 first:border-t-0" style={{ borderColor: 'var(--border-subtle)' }}>
                  <span className="tabular-nums" style={{ color: 'var(--text-secondary)' }}>{fmtDateTime(e.at)}</span>
                  <span className="min-w-0 wrap-anywhere" style={{ color: 'var(--text-primary)' }}><Cip>{e.kind}</Cip> {e.username ? <span style={{ color: 'var(--text-secondary)' }}>({e.username}) </span> : null}— {e.text}</span>
                </li>
              ))}
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
          <div className="w-[96vw] max-w-[1500px] rounded-2xl border p-5 space-y-3 max-h-[94vh] overflow-auto" style={{ background: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }} onClick={(e) => e.stopPropagation()}>
            <div className="text-sm font-semibold">
              {ask.ts.length > 1
                ? <>STOP — {ask.ts[0].appName} @ {ask.ts.length} sunucu ({ask.ts[0].env}) — tek işte</>
                : <>STOP — {ask.ts[0].appName} @ {ask.ts[0].host} ({ask.ts[0].env}, {ask.ts[0].site})</>}
            </div>
            {ask.ts.map((t) => (
              <div key={t.id} className={ask.ts.length > 1 ? 'rounded-xl border p-3 space-y-2' : 'space-y-3'} style={ask.ts.length > 1 ? { borderColor: 'var(--border-subtle)' } : undefined}>
                {ask.ts.length > 1 && <div className="text-[12px] font-semibold font-mono">{t.host} <span className="font-sans font-normal" style={{ color: 'var(--text-muted)' }}>({t.site})</span></div>}
                <div className="text-[12px] rounded-lg border px-3 py-2" style={{ borderColor: 'var(--status-info)', background: 'var(--status-info-bg)' }}><b>Ön kontrol sonucu:</b> {t.planText}</div>
                {/* ON KONTROL LISTESI (2026-10-22): uygulama, konfigurasyon, komutlar, dosyalar ve
                    dokunulmayacaklar; onay yalniz bu listeyi betige gonderir. */}
                <OnKontrolListesi t={t} />
                {/* PLAN AYRINTISI: ozet "2 paket yeniden adlandirilacak" diyor ama HANGI iki
                    paket oldugunu soylemiyordu. Islem geri alinamaz; onay vermeden once
                    dokunulacak dosyalar GORUNMELI. Alan gelmediyse (eski playbook) hic
                    cizilmez - bos bir kutu "ayrinti yok" diye okunurdu. */}
                {t.detail && t.detail.steps.length > 0 && (
                  <div className="text-[11px] rounded-lg border px-3 py-2 space-y-1" style={{ borderColor: 'var(--border-subtle)' }}>
                    <div className="font-semibold" style={{ color: 'var(--text-muted)' }}>Playbook planı (adım adım)</div>
                    {t.detail.steps.map((x, i) => {
                      const p = x.split('\t');
                      const ad = p[1] || '';
                      const dur = p[2] || '';
                      const mesaj = p.slice(3).join(' ');
                      return (
                        <div key={i} className="flex gap-2">
                          <span className="font-mono shrink-0" style={{ color: dur === 'FAIL' ? 'var(--status-danger-text)' : dur === 'SKIP' ? 'var(--text-muted)' : 'var(--status-info)' }}>{ad} · {dur}</span>
                          <span className="break-all">{mesaj}</span>
                        </div>
                      );
                    })}
                  </div>
                )}
                <VhostBloklar liste={vhostPlanlar[t.id]} />
                <StopTrafik t={t} disc={askDisc} is={trafikIs[t.id]} onay={trafikOnay} setOnay={setTrafikOnay} bekleme={olcumuBekleme} setBekleme={setOlcumuBekleme} />
              </div>
            ))}
            <p className="text-[12px]" style={{ color: 'var(--text-secondary)' }}>auto-start kapatılır, JVM durdurulur, paket(ler) <code>.{rec?.smartNo}.old</code> yapılır. {ask.ts[0].env === 'PROD' ? (ask.ts.length > 1 ? `PROD: SCC’ye ${ask.ts.length} sunucuyu listeleyen TEK bilgilendirme maili gider.` : 'PROD: SCC bilgilendirme maili gider.') : ''} Geri almak gerekirse silme tarihinden önce “Geri aktif et” kullanılır.</p>
            {/* IN-PLACE (2026-10-26): ayni sunucuda diger kurulum; yalniz uyari, onay dugmesine BAKMAZ. */}
            <InPlaceUyari hedefler={ask.ts.map((t) => ({ ...t, ...ipOf(t) }))} baglam="stop" kayittakiler={rec?.targets.filter((x) => x.status !== 'skipped')} />
            <StopHubUyari durum={hubDurum} />
            {ask.ts[0].env === 'PROD' && rec?.ocoNo && (
              <fieldset className="rounded-lg border px-3 py-2 text-[12px] space-y-1" style={{ borderColor: 'var(--border-subtle)' }}>
                <legend className="px-1 text-[11px] font-semibold" style={{ color: 'var(--text-muted)' }}>STOP ne zaman çalışsın? (OCO {rec.ocoNo})</legend>
                <label className="flex items-start gap-2 cursor-pointer">
                  <input type="radio" name="stop-zamani" className="mt-0.5" checked={stopZamani === 'oco'} onChange={() => setStopZamani('oco')} />
                  <span><b>OCO penceresine zamanla</b> <span style={{ color: 'var(--text-muted)' }}>(varsayılan) — pencere ileride ise STOP o an başlar; açıksa hemen. Kapanmışsa reddedilir.</span></span>
                </label>
                <label className="flex items-start gap-2 cursor-pointer">
                  <input type="radio" name="stop-zamani" className="mt-0.5" checked={stopZamani === 'simdi'} onChange={() => setStopZamani('simdi')} />
                  <span><b>Şimdi çalıştır</b> <span style={{ color: 'var(--text-muted)' }}>(Admin) — OCO saat kısıtı uygulanmaz, olaylara yazılır.</span></span>
                </label>
              </fieldset>
            )}
            <div className="flex justify-end gap-2"><button onClick={() => setAsk(null)} className={SM_BTN} style={smBtn()}>İptal</button><button disabled={!ask.ts.every((t) => stopOnayAcikMi(stopTrafikOzeti(t, askDisc), trafikIs[t.id]?.durum, trafikOnay, olcumuBekleme) && onKontrolHazir(t))} onClick={() => stopCalistir(ask.ts, true, ask.ts[0].env === 'PROD' && stopZamani === 'simdi')} className={`${SM_BTN} disabled:opacity-50`} style={BTN_TEHLIKE}>{ask.ts[0].env === 'PROD' && rec?.ocoNo && stopZamani === 'oco' ? (ask.ts.length > 1 ? `Onayla ve ${ask.ts.length} sunucuyu OCO penceresine zamanla` : 'Onayla ve OCO penceresine zamanla') : ask.ts.length > 1 ? `Onayla ve ${ask.ts.length} sunucuyu durdur` : 'Onayla ve durdur'}</button></div>
          </div>
        </div>
      )}
      {webSor && (() => {
        const liste = vhostPlanlar[webSor.t.id] || [];
        const suruyor = liste.some((v) => v.durum === 'suruyor');
        return (
          <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,.45)' }} onClick={() => setWebSor(null)}>
            <div className="w-[96vw] max-w-[1500px] rounded-2xl border p-5 space-y-3 max-h-[94vh] overflow-auto" style={{ background: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }} onClick={(e) => e.stopPropagation()}>
              <div className="text-sm font-semibold">Web adımını yeniden dene — {webSor.t.appName} @ {webSor.t.host}</div>
              <p className="text-[12px]" style={{ color: 'var(--text-secondary)' }}>Yalnız <b>başarısız / atlanmış</b> vhost'lar yeniden denenir. Aşağıdaki bloklar web adımıyla <b>aynı betikten</b> (plan kipi) okundu; onaylarsanız zamanlayıcı bu blokları yorum satırına alır ve Apache'yi yeniden yükler.</p>
              {liste.length === 0 ? <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>Yeniden denenecek vhost yok.</div> : <VhostBloklar liste={liste} />}
              {suruyor && <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>Plan işleri bitince onay açılır.</div>}
              <div className="flex justify-end gap-2">
                <button onClick={() => setWebSor(null)} className={SM_BTN} style={smBtn()}>Kapat</button>
                <button disabled={suruyor || liste.length === 0 || busy != null} onClick={() => webYeniden(webSor.t)} className={`${SM_BTN} disabled:opacity-50`} style={BTN_UYARI}>Onayla ve yeniden dene</button>
              </div>
            </div>
          </div>
        );
      })()}
      {/* GERI ALMA ONAYI. Plan dugmesi ayri duruyor; bu pencere GERCEK islemi onaylatir
          ve NE OLACAGINI madde madde yazar - "geri aktif et" tek kelimeyle gecilecek
          kadar kucuk bir islem degil (JVM baslatilir, trafik geri doner). */}
      {/* IPTAL ONAYI (2026-10-08). Kullanici "iptal ettim ama geri donmedi" dedi; iptalin
          NE YAPTIGI ve NE YAPMADIGI burada yazili, ve geri getirme AYNI pencereden
          tetiklenebiliyor - sessiz bir varsayim kalmiyor. */}
      {cikarSor && rec && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,.45)' }} onClick={() => setCikarSor(null)}>
          <div className="w-full max-w-md rounded-2xl border p-5 space-y-3" style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)' }} onClick={(e) => e.stopPropagation()}>
            <div className="text-sm font-semibold">Hedefi kayıttan çıkar</div>
            <div className="text-[12px] font-mono">{cikarSor.appName} @ {cikarSor.host} · {cikarSor.gen ? `JBoss ${cikarSor.gen}` : 'JBoss ?'} · {cikarSor.env}</div>
            <p className="text-[12px]" style={{ color: 'var(--text-secondary)' }}>
              Bu sunucuya hiçbir işlem yapılmaz: hedef “atlandı” olur{cikarSor.status === 'stop_scheduled' ? ', zamanlanmış STOP iptal edilir' : ''}. Kayıttaki diğer hedefler etkilenmez. İşlem olay geçmişine yazılır.
            </p>
            <label className="block text-[11px]" style={{ color: 'var(--text-muted)' }}>
              Sebep (isteğe bağlı)
              <input value={cikarNeden} onChange={(e) => setCikarNeden(e.target.value)} placeholder="ör. yalnız JBoss 7 retire ediliyor" className={`${INPUT} mt-1`} style={inputStyle} autoFocus />
            </label>
            <div className="flex justify-end gap-2">
              <button onClick={() => setCikarSor(null)} className={SM_BTN} style={smBtn()}>Kapat</button>
              <button onClick={hedefCikar} className={SM_BTN} style={smBtn(true)}>Kayıttan çıkar</button>
            </div>
          </div>
        </div>
      )}
      {webKesif && rec && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,.45)' }} onClick={() => setWebKesif(null)}>
          <div className="w-full max-w-3xl max-h-[85vh] overflow-auto rounded-2xl border p-5 space-y-3" style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)' }} onClick={(e) => e.stopPropagation()}>
            <div className="text-sm font-semibold">Web keşfi (önizleme) — {rec.app}</div>
            <p className="text-[12px]" style={{ color: 'var(--text-secondary)' }}>
              Keşif bugünkü kurallarla yeniden yapıldı. <b>Henüz durmamış / zamanlanmış</b> hedeflerde eklenen vhost’ları STOP kapatır.
              <b> Durdurulmuş</b> hedeflerde vhost’lar “atlandı” olarak eklenir; kapatmak için satırdaki “Web adımını yeniden dene” (önizlemeli) kullanılır.
              Var olan girdiler silinmez.
            </p>
            <div className="space-y-2">
              {(webKesif.hedefler || []).map((h) => (
                <div key={h.tid} className="rounded-lg border px-3 py-2 text-[12px] space-y-1" style={{ borderColor: h.eklenen.length ? 'var(--status-info)' : 'var(--border-subtle)' }}>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono font-semibold">{h.host}</span>
                    <span style={{ color: 'var(--text-muted)' }}>{h.appName} · {h.env} · {h.status}</span>
                    <span className="ml-auto font-semibold" style={{ color: h.eklenen.length ? 'var(--status-info)' : 'var(--text-muted)' }}>{h.islem}</span>
                  </div>
                  {h.eklenen.map((w) => (
                    <div key={`${w.host}|${w.serverName}|${w.confFile}`} className="flex flex-wrap items-baseline gap-x-1 font-mono text-[11px]"><span>+ {w.host} · {w.serverName}{w.product ? ` (${w.product})` : ''}</span><WebKaynak w={w} /></div>
                  ))}
                  {!h.eklenen.length && h.webUyari && <div className="text-[11px]" style={{ color: 'var(--status-danger-text)' }}>{h.webUyari}</div>}
                  <div className="text-[10px]" style={{ color: 'var(--text-muted)' }}>{h.webHow}</div>
                </div>
              ))}
            </div>
            <div className="flex justify-end gap-2">
              <button onClick={() => setWebKesif(null)} className={SM_BTN} style={smBtn()}>Kapat</button>
              <button disabled={webKesifBusy || !(webKesif.hedefler || []).some((h) => h.eklenen.length && h.islem.startsWith('eklenecek'))} onClick={() => webKesifCalistir(true)} className={`${SM_BTN} disabled:opacity-50`} style={smBtn(true)}>
                Eklenenleri kayda yaz
              </button>
            </div>
          </div>
        </div>
      )}
      {atlaTopluSor && rec && (() => {
        const hazir = rec.targets.filter((t) => t.status === 'stopped' && !t.deletedAt);
        const prod = hazir.some((t) => t.env === 'PROD');
        return (
          <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,.45)' }} onClick={() => setAtlaTopluSor(false)}>
            <div className="w-full max-w-lg rounded-2xl border p-5 space-y-3" style={{ background: 'var(--bg-surface)', borderColor: 'var(--status-danger)' }} onClick={(e) => e.stopPropagation()}>
              <div className="text-sm font-semibold">Beklemeyi atla (TÜM hedefler) — {rec.app}</div>
              <div className="text-[12px] space-y-1.5" style={{ color: 'var(--text-secondary)' }}>
                <p>Kaydın silme tarihi <b>bugüne</b> çekilir ({rec.effectiveDeleteAt ? fmtDate(rec.effectiveDeleteAt) : 'belirsiz'} → bugün) ve 23:00 saati beklenmez: aşağıdaki <b>tüm</b> durdurulmuş hedefler zamanlayıcının ilk turunda (en geç birkaç dakika) silinir. Yalnız bir sunucu için satırdaki “beklemeyi atla”yı kullanın.</p>
                <p style={{ color: 'var(--status-danger-text)' }}><b>DELETE GERİ ALINAMAZ:</b> paketler silinir, server-config ve (boş kalırsa) server-group kaldırılır. Bundan sonra “Geri aktif et” çalışmaz; dönüş yalnız yedekten.</p>
              </div>
              <div className="text-[11px] rounded-lg border px-3 py-2" style={{ borderColor: 'var(--border-subtle)' }}>
                <div className="font-semibold mb-0.5">Silinecek {hazir.length} hedef</div>
                {hazir.map((t) => <div key={t.id} className="font-mono">{t.appName} @ {t.host} <b style={{ color: t.env === 'PROD' ? 'var(--status-danger-text)' : undefined }}>{t.env}</b></div>)}
              </div>
              {prod && <div className="text-[12px] font-semibold" style={{ color: 'var(--status-danger-text)' }}>Listede PROD hedef var.</div>}
              <label className="block text-[11px]" style={{ color: 'var(--text-muted)' }}>
                Onay için uygulama adını aynen yazın: <span className="font-mono">{rec.app}</span>
                <input value={atlaAd} onChange={(e) => setAtlaAd(e.target.value)} className={`${INPUT} mt-1 font-mono`} style={inputStyle} autoFocus />
              </label>
              <div className="flex justify-end gap-2">
                <button onClick={() => setAtlaTopluSor(false)} className={SM_BTN} style={smBtn()}>Kapat</button>
                <button disabled={atlaAd.trim() !== rec.app} onClick={beklemeyiTopluAtla} className={SM_BTN} style={{ ...BTN_TEHLIKE, opacity: atlaAd.trim() !== rec.app ? 0.5 : 1 }}>
                  Tüm hedeflerin beklemesini atla
                </button>
              </div>
            </div>
          </div>
        );
      })()}
      {atlaSor && rec && (() => {
        const t = atlaSor;
        return (
          <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,.45)' }} onClick={() => setAtlaSor(null)}>
            <div className="w-full max-w-lg rounded-2xl border p-5 space-y-3" style={{ background: 'var(--bg-surface)', borderColor: 'var(--status-danger)' }} onClick={(e) => e.stopPropagation()}>
              <div className="text-sm font-semibold">Beklemeyi atla — {t.appName} @ {t.host} <b style={{ color: t.env === 'PROD' ? 'var(--status-danger-text)' : undefined }}>({t.env})</b></div>
              <div className="text-[12px] space-y-1.5" style={{ color: 'var(--text-secondary)' }}>
                <p><b>Yalnız bu sunucu</b> için silme beklemesi atlanır ({rec.effectiveDeleteAt ? fmtDate(rec.effectiveDeleteAt) : 'belirsiz'} tarihi ve 23:00 saati beklenmez). Kaydın diğer hedefleri kendi tarihlerini bekler. DELETE'i bu düğme başlatmaz: <b>her zamanki zamanlayıcı</b> bir sonraki turunda (en geç birkaç dakika) yakalar ve başlatır.</p>
                <p style={{ color: 'var(--status-danger-text)' }}><b>DELETE GERİ ALINAMAZ:</b> paketler silinir, server-config ve (boş kalırsa) server-group kaldırılır. Bundan sonra bu hedefte “Geri aktif et” çalışmaz; dönüş yalnız yedekten.</p>
              </div>
              <label className="block text-[11px]" style={{ color: 'var(--text-muted)' }}>
                Onay için uygulama adını aynen yazın: <span className="font-mono">{t.appName}</span>
                <input value={atlaAd} onChange={(e) => setAtlaAd(e.target.value)} className={`${INPUT} mt-1 font-mono`} style={inputStyle} autoFocus />
              </label>
              <div className="flex justify-end gap-2">
                <button onClick={() => setAtlaSor(null)} className={SM_BTN} style={smBtn()}>Kapat</button>
                <button disabled={atlaAd.trim() !== t.appName} onClick={beklemeyiAtla} className={SM_BTN} style={{ ...BTN_TEHLIKE, opacity: atlaAd.trim() !== t.appName ? 0.5 : 1 }}>
                  Bu sunucunun beklemesini atla
                </button>
              </div>
            </div>
          </div>
        );
      })()}
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
                <div className="text-[12px] rounded-lg px-3 py-2 border" style={{ color: 'var(--status-danger-text)', borderColor: 'var(--status-danger)' }}>
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
                <button onClick={() => cancel(false)} className={SM_BTN} style={{ ...smBtn(), color: 'var(--status-danger-text)', borderColor: 'var(--status-danger)' }}>
                  Yalnız kaydı iptal et
                </button>
                {durdurulmus.length > 0 && (
                  <button onClick={() => cancel(true)} className={SM_BTN} style={BTN_BASARI}>
                    İptal et ve {durdurulmus.length} uygulamayı geri aktif et
                  </button>
                )}
              </div>
            </div>
          </div>
        );
      })()}
      {geriAl && (() => {
        // Pencere hedefin GUNCEL halini gosterir (on kontrol sonucu sonradan yazilmis olabilir).
        const gt = rec?.targets.find((x) => x.id === geriAl.t.id) || geriAl.t;
        const k = gt.geriAlOnKontrol;
        const geriAcilacak = (gt.webSonuc || []).filter((w) => w.status === 'ok');
        return (
          <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,.45)' }} onClick={() => setGeriAl(null)}>
            <div className="w-[96vw] max-w-[1100px] rounded-2xl border p-5 space-y-3 max-h-[94vh] overflow-auto" style={{ background: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }} onClick={(e) => e.stopPropagation()}>
              <div className="text-sm font-semibold">{gt.appName} @ {gt.host} geri aktif edilecek <span className="font-normal" style={{ color: 'var(--text-muted)' }}>(JBoss {gt.gen ?? '?'}, {gt.env})</span></div>
              {k?.mesaj && (
                <div className="text-[12px] rounded-lg border px-3 py-2" style={{ borderColor: 'var(--status-info)', background: 'var(--status-info-bg)' }}>
                  <b>Ön kontrol sonucu:</b> {k.mesaj}
                  <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}> · iş #{k.jobId ?? '?'}{k.at ? ` · ${fmtDateTime(k.at)}` : ''}</span>
                </div>
              )}
              {/* ON KONTROL LISTESI (2026-10-22): paketler, komutlar, konfigurasyon, dokunulmayacaklar; onay
                  YALNIZ bu listeyi betige gonderir. */}
              <OnKontrolGorunumu satirlar={k?.onkontrol} hazir={geriAlHazir(gt)} kip="geri-al" kisaltildi={k?.kisaltildi} />
              {!geriAlinabilir(gt) && (
                <div role="alert" className="text-[12px] rounded-lg border px-3 py-2" style={{ borderColor: 'var(--status-danger)', color: 'var(--status-danger-text)' }}>
                  Hedef artık geri alınabilir durumda değil ({gt.status}{gt.deletedAt ? ', silindi' : ''}) — onay açılmaz.
                </div>
              )}
              <ul className="text-[12px] space-y-1 list-disc pl-4" style={{ color: 'var(--text-secondary)' }}>
                <li>
                  {geriAcilacak.length
                    ? <>STOP'ta kaldırılan {geriAcilacak.length} vhost geri açılır (<code>apachectl -t</code> geçmezse geri alınır): <span className="font-mono">{geriAcilacak.map((w) => `${w.host} / ${w.serverName}`).join(' · ')}</span></>
                    : <>STOP'ta otomatik kaldırılmış vhost yok — geri açılacak web tanımı yok</>}
                </li>
                <li><b>Zamanlanmış silme devre dışı kalır</b> — hedef artık "stopped" olmadığı için silme işi hiç tetiklenmez</li>
              </ul>
              <div className="text-[11px] rounded-lg px-3 py-2 border" style={{ color: 'var(--text-secondary)', borderColor: 'var(--border-subtle)' }}>
                Uygulama <b>canlıya geri döner</b>. PROD hedefte trafik almaya başlar — bunun planlı olduğundan emin olun.
              </div>
              <div className="flex justify-end gap-2">
                <button onClick={() => setGeriAl(null)} className={SM_BTN} style={smBtn()}>İptal</button>
                <button disabled={!geriAlHazir(gt) || !geriAlinabilir(gt) || busy != null} onClick={() => rollback(gt, true, k?.jobId ?? null)} className={`${SM_BTN} disabled:opacity-50`} style={BTN_BASARI}>Onayla ve geri aktif et</button>
              </div>
            </div>
          </div>
        );
      })()}
      {silmeListe != null && rec && (() => {
        const t = rec.targets.find((x) => x.id === silmeListe);
        if (!t) return null;
        const k = t.silmeOnKontrol;
        return (
          <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,.45)' }} onClick={() => setSilmeListe(null)}>
            <div className="w-[96vw] max-w-[1100px] rounded-2xl border p-5 space-y-3 max-h-[94vh] overflow-auto" style={{ background: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }} onClick={(e) => e.stopPropagation()}>
              <div className="text-sm font-semibold">Silme ön kontrolü — {t.appName} @ {t.host} <span className="font-normal" style={{ color: 'var(--text-muted)' }}>(JBoss {t.gen ?? '?'}, {t.env})</span></div>
              {!k ? (
                <div className="text-[12px]" style={{ color: 'var(--text-secondary)' }}>Henüz silme ön kontrolü yok. Zamanlayıcı silme saatinden bir saat önce koşar; şimdi görmek için “Ön kontrolü çalıştır”.</div>
              ) : (
                <>
                  <div className="text-[12px] rounded-lg border px-3 py-2" style={{ borderColor: k.durum === 'failed' ? 'var(--status-danger)' : 'var(--status-info)', background: k.durum === 'failed' ? undefined : 'var(--status-info-bg)' }}>
                    <b>{onKontrolSuruyor(k) ? 'Ön kontrol sürüyor' : k.durum === 'ok' ? 'Ön kontrol sonucu' : 'Ön kontrol BAŞARISIZ — silme yapılmaz'}:</b> {k.mesaj || '—'}
                    <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                      iş #{k.jobId ?? '?'}{k.at ? ` · ${fmtDateTime(k.at)}` : ''} · {k.kaynak === 'zamanlayici' ? 'zamanlayıcı' : `elle${k.kullanici ? ` (${k.kullanici})` : ''}`}{k.kullanildi ? ' · bu liste silmede kullanıldı' : ''}
                    </div>
                  </div>
                  {(k.durum === 'ok' || k.onkontrol.length > 0) && <OnKontrolGorunumu satirlar={k.onkontrol} hazir={k.hazir} kip="silme" kisaltildi={k.kisaltildi} />}
                </>
              )}
              <div className="flex justify-end gap-2">
                <button onClick={() => setSilmeListe(null)} className={SM_BTN} style={smBtn()}>Kapat</button>
                {t.status === 'stopped' && !onKontrolSuruyor(k) && rec.status !== 'cancelled' && rec.status !== 'deleted' && (
                  <button disabled={busy != null} onClick={() => { setSilmeListe(null); silmeOnKontrol(t); }} className={`${SM_BTN} disabled:opacity-50`} style={smBtn(true)}>{k ? 'Ön kontrolü yeniden çalıştır' : 'Ön kontrolü çalıştır'}</button>
                )}
              </div>
            </div>
          </div>
        );
      })()}
    </Modal>
  );
}
