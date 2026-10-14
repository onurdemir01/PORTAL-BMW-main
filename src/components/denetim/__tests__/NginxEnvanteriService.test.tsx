// src/components/denetim/__tests__/NginxEnvanteriService.test.tsx
//
// Nginx Hub > Envanter > Service'ler (2026-10-14, kullanici: "servislere geldigimde ... uzerine
// tikladigimda ilgili servisin hangi sunucuda ve hangi versiyonda oldugunu gormek istiyorum").
// Kilitlenen davranis:
//   - satira tiklayinca o service'in sunuculari + her birinin nginx surumu acilir, tekrar tiklayinca kapanir
//   - farkli nginx surumleri ozetlenir ve "N farkli nginx surumu" diye soylenir
//   - service listesi toplanmayan (too_many) sunucular ayrica not edilir (olculemedi != yok)
//   - son guncelleme tarihi hafif vurgulu rozetle gosterilir
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, within } from '@testing-library/react';
import { render } from '@/test/test-utils';
import { NginxEnvanteri } from '@/components/denetim/NginxEnvanteri';
import type { NginxInventoryResult, NginxInvHost } from '@/api/denetimApi';

const mockInv = vi.hoisted(() => vi.fn());
vi.mock('@/api/denetimApi', () => ({
  denetimApi: { nginxInventory: mockInv },
}));

const host = (o: Partial<NginxInvHost>): NginxInvHost => ({
  hostname: 'H',
  fqdn: null,
  env: 'production',
  location: 'pendik',
  service: null,
  services: 'glomo',
  service_count: 1,
  domain: null,
  ip: '10.0.0.1',
  subnet: null,
  os: 'RHEL 8',
  kernel: null,
  architecture: null,
  cpu: 4,
  memory: '16G',
  nginx_version: '1.24.0',
  nginx_user: 'www',
  nginx_prefix: null,
  config_count: 3,
  disk_usr_nginx: null,
  disk_web_log: null,
  source_last_update: null,
  metadata_version: 1,
  ...o,
});

const dist: never[] = [];
const size = { totalGiB: 0, parsed: 0, unparsed: 0 };
const VERI: NginxInventoryResult = {
  ok: true,
  lastUpdate: '2026-10-14T06:30:00',
  totals: {
    hosts: 3,
    envs: 1,
    services: 2,
    servicesUnlisted: ['GBNGXP09'],
    nginxVersions: 2,
    osVersions: 1,
    cpuTotal: 12,
    memory: size,
    diskNginx: size,
    diskWebLog: size,
  },
  byEnv: [],
  byService: [
    { service: 'glomo', hosts: 2, envs: ['production'], hostnames: ['GBNGXP01', 'GBNGXP02'] },
    { service: 'cso', hosts: 1, envs: ['production'], hostnames: ['GBNGXP01'] },
  ],
  versions: { nginx: dist, os: dist, kernel: dist, architecture: dist, metadata: dist },
  resources: { cpu: dist, memory: dist, diskNginx: dist, diskWebLog: dist, configCount: dist, serviceCount: dist },
  other: { domain: dist, subnet: dist, nginxUser: dist },
  hosts: [
    host({ hostname: 'GBNGXP01', services: 'glomo,cso', nginx_version: '1.24.0', ip: '10.1.1.1' }),
    host({ hostname: 'GBNGXP02', services: 'glomo', nginx_version: '1.20.1', ip: '10.1.1.2' }),
    host({ hostname: 'GBNGXP09', services: 'too_many', nginx_version: '1.24.0' }),
  ],
};

describe('NginxEnvanteri — service ayrintisi', () => {
  beforeEach(() => {
    mockInv.mockReset();
    mockInv.mockResolvedValue(VERI);
  });

  it('service satirina tiklayinca sunucular ve nginx surumleri acilir, tekrar tiklayinca kapanir', async () => {
    render(<NginxEnvanteri />);
    fireEvent.click(await screen.findByText("Service'ler"));
    const ac = screen.getByRole('button', { name: 'glomo sunucularını göster' });
    expect(ac.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(ac);

    expect(screen.getByText('GBNGXP01')).toBeTruthy();
    expect(screen.getByText('GBNGXP02')).toBeTruthy();
    expect(screen.getByText('10.1.1.2')).toBeTruthy();
    expect(screen.getByText('1.24.0 · 1 sunucu')).toBeTruthy();
    expect(screen.getByText('1.20.1 · 1 sunucu')).toBeTruthy();
    expect(screen.getByText(/2 farklı nginx sürümü var/)).toBeTruthy();
    expect(screen.getByText(/service listesi toplanmadı/)).toBeTruthy();
    expect(screen.getByText('GBNGXP09')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'glomo sunucularını gizle' }));
    expect(screen.queryByText('10.1.1.2')).toBeNull();
  });

  it('tek surumlu service icin "farkli surum" uyarisi yok', async () => {
    render(<NginxEnvanteri />);
    fireEvent.click(await screen.findByText("Service'ler"));
    // satirin herhangi bir yerine tiklamak da acar (yalniz ok dugmesi degil)
    fireEvent.click(screen.getByRole('button', { name: 'cso sunucularını göster' }).closest('tr')!);
    const tablo = screen.getByText('Sunucudaki service’ler'.replace('’', "'")).closest('table')!;
    expect(within(tablo).getByText('GBNGXP01')).toBeTruthy();
    expect(within(tablo).queryByText('GBNGXP02')).toBeNull();
    expect(screen.queryByText(/farklı nginx sürümü var/)).toBeNull();
  });

  it('son guncelleme tarihi rozetle gosterilir', async () => {
    render(<NginxEnvanteri />);
    expect(await screen.findByText('2026-10-14 06:30:00')).toBeTruthy();
    expect(screen.getByText('2026-10-14 06:30:00').parentElement?.textContent).toMatch(/son güncelleme/);
  });
});
