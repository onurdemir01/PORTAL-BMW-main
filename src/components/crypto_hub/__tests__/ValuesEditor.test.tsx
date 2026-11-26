// @vitest-environment jsdom
// Crypto Hub values duzenleyici (2026-11-26, kapsam PR-2; %0): acilista maskeli okuma, okuma hatasi, gercek degerler,
// chart varsayilanlari, dosyasiz salt okunur, duzenleme (fark, iptal), kaydet kilitleri (hedef yok, maskeli metin),
// onay penceresi (iptal / yaz), yazim sonucu (yazildi -> yeniden okuma + onSaved; yazilamadi) ve diffLines.
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const ops = vi.hoisted(() => ({ run: vi.fn(), busy: null as string | null }));
vi.mock('@/components/crypto_hub/OpsPanel', () => ({
  useOps: () => ops,
  OpsConfirm: (p: {
    req: { action: string; valuesPath?: string };
    onCancel: () => void;
    onConfirm: () => void;
  }) => (
    <div>
      onay {p.req.action} {p.req.valuesPath}
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

import { diffLines, ValuesEditor } from '../ValuesEditor';

const okuma = (values: string[], ek: Record<string, unknown> = {}) => ({
  ok: true,
  results: [],
  errors: [],
  values,
  masked: true,
  ...ek,
});
const DOSYALAR = [
  { path: '/vhosting/metaco/values.yaml', label: 'metaco/values.yaml' },
  { path: '/vhosting/metaco/values-prod.yaml', label: 'values-prod.yaml' },
];

beforeEach(() => {
  ops.run.mockReset();
  ops.busy = null;
  toast.error.mockReset();
  toast.success.mockReset();
});

describe('ValuesEditor', () => {
  it('maskeli okuma, hata, gercek degerler, chart varsayilanlari; dosyasiz salt okunur', async () => {
    ops.run
      .mockResolvedValueOnce(okuma(['replicas: 2', 'db:', '  password: ****']))
      .mockResolvedValueOnce({
        ok: true,
        results: [],
        errors: [{ stage: 'helm', message: 'release yok' }],
      })
      .mockResolvedValueOnce(okuma(['replicas: 2', 'db:', '  password: gizli'], { masked: false }))
      .mockResolvedValueOnce(okuma(['replicas: 2', 'image: x'], { masked: false }));
    render(<ValuesEditor tenantKey="t1" tenantLabel="Kart" release="metaco" />);
    expect(await screen.findByText(/password: \*\*\*\*/)).toBeTruthy();
    expect(ops.run).toHaveBeenCalledWith({
      action: 'values_get',
      targets: [],
      release: 'metaco',
      valuesAll: false,
      reveal: false,
    });
    expect(screen.getByText(/ile gizlendi/)).toBeTruthy();
    expect((screen.getByRole('button', { name: /Düzenle/ }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    fireEvent.click(screen.getByRole('button', { name: /Yenile/ }));
    expect(await screen.findByText('helm: release yok')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Gerçek değerleri göster/ }));
    expect(await screen.findByText(/password: gizli/)).toBeTruthy();
    expect(screen.getByText(/Gerçek değerler görünüyor/)).toBeTruthy();
    fireEvent.click(screen.getByLabelText(/chart varsayılanları dahil/));
    await waitFor(() =>
      expect(ops.run).toHaveBeenLastCalledWith(
        expect.objectContaining({ valuesAll: true, reveal: true }),
      ),
    );
    expect(await screen.findByText(/image: x/)).toBeTruthy();
  });

  it('duzenleme: fark, iptal, kaydet kilitleri, onay ve yazim', async () => {
    const kaydedildi = vi.fn();
    ops.run
      .mockResolvedValueOnce(okuma(['replicas: 2']))
      .mockResolvedValueOnce(okuma(['replicas: 2', 'token: abc'], { masked: false }));
    render(
      <ValuesEditor
        tenantKey="t1"
        tenantLabel="Kart"
        release="metaco"
        files={DOSYALAR}
        onSaved={kaydedildi}
      />,
    );
    await screen.findByText(/replicas: 2/);
    fireEvent.click(screen.getByRole('button', { name: /Düzenle/ }));
    const alan = (await screen.findByDisplayValue(/token: abc/)) as HTMLTextAreaElement;
    expect(screen.getByText('Henüz değişiklik yok.')).toBeTruthy();
    const kaydet = () => screen.getByRole('button', { name: /Kaydet/ }) as HTMLButtonElement;
    expect(kaydet().disabled).toBe(true);
    fireEvent.change(alan, { target: { value: 'replicas: 3\ntoken: abc' } });
    expect(screen.getByText('- replicas: 2')).toBeTruthy();
    expect(screen.getByText('+ replicas: 3')).toBeTruthy();
    expect(kaydet().textContent).toContain('2 satır');
    // Maskeli deger iceren metin yazilamaz.
    fireEvent.change(alan, { target: { value: 'replicas: 3\ntoken: ****' } });
    fireEvent.click(kaydet());
    expect(toast.error).toHaveBeenCalledWith(
      expect.stringContaining('maskelenmiş (****) değer var'),
    );
    fireEvent.change(alan, { target: { value: 'replicas: 3\ntoken: abc' } });
    // Hedef secilmeden kaydet kapali.
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '' } });
    expect(kaydet().disabled).toBe(true);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: DOSYALAR[1].path } });

    fireEvent.click(kaydet());
    expect(screen.getByText(`onay values_put ${DOSYALAR[1].path}`)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'onayi iptal et' }));
    expect(screen.queryByText(/onay values_put/)).toBeNull();

    fireEvent.click(kaydet());
    ops.run.mockResolvedValueOnce({
      ok: true,
      results: [{ ok: false, message: 'yedek alinamadi' }],
    });
    fireEvent.click(screen.getByRole('button', { name: 'onayla' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('yedek alinamadi'));
    expect(ops.run).toHaveBeenLastCalledWith({
      action: 'values_put',
      targets: [],
      valuesPath: DOSYALAR[1].path,
      content: 'replicas: 3\ntoken: abc',
    });

    fireEvent.click(kaydet());
    ops.run
      .mockResolvedValueOnce({ ok: true, results: [{ ok: true, message: 'yazildi' }] })
      .mockResolvedValueOnce(okuma(['replicas: 3']));
    fireEvent.click(screen.getByRole('button', { name: 'onayla' }));
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith(
        'values.yaml yazıldı (eski dosyanın yedeği alındı).',
      ),
    );
    expect(kaydedildi).toHaveBeenCalled();
    expect(await screen.findByText('replicas: 3')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Kaydet/ })).toBeNull();

    // Iptal duzenlemeyi kapatir, taslak sifirlanir.
    ops.run.mockResolvedValueOnce(okuma(['replicas: 3'], { masked: false }));
    fireEvent.click(screen.getByRole('button', { name: /Düzenle/ }));
    fireEvent.change(await screen.findByDisplayValue('replicas: 3'), { target: { value: 'x: 1' } });
    fireEvent.click(screen.getByRole('button', { name: /İptal/ }));
    expect(screen.getByText('replicas: 3')).toBeTruthy();
  });

  it('bos values; okuma iptal olursa ekran degismez', async () => {
    ops.run.mockResolvedValueOnce(okuma([])).mockResolvedValueOnce(null);
    render(<ValuesEditor tenantKey="t1" tenantLabel="Kart" release="metaco" compact />);
    expect(await screen.findByText('(boş)')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Yenile/ }));
    await waitFor(() => expect(ops.run).toHaveBeenCalledTimes(2));
    expect(screen.getByText('(boş)')).toBeTruthy();
  });
});

