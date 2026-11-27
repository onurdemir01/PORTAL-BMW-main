// @vitest-environment jsdom
// Crypto Hub ana sayfası (2026-11-26, kapsam PR-2; dal %54): values seçenekleri ve karşılaştırma yolları (saf),
// kiracı listesi alınamadı, ortam seçici (uygulama / domain / ortam adımları, geri, kapalı ve production ortam,
// yapılandırma eksik), katalogda olmayan bağlantı, kapsam şeridi, yükleme hatası, yapılandırılmamış ortam, tablo yok
// uyarısı ve notlar, yeniden tarama (iş takibi ve bitince tazeleme; ret; istisna), "Ortamı değiştir".
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  tenants: vi.fn(),
  actions: vi.fn(),
  overview: vi.fn(),
  rescan: vi.fn(),
  jobStatus: vi.fn(),
  plan: vi.fn(),
}));
vi.mock('@/api/cryptoHubApi', () => ({
  cryptoHubApi: api,
  cryptoOpsApi: { run: vi.fn(), result: vi.fn(), valuesApply: vi.fn() },
  cryptoNodeApi: {},
}));
vi.mock('../NodePanel', () => ({ NodePanel: () => <div>NODE PANELI</div> }));
vi.mock('../CryptoHubSmartModal', () => ({ default: () => null }));
const is = vi.hoisted(() => ({ addJob: vi.fn() }));
vi.mock('@/contexts/JobTrackerContext', () => ({ useJobTracker: () => is }));
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: { username: 'ali', role: 'User' } }),
}));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('@/hooks/useToast', () => ({ toast }));

import CryptoHubPage, { karsilastirmaYollari, valuesSecenekleri } from '../CryptoHubPage';

const ortam = (key: string, ek: Record<string, unknown> = {}) => ({
  key,
  label: key.toUpperCase(),
  cluster: `ocp-${key}`,
  namespace: `${key}-ns`,
  production: false,
  open: true,
  ready: true,
  ...ek,
});
const UYGULAMALAR = [
  {
    app: 'metaco',
    label: 'Metaco',
    domains: [
      {
        domain: 'das',
        label: 'DAS',
        envs: [ortam('das_test'), ortam('das_prod', { production: true })],
      },
      {
        domain: 'harmonize',
        label: 'Harmonize',
        envs: [
          ortam('har_qa', { ready: false }),
          ortam('har_prod', { production: true, open: false }),
        ],
      },
    ],
  },
  {
    app: 'wyden',
    label: 'Wyden',
    domains: [{ domain: 'core', label: 'Core', envs: [ortam('wyd_test')] }],
  },
];

function Konum() {
  return <output data-testid="konum">{useLocation().search}</output>;
}
const ciz = (adres = '/crypto-hub') =>
  render(
    <MemoryRouter initialEntries={[adres]}>
      <Routes>
        <Route
          path="/crypto-hub"
          element={
            <>
              <CryptoHubPage />
              <Konum />
            </>
          }
        />
      </Routes>
    </MemoryRouter>,
  );

beforeEach(() => {
  Object.values(api).forEach((f) => f.mockReset());
  is.addJob.mockReset();
  toast.success.mockReset();
  toast.error.mockReset();
  api.tenants.mockResolvedValue({ ok: true, apps: UYGULAMALAR });
  api.actions.mockResolvedValue({ ok: true, actions: [] });
  api.overview.mockResolvedValue({
    ok: true,
    notConfigured: true,
    message: 'Bu ortamin tarama isi tanimli degil.',
  });
});

