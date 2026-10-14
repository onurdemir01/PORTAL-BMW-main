// src/components/nginx_console/__tests__/SaltOkunurErisim.test.tsx
//
// Nginx Hub salt okunur erisim (kullanici karari, 2026-10-14): Admin > "Nginx Hub Erisimi"nden
// sekme acilan Admin olmayan kullanici okur; dokum yenileme (AWX isi) dugmeleri ona GOSTERILMEZ
// (sunucu zaten 403 doner - dugme gorunup hata vermesin).
import { describe, it, expect, vi } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { render } from '@/test/test-utils';
import { InstancesTab } from '@/components/nginx_console/NimTabs';
import type { NcHost } from '@/api/nginxConsoleApi';

const HOST = {
  host: 'GBNGXP40',
  env: 'PROD',
  location: 'Pendik',
  site: null,
  cpu: null,
  memoryGb: null,
  os: null,
  service: 'GLOMO',
  services: ['GLOMO'],
  nginxVersion: '1.24.0',
  prefix: '/usr/nginx',
  configCount: 3,
  dumpedAt: '2026-10-14T06:00:00Z',
  seenAt: '2026-10-14T06:00:00Z',
  nginxT: 'ok',
  fileCount: 10,
  certCount: 1,
  certMinDays: 90,
  dumpTooLarge: null,
} as unknown as NcHost;

describe('Nginx Hub salt okunur erisim', () => {
  it('Instances: onRefreshHosts verilmezse "Seçilileri yenile" ve "Dokumu yenile" yok', () => {
    render(<InstancesTab hosts={[HOST]} loading={false} onOpen={vi.fn()} onReload={vi.fn()} />);
    expect(screen.queryByText(/Seçilileri yenile/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'GBNGXP40 eylemler' }));
    expect(screen.getByText('Konfigürasyonu aç')).toBeTruthy();
    expect(screen.queryByText('Dokumu yenile')).toBeNull();
  });

  it('Instances: Admin icin (onRefreshHosts verilince) dugmeler durur', () => {
    render(<InstancesTab hosts={[HOST]} loading={false} onRefreshHosts={vi.fn()} onOpen={vi.fn()} onReload={vi.fn()} />);
    expect(screen.getByText(/Seçilileri yenile/)).toBeTruthy();
  });

  it('sayfa: Instances yenilemesi ve Config dokum araclari yalniz Admin', () => {
    const s = readFileSync(join(__dirname, '..', 'NginxConsolePage.tsx'), 'utf8');
    expect(s).toContain('onRefreshHosts={isAdmin ? refreshHosts : undefined}');
    expect(s).toMatch(/\{isAdmin && <div className="flex items-center gap-1\.5 flex-wrap">\s*<button disabled=\{busy \|\| checked\.size === 0\} onClick=\{\(\) => refresh\(/);
  });
});
