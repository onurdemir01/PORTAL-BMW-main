// src/components/nginx_console/yukTesti/KosuAyrinti.tsx — tek koşunun ayrintisi (2026-10-27).
//
// Ust kart: hedef / vhost / yuk sunucusu / senaryo / parametreler, durum ve gecerlilik; Admin icin "Durdur"
// (AWX isini iptal + durdur kipinde playbook; sunucu denetler). Sekmeler: Sonuçlar (gecerlilik nedenleri,
// ozet hucreleri, p95 ve CPU-ms/istek grafikleri, adim tablosu) | Ön kontrol | İş çıktısı (yalniz Admin:
// /durum ucu Admin'e acik; Admin olmayan sonuclari gorur, canli ciktiyi gormez).
// Suren koşu 15 sn'de bir yeniden okunur; canli cikti bitince de hemen okunur (onBitti).
//
// DURDUR (2026-10-27 inceleme): AWX iptali uzaktaki async k6'yi ve ayrik kaydediciyi DURDURMAZ; kosuda asil
// durdurma "durdur" kipindeki AWX isidir. O is baslatilamazsa sunucu 424 durdur_baslatilamadi der: ekran bunu
// KALICI hata kutusunda gosterir (basari bildirimi YOK). Iptal edilmis kosuda Admin "Kalan süreçleri durdur" ile
// ayni ucu yeniden cagirabilir. Ön kontrolde durdur isi yoktur: yalniz "AWX işi iptal ediliyor".
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeftIcon, ArrowPathIcon, ChevronDownIcon, ChevronRightIcon, StopCircleIcon } from '@heroicons/react/24/outline';
import { nginxLoadtestApi, type NlAdim, type NlKosuAyrinti } from '@/api/nginxLoadtestApi';
import { useAsyncEffect } from '@/hooks/useAsyncEffect';
import { toast } from '@/hooks/useToast';
import { Modal } from '@/components/common/Modal';
import { TableEmptyRow } from '@/components/common/EmptyState';
import { fmtDateTime, fmtNumber } from '@/utils/datetime';
import { BTN_TEHLIKE, BTN_UYARI, LINK, SM_BTN, TBL_BTN, TH_STIL, TON, smBtn } from '@/components/server_hub/retirementStil';
import { Cip, Hap, OzetHucre, UyariKutusu } from '@/components/server_hub/RetirementUi';
import { sureMetni } from '@/components/server_hub/retirementCikti';
import HizGrafigi from './Grafik';
import KosuCiktisi from './KosuCiktisi';
import OnKontrolPaneli from './OnKontrolPaneli';
import { Bolum, GecerlilikHapi, KosuDurumHapi, Tanim, islemEtiketi } from './YukUi';
import {
  AE_ETIKETI, AKTIF_DURUMLAR, KIP_ETIKETI, OKUNAMADI_ACIKLAMASI, SONUC_DENEME_SINIRI, adimEtiketi, adimGecerliligi, adimSirala, butceSn, uyarilariAyir,
  durdurBaslatilamadiMetni, gecerlilikBilgisi, hataMetni, hizGrupla, kalanSurecDurdurulabilir, ondalik, seriAdi, sonucOkunuyorMetni,
  yenidenOkunabilir, yuzde,
} from './yukTestiOrtak';

type Sekme = 'sonuc' | 'onkontrol' | 'cikti';
const SEKME_ADI: Record<Sekme, string> = { sonuc: 'Sonuçlar', onkontrol: 'Ön kontrol', cikti: 'İş çıktısı' };
/** Pencere kaynagi 'log' degilse sunucu rps'i olculmedi (analiz istemci rps'ini kopyalar): hucre "—". */
const PENCERE_ISTEMCI = 'sunucu logunda bu adımın satırı yok; pencere istemci saatinden';

