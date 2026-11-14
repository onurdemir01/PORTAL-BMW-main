// @vitest-environment jsdom
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  DashboardTab,
  InstancesTab,
  parseNginxVersion,
  lastSeen,
  isOnline,
  isProdEnv,
  siteOf,
} from '../NimTabs';
import NginxConsolePage from '../NginxConsolePage';
import { nginxConsoleApi, type NcHost } from '@/api/nginxConsoleApi';

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { username: 'admin', role: 'Admin' },
    canSee: () => true,
  }),
}));

vi.mock('@/contexts/JobTrackerContext', () => ({
  useJobTracker: () => ({
    addJob: vi.fn(),
    jobs: [],
  }),
}));

vi.mock('@/api/nginxConsoleApi', async () => {
  const actual =
    await vi.importActual<typeof import('@/api/nginxConsoleApi')>('@/api/nginxConsoleApi');
  return {
    ...actual,
    nginxConsoleApi: {
      ...actual.nginxConsoleApi,
      hosts: vi.fn(),
      certs: vi.fn(),
      changes: vi.fn(),
      tree: vi.fn(),
      file: vi.fn(),
      compare: vi.fn(),
      push: vi.fn(),
      refresh: vi.fn(),
      jobStatus: vi.fn(),
      blob: vi.fn(),
    },
  };
});

const SAMPLE_HOSTS: NcHost[] = [
  {
    host: 'NGX-PROD-01',
    env: 'Production',
    location: 'Pendik',
    service: 'API',
    services: ['API', 'AUTH', 'PAY'],
    nginxVersion: 'nginx/1.25.3 (nginx-plus-r31-p1)',
    prefix: '/etc/nginx',
    configCount: 4,
    ip: '10.0.0.1',
    site: 'Pendik',
    cpu: 4,
    memoryGb: 16,
    os: 'RHEL 8',
    dumpedAt: new Date().toISOString(),
    seenAt: new Date().toISOString(),
    nginxT: 'ok',
    fileCount: 10,
    certCount: 2,
    certMinDays: 45,
  },
  {
    host: 'NGX-TEST-02',
    env: 'Test',
    location: null,
    service: 'WEB',
    services: ['WEB'],
    nginxVersion: 'nginx/1.24.0',
    prefix: '/etc/nginx',
    configCount: 2,
    ip: '10.0.0.2',
    site: null,
    cpu: null,
    memoryGb: null,
    os: null,
    dumpedAt: null,
    seenAt: null,
    nginxT: 'fail',
    fileCount: 0,
    certCount: 0,
    certMinDays: null,
    inventoryMissing: true,
    dumpTooLarge: 25,
  },
];