describe('ValuesEditor guvenlik kilitleri', () => {
  it('gercek degerler okunamazsa duzenleme acilmaz (bos taslak dosyanin yerine yazilamaz)', async () => {
    ops.run
      .mockResolvedValueOnce(okuma(['replicas: 2', 'image: x']))
      .mockResolvedValueOnce({
        ok: true,
        results: [],
        errors: [{ stage: 'helm', message: 'zaman asimi' }],
      })
      .mockResolvedValueOnce(null);
    render(<ValuesEditor tenantKey="t1" tenantLabel="Kart" release="metaco" files={DOSYALAR} />);
    await screen.findByText(/image: x/);
    fireEvent.click(screen.getByRole('button', { name: /Düzenle/ }));
    expect(await screen.findByText('helm: zaman asimi')).toBeTruthy();
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByRole('button', { name: /Kaydet/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Düzenle/ }));
    await waitFor(() => expect(ops.run).toHaveBeenCalledTimes(3));
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('maskeli satir metnin ortasinda da yakalanir', async () => {
    ops.run
      .mockResolvedValueOnce(okuma(['token: abc']))
      .mockResolvedValueOnce(okuma(['token: abc', 'replicas: 2'], { masked: false }));
    render(<ValuesEditor tenantKey="t1" tenantLabel="Kart" release="metaco" files={DOSYALAR} />);
    await screen.findByText(/token: abc/);
    fireEvent.click(screen.getByRole('button', { name: /Düzenle/ }));
    fireEvent.change(await screen.findByDisplayValue(/replicas: 2/), {
      target: { value: 'token: ****\nreplicas: 3' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Kaydet/ }));
    expect(toast.error).toHaveBeenCalledWith(
      expect.stringContaining('maskelenmiş (****) değer var'),
    );
    expect(screen.queryByText(/onay values_put/)).toBeNull();
  });
});

describe('diffLines', () => {
  it('tekrarlanan satirlari sayarak ayirir, bos satirlari yok sayar', () => {
    expect(diffLines('a\nb\nb\n\nc', 'a\nb\nd\n\n')).toEqual({
      eklenen: ['d'],
      cikarilan: ['b', 'c'],
    });
    expect(diffLines('x', 'x')).toEqual({ eklenen: [], cikarilan: [] });
    // Yeni metinde fazladan kopya eklenen sayilir (sayac her eslesmede duser).
    expect(diffLines('x', 'x\nx')).toEqual({ eklenen: ['x'], cikarilan: [] });
    expect(diffLines('x\nx', 'x')).toEqual({ eklenen: [], cikarilan: ['x'] });
  });
});
