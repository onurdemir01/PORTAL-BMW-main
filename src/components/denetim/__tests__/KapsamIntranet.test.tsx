// src/components/denetim/__tests__/KapsamIntranet.test.tsx
//
// Nginx Hub › SPA › Kapsam & Taşıma — intranet kurulum hücresi Nginx ARK SPA › Intranet SPA ile
// AYNI hesap (2026-10-19). Kullanıcı: "Kapsamın eşleşmesini düzeltelim lütfen, farklı sayfada
// farklı veri gözükmesi bizim yanlış raporlama yapmamıza sebep oluyor."
//   KU1 payda ortak raporun uygulama sayısı (ad kalıbı sayısı DEĞİL); yarım / hiç kurulmamış;
//       kaynak satırı; SPA sütunundaki "iç ağda" sayısı "(ad kalıbı)" etiketli
//   KU2 tıkla-listesi ortak raporun kurulmamış + yarım satırları; alt başlık aynı listeyi söyler
//   KU3 rapor okunamadı: ölçülemedi + neden, tıklanamaz; ölçülemedi / sunucu yok ayrı kova
//   KU4 eski kaynak (başka platform): payda ad kalıbı, etiket yok; dipnot platform dışını söyler
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { render } from '@/test/test-utils';
import NginxSpaSummary from '@/components/denetim/NginxSpaSummary';
import type { SpaCoverageResult, SpaCoverageRow, SpaMissingApp } from '@/api/denetimApi';

const mockCov = vi.hoisted(() => vi.fn());
vi.mock('@/api/denetimApi', () => ({
  denetimApi: {
    spaCoverage: mockCov,
    routeStats: () => Promise.resolve({ ok: false }),
    nginxMigration: () => Promise.resolve({ ok: false }),
  },
}));

const sahip = { groups: ['GT-Kart'], emails: ['kart@banka.com'], unknownNs: [], namespaces: ['kart-prod'] };
const D = (app: string, kind: SpaMissingApp['kind'], hosts?: SpaMissingApp['hosts']): SpaMissingApp => ({
  app, namespaces: ['kart-prod'], owner: sahip, kind, namespace: 'kart-prod', ...(hosts ? { hosts } : {}),
});

function satir(o: Partial<SpaCoverageRow> = {}): SpaCoverageRow {
  return {
    env: 'PROD', measured: false, ocpApps: 10, spaTotal: 3, internetTotal: 2, internetInNginx: 0,
    internetMissingCount: 0, internetMissing: [],
    intranetTotal: 1, measuredIntranet: true, intranetFull: 1, intranetPartialCount: 2, intranetPartial: [],
    intranetMissingCount: 2, intranetMissing: [], intranetOnlyOnServerCount: 0, intranetOnlyOnServer: [],
    intranetHosts: ['GBNGXP50', 'GBNGXP51'], intranetCoverage: 20, intranetInNginx: 0, intranetInNginxList: [],
    otherTotal: 0, otherInNginx: 0, unknownTotal: 0, unknownInNginx: 0, onlyNginxCount: 0, onlyNginx: [], coverage: null,
    intranetKaynak: 'intranet-spa', intranetKaynakHata: '', intranetKurulumToplam: 5, intranetOlculemediCount: 0, intranetSunucuYokCount: 0,
    missingDetail: {
      internet: [],
      intranet: [
        D('ad-uymaz', 'missing'), D('yok-ui', 'missing'),
        D('tek-ui', 'partial', [{ host: 'GBNGXP50', missing: ['hysdeploy', 'applications', 'conf'] }]),
        D('yarim-ui', 'partial', [{ host: 'GBNGXP51', missing: ['applications'] }]),
      ],
    },
    ...o,
  } as SpaCoverageRow;
}
function cov(row: SpaCoverageRow, o: Partial<SpaCoverageResult> = {}): SpaCoverageResult {
  return {
    ok: true, platform: 'ark', clusters: [], scanDate: '2026-10-18', routeTableMissing: false,
    routeMatch: { address: 0, name: 0, ns: 0, conflict: 0, none: 0 }, ocpNonSpaExcluded: 0, nginxOutsidePattern: [],
    ocpSkippedNoEnv: 0, rows: [row], intranetKaynak: 'intranet-spa', intranetKaynakHata: '',
    intranetRapor: { kesifTarihi: '2026-10-18', dizinTarihi: '2026-10-18', dizinDurum: 'var', taranmayanSunucu: [], platformDisi: [], ortamsiz: 0 },
    ...o,
  } as SpaCoverageResult;
}
const tamamKutusu = async () => (await screen.findByText('kurulumu tamam olan uygulama')).parentElement!.textContent;

