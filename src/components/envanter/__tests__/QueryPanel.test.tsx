// src/components/envanter/__tests__/QueryPanel.test.tsx
//
// Envanter > Custom SQL paneli (yalnız Admin'e açılır). Kilitlenen davranış:
//   QP1 kayıtlı sorgular: ad, açıklama, Canlı / Varsayılan rozetleri, yayınlayan; tıklanınca SQL
//       metin kutusuna yüklenir; Admin eylemleri yalnız Admin'de
//   QP2 çalıştırma: sonuç sayısı, üst sınır uyarısı, CSV (sonucun tamamı, sorgu adıyla, güvenli dosya
//       adı); sunucu hatası ve istisna hata kutusunda; Temizle
//   QP3 kaydetme: başarıda liste tazelenir, alanlar boşalır, bildirim ve üst bilgi; ad yoksa pasif
//   QP4 sil / canlıya at / varsayılan yap: yalnız sunucu `ok` derse liste değişir ve başarı yazılır
//   QP5 HATA SESSİZ DEĞİL: kaydet / sil / canlıya at / varsayılan yap ve açılıştaki liste okuması
//       başarısız olursa sunucunun iletisi gösterilir, liste değişmez, başarı yazılmaz
//   QP6 yardım paneli örnek SQL'i metin kutusuna koyar
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, within, waitFor, act } from '@testing-library/react';
import { render } from '@/test/test-utils';
import QueryPanel from '@/components/envanter/QueryPanel';
import type { SavedQuery } from '@/api/inventoryApi';

const api = vi.hoisted(() => ({
  savedQueries: vi.fn(),
  runQuery: vi.fn(),
  deleteSavedQuery: vi.fn(),
  publishQuery: vi.fn(),
  setDefaultQuery: vi.fn(),
}));
const mockCsv = vi.hoisted(() => vi.fn());
vi.mock('@/api/inventoryApi', () => ({ inventoryApi: api }));
vi.mock('@/utils/csv', () => ({ downloadCsv: mockCsv }));
vi.mock('@/components/envanter/DynamicTable', () => ({
  default: ({ columns, rows }: { columns: string[]; rows: Record<string, unknown>[] }) => (
    <div data-testid="tablo">
      {columns.join('|')}#{rows.length}
    </div>
  ),
}));
vi.mock('@/components/envanter/QueryHelpPanel', () => ({
  default: ({ onInsertExample }: { onInsertExample: (s: string) => void }) => (
    <button onClick={() => onInsertExample('SELECT 1 AS ornek')}>örneği koy</button>
  ),
}));

const Q = (o: Partial<SavedQuery> & Pick<SavedQuery, 'name'>): SavedQuery => ({
  sql: `SELECT * FROM ${o.name}`,
  savedAt: '2026-11-01',
  isPublished: false,
  isDefault: false,
  publishedBy: '',
  description: '',
  ...o,
});
const LISTE = [
  Q({
    name: 'Prod',
    description: 'canlı sunucular',
    isPublished: true,
    isDefault: true,
    publishedBy: 'ali',
  }),
  Q({ name: 'Test' }),
];

beforeEach(() => {
  for (const f of Object.values(api)) f.mockReset();
  mockCsv.mockReset();
  api.savedQueries.mockResolvedValue({ ok: true, queries: LISTE });
});

async function ac(props: Partial<React.ComponentProps<typeof QueryPanel>> = {}) {
  const onClose = vi.fn();
  const onQueriesChange = vi.fn();
  render(<QueryPanel onClose={onClose} isAdmin onQueriesChange={onQueriesChange} {...props} />);
  await screen.findByText('Kayıtlı Sorgular');
  return { onClose, onQueriesChange };
}

const sqlKutusu = () =>
  screen.getByPlaceholderText(
    "SELECT * FROM Inventory WHERE env = 'Production'",
  ) as HTMLTextAreaElement;
const satir = (ad: string) =>
  screen.getByRole('button', { name: new RegExp(`^${ad}`) }).parentElement!;

