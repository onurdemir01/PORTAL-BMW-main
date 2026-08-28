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
import type { User } from "@/types";

export interface MeResponse {
  ok: boolean;
  user?: User;
}

export interface SessionRestoreDeps {
  fetchFn?: (input: string) => Promise<Response>;
  sleep?: (ms: number) => Promise<void>;
  /** Yeniden deneme aralıkları (ms). Uzunluğu = ek deneme sayısı. */
  delays?: number[];
  /** Denemeler arasında iptal edildi mi (unmount). */
  cancelled?: () => boolean;
  onGiveUp?: (attempts: number) => void;
}

// Toplam ~11 saniye. Tipik bir Node restart'ı bunun altında tamamlanıyor; daha uzun
// beklemek, gerçekten çıkmış bir kullanıcıyı boş ekranda tutmak olurdu.
const DEFAULT_DELAYS = [400, 800, 1600, 3000, 5000];

export async function fetchSessionWithRetry(deps: SessionRestoreDeps = {}): Promise<MeResponse | null> {
  const doFetch = deps.fetchFn ?? ((u: string) => fetch(u));
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const delays = deps.delays ?? DEFAULT_DELAYS;
  const cancelled = deps.cancelled ?? (() => false);

  for (let attempt = 0; ; attempt++) {
    if (cancelled()) return null;
    let transient = false;
    try {
      const r = await doFetch("/api/auth/me");
      if (r.status >= 200 && r.status < 300) {
        return (await r.json()) as MeResponse;
      }
      // 4xx KESİNDİR: 401 oturum yok, 400/403 de yeniden denemekle düzelmez.
      // Yalnızca 5xx sunucunun geçici durumunu anlatır.
      if (r.status < 500) return null;
      transient = true;
    } catch {
      // Ağ hatası: sunucu kapalı/yeniden başlıyor ya da proxy cevap vermiyor.
      transient = true;
    }

    if (!transient || attempt >= delays.length) {
      if (transient) deps.onGiveUp?.(attempt + 1);
      return null;
    }
    await sleep(delays[attempt]);
  }
}
