// src/components/nginx_console/yukTesti/KayitliTest.tsx — "Yeni koşu" ustunde "Kayıtlı test" seridi (2026-11-04, Admin).
//
// Kullanici: "onden bir testi komple kaydedebiliyor muyuz ... onun ustunden hizlica tum senaryolari girmek istiyorum".
// Kayit formun etiketsiz govdesidir (hedef, yuk sunucusu, parametreler, sunucu ayari). HAR icermez: HAR Portal'a gitmez,
// kayit senaryo numarasina baglidir; senaryo silinmisse form "Senaryo" alaninda soyler. Liste okunamazsa form yine calisir.
import React, { useCallback, useState } from 'react';
import { nginxLoadtestApi, type NlKuyrukGovde, type NlSablon } from '@/api/nginxLoadtestApi';
import { useAsyncEffect } from '@/hooks/useAsyncEffect';
import { toast } from '@/hooks/useToast';
import { Modal } from '@/components/common/Modal';
import { BTN_TEHLIKE, SM_BTN, TBL_BTN, smBtn } from '@/components/server_hub/retirementStil';
import { UyariKutusu } from '@/components/server_hub/RetirementUi';
import { GIRDI, girdiStili } from './YukUi';
import { hataMetni } from './yukTestiOrtak';

const AD_MAX = 120;
const kontrolKarakteriVar = (s: string) => [...s].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127);
/** Ad kurali (sunucu sablon.cjs ile ayni): kirpilmis 1-120, kontrol karakteri yok. Bos ad hata yazmaz (dugme kapali). */
export function sablonAdiHatasi(ad: string): string | null {
  const a = ad.trim();
  if (a.length > AD_MAX) return `En çok ${AD_MAX} karakter.`;
  return kontrolKarakteriVar(a) ? 'Kontrol karakteri olamaz.' : null;
}

