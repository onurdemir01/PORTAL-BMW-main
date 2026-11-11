// src/components/server_hub/__tests__/retirement-analizi.test.tsx — Server Hub > Retirement Analizi (2026-11-07).
//
//   RN1 aramasız ekran: karar sayıları, liste; çip süzer; "Bilinen" ayrı bölümde ve listede yok
//   RN2 arama -> uygulama kartı: büyük karar cümlesi, tek satır ana şüphe (engel önce), en çok 3 yapılabilecek;
//       "Retirement kaydı" yalnız Retirement formunu doldurur (onRetirementAc)
//   RN3 Ayrıntı modalı: yalnız ilk bölüm açık; Bilinen maddeler ayrı grupta; çelişki ve eksik listede
//   RN4 notlar: ekle (gövde doğru), "veri değişti" rozeti, arşivle; yayılan not "buradan geldi" (düzenlenemez)
//   RN5 hata durumları: liste ve kart okunamazsa LoadError ("yok" denmez); notlar okunamadı bandı
//   RN6 karar olmayan varlık (vhost): bağlı uygulamaya geçiş
//   RN7 tonlar: ölçülemeyen / karar verilemeyen yeşil değil; ana şüphe bilinenleri atlar; sekme kayıtlı
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { render } from '@/test/test-utils';
import type { ShKararAyrinti, ShKararlarSonuc, ShMadde, ShSinif } from '@/api/serverHubApi';

const m = vi.hoisted(() => ({
  iliskiKararlar: vi.fn(),
  iliskiKarar: vi.fn(),
  iliskiAra: vi.fn(),
  iliskiVarlik: vi.fn(),
  notEkle: vi.fn(),
  notGuncelle: vi.fn(),
  notArsivle: vi.fn(),
}));
vi.mock('@/api/serverHubApi', async (orig) => ({
  ...(await orig<typeof import('@/api/serverHubApi')>()),
  serverHubApi: m,
}));
vi.mock('@/hooks/useToast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import RetirementAnaliziTab, {
  KARAR_TON,
  anaSupheOf,
} from '@/components/server_hub/RetirementAnaliziTab';

