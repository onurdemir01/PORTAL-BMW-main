// src/__tests__/crypto-hub-node.test.tsx — Crypto Hub > "Indexer / Node" ekranı (2026-11-02).
//
//   U1 liste: gruplar, rozetler, bekleyen bant, kapalı "Değiştir" + title; yalnız-okuma kullanıcı;
//      node-only kullanıcıda YALNIZ "Indexer / Node" sekmesi ve /overview ÇAĞRILMAZ (D5)
//   U2 sihirbaz: kullanımda / çözülemedi seçilemez; tutarsızlık onayı; gerekçe sınırı; production
//      ad yazdırma (parça eşleşmesi yetmez); "İptal"; bayat okumada otomatik okuma ve okuma sonrası
//      engel çıkarsa sihirbaz kapanır; gövdede DEĞER yok
//   U3 takip: Smart durum adı aynen + son tarih; kapalı durum metni + sonuç tablosu; Ankara önerisi
//      yalnız metaco_das_prod'da, kapalıysa düğme kapalı; Ankara bağlantısı sihirbazı aynı grupla
//      açar ve esTalepId gönderir (D4)
//   U4 yapı: her tablo overflow-x-auto içinde; yeni dosyalarda sabit renk yok
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import fs from 'node:fs';
import path from 'node:path';
import type {
  CryptoNodesResponse,
  NodeDep,
  NodeEnv,
  NodeGrup,
  NodeTalepOzet,
} from '@/api/cryptoHubApi';

const m = vi.hoisted(() => ({
  nodes: vi.fn(),
  read: vi.fn(),
  readStatus: vi.fn(),
  change: vi.fn(),
  changeDetail: vi.fn(),
  smartOnizle: vi.fn(),
  tenants: vi.fn(),
  actions: vi.fn(),
  overview: vi.fn(),
  takip: vi.fn(),
}));
vi.mock('@/api/cryptoHubApi', () => ({
  cryptoNodeApi: {
    nodes: m.nodes,
    read: m.read,
    readStatus: m.readStatus,
    change: m.change,
    changeDetail: m.changeDetail,
    smartOnizle: m.smartOnizle,
  },
  cryptoHubApi: {
    tenants: m.tenants,
    actions: m.actions,
    overview: m.overview,
    rescan: vi.fn(),
    plan: vi.fn(),
    jobStatus: vi.fn(),
  },
  cryptoOpsApi: { run: vi.fn(), result: vi.fn(), valuesApply: vi.fn() },
}));
vi.mock('@/components/opsx/useOnaySonrasiTakip', () => ({
  useOnaySonrasiTakip: (...a: unknown[]) => m.takip(...a),
}));
vi.mock('@/contexts/JobTrackerContext', () => ({ useJobTracker: () => ({ addJob: vi.fn() }) }));
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: { username: 'ali', role: 'User' } }),
}));

import { NodePanel } from '@/components/crypto_hub/NodePanel';
import { NodeTakip } from '@/components/crypto_hub/NodeTakip';
import CryptoHubPage from '@/components/crypto_hub/CryptoHubPage';

const UIS = 'uis:evm-ethereum-mainnet';
const H = (c: string) => c.repeat(64);
const SIR = 'SIRSIR123';

const dep = (ad: string, bilesen: NodeDep['bilesen'], ek: Partial<NodeDep> = {}): NodeDep => ({
  ad,
  bilesen,
  durum: 'running',
  istenen: 1,
  hazir: 1,
  gitops: 'hayir',
  nodeBagli: true,
  ...ek,
});
const env = (deployment: string, ek: Partial<NodeEnv> = {}): NodeEnv => ({
  deployment,
  container: 'app',
  env: 'ETH_INDEXER_NODE_URI',
  rol: 'rpc',
  kaynak: 'literal',
  maskeli: 'https://eth-a.example.net/****',
  sha: H('a'),
  katalogId: 'das_test_eth_a',
  helm: 'hayir',
  ...ek,
});
const AD = 'hmz-harmonize-uis-adapter-evm-ethereum-mainnet';
const IX = 'hmz-harmonize-uis-indexer-evm-ethereum-mainnet';
const API = 'hmz-harmonize-uis-api-evm-ethereum-mainnet';

