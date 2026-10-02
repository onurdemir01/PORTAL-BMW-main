// src/__tests__/crypto-hub-olculemedi.test.tsx — "ölçülemedi" ile "chart varsayılanı / yok"
// ekranda KARIŞMAZ (doğrulayıcı bulgusu, 2026-10-02).
//
// Girdiler bastion yardımcısının GERÇEK çıktısı (crypto_hub_resources.py, 2026-10-02 koşusu;
// biçimi Ansible bekçisi check_crypto_hub_resources.py get_dosya_okunamadi kilitler) ve
// Portal'ın GERÇEK ayrıştırıcısından (server/crypto-hub/resources.cjs) geçer:
//   O1 UTF-8 olmayan dosya: RESCHK dosya-oku dur + RESERR dosya → dört alan "ölçülemedi"
//   O2 girintide TAB: RESFILE … OKUNAMADI + RESERR dosya → "ölçülemedi"
//   O3 TAB başka bileşende, bu bileşenin satırı yok → yine "ölçülemedi" (güvenli taraf)
//   O4 canlı yardımcısı düştü (RESERR canli-oku) → canlı "ölçülemedi", "canlıda bu kap yok" DEĞİL
//   O5 sonuç kodları (ES_YAZILAMADI, KUME_GERI_ALINAMADI) ve süresi dolan jeton ayrı söylenir
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ResourcesModal } from '@/components/crypto_hub/ResourcesModal';
import type { CryptoTenant } from '@/api/cryptoHubApi';
import { parseResourceLines } from '../../server/crypto-hub/resources.cjs';

const m = vi.hoisted(() => ({ run: vi.fn(), result: vi.fn() }));
vi.mock('@/api/cryptoHubApi', () => ({ cryptoOpsApi: { run: m.run, result: m.result } }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { username: 'ali', role: 'User' } }) }));

const T = 'wyden_qa_h2';
const TAB = '\t';
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
const satir = (...f: string[]) => f.join(TAB);
const BAS = [
  satir('RESTOOL', T, 'python3', 'var', '3.6.8'),
  satir('RESREL', T, 'wydenapp', '1.5.19'),
  satir('RESLR', T, '-', '-', '-', '-', 'YOK'),
  satir('RESQUOTA', T, '-', '-', '-', 'YOK'),
  satir('RESSRC', T, WYDEN.resValuesPath, 'okundu', 'dogrulanmadi', H('a'), '1234', 'evet', 'yalniz resources satirlari doner'),
];
const CANLI = [
  satir('RESWL', T, 'Deployment', 'wydenapp-access-gateway', '2', '2', 'RollingUpdate', 'wydenapp'),
  satir('RESLIVE', T, 'Deployment', 'wydenapp-access-gateway', 'app', 'kap', '500m', 'YOK', '2', '2Gi'),
];
const SON = (sonuc: string, kod: string) => satir('RESEND', T, 'resources_get', sonuc, kod);
// Yardımcının gerçek çıktısı (bkz. dosya başı).
const LATIN1 = [
  satir('RESCHK', T, 'dosya-oku', 'dur', 'dosya UTF-8 degil'),
  satir('RESERR', T, 'dosya', 'dosya okunamadi (degerler OLCULEMEDI): dosya UTF-8 degil'),
];
const TABLI = [
  ...['requests.cpu', 'requests.memory', 'limits.cpu', 'limits.memory'].map((a) =>
    satir('RESFILE', T, 'access-gateway', a, 'OKUNAMADI', '-'),
  ),
  satir('RESERR', T, 'dosya', '1 satirda girintide TAB var (YAML gecersiz, helm de okuyamaz) - su ust anahtarlardaki degerler OKUNAMADI: access-gateway'),
];
const CANLI_COKTU = [
  satir('RESERR', T, 'canli-oku', 'yardimci hatasi: JSONDecodeError: Expecting value: line 1 column 12 (char 11)'),
];
const DOSYA_OK = [
  satir('RESFILE', T, 'access-gateway', 'requests.cpu', '500m', '44'),
  satir('RESFILE', T, 'access-gateway', 'requests.memory', 'YOK', '-'),
  satir('RESFILE', T, 'access-gateway', 'limits.cpu', '2', '47'),
  satir('RESFILE', T, 'access-gateway', 'limits.memory', '2Gi', '48'),
];
const ALANLAR = ['requests.cpu', 'requests.memory', 'limits.cpu', 'limits.memory'];

