// src/components/__tests__/ListeUclari.test.tsx
//
// LISTE API'SI DUSTUGUNDE SAYFA COKMEZ, SUNUCUNUN MESAJI GORUNUR (2026-10-07).
//
// Gercek tarayici taramasinda Telnet (Legacy ve OpenShift) ile FileX, liste API'si 500 ya da
// 403 dondugunde "Bu sayfa yüklenemedi — Cannot read properties of undefined (reading
// 'length')" ile TUMUYLE dusuyordu; kullanici "yetkiniz yok" mesajini hic gormuyordu.
// Kok: `safeJson` basarisiz JSON'da reddetmez, adimlar `setApps(r.apps)` / `setHosts(r.hosts)`
// / `setTree(r.tree)` diye kontrolsuz yaziyordu.
//
// Bu testler API'yi TAKLIT ETMEZ: gercek `telnetApi` / `filexApi` calisir, yalnizca `fetch`
// sahtedir. Boylece istemcinin hata sozlesmesi (okJson) ile adimin davranisi birlikte sinanir.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { render } from '@/test/test-utils';
import TelnetAppSearch from '@/components/telnet/steps/AppSearchStep';
import TelnetJboss from '@/components/telnet/steps/JbossVersionStep';
import TelnetHosts from '@/components/telnet/steps/HostSelectStep';
import TelnetOcpTarget from '@/components/telnet/steps/OcpTargetStep';
import TelnetOcpCluster from '@/components/telnet/steps/OcpClusterPickStep';
import FilexAppSearch from '@/components/filex/steps/AppSearchStep';
import FilexJboss from '@/components/filex/steps/JbossVersionStep';
import FilexHosts from '@/components/filex/steps/HostSelectStep';
import { selfServiceApi } from '@/api/selfServiceApi';
import { ansibleApi } from '@/api/ansibleApi';
import { roleApi } from '@/api/adminApi';
import { playbookRegistryApi } from '@/api/playbookRegistryApi';

let yanit: () => Response;
const json = (status: number, body: unknown) => () =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => yanit()),
  );
});
afterEach(() => vi.unstubAllGlobals());

const bos = () => {};
// Her adim: [ad, bilesen]. Hepsi acilista bir liste ucu cagirir.
const ADIMLAR: [string, () => React.ReactElement][] = [
  ['Telnet uygulama arama', () => <TelnetAppSearch onSelect={bos} />],
  ['Telnet JBoss sürümü', () => <TelnetJboss app="APP" onSubmit={bos} />],
  ['Telnet sunucu seçimi', () => <TelnetHosts app="APP" jbossVersions={['7']} onSubmit={bos} />],
  ['Telnet OpenShift hedefi', () => <TelnetOcpTarget onSubmit={bos} />],
  ['Telnet OpenShift cluster', () => <TelnetOcpCluster env="PROD" tenant="ARK" onSubmit={bos} />],
  ['FileX uygulama arama', () => <FilexAppSearch onSelect={bos} />],
  ['FileX JBoss sürümü', () => <FilexJboss app="APP" onSubmit={bos} />],
  ['FileX sunucu seçimi', () => <FilexHosts app="APP" jbossVersions={['7']} onSubmit={bos} />],
];

describe('Liste API hatasi: adim cokmez, mesaj gorunur', () => {
  it.each(ADIMLAR)('LU1 %s: 500 -> sunucunun mesaji', async (_ad, bilesen) => {
    yanit = json(500, { ok: false, message: 'Envanter veritabanına ulaşılamadı.' });
    render(bilesen());
    expect(await screen.findByText('Envanter veritabanına ulaşılamadı.')).toBeTruthy();
  });

  it.each(ADIMLAR)('LU2 %s: 403 -> "yetkiniz yok" kullaniciya ulasir', async (_ad, bilesen) => {
    yanit = json(403, { ok: false, error: 'Bu işlem için yetkiniz yok.' });
    render(bilesen());
    expect(await screen.findByText('Bu işlem için yetkiniz yok.')).toBeTruthy();
  });

  it.each(ADIMLAR)('LU3 %s: alani eksik "basarili" yanit da dusurmez', async (_ad, bilesen) => {
    yanit = json(200, { ok: true });
    const { container } = render(bilesen());
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    // Render dustuyse React agaci bosaltir; bir sure sonra hala icerik olmali.
    await new Promise((r) => setTimeout(r, 350));
    expect(container.textContent?.length).toBeGreaterThan(0);
  });
});

describe('Uygulama arama: "okunamadi" ile "sonuc yok" ayri', () => {
  it.each([
    ['Telnet', () => <TelnetAppSearch onSelect={bos} />],
    ['FileX', () => <FilexAppSearch onSelect={bos} />],
  ] as [string, () => React.ReactElement][])('LU4 %s', async (_ad, bilesen) => {
    yanit = json(500, { ok: false, message: 'Sunucu hatası' });
    const { unmount } = render(bilesen());
    await screen.findByText('Sunucu hatası');
    expect(screen.queryByText('Sonuç yok.')).toBeNull();
    expect(screen.getByText('Liste okunamadı.')).toBeTruthy();
    unmount();

    yanit = json(200, { ok: true, apps: [], fallbackMode: false });
    render(bilesen());
    expect(await screen.findByText('Sonuç yok.')).toBeTruthy();
    expect(screen.queryByText('Liste okunamadı.')).toBeNull();
    // Arama kutusu yalnizca placeholder ile degil, adla da etiketli.
    expect(screen.getByLabelText('Uygulama adı ara')).toBeTruthy();
  });
});

describe('Istemciler hata olarak HAM GOVDEYI firlatmaz', () => {
  // Otomasyon sayfasi hata kutusunda `{"ok":false,"message":"..."}` gosteriyordu; Denetim
  // Kaydi ise sunucu `message` yolladiginda yalnizca "HTTP 500" diyordu.
  it.each([
    ['selfServiceApi.get', () => selfServiceApi.get()],
    ['ansibleApi.ssItems', () => ansibleApi.ssItems()],
    ['ansibleApi.servers', () => ansibleApi.servers()],
    ['ansibleApi.recentJobs', () => ansibleApi.recentJobs()],
    ['playbookRegistryApi.list', () => playbookRegistryApi.list()],
    ['roleApi.list', () => roleApi.list()],
  ] as [string, () => Promise<unknown>][])(
    'LU5 %s: mesaj sunucunun cumlesidir',
    async (_ad, cagir) => {
      yanit = json(500, { ok: false, message: 'Veritabanına ulaşılamadı.' });
      const hata = await cagir().then(
        () => null,
        (e: Error) => e,
      );
      expect(hata, 'basarisiz yanitta reddetmedi').toBeInstanceOf(Error);
      expect(hata?.message).toBe('Veritabanına ulaşılamadı.');
    },
  );
});
