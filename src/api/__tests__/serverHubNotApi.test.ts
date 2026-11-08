// src/api/__tests__/serverHubNotApi.test.ts — Server Hub not / sınıf yönetimi uçlarının istek sözleşmesi.
//
// Ekran testleri serverHubApi'yi taklit eder, adresi görmez. Burası sunucu sözleşmesini kilitler:
// kalıcı silme AÇIK onay ister (kalici=1&onay=1; onaysız istek 400), arşivleme kalıcı değildir,
// liste arşivi de getirir, sınıf PUT gövdesi ve adı kodlanmış DELETE. Ret okJson ile FIRLATILIR.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { serverHubApi } from '@/api/serverHubApi';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function yakala(body: unknown = { ok: true }, status = 200) {
  const f = vi.fn(async (_url: string, _init?: RequestInit) => json(status, body));
  vi.stubGlobal('fetch', f);
  return f;
}

afterEach(() => vi.unstubAllGlobals());

describe('Server Hub not / sınıf API', () => {
  it('kalıcı silme açık onayla; arşivleme kalıcı değil', async () => {
    const f = yakala();
    await serverHubApi.notKaliciSil(7);
    expect(f).toHaveBeenLastCalledWith('/api/server-hub/notlar/7?kalici=1&onay=1', {
      method: 'DELETE',
    });
    await serverHubApi.notArsivle(7);
    expect(f.mock.calls[1][0]).toBe('/api/server-hub/notlar/7');
    expect(f.mock.calls[1][0]).not.toContain('kalici');
  });

  it('liste arşivi de getirir; geçmiş kendi ucundan', async () => {
    const f = yakala({ ok: true, notlar: [], siniflar: [], gecmis: [] });
    await serverHubApi.notlarListe();
    expect(f.mock.calls[0][0]).toBe('/api/server-hub/notlar?arsiv=1');
    await serverHubApi.notGecmisi(3);
    expect(f.mock.calls[1][0]).toBe('/api/server-hub/notlar/3/gecmis');
  });

  it('sınıf PUT gövdesi; silme adı kodlanmış', async () => {
    const f = yakala({ ok: true, siniflar: [] });
    const s = {
      ad: 'SAHIBI_ONAYLADI',
      baslik: 'Sahibi onayladı',
      renk: 'basari' as const,
      etki: 'BILINEN' as const,
      aciklama: '',
      sira: 100,
    };
    await serverHubApi.sinifKaydet(s);
    const [url, init] = f.mock.calls[0];
    expect(url).toBe('/api/server-hub/siniflar');
    expect(init!.method).toBe('PUT');
    expect(JSON.parse(String(init!.body))).toEqual(s);
    await serverHubApi.sinifSil('A/B');
    expect(f.mock.calls[1]).toEqual(['/api/server-hub/siniflar/A%2FB', { method: 'DELETE' }]);
  });

  it('ret sunucunun mesajıyla fırlatılır (409 varsayılan sınıf)', async () => {
    yakala({ ok: false, message: 'Varsayılan sınıf silinemez.' }, 409);
    await expect(serverHubApi.sinifSil('BILINEN')).rejects.toMatchObject({
      message: 'Varsayılan sınıf silinemez.',
      status: 409,
    });
  });
});
