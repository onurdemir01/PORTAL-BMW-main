// src/components/nginx_console/yukTesti/SonucOzeti.tsx — koşu sonuçlarının sade özeti (2026-11-02).
//
// Kullanici geri bildirimi (R2, AWX 3474239): "ciktida kac istek gitti, medyan, p95, p99 nasil gorulur?". Sonuçlar
// sekmesinin ustunde: kosu duzeyi tek satir (toplam istek, en iyi / en kotu p95, hata var mi), gecersizlik nedenleri
// DUZ TURKCE CUMLEYLE (ayni neden tek satir, etkilenen adimlar ve reload ani - sunucu `reloadlar` verdiyse), ve adim
// basina ozet tablo (istek, gercek hiz, p50 / p95 / p99, hata %, 429, 5xx, host CPU, sonuc). Her kolon basliginin
// ipucu (title) ve tablonun altinda acilir "Sütunlar ne anlatıyor?" listesi ayni metni tasir. Teknik kolonlar
// (CPU-ms/istek, kapasite, drop) KosuAyrinti'nin "Ayrıntı" bolumunde. Eski kosuda olmayan deger "—".
// HTTP/2 (2026-11-02): h2 kosusunun ozet satiri "HTTP/2" cipiyle baslar; reload fazi `olcum_kenari` (olcume degdi, CPU
// penceresinin disinda) "ölçüm etkilenmedi" der.
// 2026-11-03 (E1 / E4): tekrar "1. tekrar" (r1 degil), adim sutunu ipucu tekrarin anlamini soyler; reload metninde adim
// "90/sn adımının 2. tekrarında"; host CPU ipucu kosunun cekirdek sayisiyla.
import React, { useState } from 'react';
import { ChevronDownIcon, ChevronRightIcon } from '@heroicons/react/24/outline';
import type { NlAdim, NlKosuAyrinti, NlProtokol, NlReloadAni, NlSonucOzeti } from '@/api/nginxLoadtestApi';
import { TableEmptyRow } from '@/components/common/EmptyState';
import { fmtNumber } from '@/utils/datetime';
import { TH_STIL, TON } from '@/components/server_hub/retirementStil';
import { Cip, Hap } from '@/components/server_hub/RetirementUi';
import { kosuNedeniniAyir, nedenAcikla, reloadZamanMetni, type NedenAciklamasi } from './nedenler';
import {
  H2_CIP_IPUCU, PROTOKOL_ETIKETI, adimGecerliligi, adimSirala, hostCpuIpucu, kademeMetni, ondalik, sonucOzetiHesapla, tekrarIpucu, tekrarMetni, turCumlesi, turEtiketi,
  yukCpuHucre, yukCpuKolonuVar, yuzde, type AdimBirimi,
} from './yukTestiOrtak';

// ── Kolonlar ve ipuclari ────────────────────────────────────────────────────────────
type OzetKolonu = { anahtar: string; baslik: string; genislik: string; sag?: boolean; ipucu: string };
/** `yukCpu`: adimlardan en az birinde yuk makinesi CPU'su olculmus (2026-11-03 sonrasi kosu); eski kosuda kolon YOK
 *  (tablo BIREBIR eskisi). */
