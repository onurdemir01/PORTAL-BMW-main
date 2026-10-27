// src/components/nginx_console/yukTesti/KosuCiktisi.tsx — kosunun canli AWX ciktisi (2026-10-27).
//
// Retirement "İş çıktısı" goruntuleyicisinin (server_hub/RetirementIsCiktisi.tsx) yuk testine uyarlanmis KOPYASI:
// oradaki kanca retirementApi'ye bagli; Retirement dosyalari degistirilmedi, saf yardimcilar (retirementCikti.ts)
// ve stil (retirementStil.ts) ortak. Fark: is KOSU KAYDINDAN cozulur (GET /kosular/:id/durum) - sunucu ve is
// numarasi istemciden gitmez; cikti artimli gelir (`since`) ve `ciktiBirlestir` ile eklenir.
//
// YOKLAMA: seri (yanit gelmeden yeni istek yok), AbortController ile iptal, cikti uzadiysa 1,5 sn yoksa 3 sn,
// gecici hatada 3-6-12-24-30 sn geri cekilme ve 6. hatada durma, kalici retde (401/403/404/409) hemen durma,
// sekme gizliyken istek yok. `onBitti` yalniz canli gorulen is bitince BIR kez cagrilir (kaydi yeniden oku).
import React, { useEffect, useRef, useState } from 'react';
import { ArrowPathIcon, ArrowsPointingOutIcon, XMarkIcon } from '@heroicons/react/24/outline';
import AnsibleLogTerminal from '@/components/common/AnsibleLogTerminal';
import { nginxLoadtestApi, type NlDurumYaniti } from '@/api/nginxLoadtestApi';
import { fmtDateTime } from '@/utils/datetime';
import { TBL_BTN, smBtn } from '@/components/server_hub/retirementStil';
import { Cip, UyariKutusu } from '@/components/server_hub/RetirementUi';
import { EN_COK_DENEME, ciktiSonucu, geriCekilme, hataOzeti, redBilgisi, sureMetni, yoklamaGecikmesi } from '@/components/server_hub/retirementCikti';
import { ciktiBirlestir, nedenMetni } from './yukTestiOrtak';

export interface KosuCiktisiDurumu {
  status: string | null;
  bitti: boolean;
  output: string;
  kosuDurum: string | null;
  /** AWX isi tutmuyor / sunucu kapali: cikti Portal arsivinden (ansible_job_output). */
  arsiv: boolean;
  red: { code: string; message: string } | null;
  hata: { deneme: number; sonraSn: number | null; mesaj: string } | null;
  durdu: boolean;
  gizli: boolean;
  sonOkuma: number | null;
  duyuru: string;
}
const BOS: KosuCiktisiDurumu = { status: null, bitti: false, output: '', kosuDurum: null, arsiv: false, red: null, hata: null, durdu: false, gizli: false, sonOkuma: null, duyuru: '' };

/** Kalici retin ekran metni (sunucu mesaji once). */
export function kaliciCiktiMesaji(code: string, message?: string): string {
  if (message) return message;
  switch (code) {
    case 'http_401': return 'Oturum sona erdi — sayfayı yenileyin.';
    case 'http_403': return 'İş çıktısı yalnız yöneticilere açık.';
    case 'http_404': return 'Koşu bulunamadı ya da Portal sunucusu bu ucu sunmuyor.';
    default: return nedenMetni(code) || 'İş çıktısı okunamadı.';
  }
}

