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
//   5. (2026-10-03) Kolon düzeni sıkılaştırıldı (kullanıcı: "kolonlar çok geniş, okumakta
//      zorlanıyorum"): Uygulama+namespace ve SPA+ad kalıbı tek hücre, "Reverse proxy" üst
//      başlığı altında Ağ / Tanım / İstek, Adresler ve Cluster'lar ilk öğe + "+N", yoğunluk ve
//      gizlenebilir kolonlar. Hücreler artık SIRA NUMARASIYLA DEĞİL `data-kolon` ile bulunur;
//      başlık sırası ile her satırın hücre sırasının AYNI olduğu ayrıca ölçülür ("kolon
//      düzeni" testi) — eski sıra-numarası bekçisinin taşıdığı güvence orada.
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
  // Görünüm tercihi (yoğunluk / gizli kolon) localStorage'da: testler birbirine sızmasın.
  localStorage.clear();
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
/** Kolon kimlikleri (başlık ve satır aynı listeden çizilir; sıra "kolon düzeni" testinde). */
type Kolon =
  | 'uygulama'
  | 'spa'
  | 'istek'
  | 'ag'
  | 'rp'
  | 'rpIstek'
  | 'envanter'
  | 'adresler'
  | 'clusterlar';
const hucre = (tr: HTMLElement, kolon: Kolon) => {
  const td = tr.querySelector(`:scope > td[data-kolon="${kolon}"]`);
  if (!td) throw new Error(`hücre yok: ${kolon}`);
  return td as HTMLElement;
};
/** Hücrenin ipucu: td'nin ilk öğesi bütün hücrenin title'ını taşır. */
const ipucu = (td: HTMLElement) => td.firstElementChild?.getAttribute('title') || '';

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
    expect(hucre(api, 'rp').textContent).toBe('—');
    expect(hucre(api, 'rpIstek').textContent).toBe('—');
    // Tanımsız SPA'nın hücresi kendi etiketiyle.
    expect(hucre(satirOf(container, 'bos-ui'), 'rp').textContent).toBe('tanımsız');
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
    expect(hucre(pay, 'rpIstek').textContent).toBe('ayrılamaz');
    expect(hucre(pay, 'rp').firstElementChild?.getAttribute('title') || '').toContain('ayrılamaz');
    const kis = satirOf(container, 'kis-ui');
    expect(hucre(kis, 'rpIstek').textContent).toContain('sunucu taranmadı');
    const kisIpucu = hucre(kis, 'rpIstek').firstElementChild?.getAttribute('title') || '';
    expect(kisIpucu).toContain('taranmayan: GBRVPAP03, GBRVPAP04');
    expect(kisIpucu).not.toContain('pencere 7 günden kısa');
    for (const [app, parca] of [
      ['hed-ui', 'arka ucu bulunamayan'],
      ['bel-ui', 'birden çok namespace'],
      ['tar-ui', 'farklı günden'],
    ] as const) {
      const t = hucre(satirOf(container, app), 'rp').firstElementChild?.getAttribute('title') || '';
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
    // YOĞUNLUK tablo özniteliğinde (CSS): Sıkı/Rahat geçişi satırları yeniden ÇİZMEZ.
    spy.mockClear();
    const rahat = [...container.querySelectorAll('button')].find((b) => b.textContent === 'Rahat');
    if (!rahat) throw new Error('Rahat düğmesi yok');
    await act(async () => {
      fireEvent.click(rahat);
    });
    expect(container.querySelector('table.ng-spa-tablo')?.getAttribute('data-yogunluk')).toBe(
      'rahat',
    );
    const yog = spy.mock.calls.length;
    expect(yog, `yoğunlukta ${yog} sayı biçimleme: tüm satırlar yeniden çizildi`).toBeLessThan(N);
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
    const disi = hucre(satirOf(container, 'disi-ui'), 'rp');
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
    expect(hucre(satirOf(container, 'yp-var'), 'rpIstek').textContent).toContain('50');
    const kova = hucre(satirOf(container, 'yp-kova'), 'rpIstek');
    expect(kova.textContent).toContain('atanamayan istek');
    expect(kova.firstElementChild?.getAttribute('title') || '').toContain('varsayılan sunucuya');
    const err = hucre(satirOf(container, 'yp-err'), 'rpIstek');
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
    const yok = hucre(satirOf(container, 'k3-yok'), 'rpIstek');
    expect(yok.textContent).toContain('istek yok');
    // Başka ortamın sayısı KENDİ rozetinde (2026-10-03: kolon "Reverse proxy › İstek" altında
    // olduğu için rozetteki "RP" sözcüğü düştü; eskiden "(ortam dışı PROD RP: 900)").
    expect(yok.querySelector('[data-testid="rp-istek-disi"]')?.textContent).toBe(
      'ortam dışı PROD: 900',
    );
    expect(ipucuOf(yok)).toContain("son 7 gün (TEST RP'leri): 0");
    expect(ipucuOf(yok)).toContain('PROD RP tanımında son 7 günde 900 istek görüldü');
    expect(ipucuOf(yok)).toContain('TEST RP isteği kararına ve sayısına girmez');
    // Kendi isteği varken sayı YALNIZ kendi (50), toplam (950) DEĞİL.
    const v = hucre(satirOf(container, 'k3-var'), 'rpIstek');
    expect(v.textContent?.startsWith('50')).toBe(true);
    expect(v.textContent).not.toContain('950');
    expect(v.textContent).toContain('ortam dışı PROD: 900');
    expect(ipucuOf(v)).toContain("son 7 gün (TEST RP'leri): 50");
    // (b) kendi tanımı ölçülemedi: 900 kararı kurtarmaz.
    const olc = hucre(satirOf(container, 'k3-olc'), 'rpIstek');
    expect(olc.textContent).toContain('ölçülemedi (0/1)');
    expect(olc.textContent).not.toContain('istek var');
    expect(olc.textContent).toContain('ortam dışı PROD: 900');
    // (c) kendi ortamında tanım yok: RP "tanımsız", RP isteği "—"; gerekçe ve 900 ipucunda.
    const disiSatir = satirOf(container, 'k3-disi');
    expect(hucre(disiSatir, 'rp').textContent).toContain('tanımsız');
    const disi = hucre(disiSatir, 'rpIstek');
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
    const h = hucre(satirOf(container, 'olc-ui'), 'rpIstek');
    expect(h.textContent).toBe('—');
    expect(ipucuOf(h)).toContain("Kendi ortamının (TEST) RP'sinde tanım bulunamadı");
    expect(ipucuOf(h)).not.toContain('tanım yok —');
    expect(ipucuOf(h)).toContain('900 istek');
  });
});

