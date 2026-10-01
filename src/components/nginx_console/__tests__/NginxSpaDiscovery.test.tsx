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

const requireCjs = createRequire(import.meta.url);
const KOK = '../../../../server';
const { buildSpaDiscovery, spaYanitGovdesi } = requireCjs(`${KOK}/nginx-console/spa-discovery.cjs`);
const { internetRpHosts } = requireCjs(`${KOK}/audit/nginx-hosts.cjs`);
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
          tanimlar: [],
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
