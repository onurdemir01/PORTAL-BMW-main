// src/__tests__/crypto-hub-node.test.tsx — Crypto Hub > "Indexer / Node" ekranı (2026-11-02).
//
//   U1 liste: gruplar, rozetler, bekleyen bant, kapalı "Değiştir" + title; yalnız-okuma kullanıcı;
//      node-only kullanıcıda YALNIZ İşlemler'deki node kartı ve /overview ÇAĞRILMAZ (D5)
//   U2 sihirbaz: rol başına değer kutusu (sır password, autocomplete/spellcheck kapalı), anlık biçim
//      doğrulaması, maskeli önizleme, boş rol uyarısı + onay kutusu, aynı-değer uyarısı; tutarsızlık
//      onayı; gerekçe sınırı; production ad yazdırma; "İptal"; sunucu reddinde doğru adıma dönüş;
//      değer tarayıcı deposuna / console'a yazılmaz
//   U3 takip: Smart durum adı aynen + son tarih; kapalı durum metni + sonuç tablosu; Ankara önerisi
//      yalnız metaco_das_prod'da, kapalıysa düğme kapalı; Ankara bağlantısı sihirbazı aynı grupla
//      açar ve esTalepId gönderir (D4)
//   U4 yapı: her tablo overflow-x-auto içinde; yeni dosyalarda sabit renk yok
//   U7 Smart kapalı test yolu: sihirbaz ve takip metinleri, çift gönderim, belirsiz launch, bayat mod
//   U8 Smart Onayı penceresi: yalnız Admin (Picker dahil), kaynak göstergesi, kapatma onayı, token,
//      önizleme, kayıt sonrası /nodes yenileme, bayat pencere
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createHash } from 'node:crypto';
import { act, render, screen, fireEvent, waitFor, within, cleanup } from '@testing-library/react';
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

const kimlik = vi.hoisted(() => ({ rol: 'User' }));
const m = vi.hoisted(() => ({
  nodes: vi.fn(),
  read: vi.fn(),
  readStatus: vi.fn(),
  change: vi.fn(),
  changeDetail: vi.fn(),
  smartOnizle: vi.fn(),
  smartAyar: vi.fn(),
  smartAyarKaydet: vi.fn(),
  smartAyarOnizle: vi.fn(),
  flowMeta: vi.fn(),
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
    smartAyar: m.smartAyar,
    smartAyarKaydet: m.smartAyarKaydet,
    smartAyarOnizle: m.smartAyarOnizle,
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
  useAuth: () => ({ user: { username: 'ali', role: kimlik.rol } }),
}));
vi.mock('@/api/ansibleApi', () => ({ ansibleApi: { smartFlowMetadata: m.flowMeta } }));

import { NodePanel } from '@/components/crypto_hub/NodePanel';
import { NodeTakip } from '@/components/crypto_hub/NodeTakip';
import CryptoHubPage from '@/components/crypto_hub/CryptoHubPage';
import CryptoHubSmartModal from '@/components/crypto_hub/CryptoHubSmartModal';

