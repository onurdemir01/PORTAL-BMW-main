// @vitest-environment jsdom
// Denetim > Nginx > API'yi internete ac (2026-11-26, kapsam PR-2; %0): yukleme hatasi, tarama yok, yapilandirma eksik
// uyarisi (yonetici / kullanici), sayaclar, arama (API adi ve yol), satir acma (rate limit rozetleri), onay penceresi
// (iptal / basladi / reddedildi / istisna), kaynak sunucusu olmayan satir, yonetici job yapilandirmasi (zorunlu alanlar,
// kaydedildi -> yeniden yukleme, reddedildi, istisna, AWX sunucu listesi alinamadi).
import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const expose = vi.hoisted(() => ({ apis: vi.fn(), open: vi.fn(), saveConfig: vi.fn() }));
vi.mock('@/api/nginxExposeApi', () => ({ nginxExposeApi: expose }));
const ansible = vi.hoisted(() => ({ servers: vi.fn() }));
vi.mock('@/api/ansibleApi', () => ({ ansibleApi: ansible }));
const kim = vi.hoisted(() => ({ role: 'User' }));
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: { username: 'u', role: kim.role } }),
}));

import { NginxInternetExpose } from '../NginxInternetExpose';

const veri = (ek: Record<string, unknown> = {}) => ({
  ok: true,
  scanDate: '2026-11-25',
  hosts: ['ORNTST01', 'ORNTST02'],
  config: { awxServerId: 1, templateId: 412, targetHost: 'ORNINT01' },
  rows: [
    {
      configFile: 'odeme.conf',
      api: 'odeme',
      hosts: ['ORNTST01', 'ORNTST02'],
      locations: [
        { path: '/odeme/v1', ipRateLimit: '10r/s', serverRateLimit: null },
        { path: '/odeme/v2', ipRateLimit: null, serverRateLimit: '100r/s' },
        { path: '/odeme/saglik', ipRateLimit: null, serverRateLimit: null },
      ],
    },
    {
      configFile: 'kart.conf',
      api: 'kart',
      hosts: ['ORNTST02'],
      locations: [{ path: '/kart/limit', ipRateLimit: null, serverRateLimit: null }],
    },
    { configFile: 'yetim.conf', api: 'yetim', hosts: [], locations: [] },
  ],
  ...ek,
});

beforeEach(() => {
  kim.role = 'User';
  expose.apis.mockReset().mockResolvedValue(veri());
  expose.open.mockReset();
  expose.saveConfig.mockReset();
  ansible.servers.mockReset().mockResolvedValue({
    ok: true,
    servers: [
      { id: 1, name: 'AWX ana', configured: true },
      { id: 2, name: 'AWX yedek', configured: false },
    ],
  });
});

const satir = (dosya: string) => screen.getByText(dosya).closest('tr') as HTMLElement;

