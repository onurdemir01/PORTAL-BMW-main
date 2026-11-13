// src/components/nginx_console/yukTesti/YeniKosu.tsx — "Yeni koşu" sihirbazi (yalniz Admin, 2026-10-27).
//
// Akis: senaryo -> hedef IP (BIRINCIL; istege bagli host secici) -> Host basligi -> yuk sunucusu -> yuk araci ve
// parametreler (varsayilan ve sinirlar /hedefler'den) -> "Ön kontrolü başlat" (yuk URETMEZ) -> sonuc paneli
// (engel / onay isteyen uyari) -> "Koşuyu başlat…" onay penceresi -> koşu ayrintisina gecis.
// Kosu, on kontrolun PARAMETRELERIYLE baslar (sunucu yalniz onKontrolKosuId alir); form on kontrolden sonra
// degistirilirse "Başlat" kapanir ve on kontrol yeniden istenir (imza karsilastirmasi; motor ve hedefHost dahil).
// 15 dk sonra da ayni. Sunucu her kurali yeniden uygular; buradaki denetim yalniz nedeni dugmeye basmadan soylemek icin.
//
// TUR 3 (2026-10-28, kullanici: "bazen LB uzerinden bazen direkt sunucuya yuk basabilmek istiyorum"):
//  - IP elle yazilir; gecerli IP, yuk sunucusu ya da secili host degisince 400 ms sonra GET /ip-sinifi. Host secildiyse
//    `hedefHost` ILE (paylasilan VIP'te o host kabul edilir; IP o hostun adaylarindan olmali), elle yazilan IP'de
//    `hedefHost`'SUZ (IP birden cok sunucudaysa 409 ip_belirsiz). On kontrol govdesinde de ayni: elle IP -> null.
//  - Sinif: sunucu (vhost onerileri ve sinirlar siniftan ya da /hedefler satirindan), serbest (LB VIP / yonetilmeyen
//    sunucu: yalniz istemci olcumu, serbest sinirlari ve k6 varsayilanlari - kullanici alani degistirmediyse).
//    400 / 409 ret ve 200 `uygun:false` on kontrolu KAPATIR (mesaj gorunur); 424'te "Yeniden dene" ve dugme ACIK
//    (karar yine sunucuda). Siniflandirma surerken dugme kapali (sinif bilinmeden form sinirlari bilinmez).
//  - Yuk araci: k6 (hizlar, VU) ya da wrk (baglantilar, is parcacigi; ORTALAMA toplam hiz sunucunun hesapladigi
//    tavanla sinirli, istekler kumelenebilir; ekran yalniz gosterir). wrk SNI'yi Host basligina gore secemez: SNI
//    kutusu kapali, govdede false (aciklamasi tam opak --text-secondary; opacity ile soluklastirilmaz).
//  - D7: Host basligi iki kipte serbest metin; sunucu kipinde server_name'ler oneri, listede olmayan ad ENGEL degil
//    (alanin altinda not; on kontrol onay isteyen uyari verir).
//  - Girdiye bagli kalici on kontrol reddi (host_uretim, hedef_uretim, ip_* ...): ayni girdiyle dugme kapali kalir.
// TUR 4 (2026-11-02): /hedefler `araclar.hazir` false iken (set yok, onay bekliyor, okunamadi ya da sunucu bildirmedi)
// formun ustunde hata kutusu + "Araçlar" dugmesi; on kontrol KAPALI (sunucu da 409 araclar_hazir_degil der). Hazirsa
// formun altinda kullanilacak set ("Araç seti #N: k6 ... · wrk ...").
// SADELESTIRME (2026-11-02, R2 / AWX 3474239: "cok parametre var, her birinin etkisi ne?"): formun ustunde yalniz
// senaryo, hedef (IP + Host basligi + yuk sunucusu), yuk (k6 hizlari / wrk baglantilari) ve olcum suresi; hazir ayar
// dugmeleri (Hızlı deneme / Standart / Kapasite, hazirAyarlar.ts) alanlari doldurur, kullanici yine degistirir; secili
// ayar aria-pressed, alanlar elle degisince "Özel". Tahmini toplam sure buyuk ve formulle. Tekrar, isinma, bekleme,
// basta bosta olcum, VU / is parcacigi, baglanti kipi, sikistirma, SNI ve etiket kapali "Gelişmiş ayarlar" altinda; her
// alanin etkisi tek cumle (ALAN_ACIKLAMASI). Gelismis alanda hata varsa bolum acik kalir ve dugmede sayi gorunur.
// Kanonik govde ve imza DEGISMEDI.
// HTTP/2 (2026-11-02, h2_sozlesme.md 5.3; kullanici: "gercek tarayicilar cogunlukla h2 kullanir"): Gelişmiş ayarlar'da
// "Bağlantı"dan once Protokol (HTTP/1.1 varsayilan). wrk secili ya da sunucu h2 kabul etmiyorsa (/hedefler protokoller'de h2
// yok) secim kapali ve gonderilen h1. h2 secilince kip 'ka' yapilir ve 'yeni' secenegi kapanir (h1'e donunce kip degismez).
// Govdede parametreler.protokol HER ZAMAN dolu; imza protokolu icerir (degisince on kontrol eskir). Sunucunun protokol
// 400'leri (gecersiz_istek) alan hatasi olarak gorunur.
// GECE KUYRUGU (2026-11-03): Plan kutusunda "Kuyruk etiketi" (zorunlu, en cok 100) + "Kuyruğa ekle": formun o anki
// govdesi (etiketsiz) taslak kuyruga gider; formda bu ayarlarla bitmis on kontrol varsa numarasi da (uyari turleri
// kuyruk olusturulurken onaya gelir). "Koşuyu başlat…" AYNEN kalir.
// SUNUCU AYARI (2026-11-04; kullanici: gece 30 senaryo, elle konf degistirmeden): Gelişmiş ayarlar'da "Sunucuyu koşu öncesi
// ayarla" kutusu (yalniz sunucu hedefinde; serbestte cizilmez ve govdeye girmez). Seviye br 1-11 / gzip 1-9 (identity'de
// gizli), static kutusu, dizin (kutu acikken HER ZAMAN zorunlu; son deger localStorage'da). Kutu acikken h2 secimi
// /hedefler protokoller'inde h2 olmasa da serbest: sunucu h2'yi kosu oncesi acar. parametreler.sunucuAyar imzaya girer.
// DUZENLEME (2026-11-04; kullanici: "kaydolan bir senaryoyu modifiye edemiyorum"): `duzenlenen` verilirse form o ogenin
// govdesiyle dolar (formGovdeden; YukTestiTab `key` ile yeniden kurar), ustte "“etiket” düzenleniyor", Plan kutusunda "Kuyruğa
// ekle" yerine "Değişikliği kaydet" ve "İptal". Taslakta yerinde degisir; kuyrukta PUT gider, 409 uyari_onayi turleri onay
// kutulariyla sorulur. Toplu ekleme duzenlemede cizilmez.
// KAYITLI TEST (2026-11-04): ustte "Kayıtlı test" seridi (KayitliTest.tsx) formu ayni yoldan doldurur; kaydin senaryosu listede
// yoksa "1 · Senaryo" soyler. TOPLU EKLEME: Plan kutusunun altinda MatrisEkle (matris.ts), `onKuyrugaTopluEkle` ile.
// TEK HEDEF MODELI (2026-11-13, kullanici: "hedef makine ile yuk makinemin ne oldugunun teknik olarak ne onemi var?"):
//  - Hedef = dbo.Inventory'deki her DEV / TEST / QA makine (ad kurali yok; kapi sunucuda). Liste uzun olabilir: secicinin
//    ustunde arama kutusu (ad, ortam, IP; secili host hep listede kalir, "<n> / <toplam> sunucu"). Secenek metninde ortam,
//    ilk uc IP ve nginx ipucu (son on kontrol > envanter > '?'); kesin tespit on kontrolde (playbook).
//  - Elle yazilan, hicbir envanterde olmayan IP (LB VIP) eskisi gibi serbest hedef: ikincil yol (izinli aglar, 200 / 50 tavan).
//  - Tum yuk parametreleri her hedefte acik. "Sunucuyu koşu öncesi ayarla" (sikistirma seviyesi, static, HTTP/2 acma)
//    yalniz nginx hedefte: son on kontrol (ya da bu formun on kontrolu) nginx bulamadiysa kutu KAPALI ve nedeni yazili;
//    govdeye sunucuAyar girmez (sunucu da 409 sunucu_ayari_nginx_yok der). Envanterde nginx gorunmuyorsa kutu acik, not var.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowPathIcon, BoltIcon, ChevronDownIcon, ChevronRightIcon, ClipboardDocumentCheckIcon, ServerStackIcon, WrenchScrewdriverIcon } from '@heroicons/react/24/outline';
import {
  hedeflerNormalle, nginxLoadtestApi, type NlAe, type NlHedef, type NlHedefler, type NlHedefTuru, type NlIpSinifi, type NlKip, type NlKosuAyrinti, type NlKuyrukGovde,
  type NlMotor, type NlParametreler, type NlProtokol, type NlSenaryo, type NlSunucuAyar, type NlUyariTuru,
} from '@/api/nginxLoadtestApi';
import { useAsyncEffect } from '@/hooks/useAsyncEffect';
import { toast } from '@/hooks/useToast';
import { fmtNumber } from '@/utils/datetime';
import { LINK, SM_BTN, TBL_BTN, TON, smBtn } from '@/components/server_hub/retirementStil';
import { UyariKutusu } from '@/components/server_hub/RetirementUi';
import { sureMetni } from '@/components/server_hub/retirementCikti';
import BaslatOnayi, { type BaslatOnayiDegeri } from './BaslatOnayi';
import { etiketsizGovde, formBaslangic, formGovdeden, type Form } from './formGovde';
import KayitliTest from './KayitliTest';
import KosuCiktisi from './KosuCiktisi';
import MatrisEkle from './MatrisEkle';
import { ogeOzeti } from './matris';
import OnKontrolPaneli from './OnKontrolPaneli';
import {
  ALAN_ACIKLAMASI, HAZIR_AYAR_ETIKETI, HAZIR_AYAR_SIRASI, hangiHazirAyar, hazirAyar, hazirAyarSuresiSn, type HazirAyarAdi, type HazirAyarDegerleri,
} from './hazirAyarlar';
import { Alan, Bolum, GIRDI, KosuDurumHapi, SunucuAyarUyarilari, UyariTuruOnayi, girdiStili } from './YukUi';
import { ETIKET_MAX as KUYRUK_ETIKET_MAX, yeniYerelId, type DuzenlenenOge, type TaslakOge } from './kuyrukTaslak';
import {
  AE_ETIKETI, AKTIF_DURUMLAR, GIRDIYE_BAGLI_RETLER, KIP_ETIKETI, PROTOKOL_ETIKETI, SERBEST_VHOST_YARDIMI, SRV_AYAR_ENVANTER_NOTU, SRV_AYAR_NGINX_YOK_NOTU, nginxIpucu, VHOST_LISTEDE_YOK_NOTU, adimDegerleri, baglantiBeklemesiMs,
  SRV_SEVIYE_MAX, baglantilariAyristir, butceSn, butceTavani, hataMetni, hedefSinirlari, hizlariAyristir, ipGecerli, nedenMetni, onKontrolDegerlendir, onKontrolKalanMs,
  limitUyarilari, parametreHatalari, parametreSunucuAyari, srvDizinGecerli, srvDizinYaz, sunucuAyarHatalari, tavanNedeni, tavanRps, vhostGecerli,
} from './yukTestiOrtak';

