// src/components/nginx_console/__tests__/NginxSpaDiscovery.test.tsx
//
// Nginx Hub > "Gerçek SPA Keşfi" — ekranın DAVRANIŞ bekçileri (doğrulama bulguları, 2026-10-01).
//
// NEDEN VAR:
//   1. Sunucu 8 MB önbellek sınırı için yanıt gövdesini KIRPIYOR (varsayılanlar ve boş diziler
//      yazılmıyor). İstemci bunları geri doldurmadan ekran `a.staleClusters.includes` üzerinde
//      çöküyordu (sayfa bomboş) ve `rp` alanı olmayan satır "ölçülemedi" görünecekti
//      (uygulanamaz ≠ ölçülemedi — KESİN KURAL). Gövde burada SUNUCUNUN KENDİ kodundan
//      (spaYanitGovdesi) üretilir: iki taraf ayrışırsa bu test kırmızıya döner.
//   2. "Yenile" sonrası açık ayrıntı paneli yeniden çekilmiyordu; satır yeni, panel eski
//      hesabı gösteriyordu. Panelin hesabı tablodan farklıysa bu da AÇIKÇA yazılmalı.
//   3. Sunucunun yeni kodları (paylasimli, belirsiz, ayrilamaz, rpIstekNeden) ekranda ham kod,
//      "undefined" ya da yanlış yedek etiket ("ölçülemedi") olarak görünüyordu.
//   4. Satıra tıklamak 10 bin satırın hepsini yeniden çiziyordu (tık başına 300-400 ms).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, waitFor, act } from '@testing-library/react';
import { createRequire } from 'node:module';
import NginxSpaDiscovery from '@/components/nginx_console/NginxSpaDiscovery';
import { spaUygulamaDoldur, type NgSpaApp, type NgSpaDiscovery } from '@/api/nginxConsoleApi';
import { downloadCsv } from '@/utils/csv';

// CSV içeriği (K3 süzgeç/CSV tutarlılığı): indirme yerine çağrı argümanları okunur.
vi.mock('@/utils/csv', async (orijinal) => ({
  ...(await orijinal<typeof import('@/utils/csv')>()),
  downloadCsv: vi.fn(),
}));

const requireCjs = createRequire(import.meta.url);
const KOK = '../../../../server';
const { buildSpaDiscovery, spaYanitGovdesi } = requireCjs(`${KOK}/nginx-console/spa-discovery.cjs`);
const { internetRpHosts } = requireCjs(`${KOK}/audit/nginx-hosts.cjs`);
const { rpTanimlari } = requireCjs(`${KOK}/nginx-console/spa-rp.cjs`);
const RP = internetRpHosts() as { byEnv: Record<string, string[]>; all: Set<string> };

const GUN = '2026-10-01';
type Satir = Record<string, unknown>;
const D = (o: Satir): Satir => ({
  cluster: 'gbocptest1',
  namespace: 'kart-test',
  route: 'r',
  host: '',
  termination: 'passthrough',
  workload_kind: 'Deployment',
  workload: 'app',
  is_spa: 1,
  signal: 'image',
  image: '',
  note: '',
  match_by: 'selector',
  scan_date: GUN,
  ...o,
});
const A = (app: string, ns: string, o: Satir = {}) =>
  D({
    route: app,
    workload: app,
    namespace: ns,
    host: `${app}-${ns}.apps-t.fw.garanti.com.tr`,
    ...o,
  });
const LOC = (host: string, ns: string, app: string): Satir => ({
  host,
  vhost: 'KART-TEST',
  service: 'KART',
  env: 'TEST',
  location_path: `/${app}/`,
  application: app,
  namespace: ns,
  status: 'OK',
  kind: 'spa',
  upstream_name: null,
  target_url: null,
  scan_date: GUN,
});
const IZ = (host: string) => ({ ...LOC(host, 'iz-yok-test', 'iz'), vhost: 'IZ-X' });

