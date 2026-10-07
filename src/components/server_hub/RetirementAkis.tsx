// src/components/server_hub/RetirementAkis.tsx — retirement kaydinin AKIS PANELI.
//
// Kullanici (2026-10-08): "Tüm bu özet tabloyu, uygulanacak komutları ve akışı uygulama
// retirement kaydına girdikten sonra ekrana yansıtabilir miyiz? Hangi adımda olduğunu,
// daha ne kadar kaldığını vesaire görebilmek istiyorum."
//
// ── NE GOSTERIR ───────────────────────────────────────────────────────────────────────
// Hedef basina ALTI asama: On kontrol → STOP → Web (vhost) → Bekleme → DELETE, ve gerekiyorsa
// Geri alma. Her asamada: durum, O ASAMANIN SUNUCUDA YAPTIGI IS (komut ozeti) ve varsa
// zaman/sonuc. Silme icin KALAN GUN de burada.
//
// ── OLCULEN ILE TAHMIN EDILEN AYRILIR ────────────────────────────────────────────────
// Asama durumlari hedefin GERCEK `status`/zaman alanlarindan turer. Bilinmeyen bir durum
// "bitti" sayilmaz; `bilinmiyor` olarak gosterilir. Bir asamanin yapildigini VARSAYMAK,
// bu akista en pahali yanlis olurdu - kullanici silme saatini ona gore planliyor.
//
// LB / IP / DNS ASAMASI BILINCLI OLARAK "elle" YAZAR: Portal o adimlari otomatize
// ETMIYOR (yalniz dnsReuse/lbReuse bayragini tutuyor). Akisa koyup bos birakmak, yapilmis
// gibi gorunmesine yol acardi; yok saymak ise ekibin o isi unutmasina.
import React from 'react';
import type { RtRecord, RtTarget } from '@/api/retirementApi';
import { fmtDate, fmtDateTime } from '@/utils/datetime';

type Durum = 'bitti' | 'suruyor' | 'bekliyor' | 'hata' | 'elle' | 'atlandi' | 'bilinmiyor';

const SIM: Record<Durum, { isaret: string; renk: string }> = {
  bitti: { isaret: '✓', renk: 'var(--status-success)' },
  suruyor: { isaret: '◴', renk: 'var(--status-warning)' },
  bekliyor: { isaret: '○', renk: 'var(--text-muted)' },
  hata: { isaret: '✕', renk: 'var(--status-danger)' },
  elle: { isaret: '✋', renk: 'var(--status-warning)' },
  atlandi: { isaret: '–', renk: 'var(--text-muted)' },
  bilinmiyor: { isaret: '?', renk: 'var(--status-warning)' },
};

interface Asama {
  ad: string;
  durum: Durum;
  /** Bu asamanin sunucuda YAPTIGI is - kullanici "hangi komut kosuyor" diye soruyordu. */
  komut: string;
  /** Zaman, sonuc ya da kalan sure. */
  bilgi?: string;
}

/** Silme gunune kalan gun. `null` = tarih YOK (stop yapilmamis) - "0 gun" DEMEK DEGIL. */
export function kalanGun(effectiveDeleteAt: string | null, bugun = new Date()): number | null {
  if (!effectiveDeleteAt) return null;
  const hedef = new Date(`${effectiveDeleteAt}T00:00:00Z`).getTime();
  if (!Number.isFinite(hedef)) return null;
  const g = new Date(bugun).toISOString().slice(0, 10);
  const simdi = new Date(`${g}T00:00:00Z`).getTime();
  return Math.round((hedef - simdi) / 86400000);
}

