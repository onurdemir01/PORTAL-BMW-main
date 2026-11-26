// @vitest-environment jsdom
// Crypto Hub values karsilastirmasi (2026-11-26, kapsam PR-2; %0): acilista maskeli okuma, okuma hatalari, fark tablosu
// (sir rozeti, eksik deger, fark yok), karsilastirilamaz durum, gercek degerlere gecis, esitleme (kaynak = hedef reddi,
// hedef okunamadi, kaynakta deger yok, icerik uretilemedi, yazildi + atlanan, yazilamadi) ve CompareTable etiketleri.
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const ops = vi.hoisted(() => ({ run: vi.fn(), busy: null as string | null }));
vi.mock('@/components/crypto_hub/OpsPanel', () => ({ useOps: () => ops }));
const crypto = vi.hoisted(() => ({ valuesApply: vi.fn() }));
vi.mock('@/api/cryptoHubApi', () => ({ cryptoOpsApi: crypto }));
const toast = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }));
vi.mock('@/hooks/useToast', () => ({ toast }));

import { CompareTable, ValuesCompare } from '../ValuesCompare';

const A = '/vhosting/a/values.yaml';
const B = '/vhosting/b/values.yaml';
const karsilastirma = (ek: Record<string, unknown> = {}) => ({
  okunan: [
    { path: A, cluster: 'ocp-a' },
    { path: B, cluster: 'ocp-b' },
  ],
  okunamayan: [],
  satirlar: [
    { anahtar: 'replicas', degerler: ['3', '2'], ayni: false, sirli: false, eksikVar: false },
    {
      anahtar: 'db.password',
      degerler: ['****', '****'],
      ayni: false,
      sirli: true,
      eksikVar: false,
    },
    { anahtar: 'yeni.ayar', degerler: [null, 'x'], ayni: false, sirli: false, eksikVar: true },
  ],
  farkliSayi: 3,
  anahtarSayi: 40,
  karsilastirilabilir: true,
  ...ek,
});
const sonuc = (ek: Record<string, unknown> = {}) => ({
  ok: true,
  masked: true,
  results: [],
  errors: [],
  files: [
    { path: A, lines: ['replicas: 3'] },
    { path: B, lines: ['replicas: 2'] },
  ],
  compare: karsilastirma(),
  ...ek,
});

beforeEach(() => {
  ops.run.mockReset();
  ops.busy = null;
  crypto.valuesApply.mockReset();
  toast.error.mockReset();
  toast.success.mockReset();
});