/** Sunucunun GERÇEK hesabı: SPA / SPA değil / intranet / tanımlı / tanımsız / envanter karışık. */
function sunucuSonucu(hesaplandi: string) {
  const disc = [
    A('kart-ui', 'kart-test'),
    A('bos-ui', 'kart-test'),
    A('api-svc', 'kart-test', { is_spa: 0 }),
    A('intra-ui', 'kart-test', { termination: 'reencrypt' }),
    A('cok-route', 'kart-test'),
    A('cok-route', 'kart-test', {
      route: 'cok-route-int',
      host: 'cok-route-int-kart-test.apps-t.fw.garanti.com.tr',
      cluster: 'gbocptest2',
    }),
    A('esles-yok', 'kart-test', { note: 'servis bulunamadi: x', is_spa: 0, match_by: '' }),
  ];
  const inv = [
    {
      cluster_name: 'gbocptest1',
      namespace_name: 'kart-test',
      route_name: 'cok-route',
      route_address: 'x',
      termination_type: 'passthrough',
    },
  ];
  const use = [
    {
      cluster: 'gbocptest1',
      namespace: 'kart-test',
      app: 'kart-ui',
      scan_date: GUN,
      window_days: 7,
      req_total: 42,
      services_total: 1,
      measured: 1,
    },
  ];
  const cfg = [
    ...RP.byEnv.TEST.map(IZ),
    LOC('GBNGXT33', 'kart-test', 'kart-ui'),
    LOC('GBNGXT34', 'kart-test', 'kart-ui'),
  ];
  const kaynak = {
    prxKolon: 4,
    cfg,
    dir: [],
    ups: [],
    trf: [],
    tablolar: { cfg: 'var', dir: 'var', trf: 'var', ups: 'var' },
  };
  const r = buildSpaDiscovery(disc, inv, use, [], kaynak);
  return { ok: true, tableMissing: false, scanDate: GUN, ...r, hesaplandi };
}

const yanit = (body: unknown) => ({
  ok: true,
  status: 200,
  headers: { get: () => 'application/json' },
  json: async () => JSON.parse(JSON.stringify(body)),
  text: async () => JSON.stringify(body),
});

interface Sahte {
  ana: string[];
  rp: string[];
  /** Ana uç her çağrıda bunu döndürür (çağrı sırası verilir). */
  govde: (n: number) => unknown;
  /** Ayrıntı ucunun `hesaplandi` değeri. */
  rpHesap: () => string;
  /** Ayrıntı ucunun tanım listesi (varsayılan boş). */
  rpTanim?: (u: URL) => unknown[];
}
let sahte: Sahte;
beforeEach(() => {
  sahte = {
    ana: [],
    rp: [],
    govde: () => spaYanitGovdesi(sunucuSonucu('H1')),
    rpHesap: () => 'H1',
  };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes('/spa-discovery/rp')) {
        sahte.rp.push(u);
        return yanit({
          ok: true,
          tanimlar: sahte.rpTanim ? sahte.rpTanim(new URL(u, 'http://x')) : [],
          beklenen: [],
          kapsam: null,
          hesaplandi: sahte.rpHesap(),
        });
      }
      if (u.includes('/spa-discovery')) {
        sahte.ana.push(u);
        return yanit(sahte.govde(sahte.ana.length));
      }
      throw new Error('beklenmeyen istek: ' + u);
    }),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const satirlar = (c: HTMLElement) =>
  [...c.querySelectorAll('tbody tr.cursor-pointer')] as HTMLElement[];
const satirOf = (c: HTMLElement, app: string) => {
  const s = satirlar(c).find((tr) => tr.querySelector('td')?.textContent?.includes(app));
  if (!s) throw new Error('satır yok: ' + app);
  return s;
};
/** Kolon sırası: 0 Uygulama · 6 Reverse proxy · 7 RP isteği. */
const hucre = (tr: HTMLElement, i: number) => tr.querySelectorAll('td')[i] as HTMLElement;

describe('NginxSpaDiscovery — kırpılmış gövde', () => {
  it('sunucunun KIRPILMIŞ gövdesiyle tablo çizilir; varsayılan alanlar istemcide geri doldurulur', async () => {
    const hatalar: string[] = [];
    vi.spyOn(console, 'error').mockImplementation((...x: unknown[]) => {
      hatalar.push(String(x[0]));
    });
    const govde = sahte.govde(1) as { apps: Satir[] };
    // Ön koşul: gövde GERÇEKTEN kırpılmış (aksi halde bu test hiçbir şeyi ölçmez).
    expect(govde.apps.some((a) => !('staleClusters' in a))).toBe(true);
    expect(govde.apps.some((a) => !('rp' in a))).toBe(true);

    const { container } = render(<NginxSpaDiscovery />);
    await waitFor(() => expect(satirlar(container).length).toBe(govde.apps.length));
    expect(hatalar.filter((h) => !h.includes('act('))).toEqual([]);
    // SPA olmayan satırın RP hücresi "uygulanamaz" (—); "ölçülemedi" DEĞİL.
    const api = satirOf(container, 'api-svc');
    expect(hucre(api, 6).textContent).toBe('—');
    expect(hucre(api, 7).textContent).toBe('—');
    // Tanımsız SPA'nın hücresi kendi etiketiyle.
    expect(hucre(satirOf(container, 'bos-ui'), 6).textContent).toBe('tanımsız');
  });

  it('gidiş-dönüş: doldurulan satır sunucunun TAM satırına eşit (ekranın kullandığı her alan)', () => {
    const tam = sunucuSonucu('H1') as unknown as { apps: NgSpaApp[] };
    const govde = spaYanitGovdesi(tam) as { apps: Partial<NgSpaApp>[] };
    expect(govde.apps.length).toBe(tam.apps.length);
    tam.apps.forEach((t, i) => {
      const tamJ = JSON.parse(JSON.stringify(t)) as Record<string, unknown>;
      const dolu = spaUygulamaDoldur(govde.apps[i]) as unknown as Record<string, unknown>;
      // routes: adreste geçen route adı yazılmaz (ekran adres varken route göstermez);
      // invRoutes/routeCount: yalnız envanter 'kismen' iken gelir (ekran yalnız orada okur).
      for (const k of Object.keys(tamJ)) {
        if (k === 'routes') continue;
        if ((k === 'invRoutes' || k === 'routeCount') && tamJ.inventory !== 'kismen') continue;
        expect(dolu[k], `${t.application}.${k}`).toEqual(tamJ[k]);
      }
      const eksik = (t.routes || []).filter((r) => !(dolu.routes as string[]).includes(r));
      for (const r of eksik)
        expect(
          t.hosts.some((h) => h.toLowerCase().includes(r.toLowerCase())),
          `${t.application}: ${r}`,
        ).toBe(true);
    });
  });
});

