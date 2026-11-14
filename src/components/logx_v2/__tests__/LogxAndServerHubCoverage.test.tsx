// @vitest-environment jsdom
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/api/serverHubApi', () => ({
  serverHubApi: {
    kurallar: vi.fn(),
  },
}));

vi.mock('@/api/logxV2Api', () => ({
  logxV2Api: {
    admin: {
      listClusterIndex: vi.fn(),
      createClusterIndex: vi.fn(),
      updateClusterIndex: vi.fn(),
      deleteClusterIndex: vi.fn(),
      listTerminalHostMap: vi.fn(),
      createTerminalHost: vi.fn(),
      updateTerminalHost: vi.fn(),
      deleteTerminalHost: vi.fn(),
      listVaultKeys: vi.fn(),
      createVaultKey: vi.fn(),
      updateVaultKey: vi.fn(),
      deleteVaultKey: vi.fn(),
      getBootstrapSeed: vi.fn(),
      rerunBootstrapSeed: vi.fn(),
      testClusterConnection: vi.fn(),
      clusterPodStatus: vi.fn(),
      getOcpRuntimeConfig: vi.fn(),
      saveOcpRuntimeConfig: vi.fn(),
    },
  },
}));

vi.mock('@/api/nginxConsoleApi', () => ({
  nginxConsoleApi: {
    rateLimit: vi.fn(),
  },
}));

vi.mock('@/hooks/useToast', () => {
  const toast = {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  };
  return {
    toast,
    useToast: () => ({ toasts: [], toast, dismiss: vi.fn() }),
  };
});

import KodRehberi from '@/components/server_hub/KodRehberi';
import LogXv2AdminTab from '@/components/admin/tabs/LogXv2AdminTab';
import RateLimitTab from '@/components/nginx_console/RateLimitTab';
import { serverHubApi } from '@/api/serverHubApi';
import { logxV2Api } from '@/api/logxV2Api';
import { nginxConsoleApi } from '@/api/nginxConsoleApi';
import { toast } from '@/hooks/useToast';

