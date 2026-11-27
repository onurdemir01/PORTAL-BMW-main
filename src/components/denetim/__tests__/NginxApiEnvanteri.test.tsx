// @vitest-environment jsdom
// Denetim > Nginx > API envanteri (2026-11-26, kapsam PR-2; %0): yukleme hatasi, tarama yok, sayaclar ve uyari tonu,
// ortama / sunucuya gore tablolar (servis, elle etiket, server_name ipucu, lokasyon) ve CSV'leri, konfigurasyon
// karsilastirma (arama, sadece sorunlular, ortam hucresi / fark araligi / eksik ortam, bulgu rozetleri, sunucu kirilimi,
// CSV), API bazli ve internete acma sekmeleri, rate limit'siz konfigurasyonlar, yenile.
import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const denetim = vi.hoisted(() => ({ nginxApi: vi.fn() }));
vi.mock('@/api/denetimApi', () => ({ denetimApi: denetim }));
const csv = vi.hoisted(() => vi.fn());
vi.mock('@/utils/csv', () => ({ downloadCsv: csv }));
vi.mock('../NginxInternetExpose', () => ({
  NginxInternetExpose: () => <div>internete acma ekrani</div>,
}));
vi.mock('../NginxApiLocations', () => ({ NginxApiLocations: () => <div>api bazli ekran</div> }));

import { NginxApiEnvanteri } from '../NginxApiEnvanteri';

const hucre = (minLoc: number, maxLoc: number) => ({
  minLoc,
  maxLoc,
  hosts: 2,
  locations: minLoc + maxLoc,
});
const konfig = (config: string, ek: Record<string, unknown> = {}) => ({
  config,
  envs: { test: hucre(3, 3), prod: hucre(3, 3) },
  presentEnvs: ['test', 'prod'],
  missingEnvs: [],
  hostInconsistent: false,
  envInconsistent: false,
  totalLocations: 12,
  noLimitLocations: 0,
  noLimitEverywhere: false,
  hosts: [
    { host: 'ORNTST01', env: 'test', site: '', locations: 3, noLimit: 0 },
    { host: 'ORNPRD01', env: 'prod', site: 'Ankara', locations: 3, noLimit: 1 },
  ],
  ...ek,
});
const veri = (ek: Record<string, unknown> = {}) => ({
  ok: true,
  scanDate: '2026-11-25',
  scannedAt: null,
  availableDates: ['2026-11-25'],
  envs: ['test', 'prod'],
  totals: {
    hosts: 4,
    configs: 3,
    locations: 1200,
    noLimitLocations: 5,
    configsWithoutLimit: 1,
    inconsistentConfigs: 2,
  },
  byEnv: [
    {
      env: 'test',
      hosts: 2,
      configs: 3,
      locations: 600,
      noLimitLocations: 5,
      configsWithoutLimit: 1,
    },
    {
      env: 'prod',
      hosts: 2,
      configs: 3,
      locations: 600,
      noLimitLocations: 0,
      configsWithoutLimit: 0,
    },
  ],
  byHost: [
    {
      host: 'ORNTST01',
      env: 'test',
      site: '',
      services: ['customers', 'elle'],
      serverNames: ['api.ornek.invalid'],
      etiket: { mod: 'ekle', etiketler: ['elle'], oto: ['customers'] },
      configs: 3,
      locations: 300,
      noLimitLocations: 5,
    },
    {
      host: 'ORNPRD01',
      env: 'prod',
      site: 'Ankara',
      services: [],
      serverNames: [],
      etiket: null,
      configs: 3,
      locations: 300,
      noLimitLocations: 0,
    },
  ],
  byConfig: [
    konfig('odeme.conf'),
    konfig('kart.conf', {
      envs: { test: hucre(2, 4) },
      missingEnvs: ['prod'],
      hostInconsistent: true,
      envInconsistent: true,
    }),
    konfig('acik.conf', { noLimitEverywhere: true }),
    // Her biri TEK bulgulu: "Sadece sorunlular" her kosulu ayri ayri tanimali.
    konfig('sunucu.conf', { hostInconsistent: true }),
    konfig('ortam.conf', { envInconsistent: true }),
    konfig('eksik.conf', { missingEnvs: ['prod'], envs: { test: hucre(3, 3) } }),
  ],
  noLimitConfigs: ['acik.conf'],
  ...ek,
});

beforeEach(() => {
  denetim.nginxApi.mockReset().mockResolvedValue(veri());
  csv.mockReset();
});

