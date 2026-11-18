// src/components/denetim/__tests__/NginxHttp2.test.tsx
//
// Nginx Hub > Envanter > HTTP/2 (kullanıcı, 2026-11-18).
//   NH1 özet: açık sunucu / blok sayısı, ölçülmedi ayrı, kaynak çipleri; varsayılan yalnız açık olanlar
//   NH2 satır açılınca o sunucunun blokları yüklenir (dosya, server_name, listen, kaynak; kapalı / ölçülmedi)
//   NH3 kolon yok (yeni tarama gelmedi) -> "henüz yok" notu, boş tablo değil
//   NH4 Envanter sekmesi: ortam rozeti Envanter'deki sunucudan, büyük-küçük harf duyarsız; "Yenile"
//       HTTP/2 görünümünü de önbelleği atlayarak (fresh) yeniden okur
//   NH5 HTTP olmayan (stream/mail) blok "HTTP değil"; özet ayrıca sayar; varsayılan sunucu kaynağı
//   NH6 açık satırın bloklari: hata sonrası Yenile başarılıysa hata silinir, tablo gelir; yeniden
//       takılan görünüm (sekmeye dönüş) önbelleği atlamaz
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, within, waitFor } from '@testing-library/react';
import { render } from '@/test/test-utils';
import { NginxHttp2 } from '@/components/denetim/NginxHttp2';
import { NginxEnvanteri } from '@/components/denetim/NginxEnvanteri';
import type { NginxHttp2OzetResult, NginxInventoryResult, NginxInvHost } from '@/api/denetimApi';

const api = vi.hoisted(() => ({ ozet: vi.fn(), sunucu: vi.fn(), inv: vi.fn() }));
vi.mock('@/api/denetimApi', () => ({
  denetimApi: { nginxHttp2Ozet: api.ozet, nginxHttp2Sunucu: api.sunucu, nginxInventory: api.inv },
}));
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: { username: 'onur', role: 'Admin' } }),
}));

const k0 = { server: 0, listen: 0, http: 0, socket: 0, default: 0 };
const ozet = (): NginxHttp2OzetResult => ({
  ok: true,
  hazir: true,
  scanDate: '2026-11-18',
  hosts: [
    {
      host: 'GBNGXP01',
      toplam: 45,
      acik: 42,
      kapali: 3,
      olculmedi: 0,
      httpDisi: 0,
      kaynak: { ...k0, server: 40, socket: 2 },
    },
    {
      host: 'GBNGXT01',
      toplam: 6,
      acik: 5,
      kapali: 0,
      olculmedi: 1,
      httpDisi: 0,
      kaynak: { ...k0, listen: 5 },
    },
    { host: 'GBNGXA01', toplam: 7, acik: 0, kapali: 7, olculmedi: 0, httpDisi: 0, kaynak: k0 },
  ],
  totals: {
    hosts: 3,
    hostsAcik: 2,
    hostsOlculmedi: 1,
    bloklar: 58,
    acik: 47,
    kapali: 10,
    olculmedi: 1,
    httpDisi: 0,
    kaynak: { server: 40, listen: 5, http: 0, socket: 2, default: 0 },
  },
});

