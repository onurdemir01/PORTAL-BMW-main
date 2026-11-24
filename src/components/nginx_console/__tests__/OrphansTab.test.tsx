// @vitest-environment jsdom
// Nginx Hub > Kullanilmayan dosyalar sekmesi (2026-11-24, kapsam PR-2; dal %6): yukleme hatasi + tekrar dene, ozet
// kutulari ve tur suzgeci, arama (yol / CN), belirlenemeyen sunucu, satir acma ve ayrinti bolumleri (sertifika gun
// rozetleri, bos bolum metinleri), sunucuya git, CSV, Admin karantina akisi (plan / uygula, secim temizlenir, hata),
// Admin olmayana secim kutusu yok, bos sonuc metinleri.
import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NcOrphansResult } from '@/api/nginxConsoleApi';

const api = vi.hoisted(() => ({ orphans: vi.fn(), orphansCleanup: vi.fn() }));
vi.mock('@/api/nginxConsoleApi', () => ({ nginxConsoleApi: api }));

import { OrphansTab } from '../OrphansTab';

const veri = (ek: Partial<NcOrphansResult> = {}): NcOrphansResult => ({
  ok: true,
  summary: {
    hostsScanned: 3,
    hostsUnknown: 1,
    unloaded: 1,
    backups: 1,
    certs: 3,
    ssl: 1,
    generatedAt: '2026-11-24T08:00:00Z',
  },
  hosts: [
    {
      host: 'ORNGXP01',
      known: true,
      reason: null,
      unloaded: [
        {
          path: '/usr/nginx/conf.d/eski.conf',
          size: 2048,
          mtime: '2026-10-01T10:00:00Z',
          owner: 'nginx',
        },
      ],
      backups: [{ path: '/usr/nginx/conf.d/a.conf_123', size: 3 * 1024 * 1024, mtime: null }],
      certs: [
        {
          path: '/usr/nginx/ssl/kart.crt',
          exists: true,
          cn: 'kart.ornek.invalid',
          issuerCn: null,
          notAfter: '2026-12-01T00:00:00Z',
          daysLeft: 7,
          usedBy: ['/usr/nginx/conf.d/eski.conf'],
        },
        {
          path: '/usr/nginx/ssl/eski.crt',
          exists: true,
          cn: null,
          issuerCn: null,
          notAfter: null,
          daysLeft: -3,
          usedBy: [],
        },
        {
          path: '/usr/nginx/ssl/yok.crt',
          exists: false,
          cn: null,
          issuerCn: null,
          notAfter: null,
          daysLeft: null,
          usedBy: [],
        },
      ],
      ssl: [
        {
          path: '/usr/nginx/ssl/sahipsiz.key',
          size: 512,
          mtime: '2026-09-01T10:00:00Z',
          isKey: true,
        },
      ],
    },
    {
      host: 'ORNGXP02',
      known: true,
      reason: null,
      unloaded: [],
      backups: [],
      certs: [
        {
          path: '/usr/nginx/ssl/uzun.crt',
          exists: true,
          cn: 'uzun.ornek.invalid',
          issuerCn: null,
          notAfter: null,
          daysLeft: 200,
          usedBy: [],
        },
      ],
      ssl: [],
    },
    {
      host: 'ORNGXP03',
      known: false,
      reason: 'eski dokum',
      unloaded: [],
      backups: [],
      certs: [],
      ssl: [],
    },
  ],
  ...ek,
});

beforeEach(() => {
  api.orphans.mockReset();
  api.orphansCleanup.mockReset();
  api.orphans.mockResolvedValue(veri());
});

const satir = (host: string) =>
  screen.getByRole('button', { name: host.toLowerCase() }).closest('tr') as HTMLElement;