export function ozetKolonlari(birim: AdimBirimi, serbest: boolean, yukCpu = false, nproc: number | null = null): OzetKolonu[] {
  const wrk = birim === 'bağlantı';
  const kolonlar: OzetKolonu[] = [
    { anahtar: 'adim', baslik: 'Adım', genislik: '7rem', ipucu: `${wrk ? 'Aynı anda açık bağlantı sayısı ve kaçıncı tekrar olduğu (1. tekrar, 2. tekrar).' : 'İstenen hız (saniyedeki istek) ve kaçıncı tekrar olduğu (1. tekrar, 2. tekrar).'} ${tekrarIpucu(birim)}` },
    { anahtar: 'istek', baslik: 'İstek', genislik: '4.5rem', sag: true, ipucu: 'Ölçüm süresince gönderilen istek sayısı (ısınma hariç).' },
    { anahtar: 'rps', baslik: 'Gerçek hız', genislik: '4.5rem', sag: true, ipucu: wrk ? 'Saniyede tamamlanan ortalama istek; kapalı döngüde hızı bağlantı sayısı ve yanıt süresi belirler.' : 'Saniyede gerçekten gönderilen ortalama istek; istenen hızın altındaysa yük aracı ya da hedef yetişemedi.' },
    { anahtar: 'p50', baslik: 'Medyan', genislik: '4.5rem', sag: true, ipucu: 'İsteklerin yarısı bu süreden kısa sürede yanıtlandı (ms, p50): tipik yanıt süresi.' },
    { anahtar: 'p95', baslik: 'p95', genislik: '4.5rem', sag: true, ipucu: 'İsteklerin %95’i bu süreden kısa sürede yanıtlandı (ms); en yavaş %5 bunun üstünde.' },
    { anahtar: 'p99', baslik: 'p99', genislik: '4.5rem', sag: true, ipucu: 'İsteklerin %99’u bu süreden kısa sürede yanıtlandı (ms); en yavaş %1’lik kuyruğu gösterir.' },
    { anahtar: 'hata', baslik: 'Hata', genislik: '4.5rem', sag: true, ipucu: wrk ? 'Başarısız isteklerin oranı: 2xx / 3xx dışı yanıt ya da soket hatası.' : 'Başarısız isteklerin oranı: bağlantı hatası, zaman aşımı ya da 4xx / 5xx yanıt.' },
    { anahtar: 'n429', baslik: '429', genislik: '4.5rem', sag: true, ipucu: 'Hız sınırı (limit_req / limit_conn) yüzünden reddedilen istek sayısı; 0 olmalı.' },
    { anahtar: 'n5xx', baslik: '5xx', genislik: '4.5rem', sag: true, ipucu: 'Sunucunun hata (500–599) döndürdüğü istek sayısı; 0 olmalı.' },
    { anahtar: 'cpu', baslik: 'Host CPU', genislik: '4.5rem', sag: true, ipucu: serbest ? 'Serbest hedefte sunucu ölçülmez.' : `Ölçüm sırasında hedef sunucunun ortalama CPU kullanımı: ${hostCpuIpucu(nproc)} %90 üstü sunucunun doyduğunu gösterir.` },
    { anahtar: 'yuk', baslik: 'Yük mak. boşta', genislik: '4.5rem', sag: true, ipucu: 'Ölçüm sırasında yük makinesinin boşta CPU ortalaması; %20 altında “yük doydu”: sonuç hedefin değil yük makinesinin sınırını gösterebilir (kayıt beklenip ölçülemeyen adım: “ölçülemedi”).' },
    { anahtar: 'sonuc', baslik: 'Sonuç', genislik: '6.5rem', ipucu: 'Bu adımın ölçümüne güvenilip güvenilmeyeceği: geçerli, doyma (sınırda), geçersiz ya da hatalı; nedeni üstteki kutuda.' },
  ];
  return yukCpu ? kolonlar : kolonlar.filter((k) => k.anahtar !== 'yuk');
}

const sayi = (x: number | null | undefined) => (x == null || !Number.isFinite(x) ? '—' : fmtNumber(x));
const ms = (x: number | null | undefined) => ondalik(x, x != null && Math.abs(x) < 10 ? 2 : 1);

// ── Kosu duzeyi ozet satiri ─────────────────────────────────────────────────────────
/** Sunucu ozeti varsa o (reload olaylari onda), yoksa adimlardan ayni kuralla. */
export const ozetSec = (kosu: Pick<NlKosuAyrinti, 'sonucOzeti'>, adimlar: NlAdim[]): NlSonucOzeti => kosu.sonucOzeti ?? sonucOzetiHesapla(adimlar);

