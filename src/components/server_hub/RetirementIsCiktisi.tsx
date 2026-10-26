// src/components/server_hub/RetirementIsCiktisi.tsx — hedefin AWX isleri ve is ciktisi (2026-10-26).
//
// Kullanici: "is ciktisini gormek icin bir buton koy". Kayit penceresindeki ayrinti satirinin "İş çıktısı"
// sekmesi: solda hedefin isleri (sunucunun listesi, RtTarget.awxIsleri), sagda secilen isin ciktisi.
// JobTracker kayan penceresi KULLANILMAZ: Modal'in arkasinda kalir, zamanlayicinin isini bilmez, kalici
// hatada 12 kez dener. Ic ice Modal da yok (Esc ikisini birden kapatirdi); "Büyüt" ayni veriyle tam ekran
// bir katman acar ve Esc'i yalniz o katman yakalar.
//
// YOKLAMA (useIsCiktisi): tek acik goruntuleyici = tek yoklayici. Seri (yanit gelmeden yeni istek yok),
// AbortController ile iptal, bitmis is onbellekte, sekme gizliyken istek yok. Eski retirementApi.jobStatus
// burada ASLA cagrilmaz: yan etkili ve sunucu / is numarasini istemciden aliyor.
import React, { useEffect, useRef, useState } from 'react';
import { ArrowPathIcon, ArrowsPointingOutIcon, XMarkIcon } from '@heroicons/react/24/outline';
import AnsibleLogTerminal from '@/components/common/AnsibleLogTerminal';
import { retirementApi, type RtHedefIs, type RtIsCiktisi, type RtTarget } from '@/api/retirementApi';
import { fmtDateTime } from '@/utils/datetime';
import { IS_DURUM, LINK, SECILI_ZEMIN, TBL_BTN, TON, smBtn } from './retirementStil';
import { Cip, UyariKutusu } from './RetirementUi';
import { GECIS } from './RetirementCanli';
import {
  EN_COK_DENEME, ciktiSonucu, geriCekilme, hataOzeti, ipucuEslesir, isAnahtari, isEtiketi, kaliciMesaj, redBilgisi, sureMetni, varsayilanIs, yoklamaGecikmesi,
  type IsIpucu,
} from './retirementCikti';

/** Bitmis islerin ciktisi (kayit penceresi omru boyunca); anahtar hedef|adim|web|is. */
export type CiktiOnbellegi = Map<string, RtIsCiktisi>;
const onbellekAnahtari = (tid: number, is: RtHedefIs) => `${tid}|${is.adim}|${is.web ?? ''}|${is.jobId}`;

export interface IsCiktisiDurumu {
  veri: RtIsCiktisi | null;
  /** Kalici ret (409 / 401 / 403 / 404): yoklama durdu. */
  red: { code: string; message: string } | null;
  /** Ust uste gecici hata: deneme sayisi, sonraki denemeye saniye (durduysa null). */
  hata: { deneme: number; sonraSn: number | null; mesaj: string } | null;
  durdu: boolean;
  gizli: boolean;
  sonOkuma: number | null;
  isDegisti: { eski: number; yeni: number } | null;
  duyuru: string;
}

