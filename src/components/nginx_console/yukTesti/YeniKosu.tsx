// src/components/nginx_console/yukTesti/YeniKosu.tsx — "Yeni koşu" sihirbazi (yalniz Admin, 2026-10-27).
//
// Akis: senaryo -> hedef (uygunsuz olan nedeniyle kapali) -> IP (hedefin adaylari) -> vhost -> yuk sunucusu ->
// parametreler (varsayilan ve sinirlar /hedefler'den) -> "Ön kontrolü başlat" (yuk URETMEZ) -> sonuc paneli
// (engel / onay isteyen uyari) -> "Koşuyu başlat…" onay penceresi -> koşu ayrintisina gecis.
// Kosu, on kontrolun PARAMETRELERIYLE baslar (sunucu yalniz onKontrolKosuId alir); form on kontrolden sonra
// degistirilirse "Başlat" kapanir ve on kontrol yeniden istenir (imza karsilastirmasi). 15 dk sonra da ayni.
// Sunucu her kurali yeniden uygular; buradaki denetim yalniz nedeni dugmeye basmadan soylemek icin.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowPathIcon, BoltIcon, ClipboardDocumentCheckIcon } from '@heroicons/react/24/outline';
import {
  nginxLoadtestApi, type NlAe, type NlHedefler, type NlKip, type NlKosuAyrinti, type NlParametreler, type NlSenaryo,
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
  AE_ETIKETI, AKTIF_DURUMLAR, KIP_ETIKETI, VHOST_YOK_METNI, butceSn, hataMetni, hedefSinirlari, hizlariAyristir, nedenMetni, onKontrolDegerlendir,
  onKontrolKalanMs, parametreHatalari, vhostGecerli,
} from './yukTestiOrtak';

