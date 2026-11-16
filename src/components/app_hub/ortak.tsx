// src/components/app_hub/ortak.tsx — Application Hub ortak parçaları: bölüm çerçevesi, JVM
// parametre görüntüleyici, kapasite hücresi, kaynak notu, durum hapı.
import React, { useState } from 'react';
import { ClipboardDocumentIcon, CheckIcon, ExclamationTriangleIcon, InformationCircleIcon } from '@heroicons/react/24/outline';
import type { JbossRetirement, Kapasite, KaynakDurumu } from '@/api/appHubApi';
import { fmtDate, fmtNumber } from '@/utils/datetime';

export const TIP_AD: Record<string, string> = { jboss: 'JBoss', was: 'WebSphere', ocp: 'OpenShift' };

export function TipHap({ tip }: { tip: string }) {
  const renk = tip === 'ocp' ? 'var(--status-danger)' : tip === 'was' ? 'var(--status-info)' : 'var(--ah-hue)';
  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold whitespace-nowrap"
      style={{ color: renk, border: `1px solid ${renk}`, background: 'var(--bg-surface)' }}
    >
      {TIP_AD[tip] || tip}
    </span>
  );
}

export function Hap({ ton, children, title }: { ton: 'iyi' | 'uyari' | 'kritik' | 'notr' | 'bilgi'; children: React.ReactNode; title?: string }) {
  const t = {
    iyi: { fg: 'var(--status-success)', bg: 'var(--status-success-bg)' },
    uyari: { fg: 'var(--status-warning-text)', bg: 'var(--status-warning-bg)' },
    kritik: { fg: 'var(--status-danger)', bg: 'var(--status-danger-bg)' },
    notr: { fg: 'var(--status-neutral)', bg: 'var(--status-neutral-bg)' },
    bilgi: { fg: 'var(--status-info)', bg: 'var(--status-info-bg)' },
  }[ton];
  return (
    <span title={title} className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold whitespace-nowrap" style={{ color: t.fg, background: t.bg, border: `1px solid ${t.fg}` }}>
      {children}
    </span>
  );
}

type RetirementliJvm = { calisiyor: boolean | null | undefined; retirement?: JbossRetirement | null };

/**
 * Retirement'ın JVM'e etkisi — sunucu satırı, ortam özeti ve JVM hapı için TEK kural (2026-11-16).
 * Karar sunucuda verilir, ekran yeniden hesaplamaz: `kapatildi` (hedef STOP / silme yapıldı) ve
 * `celiski` (Server Hub'ın STOP SONRASI taramayla kanıtladığı neden; zaman ve kök kapısı Server Hub'da).
 *   'celiski'   kapatılmış hedef + Server Hub kanıtlı çelişki (JVM çalışıyor / auto-start açık / paket diskte): kırmızı
 *   'dogrulama' kapatılmış hedef + JVM çalışıyor görünüyor ama Server Hub kanıtlamadı (STOP öncesi / aynı gün tarama): sarı
 *   'retire'    kapatılmış hedef + JVM kapalı, çelişki yok: beklenen kapanma, gri
 *   null        retirement yok, hedef kapatılmamış (pending / failed / rollback ...) ya da çalışma ölçülemedi: eski davranış
 */
export type RetireDurumu = 'celiski' | 'dogrulama' | 'retire' | null;
export function retireDurumu(j: RetirementliJvm): RetireDurumu {
  const r = j.retirement;
  if (!r || r.kapatildi !== true) return null;
  if (Array.isArray(r.celiski) && r.celiski.length > 0) return 'celiski';
  if (j.calisiyor === true) return 'dogrulama';
  if (j.calisiyor === false) return 'retire';
  return null;
}

const CELISKI_AD: Record<string, string> = {
  calisiyor: 'JVM çalışıyor',
  autostart: "auto-start AÇIK (reboot'ta geri gelir)",
  paket: 'paket özgün adıyla diskte',
};

/** "Retirement #12 · STOP 15.11.2026" (gün kurum saat diliminde; silinmişse "· silindi" eklenir). */
export function retirementMetni(r: JbossRetirement): string {
  return `Retirement #${r.kayit} · STOP ${r.durduruldu ? fmtDate(r.durduruldu) : 'tarihi bilinmiyor'}${r.durum === 'deleted' ? ' · silindi' : ''}`;
}

/**
 * Çalışma hapı. RETIREMENT (kullanıcı, 2026-11-16: "Retirement job'ına girmiş JBoss uygulamaları neden
 * kritik görünüyor?"): retireDurumu'na göre gri "Retire edildi", kırmızı çelişki ya da sarı "doğrulama
 * bekliyor". Retirement yoksa eski davranış.
 */
