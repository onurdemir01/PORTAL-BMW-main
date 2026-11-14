// src/components/nginx_console/yukTesti/CokluKarsilastir.tsx — Yük Testi › "Çoklu karşılaştırma" (2026-11-04).
//
// Kullanici: "testleri birbiriyle karsilastirirken daha anlasilabilir olmasini istiyorum ... ardi ardina 12-16 test
// kosacagim, hepsini tek sayfada karsilastirmak istiyorum". Iki kosulu "Karşılaştır" AYNEN kalir; bu sayfa:
//   1) Kosu secici: bitmis kosular (hedef / tarih / etiket suzgeci), en cok 16; referans (varsayilan en eski). Secim URL'de
//      (?tab=yuktesti&yt=coklu&ref=&kosular=&olcu=&sira=): paylasilabilir, sayfa yenilenince korunur. Gece kuyrugundan
//      "Hepsini karşılaştır" ayni parametrelerle gelir (ref = ilk oge).
//   2) Ozet tablo: satir = kosu; etiket on planda, karar cipi, duz cumle, karar kademesindeki CPU-ms / p95 / bant / bellek
//      farki; siralama (CPU iyilesmesi, p95, etiket, tarih); ref satiri isaretli ve hep ustte.
//   3) Hiz x kosu matrisi (olcu secici): deger + % fark; YALNIZ gurultu disi farklar renkli (sunucunun farkDurumu'su),
//      digerleri soluk; tabular-nums; tablo kendi kabinda yatay kayar, ilk sutun sabit.
//   4) Grafik (CokluGrafik): secili olcu x hiz, kosu basina cizgi, ref kalin; lejant tiklayinca vurgu.
//   5) "CSV indir" (istemcide): ozet + secili olcu matrisi; ';' ayirici, UTF-8 BOM.
// Karsilastirilamayan kosular (farkli hedef / motor / senaryo / tavan / veri yok) ayri grupta, nedeniyle. Farkli protokol /
// keepalive / sikistirma AYNI tabloda: her satirda "Fark" metni (referanstan farkli parca vurgulu) ve sayfa notlari.
// Kosu silme (2026-11-04): adresteki numaralardan biri silinmisse sunucu 409 kosu_yok + `eksik` der; ekran onlari secimden
// ve adresten cikarir (referans gittiyse kalanlarin en eskisi) ve "Silinmiş koşu çıkarıldı: #.." bilgisini gosterir.
// Ayni yanitta on kontrol kaydi (`onKontrol`) ve bitmemis kosu (`bitmemis`) ayri listededir: onlar da cikarilir ama
// "silinmiş" denmez (kendi metinleriyle). Gece kuyrugundan 16'dan fazla kosu gelirse `kuyrukNotu` disarida kalanlari soyler.
import React, { useCallback, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ArrowDownTrayIcon, ArrowPathIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { COKLU_OLCULER, nginxLoadtestApi, type NlCokluAday, type NlCokluHiz, type NlCokluKarsilastirma, type NlCokluOlcu, type NlFark, type NlKosu } from '@/api/nginxLoadtestApi';
import { useAsyncEffect } from '@/hooks/useAsyncEffect';
import { fmtDate, fmtDateTime } from '@/utils/datetime';
import { SM_BTN, TBL_BTN, TH_STIL, TON, smBtn } from '@/components/server_hub/retirementStil';
import { Cip, Hap, UyariKutusu } from '@/components/server_hub/RetirementUi';
import { Alan, Bolum, GIRDI, girdiStili } from './YukUi';
import { NGINXSIZ_KARAR_NOTU, hedefEtiketi, kademeMetni, kararBilgisi, type AdimBirimi } from './yukTestiOrtak';
import CokluGrafik, { type CokluSeri } from './CokluGrafik';
import {
  MAX_COKLU, OLCU_SIRASI, OLCU_TANIM, SIRALAMALAR, csvMetni, cumle, farkParcalari, farkYuzdeMetni, hizBul, hizlarBirlesimi, hucreTonu, karsilastirmaNotlari, kosuEtiketi,
  sirala, urlDurumuOku, urlDurumuYaz, type CokluSiralama, type CokluUrl, type FarkKosu,
} from './cokluKarsilastirma';

const SOLUK = 'var(--text-muted)';
const DURUM_IPUCU: Record<NlFark['durum'], string> = {
  iyi: 'gürültü dışı iyileşme',
  kotu: 'gürültü dışı kötüleşme',
  gurultu_ici: 'gürültü / eşik içinde',
  renklendirilmez: 'bu ölçünün kararda kuralı yok (renklendirilmez)',
  yok: 'bir tarafta ölçülmedi',
};

/** Fark hucresi: yalniz gurultu disi fark renkli. */
export function FarkMetni({ f, ipucu }: { f: NlFark | null | undefined; ipucu?: string }) {
  const ton = hucreTonu(f);
  const metin = f ? farkYuzdeMetni(f.yuzde) : '—';
  const esik = f && f.esikYuzde != null ? ` · eşik %${Math.round(f.esikYuzde * 10) / 10}` : '';
  const gb = f?.gurultuBilinmiyor ? ' · referansta tek tekrar: gürültü bilinmiyor' : '';
  return (
    <span className="tabular-nums" data-ton={ton ?? 'soluk'} style={{ color: ton ? TON[ton].metin : SOLUK, fontWeight: ton ? 600 : 400 }}
      title={`${ipucu ? `${ipucu} · ` : ''}${f ? DURUM_IPUCU[f.durum] : 'ölçülmedi'}${esik}${gb}`}>{metin}</span>
  );
}

type Cikarilan = { silinmis: number[]; onKontrol: number[]; bitmemis: number[] };
const BOS_CIKARILAN: Cikarilan = { silinmis: [], onKontrol: [], bitmemis: [] };
const CIKARMA_METNI: Record<keyof Cikarilan, { baslik: string; govde: string }> = {
  silinmis: { baslik: 'Silinmiş koşu çıkarıldı', govde: 'Bu numaralar Portal’da bulunamadı (silinmiş olabilir); seçimden ve adresten çıkarıldı.' },
  onKontrol: { baslik: 'Ön kontrol kaydı çıkarıldı', govde: 'Ön kontrol yük üretmez, karşılaştırılmaz; seçimden ve adresten çıkarıldı.' },
  bitmemis: { baslik: 'Bitmemiş koşu çıkarıldı', govde: 'Koşu henüz sürüyor (adımları yarım); seçimden ve adresten çıkarıldı. Bitince yeniden seçin.' },
};

export interface KuyrukNotu { alinan: number; disarida: number[] }

export default function CokluKarsilastir({ kuyrukNotu = null, onKuyrukNotuKapat }: { kuyrukNotu?: KuyrukNotu | null; onKuyrukNotuKapat?: () => void } = {}) {
  const [sp, setSp] = useSearchParams();
  const durum = useMemo(() => urlDurumuOku(sp), [sp]);
  const yaz = useCallback((d: Partial<CokluUrl>) => setSp((onceki) => urlDurumuYaz(onceki, { ...urlDurumuOku(onceki), ...d }), { replace: true }), [setSp]);

  const [kosular, setKosular] = useState<NlKosu[] | null>(null);
  const [listeHata, setListeHata] = useState('');
  const [hedef, setHedef] = useState('');
  const [tarihten, setTarihten] = useState('');
  const [arama, setArama] = useState('');
  const [veri, setVeri] = useState<NlCokluKarsilastirma | null>(null);
  const [hata, setHata] = useState('');
  const [bekliyor, setBekliyor] = useState(false);
  const [vurgu, setVurgu] = useState<number | null>(null);
  const [cikarilan, setCikarilan] = useState<Cikarilan>(BOS_CIKARILAN);
  const istekNo = useRef(0);

  const yukle = useCallback(async () => {
    try {
      const r = await nginxLoadtestApi.kosular({ islem: 'kosu', durum: 'DONE', limit: 200 });
      setKosular((r.kosular || []).filter((k) => k.islem === 'kosu'));
      setListeHata('');
    } catch (e) {
      setListeHata(e instanceof Error ? e.message : String(e));
    }
  }, []);
  useAsyncEffect(async (alive) => { if (alive()) await yukle(); }, [yukle]);

  const byId = useMemo(() => new Map((kosular || []).map((k) => [k.id, k])), [kosular]);
  /** En eski secili kosu (tarih, yoksa numara): varsayilan referans. */
  const enEski = (ids: number[]) => [...ids].sort((a, b) => {
    const ta = byId.get(a)?.createdAt; const tb = byId.get(b)?.createdAt;
    return (ta && tb ? Date.parse(ta) - Date.parse(tb) : 0) || a - b;
  })[0] ?? null;
  const anahtar = `${durum.ref}|${durum.kosular.join(',')}`;
  useAsyncEffect(async (alive) => {
    const ref = durum.ref;
    const adaylar = durum.kosular.filter((x) => x !== ref);
    if (ref == null || !adaylar.length) { setVeri(null); setHata(''); return; }
    const no = ++istekNo.current;
    setBekliyor(true);
    try {
      const r = await nginxLoadtestApi.karsilastirCoklu({ ref, kosular: adaylar });
      if (alive() && no === istekNo.current) { setVeri(r); setHata(''); }
    } catch (e) {
      if (alive() && no === istekNo.current) {
        const x = (e && typeof e === 'object' ? e : {}) as { code?: string; eksik?: unknown; onKontrol?: unknown; bitmemis?: unknown };
        const uygun = x.code === 'kosu_yok' || x.code === 'kosu_uygun_degil';
        const sayilar = (v: unknown) => (uygun && Array.isArray(v) ? v.filter((n): n is number => typeof n === 'number' && durum.kosular.includes(n)) : []);
        const grup: Cikarilan = { silinmis: sayilar(x.eksik), onKontrol: sayilar(x.onKontrol), bitmemis: sayilar(x.bitmemis) };
        const cikar = [...grup.silinmis, ...grup.onKontrol, ...grup.bitmemis];
        const kalan = durum.kosular.filter((id) => !cikar.includes(id));
        setVeri(null);
        if (cikar.length && kalan.length < durum.kosular.length) {
          // Bulunamayan / on kontrol / bitmemis kosular secimden ve adresten cikar; referans gittiyse kalanlarin en eskisi.
          const birles = (a: number[], b: number[]) => [...new Set([...a, ...b])];
          setCikarilan((c) => ({ silinmis: birles(c.silinmis, grup.silinmis), onKontrol: birles(c.onKontrol, grup.onKontrol), bitmemis: birles(c.bitmemis, grup.bitmemis) }));
          setHata('');
          yaz({ kosular: kalan, ref: ref != null && kalan.includes(ref) ? ref : enEski(kalan) });
        } else setHata(e instanceof Error ? e.message : String(e));
      }
    } finally {
      if (no === istekNo.current) setBekliyor(false);
    }
  }, [anahtar]);

  const secili = durum.kosular;
  const hedefler = useMemo(() => [...new Set((kosular || []).map(hedefEtiketi).filter(Boolean))].sort((a, b) => a.localeCompare(b)), [kosular]);
  const q = arama.trim().toLocaleLowerCase('tr');
  const liste = (kosular || []).filter((k) => (!hedef || hedefEtiketi(k) === hedef)
    && (!tarihten || (k.createdAt != null && k.createdAt.slice(0, 10) >= tarihten))
    && (!q || `${k.etiket || ''} #${k.id} ${k.senaryoAd || ''}`.toLocaleLowerCase('tr').includes(q)));
  const degistir = (id: number, ekle: boolean) => {
    const yeni = ekle ? (secili.includes(id) || secili.length >= MAX_COKLU ? secili : [...secili, id]) : secili.filter((x) => x !== id);
    const ref = durum.ref != null && yeni.includes(durum.ref) ? durum.ref : enEski(yeni);
    yaz({ kosular: yeni, ref });
  };
  const doldu = secili.length >= MAX_COKLU;

  const sirali = useMemo(() => (veri ? sirala(veri.adaylar, durum.sira) : []), [veri, durum.sira]);
  const birim: AdimBirimi = veri?.ref.motor === 'wrk' ? 'bağlantı' : 'istek/sn';
  const hizlar = veri ? hizlarBirlesimi(veri) : [];
  const olcu = durum.olcu;
  const seriler: CokluSeri[] = veri ? [
    { id: veri.ref.id, ad: kosuEtiketi(veri.ref), ref: true, noktalar: veri.ref.hizlar.map((h) => ({ x: h.hiz, y: h[olcu] })) },
    // Renk kosuya bagli: sunucunun aday sirasi (siralama degisince renk degismez).
    ...veri.adaylar.map((a) => ({ id: a.id, ad: kosuEtiketi(a), ref: false, noktalar: a.hizlar.map((h) => ({ x: h.hiz, y: h[olcu] })) })),
  ] : [];
  const gorunenOlculer = OLCU_SIRASI.filter((o) => COKLU_OLCULER.includes(o));

  function csvIndir() {
    if (!veri) return;
    const metin = csvMetni(veri, olcu, sirali);
    try {
      const url = URL.createObjectURL(new Blob([metin], { type: 'text/csv;charset=utf-8' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `yuk-testi-coklu-R${veri.ref.id}-${olcu}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch { /* tarayici indirmeyi desteklemiyor */ }
  }

  return (
    <div className="space-y-4" data-coklu-karsilastirma>
      <Bolum baslik="Çoklu karşılaştırma" aciklama={`En çok ${MAX_COKLU} koşu: her biri referansa göre aynı kuralla (eşik ya da 3 × gürültü) değerlendirilir. Seçim adres çubuğunda saklanır; bağlantıyı paylaşabilirsiniz.`}>
        {listeHata && <div className="mb-3"><UyariKutusu ton="hata" rol="alert" baslik="Koşular okunamadı">{listeHata}</UyariKutusu></div>}
        <div className="grid gap-3 @lg/yuk:grid-cols-3">
          <Alan id="coklu-hedef" etiket="Hedef">
            <select id="coklu-hedef" value={hedef} onChange={(e) => setHedef(e.target.value)} className={GIRDI} style={girdiStili()}>
              <option value="">Tüm hedefler</option>{hedefler.map((h) => <option key={h} value={h}>{h}</option>)}
            </select>
          </Alan>
          <Alan id="coklu-tarih" etiket="Bu tarihten sonra">
            <input id="coklu-tarih" type="date" value={tarihten} onChange={(e) => setTarihten(e.target.value)} className={GIRDI} style={girdiStili()} />
          </Alan>
          <Alan id="coklu-ara" etiket="Etiket ara">
            <input id="coklu-ara" value={arama} onChange={(e) => setArama(e.target.value)} placeholder="ör. brotli, K3" className={GIRDI} style={girdiStili()} />
          </Alan>
        </div>
        {secili.length > 0 && (
          <div className="mt-3 space-y-1.5">
            <div className="flex flex-wrap items-center gap-2 text-[12px]" style={{ color: 'var(--text-secondary)' }}>
              <span className="font-semibold tabular-nums" style={{ color: 'var(--text-primary)' }}>{`Seçili ${secili.length} / ${MAX_COKLU}`}</span>
              <span>Referans: hangi koşuya göre karşılaştırılacağını seçin (varsayılan en eskisi).</span>
              <button type="button" className={`${TBL_BTN} ml-auto`} style={smBtn()} onClick={() => yaz({ kosular: [], ref: null })}>Seçimi temizle</button>
            </div>
            <ul className="flex flex-wrap gap-1.5" aria-label="Seçili koşular">
              {secili.map((id) => {
                const k = byId.get(id);
                const ad = k ? kosuEtiketi(k) : `#${id}`;
                const ref = durum.ref === id;
                return (
                  <li key={id} className="flex items-center gap-1 rounded-lg px-2 py-1 text-[12px]" style={{ background: ref ? TON.aksan.zemin : 'var(--bg-elevated)', boxShadow: ref ? `inset 0 0 0 1px ${TON.aksan.kenar}` : undefined, color: 'var(--text-primary)' }}>
                    <label className="flex items-center gap-1" title="Referans yap">
                      <input type="radio" name="coklu-ref" checked={ref} onChange={() => yaz({ ref: id })} aria-label={`${ad} referans`} />
                      <span className="max-w-[14rem] truncate font-medium" title={ad}>{ad}</span>
                    </label>
                    {ref && <span className="text-[11px] font-semibold" style={{ color: TON.aksan.metin }}>referans</span>}
                    <button type="button" onClick={() => degistir(id, false)} aria-label={`${ad} seçimden çıkar`} className="rounded" style={{ color: 'var(--text-secondary)' }}><XMarkIcon className="h-3.5 w-3.5" aria-hidden /></button>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
        {doldu && <p className="mt-2 text-[11px]" role="status" style={{ color: 'var(--status-warning-text)' }}>{`En çok ${MAX_COKLU} koşu seçilebilir; yenisini eklemek için birini çıkarın.`}</p>}
        <div className="mt-3 max-h-72 overflow-y-auto rounded-lg border" style={{ borderColor: 'var(--border-subtle)' }}>
          {kosular == null && !listeHata ? (
            <div className="skeleton m-3 h-12 rounded-lg" aria-busy="true"><span className="sr-only">Koşular yükleniyor…</span></div>
          ) : !liste.length ? (
            <p className="px-3 py-3 text-[12px]" style={{ color: 'var(--text-secondary)' }}>{kosular?.length ? 'Süzgece uyan koşu yok.' : 'Henüz bitmiş koşu yok.'}</p>
          ) : (
            <ul className="divide-y" style={{ borderColor: 'var(--border-subtle)' }} aria-label="Bitmiş koşular">
              {liste.map((k) => {
                const isaretli = secili.includes(k.id);
                return (
                  <li key={k.id}>
                    <label className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-[12px]" style={{ color: 'var(--text-primary)', opacity: !isaretli && doldu ? 0.5 : 1 }}>
                      <input type="checkbox" checked={isaretli} disabled={!isaretli && doldu} onChange={(e) => degistir(k.id, e.target.checked)} aria-label={`${kosuEtiketi(k)} seç`} />
                      <span className="min-w-0 flex-1 truncate font-medium">{k.etiket || <span style={{ color: 'var(--text-muted)' }}>etiketsiz</span>}</span>
                      <span className="font-mono tabular-nums" style={{ color: 'var(--text-secondary)' }}>#{k.id}</span>
                      <span className="hidden truncate font-mono @lg/yuk:inline" style={{ color: 'var(--text-secondary)' }} title={hedefEtiketi(k)}>{hedefEtiketi(k)}</span>
                      <span className="tabular-nums" style={{ color: 'var(--text-muted)' }} title={fmtDateTime(k.createdAt)}>{fmtDate(k.createdAt)}</span>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        {secili.length === 1 && <p className="mt-2 text-[11px]" style={{ color: 'var(--text-secondary)' }}>Referansın yanında en az bir koşu daha seçin.</p>}
      </Bolum>

      {kuyrukNotu && kuyrukNotu.disarida.length > 0 && (
        <UyariKutusu ton="uyari" rol="status" baslik={`Gece kuyruğundan ilk ${kuyrukNotu.alinan} koşu alındı; ${kuyrukNotu.disarida.length} koşu dışarıda kaldı`}
          eylem={onKuyrukNotuKapat && <button type="button" className={TBL_BTN} style={smBtn()} onClick={onKuyrukNotuKapat}>Kapat</button>}>
          {`Çoklu karşılaştırma en çok ${MAX_COKLU} koşu gösterir (referans dahil). Dışarıda kalanlar: ${kuyrukNotu.disarida.map((id) => `#${id}`).join(', ')}. Görmek için seçimden birini çıkarıp listeden ekleyin.`}
        </UyariKutusu>
      )}
      {(Object.keys(CIKARMA_METNI) as (keyof Cikarilan)[]).filter((t) => cikarilan[t].length > 0).map((t) => (
        <UyariKutusu key={t} ton="bilgi" rol="status" baslik={`${CIKARMA_METNI[t].baslik}: ${cikarilan[t].map((id) => `#${id}`).join(', ')}`}
          eylem={<button type="button" className={TBL_BTN} style={smBtn()} onClick={() => setCikarilan((c) => ({ ...c, [t]: [] }))}>Kapat</button>}>
          {CIKARMA_METNI[t].govde}
        </UyariKutusu>
      ))}
      {hata && <UyariKutusu ton="hata" rol="alert" baslik="Karşılaştırılamadı">{hata}</UyariKutusu>}
      {bekliyor && !veri && <div className="skeleton h-40 rounded-xl" aria-busy="true"><span className="sr-only">Hesaplanıyor…</span></div>}
      {veri && (
        <>
          <Bolum baslik="Özet" aciklama={`Her satır referansa göre (karar kademesinde). Renkli fark = eşiği ya da 3 × gürültüyü aşan fark (CPU eşiği %${veri.esikler.esikCpu}, p95 eşiği %${veri.esikler.esikP95}, kötüleşme eşiği %${veri.esikler.esikZarar}); soluk = gürültü içinde ya da kuralı yok.`}
            eylem={(
              <>
                <label className="flex items-center gap-1.5 text-[11px]" style={{ color: 'var(--text-secondary)' }}>Sırala
                  <select aria-label="Sıralama" value={durum.sira} onChange={(e) => yaz({ sira: e.target.value as CokluSiralama })} className={`${GIRDI} h-7 w-40`} style={girdiStili()}>
                    {SIRALAMALAR.map((s) => <option key={s.id} value={s.id}>{s.ad}</option>)}
                  </select>
                </label>
                <button type="button" className={SM_BTN} style={smBtn()} onClick={csvIndir}><ArrowDownTrayIcon className="h-3.5 w-3.5" aria-hidden /> CSV indir</button>
                {bekliyor && <ArrowPathIcon className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-label="Hesaplanıyor" />}
              </>
            )} govdeSinifi="p-0">
            {karsilastirmaNotlari(veri).map((n) => <p key={n} data-coklu-not className="border-b px-4 py-2 text-[12px]" style={{ borderColor: 'var(--border-subtle)', color: 'var(--status-warning-text)' }}>{n}</p>)}
            <div className="overflow-x-auto">
              <table className="w-full min-w-[66rem] border-collapse text-[12px]" aria-label="Özet karşılaştırma">
                <thead><tr>
                  {['Koşu', 'Fark', 'Karar', 'Ne oldu?'].map((b) => <th key={b} scope="col" className="px-3 py-1.5 text-left text-[11px]" style={TH_STIL}>{b}</th>)}
                  <th scope="col" className="px-3 py-1.5 text-right text-[11px]" style={TH_STIL} title={OLCU_TANIM.cpuMsIstek.ipucu}>İstek başına CPU</th>
                  <th scope="col" className="px-3 py-1.5 text-right text-[11px]" style={TH_STIL} title={OLCU_TANIM.p95.ipucu}>Yanıt süresi (p95)</th>
                  <th scope="col" className="px-3 py-1.5 text-right text-[11px]" style={TH_STIL} title={OLCU_TANIM.bantBps.ipucu}>Test trafiği</th>
                  <th scope="col" className="px-3 py-1.5 text-right text-[11px]" style={TH_STIL} title={OLCU_TANIM.bellekMb.ipucu}>Nginx belleği</th>
                </tr></thead>
                <tbody style={{ color: 'var(--text-primary)' }}>
                  <tr className="border-t align-top" data-ref-satiri style={{ borderColor: 'var(--border-subtle)', background: TON.aksan.zemin }}>
                    <td className="px-3 py-2"><KosuHucre k={veri.ref} /></td>
                    <td className="px-3 py-2"><KosuFarki k={veri.ref} referans={veri.ref} /></td>
                    <td className="px-3 py-2"><Hap label="REFERANS" ton="aksan" /></td>
                    <td className="px-3 py-2" style={{ color: 'var(--text-secondary)' }}>Diğer koşular buna göre karşılaştırılır.</td>
                    <td colSpan={4} />
                  </tr>
                  {sirali.map((a) => <OzetSatiri key={a.id} a={a} birim={birim} referans={veri.ref} />)}
                </tbody>
              </table>
            </div>
            {veri.karsilastirilamaz.length > 0 && (
              <div className="border-t px-4 py-3" style={{ borderColor: 'var(--border-subtle)' }} data-karsilastirilamaz>
                <h4 className="mb-1 text-[12px] font-semibold" style={{ color: 'var(--text-primary)' }}>{`Karşılaştırılamaz (${veri.karsilastirilamaz.length})`}</h4>
                <ul className="space-y-1 text-[12px]">
                  {veri.karsilastirilamaz.map((k) => (
                    <li key={k.id} className="flex flex-wrap gap-x-2" style={{ color: 'var(--text-secondary)' }}>
                      <span className="font-medium" style={{ color: 'var(--text-primary)' }}>{kosuEtiketi(k)}</span><span className="font-mono">#{k.id}</span>
                      <KosuFarki k={k} referans={veri.ref} />
                      <span>{k.nedenler.map((n) => n.metin).join(' ')}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </Bolum>

          <Bolum baslik="Hız × koşu" aciklama="Hücrede değer ve referansa göre fark. Yalnız gürültü dışı farklar renkli (yeşil iyileşme, kırmızı kötüleşme); diğerleri soluk.">
            <div role="radiogroup" aria-label="Ölçü" className="mb-3 flex flex-wrap gap-1 rounded-lg p-0.5" style={{ background: 'var(--bg-elevated)' }}>
              {gorunenOlculer.map((o) => (
                <button key={o} type="button" role="radio" aria-checked={olcu === o} title={OLCU_TANIM[o].ipucu} onClick={() => yaz({ olcu: o })}
                  className={`h-7 rounded-md px-2.5 text-[11px] font-medium ${olcu === o ? 'shadow-sm' : ''}`}
                  style={olcu === o ? { background: 'var(--bg-surface)', color: 'var(--text-primary)', boxShadow: 'inset 0 0 0 1px var(--border)' } : { color: 'var(--text-secondary)' }}>{OLCU_TANIM[o].ad}</button>
              ))}
            </div>
            <div className="overflow-x-auto rounded-lg border" style={{ borderColor: 'var(--border-subtle)' }}>
              <table className="border-collapse text-[12px]" style={{ minWidth: `${14 + hizlar.length * 8}rem` }} aria-label={`${OLCU_TANIM[olcu].ad} matrisi`}>
                <thead><tr>
                  <th scope="col" className="sticky left-0 z-[2] px-3 py-1.5 text-left text-[11px]" style={{ ...TH_STIL, minWidth: '14rem' }}>Koşu</th>
                  {hizlar.map((h) => <th key={h} scope="col" className="px-3 py-1.5 text-right text-[11px] tabular-nums" style={TH_STIL}>{kademeMetni(h, birim)}</th>)}
                </tr></thead>
                <tbody style={{ color: 'var(--text-primary)' }}>
                  <MatrisSatiri ad={kosuEtiketi(veri.ref)} id={veri.ref.id} hizlar={hizlar} veri={veri.ref.hizlar} olcu={olcu} fark={<KosuFarki k={veri.ref} referans={veri.ref} />} referans />
                  {sirali.map((a) => <MatrisSatiri key={a.id} ad={kosuEtiketi(a)} id={a.id} hizlar={hizlar} veri={a.hizlar} olcu={olcu} fark={<KosuFarki k={a} referans={veri.ref} />} />)}
                </tbody>
              </table>
            </div>
          </Bolum>

          <Bolum baslik="Grafik" aciklama="Seçili ölçü × hız. Referans kalın çizgi; lejantta bir koşuya tıklayınca vurgulanır.">
            <CokluGrafik seriler={seriler} olcu={olcu} xBirimi={birim} vurgu={vurgu} setVurgu={setVurgu} />
          </Bolum>
        </>
      )}
    </div>
  );
}

/** Kosu hucresi; nginx olmayan hedefte (meta nginx false, 2026-11-13) "nginx yok" cipi: o satirin karari CPU'suz. */
function KosuHucre({ k }: { k: { id: number; etiket: string | null; createdAt: string | null; nginx?: false } }) {
  return (
    <div className="min-w-0">
      <div className="flex min-w-0 items-center gap-1.5">
        <span className="min-w-0 truncate font-semibold" title={k.etiket || undefined}>{kosuEtiketi(k)}</span>
        {k.nginx === false && <Cip ton="uyari" cerceve title={NGINXSIZ_KARAR_NOTU}>nginx yok</Cip>}
      </div>
      <div className="text-[11px] tabular-nums" style={{ color: 'var(--text-muted)' }}>{`#${k.id} · ${fmtDateTime(k.createdAt)}`}</div>
    </div>
  );
}

/** "Fark" metni: HTTP/2 · keepalive · brotli 6 · static; referanstan farkli parca vurgulu. */
function KosuFarki({ k, referans }: { k: FarkKosu; referans: FarkKosu }) {
  return (
    <span className="text-[11px]" data-kosu-farki style={{ color: 'var(--text-secondary)' }}>
      {farkParcalari(k, referans).map((p, i) => (
        <React.Fragment key={p.tur}>
          {i > 0 && ' · '}
          <span data-farkli={p.farkli ? p.tur : undefined} style={p.farkli ? { color: TON.aksan.metin, fontWeight: 600 } : undefined}>{p.metin}</span>
        </React.Fragment>
      ))}
    </span>
  );
}

function OzetSatiri({ a, birim, referans }: { a: NlCokluAday; birim: AdimBirimi; referans: FarkKosu }) {
  const kb = kararBilgisi(a.karar);
  const kf = a.kademeFarki;
  const hucre = (x: typeof kf.cpu, o: NlCokluOlcu) => {
    const t = OLCU_TANIM[o];
    return (
      <td className="px-3 py-2 text-right">
        <FarkMetni f={x} ipucu={x ? `${kademeMetni(x.hiz, birim)}: ${t.metin(x.ref)} → ${t.metin(x.aday)}` : undefined} />
        {x && <div className="text-[11px] tabular-nums" style={{ color: SOLUK }}>{t.metin(x.aday)}</div>}
      </td>
    );
  };
  return (
    <tr className="border-t align-top" style={{ borderColor: 'var(--border-subtle)' }} data-aday={a.id}>
      <td className="px-3 py-2"><KosuHucre k={a} /></td>
      <td className="px-3 py-2"><KosuFarki k={a} referans={referans} /></td>
      <td className="px-3 py-2"><Hap label={kb.etiket} ton={kb.ton} title={kb.aciklama} /></td>
      <td className="px-3 py-2" data-cumle title={a.kararNedenleri.join('\n')}>{cumle(a)}</td>
      {hucre(kf.cpu, 'cpuMsIstek')}
      {hucre(kf.p95, 'p95')}
      {hucre(kf.bant, 'bantBps')}
      {hucre(kf.bellek, 'bellekMb')}
    </tr>
  );
}

function MatrisSatiri({ ad, id, hizlar, veri, olcu, fark, referans = false }: { ad: string; id: number; hizlar: number[]; veri: NlCokluHiz[]; olcu: NlCokluOlcu; fark: React.ReactNode; referans?: boolean }) {
  const t = OLCU_TANIM[olcu];
  return (
    <tr className="border-t align-top" style={{ borderColor: 'var(--border-subtle)' }} data-matris={id}>
      <th scope="row" className="sticky left-0 z-[1] px-3 py-1.5 text-left font-medium" style={{ background: referans ? 'var(--bg-elevated)' : 'var(--bg-surface)', minWidth: '14rem' }}>
        <span className="block max-w-[16rem] truncate" title={ad}>{ad}</span>
        <span className="text-[11px] font-normal tabular-nums" style={{ color: 'var(--text-muted)' }}>{`#${id}${referans ? ' · referans' : ''}`}</span>
        <span className="block font-normal">{fark}</span>
      </th>
      {hizlar.map((h) => {
        const x = hizBul(veri, h);
        const v = x ? x[olcu] : null;
        const f = x?.fark?.[olcu];
        const kip = x && x.kip === 'uyari' ? ' · kip doğrulaması uyarı verdi' : '';
        const tekrar = x ? ` · ${x.gecerliTekrar ?? '?'} / ${x.tekrar ?? '?'} geçerli tekrar` : '';
        const kaynak = olcu === 'bellekMb' && x?.bellekKaynak ? ` · ${x.bellekKaynak.toUpperCase()}` : '';
        return (
          <td key={h} className="px-3 py-1.5 text-right tabular-nums" title={x ? `${t.metin(v)}${kaynak}${tekrar}${kip}` : 'bu hızda koşulmadı'}>
            <div className="whitespace-nowrap">{x ? t.metin(v) : '—'}</div>
            {!referans && <div className="text-[11px]">{x ? <FarkMetni f={f} /> : <span style={{ color: SOLUK }}>—</span>}</div>}
          </td>
        );
      })}
    </tr>
  );
}