/** Tek isin ciktisini yoklar. `onBitti` (kaydi yeniden oku) YALNIZ canli gorulen is bitince ya da is degisince, BIR kez. */
export function useIsCiktisi(kayitId: number, tid: number, is: RtHedefIs, o: { onbellek: CiktiOnbellegi; onBitti?: () => void; etiket?: string }) {
  const { onbellek } = o;
  const anahtar = onbellekAnahtari(tid, is);
  const [d, setD] = useState<IsCiktisiDurumu>(() => ({ veri: onbellek.get(anahtar) ?? null, red: null, hata: null, durdu: false, gizli: false, sonOkuma: null, isDegisti: null, duyuru: '' }));
  const [tetik, setTetik] = useState(0);
  const zorla = useRef(false);
  const sonUzunluk = useRef(0);
  const canliGoruldu = useRef(false);
  const bildirildi = useRef(false);
  const geri = useRef({ onBitti: o.onBitti, etiket: o.etiket });
  useEffect(() => { geri.current = { onBitti: o.onBitti, etiket: o.etiket }; });

  useEffect(() => {
    let canli = true;
    let zaman: number | undefined;
    let ac: AbortController | null = null;
    let deneme = 0;
    let gizliBekliyor = false;
    const bildir = () => {
      if (bildirildi.current) return;
      bildirildi.current = true;
      geri.current.onBitti?.();
    };
    const planla = (ms: number) => { zaman = window.setTimeout(oku, ms); };
    async function oku() {
      if (!canli) return;
      if (typeof document !== 'undefined' && document.hidden) {
        gizliBekliyor = true;
        setD((x) => ({ ...x, gizli: true }));
        return;
      }
      gizliBekliyor = false;
      const kayitli = onbellek.get(anahtar);
      if (kayitli && !zorla.current) {
        setD((x) => ({ ...x, veri: kayitli, gizli: false }));
        return;
      }
      zorla.current = false;
      ac = new AbortController();
      let r: unknown;
      try {
        r = await retirementApi.isCiktisi(kayitId, tid, is.adim, is.web, ac.signal);
      } catch (e) {
        r = e;
      }
      if (!canli) return;
      const sinif = ciktiSonucu(r);
      if (sinif === 'iptal') return;
      if (sinif === 'veri') {
        const v = r as RtIsCiktisi;
        deneme = 0;
        const uzadi = v.output.length > sonUzunluk.current;
        sonUzunluk.current = v.output.length;
        const degisti = v.jobId !== is.jobId;
        if (!v.bitti) canliGoruldu.current = true;
        const sonuc = v.status === 'successful' ? 'başarılı' : v.status === 'canceled' ? 'iptal edildi' : v.status ? 'başarısız' : 'bitti';
        const duyuru = v.bitti && canliGoruldu.current ? `${geri.current.etiket || 'AWX'} işi #${v.jobId} bitti: ${sonuc}` : '';
        setD((x) => ({ ...x, veri: v, red: null, hata: null, durdu: false, gizli: false, sonOkuma: Date.now(), isDegisti: degisti ? { eski: is.jobId, yeni: v.jobId } : x.isDegisti, duyuru: duyuru || x.duyuru }));
        if (degisti) { bildir(); return; }
        if (v.bitti) {
          onbellek.set(anahtar, v);
          if (canliGoruldu.current) bildir();
          return;
        }
        planla(yoklamaGecikmesi(uzadi, v.status));
        return;
      }
      const b = redBilgisi(r);
      if (sinif === 'kalici') {
        setD((x) => ({ ...x, red: b, hata: null, durdu: false, gizli: false }));
        return;
      }
      deneme += 1;
      if (deneme >= EN_COK_DENEME) {
        setD((x) => ({ ...x, hata: { deneme, sonraSn: null, mesaj: b.message }, durdu: true, gizli: false }));
        return;
      }
      const ms = geriCekilme(deneme);
      setD((x) => ({ ...x, hata: { deneme, sonraSn: Math.round(ms / 1000), mesaj: b.message }, durdu: false, gizli: false }));
      planla(ms);
    }
    const gorunurluk = () => {
      if (!canli || document.hidden || !gizliBekliyor) return;
      window.clearTimeout(zaman);
      planla(0);
    };
    document.addEventListener('visibilitychange', gorunurluk);
    planla(0);
    return () => {
      canli = false;
      window.clearTimeout(zaman);
      ac?.abort();
      document.removeEventListener('visibilitychange', gorunurluk);
    };
  }, [kayitId, tid, is.adim, is.web, is.jobId, anahtar, onbellek, tetik]);

  /** "Yenile" / "Yeniden dene": onbellegi atlar, deneme sayacini sifirlar. */
  const yenile = () => {
    zorla.current = true;
    setD((x) => ({ ...x, hata: null, durdu: false }));
    setTetik((n) => n + 1);
  };
  return { ...d, yenile };
}

const KAYITLI_SONUC = (t: RtTarget, is: RtHedefIs): string | null => {
  if (is.adim === 'web') return (t.webSonuc || [])[is.web ?? -1]?.message || null;
  if (is.adim === 'delete_onkontrol') return t.silmeOnKontrol?.mesaj || null;
  if (is.adim === 'rollback_onkontrol') return t.geriAlOnKontrol?.mesaj || null;
  if (is.adim === 'onkontrol') return t.planText || t.resultText || null;
  return t.resultText || t.planText || null;
};

