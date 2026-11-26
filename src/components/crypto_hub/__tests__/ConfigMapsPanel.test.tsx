// @vitest-environment jsdom
// Crypto Hub config map paneli (2026-11-26, kapsam PR-2; %0): liste (hata, bos, helm yonetimi), secim ve veri (bos data,
// tek satir / cok satir alan), degisiklik ozeti ve geri alma, onay penceresi (iptal / yaz), yazim sonucu (guncellendi ->
// rollout hedefi kayitli / tahmin / yok; yazilamadi), rollout (basarili / basarisiz).
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const ops = vi.hoisted(() => ({ run: vi.fn(), busy: null as string | null }));
vi.mock('@/components/crypto_hub/OpsPanel', () => ({
  useOps: () => ops,
  OpsConfirm: (p: {
    req: { action: string; data?: unknown };
    onCancel: () => void;
    onConfirm: () => void;
  }) => (
    <div>
      onay {p.req.action} {JSON.stringify(p.req.data)}
      <button type="button" onClick={p.onCancel}>
        onayi iptal et
      </button>
      <button type="button" onClick={p.onConfirm}>
        onayla
      </button>
    </div>
  ),
}));
const toast = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }));
vi.mock('@/hooks/useToast', () => ({ toast }));

import { ConfigMapsPanel } from '../ConfigMapsPanel';

const liste = (ek: Record<string, unknown> = {}) => ({
  ok: true,
  results: [],
  errors: [],
  configMaps: [
    {
      name: 'app-config',
      keys: 2,
      managedBy: 'Helm',
      rollout: { kaynak: 'kayitli', targets: ['deployment/api'], note: 'api yeniden baslar' },
    },
    {
      name: 'tahmin-config',
      keys: 1,
      managedBy: null,
      rollout: { kaynak: 'tahmin', targets: ['deployment/web'], note: 'tahmin' },
    },
    { name: 'hedefsiz', keys: 0, managedBy: null, rollout: null },
  ],
  ...ek,
});
const veri = (data: { key: string; value: string }[]) => ({
  ok: true,
  results: [],
  configMapData: data,
});

beforeEach(() => {
  ops.run.mockReset();
  ops.busy = null;
  toast.error.mockReset();
  toast.success.mockReset();
});

async function ac(ad: string, data: { key: string; value: string }[]) {
  ops.run.mockResolvedValueOnce(veri(data));
  fireEvent.click(screen.getByText(ad).closest('button') as HTMLElement);
  await waitFor(() =>
    expect(ops.run).toHaveBeenLastCalledWith({ action: 'configmap_get', targets: [], cmName: ad }),
  );
}