describe('NginxSpaDiscovery — ayrıntı paneli', () => {
  it('"Yenile" sonrası AÇIK panel yeniden çekilir (satır ile panel aynı hesaptan)', async () => {
    sahte.govde = (n) => spaYanitGovdesi(sunucuSonucu(`H${n}`));
    sahte.rpHesap = () => `H${sahte.ana.length}`;
    const { container, getAllByText } = render(<NginxSpaDiscovery />);
    await waitFor(() => expect(satirlar(container).length).toBeGreaterThan(0));
    fireEvent.click(satirOf(container, 'kart-ui'));
    await waitFor(() => expect(sahte.rp.length).toBe(1));
    fireEvent.click(getAllByText('Yenile')[0]);
    await waitFor(() => expect(sahte.ana.at(-1)).toContain('fresh=1'));
    await waitFor(() => expect(sahte.rp.length).toBe(2));
    expect(container.querySelector('[data-testid="rp-ayrinti-farkli-hesap"]')).toBeNull();
  });

  it('panelin hesabı tablodan FARKLIYSA açık uyarı gösterilir; aynıysa gösterilmez', async () => {
    sahte.rpHesap = () => '2026-10-01T09:00:00.000Z';
    sahte.govde = () => spaYanitGovdesi(sunucuSonucu('2026-10-01T08:00:00.000Z'));
    const r1 = render(<NginxSpaDiscovery />);
    await waitFor(() => expect(satirlar(r1.container).length).toBeGreaterThan(0));
    fireEvent.click(satirOf(r1.container, 'kart-ui'));
    await waitFor(() =>
      expect(r1.container.querySelector('[data-testid="rp-ayrinti-farkli-hesap"]')).not.toBeNull(),
    );
    r1.unmount();

    sahte.rpHesap = () => '2026-10-01T08:00:00.000Z';
    const r2 = render(<NginxSpaDiscovery />);
    await waitFor(() => expect(satirlar(r2.container).length).toBeGreaterThan(0));
    fireEvent.click(satirOf(r2.container, 'kart-ui'));
    await waitFor(() => expect(sahte.rp.length).toBe(2));
    await waitFor(() => expect(r2.container.textContent).toContain('internet RP tanımı yok'));
    expect(r2.container.querySelector('[data-testid="rp-ayrinti-farkli-hesap"]')).toBeNull();
  });
});

/** Elle kurulmuş (kırpılmış) satır: sunucunun yeni kodları. */
const elle = (o: Partial<NgSpaApp>): Partial<NgSpaApp> => ({
  application: 'x',
  namespace: 'odeme-prod',
  env: 'prod',
  spa: 'evet',
  pattern: 'uyuyor',
  istek: 'olcum-yok',
  ag: 'internet',
  agSay: { passthrough: 1 },
  inventory: 'kayitli',
  clusters: ['gbocpprod1'],
  hosts: ['x.apps.fw.garanti.com.tr'],
  ...o,
});
const govdeElle = (apps: Partial<NgSpaApp>[]): NgSpaDiscovery =>
  ({
    ok: true,
    tableMissing: false,
    scanDate: GUN,
    apps,
    hesaplandi: 'H1',
    rpKapsam: {
      configTarih: GUN,
      dizinTarih: GUN,
      trafikTarih: GUN,
      upsTarih: GUN,
      proxyKolonu: true,
      tablolar: { cfg: 'var', dir: 'var', trf: 'var', ups: 'var' },
      hostlar: [],
      taranmayan: { PROD: ['GBRVPAP03', 'GBRVPAP04'] },
      cozulemeyen: {},
      hedefCozulemeyen: { PROD: 1 },
      belirsiz: 0,
      dizinFarkli: false,
      envanterOkunamadi: false,
      dynatraceOkunamadi: false,
    },
  }) as unknown as NgSpaDiscovery;

