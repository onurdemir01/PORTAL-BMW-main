// src/components/denetim/__tests__/InitSunucuGeneli.test.tsx
//
// Denetim > Init Scripts (kullanici, 2026-11-16): "/vhosting ile /vhosting8 sayfalarinda
// appdomain.service'ler neden farkli gozukuyor? appdomain.service her sunucuda 1 tane zaten."
// Kilitlenen davranis:
//   - "Sunucu geneli: appdomain.service" bolumu kok seciminin USTUNDE gorunur;
//   - kok sekmesi degisince bolum AYNI kalir (sayilar, referans), kok tablosunda appdomain yok;
//   - sunucu basina tek satir; iki kok farkliysa satirda bilgi notu; "Sadece farki olanlar";
//   - GBEVM / GBPRV ayri secilir.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, within } from '@testing-library/react';
import { render } from '@/test/test-utils';
import DenetimPage from '@/components/DenetimPage';
import type {
  InitScriptsResult,
  InitSunucuGeneli,
  InitSunucuGeneliBlock,
  InitSunucuGeneliRow,
} from '@/api/denetimApi';

vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ canSee: () => true }) }));
const mockInit = vi.hoisted(() => vi.fn());
vi.mock('@/api/denetimApi', async (orijinal) => {
  const gercek = (await orijinal()) as Record<string, unknown>;
  return { ...gercek, denetimApi: { ...(gercek.denetimApi as object), initScripts: mockInit } };
});

const H = (c: string) => c.repeat(128);
const satir = (host: string, durum: InitSunucuGeneliRow['durum'], extra: Partial<InitSunucuGeneliRow> = {}): InitSunucuGeneliRow => ({
  host,
  durum,
  hash: durum === 'yok' ? null : H(durum === 'farkli' ? 'b' : 'a'),
  norm: null,
  kaynak: 'vhosting8',
  tarih: null,
  kokler: ['vhosting', 'vhosting8'],
  kokFarki: null,
  digerKaynak: 'vhosting',
  digerHash: null,
  ...extra,
});
const blok = (rows: InitSunucuGeneliRow[]): InitSunucuGeneliBlock => {
  const say = (d: InitSunucuGeneliRow['durum']) => rows.filter((r) => r.durum === d).length;
  return {
    key: 'appdomain_service',
    label: 'appdomain.service',
    perServer: false,
    hostWide: true,
    present: rows.filter((r) => r.hash).length,
    missing: say('yok'),
    missingHosts: rows.filter((r) => r.durum === 'yok').map((r) => r.host),
    variantCount: 2,
    majorityHash: H('a'),
    majorityCount: say('ayni'),
    deviatingCount: say('farkli'),
    variants: [],
    referenceSource: 'ekip',
    referenceHash: H('a'),
    referenceNorm: H('n'),
    rows,
    sayilar: {
      hosts: rows.length,
      ayni: say('ayni'),
      bicim: say('bicim'),
      farkli: say('farkli'),
      yok: say('yok'),
      okunamadi: say('okunamadi'),
      kokFarki: rows.filter((r) => r.kokFarki).length,
    },
  };
};
const SG: InitSunucuGeneli = {
  files: [
    {
      ...blok([
        satir('GBAPP01', 'ayni'),
        satir('GBAPP02', 'ayni'),
        satir('GBAPP03', 'farkli', {
          kokFarki: 'icerik',
          kaynak: 'vhosting',
          digerKaynak: 'vhosting8',
          digerHash: H('a'),
        }),
        satir('GBAPP04', 'yok', { kokler: ['vhosting'], digerKaynak: null }),
      ]),
      special: blok([satir('GBEVM01', 'farkli')]),
    },
  ],
  detailAvailable: true,
  teamReferenceAvailable: true,
  error: null,
};
const kok = (root: string, script: string): InitScriptsResult => ({
  ok: true,
  root,
  roots: ['vhosting', 'vhosting8'],
  hosts: 2,
  scriptCount: 1,
  identicalHosts: 2,
  totalVariants: 1,
  customHosts: 0,
  missingColumns: [],
  scripts: [
    {
      key: script.replace('.', '_'),
      label: script,
      perServer: false,
      present: 2,
      missing: 0,
      missingHosts: [],
      variantCount: 1,
      majorityHash: H('s'),
      majorityCount: 2,
      deviatingCount: 0,
      variants: [],
    },
  ],
  hostRows: [],
  sunucuGeneli: SG,
});

const bolum = () => screen.getByRole('region', { name: 'Sunucu geneli: appdomain.service' });
const sayilar = () =>
  within(bolum())
    .getAllByText(/^(sunucu \(tek satır\)|aynı|farklı|iki kök farklı \(bilgi\))$/)
    .map((el) => `${el.previousElementSibling?.textContent}:${el.textContent}`);

