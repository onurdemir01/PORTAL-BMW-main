// src/components/server_hub/retirementCikti.ts — "İş çıktısı" gorunumunun SAF yardimcilari (2026-10-26).
//
// Kullanici: "is ciktisini gormek icin bir buton koy". Liste sunucudan gelir (RtTarget.awxIsleri), istemci
// is TURETMEZ; burada yalniz etiket, varsayilan secim, yoklama araligi, hata siniflamasi ve hata ozeti var.
// Yoklama kurallari (useIsCiktisi): cikti uzadiysa 1,5 sn, uzamadiysa / kuyruktaysa 3 sn; gecici hatada
// 3-6-12-24-30 sn geri cekilme, 6. hatada durur; kalici hatada (409, 401/403/404) hemen durur.
import type { RtHedefIs, RtIsAdim, RtWeb2 } from '@/api/retirementApi';

/** Ayrinti satirini acan yerin ipucu: hangi isin secilecegi (adim [+web] ya da is no). */
export interface IsIpucu { adim?: RtIsAdim; web?: number; jobId?: number }

/** Listede bir isin kimligi: adim (+ web sirasi). Is numarasi DEGIL: ayni adimin yeni isi ayni yere oturur. */
export const isAnahtari = (x: { adim: RtIsAdim; web?: number }) => `${x.adim}${x.web != null ? `:${x.web}` : ''}`;

const ADIM_ETIKETI: Record<RtIsAdim, string> = {
  onkontrol: 'Ön kontrol', stop: 'JBoss STOP', web: 'Web', delete_onkontrol: 'Silme ön kontrolü',
  delete: 'DELETE', rollback_onkontrol: 'Geri alma ön kontrolü', rollback: 'Geri alma',
};
// Web girdisinde geri acma isi YALNIZ bu iki durumda: restore_manual / restore_failed'ta geri acma hic
// baslamadi, jobId hala (basarili) kaldirma isidir (sunucu notu, is-ciktisi.cjs WEB_DURUMU).
const GERI_ACMA = new Set(['restoring', 'restored']);

/** Listede ve goruntuleyicide isin adi; web isinde ServerName (ipucu host). */
export function isEtiketi(is: Pick<RtHedefIs, 'adim' | 'web'>, webSonuc?: RtWeb2[] | null): { etiket: string; ipucu?: string } {
  if (is.adim !== 'web') return { etiket: ADIM_ETIKETI[is.adim] || is.adim };
  const w = is.web != null ? (webSonuc || [])[is.web] : undefined;
  if (!w) return { etiket: `Web #${(is.web ?? 0) + 1}` };
  return { etiket: `${GERI_ACMA.has(w.status) ? 'Web geri açma' : 'Web'}: ${w.serverName}`, ipucu: w.host };
}

/** Varsayilan secim: ipucunun adimi (+web) > ipucunun is no'su (sondan) > suren is > son basarisiz > son is. */
export function varsayilanIs(isler: RtHedefIs[], ipucu?: IsIpucu | null): RtHedefIs | null {
  const l = isler || [];
  if (!l.length) return null;
  if (ipucu?.adim) {
    const a = l.find((x) => x.adim === ipucu.adim && (ipucu.web == null || x.web === ipucu.web));
    if (a) return a;
  }
  if (ipucu?.jobId != null) {
    const j = [...l].reverse().find((x) => x.jobId === ipucu.jobId);
    if (j) return j;
  }
  return l.find((x) => x.durum === 'suruyor') || [...l].reverse().find((x) => x.durum === 'basarisiz') || l[l.length - 1];
}

/** Ipucu (adim [+web] ya da is no) listede bir ise denk geliyor mu; ipucu yoksa true. Denk gelmezse
 *  varsayilanIs BASKA bir ise duser: ekran bunu soylemeli ("Canlı çıktıyı izle" bitmis on kontrolu acmasin). */
export function ipucuEslesir(isler: RtHedefIs[], ipucu?: IsIpucu | null): boolean {
  if (!ipucu || (ipucu.adim == null && ipucu.jobId == null)) return true;
  return (isler || []).some((x) => (ipucu.adim != null ? x.adim === ipucu.adim && (ipucu.web == null || x.web === ipucu.web) : x.jobId === ipucu.jobId));
}

/** Hata ozeti: fatal / FAILED! / ERROR! / FAIL satirlari ve PLAY RECAP'te failed|unreachable >= 1.
 *  "FAILED - RETRYING" (yeniden deneme) ve failed=0 SECILMEZ. En cok 6 satir, metin 300 karakter. */
export function hataOzeti(output: string | null | undefined): { satir: number; metin: string }[] {
  const out: { satir: number; metin: string }[] = [];
  const satirlar = String(output ?? '').split('\n');
  for (let i = 0; i < satirlar.length && out.length < 6; i += 1) {
    const s = satirlar[i].replace(/\r$/, '');
    if (/FAILED - RETRYING/.test(s)) continue;
    if (/^fatal: /.test(s) || /FAILED! =>/.test(s) || /^ERROR!/.test(s) || /\tFAIL\t/.test(s) || /\b(?:failed|unreachable)=[1-9]\d*/.test(s))
      out.push({ satir: i + 1, metin: s.length > 300 ? `${s.slice(0, 300)}…` : s });
  }
  return out;
}

