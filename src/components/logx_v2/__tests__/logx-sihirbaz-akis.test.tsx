// @vitest-environment jsdom
// LogX v2 sihirbazinin YONETIMI (2026-11-27, kapsam PR-2; LogXWizardPage dal dusuk). Adim bilesenleri
// sahte: her birinin kendi testi var; burada sayfanin adim turetmesi, Geri, kilit, is bitisi ve sepet
// sinanir. Sahte sunucu istek durumunu tutar; her API cagrisi onu gercekteki gibi ilerletir.
//   LX1 Legacy: platform -> uygulama -> sunucu (elle) -> tarama -> dosya -> sunucuya don -> aktarim ->
//       durumu sorgulanamadi -> yenile -> eksik arsiv
//   LX2 is kaydi yok / is durumu sorgulanamadi: bes "calisiyor" adiminin hepsinde kurtarma karti
//   LX3 OpenShift: cluster -> kayitli namespace listesi -> uygulama -> sepet (tekrarsiz, 20 siniri) -> toplama
//   LX4 kayitli listeden Geri cluster secimine doner; ayni cluster'lar yeniden secilince liste yeniden gelir
//   LX5 canli namespace taramasi, basarisiz cluster'lar, yeniden tara, uygulama taramasi
//   LX6 kaldigi yerden devam, basarisiz / suresi dolmus / arsivsiz istek, baslatma hatasi
//   LX7 derin baglanti on-secimi: legacy otomatik secim; OpenShift ortam / tenant / cluster / namespace uyarilari
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { render } from '@/test/test-utils';
import LogXWizardPage from '@/components/logx_v2/LogXWizardPage';