export function useKosuCiktisi(kosuId: number, o: { onBitti?: () => void; etiket?: string } = {}) {
  const [d, setD] = useState<KosuCiktisiDurumu>(BOS);
  const [tetik, setTetik] = useState(0);
  const metin = useRef('');
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
    const planla = (ms: number) => { zaman = window.setTimeout(oku, ms); };
    async function oku() {
      if (!canli) return;
      if (typeof document !== 'undefined' && document.hidden) {
        gizliBekliyor = true;
        setD((x) => ({ ...x, gizli: true }));
        return;
      }
      gizliBekliyor = false;
      ac = new AbortController();
      const since = metin.current.length;
      let r: unknown;
      try {
        r = await nginxLoadtestApi.durum(kosuId, since, ac.signal);
      } catch (e) {
        r = e;
      }
      if (!canli) return;
      const sinif = ciktiSonucu(r);
      if (sinif === 'iptal') return;
      if (sinif === 'veri') {
        const v = r as NlDurumYaniti;
        deneme = 0;
        const onceki = metin.current;
        metin.current = ciktiBirlestir(onceki, v.output, since, v.outputOffset);
        const uzadi = metin.current.length > onceki.length;
        if (!v.finished) canliGoruldu.current = true;
        const sonuc = v.status === 'successful' ? 'başarılı' : v.status === 'canceled' ? 'iptal edildi' : v.status ? 'başarısız' : 'bitti';
        const duyuru = v.finished && canliGoruldu.current ? `${geri.current.etiket || 'AWX'} işi bitti: ${sonuc}` : '';
        setD((x) => ({ ...x, status: v.status || null, bitti: !!v.finished, output: metin.current, kosuDurum: v.kosuDurum ?? x.kosuDurum, arsiv: v.kaynak === 'arsiv', red: null, hata: null, durdu: false, gizli: false, sonOkuma: Date.now(), duyuru: duyuru || x.duyuru }));
        if (v.finished) {
          if (canliGoruldu.current && !bildirildi.current) { bildirildi.current = true; geri.current.onBitti?.(); }
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
  }, [kosuId, tetik]);

  /** "Yenile" / "Yeniden dene": ciktiyi bastan okur, deneme sayacini sifirlar. */
  const yenile = () => {
    metin.current = '';
    setD((x) => ({ ...x, hata: null, durdu: false, red: null }));
    setTetik((n) => n + 1);
  };
  return { ...d, yenile };
}

/** Kosunun AWX ciktisi: bilgi seridi, hata ozeti, terminal; "Büyüt" ayni durumla tam ekran (odak tuzagi). */
export default function KosuCiktisi({ kosuId, etiket, awxJobId, basladi, onBitti, yukseklik = 'min(28rem, calc(100dvh - 22rem))' }: {
  kosuId: number; etiket: string; awxJobId?: number | null; basladi?: string | null; onBitti?: () => void; yukseklik?: string;
}) {
  const c = useKosuCiktisi(kosuId, { onBitti, etiket });
  const suruyor = !!c.sonOkuma && !c.bitti;
  const [takip, setTakip] = useState(true);
  const [buyuk, setBuyuk] = useState(false);
  const [simdi, setSimdi] = useState(() => Date.now());
  const buyutRef = useRef<HTMLButtonElement>(null);
  const kapatRef = useRef<HTMLButtonElement>(null);
  const katmanRef = useRef<HTMLDivElement>(null);
  const acildi = useRef(false);
  useEffect(() => {
    if (!suruyor || c.gizli) return;
    const z = window.setInterval(() => setSimdi(Date.now()), 1000);
    return () => window.clearInterval(z);
  }, [suruyor, c.gizli]);
  useEffect(() => {
    if (buyuk) { acildi.current = true; kapatRef.current?.focus(); }
    else if (acildi.current) { acildi.current = false; buyutRef.current?.focus(); }
  }, [buyuk]);

  const bas = basladi ? Date.parse(basladi) : NaN;
  const gecen = Number.isFinite(bas) ? (simdi - bas) / 1000 : null;
  const terminalDurumu = !c.status || c.status === 'new' ? 'pending' : c.status;
  const hataliBitti = c.bitti && (c.status === 'failed' || c.status === 'error');
  const ozet = hataliBitti ? hataOzeti(c.output) : [];
  const baslik = `yuk-testi-${kosuId}${awxJobId ? `-${awxJobId}` : ''}`;

  const serit = (katmanda: boolean) => (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] leading-5" style={{ color: 'var(--text-secondary)' }}>
      <span className="text-[12px] font-semibold" style={{ color: 'var(--text-primary)' }}>{etiket}</span>
      {awxJobId != null && <span className="font-mono tabular-nums">AWX iş #{awxJobId}</span>}
      {basladi && <span className="tabular-nums">başladı {fmtDateTime(basladi)}</span>}
      {suruyor && gecen != null && <span className="tabular-nums">{sureMetni(gecen)} geçti</span>}
      {suruyor && c.sonOkuma != null && <span className="font-semibold tabular-nums" style={{ color: 'var(--accent)' }}><span aria-hidden>●</span> canlı · son okuma {Math.max(0, Math.round((simdi - c.sonOkuma) / 1000))} sn önce</span>}
      {c.gizli && <span>sekme gizli — duraklatıldı</span>}
      {c.arsiv && <Cip title="AWX işi artık tutmuyor ya da sunucu kapalı; çıktı Portal arşivinden">arşivden</Cip>}
      <span className="ml-auto flex flex-wrap items-center gap-1.5">
        {suruyor && <button type="button" onClick={() => setTakip((x) => !x)} className={TBL_BTN} style={smBtn()}>{takip ? 'Takibi durdur' : 'Sona git · takip et'}</button>}
        <button type="button" onClick={c.yenile} className={TBL_BTN} style={smBtn()} title="Çıktıyı baştan yeniden oku"><ArrowPathIcon className="h-3.5 w-3.5" aria-hidden /> Yenile</button>
        {katmanda
          ? <button ref={kapatRef} type="button" onClick={() => setBuyuk(false)} className={TBL_BTN} style={smBtn()} aria-label="Büyütmeyi kapat" title="Kapat (Esc)"><XMarkIcon className="h-3.5 w-3.5" aria-hidden /> Kapat</button>
          : <button ref={buyutRef} type="button" onClick={() => setBuyuk(true)} className={TBL_BTN} style={smBtn()} title="Çıktıyı tam ekranda göster"><ArrowsPointingOutIcon className="h-3.5 w-3.5" aria-hidden /> Büyüt</button>}
      </span>
    </div>
  );

  const bantlar = (
    <>
      {c.red && <UyariKutusu ton="hata" rol="alert" baslik={kaliciCiktiMesaji(c.red.code, c.red.message)} />}
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
          {ozet.length > 0 ? (
            <ol className="mt-1 space-y-0.5 font-mono">
              {ozet.map((x) => (
                <li key={x.satir} className="grid grid-cols-[3rem_minmax(0,1fr)] gap-x-2">
                  <span className="w-12 text-right tabular-nums" style={{ color: 'var(--text-secondary)' }}>{x.satir}</span>
                  <span className="wrap-anywhere" style={{ color: 'var(--text-primary)' }}>{x.metin}</span>
                </li>
              ))}
            </ol>
          ) : <div style={{ color: 'var(--text-secondary)' }}>Çıktıda hata satırı bulunamadı — tamamı aşağıda.</div>}
        </div>
      )}
    </>
  );

  const govde = c.red && !c.output ? null : !c.sonOkuma && !c.output ? (
    <div className="skeleton h-full rounded-xl" aria-busy="true"><span className="sr-only">İş çıktısı yükleniyor…</span></div>
  ) : (
    <AnsibleLogTerminal size="fill" className="h-full" output={c.output} status={terminalDurumu} autoScroll={takip} title={baslik}
      placeholder={c.bitti ? 'AWX bu iş için stdout döndürmedi.' : 'AWX henüz çıktı üretmedi — iş kuyrukta ya da başlıyor…'} />
  );

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
    <div className="min-w-0 space-y-2" data-yuk-cikti>
      {serit(false)}
      {!buyuk && bantlar}
      {govde && (
        <div style={{ height: yukseklik, minHeight: '13rem' }}>
          {buyuk ? <div className="flex h-full items-center justify-center rounded-xl border border-dashed text-[12px]" style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}>Çıktı büyütülmüş görünümde açık.</div> : govde}
        </div>
      )}
      <p className="sr-only" aria-live="polite">{c.duyuru}</p>
      {buyuk && (
        <div className="fixed inset-0 z-[60] flex p-4" style={{ background: 'rgba(0,0,0,.45)' }} onClick={() => setBuyuk(false)}>
          <div ref={katmanRef} role="dialog" aria-modal="true" aria-label={`İş çıktısı — ${etiket}`} className="flex h-full w-full flex-col gap-2 rounded-2xl border p-4" style={{ background: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }}
            onClick={(e) => e.stopPropagation()} onKeyDown={katmanTusu}>
            {serit(true)}
            {bantlar}
            <div className="min-h-0 flex-1">{govde}</div>
          </div>
        </div>
      )}
      {!c.red && <p className="text-[11px] leading-4" style={{ color: 'var(--text-secondary)' }}>Çıktı Portal’da maskelenir. Sayfadan ayrılsanız da iş sürer; Portal sonuçları iş bitince kendisi okur.</p>}
    </div>
  );
}
