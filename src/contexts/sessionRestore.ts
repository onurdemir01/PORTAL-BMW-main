// src/contexts/sessionRestore.ts — açılışta oturumu geri yükleme (GET /api/auth/me).
//
// SORUN (2026-08-28, kullanıcı bildirimi: "release geçtiğimde herkesin session'ı
// düşüyor"): AuthContext bu isteği TEK SEFER atıyor ve `r.ok` değilse sonucu "oturum
// yok" sayıyordu. Oysa `/api/auth/me` iki BAMBAŞKA durumu farklı kodlarla anlatıyor:
//
//   401           -> KESİN: oturum yok / süresi dolmuş  → login ekranı DOĞRU
//   5xx, ağ hatası -> GEÇİCİ: sunucu o an ayakta değil  → login ekranı YANLIŞ
//
// Release sırasında backend birkaç saniye kapalı kalıyor; o pencerede sayfayı açan
// ya da yenileyen herkesin isteği ağ hatası/502 ile dönüyor ve uygulama, çerezi ve
// DB'deki oturumu GAYET GEÇERLİ olduğu hâlde kullanıcıyı çıkmış sayıyordu. Sunucu
// tarafında bir şey bozulmuş değil — istemci tek denemede pes ediyordu.
//
// Çözüm: geçici hatalarda kısa bir süre yeniden dene. Deneme boyunca AuthContext
// `loading` durumunda kaldığı için kullanıcı login ekranı GÖRMEZ, boş ekran görür.
//
// Bağımlılıklar dışarıdan verilebilir (fetch/sleep) — böylece davranış gerçek ağ ve
// gerçek bekleme olmadan test edilebilir.

// Kullanıcı şekli TEK kaynaktan gelsin: src/types.ts. Burada ayrı bir kopya tanımlamak,
// `role` gibi bir alan daraldığında iki tarafın sessizce ayrışması demek olurdu
// (nitekim ilk yazımda `role: string` denmiş ve tsc "Admin"|"User" ile uyuşmadığını
// yakalamıştı — kopya tanım o hatayı gizleyebilirdi).
import type { User } from '@/types';

export interface MeResponse {
  ok: boolean;
  user?: User;
}

export interface SessionRestoreDeps {
  fetchFn?: (input: string, init?: RequestInit) => Promise<Response>;
  /** Header ve JSON govdesi dahil tek denemenin ust siniri (ms). */
  timeoutMs?: number;
  sleep?: (ms: number) => Promise<void>;
  /** Yeniden deneme aralıkları (ms). Uzunluğu = ek deneme sayısı. */
  delays?: number[];
  /** Denemeler arasında iptal edildi mi (unmount). */
  cancelled?: () => boolean;
  onGiveUp?: (attempts: number) => void;
}

// Bekleme araliklari toplam ~11 saniye; buna en fazla alti adet 10 saniyelik
// istek eklenir. Yanit/govde gelmeyen baglanti da artik sinirli surede biter.
const DEFAULT_DELAYS = [400, 800, 1600, 3000, 5000];

export async function fetchSessionWithRetry(
  deps: SessionRestoreDeps = {},
): Promise<MeResponse | null> {
  const doFetch = deps.fetchFn ?? fetch;
  const timeoutMs = deps.timeoutMs ?? 10_000;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const delays = deps.delays ?? DEFAULT_DELAYS;
  const cancelled = deps.cancelled ?? (() => false);

  for (let attempt = 0; ; attempt++) {
    if (cancelled()) return null;
    let transient = false;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    // Yalniz headers degil r.json() da bu sureye dahil. Promise.race, abort'u
    // dikkate almayan bir istemcinin bile restore islemini askida tutmasini onler.
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(new Error('Session restore timed out'));
        controller.abort();
      }, timeoutMs);
    });
    try {
      return await Promise.race([
        (async () => {
          const r = await doFetch('/api/auth/me', { signal: controller.signal });
          if (r.status >= 200 && r.status < 300) {
            return (await r.json()) as MeResponse;
          }
          // 4xx kesindir; 5xx ve timeout gecici hata olarak yeniden denenir.
          if (r.status < 500) return null;
          throw new Error('Session restore temporarily unavailable');
        })(),
        deadline,
      ]);
    } catch {
      transient = true;
    } finally {
      clearTimeout(timer!);
    }

    if (!transient || attempt >= delays.length) {
      if (transient) deps.onGiveUp?.(attempt + 1);
      return null;
    }
    await sleep(delays[attempt]);
  }
}
