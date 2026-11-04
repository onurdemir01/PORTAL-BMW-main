// src/components/nginx_console/yukTesti/KosuListesi.tsx — "Koşular" alt gorunumu (2026-10-27).
//
// Ön kontroller ve koşular tek listede (suzgec: hepsi / koşular / ön kontroller, hedef). Satir tiklaninca
// ayrinti acilir. Suren is varsa liste 15 sn'de bir tazelenir (yoklama yalniz liste ekrandayken).
// Sayfalama: sunucu `dahaVar` derse "Daha eski koşular" bir sonraki sayfayi (`onceki` = listedeki en kucuk id)
// ekler. Tazeleme yalniz ilk sayfayi yeniden okur; yuklenmis eski sayfalar korunur (ilk sayfanin altinda kalanlar).
// Hedef etiketi `hedefHost ?? hedefIp` (2026-10-28): serbest hedefte host yok, IP gorunur; hedef suzgeci ayni etiketle
// kurulur (bos / null secenek OLUSMAZ). Serbest, wrk ve HTTP/2 kosulari ciple isaretlenir (k6 + sunucu + HTTP/1.1 cipsiz).
// 2026-11-04: Admin'e etiketin yaninda kalem (EtiketDuzenle; PUT /kosular/:id/etiket), kayit satiri yerinde gunceller.
// 2026-11-04 (kosu silme): coklu secim kutusu (yalniz silinebilen satirda: Admin ya da kaydi baslatan kisi, suren is degil;
// en cok 50) + "Seçilenleri sil" -> KosuSilOnayi (secilen sayi yazilir). Silinen satirlar listeden kalkar; hepsi ya da hic.
// 2026-11-04 (toplu rapor): secim varken "Toplu rapor" secili kayitlari numara sirasiyla rapora goturur. Rapor herkese okunur:
// bitmis her kosu silme yetkisi olmadan da secilir; "Seçilenleri sil" secimin yalniz silinebilen kisminda calisir.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowPathIcon, TableCellsIcon, TrashIcon } from '@heroicons/react/24/outline';
import { SIL_MAX_TOPLU, nginxLoadtestApi, type NlKosu } from '@/api/nginxLoadtestApi';
import { useAsyncEffect } from '@/hooks/useAsyncEffect';
import { toast } from '@/hooks/useToast';
import { TableEmptyRow } from '@/components/common/EmptyState';
import { fmtDateTime, fmtNumber, fmtRelative } from '@/utils/datetime';
import { BTN_TEHLIKE, TBL_BTN, smBtn } from '@/components/server_hub/retirementStil';
import { Cip, TabloIskelet, UyariKutusu, type Kolon } from '@/components/server_hub/RetirementUi';
import { AKTIF_DURUMLAR, hedefEtiketi, kosuSahibiMi } from './yukTestiOrtak';
import { GIRDI_TABAN, GecerlilikHapi, KosuDurumHapi, TurMotorCipleri, girdiStili, islemEtiketi } from './YukUi';
import EtiketDuzenle from './EtiketDuzenle';
import KosuSilOnayi from './KosuSilOnayi';

type Suzgec = 'hepsi' | 'kosu' | 'on_kontrol';
// Dort kolon (sol menu + "Taleplerim" acikken icerik ~585 px): esnek "Koşu" kolonu etiket, senaryo ve kimin
// ne zaman baslattigini tasir; durum ve gecerlilik ayni hucrede alt alta.
const KOLONLAR: Kolon[] = [
  { anahtar: 'no', baslik: '#', genislik: '3.75rem' },
  { anahtar: 'kosu', baslik: 'Koşu' },
  { anahtar: 'hedef', baslik: 'Hedef', genislik: '32%' },
  { anahtar: 'durum', baslik: 'Durum', genislik: '8.75rem' },
];

/** Sayfa boyu (sunucu tavani 200). */
const SAYFA = 200;