describe('NimTabs helpers, DashboardTab, InstancesTab, and NginxConsolePage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(nginxConsoleApi.hosts).mockResolvedValue({
      ok: true,
      hosts: SAMPLE_HOSTS,
      consoleDir: '/sw/nginx',
      inventoryError: '',
    });
    vi.mocked(nginxConsoleApi.certs).mockResolvedValue({
      ok: true,
      hostsScanned: 2,
      certs: [
        {
          exists: true,
          subject: 'CN=api.example.test',
          cn: 'api.example.test',
          issuer: 'CN=CorpCA',
          issuerCn: 'CorpCA',
          serial: '1234',
          notBefore: '2025-01-01T00:00:00Z',
          notAfter: '2026-12-01T00:00:00Z',
          fingerprint: 'AA:BB:CC',
          sigalg: 'SHA256withRSA',
          keybits: 2048,
          san: ['api.example.test'],
          chain: 2,
          chainSubjects: ['CN=api.example.test', 'CN=CorpCA'],
          selfSigned: false,
          daysLeft: 15,
          hosts: [
            {
              host: 'NGX-PROD-01',
              path: '/etc/nginx/ssl/api.crt',
              sha256: 'abc123456789',
              uses: [
                {
                  conf: '/etc/nginx/conf.d/api.conf',
                  serverName: 'api.example.test',
                  key: '/etc/nginx/ssl/api.key',
                  keyState: 'present',
                },
              ],
            },
          ],
          hostCount: 1,
          useCount: 1,
          loadedUseCount: 1,
        },
      ],
      summary: {
        total: 1,
        expired: 0,
        within30: 1,
        within90: 0,
        missing: 0,
        selfSigned: 0,
        unused: 0,
        generatedAt: new Date().toISOString(),
      },
    });
    vi.mocked(nginxConsoleApi.changes).mockResolvedValue({
      ok: true,
      changes: [
        {
          id: 1,
          host: 'NGX-PROD-01',
          path: '/usr/nginx/conf.d/api.conf',
          source: 'portal-publish',
          requester: 'admin',
          fileOwner: 'root',
          oldSha256: '1111111111',
          newSha256: '2222222222',
          hasOld: true,
          hasNew: true,
          pending: false,
          fileMtime: null,
          seenAt: new Date().toISOString(),
          dumpTime: new Date().toISOString(),
          size: 2048,
          jobId: 99,
        },
      ],
    });
  });

  it('unit-tests NimTabs helper functions', () => {
    expect(parseNginxVersion('nginx/1.25.3 (nginx-plus-r31-p1)')).toEqual({
      type: 'NGINX Plus',
      version: '1.25.3',
      release: 'r31-p1',
    });
    expect(parseNginxVersion('nginx/1.24.0')).toEqual({
      type: 'Open Source',
      version: '1.24.0',
      release: null,
    });
    expect(parseNginxVersion(null)).toEqual({
      type: 'Bilinmiyor',
      version: null,
      release: null,
    });

    expect(lastSeen(SAMPLE_HOSTS[0])).toBeTruthy();
    expect(isOnline(SAMPLE_HOSTS[0], Date.now())).toBe(true);
    expect(isOnline(SAMPLE_HOSTS[1], Date.now())).toBe(false);
    expect(isProdEnv('Production')).toBe(true);
    expect(isProdEnv('Test')).toBe(false);
    expect(siteOf(SAMPLE_HOSTS[0])).toBe('Pendik');
  });

  it('renders DashboardTab and navigates via onGo callbacks', async () => {
    const onGo = vi.fn();
    render(<DashboardTab hosts={SAMPLE_HOSTS} onGo={onGo} />);

    await waitFor(() => expect(screen.getByText('api.example.test')).toBeTruthy());
    expect(screen.getAllByText('NGINX Plus').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Pendik').length).toBeGreaterThan(0);

    fireEvent.click(screen.getByText('Tüm sertifikalar'));
    expect(onGo).toHaveBeenCalledWith('certs');

    fireEvent.click(screen.getByText('Tüm sunucular'));
    expect(onGo).toHaveBeenCalledWith('instances');
  });

  it('renders InstancesTab, filters by status/search, selects rows, and opens actions menu', () => {
    const onRefreshHosts = vi.fn();
    const onOpen = vi.fn();
    const onReload = vi.fn();

    render(
      <InstancesTab
        hosts={SAMPLE_HOSTS}
        loading={false}
        onRefreshHosts={onRefreshHosts}
        onOpen={onOpen}
        onReload={onReload}
      />,
    );

    expect(screen.getByText('ngx-prod-01')).toBeTruthy();
    expect(screen.getByText('ngx-test-02')).toBeTruthy();

    // Filter buttons
    fireEvent.click(screen.getAllByText(/Offline/i)[0]);
    expect(screen.queryByText('ngx-prod-01')).toBeNull();
    expect(screen.getByText('ngx-test-02')).toBeTruthy();

    fireEvent.click(screen.getByText(/Hepsi/i));
    expect(screen.getByText('ngx-prod-01')).toBeTruthy();

    // Select checkbox and refresh selected
    const checkboxes = screen.getAllByRole('checkbox');
    fireEvent.click(checkboxes[1]);
    fireEvent.click(screen.getByText(/Seçilileri yenile/i));
    expect(onRefreshHosts).toHaveBeenCalledWith(['NGX-PROD-01']);

    // Open row action menu
    fireEvent.click(screen.getByLabelText('NGX-PROD-01 eylemler'));
    fireEvent.click(screen.getByText('Konfigürasyonu aç'));
    expect(onOpen).toHaveBeenCalledWith('NGX-PROD-01');
  });

  it('renders NginxConsolePage and switches across Dashboard, Instances, Config, Changes, and Certs tabs', async () => {
    vi.mocked(nginxConsoleApi.tree).mockResolvedValue({
      ok: true,
      host: 'NGX-PROD-01',
      dumped: true,
      dumpedAt: new Date().toISOString(),
      prefix: '/etc/nginx',
      nginxT: { status: 'ok', output: 'syntax is ok' },
      fileCount: 1,
      tree: {
        name: 'nginx',
        path: '/etc/nginx',
        dirs: [],
        files: [
          {
            name: 'nginx.conf',
            path: '/etc/nginx/nginx.conf',
            size: 512,
            mtime: new Date().toISOString(),
            sha256: 'abcdef123456',
          },
        ],
      },
    });
    vi.mocked(nginxConsoleApi.file).mockResolvedValue({
      ok: true,
      host: 'NGX-PROD-01',
      path: '/etc/nginx/nginx.conf',
      sha256: 'abcdef123456',
      size: 512,
      mtime: new Date().toISOString(),
      content: 'worker_processes auto;\n',
      tooLarge: false,
    });

    render(
      <MemoryRouter initialEntries={['/nginx-hub']}>
        <NginxConsolePage />
      </MemoryRouter>,
    );

    await waitFor(() => expect(screen.getAllByText('Sertifikalar').length).toBeGreaterThan(0));

    // Switch to Degisiklikler tab
    fireEvent.click(screen.getByRole('button', { name: /Değişiklikler/i }));
    await waitFor(() => expect(screen.getByText('conf.d/api.conf')).toBeTruthy());

    // Switch to Sertifikalar tab
    fireEvent.click(screen.getByRole('button', { name: /Sertifikalar/i }));
    await waitFor(() => expect(screen.getByText('api.example.test')).toBeTruthy());
    // Open CertModal by clicking cert row
    fireEvent.click(screen.getByText('api.example.test'));
    await waitFor(() => expect(screen.getByText('Parmak izi (SHA-256)')).toBeTruthy());

    // Switch to Konfigurasyon tab
    fireEvent.click(screen.getByRole('button', { name: /Konfigürasyon/i }));
    await waitFor(() => expect(screen.getByText('API')).toBeTruthy());
    fireEvent.click(screen.getByText('API'));
    fireEvent.click(screen.getByText('NGX-PROD-01'));
    await waitFor(() => expect(screen.getByText('nginx.conf')).toBeTruthy());
    fireEvent.click(screen.getByText('nginx.conf'));
    await waitFor(() => expect(nginxConsoleApi.file).toHaveBeenCalled());
  });
});
