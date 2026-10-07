// src/components/__tests__/HataYokDegil.test.tsx
//
// "OKUNAMADI" ILE "YOK" AYNI SEY DEGIL (2026-10-07).
//
// Gercek tarayici taramasinda ("her API 500 doner" durumu) su ekranlar HATA yerine BOS-DURUM
// gosterdi:
//   Dashboard "Kuyrukta is yok" + "Yayinda servis yok"   · Ansible "AWX sunucusu bulunamadi,
//   .env'e ekleyin"   · Admin Kullanicilar "Henuz manuel rol atamasi yok"   · Playbook
//   Kayitlari "Henuz playbook kaydi yok"   · Sayfa Erisimi bos tablo   · Envanter Gorunurlugu
//   "Kapsamda tablo yok"   · Logo "Henuz yuklenmedi"   · Sistem'de sonsuz "yukleniyor…"
//
// Kok ortak: `safeJson` basarisiz JSON'da reddetmez, cagiranlar `r.items ?? []` ile bos liste
// uretiyor ya da hatayi `.catch(() => {})` ile yutuyordu. Hata gosterilse bile uc saniyelik
// bir bildirimdi; ekranda "yok" kaliyordu.
//
// Bu testler API'yi TAKLIT ETMEZ: gercek istemciler calisir, yalnizca `fetch` sahtedir.
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, waitFor, fireEvent } from '@testing-library/react';
import { render } from '@/test/test-utils';
import { AuthContext } from '@/contexts/AuthContext';
import { AppDataProvider, useAppData } from '@/contexts/AppContext';
import { nobetciApi } from '@/api/nobetciApi';
import LoadError from '@/components/common/LoadError';
import UserManagementTab from '@/components/admin/tabs/UserManagementTab';
import PlaybookRegistryTab from '@/components/admin/tabs/PlaybookRegistryTab';
import PageVisibilityTab from '@/components/admin/tabs/PageVisibilityTab';
import InventoryVisibilityTab from '@/components/admin/tabs/InventoryVisibilityTab';
import BrandingTab from '@/components/admin/tabs/BrandingTab';
import SystemConfigTab from '@/components/admin/tabs/SystemConfigTab';
import AnsiblePage from '@/components/ansible/AnsiblePage';
import ScopeStep from '@/components/scalex/steps/ScopeStep';
import DashboardPage from '@/components/DashboardPage';

type Yanit = () => Response | Promise<Response>;
const json =
  (status: number, body: unknown): Yanit =>
  () =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const HATA = (mesaj: string) => json(500, { ok: false, message: mesaj });