export function CalismaHap({
  calisiyor,
  retirement,
  retirementOkunamadi,
}: {
  calisiyor: boolean | null | undefined;
  retirement?: JbossRetirement | null;
  /** Retirement kayıtları okunamadı: kapalı JVM retire edilmiş olabilir (bilinmiyor). */
  retirementOkunamadi?: boolean;
}) {
  const rd = retireDurumu({ calisiyor, retirement });
  if (retirement && rd === 'retire')
    return (
      <Hap ton="notr" title={`${retirementMetni(retirement)}: JVM Retirement ile durduruldu (beklenen kapanma)`}>
        Retire edildi
      </Hap>
    );
  if (retirement && rd === 'celiski') {
    const neden = retirement.celiski.map((n) => CELISKI_AD[n] || n).join(', ');
    let durumAd = 'Ölçülemedi';
    if (calisiyor === true) durumAd = 'Çalışıyor';
    else if (calisiyor === false) durumAd = 'Kapalı';
    return (
      <Hap ton="kritik" title={`${retirementMetni(retirement)} ama STOP sonrası Server Hub taramasında: ${neden} (Retirement kaydıyla çelişki)`}>
        {durumAd} · Retirement ile çelişki
      </Hap>
    );
  }
  if (retirement && rd === 'dogrulama')
    return (
      <Hap
        ton="uyari"
        title={`${retirementMetni(retirement)}: JVM çalışıyor görünüyor ama Server Hub bunu STOP sonrası taramayla doğrulamadı (tarama STOP günü ya da öncesi, veya STOP zamanı bilinmiyor); bir sonraki taramada netleşir`}
      >
        Çalışıyor · doğrulama bekliyor
      </Hap>
    );
  if (calisiyor === true) return <Hap ton="iyi">Çalışıyor</Hap>;
  if (calisiyor === false)
    return (
      <Hap ton="kritik" title={retirementOkunamadi ? 'Retirement kayıtları okunamadı: bu JVM Retirement ile durdurulmuş olabilir (bilinmiyor)' : undefined}>
        Kapalı
      </Hap>
    );
  return <Hap ton="notr" title="Server Hub taramasında çalışma durumu ölçülemedi">Ölçülemedi</Hap>;
}

export function Bolum({ baslik, aciklama, sag, children }: { baslik: string; aciklama?: React.ReactNode; sag?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="card p-0 overflow-hidden">
      <header className="flex flex-wrap items-start justify-between gap-2 px-4 py-3" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
        <div>
          <h2 className="text-[15px] font-semibold" style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-display)' }}>{baslik}</h2>
          {aciklama && <p className="mt-0.5 text-[12px]" style={{ color: 'var(--text-muted)' }}>{aciklama}</p>}
        </div>
        {sag && <div className="flex items-center gap-2">{sag}</div>}
      </header>
      <div>{children}</div>
    </section>
  );
}

/** Kaynak okunamadıysa bölümün başında açık uyarı: "yok" ile "okunamadı" ayrı. */
export function KaynakUyarisi({ kaynaklar, adlar }: { kaynaklar: Record<string, KaynakDurumu>; adlar: Record<string, string> }) {
  const hatali = Object.entries(kaynaklar || {}).filter(([, v]) => v && v.hata);
  if (!hatali.length) return null;
  return (
    <div className="rounded px-3 py-2 text-[12px] space-y-1" role="alert" style={{ background: 'var(--status-warning-bg)', color: 'var(--status-warning-text)', border: '1px solid var(--status-warning)' }}>
      {hatali.map(([k, v]) => (
        <div key={k} className="flex items-start gap-1.5">
          <ExclamationTriangleIcon className="w-4 h-4 flex-shrink-0" />
          <span>
            <strong>{adlar[k] || k} okunamadı.</strong> Bu bölümdeki boşluk "yok" anlamına gelmez. <span className="opacity-80">({String(v.hata).slice(0, 200)})</span>
          </span>
        </div>
      ))}
    </div>
  );
}

export function KapasiteHucresi({ k }: { k: Kapasite | null }) {
  if (!k) return <span style={{ color: 'var(--text-muted)' }}>—</span>;
  return (
    <div className="leading-tight tabular-nums text-[12px]">
      <div style={{ color: 'var(--text-primary)' }}>
        {k.cpu != null ? `${k.cpu} vCPU` : '? vCPU'} · {k.bellekGb != null ? `${fmtNumber(k.bellekGb)} GB` : '? GB'}
      </div>
      {(k.os || k.osSurum) && (
        <div style={{ color: 'var(--text-muted)' }}>
          {[k.os, k.osSurum].filter(Boolean).join(' ')}
        </div>
      )}
    </div>
  );
}

