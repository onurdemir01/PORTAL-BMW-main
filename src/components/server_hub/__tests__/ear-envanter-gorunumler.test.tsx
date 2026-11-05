// src/components/server_hub/__tests__/ear-envanter-gorunumler.test.tsx — Sunucular ve Eşlenikler görünümleri
// (2026-11-05 doğruluk düzeltmeleri).
//
//   EG1 Sunucular: Neden hiç "—" değil (sunucunun yazdığı metin); Playbook okunur dilde, ham kod title'da
//   EG2 Eşlenikler: "aynı sürüm, farklı dosya" kararı; tarih farkı yazılır; ortamı boş sunucular ayrı liste
//   EG3 fark tablosu kategorili: boyut farkında boyut, sürüm farkında sürüm; fark yoksa "birebir aynı",
//       karşılaştırılamadıysa "karşılaştırılmadı" (eski çelişki: "farklı" deyip "aynı" göstermek yok)
//   EG4 JBoss 7 ↔ 8 tablosu kararı motorun kararından okur
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { render } from '@/test/test-utils';
import { SunucularGorunum, EsleniklerGorunum } from '@/components/server_hub/EarEnvanterGorunumler';
import type { EarEslenik, EarEslenikFarki, EarHost } from '@/api/earEnvanterApi';

const m = vi.hoisted(() => ({ eslenikler: vi.fn(), eslenik: vi.fn() }));
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
  kosu_id: 7,
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

beforeEach(() => {
  m.eslenikler.mockReset();
  m.eslenik.mockReset();
});

describe('EG1 Sunucular', () => {
  it('Neden hep dolu, Playbook okunur', () => {
    render(
      <SunucularGorunum
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
    expect(screen.getByText('başarılı · 28 uygulama tam tarandı')).toBeInTheDocument();
    expect(screen.getByText(/3 uygulama eksik tarandı/)).toBeInTheDocument();
    const pb = screen.getAllByText('sonuç geldi');
    expect(pb).toHaveLength(2);
    expect(pb[0].closest('td')).toHaveAttribute('title', 'SONUC');
    expect(screen.queryByText('SONUC')).toBeNull();
  });
});

describe('EG2-EG4 Eşlenikler', () => {
  const kur = (farki: EarEslenikFarki) => {
    m.eslenikler.mockResolvedValue({
      ok: true,
      gruplar: [grup()],
      ikiNesil: [
        {
          host: 'APPSRV03',
          uygulama: 'B.ear',
          ortam: 'TEST',
          karar: 'AYNI_SURUM_FARKLI_DOSYA',
          kutuphane: 'AYNI_SURUM_FARKLI_DOSYA',
          yapi: 'AYNI',
          ayni_kutuphane: false,
        },
      ],
      ortamYok: [
        { uygulama: 'C.ear', jboss: '7', host_sayisi: 2, kopya_sayisi: 2, hostlar: ['X1', 'X2'] },
      ],
    });
    m.eslenik.mockResolvedValue(farki);
  };

  it('EG2 karar etiketi, tarih farkı, ortam bilinmiyor', async () => {
    kur(fark({}));
    render(<EsleniklerGorunum />);
    expect(await screen.findByText('40 gün tarama farkı')).toBeInTheDocument();
    expect(screen.getAllByText('aynı sürüm, farklı dosya').length).toBe(2);
    expect(screen.getByText(/Ortam bilinmiyor: karşılaştırılmadı \(1\)/)).toBeInTheDocument();
    expect(screen.getByText('C.ear (JBoss 7): X1, X2')).toBeInTheDocument();
  });

  it('EG3 fark tablosu kategorili; boyut farkında boyut yazar', async () => {
    kur(
      fark({
        farklar: [
          {
            kategori: 'BOYUT',
            konum: 'ODEME.war',
            kutuphane: 'spring-core',
            degerler: {
              'APPSRV01|/vhosting8|ODEME.ear': [['6.1.0', 2048]],
              'APPSRV02|/vhosting8|ODEME.ear': [['6.1.0', 4096]],
            },
          },
        ],
        toplam: 1,
        sayilar: { WAR: 0, EKSIK: 0, SURUM: 0, BOYUT: 1 },
      }),
    );
    render(<EsleniklerGorunum />);
    fireEvent.click(await screen.findByText('ODEME.ear'));
    expect(await screen.findByText('6.1.0 (2.0 KB)')).toBeInTheDocument();
    expect(screen.getByText('6.1.0 (4.0 KB)')).toBeInTheDocument();
    expect(screen.getByText(/aynı sürüm, boyut farklı: 1/)).toBeInTheDocument();
    expect(m.eslenik).toHaveBeenCalledWith('ODEME.ear', 'PROD', '8', { limit: 2000 });
  });

  it('EG3 fark yoksa birebir aynı; karşılaştırılamadıysa karşılaştırılmadı', async () => {
    kur(fark({}));
    m.eslenikler.mockResolvedValueOnce({
      ok: true,
      gruplar: [grup({ karar: 'AYNI', kutuphane: 'AYNI', tarih_farki_gun: 0 })],
      ikiNesil: [],
      ortamYok: [],
    });
    const { unmount } = render(<EsleniklerGorunum />);
    fireEvent.click(await screen.findByText('ODEME.ear'));
    expect(await screen.findByText(/birebir aynı/)).toBeInTheDocument();
    unmount();
    m.eslenikler.mockResolvedValueOnce({
      ok: true,
      gruplar: [
        grup({
          karar: 'EKSIK_TARAMA',
          kutuphane: 'KARSILASTIRILAMADI',
          yapi: 'KARSILASTIRILAMADI',
        }),
      ],
      ikiNesil: [],
      ortamYok: [],
    });
    render(<EsleniklerGorunum />);
    fireEvent.click(await screen.findByText('ODEME.ear'));
    await waitFor(() =>
      expect(screen.getByText(/Kütüphaneler karşılaştırılmadı/)).toBeInTheDocument(),
    );
    expect(screen.queryByText(/birebir aynı/)).toBeNull();
  });
});
