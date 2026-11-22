// src/components/app_hub/__tests__/jvm-karsilastir.test.tsx — Toplu JVM argümanı karşılaştırması (2026-11-16).
//   JKU1 Application Hub girişi: Admin'de "Toplu JVM argümanı karşılaştır" var, Admin değilse yok
//   JKU2 sayfa Admin değilse API çağrılmaz, sonuç gösterilmez
//   JKU3 URL'deki liste açılışta karşılaştırılır; özet satırı + uygulama/nesil satırları + durum rozeti
//   JKU4 satır açılınca fark ayrıntısı: argüman | çoğunluk değeri | sapan sunucu ve değeri; eksik/fazla
//   JKU5 form: virgül/boşluk/satır ayrılır, tekrar atılır; URL'e yazılır; 21 ad düğmeyi kapatır; geçersiz ad uyarısı
//   JKU6 belirsiz sapan çoğunluk yazmaz; kesik metin 'karşılaştırılamadı' ve 'kesik metin' notu; URL'deki tanınmayan ortam Production
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor, within } from '@testing-library/react';
import { Routes, Route, useLocation } from 'react-router-dom';
import { render } from '@/test/test-utils';
import AppHubPage from '@/components/app_hub/AppHubPage';
import JvmKarsilastirPage, { adlariAyir } from '@/components/app_hub/JvmKarsilastirPage';

const kimlik = vi.hoisted(() => ({ role: 'Admin' }));
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: { username: 'onur', role: kimlik.role }, canViewPage: () => true }),
}));
const api = vi.hoisted(() => ({ karsilastir: vi.fn() }));
vi.mock('@/api/appHubJvmKarsilastirApi', async (orig) => ({
  ...(await orig<object>()),
  jvmKarsilastirApi: { karsilastir: api.karsilastir },
}));
vi.mock('@/api/appHubApi', () => ({
  appHubApi: { detay: vi.fn(), ara: vi.fn().mockResolvedValue({ sonuclar: [] }) },
}));
vi.mock('@/api/retirementApi', () => ({ retirementApi: { config: vi.fn() } }));
vi.mock('@/components/server_hub/RetirementTab', () => ({ CreateModal: () => null }));
vi.mock('@/components/app_hub/AramaKutusu', () => ({ default: () => null }));

const bosGrup = {
  uyarilar: [],
  neden: null,
  sunucuyaOzgu: [],
  maskeli: [],
  karsilastirilamadi: [],
  esitSayisi: 3,
  olculenJvm: 3,
};
const yanit = {
  ortam: 'PROD',
  nesil: 'hepsi',
  okundu: '2026-11-16T10:00:00Z',
  ozet: { toplam: 3, ESIT: 1, FARKLI: 1, TEK_SUNUCU: 0, OLCULEMEDI: 0, BULUNAMADI: 1 },
  uygulamalar: [
    {
      ad: 'MUSTERI',
      tabanAd: 'MUSTERI',
      durum: 'FARKLI',
      neden: null,
      sunucuSayisi: 3,
      jvmSayisi: 3,
      farkSayisi: 2,
      uyarilar: [],
      gruplar: [
        {
          ...bosGrup,
          ortam: 'PROD',
          nesil: 8,
          durum: 'FARKLI',
          sunucuSayisi: 3,
          jvmSayisi: 3,
          farkSayisi: 2,
          jvmler: [
            {
              etiket: 'GOJBAP01/MUSTERI',
              host: 'GOJBAP01',
              jvm: 'MUSTERI',
              kaynak: 'CALISAN',
              calisiyor: true,
              taze: true,
              taramaTarihi: null,
              olculdu: true,
              kesik: false,
            },
          ],
          degerFarklari: [
            {
              anahtar: '-Xmx',
              cogunluk: '2g',
              cogunlukUyeler: ['GOJBAP01/MUSTERI', 'GOJBAP02/MUSTERI'],
              degerler: [],
              sapanlar: [{ uye: 'GOJBAP03/MUSTERI', deger: '4g', normal: '4g' }],
              belirsiz: false,
            },
          ],
          eksikFazla: [
            {
              anahtar: '-Dozel.ayar',
              olan: ['GOJBAP03/MUSTERI'],
              olmayan: ['GOJBAP01/MUSTERI', 'GOJBAP02/MUSTERI'],
              kesikte: [],
              degerler: [{ uye: 'GOJBAP03/MUSTERI', deger: 'acik' }],
              cogunlukta: false,
            },
          ],
          sunucuyaOzgu: [{ anahtar: '-Djboss.node.name', degerler: [], normal: null }],
        },
      ],
    },
    {
      ad: 'KREDI',
      tabanAd: 'KREDI',
      durum: 'ESIT',
      neden: null,
      sunucuSayisi: 2,
      jvmSayisi: 2,
      farkSayisi: 0,
      uyarilar: [],
      gruplar: [
        {
          ...bosGrup,
          ortam: 'PROD',
          nesil: 7,
          durum: 'ESIT',
          sunucuSayisi: 2,
          jvmSayisi: 2,
          farkSayisi: 0,
          jvmler: [],
          degerFarklari: [],
          eksikFazla: [],
        },
      ],
    },
    {
      ad: 'YOKAPP',
      tabanAd: null,
      durum: 'BULUNAMADI',
      neden: 'Envanterde JBoss uygulaması olarak bulunamadı.',
      sunucuSayisi: 0,
      jvmSayisi: 0,
      farkSayisi: 0,
      uyarilar: [],
      gruplar: [],
    },
  ],
};

