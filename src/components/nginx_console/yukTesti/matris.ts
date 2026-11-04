// src/components/nginx_console/yukTesti/matris.ts — Gece kuyrugu toplu ekleme (2026-11-04, saf).
//
// Kullanici: "onun ustunden hizlica tum senaryolari girmek istiyorum". Formun gecerli govdesi kopyalanir; yalniz protokol,
// kip, ae ve sunucuAyar {seviye, static} degisir (3 protokol x 5 sikistirma x 2 static = 30 oge = MAX_OGE). Sunucu kurallari
// (dogrula.cjs): h2 yalniz k6 ve kip 'ka' -> wrk kapali; identity'de seviye null; static her ae'de serbest; dizin formdan.
// yuk-testi-matris testi uretilen her ogeyi gercek `parametreler` dogrulamasindan gecirir.
import type { NlAe, NlHedefTuru, NlKip, NlKuyrukGovde, NlMotor, NlParametreler, NlProtokol } from '@/api/nginxLoadtestApi';
import { AE_ETIKETI, KIP_ETIKETI, PROTOKOL_ETIKETI, SRV_SEVIYE_MAX, adimDegerleri, butceSn, hazirlikPayiSn, parametreSunucuAyari } from './yukTestiOrtak';
import { sureMetni } from '@/components/server_hub/retirementCikti';
import { MAX_OGE } from './kuyrukTaslak';

export type MatrisProtokol = 'h2' | 'h1_ka' | 'h1_yeni';
export const MATRIS_PROTOKOLLERI: { id: MatrisProtokol; ad: string; protokol: NlProtokol; kip: NlKip }[] = [
  { id: 'h2', ad: 'HTTP/2', protokol: 'h2', kip: 'ka' },
  { id: 'h1_ka', ad: 'HTTP/1.1 keep-alive', protokol: 'h1', kip: 'ka' },
  { id: 'h1_yeni', ad: 'HTTP/1.1 yeni bağlantı', protokol: 'h1', kip: 'yeni' },
];
export const MATRIS_STATIC: { deger: boolean; ad: string }[] = [{ deger: true, ad: 'static açık' }, { deger: false, ad: 'static kapalı' }];
const AE_ADI: Record<'br' | 'gzip', string> = { br: 'Brotli', gzip: 'Gzip' };

export interface MatrisSecimi {
  protokoller: MatrisProtokol[];
  /** "6 4": bos metin = o sikistirma yok. */
  brSeviyeler: string; gzipSeviyeler: string;
  sikistirmasiz: boolean;
  /** true: static acik, false: static kapali. */
  staticler: boolean[];
}
export const MATRIS_VARSAYILAN: MatrisSecimi = { protokoller: ['h2', 'h1_ka', 'h1_yeni'], brSeviyeler: '6 4', gzipSeviyeler: '6 4', sikistirmasiz: true, staticler: [true, false] };

/** "6 4" / "6,4" -> seviyeler, yazildigi sirayla; bos metin []. Aralik disi, sayi olmayan ya da tekrar eden deger hata. */
export function seviyeleriAyristir(metin: string, ae: 'br' | 'gzip'): { seviyeler: number[]; hata: string | null } {
  const parcalar = String(metin || '').trim().split(/[\s,;]+/).filter(Boolean);
  const ust = SRV_SEVIYE_MAX[ae];
  const seviyeler: number[] = [];
  for (const p of parcalar) {
    const n = /^\d{1,2}$/.test(p) ? Number(p) : NaN;
    if (!(n >= 1 && n <= ust)) return { seviyeler: [], hata: `${AE_ADI[ae]} seviyeleri 1–${ust} arası olmalı.` };
    if (seviyeler.includes(n)) return { seviyeler: [], hata: `${AE_ADI[ae]} seviyesi ${n} iki kez yazılmış.` };
    seviyeler.push(n);
  }
  return { seviyeler, hata: null };
}