export function KosuOzetSatiri({ ozet, adimlar, birim, protokol = 'h1' }: { ozet: NlSonucOzeti; adimlar: NlAdim[]; birim: AdimBirimi; protokol?: NlProtokol }) {
  const etiket = (tur: string) => turEtiketi(tur, adimlar, birim);
  const hatalar: string[] = [];
  if ((ozet.toplam429 ?? 0) > 0) hatalar.push(`${fmtNumber(ozet.toplam429 as number)} istek 429 (hız sınırı)`);
  if ((ozet.toplam5xx ?? 0) > 0) hatalar.push(`${fmtNumber(ozet.toplam5xx as number)} istek 5xx (sunucu hatası)`);
  if (!hatalar.length && (ozet.enYuksekHataOrani ?? 0) > 0) hatalar.push(`en yüksek hata oranı ${yuzde(ozet.enYuksekHataOrani)}`);
  const hataTon = hatalar.length ? TON.hata : TON.basari;
  const tablo = (
    <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border @3xl/yuk:grid-cols-4" style={{ borderColor: 'var(--border-subtle)', background: 'var(--border-subtle)' }} aria-label="Koşu özeti">
      <OzetKutu etiket="Gönderilen istek" alt={`${fmtNumber(ozet.adimSayisi)} adım, ${fmtNumber(ozet.gecerliAdimSayisi)} geçerli · ısınma hariç`}>
        {ozet.toplamIstek != null ? fmtNumber(ozet.toplamIstek) : '—'}
      </OzetKutu>
      <OzetKutu etiket="En iyi p95" alt={ozet.p95EnIyi ? `${etiket(ozet.p95EnIyi.tur)}${ozet.p95Kapsam === 'tum' ? ' · geçerli adım yok, tüm adımlardan' : ''}` : 'ölçülmedi'}>
        {ozet.p95EnIyi ? `${ms(ozet.p95EnIyi.deger)} ms` : '—'}
      </OzetKutu>
      <OzetKutu etiket="En kötü p95" alt={ozet.p95EnKotu ? `${etiket(ozet.p95EnKotu.tur)}${ozet.p95Kapsam === 'tum' ? ' · geçerli adım yok, tüm adımlardan' : ''}` : 'ölçülmedi'}>
        {ozet.p95EnKotu ? `${ms(ozet.p95EnKotu.deger)} ms` : '—'}
      </OzetKutu>
      <OzetKutu etiket="Hatalar" alt={hatalar.length ? 'ayrıntı tabloda' : 'hiçbir adımda 429, 5xx ya da hata yok'}>
        <span style={{ color: hataTon.metin }}>{hatalar.length ? hatalar.join(' · ') : 'Hata yok'}</span>
      </OzetKutu>
    </dl>
  );
  // h1 gorunumu BIREBIR eskisi (sarmalayici yok).
  if (protokol !== 'h2') return tablo;
  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-1.5 text-[11px]" style={{ color: 'var(--text-secondary)' }}>
        <Cip cerceve title={H2_CIP_IPUCU}>{PROTOKOL_ETIKETI.h2}</Cip>
        <span>Bu koşu HTTP/2 ile ölçüldü.</span>
      </div>
      {tablo}
    </div>
  );
}
function OzetKutu({ etiket, alt, children }: { etiket: string; alt: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0 px-4 py-3" style={{ background: 'var(--bg-surface)' }}>
      <dt className="text-[11px] font-medium leading-4" style={{ color: 'var(--text-secondary)' }}>{etiket}</dt>
      <dd className="mt-1 text-[16px] font-semibold leading-6 tabular-nums" style={{ fontFamily: 'var(--font-display)', color: 'var(--text-primary)' }}>{children}</dd>
      <dd className="mt-0.5 text-[11px] leading-4" style={{ color: 'var(--text-secondary)' }}>{alt}</dd>
    </div>
  );
}

// ── Gecersizlik / doyma nedenleri (duz cumle) ───────────────────────────────────────
export interface NedenGrubu { aciklama: NedenAciklamasi; turlar: string[]; reloadlar: NlReloadAni[] }
/**
 * Adimlarin nedenleri (GECERSIZ / HATALI / DOYMA) + kosu duzeyinde adima bagli olmayanlar (istemci_sonucu_yok, poller'in
 * Turkce nedenleri) -> ayni cumle tek grup; her grubun adimlari ve (reload ise) reload anlari. Reload anlari once
 * adimin `reloadlar`'indan, yoksa kosu ozetindeki olaylarin `etkilenenTurlar`'indan.
 */