export default function KosuAyrinti({ kosuId, isAdmin, onGeri }: { kosuId: number; isAdmin: boolean; onGeri: () => void }) {
  const [veri, setVeri] = useState<{ kosu: NlKosuAyrinti; adimlar: NlAdim[] } | null>(null);
  const [hata, setHata] = useState('');
  const [sekme, setSekme] = useState<Sekme | null>(null);
  const [durdurSor, setDurdurSor] = useState(false);
  const [durduruluyor, setDurduruluyor] = useState(false);
  // Durdurma isi baslatilamadi (424 durdur_baslatilamadi): kullanici kapatana ya da durdurma basarili olana dek kalir.
  const [durdurHata, setDurdurHata] = useState<string | null>(null);
  const [okutuluyor, setOkutuluyor] = useState(false);
  const busyRef = useRef(false);
  const dugmeler = useRef<Record<string, HTMLButtonElement | null>>({});

  const yukle = useCallback(async () => {
    try {
      const r = await nginxLoadtestApi.kosu(kosuId);
      setVeri({ kosu: r.kosu, adimlar: r.adimlar });
      setHata('');
    } catch (e) {
      setHata(e instanceof Error ? e.message : String(e));
    }
  }, [kosuId]);
  useAsyncEffect(async (alive) => { if (alive()) await yukle(); }, [yukle]);
  const aktif = !!veri && AKTIF_DURUMLAR.has(veri.kosu.durum);
  useEffect(() => {
    if (!aktif) return;
    const z = window.setInterval(() => { void yukle(); }, 15000);
    return () => window.clearInterval(z);
  }, [aktif, yukle]);

  async function durdur() {
    if (busyRef.current || !veri) return;
    const islem = veri.kosu.islem;
    busyRef.current = true;
    setDurduruluyor(true);
    try {
      const r = await nginxLoadtestApi.durdur(kosuId);
      if (!r.ok) {
        if (r.code === 'baslatiliyor') {
          setDurdurSor(false);
          toast.info(hataMetni(r, 'Koşu başlatılıyor; birkaç saniye sonra yeniden deneyin.'));
          return;
        }
        if (r.code === 'durdur_baslatilamadi') {
          setDurdurSor(false);
          setDurdurHata(hataMetni(r, durdurBaslatilamadiMetni(r)));
          void yukle();
          return;
        }
        toast.error(hataMetni(r, 'Durdurulamadı.'));
        return;
      }
      setDurdurSor(false);
      if (islem === 'kosu') {
        // Sunucu durdur isi baslamadan 200 donmez (424); eski sunucuya karsi yine de basari denmez.
        if (!r.durdurIsi) {
          setDurdurHata(durdurBaslatilamadiMetni(r));
          void yukle();
          return;
        }
        setDurdurHata(null);
        if (r.iptalHatasi) {
          // AWX iptali olmadi: sunucu kilitleri koşu işinde bırakır (iş bitince kurala göre çözülür).
          toast.warning(`Durdurma işi AWX #${r.durdurIsi.jobId} başlatıldı, ancak koşunun AWX işi iptal edilemedi: ${r.iptalHatasi}. Kilitler koşu işi bitince bırakılır.`);
        } else {
          toast.success(`Durdurma işi AWX #${r.durdurIsi.jobId} başlatıldı; k6 ve kaydedici durdurulduğunda kilitler bırakılır.`);
        }
      } else {
        toast.success('AWX işi iptal ediliyor.');
      }
      void yukle();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      busyRef.current = false;
      setDurduruluyor(false);
    }
  }

  async function yenidenOkut() {
    if (busyRef.current) return;
    busyRef.current = true;
    setOkutuluyor(true);
    try {
      const r = await nginxLoadtestApi.yenidenOku(kosuId);
      if (!r.ok) { toast.error(hataMetni(r, 'Sonuç yeniden okunamadı.')); return; }
      toast.success('Sonuç yeniden okunuyor: Portal /sw’deki dosyaları baştan okuyacak.');
      void yukle();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      busyRef.current = false;
      setOkutuluyor(false);
    }
  }

  if (!veri) {
    return (
      <div className="space-y-3">
        <button type="button" onClick={onGeri} className={LINK} style={{ color: 'var(--accent)' }}><ArrowLeftIcon className="h-3.5 w-3.5" aria-hidden /> Koşular</button>
        {hata ? <UyariKutusu ton="hata" rol="alert" baslik={`Koşu #${kosuId} okunamadı`} eylem={<button type="button" onClick={() => void yukle()} className={TBL_BTN} style={smBtn()}>Yeniden dene</button>}>{hata}</UyariKutusu>
          : <div className="skeleton h-40 rounded-xl" aria-busy="true"><span className="sr-only">Koşu yükleniyor…</span></div>}
      </div>
    );
  }

  const { kosu, adimlar } = veri;
  const kalanDurdur = kalanSurecDurdurulabilir(kosu);
  const yenidenOku = yenidenOkunabilir(kosu);
  const sekmeler: Sekme[] = [
    ...(kosu.islem === 'kosu' ? ['sonuc' as const] : []),
    ...(kosu.onKontrol || kosu.islem === 'on_kontrol' ? ['onkontrol' as const] : []),
    ...(isAdmin ? ['cikti' as const] : []),
  ];
  const varsayilan: Sekme = isAdmin && aktif ? 'cikti' : sekmeler[0];
  const etkin: Sekme = sekme && sekmeler.includes(sekme) ? sekme : varsayilan;
  const tus = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    const i = sekmeler.indexOf(etkin);
    const yeni = sekmeler[(i + (e.key === 'ArrowRight' ? 1 : sekmeler.length - 1)) % sekmeler.length];
    setSekme(yeni);
    dugmeler.current[yeni]?.focus();
  };
  const p = kosu.parametreler;
  const sure = kosu.startedAt && kosu.finishedAt ? (Date.parse(kosu.finishedAt) - Date.parse(kosu.startedAt)) / 1000 : null;
  const panelId = `yuk-kosu-panel-${kosu.id}`;
  const durdurDugmesi = aktif ? 'Durdur' : 'Kalan süreçleri durdur';

  return (
    <div className="space-y-3">
      <button type="button" onClick={onGeri} className={LINK} style={{ color: 'var(--accent)' }}><ArrowLeftIcon className="h-3.5 w-3.5" aria-hidden /> Koşular</button>
      <Bolum govdeSinifi="px-4 py-3 space-y-3">
        <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-[15px] font-semibold leading-6" style={{ color: 'var(--text-primary)' }}>{islemEtiketi(kosu.islem)} #{kosu.id}</h2>
              {kosu.adim && <Cip cerceve>{kosu.adim}</Cip>}
              <KosuDurumHapi durum={kosu.durum} />
              {kosu.durum === 'FINALIZING' && kosu.sonuclandirmaDenemesi >= 1 && (
                <span className="text-[11px] tabular-nums" style={{ color: 'var(--text-secondary)' }} title={sonucOkunuyorMetni(kosu.sonuclandirmaDenemesi)}>{`deneme ${fmtNumber(kosu.sonuclandirmaDenemesi)}/${SONUC_DENEME_SINIRI}`}</span>
              )}
              {kosu.islem === 'kosu' && <GecerlilikHapi gecerlilik={kosu.gecerlilik} />}
              {kosu.durdurIsi && (
                <Cip ton="uyari" cerceve title="“Durdur” kipindeki AWX işi: iki sunucudaki k6 ve CPU kaydedicisini sonlandırır; başarıyla bitince kilitler bırakılır.">{`Durdurma işi AWX #${kosu.durdurIsi.awxJobId}`}</Cip>
              )}
            </div>
            {kosu.etiket && <p className="mt-0.5 truncate text-[12px]" style={{ color: 'var(--text-secondary)' }} title={kosu.etiket}>{kosu.etiket}</p>}
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {isAdmin && yenidenOku && (
              <button type="button" onClick={() => void yenidenOkut()} disabled={okutuluyor} className={SM_BTN} style={smBtn()} title="Sonuç dosyalarını /sw’den yeniden okut (poller en çok 3 kez dener)">
                <ArrowPathIcon className={`h-3.5 w-3.5 ${okutuluyor ? 'animate-spin motion-reduce:animate-none' : ''}`} aria-hidden /> Sonucu yeniden oku
              </button>
            )}
            {isAdmin && (aktif || kalanDurdur) && (
              <button type="button" onClick={() => setDurdurSor(true)} className={SM_BTN} style={aktif ? BTN_TEHLIKE : BTN_UYARI}><StopCircleIcon className="h-3.5 w-3.5" aria-hidden /> {durdurDugmesi}</button>
            )}
          </div>
        </div>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5 @2xl/yuk:grid-cols-3 @5xl/yuk:grid-cols-5">
          <Tanim etiket="Hedef" title={`${kosu.hedefHost}${kosu.hedefIp ? ` · ${kosu.hedefIp}` : ''}`}><span className="font-mono">{kosu.hedefHost}</span>{kosu.hedefIp && <span className="font-mono" style={{ color: 'var(--text-secondary)' }}> · {kosu.hedefIp}</span>}</Tanim>
          <Tanim etiket="Vhost (Host başlığı)" title={kosu.vhost || ''}>{kosu.vhost || '—'}{p?.sni ? <span style={{ color: 'var(--text-secondary)' }}> · SNI</span> : null}</Tanim>
          <Tanim etiket="Yük sunucusu" title={kosu.yukHost || ''}><span className="font-mono">{kosu.yukHost || '—'}</span></Tanim>
          <Tanim etiket="Senaryo" title={kosu.senaryoAd || ''}>{kosu.senaryoAd || (kosu.senaryoId != null ? `#${kosu.senaryoId}` : '—')}</Tanim>
          <Tanim etiket="Hızlar · tekrar" title={p ? `${p.hizlar.join(', ')} istek/sn` : ''}>{p ? `${p.hizlar.join(' · ')} /sn × ${p.tekrar}` : '—'}</Tanim>
          <Tanim etiket="Süreler" title={p ? `ısınma ${p.isinma} sn, ölçüm ${p.sure} sn, bekleme ${p.bosluk} sn, boşta ölçüm ${p.bosta} sn` : ''}>{p ? `${p.isinma} + ${p.sure} sn · ara ${p.bosluk} sn` : '—'}</Tanim>
          <Tanim etiket="Bağlantı · sıkıştırma">{p ? `${KIP_ETIKETI[p.kip] || p.kip} · ${AE_ETIKETI[p.ae] || p.ae}` : '—'}</Tanim>
          <Tanim etiket="Başlatan" title={kosu.createdBy || ''}>{kosu.createdBy || '—'}</Tanim>
          <Tanim etiket="Başladı" title={fmtDateTime(kosu.startedAt || kosu.createdAt)}>{fmtDateTime(kosu.startedAt || kosu.createdAt)}</Tanim>
          <Tanim etiket={aktif ? 'Tahmini süre' : 'Süre'}>
            {aktif ? (p ? `≈ ${sureMetni(butceSn(p))}` : '—') : sure != null && sure >= 0 ? sureMetni(sure) : '—'}
            {kosu.awxJobId != null && <span className="font-mono" style={{ color: 'var(--text-secondary)' }}> · AWX #{kosu.awxJobId}</span>}
          </Tanim>
        </dl>
      </Bolum>

      {durdurHata && (
        <UyariKutusu ton="hata" rol="alert" vurgu baslik="Durdurma işi başlatılamadı — uzaktaki yük sürüyor olabilir"
          eylem={<button type="button" onClick={() => setDurdurHata(null)} className={TBL_BTN} style={smBtn()}>Kapat</button>}>
          <p className="wrap-anywhere">{durdurHata}</p>
        </UyariKutusu>
      )}

      <section className="rounded-xl border" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-surface)' }}>
        <div role="tablist" aria-label={`Koşu #${kosu.id} bölümleri`} className="flex items-center gap-1 border-b px-2" style={{ borderColor: 'var(--border-subtle)' }} onKeyDown={tus}>
          {sekmeler.map((s) => {
            const secili = s === etkin;
            return (
              <button key={s} ref={(el) => { dugmeler.current[s] = el; }} type="button" role="tab" id={`yuk-sekme-${kosu.id}-${s}`} aria-selected={secili} aria-controls={panelId} tabIndex={secili ? 0 : -1}
                onClick={() => setSekme(s)} className="px-3 py-2.5 text-[12px] font-semibold focus-visible:outline-offset-2!"
                style={secili ? { color: 'var(--text-primary)', boxShadow: 'inset 0 -2px 0 var(--accent)' } : { color: 'var(--text-secondary)' }}>
                {SEKME_ADI[s]}{s === 'cikti' && aktif ? <span aria-hidden className="ml-1.5 inline-block h-1.5 w-1.5 rounded-full align-middle animate-status-pulse motion-reduce:animate-none" style={{ background: 'var(--accent)', color: 'var(--accent)' }} /> : null}
              </button>
            );
          })}
        </div>
        <div role="tabpanel" id={panelId} aria-labelledby={`yuk-sekme-${kosu.id}-${etkin}`} tabIndex={0} className="p-4">
          {etkin === 'sonuc' && <Sonuclar kosu={kosu} adimlar={adimlar} aktif={aktif} />}
          {/* Kosunun dayandigi on kontrol, KENDI durumuyla (DONE/OK: kosu ancak oyle baslar) degerlendirilir - kosunun
              RUNNING / FAILED durumu on kontrolu "temiz" ya da "başarısız" gostermez. */}
          {etkin === 'onkontrol' && (kosu.islem === 'kosu' && kosu.onKontrol
            ? <OnKontrolPaneli kosu={{ durum: 'DONE', onKontrol: kosu.onKontrol, sunucuDegerlendirmesi: kosu.sunucuDegerlendirmesi, isDurumu: 'OK', isHatasi: null }} baglam="kayit" />
            : kosu.onKontrol || !aktif
              ? <OnKontrolPaneli kosu={kosu} />
              : <UyariKutusu ton="bilgi" rol="status" baslik="Ön kontrol sürüyor — sonuç iş bitince burada görünür." />)}
          {etkin === 'cikti' && isAdmin && (
            <KosuCiktisi key={kosu.id} kosuId={kosu.id} etiket={`${islemEtiketi(kosu.islem)} #${kosu.id}`} awxJobId={kosu.awxJobId} basladi={kosu.startedAt || kosu.createdAt} onBitti={() => void yukle()} />
          )}
        </div>
      </section>

      <Modal open={durdurSor} onClose={() => { if (!durduruluyor) setDurdurSor(false); }}
        title={aktif ? `${islemEtiketi(kosu.islem)} #${kosu.id} durdurulsun mu?` : `Koşu #${kosu.id}: kalan süreçler durdurulsun mu?`} size="md" dismissOnBackdrop={false}
        footer={<div className="flex w-full justify-end gap-2">
          <button type="button" className={SM_BTN} style={smBtn()} disabled={durduruluyor} onClick={() => setDurdurSor(false)}>İptal</button>
          <button type="button" className={SM_BTN} style={BTN_TEHLIKE} disabled={durduruluyor} onClick={() => void durdur()}><StopCircleIcon className="h-3.5 w-3.5" aria-hidden /> {durduruluyor ? 'Durduruluyor…' : durdurDugmesi}</button>
        </div>}>
        {kosu.islem === 'on_kontrol' ? (
          <p className="text-[13px] leading-5" style={{ color: 'var(--text-primary)' }}>
            Ön kontrolün AWX işi iptal edilir; yarıda kalan ön kontrolün sonucu kullanılamaz.
          </p>
        ) : aktif ? (
          <p className="text-[13px] leading-5" style={{ color: 'var(--text-primary)' }}>
            AWX işi iptal edilir ve “durdur” kipinde ayrı bir iş, <span className="font-mono">{kosu.hedefHost}</span> ile <span className="font-mono">{kosu.yukHost}</span> üzerindeki k6 ve CPU kaydedicisini sonlandırır.
            Yarıda kalan koşunun sonuçları geçersiz sayılır. Kilitler, durdurma işi başarıyla bitince bırakılır.
          </p>
        ) : (
          <p className="text-[13px] leading-5" style={{ color: 'var(--text-primary)' }}>
            AWX işi zaten durdu; AWX iptali uzaktaki k6’yi ve CPU kaydedicisini durdurmaz. “Durdur” kipinde ayrı bir iş, <span className="font-mono">{kosu.hedefHost}</span> ile <span className="font-mono">{kosu.yukHost}</span> üzerinde bu koşudan kalan süreçleri sonlandırır.
            Kilitler, durdurma işi başarıyla bitince bırakılır.
          </p>
        )}
      </Modal>
    </div>
  );
}