describe('NginxSpaDiscovery — yeni kodların etiketleri', () => {
  it('paylaşımlı / ayrılamaz / kısmi(host-taranmadi) / hedef-cozulemedi ham kod ya da yanlış yedek etiket göstermez', async () => {
    sahte.govde = () =>
      govdeElle([
        elle({
          application: 'pay-ui',
          rp: 'tanimli',
          rpYol: ['proxy'],
          rpHost: '1/14',
          rpEsles: 'paylasimli',
          rpIstek: 'ayrilamaz',
        }),
        elle({
          application: 'kis-ui',
          rp: 'tanimli',
          rpYol: ['proxy'],
          rpHost: '1/14',
          rpIstek: 'kismi',
          rpIstekNeden: ['host-taranmadi'],
          rpReq7: 0,
          rpReq24: 0,
          rpOlcum: '1/1',
          rpPencereSa: 720,
        }),
        elle({ application: 'hed-ui', rp: 'olculemedi', rpNeden: 'hedef-cozulemedi' }),
        elle({
          application: 'bel-ui',
          namespace: 'a-test',
          env: 'test',
          rp: 'olculemedi',
          rpNeden: 'belirsiz',
        }),
        elle({ application: 'tar-ui', rp: 'olculemedi', rpNeden: 'tarih-farkli:dizin' }),
      ]);
    const { container } = render(<NginxSpaDiscovery />);
    await waitFor(() => expect(satirlar(container).length).toBe(5));
    const pay = satirOf(container, 'pay-ui');
    expect(hucre(pay, 7).textContent).toBe('ayrılamaz');
    expect(hucre(pay, 6).firstElementChild?.getAttribute('title') || '').toContain('ayrılamaz');
    const kis = satirOf(container, 'kis-ui');
    expect(hucre(kis, 7).textContent).toContain('sunucu taranmadı');
    const kisIpucu = hucre(kis, 7).firstElementChild?.getAttribute('title') || '';
    expect(kisIpucu).toContain('taranmayan: GBRVPAP03, GBRVPAP04');
    expect(kisIpucu).not.toContain('pencere 7 günden kısa');
    for (const [app, parca] of [
      ['hed-ui', 'arka ucu bulunamayan'],
      ['bel-ui', 'birden çok namespace'],
      ['tar-ui', 'farklı günden'],
    ] as const) {
      const t = hucre(satirOf(container, app), 6).firstElementChild?.getAttribute('title') || '';
      expect(t, app).toContain(parca);
    }
    // Ayrıntı satırı: eşleşme adı 'undefined' basmaz.
    fireEvent.click(pay);
    await waitFor(() => expect(sahte.rp.length).toBe(1));
    expect(container.textContent).not.toContain('undefined');
    expect(container.textContent).toContain("aynı adresi paylaşan route'lar");
  });
});

describe('NginxSpaDiscovery — satır memo', () => {
  it('satıra tıklamak YALNIZ açılan satırı yeniden çizer (tüm tabloyu değil)', async () => {
    const N = 200;
    sahte.govde = () =>
      govdeElle(
        Array.from({ length: N }, (_, i) =>
          elle({
            application: `app-${i}`,
            istek: 'var',
            reqShown: 1000 + i,
            rp: 'tanimli',
            rpYol: ['proxy'],
            rpIstek: 'var',
            rpReq7: 70 + i,
            rpReq24: 10 + i,
          }),
        ),
      );
    const { container } = render(<NginxSpaDiscovery />);
    await waitFor(() => expect(satirlar(container).length).toBe(N));
    // Sayı biçimleme satır başına en az 4 kez çağrılır (Uygulama isteği, RP isteği hücresi ve
    // ipucu); memo'suz bir tıklama bunu N satırın HEPSİ için yeniden yapar.
    const spy = vi.spyOn(Number.prototype, 'toLocaleString');
    await act(async () => {
      fireEvent.click(satirOf(container, 'app-7'));
    });
    const cagri = spy.mock.calls.length;
    expect(cagri, `tıklamada ${cagri} sayı biçimleme: tüm satırlar yeniden çizildi`).toBeLessThan(
      N,
    );
  });
});

// ── KULLANICI KARARLARI (2026-10-02): ORTAM DIŞI TANIM + YENİ PROD HOST KİPİ ─────────────
// Gövde ve ayrıntı SUNUCUNUN GERÇEK hesabından (buildSpaDiscovery / rpTanimlari) gelir.
const PROD_ALL = RP.byEnv.PROD;
const PA = (app: string) =>
  A(app, 'odeme-prod', {
    cluster: 'gbocpprod1',
    host: `${app}-odeme-prod.apps.fw.garanti.com.tr`,
  });
