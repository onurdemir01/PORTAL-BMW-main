// src/components/denetim/__tests__/AppEnvs.test.tsx
//
// Denetim > Uygulama Ortamları (2026-08-23). Sunucu ucunun davranışı server/audit/__tests__/
// uygulama-ortamlari.test.js'te; burada ekran. Kilitlenen davranış:
//   AU1 yüklenirken logo; matris: ortam başlıkları, VAR / YOK, çok sunuculu kutuda ×N ve ipucu,
//       özet sayıları, en sık eksik desenleri, kapsam dışı env notu, sekme sayıları
//   AU2 arama taban adda (harf duyarsız) ve "Sadece eksiği olanlar"; boş sonuç satırı
//   AU3 ad kuralı dışı görünümü: sebep, boş env sütunu "—", 6'dan fazla sunucu "… (+N)"; boş liste
//   AU4 çelişki görünümü ve boş liste açıklaması
//   AU5 CSV her görünümde kendi sütun ve satırlarıyla, kaynak adıyla
//   AU6 kaynak değişimi yeni istek atar; Yenile aynı kaynakla yeniden ister
//   AU7 hata: ileti, iletisiz ret, istisna, metin olarak fırlatılan hata; hata ekranında "Tekrar
//       dene" var (eskiden Yenile başarısız olunca düğme de kayboluyordu); ekran kapandıktan sonra
//       gelen yanıt yok sayılır
//   AU8 matris ilk 500 satırla sınırlı, not gösterilir
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, within, waitFor } from '@testing-library/react';
import { render } from '@/test/test-utils';
import AppEnvs from '@/components/denetim/AppEnvs';
import type { AppEnvsResult, AppEnvRow } from '@/api/denetimApi';

const mockApi = vi.hoisted(() => vi.fn());
const mockCsv = vi.hoisted(() => vi.fn());
vi.mock('@/api/denetimApi', () => ({ denetimApi: { appEnvs: mockApi } }));
vi.mock('@/utils/csv', () => ({ downloadCsv: mockCsv }));

const ENVS = ['DEV', 'TEST', 'QA', 'PROD'];
const hucre = (...hosts: string[]) => ({ hosts, rows: hosts.length });

function satir(base: string, var_: Record<string, string[]>): AppEnvRow {
  const envs = Object.fromEntries(ENVS.map((e) => [e, var_[e] ? hucre(...var_[e]) : null]));
  const missing = ENVS.filter((e) => !var_[e]);
  return {
    base,
    envs,
    present: ENVS.filter((e) => var_[e]),
    missing,
    missingCount: missing.length,
  };
}

const VERI = (o: Partial<AppEnvsResult> = {}): AppEnvsResult => ({
  ok: true,
  source: 'mw',
  label: 'JBoss uygulamalari',
  sources: [
    { key: 'mw', label: 'JBoss uygulamalari' },
    { key: 'was', label: 'WAS uygulamalari' },
  ],
  envs: ENVS,
  totalRows: 12,
  totalApps: 3,
  completeCount: 1,
  patterns: [{ missing: ['DEV', 'QA'], count: 2 }],
  rows: [
    satir('borc', { QA: ['q1', 'q9'] }),
    satir('cari', { TEST: ['t1'], PROD: ['p1', 'p2', 'p3'] }),
    satir('odeme', { DEV: ['d1'], TEST: ['t2'], QA: ['q2'], PROD: ['p4'] }),
  ],
  nonStandard: [
    {
      app: 'fatura-PROD',
      reason: 'Ortam sözcüğüyle biten ad: -PROD',
      hosts: ['h1'],
      envColumn: ['Production'],
    },
    {
      app: 'kasa-x',
      reason: 'Küçük harfli son ek',
      hosts: ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'h7', 'h8'],
      envColumn: [],
    },
  ],
  conflicts: [{ app: 'cari-Q', base: 'cari', nameEnv: 'QA', envColumn: 'Test', hosts: ['t5'] }],
  outOfScopeEnvColumns: [{ envColumn: 'Alpha', appCount: 2, known: true }],
  ...o,
});

beforeEach(() => {
  mockApi.mockReset();
  mockCsv.mockReset();
});

async function ac(veri: AppEnvsResult = VERI()) {
  mockApi.mockResolvedValue(veri);
  render(<AppEnvs />);
  await screen.findByRole('table');
}