const SINIF: ShSinif[] = [
  { ad: 'BILINEN', baslik: 'Bilinen', renk: 'notr', etki: 'BILINEN', aciklama: '', sira: 10 },
  {
    ad: 'DUZELTILECEK',
    baslik: 'Düzeltilecek',
    renk: 'uyari',
    etki: 'BILGI',
    aciklama: '',
    sira: 30,
  },
];
const say = { KULLANIMDA: 1, RETIRE_ADAYI: 1, SUPHELI: 0, KARAR_VERILEMEZ: 0, SORUN_YOK: 0 };
const liste = (): ShKararlarSonuc => ({
  ok: true,
  sayilar: say,
  bilinenSayisi: 1,
  notOkunamadi: false,
  siniflar: SINIF,
  yetimNotSayisi: 2,
  uygulamalar: [
    {
      anahtar: 'app:APP1',
      ad: 'APP1',
      karar: 'RETIRE_ADAYI',
      kararMetni: 'Retire adayı — son kontroller kaldı',
      ozet: '1 kopya: 1 kopya retire adayı',
      sayilar: say,
      notSayisi: 1,
      siniflar: ['DUZELTILECEK'],
      veriDegisti: true,
      bilinen: null,
    },
    {
      anahtar: 'app:APP2',
      ad: 'APP2',
      karar: 'KULLANIMDA',
      kararMetni: 'Kullanımda — retire etme',
      ozet: '1 kopya: 1 kopya kullanımda',
      sayilar: say,
      notSayisi: 0,
      siniflar: [],
      veriDegisti: false,
      bilinen: null,
    },
    {
      anahtar: 'app:ESKI',
      ad: 'ESKI',
      karar: 'SUPHELI',
      kararMetni: 'Şüpheli — elle doğrula',
      ozet: '1 kopya: 1 kopya şüpheli',
      sayilar: say,
      notSayisi: 1,
      siniflar: ['BILINEN'],
      veriDegisti: false,
      bilinen: {
        id: 9,
        sinif: 'BILINEN',
        metin: 'test ortamı, kapalı olması normal',
        konu: 'app:ESKI',
        dogrudan: true,
      },
    },
  ],
});
const madde = (kod: string, etki: ShMadde['etki'], ek: Partial<ShMadde> = {}): ShMadde => ({
  kod,
  katman: 'web',
  etki,
  baslik: `${kod} başlık`,
  metin: `${kod} metin`,
  elle: `${kod} elle`,
  kanit: null,
  bilinen: null,
  ...ek,
});
const ayrinti = (): ShKararAyrinti => ({
  ok: true,
  tur: 'app',
  siniflar: SINIF,
  notOkunamadi: false,
  uygulama: {
    anahtar: 'app:APP1',
    ad: 'APP1',
    karar: 'RETIRE_ADAYI',
    kararMetni: 'Retire adayı — son kontroller kaldı',
    ozet: '1 kopya: 1 kopya retire adayı',
    sayilar: say,
    kopyalar: ['jvm:APPSRV01|8|APP1'],
    yapilabilecekler: [
      {
        tur: 'yonlendir',
        metin: 'Retirement kaydı açılabilir',
        hedef: 'bmw-hub?sekme=retirement',
      },
      { tur: 'elle', metin: 'Uygulama sahibine doğrulatın.' },
    ],
    notlar: [
      {
        id: 5,
        konu: 'app:APP1',
        konu_tur: 'app',
        supheli_kod: null,
        sinif: 'DUZELTILECEK',
        etiketler: ['SCC-1'],
        metin: 'auto-start düzeltilecek',
        yayilim: 'YALNIZ',
        durum: 'AKTIF',
        surum: 3,
        olusturan: 'ayse',
        olusturuldu: null,
        guncelleyen: null,
        guncellendi: null,
        dogrudan: true,
        veriDegisti: true,
      },
      {
        id: 6,
        konu: 'sunucu:APPSRV01',
        konu_tur: 'sunucu',
        supheli_kod: null,
        sinif: 'DUZELTILECEK',
        etiketler: [],
        metin: 'sunucu notu',
        yayilim: 'ZINCIR',
        durum: 'AKTIF',
        surum: 1,
        olusturan: 'ali',
        olusturuldu: null,
        guncelleyen: null,
        guncellendi: null,
        dogrudan: false,
        yol: ['sunucu:APPSRV01', 'jvm:APPSRV01|8|APP1', 'app:APP1'],
      },
    ],
    bilinen: null,
  },
  kopyalar: [
    {
      anahtar: 'jvm:APPSRV01|8|APP1',
      tur: 'jvm',
      ad: 'APP1',
      host: 'APPSRV01',
      env: 'PROD',
      calisiyor: false,
      karar: 'RETIRE_ADAYI',
      kararMetni: 'Retire adayı — son kontroller kaldı',
      maddeler: [
        madde('WEB_TRAFIK_YOK', 'DESTEKLER'),
        madde('JVM_KAPALI', 'DESTEKLER', {
          katman: 'app',
          bilinen: {
            id: 7,
            sinif: 'BILINEN',
            metin: 'planlı kapalı',
            konu: 'jvm:APPSRV01|8|APP1',
            dogrudan: true,
          },
        }),
        madde('BAGLANTI_OLCULMEDI', 'EKSIK'),
      ],
      eksikler: [{ ne: 'web dışı çağrılar', nasil: 'Bağlantı görüntüsünü açın' }],
      celiskiler: [{ anahtar: 'vhost:x', kod: 'TRAFIK_UYUMU', metin: 'Server Hub 0, log 5' }],
      notlar: [],
    },
  ],
});

beforeEach(() => {
  for (const f of Object.values(m)) f.mockReset();
  m.iliskiKararlar.mockResolvedValue(liste());
  m.iliskiKarar.mockResolvedValue(ayrinti());
  m.iliskiAra.mockResolvedValue({
    ok: true,
    sonuclar: [{ anahtar: 'app:APP1', tur: 'app', ad: 'APP1', host: null }],
  });
  m.iliskiVarlik.mockResolvedValue({
    ok: true,
    dugum: { anahtar: 'x', tur: 'jvm', ad: 'x', veri: {}, kaynaklar: [] },
    kenarlar: [],
    bilesen: { boyut: 1, kesildi: false },
    dogrulamalar: {},
  });
  m.notEkle.mockResolvedValue({ ok: true, id: 11, yetim: false });
  m.notArsivle.mockResolvedValue({ ok: true });
});