function uisGrup(ek: Partial<NodeGrup> = {}): NodeGrup {
  const a = dep(AD, 'adapter');
  const api = dep(API, 'api', { nodeBagli: false });
  const ix = dep(IX, 'indexer');
  return {
    id: UIS,
    tur: 'uis',
    baslik: 'evm-ethereum-mainnet',
    kilit: 'uis-evm-ethereum-mainnet',
    bilesenler: { adapter: a, api, indexer: ix, processor: null },
    deploymentlar: [a, api, ix],
    roller: [{ rol: 'rpc', envler: ['ETH_INDEXER_NODE_URI'], bicim: 'url' }],
    envler: [env(AD), env(IX)],
    mevcutNode: {
      katalogId: 'das_test_eth_a',
      ad: 'Sağlayıcı A',
      maskeli: { rpc: 'https://eth-a.example.net/****' },
    },
    tutarsiz: false,
    olculemedi: false,
    referans: false,
    gitops: false,
    durdurulmus: [],
    adaylar: [
      {
        id: 'das_test_eth_a',
        ad: 'Sağlayıcı A',
        maskeli: { rpc: 'https://eth-a.example.net/****' },
        kullanimda: true,
        cozulemedi: false,
        neden: null,
      },
      {
        id: 'das_test_eth_b',
        ad: 'Sağlayıcı B',
        maskeli: { rpc: 'https://eth-b.example.net/****' },
        kullanimda: false,
        cozulemedi: false,
        neden: null,
      },
      {
        id: 'das_test_eth_c',
        ad: 'Sağlayıcı C',
        maskeli: { rpc: '-' },
        kullanimda: false,
        cozulemedi: true,
        neden: 'sir_eksik',
      },
    ],
    bekleyen: null,
    degistirilebilir: true,
    engel: null,
    okumaBekleniyor: false,
    ...ek,
  };
}
function eskiGrup(ek: Partial<NodeGrup> = {}): NodeGrup {
  const d = dep('hmz-harmonize-ethereum-mainnet', null, { gitops: 'evet' });
  return {
    ...uisGrup(),
    id: 'eski:ethereum-mainnet',
    tur: 'eski',
    baslik: 'ethereum-mainnet',
    kilit: 'eski-ethereum-mainnet',
    bilesenler: null,
    deploymentlar: [d],
    envler: [env(d.ad)],
    gitops: true,
    degistirilebilir: false,
    engel: "Bu deployment'lar GitOps (Argo CD) sahipli ya da sahiplik ölçülemedi — Portal değiştirmez.",
    ...ek,
  };
}
function yanit(ek: Partial<CryptoNodesResponse> = {}, kiraciEk = {}): CryptoNodesResponse {
  return {
    ok: true,
    tenant: {
      key: 'metaco_das_test',
      label: 'Test',
      lokasyon: 'İstanbul',
      cluster: 'clqa1',
      namespace: 'das-metaco-test',
      production: false,
      nodeAcik: true,
      esKiraci: null,
      ...kiraciEk,
    },
    yetki: { okuma: true, talep: true, admin: false },
    tarama: { scanDate: '2026-11-02T08:00:00Z', eski: false },
    okuma: {
      durum: 'taze',
      at: '2026-11-02T09:55:00Z',
      username: 'veli',
      jobId: 11,
      awxServerId: 1,
      eksik: false,
      araclar: { stdinEnv: 'var', patchFile: 'var' },
    },
    gruplar: [uisGrup(), eskiGrup()],
    gecmis: [],
    ...ek,
  };
}
const talep = (ek: Partial<NodeTalepOzet> = {}): NodeTalepOzet => ({
  talepId: 42,
  tenantKey: 'metaco_das_test',
  grup: UIS,
  grupBaslik: 'evm-ethereum-mainnet',
  lokasyon: 'İstanbul',
  yeniNodeId: 'das_test_eth_b',
  yeniNodeAd: 'Sağlayıcı B',
  eskiOzet: 'rpc=https://eth-a.example.net/****',
  yeniOzet: 'rpc=https://eth-b.example.net/****',
  hedefler: [AD, IX],
  username: 'ali',
  durum: 'BEKLIYOR',
  sonucKod: null,
  smartTicketId: 900,
  externalTicketId: 'SR-555',
  awxServerId: null,
  awxJobId: null,
  esTalepId: null,
  createdAt: '2026-11-02T10:00:00Z',
  kapandiAt: null,
  ...ek,
});

beforeEach(() => {
  for (const f of Object.values(m)) f.mockReset();
  m.takip.mockReturnValue({ talepSonu: null, sifirla: vi.fn(), sonDurum: null, sonDurumAlindiMs: null });
  m.changeDetail.mockResolvedValue({ ok: true, talep: talep(), sonuc: null });
});

const kart = (id: string) => document.querySelector(`[data-grup="${id}"]`) as HTMLElement;
const degistir = (id: string) =>
  within(kart(id)).getByRole('button', { name: /Değiştir/ }) as HTMLButtonElement;

