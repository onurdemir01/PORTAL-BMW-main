// src/components/denetim/__tests__/GlomoGecisPlani.test.tsx — Glomo Gecis Plani ekrani (2026-10-13).
// Kalan setler (6, 7) ustte; "kullanimda" Evet ise katilimci kutusu acilir; Admin alanlari yalniz
// Admin'e; gecenler en altta; tabloyu dolduranin adi hicbir yerde yok.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { render } from '@/test/test-utils';
import GlomoGecisPlani from '@/components/GlomoGecisPlani';
import type { GecisPlani, GecisUygulama } from '@/api/arkSpaApi';

const mockGecis = vi.hoisted(() => vi.fn());
const mockApp = vi.hoisted(() => vi.fn());
vi.mock('@/api/arkSpaApi', () => ({
  arkSpaApi: { gecis: mockGecis, gecisApp: mockApp, gecisAppAdmin: vi.fn(), gecisSet: vi.fn(), gecisSetGecti: vi.fn() },
}));

const app = (application: string, o: Partial<GecisUygulama> = {}): GecisUygulama => ({
  namespace: 'ns-prod', application, setNo: 6, kaynak: 'excel', kullanimda: null, katilimci: '', gecti: false,
  gecisTarihi: null, ekip: ['GT-Ekip'], locations: [`/${application}/`], yuk: null, taramadaYok: false, ...o,
});
const plan = (admin: boolean): GecisPlani => ({
  ok: true, raporVar: true, admin,
  sets: [1, 2, 3, 4, 5, 6, 7].map((no) => ({ no, calismaAt: no === 6 ? '2026-10-15T23:00' : null, ocoNo: no === 6 ? 'OCO-777' : '' })),
  apps: [
    app('alti-app'),
    app('yedi-app', { setNo: 7, kaynak: 'portal' }),
    app('gecen-app', { setNo: 3, gecti: true, gecisTarihi: '2026-10-01', katilimci: 'Veli' }),
  ],
});

describe('GlomoGecisPlani', () => {
  beforeEach(() => { mockGecis.mockReset(); mockApp.mockReset(); });

  it('Set 6 basliginda calisma zamani + OCO; Excel disi uygulama isaretli; gecen en altta', async () => {
    mockGecis.mockResolvedValue(plan(false));
    render(<GlomoGecisPlani />);
    expect(await screen.findByText('15.10.2026 23:00')).toBeInTheDocument();
    expect(screen.getByText('OCO-777')).toBeInTheDocument();
    expect(screen.getByText('Excel’de yoktu → eklendi')).toBeInTheDocument();
    const metin = document.body.textContent || '';
    expect(metin.indexOf('alti-app')).toBeLessThan(metin.indexOf('gecen-app'));
    expect(metin.indexOf('Geçen uygulamalar')).toBeLessThan(metin.indexOf('gecen-app'));
    expect(screen.queryByText(/Set \/ geçiş \(Admin\)/)).not.toBeInTheDocument();
  });

  it('Evet secilince katilimci kutusu acilir ve kaydedilir', async () => {
    mockGecis.mockResolvedValue(plan(false));
    mockApp.mockResolvedValue({ ok: true });
    render(<GlomoGecisPlani />);
    await screen.findByText('alti-app');
    fireEvent.click(screen.getAllByRole('button', { name: 'Evet' })[0]);
    await waitFor(() => expect(mockApp).toHaveBeenCalledWith(expect.objectContaining({ application: 'alti-app', kullanimda: 'yes' })));
    const kutu = await screen.findByLabelText('alti-app çalışmaya katılacak kişi');
    fireEvent.change(kutu, { target: { value: 'Ayşe Yılmaz' } });
    fireEvent.blur(kutu);
    await waitFor(() => expect(mockApp).toHaveBeenLastCalledWith(expect.objectContaining({ katilimci: 'Ayşe Yılmaz' })));
  });

  it('Admin set zamani / OCO / gecti alanlarini gorur', async () => {
    mockGecis.mockResolvedValue(plan(true));
    render(<GlomoGecisPlani />);
    await screen.findByText('alti-app');
    expect(screen.getAllByText('Set / geçiş (Admin)').length).toBeGreaterThan(0);
    expect(screen.getAllByPlaceholderText('OCO numarası').length).toBeGreaterThan(0);
  });
});
