// @vitest-environment jsdom
// Nginx SPA ortam özeti (2026-11-26, kapsam PR-2; dal %41): internet katmanı (deploy / tanım / hazır hücreleri ve
// sahip listeleri, route'suz SPA'lar), PROD yeni sunucu taşıması, route istatistikleri (cluster kırılımı, SPA route
// IP'leri), route listesi penceresi (IP ve cluster; tür süzgeci, arama, CSV, ad standardı / ölçülemedi uyarıları,
// hata), "Sahiplerine ulaş" penceresi (arama, ekipler, e-posta kopyalama, CSV) ve kapsam verisi alınamadı.
import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  spaCoverage: vi.fn(),
  routeStats: vi.fn(),
  nginxMigration: vi.fn(),
  routesOfIp: vi.fn(),
  routesOfCluster: vi.fn(),
}));
vi.mock('@/api/denetimApi', () => ({ denetimApi: api }));
const csv = vi.hoisted(() => vi.fn());
vi.mock('@/utils/csv', () => ({ downloadCsv: csv }));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('@/hooks/useToast', () => ({ toast }));

import NginxSpaSummary from '../NginxSpaSummary';

const sahip = (ekip: string, eposta: string) => ({
  groups: [ekip],
  emails: [eposta],
  unknownNs: [],
  namespaces: ['kart-prod'],
});
const eksik = (app: string, kind: string, ek: Record<string, unknown> = {}) => ({
  app,
  namespaces: ['kart-prod'],
  namespace: 'kart-prod',
  owner: sahip('Ekip-Kart', 'kart@ornek.invalid'),
  kind,
  ...ek,
});
const satir = (ek: Record<string, unknown> = {}) => ({
  env: 'PROD',
  measured: true,
  internetDirsMeasured: true,
  ocpApps: 40,
  spaTotal: 12,
  internetTotal: 8,
  internetInNginx: 6,
  internetDeployed: 6,
  internetNotDeployedCount: 2,
  internetDeployedNotDefinedCount: 1,
  internetDefinedNotDeployedCount: 1,
  internetServing: 5,
  internetServices: [
    { service: 'customers', count: 4 },
    { service: 'mcustomers', count: 2 },
  ],
  internetMultiService: 1,
  internetMissingCount: 0,
  internetMissing: [],
  intranetTotal: 4,
  measuredIntranet: true,
  intranetFull: 3,
  intranetPartialCount: 1,
  intranetPartial: [],
  intranetMissingCount: 0,
  intranetMissing: [],
  intranetOnlyOnServerCount: 0,
  intranetOnlyOnServer: [],
  intranetHosts: ['ORNGXP50'],
  intranetCoverage: 75,
  intranetInNginx: 3,
  intranetInNginxList: [],
  otherTotal: 0,
  otherInNginx: 0,
  unknownTotal: 1,
  unknownInNginx: 0,
  onlyNginxCount: 0,
  onlyNginx: [],
  coverage: null,
  intranetKaynak: 'intranet-spa',
  intranetKaynakHata: '',
  intranetKurulumToplam: 4,
  intranetOlculemediCount: 0,
  intranetSunucuYokCount: 0,
  missingDetail: {
    internet: [],
    intranet: [eksik('yarim-ui', 'partial', { hosts: [{ host: 'ORNGXP50', missing: ['conf'] }] })],
    notDeployed: [
      eksik('odeme-app-v1', 'notdeployed'),
      {
        ...eksik('rapor-app-v2', 'notdeployed'),
        owner: sahip('Ekip-Rapor', 'rapor@ornek.invalid'),
      },
    ],
    deployedNotDefined: [eksik('tanimsiz-app-v1', 'notdefined')],
    definedNotDeployed: [eksik('paketsiz-app-v1', 'nopackage')],
    noRoute: [eksik('rotasiz-app-v1', 'noroute')],
  },
  ...ek,
});
const kapsam = (rows: unknown[]) => ({
  ok: true,
  platform: 'ark',
  clusters: [],
  scanDate: '2026-11-25',
  routeTableMissing: false,
  routeMatch: { address: 0, name: 0, ns: 0, conflict: 0, none: 0 },
  ocpNonSpaExcluded: 0,
  nginxOutsidePattern: [],
  ocpSkippedNoEnv: 0,
  rows,
  intranetKaynak: 'intranet-spa',
  intranetKaynakHata: '',
  intranetRapor: {
    kesifTarihi: '2026-11-25',
    dizinTarihi: '2026-11-25',
    dizinDurum: 'var',
    taranmayanSunucu: [],
    platformDisi: [],
    ortamsiz: 0,
  },
});
const kume = (cluster: string, ek: Record<string, unknown> = {}) => ({
  cluster,
  routes: 20,
  spa: 10,
  nonSpa: 8,
  unmeasured: 2,
  nameMismatch: 0,
  nameFalsePositive: 0,
  spaPct: 50,
  spaPctMeasured: 55,
  discoveryRows: 18,
  discoveryScanDate: '2026-11-25',
  keyMismatch: false,
  reasons: [],
  ...ek,
});
const ip = (adres: string, count: number) => ({ ip: adres, count, samples: [`r-${adres}`] });
const ROTALAR = {
  ok: true,
  platform: 'ark',
  routeTableMissing: false,
  spaSignalRead: true,
  spaSignalRows: 50,
  envs: [
    {
      env: 'PROD',
      routes: 80,
      spa: 40,
      nonSpa: 32,
      unmeasured: 8,
      byName: { spa: 38, nonSpa: 40, unclassified: 2 },
      nameMismatch: 2,
      nameFalsePositive: 1,
      clusters: ['ocp-a', 'ocp-b', 'ocp-c'],
      clusterRows: [
        kume('ocp-a', { nameMismatch: 2 }),
        kume('ocp-b', {
          keyMismatch: true,
          spaPctMeasured: null,
          unmeasured: 20,
          spa: 0,
          nonSpa: 0,
          spaPct: 0,
        }),
        kume('ocp-c', { unmeasured: 0, nonSpa: 6 }),
        kume('(cluster adı yok)', { nonSpa: 4 }),
      ],
      namespaces: 12,
      terminations: [],
      spaIps: [
        ip('10.250.0.1', 20),
        ip('10.250.0.2', 10),
        ip('10.250.0.3', 6),
        ip('10.250.0.4', 4),
      ],
      nonSpaIps: [],
      unmeasuredIps: [],
      unresolvedIp: { spa: 3, nonSpa: 0, unmeasured: 0 },
    },
  ],
  totals: {
    routes: 80,
    spa: 40,
    nonSpa: 32,
    unmeasured: 8,
    nameMismatch: 2,
    nameFalsePositive: 1,
    byName: { spa: 38, nonSpa: 40, unclassified: 2 },
    noEnv: 0,
  },
};
const TASIMA = {
  ok: true,
  groups: [
    {
      label: 'customers',
      totals: { apps: 5, ready: 3, locations: { total: 10, defined: 7 } },
      newHosts: ['ORNNGP01', 'ORNNGP02'],
      newHostsScanned: ['ORNNGP01'],
      apps: [
        {
          application: 'hazir-app-v1',
          namespace: 'kart-prod',
          status: 'ready',
          readyHosts: 2,
          perHost: {},
        },
        {
          application: 'kismi-app-v1',
          namespace: 'kart-prod',
          status: 'partial',
          readyHosts: 1,
          perHost: { ORNNGP01: true, ORNNGP02: null },
          owner: sahip('Ekip-Kart', 'kart@ornek.invalid'),
        },
        {
          application: 'yok-app-v1',
          namespace: 'kart-prod',
          status: 'missing',
          readyHosts: 0,
          perHost: { ORNNGP01: false, ORNNGP02: false },
        },
      ],
    },
    {
      label: 'mcustomers',
      totals: { apps: 1, ready: 0, locations: { total: 2, defined: 0 } },
      newHosts: ['ORNNGP03'],
      newHostsScanned: [],
      apps: [
        {
          application: 'tarama-app-v1',
          namespace: 'mob-prod',
          status: 'unscanned',
          readyHosts: 0,
          perHost: { ORNNGP03: null },
        },
      ],
    },
  ],
};
const rota = (route: string, kind: string, ek: Record<string, unknown> = {}) => ({
  namespace: 'kart-prod',
  route,
  address: `${route}.apps.ornek.invalid`,
  type: 'passthrough',
  kind,
  signal: kind === 'unmeasured' ? '' : 'nginx',
  matchBy: 'selector',
  workload: `${route}-dc`,
  nameSpa: true,
  reason: kind === 'unmeasured' ? 'cluster taranmadi' : '',
  ...ek,
});
const ROTA_LISTESI = {
  ok: true,
  rows: [
    rota('odeme-app-v1', 'spa'),
    rota('garip-ui', 'spa', { nameSpa: false, matchBy: 'ad' }),
    rota('api-gw', 'nonSpa', { nameSpa: null }),
    rota('kayip', 'unmeasured'),
  ],
};