const tamSayi = (s: string) => (/^\s*\d+\s*$/.test(s) ? Number(s) : NaN);
/** Siniflandirma istegi yazma bitince (her tusta degil). */
const SINIF_GECIKME_MS = 400;
const MOTOR_ETIKETI: Record<NlMotor, string> = { k6: 'k6 — açık döngü (sabit istek/sn)', wrk: 'wrk — kapalı döngü (sabit bağlantı, hız tavanlı)' };
const BOLUM2_ACIKLAMASI = 'Hedef IP’yi yazın ya da envanterden bir sunucu seçin. Envanterdeki (dbo.Inventory) her DEV / TEST / QA makine hedef olabilir; nginx varsa sunucu tarafı ayrıntılı ölçülür (CPU, nginx logu), yoksa yalnız genel CPU. Hiçbir envanterde olmayan bir IP (LB VIP) yalnız izinli ağlarda ve yalnız istemci ölçümüyle (serbest hedef).';
const SERBEST_GOVDESI = 'Hiçbir envanterde kayıtlı değil. Hedefe bağlanılmaz (SSH yok); yalnız istemci ölçümü yapılır (p95, hata, 429). Hedefte limit_req olmayabilir: yükün tek freni Portal tavanıdır (en çok 200 istek/sn, 50 bağlantı). Yük bir LB üzerinden gidiyorsa nginx isteği LB’nin IP’sinden görür: IP başına 500 istek/sn ve vhost başına 5000 istek/sn sınırları LB arkasındaki herkesle paylaşılır. Yük sunucusundaki izin dosyası da bu IP’yi kapsamalı (ön kontrol denetler).';

/** /ip-sinifi sonucu: 200 (sunucu / serbest), kalici ret (400 / 409: dugme kapali) ya da gecici (424: dugme acik). */
type SinifSonucu =
  | { tur: 'tamam'; veri: NlIpSinifi }
  | { tur: 'ret'; mesaj: string }
  | { tur: 'gecici'; mesaj: string };
/** Sunucu hedefinin form icin gereken alanlari (/ip-sinifi sunucu yaniti ya da /hedefler satiri). */
type SunucuHedefi = Pick<NlHedef, 'host' | 'env' | 'vhostlar' | 'vhostVerisi' | 'hizSiniri' | 'vuSiniri' | 'limitReq' | 'limitConn' | 'nginxSon' | 'nginxEnvanter'>;
/** Secici satirinda en cok bu kadar IP; fazlasi "+n". */
const SECICI_IP_SAYISI = 3;
/** Secenek metni: "GBJWLT01 · TEST · 10.151.166.144 · nginx yok" (uygun degilse " — neden"). */
function hedefSecenekMetni(h: NlHedef): string {
  const ipler = h.ipler.length ? ` · ${h.ipler.slice(0, SECICI_IP_SAYISI).join(', ')}${h.ipler.length > SECICI_IP_SAYISI ? ` +${h.ipler.length - SECICI_IP_SAYISI}` : ''}` : '';
  return `${h.host} · ${h.env || '?'}${ipler} · ${nginxIpucu(h)}${h.uygun ? '' : ` — ${nedenMetni(h.neden) || 'uygun değil'}`}`;
}

