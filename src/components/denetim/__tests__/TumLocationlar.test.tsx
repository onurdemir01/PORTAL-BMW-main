// src/components/denetim/__tests__/TumLocationlar.test.tsx
//
// Production SPA Taşımaları > "Tüm location'lar" (2026-10-18). Kullanıcı: "SPA kuralı arama,
// direkt ne kadar location var ve hangileri yoksa hepsini bana göster; isim standardına uymayıp
// taşımadıklarımız çok büyük problem oluyor."
//   TLU1 varsayılan görünüm yalnız yeni sunucularda YOK / KISMEN olanlar; ad kalıbına uymayan
//        location da orada (sınıf rozeti ile), tanımlı olan görünmez
//   TLU2 sayım: toplam, eksik ve "ad kalıbına uymadığı için uygulama tablosunda görünmeyen"
//   TLU3 kısmen tanımlıda HANGİ yeni sunucuda eksik olduğu yazar
//   TLU4 "hepsi" süzgeci tanımlıyı da gösterir; sınıf süzgeci ve arama daraltır
//   TLU5 CSV satırları görünen satırlardan, eksik sunucular dahil
//   TLU6 taranmamış location'da eksik sunucu UYDURULMAZ
// İkinci kaynak nginx -T (kullanıcı, aynı gün: "/consent-mng/, /domestic-trf/ tanımları var ama
// ekrana yansımıyor"):
//   TLU7 yalnız nginx -T'nin gördüğü location "config taramasında yok" rozetiyle; kaynak süzgeci
//   TLU8 yalnız yeni sunucularda olan location: varsayılan görünümde ve sayımda YOK, kendi
//        süzgecinde var; eski sunucu / yük "—"
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import {
  TumLocationlar,
  suzLocationlar,
  tumLocCsvSatirlari,
  TUM_LOC_CSV_BASLIK,
} from '@/components/denetim/TumLocationlar';
import type { NginxMigrationGroup, NginxMigrationLocation } from '@/api/denetimApi';

const L = (o: Partial<NginxMigrationLocation> & { location: string }): NginxMigrationLocation => ({
  service: 'GLOMO',
  oldHosts: ['GBRVPP07', 'GBRVPP08'],
  targets: [],
  written: [],
  siniflar: ['spa'],
  apps: [],
  kaynaklar: ['config'],
  davranislar: [],
  eskide: true,
  newHosts: [],
  newStatus: 'none',
  traffic: null,
  ...o,
});

const LOCS: NginxMigrationLocation[] = [
  L({ location: '/standartsiz/', siniflar: ['spa-disi'], targets: ['webforms-ui-glomo-prod.apps.x'], apps: ['glomo-prod/webforms-ui'] }),
  L({ location: '/yarim/', newStatus: 'partial', newHosts: ['GBNGXP40'], targets: ['yarim-app-v1-glomo-prod.apps.x'] }),
  L({ location: '/inc/', siniflar: ['include'], targets: ['inc-app-v1-glomo-prod'] }),
  L({ location: '/tam/', newStatus: 'defined', newHosts: ['GBNGXP40', 'GBNGXP41'] }),
];

function grup(locations: NginxMigrationLocation[] = LOCS): NginxMigrationGroup {
  return {
    id: 'glomo',
    label: 'GLOMO',
    locations,
    oldHosts: ['GBRVPP07', 'GBRVPP08'],
    newHosts: ['GBNGXP40', 'GBNGXP41'],
    newHostsScanned: ['GBNGXP40', 'GBNGXP41'],
    oldHostsSeen: ['GBRVPP07', 'GBRVPP08'],
    serviceLocations: [],
    apps: [],
    nonSpa: [],
    unresolved: [],
    totals: {
      apps: 0, ready: 0, partial: 0, missing: 0, notScanned: 0, nonSpa: 0, unresolved: 0,
      locations: { total: 4, defined: 1, partial: 1, none: 2, notScanned: 0 },
    },
  };
}

const satirlar = () => {
  const tablo = screen.getByRole('table');
  return within(tablo).getAllByRole('row').slice(1);
};