const DIZIN = (host: string, app: string): Satir => ({
  host,
  namespace: 'odeme-prod',
  application: app,
  hys_deployed: 1,
  app_deployed: 1,
  conf_exists: 1,
  conf_name: `${app}-odeme-prod.conf`,
  scan_date: GUN,
});
const HTRF = (host: string, vhost: string, o: Satir = {}): Satir => ({
  host,
  vhost,
  service: null,
  env: null,
  location: `@${vhost}.irp.garantibbva.com.tr`,
  req_24h: 0,
  req_7d: 0,
  hc_24h: 0,
  sampled: 0,
  last_seen: null,
  error: null,
  first_seen: '20260901000000',
  scan_date: GUN,
  ...o,
});
function kararSonucu() {
  const disc = [
    A('disi-ui', 'kart-test'),
    PA('yp-var'),
    PA('yp-kova'),
    PA('yp-err'),
  ];
  const cfg = [
    ...RP.byEnv.TEST.map(IZ),
    ...PROD_ALL.map(IZ),
    // TEST uygulaması YALNIZ PROD RP'de (proxy_pass test adresine).
    {
      host: 'GBRVPP07',
      vhost: 'GLOMO-PROD',
      service: 'GLOMO',
      env: 'PROD',
      location_path: '/disi/',
      application: 'disi-ui-kart-test',
      namespace: null,
      status: 'NON_PROD_TARGET',
      kind: 'proxy',
      upstream_name: 'disi-ui-kart-test.apps-t.fw.garanti.com.tr',
      target_url: 'disi-ui-kart-test.apps-t.fw.garanti.com.tr',
      scan_date: GUN,
    },
  ];
  const dir = [
    DIZIN('GBNGXP40', 'yp-var'),
    DIZIN('GBNGXP41', 'yp-kova'),
    DIZIN('GBNGXP44', 'yp-err'),
  ];
  const trf = [
    HTRF('GBNGXP40', 'yp-var-odeme-prod', { req_7d: 50, req_24h: 5 }),
    HTRF('GBNGXP41', 'yp-kova-odeme-prod'),
    { ...HTRF('GBNGXP41', '_'), location: '@_', req_7d: 31 },
    {
      ...HTRF('GBNGXP44', 'yp-err-odeme-prod'),
      req_24h: null,
      req_7d: null,
      hc_24h: null,
      first_seen: null,
      error: 'access_log off - vhost loglamiyor',
    },
  ];
  const kaynak = {
    prxKolon: 4,
    cfg,
    dir,
    ups: [],
    trf,
    tablolar: { cfg: 'var', dir: 'var', trf: 'var', ups: 'var' },
  };
  // rpDetay sayılamaz alan: yayma (spread) onu kopyalamaz, ayrıca taşınır.
  const s = buildSpaDiscovery(disc, [], [], [], kaynak);
  return {
    sonuc: { ok: true, tableMissing: false, scanDate: GUN, ...s, hesaplandi: 'H1' },
    detay: s.rpDetay,
  };
}