beforeEach(() => {
  Object.values(api).forEach((f) => f.mockReset());
  csv.mockReset();
  toast.success.mockReset();
  toast.error.mockReset();
  api.spaCoverage.mockResolvedValue(kapsam([satir()]));
  api.routeStats.mockResolvedValue(ROTALAR);
  api.nginxMigration.mockResolvedValue(TASIMA);
  api.routesOfIp.mockResolvedValue(ROTA_LISTESI);
  api.routesOfCluster.mockResolvedValue(ROTA_LISTESI);
});
afterEach(() => vi.unstubAllGlobals());

const pencere = () => screen.getByRole('dialog');

describe('NginxSpaSummary: internet katmanı ve taşıma', () => {
  it('her eksik hücresi kendi sahip listesini açar; route’suz SPA’lar', async () => {
    render(<NginxSpaSummary tier="internet" />);
    expect(await screen.findByText('Ortam özeti — SPA’lar nerede?')).toBeTruthy();
    const hucreler = screen
      .getAllByRole('button')
      .filter((b) => /tıklayın, sahipleriyle listelensin/.test(b.getAttribute('title') || ''));
    const acilan: Record<string, string[]> = {};
    for (const h of hucreler) {
      fireEvent.click(h);
      const p = pencere();
      const baslik = within(p).getAllByRole('heading')[0].textContent || '';
      acilan[baslik] = within(p)
        .getAllByText(/-app-v\d|-ui$/)
        .map((e) => e.textContent || '');
      fireEvent.click(within(p).getAllByRole('button', { name: 'Kapat' })[0]);
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    }
    expect(acilan['PROD · deploy edilmemiş internet SPA’ları']).toEqual([
      'odeme-app-v1',
      'rapor-app-v2',
    ]);
    const degerler = Object.values(acilan).flat();
    for (const app of ['tanimsiz-app-v1', 'paketsiz-app-v1', 'yarim-ui', 'kismi-app-v1'])
      expect(degerler).toContain(app);
    // Iki yerde (internet hucresi ve route ozeti) ayni baglanti var.
    fireEvent.click(screen.getAllByRole('button', { name: /route’suz 1/ })[0]);
    expect(within(pencere()).getByText('PROD · route’suz SPA’lar')).toBeTruthy();
    expect(within(pencere()).getByText('route bilgisi yok')).toBeTruthy();
  });

  it('PROD yeni sunucu taşıması: taşınmamış SPA’lar durumuyla, taranmayan servis', async () => {
    render(<NginxSpaSummary tier="internet" />);
    await screen.findByText('Ortam özeti — SPA’lar nerede?');
    expect(screen.getAllByText(/mcustomers/).length).toBeGreaterThanOrEqual(2);
    // Sahip listesi hucrelerinden tasima penceresini acani bul.
    for (const h of screen
      .getAllByRole('button')
      .filter((b) => /tıklayın, sahipleriyle listelensin/.test(b.getAttribute('title') || ''))) {
      fireEvent.click(h);
      if (within(pencere()).queryByText('PROD · yeni sunuculara deploy olmamış SPA’lar')) break;
      fireEvent.click(within(pencere()).getAllByRole('button', { name: 'Kapat' })[0]);
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    }
    const p = pencere();
    expect(within(p).getByText('PROD · yeni sunuculara deploy olmamış SPA’lar')).toBeTruthy();
    expect(within(p).getByText(/kısmi \(1\/2 sunucu hazır\)/)).toBeTruthy();
    expect(within(p).getByText('hiçbir yeni sunucuda yok')).toBeTruthy();
    expect(within(p).getByText('yeni sunucular taranmadı')).toBeTruthy();
    expect(within(p).getByText(/ORNNGP02 \(taranmadı\)/)).toBeTruthy();
    expect(within(p).queryByText('hazir-app-v1')).toBeNull();
  });
});

