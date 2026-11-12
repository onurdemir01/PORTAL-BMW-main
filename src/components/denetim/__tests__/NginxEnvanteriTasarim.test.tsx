// src/components/denetim/__tests__/NginxEnvanteriTasarim.test.tsx
//
// Nginx Hub > Envanter yeniden tasarım + elle etiket (kullanıcı, 2026-11-12).
//   ET1 filo özeti: ortamlar ad kalıbından (PROD/QA/TEST), kalıp dışı ayrı kova
//   ET2 ayrışan sürüm çipi Sunucular'ı o sürüme süzer; süzgeç kaldırılabilir
//   ET3 ortam kartı Sunucular'ı o ortama süzer
//   ET4 elle etiketli sunucu: çip ve "Elle etiketli" süzgeci
//   ET5 Admin etiket penceresi: kip + etiketler kaydedilir, liste tazelenir
//   ET6 Admin olmayan kullanıcıda düzenle düğmesi yok
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, within, waitFor } from '@testing-library/react';
import { render } from '@/test/test-utils';
import { NginxEnvanteri } from '@/components/denetim/NginxEnvanteri';
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
    host({ hostname: 'GBNGXP01', envByName: 'PROD' }),
    host({ hostname: 'GBNGXAP01', envByName: 'PROD', location: 'ankara' }),
    host({ hostname: 'GBNGXQ01', envByName: 'QA', env: 'non-production', nginx_version: '1.20.1' }),
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

  it('ET2 ayrışan sürüm çipi Sunucular listesini süzer', async () => {
    render(<NginxEnvanteri />);
    const uyum = await screen.findByTestId('surum-uyumu');
    expect(uyum.textContent).toMatch(/%80/);
    fireEvent.click(within(uyum).getByRole('button', { name: '1.20.1' }));
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
});