type Json = Record<string, unknown>;
const sv = vi.hoisted(() => ({
  req: null as Json | null,
  jobs: [] as Json[],
  download: null as Json | null,
  downloads: [] as Json[],
  sira: 1,
}));
const api = vi.hoisted(() => ({
  getRequest: vi.fn(),
  createRequest: vi.fn(),
  getClusterTree: vi.fn(),
  selectClusters: vi.fn(),
  inventoryNamespaces: vi.fn(),
  discoverApps: vi.fn(),
  resetRequest: vi.fn(),
  discoverLegacy: vi.fn(),
  transferLegacy: vi.fn(),
  discoverNamespaces: vi.fn(),
  discoverFetchOcp: vi.fn(),
}));
vi.mock('@/api/logxV2Api', async (orig) => ({
  ...((await orig()) as object),
  logxV2Api: api,
}));
const ozet = (p: Json) => JSON.stringify(p, (k, v) => (typeof v === 'function' ? undefined : v));
vi.mock('@/components/logx_v2/steps/PlatformStep', () => ({
  default: (p: { onSelect: (x: string) => void }) => (
    <div>
      <button onClick={() => p.onSelect('legacy')}>platform:legacy</button>
      <button onClick={() => p.onSelect('openshift')}>platform:openshift</button>
    </div>
  ),
}));
vi.mock('@/components/logx_v2/steps/legacy/AppSearchStep', () => ({
  default: (p: Json & { onSelect: (a: string) => void }) => (
    <div data-testid="adim-uygulama">
      {ozet(p)}
      <button onClick={() => p.onSelect('ODEME-APP')}>uygulama:sec</button>
    </div>
  ),
}));
vi.mock('@/components/logx_v2/steps/legacy/HostSelectStep', () => ({
  default: (p: Json & { onSubmit: (h: string[], o: { manual: string[] }) => void }) => (
    <div data-testid="adim-sunucu">
      {ozet(p)}
      <button onClick={() => p.onSubmit(['ORWASP01', 'ORWASP99'], { manual: ['ORWASP99'] })}>
        sunucu:elle
      </button>
      <button onClick={() => p.onSubmit(['ORWASP01'], { manual: [] })}>sunucu:envanter</button>
    </div>
  ),
}));
vi.mock('@/components/logx_v2/steps/legacy/FileSelectionStep', () => ({
  default: (p: Json & { onSubmit: (s: unknown[]) => void; onBackToHosts: () => void }) => (
    <div data-testid="adim-dosya">
      {ozet(p)}
      <button onClick={() => p.onSubmit([{ host: 'ORWASP01', path: '/log/a.log' }])}>
        dosya:gonder
      </button>
      <button onClick={p.onBackToHosts}>dosya:sunuculara</button>
    </div>
  ),
}));
vi.mock('@/components/logx_v2/steps/ocp/ClusterSelectStep', () => ({
  default: (p: { onSubmit: (e: string, t: string, c: string[]) => void }) => (
    <div data-testid="adim-cluster">
      <button onClick={() => p.onSubmit('prod', 'ark', ['c1', 'c2'])}>cluster:sec</button>
      <button onClick={() => p.onSubmit('prod', 'ark', ['c1', 'c2', 'c3'])}>cluster:uc</button>
    </div>
  ),
}));
vi.mock('@/components/logx_v2/steps/ocp/NamespacePickerStep', () => ({
  default: (p: Json & { onSelect: (n: string) => void; onRediscover: () => void }) => (
    <div data-testid="adim-namespace">
      {ozet(p)}
      <button onClick={() => p.onSelect('ns-a')}>namespace:sec</button>
      <button onClick={p.onRediscover}>namespace:yeniden</button>
    </div>
  ),
}));
vi.mock('@/components/logx_v2/steps/ocp/AppNameStep', () => ({
  default: (p: Json & { onSubmit: (a: string[]) => void; onDiscover: () => void }) => (
    <div data-testid="adim-ocp-uygulama">
      {ozet(p)}
      <button onClick={() => p.onSubmit(['app1', 'app2'])}>ocp:iki</button>
      <button onClick={() => p.onSubmit(['app1', 'app3'])}>ocp:tekrarli</button>
      <button onClick={() => p.onSubmit(Array.from({ length: 25 }, (_, i) => `toplu${i}`))}>
        ocp:cok
      </button>
      <button onClick={p.onDiscover}>ocp:tara</button>
    </div>
  ),
}));
vi.mock('@/components/logx_v2/steps/ocp/SelectedTargetsBar', () => ({
  default: (
    p: Json & { onRemove: (i: number) => void; onClear: () => void; onSubmit: () => void },
  ) => (
    <div data-testid="sepet">
      {ozet(p)}
      <button onClick={() => p.onRemove(0)}>sepet:ilkini-sil</button>
      <button onClick={p.onClear}>sepet:temizle</button>
      <button onClick={p.onSubmit}>sepet:topla</button>
    </div>
  ),
}));
vi.mock('@/components/logx_v2/shared/JobProgress', () => ({
  default: (p: { jobId: number; discoveringLabel: string; onDone: (r: Json) => void }) => (
    <div data-testid="is">
      {p.jobId}|{p.discoveringLabel}
      <button onClick={() => p.onDone({ status: 'successful', artifacts: {}, errorMessage: null })}>
        is:bitti
      </button>
      <button
        onClick={() =>
          p.onDone({
            status: 'error',
            artifacts: null,
            errorMessage: 'AWX yanıt vermiyor',
            technicalDetail: 'iz: 502',
          })
        }
      >
        is:sorgulanamadi
      </button>
      <button onClick={() => p.onDone({ status: 'error', artifacts: null, errorMessage: null })}>
        is:mesajsiz
      </button>
      <button
        onClick={() =>
          p.onDone({ status: 'error', artifacts: { x: 1 }, errorMessage: 'playbook düştü' })
        }
      >
        is:hatali-sonuc
      </button>
    </div>
  ),
}));
vi.mock('@/components/logx_v2/shared/DownloadStep', () => ({
  default: (p: Json & { onRestart: () => void; eksik?: React.ReactNode }) => (
    <div data-testid="adim-indir">
      {ozet({ download: p.download, downloads: p.downloads })}
      <div data-testid="eksik">{p.eksik}</div>
      <button onClick={p.onRestart}>indir:yeni</button>
    </div>
  ),
}));
vi.mock('@/components/logx_v2/shared/FailedStep', () => ({
  default: (
    p: Json & { onRestart: () => void; onBackToHosts?: () => void; children?: React.ReactNode },
  ) => (
    <div data-testid="adim-hata">
      {ozet({ jobId: p.jobId, message: p.message, technicalDetail: p.technicalDetail })}
      {p.children}
      <button onClick={p.onRestart}>hata:bastan</button>
      {p.onBackToHosts && <button onClick={p.onBackToHosts}>hata:sunuculara</button>}
    </div>
  ),
}));
vi.mock('@/components/logx_v2/shared/LogXYonetimDugmesi', () => ({ default: () => null }));

// ── sahte sunucu ──────────────────────────────────────────────────────────────────
const istek = (o: Json): Json => ({
  id: 'r1',
  username: 'kullanici',
  platform: 'legacy',
  state: 'draft',
  input: null,
  discoveryResult: null,
  selectedFiles: null,
  errorMessage: null,
  createdAt: '2026-11-27T10:00:00Z',
  updatedAt: '2026-11-27T10:00:00Z',
  expiresAt: '2026-11-28T10:00:00Z',
  ...o,
});
const is = (jobType: string, o: Json = {}): Json => ({
  id: sv.sira++ + 10,
  requestId: sv.req?.id,
  jobType,
  status: 'running',
  artifacts: null,
  startedAt: null,
  finishedAt: null,
  errorMessage: null,
  ...o,
});
const ilerlet = (o: Json, yeniIs?: string) => {
  sv.req = { ...sv.req, ...o };
  if (yeniIs) sv.jobs = [...sv.jobs, is(yeniIs)];
};
const INDIR = {
  token: 't1',
  filename: 'logx-r1.zip',
  sizeBytes: 1024,
  expiresAt: '2026-11-28T10:00:00Z',
};
const KAYITLI = {
  cached: true,
  items: ['ns-a', 'ns-b'],
  fetchedAt: '2026-11-27T09:00:00Z',
  stale: false,
  source: 'inventory',
  sources: { 'ns-a': 'inventory', 'ns-b': 'discovery' },
  counts: { 'ns-a': 3 },
  clusters: { 'ns-a': ['c1', 'c2'] },
  unreadableSources: [],
  hiddenCount: 2,
  restriction: true,
  message: 'Prod ortamı kısıtlı: yalnız izinli namespace listelenir.',
};

