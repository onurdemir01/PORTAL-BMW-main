// src/components/admin/tabs/logxv2/__tests__/MaskRulesSection.test.tsx
//
// Maskeleme kurallari (2026-10-23): sunucu guvenlik denetiminden gecemeyen kurali UYGULAMAZ
// ve liste yanitinda `reddedilen` olarak bildirir. Ekran bunu soylemezse admin kuralin
// calistigini sanar - o PII turu maskesiz kalir.
//   MR1 reddedilen kurallar adi ve sebebiyle gorunur
//   MR2 reddedilen yoksa (ya da alan hic gelmezse - eski sunucu) uyari cikmaz
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { render } from '@/test/test-utils';
import { MaskRulesSection } from '@/components/admin/tabs/logxv2/LogXBolumleri';

const mockList = vi.hoisted(() => vi.fn());

vi.mock('@/api/logxV2Api', () => ({
  logxV2Api: {
    admin: {
      listMaskRules: mockList,
      createMaskRule: vi.fn(),
      updateMaskRule: vi.fn(),
      deleteMaskRule: vi.fn(),
    },
  },
}));

const SATIR = {
  id: 1,
  name: 'TCKN',
  pattern: '\\b[1-9]\\d{10}\\b',
  flags: 'g',
  replacement: '[TCKN]',
  sort_order: 1,
  enabled: true,
};

describe('MaskRulesSection', () => {
  beforeEach(() => mockList.mockReset());

  it('MR1 reddedilen kurallar adı ve sebebiyle görünür', async () => {
    mockList.mockResolvedValue({
      ok: true,
      rows: [SATIR],
      reddedilen: [{ name: 'KOTU_DESEN', sebep: 'iç içe sınırsız niceleyici (konum 7)' }],
    });
    render(<MaskRulesSection />);
    const uyari = await screen.findByText(/güvenlik denetiminden geçmediği için uygulanmıyor/);
    const kutu = uyari.closest('[role="alert"]');
    expect(kutu).not.toBeNull();
    expect(kutu?.textContent).toMatch(/KOTU_DESEN/);
    expect(kutu?.textContent).toMatch(/iç içe sınırsız niceleyici/);
  });

  it('MR2 reddedilen yoksa ya da alan hiç gelmezse uyarı çıkmaz', async () => {
    for (const yanit of [
      { ok: true, rows: [SATIR], reddedilen: [] },
      { ok: true, rows: [SATIR] },
    ]) {
      mockList.mockResolvedValue(yanit);
      const { unmount } = render(<MaskRulesSection />);
      await waitFor(() => expect(mockList).toHaveBeenCalled());
      await screen.findByText('TCKN');
      expect(screen.queryByText(/güvenlik denetiminden geçmediği/)).toBeNull();
      unmount();
      mockList.mockReset();
    }
  });
});
