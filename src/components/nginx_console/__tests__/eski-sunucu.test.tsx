// eski-sunucu.test.tsx — Nginx Hub eski (kapatılmış) sunucular (2026-11-12).
//
// Sunucu her listede envanterde olmayan + 14+ gündür taranmayan sunucuları gizler ve `eskiGizli`
// yazar; sayfa açık sekme için kısa not gösterir. Admin temizliği: aday listesi, yazılı onay (SIL),
// "İptal" hiçbir istek atmaz, sonuç özeti. Admin olmayan paneli görmez.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, waitFor, fireEvent } from '@testing-library/react';
import { render } from '@/test/test-utils';

const auth = { role: 'Admin' };
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: { username: 'u', role: auth.role }, canSee: () => true }),
}));
vi.mock('@/contexts/JobTrackerContext', () => ({ useJobTracker: () => ({ addJob: vi.fn() }) }));

import NginxConsolePage from '@/components/nginx_console/NginxConsolePage';
import { _eskiGizliSifirla, eskiGizliBirlesik, eskiGizliKaydet } from '@/api/nginxEskiSunucuApi';
import { nginxConsoleApi } from '@/api/nginxConsoleApi';

const yanit = (govde: unknown, status = 200) =>
  Promise.resolve(new Response(JSON.stringify(govde), { status, headers: { 'Content-Type': 'application/json' } }));

const ADAYLAR = {
  ok: true,
  gun: 14,
  esik: '2026-10-29T12:00:00.000Z',
  hesaplandi: '2026-11-12T12:00:00.000Z',
  sinirlar: { maksHost: 50, maksSatir: 20000, parca: 5000 },
  adaylar: [
    {
      host: 'GBOLU001',
      sonGorulme: '2026-10-01T00:00:00.000Z',
      sonTarama: '2026-10-01',
      dosyalar: ['GBOLU001.txt', 'GBOLU001.summary.json'],
      tbmwans: { 'dbo.Nginx_Audit_Hosts': 30 },
      portal: { nginx_hub_file_history: 12 },
      toplamSatir: 42,
    },
  ],
};

