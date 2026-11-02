// src/components/nginx_console/yukTesti/Araclar.tsx — Yük Testi > "Araçlar" alt gorunumu (tur 4, 2026-11-02).
//
// Kullanici: yuk araclari (k6, wrk) yuk sunucularina kalici kurulmaz. Admin "Araçları hazırla" ile bir 'araclar' AWX
// isi baslatir: secilen derleme makinesinde k6 resmi arsivi ve wrk 4.2.0 kaynagi indirilir; ikisi de Portal env'inde
// SABITLENEN sha256 ozetleriyle (NGINX_LOADTEST_K6_ARSIV_SHA256 / NGINX_LOADTEST_WRK_KAYNAK_SHA256) dogrulanmadan hicbir
// sey acilmaz ya da derlenmez; wrk derlenir ve ikisi /sw'de yeni bir dizine yazilir. Portal sha256'lari saklar; her on
// kontrol / kosu secilen aracin kopyasini yuk sunucusunda kosu dizinine alir, YALNIZ Portal'in degeriyle dogrular,
// calistirir, siler.
// Koordinator karari D1/D2 (2026-11-02): ilk-kullanimda-guven ve 12 haneli onay toreni KALKTI. Ozet eksikse kirmizi kutu
// ve hazirlama kapali; etkin set yoksa sunucunun nedeni (kapi.mesaj). Admin bir DONE seti onay penceresiyle GERI CEKER;
// etkin set kurala uyan bir onceki sete duser.
// Ekran: ozet durumu, etkin set karti, RHEL 8 glibc uyarisi, hazirlama (yalniz Admin; vekil sunucu bilgisi Admin'e),
// suren is (sure asildiysa "durum okunamiyor" uyarisi) ve gecmis.
// Admin olmayan kullanici okur; hazirlama ve geri cekme dugmeleri ona HIC cizilmez (sunucu da reddeder).
// Suren is varken liste 10 sn'de bir yeniden okunur; gorunum kapaninca (bilesen sokulunce) durur.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowPathIcon, ArrowUturnLeftIcon, WrenchScrewdriverIcon } from '@heroicons/react/24/outline';
import { nginxLoadtestApi, type NlAraclar, type NlAracSeti } from '@/api/nginxLoadtestApi';
import { useAsyncEffect } from '@/hooks/useAsyncEffect';
import { toast } from '@/hooks/useToast';
import { Modal } from '@/components/common/Modal';
import { TableEmptyRow } from '@/components/common/EmptyState';
import { fmtDateTime } from '@/utils/datetime';
import { BTN_TEHLIKE, LINK, SM_BTN, TBL_BTN, TON, smBtn } from '@/components/server_hub/retirementStil';
import { Cip, TabloIskelet, UyariKutusu, type Kolon } from '@/components/server_hub/RetirementUi';
import { Alan, Bolum, GIRDI, KosuDurumHapi, Tanim, girdiStili } from './YukUi';
import { glibcRhel8Ustu, hataMetni, shaKisa } from './yukTestiOrtak';

/** Suren hazirlama isinde yeniden okuma araligi. */
const YOKLAMA_MS = 10000;
/** Gecmis tablosunda hata hucresi bu kadar karakter (tamami title'da). */
const HATA_KISA = 80;

export const ARAC_ACIKLAMASI = 'Her ön kontrol ve koşu, seçilen aracın /sw’deki kopyasını yük sunucusunda koşu dizinine alır, sha256’sını buradaki değerle doğrular, çalıştırır ve iş sonunda siler. Yük sunucularına kalıcı kurulum yapılmaz.';
export const hazirlamaMetni = (host: string, k6Surum: string, wrkSurum: string) =>
  `${host} üzerinde, kurumsal vekil sunucu üzerinden k6 ${k6Surum} sürüm arşivi ve wrk ${wrkSurum} kaynağı indirilir; ikisi de Portal’da sabitlenen sha256 özetleriyle doğrulanmadan hiçbir şey açılmaz ya da derlenmez. wrk derlenir (paketli OpenSSL ve LuaJIT; birkaç dakika sürer) ve ikisi /sw’de yeni bir dizine yazılır. Süren koşular etkilenmez; yeni set yalnız iş başarıyla bitince etkin olur.`;