// ── Sonuclar ────────────────────────────────────────────────────────────────────────
function Sonuclar({ kosu, adimlar, aktif }: { kosu: NlKosuAyrinti; adimlar: NlAdim[]; aktif: boolean }) {
  const nproc = kosu.analiz.nproc;
  const gruplar = hizGrupla(adimlar, nproc);
  const g = gecerlilikBilgisi(kosu.gecerlilik);
  const uyarilar = kosu.analiz.uyarilar;
  const ayrik = uyarilariAyir(uyarilar);
  const hizlar =[...new Set(gruplar.map((x) => x.hiz))].sort((a, b) => a - b);
  // Kademeler analiz.cjs ile ayni: CPU = ortadaki hiz, p95 = en yuksek hiz.
  const kademeCpu = hizlar.length ? hizlar[Math.floor(hizlar.length / 2)] : null;
  const kademeP95 = hizlar.length ? hizlar[hizlar.length - 1] : null;
  const gk = gruplar.find((x) => x.hiz === kademeCpu);
  const gp = gruplar.find((x) => x.hiz === kademeP95);
  const nGecerli = adimlar.filter((a) => a.gecerlilik === 'GECERLI' || a.gecerlilik === 'DOYMA').length;
  const tlsPay = kosu.analiz.cpuTlsliPay;
  // OKUNAMADI kosu: aciklama ve nedenler TEK kutuda (gecerlilik de OKUNAMADI ise ayni metin iki kez yazilmaz).
  const okunamadi = kosu.durum === 'OKUNAMADI';
  // Grafik etiketi ve sirasi tekrar'la (deneme Portal'da hep 1): ayni hizdaki r1 / r2 soldan saga.
  const sirali = adimSirala(adimlar).filter((a) => a.hiz != null);
  const nokta = (f: (a: NlAdim) => number | null) => sirali.map((a) => ({ x: a.hiz as number, y: f(a), durum: a.gecerlilik, etiket: `${a.hiz}/sn · ${adimEtiketi(a)}` }));
  const tekSeri = new Set(gruplar.map((x) => x.seri)).size <= 1;
  const cizgi = (f: (x: (typeof gruplar)[number]) => number | null) => (tekSeri ? gruplar.map((x) => ({ x: x.hiz, y: f(x) })) : []);

  return (
    <div className="space-y-4">
      {aktif && (kosu.durum === 'FINALIZING' ? (
        <UyariKutusu ton="bilgi" rol="status" baslik={sonucOkunuyorMetni(kosu.sonuclandirmaDenemesi)}>
          AWX işi bitti; Portal sonuç dosyalarını /sw’den okuyup her adımı (hız × tekrar) ayrı ayrı değerlendiriyor. Okuma {SONUC_DENEME_SINIRI} denemede başarısız olursa koşu “sonuç okunamadı” olur.
        </UyariKutusu>
      ) : (
        <UyariKutusu ton="bilgi" rol="status" baslik="Koşu sürüyor — sonuçlar iş bitince okunur ve burada görünür.">
          Portal, iş bitince sonuç dosyalarını /sw’den okuyup her adımı (hız × tekrar) ayrı ayrı değerlendirir. Bu sayfayı kapatabilirsiniz.
        </UyariKutusu>
      ))}
      {okunamadi && (
        <UyariKutusu ton="uyari" rol="status" baslik="Sonuç dosyaları okunamadı — bu “başarısız” demek değildir.">
          {kosu.analiz.okumaHatasi ? <p className="wrap-anywhere">{kosu.analiz.okumaHatasi}</p> : null}
          {kosu.gecersizNedenleri.length > 0 && (
            <ul className="list-disc space-y-0.5 pl-4">{kosu.gecersizNedenleri.map((n) => <li key={n} className="wrap-anywhere font-mono text-[11px]">{n}</li>)}</ul>
          )}
          <p>{OKUNAMADI_ACIKLAMASI}</p>
        </UyariKutusu>
      )}
      {!aktif && kosu.isHatasi && (kosu.durum === 'FAILED' || kosu.durum === 'CANCELED') && (
        <UyariKutusu ton={kosu.durum === 'CANCELED' ? 'uyari' : 'hata'} rol="status" baslik={`AWX işi ${kosu.durum === 'CANCELED' ? 'durduruldu' : 'başarısız bitti'}`}>
          <p className="wrap-anywhere">{kosu.isHatasi}</p>
          {adimlar.length > 0 && <p>Tamamlanan adımlar aşağıda; yarım kalan adım geçersiz sayılır.</p>}
        </UyariKutusu>
      )}
      {g && !aktif && !(okunamadi && kosu.gecerlilik === 'OKUNAMADI') && (
        <div className="rounded-lg px-3 py-2.5" style={{ background: TON[g.ton].zemin, boxShadow: `inset 4px 0 0 ${TON[g.ton].renk}, inset 0 0 0 1px ${TON[g.ton].kenar}` }} role="status">
          <div className="text-[13px] font-semibold leading-5" style={{ color: TON[g.ton].metin }}>Ölçüm {g.etiket}</div>
          <p className="text-[12px] leading-5" style={{ color: 'var(--text-primary)' }}>{g.aciklama}</p>
          {kosu.gecersizNedenleri.length > 0 && (
            <ul className="mt-1 list-disc space-y-0.5 pl-4 text-[12px] leading-5" style={{ color: 'var(--text-primary)' }}>
              {kosu.gecersizNedenleri.map((n) => <li key={n} className="wrap-anywhere font-mono text-[11px]">{n}</li>)}
            </ul>
          )}
        </div>
      )}
      {uyarilar.length > 0 && (
        <UyariKutusu ton="uyari" baslik={`${uyarilar.length} analiz uyarısı`}>
          {ayrik.genel.length > 0 && <ul className="list-disc space-y-0.5 pl-4">{ayrik.genel.map((u) => <li key={u} className="wrap-anywhere">{u}</li>)}</ul>}
          {ayrik.adim.length > 0 && (
            <details className={ayrik.genel.length > 0 ? 'mt-1.5' : undefined}>
              <summary className="cursor-pointer">Adım uyarıları — adım tablosunda uyarı çipiyle işaretli</summary>
              <ul className="mt-1 list-disc space-y-0.5 pl-4">{ayrik.adim.map((u) => <li key={u} className="wrap-anywhere font-mono text-[11px]">{u}</li>)}</ul>
            </details>
          )}
        </UyariKutusu>
      )}
      {adimlar.length > 0 && (
        <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border @3xl/yuk:grid-cols-4" style={{ borderColor: 'var(--border-subtle)', background: 'var(--border-subtle)' }}>
          <OzetHucre etiket="Geçerli adım" alt="doyma dahil; geçersiz adım hesaba katılmaz">{fmtNumber(nGecerli)} / {fmtNumber(adimlar.length)}</OzetHucre>
          <OzetHucre etiket={`CPU-ms/istek${kademeCpu != null ? ` @ ${kademeCpu}/sn` : ''}`} alt={tlsPay != null ? `TLS payı %${ondalik(tlsPay * 100, 0)}` : 'nginx worker, user+sys, arka plan çıkarılmış'}>{ondalik(gk?.cpuMsIstek, 3)}</OzetHucre>
          <OzetHucre etiket={`p95${kademeP95 != null ? ` @ ${kademeP95}/sn` : ''}`} alt="istemci (k6), geçerli adımların ortalaması">{gp?.p95 != null ? `${ondalik(gp.p95, 1)} ms` : '—'}</OzetHucre>
          <OzetHucre etiket="Tahmini kapasite" alt={nproc != null ? `${fmtNumber(nproc)} çekirdek × 1000 × 0,8 / CPU-ms` : 'çekirdek sayısı × 1000 × 0,8 / CPU-ms'}>{gk?.kapasiteRps != null ? `~${fmtNumber(Math.round(gk.kapasiteRps))} istek/sn` : '—'}</OzetHucre>
        </dl>
      )}
      {adimlar.length > 0 && (
        <div className="grid gap-5 @3xl/yuk:grid-cols-2">
          <HizGrafigi baslik="p95 yanıt süresi" birim="ms" noktalar={nokta((a) => a.p95)} cizgi={cizgi((x) => x.p95)} />
          <HizGrafigi baslik="CPU-ms / istek" birim="ms" basamak={3} noktalar={nokta((a) => a.cpuMsIstek)} cizgi={cizgi((x) => x.cpuMsIstek)} bos="CPU ölçülmedi (sunucu kaydı yok ya da adımlar geçersiz)." />
        </div>
      )}
      <AdimTablosu adimlar={adimlar} aktif={aktif} />
    </div>
  );
}

