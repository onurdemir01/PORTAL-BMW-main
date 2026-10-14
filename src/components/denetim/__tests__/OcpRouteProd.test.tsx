// src/components/denetim/__tests__/OcpRouteProd.test.tsx
//
// Denetim > OpenShift Route (2026-10-14): YALNIZ production, her prod cluster bir sutun, sutun
// altinda filtre. Kilitlenen davranis:
//   - sutunlar envClusters.prod'dan (beklenmeyen + veri yok etiketiyle)
//   - "veri yok" cluster'i kapsama (n) katilmaz, hucresi "—", filtresi kapali
//   - route / namespace metin filtresi (Turkce I dahil), cluster var/yok filtresi, kapsam filtresi
//   - ozet sayilar filtreden etkilenmez
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, within } from '@testing-library/react';
import { render } from '@/test/test-utils';
import OcpRouteProd from '@/components/denetim/OcpRouteProd';
import type { OcpCoverageResult, OcpCoverageRow } from '@/api/denetimApi';

const mockRoute = vi.hoisted(() => vi.fn());
vi.mock('@/api/denetimApi', () => ({
  denetimApi: { ocpRouteCoverage: mockRoute },
}));

const satir = (route: string, taban: string, clusters: string[]): OcpCoverageRow => ({
  application: route,
  key: `${taban}/${route}`,
  alt: taban,
  envs: { prod: clusters.map((cluster) => ({ cluster, namespace: `${taban}-prod` })) },
  present: ['prod'],
  missing: [],
  missingCount: 0,
});

const VERI: OcpCoverageResult = {
  ok: true,
  platform: 'ark',
  platforms: ['ark'],
  clusters: [],
  envs: ['prod'],
  totalApplications: 3,
  completeCount: 3,
  skippedNoEnv: 0,
  patterns: [],
  envClusters: {
    prod: [
      { cluster: 'gbocpprod1', apps: 3 },
      { cluster: 'gbocpprod2', apps: 1 },
      { cluster: 'gbocpdrcprod1', apps: 0, veriYok: true },
      { cluster: 'gbocpprod3', apps: 1, beklenmeyen: true },
    ],
  },
  envClusterKaynagi: { prod: 'resmi' },
  rows: [
    satir('kart-api', 'kart', ['gbocpprod1', 'gbocpprod2']),
    satir('IBAN-web', 'odeme', ['gbocpprod1']),
    satir('eski-app', 'arsiv', ['gbocpprod1', 'gbocpprod3']),
  ],
};

const satirlar = () => screen.getAllByRole('row').slice(2);

describe('OcpRouteProd', () => {
  beforeEach(() => {
    mockRoute.mockReset();
    mockRoute.mockResolvedValue(VERI);
  });

  it('sutunlar prod cluster’lari; veri yok n’ye katilmaz', async () => {
    render(<OcpRouteProd />);
    await screen.findByText('kart-api');
    for (const c of ['gbocpprod1', 'gbocpprod2', 'gbocpdrcprod1', 'gbocpprod3'])
      expect(screen.getAllByRole('columnheader', { name: new RegExp(c) }).length).toBeGreaterThan(0);
    expect(screen.getAllByText('veri yok').length).toBeGreaterThan(0);
    const kart = satirlar().find((r) => within(r).queryByText('kart-api'))!;
    expect(within(kart).getByText('2/2')).toBeTruthy();
    const iban = satirlar().find((r) => within(r).queryByText('IBAN-web'))!;
    expect(within(iban).getByText('1/2')).toBeTruthy();
    expect((screen.getByLabelText('gbocpdrcprod1 sütununa göre süz') as HTMLSelectElement).disabled).toBe(true);
  });

  it('metin, cluster ve kapsam filtreleri satirlari suzer; ozet sabit kalir', async () => {
    render(<OcpRouteProd />);
    await screen.findByText('kart-api');
    expect(screen.getByText('3 / 3 prod route')).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Route adına göre süz'), { target: { value: 'İBAN' } });
    expect(satirlar().map((r) => within(r).queryByText('IBAN-web') !== null)).toEqual([true]);
    expect(screen.getByText('1 / 3 prod route')).toBeTruthy();

    fireEvent.click(screen.getByText('Filtreleri temizle'));
    fireEvent.change(screen.getByLabelText('gbocpprod2 sütununa göre süz'), { target: { value: 'yok' } });
    expect(screen.queryByText('kart-api')).toBeNull();
    expect(screen.getByText('IBAN-web')).toBeTruthy();
    expect(screen.getByText('eski-app')).toBeTruthy();

    fireEvent.change(screen.getByLabelText('gbocpprod3 sütununa göre süz'), { target: { value: 'var' } });
    expect(screen.queryByText('IBAN-web')).toBeNull();
    expect(screen.getByText('eski-app')).toBeTruthy();

    fireEvent.click(screen.getByText('Filtreleri temizle'));
    fireEvent.change(screen.getByLabelText('Kapsama göre süz'), { target: { value: 'tam' } });
    expect(screen.getByText('kart-api')).toBeTruthy();
    expect(screen.queryByText('eski-app')).toBeNull();

    fireEvent.click(screen.getByText('Filtreleri temizle'));
    fireEvent.change(screen.getByLabelText('Namespace adına göre süz'), { target: { value: 'arsiv' } });
    expect(screen.getByText('eski-app')).toBeTruthy();
    expect(screen.queryByText('kart-api')).toBeNull();
    // ozet filtreden etkilenmez: toplam 3 prod route
    expect(screen.getByText('prod route').previousElementSibling?.textContent).toBe('3');
  });
});
