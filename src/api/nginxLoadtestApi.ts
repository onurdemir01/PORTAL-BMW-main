// src/api/nginxLoadtestApi.ts — Nginx Hub › Yük Testi (server/nginx-loadtest, 2026-10-27).
//
// Sozlesme: /api/nginx-loadtest (ayri yonlendirici, nginxRedCevirici kapsaminda: 403/404 -> 409 nginxRed,
// GET disi 5xx -> 424). Is baslatan uclar ve /durum yalniz Admin; sunucu ve is numarasi ISTEMCIDEN ALINMAZ
// (koşu kaydindan turetilir). HAR dosyasi buraya hic gelmez: yalniz yol satirlari gonderilir.
//
// Liste/ayrinti uclari `okJson` (hata firlatir: ekran "yok" ile "okunamadi"yi karistirmasin); eylem uclari
// `safeJson` (409 is kodu - uyari_onayi, on_kontrol_eski ... - govdeden okunur).
// Adim satirlari ve on kontrol ozeti NORMALLESTIRILIR: sunucu alan adini camelCase ya da snake_case verse de,
// sayiyi metin olarak verse de ekran ayni sekli gorur; olculmeyen deger null kalir (asla 0'a donmez).
import { okJson, safeJson } from './http';

const BASE = '/api/nginx-loadtest';
const json = (body: unknown, method = 'POST'): RequestInit => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

export type NlDurum = 'QUEUED' | 'RUNNING' | 'FINALIZING' | 'DONE' | 'FAILED' | 'CANCELED' | 'OKUNAMADI';
export type NlGecerlilik = 'GECERLI' | 'KISMI' | 'GECERSIZ' | 'OKUNAMADI';
export type NlAdimGecerlilik = 'GECERLI' | 'DOYMA' | 'GECERSIZ' | 'HATALI';
export type NlKarar = 'KALICI' | 'NOTR' | 'RET' | 'GECERSIZ' | 'VERI_YOK' | 'DOYMA';
export type NlKip = 'yeni' | 'ka';
export type NlAe = 'br' | 'gzip' | 'identity';
export type NlIslem = 'on_kontrol' | 'kosu';

/** `neden` sunucunun mesaji, `kod` makine kodu. `hizSiniri` / `vuSiniri`: o hedefin limit_req / limit_conn'undan
 *  turetilen ust sinir (veri yoksa null); genel sinirlari DARALTIR. `vhostVerisi` false: server_name dokumu yok. */
export interface NlHedef {
  host: string; env: string | null; ipler: string[]; vhostlar: string[]; uygun: boolean; neden: string | null;
  kod?: string | null; hizSiniri?: number | null; vuSiniri?: number | null; vhostVerisi?: boolean;
}
export interface NlYukHost { host: string; env: string | null; uygun: boolean; neden: string | null }
export interface NlSinirlar { maxHiz: number; maxTekrar: number; sureMin: number; sureMax: number; isinmaMax: number; maxVu: number; maxButceSn: number }
export interface NlParametreler { hizlar: number[]; tekrar: number; isinma: number; sure: number; bosluk: number; bosta: number; maxvu: number; kip: NlKip; ae: NlAe }
export interface NlHedefler { ok: true; hedefler: NlHedef[]; yukHostlari: NlYukHost[]; sinirlar: NlSinirlar; varsayilan: NlParametreler }

export interface NlSenaryo {
  id: number; ad: string; aciklama: string | null; vhost: string | null; senaryoTur: 'K' | 'B'; yolSayisi: number;
  sha256: string; kaynak: 'har' | 'liste'; createdBy: string | null; createdAt: string | null;
}
export interface NlSenaryoAyrinti extends NlSenaryo { tsv: string; ozet: unknown }
export interface NlYeniSenaryo {
  ad: string; aciklama?: string; vhost?: string; senaryoTur: 'K' | 'B'; kaynak: 'har' | 'liste';
  satirlar: { agirlik: number; har: number; tur: string; boyut: string; yol: string }[]; ozet?: unknown;
}

