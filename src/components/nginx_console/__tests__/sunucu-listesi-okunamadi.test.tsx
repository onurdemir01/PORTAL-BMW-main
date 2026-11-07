// sunucu-listesi-okunamadi.test.tsx — Nginx Hub sunucu listesi okunamazsa (2026-11-07).
//
// Gerçek tarayıcı taraması: liste ucu `hosts` alanı olmadan dönünce sayfa çöküyordu
// (`hosts.map` / undefined); hata dönünce Dashboard "0 sunucu", Instances "Envanterde nginx
// sunucusu yok" diyordu. OKUNAMADI ≠ YOK: hata ayrı gösterilir, boş-durum metni yalnız başarıda.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { render } from '@/test/test-utils';

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: { username: 'u', role: 'Admin' }, canSee: () => true }),
}));
vi.mock('@/contexts/JobTrackerContext', () => ({ useJobTracker: () => ({ addJob: vi.fn() }) }));

import NginxConsolePage from '@/components/nginx_console/NginxConsolePage';
import { SourceNote } from '@/components/nginx_console/SourceNote';
import { nginxConsoleApi } from '@/api/nginxConsoleApi';

const yanit = (govde: unknown, status = 200) =>
  Promise.resolve(
    new Response(JSON.stringify(govde), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  );

describe('Nginx Hub sunucu listesi okunamadı', () => {
  let govde: unknown;
  let durum: number;
  let diger: { govde: unknown; durum: number };
  beforeEach(() => {
    govde = { ok: true };
    durum = 200;
    diger = { govde: { ok: true }, durum: 200 };
    vi.stubGlobal(
      'fetch',
      vi.fn((u: string) =>
        String(u).includes('/hosts') ? yanit(govde, durum) : yanit(diger.govde, diger.durum),
      ),
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  it('NS1 api: listesiz başarılı yanıt başarı sayılmaz', async () => {
    const r = await nginxConsoleApi.hosts();
    expect(r.ok).toBe(false);
    expect(r.hosts).toEqual([]);
    expect(r.message).toMatch(/beklenen biçimde değil/);
    govde = { ok: true, hosts: [], consoleDir: '/x', inventoryError: null };
    expect((await nginxConsoleApi.hosts()).ok).toBe(true);
  });

  it('NS2 sayfa: listesiz yanıtta çökmez, "okunamadı" der, "sunucu yok" demez', async () => {
    render(<NginxConsolePage />, { initialEntries: ['/nginx-console?tab=instances'] });
    expect(await screen.findByTestId('nc-hosts-hata')).toBeTruthy();
    expect(screen.getByText('Nginx sunucu listesi okunamadı')).toBeTruthy();
    expect(screen.queryByText('Envanterde nginx sunucusu yok.')).toBeNull();
    expect(screen.queryByText('Bu sayfa yüklenemedi')).toBeNull();
  });

  it('NS3 sayfa: 500 yanıtında Dashboard sıfır sayaç göstermez, hata gösterir', async () => {
    govde = { ok: false, message: 'Sunucu hatasi' };
    durum = 500;
    render(<NginxConsolePage />, { initialEntries: ['/nginx-console?tab=dashboard'] });
    expect(await screen.findByTestId('nc-hosts-hata')).toBeTruthy();
    expect(screen.getByText(/Sunucu hatasi/)).toBeTruthy();
  });

  it('NS4 sayfa: başarılı boş listede boş-durum metni görünür, hata görünmez', async () => {
    govde = { ok: true, hosts: [], consoleDir: '/x', inventoryError: null };
    render(<NginxConsolePage />, { initialEntries: ['/nginx-console?tab=instances'] });
    await waitFor(() => expect(screen.getByText('Envanterde nginx sunucusu yok.')).toBeTruthy());
    expect(screen.queryByTestId('nc-hosts-hata')).toBeNull();
  });

  it('NS5 Sertifikalar: 500 ve listesiz yanit cokertmez, "okunamadi" der', async () => {
    diger = { govde: { ok: false, message: 'Sertifika ucu dustu' }, durum: 500 };
    const { unmount } = render(<NginxConsolePage />, {
      initialEntries: ['/nginx-console?tab=certs'],
    });
    expect(await screen.findByTestId('nc-certs-hata')).toBeTruthy();
    expect(screen.getByText(/Sertifika ucu dustu/)).toBeTruthy();
    expect(screen.queryByText('Henüz dokum yok.')).toBeNull();
    unmount();
    diger = { govde: { ok: true }, durum: 200 };
    render(<NginxConsolePage />, { initialEntries: ['/nginx-console?tab=certs'] });
    expect(await screen.findByTestId('nc-certs-hata')).toBeTruthy();
  });

  it('NS6 Kullanilmayan: 500 yanitta cokmez, "okunamadi" der', async () => {
    diger = { govde: { ok: false, message: 'Yetim ucu dustu' }, durum: 500 };
    render(<NginxConsolePage />, { initialEntries: ['/nginx-console?tab=orphans'] });
    expect(await screen.findByTestId('nc-orphans-hata')).toBeTruthy();
    expect(screen.getByText(/Yetim ucu dustu/)).toBeTruthy();
  });

  it('NS7 "tarama kaydı yok" uyari METIN tokeniyla (ikon tonu 1.97:1 idi)', () => {
    render(<SourceNote source="console" scanDate={null} />);
    expect(screen.getByText('tarama kaydı yok').getAttribute('style')).toContain(
      'var(--status-warning-text)',
    );
  });
});