/** Secilen isin ciktisi: bilgi seridi, bantlar, hata ozeti, terminal; "Büyüt" ayni durumla tam ekran. */
export function IsGoruntuleyici({ kayitId, t, is, onbellek, onIsBitti }: { kayitId: number; t: RtTarget; is: RtHedefIs; onbellek: CiktiOnbellegi; onIsBitti: () => void }) {
  const { etiket, ipucu } = isEtiketi(is, t.webSonuc);
  const c = useIsCiktisi(kayitId, t.id, is, { onbellek, onBitti: onIsBitti, etiket });
  const v = c.veri;
  const suruyor = !!v && !v.bitti;
  const [takip, setTakip] = useState(true);
  const [buyuk, setBuyuk] = useState(false);
  const [simdi, setSimdi] = useState(() => Date.now());
  const buyutRef = useRef<HTMLButtonElement>(null);
  const kapatRef = useRef<HTMLButtonElement>(null);
  const katmanRef = useRef<HTMLDivElement>(null);
  const acildi = useRef(false);
  // Sayac yalniz is surerken ve sekme gorunurken isler.
  useEffect(() => {
    if (!suruyor || c.gizli) return;
    const z = window.setInterval(() => setSimdi(Date.now()), 1000);
    return () => window.clearInterval(z);
  }, [suruyor, c.gizli]);
  // Buyut: acilinca odak kapat dugmesine, kapaninca Buyut dugmesine.
  useEffect(() => {
    if (buyuk) { acildi.current = true; kapatRef.current?.focus(); }
    else if (acildi.current) { acildi.current = false; buyutRef.current?.focus(); }
  }, [buyuk]);

  const baslangic = v?.started ? Date.parse(v.started) : NaN;
  const gecen = Number.isFinite(baslangic) ? (simdi - baslangic) / 1000 : v?.elapsed ?? null;
  const ham = v ? v.status || (v.bitti ? 'arsiv' : 'pending') : 'pending';
  const terminalDurumu = ham === 'new' ? 'pending' : ham;
  const hataliBitti = !!v && v.bitti && (v.status === 'failed' || v.status === 'error');
  const ozet = hataliBitti ? hataOzeti(v.output) : [];
  const baslik = `retirement-${kayitId}-${t.host}-${is.adim}${is.web != null ? `-${is.web}` : ''}-${is.jobId}`;

  const serit = (katmanda: boolean) => (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] leading-5" style={{ color: 'var(--text-secondary)' }}>
      <span className="text-[12px] font-semibold" style={{ color: 'var(--text-primary)' }} title={ipucu}>{etiket}</span>
      <span className="font-mono tabular-nums">AWX iş #{v?.jobId ?? is.jobId}</span>
      {v?.sunucuAdi && <span>AWX: {v.sunucuAdi}</span>}
      {v?.started && <span className="tabular-nums">başladı {fmtDateTime(v.started)}</span>}
      {suruyor && gecen != null && <span className="tabular-nums">{sureMetni(gecen)} geçti</span>}
      {v?.bitti && v.elapsed != null && <span className="tabular-nums">{sureMetni(v.elapsed)} sürdü{v.finished ? ` · bitti ${fmtDateTime(v.finished)}` : ''}</span>}
      {suruyor && c.sonOkuma != null && <span className="font-semibold tabular-nums" style={{ color: 'var(--accent)' }}><span aria-hidden>●</span> canlı · son okuma {Math.max(0, Math.round((simdi - c.sonOkuma) / 1000))} sn önce</span>}
      {c.gizli && <span>sekme gizli — duraklatıldı</span>}
      {v?.kaynak === 'arsiv' && <Cip>arşivden</Cip>}
      <span className="ml-auto flex flex-wrap items-center gap-1.5">
        {suruyor && (
          // Durum etiketin kendisinde (aria-pressed YOK: degisen etiketle celisirdi, denetim B10).
          <button type="button" onClick={() => setTakip((x) => !x)} className={TBL_BTN} style={smBtn()}>{takip ? 'Takibi durdur' : 'Sona git · takip et'}</button>
        )}
        <button type="button" onClick={c.yenile} className={TBL_BTN} style={smBtn()} title="AWX’ten yeniden oku (önbelleği atlar)"><ArrowPathIcon className="h-3.5 w-3.5" aria-hidden /> Yenile</button>
        {v?.awxUrl && <a href={v.awxUrl} target="_blank" rel="noopener noreferrer" className={LINK} style={{ color: 'var(--accent)' }}>AWX’te aç ↗</a>}
        {katmanda
          ? <button ref={kapatRef} type="button" onClick={() => setBuyuk(false)} className={TBL_BTN} style={smBtn()} aria-label="Büyütmeyi kapat" title="Kapat (Esc)"><XMarkIcon className="h-3.5 w-3.5" aria-hidden /> Kapat</button>
          : <button ref={buyutRef} type="button" onClick={() => setBuyuk(true)} className={TBL_BTN} style={smBtn()} title="Çıktıyı tam ekranda göster"><ArrowsPointingOutIcon className="h-3.5 w-3.5" aria-hidden /> Büyüt</button>}
      </span>
    </div>
  );

  const bantlar = (
    <>
      {v?.kaynak === 'arsiv' && (
        <UyariKutusu ton="bilgi" baslik={<>{v.uyari || 'AWX sunucusu kapalı ya da iş AWX’ten silinmiş; Portal arşivi gösteriliyor'}{v.arsivTarihi ? ` (${fmtDateTime(v.arsivTarihi)})` : ''}</>} />
      )}
      {v?.kirpildi && <UyariKutusu ton="uyari" baslik="Çıktı Portal sınırında kırpıldı; sonu eksik olabilir — tamamı için AWX’te açın." />}
      {c.isDegisti && <UyariKutusu ton="bilgi" baslik={`Bu adımın işi değişti: #${c.isDegisti.eski} → #${c.isDegisti.yeni}; liste tazelendi, yeni iş gösteriliyor.`} />}
      {c.red && v && <UyariKutusu ton="hata" rol="alert" baslik={kaliciMesaj(c.red.code, c.red.message, { jobId: is.jobId, gecis: GECIS.has(t.status) })} />}
      {c.hata && (
        <div className="flex flex-wrap items-center gap-2 text-[11px] leading-4" style={{ color: 'var(--status-warning-text)' }} role="status">
          {c.durdu
            ? <><span>AWX okunamadı — otomatik deneme durdu ({c.hata.deneme}/{EN_COK_DENEME}){c.hata.mesaj ? `: ${c.hata.mesaj}` : ''}</span><button type="button" onClick={c.yenile} className={TBL_BTN} style={smBtn()}>Yeniden dene</button></>
            : <span>AWX okunamadı — {c.hata.sonraSn} sn sonra yeniden denenecek ({c.hata.deneme}/{EN_COK_DENEME})</span>}
        </div>
      )}
      {hataliBitti && (
        <div role="alert" className="border-l-[3px] px-3 py-2 text-[11px] leading-4" style={{ background: 'var(--status-danger-bg)', borderColor: 'var(--status-danger)' }}>
          <div className="font-semibold" style={{ color: 'var(--status-danger-text)' }}>Hata özeti</div>
          {v?.jobExplanation && <div style={{ color: 'var(--text-primary)' }}>{v.jobExplanation}</div>}
          {ozet.length > 0 && (
            <ol className="mt-1 space-y-0.5 font-mono">
              {ozet.map((x) => (
                <li key={x.satir} className="grid grid-cols-[3rem_minmax(0,1fr)] gap-x-2">
                  <span className="w-12 text-right tabular-nums" style={{ color: 'var(--text-secondary)' }}>{x.satir}</span>
                  <span className="wrap-anywhere" style={{ color: 'var(--text-primary)' }}>{x.metin}</span>
                </li>
              ))}
            </ol>
          )}
          {!ozet.length && !v?.jobExplanation && <div style={{ color: 'var(--text-secondary)' }}>Çıktıda hata satırı bulunamadı — tamamı aşağıda.</div>}
          {v?.resultTraceback && <pre className="mt-1 max-h-24 overflow-auto whitespace-pre-wrap font-mono" style={{ color: 'var(--text-primary)' }}>{v.resultTraceback}</pre>}
        </div>
      )}
    </>
  );

  const govde = (
    c.red && !v ? (
      <UyariKutusu ton="hata" rol="alert" baslik={kaliciMesaj(c.red.code, c.red.message, { jobId: is.jobId, gecis: GECIS.has(t.status) })}
        eylem={c.red.code === 'hedef_yok' ? <button type="button" onClick={onIsBitti} className={TBL_BTN} style={smBtn()}>Kaydı yenile</button> : undefined}>
        <p>Portal’ın kaydettiği sonuç: {KAYITLI_SONUC(t, is) || '—'}</p>
      </UyariKutusu>
    ) : !v ? (
      <div className="skeleton h-full rounded-xl" aria-busy="true"><span className="sr-only">İş çıktısı yükleniyor…</span></div>
    ) : (
      <AnsibleLogTerminal size="fill" className="h-full" output={v.output} status={terminalDurumu} statusLabel={terminalDurumu === 'arsiv' ? 'arşiv · durum bilinmiyor' : undefined} autoScroll={takip} title={baslik}
        placeholder={v.bitti ? 'AWX bu iş için stdout döndürmedi — “AWX’te aç” ile job ayrıntısına bakın.' : 'AWX henüz çıktı üretmedi — iş kuyrukta ya da başlıyor…'} />
    )
  );

  // ODAK TUZAGI (denetim B2): katman acikken Tab / Shift+Tab katmanin icinde doner; olay Modal'in window
  // dinleyicisine ulasmaz (o tum panelde dolasip odagi katmanin ARKASINA tasirdi, sonra Esc kaydi kapatirdi).
  const katmanTusu = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') { e.stopPropagation(); setBuyuk(false); return; }
    if (e.key !== 'Tab') return;
    e.stopPropagation();
    const l = Array.from(katmanRef.current?.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])') ?? []);
    if (!l.length) { e.preventDefault(); return; }
    const ilk = l[0];
    const son = l[l.length - 1];
    const aktifOge = document.activeElement as HTMLElement | null;
    const icerde = !!aktifOge && !!katmanRef.current?.contains(aktifOge);
    if (!icerde || (e.shiftKey && aktifOge === ilk)) { e.preventDefault(); (e.shiftKey ? son : ilk).focus(); }
    else if (!e.shiftKey && aktifOge === son) { e.preventDefault(); ilk.focus(); }
  };

  return (
    <div className="min-w-0 space-y-2" data-rt-is-goruntuleyici>
      {serit(false)}
      {/* Buyut acikken bantlar (Hata ozeti role=alert dahil) YALNIZ katmanda: iki kez duyurulmasin (denetim B3). */}
      {!buyuk && bantlar}
      <div style={{ height: 'min(30rem, calc(100dvh - 22rem))', minHeight: '14rem' }}>
        {buyuk ? <div className="flex h-full items-center justify-center rounded-xl border border-dashed text-[12px]" style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}>Çıktı büyütülmüş görünümde açık.</div> : govde}
      </div>
      <p className="sr-only" aria-live="polite">{c.duyuru}</p>
      {buyuk && (
        <div className="fixed inset-0 z-[60] flex p-4" style={{ background: 'rgba(0,0,0,.45)' }} onClick={() => setBuyuk(false)} data-rt-buyut>
          <div ref={katmanRef} role="dialog" aria-modal="true" aria-label={`İş çıktısı — ${etiket}`} className="flex h-full w-full flex-col gap-2 rounded-2xl border p-4" style={{ background: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }}
            onClick={(e) => e.stopPropagation()} onKeyDown={katmanTusu}>
            {serit(true)}
            {bantlar}
            <div className="min-h-0 flex-1">{govde}</div>
          </div>
        </div>
      )}
    </div>
  );
}

