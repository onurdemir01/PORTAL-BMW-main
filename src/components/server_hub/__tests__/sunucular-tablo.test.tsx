// src/components/server_hub/__tests__/sunucular-tablo.test.tsx — Sunucular listesi EarTablo (2026-11-07).
//
//   ST1 "Listedekileri tara" EKRANDA süzülen kümeyi tarar (üst seçici + sütun süzgeci); sayaç aynı kümeyi sayar
//   ST2 satır düğmesi sunucu panelini açar (etiket verisi yalnız o zaman iner); "Ayrıntı" pencereyi açar,
//       "Şimdi tara" tek sunucuyu tarar — ikisi de satırı açmaz
//   ST3 ortak görünüm: liste sunucudan, "Ortak kaydet" bu ekranın adıyla gider, yanıt listeyi günceller
//   ST4 hazır görünüm "Bayat tarama": taze olmayan sunucular ve kendi kolonları
//   ST5 tanımsız --accent-fg Server Hub'da yok (koyu temada birincil düğme 1.45:1 idi)
//   ST6 Ayrıntı penceresi "Özet" sekmesiyle açılır: sunucu paneli okunmuş ayrıntıyla (ikinci istek yok),
//       "Yeniden tara" pencerenin taramasını kullanır, etiket verisi Özet açıkken iner
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor, within } from '@testing-library/react';
import { render } from '@/test/test-utils';

const m = vi.hoisted(() => ({
  overview: vi.fn(),
  findings: vi.fn(),
  limitler: vi.fn(),
  hostAdlari: vi.fn(),
  jobStatus: vi.fn(),
  scan: vi.fn(),
  host: vi.fn(),
  retireEtiketleri: vi.fn(),
  gorunumler: vi.fn(),
  gorunumKaydet: vi.fn(),
  gorunumSil: vi.fn(),
}));
vi.mock('@/contexts/JobTrackerContext', () => ({ useJobTracker: () => ({ addJob: vi.fn() }) }));
vi.mock('@/hooks/useToast', () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));
vi.mock('@/api/serverHubApi', async (orig) => ({
  ...(await orig<typeof import('@/api/serverHubApi')>()),
  serverHubApi: m,
}));
vi.mock('@/components/server_hub/SunucuPaneli', () => ({
  default: ({
    host,
    detay,
    onTara,
  }: {
    host: string;
    detay?: unknown;
    onTara?: (h: string) => void;
  }) => (
    <div data-testid="panel-taklit">
      panel {host} {detay ? 'detaylı' : 'kendi okur'}
      {onTara && (
        <button type="button" onClick={() => onTara(host)}>
          panel tara
        </button>
      )}
    </div>
  ),
}));

import fs from 'node:fs';
import path from 'node:path';
import ServerHubPage from '@/components/server_hub/ServerHubPage';
import * as shOnbellek from '@/components/server_hub/shOnbellek';

const H = (host: string, o: Record<string, unknown> = {}) => ({
  host,
  env: host.includes('T') ? 'TEST' : 'PROD',
  envGroup: host.includes('T') ? 'Non-Production' : 'Production',
  hostClass: 'genel',
  status: 'warning',
  counts: { danger: 0, warning: 1, info: 0 },
  products: ['JBOSS7'],
  jvms: 2,
  jvmsRunning: 2,
  vhosts: 1,
  unusedIps: 0,
  topFinding: 'bir uyarı',
  scanDate: '2026-11-07',
  cpuS: 0.4,
  fresh: true,
  ...o,
});
const HOSTS = [
  H('GBCJAP01', { status: 'danger', counts: { danger: 2, warning: 0, info: 0 } }),
  H('GBCJAP02'),
  H('GBCJAT01'),
  H('GBCJAP03', { fresh: false, scanDate: '2026-11-01' }),
];