describe('NginxSpaDiscovery — ortam dışı tanım ve yeni PROD host kipi', () => {
  beforeEach(() => {
    const { sonuc, detay } = kararSonucu();
    sahte.govde = () => spaYanitGovdesi(sonuc);
    sahte.rpTanim = (u) =>
      rpTanimlari(detay, u.searchParams.get('ns'), u.searchParams.get('app'));
  });

  it('yalnız başka ortamın RP\'sinde tanımlı: hücre "tanımsız" + ortam dışı uyarısı, "tanımsız" süzgecinde görünür', async () => {
    const { container } = render(<NginxSpaDiscovery />);
    await waitFor(() => expect(satirlar(container).length).toBe(4));
    const disi = hucre(satirOf(container, 'disi-ui'), 6);
    expect(disi.textContent).toContain('tanımsız');
    expect(disi.textContent).toContain("PROD RP'sinde tanımlı");
    expect(disi.firstElementChild?.getAttribute('title') || '').toContain('TEST için sayılmaz');
    // "tanımsız" süzgeci bu satırı getirir (eskiden 'tanımlı' görünüp süzgeçte çıkmıyordu).
    const rpSec = container.querySelector('select[title="Reverse proxy\'de tanımlı mı"]');
    if (!rpSec) throw new Error('RP süzgeci yok');
    fireEvent.change(rpSec, { target: { value: 'tanimsiz' } });
    await waitFor(() => expect(satirlar(container).length).toBe(1));
    expect(satirlar(container)[0].textContent).toContain('disi-ui');
    // Panel: başka ortamın tanımı listelenir ve kendi ortamına sayılmadığı yazar.
    fireEvent.click(satirOf(container, 'disi-ui'));
    await waitFor(() =>
      expect(container.querySelector('[data-testid="rp-ayrinti-yalniz-disi"]')).not.toBeNull(),
    );
    expect(container.textContent).toContain('ortam dışı');
  });

  it('yeni PROD dizin tanımı: istek sayısı satırda, kova "atanamayan istek", HLOADERR sebebi panelde', async () => {
    const { container } = render(<NginxSpaDiscovery />);
    await waitFor(() => expect(satirlar(container).length).toBe(4));
    expect(hucre(satirOf(container, 'yp-var'), 7).textContent).toContain('50');
    const kova = hucre(satirOf(container, 'yp-kova'), 7);
    expect(kova.textContent).toContain('atanamayan istek');
    expect(kova.firstElementChild?.getAttribute('title') || '').toContain('varsayılan sunucuya');
    const err = hucre(satirOf(container, 'yp-err'), 7);
    expect(err.textContent).toContain('ölçülemedi');
    expect(err.textContent).not.toContain('istek yok');
    fireEvent.click(satirOf(container, 'yp-err'));
    await waitFor(() => expect(container.textContent).toContain('access_log off'));
    expect(container.textContent).toContain('log / betik hatası');
    fireEvent.click(satirOf(container, 'yp-err'));
    fireEvent.click(satirOf(container, 'yp-var'));
    await waitFor(() =>
      expect(container.textContent).toContain('yp-var-odeme-prod.irp.garantibbva.com.tr'),
    );
    expect(container.textContent).not.toContain('undefined');
  });
});

// ── K3 (2026-10-02): KARIŞIK DURUMDA RP İSTEĞİ YALNIZ KENDİ ORTAMININ TANIMLARINDAN ──────
// Eskiden karar iki ortamın TOPLAMIYDI: TEST RP'de ölçülmüş 0 alan TEST uygulaması, PROD RP'nin
// test adresine proxy'sindeki 900 istekle "var 900" görünüyordu (hücre yalnız kaynağını
// yazıyordu). K3: karar ve sayı yalnız kendi ortamının; başka ortamın isteği yalnız bilgi.
// Gövde ve ayrıntı SUNUCUNUN GERÇEK hesabından gelir. Her TEST uygulamasında PROD RP'nin test
// adresine proxy'si 900 istek alıyor:
//   k3-yok  kendi TEST tanımı ölçülmüş gerçek 0        → 'yok', 7g 0
//   k3-var  kendi TEST tanımı 50 istek                  → 'var', 7g 50 (950 DEĞİL)
//   k3-olc  kendi TEST tanımı LOADERR                   → 'olculemedi' (900 kurtarmaz)
//   k3-disi kendi ortamında tanım yok (yalnız PROD RP)  → rp 'tanimsiz', rpIstek 'uygulanamaz'
const K3_UST = (app: string) => `${app}-kart-test.apps-t.fw.garanti.com.tr`;
const K3_TRF = (host: string, vhost: string, location: string, o: Satir = {}): Satir => ({
  host,
  vhost,
  location,
  req_24h: 0,
  req_7d: 0,
  hc_24h: 0,
  sampled: 0,
  last_seen: null,
  error: null,
  first_seen: '20260901000000',
  scan_date: GUN,
  ...o,
});
const K3_PRX = (app: string, loc: string): Satir => ({
  host: 'GBRVPP07',
  vhost: 'GLOMO-PROD',
  service: 'GLOMO',
  env: 'PROD',
  location_path: loc,
  application: `${app}-kart-test`,
  namespace: null,
  status: 'NON_PROD_TARGET',
  kind: 'proxy',
  upstream_name: K3_UST(app),
  target_url: K3_UST(app),
  scan_date: GUN,
});
function k3Sonucu() {
  const apps = ['k3-yok', 'k3-var', 'k3-olc', 'k3-disi'];
  const s = buildSpaDiscovery(
    apps.map((x) => A(x, 'kart-test')),
    [],
    [],
    [],
    {
      prxKolon: 4,
      cfg: [
        ...RP.byEnv.TEST.map(IZ),
        LOC('GBNGXT33', 'kart-test', 'k3-yok'),
        LOC('GBNGXT33', 'kart-test', 'k3-var'),
        { ...LOC('GBNGXT33', 'kart-test', 'k3-olc'), vhost: 'OLC-TEST' },
        ...apps.map((x) => K3_PRX(x, `/${x}-p/`)),
      ],
      dir: [],
      ups: [],
      trf: [
        K3_TRF('GBNGXT33', 'KART-TEST', '/k3-yok/'),
        K3_TRF('GBNGXT33', 'KART-TEST', '/k3-var/', { req_7d: 50, req_24h: 5 }),
        { ...K3_TRF('GBNGXT33', 'OLC-TEST', ''), location: null, error: 'log dosyası yok' },
        ...apps.map((x) => K3_TRF('GBRVPP07', 'GLOMO-PROD', `/${x}-p/`, { req_7d: 900 })),
      ],
      tablolar: { cfg: 'var', dir: 'var', trf: 'var', ups: 'var' },
    },
  );
  return {
    sonuc: { ok: true, tableMissing: false, scanDate: GUN, ...s, hesaplandi: 'H1' },
    detay: s.rpDetay,
  };
}

