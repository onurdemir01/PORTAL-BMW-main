// src/api/http.ts — tum src/api/*.ts dosyalarinin ortak kullandigi guvenli JSON
// ayristirici. Sunucu (dev ortaminda Vite proxy hedefi gecici erisilemez oldugunda,
// veya beklenmedik bir hatada) JSON yerine HTML donebilir ("Unexpected token '<'"
// hatasi buradan gelir) — safeJson bunu content-type kontrolu ile yakalayip
// durum kodu + govde-onizlemesi iceren OKUNABILIR bir hata firlatir.
// AG GECIDI DURUMLARI. Portal yeniden baslatilirken (surum yukleme akisi:
// stop -> mv -> start) nginx, Node ayaga kalkana dek 502/503/504 doner ve
// govdesi cogu kurulumda portalin KENDI index.html'idir.
//
// URETIM (2026-09-18, HAR kaniti): `POST /api/scalex/run` 503 dondu ve asagidaki
// govde-onizlemesi yuzunden kullanici ekranda sunu gordu:
//   "Sunucu beklenmeyen bir yanit dondu (HTTP 503) ... [<!doctype html> <html lang="tr"> ...]"
// 30 saniye sonra ayni istek 200 donuyordu. Yani gecici ve KENDILIGINDEN gecen
// bir durum, kullaniciya ham HTML olarak gosterildi.
const GATEWAY_STATUSES = [502, 503, 504];

export async function safeJson(res: Response): Promise<any> {
  const contentType = res.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    const text = await res.text().catch(() => '');
    // GECIT DURUMUNDA GOVDE YAPISTIRILMAZ. HTML burada BEKLENEN cevaptir;
    // onizlemesi kullaniciya hicbir sey anlatmaz, yalnizca korkutur.
    if (GATEWAY_STATUSES.includes(res.status)) {
      throw Object.assign(
        new Error(
          'Portal şu an yeniden başlatılıyor ya da geçici olarak yanıt vermiyor ' +
            `(HTTP ${res.status}). Birkaç saniye sonra tekrar deneyin; sürerse yöneticiye bildirin.`,
        ),
        // `gatewayUnavailable`: cagiran tarafin "bu gecici, yeniden dene" ile
        // "bu kalici, dur" ayrimini yapabilmesi icin. `bodyPreview` kullaniciya
        // GOSTERILMEZ ama konsol/teshis icin hatada durur — govdeyi mesajdan
        // cikarmak teshis ipucunu tamamen yok etmemeli.
        { status: res.status, gatewayUnavailable: true, bodyPreview: text.slice(0, 150) },
      );
    }
    // DIGER DURUMLARDA ONIZLEME KALIR — bu fonksiyonun var olus sebebi o:
    // beklenmedik bir content-type'ta ham govdenin ilk satirlari teshis icin
    // tek ipucu olabiliyor.
    throw Object.assign(
      new Error(
        `Sunucu beklenmeyen bir yanıt döndü (HTTP ${res.status}) — lütfen tekrar deneyin veya yöneticiye bildirin.` +
          (text ? ` [${text.slice(0, 150).replace(/\s+/g, ' ')}]` : ''),
      ),
      { status: res.status },
    );
  }
  // OK OLMAYAN JSON yanitlari da status tasimali — or. 401/403 `res.json()` basarili
  // donebilir (`{ ok: false, message: "..." }`) ama caller'in HTTP durumunu bilmesi
  // gerekir (polling dongusu 403'te durmali, 502'de yeniden denemeli).
  const body = await res.json();
  if (!res.ok && body && typeof body === 'object') {
    return Object.assign(body, { _httpStatus: res.status });
  }
  return body;
}

/** `okJson`'un firlattigi hata: sunucunun mesaji + HTTP durumu (+ varsa hata kodu). */
export type ApiError = Error & { status: number; code?: string };

/**
 * KATI ayristirici: yanit basarisizsa (4xx/5xx) REDDEDER.
 *
 * NEDEN VAR (2026-10-07): `safeJson` basarisiz JSON yanitlarinda reddetmez, govdeyi
 * (`{ ok: false, message }`) dondurur. Bunu bilerek kullanan cagrilar var (run/poll
 * `ok` ve `_httpStatus`a bakiyor). Ama LISTE uclarinda cagiranlar alani kontrolsuz
 * yaziyordu — `setApps(r.apps)`, `setHosts(r.hosts)`, `setTree(r.tree)` — ve sunucu 500
 * ya da 403 donunce state `undefined` oluyor, sayfa "Cannot read properties of undefined"
 * ile TUMUYLE dusuyordu (Telnet ve FileX; kullanici "yetkiniz yok" mesajini hic gormuyordu).
 * Ayni kok "hata"yi "kayit yok" diye de gosteriyordu: `r.items ?? []` bos liste = "yok".
 *
 * Mesaj sirasi: `message`, sonra `error` (sunucu modulleri ikisini de kullaniyor), sonra
 * durum kodu. Ham govde METNI kullaniciya basilmaz (Otomasyon sayfasi `{"ok":false,...}`
 * gosteriyordu).
 */
export async function okJson<T = any>(res: Response): Promise<T> {
  const body = await safeJson(res);
  if (!res.ok) {
    const b = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
    const mesaj =
      (typeof b.message === 'string' && b.message.trim()) ||
      (typeof b.error === 'string' && b.error.trim()) ||
      `Sunucu hatası (HTTP ${res.status}).`;
    throw Object.assign(new Error(mesaj), {
      status: res.status,
      ...(typeof b.code === 'string' ? { code: b.code } : {}),
    }) as ApiError;
  }
  return body as T;
}
