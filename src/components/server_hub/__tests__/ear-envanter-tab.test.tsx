// src/components/server_hub/__tests__/ear-envanter-tab.test.tsx — Server Hub › Uygulama Envanteri ekranı.
//
//   EU1 template tanımlı değilse uyarı bandı ve "Şimdi tara" kapalı; haftalık tarama kapalı yazar
//   EU2 özet okunamazsa "okunamadı" (boş durum DEĞİL) ve tekrar dene
//   EU3 çalışan koşu: ilerleme, partiler, AWX iş no; İptal onaydan sonra API'ye gider
//   EU4 Şimdi tara: geçersiz ad varken Başlat kapalı; seçili liste API'ye kapsam SECILI ile gider;
//       filo onay kutusu olmadan başlamaz; çift tık TEK istek
//   EU5 uygulama listesi: kısmi durum yeşil değil; satır ayrıntıyı açar (WAR, kütüphane, kopyalar)
//   EU6 ayarlar: haftalık taramayı açmak onay ister; kaydet API'ye anahtar + değer gider
//   EU7 Server Hub sekme kaydı (kaynak)
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
      deger: { zamanlayici: 'KAPALI', gun: '0', saat: '02:00', kip: 'TAM', parti_tam: '50' },
      kayitlar: {},
      okunamadi: false,
      hata: '',
      tanimlar: [
        { anahtar: 'zamanlayici', ad: 'Haftalık tarama', varsayilan: 'KAPALI' },
        { anahtar: 'parti_tam', ad: 'TAM parti boyutu', varsayilan: '50' },
      ],
    },
    zamanlayici: { acik: false, metin: 'Pazar 02:00 (TR), TAM kip', sonraki: null },
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
    const kismi = await screen.findByText('kısmi · sınır');
    expect(kismi.closest('[data-ton]')).toHaveAttribute('data-ton', 'uyari');
    expect(screen.getAllByText('tam')[0].closest('[data-ton]')).toHaveAttribute('data-ton', 'iyi');
    fireEvent.click(screen.getAllByRole('button', { name: 'ORNEKPANEL.ear' })[0]);
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

  it('EU6 haftalık taramayı açmak onay ister', async () => {
    m.ozet.mockResolvedValue(ozet());
    m.ayarYaz.mockResolvedValue({ ok: true, anahtar: 'zamanlayici', eski: 'KAPALI', yeni: 'ACIK' });
    render(<EarEnvanterTab />);
    fireEvent.click(await screen.findByRole('button', { name: 'Ayarlar' }));
    fireEvent.change(screen.getByLabelText('Haftalık tarama'), { target: { value: 'ACIK' } });
    const satir = screen.getByLabelText('Haftalık tarama').closest('tr') as HTMLElement;
    fireEvent.click(within(satir).getByRole('button', { name: 'Kaydet' }));
    expect(m.ayarYaz).not.toHaveBeenCalled();
    const pencere = await screen.findByRole('dialog');
    fireEvent.click(within(pencere).getByRole('button', { name: 'Aç' }));
    await waitFor(() => expect(m.ayarYaz).toHaveBeenCalledWith('zamanlayici', 'ACIK'));
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
    render(<TaraPenceresi onClose={vi.fn()} onBasladi={vi.fn()} />);
    const pencereler = screen.getAllByRole('dialog');
    const p = pencereler[pencereler.length - 1];
    fireEvent.click(within(p).getByLabelText(/Tüm filo/));
    const b2 = within(p).getByRole('button', { name: /Başlat/ });
    expect(b2).toBeDisabled();
    fireEvent.click(within(p).getByRole('checkbox'));
    fireEvent.click(b2);
    await waitFor(() => expect(m.tara).toHaveBeenCalledWith({ kip: 'TAM', kapsam: 'FILO' }));
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
