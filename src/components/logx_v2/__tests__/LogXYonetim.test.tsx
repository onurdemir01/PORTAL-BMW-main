// src/components/logx_v2/__tests__/LogXYonetim.test.tsx
//
// LogX YÖNETİMİ EKRANI (L5, 2026-10-01):
//   Y1 Admin: yeni kaynak seçici, açıklayıcı, red günlüğü ve sahip atama GÖRÜNÜR;
//      "Kısıtla" sunucuya doğru tipi/anahtarı gönderir
//   Y2 Kaynak sahibi: YALNIZCA kendi kaynakları; seçici/açıklayıcı/günlük ve sahip
//      düzenleme YOK (sunucu da ayrıca reddeder — bu ekranın sözleşmesi)
//   Y3 LogX sayfasındaki giriş düğmesi YALNIZCA sahibe görünür
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, fireEvent } from '@testing-library/react';
import { render } from '@/test/test-utils';
import LogXErisim from '@/components/admin/tabs/logxv2/LogXErisim';
import LogXYonetimDugmesi from '@/components/logx_v2/shared/LogXYonetimDugmesi';

const m = vi.hoisted(() => ({
  resources: vi.fn(),
  restrict: vi.fn(),
  unrestrict: vi.fn(),
  addGrant: vi.fn(),
  removeGrant: vi.fn(),
  addGroupGrant: vi.fn(),
  removeGroupGrant: vi.fn(),
  addOwner: vi.fn(),
  removeOwner: vi.fn(),
  explain: vi.fn(),
  denials: vi.fn(),
  envLabels: vi.fn(),
  infra: vi.fn(),
}));

vi.mock('@/api/logxV2Api', () => ({
  logxV2Api: {
    manage: m,
    getClusterTree: vi.fn().mockResolvedValue({ ok: true, tree: {} }),
    searchLegacyApps: vi.fn().mockResolvedValue({ ok: true, apps: [] }),
    inventoryNamespaces: vi.fn().mockResolvedValue({ ok: true, items: [] }),
  },
}));

const KAYNAK = {
  resourceType: 'legacy_app',
  resourceKey: 'ODEME-EAR',
  restriction: {
    id: 5,
    description: null,
    grants: ['ali'],
    groupGrants: ['CN=odeme-ekibi,OU=G'],
    createdBy: 'boss',
    createdAt: '',
  },
  owners: [
    {
      id: 1,
      resourceType: 'legacy_app',
      resourceKey: 'ODEME-EAR',
      principalType: 'user',
      principal: 'lider',
      createdBy: 'boss',
      createdAt: '',
    },
  ],
};

beforeEach(() => {
  Object.values(m).forEach((f) => f.mockReset());
  m.envLabels.mockResolvedValue({
    ok: true,
    labels: [
      { label: 'PROD', sources: ['legacy', 'ocp'] },
      { label: 'PRD', sources: ['ocp'] },
    ],
  });
  m.denials.mockResolvedValue({ ok: true, denials: [] });
  m.infra.mockResolvedValue({ ok: true, clusters: [] });
  m.restrict.mockResolvedValue({ ok: true });
});

describe('Y1 Admin görünümü', () => {
  it('tüm bölümler görünür; ortam kısıtlama doğru isteği gönderir; tek kaynaklı etiket uyarısı', async () => {
    m.resources.mockResolvedValue({ ok: true, isAdmin: true, resources: [KAYNAK] });
    render(<LogXErisim />);
    await waitFor(() => expect(screen.getByText('ODEME-EAR')).toBeTruthy());
    expect(screen.getByText('Neden reddedildi?')).toBeTruthy();
    expect(screen.getByText('Red günlüğü')).toBeTruthy();
    expect(screen.getByPlaceholderText(/sahip: kullanıcı adı/)).toBeTruthy();
    expect(screen.getByText('grup odeme-ekibi')).toBeTruthy();
    await waitFor(() =>
      expect(screen.getByTestId('logx-tek-kaynakli-ortam').textContent).toMatch(/PRD: ocp/),
    );
    fireEvent.change(screen.getByLabelText('ortam'), { target: { value: 'PROD' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Kısıtla' })[0]);
    await waitFor(() =>
      expect(m.restrict).toHaveBeenCalledWith({ resourceType: 'env', resourceKey: 'PROD' }),
    );
  });
});

describe('Y2 Kaynak sahibi görünümü', () => {
  it('yalnızca kendi kaynakları; admin bölümleri ve sahip düzenleme yok', async () => {
    m.resources.mockResolvedValue({ ok: true, isAdmin: false, resources: [KAYNAK] });
    render(<LogXErisim />);
    await waitFor(() => expect(screen.getByText('ODEME-EAR')).toBeTruthy());
    expect(screen.getByText(/yalnızca sahibi olduğunuz kaynakları/)).toBeTruthy();
    expect(screen.queryByText('Neden reddedildi?')).toBeNull();
    expect(screen.queryByText('Red günlüğü')).toBeNull();
    expect(screen.queryByText('Kaynak kısıtla')).toBeNull();
    expect(screen.queryByPlaceholderText(/sahip: kullanıcı adı/)).toBeNull();
    expect(screen.queryByLabelText('sahibi kaldır')).toBeNull();
    // İzin yönetimi VAR.
    expect(screen.getByPlaceholderText('kullanıcı adı')).toBeTruthy();
    expect(m.denials).not.toHaveBeenCalled();
  });
});

describe('Y3 LogX sayfası giriş düğmesi', () => {
  it('sahibe görünür', async () => {
    m.resources.mockResolvedValue({ ok: true, isAdmin: false, resources: [KAYNAK] });
    render(<LogXYonetimDugmesi />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'LogX Yönetimi' })).toBeTruthy());
  });
  it('sahip olmayana ve admine görünmez', async () => {
    m.resources.mockResolvedValue({ ok: true, isAdmin: false, resources: [] });
    const a = render(<LogXYonetimDugmesi />);
    await waitFor(() => expect(m.resources).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: 'LogX Yönetimi' })).toBeNull();
    a.unmount();
    m.resources.mockResolvedValue({ ok: true, isAdmin: true, resources: [KAYNAK] });
    render(<LogXYonetimDugmesi />);
    await waitFor(() => expect(m.resources).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole('button', { name: 'LogX Yönetimi' })).toBeNull();
  });
});