const tikla = (ad: string) => fireEvent.click(screen.getByRole('button', { name: ad }));
const adim = async (id: string) => screen.findByTestId(id);
const props = (id: string) => JSON.parse(screen.getByTestId(id).firstChild!.textContent!);
const url = () => new URL(window.location.href).searchParams;

async function ac(arama = '') {
  window.history.replaceState({}, '', `/logx${arama}`);
  render(<LogXWizardPage />, { initialEntries: [`/logx${arama}`] });
  await screen.findByText('LogX — Güvenli Log İndirme'); // acilis yuklemesi bitti
}
const propsBekle = async (id: string) => {
  await screen.findByTestId(id);
  return props(id);
};

beforeEach(() => {
  vi.resetAllMocks();
  sv.req = null;
  sv.jobs = [];
  sv.download = null;
  sv.downloads = [];
  sv.sira = 1;
  api.getRequest.mockImplementation(async () => ({
    ok: true,
    request: sv.req,
    jobs: sv.jobs,
    download: sv.download,
    downloads: sv.downloads,
  }));
  api.createRequest.mockImplementation(async (platform: string) => {
    sv.req = istek({ id: platform === 'legacy' ? 'r1' : 'r2', platform });
    return { ok: true, requestId: sv.req.id };
  });
  api.selectClusters.mockImplementation(
    async (_id: string, env: string, tenant: string, clusters: string[]) => {
      ilerlet({ input: { env, tenant, clusters } });
      return { ok: true };
    },
  );
  api.resetRequest.mockImplementation(async (_id: string, to: string) => {
    if (to === 'ocp_cluster_select')
      ilerlet({ state: 'draft', input: null, discoveryResult: null });
    else ilerlet({ state: 'draft', discoveryResult: null, selectedFiles: null });
    return { ok: true };
  });
  api.discoverLegacy.mockImplementation(
    async (_id: string, app: string, hosts: string[], elle: boolean) => {
      ilerlet(
        {
          state: 'discovering',
          input: { app, hosts, ...(elle ? { manualHosts: ['ORWASP99'] } : {}) },
        },
        'legacy_discovery',
      );
      return { ok: true };
    },
  );
  api.transferLegacy.mockImplementation(async () => {
    ilerlet({ state: 'transferring' }, 'legacy_transfer');
    return { ok: true };
  });
  api.discoverNamespaces.mockImplementation(async () => {
    ilerlet({ state: 'namespace_discovering' }, 'ocp_namespace_discovery');
    return { ok: true };
  });
  api.discoverApps.mockImplementation(async (_id: string, ns: string[]) => {
    ilerlet(
      {
        state: 'app_discovering',
        input: { ...(sv.req!.input as Json), appDiscoveryNamespaces: ns },
      },
      'ocp_app_discovery',
    );
    return { ok: true };
  });
  api.discoverFetchOcp.mockImplementation(async () => {
    ilerlet({ state: 'transferring' }, 'ocp_discover_fetch');
    return { ok: true };
  });
  api.inventoryNamespaces.mockResolvedValue(KAYITLI);
  api.getClusterTree.mockResolvedValue({
    ok: true,
    tree: { prod: { ark: ['c1', 'c2'], bos: [] } },
  });
});