function KonumYaz() {
  const l = useLocation();
  return <span data-testid="konum">{`${l.pathname}${l.search}`}</span>;
}
const konum = () => screen.getByTestId('konum').textContent;
function sayfa(adres: string) {
  return render(
    <Routes>
      <Route
        path="/application-hub/jvm-karsilastir"
        element={
          <>
            <JvmKarsilastirPage />
            <KonumYaz />
          </>
        }
      />
      <Route
        path="/application-hub"
        element={
          <>
            <AppHubPage />
            <KonumYaz />
          </>
        }
      />
    </Routes>,
    { initialEntries: [adres] },
  );
}

describe('Application Hub — toplu JVM argümanı karşılaştırması', () => {
  beforeEach(() => {
    kimlik.role = 'Admin';
    api.karsilastir.mockReset().mockResolvedValue(yanit);
  });

  it('JKU1 giriş düğmesi yalnız Admin’de', async () => {
    const { unmount } = sayfa('/application-hub');
    fireEvent.click(await screen.findByRole('button', { name: /Toplu JVM argümanı karşılaştır/ }));
    await waitFor(() => expect(konum()).toBe('/application-hub/jvm-karsilastir'));
    unmount();
    kimlik.role = 'User';
    sayfa('/application-hub');
    await screen.findByText(/Uygulamanız ne ve nerede olursa olsun/);
    expect(screen.queryByRole('button', { name: /Toplu JVM/ })).toBeNull();
  });

  it('JKU2 Admin değilse sayfa API çağırmaz', async () => {
    kimlik.role = 'User';
    sayfa('/application-hub/jvm-karsilastir?uygulamalar=MUSTERI');
    expect(await screen.findByText(/yalnız Admin rolüne açıktır/)).toBeTruthy();
    await new Promise((r) => setTimeout(r, 20));
    expect(api.karsilastir).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: /Karşılaştır/ })).toBeNull();
  });

  it('JKU3 URL listesi açılışta karşılaştırılır; özet ve satırlar', async () => {
    sayfa(
      '/application-hub/jvm-karsilastir?uygulamalar=MUSTERI,KREDI,YOKAPP&ortam=PROD&nesil=hepsi',
    );
    const ozet = await screen.findByTestId('karsilastirma-ozeti');
    expect(ozet.textContent).toContain('3 uygulama:');
    expect(ozet.textContent).toContain('1 eşit, 1 farklı, 0 tek sunucu, 1 ölçülemedi/bulunamadı');
    expect(api.karsilastir).toHaveBeenCalledWith(
      { uygulamalar: ['MUSTERI', 'KREDI', 'YOKAPP'], ortam: 'PROD', nesil: 'hepsi' },
      expect.anything(),
    );
    const satirlar = screen.getAllByTestId('karsilastirma-satiri');
    expect(satirlar).toHaveLength(3);
    expect(within(satirlar[0]).getByText('Farklı')).toBeTruthy();
    expect(within(satirlar[0]).getByText('JBoss 8')).toBeTruthy();
    expect(within(satirlar[0]).getByText('3 / 3')).toBeTruthy();
    expect(within(satirlar[1]).getByText('Eşit')).toBeTruthy();
    expect(within(satirlar[2]).getByText('Bulunamadı')).toBeTruthy();
    expect(within(satirlar[2]).getByText(/Envanterde JBoss/)).toBeTruthy();
    expect((screen.getByLabelText(/Uygulamalar/) as HTMLTextAreaElement).value).toBe(
      'MUSTERI\nKREDI\nYOKAPP',
    );
    expect(screen.queryByTestId('fark-ayrintisi')).toBeNull();
  });

  it('JKU4 satır açılınca fark ayrıntısı', async () => {
    sayfa('/application-hub/jvm-karsilastir?uygulamalar=MUSTERI');
    fireEvent.click(await screen.findByRole('button', { name: 'MUSTERI ayrıntısı' }));
    const a = screen.getByTestId('fark-ayrintisi');
    expect(within(a).getByText('-Xmx')).toBeTruthy();
    expect(within(a).getByText('2g')).toBeTruthy();
    expect(within(a).getByText('4g')).toBeTruthy();
    expect(within(a).getAllByText('GOJBAP03/MUSTERI').length).toBeGreaterThan(0);
    expect(within(a).getByText('-Dozel.ayar')).toBeTruthy();
    expect(within(a).getByText(/azınlıkta · fazla/)).toBeTruthy();
    expect(within(a).getByText(/Sunucuya özgü \(1, eşitsizlik sayılmadı\)/)).toBeTruthy();
    // salt okunur: düzeltme / uygulama düğmesi yok
    expect(within(a).queryByRole('button')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'MUSTERI ayrıntısı' }));
    expect(screen.queryByTestId('fark-ayrintisi')).toBeNull();
  });

  it('JKU5 form: ayrıştırma, URL, tavan ve geçersiz ad', async () => {
    expect(adlariAyir('a, b;c\nA  d')).toEqual(['a', 'b', 'c', 'd']);
    sayfa('/application-hub/jvm-karsilastir');
    const kutu = screen.getByLabelText(/Uygulamalar/);
    const dugme = screen.getByRole('button', { name: /Karşılaştır/ });
    expect(api.karsilastir).not.toHaveBeenCalled();
    fireEvent.change(kutu, {
      target: { value: Array.from({ length: 21 }, (_, i) => `APP${i}`).join(',') },
    });
    expect((dugme as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/21 \/ 20 uygulama/)).toBeTruthy();
    fireEvent.change(kutu, { target: { value: 'MUSTERI a;b' } });
    fireEvent.change(kutu, { target: { value: 'MUSTERI kre$di' } });
    expect(screen.getByRole('alert').textContent).toContain('kre$di');
    expect((dugme as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(kutu, { target: { value: 'MUSTERI, KREDI\nmusteri' } });
    fireEvent.change(screen.getByLabelText(/^Nesil/), { target: { value: '8' } });
    fireEvent.click(dugme);
    await screen.findByTestId('karsilastirma-ozeti');
    expect(api.karsilastir).toHaveBeenCalledWith(
      { uygulamalar: ['MUSTERI', 'KREDI'], ortam: 'PROD', nesil: 8 },
      expect.anything(),
    );
    expect(konum()).toBe(
      '/application-hub/jvm-karsilastir?uygulamalar=MUSTERI%2CKREDI&ortam=PROD&nesil=8',
    );
  });

  it('JKU6 belirsiz sapan, kesik metin ve tanınmayan ortam', async () => {
    const g = yanit.uygulamalar[0].gruplar[0];
    api.karsilastir.mockResolvedValue({
      ...yanit,
      uygulamalar: [
        {
          ...yanit.uygulamalar[0],
          gruplar: [
            {
              ...g,
              jvmler: [{ ...g.jvmler[0], kesik: true }],
              degerFarklari: [
                {
                  anahtar: '-Dmaster',
                  cogunluk: null,
                  cogunlukUyeler: [],
                  degerler: [],
                  belirsiz: true,
                  sapanlar: [{ uye: 'GOJBAP02/MUSTERI', deger: 'GOJBAP01', normal: 'GOJBAP01' }],
                },
              ],
              eksikFazla: [],
              karsilastirilamadi: [{ anahtar: '-Dkesilen', kesik: ['GOJBAP01/MUSTERI'] }],
            },
          ],
        },
      ],
    });
    sayfa('/application-hub/jvm-karsilastir?uygulamalar=MUSTERI&ortam=PRP');
    fireEvent.click(await screen.findByRole('button', { name: 'MUSTERI ayrıntısı' }));
    expect(api.karsilastir).toHaveBeenCalledWith(
      { uygulamalar: ['MUSTERI'], ortam: 'PROD', nesil: 'hepsi' },
      expect.anything(),
    );
    expect((screen.getByLabelText(/^Ortam/) as HTMLSelectElement).value).toBe('PROD');
    const a = screen.getByTestId('fark-ayrintisi');
    expect(
      within(a).getByText(/Belirsiz: değer bazı sunucularda kendi adını taşıyor/),
    ).toBeTruthy();
    expect(within(a).getByText(/Karşılaştırılamadı \(1,/).textContent).toContain('-Dkesilen');
    expect(within(a).getByText(/kesik metin/)).toBeTruthy();
  });
});