describe('Nginx Hub eski sunucular', () => {
  let cagrilar: { url: string; init?: RequestInit }[];
  let hostsGovde: unknown;
  beforeEach(() => {
    _eskiGizliSifirla();
    auth.role = 'Admin';
    cagrilar = [];
    hostsGovde = {
      ok: true,
      hosts: [],
      consoleDir: '/x',
      inventoryError: null,
      eskiGizli: { sayi: 2, hostlar: ['GBOLU001', 'GBOLU002'], gun: 14, gosteriliyor: false, olculemedi: false },
    };
    vi.stubGlobal(
      'fetch',
      vi.fn((u: string, init?: RequestInit) => {
        cagrilar.push({ url: String(u), init });
        const url = String(u);
        if (url.endsWith('/eski-sunucular/temizle'))
          return yanit({
            ok: true,
            gun: 14,
            toplamSatir: 42,
            butceDoldu: false,
            kalanVar: false,
            hosts: [{ host: 'GBOLU001', silinenSatir: { 'dbo.Nginx_Audit_Hosts': 30 }, dosyalar: ['GBOLU001.txt'], hatalar: [], tamam: true }],
          });
        if (url.endsWith('/eski-sunucular')) return yanit(ADAYLAR);
        if (url.includes('/hosts')) return yanit(hostsGovde);
        return yanit({ ok: true });
      }),
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  it('EN1 not: gizlenen sunucu sayısı ve gerekçesi açık sekmede görünür', async () => {
    render(<NginxConsolePage />, { initialEntries: ['/nginx-console?tab=instances'] });
    const not = await screen.findByTestId('nc-eski-notu');
    expect(not.textContent).toContain('2 eski sunucu gizlendi (envanterde yok, 14+ gündür taranmadı)');
    expect(not.textContent).toContain('GBOLU001, GBOLU002');
  });

  it('EN2 not: gizlenen yoksa ya da ölçülemediyse not yok', async () => {
    hostsGovde = { ok: true, hosts: [], consoleDir: '/x', inventoryError: null, eskiGizli: { sayi: 0, hostlar: [], gun: 14, olculemedi: true } };
    render(<NginxConsolePage />, { initialEntries: ['/nginx-console?tab=instances'] });
    await waitFor(() => expect(cagrilar.some((c) => c.url.includes('/hosts'))).toBe(true));
    expect(screen.queryByTestId('nc-eski-notu')).toBeNull();
  });

  it('EN3 birleşik kaynak: aynı sunucu iki uçta gizlense de bir kez sayılır', () => {
    eskiGizliKaydet('api')({ eskiGizli: { sayi: 2, hostlar: ['A1', 'B1'], gun: 14 } });
    eskiGizliKaydet('apiLocations')({ eskiGizli: { sayi: 2, hostlar: ['B1', 'C1'], gun: 14 } });
    expect(eskiGizliBirlesik(['api', 'apiLocations'])).toMatchObject({ sayi: 3, hostlar: ['A1', 'B1', 'C1'] });
    expect(eskiGizliBirlesik(['cis'])).toBeNull();
    const govde = { ok: true, x: 1 };
    expect(eskiGizliKaydet('cis')(govde)).toBe(govde);
  });

  it('EN4 Admin temizliği: liste, İptal istek atmaz, SIL yazılmadan Sil kapalı, onayla POST + sonuç', async () => {
    render(<NginxConsolePage />, { initialEntries: ['/nginx-console?tab=instances'] });
    fireEvent.click(await screen.findByTestId('nc-eski-listele'));
    expect(await screen.findByText('GBOLU001')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('GBOLU001 seç'));
    fireEvent.click(screen.getByTestId('nc-eski-sil'));
    expect(await screen.findByText(/kalıcı olarak silinecek/)).toBeTruthy();
    const onayla = screen.getByTestId('nc-eski-onayla') as HTMLButtonElement;
    expect(onayla.disabled).toBe(true);
    fireEvent.change(screen.getByTestId('nc-eski-onay-metni'), { target: { value: 'sil' } });
    expect(onayla.disabled).toBe(true);
    // İptal: hiçbir silme isteği yok
    fireEvent.click(screen.getByText('İptal'));
    await waitFor(() => expect(screen.queryByText(/kalıcı olarak silinecek/)).toBeNull());
    expect(cagrilar.some((c) => c.url.endsWith('/temizle'))).toBe(false);
    expect(screen.queryByText(/Vazgeç/)).toBeNull();
    // Yeniden aç, SIL yaz, onayla
    fireEvent.click(screen.getByTestId('nc-eski-sil'));
    fireEvent.change(await screen.findByTestId('nc-eski-onay-metni'), { target: { value: 'SIL' } });
    const btn = screen.getByTestId('nc-eski-onayla') as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
    fireEvent.click(btn);
    const sonuc = await screen.findByTestId('nc-eski-sonuc');
    expect(sonuc.textContent).toContain('42 satır silindi');
    const post = cagrilar.find((c) => c.url.endsWith('/eski-sunucular/temizle'));
    expect(post?.init?.method).toBe('POST');
    expect(JSON.parse(String(post?.init?.body))).toEqual({ hosts: ['GBOLU001'], onay: 'SIL' });
  });

  it('EN4b Türkçe Caps Lock "SİL" de onaylar; ipucu görünür', async () => {
    render(<NginxConsolePage />, { initialEntries: ['/nginx-console?tab=instances'] });
    fireEvent.click(await screen.findByTestId('nc-eski-listele'));
    fireEvent.click(await screen.findByLabelText('GBOLU001 seç'));
    fireEvent.click(screen.getByTestId('nc-eski-sil'));
    expect(await screen.findByText(/de kabul edilir/)).toBeTruthy();
    fireEvent.change(screen.getByTestId('nc-eski-onay-metni'), { target: { value: 'SİL' } });
    expect((screen.getByTestId('nc-eski-onayla') as HTMLButtonElement).disabled).toBe(false);
  });

  it('EN6 SPA Uygulamaları: spa-discovery yanıtındaki eskiGizli kaydedilir ve sekme notu onu da gösterir', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((u: string) =>
        String(u).includes('/spa-discovery')
          ? yanit({ ok: true, apps: [], eskiGizli: { sayi: 1, hostlar: ['GBOLU009'], gun: 14 } })
          : yanit({ ok: true }),
      ),
    );
    await nginxConsoleApi.spaDiscovery();
    expect(eskiGizliBirlesik(['spaKesif'])).toMatchObject({ sayi: 1, hostlar: ['GBOLU009'] });
    render(<NginxConsolePage />, { initialEntries: ['/nginx-console?tab=spadiscovery'] });
    const not = await screen.findByTestId('nc-eski-notu');
    expect(not.textContent).toContain('GBOLU009');
  });

  it('EN5 Admin olmayan temizlik panelini görmez', async () => {
    auth.role = 'User';
    render(<NginxConsolePage />, { initialEntries: ['/nginx-console?tab=instances'] });
    await screen.findByTestId('nc-eski-notu');
    expect(screen.queryByTestId('nc-eski-listele')).toBeNull();
    expect(cagrilar.some((c) => c.url.includes('/eski-sunucular'))).toBe(false);
  });
});
