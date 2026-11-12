// src/components/__tests__/EnvanterTekIstek.test.tsx
//
// ENVANTER: DURUM BASINA TEK VERI ISTEGI (2026-11-12).
// Sayfa acilisinda ve tablo degisiminde inventoryApi.data 2-4 kez cagriliyordu (kolon
// yukleme, filtre, siralama ve arama-debounce effect'leri ayni durumu ayri ayri
// tetikliyordu). Burada: acilista 1, tablo degisiminde 1, arama yazilinca 400 ms sonra 1
// istek; gec gelen ESKI yanit yeni tablonun verisini ezmez.
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';

type Res = {
  ok: boolean;
  rows: Record<string, unknown>[];
  pagination: { page: number; pages: number; total: number; limit: number; exact: boolean; hasMore: boolean };
  appliedWhere?: string | null;
};

const m = vi.hoisted(() => ({
  data: vi.fn(),
  columns: vi.fn(),
}));

vi.mock('@/api/inventoryApi', () => ({
  inventoryApi: {
    health: () => Promise.resolve({ mssqlAvailable: true }),
    tables: () => Promise.resolve({ ok: true, tables: ['Inventory', 'Middleware'] }),
    tableAliases: () => Promise.resolve({ ok: true, aliases: {} }),
    savedQueries: () => Promise.resolve({ ok: true, queries: [] }),
    historyTables: () => Promise.resolve({ ok: true, tables: [] }),
    columns: m.columns,
    data: m.data,
    runQuery: vi.fn(),
  },
}));
vi.mock('@/api/prefsApi', () => ({
  prefsApi: { getAll: () => Promise.resolve({}), get: () => null, set: () => Promise.resolve() },
}));
vi.mock('../../api/prefsApi', () => ({
  prefsApi: { getAll: () => Promise.resolve({}), get: () => null, set: () => Promise.resolve() },
}));
vi.mock('@/contexts/AuthContext', async () => {
  const R = await import('react');
  return { AuthContext: R.createContext({ user: { role: 'User' } }) };
});
vi.mock('@/components/common/HelpModal', () => ({ default: () => null }));
vi.mock('@/hooks/useToast', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock('@/components/envanter/DynamicTable', () => ({
  default: (p: { rows: Record<string, unknown>[] }) => (
    <div data-testid="satirlar">{p.rows.map((r) => String(r.ad)).join(',')}</div>
  ),
}));
vi.mock('@/components/envanter/ColumnPicker', () => ({ default: () => null }));
vi.mock('@/components/envanter/QueryPanel', () => ({ default: () => null }));
vi.mock('@/components/envanter/FilterBar', () => ({ FilterBar: () => null }));
vi.mock('@/components/envanter/InventoryRefreshModal', () => ({ default: () => null }));
vi.mock('@/components/envanter/HistoryPanel', () => ({ default: () => null }));

import EnvanterPage from '@/components/EnvanterPage';

function yanit(ad: string): Res {
  return {
    ok: true,
    rows: [{ ad }],
    pagination: { page: 1, pages: 1, total: 1, limit: 200, exact: true, hasMore: false },
    appliedWhere: null,
  };
}

async function bekle(ms = 0) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: false });
  m.data.mockReset();
  m.columns.mockReset();
  m.columns.mockImplementation((t: string) =>
    Promise.resolve({ ok: true, columns: [{ COLUMN_NAME: `${t}_id` }, { COLUMN_NAME: 'ad' }] }),
  );
  m.data.mockImplementation((t: string) => Promise.resolve(yanit(`${t}-1`)));
  try {
    localStorage.clear();
  } catch {
    /* yok */
  }
});
afterEach(() => {
  vi.useRealTimers();
});

describe('EnvanterPage tek veri istegi', () => {
  it('acilista inventoryApi.data tam 1 kez cagrilir (debounce suresi dolduktan sonra da)', async () => {
    render(<EnvanterPage />);
    await bekle(0);
    await bekle(1000);
    expect(m.data).toHaveBeenCalledTimes(1);
    expect(m.data.mock.calls[0][0]).toBe('Inventory');
    expect(m.data.mock.calls[0][1]).toMatchObject({ page: 1, limit: 200, search: '' });
    expect(screen.getByTestId('satirlar').textContent).toBe('Inventory-1');
  });

  it('tablo degisiminde tam 1 istek gider', async () => {
    render(<EnvanterPage />);
    await bekle(1000);
    expect(m.data).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Middleware' }));
    await bekle(0);
    await bekle(1000);
    expect(m.data).toHaveBeenCalledTimes(2);
    expect(m.data.mock.calls[1][0]).toBe('Middleware');
    expect(screen.getByTestId('satirlar').textContent).toBe('Middleware-1');
  });

  it('arama metni 400 ms geciktirilir ve tek istek gider', async () => {
    render(<EnvanterPage />);
    await bekle(1000);
    const kutu = screen.getByRole('textbox');
    fireEvent.change(kutu, { target: { value: 'g' } });
    await bekle(100);
    fireEvent.change(kutu, { target: { value: 'gb' } });
    await bekle(399);
    expect(m.data).toHaveBeenCalledTimes(1);
    await bekle(1);
    await bekle(1000);
    expect(m.data).toHaveBeenCalledTimes(2);
    expect(m.data.mock.calls[1][1]).toMatchObject({ search: 'gb', page: 1 });
  });

  it('gec gelen eski tablo yaniti yeni tablonun verisini ezmez', async () => {
    let eskiyiCoz: (r: Res) => void = () => {};
    m.data.mockImplementationOnce(
      () =>
        new Promise<Res>((res) => {
          eskiyiCoz = res;
        }),
    );
    render(<EnvanterPage />);
    await bekle(1000);
    expect(m.data).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Middleware' }));
    await bekle(1000);
    expect(m.data).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId('satirlar').textContent).toBe('Middleware-1');
    await act(async () => {
      eskiyiCoz(yanit('ESKI-Inventory'));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByTestId('satirlar').textContent).toBe('Middleware-1');
  });
});
