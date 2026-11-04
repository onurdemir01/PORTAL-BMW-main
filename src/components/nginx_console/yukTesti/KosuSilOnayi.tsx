// src/components/nginx_console/yukTesti/KosuSilOnayi.tsx — koşu / ön kontrol kaydını silme onayı (2026-11-04).
//
// Kullanici: "istedigim yuk testi sonuclarini kaldirabilmek istiyorum". Tekli silmede (koşu ayrıntısı) KOŞU NUMARASI,
// toplu silmede (Koşular listesi, en çok 50) SEÇİLEN SAYI elle yazilir (yapistirma kapali; sunucu da ayni metni ister).
// Silinen: Portal'daki kayit ve adim sonuclari. /sw altindaki ham olcum dosyalarina DOKUNULMAZ (pencere bunu soyler).
// Hepsi ya da hic: sunucu silinemeyenleri nedeniyle dondurur (suren, kilitli, gece kuyrugunda bekleyen / calisan, dayanan
// kosusu olan on kontrol); pencere listeyi gosterir, toplu silmede "Silinemeyenleri seçimden çıkar" sunar.
// Pencere girdi tasir: arka plana tiklamak kapatmaz; "İptal" ve Esc kapatir (gonderim surerken degil).
import React, { useState } from 'react';
import { ExclamationTriangleIcon, TrashIcon } from '@heroicons/react/24/outline';
import { nginxLoadtestApi, type NlKosu, type NlSilEngeli, type NlSilinen } from '@/api/nginxLoadtestApi';
import { Modal } from '@/components/common/Modal';
import { BTN_TEHLIKE, SM_BTN, TBL_BTN, smBtn } from '@/components/server_hub/retirementStil';
import { GIRDI_TABAN, girdiStili, islemEtiketi } from './YukUi';
import { hataMetni, hedefEtiketi } from './yukTestiOrtak';

export type SilinecekKosu = Pick<NlKosu, 'id' | 'islem' | 'etiket' | 'hedefHost' | 'hedefIp'>;

export const HAM_DOSYA_NOTU = 'Sunucudaki ham ölçüm dosyaları (/sw altındaki koşu dizini) silinmez; yalnız Portal’daki kayıt ve adım sonuçları kaldırılır.';

/** Tekli: koşu numarası ("12" ya da "#12"); toplu: seçilen sayı. Sunucunun kuralının aynası. */
export function onayUyar(yazilan: string, beklenen: string, toplu: boolean): boolean {
  const t = yazilan.trim();
  return t === beklenen || (!toplu && t === `#${beklenen}`);
}