describe('NginxSpaSummary: route istatistikleri ve route listesi', () => {
  it('cluster kırılımı: ilk üç, "+1 cluster", adsız kova tıklanamaz, uyarı işaretleri', async () => {
    render(<NginxSpaSummary tier="intranet" />);
    expect(await screen.findByText('cluster bazında')).toBeTruthy();
    expect(screen.queryByText('(cluster adı yok)')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '+1 cluster' }));
    expect(screen.getByText('(cluster adı yok)').tagName).toBe('SPAN');
    expect(screen.getByText(/2 ad✗/)).toBeTruthy();
    expect(screen.getByText(/anahtar✗/)).toBeTruthy();
    expect(screen.getByText(/20 ölç\.yok/)).toBeTruthy();
    expect(screen.getByTitle(/ocp-b: 20 route, 0 SPA[\s\S]*ölçülen route yok/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'daha az' }));
    expect(screen.queryByText('(cluster adı yok)')).toBeNull();

    // Cluster tıklaması: SPA olmayanlar seçili açılır.
    fireEvent.click(screen.getByRole('button', { name: '8 SPA değil' }));
    expect(await within(pencere()).findByText('api-gw')).toBeTruthy();
    expect(api.routesOfCluster).toHaveBeenCalledWith({
      cluster: 'ocp-a',
      env: 'PROD',
      kind: 'all',
    });
    expect(within(pencere()).queryByText('odeme-app-v1')).toBeNull();
    expect(within(pencere()).getByText('ocp-a → route’lar')).toBeTruthy();
  });

  it('tek cluster’lı ortamda kırılım çizilmez (satırın kendisi zaten o cluster)', async () => {
    api.routeStats.mockResolvedValue({
      ...ROTALAR,
      envs: [{ ...ROTALAR.envs[0], clusters: ['ocp-a'], clusterRows: [kume('ocp-a')] }],
    });
    render(<NginxSpaSummary tier="intranet" />);
    expect(await screen.findByText('10.250.0.1')).toBeTruthy();
    expect(screen.queryByText('cluster bazında')).toBeNull();
  });

  it('IP listesi ve route penceresi: tür süzgeci, arama, uyarılar, CSV, hata', async () => {
    render(<NginxSpaSummary tier="intranet" />);
    await screen.findByText('cluster bazında');
    expect(screen.getByText('çözülmeyen 3')).toBeTruthy();
    expect(screen.queryByText('10.250.0.4')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '+1 IP' }));
    fireEvent.click(screen.getByText('10.250.0.4').closest('button') as HTMLElement);
    expect(await within(pencere()).findByText('odeme-app-v1')).toBeTruthy();
    expect(api.routesOfIp).toHaveBeenCalledWith({ ip: '10.250.0.4', env: 'PROD', kind: 'all' });
    // Hepsi açılışta; ad standardına uymayan ve ölçülemeyen uyarıları.
    expect(within(pencere()).getByText('garip-ui')).toBeTruthy();
    expect(within(pencere()).getByText(/1 route/, { selector: 'b' })).toBeTruthy();
    expect(within(pencere()).getByText(/ölçülemedi/, { selector: 'b' })).toBeTruthy();
    expect(
      within(within(pencere()).getByText('garip-ui').closest('tr') as HTMLElement).getByText(
        'uymuyor',
      ),
    ).toBeTruthy();
    expect(within(pencere()).getByText('ad çözülemedi')).toBeTruthy();
    expect(within(pencere()).getByText(/eşleşme: ad \(zayıf\)/)).toBeTruthy();

    // Tur suzgeci: sayilar ve secim.
    const tur = (ad: string) =>
      within(pencere()).getByRole('button', { name: new RegExp(`^${ad} \\d`) });
    expect(tur('hepsi').textContent).toBe('hepsi 4');
    expect(tur('SPA').textContent).toBe('SPA 2');
    expect(tur('SPA değil').textContent).toBe('SPA değil 1');
    expect(tur('ölçülemedi').textContent).toBe('ölçülemedi 1');
    fireEvent.click(tur('ölçülemedi'));
    expect(within(pencere()).getByText('kayip')).toBeTruthy();
    expect(within(pencere()).queryByText('odeme-app-v1')).toBeNull();
    expect(within(pencere()).getByText(/cluster taranmadi/)).toBeTruthy();
    fireEvent.click(tur('SPA'));
    expect(within(pencere()).getByText('odeme-app-v1')).toBeTruthy();
    expect(within(pencere()).queryByText('api-gw')).toBeNull();
    fireEvent.click(tur('hepsi'));
    const aramaKutusu = within(pencere()).getByRole('textbox');
    fireEvent.change(aramaKutusu, { target: { value: 'GARIP' } });
    expect(within(pencere()).queryByText('odeme-app-v1')).toBeNull();
    expect(within(pencere()).getByText('garip-ui')).toBeTruthy();
    fireEvent.change(aramaKutusu, { target: { value: 'yok-boyle' } });
    expect(within(pencere()).getByText('Route yok.')).toBeTruthy();
    fireEvent.change(aramaKutusu, { target: { value: '' } });
    fireEvent.click(within(pencere()).getByRole('button', { name: /CSV/ }));
    const [ad, baslik, satirlar] = csv.mock.calls[0];
    expect(ad).toBe('PROD_10.250.0.4_route');
    expect(baslik[0]).toBe('ip');
    expect(satirlar.map((r: string[]) => r[10])).toEqual([
      'uyuyor',
      'uymuyor',
      'ad cozulemedi',
      'uyuyor',
    ]);
    fireEvent.click(within(pencere()).getAllByRole('button', { name: 'Kapat' })[0]);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    api.routesOfIp.mockResolvedValueOnce({ ok: false, message: 'route tablosu yok' });
    fireEvent.click(screen.getByText('10.250.0.1').closest('button') as HTMLElement);
    expect(await within(pencere()).findByText(/route tablosu yok/)).toBeTruthy();
    fireEvent.click(within(pencere()).getAllByRole('button', { name: 'Kapat' })[0]);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    api.routesOfIp.mockRejectedValueOnce(new Error('ag'));
    fireEvent.click(screen.getByText('10.250.0.2').closest('button') as HTMLElement);
    expect(await within(pencere()).findByText(/^ag$/)).toBeTruthy();
  });
});