describe('Denetim > Init Scripts — sunucu geneli bölüm', () => {
  beforeEach(() => {
    mockInit.mockReset();
    mockInit.mockImplementation((root: string) =>
      Promise.resolve(kok(root, root === 'vhosting8' ? 'startJboss8.sh' : 'start.sh')),
    );
  });

  it('bölüm kök seçiminin üstünde görünür ve kök değişince aynı kalır', async () => {
    render(<DenetimPage />, { initialEntries: ['/denetim?tab=init'] });
    await screen.findByText('start.sh');
    expect(bolum()).toBeInTheDocument();
    const once = sayilar();
    expect(once).toEqual([
      '4:sunucu (tek satır)',
      '2:aynı',
      '1:farklı',
      '1:iki kök farklı (bilgi)',
    ]);
    // Bolum kok seciminden (select) ONCE gelir.
    const select = screen.getByDisplayValue('/vhosting');
    expect(bolum().compareDocumentPosition(select) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // Kok tablosunda appdomain.service satiri yok
    expect(screen.queryByRole('row', { name: /appdomain\.service/ })).toBeNull();

    fireEvent.change(select, { target: { value: 'vhosting8' } });
    await screen.findByText('startJboss8.sh');
    expect(mockInit).toHaveBeenLastCalledWith('vhosting8');
    expect(sayilar()).toEqual(once);
    expect(screen.queryByText('start.sh')).toBeNull();
  });

  it('sunucu başına tek satır, iki kök farkı notu, "Sadece farkı olanlar" ve GBEVM/GBPRV', async () => {
    render(<DenetimPage />, { initialEntries: ['/denetim?tab=init'] });
    await screen.findByText('start.sh');
    const b = bolum();
    expect(within(b).queryByText('GBAPP01')).toBeNull();
    fireEvent.click(within(b).getByRole('button', { name: 'Sunucuları göster (4)' }));
    for (const h of ['GBAPP01', 'GBAPP02', 'GBAPP03', 'GBAPP04']) {
      expect(within(b).getAllByText(h)).toHaveLength(1);
    }
    expect(
      within(b).getByText('iki kök farklı (içerik farklı) — /vhosting kaydı kullanıldı'),
    ).toBeInTheDocument();
    expect(within(b).getByText('referans: ekip sürümü (depo)')).toBeInTheDocument();

    fireEvent.click(within(b).getByLabelText('Sadece farkı olanlar'));
    expect(within(b).queryByText('GBAPP01')).toBeNull();
    expect(within(b).getByText('GBAPP03')).toBeInTheDocument();
    expect(within(b).getByText('GBAPP04')).toBeInTheDocument();

    fireEvent.change(within(b).getByLabelText('Sunucu geneli: sunucu ara'), {
      target: { value: 'app04' },
    });
    expect(within(b).queryByText('GBAPP03')).toBeNull();

    fireEvent.click(within(b).getByRole('button', { name: 'GBEVM / GBPRV · 1' }));
    fireEvent.change(within(b).getByLabelText('Sunucu geneli: sunucu ara'), {
      target: { value: '' },
    });
    expect(within(b).getByText('GBEVM01')).toBeInTheDocument();
    expect(within(b).queryByText('GBAPP04')).toBeNull();
  });

  it('geniş tablolar okunamadı (files boş + error): "hesaplandı" denmez, okunamadı denir', async () => {
    mockInit.mockImplementation((root: string) =>
      Promise.resolve({
        ...kok(root, 'start.sh'),
        sunucuGeneli: {
          files: [],
          detailAvailable: false,
          teamReferenceAvailable: false,
          missingColumns: [],
          error: 'baglanti koptu',
        },
      }),
    );
    render(<DenetimPage />, { initialEntries: ['/denetim?tab=init'] });
    await screen.findByText('start.sh');
    expect(
      screen.getByText(
        'Sunucu geneli bölüm okunamadı (baglanti koptu); appdomain.service bu kez gösterilemiyor.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/ham hash ve çoğunlukla hesaplandı/)).toBeNull();
    expect(screen.queryByRole('region', { name: /Sunucu geneli/ })).toBeNull();
  });

  it('ayrıntı okunamadı ama bölüm hesaplandı: eski yol notu; kök bazında eksik sütun notu', async () => {
    mockInit.mockImplementation((root: string) =>
      Promise.resolve({
        ...kok(root, 'start.sh'),
        sunucuGeneli: {
          ...SG,
          error: 'ayrinti dustu',
          missingColumns: [{ root: 'vhosting8', label: 'appdomain.service' }],
        },
      }),
    );
    render(<DenetimPage />, { initialEntries: ['/denetim?tab=init'] });
    await screen.findByText('start.sh');
    expect(screen.getByText(/ayrıntı\/referans tabloları okunamadı \(ayrinti dustu\)/)).toBeInTheDocument();
    expect(screen.queryByText(/Sunucu geneli bölüm okunamadı/)).toBeNull();
    expect(screen.getByText('/vhosting8 → appdomain.service')).toBeInTheDocument();
    expect(bolum()).toBeInTheDocument();
  });

  it('eski sunucu (sunucuGeneli alanı yok): bölüm çizilmez', async () => {
    mockInit.mockImplementation((root: string) => {
      const r = kok(root, 'start.sh');
      delete r.sunucuGeneli;
      return Promise.resolve(r);
    });
    render(<DenetimPage />, { initialEntries: ['/denetim?tab=init'] });
    await screen.findByText('start.sh');
    expect(screen.queryByRole('region', { name: /Sunucu geneli/ })).toBeNull();
  });
});
