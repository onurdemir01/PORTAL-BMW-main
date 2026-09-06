// src/components/common/ContextChips.tsx — sihirbazın her adımında görünen KÜNYE.
//
// NEDEN VAR: bu portalda bir işlem birden çok adımda kuruluyor (ortam → tenant →
// cluster → namespace → uygulama → işlem). Kullanıcı üçüncü adımda "ben hangi
// ortamdaydım?" diye sorduğunda ekranda cevabı YOKTU: künye yalnızca Telnet'te,
// yalnızca son adımda ve elle yazılmış hâlde duruyordu. ScaleX/LogX/OpsX/FileX'te
// hiç yoktu.
//
// Bu, kozmetik bir eksik değil: ScaleX'in sonu bir PROD kesintisi olabilir ve
// "hangi ortamdayım" sorusu kullanıcının kazara öğrenmemesi gereken bir bilgidir.
// ScopeStep zaten prod'u vurguluyordu ama YALNIZCA kendi adımında — sonraki dört
// adımda o vurgu kayboluyordu.
//
// TASARIM KARARI — bu bileşen KENDİSİ prod tespiti YAPMAZ. Ortam adının hangi
// değerinin prod sayıldığı sunucuda sabit bir karar (`server/oco/prod-detect.cjs`:
// bilerek yapılandırılamaz, çünkü bayat bir DB satırı güvenlik kapısını sessizce
// kapatabilirdi). Ekranın kendi kopyasını üretmek, iki gerçeğin sessizce ayrışması
// demekti; `tone` çağıran tarafından VERİLİR.
import React from 'react';

export interface ContextChip {
  /** Kısa etiket: "Ortam", "Tenant", "Cluster", "Namespace". */
  label: string;
  /** Gösterilecek değer. Boş/undefined ise çip HİÇ render edilmez — "Cluster: —"
   *  gibi bir satır bilgi vermez, yalnızca gürültü üretir. */
  value?: string | null;
  /** `danger` yalnızca gerçekten dikkat çekmesi gerekende (prod ortamı gibi).
   *  Her şeyi vurgulamak, hiçbir şeyi vurgulamamakla aynı şeydir. */
  tone?: 'neutral' | 'danger';
  /** Uzun değerlerde (namespace listesi) tam metin `title` olarak durur. */
  title?: string;
}

interface Props {
  items: ContextChip[];
  className?: string;
}

const ContextChips: React.FC<Props> = ({ items, className }) => {
  const visible = items.filter((c) => String(c.value ?? '').trim() !== '');
  if (visible.length === 0) return null;

  return (
    <div
      className={`flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-[var(--text-muted)] ${className || ''}`}
      // Adım değiştikçe künye de değişiyor; ekran okuyucu bunu sessizce geçmemeli.
      aria-label="Seçim künyesi"
    >
      {visible.map((c, i) => (
        <React.Fragment key={`${c.label}-${i}`}>
          {i > 0 && <span aria-hidden="true">·</span>}
          <span>
            {c.label}:{' '}
            <span
              title={c.title || String(c.value)}
              className={
                c.tone === 'danger'
                  ? 'font-mono font-semibold text-[var(--status-danger)]'
                  : 'font-mono text-[var(--text-primary)]'
              }
            >
              {c.value}
            </span>
          </span>
        </React.Fragment>
      ))}
    </div>
  );
};

export default ContextChips;