// ── U1 ───────────────────────────────────────────────────────────────────────────────
describe('U1 liste', () => {
  it('gruplar, bileşen sütunları, maskeli node, katalog ve engel rozetleri', async () => {
    m.nodes.mockResolvedValue(yanit());
    render(<NodePanel tenantKey="metaco_das_test" />);
    expect(await screen.findByText('Indexer / Node bağlantıları')).toBeTruthy();
    expect(screen.getByText("Yeni tip indexer'lar (uis)")).toBeTruthy();
    expect(screen.getByText("Eski tip indexer'lar")).toBeTruthy();
    const u = within(kart(UIS));
    expect(u.getByText('— bu ağda yok')).toBeTruthy();
    expect(u.getByText('node bağlantısı yok')).toBeTruthy();
    expect(u.getByText('Katalog: Sağlayıcı A')).toBeTruthy();
    expect(kart(UIS).textContent).toContain('rpc: https://eth-a.example.net/****');
    expect(u.getByText('Yeni tip')).toBeTruthy();
    expect(degistir(UIS).disabled).toBe(false);
    const e = within(kart('eski:ethereum-mainnet'));
    expect(e.getByText('GitOps sahipli — Portal değiştirmez')).toBeTruthy();
    expect(e.getByText('Eski tip')).toBeTruthy();
    const d = degistir('eski:ethereum-mainnet');
    expect(d.disabled).toBe(true);
    expect(d.title).toMatch(/GitOps \(Argo CD\) sahipli/);
  });

  it('bekleyen talep: bant metni ve kapalı Değiştir; banda tıklayınca takip açılır', async () => {
    m.nodes.mockResolvedValue(
      yanit({
        gruplar: [
          uisGrup({
            bekleyen: {
              talepId: 42,
              externalTicketId: 'SR-555',
              username: 'ali',
              createdAt: '2026-11-02T10:00:00Z',
              durum: 'BEKLIYOR',
            },
          }),
        ],
      }),
    );
    render(<NodePanel tenantKey="metaco_das_test" />);
    const bant = await screen.findByText(/^Onay bekleyen değişiklik: Smart #SR-555 — ali, /);
    expect(degistir(UIS).disabled).toBe(true);
    expect(degistir(UIS).title).toMatch(/^Onay bekleyen değişiklik: Smart #SR-555/);
    fireEvent.click(bant);
    expect(await screen.findByText(/Talep takibi — Smart #SR-555/)).toBeTruthy();
    await waitFor(() => expect(m.changeDetail).toHaveBeenCalledWith(42));
  });

  it('yalnız okuma yetkisi: bilgi bandı ve Değiştir kapalı (title yetki metni)', async () => {
    m.nodes.mockResolvedValue(yanit({ yetki: { okuma: true, talep: false, admin: false } }));
    render(<NodePanel tenantKey="metaco_das_test" />);
    expect(await screen.findByText('Talep açma yetkiniz yok — yalnız görüntüleyebilirsiniz.')).toBeTruthy();
    expect(degistir(UIS).disabled).toBe(true);
    expect(degistir(UIS).title).toBe('Talep açma yetkiniz yok — yalnız görüntüleyebilirsiniz.');
  });

  it('ortam kapalı (nodeOpen=false): istek atılmaz, kapalı metni', async () => {
    render(<NodePanel tenantKey="metaco_das_prod" nodeAcik={false} />);
    expect(
      screen.getByText('Bu ortamda node değişikliği şimdilik kapalı (ilk aşamada yalnız test ortamları).'),
    ).toBeTruthy();
    await Promise.resolve();
    expect(m.nodes).not.toHaveBeenCalled();
  });

  it('okuma yokken eski bölüm okuma çağrısı gösterir', async () => {
    m.nodes.mockResolvedValue(
      yanit({
        okuma: { durum: 'yok', at: null, username: null, jobId: null, awxServerId: null, eksik: false, araclar: null },
        gruplar: [uisGrup({ envler: [], mevcutNode: null, okumaBekleniyor: true })],
      }),
    );
    render(<NodePanel tenantKey="metaco_das_test" />);
    expect(await screen.findByText("Eski tip grupları görmek için mevcut node'ları okuyun.")).toBeTruthy();
    expect(screen.getAllByText('Henüz okunmadı').length).toBeGreaterThan(0);
  });

  function sayfa(env: Record<string, unknown>, url: string) {
    m.tenants.mockResolvedValue({
      ok: true,
      apps: [
        {
          app: 'metaco',
          label: 'Metaco',
          domains: [
            {
              domain: 'das',
              label: 'DAS',
              envs: [
                {
                  key: 'metaco_das_test',
                  env: 'test',
                  label: 'Test',
                  production: false,
                  cluster: 'clqa1',
                  namespace: 'das-metaco-test',
                  ready: true,
                  open: true,
                  ...env,
                },
              ],
            },
          ],
        },
      ],
    });
    m.actions.mockResolvedValue({ ok: true, actions: [] });
    m.overview.mockResolvedValue({ ok: true, components: [], summary: { total: 0, running: 0, stopped: 0, degraded: 0 } });
    m.nodes.mockResolvedValue(yanit());
    return render(
      <MemoryRouter initialEntries={[url]}>
        <CryptoHubPage />
      </MemoryRouter>,
    );
  }
  const navDugmeleri = () =>
    Array.from(document.querySelectorAll('nav button')).map((b) => b.textContent?.trim());

  it('node-only kullanıcı: YALNIZ Indexer / Node sekmesi, /overview çağrılmaz, tarama düğmesi yok', async () => {
    sayfa({ nodeOnly: true, nodeOpen: true }, '/crypto-hub?t=metaco_das_test');
    expect(await screen.findByText('Indexer / Node bağlantıları')).toBeTruthy();
    expect(navDugmeleri()).toEqual(['Indexer / Node']);
    expect(m.overview).not.toHaveBeenCalled();
    expect(screen.queryByText(/Taramayı/)).toBeNull();
  });

  it('Metaco kullanıcısı ?s=node: beş sekme, node sekmesi açık, overview de yüklenir', async () => {
    sayfa({}, '/crypto-hub?t=metaco_das_test&s=node');
    expect(await screen.findByText('Indexer / Node bağlantıları')).toBeTruthy();
    expect(navDugmeleri()).toEqual(['Durum', 'Podlar', 'Sürümler', 'Config Map', 'Indexer / Node']);
    await waitFor(() => expect(m.overview).toHaveBeenCalled());
  });
});

// ── U2 ───────────────────────────────────────────────────────────────────────────────
const btn = (ad: string) => screen.getByRole('button', { name: ad }) as HTMLButtonElement;
async function sihirbazAc(r: CryptoNodesResponse, id = UIS) {
  m.nodes.mockResolvedValue(r);
  render(<NodePanel tenantKey={r.tenant!.key} takipAralikMs={20} />);
  await screen.findByText('Indexer / Node bağlantıları');
  fireEvent.click(degistir(id));
}

describe('U2 sihirbaz', () => {
  it('kullanımda / çözülemedi seçilemez; geçerli seçim İleri açar; "İptal" var', async () => {
    await sihirbazAc(yanit());
    expect(screen.getByText('Node değişikliği — evm-ethereum-mainnet')).toBeTruthy();
    expect(screen.getByText('Değer (maskeli)')).toBeTruthy();
    expect(btn('İptal')).toBeTruthy();
    fireEvent.click(btn('İleri'));
    const sec = screen.getByLabelText('Yeni node') as HTMLSelectElement;
    const opt = (id: string) => sec.querySelector(`option[value="${id}"]`) as HTMLOptionElement;
    expect(opt('das_test_eth_a').disabled).toBe(true);
    expect(opt('das_test_eth_a').textContent).toMatch(/ \(şu an kullanımda\)$/);
    expect(opt('das_test_eth_c').disabled).toBe(true);
    expect(opt('das_test_eth_c').textContent).toMatch(/ \(sırrı çözülemedi — seçilemez\)$/);
    expect(opt('das_test_eth_b').disabled).toBe(false);
    expect(btn('İleri').disabled).toBe(true);
    fireEvent.change(sec, { target: { value: 'das_test_eth_b' } });
    expect(btn('İleri').disabled).toBe(false);
    fireEvent.click(btn('İptal'));
    expect(screen.queryByText('Node değişikliği — evm-ethereum-mainnet')).toBeNull();
  });

  it('test ortamı: tutarsızlık onayı, gerekçe sınırı, onay kutusu; gövdede değer yok; takip açılır', async () => {
    m.change.mockResolvedValue({
      ok: true,
      pendingApproval: true,
      ticketId: 900,
      externalTicketId: 'SR-555',
      talepId: 42,
      onayZamanAsimiDk: 1440,
    });
    // Gerçek tutarsızlık: adapter B'de, indexer A'da.
    const tutarsizEnv = [
      env(AD, { sha: H('b'), maskeli: 'https://eth-b.example.net/****', katalogId: 'das_test_eth_b' }),
      env(IX),
    ];
    await sihirbazAc(yanit({ gruplar: [uisGrup({ tutarsiz: true, envler: tutarsizEnv })] }));
    fireEvent.click(btn('İleri'));
    fireEvent.change(screen.getByLabelText('Yeni node'), { target: { value: 'das_test_eth_b' } });
    fireEvent.click(btn('İleri'));
    const etki = screen.getByText("Şu deployment'lar yeniden başlatılacak (her biri tek rollout):");
    const liste = etki.parentElement?.querySelector('ul') as HTMLElement;
    expect(within(liste).getByText(AD)).toBeTruthy();
    expect(within(liste).getByText(IX)).toBeTruthy();
    expect(within(liste).queryByText(API)).toBeNull();
    expect(btn('İleri').disabled).toBe(true);
    fireEvent.click(
      screen.getByLabelText(
        "Seçilen bileşenler şu an farklı node'lara bağlı; hepsini seçilen node'a getirmeyi onaylıyorum.",
      ),
    );
    expect(btn('İleri').disabled).toBe(false);
    fireEvent.click(btn('İleri'));
    const g = screen.getByLabelText('Gerekçe (10–500 karakter)');
    fireEvent.change(g, { target: { value: '123456789' } });
    expect(screen.getByText('9/500')).toBeTruthy();
    expect(btn('İleri').disabled).toBe(true);
    fireEvent.change(g, { target: { value: 'Sağlayıcı A kesintide' } });
    expect(btn('İleri').disabled).toBe(false);
    fireEvent.click(btn('İleri'));
    expect(btn('Talep aç').disabled).toBe(true);
    expect(screen.queryByLabelText(/Onaylamak için grup adını yazın/)).toBeNull();
    fireEvent.click(
      screen.getByLabelText(
        'Smart talebi açılacağını ve onaydan sonra değişikliğin otomatik uygulanacağını anlıyorum.',
      ),
    );
    fireEvent.click(btn('Talep aç'));
    await waitFor(() => expect(m.change).toHaveBeenCalledTimes(1));
    const govde = m.change.mock.calls[0][0];
    expect(govde).toEqual({
      tenant: 'metaco_das_test',
      grup: UIS,
      nodeId: 'das_test_eth_b',
      gerekce: 'Sağlayıcı A kesintide',
      bilesenler: [AD, IX],
      tutarsizlikOnay: true,
    });
    expect(JSON.stringify(govde)).not.toMatch(new RegExp('https?:|' + SIR));
    expect(await screen.findByText(/^Smart talebi açıldı \(kayıt no: SR-555\)\./)).toBeTruthy();
    expect(screen.queryByText('Node değişikliği — evm-ethereum-mainnet')).toBeNull();
  });

  it('production: grup adını AYNEN yazdırır (parça yetmez); Ankara uyarısı; onayMetni gönderilir', async () => {
    m.change.mockResolvedValue({ ok: true, ticketId: 900, externalTicketId: 'SR-556', talepId: 43 });
    await sihirbazAc(
      yanit({}, { key: 'metaco_das_prod', production: true, esKiraci: 'metaco_das_prod_ank' }),
    );
    fireEvent.click(btn('İleri'));
    fireEvent.change(screen.getByLabelText('Yeni node'), { target: { value: 'das_test_eth_b' } });
    fireEvent.click(btn('İleri'));
    expect(
      screen.getByText(
        'Ankara (metaco_das_prod_ank) bu talepte değiştirilmez; talep açıldıktan sonra ayrıca önerilir.',
      ),
    ).toBeTruthy();
    fireEvent.click(btn('İleri'));
    fireEvent.change(screen.getByLabelText('Gerekçe (10–500 karakter)'), {
      target: { value: 'Planlı sağlayıcı geçişi' },
    });
    fireEvent.click(btn('İleri'));
    const yazi = screen.getByLabelText(`Onaylamak için grup adını yazın: ${UIS}`);
    fireEvent.change(yazi, { target: { value: 'evm-ethereum-mainnet' } });
    expect(btn('Talep aç').disabled).toBe(true);
    fireEvent.change(yazi, { target: { value: UIS + 'x' } });
    expect(btn('Talep aç').disabled).toBe(true);
    fireEvent.change(yazi, { target: { value: UIS } });
    expect(btn('Talep aç').disabled).toBe(false);
    fireEvent.click(btn('Talep aç'));
    await waitFor(() => expect(m.change).toHaveBeenCalledTimes(1));
    expect(m.change.mock.calls[0][0]).toMatchObject({ tenant: 'metaco_das_prod', onayMetni: UIS });
  });

  it('sunucu reddi mesajı sihirbazda gösterilir, sihirbaz açık kalır', async () => {
    m.change.mockResolvedValue({
      ok: false,
      blocked: 'node_bekleyen_talep',
      message: 'Bu grup için açık bir talep var (Smart #SR-1). Sonuçlanmadan yeni talep açılamaz.',
    });
    await sihirbazAc(yanit());
    fireEvent.click(btn('İleri'));
    fireEvent.change(screen.getByLabelText('Yeni node'), { target: { value: 'das_test_eth_b' } });
    fireEvent.click(btn('İleri'));
    fireEvent.click(btn('İleri'));
    fireEvent.change(screen.getByLabelText('Gerekçe (10–500 karakter)'), { target: { value: 'x'.repeat(12) } });
    fireEvent.click(btn('İleri'));
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(btn('Talep aç'));
    expect(await screen.findByText(/Bu grup için açık bir talep var \(Smart #SR-1\)/)).toBeTruthy();
    expect(screen.getByText('Node değişikliği — evm-ethereum-mainnet')).toBeTruthy();
  });

  it('okuma bayat: Değiştir okumayı başlatır, okuma bitince grup değiştirilemezse engel metniyle kapanır', async () => {
    const bayat = yanit({
      okuma: { ...yanit().okuma!, durum: 'bayat' },
      gruplar: [uisGrup({ degistirilebilir: false, engel: 'okuma bayat' })],
    });
    m.read.mockResolvedValue({ ok: true, jobId: 77, awxServerId: 1, devam: false });
    m.readStatus.mockResolvedValue({ ok: true, status: 'successful', bitti: true });
    m.nodes.mockResolvedValueOnce(bayat).mockResolvedValueOnce(
      yanit({
        gruplar: [
          uisGrup({
            degistirilebilir: false,
            referans: true,
            engel: 'Grupta Secret/ConfigMap referanslı env var — Portal bu sürümde değiştirmez.',
          }),
        ],
      }),
    );
    render(<NodePanel tenantKey="metaco_das_test" okumaAralikMs={10} />);
    await screen.findByText('Indexer / Node bağlantıları');
    expect(screen.getByText('10 dakikadan eski — değişiklik öncesi yeniden okunur')).toBeTruthy();
    expect(degistir(UIS).disabled).toBe(false);
    fireEvent.click(degistir(UIS));
    expect(screen.getByText('Node değişikliği — evm-ethereum-mainnet')).toBeTruthy();
    expect(screen.getAllByText('Mevcut değerler okunuyor (~1 dk)…').length).toBeGreaterThan(0);
    expect(btn('İleri').disabled).toBe(true);
    await waitFor(() => expect(m.read).toHaveBeenCalledWith('metaco_das_test'));
    await waitFor(() => expect(m.readStatus).toHaveBeenCalledWith(1, 77));
    expect(
      await screen.findByText('Grupta Secret/ConfigMap referanslı env var — Portal bu sürümde değiştirmez.'),
    ).toBeTruthy();
    expect(screen.queryByText('Node değişikliği — evm-ethereum-mainnet')).toBeNull();
    expect(m.nodes).toHaveBeenCalledTimes(2);
  });
});

// ── U3 ───────────────────────────────────────────────────────────────────────────────
describe('U3 takip', () => {
  it('onay bekliyor: Smart durum adı aynen + son tarih', async () => {
    m.takip.mockReturnValue({
      talepSonu: null,
      sifirla: vi.fn(),
      sonDurum: {
        ok: true,
        status: 'PENDING',
        smartStateName: 'Yönetici Onayı Bekliyor',
        deadline: '2026-11-03T10:00:00Z',
        serverNow: '2026-11-02T10:00:00Z',
      },
      sonDurumAlindiMs: Date.now(),
    });
    render(<NodeTakip tenantKey="metaco_das_test" talepId={42} onKapat={vi.fn()} aralikMs={20} />);
    expect(await screen.findByText(/Onay bekliyor \(Yönetici Onayı Bekliyor\)/)).toBeTruthy();
    expect(screen.getByText(/^Son tarih: (23|24) sa/)).toBeTruthy();
    await waitFor(() => expect(m.takip).toHaveBeenCalledWith(900, expect.any(Function)));
  });

  it('kanca henüz yanıt vermediyse Smart durumu talep yanıtından (smart.statusName + sonTarih)', async () => {
    const sonTarih = new Date(Date.now() + 5 * 3600000 + 30 * 60000).toISOString();
    m.changeDetail.mockResolvedValue({
      ok: true,
      talep: talep(),
      smart: { status: 'PENDING', statusName: 'Onay Bekliyor', sonTarih, hata: null },
    });
    render(<NodeTakip tenantKey="metaco_das_test" talepId={42} onKapat={vi.fn()} aralikMs={20} />);
    expect(await screen.findByText(/Onay bekliyor \(Onay Bekliyor\)/)).toBeTruthy();
    expect(screen.getByText(/^Son tarih: 5 sa (29|30) dk$/)).toBeTruthy();
  });

  it('BASARILI: sonuç metni ve sonuç tablosu; liste yenilenir', async () => {
    const yenile = vi.fn();
    m.changeDetail.mockResolvedValue({
      ok: true,
      // Sunucu (node.cjs talepOzeti) sonucu talep satırının İÇİNDE verir.
      talep: talep({
        durum: 'BASARILI',
        sonucKod: '-',
        kapandiAt: '2026-11-02T11:00:00Z',
        sonuc: {
        sum: { sonuc: 'ok', nodeId: 'das_test_eth_b', talepId: '42', kod: '-' },
        degisiklikler: [
          {
            deployment: AD,
            container: 'app',
            env: 'ETH_INDEXER_NODE_URI',
            eski: 'https://eth-a.example.net/****',
            yeni: 'https://eth-b.example.net/****',
            durum: 'yazildi',
          },
        ],
        rollout: [{ deployment: AD, durum: 'ok', sureSn: 42 }],
        verify: [{ deployment: AD, container: 'app', env: 'ETH_INDEXER_NODE_URI', durum: 'ok' }],
        rollback: [],
        yedek: [],
        hatalar: [],
        },
      }),
    });
    render(
      <NodeTakip tenantKey="metaco_das_test" talepId={42} onKapat={vi.fn()} onDegisti={yenile} aralikMs={20} />,
    );
    expect(await screen.findByText("Tamamlandı — env yazıldı, pod'lar hazır.")).toBeTruthy();
    for (const b of ['Bileşen', 'Kap', 'Env', 'Eski', 'Yeni', 'Yazıldı', 'Rollout', 'Geri okuma', 'Durum'])
      expect(screen.getByRole('columnheader', { name: b })).toBeTruthy();
    expect(screen.getByText('ok (42 sn)')).toBeTruthy();
    expect(yenile).toHaveBeenCalledTimes(1);
  });

  it('GERI_ALINDI ROLLOUT ve OLCULEMEDI metinleri', async () => {
    m.changeDetail.mockResolvedValue({
      ok: true,
      talep: talep({ durum: 'GERI_ALINDI', sonucKod: 'ROLLOUT', kapandiAt: 'x' }),
      sonuc: null,
    });
    const { unmount } = render(<NodeTakip tenantKey="metaco_das_test" talepId={42} onKapat={vi.fn()} />);
    expect(
      await screen.findByText("Geri alındı — rollout zamanında bitmedi. Eski node'a dönüldü."),
    ).toBeTruthy();
    unmount();
    m.changeDetail.mockResolvedValue({
      ok: true,
      talep: talep({ durum: 'OLCULEMEDI', kapandiAt: 'x' }),
      sonuc: null,
    });
    render(<NodeTakip tenantKey="metaco_das_test" talepId={42} onKapat={vi.fn()} />);
    expect(
      await screen.findByText("Durum bilinmiyor — sonuç satırı gelmedi. Mevcut node'ları okuyun."),
    ).toBeTruthy();
  });

  const oneri = (acik: boolean) => ({
    tenant: 'metaco_das_prod_ank',
    label: 'Production (Ankara)',
    acik,
    grup: UIS,
    nodeId: 'das_test_eth_b',
    esTalepId: 42,
  });
  const yeni = (acik: boolean) => ({
    ok: true,
    ticketId: 900,
    externalTicketId: 'SR-555',
    talepId: 42,
    esTalepOnerisi: oneri(acik),
  });

  it('Ankara önerisi yalnız metaco_das_prod; kapalıysa düğme kapalı + title', async () => {
    const { unmount } = render(
      <NodeTakip tenantKey="metaco_das_prod" talepId={42} yeniAcildi={yeni(false)} onKapat={vi.fn()} />,
    );
    expect(screen.getByText('Ankara (metaco_das_prod_ank) bu talepte değiştirilmedi.')).toBeTruthy();
    const d = btn('Ankara için de talep aç');
    expect(d.disabled).toBe(true);
    expect(d.title).toBe('Bu ortamda node değişikliği şimdilik kapalı.');
    unmount();
    render(<NodeTakip tenantKey="metaco_gar_prod" talepId={42} yeniAcildi={yeni(true)} onKapat={vi.fn()} />);
    expect(screen.queryByText('Ankara için de talep aç')).toBeNull();
  });

  it('Ankara açıkken düğme öneriyi geri verir', () => {
    const onAnkara = vi.fn();
    render(
      <NodeTakip
        tenantKey="metaco_das_prod"
        talepId={42}
        yeniAcildi={yeni(true)}
        onKapat={vi.fn()}
        onAnkara={onAnkara}
      />,
    );
    fireEvent.click(btn('Ankara için de talep aç'));
    expect(onAnkara).toHaveBeenCalledWith(oneri(true));
  });

  it('Ankara bağlantısı (?g&n&es): sihirbaz aynı grupla, node ön seçili açılır; esTalepId gönderilir', async () => {
    m.tenants.mockResolvedValue({
      ok: true,
      apps: [
        {
          app: 'metaco',
          label: 'Metaco',
          domains: [
            {
              domain: 'das',
              label: 'DAS',
              envs: [
                {
                  key: 'metaco_das_prod_ank',
                  env: 'prod_ank',
                  label: 'Production (Ankara)',
                  production: true,
                  cluster: 'clank',
                  namespace: 'das-metaco',
                  ready: true,
                  open: true,
                  nodeOnly: true,
                  nodeOpen: true,
                },
              ],
            },
          ],
        },
      ],
    });
    m.actions.mockResolvedValue({ ok: true, actions: [] });
    m.nodes.mockResolvedValue(
      yanit({}, { key: 'metaco_das_prod_ank', lokasyon: 'Ankara', production: true }),
    );
    m.change.mockResolvedValue({ ok: true, ticketId: 901, externalTicketId: 'SR-600', talepId: 44 });
    render(
      <MemoryRouter
        initialEntries={[`/crypto-hub?t=metaco_das_prod_ank&s=node&g=${encodeURIComponent(UIS)}&n=das_test_eth_b&es=42`]}
      >
        <CryptoHubPage />
      </MemoryRouter>,
    );
    expect(await screen.findByText('Node değişikliği — evm-ethereum-mainnet')).toBeTruthy();
    fireEvent.click(btn('İleri'));
    expect((screen.getByLabelText('Yeni node') as HTMLSelectElement).value).toBe('das_test_eth_b');
    fireEvent.click(btn('İleri'));
    fireEvent.click(btn('İleri'));
    fireEvent.change(screen.getByLabelText('Gerekçe (10–500 karakter)'), {
      target: { value: 'İstanbul ile aynı geçiş' },
    });
    fireEvent.click(btn('İleri'));
    fireEvent.change(screen.getByLabelText(`Onaylamak için grup adını yazın: ${UIS}`), {
      target: { value: UIS },
    });
    fireEvent.click(btn('Talep aç'));
    await waitFor(() => expect(m.change).toHaveBeenCalledTimes(1));
    expect(m.change.mock.calls[0][0]).toMatchObject({
      tenant: 'metaco_das_prod_ank',
      grup: UIS,
      nodeId: 'das_test_eth_b',
      esTalepId: 42,
      onayMetni: UIS,
    });
    expect(m.read).not.toHaveBeenCalled();
  });

  it('PS6 Ankara bağı sihirbaz İptal edilip "Değiştir" ile yeniden açılınca da gönderilir', async () => {
    m.change.mockResolvedValue({ ok: true, ticketId: 902, externalTicketId: 'SR-601', talepId: 45 });
    m.nodes.mockResolvedValue(yanit({}, { key: 'metaco_das_prod_ank', lokasyon: 'Ankara', production: true }));
    render(
      <MemoryRouter>
        <NodePanel
          tenantKey="metaco_das_prod_ank"
          baslangic={{ grup: UIS, nodeId: 'das_test_eth_b', esTalepId: 42 }}
          okumaAralikMs={10}
        />
      </MemoryRouter>,
    );
    expect(await screen.findByText('Node değişikliği — evm-ethereum-mainnet')).toBeTruthy();
    fireEvent.click(btn('İptal'));
    expect(screen.queryByText('Node değişikliği — evm-ethereum-mainnet')).toBeNull();
    fireEvent.click(degistir(UIS));
    expect(await screen.findByText('Node değişikliği — evm-ethereum-mainnet')).toBeTruthy();
    fireEvent.click(btn('İleri'));
    fireEvent.change(screen.getByLabelText('Yeni node'), { target: { value: 'das_test_eth_b' } });
    fireEvent.click(btn('İleri'));
    fireEvent.click(btn('İleri'));
    fireEvent.change(screen.getByLabelText('Gerekçe (10–500 karakter)'), { target: { value: 'İstanbul ile aynı geçiş' } });
    fireEvent.click(btn('İleri'));
    fireEvent.change(screen.getByLabelText(`Onaylamak için grup adını yazın: ${UIS}`), { target: { value: UIS } });
    fireEvent.click(btn('Talep aç'));
    await waitFor(() => expect(m.change).toHaveBeenCalledTimes(1));
    expect(m.change.mock.calls[0][0].esTalepId).toBe(42);
  });
});

// ── U5 bileşen seçimi (kullanıcı kararı 2026-11-02) ─────────────────────────────────
describe('U5 bileşen seçimi', () => {
  const ucBilesen = (ek: Partial<NodeGrup> = {}) => {
    const g = uisGrup(ek);
    const deps = g.deploymentlar.map((d) => ({
      ...d,
      nodeBagli: true,
      secilebilir: true,
      mevcutNode: { katalogId: 'das_test_eth_a', ad: 'Sağlayıcı A', maskeli: { rpc: 'https://eth-a.example.net/****' } },
    }));
    return { ...g, deploymentlar: deps, envler: ek.envler || [env(AD), env(API), env(IX)] };
  };

  it('node taşıyan bileşenler işaretli gelir, şu anki node yanında; alt küme gövdeye gider; boş seçim ilerlemez', async () => {
    m.change.mockResolvedValue({ ok: true, ticketId: 903, externalTicketId: 'SR-700', talepId: 46 });
    await sihirbazAc(yanit({ gruplar: [ucBilesen()] }));
    expect(screen.getByText('Değişecek bileşenler')).toBeTruthy();
    const kutu = (b: string) => screen.getByLabelText(new RegExp(`^${b} — şu an:`)) as HTMLInputElement;
    for (const b of ['adapter', 'api', 'indexer']) {
      expect(kutu(b).checked).toBe(true);
    }
    expect(screen.getAllByText(/— şu an: Sağlayıcı A/).length).toBe(3);
    for (const b of ['adapter', 'api', 'indexer']) fireEvent.click(kutu(b));
    expect(btn('İleri').disabled).toBe(true);
    expect(screen.getByText('En az bir bileşen seçin.')).toBeTruthy();
    fireEvent.click(kutu('indexer'));
    expect(btn('İleri').disabled).toBe(false);
    fireEvent.click(btn('İleri'));
    fireEvent.change(screen.getByLabelText('Yeni node'), { target: { value: 'das_test_eth_b' } });
    fireEvent.click(btn('İleri'));
    const etki = screen.getByText("Şu deployment'lar yeniden başlatılacak (her biri tek rollout):");
    const liste = etki.parentElement?.querySelector('ul') as HTMLElement;
    expect(within(liste).getByText(IX)).toBeTruthy();
    expect(within(liste).queryByText(AD)).toBeNull();
    fireEvent.click(btn('İleri'));
    fireEvent.change(screen.getByLabelText('Gerekçe (10–500 karakter)'), { target: { value: 'Yalnız indexer geçiyor' } });
    fireEvent.click(btn('İleri'));
    expect(screen.getByText('Değişecek bileşenler: indexer')).toBeTruthy();
    fireEvent.click(
      screen.getByLabelText('Smart talebi açılacağını ve onaydan sonra değişikliğin otomatik uygulanacağını anlıyorum.'),
    );
    fireEvent.click(btn('Talep aç'));
    await waitFor(() => expect(m.change).toHaveBeenCalledTimes(1));
    expect(m.change.mock.calls[0][0].bilesenler).toEqual([IX]);
    expect(m.change.mock.calls[0][0].tutarsizlikOnay).toBe(false);
  });

  it("farklı node'lar: not gösterilir; tek node'daki alt küme ek onay istemez, toplamak ister", async () => {
    const envler = [
      env(AD, { sha: H('b'), maskeli: 'https://eth-b.example.net/****', katalogId: 'das_test_eth_b' }),
      env(API),
      env(IX),
    ];
    await sihirbazAc(yanit({ gruplar: [ucBilesen({ tutarsiz: true, envler })] }));
    expect(screen.getByText("Bileşenler farklı node'lara bağlı.")).toBeTruthy();
    const kutu = (b: string) => screen.getByLabelText(new RegExp(`^${b} — şu an:`)) as HTMLInputElement;
    // Yalnız api + indexer (ikisi de A) -> C: ek onay yok.
    fireEvent.click(kutu('adapter'));
    fireEvent.click(btn('İleri'));
    fireEvent.change(screen.getByLabelText('Yeni node'), { target: { value: 'das_test_eth_b' } });
    fireEvent.click(btn('İleri'));
    expect(screen.queryByLabelText(/hepsini seçilen node'a getirmeyi onaylıyorum/)).toBeNull();
    expect(btn('İleri').disabled).toBe(false);
    // Geri dön, adapter'ı da seç: farklı node'lar toplanıyor -> onay zorunlu.
    fireEvent.click(btn('Geri'));
    fireEvent.click(btn('Geri'));
    fireEvent.click(kutu('adapter'));
    fireEvent.click(btn('İleri'));
    fireEvent.click(btn('İleri'));
    expect(btn('İleri').disabled).toBe(true);
    expect(screen.getByLabelText(/hepsini seçilen node'a getirmeyi onaylıyorum/)).toBeTruthy();
  });

  it('seçilen bileşenlerin hepsi zaten adaydaysa İleri kapalı ve açıklanır; tek bileşenli grupta seçim yok', async () => {
    const envler = [
      env(AD, { sha: H('b'), maskeli: 'https://eth-b.example.net/****', katalogId: 'das_test_eth_b' }),
      env(API),
      env(IX),
    ];
    await sihirbazAc(yanit({ gruplar: [ucBilesen({ tutarsiz: true, envler })] }));
    const kutu = (b: string) => screen.getByLabelText(new RegExp(`^${b} — şu an:`)) as HTMLInputElement;
    fireEvent.click(kutu('api'));
    fireEvent.click(kutu('indexer'));
    fireEvent.click(btn('İleri'));
    fireEvent.change(screen.getByLabelText('Yeni node'), { target: { value: 'das_test_eth_b' } });
    expect(btn('İleri').disabled).toBe(true);
    expect(screen.getByText("Seçilen bileşenler zaten bu node'da — değişiklik yok.")).toBeTruthy();
  });
});

// ── U4 ───────────────────────────────────────────────────────────────────────────────
describe('U4 yapı', () => {
  const DIR = path.join(__dirname, '..', 'components', 'crypto_hub');
  const DOSYALAR = ['NodePanel.tsx', 'NodeDegisiklikModal.tsx', 'NodeTakip.tsx', 'nodeOrtak.ts'];
  const oku = (f: string) => fs.readFileSync(path.join(DIR, f), 'utf8');

  it('her <table> bir overflow-x-auto sarmalayıcısının içinde (1280/1440 px yatay taşma yok)', () => {
    let toplam = 0;
    for (const f of DOSYALAR) {
      const s = oku(f);
      const parcalar = s.split('<table').slice(1);
      const once = s.split('<table').slice(0, -1);
      parcalar.forEach((_, i) => {
        toplam++;
        const onceki = once.slice(0, i + 1).join('<table');
        const sonAcan = onceki.lastIndexOf('overflow-x-auto');
        const sonKapanan = onceki.lastIndexOf('</table>');
        expect(sonAcan, `${f}: ${i + 1}. tablo sarmalayıcısız`).toBeGreaterThan(sonKapanan);
      });
    }
    expect(toplam).toBeGreaterThanOrEqual(4);
  });

  it('yeni dosyalarda sabit renk yok (yalnız tema belirteçleri)', () => {
    for (const f of DOSYALAR) {
      const s = oku(f);
      expect(s, f).not.toMatch(/#[0-9a-fA-F]{3,8}\b(?![-\w])/);
      expect(s, f).not.toMatch(/\brgba?\(/);
    }
  });

  it('Admin › Crypto Hub Erişimi: "node" seçeneğinin etiketi (D5)', () => {
    const s = fs.readFileSync(
      path.join(__dirname, '..', 'components', 'admin', 'tabs', 'CryptoAccessTab.tsx'),
      'utf8',
    );
    expect(s).toMatch(/^\s+node: 'Indexer \/ Node değişikliği talebi',$/m);
  });

  it('istemci gövdesinde node değeri ya da sır alanı yok (yalnız id/ad/gerekçe/onay)', () => {
    const api = fs.readFileSync(path.join(__dirname, '..', 'api', 'cryptoHubApi.ts'), 'utf8');
    const govde = api.slice(api.indexOf('export interface NodeChangeBody'));
    const blok = govde.slice(0, govde.indexOf('}') + 1);
    const alanlar = Array.from(blok.matchAll(/^\s+(\w+)\??:/gm)).map((x) => x[1]);
    expect(alanlar).toEqual([
      'tenant',
      'grup',
      'nodeId',
      'gerekce',
      'tutarsizlikOnay',
      'onayMetni',
      'esTalepId',
      'bilesenler',
    ]);
  });
});