// ── Adim tablosu ────────────────────────────────────────────────────────────────────
const KOLONLAR: { anahtar: string; baslik: string; genislik: string; sag?: boolean; ipucu?: string }[] = [
  { anahtar: 'hiz', baslik: 'Hız', genislik: '6rem', ipucu: 'istek/sn · tekrar' },
  { anahtar: 'durum', baslik: 'Durum', genislik: '9rem' },
  { anahtar: 'p95', baslik: 'p95 ms', genislik: '5.5rem', sag: true, ipucu: 'istemci (k6) p95; ayrıntıda p50 / p99' },
  { anahtar: 'hata', baslik: 'Hata', genislik: '5.5rem', sag: true, ipucu: 'http_req_failed oranı' },
  { anahtar: 'kodlar', baslik: '429 · 5xx · drop', genislik: '7.5rem', sag: true, ipucu: '429 ve 5xx yanıt sayısı, düşen iterasyon (dropped)' },
  { anahtar: 'rps', baslik: 'rps ist. / sun.', genislik: '7.5rem', sag: true, ipucu: 'istemcinin gerçekleşen hızı / sunucu logundaki ölçüm satırları' },
  { anahtar: 'cpu', baslik: 'CPU-ms', genislik: '6rem', sag: true, ipucu: 'istek başına nginx worker CPU (user+sys), arka plan çıkarılmış' },
  { anahtar: 'host', baslik: 'Host CPU', genislik: '5.5rem', sag: true, ipucu: 'ölçüm penceresinde hedefin ortalama CPU kullanımı' },
  { anahtar: 'kap', baslik: 'Kapasite', genislik: '6.5rem', sag: true, ipucu: 'çekirdek × 1000 × 0,8 / CPU-ms/istek' },
  { anahtar: 'ac', baslik: '', genislik: '2.5rem' },
];
const sayiHucre = 'px-2.5 py-1.5 text-right tabular-nums';

