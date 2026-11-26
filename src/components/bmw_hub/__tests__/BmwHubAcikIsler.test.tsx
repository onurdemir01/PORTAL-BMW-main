// @vitest-environment jsdom
// BMW Hub > Açık İşler (2026-11-26, kapsam PR-2; dal %21): görünümler (açık, benim, geciken, sahipsiz, kapanan, tümü)
// ve sıralama, arama / sahip / öncelik süzgeçleri, pano düzeni (yeni biten iş açık görünümde), satırdan hızlı durum
// (başarı / geri alma), yeni iş (başlık zorunlu, "Ben üstleneyim"), toplu ekleme (önizleme, hatalı satır, tavan),
// iş detayı (değişiklik kaydı, çakışma, not, silme onayı, okunamadı) ve liste yüklenemedi.
import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  liste: vi.fn(),
  detay: vi.fn(),
  ekle: vi.fn(),
  guncelle: vi.fn(),
  notEkle: vi.fn(),
  sil: vi.fn(),
  toplu: vi.fn(),
}));
vi.mock('@/api/bmwHubApi', () => ({ bmwHubApi: api }));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn() }));
vi.mock('@/hooks/useToast', () => ({ toast }));
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: { username: 'admin', displayName: 'Admin' } }),
}));

import BmwHubPage from '../BmwHubPage';

const gunOnce = (g: number) => new Date(Date.now() - g * 86400000).toISOString();
const is = (id: string, ek: Record<string, unknown> = {}) => ({
  id,
  baslik: `Is ${id}`,
  aciklama: '',
  durum: 'acik',
  oncelik: 'orta',
  kategori: 'Otomasyon',
  sahip: '',
  beklenen: '',
  sonTarih: '',
  acanAd: 'Veli',
  olusturma: gunOnce(20),
  guncelleme: gunOnce(1),
  guncelleyenAd: '',
  kapanis: '',
  ...ek,
});
const ISLER = [
  // Tarihsiz ama YUKSEK oncelikli: yine tarihlilerden sonra gelir (tarih onceligi oncelikten once).
  is('i3', { durum: 'bekliyor', oncelik: 'yuksek', baslik: 'Sahipsiz bekleyen' }),
  is('i2', { durum: 'devam', sahip: 'Ayse', sonTarih: '2026-11-20', baslik: 'Ayse devam' }),
  is('i1', {
    oncelik: 'yuksek',
    // Sahip adi kucuk harfle: "benim" eslesmesi harf duyarsiz.
    sahip: 'admin',
    sonTarih: '2026-11-05',
    beklenen: 'DBA onayi',
    kategori: 'JBoss',
    baslik: 'Geciken benim',
    guncelleyenAd: 'Ayse',
  }),
  is('i6', { sahip: 'Ali', sonTarih: '2026-11-11', baslik: 'Bugun bitecek' }),
  is('i4', { durum: 'tamam', sahip: 'Ayse', kapanis: gunOnce(2), baslik: 'Yeni biten' }),
  // Iptal daha yeni guncellenmis: kapananlar guncellemeye degil KAPANISA gore siralanir.
  is('i5', {
    durum: 'iptal',
    kapanis: gunOnce(40),
    guncelleme: gunOnce(0.5),
    baslik: 'Eski iptal',
  }),
  // 14 gunden eski biten: pano "acik" gorunumunde gorunmez. Son tarihi gecikenden ERKEN ama kapali oldugu icin
  // geciken sayilmaz: "Tumu"de geciken yine en ustte.
  is('i7', { durum: 'tamam', kapanis: gunOnce(50), sonTarih: '2026-11-01', baslik: 'Eski biten' }),
  // Tarihsiz, dusuk oncelikli ama EN YENI guncellenmis: oncelik guncellemeden once gelir.
  is('i8', { oncelik: 'dusuk', guncelleme: gunOnce(0.1), baslik: 'Dusuk tarihsiz' }),
];
const LISTE = {
  isler: ISLER,
  ozet: { acik: 4, gecikmis: 1, buHafta: 2, sahipsiz: 1, tamamlanan30: 1 },
  bugun: '2026-11-11',
  tavan: null,
};