export default function YeniKosu({ onBasladi, onSenaryolar, onAraclar, onKuyrugaEkle, onKuyrugaTopluEkle, kuyrukOgeSayisi = 0, duzenlenen = null, onTaslakGuncelle, onDuzenlemeBitti }: {
  onBasladi: (kosuId: number) => void; onSenaryolar: () => void; onAraclar?: () => void;
  /** Gece kuyrugu taslagina ekler (verilmezse dugme cizilmez). */
  onKuyrugaEkle?: (o: TaslakOge) => void; kuyrukOgeSayisi?: number;
  /** Toplu ekleme: ogeleri tek seferde taslaga ekler (verilmezse bolum cizilmez). */
  onKuyrugaTopluEkle?: (ogeler: TaslakOge[]) => void;
  /** Duzenlenen oge; form bununla bir kez dolar (degisince bilesen `key` ile yeniden kurulur). */
  duzenlenen?: DuzenlenenOge | null;
  onTaslakGuncelle?: (yerelId: string, d: Pick<TaslakOge, 'etiket' | 'govde' | 'hedef' | 'ozet' | 'butceSn'>) => void;
  /** Kaydetme ya da iptal sonrasi donus. */
  onDuzenlemeBitti?: () => void;
}) {
  const [kuyrukEtiket, setKuyrukEtiket] = useState(duzenlenen?.etiket ?? '');
  const [veri, setVeri] = useState<NlHedefler | null>(null);
  const [senaryolar, setSenaryolar] = useState<NlSenaryo[] | null>(null);
  const [yukHata, setYukHata] = useState('');
  const [form, setForm] = useState<Form | null>(null);
  // On kontrol: baslatilan is ve formun o anki imzasi; kayit (sonuc) is bitince okunur.
  const [ok, setOk] = useState<{ kosuId: number; jobId: number | null; imza: string } | null>(null);
  const [okKayit, setOkKayit] = useState<NlKosuAyrinti | null>(null);
  // Kaydin okundugu an: sunucunun verdigi yas (onKontrolYasSn) bu andan sayilir (istemci saati kaymis olabilir).
  const [okAlindi, setOkAlindi] = useState<number | null>(null);
  const [okEski, setOkEski] = useState('');
  const [islemHata, setIslemHata] = useState('');
  // Girdiye bagli kalici ret (409 host_uretim ...): ayni imzayla on kontrol yeniden denenmez.
  const [girdiRet, setGirdiRet] = useState<string | null>(null);
  const [mesgul, setMesgul] = useState<'onkontrol' | 'baslat' | null>(null);
  const [onayAcik, setOnayAcik] = useState(false);
  const [onayHata, setOnayHata] = useState<string | null>(null);
  const [sunucuUyarilari, setSunucuUyarilari] = useState<string[] | null>(null);
  const [simdi, setSimdi] = useState(() => Date.now());
  // IP siniflandirmasi: sonuc hangi istek anahtari icin (anahtar degisince eski sonuc gosterilmez: "sınıflandırılıyor").
  const [sinif, setSinif] = useState<{ anahtar: string; sonuc: SinifSonucu } | null>(null);
  const [sinifDeneme, setSinifDeneme] = useState(0);
  // Duzenlenen ogenin gelismis ayarlari gorunur gelir (sunucu ayari, protokol ...).
  const [gelismisAcik, setGelismisAcik] = useState(!!duzenlenen);
  // Kuyruk ogesi kaydi: sunucunun istedigi uyari turleri o anki form imzasi icindir (form degisince yeniden sorulur).
  const [duzTurler, setDuzTurler] = useState<{ imza: string; turler: NlUyariTuru[] } | null>(null);
  const [duzOnayli, setDuzOnayli] = useState<Set<string>>(new Set());
  const [duzHata, setDuzHata] = useState('');
  const [duzMesgul, setDuzMesgul] = useState(false);
  const [protokolRet, setProtokolRet] = useState<{ anahtar: string; mesaj: string } | null>(null);
  // Hedef secicinin aramasi (yalniz gorunum; govdeye girmez).
  const [hedefAra, setHedefAra] = useState('');
  const busyRef = useRef(false);

  const yukle = useCallback(async () => {
    try {
      const [h, s] = await Promise.all([nginxLoadtestApi.hedefler(), nginxLoadtestApi.senaryolar()]);
      // Normallestirme istemcide de (idempotent): eski sunucu wrk / serbest alanlarini vermez.
      setVeri(hedeflerNormalle(h));
      setSenaryolar(s.senaryolar || []);
      setYukHata('');
    } catch (e) {
      setYukHata(e instanceof Error ? e.message : String(e));
    }
  }, []);
  useAsyncEffect(async (alive) => { if (alive()) await yukle(); }, [yukle]);
  // Form ilk veriyle kurulur (render sirasinda; effect'te setState yok).
  if (veri && !form) {
    const yuk = veri.yukHostlari.filter((y) => y.uygun);
    const bos = formBaslangic(veri.varsayilan, yuk.length === 1 ? yuk[0].host : '', !!veri.protokoller?.includes('h2'));
    setForm(duzenlenen ? formGovdeden(bos, duzenlenen.govde) : bos);
  }

  const okKayitOku = useCallback(async (id: number) => {
    try {
      const k = (await nginxLoadtestApi.kosu(id)).kosu;
      setOkKayit(k);
      setOkAlindi(Date.now());
    } catch { /* bir sonraki yoklamada yeniden denenir */ }
  }, []);
  const okSuruyor = !!ok && (!okKayit || AKTIF_DURUMLAR.has(okKayit.durum));
  // Yedek yoklama: canli cikti okunamasa da on kontrol kaydi 10 sn'de bir okunur.
  useEffect(() => {
    if (!ok || !okSuruyor) return;
    const z = window.setInterval(() => { void okKayitOku(ok.kosuId); }, 10000);
    return () => window.clearInterval(z);
  }, [ok, okSuruyor, okKayitOku]);
  const okBitti = !!okKayit && okKayit.durum === 'DONE';
  useEffect(() => {
    if (!okBitti) return;
    const z = window.setInterval(() => setSimdi(Date.now()), 1000);
    return () => window.clearInterval(z);
  }, [okBitti]);

  // ── Hedef: secili host (istege bagli) ve yazilan IP ───────────────────────────────
  const hostSatiri = veri && form ? veri.hedefler.find((h) => h.host === form.hedefHost) ?? null : null;
  const ip = form?.hedefIp ?? '';
  const ipBicimli = ipGecerli(ip);
  // Host secildiyse IP o hostun adaylarindan olmali (sunucu da ayni denetimi yapar); degilse istek gonderilmez.
  const adayDisi = !!hostSatiri && ipBicimli && !hostSatiri.ipler.includes(ip);
  const sinifAnahtari = form && ipBicimli && !adayDisi && (!hostSatiri || hostSatiri.uygun)
    ? JSON.stringify([ip, form.yukHost, form.hedefHost, sinifDeneme]) : '';
  useEffect(() => {
    if (!sinifAnahtari) return;
    const [sIp, sYuk, sHost] = JSON.parse(sinifAnahtari) as [string, string, string, number];
    let iptal = false;
    const z = window.setTimeout(() => {
      void (async () => {
        let sonuc: SinifSonucu;
        try {
          // Host secici yolu hedefHost ILE (paylasilan VIP); elle yazilan IP hedefHost'SUZ.
          const r = await nginxLoadtestApi.ipSinifi(sIp, { yukHost: sYuk || null, hedefHost: sHost || null });
          if (r.ok === false) sonuc = { tur: r._httpStatus === 424 ? 'gecici' : 'ret', mesaj: hataMetni(r, 'IP sınıflandırılamadı.') };
          else sonuc = { tur: 'tamam', veri: r };
        } catch (e) {
          // safeJson'un firlattigi ret (nginx'in yakaladigi 409 / 400) kalici; ag / gecit hatasi gecici.
          const st = Number((e as { status?: unknown } | null)?.status);
          sonuc = { tur: st === 400 || st === 409 ? 'ret' : 'gecici', mesaj: e instanceof Error ? e.message : String(e) };
        }
        if (!iptal) setSinif({ anahtar: sinifAnahtari, sonuc });
      })();
    }, SINIF_GECIKME_MS);
    return () => { iptal = true; window.clearTimeout(z); };
  }, [sinifAnahtari]);
  const sinifSonucu = sinifAnahtari && sinif?.anahtar === sinifAnahtari ? sinif.sonuc : null;
  const sinifSuruyor = !!sinifAnahtari && !sinifSonucu;
  const sinifVeri = sinifSonucu?.tur === 'tamam' ? sinifSonucu.veri : null;
  // Tur: siniflandirmadan; o yoksa (surerken / 424) secili host sunucu hedefidir, elle IP bilinmiyor (null).
  const hedefTuru: NlHedefTuru | null = sinifVeri ? sinifVeri.tur : hostSatiri ? 'sunucu' : null;
  const sunucuHedef: SunucuHedefi | null = sinifVeri ? (sinifVeri.tur === 'sunucu' ? sinifVeri : null) : hostSatiri;
  const sunucuHost = form?.hedefHost || (sinifVeri?.tur === 'sunucu' ? sinifVeri.host : '');

  // Host basligi (D7): sunucu kipinde server_name'ler ONERI (null: tarama verisi yok), serbestte liste yok.
  const vhostListesi = hedefTuru === 'sunucu' && sunucuHedef && (sunucuHedef.vhostlar.length > 0 || sunucuHedef.vhostVerisi === true) ? sunucuHedef.vhostlar : null;
  const senaryo = senaryolar && form ? senaryolar.find((s) => String(s.id) === form.senaryoId) ?? null : null;
  const onerilenVhost = senaryo?.vhost && (!vhostListesi || vhostListesi.includes(senaryo.vhost)) ? senaryo.vhost : vhostListesi?.length === 1 ? vhostListesi[0] : '';
  const vhost = form ? form.vhost ?? onerilenVhost : '';
  const vhostListedeYok = !!vhostListesi && !!vhost && vhostGecerli(vhost) && !vhostListesi.includes(vhost);

  // ── Sinirlar ve parametreler (sunucuyla ayni formul) ──────────────────────────────
  const genelSinir = veri?.sinirlar;
  const sinir = genelSinir ? hedefSinirlari(genelSinir, hedefTuru === 'sunucu' ? sunucuHedef : null, { hedefTuru }) : undefined;
  const tavan = genelSinir ? tavanRps(genelSinir, hedefTuru === 'sunucu' ? sunucuHedef : null, hedefTuru) : 0;
  const k6Varsayilan = veri ? (hedefTuru === 'serbest' ? veri.varsayilan.serbest : { hizlar: veri.varsayilan.hizlar, maxvu: veri.varsayilan.maxvu }) : null;
  const hizlarMetni = form ? form.hizlar ?? (k6Varsayilan?.hizlar ?? []).join(' ') : '';
  const maxvuMetni = form ? form.maxvu ?? String(k6Varsayilan?.maxvu ?? '') : '';
  const motor: NlMotor = form?.motor === 'wrk' ? 'wrk' : 'k6';
  const sniEtkin = motor !== 'wrk';
  // HTTP/2 yalniz k6 ve yalniz sunucu kabul ediyorsa; aksi halde gonderilen h1 (secim kapali). h2'de kip 'ka'.
  const h2Acik = !!veri?.protokoller?.includes('h2');
  // Sunucu ayari yalniz nginx hedefte: /hedefler (ya da /ip-sinifi) son on kontrol tespiti ya da bu formun bitmis on kontrolu
  // (ayni hedef) nginx bulamadiysa kutu kapali, govdeye girmez. Envanter ipucu kutuyu KAPATMAZ (yalniz not; on kontrol olcer).
  const okNginxYok = !!okKayit && okKayit.durum === 'DONE' && okKayit.hedefTuru !== 'serbest' && !!sunucuHost && okKayit.hedefHost === sunucuHost && okKayit.onKontrol?.hedefNginx === false;
  const okNginxVar = !!okKayit && okKayit.durum === 'DONE' && !!sunucuHost && okKayit.hedefHost === sunucuHost && okKayit.onKontrol?.hedefNginx === true;
  const srvNginxYok = hedefTuru === 'sunucu' && !okNginxVar && (okNginxYok || sunucuHedef?.nginxSon === false);
  const srvEnvanterNotu = hedefTuru === 'sunucu' && !srvNginxYok && !okNginxVar && sunucuHedef?.nginxSon == null && sunucuHedef?.nginxEnvanter === false;
  // Kutu acikken sunucu h2'yi kosu oncesi acar: secim /hedefler protokoller'inden bagimsiz serbest.
  const srvAktif = hedefTuru === 'sunucu' && !!form?.srvAyar && !srvNginxYok;
  const protokolSecilebilir = motor === 'k6' && (h2Acik || srvAktif);
  const protokol: NlProtokol = protokolSecilebilir && form?.protokol === 'h2' ? 'h2' : 'h1';
  const kip: NlKip = protokol === 'h2' ? 'ka' : form?.kip ?? 'yeni';
  // Sunucunun protokol reddi (400 gecersiz_istek, HTTP/2 metni) ayni motor / protokol / kip secimiyle alan hatasi kalir.
  const protokolAnahtari = `${motor}|${protokol}|${kip}`;
  const protokolRetMetni = protokolRet && protokolRet.anahtar === protokolAnahtari ? protokolRet.mesaj : null;
  const hizlar = hizlariAyristir(hizlarMetni);
  const baglantilar = form ? baglantilariAyristir(form.baglantilar) : null;
  const sunucuAyar: NlSunucuAyar | null = form && srvAktif
    ? { seviye: form.ae === 'identity' ? null : tamSayi(form.srvSeviye), static: form.srvStatic, dizin: form.srvDizin.trim() } : null;
  const srvHata = form && srvAktif ? sunucuAyarHatalari(form.ae, form.srvSeviye, form.srvDizin) : {};
  const param: NlParametreler | null = form ? {
    motor,
    ...(motor === 'wrk'
      ? { baglantilar: baglantilar ?? [], is_parcacigi: tamSayi(form.is_parcacigi) }
      : { hizlar: hizlar ?? [], maxvu: tamSayi(maxvuMetni) }),
    tekrar: tamSayi(form.tekrar), isinma: tamSayi(form.isinma), sure: tamSayi(form.sure), bosluk: tamSayi(form.bosluk),
    bosta: tamSayi(form.bosta), kip, ae: form.ae, protokol, ...(sunucuAyar ? { sunucuAyar } : {}),
  } : null;
  const pHata = param && sinir ? parametreHatalari(param, sinir) : {};
  // 2026-11-03 (K2): olculmus limit_req / limit_conn asimi ENGEL degil, UYARI (sunucu ayni metni plan uyarisi yapar ve
  // ön kontrolde onaylatir). wrk'de hiz tavani sunucunun verdigi deger (sunucu hedefinde 5000).
  const limitUyari = param && hedefTuru === 'sunucu' ? limitUyarilari(motor === 'wrk' ? { ...param, tavan_rps: tavan } : param, sunucuHedef) : [];
  if (form && motor === 'k6' && hizlar == null) pHata.hizlar = 'Yalnız sayı yazın, boşlukla ayırın (ör. 100 250 400).';
  if (form && motor === 'wrk' && baglantilar == null) pHata.baglantilar = 'Yalnız sayı yazın, boşlukla ayırın (ör. 2 4 8).';
  const fHata: Record<string, string> = {};
  if (form && veri) {
    if (!senaryo) fHata.senaryo = 'Senaryo seçin.';
    if (hostSatiri && !hostSatiri.uygun) fHata.hedef = nedenMetni(hostSatiri.neden) || 'Bu sunucu hedef olamaz.';
    if (!ip) fHata.ip = 'Hedef IP’yi yazın.';
    else if (!ipBicimli) fHata.ip = 'Geçerli bir IPv4 adresi yazın (ör. 10.20.30.40).';
    else if (adayDisi && hostSatiri) {
      fHata.ip = hostSatiri.ipler.length
        ? `IP ${hostSatiri.host} sunucusunun adaylarından biri değil (${hostSatiri.ipler.join(', ')}). Başka bir IP için hedef sunucuyu “— IP’yi elle yazacağım —” yapın.`
        : 'Bu hedef için bilinen IP yok.';
    }
    if (!vhost) fHata.vhost = 'Host başlığını yazın.';
    else if (!vhostGecerli(vhost)) fHata.vhost = 'Küçük harf ad yazın (port, joker yok).';
    const yuk = veri.yukHostlari.find((y) => y.host === form.yukHost);
    if (!yuk) fHata.yuk = 'Yük sunucusu seçin.';
    else if (!yuk.uygun) fHata.yuk = nedenMetni(yuk.neden) || 'Bu sunucu yük üretemez.';
    else if (sunucuHost && yuk.host === sunucuHost) fHata.yuk = nedenMetni('ayni_host');
    if (form.etiket.length > 120) fHata.etiket = 'En çok 120 karakter.';
    if (srvHata.seviye) fHata.srvSeviye = srvHata.seviye;
    if (srvHata.dizin) fHata.srvDizin = srvHata.dizin;
  }
  // Gelismis alanlardaki hata sayisi: bolum kapaliyken de soylenir. Hata bolumu ACAR ve acik birakir: hata duzelince
  // kendiliginden kapansa odaktaki alan gizlenir, odak sayfaya duser (inceleme bulgusu 2). Render sirasinda kosullu
  // setState (React'in "onceki degere gore durum ayarla" kalibi): effect'teki gibi bir kare kapali cizilmez.
  const gelismisHatalari = [...(['tekrar', 'isinma', 'bosluk', 'bosta', 'kip', 'ae', 'protokol'] as const), ...(motor === 'wrk' ? ['is_parcacigi'] as const : ['maxvu'] as const)]
    .filter((k) => !!pHata[k]).length + (fHata.etiket ? 1 : 0) + (fHata.srvSeviye ? 1 : 0) + (fHata.srvDizin ? 1 : 0) + (protokolRetMetni ? 1 : 0);
  if (gelismisHatalari > 0 && !gelismisAcik) setGelismisAcik(true);
  const gecerli = !!form && !!param && !Object.keys(pHata).length && !Object.keys(fHata).length;
  // Siniflandirma kapisi: surerken, kalici retle ve `uygun:false` sunucu hedefinde on kontrol kapali; 424 kapatmaz.
  // Ret formdaki diger eksiklerden ONCE soylenir (parametreyi duzeltmek bu hedefi acmaz).
  const sinifReddi = sinifSonucu?.tur === 'ret' || (sinifVeri?.tur === 'sunucu' && !sinifVeri.uygun);
  const sinifEngeli = sinifReddi ? 'Hedef IP kullanılamaz — ayrıntı “Hedef ve yük sunucusu” bölümünde.' : sinifSuruyor ? 'IP sınıflandırılıyor…' : null;
  const govde = gecerli && form && param && senaryo ? {
    senaryoId: senaryo.id, hedefHost: form.hedefHost || null, hedefIp: ip, vhost, yukHost: form.yukHost, sni: sniEtkin && form.sni,
    parametreler: param, ...(form.etiket.trim() ? { etiket: form.etiket.trim() } : {}),
  } : null;
  const imza = govde ? JSON.stringify(govde) : '';
  const girdiReddi = !!girdiRet && girdiRet === imza;
  // Tur 4: arac seti hazir degilse on kontrol kapali (sunucu 409 araclar_* der: hazir degil / ozet sabit yok / ozet degisti / geri cekildi).
  const araclarHazir = veri?.araclar.hazir === true;
  const onKontrolAcik = gecerli && !sinifEngeli && !girdiReddi && araclarHazir;
  const degerlendirme = useMemo(() => onKontrolDegerlendir(okKayit), [okKayit]);
  const kalanMs = onKontrolKalanMs(okKayit, simdi, okAlindi);
  const formDegisti = !!ok && imza !== ok.imza;
  const baslatilir = okBitti && !degerlendirme.engeller.length && !formDegisti && !okEski && (kalanMs == null || kalanMs > 0) && mesgul == null;
  const butce = param && adimDegerleri(param).degerler.length ? butceSn(param) : null;
  // Hazir ayarlar hedefin (daraltilmis) sinirlariyla; serbestte serbest varsayilanlari. Formun degerleri birine birebir
  // esitse o ayar secili gorunur; elle degisen alan "Özel" yapar.
  const ayarlar = sinir && veri ? Object.fromEntries(HAZIR_AYAR_SIRASI.map((a) => [a, hazirAyar(a, sinir, veri.varsayilan, { serbest: hedefTuru === 'serbest' })])) as Record<HazirAyarAdi, HazirAyarDegerleri> : null;
  const formAyari: HazirAyarDegerleri | null = form ? {
    hizlar: hizlarMetni, maxvu: maxvuMetni, baglantilar: form.baglantilar, is_parcacigi: form.is_parcacigi,
    tekrar: form.tekrar, isinma: form.isinma, sure: form.sure, bosluk: form.bosluk, bosta: form.bosta,
  } : null;
  const seciliAyar = ayarlar && formAyari ? hangiHazirAyar(formAyari, motor, ayarlar) : null;

  const degistir = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => (f ? { ...f, [k]: v } : f));
  // Son gecerli dizin hatirlanir (tus basina degil, gecerli olunca).
  const srvDizinMetni = form?.srvDizin.trim() ?? '';
  useEffect(() => {
    if (srvAktif && srvDizinGecerli(srvDizinMetni)) srvDizinYaz(srvDizinMetni);
  }, [srvAktif, srvDizinMetni]);
  const hazirUygula = (ad: HazirAyarAdi) => { if (ayarlar) setForm((f) => (f ? { ...f, ...ayarlar[ad] } : f)); };
  function hedefSec(host: string) {
    const h = veri?.hedefler.find((x) => x.host === host) ?? null;
    setForm((f) => {
      if (!f) return f;
      // "Elle yazacağım": yazilan IP kalir, hedefHost bosalir (govdede null; siniflandirma hedefHost'suz).
      if (!h) return { ...f, hedefHost: '' };
      return { ...f, hedefHost: h.host, hedefIp: h.ipler.includes(f.hedefIp) ? f.hedefIp : h.ipler.length === 1 ? h.ipler[0] : '' };
    });
  }

  // Gece kuyrugu: onay hedefi (sunucu adi / serbestte IP) siniftan; etiket zorunlu.
  const kuyrukHedefi = hedefTuru === 'serbest' ? ip : sunucuHost;
  const kuyrukEtiketi = kuyrukEtiket.trim();
  const kuyrukEtiketHata = kuyrukEtiketi.length > KUYRUK_ETIKET_MAX ? `En çok ${KUYRUK_ETIKET_MAX} karakter.` : null;
  const etiketsiz: NlKuyrukGovde | null = govde ? etiketsizGovde(govde) : null;
  // Form kuyruga alinabilir (etiket haric): toplu ekleme etiketi kendi yazar.
  // Kayitli test: elle IP'de hedef turu bilinmeden srvAktif false, govdede sunucuAyar yok; "Güncelle" onu sessizce silerdi.
  const sablonKaydedilir = !sinifSuruyor && !!hedefTuru;
  const kuyrugaHazir = !!etiketsiz && araclarHazir && !sinifEngeli && !girdiReddi && !!kuyrukHedefi;
  const kuyrugaEklenir = kuyrugaHazir && !!kuyrukEtiketi && !kuyrukEtiketHata;
  // Bu form ayarlariyla bitmis on kontrol: uyari turleri kuyruk olusturulurken onaya gelsin diye ogeye baglanir.
  const bitmisOk = ok && okBitti && !formDegisti && !okEski ? ok.kosuId : null;
  function kuyrugaEkle() {
    if (!onKuyrugaEkle || !kuyrugaEklenir || !etiketsiz || !param) return;
    onKuyrugaEkle({
      yerelId: yeniYerelId(), etiket: kuyrukEtiketi, govde: etiketsiz, hedef: kuyrukHedefi,
      onKontrolKosuId: bitmisOk, ...ogeOzeti(param),
    });
    toast.success(`Kuyruğa eklendi: ${kuyrukEtiketi} (taslakta ${kuyrukOgeSayisi + 1} öğe).`);
    setKuyrukEtiket('');
  }

  // Duzenleme: uyari turleri yalniz sorulan imza icin gecerli.
  const duzGuncelTurler = duzTurler && duzTurler.imza === imza ? duzTurler.turler : null;
  const duzKaydedilir = kuyrugaEklenir && !duzMesgul && (!duzGuncelTurler || duzGuncelTurler.every((t) => duzOnayli.has(t.kod)));
  async function degisikligiKaydet() {
    if (!duzenlenen || !duzKaydedilir || !etiketsiz || !param) return;
    if (duzenlenen.tur === 'taslak') {
      onTaslakGuncelle?.(duzenlenen.yerelId, { etiket: kuyrukEtiketi, govde: etiketsiz, hedef: kuyrukHedefi, ...ogeOzeti(param) });
      toast.success(`Taslak öğesi güncellendi: ${kuyrukEtiketi}.`);
      onDuzenlemeBitti?.();
      return;
    }
    setDuzMesgul(true);
    setDuzHata('');
    try {
      const onaylanan = (duzGuncelTurler ?? []).map((t) => t.kod);
      const r = await nginxLoadtestApi.kuyrukOgeGuncelle(duzenlenen.kuyrukId, duzenlenen.ogeId, { etiket: kuyrukEtiketi, govde: etiketsiz, ...(onaylanan.length ? { onaylananTurler: onaylanan } : {}) });
      if (r.ok) {
        toast.success(`Kuyruk öğesi güncellendi: ${kuyrukEtiketi}.`);
        onDuzenlemeBitti?.();
        return;
      }
      if (r.code === 'uyari_onayi') {
        setDuzTurler({ imza, turler: Array.isArray(r.uyariTurleri) ? r.uyariTurleri : [] });
        setDuzHata('Sunucu yeni uyarı türlerinin onaylanmasını istiyor — her birini okuyup işaretleyin.');
        return;
      }
      setDuzHata(hataMetni(r, 'Öğe güncellenemedi.'));
    } catch (e) {
      setDuzHata(e instanceof Error ? e.message : String(e));
    } finally {
      setDuzMesgul(false);
    }
  }

  async function onKontrolBaslat() {
    if (busyRef.current || !govde || !onKontrolAcik) return;
    busyRef.current = true;
    setMesgul('onkontrol');
    setIslemHata('');
    try {
      const r = await nginxLoadtestApi.onKontrol(govde);
      if (!r.ok || r.kosuId == null) {
        setIslemHata(hataMetni(r, 'Ön kontrol başlatılamadı.'));
        if (r.code && GIRDIYE_BAGLI_RETLER.has(r.code)) setGirdiRet(imza);
        // HTTP/2 kurallarinin sunucu reddi alanin altinda da (Gelişmiş ayarlar acilir).
        if (r.code === 'gecersiz_istek' && /HTTP\/2|protokol/.test(r.message ?? '')) {
          setProtokolRet({ anahtar: protokolAnahtari, mesaj: String(r.message) });
          setGelismisAcik(true);
        }
        return;
      }
      setGirdiRet(null);
      setOk({ kosuId: r.kosuId, jobId: r.jobId ?? null, imza });
      setOkKayit(null);
      setOkEski('');
      toast.success(`Ön kontrol başlatıldı (#${r.kosuId}${r.jobId != null ? `, AWX iş #${r.jobId}` : ''}).`);
      void okKayitOku(r.kosuId);
    } catch (e) {
      setIslemHata(e instanceof Error ? e.message : String(e));
    } finally {
      busyRef.current = false;
      setMesgul(null);
    }
  }

  async function baslat(v: BaslatOnayiDegeri) {
    if (busyRef.current || !ok) return;
    busyRef.current = true;
    setMesgul('baslat');
    setOnayHata(null);
    try {
      const r = await nginxLoadtestApi.baslat({ onKontrolKosuId: ok.kosuId, confirmText: v.confirmText, uyariOnay: v.uyariOnay });
      if (r.ok && r.kosuId != null) {
        toast.success(`Yük testi başladı (koşu #${r.kosuId}${r.jobId != null ? `, AWX iş #${r.jobId}` : ''}).`);
        setOnayAcik(false);
        onBasladi(r.kosuId);
        return;
      }
      if (r.code === 'uyari_onayi') {
        setSunucuUyarilari(Array.isArray(r.uyarilar) ? r.uyarilar.map(String) : []);
        setOnayHata('Sunucu ön kontrol uyarılarının onaylanmasını istiyor — listeyi okuyup kutuyu işaretleyin.');
        return;
      }
      if (r.code === 'on_kontrol_eski') {
        setOnayAcik(false);
        setOkEski(hataMetni(r, nedenMetni('on_kontrol_eski')));
        return;
      }
      setOnayHata(hataMetni(r, 'Koşu başlatılamadı.'));
    } catch (e) {
      setOnayHata(e instanceof Error ? e.message : String(e));
    } finally {
      busyRef.current = false;
      setMesgul(null);
    }
  }

  if (yukHata) {
    return <UyariKutusu ton="hata" rol="alert" baslik="Hedefler ya da senaryolar okunamadı" eylem={<button type="button" onClick={() => void yukle()} className={TBL_BTN} style={smBtn()}>Yeniden dene</button>}>{yukHata}</UyariKutusu>;
  }
  if (!veri || !form || !senaryolar || !sinir || !param) return <div className="skeleton h-72 rounded-xl" aria-busy="true"><span className="sr-only">Yükleniyor…</span></div>;

  const hedefler = [...veri.hedefler].sort((a, b) => Number(b.uygun) - Number(a.uygun) || a.host.localeCompare(b.host));
  // Arama: ad, ortam ya da IP (buyuk / kucuk harf duyarsiz); secili host her zaman listede kalir.
  const araQ = hedefAra.trim().toLocaleLowerCase('tr-TR');
  const gorunenHedefler = araQ
    ? hedefler.filter((h) => h.host === form.hedefHost || `${h.host} ${h.env || ''} ${h.ipler.join(' ')}`.toLocaleLowerCase('tr-TR').includes(araQ))
    : hedefler;
  const uygunHedefSayisi = veri.hedefSayisi ?? hedefler.filter((h) => h.uygun).length;
  const motorlar = veri.motorlar.length ? veri.motorlar : (['k6'] as NlMotor[]);
  const serbest = hedefTuru === 'serbest';
  const sayiAlani = (k: 'tekrar' | 'isinma' | 'sure' | 'bosluk' | 'bosta' | 'is_parcacigi', etiket: string, min: number, max: number, yardim: string, hata = pHata[k] ? `Aralık: ${pHata[k]}` : null) => (
    <Alan id={`yuk-${k}`} etiket={etiket} hata={hata} yardim={yardim}>
      <input id={`yuk-${k}`} type="number" inputMode="numeric" min={min} max={max} value={form[k]} onChange={(e) => degistir(k, e.target.value)} className={`${GIRDI} tabular-nums`} style={girdiStili(!!pHata[k])} aria-invalid={!!pHata[k]} />
    </Alan>
  );
  const adim = adimDegerleri(param);
  const adimSayisi = adim.degerler.length && Number.isInteger(param.tekrar) ? adim.degerler.length * param.tekrar : null;
  const tavanSn = butceTavani(sinir, !!sunucuAyar);
  const butceOran = butce != null ? Math.min(1, butce / tavanSn) : 0;
  const butceTon = butce != null && butce > tavanSn ? 'hata' : butceOran > 0.85 ? 'uyari' : 'aksan';
  const dk = Math.floor(tavanSn / 60);
  // wrk tavan satiri: en kucuk baglanti icin bekleme. B3: olculmus cok kucuk limit artik sinir degil (uyari).
  const enKucukBaglanti = baglantilar?.length ? Math.min(...baglantilar) : null;
  const bekleme = enKucukBaglanti != null ? baglantiBeklemesiMs(enKucukBaglanti, tavan) : null;
  const gelismisGorunur = gelismisAcik;
  const gelismisOzeti = [
    `tekrar ${param.tekrar}`, `ısınma ${form.isinma} sn`, `bekleme ${form.bosluk} sn`, `başta ${form.bosta} sn`,
    motor === 'wrk' ? `${form.is_parcacigi} iş parçacığı` : `en çok ${maxvuMetni} VU`, ...(protokol === 'h2' ? [PROTOKOL_ETIKETI.h2] : []), KIP_ETIKETI[kip], AE_ETIKETI[form.ae],
    ...(sniEtkin && form.sni ? ['SNI'] : []), ...(sunucuAyar ? [parametreSunucuAyari(param)] : []),
  ].join(' · ');
  // On kontrol bu formu artik kapsamiyor (form degisti / sunucu eski dedi / 15 dk doldu).
  const okGecersiz = formDegisti || !!okEski || (kalanMs != null && kalanMs <= 0);
  const neden = !araclarHazir ? 'Yük araçları hazır değil.'
    : sinifReddi ? sinifEngeli
    : !gecerli ? 'Önce formdaki eksikleri giderin.'
      : sinifEngeli ? sinifEngeli
        : girdiReddi ? 'Bu girdiyle ön kontrol reddedildi — hedefi, IP’yi, Host başlığını ya da parametreleri değiştirin.'
          : !ok ? null
            : okSuruyor ? 'Ön kontrol sürüyor.'
              : okKayit && okKayit.durum !== 'DONE' ? 'Ön kontrol başarısız — düzeltip yeniden çalıştırın.'
                : degerlendirme.engeller.length ? 'Ön kontrolde engel var.'
                  : formDegisti ? 'Form ön kontrolden sonra değişti — ön kontrolü yeniden çalıştırın.'
                    : okEski ? okEski
                      : kalanMs != null && kalanMs <= 0 ? 'Ön kontrol 15 dakikadan eski — yeniden çalıştırın.' : null;
  // Onay basamagi: on kontrol kaydi serbestse IP yazdirilir (sunucu da confirmText === hedef_ip ister).
  const onayIp = (okKayit?.hedefTuru ?? hedefTuru) === 'serbest';
  const vhostYardimi = serbest ? SERBEST_VHOST_YARDIMI
    : hedefTuru === 'sunucu' && !vhostListesi ? 'Bu hedef için server_name dökümü yok; adı elle yazın.' : 'İstekler bu Host başlığıyla gider.';
  const ipYardimi = (
    <>
      Yük bu IP’ye gider.
      {hostSatiri && hostSatiri.ipler.length > 0 && (
        <>
          {' '}{hostSatiri.host} adayları:{' '}
          {hostSatiri.ipler.map((a, i) => (
            <React.Fragment key={a}>
              {i > 0 && ', '}
              <button type="button" onClick={() => degistir('hedefIp', a)} className={`${LINK} font-mono`} style={{ color: 'var(--accent)' }} aria-pressed={a === ip}>{a}</button>
            </React.Fragment>
          ))}
        </>
      )}
    </>
  );

  return (
    <div className="space-y-4">
      {duzenlenen && (
        <UyariKutusu ton="bilgi" rol="status" baslik={`“${duzenlenen.etiket}” düzenleniyor`}>
          {duzenlenen.tur === 'kuyruk' ? `Kuyruk #${duzenlenen.kuyrukId} öğesi: ayarları değiştirip Plan kutusundan kaydedin; hedef kuyruğunkiyle aynı kalmalı.` : 'Taslak öğesi: ayarları değiştirip Plan kutusundan kaydedin; sırası korunur.'}
        </UyariKutusu>
      )}
      <KayitliTest govde={sablonKaydedilir ? etiketsiz : null} kapaliNedeni={etiketsiz && !sablonKaydedilir ? 'Hedef türü belirlenmeden kaydedilemez: sunucu ayarı forma yansımıyor ve kayıttan düşerdi. IP sınıflandırması bitince yeniden deneyin.' : null} onYukle={(g) => { setForm((f) => (f ? formGovdeden(f, g) : f)); setProtokolRet(null); }} />
      {!araclarHazir && (
        <UyariKutusu ton="hata" rol="alert" baslik="Yük araçları hazır değil"
          eylem={onAraclar ? <button type="button" onClick={onAraclar} className={TBL_BTN} style={smBtn(true)}><WrenchScrewdriverIcon className="h-3.5 w-3.5" aria-hidden /> Araçlar</button> : undefined}>
          {veri.araclar.mesaj || 'Araç durumu okunamadı.'}
        </UyariKutusu>
      )}
      <div className="grid items-start gap-4 @4xl/yuk:grid-cols-[minmax(0,1fr)_19rem]">
        <div className="min-w-0 space-y-4">
          <Bolum baslik="1 · Senaryo" aciklama="Yük testinin gönderdiği yollar ve ağırlıkları. Senaryo HAR’dan ya da yol listesinden “Senaryolar” bölümünde oluşturulur.">
            {!!form.senaryoId && !senaryo && (
              <div className="mb-3"><UyariKutusu ton="uyari" rol="alert" baslik={`Kayıtlı ayarların senaryosu (#${form.senaryoId}) listede yok; silinmiş olabilir.`}>Listeden başka bir senaryo seçin ya da HAR’dan yeniden oluşturun.</UyariKutusu></div>
            )}
            {senaryolar.length === 0 ? (
              <UyariKutusu ton="bilgi" baslik="Henüz senaryo yok." eylem={<button type="button" onClick={onSenaryolar} className={TBL_BTN} style={smBtn(true)}>Senaryo oluştur</button>}>Önce bir HAR dosyasından ya da yol listesinden senaryo oluşturun.</UyariKutusu>
            ) : (
              <Alan id="yuk-senaryo" etiket="Senaryo" hata={null} yardim={senaryo ? `${senaryo.senaryoTur === 'K' ? 'K — karışık yük' : 'B — büyük dosyalar'} · ${fmtNumber(senaryo.yolSayisi)} yol${senaryo.vhost ? ` · ${senaryo.vhost} için` : ''} · sha256 ${senaryo.sha256.slice(0, 12)}…` : 'Senaryo seçin.'}>
                <select id="yuk-senaryo" value={form.senaryoId} onChange={(e) => degistir('senaryoId', e.target.value)} className={GIRDI} style={girdiStili()}>
                  <option value="">— seçin —</option>
                  {senaryolar.map((s) => <option key={s.id} value={String(s.id)}>{`${s.ad} · ${s.senaryoTur} · ${s.yolSayisi} yol${s.vhost ? ` · ${s.vhost}` : ''}`}</option>)}
                </select>
              </Alan>
            )}
          </Bolum>

          <Bolum baslik="2 · Hedef ve yük sunucusu" aciklama={BOLUM2_ACIKLAMASI}>
            <div className="grid gap-3 @lg/yuk:grid-cols-2">
              <Alan id="yuk-ip" etiket="Hedef IP" hata={ip ? fHata.ip : null} yardim={ipYardimi}>
                <input id="yuk-ip" value={form.hedefIp} onChange={(e) => degistir('hedefIp', e.target.value.trim())} placeholder="ör. 10.20.30.40" autoComplete="off" spellCheck={false}
                  aria-invalid={(!!ip && !!fHata.ip) || undefined} className={`${GIRDI} font-mono tabular-nums`} style={girdiStili(!!ip && !!fHata.ip)} />
              </Alan>
              <Alan id="yuk-hedef" etiket="Hedef sunucu (isteğe bağlı)" hata={form.hedefHost ? fHata.hedef : null}
                yardim={`Envanterdeki DEV / TEST / QA makineler (${fmtNumber(uygunHedefSayisi)} uygun); nginx ipucu son ön kontrolden ya da envanterden, kesin tespit ön kontrolde. IP birden çok sunucuda tanımlıysa (paylaşılan VIP) buradan seçin.`}>
                <input id="yuk-hedef-ara" type="search" aria-label="Hedef sunucu ara" placeholder="Ad, ortam ya da IP" value={hedefAra} onChange={(e) => setHedefAra(e.target.value)}
                  autoComplete="off" spellCheck={false} className={`${GIRDI} mb-1.5`} style={girdiStili()} aria-controls="yuk-hedef" aria-describedby="yuk-hedef-sayi" />
                <select id="yuk-hedef" value={form.hedefHost} onChange={(e) => hedefSec(e.target.value)} className={`${GIRDI} ${form.hedefHost ? 'font-mono' : ''}`} style={girdiStili(!!form.hedefHost && !!fHata.hedef)}>
                  <option value="">— IP’yi elle yazacağım —</option>
                  {gorunenHedefler.map((h) => <option key={h.host} value={h.host} disabled={!h.uygun}>{hedefSecenekMetni(h)}</option>)}
                </select>
                <p id="yuk-hedef-sayi" className="mt-1 text-[11px] leading-4 tabular-nums" style={{ color: 'var(--text-muted)' }} aria-live="polite">{`${fmtNumber(gorunenHedefler.length)} / ${fmtNumber(hedefler.length)} sunucu`}</p>
              </Alan>
              <div className="@lg/yuk:col-span-2">
                <SinifKutusu anahtar={sinifAnahtari} suruyor={sinifSuruyor} sonuc={sinifSonucu} onYenidenDene={() => setSinifDeneme((d) => d + 1)} nginxYok={srvNginxYok} />
              </div>
              <Alan id="yuk-vhost" etiket="Host başlığı (vhost)" hata={vhost ? fHata.vhost : null} not={vhostListedeYok ? VHOST_LISTEDE_YOK_NOTU : null} yardim={vhostYardimi}>
                <input id="yuk-vhost" value={vhost} onChange={(e) => degistir('vhost', e.target.value.trim().toLowerCase())} list={vhostListesi?.length ? 'yuk-vhost-oneriler' : undefined}
                  placeholder="ornek-test.fw.garantibbva.com.tr" autoComplete="off" spellCheck={false} aria-invalid={(!!vhost && !!fHata.vhost) || undefined}
                  className={GIRDI} style={girdiStili(!!vhost && !!fHata.vhost)} />
                {vhostListesi && vhostListesi.length > 0 && (
                  <datalist id="yuk-vhost-oneriler">{vhostListesi.map((v) => <option key={v} value={v} />)}</datalist>
                )}
              </Alan>
              <Alan id="yuk-yuk" etiket="Yük sunucusu" hata={form.yukHost ? fHata.yuk : null} yardim="k6 / wrk bu sunucuda çalışır.">
                <select id="yuk-yuk" value={form.yukHost} onChange={(e) => degistir('yukHost', e.target.value)} className={`${GIRDI} font-mono`} style={girdiStili(!!form.yukHost && !!fHata.yuk)}>
                  <option value="">— seçin —</option>
                  {veri.yukHostlari.map((y) => <option key={y.host} value={y.host} disabled={!y.uygun || y.host === sunucuHost}>{`${y.host} · ${y.env || '?'}${!y.uygun ? ` — ${nedenMetni(y.neden) || 'uygun değil'}` : y.host === sunucuHost ? ' — hedefle aynı' : ''}`}</option>)}
                </select>
              </Alan>
              {senaryo?.vhost && vhost && senaryo.vhost !== vhost && (
                <div className="@lg/yuk:col-span-2"><UyariKutusu ton="uyari" baslik={`Senaryo ${senaryo.vhost} için hazırlanmış; seçilen vhost ${vhost}. Yollar bu vhost’ta 200 dönmeyebilir.`} /></div>
              )}
            </div>
          </Bolum>

          <Bolum baslik="3 · Yük ve süre"
            aciklama={motor === 'wrk'
              ? `Kapalı döngü: her adımda sabit bağlantı sayısı; her bağlantı yanıtı alınca, bağlantı başına sabit beklemeden sonra yeni istek gönderir (ortalama toplam ≤ ${tavan} istek/sn). Sınırlar: bağlantı ≤ ${sinir.maxBaglanti}, iş parçacığı ≤ ${sinir.maxIsParcacigi}, toplam ≤ ${dk} dk.`
              : `Açık döngü: her hızda sabit varış hızı, her iterasyon tek GET. Sınırlar: hız ≤ ${sinir.maxHiz}/sn, VU ≤ ${sinir.maxVu}, toplam ≤ ${dk} dk.`}>
            <div className="grid gap-3 @lg/yuk:grid-cols-2">
              {/* Yuk araci kipi: iki secenek de gorunur (dar kolonda secim kutusu aciklamayi kesiyordu). Yerel radyo:
                  ok tuslari secer; odak etiketin cevresinde gorunur. */}
              <fieldset className="min-w-0 @lg/yuk:col-span-2">
                <legend className="mb-1 text-[11px] font-semibold leading-4" style={{ color: 'var(--text-secondary)' }}>Yük aracı</legend>
                <div className="inline-flex max-w-full flex-wrap gap-1 rounded-lg p-0.5" style={{ background: 'var(--bg-elevated)' }}>
                  {motorlar.map((m) => {
                    const secili = motor === m;
                    return (
                      <label key={m} className="inline-flex h-7 min-w-0 max-w-full cursor-pointer items-center rounded-md px-3 text-[12px] font-medium leading-none has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-1 has-[:focus-visible]:outline-[var(--accent)]"
                        style={secili ? { background: 'var(--bg-surface)', color: 'var(--text-primary)', boxShadow: 'inset 0 0 0 1px var(--border)' } : { color: 'var(--text-secondary)' }}>
                        <input type="radio" name="yuk-motor" value={m} checked={secili} onChange={() => degistir('motor', m)} className="sr-only" />
                        <span className="truncate" title={MOTOR_ETIKETI[m]}>{MOTOR_ETIKETI[m]}</span>
                      </label>
                    );
                  })}
                </div>
              </fieldset>
              {/* Hazir ayarlar: alanlari doldurur (kip / sikistirma / SNI / etiket dokunulmaz); secili olan aria-pressed. */}
              <div className="min-w-0 @lg/yuk:col-span-2" role="group" aria-labelledby="yuk-hazir-baslik">
                <div id="yuk-hazir-baslik" className="mb-1 text-[11px] font-semibold leading-4" style={{ color: 'var(--text-secondary)' }}>Hazır ayar</div>
                <div className="grid gap-2 @lg/yuk:grid-cols-3">
                  {HAZIR_AYAR_SIRASI.map((a) => {
                    const secili = seciliAyar === a;
                    const sn = ayarlar ? hazirAyarSuresiSn(ayarlar[a], motor) : null;
                    return (
                      <button key={a} type="button" onClick={() => hazirUygula(a)} aria-pressed={secili} disabled={!ayarlar}
                        className="flex min-w-0 flex-col justify-start rounded-lg px-3 py-2 text-left disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-offset-2!"
                        style={secili
                          ? { background: TON.aksan.zemin, boxShadow: `inset 0 0 0 1.5px ${TON.aksan.renk}`, color: 'var(--text-primary)' }
                          : { background: 'var(--bg-surface)', boxShadow: 'inset 0 0 0 1px var(--border)', color: 'var(--text-primary)' }}>
                        <span className="flex items-baseline justify-between gap-2">
                          <span className="truncate text-[12px] font-semibold" title={HAZIR_AYAR_ETIKETI[a].ad}>{HAZIR_AYAR_ETIKETI[a].ad}</span>
                          <span className="shrink-0 text-[11px] tabular-nums" style={{ color: secili ? TON.aksan.metin : 'var(--text-secondary)' }}>{sn != null ? `≈ ${sureMetni(sn)}` : '—'}</span>
                        </span>
                        <span className="mt-0.5 block text-[11px] leading-4" style={{ color: 'var(--text-secondary)' }}>{HAZIR_AYAR_ETIKETI[a].aciklama}</span>
                      </button>
                    );
                  })}
                </div>
                <p className="mt-1 text-[11px] leading-4" style={{ color: 'var(--text-secondary)' }} aria-live="polite">
                  {seciliAyar ? `${HAZIR_AYAR_ETIKETI[seciliAyar].ad} seçili; alanları yine değiştirebilirsiniz.` : 'Özel ayar: alanları kendiniz değiştirdiniz (bir hazır ayara tıklayınca değerler yeniden dolar).'}
                </p>
              </div>
              {motor === 'wrk' ? (
                <Alan id="yuk-baglantilar" etiket="Bağlantılar" hata={pHata.baglantilar || null} yardim={`${ALAN_ACIKLAMASI.baglantilar} Boşlukla ayırın; en çok 5 kademe, her biri 1–${sinir.maxBaglanti}.`}>
                  <input id="yuk-baglantilar" value={form.baglantilar} onChange={(e) => degistir('baglantilar', e.target.value)} autoComplete="off" spellCheck={false} className={`${GIRDI} font-mono tabular-nums`} style={girdiStili(!!pHata.baglantilar)} aria-invalid={!!pHata.baglantilar} />
                </Alan>
              ) : (
                <Alan id="yuk-hizlar" etiket="Hızlar (istek/sn)" hata={pHata.hizlar || null} yardim={`${ALAN_ACIKLAMASI.hizlar} Boşlukla ayırın; en çok 5 kademe, her biri 1–${sinir.maxHiz}.`}>
                  <input id="yuk-hizlar" value={hizlarMetni} onChange={(e) => degistir('hizlar', e.target.value)} autoComplete="off" spellCheck={false} className={`${GIRDI} font-mono tabular-nums`} style={girdiStili(!!pHata.hizlar)} aria-invalid={!!pHata.hizlar} />
                </Alan>
              )}
              {limitUyari.length > 0 && (
                <div className="min-w-0 @lg/yuk:col-span-2" data-testid="yuk-limit-uyarisi">
                  <UyariKutusu ton="uyari" rol="status" baslik="Seçim hedefin ölçülmüş sınırını aşıyor; ön kontrol bunu onaylatır (engel değil).">
                    <ul className="list-disc space-y-0.5 pl-4">{limitUyari.map((u) => <li key={u}>{u}</li>)}</ul>
                  </UyariKutusu>
                </div>
              )}
              {sayiAlani('sure', 'Ölçüm süresi (sn)', sinir.sureMin, sinir.sureMax, ALAN_ACIKLAMASI.sure)}
              {/* Tahmini toplam sure: buyuk ve formulle (her adim isinma + olcum + bekleme + 20 sn pay). */}
              <div className="min-w-0 rounded-lg px-3 py-2.5 @lg/yuk:col-span-2" style={{ background: 'var(--bg-elevated)' }} aria-live="polite">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                  <span className="text-[12px] font-semibold" style={{ color: 'var(--text-secondary)' }}>Tahmini toplam süre</span>
                  <span className="text-[20px] font-semibold leading-7 tabular-nums" style={{ fontFamily: 'var(--font-display)', color: pHata.butce ? 'var(--status-danger-text)' : 'var(--text-primary)' }}>
                    {butce != null && Number.isFinite(butce) ? `≈ ${sureMetni(butce)}` : '—'}
                  </span>
                </div>
                <div className="mt-1.5 h-1.5 rounded-full" style={{ background: 'var(--bg-surface)' }} role="meter" aria-label="Tahmini süre / üst sınır" aria-valuemin={0} aria-valuemax={tavanSn} aria-valuenow={butce != null && Number.isFinite(butce) ? butce : 0}>
                  <div className="h-full rounded-full" style={{ width: `${Math.round((Number.isFinite(butceOran) ? butceOran : 0) * 100)}%`, background: TON[butceTon].renk }} />
                </div>
                <p className="mt-1 text-[11px] leading-4 tabular-nums" style={{ color: pHata.butce ? 'var(--status-danger-text)' : 'var(--text-secondary)' }}>
                  {pHata.butce || (adimSayisi != null
                    ? `${fmtNumber(adimSayisi)} adım (${adim.degerler.length} ${motor === 'wrk' ? 'bağlantı kademesi' : 'hız'} × ${param.tekrar} tekrar) × (ısınma ${form.isinma} + ölçüm ${form.sure} + bekleme ${form.bosluk} + 20 sn pay) + başta ${form.bosta} sn + 120 sn. Üst sınır ${dk} dk.`
                    : `Üst sınır ${dk} dk; iş bu süreyi aşarsa kendini durdurur.`)}
                </p>
              </div>
              {motor === 'wrk' && (
                <div className="space-y-2 @lg/yuk:col-span-2">
                  <p className="rounded-lg px-3 py-2 text-[12px] leading-5 tabular-nums" style={{ background: 'var(--bg-elevated)', color: 'var(--text-primary)' }} aria-live="polite">
                    {`Ortalama toplam hız tavanı: ${tavan} istek/sn (bağlantı başına bekleme ≈ ${bekleme ?? '—'} ms; ${tavanNedeni(veri.sinirlar, hedefTuru === 'sunucu' ? sunucuHedef : null, hedefTuru)})`}
                  </p>
                  {/* WR2: tavan ORTALAMA hizi sinirlar; anlik hiz kumelenir (Portal limit_req burst'unu okumaz). */}
                  <UyariKutusu ton="uyari" baslik={`wrk kapalı döngüdür; Portal toplam hızı ORTALAMADA ${tavan} istek/sn ile sınırlar. İlk 429 ya da 5xx yanıtta koşu durur (DUR).`}>
                    Bağlantılar birlikte başlar, ilk istekler rastgele yayılır ama istekler kümelenebilir: limit_req burst’ü bağlantı sayısından küçük ya da burst’süz yollarda 429 alınır ve koşu durur. Böyle yollarda k6 kullanın ya da küçük bağlantı sayılarıyla başlayın.
                  </UyariKutusu>
                </div>
              )}
              {/* Gelismis ayarlar: kapali; hata varsa acik kalir. Icerik DOM'da kalir (hidden): deger ve imza degismez. */}
              <div className="min-w-0 border-t pt-3 @lg/yuk:col-span-2" style={{ borderColor: 'var(--border-subtle)' }}>
                <button type="button" onClick={() => setGelismisAcik((x) => !x)} aria-expanded={gelismisGorunur} aria-controls="yuk-gelismis"
                  className="flex w-full min-w-0 items-start gap-1.5 rounded text-left focus-visible:outline-offset-2!">
                  {gelismisGorunur ? <ChevronDownIcon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden style={{ color: 'var(--text-secondary)' }} /> : <ChevronRightIcon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden style={{ color: 'var(--text-secondary)' }} />}
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2 text-[12px] font-semibold" style={{ color: 'var(--text-primary)' }}>
                      Gelişmiş ayarlar
                      {gelismisHatalari > 0 && <span className="rounded px-1.5 text-[11px] leading-4" style={{ background: TON.hata.zemin, color: TON.hata.metin }}>{`${gelismisHatalari} alan hatalı`}</span>}
                    </span>
                    <span className="mt-0.5 block truncate text-[11px] leading-4" style={{ color: 'var(--text-secondary)' }} title={gelismisOzeti}>{gelismisOzeti}</span>
                  </span>
                </button>
                <div id="yuk-gelismis" hidden={!gelismisGorunur} className="mt-3 grid gap-3 @lg/yuk:grid-cols-2 @3xl/yuk:grid-cols-3">
                  {sayiAlani('tekrar', 'Tekrar', 1, sinir.maxTekrar, ALAN_ACIKLAMASI.tekrar)}
                  {sayiAlani('isinma', 'Isınma (sn)', 5, sinir.isinmaMax, ALAN_ACIKLAMASI.isinma)}
                  {sayiAlani('bosluk', 'Adımlar arası bekleme (sn)', 0, 120, serbest ? ALAN_ACIKLAMASI.boslukSerbest : ALAN_ACIKLAMASI.bosluk)}
                  {sayiAlani('bosta', 'Başta boşta ölçüm (sn)', 30, 120, serbest ? ALAN_ACIKLAMASI.bostaSerbest : ALAN_ACIKLAMASI.bosta)}
                  {motor === 'wrk'
                    ? sayiAlani('is_parcacigi', 'İş parçacığı', 1, sinir.maxIsParcacigi, `${ALAN_ACIKLAMASI.is_parcacigi} 1–16; her bağlantı sayısını tam bölmeli.`, pHata.is_parcacigi || null)
                    : (
                      <Alan id="yuk-maxvu" etiket="En çok VU" hata={pHata.maxvu ? `Aralık: ${pHata.maxvu}` : null} yardim={ALAN_ACIKLAMASI.maxvu}>
                        <input id="yuk-maxvu" type="number" inputMode="numeric" min={10} max={sinir.maxVu} value={maxvuMetni} onChange={(e) => degistir('maxvu', e.target.value)} className={`${GIRDI} tabular-nums`} style={girdiStili(!!pHata.maxvu)} aria-invalid={!!pHata.maxvu} />
                      </Alan>
                    )}
                  {/* HTTP/2: yalniz k6; wrk ya da h2'yi kabul etmeyen sunucuda kapali ve HTTP/1.1 gosterir. */}
                  <Alan id="yuk-protokol" etiket="Protokol" hata={pHata.protokol || protokolRetMetni}
                    yardim={motor === 'wrk' ? ALAN_ACIKLAMASI.protokolWrk : !h2Acik && !srvAktif ? ALAN_ACIKLAMASI.protokolYok : ALAN_ACIKLAMASI.protokol}>
                    <select id="yuk-protokol" value={protokol} disabled={!protokolSecilebilir} className={GIRDI} style={girdiStili(!!(pHata.protokol || protokolRetMetni))}
                      onChange={(e) => {
                        const v: NlProtokol = e.target.value === 'h2' ? 'h2' : 'h1';
                        // h2 keep-alive ister: kip 'ka' yapilir (gorunur); h1'e donunce kip kendiliginden degismez.
                        setForm((f) => (f ? { ...f, protokol: v, ...(v === 'h2' ? { kip: 'ka' as const } : {}) } : f));
                      }}>
                      {(['h1', 'h2'] as const).map((k) => <option key={k} value={k}>{PROTOKOL_ETIKETI[k]}</option>)}
                    </select>
                  </Alan>
                  <Alan id="yuk-kip" etiket={motor === 'wrk' ? 'Bağlantı kipi' : 'Bağlantı'} hata={pHata.kip || null}
                    yardim={motor === 'wrk' ? `${ALAN_ACIKLAMASI.kip} ${ALAN_ACIKLAMASI.kipWrk}` : protokol === 'h2' ? ALAN_ACIKLAMASI.kipH2 : ALAN_ACIKLAMASI.kip}>
                    <select id="yuk-kip" value={kip} onChange={(e) => degistir('kip', e.target.value as NlKip)} className={GIRDI} style={girdiStili(!!pHata.kip)}>
                      {(['yeni', 'ka'] as const).map((k) => <option key={k} value={k} disabled={k === 'yeni' && protokol === 'h2'}>{KIP_ETIKETI[k]}</option>)}
                    </select>
                  </Alan>
                  <Alan id="yuk-ae" etiket="Sıkıştırma (Accept-Encoding)" yardim={ALAN_ACIKLAMASI.ae}>
                    <select id="yuk-ae" value={form.ae} onChange={(e) => degistir('ae', e.target.value as NlAe)} className={GIRDI} style={girdiStili()}>
                      {(['br', 'gzip', 'identity'] as const).map((k) => <option key={k} value={k}>{AE_ETIKETI[k]}</option>)}
                    </select>
                  </Alan>
                  <label className={`flex items-start gap-2 text-[12px] @lg/yuk:col-span-2 ${sniEtkin ? 'cursor-pointer' : 'cursor-not-allowed'}`} style={{ color: sniEtkin ? 'var(--text-primary)' : 'var(--text-secondary)' }}>
                    <input type="checkbox" className="mt-0.5 accent-[var(--accent)]" checked={sniEtkin && form.sni} disabled={!sniEtkin} onChange={(e) => degistir('sni', e.target.checked)} />
                    <span>SNI ile bağlan <span style={{ color: 'var(--text-secondary)' }}>{`— ${sniEtkin ? ALAN_ACIKLAMASI.sni : ALAN_ACIKLAMASI.sniWrk}`}</span></span>
                  </label>
                  {hedefTuru === 'sunucu' && (
                    <div className="min-w-0 space-y-3 @lg/yuk:col-span-2 @3xl/yuk:col-span-3">
                      <label className={`flex items-start gap-2 text-[12px] ${srvNginxYok ? 'cursor-not-allowed' : 'cursor-pointer'}`} style={{ color: srvNginxYok ? 'var(--text-secondary)' : 'var(--text-primary)' }}>
                        <input id="yuk-srv-ayar" type="checkbox" className="mt-0.5 accent-[var(--accent)]" checked={srvAktif} disabled={srvNginxYok} aria-describedby={srvNginxYok || srvEnvanterNotu ? 'yuk-srv-not' : undefined}
                          onChange={(e) => degistir('srvAyar', e.target.checked)} />
                        <span>Sunucuyu koşu öncesi ayarla <span style={{ color: 'var(--text-secondary)' }}>{`— ${ALAN_ACIKLAMASI.sunucuAyar}`}</span></span>
                      </label>
                      {(srvNginxYok || srvEnvanterNotu) && (
                        <p id="yuk-srv-not" className="text-[11px] leading-4" style={{ color: srvNginxYok ? 'var(--status-warning-text)' : 'var(--text-secondary)' }}>
                          {srvNginxYok ? SRV_AYAR_NGINX_YOK_NOTU : SRV_AYAR_ENVANTER_NOTU}
                        </p>
                      )}
                      {srvAktif && (
                        <div className="grid gap-3 @lg/yuk:grid-cols-2">
                          {form.ae !== 'identity' && (
                            <Alan id="yuk-srv-seviye" etiket={`${form.ae === 'br' ? 'Brotli' : 'Gzip'} seviyesi (1–${SRV_SEVIYE_MAX[form.ae]})`} hata={fHata.srvSeviye || null} yardim={ALAN_ACIKLAMASI.srvSeviye}>
                              <input id="yuk-srv-seviye" type="number" inputMode="numeric" min={1} max={SRV_SEVIYE_MAX[form.ae]} value={form.srvSeviye} onChange={(e) => degistir('srvSeviye', e.target.value)}
                                className={`${GIRDI} tabular-nums`} style={girdiStili(!!fHata.srvSeviye)} aria-invalid={!!fHata.srvSeviye} />
                            </Alan>
                          )}
                          <Alan id="yuk-srv-dizin" etiket="Uygulama dizini" hata={fHata.srvDizin || null} yardim={ALAN_ACIKLAMASI.srvDizin}>
                            <input id="yuk-srv-dizin" value={form.srvDizin} onChange={(e) => degistir('srvDizin', e.target.value)} placeholder="/usr/nginx/applications/uygulama" autoComplete="off" spellCheck={false}
                              className={`${GIRDI} font-mono`} style={girdiStili(!!fHata.srvDizin)} aria-invalid={!!fHata.srvDizin} />
                          </Alan>
                          <label className="flex cursor-pointer items-start gap-2 text-[12px] @lg/yuk:col-span-2" style={{ color: 'var(--text-primary)' }}>
                            <input id="yuk-srv-static" type="checkbox" className="mt-0.5 accent-[var(--accent)]" checked={form.srvStatic} onChange={(e) => degistir('srvStatic', e.target.checked)} />
                            <span>static (önceden sıkıştırılmış dosya) <span style={{ color: 'var(--text-secondary)' }}>{`— ${ALAN_ACIKLAMASI.srvStatic}`}</span></span>
                          </label>
                        </div>
                      )}
                    </div>
                  )}
                  <Alan id="yuk-etiket" etiket="Etiket (isteğe bağlı)" className="@lg/yuk:col-span-2 @3xl/yuk:col-span-3" hata={fHata.etiket || null} yardim={ALAN_ACIKLAMASI.etiket}>
                    <input id="yuk-etiket" value={form.etiket} maxLength={120} onChange={(e) => degistir('etiket', e.target.value)} autoComplete="off" className={GIRDI} style={girdiStili(!!fHata.etiket)} />
                  </Alan>
                </div>
              </div>
            </div>
          </Bolum>
          {araclarHazir && (
            <p className="flex items-center gap-1.5 text-[11px] leading-4" style={{ color: 'var(--text-secondary)' }}>
              <WrenchScrewdriverIcon className="h-3.5 w-3.5 shrink-0" aria-hidden />
              <span className="min-w-0">{`Araç seti #${veri.araclar.aracId ?? '?'}: k6 ${veri.araclar.k6Surum || '?'} · wrk ${veri.araclar.wrkSurum || '?'}`}</span>
            </p>
          )}
        </div>

        <aside className="min-w-0 space-y-3 @4xl/yuk:sticky @4xl/yuk:top-4">
          <Bolum baslik="Plan" govdeSinifi="p-4 space-y-3">
            <div className="text-[12px] leading-5" style={{ color: 'var(--text-primary)' }}>
              <div className="flex items-baseline justify-between gap-2"><span style={{ color: 'var(--text-secondary)' }}>Adım</span><b className="tabular-nums">{adimSayisi != null ? `${fmtNumber(adimSayisi)} (${adim.degerler.length} ${motor === 'wrk' ? 'bağlantı kademesi' : 'hız'} × ${param.tekrar})` : '—'}</b></div>
              <div className="flex items-baseline justify-between gap-2"><span style={{ color: 'var(--text-secondary)' }}>Tahmini süre</span><b className="tabular-nums">{butce != null && Number.isFinite(butce) ? `≈ ${sureMetni(butce)}` : '—'}</b></div>
              <div className="mt-1.5 h-1.5 rounded-full" style={{ background: 'var(--bg-elevated)' }} role="meter" aria-label="Süre bütçesi" aria-valuemin={0} aria-valuemax={tavanSn} aria-valuenow={butce != null && Number.isFinite(butce) ? butce : 0}>
                <div className="h-full rounded-full" style={{ width: `${Math.round((Number.isFinite(butceOran) ? butceOran : 0) * 100)}%`, background: TON[butceTon].renk }} />
              </div>
              <p className="mt-1 text-[11px]" style={{ color: pHata.butce ? 'var(--status-danger-text)' : 'var(--text-muted)' }}>{pHata.butce || `Üst sınır ${dk} dk; iş bu süreyi aşarsa kendini durdurur.`}</p>
            </div>
            <ol className="space-y-1.5 text-[12px]" aria-label="Adımlar">
              <Basamak no={1} ad="Ön kontrol" durum={!ok ? 'bekliyor' : okSuruyor ? 'suruyor' : !okBitti || degerlendirme.engeller.length ? 'hata' : okGecersiz ? 'eski' : 'tamam'} />
              <Basamak no={2} ad={onayIp ? 'Onay (hedef IP)' : 'Onay (sunucu adı)'} durum={baslatilir ? 'hazir' : 'bekliyor'} />
              <Basamak no={3} ad="Koşu" durum="bekliyor" />
            </ol>
            <div className="flex flex-col gap-2">
              <button type="button" onClick={() => void onKontrolBaslat()} disabled={!onKontrolAcik || mesgul != null || okSuruyor} className={`${SM_BTN} h-8 justify-center`} style={smBtn(!ok || formDegisti || !!okEski || (kalanMs != null && kalanMs <= 0))}
                title="Yük üretmez: hedef ve yük sunucusunu denetler, senaryodaki her yola tek istek gönderir.">
                {mesgul === 'onkontrol' ? <ArrowPathIcon className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" aria-hidden /> : <ClipboardDocumentCheckIcon className="h-3.5 w-3.5" aria-hidden />}
                {ok ? 'Ön kontrolü yeniden çalıştır' : 'Ön kontrolü başlat'}
              </button>
              <button type="button" onClick={() => { setOnayHata(null); setSunucuUyarilari(null); setOnayAcik(true); }} disabled={!baslatilir} className={`${SM_BTN} h-8 justify-center`} style={smBtn(baslatilir)}>
                <BoltIcon className="h-3.5 w-3.5" aria-hidden /> Koşuyu başlat…
              </button>
              {neden && <p className="text-[11px] leading-4" style={{ color: 'var(--text-secondary)' }}>{neden}</p>}
              {(onKuyrugaEkle || duzenlenen) && (
                <div className="space-y-1.5 border-t pt-2" style={{ borderColor: 'var(--border-subtle)' }}>
                  <Alan id="yuk-kuyruk-etiket" etiket="Kuyruk etiketi (zorunlu)" hata={kuyrukEtiketHata} yardim="Bu koşuda ne değiştirdiniz? Ör. “A3 brotli seviye 4”. Koşu etiketine yazılır.">
                    <input id="yuk-kuyruk-etiket" value={kuyrukEtiket} maxLength={KUYRUK_ETIKET_MAX + 20} onChange={(e) => setKuyrukEtiket(e.target.value)} autoComplete="off" className={GIRDI} style={girdiStili(!!kuyrukEtiketHata)} />
                  </Alan>
                  {duzenlenen ? (
                    <>
                      {duzGuncelTurler && duzGuncelTurler.length > 0 && <UyariTuruOnayi baslik="Yeni uyarı türleri — gece bunlar da kabul edilir" turler={duzGuncelTurler} onayli={duzOnayli} onDegisti={setDuzOnayli} />}
                      {duzHata && <UyariKutusu ton={duzGuncelTurler ? 'uyari' : 'hata'} rol="alert" baslik={duzHata} />}
                      <div className="flex gap-2">
                        <button type="button" onClick={() => void degisikligiKaydet()} disabled={!duzKaydedilir} className={`${SM_BTN} h-8 flex-1 justify-center`} style={smBtn(duzKaydedilir)}>Değişikliği kaydet</button>
                        <button type="button" onClick={() => onDuzenlemeBitti?.()} disabled={duzMesgul} className={`${SM_BTN} h-8 justify-center`} style={smBtn()}>İptal</button>
                      </div>
                    </>
                  ) : (
                    <button type="button" onClick={kuyrugaEkle} disabled={!kuyrugaEklenir} className={`${SM_BTN} h-8 w-full justify-center`} style={smBtn()}
                      title="Ayarları gece kuyruğu taslağına ekler; ön kontrol gece her koşudan önce otomatik çalışır.">
                      Kuyruğa ekle{kuyrukOgeSayisi > 0 ? ` (taslakta ${kuyrukOgeSayisi})` : ''}
                    </button>
                  )}
                </div>
              )}
              {okBitti && kalanMs != null && kalanMs > 0 && !formDegisti && !okEski && (
                <p className="text-[11px] leading-4 tabular-nums" style={{ color: kalanMs < 120000 ? 'var(--status-warning-text)' : 'var(--text-secondary)' }}>Ön kontrol {sureMetni(kalanMs / 1000)} daha geçerli.</p>
              )}
            </div>
          </Bolum>
          {onKuyrugaEkle && onKuyrugaTopluEkle && !duzenlenen && (
            <MatrisEkle govde={kuyrugaHazir ? etiketsiz : null} motor={motor} hedefTuru={hedefTuru} srvAyarli={srvAktif} hedef={kuyrukHedefi} taslakSayisi={kuyrukOgeSayisi} onKontrolKosuId={bitmisOk}
              onEkle={(l) => { onKuyrugaTopluEkle(l); toast.success(`Taslağa ${l.length} öğe eklendi (taslakta ${kuyrukOgeSayisi + l.length} öğe).`); }} />
          )}
          {islemHata && <UyariKutusu ton="hata" rol="alert" baslik="Ön kontrol başlatılamadı">{islemHata}</UyariKutusu>}
        </aside>
      </div>

      {ok && (
        <Bolum baslik={<span className="flex flex-wrap items-center gap-2">Ön kontrol #{ok.kosuId}{okKayit && <KosuDurumHapi durum={okKayit.durum} />}</span>}
          aciklama={formDegisti ? 'Form bu ön kontrolden sonra değişti: sonuç yeni değerleri kapsamıyor.' : 'Yük üretilmez. Sonuç geldiğinde engeller ve onay isteyen uyarılar burada listelenir.'}
          govdeSinifi="p-4 space-y-4">
          {okKayit && !AKTIF_DURUMLAR.has(okKayit.durum) && <OnKontrolPaneli kosu={okKayit} />}
          {okKayit?.sunucuAyari && <SunucuAyarUyarilari ayar={okKayit.sunucuAyari} />}
          {okEski && <UyariKutusu ton="uyari" rol="alert" baslik={okEski} />}
          <KosuCiktisi key={ok.kosuId} kosuId={ok.kosuId} etiket={`Ön kontrol #${ok.kosuId}`} awxJobId={ok.jobId} basladi={okKayit?.startedAt || okKayit?.createdAt} onBitti={() => void okKayitOku(ok.kosuId)} yukseklik="min(20rem, calc(100dvh - 24rem))" />
        </Bolum>
      )}

      {onayAcik && okKayit && (
        <BaslatOnayi onKontrol={okKayit} senaryo={senaryo} uyarilar={degerlendirme.uyarilar} sunucuUyarilari={sunucuUyarilari} busy={mesgul === 'baslat'} hata={onayHata}
          onOnay={(v) => void baslat(v)} onKapat={() => setOnayAcik(false)} />
      )}
    </div>
  );
}

/**
 * Yazilan IP'nin sinifi. Sunucu hedefi sakin bir bilgi satiri; serbest hedef uyari (yalniz istemci olcumu, LB
 * paylasimi); kalici ret ve `uygun:false` hata (on kontrol kapali); gecici (424) uyari + "Yeniden dene" (dugme acik).
 */
function SinifKutusu({ anahtar, suruyor, sonuc, onYenidenDene, nginxYok = false }: { anahtar: string; suruyor: boolean; sonuc: SinifSonucu | null; onYenidenDene: () => void; nginxYok?: boolean }) {
  if (!anahtar) return null;
  if (suruyor || !sonuc) {
    return (
      <div role="status" className="flex items-center gap-2 rounded-lg px-3 py-2 text-[12px] leading-5" style={{ background: 'var(--bg-elevated)', color: 'var(--text-secondary)' }}>
        <ArrowPathIcon className="h-4 w-4 shrink-0 animate-spin motion-reduce:animate-none" aria-hidden /> IP sınıflandırılıyor…
      </div>
    );
  }
  if (sonuc.tur === 'gecici') {
    return (
      <UyariKutusu ton="uyari" rol="status" baslik={sonuc.mesaj}
        eylem={<button type="button" onClick={onYenidenDene} className={TBL_BTN} style={smBtn()}><ArrowPathIcon className="h-3.5 w-3.5" aria-hidden /> Yeniden dene</button>}>
        Sınıflandırma geçici olarak yapılamadı; ön kontrol yine çalıştırılabilir (karar sunucuda verilir).
      </UyariKutusu>
    );
  }
  if (sonuc.tur === 'ret') return <UyariKutusu ton="hata" rol="alert" baslik={sonuc.mesaj} />;
  const v = sonuc.veri;
  if (v.tur === 'serbest') {
    return (
      <UyariKutusu ton="uyari" rol="status" baslik={`Serbest hedef (${v.ag} izinli ağında)`}>
        <p>{SERBEST_GOVDESI}</p>
        {v.digerSahipler.length > 0 && <p className="mt-1 wrap-anywhere">{`Envanterde: ${v.digerSahipler.map((d) => `${d.host} (${d.env || '?'})`).join(', ')}`}</p>}
      </UyariKutusu>
    );
  }
  if (!v.uygun) return <UyariKutusu ton="hata" rol="alert" baslik={v.neden || nedenMetni(v.kod) || 'Bu sunucu hedef olamaz.'} />;
  return (
    <div role="status" className="flex items-start gap-2 rounded-lg px-3 py-2 text-[12px] leading-5" style={{ background: TON.aksan.zemin, boxShadow: `inset 0 0 0 1px ${TON.aksan.kenar}`, color: 'var(--text-primary)' }}>
      <ServerStackIcon className="mt-0.5 h-4 w-4 shrink-0" style={{ color: TON.aksan.metin }} aria-hidden />
      <span className="min-w-0">{`Sunucu hedefi: ${v.host} (${v.env || '?'}) — ${sunucuOlcumMetni(v, nginxYok)}; IP’nin sunucuda yerel olduğu ön kontrolde ve koşu başında doğrulanır.`}</span>
    </div>
  );
}

/** Sunucu hedefinde neyin olculecegi: nginx'li (ya da ipucu yok / eski sunucu) hedefte eski metin BIREBIR. */
function sunucuOlcumMetni(v: Pick<NlHedef, 'nginxSon' | 'nginxEnvanter'>, nginxYok: boolean): string {
  if (nginxYok || v.nginxSon === false) return 'son ön kontrol nginx bulamadı: genel CPU ve istemci metrikleri ölçülür (nginx kurulduysa ön kontrol yeniden tespit eder)';
  if (v.nginxSon !== true && v.nginxEnvanter === false) return 'envanterde nginx görünmüyor: ön kontrol tespit eder (nginx varsa CPU kaydedici ve nginx logu, yoksa genel CPU ölçülür)';
  return 'CPU kaydedici ve nginx logu ölçülür';
}

type BasamakDurumu = 'bekliyor' | 'suruyor' | 'tamam' | 'hata' | 'hazir' | 'eski';
function Basamak({ no, ad, durum }: { no: number; ad: string; durum: BasamakDurumu }) {
  const ton = durum === 'tamam' ? TON.basari : durum === 'hata' ? TON.hata : durum === 'eski' ? TON.uyari : durum === 'suruyor' || durum === 'hazir' ? TON.aksan : TON.notr;
  const metin = { bekliyor: 'bekliyor', suruyor: 'sürüyor', tamam: 'tamam', hata: 'engel var', hazir: 'hazır', eski: 'yenilenmeli' }[durum];
  return (
    <li className="flex items-center gap-2">
      <span aria-hidden className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold ${durum === 'suruyor' ? 'animate-status-pulse motion-reduce:animate-none' : ''}`} style={{ background: ton.zemin, color: ton.metin, boxShadow: `inset 0 0 0 1px ${ton.kenar}` }}>{no}</span>
      <span className="min-w-0 flex-1" style={{ color: 'var(--text-primary)' }}>{ad}</span>
      <span className="text-[11px]" style={{ color: ton.metin }}>{metin}</span>
    </li>
  );
}
