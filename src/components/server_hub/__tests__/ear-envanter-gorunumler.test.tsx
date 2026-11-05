// src/components/server_hub/__tests__/ear-envanter-gorunumler.test.tsx — Uygulama Envanteri görünümleri
// (2026-11-05 tablo arayüzü).
//
//   EG1 Sunucular: Neden hiç "—" değil; Playbook okunur dilde (ham kod title'da); durum süzgeci tarayıcıda;
//       seçilen sunucular "Seçili sunucuları tara"ya tekil gider
//   EG2 Eşlenikler: dört alt sekme doğru türle ister; karar etiketi ve tarama farkı; karar süzgeci parametreye
//       gider (sessizce atılmaz); ortam bilinmiyor satırı karar taşımaz
//   EG3 fark ayrıntısı: kategorili, boyut farkında boyut; fark yoksa "birebir aynı", karşılaştırılamadıysa
//       "karşılaştırılmadı"; toplam yüklenenden büyükse "daha göster" sonraki parçayı ister (eksik kalmaz)
//   EG4 dosya farkı: iki TAM kopya seçilir; hesaplanamadıysa NEDEN yazılır; liste sayılarıyla
//   EG5 Uygulamalar: varsayılan kolonlar sade, fazlası kolon seçicide; süzgeç ve CSV bağlantısı aynı süzgeci taşır
//   EG6 Koşular: plan anahtarı "plan 1" olarak okunur
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor, within } from '@testing-library/react';
import { render } from '@/test/test-utils';
import {
  SunucularGorunum,
  EsleniklerGorunum,
  UygulamalarGorunum,
  KosularGorunum,
} from '@/components/server_hub/EarEnvanterGorunumler';
import type { EarEslenik, EarEslenikFarki, EarHost } from '@/api/earEnvanterApi';

const m = vi.hoisted(() => ({
  eslenikListesi: vi.fn(),
  eslenik: vi.fn(),
  yapiFarki: vi.fn(),
  ortamlar: vi.fn(),
  uygulamalar: vi.fn(),
  degerler: vi.fn(),
  kosular: vi.fn(),
}));
vi.mock('@/api/earEnvanterApi', async (orig) => ({
  ...(await orig<typeof import('@/api/earEnvanterApi')>()),
  earApi: m,
}));

const host = (o: Partial<EarHost>): EarHost =>
  ({
    host: 'APPSRV01',
    kosu_id: 7,
    parti_no: 1,
    ortam: 'PROD',
    durum: 'TAM',
    playbook_durum: 'SONUC',
    playbook_etiket: 'sonuç geldi',
    neden: 'başarılı · 28 uygulama tam tarandı',
    eksik_uygulama: 0,
    veri_var: true,
    uygulama_sayisi: 28,
    war_sayisi: 30,
    giris: 100,
    sure_sn: 3.2,
    python: '3.6.8',
    kullanici: 'was',
    hata: null,
    taranma_utc: null,
    alindi_at: null,
    veri_kosu_id: 7,
    ...o,
  }) as EarHost;

const grup = (o: Partial<EarEslenik> = {}): EarEslenik => ({
  uygulama: 'ODEME.ear',
  ortam: 'PROD',
  jboss: '8',
  karar: 'AYNI_SURUM_FARKLI_DOSYA',
  kutuphane: 'AYNI_SURUM_FARKLI_DOSYA',
  yapi: 'AYNI',
  host_sayisi: 2,
  kopya_sayisi: 2,
  hostlar: ['APPSRV01', 'APPSRV02'],
  eksik: [],
  kipler: ['TAM'],
  tarih_farki_gun: 40,
  tarih_bilinmeyen: 0,
  degiskenler: [
    { harf: 'A', hostlar: ['APPSRV01'], kopya_sayisi: 1 },
    { harf: 'B', hostlar: ['APPSRV02'], kopya_sayisi: 1 },
  ],
  gruplar: [],
  ...o,
});

