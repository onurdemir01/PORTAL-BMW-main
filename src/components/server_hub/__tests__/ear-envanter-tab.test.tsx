// src/components/server_hub/__tests__/ear-envanter-tab.test.tsx — Server Hub › Uygulama Envanteri ekranı.
//
//   EU1 template tanımlı değilse uyarı bandı ve "Şimdi tara" kapalı; haftalık tarama kapalı yazar
//   EU2 özet okunamazsa "okunamadı" (boş durum DEĞİL) ve tekrar dene
//   EU3 çalışan koşu: ilerleme, partiler, AWX iş no; İptal onaydan sonra API'ye gider
//   EU4 Şimdi tara: geçersiz ad varken Başlat kapalı; seçili liste API'ye kapsam SECILI ile gider;
//       filo onay kutusu ve kapsam önizlemesi olmadan başlamaz; çift tık TEK istek; ORTAM seçimi ortam
//       listesiyle gider; boş kapsamda (0 sunucu) başlamaz
//   EU5 uygulama listesi: kısmi durum yeşil değil; satır ayrıntıyı açar (WAR, kütüphane, kopyalar)
//   EU6 ayarlar: planı açmak onay ister; kaydet yalnız değişen alanları planYaz ile tek istekte gönderir
//   EU7 Server Hub sekme kaydı (kaynak)
//   EU9 tablo seçiminden "Seçili sunucuları tara": çalışan koşu varken pencere açılmaz
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor, within, act } from '@testing-library/react';
import { render } from '@/test/test-utils';
import fs from 'node:fs';
import path from 'node:path';
import EarEnvanterTab, { TaraPenceresi } from '@/components/server_hub/EarEnvanterTab';
import { AgacGoruntuleyici, pencereAraligi } from '@/components/server_hub/EarEnvanterDetay';
import type { EarAgacSatiri } from '@/api/earEnvanterApi';
import type { EarOzet, EarUygulama } from '@/api/earEnvanterApi';

const m = vi.hoisted(() => ({
  ozet: vi.fn(),
  tara: vi.fn(),
  iptal: vi.fn(),
  uygulamalar: vi.fn(),
  uygulama: vi.fn(),
  ayarYaz: vi.fn(),
  planYaz: vi.fn(),
  ortamlar: vi.fn(),
  kapsamOnizleme: vi.fn(),
  kosular: vi.fn(),
  hostlar: vi.fn(),
}));
vi.mock('@/api/earEnvanterApi', async (orig) => ({
  ...(await orig<typeof import('@/api/earEnvanterApi')>()),
  earApi: m,
}));

function ozet(o: Partial<EarOzet> = {}): EarOzet {
  return {
    ok: true,
    ayarlar: {
      deger: {
        p1_acik: 'KAPALI',
        p1_birim: 'HAFTA',
        p1_aralik: '4',
        p1_gun: '0',
        p1_sira: 'ILK',
        p1_saat: '02:00',
        p1_kip: 'OZET',
        p1_kapsam: 'FILO',
        p1_baslangic: '2026-01-01',
        parti_tam: '50',
      },
      kayitlar: {},
      okunamadi: false,
      hata: '',
      tanimlar: [
        { anahtar: 'p1_acik', ad: 'Plan 1: açık', varsayilan: 'KAPALI' },
        { anahtar: 'p1_aralik', ad: 'Plan 1: her N birimde bir', varsayilan: '4' },
        { anahtar: 'parti_tam', ad: 'TAM parti boyutu', varsayilan: '50' },
      ],
    },
    zamanlayici: { acik: false, metin: 'planlar kapalı', sonraki: null },
    planlar: [
      { ad: 'P1', acik: false, kip: 'OZET', kapsam: 'FILO', metin: 'Her 4 haftada bir · Pazar 02:00 (TR) · ÖZET · tüm filo', sonraki: [] },
      { ad: 'P2', acik: false, kip: 'TAM', kapsam: 'FILO', metin: 'Her 2 ayda bir · ayın ilk Pazarı 03:00 (TR) · TAM · tüm filo', sonraki: [] },
    ],
    template: { anahtar: 'server_hub_ear_envanter', tanimli: true },
    dizin: '/sw/ORNEK/ear',
    aktif: null,
    son: null,
    sayilar: { host: 2, uygulama: 3, eksikUygulama: 1, war: 4 },
    ...o,
  };
}
const uyg = (o: Partial<EarUygulama> = {}): EarUygulama =>
  ({
    kosu_id: 7,
    host: 'APPSRV01',
    ortam: 'PROD',
    uyg_no: 0,
    kip: 'TAM',
    kok: '/vhosting8',
    jboss: '8',
    ad: 'ORNEKPANEL.ear',
    bicim: 'ACIK',
    durum: 'TAM',
    war_sayisi: 1,
    spring_boot: '4.0.8',
    spring_framework: '7.0.9',
    servlet: 'jakarta',
    log4j: null,
    jsp: 12,
    tld: 3,
    taranma_utc: '2026-11-04T10:00:00.000Z',
    ...o,
  }) as EarUygulama;

