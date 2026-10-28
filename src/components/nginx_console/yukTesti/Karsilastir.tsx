// src/components/nginx_console/yukTesti/Karsilastir.tsx — iki koşunun karari (2026-10-27).
//
// Referans (degisiklikten once) ve aday (degisiklikten sonra) koşu secilir; karar sunucuda analiz.cjs
// kararVer ile verilir (karsilastir.py karar_ver portu): KALICI / NÖTR / RET / GEÇERSİZ / VERİ YOK / DOYMA.
// CPU kademesi ortak hizlarin ortasi, p95 kademesi en yuksek ortak hiz. Esikler yuzde; gurultu x3 kurali sunucuda.
//
// TUR 3 (2026-10-28): hedef etiketi `hedefHost ?? hedefIp` (serbest hedefte host yok). Karar oncesi uyarilar:
// farkli yuk araci (k6 / wrk: VERI YOK), farkli is parcacigi (iki wrk kosusu; parametreler kosu ayrintisindan
// okunur, liste satirinda yok), serbest hedef (CPU yok: KALICI verilmez). Kademe birimi motorla (wrk: baglanti).
// CPU olculmediyse (serbest taraf ya da analizin CPU'suz karar yolu) karar basliginda "CPU kademesi" yazilmaz.
// Inceleme SA2 (2026-10-28): iki wrk kosusunun hiz tavani (parametreler.tavan_rps) farkliysa uyari: baglanti basina
// bekleme ceil(N x 1000 / tavan) oldugundan ayni baglanti kademesi farkli yuktur (sunucu bu durumda VERI YOK doner).
import React, { useCallback, useMemo, useRef, useState } from 'react';
import { ArrowsRightLeftIcon } from '@heroicons/react/24/outline';
import { nginxLoadtestApi, sayiVeya, type NlKarsilastirma, type NlKosu } from '@/api/nginxLoadtestApi';
import { useAsyncEffect } from '@/hooks/useAsyncEffect';
import { TableEmptyRow } from '@/components/common/EmptyState';
import { fmtDate, fmtNumber } from '@/utils/datetime';
import { SM_BTN, TH_STIL, TON, smBtn } from '@/components/server_hub/retirementStil';
import { Hap, UyariKutusu } from '@/components/server_hub/RetirementUi';
import { Alan, Bolum, GIRDI, girdiStili } from './YukUi';
import { farkMetni, gecerlilikBilgisi, hedefEtiketi, kademeMetni, kararBilgisi, ondalik, yuzde, type AdimBirimi } from './yukTestiOrtak';

/** Tabloda gosterilen olculer (analiz.cjs FARK_ALANLARI'ndan); `iyi`: dusuk olan iyi mi. */
const OLCULER: { k: string; ad: string; basamak: number; oran?: boolean; dusukIyi: boolean }[] = [
  { k: 'cpu_ms_istek', ad: 'CPU-ms/istek', basamak: 3, dusukIyi: true },
  { k: 'p95', ad: 'p95 ms', basamak: 1, dusukIyi: true },
  { k: 'p99', ad: 'p99 ms', basamak: 1, dusukIyi: true },
  { k: 'hata_orani', ad: 'Hata', basamak: 3, oran: true, dusukIyi: true },
  { k: 'host_cpu_ort', ad: 'Host CPU %', basamak: 0, dusukIyi: true },
];
/** Secici metni; gecerlilik GECERLILIK tablosunun Turkce etiketiyle ("kısmen geçerli"; ham kod "kismi" DEGIL). */
const kosuEtiketi = (k: NlKosu) => `#${k.id}${k.etiket ? ` · ${k.etiket}` : ''} · ${hedefEtiketi(k)}${k.hedefTuru === 'serbest' ? ' (serbest)' : ''}${k.motor === 'wrk' ? ' · wrk' : ''} · ${fmtDate(k.createdAt)}${k.gecerlilik && k.gecerlilik !== 'GECERLI' ? ` · ${gecerlilikBilgisi(k.gecerlilik)?.etiket}` : ''}`;
const motorAdi = (k: NlKosu) => (k.motor === 'wrk' ? 'wrk' : 'k6');