const sekme = (ad: string) => fireEvent.click(screen.getByRole('button', { name: ad }));

describe('NginxApiEnvanteri', () => {
  it('sayaclar, ortama gore tablo ve CSV, rate limitsiz konfigurasyonlar', async () => {
    render(<NginxApiEnvanteri />);
    expect(await screen.findByText('Ortama göre')).toBeTruthy();
    expect(screen.getByText('1.200')).toBeTruthy();
    expect(screen.getByTitle(/Hiçbir location'ında/).getAttribute('style')).toContain(
      '--status-warning-bg',
    );
    expect(screen.getByText('2026-11-25')).toBeTruthy();
    const test = screen.getByText('test', { selector: 'span' }).closest('tr') as HTMLElement;
    expect(within(test).getByText('600')).toBeTruthy();
    const prod = screen.getByText('prod', { selector: 'span' }).closest('tr') as HTMLElement;
    expect(within(prod).getAllByText('0')).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: 'CSV' }));
    expect(csv).toHaveBeenCalledWith(
      'nginx_api_ortam',
      expect.arrayContaining(['ortam', 'limitsiz_konfig']),
      [
        ['test', 2, 3, 600, 5, 1],
        ['prod', 2, 3, 600, 0, 0],
      ],
    );
    // Ortam gorunumunde karsilastirma tablosu yok: acik.conf yalniz limitsiz panelinde.
    expect(screen.getByText('Rate limit tanımı olmayan konfigürasyonlar')).toBeTruthy();
    expect(screen.getByText('acik.conf')).toBeTruthy();
  });

  it('sunucuya gore: servis, elle etiket, server_name ipucu, lokasyon, CSV', async () => {
    render(<NginxApiEnvanteri />);
    await screen.findByText('Ortama göre');
    sekme('Sunucuya Göre');
    expect(screen.getByText('Sunucuya göre')).toBeTruthy();
    expect(screen.getByTitle('server_name: api.ornek.invalid')).toBeTruthy();
    expect(screen.getByTitle('Elle etiket (Nginx Hub › Envanter)').textContent).toBe('elle');
    expect(screen.getByText('customers').getAttribute('title')).toBeNull();
    expect(screen.getByTitle(/nginx_audit \(nginx -T\) verisi yok/).textContent).toBe('—');
    expect(screen.getByText('Ankara')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'CSV' }));
    expect(csv.mock.calls[0][0]).toBe('nginx_api_sunucu');
    expect(csv.mock.calls[0][2]).toEqual([
      ['ORNTST01', 'customers elle', 'test', '', 3, 300, 5],
      ['ORNPRD01', '', 'prod', 'Ankara', 3, 300, 0],
    ]);
  });

  it('konfigurasyon karsilastirma: hucreler, bulgular, arama, sorunlular, kirilim, CSV', async () => {
    render(<NginxApiEnvanteri />);
    await screen.findByText('Ortama göre');
    sekme('Konfigürasyon Karşılaştırma');
    expect(screen.getByText('6 konfigürasyon gösteriliyor.')).toBeTruthy();
    const kart = screen.getByText('kart.conf').closest('tr') as HTMLElement;
    expect(within(kart).getByText('2–4')).toBeTruthy();
    expect(within(kart).getByText('—')).toBeTruthy();
    expect(within(kart).getByText('eksik: prod')).toBeTruthy();
    expect(within(kart).getByText('ortam farkı')).toBeTruthy();
    expect(within(kart).getByText('sunucu farkı')).toBeTruthy();
    expect(within(kart).getByTitle('2 sunucu · toplam 6 location')).toBeTruthy();
    const acik = screen.getByText('acik.conf', { selector: 'td' }).closest('tr') as HTMLElement;
    expect(within(acik).getByText('limitsiz')).toBeTruthy();

    // Satira tiklayinca sunucu kirilimi.
    fireEvent.click(screen.getByText('odeme.conf'));
    expect(screen.getByText('Sunucu kırılımı — odeme.conf')).toBeTruthy();
    expect(screen.getByTitle('prod · Ankara · 1 limitsiz location')).toBeTruthy();
    expect(screen.getByTitle('test · 0 limitsiz location')).toBeTruthy();
    fireEvent.click(screen.getByText('odeme.conf'));
    expect(screen.queryByText('Sunucu kırılımı — odeme.conf')).toBeNull();

    fireEvent.click(screen.getByLabelText('Sadece sorunlular'));
    expect(screen.getByText('5 konfigürasyon gösteriliyor.')).toBeTruthy();
    expect(screen.queryByText('odeme.conf')).toBeNull();
    for (const k of ['sunucu.conf', 'ortam.conf', 'eksik.conf'])
      expect(screen.getByText(k)).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText('konfigürasyon ara'), {
      target: { value: ' KART ' },
    });
    expect(screen.getByText('1 konfigürasyon gösteriliyor.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'CSV' }));
    expect(csv).toHaveBeenCalledWith(
      'nginx_api_konfigurasyon',
      ['konfigurasyon', 'test', 'prod', 'eksik_ortam', 'ortam_farki', 'sunucu_farki', 'limitsiz'],
      [['kart.conf', 4, '', 'prod', 'EVET', 'EVET', '']],
    );
    fireEvent.click(screen.getByLabelText('Sadece sorunlular'));
    fireEvent.change(screen.getByPlaceholderText('konfigürasyon ara'), { target: { value: '' } });
    expect(screen.getByText('6 konfigürasyon gösteriliyor.')).toBeTruthy();
  });

  it('API bazli ve internete acma sekmeleri; yenile; tarama ani', async () => {
    denetim.nginxApi.mockResolvedValueOnce(
      veri({ scannedAt: '2026-11-25T08:30:00Z', noLimitConfigs: [] }),
    );
    render(<NginxApiEnvanteri />);
    await screen.findByText('Ortama göre');
    expect(screen.queryByText('Rate limit tanımı olmayan konfigürasyonlar')).toBeNull();
    expect(screen.queryByText('2026-11-25')).toBeNull();
    sekme('API Bazlı');
    expect(screen.getByText('api bazli ekran')).toBeTruthy();
    expect(screen.queryByText('Ortama göre')).toBeNull();
    sekme('İnternete Açma');
    expect(screen.getByText('internete acma ekrani')).toBeTruthy();
    denetim.nginxApi.mockResolvedValueOnce(
      veri({
        totals: {
          hosts: 1,
          configs: 1,
          locations: 7,
          noLimitLocations: 0,
          configsWithoutLimit: 0,
          inconsistentConfigs: 0,
        },
      }),
    );
    fireEvent.click(screen.getByRole('button', { name: /Yenile/ }));
    await waitFor(() => expect(denetim.nginxApi).toHaveBeenCalledTimes(2));
    expect(denetim.nginxApi).toHaveBeenLastCalledWith(undefined);
    expect(await screen.findByText('7')).toBeTruthy();
    expect(screen.getByTitle(/Hiçbir location'ında/).getAttribute('style')).not.toContain(
      '--status-warning',
    );
  });

  it('yukleme hatasi ve tarama yok; yenilemede hata', async () => {
    denetim.nginxApi.mockResolvedValueOnce({ ok: false, message: 'Tablo yok' });
    const a = render(<NginxApiEnvanteri />);
    expect(await screen.findByText('Tablo yok')).toBeTruthy();
    a.unmount();
    denetim.nginxApi.mockResolvedValueOnce({ ok: false });
    const b = render(<NginxApiEnvanteri />);
    expect(await screen.findByText('Veri alınamadı.')).toBeTruthy();
    b.unmount();
    denetim.nginxApi.mockRejectedValueOnce(new Error('ag'));
    const c = render(<NginxApiEnvanteri />);
    expect(await screen.findByText('ag')).toBeTruthy();
    c.unmount();
    denetim.nginxApi.mockResolvedValueOnce(veri({ scanDate: null }));
    const d = render(<NginxApiEnvanteri />);
    expect(await screen.findByText('Henüz tarama kaydı yok')).toBeTruthy();
    d.unmount();

    render(<NginxApiEnvanteri />);
    await screen.findByText('Ortama göre');
    denetim.nginxApi.mockResolvedValueOnce({ ok: false, message: 'yenileme reddedildi' });
    fireEvent.click(screen.getByRole('button', { name: /Yenile/ }));
    expect(await screen.findByText('yenileme reddedildi')).toBeTruthy();
  });

  it('yenilemede istisna', async () => {
    render(<NginxApiEnvanteri />);
    await screen.findByText('Ortama göre');
    denetim.nginxApi.mockRejectedValueOnce('zaman asimi');
    fireEvent.click(screen.getByRole('button', { name: /Yenile/ }));
    expect(await screen.findByText('zaman asimi')).toBeTruthy();
  });
});