export default function KosuListesi({ onAc, yenileAnahtari = 0, isAdmin = false, kullaniciAdi = null, onTopluRapor }: { onAc: (id: number) => void; yenileAnahtari?: number; isAdmin?: boolean; kullaniciAdi?: string | null; onTopluRapor?: (kosular: number[]) => void }) {
  const [kosular, setKosular] = useState<NlKosu[] | null>(null);
  const [hata, setHata] = useState('');
  const [yukleniyor, setYukleniyor] = useState(false);
  const [suzgec, setSuzgec] = useState<Suzgec>('hepsi');
  const [hedef, setHedef] = useState('');
  const [dahaVar, setDahaVar] = useState(false);
  const [eskiYukleniyor, setEskiYukleniyor] = useState(false);
  const [eskiHata, setEskiHata] = useState('');
  // Eski sayfa yuklendi mi: tazeleme o satirlari silmesin, `dahaVar` en eski sayfanin degeri kalsin.
  const eskiSayfa = useRef(false);
  const busyRef = useRef(false);

  const yukle = useCallback(async () => {
    setYukleniyor(true);
    try {
      const r = await nginxLoadtestApi.kosular({ limit: SAYFA });
      const ilk = r.kosular || [];
      setKosular((onceki) => {
        if (!onceki || !eskiSayfa.current || !ilk.length) return ilk;
        const enKucuk = Math.min(...ilk.map((k) => k.id));
        return [...ilk, ...onceki.filter((k) => k.id < enKucuk)];
      });
      if (!eskiSayfa.current || !ilk.length) {
        eskiSayfa.current = false;
        setDahaVar(r.dahaVar);
      }
      setHata('');
    } catch (e) {
      setHata(e instanceof Error ? e.message : String(e));
    } finally {
      setYukleniyor(false);
    }
  }, []);
  async function dahaEski() {
    if (busyRef.current || !kosular?.length) return;
    busyRef.current = true;
    setEskiYukleniyor(true);
    try {
      const r = await nginxLoadtestApi.kosular({ limit: SAYFA, onceki: Math.min(...kosular.map((k) => k.id)) });
      eskiSayfa.current = true;
      setKosular((l) => {
        const bilinen = new Set((l || []).map((k) => k.id));
        return [...(l || []), ...(r.kosular || []).filter((k) => !bilinen.has(k.id))];
      });
      setDahaVar(r.dahaVar);
      setEskiHata('');
    } catch (e) {
      setEskiHata(e instanceof Error ? e.message : String(e));
    } finally {
      busyRef.current = false;
      setEskiYukleniyor(false);
    }
  }
  useAsyncEffect(async (alive) => { if (alive()) await yukle(); }, [yukle, yenileAnahtari]);
  const aktifVar = !!kosular?.some((k) => AKTIF_DURUMLAR.has(k.durum));
  useEffect(() => {
    if (!aktifVar) return;
    const z = window.setInterval(() => { void yukle(); }, 15000);
    return () => window.clearInterval(z);
  }, [aktifVar, yukle]);

  const hedefler = useMemo(() => [...new Set((kosular || []).map(hedefEtiketi).filter(Boolean))].sort(), [kosular]);
  const liste = (kosular || []).filter((k) => (suzgec === 'hepsi' || k.islem === suzgec) && (!hedef || hedefEtiketi(k) === hedef));

  // ── Coklu secim ve silme ──
  const [secim, setSecim] = useState<number[]>([]);
  const [silSor, setSilSor] = useState(false);
  const sahip = (k: NlKosu) => kosuSahibiMi(k, isAdmin, kullaniciAdi);
  const silinebilir = (k: NlKosu) => sahip(k) && !AKTIF_DURUMLAR.has(k.durum);
  const raporSecilebilir = (k: NlKosu) => !!onTopluRapor && k.islem === 'kosu' && !AKTIF_DURUMLAR.has(k.durum);
  const secilebilir = (k: NlKosu) => silinebilir(k) || raporSecilebilir(k);
  const silmeAcik = isAdmin || (kosular || []).some(sahip);
  const secimAcik = silmeAcik || (kosular || []).some(raporSecilebilir);
  const doldu = secim.length >= SIL_MAX_TOPLU;
  const gorunenSecilebilir = liste.filter(secilebilir);
  const hepsiSecili = gorunenSecilebilir.length > 0 && gorunenSecilebilir.every((k) => secim.includes(k.id));
  const sec = (id: number, ekle: boolean) => setSecim((s) => (ekle ? (s.includes(id) || s.length >= SIL_MAX_TOPLU ? s : [...s, id]) : s.filter((x) => x !== id)));
  const gorunenleriSec = (ekle: boolean) => setSecim((s) => {
    if (!ekle) return s.filter((id) => !gorunenSecilebilir.some((k) => k.id === id));
    const yeni = [...s];
    for (const k of gorunenSecilebilir) if (!yeni.includes(k.id) && yeni.length < SIL_MAX_TOPLU) yeni.push(k.id);
    return yeni;
  });
  const byId = new Map((kosular || []).map((k) => [k.id, k]));
  const silinecekler = secim.map((id) => byId.get(id)).filter((k): k is NlKosu => !!k && silinebilir(k));
  const kolonlar: Kolon[] = secimAcik ? [{ anahtar: 'sec', baslik: '', genislik: '2.25rem' }, ...KOLONLAR] : KOLONLAR;
  const secimNedeni = (k: NlKosu) => {
    if (!secilebilir(k)) return !sahip(k) ? 'Yalnız kaydı başlatan kişi ya da Admin silebilir.' : 'Süren iş silinemez.';
    if (doldu) return `En çok ${SIL_MAX_TOPLU} kayıt seçilebilir.`;
    return silinebilir(k) ? undefined : 'Toplu rapor için seçilir; silmeyi yalnız kaydı başlatan kişi ya da Admin yapabilir.';
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div role="radiogroup" aria-label="İşlem türü" className="flex gap-1 rounded-lg p-0.5" style={{ background: 'var(--bg-elevated)' }}>
          {([['hepsi', 'Tümü'], ['kosu', 'Koşular'], ['on_kontrol', 'Ön kontroller']] as const).map(([k, ad]) => (
            <button key={k} type="button" role="radio" aria-checked={suzgec === k} onClick={() => setSuzgec(k)} className={`h-7 rounded-md px-2.5 text-[11px] font-medium ${suzgec === k ? 'shadow-sm' : ''}`}
              style={suzgec === k ? { background: 'var(--bg-surface)', color: 'var(--text-primary)', boxShadow: 'inset 0 0 0 1px var(--border)' } : { color: 'var(--text-secondary)' }}>{ad}</button>
          ))}
        </div>
        <select value={hedef} onChange={(e) => setHedef(e.target.value)} className={`${GIRDI_TABAN} h-8 w-48`} style={girdiStili()} aria-label="Hedef sunucu ya da IP">
          <option value="">Tüm hedefler</option>
          {hedefler.map((h) => <option key={h} value={h}>{h}</option>)}
        </select>
        <span className="ml-auto flex items-center gap-2 text-[11px]" style={{ color: 'var(--text-secondary)' }}>
          {aktifVar && <span>süren iş var · 15 sn’de bir tazelenir</span>}
          {secimAcik && secim.length > 0 && (
            <>
              <span className="tabular-nums" role="status">{`${fmtNumber(secim.length)} seçili${doldu ? ` (en çok ${SIL_MAX_TOPLU})` : ''}`}</span>
              <button type="button" onClick={() => setSecim([])} className={TBL_BTN} style={smBtn()}>Seçimi temizle</button>
              {onTopluRapor && (
                <button type="button" onClick={() => onTopluRapor([...secim].sort((a, b) => a - b))} className={TBL_BTN} style={smBtn()}>
                  <TableCellsIcon className="h-3.5 w-3.5" aria-hidden /> Toplu rapor
                </button>
              )}
            </>
          )}
          {silmeAcik && (
            <button type="button" onClick={() => setSilSor(true)} disabled={!silinecekler.length} className={TBL_BTN} style={BTN_TEHLIKE} title="Seçilen koşu / ön kontrol kayıtlarını Portal’dan siler (ham ölçüm dosyaları durur)">
              <TrashIcon className="h-3.5 w-3.5" aria-hidden /> Seçilenleri sil
            </button>
          )}
          <button type="button" onClick={() => void yukle()} disabled={yukleniyor} className={TBL_BTN} style={smBtn()}><ArrowPathIcon className={`h-3.5 w-3.5 ${yukleniyor ? 'animate-spin motion-reduce:animate-none' : ''}`} aria-hidden /> Yenile</button>
        </span>
      </div>
      {hata && <UyariKutusu ton="hata" rol="alert" baslik="Koşular okunamadı">{hata}</UyariKutusu>}
      <div className="overflow-x-auto rounded-lg border" style={{ borderColor: 'var(--border-subtle)' }}>
        <table className="pf-table-sticky w-full min-w-[34rem] table-fixed border-collapse" aria-label="Yük testi koşuları">
          <TabloIskelet kolonlar={kolonlar} secimBasligi={secimAcik ? (
            <input type="checkbox" aria-label="Görünen seçilebilir kayıtların hepsini seç" checked={hepsiSecili} disabled={!gorunenSecilebilir.length}
              onChange={(e) => gorunenleriSec(e.target.checked)} title={`Görünen seçilebilir kayıtları seçer (en çok ${SIL_MAX_TOPLU})`} />
          ) : undefined} />
          <tbody className="text-[12px]" style={{ color: 'var(--text-primary)' }}>
            {kosular == null && !hata ? (
              <tr><td colSpan={kolonlar.length} className="px-3 py-6"><div className="skeleton h-16 rounded-lg" aria-busy="true"><span className="sr-only">Koşular yükleniyor…</span></div></td></tr>
            ) : liste.length === 0 ? (
              <TableEmptyRow colSpan={kolonlar.length} title={kosular?.length ? 'Süzgece uyan kayıt yok.' : 'Henüz yük testi koşusu yok.'}
                description={kosular?.length ? (dahaVar ? 'Süzgeci değiştirin ya da daha eski koşuları yükleyin.' : 'Süzgeci değiştirin.') : 'Yeni koşu: senaryo seçin, ön kontrolü çalıştırın, sonra koşuyu başlatın.'} />
            ) : liste.map((k) => (
              <tr key={k.id} className="cursor-pointer border-t align-top" style={{ borderColor: 'var(--border-subtle)' }} onClick={() => onAc(k.id)}>
                {secimAcik && (
                  <td className="px-2.5 py-2" onClick={(e) => e.stopPropagation()}>
                    <input type="checkbox" aria-label={`Kayıt ${k.id} seç`} checked={secim.includes(k.id)} disabled={!secilebilir(k) || (doldu && !secim.includes(k.id))}
                      title={secim.includes(k.id) ? undefined : secimNedeni(k)} onChange={(e) => sec(k.id, e.target.checked)} />
                  </td>
                )}
                <td className="px-2.5 py-2">
                  <button type="button" onClick={(e) => { e.stopPropagation(); onAc(k.id); }} className="font-mono text-[12px] font-semibold tabular-nums underline decoration-dotted underline-offset-2 hover:decoration-solid" style={{ color: 'var(--accent)' }} aria-label={`Koşu ${k.id} ayrıntısı`}>#{k.id}</button>
                </td>
                <td className="px-2.5 py-2">
                  <div className="flex min-w-0 items-center gap-1.5">
                    <Cip ton={k.islem === 'kosu' ? 'aksan' : 'notr'} cerceve>{islemEtiketi(k.islem)}</Cip>
                    <span className="truncate font-medium" title={k.etiket || undefined}>{k.etiket || <span style={{ color: 'var(--text-muted)' }}>etiketsiz</span>}</span>
                    {isAdmin && <EtiketDuzenle kosuId={k.id} etiket={k.etiket} onKaydedildi={(e) => setKosular((l) => (l || []).map((x) => (x.id === k.id ? { ...x, etiket: e } : x)))} />}
                  </div>
                  <div className="mt-0.5 truncate text-[11px]" style={{ color: 'var(--text-secondary)' }} title={k.senaryoAd || ''}>{k.senaryoAd || `senaryo #${k.senaryoId ?? '?'}`}{k.adim ? ` · ${k.adim}` : ''}</div>
                  <div className="truncate text-[11px] tabular-nums" style={{ color: 'var(--text-muted)' }} title={`${k.createdBy || '—'} · ${fmtDateTime(k.createdAt)}`}>{`${k.createdBy || '—'} · ${fmtRelative(k.createdAt) || fmtDateTime(k.createdAt)}`}</div>
                </td>
                <td className="px-2.5 py-2">
                  {/* Dar kolonda cipler alt satira gecer; etiket (IP / host) kesilmez (uzun host adi kolona sigmazsa kesilir). */}
                  <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1">
                    <span className="min-w-0 max-w-full truncate font-mono text-[12px]" title={hedefEtiketi(k) || undefined}>{hedefEtiketi(k) || '—'}</span>
                    <TurMotorCipleri hedefTuru={k.hedefTuru} motor={k.motor} protokol={k.protokol} />
                  </div>
                  {/* Sunucu hedefinde ikinci satir IP · vhost; serbestte IP zaten etiket: yalniz vhost. */}
                  {k.hedefHost ? (
                    <div className="truncate text-[11px]" style={{ color: 'var(--text-secondary)' }} title={`${k.hedefIp || '—'} · ${k.vhost || '—'}`}>{k.hedefIp ? <span className="font-mono">{k.hedefIp}</span> : '—'}{` · ${k.vhost || '—'}`}</div>
                  ) : (
                    <div className="truncate text-[11px]" style={{ color: 'var(--text-secondary)' }} title={k.vhost || ''}>{k.vhost || '—'}</div>
                  )}
                </td>
                <td className="px-2.5 py-2">
                  <div className="flex flex-col items-start gap-1">
                    <KosuDurumHapi durum={k.durum} />
                    {k.islem === 'kosu' && k.gecerlilik ? <GecerlilikHapi gecerlilik={k.gecerlilik} /> : null}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {eskiHata && <UyariKutusu ton="hata" rol="alert" baslik="Daha eski koşular okunamadı">{eskiHata}</UyariKutusu>}
      {dahaVar && kosular && kosular.length > 0 && (
        <div className="flex flex-wrap items-center justify-center gap-2 text-[11px]" style={{ color: 'var(--text-secondary)' }}>
          <span className="tabular-nums">{`${fmtNumber(kosular.length)} kayıt yüklendi`}</span>
          <button type="button" onClick={() => void dahaEski()} disabled={eskiYukleniyor} className={TBL_BTN} style={smBtn()}>
            {eskiYukleniyor ? <ArrowPathIcon className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" aria-hidden /> : null} Daha eski koşular
          </button>
        </div>
      )}
      {silSor && silinecekler.length > 0 && (
        <KosuSilOnayi kosular={silinecekler} toplu onKapat={() => setSilSor(false)}
          onSecimdenCikar={(idler) => { setSecim((s) => s.filter((x) => !idler.includes(x))); setSilSor(false); }}
          onSilindi={(silinen) => {
            const gid = new Set(silinen.length ? silinen.map((x) => x.id) : silinecekler.map((k) => k.id));
            setKosular((l) => (l || []).filter((k) => !gid.has(k.id)));
            setSecim((s) => s.filter((x) => !gid.has(x)));
            setSilSor(false);
            toast.success(`${fmtNumber(gid.size)} kayıt silindi. Sunucudaki ham ölçüm dosyaları durur.`);
          }} />
      )}
    </div>
  );
}
