// src/components/logx_v2/__tests__/LogXKisitlama.test.tsx
//
// LogX sihirbazı KISITLAMAYI SÖYLER (L2, 2026-10-01):
//   K1 namespace listesi gizlenen SAYIYI gösterir (adlar sunucuda kalır)
//   K2 kısıtlı namespace'te otomatik canlı tarama BAŞLAMAZ, sunucunun açıklaması görünür
//      (eskiden boş liste "taranmamış" sanılıp AWX taraması açılıyor, o da 403 ile
//      düşüyordu — kullanıcı sebepsiz bir hata görüyordu)
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { render } from '@/test/test-utils';
import NamespacePickerStep from '@/components/logx_v2/steps/ocp/NamespacePickerStep';
import AppNameStep from '@/components/logx_v2/steps/ocp/AppNameStep';

const mockInventoryApps = vi.hoisted(() => vi.fn());
const mockReadiness = vi.hoisted(() => vi.fn());

vi.mock('@/api/logxV2Api', () => ({
  logxV2Api: {
    inventoryApps: mockInventoryApps,
    playbookReadiness: mockReadiness,
  },
}));

describe('K1 NamespacePickerStep', () => {
  it('gizlenen namespace sayısını söyler', () => {
    render(<NamespacePickerStep namespaces={['a']} hiddenCount={3} onSelect={() => {}} />);
    expect(screen.getByTestId('logx-hidden-namespaces').textContent).toMatch(
      /3 namespace LogX'te kısıtlı/,
    );
  });
  it('gizlenen yoksa not çıkmaz', () => {
    render(<NamespacePickerStep namespaces={['a']} onSelect={() => {}} />);
    expect(screen.queryByTestId('logx-hidden-namespaces')).toBeNull();
  });
});

describe('K2 AppNameStep kısıtlı namespace', () => {
  beforeEach(() => {
    mockInventoryApps.mockReset();
    mockReadiness.mockReset();
    mockReadiness.mockResolvedValue({ ok: true, rows: [] });
  });

  it('kısıtlıysa otomatik tarama YOK, sunucunun açıklaması görünür', async () => {
    const MESAJ =
      '"kisitli" namespace\'i (c1, prod/ark) LogX\'te kısıtlı. İzinli: grup odeme-ekibi. Erişim için: LogX yöneticisi (Admin).';
    mockInventoryApps.mockResolvedValue({
      ok: true,
      items: [],
      cached: false,
      fetchedAt: null,
      stale: false,
      source: null,
      restriction: {
        resourceType: 'ocp_namespace',
        resourceKey: 'ark/prod/c1/kisitli',
        label: '"kisitli"',
        allowedUsers: [],
        allowedGroups: ['odeme-ekibi'],
        contact: 'LogX yöneticisi (Admin)',
      },
      message: MESAJ,
    });
    const onDiscover = vi.fn();
    render(
      <AppNameStep
        env="prod"
        tenant="ark"
        clusters={['c1']}
        namespace="kisitli"
        onSubmit={() => {}}
        onDiscover={onDiscover}
        autoScanMemo={new Map()}
      />,
    );
    await waitFor(() => expect(screen.getByText(MESAJ)).toBeTruthy());
    expect(onDiscover).not.toHaveBeenCalled();
    // Kısıtlıyken "tara" düğmesi de sunulmaz (o da 403 alırdı).
    expect(screen.queryByText(/Bu namespace'i tara/)).toBeNull();
  });

  it('KONTROL: kısıtlı değil ve kayıt yoksa otomatik tarama başlar (bekçi kör değil)', async () => {
    mockInventoryApps.mockResolvedValue({
      ok: true,
      items: [],
      cached: false,
      fetchedAt: null,
      stale: false,
      source: null,
    });
    const onDiscover = vi.fn();
    render(
      <AppNameStep
        env="prod"
        tenant="ark"
        clusters={['c1']}
        namespace="acik"
        onSubmit={() => {}}
        onDiscover={onDiscover}
        autoScanMemo={new Map()}
      />,
    );
    await waitFor(() => expect(onDiscover).toHaveBeenCalledTimes(1));
  });
});