describe('QueryPanel', () => {
  it('QP1 kayıtlı sorgular, yükleme ve Admin eylemleri', async () => {
    const { onClose } = await ac();
    const prod = satir('Prod');
    expect(within(prod).getByText('Canlı')).toBeInTheDocument();
    expect(within(prod).getByText('Varsayılan')).toBeInTheDocument();
    expect(within(prod).getByText('ali')).toBeInTheDocument();
    expect(within(prod).getByText('— canlı sunucular')).toBeInTheDocument();
    expect(within(prod).getByTitle('Canlıdan Kaldır')).toBeInTheDocument();
    expect(within(satir('Test')).getByTitle('Canlıya At')).toBeInTheDocument();
    expect(within(satir('Test')).queryByText('Canlı')).toBeNull();

    expect(sqlKutusu().value).toBe('SELECT TOP 100 * FROM Inventory');
    fireEvent.click(screen.getByRole('button', { name: /^Test/ }));
    expect(sqlKutusu().value).toBe('SELECT * FROM Test');
    fireEvent.click(screen.getByRole('button', { name: 'Kapat' }));
    expect(onClose).toHaveBeenCalled();
  });

  it('QP1b Admin değilse yalnız sil düğmesi', async () => {
    await ac({ isAdmin: false });
    expect(screen.queryByTitle('Canlıya At')).toBeNull();
    expect(screen.queryByTitle('Varsayılan Yap')).toBeNull();
    expect(screen.getAllByTitle('Sil')).toHaveLength(2);
    // Silme ucu Admin ister (403): ret iletisi gorunur, sorgu listede kalir.
    api.deleteSavedQuery.mockResolvedValue({ ok: false, error: 'Admin yetkisi gerekli.' });
    fireEvent.click(screen.getAllByTitle('Sil')[0]);
    expect(await screen.findByText('Admin yetkisi gerekli.')).toBeInTheDocument();
    expect(screen.getAllByTitle('Sil')).toHaveLength(2);
  });

  it('QP2 çalıştırma, sonuç, CSV, hata ve Temizle', async () => {
    await ac();
    api.runQuery.mockResolvedValue({
      ok: true,
      columns: ['host', 'env'],
      rows: [
        { host: 'a', env: 'P' },
        { host: 'b', env: 'T' },
      ],
      rowCount: 2,
      limit: 2,
      truncated: true,
    });
    fireEvent.change(sqlKutusu(), { target: { value: 'SELECT host, env FROM Inventory' } });
    fireEvent.click(screen.getByRole('button', { name: 'Çalıştır' }));
    expect(await screen.findByTestId('tablo')).toHaveTextContent('host|env#2');
    expect(api.runQuery).toHaveBeenCalledWith('SELECT host, env FROM Inventory');
    expect(screen.getByText(/2 kayıt döndü\./)).toBeInTheDocument();
    expect(screen.getByText(/Üst sınıra \(2\) ulaşıldı/)).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText('Sorgu adı...'), {
      target: { value: 'Prod / Ağ 1' },
    });
    fireEvent.click(screen.getByRole('button', { name: /CSV \(2\)/ }));
    expect(mockCsv).toHaveBeenCalledWith(
      'Prod_A_1',
      ['host', 'env'],
      [
        ['a', 'P'],
        ['b', 'T'],
      ],
    );

    api.runQuery.mockResolvedValue({ ok: false, error: 'Yalnız SELECT çalıştırılabilir.' });
    fireEvent.click(screen.getByRole('button', { name: 'Çalıştır' }));
    expect(await screen.findByText('Yalnız SELECT çalıştırılabilir.')).toBeInTheDocument();
    expect(screen.queryByTestId('tablo')).toBeNull();
    api.runQuery.mockRejectedValue(new Error('ağ hatası'));
    fireEvent.click(screen.getByRole('button', { name: 'Çalıştır' }));
    expect(await screen.findByText('ağ hatası')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Temizle' }));
    expect(sqlKutusu().value).toBe('');
    expect(screen.queryByText('ağ hatası')).toBeNull();
  });

  it('QP2b boş sonuçta CSV pasif; üst sınır yoksa uyarı yok; ad yoksa custom_sql', async () => {
    await ac();
    api.runQuery.mockResolvedValue({ ok: true, columns: ['x'], rows: [], rowCount: 0 });
    fireEvent.click(screen.getByRole('button', { name: 'Çalıştır' }));
    expect(await screen.findByText(/0 kayıt döndü\./)).toBeInTheDocument();
    expect(screen.queryByText(/Üst sınıra/)).toBeNull();
    expect(screen.getByRole('button', { name: /CSV \(0\)/ })).toBeDisabled();

    api.runQuery.mockResolvedValue({ ok: true, columns: ['x'], rows: [{ x: 1 }], rowCount: 1 });
    fireEvent.click(screen.getByRole('button', { name: 'Çalıştır' }));
    fireEvent.click(await screen.findByRole('button', { name: /CSV \(1\)/ }));
    expect(mockCsv).toHaveBeenCalledWith('custom_sql', ['x'], [[1]]);
  });

  it('QP3 kaydetme başarıda liste tazelenir ve alanlar boşalır', async () => {
    const { onQueriesChange } = await ac();
    const kaydet = screen.getByTitle('Kaydet');
    expect(kaydet).toBeDisabled();
    fireEvent.change(screen.getByPlaceholderText('Sorgu adı...'), {
      target: { value: '  Yeni  ' },
    });
    fireEvent.change(screen.getByPlaceholderText('Açıklama (opsiyonel)'), {
      target: { value: ' a ' },
    });
    api.runQuery.mockResolvedValue({ ok: true, columns: [], rows: [], rowCount: 0 });
    api.savedQueries.mockResolvedValue({ ok: true, queries: [...LISTE, Q({ name: 'Yeni' })] });
    fireEvent.click(kaydet);
    expect(await screen.findByText('Sorgu kaydedildi.')).toBeInTheDocument();
    expect(api.runQuery).toHaveBeenCalledWith('SELECT TOP 100 * FROM Inventory', {
      save: true,
      queryName: 'Yeni',
      description: 'a',
    });
    expect(screen.getByRole('button', { name: /^Yeni/ })).toBeInTheDocument();
    expect((screen.getByPlaceholderText('Sorgu adı...') as HTMLInputElement).value).toBe('');
    expect(onQueriesChange).toHaveBeenCalledTimes(1);
  });

  it('QP4 sil / canlıya at / varsayılan yap başarıda listeyi günceller', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const { onQueriesChange } = await ac();
      api.publishQuery.mockResolvedValue({ ok: true });
      fireEvent.click(within(satir('Test')).getByTitle('Canlıya At'));
      expect(await screen.findByText('Sorgu durumu güncellendi.')).toBeInTheDocument();
      expect(within(satir('Test')).getByText('Canlı')).toBeInTheDocument();
      expect(api.publishQuery).toHaveBeenCalledWith('Test');
      // Ayni dugme canlidan da kaldirir.
      fireEvent.click(within(satir('Prod')).getByTitle('Canlıdan Kaldır'));
      await waitFor(() => expect(within(satir('Prod')).queryByText('Canlı')).toBeNull());

      api.setDefaultQuery.mockResolvedValue({ ok: true });
      fireEvent.click(within(satir('Test')).getByTitle('Varsayılan Yap'));
      expect(await screen.findByText('"Test" varsayılan sorgu yapıldı.')).toBeInTheDocument();
      expect(within(satir('Test')).getByText('Varsayılan')).toBeInTheDocument();
      expect(within(satir('Prod')).queryByText('Varsayılan')).toBeNull();

      api.deleteSavedQuery.mockResolvedValue({ ok: true });
      fireEvent.click(within(satir('Prod')).getByTitle('Sil'));
      expect(await screen.findByText('Sorgu silindi.')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /^Prod/ })).toBeNull();
      expect(api.deleteSavedQuery).toHaveBeenCalledWith('Prod');
      expect(onQueriesChange).toHaveBeenCalledTimes(4);

      // Bildirim 2,5 sn sonra kaybolur.
      await act(async () => {
        vi.advanceTimersByTime(2600);
      });
      expect(screen.queryByText('Sorgu silindi.')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('QP5 başarısız işlemler sessiz değil: ileti gösterilir, liste değişmez', async () => {
    const { onQueriesChange } = await ac();

    api.deleteSavedQuery.mockResolvedValue({ ok: false, error: 'Silinemedi: DB yok' });
    fireEvent.click(within(satir('Prod')).getByTitle('Sil'));
    expect(await screen.findByText('Silinemedi: DB yok')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Prod/ })).toBeInTheDocument();
    expect(screen.queryByText('Sorgu silindi.')).toBeNull();

    api.publishQuery.mockResolvedValue({ ok: false });
    fireEvent.click(within(satir('Test')).getByTitle('Canlıya At'));
    expect(await screen.findByText('Sorgu durumu güncellenemedi.')).toBeInTheDocument();
    expect(within(satir('Test')).queryByText('Canlı')).toBeNull();

    api.setDefaultQuery.mockRejectedValue(new Error('bağlantı koptu'));
    fireEvent.click(within(satir('Test')).getByTitle('Varsayılan Yap'));
    expect(await screen.findByText('bağlantı koptu')).toBeInTheDocument();
    expect(within(satir('Test')).queryByText('Varsayılan')).toBeNull();

    fireEvent.change(screen.getByPlaceholderText('Sorgu adı...'), { target: { value: 'Yeni' } });
    api.runQuery.mockResolvedValue({ ok: false, error: 'Kaydedilemedi: kilit' });
    fireEvent.click(screen.getByTitle('Kaydet'));
    expect(await screen.findByText('Kaydedilemedi: kilit')).toBeInTheDocument();
    expect(screen.queryByText('Sorgu kaydedildi.')).toBeNull();
    expect((screen.getByPlaceholderText('Sorgu adı...') as HTMLInputElement).value).toBe('Yeni');

    api.runQuery.mockRejectedValue('düz metin');
    fireEvent.click(screen.getByTitle('Kaydet'));
    expect(await screen.findByText('düz metin')).toBeInTheDocument();
    api.runQuery.mockResolvedValue({ ok: false });
    fireEvent.click(screen.getByTitle('Kaydet'));
    expect(await screen.findByText('Sorgu kaydedilemedi.')).toBeInTheDocument();
    expect(onQueriesChange).not.toHaveBeenCalled();
  });

  it('QP5b açılışta kayıtlı sorgular okunamazsa söylenir', async () => {
    api.savedQueries.mockResolvedValue({ ok: false, error: 'Admin yetkisi gerekli.' });
    const { unmount } = render(<QueryPanel onClose={() => {}} isAdmin />);
    expect(await screen.findByText('Admin yetkisi gerekli.')).toBeInTheDocument();
    expect(screen.queryByText('Kayıtlı Sorgular')).toBeNull();
    unmount();

    api.savedQueries.mockRejectedValue(new Error('ağ hatası'));
    const b = render(<QueryPanel onClose={() => {}} isAdmin />);
    expect(await screen.findByText('ağ hatası')).toBeInTheDocument();
    b.unmount();

    api.savedQueries.mockResolvedValue({ ok: false });
    render(<QueryPanel onClose={() => {}} isAdmin />);
    expect(await screen.findByText('Kayıtlı sorgular okunamadı.')).toBeInTheDocument();
  });

  it('QP6 yardım paneli örnek SQL koyar', async () => {
    await ac();
    expect(screen.queryByRole('button', { name: 'örneği koy' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Yardım/ }));
    fireEvent.click(screen.getByRole('button', { name: 'örneği koy' }));
    expect(sqlKutusu().value).toBe('SELECT 1 AS ornek');
    fireEvent.click(screen.getByRole('button', { name: /Yardım/ }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'örneği koy' })).toBeNull());
  });
});