export default function KosuSilOnayi({ kosular, toplu, onKapat, onSilindi, onSecimdenCikar }: {
  kosular: SilinecekKosu[]; toplu: boolean; onKapat: () => void; onSilindi: (silinen: NlSilinen[]) => void;
  /** Yalniz toplu: sunucunun silinemez dedigi kayitlari secimden cikarir. */
  onSecimdenCikar?: (idler: number[]) => void;
}) {
  const [yazilan, setYazilan] = useState('');
  const [mesgul, setMesgul] = useState(false);
  const [hata, setHata] = useState<string | null>(null);
  const [engeller, setEngeller] = useState<NlSilEngeli[]>([]);
  const tek = kosular[0];
  const beklenen = toplu ? String(kosular.length) : String(tek?.id ?? '');
  const tamam = onayUyar(yazilan, beklenen, toplu);
  const baslik = toplu ? `${kosular.length} kayıt silinsin mi?` : `${islemEtiketi(tek?.islem ?? 'kosu')} #${tek?.id} silinsin mi?`;

  async function sil() {
    if (!tamam || mesgul || !kosular.length) return;
    setMesgul(true);
    setHata(null);
    setEngeller([]);
    try {
      const r = toplu ? await nginxLoadtestApi.kosulariSil(kosular.map((k) => k.id), yazilan.trim()) : await nginxLoadtestApi.kosuSil(tek.id, yazilan.trim());
      if (r.ok) {
        onSilindi(r.silinen || []);
        return;
      }
      setEngeller(Array.isArray(r.silinemeyenler) ? r.silinemeyenler : []);
      setHata(Array.isArray(r.silinemeyenler) && r.silinemeyenler.length
        ? (toplu ? `${r.silinemeyenler.length} kayıt silinemiyor; hiçbir kayıt silinmedi.` : 'Silinemedi; hiçbir kayıt silinmedi.')
        : hataMetni(r, 'Silinemedi.'));
    } catch (e) {
      setHata(e instanceof Error ? e.message : String(e));
    } finally {
      setMesgul(false);
    }
  }

  return (
    <Modal open onClose={() => { if (!mesgul) onKapat(); }} title={baslik} icon={TrashIcon} size="md" dismissOnBackdrop={false}
      footer={
        <div className="flex w-full flex-wrap items-center justify-end gap-2">
          <button type="button" className={SM_BTN} style={smBtn()} disabled={mesgul} onClick={onKapat}>İptal</button>
          <button type="button" className={SM_BTN} style={BTN_TEHLIKE} disabled={!tamam || mesgul} onClick={() => void sil()}>
            <TrashIcon className="h-3.5 w-3.5" aria-hidden /> {mesgul ? 'Siliniyor…' : toplu ? `${kosular.length} kaydı sil` : 'Sil'}
          </button>
        </div>
      }>
      <div className="space-y-3 text-[12px]" style={{ color: 'var(--text-primary)' }}>
        <p className="leading-5">
          {toplu ? 'Seçilen kayıtlar ve adım sonuçları Portal’dan kalıcı olarak silinir; geri alınamaz. Biri bile silinemezse hiçbiri silinmez.' : 'Kayıt ve adım sonuçları Portal’dan kalıcı olarak silinir; geri alınamaz.'}
        </p>
        <p className="leading-5" style={{ color: 'var(--text-secondary)' }}>{HAM_DOSYA_NOTU}</p>
        <ul className="max-h-48 space-y-0.5 overflow-y-auto rounded-lg px-3 py-2" style={{ background: 'var(--bg-elevated)' }} aria-label="Silinecek kayıtlar">
          {kosular.map((k) => (
            <li key={k.id} className="flex min-w-0 items-baseline gap-2">
              <span className="font-mono font-semibold tabular-nums">#{k.id}</span>
              <span className="shrink-0" style={{ color: 'var(--text-secondary)' }}>{islemEtiketi(k.islem)}</span>
              <span className="min-w-0 truncate" title={k.etiket || undefined}>{k.etiket || <span style={{ color: 'var(--text-muted)' }}>etiketsiz</span>}</span>
              <span className="ml-auto shrink-0 font-mono" style={{ color: 'var(--text-secondary)' }}>{hedefEtiketi(k) || '—'}</span>
            </li>
          ))}
        </ul>
        <div>
          <label htmlFor="yuk-sil-onay" className="mb-1 block" style={{ color: 'var(--text-secondary)' }}>
            {toplu ? 'Onaylamak için seçilen kayıt sayısını yazın:' : 'Onaylamak için koşu numarasını yazın:'} <span className="font-mono font-semibold" style={{ color: 'var(--text-primary)' }}>{beklenen}</span>
          </label>
          <input id="yuk-sil-onay" value={yazilan} onChange={(e) => setYazilan(e.target.value)} onPaste={(e) => e.preventDefault()} onDrop={(e) => e.preventDefault()}
            onKeyDown={(e) => { if (e.key === 'Enter') void sil(); }} autoComplete="off" spellCheck={false} inputMode="numeric" disabled={mesgul} placeholder={beklenen}
            aria-invalid={!!yazilan && !tamam} className={`${GIRDI_TABAN} h-9 w-40 font-mono text-[13px]`} style={girdiStili(!!yazilan && !tamam)} />
        </div>
        {hata && (
          <div role="alert" className="space-y-1.5 leading-5" style={{ color: 'var(--status-danger-text)' }}>
            <div className="flex items-start gap-2"><ExclamationTriangleIcon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> <span>{hata}</span></div>
            {engeller.length > 0 && <ul className="list-disc space-y-0.5 pl-6" aria-label="Silinemeyen kayıtlar">{engeller.map((x) => <li key={`${x.id}-${x.kod}`}>{x.metin}</li>)}</ul>}
            {toplu && onSecimdenCikar && engeller.length > 0 && engeller.length < kosular.length && (
              <button type="button" className={TBL_BTN} style={smBtn()} onClick={() => onSecimdenCikar(engeller.map((x) => x.id))}>Silinemeyenleri seçimden çıkar</button>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
