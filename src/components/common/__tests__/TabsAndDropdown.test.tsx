// @vitest-environment jsdom
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import Tabs from '../Tabs';
import { ColumnFilterDropdown } from '../../envanter/ColumnFilterDropdown';
import HistoryPanel from '../../envanter/HistoryPanel';
import DynamicTable from '../../envanter/DynamicTable';
import { inventoryApi } from '@/api/inventoryApi';

vi.mock('@/api/inventoryApi', async () => {
  const actual = await vi.importActual<typeof import('@/api/inventoryApi')>('@/api/inventoryApi');
  return {
    ...actual,
    inventoryApi: {
      ...actual.inventoryApi,
      distinct: vi.fn(),
      historyAt: vi.fn(),
      historyDiff: vi.fn(),
    },
  };
});

describe('Tabs, ColumnFilterDropdown, HistoryPanel, and DynamicTable', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Tabs', () => {
    it('supports uncontrolled and controlled modes, pills/underline variants, nested, and counts', () => {
      const onChange = vi.fn();
      const { rerender } = render(
        <Tabs
          tabs={[
            { id: 't1', label: 'Tab 1', count: 5, content: <div>Content 1</div> },
            { id: 't2', label: 'Tab 2', count: 0, content: <div>Content 2</div> },
          ]}
        />,
      );

      expect(screen.getByText('Content 1')).toBeTruthy();
      expect(screen.getByText('5')).toBeTruthy();
      fireEvent.click(screen.getByText('Tab 2'));
      expect(screen.getByText('Content 2')).toBeTruthy();

      // Controlled mode with onChange
      rerender(
        <Tabs
          nested
          size="sm"
          activeTab={0}
          onChange={onChange}
          tabs={[
            { id: 't1', label: 'Tab 1', content: <div>Nested 1</div> },
            { id: 't2', label: 'Tab 2', content: <div>Nested 2</div> },
          ]}
        />,
      );
      expect(screen.getByText('Nested 1')).toBeTruthy();
      fireEvent.click(screen.getByText('Tab 2'));
      expect(onChange).toHaveBeenCalledWith(1);

      // Pills variant
      rerender(
        <Tabs
          variant="pills"
          size="sm"
          activeTab={1}
          tabs={[
            { id: 't1', label: 'Pill 1' },
            { id: 't2', label: 'Pill 2' },
          ]}
        />,
      );
      expect(screen.getByText('Pill 2')).toBeTruthy();
    });
  });

  describe('ColumnFilterDropdown', () => {
    it('loads distinct values, filters by search, toggles, selects all, clears, resets, and applies', async () => {
      vi.mocked(inventoryApi.distinct).mockResolvedValue({
        ok: true,
        values: [
          { value: 'Prod', count: 10 },
          { value: 'Test', count: 4 },
          { value: '', count: 1 },
        ],
      });

      const onApply = vi.fn();
      const onClose = vi.fn();
      const anchor = document.createElement('button');
      document.body.appendChild(anchor);

      render(
        <ColumnFilterDropdown
          table="Inventory"
          col="env"
          selected={['Prod']}
          activeFilters={{ env: ['Prod'] }}
          anchorEl={anchor}
          onApply={onApply}
          onClose={onClose}
        />,
      );

      await waitFor(() => expect(screen.getByText('Prod')).toBeTruthy());
      expect(screen.getByText('(boş)')).toBeTruthy();

      // Select all
      fireEvent.click(screen.getByText('Tümü'));
      expect(screen.getByText('3 seçili')).toBeTruthy();

      // Clear all
      fireEvent.click(screen.getByText('Temizle'));

      // Toggle single item
      fireEvent.click(screen.getByText('Test'));
      expect(screen.getByText('1 seçili')).toBeTruthy();

      // Search input triggers distinct reload
      fireEvent.change(screen.getByPlaceholderText('Ara...'), { target: { value: 'Te' } });
      await waitFor(() => expect(inventoryApi.distinct).toHaveBeenCalledTimes(2));

      // Apply
      fireEvent.click(screen.getByText(/Uygula/i));
      expect(onApply).toHaveBeenCalledWith(['Test']);
      expect(onClose).toHaveBeenCalled();

      // Outside click closes dropdown
      fireEvent.mouseDown(document.body);
      document.body.removeChild(anchor);
    });

    it('handles reset button and empty values', async () => {
      vi.mocked(inventoryApi.distinct).mockResolvedValue({
        ok: true,
        values: [],
      });
      const onApply = vi.fn();
      const onClose = vi.fn();
      render(
        <ColumnFilterDropdown
          table="Inventory"
          col="env"
          selected={['Prod']}
          anchorEl={null}
          onApply={onApply}
          onClose={onClose}
        />,
      );
      await waitFor(() => expect(screen.getByText('Değer bulunamadı.')).toBeTruthy());
      fireEvent.click(screen.getByText('Sıfırla'));
      expect(onApply).toHaveBeenCalledWith([]);
      expect(onClose).toHaveBeenCalled();
    });
  });

  describe('HistoryPanel', () => {
    it('loads snapshot rows in "at" mode, filters client-side, and switches to "diff" mode', async () => {
      vi.mocked(inventoryApi.historyAt).mockResolvedValue({
        ok: true,
        at: '2026-10-01',
        count: 2,
        rows: [
          { key: 'SRV1', data: { hostname: 'SRV1', env: 'Prod' } },
          { key: 'SRV2', data: { hostname: 'SRV2', env: 'Test' } },
        ],
      });
      vi.mocked(inventoryApi.historyDiff).mockResolvedValue({
        ok: true,
        added: [{ key: 'SRV3', data: { hostname: 'SRV3' } }],
        removed: [{ key: 'SRV0', data: { hostname: 'SRV0' } }],
        changed: [
          {
            key: 'SRV1',
            fields: {
              env: { before: 'Test', after: 'Prod' },
            },
          },
        ],
      });

      render(<HistoryPanel open table="Inventory" label="Sunucu Envanteri" onClose={vi.fn()} />);

      await waitFor(() => expect(screen.getByText('SRV1')).toBeTruthy());
      expect(screen.getByText('SRV2')).toBeTruthy();

      // Filter rows
      fireEvent.change(screen.getByPlaceholderText('Satırlarda ara…'), {
        target: { value: 'SRV1' },
      });
      expect(screen.getByText('SRV1')).toBeTruthy();
      expect(screen.queryByText('SRV2')).toBeNull();

      // Switch to diff mode
      fireEvent.click(screen.getByText('İki Tarih Farkı'));
      await waitFor(() => expect(screen.getByText('SRV3')).toBeTruthy());
      expect(screen.getByText('SRV0')).toBeTruthy();
      expect(screen.getByText('SRV1')).toBeTruthy();
    });

    it('renders empty history state and error state', async () => {
      vi.mocked(inventoryApi.historyAt).mockResolvedValueOnce({
        ok: true,
        at: '2026-10-01',
        count: 0,
        rows: [],
      });

      const { unmount } = render(<HistoryPanel open table="Inventory" onClose={vi.fn()} />);
      await waitFor(() =>
        expect(screen.getByText('Bu tarih için kayıtlı geçmiş yok.')).toBeTruthy(),
      );
      unmount();

      vi.mocked(inventoryApi.historyAt).mockResolvedValueOnce({
        ok: false,
        at: '2026-10-01',
        count: 0,
        rows: [],
        message: 'History DB error',
      });
      render(<HistoryPanel open table="Inventory" onClose={vi.fn()} />);
      await waitFor(() => expect(screen.getByText('History DB error')).toBeTruthy());
    });
  });

  describe('DynamicTable', () => {
    it('renders loading skeleton, empty state, client-side sorting, env badges, and server sorting', async () => {
      vi.mocked(inventoryApi.distinct).mockResolvedValue({ ok: true, values: [] });
      const onApplyColumnFilter = vi.fn();
      const onSort = vi.fn();

      const { rerender } = render(
        <DynamicTable
          table="Inventory"
          columns={['hostname', 'env', 'updated_at']}
          visibleCols={['hostname', 'env', 'updated_at']}
          rows={[]}
          multiFilters={{}}
          onApplyColumnFilter={onApplyColumnFilter}
          loading
        />,
      );
      expect(document.querySelectorAll('.skeleton').length).toBeGreaterThan(0);

      // Client-side sorting with rows and env badges
      rerender(
        <DynamicTable
          table="Inventory"
          columns={['hostname', 'env', 'updated_at']}
          visibleCols={['hostname', 'env', 'updated_at']}
          rows={[
            { hostname: 'B-HOST', env: 'Production', updated_at: new Date('2026-01-01T00:00:00Z') },
            { hostname: 'A-HOST', env: 'Test', updated_at: null },
            { hostname: 'C-HOST', env: 'CustomEnv', updated_at: '2026-02-01' },
          ]}
          multiFilters={{ env: ['Production'] }}
          onApplyColumnFilter={onApplyColumnFilter}
        />,
      );

      expect(screen.getByText('Production')).toBeTruthy();
      expect(screen.getByText('Test')).toBeTruthy();
      expect(screen.getByText('CustomEnv')).toBeTruthy();

      // Click hostname column header to sort asc -> desc -> null
      fireEvent.click(screen.getByText('hostname'));
      fireEvent.click(screen.getByText('hostname'));
      fireEvent.click(screen.getByText('hostname'));

      // Server-side sort mode
      rerender(
        <DynamicTable
          table="Inventory"
          columns={['hostname', 'env']}
          visibleCols={['hostname', 'env']}
          rows={[]}
          multiFilters={{}}
          onApplyColumnFilter={onApplyColumnFilter}
          sortBy="hostname"
          sortDir="ASC"
          onSort={onSort}
        />,
      );
      fireEvent.click(screen.getByText('hostname'));
      expect(onSort).toHaveBeenCalledWith('hostname', 'DESC');
    });
  });
});