/** set_stats `nginx_loadtest_result.on_kontrol` (sozlesme 4); bilinmeyen = null. */
export interface NlOnKontrol {
  ipYerel: boolean | null; serverNameVar: boolean | null; masterSayisi: number | null; webLogDf: number | null;
  logDiziniOkunur: boolean | null; logFormatUa: boolean | null; statikDirektif: boolean | null;
  k6Var: boolean | null; k6Surum: string | null; k6Sha256: string | null;
  yollarToplam: number | null; yollar200: number | null; ilkHatalar: { yol: string; status: string }[];
  sikistirma: { statik: number | null; dinamik: number | null; sikistirmasiz: number | null } | null;
}
export interface NlKosu {
  id: number; islem: NlIslem; etiket: string | null; adim: string | null; hedefHost: string; hedefIp: string | null;
  vhost: string | null; yukHost: string | null; senaryoId: number | null; senaryoAd: string | null; durum: NlDurum;
  gecerlilik: NlGecerlilik | null; createdBy: string | null; createdAt: string | null; startedAt: string | null;
  finishedAt: string | null; awxJobId: number | null;
}
export interface NlKosuAyrinti extends NlKosu {
  parametreler: (NlParametreler & { sni?: boolean }) | null; onKontrol: NlOnKontrol | null;
  gecersizNedenleri: string[]; sonucOzet: Record<string, unknown> | null; onKontrolKosuId: number | null;
  /** Sunucunun on kontrol degerlendirmesi (POST /kosular ayni listeyle karar verir); alan yoksa null. */
  sunucuDegerlendirmesi: { engeller: string[]; uyarilar: string[] } | null;
  /** On kontrolun yasi (sn, SUNUCU saatiyle, okuma anindaki); yalniz on kontrol kaydinda. */
  onKontrolYasSn: number | null;
  /** set_stats `durum` (OK / FAIL / DUR) ve `hata`; is sonucu yoksa null. */
  isDurumu: string | null; isHatasi: string | null;
  /** Portal analizi (sonucOzet.portal_analiz): cekirdek sayisi, TLS payi, uyarilar ya da okuma hatasi. */
  analiz: { nproc: number | null; cpuTlsliPay: number | null; uyarilar: string[]; okumaHatasi: string | null };
  /** Bu kosu icin baslatilan "durdur" kipindeki AWX isi (kilitler o is basariyla bitince birakilir); yoksa null. */
  durdurIsi: { awxServerId: number | null; awxJobId: number } | null;
  /** Poller'in sonucu okuma denemesi (FINALIZING'de "deneme N/3"); alan yoksa 0. */
  sonuclandirmaDenemesi: number;
}
/** Bir TUR (adim) satiri. Sure ms, hata_orani oran (0..1), host_cpu yuzde. */
export interface NlAdim {
  tur: string; senaryo: string | null; kip: string | null; ae: string | null; hiz: number | null; deneme: number | null;
  /** Tekrar sirasi: TUR soneki `_rN` (yoksa ham.tekrar). `deneme` kos.sh'in yeniden deneme sayisidir (Portal'da hep 1). */
  tekrar: number | null;
  /** Adim uyarilari (ham.uyarilar: diger_trafik, log_satiri_yok ...); gecerliligi dusurmez ama olcumu sorgulatir. */
  uyarilar: string[];
  /** Olcum penceresinin kaynagi (ham.pencere_kaynak): 'log' disinda sunucu rps'i olculmedi (istemci saatinden). */
  pencereKaynak: string | null;
  gecerlilik: NlAdimGecerlilik | null; nedenler: string[];
  p50: number | null; p95: number | null; p99: number | null; ttfbP95: number | null; tlsP95: number | null; connectP95: number | null;
  hataOrani: number | null; gercekRps: number | null; baytIstek: number | null; nIstek: number | null; n429: number | null; n5xx: number | null;
  dropped: number | null; istekSunucu: number | null; rpsSunucu: number | null; cpuMsIstek: number | null; hostCpuOrt: number | null;
  kapasiteRps: number | null; srtP50: number | null; srtP95: number | null; srtP99: number | null; sikistirmaTuru: string | null;
}
/** Karar tablosu satiri (analiz.cjs tabloYap): ref / aday hiz grubunun ozeti (snake_case; o tarafta kademe yoksa null),
 *  fark_yuzde YUZDE cinsinden (aday / ref - 1) x 100. */
