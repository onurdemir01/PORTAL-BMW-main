// src/components/denetim/__tests__/NginxUpstreamEnvanteri.test.tsx
//
// Nginx Hub > Upstream Envanteri (kullanıcı, 2026-11-19).
//   UU1 özet: bağlı / toplam, kullanılmayan, doğrudan adres; süzgeç (bağlı / bağlı değil) + ortam + arama
//   UU2 satır açılınca upstream'ler: tüm arka uçlar, ayar rozetleri, kullanan server_name · location,
//       kullanılmayan upstream, upstream'i atlayan location
//   UU3 tarama tam server listesini içermiyorsa uyarı + "tam liste değil" (tek arka uç sanılmaz)
//   UU4 ters arama: en az 2 karakter; sonuç tablosu; Yenile önbelleği atlar
//   UU5 veri yoksa "henüz yok" notu
//   UU6 taranamayan sunucu "bağlı değil" sayılmaz (ayrı süzgeç); location dışı kullanım; değişken hedef;
//       kesik arka uç listesi; sahibi bilinmeyen location'a ad uydurulmaz
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, within, waitFor } from '@testing-library/react';
import { render } from '@/test/test-utils';
import { NginxUpstreamEnvanteri } from '@/components/denetim/NginxUpstreamEnvanteri';
import type { NginxUpsOzetResult, NginxUpsDetayResult } from '@/api/denetimApi';

const api = vi.hoisted(() => ({ ozet: vi.fn(), sunucu: vi.fn(), ara: vi.fn() }));
vi.mock('@/api/denetimApi', () => ({
  denetimApi: {
    nginxUpstreamOzet: api.ozet,
    nginxUpstreamSunucu: api.sunucu,
    nginxUpstreamAra: api.ara,
  },
}));
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: { username: 'onur', role: 'Admin' } }),
}));

const host = (o: Partial<NonNullable<NginxUpsOzetResult['hosts']>[number]>) => ({
  host: 'H',
  ortam: 'TEST',
  durum: 'ok',
  upstream: 0,
  kullanilan: 0,
  kullanilmayan: 0,
  resolveYok: 0,
  keepaliveYok: 0,
  upstreamLocation: 0,
  dogrudanLocation: 0,
  degiskenLocation: 0,
  tanimsizLocation: 0,
  bagli: false,
  olculmedi: false,
  ...o,
});
const ozet = (o: Partial<NginxUpsOzetResult> = {}): NginxUpsOzetResult => ({
  ok: true,
  hazir: true,
  scanDate: '2026-11-19',
  serversOlculdu: true,
  hosts: [
    host({
      host: 'GBNGXP01',
      ortam: 'PROD',
      upstream: 3,
      kullanilan: 2,
      kullanilmayan: 1,
      upstreamLocation: 9,
      dogrudanLocation: 2,
      bagli: true,
    }),
    host({ host: 'GBNGXT01', upstream: 2, kullanilmayan: 2 }),
    host({ host: 'GBNGXT02', durum: 'fail' }),
  ],
  totals: {
    hosts: 3,
    bagli: 1,
    bagliDegil: 2,
    olculmedi: 0,
    degiskenLocation: 0,
    upstreamsiz: 1,
    upstream: 5,
    kullanilmayan: 3,
    dogrudanLocation: 2,
    tanimsizLocation: 0,
  },
  ...o,
});
const detay = (o: Partial<NginxUpsDetayResult> = {}): NginxUpsDetayResult => ({
  ok: true,
  hazir: true,
  serversOlculdu: true,
  upstreams: [
    {
      ad: 'glomo-prod',
      confFile: '/usr/nginx/conf.d/glomo-upstreams.conf',
      servers: ['glomo.apps.example:443 resolve', 'glomo2.apps.example:443 backup'],
      serversKesik: 0,
      sonServer: null,
      resolve: true,
      keepalive: true,
      zone: false,
      kullaniliyor: true,
      kullananlar: [
        { confFile: '/usr/nginx/conf.d/glomo.conf', serverName: 'glomo.example', location: '/api' },
      ],
    },
    {
      ad: 'eski-ups',
      confFile: '/usr/nginx/conf.d/x.conf',
      servers: ['10.0.0.9:8080'],
      serversKesik: 0,
      sonServer: null,
      resolve: false,
      keepalive: false,
      zone: false,
      kullaniliyor: false,
      kullananlar: [],
    },
  ],
  dogrudan: [
    {
      hedef: 'db.apps.example',
      tur: 'fqdn',
      kullananlar: [
        { confFile: '/usr/nginx/conf.d/glomo.conf', serverName: 'glomo.example', location: '/db' },
      ],
    },
  ],
  ...o,
});

