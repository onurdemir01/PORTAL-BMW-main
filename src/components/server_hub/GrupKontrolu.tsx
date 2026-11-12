// src/components/server_hub/GrupKontrolu.tsx — Retirement Analizi: grup kararı ve elle kontrol (Faz 2b, 2026-11-11).
//
// docs/RETIREMENT-MOTOR-BIRLESTIRME.md: karar birimi uygulama + ORTAM + NESİL. Elle kontrol (doğrulandı / yanlış
// alarm) bu gruba ve kararın kanıt imzasına bağlıdır; kanıt değişince "veri değişti" olur. "Retirement kaydı aç"
// YALNIZ grup "Retire adayı" ve doğrulanmışsa görünür (Faz 0'da kaldırılan doğrulamasız yol bu kapıyla geri döndü).
import React, { useState } from 'react';
import { serverHubApi, type ShGrupKarar, type ShGrupKontrolDurum } from '@/api/serverHubApi';
import { toast } from '@/hooks/useToast';
import Rozet, { type DurumTon } from './DurumRozeti';
import { BTN, btnStil } from './RetireEtiketleri';

const KONTROL: Record<ShGrupKontrolDurum, { metin: string; ton: DurumTon }> = {
  BEKLIYOR: { metin: 'kontrol bekliyor', ton: 'notr' },
  DOGRULANDI: { metin: 'doğrulandı', ton: 'iyi' },
  YANLIS_ALARM: { metin: 'yanlış alarm', ton: 'notr' },
  VERI_DEGISTI: { metin: 'veri değişti — yeniden bakın', ton: 'uyari' },
  BILINMIYOR: { metin: 'kontrol okunamadı', ton: 'kotu' },
};
const KARAR: Record<string, { metin: string; ton: DurumTon }> = {
  KULLANIMDA: { metin: 'Kullanımda', ton: 'iyi' },
  RETIRE_ADAYI: { metin: 'Retire adayı', ton: 'kotu' },
  SUPHELI: { metin: 'Şüpheli', ton: 'uyari' },
  KARAR_VERILEMEZ: { metin: 'Karar verilemez', ton: 'uyari' },
  SORUN_YOK: { metin: 'Sorun yok', ton: 'notr' },
};
const MUTED: React.CSSProperties = { color: 'var(--text-muted)' };