export const glibcUyariMetni = (g: string) =>
  `Bu wrk en az glibc ${g} istiyor; RHEL 8 (glibc 2.28) yük sunucularında çalışmaz — ön kontrol bunu “glibc uyumsuz” engeliyle bildirir. Tüm yük sunucularında çalışması için araçları RHEL 8 bir derleme makinesinde hazırlayın (NGINX_LOADTEST_DERLEME_HOSTLARI).`;
export const OZET_EKSIK_METNI = 'Portal ortamına (.env) NGINX_LOADTEST_K6_ARSIV_SHA256 ve NGINX_LOADTEST_WRK_KAYNAK_SHA256 değerlerini 64 haneli sha256 olarak yazıp Portal’ı yeniden başlatın; komutlar docs/NGINX-YUK-TESTI.md › “Arşiv özetlerini sabitleme” bölümünde. Bu değerler olmadan araçlar hazırlanamaz ve hiçbir araç seti kullanılmaz.';
export const SET_YOK_METNI = 'Henüz hazırlanmış bir araç seti yok. Araçlar hazırlanana dek ön kontrol ve koşu başlatılamaz.';
export const geriCekmeMetni = (id: number) =>
  `Araç seti #${id} bir daha kullanılmaz (geri alınamaz; kayıt silinmez, işlem denetime yazılır). Etkin set buysa yeni ön kontroller, sabitlenen özetlerle hazırlanmış bir önceki sete geçer; öyle bir set yoksa araçlar yeniden hazırlanana dek ön kontrol ve koşu başlatılamaz. Süren koşular durdurulmaz; bu setle yapılmış ön kontroller koşuya izin vermez.`;
export const okunamiyorMetni = (jobId: number | null, dk: number) =>
  `AWX iş #${jobId ?? '—'} ${dk} dakikalık süre sınırını aştı ve durumu okunamıyor. Portal okumayı 12 saat daha dener, sonra kaydı “okunamadı” olarak kapatır ve yeni hazırlama açılır. İşi AWX’ten kontrol edin.`;

const GECMIS_KOLONLARI: Kolon[] = [
  { anahtar: 'no', baslik: '#', genislik: '3rem' },
  { anahtar: 'durum', baslik: 'Durum', genislik: '11rem' },
  { anahtar: 'derleme', baslik: 'Derleme', genislik: '9rem' },
  { anahtar: 'k6', baslik: 'k6', genislik: '5rem' },
  { anahtar: 'wrk', baslik: 'wrk', genislik: '4rem' },
  { anahtar: 'kim', baslik: 'Hazırlayan', genislik: '7rem' },
  { anahtar: 'tarih', baslik: 'Tarih', genislik: '8.5rem' },
  { anahtar: 'hata', baslik: 'Hata' },
];

/** sha256 hucresi: ilk 16 hane + "…", tamami title'da (mono). */
function Sha({ sha }: { sha: string | null }) {
  return <span className="font-mono" title={sha || undefined}>{shaKisa(sha)}</span>;
}

/** Geri cekilebilir set: DONE ve henuz geri cekilmemis. */
const geriCekilebilir = (s: NlAracSeti) => s.durum === 'DONE' && !s.geriCekildi;