const kopyalar = ['APPSRV01', 'APPSRV02'].map((h, i) => ({
  anahtar: `${h}|/vhosting8|ODEME.ear`,
  host: h,
  ortam: 'PROD',
  kok: '/vhosting8',
  jboss: '8',
  durum: 'TAM',
  kip: 'TAM' as const,
  taranma_utc: null,
  kosu_id: 7 + i,
  uyg_no: 0,
  degisken: i ? 'B' : 'A',
}));
const fark = (o: Partial<EarEslenikFarki>): EarEslenikFarki => ({
  ok: true,
  kopyalar,
  farklar: [],
  toplam: 0,
  sayilar: { WAR: 0, EKSIK: 0, SURUM: 0, BOYUT: 0 },
  ...o,
});
const boyutSatiri = (kutuphane: string) => ({
  kategori: 'BOYUT' as const,
  konum: 'ODEME.war',
  kutuphane,
  degerler: {
    'APPSRV01|/vhosting8|ODEME.ear': [['6.1.0', 2048]] as [string, number][],
    'APPSRV02|/vhosting8|ODEME.ear': [['6.1.0', 4096]] as [string, number][],
  },
});

beforeEach(() => {
  Object.values(m).forEach((f) => f.mockReset());
  window.localStorage.clear();
  m.ortamlar.mockResolvedValue({ ok: true, ortamlar: [{ ortam: 'PROD', sunucu: 4 }] });
});

describe('EG1 Sunucular', () => {
  it('Neden hep dolu, Playbook okunur, süzgeç ve seçim', async () => {
    const tara = vi.fn();
    render(
      <SunucularGorunum
        onTara={tara}
        hostlar={[
          host({}),
          host({
            host: 'APPSRV02',
            durum: 'KISMI',
            neden: '3 uygulama eksik tarandı: X.ear (kısmi · sınır) …',
          }),
        ]}
      />,
    );
    const tablo = screen.getByRole('table');
    expect(within(tablo).getByText('başarılı · 28 uygulama tam tarandı')).toBeInTheDocument();
    const pb = within(tablo).getAllByText('sonuç geldi');
    expect(pb).toHaveLength(2);
    expect(pb[0].closest('[title]')).toHaveAttribute('title', 'SONUC');
    expect(within(tablo).queryByText('SONUC')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Durum süz' }));
    fireEvent.click(await screen.findByLabelText('Durum: kısmi'));
    fireEvent.click(screen.getByRole('button', { name: 'Uygula' }));
    expect(screen.getByText('1–1 / 1')).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('seç: 7-APPSRV02'));
    fireEvent.click(screen.getByRole('button', { name: /Seçili sunucuları tara \(1\)/ }));
    expect(tara).toHaveBeenCalledWith(['APPSRV02']);
  });
});

