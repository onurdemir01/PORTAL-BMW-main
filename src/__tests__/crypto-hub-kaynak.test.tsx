// src/__tests__/crypto-hub-kaynak.test.tsx — Crypto Hub CPU/bellek penceresi (2026-10-02).
//
//   V1 Metaco / prod / values dosyası tanımsız: önizle-uygula KAPALI, açık mesaj (gösterim açık)
//   V2 değerin KAYNAĞI: dosya · chart varsayılanı · ölçülemedi — "ölçülemedi" "chart varsayılanı"
//      ya da "yok" DEĞİLDİR; LimitRange okunamadıysa "ölçülemedi" (yok/geçti değil)
//   V3 eş dosya tanımsızsa "eş dosya tanımlı değil"
//   V4 birim: 4G (onluk) reddedilir, önizle kapalı
//   V5 önizle → onayla → uygula: gövdede yol/içerik YOK; riskli onay kutusu işaretlenmeden
//      uygulanmaz; uygulama YALNIZ plan jetonuyla
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ResourcesModal } from '@/components/crypto_hub/ResourcesModal';
import type { CryptoTenant } from '@/api/cryptoHubApi';

const m = vi.hoisted(() => ({ run: vi.fn(), result: vi.fn() }));
vi.mock('@/api/cryptoHubApi', () => ({ cryptoOpsApi: { run: m.run, result: m.result } }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { username: 'ali', role: 'User' } }) }));

const T = 'wyden_qa_h2';
const H = (n: string) => n.repeat(64).slice(0, 64);
const WYDEN: CryptoTenant = {
  key: T,
  app: 'wyden',
  appLabel: 'Wyden',
  domain: 'gar',
  domainLabel: 'GAR',
  env: 'qa',
  envLabel: 'QA (Pendik Hall2)',
  production: false,
  bastion: 'gbaocp01',
  cluster: 'giocp3rdwytest1',
  apiUrl: 'https://api.giocp3rdwytest1.x:6443',
  namespace: 'gih-das-trading-wyden-qa',
  helmRelease: 'wydenapp',
  chartRef: 'x',
  chartName: 'wyden/wyden',
  resValuesPath: '/vhosting/setup-wyden/4-wyden/qa/1.5.19/clqa1/garanti_values.yaml',
  resValuesVerified: false,
  resPeerTenants: ['wyden_qa_h3'],
};

const bos = {
  tools: [],
  release: null,
  workloads: [],
  checks: [],
  edits: [],
  diffs: [],
  affect: [],
  pending: [],
  drift: [],
  repl: [],
  plan: null,
  steps: [],
  obs: [],
};
function getRes(ek: Record<string, unknown> = {}) {
  return {
    ...bos,
    src: { yol: WYDEN.resValuesPath, durum: 'okundu', dogrulama: 'dogrulanmadi', sha256: H('a'), bayt: 10, yazilabilir: 'evet', aciklama: '' },
    files: [
      { bilesen: 'access-gateway', alan: 'requests.cpu', deger: '500m', satir: 44 },
      { bilesen: 'access-gateway', alan: 'requests.memory', deger: 'YOK', satir: null },
      { bilesen: 'access-gateway', alan: 'limits.cpu', deger: '2', satir: 47 },
      { bilesen: 'access-gateway', alan: 'limits.memory', deger: '2Gi', satir: 48 },
    ],
    live: [
      { kind: 'Deployment', ad: 'wydenapp-access-gateway', kap: 'app', tur: 'kap', 'requests.cpu': '500m', 'requests.memory': null, 'limits.cpu': '2', 'limits.memory': '2Gi' },
    ],
    limitRange: { durum: 'yok', kurallar: [] },
    quota: { durum: 'yok', satirlar: [] },
    peers: [{ kiraci: 'wyden_qa_h3', yol: '/vhosting/x', durum: 'tanimli', sha256: H('b'), mesaj: '' }],
    errors: [],
    end: { islem: 'resources_get', sonuc: 'ok', kod: '' },
    ...ek,
  };
}
const sonuc = (resources: unknown) => ({ ok: true, status: 'successful', result: { pods: [], logs: [], results: [], errors: [], resources } });