const satirlar = () => within(screen.getByRole('table')).getAllByRole('row').slice(1);
const ilkHucre = (r: HTMLElement) => within(r).getAllByRole('cell')[0].textContent;

describe('AppEnvs', () => {
  it('AU1 matris, özet ve notlar', async () => {
    let coz: (v: AppEnvsResult) => void = () => {};
    mockApi.mockReturnValue(new Promise((r) => (coz = r)));
    render(<AppEnvs />);
    expect(screen.getByText('Yükleniyor…')).toBeInTheDocument();
    coz(VERI());
    await screen.findByRole('table');
    expect(mockApi).toHaveBeenCalledWith('mw');

    const basliklar = within(screen.getByRole('table')).getAllByRole('columnheader');
    expect(basliklar.map((h) => h.textContent)).toEqual(['Uygulama', ...ENVS]);
    const [borc, cari, odeme] = satirlar();
    expect(
      within(borc)
        .getAllByRole('cell')
        .map((c) => c.textContent),
    ).toEqual(['borc', 'YOK', 'YOK', 'VAR×2', 'YOK']);
    const cariProd = within(cari).getAllByRole('cell')[4];
    expect(cariProd.textContent).toBe('VAR×3');
    expect(cariProd.querySelector('span')?.getAttribute('title')).toBe(
      '3 kayıt\nSunucular: p1, p2, p3',
    );
    expect(
      within(odeme)
        .getAllByRole('cell')
        .slice(1)
        .map((c) => c.textContent),
    ).toEqual(['VAR', 'VAR', 'VAR', 'VAR']);

    expect(screen.getByRole('button', { name: 'Matris (3)' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ad kuralı dışı (2)' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Çelişki (1)' })).toBeInTheDocument();
    for (const [sayi, etiket] of [
      ['3', 'uygulama (taban ad)'],
      ['1', 'dört ortamda da var'],
      ['2', 'en az bir ortamda eksik'],
      ['3', 'ad kuralı dışı + çelişki'],
    ]) {
      expect(screen.getByText(etiket).previousElementSibling?.textContent).toBe(sayi);
    }
    expect(screen.getByText('En sık eksik ortam desenleri')).toBeInTheDocument();
    expect(screen.getByText('DEV, QA').parentElement?.textContent).toBe(
      'eksik: DEV, QA · 2 uygulama',
    );
    expect(
      screen.getByText(/Şu ortamların ad kuralında karşılığı yok: Alpha \(2 uygulama\)/),
    ).toBeInTheDocument();
  });

  it('AU1b desen ve kapsam dışı yoksa bölümler çizilmez; sapma yoksa özet kutusu nötr', async () => {
    await ac(VERI({ patterns: [], outOfScopeEnvColumns: [], nonStandard: [], conflicts: [] }));
    expect(screen.queryByText('En sık eksik ortam desenleri')).toBeNull();
    expect(screen.queryByText(/karşılığı yok/)).toBeNull();
    const kutu = screen.getByText('ad kuralı dışı + çelişki').previousElementSibling;
    expect(kutu?.textContent).toBe('0');
    expect(kutu?.className).not.toMatch(/amber/);
  });

  it('AU2 arama ve yalnız eksikler', async () => {
    await ac(VERI({ rows: [...VERI().rows, satir('KREDI-Api', { PROD: ['p9'] })] }));
    fireEvent.change(screen.getByPlaceholderText('uygulama ara'), {
      target: { value: 'kredi-api' },
    });
    expect(satirlar().map(ilkHucre)).toEqual(['KREDI-Api']);
    fireEvent.change(screen.getByPlaceholderText('uygulama ara'), { target: { value: '  CAR ' } });
    expect(satirlar().map(ilkHucre)).toEqual(['cari']);
    fireEvent.change(screen.getByPlaceholderText('uygulama ara'), { target: { value: '' } });
    fireEvent.click(screen.getByLabelText('Sadece eksiği olanlar'));
    expect(satirlar().map(ilkHucre)).toEqual(['borc', 'cari', 'KREDI-Api']);
    fireEvent.change(screen.getByPlaceholderText('uygulama ara'), { target: { value: 'odeme' } });
    expect(satirlar().map(ilkHucre)).toEqual(['Kayıt bulunamadı.']);
  });

  it('AU3 ad kuralı dışı görünümü', async () => {
    await ac();
    fireEvent.click(screen.getByRole('button', { name: 'Ad kuralı dışı (2)' }));
    expect(screen.queryByLabelText('Sadece eksiği olanlar')).toBeNull();
    const [fatura, kasa] = satirlar();
    expect(
      within(fatura)
        .getAllByRole('cell')
        .map((c) => c.textContent),
    ).toEqual(['fatura-PROD', 'Ortam sözcüğüyle biten ad: -PROD', 'Production', 'h1']);
    expect(
      within(kasa)
        .getAllByRole('cell')
        .map((c) => c.textContent),
    ).toEqual(['kasa-x', 'Küçük harfli son ek', '—', 'h1, h2, h3, h4, h5, h6 … (+2)']);
    fireEvent.change(screen.getByPlaceholderText('uygulama ara'), { target: { value: 'KASA' } });
    expect(satirlar().map(ilkHucre)).toEqual(['kasa-x']);
    fireEvent.change(screen.getByPlaceholderText('uygulama ara'), { target: { value: 'yok' } });
    expect(screen.getByText('Ad kuralına uymayan uygulama yok.')).toBeInTheDocument();
  });

  it('AU4 çelişki görünümü', async () => {
    const cokHost = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
    await ac(
      VERI({
        conflicts: [
          { app: 'cari-Q', base: 'cari', nameEnv: 'QA', envColumn: 'Test', hosts: ['t5'] },
          { app: 'odeme', base: 'odeme', nameEnv: 'PROD', envColumn: 'Test', hosts: cokHost },
        ],
      }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Çelişki (2)' }));
    expect(screen.getByText(/uygulamaları bu listeye/)).toBeInTheDocument();
    const [cari, odeme] = satirlar();
    expect(
      within(cari)
        .getAllByRole('cell')
        .map((c) => c.textContent),
    ).toEqual(['cari-Q', 'QA', 'Test', 't5']);
    expect(within(odeme).getAllByRole('cell')[3].textContent).toBe('a, b, c, d, e, f … (+1)');
    fireEvent.change(screen.getByPlaceholderText('uygulama ara'), { target: { value: 'zz' } });
    expect(screen.getByText('Çelişki bulunamadı.')).toBeInTheDocument();
    expect(
      screen.getByText('Bu tarama turunda ortamlar arasında ad çakışması saptanmadı.'),
    ).toBeInTheDocument();
  });

  it('AU5 CSV her görünümde', async () => {
    await ac();
    fireEvent.click(screen.getByLabelText('Sadece eksiği olanlar'));
    fireEvent.click(screen.getByRole('button', { name: 'CSV' }));
    expect(mockCsv).toHaveBeenLastCalledWith(
      'uygulama_ortamlari_mw',
      ['uygulama', 'DEV', 'TEST', 'QA', 'PROD', 'eksik'],
      [
        ['borc', 'YOK', 'YOK', 'VAR', 'YOK', 'DEV TEST PROD'],
        ['cari', 'YOK', 'VAR', 'YOK', 'VAR', 'DEV QA'],
      ],
    );
    fireEvent.click(screen.getByRole('button', { name: 'Ad kuralı dışı (2)' }));
    fireEvent.click(screen.getByRole('button', { name: 'CSV' }));
    expect(mockCsv).toHaveBeenLastCalledWith(
      'ad_kurali_disi_mw',
      ['uygulama', 'sebep', 'env_sutunu', 'sunucular'],
      [
        ['fatura-PROD', 'Ortam sözcüğüyle biten ad: -PROD', 'Production', 'h1'],
        ['kasa-x', 'Küçük harfli son ek', '', 'h1 h2 h3 h4 h5 h6 h7 h8'],
      ],
    );
    fireEvent.click(screen.getByRole('button', { name: 'Çelişki (1)' }));
    fireEvent.click(screen.getByRole('button', { name: 'CSV' }));
    expect(mockCsv).toHaveBeenLastCalledWith(
      'ortam_celiskisi_mw',
      ['uygulama', 'ad_ortami', 'env_sutunu', 'sunucular'],
      [['cari-Q', 'QA', 'Test', 't5']],
    );
  });

  it('AU6 kaynak değişimi ve Yenile', async () => {
    await ac();
    mockApi.mockResolvedValue(
      VERI({ source: 'was', label: 'WAS uygulamalari', rows: [satir('islem', { PROD: ['w1'] })] }),
    );
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'was' } });
    await waitFor(() => expect(satirlar().map(ilkHucre)).toEqual(['islem']));
    expect(mockApi).toHaveBeenLastCalledWith('was');

    mockApi.mockResolvedValue(VERI({ rows: [satir('yeni', { DEV: ['d'] })] }));
    fireEvent.click(screen.getByRole('button', { name: 'Yenile' }));
    await waitFor(() => expect(satirlar().map(ilkHucre)).toEqual(['yeni']));
    expect(mockApi).toHaveBeenLastCalledWith('was');
    fireEvent.click(screen.getByRole('button', { name: 'CSV' }));
    expect(mockCsv.mock.lastCall?.[0]).toBe('uygulama_ortamlari_was');
  });

  it('AU7 hata durumları', async () => {
    mockApi.mockResolvedValue({ ok: false, message: 'Envanter DB yok' });
    const { unmount } = render(<AppEnvs />);
    expect(await screen.findByText('Envanter DB yok')).toBeInTheDocument();
    unmount();

    mockApi.mockResolvedValue({ ok: false });
    const b = render(<AppEnvs />);
    expect(await screen.findByText('Veri alınamadı.')).toBeInTheDocument();
    b.unmount();

    mockApi.mockRejectedValue(new Error('ağ hatası'));
    const c = render(<AppEnvs />);
    expect(await screen.findByText('ağ hatası')).toBeInTheDocument();
    c.unmount();

    mockApi.mockRejectedValue('düz metin');
    render(<AppEnvs />);
    expect(await screen.findByText('düz metin')).toBeInTheDocument();
  });

  it('AU7b Yenile başarısız olursa hata ve yeniden deneme yolu', async () => {
    await ac();
    mockApi.mockResolvedValue({ ok: false, message: 'Envanter DB yok' });
    fireEvent.click(screen.getByRole('button', { name: 'Yenile' }));
    expect(await screen.findByText('Envanter DB yok')).toBeInTheDocument();
    mockApi.mockResolvedValue({ ok: false });
    fireEvent.click(screen.getByRole('button', { name: 'Tekrar dene' }));
    expect(await screen.findByText('Veri alınamadı.')).toBeInTheDocument();
    const uyari = screen.getByRole('alert');
    expect(within(uyari).getByText('Uygulama ortamları okunamadı')).toBeInTheDocument();
    expect(within(uyari).getByText('Veri alınamadı.')).toBeInTheDocument();

    mockApi.mockRejectedValue(new Error('zaman aşımı'));
    fireEvent.click(within(uyari).getByRole('button', { name: 'Tekrar dene' }));
    expect(await screen.findByText('zaman aşımı')).toBeInTheDocument();
    mockApi.mockRejectedValue('bağlantı koptu');
    fireEvent.click(screen.getByRole('button', { name: 'Tekrar dene' }));
    expect(await screen.findByText('bağlantı koptu')).toBeInTheDocument();

    mockApi.mockResolvedValue(VERI());
    fireEvent.click(screen.getByRole('button', { name: 'Tekrar dene' }));
    await screen.findByRole('table');
    expect(screen.queryByRole('alert')).toBeNull();
    expect(mockApi).toHaveBeenLastCalledWith('mw');
  });

  it('AU7d ekran istek sürerken kapanırsa geç gelen yanıt yok sayılır', async () => {
    const hata = vi.spyOn(console, 'error').mockImplementation(() => {});
    for (const sonuc of ['basari', 'ret', 'istisna'] as const) {
      let coz: (v: unknown) => void = () => {};
      let red: (e: unknown) => void = () => {};
      mockApi.mockReturnValue(
        new Promise((r, j) => {
          coz = r;
          red = j;
        }),
      );
      const { unmount } = render(<AppEnvs />);
      unmount();
      if (sonuc === 'basari') coz(VERI());
      else if (sonuc === 'ret') coz({ ok: false, message: 'geç' });
      else red(new Error('geç'));
      await new Promise((r) => setTimeout(r, 0));
    }
    expect(hata).not.toHaveBeenCalled();
    hata.mockRestore();
  });

  it('AU8 matris ilk 500 satırla sınırlı', async () => {
    const rows = Array.from({ length: 501 }, (_, i) =>
      satir(`u${String(i).padStart(3, '0')}`, { PROD: ['p'] }),
    );
    await ac(VERI({ rows, totalApps: 501 }));
    expect(satirlar()).toHaveLength(500);
    expect(screen.getByText(/İlk 500 satır gösteriliyor/)).toBeInTheDocument();
  });
});
