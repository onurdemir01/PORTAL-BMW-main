// src/components/nginx_console/yukTesti/BaslatOnayi.tsx — koşuyu baslatma onayi (2026-10-27).
//
// UC KOSUL, UCU DE SUNUCUDA DA ARANIR (POST /api/nginx-loadtest/kosular):
//   1) Hedef sunucu adi ELLE yazilir (yapistirma / surukle-birak kapali) -> confirmText === hedefHost (birebir)
//   2) On kontrol uyarisi varsa "okudum, kabul ediyorum" kutusu        -> uyariOnay === true
//   3) Dayanilan on kontrol 15 dk'dan eski degil, ayni kullanici, ayni parametreler (sunucu: on_kontrol_eski)
// Sunucu 409 uyari_onayi ile KENDI uyari listesini donerse liste burada gosterilir ve kutu yeniden istenir.
// Pencere girdi tasir: arka plana tiklamak kapatmaz; "İptal" ve Esc kapatir (gonderim surerken degil).
import React, { useState } from 'react';
import { BoltIcon, ExclamationTriangleIcon } from '@heroicons/react/24/outline';
import type { NlKosuAyrinti, NlSenaryo } from '@/api/nginxLoadtestApi';
import { Modal } from '@/components/common/Modal';
import { fmtNumber } from '@/utils/datetime';
import { SM_BTN, smBtn } from '@/components/server_hub/retirementStil';
import { UyariKutusu } from '@/components/server_hub/RetirementUi';
import { sureMetni } from '@/components/server_hub/retirementCikti';
import { AE_ETIKETI, KIP_ETIKETI, butceSn } from './yukTestiOrtak';
import { GIRDI_TABAN, girdiStili } from './YukUi';

export interface BaslatOnayiDegeri { confirmText: string; uyariOnay: boolean }

export default function BaslatOnayi({ onKontrol, senaryo, uyarilar, sunucuUyarilari, busy, hata, onOnay, onKapat }: {
  onKontrol: NlKosuAyrinti; senaryo: NlSenaryo | null; uyarilar: string[]; sunucuUyarilari: string[] | null;
  busy: boolean; hata: string | null; onOnay: (v: BaslatOnayiDegeri) => void; onKapat: () => void;
}) {
  const [typed, setTyped] = useState('');
  const [ack, setAck] = useState(false);
  const hedef = onKontrol.hedefHost;
  const tumUyarilar = [...new Set([...(sunucuUyarilari || []), ...uyarilar])];
  const nameOk = typed === hedef;
  const canSubmit = !busy && nameOk && (tumUyarilar.length === 0 || ack);
  const p = onKontrol.parametreler;
  const adim = p ? p.hizlar.length * p.tekrar : null;

  return (
    <Modal open onClose={() => { if (!busy) onKapat(); }} title="Yük testini başlat" subtitle={`Hedef ${hedef} — ${onKontrol.vhost || ''}`} icon={BoltIcon} size="lg" dismissOnBackdrop={false}
      footer={
        <div className="flex w-full flex-wrap items-center justify-end gap-2">
          {!nameOk && <span className="mr-auto text-[11px]" style={{ color: 'var(--text-secondary)' }}>{typed ? 'Yazılan ad hedefle aynı değil.' : 'Onay için hedef sunucu adını yazın.'}</span>}
          <button type="button" className={SM_BTN} style={smBtn()} disabled={busy} onClick={onKapat}>İptal</button>
          <button type="button" className={SM_BTN} style={smBtn(true)} disabled={!canSubmit} onClick={() => onOnay({ confirmText: typed, uyariOnay: tumUyarilar.length > 0 && ack })}>
            <BoltIcon className="h-3.5 w-3.5" aria-hidden /> {busy ? 'Başlatılıyor…' : 'Yük testini başlat'}
          </button>
        </div>
      }>
      <div className="space-y-4 text-[12px]" style={{ color: 'var(--text-primary)' }}>
        <dl className="grid grid-cols-[8.5rem_minmax(0,1fr)] gap-x-3 gap-y-1.5 rounded-lg px-3 py-2.5" style={{ background: 'var(--bg-elevated)' }}>
          <dt style={{ color: 'var(--text-secondary)' }}>Hedef sunucu</dt>
          <dd className="min-w-0 truncate font-mono font-semibold" title={`${hedef} · ${onKontrol.hedefIp || ''}`}>{hedef}{onKontrol.hedefIp ? <span className="font-normal" style={{ color: 'var(--text-secondary)' }}> · {onKontrol.hedefIp}</span> : null}</dd>
          <dt style={{ color: 'var(--text-secondary)' }}>Vhost</dt>
          <dd className="min-w-0 truncate" title={onKontrol.vhost || ''}>{onKontrol.vhost || '—'}{p?.sni ? ' · SNI' : ''}</dd>
          <dt style={{ color: 'var(--text-secondary)' }}>Yük sunucusu</dt>
          <dd className="font-mono">{onKontrol.yukHost || '—'}</dd>
          <dt style={{ color: 'var(--text-secondary)' }}>Senaryo</dt>
          <dd className="min-w-0 truncate" title={senaryo?.ad || onKontrol.senaryoAd || ''}>{senaryo?.ad || onKontrol.senaryoAd || '—'}{senaryo ? ` · ${senaryo.senaryoTur} · ${fmtNumber(senaryo.yolSayisi)} yol` : ''}</dd>
          <dt style={{ color: 'var(--text-secondary)' }}>Yük</dt>
          <dd>{p ? `${p.hizlar.join(' · ')} istek/sn × ${p.tekrar} tekrar = ${fmtNumber(adim)} adım · ${KIP_ETIKETI[p.kip] || p.kip} · ${AE_ETIKETI[p.ae] || p.ae}` : '—'}</dd>
          <dt style={{ color: 'var(--text-secondary)' }}>Tahmini süre</dt>
          <dd>{p ? `≈ ${sureMetni(butceSn(p))} (üst sınır; iş bu süreyi aşarsa kendini durdurur)` : '—'}</dd>
        </dl>
        <p className="text-[12px] leading-5" style={{ color: 'var(--text-secondary)' }}>
          Bu iş hedefe gerçek trafik gönderir. Aynı hedefte, aynı yük sunucusunda ya da Portal genelinde ikinci bir yük testi başlatılamaz; başka ekiplerin aynı ortamdaki testleri etkilenebilir.
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
            Onaylamak için hedef sunucunun adını yazın: <span className="font-mono font-semibold" style={{ color: 'var(--text-primary)' }}>{hedef}</span>
          </label>
          <input id="yuk-onay-host" value={typed} onChange={(e) => setTyped(e.target.value)} onPaste={(e) => e.preventDefault()} onDrop={(e) => e.preventDefault()}
            autoComplete="off" spellCheck={false} disabled={busy} placeholder={hedef} aria-invalid={!!typed && !nameOk}
            className={`${GIRDI_TABAN} h-9 w-full font-mono text-[13px]`} style={girdiStili(!!typed && !nameOk)} />
          <p className="mt-1 text-[11px]" style={{ color: 'var(--text-muted)' }}>Yapıştırma kapalı; ad büyük/küçük harf dahil birebir aynı olmalı.</p>
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
