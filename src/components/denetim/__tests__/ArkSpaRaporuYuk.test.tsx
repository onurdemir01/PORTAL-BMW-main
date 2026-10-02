// src/components/denetim/__tests__/ArkSpaRaporuYuk.test.tsx
//
// ARK SPA Raporu "Yük Durumu" hücresi ve "yük almıyor (emekli adayı)" süzgeci (2026-10-02).
// Sunucu kısa pencerede (günlük rotasyonlu sunucu, okunan log 1-4 gün) artık 'unknown' +
// kismi ['pencere'] döner. Ekran:
//   - hücrede ölçülen süreyi söyler: "son 2 günde istek yok (7 gün ölçülemedi)"
//   - bu satırı "yük almıyor (emekli adayı)" süzgecine SOKMAZ
//   - gerçekten 7 gün ölçülmüş 0'ı "yük almıyor" olarak gösterir
// (Dosya denetim/__tests__ altında: vitest + run-tests TEST_DIRS kapsamı.)
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { render } from '@/test/test-utils';
import ArkSpaRaporuPage from '@/components/ArkSpaRaporuPage';
import type { ArkRapor, ArkSatir, ArkYuk } from '@/api/arkSpaApi';

const mockReport = vi.hoisted(() => vi.fn());
vi.mock('@/api/arkSpaApi', () => ({
  arkSpaApi: { report: mockReport, declare: vi.fn() },
}));

const yuk = (o: Partial<ArkYuk>): ArkYuk => ({
  state: 'idle',
  req24: 0,
  req7: 0,
  hc24: 0,
  lastSeen: null,
  firstSeen: '20260924000000',
  pencereSaat: 192,
  sampled: false,
  hosts: 2,
  unknownHosts: 0,
  missingHosts: 0,
  ...o,
});
const satir = (application: string, traffic: ArkYuk | null): ArkSatir => ({
  service: 'GLOMO',
  env: 'PROD',
  namespace: 'kart-prod',
  application,
  location: `/${application}/`,
  hosts: ['GBNGXP40', 'GBNGXP41'],
  vhosts: ['GLOMO-PROD'],
  team: [],
  traffic,
  inUse: null,
  inUseBy: null,
  inUseAt: null,
  note: '',
  inUseScope: null,
});

const RAPOR: ArkRapor = {
  ok: true,
  scanDate: '2026-10-02',
  trafficReady: true,
  services: [{ service: 'GLOMO', rows: 2, apps: 2, declared: 0 }],
  rows: [
    satir('kisa-app-v1', yuk({ state: 'unknown', pencereSaat: 68, firstSeen: '20260929031500', kismi: ['pencere'] })),
    satir('atil-app-v1', yuk({})),
  ],
};

describe('ArkSpaRaporuPage yük hücresi', () => {
  beforeEach(() => {
    mockReport.mockReset();
    mockReport.mockResolvedValue(RAPOR);
  });

  it('kısa pencerede ölçülen süreyi söyler, "yük almıyor" demez', async () => {
    render(<ArkSpaRaporuPage />);
    const h = await screen.findByText('son 2 günde istek yok (7 gün ölçülemedi)');
    expect(h.getAttribute('title')).toContain('“yük almıyor” DENMEZ');
    // 7 gün ölçülmüş gerçek 0 ayrı gösterilir.
    expect(screen.getByText('yük almıyor')).toBeTruthy();
  });

  it('"yük almıyor (emekli adayı)" süzgeci kısa pencereli satırı LİSTELEMEZ', async () => {
    render(<ArkSpaRaporuPage />);
    await screen.findByText('kisa-app-v1');
    const suzgec = screen.getByDisplayValue('yük: hepsi');
    fireEvent.change(suzgec, { target: { value: 'idle' } });
    expect(screen.queryByText('kisa-app-v1')).toBeNull();
    expect(screen.getByText('atil-app-v1')).toBeTruthy();
    // "ölçülemedi" süzgecinde görünür.
    fireEvent.change(suzgec, { target: { value: 'unknown' } });
    expect(screen.getByText('kisa-app-v1')).toBeTruthy();
    expect(screen.queryByText('atil-app-v1')).toBeNull();
  });
});