describe('saf yardımcılar', () => {
  it('valuesSecenekleri: koşan sürümün dosyaları önce; karsilastirmaYollari: alt dizindekiler varsa yalnız onlar', () => {
    const arsiv = [
      { version: '1.5.18', dir: '/v/1.5.18', values: [{ file: 'a.yaml' }] },
      { version: '1.5.19', dir: '/v/1.5.19', values: [{ file: 'b.yaml' }, { file: 'c.yaml' }] },
    ];
    expect(valuesSecenekleri(arsiv, '1.5.19').map((x) => x.label)).toEqual([
      '1.5.19 · b.yaml',
      '1.5.19 · c.yaml',
      '1.5.18 · a.yaml',
    ]);
    expect(valuesSecenekleri(arsiv, '')[0]).toEqual({
      path: '/v/1.5.18/a.yaml',
      label: '1.5.18 · a.yaml',
    });
    // Koşan sürüm bilinmiyorsa adı boş arşiv de "koşan" sayılmaz: sıra korunur.
    expect(
      valuesSecenekleri(
        [...arsiv, { version: '', dir: '/v/x', values: [{ file: 'd.yaml' }] }],
        '',
      ).at(-1)?.path,
    ).toBe('/v/x/d.yaml');
    expect(
      karsilastirmaYollari({
        dir: '/v/1',
        values: [{ file: 'kok.yaml' }, { file: 'cl1/x.yaml' }, { file: 'cl2/x.yaml' }],
      }),
    ).toEqual(['/v/1/cl1/x.yaml', '/v/1/cl2/x.yaml']);
    // Alt dizinde tek dosya: karşılaştırma için yetmez, hepsi alınır.
    expect(
      karsilastirmaYollari({ dir: '/v/1', values: [{ file: 'kok.yaml' }, { file: 'cl1/x.yaml' }] }),
    ).toEqual(['/v/1/kok.yaml', '/v/1/cl1/x.yaml']);
  });
});

describe('ortam seçici', () => {
  it('uygulama -> domain -> ortam; geri; kapalı / production / eksik ortam; seçim bağlantıya yazılır', async () => {
    ciz();
    expect(await screen.findByText('Production ortamları (1) şimdilik kapalı.')).toBeTruthy();
    fireEvent.click(screen.getByText('Metaco').closest('button') as HTMLElement);
    expect(screen.getByText('DAS_TEST · DAS_PROD')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /uygulama seçimine dön/ }));
    fireEvent.click(screen.getByText('Metaco').closest('button') as HTMLElement);
    fireEvent.click(screen.getByText('Harmonize').closest('button') as HTMLElement);
    const kapali = screen.getByText('HAR_PROD').closest('button') as HTMLButtonElement;
    expect(kapali.disabled).toBe(true);
    expect(kapali.title).toBe('Bu ortam şimdilik kapalı');
    expect(screen.getByText('şimdilik kapalı')).toBeTruthy();
    expect(screen.getByText('yapılandırma eksik')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '‹ geri' }));
    fireEvent.click(screen.getByText('DAS').closest('button') as HTMLElement);
    expect(screen.getByText('production')).toBeTruthy();
    fireEvent.click(screen.getByText('DAS_TEST').closest('button') as HTMLElement);
    expect(screen.getByTestId('konum').textContent).toBe('?t=das_test');
    expect(await screen.findByText('Bu ortamin tarama isi tanimli degil.')).toBeTruthy();
    expect(api.overview).toHaveBeenCalledWith('das_test', false);
  });

  it('tek domainli uygulamada domain adımı atlanır; geri uygulama listesine döner', async () => {
    ciz();
    // Ad hem kartta hem kartin ust bilgisinde gecebilir: ilk eslesmenin dugmesi.
    fireEvent.click((await screen.findAllByText('Wyden'))[0].closest('button') as HTMLElement);
    expect(screen.getByText('WYD_TEST')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '‹ geri' }));
    expect(screen.getByText('Metaco')).toBeTruthy();
  });

  it('tek uygulama: uygulama adımı atlanır, domainler doğrudan görünür', async () => {
    api.tenants.mockResolvedValueOnce({ ok: true, apps: [UYGULAMALAR[0]] });
    ciz();
    expect(await screen.findByText('Harmonize')).toBeTruthy();
    expect(screen.queryByText('Wyden')).toBeNull();
  });

  it('kiracı listesi alınamadı; katalogda olmayan bağlantı', async () => {
    api.tenants.mockResolvedValueOnce({ ok: false, message: 'katalog yok' });
    const a = ciz();
    expect(await screen.findByText('katalog yok')).toBeTruthy();
    a.unmount();
    api.tenants.mockRejectedValueOnce(new Error('ag'));
    const b = ciz();
    expect(await screen.findByText('ag')).toBeTruthy();
    b.unmount();
    ciz('/crypto-hub?t=yok_boyle');
    expect(await screen.findByText(/Bağlantıdaki ortam \(yok_boyle\) katalogda yok/)).toBeTruthy();
  });
});