describe('Kapsam & Taşıma — intranet kurulumu Intranet SPA ile aynı hesap', () => {
  beforeEach(() => vi.clearAllMocks());

  it('KU1 payda ortak raporun uygulama sayısı; kaynak satırı; "iç ağda" ad kalıbı etiketli', async () => {
    mockCov.mockResolvedValue(cov(satir()));
    render(<NginxSpaSummary tier="intranet" />);
    expect(await tamamKutusu()).toBe('1/ 5kurulumu tamam olan uygulama');
    expect(screen.getByText('yarım kurulu: 2')).toBeTruthy();
    expect(screen.getByText('hiç kurulmamış: 2')).toBeTruthy();
    expect(screen.getByText('Kaynak: Gerçek SPA Keşfi — Nginx ARK SPA › Intranet SPA ile aynı liste ve aynı hesap.')).toBeTruthy();
    expect(screen.getByText(/iç ağda 1 \(ad kalıbı\)/)).toBeTruthy();
    // çubuk da ortak paydayla (1 / 5 = %20; ad kalıbı paydasıyla %100 olurdu)
    expect(screen.getByTitle(/Ortamın taranan her intranet nginx’inde/).textContent).toMatch(/20/);
    expect(document.body.textContent).toMatch(/Nginx ARK SPA › Intranet SPA ile aynı liste ve aynı hesap: ortamın taranan her intranet nginx’inde/);
  });

  it('KU2 tıkla-listesi ortak raporun kurulmamış + yarım satırları', async () => {
    mockCov.mockResolvedValue(cov(satir()));
    render(<NginxSpaSummary tier="intranet" />);
    fireEvent.click(await screen.findByText('4 eksik → sahipleriyle listele'));
    await waitFor(() => expect(screen.getByText(/Nginx ARK SPA › Intranet SPA ile aynı liste$/)).toBeTruthy());
    for (const a of ['ad-uymaz', 'yok-ui', 'tek-ui', 'yarim-ui']) expect(screen.getAllByText(a).length).toBeGreaterThan(0);
    expect(screen.getByText('GBNGXP51: applications yok')).toBeTruthy();
    expect(screen.getByText(/2 hiç kurulmamış · 2 yarım \(taranan sunuculardan en az birinde eksik\)/)).toBeTruthy();
  });

  it('KU3 rapor okunamadı: ölçülemedi + neden, tıklanamaz; ayrı kovalar', async () => {
    mockCov.mockResolvedValue(cov(satir({
      measuredIntranet: false, intranetFull: 0, intranetPartialCount: 0, intranetMissingCount: 0, intranetKurulumToplam: 0,
      intranetKaynakHata: 'Intranet SPA raporu okunamadı: zaman aşımı', missingDetail: { internet: [], intranet: [] },
    })));
    const { unmount } = render(<NginxSpaSummary tier="intranet" />);
    expect(await screen.findByText('Intranet SPA raporu okunamadı: zaman aşımı — bu “kurulmamış” demek değildir.')).toBeTruthy();
    expect(screen.queryByText(/sahipleriyle listele/)).toBeNull();
    unmount();
    mockCov.mockResolvedValue(cov(satir({ intranetOlculemediCount: 3, intranetSunucuYokCount: 1 })));
    render(<NginxSpaSummary tier="intranet" />);
    expect(await screen.findByText('ölçülemedi: 3')).toBeTruthy();
    expect(screen.getByText('ortamın intranet sunucusu yok: 1')).toBeTruthy();
  });

  it('KU4 eski kaynak: payda ad kalıbı, etiket yok; dipnot platform dışı ve taranmayan sunucu', async () => {
    mockCov.mockResolvedValue(cov(satir({ intranetKaynak: 'ad-kalibi', intranetTotal: 4 }), { intranetKaynak: 'ad-kalibi', intranetRapor: null }));
    const { unmount } = render(<NginxSpaSummary tier="intranet" />);
    expect(await tamamKutusu()).toBe('1/ 4kurulumu tamam olan uygulama');
    expect(screen.queryByText(/\(ad kalıbı\)/)).toBeNull();
    expect(screen.queryByText(/^Kaynak: Gerçek SPA Keşfi/)).toBeNull();
    unmount();
    mockCov.mockResolvedValue(cov(satir(), {
      intranetRapor: { kesifTarihi: null, dizinTarihi: null, dizinDurum: 'var', taranmayanSunucu: ['GBNGXAP50'], platformDisi: [{ platform: 'wyden', uygulama: 3, clusters: ['giocp3rdwyprod1'] }], ortamsiz: 2 },
    }));
    render(<NginxSpaSummary tier="intranet" />);
    expect(await screen.findByText(/ARK dışı cluster’lardaki intranet SPA’lar iki ekranda da sayılmaz: wyden 3\./)).toBeTruthy();
    expect(screen.getByText(/Namespace’i ortam eki taşımayan 2 intranet SPA/)).toBeTruthy();
    expect(screen.getByText(/satırı olmayan sunucular: GBNGXAP50/)).toBeTruthy();
  });
});