export default function Araclar({ isAdmin }: { isAdmin: boolean }) {
  const [veri, setVeri] = useState<NlAraclar | null>(null);
  const [hata, setHata] = useState('');
  const [yukleniyor, setYukleniyor] = useState(false);
  // Secilen derleme makinesi ('' = sunucunun varsayilani).
  const [derlemeHost, setDerlemeHost] = useState('');
  const [hazirlaSor, setHazirlaSor] = useState(false);
  const [geriCekilecek, setGeriCekilecek] = useState<NlAracSeti | null>(null);
  const [geriHata, setGeriHata] = useState<string | null>(null);
  const [mesgul, setMesgul] = useState<'hazirla' | 'geri' | null>(null);
  const busyRef = useRef(false);

  const yukle = useCallback(async () => {
    setYukleniyor(true);
    try {
      setVeri(await nginxLoadtestApi.araclar());
      setHata('');
    } catch (e) {
      setHata(e instanceof Error ? e.message : String(e));
    } finally {
      setYukleniyor(false);
    }
  }, []);
  useAsyncEffect(async (alive) => { if (alive()) await yukle(); }, [yukle]);
  const calisiyor = !!veri?.calisan;
  useEffect(() => {
    if (!calisiyor) return;
    const z = window.setInterval(() => { void yukle(); }, YOKLAMA_MS);
    return () => window.clearInterval(z);
  }, [calisiyor, yukle]);

  async function hazirla(host: string) {
    if (busyRef.current) return;
    busyRef.current = true;
    setMesgul('hazirla');
    try {
      const r = await nginxLoadtestApi.araclariHazirla({ derlemeHost: host });
      if (r.ok) toast.success(`Araç hazırlama işi AWX #${r.jobId ?? '?'} başlatıldı.`);
      else toast.error(hataMetni(r, 'Araç hazırlama işi başlatılamadı.'));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      busyRef.current = false;
      setMesgul(null);
      setHazirlaSor(false);
    }
    await yukle();
  }

  async function geriCek() {
    if (busyRef.current || !geriCekilecek) return;
    busyRef.current = true;
    setMesgul('geri');
    setGeriHata(null);
    const id = geriCekilecek.id;
    let tamam = false;
    try {
      const r = await nginxLoadtestApi.aracGeriCek(id);
      if (r.ok) {
        tamam = true;
        const yeni = r.kapi?.aracId;
        toast.success(yeni != null ? `Araç seti #${id} geri çekildi; etkin set artık #${yeni}.` : `Araç seti #${id} geri çekildi; kullanılabilir araç seti yok.`);
        setGeriCekilecek(null);
      } else setGeriHata(hataMetni(r, 'Araç seti geri çekilemedi.'));
    } catch (e) {
      setGeriHata(e instanceof Error ? e.message : String(e));
    } finally {
      busyRef.current = false;
      setMesgul(null);
    }
    if (tamam) await yukle();
  }

  if (!veri) {
    if (hata) {
      return <UyariKutusu ton="hata" rol="alert" baslik="Araç setleri okunamadı" eylem={<button type="button" onClick={() => void yukle()} className={TBL_BTN} style={smBtn()}>Yeniden dene</button>}>{hata}</UyariKutusu>;
    }
    return <div className="skeleton h-72 rounded-xl" aria-busy="true"><span className="sr-only">Yükleniyor…</span></div>;
  }

  const { etkin, calisan, ayar, kapi } = veri;
  const gecmis = [...veri.gecmis].sort((a, b) => b.id - a.id);
  const ozetEksik = ayar.ozetEksikleri.length > 0;
  const glibcUyarilari = etkin && glibcRhel8Ustu(etkin.wrkGlibcGerekli) ? [etkin] : [];
  const secilenHost = derlemeHost && ayar.derlemeHostlari.includes(derlemeHost) ? derlemeHost : ayar.varsayilanDerlemeHost || ayar.derlemeHostlari[0] || '';
  const hazirlaKapali = !!calisan || !!ayar.proxyHatasi || ozetEksik || !secilenHost || mesgul != null;
  const okunamiyor = !!calisan && calisan.calismaYasSn != null && calisan.calismaYasSn > ayar.isSuresiSn;
  const geriDugmesi = (s: NlAracSeti, kucuk = false) => (isAdmin && geriCekilebilir(s) ? (
    <button type="button" onClick={() => { setGeriHata(null); setGeriCekilecek(s); }} disabled={mesgul != null} className={kucuk ? LINK : TBL_BTN}
      style={kucuk ? { color: 'var(--status-danger-text)' } : smBtn()} aria-label={`Araç seti #${s.id}’i geri çek`}>
      <ArrowUturnLeftIcon className="h-3.5 w-3.5" aria-hidden /> Geri çek
    </button>
  ) : null);

  return (
    <div className="space-y-4">
      <Bolum baslik="Yük araçları (k6 · wrk)" aciklama={ARAC_ACIKLAMASI} govdeSinifi="p-4 space-y-4"
        eylem={<button type="button" onClick={() => void yukle()} disabled={yukleniyor} className={TBL_BTN} style={smBtn()}><ArrowPathIcon className={`h-3.5 w-3.5 ${yukleniyor ? 'animate-spin motion-reduce:animate-none' : ''}`} aria-hidden /> Yenile</button>}>
        {hata && <UyariKutusu ton="uyari" rol="status" baslik="Araç setleri yeniden okunamadı; son okunan durum gösteriliyor.">{hata}</UyariKutusu>}

        {ozetEksik && (
          <UyariKutusu ton="hata" rol="alert" baslik="Arşiv özetleri sabitlenmemiş">
            <ul className="list-disc space-y-0.5 pl-4 font-mono text-[12px]">{ayar.ozetEksikleri.map((x) => <li key={x}>{x}</li>)}</ul>
            <p>{OZET_EKSIK_METNI}</p>
          </UyariKutusu>
        )}

        {calisan && (
          <div role="status" className="flex flex-wrap items-center gap-2 rounded-lg px-3 py-2 text-[12px] leading-5" style={{ background: TON.aksan.zemin, boxShadow: `inset 0 0 0 1px ${TON.aksan.kenar}`, color: 'var(--text-primary)' }}>
            <ArrowPathIcon className="h-4 w-4 shrink-0 animate-spin motion-reduce:animate-none" style={{ color: TON.aksan.metin }} aria-hidden />
            <span className="min-w-0">{`Hazırlanıyor — AWX iş #${calisan.awxJobId ?? '—'}`}</span>
            <KosuDurumHapi durum={calisan.durum} />
            <span className="min-w-0 font-mono text-[11px]" style={{ color: 'var(--text-secondary)' }}>{`#${calisan.id} · ${calisan.derlemeHost}`}</span>
          </div>
        )}
        {calisan && okunamiyor && (
          <UyariKutusu ton="uyari" rol="status" baslik="Hazırlama işinin durumu okunamıyor">{okunamiyorMetni(calisan.awxJobId, Math.round(ayar.isSuresiSn / 60))}</UyariKutusu>
        )}

        {etkin ? <EtkinSet s={etkin} eylem={geriDugmesi(etkin)} /> : !ozetEksik && (
          <UyariKutusu ton="uyari" baslik="Kullanılabilir araç seti yok">{kapi.mesaj || SET_YOK_METNI}</UyariKutusu>
        )}

        {glibcUyarilari.map((s) => (
          <UyariKutusu key={s.id} ton="uyari" baslik="wrk RHEL 8’de çalışmayabilir">{glibcUyariMetni(s.wrkGlibcGerekli as string)}</UyariKutusu>
        ))}

        {isAdmin && (
          <div className="grid items-end gap-3 rounded-lg border p-3 @lg/yuk:grid-cols-[minmax(0,16rem)_minmax(0,1fr)_auto]" style={{ borderColor: 'var(--border-subtle)' }}>
            <Alan id="yuk-derleme-host" etiket="Derleme makinesi" yardim="wrk bu makinede derlenir. RHEL 8 bir makine seçilirse ikili RHEL 8 ve RHEL 9 yük sunucularında çalışır.">
              <select id="yuk-derleme-host" value={secilenHost} onChange={(e) => setDerlemeHost(e.target.value)} className={`${GIRDI} font-mono`} style={girdiStili()}>
                {ayar.derlemeHostlari.map((h) => <option key={h} value={h}>{h}</option>)}
              </select>
            </Alan>
            <p className="min-w-0 self-center text-[12px] leading-5 wrap-anywhere" style={{ color: ayar.proxyHatasi ? 'var(--status-danger-text)' : 'var(--text-secondary)' }}>
              {ayar.proxyHatasi ? ayar.proxyHatasi : ayar.proxyTanimli ? `Vekil sunucu: ${ayar.proxy ?? 'tanımlı'}` : 'Vekil sunucu: yok (doğrudan bağlantı)'}
            </p>
            <button type="button" onClick={() => setHazirlaSor(true)} disabled={hazirlaKapali} className={`${SM_BTN} h-8 justify-center self-center`} style={smBtn(true)}
              title={calisan ? 'Bir araç hazırlama işi sürüyor.' : ozetEksik ? 'Arşiv özetleri sabitlenmeden araçlar hazırlanamaz.' : undefined}>
              <WrenchScrewdriverIcon className="h-3.5 w-3.5" aria-hidden /> Araçları hazırla
            </button>
          </div>
        )}
      </Bolum>

      <Bolum baslik="Hazırlama geçmişi" aciklama="Son 10 araç hazırlama işi (en yeni üstte)." govdeSinifi="p-0">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[49rem] table-fixed border-collapse" aria-label="Araç hazırlama geçmişi">
            <TabloIskelet kolonlar={GECMIS_KOLONLARI} />
            <tbody className="text-[12px]" style={{ color: 'var(--text-primary)' }}>
              {gecmis.length === 0 ? <TableEmptyRow colSpan={GECMIS_KOLONLARI.length} title="Henüz araç hazırlama işi yok." /> : gecmis.map((s) => (
                <tr key={s.id} className="border-t align-top" style={{ borderColor: 'var(--border-subtle)' }}>
                  <td className="px-2.5 py-1.5 tabular-nums">{s.id}</td>
                  <td className="px-2.5 py-1.5">
                    <div className="flex flex-wrap items-center gap-1">
                      <KosuDurumHapi durum={s.durum} />
                      {etkin?.id === s.id && <Cip ton="basari" cerceve>etkin</Cip>}
                      {s.geriCekildi && <Cip ton="hata" cerceve title={`${s.geriCeken ?? '—'} · ${fmtDateTime(s.geriCekmeAt)}`}>geri çekildi</Cip>}
                      {s.durum === 'DONE' && !s.geriCekildi && !s.ozetlerGuncel && <Cip ton="uyari" cerceve title="Bu set şu an sabitlenen arşiv özetleriyle hazırlanmadı; kullanılmaz.">özet farklı</Cip>}
                      {etkin?.id !== s.id && geriDugmesi(s, true)}
                    </div>
                  </td>
                  <td className="truncate px-2.5 py-1.5 font-mono text-[11px]" title={`${s.derlemeHost}${s.derlemeRhel ? ` · RHEL ${s.derlemeRhel}` : ''}`}>{s.derlemeHost}{s.derlemeRhel ? ` · RHEL ${s.derlemeRhel}` : ''}</td>
                  <td className="truncate px-2.5 py-1.5 font-mono text-[11px]" title={s.k6Sha256 ? `${s.k6Surum} · sha256 ${s.k6Sha256}` : s.k6Surum}>{s.k6Surum || '—'}</td>
                  <td className="truncate px-2.5 py-1.5 font-mono text-[11px]" title={s.wrkSha256 ? `${s.wrkSurum} · sha256 ${s.wrkSha256}` : s.wrkSurum}>{s.wrkSurum || '—'}</td>
                  <td className="truncate px-2.5 py-1.5" title={s.createdBy || undefined}>{s.createdBy || '—'}</td>
                  <td className="px-2.5 py-1.5 tabular-nums">{fmtDateTime(s.finishedAt || s.startedAt || s.createdAt)}</td>
                  <td className="px-2.5 py-1.5 text-[11px] wrap-anywhere" style={{ color: s.hata ? 'var(--status-danger-text)' : 'var(--text-muted)' }} title={s.hata || undefined}>
                    {s.hata ? (s.hata.length > HATA_KISA ? `${s.hata.slice(0, HATA_KISA)}…` : s.hata) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Bolum>

      <Modal open={hazirlaSor} onClose={() => { if (mesgul !== 'hazirla') setHazirlaSor(false); }} title="Araçlar hazırlansın mı?" size="md" dismissOnBackdrop={false}
        footer={<div className="flex w-full justify-end gap-2">
          <button type="button" className={SM_BTN} style={smBtn()} disabled={mesgul === 'hazirla'} onClick={() => setHazirlaSor(false)}>İptal</button>
          <button type="button" className={SM_BTN} style={smBtn(true)} disabled={hazirlaKapali} onClick={() => void hazirla(secilenHost)}>
            <WrenchScrewdriverIcon className="h-3.5 w-3.5" aria-hidden /> {mesgul === 'hazirla' ? 'Başlatılıyor…' : 'Hazırla'}
          </button>
        </div>}>
        <div className="space-y-3">
          <p className="text-[13px] leading-5" style={{ color: 'var(--text-primary)' }}>{hazirlamaMetni(secilenHost, ayar.k6Surum || '?', ayar.wrkSurum || '4.2.0')}</p>
          <dl className="grid grid-cols-1 gap-y-2 text-[12px]">
            <Tanim etiket="k6 arşivi (sabit sha256)" title={ayar.k6ArsivSha256 || undefined}><Sha sha={ayar.k6ArsivSha256} /></Tanim>
            <Tanim etiket="wrk kaynağı (sabit sha256)" title={ayar.wrkKaynakSha256 || undefined}><Sha sha={ayar.wrkKaynakSha256} /></Tanim>
          </dl>
        </div>
      </Modal>

      <Modal open={!!geriCekilecek} onClose={() => { if (mesgul !== 'geri') setGeriCekilecek(null); }} title="Araç seti geri çekilsin mi?" subtitle={geriCekilecek ? `Araç seti #${geriCekilecek.id}` : undefined} size="md" dismissOnBackdrop={false}
        footer={<div className="flex w-full justify-end gap-2">
          <button type="button" className={SM_BTN} style={smBtn()} disabled={mesgul === 'geri'} onClick={() => setGeriCekilecek(null)}>İptal</button>
          <button type="button" className={SM_BTN} style={BTN_TEHLIKE} disabled={mesgul === 'geri'} onClick={() => void geriCek()}>
            <ArrowUturnLeftIcon className="h-3.5 w-3.5" aria-hidden /> {mesgul === 'geri' ? 'Geri çekiliyor…' : 'Geri çek'}
          </button>
        </div>}>
        <div className="space-y-3">
          {geriCekilecek && <p className="text-[13px] leading-5" style={{ color: 'var(--text-primary)' }}>{geriCekmeMetni(geriCekilecek.id)}</p>}
          {geriHata && <UyariKutusu ton="hata" rol="alert" baslik="Geri çekilemedi">{geriHata}</UyariKutusu>}
        </div>
      </Modal>
    </div>
  );
}

/** Etkin set karti: surumler, sha256'lar (kesik + title), derleme makinesi, is, /sw dizini ve arsiv ozetleri. */
function EtkinSet({ s, eylem }: { s: NlAracSeti; eylem: React.ReactNode }) {
  return (
    <section className="rounded-lg border" style={{ borderColor: 'var(--border-subtle)' }} aria-label={`Etkin araç seti #${s.id}`}>
      <header className="flex flex-wrap items-center gap-2 border-b px-3 py-2" style={{ borderColor: 'var(--border-subtle)' }}>
        <h4 className="text-[13px] font-semibold leading-5" style={{ color: 'var(--text-primary)' }}>{`Etkin araç seti #${s.id}`}</h4>
        <KosuDurumHapi durum={s.durum} />
        {eylem && <span className="ml-auto">{eylem}</span>}
      </header>
      <dl className="grid grid-cols-1 gap-x-4 gap-y-2.5 p-3 @lg/yuk:grid-cols-2 @3xl/yuk:grid-cols-3">
        <Tanim etiket="k6" title={s.k6Sha256 ? `${s.k6Surum} · sha256 ${s.k6Sha256}` : s.k6Surum}>{s.k6Surum || '—'} · <Sha sha={s.k6Sha256} /></Tanim>
        <Tanim etiket="wrk" title={s.wrkSha256 ? `${s.wrkSurum} · sha256 ${s.wrkSha256}` : s.wrkSurum}>
          {s.wrkSurum || '—'} · <Sha sha={s.wrkSha256} />{s.wrkGlibcGerekli ? ` · glibc ≥ ${s.wrkGlibcGerekli}` : ''}
        </Tanim>
        <Tanim etiket="Derleme" title={`${s.derlemeHost} · RHEL ${s.derlemeRhel ?? '?'} · glibc ${s.derlemeGlibc ?? '?'}`}>
          <span className="font-mono">{s.derlemeHost}</span>{` · RHEL ${s.derlemeRhel ?? '?'} · glibc ${s.derlemeGlibc ?? '?'}`}
        </Tanim>
        <Tanim etiket="Hazırlandı" title={`${fmtDateTime(s.finishedAt)}${s.createdBy ? ` · ${s.createdBy}` : ''}`}>{`${fmtDateTime(s.finishedAt)}${s.createdBy ? ` · ${s.createdBy}` : ''}`}</Tanim>
        <Tanim etiket="AWX işi">
          {s.awxJobId == null ? '—' : s.awxUrl
            ? <a href={s.awxUrl} target="_blank" rel="noreferrer" className={LINK} style={{ color: 'var(--accent)' }}>{`AWX iş #${s.awxJobId}`}</a>
            : `AWX iş #${s.awxJobId}`}
        </Tanim>
        <Tanim etiket="/sw dizini" title={s.swDizin || undefined}><span className="font-mono text-[11px]">{s.swDizin || '—'}</span></Tanim>
        <Tanim etiket="Arşiv özetleri" title={`k6 arşivi ${s.k6ArsivSha256 ?? '—'} · wrk kaynağı ${s.wrkKaynakSha256 ?? '—'} · sabit değerle doğrulandı`}>
          k6 <Sha sha={s.k6ArsivSha256} /> · wrk <Sha sha={s.wrkKaynakSha256} /> · sabit değerle doğrulandı
        </Tanim>
      </dl>
    </section>
  );
}