// ── KOLON DÜZENİ VE GÖRÜNÜM (2026-10-03) ─────────────────────────────────────────────────
// Kullanıcı: "kolonlar çok geniş görünüyor, okumakta çok zorlanıyorum". Tarayıcıda ölçüldü:
// tablo 1679 px (alan 1540), ortalama satır 204 px; Adresler 71 px'e sıkışıp adresi harf harf
// kırıyordu. Yeni düzenin DAVRANIŞ güvenceleri (görsel ölçüler jsdom'da yok; önizleme
// düzeneğinde ölçülür).
const DUZEN: [Kolon, string][] = [
  ['uygulama', 'Uygulama'],
  ['spa', 'SPA'],
  ['istek', 'Uygulama isteği'],
  ['ag', 'Ağ'],
  ['rp', 'Tanım'],
  ['rpIstek', 'İstek'],
  ['envanter', 'Route envanteri'],
  ['adresler', 'Adresler'],
  ['clusterlar', "Cluster'lar"],
];
const GORUNUM_ANAHTARI = 'nginx-hub:spa-kesfi:gorunum';
const tablo = (c: HTMLElement) => {
  const t = c.querySelector('table.ng-spa-tablo');
  if (!t) throw new Error('tablo yok');
  return t as HTMLTableElement;
};
/** Başlığın YAPRAK kolonları soldan sağa: üst satırdaki grup başlığı yerine alt satırdakiler. */
function yaprakBasliklar(c: HTMLElement) {
  const [ust, alt] = [...tablo(c).querySelectorAll(':scope > thead > tr')] as HTMLElement[];
  const altlar = [...alt.children] as HTMLTableCellElement[];
  const sonuc: HTMLTableCellElement[] = [];
  for (const th of [...ust.children] as HTMLTableCellElement[]) {
    if (th.getAttribute('scope') === 'colgroup') sonuc.push(...altlar.splice(0, th.colSpan));
    else sonuc.push(th);
  }
  expect(altlar, 'alt başlık satırında gruba ait olmayan başlık kaldı').toEqual([]);
  return sonuc;
}
const basligi = (th: HTMLElement) => th.firstChild?.textContent || '';
/**
 * thead'in GERÇEK YERLEŞİMİ (HTML tablo modeli): rowSpan/colSpan ızgarası; her th → x/y/w/h.
 * NEDEN (doğrulama bulgusu, 2026-10-03): yaprakBasliklar() DOM SIRASINI okur, tarayıcının
 * yerleşimini değil. Üst satırdaki rowSpan={2} düşünce (K13) Ağ başlığı Uygulama'nın, Tanım
 * SPA'nın, İstek Uygulama isteği'nin üstüne kayıyordu ve bütün testler yeşil kalıyordu.
 */
function baslikIzgarasi(c: HTMLElement) {
  const trler = [...tablo(c).querySelectorAll(':scope > thead > tr')] as HTMLTableRowElement[];
  const dolu: boolean[][] = trler.map(() => []);
  const yer = new Map<HTMLTableCellElement, { x: number; y: number; w: number; h: number }>();
  trler.forEach((tr, y) => {
    let x = 0;
    for (const th of [...tr.cells]) {
      while (dolu[y][x]) x++;
      const w = Math.max(1, th.colSpan);
      const h = Math.min(Math.max(1, th.rowSpan), trler.length - y);
      for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) dolu[y + dy][x + dx] = true;
      yer.set(th, { x, y, w, h });
      x += w;
    }
  });
  return { yer, satirSayisi: trler.length };
}
/** <colgroup> aralıkları [ilk sütun, son sütun + 1) — scope="colgroup" başlığının kapsamı. */
function sutunGruplari(c: HTMLElement) {
  let x = 0;
  return ([...tablo(c).querySelectorAll(':scope > colgroup')] as HTMLElement[]).map((cg) => {
    const n = cg.querySelectorAll(':scope > col').length;
    const r = [x, x + n] as const;
    x += n;
    return r;
  });
}
/**
 * Başlık yerleşimi = satır yerleşimi: her satırdaki i. hücrenin (data-kolon=k) başlığı ızgarada
 * TAM i. sütunda, tek sütun genişliğinde ve başlığın SON satırına değiyor (yaprak); "Reverse
 * proxy" grubu yalnız kendi kolonlarının üstünde ve KENDİ <colgroup>'unu kapsıyor.
 */
