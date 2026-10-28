// src/components/nginx_console/yukTesti/BaslatOnayi.tsx — koşuyu baslatma onayi (2026-10-27).
//
// UC KOSUL, UCU DE SUNUCUDA DA ARANIR (POST /api/nginx-loadtest/kosular):
//   1) Hedef ELLE yazilir (yapistirma / surukle-birak kapali) -> confirmText === hedefHost (sunucu hedefi) ya da
//      hedefIp (serbest hedef: hedef sunucu yok, yuk bir IP'ye gider; 2026-10-28) - birebir
//   2) On kontrol uyarisi varsa "okudum, kabul ediyorum" kutusu        -> uyariOnay === true
//   3) Dayanilan on kontrol 15 dk'dan eski degil, ayni kullanici, ayni parametreler (sunucu: on_kontrol_eski)
// Sunucu 409 uyari_onayi ile KENDI uyari listesini donerse liste burada gosterilir ve kutu yeniden istenir.
// Pencere girdi tasir: arka plana tiklamak kapatmaz; "İptal" ve Esc kapatir (gonderim surerken degil).
// Yuk satiri ve tahmini sure `adimDegerleri` / `butceSn` ile: wrk kaydinda `hizlar` yoktur (baglanti kademeleri).
// Dogrulama UV3 (2026-10-28): onay girdisi aria-describedby ile ipucuna (yuk-onay-ipucu; yapistirma kapali) ve yanlis
// yazimda footer'daki uyusmazlik metnine (yuk-onay-durum) baglidir. Gorunmeyen id'ye bag yok: span yalniz !nameOk iken.
import React, { useState } from 'react';
import { BoltIcon, ExclamationTriangleIcon } from '@heroicons/react/24/outline';
import type { NlKosuAyrinti, NlSenaryo } from '@/api/nginxLoadtestApi';
import { Modal } from '@/components/common/Modal';
import { fmtNumber } from '@/utils/datetime';
import { SM_BTN, smBtn } from '@/components/server_hub/retirementStil';
import { Cip, UyariKutusu } from '@/components/server_hub/RetirementUi';
import { sureMetni } from '@/components/server_hub/retirementCikti';
import { AE_ETIKETI, KIP_ETIKETI, SERBEST_CIP_IPUCU, adimDegerleri, butceSn } from './yukTestiOrtak';
import { GIRDI_TABAN, girdiStili } from './YukUi';

export interface BaslatOnayiDegeri { confirmText: string; uyariOnay: boolean }

/** Yuk satiri: k6 metni eskisiyle BIREBIR; wrk "wrk · 2 · 4 · 8 bağlantı × 2 tekrar = 6 adım · 2 iş parçacığı · ortalama ≤ 450 istek/sn · ...". */
function yukMetni(p: NonNullable<NlKosuAyrinti['parametreler']>): string {
  const { motor, degerler } = adimDegerleri(p);
  const adim = degerler.length * p.tekrar;
  const kipAe = `${KIP_ETIKETI[p.kip] || p.kip} · ${AE_ETIKETI[p.ae] || p.ae}`;
  if (motor === 'wrk') {
    return `wrk · ${degerler.join(' · ')} bağlantı × ${p.tekrar} tekrar = ${fmtNumber(adim)} adım · ${p.is_parcacigi ?? '—'} iş parçacığı · ortalama ≤ ${p.tavan_rps ?? '—'} istek/sn · ${kipAe}`;
  }
  return `${degerler.join(' · ')} istek/sn × ${p.tekrar} tekrar = ${fmtNumber(adim)} adım · ${kipAe}`;
}