describe('EG2-EG4 Eşlenikler', () => {
  it('EG2 alt sekmeler, karar, süzgeç', async () => {
    m.eslenikListesi.mockResolvedValue({ ok: true, satirlar: [grup()], toplam: 1, sayilar: {} });
    render(<EsleniklerGorunum />);
    expect(await screen.findByText('40 gün')).toBeInTheDocument();
    expect(m.eslenikListesi).toHaveBeenLastCalledWith(
      expect.objectContaining({ tur: 'ORTAM_ICI', limit: 100, offset: 0 }),
    );
    const tablo = screen.getByRole('table');
    expect(within(tablo).getAllByText('aynı sürüm, farklı dosya').length).toBe(2);
    fireEvent.click(screen.getByRole('button', { name: 'Sonuç süz' }));
    fireEvent.click(await screen.findByLabelText('Sonuç: kütüphane farklı'));
    fireEvent.click(screen.getByLabelText('Sonuç: aynı'));
    fireEvent.click(screen.getByRole('button', { name: 'Uygula' }));
    await waitFor(() =>
      expect(m.eslenikListesi).toHaveBeenLastCalledWith(
        expect.objectContaining({ karar: 'FARKLI_KUTUPHANE,AYNI' }),
      ),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Tarama farkı süz' }));
    fireEvent.change(screen.getByLabelText('Tarama farkı en az'), { target: { value: '7' } });
    fireEvent.change(screen.getByLabelText('Tarama farkı en çok'), { target: { value: '30' } });
    fireEvent.click(screen.getByRole('button', { name: 'Uygula' }));
    await waitFor(() =>
      expect(m.eslenikListesi).toHaveBeenLastCalledWith(
        expect.objectContaining({ tarihFarki: 7, tarihFarkiMax: 30 }),
      ),
    );
    m.eslenikListesi.mockResolvedValue({
      ok: true,
      satirlar: [
        { uygulama: 'C.ear', jboss: '7', host_sayisi: 2, kopya_sayisi: 2, hostlar: ['X1', 'X2'] },
      ],
      toplam: 1,
      sayilar: {},
    });
    fireEvent.click(screen.getByRole('tab', { name: 'Ortam bilinmiyor' }));
    expect(await screen.findByText('2: X1, X2')).toBeInTheDocument();
    expect(m.eslenikListesi).toHaveBeenLastCalledWith(
      expect.objectContaining({ tur: 'ORTAM_YOK' }),
    );
    expect(within(screen.getByRole('table')).getByText('ortam bilinmiyor')).toBeInTheDocument();
  });

  it('EG3 fark ayrıntısı tamamı, parça parça', async () => {
    m.eslenikListesi.mockResolvedValue({ ok: true, satirlar: [grup()], toplam: 1, sayilar: {} });
    m.eslenik
      .mockResolvedValueOnce(
        fark({
          farklar: [boyutSatiri('spring-core')],
          toplam: 2,
          sayilar: { WAR: 0, EKSIK: 0, SURUM: 0, BOYUT: 2 },
        }),
      )
      .mockResolvedValueOnce(
        fark({
          farklar: [boyutSatiri('spring-beans')],
          toplam: 2,
          sayilar: { WAR: 0, EKSIK: 0, SURUM: 0, BOYUT: 2 },
        }),
      );
    render(<EsleniklerGorunum />);
    fireEvent.click(await screen.findByText('ODEME.ear'));
    expect(await screen.findAllByText('6.1.0 (2.0 KB)')).toHaveLength(1);
    expect(screen.getByText('6.1.0 (4.0 KB)')).toBeInTheDocument();
    expect(screen.getByText(/aynı sürüm, boyut farklı: 2/)).toBeInTheDocument();
    expect(m.eslenik).toHaveBeenLastCalledWith('ODEME.ear', 'PROD', '8', {
      tur: 'ORTAM_ICI',
      host: undefined,
      limit: 500,
      offset: 0,
    });
    fireEvent.click(screen.getByRole('button', { name: '1 fark daha göster' }));
    expect(await screen.findByText('spring-beans')).toBeInTheDocument();
    expect(m.eslenik).toHaveBeenLastCalledWith('ODEME.ear', 'PROD', '8', {
      tur: 'ORTAM_ICI',
      host: undefined,
      limit: 500,
      offset: 1,
    });
    expect(screen.getByText('spring-core')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /fark daha göster/ })).toBeNull();
  });

  it('EG3 birebir aynı / karşılaştırılmadı', async () => {
    m.eslenik.mockResolvedValue(fark({}));
    m.eslenikListesi.mockResolvedValueOnce({
      ok: true,
      satirlar: [grup({ karar: 'AYNI', kutuphane: 'AYNI', tarih_farki_gun: 0 })],
      toplam: 1,
      sayilar: {},
    });
    const { unmount } = render(<EsleniklerGorunum />);
    fireEvent.click(await screen.findByText('ODEME.ear'));
    expect(await screen.findByText(/Kütüphane listeleri birebir aynı/)).toBeInTheDocument();
    unmount();
    m.eslenikListesi.mockResolvedValueOnce({
      ok: true,
      satirlar: [
        grup({
          karar: 'EKSIK_TARAMA',
          kutuphane: 'KARSILASTIRILAMADI',
          yapi: 'KARSILASTIRILAMADI',
        }),
      ],
      toplam: 1,
      sayilar: {},
    });
    render(<EsleniklerGorunum />);
    fireEvent.click(await screen.findByText('ODEME.ear'));
    expect(await screen.findByText(/Kütüphaneler karşılaştırılmadı/)).toBeInTheDocument();
    expect(screen.queryByText(/Kütüphane listeleri birebir aynı/)).toBeNull();
  });

  it('EG4 dosya farkı', async () => {
    m.eslenikListesi.mockResolvedValue({ ok: true, satirlar: [grup()], toplam: 1, sayilar: {} });
    m.eslenik.mockResolvedValue(fark({}));
    m.yapiFarki.mockResolvedValueOnce({
      ok: true,
      hesaplanamadi: 'APPSRV01: ÖZET taramada dosya ağacı tutulmaz; TAM tarama gerekir.',
    });
    render(<EsleniklerGorunum />);
    fireEvent.click(await screen.findByText('ODEME.ear'));
    fireEvent.click(await screen.findByRole('button', { name: 'Karşılaştır' }));
    expect(await screen.findByText(/ÖZET taramada dosya ağacı tutulmaz/)).toBeInTheDocument();
    expect(m.yapiFarki).toHaveBeenCalledWith('7:APPSRV01:0', '8:APPSRV02:0');
    m.yapiFarki.mockResolvedValueOnce({
      ok: true,
      ayni: false,
      yalnizA: ['ODEME.war/a.jsp', 'ODEME.war/b.jsp'],
      yalnizB: [],
      tipFarkli: [],
      boyutFarkli: [],
    });
    fireEvent.change(screen.getByLabelText('A kopyası'), { target: { value: '8:APPSRV02:0' } });
    fireEvent.change(screen.getByLabelText('B kopyası'), { target: { value: '7:APPSRV01:0' } });
    fireEvent.click(screen.getByRole('button', { name: 'Karşılaştır' }));
    expect(await screen.findByText('Yalnız A’da (2)')).toBeInTheDocument();
    expect(screen.getByText(/Dosya yapısı farklı/)).toBeInTheDocument();
  });
});