const sonuc = (lines: string[]) => ({
  ok: true,
  status: 'successful',
  result: { pods: [], logs: [], results: [], errors: [], resources: parseResourceLines(lines) },
});

function ac(lines: string[]) {
  m.result.mockResolvedValue(sonuc(lines));
  render(<ResourcesModal tenant={WYDEN} tenantLabel="QA" kind="Deployment" name="wydenapp-access-gateway" onClose={() => {}} />);
}

beforeEach(() => {
  m.run.mockReset();
  m.result.mockReset();
  m.run.mockResolvedValue({ ok: true, jobId: 5, awxServerId: 1 });
});

describe('Crypto Hub CPU/bellek: ölçülemedi ≠ chart varsayılanı / yok', () => {
  it('O1 UTF-8 olmayan dosya: dört alan "ölçülemedi"; önizle kapalı', async () => {
    ac([...BAS, ...CANLI, ...LATIN1, SON('kismi', 'OLCULEMEDI')]);
    await screen.findByTestId('dosya-limits.memory');
    for (const a of ALANLAR) {
      expect(screen.getByTestId(`dosya-${a}`)).toHaveTextContent('ölçülemedi');
      expect(screen.getByTestId(`dosya-${a}`)).not.toHaveTextContent('chart varsayılanı');
    }
    fireEvent.change(screen.getByLabelText('yeni limits.memory'), { target: { value: '3Gi' } });
    expect(screen.getByRole('button', { name: 'Önizle' })).toBeDisabled();
  });

  it('O2 girintide TAB: OKUNAMADI satırları "ölçülemedi"', async () => {
    ac([...BAS, ...CANLI, ...TABLI, SON('kismi', 'OLCULEMEDI')]);
    await screen.findByTestId('dosya-limits.cpu');
    for (const a of ALANLAR) expect(screen.getByTestId(`dosya-${a}`)).toHaveTextContent('ölçülemedi');
  });

  it('O3 TAB başka bileşende ve bu bileşenin satırı yok: yine "ölçülemedi" (dosyada yok DEĞİL)', async () => {
    const baska = TABLI.map((l) => l.split('access-gateway').join('booking'));
    ac([...BAS, ...CANLI, ...baska, SON('kismi', 'OLCULEMEDI')]);
    await screen.findByTestId('dosya-requests.memory');
    for (const a of ALANLAR) {
      expect(screen.getByTestId(`dosya-${a}`)).toHaveTextContent('ölçülemedi');
      expect(screen.getByTestId(`dosya-${a}`)).not.toHaveTextContent('chart varsayılanı');
    }
  });

  it('O3b korluk kolu: hata yoksa satırı olmayan alan "chart varsayılanı" kalır', async () => {
    ac([...BAS, ...CANLI, ...DOSYA_OK, SON('ok', '-')]);
    await screen.findByTestId('dosya-requests.memory');
    expect(screen.getByTestId('dosya-requests.memory')).toHaveTextContent('chart varsayılanı');
    expect(screen.getByTestId('dosya-limits.memory')).toHaveTextContent('2Gi');
  });

  it('O4 canlı yardımcısı düştü: canlı "ölçülemedi", "canlıda bu kap yok" DEĞİL', async () => {
    ac([...BAS, ...CANLI_COKTU, ...DOSYA_OK, SON('kismi', 'OLCULEMEDI')]);
    await screen.findByTestId('canli-limits.memory');
    for (const a of ALANLAR) expect(screen.getByTestId(`canli-${a}`)).toHaveTextContent('ölçülemedi');
    expect(screen.queryByText(/canlıda bu kap yok/)).toBeNull();
    expect(screen.getByText(/canlıda bu kap ölçülemedi/)).toBeInTheDocument();
  });

  it('O5 uygulama sonuç kodları ayrı söylenir; süresi dolan jeton açıkça yazılır', async () => {
    const jeton = H('c');
    const plan = [
      ...BAS,
      ...CANLI,
      ...DOSYA_OK,
      satir('RESAFFECT', T, 'StatefulSet', 'wydenapp-aeron-cluster', 'RollingUpdate', '3', 'evet', 'bekleyen'),
      satir('RESPLAN', T, 'ok', '-', H('a'), H('d'), H('e'), 'abcdef0123456789', 'evet', H('f')),
      satir('RESEND', T, 'resources_plan', 'ok', '-'),
    ];
    const uyg = [
      satir('RESSTEP', T, 'upgrade', 'ok', 'gecti'),
      satir('RESSTEP', T, 'kume_geri_alma', 'olculemedi', 'helm history okunamadi'),
      satir('RESSTEP', T, 'es_yazim', 'atlandi', 'wyden_qa_h3: es dosya onizlemeden sonra degisti - YAZILMADI'),
      satir('RESEND', T, 'resources_apply', 'uygulandi_sorunlu', 'GOZLEM,ES_YAZILAMADI'),
    ];
    m.result
      .mockResolvedValueOnce(sonuc([...BAS, ...CANLI, ...DOSYA_OK, SON('ok', '-')]))
      .mockResolvedValueOnce({ ...sonuc(plan), result: { ...sonuc(plan).result, resources: { ...parseResourceLines(plan), planJetonu: jeton, planBitis: Date.now() + 60000, planJetonDurumu: 'ok' } } })
      .mockResolvedValueOnce(sonuc(uyg));
    render(<ResourcesModal tenant={WYDEN} tenantLabel="QA" kind="Deployment" name="wydenapp-access-gateway" onClose={() => {}} />);
    await screen.findByTestId('dosya-limits.memory');
    fireEvent.change(screen.getByLabelText('yeni limits.memory'), { target: { value: '3Gi' } });
    fireEvent.click(screen.getByRole('button', { name: 'Önizle' }));
    await screen.findByTestId('plan-sonuc');
    expect(screen.getAllByText(/bekleyen fark nedeniyle/).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: 'Uygula…' }));
    fireEvent.click(await screen.findByLabelText('riskli bileşen onayı'));
    fireEvent.click(screen.getByLabelText('bekleyen fark onayı'));
    fireEvent.click(screen.getByRole('button', { name: 'Onayla ve uygula' }));
    expect(await screen.findByTestId('sonuc-kod-ES_YAZILAMADI')).toHaveTextContent(/ayrıştı/);
    expect(screen.getByTestId('sonuc-kod-GOZLEM')).toBeInTheDocument();
    expect(screen.getByText(/kume_geri_alma: helm history okunamadi/).closest('li')).toHaveTextContent('ölçülemedi');
  });

  it('O5b süresi dolmuş plan: jeton yok, "süresi doldu" yazılır, uygula kapalı', async () => {
    const plan = [...BAS, ...CANLI, ...DOSYA_OK, satir('RESPLAN', T, 'ok', '-', H('a'), H('d'), H('e'), '-', 'hayir', H('f')), satir('RESEND', T, 'resources_plan', 'ok', '-')];
    m.result
      .mockResolvedValueOnce(sonuc([...BAS, ...CANLI, ...DOSYA_OK, SON('ok', '-')]))
      .mockResolvedValueOnce({ ...sonuc(plan), result: { ...sonuc(plan).result, resources: { ...parseResourceLines(plan), planJetonu: null, planBitis: null, planJetonDurumu: 'suresi_doldu' } } });
    render(<ResourcesModal tenant={WYDEN} tenantLabel="QA" kind="Deployment" name="wydenapp-access-gateway" onClose={() => {}} />);
    await screen.findByTestId('dosya-limits.memory');
    fireEvent.change(screen.getByLabelText('yeni limits.memory'), { target: { value: '3Gi' } });
    fireEvent.click(screen.getByRole('button', { name: 'Önizle' }));
    expect(await screen.findByText(/süresi doldu/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Uygula…' })).toBeDisabled();
  });
});