beforeEach(() => {
  Object.values(m).forEach((f) => f.mockReset());
  m.uygulamalar.mockResolvedValue({
    ok: true,
    satirlar: [uyg(), uyg({ host: 'APPSRV02', durum: 'KISMI_SINIR', uyg_no: 1 })],
    toplam: 2,
  });
});

describe('Uygulama Envanteri sekmesi', () => {
  it('EU1 template yoksa uyarı ve tarama kapalı', async () => {
    m.ozet.mockResolvedValue(
      ozet({ template: { anahtar: 'server_hub_ear_envanter', tanimli: false } }),
    );
    render(<EarEnvanterTab />);
    expect(await screen.findByText(/AWX template'i tanımlı değil/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Şimdi tara/ })).toBeDisabled();
    expect(screen.getByText('kapalı')).toBeInTheDocument();
  });

  it('EU2 özet okunamazsa okunamadı', async () => {
    m.ozet
      .mockRejectedValueOnce(new Error('Sunucu hatası (HTTP 424).'))
      .mockResolvedValueOnce(ozet());
    render(<EarEnvanterTab />);
    expect(await screen.findByText('Uygulama Envanteri okunamadı')).toBeInTheDocument();
    expect(screen.queryByText(/Kayıt bulunamadı/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /tekrar dene/i }));
    expect(await screen.findByText('Uygulamalar')).toBeInTheDocument();
  });

  it('EU3 çalışan koşu ve iptal', async () => {
    m.ozet.mockResolvedValue(
      ozet({
        aktif: {
          id: 12,
          kip: 'OZET',
          kaynak: 'ELLE',
          kapsam: 'FILO',
          durum: 'CALISIYOR',
          beklenen: 230,
          tam: 0,
          kismi: 0,
          kok_yok: 0,
          basarisiz: 0,
          parti_sayisi: 3,
          baslatan: 'ayse',
          hata: null,
          created_at: '2026-11-04T10:00:00Z',
          finished_at: null,
          alinan: 100,
          partiler: [
            {
              parti_no: 1,
              host_sayisi: 100,
              durum: 'BITTI',
              awx_server_id: 0,
              awx_job_id: 501,
              awx_durum: 'successful',
              baslatma_denemesi: 1,
              alim_denemesi: 1,
              hata: null,
              started_at: null,
              finished_at: null,
            },
            {
              parti_no: 2,
              host_sayisi: 100,
              durum: 'CALISIYOR',
              awx_server_id: 0,
              awx_job_id: 502,
              awx_durum: 'running',
              baslatma_denemesi: 1,
              alim_denemesi: 0,
              hata: null,
              started_at: null,
              finished_at: null,
            },
            {
              parti_no: 3,
              host_sayisi: 30,
              durum: 'BEKLIYOR',
              awx_server_id: null,
              awx_job_id: null,
              awx_durum: null,
              baslatma_denemesi: 0,
              alim_denemesi: 0,
              hata: null,
              started_at: null,
              finished_at: null,
            },
          ],
        },
      }),
    );
    m.iptal.mockResolvedValue({ ok: true, durum: 'IPTAL' });
    render(<EarEnvanterTab />);
    expect(await screen.findByText(/100 \/ 230 sunucunun sonucu alındı/)).toBeInTheDocument();
    expect(screen.getByText(/AWX 502, running/)).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100');
    expect(screen.getByRole('button', { name: /Şimdi tara/ })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: /İptal et/ }));
    expect(m.iptal).not.toHaveBeenCalled();
    const pencere = await screen.findByRole('dialog');
    fireEvent.click(within(pencere).getByRole('button', { name: 'İptal et' }));
    await waitFor(() => expect(m.iptal).toHaveBeenCalledWith(12));
  });

  it('EU5 kısmi yeşil değil; satır ayrıntıyı açar', async () => {
    m.ozet.mockResolvedValue(ozet());
    m.uygulama.mockResolvedValue({
      ok: true,
      uygulama: {
        ...uyg(),
        uyarilar: '["giris siniri: X.war"]',
        host_durum: 'TAM',
        giris: 180,
        application_xml: true,
      },
      warlar: [
        {
          war_no: 0,
          ad: 'ORNEKPANEL.war',
          bicim: 'ACIK',
          durum: 'TAM',
          jsp: 12,
          tld: 3,
          kutuphane_sayisi: 1,
          spring_boot: '4.0.8',
          kutuphaneler: [{ ad: 'spring-boot', surum: '4.0.8', boyut: 1000 }],
        },
      ],
      earKutuphaneleri: [],
      kopyalar: [
        {
          host: 'APPSRV01',
          ortam: 'PROD',
          kok: '/vhosting8',
          jboss: '8',
          durum: 'TAM',
          kip: 'TAM',
          yapi_izi: 'aaaa1111',
          kutuphane_izi: 'bbbb2222',
          kosu_id: 7,
          uyg_no: 0,
          taranma_utc: null,
        },
      ],
    });
    render(<EarEnvanterTab />);
    await screen.findAllByText('APPSRV02');
    const tablo = screen.getByRole('table');
    const kismi = within(tablo).getByText('kısmi · sınır');
    expect(kismi.closest('[data-ton]')).toHaveAttribute('data-ton', 'uyari');
    expect(within(tablo).getAllByText('tam')[0].closest('[data-ton]')).toHaveAttribute('data-ton', 'iyi');
    fireEvent.click(within(tablo).getAllByText('ORNEKPANEL.ear')[0]);
    await waitFor(() => expect(m.uygulama).toHaveBeenCalledWith(7, 'APPSRV01', 0));
    const pencere = await screen.findByRole('dialog');
    expect(within(pencere).getByText(/WAR'lar \(1\)/)).toBeInTheDocument();
    expect(within(pencere).getByText('giris siniri: X.war')).toBeInTheDocument();
    fireEvent.click(within(pencere).getByRole('button', { name: /Kütüphaneler \(1\)/ }));
    expect(within(pencere).getByText('spring-boot')).toBeInTheDocument();
    expect(within(pencere).getByRole('link', { name: /tree\.txt/ })).toHaveAttribute(
      'href',
      '/api/server-hub/ear/agac/7/APPSRV01/0?bicim=txt',
    );
  });

  it('EU9 seçimle tarama çalışan koşu varken açılmaz', async () => {
    const aktif = { id: 12, kip: 'OZET', kaynak: 'ELLE', kapsam: 'FILO', durum: 'CALISIYOR', beklenen: 2, tam: 0, kismi: 0, kok_yok: 0, basarisiz: 0, parti_sayisi: 1, baslatan: 'ayse', hata: null, created_at: '2026-11-04T10:00:00Z', finished_at: null, alinan: 0, partiler: [] };
    m.ozet.mockResolvedValue(ozet({ aktif } as Partial<EarOzet>));
    render(<EarEnvanterTab />);
    await screen.findAllByText('APPSRV02');
    fireEvent.click(screen.getByLabelText('seç: 7-APPSRV01-0'));
    fireEvent.click(screen.getByRole('button', { name: /Seçili sunucuları tara/ }));
    expect(screen.queryByRole('dialog', { name: /Şimdi tara/ })).toBeNull();
    expect(screen.queryByLabelText('Sunucu listesi')).toBeNull();
    m.ozet.mockResolvedValue(ozet());
  });

  it('EU6 planı açmak onay ister; yalnız değişen alanlar gider', async () => {
    m.ozet.mockResolvedValue(ozet());
    m.planYaz.mockResolvedValue({ ok: true, plan: 'p1', degisen: [], planlar: [] });
    render(<EarEnvanterTab />);
    fireEvent.click(await screen.findByRole('button', { name: 'Ayarlar' }));
    const kart = screen.getByRole('region', { name: 'Plan 1' });
    expect(within(kart).getByText(/Her 4 haftada bir · Pazar 02:00/)).toBeInTheDocument();
    expect(within(kart).getByText(/plan kapalı/)).toBeInTheDocument();
    fireEvent.change(within(kart).getByLabelText('Plan 1 durum'), { target: { value: 'ACIK' } });
    fireEvent.change(within(kart).getByLabelText('Plan 1 aralık'), { target: { value: '2' } });
    fireEvent.click(within(kart).getByRole('button', { name: 'Kaydet' }));
    expect(m.planYaz).not.toHaveBeenCalled();
    const pencere = await screen.findByRole('dialog');
    fireEvent.click(within(pencere).getByRole('button', { name: 'Aç' }));
    await waitFor(() => expect(m.planYaz).toHaveBeenCalledWith('p1', { acik: 'ACIK', aralik: '2' }));
    // Plan alanları genel tabloda tekrar görünmez.
    expect(screen.queryByText('Plan 1: açık')).toBeNull();
    expect(screen.getByText('TAM parti boyutu')).toBeInTheDocument();
  });

  it('EU6 ORTAM kapsamında ortam seçilmeden kaydedilmez; ay biriminde ayın kaçıncı günü sorulur', async () => {
    m.ozet.mockResolvedValue(ozet());
    m.ortamlar.mockResolvedValue({ ok: true, ortamlar: [{ ortam: 'PROD', sunucu: 40 }, { ortam: 'TEST', sunucu: 12 }] });
    m.planYaz.mockResolvedValue({ ok: true, plan: 'p1', degisen: [], planlar: [] });
    render(<EarEnvanterTab />);
    fireEvent.click(await screen.findByRole('button', { name: 'Ayarlar' }));
    const kart = screen.getByRole('region', { name: 'Plan 1' });
    expect(within(kart).queryByLabelText('Plan 1 sıra')).toBeNull();
    fireEvent.change(within(kart).getByLabelText('Plan 1 birim'), { target: { value: 'AY' } });
    expect(within(kart).getByLabelText('Plan 1 sıra')).toBeInTheDocument();
    fireEvent.click(within(kart).getByLabelText(/Ortam seç/));
    const kaydet = within(kart).getByRole('button', { name: 'Kaydet' });
    expect(kaydet).toBeDisabled();
    fireEvent.click(await within(kart).findByLabelText('Plan 1 ortam TEST'));
    expect(kaydet).not.toBeDisabled();
    fireEvent.click(kaydet);
    await waitFor(() =>
      expect(m.planYaz).toHaveBeenCalledWith('p1', { birim: 'AY', kapsam: 'ORTAM:TEST' }),
    );
  });
});

describe('EU4 Şimdi tara', () => {
  it('seçili, filo, çift tık', async () => {
    let coz: (v: unknown) => void = () => {};
    m.tara.mockImplementation(() => new Promise((r) => (coz = r)));
    const kapat = vi.fn();
    render(<TaraPenceresi onClose={kapat} onBasladi={vi.fn()} />);
    const baslat = screen.getByRole('button', { name: /Başlat/ });
    expect(baslat).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Sunucu listesi'), {
      target: { value: 'appsrv01 kotu/ad' },
    });
    expect(screen.getByText(/geçersiz ad: KOTU\/AD/)).toBeInTheDocument();
    expect(baslat).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Sunucu listesi'), {
      target: { value: 'appsrv01, appsrv02' },
    });
    // Iki tik TEK act icinde: arada yeniden cizim yok, dugme hala acik. Korumayi yalniz ref saglar.
    act(() => {
      baslat.click();
      baslat.click();
    });
    expect(m.tara).toHaveBeenCalledTimes(1);
    expect(m.tara).toHaveBeenCalledWith({
      kip: 'TAM',
      kapsam: 'SECILI',
      hostlar: 'APPSRV01 APPSRV02',
    });
    coz({ ok: true, id: 3, beklenen: 2, partiSayisi: 1 });
    await waitFor(() => expect(kapat).toHaveBeenCalled());

    m.tara.mockReset();
    m.tara.mockResolvedValue({ ok: true, id: 4, beklenen: 900, partiSayisi: 18 });
    m.kapsamOnizleme.mockResolvedValue({ ok: true, kapsam: 'FILO', sunucu: 900, parti: 18, ornek: [] });
    render(<TaraPenceresi onClose={vi.fn()} onBasladi={vi.fn()} />);
    const pencereler = screen.getAllByRole('dialog');
    const p = pencereler[pencereler.length - 1];
    fireEvent.click(within(p).getByLabelText(/Tüm filo/));
    const b2 = within(p).getByRole('button', { name: /Başlat/ });
    expect(b2).toBeDisabled();
    expect(await within(p).findByText('900 sunucu · 18 parti')).toBeInTheDocument();
    expect(b2).toBeDisabled();
    fireEvent.click(within(p).getByRole('checkbox'));
    fireEvent.click(b2);
    await waitFor(() => expect(m.tara).toHaveBeenCalledWith({ kip: 'TAM', kapsam: 'FILO' }));
    expect(m.kapsamOnizleme).toHaveBeenCalledWith('FILO', [], 'TAM');
  });

  it('ortam ve yalnız sorunlular', async () => {
    m.tara.mockReset();
    m.tara.mockResolvedValue({ ok: true, id: 5, beklenen: 12, partiSayisi: 1 });
    m.ortamlar.mockResolvedValue({ ok: true, ortamlar: [{ ortam: 'PROD', sunucu: 40 }, { ortam: 'TEST', sunucu: 12 }] });
    m.kapsamOnizleme.mockImplementation(async (k: string, o: string[]) =>
      k === 'SORUNLU'
        ? { ok: true, kapsam: k, sunucu: 0, parti: 0, ornek: [] }
        : { ok: true, kapsam: `ORTAM:${o.join(',')}`, sunucu: 12, parti: 1, ornek: [] },
    );
    render(<TaraPenceresi onClose={vi.fn()} onBasladi={vi.fn()} />);
    fireEvent.click(screen.getByLabelText(/Yalnız sorunlular/));
    expect(await screen.findByText('Bu kapsamda taranacak sunucu yok.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('checkbox'));
    expect(screen.getByRole('button', { name: /Başlat/ })).toBeDisabled();
    fireEvent.click(screen.getByLabelText(/Ortam seç/));
    expect(await screen.findByText('En az bir ortam seçin.', { selector: 'div[aria-live]' })).toBeInTheDocument();
    fireEvent.click(await screen.findByLabelText('Şimdi tara ortam TEST'));
    expect(await screen.findByText('12 sunucu · 1 parti')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('checkbox', { name: /Onaylıyorum/ }));
    fireEvent.click(screen.getByRole('button', { name: /Başlat/ }));
    await waitFor(() =>
      expect(m.tara).toHaveBeenCalledWith({ kip: 'TAM', kapsam: 'ORTAM', ortamlar: ['TEST'] }),
    );
  });

  it('satır seçiminden gelen liste hazır açılır', () => {
    render(<TaraPenceresi onClose={vi.fn()} onBasladi={vi.fn()} baslangicListesi={['APPSRV01', 'APPSRV02']} />);
    expect(screen.getByLabelText('Sunucu listesi')).toHaveValue('APPSRV01\nAPPSRV02');
    expect(screen.getByText('2 sunucu')).toBeInTheDocument();
  });
});