describe('OrphansTab', () => {
  it('yukleme hatasi ve tekrar dene; reddedilen yanit mesaji', async () => {
    api.orphans.mockRejectedValueOnce(new Error('dokum okunamadi'));
    render(<OrphansTab onOpen={vi.fn()} />);
    expect(await screen.findByText('Kullanılmayan dosyalar okunamadı')).toBeTruthy();
    expect(screen.getByText('dokum okunamadi')).toBeTruthy();
    api.orphans.mockResolvedValueOnce({ ok: false, message: 'Tablo yok' });
    fireEvent.click(screen.getByRole('button', { name: /Tekrar dene/i }));
    expect(await screen.findByText('Tablo yok')).toBeTruthy();
  });

  it('ozet, tur suzgeci, arama ve belirlenemeyen sunucu', async () => {
    const ac = vi.fn();
    render(<OrphansTab onOpen={ac} />);
    expect(await screen.findByText('3 sunucu')).toBeTruthy();
    expect(within(satir('ORNGXP03')).getByText('eski dokum')).toBeTruthy();
    expect(within(satir('ORNGXP03')).getAllByText('—')).toHaveLength(4);
    fireEvent.click(screen.getByText("nginx'in yüklemediği conf").closest('button') as HTMLElement);
    expect(screen.getByText('1 sunucu')).toBeTruthy();
    fireEvent.click(screen.getByText('kullanılmayan sertifika').closest('button') as HTMLElement);
    expect(screen.getByText('2 sunucu')).toBeTruthy();
    fireEvent.click(
      screen.getByText('belirlenemedi (eski dokum)').closest('button') as HTMLElement,
    );
    expect(screen.getByText('1 sunucu')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'orngxp03' })).toBeTruthy();
    for (const l of ['yedek / eski kopya', 'referanssız ssl/ dosyası', 'taranan sunucu']) {
      fireEvent.click(screen.getByText(l).closest('button') as HTMLElement);
    }
    expect(screen.getByText('3 sunucu'), 'taranan sunucu kutusu tumunu gostermeli').toBeTruthy();
    fireEvent.change(screen.getByLabelText('Dosya ya da sunucu ara'), {
      target: { value: 'UZUN.ornek' },
    });
    expect(screen.getByText('1 sunucu')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Dosya ya da sunucu ara'), {
      target: { value: 'hicbiri' },
    });
    expect(screen.getByText('Süzgeçle eşleşen sunucu yok.')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Dosya ya da sunucu ara'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'orngxp01' }));
    expect(ac).toHaveBeenCalledWith('ORNGXP01');
    expect(
      screen.queryByText(/nginx'in yüklemediği conf dosyaları/),
      'sunucuya git satiri acti',
    ).toBeNull();
  });

  it('satir ayrintisi: bolumler, sertifika rozetleri, bos bolum metinleri; Admin olmayana secim yok', async () => {
    render(<OrphansTab onOpen={vi.fn()} />);
    await screen.findByText('3 sunucu');
    fireEvent.click(satir('ORNGXP01'));
    expect(screen.getByText("nginx'in yüklemediği conf dosyaları (1)")).toBeTruthy();
    expect(screen.getByText('2 KB')).toBeTruthy();
    expect(screen.getByText('3.0 MB')).toBeTruthy();
    expect(screen.getByText('512 B')).toBeTruthy();
    expect(screen.getByText('2026-10-01')).toBeTruthy();
    expect(screen.getByText('anahtar')).toBeTruthy();
    expect(screen.getByText('7 gün')).toBeTruthy();
    expect(screen.getByText('3 gün önce doldu')).toBeTruthy();
    expect(screen.getByText('dosya yok')).toBeTruthy();
    expect(screen.getByText('DOSYA YOK')).toBeTruthy();
    expect(screen.getByText('eski.crt')).toBeTruthy();
    expect(screen.getByText(/yalnız yüklenmeyen dosyada:/).textContent).toContain('eski.conf');
    expect(screen.getAllByText('hiçbir conf referans vermiyor').length).toBe(2);
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
    expect(screen.queryByText('Önce planla')).toBeNull();
    fireEvent.click(satir('ORNGXP01'));
    expect(screen.queryByText("nginx'in yüklemediği conf dosyaları (1)")).toBeNull();
    fireEvent.click(satir('ORNGXP02'));
    expect(screen.getByText('Yüklenmeyen dosya yok.')).toBeTruthy();
    expect(screen.getByText('Yedek dosya yok.')).toBeTruthy();
    expect(screen.getByText('ssl/ altında referanssız dosya yok.')).toBeTruthy();
    expect(screen.getByText('200 gün')).toBeTruthy();
    // Belirlenemeyen sunucu acilmaz (ayrinti yok).
    fireEvent.click(satir('ORNGXP03'));
    expect(screen.getAllByText(/yüklemediği conf dosyaları/)).toHaveLength(1);
  });

  it('Admin karantina: plan ve uygula, secim temizlenir, hata gosterilir', async () => {
    api.orphansCleanup
      .mockResolvedValueOnce({ ok: true, job: { jobId: 901 } })
      .mockResolvedValueOnce({ ok: true, job: { jobId: 902 } })
      .mockResolvedValueOnce({ ok: false, message: 'Kayit yok' })
      .mockRejectedValueOnce(new Error('ag koptu'));
    render(<OrphansTab onOpen={vi.fn()} isAdmin />);
    await screen.findByText('3 sunucu');
    fireEvent.click(satir('ORNGXP01'));
    const planla = screen.getByRole('button', { name: 'Önce planla' }) as HTMLButtonElement;
    expect(planla.disabled).toBe(true);
    expect(screen.getByText('Karantinaya almak için dosya seçin')).toBeTruthy();
    const kutular = screen.getAllByRole('checkbox');
    // yuklenmeyen + yedek + 2 var olan sertifika + ssl; dosyasi olmayan sertifika secilemez
    expect(kutular).toHaveLength(5);
    fireEvent.click(kutular[0]);
    fireEvent.click(kutular[2]);
    fireEvent.click(kutular[2]);
    fireEvent.click(kutular[4]);
    expect(screen.getByText('2 dosya seçili')).toBeTruthy();
    fireEvent.click(planla);
    await waitFor(() =>
      expect(api.orphansCleanup).toHaveBeenCalledWith({
        host: 'ORNGXP01',
        paths: ['/usr/nginx/conf.d/eski.conf', '/usr/nginx/ssl/sahipsiz.key'],
        mode: 'plan',
      }),
    );
    expect(await screen.findByText(/2 dosya için PLAN işi başlatıldı \(job 901\)/)).toBeTruthy();
    expect(screen.getByText('2 dosya seçili'), 'plan secimi temizlememeli').toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Karantinaya al' }));
    expect(await screen.findByText(/karantinaya alınıyor \(job 902\)/)).toBeTruthy();
    expect(screen.getByText('Karantinaya almak için dosya seçin')).toBeTruthy();
    fireEvent.click(screen.getAllByRole('checkbox')[1]);
    fireEvent.click(screen.getByRole('button', { name: 'Önce planla' }));
    expect(await screen.findByText('Kayit yok')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Önce planla' }));
    expect(await screen.findByText('ag koptu')).toBeTruthy();
  });

  it('CSV disa aktarimi tum turleri tasir; dokum yoksa bos metin', async () => {
    const urlOlustur = vi.fn((_b: Blob | MediaSource) => 'blob:x');
    Object.assign(URL, { createObjectURL: urlOlustur });
    const tikla = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    render(<OrphansTab onOpen={vi.fn()} />);
    await screen.findByText('3 sunucu');
    fireEvent.click(screen.getByRole('button', { name: 'CSV' }));
    const metin = await (urlOlustur.mock.calls[0][0] as Blob).text();
    expect(metin).toContain('"ORNGXP01";"yuklenmeyen_conf";"/usr/nginx/conf.d/eski.conf";"2048"');
    expect(metin).toContain('"yedek"');
    expect(metin).toContain(
      '"kullanilmayan_sertifika";"/usr/nginx/ssl/kart.crt";"";"2026-12-01";"kart.ornek.invalid yalniz: /usr/nginx/conf.d/eski.conf"',
    );
    expect(metin).toContain('hic referans yok');
    expect(metin).toContain('"referanssiz_anahtar"');
    expect(tikla).toHaveBeenCalled();
    tikla.mockRestore();
  });

  it('henuz dokum yoksa yonlendirme', async () => {
    api.orphans.mockResolvedValueOnce(
      veri({
        hosts: [],
        summary: {
          hostsScanned: 0,
          hostsUnknown: 0,
          unloaded: 0,
          backups: 0,
          certs: 0,
          ssl: 0,
          generatedAt: '',
        },
      }),
    );
    render(<OrphansTab onOpen={vi.fn()} />);
    expect(await screen.findByText('Henüz dokum yok.')).toBeTruthy();
    expect(screen.getByText('Instances sekmesinden sunucuları yenileyin.')).toBeTruthy();
  });
});
