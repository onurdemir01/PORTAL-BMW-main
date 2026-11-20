// src/components/denetim/__tests__/NginxEnvanteriTamSurum.test.tsx
//
// Nginx Hub > Envanter: TAM sürüm gösterimi (kullanıcı, 2026-11-15: "sürümlerin tam tekmil yazmasını
// istiyorum ... plus'ların isimleri belli oluyordu, onları sakın görmezden gelme").
//   TS1 surumEtiketi: gerçek değer biçimlerinin hepsi (açık kaynak, nginx/ önekli, Plus ekli, yalnız Plus,
//       bilinmeyen, tanınmayan ek); anahtar yeniden çözülünce kendisini verir
//   TS2 sıralama: numaralı yeniden eskiye (aynı numarada Plus önce), numarasız Plus R'ye göre, bilinmeyen sonda
//   TS3 Ortamlar: nginx ve OS bölümleri lokasyonla aynı satır görünümü; Plus etiketi GÖRÜNÜR metin
//       (title/"*" değil); çoktan aza; tıklayınca Sunucular ortam+sürümle süzülür; uzun liste "+N daha"
//   TS4 Sürümler: her tam sürüm kendi satırı (Plus dahil), aile başlığı; "nginx/1.26.3" ile "1.26.3" tek satır
//   TS5 Sunucular: sürüm hücresi tam metin + Plus etiketi; ham değer title'da
//   TS6 Service'ler: sürüm rozetinde Plus etiketi görünür
//   TS7 Sunucular araması ekranda görünen metni ("Plus R31") de bulur, ham biçimi ("plus-r31") de
//   TS8 Sürümler: tek sürümlü aile başlığı sayıyı/yüzdeyi alttaki satırla iki kez yazmaz
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, within } from '@testing-library/react';
import { render } from '@/test/test-utils';
import {
  NginxEnvanteri,
  surumCoz,
  surumEtiketi,
  surumKarsilastir,
} from '@/components/denetim/NginxEnvanteri';
import type { NginxInventoryResult, NginxInvHost } from '@/api/denetimApi';

const api = vi.hoisted(() => ({ inv: vi.fn() }));
vi.mock('@/api/denetimApi', () => ({ denetimApi: { nginxInventory: api.inv } }));
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: { username: 'u', role: 'User' } }),
}));

const host = (o: Partial<NginxInvHost>): NginxInvHost => ({
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
  os: 'RHEL 8.10',
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
  envByName: 'PROD',
  ...o,
});
const size = { totalGiB: 0, parsed: 0, unparsed: 0 };
const HOSTS = [
  host({ hostname: 'GBNGXP01', nginx_version: 'nginx/1.25.3 (nginx-plus-r31-p1)' }),
  host({ hostname: 'GBNGXP02', nginx_version: '1.25.3 (nginx-plus-r31-p1)', location: 'ankara' }),
  host({ hostname: 'GBNGXP03', nginx_version: 'nginx-plus-r36-p4', os: 'RHEL 9.4' }),
  host({ hostname: 'GBNGXP04', nginx_version: '1.24.0' }),
  host({
    hostname: 'GBNGXQ01',
    envByName: 'QA',
    env: 'non-production',
    nginx_version: 'nginx/1.26.3',
  }),
  host({ hostname: 'GBNGXQ02', envByName: 'QA', env: 'non-production', nginx_version: '1.26.3' }),
  host({
    hostname: 'GBNGXQ03',
    envByName: 'QA',
    env: 'non-production',
    nginx_version: '1.25.1 (nginx-plus-r30)',
  }),
  host({
    hostname: 'GBNGXQ04',
    envByName: 'QA',
    env: 'non-production',
    nginx_version: 'nginx/1.29.3 (nginx-plus-r35)',
  }),
  host({
    hostname: 'GBNGXQ05',
    envByName: 'QA',
    env: 'non-production',
    nginx_version: 'nginx-plus-r35-p1',
  }),
  host({ hostname: 'GBNGXQ06', envByName: 'QA', env: 'non-production', nginx_version: '1.20.1' }),
  host({ hostname: 'GBNGXQ07', envByName: 'QA', env: 'non-production', nginx_version: '1.22.1' }),
  host({ hostname: 'GBNGXQ08', envByName: 'QA', env: 'non-production', nginx_version: 'unknown' }),
];
const dagilim = (vs: (string | null)[]) => {
  const m = new Map<string, number>();
  for (const v of vs) m.set(String(v), (m.get(String(v)) || 0) + 1);
  return [...m].map(([value, count]) => ({ value, count }));
};
const veri = (): NginxInventoryResult => ({
  ok: true,
  lastUpdate: '2026-11-15T06:30:00',
  totals: {
    hosts: HOSTS.length,
    envs: 2,
    services: 1,
    servicesUnlisted: [],
    nginxVersions: 10,
    osVersions: 2,
    cpuTotal: 48,
    memory: size,
    diskNginx: size,
    diskWebLog: size,
  },
  byEnv: [],
  byService: [
    { service: 'glomo', hosts: 2, envs: ['production'], hostnames: ['GBNGXP01', 'GBNGXP03'] },
  ],
  versions: {
    nginx: dagilim(HOSTS.map((h) => h.nginx_version)),
    os: dagilim(HOSTS.map((h) => h.os)),
    kernel: [],
    architecture: [],
    metadata: [],
  },
  resources: {
    cpu: [],
    memory: [],
    diskNginx: [],
    diskWebLog: [],
    configCount: [],
    serviceCount: [],
  },
  other: { domain: [], subnet: [], nginxUser: [] },
  hosts: HOSTS,
});