beforeEach(() => {
  window.localStorage.clear();
  Object.values(m).forEach((f) => f.mockReset());
  shOnbellek._sifirlaForTest();
  m.overview.mockResolvedValue({
    ok: true,
    tableMissing: false,
    latestScan: '2026-11-07',
    summary: null,
    hosts: HOSTS,
  });
  m.limitler.mockResolvedValue({ ok: true, limitler: [] });
  m.findings.mockResolvedValue({ ok: true, findings: [] });
  m.scan.mockResolvedValue({ ok: true, jobId: 9 });
  m.host.mockResolvedValue({ ok: false, message: 'yok' });
  m.retireEtiketleri.mockResolvedValue({ ok: true, kurallar: [], etiketler: [], ozet: {} });
  m.gorunumler.mockResolvedValue({ ok: true, okunamadi: false, gorunumler: [] });
});

describe('Sunucular listesi (EarTablo)', () => {
  it('ST1 Listedekileri tara ekranda süzülen kümeyi tarar', async () => {
    render(<ServerHubPage />);
    expect(await screen.findByText(/4 \/ 4 sunucu/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Ortam süz' }));
    fireEvent.click(await screen.findByLabelText('Ortam: PROD'));
    fireEvent.click(screen.getByRole('button', { name: 'Uygula' }));
    expect(await screen.findByText(/3 \/ 4 sunucu/)).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText('sunucu ya da bulgu ara'), {
      target: { value: 'GBCJAP0' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Durum süz' }));
    fireEvent.click(await screen.findByLabelText('Durum: kritik'));
    fireEvent.click(screen.getByRole('button', { name: 'Uygula' }));
    expect(await screen.findByText(/1 \/ 4 sunucu/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Listedekileri tara/ }));
    await waitFor(() => expect(m.scan).toHaveBeenCalledWith(['GBCJAP01']));
  });

  it('ST2 panel, Ayrıntı ve Şimdi tara', async () => {
    render(<ServerHubPage />);
    const d = await screen.findByRole('button', { name: 'GBCJAP02 ayrıntısı' });
    expect(m.retireEtiketleri).not.toHaveBeenCalled();
    fireEvent.click(d);
    const panel = await screen.findByTestId('panel-taklit');
    expect(panel).toHaveTextContent('panel GBCJAP02 kendi okur');
    // Satır içi panelin "Yeniden tara"sı satırdaki tarama isteğini kullanır.
    fireEvent.click(within(panel).getByRole('button', { name: 'panel tara' }));
    await waitFor(() => expect(m.scan).toHaveBeenCalledWith(['GBCJAP02']));
    await waitFor(() => expect(m.retireEtiketleri).toHaveBeenCalledTimes(1));
    fireEvent.click(d);
    expect(screen.queryByTestId('panel-taklit')).toBeNull();
    const satir = screen.getByRole('button', { name: 'GBCJAT01 ayrıntısı' }).closest('tr')!;
    const ac = () => screen.getByRole('button', { name: 'GBCJAT01 ayrıntısı' });
    // Her düğme ayrı ölçülür: ikisi art arda satırı açıp kapatsa sonuç yine "kapalı" görünürdü.
    fireEvent.click(within(satir).getByRole('button', { name: /Şimdi tara/ }));
    expect(ac()).toHaveAttribute('aria-expanded', 'false');
    await waitFor(() => expect(m.scan).toHaveBeenCalledWith(['GBCJAT01']));
    fireEvent.click(within(satir).getByRole('button', { name: 'Ayrıntı' }));
    expect(ac()).toHaveAttribute('aria-expanded', 'false');
    await waitFor(() => expect(m.host.mock.calls.map((c) => c[0])).toContain('GBCJAT01'));
  });

  it('ST3 ortak görünüm bu ekranın adıyla kaydedilir', async () => {
    m.gorunumler.mockResolvedValue({
      ok: true,
      gorunumler: [
        { ad: 'Ekip TEST', f: [{ k: 'ortam', op: 'in', v: ['TEST'] }], s: '', kaydeden: 'ayse' },
      ],
    });
    m.gorunumKaydet.mockResolvedValue({
      ok: true,
      gorunumler: [
        { ad: 'Ekip TEST', f: [{ k: 'ortam', op: 'in', v: ['TEST'] }], s: '', kaydeden: 'ayse' },
        { ad: 'Yalnız PROD', f: [{ k: 'ortam', op: 'in', v: ['PROD'] }], s: '', kaydeden: 'ayse' },
      ],
    });
    render(<ServerHubPage />);
    await screen.findByText(/4 \/ 4 sunucu/);
    await waitFor(() => expect(m.gorunumler).toHaveBeenCalledWith('server-hub-sunucular'));
    fireEvent.click(screen.getByRole('button', { name: 'Görünümler' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Ekip TEST' }));
    expect(await screen.findByText(/1 \/ 4 sunucu/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Görünüm: Ekip TEST' }));
    fireEvent.click(screen.getByRole('button', { name: 'süzgeçsiz görünüm' }));
    fireEvent.click(screen.getByRole('button', { name: 'Ortam süz' }));
    fireEvent.click(await screen.findByLabelText('Ortam: PROD'));
    fireEvent.click(screen.getByRole('button', { name: 'Uygula' }));
    fireEvent.click(screen.getByRole('button', { name: 'Görünümler' }));
    fireEvent.change(screen.getByLabelText('Görünüm adı'), { target: { value: 'Yalnız PROD' } });
    fireEvent.click(screen.getByRole('button', { name: 'Ortak kaydet' }));
    await waitFor(() =>
      expect(m.gorunumKaydet).toHaveBeenCalledWith(
        'server-hub-sunucular',
        'Yalnız PROD',
        expect.objectContaining({ f: [{ k: 'ortam', op: 'in', v: ['PROD'] }] }),
      ),
    );
    expect(await screen.findByRole('button', { name: 'Görünüm: Yalnız PROD' })).toBeInTheDocument();
  });

  it('ST4 hazır görünüm: bayat tarama', async () => {
    render(<ServerHubPage />);
    await screen.findByText(/4 \/ 4 sunucu/);
    fireEvent.click(screen.getByRole('button', { name: 'Görünümler' }));
    fireEvent.click(screen.getByRole('button', { name: /^Bayat tarama/ }));
    expect(await screen.findByText(/1 \/ 4 sunucu/)).toBeInTheDocument();
    expect(screen.getByText('GBCJAP03')).toBeInTheDocument();
    expect(
      screen.getAllByRole('columnheader').some((h) => (h.textContent || '').startsWith('Taze')),
    ).toBe(true);
  });

  it('ST5 tanımsız --accent-fg Server Hub bileşenlerinde yok', () => {
    const kok = path.resolve(__dirname, '..');
    const kirli = fs
      .readdirSync(kok)
      .filter((f) => /\.tsx?$/.test(f))
      .filter((f) => /var\(--accent-fg/.test(fs.readFileSync(path.join(kok, f), 'utf8')));
    expect(kirli).toEqual([]);
  });

  it('ST6 Ayrıntı penceresi Özet sekmesiyle açılır', async () => {
    m.host.mockResolvedValue({
      ok: true,
      host: {
        host: 'GBCJAT01',
        scanDate: '2026-11-07',
        products: ['JBOSS7'],
        cpuS: null,
        findings: [],
        jvms: [],
        vhosts: [],
        init: [],
        ips: [],
        web: [],
        jboss: [],
      },
    });
    render(<ServerHubPage />);
    const satir = (await screen.findByRole('button', { name: 'GBCJAT01 ayrıntısı' })).closest(
      'tr',
    )!;
    fireEvent.click(within(satir).getByRole('button', { name: 'Ayrıntı' }));
    const panel = await screen.findByTestId('panel-taklit');
    expect(panel).toHaveTextContent('panel GBCJAT01 detaylı');
    expect(screen.getByRole('button', { name: 'Özet' })).toBeInTheDocument();
    await waitFor(() => expect(m.retireEtiketleri).toHaveBeenCalledTimes(1));
    fireEvent.click(within(panel).getByRole('button', { name: 'panel tara' }));
    await waitFor(() => expect(m.scan).toHaveBeenCalledWith(['GBCJAT01']));
    expect(m.host).toHaveBeenCalledTimes(1);
  });
});
