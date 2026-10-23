// src/api/__tests__/logxV2Hata.test.ts — LogX istemci hatası ASIL kodu taşır.
//
// Sunucu 403 / 404'ü 409'a, eylemlerdeki 502 / 503 / 504'ü 424'e çeviriyor (kurumsal nginx bu
// kodların gövdesini HTML sayfasıyla değiştiriyordu). Asıl kod `upstreamStatus`ta gelir. İstemci
// hatasının `status`u ve mesajı ondan okunur: "yetkin yok" ile "sunucu hatası" ayrımı sürer ve
// sunucunun mesajı (kısıtın açıklaması) kullanıcıya ulaşır.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { logxV2Api } from '@/api/logxV2Api';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('logxV2Api hata nesnesi', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('çevrilmiş 403 reddi asıl kod, kod adı ve sunucunun mesajıyla fırlatılır', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        json(409, {
          ok: false,
          message: 'Bu isteğe erişim yetkiniz yok.',
          code: 'logx_forbidden',
          upstreamStatus: 403,
        }),
      ),
    );
    await expect(logxV2Api.jobStatus(1)).rejects.toMatchObject({
      status: 403,
      code: 'logx_forbidden',
      message: 'Bu isteğe erişim yetkiniz yok.',
    });
  });

  it('eylemdeki 503 (424 olarak gelir) asıl kodla; çevrilmemiş 4xx kendi koduyla', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        json(424, {
          ok: false,
          message: 'AWX yanıt vermedi.',
          code: 'logx_upstream_unavailable',
          upstreamStatus: 503,
        }),
      ),
    );
    await expect(logxV2Api.cancelJob(1)).rejects.toMatchObject({
      status: 503,
      message: 'AWX yanıt vermedi.',
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json(400, { ok: false, message: 'geçersiz' })),
    );
    await expect(logxV2Api.jobStatus(1)).rejects.toMatchObject({
      status: 400,
      message: 'geçersiz',
    });
  });
});
