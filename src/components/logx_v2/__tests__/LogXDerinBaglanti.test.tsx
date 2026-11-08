// src/components/logx_v2/__tests__/LogXDerinBaglanti.test.tsx — Uygulama Hub'dan ön-seçimli LogX (2026-11-08).
//
// Sözleşme: src/utils/derinBaglanti.ts. LogX her adımı sunucudaki logx_v2_requests kaydına yazar;
// bu yüzden ön-seçimin EN ÖNEMLİ kuralı: bağlantı BİR KEZ uygulanır, URL'den silinir ve sayfa
// yenilendiğinde (ya da StrictMode effect'i iki kez çalıştırdığında) İKİNCİ bir istek açılmaz.
//   LD1 legacy: tek istek (StrictMode), URL temizlenir, uygulama seçili -> Sunucu Seçimi;
//       "yenileme" (yeniden mount) yeni istek AÇMAZ, kayıttan devam eder
//   LD2 ?logxRequest varsa ön-seçim parametreleri yok sayılır (istek açılmaz) ve URL'den silinir
//   LD3 openshift: cluster seçimi yapılmış, namespace seçili, AppNameStep araması uygulama adıyla dolu
//   LD4 openshift: namespace listede yoksa seçici açılır ve uyarı görünür
//   LD5 bilinmeyen ortam: istek açılır ama cluster seçimi elle; uyarı görünür
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

const m = vi.hoisted(() => ({
  createRequest: vi.fn(),
  getRequest: vi.fn(),
  searchLegacyApps: vi.fn(),
  legacyHosts: vi.fn(),
  getClusterTree: vi.fn(),
  selectClusters: vi.fn(),
  inventoryNamespaces: vi.fn(),
  inventoryApps: vi.fn(),
  playbookReadiness: vi.fn(),
  resources: vi.fn(),
}));
vi.mock('@/api/logxV2Api', () => ({
  logxV2Api: {
    createRequest: m.createRequest,
    getRequest: m.getRequest,
    searchLegacyApps: m.searchLegacyApps,
    legacyHosts: m.legacyHosts,
    getClusterTree: m.getClusterTree,
    selectClusters: m.selectClusters,
    inventoryNamespaces: m.inventoryNamespaces,
    inventoryApps: m.inventoryApps,
    playbookReadiness: m.playbookReadiness,
    manage: { resources: m.resources },
  },
}));

import LogXWizardPage from '@/components/logx_v2/LogXWizardPage';

const istek = (platform: string, input: unknown = null) => ({
  ok: true,
  request: { id: 'r1', platform, state: 'draft', input, discoveryResult: null, errorMessage: null },
  jobs: [],
  download: null,
  downloads: [],
});

function ac(url: string, strict = false) {
  window.history.replaceState({ usr: null, key: 'k1', idx: 0 }, '', url);
  const ui = <LogXWizardPage />;
  return render(strict ? <React.StrictMode>{ui}</React.StrictMode> : ui);
}

beforeEach(() => {
  Object.values(m).forEach((f) => f.mockReset());
  m.resources.mockResolvedValue({ ok: true, isAdmin: false, resources: [] });
  m.playbookReadiness.mockResolvedValue({ ok: true, rows: [] });
  m.createRequest.mockResolvedValue({ ok: true, requestId: 'r1' });
  m.legacyHosts.mockResolvedValue({ ok: true, hosts: [] });
  m.getClusterTree.mockResolvedValue({ ok: true, tree: { PROD: { ark: ['gbocpprod1', 'gbocpprod2'] } } });
  m.selectClusters.mockResolvedValue({ ok: true, terminalHost: 't' });
  m.inventoryApps.mockResolvedValue({
    cached: true,
    items: [{ name: 'app-1', kind: 'Deployment', replicas: 2 }],
    fetchedAt: null,
    stale: false,
  });
});

