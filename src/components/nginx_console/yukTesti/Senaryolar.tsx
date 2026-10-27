// src/components/nginx_console/yukTesti/Senaryolar.tsx — "Senaryolar" alt gorunumu (2026-10-27).
//
// Liste herkese (sekme yetkisi olan); olusturma ve silme yalniz Admin. Olusturma iki yoldan:
//   - HAR: dosya TARAYICIDA okunur ve harSenaryo.ts (har_senaryo.py portu) ile ayristirilir; HAR, dosya adi,
//     baslik / cerez / govde Portal'a GITMEZ - yalniz yol satirlari ve sayisal OZET gider.
//   - Yol listesi: satir basina bir yol; ayni kurallar (beyaz liste, ? # yok, kisisel veri suphesi).
// Kaydetmeden once onizleme (OZET sayilari + satirlar) ve Portal kapisi (400 satir, 200 KB, // ve .. yok).
import React, { useCallback, useMemo, useRef, useState } from 'react';
import { ArrowUpTrayIcon, DocumentMagnifyingGlassIcon, PlusIcon, TrashIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { nginxLoadtestApi, type NlSenaryo, type NlSenaryoAyrinti } from '@/api/nginxLoadtestApi';
import { useAsyncEffect } from '@/hooks/useAsyncEffect';
import { toast } from '@/hooks/useToast';
import { Modal } from '@/components/common/Modal';
import { TableEmptyRow } from '@/components/common/EmptyState';
import { fmtDateTime, fmtNumber, fmtRelative } from '@/utils/datetime';
import { BTN_TEHLIKE, LINK, SM_BTN, TBL_BTN, TH_STIL, smBtn } from '@/components/server_hub/retirementStil';
import { Cip, Sayac, TabloIskelet, UyariKutusu, type Kolon } from '@/components/server_hub/RetirementUi';
import {
  EN_COK_SATIR, VARSAYILAN_BUYUK_ESIK, bicim, gonderilecekOzet, gonderimKapisi, senaryoUret, yolListesiSenaryosu,
  type SenaryoSatiri, type SenaryoSonucu,
} from './harSenaryo';
import { hataMetni, ondalik, vhostGecerli } from './yukTestiOrtak';
import { Alan, Bolum, GIRDI, GIRDI_TABAN, girdiStili } from './YukUi';

// Dort kolon (dar icerikte ad kolonu ezilmesin): olusturan / zaman senaryo hucresinin ucuncu satirinda.
const LISTE_KOLONLARI: Kolon[] = [
  { anahtar: 'ad', baslik: 'Senaryo' },
  { anahtar: 'tur', baslik: 'Tür · yol', genislik: '6.5rem' },
  { anahtar: 'vhost', baslik: 'Vhost', genislik: '30%' },
  { anahtar: 'eylem', baslik: '', genislik: '8rem' },
];
const SATIR_KOLONLARI: Kolon[] = [
  { anahtar: 'agirlik', baslik: 'Ağırlık', genislik: '5rem' },
  { anahtar: 'har', baslik: 'HAR', genislik: '3.5rem' },
  { anahtar: 'tur', baslik: 'Tür', genislik: '4.5rem' },
  { anahtar: 'boyut', baslik: 'Boyut', genislik: '4.5rem' },
  { anahtar: 'yolk', baslik: 'Yol' },
];
const ONIZLEME_SATIRI = 100;
const EN_BUYUK_HAR = 200 * 1024 * 1024;

export default function Senaryolar({ isAdmin, onDegisti }: { isAdmin: boolean; onDegisti?: () => void }) {
  const [liste, setListe] = useState<NlSenaryo[] | null>(null);
  const [hata, setHata] = useState('');
  const [yeniAcik, setYeniAcik] = useState(false);
  const [onizle, setOnizle] = useState<{ id: number; veri: NlSenaryoAyrinti | null; hata: string } | null>(null);
  const [silinecek, setSilinecek] = useState<NlSenaryo | null>(null);
  const [siliniyor, setSiliniyor] = useState(false);
  const busyRef = useRef(false);

  const yukle = useCallback(async () => {
    try {
      const r = await nginxLoadtestApi.senaryolar();
      setListe(r.senaryolar || []);
      setHata('');
    } catch (e) {
      setHata(e instanceof Error ? e.message : String(e));
    }
  }, []);
  useAsyncEffect(async (alive) => { if (alive()) await yukle(); }, [yukle]);

  async function onizlemeAc(id: number) {
    setOnizle({ id, veri: null, hata: '' });
    try {
      const r = await nginxLoadtestApi.senaryo(id);
      setOnizle((o) => (o && o.id === id ? { id, veri: r.senaryo, hata: '' } : o));
    } catch (e) {
      setOnizle((o) => (o && o.id === id ? { id, veri: null, hata: e instanceof Error ? e.message : String(e) } : o));
    }
  }
  async function sil() {
    if (!silinecek || busyRef.current) return;
    busyRef.current = true;
    setSiliniyor(true);
    try {
      const r = await nginxLoadtestApi.senaryoSil(silinecek.id);
      if (!r.ok) { toast.error(hataMetni(r, 'Silinemedi.')); return; }
      toast.success(`“${silinecek.ad}” silindi.`);
      setSilinecek(null);
      await yukle();
      onDegisti?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      busyRef.current = false;
      setSiliniyor(false);
    }
  }

  return (
    <div className="space-y-4">
      {isAdmin && yeniAcik && <YeniSenaryo onKapat={() => setYeniAcik(false)} onKaydedildi={() => { setYeniAcik(false); void yukle(); onDegisti?.(); }} />}
      <Bolum baslik="Senaryolar" aciklama="Yük testinin gönderdiği yollar ve ağırlıkları (K.tsv biçimi). Silinen senaryo listeden kalkar; ona dayanan koşular durur."
        govdeSinifi="p-0"
        eylem={isAdmin && !yeniAcik ? <button type="button" onClick={() => setYeniAcik(true)} className={SM_BTN} style={smBtn(true)}><PlusIcon className="h-3.5 w-3.5" aria-hidden /> Yeni senaryo</button> : undefined}>
        {hata && <div className="p-3"><UyariKutusu ton="hata" rol="alert" baslik="Senaryolar okunamadı">{hata}</UyariKutusu></div>}
        <div className="overflow-x-auto">
          <table className="pf-table-sticky w-full min-w-[32rem] table-fixed border-collapse" aria-label="Senaryolar">
            <TabloIskelet kolonlar={LISTE_KOLONLARI} />
            <tbody className="text-[12px]" style={{ color: 'var(--text-primary)' }}>
              {liste == null && !hata ? (
                <tr><td colSpan={LISTE_KOLONLARI.length} className="px-3 py-6"><div className="skeleton h-12 rounded-lg" aria-busy="true"><span className="sr-only">Senaryolar yükleniyor…</span></div></td></tr>
              ) : !liste?.length ? (
                <TableEmptyRow colSpan={LISTE_KOLONLARI.length} title="Henüz senaryo yok." description={isAdmin ? '“Yeni senaryo” ile bir HAR dosyasından ya da yol listesinden oluşturun.' : 'Senaryoları yöneticiler oluşturur.'} />
              ) : liste.map((s) => (
                <tr key={s.id} className="border-t align-top" style={{ borderColor: 'var(--border-subtle)' }}>
                  <td className="px-2.5 py-2">
                    <div className="truncate font-medium" title={s.ad}>{s.ad}</div>
                    <div className="truncate text-[11px]" style={{ color: 'var(--text-secondary)' }} title={s.aciklama || ''}>{s.aciklama || <span className="font-mono">sha256 {s.sha256.slice(0, 12)}…</span>}</div>
                    <div className="truncate text-[11px] tabular-nums" style={{ color: 'var(--text-muted)' }} title={`${s.createdBy || '—'} · ${fmtDateTime(s.createdAt)}`}>{`${s.createdBy || '—'} · ${fmtRelative(s.createdAt) || fmtDateTime(s.createdAt)}`}</div>
                  </td>
                  <td className="px-2.5 py-2">
                    <div className="flex items-center gap-1.5"><Cip ton={s.senaryoTur === 'K' ? 'aksan' : 'notr'} cerceve title={s.senaryoTur === 'K' ? 'karışık yük' : 'büyük dosyalar'}>{s.senaryoTur}</Cip><span className="tabular-nums">{fmtNumber(s.yolSayisi)}</span></div>
                    <div className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>yol</div>
                  </td>
                  <td className="px-2.5 py-2">
                    <div className="truncate" title={s.vhost || ''}>{s.vhost || '—'}</div>
                    <div className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>{s.kaynak === 'har' ? 'HAR’dan' : 'yol listesinden'}</div>
                  </td>
                  <td className="px-2.5 py-2">
                    <div className="flex flex-wrap justify-end gap-1.5">
                      <button type="button" onClick={() => void onizlemeAc(s.id)} className={TBL_BTN} style={smBtn()} aria-label={`${s.ad} önizle`}><DocumentMagnifyingGlassIcon className="h-3.5 w-3.5" aria-hidden /> Önizle</button>
                      {isAdmin && <button type="button" onClick={() => setSilinecek(s)} className={TBL_BTN} style={{ ...smBtn(), color: 'var(--status-danger-text)', borderColor: 'var(--status-danger)' }} aria-label={`${s.ad} sil`}><TrashIcon className="h-3.5 w-3.5" aria-hidden /></button>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Bolum>

      <Modal open={!!onizle} onClose={() => setOnizle(null)} title={onizle?.veri ? onizle.veri.ad : 'Senaryo'} subtitle={onizle?.veri ? `${onizle.veri.senaryoTur} · ${fmtNumber(onizle.veri.yolSayisi)} yol${onizle.veri.vhost ? ` · ${onizle.veri.vhost}` : ''}` : undefined} size="xl"
        footer={<div className="flex w-full justify-end"><button type="button" className={SM_BTN} style={smBtn()} onClick={() => setOnizle(null)}>Kapat</button></div>}>
        {onizle?.hata ? <UyariKutusu ton="hata" rol="alert" baslik="Senaryo okunamadı">{onizle.hata}</UyariKutusu>
          : !onizle?.veri ? <div className="skeleton h-40 rounded-lg" aria-busy="true"><span className="sr-only">Yükleniyor…</span></div>
            : <SatirTablosu satirlar={tsvSatirlari(onizle.veri.tsv)} sinir={EN_COK_SATIR} />}
      </Modal>

      <Modal open={!!silinecek} onClose={() => { if (!siliniyor) setSilinecek(null); }} title="Senaryo silinsin mi?" size="sm" dismissOnBackdrop={false}
        footer={<div className="flex w-full justify-end gap-2">
          <button type="button" className={SM_BTN} style={smBtn()} disabled={siliniyor} onClick={() => setSilinecek(null)}>İptal</button>
          <button type="button" className={SM_BTN} style={BTN_TEHLIKE} disabled={siliniyor} onClick={() => void sil()}><TrashIcon className="h-3.5 w-3.5" aria-hidden /> {siliniyor ? 'Siliniyor…' : 'Sil'}</button>
        </div>}>
        <p className="text-[13px] leading-5" style={{ color: 'var(--text-primary)' }}>
          <b>{silinecek?.ad}</b> listeden kaldırılır. Geçmiş koşuların sonuçları kalır; bu senaryoyla yeni koşu başlatılamaz.
        </p>
      </Modal>
    </div>
  );
}

/** Kayitli TSV -> satirlar (onizleme; basliksiz ya da `agirlik` baslikli). */
function tsvSatirlari(tsv: string): SenaryoSatiri[] {
  return String(tsv || '').split('\n').filter((s) => s.trim() && !s.startsWith('agirlik\t')).map((s) => {
    const p = s.split('\t');
    return { agirlik: Number(p[0]), har: Number(p[1]), tur: (p[2] || 'diger') as SenaryoSatiri['tur'], boyut: (p[3] || 'kucuk') as SenaryoSatiri['boyut'], yol: p[4] ?? '' };
  });
}

function SatirTablosu({ satirlar, sinir = ONIZLEME_SATIRI }: { satirlar: SenaryoSatiri[]; sinir?: number }) {
  const gorunen = satirlar.slice(0, sinir);
  return (
    <div className="space-y-1">
      <div className="max-h-[22rem] overflow-auto rounded-lg border" style={{ borderColor: 'var(--border-subtle)' }}>
        <table className="pf-table-sticky w-full table-fixed border-collapse" aria-label="Senaryo satırları">
          <TabloIskelet kolonlar={SATIR_KOLONLARI} />
          <tbody className="text-[12px]" style={{ color: 'var(--text-primary)' }}>
            {gorunen.length === 0 ? <TableEmptyRow colSpan={SATIR_KOLONLARI.length} title="Satır yok." /> : gorunen.map((s, i) => (
              <tr key={`${s.yol}-${i}`} className="border-t" style={{ borderColor: 'var(--border-subtle)' }}>
                <td className="px-2.5 py-1 tabular-nums">{Number.isFinite(s.agirlik) ? bicim(s.agirlik) : '—'}</td>
                <td className="px-2.5 py-1 tabular-nums">{s.har}</td>
                <td className="px-2.5 py-1">{s.tur}</td>
                <td className="px-2.5 py-1">{s.boyut}</td>
                <td className="truncate px-2.5 py-1 font-mono text-[11px]" title={s.yol}>{s.yol}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {satirlar.length > gorunen.length && <p className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>{fmtNumber(satirlar.length)} satırın ilk {fmtNumber(gorunen.length)} tanesi gösteriliyor.</p>}
    </div>
  );
}

// ── Yeni senaryo ────────────────────────────────────────────────────────────────────
interface Dosya { ad: string; boyut: number; metin: string; agirlik: string }
type Kaynak = 'har' | 'liste';

function YeniSenaryo({ onKapat, onKaydedildi }: { onKapat: () => void; onKaydedildi: () => void }) {
  const [kaynak, setKaynak] = useState<Kaynak>('har');
  const [ad, setAd] = useState('');
  const [aciklama, setAciklama] = useState('');
  const [vhost, setVhost] = useState('');
  const [dosyalar, setDosyalar] = useState<Dosya[]>([]);
  const [okunuyor, setOkunuyor] = useState(false);
  const [okumaHata, setOkumaHata] = useState('');
  const [sorguAt, setSorguAt] = useState(false);
  const [esik, setEsik] = useState(String(VARSAYILAN_BUYUK_ESIK));
  const [harSonuc, setHarSonuc] = useState<{ imza: string; r: SenaryoSonucu } | null>(null);
  const [listeMetni, setListeMetni] = useState('');
  const [tur, setTur] = useState<'K' | 'B'>('K');
  const [kaydediliyor, setKaydediliyor] = useState(false);
  const [kayitHata, setKayitHata] = useState('');
  const dosyaRef = useRef<HTMLInputElement>(null);
  const busyRef = useRef(false);

  const vhostTamam = vhostGecerli(vhost);
  const esikSayi = /^\d+$/.test(esik.trim()) ? Number(esik) : NaN;
  const harImza = JSON.stringify([vhost, sorguAt, esikSayi, dosyalar.map((d) => [d.ad, d.boyut, d.agirlik])]);
  const harGuncel = !!harSonuc && harSonuc.imza === harImza;
  const listeSonuc = useMemo(() => (listeMetni.trim() ? yolListesiSenaryosu(listeMetni) : null), [listeMetni]);

  function ayristir(liste = dosyalar) {
    if (!liste.length) { setHarSonuc(null); return; }
    const r = senaryoUret(liste.map((d) => ({ ad: d.ad, metin: d.metin, agirlik: Number(d.agirlik.replace(',', '.')) })), { host: vhost, sorguAt, buyukEsik: esikSayi });
    setHarSonuc({ imza: JSON.stringify([vhost, sorguAt, esikSayi, liste.map((d) => [d.ad, d.boyut, d.agirlik])]), r });
    if (r.ok && !r.B.length) setTur('K');
  }
  async function dosyaSec(files: FileList | null) {
    if (!files || !files.length) return;
    setOkumaHata('');
    const secilen = Array.from(files);
    const buyuk = secilen.find((f) => f.size > EN_BUYUK_HAR);
    if (buyuk) { setOkumaHata(`${buyuk.name} ${Math.round(buyuk.size / 1048576)} MB — tarayıcıda en çok ${EN_BUYUK_HAR / 1048576} MB okunur.`); return; }
    setOkunuyor(true);
    try {
      const yeni = await Promise.all(secilen.map(async (f) => ({ ad: f.name, boyut: f.size, metin: await f.text(), agirlik: '1' })));
      const liste = [...dosyalar, ...yeni];
      setDosyalar(liste);
      if (vhostTamam && Number.isInteger(esikSayi) && esikSayi > 0) ayristir(liste);
    } catch (e) {
      setOkumaHata(`HAR okunamadı: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setOkunuyor(false);
      if (dosyaRef.current) dosyaRef.current.value = '';
    }
  }

  const satirlar: SenaryoSatiri[] = kaynak === 'har'
    ? (harGuncel && harSonuc?.r.ok ? (tur === 'K' ? harSonuc.r.K : harSonuc.r.B) : [])
    : (listeSonuc?.ok ? listeSonuc.K : []);
  const kapi = satirlar.length ? gonderimKapisi(satirlar) : [];
  const adTamam = ad.trim().length > 0 && ad.trim().length <= 120;
  const vhostZorunlu = kaynak === 'har';
  const vhostHata = vhost ? (vhostTamam ? '' : 'Küçük harf ad yazın (port, joker yok).') : vhostZorunlu ? 'HAR’daki istekler bu ada göre süzülür.' : '';
  const kaydedilir = adTamam && !vhostHata && aciklama.length <= 500 && satirlar.length > 0 && !kapi.length && !kaydediliyor;

  async function kaydet() {
    if (!kaydedilir || busyRef.current) return;
    busyRef.current = true;
    setKaydediliyor(true);
    setKayitHata('');
    try {
      const ozet = kaynak === 'har' && harSonuc?.r.ok ? { ...gonderilecekOzet(harSonuc.r.ozet), kaydedilen: tur }
        : listeSonuc?.ok ? { satir: listeSonuc.satir, tekrar: listeSonuc.tekrar, tekilYol: listeSonuc.K.length } : undefined;
      const r = await nginxLoadtestApi.senaryoKaydet({
        ad: ad.trim(), ...(aciklama.trim() ? { aciklama: aciklama.trim() } : {}), ...(vhost ? { vhost } : {}), senaryoTur: tur, kaynak,
        satirlar: satirlar.map((s) => ({ agirlik: s.agirlik, har: s.har, tur: s.tur, boyut: s.boyut, yol: s.yol })), ozet,
      });
      if (!r.ok) { setKayitHata(hataMetni(r, 'Senaryo kaydedilemedi.')); return; }
      toast.success(`Senaryo kaydedildi${r.id != null ? ` (#${r.id})` : ''}: ${fmtNumber(satirlar.length)} satır.`);
      onKaydedildi();
    } catch (e) {
      setKayitHata(e instanceof Error ? e.message : String(e));
    } finally {
      busyRef.current = false;
      setKaydediliyor(false);
    }
  }

  const r = harSonuc?.r;
  return (
    <Bolum baslik="Yeni senaryo" aciklama="HAR dosyası bu tarayıcıda okunur; Portal’a yalnız yol satırları ve sayısal özet gönderilir (başlık, çerez, gövde, sorgu dizesi, yoldaki “;” parametresi ve dosya adı gönderilmez)."
      eylem={<button type="button" onClick={onKapat} className={TBL_BTN} style={smBtn()} aria-label="Yeni senaryoyu kapat"><XMarkIcon className="h-3.5 w-3.5" aria-hidden /> Kapat</button>}
      govdeSinifi="p-4 space-y-4">
      <div role="radiogroup" aria-label="Kaynak" className="flex w-fit gap-1 rounded-lg p-0.5" style={{ background: 'var(--bg-elevated)' }}>
        {([['har', 'HAR dosyasından'], ['liste', 'Yol listesinden']] as const).map(([k, etiket]) => (
          <button key={k} type="button" role="radio" aria-checked={kaynak === k} onClick={() => setKaynak(k)} className={`h-7 rounded-md px-3 text-[12px] font-medium ${kaynak === k ? 'shadow-sm' : ''}`}
            style={kaynak === k ? { background: 'var(--bg-surface)', color: 'var(--text-primary)', boxShadow: 'inset 0 0 0 1px var(--border)' } : { color: 'var(--text-secondary)' }}>{etiket}</button>
        ))}
      </div>

      <div className="grid gap-3 @lg/yuk:grid-cols-2">
        <Alan id="sen-ad" etiket="Ad" hata={ad && !adTamam ? 'En çok 120 karakter.' : null} yardim="ör. “GLOMO giriş sayfası — 3 HAR”">
          <input id="sen-ad" value={ad} onChange={(e) => setAd(e.target.value)} maxLength={120} autoComplete="off" className={GIRDI} style={girdiStili()} />
        </Alan>
        <Alan id="sen-vhost" etiket={vhostZorunlu ? 'Vhost (HAR’daki host)' : 'Vhost (isteğe bağlı)'} hata={vhost || vhostZorunlu ? vhostHata || null : null} yardim="Yalnız bu host’a giden istekler tutulur.">
          <input id="sen-vhost" value={vhost} onChange={(e) => setVhost(e.target.value.trim().toLowerCase())} placeholder="ornek-test.fw.garantibbva.com.tr" autoComplete="off" spellCheck={false} className={GIRDI} style={girdiStili(!!vhost && !vhostTamam)} />
        </Alan>
        <Alan id="sen-aciklama" etiket="Açıklama (isteğe bağlı)" className="@lg/yuk:col-span-2" hata={aciklama.length > 500 ? 'En çok 500 karakter.' : null}>
          <input id="sen-aciklama" value={aciklama} onChange={(e) => setAciklama(e.target.value)} maxLength={500} autoComplete="off" className={GIRDI} style={girdiStili()} />
        </Alan>
      </div>

      {kaynak === 'har' ? (
        <div className="space-y-3">
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <input ref={dosyaRef} type="file" accept=".har,.json,application/json" multiple className="hidden" onChange={(e) => void dosyaSec(e.target.files)} aria-label="HAR dosyası seç" />
              <button type="button" onClick={() => dosyaRef.current?.click()} disabled={okunuyor} className={SM_BTN} style={smBtn(!dosyalar.length)}><ArrowUpTrayIcon className="h-3.5 w-3.5" aria-hidden /> {okunuyor ? 'Okunuyor…' : dosyalar.length ? 'HAR ekle' : 'HAR seç'}</button>
            </div>
            <label className="flex cursor-pointer items-center gap-2 text-[12px]" style={{ color: 'var(--text-primary)' }}>
              <input type="checkbox" className="accent-[var(--accent)]" checked={sorguAt} onChange={(e) => setSorguAt(e.target.checked)} />
              Sorgulu isteklerin yolunu tut (sorguyu at)
            </label>
            <div className="w-44">
              <Alan id="sen-esik" etiket="Büyük dosya eşiği (bayt)" hata={Number.isInteger(esikSayi) && esikSayi > 0 ? null : 'Pozitif tam sayı'}>
                <input id="sen-esik" value={esik} onChange={(e) => setEsik(e.target.value)} inputMode="numeric" className={`${GIRDI} tabular-nums`} style={girdiStili(!(Number.isInteger(esikSayi) && esikSayi > 0))} />
              </Alan>
            </div>
            <button type="button" onClick={() => ayristir()} disabled={!dosyalar.length || !vhostTamam || !(Number.isInteger(esikSayi) && esikSayi > 0)} className={SM_BTN} style={smBtn(!!dosyalar.length && !harGuncel)}>Ayrıştır</button>
          </div>
          {okumaHata && <UyariKutusu ton="hata" rol="alert" baslik={okumaHata} />}
          {dosyalar.length > 0 && (
            <ul className="divide-y rounded-lg border" style={{ borderColor: 'var(--border-subtle)' }} aria-label="Seçilen HAR dosyaları">
              {dosyalar.map((d, i) => (
                <li key={`${d.ad}-${i}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-1.5 text-[12px]" style={{ borderColor: 'var(--border-subtle)' }}>
                  <Cip cerceve>HAR {i + 1}</Cip>
                  <span className="min-w-0 flex-1 truncate" title={d.ad}>{d.ad}</span>
                  <span className="tabular-nums" style={{ color: 'var(--text-secondary)' }}>{fmtNumber(Math.round(d.boyut / 1024))} KB</span>
                  <label className="flex items-center gap-1.5" style={{ color: 'var(--text-secondary)' }}>
                    sayfa ağırlığı
                    <input value={d.agirlik} onChange={(e) => setDosyalar((l) => l.map((x, j) => (j === i ? { ...x, agirlik: e.target.value } : x)))} inputMode="decimal" className={`${GIRDI_TABAN} h-7 w-16 tabular-nums`} style={girdiStili(!(Number(d.agirlik.replace(',', '.')) > 0))} aria-label={`HAR ${i + 1} sayfa ağırlığı`} />
                  </label>
                  <button type="button" onClick={() => setDosyalar((l) => l.filter((_, j) => j !== i))} className={LINK} style={{ color: 'var(--text-secondary)' }} aria-label={`${d.ad} çıkar`}>çıkar</button>
                </li>
              ))}
            </ul>
          )}
          {dosyalar.length > 0 && harSonuc && !harGuncel && <p className="text-[11px]" style={{ color: 'var(--status-warning-text)' }}>Ayarlar ya da dosyalar değişti — “Ayrıştır” ile yeniden ayrıştırın.</p>}
          {r && harGuncel && (r.ok ? <HarOzetPaneli r={r} tur={tur} onTur={setTur} /> : (
            <UyariKutusu ton={r.kod === 3 ? 'hata' : 'uyari'} rol="alert" baslik={r.kod === 3 ? 'Güvenlik reddi — hiçbir satır üretilmedi' : 'HAR işlenemedi'}>{r.mesaj}</UyariKutusu>
          ))}
        </div>
      ) : (
        <div className="space-y-3">
          <Alan id="sen-liste" etiket="Yollar (satır başına bir yol)" yardim="Yalnız yol yazın (/ ile başlar); sorgu dizesi (?), parça (#), “;” parametresi (ör. ;jsessionid), boşluk ve kişisel veri içeren yol reddedilir. Aynı yol tekrar ederse ağırlığı artar.">
            <textarea id="sen-liste" value={listeMetni} onChange={(e) => setListeMetni(e.target.value)} rows={8} spellCheck={false} placeholder={'/app-v1/\n/app-v1/assets/index.js\n/app-v1/assets/index.css'}
              className="w-full rounded-lg border px-2.5 py-2 font-mono text-[12px] leading-5 outline-none focus:border-[var(--accent)]" style={girdiStili(!!listeSonuc && !listeSonuc.ok)} />
          </Alan>
          {listeSonuc && !listeSonuc.ok && (
            <UyariKutusu ton="hata" rol="alert" baslik={`${listeSonuc.sorunlar.length} satır kurala uymuyor`}>
              <ul className="space-y-0.5">{listeSonuc.sorunlar.slice(0, 8).map((s) => <li key={`${s.satir}-${s.neden}`}><span className="tabular-nums">satır {s.satir}</span>: {s.neden}{s.iskelet ? <span className="font-mono" style={{ color: 'var(--text-secondary)' }}> · {s.iskelet}</span> : null}</li>)}</ul>
              {listeSonuc.sorunlar.length > 8 && <p className="mt-1">… ve {listeSonuc.sorunlar.length - 8} satır daha.</p>}
            </UyariKutusu>
          )}
          {listeSonuc?.ok && (
            <div className="flex flex-wrap items-center gap-2 text-[12px]">
              <Sayac etiket="satır" n={listeSonuc.satir} />
              <Sayac etiket="tekil yol" n={listeSonuc.K.length} />
              {listeSonuc.tekrar > 0 && <Sayac etiket="tekrar (ağırlığa eklendi)" n={listeSonuc.tekrar} />}
              <span className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>Boyut bilinmediği için her yol “kucuk” yazılır.</span>
              <label className="ml-auto flex items-center gap-2" style={{ color: 'var(--text-secondary)' }}>
                Senaryo türü
                <select value={tur} onChange={(e) => setTur(e.target.value as 'K' | 'B')} className={`${GIRDI_TABAN} h-8 w-40`} style={girdiStili()}>
                  <option value="K">K — karışık yük</option>
                  <option value="B">B — büyük dosyalar</option>
                </select>
              </label>
            </div>
          )}
        </div>
      )}

      {satirlar.length > 0 && <SatirTablosu satirlar={satirlar} />}
      {kapi.length > 0 && <UyariKutusu ton="hata" rol="alert" baslik="Bu senaryo kaydedilemez"><ul className="list-disc space-y-0.5 pl-4">{kapi.map((k) => <li key={k}>{k}</li>)}</ul></UyariKutusu>}
      {kayitHata && <UyariKutusu ton="hata" rol="alert" baslik="Kaydedilemedi">{kayitHata}</UyariKutusu>}
      <div className="flex flex-wrap items-center justify-end gap-2 border-t pt-3" style={{ borderColor: 'var(--border-subtle)' }}>
        <span className="mr-auto text-[11px]" style={{ color: 'var(--text-secondary)' }}>{satirlar.length ? `${fmtNumber(satirlar.length)} satır gönderilecek (${tur}).` : 'Önizleme hazır değil.'}</span>
        <button type="button" onClick={onKapat} className={SM_BTN} style={smBtn()} disabled={kaydediliyor}>İptal</button>
        <button type="button" onClick={() => void kaydet()} disabled={!kaydedilir} className={SM_BTN} style={smBtn(true)}>{kaydediliyor ? 'Kaydediliyor…' : 'Senaryoyu kaydet'}</button>
      </div>
    </Bolum>
  );
}

/** HAR ayristirma ozeti: HAR basina elenen / tur / boyut sayilari ve toplam (OZET.txt'nin ekrandaki hali). */
function HarOzetPaneli({ r, tur, onTur }: { r: SenaryoSonucu; tur: 'K' | 'B'; onTur: (t: 'K' | 'B') => void }) {
  const t = r.ozet.toplam;
  const cipler = (c: Record<string, number>) => Object.keys(c).sort().map((k) => <Cip key={k} cerceve>{`${k} ${fmtNumber(c[k])}`}</Cip>);
  // OZET.txt'deki NOT satiri ASCII (el kiti); ekranda ayni bilgi Turkce cumleyle.
  const pay304 = t.k304Agirlik && t.kToplamAgirlik ? (100 * t.k304Agirlik) / t.kToplamAgirlik : 0;
  // Portal'a ozgu sayac (el kiti ';' atmaz, OZET.txt'de yok): oturum kimligi tasiyabilen yol parametresi atilan istek.
  const parametresiAtilan = r.ozet.harlar.reduce((a, h) => a + (h.parametresiAtilan || 0), 0);
  return (
    <div className="space-y-3">
      <div className="overflow-x-auto rounded-lg border" style={{ borderColor: 'var(--border-subtle)' }}>
        <table className="w-full min-w-[32rem] table-fixed border-collapse" aria-label="HAR özeti">
          <colgroup><col style={{ width: '4.5rem' }} /><col style={{ width: '13rem' }} /><col /></colgroup>
          <thead><tr>
            <th scope="col" className="px-2.5 py-1.5 text-left text-[11px]" style={TH_STIL}>HAR</th>
            <th scope="col" className="px-2.5 py-1.5 text-left text-[11px]" style={TH_STIL}>Giriş → kalan → tekil</th>
            <th scope="col" className="px-2.5 py-1.5 text-left text-[11px]" style={TH_STIL}>Elenen · tür · boyut</th>
          </tr></thead>
          <tbody className="text-[12px]" style={{ color: 'var(--text-primary)' }}>
            {r.ozet.harlar.map((h) => (
              <tr key={h.n} className="border-t align-top" style={{ borderColor: 'var(--border-subtle)' }}>
                <td className="px-2.5 py-1.5"><Cip cerceve>{`HAR ${h.n}`}</Cip></td>
                <td className="px-2.5 py-1.5 tabular-nums">
                  <div>{fmtNumber(h.toplamGiris)} → {fmtNumber(h.kalan)} → {fmtNumber(h.tekilYol)}</div>
                  <div className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>{fmtNumber(Math.round(h.hamBayt / 1024))} KB · 304: {fmtNumber(h.kosullu304)}{h.sorgusuAtilan ? ` · sorgusu atılan ${fmtNumber(h.sorgusuAtilan)}` : ''}{h.parametresiAtilan ? ` · “;” parametresi atılan ${fmtNumber(h.parametresiAtilan)}` : ''}{h.belgeIlkSatirda ? '' : ' · belge yok'}</div>
                </td>
                <td className="px-2.5 py-1.5">
                  <div className="flex flex-wrap gap-1">{Object.keys(h.elenen).length ? cipler(h.elenen) : <span style={{ color: 'var(--text-muted)' }}>elenen yok</span>}</div>
                  <div className="mt-1 flex flex-wrap items-center gap-1"><span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>tür</span>{cipler(h.tur)}<span className="ml-1 text-[11px]" style={{ color: 'var(--text-muted)' }}>boyut</span>{cipler(h.boyut)}</div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Sayac etiket="K satır" n={t.kSatir} />
        <Sayac etiket="B satır" n={t.bSatir} />
        {parametresiAtilan > 0 && <span title="Yoldaki “;” ve sonrası (ör. ;jsessionid=…) her segmentten atıldı; aynı yol tekilleştirildi. Oturum kimliği senaryoya girmez."><Sayac etiket="“;” parametresi atılan yol" n={parametresiAtilan} ton="uyari" /></span>}
        <span className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>K toplam ağırlık {bicim(t.kToplamAgirlik)} · ağırlıklı ort. ham {fmtNumber(t.kAgirlikliOrtHamBayt)} bayt · 304 ağırlığı {bicim(t.k304Agirlik)}</span>
        <div role="radiogroup" aria-label="Kaydedilecek senaryo" className="ml-auto flex gap-1 rounded-lg p-0.5" style={{ background: 'var(--bg-elevated)' }}>
          {(['K', 'B'] as const).map((k) => (
            <button key={k} type="button" role="radio" aria-checked={tur === k} disabled={k === 'B' && !t.bSatir} onClick={() => onTur(k)} className={`h-7 rounded-md px-2.5 text-[11px] font-medium disabled:opacity-40 ${tur === k ? 'shadow-sm' : ''}`}
              style={tur === k ? { background: 'var(--bg-surface)', color: 'var(--text-primary)', boxShadow: 'inset 0 0 0 1px var(--border)' } : { color: 'var(--text-secondary)' }}>
              {k === 'K' ? `K — karışık (${fmtNumber(t.kSatir)})` : `B — büyük (${fmtNumber(t.bSatir)})`}
            </button>
          ))}
        </div>
      </div>
      {pay304 > 0 && (
        <p className="text-[11px] leading-4" style={{ color: 'var(--text-secondary)' }}>
          Not: K ağırlığının %{ondalik(pay304, 1)} kadarı tarayıcıda 304 (koşullu GET, gövdesiz) idi. Yük testi koşulsuz gönderir; sunucu 200 ve tam gövde döner,
          CPU-ms/istek ve bayt/istek biraz yüksek çıkar. Bütün adımlarda aynı oynatıldığı için karşılaştırmaya etkisi küçüktür.
        </p>
      )}
      <details className="text-[11px]">
        <summary className="cursor-pointer" style={{ color: 'var(--accent)' }}>OZET.txt (el kitiyle aynı biçim)</summary>
        <pre className="mt-1 max-h-60 overflow-auto rounded-lg border p-2 font-mono text-[11px] leading-4" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-elevated)', color: 'var(--text-primary)' }}>{r.ozetMetni.join('\n')}</pre>
      </details>
    </div>
  );
}