describe("Tüm location'lar", () => {
  it('TLU1 varsayılan: yalnız YOK/KISMEN; ad kalıbına uymayan dahil, tanımlı yok', () => {
    render(<TumLocationlar g={grup()} />);
    const metin = satirlar().map((r) => r.textContent || '');
    expect(metin).toHaveLength(3);
    expect(metin.some((t) => t.includes('/standartsiz/') && t.includes('ad kalıbına uymuyor'))).toBe(true);
    expect(metin.some((t) => t.includes('/inc/') && t.includes('eski sunucuda include'))).toBe(true);
    expect(metin.some((t) => t.includes('/tam/'))).toBe(false);
  });

  it('TLU2 sayım: toplam, eksik, ad kalıbı yüzünden uygulama tablosunda olmayan', () => {
    render(<TumLocationlar g={grup()} />);
    const ozet = screen.getByTestId('tum-loc-ozet').textContent || '';
    expect(ozet).toMatch(/Eski sunucularda 4 location; 3 tanesi yeni sunucularda yok ya da eksik/);
    expect(ozet).toMatch(/\(2 tanesi uygulama tablosunda hiç görünmüyor\)/);
    expect(ozet).not.toMatch(/nginx -T/);
  });

  it('TLU3 kısmen tanımlıda eksik yeni sunucu adı yazar', () => {
    render(<TumLocationlar g={grup()} />);
    const yarim = satirlar().find((r) => (r.textContent || '').includes('/yarim/'));
    expect(yarim?.textContent).toMatch(/1\/2/);
    expect(yarim?.textContent).toMatch(/eksik: GBNGXP41/);
    expect(yarim?.textContent).not.toMatch(/eksik: GBNGXP40/);
  });

  it('TLU4 hepsi / sınıf / arama süzgeçleri', () => {
    render(<TumLocationlar g={grup()} />);
    fireEvent.change(screen.getByLabelText('Yeni sunucudaki duruma göre süz'), { target: { value: 'all' } });
    expect(satirlar()).toHaveLength(4);
    fireEvent.change(screen.getByLabelText('Sınıfa göre süz'), { target: { value: 'spa-disi' } });
    expect(satirlar().map((r) => r.textContent)).toEqual([expect.stringContaining('/standartsiz/')]);
    fireEvent.change(screen.getByLabelText('Sınıfa göre süz'), { target: { value: 'all' } });
    // Hedef adinda (location'da DEGIL) arama: ad kalibina uymayan uygulamayi hedefinden bulmak
    fireEvent.change(screen.getByLabelText('Location ara'), { target: { value: 'webforms-ui-glomo' } });
    expect(satirlar().map((r) => r.textContent)).toEqual([expect.stringContaining('/standartsiz/')]);
    expect(suzLocationlar(LOCS, 'all', 'all', 'apps.x').map((l) => l.location)).toEqual(['/standartsiz/', '/yarim/']);
    expect(suzLocationlar(LOCS, 'all', 'all', 'glomo-prod/webforms').map((l) => l.location)).toEqual(['/standartsiz/']);
    expect(suzLocationlar(LOCS, 'defined', 'all', '').map((l) => l.location)).toEqual(['/tam/']);
  });

  it('TLU5 CSV: görünen satırlar, eksik sunucular dahil', () => {
    const rows = tumLocCsvSatirlari(grup(), suzLocationlar(LOCS, 'eksik', 'all', ''));
    expect(rows).toHaveLength(3);
    const i = (k: (typeof TUM_LOC_CSV_BASLIK)[number]) => TUM_LOC_CSV_BASLIK.indexOf(k);
    const yarim = rows.find((r) => r[i('location')] === '/yarim/')!;
    expect(yarim[i('yeni_sunucularda')]).toBe('KISMEN');
    expect(yarim[i('eksik_yeni_sunucular')]).toBe('GBNGXP41');
    expect(yarim[i('vhost')]).toBe('GLOMO-PROD.conf');
    const std = rows.find((r) => r[i('location')] === '/standartsiz/')!;
    expect(std[i('sinif')]).toBe('ad kalıbına uymuyor');
    expect(std[i('eksik_yeni_sunucular')]).toBe('GBNGXP40 GBNGXP41');
    expect(rows[0]).toHaveLength(TUM_LOC_CSV_BASLIK.length);
  });

  it('TLU6 taranmamış location: eksik sunucu uydurulmaz', () => {
    const t = L({ location: '/bilinmez/', newStatus: 'not-scanned' });
    const [row] = tumLocCsvSatirlari(grup([t]), [t]);
    expect(row[TUM_LOC_CSV_BASLIK.indexOf('eksik_yeni_sunucular')]).toBe('');
    render(<TumLocationlar g={grup([t])} />);
    fireEvent.change(screen.getByLabelText('Yeni sunucudaki duruma göre süz'), { target: { value: 'not-scanned' } });
    expect(satirlar()[0].textContent).toMatch(/TARANMADI/);
    expect(satirlar()[0].textContent).not.toMatch(/eksik:/);
  });

  it('TLU7 yalnız nginx -T: rozet, sayım ve kaynak süzgeci', () => {
    const consent = L({
      location: '/consent-mng/',
      siniflar: ['spa-disi'],
      kaynaklar: ['nginx-T'],
      davranislar: ['proxy'],
      targets: ['consent-mng-api-glomo-prod.apps.x'],
      written: ['consent-ups'],
    });
    const statik = L({ location: '= /robots.txt', siniflar: ['statik'], kaynaklar: ['nginx-T'], davranislar: ['static'] });
    // SPA ama config taramasi gormedi: uygulama tablosu config'ten kuruldugu icin orada da YOK
    const gizli = L({ location: '/gizli-spa/', siniflar: ['spa'], kaynaklar: ['nginx-T'], davranislar: ['proxy'] });
    render(<TumLocationlar g={grup([...LOCS, consent, statik, gizli])} kaynakTarihleri={{ config: '2026-10-17', nginxT: '2026-10-18' }} />);
    const satir = satirlar().find((r) => (r.textContent || '').includes('/consent-mng/'));
    expect(satir?.textContent).toMatch(/config taramasında yok/);
    expect(satir?.textContent).toMatch(/yazım: consent-ups/);
    const yarim = satirlar().find((r) => (r.textContent || '').includes('/yarim/'));
    expect(yarim?.textContent).not.toMatch(/config taramasında yok/);
    const ozet = screen.getByTestId('tum-loc-ozet').textContent || '';
    expect(ozet).toMatch(/Eski sunucularda 7 location; 6 tanesi/);
    expect(ozet).toMatch(/\(5 tanesi uygulama tablosunda hiç görünmüyor\)/);
    expect(ozet).toMatch(/3 location yalnız nginx -T taramasında görünüyor/);
    fireEvent.change(screen.getByLabelText('Kaynağa göre süz'), { target: { value: 'yalniz-nginx-T' } });
    expect(satirlar().map((r) => r.textContent)).toEqual([
      expect.stringContaining('/consent-mng/'),
      expect.stringContaining('= /robots.txt'),
      expect.stringContaining('/gizli-spa/'),
    ]);
    expect(screen.getByText(/nginx -T taraması \(2026-10-18\)/)).toBeTruthy();
    const csv = tumLocCsvSatirlari(grup(), [consent]);
    expect(csv[0][TUM_LOC_CSV_BASLIK.indexOf('kaynak')]).toBe('nginx-T');
  });

  it('TLU8 yalnız yeni sunucularda olan location', () => {
    const yeni = L({ location: '/yeni-eklenen/', eskide: false, oldHosts: [], kaynaklar: [], siniflar: [], newStatus: 'partial', newHosts: ['GBNGXP40'] });
    render(<TumLocationlar g={grup([...LOCS, yeni])} />);
    expect(satirlar().some((r) => (r.textContent || '').includes('/yeni-eklenen/'))).toBe(false);
    expect(screen.getByTestId('tum-loc-ozet').textContent).toMatch(/Eski sunucularda 4 location; 3 tanesi/);
    fireEvent.change(screen.getByLabelText('Yeni sunucudaki duruma göre süz'), { target: { value: 'partial' } });
    expect(satirlar().map((r) => r.textContent)).toEqual([expect.stringContaining('/yarim/')]);
    fireEvent.change(screen.getByLabelText('Yeni sunucudaki duruma göre süz'), { target: { value: 'yalniz-yeni' } });
    const [r] = satirlar();
    expect(satirlar()).toHaveLength(1);
    expect(r.textContent).toMatch(/\/yeni-eklenen\//);
    expect(r.textContent).toMatch(/yalnız yeni sunucularda/);
    expect(r.textContent).not.toMatch(/ölçüm yok/);
    expect(screen.queryByText(/nginx -T taraması okunamadı/)).toBeNull();
  });

  it('TLU9 nginx -T taraması yoksa ekran söyler', () => {
    render(<TumLocationlar g={grup()} kaynakTarihleri={{ config: '2026-10-17', nginxT: null }} />);
    expect(screen.getByText(/nginx -T taraması okunamadı/)).toBeTruthy();
  });

  it('TLU10 nginx -T tarihi olsa da detail sorgusu başarısızsa ekran uyarır', () => {
    render(
      <TumLocationlar
        g={grup()}
        kaynakTarihleri={{ config: '2026-10-17', nginxT: '2026-10-18' }}
        nginxTHazir={false}
      />,
    );
    expect(screen.getByText(/nginx -T taraması okunamadı/)).toBeTruthy();
  });
});
