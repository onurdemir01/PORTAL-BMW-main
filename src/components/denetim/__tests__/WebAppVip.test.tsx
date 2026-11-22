// Denetim > Web-App: DNS -> LB VIP kolonu (2026-10-13). Her web sunucusu KENDI sitesinin DNS
// cevabiyla gosterilir (Ankara VIP'i Pendik'ten farkli); ayni VIP'e dusenler havuz uyesi sayilir.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, within } from '@testing-library/react';
import { render } from '@/test/test-utils';
import WebApp from '@/components/denetim/WebApp';
import type { WebAppResult } from '@/api/denetimApi';

const mockWebApp = vi.hoisted(() => vi.fn());
const mockDns = vi.hoisted(() => vi.fn());
vi.mock('@/api/denetimApi', () => ({ denetimApi: { webApp: mockWebApp, webAppDns: mockDns } }));

const vh = (host: string, ip: string, site: string) => ({
  host,
  ip,
  port: '443',
  serverName: 'crm.odmz.invalid',
  confFile: '/c',
  product: 'IHS',
  site,
});
const DATA: WebAppResult = {
  ok: true,
  source: 'mw',
  label: 'JBoss',
  sources: [{ key: 'mw', label: 'JBoss' }],
  certMissing: false,
  total: 1,
  shown: 1,
  capped: false,
  matchedTotal: 1,
  matchSummary: [{ how: 'harf-dönüşümü + server_name (tam ad)', count: 1 }],
  tierSummary: [{ tier: '3-tier', count: 1 }],
  rows: [
    {
      app: 'crm',
      appHost: 'ORCRAP01',
      env: 'PROD',
      domain: 'odmz.invalid',
      dnsBolge: 'dmz',
      tier: '3-tier',
      how: 'harf-dönüşümü + server_name (tam ad)',
      matched: true,
      web: [
        vh('ORCRWP01', '10.0.0.1', 'Pendik'),
        vh('ORCRWP02', '10.0.0.2', 'Pendik'),
        vh('ORCRWAP01', '20.0.0.1', 'Ankara'),
      ],
      webHostCandidate: 'ORCRWP01',
      vhostCountOnHost: 3,
    },
  ],
};

describe('Web-App DNS -> LB VIP', () => {
  beforeEach(() => {
    mockWebApp.mockReset();
    mockDns.mockReset();
  });

  it('dmz bolgesinde her uye kendi sitesinin VIPini ve havuz uye sayisini gosterir', async () => {
    mockWebApp.mockResolvedValue(DATA);
    mockDns.mockResolvedValue({
      ok: true,
      sonuc: {
        'dmz|crm.odmz.invalid': {
          Pendik: { ips: ['10.9.9.9'], dnsSunucusu: '192.0.2.22' },
          Ankara: { ips: ['20.9.9.9'], dnsSunucusu: '198.51.100.22' },
        },
      },
    });
    render(<WebApp />);
    expect(await screen.findAllByText('10.9.9.9')).toHaveLength(2);
    expect(screen.getAllByText('20.9.9.9')).toHaveLength(1);
    expect(screen.getAllByText('VIP · 2 üye')).toHaveLength(2);
    expect(screen.getByText('VIP · 1 üye')).toBeInTheDocument();
    expect(mockDns).toHaveBeenCalledWith([{ ad: 'crm.odmz.invalid', bolge: 'dmz' }]);
  });

  it('bolgesi bilinmeyen domain: Portal cozucusu + Ankara uyarisi; DNS sunucunun kendi IPsine cozuluyorsa LB yok', async () => {
    mockWebApp.mockResolvedValue({
      ...DATA,
      rows: DATA.rows.map((r) => ({ ...r, domain: 'ornekbanka.invalid', dnsBolge: null })),
    });
    mockDns.mockResolvedValue({
      ok: true,
      sonuc: { '-|crm.odmz.invalid': { varsayilan: { ips: ['10.0.0.1'] } } },
    });
    render(<WebApp />);
    expect(await screen.findByText(/Ankara VIP'i farklı olabilir/)).toBeInTheDocument();
    expect(screen.getAllByText("sunucu IP'si · LB yok")).toHaveLength(1);
    void within;
  });
});