describe('ConfigMapsPanel', () => {
  it('liste hatasi ve bos liste', async () => {
    ops.run.mockResolvedValueOnce({
      ok: true,
      results: [],
      errors: [{ stage: 'oc', message: 'yetki yok' }],
      configMaps: [],
    });
    render(<ConfigMapsPanel tenantKey="t1" tenantLabel="Kart" namespace="kart-prod" />);
    expect(await screen.findByText('oc: yetki yok')).toBeTruthy();
    expect(screen.getByText('Config map bulunamadı.')).toBeTruthy();
    expect(screen.getByText('kart-prod · 0 config map')).toBeTruthy();
    expect(screen.getByText('Soldan bir config map seçin.')).toBeTruthy();
    ops.run.mockResolvedValueOnce(liste());
    fireEvent.click(screen.getByRole('button', { name: /Yenile/ }));
    expect(await screen.findByText('kart-prod · 3 config map')).toBeTruthy();
    expect(screen.getByText(/Helm yönetiyor/)).toBeTruthy();
  });

  it('duzenleme, ozet, geri alma, onay ve rollout (kayitli hedef)', async () => {
    ops.run.mockResolvedValueOnce(liste());
    render(<ConfigMapsPanel tenantKey="t1" tenantLabel="Kart" namespace="kart-prod" />);
    await screen.findByText('app-config');
    await ac('app-config', [
      { key: 'LOG_LEVEL', value: 'info' },
      { key: 'config.yaml', value: 'a: 1\nb: 2' },
    ]);
    expect(await screen.findByText(/bir sonraki/)).toBeTruthy();
    expect(screen.getByText('Kaydedilmemiş değişiklik yok.')).toBeTruthy();
    const kaydet = () => screen.getByRole('button', { name: /Kaydet/ }) as HTMLButtonElement;
    expect(kaydet().disabled).toBe(true);
    fireEvent.change(screen.getByDisplayValue('info'), { target: { value: 'debug' } });
    fireEvent.change(screen.getByDisplayValue(/a: 1/), { target: { value: 'a: 1\nb: 3' } });
    expect(screen.getByText('2 anahtar değişecek')).toBeTruthy();
    expect(screen.getByText('LOG_LEVEL · değişti')).toBeTruthy();
    expect(screen.getByText('- b: 2')).toBeTruthy();
    expect(screen.getByText('+ b: 3')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Değişiklikleri geri al/ }));
    expect(screen.getByDisplayValue('info')).toBeTruthy();
    fireEvent.change(screen.getByDisplayValue('info'), { target: { value: 'debug' } });

    fireEvent.click(kaydet());
    expect(screen.getByText(/onay configmap_put \{"LOG_LEVEL":"debug"\}/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'onayi iptal et' }));
    expect(screen.queryByText(/onay configmap_put/)).toBeNull();
    fireEvent.click(kaydet());
    ops.run
      .mockResolvedValueOnce({
        ok: true,
        results: [{ ok: true, message: 'Config map guncellendi' }],
      })
      .mockResolvedValueOnce(
        veri([
          { key: 'LOG_LEVEL', value: 'debug' },
          { key: 'config.yaml', value: 'a: 1\nb: 2' },
        ]),
      );
    fireEvent.click(screen.getByRole('button', { name: 'onayla' }));
    expect(await screen.findByText(/pod’lara yansımadı/)).toBeTruthy();
    expect(toast.success).toHaveBeenCalledWith(expect.stringContaining('Config map güncellendi'));
    expect(screen.getByText('Rollout edilecek:')).toBeTruthy();
    expect(screen.getByText('api yeniden baslar')).toBeTruthy();

    ops.run.mockResolvedValueOnce({
      ok: true,
      results: [{ ok: false, message: 'rollout reddedildi' }],
    });
    fireEvent.click(screen.getByRole('button', { name: /Rollout et/ }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('rollout reddedildi'));
    expect(ops.run).toHaveBeenLastCalledWith({ action: 'rollout', targets: ['deployment/api'] });
    ops.run.mockResolvedValueOnce({ ok: true, results: [{ ok: true, message: 'baslatildi' }] });
    fireEvent.click(screen.getByRole('button', { name: /Rollout et/ }));
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith(expect.stringContaining('Rollout başlatıldı')),
    );
    expect(screen.queryByText(/pod’lara yansımadı/)).toBeNull();
  });

  it('tahmin ve hedefsiz rollout; yazilamadi; bos data', async () => {
    ops.run.mockResolvedValueOnce(liste());
    render(<ConfigMapsPanel tenantKey="t1" tenantLabel="Kart" namespace="kart-prod" />);
    await screen.findByText('tahmin-config');
    await ac('tahmin-config', [{ key: 'A', value: '1' }]);
    fireEvent.change(await screen.findByDisplayValue('1'), { target: { value: '2' } });
    fireEvent.click(screen.getByRole('button', { name: /Kaydet/ }));
    ops.run
      .mockResolvedValueOnce({ ok: true, results: [{ ok: true, message: 'guncellendi' }] })
      .mockResolvedValueOnce(veri([{ key: 'A', value: '2' }]));
    fireEvent.click(screen.getByRole('button', { name: 'onayla' }));
    expect(await screen.findByText('Önerilen (tahmin):')).toBeTruthy();

    await ac('hedefsiz', [{ key: 'B', value: 'x' }]);
    fireEvent.change(await screen.findByDisplayValue('x'), { target: { value: 'y' } });
    fireEvent.click(screen.getByRole('button', { name: /Kaydet/ }));
    ops.run
      .mockResolvedValueOnce({ ok: true, results: [{ ok: true, message: 'guncellendi' }] })
      .mockResolvedValueOnce(veri([{ key: 'B', value: 'y' }]));
    fireEvent.click(screen.getByRole('button', { name: 'onayla' }));
    expect(await screen.findByText(/Rollout hedefi bilinmiyor/)).toBeTruthy();
    expect(screen.getByText(/rollout hedefi kayıtlı değil/)).toBeTruthy();

    fireEvent.change(await screen.findByDisplayValue('y'), { target: { value: 'z' } });
    fireEvent.click(screen.getByRole('button', { name: /Kaydet/ }));
    ops.run.mockResolvedValueOnce({
      ok: true,
      results: [{ ok: false, message: 'yedek alinamadi' }],
    });
    fireEvent.click(screen.getByRole('button', { name: 'onayla' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('yedek alinamadi'));

    await ac('app-config', []);
    expect(await screen.findByText(/alanı boş/)).toBeTruthy();
  });
});