function Konum() {
  const l = useLocation();
  return <output data-testid="konum">{l.search}</output>;
}
const ciz = (adres = '/bmw-hub') =>
  render(
    <MemoryRouter initialEntries={[adres]}>
      <Routes>
        <Route
          path="/bmw-hub"
          element={
            <>
              <BmwHubPage />
              <Konum />
            </>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
const satirBasliklari = () =>
  screen
    .getAllByRole('row')
    .slice(1)
    .map((r) => within(r).queryAllByRole('button')[0]?.textContent)
    .filter(Boolean);
const sekme = (ad: string) => fireEvent.click(screen.getByRole('tab', { name: ad }));

beforeEach(() => {
  Object.values(api).forEach((f) => f.mockReset());
  Object.values(toast).forEach((f) => f.mockReset());
  api.liste.mockResolvedValue(LISTE);
});

describe('BMW Hub Açık İşler: liste', () => {
  it('görünümler, sıralama ve süzgeçler', async () => {
    ciz();
    expect(await screen.findByText('Geciken benim')).toBeTruthy();
    // Açık: geciken önce, sonra son tarih sırası, tarihsiz en sonda.
    expect(satirBasliklari()).toEqual([
      'Geciken benim',
      'Bugun bitecek',
      'Ayse devam',
      'Sahipsiz bekleyen',
      'Dusuk tarihsiz',
    ]);
    const geciken = screen.getByText('Geciken benim').closest('tr') as HTMLElement;
    expect(within(geciken).getByText('6 gün gecikti')).toBeTruthy();
    expect(within(geciken).getByText('Ayse')).toBeTruthy();
    expect(
      within(screen.getByText('Bugun bitecek').closest('tr') as HTMLElement).getByText('bugün'),
    ).toBeTruthy();
    expect(
      within(screen.getByText('Ayse devam').closest('tr') as HTMLElement).getByText('9 gün kaldı'),
    ).toBeTruthy();
    expect(
      within(screen.getByText('Sahipsiz bekleyen').closest('tr') as HTMLElement).getByText(
        'sahipsiz',
      ),
    ).toBeTruthy();

    sekme('Benim işlerim');
    expect(satirBasliklari()).toEqual(['Geciken benim']);
    expect(screen.getByTestId('konum').textContent).toBe('?gorunum=benim');
    sekme('Gecikenler');
    expect(satirBasliklari()).toEqual(['Geciken benim']);
    sekme('Sahipsiz');
    expect(satirBasliklari()).toEqual(['Sahipsiz bekleyen', 'Dusuk tarihsiz']);
    sekme('Kapananlar');
    // Kapanış tarihine göre yeniden eskiye.
    expect(satirBasliklari()).toEqual(['Yeni biten', 'Eski iptal', 'Eski biten']);
    sekme('Tümü');
    expect(satirBasliklari()).toHaveLength(8);
    expect(satirBasliklari().slice(0, 2)).toEqual(['Geciken benim', 'Eski biten']);
    sekme('Açık işler');
    expect(screen.getByTestId('konum').textContent).toBe('');

    fireEvent.change(screen.getByLabelText('İşlerde ara'), { target: { value: 'dba' } });
    expect(satirBasliklari()).toEqual(['Geciken benim']);
    fireEvent.change(screen.getByLabelText('İşlerde ara'), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText('Sahibe göre'), { target: { value: 'Ayse' } });
    expect(satirBasliklari()).toEqual(['Ayse devam']);
    fireEvent.change(screen.getByLabelText('Sahibe göre'), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText('Önceliğe göre'), { target: { value: 'yuksek' } });
    expect(satirBasliklari()).toEqual(['Geciken benim', 'Sahipsiz bekleyen']);
    fireEvent.change(screen.getByLabelText('İşlerde ara'), { target: { value: 'yok-boyle-is' } });
    expect(screen.getByText('Bu görünümde iş yok.')).toBeTruthy();
  });

  it('pano düzeni: açık görünümde yeni biten iş de görünür; özet kutuları görünüm seçer', async () => {
    ciz('/bmw-hub?duzen=pano');
    const tamam = await screen.findByRole('region', { name: 'Tamamlandı' });
    expect(within(tamam).getByText('Yeni biten')).toBeTruthy();
    expect(within(tamam).queryByText('Eski iptal')).toBeNull();
    expect(within(tamam).queryByText('Eski biten')).toBeNull();
    const bekliyor = screen.getByRole('region', { name: 'Beklemede' });
    expect(within(bekliyor).getByText('Sahipsiz bekleyen')).toBeTruthy();
    expect(within(bekliyor).getByText('sahipsiz')).toBeTruthy();
    // Kapananlar görünümünde yeni biten iş de, iptal de pano sütunlarına (iptal sütunu yok) düşer.
    fireEvent.click(screen.getByRole('button', { name: /Benim işlerim/, pressed: false }));
    expect(screen.getByTestId('konum').textContent).toContain('gorunum=benim');
    expect(
      within(screen.getByRole('region', { name: 'Açık' })).getByText('Geciken benim'),
    ).toBeTruthy();
    expect(
      within(screen.getByRole('region', { name: 'Devam ediyor' })).getByText('Bu sütunda iş yok.'),
    ).toBeTruthy();
    // Karta tiklamak detayi acar.
    api.detay.mockResolvedValue({ is: ISLER[2], notlar: [] });
    fireEvent.click(screen.getByText('Geciken benim'));
    expect(screen.getByTestId('konum').textContent).toContain('is=i1');
    fireEvent.click(screen.getByRole('button', { name: 'Liste' }));
    expect(screen.getByTestId('konum').textContent).not.toContain('duzen=');
  });

  it('satırdan hızlı durum: başarı, aynı durum, hata geri alır', async () => {
    ciz();
    await screen.findByText('Geciken benim');
    const durum = () =>
      screen.getByLabelText('Durum', { selector: '#bmw-d-i2' }) as HTMLSelectElement;
    fireEvent.change(durum(), { target: { value: 'devam' } });
    expect(api.guncelle).not.toHaveBeenCalled();
    api.guncelle.mockResolvedValueOnce(undefined);
    fireEvent.change(durum(), { target: { value: 'bekliyor' } });
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Durum: Beklemede'));
    expect(api.guncelle).toHaveBeenCalledWith('i2', { durum: 'bekliyor' }, ISLER[1].guncelleme);
    await waitFor(() => expect(api.liste).toHaveBeenCalledTimes(2));
    api.guncelle.mockRejectedValueOnce(new Error('Kayıt değişmiş'));
    api.liste.mockImplementationOnce(() => new Promise(() => {}));
    fireEvent.change(durum(), { target: { value: 'tamam' } });
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Kayıt değişmiş', 8000));
    expect(durum().value).toBe('devam');
  });

  it('liste yüklenemedi: tekrar dene', async () => {
    api.liste.mockRejectedValueOnce(new Error('bmw_hub tablosu yok'));
    ciz();
    expect(await screen.findByText('BMW Hub yüklenemedi')).toBeTruthy();
    expect(screen.getByText('bmw_hub tablosu yok')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Tekrar dene/ }));
    expect(await screen.findByText('Geciken benim')).toBeTruthy();
  });

  it('hiç iş yoksa boş liste metni', async () => {
    api.liste.mockResolvedValue({ ...LISTE, isler: [] });
    ciz();
    expect(await screen.findByText('Henüz iş girilmemiş.')).toBeTruthy();
  });
});