describe('NginxSpaSummary: Sahiplerine ulaş ve hata', () => {
  it('arama, ekip sayımı, e-posta kopyalama (başarı / hata), CSV', async () => {
    const yaz = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('izin yok'));
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText: yaz } });
    render(<NginxSpaSummary tier="internet" />);
    await screen.findByText('Ortam özeti — SPA’lar nerede?');
    fireEvent.click(screen.getByRole('button', { name: /Sahiplerine ulaş/ }));
    expect(
      within(pencere()).getByText('Deploy olmamış / sorunlu tüm SPA’lar ve sahipleri'),
    ).toBeTruthy();
    expect(within(pencere()).getByText('yok-app-v1')).toBeTruthy();
    expect(within(pencere()).getByText('tarama-app-v1')).toBeTruthy();
    expect(within(pencere()).queryByText('hazir-app-v1')).toBeNull();
    expect(within(pencere()).getByText(/kısmi \(1\/2 sunucu hazır\)/)).toBeTruthy();
    expect(within(pencere()).getByText(/ORNNGP02 \(taranmadı\)/)).toBeTruthy();
    fireEvent.click(within(pencere()).getByRole('button', { name: /kopyala/i }));
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    expect(yaz.mock.calls[0][0]).toContain('kart@ornek.invalid');
    fireEvent.click(within(pencere()).getByRole('button', { name: /kopyala/i }));
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith('Panoya kopyalanamadı; CSV indirip oradan alın.'),
    );
    fireEvent.change(within(pencere()).getByRole('textbox'), { target: { value: 'ekip-rapor' } });
    expect(within(pencere()).getByText('rapor-app-v2')).toBeTruthy();
    expect(within(pencere()).queryByText('odeme-app-v1')).toBeNull();
    fireEvent.click(within(pencere()).getByRole('button', { name: /CSV/ }));
    expect(csv.mock.calls[0][2]).toHaveLength(1);
  });

  it('kapsam verisi alınamadı; yükleniyor', async () => {
    api.spaCoverage.mockResolvedValueOnce({ ok: false, message: 'kapsam tablosu yok' });
    const a = render(<NginxSpaSummary tier="internet" />);
    expect(await screen.findByText('kapsam tablosu yok')).toBeTruthy();
    a.unmount();
    api.spaCoverage.mockRejectedValueOnce(new Error('zaman asimi'));
    const b = render(<NginxSpaSummary tier="internet" />);
    expect(await screen.findByText(/zaman asimi/)).toBeTruthy();
    b.unmount();
    api.spaCoverage.mockReturnValueOnce(new Promise(() => {}));
    render(<NginxSpaSummary tier="internet" />);
    expect(screen.getByText('Ortam özeti yükleniyor…')).toBeTruthy();
  });
});