describe('NginxUpstreamEnvanteri', () => {
  beforeEach(() => {
    api.ozet.mockReset().mockResolvedValue(ozet());
    api.sunucu.mockReset().mockResolvedValue(detay());
    api.ara.mockReset();
  });

  it('UU1 özet, süzgeç, ortam, arama', async () => {
    render(<NginxUpstreamEnvanteri />);
    const o = await screen.findByTestId('ups-ozet');
    expect(o.textContent).toMatch(/1\s*\/ 3 sunucu bir upstream’e bağlı/);
    expect(o.textContent).toMatch(/5 upstream tanımı · 3 kullanılmıyor/);
    expect(o.textContent).toMatch(/2 location upstream’i atlayıp doğrudan adrese gidiyor/);
    const satir = (h: string) => screen.getByRole('button', { name: new RegExp(h) }).closest('tr')!;
    expect(within(satir('GBNGXP01')).getByText('bağlı')).toBeTruthy();
    expect(within(satir('GBNGXT01')).getByText('tanımlı, kullanılmıyor')).toBeTruthy();
    expect(within(satir('GBNGXT02')).getByText('bağlı değil')).toBeTruthy();
    expect(within(satir('GBNGXT02')).getByText('tarama: fail')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Upstream’e bağlı/ }));
    expect(screen.getAllByRole('button', { name: /^GBNGX/ }).map((b) => b.textContent)).toEqual([
      'GBNGXP01',
    ]);
    fireEvent.click(screen.getByRole('button', { name: /Bağlı değil/ }));
    expect(screen.getAllByRole('button', { name: /^GBNGX/ }).map((b) => b.textContent)).toEqual([
      'GBNGXT01',
      'GBNGXT02',
    ]);
    fireEvent.change(screen.getByLabelText('Ortam'), { target: { value: 'PROD' } });
    expect(screen.getByText('Eşleşen sunucu yok.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Tümü/ }));
    fireEvent.change(screen.getByLabelText('Ortam'), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText('Upstream envanteri sunucu ara'), {
      target: { value: 't02' },
    });
    expect(screen.getAllByRole('button', { name: /^GBNGX/ }).map((b) => b.textContent)).toEqual([
      'GBNGXT02',
    ]);
  });

  it('UU2 satır açılınca upstream ayrıntısı', async () => {
    render(<NginxUpstreamEnvanteri />);
    fireEvent.click(await screen.findByRole('button', { name: /GBNGXP01/ }));
    const d = await screen.findByTestId('ups-detay-GBNGXP01');
    expect(api.sunucu).toHaveBeenCalledWith('GBNGXP01', false);
    const satirlar = within(d).getAllByRole('row');
    expect(satirlar[1].textContent).toMatch(/glomo-prod.*glomo-upstreams\.conf/);
    expect(satirlar[1].textContent).toMatch(
      /glomo\.apps\.example:443 resolve.*glomo2\.apps\.example:443 backup/,
    );
    expect(satirlar[1].textContent).toMatch(/resolve var.*keepalive var.*zone yok/);
    expect(satirlar[1].textContent).toMatch(/glomo\.example · \/api/);
    expect(satirlar[2].textContent).toMatch(/eski-ups.*10\.0\.0\.9:8080.*kullanılmıyor/);
    expect(within(d).getByText(/Upstream’i atlayan location’lar \(1\)/)).toBeTruthy();
    expect(within(d).getByText('db.apps.example').closest('tr')!.textContent).toMatch(
      /doğrudan adres.*glomo\.example · \/db/,
    );
  });

  it('UU3 tam liste yoksa uyarı ve "tam liste değil"', async () => {
    api.ozet.mockResolvedValue(ozet({ serversOlculdu: false }));
    api.sunucu.mockResolvedValue(
      detay({
        serversOlculdu: false,
        upstreams: [
          { ...detay().upstreams![0], servers: null, sonServer: 'glomo2.apps.example:443 backup' },
        ],
      }),
    );
    render(<NginxUpstreamEnvanteri />);
    expect(await screen.findByText('Arka uç listeleri eksik')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /GBNGXP01/ }));
    const d = await screen.findByTestId('ups-detay-GBNGXP01');
    expect(within(d).getByText(/glomo2\.apps\.example:443 backup/).textContent).toMatch(
      /tam liste değil/,
    );
  });

  it('UU4 ters arama ve Yenile', async () => {
    api.ara.mockResolvedValue({
      ok: true,
      hazir: true,
      ara: 'glomo2',
      serversOlculdu: true,
      satirlar: [
        {
          host: 'GBNGXP01',
          upstream: 'glomo-prod',
          eslesen: ['glomo2.apps.example:443'],
          adEsler: false,
          tamListe: true,
          kullaniliyor: true,
        },
        {
          host: 'GBNGXP02',
          upstream: 'glomo2-ups',
          eslesen: [],
          adEsler: true,
          tamListe: true,
          kullaniliyor: false,
        },
      ],
    });
    render(<NginxUpstreamEnvanteri />);
    await screen.findByTestId('ups-ozet');
    const kutu = screen.getByLabelText('Arka uç adresi ya da upstream adı');
    fireEvent.change(kutu, { target: { value: 'g' } });
    fireEvent.click(screen.getByRole('button', { name: 'Ara' }));
    expect(await screen.findByText('En az 2 karakter yazın.')).toBeTruthy();
    expect(api.ara).not.toHaveBeenCalled();
    fireEvent.change(kutu, { target: { value: 'glomo2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Ara' }));
    const tablo = await screen.findByTestId('ups-arama-tablo');
    expect(api.ara).toHaveBeenCalledWith('glomo2', false);
    expect(screen.getByTestId('ups-arama-ozet').textContent).toMatch(/2 sunucu, 2 upstream/);
    const r = within(tablo).getAllByRole('row');
    expect(r[1].textContent).toMatch(/GBNGXP01.*glomo-prod.*glomo2\.apps\.example:443.*evet/);
    expect(r[2].textContent).toMatch(/GBNGXP02.*glomo2-ups.*upstream adı eşleşti.*kullanılmıyor/);
    expect(api.ozet).toHaveBeenLastCalledWith(false);
    fireEvent.click(screen.getByRole('button', { name: /Yenile/ }));
    await waitFor(() => expect(api.ozet).toHaveBeenLastCalledWith(true));
    // Yenile sonrasi acilan satir ve arama da onbellegi atlar (yeni taramayi gorsun)
    fireEvent.click(screen.getByRole('button', { name: /GBNGXP01/ }));
    await screen.findByTestId('ups-detay-GBNGXP01');
    expect(api.sunucu).toHaveBeenLastCalledWith('GBNGXP01', true);
    fireEvent.click(screen.getByRole('button', { name: 'Ara' }));
    await waitFor(() => expect(api.ara).toHaveBeenLastCalledWith('glomo2', true));
  });

  it('UU5 veri yoksa not', async () => {
    api.ozet.mockResolvedValue({ ok: true, hazir: false, neden: 'tarama' });
    render(<NginxUpstreamEnvanteri />);
    expect(await screen.findByText('Upstream envanteri henüz yok')).toBeTruthy();
    expect(screen.queryByTestId('ups-gorunum')).toBeNull();
  });

  it('UU6 taranamayan, location dışı, değişken, kesik, sahibi bilinmeyen', async () => {
    const o = ozet();
    o.hosts = [...o.hosts!, host({ host: 'GBNGXT09', durum: 'fail', olculmedi: true })];
    o.totals = { ...o.totals!, hosts: 4, bagliDegil: 2, olculmedi: 1, degiskenLocation: 3 };
    api.ozet.mockResolvedValue(o);
    api.sunucu.mockResolvedValue(
      detay({
        upstreams: [
          {
            ...detay().upstreams![0],
            servers: ['s1:443', 's2:443'],
            serversKesik: 5,
            kullananlar: [{ confFile: '/usr/nginx/snip/x.conf', serverName: null, location: '/s' }],
          },
          { ...detay().upstreams![1], ad: 'tcp-up', kullaniliyor: true, kullananlar: [] },
        ],
        dogrudan: [
          {
            hedef: '$be',
            tur: 'variable',
            kullananlar: [{ confFile: '/a', serverName: 'a.example', location: '/v' }],
          },
        ],
      }),
    );
    render(<NginxUpstreamEnvanteri />);
    expect((await screen.findByTestId('ups-ozet')).textContent).toMatch(
      /3 location değişken hedefe gidiyor/,
    );
    const t09 = screen.getByRole('button', { name: /GBNGXT09/ }).closest('tr')!;
    expect(within(t09).getByText('taranamadı')).toBeTruthy();
    expect(within(t09).queryByText('bağlı değil')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Taranamadı/ }));
    expect(screen.getAllByRole('button', { name: /^GBNGX/ }).map((b) => b.textContent)).toEqual([
      'GBNGXT09',
    ]);
    fireEvent.click(screen.getByRole('button', { name: /Bağlı değil/ }));
    expect(screen.getAllByRole('button', { name: /^GBNGX/ }).map((b) => b.textContent)).toEqual([
      'GBNGXT01',
      'GBNGXT02',
    ]);
    fireEvent.click(screen.getByRole('button', { name: /Tümü/ }));
    fireEvent.click(screen.getByRole('button', { name: /GBNGXP01/ }));
    const d = await screen.findByTestId('ups-detay-GBNGXP01');
    expect(within(d).getByText(/\+5 satır daha \(kayıt sınırı\)/)).toBeTruthy();
    expect(within(d).getByText('(server bilinmiyor)')).toBeTruthy();
    expect(within(d).getByText('kullanılıyor (location dışı)')).toBeTruthy();
    expect(within(d).getByText('$be').closest('tr')!.textContent).toMatch(/değişken hedef/);
  });
});
