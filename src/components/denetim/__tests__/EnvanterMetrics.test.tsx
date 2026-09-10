// src/components/denetim/__tests__/EnvanterMetrics.test.tsx
//
// NEDEN VAR: bu bilesenin state makinesi `react-hooks` uyarilarini gidermek icin
// yeniden kuruldu (2026-09-10) ve bilesenin HIC testi yoktu:
//
//   * `loading` bir STATE olmaktan cikip TURETILMIS degere dondu
//     (`loadedKey !== reqKey`).
//   * Boyut anahtari sifirlama `useEffect`ten RENDER SIRASINDA AYARLAMAYA tasindi.
//
// Ikincisi yanlis yazilirsa SONSUZ RENDER uretir — ve bu, tsc'nin de build'in de
// goremeyecegi bir hatadir. Bu dosya o iki seyi DAVRANIS olarak olcer.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, act, fireEvent } from '@testing-library/react';
import { render } from '@/test/test-utils';
import EnvanterMetrics from '@/components/denetim/EnvanterMetrics';
import type { EnvanterSummary, EnvanterPivot } from '@/api/denetimApi';

const mockSummary = vi.hoisted(() => vi.fn());
const mockPivot = vi.hoisted(() => vi.fn());

vi.mock('@/api/denetimApi', () => ({
  denetimApi: { envanterSummary: mockSummary, envanterPivot: mockPivot },
}));

const SEP = String.fromCharCode(1); // sunucu tarafiyla AYNI hucre ayirici

function summary(): EnvanterSummary {
  return {
    ok: true,
    source: 'hosts',
    label: 'Sunucular',
    unit: 'sunucu',
    totals: { rows: 10, hosts: 10, apps: 3, numerics: [] },
    dims: [
      { key: 'domain', label: 'Alan' },
      { key: 'env', label: 'Ortam' },
    ],
    products: [],
    distributions: {
      domain: [{ value: 'a', count: 5, hosts: 5 }],
      env: [{ value: 'prod', count: 5, hosts: 5 }],
    },
  } as EnvanterSummary;
}

function pivot(): EnvanterPivot {
  return {
    ok: true,
    source: 'hosts',
    metric: 'rows',
    x: { key: 'domain', label: 'Alan', values: [{ value: 'a', count: 5 }] },
    y: { key: 'env', label: 'Ortam', values: [{ value: 'prod', count: 5 }] },
    cells: { ['a' + SEP + 'prod']: 5 },
    total: 5,
  };
}

describe('EnvanterMetrics', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSummary.mockResolvedValue(summary());
    mockPivot.mockResolvedValue(pivot());
  });

  // KAYNAK DEGISTIR: asil risk BURADA. Ilk mount'ta `useState` ilklemesi zaten
  // gecerli bir anahtar seciyor; sifirlama mantigi ancak `sum`/`source` DEGISINCE
  // is goruyor. Testin ilk hali yalnizca mount'u olcuyordu ve MUTASYON TURUNDA
  // IKISI DE YESIL KALDI (koruma kaldirildi -> yesil; duzeltme kaldirildi -> yesil).
  async function kaynagiDegistir(yeniOzet: EnvanterSummary) {
    mockSummary.mockResolvedValue(yeniOzet);
    const select = screen.getAllByRole('combobox')[0];
    await act(async () => {
      fireEvent.change(select, { target: { value: 'was' } });
    });
  }

  const baskaBoyutlar = () =>
    ({
      ...summary(),
      source: 'was',
      dims: [
        { key: 'os', label: 'IS' },
        { key: 'tier', label: 'Katman' },
      ],
      distributions: {
        os: [{ value: 'rhel', count: 3, hosts: 3 }],
        tier: [{ value: 'web', count: 3, hosts: 3 }],
      },
    }) as EnvanterSummary;

  it('EM1 kaynak degisiminde SONSUZ RENDER uretmez (render-sirasi ayarlama yakinsar)', async () => {
    await act(async () => {
      render(<EnvanterMetrics />);
    });
    const oncekiPivot = mockPivot.mock.calls.length;

    // Yakinsamayan bir render-sirasi ayarlamasi burada React'in
    // "Too many re-renders" hatasini firlatir ya da cagri sayisini patlatir.
    await kaynagiDegistir(baskaBoyutlar());

    expect(mockSummary).toHaveBeenCalledTimes(2);
    const yeniCagri = mockPivot.mock.calls.length - oncekiPivot;
    expect(yeniCagri).toBeLessThanOrEqual(3);
  });

  it('EM2 kaynak degisince GECERSIZ kalan boyut anahtari duzeltiliyor', async () => {
    await act(async () => {
      render(<EnvanterMetrics />);
    });
    // Ilk ozetin boyutlari: domain/env -> pivot bunlarla cagrilir.
    expect(mockPivot.mock.calls[0][0].x).toBe('domain');

    // Yeni ozette domain/env YOK. Sifirlama calismazsa pivot ESKI (gecersiz)
    // anahtarla cagrilmaya devam eder ve sunucu bos/hatali sonuc doner.
    await kaynagiDegistir(baskaBoyutlar());

    const son = mockPivot.mock.calls[mockPivot.mock.calls.length - 1][0];
    expect(['os', 'tier']).toContain(son.x);
    expect(['os', 'tier']).toContain(son.y);
  });

  it('EM3 `loading` TURETILMIS: istek cozulunce "yukleniyor" KENDILIGINDEN kalkar', async () => {
    let cozumle: ((v: EnvanterPivot) => void) | null = null;
    mockPivot.mockImplementation(
      () =>
        new Promise<EnvanterPivot>((res) => {
          cozumle = res;
        }),
    );

    await act(async () => {
      render(<EnvanterMetrics />);
    });
    expect(screen.queryByText(/yükleniyor/)).not.toBeNull();

    await act(async () => {
      cozumle?.(pivot());
    });
    expect(screen.queryByText(/yükleniyor/)).toBeNull();
  });
});
