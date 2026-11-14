// src/components/denetim/__tests__/NginxEnvanteriTasarim.test.tsx
//
// Nginx Hub > Envanter yeniden tasarım + elle etiket (kullanıcı, 2026-11-12).
//   ET1 filo özeti: ortamlar ad kalıbından (PROD/QA/TEST), kalıp dışı ayrı kova
//   ET2 "Sürüm uyumu" şeridi YOK (kullanıcı, 2026-11-14); Sürümler sekmesinde major.minor ailesi,
//       sürüm rozeti Sunucular'ı o sürüme süzer; süzgeç kaldırılabilir
//   ET3 ortam kartı Sunucular'ı o ortama süzer
//   ET4 elle etiketli sunucu: çip ve "Elle etiketli" süzgeci
//   ET5 Admin etiket penceresi: kip + etiketler kaydedilir, liste tazelenir
//   ET6 Admin olmayan kullanıcıda düzenle düğmesi yok
//   ET7 Sunucular'da /usr/nginx ve /web_log disk boyutu; çözülemeyen "—" + title; sıralanır
//   ET8 sürüm ayrıştırma / sıralama (aile, yama, ek, bilinmiyor)
//   ET9 unknown + (bilinmiyor) tek rozet; nginx/OS süzgeci karışmaz; Sunucular rozeti süzer; 1 GiB altı MiB
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, within, waitFor } from '@testing-library/react';
import { render } from '@/test/test-utils';
import { NginxEnvanteri, surumAyristir, surumKarsilastir } from '@/components/denetim/NginxEnvanteri';
import type { NginxInventoryResult, NginxInvHost } from '@/api/denetimApi';

const api = vi.hoisted(() => ({ inv: vi.fn(), set: vi.fn(), clear: vi.fn() }));
vi.mock('@/api/denetimApi', () => ({
  denetimApi: { nginxInventory: api.inv, nginxInventoryLabelSet: api.set, nginxInventoryLabelClear: api.clear },
}));
const kimlik = vi.hoisted(() => ({ role: 'Admin' }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { username: 'onur', role: kimlik.role } }) }));
vi.mock('@/hooks/useToast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const host = (o: Partial<NginxInvHost>): NginxInvHost => ({
  hostname: 'H', fqdn: null, env: 'production', location: 'pendik', service: null, services: 'glomo',
  service_count: 1, domain: null, ip: null, subnet: null, os: 'RHEL 8', kernel: null, architecture: null,
  cpu: 4, memory: '16G', nginx_version: '1.24.0', nginx_user: 'www', nginx_prefix: null, config_count: 3,
  disk_usr_nginx: null, disk_web_log: null, source_last_update: null, metadata_version: 1, ...o,
});
const size = { totalGiB: 0, parsed: 0, unparsed: 0 };
const veri = (): NginxInventoryResult => ({
  ok: true,
  lastUpdate: '2026-11-12T06:30:00',
  totals: { hosts: 5, envs: 2, services: 3, servicesUnlisted: [], nginxVersions: 2, osVersions: 1, cpuTotal: 20, memory: size, diskNginx: size, diskWebLog: size },
  byEnv: [],
  byService: [],
  versions: {
    nginx: [{ value: '1.24.0', count: 4 }, { value: '1.20.1', count: 1 }],
    os: [], kernel: [], architecture: [], metadata: [],
  },
  resources: { cpu: [], memory: [], diskNginx: [], diskWebLog: [], configCount: [], serviceCount: [] },
  other: { domain: [], subnet: [], nginxUser: [] },
  hosts: [
    host({ hostname: 'GBNGXP01', envByName: 'PROD', disk_usr_nginx: '50G', disk_web_log: '1.5T' }),
    host({ hostname: 'GBNGXAP01', envByName: 'PROD', location: 'ankara', disk_usr_nginx: '20G', disk_web_log: 'N/A' }),
    host({ hostname: 'GBNGXQ01', envByName: 'QA', env: 'non-production', nginx_version: '1.20.1', disk_usr_nginx: '7.5G', disk_web_log: '100G' }),
    host({
      hostname: 'GBNGXT01', envByName: 'TEST', env: 'non-production', services: 'glomo,mobile',
      etiket: { mod: 'ekle', etiketler: ['mobile'], not: null, by: 'onur', at: null, oto: ['glomo'] },
    }),
    host({ hostname: 'XYZWEB01', envByName: 'BILINMIYOR', env: 'non-production' }),
  ],
});

const satirAdlari = () =>
  screen.getAllByTestId('sunucu-satiri').map((r) => r.querySelector('td')!.textContent!.trim().split(/\s/)[0]);