describe('NginxInternetExpose', () => {
  it('sayaclar, arama, satir acma ve rate limit rozetleri', async () => {
    render(<NginxInternetExpose />);
    expect(await screen.findByText("Test ortamındaki API'ler")).toBeTruthy();
    expect(screen.getByText('3 dosya gösteriliyor · tarama 2026-11-25')).toBeTruthy();
    // Kaynak sunucu sayaci + odeme satiri ayni ipucunu tasir.
    expect(screen.getAllByTitle('ORNTST01, ORNTST02')).toHaveLength(2);
    expect(screen.queryByText('Job yapılandırması (yönetici)')).toBeNull();
    expect(screen.queryByText(/yapılandırma eksik/)).toBeNull();
    expect(within(satir('odeme.conf')).getByText('+1')).toBeTruthy();
    expect(within(satir('yetim.conf')).getByText('—')).toBeTruthy();
    expect(
      (
        within(satir('yetim.conf')).getByRole('button', {
          name: /internete aç/,
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);

    fireEvent.click(screen.getByText('odeme.conf'));
    expect(screen.getByText('odeme.conf içindeki yollar')).toBeTruthy();
    expect(screen.getByText('IP: 10r/s')).toBeTruthy();
    expect(screen.getByText('location: 100r/s')).toBeTruthy();
    expect(screen.getAllByText('rate limit yok')).toHaveLength(1);
    fireEvent.click(screen.getByText('odeme.conf'));
    expect(screen.queryByText('odeme.conf içindeki yollar')).toBeNull();

    const ara = screen.getByPlaceholderText('API ya da yol ara');
    fireEvent.change(ara, { target: { value: 'KART' } });
    expect(screen.getByText('1 dosya gösteriliyor · tarama 2026-11-25')).toBeTruthy();
    // Yol uzerinden de bulunur.
    fireEvent.change(ara, { target: { value: '/odeme/saglik' } });
    expect(screen.getByText('odeme.conf')).toBeTruthy();
    expect(screen.queryByText('kart.conf')).toBeNull();
    fireEvent.change(ara, { target: { value: '  ' } });
    expect(screen.getByText('3 dosya gösteriliyor · tarama 2026-11-25')).toBeTruthy();

    expose.apis.mockResolvedValueOnce(veri({ rows: [] }));
    fireEvent.click(screen.getByRole('button', { name: /Yenile/ }));
    expect(await screen.findByText('0 dosya gösteriliyor · tarama 2026-11-25')).toBeTruthy();
  });

  it('onay penceresi: iptal, basladi, reddedildi, istisna', async () => {
    render(<NginxInternetExpose />);
    await screen.findByText('odeme.conf');
    const ac = () =>
      fireEvent.click(within(satir('odeme.conf')).getByRole('button', { name: /internete aç/ }));
    ac();
    const pencere = await screen.findByRole('dialog');
    expect(within(pencere).getByText('odeme · ORNTST01 → ORNINT01')).toBeTruthy();
    expect(within(pencere).getByText('/odeme/v2')).toBeTruthy();
    fireEvent.click(within(pencere).getByRole('button', { name: 'İptal' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    expose.open.mockResolvedValueOnce({ ok: true, job: { id: 77 }, targetHost: 'ORNINT01' });
    ac();
    fireEvent.click(await screen.findByRole('button', { name: 'Evet, internete aç' }));
    expect(
      await screen.findByText(/odeme için iş başlatıldı \(job 77\)\. Hedef: ORNINT01\./),
    ).toBeTruthy();
    expect(expose.open).toHaveBeenCalledWith('odeme', 'ORNTST01');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    expose.open.mockResolvedValueOnce({ ok: true });
    ac();
    fireEvent.click(await screen.findByRole('button', { name: 'Evet, internete aç' }));
    expect(await screen.findByText(/odeme için iş başlatıldı\. Hedef: —\./)).toBeTruthy();

    expose.open.mockResolvedValueOnce({ ok: false, message: 'include satiri yok' });
    ac();
    expect(screen.queryByText(/iş başlatıldı/)).toBeNull();
    fireEvent.click(await screen.findByRole('button', { name: 'Evet, internete aç' }));
    expect(await screen.findByText('include satiri yok')).toBeTruthy();

    expose.open.mockResolvedValueOnce({ ok: false });
    ac();
    fireEvent.click(await screen.findByRole('button', { name: 'Evet, internete aç' }));
    expect(await screen.findByText('İş başlatılamadı.')).toBeTruthy();

    expose.open.mockRejectedValueOnce(new Error('ag koptu'));
    ac();
    fireEvent.click(await screen.findByRole('button', { name: 'Evet, internete aç' }));
    expect(await screen.findByText('ag koptu')).toBeTruthy();
  });

  it('yukleme hatasi, tarama yok, yapilandirma eksik (kullanici)', async () => {
    expose.apis.mockResolvedValueOnce({ ok: false, message: 'Envanter okunamadi' });
    const a = render(<NginxInternetExpose />);
    expect(await screen.findByText('Envanter okunamadi')).toBeTruthy();
    a.unmount();
    expose.apis.mockResolvedValueOnce({ ok: false });
    const b = render(<NginxInternetExpose />);
    expect(await screen.findByText('Veri alınamadı.')).toBeTruthy();
    b.unmount();
    expose.apis.mockRejectedValueOnce(new Error('zaman asimi'));
    const c = render(<NginxInternetExpose />);
    expect(await screen.findByText('zaman asimi')).toBeTruthy();
    c.unmount();
    expose.apis.mockResolvedValueOnce(veri({ scanDate: null }));
    const d = render(<NginxInternetExpose />);
    expect(await screen.findByText('Henüz tarama kaydı yok')).toBeTruthy();
    d.unmount();
    expose.apis.mockResolvedValueOnce(
      veri({ config: { awxServerId: 1, templateId: 0, targetHost: 'ORNINT01' } }),
    );
    render(<NginxInternetExpose />);
    expect(await screen.findByText(/yapılandırma eksik/)).toBeTruthy();
    expect(screen.getByText(/Bu ayarı yalnızca/)).toBeTruthy();
  });

  it('yonetici: job yapilandirmasi kaydi (zorunlu alanlar, kaydedildi, reddedildi, istisna)', async () => {
    kim.role = 'Admin';
    expose.apis.mockResolvedValue(
      veri({ config: { awxServerId: 0, templateId: 0, targetHost: '' } }),
    );
    render(<NginxInternetExpose />);
    expect(await screen.findByText('Job yapılandırması (yönetici)')).toBeTruthy();
    expect(screen.getByText(/yapılandırma eksik/)).toBeTruthy();
    expect(screen.queryByText(/Bu ayarı yalnızca/)).toBeNull();
    expect(await screen.findByText('AWX yedek (yapılandırılmamış)')).toBeTruthy();
    expect(screen.getByText('hedef sunucu')).toBeTruthy();
    const kaydet = () => fireEvent.click(screen.getByRole('button', { name: 'Kaydet' }));
    kaydet();
    expect(screen.getByText('AWX sunucusu ve job template ID zorunlu.')).toBeTruthy();

    const tid = screen.getByPlaceholderText('örn. 412');
    fireEvent.change(tid, { target: { value: '4a1b2' } });
    expect((tid as HTMLInputElement).value).toBe('412');
    // Template dolu ama AWX sunucusu secilmemis: yine kaydedilmez.
    kaydet();
    expect(expose.saveConfig).not.toHaveBeenCalled();
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '1' } });
    const hedef = screen
      .getByText('Hedef sunucu')
      .parentElement?.querySelector('input') as HTMLInputElement;
    fireEvent.change(hedef, { target: { value: ' ORNINT01 ' } });
    expect(screen.getByText('ORNINT01', { selector: 'code' })).toBeTruthy();

    expose.saveConfig.mockResolvedValueOnce({ ok: false, message: 'Template bulunamadi' });
    kaydet();
    expect(await screen.findByText('Template bulunamadi')).toBeTruthy();
    expect(expose.saveConfig).toHaveBeenCalledWith({
      awxServerId: 1,
      templateId: 412,
      targetHost: 'ORNINT01',
    });
    expose.saveConfig.mockResolvedValueOnce({ ok: false });
    kaydet();
    expect(await screen.findByText('Kaydedilemedi.')).toBeTruthy();
    expose.saveConfig.mockRejectedValueOnce(new Error('403'));
    kaydet();
    expect(await screen.findByText('403')).toBeTruthy();

    const n = expose.apis.mock.calls.length;
    expose.saveConfig.mockResolvedValueOnce({ ok: true });
    kaydet();
    expect(await screen.findByText('Kaydedildi. Buton artık çalışır.')).toBeTruthy();
    await waitFor(() => expect(expose.apis.mock.calls.length).toBe(n + 1));
  });

  it('yonetici: AWX sunucu listesi alinamadi', async () => {
    kim.role = 'Admin';
    ansible.servers.mockRejectedValueOnce(new Error('x'));
    render(<NginxInternetExpose />);
    expect(await screen.findByText('AWX sunucu listesi alınamadı.')).toBeTruthy();
  });
});
