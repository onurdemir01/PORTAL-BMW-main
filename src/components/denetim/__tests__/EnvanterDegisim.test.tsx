// @vitest-environment jsdom
// Denetim > Envanter degisimi (2026-11-26, kapsam PR-2; %0): tablo listesi (hata, bos), sayaclar, trend, gelen / giden
// listeleri, en cok degisen kolonlar, tarama sagligi durum rozetleri, sessiz tablolar (hic degismemis / bir haftadir
// degismemis), suzgeclerin sorguya gitmesi, gecmis birikmedi durumu ve yukleme hatasi.
import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  historyTables: vi.fn(),
  historySeries: vi.fn(),
  historyDiff: vi.fn(),
  historyRuns: vi.fn(),
}));
vi.mock('@/api/inventoryApi', () => ({ inventoryApi: api }));

import EnvanterDegisim from '../EnvanterDegisim';

const once = (saat: number) => new Date(Date.now() - saat * 3_600_000).toISOString();
const TABLOLAR = [
  { table: 'sunucular', label: 'Sunucular', mode: 'snapshot', key: ['ad'] },
  { table: 'uygulamalar', label: 'Uygulamalar', mode: 'snapshot', key: ['ad'] },
  { table: 'sessiz', label: 'Sessiz tablo', mode: 'snapshot', key: ['ad'] },
  { table: 'hicdegismez', label: 'Hic degismez', mode: 'snapshot', key: ['ad'] },
  { table: 'orta', label: 'Uc gun once', mode: 'snapshot', key: ['ad'] },
  { table: 'yerel', label: 'Yerel gecmis', mode: 'native', key: ['id'] },
];
const kosu = (table_name: string, ek: Record<string, unknown> = {}) => ({
  table_name,
  started_at: once(2),
  finished_at: null,
  source_rows: 120,
  added: 0,
  changed: 0,
  removed: 0,
  status: 'ok',
  message: null,
  ...ek,
});

beforeEach(() => {
  api.historyTables.mockReset().mockResolvedValue({ ok: true, tables: TABLOLAR });
  api.historySeries.mockReset().mockResolvedValue({
    ok: true,
    series: [
      { date: '2026-11-24', count: 0 },
      { date: '2026-11-25', count: 80 },
      { date: '2026-11-26', count: 120 },
    ],
  });
  api.historyDiff.mockReset().mockResolvedValue({
    ok: true,
    added: [{ key: 'ORNAPP09', data: {} }],
    removed: [
      { key: 'ORNAPP01', data: {} },
      { key: 'ORNAPP02', data: {} },
    ],
    changed: [
      // ip once gorulur ama os daha cok degisir: siralama sayiya gore.
      { key: 'ORNAPP03', fields: { ip: { before: 1, after: 2 }, os: { before: 'a', after: 'b' } } },
      { key: 'ORNAPP04', fields: { os: { before: 'a', after: 'c' } } },
    ],
  });
  api.historyRuns.mockReset().mockResolvedValue({
    ok: true,
    runs: [
      kosu('sunucular', { added: 1, status: 'ok' }),
      kosu('uygulamalar', {
        status: 'aborted',
        source_rows: null,
        message: 'satir sayisi %60 dustu',
        started_at: once(30),
      }),
      kosu('sessiz', { status: 'ok', started_at: once(0.5) }),
      kosu('sessiz', { changed: 3, started_at: once(24 * 10) }),
      kosu('hicdegismez', { status: 'skipped' }),
      // Uc gun once degisen tablo sessiz DEGIL (esik bir hafta).
      kosu('orta', { removed: 2, started_at: once(24 * 3) }),
      // Sunucular'in eski bir degisikligi de var: son degisiklik en YENI olandir.
      kosu('sunucular', { changed: 5, started_at: once(24 * 12) }),
    ],
  });
});

