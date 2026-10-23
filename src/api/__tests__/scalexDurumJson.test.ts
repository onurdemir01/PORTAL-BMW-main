// src/api/__tests__/scalexDurumJson.test.ts — ScaleX yoklama uçlarının ayrıştırıcısı.
//
// Sunucu ScaleX'in 403 / 404 redlerini 409'a çeviriyor (kurumsal nginx 403 / 404 gövdesini
// HTML sayfasıyla değiştiriyordu); asıl kod `upstreamStatus`ta gelir. Yoklama döngüleri reddi
// FIRLATILAN hatadan anlar: düz bir `{ ok: false }` gövdesi `finished` taşımadığı için
// döngüyü sonsuza dek döndürürdü. Bu dosya o sözleşmeyi kilitler.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { durumJson, scalexApi } from '@/api/scalexApi';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

async function hatasi(
  res: Response,
): Promise<Error & { status?: number; code?: string; gatewayUnavailable?: boolean }> {
  try {
    await durumJson(res);
  } catch (e) {
    return e as Error & { status?: number; code?: string };
  }
  throw new Error('durumJson hata fırlatmadı');
}

describe('durumJson', () => {
  it('çevrilmiş 403 reddi ASIL kodla ve sunucunun mesajıyla fırlatılır', async () => {
    const e = await hatasi(
      json(409, {
        ok: false,
        message: 'Bu iş size ait değil.',
        code: 'scalex_forbidden',
        upstreamStatus: 403,
      }),
    );
    expect(e.status).toBe(403);
    expect(e.code).toBe('scalex_forbidden');
    expect(e.message).toBe('Bu iş size ait değil.');
  });

  it('404 ve 401 de fırlatılır; çevrilmemiş 4xx kendi koduyla', async () => {
    expect(
      (
        await hatasi(
          json(409, { ok: false, message: 'yok', code: 'scalex_not_found', upstreamStatus: 404 }),
        )
      ).status,
    ).toBe(404);
    expect((await hatasi(json(401, { ok: false, message: 'Oturum yok' }))).status).toBe(401);
    expect((await hatasi(json(400, { ok: false, message: 'geçersiz' }))).status).toBe(400);
  });

  it('başarılı yanıt ve 2xx içindeki ok:false aynen döner', async () => {
    expect(await durumJson(json(200, { ok: true, finished: false }))).toEqual({
      ok: true,
      finished: false,
    });
    expect(await durumJson(json(200, { ok: false, finished: true }))).toEqual({
      ok: false,
      finished: true,
    });
  });

  it('5xx JSON fırlatılmaz (geçici; yoklayıcı yeniden dener), ağ geçidi HTML’i eskisi gibi fırlatılır', async () => {
    const b = await durumJson(json(503, { ok: false, message: 'İş sahipliği doğrulanamadı' }));
    expect(b._httpStatus).toBe(503);
    const e = await hatasi(
      new Response('<!doctype html>', { status: 503, headers: { 'content-type': 'text/html' } }),
    );
    expect(e.gatewayUnavailable).toBe(true);
  });
});

describe('yoklama çağrıları reddi fırlatır (sonsuz döngü yok)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('keşif, namespace keşfi ve iş durumu çevrilmiş 403 reddinde asıl kodla reddeder', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        json(409, {
          ok: false,
          message: 'Bu iş size ait değil.',
          code: 'scalex_forbidden',
          upstreamStatus: 403,
        }),
      ),
    );
    for (const cagri of [
      () => scalexApi.discoverStatus(1, 2),
      () => scalexApi.discoverNamespacesStatus(1, 2, 'test', 't1'),
      () => scalexApi.runStatus(1, 2),
    ]) {
      await expect(cagri()).rejects.toMatchObject({
        status: 403,
        message: 'Bu iş size ait değil.',
      });
    }
  });
});
