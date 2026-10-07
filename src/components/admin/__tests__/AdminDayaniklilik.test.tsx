// src/components/admin/__tests__/AdminDayaniklilik.test.tsx
//
// ADMIN: COKEN SEKME MENUYU DUSURMEZ + SEKMEYE DOGRUDAN BAGLANTI (2026-10-07).
//
// 1. Hata siniri yalnizca SAYFA duzeyindeydi. Gercek tarayicida "Ansible Info" sekmesi render
//    sirasinda dustugunde sekme menusu dahil butun Admin Merkezi "Bu sayfa yüklenemedi"
//    kutusuna donustu: yonetici baska bir sekmeye gecemiyordu.
// 2. Aktif sekme yalnizca istemci durumuydu (ve kullanici tercihi). Portaldaki onlarca
//    "Admin > LogX Yonetimi" yonlendirmesi paylasilabilir bir adrese karsilik gelmiyordu.
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import AdminPage from '@/components/admin/AdminPage';

const m = vi.hoisted(() => ({
  cokenSekme: null as string | null,
  getAll: vi.fn(),
  set: vi.fn(),
}));

// Sekmelerin KENDISI burada sinanmaz: her biri adini basan bir yer tutucudur; `cokenSekme`
// o sekmeyi render sirasinda dusurur (uretimdeki gercek cokmenin taklidi).
function yerTutucu(ad: string) {
  return {
    default: () => {
      if (m.cokenSekme === ad) throw new Error(`${ad} render sirasinda dustu`);
      return <div data-testid="sekme-icerigi">{ad}</div>;
    },
  };
}
vi.mock('@/components/admin/tabs/AuditLogTab', () => yerTutucu('audit'));
vi.mock('@/components/admin/tabs/AnsibleConfigTab', () => yerTutucu('ansible'));
vi.mock('@/components/admin/tabs/PlaybookRegistryTab', () => yerTutucu('playbooks'));
vi.mock('@/components/admin/tabs/SystemConfigTab', () => yerTutucu('system'));
vi.mock('@/components/admin/tabs/UserManagementTab', () => yerTutucu('users'));
vi.mock('@/components/admin/tabs/PageVisibilityTab', () => yerTutucu('visibility'));
vi.mock('@/components/admin/tabs/DenetimAccessTab', () => yerTutucu('denetimaccess'));
vi.mock('@/components/admin/tabs/NginxAccessTab', () => yerTutucu('nginxaccess'));
vi.mock('@/components/admin/tabs/CryptoAccessTab', () => yerTutucu('cryptoaccess'));
vi.mock('@/components/admin/tabs/LogXv2AdminTab', () => yerTutucu('logxv2'));
vi.mock('@/components/admin/tabs/ScaleXAdminTab', () => yerTutucu('scalex'));
vi.mock('@/components/admin/tabs/InventoryVisibilityTab', () => yerTutucu('inventoryvis'));
vi.mock('@/components/admin/tabs/LogXAdminTab', () => yerTutucu('logx'));
vi.mock('@/components/admin/tabs/BrandingTab', () => yerTutucu('branding'));
vi.mock('@/components/admin/tabs/DbBackupTab', () => yerTutucu('dbbackup'));
vi.mock('@/components/admin/tabs/SmartTicketsTab', () => yerTutucu('smarttickets'));
vi.mock('@/api/prefsApi', () => ({ prefsApi: { getAll: m.getAll, set: m.set } }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ canSee: () => true }) }));

function Konum() {
  const l = useLocation();
  return <p data-testid="konum">{l.pathname + l.search}</p>;
}
function ac(adres: string) {
  return render(
    <MemoryRouter initialEntries={[adres]}>
      <AdminPage />
      <Konum />
    </MemoryRouter>,
  );
}
const icerik = () => screen.getByTestId('sekme-icerigi').textContent;
const menu = () => screen.getByRole('navigation', { name: 'Admin bölümleri' });

beforeEach(() => {
  m.cokenSekme = null;
  m.getAll.mockReset().mockResolvedValue({});
  m.set.mockReset().mockResolvedValue(undefined);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('Admin sekmesine dogrudan baglanti', () => {
  it('AD1 `/admin?tab=logx` LogX Yonetimi sekmesini acar (kayitli tercih baska olsa da)', async () => {
    m.getAll.mockResolvedValue({ admin_active_tab: 'system' });
    ac('/admin?tab=logx');
    expect(icerik()).toBe('logx');
    // Tercih sonradan gelse de adresteki sekme EZILMEZ.
    await new Promise((r) => setTimeout(r, 30));
    expect(icerik()).toBe('logx');
  });

  it('AD2 adreste sekme yoksa kayitli tercih gecerlidir', async () => {
    m.getAll.mockResolvedValue({ admin_active_tab: 'system' });
    ac('/admin');
    await waitFor(() => expect(icerik()).toBe('system'));
  });

  it('AD3 bilinmeyen sekme adi yok sayilir: yedek sekme acilir, kayitli tercih EZILMEZ', async () => {
    m.getAll.mockResolvedValue({ admin_active_tab: 'system' });
    ac('/admin?tab=boyle-bir-sekme-yok');
    await waitFor(() => expect(icerik()).toBe('system'));
    // Bozuk bir baglanti kullanicinin kayitli sekme tercihini degistirmemeli.
    expect(m.set).not.toHaveBeenCalled();
  });

  it('AD4 sekme degisince adres guncellenir ve tercih yazilir', async () => {
    ac('/admin');
    fireEvent.click(screen.getByRole('button', { name: /ScaleX Yönetimi/ }));
    expect(icerik()).toBe('scalex');
    expect(screen.getByTestId('konum').textContent).toBe('/admin?tab=scalex');
    expect(m.set).toHaveBeenCalledWith({ admin_active_tab: 'scalex' });
  });
});

describe('Coken sekme', () => {
  it('AD5 sekme render sirasinda duserse MENU ayakta kalir ve baska sekmeye gecilebilir', async () => {
    m.cokenSekme = 'ansible';
    ac('/admin?tab=ansible');
    // Sekmenin yerinde hata kutusu var...
    expect(await screen.findByText('Bu sayfa yüklenemedi')).toBeTruthy();
    expect(screen.getByText(/ansible render sirasinda dustu/)).toBeTruthy();
    // ...ama Admin'in basligi ve sekme menusu duruyor.
    expect(screen.getByText('Admin Merkezi')).toBeTruthy();
    expect(menu().textContent).toMatch(/Kullanıcılar/);
    // Baska sekmeye gecis calisir ve hata kutusu gider.
    fireEvent.click(screen.getByRole('button', { name: /Kullanıcılar/ }));
    expect(icerik()).toBe('users');
    expect(screen.queryByText('Bu sayfa yüklenemedi')).toBeNull();
  });

  it('AD6 coken sekmeye GERI donulunce sinir sifirlanir (duzelmisse acilir)', async () => {
    m.cokenSekme = 'ansible';
    ac('/admin?tab=ansible');
    await screen.findByText('Bu sayfa yüklenemedi');
    fireEvent.click(screen.getByRole('button', { name: /Kullanıcılar/ }));
    m.cokenSekme = null;
    fireEvent.click(screen.getByRole('button', { name: /Ansible Info/ }));
    expect(icerik()).toBe('ansible');
  });
});