export interface NlKarsilastirmaSatiri { hiz: number | null; ref: Record<string, unknown> | null; aday: Record<string, unknown> | null; farkYuzde: Record<string, number | null> }
export interface NlKarsilastirma {
  ok: true; karar: NlKarar; nedenler: string[]; tablo: NlKarsilastirmaSatiri[];
  ref: { id: number; etiket: string | null; createdAt: string | null }; aday: { id: number; etiket: string | null; createdAt: string | null };
  kademe?: { cpu: number | null; p95: number | null } | null;
}
/** Eylem yaniti: basari ya da ret govdesi (`code`, 409 uyari_onayi'nda `uyarilar`). Durdur: `iptal` (AWX iptal
 *  sonucu), `durdurIsi` (durdur kipindeki is) ve hatalari; 424 durdur_baslatilamadi govdesi de bunlari tasir. */
export interface NlEylem {
  ok: boolean; message?: string; code?: string; kosuId?: number; jobId?: number | null; awxServerId?: number; id?: number; uyarilar?: string[]; _httpStatus?: number;
  iptal?: { canceled?: boolean; alreadyTerminal?: boolean } | null; iptalHatasi?: string | null;
  durdurIsi?: { jobId: number; awxServerId: number } | null; durdurHatasi?: string | null;
}
/** GET /kosular suzgeci: `onceki` = yalniz bu numaradan kucuk kayitlar (sayfalama), `limit` 1..200 (sunucu varsayilani 50). */
export interface NlKosuSuzgeci { limit?: number; hedef?: string; islem?: NlIslem; durum?: NlDurum; onceki?: number }
/** `output` = maskeli ciktinin `outputOffset`'ten sonrasi (`since` gecersizse 0'dan, yani tamami). */
export interface NlDurumYaniti {
  ok: true; status: string; finished: boolean; output: string; outputOffset?: number; outputLength?: number; kaynak?: 'awx' | 'arsiv';
  result: unknown; kosuDurum: NlDurum | null;
}
export type NlRet = { ok: false; message?: string; code?: string; kalici?: boolean; _httpStatus?: number };

// ── normallestirme ─────────────────────────────────────────────────────────────────
type Ham = Record<string, unknown>;
const nesne = (x: unknown): Ham => (x && typeof x === 'object' && !Array.isArray(x) ? (x as Ham) : {});
/** Ilk tanimli alan (camelCase, sonra snake_case). */
const alan = (r: Ham, ...adlar: string[]): unknown => {
  for (const a of adlar) if (r[a] !== undefined) return r[a];
  return undefined;
};
/** Sayi ya da null. Bos metin / null / NaN = olculmedi (0 DEGIL). */
export function sayiVeya(x: unknown): number | null {
  if (x == null || x === '' || typeof x === 'boolean') return null;
  const n = typeof x === 'number' ? x : Number(String(x).trim());
  return Number.isFinite(n) ? n : null;
}
/** Ansible'dan metin olarak da gelebilir ('True', 'false', '1'). */
export function mantikVeya(x: unknown): boolean | null {
  if (typeof x === 'boolean') return x;
  if (typeof x === 'number') return x !== 0;
  if (typeof x === 'string') {
    const s = x.trim().toLowerCase();
    if (['true', 'yes', '1', 'evet'].includes(s)) return true;
    if (['false', 'no', '0', 'hayir', 'hayır'].includes(s)) return false;
  }
  return null;
}
const metinVeya = (x: unknown): string | null => (x == null || x === '' ? null : String(x));
/** JSON dizi metni ya da dizi -> metin dizisi. */
export function metinDizisi(x: unknown): string[] {
  let v = x;
  if (typeof v === 'string') {
    const s = v.trim();
    if (!s) return [];
    try { v = JSON.parse(s); } catch { return [s]; }
  }
  return Array.isArray(v) ? v.filter((e) => e != null && e !== '').map(String) : [];
}
const jsonNesne = (x: unknown): Ham | null => {
  if (typeof x === 'string') { try { return nesne(JSON.parse(x)); } catch { return null; } }
  return x && typeof x === 'object' ? nesne(x) : null;
};