function AdimTablosu({ adimlar, aktif }: { adimlar: NlAdim[]; aktif: boolean }) {
  const [acik, setAcik] = useState<Set<string>>(new Set());
  const sirali = adimSirala(adimlar);
  const cokSeri = new Set(adimlar.map(seriAdi)).size > 1;
  const degistir = (k: string) => setAcik((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  return (
    <div>
      <h3 className="mb-1.5 text-[12px] font-semibold" style={{ color: 'var(--text-primary)' }}>Adımlar <span className="font-normal" style={{ color: 'var(--text-secondary)' }}>— her satır bir hız × tekrar (TUR)</span></h3>
      <div className="overflow-x-auto rounded-lg border" style={{ borderColor: 'var(--border-subtle)' }}>
        <table className="pf-table-sticky w-full min-w-[56rem] table-fixed border-collapse" aria-label="Adım sonuçları">
          <colgroup>{KOLONLAR.map((k) => <col key={k.anahtar} style={{ width: k.genislik }} />)}</colgroup>
          <thead><tr>{KOLONLAR.map((k) => (
            <th key={k.anahtar} scope="col" title={k.ipucu} className={`px-2.5 py-1.5 text-[11px] whitespace-nowrap ${k.sag ? 'text-right' : 'text-left'}`}
              style={k.anahtar === 'hiz' ? { ...TH_STIL, left: 0, zIndex: 3, boxShadow: 'inset 0 -1px 0 var(--border), inset -1px 0 0 var(--border-subtle)' } : TH_STIL}>
              {k.anahtar === 'ac' ? <span className="sr-only">Ayrıntı</span> : k.baslik}
            </th>
          ))}</tr></thead>
          <tbody className="text-[12px]" style={{ color: 'var(--text-primary)' }}>
            {sirali.length === 0 ? (
              <TableEmptyRow colSpan={KOLONLAR.length} title={aktif ? 'Adımlar koşu bitince görünür.' : 'Adım sonucu yok.'} description={aktif ? undefined : 'İş başarısız olduysa iş çıktısına bakın; kısmen biten koşuda tamamlanan adımlar listelenir.'} />
            ) : sirali.map((a, i) => {
              const k = `${a.tur}|${i}`;
              const ac = acik.has(k);
              const d = adimGecerliligi(a.gecerlilik);
              const kod = [a.n429, a.n5xx, a.dropped];
              const kotuKod = (a.n429 ?? 0) > 0 || (a.n5xx ?? 0) > 0;
              const pencereIstemci = a.pencereKaynak != null && a.pencereKaynak !== 'log';
              return (
                <React.Fragment key={k}>
                  <tr className="border-t align-top" style={{ borderColor: 'var(--border-subtle)' }}>
                    {/* Ilk kolon yatay kaydirmada yerinde kalir (dar ekranda tablo kendi icinde kayar). */}
                    <td className="sticky left-0 z-[1] px-2.5 py-1.5" style={{ background: 'var(--bg-surface)', boxShadow: 'inset -1px 0 0 var(--border-subtle)' }}>
                      <div className="font-semibold tabular-nums">{a.hiz != null ? `${a.hiz}/sn` : '—'}</div>
                      <div className="truncate text-[11px]" style={{ color: 'var(--text-secondary)' }} title={a.tur}>{`${adimEtiketi(a)}${cokSeri ? ` · ${seriAdi(a)}` : ''}`}</div>
                    </td>
                    <td className="px-2.5 py-1.5">
                      <div className="flex flex-wrap items-center gap-1">
                        <Hap label={d.etiket} ton={d.ton} />
                        {a.uyarilar.length > 0 && <Cip ton="uyari" cerceve title={a.uyarilar.join('\n')}>{`${fmtNumber(a.uyarilar.length)} uyarı`}</Cip>}
                      </div>
                      {a.nedenler.length > 0 && <div className="mt-0.5 truncate text-[11px]" style={{ color: d.ton === 'hata' ? 'var(--status-danger-text)' : 'var(--status-warning-text)' }} title={a.nedenler.join('; ')}>{a.nedenler[0]}{a.nedenler.length > 1 ? ` +${a.nedenler.length - 1}` : ''}</div>}
                    </td>
                    <td className={sayiHucre} title={`p50 ${ondalik(a.p50)} · p99 ${ondalik(a.p99)} ms`}>{ondalik(a.p95)}</td>
                    <td className={sayiHucre} style={(a.hataOrani ?? 0) > 0.001 ? { color: 'var(--status-danger-text)', fontWeight: 600 } : undefined}>{yuzde(a.hataOrani)}</td>
                    <td className={sayiHucre} style={kotuKod ? { color: 'var(--status-danger-text)', fontWeight: 600 } : (a.dropped ?? 0) > 0 ? { color: 'var(--status-warning-text)', fontWeight: 600 } : undefined}>{kod.map((x) => (x == null ? '—' : fmtNumber(x))).join(' · ')}</td>
                    <td className={sayiHucre}>{ondalik(a.gercekRps, 0)} / {pencereIstemci ? <span title={PENCERE_ISTEMCI}>—</span> : ondalik(a.rpsSunucu, 0)}</td>
                    <td className={sayiHucre}>{ondalik(a.cpuMsIstek, 3)}</td>
                    <td className={sayiHucre} style={(a.hostCpuOrt ?? 0) > 90 ? { color: 'var(--status-warning-text)', fontWeight: 600 } : undefined}>{a.hostCpuOrt != null ? `%${ondalik(a.hostCpuOrt, 0)}` : '—'}</td>
                    <td className={sayiHucre}>{a.kapasiteRps != null ? `~${fmtNumber(Math.round(a.kapasiteRps))}` : '—'}</td>
                    <td className="px-1 py-1.5 text-center">
                      <button type="button" onClick={() => degistir(k)} aria-expanded={ac} aria-label={`${a.tur} ayrıntısı`} className="rounded p-0.5 focus-visible:outline-offset-2!" style={{ color: 'var(--text-secondary)' }}>
                        {ac ? <ChevronDownIcon className="h-4 w-4" aria-hidden /> : <ChevronRightIcon className="h-4 w-4" aria-hidden />}
                      </button>
                    </td>
                  </tr>
                  {ac && (
                    <tr style={{ background: 'var(--bg-elevated)' }}>
                      <td colSpan={KOLONLAR.length} className="px-3 py-2.5">
                        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 @2xl/yuk:grid-cols-4 @5xl/yuk:grid-cols-6">
                          <Tanim etiket="TUR" title={a.tur}><span className="font-mono text-[11px]">{a.tur}</span></Tanim>
                          <Tanim etiket="p50 · p99 ms">{ondalik(a.p50)} · {ondalik(a.p99)}</Tanim>
                          <Tanim etiket="TTFB p95 ms">{ondalik(a.ttfbP95)}</Tanim>
                          <Tanim etiket="TLS · bağlantı p95 ms">{ondalik(a.tlsP95)} · {ondalik(a.connectP95)}</Tanim>
                          <Tanim etiket="Sunucu süresi p50 · p95 · p99 ms">{ondalik(a.srtP50)} · {ondalik(a.srtP95)} · {ondalik(a.srtP99)}</Tanim>
                          <Tanim etiket="İstek istemci · sunucu">{fmtNumber(a.nIstek)} · {fmtNumber(a.istekSunucu)}</Tanim>
                          <Tanim etiket="Bayt / istek">{a.baytIstek != null ? fmtNumber(Math.round(a.baytIstek)) : '—'}</Tanim>
                          <Tanim etiket="Sıkıştırma">{a.sikistirmaTuru || '—'}</Tanim>
                        </dl>
                        {a.nedenler.length > 0 && (
                          <ul className="mt-2 list-disc space-y-0.5 pl-4 text-[11px] leading-4" style={{ color: 'var(--text-primary)' }}>
                            {a.nedenler.map((n) => <li key={n} className="wrap-anywhere font-mono">{n}</li>)}
                          </ul>
                        )}
                        {a.uyarilar.length > 0 && (
                          <div className="mt-2">
                            <div className="text-[11px] font-semibold leading-4" style={{ color: 'var(--status-warning-text)' }}>Adım uyarıları</div>
                            <ul className="mt-0.5 list-disc space-y-0.5 pl-4 text-[11px] leading-4" style={{ color: 'var(--text-primary)' }} aria-label={`${a.tur} uyarıları`}>
                              {a.uyarilar.map((u) => <li key={u} className="wrap-anywhere font-mono">{u}</li>)}
                            </ul>
                          </div>
                        )}
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
