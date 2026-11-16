// paket-tutarlilik.test.tsx — Nginx Hub › Tutarlılık › Paketler (2026-11-16).
//
// Kullanıcı: "Glomo sunucularının her zaman ve her şartta eşit olduğunu bilmek istiyorum."
//   PK1 sekme varsayılan olarak Paketler'i açar; FARKLI hükmü, sapan hücre ve fark adı görünür
//   PK2 ölçülemeyen sunucu: hüküm ÖLÇÜLEMEDİ, nedeni yazar; "eşit" denmez
//   PK3 okunamadı ≠ eşit: ok:false / listesiz yanıt LoadError gösterir, grup kartı çizilmez
//   PK4 Konfigürasyon görünümüne geçiş eski dosya karşılaştırmasını çağırır
//   PK5 okunamayan paket OKUNAMADI hücresi ve "okunamadı" rozeti; bayat .gz/.br hücrede yazar;
//       "birebir aynı" metni yalnız EŞİT'te
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { render } from '@/test/test-utils';
import { DriftTab } from '@/components/nginx_console/DriftTab';
import type { NcPaketGrup } from '@/api/nginxConsoleApi';

const yanit = (govde: unknown, status = 200) =>
  Promise.resolve(
    new Response(JSON.stringify(govde), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  );

const HOSTS = ['GBNGXAP34', 'GBNGXP40', 'GBNGXP41'];
const sunucu = (
  host: string,
  durum: 'olculdu' | 'bayat' = 'olculdu',
  neden: string | null = null,
) => ({
  host,
  durum,
  neden,
  seenAt: '2026-11-16T14:30:00Z',
  dumpedAt: '2026-11-16T14:30:00Z',
  paketSayisi: 2,
});
const hucre = (host: string, icerik = 'aaaaaaaaaaaa') => ({
  host,
  version: '0.0.11-1-prod',
  icerik,
  config: 'b7d870101bd9',
  dosya: icerik === 'aaaaaaaaaaaa' ? 973 : 953,
  versionZamani: '2026-11-16 16:44',
});

const farkliGrup: NcPaketGrup = {
  id: 'glomo',
  label: 'Glomo',
  hosts: HOSTS,
  hukum: 'farkli',
  sunucular: HOSTS.map((h) => sunucu(h)),
  sayac: {
    uygulama: 2,
    ayni: 1,
    farkli: 1,
    eksik: 0,
    olculemedi: 0,
    tanimsiz: 0,
    olculen: 3,
    sunucu: 3,
  },
  apps: [
    {
      key: 'ges-pension-fund-ch-prod/fund-coach-app-v0',
      ns: 'ges-pension-fund-ch-prod',
      app: 'fund-coach-app-v0',
      durum: 'farkli',
      fark: ['icerik'],
      yalnizVersion: false,
      yok: [],
      okunamayan: [],
      bayatSikistirma: [],
      varyantlar: [
        {
          version: '0.0.11-1-prod',
          icerik: 'aaaaaaaaaaaa',
          config: 'b7d870101bd9',
          dosya: 973,
          hosts: ['GBNGXP40', 'GBNGXP41'],
        },
        {
          version: '0.0.11-1-prod',
          icerik: 'cccccccccccc',
          config: 'b7d870101bd9',
          dosya: 953,
          hosts: ['GBNGXAP34'],
        },
      ],
      cogunluk: {
        version: '0.0.11-1-prod',
        icerik: 'aaaaaaaaaaaa',
        config: 'b7d870101bd9',
        dosya: 973,
        hosts: ['GBNGXP40', 'GBNGXP41'],
      },
      sunucular: [hucre('GBNGXAP34', 'cccccccccccc'), hucre('GBNGXP40'), hucre('GBNGXP41')],
    },
  ],
  ayni: [{ key: 'ns/app-a', version: '1.0.0-1-prod' }],
  tanimsiz: [],
};

describe('Tutarlılık › Paketler', () => {
  let paket: { govde: unknown; durum: number };
  let driftCagrildi: boolean;
  beforeEach(() => {
    paket = {
      govde: { ok: true, groups: [farkliGrup], tazeSaat: 3, generatedAt: '2026-11-16T15:00:00Z' },
      durum: 200,
    };
    driftCagrildi = false;
    vi.stubGlobal(
      'fetch',
      vi.fn((u: string) => {
        if (String(u).includes('/drift/paket')) return yanit(paket.govde, paket.durum);
        if (String(u).includes('/drift')) {
          driftCagrildi = true;
          return yanit({ ok: true, groups: [], services: [], generatedAt: 'x' });
        }
        return yanit({ ok: true });
      }),
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  it('PK1 varsayılan Paketler: FARKLI hükmü, sapan hücre ve fark adı', async () => {
    render(<DriftTab onOpen={() => {}} />);
    expect(await screen.findByTestId('paket-hukum-glomo')).toHaveTextContent('FARKLI');
    expect(screen.getByText('fund-coach-app-v0')).toBeTruthy();
    const key = 'ges-pension-fund-ch-prod/fund-coach-app-v0';
    expect(screen.getByTestId(`paket-fark-${key}`).textContent).toBe('dosyalar');
    expect(screen.getByTestId(`paket-hucre-${key}-GBNGXAP34`).getAttribute('data-sapma')).toBe('1');
    expect(screen.getByTestId(`paket-hucre-${key}-GBNGXP40`).getAttribute('data-sapma')).toBe('0');
    expect(driftCagrildi).toBe(false);
  });

  it('PK2 ölçülemeyen sunucu: ÖLÇÜLEMEDİ ve nedeni; eşit denmez', async () => {
    paket.govde = {
      ok: true,
      tazeSaat: 3,
      groups: [
        {
          ...farkliGrup,
          hukum: 'olculemedi',
          apps: [],
          sunucular: [
            sunucu('GBNGXAP34', 'bayat', 'son ölçüm 5 saat önce (en çok 3 saat)'),
            sunucu('GBNGXP40'),
            sunucu('GBNGXP41'),
          ],
          sayac: {
            uygulama: 1,
            ayni: 1,
            farkli: 0,
            eksik: 0,
            olculemedi: 0,
            tanimsiz: 0,
            olculen: 2,
            sunucu: 3,
          },
        },
      ],
    };
    render(<DriftTab onOpen={() => {}} />);
    expect(await screen.findByTestId('paket-hukum-glomo')).toHaveTextContent('ÖLÇÜLEMEDİ');
    expect(screen.getByText(/GBNGXAP34: son ölçüm 5 saat önce/)).toBeTruthy();
    expect(screen.getByTestId('paket-hukum-glomo').textContent).toBe('ÖLÇÜLEMEDİ');
    expect(screen.getByText(/2\/3 sunucu ölçüldü/)).toBeTruthy();
  });

  it('PK3 okunamadı: ok:false ve listesiz yanıt LoadError; kart çizilmez', async () => {
    paket = { govde: { ok: false, message: 'Paket tutarlılığı hesaplanamadı: x' }, durum: 500 };
    const { unmount } = render(<DriftTab onOpen={() => {}} />);
    expect(await screen.findByTestId('paket-hata')).toBeTruthy();
    expect(screen.getByText('Paket tutarlılığı okunamadı')).toBeTruthy();
    expect(screen.queryByTestId('paket-grup-glomo')).toBeNull();
    unmount();
    paket = { govde: { ok: true }, durum: 200 };
    render(<DriftTab onOpen={() => {}} />);
    expect(await screen.findByTestId('paket-hata')).toBeTruthy();
    expect(screen.getByText(/beklenen biçimde değil/)).toBeTruthy();
  });

  it('PK4 Konfigürasyon görünümü eski dosya karşılaştırmasını açar', async () => {
    render(<DriftTab onOpen={() => {}} />);
    await screen.findByTestId('paket-hukum-glomo');
    fireEvent.click(screen.getByRole('tab', { name: 'Konfigürasyon' }));
    await waitFor(() => expect(driftCagrildi).toBe(true));
    expect(screen.queryByTestId('paket-tutarlilik')).toBeNull();
  });

  it('PK5 okunamadı hücresi, bayat sıkıştırma ve ÖLÇÜLEMEDİ metni', async () => {
    const key = 'ges-pension-fund-ch-prod/fund-coach-app-v0';
    paket.govde = {
      ok: true,
      tazeSaat: 3,
      groups: [
        {
          ...farkliGrup,
          hukum: 'olculemedi',
          sayac: {
            uygulama: 2,
            ayni: 1,
            farkli: 0,
            eksik: 0,
            olculemedi: 1,
            tanimsiz: 0,
            olculen: 3,
            sunucu: 3,
          },
          apps: [
            {
              ...farkliGrup.apps[0],
              durum: 'olculemedi',
              fark: [],
              okunamayan: ['GBNGXAP34'],
              sunucular: [
                { host: 'GBNGXAP34', okunamadi: true, version: null },
                { ...hucre('GBNGXP40'), bayatSikistirma: 0 },
                { ...hucre('GBNGXP41'), bayatSikistirma: 2 },
              ],
            },
          ],
        },
      ],
    };
    render(<DriftTab onOpen={() => {}} />);
    expect((await screen.findByTestId('paket-hukum-glomo')).textContent).toBe('ÖLÇÜLEMEDİ');
    expect(screen.getByTestId(`paket-hucre-${key}-GBNGXAP34`).textContent).toBe('OKUNAMADI');
    expect(screen.getByTestId(`paket-hucre-${key}-GBNGXP41`).textContent).toContain(
      '2 bayat .gz/.br',
    );
    expect(screen.getByText('1 okunamadı')).toBeTruthy();
    expect(screen.queryByText(/birebir aynı/)).toBeNull();
  });
});