export default function BaslatOnayi({ onKontrol, senaryo, uyarilar, sunucuUyarilari, busy, hata, onOnay, onKapat }: {
  onKontrol: NlKosuAyrinti; senaryo: NlSenaryo | null; uyarilar: string[]; sunucuUyarilari: string[] | null;
  busy: boolean; hata: string | null; onOnay: (v: BaslatOnayiDegeri) => void; onKapat: () => void;
}) {
  const [typed, setTyped] = useState('');
  const [ack, setAck] = useState(false);
  // Serbest hedefte hedef sunucu yok: onay metni hedef IP (sunucu da confirmText === hedef_ip ister).
  const serbest = onKontrol.hedefTuru === 'serbest';
  const hedef = (serbest ? onKontrol.hedefIp : onKontrol.hedefHost) || '';
  const tumUyarilar = [...new Set([...(sunucuUyarilari || []), ...uyarilar])];
  const nameOk = !!hedef && typed === hedef;
  const canSubmit = !busy && nameOk && (tumUyarilar.length === 0 || ack);
  const p = onKontrol.parametreler;

  return (
    <Modal open onClose={() => { if (!busy) onKapat(); }} title="Yük testini başlat" subtitle={`Hedef ${hedef}${serbest ? ' (serbest)' : ''} — ${onKontrol.vhost || ''}`} icon={BoltIcon} size="lg" dismissOnBackdrop={false}
      footer={
        <div className="flex w-full flex-wrap items-center justify-end gap-2">
          {!nameOk && (
            <span id="yuk-onay-durum" className="mr-auto text-[11px]" style={{ color: 'var(--text-secondary)' }}>
              {serbest
                ? (typed ? 'Yazılan IP hedefle aynı değil.' : 'Onay için hedef IP’yi yazın.')
                : (typed ? 'Yazılan ad hedefle aynı değil.' : 'Onay için hedef sunucu adını yazın.')}
            </span>
          )}
          <button type="button" className={SM_BTN} style={smBtn()} disabled={busy} onClick={onKapat}>İptal</button>
          <button type="button" className={SM_BTN} style={smBtn(true)} disabled={!canSubmit} onClick={() => onOnay({ confirmText: typed, uyariOnay: tumUyarilar.length > 0 && ack })}>
            <BoltIcon className="h-3.5 w-3.5" aria-hidden /> {busy ? 'Başlatılıyor…' : 'Yük testini başlat'}
          </button>
        </div>
      }>
      <div className="space-y-4 text-[12px]" style={{ color: 'var(--text-primary)' }}>
        <dl className="grid grid-cols-[8.5rem_minmax(0,1fr)] gap-x-3 gap-y-1.5 rounded-lg px-3 py-2.5" style={{ background: 'var(--bg-elevated)' }}>
          {serbest ? (
            <>
              <dt style={{ color: 'var(--text-secondary)' }}>Hedef IP</dt>
              <dd className="flex min-w-0 items-center gap-1.5">
                <span className="min-w-0 truncate font-mono font-semibold" title={hedef}>{hedef}</span>
                <Cip ton="uyari" cerceve title={SERBEST_CIP_IPUCU}>serbest</Cip>
              </dd>
              <dt style={{ color: 'var(--text-secondary)' }}>İzinli ağ</dt>
              {/* Iki kaynak da okunmali (Portal izin listesi + yuk sunucusundaki izin dosyasi): kesilmez, sarar. */}
              <dd className="min-w-0 wrap-anywhere tabular-nums" title="Portal izin listesinde ve yük sunucusundaki izin dosyasında eşleşen ağ">
                {`${onKontrol.serbestAg ?? '—'} (Portal) · ${onKontrol.onKontrol?.serbestAg ?? '—'} (yük sunucusu)`}
              </dd>
            </>
          ) : (
            <>
              <dt style={{ color: 'var(--text-secondary)' }}>Hedef sunucu</dt>
              <dd className="min-w-0 truncate font-mono font-semibold" title={`${hedef} · ${onKontrol.hedefIp || ''}`}>{hedef}{onKontrol.hedefIp ? <span className="font-normal" style={{ color: 'var(--text-secondary)' }}> · {onKontrol.hedefIp}</span> : null}</dd>
            </>
          )}
          <dt style={{ color: 'var(--text-secondary)' }}>Vhost</dt>
          <dd className="min-w-0 truncate" title={onKontrol.vhost || ''}>{onKontrol.vhost || '—'}{p?.sni ? ' · SNI' : ''}</dd>
          <dt style={{ color: 'var(--text-secondary)' }}>Yük sunucusu</dt>
          <dd className="font-mono">{onKontrol.yukHost || '—'}</dd>
          <dt style={{ color: 'var(--text-secondary)' }}>Senaryo</dt>
          <dd className="min-w-0 truncate" title={senaryo?.ad || onKontrol.senaryoAd || ''}>{senaryo?.ad || onKontrol.senaryoAd || '—'}{senaryo ? ` · ${senaryo.senaryoTur} · ${fmtNumber(senaryo.yolSayisi)} yol` : ''}</dd>
          <dt style={{ color: 'var(--text-secondary)' }}>Yük</dt>
          <dd>{p ? yukMetni(p) : '—'}</dd>
          <dt style={{ color: 'var(--text-secondary)' }}>Tahmini süre</dt>
          <dd>{p ? `≈ ${sureMetni(butceSn(p))} (üst sınır; iş bu süreyi aşarsa kendini durdurur)` : '—'}</dd>
        </dl>
        <p className="text-[12px] leading-5" style={{ color: 'var(--text-secondary)' }}>
          {serbest
            ? `Bu iş ${hedef} adresine gerçek trafik gönderir. Hedef sunucuya bağlanılmaz; yalnız yük sunucusu ölçer. Aynı IP’ye, aynı yük sunucusundan ya da Portal genelinde ikinci bir yük testi başlatılamaz; LB arkasındaki başka kullanıcılar etkilenebilir.`
            : 'Bu iş hedefe gerçek trafik gönderir. Aynı hedefte, aynı yük sunucusunda ya da Portal genelinde ikinci bir yük testi başlatılamaz; başka ekiplerin aynı ortamdaki testleri etkilenebilir.'}
        </p>
        {tumUyarilar.length > 0 && (
          <UyariKutusu ton="uyari" baslik={`${tumUyarilar.length} ön kontrol uyarısı`}>
            <ul className="list-disc space-y-0.5 pl-4">{tumUyarilar.map((u) => <li key={u}>{u}</li>)}</ul>
            <label className="mt-2 flex cursor-pointer items-start gap-2 font-semibold">
              <input type="checkbox" className="mt-0.5 accent-[var(--accent)]" checked={ack} onChange={(e) => setAck(e.target.checked)} disabled={busy} />
              <span>Uyarıları okudum; ölçümün bu koşullarla yapılmasını kabul ediyorum.</span>
            </label>
          </UyariKutusu>
        )}
        <div>
          <label htmlFor="yuk-onay-host" className="mb-1 block text-[12px]" style={{ color: 'var(--text-secondary)' }}>
            {serbest ? 'Onaylamak için hedef IP’yi yazın:' : 'Onaylamak için hedef sunucunun adını yazın:'} <span className="font-mono font-semibold" style={{ color: 'var(--text-primary)' }}>{hedef}</span>
          </label>
          <input id="yuk-onay-host" value={typed} onChange={(e) => setTyped(e.target.value)} onPaste={(e) => e.preventDefault()} onDrop={(e) => e.preventDefault()}
            autoComplete="off" spellCheck={false} disabled={busy} placeholder={hedef} aria-invalid={!!typed && !nameOk}
            aria-describedby={typed && !nameOk ? 'yuk-onay-durum yuk-onay-ipucu' : 'yuk-onay-ipucu'}
            className={`${GIRDI_TABAN} h-9 w-full font-mono text-[13px]`} style={girdiStili(!!typed && !nameOk)} />
          <p id="yuk-onay-ipucu" className="mt-1 text-[11px]" style={{ color: 'var(--text-muted)' }}>
            {serbest ? 'Yapıştırma kapalı; IP birebir aynı olmalı.' : 'Yapıştırma kapalı; ad büyük/küçük harf dahil birebir aynı olmalı.'}
          </p>
        </div>
        {hata && (
          <div role="alert" className="flex items-start gap-2 text-[12px] leading-5" style={{ color: 'var(--status-danger-text)' }}>
            <ExclamationTriangleIcon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> <span>{hata}</span>
          </div>
        )}
      </div>
    </Modal>
  );
}