export interface MatrisOgesi { etiket: string; govde: NlKuyrukGovde }
/** Secimden ogeler (sira protokol, sikistirma, static). `hatalar` doluysa `ogeler` bos. `dizin` formun sunucu ayarindan. */
export function matrisUret(govde: NlKuyrukGovde | null, s: MatrisSecimi): { ogeler: MatrisOgesi[]; hatalar: { br?: string; gzip?: string } } {
  const br = seviyeleriAyristir(s.brSeviyeler, 'br');
  const gz = seviyeleriAyristir(s.gzipSeviyeler, 'gzip');
  const hatalar = { ...(br.hata ? { br: br.hata } : {}), ...(gz.hata ? { gzip: gz.hata } : {}) };
  const dizin = govde?.parametreler.sunucuAyar?.dizin;
  if (br.hata || gz.hata || !govde || !dizin) return { ogeler: [], hatalar };
  const sikistirmalar: { ae: NlAe; seviye: number | null; ad: string }[] = [
    ...br.seviyeler.map((seviye) => ({ ae: 'br' as const, seviye, ad: `Brotli ${seviye}` })),
    ...gz.seviyeler.map((seviye) => ({ ae: 'gzip' as const, seviye, ad: `Gzip ${seviye}` })),
    ...(s.sikistirmasiz ? [{ ae: 'identity' as const, seviye: null, ad: 'Sıkıştırmasız' }] : []),
  ];
  const ogeler: MatrisOgesi[] = [];
  for (const pr of MATRIS_PROTOKOLLERI.filter((x) => s.protokoller.includes(x.id))) {
    for (const c of sikistirmalar) {
      for (const st of MATRIS_STATIC.filter((x) => s.staticler.includes(x.deger))) {
        ogeler.push({
          etiket: `${pr.ad} · ${c.ad} · ${st.ad}`,
          govde: {
            ...govde,
            parametreler: { ...govde.parametreler, protokol: pr.protokol, kip: pr.kip, ae: c.ae, sunucuAyar: { seviye: c.seviye, static: st.deger, dizin } },
          },
        });
      }
    }
  }
  return { ogeler, hatalar };
}

/** Toplu eklemenin neden kapali oldugu (ekranda yazilir); acikken null. */
export function matrisKapaliNedeni(o: { motor: NlMotor; hedefTuru: NlHedefTuru | null; srvAyarli: boolean; formHazir: boolean; taslakSayisi: number; ogeSayisi: number }): string | null {
  if (o.motor === 'wrk') return 'Toplu ekleme yalnız k6 ile çalışır: wrk HTTP/2 konuşmaz.';
  // Ayar kutusu yalniz sunucu hedefinde cizilir: serbestte olmayan kutuyu aratmaz (sunucu da sunucuAyar'i reddeder).
  if (o.hedefTuru !== 'sunucu') return 'Toplu ekleme yalnız sunucu hedefinde çalışır: sıkıştırma ve static her öğede hedef sunucuya kurulur.';
  if (!o.srvAyarli) return 'Gelişmiş ayarlarda “Sunucuyu koşu öncesi ayarla”yı açın: sıkıştırma ve static her öğede sunucuya kurulur.';
  if (!o.formHazir) return 'Önce formdaki eksikleri giderin.';
  if (o.taslakSayisi + o.ogeSayisi > MAX_OGE) return `Taslakta ${o.taslakSayisi} öğe var; ${o.ogeSayisi} öğe daha eklenirse ${MAX_OGE} sınırı aşılır.`;
  return null;
}

/** Taslak ogesinin ozeti ve bütcesi: "Kuyruğa ekle" ve toplu ekleme ayni formulu kullanir. */
export function ogeOzeti(p: NlParametreler): { ozet: string; butceSn: number | null } {
  const butce = adimDegerleri(p).degerler.length ? butceSn(p) : null;
  const yuk = p.motor === 'wrk' ? `${(p.baglantilar ?? []).join(' ')} bağlantı` : `${(p.hizlar ?? []).join(' ')} istek/sn`;
  const ozet = [p.motor, yuk, ...(p.protokol === 'h2' ? [PROTOKOL_ETIKETI.h2] : []), KIP_ETIKETI[p.kip], AE_ETIKETI[p.ae], parametreSunucuAyari(p), butce != null ? `≈ ${sureMetni(butce)}` : ''].filter(Boolean).join(' · ');
  return { ozet, butceSn: butce != null ? butce + hazirlikPayiSn(p) : null };
}
