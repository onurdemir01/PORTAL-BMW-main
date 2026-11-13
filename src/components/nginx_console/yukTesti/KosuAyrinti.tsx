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
// ayni ucu yeniden cagirabilir. Sunucu ayarsiz ön kontrolde durdur isi yoktur (yalniz "AWX işi iptal ediliyor"); sunucu ayarli ön
// kontrolde vardir, hedefin konfunu geri alir. Sunucu ayari geri alinamamis bitmis satirda da dugme acik kalir.
//
// TUR 3 (2026-10-28): adim degerleri ve birimleri `adimDegerleri` ile (wrk: baglanti; kayitta `hizlar` yok). Serbest
// hedefte sunucu olcumu yoktur (CPU, kapasite, sunucu rps "—"); durdurma yalniz yuk sunucusundaki araci sonlandirir
// (hedefe baglanilmaz, kaydedici yok). Tur ve motor kosu satirindan; eski satir sunucu / k6.
// TUR 4 (2026-11-02): satirin arac seti ust bilgide ("Araç seti #N (k6 ... · wrk ...)"); on kontrol paneline aracId gider
// (eski satir null: "Araç kopyası" satiri yok).
// SADELESTIRME (2026-11-02, R2 / AWX 3474239: "kac istek gitti, medyan, p95, p99 nasil gorulur?"): Sonuçlar sekmesinin
// ustunde kosu ozeti (toplam istek, en iyi / en kotu p95, hatalar), gecerlilik kutusunda nedenler DUZ CUMLEYLE (ham kod
// ikincil; reload ani sunucu verdiyse) ve adim basina ozet tablo (SonucOzeti.tsx). CPU-ms/istek, kapasite, drop,
// grafikler ve teknik adim tablosu kapali "Ayrıntı" bolumunde. CPU-ms/istek ve kapasite ASLA negatif: deger yoksa "—"
// ve nedeni (cpuOlculemedi) ipucunda.
// HTTP/2 (2026-11-02, h2_sozlesme.md 5.3): ust bilgide "Protokol" (HTTP/1.1 / HTTP/2; wrk "HTTP/1.1 (wrk)") ve h2 cipi;
// h2 kosu uyarisi (k6 VU basina tek akis) analiz uyarilarindan ayri, bilgi tonunda; on kontrol paneline protokol gider.
// 2026-11-03 (E1-E6): tekrar "1. tekrar", adim uyarisi "90/sn adımının 2. tekrarında: ..."; CPU-ms "3,92 ms"; kapasite ve
// host CPU ipuclari; bellek sutunlari + "Nginx bellek (en yüksek)" kutusu + bellek grafigi (yalniz olculmus kosuda; eski
// kosu tablosu BIREBIR eskisi); adim ayrintisinda "Kip doğrulaması" (istenen / gerceklesen) ve tabloda kip cipi.
// 2026-11-03 (bant genisligi / bellek ayrisimi, bilgi): test trafigi kolonlari (alinan / gonderilen), "Test trafiği (en
// yüksek)" ve "Boşta NIC" kutulari, test trafigi grafigi (Mbps / hiz), adim ayrintisinda iki makinenin NIC ort. / en yuksek
// + kullanim %, "Bellek ayrışımı" mini tablosu (Anon / Shmem / File / PSS / baglanti; taban / son / dinlenme) + olasi neden,
// kosu duzeyi olasi sizinti kutusu. Eski kosu: kolon / kutu / grafik yok (tablo BIREBIR eskisi).
// 2026-11-04: Admin'e baslikta etiketin yaninda kalem (EtiketDuzenle; PUT /kosular/:id/etiket), kayit ayrintiyi yerinde gunceller.
// 2026-11-04 (kosu silme): Admin'e ya da kaydi baslatan kisiye "Sil" (tehlike tonu; suren iste kapali) -> KosuSilOnayi (kosu
// numarasi yazilir) -> onSilindi (liste yeniden okunur). Kayit bulunamazsa (409 / 404 kosu_yok) "silinmiş olabilir" denir.
// TEK HEDEF MODELI (2026-11-13): nginx olmayan sunucu hedefinde (kosu.hedefNginx ya da on kontrolun tespiti false) baslikta
// "nginx yok" cipi, Sonuçlar'in ustunde NGINX_YOK_UYARISI; CPU-ms / kapasite "—" (ipucu: istek basina CPU olculmez), host CPU
// (genel, /proc/stat) dolu. Eski satir (hedefNginx null) BIREBIR eskisi.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeftIcon, ArrowPathIcon, ChevronDownIcon, ChevronRightIcon, StopCircleIcon, TrashIcon } from '@heroicons/react/24/outline';
import { nginxLoadtestApi, type NlSilinen, type NlAdim, type NlAg, type NlBellekDetay, type NlBellekNoktasi, type NlKipDogrulama, type NlKipDurumu, type NlKosuAyrinti, type NlMotor, type NlNic, type NlProtokol } from '@/api/nginxLoadtestApi';
import { useAsyncEffect } from '@/hooks/useAsyncEffect';
import { toast } from '@/hooks/useToast';
import { Modal } from '@/components/common/Modal';
import { TableEmptyRow } from '@/components/common/EmptyState';
import { fmtDateTime, fmtNumber } from '@/utils/datetime';
import { BTN_TEHLIKE, BTN_UYARI, LINK, SM_BTN, TBL_BTN, TH_STIL, TON, smBtn } from '@/components/server_hub/retirementStil';
import { Cip, Hap, OzetHucre, UyariKutusu } from '@/components/server_hub/RetirementUi';
import { sureMetni } from '@/components/server_hub/retirementCikti';
import HizGrafigi from './Grafik';
import { H2_UYARI_KODU_RE, cpuOlculemediMetni, nedenAcikla, uyariAcikla } from './nedenler';
import { KosuOzetSatiri, NedenListesi, OzetTablosu, nedenGruplari, ozetSec, reloadOzetMetni } from './SonucOzeti';
import KosuCiktisi from './KosuCiktisi';
import EtiketDuzenle from './EtiketDuzenle';
import KosuSilOnayi from './KosuSilOnayi';
import OnKontrolPaneli from './OnKontrolPaneli';
import { Bolum, GecerlilikHapi, KosuDurumHapi, SunucuAyarUyarilari, Tanim, TurMotorCipleri, islemEtiketi } from './YukUi';
import {
  AE_ETIKETI, AKTIF_DURUMLAR, KAPASITE_IPUCU, KIP_ETIKETI, OKUNAMADI_ACIKLAMASI, PROTOKOL_ETIKETI, kosuProtokolu, SONUC_DENEME_SINIRI, adimDegerleri, adimEtiketi, adimGecerliligi, adimSirala, bellekKolonuVar,
  bellekYuzdeMetni, hedefNginxsiz, NGINX_YOK_CPU_IPUCU, NGINX_YOK_UYARISI, sunucuAyariGeriAlinmamis, butceSn, cpuMsMetni, durdurBaslatilamadiMetni, enYuksekNginxBellek, gecerlilikBilgisi, hataMetni, hizGrupla, hostCpuIpucu, kademeMetni, kalanSurecDurdurulabilir, mbMetni, motorOf, ondalik, seriAdi, sonucOkunuyorMetni,
  tekrarIpucu, turCumlesi, turEtiketi, uyarilariAyir, yenidenOkunabilir, yukCpuHucre, yukCpuKolonuVar, yuzde, type AdimBirimi,
  AG_KULLANIM_ESIK, BAGLANTI_IPUCU, BELLEK_NEDEN_METNI, BELLEK_PSS_IPUCU, NIC_IPUCU, TEST_TRAFIGI_IPUCU, agKolonuVar, bantMetni, bellekDetayVar, bellekSizintiMetni,
  enYuksekTestTrafigi, nicSecimMetni, kosuSahibiMi,
  sunucuAyariSatiri,
} from './yukTestiOrtak';

type Sekme = 'sonuc' | 'onkontrol' | 'cikti';
const SEKME_ADI: Record<Sekme, string> = { sonuc: 'Sonuçlar', onkontrol: 'Ön kontrol', cikti: 'İş çıktısı' };
/** Pencere kaynagi 'log' degilse sunucu rps'i olculmedi (analiz istemci rps'ini kopyalar): hucre "—". */
const PENCERE_ISTEMCI = 'sunucu logunda bu adımın satırı yok; pencere istemci saatinden';
/** Serbest hedefte CPU kaydedici ve nginx logu yok: sunucu olculeri "—". */
const SERBEST_SUNUCU_YOK = 'serbest hedef: sunucu ölçümü yok';
/** Kosunun motoru: satirdaki deger (normallestirilmis), yoksa kanonik parametreden (eski kayit k6). */
const kosuMotoru = (k: Pick<NlKosuAyrinti, 'motor' | 'parametreler'>): NlMotor => (k.motor === 'wrk' || k.motor === 'k6' ? k.motor : motorOf(k.parametreler));