describe('EnvanterDegisim', () => {
  it('sayaclar, trend, gelen / giden, kolonlar, saglik ve sessiz tablolar', async () => {
    render(<EnvanterDegisim />);
    expect(await screen.findByText('Gelen ve giden kayıtlar')).toBeTruthy();
    expect(api.historySeries).toHaveBeenCalledWith('sunucular', 30);
    expect(api.historyRuns).toHaveBeenCalledWith(200);
    const sayac = (ad: string) =>
      screen.getByText(ad, { selector: 'div' }).parentElement as HTMLElement;
    expect(within(sayac('Bugünkü satır')).getByText('120')).toBeTruthy();
    expect(within(sayac('Gelen')).getByText('1')).toBeTruthy();
    expect(within(sayac('Giden')).getByText('2')).toBeTruthy();
    expect(within(sayac('Değişen')).getByText('2')).toBeTruthy();
    expect(screen.getByTitle('2026-11-25: 80 satır')).toBeTruthy();
    expect(screen.getByText('en yüksek 120')).toBeTruthy();
    expect(screen.getByText('+ ORNAPP09')).toBeTruthy();
    expect(screen.getByText('− ORNAPP02')).toBeTruthy();
    // En cok degisen kolonlar: os (2) once, ip (1) sonra.
    const kolonlar = screen.getAllByTitle(/^(os|ip)$/).map((e) => e.textContent);
    expect(kolonlar).toEqual(['os', 'ip']);

    // Tarama sagligi: yalniz snapshot tablolar; son kosu esas.
    const satir = (ad: string) =>
      screen.getByText(ad, { selector: 'td' }).closest('tr') as HTMLElement;
    expect(within(satir('Sunucular')).getByText('Sağlıklı')).toBeTruthy();
    expect(within(satir('Sunucular')).getByText('2 saat önce')).toBeTruthy();
    expect(within(satir('Uygulamalar')).getByText('Durduruldu')).toBeTruthy();
    expect(within(satir('Uygulamalar')).getByText('1 gün önce')).toBeTruthy();
    expect(within(satir('Uygulamalar')).getByText('satir sayisi %60 dustu')).toBeTruthy();
    expect(within(satir('Sessiz tablo')).getByText('az önce')).toBeTruthy();
    expect(within(satir('Hic degismez')).getByText('Tablo yok')).toBeTruthy();
    expect(screen.queryByText('Yerel gecmis', { selector: 'td' })).toBeNull();

    // Sessiz: 10 gun once degisen ve hic degismeyen; son 2 saatte degisen degil.
    const sessiz = screen.getByText('Sessiz tablolar').closest('section') as HTMLElement;
    expect(within(sessiz).getByText('Sessiz tablo')).toBeTruthy();
    expect(within(sessiz).getByText(/10 gün önce/)).toBeTruthy();
    // Hic degisiklik gorulmemis iki tablo: durdurulan ve "tablo yok".
    expect(within(sessiz).getAllByText(/hiç görülmedi/)).toHaveLength(2);
    expect(within(sessiz).getByText('Uygulamalar')).toBeTruthy();
    expect(within(sessiz).queryByText('Sunucular')).toBeNull();
    expect(within(sessiz).queryByText('Uc gun once')).toBeNull();
    expect(screen.queryByText('Henüz geçmiş birikmedi.')).toBeNull();
  });

  it('suzgecler sorguya gider; yenile yeniden yukler', async () => {
    render(<EnvanterDegisim />);
    await screen.findByText('Gelen ve giden kayıtlar');
    fireEvent.change(screen.getByLabelText(/^Tablo/), { target: { value: 'uygulamalar' } });
    await waitFor(() => expect(api.historySeries).toHaveBeenLastCalledWith('uygulamalar', 30));
    fireEvent.change(screen.getByLabelText(/^Trend aralığı/), { target: { value: '90' } });
    await waitFor(() => expect(api.historySeries).toHaveBeenLastCalledWith('uygulamalar', 90));
    expect(await screen.findByText('Satır sayısı trendi (90 gün)')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Başlangıç'), { target: { value: '2026-11-01' } });
    fireEvent.change(screen.getByLabelText('Bitiş'), { target: { value: '2026-11-20' } });
    await waitFor(() =>
      expect(api.historyDiff).toHaveBeenLastCalledWith('uygulamalar', '2026-11-01', '2026-11-20'),
    );
    const n = api.historyRuns.mock.calls.length;
    fireEvent.click(screen.getByRole('button', { name: /Yenile/ }));
    await waitFor(() => expect(api.historyRuns.mock.calls.length).toBe(n + 1));
  });

  it('gecmis birikmedi: bos seri ve kosu yok; basarisiz yanitlar bos sayilir', async () => {
    api.historySeries.mockResolvedValue({ ok: false, series: [] });
    api.historyDiff.mockResolvedValue({ ok: false, added: [], removed: [], changed: [] });
    api.historyRuns.mockResolvedValue({ ok: false, runs: [] });
    render(<EnvanterDegisim />);
    expect(await screen.findByText('Henüz geçmiş birikmedi.')).toBeTruthy();
    expect(screen.queryByText('Gelen')).toBeNull();
    // Kosu yoksa saglik tablosu yine cizilir ama her hucre bos isareti tasir; sessiz liste yok.
    const satir = screen.getByText('Sunucular', { selector: 'td' }).closest('tr') as HTMLElement;
    expect(within(satir).getAllByText('—')).toHaveLength(4);
    expect(screen.queryByText('Sessiz tablolar')).toBeNull();
  });

  it('yukleme hatasi; tablo listesi hatasi; tablo yoksa yukleme biter', async () => {
    api.historyRuns.mockRejectedValueOnce(new Error('baglanti koptu'));
    const { unmount } = render(<EnvanterDegisim />);
    expect(await screen.findByText('baglanti koptu')).toBeTruthy();
    unmount();

    api.historyTables.mockResolvedValueOnce({ ok: false, message: 'Yetki yok' });
    const ikinci = render(<EnvanterDegisim />);
    expect(await screen.findByText('Yetki yok')).toBeTruthy();
    ikinci.unmount();

    api.historyTables.mockResolvedValueOnce({ ok: false });
    const ucuncu = render(<EnvanterDegisim />);
    expect(await screen.findByText('Tablo listesi alınamadı.')).toBeTruthy();
    ucuncu.unmount();

    api.historyTables.mockRejectedValueOnce('ag hatasi');
    const dorduncu = render(<EnvanterDegisim />);
    expect(await screen.findByText('ag hatasi')).toBeTruthy();
    dorduncu.unmount();

    // Gecmis tablosu tanimli degilse ekran sonsuza dek "yukleniyor" kalmaz.
    api.historyTables.mockResolvedValueOnce({ ok: true, tables: [] });
    render(<EnvanterDegisim />);
    expect(await screen.findByText('Henüz geçmiş birikmedi.')).toBeTruthy();
    expect(api.historySeries).toHaveBeenCalledTimes(1);
  });
});