const satirAdlari = () =>
  screen
    .getAllByTestId('sunucu-satiri')
    .map((r) => r.querySelector('td')!.textContent!.trim().split(/\s/)[0]);
const ortamKarti = (ad: string) =>
  screen.getAllByTestId('ortam-karti').find((k) => k.querySelector('h3')!.textContent === ad)!;
/** Bir başlıktan sonraki ilk dağılım listesinin satırları (aynı grid'de kardeş). */
const bolumSatirlari = (baslik: HTMLElement) => {
  const ul = baslik.nextElementSibling as HTMLElement;
  return within(ul).getAllByTestId('dagilim-satiri');
};

describe('surumEtiketi / surumCoz', () => {
  it('TS1 gerçek değer biçimleri tam metne çevrilir; Plus adı düşmez', () => {
    const beklenen: [string, string][] = [
      ['1.24.0', '1.24.0'],
      ['nginx/1.26.3', '1.26.3'],
      ['1.25.1 (nginx-plus-r30)', '1.25.1 Plus R30'],
      ['nginx/1.29.3 (nginx-plus-r35)', '1.29.3 Plus R35'],
      ['nginx/1.25.3 (nginx-plus-r31-p1)', '1.25.3 Plus R31 p1'],
      ['nginx-plus-r36-p4', 'Plus R36 p4'],
      ['nginx-plus-r35-p1', 'Plus R35 p1'],
      ['NGINX-PLUS-R33', 'Plus R33'],
      ['1.2.3 (Ubuntu)', '1.2.3 (Ubuntu)'],
      ['1.25.3 (nginx-plus-r31-p1) build-7', '1.25.3 Plus R31 p1 build-7'],
      ['openresty', 'openresty'],
      ['unknown', 'bilinmiyor'],
      ['', 'bilinmiyor'],
    ];
    for (const [ham, tam] of beklenen) {
      expect(surumEtiketi(ham), ham).toBe(tam);
      // anahtar kararlı: tam metin yeniden çözülünce aynı
      if (tam !== 'bilinmiyor') expect(surumEtiketi(tam), tam).toBe(tam);
    }
    expect(surumCoz('nginx/1.25.3 (nginx-plus-r31-p1)')).toMatchObject({
      sayi: '1.25.3',
      plus: { r: 31, p: 1 },
      diger: '',
    });
    expect(surumCoz('nginx-plus-r36-p4')).toMatchObject({
      sayi: '',
      plus: { r: 36, p: 4 },
      diger: '',
    });
    expect(surumCoz('1.25.1 (nginx-plus-r30)').plus).toEqual({ r: 30, p: null });
    expect(surumCoz('surplus-r3').plus).toBeNull();
    expect(surumCoz('bilinmiyor').bilinmiyor).toBe(true);
  });

  it('TS2 sıralama: numaralı yeniden eskiye, numarasız Plus R yüksekten, tanınmayan, bilinmeyen', () => {
    expect(
      [
        'nginx-plus-r35-p1',
        '1.24.0',
        'unknown',
        'nginx-plus-r36-p4',
        '1.25.1',
        '1.25.1 (nginx-plus-r30)',
        'openresty',
        'nginx-plus-r35',
      ].sort(surumKarsilastir),
    ).toEqual([
      '1.25.1 (nginx-plus-r30)',
      '1.25.1',
      '1.24.0',
      'nginx-plus-r36-p4',
      'nginx-plus-r35-p1',
      'nginx-plus-r35',
      'openresty',
      'unknown',
    ]);
  });
});

