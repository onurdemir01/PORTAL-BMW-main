// @vitest-environment jsdom
// Nginx API Envanteri > API Bazli (2026-11-24, kapsam PR-2): yukleme / hata / bos tarama, ozet kutulari,
// suzgecler (arama, ortam, yalniz bulgular), satir ayrintisi (kume kirilimi, eksik / taranmamis, ortam limitleri),
// sayfalama ve CSV.
import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NginxApiLocationRow, NginxApiLocationsResult } from '@/api/denetimApi';

const api = vi.hoisted(() => ({ nginxApiLocations: vi.fn() }));
vi.mock('@/api/denetimApi', () => ({ denetimApi: api }));
const csv = vi.hoisted(() => ({ downloadCsv: vi.fn() }));
vi.mock('@/utils/csv', () => csv);

import { NginxApiLocations } from '../NginxApiLocations';

const kume = (ek: Partial<NonNullable<NginxApiLocationRow['clusters']>[number]>) => ({
  key: 'customers',
  label: 'customers',
  total: 4,
  present: 4,
  missing: [],
  notScanned: [],
  groups: [{ ip: '50r/s', srv: '100r/s', hosts: ['NGP01', 'NGP02', 'NGP03', 'NGP04'] }],
  limitDrift: false,
  ...ek,
});

const satir = (ek: Partial<NginxApiLocationRow> = {}): NginxApiLocationRow => ({
  config: 'api.conf',
  location: '/api/odeme',
  envs: {
    PROD: { hosts: ['NGP01', 'NGP02'], ipRateLimits: ['50r/s'], serverRateLimits: ['100r/s'] },
    TEST: { hosts: ['NGT01'], ipRateLimits: [], serverRateLimits: [] },
  },
  presentEnvs: ['PROD', 'TEST'],
  missingEnvs: [],
  totalHosts: 3,
  limitDrift: false,
  envLimitDrift: false,
  clusters: [kume({})],
  ...ek,
});

