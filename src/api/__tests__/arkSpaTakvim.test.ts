// src/api/__tests__/arkSpaTakvim.test.ts — Intranet SPA geçiş takvimi yazma uçlarının yanıt işleme
// (2026-11-27, arkSpaApi.ts takvimJson).
//   AT1 yetki hatası (requireAdmin) `error` taşır: ekranın okuduğu `message`e taşınır
//   AT2 gövde sınırı (413, HTML yanıt): genel "Yanıt okunamadı." yerine açık mesaj
//   AT3 yükleme kilidi `beklenenKilit` adıyla gider
//   AT4 set planı uçları: yol, yöntem, gövde (set düzeltmesi, plan önizle / yükle)
import { afterEach, describe, expect, it, vi } from 'vitest';
import { arkSpaApi } from '@/api/arkSpaApi';

const yanit = (status: number, govde: unknown) =>
  new Response(typeof govde === 'string' ? govde : JSON.stringify(govde), { status });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('arkSpaApi takvim uçları', () => {
  it('AT1 403 error alanı message olur; message varsa ezilmez', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          yanit(403, { ok: false, error: 'Bu işlem için yönetici yetkisi gerekli.' }),
        ),
    );
    const r = await arkSpaApi.takvimOnizle('x');
    expect(r).toMatchObject({ ok: false, message: 'Bu işlem için yönetici yetkisi gerekli.' });
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(yanit(409, { ok: false, code: 'takvim_cakisma', message: 'değişti' })),
    );
    expect(
      await arkSpaApi.takvimSet({
        set: 'Set 1',
        gecisTarihi: '2026-12-01',
        dc: 'DC-A',
        eskiIp: '',
        yeniIp: '',
        beklenenSurum: 0,
        beklenen: {},
      }),
    ).toEqual({
      ok: false,
      code: 'takvim_cakisma',
      message: 'değişti',
    });
  });

  it('AT2 413 açık mesaj', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(yanit(413, '<html>PayloadTooLarge</html>')));
    const r = await arkSpaApi.takvimYukle('x', null);
    expect(r).toEqual({ ok: false, message: 'Dosya çok büyük (sunucu gövde sınırı).' });
  });

  it('AT3 yükleme kilidi beklenenKilit ile gider', async () => {
    const f = vi.fn().mockResolvedValue(yanit(200, { ok: true, satir: 1, yukleme: 'yk-2' }));
    vi.stubGlobal('fetch', f);
    await arkSpaApi.takvimYukle('metin', 'yk-1:3:3');
    expect(JSON.parse(f.mock.calls[0][1].body)).toEqual({
      metin: 'metin',
      beklenenKilit: 'yk-1:3:3',
    });
  });

  it('AT4 set planı uçları: yol, yöntem, gövde', async () => {
    const f = vi.fn().mockImplementation(async () => yanit(200, { ok: true }));
    vi.stubGlobal('fetch', f);
    const istek = {
      set: 'Set 7',
      gecisTarihi: '2026-12-17',
      dc: 'DC-B',
      eskiIp: '198.51.100.41',
      yeniIp: '198.51.100.42',
      beklenenSurum: 2,
      beklenen: { 'ns-a/app-1': 3 },
      topla: true,
    };
    await arkSpaApi.takvimSet(istek);
    await arkSpaApi.planOnizle('plan');
    await arkSpaApi.planYukle('plan', 'plan 1:1:1 | takvim 0:0:0');
    await arkSpaApi.takvimTarih({
      set: 'Set 7',
      namespace: 'ns-a',
      uygulama: 'app-1',
      tarih: '2026-12-18',
      beklenenSurum: 3,
    });
    expect(f.mock.calls.map((c) => [c[0], c[1].method, JSON.parse(c[1].body)])).toEqual([
      ['/api/spa-report/intranet/takvim/set', 'PUT', istek],
      ['/api/spa-report/intranet/takvim/plan/onizle', 'POST', { metin: 'plan' }],
      [
        '/api/spa-report/intranet/takvim/plan/yukle',
        'POST',
        { metin: 'plan', beklenenKilit: 'plan 1:1:1 | takvim 0:0:0' },
      ],
      [
        '/api/spa-report/intranet/takvim/tarih',
        'PUT',
        {
          set: 'Set 7',
          namespace: 'ns-a',
          uygulama: 'app-1',
          tarih: '2026-12-18',
          beklenenSurum: 3,
        },
      ],
    ]);
  });
});
