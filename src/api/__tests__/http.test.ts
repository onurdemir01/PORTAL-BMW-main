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
