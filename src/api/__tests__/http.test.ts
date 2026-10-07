// src/api/__tests__/http.test.ts — `safeJson` AG GECIDI davranisi.
//
// URETIM (2026-09-18, HAR kaniti): portal yeniden baslatilirken nginx
// `POST /api/scalex/run` icin 503 + portalin KENDI index.html'ini dondurdu.
// `safeJson` govdenin ilk 150 karakterini kullanici mesajina YAPISTIRDI ve
// ekranda su gorundu:
//   "Sunucu beklenmeyen bir yanit dondu (HTTP 503) ... [<!doctype html> <html lang="tr"> ...]"
// 30 saniye sonra ayni istek 200 donuyordu — yani gecici ve kendiliginden gecen
// bir durum, kullaniciya ham HTML olarak gosterildi.
//
// Bu dosya PORTAL GENELINI korur: `safeJson` tum `src/api/*` tarafindan kullaniliyor.
import { describe, it, expect } from 'vitest';
import { safeJson } from '@/api/http';

const SPA_HTML = '<!doctype html>\n<html lang="tr">\n  <head>\n    <meta charset="UTF-8" />';

function htmlResponse(status: number, body = SPA_HTML) {
  return new Response(body, { status, headers: { 'content-type': 'text/html; charset=utf-8' } });
}

async function errorOf(res: Response): Promise<Error & { status?: number }> {
  try {
    await safeJson(res);
  } catch (e) {
    return e as Error & { status?: number };
  }
  throw new Error('safeJson hata firlatmadi');
}

describe('safeJson ag gecidi davranisi', () => {
  // HTTP1 — ASIL DUZELTME.
  it.each([502, 503, 504])('HTTP1 %i + HTML govdeyi kullaniciya SIZDIRMIYOR', async (status) => {
    const err = await errorOf(htmlResponse(status));
    expect(err.message).not.toContain('<!doctype');
    expect(err.message).not.toContain('<html');
    expect(err.message).toContain(String(status));
    // Kullanici NE YAPACAGINI bilmeli: gecici, kendiliginden gecer, tekrar dene.
    expect(err.message).toMatch(/tekrar deneyin/i);
    expect(err.status).toBe(status);
  });

  // HTTP2 — GEVSEMEDIGINI KANITLA. Onizleme bu fonksiyonun VAR OLUS SEBEBI;
  // beklenmedik bir content-type'ta ham govdenin ilk satirlari tek teshis ipucu.
  it('HTTP2 diger durumlarda govde onizlemesi DURUYOR', async () => {
    const err = await errorOf(htmlResponse(500, '<h1>Beklenmedik sablon hatasi</h1>'));
    expect(err.message).toContain('Beklenmedik sablon hatasi');
    expect(err.status).toBe(500);
  });

  // HTTP3 — JSON yolu bozulmadi: OK olmayan JSON yanitlari `_httpStatus` tasimali
  // (yoklama donguleri 403'te durmali, 502'de yeniden denemeli).
  it('HTTP3 JSON yanitlari `_httpStatus` tasimaya devam ediyor', async () => {
    const res = new Response(JSON.stringify({ ok: false, message: 'yok' }), {
      status: 403,
      headers: { 'content-type': 'application/json' },
    });
    const body = await safeJson(res);
    expect(body._httpStatus).toBe(403);
    expect(body.message).toBe('yok');
  });

  it('HTTP4 basarili JSON dokunulmadan geciyor', async () => {
    const res = new Response(JSON.stringify({ ok: true, n: 1 }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
    expect(await safeJson(res)).toEqual({ ok: true, n: 1 });
  });
});

// ── okJson: KATI ayristirici (2026-10-07) ────────────────────────────────────────────────
// `safeJson` basarisiz JSON yanitinda reddetmez. Liste uclarini kontrolsuz okuyan ekranlar
// (`setApps(r.apps)`) bu yuzden 500/403'te cokuyor ya da "hata"yi "kayit yok" diye
// gosteriyordu. `okJson` reddeder ve sunucunun mesajini tasir.
import { okJson, type ApiError } from '@/api/http';

const jsonYanit = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

async function katiHata(res: Response): Promise<ApiError> {
  try {
    await okJson(res);
  } catch (e) {
    return e as ApiError;
  }
  throw new Error('okJson hata firlatmadi');
}

describe('okJson', () => {
  it('OK1 basarili yanit govdeyi aynen verir', async () => {
    expect(await okJson(jsonYanit(200, { ok: true, apps: ['A'] }))).toEqual({
      ok: true,
      apps: ['A'],
    });
  });

  it.each([
    [
      500,
      { ok: false, message: 'Envanter veritabanına ulaşılamadı.' },
      'Envanter veritabanına ulaşılamadı.',
    ],
    [403, { ok: false, error: 'Bu işlem için yetkiniz yok.' }, 'Bu işlem için yetkiniz yok.'],
    // `message` ile `error` birlikteyse kullaniciya yazilan (`message`) once gelir.
    [400, { message: 'Geçersiz uygulama adı.', error: 'bad_request' }, 'Geçersiz uygulama adı.'],
    [502, { ok: false }, 'Sunucu hatası (HTTP 502).'],
    [500, { message: '   ' }, 'Sunucu hatası (HTTP 500).'],
    [500, 'duz metin', 'Sunucu hatası (HTTP 500).'],
  ])('OK2 %i: REDDEDER, mesaj sunucudan (ham govde degil)', async (status, body, beklenen) => {
    const err = await katiHata(jsonYanit(status, body));
    expect(err.message).toBe(beklenen);
    expect(err.message).not.toContain('{');
    expect(err.status).toBe(status);
  });

  it('OK3 hata kodu varsa hataya ilistirilir', async () => {
    const err = await katiHata(jsonYanit(409, { message: 'Çakışma', code: 'conflict' }));
    expect(err.code).toBe('conflict');
    expect((await katiHata(jsonYanit(409, { message: 'x' }))).code).toBeUndefined();
  });

  it('OK4 JSON olmayan hata govdesi safeJson davranisini korur (HTML sizmaz, durum tasinir)', async () => {
    const err = await katiHata(htmlResponse(503));
    expect(err.message).not.toContain('<html');
    expect(err.status).toBe(503);
  });
});