function GrupSatiri({
  g,
  onDegisti,
  onRetirementAc,
}: {
  g: ShGrupKarar;
  onDegisti: (g: ShGrupKarar) => void;
  onRetirementAc?: (uygulama: string, not: string) => void;
}) {
  const [form, setForm] = useState<null | 'DOGRULANDI' | 'YANLIS_ALARM'>(null);
  const [not, setNot] = useState('');
  const [mesgul, setMesgul] = useState(false);
  const k = KONTROL[g.durum];
  const kr = KARAR[g.karar] || { metin: g.kararMetni, ton: 'notr' as DurumTon };
  async function yaz(sonuc: 'DOGRULANDI' | 'YANLIS_ALARM' | 'GERI_AL') {
    setMesgul(true);
    try {
      const r = await serverHubApi.iliskiGrupKontrol({ anahtar: g.anahtar, sonuc, aciklama: not.trim(), imza: g.imza });
      onDegisti(r.grup);
      setForm(null);
      setNot('');
      toast.success(sonuc === 'GERI_AL' ? 'Kontrol geri alındı.' : sonuc === 'DOGRULANDI' ? 'Grup doğrulandı.' : 'Yanlış alarm olarak işaretlendi.');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setMesgul(false);
    }
  }
  return (
    <li className="rounded-lg border px-3 py-2 space-y-2" style={{ borderColor: 'var(--border-subtle)' }} data-testid="grup-satiri">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="font-semibold">{g.ortam || 'ortam bilinmiyor'}</span>
        <span style={MUTED}>{g.nesil === 'WAS' ? 'WebSphere' : g.nesil === '?' ? 'JBoss nesli bilinmiyor' : `JBoss ${g.nesil}`}</span>
        <Rozet metin={kr.metin} ton={kr.ton} />
        <Rozet metin={k.metin} ton={k.ton} />
        <span style={MUTED}>{g.ozet}</span>
        {g.kayitHazir && onRetirementAc && (
          <button
            type="button"
            className={`${BTN} ml-auto`}
            style={btnStil(true)}
            onClick={() =>
              onRetirementAc(
                g.ad,
                `Retirement Analizi: ${g.ad} · ${g.ortam} · ${g.nesil === 'WAS' ? 'WebSphere' : `JBoss ${g.nesil}`} retire adayı; ` +
                  `${g.kontrol?.isaretleyen || '?'} doğruladı: ${g.kontrol?.aciklama || ''}`,
              )
            }
          >
            Retirement kaydı aç
          </button>
        )}
      </div>
      {g.kontrol && (
        <div className="text-[11px]" style={MUTED}>
          {g.kontrol.isaretleyen} · {g.kontrol.aciklama}
        </div>
      )}
      {form ? (
        <div className="space-y-1.5">
          <label className="block text-[11px] font-semibold" htmlFor={`grup-not-${g.anahtar}`}>
            {form === 'DOGRULANDI' ? 'Neye bakıldı, kim onayladı?' : 'Neden yanlış alarm?'} <span style={MUTED}>(zorunlu)</span>
          </label>
          <textarea
            id={`grup-not-${g.anahtar}`}
            value={not}
            onChange={(e) => setNot(e.target.value)}
            rows={2}
            maxLength={1000}
            className="w-full px-2 py-1.5 text-xs border rounded-lg"
            style={{ borderColor: 'var(--border)', background: 'var(--bg-surface)', color: 'var(--text-primary)' }}
          />
          <div className="flex gap-2 justify-end">
            <button type="button" className={BTN} style={btnStil()} onClick={() => setForm(null)} disabled={mesgul}>
              İptal
            </button>
            <button type="button" className={BTN} style={btnStil(true)} onClick={() => yaz(form)} disabled={mesgul || not.trim().length < 5}>
              Kaydet
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {g.karar === 'RETIRE_ADAYI' && g.durum !== 'DOGRULANDI' && g.durum !== 'BILINMIYOR' && (
            <button type="button" className={BTN} style={btnStil()} onClick={() => setForm('DOGRULANDI')}>
              Doğrulandı olarak işaretle
            </button>
          )}
          {g.durum !== 'YANLIS_ALARM' && g.durum !== 'BILINMIYOR' && (g.karar === 'RETIRE_ADAYI' || g.karar === 'SUPHELI') && (
            <button type="button" className={BTN} style={btnStil()} onClick={() => setForm('YANLIS_ALARM')}>
              Yanlış alarm
            </button>
          )}
          {g.kontrol && g.durum !== 'BILINMIYOR' && (
            <button type="button" className={BTN} style={btnStil()} onClick={() => yaz('GERI_AL')} disabled={mesgul}>
              Kontrolü geri al
            </button>
          )}
        </div>
      )}
    </li>
  );
}

export default function GrupKontrolu({
  gruplar,
  okunamadi,
  onRetirementAc,
}: {
  gruplar: ShGrupKarar[];
  okunamadi?: boolean;
  onRetirementAc?: (uygulama: string, not: string) => void;
}) {
  const [liste, setListe] = useState(gruplar);
  if (!liste.length) return null;
  return (
    <div className="space-y-1.5" data-testid="grup-kontrolu">
      <div className="text-[11px] font-semibold" style={MUTED}>
        Ortam ve kurulum bazında karar · Retirement kaydı yalnız doğrulanmış “Retire adayı” gruptan açılır
      </div>
      {okunamadi && (
        <div className="text-xs" style={{ color: 'var(--status-danger)' }}>
          Elle kontrol kayıtları okunamadı; hiçbir grup doğrulanmış sayılmaz.
        </div>
      )}
      <ul className="space-y-1.5">
        {liste.map((g) => (
          <GrupSatiri
            key={g.anahtar}
            g={g}
            onRetirementAc={onRetirementAc}
            onDegisti={(yeni) => setListe((l) => l.map((x) => (x.anahtar === yeni.anahtar ? yeni : x)))}
          />
        ))}
      </ul>
    </div>
  );
}