describe('NginxEnvanteri — tam sürüm gösterimi', () => {
  beforeEach(() => {
    api.inv.mockReset().mockResolvedValue(veri());
  });

  it('TS3 Ortamlar: nginx/OS lokasyonla aynı satırlar, Plus görünür, tıklayınca süzer', async () => {
    render(<NginxEnvanteri />);
    await screen.findByTestId('filo-ozeti');
    const prod = ortamKarti('PROD');
    const nginx = within(prod).getByTestId('ortam-nginx');
    const satirlar = bolumSatirlari(nginx);
    // çoktan aza, eşitse yeniden eskiye; aynı sürümün iki yazımı tek satır
    expect(satirlar.map((s) => s.getAttribute('data-anahtar'))).toEqual([
      '1.25.3 Plus R31 p1',
      '1.24.0',
      'Plus R36 p4',
    ]);
    // Plus adı görünür metin (title değil)
    expect(within(satirlar[0]).getByTestId('plus-etiketi').textContent).toBe('Plus R31 p1');
    expect(satirlar[0].textContent).toContain('1.25.3 Plus R31 p1');
    expect(satirlar[0].textContent).not.toContain('*');
    expect(within(satirlar[2]).getByTestId('plus-etiketi').textContent).toBe('Plus R36 p4');
    // ham yazımlar title'da
    const dugme = within(satirlar[0]).getByRole('button');
    expect(dugme.getAttribute('title')).toContain(
      'ham: nginx/1.25.3 (nginx-plus-r31-p1), 1.25.3 (nginx-plus-r31-p1)',
    );
    // lokasyon ve OS aynı satır görünümünde
    expect(
      within(prod)
        .getAllByTestId('dagilim-satiri')
        .map((s) => s.getAttribute('data-anahtar')),
    ).toEqual([
      'pendik',
      'ankara',
      '1.25.3 Plus R31 p1',
      '1.24.0',
      'Plus R36 p4',
      'RHEL 8.10',
      'RHEL 9.4',
    ]);
    fireEvent.click(dugme);
    expect(satirAdlari()).toEqual(['GBNGXP01', 'GBNGXP02']);
    expect(
      within(screen.getByTestId('surum-suzgeci')).getByTestId('plus-etiketi').textContent,
    ).toBe('Plus R31 p1');
    // geri dönünce etkin süzgeç satırda vurgulu
    fireEvent.click(screen.getByRole('tab', { name: /Ortamlar/ }));
    const yeni = bolumSatirlari(within(ortamKarti('PROD')).getByTestId('ortam-nginx'));
    expect(within(yeni[0]).getByRole('button').getAttribute('aria-pressed')).toBe('true');
    expect(within(yeni[1]).getByRole('button').getAttribute('aria-pressed')).toBe('false');
  });

  it('TS3b Ortamlar: uzun sürüm listesi ilk 6 + "+N daha"; OS satırı ortam+OS süzer', async () => {
    render(<NginxEnvanteri />);
    await screen.findByTestId('filo-ozeti');
    const qa = ortamKarti('QA');
    const nginx = within(qa).getByTestId('ortam-nginx');
    expect(bolumSatirlari(nginx)).toHaveLength(6);
    fireEvent.click(within(qa).getByRole('button', { name: '+1 daha' }));
    const hepsi = bolumSatirlari(nginx).map((s) => s.getAttribute('data-anahtar'));
    expect(hepsi).toEqual([
      '1.26.3',
      '1.29.3 Plus R35',
      '1.25.1 Plus R30',
      '1.22.1',
      '1.20.1',
      'Plus R35 p1',
      '(bilinmiyor)',
    ]);
    fireEvent.click(within(qa).getByRole('button', { name: 'daha az' }));
    expect(bolumSatirlari(nginx)).toHaveLength(6);
    fireEvent.click(within(qa).getByTitle('QA · RHEL 8.10: 8 sunucu — listele'));
    expect(satirAdlari()).toHaveLength(8);
    expect(screen.getByTestId('surum-suzgeci').textContent).toContain('OS:');
  });

  it('TS4 Sürümler: her tam sürüm kendi satırı, aile başlıkları, iki yazım tek satır', async () => {
    render(<NginxEnvanteri />);
    await screen.findByTestId('filo-ozeti');
    fireEvent.click(screen.getByRole('tab', { name: /Sürümler/ }));
    const kart = screen.getByTestId('surum-aile-karti');
    const satirlar = within(kart)
      .getAllByTestId('dagilim-satiri')
      .map((s) => s.getAttribute('data-anahtar'));
    expect(satirlar).toEqual([
      '1.29.3 Plus R35',
      '1.26.3',
      '1.25.3 Plus R31 p1',
      '1.25.1 Plus R30',
      '1.24.0',
      '1.22.1',
      '1.20.1',
      'Plus R36 p4',
      'Plus R35 p1',
      '(bilinmiyor)',
    ]);
    const aileler = within(kart)
      .getAllByTestId('surum-ailesi')
      .map((a) => a.textContent!.split(/\s/)[0]);
    expect(aileler).toEqual([
      '1.29',
      '1.26',
      '1.25',
      '1.24',
      '1.22',
      '1.20',
      'NGINX',
      'bilinmiyor:',
    ]);
    expect(within(kart).getByText(/7 aile · 10 sürüm/)).toBeTruthy();
    const plusSatir = within(kart)
      .getAllByTestId('dagilim-satiri')
      .find((s) => s.getAttribute('data-anahtar') === 'Plus R36 p4')!;
    expect(within(plusSatir).getByTestId('plus-etiketi').textContent).toBe('Plus R36 p4');
    const iki = within(kart).getByTitle('1.26.3: 2 sunucu — listele (ham: nginx/1.26.3)');
    fireEvent.click(iki);
    expect(satirAdlari()).toEqual(['GBNGXQ01', 'GBNGXQ02']);
  });

  it('TS5 Sunucular: sürüm hücresi tam metin, Plus etiketi görünür, ham değer title', async () => {
    render(<NginxEnvanteri />);
    fireEvent.click(await screen.findByRole('tab', { name: /Sunucular/ }));
    const satir = (ad: string) =>
      screen.getAllByTestId('sunucu-satiri').find((r) => r.textContent!.startsWith(ad))!;
    const r = within(satir('GBNGXP01')).getByTestId('surum-rozeti');
    expect(r.textContent).toBe('1.25.3 Plus R31 p1');
    expect(within(r).getByTestId('plus-etiketi').textContent).toBe('Plus R31 p1');
    expect(r.getAttribute('title')).toContain('nginx/1.25.3 (nginx-plus-r31-p1)');
    expect(within(satir('GBNGXP03')).getByTestId('surum-rozeti').textContent).toBe('Plus R36 p4');
    expect(within(satir('GBNGXP04')).getByTestId('surum-rozeti').textContent).toBe('1.24.0');
    // satır rozeti aynı sürümün iki yazımını birlikte süzer
    fireEvent.click(r);
    expect(satirAdlari()).toEqual(['GBNGXP01', 'GBNGXP02']);
  });

  it("TS6 Service'ler: sürüm rozetinde Plus etiketi görünür", async () => {
    render(<NginxEnvanteri />);
    fireEvent.click(await screen.findByRole('tab', { name: /Service'ler/ }));
    const rozetler = screen.getAllByTestId('surum-rozeti');
    expect(rozetler.map((x) => x.textContent)).toEqual([
      '1.25.3 Plus R31 p1, 1 sunucu',
      'Plus R36 p4, 1 sunucu',
    ]);
    fireEvent.click(screen.getByRole('button', { name: 'glomo sunucularını göster' }));
    const ozet = screen.getByTestId('service-surumleri');
    expect(
      within(ozet)
        .getAllByTestId('plus-etiketi')
        .map((x) => x.textContent),
    ).toEqual(['Plus R31 p1', 'Plus R36 p4']);
  });

  it('TS7 Sunucular araması ekranda görünen sürüm metnini de bulur', async () => {
    render(<NginxEnvanteri />);
    fireEvent.click(await screen.findByRole('tab', { name: /Sunucular/ }));
    const ara = screen.getByPlaceholderText(/sürüm ara/);
    fireEvent.change(ara, { target: { value: 'Plus R31' } });
    expect(satirAdlari()).toEqual(['GBNGXP01', 'GBNGXP02']);
    fireEvent.change(ara, { target: { value: 'R36 p4' } });
    expect(satirAdlari()).toEqual(['GBNGXP03']);
    fireEvent.change(ara, { target: { value: 'plus-r31' } });
    expect(satirAdlari()).toEqual(['GBNGXP01', 'GBNGXP02']);
  });

  it('TS8 Sürümler: tek sürümlü aile başlığı sayıyı/yüzdeyi tekrar yazmaz, çok sürümlü yazar', async () => {
    render(<NginxEnvanteri />);
    await screen.findByTestId('filo-ozeti');
    fireEvent.click(screen.getByRole('tab', { name: /Sürümler/ }));
    const aile = (ad: string) =>
      within(screen.getByTestId('surum-aile-karti'))
        .getAllByTestId('surum-ailesi')
        .find((a) => a.textContent!.startsWith(ad))!;
    const tekli = aile('1.22');
    expect((tekli.textContent!.match(/%/g) ?? []).length).toBe(1);
    const coklu = aile('1.25');
    expect((coklu.textContent!.match(/%/g) ?? []).length).toBe(3);
  });
});