function basligiYerlesimleDogrula(c: HTMLElement) {
  const { yer, satirSayisi } = baslikIzgarasi(c);
  const thOf = (k: string) =>
    tablo(c).querySelector(`:scope > thead th[data-kolon="${k}"]`) as HTMLTableCellElement;
  const ornek = satirlar(c)[0];
  const kolonlar = [...ornek.children].map((td) => (td as HTMLElement).dataset.kolon || '');
  kolonlar.forEach((k, i) => {
    const p = yer.get(thOf(k));
    expect(p, `başlık yok: ${k}`).toBeDefined();
    expect([p?.x, p?.w, (p?.y ?? 0) + (p?.h ?? 0)], `${k} başlığı ${i}. sütunda değil`).toEqual([
      i,
      1,
      satirSayisi,
    ]);
  });
  const grup = tablo(c).querySelector(':scope > thead th[scope="colgroup"]') as HTMLTableCellElement;
  const g = yer.get(grup);
  const rpSutun = kolonlar.flatMap((k, i) => (['ag', 'rp', 'rpIstek'].includes(k) ? [i] : []));
  expect([g?.x, g?.w, g?.y], 'Reverse proxy grubu kendi kolonlarının üstünde değil').toEqual([
    rpSutun[0],
    rpSutun.length,
    0,
  ]);
  // scope="colgroup" başlığı AYNI sütun grubundaki hücrelere bağlanır: o grup tam RP kolonları.
  const cg = sutunGruplari(c).find(([a, b]) => a <= (g?.x ?? -1) && (g?.x ?? -1) < b);
  expect(cg, 'Reverse proxy kendi <colgroup>unda değil').toEqual([
    rpSutun[0],
    rpSutun[0] + rpSutun.length,
  ]);
}

