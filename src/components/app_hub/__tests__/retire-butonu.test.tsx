// src/components/app_hub/__tests__/retire-butonu.test.tsx — Application Hub "Uygulamamı retire et" (2026-11-13).
// Kullanıcı: uygulama sayfasına retire butonu; bu ekrandan retirement talebi başlatılsın; şimdilik YALNIZ Admin.
//   RB1 Admin + JBoss: buton var; tıklayınca retirement kayıt penceresi uygulama adıyla açılır (varsayılan gün config'ten)
//   RB2 Admin olmayan kullanıcıda buton yok
//   RB3 WAS / OCP uygulamasında buton yok (retirement motoru JBoss hedefleriyle çalışır)
//   RB4 kayıt açılınca sayfada kayıt numarası ve BMW Hub bağlantısı
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { render } from '@/test/test-utils';
import AppHubPage from '@/components/app_hub/AppHubPage';

const kimlik = vi.hoisted(() => ({ role: 'Admin' }));
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: { username: 'onur', role: kimlik.role }, canViewPage: () => true }),
}));
const api = vi.hoisted(() => ({ detay: vi.fn(), config: vi.fn() }));
vi.mock('@/api/appHubApi', () => ({ appHubApi: { detay: api.detay, ara: vi.fn().mockResolvedValue({ sonuclar: [] }) } }));
vi.mock('@/api/retirementApi', () => ({ retirementApi: { config: api.config } }));
const pencere = vi.hoisted(() => ({ props: null as null | Record<string, unknown> }));
vi.mock('@/components/server_hub/RetirementTab', () => ({
  CreateModal: (p: Record<string, unknown>) => {
    pencere.props = p;
    return (
      <div data-testid="retire-penceresi">
        <button type="button" onClick={() => (p.onCreated as (id: number) => void)(42)}>kaydı aç</button>
      </div>
    );
  },
}));
vi.mock('@/components/app_hub/JbossGorunum', () => ({ default: () => null }));
vi.mock('@/components/app_hub/WasGorunum', () => ({ default: () => null }));
vi.mock('@/components/app_hub/OcpGorunum', () => ({ default: () => null }));
vi.mock('@/components/app_hub/AramaKutusu', () => ({ default: () => null }));

const jboss = { tip: 'jboss', ad: 'MUSTERI', varyantlar: ['MUSTERI'], ozet: {}, sunucular: [], webSunuculari: [], kaynaklar: {} };

function ac(tip: string) {
  return render(<AppHubPage />, { initialEntries: [`/application-hub?tip=${tip}&ad=MUSTERI`] });
}

describe('Application Hub — Uygulamamı retire et', () => {
  beforeEach(() => {
    kimlik.role = 'Admin';
    pencere.props = null;
    api.detay.mockReset().mockResolvedValue({ uygulama: jboss, okundu: null });
    api.config.mockReset().mockResolvedValue({ ok: true, defaultDays: 30 });
  });

  it('RB1 Admin + JBoss: pencere uygulama adıyla açılır', async () => {
    ac('jboss');
    fireEvent.click(await screen.findByRole('button', { name: /Uygulamamı retire et/ }));
    await screen.findByTestId('retire-penceresi');
    expect(pencere.props?.defaultDays).toBe(30);
    expect((pencere.props?.baslangic as { uygulama: string }).uygulama).toBe('MUSTERI');
  });

  it('RB2 Admin olmayan kullanıcıda buton yok', async () => {
    kimlik.role = 'User';
    ac('jboss');
    await waitFor(() => expect(api.detay).toHaveBeenCalled());
    await screen.findByRole('button', { name: /Yenile/ });
    expect(screen.queryByRole('button', { name: /retire/i })).toBeNull();
  });

  it('RB3 WAS uygulamasında buton yok', async () => {
    api.detay.mockResolvedValue({ uygulama: { ...jboss, tip: 'was' }, okundu: null });
    ac('was');
    await waitFor(() => expect(api.detay).toHaveBeenCalled());
    await screen.findByRole('button', { name: /Yenile/ });
    expect(screen.queryByRole('button', { name: /retire/i })).toBeNull();
  });

  it('RB4 kayıt açılınca numara ve BMW Hub bağlantısı', async () => {
    ac('jboss');
    fireEvent.click(await screen.findByRole('button', { name: /Uygulamamı retire et/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'kaydı aç' }));
    expect(await screen.findByText('#42')).toBeTruthy();
    expect(screen.getByRole('button', { name: "BMW Hub'da aç" })).toBeTruthy();
    expect(screen.queryByTestId('retire-penceresi')).toBeNull();
  });
});
