// src/components/nginx_console/yukTesti/YukMakineleri.tsx — Yük Testi > Araçlar: yük makinesi listesi (2026-11-13).
//
// Kullanıcı: "bu değişikliği direkt Portal üzerinden yapamaz mıyız ya niye .env dosyasında işlem yapıyoruz".
// Liste Portal'da tutulur; yalnız Admin ekler / çıkarır. Eklenen makine sunucuda aynı kapıdan geçer (TEK HEDEF MODELI
// 2026-11-13: dbo.Inventory'de kayıtlı, tüm kayıtları DEV/TEST/QA, üretim işaretsiz, EDU değil; ad kuralı aranmaz); her
// koşu bunu yeniden ölçer, www ile SSH'ı ön kontrol kanıtlar. Liste boşken
// NGINX_LOADTEST_YUK_HOSTLARI (yoksa GBNGXT34) geçerlidir; ilk değişiklik o listeyi Portal'a taşır.
import React, { useCallback, useState } from 'react';
import { ArrowPathIcon, PlusIcon, TrashIcon } from '@heroicons/react/24/outline';
import { nginxLoadtestApi, type NlHedefler, type NlYukHost } from '@/api/nginxLoadtestApi';
import { useAsyncEffect } from '@/hooks/useAsyncEffect';
import { toast } from '@/hooks/useToast';
import { Modal } from '@/components/common/Modal';
import { fmtDateTime } from '@/utils/datetime';
import { BTN_TEHLIKE, SM_BTN, TBL_BTN, smBtn } from '@/components/server_hub/retirementStil';
import { Cip, UyariKutusu } from '@/components/server_hub/RetirementUi';
import { Alan, Bolum, GIRDI, girdiStili } from './YukUi';
import { hataMetni } from './yukTestiOrtak';

export const YUK_MAKINESI_ACIKLAMASI =
  'Yük bu makinelerden üretilir. Eklenen makine dbo.Inventory’de kayıtlı, tüm kayıtları DEV / TEST / QA, üretim işaretsiz ve EDU olmayan bir makine olmalı; ad kuralı aranmaz. Her ön kontrol ve koşu bunu yeniden denetler; www ile SSH’ı ön kontrol kanıtlar. Mümkünse reverse proxy olmayan bir makine seçin (ölçüm daha temiz).';
export const ORTAM_KAYNAGI_METNI =
  'Liste şu an Portal ortam değişkeninden (NGINX_LOADTEST_YUK_HOSTLARI, yoksa varsayılan GBNGXT34) geliyor. İlk ekleme ya da çıkarma bu listeyi Portal’a taşır; sonrasında ortam değişkeni okunmaz.';

const DEV_TEST_QA = new Set(['DEV', 'TEST', 'QA']);