describe('NginxSpaDiscovery — K3: RP isteği yalnız kendi ortamından, başka ortamın isteği bilgi', () => {
  beforeEach(() => {
    const { sonuc, detay } = k3Sonucu();
    sahte.govde = () => spaYanitGovdesi(sonuc);
    sahte.rpTanim = (u) =>
      rpTanimlari(detay, u.searchParams.get('ns'), u.searchParams.get('app'));
  });
  const ipucuOf = (h: HTMLElement) => h.firstElementChild?.getAttribute('title') || '';

  it('hücre kendi kararını ve sayısını yazar; başka ortamın 900 isteği ayrı "ortam dışı" rozeti ve ipucu bilgisi', async () => {
    const { container } = render(<NginxSpaDiscovery />);
    await waitFor(() => expect(satirlar(container).length).toBe(4));
    // (a) kendi 0 (tam pencere) + PROD RP 900 → "istek yok"; 900 yalnız bilgi.
    const yok = hucre(satirOf(container, 'k3-yok'), 7);
    expect(yok.textContent).toContain('istek yok');
    expect(yok.textContent).toContain('ortam dışı PROD RP: 900');
    expect(ipucuOf(yok)).toContain("son 7 gün (TEST RP'leri): 0");
    expect(ipucuOf(yok)).toContain('PROD RP tanımında son 7 günde 900 istek görüldü');
    expect(ipucuOf(yok)).toContain('TEST RP isteği kararına ve sayısına girmez');
    // Kendi isteği varken sayı YALNIZ kendi (50), toplam (950) DEĞİL.
    const v = hucre(satirOf(container, 'k3-var'), 7);
    expect(v.textContent?.startsWith('50')).toBe(true);
    expect(v.textContent).not.toContain('950');
    expect(v.textContent).toContain('ortam dışı PROD RP: 900');
    expect(ipucuOf(v)).toContain("son 7 gün (TEST RP'leri): 50");
    // (b) kendi tanımı ölçülemedi: 900 kararı kurtarmaz.
    const olc = hucre(satirOf(container, 'k3-olc'), 7);
    expect(olc.textContent).toContain('ölçülemedi (0/1)');
    expect(olc.textContent).not.toContain('istek var');
    expect(olc.textContent).toContain('ortam dışı PROD RP: 900');
    // (c) kendi ortamında tanım yok: RP "tanımsız", RP isteği "—"; gerekçe ve 900 ipucunda.
    const disiSatir = satirOf(container, 'k3-disi');
    expect(hucre(disiSatir, 6).textContent).toContain('tanımsız');
    const disi = hucre(disiSatir, 7);
    expect(disi.textContent).toBe('—');
    expect(ipucuOf(disi)).toContain("Kendi ortamının (TEST) RP'sinde tanım yok — RP isteği sorulmaz");
    expect(ipucuOf(disi)).toContain('PROD RP tanımında son 7 günde 900 istek görüldü');
    expect(container.textContent).not.toContain('undefined');
  });

  it('süzgeçler ve CSV aynı K3 kodlarını taşır; CSV kendi sayısını ve başka ortamın isteğini AYRI kolonda yazar', async () => {
    vi.mocked(downloadCsv).mockClear();
    const { container } = render(<NginxSpaDiscovery />);
    await waitFor(() => expect(satirlar(container).length).toBe(4));
    const sec = container.querySelector('select[title="RP isteği (access log)"]');
    if (!sec) throw new Error('RP isteği süzgeci yok');
    // Seçenek sayıları satır kodlarıyla aynı (eskiden dördü de "var" sayılırdı).
    const secenek = (v: string) =>
      sec.querySelector(`option[value="${v}"]`)?.textContent?.replace(/\s+/g, ' ') || '';
    expect(secenek('var')).toContain('(1)');
    expect(secenek('yok')).toContain('(1)');
    expect(secenek('olculemedi')).toContain('(1)');
    // 'uygulanamaz' süzgecine rp 'ölçülemedi' (tanım BULUNAMADI) ve 'kapsam dışı' satırları da
    // düşer: seçenek nitelemesiz "tanım yok" demez (doğrulama bulgusu, 2026-10-02 — hücre
    // ipucu 'bulunamadı' derken süzgeç 'yok' diyordu).
    const uyg = secenek('uygulanamaz');
    expect(uyg).toContain('kendi ortamında tanım yok, bulunamadı ya da kapsam dışı');
    if (uyg.includes('tanım yok')) expect(uyg).toContain('bulunamadı');
    expect(uyg).not.toMatch(/tanım yok \//);
    expect(uyg).toContain('(1)');
    for (const [deger, app] of [
      ['var', 'k3-var'],
      ['yok', 'k3-yok'],
      ['olculemedi', 'k3-olc'],
      ['uygulanamaz', 'k3-disi'],
    ] as const) {
      fireEvent.change(sec, { target: { value: deger } });
      await waitFor(() => expect(satirlar(container).length).toBe(1));
      expect(satirlar(container)[0].textContent, deger).toContain(app);
    }
    fireEvent.change(sec, { target: { value: 'tumu' } });
    await waitFor(() => expect(satirlar(container).length).toBe(4));
    const csvDugme = [...container.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('CSV'),
    );
    if (!csvDugme) throw new Error('CSV düğmesi yok');
    fireEvent.click(csvDugme);
    expect(vi.mocked(downloadCsv)).toHaveBeenCalledTimes(1);
    const [, baslik, satir] = vi.mocked(downloadCsv).mock.calls[0] as unknown as [
      string,
      string[],
      unknown[][],
    ];
    const i = (k: string) => {
      const n = baslik.indexOf(k);
      expect(n, `CSV kolonu yok: ${k}`).toBeGreaterThanOrEqual(0);
      return n;
    };
    const [iApp, iIstek, i7, iDisi] = [
      i('uygulama'),
      i('rp_istegi'),
      i('rp_istek_7g'),
      i('rp_istek_7g_ortam_disi'),
    ];
    const csvSatir = Object.fromEntries(
      satir.map((r) => [String(r[iApp]), [r[iIstek], r[i7], r[iDisi]]]),
    );
    expect(csvSatir).toEqual({
      'k3-yok': ['yok', 0, 900],
      'k3-var': ['var', 50, 900],
      // Ölçülemeyen / sorulmayan RP isteğine 0 YAZILMAZ (boş hücre).
      'k3-olc': ['olculemedi', '', 900],
      'k3-disi': ['uygulanamaz', '', 900],
    });
  });

  it('ayrıntı paneli: karışık satırda başka ortamın tanımının karara girmediği, yalnız başka ortamdakinde gerekçe yazar', async () => {
    const { container } = render(<NginxSpaDiscovery />);
    await waitFor(() => expect(satirlar(container).length).toBe(4));
    fireEvent.click(satirOf(container, 'k3-yok'));
    await waitFor(() =>
      expect(container.querySelector('[data-testid="rp-ayrinti-karisik"]')).not.toBeNull(),
    );
    expect(container.querySelector('[data-testid="rp-ayrinti-yalniz-disi"]')).toBeNull();
    expect(
      container.querySelector('[data-testid="rp-ayrinti-disi-istek"]')?.textContent || '',
    ).toContain('900 istek');
    fireEvent.click(satirOf(container, 'k3-yok'));
    fireEvent.click(satirOf(container, 'k3-disi'));
    await waitFor(() =>
      expect(container.querySelector('[data-testid="rp-ayrinti-yalniz-disi"]')).not.toBeNull(),
    );
    expect(container.querySelector('[data-testid="rp-ayrinti-karisik"]')).toBeNull();
    expect(container.textContent).toContain("Kendi ortamının (TEST) RP'sinde tanım yok");
  });

  it('rp "ölçülemedi" iken RP isteği "—" ve gerekçe "tanım bulunamadı" (tanım yok DENMEZ)', async () => {
    sahte.govde = () =>
      govdeElle([
        elle({
          application: 'olc-ui',
          namespace: 'kart-test',
          env: 'test',
          rp: 'olculemedi',
          rpNeden: 'host-taranmadi',
          rpSorun: ['ORTAM_DISI'],
          rpOrtamDisi: ['PROD'],
          rpReq7Disi: 900,
        }),
      ]);
    const { container } = render(<NginxSpaDiscovery />);
    await waitFor(() => expect(satirlar(container).length).toBe(1));
    const h = hucre(satirOf(container, 'olc-ui'), 7);
    expect(h.textContent).toBe('—');
    expect(ipucuOf(h)).toContain("Kendi ortamının (TEST) RP'sinde tanım bulunamadı");
    expect(ipucuOf(h)).not.toContain('tanım yok —');
    expect(ipucuOf(h)).toContain('900 istek');
  });
});