export default function KayitliTest({ govde, kapaliNedeni = null, onYukle }: {
  /** Formun etiketsiz gecerli govdesi; form eksikse ya da hedef turu bilinmiyorsa null (kaydetme kapali). */
  govde: NlKuyrukGovde | null; kapaliNedeni?: string | null; onYukle: (g: NlKuyrukGovde) => void;
}) {
  const [liste, setListe] = useState<NlSablon[] | null>(null);
  const [okumaHata, setOkumaHata] = useState('');
  const [seciliId, setSeciliId] = useState('');
  const [ad, setAd] = useState('');
  const [onay, setOnay] = useState<'guncelle' | 'sil' | null>(null);
  const [mesgul, setMesgul] = useState(false);
  const [hata, setHata] = useState('');
  const oku = useCallback(async () => {
    try {
      const r = await nginxLoadtestApi.sablonlar();
      setListe(r.sablonlar || []);
      setOkumaHata('');
    } catch (e) {
      setOkumaHata(e instanceof Error ? e.message : String(e));
    }
  }, []);
  useAsyncEffect(async (alive) => { if (alive()) await oku(); }, [oku]);

  const secili = liste?.find((s) => String(s.id) === seciliId) ?? null;
  const adHata = sablonAdiHatasi(ad);
  const kaydedilir = !!govde && !!ad.trim() && !adHata && !mesgul;

  async function calistir(fn: () => Promise<{ ok: boolean; id?: number; code?: string; message?: string }>, basari: string, sonra?: (id: number | undefined) => void) {
    setMesgul(true);
    setHata('');
    try {
      const r = await fn();
      if (!r.ok) { setHata(hataMetni(r, 'Kayıtlı test kaydedilemedi.')); return; }
      toast.success(basari);
      sonra?.(r.id);
      await oku();
    } catch (e) {
      setHata(e instanceof Error ? e.message : String(e));
    } finally {
      setMesgul(false);
      setOnay(null);
    }
  }
  const farkliKaydet = () => {
    if (!kaydedilir || !govde) return;
    const yeniAd = ad.trim();
    void calistir(() => nginxLoadtestApi.sablonEkle({ ad: yeniAd, govde }), `Kayıtlı test eklendi: ${yeniAd}.`, (id) => { setAd(''); if (id != null) setSeciliId(String(id)); });
  };
  const guncelle = () => {
    if (!secili || !govde) return;
    void calistir(() => nginxLoadtestApi.sablonGuncelle(secili.id, { ad: secili.ad, govde }), `“${secili.ad}” güncellendi.`);
  };
  const sil = () => {
    if (!secili) return;
    void calistir(() => nginxLoadtestApi.sablonSil(secili.id), `“${secili.ad}” silindi.`, () => setSeciliId(''));
  };
  const yukle = () => {
    if (!secili) return;
    onYukle(secili.govde);
    toast.success(`“${secili.ad}” forma yüklendi.`);
  };

  return (
    <section aria-label="Kayıtlı testler" className="min-w-0 space-y-2 rounded-xl border px-4 py-3" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-surface)' }}>
      <div className="flex flex-wrap items-end gap-x-3 gap-y-2">
        <div className="min-w-[12rem] flex-1">
          <label htmlFor="yuk-sablon" className="mb-1 block text-[11px] font-semibold leading-4" style={{ color: 'var(--text-secondary)' }}>Kayıtlı test</label>
          <select id="yuk-sablon" value={seciliId} onChange={(e) => setSeciliId(e.target.value)} className={GIRDI} style={girdiStili()}>
            <option value="">{liste && !liste.length ? '— henüz kayıt yok —' : '— seçin —'}</option>
            {(liste ?? []).map((s) => <option key={s.id} value={String(s.id)}>{s.ad}</option>)}
          </select>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <button type="button" onClick={yukle} disabled={!secili} className={`${SM_BTN} h-8`} style={smBtn(!!secili)}>Yükle</button>
          <button type="button" onClick={() => setOnay('guncelle')} disabled={!secili || !govde || mesgul} className={`${SM_BTN} h-8`} style={smBtn()} title="Seçili kaydı formun şu anki ayarlarıyla değiştirir.">Güncelle</button>
          <button type="button" onClick={() => setOnay('sil')} disabled={!secili || mesgul} className={`${SM_BTN} h-8`} style={smBtn()}>Sil</button>
        </div>
        <div className="flex min-w-[14rem] flex-1 items-end gap-1.5">
          <div className="min-w-0 flex-1">
            <label htmlFor="yuk-sablon-ad" className="mb-1 block text-[11px] font-semibold leading-4" style={{ color: 'var(--text-secondary)' }}>Yeni kayıt adı</label>
            <input id="yuk-sablon-ad" value={ad} maxLength={AD_MAX + 20} onChange={(e) => setAd(e.target.value)} autoComplete="off" className={GIRDI} style={girdiStili(!!adHata)} aria-invalid={!!adHata} />
          </div>
          <button type="button" onClick={farkliKaydet} disabled={!kaydedilir} className={`${SM_BTN} h-8`} style={smBtn()}>Farklı kaydet</button>
        </div>
      </div>
      <p className="text-[11px] leading-4" style={{ color: adHata ? 'var(--status-danger-text)' : 'var(--text-secondary)' }}>
        {adHata || kapaliNedeni || (govde ? 'Senaryo seçimi, hedef, yük sunucusu ve tüm ayarlar saklanır; HAR dosyası saklanmaz (kayıt senaryoya bağlıdır).' : 'Kaydetmek için önce formdaki eksikleri giderin.')}
      </p>
      {okumaHata && (
        <p className="flex flex-wrap items-center gap-2 text-[11px] leading-4" style={{ color: 'var(--status-warning-text)' }}>
          {`Kayıtlı testler okunamadı: ${okumaHata}`}
          <button type="button" onClick={() => void oku()} className={TBL_BTN} style={smBtn()}>Yenile</button>
        </p>
      )}
      {hata && <UyariKutusu ton="hata" baslik={hata} />}
      <Modal open={!!onay} onClose={() => { if (!mesgul) setOnay(null); }} title={onay === 'sil' ? 'Kayıtlı test silinsin mi?' : 'Kayıtlı test güncellensin mi?'} size="sm" dismissOnBackdrop={false}
        footer={<div className="flex w-full justify-end gap-2">
          <button type="button" className={SM_BTN} style={smBtn()} disabled={mesgul} onClick={() => setOnay(null)}>İptal</button>
          {onay === 'sil'
            ? <button type="button" className={SM_BTN} style={BTN_TEHLIKE} disabled={mesgul} onClick={sil}>{mesgul ? 'Siliniyor…' : 'Sil'}</button>
            : <button type="button" className={SM_BTN} style={smBtn(true)} disabled={mesgul} onClick={guncelle}>{mesgul ? 'Kaydediliyor…' : 'Güncelle'}</button>}
        </div>}>
        <p className="text-[13px] leading-5" style={{ color: 'var(--text-primary)' }}>
          <b>{secili?.ad}</b>{onay === 'sil' ? ' listeden kaldırılır. Bu kayıttan eklenmiş kuyruk öğeleri etkilenmez.' : ' formun şu anki ayarlarıyla değiştirilir.'}
        </p>
      </Modal>
    </section>
  );
}