const UIS = 'uis:evm-ethereum-mainnet';
const DOT = 'eski:polkadot-assethub';
const H = (c: string) => c.repeat(64);
const sha = (v: string) => createHash('sha256').update(v, 'utf8').digest('hex');
const SIR = 'SIRSIR123';
// Canlı değerler (ekran yalnız maskeli + sha görür) ve kullanıcının yazacağı yeni değer.
const VA = 'https://eth-a.example.net/v3/KEYA';
const VB = 'https://eth-b.example.net/v3/KEYB';
const YENI = `https://eth-c.node.invalid/v3/${SIR}`;
const YENI_MASKE = 'https://eth-c.node.invalid/****';
const RPC_ETIKET = 'rpc — URL (http, https, ws, wss)';

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
  sha: sha(VA),
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
    mevcutNode: { maskeli: { rpc: 'https://eth-a.example.net/****' } },
    tutarsiz: false,
    olculemedi: false,
    referans: false,
    gitops: false,
    durdurulmus: [],
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
/** Eski tip, iki rollü (url + sır) grup: polkadot. */
function dotGrup(ek: Partial<NodeGrup> = {}): NodeGrup {
  const d = dep('hmz-harmonize-substrate-polkadot-assethub', null);
  return {
    ...uisGrup(),
    id: DOT,
    tur: 'eski',
    baslik: 'substrate-polkadot-assethub',
    kilit: 'eski-substrate-polkadot-assethub',
    bilesenler: null,
    deploymentlar: [d],
    roller: [
      { rol: 'auth', envler: ['SIDECAR_AUTH_VALUE'], bicim: 'sir' },
      { rol: 'url', envler: ['SIDECAR_URL'], bicim: 'url' },
    ],
    envler: [
      env(d.ad, { container: 'sidecar', env: 'SIDECAR_AUTH_VALUE', rol: 'auth', maskeli: '****', sha: sha('eski-sir') }),
      env(d.ad, { container: 'sidecar', env: 'SIDECAR_URL', rol: 'url', maskeli: 'https://dot.example.net/****', sha: sha('https://dot.example.net/x') }),
    ],
    mevcutNode: { maskeli: { auth: '****', url: 'https://dot.example.net/****' } },
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
  eskiOzet: 'rpc=https://eth-a.example.net/****',
  yeniOzet: 'rpc=https://eth-c.node.invalid/****',
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
afterEach(() => {
  vi.restoreAllMocks();
});

const kart = (id: string) => document.querySelector(`[data-grup="${id}"]`) as HTMLElement;
const degistir = (id: string) =>
  within(kart(id)).getByRole('button', { name: /Değiştir/ }) as HTMLButtonElement;

// ── U1 ───────────────────────────────────────────────────────────────────────────────
describe('U1 liste', () => {
  it('gruplar, bileşen sütunları, maskeli node ve engel rozetleri', async () => {
    m.nodes.mockResolvedValue(yanit());
    render(<NodePanel tenantKey="metaco_das_test" />);
    expect(await screen.findByText('Indexer / Node bağlantıları')).toBeTruthy();
    expect(screen.getByText("Yeni tip indexer'lar (uis)")).toBeTruthy();
    expect(screen.getByText("Eski tip indexer'lar")).toBeTruthy();
    const u = within(kart(UIS));
    expect(u.getByText('bu ağda yok')).toBeTruthy();
    expect(u.getByText('node bağlantısı yok')).toBeTruthy();
    expect(u.getByText("Tüm bileşenler aynı node'a bağlı: rpc: https://eth-a.example.net/****")).toBeTruthy();
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

  const STOP = { key: 'stop', label: 'Durdur', hint: 'x', writes: true };

  function sayfa(env: Record<string, unknown>, url: string, app = 'metaco', actions: unknown[] = []) {
    m.tenants.mockResolvedValue({
      ok: true,
      apps: [
        {
          app,
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
    m.actions.mockResolvedValue({ ok: true, actions });
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

  const nodeKarti = () => screen.getByRole('button', { name: /Indexer \/ Node değişimi/ });

  it('node-only kullanıcı: YALNIZ node kartı, sekme çubuğu yok, /overview çağrılmaz, tarama düğmesi yok', async () => {
    sayfa({ nodeOnly: true, nodeOpen: true }, '/crypto-hub?t=metaco_das_test', 'metaco', [STOP]);
    expect(await screen.findByText('Indexer / Node bağlantıları')).toBeTruthy();
    await waitFor(() => expect(m.actions).toHaveBeenCalled());
    await act(async () => {});
    expect(document.querySelector('nav')).toBeNull();
    expect(screen.queryByText('Durdur')).toBeNull();
    expect(nodeKarti().getAttribute('aria-pressed')).toBe('true');
    expect(m.overview).not.toHaveBeenCalled();
    expect(screen.queryByText(/Taramayı/)).toBeNull();
  });

  it('Metaco kullanıcısı ?s=node: dört sekme, node kartı açık, overview de yüklenir', async () => {
    sayfa({}, '/crypto-hub?t=metaco_das_test&s=node');
    expect(await screen.findByText('Indexer / Node bağlantıları')).toBeTruthy();
    expect(navDugmeleri()).toEqual(['Durum', 'Podlar', 'Sürümler', 'Config Map']);
    expect(nodeKarti().getAttribute('aria-pressed')).toBe('true');
    await waitFor(() => expect(m.overview).toHaveBeenCalled());
  });

  it('Wyden: işlem kartları durur, node kartı yok', async () => {
    sayfa({}, '/crypto-hub?t=metaco_das_test', 'wyden', [STOP]);
    expect(await screen.findByText('Durdur')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Indexer \/ Node değişimi/ })).toBeNull();
  });

  it('Metaco kullanıcısı: İşlemler kartı node görünümünü açar, sekme geri döndürür', async () => {
    sayfa({}, '/crypto-hub?t=metaco_das_test');
    await waitFor(() => expect(m.overview).toHaveBeenCalled());
    const kart = await screen.findByRole('button', { name: /Indexer \/ Node değişimi/ });
    expect(kart.getAttribute('aria-pressed')).toBe('false');
    expect(screen.queryByText('Indexer / Node bağlantıları')).toBeNull();
    fireEvent.click(kart);
    expect(await screen.findByText('Indexer / Node bağlantıları')).toBeTruthy();
    expect(nodeKarti().getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Durum' }));
    await waitFor(() => expect(screen.queryByText('Indexer / Node bağlantıları')).toBeNull());
    expect(nodeKarti().getAttribute('aria-pressed')).toBe('false');
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

/** "Yeni node" adımında rolün kutusuna yazar. */
const yaz = (etiket: string, deger: string) =>
  fireEvent.change(screen.getByLabelText(etiket), { target: { value: deger } });

describe('U2 sihirbaz', () => {
  it('rol başına kutu: anlık biçim hatası, maskeli önizleme, boş rol uyarısı; "İptal" var', async () => {
    await sihirbazAc(yanit());
    expect(screen.getByText('Node değişikliği — evm-ethereum-mainnet')).toBeTruthy();
    expect(screen.getByText('Şu anki değer (maskeli)')).toBeTruthy();
    expect(btn('İptal')).toBeTruthy();
    fireEvent.click(btn('İleri'));
    expect(screen.getByText('Yeni node değerleri')).toBeTruthy();
    expect(screen.getByText('Env: ETH_INDEXER_NODE_URI')).toBeTruthy();
    const kutu = screen.getByLabelText(RPC_ETIKET) as HTMLInputElement;
    expect(kutu.type).toBe('text');
    expect(kutu.getAttribute('autocomplete')).toBe('off');
    expect(kutu.getAttribute('spellcheck')).toBe('false');
    expect(kutu.getAttribute('maxlength')).toBeNull();
    // Boş: not + uyarı + onay kutusu; İleri kapalı.
    expect(screen.getByText('Boş — env değişkeni boş değere yazılır.')).toBeTruthy();
    expect(screen.getByText("rpc boş bırakıldı: env değişkeni BOŞ değere yazılır, uygulama node'suz kalabilir.")).toBeTruthy();
    expect(btn('İleri').disabled).toBe(true);
    // Hatalı: role=alert, sunucuyla aynı kural.
    yaz(RPC_ETIKET, 'https://x.invalid/a b');
    expect(screen.getByRole('alert').textContent).toMatch(/^URL http:\/\/, https:\/\/, ws:\/\/ ya da wss:\/\//);
    expect(btn('İleri').disabled).toBe(true);
    yaz(RPC_ETIKET, 'HTTPS://x.invalid');
    expect(screen.getByRole('alert')).toBeTruthy();
    yaz(RPC_ETIKET, 'https://x.invalid/ü');
    expect(screen.getByRole('alert').textContent).toMatch(/^Yalnız yazdırılabilir ASCII/);
    // Geçerli: maskeli önizleme; ham değer metin olarak hiçbir yerde yok.
    yaz(RPC_ETIKET, YENI);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByText(`Smart'ta böyle görünecek: ${YENI_MASKE}`)).toBeTruthy();
    expect(screen.queryByText(/boş bırakıldı/)).toBeNull();
    await waitFor(() => expect(btn('İleri').disabled).toBe(false));
    expect(document.body.textContent).not.toContain(SIR);
    for (const el of Array.from(document.querySelectorAll('[title]')))
      expect(el.getAttribute('title'), 'değer title niteliğine girdi').not.toContain(SIR);
    fireEvent.click(btn('İptal'));
    expect(screen.queryByText('Node değişikliği — evm-ethereum-mainnet')).toBeNull();
  });

  it('test ortamı: tutarsızlık onayı, gerekçe, onay adımında maskeli değer; gövde yeni/bosOnay; depo ve console temiz', async () => {
    const ls = vi.spyOn(Storage.prototype, 'setItem');
    const konsol = (['log', 'info', 'warn', 'error', 'debug'] as const).map((k) => vi.spyOn(console, k));
    m.change.mockResolvedValue({
      ok: true,
      pendingApproval: true,
      ticketId: 900,
      externalTicketId: 'SR-555',
      talepId: 42,
      onayZamanAsimiDk: 1440,
    });
    // Gerçek tutarsızlık: adapter B'de, indexer A'da.
    const tutarsizEnv = [env(AD, { sha: sha(VB), maskeli: 'https://eth-b.example.net/****' }), env(IX)];
    await sihirbazAc(yanit({ gruplar: [uisGrup({ tutarsiz: true, envler: tutarsizEnv })] }));
    fireEvent.click(btn('İleri'));
    yaz(RPC_ETIKET, YENI);
    await waitFor(() => expect(btn('İleri').disabled).toBe(false));
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
    expect(screen.getByText(`Yeni değer (maskeli): rpc: ${YENI_MASKE}`)).toBeTruthy();
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
      yeni: { rpc: YENI },
      bosOnay: false,
      gerekce: 'Sağlayıcı A kesintide',
      bilesenler: [AD, IX],
      tutarsizlikOnay: true,
    });
    expect('nodeId' in govde).toBe(false);
    expect(await screen.findByText(/^Smart talebi açıldı \(kayıt no: SR-555\)\./)).toBeTruthy();
    expect(screen.queryByText('Node değişikliği — evm-ethereum-mainnet')).toBeNull();
    // Değer tarayıcı deposuna ve console'a hiç yazılmadı.
    for (const c of ls.mock.calls) expect(JSON.stringify(c)).not.toContain(SIR);
    for (const k of konsol) for (const c of k.mock.calls) expect(JSON.stringify(c)).not.toContain(SIR);
    expect(document.body.textContent).not.toContain(SIR);
  });

  it('sır rolü password; boş rol onay kutusu olmadan geçilmez; Etki adımında uyarı tekrar; gövde bosOnay true', async () => {
    m.change.mockResolvedValue({ ok: true, ticketId: 901, externalTicketId: 'SR-560', talepId: 47 });
    await sihirbazAc(yanit({ gruplar: [uisGrup(), dotGrup()] }), DOT);
    fireEvent.click(btn('İleri'));
    const sir = screen.getByLabelText('auth — gizli değer') as HTMLInputElement;
    expect(sir.type).toBe('password');
    expect(sir.getAttribute('autocomplete')).toBe('off');
    expect(sir.getAttribute('spellcheck')).toBe('false');
    yaz('auth — gizli değer', ` ${SIR}`);
    expect(screen.getByRole('alert').textContent).toBe('Başta ve sonda boşluk olamaz.');
    yaz('auth — gizli değer', `Bearer ${SIR}`);
    expect(screen.getByText("Smart'ta böyle görünecek: ****")).toBeTruthy();
    // url boş: uyarı + onay kutusu.
    expect(screen.getByText("url boş bırakıldı: env değişkeni BOŞ değere yazılır, uygulama node'suz kalabilir.")).toBeTruthy();
    await waitFor(() => expect(screen.getByLabelText('Boş değerle yazılmasını onaylıyorum (iş birimi onaylı).')).toBeTruthy());
    expect(btn('İleri').disabled).toBe(true);
    fireEvent.click(screen.getByLabelText('Boş değerle yazılmasını onaylıyorum (iş birimi onaylı).'));
    await waitFor(() => expect(btn('İleri').disabled).toBe(false));
    // Onay ROL LİSTESİNE bağlı: url doldurulup auth boşaltılınca kutu düşer, İleri kapanır.
    yaz('url — URL (http, https, ws, wss)', 'https://dot.node.invalid');
    yaz('auth — gizli değer', '');
    expect(screen.getByText("auth boş bırakıldı: env değişkeni BOŞ değere yazılır, uygulama node'suz kalabilir.")).toBeTruthy();
    const kutu2 = screen.getByLabelText('Boş değerle yazılmasını onaylıyorum (iş birimi onaylı).') as HTMLInputElement;
    expect(kutu2.checked, 'başka rolün boş onayı yeni boş role taşındı').toBe(false);
    expect(btn('İleri').disabled).toBe(true);
    // Geri: url boş, auth dolu -> eski liste; onay yine kendiliğinden gelmez (yeniden işaretlenir).
    yaz('url — URL (http, https, ws, wss)', '');
    yaz('auth — gizli değer', `Bearer ${SIR}`);
    fireEvent.click(screen.getByLabelText('Boş değerle yazılmasını onaylıyorum (iş birimi onaylı).'));
    await waitFor(() => expect(btn('İleri').disabled).toBe(false));
    // Erişilebilirlik: kutu env ipucuna ve durum satırına bağlı.
    const url = screen.getByLabelText('url — URL (http, https, ws, wss)') as HTMLInputElement;
    const bagli = (url.getAttribute('aria-describedby') || '').split(' ').map((x) => document.getElementById(x)?.textContent);
    expect(bagli).toEqual(['Env: SIDECAR_URL', 'Boş — env değişkeni boş değere yazılır.']);
    fireEvent.click(btn('İleri'));
    expect(screen.getByText("url boş bırakıldı: env değişkeni BOŞ değere yazılır, uygulama node'suz kalabilir.")).toBeTruthy();
    fireEvent.click(btn('İleri'));
    fireEvent.change(screen.getByLabelText('Gerekçe (10–500 karakter)'), { target: { value: 'Sidecar url kaldırılıyor' } });
    fireEvent.click(btn('İleri'));
    expect(screen.getByText('Yeni değer (maskeli): auth: ****; url: (bos)')).toBeTruthy();
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(btn('Talep aç'));
    await waitFor(() => expect(m.change).toHaveBeenCalledTimes(1));
    expect(m.change.mock.calls[0][0]).toMatchObject({ grup: DOT, yeni: { auth: `Bearer ${SIR}`, url: '' }, bosOnay: true });
    expect(document.body.textContent).not.toContain(SIR);
  });

  it('production: grup adını AYNEN yazdırır (parça yetmez); Ankara uyarısı; onayMetni gönderilir', async () => {
    m.change.mockResolvedValue({ ok: true, ticketId: 900, externalTicketId: 'SR-556', talepId: 43 });
    await sihirbazAc(
      yanit({}, { key: 'metaco_das_prod', production: true, esKiraci: 'metaco_das_prod_ank' }),
    );
    fireEvent.click(btn('İleri'));
    yaz(RPC_ETIKET, YENI);
    await waitFor(() => expect(btn('İleri').disabled).toBe(false));
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
    expect(m.change.mock.calls[0][0]).toMatchObject({ tenant: 'metaco_das_prod', onayMetni: UIS, yeni: { rpc: YENI } });
  });

  async function sonaKadar(r: CryptoNodesResponse) {
    await sihirbazAc(r);
    fireEvent.click(btn('İleri'));
    yaz(RPC_ETIKET, YENI);
    await waitFor(() => expect(btn('İleri').disabled).toBe(false));
    fireEvent.click(btn('İleri'));
    fireEvent.click(btn('İleri'));
    fireEvent.change(screen.getByLabelText('Gerekçe (10–500 karakter)'), { target: { value: 'x'.repeat(12) } });
    fireEvent.click(btn('İleri'));
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(btn('Talep aç'));
  }

  it('sunucu reddi mesajı sihirbazda gösterilir, sihirbaz açık kalır', async () => {
    m.change.mockResolvedValue({
      ok: false,
      blocked: 'node_bekleyen_talep',
      message: 'Bu grup için açık bir talep var (Smart #SR-1). Sonuçlanmadan yeni talep açılamaz.',
    });
    await sonaKadar(yanit());
    expect(await screen.findByText(/Bu grup için açık bir talep var \(Smart #SR-1\)/)).toBeTruthy();
    expect(screen.getByText('Node değişikliği — evm-ethereum-mainnet')).toBeTruthy();
  });

  it('ağ hatası: geçit metni aynen; diğer hatada gövde önizlemesi değil sabit metin', async () => {
    const gecit = Object.assign(new Error('Portal şu an yeniden başlatılıyor (HTTP 502).'), { gatewayUnavailable: true });
    m.change.mockRejectedValueOnce(gecit);
    await sonaKadar(yanit());
    expect(await screen.findByText('Portal şu an yeniden başlatılıyor (HTTP 502).')).toBeTruthy();
    m.change.mockRejectedValueOnce(new Error(`Sunucu beklenmeyen bir yanıt döndü [${YENI}]`));
    fireEvent.click(btn('Talep aç'));
    expect(await screen.findByText('Talep açılamadı (bağlantı hatası).')).toBeTruthy();
    expect(document.body.textContent).not.toContain(YENI);
  });

  it('sunucunun çevrilmiş reddi (nginxRed) mesajıyla görünür; bağlantı hatası denmez', async () => {
    const mesaj = 'Crypto Hub Smart ayarı eksik: yönetici düzeltmeli.';
    m.change.mockRejectedValueOnce(Object.assign(new Error(mesaj), { status: 503, nginxRed: true }));
    await sonaKadar(yanit());
    expect(await screen.findByText(mesaj)).toBeTruthy();
    expect(screen.queryByText('Talep açılamadı (bağlantı hatası).')).toBeNull();
    expect(screen.getByText('Node değişikliği — evm-ethereum-mainnet')).toBeTruthy();
  });

  it.each([
    ['node_deger_bicim', { rol: 'rpc', neden: 'url', message: 'Geçersiz değer (rpc): url.' }, /^rpc: URL http:\/\//],
    ['node_ayni_node', { message: 'Girilen değer seçilen bileşenlerde zaten kullanımda — değişiklik yok.' }, /zaten kullanımda/],
    ['node_bos_onay', { message: 'Boş bırakılan rol var; boş değerle yazılması ayrıca onaylanmalı.' }, /^Boş bırakılan rol var/],
  ])('sunucu %s derse "Yeni node" adımına döner ve nedeni söyler', async (blocked, ek, metin) => {
    m.change.mockResolvedValue({ ok: false, blocked, ...ek });
    await sonaKadar(yanit());
    await waitFor(() => expect(screen.getByLabelText(RPC_ETIKET)).toBeTruthy());
    expect(screen.getByText(metin)).toBeTruthy();
    expect((screen.getByLabelText(RPC_ETIKET) as HTMLInputElement).value).toBe(YENI);
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
        sum: { sonuc: 'ok', planSha: H('c'), talepId: '42', kod: '-' },
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

  it('Ankara bağlantısı (?g&es): sihirbaz aynı grupla açılır, değer ÖN DOLDURULMAZ (yeniden yazılır); esTalepId gönderilir', async () => {
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
        initialEntries={[`/crypto-hub?t=metaco_das_prod_ank&s=node&g=${encodeURIComponent(UIS)}&es=42`]}
      >
        <CryptoHubPage />
      </MemoryRouter>,
    );
    expect(await screen.findByText('Node değişikliği — evm-ethereum-mainnet')).toBeTruthy();
    fireEvent.click(btn('İleri'));
    expect((screen.getByLabelText(RPC_ETIKET) as HTMLInputElement).value).toBe('');
    yaz(RPC_ETIKET, YENI);
    await waitFor(() => expect(btn('İleri').disabled).toBe(false));
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
      yeni: { rpc: YENI },
      esTalepId: 42,
      onayMetni: UIS,
    });
    expect('nodeId' in m.change.mock.calls[0][0]).toBe(false);
    expect(m.read).not.toHaveBeenCalled();
  });

  it('PS6 Ankara bağı sihirbaz İptal edilip "Değiştir" ile yeniden açılınca da gönderilir', async () => {
    m.change.mockResolvedValue({ ok: true, ticketId: 902, externalTicketId: 'SR-601', talepId: 45 });
    m.nodes.mockResolvedValue(yanit({}, { key: 'metaco_das_prod_ank', lokasyon: 'Ankara', production: true }));
    render(
      <MemoryRouter>
        <NodePanel
          tenantKey="metaco_das_prod_ank"
          baslangic={{ grup: UIS, esTalepId: 42 }}
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
    yaz(RPC_ETIKET, YENI);
    await waitFor(() => expect(btn('İleri').disabled).toBe(false));
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
      mevcutNode: { maskeli: { rpc: 'https://eth-a.example.net/****' } },
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
    // Kullanıcı kararı 2026-11-03: yalnız maskeli değer.
    expect(screen.getAllByText('— şu an: rpc: https://eth-a.example.net/****').length).toBe(3);
    for (const b of ['adapter', 'api', 'indexer']) fireEvent.click(kutu(b));
    expect(btn('İleri').disabled).toBe(true);
    expect(screen.getByText('En az bir bileşen seçin.')).toBeTruthy();
    fireEvent.click(kutu('indexer'));
    expect(btn('İleri').disabled).toBe(false);
    fireEvent.click(btn('İleri'));
    yaz(RPC_ETIKET, YENI);
    await waitFor(() => expect(btn('İleri').disabled).toBe(false));
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
    const envler = [env(AD, { sha: sha(VB), maskeli: 'https://eth-b.example.net/****' }), env(API), env(IX)];
    await sihirbazAc(yanit({ gruplar: [ucBilesen({ tutarsiz: true, envler })] }));
    expect(screen.getByText("Bileşenler farklı node'lara bağlı.")).toBeTruthy();
    const kutu = (b: string) => screen.getByLabelText(new RegExp(`^${b} — şu an:`)) as HTMLInputElement;
    // Yalnız api + indexer (ikisi de A) -> C: ek onay yok.
    fireEvent.click(kutu('adapter'));
    fireEvent.click(btn('İleri'));
    yaz(RPC_ETIKET, YENI);
    await waitFor(() => expect(btn('İleri').disabled).toBe(false));
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

  it('girilen değer seçilen bileşenlerde zaten kullanımdaysa (sha256) İleri kapalı ve açıklanır', async () => {
    const envler = [env(AD, { sha: sha(VB), maskeli: 'https://eth-b.example.net/****' }), env(API), env(IX)];
    await sihirbazAc(yanit({ gruplar: [ucBilesen({ tutarsiz: true, envler })] }));
    const kutu = (b: string) => screen.getByLabelText(new RegExp(`^${b} — şu an:`)) as HTMLInputElement;
    fireEvent.click(kutu('api'));
    fireEvent.click(kutu('indexer'));
    fireEvent.click(btn('İleri'));
    yaz(RPC_ETIKET, VB);
    expect(
      await screen.findByText('Girilen değer seçilen bileşenlerde zaten kullanımda — değişiklik yok.'),
    ).toBeTruthy();
    expect(btn('İleri').disabled).toBe(true);
    // Başka değer: uyarı kalkar, İleri açılır.
    yaz(RPC_ETIKET, YENI);
    await waitFor(() => expect(btn('İleri').disabled).toBe(false));
    expect(screen.queryByText(/zaten kullanımda/)).toBeNull();
    // Seçim değişince yeniden hesaplanır: adapter'ı geri alıp api'yi seçince VB artık aynı değil.
    yaz(RPC_ETIKET, VB);
    await screen.findByText(/zaten kullanımda/);
    fireEvent.click(btn('Geri'));
    fireEvent.click(kutu('api'));
    fireEvent.click(btn('İleri'));
    await waitFor(() => expect(screen.queryByText(/zaten kullanımda/)).toBeNull());
    expect(btn('İleri').disabled).toBe(false);
  });
});

// ── U6 görünüm (kullanıcı geri bildirimi 2026-11-03) ────────────────────────────────
//   pencere geniş; "Katalog" sütunu/rozeti kalktı (yalnız maskeli); yeni tip kart tablosu (th scope);
//   eski tip kart aynen; geçmişte yeni değer maskeli; admin Smart önizleme değer almaz
describe('U6 görünüm', () => {
  const WIDE = 'max-w-[min(90rem,95vw)]';

  it('sihirbaz geniş pencerede açılır; mevcut tablo yalnız maskeli değer, eşleşme olsa da ad/"Katalog" sütunu yok', async () => {
    const envler = [env(AD), env(IX, { maskeli: 'https://x.example.net/****' })];
    await sihirbazAc(yanit({ gruplar: [uisGrup({ envler })] }));
    const baslik = screen.getByText('Node değişikliği — evm-ethereum-mainnet');
    const panel = baslik.closest(`[class*="${WIDE}"]`) as HTMLElement | null;
    expect(panel, 'sihirbaz size="wide" değil').toBeTruthy();
    const basliklar = Array.from(panel!.querySelectorAll('thead th')).map((t) => t.textContent);
    expect(basliklar).toEqual(['Bileşen', 'Kap', 'Env değişkeni', 'Şu anki değer (maskeli)']);
    expect(Array.from(panel!.querySelectorAll('thead th')).every((t) => t.getAttribute('scope') === 'col')).toBe(true);
    // Sihirbaz gövdesi 13 px; tablo hücreleri px-3 py-2.
    expect(panel!.querySelector('.space-y-3.text-\\[13px\\]')).toBeTruthy();
    expect(Array.from(panel!.querySelectorAll('tbody td')).every((td) => /\bpx-3\b/.test(td.className) && /\bpy-2\b/.test(td.className))).toBe(true);
    const satirlar = Array.from(panel!.querySelectorAll('tbody tr')).map((tr) =>
      Array.from(tr.querySelectorAll('td')).map((td) => td.textContent),
    );
    expect(satirlar.map((x) => x.length)).toEqual([4, 4]);
    expect(satirlar.map((x) => x[3])).toEqual(['https://eth-a.example.net/****', 'https://x.example.net/****']);
    expect(panel!.textContent).not.toMatch(/katalog/i);
    expect(panel!.textContent).not.toContain('Tanımlı değil');
    fireEvent.click(btn('İleri'));
    expect(panel!.textContent).not.toMatch(/katalog/i);
  });

  it('yeni tip kart tablosu: 4 satır sırayla, eksik bileşen, bağlantısız processor, env adları, özet', async () => {
    const mA = { maskeli: { rpc: 'https://eth-a.example.net/****' } };
    const a = dep(AD, 'adapter', { mevcutNode: mA });
    const ix = dep(IX, 'indexer', { mevcutNode: { maskeli: { rpc: 'https://q.example.net/****' } } });
    const PR = 'hmz-harmonize-uis-processor-evm-ethereum-mainnet';
    const pr = dep(PR, 'processor', { nodeBagli: false });
    const g = uisGrup({
      bilesenler: { adapter: a, api: null, indexer: ix, processor: pr },
      deploymentlar: [a, ix, pr],
      envler: [env(AD), env(AD, { env: 'ETH_INDEXER_WS_URI', container: 'side' }), env(IX)],
    });
    m.nodes.mockResolvedValue(yanit({ gruplar: [g, eskiGrup()] }));
    render(<NodePanel tenantKey="metaco_das_test" />);
    await screen.findByText('Indexer / Node bağlantıları');
    const tablo = kart(UIS).querySelector('[data-uis-tablo]') as HTMLElement;
    expect(tablo, 'uis kartında tablo yok').toBeTruthy();
    expect(tablo.closest('.overflow-x-auto')).toBeTruthy();
    const basliklar = Array.from(tablo.querySelectorAll('th')).map((t) => t.textContent);
    expect(basliklar).toEqual(['Bileşen', 'Deployment', 'Durum', 'Node değişkeni', 'Şu anki değer']);
    expect(Array.from(tablo.querySelectorAll('th')).every((t) => t.getAttribute('scope') === 'col')).toBe(true);
    expect(tablo.className).toMatch(/\bw-full\b/);
    expect(tablo.className).toMatch(/text-\[12px\]/);
    const satir = Array.from(tablo.querySelectorAll('tbody tr')) as HTMLElement[];
    expect(satir.map((s) => s.getAttribute('data-bilesen'))).toEqual(['adapter', 'api', 'indexer', 'processor']);
    const hucre = (i: number) => Array.from(satir[i].querySelectorAll('td')).map((td) => td.textContent);
    expect(hucre(0)).toEqual([
      'adapter',
      AD,
      'çalışıyor · 1 / 1',
      'ETH_INDEXER_NODE_URI, ETH_INDEXER_WS_URI',
      'rpc: https://eth-a.example.net/****',
    ]);
    expect(hucre(1)).toEqual(['api', 'bu ağda yok']);
    expect(hucre(2).slice(3)).toEqual(['ETH_INDEXER_NODE_URI', 'rpc: https://q.example.net/****']);
    expect(hucre(3)).toEqual(['processor', PR, 'çalışıyor · 1 / 1', '—', 'node bağlantısı yok']);
    expect(within(kart(UIS)).getByText("Tüm bileşenler aynı node'a bağlı: rpc: https://eth-a.example.net/****")).toBeTruthy();
    // eski 'rol: maskeli (deployment / env)' bloğu uis kartında yok
    expect(kart(UIS).textContent).not.toContain(`(${AD} / ETH_INDEXER_NODE_URI)`);
    // eski tip kart aynen: tablo yok, deployment satırı + rol satırı var
    const eski = kart('eski:ethereum-mainnet');
    expect(eski.querySelector('[data-uis-tablo]')).toBeNull();
    expect(eski.querySelector('table')).toBeNull();
    expect(eski.textContent).toContain('hmz-harmonize-ethereum-mainnet · çalışıyor · 1 / 1');
    expect(eski.textContent).toContain('rpc: https://eth-a.example.net/****');
    // Tutarsız eski tip: satır başına "rol: maskeli (deployment / env)" (aynen).
    const ed = 'hmz-harmonize-ethereum-mainnet';
    m.nodes.mockResolvedValue(
      yanit({
        gruplar: [eskiGrup({ tutarsiz: true, envler: [env(ed), env(ed, { container: 'b', env: 'X_URI', maskeli: 'https://z.example.net/****', sha: sha(VB) })] })],
      }),
    );
    cleanup();
    render(<NodePanel tenantKey="metaco_das_test" />);
    await screen.findByText('Indexer / Node bağlantıları');
    expect(kart('eski:ethereum-mainnet').textContent).toContain(`rpc: https://z.example.net/**** (${ed} / X_URI)`);
  });

  it('okunmamış uis kartı: "Henüz okunmadı" hücrede; tutarsız grupta özet satırı yok', async () => {
    m.nodes.mockResolvedValue(
      yanit({
        gruplar: [
          uisGrup({ envler: [], mevcutNode: null, okumaBekleniyor: true }),
          uisGrup({ id: 'uis:b', baslik: 'b', tutarsiz: true }),
        ],
      }),
    );
    render(<NodePanel tenantKey="metaco_das_test" />);
    await screen.findByText('Indexer / Node bağlantıları');
    const t = kart(UIS).querySelector('[data-uis-tablo]') as HTMLElement;
    expect(within(t).getAllByText('Henüz okunmadı').length).toBe(3);
    expect(kart('uis:b').textContent).not.toContain("Tüm bileşenler aynı node'a bağlı");
  });

  it('okunmuş ama node değişkeni olmayan uis grubu "Henüz okunmadı" demez', async () => {
    m.nodes.mockResolvedValue(
      yanit({
        gruplar: [
          uisGrup({
            envler: [],
            mevcutNode: null,
            degiskenYok: true,
            okumaBekleniyor: false,
            deploymentlar: uisGrup().deploymentlar.map((d) => ({ ...d, nodeBagli: false, mevcutNode: null })),
          }),
        ],
      }),
    );
    render(<NodePanel tenantKey="metaco_das_test" />);
    await screen.findByText('Indexer / Node bağlantıları');
    const t = kart(UIS).querySelector('[data-uis-tablo]') as HTMLElement;
    expect(within(t).queryByText('Henüz okunmadı')).toBeNull();
    expect(within(t).getAllByText('node bağlantısı yok').length).toBeGreaterThan(0);
  });

  it('liste eşleşmesi rozeti hiçbir durumda yok; kartta "katalog" geçmez', async () => {
    const eslesen = { maskeli: { rpc: 'https://eth-a.example.net/****' } };
    const mn = { maskeli: { rpc: 'https://x.example.net/****' } };
    m.nodes.mockResolvedValue(
      yanit({
        gruplar: [
          uisGrup({ mevcutNode: eslesen }),
          eskiGrup({ mevcutNode: eslesen }),
          uisGrup({ id: 'uis:c', baslik: 'c', mevcutNode: mn }),
          eskiGrup({ id: 'eski:c', baslik: 'c', mevcutNode: mn }),
        ],
      }),
    );
    render(<NodePanel tenantKey="metaco_das_test" />);
    await screen.findByText('Indexer / Node bağlantıları');
    for (const id of [UIS, 'eski:ethereum-mainnet', 'uis:c', 'eski:c']) {
      expect(kart(id).textContent, id).not.toMatch(/Node: /);
      expect(kart(id).textContent, id).not.toMatch(/katalog/i);
      expect(kart(id).querySelector('[data-aday-notu]'), id).toBeNull();
    }
    expect(within(kart('uis:c')).getByText("Tüm bileşenler aynı node'a bağlı: rpc: https://x.example.net/****")).toBeTruthy();
  });

  it('geçmiş tablosu yeni değeri maskeli gösterir', async () => {
    m.nodes.mockResolvedValue(yanit({ gecmis: [talep({ durum: 'BASARILI', kapandiAt: 'x' })] }));
    render(<NodePanel tenantKey="metaco_das_test" />);
    await screen.findByText('Indexer / Node bağlantıları');
    expect(screen.getByRole('columnheader', { name: 'Yeni değer (maskeli)' })).toBeTruthy();
    expect(screen.getByText('rpc=https://eth-c.node.invalid/****')).toBeTruthy();
  });

  it('admin Smart önizleme: seçim/değer yok, "Önizle" açık, istek yalnız {tenant, grup}', async () => {
    m.nodes.mockResolvedValue(yanit({ yetki: { okuma: true, talep: true, admin: true } }));
    m.smartOnizle.mockResolvedValue({ ok: true, flowKey: 'F', metadata: { ACIKLAMA: 'Yeni node (maskeli): rpc=(önizleme)' } });
    render(<NodePanel tenantKey="metaco_das_test" />);
    await screen.findByText('Indexer / Node bağlantıları');
    fireEvent.click(within(kart(UIS)).getByRole('button', { name: 'Smart önizleme' }));
    expect(document.querySelector('select')).toBeNull();
    expect(btn('Önizle').disabled).toBe(false);
    fireEvent.click(btn('Önizle'));
    await waitFor(() => expect(m.smartOnizle).toHaveBeenCalledWith({ tenant: 'metaco_das_test', grup: UIS }));
    expect(await screen.findByText('Yeni node (maskeli): rpc=(önizleme)')).toBeTruthy();
  });
});

// ── U4 ───────────────────────────────────────────────────────────────────────────────
describe('U4 yapı', () => {
  const DIR = path.join(__dirname, '..', 'components', 'crypto_hub');
  const DOSYALAR = ['NodePanel.tsx', 'NodeDegisiklikModal.tsx', 'NodeTakip.tsx', 'nodeOrtak.ts', 'CryptoHubSmartModal.tsx'];
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

  it('istemci gövdesi izinli alanlar: değer yalnız `yeni` (rol -> metin) alanında; nodeId yok', () => {
    const api = fs.readFileSync(path.join(__dirname, '..', 'api', 'cryptoHubApi.ts'), 'utf8');
    const govde = api.slice(api.indexOf('export interface NodeChangeBody'));
    const blok = govde.slice(0, govde.indexOf('}') + 1);
    const alanlar = Array.from(blok.matchAll(/^\s+(\w+)\??:/gm)).map((x) => x[1]);
    expect(alanlar).toEqual([
      'tenant',
      'grup',
      'yeni',
      'bosOnay',
      'gerekce',
      'tutarsizlikOnay',
      'onayMetni',
      'esTalepId',
      'bilesenler',
      'onaysizKabul',
    ]);
    const onizle = /smartOnizle: \(body: \{([^}]*)\}\)/.exec(api);
    expect(onizle, 'smartOnizle imzası bulunamadı').toBeTruthy();
    expect(onizle![1]).not.toMatch(/nodeId|yeni/);
  });
});

// ── U7 ───────────────────────────────────────────────────────────────────────────────
describe('U7 Smart kapalı test yolu', () => {
  const ONAYSIZ_KUTU = 'Smart onayı olmadan işin hemen başlayacağını anlıyorum.';
  const SMART_KUTU = 'Smart talebi açılacağını ve onaydan sonra değişikliğin otomatik uygulanacağını anlıyorum.';
  async function sonAdim(r: CryptoNodesResponse) {
    await sihirbazAc(r);
    fireEvent.click(btn('İleri'));
    yaz(RPC_ETIKET, YENI);
    await waitFor(() => expect(btn('İleri').disabled).toBe(false));
    fireEvent.click(btn('İleri'));
    fireEvent.click(btn('İleri'));
    fireEvent.change(screen.getByLabelText('Gerekçe (10–500 karakter)'), { target: { value: 'Test ortamı denemesi' } });
    fireEvent.click(btn('İleri'));
  }

  it('kapalıyken "Talep aç" yerine onaysız başlatma metni ve uyarı; takip CALISIYOR\'dan başlar', async () => {
    m.change.mockResolvedValue({ ok: true, pendingApproval: false, onaysiz: true, talepId: 7, jobId: 3001, awxServerId: 1 });
    m.changeDetail.mockReturnValue(new Promise(() => {}));
    await sonAdim(yanit({ smartMod: 'kapali', smartKaynak: 'opsx' }));
    expect(screen.getByText(/test ortamında kapalı: node değişiklikleri onaysız başlar/)).toBeTruthy();
    expect(screen.getByText(/talep açılmaz, iş onaysız ve hemen başlar/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Talep aç' })).toBeNull();
    expect(screen.queryByText(/Smart talebi açılır/)).toBeNull();
    expect(btn('İşi onaysız başlat').disabled).toBe(true);
    fireEvent.click(screen.getByLabelText(ONAYSIZ_KUTU));
    fireEvent.click(btn('İşi onaysız başlat'));
    expect(await screen.findByText(/İş onaysız başlatıldı \(AWX #3001\)/)).toBeTruthy();
    expect(screen.getByText('Uygulanıyor…')).toBeTruthy();
    expect(screen.queryByText(/Smart talebi açıldı/)).toBeNull();
    expect(screen.queryByText(/Onay bekliyor/)).toBeNull();
    expect(m.takip.mock.calls.every((c) => c[0] == null)).toBe(true);
  });

  it('kapalıyken hiçbir ara metin Smart demez: maskeli görünüm, koşan talep bandı', async () => {
    await sihirbazAc(yanit({ smartMod: 'kapali' }));
    fireEvent.click(btn('İleri'));
    yaz(RPC_ETIKET, YENI);
    expect(await screen.findByText(`Ekranda ve denetimde böyle görünecek: ${YENI_MASKE}`)).toBeTruthy();
    expect(screen.queryByText(/Smart'ta böyle görünecek/)).toBeNull();
    expect(screen.queryByText(/Smart'ta ve denetimde/)).toBeNull();
    cleanup();
    await sihirbazAc(yanit());
    fireEvent.click(btn('İleri'));
    yaz(RPC_ETIKET, YENI);
    expect(await screen.findByText(`Smart'ta böyle görünecek: ${YENI_MASKE}`)).toBeTruthy();
    cleanup();
    m.nodes.mockResolvedValue(
      yanit({
        smartMod: 'kapali',
        gruplar: [
          uisGrup({
            degistirilebilir: false,
            bekleyen: { talepId: 7, externalTicketId: null, username: 'ali', createdAt: '2026-11-02T08:00:00Z', durum: 'CALISIYOR' },
          }),
        ],
      }),
    );
    render(<NodePanel tenantKey="metaco_das_test" takipAralikMs={20} />);
    expect(await screen.findByText(/^Uygulanan değişiklik: Portal #7 — ali, /)).toBeTruthy();
    expect(screen.queryByText(/Onay bekleyen değişiklik/)).toBeNull();
  });

  it('gövde onaysizKabul yalnız kapalı metin gösterildiyse taşır', async () => {
    m.change.mockResolvedValue({ ok: false, message: 'dur' });
    await sonAdim(yanit({ smartMod: 'kapali' }));
    fireEvent.click(screen.getByLabelText(ONAYSIZ_KUTU));
    fireEvent.click(btn('İşi onaysız başlat'));
    await waitFor(() => expect(m.change).toHaveBeenCalledTimes(1));
    expect(m.change.mock.calls[0][0].onaysizKabul).toBe(true);
    cleanup();
    m.change.mockClear();
    await sonAdim(yanit());
    fireEvent.click(screen.getByLabelText(SMART_KUTU));
    fireEvent.click(btn('Talep aç'));
    await waitFor(() => expect(m.change).toHaveBeenCalledTimes(1));
    expect('onaysizKabul' in m.change.mock.calls[0][0]).toBe(false);
  });

  it.each(['crypto_node_smart_mod_degisti', 'crypto_node_smart_degisti'])(
    '%s: mod yeniden okunur, onay düşer, düğme güncel metne döner, sihirbaz açık kalır',
    async (blocked) => {
      const mesaj = 'Smart onay ayarı siz ekrandayken değişti.';
      m.change.mockResolvedValue({ ok: false, blocked, message: mesaj });
      await sonAdim(yanit());
      m.nodes.mockResolvedValue(yanit({ smartMod: 'kapali' }));
      fireEvent.click(screen.getByLabelText(SMART_KUTU));
      fireEvent.click(btn('Talep aç'));
      expect(await screen.findByText(mesaj)).toBeTruthy();
      await waitFor(() => expect(btn('İşi onaysız başlat').disabled).toBe(true));
      expect((screen.getByLabelText(ONAYSIZ_KUTU) as HTMLInputElement).checked).toBe(false);
      expect(screen.getByText(/talep açılmaz, iş onaysız ve hemen başlar/)).toBeTruthy();
      expect(m.change).toHaveBeenCalledTimes(1);
    },
  );

  it('çift tıklama tek istek', async () => {
    let bitir: (v: unknown) => void = () => {};
    m.change.mockReturnValue(new Promise((r) => (bitir = r)));
    await sonAdim(yanit({ smartMod: 'kapali' }));
    fireEvent.click(screen.getByLabelText(ONAYSIZ_KUTU));
    const d = btn('İşi onaysız başlat');
    // Tek act: state yazılmadan ikinci tıklama gelir, disabled'a değil ref kapısına çarpar.
    await act(async () => {
      d.click();
      d.click();
    });
    await waitFor(() => expect(m.change).toHaveBeenCalledTimes(1));
    expect(btn('İş başlatılıyor…').disabled).toBe(true);
    await act(async () => {
      bitir({ ok: false, message: 'hata' });
    });
    expect(m.change).toHaveBeenCalledTimes(1);
  });

  it('belirsiz launch: sihirbaz kapanır, takip açılır, mesaj görünür', async () => {
    const mesaj = 'AWX yanıtı alınamadı; iş başlamış olabilir.';
    m.change.mockResolvedValue({ ok: false, blocked: 'crypto_node_dogrudan_belirsiz', talepId: 9, message: mesaj });
    m.changeDetail.mockReturnValue(new Promise(() => {}));
    await sonAdim(yanit({ smartMod: 'kapali' }));
    fireEvent.click(screen.getByLabelText(ONAYSIZ_KUTU));
    fireEvent.click(btn('İşi onaysız başlat'));
    expect(await screen.findByText(mesaj)).toBeTruthy();
    expect(screen.queryByText('Node değişikliği — evm-ethereum-mainnet')).toBeNull();
    expect(screen.getByText('Uygulanıyor…')).toBeTruthy();
  });

  it('production kiracıda smartMod kapalı gelse de ekran Smart metnini korur', async () => {
    await sonAdim(yanit({ smartMod: 'kapali' }, { production: true }));
    expect(screen.queryByText(/talep açılmaz, iş onaysız/)).toBeNull();
    expect(btn('Talep aç')).toBeTruthy();
  });

  it('Smart önizleme alt başlığı kaynağa bağlı', async () => {
    m.nodes.mockResolvedValue(yanit({ smartKaynak: 'crypto', yetki: { okuma: true, talep: true, admin: true } }));
    render(<NodePanel tenantKey="metaco_das_test" takipAralikMs={20} />);
    await screen.findByText('Indexer / Node bağlantıları');
    fireEvent.click(screen.getAllByRole('button', { name: 'Smart önizleme' })[0]);
    expect(await screen.findByText(/^Crypto Hub Smart şablonu bu talep için/)).toBeTruthy();
  });
});

// ── U8 ───────────────────────────────────────────────────────────────────────────────
describe('U8 Smart Onayı penceresi', () => {
  const ayar = (ek = {}, smart = {}) => ({
    ok: true,
    smart: { enabled: true, flowKey: '', metadataFields: '', integrationKeySet: false, ...smart },
    kaynak: 'opsx',
    durum: 'opsx',
    opsxFlowKey: 'FLOW_OPENSHIFT',
    sifrelemeVar: true,
    ...ek,
  });
  const ac = async (r = ayar(), onKaydedildi = vi.fn()) => {
    m.smartAyar.mockResolvedValue(r);
    render(<CryptoHubSmartModal open onClose={vi.fn()} onKaydedildi={onKaydedildi} />);
    await screen.findByText('Smart onayı istensin');
    return onKaydedildi;
  };

  afterEach(() => {
    kimlik.rol = 'User';
  });

  async function sayfa(env: Record<string, unknown>, url = '/crypto-hub?t=metaco_das_test', bekle: string | RegExp = 'Ortamı değiştir') {
    m.tenants.mockResolvedValue({
      ok: true,
      apps: [
        {
          app: 'metaco',
          label: 'Metaco',
          domains: [{ domain: 'das', label: 'DAS', envs: [{ key: 'metaco_das_test', env: 'test', label: 'Test', production: false, ready: true, open: true, cluster: 'c', namespace: 'n', ...env }] }],
        },
      ],
    });
    m.actions.mockResolvedValue({ ok: true, actions: [] });
    m.overview.mockResolvedValue({ ok: true, components: [], versions: [] });
    m.nodes.mockResolvedValue(yanit());
    render(
      <MemoryRouter initialEntries={[url]}>
        <CryptoHubPage />
      </MemoryRouter>,
    );
    await screen.findByText(bekle);
  }

  it('Picker ekranında da düğme ve pencere var; User görmez', async () => {
    await sayfa({}, '/crypto-hub', /^Hangi uygulamada/);
    expect(screen.queryByRole('button', { name: 'Smart Onayı' })).toBeNull();
    cleanup();
    kimlik.rol = 'Admin';
    await sayfa({}, '/crypto-hub', /^Hangi uygulamada/);
    expect(screen.queryByText('Ortamı değiştir')).toBeNull();
    m.smartAyar.mockResolvedValue(ayar());
    fireEvent.click(btn('Smart Onayı'));
    expect(await screen.findByText('Smart onayı istensin')).toBeTruthy();
  });

  it('kayıt sonrası NodePanel /nodes yeniden okur: sihirbaz bayat metinle kalmaz', async () => {
    kimlik.rol = 'Admin';
    await sayfa({ nodeOpen: true }, '/crypto-hub?t=metaco_das_test&s=node', 'Indexer / Node bağlantıları');
    const once = m.nodes.mock.calls.length;
    expect(screen.queryByText(/test ortamında kapalı: node değişiklikleri onaysız başlar/)).toBeNull();
    m.smartAyar.mockResolvedValue(ayar());
    m.smartAyarKaydet.mockResolvedValue(ayar());
    m.nodes.mockResolvedValue(yanit({ smartMod: 'kapali' }));
    fireEvent.click(btn('Smart Onayı'));
    await screen.findByText('Smart onayı istensin');
    fireEvent.click(btn('Kaydet'));
    await waitFor(() => expect(m.nodes.mock.calls.length).toBeGreaterThan(once));
    expect(await screen.findByText(/test ortamında kapalı: node değişiklikleri onaysız başlar/)).toBeTruthy();
  });

  it('düğme yalnız Admin\'de; node-only kullanıcıda ve User\'da yok', async () => {
    await sayfa({});
    expect(screen.queryByRole('button', { name: 'Smart Onayı' })).toBeNull();
    cleanup();
    kimlik.rol = 'Admin';
    await sayfa({ nodeOnly: true });
    expect(screen.queryByRole('button', { name: 'Smart Onayı' })).toBeNull();
    cleanup();
    await sayfa({});
    m.smartAyar.mockResolvedValue(ayar());
    fireEvent.click(btn('Smart Onayı'));
    expect(await screen.findByText('Smart onayı istensin')).toBeTruthy();
  });

  it('kaynak ve dört durum görünür; token ekrana gelmez', async () => {
    await ac();
    expect(screen.getByText(/Şu an OpsX OpenShift ayarı kullanılıyor \(Flow Key: FLOW_OPENSHIFT\)/)).toBeTruthy();
    cleanup();
    await ac(ayar({ kaynak: 'crypto', durum: 'kendi' }, { flowKey: 'F', metadataFields: 'A: b', integrationKeySet: true }));
    expect(screen.getByText('Durum: Crypto Hub kendi Smart ayarıyla çalışıyor.')).toBeTruthy();
    const t = screen.getByLabelText('Entegrasyon Anahtarı (opsiyonel)') as HTMLInputElement;
    expect(t.type).toBe('password');
    expect(t.value).toBe('');
    expect(t.placeholder).toBe('Tanımlı — değiştirmek için yeni değeri yazın');
    cleanup();
    await ac(ayar({ durum: 'testte_kapali' }, { enabled: false }));
    expect(screen.getByText('Durum: test ortamlarında Smart kapalı.')).toBeTruthy();
    cleanup();
    await ac(ayar({ durum: 'eksik', kaynak: null, opsxFlowKey: '' }));
    expect(screen.getByText('Durum: eksik — talep açılamaz.')).toBeTruthy();
    expect(screen.getByText('Kullanılabilir bir Smart ayarı yok.')).toBeTruthy();
  });

  it('kapatma açık onay ister; yalnız test ortamı notu görünür', async () => {
    m.smartAyarKaydet.mockResolvedValue(ayar({ durum: 'testte_kapali' }, { enabled: false }));
    const kaydedildi = await ac();
    expect(screen.getByText("Yalnız test ortamlarında geçerli; production'da Smart zorunludur.")).toBeTruthy();
    expect(btn('Kaydet').disabled).toBe(false);
    fireEvent.click(screen.getByLabelText('Smart onayı istensin'));
    expect(btn('Kaydet').disabled).toBe(true);
    fireEvent.click(btn('Kaydet'));
    expect(m.smartAyarKaydet).not.toHaveBeenCalled();
    fireEvent.click(screen.getByLabelText('Test ortamlarında node değişikliklerinin onaysız çalışacağını anlıyorum.'));
    const d = btn('Kaydet');
    expect(d.disabled).toBe(false);
    // Tek act: state yazılmadan ikinci tıklama gelir, disabled'a değil ref kapısına çarpar.
    await act(async () => {
      d.click();
      d.click();
    });
    await waitFor(() => expect(m.smartAyarKaydet).toHaveBeenCalledTimes(1));
    expect(m.smartAyarKaydet.mock.calls[0][0]).toEqual({ enabled: false, flowKey: '', metadataFields: '', integrationKey: '' });
    await waitFor(() => expect(kaydedildi).toHaveBeenCalledTimes(1));
  });

  it('bayat pencere: dokunulmayan enabled gövdeye girmez, başkasının kararı ezilmez', async () => {
    m.smartAyarKaydet.mockResolvedValue(ayar());
    await ac(ayar({ durum: 'testte_kapali' }, { enabled: false }));
    fireEvent.change(screen.getByLabelText('Metadata Şablonu'), { target: { value: 'A: b' } });
    fireEvent.click(btn('Kaydet'));
    await waitFor(() => expect(m.smartAyarKaydet).toHaveBeenCalledTimes(1));
    expect(m.smartAyarKaydet.mock.calls[0][0]).not.toHaveProperty('enabled');
    cleanup();
    m.smartAyarKaydet.mockClear();
    await ac(ayar({ durum: 'testte_kapali' }, { enabled: false }));
    fireEvent.click(screen.getByLabelText('Smart onayı istensin'));
    fireEvent.click(btn('Kaydet'));
    await waitFor(() => expect(m.smartAyarKaydet).toHaveBeenCalledTimes(1));
    expect(m.smartAyarKaydet.mock.calls[0][0].enabled).toBe(true);
  });

  it('kapatma onayı kayıttan sonra düşer; sonraki kapatma yeniden onay ister', async () => {
    m.smartAyarKaydet.mockResolvedValue(ayar());
    await ac();
    fireEvent.click(screen.getByLabelText('Smart onayı istensin'));
    fireEvent.click(screen.getByLabelText('Test ortamlarında node değişikliklerinin onaysız çalışacağını anlıyorum.'));
    fireEvent.click(btn('Kaydet'));
    await waitFor(() => expect(m.smartAyar).toHaveBeenCalledTimes(2));
    await screen.findByText('Smart onayı istensin');
    await waitFor(() => expect(btn('Kaydet').disabled).toBe(false));
    fireEvent.click(screen.getByLabelText('Smart onayı istensin'));
    expect(btn('Kaydet').disabled).toBe(true);
  });

  it('token: anahtarsız sunucuda kapalı; kayıttan sonra alan temizlenir, yeniden gönderilmez', async () => {
    await ac(ayar({ sifrelemeVar: false }));
    expect((screen.getByLabelText('Entegrasyon Anahtarı (opsiyonel)') as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByText('Değer şifreleme anahtarı tanımlı değil; entegrasyon anahtarı kaydedilemez.')).toBeTruthy();
    cleanup();
    m.smartAyar.mockClear();
    m.smartAyarKaydet.mockResolvedValue(ayar());
    await ac();
    const alan = () => screen.getByLabelText('Entegrasyon Anahtarı (opsiyonel)') as HTMLInputElement;
    expect(alan().disabled).toBe(false);
    fireEvent.change(alan(), { target: { value: 'GIZLI-TOKEN' } });
    fireEvent.click(btn('Kaydet'));
    await waitFor(() => expect(m.smartAyarKaydet).toHaveBeenCalledTimes(1));
    expect(m.smartAyarKaydet.mock.calls[0][0].integrationKey).toBe('GIZLI-TOKEN');
    await waitFor(() => expect(m.smartAyar).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(alan().value).toBe(''));
    fireEvent.click(btn('Kaydet'));
    await waitFor(() => expect(m.smartAyarKaydet).toHaveBeenCalledTimes(2));
    expect(m.smartAyarKaydet.mock.calls[1][0].integrationKey).toBe('');
  });

  it('Flow Key değişince kayıtlı anahtarın silineceği söylenir; yeni anahtar yazılınca uyarı kalkar', async () => {
    await ac(ayar({ kaynak: 'crypto', durum: 'kendi' }, { flowKey: 'F', metadataFields: 'A: b', integrationKeySet: true }));
    expect(screen.queryByText(/Flow Key değişti/)).toBeNull();
    fireEvent.change(screen.getByLabelText('Smart Flow Key'), { target: { value: 'YENI' } });
    expect(screen.getByText(/Flow Key değişti: kayıtlı anahtar bu kayıtla silinir/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Entegrasyon Anahtarı (opsiyonel)'), { target: { value: 'T' } });
    expect(screen.queryByText(/Flow Key değişti/)).toBeNull();
  });

  it('çözülemeyen token durumu açıkça söylenir', async () => {
    await ac(ayar({ kaynak: 'crypto', durum: 'token_cozulemedi' }, { flowKey: 'F', metadataFields: 'A: b', integrationKeySet: true }));
    expect(screen.getByText(/kayıtlı entegrasyon anahtarı çözülemedi — talep açılamaz/)).toBeTruthy();
  });

  it('okunamayan ayar kaydedilemez; sunucu reddi görünür', async () => {
    m.smartAyar.mockResolvedValue({ ok: false, message: 'Crypto Hub Smart ayarı okunamadı, lütfen tekrar deneyin.' });
    render(<CryptoHubSmartModal open onClose={vi.fn()} />);
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(btn('Kaydet').disabled).toBe(true);
    cleanup();
    m.smartAyarKaydet.mockResolvedValue({ ok: false, blocked: 'crypto_smart_yarim', message: 'Flow Key ile metadata şablonu birlikte dolu' });
    await ac();
    fireEvent.change(screen.getByLabelText('Smart Flow Key'), { target: { value: 'F' } });
    fireEvent.click(btn('Kaydet'));
    expect(await screen.findByText('Flow Key ile metadata şablonu birlikte dolu')).toBeTruthy();
  });

  it('Alanları Getir + Otomatik Doldur ortak kodla; Önizle taslağı sunucuya gönderir', async () => {
    m.flowMeta.mockResolvedValue({ ok: true, fields: [{ ElementName: 'KONU', Type: 'text', Label: 'Konu' }] });
    m.smartAyarOnizle.mockResolvedValue({ ok: true, metadata: { KONU: 'metaco_das_test' } });
    await ac();
    expect(btn('Alanları Getir').disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Smart Flow Key'), { target: { value: 'FLOW_CRYPTO' } });
    fireEvent.click(btn('Alanları Getir'));
    await waitFor(() => expect(m.flowMeta).toHaveBeenCalledWith('FLOW_CRYPTO'));
    await waitFor(() => expect(btn('Otomatik Doldur').disabled).toBe(false));
    fireEvent.click(btn('Otomatik Doldur'));
    const s = screen.getByLabelText('Metadata Şablonu') as HTMLTextAreaElement;
    expect(s.value).toContain('KONU');
    fireEvent.click(btn('Önizle'));
    await waitFor(() => expect(m.smartAyarOnizle).toHaveBeenCalledWith(s.value));
    expect(await screen.findByText('metaco_das_test')).toBeTruthy();
  });
});