export function nedenGruplari(kosu: Pick<NlKosuAyrinti, 'gecersizNedenleri'>, adimlar: NlAdim[], ozet: NlSonucOzeti | null): NedenGrubu[] {
  const m = new Map<string, NedenGrubu>();
  const ekle = (kod: string, tur: string | null) => {
    const a = nedenAcikla(kod);
    const g = m.get(a.cumle) ?? { aciklama: a, turlar: [], reloadlar: [] };
    if (tur && !g.turlar.includes(tur)) g.turlar.push(tur);
    m.set(a.cumle, g);
  };
  const turlar = new Set(adimlar.map((a) => a.tur));
  for (const a of adimSirala(adimlar)) if (a.gecerlilik !== 'GECERLI') for (const n of a.nedenler) ekle(n, a.tur);
  for (const satir of kosu.gecersizNedenleri) {
    const { tur, nedenler } = kosuNedeniniAyir(satir);
    if (tur && turlar.has(tur)) continue;
    for (const n of nedenler) ekle(n, tur);
  }
  for (const g of m.values()) {
    if (!/^reload\(/.test(g.aciklama.kod)) continue;
    // Reload'la dusen adimin olaylari evre suzgeci OLMADAN: isinmada / boslukta baslayip olcume tasan olay da adimi
    // dusurur (eski worker'lar kapanana dek); adima bagli olmayan reload nedeninde yalniz olcumdekiler.
    const anlar: NlReloadAni[] = [];
    for (const tur of g.turlar) {
      const a = adimlar.find((x) => x.tur === tur);
      for (const r of a?.reloadlar ?? []) anlar.push(r);
    }
    if (!anlar.length && ozet) for (const r of ozet.reloadlar) if (g.turlar.length ? r.etkilenenTurlar.some((t) => g.turlar.includes(t)) : r.faz === 'olcum') anlar.push(r);
    const gorulen = new Set<string>();
    g.reloadlar = anlar.filter((r) => { const k = `${r.t}|${r.tur}`; if (gorulen.has(k)) return false; gorulen.add(k); return true; }).sort((x, y) => x.t - y.t);
  }
  return [...m.values()];
}

export function NedenListesi({ gruplar, adimlar, birim }: { gruplar: NedenGrubu[]; adimlar: NlAdim[]; birim: AdimBirimi }) {
  if (!gruplar.length) return null;
  return (
    <ul className="mt-1.5 space-y-2" aria-label="Nedenler">
      {gruplar.map((g) => (
        <li key={g.aciklama.cumle} className="text-[12px] leading-5" style={{ color: 'var(--text-primary)' }}>
          <div className="flex items-start gap-2">
            <span aria-hidden className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: TON[g.aciklama.ton === 'bilgi' ? 'aksan' : g.aciklama.ton].renk }} />
            <div className="min-w-0">
              <p className="wrap-anywhere">{g.aciklama.cumle}</p>
              {g.reloadlar.length > 0 && (
                <p className="wrap-anywhere" style={{ color: 'var(--text-secondary)' }}>
                  {`Reload ${g.reloadlar.map((r) => reloadZamanMetni({ ...r, tur: r.tur ? turCumlesi(r.tur, adimlar, birim) : null })).join('; ')}.`}
                </p>
              )}
              {g.turlar.length > 0 && (
                <p className="wrap-anywhere text-[11px] leading-4" style={{ color: 'var(--text-secondary)' }}>{`Etkilenen adım${g.turlar.length > 1 ? 'lar' : ''}: ${g.turlar.map((t) => turEtiketi(t, adimlar, birim)).join(', ')}`}</p>
              )}
              {g.aciklama.kod && <p className="wrap-anywhere font-mono text-[11px] leading-4" style={{ color: 'var(--text-secondary)' }}>{`kod: ${g.aciklama.kod}`}</p>}
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}

/** Olcum penceresi disindaki reload adimi gecersiz yapmaz (sade_sozlesme v2): cumlede soylenir. */
const OLCUM_DISI_NOTU: Record<string, string> = {
  isinma: ' (ölçüm etkilenmedi)', olcum_kenari: ' (ölçüm etkilenmedi)', bosluk: ' (ölçüm etkilenmedi)', kosu_oncesi: ' (ölçüm etkilenmedi)',
};
/**
 * Kosu ozetindeki reload olaylarindan bir adim nedeninin altinda GOSTERILMEYENLER (isinma / bekleme sirasindaki, ya da
 * nedeni olmayan): duz cumle. `gosterilen`: neden gruplarinda zaten yazilan olaylarin `t` degerleri.
 */
export function reloadOzetMetni(ozet: NlSonucOzeti, adimlar: NlAdim[], birim: AdimBirimi, gosterilen: Set<number> = new Set()): string | null {
  const kalan = ozet.reloadlar.filter((r) => !gosterilen.has(r.t));
  if (!kalan.length) return null;
  // Reload'la dusmus bir adima degen olay icin "olcum etkilenmedi" denmez (evresi ne derse desin).
  const dusen = new Set(adimlar.filter((a) => a.nedenler.some((n) => /^reload\(/.test(n))).map((a) => a.tur));
  const dusurdu = (r: NlSonucOzeti['reloadlar'][number]) => (r.tur !== null && dusen.has(r.tur)) || r.etkilenenTurlar.some((t) => dusen.has(t));
  const anlar = kalan.map((r) => `${reloadZamanMetni({ ...r, tur: r.tur ? turCumlesi(r.tur, adimlar, birim) : null })}${dusurdu(r) ? '' : OLCUM_DISI_NOTU[r.faz] ?? ''}`);
  const bas = gosterilen.size ? 'Ayrıca nginx' : 'Koşu sırasında nginx';
  return `${bas} ${fmtNumber(kalan.length)} kez yeniden yüklendi (reload): ${anlar.join('; ')}.`;
}

// ── Adim basina ozet tablo ──────────────────────────────────────────────────────────
const sayiHucre = 'px-2.5 py-1.5 text-right tabular-nums';
const KOTU = { color: 'var(--status-danger-text)', fontWeight: 600 } as const;
const UYARI = { color: 'var(--status-warning-text)', fontWeight: 600 } as const;

export function OzetTablosu({ adimlar, birim, serbest, aktif, nproc = null }: { adimlar: NlAdim[]; birim: AdimBirimi; serbest: boolean; aktif: boolean; nproc?: number | null }) {
  const [aciklamaAcik, setAciklamaAcik] = useState(false);
  const yukCpu = yukCpuKolonuVar(adimlar);
  const kolonlar = ozetKolonlari(birim, serbest, yukCpu, nproc);
  const sirali = adimSirala(adimlar);
  const cokSeri = new Set(adimlar.map((a) => [a.senaryo, a.kip, a.ae].join('/'))).size > 1;
  const aciklamaId = 'yuk-ozet-kolonlar';
  return (
    <div>
      <h3 className="mb-1.5 text-[12px] font-semibold" style={{ color: 'var(--text-primary)' }}>
        Adım sonuçları <span className="font-normal" style={{ color: 'var(--text-secondary)' }}>— süreler milisaniye; başlığın üstünde durunca ne anlattığı görünür</span>
      </h3>
      <div className="overflow-x-auto rounded-lg border" style={{ borderColor: 'var(--border-subtle)' }}>
        <table className={`w-full ${yukCpu ? 'min-w-[50.5rem]' : 'min-w-[46rem]'} table-fixed border-collapse`} aria-label="Adım sonuçları özeti">
          <colgroup>{kolonlar.map((k) => <col key={k.anahtar} style={{ width: k.genislik }} />)}</colgroup>
          <thead><tr>{kolonlar.map((k) => (
            <th key={k.anahtar} scope="col" title={k.ipucu} className={`px-2.5 py-1.5 text-[11px] whitespace-nowrap ${k.sag ? 'text-right' : 'text-left'}`} style={TH_STIL}>
              <span className="cursor-help underline decoration-dotted underline-offset-2">{k.baslik}</span>
            </th>
          ))}</tr></thead>
          <tbody className="text-[12px]" style={{ color: 'var(--text-primary)' }}>
            {sirali.length === 0 ? (
              <TableEmptyRow colSpan={kolonlar.length} title={aktif ? 'Adımlar koşu bitince görünür.' : 'Adım sonucu yok.'} />
            ) : sirali.map((a, i) => {
              const d = adimGecerliligi(a.gecerlilik);
              const ilkNeden = a.nedenler.length ? nedenAcikla(a.nedenler[0]).cumle : '';
              return (
                <tr key={`${a.tur}|${i}`} className="border-t" style={{ borderColor: 'var(--border-subtle)' }}>
                  <td className="px-2.5 py-1.5">
                    <div className="truncate font-semibold tabular-nums" title={kademeMetni(a.hiz, birim)}>{kademeMetni(a.hiz, birim)}</div>
                    <div className="truncate text-[11px]" style={{ color: 'var(--text-secondary)' }} title={a.tur}>{`${a.tekrar != null ? tekrarMetni(a.tekrar) : '—'}${cokSeri ? ` · ${[a.senaryo, a.kip, a.ae].join('/')}` : ''}`}</div>
                  </td>
                  <td className={sayiHucre}>{sayi(a.nIstek)}</td>
                  <td className={sayiHucre}>{a.gercekRps != null ? `${ondalik(a.gercekRps, 1)}/sn` : '—'}</td>
                  <td className={sayiHucre}>{ms(a.p50)}</td>
                  <td className={`${sayiHucre} font-semibold`}>{ms(a.p95)}</td>
                  <td className={sayiHucre}>{ms(a.p99)}</td>
                  <td className={sayiHucre} style={(a.hataOrani ?? 0) > 0.001 ? KOTU : undefined}>{yuzde(a.hataOrani)}</td>
                  <td className={sayiHucre} style={(a.n429 ?? 0) > 0 ? KOTU : undefined}>{sayi(a.n429)}</td>
                  <td className={sayiHucre} style={(a.n5xx ?? 0) > 0 ? KOTU : undefined}>{sayi(a.n5xx)}</td>
                  <td className={sayiHucre} style={serbest ? { color: 'var(--text-muted)' } : (a.hostCpuOrt ?? 0) > 90 ? UYARI : undefined} title={serbest ? 'Serbest hedefte sunucu ölçülmez.' : undefined}>
                    {!serbest && a.hostCpuOrt != null ? `%${ondalik(a.hostCpuOrt, 0)}` : '—'}
                  </td>
                  {yukCpu && <td className={sayiHucre} style={a.yukDoydu ? UYARI : undefined}>{yukCpuHucre(a)}</td>}
                  <td className="px-2.5 py-1.5"><Hap label={d.etiket} ton={d.ton} title={ilkNeden || undefined} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <button type="button" onClick={() => setAciklamaAcik((x) => !x)} aria-expanded={aciklamaAcik} aria-controls={aciklamaId}
        className="mt-1.5 inline-flex items-center gap-1 rounded text-[11px] font-semibold focus-visible:outline-offset-2!" style={{ color: 'var(--accent)' }}>
        {aciklamaAcik ? <ChevronDownIcon className="h-3.5 w-3.5" aria-hidden /> : <ChevronRightIcon className="h-3.5 w-3.5" aria-hidden />} Sütunlar ne anlatıyor?
      </button>
      <dl id={aciklamaId} hidden={!aciklamaAcik} className="mt-1.5 grid gap-x-4 gap-y-1.5 rounded-lg px-3 py-2.5 text-[12px] leading-5 @3xl/yuk:grid-cols-2" style={{ background: 'var(--bg-elevated)' }}>
        {kolonlar.map((k) => (
          <div key={k.anahtar} className="min-w-0">
            <dt className="inline font-semibold" style={{ color: 'var(--text-primary)' }}>{k.baslik}: </dt>
            <dd className="inline" style={{ color: 'var(--text-secondary)' }}>{k.ipucu}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
