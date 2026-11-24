// @vitest-environment jsdom
// Nginx Audit listesi (2026-11-24, kapsam PR-2): sema / tarama durumlari, ozet, hizli sorun suzgecleri ve siralama,
// uyum siralamasi, satirdan sunucu sayfasi, istisna (Admin: ekle / duzenle / kaldir, iyimser guncelleme), kabul
// edilen degerler (ekle / kaldir), CSV ve Yenile.
import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NginxAuditHost, NginxAuditResult } from '@/api/denetimApi';

const api = vi.hoisted(() => ({
  nginxAudit: vi.fn(),
  nginxAuditAllowed: vi.fn(),
  nginxAuditAllowedAdd: vi.fn(),
  nginxAuditAllowedRemove: vi.fn(),
  nginxAuditExceptionSet: vi.fn(),
  nginxAuditExceptionClear: vi.fn(),
}));
vi.mock('@/api/denetimApi', () => ({ denetimApi: api }));
const yetki = vi.hoisted(() => ({ role: 'Admin' }));
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: { username: 'u', role: yetki.role } }),
}));
const tost = vi.hoisted(() => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/hooks/useToast', () => tost);
const csv = vi.hoisted(() => ({ downloadCsv: vi.fn() }));
vi.mock('@/utils/csv', () => csv);

import { NginxAudit, hostPagePath } from '../NginxAudit';

const host = (ek: Partial<NginxAuditHost>): NginxAuditHost =>
  ({
    host: 'NGX01',
    env: 'PROD',
    envSource: 'name',
    site: 'A',
    tier: 'internet',
    status: 'ok',
    statusMsg: '',
    files: 3,
    serverBlocks: 2,
    locations: 10,
    locationsProxy: 6,
    upstreams: 4,
    upsNoResolve: 0,
    upsNoKeepalive: 0,
    upsNoZone: 0,
    unusedUpstreams: 0,
    proxyFqdn: 0,
    proxyUndefined: 0,
    settingsMismatch: 0,
    compliance: 100,
    issues: 0,
    exception: null,
    refFilesDiff: 0,
    refFilesMissing: 0,
    servers: [],
    locationsByFile: [],
    upstreamList: [],
    settingsMismatched: [],
    settingsOverrides: [],
    settingsAll: [],
    refFiles: [],
    ...ek,
  }) as NginxAuditHost;

const HOSTS = [
  host({ host: 'NGX01', compliance: 100 }),
  host({
    host: 'NGX02',
    env: 'TEST',
    envSource: 'inventory',
    upsNoResolve: 3,
    upsNoKeepalive: 1,
    proxyUndefined: 2,
    proxyFqdn: 1,
    settingsMismatch: 4,
    compliance: 70,
    issues: 5,
    refFilesDiff: 2,
    complianceParts: [{ label: 'upstream', ok: 1, total: 2, pct: 50 }],
  }),
  host({
    host: 'NGX03',
    env: 'BILINMIYOR',
    envSource: 'none',
    status: 'fail',
    statusMsg: 'nginx -T hata',
    upsNoZone: 2,
    compliance: 85,
    issues: 2,
    refFilesDiff: 1,
    refFilesMissing: 1,
    tier: 'intranet',
  }),
  host({
    host: 'NGX04',
    compliance: null,
    upsNoResolve: 1,
    proxyUndefined: 7,
    proxyUndefinedRaw: 7,
    exception: { note: 'eski proxy', by: 'admin', at: '2026-11-01T00:00:00Z' },
  }),
];

const veri = (ek: Partial<NginxAuditResult> = {}): NginxAuditResult =>
  ({
    ok: true,
    schemaReady: true,
    filesReady: true,
    scanDate: '2026-11-20',
    scannedAt: '2026-11-20T02:00:00Z',
    hosts: HOSTS,
    reference: [{ directive: 'client_max_body_size', context: 'http', value: '1m' }],
    totals: {
      hosts: 4,
      serverBlocks: 8,
      locations: 40,
      upstreams: 16,
      configInvalid: 1,
      proxyUndefined: 2,
      settingsMismatch: 4,
      hostsWithMismatch: 1,
      refFilesDiff: 3,
      hostsWithFileDiff: 2,
      refFilesMissing: 1,
      proxyFqdn: 1,
      upsNoResolve: 4,
      unusedUpstreams: 0,
      excepted: 1,
      hostsEnvUnknown: 1,
    },
    _cache: { computedAt: '2026-11-20T02:05:00Z', yasMs: 5 * 60000 },
    ...ek,
  }) as unknown as NginxAuditResult;

const sunucuSirasi = () =>
  screen
    .getAllByRole('row')
    .map((r) => within(r).queryByRole('link')?.textContent)
    .filter(Boolean);

function goster() {
  return render(
    <MemoryRouter initialEntries={['/denetim']}>
      <Routes>
        <Route path="/denetim" element={<NginxAudit />} />
        <Route path="/denetim/nginx-audit/:host" element={<p>SUNUCU SAYFASI</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  yetki.role = 'Admin';
  api.nginxAudit.mockResolvedValue(veri());
  api.nginxAuditAllowed.mockResolvedValue({
    ok: true,
    rows: [
      {
        id: 1,
        directive: 'client_max_body_size',
        value: '10m',
        note: 'yukleme',
        created_by: 'ali',
      },
      { id: 2, directive: 'gzip', value: 'off', note: '', created_by: '' },
    ],
  });
});

describe('NginxAudit', () => {
  it('hostPagePath adi kodlar', () => {
    expect(hostPagePath('A B')).toBe('/denetim/nginx-audit/A%20B');
  });

  it('hata, sema yok ve tarama yok durumlari', async () => {
    api.nginxAudit.mockResolvedValueOnce({ ok: false, message: 'Okunamadi (ornek)' });
    const r1 = goster();
    expect(await screen.findByText('Okunamadi (ornek)')).toBeTruthy();
    r1.unmount();
    api.nginxAudit.mockResolvedValueOnce(veri({ schemaReady: false }));
    const r2 = goster();
    expect(await screen.findByText('Nginx Audit henüz açık değil')).toBeTruthy();
    r2.unmount();
    api.nginxAudit.mockResolvedValueOnce(veri({ scanDate: null }));
    const r3 = goster();
    expect(await screen.findByText('Henüz tarama kaydı yok')).toBeTruthy();
    r3.unmount();
    api.nginxAudit.mockRejectedValueOnce(new Error('ag yok'));
    goster();
    expect(await screen.findByText('ag yok')).toBeTruthy();
  });

  it('ozet, bilinmeyen ortam notu, hucreler ve istisnali satir', async () => {
    goster();
    expect(await screen.findByText('1 sunucunun ortamı bilinmiyor')).toBeTruthy();
    expect(screen.getByText('5 dk önce hesaplandı')).toBeTruthy();
    const r2 = screen.getByRole('link', { name: 'NGX02' }).closest('tr') as HTMLElement;
    expect(within(r2).getByText('%70')).toBeTruthy();
    expect(within(r2).getByText('geçerli')).toBeTruthy();
    const r3 = screen.getByRole('link', { name: 'NGX03' }).closest('tr') as HTMLElement;
    expect(within(r3).getByText('HATA')).toBeTruthy();
    expect(within(r3).getByText(/intranet/)).toBeTruthy();
    const r4 = screen.getByRole('link', { name: 'NGX04' }).closest('tr') as HTMLElement;
    expect(within(r4).getByText('istisna')).toBeTruthy();
    expect(within(r4).getByText('eski proxy')).toBeTruthy();
    expect(within(r4).getAllByTitle('istisna: bu metrik sayılmıyor')).toHaveLength(2);
  });

  it('hizli sorun suzgecleri sayilari ve siralamasi; ortam / arama / sorunlular', async () => {
    goster();
    await screen.findByRole('link', { name: 'NGX01' });
    fireEvent.click(screen.getByRole('button', { name: /upstream resolve yok/ }));
    expect(sunucuSirasi()).toEqual(['NGX02', 'NGX04']);
    fireEvent.click(screen.getByRole('button', { name: /nginx -T hatalı/ }));
    expect(sunucuSirasi()).toEqual(['NGX03']);
    fireEvent.click(screen.getByRole('button', { name: /uyum < %90/ }));
    expect(sunucuSirasi()).toEqual(['NGX02', 'NGX03']);
    fireEvent.click(screen.getByRole('button', { name: /zone yok/ }));
    expect(sunucuSirasi()).toEqual(['NGX03']);
    fireEvent.click(screen.getByRole('button', { name: /^hepsi/ }));
    expect(sunucuSirasi()).toHaveLength(4);

    fireEvent.change(screen.getByDisplayValue('tüm ortamlar'), { target: { value: 'TEST' } });
    expect(sunucuSirasi()).toEqual(['NGX02']);
    fireEvent.change(screen.getByDisplayValue('TEST'), { target: { value: '' } });
    fireEvent.change(screen.getByPlaceholderText('sunucu ara'), { target: { value: 'x03' } });
    expect(sunucuSirasi()).toEqual(['NGX03']);
    fireEvent.change(screen.getByPlaceholderText('sunucu ara'), { target: { value: '' } });
    fireEvent.click(screen.getByLabelText('Sadece sorunlular'));
    expect(sunucuSirasi()).toEqual(['NGX02', 'NGX03']);
  });

  it('uyum basligi: artan, azalan, kapali; verisiz sunucu her iki yonde sonda', async () => {
    goster();
    await screen.findByRole('link', { name: 'NGX01' });
    const dugme = screen.getByRole('button', { name: 'Uyum skoruna göre sırala' });
    fireEvent.click(dugme);
    expect(sunucuSirasi()).toEqual(['NGX02', 'NGX03', 'NGX01', 'NGX04']);
    fireEvent.click(dugme);
    expect(sunucuSirasi()).toEqual(['NGX01', 'NGX03', 'NGX02', 'NGX04']);
    fireEvent.click(dugme);
    expect(sunucuSirasi()).toEqual(['NGX01', 'NGX02', 'NGX03', 'NGX04']);
  });

  it('satira tiklamak sunucu sayfasini acar', async () => {
    goster();
    const satir = (await screen.findByRole('link', { name: 'NGX02' })).closest('tr') as HTMLElement;
    fireEvent.click(within(satir).getByText('%70'));
    expect(await screen.findByText('SUNUCU SAYFASI')).toBeTruthy();
  });

  it('istisna ekle: not zorunlu, kayit iyimser uygulanir ve sessizce tazelenir', async () => {
    api.nginxAuditExceptionSet.mockResolvedValueOnce({ ok: false, message: 'Yetki yok (ornek)' });
    api.nginxAuditExceptionSet.mockResolvedValueOnce({ ok: true, by: 'u' });
    goster();
    const satir = (await screen.findByRole('link', { name: 'NGX02' })).closest('tr') as HTMLElement;
    fireEvent.click(within(satir).getByText('istisna ekle'));
    expect(await screen.findByText('İstisna tanımla')).toBeTruthy();
    const kaydet = screen.getByRole('button', { name: 'Kaydet' }) as HTMLButtonElement;
    expect(kaydet.disabled).toBe(true);
    fireEvent.change(screen.getByPlaceholderText(/Eski reverse proxy/), {
      target: { value: '  test sunucusu  ' },
    });
    fireEvent.click(kaydet);
    expect(await screen.findByText('Yetki yok (ornek)')).toBeTruthy();
    // Sessiz tazeleme sunucunun kaydettigi durumu getirir (iyimser guncelleme onunla ayni).
    api.nginxAudit.mockResolvedValue(
      veri({
        hosts: HOSTS.map((h) =>
          h.host === 'NGX02'
            ? { ...h, exception: { note: 'test sunucusu', by: 'u', at: null }, proxyUndefined: 0 }
            : h,
        ),
      }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Kaydet' }));
    await waitFor(() => expect(screen.queryByText('İstisna tanımla')).toBeNull());
    expect(api.nginxAuditExceptionSet).toHaveBeenLastCalledWith('NGX02', 'test sunucusu');
    const yeni = screen.getByRole('link', { name: 'NGX02' }).closest('tr') as HTMLElement;
    expect(within(yeni).getByText('test sunucusu')).toBeTruthy();
    await waitFor(() => expect(api.nginxAudit).toHaveBeenLastCalledWith(true));
  });

  it('istisna duzenle / kaldir; hata mesaji gosterilir', async () => {
    api.nginxAuditExceptionClear.mockRejectedValueOnce(new Error('kaldirilamadi (ornek)'));
    api.nginxAuditExceptionClear.mockResolvedValueOnce({ ok: true });
    goster();
    const satir = (await screen.findByRole('link', { name: 'NGX04' })).closest('tr') as HTMLElement;
    fireEvent.click(within(satir).getByTitle('istisnayı düzenle / kaldır'));
    expect(await screen.findByText('İstisnayı düzenle')).toBeTruthy();
    expect(screen.getByDisplayValue('eski proxy')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'İstisnayı kaldır' }));
    expect(await screen.findByText('kaldirilamadi (ornek)')).toBeTruthy();
    api.nginxAudit.mockResolvedValue(
      veri({
        hosts: HOSTS.map((h) =>
          h.host === 'NGX04' ? { ...h, exception: null, proxyUndefined: 7 } : h,
        ),
      }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'İstisnayı kaldır' }));
    await waitFor(() => expect(screen.queryByText('İstisnayı düzenle')).toBeNull());
    const yeni = screen.getByRole('link', { name: 'NGX04' }).closest('tr') as HTMLElement;
    expect(within(yeni).queryByText('eski proxy')).toBeNull();
    expect(within(yeni).getByText('7')).toBeTruthy();
    // Iptal pencereyi kapatir.
    fireEvent.click(within(yeni).getByText('istisna ekle'));
    fireEvent.click(await screen.findByRole('button', { name: 'İptal' }));
    await waitFor(() => expect(screen.queryByText('İstisna tanımla')).toBeNull());
  });

  it('Admin olmayan istisna duzenleyemez ve kabul edilen deger ekleyemez', async () => {
    yetki.role = 'User';
    goster();
    const satir = (await screen.findByRole('link', { name: 'NGX02' })).closest('tr') as HTMLElement;
    expect(within(satir).queryByText('istisna ekle')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Göster (2)' }));
    expect(screen.queryByPlaceholderText('client_max_body_size')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Kaldır' })).toBeNull();
  });

  it('kabul edilen degerler: liste, ekle (basarisiz / basarili), kaldir', async () => {
    api.nginxAuditAllowedAdd.mockResolvedValueOnce({ ok: false, message: 'Zaten var (ornek)' });
    api.nginxAuditAllowedAdd.mockResolvedValueOnce({ ok: true });
    api.nginxAuditAllowedRemove.mockResolvedValueOnce({ ok: true });
    goster();
    fireEvent.click(await screen.findByRole('button', { name: 'Göster (2)' }));
    const kabul = screen.getByText('yukleme').closest('tr') as HTMLElement;
    expect(within(kabul).getByText('10m')).toBeTruthy();
    // Referans sutunu kurulum referansindan; referansi olmayan direktifte tire.
    expect(within(kabul).getByText('1m')).toBeTruthy();
    expect(
      within(screen.getByText('gzip').closest('tr') as HTMLElement).getByText('—'),
    ).toBeTruthy();
    const ekle = screen.getByRole('button', { name: 'Ekle' }) as HTMLButtonElement;
    expect(ekle.disabled).toBe(true);
    fireEvent.change(screen.getByPlaceholderText('client_max_body_size'), {
      target: { value: ' gzip ' },
    });
    fireEvent.change(screen.getByPlaceholderText('10m'), { target: { value: ' on ' } });
    fireEvent.change(screen.getByPlaceholderText('neden kabul?'), { target: { value: 'not' } });
    fireEvent.click(ekle);
    await waitFor(() => expect(tost.toast.error).toHaveBeenCalledWith('Zaten var (ornek)'));
    fireEvent.click(screen.getByRole('button', { name: 'Ekle' }));
    await waitFor(() => expect(tost.toast.success).toHaveBeenCalled());
    expect(api.nginxAuditAllowedAdd).toHaveBeenLastCalledWith('gzip', 'on', 'not');
    expect((screen.getByPlaceholderText('10m') as HTMLInputElement).value).toBe('');
    fireEvent.click(screen.getAllByRole('button', { name: 'Kaldır' })[0]);
    await waitFor(() => expect(api.nginxAuditAllowedRemove).toHaveBeenCalledWith(1));
    fireEvent.click(screen.getByRole('button', { name: 'Gizle' }));
    expect(screen.queryByText('yukleme')).toBeNull();
  });

  it('kabul edilen deger yoksa bos satir; kaldirma hatasi tostla', async () => {
    api.nginxAuditAllowed.mockResolvedValue({ ok: true, rows: [] });
    goster();
    fireEvent.click(await screen.findByRole('button', { name: 'Göster (0)' }));
    expect(screen.getByText('Kabul edilen değer yok.')).toBeTruthy();
  });

  it('CSV suzulmus satirlari yazar; Yenile onbellegi atlar', async () => {
    goster();
    await screen.findByRole('link', { name: 'NGX01' });
    fireEvent.click(screen.getByRole('button', { name: /nginx -T hatalı/ }));
    fireEvent.click(screen.getByRole('button', { name: /CSV/ }));
    const [ad, baslik, govde] = csv.downloadCsv.mock.calls[0];
    expect(ad).toBe('nginx_audit_2026-11-20');
    expect(baslik[0]).toBe('sunucu');
    expect(govde).toHaveLength(1);
    expect(govde[0].slice(0, 6)).toEqual(['NGX03', 'BILINMIYOR', 'none', 'A', 'fail', 85]);
    fireEvent.click(screen.getByRole('button', { name: /Yenile/ }));
    await waitFor(() => expect(api.nginxAudit).toHaveBeenLastCalledWith(true));
  });
});