export default function Karsilastir() {
  const [kosular, setKosular] = useState<NlKosu[] | null>(null);
  const [listeHata, setListeHata] = useState('');
  const [ref, setRef] = useState('');
  const [aday, setAday] = useState('');
  const [esikCpu, setEsikCpu] = useState('10');
  const [esikP95, setEsikP95] = useState('10');
  const [sonuc, setSonuc] = useState<NlKarsilastirma | null>(null);
  const [hata, setHata] = useState('');
  const [bekliyor, setBekliyor] = useState(false);
  // wrk kosularinin is parcacigi sayisi ve hiz tavani (liste satirinda parametre yok; ayrintidan bir kez okunur).
  // null: okunamadi (uyari gosterilmez).
  const [wrkParam, setWrkParam] = useState<Record<number, { isParcacigi: number | null; tavanRps: number | null }>>({});
  const istekNo = useRef(0);

  const yukle = useCallback(async () => {
    try {
      // Sunucu suzer (on kontroller ve bitmemis kosular 200'luk pencereyi doldurmasin); istemci suzgeci yedek.
      const r = await nginxLoadtestApi.kosular({ islem: 'kosu', durum: 'DONE', limit: 200 });
      setKosular((r.kosular || []).filter((k) => k.islem === 'kosu' && k.durum === 'DONE'));
      setListeHata('');
    } catch (e) {
      setListeHata(e instanceof Error ? e.message : String(e));
    }
  }, []);
  useAsyncEffect(async (alive) => { if (alive()) await yukle(); }, [yukle]);

  const refK = kosular?.find((k) => String(k.id) === ref) ?? null;
  const adayK = kosular?.find((k) => String(k.id) === aday) ?? null;
  const ikisiWrk = !!refK && !!adayK && refK.motor === 'wrk' && adayK.motor === 'wrk';
  // Iki wrk kosusu secildiyse is parcacigi ve hiz tavani ayrintidan okunur (karar oncesi uyari icin; karar sunucuda).
  useAsyncEffect(async (alive) => {
    if (!ikisiWrk || !refK || !adayK) return;
    for (const id of [refK.id, adayK.id]) {
      if (id in wrkParam) continue;
      let w: { isParcacigi: number | null; tavanRps: number | null } = { isParcacigi: null, tavanRps: null };
      try {
        const p = (await nginxLoadtestApi.kosu(id)).kosu.parametreler;
        w = { isParcacigi: sayiVeya(p?.is_parcacigi), tavanRps: sayiVeya(p?.tavan_rps) };
      } catch { /* uyari gosterilmez; karar sunucuda yine VERI YOK der */ }
      if (!alive()) return;
      setWrkParam((m) => ({ ...m, [id]: w }));
    }
  }, [ikisiWrk, refK?.id, adayK?.id]);
  const esik = (s: string) => (/^\d{1,2}(\.\d+)?$/.test(s.trim()) && Number(s) > 0 && Number(s) <= 50 ? Number(s) : null);
  const hazir = !!refK && !!adayK && refK.id !== adayK.id && esik(esikCpu) != null && esik(esikP95) != null;
  // Hedef karsilastirmasi etiketle (serbestte host yok: IP) ve hedef turuyla.
  const farkliOrtam = refK && adayK && (hedefEtiketi(refK) !== hedefEtiketi(adayK) || refK.hedefTuru !== adayK.hedefTuru || refK.vhost !== adayK.vhost || refK.senaryoId !== adayK.senaryoId);
  const farkliMotor = !!refK && !!adayK && motorAdi(refK) !== motorAdi(adayK);
  const wRef = refK ? wrkParam[refK.id] : undefined;
  const wAday = adayK ? wrkParam[adayK.id] : undefined;
  const farkliIsParcacigi = ikisiWrk && wRef?.isParcacigi != null && wAday?.isParcacigi != null && wRef.isParcacigi !== wAday.isParcacigi;
  const farkliTavan = ikisiWrk && wRef?.tavanRps != null && wAday?.tavanRps != null && wRef.tavanRps !== wAday.tavanRps;
  const serbestVar = !!refK && !!adayK && (refK.hedefTuru === 'serbest' || adayK.hedefTuru === 'serbest');

  async function karsilastir() {
    if (!refK || !adayK || !hazir) return;
    const no = ++istekNo.current;
    setBekliyor(true);
    setHata('');
    try {
      const r = await nginxLoadtestApi.karsilastir({ ref: refK.id, aday: adayK.id, esikCpu: esik(esikCpu) as number, esikP95: esik(esikP95) as number });
      if (no === istekNo.current) setSonuc(r);
    } catch (e) {
      if (no === istekNo.current) { setSonuc(null); setHata(e instanceof Error ? e.message : String(e)); }
    } finally {
      if (no === istekNo.current) setBekliyor(false);
    }
  }

  const gorunenOlculer = useMemo(() => OLCULER.filter((o) => sonuc?.tablo.some((t) => sayiVeya(t.ref?.[o.k]) != null || sayiVeya(t.aday?.[o.k]) != null)), [sonuc]);
  const karar = sonuc ? kararBilgisi(sonuc.karar) : null;
  // Kademe birimi referansin motoruyla (farkli motorda karar VERI YOK; tablo bos gelir).
  const birim: AdimBirimi = (sonuc?.ref.motor ?? refK?.motor) === 'wrk' ? 'bağlantı' : 'istek/sn';
  // CPU olculmediyse (bir taraf serbest ya da sunucu CPU'suz karar yolu: analiz.cjs "CPU olculmedi (...)" satiri)
  // "CPU kademesi" yazilmaz: karar p95 ve hata oranina gore verildi.
  const cpuOlculmedi = !!sonuc && (sonuc.ref.hedefTuru === 'serbest' || sonuc.aday.hedefTuru === 'serbest' || serbestVar || sonuc.nedenler.some((n) => n.startsWith('CPU olculmedi (')));
  const secenekler = (haric: string) => (kosular || []).filter((k) => String(k.id) !== haric).map((k) => <option key={k.id} value={String(k.id)}>{kosuEtiketi(k)}</option>);

  return (
    <div className="space-y-4">
      <Bolum baslik="Karşılaştır" aciklama="Referans: değişiklikten önceki koşu. Aday: aynı hedef, vhost ve senaryoyla değişiklikten sonraki koşu. Karar yalnız geçerli adımlardan verilir.">
        {listeHata && <div className="mb-3"><UyariKutusu ton="hata" rol="alert" baslik="Koşular okunamadı">{listeHata}</UyariKutusu></div>}
        <div className="grid items-end gap-3 @lg/yuk:grid-cols-2 @5xl/yuk:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_7rem_7rem_auto]">
          <Alan id="kar-ref" etiket="Referans koşu">
            <select id="kar-ref" value={ref} onChange={(e) => { setRef(e.target.value); setSonuc(null); }} className={GIRDI} style={girdiStili()}>
              <option value="">— seçin —</option>{secenekler(aday)}
            </select>
          </Alan>
          <Alan id="kar-aday" etiket="Aday koşu">
            <select id="kar-aday" value={aday} onChange={(e) => { setAday(e.target.value); setSonuc(null); }} className={GIRDI} style={girdiStili()}>
              <option value="">— seçin —</option>{secenekler(ref)}
            </select>
          </Alan>
          <div className="flex items-end gap-3 @lg/yuk:col-span-2 @5xl/yuk:contents">
          <Alan id="kar-cpu" etiket="CPU eşiği %" className="w-28 @5xl/yuk:w-auto" hata={esik(esikCpu) == null ? '1–50' : null}>
            <input id="kar-cpu" value={esikCpu} onChange={(e) => setEsikCpu(e.target.value)} inputMode="decimal" className={`${GIRDI} tabular-nums`} style={girdiStili(esik(esikCpu) == null)} />
          </Alan>
          <Alan id="kar-p95" etiket="p95 eşiği %" className="w-28 @5xl/yuk:w-auto" hata={esik(esikP95) == null ? '1–50' : null}>
            <input id="kar-p95" value={esikP95} onChange={(e) => setEsikP95(e.target.value)} inputMode="decimal" className={`${GIRDI} tabular-nums`} style={girdiStili(esik(esikP95) == null)} />
          </Alan>
          <button type="button" onClick={() => void karsilastir()} disabled={!hazir || bekliyor} className={`${SM_BTN} h-8 justify-center`} style={smBtn(true)}>
            <ArrowsRightLeftIcon className="h-3.5 w-3.5" aria-hidden /> {bekliyor ? 'Hesaplanıyor…' : 'Karşılaştır'}
          </button>
          </div>
        </div>
        {kosular && kosular.length < 2 && <p className="mt-2 text-[11px]" style={{ color: 'var(--text-secondary)' }}>Karşılaştırma için en az iki bitmiş koşu gerekir.</p>}
        {(farkliOrtam || farkliMotor || farkliIsParcacigi || farkliTavan || serbestVar) && (
          <div className="mt-3 space-y-2">
            {farkliMotor && <UyariKutusu ton="uyari" baslik="Koşular farklı yük araçlarıyla alınmış (k6 / wrk): karar VERİ YOK döner." />}
            {farkliIsParcacigi && <UyariKutusu ton="uyari" baslik="Koşular farklı iş parçacığı sayısıyla alınmış: karar VERİ YOK döner." />}
            {farkliTavan && wRef && wAday && (
              <UyariKutusu ton="uyari" baslik={`Farklı hız tavanı: referans ${fmtNumber(wRef.tavanRps)} istek/sn, aday ${fmtNumber(wAday.tavanRps)} istek/sn — wrk’de aynı bağlantı kademesi farklı yük demektir; aynı tavanla yeniden koşun.`} />
            )}
            {farkliOrtam && <UyariKutusu ton="uyari" baslik="İki koşu farklı hedef, vhost ya da senaryoyla yapılmış — karşılaştırma yalnız aynı ölçüm düzeninde anlamlıdır." />}
            {serbestVar && <UyariKutusu ton="uyari" baslik="Bir koşu serbest hedefte (CPU ölçülmedi): KALICI verilmez; karar p95 ve hata oranına göre." />}
          </div>
        )}
      </Bolum>

      {hata && <UyariKutusu ton="hata" rol="alert" baslik="Karşılaştırılamadı">{hata}</UyariKutusu>}
      {sonuc && karar && (
        <Bolum govdeSinifi="p-4 space-y-4">
          <div className="rounded-lg px-4 py-3" style={{ background: TON[karar.ton].zemin, boxShadow: `inset 4px 0 0 ${TON[karar.ton].renk}, inset 0 0 0 1px ${TON[karar.ton].kenar}` }} role="status">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--text-secondary)' }}>Karar</span>
              <Hap label={karar.etiket} ton={karar.ton} />
              <span className="text-[12px]" style={{ color: 'var(--text-secondary)' }}>#{sonuc.ref.id} → #{sonuc.aday.id}{sonuc.kademe ? `${cpuOlculmedi ? '' : ` · CPU kademesi ${kademeMetni(sonuc.kademe.cpu, birim)}`} · p95 kademesi ${kademeMetni(sonuc.kademe.p95, birim)}` : ''}</span>
            </div>
            <p className="mt-1 text-[13px] leading-5" style={{ color: 'var(--text-primary)' }}>{karar.aciklama}</p>
          </div>
          {sonuc.nedenler.length > 0 && (
            <div>
              <h3 className="mb-1 text-[12px] font-semibold" style={{ color: 'var(--text-primary)' }}>Gerekçe</h3>
              <ul className="space-y-0.5 rounded-lg border px-3 py-2 font-mono text-[11px] leading-5" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-elevated)', color: 'var(--text-primary)' }}>
                {sonuc.nedenler.map((n, i) => <li key={`${i}-${n}`} className="wrap-anywhere">{n}</li>)}
              </ul>
            </div>
          )}
          <div className="overflow-x-auto rounded-lg border" style={{ borderColor: 'var(--border-subtle)' }}>
            <table className="pf-table-sticky w-full table-fixed border-collapse" style={{ minWidth: `${6 + gorunenOlculer.length * 7.5}rem` }} aria-label="Kademe karşılaştırması">
              <colgroup><col style={{ width: '6rem' }} />{gorunenOlculer.map((o) => <col key={o.k} />)}</colgroup>
              <thead><tr>
                <th scope="col" className="px-2.5 py-1.5 text-left text-[11px]" style={{ ...TH_STIL, left: 0, zIndex: 3 }} title={birim === 'bağlantı' ? 'eşzamanlı bağlantı sayısı (wrk, kapalı döngü)' : undefined}>{birim === 'bağlantı' ? 'Bağlantı' : 'Hız'}</th>
                {gorunenOlculer.map((o) => <th key={o.k} scope="col" className="px-2.5 py-1.5 text-right text-[11px]" style={TH_STIL} title="referans → aday (fark)">{o.ad}</th>)}
              </tr></thead>
              <tbody className="text-[12px]" style={{ color: 'var(--text-primary)' }}>
                {sonuc.tablo.length === 0 ? <TableEmptyRow colSpan={gorunenOlculer.length + 1} title="Ortak kademe yok." /> : sonuc.tablo.map((t) => (
                  <tr key={String(t.hiz)} className="border-t align-top" style={{ borderColor: 'var(--border-subtle)' }}>
                    <td className="sticky left-0 z-[1] truncate px-2.5 py-1.5 font-semibold tabular-nums" style={{ background: 'var(--bg-surface)' }} title={kademeMetni(t.hiz, birim)}>{kademeMetni(t.hiz, birim)}</td>
                    {gorunenOlculer.map((o) => {
                      const r = sayiVeya(t.ref?.[o.k]);
                      const a = sayiVeya(t.aday?.[o.k]);
                      const f = t.farkYuzde[o.k] ?? null;
                      const bic = (x: number | null) => (o.oran ? yuzde(x, o.basamak) : ondalik(x, o.basamak));
                      const ton = f == null || Math.abs(f) < 0.05 ? null : (f < 0) === o.dusukIyi ? 'basari' : 'hata';
                      return (
                        <td key={o.k} className="px-2.5 py-1.5 text-right tabular-nums">
                          <div className="whitespace-nowrap">{bic(r)} → {bic(a)}</div>
                          <div className="text-[11px] font-semibold" style={{ color: ton ? TON[ton].metin : 'var(--text-secondary)' }}>{farkMetni(f)}</div>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-[11px] leading-4" style={{ color: 'var(--text-secondary)' }}>Fark = aday / referans − 1. Yeşil iyileşme, kırmızı kötüleşme (hepsinde düşük olan iyi). Eşik altı farklar gürültü sayılır; karar gerekçede yazan kademelerle verilir.</p>
        </Bolum>
      )}
    </div>
  );
}