describe('KodRehberi, LogXv2AdminTab, and RateLimitTab Coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders KodRehberi, toggles list filter, searches, selects code, and closes on Escape', async () => {
    vi.mocked(serverHubApi.kurallar).mockResolvedValue({
      ok: true,
      maddeler: [
        {
          id: 'm1',
          alan: 'jvm',
          alanAd: 'JVM Sagligi',
          ad: 'Heap kontrol',
          ciktilar: [
            { kod: 'JVM_HEAP_HIGH', kosul: 'Heap > %85', gecerli: 'danger', varsayilan: 'warning' },
            { kod: 'JVM_IDLE', kosul: 'Heap bosta', gecerli: 'info', varsayilan: 'info' },
          ],
        },
      ],
      etiketKurallari: [
        { kural: 'R1', ad: 'Zero traffic', gecerli: 'KESIN' },
        { kural: 'R2', ad: 'Old build', gecerli: 'SUPHELI' },
        { kural: 'R3', ad: 'Disabled rule', gecerli: 'KAPALI' },
      ],
    } as never);

    const onKapat = vi.fn();
    const onSec = vi.fn();
    const listede = new Map([['JVM_HEAP_HIGH', 3]]);

    const labelFn = (k: string) =>
      k === 'JVM_HEAP_HIGH' ? 'Yuksek Heap Kullanimi' : 'Bosta JVM Kodu';

    const { rerender } = render(
      <KodRehberi
        acik={false}
        onKapat={onKapat}
        ad={labelFn}
        listede={listede}
        seciliKod="all"
        onSec={onSec}
      />,
    );
    expect(screen.queryByRole('dialog')).toBeNull();

    rerender(
      <KodRehberi
        acik
        onKapat={onKapat}
        ad={labelFn}
        listede={listede}
        seciliKod="all"
        onSec={onSec}
      />,
    );

    await waitFor(() => expect(screen.getByText('Yuksek Heap Kullanimi')).toBeTruthy());
    expect(screen.queryByText('Bosta JVM Kodu')).toBeNull();

    // Switch to all codes
    fireEvent.click(screen.getByRole('radio', { name: 'Tüm kodlar' }));
    expect(screen.getByText('Bosta JVM Kodu')).toBeTruthy();

    // Search
    fireEvent.change(screen.getByLabelText('Kod rehberinde ara'), { target: { value: 'heap' } });
    expect(screen.getByText('Yuksek Heap Kullanimi')).toBeTruthy();

    // Select code
    fireEvent.click(screen.getByText('Yuksek Heap Kullanimi'));
    expect(onSec).toHaveBeenCalledWith('JVM_HEAP_HIGH');

    // Escape closes
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onKapat).toHaveBeenCalled();
  });

  it('shows KodRehberi error message when API rejects', async () => {
    vi.mocked(serverHubApi.kurallar).mockRejectedValue(new Error('kurallar erisilemedi'));
    render(
      <KodRehberi
        acik
        onKapat={vi.fn()}
        ad={(k) => k}
        listede={new Map()}
        seciliKod="all"
        onSec={vi.fn()}
      />,
    );
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain('kurallar erisilemedi'),
    );
  });

  it('renders LogXv2AdminTab across subTabs, reruns seed, tests cluster connection & pod status, and saves OCP runtime', async () => {
    vi.mocked(logxV2Api.admin.listClusterIndex).mockResolvedValue({
      ok: true,
      rows: [
        {
          id: 1,
          env: 'dev',
          tenant: 'app',
          cluster_name: 'cluster-dev-01',
          terminal_host: '',
          api_url: 'https://api.cluster-dev-01.example.internal:6443',
          vault_credential_key: 'missing_key',
          ocp_username: '',
          is_active: true,
        },
      ],
    } as never);
    vi.mocked(logxV2Api.admin.listTerminalHostMap).mockResolvedValue({
      ok: true,
      rows: [
        {
          id: 10,
          tenant: 'app',
          env: 'dev',
          terminal_host: 'bastion-dev-01.example.internal',
          is_active: true,
        },
      ],
    } as never);
    vi.mocked(logxV2Api.admin.listVaultKeys).mockResolvedValue({
      ok: true,
      rows: [
        {
          id: 20,
          key_name: 'known_vault_key',
          default_username: 'svc_ocp',
          description: 'Dev key',
          is_active: true,
        },
      ],
    } as never);
    vi.mocked(logxV2Api.admin.getBootstrapSeed).mockResolvedValue({
      ok: true,
      seeded: false,
    } as never);
    vi.mocked(logxV2Api.admin.rerunBootstrapSeed).mockResolvedValue({
      ok: true,
      result: { inserted: 2, skipped: 10, failed: 0 },
    } as never);
    vi.mocked(logxV2Api.admin.testClusterConnection).mockResolvedValue({
      ok: true,
      responseTimeMs: 42,
      message: 'API ok',
    } as never);
    vi.mocked(logxV2Api.admin.clusterPodStatus).mockResolvedValue({
      ok: true,
      output: 'pod-1 Running',
    } as never);
    vi.mocked(logxV2Api.admin.getOcpRuntimeConfig).mockResolvedValue({
      ok: true,
      config: {
        ocBinary: '',
        ocBinaryCandidates: ['/usr/bin/oc', '/usr/local/bin/oc'],
        defaultOcpUsername: 'svc_ocp',
        ocAsyncTimeout: 45,
        ocListTimeout: 30,
        ocLogTimeout: 90,
      },
      defaults: {
        ocBinary: '',
        ocBinaryCandidates: ['/usr/bin/oc'],
        defaultOcpUsername: 'svc_ocp',
        ocAsyncTimeout: 30,
        ocListTimeout: 30,
        ocLogTimeout: 60,
      },
    } as never);
    vi.mocked(logxV2Api.admin.saveOcpRuntimeConfig).mockResolvedValue({
      ok: true,
      config: {
        ocBinary: '/opt/oc/oc',
        ocBinaryCandidates: ['/usr/bin/oc', '/usr/local/bin/oc'],
        defaultOcpUsername: 'svc_ocp',
        ocAsyncTimeout: 45,
        ocListTimeout: 30,
        ocLogTimeout: 90,
      },
    } as never);

    render(<LogXv2AdminTab />);

    await waitFor(() =>
      expect(screen.getByText(/katalogda olmayan vault anahtarı var/i)).toBeTruthy(),
    );

    // Rerun bootstrap seed
    fireEvent.click(screen.getByRole('button', { name: 'Yeniden çalıştır' }));
    await waitFor(() => expect(screen.getByText(/2 yeni cluster eklendi/i)).toBeTruthy());

    // Connection test & Pod status actions
    fireEvent.click(screen.getByLabelText('cluster-dev-01 bağlantısını test et'));
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith(
        expect.stringContaining('cluster-dev-01: erişilebilir'),
      ),
    );

    fireEvent.click(screen.getByLabelText('cluster-dev-01 pod durumunu getir'));
    await waitFor(() => expect(screen.getByText('pod-1 Running')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Kapat' }));

    // Switch subtabs
    fireEvent.click(screen.getByRole('button', { name: 'Vault Anahtarları' }));
    expect(screen.getAllByText(/credentials\.yaml/).length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole('button', { name: 'Terminal/Bastion Host' }));
    expect(screen.getByText(/bastion-dev-01\.example\.internal/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'OCP Çalıştırma Ayarları' }));
    await waitFor(() =>
      expect(screen.getByPlaceholderText('boş = otomatik ara (önerilen)')).toBeTruthy(),
    );
    fireEvent.change(screen.getByPlaceholderText('boş = otomatik ara (önerilen)'), {
      target: { value: '/opt/oc/oc' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Kaydet' }));
    await waitFor(() => expect(logxV2Api.admin.saveOcpRuntimeConfig).toHaveBeenCalled());
  });

  it('renders RateLimitTab filters, sorting, expandable details, and error fallback', async () => {
    vi.mocked(nginxConsoleApi.rateLimit).mockResolvedValue({
      ok: true,
      scanDate: '2026-11-14',
      availableDates: ['2026-11-14', '2026-11-13'],
      directivesMissing: true,
      kapaliMessage: 'Bazi sunucularda rate limit bilerek kapali.',
      tableMissing: false,
      message: 'Ornek uyari',
      catalog: {
        file: '/usr/nginx/conf/rate_limits.conf',
        zones: [
          {
            key: 'per_ip',
            label: 'IP Limit',
            rate: '500r/s',
            burst: 100,
            nodelay: true,
            variable: '$binary_remote_addr',
            size: '10m',
          },
          {
            key: 'per_conn',
            label: 'Conn Limit',
            conn: 50,
            variable: '$binary_remote_addr',
            size: '10m',
          },
        ],
      },
      summary: {
        hosts: 3,
        standart: 1,
        farkli: 0,
        eksik: 1,
        kapali: 1,
        bilinmiyor: 0,
        kurulumyok: 0,
        calismiyor: 0,
        configbozuk: 0,
        dosyaYuklenmemis: 1,
        byEnv: { prod: 2, dev: 1 },
        rates: [{ combo: '500r/s / 50', hosts: 2 }],
      },
      hosts: [
        {
          host: 'host-a.example.internal',
          env: 'prod',
          requestRate: '500r/s',
          serverRate: '1000r/s',
          connLimit: 50,
          durum: 'standart',
          calisiyor: true,
          fileLoaded: true,
          eksikler: [],
          farklar: [],
          detay: [
            {
              context: 'http',
              directive: 'limit_req_zone',
              value: '$binary_remote_addr zone=per_ip:10m rate=500r/s;',
            },
          ],
        },
        {
          host: 'host-b.example.internal',
          env: 'dev',
          requestRate: null,
          serverRate: null,
          connLimit: null,
          durum: 'eksik',
          calisiyor: false,
          hostDurumMsg: 'nginx inactive',
          fileLoaded: false,
          eksikler: ['per_ip zone tanimsiz'],
          farklar: [],
          detay: [],
        },
        {
          host: 'host-c.example.internal',
          env: 'prod',
          requestRate: '600r/m',
          serverRate: null,
          connLimit: 20,
          durum: 'kapali',
          calisiyor: true,
          fileLoaded: true,
          eksikler: [],
          farklar: ['rate farkli'],
          detay: [],
        },
      ],
    } as never);

    render(<RateLimitTab />);
    await waitFor(() => expect(screen.getByText('host-a.example.internal')).toBeTruthy());

    // Expand closed/eksik host row
    fireEvent.click(screen.getByText('host-c.example.internal'));
    expect(screen.getByText(/bilerek kapatılmış/i)).toBeTruthy();

    // Sort modes
    const siraSelect = screen.getByLabelText('Sıralama');
    fireEvent.change(siraSelect, { target: { value: 'sunucu' } });
    fireEvent.change(siraSelect, { target: { value: 'ortam' } });
    fireEvent.change(siraSelect, { target: { value: 'ipLimit' } });
    fireEvent.change(siraSelect, { target: { value: 'baglanti' } });

    // Filter by durum & search
    fireEvent.change(screen.getByLabelText('Durum'), { target: { value: 'eksik' } });
    expect(screen.queryByText('host-a.example.internal')).toBeNull();
    expect(screen.getByText('host-b.example.internal')).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Sunucu ya da oran ara'), {
      target: { value: 'host-b' },
    });
    expect(screen.getByText('host-b.example.internal')).toBeTruthy();
  });
});