describe('EG5 Uygulamalar', () => {
  it('varsayılan kolonlar, süzgeç ve CSV bağlantısı', async () => {
    m.uygulamalar.mockResolvedValue({ ok: true, satirlar: [], toplam: 0 });
    m.degerler.mockResolvedValue({ ok: true, degerler: [{ deger: '2.17.1', sayi: 3 }], farkli: 1 });
    render(<UygulamalarGorunum onAc={vi.fn()} />);
    await screen.findByText('0 kayıt');
    const basliklar = screen.getAllByRole('columnheader').map((h) => h.textContent);
    expect(basliklar).toContain('Eşlenik (ortam içi)');
    expect(basliklar).not.toContain('Spring Security');
    fireEvent.click(screen.getByRole('button', { name: /Kolonlar/ }));
    expect(screen.getByLabelText('kolon: Spring Security')).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('kolon: Spring Security'));
    fireEvent.click(screen.getByRole('button', { name: 'log4j süz' }));
    fireEvent.click(await screen.findByLabelText('log4j: 2.17.1'));
    fireEvent.click(screen.getByRole('button', { name: 'Uygula' }));
    const f = JSON.stringify([{ k: 'log4j', op: 'in', v: ['2.17.1'] }]);
    await waitFor(() =>
      expect(m.uygulamalar).toHaveBeenLastCalledWith(
        expect.objectContaining({ f, limit: 100, offset: 0 }),
      ),
    );
    expect(m.degerler).toHaveBeenCalledWith('uygulamalar', 'log4j', {
      ara: undefined,
      f: undefined,
      q: undefined,
    });
    const csv = screen.getByRole('link', { name: 'Süzülenleri CSV' });
    expect(csv.getAttribute('href')).toBe(
      `/api/server-hub/ear/disa-aktar/uygulamalar.csv?f=${encodeURIComponent(f).replace(/%20/g, '+')}`,
    );
  });
});

describe('EG6 Koşular', () => {
  it('plan etiketi', async () => {
    m.kosular.mockResolvedValue({
      ok: true,
      kosular: [
        {
          id: 3,
          kip: 'OZET',
          kaynak: 'ZAMANLAYICI',
          kapsam: 'FILO',
          durum: 'TAMAMLANDI',
          zamanlayici_anahtari: 'P1-2026-11-08',
          beklenen: 2,
          tam: 2,
          kismi: 0,
          kok_yok: 0,
          basarisiz: 0,
          baslatan: 'ear-envanter-zamanlayici',
          created_at: '2026-11-07T23:00:00Z',
          finished_at: null,
        },
        {
          id: 2,
          kip: 'TAM',
          kaynak: 'ELLE',
          kapsam: 'ORTAM',
          durum: 'KISMI',
          zamanlayici_anahtari: null,
          beklenen: 2,
          tam: 1,
          kismi: 1,
          kok_yok: 0,
          basarisiz: 0,
          baslatan: 'ayse',
          created_at: '2026-11-06T10:00:00Z',
          finished_at: null,
        },
      ],
    });
    render(<KosularGorunum tazeleme={0} />);
    const tablo = await screen.findByRole('table');
    expect(within(tablo).getByText('plan 1')).toBeInTheDocument();
    expect(within(tablo).getByText('elle')).toBeInTheDocument();
    expect(within(tablo).getByText('ortam')).toBeInTheDocument();
  });
});