interface Form {
  senaryoId: string; hedefHost: string; hedefIp: string; vhost: string; yukHost: string; sni: boolean;
  hizlar: string; tekrar: string; isinma: string; sure: string; bosluk: string; bosta: string; maxvu: string; kip: NlKip; ae: NlAe; etiket: string;
}
const formBaslangic = (v: NlParametreler, yukHost = ''): Form => ({
  senaryoId: '', hedefHost: '', hedefIp: '', vhost: '', yukHost, sni: false,
  hizlar: v.hizlar.join(' '), tekrar: String(v.tekrar), isinma: String(v.isinma), sure: String(v.sure), bosluk: String(v.bosluk),
  bosta: String(v.bosta), maxvu: String(v.maxvu), kip: v.kip, ae: v.ae, etiket: '',
});
const tamSayi = (s: string) => (/^\s*\d+\s*$/.test(s) ? Number(s) : NaN);

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
  const [mesgul, setMesgul] = useState<'onkontrol' | 'baslat' | null>(null);
  const [onayAcik, setOnayAcik] = useState(false);
  const [onayHata, setOnayHata] = useState<string | null>(null);
  const [sunucuUyarilari, setSunucuUyarilari] = useState<string[] | null>(null);
  const [simdi, setSimdi] = useState(() => Date.now());
  const busyRef = useRef(false);

  const yukle = useCallback(async () => {
    try {
      const [h, s] = await Promise.all([nginxLoadtestApi.hedefler(), nginxLoadtestApi.senaryolar()]);
      setVeri(h);
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

  const hedef = veri && form ? veri.hedefler.find((h) => h.host === form.hedefHost) ?? null : null;
  // vhost alani: dokum varsa secim; dokum HIC yoksa (vhostVerisi === false) serbest metin; tarandi ama adlandirilmis
  // ad yoksa kapali (sunucu kurali: tarama verisi varken listede olmayan vhost reddedilir). Alan gelmezse kapali (fail-closed).
  const vhostSerbest = !!hedef && !hedef.vhostlar.length && hedef.vhostVerisi === false;
  const vhostYok = !!hedef && hedef.uygun && !hedef.vhostlar.length && hedef.vhostVerisi !== false;
  // Secilen hedefin limit_req / limit_conn'u sinirlari daraltir (sunucu ayni hesabi yapar).
  const sinir = veri ? hedefSinirlari(veri.sinirlar, hedef) : undefined;
  const senaryo = senaryolar && form ? senaryolar.find((s) => String(s.id) === form.senaryoId) ?? null : null;
  const hizlar = form ? hizlariAyristir(form.hizlar) : null;
  const param: NlParametreler | null = form ? {
    hizlar: hizlar ?? [], tekrar: tamSayi(form.tekrar), isinma: tamSayi(form.isinma), sure: tamSayi(form.sure), bosluk: tamSayi(form.bosluk),
    bosta: tamSayi(form.bosta), maxvu: tamSayi(form.maxvu), kip: form.kip, ae: form.ae,
  } : null;
  const pHata = param && sinir ? parametreHatalari(param, sinir) : {};
  if (form && hizlar == null) pHata.hizlar = 'Yalnız sayı yazın, boşlukla ayırın (ör. 100 250 400).';
  const fHata: Record<string, string> = {};
  if (form && veri) {
    if (!senaryo) fHata.senaryo = 'Senaryo seçin.';
    if (!hedef) fHata.hedef = 'Hedef sunucu seçin.';
    else if (!hedef.uygun) fHata.hedef = nedenMetni(hedef.neden) || 'Bu sunucu hedef olamaz.';
    if (hedef && !hedef.ipler.includes(form.hedefIp)) fHata.ip = hedef.ipler.length ? 'IP seçin.' : 'Bu hedef için bilinen IP yok.';
    if (vhostYok) fHata.vhost = VHOST_YOK_METNI;
    else if (!form.vhost) fHata.vhost = 'vhost seçin.';
    else if (!vhostGecerli(form.vhost)) fHata.vhost = 'Küçük harf ad yazın (port, joker yok).';
    else if (hedef && hedef.vhostlar.length && !hedef.vhostlar.includes(form.vhost)) fHata.vhost = 'Bu vhost hedefin server_name listesinde yok.';
    const yuk = veri.yukHostlari.find((y) => y.host === form.yukHost);
    if (!yuk) fHata.yuk = 'Yük sunucusu seçin.';
    else if (!yuk.uygun) fHata.yuk = nedenMetni(yuk.neden) || 'Bu sunucu yük üretemez.';
    else if (yuk.host === form.hedefHost) fHata.yuk = nedenMetni('ayni_host');
    if (form.etiket.length > 120) fHata.etiket = 'En çok 120 karakter.';
  }
  const gecerli = !!form && !!param && !Object.keys(pHata).length && !Object.keys(fHata).length;
  const govde = gecerli && form && param && senaryo ? {
    senaryoId: senaryo.id, hedefHost: form.hedefHost, hedefIp: form.hedefIp, vhost: form.vhost, yukHost: form.yukHost, sni: form.sni,
    parametreler: param, ...(form.etiket.trim() ? { etiket: form.etiket.trim() } : {}),
  } : null;
  const imza = govde ? JSON.stringify(govde) : '';
  const degerlendirme = useMemo(() => onKontrolDegerlendir(okKayit), [okKayit]);
  const kalanMs = onKontrolKalanMs(okKayit, simdi, okAlindi);
  const formDegisti = !!ok && imza !== ok.imza;
  const baslatilir = okBitti && !degerlendirme.engeller.length && !formDegisti && !okEski && (kalanMs == null || kalanMs > 0) && mesgul == null;
  const butce = param && param.hizlar.length ? butceSn(param) : null;

  const degistir = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => (f ? { ...f, [k]: v } : f));
  function hedefSec(host: string) {
    const h = veri?.hedefler.find((x) => x.host === host);
    setForm((f) => {
      if (!f) return f;
      const vh = senaryo?.vhost && h?.vhostlar.includes(senaryo.vhost) ? senaryo.vhost : h?.vhostlar.length === 1 ? h.vhostlar[0] : '';
      return { ...f, hedefHost: host, hedefIp: h?.ipler.length === 1 ? h.ipler[0] : '', vhost: vh };
    });
  }
  function senaryoSec(id: string) {
    const s = senaryolar?.find((x) => String(x.id) === id);
    setForm((f) => (f ? { ...f, senaryoId: id, vhost: !f.vhost && s?.vhost && (!hedef || hedef.vhostlar.includes(s.vhost)) ? s.vhost : f.vhost } : f));
  }

  async function onKontrolBaslat() {
    if (busyRef.current || !govde) return;
    busyRef.current = true;
    setMesgul('onkontrol');
    setIslemHata('');
    try {
      const r = await nginxLoadtestApi.onKontrol(govde);
      if (!r.ok || r.kosuId == null) { setIslemHata(hataMetni(r, 'Ön kontrol başlatılamadı.')); return; }
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
  if (!veri || !form || !senaryolar || !sinir) return <div className="skeleton h-72 rounded-xl" aria-busy="true"><span className="sr-only">Yükleniyor…</span></div>;

  const hedefler = [...veri.hedefler].sort((a, b) => Number(b.uygun) - Number(a.uygun) || a.host.localeCompare(b.host));
  const sayiAlani = (k: 'tekrar' | 'isinma' | 'sure' | 'bosluk' | 'bosta' | 'maxvu', etiket: string, min: number, max: number, yardim: string) => (
    <Alan id={`yuk-${k}`} etiket={etiket} hata={pHata[k] ? `Aralık: ${pHata[k]}` : null} yardim={yardim}>
      <input id={`yuk-${k}`} type="number" inputMode="numeric" min={min} max={max} value={form[k]} onChange={(e) => degistir(k, e.target.value)} className={`${GIRDI} tabular-nums`} style={girdiStili(!!pHata[k])} aria-invalid={!!pHata[k]} />
    </Alan>
  );
  const adimSayisi = param && param.hizlar.length && Number.isInteger(param.tekrar) ? param.hizlar.length * param.tekrar : null;
  const butceOran = butce != null ? Math.min(1, butce / sinir.maxButceSn) : 0;
  const butceTon = butce != null && butce > sinir.maxButceSn ? 'hata' : butceOran > 0.85 ? 'uyari' : 'aksan';
  // On kontrol bu formu artik kapsamiyor (form degisti / sunucu eski dedi / 15 dk doldu).
  const okGecersiz = formDegisti || !!okEski || (kalanMs != null && kalanMs <= 0);
  const neden = !gecerli ? 'Önce formdaki eksikleri giderin.'
    : !ok ? null
    : okSuruyor ? 'Ön kontrol sürüyor.'
      : okKayit && okKayit.durum !== 'DONE' ? 'Ön kontrol başarısız — düzeltip yeniden çalıştırın.'
        : degerlendirme.engeller.length ? 'Ön kontrolde engel var.'
          : formDegisti ? 'Form ön kontrolden sonra değişti — ön kontrolü yeniden çalıştırın.'
            : okEski ? okEski
              : kalanMs != null && kalanMs <= 0 ? 'Ön kontrol 15 dakikadan eski — yeniden çalıştırın.' : null;

  return (
    <div className="space-y-4">
      <div className="grid items-start gap-4 @4xl/yuk:grid-cols-[minmax(0,1fr)_19rem]">
        <div className="min-w-0 space-y-4">
          <Bolum baslik="1 · Senaryo" aciklama="Yük testinin gönderdiği yollar ve ağırlıkları. Senaryo HAR’dan ya da yol listesinden “Senaryolar” bölümünde oluşturulur.">
            {senaryolar.length === 0 ? (
              <UyariKutusu ton="bilgi" baslik="Henüz senaryo yok." eylem={<button type="button" onClick={onSenaryolar} className={TBL_BTN} style={smBtn(true)}>Senaryo oluştur</button>}>Önce bir HAR dosyasından ya da yol listesinden senaryo oluşturun.</UyariKutusu>
            ) : (
              <Alan id="yuk-senaryo" etiket="Senaryo" hata={null} yardim={senaryo ? `${senaryo.senaryoTur === 'K' ? 'K — karışık yük' : 'B — büyük dosyalar'} · ${fmtNumber(senaryo.yolSayisi)} yol${senaryo.vhost ? ` · ${senaryo.vhost} için` : ''} · sha256 ${senaryo.sha256.slice(0, 12)}…` : 'Senaryo seçin.'}>
                <select id="yuk-senaryo" value={form.senaryoId} onChange={(e) => senaryoSec(e.target.value)} className={GIRDI} style={girdiStili()}>
                  <option value="">— seçin —</option>
                  {senaryolar.map((s) => <option key={s.id} value={String(s.id)}>{`${s.ad} · ${s.senaryoTur} · ${s.yolSayisi} yol${s.vhost ? ` · ${s.vhost}` : ''}`}</option>)}
                </select>
              </Alan>
            )}
          </Bolum>

          <Bolum baslik="2 · Hedef ve yük sunucusu" aciklama="Yalnız DEV / TEST / QA nginx sunucuları hedef olabilir; üretim sinyali olan sunucu kapalı görünür. Yük, izin listesindeki sunucudan üretilir.">
            <div className="grid gap-3 @lg/yuk:grid-cols-2">
              <Alan id="yuk-hedef" etiket="Hedef sunucu" hata={form.hedefHost ? fHata.hedef : null}>
                <select id="yuk-hedef" value={form.hedefHost} onChange={(e) => hedefSec(e.target.value)} className={`${GIRDI} font-mono`} style={girdiStili(!!form.hedefHost && !!fHata.hedef)}>
                  <option value="">— seçin —</option>
                  {hedefler.map((h) => <option key={h.host} value={h.host} disabled={!h.uygun}>{`${h.host} · ${h.env || '?'}${h.uygun ? '' : ` — ${nedenMetni(h.neden) || 'uygun değil'}`}`}</option>)}
                </select>
              </Alan>
              <Alan id="yuk-ip" etiket="Hedef IP" hata={form.hedefHost && hedef?.uygun ? (form.hedefIp || !hedef.ipler.length ? fHata.ip : null) : null} yardim="Yük bu IP’ye gider; IP’nin hedefte yerel olduğu ön kontrolde doğrulanır.">
                <select id="yuk-ip" value={form.hedefIp} onChange={(e) => degistir('hedefIp', e.target.value)} disabled={!hedef?.uygun} className={`${GIRDI} font-mono`} style={girdiStili()}>
                  <option value="">— seçin —</option>
                  {(hedef?.ipler || []).map((ip) => <option key={ip} value={ip}>{ip}</option>)}
                </select>
              </Alan>
              <Alan id="yuk-vhost" etiket="Vhost (Host başlığı)" hata={vhostYok ? VHOST_YOK_METNI : form.vhost ? fHata.vhost : null} yardim={vhostSerbest ? 'Bu hedef için server_name dökümü yok; adı elle yazın.' : 'İstekler bu Host başlığıyla gider.'}>
                {hedef && hedef.vhostlar.length ? (
                  <select id="yuk-vhost" value={form.vhost} onChange={(e) => degistir('vhost', e.target.value)} disabled={!hedef.uygun} className={GIRDI} style={girdiStili(!!form.vhost && !!fHata.vhost)}>
                    <option value="">— seçin —</option>
                    {hedef.vhostlar.map((v) => <option key={v} value={v}>{v}</option>)}
                  </select>
                ) : (
                  <input id="yuk-vhost" value={vhostYok ? '' : form.vhost} onChange={(e) => degistir('vhost', e.target.value.trim().toLowerCase())} disabled={!hedef?.uygun || !vhostSerbest} placeholder={vhostYok ? '' : 'ornek-test.fw.garantibbva.com.tr'} autoComplete="off" spellCheck={false} aria-invalid={vhostYok || undefined} className={GIRDI} style={girdiStili(vhostYok || (!!form.vhost && !!fHata.vhost))} />
                )}
              </Alan>
              <Alan id="yuk-yuk" etiket="Yük sunucusu" hata={form.yukHost ? fHata.yuk : null} yardim="k6 bu sunucuda çalışır.">
                <select id="yuk-yuk" value={form.yukHost} onChange={(e) => degistir('yukHost', e.target.value)} className={`${GIRDI} font-mono`} style={girdiStili(!!form.yukHost && !!fHata.yuk)}>
                  <option value="">— seçin —</option>
                  {veri.yukHostlari.map((y) => <option key={y.host} value={y.host} disabled={!y.uygun || y.host === form.hedefHost}>{`${y.host} · ${y.env || '?'}${!y.uygun ? ` — ${nedenMetni(y.neden) || 'uygun değil'}` : y.host === form.hedefHost ? ' — hedefle aynı' : ''}`}</option>)}
                </select>
              </Alan>
              {senaryo?.vhost && form.vhost && senaryo.vhost !== form.vhost && (
                <div className="@lg/yuk:col-span-2"><UyariKutusu ton="uyari" baslik={`Senaryo ${senaryo.vhost} için hazırlanmış; seçilen vhost ${form.vhost}. Yollar bu vhost’ta 200 dönmeyebilir.`} /></div>
              )}
              <label className="flex cursor-pointer items-start gap-2 text-[12px] @lg/yuk:col-span-2" style={{ color: 'var(--text-primary)' }}>
                <input type="checkbox" className="mt-0.5 accent-[var(--accent)]" checked={form.sni} onChange={(e) => degistir('sni', e.target.checked)} />
                <span>SNI ile bağlan <span style={{ color: 'var(--text-secondary)' }}>— TLS el sıkışmasında vhost adı gönderilir (sunucu sertifikayı ada göre seçiyorsa). Bağlantı yine seçilen IP’ye gider.</span></span>
              </label>
            </div>
          </Bolum>

          <Bolum baslik="3 · Parametreler" aciklama={`Açık döngü: her hızda sabit varış hızı, her iterasyon tek GET. Sınırlar: hız ≤ ${sinir.maxHiz}/sn, VU ≤ ${sinir.maxVu}, toplam ≤ ${Math.floor(sinir.maxButceSn / 60)} dk.`}
            eylem={<button type="button" onClick={() => setForm((f) => (f ? { ...formBaslangic(veri.varsayilan, f.yukHost), senaryoId: f.senaryoId, hedefHost: f.hedefHost, hedefIp: f.hedefIp, vhost: f.vhost, sni: f.sni, etiket: f.etiket } : f))} className={LINK} style={{ color: 'var(--accent)' }}>Varsayılanlara dön</button>}>
            <div className="grid gap-3 @lg/yuk:grid-cols-2 @3xl/yuk:grid-cols-3">
              <Alan id="yuk-hizlar" etiket="Hızlar (istek/sn)" className="@lg/yuk:col-span-2 @3xl/yuk:col-span-3" hata={pHata.hizlar || null} yardim="Boşlukla ayırın; en çok 5 kademe. Her kademe ısınma + ölçüm süresi kadar koşar.">
                <input id="yuk-hizlar" value={form.hizlar} onChange={(e) => degistir('hizlar', e.target.value)} autoComplete="off" spellCheck={false} className={`${GIRDI} font-mono tabular-nums`} style={girdiStili(!!pHata.hizlar)} aria-invalid={!!pHata.hizlar} />
              </Alan>
              {sayiAlani('tekrar', 'Tekrar', 1, sinir.maxTekrar, 'Her hız kaç kez koşulsun (gürültü ölçümü için ≥ 2).')}
              {sayiAlani('isinma', 'Isınma (sn)', 5, sinir.isinmaMax, 'Ölçüme girmeyen ön yük.')}
              {sayiAlani('sure', 'Ölçüm süresi (sn)', sinir.sureMin, sinir.sureMax, 'Her adımın ölçülen bölümü.')}
              {sayiAlani('bosluk', 'Adımlar arası bekleme (sn)', 0, 120, 'Arka plan CPU’su bu aralıklarda ölçülür.')}
              {sayiAlani('bosta', 'Başta boşta ölçüm (sn)', 30, 120, 'Yük başlamadan önceki arka plan ölçümü.')}
              {sayiAlani('maxvu', 'En çok VU', 10, sinir.maxVu, 'Hız tutturulamazsa adım “doyma” olur.')}
              <Alan id="yuk-kip" etiket="Bağlantı">
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
              <div className="flex items-baseline justify-between gap-2"><span style={{ color: 'var(--text-secondary)' }}>Adım</span><b className="tabular-nums">{adimSayisi != null ? `${fmtNumber(adimSayisi)} (${param?.hizlar.length} hız × ${param?.tekrar})` : '—'}</b></div>
              <div className="flex items-baseline justify-between gap-2"><span style={{ color: 'var(--text-secondary)' }}>Tahmini süre</span><b className="tabular-nums">{butce != null && Number.isFinite(butce) ? `≈ ${sureMetni(butce)}` : '—'}</b></div>
              <div className="mt-1.5 h-1.5 rounded-full" style={{ background: 'var(--bg-elevated)' }} role="meter" aria-label="Süre bütçesi" aria-valuemin={0} aria-valuemax={sinir.maxButceSn} aria-valuenow={butce != null && Number.isFinite(butce) ? butce : 0}>
                <div className="h-full rounded-full" style={{ width: `${Math.round((Number.isFinite(butceOran) ? butceOran : 0) * 100)}%`, background: TON[butceTon].renk }} />
              </div>
              <p className="mt-1 text-[11px]" style={{ color: pHata.butce ? 'var(--status-danger-text)' : 'var(--text-muted)' }}>{pHata.butce || `Üst sınır ${Math.floor(sinir.maxButceSn / 60)} dk; iş bu süreyi aşarsa kendini durdurur.`}</p>
            </div>
            <ol className="space-y-1.5 text-[12px]" aria-label="Adımlar">
              <Basamak no={1} ad="Ön kontrol" durum={!ok ? 'bekliyor' : okSuruyor ? 'suruyor' : !okBitti || degerlendirme.engeller.length ? 'hata' : okGecersiz ? 'eski' : 'tamam'} />
              <Basamak no={2} ad="Onay (sunucu adı)" durum={baslatilir ? 'hazir' : 'bekliyor'} />
              <Basamak no={3} ad="Koşu" durum="bekliyor" />
            </ol>
            <div className="flex flex-col gap-2">
              <button type="button" onClick={() => void onKontrolBaslat()} disabled={!gecerli || mesgul != null || okSuruyor} className={`${SM_BTN} h-8 justify-center`} style={smBtn(!ok || formDegisti || !!okEski || (kalanMs != null && kalanMs <= 0))}
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