describe('EU8 ağaç penceresi', () => {
  it('on binlerce satırda yalnız görünenler DOM’da; arama süzer', () => {
    const satirlar: EarAgacSatiri[] = Array.from({ length: 20000 }, (_, i) => [
      `A.war/WEB-INF/classes/p/C${i}.class`,
      'F',
      '-rw-r--r--',
      1,
      1,
      100,
      1761000000,
      i,
      '',
    ]);
    satirlar.push([
      'A.war/WEB-INF/lib/ozel-1.0.jar',
      'F',
      '-rw-r--r--',
      1,
      1,
      100,
      1761000000,
      99999,
      '',
    ]);
    render(
      <AgacGoruntuleyici
        agac={{ ok: true, host: 'H', kosu: 1, taranmaUtc: null, uygulama: {}, satirlar }}
      />,
    );
    const kutu = screen.getByTestId('ear-agac');
    const cizilen = kutu.querySelectorAll('[title]').length;
    expect(cizilen).toBeGreaterThan(10);
    expect(cizilen).toBeLessThan(100);
    expect(
      screen.getByText(/20\.001 \/ 20\.001 giriş|20,001 \/ 20,001 giriş|20001 \/ 20001 giriş/),
    ).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Ağaçta ara'), { target: { value: 'ozel' } });
    expect(kutu.querySelectorAll('[title]').length).toBe(1);
    expect(pencereAraligi(0, 20001)).toEqual([0, 35]);
    expect(pencereAraligi(22 * 1000, 20001)).toEqual([980, 1035]);
    expect(pencereAraligi(22 * 20000, 10)).toEqual([0, 10]);
    expect(pencereAraligi(22 * 20000, 20001)).toEqual([19966, 20001]);
  });
});

describe('EU7 sekme kaydı', () => {
  it('Server Hub sekmesi', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'ServerHubPage.tsx'), 'utf8');
    expect(src).toMatch(/\{ id: 'envanter', label: 'Uygulama Envanteri' \}/);
    expect(src).toMatch(/\{tab === 'envanter' && <EarEnvanterTab \/>\}/);
  });
});