const ADIM_ALANLARI: [keyof NlAdim, string][] = [
  ['p50', 'p50'], ['p95', 'p95'], ['p99', 'p99'], ['ttfbP95', 'ttfb_p95'], ['tlsP95', 'tls_p95'], ['connectP95', 'connect_p95'],
  ['hataOrani', 'hata_orani'], ['gercekRps', 'gercek_rps'], ['baytIstek', 'bayt_istek'], ['nIstek', 'n_istek'], ['n429', 'n_429'],
  ['n5xx', 'n_5xx'], ['dropped', 'dropped'], ['istekSunucu', 'istek_sunucu'], ['rpsSunucu', 'rps_sunucu'], ['cpuMsIstek', 'cpu_ms_istek'],
  ['hostCpuOrt', 'host_cpu_ort'], ['kapasiteRps', 'kapasite_rps'], ['srtP50', 'srt_p50'], ['srtP95', 'srt_p95'], ['srtP99', 'srt_p99'],
];
/** TUR soneki `_rN` -> tekrar sirasi (kos.sh adlandirmasi R<id>_<SEN>_<KIP>_<AE>_<hiz>_r<tekrar>). */
const TEKRAR_SONEKI = /_r(\d+)$/;
export function adimNormalle(x: unknown): NlAdim {
  const r = nesne(x);
  // ham: analiz.cjs adimSatiri'nin ham nesnesi (sunucu JSON'u cozer; metin gelirse burada cozulur).
  const ham = jsonNesne(alan(r, 'ham')) ?? {};
  const tur = String(alan(r, 'tur') ?? '');
  const sonek = TEKRAR_SONEKI.exec(tur);
  const a = {
    tur, senaryo: metinVeya(alan(r, 'senaryo')), kip: metinVeya(alan(r, 'kip')), ae: metinVeya(alan(r, 'ae')),
    hiz: sayiVeya(alan(r, 'hiz')), deneme: sayiVeya(alan(r, 'deneme')),
    tekrar: sonek ? Number(sonek[1]) : sayiVeya(ham.tekrar),
    uyarilar: metinDizisi(ham.uyarilar),
    pencereKaynak: metinVeya(alan(ham, 'pencere_kaynak', 'pencereKaynak')),
    gecerlilik: (metinVeya(alan(r, 'gecerlilik')) as NlAdimGecerlilik | null), nedenler: metinDizisi(alan(r, 'nedenler')),
    sikistirmaTuru: metinVeya(alan(r, 'sikistirmaTuru', 'sikistirma_turu')),
  } as NlAdim;
  for (const [k, s] of ADIM_ALANLARI) (a as unknown as Record<string, number | null>)[k] = sayiVeya(alan(r, k, s));
  return a;
}
/** GET /kosular/:id `durdurIsi` ({ awxServerId, awxJobId }; durdur yanitindaki `jobId` de kabul) -> is numarasi yoksa null. */
function durdurIsiNormalle(x: unknown): NlKosuAyrinti['durdurIsi'] {
  const o = jsonNesne(x);
  const jobId = o ? sayiVeya(alan(o, 'awxJobId', 'jobId', 'awx_job_id')) : null;
  if (!o || jobId == null || jobId <= 0) return null;
  return { awxServerId: sayiVeya(alan(o, 'awxServerId', 'awx_server_id')), awxJobId: jobId };
}
export function onKontrolNormalle(x: unknown): NlOnKontrol | null {
  const ham = jsonNesne(x);
  if (!ham || !Object.keys(ham).length) return null;
  const sik = jsonNesne(alan(ham, 'sikistirma'));
  const hatalar = alan(ham, 'ilkHatalar', 'ilk_hatalar');
  return {
    ipYerel: mantikVeya(alan(ham, 'ipYerel', 'ip_yerel')), serverNameVar: mantikVeya(alan(ham, 'serverNameVar', 'server_name_var')),
    masterSayisi: sayiVeya(alan(ham, 'masterSayisi', 'master_sayisi')), webLogDf: sayiVeya(alan(ham, 'webLogDf', 'web_log_df')),
    logDiziniOkunur: mantikVeya(alan(ham, 'logDiziniOkunur', 'log_dizini_okunur')), logFormatUa: mantikVeya(alan(ham, 'logFormatUa', 'log_format_ua')),
    statikDirektif: mantikVeya(alan(ham, 'statikDirektif', 'statik_direktif')), k6Var: mantikVeya(alan(ham, 'k6Var', 'k6_var')),
    k6Surum: metinVeya(alan(ham, 'k6Surum', 'k6_surum')), k6Sha256: metinVeya(alan(ham, 'k6Sha256', 'k6_sha256')),
    yollarToplam: sayiVeya(alan(ham, 'yollarToplam', 'yollar_toplam')), yollar200: sayiVeya(alan(ham, 'yollar200', 'yollar_200')),
    ilkHatalar: (Array.isArray(hatalar) ? hatalar : []).map((h) => { const o = nesne(h); return { yol: String(o.yol ?? ''), status: String(o.status ?? '') }; }),
    sikistirma: sik ? { statik: sayiVeya(sik.statik), dinamik: sayiVeya(sik.dinamik), sikistirmasiz: sayiVeya(sik.sikistirmasiz) } : null,
  };
}
export function kosuNormalle(x: unknown): NlKosuAyrinti {
  const r = nesne(x);
  const p = jsonNesne(alan(r, 'parametreler'));
  // sonuc = maskeli set_stats + portal_analiz { ozet, uyarilar } (poller) ya da { hata } (okunamadi).
  const sonuc = jsonNesne(alan(r, 'sonucOzet'));
  const pa = sonuc ? jsonNesne(sonuc.portal_analiz) : null;
  const oz = pa ? jsonNesne(pa.ozet) : null;
  return {
    ...(r as unknown as NlKosu),
    id: Number(r.id), awxJobId: sayiVeya(alan(r, 'awxJobId', 'awx_job_id')),
    parametreler: p ? (p as unknown as NlKosuAyrinti['parametreler']) : null,
    onKontrol: onKontrolNormalle(alan(r, 'onKontrol', 'on_kontrol_ozet')),
    gecersizNedenleri: metinDizisi(alan(r, 'gecersizNedenleri', 'gecersiz_nedenleri')),
    sonucOzet: sonuc,
    onKontrolKosuId: sayiVeya(alan(r, 'onKontrolKosuId', 'on_kontrol_kosu_id')),
    sunucuDegerlendirmesi: Array.isArray(r.onKontrolEngelleri) || Array.isArray(r.onKontrolUyarilari)
      ? { engeller: metinDizisi(r.onKontrolEngelleri), uyarilar: metinDizisi(r.onKontrolUyarilari) } : null,
    onKontrolYasSn: sayiVeya(r.onKontrolYasSn),
    isDurumu: metinVeya(sonuc?.durum), isHatasi: metinVeya(sonuc?.hata),
    analiz: {
      nproc: sayiVeya(oz?.nproc ?? sonuc?.nproc), cpuTlsliPay: sayiVeya(oz?.cpu_tlsli_pay ?? sonuc?.cpu_tlsli_pay),
      uyarilar: metinDizisi(pa?.uyarilar ?? sonuc?.uyarilar), okumaHatasi: metinVeya(pa?.hata),
    },
    durdurIsi: durdurIsiNormalle(alan(r, 'durdurIsi')),
    sonuclandirmaDenemesi: sayiVeya(alan(r, 'sonuclandirmaDenemesi', 'sonuclandirma_denemesi')) ?? 0,
  };
}
function karsilastirmaNormalle(x: NlKarsilastirma & { tablo?: unknown[] }): NlKarsilastirma {
  const sayilar = (o: unknown) => Object.fromEntries(Object.entries(nesne(o)).map(([k, v]) => [k, sayiVeya(v)]));
  return {
    ...x, nedenler: metinDizisi(x.nedenler),
    tablo: (Array.isArray(x.tablo) ? x.tablo : []).map((t) => {
      const r = nesne(t);
      const taraf = (o: unknown) => (o && typeof o === 'object' && !Array.isArray(o) ? (o as Ham) : null);
      return { hiz: sayiVeya(r.hiz), ref: taraf(r.ref), aday: taraf(r.aday), farkYuzde: sayilar(alan(r, 'farkYuzde', 'fark_yuzde')) };
    }),
  };
}