/** "İş çıktısı" sekmesi: solda isler, sagda secilen isin ciktisi. */
export default function RetirementIsCiktisi({ kayitId, t, ipucu, onIsBitti, onbellek }: { kayitId: number; t: RtTarget; ipucu?: IsIpucu; onIsBitti: () => void; onbellek?: CiktiOnbellegi }) {
  const isler = t.awxIsleri || [];
  const [yerel] = useState<CiktiOnbellegi>(() => new Map());
  const [secili, setSecili] = useState<string | null>(() => { const v = varsayilanIs(isler, ipucu); return v ? isAnahtari(v) : null; });
  // Yeni ipucu (baska bir giris noktasi) secimi yeniden belirler (render sirasinda ayar: effect'te setState yok).
  const [sonIpucu, setSonIpucu] = useState(ipucu);
  if (sonIpucu !== ipucu) {
    setSonIpucu(ipucu);
    const v = varsayilanIs(isler, ipucu);
    setSecili(v ? isAnahtari(v) : null);
  }
  const sec = isler.find((x) => isAnahtari(x) === secili) ?? varsayilanIs(isler, ipucu);
  // Giris noktasinin istedigi is listede yoksa (siniflandirilamadi) baska bir isin ciktisi SESSIZCE gosterilmez.
  const eslesmedi = isler.length > 0 && !ipucuEslesir(isler, ipucu);
  return (
    <div className="grid gap-3 p-3 lg:grid-cols-[15rem_minmax(0,1fr)]">
      <nav aria-label="Bu hedefin AWX işleri" className="min-w-0">
        {isler.length === 0 ? (
          <p className="text-[12px] leading-5" style={{ color: 'var(--text-secondary)' }}>Bu hedefte henüz AWX işi yok — “Retirement’ı başlat” ön kontrolü başlatır; işler burada listelenir.</p>
        ) : (
          <ul className="max-h-40 space-y-1 overflow-auto lg:max-h-none lg:overflow-visible">
            {isler.map((x) => {
              const a = isAnahtari(x);
              const aktif = !!sec && isAnahtari(sec) === a;
              const d = IS_DURUM[x.durum] || IS_DURUM.bilinmiyor;
              const e = isEtiketi(x, t.webSonuc);
              return (
                <li key={a}>
                  <button type="button" onClick={() => setSecili(a)} aria-current={aktif ? 'true' : undefined} className="grid w-full grid-cols-[0.75rem_minmax(0,1fr)] gap-x-2 rounded-lg px-2.5 py-1.5 text-left focus-visible:outline-offset-2!"
                    style={aktif ? { background: SECILI_ZEMIN, boxShadow: 'inset 2px 0 0 var(--accent)' } : undefined}>
                    <span aria-hidden className={`mt-1.5 h-2 w-2 rounded-full ${d.canli ? 'animate-status-pulse motion-reduce:animate-none' : ''}`} style={{ background: TON[d.ton].renk, color: TON[d.ton].renk }} />
                    <span className="min-w-0">
                      <span className="block truncate text-[12px] font-semibold leading-5" style={{ color: 'var(--text-primary)' }} title={e.ipucu ? `${e.etiket} · ${e.ipucu}` : e.etiket}>{e.etiket}</span>
                      <span className="block text-[11px] leading-4 tabular-nums" style={{ color: 'var(--text-secondary)' }}>
                        #{x.jobId} · {d.etiket}{x.basladi ? ` · ${fmtDateTime(x.basladi)}` : ''}{x.kaynak === 'zamanlayici' ? ' · zamanlayıcı' : ''}
                        {x.sunucuKapali && <span className="font-semibold" style={{ color: 'var(--status-warning-text)' }}> · AWX kapalı</span>}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        <p className="mt-2 text-[11px] leading-4" style={{ color: 'var(--text-secondary)' }}>Her adımın yalnız son işi tutulur. Trafik ölçümü ve vhost planı işleri hedefe kaydedilmez; numaraları Olaylar’da.</p>
        {t.awxIsleriEksik && <p className="mt-1 text-[11px] font-semibold leading-4" style={{ color: 'var(--status-warning-text)' }}>Bazı işler sınıflandırılamadı — Olaylar listesine bakın.</p>}
      </nav>
      <div className="min-w-0 space-y-2">
        {eslesmedi && <UyariKutusu ton="uyari" baslik="İstenen iş bu hedefin iş listesinde yok (sınıflandırılamamış olabilir) — aşağıda listedeki başka bir iş gösteriliyor; Olaylar listesine bakın." />}
        {sec ? <IsGoruntuleyici key={`${isAnahtari(sec)}|${sec.jobId}`} kayitId={kayitId} t={t} is={sec} onbellek={onbellek ?? yerel} onIsBitti={onIsBitti} /> : null}
      </div>
    </div>
  );
}
