// src/api/__tests__/opsxRed.test.ts — OpsX çağrıları çevrilmiş redde üretimdeki akışla fırlatır.
//
// OpsX (2026-10-23) portal genelindeki çeviriciye dahil edildi: `ok:false` 403 / 404 → 409, eylemde
// 502 / 503 / 504 → 424, asıl kod `upstreamStatus`ta, `nginxRed: true` işaretli. OpsX ekranının
// kodu bu depoda salt-okunur ve çağrılarının hepsi `safeJson`dan geçiyor. Üretimde bu redler HTML
// geldiği için bugün de FIRLATILIYORDU; burada akışın aynı kaldığı (yine fırlatılır) ve mesajın
// artık sunucudan, kodun asıl koddan geldiği kilitlenir.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { opsxApi, opsxWasApi } from '@/api/opsxApi';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('OpsX çağrıları ve çevrilmiş ret', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('yoklama: başkasının işi (403) sunucunun mesajı ve asıl kodla fırlatılır', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        json(409, {
          ok: false,
          message: 'Bu iş size ait değil.',
          code: 'portal_forbidden',
          upstreamStatus: 403,
          nginxRed: true,
        }),
      ),
    );
    for (const cagri of [() => opsxApi.jobStatus(1, 2), () => opsxWasApi.runStatus(1, 2)]) {
      await expect(cagri()).rejects.toMatchObject({
        status: 403,
        message: 'Bu iş size ait değil.',
      });
    }
  });

  it('eylem: AWX yanıt vermedi (503 → 424) "portal yeniden başlatılıyor" değil, gerçek mesajla fırlatılır', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        json(424, {
          ok: false,
          message: 'AWX yanıt vermedi; iş başlatılamadı.',
          code: 'portal_upstream_unavailable',
          upstreamStatus: 503,
          nginxRed: true,
        }),
      ),
    );
    const e = await opsxApi.run({} as never).then(
      () => null,
      (x: Error & { status?: number; gatewayUnavailable?: boolean }) => x,
    );
    expect(e).not.toBeNull();
    expect(e!.message).toBe('AWX yanıt vermedi; iş başlatılamadı.');
    expect(e!.status).toBe(503);
    expect(e!.message).not.toMatch(/yeniden başlatılıyor/);
  });
});