describe('ValuesCompare', () => {
  it('acilista maskeli okur; fark tablosu, sir rozeti, okuma hatasi; maskeliyken esitleme yok', async () => {
    ops.run.mockResolvedValueOnce(sonuc({ errors: [{ stage: 'okuma', message: 'b izin yok' }] }));
    render(<ValuesCompare tenantKey="t1" paths={[A, B]} />);
    expect(await screen.findByText('replicas')).toBeTruthy();
    expect(ops.run).toHaveBeenCalledWith({
      action: 'values_files',
      targets: [],
      valuesPaths: [A, B],
      reveal: false,
    });
    expect(screen.getByText('okuma: b izin yok')).toBeTruthy();
    expect(screen.getByTitle('sır: fark var, değer gösterilmiyor')).toBeTruthy();
    expect(screen.getByText('(yok)')).toBeTruthy();
    expect(screen.getByText(/farklı ayar \/ 40 anahtar/)).toBeTruthy();
    expect(screen.getByText(/Önce/)).toBeTruthy();
    expect(screen.queryByRole('checkbox')).toBeNull();
  });

  it('gercek degerler ve esitleme: kaynak = hedef, kaynakta deger yok, uretilemedi, yazildi, yazilamadi', async () => {
    ops.run.mockResolvedValueOnce(sonuc()).mockResolvedValueOnce(
      sonuc({
        masked: false,
        compare: karsilastirma({
          satirlar: [
            {
              anahtar: 'replicas',
              degerler: ['3', '2'],
              ayni: false,
              sirli: false,
              eksikVar: false,
            },
            {
              anahtar: 'yeni.ayar',
              degerler: [null, 'x'],
              ayni: false,
              sirli: false,
              eksikVar: true,
            },
          ],
        }),
      }),
    );
    render(<ValuesCompare tenantKey="t1" paths={[A, B]} />);
    fireEvent.click(await screen.findByRole('button', { name: /Gerçek değerleri göster/ }));
    await waitFor(() =>
      expect(ops.run).toHaveBeenLastCalledWith(expect.objectContaining({ reveal: true })),
    );
    expect(await screen.findByRole('button', { name: /Maskele/ })).toBeTruthy();
    const yaz = () => screen.getByRole('button', { name: /hedefe yaz/ }) as HTMLButtonElement;
    expect(yaz().disabled).toBe(true);

    // Kaynakta degeri olmayan ayar yazilamaz.
    fireEvent.click(screen.getByLabelText('yeni.ayar seç'));
    fireEvent.click(yaz());
    expect(toast.error).toHaveBeenCalledWith('Kaynakta değeri olmayan ayar yazılamaz.');
    fireEvent.click(screen.getByLabelText('yeni.ayar seç'));
    fireEvent.click(screen.getByLabelText('replicas seç'));
    expect(yaz().textContent).toContain('Seçili 1 ayarı');

    // Kaynak = hedef
    const [kaynak, hedef] = screen.getAllByRole('combobox');
    fireEvent.change(hedef, { target: { value: '0' } });
    expect(yaz().disabled).toBe(true);
    fireEvent.change(hedef, { target: { value: '1' } });

    crypto.valuesApply.mockResolvedValueOnce({ ok: false, message: 'Satir bulunamadi' });
    fireEvent.click(yaz());
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Satir bulunamadi'));
    expect(crypto.valuesApply).toHaveBeenCalledWith({
      tenant: 't1',
      lines: ['replicas: 2'],
      secimler: [{ anahtar: 'replicas', deger: '3' }],
    });

    crypto.valuesApply.mockResolvedValue({
      ok: true,
      content: 'replicas: 3',
      degisen: ['replicas'],
      atlanan: ['x'],
    });
    ops.run
      .mockResolvedValueOnce({ ok: true, results: [{ ok: true, message: 'yazildi' }] })
      .mockResolvedValueOnce(sonuc({ masked: false }));
    fireEvent.click(yaz());
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith(
        '1 ayar ocp-b dosyasına yazıldı · 1 ayar eklenemedi (elle eklenmeli)',
      ),
    );
    expect(ops.run.mock.calls[2][0]).toEqual({
      action: 'values_put',
      targets: [],
      valuesPath: B,
      content: 'replicas: 3',
    });
    await waitFor(() => expect(ops.run).toHaveBeenCalledTimes(4));
    expect(ops.run.mock.calls[3][0]).toMatchObject({ reveal: true });

    fireEvent.click(screen.getByLabelText('replicas seç'));
    ops.run.mockResolvedValueOnce({
      ok: true,
      results: [{ ok: false, message: 'yedek alinamadi' }],
    });
    fireEvent.click(yaz());
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('yedek alinamadi'));
    // Kaynak hedefle ayni secilirse yazma reddedilir (dugme zaten kapali; esitle de korur).
    fireEvent.change(kaynak, { target: { value: '1' } });
    expect(yaz().disabled).toBe(true);
  });

  it('hedef dosyasi okunamadiysa yazilmaz; okuma bos donerse tablo yok', async () => {
    ops.run.mockResolvedValueOnce(
      sonuc({
        masked: false,
        files: [
          { path: A, lines: [] },
          { path: B, error: 'izin yok', lines: [] },
        ],
      }),
    );
    const { unmount } = render(<ValuesCompare tenantKey="t1" paths={[A, B]} />);
    fireEvent.click(await screen.findByLabelText('replicas seç'));
    fireEvent.click(screen.getByRole('button', { name: /hedefe yaz/ }));
    expect(toast.error).toHaveBeenCalledWith('Hedef dosya okunamadı.');
    expect(crypto.valuesApply).not.toHaveBeenCalled();
    unmount();
    ops.run.mockResolvedValueOnce(null);
    ops.busy = 'values_files';
    render(<ValuesCompare tenantKey="t1" paths={[A, B]} />);
    expect(await screen.findByText(/bastion'dan 2 dosya okunuyor/)).toBeTruthy();
    expect(screen.queryByText('replicas')).toBeNull();
  });
});

describe('CompareTable', () => {
  it('karsilastirilamaz: okunan sayisi ve okunamayan dosyalar; fark yok anlamina gelmez', () => {
    render(
      <CompareTable
        masked
        compare={karsilastirma({
          karsilastirilabilir: false,
          okunan: [{ path: A, cluster: 'ocp-a' }],
          okunamayan: [{ path: B, cluster: 'ocp-b', error: 'zaman asimi' }],
        })}
      />,
    );
    expect(screen.getByText(/okunan: 1/)).toBeTruthy();
    expect(screen.getByText(/zaman asimi/)).toBeTruthy();
  });

  it('fark yok, okunamayan kaynak, ozel sutun etiketleri', () => {
    render(
      <CompareTable
        masked={false}
        solEtiket="canlı"
        sagEtiket="uygulanacak"
        compare={karsilastirma({
          satirlar: [],
          farkliSayi: 0,
          okunamayan: [{ path: '/vhosting/c/values.yaml', cluster: 'ocp-c', error: 'yok' }],
        })}
      />,
    );
    expect(screen.getByText('● fark yok')).toBeTruthy();
    expect(screen.getByText('Tüm ayarlar aynı.')).toBeTruthy();
    expect(screen.getByText(/1 kaynak okunamadı/)).toBeTruthy();
    expect(screen.getByText('canlı')).toBeTruthy();
    expect(screen.getByText('uygulanacak')).toBeTruthy();
    expect(screen.queryByText(/sır değerleri/)).toBeNull();
  });

  it('gercek degerlerde sir rozeti cizilmez, deger gorunur', () => {
    render(
      <CompareTable
        masked={false}
        compare={karsilastirma({
          satirlar: [
            {
              anahtar: 'db.password',
              degerler: ['gizli1', 'gizli2'],
              ayni: false,
              sirli: true,
              eksikVar: false,
            },
          ],
        })}
      />,
    );
    expect(screen.getByText('gizli1')).toBeTruthy();
    expect(screen.queryByTitle('sır: fark var, değer gösterilmiyor')).toBeNull();
  });
});