/** Hedefin durumundan asama listesi. SAF fonksiyon - birebir test edilebilir. */
export function asamalar(rec: RtRecord, t: RtTarget, bugun = new Date()): Asama[] {
  const st = t.status;
  const stopBitti = Boolean(t.stoppedAt) || ['stopped', 'deleting', 'deleted', 'rolling_back', 'active', 'rollback_failed'].includes(st);
  const silindi = st === 'deleted' || Boolean(t.deletedAt);
  const geriAlindi = st === 'active' || Boolean(t.rolledBackAt);

  // ── Plan
  const planDurum: Durum =
    st === 'planning' ? 'suruyor'
    : st === 'pending' ? 'bekliyor'
    : st === 'skipped' ? 'atlandi'
    : 'bitti';

  // ── STOP
  const stopDurum: Durum =
    st === 'stopping' ? 'suruyor'
    : st === 'stop_scheduled' ? 'bekliyor'
    : st === 'failed' ? 'hata'
    : stopBitti ? 'bitti'
    : ['pending', 'planning', 'planned'].includes(st) ? 'bekliyor'
    : 'bilinmiyor';

  const stopBilgi =
    st === 'stop_scheduled' && t.scheduledAt
      ? `OCO penceresi: ${fmtDateTime(t.scheduledAt)}${t.windowEnd ? ` — ${fmtDateTime(t.windowEnd)}` : ''}`
      : t.stoppedAt
        ? fmtDateTime(t.stoppedAt)
        : st === 'failed'
          ? t.resultText || 'başarısız'
          : undefined;

  // ── Web (vhost)
  const web = t.webSonuc || [];
  const sayi = (d: string) => web.filter((w) => w.status === d).length;
  const webDurum: Durum =
    web.length === 0 ? (stopBitti ? 'atlandi' : 'bekliyor')
    : sayi('pending') > 0 ? 'bekliyor'
    : sayi('restoring') > 0 ? 'suruyor'
    : web.some((w) => w.status === 'failed' || w.status === 'restore_failed') ? 'hata'
    : web.some((w) => w.status === 'manual' || w.status === 'restore_manual') ? 'elle'
    : 'bitti';
  const webBilgi =
    web.length === 0
      ? 'kaldırılacak Apache/IHS vhost yok'
      : [
          sayi('ok') ? `${sayi('ok')} kaldırıldı` : '',
          sayi('manual') ? `${sayi('manual')} ELLE (NGINX)` : '',
          sayi('pending') ? `${sayi('pending')} bekliyor` : '',
          sayi('restoring') ? `${sayi('restoring')} geri açılıyor` : '',
          sayi('restore_manual') ? `${sayi('restore_manual')} elle geri açılmalı` : '',
          web.filter((w) => w.status === 'failed' || w.status === 'restore_failed').length
            ? `${web.filter((w) => w.status === 'failed' || w.status === 'restore_failed').length} HATA`
            : '',
        ].filter(Boolean).join(' · ');

  // ── Bekleme + DELETE
  const kg = kalanGun(rec.effectiveDeleteAt, bugun);
  const beklemeDurum: Durum =
    silindi ? 'bitti'
    : geriAlindi ? 'atlandi'
    : !stopBitti ? 'bekliyor'
    : kg === null ? 'bilinmiyor'
    : kg > 0 ? 'suruyor'
    : 'bitti';
  const beklemeBilgi =
    geriAlindi ? 'geri alındı — silme devre dışı'
    : rec.effectiveDeleteAt
      ? kg === null ? 'tarih okunamadı'
        : kg > 0 ? `${kg} gün kaldı — silme ${fmtDate(rec.effectiveDeleteAt)}`
        : kg === 0 ? `silme BUGÜN (${fmtDate(rec.effectiveDeleteAt)})`
        : `silme tarihi ${Math.abs(kg)} gün önce geçti (${fmtDate(rec.effectiveDeleteAt)})`
      : `tarih YOK — STOP yapılınca ${rec.deleteAfterDays} gün sonrası`;

  const delDurum: Durum =
    st === 'deleting' ? 'suruyor'
    : silindi ? 'bitti'
    : geriAlindi ? 'atlandi'
    : 'bekliyor';

  const liste: Asama[] = [
    {
      ad: '1 · Ön kontrol',
      durum: planDurum,
      komut: 'app_retirement_stop.yml · plan_only=true — sunucuya DOKUNMAZ, ne yapılacağını listeler (“Retirement’ı başlat”)',
      bilgi: t.planText || undefined,
    },
    {
      ad: '2 · STOP',
      durum: stopDurum,
      komut: 'auto-start=false → /server-group=<APP>_Group:stop-servers (STOPPED beklenir) → paketler .<smart>.old',
      bilgi: stopBilgi,
    },
    {
      ad: '3 · Web (vhost)',
      durum: webDurum,
      komut: 'server_hub_fix · apache_retire_vhost — yedek alır, apachectl -t geçmezse GERİ ALIR. NGINX otomatik DEĞİL',
      bilgi: webBilgi,
    },
    {
      ad: '4 · Bekleme',
      durum: beklemeDurum,
      komut: 'Portal poller’ı her turda silme gününü karşılaştırır; ekstra onay İSTENMEZ',
      bilgi: beklemeBilgi,
    },
    {
      ad: '5 · DELETE',
      durum: delDurum,
      komut: 'app_retirement_delete.yml — *.<smart>.old sil + deployment kaydı + boşsa server-group kaldır. GERİ ALINAMAZ',
      bilgi: silindi && t.deletedAt ? fmtDateTime(t.deletedAt) : undefined,
    },
  ];

  // ── Geri alma: YALNIZ ilgiliyse (gurultu yapmasin)
  if (['rolling_back', 'active', 'rollback_failed'].includes(st) || t.rolledBackAt) {
    liste.push({
      ad: '↩ Geri alma',
      durum: st === 'rolling_back' ? 'suruyor' : st === 'rollback_failed' ? 'hata' : 'bitti',
      komut: 'app_retirement_rollback.yml — paketler .old’dan kurtarılır → auto-start=true → JVM başlatılır',
      bilgi: t.rolledBackAt ? fmtDateTime(t.rolledBackAt) : t.resultText || undefined,
    });
  }

  // ── LB / IP / DNS: Portal bunu OTOMATIZE ETMIYOR, ama akistan DUSURMUYOR.
  liste.push({
    ad: '⚑ LB / IP / DNS',
    durum: 'elle',
    komut: 'Portal bu adımı ÇALIŞTIRMAZ — LB member, IP ve DNS kaydı Smart üzerinden ELLE',
    bilgi: `DNS yeniden kullanım: ${rec.dnsReuse ? 'evet' : 'hayır'} · LB: ${rec.lbReuse ? 'evet' : 'hayır'}`,
  });

  return liste;
}

export default function RetirementAkis({ rec, t }: { rec: RtRecord; t: RtTarget }) {
  const liste = asamalar(rec, t);
  return (
    <div className="space-y-1.5">
      {liste.map((a) => {
        const s = SIM[a.durum];
        return (
          <div key={a.ad} className="flex items-start gap-2 text-[11px]">
            <span className="w-4 text-center flex-shrink-0 font-semibold" style={{ color: s.renk }} title={a.durum}>
              {s.isaret}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-2 flex-wrap">
                <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>{a.ad}</span>
                <span style={{ color: s.renk }}>{a.durum}</span>
                {a.bilgi && <span style={{ color: 'var(--text-secondary)' }}>· {a.bilgi}</span>}
              </div>
              <div className="font-mono text-[10px] leading-snug" style={{ color: 'var(--text-muted)' }}>
                {a.komut}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