async function karti(onRetirementAc = vi.fn()) {
  render(<RetirementAnaliziTab onRetirementAc={onRetirementAc} />);
  await screen.findByText('APP2');
  fireEvent.change(screen.getByLabelText('Uygulama, sunucu, vhost, DNS ya da IP ara'), {
    target: { value: 'app1' },
  });
  fireEvent.click(await screen.findByRole('option', { name: /APP1/ }));
  return screen.findByTestId('karar-karti');
}

describe('Retirement Analizi', () => {
  it('RN1 sayılar, liste, çip süzgeci, Bilinen ayrı bölüm', async () => {
    render(<RetirementAnaliziTab />);
    expect(await screen.findByText('APP2')).toBeInTheDocument();
    expect(screen.getByText('APP1')).toBeInTheDocument();
    // Bilinen uygulama listede değil, kendi bölümünde
    const bolum = screen.getByTestId('bilinen-bolumu');
    expect(within(bolum).getByText('ESKI')).toBeInTheDocument();
    expect(screen.getAllByText('ESKI')).toHaveLength(1);
    expect(screen.getByText('Bilinen (sayılmaz)')).toBeInTheDocument();
    expect(screen.getByText(/Konusu artık bulunamayan 2 not var/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Retire adayı/ }));
    await waitFor(() => expect(screen.queryByText('APP2')).not.toBeInTheDocument());
    expect(screen.getByText('APP1')).toBeInTheDocument();
  });

  it('RN2 arama -> kart: karar cümlesi, ana şüphe, en çok 3 yapılabilecek, Retirement yönlendirmesi', async () => {
    const onRetirementAc = vi.fn();
    const kart = await karti(onRetirementAc);
    expect(m.iliskiKarar).toHaveBeenCalledWith('app:APP1');
    expect(within(kart).getByTestId('karar-cumlesi')).toHaveTextContent(
      'Retire adayı — son kontroller kaldı',
    );
    // Ana şüphe: engel yok -> ilk destekleyen, bilinen (JVM_KAPALI) atlanır
    expect(within(kart).getByTestId('ana-suphe')).toHaveTextContent('Şüphe: WEB_TRAFIK_YOK metin');
    const yap = within(kart).getByTestId('yapilabilecekler');
    expect(within(yap).getAllByRole('listitem').length).toBeLessThanOrEqual(3);
    // FAZ 0 (2026-11-11): eski sunucu yaniti yonlendirme tasisa bile karttan kayit acilamaz.
    expect(within(yap).queryByRole('button', { name: 'Retirement kaydı açılabilir' })).toBeNull();
    expect(within(yap).getByText('Retirement kaydı açılabilir')).toBeInTheDocument();
    expect(onRetirementAc).not.toHaveBeenCalled();
  });

  it('RN3 Ayrıntı modalı: yalnız ilk bölüm açık; Bilinen ayrı; çelişki ve eksik', async () => {
    const kart = await karti();
    fireEvent.click(within(kart).getByRole('button', { name: 'Ayrıntı' }));
    const modal = await screen.findByTestId('ayrinti-modal');
    const bolumler = modal.querySelectorAll(':scope > details');
    expect(bolumler.length).toBe(5);
    expect([...bolumler].map((d) => (d as HTMLDetailsElement).open)).toEqual([
      true,
      false,
      false,
      false,
      false,
    ]);
    const neden = bolumler[0] as HTMLElement;
    expect(within(neden).getByTestId('bilinen-maddeler')).toHaveTextContent(
      'JVM_KAPALI başlık — not: planlı kapalı',
    );
    // bilinen madde ana listede İKİNCİ kez görünmez (yalnız Bilinen bloğunda)
    expect(within(neden).getAllByText(/JVM_KAPALI başlık/)).toHaveLength(1);
    expect(within(neden).getByText('Retire lehine')).toBeInTheDocument();
    expect(within(neden).getByText('Eksik ya da çelişkili veri')).toBeInTheDocument();
    expect(
      within(bolumler[2] as HTMLElement).getByText(/TRAFIK_UYUMU — Server Hub 0, log 5/),
    ).toBeInTheDocument();
    expect(
      within(bolumler[2] as HTMLElement).getByText(/web dışı çağrılar — Bağlantı görüntüsünü açın/),
    ).toBeInTheDocument();
  });

  it('RN4 notlar: ekle, veri değişti, arşivle; yayılan not düzenlenmez', async () => {
    const kart = await karti();
    fireEvent.click(within(kart).getByRole('button', { name: 'Ayrıntı' }));
    const modal = await screen.findByTestId('ayrinti-modal');
    const notBolumu = [...modal.querySelectorAll(':scope > details')][4] as HTMLElement;
    expect(within(notBolumu).getByText('veri değişti, tekrar bakın')).toBeInTheDocument();
    expect(within(notBolumu).getByText(/buradan geldi: sunucu:APPSRV01/)).toBeInTheDocument();
    // yayılan notta Düzenle / Arşivle yok: yalnız doğrudan not (id 5) için bir çift
    expect(within(notBolumu).getAllByRole('button', { name: 'Arşivle' })).toHaveLength(1);
    fireEvent.click(within(notBolumu).getByRole('button', { name: 'Arşivle' }));
    await waitFor(() => expect(m.notArsivle).toHaveBeenCalledWith(5));
    fireEvent.click(within(notBolumu).getByRole('button', { name: 'Not ekle' }));
    const form = within(notBolumu).getByTestId('not-formu');
    fireEvent.change(within(form).getByLabelText('Not sınıfı'), { target: { value: 'BILINEN' } });
    fireEvent.change(within(form).getByLabelText('Şüphe'), { target: { value: 'WEB_TRAFIK_YOK' } });
    fireEvent.change(within(form).getByLabelText('Yayılım'), { target: { value: 'ASAGI' } });
    fireEvent.change(within(form).getByLabelText('Etiketler'), {
      target: { value: 'SCC-9, geçiş ,' },
    });
    fireEvent.change(within(form).getByLabelText('Not metni'), {
      target: { value: 'trafik OCP kopyasına alındı' },
    });
    fireEvent.click(within(form).getByRole('button', { name: 'Kaydet' }));
    await waitFor(() =>
      expect(m.notEkle).toHaveBeenCalledWith({
        konu: 'app:APP1',
        sinif: 'BILINEN',
        supheli_kod: 'WEB_TRAFIK_YOK',
        etiketler: ['SCC-9', 'geçiş'],
        metin: 'trafik OCP kopyasına alındı',
        yayilim: 'ASAGI',
      }),
    );
  });

  it('RN4b düzenleme sürüm kilidini taşır', async () => {
    m.notGuncelle.mockResolvedValue({ ok: true, id: 5 });
    const kart = await karti();
    fireEvent.click(within(kart).getByRole('button', { name: 'Ayrıntı' }));
    const modal = await screen.findByTestId('ayrinti-modal');
    const notBolumu = [...modal.querySelectorAll(':scope > details')][4] as HTMLElement;
    fireEvent.click(within(notBolumu).getByRole('button', { name: 'Düzenle' }));
    const form = within(notBolumu).getByTestId('not-formu');
    expect(within(form).getByLabelText('Not metni')).toHaveValue('auto-start düzeltilecek');
    fireEvent.change(within(form).getByLabelText('Not metni'), {
      target: { value: 'auto-start kapatıldı' },
    });
    fireEvent.click(within(form).getByRole('button', { name: 'Güncelle' }));
    await waitFor(() =>
      expect(m.notGuncelle).toHaveBeenCalledWith(
        5,
        expect.objectContaining({ metin: 'auto-start kapatıldı', surum: 3 }),
      ),
    );
    expect(m.notEkle).not.toHaveBeenCalled();
  });

  it('RN5 hata durumları', async () => {
    m.iliskiKararlar.mockRejectedValueOnce(new Error('424 graf yok'));
    const { unmount } = render(<RetirementAnaliziTab />);
    expect(await screen.findByText('Retirement kararları okunamadı')).toBeInTheDocument();
    expect(screen.queryByText(/Grafikte uygulama yok/)).not.toBeInTheDocument();
    unmount();
    m.iliskiKarar.mockRejectedValueOnce(new Error('409 artık yok'));
    render(<RetirementAnaliziTab />);
    await screen.findByText('APP2');
    fireEvent.change(screen.getByLabelText('Uygulama, sunucu, vhost, DNS ya da IP ara'), {
      target: { value: 'app1' },
    });
    fireEvent.click(await screen.findByRole('option', { name: /APP1/ }));
    expect(await screen.findByText('Varlık okunamadı')).toBeInTheDocument();
  });

  it('RN5b notlar okunamazsa bant', async () => {
    m.iliskiKararlar.mockResolvedValueOnce({ ...liste(), notOkunamadi: true });
    render(<RetirementAnaliziTab />);
    expect(await screen.findByText('Admin notları okunamadı')).toBeInTheDocument();
  });

  it('RN6 vhost: bağlı uygulamaya geçiş', async () => {
    m.iliskiAra.mockResolvedValueOnce({
      ok: true,
      sonuclar: [
        {
          anahtar: 'vhost:WEBSRV01|IHS|app1.ornek.local|80',
          tur: 'vhost',
          ad: 'app1.ornek.local:80',
          host: 'WEBSRV01',
        },
      ],
    });
    m.iliskiVarlik.mockResolvedValueOnce({
      ok: true,
      dugum: {
        anahtar: 'vhost:WEBSRV01|IHS|app1.ornek.local|80',
        tur: 'vhost',
        ad: 'app1.ornek.local:80',
        veri: {},
        kaynaklar: ['faz_w'],
      },
      kenarlar: [
        {
          yon: 'cikis',
          tur: 'yonlendirir',
          guven: 'KESIN',
          durum: 'TEK_KAYNAK',
          celiski: null,
          yontemler: [],
          karsi: { anahtar: 'jvm:APPSRV01|8|APP1', tur: 'jvm', ad: 'APP1' },
        },
      ],
      bilesen: { boyut: 3, kesildi: false },
      dogrulamalar: {},
    });
    render(<RetirementAnaliziTab />);
    await screen.findByText('APP2');
    fireEvent.change(screen.getByLabelText('Uygulama, sunucu, vhost, DNS ya da IP ara'), {
      target: { value: 'app1.ornek' },
    });
    fireEvent.click(await screen.findByRole('option', { name: /app1\.ornek\.local/ }));
    const kart = await screen.findByTestId('varlik-karti');
    fireEvent.click(within(kart).getByRole('button', { name: 'JVM: APP1' }));
    await waitFor(() => expect(m.iliskiKarar).toHaveBeenCalledWith('jvm:APPSRV01|8|APP1'));
  });

  it('RN7 tonlar, ana şüphe, sekme kaydı', () => {
    expect(KARAR_TON.KARAR_VERILEMEZ).not.toBe('iyi');
    expect(KARAR_TON.SUPHELI).not.toBe('iyi');
    expect(KARAR_TON.RETIRE_ADAYI).toBe('kotu');
    expect(anaSupheOf([madde('A', 'DESTEKLER'), madde('B', 'ENGELLER')])!.kod).toBe('B');
    expect(
      anaSupheOf([
        madde('A', 'DESTEKLER', {
          bilinen: { id: 1, sinif: 'BILINEN', metin: 'x', konu: 'app:A', dogrudan: true },
        }),
      ]),
    ).toBeNull();
    const s = readFileSync(join(__dirname, '..', 'ServerHubPage.tsx'), 'utf8');
    expect(s).toContain("{ id: 'analiz', label: 'Retirement Analizi' }");
    expect(s).toMatch(
      /<SekmeKabi id="analiz" etkin=\{tab\}>\s*<RetirementAnaliziSekmesi onRetirementAc=\{retirementAc\} baslangic=\{analizOneri\} \/>/,
    );
  });
});