// ── JVM parametreleri ─────────────────────────────────────────────────────────

export function argBol(s: string | null | undefined): string[] {
  return String(s || '')
    .split(/\s+/)
    .map((x) => x.trim())
    .filter(Boolean);
}

function Kopyala({ metin }: { metin: string }) {
  const [tamam, setTamam] = useState(false);
  return (
    <button
      type="button"
      className="pf-btn-link text-[12px] inline-flex items-center gap-1"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(metin);
          setTamam(true);
          setTimeout(() => setTamam(false), 1500);
        } catch {
          /* pano izni yoksa sessiz */
        }
      }}
    >
      {tamam ? <CheckIcon className="w-3.5 h-3.5" /> : <ClipboardDocumentIcon className="w-3.5 h-3.5" />}
      {tamam ? 'Kopyalandı' : 'Kopyala'}
    </button>
  );
}

/**
 * JVM argümanlarını YAZILDIKLARI SIRADA, kategorisiz gösterir (kullanıcı, 2026-11-12: "Bellek vs
 * diye kategorilendirme istemiyorum"). Yalnız parola / anahtar adlı -D değerleri "***" gelir.
 * `bosMetin`: argüman yoksa ne söyleneceği (ölçülmedi ile toplanmadı farklıdır).
 */
export function JvmArglari({ args, bosMetin, baslik, aciklama }: { args: string | null | undefined; bosMetin: React.ReactNode; baslik?: string; aciklama?: string }) {
  const tok = argBol(args);
  if (!tok.length) {
    return (
      <p className="text-[12px] flex items-start gap-1.5" style={{ color: 'var(--text-muted)' }}>
        <InformationCircleIcon className="w-4 h-4 flex-shrink-0" /> {bosMetin}
      </p>
    );
  }
  const gizli = tok.filter((t) => t.includes('***')).length;
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {baslik && <span className="text-[12px] font-semibold" style={{ color: 'var(--text-secondary)' }}>{baslik}</span>}
        <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
          {tok.length} parametre{gizli ? ` · ${gizli} parola değeri gizli` : ''}
        </span>
        <Kopyala metin={tok.join(' ')} />
      </div>
      {aciklama && (
        <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
          {aciklama}
        </p>
      )}
      <div className="flex flex-wrap gap-1" data-testid="jvm-arglari">
        {tok.map((t, i) => (
          <code
            key={`${t}-${i}`}
            title={t.includes('***') ? 'Parola / anahtar değeri gösterilmez' : undefined}
            className="px-1.5 py-0.5 rounded text-[11.5px] break-all"
            style={{
              fontFamily: 'var(--font-mono)',
              background: 'var(--bg-inset)',
              color: t.includes('***') ? 'var(--text-muted)' : 'var(--text-primary)',
              border: '1px solid var(--border-subtle)',
            }}
          >
            {t}
          </code>
        ))}
      </div>
    </div>
  );
}

export function Sayi({ v, birim }: { v: number | null | undefined; birim?: string }) {
  if (v == null) return <span style={{ color: 'var(--text-muted)' }}>—</span>;
  return (
    <span className="tabular-nums">
      {fmtNumber(v)}
      {birim ? ` ${birim}` : ''}
    </span>
  );
}

export function OzetKutusu({ etiket, deger, alt }: { etiket: string; deger: React.ReactNode; alt?: React.ReactNode }) {
  return (
    <div className="card px-4 py-3 min-w-0">
      <div className="text-[12px]" style={{ color: 'var(--text-muted)' }}>{etiket}</div>
      <div className="mt-1 truncate" title={typeof deger === 'string' ? deger : undefined} style={{ fontFamily: 'var(--font-display)', fontSize: '1.35rem', fontWeight: 500, color: 'var(--text-primary)' }}>
        {deger}
      </div>
      {alt && <div className="mt-0.5 text-[11px] truncate" title={typeof alt === 'string' ? alt : undefined} style={{ color: 'var(--text-muted)' }}>{alt}</div>}
    </div>
  );
}

export const TH = 'px-3 py-2 text-left text-[12px] font-semibold whitespace-nowrap';
export const TD = 'px-3 py-2 align-top text-[13px]';