describe('NginxSpaDiscovery — kolon düzeni ve görünüm (2026-10-03)', () => {
  it('iki satırlı başlık: "Reverse proxy" altında Ağ / Tanım / İstek; başlık sırası = her satırın hücre sırası', async () => {
    const { container } = render(<NginxSpaDiscovery />);
    await waitFor(() => expect(satirlar(container).length).toBeGreaterThan(0));
    const grup = tablo(container).querySelector('thead th[scope="colgroup"]') as HTMLTableCellElement;
    expect(grup.textContent).toBe('Reverse proxy');
    expect(grup.colSpan).toBe(3);
    const yap = yaprakBasliklar(container);
    expect(yap.map((th) => [th.dataset.kolon, basligi(th)])).toEqual(DUZEN);
    // Erişilebilirlik: her yaprak başlık scope="col"; "Uygulama isteği" Dynatrace olduğunu söyler.
    for (const th of yap) expect(th.getAttribute('scope'), th.dataset.kolon).toBe('col');
    expect(yap[2].getAttribute('title')).toContain('Dynatrace');
    // data-kolon ile aranan hücre YANLIŞ kolonda durmuyor: her satır başlıkla aynı sırada ve
    // aynı sayıda hücre taşır; <col> sayısı da aynı.
    for (const tr of satirlar(container))
      expect([...tr.children].map((td) => (td as HTMLElement).dataset.kolon)).toEqual(
        DUZEN.map(([k]) => k),
      );
    expect(tablo(container).querySelectorAll(':scope > colgroup > col').length).toBe(DUZEN.length);
    // DOM sırası yetmez: tarayıcının rowSpan/colSpan yerleşiminde de başlık doğru kolonda.
    basligiYerlesimleDogrula(container);
    // YAPIŞKAN ilk kolon ve başlık bağlantısı (görsel ölçü jsdom'da yok; bağlantı burada, CSS
    // kuralları ve kabın yükseklik sınırı nginx-console.test.cjs GS28'de).
    const kap = tablo(container).parentElement as HTMLElement;
    expect(kap.classList.contains('ng-spa-kap'), 'kaydırma kabı .ng-spa-kap değil').toBe(true);
    expect(kap.classList.contains('overflow-auto')).toBe(true);
    const ilkler = [
      tablo(container).querySelector(':scope > thead th[data-kolon="uygulama"]'),
      ...satirlar(container).map((tr) => hucre(tr, 'uygulama')),
    ];
    for (const el of ilkler) expect(el?.classList.contains('ng-yapiskan')).toBe(true);
    expect(tablo(container).querySelectorAll('.ng-yapiskan').length).toBe(ilkler.length);
    // ESNEYEN KOLON: artan genişliği YALNIZ Adresler alır (öteki <col>'lar 1px = içerik kadar).
    const genislik = [...tablo(container).querySelectorAll(':scope > colgroup > col')].map(
      (col) => (col as HTMLElement).style.width,
    );
    expect(genislik).toEqual(DUZEN.map(([k]) => (k === 'adresler' ? '' : '1px')));
  });

  it('birleşik hücreler: uygulama + namespace/ortam, SPA + ad kalıbı; ad düğmesi satırı klavyeyle açar', async () => {
    const UZUN = 'kurumsal-nakit-yonetimi-raporlama-paneli';
    sahte.govde = () =>
      govdeElle([
        // namespace ortamı İÇERMEZ: ortam etiketi ancak kendi öğesinden gelebilir (eski
        // `toContain('prod')` kontrolü 'odeme-prod' namespace'iyle zaten sağlanıyordu, K1).
        elle({
          application: 'miss-ui',
          namespace: 'odeme-merkez',
          pattern: 'uymuyor',
          patternMiss: true,
        }),
        elle({ application: 'yalanci-app-v', spa: 'hayir', patternFalse: true }),
        elle({ application: `${UZUN}-app-v`, namespace: 'odeme-merkez' }),
        elle({ application: `${UZUN}-app-emb-v`, namespace: 'odeme-merkez' }),
      ]);
    const { container } = render(<NginxSpaDiscovery />);
    await waitFor(() => expect(satirlar(container).length).toBe(4));
    const u = hucre(satirOf(container, 'miss-ui'), 'uygulama');
    const dugme = u.querySelector('button');
    if (!dugme) throw new Error('ad düğmesi yok');
    // Kısaltılan (truncate) her metin ipucunda TAM okunur.
    expect(dugme.textContent).toBe('miss-ui');
    expect(dugme.getAttribute('title')).toBe('miss-ui');
    const ns = u.querySelector('[title="odeme-merkez"]') as HTMLElement | null;
    expect(ns?.textContent).toBe('odeme-merkez');
    expect(u.querySelector('[data-testid="ortam"]')?.textContent).toBe('prod');
    // KONTRAST: namespace satırı --text-secondary (MUTED küçük metinde AA altında kalıyordu).
    expect(ns?.parentElement?.getAttribute('style') || '').toContain('var(--text-secondary)');
    // ORTADAN KISALTMA: ayırt eden "-app-v" / "-app-emb-v" eki KISALMAYAN ayrı öğede; baş
    // kısım kısalır. Sondan kesmek iki kardeşi aynı gösteriyordu.
    for (const ek of ['-app-v', '-app-emb-v']) {
      const d = hucre(satirOf(container, `${UZUN}${ek}`), 'uygulama').querySelector('button');
      const [bas, son] = [...(d?.children || [])] as HTMLElement[];
      expect(d?.textContent, ek).toBe(`${UZUN}${ek}`);
      expect(d?.getAttribute('title'), ek).toBe(`${UZUN}${ek}`);
      expect(bas?.textContent, ek).toBe(UZUN);
      expect(bas?.classList.contains('truncate'), ek).toBe(true);
      expect(son?.textContent, ek).toBe(ek);
      expect(son?.classList.contains('truncate'), ek).toBe(false);
      expect(son?.classList.contains('shrink-0'), ek).toBe(true);
    }
    // Kalıp dışı adda son "-parça" ayrılır.
    expect(dugme.children[1]?.textContent).toBe('-ui');
    const spa = hucre(satirOf(container, 'miss-ui'), 'spa');
    expect(spa.textContent).toContain('Evet');
    expect(spa.textContent).toContain('kalıba uymuyor');
    const yal = hucre(satirOf(container, 'yalanci-app-v'), 'spa');
    expect(yal.textContent).toContain('Hayır');
    expect(yal.textContent).toContain('kalıba uyuyor');
    expect(yal.querySelector('[title*="nginx bulunamadı"]')).not.toBeNull();
    // Düğmenin kendi işleyicisi yok: tıklama satıra kabarır, satır BİR kez açılır.
    expect(dugme.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(dugme);
    await waitFor(() => expect(dugme.getAttribute('aria-expanded')).toBe('true'));
    expect(container.querySelectorAll('tr.ng-ayrinti').length).toBe(1);
    // patternMiss: kırmızı "kalıba uymuyor" ROZETİ ve açıklayan ipucu (eski K7: dal ölse de son
    // dal aynı metni düz yazıyordu, test yeşil kalıyordu).
    const miss = spa.querySelector('.ng-ikinci .pf-label');
    expect(miss?.textContent).toBe('kalıba uymuyor');
    expect(miss?.classList.contains('pf-label--red')).toBe(true);
    expect(miss?.getAttribute('title')).toContain('kuralına uymuyor');
  });

  it('Adresler ve Cluster\'lar: ilk öğe + "+N" çipi; TAMAMI ipucunda ve ayrıntı panelinde; eski cluster işaretli', async () => {
    const hosts = [
      'cok-ui-odeme-prod.apps.fw.garanti.com.tr',
      'a2.apps.fw.garanti.com.tr',
      'a3.garantibbva.com.tr',
    ];
    const clusters = ['gbocpprod1', 'gbocpprod2', 'gbocpankprod1'];
    sahte.govde = () =>
      govdeElle([
        elle({ application: 'cok-ui', hosts, clusters, staleClusters: ['gbocpprod2'] }),
        elle({ application: 'tek-ui', hosts: ['tekui.garantibbva.com.tr'] }),
        elle({ application: 'adressiz-ui', hosts: [], routes: ['adressiz-route'] }),
      ]);
    const { container } = render(<NginxSpaDiscovery />);
    await waitFor(() => expect(satirlar(container).length).toBe(3));
    const s = satirOf(container, 'cok-ui');
    const adr = hucre(s, 'adresler');
    expect(adr.textContent).toBe('cok-ui-odeme-prod.apps.fw.garanti.com.tr+2');
    // ADRES İKİ PARÇA (doğrulama bulgusu, 2026-10-03): varsayılan route adresinde
    // "<uygulama>-<namespace>" öneki (1. kolonun tekrarı) ayrı ve kısalabilir öğede; ayırt eden
    // alan adı soneki AYRI öğede (index.css: flex-shrink 0, GS28). Eskiden adres sondan
    // kesiliyor, görünen kısım yalnız tekrar eden önek oluyordu.
    expect(adr.querySelector('.ng-adres-on')?.textContent).toBe('cok-ui-odeme-prod');
    expect(adr.querySelector('.ng-adres-son')?.textContent).toBe('.apps.fw.garanti.com.tr');
    // Kurumsal adreste baş kısım anlamlı: bölünmez.
    const tek = hucre(satirOf(container, 'tek-ui'), 'adresler');
    expect(tek.querySelector('.ng-adres-son')).toBeNull();
    expect(tek.querySelector('.ng-adres-tek')?.textContent).toBe('tekui.garantibbva.com.tr');
    const adrIpucu = adr.firstElementChild?.getAttribute('title') || '';
    for (const h of hosts) expect(adrIpucu).toContain(h);
    const cl = hucre(s, 'clusterlar');
    expect(cl.textContent).toContain('gbocpprod1+2');
    expect(cl.textContent).not.toContain('gbocpankprod1');
    expect(cl.textContent).toContain('1/3 önceki koşudan');
    const clIpucu = cl.firstElementChild?.getAttribute('title') || '';
    expect(clIpucu).toContain('gbocpprod2 · önceki koşudan');
    expect(clIpucu).toContain('gbocpankprod1');
    expect(clIpucu).not.toContain('gbocpprod1 · önceki');
    // Tek öğede çip yok; adres yoksa route adı (eski davranış).
    expect(hucre(satirOf(container, 'tek-ui'), 'adresler').querySelector('.ng-cip')).toBeNull();
    expect(hucre(satirOf(container, 'adressiz-ui'), 'adresler').textContent).toBe('adressiz-route');
    // Ayrıntı paneli: hepsi listelenir, eski cluster işaretli.
    fireEvent.click(s);
    await waitFor(() =>
      expect(container.querySelector('[data-testid="ayrinti-uygulama"]')).not.toBeNull(),
    );
    const ayr = container.querySelector('[data-testid="ayrinti-uygulama"]')?.textContent || '';
    for (const x of [...hosts, ...clusters]) expect(ayr).toContain(x);
    expect(ayr).toContain('gbocpprod2 önceki koşudan');
  });

  // TABLO GÜDÜMLÜ (doğrulama bulgusu, 2026-10-03): eski test yalnız istek / rp / envanter
  // kolonlarının 'olculemedi' satırına bakıyordu; RP isteği (ölçülemedi / kaynak yok kesik,
  // istek yok düz — K3'ün en kritik yeri), Ağ "bilinmiyor", SPA "Bilinmiyor" ve "ölçüm yok"
  // yer bazında hiç sınanmıyordu (K2..K6 mutantları yaşıyordu). Her (kolon, durum) çifti için
  // rozet METNİ ve kesik çerçevenin (ng-olcum) OLUP OLMADIĞI.
  const KESIK: [string, Kolon, Partial<NgSpaApp>, string, boolean][] = [
    ['i-olcumyok', 'istek', { istek: 'olcum-yok' }, 'ölçüm yok', true],
    ['i-olculemedi', 'istek', { istek: 'olculemedi' }, 'ölçülemedi', true],
    ['i-yok', 'istek', { istek: 'yok', reqShown: 0 }, 'istek yok', false],
    ['i-servisyok', 'istek', { istek: 'servis-yok' }, 'servis yok', false],
    ['ag-bilinmiyor', 'ag', { ag: 'bilinmiyor', agSay: { bos: 1 } }, 'bilinmiyor', true],
    ['ag-karisik', 'ag', { ag: 'karisik' }, 'karışık', false],
    ['spa-bilinmiyor', 'spa', { spa: 'bilinmiyor', notes: ['x'] }, 'Bilinmiyor', true],
    ['spa-evet', 'spa', { spa: 'evet' }, 'Evet', false],
    ['rp-olculemedi', 'rp', { rp: 'olculemedi', rpNeden: 'host-taranmadi' }, 'ölçülemedi', true],
    ['rp-tanimsiz', 'rp', { rp: 'tanimsiz' }, 'tanımsız', false],
    [
      'rpi-olculemedi',
      'rpIstek',
      { rp: 'tanimli', rpIstek: 'olculemedi', rpOlcum: '0/1' },
      'ölçülemedi (0/1)',
      true,
    ],
    ['rpi-kaynakyok', 'rpIstek', { rp: 'tanimli', rpIstek: 'kaynak-yok' }, 'ölçüm kaynağı yok', true],
    ['rpi-yok', 'rpIstek', { rp: 'tanimli', rpIstek: 'yok', rpReq7: 0 }, 'istek yok', false],
    ['rpi-ayrilamaz', 'rpIstek', { rp: 'tanimli', rpIstek: 'ayrilamaz' }, 'ayrılamaz', false],
    ['env-olculemedi', 'envanter', { inventory: 'olculemedi' }, 'ölçülemedi', true],
    ['env-degil', 'envanter', { inventory: 'kayitli-degil' }, 'kayıtlı değil', false],
  ];

  it('"ölçülemedi" türü rozet "yok"tan renk DIŞINDA da ayrılır (kesik çerçeve) — her kolonda, her durumda', async () => {
    sahte.govde = () => govdeElle(KESIK.map(([app, , o]) => elle({ application: app, ...o })));
    const { container } = render(<NginxSpaDiscovery />);
    await waitFor(() => expect(satirlar(container).length).toBe(KESIK.length));
    for (const [app, kolon, , metin, kesik] of KESIK) {
      // Kararın rozeti hücrenin 1. satırında (2. satırdaki ikincil rozetler ayrı).
      const r = hucre(satirOf(container, app), kolon).querySelector(
        ':scope > span > span:first-child .pf-label',
      );
      expect(r?.textContent, `${app}/${kolon}`).toBe(metin);
      expect(r?.classList.contains('ng-olcum'), `${app}/${kolon} kesik çerçeve`).toBe(kesik);
    }
  });

  it('ölçülemedi nedeni ikinci satırda kısa adla; tam metin ipucunda', async () => {
    sahte.govde = () =>
      govdeElle([
        elle({ application: 'olc-ui', rp: 'olculemedi', rpNeden: 'host-taranmadi' }),
        elle({ application: 'yok-ui', istek: 'yok', reqShown: 0, rp: 'tanimsiz' }),
      ]);
    const { container } = render(<NginxSpaDiscovery />);
    await waitFor(() => expect(satirlar(container).length).toBe(2));
    const olc = satirOf(container, 'olc-ui');
    const yok = satirOf(container, 'yok-ui');
    expect(hucre(yok, 'istek').textContent).toBe('istek yok');
    expect(hucre(yok, 'rp').textContent).toBe('tanımsız');
    expect(hucre(olc, 'rp').textContent).toBe('ölçülemedi sunucu taranmadı');
    expect(ipucu(hucre(olc, 'rp'))).toContain('son taramada yok');
  });

  it('yoğunluk ve gizli kolonlar tarayıcıda hatırlanır; yeniden açılışta aynı görünüm', async () => {
    sahte.govde = () => govdeElle([elle({ application: 'a-ui' })]);
    const r1 = render(<NginxSpaDiscovery />);
    await waitFor(() => expect(satirlar(r1.container).length).toBe(1));
    expect(tablo(r1.container).dataset.yogunluk).toBe('siki');
    const rahat = r1.getByRole('button', { name: 'Rahat' });
    expect(rahat.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(rahat);
    expect(tablo(r1.container).dataset.yogunluk).toBe('rahat');
    expect(rahat.getAttribute('aria-pressed')).toBe('true');
    // YALNIZ yoğunluk değişikliği de HEMEN yazılır (doğrulama bulgusu: kolon gizleme yazımı
    // `{...gorunum}` ile 'rahat'ı da taşıdığından, Rahat tıklamasındaki eksik yazım görünmüyordu;
    // K14). Kolon menüsüne dokunmadan kayıt okunur.
    expect(JSON.parse(localStorage.getItem(GORUNUM_ANAHTARI) || 'null')).toEqual({
      yogunluk: 'rahat',
      gizli: [],
    });
    fireEvent.click(r1.getByRole('button', { name: /^Kolonlar/ }));
    fireEvent.click(r1.getByRole('checkbox', { name: 'Adresler' }));
    expect(r1.container.querySelector('[data-kolon="adresler"]')).toBeNull();
    expect(JSON.parse(localStorage.getItem(GORUNUM_ANAHTARI) || 'null')).toEqual({
      yogunluk: 'rahat',
      gizli: ['adresler'],
    });
    r1.unmount();
    const r2 = render(<NginxSpaDiscovery />);
    await waitFor(() => expect(satirlar(r2.container).length).toBe(1));
    expect(tablo(r2.container).dataset.yogunluk).toBe('rahat');
    expect(r2.container.querySelector('[data-kolon="adresler"]')).toBeNull();
    expect(r2.container.querySelector('td[data-kolon="clusterlar"]')).not.toBeNull();
    expect(r2.getByRole('button', { name: /^Kolonlar/ }).textContent).toContain('1 gizli');
    // Adresler gizliyken artan genişliği SON kolon alır; ötekiler içerik kadar.
    const g = [...tablo(r2.container).querySelectorAll(':scope > colgroup > col')].map(
      (col) => (col as HTMLElement).style.width,
    );
    expect(g.at(-1)).toBe('');
    expect(g.slice(0, -1).every((w) => w === '1px')).toBe(true);
    basligiYerlesimleDogrula(r2.container);
  });

  it('tercih okunamazsa (bozuk kayıt, zorunlu kolonu gizleyen kayıt, erişim hatası) varsayılan görünüm; yazılamazsa ekran çökmez', async () => {
    sahte.govde = () => govdeElle([elle({ application: 'a-ui' })]);
    const kurulumlar: [string, () => void][] = [
      ['bozuk JSON', () => localStorage.setItem(GORUNUM_ANAHTARI, '{bozuk')],
      [
        'zorunlu kolon',
        () =>
          localStorage.setItem(
            GORUNUM_ANAHTARI,
            JSON.stringify({ yogunluk: 'dev', gizli: ['rp', 'uygulama', 'olmayan'] }),
          ),
      ],
      [
        'erişim hatası',
        () =>
          vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
            throw new Error('SecurityError');
          }),
      ],
    ];
    for (const [ad, kur] of kurulumlar) {
      localStorage.clear();
      kur();
      const r = render(<NginxSpaDiscovery />);
      await waitFor(() => expect(satirlar(r.container).length, ad).toBe(1));
      expect(tablo(r.container).dataset.yogunluk, ad).toBe('siki');
      expect(yaprakBasliklar(r.container).length, ad).toBe(DUZEN.length);
      r.unmount();
      vi.restoreAllMocks();
    }
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    const r = render(<NginxSpaDiscovery />);
    await waitFor(() => expect(satirlar(r.container).length).toBe(1));
    fireEvent.click(r.getByRole('button', { name: 'Rahat' }));
    expect(tablo(r.container).dataset.yogunluk).toBe('rahat');
  });

  it('gizli kolonla ayrıntı satırı ve boş sonuç satırı colSpan = görünür kolon sayısı = satırdaki hücre sayısı', async () => {
    localStorage.setItem(
      GORUNUM_ANAHTARI,
      JSON.stringify({ yogunluk: 'siki', gizli: ['envanter', 'clusterlar'] }),
    );
    sahte.govde = () => govdeElle([elle({ application: 'a-ui' }), elle({ application: 'b-ui' })]);
    const { container } = render(<NginxSpaDiscovery />);
    await waitFor(() => expect(satirlar(container).length).toBe(2));
    const n = yaprakBasliklar(container).length;
    expect(n).toBe(DUZEN.length - 2);
    for (const tr of satirlar(container)) expect(tr.children.length).toBe(n);
    expect(tablo(container).querySelectorAll(':scope > colgroup > col').length).toBe(n);
    fireEvent.click(satirOf(container, 'a-ui'));
    const ayr = container.querySelector('tr.ng-ayrinti > td') as HTMLTableCellElement | null;
    expect(ayr?.colSpan).toBe(n);
    const ara = container.querySelector('input[placeholder="uygulama, namespace ya da adres"]');
    if (!ara) throw new Error('arama kutusu yok');
    fireEvent.change(ara, { target: { value: 'hicbiri-yok' } });
    await waitFor(() => expect(container.querySelector('[data-testid="bos-sonuc"]')).not.toBeNull());
    const bos = container.querySelector('[data-testid="bos-sonuc"]') as HTMLTableCellElement;
    expect(bos.colSpan).toBe(n);
    expect(bos.textContent).toContain('Bu süzgeçlerle uygulama yok; toplam 2 uygulama var.');
  });

  it('"Kolonlar" menüsü klavyeyle: aria-expanded, yalnız gizlenebilir üç kolon, Esc kapatır ve odak düğmeye döner; dışarı tık kapatır', async () => {
    sahte.govde = () => govdeElle([elle({ application: 'a-ui' })]);
    const { container, getByRole } = render(<NginxSpaDiscovery />);
    await waitFor(() => expect(satirlar(container).length).toBe(1));
    const dugme = getByRole('button', { name: /^Kolonlar/ });
    expect(dugme.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(dugme);
    expect(dugme.getAttribute('aria-expanded')).toBe('true');
    const panel = document.getElementById(dugme.getAttribute('aria-controls') || '-');
    if (!panel) throw new Error('aria-controls paneli göstermiyor');
    expect(
      [...panel.querySelectorAll('label')].map((l) => l.textContent?.trim()),
    ).toEqual(['Route envanteri', 'Adresler', "Cluster'lar"]);
    const kutu = getByRole('checkbox', { name: 'Route envanteri' }) as HTMLInputElement;
    expect(kutu.checked).toBe(true);
    kutu.focus();
    fireEvent.keyDown(kutu, { key: 'Escape' });
    expect(dugme.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(dugme);
    fireEvent.click(dugme);
    expect(dugme.getAttribute('aria-expanded')).toBe('true');
    fireEvent.mouseDown(document.body);
    expect(dugme.getAttribute('aria-expanded')).toBe('false');
  });
});

// ── İKİNCİ SATIR: ROZETLER KIRPILMAZ + KOLON İÇERİKLERİ (doğrulama bulguları, 2026-10-03) ──
// Eskiden hücrenin 2. satırı TEK kırpılan satırdı (11rem + "…"). Rozet bölünmeyen bir kutu
// olduğundan kısa neden metninin ARDINDAKİ rozet tarayıcıda HİÇ çizilmiyordu: "ölçülemedi /
// sunucu taranmadı…" görünür, "PROD RP'sinde tanımlı" görünmez; tanımlı hücrede
// BROKEN_INCLUDE ve Ağ'daki kırmızı "RP'de tanımlı" "…" arkasında. Testler textContent'e
// baktığı için yeşil kalıyordu. Görünürlük jsdom'da ölçülemez; güvence YAPIDADIR:
//   - 2. satırda yalnız rozetler (.pf-label) ve EN SONDA en fazla bir düz metin (.ng-kisa);
//   - kırpılan tek öğe .ng-kisa (index.css: .ng-ikinci sarar, kırpmaz — GS28);
//   - kırmızı (kötü) rozet her zaman öteki rozetlerden ÖNCE.
// Ayrıca HEAD'den beri bekçisiz kalan kolon içerikleri (Ağ metni, "kısmi", sorun kodları,
// ortam dışı, zayıf kanıt, envanter farkı) burada sınanır.
const IKINCI_FIXTURE = (): Partial<NgSpaApp>[] => [
  // (b) kendi ortamında ölçülemedi + yalnız PROD RP'de tanımlı (spa-rp.cjs gerçekten üretir).
  elle({
    application: 'b-ui',
    namespace: 'kart-test',
    env: 'test',
    rp: 'olculemedi',
    rpNeden: 'host-taranmadi',
    rpSorun: ['ORTAM_DISI'],
    rpOrtamDisi: ['PROD'],
    rpReq7Disi: 900,
  }),
  // (c) RP isteği kısmi (sunucu taranmadı) + başka ortamın isteği.
  elle({
    application: 'c-ui',
    namespace: 'kart-test',
    env: 'test',
    rp: 'tanimli',
    rpYol: ['include'],
    rpHost: '3/4',
    rpSorun: ['ORTAM_DISI'],
    rpOrtamDisi: ['PROD'],
    rpIstek: 'kismi',
    rpIstekNeden: ['host-taranmadi'],
    rpReq7: 0,
    rpReq24: 0,
    rpReq7Disi: 900,
    rpPencereSa: 168,
  }),
  // İki sorun kodu + ortam dışı + eşleşme; Ağ: envanter farkı + intranet/RP çelişkisi.
  elle({
    application: 'cok-sorun-ui',
    ag: 'intranet',
    agSay: { reencrypt: 2 },
    agEnvanter: 'celisik',
    agCelisikRoute: 3,
    agCelisme: true,
    rp: 'tanimli',
    rpYol: ['proxy', 'include'],
    rpHost: '4/6',
    rpEsles: 'ek-prod',
    rpSorun: ['BROKEN_INCLUDE', 'NOT_DEPLOYED', 'ORTAM_DISI'],
    rpOrtamDisi: ['TEST'],
    rpIstek: 'var',
    rpReq7: 9,
  }),
  elle({ application: 'zayif-ui', weakEvidence: true, istek: 'var', reqShown: 5 }),
  elle({ application: 'miss-ui', pattern: 'uymuyor', patternMiss: true }),
  elle({ application: 'kar-ui', ag: 'karisik', agSay: { passthrough: 1, reencrypt: 1 } }),
  elle({ application: 'dig-ui', ag: 'diger', agSay: { edge: 1 }, rp: 'uygulanamaz' }),
  elle({ application: 'bil-ui', ag: 'bilinmiyor', agSay: { bos: 1 } }),
  elle({
    application: 'eski-ui',
    clusters: ['gbocpprod1', 'gbocpprod2'],
    staleClusters: ['gbocpprod2'],
  }),
  elle({ application: 'kap-ui', rp: 'kapsam-disi', rpNeden: 'rp-listesi-yok' }),
];

describe('NginxSpaDiscovery — ikinci satır ve kolon içerikleri (2026-10-03)', () => {
  beforeEach(() => {
    sahte.govde = () => govdeElle(IKINCI_FIXTURE());
  });
  const ikinci = (td: HTMLElement) => td.querySelector('.ng-ikinci') as HTMLElement | null;
  const parcalar = (td: HTMLElement) =>
    [...(ikinci(td)?.children || [])].map((el) => [
      el.classList.contains('pf-label') ? 'rozet' : el.classList.contains('ng-kisa') ? 'metin' : el.className,
      el.textContent,
    ]);

  it('her hücrenin 2. satırı: önce rozetler (kırmızı en önde), en sonda tek düz metin; çıplak metin ve rozet saran kısaltma YOK', async () => {
    const { container } = render(<NginxSpaDiscovery />);
    await waitFor(() => expect(satirlar(container).length).toBe(IKINCI_FIXTURE().length));
    const hepsi = [...tablo(container).querySelectorAll('.ng-ikinci')] as HTMLElement[];
    // Ön koşul: fixture rozet + metin karışımını gerçekten üretiyor.
    expect(hepsi.some((s) => s.querySelector('.pf-label') && s.querySelector('.ng-kisa'))).toBe(
      true,
    );
    for (const s of hepsi) {
      const yer = `${s.closest('tr')?.querySelector('button')?.textContent}/${(s.closest('td') as HTMLElement)?.dataset.kolon}`;
      for (const n of [...s.childNodes])
        if (n.nodeType === Node.TEXT_NODE)
          expect(n.textContent?.trim(), `${yer}: 2. satırda çıplak metin`).toBe('');
      const tur = [...s.children].map((el) =>
        el.classList.contains('pf-label') ? 'r' : el.classList.contains('ng-kisa') ? 'm' : '?',
      );
      expect(tur.join(''), `${yer}: 2. satır sırası`).toMatch(/^r*m?$/);
      for (const k of s.querySelectorAll('.ng-kisa'))
        expect(k.children.length, `${yer}: kısaltılan metnin içinde öğe`).toBe(0);
      const kirmizi = [...s.children].map((el) => el.classList.contains('pf-label--red'));
      expect(kirmizi.indexOf(false) === -1 || kirmizi.lastIndexOf(true) < kirmizi.indexOf(false), `${yer}: kırmızı rozet sonda`).toBe(true);
    }
  });

  it('(b) ölçülemedi + ortam dışı: ortam dışı rozeti nedenden ÖNCE; (c) kısmi + başka ortamın isteği: rozet nedenden ÖNCE', async () => {
    const { container } = render(<NginxSpaDiscovery />);
    await waitFor(() => expect(satirlar(container).length).toBe(IKINCI_FIXTURE().length));
    expect(parcalar(hucre(satirOf(container, 'b-ui'), 'rp'))).toEqual([
      ['rozet', "PROD RP'sinde tanımlı"],
      ['metin', 'sunucu taranmadı'],
    ]);
    const c = hucre(satirOf(container, 'c-ui'), 'rpIstek');
    // "kısmi" bir ALT SINIRDIR: "istek yok" DEĞİL (K8).
    expect(c.querySelector(':scope > span > span:first-child')?.textContent).toBe('0 kısmi');
    expect(c.textContent).not.toContain('istek yok');
    expect(parcalar(c)).toEqual([
      ['rozet', 'ortam dışı PROD: 900'],
      ['metin', 'sunucu taranmadı'],
    ]);
  });

  it('tanımlı hücre: her sorun kodu AYRI kırmızı rozet, sonra ortam dışı, sonra eşleşme; Ağ: kırmızı çelişki önce, envanter farkı sayısıyla; çelişki ayrıntı panelinde de yazar', async () => {
    const { container } = render(<NginxSpaDiscovery />);
    await waitFor(() => expect(satirlar(container).length).toBe(IKINCI_FIXTURE().length));
    const s = satirOf(container, 'cok-sorun-ui');
    expect(parcalar(hucre(s, 'rp'))).toEqual([
      ['rozet', 'BROKEN_INCLUDE'],
      ['rozet', 'NOT_DEPLOYED'],
      ['rozet', 'ortam dışı: TEST'],
      ['rozet', "'-prod' eki"],
    ]);
    for (const r of hucre(s, 'rp').querySelectorAll('[data-testid="rp-sorun"]'))
      expect(r.classList.contains('pf-label--red'), r.textContent || '').toBe(true);
    expect(parcalar(hucre(s, 'ag'))).toEqual([
      ['rozet', "RP'de tanımlı"],
      ['rozet', 'envanter farklı (3)'],
    ]);
    expect(ipucu(hucre(s, 'ag'))).toContain('Çelişki');
    fireEvent.click(s);
    await waitFor(() =>
      expect(container.querySelector('[data-testid="ayrinti-ag-celisme"]')).not.toBeNull(),
    );
    expect(container.querySelector('[data-testid="ayrinti-ag-celisme"]')?.textContent).toContain(
      "internet RP'de tanımlı",
    );
    expect(container.querySelector('tr.ng-ayrinti')?.textContent).toContain('(3 route)');
  });

  it('kolon içerikleri: Ağ etiketi, zayıf kanıt, kalıba uymuyor, kapsam dışı nedeni, önceki koşu rozeti', async () => {
    const { container } = render(<NginxSpaDiscovery />);
    await waitFor(() => expect(satirlar(container).length).toBe(IKINCI_FIXTURE().length));
    const ilkSatir = (app: string, k: Kolon) =>
      hucre(satirOf(container, app), k).querySelector(':scope > span > span:first-child')
        ?.textContent;
    // Ağ kolonu GERÇEKTEN Ağ hücresini çizer (K15: yerine envanter hücresi bağlanırsa).
    for (const [app, t] of [
      ['zayif-ui', 'internet'],
      ['cok-sorun-ui', 'intranet'],
      ['kar-ui', 'karışık'],
      ['dig-ui', 'diğer'],
      ['bil-ui', 'bilinmiyor'],
    ] as const)
      expect(ilkSatir(app, 'ag'), app).toBe(t);
    expect(ilkSatir('zayif-ui', 'spa')).toBe('Evetzayıf kanıt');
    expect(parcalar(hucre(satirOf(container, 'miss-ui'), 'spa'))).toEqual([
      ['rozet', 'kalıba uymuyor'],
    ]);
    expect(parcalar(hucre(satirOf(container, 'zayif-ui'), 'spa'))).toEqual([
      ['metin', 'kalıba uyuyor'],
    ]);
    expect(hucre(satirOf(container, 'kap-ui'), 'rp').textContent).toBe('kapsam dışı RP listesi yok');
    expect(parcalar(hucre(satirOf(container, 'eski-ui'), 'clusterlar'))).toEqual([
      ['rozet', '1/2 önceki koşudan'],
    ]);
  });
});