/** URL parcasina gore yanit; eslesmeyen her istek "basarili ve bos". Kurallar degistirilebilir. */
let kurallar: [string, Yanit][] = [];
function fetchKur(k: [string, Yanit][]) {
  kurallar = k;
}
beforeEach(() => {
  kurallar = [];
  nobetciApi.invalidate();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (girdi: RequestInfo | URL) => {
      const u = typeof girdi === 'string' ? girdi : girdi instanceof URL ? girdi.href : girdi.url;
      for (const [parca, y] of kurallar) if (u.includes(parca)) return y();
      return json(200, { ok: true })();
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

const cagriSayisi = (parca: string) =>
  (fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls.filter((c) =>
    String(c[0]).includes(parca),
  ).length;

describe('LoadError bileseni', () => {
  it('HY1 ne okunamadigini, sebebini soyler; "Tekrar dene" cagirir; deneme surerken kapali', () => {
    const tekrar = vi.fn();
    const { rerender } = render(
      <LoadError title="Roller okunamadı" message="DB yok" onRetry={tekrar} testId="h" />,
    );
    const kutu = screen.getByTestId('h');
    expect(kutu.getAttribute('role')).toBe('alert');
    expect(kutu.textContent).toMatch(/Roller okunamadı/);
    expect(kutu.textContent).toMatch(/DB yok/);
    fireEvent.click(screen.getByRole('button', { name: 'Tekrar dene' }));
    expect(tekrar).toHaveBeenCalledTimes(1);
    rerender(<LoadError title="x" onRetry={tekrar} retrying />);
    expect(
      (screen.getByRole('button', { name: 'Tekrar dene' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    rerender(<LoadError title="x" />);
    expect(screen.queryByRole('button', { name: 'Tekrar dene' })).toBeNull();
  });
});

// [ad, bilesen, dusen uc, hata kutusunun testid'i, hata varken GORUNMEMESI gereken bos-durum
//  metni, basarili bos yanit, basarida gorunen metin]
type Senaryo = {
  ad: string;
  ui: () => React.ReactElement;
  uc: string;
  kutu: string;
  yokMetni: RegExp;
  bosYanit: unknown;
  bosMetni: RegExp;
};
const yetki = { refreshVisibility: async () => true, canSee: () => true } as never;
const SENARYOLAR: Senaryo[] = [
  {
    ad: 'Admin > Kullanıcılar',
    ui: () => <UserManagementTab />,
    uc: '/api/roles',
    kutu: 'roller-yukleme-hatasi',
    yokMetni: /Henüz manuel rol ataması yok/,
    bosYanit: { ok: true, roles: {} },
    bosMetni: /Henüz manuel rol ataması yok/,
  },
  {
    ad: 'Admin > Playbook Kayıtları',
    ui: () => <PlaybookRegistryTab />,
    uc: '/api/ansible/playbooks',
    kutu: 'playbook-yukleme-hatasi',
    yokMetni: /Henüz playbook kaydı yok/,
    bosYanit: { ok: true, playbooks: [] },
    bosMetni: /Henüz playbook kaydı yok/,
  },
  {
    ad: 'Admin > Sayfa Erişimi',
    ui: () => (
      <AuthContext.Provider value={yetki}>
        <PageVisibilityTab />
      </AuthContext.Provider>
    ),
    uc: '/api/visibility/elements',
    kutu: 'gorunurluk-yukleme-hatasi',
    yokMetni: /Kaydet/,
    bosYanit: { ok: true, elements: [], rules: [] },
    bosMetni: /Kaydet/,
  },
  {
    ad: 'Admin > Envanter Görünürlüğü',
    ui: () => <InventoryVisibilityTab />,
    uc: '/api/inventory/table-visibility',
    kutu: 'envanter-gorunurluk-hatasi',
    yokMetni: /Tüm tabloları göster/,
    bosYanit: { ok: true, tables: [], allTablesVisible: { User: false, Admin: true } },
    bosMetni: /Tüm tabloları göster/,
  },
  {
    ad: 'Admin > Envanter Görünürlüğü > Geçmiş Kapsamı',
    ui: () => <InventoryVisibilityTab />,
    uc: '/api/inventory/history/config',
    kutu: 'gecmis-kapsami-hatasi',
    yokMetni: /Kapsamda tablo yok/,
    bosYanit: { ok: true, configured: [], candidates: [] },
    bosMetni: /Kapsamda tablo yok/,
  },
  {
    ad: 'Admin > Logo',
    ui: () => <BrandingTab />,
    uc: '/api/admin/branding',
    kutu: 'logo-yukleme-hatasi',
    yokMetni: /Henüz yüklenmedi/,
    bosYanit: { ok: true, favicon: null, logo: null, limits: null },
    bosMetni: /Henüz yüklenmedi/,
  },
  {
    ad: 'Ansible sayfası',
    ui: () => <AnsiblePage />,
    uc: '/api/ansible/servers',
    kutu: 'ansible-sunucu-hatasi',
    yokMetni: /\.env dosyasına/,
    bosYanit: { ok: true, servers: [] },
    bosMetni: /Yapılandırılmış AWX sunucusu bulunamadı/,
  },
  {
    ad: 'ScaleX kapsam adımı',
    ui: () => <ScopeStep busy={false} onSubmit={() => {}} />,
    uc: '/api/scalex/clusters',
    kutu: 'scalex-cluster-hatasi',
    yokMetni: /cluster seçildi/,
    bosYanit: { ok: true, tree: { PROD: { ARK: ['c1'] } } },
    bosMetni: /PROD/,
  },
];

describe('Liste okunamadiginda ekran "yok" demez', () => {
  it.each(SENARYOLAR)('HY2 $ad: hata + sebep gorunur, bos-durum metni GORUNMEZ', async (s) => {
    fetchKur([[s.uc, HATA('Veritabanına ulaşılamadı.')]]);
    render(s.ui());
    const kutu = await screen.findByTestId(s.kutu);
    expect(kutu.textContent).toMatch(/okunamadı/);
    expect(kutu.textContent).toMatch(/Veritabanına ulaşılamadı\./);
    expect(screen.queryByText(s.yokMetni)).toBeNull();
  });

  it.each(SENARYOLAR)('HY3 $ad: "Tekrar dene" yeniden ceker; basarida hata gider', async (s) => {
    fetchKur([[s.uc, HATA('Geçici hata')]]);
    render(s.ui());
    const kutu = await screen.findByTestId(s.kutu);
    const once = cagriSayisi(s.uc);
    fetchKur([[s.uc, json(200, s.bosYanit)]]);
    fireEvent.click(kutu.querySelector('button') as HTMLButtonElement);
    await waitFor(() => expect(screen.queryByTestId(s.kutu)).toBeNull());
    expect(cagriSayisi(s.uc)).toBeGreaterThan(once);
    expect((await screen.findAllByText(s.bosMetni)).length).toBeGreaterThan(0);
  });

  it('HY4 Sistem: degerler okunamazsa "yukleniyor…" SONSUZA DEK kalmaz', async () => {
    fetchKur([['/api/admin/system-config', HATA('Ayar dosyası okunamadı.')]]);
    render(<SystemConfigTab />);
    const kutu = await screen.findByTestId('sistem-ayar-hatasi');
    expect(kutu.textContent).toMatch(/Ortam değişkenleri okunamadı/);
    expect(kutu.textContent).toMatch(/Ayar dosyası okunamadı\./);
    expect(screen.queryByText('yükleniyor…')).toBeNull();
    expect(screen.getAllByText('okunamadı').length).toBeGreaterThan(5);

    fetchKur([
      [
        '/api/admin/system-config',
        json(200, {
          ok: true,
          values: [{ key: 'PORT', value: '3000', defined: true, masked: false }],
        }),
      ],
    ]);
    fireEvent.click(kutu.querySelector('button') as HTMLButtonElement);
    expect(await screen.findByText('3000')).toBeTruthy();
    expect(screen.queryByTestId('sistem-ayar-hatasi')).toBeNull();
    expect(screen.queryByText('okunamadı')).toBeNull();
  });
});

describe('Uygulama verisi (AppContext)', () => {
  const Sonda: React.FC = () => {
    const { selfSrvCount, selfSrvLoading, nobetci } = useAppData();
    return (
      <p data-testid="sonda">
        {JSON.stringify({
          selfSrvCount,
          selfSrvLoading,
          nobetci: nobetci && [nobetci.ok, nobetci.message],
        })}
      </p>
    );
  };
  const oku = () => JSON.parse(screen.getByTestId('sonda').textContent || '{}');

  it('HY5 katalog okunamazsa sayi `null` olur (0 = "okundu, servis yok" ile karismaz)', async () => {
    fetchKur([['/api/ansible/ss/items', HATA('x')]]);
    render(
      <AppDataProvider>
        <Sonda />
      </AppDataProvider>,
    );
    await waitFor(() => expect(oku().selfSrvLoading).toBe(false));
    expect(oku().selfSrvCount).toBeNull();
  });

  it('HY6 katalog okunup BOS geldiyse sayi 0 kalir', async () => {
    fetchKur([['/api/ansible/ss/items', json(200, { ok: true, items: [] })]]);
    render(
      <AppDataProvider>
        <Sonda />
      </AppDataProvider>,
    );
    await waitFor(() => expect(oku().selfSrvLoading).toBe(false));
    expect(oku().selfSrvCount).toBe(0);
  });

  it('HY7 nobet istegi DUSERSE kart sonsuza dek iskelet gostermez: sonuc "okunamadi" olur', async () => {
    fetchKur([
      [
        '/api/nobetci/today',
        () => {
          throw new TypeError('Failed to fetch');
        },
      ],
    ]);
    render(
      <AppDataProvider>
        <Sonda />
      </AppDataProvider>,
    );
    await waitFor(() => expect(oku().nobetci).not.toBeNull());
    expect(oku().nobetci[0]).toBe(false);
    expect(oku().nobetci[1]).toMatch(/Failed to fetch|alınamadı/);
  });
});

describe('Dashboard', () => {
  const oturum = {
    user: { username: 'u', role: 'Admin', displayName: 'Deneme' },
    canViewPage: () => true,
    visibilityReady: true,
  } as never;
  const ac = () =>
    render(
      <AuthContext.Provider value={oturum}>
        <AppDataProvider>
          <DashboardPage />
        </AppDataProvider>
      </AuthContext.Provider>,
    );

  it('HY8 kuyruk ve katalog okunamazsa "is yok" / "servis yok" DENMEZ', async () => {
    fetchKur([
      ['/api/ansible/awx/recent-jobs', HATA('AWX kuyruğu okunamadı.')],
      ['/api/ansible/ss/items', HATA('x')],
      ['/api/nobetci/today', json(200, { ok: true, name: 'Ayşe Yılmaz' })],
    ]);
    ac();
    expect(await screen.findByText(/Liste alınamadı: AWX kuyruğu okunamadı\./)).toBeTruthy();
    expect(screen.queryByText('Kuyrukta iş yok.')).toBeNull();
    expect(await screen.findByText('Katalog okunamadı')).toBeTruthy();
    expect(screen.queryByText('Yayında servis yok')).toBeNull();
  });

  it('HY9 kuyruk okunup BOS geldiyse "Kuyrukta is yok" denir (hata yok)', async () => {
    fetchKur([
      ['/api/ansible/awx/recent-jobs', json(200, { ok: true, servers: [] })],
      ['/api/ansible/ss/items', json(200, { ok: true, items: [] })],
      ['/api/nobetci/today', json(200, { ok: true, name: 'Ayşe Yılmaz' })],
    ]);
    ac();
    expect(await screen.findByText('Kuyrukta iş yok.')).toBeTruthy();
    expect(screen.queryByText(/Liste alınamadı/)).toBeNull();
    expect(await screen.findByText('Yayında servis yok')).toBeTruthy();
  });

  it('HY10 bugun icin nobetci yoksa aciklamasiz "?" yerine durum yazilir', async () => {
    fetchKur([['/api/nobetci/today', json(200, { ok: true, name: null })]]);
    ac();
    expect(await screen.findByText('Bugün için nöbetçi tanımlı değil.')).toBeTruthy();
    expect(screen.queryByText('?')).toBeNull();
  });

  it('HY11 durum satirlari klavyeyle de acilir (Enter)', async () => {
    fetchKur([['/api/ansible/ss/items', json(200, { ok: true, items: [{ id: 1 }] })]]);
    ac();
    const satir = (await screen.findByText('Self service kataloğu')).closest('[role="button"]');
    expect(satir).toBeTruthy();
    expect(satir?.getAttribute('tabindex')).toBe('0');
  });
});