describe('LogX derin bağlantı (Uygulama Hub ön-seçimi)', () => {
  it('LD1 legacy: tek istek, URL temizlenir, uygulama seçili; yenileme ikinci istek açmaz', async () => {
    m.getRequest.mockResolvedValue(istek('legacy'));
    m.searchLegacyApps.mockResolvedValue({ ok: true, apps: ['FOO-APP'], fallbackMode: false });
    const { unmount } = ac('/logx?platform=legacy&app=foo-app', true);
    expect(await screen.findByText('Sunucu Seçimi')).toBeTruthy();
    await waitFor(() => expect(m.legacyHosts).toHaveBeenCalledWith('FOO-APP'));
    expect(m.createRequest).toHaveBeenCalledTimes(1);
    expect(m.createRequest).toHaveBeenCalledWith('legacy');
    const sorgu = new URLSearchParams(window.location.search);
    expect(sorgu.get('logxRequest')).toBe('r1');
    expect(sorgu.get('platform')).toBeNull();
    expect(sorgu.get('app')).toBeNull();

    // YENİLEME: aynı URL'le yeniden açılış. Kayıttan devam edilir, ön-seçim TEKRAR UYGULANMAZ.
    unmount();
    render(<LogXWizardPage />);
    await screen.findByText('Uygulama Seçimi');
    expect(m.getRequest).toHaveBeenLastCalledWith('r1');
    expect(m.createRequest).toHaveBeenCalledTimes(1);
  });

  it('LD2 ?logxRequest varsa ön-seçim yok sayılır ve URL’den silinir', async () => {
    m.getRequest.mockResolvedValue(istek('legacy'));
    m.searchLegacyApps.mockResolvedValue({ ok: true, apps: [], fallbackMode: false });
    ac('/logx?logxRequest=r9&platform=legacy&app=BAR');
    await screen.findByText('Uygulama Seçimi');
    expect(m.getRequest).toHaveBeenCalledWith('r9');
    expect(m.createRequest).not.toHaveBeenCalled();
    expect((screen.getByPlaceholderText(/Uygulama adı ara/) as HTMLInputElement).value).toBe('');
    expect(window.location.search).toBe('?logxRequest=r9');
  });

  it('LD3 openshift: cluster seçili, namespace seçili, arama uygulama adıyla dolu', async () => {
    const secili = { env: 'PROD', tenant: 'ark', clusters: ['gbocpprod2'] };
    m.getRequest.mockImplementation(async () =>
      istek('openshift', m.selectClusters.mock.calls.length ? secili : null),
    );
    m.inventoryNamespaces.mockResolvedValue({
      cached: true,
      items: ['ns-a', 'ns-b'],
      fetchedAt: null,
      stale: false,
    });
    ac('/logx?platform=openshift&app=app-1&env=prod&tenant=ARK&namespace=ns-b&cluster=gbocpprod2');
    const arama = (await screen.findByPlaceholderText(/Ara veya listede olmayan/)) as HTMLInputElement;
    expect(screen.getAllByTitle('ns-b').length).toBeGreaterThan(0);
    expect(m.selectClusters).toHaveBeenCalledWith('r1', 'PROD', 'ark', ['gbocpprod2']);
    expect(m.createRequest).toHaveBeenCalledTimes(1);
    expect(arama.value).toBe('app-1');
    await waitFor(() => expect(m.inventoryApps).toHaveBeenCalledWith('PROD', 'ark', ['gbocpprod2'], 'ns-b'));
    expect(screen.queryByTestId('logx-ondolum-uyari')).toBeNull();
  });

  it('LD4 openshift: namespace listede yoksa seçici açılır, uyarı görünür', async () => {
    const secili = { env: 'PROD', tenant: 'ark', clusters: ['gbocpprod1', 'gbocpprod2'] };
    m.getRequest.mockImplementation(async () =>
      istek('openshift', m.selectClusters.mock.calls.length ? secili : null),
    );
    m.inventoryNamespaces.mockResolvedValue({ cached: true, items: ['ns-a'], fetchedAt: null, stale: false });
    ac('/logx?platform=openshift&app=app-1&env=PROD&tenant=ark&namespace=gizli-ns');
    const uyari = await screen.findByTestId('logx-ondolum-uyari');
    expect(uyari.textContent).toMatch(/gizli-ns/);
    // Cluster verilmedi: tenant'ın bütün cluster'ları seçilir.
    expect(m.selectClusters).toHaveBeenCalledWith('r1', 'PROD', 'ark', ['gbocpprod1', 'gbocpprod2']);
    expect(await screen.findByText('Namespace Seçimi')).toBeTruthy();
  });

  it('LD5 bilinmeyen ortam: cluster seçimi elle, uyarı görünür', async () => {
    m.getRequest.mockResolvedValue(istek('openshift'));
    ac('/logx?platform=openshift&app=app-1&env=MARS&tenant=ark&namespace=ns-a');
    expect((await screen.findByTestId('logx-ondolum-uyari')).textContent).toMatch(/MARS/);
    expect(m.selectClusters).not.toHaveBeenCalled();
    expect(await screen.findByText('Cluster Seçimi')).toBeTruthy();
  });
});