describe('LogX sihirbazı yönetimi', () => {
  it('LX1 Legacy: uygulama, sunucu, tarama, dosya, sunuculara dönüş, aktarım, sorgulanamadı, eksik arşiv', async () => {
    await ac();
    tikla('platform:legacy');
    expect(await adim('adim-uygulama')).toBeTruthy();
    expect(api.createRequest).toHaveBeenCalledWith('legacy');
    expect(url().get('logxRequest')).toBe('r1');
    expect(screen.getByText('Uygulama Seçimi')).toBeTruthy();
    // uygulama -> sunucu (istemci adimi); Geri uygulamaya doner
    tikla('uygulama:sec');
    expect(await propsBekle('adim-sunucu')).toMatchObject({ app: 'ODEME-APP', initialManual: [] });
    expect(screen.getByText('Sunucu Seçimi')).toBeTruthy();
    expect(screen.getByText('ODEME-APP')).toBeTruthy(); // kunye
    tikla('Geri');
    expect(await adim('adim-uygulama')).toBeTruthy();
    tikla('uygulama:sec');
    tikla('sunucu:elle');
    await waitFor(() =>
      expect(api.discoverLegacy).toHaveBeenCalledWith(
        'r1',
        'ODEME-APP',
        ['ORWASP01', 'ORWASP99'],
        true,
      ),
    );
    expect((await adim('is')).textContent).toMatch(/^11\|Dosyalar taranıyor…/);
    expect(screen.queryByRole('button', { name: 'Geri' })).toBeNull(); // is calisirken geri yok
    // tarama biter -> dosya secimi
    ilerlet({
      state: 'discovered',
      discoveryResult: { hosts: [{ host: 'ORWASP01', status: 'ok', files: [] }] },
    });
    tikla('is:bitti');
    expect(await propsBekle('adim-dosya')).toMatchObject({ manualHosts: ['ORWASP99'] });
    // Geri = sunuculara don: uygulama ve elle eklenen sunucu korunur
    tikla('Geri');
    await waitFor(() => expect(api.resetRequest).toHaveBeenCalledWith('r1', 'legacy_app'));
    expect(await propsBekle('adim-sunucu')).toMatchObject({
      app: 'ODEME-APP',
      initialManual: ['ORWASP99'],
    });
    tikla('sunucu:envanter');
    await waitFor(() =>
      expect(api.discoverLegacy).toHaveBeenLastCalledWith('r1', 'ODEME-APP', ['ORWASP01'], false),
    );
    ilerlet({ state: 'discovered', discoveryResult: { hosts: [] } });
    tikla('is:bitti');
    await adim('adim-dosya');
    // dosya ekranindan da sunuculara donulur
    tikla('dosya:sunuculara');
    await waitFor(() => expect(api.resetRequest).toHaveBeenCalledTimes(2));
    await adim('adim-sunucu');
    tikla('sunucu:envanter');
    await adim('is');
    ilerlet({ state: 'discovered', discoveryResult: { hosts: [] } });
    tikla('is:bitti');
    tikla((await adim('adim-dosya')) && 'dosya:gonder');
    await waitFor(() =>
      expect(api.transferLegacy).toHaveBeenCalledWith('r1', [
        { host: 'ORWASP01', path: '/log/a.log' },
      ]),
    );
    expect((await adim('is')).textContent).toContain("Dosyalar aktarılıyor ve zip'leniyor…");
    // is durumu sorgulanamadi: kurtarma karti; yenile yoklamayi geri getirir
    tikla('is:sorgulanamadi');
    const kart = await adim('logx-job-poll-error');
    expect(kart.textContent).toContain('AWX yanıt vermiyor');
    tikla('Durumu yenile');
    expect(await adim('is')).toBeTruthy();
    // aktarim kismi bitti: eksik arsiv ozeti
    sv.jobs = sv.jobs.map((j) =>
      j.jobType === 'legacy_transfer'
        ? {
            ...j,
            status: 'successful',
            artifacts: {
              hosts: [
                {
                  host: 'ORWASP01',
                  status: 'ok',
                  per_file_status: [
                    { path: '/log/a.log', status: 'ok' },
                    { path: '/log/b.log', status: 'error', error: 'izin yok' },
                  ],
                },
              ],
            },
          }
        : j,
    );
    sv.download = INDIR;
    sv.downloads = [INDIR];
    ilerlet({ state: 'ready' });
    tikla('is:bitti');
    expect((await propsBekle('adim-indir')).download).toEqual(INDIR);
    expect(screen.getByTestId('eksik').textContent).toContain(
      'Arşiv eksik — seçilen dosya: 2, arşive giren: 1, alınamayan: 1.',
    );
    expect(screen.getByText('İndirmeye Hazır')).toBeTruthy();
    tikla('indir:yeni');
    expect(screen.getByRole('button', { name: 'platform:legacy' })).toBeTruthy();
    expect(url().get('logxRequest')).toBeNull();
  });

  it.each([
    ['legacy', 'discovering', 'legacy_discovery', 'Log dosyası tarama', 'Dosyalar taranıyor…'],
    [
      'legacy',
      'transferring',
      'legacy_transfer',
      'Dosya aktarma',
      "Dosyalar aktarılıyor ve zip'leniyor…",
    ],
    [
      'openshift',
      'namespace_discovering',
      'ocp_namespace_discovery',
      'Namespace tarama',
      "Namespace'ler taranıyor…",
    ],
    [
      'openshift',
      'app_discovering',
      'ocp_app_discovery',
      'Uygulama tarama',
      'Namespace içindeki uygulamalar taranıyor…',
    ],
    [
      'openshift',
      'transferring',
      'ocp_discover_fetch',
      'Log toplama',
      "Pod'lar taranıyor ve loglar toplanıyor…",
    ],
  ])(
    'LX2 %s %s: iş kaydı yok ve iş durumu sorgulanamadı kartları',
    async (platform, state, jobType, etiket, yazi) => {
      sv.req = istek({
        id: 'r9',
        platform,
        state,
        input: { env: 'test', tenant: 'ark', clusters: ['c1'] },
      });
      await ac('?logxRequest=r9');
      expect(await screen.findByText(`${etiket} işinin kaydı bulunamadı.`)).toBeTruthy();
      expect(api.getRequest).toHaveBeenCalledWith('r9');
      sv.jobs = [is(jobType)];
      tikla('Durumu yenile');
      expect((await adim('is')).textContent).toContain(yazi);
      tikla('is:mesajsiz');
      expect((await adim('logx-job-poll-error')).textContent).toContain(
        'İşin durumu sorgulanamadı.',
      );
      tikla('Durumu yenile');
      await adim('is');
      // sonuc tasiyan hata sorgulanamadi sayilmaz
      tikla('is:hatali-sonuc');
      await waitFor(() => expect(api.getRequest).toHaveBeenCalledTimes(5)); // her is bitisi de yeniler
      expect(screen.queryByTestId('logx-job-poll-error')).toBeNull();
      tikla('is:sorgulanamadi');
      await adim('logx-job-poll-error');
      tikla('Baştan başla');
      expect(screen.getByRole('button', { name: 'platform:openshift' })).toBeTruthy();
      sv.req = istek({ id: 'r9', platform, state });
      sv.jobs = [];
    },
  );

  it('LX3 OpenShift: kayıtlı namespace listesi, uygulama, sepet (tekrarsız, 20 sınırı), toplama', async () => {
    await ac();
    tikla('platform:openshift');
    await adim('adim-cluster');
    expect(screen.getByText('Cluster Seçimi')).toBeTruthy();
    tikla('cluster:sec');
    await waitFor(() =>
      expect(api.selectClusters).toHaveBeenCalledWith('r2', 'prod', 'ark', ['c1', 'c2']),
    );
    await adim('adim-namespace');
    expect(api.inventoryNamespaces).toHaveBeenCalledWith('prod', 'ark', ['c1', 'c2']);
    expect(api.discoverNamespaces).not.toHaveBeenCalled();
    expect(await propsBekle('adim-namespace')).toMatchObject({
      namespaces: ['ns-a', 'ns-b'],
      failedClusters: [],
      cache: { fetchedAt: '2026-11-27T09:00:00Z', stale: false, source: 'inventory' },
      counts: { 'ns-a': 3 },
      hiddenCount: 2,
      restrictionMessage: 'Prod ortamı kısıtlı: yalnız izinli namespace listelenir.',
      selectedClusters: ['c1', 'c2'],
    });
    expect(screen.getByText('c1, c2')).toBeTruthy();
    expect(props('sepet')).toMatchObject({ targets: [], max: 20 });
    tikla('namespace:sec');
    expect(await propsBekle('adim-ocp-uygulama')).toMatchObject({
      namespace: 'ns-a',
      env: 'prod',
      tenant: 'ark',
      remainingSlots: 20,
    });
    tikla('ocp:iki');
    // sepete eklenir, namespace ekranina donulur
    expect(await adim('adim-namespace')).toBeTruthy();
    expect(props('sepet').targets).toEqual([
      { namespace: 'ns-a', appName: 'app1' },
      { namespace: 'ns-a', appName: 'app2' },
    ]);
    tikla('namespace:sec');
    expect((await propsBekle('adim-ocp-uygulama')).remainingSlots).toBe(18);
    tikla('ocp:tekrarli');
    expect(props('sepet').targets).toHaveLength(3); // app1 tekrar eklenmez
    // uygulama ekranindan Geri namespace'e doner, sepet korunur
    tikla('namespace:sec');
    tikla('Geri');
    expect(await adim('adim-namespace')).toBeTruthy();
    expect(props('sepet').targets).toHaveLength(3);
    tikla('sepet:ilkini-sil');
    expect(props('sepet').targets[0]).toEqual({ namespace: 'ns-a', appName: 'app2' });
    tikla('sepet:temizle');
    expect(props('sepet').targets).toEqual([]);
    tikla('namespace:sec');
    tikla('ocp:cok');
    expect(props('sepet').targets).toHaveLength(20);
    tikla('sepet:topla');
    await waitFor(() => expect(api.discoverFetchOcp).toHaveBeenCalledWith('r2', expect.any(Array)));
    expect(api.discoverFetchOcp.mock.calls[0][1]).toHaveLength(20);
    expect((await adim('is')).textContent).toContain("Pod'lar taranıyor ve loglar toplanıyor…");
    expect(screen.queryByTestId('sepet')).toBeNull();
  });

  it('LX4 kayıtlı listeden Geri cluster seçimine döner; aynı cluster yeniden seçilince liste yeniden gelir', async () => {
    await ac();
    tikla('platform:openshift');
    await adim('adim-cluster');
    tikla('cluster:sec');
    await adim('adim-namespace');
    tikla('Geri');
    expect(await adim('adim-cluster')).toBeTruthy();
    expect(api.resetRequest).toHaveBeenCalledWith('r2', 'ocp_cluster_select');
    api.inventoryNamespaces.mockResolvedValueOnce({
      ...KAYITLI,
      restriction: false,
      message: 'bilgi notu',
    });
    tikla('cluster:sec');
    expect(await adim('adim-namespace')).toBeTruthy();
    expect(api.inventoryNamespaces).toHaveBeenCalledTimes(2);
    // kisit yoksa sunucunun mesaji kisit aciklamasi olarak gosterilmez
    expect(props('adim-namespace').restrictionMessage).toBeUndefined();
  });

  it('LX5 canlı namespace taraması, başarısız cluster, yeniden tara, uygulama taraması; Geri ve aynı cluster', async () => {
    api.inventoryNamespaces
      .mockResolvedValueOnce({ cached: false })
      .mockRejectedValueOnce(new Error('envanter yok'));
    await ac();
    tikla('platform:openshift');
    await adim('adim-cluster');
    tikla('cluster:uc');
    expect((await adim('is')).textContent).toContain("Namespace'ler taranıyor…");
    expect(api.discoverNamespaces).toHaveBeenCalledWith('r2');
    expect(screen.getByText('3 cluster')).toBeTruthy();
    ilerlet({
      state: 'namespaces_discovered',
      discoveryResult: {
        clusters: [
          { cluster_name: 'c1', status: 'ok', namespaces: ['ns-a', 5, 'ns-c'], hiddenCount: 1 },
          { cluster_name: 'c2', status: 'failed', namespaces: [], error: '' },
          {
            cluster_name: 'c3',
            status: 'failed',
            namespaces: [],
            error: "'username' is undefined",
            hiddenCount: 2,
          },
          { cluster_name: 'c4' },
        ],
      },
    });
    tikla('is:bitti');
    expect(await adim('adim-namespace')).toBeTruthy();
    expect(await propsBekle('adim-namespace')).toMatchObject({
      namespaces: ['ns-a', 'ns-c'],
      failedClusters: ['c2', 'c3'],
      failedDetails: [
        { cluster: 'c2', error: 'Bilinmeyen hata.' },
        { cluster: 'c3', error: "'username' is undefined" },
      ],
      cache: null,
      hiddenCount: 3,
    });
    // yeniden tara
    tikla('namespace:yeniden');
    await waitFor(() => expect(api.discoverNamespaces).toHaveBeenCalledTimes(2));
    ilerlet({ state: 'namespaces_discovered' });
    tikla('is:bitti');
    await adim('adim-namespace');
    // uygulama taramasi
    tikla('namespace:sec');
    tikla('ocp:tara');
    await waitFor(() => expect(api.discoverApps).toHaveBeenCalledWith('r2', ['ns-a']));
    expect((await adim('is')).textContent).toContain('Namespace içindeki uygulamalar taranıyor…');
    ilerlet({ state: 'apps_discovered' });
    tikla('is:bitti');
    expect(await propsBekle('adim-ocp-uygulama')).toMatchObject({
      namespace: 'ns-a',
      reloadToken: 1,
    });
    // sunucuda taranan namespace kayitli olsa da sepete ekleme namespace ekranina doner
    tikla('ocp:iki');
    expect(await adim('adim-namespace')).toBeTruthy();
    expect(props('sepet').targets).toHaveLength(2);
    tikla('namespace:sec');
    // Geri: namespace, sonra cluster (sunucu geri sarilir)
    tikla('Geri');
    await adim('adim-namespace');
    tikla('Geri');
    expect(await adim('adim-cluster')).toBeTruthy();
    expect(api.resetRequest).toHaveBeenCalledWith('r2', 'ocp_cluster_select');
    // ayni cluster'lar yeniden secilir: envanter dusse de canli taramaya gecilir
    tikla('cluster:uc');
    await waitFor(() => expect(api.discoverNamespaces).toHaveBeenCalledTimes(3));
    expect(api.inventoryNamespaces).toHaveBeenCalledTimes(2);
  });

  it('LX6 kaldığı yerden devam: sunucudaki namespace; okunamayan istek; listesiz seçim adımı çözümlemeye iner', async () => {
    sv.req = istek({
      id: 'r4',
      platform: 'openshift',
      state: 'apps_discovered',
      input: { env: 'test', tenant: 'ark', clusters: ['c1'], appDiscoveryNamespaces: ['ns-z'] },
    });
    await ac('?logxRequest=r4');
    expect(await propsBekle('adim-ocp-uygulama')).toMatchObject({ namespace: 'ns-z' });
    expect(screen.getByText('ns-z')).toBeTruthy();
  });

  it('LX6a yenilenen sayfada dosya ekranından sunuculara dönüş: uygulama ve elle sunucu istekten', async () => {
    sv.req = istek({
      id: 'r11',
      state: 'discovered',
      input: { app: 'ODEME-APP', manualHosts: ['ORWASP77'] },
      discoveryResult: { hosts: [] },
    });
    await ac('?logxRequest=r11');
    expect(await propsBekle('adim-dosya')).toMatchObject({ manualHosts: ['ORWASP77'] });
    expect(screen.getByText('ODEME-APP')).toBeTruthy(); // kunye istek kaydindan
    tikla('Geri');
    expect(await propsBekle('adim-sunucu')).toMatchObject({
      app: 'ODEME-APP',
      initialManual: ['ORWASP77'],
    });
  });

  it('LX6b okunamayan istek platform seçimine düşer; listesiz namespace adımı listeyi yeniden getirir', async () => {
    api.getRequest.mockRejectedValueOnce(new Error('404'));
    await ac('?logxRequest=yok');
    expect(await screen.findByRole('button', { name: 'platform:legacy' })).toBeTruthy();
    expect(url().get('logxRequest')).toBeNull();
  });

  it('LX6c namespaces_discovered ama liste yok: çözümleme kayıtlı listeyi getirir', async () => {
    sv.req = istek({
      id: 'r5',
      platform: 'openshift',
      state: 'namespaces_discovered',
      input: { env: 'prod', tenant: 'ark', clusters: ['c1'] },
    });
    await ac('?logxRequest=r5');
    expect(await adim('adim-namespace')).toBeTruthy();
    expect(api.inventoryNamespaces).toHaveBeenCalledWith('prod', 'ark', ['c1']);
  });

  it('LX6d başarısız Legacy aktarım: sebepler, sunuculara dönüş; keşif başarısızlığı; OpenShift ham hata çevrilir', async () => {
    sv.req = istek({
      id: 'r6',
      state: 'failed',
      input: { app: 'ODEME-APP' },
      errorMessage: 'Aktarım başarısız.',
    });
    sv.jobs = [
      is('legacy_discovery', { status: 'successful' }),
      is('legacy_transfer', {
        status: 'failed',
        artifacts: {
          error: 'parçalar birleştirilemedi',
          hosts: [
            {
              host: 'ORWASP02',
              status: 'unreachable',
              error: 'ssh zaman aşımı',
              per_file_status: [{ path: '/a' }],
            },
            {
              host: 'ORWASP04',
              status: 'ok',
              per_file_status: [{ path: '/log/b.log', status: 'error', error: 'izin yok' }],
            },
          ],
        },
      }),
    ];
    await ac('?logxRequest=r6');
    await adim('adim-hata');
    expect(await propsBekle('adim-hata')).toMatchObject({
      jobId: sv.jobs[1].id,
      message: 'Aktarım başarısız.',
    });
    expect(screen.getByTestId('logx-basarisizlik-sebepleri').textContent).toContain(
      'Dosya alınamayan sunucular',
    );
    const sebepler = screen.getByTestId('logx-basarisizlik-sebepleri').textContent!;
    expect(sebepler).toContain('ORWASP02');
    expect(sebepler).toContain('/log/b.log'); // dosya duzeyi sorun (aktarim sonucu)
    expect(sebepler).toContain('parçalar birleştirilemedi');
    expect(screen.getByText('Hata')).toBeTruthy();
    tikla('hata:sunuculara');
    await waitFor(() => expect(api.resetRequest).toHaveBeenCalledWith('r6', 'legacy_app'));
    expect(await propsBekle('adim-sunucu')).toMatchObject({ app: 'ODEME-APP' });
  });

  it('LX6e keşif başarısızlığı ve OpenShift ham hatası; süresi dolmuş / arşivsiz istek', async () => {
    sv.req = istek({ id: 'r7', state: 'failed', input: null, errorMessage: null });
    sv.jobs = [
      is('legacy_discovery', {
        status: 'failed',
        artifacts: { hosts: [{ host: 'ORWASP03', status: 'error', error: 'find yok' }] },
      }),
    ];
    await ac('?logxRequest=r7');
    await adim('adim-hata');
    expect((await propsBekle('adim-hata')).message).toBe(
      'İşlem tamamlanamadı. Lütfen sistem yöneticinize başvurun.',
    );
    expect(screen.getByTestId('logx-basarisizlik-sebepleri').textContent).toContain(
      'Taranamayan sunucular',
    );
    expect(screen.queryByRole('button', { name: 'hata:sunuculara' })).toBeNull(); // input.app yok
    tikla('hata:bastan');
    expect(screen.getByRole('button', { name: 'platform:legacy' })).toBeTruthy();
  });

  it('LX6f OpenShift ham hata çevrilir ve ham metin teknik ayrıntıda kalır', async () => {
    const ham =
      'error: Missing or incomplete configuration info. Please point to an existing, complete config file';
    sv.req = istek({ id: 'r8', platform: 'openshift', state: 'failed', errorMessage: ham });
    await ac('?logxRequest=r8');
    await adim('adim-hata');
    const p = props('adim-hata');
    expect(p.message).not.toBe(ham);
    expect(p.technicalDetail).toBe(ham);
    expect(screen.queryByTestId('logx-basarisizlik-sebepleri')).toBeNull();
  });

  it.each([
    ['expired', null, 'Bu isteğin süresi doldu; indirme bağlantısı artık geçerli değil.'],
    ['ready', null, 'İstek tamamlandı ama indirilecek arşiv bulunamadı (temizlenmiş olabilir).'],
  ])('LX6g %s istek (indirme yok)', async (state, _d, metin) => {
    sv.req = istek({ id: 'r10', state });
    await ac('?logxRequest=r10');
    expect((await adim('logx-suresi-doldu')).textContent).toContain(metin);
    tikla('Yeni istek başlat');
    expect(screen.getByRole('button', { name: 'platform:legacy' })).toBeTruthy();
  });

  it('LX6h başlatma hatası ve iş durumu sorgulanamayınca teknik ayrıntı hata ekranına taşınır', async () => {
    api.createRequest.mockRejectedValueOnce(new Error('Portal erişilemedi'));
    await ac();
    tikla('platform:legacy');
    expect(await screen.findByText('Portal erişilemedi')).toBeTruthy();
    // ikinci deneme
    tikla('platform:openshift');
    await adim('adim-cluster');
    expect(screen.queryByText('Portal erişilemedi')).toBeNull();
    // ocp aktarim sorgulanamadi -> yenile -> istek basarisiz: teknik ayrinti tasinir
    tikla('cluster:sec');
    await adim('adim-namespace');
    tikla('namespace:sec');
    tikla('ocp:iki');
    await adim('adim-namespace');
    tikla('sepet:topla');
    await adim('is');
    tikla('is:sorgulanamadi');
    await adim('logx-job-poll-error');
    ilerlet({ state: 'failed', errorMessage: 'pod bulunamadı' });
    tikla('Durumu yenile');
    await adim('adim-hata');
    expect(await propsBekle('adim-hata')).toMatchObject({
      message: 'pod bulunamadı',
      technicalDetail: 'iz: 502',
    });
  });

  it('LX7 derin bağlantı: Legacy uygulaması otomatik seçilir (bir kez)', async () => {
    await ac('?platform=legacy&app=ODEME-APP');
    expect(await adim('adim-uygulama')).toBeTruthy();
    expect(api.createRequest).toHaveBeenCalledWith('legacy');
    expect(await propsBekle('adim-uygulama')).toMatchObject({
      initialSearch: 'ODEME-APP',
      autoSelectExact: true,
    });
    expect(url().get('platform')).toBeNull(); // on-secim parametreleri silinir
    tikla('uygulama:sec');
    tikla('Geri');
    expect(await propsBekle('adim-uygulama')).toMatchObject({ autoSelectExact: false });
  });

  it.each([
    [
      '?platform=openshift&env=uat&tenant=ark&namespace=ns-a&app=x',
      "Bağlantıdaki ortam “uat” tanımlı değil — cluster'ı elle seçin.",
      'adim-cluster',
    ],
    [
      '?platform=openshift&env=PROD&tenant=yok&namespace=ns-a&app=x',
      "Bağlantıdaki tenant “yok” prod ortamında yok — cluster'ı elle seçin.",
      'adim-cluster',
    ],
    [
      '?platform=openshift&env=prod&tenant=ark&cluster=c9&namespace=ns-a&app=x',
      "Bağlantıdaki cluster “c9” prod / ark grubunda yok — cluster'ı elle seçin.",
      'adim-cluster',
    ],
    [
      '?platform=openshift&env=prod&tenant=bos&namespace=ns-a&app=x',
      "prod / bos için aktif cluster yok — cluster'ı elle seçin.",
      'adim-cluster',
    ],
    [
      '?platform=openshift&env=prod&tenant=ark&cluster=C1&namespace=ns-q&app=x',
      "“ns-q” seçilen cluster'ların namespace listesinde yok (ya da erişiminiz yok) — namespace'i listeden seçin.",
      'adim-namespace',
    ],
  ])('LX7b OpenShift derin bağlantı uyarısı %#', async (arama, uyari, adimId) => {
    await ac(arama);
    expect((await screen.findByTestId('logx-ondolum-uyari')).textContent).toContain(uyari);
    expect(await adim(adimId)).toBeTruthy();
    tikla('Kapat');
    expect(screen.queryByTestId('logx-ondolum-uyari')).toBeNull();
  });

  it('LX7c OpenShift derin bağlantı: namespace listede (harf duyarsız) ve liste okunamazsa doğrudan uygulama', async () => {
    await ac('?platform=openshift&env=prod&tenant=ark&namespace=NS-B&app=odeme');
    expect(await propsBekle('adim-ocp-uygulama')).toMatchObject({
      namespace: 'ns-b',
      initialSearch: 'odeme',
    });
    expect(api.selectClusters).toHaveBeenCalledWith('r2', 'prod', 'ark', ['c1', 'c2']);
  });

  it('LX7d OpenShift derin bağlantı: kayıtlı liste yoksa namespace olduğu gibi kullanılır', async () => {
    api.inventoryNamespaces.mockResolvedValue({ cached: false });
    await ac('?platform=openshift&env=prod&tenant=ark&cluster=c2&namespace=ns-x&app=odeme');
    expect(await propsBekle('adim-ocp-uygulama')).toMatchObject({
      namespace: 'ns-x',
      initialSearch: 'odeme',
    });
    expect(api.selectClusters).toHaveBeenCalledWith('r2', 'prod', 'ark', ['c2']);
    // sepete ekleyince on-arama tukenir; kayitli liste olmadigi icin namespace'ler canli taranir
    tikla('ocp:iki');
    // secim adimindayken sepet gorunur; tarama baslayinca gizlenir
    expect(props('sepet').targets).toEqual([
      { namespace: 'ns-x', appName: 'app1' },
      { namespace: 'ns-x', appName: 'app2' },
    ]);
    expect((await adim('is')).textContent).toContain("Namespace'ler taranıyor…");
  });
});