export default function KosuAyrinti({ kosuId, isAdmin, onGeri, kullaniciAdi = null, onSilindi }: {
  kosuId: number; isAdmin: boolean; onGeri: () => void; kullaniciAdi?: string | null;
  /** Kayit silindi: cagiran listeye doner (liste yeniden okunur). */
  onSilindi?: (silinen: NlSilinen[]) => void;
}) {
  const [veri, setVeri] = useState<{ kosu: NlKosuAyrinti; adimlar: NlAdim[] } | null>(null);
  const [hata, setHata] = useState('');
  const [bulunamadi, setBulunamadi] = useState(false);
  const [silSor, setSilSor] = useState(false);
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
      setBulunamadi(false);
    } catch (e) {
      setHata(e instanceof Error ? e.message : String(e));
      setBulunamadi(!!e && typeof e === 'object' && (e as { code?: string }).code === 'kosu_yok');
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
    // Serbest hedefte kaydedici yok (hedefe baglanilmaz); arac adi motorla. k6 + sunucu metinleri BIREBIR eskisi.
    const tur = { hedefTuru: veri.kosu.hedefTuru === 'serbest' ? 'serbest' as const : 'sunucu' as const, motor: kosuMotoru(veri.kosu) };
    const srvOnKontrol = islem === 'on_kontrol' && !!veri.kosu.sunucuAyari;
    const durdurulan = srvOnKontrol ? 'sunucu ayarı geri alınıp iş' : tur.hedefTuru === 'serbest' ? tur.motor : `${tur.motor} ve kaydedici`;
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
          setDurdurHata(hataMetni(r, durdurBaslatilamadiMetni(r, tur)));
          void yukle();
          return;
        }
        toast.error(hataMetni(r, 'Durdurulamadı.'));
        return;
      }
      setDurdurSor(false);
      if (islem === 'kosu' || srvOnKontrol) {
        // Sunucu durdur isi baslamadan 200 donmez (424); eski sunucuya karsi yine de basari denmez.
        if (!r.durdurIsi) {
          setDurdurHata(durdurBaslatilamadiMetni(r, tur));
          void yukle();
          return;
        }
        setDurdurHata(null);
        if (r.iptalHatasi) {
          // AWX iptali olmadi: sunucu kilitleri koşu işinde bırakır (iş bitince kurala göre çözülür).
          toast.warning(`Durdurma işi AWX #${r.durdurIsi.jobId} başlatıldı, ancak koşunun AWX işi iptal edilemedi: ${r.iptalHatasi}. Kilitler koşu işi bitince bırakılır.`);
        } else {
          toast.success(`Durdurma işi AWX #${r.durdurIsi.jobId} başlatıldı; ${durdurulan} durdurulduğunda kilitler bırakılır.`);
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
        {hata && bulunamadi ? <UyariKutusu ton="uyari" rol="alert" baslik={`Koşu #${kosuId} bulunamadı`}>Bu kayıt silinmiş olabilir (elle ya da saklama süresi dolduğu için). Sunucudaki ham ölçüm dosyaları silinmez.</UyariKutusu>
          : hata ? <UyariKutusu ton="hata" rol="alert" baslik={`Koşu #${kosuId} okunamadı`} eylem={<button type="button" onClick={() => void yukle()} className={TBL_BTN} style={smBtn()}>Yeniden dene</button>}>{hata}</UyariKutusu>
          : <div className="skeleton h-40 rounded-xl" aria-busy="true"><span className="sr-only">Koşu yükleniyor…</span></div>}
      </div>
    );
  }

  const { kosu, adimlar } = veri;
  const kalanDurdur = kalanSurecDurdurulabilir(kosu);
  const srvGeriAlinmamis = sunucuAyariGeriAlinmamis(kosu);
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
  const durdurDugmesi = aktif ? 'Durdur' : srvGeriAlinmamis ? 'Sunucu ayarını geri al' : 'Kalan süreçleri durdur';
  const serbest = kosu.hedefTuru === 'serbest';
  const motor = kosuMotoru(kosu);
  // wrk her zaman HTTP/1.1 konusur (satir ne derse desin).
  const protokol = motor === 'wrk' ? 'h1' : kosuProtokolu(kosu);
  // Adim degerleri ve birim kosunun motoruyla (wrk kaydinda `hizlar` yok; dogrudan p.hizlar okunmaz).
  const ad = adimDegerleri(p ? { ...p, motor } : { motor });
  // Serbest hedefte durdurma yalniz yuk sunucusunda (hedef sunucu yok, kaydedici yok); arac adi motorla.
  const aracYazi = motor === 'wrk' ? 'wrk’yi' : 'k6’yi';
  const durdurmaKapsami = serbest
    ? <><span className="font-mono">{kosu.yukHost}</span> üzerindeki {aracYazi} sonlandırır (serbest hedefe bağlanılmaz; kaydedici yoktur)</>
    : <><span className="font-mono">{kosu.hedefHost}</span> ile <span className="font-mono">{kosu.yukHost}</span> üzerindeki {motor} ve CPU kaydedicisini sonlandırır</>;

  return (
    <div className="space-y-3">
      <button type="button" onClick={onGeri} className={LINK} style={{ color: 'var(--accent)' }}><ArrowLeftIcon className="h-3.5 w-3.5" aria-hidden /> Koşular</button>
      <Bolum govdeSinifi="px-4 py-3 space-y-3">
        <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-[15px] font-semibold leading-6" style={{ color: 'var(--text-primary)' }}>{islemEtiketi(kosu.islem)} #{kosu.id}</h2>
              {kosu.adim && <Cip cerceve>{kosu.adim}</Cip>}
              <TurMotorCipleri hedefTuru={kosu.hedefTuru} motor={motor} protokol={protokol} nginxsiz={hedefNginxsiz(kosu)} />
              <KosuDurumHapi durum={kosu.durum} />
              {kosu.durum === 'FINALIZING' && kosu.sonuclandirmaDenemesi >= 1 && (
                <span className="text-[11px] tabular-nums" style={{ color: 'var(--text-secondary)' }} title={sonucOkunuyorMetni(kosu.sonuclandirmaDenemesi)}>{`deneme ${fmtNumber(kosu.sonuclandirmaDenemesi)}/${SONUC_DENEME_SINIRI}`}</span>
              )}
              {kosu.islem === 'kosu' && <GecerlilikHapi gecerlilik={kosu.gecerlilik} />}
              {kosu.durdurIsi && (
                <Cip ton="uyari" cerceve title={serbest
                  ? `“Durdur” kipindeki AWX işi: yük sunucusundaki ${aracYazi} sonlandırır; başarıyla bitince kilitler bırakılır.`
                  : `“Durdur” kipindeki AWX işi: iki sunucudaki ${motor} ve CPU kaydedicisini sonlandırır; başarıyla bitince kilitler bırakılır.`}>{`Durdurma işi AWX #${kosu.durdurIsi.awxJobId}`}</Cip>
              )}
            </div>
            {(kosu.etiket || isAdmin) && (
              <div className="mt-0.5 flex min-w-0 items-center gap-1 text-[12px]" style={{ color: 'var(--text-secondary)' }}>
                {kosu.etiket ? <span className="truncate" title={kosu.etiket}>{kosu.etiket}</span> : <span style={{ color: 'var(--text-muted)' }}>etiketsiz</span>}
                {isAdmin && <EtiketDuzenle kosuId={kosu.id} etiket={kosu.etiket} onKaydedildi={(e) => setVeri((v) => (v ? { ...v, kosu: { ...v.kosu, etiket: e } } : v))} />}
              </div>
            )}
            {kosu.aracSeti && (
              <p className="mt-0.5 truncate text-[11px]" style={{ color: 'var(--text-secondary)' }}
                title={`Derleme ${kosu.aracSeti.derlemeHost || '?'} · k6 sha256 ${kosu.aracSeti.k6Sha256 || '—'} · wrk sha256 ${kosu.aracSeti.wrkSha256 || '—'}`}>
                {`Araç seti #${kosu.aracSeti.id} (k6 ${kosu.aracSeti.k6Surum} · wrk ${kosu.aracSeti.wrkSurum})`}
              </p>
            )}
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
            {kosuSahibiMi(kosu, isAdmin, kullaniciAdi) && (
              <button type="button" onClick={() => setSilSor(true)} disabled={aktif} className={SM_BTN} style={BTN_TEHLIKE}
                title={aktif ? 'Süren iş silinemez; bitmesini bekleyin ya da önce Durdur’u kullanın.' : 'Kaydı ve adım sonuçlarını Portal’dan siler (ham ölçüm dosyaları durur)'}>
                <TrashIcon className="h-3.5 w-3.5" aria-hidden /> Sil
              </button>
            )}
          </div>
        </div>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5 @2xl/yuk:grid-cols-3 @5xl/yuk:grid-cols-5">
          {serbest ? (
            <Tanim etiket="Hedef (serbest)" title={`${kosu.hedefIp || '—'} · serbest hedef${kosu.serbestAg ? ` · izinli ağ ${kosu.serbestAg}` : ''}`}>
              <span className="font-mono">{kosu.hedefIp || '—'}</span>{kosu.serbestAg && <span className="font-mono" style={{ color: 'var(--text-secondary)' }}> · {kosu.serbestAg}</span>}
            </Tanim>
          ) : (
            <Tanim etiket="Hedef" title={`${kosu.hedefHost || '—'}${kosu.hedefIp ? ` · ${kosu.hedefIp}` : ''}`}><span className="font-mono">{kosu.hedefHost || '—'}</span>{kosu.hedefIp && <span className="font-mono" style={{ color: 'var(--text-secondary)' }}> · {kosu.hedefIp}</span>}</Tanim>
          )}
          <Tanim etiket="Vhost (Host başlığı)" title={kosu.vhost || ''}>{kosu.vhost || '—'}{p?.sni ? <span style={{ color: 'var(--text-secondary)' }}> · SNI</span> : null}</Tanim>
          <Tanim etiket="Yük sunucusu" title={kosu.yukHost || ''}><span className="font-mono">{kosu.yukHost || '—'}</span></Tanim>
          <Tanim etiket="Senaryo" title={kosu.senaryoAd || ''}>{kosu.senaryoAd || (kosu.senaryoId != null ? `#${kosu.senaryoId}` : '—')}</Tanim>
          {ad.motor === 'wrk' ? (
            <Tanim etiket="Bağlantılar · tekrar" title={p ? `${ad.degerler.join(', ')} bağlantı · ${p.is_parcacigi ?? '—'} iş parçacığı · ortalama toplam ≤ ${p.tavan_rps ?? '—'} istek/sn` : ''}>
              {p ? `${ad.degerler.join(' · ')} bağlantı × ${p.tekrar}` : '—'}
            </Tanim>
          ) : (
            <Tanim etiket="Hızlar · tekrar" title={p ? `${ad.degerler.join(', ')} istek/sn` : ''}>{p ? `${ad.degerler.join(' · ')} /sn × ${p.tekrar}` : '—'}</Tanim>
          )}
          <Tanim etiket="Süreler" title={p ? `ısınma ${p.isinma} sn, ölçüm ${p.sure} sn, bekleme ${p.bosluk} sn, boşta ölçüm ${p.bosta} sn` : ''}>{p ? `${p.isinma} + ${p.sure} sn · ara ${p.bosluk} sn` : '—'}</Tanim>
          <Tanim etiket="Protokol">{motor === 'wrk' ? `${PROTOKOL_ETIKETI.h1} (wrk)` : PROTOKOL_ETIKETI[protokol]}</Tanim>
          <Tanim etiket={ad.motor === 'wrk' ? 'Bağlantı kipi · sıkıştırma' : 'Bağlantı · sıkıştırma'}>{p ? `${KIP_ETIKETI[p.kip] || p.kip} · ${AE_ETIKETI[p.ae] || p.ae}` : '—'}</Tanim>
          {kosu.sunucuAyari && <Tanim etiket="Sunucu ayarı" title={kosu.sunucuAyari.dizin || ''}>{sunucuAyariSatiri(kosu.sunucuAyari)}</Tanim>}
          <Tanim etiket="Başlatan" title={kosu.createdBy || ''}>{kosu.createdBy || '—'}</Tanim>
          <Tanim etiket="Başladı" title={fmtDateTime(kosu.startedAt || kosu.createdAt)}>{fmtDateTime(kosu.startedAt || kosu.createdAt)}</Tanim>
          <Tanim etiket={aktif ? 'Tahmini süre' : 'Süre'}>
            {aktif ? (p ? `≈ ${sureMetni(butceSn({ ...p, motor }))}` : '—') : sure != null && sure >= 0 ? sureMetni(sure) : '—'}
            {kosu.awxJobId != null && <span className="font-mono" style={{ color: 'var(--text-secondary)' }}> · AWX #{kosu.awxJobId}</span>}
          </Tanim>
        </dl>
        {kosu.sunucuAyari && <SunucuAyarUyarilari ayar={kosu.sunucuAyari} />}
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
          {etkin === 'sonuc' && <Sonuclar kosu={kosu} adimlar={adimlar} aktif={aktif} birim={ad.birim} protokol={protokol} />}
          {/* Kosunun dayandigi on kontrol, KENDI durumuyla (DONE/OK: kosu ancak oyle baslar) degerlendirilir - kosunun
              RUNNING / FAILED durumu on kontrolu "temiz" ya da "başarısız" gostermez. */}
          {etkin === 'onkontrol' && (kosu.islem === 'kosu' && kosu.onKontrol
            ? <OnKontrolPaneli kosu={{ durum: 'DONE', onKontrol: kosu.onKontrol, sunucuDegerlendirmesi: kosu.sunucuDegerlendirmesi, isDurumu: 'OK', isHatasi: null, hedefTuru: kosu.hedefTuru, motor, aracId: kosu.aracId, parametreler: kosu.parametreler, protokol }} baglam="kayit" />
            : kosu.onKontrol || !aktif
              ? <OnKontrolPaneli kosu={kosu} />
              : <UyariKutusu ton="bilgi" rol="status" baslik="Ön kontrol sürüyor — sonuç iş bitince burada görünür." />)}
          {etkin === 'cikti' && isAdmin && (
            <KosuCiktisi key={kosu.id} kosuId={kosu.id} etiket={`${islemEtiketi(kosu.islem)} #${kosu.id}`} awxJobId={kosu.awxJobId} basladi={kosu.startedAt || kosu.createdAt} onBitti={() => void yukle()} />
          )}
        </div>
      </section>

      {silSor && (
        <KosuSilOnayi kosular={[kosu]} toplu={false} onKapat={() => setSilSor(false)}
          onSilindi={(silinen) => {
            setSilSor(false);
            toast.success(`${islemEtiketi(kosu.islem)} #${kosu.id} silindi. Sunucudaki ham ölçüm dosyaları durur.`);
            (onSilindi || (() => onGeri()))(silinen);
          }} />
      )}

      <Modal open={durdurSor} onClose={() => { if (!durduruluyor) setDurdurSor(false); }}
        title={aktif ? `${islemEtiketi(kosu.islem)} #${kosu.id} durdurulsun mu?` : srvGeriAlinmamis ? `${islemEtiketi(kosu.islem)} #${kosu.id}: sunucu ayarı geri alınsın mı?` : `Koşu #${kosu.id}: kalan süreçler durdurulsun mu?`} size="md" dismissOnBackdrop={false}
        footer={<div className="flex w-full justify-end gap-2">
          <button type="button" className={SM_BTN} style={smBtn()} disabled={durduruluyor} onClick={() => setDurdurSor(false)}>İptal</button>
          <button type="button" className={SM_BTN} style={BTN_TEHLIKE} disabled={durduruluyor} onClick={() => void durdur()}><StopCircleIcon className="h-3.5 w-3.5" aria-hidden /> {durduruluyor ? 'Durduruluyor…' : durdurDugmesi}</button>
        </div>}>
        {srvGeriAlinmamis && !aktif ? (
          <p className="text-[13px] leading-5" style={{ color: 'var(--text-primary)' }}>
            “Durdur” kipinde ayrı bir iş <span className="font-mono">{kosu.hedefHost}</span> üzerinde kalan süreçleri sonlandırır ve bu işin nginx ayarını geri alır. Hedefte başka bir koşunun yedeği varsa ona dokunulmaz.
          </p>
        ) : kosu.islem === 'on_kontrol' ? (
          <p className="text-[13px] leading-5" style={{ color: 'var(--text-primary)' }}>
            Ön kontrolün AWX işi iptal edilir; yarıda kalan ön kontrolün sonucu kullanılamaz.{kosu.sunucuAyari ? ' “Durdur” kipinde ayrı bir iş hedefteki nginx ayarını geri alır.' : ''}
          </p>
        ) : aktif ? (
          <p className="text-[13px] leading-5" style={{ color: 'var(--text-primary)' }}>
            AWX işi iptal edilir ve “durdur” kipinde ayrı bir iş, {durdurmaKapsami}.
            Yarıda kalan koşunun sonuçları geçersiz sayılır. Kilitler, durdurma işi başarıyla bitince bırakılır.
          </p>
        ) : serbest ? (
          <p className="text-[13px] leading-5" style={{ color: 'var(--text-primary)' }}>
            AWX işi zaten durdu; AWX iptali uzaktaki {aracYazi} durdurmaz. “Durdur” kipinde ayrı bir iş, <span className="font-mono">{kosu.yukHost}</span> üzerinde bu koşudan kalan süreçleri sonlandırır (serbest hedefe bağlanılmaz).
            Kilitler, durdurma işi başarıyla bitince bırakılır.
          </p>
        ) : (
          <p className="text-[13px] leading-5" style={{ color: 'var(--text-primary)' }}>
            AWX işi zaten durdu; AWX iptali uzaktaki {aracYazi} ve CPU kaydedicisini durdurmaz. “Durdur” kipinde ayrı bir iş, <span className="font-mono">{kosu.hedefHost}</span> ile <span className="font-mono">{kosu.yukHost}</span> üzerinde bu koşudan kalan süreçleri sonlandırır.
            Kilitler, durdurma işi başarıyla bitince bırakılır.
          </p>
        )}
      </Modal>
    </div>
  );
}