export default function YukMakineleri({ isAdmin }: { isAdmin: boolean }) {
  const [veri, setVeri] = useState<NlHedefler | null>(null);
  const [hata, setHata] = useState('');
  const [yukleniyor, setYukleniyor] = useState(false);
  const [host, setHost] = useState('');
  const [not, setNot] = useState('');
  const [mesgul, setMesgul] = useState(false);
  const [cikarilacak, setCikarilacak] = useState<NlYukHost | null>(null);

  const yukle = useCallback(async () => {
    setYukleniyor(true);
    try {
      setVeri(await nginxLoadtestApi.hedefler());
      setHata('');
    } catch (e) {
      setHata(e instanceof Error ? e.message : String(e));
    } finally {
      setYukleniyor(false);
    }
  }, []);
  useAsyncEffect(async (alive) => { if (alive()) await yukle(); }, [yukle]);

  const liste = veri?.yukHostlari || [];
  const listede = new Set(liste.map((y) => y.host));
  // Öneri: envanterdeki uygun DEV / TEST / QA makineleri (karışık ortam 'QA/TEST' dahil; sunucu yine de kendi kapısından geçirir).
  const adaylar = (veri?.hedefler || []).filter((h) => h.uygun && String(h.env || '').toUpperCase().split('/').every((e) => DEV_TEST_QA.has(e)) && !listede.has(h.host)).map((h) => h.host);
  const yazilan = host.trim().toUpperCase();

  async function ekle() {
    if (!yazilan || mesgul) return;
    setMesgul(true);
    try {
      const r = await nginxLoadtestApi.yukMakinesiEkle({ host: yazilan, not: not.trim() || undefined });
      if (r.ok) {
        toast.success(`${yazilan} yük makinesi olarak eklendi.`);
        setHost('');
        setNot('');
        await yukle();
      } else toast.error(hataMetni(r, 'Yük makinesi eklenemedi.'));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setMesgul(false);
    }
  }

  async function cikar() {
    if (!cikarilacak || mesgul) return;
    setMesgul(true);
    try {
      const r = await nginxLoadtestApi.yukMakinesiCikar(cikarilacak.host);
      if (r.ok) {
        toast.success(`${cikarilacak.host} yük makinesi listesinden çıkarıldı.`);
        setCikarilacak(null);
        await yukle();
      } else toast.error(hataMetni(r, 'Yük makinesi çıkarılamadı.'));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setMesgul(false);
    }
  }

  return (
    <Bolum baslik="Yük makineleri" aciklama={YUK_MAKINESI_ACIKLAMASI} govdeSinifi="p-4 space-y-3"
      eylem={<button type="button" onClick={() => void yukle()} disabled={yukleniyor} className={TBL_BTN} style={smBtn()}><ArrowPathIcon className={`h-3.5 w-3.5 ${yukleniyor ? 'animate-spin motion-reduce:animate-none' : ''}`} aria-hidden /> Yenile</button>}>
      {hata && <UyariKutusu ton="hata" rol="alert" baslik="Yük makineleri okunamadı">{hata}</UyariKutusu>}
      {veri?.yukHostHatasi && <UyariKutusu ton="hata" rol="alert" baslik="Yük makinesi listesi okunamadı">{veri.yukHostHatasi}</UyariKutusu>}
      {veri?.yukHostKaynak === 'ortam' && <UyariKutusu ton="bilgi" baslik="Liste ortam değişkeninden">{ORTAM_KAYNAGI_METNI}</UyariKutusu>}

      {!veri && !hata ? (
        <div className="skeleton h-16 rounded-lg" aria-busy="true"><span className="sr-only">Yükleniyor…</span></div>
      ) : (
        <ul className="divide-y rounded-lg border" style={{ borderColor: 'var(--border-subtle)' }} aria-label="Yük makineleri" data-testid="yuk-makineleri">
          {liste.length === 0 && <li className="px-3 py-2 text-[12px]" style={{ color: 'var(--text-muted)' }}>Yük makinesi yok.</li>}
          {liste.map((y) => (
            <li key={y.host} className="flex flex-wrap items-center gap-2 px-3 py-2 text-[12px]" style={{ borderColor: 'var(--border-subtle)' }}>
              <span className="font-mono font-semibold" style={{ color: 'var(--text-primary)' }}>{y.host}</span>
              <Cip ton="notr" cerceve>{y.env || '?'}</Cip>
              {y.uygun ? <Cip ton="basari" cerceve>uygun</Cip> : <Cip ton="hata" cerceve title={y.neden || undefined}>uygun değil</Cip>}
              {!y.uygun && y.neden && <span className="min-w-0 wrap-anywhere" style={{ color: 'var(--status-danger-text)' }}>{y.neden}</span>}
              {y.not && <span className="min-w-0 wrap-anywhere" style={{ color: 'var(--text-secondary)' }}>{y.not}</span>}
              {y.ekleyen && <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>{`${y.ekleyen}${y.eklendi ? ` · ${fmtDateTime(y.eklendi)}` : ''}`}</span>}
              {isAdmin && (
                <button type="button" className={`${TBL_BTN} ml-auto`} style={smBtn()} disabled={mesgul || liste.length <= 1}
                  title={liste.length <= 1 ? 'Son yük makinesi çıkarılamaz; önce başka bir makine ekleyin.' : undefined}
                  aria-label={`${y.host} yük makinesini çıkar`} onClick={() => setCikarilacak(y)}>
                  <TrashIcon className="h-3.5 w-3.5" aria-hidden /> Çıkar
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {isAdmin && veri && !veri.yukHostHatasi && (
        <form className="grid items-end gap-3 rounded-lg border p-3 @lg/yuk:grid-cols-[minmax(0,14rem)_minmax(0,1fr)_auto]" style={{ borderColor: 'var(--border-subtle)' }}
          onSubmit={(e) => { e.preventDefault(); void ekle(); }}>
          <Alan id="yuk-makinesi-ekle" etiket="Makine" yardim="Envanterdeki DEV / TEST / QA makineleri önerilir; başka bir ad da yazılabilir.">
            <input id="yuk-makinesi-ekle" list="yuk-makinesi-adaylari" value={host} onChange={(e) => setHost(e.target.value)} placeholder="GBNGXT33"
              className={`${GIRDI} font-mono uppercase`} style={girdiStili()} autoComplete="off" />
            <datalist id="yuk-makinesi-adaylari">{adaylar.map((h) => <option key={h} value={h} />)}</datalist>
          </Alan>
          <Alan id="yuk-makinesi-not" etiket="Not (isteğe bağlı)">
            <input id="yuk-makinesi-not" value={not} onChange={(e) => setNot(e.target.value)} maxLength={300} placeholder="ör. reverse proxy değil, RHEL 8"
              className={GIRDI} style={girdiStili()} />
          </Alan>
          <button type="submit" className={`${SM_BTN} h-8 justify-center`} style={smBtn(true)} disabled={!yazilan || mesgul}>
            <PlusIcon className="h-3.5 w-3.5" aria-hidden /> {mesgul ? 'Ekleniyor…' : 'Ekle'}
          </button>
        </form>
      )}

      <Modal open={!!cikarilacak} onClose={() => { if (!mesgul) setCikarilacak(null); }} title="Yük makinesi çıkarılsın mı?" subtitle={cikarilacak?.host} size="sm" dismissOnBackdrop={false}
        footer={<div className="flex w-full justify-end gap-2">
          <button type="button" className={SM_BTN} style={smBtn()} disabled={mesgul} onClick={() => setCikarilacak(null)}>İptal</button>
          <button type="button" className={SM_BTN} style={BTN_TEHLIKE} disabled={mesgul} onClick={() => void cikar()}>
            <TrashIcon className="h-3.5 w-3.5" aria-hidden /> {mesgul ? 'Çıkarılıyor…' : 'Çıkar'}
          </button>
        </div>}>
        <p className="text-[13px] leading-5" style={{ color: 'var(--text-primary)' }}>
          {cikarilacak ? `${cikarilacak.host} yeni ön kontrol ve koşularda yük makinesi olarak seçilemez. Süren koşular etkilenmez; işlem denetime yazılır.` : ''}
        </p>
      </Modal>
    </Bolum>
  );
}