/** Sure metni: <60 "N sn"; <3600 "M dk SS sn"; ustu "H sa MM dk". */
export function sureMetni(sn: number | null | undefined): string {
  const s = Math.max(0, Math.floor(Number(sn) || 0));
  if (s < 60) return `${s} sn`;
  if (s < 3600) return `${Math.floor(s / 60)} dk ${String(s % 60).padStart(2, '0')} sn`;
  return `${Math.floor(s / 3600)} sa ${String(Math.floor((s % 3600) / 60)).padStart(2, '0')} dk`;
}

const KUYRUK = new Set(['new', 'pending', 'waiting']);
/** Sonraki yoklamaya kadar bekleme: cikti uzadiysa 1500 ms; uzamadiysa ya da is kuyruktaysa 3000 ms. */
export const yoklamaGecikmesi = (uzadi: boolean, status: string | null | undefined): number => (uzadi && !KUYRUK.has(String(status || '')) ? 1500 : 3000);

/** Ust uste gecici hata sayisi n (1'den) icin bekleme: 3, 6, 12, 24, 30 sn. */
export const geriCekilme = (n: number): number => Math.min(3000 * 2 ** Math.max(0, n - 1), 30000);
/** Bu kadar ust uste gecici hatadan sonra otomatik deneme durur ("Yeniden dene"). */
export const EN_COK_DENEME = 6;

export type CiktiSinifi = 'veri' | 'kalici' | 'gecici' | 'iptal';
const KALICI_HTTP = new Set([400, 401, 403, 404, 409]);
type Hata = { name?: string; status?: number; gatewayUnavailable?: boolean };

/** Yanit ya da firlatilan hata -> sinif. ok:false'ta `kalici` bayragi; bayrak yoksa (eski / kapi yaniti) HTTP kodu.
 *  Firlatilan 401/403/404 kalici; gecit (502/503/504), >=500 ve ag hatasi (TypeError) gecici; AbortError yok sayilir. */
export function ciktiSonucu(x: unknown): CiktiSinifi {
  if (x && typeof x === 'object' && 'ok' in x && !(x instanceof Error)) {
    const r = x as { ok: boolean; kalici?: boolean; _httpStatus?: number };
    if (r.ok === true) return 'veri';
    if (typeof r.kalici === 'boolean') return r.kalici ? 'kalici' : 'gecici';
    return KALICI_HTTP.has(Number(r._httpStatus)) ? 'kalici' : 'gecici';
  }
  const e = (x || {}) as Hata;
  if (e.name === 'AbortError') return 'iptal';
  if (e.gatewayUnavailable) return 'gecici';
  if (e.status === 401 || e.status === 403 || e.status === 404) return 'kalici';
  return 'gecici';
}

/** Ret ya da hatanin kodu ve sunucu mesaji (kaliciMesaj icin). */
export function redBilgisi(x: unknown): { code: string; message: string } {
  if (x && typeof x === 'object' && 'ok' in x && !(x instanceof Error)) {
    const r = x as { code?: string; message?: string; _httpStatus?: number };
    return { code: r.code || (r._httpStatus ? `http_${r._httpStatus}` : 'bilinmiyor'), message: r.message || '' };
  }
  const e = (x || {}) as Hata & { message?: string; code?: string };
  return { code: e.code || (e.status ? `http_${e.status}` : 'ag'), message: e.message || '' };
}

/** Kalici retin kullaniciya metni (sunucu mesajina istemci aciklamasi eklenir; sunucu eki zaten yazdiysa
 *  tekrarlanmaz). template_uyusmuyor'da sunucunun teshisi (gercek / beklenen playbook) korunur. */
export function kaliciMesaj(code: string, message?: string, o: { jobId?: number; gecis?: boolean } = {}): string {
  switch (code) {
    case 'awx_server_missing': {
      const m = message || 'AWX sunucusu devre dışı.';
      return /arşivinde de yok/.test(m) ? m : `${m} Bu işin çıktısı Portal arşivinde de yok.`;
    }
    case 'awx_job_missing': return 'AWX bu işi artık tutmuyor (temizlenmiş olabilir); Portal arşivinde kopyası yok.';
    case 'sunucu_belirsiz': return 'İşin hangi AWX sunucusunda çalıştığı kanıtlanamadı; aynı numaralı başka bir işi göstermemek için çıktı okunmadı.';
    case 'template_uyusmuyor': return message || `AWX’teki #${o.jobId ?? '?'} bu adımın playbook’u değil; çıktı gösterilmedi.`;
    case 'is_yok': return `Bu adımın AWX iş numarası kayıtlı değil.${o.gecis ? ' ‘Durumu tazele’ ya da uzlaştırma ile bağlanabilir.' : ''}`;
    case 'hedef_yok': return 'Hedef bu kayıtta yok (kayıttan çıkarılmış olabilir).';
    case 'gecersiz': return 'İstek geçersiz.';
    case 'http_401': return 'Oturum sona erdi — sayfayı yenileyin';
    case 'http_403': return 'Bu görünüm yalnız Admin (Retirement)';
    case 'http_404': return 'Portal sunucusu bu sürümde iş çıktısı ucunu sunmuyor';
    default: return message || 'İş çıktısı okunamadı.';
  }
}