describe('BMW Hub Açık İşler: ekleme', () => {
  it('yeni iş: başlık zorunlu, "Ben üstleneyim", kayıt ve hata', async () => {
    ciz();
    await screen.findByText('Geciken benim');
    fireEvent.click(screen.getByRole('button', { name: /Yeni iş/ }));
    const pencere = await screen.findByRole('dialog', { name: /Yeni iş/ });
    fireEvent.click(within(pencere).getByRole('button', { name: /İşi ekle/ }));
    expect(toast.warning).toHaveBeenCalledWith('Başlık gerekli.');
    fireEvent.change(within(pencere).getByLabelText('Başlık'), {
      target: { value: 'Yeni otomasyon' },
    });
    fireEvent.click(within(pencere).getByRole('button', { name: 'Ben üstleneyim' }));
    expect((within(pencere).getByLabelText('Sahip') as HTMLInputElement).value).toBe('Admin');
    expect(within(pencere).queryByRole('button', { name: 'Ben üstleneyim' })).toBeNull();
    fireEvent.change(within(pencere).getByLabelText('Öncelik'), { target: { value: 'yuksek' } });
    fireEvent.change(within(pencere).getByLabelText('Son tarih'), {
      target: { value: '2026-12-01' },
    });
    fireEvent.change(within(pencere).getByLabelText('Ne bekleniyor'), {
      target: { value: 'onay' },
    });
    api.ekle.mockRejectedValueOnce(new Error('yetki yok'));
    fireEvent.click(within(pencere).getByRole('button', { name: /İşi ekle/ }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('yetki yok'));
    api.ekle.mockResolvedValueOnce({});
    fireEvent.click(within(pencere).getByRole('button', { name: /İşi ekle/ }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('İş eklendi.'));
    expect(api.ekle.mock.calls[1][0]).toMatchObject({
      baslik: 'Yeni otomasyon',
      sahip: 'Admin',
      oncelik: 'yuksek',
      sonTarih: '2026-12-01',
      beklenen: 'onay',
    });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: /Yeni iş/ })).toBeNull());
    expect(api.liste).toHaveBeenCalledTimes(2);
  });

  it('toplu ekle: önizleme, hatalı satır kilitler, örnek, kayıt, hata, tavan', async () => {
    ciz();
    await screen.findByText('Geciken benim');
    fireEvent.click(screen.getByRole('button', { name: /Toplu ekle/ }));
    const pencere = await screen.findByRole('dialog', { name: /Toplu iş ekle/ });
    expect(within(pencere).getByText('Önizleme burada görünür.')).toBeTruthy();
    const metin = within(pencere).getByLabelText('Toplu iş metni');
    fireEvent.change(metin, { target: { value: 'Tarihi bozuk | | 99.99.2026' } });
    expect(within(pencere).getByText('1 satırda hata var.')).toBeTruthy();
    expect(
      (within(pencere).getByRole('button', { name: '1 işi ekle' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    fireEvent.click(within(pencere).getByRole('button', { name: 'Örneği doldur' }));
    expect(within(pencere).queryByText(/satırda hata var/)).toBeNull();
    expect(within(pencere).getByText('20.11.2026')).toBeTruthy();
    const ekle = within(pencere).getByRole('button', { name: '2 işi ekle' });
    api.toplu.mockRejectedValueOnce(new Error('tavan asildi'));
    fireEvent.click(ekle);
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('tavan asildi', 8000));
    api.toplu.mockResolvedValueOnce(2);
    fireEvent.click(ekle);
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('2 iş eklendi.'));
    expect(api.toplu.mock.calls[1][0]).toContain('Application Hub');

    fireEvent.click(screen.getByRole('button', { name: /Toplu ekle/ }));
    const ikinci = await screen.findByRole('dialog', { name: /Toplu iş ekle/ });
    fireEvent.change(within(ikinci).getByLabelText('Toplu iş metni'), {
      target: { value: Array.from({ length: 201 }, (_, i) => `Is ${i}`).join('\n') },
    });
    expect(within(ikinci).getByText('Bir seferde en çok 200 iş eklenebilir.')).toBeTruthy();
    expect(
      (within(ikinci).getByRole('button', { name: '201 işi ekle' }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });
});

describe('BMW Hub Açık İşler: iş detayı', () => {
  const DETAY = {
    is: { ...ISLER[2], aciklama: 'acik', kapanis: '' },
    notlar: [
      { id: 'n1', tur: 'olusturma', yazanAd: 'Veli', metin: 'İş açıldı', olusturma: gunOnce(20) },
      { id: 'n2', tur: 'not', yazanAd: 'Ayse', metin: 'DBA ile konusuldu', olusturma: gunOnce(1) },
      { id: 'n3', tur: 'bilinmeyen', yazanAd: 'Ali', metin: 'tuhaf kayit', olusturma: gunOnce(1) },
    ],
  };

  it('değişiklik kaydı, çakışma, not ve silme', async () => {
    api.detay.mockResolvedValue(DETAY);
    ciz('/bmw-hub?is=i1');
    const pencere = await screen.findByRole('dialog', { name: /Geciken benim/ });
    expect(within(pencere).getByText(/Son tarih 05\.11\.2026 · 6 gün gecikti/)).toBeTruthy();
    expect(within(pencere).getByText('DBA ile konusuldu')).toBeTruthy();
    // Not turu adi yazanin yaninda; tanimsiz tur ham adiyla.
    expect(within(pencere).getByText(/· Açılış$/).textContent).toBe('Veli · Açılış');
    expect(within(pencere).getByText(/· bilinmeyen$/).textContent).toBe('Ali · bilinmeyen');
    const kaydet = () =>
      within(pencere).getByRole('button', { name: /Değişiklikleri kaydet/ }) as HTMLButtonElement;
    expect(kaydet().disabled).toBe(true);
    // Degisiklik yokken alt dugme "Kapat" (ust kosedeki X de Kapat).
    expect(within(pencere).getAllByRole('button', { name: 'Kapat' })).toHaveLength(2);
    fireEvent.change(within(pencere).getByLabelText('Başlık'), {
      target: { value: 'Geciken benim (guncel)' },
    });
    expect(kaydet().disabled).toBe(false);
    expect(within(pencere).getAllByRole('button', { name: 'İptal' }).length).toBeGreaterThan(0);

    // Çakışma: hata gösterilir ve iş yeniden okunur.
    const cakisma = Object.assign(new Error('Başkası değiştirdi'), { code: 'bmw_cakisma' });
    api.guncelle.mockRejectedValueOnce(cakisma);
    fireEvent.click(kaydet());
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Başkası değiştirdi', 9000));
    await waitFor(() => expect(api.detay).toHaveBeenCalledTimes(2));
    fireEvent.change(within(pencere).getByLabelText('Başlık'), {
      target: { value: 'Yeni baslik' },
    });
    api.guncelle.mockRejectedValueOnce(new Error('ag'));
    fireEvent.click(kaydet());
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('ag', 5000));
    expect(api.detay).toHaveBeenCalledTimes(2);
    api.guncelle.mockResolvedValueOnce(undefined);
    fireEvent.click(kaydet());
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Kaydedildi.'));
    expect(api.guncelle).toHaveBeenLastCalledWith(
      'i1',
      { baslik: 'Yeni baslik' },
      ISLER[2].guncelleme,
    );

    // Not
    const not = within(pencere).getByLabelText('Not');
    fireEvent.change(not, { target: { value: '  ' } });
    expect(
      (within(pencere).getByRole('button', { name: /Not ekle/ }) as HTMLButtonElement).disabled,
    ).toBe(true);
    fireEvent.change(not, { target: { value: ' log yedegi geldi ' } });
    api.notEkle.mockRejectedValueOnce(new Error('not yazilamadi'));
    fireEvent.click(within(pencere).getByRole('button', { name: /Not ekle/ }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('not yazilamadi'));
    api.notEkle.mockResolvedValueOnce(undefined);
    fireEvent.click(within(pencere).getByRole('button', { name: /Not ekle/ }));
    await waitFor(() => expect(api.notEkle).toHaveBeenLastCalledWith('i1', 'log yedegi geldi'));
    await waitFor(() =>
      expect((within(pencere).getByLabelText('Not') as HTMLTextAreaElement).value).toBe(''),
    );

    // Silme: onay iptal, sonra hata, sonra başarı.
    fireEvent.click(within(pencere).getByRole('button', { name: /^Sil$/ }));
    expect(within(pencere).getByText(/kalıcı olarak silinsin mi/)).toBeTruthy();
    fireEvent.click(
      within(within(pencere).getByText(/kalıcı olarak silinsin mi/)).getByRole('button', {
        name: 'İptal',
      }),
    );
    expect(within(pencere).queryByText(/kalıcı olarak silinsin mi/)).toBeNull();
    fireEvent.click(within(pencere).getByRole('button', { name: /^Sil$/ }));
    api.sil.mockRejectedValueOnce(new Error('silinemedi'));
    fireEvent.click(within(pencere).getByRole('button', { name: 'Evet, sil' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('silinemedi'));
    api.sil.mockResolvedValueOnce(undefined);
    fireEvent.click(within(pencere).getByRole('button', { name: 'Evet, sil' }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('İş silindi.'));
    await waitFor(() => expect(screen.getByTestId('konum').textContent).toBe(''));
  });

  it('kapanmış iş başlığında kapanış; iş okunamadı ve tekrar dene', async () => {
    api.detay.mockRejectedValueOnce(new Error('iş bulunamadı'));
    ciz('/bmw-hub?is=i4');
    expect(await screen.findByText('İş okunamadı')).toBeTruthy();
    expect(screen.getByText('iş bulunamadı')).toBeTruthy();
    api.detay.mockResolvedValueOnce({ is: ISLER[4], notlar: [] });
    fireEvent.click(screen.getByRole('button', { name: /Tekrar dene/ }));
    const pencere = await screen.findByRole('dialog', { name: /Yeni biten/ });
    expect(within(pencere).getByText(/kapanış/)).toBeTruthy();
  });
});