describe('NginxEnvanteri — yeniden tasarım ve elle etiket', () => {
  beforeEach(() => {
    kimlik.role = 'Admin';
    api.inv.mockReset().mockResolvedValue(veri());
    api.set.mockReset().mockResolvedValue({ ok: true });
  });

  it('ET1 filo özeti ortamları ad kalıbından sayar', async () => {
    render(<NginxEnvanteri />);
    const ozet = await screen.findByTestId('filo-ozeti');
    expect(within(ozet).getByText('5')).toBeTruthy();
    for (const [ad, n] of [['PROD', '2'], ['QA', '1'], ['TEST', '1'], ['Kalıp dışı', '1']]) {
      const d = within(ozet).getByRole('button', { name: new RegExp(`^${ad}\\s*${n}$`) });
      expect(d).toBeTruthy();
    }
    expect(screen.getAllByTestId('ortam-karti')).toHaveLength(4);
  });

  it('ET2 sürüm uyumu yok; aile kartındaki sürüm rozeti Sunucular listesini süzer', async () => {
    render(<NginxEnvanteri />);
    await screen.findByTestId('filo-ozeti');
    expect(screen.queryByTestId('surum-uyumu')).toBeNull();
    expect(screen.queryByText(/sürüm uyumu/i)).toBeNull();
    expect(screen.queryByText(/en yaygın/i)).toBeNull();
    fireEvent.click(screen.getByRole('tab', { name: /Sürümler/ }));
    const kart = screen.getByTestId('surum-aile-karti');
    expect(within(kart).getAllByTestId('surum-ailesi').map((a) => a.textContent!.slice(0, 4))).toEqual(['1.24', '1.20']);
    const rozet = within(kart).getByTitle('1.20.1: 1 sunucu — listele');
    expect(rozet.textContent).toBe('1.20.1, 1 sunucu');
    fireEvent.click(rozet);
    expect(satirAdlari()).toEqual(['GBNGXQ01']);
    fireEvent.click(screen.getByRole('button', { name: 'Sürüm süzgecini kaldır' }));
    expect(satirAdlari()).toHaveLength(5);
  });

  it('ET3 ortam kartı Sunucular listesini o ortama süzer', async () => {
    render(<NginxEnvanteri />);
    const kart = (await screen.findAllByTestId('ortam-karti'))[0];
    fireEvent.click(within(kart).getByRole('button', { name: /^Sunucular/ }));
    expect(satirAdlari()).toEqual(['GBNGXAP01', 'GBNGXP01']);
  });

  it('ET4 elle etiketli sunucu ve süzgeç', async () => {
    render(<NginxEnvanteri />);
    fireEvent.click(await screen.findByRole('tab', { name: /Sunucular/ }));
    fireEvent.click(screen.getByRole('button', { name: /Elle etiketli/ }));
    expect(satirAdlari()).toEqual(['GBNGXT01']);
    expect(screen.getByTitle('Elle etiket').textContent).toContain('mobile');
    expect(screen.getByText(/otomatik \+ elle/)).toBeTruthy();
  });

  it('ET5 Admin etiketi kaydeder, liste tazelenir', async () => {
    render(<NginxEnvanteri />);
    fireEvent.click(await screen.findByRole('tab', { name: /Sunucular/ }));
    fireEvent.click(screen.getByRole('button', { name: 'GBNGXP01 etiketini düzenle' }));
    const p = screen.getByTestId('etiket-penceresi');
    const kutu = within(p).getByPlaceholderText('glomo, mobile-api');
    expect((kutu as HTMLInputElement).value).toBe('glomo');
    fireEvent.change(kutu, { target: { value: 'glomo, mobile-api glomo' } });
    expect(within(p).getByTestId('etiket-sonuc').textContent).toBe('glomomobile-api');
    fireEvent.click(screen.getByRole('button', { name: 'Kaydet' }));
    await waitFor(() =>
      expect(api.set).toHaveBeenCalledWith('GBNGXP01', { mod: 'degistir', etiketler: ['glomo', 'mobile-api'], not: undefined }),
    );
    await waitFor(() => expect(api.inv).toHaveBeenCalledTimes(2));
  });

  it('ET5b geçersiz etikette Kaydet kapalı', async () => {
    render(<NginxEnvanteri />);
    fireEvent.click(await screen.findByRole('tab', { name: /Sunucular/ }));
    fireEvent.click(screen.getByRole('button', { name: 'GBNGXP01 etiketini düzenle' }));
    fireEvent.change(screen.getByPlaceholderText('glomo, mobile-api'), { target: { value: 'too_many' } });
    expect((screen.getByRole('button', { name: 'Kaydet' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('ET6 Admin olmayan kullanıcıda düzenle düğmesi yok', async () => {
    kimlik.role = 'User';
    render(<NginxEnvanteri />);
    fireEvent.click(await screen.findByRole('tab', { name: /Sunucular/ }));
    expect(screen.queryByRole('button', { name: /etiketini düzenle/ })).toBeNull();
  });

  it('ET7 sunucu satırında disk boyutları; çözülemeyen "—", kolon sıralanır', async () => {
    render(<NginxEnvanteri />);
    fireEvent.click(await screen.findByRole('tab', { name: /Sunucular/ }));
    const satir = (ad: string) => screen.getAllByTestId('sunucu-satiri').find((r) => r.textContent!.startsWith(ad))!;
    const p01 = satir('GBNGXP01');
    expect(within(p01).getByTestId('disk-usr-nginx').textContent).toBe('50 GiB');
    expect(within(p01).getByTestId('disk-web-log').textContent).toBe('1,5 TiB');
    expect(within(satir('GBNGXQ01')).getByTestId('disk-usr-nginx').textContent).toBe('7,5 GiB');
    const na = within(satir('GBNGXAP01')).getByTestId('disk-web-log').firstElementChild!;
    expect(na.querySelector('[aria-hidden="true"]')!.textContent).toBe('—');
    expect(na.textContent).toContain('çözümlenemedi');
    expect(na.getAttribute('title')).toBe('/web_log: "N/A" çözümlenemedi');
    expect(within(satir('GBNGXT01')).getByTestId('disk-usr-nginx').firstElementChild!.getAttribute('title')).toBe('/usr/nginx: değer yok');

    // değeri olmayanlar ("—") iki yönde de en altta
    fireEvent.click(screen.getByRole('button', { name: /\/usr\/nginx/ }));
    expect(satirAdlari()).toEqual(['GBNGXQ01', 'GBNGXAP01', 'GBNGXP01', 'GBNGXT01', 'XYZWEB01']);
    fireEvent.click(screen.getByRole('button', { name: /\/usr\/nginx/ }));
    expect(satirAdlari()).toEqual(['GBNGXP01', 'GBNGXAP01', 'GBNGXQ01', 'GBNGXT01', 'XYZWEB01']);
    expect(within(p01).getByTestId('bellek').textContent).toBe('16 GiB');
  });

  it('ET8 sürüm ayrıştırma ve yeniden eskiye sıralama', () => {
    expect(surumAyristir('1.24.0')).toMatchObject({ aile: '1.24', yama: '.0', ek: '', bilinmiyor: false });
    expect(surumAyristir('nginx/1.26.3')).toMatchObject({ aile: '1.26', yama: '.3' });
    expect(surumAyristir('1.25.1 (nginx-plus-r30)')).toMatchObject({ aile: '1.25', yama: '.1', ek: '(nginx-plus-r30)' });
    expect(surumAyristir('unknown').bilinmiyor).toBe(true);
    expect(surumAyristir('(bilinmiyor)').bilinmiyor).toBe(true);
    expect(surumAyristir('').bilinmiyor).toBe(true);
    expect(['1.20.1', 'unknown', '1.9.15', '1.24.0', '1.24.10'].sort(surumKarsilastir)).toEqual([
      '1.24.10', '1.24.0', '1.20.1', '1.9.15', 'unknown',
    ]);
  });

  it('ET9 bilinmeyen sürümler tek rozet; OS süzgeci nginx ile karışmaz; satır rozeti süzer', async () => {
    const d = veri();
    d.versions.nginx = [...d.versions.nginx, { value: 'unknown', count: 1 }, { value: '(bilinmiyor)', count: 1 }];
    d.versions.os = [{ value: 'RHEL 8', count: 5 }, { value: '(bilinmiyor)', count: 1 }];
    d.hosts = d.hosts.map((h) => (h.hostname === 'XYZWEB01' ? { ...h, nginx_version: 'unknown' } : h));
    d.hosts.push(host({ hostname: 'GBNGXT02', envByName: 'TEST', env: 'non-production', nginx_version: null, os: null, disk_usr_nginx: '512M' }));
    api.inv.mockReset().mockResolvedValue(d);
    render(<NginxEnvanteri />);
    await screen.findByTestId('filo-ozeti');
    fireEvent.click(screen.getByRole('tab', { name: /Sürümler/ }));
    const kart = screen.getByTestId('surum-aile-karti');
    const bilinmeyen = within(kart).getAllByTestId('surum-rozeti').filter((r) => r.textContent!.startsWith('bilinmiyor'));
    expect(bilinmeyen).toHaveLength(1);
    expect(bilinmeyen[0].textContent).toBe('bilinmiyor, 2 sunucu');
    expect(within(kart).getByText(/3 sürüm/)).toBeTruthy();
    fireEvent.click(bilinmeyen[0]);
    expect(satirAdlari()).toEqual(['GBNGXT02', 'XYZWEB01']);
    expect(within(screen.getByTestId('surum-suzgeci')).getByTestId('surum-rozeti')).toBeTruthy();
    expect(within(screen.getAllByTestId('sunucu-satiri')[0]).getByTestId('disk-usr-nginx').textContent).toBe('512 MiB');

    // OS "(bilinmiyor)" yalnız OS'u boş sunucuyu getirir (nginx'i unknown olanı değil)
    fireEvent.click(screen.getByRole('tab', { name: /Sürümler/ }));
    fireEvent.click(screen.getByTitle('(bilinmiyor) — sunucuları listele'));
    expect(satirAdlari()).toEqual(['GBNGXT02']);
    expect(screen.getByTestId('surum-suzgeci').textContent).toContain('OS:');

    // Sunucular satırındaki rozet o sürüme süzer
    fireEvent.click(screen.getByRole('button', { name: 'Sürüm süzgecini kaldır' }));
    const q01 = screen.getAllByTestId('sunucu-satiri').find((r) => r.textContent!.startsWith('GBNGXQ01'))!;
    fireEvent.click(within(q01).getByTestId('surum-rozeti'));
    expect(satirAdlari()).toEqual(['GBNGXQ01']);
  });
});
