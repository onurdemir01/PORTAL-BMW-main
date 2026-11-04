// src/components/nginx_console/yukTesti/GeceKuyrugu.tsx — Yük Testi › "Gece kuyruğu" (2026-11-03).
//
// Kullanici: "gece boyunca ardi ardina test kosulari yapmak istiyorum ... kac test girdiysem hepsi arka arkaya
// sabaha kadar bitsin." Kuyruk SUNUCUDA yurur (server/nginx-loadtest/kuyruk.cjs); bu ekran taslagi kurar ve durumu
// gosterir. Taslak ogeleri "Yeni koşu" formundaki "Kuyruğa ekle" ile gelir (etiket zorunlu). Olusturma: bekleme
// (1–30 dk, kosu kilidi birakildiktan SONRA), baslangic (hemen / saat), istege bagli en gec bitis, hedef adi bir
// kez yazilarak onay ve sunucunun dondurdugu uyari TURLERININ tek tek onayi. Gece yeni tur cikan oge ATLANIR.
// Kuyruk "İptal": sonraki ogeler baslamaz; suren kosu DURMAZ (kosu ayrintisindaki Durdur ile ayrica).
// `onKarsilastir`: "Hepsini karşılaştır" (2026-11-04 bagli: Çoklu karşılaştırma, ref = ilk biten oge); biten kosularin
// numaralari kuyruk sirasiyla; verilmezse dugme cizilmez. Kosu silme (2026-11-04): silinmis kosu / on kontrol "(silindi)"
// diye baglantisiz gosterilir (sunucunun kosuSilindi / onKontrolSilindi alani) ve karsilastirmaya gitmez.
// `onTopluRapor` (2026-11-04): kuyrugun tum kosulari tek rapor; en az bir kosusu olan kuyrukta acik.
import React, { useCallback, useEffect, useState } from 'react';
import { ArrowDownIcon, ArrowLeftIcon, ArrowPathIcon, ArrowUpIcon, MoonIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { nginxLoadtestApi, type NlKuyruk, type NlKuyrukOge, type NlUyariTuru } from '@/api/nginxLoadtestApi';
import { toast } from '@/hooks/useToast';
import { useAsyncEffect } from '@/hooks/useAsyncEffect';
import { LINK, SM_BTN, TBL_BTN, smBtn } from '@/components/server_hub/retirementStil';
import { Hap, UyariKutusu } from '@/components/server_hub/RetirementUi';
import { sureMetni } from '@/components/server_hub/retirementCikti';
import { Alan, Bolum, GIRDI, girdiStili } from './YukUi';
import { hataMetni } from './yukTestiOrtak';
import {
  BEKLEME_VARSAYILAN_DK, KUYRUK_DURUMU, OGE_DURUMU, baslangicSecimi, gunFarki, gunSaatMetni, kalanMetni, saatMetni, sonrakiSaat, tasi, type TaslakOge,
} from './kuyrukTaslak';

const YOKLAMA_MS = 10000;
const AKTIF = new Set(['BEKLIYOR', 'CALISIYOR', 'DINLENME']);

export interface GeceKuyruguProps {
  isAdmin: boolean;
  taslak: TaslakOge[];
  setTaslak: (t: TaslakOge[]) => void;
  onKosuAc: (kosuId: number) => void;
  onYeniKosu?: () => void;
  /** "Hepsini karşılaştır": kuyruktaki biten kosularin numaralari (sirayla; ilki referans). Verilmezse dugme yok. */
  onKarsilastir?: (kosuIdleri: number[]) => void;
  /** "Toplu rapor": kuyruk numarasi. Verilmezse dugme yok. */
  onTopluRapor?: (kuyrukId: number) => void;
}

export default function GeceKuyrugu({ isAdmin, taslak, setTaslak, onKosuAc, onYeniKosu, onKarsilastir, onTopluRapor }: GeceKuyruguProps) {
  const [liste, setListe] = useState<NlKuyruk[] | null>(null);
  const [hata, setHata] = useState('');
  const [secili, setSecili] = useState<number | null>(null);
  const yukle = useCallback(async () => {
    try {
      setListe((await nginxLoadtestApi.kuyruklar()).kuyruklar || []);
      setHata('');
    } catch (e) {
      setHata(e instanceof Error ? e.message : String(e));
    }
  }, []);
  useAsyncEffect(async (alive) => { if (alive()) await yukle(); }, [yukle]);

  if (secili != null) {
    return <KuyrukAyrinti key={secili} id={secili} isAdmin={isAdmin} onKosuAc={onKosuAc} onKarsilastir={onKarsilastir} onTopluRapor={onTopluRapor} onGeri={() => { setSecili(null); void yukle(); }} />;
  }
  return (
    <div className="space-y-4" data-gece-kuyrugu>
      {isAdmin && <YeniKuyruk taslak={taslak} setTaslak={setTaslak} onYeniKosu={onYeniKosu} onOlustu={(id) => { setSecili(id); }} />}
      <Bolum baslik="Kuyruklar" aciklama="Sunucuda yürür: ekranı kapatsanız da koşular sırayla başlar. Portal yeniden başlarsa kuyruk kaldığı yerden devam eder.">
        {hata ? (
          <UyariKutusu ton="hata" rol="alert" baslik="Kuyruklar okunamadı" eylem={<button type="button" onClick={() => void yukle()} className={TBL_BTN} style={smBtn()}>Yeniden dene</button>}>{hata}</UyariKutusu>
        ) : !liste ? (
          <div className="skeleton h-16 rounded-lg" aria-busy="true"><span className="sr-only">Yükleniyor…</span></div>
        ) : !liste.length ? (
          <p className="text-[12px]" style={{ color: 'var(--text-secondary)' }}>Henüz kuyruk yok.</p>
        ) : (
          <ul className="divide-y" style={{ borderColor: 'var(--border-subtle)' }}>
            {liste.map((k) => (
              <li key={k.id} className="flex flex-wrap items-center gap-2 py-2 text-[12px]">
                <button type="button" onClick={() => setSecili(k.id)} className={`${LINK} text-[12px]`} style={{ color: 'var(--accent)' }}>{`Kuyruk #${k.id}${k.ad ? ` · ${k.ad}` : ''}`}</button>
                <DurumHap durum={k.durum} />
                <span className="font-mono" style={{ color: 'var(--text-primary)' }}>{k.onayHedefi}</span>
                <span className="tabular-nums" style={{ color: 'var(--text-secondary)' }}>{`${k.bitenSayisi ?? 0}/${k.ogeSayisi ?? 0} öğe · bekleme ${k.beklemeDk} dk · başlangıç ${gunSaatMetni(k.baslangicAt)}${k.enGecBitis ? ` · en geç ${gunSaatMetni(k.enGecBitis)}` : ''}`}</span>
                <span className="ml-auto" style={{ color: 'var(--text-muted)' }}>{k.createdBy || ''}</span>
              </li>
            ))}
          </ul>
        )}
      </Bolum>
    </div>
  );
}

function DurumHap({ durum, oge = false }: { durum: string; oge?: boolean }) {
  const d = (oge ? OGE_DURUMU : KUYRUK_DURUMU)[durum as keyof typeof OGE_DURUMU & keyof typeof KUYRUK_DURUMU] || { etiket: durum, ton: 'notr' as const };
  return <Hap label={d.etiket} ton={d.ton} nabiz={!!d.canli} />;
}

/** Taslak + olusturma formu (yalniz Admin). */
function YeniKuyruk({ taslak, setTaslak, onYeniKosu, onOlustu }: { taslak: TaslakOge[]; setTaslak: (t: TaslakOge[]) => void; onYeniKosu?: () => void; onOlustu: (id: number) => void }) {
  const [bekleme, setBekleme] = useState(String(BEKLEME_VARSAYILAN_DK));
  const [hemen, setHemen] = useState(true);
  const [basSaat, setBasSaat] = useState('00:00');
  const [bitisAcik, setBitisAcik] = useState(false);
  const [bitisSaat, setBitisSaat] = useState('07:00');
  const [onay, setOnay] = useState('');
  const [turler, setTurler] = useState<NlUyariTuru[] | null>(null);
  const [onayli, setOnayli] = useState<Set<string>>(new Set());
  const [mesgul, setMesgul] = useState(false);
  const [hataMsg, setHataMsg] = useState('');
  const hedefler = [...new Set(taslak.map((o) => o.hedef))];
  const hedef = hedefler.length === 1 ? hedefler[0] : null;
  const dk = /^\s*\d+\s*$/.test(bekleme) ? Number(bekleme) : NaN;
  const beklemeHata = !(dk >= 1 && dk <= 30) ? '1–30 dk arasında bir tam sayı.' : null;
  const simdi = new Date();
  // Secilen saat az once (en cok 10 dk) gectiyse "hemen" sayilir; aksi halde 24 saat sonraya kayardi.
  const secim = hemen ? null : baslangicSecimi(basSaat, simdi);
  const baslangic = secim && secim.tur === 'saat' ? secim.an : null;
  const bitis = bitisAcik ? sonrakiSaat(bitisSaat, baslangic ?? simdi) : null;
  const basKalanSn = baslangic ? (baslangic.getTime() - simdi.getTime()) / 1000 : 0;
  const basMetni = hemen ? 'hemen'
    : secim?.tur === 'gecti' ? `hemen (${basSaat} ${secim.dkOnce} dk önce geçti)`
      : baslangic ? `${gunFarki(baslangic, simdi) === 1 ? 'yarın ' : ''}${saatMetni(baslangic.toISOString())} (${kalanMetni(basKalanSn)} sonra)` : '—';
  const toplamSn = taslak.reduce((t, o) => t + 300 + (o.butceSn || 0), 0) + Math.max(0, taslak.length - 1) * (Number.isFinite(dk) ? dk : 5) * 60;
  const turlerTamam = !turler || turler.every((t) => onayli.has(t.kod));
  const hazir = taslak.length > 0 && !!hedef && !beklemeHata && (hemen || !!secim) && (!bitisAcik || !!bitis) && onay.trim() === hedef && turlerTamam && !mesgul;

  async function olustur() {
    if (!hazir) return;
    setMesgul(true);
    setHataMsg('');
    try {
      const r = await nginxLoadtestApi.kuyrukOlustur({
        beklemeDk: dk, baslangic: baslangic ? baslangic.toISOString() : null, enGecBitis: bitis ? bitis.toISOString() : null, confirmText: onay.trim(),
        onaylananTurler: [...onayli], ogeler: taslak.map((o) => ({ etiket: o.etiket, govde: o.govde, onKontrolKosuId: o.onKontrolKosuId })),
      });
      if (r.ok && r.id != null) {
        toast.success(`Gece kuyruğu #${r.id} oluşturuldu (${taslak.length} öğe).`);
        setTaslak([]);
        onOlustu(r.id);
        return;
      }
      if (r.code === 'uyari_onayi') {
        setTurler(Array.isArray(r.uyariTurleri) ? r.uyariTurleri : []);
        setHataMsg('Sunucu uyarı türlerinin onaylanmasını istiyor — her birini okuyup işaretleyin.');
        return;
      }
      setHataMsg(hataMetni(r, 'Kuyruk oluşturulamadı.'));
    } catch (e) {
      setHataMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setMesgul(false);
    }
  }

  return (
    <Bolum baslik={<span className="flex items-center gap-2"><MoonIcon className="h-4 w-4" aria-hidden /> Yeni gece kuyruğu</span>}
      aciklama="Öğeler “Yeni koşu” formundaki “Kuyruğa ekle” ile gelir. Her öğeden önce ön kontrol otomatik çalışır; engel, yeni bir uyarı türü, yetki ya da süre yetmezse öğe atlanır ve kuyruk devam eder.">
      {taslak.length === 0 ? (
        <UyariKutusu ton="bilgi" baslik="Taslak boş." eylem={onYeniKosu ? <button type="button" onClick={onYeniKosu} className={TBL_BTN} style={smBtn(true)}>Yeni koşu formu</button> : undefined}>
          Yeni koşu formunda ayarları seçip etiket yazın ve “Kuyruğa ekle”ye basın (hazır ayarlar dahil).
        </UyariKutusu>
      ) : (
        <div className="space-y-4">
          <ol className="space-y-1.5" aria-label="Taslak öğeleri">
            {taslak.map((o, i) => (
              <li key={o.yerelId} className="flex flex-wrap items-center gap-2 rounded-lg px-3 py-2 text-[12px]" style={{ background: 'var(--bg-elevated)' }}>
                <span className="tabular-nums font-semibold" style={{ color: 'var(--text-secondary)' }}>{i + 1}.</span>
                <span className="min-w-0 font-medium" style={{ color: 'var(--text-primary)' }}>{o.etiket}</span>
                <span className="min-w-0 truncate" style={{ color: 'var(--text-secondary)' }} title={o.ozet}>{o.ozet}</span>
                <span className="ml-auto flex gap-1">
                  <button type="button" className={TBL_BTN} style={smBtn()} disabled={i === 0} onClick={() => setTaslak(tasi(taslak, i, -1))} aria-label={`${o.etiket} yukarı`}><ArrowUpIcon className="h-3.5 w-3.5" aria-hidden /></button>
                  <button type="button" className={TBL_BTN} style={smBtn()} disabled={i === taslak.length - 1} onClick={() => setTaslak(tasi(taslak, i, 1))} aria-label={`${o.etiket} aşağı`}><ArrowDownIcon className="h-3.5 w-3.5" aria-hidden /></button>
                  <button type="button" className={TBL_BTN} style={smBtn()} onClick={() => { setTaslak(taslak.filter((x) => x.yerelId !== o.yerelId)); setTurler(null); }} aria-label={`${o.etiket} çıkar`}><XMarkIcon className="h-3.5 w-3.5" aria-hidden /> Çıkar</button>
                </span>
              </li>
            ))}
          </ol>
          {hedefler.length > 1 && <UyariKutusu ton="hata" rol="alert" baslik={`Bir kuyruk tek hedefe yük basar; taslakta ${hedefler.length} hedef var (${hedefler.join(', ')}).`} />}
          <div className="grid gap-3 @lg/yuk:grid-cols-3">
            <Alan id="kuyruk-bekleme" etiket="Koşular arası bekleme (dk)" hata={beklemeHata} yardim="Önceki koşu bitip kilidi bırakıldıktan sonra sayılır.">
              <input id="kuyruk-bekleme" type="number" min={1} max={30} value={bekleme} onChange={(e) => setBekleme(e.target.value)} className={`${GIRDI} tabular-nums`} style={girdiStili(!!beklemeHata)} />
            </Alan>
            <fieldset className="min-w-0">
              <legend className="mb-1 text-[11px] font-semibold leading-4" style={{ color: 'var(--text-secondary)' }}>Başlangıç</legend>
              <div className="flex flex-wrap items-center gap-3 text-[12px]" style={{ color: 'var(--text-primary)' }}>
                <label className="flex items-center gap-1.5"><input type="radio" name="kuyruk-bas" checked={hemen} onChange={() => setHemen(true)} /> Hemen</label>
                <label className="flex items-center gap-1.5"><input type="radio" name="kuyruk-bas" checked={!hemen} onChange={() => setHemen(false)} /> Saat</label>
                <input type="time" aria-label="Başlangıç saati" value={basSaat} disabled={hemen} onChange={(e) => setBasSaat(e.target.value)} className={`${GIRDI} w-28`} style={girdiStili(!hemen && !secim)} />
              </div>
            </fieldset>
            <fieldset className="min-w-0">
              <legend className="mb-1 text-[11px] font-semibold leading-4" style={{ color: 'var(--text-secondary)' }}>En geç bitiş (isteğe bağlı)</legend>
              <div className="flex flex-wrap items-center gap-3 text-[12px]" style={{ color: 'var(--text-primary)' }}>
                <label className="flex items-center gap-1.5"><input type="checkbox" checked={bitisAcik} onChange={(e) => setBitisAcik(e.target.checked)} /> Sınır koy</label>
                <input type="time" aria-label="En geç bitiş saati" value={bitisSaat} disabled={!bitisAcik} onChange={(e) => setBitisSaat(e.target.value)} className={`${GIRDI} w-28`} style={girdiStili(bitisAcik && !bitis)} />
              </div>
              <p className="mt-1 text-[11px] leading-4" style={{ color: 'var(--text-muted)' }}>Sıradaki öğenin tahmini süresi bu saati aşacaksa başlamaz (“süre yetmedi”).</p>
            </fieldset>
          </div>
          <p className="text-[12px] tabular-nums" style={{ color: 'var(--text-secondary)' }}>
            {`Tahmini toplam ≈ ${sureMetni(toplamSn)} (her öğe: ön kontrol ≈ 5 dk + koşu üst sınırı; aralarda bekleme). Başlangıç ${basMetni}${bitis ? `, en geç bitiş ${gunFarki(bitis, simdi) === 1 ? 'yarın ' : ''}${saatMetni(bitis.toISOString())}` : ''}.`}
          </p>
          {baslangic && basKalanSn > 12 * 3600 && (
            <UyariKutusu ton="uyari" rol="alert" baslik={`Kuyruk ${basMetni} başlar.`}>Bu gece hemen başlatmak istiyorsanız “Hemen”i seçin.</UyariKutusu>
          )}
          {turler && turler.length > 0 && (
            <fieldset className="space-y-1.5 rounded-lg px-3 py-2.5" style={{ background: 'var(--bg-elevated)' }}>
              <legend className="text-[12px] font-semibold" style={{ color: 'var(--text-primary)' }}>Uyarı türleri — gece yalnız bunlar kabul edilir</legend>
              {turler.map((t) => (
                <label key={t.kod} className="flex items-start gap-2 text-[12px] leading-5" style={{ color: 'var(--text-primary)' }}>
                  <input type="checkbox" className="mt-1" checked={onayli.has(t.kod)} onChange={(e) => setOnayli((s) => { const n = new Set(s); if (e.target.checked) n.add(t.kod); else n.delete(t.kod); return n; })} />
                  <span className="min-w-0"><span className="font-mono text-[11px]" style={{ color: 'var(--text-secondary)' }}>{t.kod}</span>{` ${t.ornek}`}{t.ogeler?.length ? <span style={{ color: 'var(--text-secondary)' }}>{` (öğe ${t.ogeler.join(', ')})`}</span> : null}</span>
                </label>
              ))}
            </fieldset>
          )}
          <Alan id="kuyruk-onay" etiket={hedef ? `Onay: hedef ${hedef.includes('.') && /^\d/.test(hedef) ? 'IP’sini' : 'sunucu adını'} birebir yazın (${hedef})` : 'Onay'} yardim="Bir kez yazılır; gece her koşu bu onayla başlar.">
            <input id="kuyruk-onay" value={onay} onChange={(e) => setOnay(e.target.value)} autoComplete="off" spellCheck={false} className={`${GIRDI} font-mono`} style={girdiStili()} />
          </Alan>
          {hataMsg && <UyariKutusu ton={turler ? 'uyari' : 'hata'} rol="alert" baslik={hataMsg} />}
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => void olustur()} disabled={!hazir} className={`${SM_BTN} h-8`} style={smBtn(hazir)}>
              {mesgul ? <ArrowPathIcon className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" aria-hidden /> : <MoonIcon className="h-3.5 w-3.5" aria-hidden />} Kuyruğu oluştur
            </button>
            <button type="button" onClick={() => { setTaslak([]); setTurler(null); }} className={`${SM_BTN} h-8`} style={smBtn()}>Taslağı temizle</button>
          </div>
        </div>
      )}
    </Bolum>
  );
}

const SILINDI_IPUCU = 'Bu kayıt Portal’dan silindi; kuyruk öğesi ve numarası kalır. Sunucudaki ham ölçüm dosyaları silinmez.';

function KuyrukAyrinti({ id, isAdmin, onKosuAc, onKarsilastir, onTopluRapor, onGeri }: { id: number; isAdmin: boolean; onKosuAc: (kosuId: number) => void; onKarsilastir?: (k: number[]) => void; onTopluRapor?: (kuyrukId: number) => void; onGeri: () => void }) {
  const [veri, setVeri] = useState<{ kuyruk: NlKuyruk; ogeler: NlKuyrukOge[]; alindi: number } | null>(null);
  const [hata, setHata] = useState('');
  const [simdi, setSimdi] = useState(() => Date.now());
  const [mesgul, setMesgul] = useState(false);
  const [iptalNotu, setIptalNotu] = useState<string | null>(null);
  const oku = useCallback(async () => {
    try {
      const r = await nginxLoadtestApi.kuyruk(id);
      setVeri({ kuyruk: r.kuyruk, ogeler: r.ogeler || [], alindi: Date.now() });
      setHata('');
    } catch (e) {
      setHata(e instanceof Error ? e.message : String(e));
    }
  }, [id]);
  useAsyncEffect(async (alive) => { if (alive()) await oku(); }, [oku]);
  useEffect(() => {
    const z = window.setInterval(() => { void oku(); }, YOKLAMA_MS);
    const s = window.setInterval(() => setSimdi(Date.now()), 1000);
    return () => { window.clearInterval(z); window.clearInterval(s); };
  }, [oku]);

  async function eylem(fn: () => Promise<{ ok: boolean; code?: string; message?: string }>, basari: string) {
    if (mesgul) return null;
    setMesgul(true);
    try {
      const r = await fn();
      if (!r.ok) toast.error(hataMetni(r, 'İşlem yapılamadı.'));
      else toast.success(basari);
      await oku();
      return r;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
      return null;
    } finally {
      setMesgul(false);
    }
  }

  if (hata && !veri) return <UyariKutusu ton="hata" rol="alert" baslik="Kuyruk okunamadı" eylem={<button type="button" onClick={() => void oku()} className={TBL_BTN} style={smBtn()}>Yeniden dene</button>}>{hata}</UyariKutusu>;
  if (!veri) return <div className="skeleton h-40 rounded-xl" aria-busy="true"><span className="sr-only">Yükleniyor…</span></div>;
  const { kuyruk: k, ogeler } = veri;
  const aktif = AKTIF.has(k.durum);
  const kalan = k.siradakiKalanSn != null ? k.siradakiKalanSn - (simdi - veri.alindi) / 1000 : null;
  const bekleyenler = ogeler.filter((o) => o.durum === 'BEKLIYOR');
  // Silinmis kosu (2026-11-04: oge numarasi kalir) karsilastirmaya gitmez.
  const bitenKosular = ogeler.filter((o) => o.kosuId != null && o.durum === 'BITTI' && !o.kosuSilindi).map((o) => o.kosuId as number);
  const calisan = ogeler.find((o) => o.durum === 'CALISIYOR');
  const siraDegistir = (oId: number, yon: -1 | 1) => {
    const i = bekleyenler.findIndex((o) => o.id === oId);
    const yeni = tasi(bekleyenler.map((o) => o.id), i, yon);
    void eylem(() => nginxLoadtestApi.kuyrukSira(k.id, yeni), 'Sıra değişti.');
  };

  return (
    <div className="space-y-4">
      <button type="button" onClick={onGeri} className={`${LINK} text-[12px]`} style={{ color: 'var(--accent)' }}><ArrowLeftIcon className="h-3.5 w-3.5" aria-hidden /> Kuyruklar</button>
      <Bolum baslik={<span className="flex flex-wrap items-center gap-2">{`Gece kuyruğu #${k.id}`}<DurumHap durum={k.durum} /></span>}
        aciklama={`Hedef ${k.onayHedefi} · bekleme ${k.beklemeDk} dk · başlangıç ${gunSaatMetni(k.baslangicAt)}${k.enGecBitis ? ` · en geç bitiş ${gunSaatMetni(k.enGecBitis)}` : ''} · ${k.createdBy || ''}`}
        eylem={(
          <>
            {onKarsilastir && <button type="button" className={TBL_BTN} style={smBtn()} disabled={bitenKosular.length < 2} onClick={() => onKarsilastir(bitenKosular)}>Hepsini karşılaştır</button>}
            {onTopluRapor && <button type="button" className={TBL_BTN} style={smBtn()} disabled={!ogeler.some((o) => o.kosuId != null && !o.kosuSilindi)} onClick={() => onTopluRapor(k.id)}>Toplu rapor</button>}
            {isAdmin && aktif && (
              <button type="button" className={TBL_BTN} style={smBtn()} disabled={mesgul} onClick={() => void (async () => {
                const r = await eylem(() => nginxLoadtestApi.kuyrukIptal(k.id), `Kuyruk #${k.id} iptal edildi; sonraki öğeler başlamayacak.`);
                const s = r && 'suren' in r ? (r as { suren?: { kosuId: number | null; onKontrolKosuId: number | null; etiket: string } | null }).suren : null;
                if (s) setIptalNotu(`“${s.etiket}” sürüyor ve durdurulmadı${s.kosuId != null ? ` (koşu #${s.kosuId})` : ''}. Durdurmak için koşu ayrıntısındaki Durdur’u kullanın.`);
              })()}>İptal</button>
            )}
          </>
        )}>
        <div className="space-y-3">
          {aktif && (
            <p className="text-[12px] tabular-nums" style={{ color: 'var(--text-primary)' }} aria-live="polite">
              {k.durum === 'DINLENME' && k.dinlenmeBitis == null ? `Dinlenme: önceki koşunun kilidi bırakılınca ${k.beklemeDk} dk sayılacak.`
                : kalan != null && kalan > 0 ? `Sıradaki ${kalanMetni(kalan)} sonra.`
                  : calisan ? `Çalışıyor: ${calisan.etiket}${calisan.asama === 'kosu' ? ' (koşu)' : ' (ön kontrol)'}.` : 'Sıradaki başlıyor…'}
              {k.tahminiBitis ? ` Tahmini bitiş ${saatMetni(k.tahminiBitis)} (kilit beklemesi hariç).` : ''}
            </p>
          )}
          {aktif && isAdmin && <p className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>İptal sonraki öğeleri başlatmaz; süren koşu durmaz — onu koşu ayrıntısındaki Durdur ile ayrıca durdurun.</p>}
          {iptalNotu && <UyariKutusu ton="uyari" rol="alert" baslik={iptalNotu} eylem={calisan?.kosuId != null ? <button type="button" className={TBL_BTN} style={smBtn(true)} onClick={() => onKosuAc(calisan.kosuId as number)}>Koşuyu aç</button> : undefined} />}
          {k.sonHata && k.durum === 'HATALI' && <UyariKutusu ton="hata" baslik="Kuyruk durdu">{k.sonHata}</UyariKutusu>}
          {k.onaylananTurler.length > 0 && (
            <details className="text-[12px]" style={{ color: 'var(--text-secondary)' }}>
              <summary className="cursor-pointer">{`Onaylanan uyarı türleri (${k.onaylananTurler.length})`}</summary>
              <ul className="mt-1 list-disc space-y-0.5 pl-5">{k.onaylananTurler.map((t) => <li key={t.kod}><span className="font-mono">{t.kod}</span>{` ${t.ornek}`}</li>)}</ul>
            </details>
          )}
          <div className="overflow-x-auto">
            <table className="w-full min-w-[40rem] text-left text-[12px]">
              <thead style={{ color: 'var(--text-secondary)' }}>
                <tr><th className="py-1 pr-2">#</th><th className="py-1 pr-2">Etiket</th><th className="py-1 pr-2">Durum</th><th className="py-1 pr-2">Koşu</th><th className="py-1 pr-2">Tahmini</th><th className="py-1 pr-2">Not</th><th className="py-1" /></tr>
              </thead>
              <tbody>
                {ogeler.map((o, i) => (
                  <tr key={o.id} className="border-t align-top" style={{ borderColor: 'var(--border-subtle)' }}>
                    <td className="py-1.5 pr-2 tabular-nums" style={{ color: 'var(--text-secondary)' }}>{i + 1}</td>
                    <td className="py-1.5 pr-2 font-medium" style={{ color: 'var(--text-primary)' }}>{o.etiket}</td>
                    <td className="py-1.5 pr-2"><DurumHap durum={o.durum} oge /></td>
                    <td className="py-1.5 pr-2">
                      {o.kosuId != null && (o.kosuSilindi
                        ? <span className="tabular-nums" style={{ color: 'var(--text-muted)' }} title={SILINDI_IPUCU}>{`#${o.kosuId} (silindi)`}</span>
                        : <button type="button" className={LINK} style={{ color: 'var(--accent)' }} onClick={() => onKosuAc(o.kosuId as number)}>{`#${o.kosuId}`}</button>)}
                      {o.onKontrolKosuId != null && (o.onKontrolSilindi
                        ? <span className="ml-2 tabular-nums" style={{ color: 'var(--text-muted)' }} title={SILINDI_IPUCU}>{`ön kontrol #${o.onKontrolKosuId} (silindi)`}</span>
                        : <button type="button" className={`${LINK} ml-2`} style={{ color: 'var(--text-secondary)' }} onClick={() => onKosuAc(o.onKontrolKosuId as number)}>{`ön kontrol #${o.onKontrolKosuId}`}</button>)}
                    </td>
                    <td className="py-1.5 pr-2 tabular-nums" style={{ color: o.sureYetmeyebilir ? 'var(--status-warning-text)' : 'var(--text-secondary)' }}>
                      {o.tahminiBaslangic ? `${saatMetni(o.tahminiBaslangic)}–${saatMetni(o.tahminiBitis)}${o.sureYetmeyebilir ? ' (süre yetmeyebilir)' : ''}` : o.bitisAt ? `bitti ${saatMetni(o.bitisAt)}` : '—'}
                    </td>
                    <td className="py-1.5 pr-2" style={{ color: o.durum === 'ATLANDI' || o.durum === 'HATALI' ? 'var(--status-warning-text)' : 'var(--text-secondary)' }}>{o.neden || ''}</td>
                    <td className="py-1.5 whitespace-nowrap">
                      {isAdmin && aktif && o.durum === 'BEKLIYOR' && (
                        <span className="flex gap-1">
                          <button type="button" className={TBL_BTN} style={smBtn()} disabled={mesgul || bekleyenler[0]?.id === o.id} onClick={() => siraDegistir(o.id, -1)} aria-label={`${o.etiket} yukarı`}><ArrowUpIcon className="h-3.5 w-3.5" aria-hidden /></button>
                          <button type="button" className={TBL_BTN} style={smBtn()} disabled={mesgul || bekleyenler.at(-1)?.id === o.id} onClick={() => siraDegistir(o.id, 1)} aria-label={`${o.etiket} aşağı`}><ArrowDownIcon className="h-3.5 w-3.5" aria-hidden /></button>
                          <button type="button" className={TBL_BTN} style={smBtn()} disabled={mesgul} onClick={() => void eylem(() => nginxLoadtestApi.kuyrukOgeCikar(k.id, o.id), `“${o.etiket}” kuyruktan çıkarıldı.`)}>Çıkar</button>
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </Bolum>
    </div>
  );
}