const veri = (rows: NginxApiLocationRow[], ek: Partial<NginxApiLocationsResult> = {}) => ({
  ok: true,
  scanDate: '2026-11-20',
  scannedAt: '2026-11-20T03:00:00Z',
  envs: ['PROD', 'TEST'],
  rows,
  ...ek,
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe('NginxApiLocations', () => {
  it('hata ve basarisiz yanit mesaji gosterilir', async () => {
    api.nginxApiLocations.mockRejectedValueOnce(new Error('ag yok'));
    const { unmount } = render(<NginxApiLocations />);
    expect(await screen.findByText('ag yok')).toBeTruthy();
    unmount();
    api.nginxApiLocations.mockResolvedValueOnce({ ok: false });
    render(<NginxApiLocations />);
    expect(await screen.findByText('Veri alınamadı.')).toBeTruthy();
  });

  it('tarama yoksa bilgi notu', async () => {
    api.nginxApiLocations.mockResolvedValue(veri([], { scanDate: null }));
    render(<NginxApiLocations />);
    expect(await screen.findByText('Henüz tarama kaydı yok')).toBeTruthy();
  });

  it('ozet kutulari, kume pill etiketi ve bulgu rozetleri', async () => {
    api.nginxApiLocations.mockResolvedValue(
      veri([
        satir({
          location: '/api/a',
          limitDrift: true,
          clusterLimitDrift: true,
          missingEnvs: ['QA'],
          clusters: [
            kume({
              limitDrift: true,
              groups: [
                { ip: '50r/s', srv: '', hosts: ['NGP01'] },
                { ip: '10r/s', srv: '', hosts: ['NGP02'] },
              ],
            }),
            kume({ key: 'mcustomers', label: 'mcustomers', present: 0, groups: [] }),
            kume({
              key: 'mblcustomers',
              label: 'mblcustomers',
              present: 2,
              groups: [{ ip: '', srv: '', hosts: ['X'] }],
            }),
          ],
        }),
        satir({ location: '/api/b', envLimitDrift: true }),
        satir({ location: '/api/c', clusters: undefined }),
      ]),
    );
    render(<NginxApiLocations />);
    expect(await screen.findByText('/api/a')).toBeTruthy();
    expect(screen.getByText('3 / 3 yol gösteriliyor ·', { exact: false })).toBeTruthy();
    const a = screen.getByText('/api/a').closest('tr') as HTMLElement;
    expect(within(a).getByText('customers 4/4 · 2 farklı limit')).toBeTruthy();
    expect(within(a).getByText('mcustomers 0/4')).toBeTruthy();
    expect(within(a).getByText('mblcustomers 2/4 · limit yok')).toBeTruthy();
    expect(within(a).getByText('eksik: QA')).toBeTruthy();
    expect(within(a).getByText('sunucu farkı')).toBeTruthy();
    expect(within(a).getByText('küme içi limit farkı')).toBeTruthy();
    const b = screen.getByText('/api/b').closest('tr') as HTMLElement;
    expect(within(b).getByText('ortam farkı')).toBeTruthy();
    expect(within(b).getByText('customers 4/4 · 50r/s / 100r/s')).toBeTruthy();
  });

  it('suzgecler: arama, ortam ve yalniz bulgular', async () => {
    api.nginxApiLocations.mockResolvedValue(
      veri([
        satir({ location: '/api/odeme', limitDrift: true }),
        satir({ location: '/api/kart', config: 'kart.conf', presentEnvs: ['TEST'] }),
        satir({ location: '/api/temiz' }),
      ]),
    );
    render(<NginxApiLocations />);
    await screen.findByText('/api/odeme');
    fireEvent.change(screen.getByPlaceholderText('yol ya da dosya ara'), {
      target: { value: 'KART.CONF' },
    });
    await waitFor(() => expect(screen.queryByText('/api/odeme')).toBeNull());
    expect(screen.getByText('/api/kart')).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText('yol ya da dosya ara'), { target: { value: '' } });
    fireEvent.change(screen.getByDisplayValue('tüm ortamlar'), { target: { value: 'PROD' } });
    await waitFor(() => expect(screen.queryByText('/api/kart')).toBeNull());
    fireEvent.click(screen.getByLabelText('Sadece bulgular'));
    await waitFor(() => expect(screen.queryByText('/api/temiz')).toBeNull());
    expect(screen.getByText('/api/odeme')).toBeTruthy();
  });

  it('satir ayrintisi: kume gruplari, eksik / taranmamis sunucular, ortam limitleri', async () => {
    const cok = (o: string) => Array.from({ length: 8 }, (_, i) => `${o}${i}`);
    api.nginxApiLocations.mockResolvedValue(
      veri([
        satir({
          clusters: [
            kume({
              limitDrift: true,
              groups: [
                { ip: '50r/s', srv: '', hosts: cok('NGA') },
                { ip: '', srv: '20r/s', hosts: ['NGB1'] },
              ],
              missing: cok('NGM'),
              notScanned: cok('NGX'),
            }),
            kume({ key: 'mcustomers', label: 'mcustomers', present: 0, groups: [] }),
          ],
          envs: {
            PROD: {
              hosts: ['NGP01'],
              ipRateLimits: ['50r/s', '10r/s'],
              serverRateLimits: ['1r/s', '2r/s'],
            },
            TEST: { hosts: ['NGT01'], ipRateLimits: [], serverRateLimits: [] },
          },
        }),
      ]),
    );
    render(<NginxApiLocations />);
    fireEvent.click(await screen.findByText('/api/odeme'));
    expect(screen.getByText('IP 50r/s · location —')).toBeTruthy();
    expect(screen.getByText('IP — · location 20r/s')).toBeTruthy();
    expect(screen.getByText('nga0, nga1, nga2, nga3, nga4, nga5 +2')).toBeTruthy();
    expect(screen.getByText('8 sunucuda YOK')).toBeTruthy();
    expect(screen.getByText('ngm0, ngm1, ngm2, ngm3, ngm4, ngm5 +2')).toBeTruthy();
    expect(screen.getByText('8 sunucu taranmamış')).toBeTruthy();
    expect(screen.getByText('ngx0, ngx1, ngx2, ngx3, ngx4, ngx5 +2')).toBeTruthy();
    expect(screen.getByText('hiçbir sunucuda yok')).toBeTruthy();
    expect(screen.getByText('IP: 50r/s / 10r/s')).toBeTruthy();
    expect(screen.getByText('location: 1r/s / 2r/s')).toBeTruthy();
    expect(screen.getByText('rate limit yok')).toBeTruthy();
    // Ikinci tiklama kapatir.
    fireEvent.click(screen.getByText('/api/odeme'));
    expect(screen.queryByText('8 sunucuda YOK')).toBeNull();
  });

  it('300 satirdan sonrasi istekle acilir; CSV sutunlari ve satirlari', async () => {
    const rows = Array.from({ length: 305 }, (_, i) => satir({ location: `/api/y${i}` }));
    rows[0] = satir({
      location: '/api/y0',
      limitDrift: true,
      envLimitDrift: true,
      missingEnvs: ['QA'],
      clusters: [kume({ missing: ['NGM1'], notScanned: ['NGX1'] })],
    });
    api.nginxApiLocations.mockResolvedValue(veri(rows));
    render(<NginxApiLocations />);
    expect(await screen.findByText('5 satır daha var — devamını göster')).toBeTruthy();
    expect(screen.queryByText('/api/y304')).toBeNull();
    fireEvent.click(screen.getByText('5 satır daha var — devamını göster'));
    expect(screen.getByText('/api/y304')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /CSV/ }));
    const [ad, baslik, govde] = csv.downloadCsv.mock.calls[0];
    expect(ad).toBe('nginx_api_bazli');
    expect(baslik.slice(0, 4)).toEqual(['konfigurasyon', 'yol', 'PROD', 'TEST']);
    expect(baslik).toContain('customers_var');
    expect(baslik.slice(-3)).toEqual(['eksik_ortam', 'sunucu_farki', 'ortam_farki']);
    expect(govde).toHaveLength(305);
    expect(govde[0]).toEqual([
      'api.conf',
      '/api/y0',
      'NGP01 NGP02',
      'NGT01',
      '4/4',
      '50r/s/100r/s x4',
      'NGM1',
      'NGX1',
      'QA',
      'EVET',
      'EVET',
    ]);
  });

  it('Yenile yeniden okur; hata sonradan da gosterilir', async () => {
    api.nginxApiLocations.mockResolvedValueOnce(veri([satir()]));
    render(<NginxApiLocations />);
    await screen.findByText('/api/odeme');
    api.nginxApiLocations.mockResolvedValueOnce(veri([satir({ location: '/api/yeni' })]));
    fireEvent.click(screen.getByRole('button', { name: /Yenile/ }));
    expect(await screen.findByText('/api/yeni')).toBeTruthy();
    api.nginxApiLocations.mockRejectedValueOnce(new Error('sunucu dustu'));
    fireEvent.click(screen.getByRole('button', { name: /Yenile/ }));
    expect(await screen.findByText('sunucu dustu')).toBeTruthy();
  });
});