describe('NginxHttp2', () => {
  beforeEach(() => {
    api.ozet.mockReset().mockResolvedValue(ozet());
    api.sunucu.mockReset();
  });

  it('NH1 özet, ölçülmedi ayrı, kaynaklar; varsayılan yalnız açık olanlar', async () => {
    render(<NginxHttp2 ortamRozeti={() => null} />);
    const o = await screen.findByTestId('http2-ozet');
    expect(o.textContent).toMatch(/2\s*sunucuda\s*47\s*\/\s*58 server bloğunda HTTP\/2 açık/);
    expect(o.textContent).toMatch(/1 blok ölçülmedi \(1 sunucu\)/);
    const kaynaklar = screen.getByLabelText('HTTP/2 kaynakları');
    expect(within(kaynaklar).getByText('http2 on').parentElement!.textContent).toMatch(/40/);
    expect(within(kaynaklar).getByText('aynı soket').getAttribute('title')).toMatch(
      /aynı adres:port/,
    );
    expect(screen.queryByRole('button', { name: /GBNGXA01/ })).toBeNull();
    fireEvent.click(screen.getByLabelText('Yalnız HTTP/2 açık olanlar'));
    expect(screen.getByRole('button', { name: /GBNGXA01/ })).toBeTruthy();
    fireEvent.change(screen.getByLabelText('HTTP/2 sunucu ara'), { target: { value: 'ngxt' } });
    expect(screen.getAllByRole('button', { name: /^GBNGX/ }).map((b) => b.textContent)).toEqual([
      'GBNGXT01',
    ]);
  });

  it('NH2 satır açılınca bloklar yüklenir', async () => {
    api.sunucu.mockResolvedValue({
      ok: true,
      hazir: true,
      satirlar: [
        {
          confFile: '/usr/nginx/conf.d/glomo-PROD.conf',
          seq: 4,
          serverName: 'glomo.example',
          listen: '127.0.0.1:443 ssl',
          ssl: true,
          http2: true,
          kaynak: 'server',
        },
        {
          confFile: '/usr/nginx/conf.d/eski.conf',
          seq: 2,
          serverName: null,
          listen: '80',
          ssl: false,
          http2: null,
          kaynak: null,
        },
        {
          confFile: '/usr/nginx/nginx.conf',
          seq: 1,
          serverName: '_',
          listen: '8080',
          ssl: false,
          http2: false,
          kaynak: null,
        },
      ],
    });
    render(<NginxHttp2 ortamRozeti={() => null} />);
    const b = await screen.findByRole('button', { name: /GBNGXP01/ });
    fireEvent.click(b);
    expect(b.getAttribute('aria-expanded')).toBe('true');
    const t = await screen.findByTestId('http2-bloklar-GBNGXP01');
    expect(api.sunucu).toHaveBeenCalledWith('GBNGXP01', false);
    const satir = within(t).getAllByRole('row');
    expect(satir[1].textContent).toMatch(
      /glomo-PROD\.conf.*glomo\.example.*127\.0\.0\.1:443 ssl.*var.*HTTP\/2.*http2 on/,
    );
    expect(within(t).getByText('glomo-PROD.conf').getAttribute('title')).toBe(
      '/usr/nginx/conf.d/glomo-PROD.conf',
    );
    expect(satir[2].textContent).toMatch(/ölçülmedi/);
    expect(satir[3].textContent).toMatch(/kapalı/);
  });

  it('NH3 kolon yoksa "henüz yok" notu', async () => {
    api.ozet.mockResolvedValue({ ok: true, hazir: false, neden: 'kolon', scanDate: '2026-11-18' });
    render(<NginxHttp2 ortamRozeti={() => null} />);
    expect(await screen.findByText('HTTP/2 bilgisi henüz yok')).toBeTruthy();
    expect(screen.getByText(/HTTP\/2 bilgisini içermiyor/)).toBeTruthy();
    expect(screen.queryByTestId('http2-gorunum')).toBeNull();
  });

  it('NH4 Envanter sekmesi ortam rozetini Envanter sunucusundan alır', async () => {
    const h = (o: Partial<NginxInvHost>): NginxInvHost => ({
      hostname: 'H',
      fqdn: null,
      env: 'production',
      location: 'pendik',
      service: null,
      services: 'glomo',
      service_count: 1,
      domain: null,
      ip: null,
      subnet: null,
      os: 'RHEL 8',
      kernel: null,
      architecture: null,
      cpu: 4,
      memory: '16G',
      nginx_version: '1.24.0',
      nginx_user: 'www',
      nginx_prefix: null,
      config_count: 3,
      disk_usr_nginx: null,
      disk_web_log: null,
      source_last_update: null,
      metadata_version: 1,
      ...o,
    });
    const size = { totalGiB: 0, parsed: 0, unparsed: 0 };
    const inv: NginxInventoryResult = {
      ok: true,
      lastUpdate: null,
      totals: {
        hosts: 1,
        envs: 1,
        services: 1,
        servicesUnlisted: [],
        nginxVersions: 1,
        osVersions: 1,
        cpuTotal: 4,
        memory: size,
        diskNginx: size,
        diskWebLog: size,
      },
      byEnv: [],
      byService: [],
      versions: { nginx: [], os: [], kernel: [], architecture: [], metadata: [] },
      resources: {
        cpu: [],
        memory: [],
        diskNginx: [],
        diskWebLog: [],
        configCount: [],
        serviceCount: [],
      },
      other: { domain: [], subnet: [], nginxUser: [] },
      hosts: [h({ hostname: 'gbngxp01', envByName: 'PROD' })],
    };
    api.inv.mockResolvedValue(inv);
    render(<NginxEnvanteri />);
    fireEvent.click(await screen.findByRole('tab', { name: 'HTTP/2' }));
    const satir = (await screen.findByRole('button', { name: /GBNGXP01/ })).closest('tr')!;
    expect(within(satir).getByText('PROD')).toBeTruthy();
    const t01 = screen.getByRole('button', { name: /GBNGXT01/ }).closest('tr')!;
    expect(within(t01).getByText('—')).toBeTruthy();
    expect(api.ozet).toHaveBeenLastCalledWith(false);
    fireEvent.click(screen.getByRole('button', { name: /Yenile/ }));
    await waitFor(() => expect(api.ozet).toHaveBeenLastCalledWith(true));
    expect(api.inv).toHaveBeenCalledTimes(2);
  });

  it('NH5 HTTP olmayan blok ve varsayılan sunucu kaynağı', async () => {
    const o = ozet();
    o.totals!.httpDisi = 2;
    o.totals!.kaynak.default = 3;
    api.ozet.mockResolvedValue(o);
    api.sunucu.mockResolvedValue({
      ok: true,
      hazir: true,
      satirlar: [
        {
          confFile: '/usr/nginx/conf.d/h2c.conf',
          seq: 1,
          serverName: 'ic',
          listen: '80',
          ssl: false,
          http2: true,
          kaynak: 'default',
          httpDisi: null,
        },
        {
          confFile: '/usr/nginx/stream.d/tcp.conf',
          seq: 2,
          serverName: null,
          listen: '7443',
          ssl: false,
          http2: false,
          kaynak: null,
          httpDisi: 'stream',
        },
      ],
    });
    render(<NginxHttp2 ortamRozeti={() => null} />);
    expect((await screen.findByTestId('http2-ozet')).textContent).toMatch(
      /2 stream\/mail bloğu \(HTTP değil\)/,
    );
    const kaynaklar = screen.getByLabelText('HTTP/2 kaynakları');
    expect(within(kaynaklar).getByText('varsayılan sunucudan').getAttribute('title')).toMatch(
      /TLS’siz/,
    );
    fireEvent.click(screen.getByRole('button', { name: /GBNGXP01/ }));
    const t = await screen.findByTestId('http2-bloklar-GBNGXP01');
    const r = within(t).getAllByRole('row');
    expect(r[1].textContent).toMatch(/varsayılan sunucudan/);
    expect(r[2].textContent).toMatch(/HTTP değil \(stream\)/);
    expect(r[2].textContent).not.toMatch(/kapalı/);
  });

  it('NH6 Yenile sonrası eski hata silinir; yeniden takılınca önbellek atlanmaz', async () => {
    api.sunucu.mockRejectedValueOnce(new Error('ag hatasi')).mockResolvedValue({
      ok: true,
      hazir: true,
      satirlar: [
        {
          confFile: '/a.conf',
          seq: 1,
          serverName: 'a',
          listen: '443 ssl',
          ssl: true,
          http2: true,
          kaynak: 'server',
          httpDisi: null,
        },
      ],
    });
    const { rerender, unmount } = render(<NginxHttp2 ortamRozeti={() => null} yenile={0} />);
    fireEvent.click(await screen.findByRole('button', { name: /GBNGXP01/ }));
    expect(await screen.findByText(/Bloklar okunamadı: ag hatasi/)).toBeTruthy();
    rerender(<NginxHttp2 ortamRozeti={() => null} yenile={1} />);
    expect(await screen.findByTestId('http2-bloklar-GBNGXP01')).toBeTruthy();
    expect(screen.queryByText(/Bloklar okunamadı/)).toBeNull();
    expect(api.sunucu).toHaveBeenLastCalledWith('GBNGXP01', true);
    expect(api.ozet).toHaveBeenLastCalledWith(true);
    unmount();
    api.ozet.mockClear();
    render(<NginxHttp2 ortamRozeti={() => null} yenile={1} />);
    await screen.findByTestId('http2-ozet');
    expect(api.ozet).toHaveBeenLastCalledWith(false);
  });
});
