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
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowPathIcon, BoltIcon, ClipboardDocumentCheckIcon, ServerStackIcon } from '@heroicons/react/24/outline';
import {
  hedeflerNormalle, nginxLoadtestApi, type NlAe, type NlHedef, type NlHedefler, type NlHedefTuru, type NlIpSinifi, type NlKip, type NlKosuAyrinti,
  type NlMotor, type NlParametreler, type NlSenaryo, type NlVarsayilanlar,
} from '@/api/nginxLoadtestApi';
import { useAsyncEffect } from '@/hooks/useAsyncEffect';
import { toast } from '@/hooks/useToast';
import { fmtNumber } from '@/utils/datetime';
import { LINK, SM_BTN, TBL_BTN, TON, smBtn } from '@/components/server_hub/retirementStil';
import { UyariKutusu } from '@/components/server_hub/RetirementUi';
import { sureMetni } from '@/components/server_hub/retirementCikti';
import BaslatOnayi, { type BaslatOnayiDegeri } from './BaslatOnayi';
import KosuCiktisi from './KosuCiktisi';
import OnKontrolPaneli from './OnKontrolPaneli';
import { Alan, Bolum, GIRDI, KosuDurumHapi, girdiStili } from './YukUi';
import {
  AE_ETIKETI, AKTIF_DURUMLAR, GIRDIYE_BAGLI_RETLER, KIP_ETIKETI, SERBEST_VHOST_YARDIMI, VHOST_LISTEDE_YOK_NOTU, adimDegerleri, baglantiBeklemesiMs,
  baglantilariAyristir, butceSn, hataMetni, hedefSinirlari, hizlariAyristir, ipGecerli, nedenMetni, onKontrolDegerlendir, onKontrolKalanMs,
  parametreHatalari, tavanNedeni, tavanRps, vhostGecerli,
} from './yukTestiOrtak';

interface Form {
  senaryoId: string; hedefHost: string; hedefIp: string; yukHost: string; sni: boolean; motor: NlMotor;
  /** null: kullanici yazmadi -> onerilen (senaryonun vhost'u ya da sunucunun tek server_name'i). */
  vhost: string | null;
  /** null: kullanici degistirmedi -> hedef turunun varsayilani (serbestte 50 100 200 / 50). */
  hizlar: string | null; maxvu: string | null;
  baglantilar: string; is_parcacigi: string;
  tekrar: string; isinma: string; sure: string; bosluk: string; bosta: string; kip: NlKip; ae: NlAe; etiket: string;
}
const formBaslangic = (v: NlVarsayilanlar, yukHost = ''): Form => ({
  senaryoId: '', hedefHost: '', hedefIp: '', vhost: null, yukHost, sni: false, motor: v.motor === 'wrk' ? 'wrk' : 'k6',
  hizlar: null, maxvu: null, baglantilar: v.baglantilar.join(' '), is_parcacigi: String(v.is_parcacigi),
  tekrar: String(v.tekrar), isinma: String(v.isinma), sure: String(v.sure), bosluk: String(v.bosluk),
  bosta: String(v.bosta), kip: v.kip, ae: v.ae, etiket: '',
});
const tamSayi = (s: string) => (/^\s*\d+\s*$/.test(s) ? Number(s) : NaN);
/** Siniflandirma istegi yazma bitince (her tusta degil). */
const SINIF_GECIKME_MS = 400;
const MOTOR_ETIKETI: Record<NlMotor, string> = { k6: 'k6 — açık döngü (sabit istek/sn)', wrk: 'wrk — kapalı döngü (sabit bağlantı, hız tavanlı)' };
const BOLUM2_ACIKLAMASI = 'Hedef IP’yi yazın ya da envanterden bir nginx sunucusu seçin. IP bir DEV / TEST / QA nginx sunucusunun ise sunucu tarafı da ölçülür (CPU, nginx logu); bir LB VIP’i ya da envanterde olmayan bir sunucu ise yalnız izinli ağlarda ve yalnız istemci ölçümüyle (serbest hedef).';
const SERBEST_GOVDESI = 'Envanterdeki bir nginx sunucusuna ait değil. Hedefe bağlanılmaz (SSH yok); yalnız istemci ölçümü yapılır (p95, hata, 429). Hedefte limit_req olmayabilir: yükün tek freni Portal tavanıdır (en çok 200 istek/sn, 50 bağlantı). Yük bir LB üzerinden gidiyorsa nginx isteği LB’nin IP’sinden görür: IP başına 500 istek/sn ve vhost başına 5000 istek/sn sınırları LB arkasındaki herkesle paylaşılır. Yük sunucusundaki izin dosyası da bu IP’yi kapsamalı (ön kontrol denetler).';