describe('kapsamlı görünüm', () => {
  it('yükleme hatası, tablo yok uyarısı ve notlar; Ortamı değiştir', async () => {
    api.overview.mockResolvedValueOnce({ ok: false, message: 'overview okunamadi' });
    const a = ciz('/crypto-hub?t=das_prod&s=node');
    expect(await screen.findByText('overview okunamadi')).toBeTruthy();
    expect(screen.getByText('NODE PANELI')).toBeTruthy();
    a.unmount();
    api.overview.mockResolvedValueOnce({
      ok: true,
      tableMissing: true,
      scannedAt: '2026-11-25T10:00:00Z',
      notes: [
        { level: 'ERR', stage: 'helm', message: 'release okunamadi' },
        { level: 'INFO', message: 'eski arsiv' },
      ],
    });
    ciz('/crypto-hub?t=das_prod&s=node');
    expect(await screen.findByText(/crypto_hub_schema\.sql/)).toBeTruthy();
    expect(screen.getByText('helm')).toBeTruthy();
    expect(screen.getByText('INFO')).toBeTruthy();
    expect(screen.getByText(/son tarama:/)).toBeTruthy();
    expect(screen.getByText('ocp-das_prod / das_prod-ns')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Ortamı değiştir/ }));
    expect(screen.getByTestId('konum').textContent).toBe('');
    expect(await screen.findByText('Metaco')).toBeTruthy();
  });

  it('yükleme istisnası', async () => {
    api.overview.mockRejectedValueOnce(new Error('zaman asimi'));
    ciz('/crypto-hub?t=das_prod&s=node');
    expect(await screen.findByText('zaman asimi')).toBeTruthy();
  });

  it('yeniden tarama: iş takibi, bitince tazeleme; ret; istisna', async () => {
    api.overview.mockResolvedValue({ ok: true, notes: [] });
    ciz('/crypto-hub?t=das_prod&s=node');
    const tazele = await screen.findByRole('button', { name: /tazele/ });
    api.rescan.mockResolvedValueOnce({ ok: true, jobId: 77, awxServerId: 2 });
    fireEvent.click(tazele);
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith(
        'Tarama başladı (iş #77). Bitince ekran yenilenir.',
      ),
    );
    expect(api.rescan).toHaveBeenCalledWith('das_prod');
    const { title, fetchStatus } = is.addJob.mock.calls[0][0];
    expect(title).toBe('Crypto Hub: tara das_prod');
    api.jobStatus.mockResolvedValueOnce({ ok: true, status: 'running', output: '' });
    expect(await fetchStatus()).toEqual({ status: 'running', output: '' });
    expect(api.overview).toHaveBeenCalledTimes(1);
    api.jobStatus.mockResolvedValue({ ok: true, status: 'successful' });
    expect(await fetchStatus()).toEqual({ status: 'successful', output: '' });
    await waitFor(() => expect(api.overview).toHaveBeenLastCalledWith('das_prod', true));
    // Bittikten sonra ikinci yoklama yeniden tazelemez.
    await fetchStatus();
    expect(api.overview).toHaveBeenCalledTimes(2);
    api.jobStatus.mockResolvedValueOnce({ ok: false, message: 'durum yok' });
    await expect(fetchStatus()).rejects.toThrow('durum yok');

    api.rescan.mockResolvedValueOnce({ ok: true, jobId: null });
    fireEvent.click(screen.getByRole('button', { name: /tazele/ }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledTimes(2));
    expect(is.addJob).toHaveBeenCalledTimes(1);
    api.rescan.mockResolvedValueOnce({ ok: false, message: 'tarama isi yok' });
    fireEvent.click(screen.getByRole('button', { name: /tazele/ }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('tarama isi yok'));
    api.rescan.mockRejectedValueOnce(new Error('awx kapali'));
    fireEvent.click(screen.getByRole('button', { name: /tazele/ }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('awx kapali'));
  });
});