export const nginxLoadtestApi = {
  hedefler: (): Promise<NlHedefler> => fetch(`${BASE}/hedefler`).then((r) => okJson<NlHedefler>(r)),
  senaryolar: (): Promise<{ ok: true; senaryolar: NlSenaryo[] }> => fetch(`${BASE}/senaryolar`).then((r) => okJson(r)),
  senaryo: (id: number): Promise<{ ok: true; senaryo: NlSenaryoAyrinti }> => fetch(`${BASE}/senaryolar/${id}`).then((r) => okJson(r)),
  senaryoKaydet: (body: NlYeniSenaryo): Promise<NlEylem> => fetch(`${BASE}/senaryolar`, json(body)).then(safeJson),
  senaryoSil: (id: number): Promise<NlEylem> => fetch(`${BASE}/senaryolar/${id}`, { method: 'DELETE' }).then(safeJson),
  onKontrol: (body: {
    senaryoId: number; hedefHost: string; hedefIp: string; vhost: string; yukHost: string; sni: boolean; parametreler: NlParametreler; etiket?: string;
  }): Promise<NlEylem> => fetch(`${BASE}/kosular/on-kontrol`, json(body)).then(safeJson),
  baslat: (body: { onKontrolKosuId: number; confirmText: string; uyariOnay: boolean }): Promise<NlEylem> => fetch(`${BASE}/kosular`, json(body)).then(safeJson),
  /** Liste (id azalan). `dahaVar`: bu sayfadan daha eski kayit var (`onceki` = sayfadaki en kucuk id ile devam). */
  kosular: async (o: NlKosuSuzgeci = {}): Promise<{ ok: true; kosular: NlKosu[]; dahaVar: boolean }> => {
    const q = new URLSearchParams();
    if (o.islem) q.set('islem', o.islem);
    if (o.durum) q.set('durum', o.durum);
    if (o.hedef) q.set('hedef', o.hedef);
    if (o.onceki != null) q.set('onceki', String(o.onceki));
    if (o.limit) q.set('limit', String(o.limit));
    const s = q.toString();
    const r = await okJson<{ ok: true; kosular?: NlKosu[]; dahaVar?: unknown }>(await fetch(`${BASE}/kosular${s ? `?${s}` : ''}`));
    return { ...r, kosular: Array.isArray(r.kosular) ? r.kosular : [], dahaVar: r.dahaVar === true };
  },
  kosu: async (id: number): Promise<{ ok: true; kosu: NlKosuAyrinti; adimlar: NlAdim[] }> => {
    const r = await okJson<{ ok: true; kosu: unknown; adimlar?: unknown[] }>(await fetch(`${BASE}/kosular/${id}`));
    return { ok: true, kosu: kosuNormalle(r.kosu), adimlar: (Array.isArray(r.adimlar) ? r.adimlar : []).map(adimNormalle) };
  },
  /** Admin. `since`: istemcide olan cikti uzunlugu (artimli okuma); ekran gelen metni `ciktiBirlestir` ile ekler. */
  durum: (id: number, since: number, signal?: AbortSignal): Promise<NlDurumYaniti | NlRet> =>
    fetch(`${BASE}/kosular/${id}/durum?since=${Math.max(0, Math.floor(since))}`, { signal }).then(safeJson),
  /** Admin. 409 `baslatiliyor` (koşu henuz AWX isini almadi), 424 `durdur_baslatilamadi` (kosu: durdur isi baslamadi). */
  durdur: (id: number): Promise<NlEylem> => fetch(`${BASE}/kosular/${id}/durdur`, json({})).then(safeJson),
  /** Admin. Sonucu okunamamis kosuyu yeniden FINALIZING'e alir (poller okur); 409 `yeniden_okunamaz`. */
  yenidenOku: (id: number): Promise<NlEylem> => fetch(`${BASE}/kosular/${id}/yeniden-oku`, json({})).then(safeJson),
  karsilastir: async (o: { ref: number; aday: number; esikCpu?: number; esikP95?: number }): Promise<NlKarsilastirma> => {
    const q = new URLSearchParams({ ref: String(o.ref), aday: String(o.aday) });
    if (o.esikCpu != null) q.set('esikCpu', String(o.esikCpu));
    if (o.esikP95 != null) q.set('esikP95', String(o.esikP95));
    return karsilastirmaNormalle(await okJson<NlKarsilastirma>(await fetch(`${BASE}/karsilastir?${q}`)));
  },
};