/** /ip-sinifi sonucu: 200 (sunucu / serbest), kalici ret (400 / 409: dugme kapali) ya da gecici (424: dugme acik). */
type SinifSonucu =
  | { tur: 'tamam'; veri: NlIpSinifi }
  | { tur: 'ret'; mesaj: string }
  | { tur: 'gecici'; mesaj: string };
/** Sunucu hedefinin form icin gereken alanlari (/ip-sinifi sunucu yaniti ya da /hedefler satiri). */
type SunucuHedefi = Pick<NlHedef, 'host' | 'env' | 'vhostlar' | 'vhostVerisi' | 'hizSiniri' | 'vuSiniri'>;

export default function YeniKosu({ onBasladi, onSenaryolar }: { onBasladi: (kosuId: number) => void; onSenaryolar: () => void }) {
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
    setForm(formBaslangic(veri.varsayilan, yuk.length === 1 ? yuk[0].host : ''));
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
  const hizlar = hizlariAyristir(hizlarMetni);
  const baglantilar = form ? baglantilariAyristir(form.baglantilar) : null;
  const param: NlParametreler | null = form ? {
    motor,
    ...(motor === 'wrk'
      ? { baglantilar: baglantilar ?? [], is_parcacigi: tamSayi(form.is_parcacigi) }
      : { hizlar: hizlar ?? [], maxvu: tamSayi(maxvuMetni) }),
    tekrar: tamSayi(form.tekrar), isinma: tamSayi(form.isinma), sure: tamSayi(form.sure), bosluk: tamSayi(form.bosluk),
    bosta: tamSayi(form.bosta), kip: form.kip, ae: form.ae,
  } : null;
  const pHata = param && sinir ? parametreHatalari(param, sinir) : {};
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
  }
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
  const onKontrolAcik = gecerli && !sinifEngeli && !girdiReddi;
  const degerlendirme = useMemo(() => onKontrolDegerlendir(okKayit), [okKayit]);
  const kalanMs = onKontrolKalanMs(okKayit, simdi, okAlindi);
  const formDegisti = !!ok && imza !== ok.imza;
  const baslatilir = okBitti && !degerlendirme.engeller.length && !formDegisti && !okEski && (kalanMs == null || kalanMs > 0) && mesgul == null;
  const butce = param && adimDegerleri(param).degerler.length ? butceSn(param) : null;

  const degistir = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => (f ? { ...f, [k]: v } : f));
  function hedefSec(host: string) {
    const h = veri?.hedefler.find((x) => x.host === host) ?? null;
    setForm((f) => {
      if (!f) return f;
      // "Elle yazacağım": yazilan IP kalir, hedefHost bosalir (govdede null; siniflandirma hedefHost'suz).
      if (!h) return { ...f, hedefHost: '' };
      return { ...f, hedefHost: h.host, hedefIp: h.ipler.includes(f.hedefIp) ? f.hedefIp : h.ipler.length === 1 ? h.ipler[0] : '' };
    });
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
  const motorlar = veri.motorlar.length ? veri.motorlar : (['k6'] as NlMotor[]);
  const serbest = hedefTuru === 'serbest';
  const sayiAlani = (k: 'tekrar' | 'isinma' | 'sure' | 'bosluk' | 'bosta' | 'is_parcacigi', etiket: string, min: number, max: number, yardim: string, hata = pHata[k] ? `Aralık: ${pHata[k]}` : null) => (
    <Alan id={`yuk-${k}`} etiket={etiket} hata={hata} yardim={yardim}>
      <input id={`yuk-${k}`} type="number" inputMode="numeric" min={min} max={max} value={form[k]} onChange={(e) => degistir(k, e.target.value)} className={`${GIRDI} tabular-nums`} style={girdiStili(!!pHata[k])} aria-invalid={!!pHata[k]} />
    </Alan>
  );
  const adim = adimDegerleri(param);
  const adimSayisi = adim.degerler.length && Number.isInteger(param.tekrar) ? adim.degerler.length * param.tekrar : null;
  const butceOran = butce != null ? Math.min(1, butce / sinir.maxButceSn) : 0;
  const butceTon = butce != null && butce > sinir.maxButceSn ? 'hata' : butceOran > 0.85 ? 'uyari' : 'aksan';
  const dk = Math.floor(sinir.maxButceSn / 60);
  // wrk tavan satiri: en kucuk baglanti icin bekleme; olculmus sifir sinirda satir yok (alan hatasi soyler).
  const enKucukBaglanti = baglantilar?.length ? Math.min(...baglantilar) : null;
  const bekleme = enKucukBaglanti != null ? baglantiBeklemesiMs(enKucukBaglanti, tavan) : null;
  const sifirSinir = sinir.maxHiz < 1 || sinir.maxBaglanti < 1;
  // On kontrol bu formu artik kapsamiyor (form degisti / sunucu eski dedi / 15 dk doldu).
  const okGecersiz = formDegisti || !!okEski || (kalanMs != null && kalanMs <= 0);
  const neden = sinifReddi ? sinifEngeli
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
      <div className="grid items-start gap-4 @4xl/yuk:grid-cols-[minmax(0,1fr)_19rem]">
        <div className="min-w-0 space-y-4">
          <Bolum baslik="1 · Senaryo" aciklama="Yük testinin gönderdiği yollar ve ağırlıkları. Senaryo HAR’dan ya da yol listesinden “Senaryolar” bölümünde oluşturulur.">
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
              <Alan id="yuk-hedef" etiket="Hedef sunucu (isteğe bağlı)" hata={form.hedefHost ? fHata.hedef : null} yardim="IP birden çok sunucuda tanımlıysa (paylaşılan VIP) buradan seçin; IP o sunucunun adaylarından olur.">
                <select id="yuk-hedef" value={form.hedefHost} onChange={(e) => hedefSec(e.target.value)} className={`${GIRDI} ${form.hedefHost ? 'font-mono' : ''}`} style={girdiStili(!!form.hedefHost && !!fHata.hedef)}>
                  <option value="">— IP’yi elle yazacağım —</option>
                  {hedefler.map((h) => <option key={h.host} value={h.host} disabled={!h.uygun}>{`${h.host} · ${h.env || '?'}${h.uygun ? '' : ` — ${nedenMetni(h.neden) || 'uygun değil'}`}`}</option>)}
                </select>
              </Alan>
              <div className="@lg/yuk:col-span-2">
                <SinifKutusu anahtar={sinifAnahtari} suruyor={sinifSuruyor} sonuc={sinifSonucu} onYenidenDene={() => setSinifDeneme((d) => d + 1)} />
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
              <label className={`flex items-start gap-2 text-[12px] @lg/yuk:col-span-2 ${sniEtkin ? 'cursor-pointer' : 'cursor-not-allowed'}`} style={{ color: sniEtkin ? 'var(--text-primary)' : 'var(--text-secondary)' }}>
                <input type="checkbox" className="mt-0.5 accent-[var(--accent)]" checked={sniEtkin && form.sni} disabled={!sniEtkin} onChange={(e) => degistir('sni', e.target.checked)} />
                {sniEtkin
                  ? <span>SNI ile bağlan <span style={{ color: 'var(--text-secondary)' }}>— TLS el sıkışmasında vhost adı gönderilir (sunucu sertifikayı ada göre seçiyorsa). Bağlantı yine seçilen IP’ye gider.</span></span>
                  : <span>SNI ile bağlan <span style={{ color: 'var(--text-secondary)' }}>— wrk SNI’yi Host başlığına göre seçemez (IP adresi SNI olarak gider).</span></span>}
              </label>
            </div>
          </Bolum>

          <Bolum baslik="3 · Parametreler"
            aciklama={motor === 'wrk'
              ? `Kapalı döngü: her adımda sabit bağlantı sayısı; her bağlantı yanıtı alınca, bağlantı başına sabit beklemeden sonra yeni istek gönderir (ortalama toplam ≤ ${tavan} istek/sn). Sınırlar: bağlantı ≤ ${sinir.maxBaglanti}, iş parçacığı ≤ ${sinir.maxIsParcacigi}, toplam ≤ ${dk} dk.`
              : `Açık döngü: her hızda sabit varış hızı, her iterasyon tek GET. Sınırlar: hız ≤ ${sinir.maxHiz}/sn, VU ≤ ${sinir.maxVu}, toplam ≤ ${dk} dk.`}
            eylem={<button type="button" onClick={() => setForm((f) => (f ? { ...formBaslangic(veri.varsayilan, f.yukHost), senaryoId: f.senaryoId, hedefHost: f.hedefHost, hedefIp: f.hedefIp, vhost: f.vhost, sni: f.sni, motor: f.motor, etiket: f.etiket } : f))} className={LINK} style={{ color: 'var(--accent)' }}>Varsayılanlara dön</button>}>
            <div className="grid gap-3 @lg/yuk:grid-cols-2 @3xl/yuk:grid-cols-3">
              {/* Yuk araci kipi: iki secenek de gorunur (dar kolonda secim kutusu aciklamayi kesiyordu). Yerel radyo:
                  ok tuslari secer; odak etiketin cevresinde gorunur. */}
              <fieldset className="min-w-0 @lg/yuk:col-span-2 @3xl/yuk:col-span-3">
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
              {motor === 'wrk' ? (
                <>
                  <Alan id="yuk-baglantilar" etiket="Bağlantılar" className="@3xl/yuk:col-span-2" hata={pHata.baglantilar || null} yardim={`Boşlukla ayırın; en çok 5 kademe, her biri 1–${sinir.maxBaglanti}. Her bağlantı yanıtı alınca, beklemeden sonra yeni istek gönderir.`}>
                    <input id="yuk-baglantilar" value={form.baglantilar} onChange={(e) => degistir('baglantilar', e.target.value)} autoComplete="off" spellCheck={false} className={`${GIRDI} font-mono tabular-nums`} style={girdiStili(!!pHata.baglantilar)} aria-invalid={!!pHata.baglantilar} />
                  </Alan>
                  {sayiAlani('is_parcacigi', 'İş parçacığı', 1, sinir.maxIsParcacigi, '1–16; en küçük bağlantı sayısını aşamaz ve her bağlantı sayısını tam bölmeli (ör. 2 → 2 4 8).', pHata.is_parcacigi || null)}
                  <div className="space-y-2 @lg/yuk:col-span-2 @3xl/yuk:col-span-3">
                    {!sifirSinir && (
                      <p className="rounded-lg px-3 py-2 text-[12px] leading-5 tabular-nums" style={{ background: 'var(--bg-elevated)', color: 'var(--text-primary)' }} aria-live="polite">
                        {`Ortalama toplam hız tavanı: ${tavan} istek/sn (bağlantı başına bekleme ≈ ${bekleme ?? '—'} ms; ${tavanNedeni(veri.sinirlar, hedefTuru === 'sunucu' ? sunucuHedef : null, hedefTuru)})`}
                      </p>
                    )}
                    {/* WR2: tavan ORTALAMA hizi sinirlar; anlik hiz kumelenir (Portal limit_req burst'unu okumaz). */}
                    <UyariKutusu ton="uyari" baslik={`wrk kapalı döngüdür; Portal toplam hızı ORTALAMADA ${tavan} istek/sn ile sınırlar. İlk 429 ya da 5xx yanıtta koşu durur (DUR).`}>
                      Bağlantılar birlikte başlar, ilk istekler rastgele yayılır ama istekler kümelenebilir: limit_req burst’ü bağlantı sayısından küçük ya da burst’süz yollarda 429 alınır ve koşu durur. Böyle yollarda k6 kullanın ya da küçük bağlantı sayılarıyla başlayın.
                    </UyariKutusu>
                  </div>
                </>
              ) : (
                <Alan id="yuk-hizlar" etiket="Hızlar (istek/sn)" className="@lg/yuk:col-span-2 @3xl/yuk:col-span-3" hata={pHata.hizlar || null} yardim="Boşlukla ayırın; en çok 5 kademe. Her kademe ısınma + ölçüm süresi kadar koşar.">
                  <input id="yuk-hizlar" value={hizlarMetni} onChange={(e) => degistir('hizlar', e.target.value)} autoComplete="off" spellCheck={false} className={`${GIRDI} font-mono tabular-nums`} style={girdiStili(!!pHata.hizlar)} aria-invalid={!!pHata.hizlar} />
                </Alan>
              )}
              {sayiAlani('tekrar', 'Tekrar', 1, sinir.maxTekrar, `Her ${motor === 'wrk' ? 'bağlantı kademesi' : 'hız'} kaç kez koşulsun (gürültü ölçümü için ≥ 2).`)}
              {sayiAlani('isinma', 'Isınma (sn)', 5, sinir.isinmaMax, 'Ölçüme girmeyen ön yük.')}
              {sayiAlani('sure', 'Ölçüm süresi (sn)', sinir.sureMin, sinir.sureMax, 'Her adımın ölçülen bölümü.')}
              {sayiAlani('bosluk', 'Adımlar arası bekleme (sn)', 0, 120, serbest ? 'Serbest hedefte bu aralıkta CPU ölçülmez.' : 'Arka plan CPU’su bu aralıklarda ölçülür.')}
              {sayiAlani('bosta', 'Başta boşta ölçüm (sn)', 30, 120, serbest ? 'Serbest hedefte CPU kaydedici yok; bu süre beklenmez, yalnız süre bütçesine eklenir.' : 'Yük başlamadan önceki arka plan ölçümü.')}
              {motor === 'k6' && (
                <Alan id="yuk-maxvu" etiket="En çok VU" hata={pHata.maxvu ? `Aralık: ${pHata.maxvu}` : null} yardim="Hız tutturulamazsa adım “doyma” olur.">
                  <input id="yuk-maxvu" type="number" inputMode="numeric" min={10} max={sinir.maxVu} value={maxvuMetni} onChange={(e) => degistir('maxvu', e.target.value)} className={`${GIRDI} tabular-nums`} style={girdiStili(!!pHata.maxvu)} aria-invalid={!!pHata.maxvu} />
                </Alan>
              )}
              <Alan id="yuk-kip" etiket={motor === 'wrk' ? 'Bağlantı kipi' : 'Bağlantı'}>
                <select id="yuk-kip" value={form.kip} onChange={(e) => degistir('kip', e.target.value as NlKip)} className={GIRDI} style={girdiStili()}>
                  {(['yeni', 'ka'] as const).map((k) => <option key={k} value={k}>{KIP_ETIKETI[k]}</option>)}
                </select>
              </Alan>
              <Alan id="yuk-ae" etiket="Accept-Encoding">
                <select id="yuk-ae" value={form.ae} onChange={(e) => degistir('ae', e.target.value as NlAe)} className={GIRDI} style={girdiStili()}>
                  {(['br', 'gzip', 'identity'] as const).map((k) => <option key={k} value={k}>{AE_ETIKETI[k]}</option>)}
                </select>
              </Alan>
              <Alan id="yuk-etiket" etiket="Etiket (isteğe bağlı)" className="@lg/yuk:col-span-2 @3xl/yuk:col-span-3" hata={fHata.etiket || null} yardim="Karşılaştırmada bu koşuyu tanımak için kısa not; ör. “T0 — F5 öncesi” ya da “gzip_static açık”.">
                <input id="yuk-etiket" value={form.etiket} maxLength={120} onChange={(e) => degistir('etiket', e.target.value)} autoComplete="off" className={GIRDI} style={girdiStili(!!fHata.etiket)} />
              </Alan>
            </div>
          </Bolum>
        </div>

        <aside className="min-w-0 space-y-3 @4xl/yuk:sticky @4xl/yuk:top-4">
          <Bolum baslik="Plan" govdeSinifi="p-4 space-y-3">
            <div className="text-[12px] leading-5" style={{ color: 'var(--text-primary)' }}>
              <div className="flex items-baseline justify-between gap-2"><span style={{ color: 'var(--text-secondary)' }}>Adım</span><b className="tabular-nums">{adimSayisi != null ? `${fmtNumber(adimSayisi)} (${adim.degerler.length} ${motor === 'wrk' ? 'bağlantı kademesi' : 'hız'} × ${param.tekrar})` : '—'}</b></div>
              <div className="flex items-baseline justify-between gap-2"><span style={{ color: 'var(--text-secondary)' }}>Tahmini süre</span><b className="tabular-nums">{butce != null && Number.isFinite(butce) ? `≈ ${sureMetni(butce)}` : '—'}</b></div>
              <div className="mt-1.5 h-1.5 rounded-full" style={{ background: 'var(--bg-elevated)' }} role="meter" aria-label="Süre bütçesi" aria-valuemin={0} aria-valuemax={sinir.maxButceSn} aria-valuenow={butce != null && Number.isFinite(butce) ? butce : 0}>
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
              {okBitti && kalanMs != null && kalanMs > 0 && !formDegisti && !okEski && (
                <p className="text-[11px] leading-4 tabular-nums" style={{ color: kalanMs < 120000 ? 'var(--status-warning-text)' : 'var(--text-secondary)' }}>Ön kontrol {sureMetni(kalanMs / 1000)} daha geçerli.</p>
              )}
            </div>
          </Bolum>
          {islemHata && <UyariKutusu ton="hata" rol="alert" baslik="Ön kontrol başlatılamadı">{islemHata}</UyariKutusu>}
        </aside>
      </div>

      {ok && (
        <Bolum baslik={<span className="flex flex-wrap items-center gap-2">Ön kontrol #{ok.kosuId}{okKayit && <KosuDurumHapi durum={okKayit.durum} />}</span>}
          aciklama={formDegisti ? 'Form bu ön kontrolden sonra değişti: sonuç yeni değerleri kapsamıyor.' : 'Yük üretilmez. Sonuç geldiğinde engeller ve onay isteyen uyarılar burada listelenir.'}
          govdeSinifi="p-4 space-y-4">
          {okKayit && !AKTIF_DURUMLAR.has(okKayit.durum) && <OnKontrolPaneli kosu={okKayit} />}
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
function SinifKutusu({ anahtar, suruyor, sonuc, onYenidenDene }: { anahtar: string; suruyor: boolean; sonuc: SinifSonucu | null; onYenidenDene: () => void }) {
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
      <span className="min-w-0">{`Sunucu hedefi: ${v.host} (${v.env || '?'}) — CPU kaydedici ve nginx logu ölçülür; IP’nin sunucuda yerel olduğu ön kontrolde ve koşu başında doğrulanır.`}</span>
    </div>
  );
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