// ── Sonuclar ────────────────────────────────────────────────────────────────────────
function Sonuclar({ kosu, adimlar, aktif, birim, protokol }: { kosu: NlKosuAyrinti; adimlar: NlAdim[]; aktif: boolean; birim: AdimBirimi; protokol: NlProtokol }) {
  const serbest = kosu.hedefTuru === 'serbest';
  // Nginx'siz hedef: istek basina CPU ve kapasite yok (genel host CPU var).
  const nginxsiz = hedefNginxsiz(kosu);
  const cpuYok = serbest || nginxsiz;
  const cpuYokMetni = serbest ? SERBEST_SUNUCU_YOK : NGINX_YOK_CPU_IPUCU;
  const wrk = birim === 'bağlantı';
  const nproc = kosu.analiz.nproc;
  const gruplar = hizGrupla(adimlar, nproc);
  const g = gecerlilikBilgisi(kosu.gecerlilik);
  // HTTP/2 kosu uyarisi olcum modelini anlatir (bilgi): uyari kutusunda sayilmaz, ayri bilgi kutusunda.
  const h2Bilgisi = kosu.analiz.uyarilar.filter((u) => H2_UYARI_KODU_RE.test(u));
  const uyarilar = kosu.analiz.uyarilar.filter((u) => !H2_UYARI_KODU_RE.test(u));
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
  const nokta = (f: (a: NlAdim) => number | null) => sirali.map((a) => ({ x: a.hiz as number, y: f(a), durum: a.gecerlilik, etiket: `${kademeMetni(a.hiz, birim)} · ${adimEtiketi(a)}` }));
  const tekSeri = new Set(gruplar.map((x) => x.seri)).size <= 1;
  const cizgi = (f: (x: (typeof gruplar)[number]) => number | null) => (tekSeri ? gruplar.map((x) => ({ x: x.hiz, y: f(x) })) : []);
  const [ayrintiAcik, setAyrintiAcik] = useState(false);
  const ozet = ozetSec(kosu, adimlar);
  // E5: bellek yalniz olculmus kosuda (eski kosu: kutu ve grafik yok).
  const bellekVar = bellekKolonuVar(adimlar);
  const enBellek = enYuksekNginxBellek(adimlar);
  // 2026-11-03 (bilgi): bant genisligi ve bellek ayrisimi yalniz olculmus kosuda.
  const agVar = agKolonuVar(adimlar);
  const enAg = enYuksekTestTrafigi(adimlar);
  const bosta = kosu.sonucOzeti?.agBosta ?? null;
  const sizinti = bellekSizintiMetni(kosu.sonucOzeti?.bellekSizinti);
  // Test trafigi grafigi: ayni hizdaki tekrarlarin ortalamasi (Mbps) cizgi.
  const agCizgi = [...new Set(sirali.map((a) => a.hiz as number))].map((h) => {
    const v = sirali.filter((a) => a.hiz === h && a.ag?.testAlinanBps != null).map((a) => (a.ag?.testAlinanBps as number) / 1e6);
    return { x: h, y: v.length ? v.reduce((t, x) => t + x, 0) / v.length : null };
  });
  const nedenler = nedenGruplari(kosu, adimlar, kosu.sonucOzeti);
  // Bir adim nedeninin altinda yazilmayan reload olaylari (isinma / bekleme sirasinda ...) kosu duzeyi satirda: kullanici
  // olayi yine gorur, olcumun etkilenmedigi de soylenir.
  const reloadSatiri = reloadOzetMetni(ozet, adimlar, birim, new Set(nedenler.flatMap((x) => x.reloadlar.map((r) => r.t))));
  const ayrintiId = `yuk-ayrinti-${kosu.id}`;

  return (
    <div className="space-y-4">
      {aktif && (kosu.durum === 'FINALIZING' ? (
        <UyariKutusu ton="bilgi" rol="status" baslik={sonucOkunuyorMetni(kosu.sonuclandirmaDenemesi)}>
          AWX işi bitti; Portal sonuç dosyalarını /sw’den okuyup her adımı ({wrk ? 'bağlantı' : 'hız'} × tekrar) ayrı ayrı değerlendiriyor. Okuma {SONUC_DENEME_SINIRI} denemede başarısız olursa koşu “sonuç okunamadı” olur.
        </UyariKutusu>
      ) : (
        <UyariKutusu ton="bilgi" rol="status" baslik="Koşu sürüyor — sonuçlar iş bitince okunur ve burada görünür.">
          Portal, iş bitince sonuç dosyalarını /sw’den okuyup her adımı ({wrk ? 'bağlantı' : 'hız'} × tekrar) ayrı ayrı değerlendirir. Bu sayfayı kapatabilirsiniz.
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
      {nginxsiz && <UyariKutusu ton="bilgi" rol="status" baslik={NGINX_YOK_UYARISI} />}
      {adimlar.length > 0 && <KosuOzetSatiri ozet={ozet} adimlar={adimlar} birim={birim} protokol={protokol} />}
      {h2Bilgisi.length > 0 && <UyariKutusu ton="bilgi" rol="status" baslik={uyariAcikla(h2Bilgisi[0]).cumle} />}
      {g && !aktif && !(okunamadi && kosu.gecerlilik === 'OKUNAMADI') && (
        <div className="rounded-lg px-3 py-2.5" style={{ background: TON[g.ton].zemin, boxShadow: `inset 4px 0 0 ${TON[g.ton].renk}, inset 0 0 0 1px ${TON[g.ton].kenar}` }} role="status">
          <div className="text-[13px] font-semibold leading-5" style={{ color: TON[g.ton].metin }}>Ölçüm {g.etiket}</div>
          <p className="text-[12px] leading-5" style={{ color: 'var(--text-primary)' }}>{g.aciklama}</p>
          {nedenler.length > 0 && <NedenListesi gruplar={nedenler} adimlar={adimlar} birim={birim} />}
          {reloadSatiri && <p className="mt-1.5 wrap-anywhere text-[12px] leading-5" style={{ color: 'var(--text-primary)' }}>{reloadSatiri}</p>}
        </div>
      )}
      {(adimlar.length > 0 || !aktif) && <OzetTablosu adimlar={adimlar} birim={birim} serbest={serbest} aktif={aktif} nproc={nproc} />}
      {uyarilar.length > 0 && (
        <UyariKutusu ton="uyari" baslik={`${uyarilar.length} analiz uyarısı`}>
          {ayrik.genel.length > 0 && <ul className="space-y-1">{ayrik.genel.map((u) => <UyariSatiri key={u} metin={u} />)}</ul>}
          {ayrik.adim.length > 0 && (
            <details className={ayrik.genel.length > 0 ? 'mt-1.5' : undefined}>
              <summary className="cursor-pointer">Adım uyarıları — teknik adım tablosunda uyarı çipiyle işaretli</summary>
              <ul className="mt-1 space-y-1">{ayrik.adim.map((u) => <UyariSatiri key={u} metin={u} etiket={(t) => turCumlesi(t, adimlar, birim)} />)}</ul>
            </details>
          )}
        </UyariKutusu>
      )}
      {adimlar.length > 0 && (
        <div>
          <button type="button" onClick={() => setAyrintiAcik((x) => !x)} aria-expanded={ayrintiAcik} aria-controls={ayrintiId}
            className="inline-flex items-center gap-1.5 rounded text-[12px] font-semibold focus-visible:outline-offset-2!" style={{ color: 'var(--text-primary)' }}>
            {ayrintiAcik ? <ChevronDownIcon className="h-4 w-4" aria-hidden /> : <ChevronRightIcon className="h-4 w-4" aria-hidden />}
            Ayrıntı <span className="font-normal" style={{ color: 'var(--text-secondary)' }}>— CPU / istek, kapasite, doyma, {bellekVar ? 'bellek, ' : ''}{agVar ? 'bant genişliği, ' : ''}grafikler ve teknik adım tablosu</span>
          </button>
          <div id={ayrintiId} hidden={!ayrintiAcik} className="mt-3 space-y-4">
        <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border @3xl/yuk:grid-cols-4" style={{ borderColor: 'var(--border-subtle)', background: 'var(--border-subtle)' }}>
          <OzetHucre etiket="Geçerli adım" alt="doyma dahil; geçersiz adım hesaba katılmaz">{fmtNumber(nGecerli)} / {fmtNumber(adimlar.length)}</OzetHucre>
          {/* Serbest hedefte CPU kaydedici yok: CPU ve kapasite olculmez ("—"), sifir DEGIL; CPU kademesi de yok. */}
          <OzetHucre etiket={`CPU-ms/istek${!cpuYok && kademeCpu != null ? ` @ ${kademeMetni(kademeCpu, birim)}` : ''}`}
            alt={cpuYok ? cpuYokMetni : tlsPay != null ? `TLS payı %${ondalik(tlsPay * 100, 0)}` : 'nginx worker, user+sys, arka plan çıkarılmış'}>{cpuYok ? '—' : cpuMsMetni(gk?.cpuMsIstek)}</OzetHucre>
          <OzetHucre etiket={`p95${kademeP95 != null ? ` @ ${kademeMetni(kademeP95, birim)}` : ''}`} alt={wrk ? 'istemci (wrk, CO düzeltmeli), geçerli adımların ortalaması' : 'istemci (k6), geçerli adımların ortalaması'}>{gp?.p95 != null ? `${ondalik(gp.p95, 1)} ms` : '—'}</OzetHucre>
          <OzetHucre etiket="Tahmini kapasite" alt={cpuYok ? cpuYokMetni : nproc != null ? `${fmtNumber(nproc)} çekirdek × 1000 × 0,8 / CPU-ms` : 'çekirdek sayısı × 1000 × 0,8 / CPU-ms'}>
            <span title={cpuYok ? cpuYokMetni : KAPASITE_IPUCU} className="cursor-help">{!cpuYok && gk?.kapasiteRps != null ? `~${fmtNumber(Math.round(gk.kapasiteRps))} istek/sn` : '—'}</span>
          </OzetHucre>
          {bellekVar && (
            <OzetHucre etiket="Nginx bellek (en yüksek)" alt={enBellek ? `worker RSS toplamı · ${turEtiketi(enBellek.tur, adimlar, birim)}` : 'nginx worker belleği ölçülmedi (yalnız yük makinesi)'}>{mbMetni(enBellek?.mb)}</OzetHucre>
          )}
          {agVar && (
            <OzetHucre etiket="Test trafiği (en yüksek)" alt={enAg ? `alınan, ölçüm fazı ortalaması · ${turEtiketi(enAg.tur, adimlar, birim)}` : 'test trafiği ölçülmedi (yalnız arayüz sayaçları)'}>
              <span title={TEST_TRAFIGI_IPUCU} className="cursor-help">{bantMetni(enAg?.bps)}</span>
            </OzetHucre>
          )}
          {agVar && (
            <OzetHucre etiket="Boşta NIC (hedef)" alt={bosta?.hedef ? `ilk adımdan önce ${fmtNumber(Math.round(bosta.hedef.sn ?? 0))} sn · gelen / giden` : 'boşta taban ölçülmedi'}>
              <span title={NIC_IPUCU} className="cursor-help">{bosta?.hedef ? `${bantMetni(bosta.hedef.rxBps)} / ${bantMetni(bosta.hedef.txBps)}` : '—'}</span>
            </OzetHucre>
          )}
        </dl>
        {sizinti && <UyariKutusu ton={sizinti.ton} rol="status" baslik={sizinti.metin} />}
        <div className="grid gap-5 @3xl/yuk:grid-cols-2">
          <HizGrafigi baslik="p95 yanıt süresi" birim="ms" noktalar={nokta((a) => a.p95)} cizgi={cizgi((x) => x.p95)} xBirimi={birim} />
          <HizGrafigi baslik="CPU-ms / istek" birim="ms" basamak={2} bicim={cpuMsMetni} noktalar={nokta((a) => (cpuYok ? null : a.cpuMsIstek))} cizgi={cizgi((x) => (cpuYok ? null : x.cpuMsIstek))} xBirimi={birim}
            bos={serbest ? 'Serbest hedef: sunucu ölçümü yok (CPU kaydedici ve nginx logu çalışmaz).' : nginxsiz ? 'Nginx olmayan hedef: istek başına CPU ölçülmez (yalnız genel host CPU).' : 'CPU ölçülmedi (sunucu kaydı yok ya da adımlar geçersiz).'} />
          {bellekVar && (
            <HizGrafigi baslik="Nginx bellek (en yüksek)" birim="MB" basamak={0} bicim={mbMetni} noktalar={nokta((a) => a.bellek?.nginxRssMaxMb ?? null)} cizgi={[]} xBirimi={birim}
              bos="Nginx worker belleği ölçülmedi (yalnız yük makinesi belleği var ya da serbest hedef)." />
          )}
          {agVar && (
            <HizGrafigi baslik="Test trafiği (alınan)" birim="Mbps" basamak={1} bicim={(x) => bantMetni(x == null ? null : x * 1e6)}
              noktalar={nokta((a) => (a.ag?.testAlinanBps != null ? a.ag.testAlinanBps / 1e6 : null))} cizgi={agCizgi} xBirimi={birim}
              bos="Test trafiği ölçülmedi (eski yük betiği)." />
          )}
        </div>
        <AdimTablosu adimlar={adimlar} aktif={aktif} birim={birim} serbest={serbest} nginxsiz={nginxsiz} nproc={nproc} />
          </div>
        </div>
      )}
    </div>
  );
}

/** Analiz uyarisi: duz cumle, altinda ham kod (destek icin). Katlanmis adim uyarisinda adim etiketi basta. */
function UyariSatiri({ metin, etiket }: { metin: string; etiket?: (tur: string) => string }) {
  const u = uyariAcikla(metin);
  return (
    <li className="min-w-0">
      <p className="wrap-anywhere">{u.tur && etiket ? `${etiket(u.tur)}: ` : ''}{u.cumle}</p>
      {u.kod && !u.bilinmiyor && <p className="wrap-anywhere font-mono text-[11px] leading-4" style={{ color: 'var(--text-secondary)' }}>{`kod: ${u.kod}`}</p>}
    </li>
  );
}

// ── Adim tablosu ────────────────────────────────────────────────────────────────────
type AdimKolonu = { anahtar: string; baslik: string; genislik: string; sag?: boolean; ipucu?: string };
const KOLONLAR: AdimKolonu[] = [
  { anahtar: 'hiz', baslik: 'Hız', genislik: '6rem', ipucu: `istek/sn · tekrar. ${tekrarIpucu('istek/sn')}` },
  { anahtar: 'durum', baslik: 'Durum', genislik: '9rem' },
  { anahtar: 'p95', baslik: 'p95 ms', genislik: '5.5rem', sag: true, ipucu: 'istemci (k6) p95; ayrıntıda p50 / p99' },
  { anahtar: 'hata', baslik: 'Hata', genislik: '5.5rem', sag: true, ipucu: 'http_req_failed oranı' },
  { anahtar: 'kodlar', baslik: '429 · 5xx · drop', genislik: '7.5rem', sag: true, ipucu: '429 ve 5xx yanıt sayısı, düşen iterasyon (dropped)' },
  { anahtar: 'rps', baslik: 'rps ist. / sun.', genislik: '7.5rem', sag: true, ipucu: 'istemcinin gerçekleşen hızı / sunucu logundaki ölçüm satırları' },
  { anahtar: 'cpu', baslik: 'CPU-ms', genislik: '6rem', sag: true, ipucu: 'istek başına nginx worker CPU (user+sys), arka plan çıkarılmış; milisaniye' },
  { anahtar: 'host', baslik: 'Host CPU', genislik: '5.5rem', sag: true, ipucu: hostCpuIpucu(null) },
  { anahtar: 'kap', baslik: 'Kapasite', genislik: '6.5rem', sag: true, ipucu: KAPASITE_IPUCU },
  // 2026-11-03 (K3): yuk makinesinin olcum penceresi bosta CPU'su; %20 altinda adim YUK DOYDU (eski kosu: —).
  { anahtar: 'yuk', baslik: 'Yük mak. boşta CPU', genislik: '6.5rem', sag: true, ipucu: 'ölçüm penceresinde yük makinesinin boşta CPU ortalaması; %20 altında “yük doydu”: sonuç hedefin değil yük makinesinin sınırını gösterebilir; kayıt beklenip ölçülemeyen adımda “ölçülemedi”' },
  // 2026-11-03 (E5): bellek; yalniz olculmus kosuda (bellekKolonuVar).
  { anahtar: 'rss', baslik: 'Nginx RSS', genislik: '6rem', sag: true, ipucu: 'ölçüm penceresinde nginx worker’larının bellek (RSS) toplamının en yükseği; MB' },
  { anahtar: 'hbel', baslik: 'Hedef bellek', genislik: '5.5rem', sag: true, ipucu: 'ölçüm penceresinde hedefin bellek kullanımı (en yüksek): 1 − MemAvailable / MemTotal' },
  { anahtar: 'ybel', baslik: 'Yük mak. bellek', genislik: '5.5rem', sag: true, ipucu: 'ölçüm penceresinde yük makinesinin bellek kullanımı (en yüksek): 1 − MemAvailable / MemTotal' },
  // 2026-11-03: bant genisligi (test trafigi); yalniz olculmus kosuda (agKolonuVar).
  { anahtar: 'agal', baslik: 'Test alınan', genislik: '6rem', sag: true, ipucu: TEST_TRAFIGI_IPUCU },
  { anahtar: 'aggo', baslik: 'Test gönderilen', genislik: '6rem', sag: true, ipucu: TEST_TRAFIGI_IPUCU },
  { anahtar: 'ac', baslik: '', genislik: '2.5rem' },
];
/** wrk: ilk kolon baglanti sayisi (istek/sn DEGIL), yuzdelikler CO duzeltmeli, dropped olculmez; serbest: sunucu kolonlari bos. */
const WRK_KOLON: Record<string, Partial<AdimKolonu>> = {
  hiz: { baslik: 'Bağlantı', ipucu: `eşzamanlı bağlantı sayısı · tekrar (kapalı döngü; ortalama toplam hız tavanlı). ${tekrarIpucu('bağlantı')}` },
  p95: { ipucu: 'istemci (wrk, CO düzeltmeli) p95; ayrıntıda p50 / p99' },
  hata: { ipucu: '2xx / 3xx dışı yanıt ve soket hatası oranı' },
  kodlar: { ipucu: '429 ve 5xx yanıt sayısı; wrk düşen istek (dropped) ölçmez' },
};
const SUNUCU_KOLONLARI = new Set(['cpu', 'host', 'kap', 'rss', 'hbel']);
const BELLEK_KOLONLARI = new Set(['rss', 'hbel', 'ybel']);
const AG_KOLONLARI = new Set(['agal', 'aggo']);
/** Serbest hedefte sunucu logu yok: rps kolonunun ipucu sunucu logundan soz etmez. */
const SERBEST_RPS_IPUCU = `istemcinin gerçekleşen hızı / ${SERBEST_SUNUCU_YOK}`;
const kolonlar = (birim: AdimBirimi, serbest: boolean, yukCpu: boolean, bellek = false, nproc: number | null = null, ag = false, nginxsiz = false): AdimKolonu[] => KOLONLAR
  .filter((k) => (yukCpu || k.anahtar !== 'yuk') && (bellek || !BELLEK_KOLONLARI.has(k.anahtar)) && (ag || !AG_KOLONLARI.has(k.anahtar))).map((k) => ({
    ...k, ...(k.anahtar === 'host' ? { ipucu: hostCpuIpucu(nproc) } : null), ...(birim === 'bağlantı' ? WRK_KOLON[k.anahtar] : null),
    ...(serbest && SUNUCU_KOLONLARI.has(k.anahtar) ? { ipucu: SERBEST_SUNUCU_YOK } : null),
    ...(serbest && k.anahtar === 'rps' ? { ipucu: SERBEST_RPS_IPUCU } : null),
    ...(!serbest && nginxsiz && NGINXSIZ_BOS_KOLONLAR.has(k.anahtar) ? { ipucu: NGINX_YOK_CPU_IPUCU } : null),
    ...(!serbest && nginxsiz && k.anahtar === 'host' ? { ipucu: NGINXSIZ_HOST_IPUCU } : null),
  }));
/** Nginx'siz hedefte bos kalan kolonlar (istek basina CPU, kapasite) ve genel host CPU ipucu. */
const NGINXSIZ_BOS_KOLONLAR = new Set(['cpu', 'kap']);
const NGINXSIZ_HOST_IPUCU = 'ölçüm penceresinde hedefin genel CPU kullanımı (/proc/stat, tüm süreçler); %90 üstü doyma';
const sayiHucre = 'px-2.5 py-1.5 text-right tabular-nums';
const UYARI_HUCRE = { color: 'var(--status-warning-text)', fontWeight: 600 } as const;
/** Bos bellek %10 altinda (analiz bellek_bos_az ile ayni esik): hucre uyari renginde. */
const bosAz = (x: number | null | undefined) => x != null && x < 10;
const YUK_DOYDU_IPUCU = 'Yük makinesinin boşta CPU’su %20’nin altında: sonuç hedefin değil yük makinesinin sınırını gösterebilir. Adım “doyma” sayılır ve p95 kararında kullanılmaz; hedefin CPU-ms/istek değeri geçerli kalır.';

function AdimTablosu({ adimlar, aktif, birim, serbest, nginxsiz = false, nproc = null }: { adimlar: NlAdim[]; aktif: boolean; birim: AdimBirimi; serbest: boolean; nginxsiz?: boolean; nproc?: number | null }) {
  const [acik, setAcik] = useState<Set<string>>(new Set());
  const sirali = adimSirala(adimlar);
  const cokSeri = new Set(adimlar.map(seriAdi)).size > 1;
  const degistir = (k: string) => setAcik((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  // Yuk makinesi CPU kolonu yalniz olculmus adim varsa (eski kosuda tablo BIREBIR eskisi).
  const yukCpu = yukCpuKolonuVar(adimlar);
  const bellek = bellekKolonuVar(adimlar);
  const ag = agKolonuVar(adimlar);
  const kolonListesi = kolonlar(birim, serbest, yukCpu, bellek, nproc, ag, nginxsiz);
  const genislik = 56 + (yukCpu ? 6.5 : 0) + (bellek ? 17 : 0) + (ag ? 12 : 0);
  return (
    <div>
      <h3 className="mb-1.5 text-[12px] font-semibold" style={{ color: 'var(--text-primary)' }}>Adımlar <span className="font-normal" style={{ color: 'var(--text-secondary)' }}>— her satır bir {birim === 'bağlantı' ? 'bağlantı sayısı' : 'hız'} × tekrar (TUR)</span></h3>
      <div className="overflow-x-auto rounded-lg border" style={{ borderColor: 'var(--border-subtle)' }}>
        <table className="pf-table-sticky w-full table-fixed border-collapse" style={{ minWidth: `${genislik}rem` }} aria-label="Adım sonuçları">
          <colgroup>{kolonListesi.map((k) => <col key={k.anahtar} style={{ width: k.genislik }} />)}</colgroup>
          <thead><tr>{kolonListesi.map((k) => (
            <th key={k.anahtar} scope="col" title={k.ipucu} className={`px-2.5 py-1.5 text-[11px] whitespace-nowrap ${k.sag ? 'text-right' : 'text-left'}`}
              style={k.anahtar === 'hiz' ? { ...TH_STIL, left: 0, zIndex: 3, boxShadow: 'inset 0 -1px 0 var(--border), inset -1px 0 0 var(--border-subtle)' } : TH_STIL}>
              {k.anahtar === 'ac' ? <span className="sr-only">Ayrıntı</span> : k.baslik}
            </th>
          ))}</tr></thead>
          <tbody className="text-[12px]" style={{ color: 'var(--text-primary)' }}>
            {sirali.length === 0 ? (
              <TableEmptyRow colSpan={kolonListesi.length} title={aktif ? 'Adımlar koşu bitince görünür.' : 'Adım sonucu yok.'} description={aktif ? undefined : 'İş başarısız olduysa iş çıktısına bakın; kısmen biten koşuda tamamlanan adımlar listelenir.'} />
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
                      <div className="truncate font-semibold tabular-nums" title={birim === 'bağlantı' ? kademeMetni(a.hiz, birim) : undefined}>{kademeMetni(a.hiz, birim)}</div>
                      <div className="truncate text-[11px]" style={{ color: 'var(--text-secondary)' }} title={a.tur}>{`${adimEtiketi(a)}${cokSeri ? ` · ${seriAdi(a)}` : ''}`}</div>
                    </td>
                    <td className="px-2.5 py-1.5">
                      <div className="flex flex-wrap items-center gap-1">
                        <Hap label={d.etiket} ton={d.ton} />
                        {a.yukDoydu && <Cip ton="uyari" cerceve title={YUK_DOYDU_IPUCU}>YÜK DOYDU</Cip>}
                        {a.uyarilar.length > 0 && <Cip ton="uyari" cerceve title={a.uyarilar.map((u) => uyariAcikla(u).cumle).join('\n')}>{`${fmtNumber(a.uyarilar.length)} uyarı`}</Cip>}
                        <KipCipi kip={a.kipDogrulama} />
                      </div>
                      {a.nedenler.length > 0 && <div className="mt-0.5 truncate text-[11px]" style={{ color: d.ton === 'hata' ? 'var(--status-danger-text)' : 'var(--status-warning-text)' }} title={a.nedenler.map((n) => nedenAcikla(n).cumle).join('\n')}>{nedenAcikla(a.nedenler[0]).cumle}{a.nedenler.length > 1 ? ` +${a.nedenler.length - 1}` : ''}</div>}
                    </td>
                    <td className={sayiHucre} title={`p50 ${ondalik(a.p50)} · p99 ${ondalik(a.p99)} ms`}>{ondalik(a.p95)}</td>
                    <td className={sayiHucre} style={(a.hataOrani ?? 0) > 0.001 ? { color: 'var(--status-danger-text)', fontWeight: 600 } : undefined}>{yuzde(a.hataOrani)}</td>
                    <td className={sayiHucre} style={kotuKod ? { color: 'var(--status-danger-text)', fontWeight: 600 } : (a.dropped ?? 0) > 0 ? { color: 'var(--status-warning-text)', fontWeight: 600 } : undefined}>{kod.map((x) => (x == null ? '—' : fmtNumber(x))).join(' · ')}</td>
                    <td className={sayiHucre}>{ondalik(a.gercekRps, 0)} / {serbest ? <span title={SERBEST_SUNUCU_YOK}>—</span> : pencereIstemci ? <span title={PENCERE_ISTEMCI}>—</span> : ondalik(a.rpsSunucu, 0)}</td>
                    {serbest ? (
                      <>{['cpu', 'host', 'kap'].map((s) => <td key={s} className={sayiHucre} style={{ color: 'var(--text-muted)' }} title={SERBEST_SUNUCU_YOK}>—</td>)}</>
                    ) : (
                      <>
                        {nginxsiz
                          ? <td className={sayiHucre} style={{ color: 'var(--text-muted)' }} title={NGINX_YOK_CPU_IPUCU}>—</td>
                          : <td className={sayiHucre} title={a.cpuOlculemedi ? cpuOlculemediMetni(a.cpuOlculemedi) : undefined}>{cpuMsMetni(a.cpuMsIstek)}</td>}
                        <td className={sayiHucre} style={(a.hostCpuOrt ?? 0) > 90 ? { color: 'var(--status-warning-text)', fontWeight: 600 } : undefined}>{a.hostCpuOrt != null ? `%${ondalik(a.hostCpuOrt, 0)}` : '—'}</td>
                        {nginxsiz
                          ? <td className={sayiHucre} style={{ color: 'var(--text-muted)' }} title={NGINX_YOK_CPU_IPUCU}>—</td>
                          : <td className={sayiHucre} title={a.cpuOlculemedi ? cpuOlculemediMetni(a.cpuOlculemedi) : undefined}>{a.kapasiteRps != null ? `~${fmtNumber(Math.round(a.kapasiteRps))}` : '—'}</td>}
                      </>
                    )}
                    {yukCpu && <td className={sayiHucre} data-testid="yuk-cpu-bosta" style={a.yukDoydu ? { color: 'var(--status-warning-text)', fontWeight: 600 } : undefined}>{yukCpuHucre(a)}</td>}
                    {bellek && (
                      <>
                        <td className={sayiHucre} style={serbest ? { color: 'var(--text-muted)' } : undefined} title={serbest ? SERBEST_SUNUCU_YOK : undefined}>{serbest || !a.bellek ? '—' : mbMetni(a.bellek.nginxRssMaxMb)}</td>
                        <td className={sayiHucre} style={serbest ? { color: 'var(--text-muted)' } : bosAz(a.bellek?.hedefBosMinYuzde) ? UYARI_HUCRE : undefined} title={serbest ? SERBEST_SUNUCU_YOK : undefined}>{serbest || !a.bellek ? '—' : bellekYuzdeMetni(a.bellek.hedefBellekYuzde)}</td>
                        <td className={sayiHucre} style={bosAz(a.bellek?.yukBosMinYuzde) ? UYARI_HUCRE : undefined}>{a.bellek ? bellekYuzdeMetni(a.bellek.yukBellekYuzde) : '—'}</td>
                      </>
                    )}
                    {ag && (
                      <>
                        <td className={sayiHucre} data-testid="ag-alinan">{bantMetni(a.ag?.testAlinanBps)}</td>
                        <td className={sayiHucre} data-testid="ag-gonderilen" title={a.ag && a.ag.testAlinanBps != null && a.ag.testGonderilenBps == null ? 'ölçülmedi (wrk gönderilen baytı saymaz)' : undefined}>{bantMetni(a.ag?.testGonderilenBps)}</td>
                      </>
                    )}
                    <td className="px-1 py-1.5 text-center">
                      <button type="button" onClick={() => degistir(k)} aria-expanded={ac} aria-label={`${a.tur} ayrıntısı`} className="rounded p-0.5 focus-visible:outline-offset-2!" style={{ color: 'var(--text-secondary)' }}>
                        {ac ? <ChevronDownIcon className="h-4 w-4" aria-hidden /> : <ChevronRightIcon className="h-4 w-4" aria-hidden />}
                      </button>
                    </td>
                  </tr>
                  {ac && (
                    <tr style={{ background: 'var(--bg-elevated)' }}>
                      <td colSpan={kolonListesi.length} className="px-3 py-2.5">
                        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 @2xl/yuk:grid-cols-4 @5xl/yuk:grid-cols-6">
                          <Tanim etiket="TUR" title={a.tur}><span className="font-mono text-[11px]">{a.tur}</span></Tanim>
                          <Tanim etiket="p50 · p99 ms">{ondalik(a.p50)} · {ondalik(a.p99)}</Tanim>
                          <Tanim etiket="TTFB p95 ms">{ondalik(a.ttfbP95)}</Tanim>
                          <Tanim etiket="TLS · bağlantı p95 ms">{ondalik(a.tlsP95)} · {ondalik(a.connectP95)}</Tanim>
                          <Tanim etiket="Sunucu süresi p50 · p95 · p99 ms">{ondalik(a.srtP50)} · {ondalik(a.srtP95)} · {ondalik(a.srtP99)}</Tanim>
                          <Tanim etiket="İstek istemci · sunucu">{fmtNumber(a.nIstek)} · {fmtNumber(a.istekSunucu)}</Tanim>
                          <Tanim etiket="Bayt / istek">{a.baytIstek != null ? fmtNumber(Math.round(a.baytIstek)) : '—'}</Tanim>
                          <Tanim etiket="Sıkıştırma">{a.sikistirmaTuru || '—'}</Tanim>
                          {a.bellek && <Tanim etiket="Nginx RSS ort. · en yüksek">{mbMetni(a.bellek.nginxRssOrtMb)} · {mbMetni(a.bellek.nginxRssMaxMb)}</Tanim>}
                          {a.bellek && <Tanim etiket="Boş bellek (en düşük) hedef · yük mak.">{bellekYuzdeMetni(a.bellek.hedefBosMinYuzde)} · {bellekYuzdeMetni(a.bellek.yukBosMinYuzde)}</Tanim>}
                          {a.bellek && <Tanim etiket="Yük aracı RSS (en yüksek)">{mbMetni(a.bellek.aracRssMaxMb)}</Tanim>}
                        </dl>
                        {a.ag && <AgAyrintisi ag={a.ag} tur={a.tur} />}
                        {a.bellekDetay && <BellekAyrisimi d={a.bellekDetay} tur={a.tur} />}
                        {a.kipDogrulama && <KipDogrulamasi kip={a.kipDogrulama} tur={a.tur} />}
                        {a.cpuOlculemedi && <p className="mt-2 text-[11px] leading-4" style={{ color: 'var(--status-warning-text)' }}>{cpuOlculemediMetni(a.cpuOlculemedi)}</p>}
                        {a.nedenler.length > 0 && (
                          <ul className="mt-2 list-disc space-y-0.5 pl-4 text-[11px] leading-4" style={{ color: 'var(--text-primary)' }}>
                            {a.nedenler.map((n) => <li key={n} className="wrap-anywhere">{nedenAcikla(n).cumle} <span className="font-mono" style={{ color: 'var(--text-secondary)' }}>({n})</span></li>)}
                          </ul>
                        )}
                        {a.uyarilar.length > 0 && (
                          <div className="mt-2">
                            <div className="text-[11px] font-semibold leading-4" style={{ color: 'var(--status-warning-text)' }}>Adım uyarıları</div>
                            <ul className="mt-0.5 list-disc space-y-0.5 pl-4 text-[11px] leading-4" style={{ color: 'var(--text-primary)' }} aria-label={`${a.tur} uyarıları`}>
                              {a.uyarilar.map((u) => <li key={u} className="wrap-anywhere">{uyariAcikla(u).cumle} <span className="font-mono" style={{ color: 'var(--text-secondary)' }}>({u})</span></li>)}
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

// ── Bant genisligi ve bellek ayrisimi (2026-11-03, bilgi) ───────────────────────────
function nicMetni(n: NlNic | null): { ort: string; enCok: string; kullanim: string | null; uyari: boolean } | null {
  if (!n) return null;
  const k = n.kullanimMaxYuzde;
  return {
    ort: `${bantMetni(n.rxOrtBps)} / ${bantMetni(n.txOrtBps)}`,
    enCok: `${bantMetni(n.rxMaxBps)} / ${bantMetni(n.txMaxBps)}`,
    kullanim: k != null && n.hizMbps != null ? `%${ondalik(k, 1)} (${bantMetni(n.hizMbps * 1e6)} arayüz)` : null,
    uyari: k != null && k > AG_KULLANIM_ESIK,
  };
}
/** Adim ayrintisi: test trafigi + iki makinenin NIC'i (gelen / giden; ort. ve en yuksek). */
function AgAyrintisi({ ag, tur }: { ag: NlAg; tur: string }) {
  const satirlar: [string, NlNic | null][] = [['Hedef', ag.hedef], ['Yük makinesi', ag.yuk]];
  return (
    <div className="mt-2.5" role="group" aria-label={`${tur} bant genişliği`}>
      <div className="text-[11px] font-semibold leading-4" style={{ color: 'var(--text-primary)' }}>Bant genişliği <span className="font-normal" style={{ color: 'var(--text-secondary)' }}>— bilgi; geçerliliği değiştirmez</span></div>
      <dl className="mt-1 grid grid-cols-2 gap-x-4 gap-y-2 @2xl/yuk:grid-cols-4">
        <Tanim etiket="Test trafiği alınan · gönderilen" title={TEST_TRAFIGI_IPUCU}>{bantMetni(ag.testAlinanBps)} · {bantMetni(ag.testGonderilenBps)}</Tanim>
        {satirlar.map(([ad, n]) => {
          const m = nicMetni(n);
          return (
            <React.Fragment key={ad}>
              <Tanim etiket={`${ad} NIC gelen / giden (ort.)`} title={n ? `${n.arayuz ?? '?'}: ${nicSecimMetni(n.secim)}. ${NIC_IPUCU}` : NIC_IPUCU}>{m ? m.ort : 'ölçülmedi'}</Tanim>
              <Tanim etiket={`${ad} NIC en yüksek · kullanım`}>
                <span style={m?.uyari ? UYARI_HUCRE : undefined}>{m ? `${m.enCok}${m.kullanim ? ` · ${m.kullanim}` : ''}` : '—'}</span>
              </Tanim>
            </React.Fragment>
          );
        })}
      </dl>
    </div>
  );
}
const noktaHucre = (n: NlBellekNoktasi | null, f: (n: NlBellekNoktasi) => number | null, mb = true) => {
  const v = n ? f(n) : null;
  return v == null ? '—' : mb ? mbMetni(v) : fmtNumber(Math.round(v));
};
/** Adim ayrintisi: Anon / Shmem / File / PSS / baglanti (taban -> son -> dinlenme) + kurala dayali olasi neden. */
function BellekAyrisimi({ d, tur }: { d: NlBellekDetay; tur: string }) {
  const satirlar: [string, string, (n: NlBellekNoktasi) => number | null, boolean][] = [
    ['PSS (ana ölçü)', BELLEK_PSS_IPUCU, (n) => n.pssMb, true],
    ['Anon', 'süreçlere özel yığın: istek / bağlantı tamponları, sıkıştırma çalışma alanı', (n) => n.anonMb, true],
    ['Shmem', 'paylaşılan bölgeler: ssl_session_cache, limit_req / limit_conn, cache keys_zone', (n) => n.shmemMb, true],
    ['File', 'eşlenen dosyalar: ikili, modüller, açık dosya önbelleği', (n) => n.fileMb, true],
    ['Bağlantı', BAGLANTI_IPUCU, (n) => n.baglanti, false],
  ];
  return (
    <div className="mt-2.5" role="group" aria-label={`${tur} bellek ayrışımı`}>
      <div className="text-[11px] font-semibold leading-4" style={{ color: 'var(--text-primary)' }}>Bellek ayrışımı <span className="font-normal" style={{ color: 'var(--text-secondary)' }}>— nginx worker toplamı; taban (adımdan önce) → son (ölçüm sonu) → dinlenme{d.dinlenmeSn != null ? ` (+${fmtNumber(Math.round(d.dinlenmeSn))} sn)` : ''}</span></div>
      <table className="mt-1 w-full max-w-[40rem] border-collapse text-[11px] leading-4" style={{ color: 'var(--text-primary)' }}>
        <thead><tr style={{ color: 'var(--text-secondary)' }}>
          <th scope="col" className="px-2 py-1 text-left font-medium">Ölçü</th><th scope="col" className="px-2 py-1 text-right font-medium">Taban</th>
          <th scope="col" className="px-2 py-1 text-right font-medium">Son</th><th scope="col" className="px-2 py-1 text-right font-medium">Dinlenme</th>
        </tr></thead>
        <tbody>
          {satirlar.map(([ad, ipucu, f, mb]) => (
            <tr key={ad} className="border-t" style={{ borderColor: 'var(--border-subtle)' }}>
              <th scope="row" className="px-2 py-1 text-left font-semibold" title={ipucu}>{ad}</th>
              <td className="px-2 py-1 text-right tabular-nums">{noktaHucre(d.taban, f, mb)}</td>
              <td className="px-2 py-1 text-right tabular-nums">{noktaHucre(d.son, f, mb)}</td>
              <td className="px-2 py-1 text-right tabular-nums">{noktaHucre(d.dinlenme, f, mb)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {(d.kapananMax ?? 0) > 0 && <p className="mt-1 text-[11px] leading-4" style={{ color: 'var(--status-warning-text)' }}>{`Pencerede en çok ${fmtNumber(d.kapananMax)} “shutting down” worker.`}</p>}
      {d.nedenler.length > 0 && (
        <ul className="mt-1 list-disc space-y-0.5 pl-4 text-[11px] leading-4" style={{ color: 'var(--text-primary)' }} aria-label={`${tur} olası bellek nedenleri`}>
          {d.nedenler.map((n) => <li key={n} className="wrap-anywhere">{`Olası neden: ${BELLEK_NEDEN_METNI[n] ?? n}`}</li>)}
        </ul>
      )}
    </div>
  );
}

// ── Kip dogrulamasi (2026-11-03, E6) ────────────────────────────────────────────────
const KIP_DURUM_METNI: Record<NlKipDurumu, string> = { tamam: '✔', uyari: 'uyarı', olculmedi: 'ölçülmedi' };
const KIP_DURUM_TONU: Record<NlKipDurumu, 'basari' | 'uyari' | 'notr'> = { tamam: 'basari', uyari: 'uyari', olculmedi: 'notr' };
const KODLAMA_ADI: Record<string, string> = { br: 'br', gzip: 'gzip', yok: 'sıkıştırmasız' };
const AE_KODLAMA_UI: Record<string, string> = { br: 'br', gzip: 'gzip', identity: 'yok' };
/** Tablo cipi: uyari varsa "kip uyarısı", hepsi tamamsa "kip ✔", tamam / olculmedi karisimiysa "kip ✔ (kısmi)" (or. eski koşu, sıkıştırma ölçülmedi); hicbiri olculmediyse cip yok. */
function KipCipi({ kip }: { kip: NlKipDogrulama | null }) {
  if (!kip || kip.durum === 'olculmedi') return null;
  if (kip.durum === 'uyari') return <Cip ton="uyari" cerceve title={kip.uyarilar.map((u) => uyariAcikla(u).cumle).join('\n')}>kip uyarısı</Cip>;
  const olculmeyen = ([['protokol', kip.protokol], ['bağlantı', kip.baglanti], ['sıkıştırma', kip.sikistirma]] as const)
    .filter(([, k]) => k.durum === 'olculmedi').map(([ad]) => ad);
  if (!olculmeyen.length) return <Cip ton="basari" cerceve title="Kip doğrulaması: istenen protokol, bağlantı ve sıkıştırma gerçekleşti.">kip ✔</Cip>;
  return <Cip ton="basari" cerceve title={`Kip doğrulaması: ölçülenler istendiği gibi; ölçülmeyen: ${olculmeyen.join(', ')}.`}>kip ✔ (kısmi)</Cip>;
}
function KipSatiri({ ad, istenen, gerceklesen, durum }: { ad: string; istenen: string; gerceklesen: string; durum: NlKipDurumu }) {
  return (
    <tr className="border-t" style={{ borderColor: 'var(--border-subtle)' }}>
      <th scope="row" className="px-2 py-1 text-left font-semibold">{ad}</th>
      <td className="px-2 py-1">{istenen}</td>
      <td className="px-2 py-1 tabular-nums">{gerceklesen}</td>
      <td className="px-2 py-1"><Hap label={KIP_DURUM_METNI[durum]} ton={KIP_DURUM_TONU[durum]} /></td>
    </tr>
  );
}
/** Adim ayrintisi: istenen / gerceklesen (protokol, baglanti, sikistirma) + sapma uyarilari (bilgi; gecerlilik degismez). */
function KipDogrulamasi({ kip, tur }: { kip: NlKipDogrulama; tur: string }) {
  const p = kip.protokol;
  const b = kip.baglanti;
  const k = kip.sikistirma;
  const protokolMetni = p.durum === 'olculmedi' ? 'ölçülmedi' : `${p.olculen ? PROTOKOL_ETIKETI[p.olculen] : '?'}${p.uyumsuz ? ` (${fmtNumber(p.uyumsuz)} yanıt farklı)` : ''}`;
  const baglantiMetni = b.durum === 'olculmedi' ? 'ölçülmedi'
    : `isteklerin %${ondalik(b.yeniBaglantiYuzde, 1)}’i yeni bağlantıda · bağlantı başına ${b.istekBaglanti != null ? ondalik(b.istekBaglanti, 1) : '—'} istek`;
  const beklenenBaglanti = b.istenen === 'yeni' ? 'yeni bağlantı (~%100 yeni, 1,0 istek / bağlantı)' : b.istenen === 'ka' ? 'keep-alive (yeni bağlantı payı düşük)' : (b.istenen || '—');
  const kodlama = k.istenen ? AE_KODLAMA_UI[k.istenen] : null;
  let sikMetni = 'ölçülmedi';
  if (k.durum !== 'olculmedi' && k.dagilim && k.n) {
    const sira = Object.entries(k.dagilim).filter(([, v]) => v > 0).sort((x, y) => y[1] - x[1]);
    const dag = sira.map(([ad, v]) => `${KODLAMA_ADI[ad] || ad} %${ondalik((100 * v) / (k.n as number), 1)}`).join(' · ');
    const pay = k.istenenYuzde != null && kodlama && kodlama !== 'yok' ? ` — 1 KB üstü yanıtların %${ondalik(k.istenenYuzde, 1)}’i ${kodlama}` : '';
    sikMetni = `${dag}${pay}`;
  }
  const kucuk = k.kucukYuzde != null && k.kucukYuzde > 0 ? `1 KB altı yanıtlar (%${ondalik(k.kucukYuzde, 1)}) sıkıştırılmadan gelebilir; bu pay beklenen sıkıştırılmamış paydır.` : null;
  return (
    <div className="mt-2.5" role="group" aria-label={`${tur} kip doğrulaması`}>
      <div className="text-[11px] font-semibold leading-4" style={{ color: 'var(--text-primary)' }}>Kip doğrulaması <span className="font-normal" style={{ color: 'var(--text-secondary)' }}>— istenen / gerçekleşen (bilgi; geçerliliği değiştirmez)</span></div>
      <table className="mt-1 w-full max-w-[52rem] border-collapse text-[11px] leading-4" style={{ color: 'var(--text-primary)' }}>
        <thead><tr style={{ color: 'var(--text-secondary)' }}>
          <th scope="col" className="px-2 py-1 text-left font-medium">Ölçü</th><th scope="col" className="px-2 py-1 text-left font-medium">İstenen</th>
          <th scope="col" className="px-2 py-1 text-left font-medium">Gerçekleşen</th><th scope="col" className="px-2 py-1 text-left font-medium">Durum</th>
        </tr></thead>
        <tbody>
          <KipSatiri ad="Protokol" istenen={PROTOKOL_ETIKETI[p.istenen]} gerceklesen={protokolMetni} durum={p.durum} />
          <KipSatiri ad="Bağlantı" istenen={beklenenBaglanti} gerceklesen={baglantiMetni} durum={b.durum} />
          <KipSatiri ad="Sıkıştırma" istenen={k.istenen ? (AE_ETIKETI[k.istenen] || k.istenen) : '—'} gerceklesen={sikMetni} durum={k.durum} />
        </tbody>
      </table>
      {kucuk && <p className="mt-1 text-[11px] leading-4" style={{ color: 'var(--text-secondary)' }}>{kucuk}</p>}
      {kip.uyarilar.length > 0 && (
        <ul className="mt-1 list-disc space-y-0.5 pl-4 text-[11px] leading-4" style={{ color: 'var(--status-warning-text)' }} aria-label={`${tur} kip uyarıları`}>
          {kip.uyarilar.map((u) => <li key={u} className="wrap-anywhere">{uyariAcikla(u).cumle} <span className="font-mono" style={{ color: 'var(--text-secondary)' }}>({u})</span></li>)}
        </ul>
      )}
    </div>
  );
}