beforeEach(() => {
  m.run.mockReset();
  m.result.mockReset();
  m.run.mockResolvedValue({ ok: true, jobId: 5, awxServerId: 1 });
});

describe('Crypto Hub CPU/bellek penceresi', () => {
  it('V1 Metaco: önizle/uygula KAPALI, açık mesaj; değerler yine okunur', async () => {
    m.result.mockResolvedValue(sonuc(getRes({ files: [], live: [] })));
    const metaco = { ...WYDEN, key: 'metaco_das_test', app: 'metaco', chartName: '', resValuesPath: '', helmRelease: 'hmz' };
    render(<ResourcesModal tenant={metaco} tenantLabel="Metaco" kind="Deployment" name="hmz-harmonize-api" onClose={() => {}} />);
    expect(await screen.findByTestId('kaynak-kapali')).toHaveTextContent(/chart bastion diskindeki/);
    await waitFor(() => expect(m.run).toHaveBeenCalledTimes(1));
    expect(m.run.mock.calls[0][0].action).toBe('resources_get');
    expect(screen.getByRole('button', { name: 'Önizle' })).toBeDisabled();
  });

  it('V1b production: değerler okunur ama yeni değer girilemez, önizle kapalı', async () => {
    m.result.mockResolvedValue(sonuc(getRes()));
    const prod = { ...WYDEN, key: 'wyden_prod_h3', production: true };
    render(<ResourcesModal tenant={prod} tenantLabel="Prod" kind="Deployment" name="wydenapp-access-gateway" onClose={() => {}} />);
    expect(await screen.findByTestId('kaynak-kapali')).toHaveTextContent(/Production/);
    expect(await screen.findByTestId('dosya-limits.memory')).toHaveTextContent('2Gi');
    expect(screen.getByLabelText('yeni limits.memory')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Önizle' })).toBeDisabled();
  });

  it('V2 değerin kaynağı: dosya / chart varsayılanı / ölçülemedi; LimitRange okunamadı = ölçülemedi', async () => {
    m.result.mockResolvedValue(
      sonuc(getRes({ limitRange: { durum: 'olculemedi', kurallar: [] }, errors: [{ asama: 'limitrange', mesaj: 'Forbidden' }] })),
    );
    render(<ResourcesModal tenant={WYDEN} tenantLabel="QA" kind="Deployment" name="wydenapp-access-gateway" onClose={() => {}} />);
    expect(await screen.findByTestId('dosya-limits.memory')).toHaveTextContent('2Gi');
    expect(screen.getByTestId('dosya-limits.memory')).toHaveTextContent('dosya');
    expect(screen.getByTestId('dosya-requests.memory')).toHaveTextContent('chart varsayılanı');
    expect(screen.getByTestId('canli-requests.memory')).toHaveTextContent(/yok/);
    const lr = screen.getByTestId('limitrange');
    expect(lr).toHaveTextContent('ölçülemedi');
    expect(lr).not.toHaveTextContent('yok (ölçüldü)');
  });

  it('V2b dosya okunamadıysa "ölçülemedi" — "chart varsayılanı" DEĞİL; önizle kapalı', async () => {
    m.result.mockResolvedValue(
      sonuc(getRes({ src: { yol: WYDEN.resValuesPath, durum: 'olculemedi', dogrulama: '', sha256: '', bayt: null, yazilabilir: '', aciklama: 'izin' }, files: [] })),
    );
    render(<ResourcesModal tenant={WYDEN} tenantLabel="QA" kind="Deployment" name="wydenapp-access-gateway" onClose={() => {}} />);
    const h = await screen.findByTestId('dosya-requests.memory');
    expect(h).toHaveTextContent('ölçülemedi');
    expect(h).not.toHaveTextContent('chart varsayılanı');
    fireEvent.change(screen.getByLabelText('yeni limits.memory'), { target: { value: '3Gi' } });
    expect(screen.getByRole('button', { name: 'Önizle' })).toBeDisabled();
  });

  it('V3 eş dosya tanımsız: "eş dosya tanımlı değil"', async () => {
    m.result.mockResolvedValue(
      sonuc(getRes({ peers: [{ kiraci: 'wyden_qa_h3', yol: '', durum: 'tanimsiz', sha256: '', mesaj: 'es dosya tanimli degil (katalog)' }] })),
    );
    render(<ResourcesModal tenant={WYDEN} tenantLabel="QA" kind="Deployment" name="wydenapp-access-gateway" onClose={() => {}} />);
    expect(await screen.findByText(/eş dosya tanımlı değil/)).toBeInTheDocument();
  });

  it('V4 birim: 4G onluk birim reddedilir, önizle kapalı', async () => {
    m.result.mockResolvedValue(sonuc(getRes()));
    render(<ResourcesModal tenant={WYDEN} tenantLabel="QA" kind="Deployment" name="wydenapp-access-gateway" onClose={() => {}} />);
    await screen.findByTestId('dosya-limits.memory');
    fireEvent.change(screen.getByLabelText('yeni limits.memory'), { target: { value: '4G' } });
    expect(screen.getByText(/standart biçimde değil/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Önizle' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('yeni limits.memory'), { target: { value: '3Gi' } });
    expect(screen.getByRole('button', { name: 'Önizle' })).toBeEnabled();
  });

  it('V5 önizle → onayla → uygula: gövdede yol/içerik yok; riskli onay şart; yalnız jetonla', async () => {
    const jeton = H('c');
    m.result
      .mockResolvedValueOnce(sonuc(getRes()))
      .mockResolvedValueOnce(
        sonuc({
          ...getRes(),
          checks: [{ kontrol: 'limitrange', durum: 'olculemedi', mesaj: 'okunamadi' }],
          affect: [{ kind: 'Deployment', ad: 'wydenapp-access-gateway', strateji: 'RollingUpdate', replika: '2', riskli: true }],
          plan: { durum: 'ok', kod: '', dosyaSha: H('a'), yeniSha: H('d'), chartSha: H('e'), bekleyen: '', riskli: true, jeton: H('f') },
          planJetonu: jeton,
          planBitis: Date.now() + 900000,
          end: { islem: 'resources_plan', sonuc: 'ok', kod: '' },
        }),
      )
      .mockResolvedValueOnce(
        sonuc({ ...getRes(), steps: [{ adim: 'upgrade', durum: 'ok', mesaj: 'gecti' }], end: { islem: 'resources_apply', sonuc: 'uygulandi', kod: '' } }),
      );
    render(<ResourcesModal tenant={WYDEN} tenantLabel="QA" kind="Deployment" name="wydenapp-access-gateway" onClose={() => {}} />);
    await screen.findByTestId('dosya-limits.memory');
    fireEvent.change(screen.getByLabelText('yeni limits.memory'), { target: { value: '3Gi' } });
    fireEvent.click(screen.getByRole('button', { name: 'Önizle' }));
    await screen.findByTestId('plan-sonuc');
    const plan = m.run.mock.calls[1][0];
    expect(plan).toMatchObject({
      tenant: T,
      action: 'resources_plan',
      component: 'access-gateway',
      container: 'app',
      kind: 'Deployment',
      name: 'wydenapp-access-gateway',
      changes: [{ alan: 'limits.memory', eski: '2Gi', yeni: '3Gi' }],
    });
    for (const k of ['valuesPath', 'content', 'release', 'valuesPaths']) expect(plan).not.toHaveProperty(k);
    expect(screen.getByText(/ölçülemedi/, { selector: 'span' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Uygula…' }));
    const onayla = await screen.findByRole('button', { name: 'Onayla ve uygula' });
    expect(onayla).toBeDisabled();
    fireEvent.click(screen.getByLabelText('riskli bileşen onayı'));
    expect(onayla).toBeEnabled();
    fireEvent.click(onayla);
    await screen.findByTestId('uygula-sonuc');
    const ap = m.run.mock.calls[2][0];
    expect(ap).toMatchObject({ action: 'resources_apply', confirmed: true, planToken: jeton, riskyAck: true });
    for (const k of ['component', 'changes', 'valuesPath', 'content']) expect(ap).not.toHaveProperty(k);
    expect(screen.getByRole('button', { name: /Geri al/ })).toBeInTheDocument();
  });
});
