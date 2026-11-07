// Not ve sınıf yönetimi (2026-11-08): kullanıcı "her şey admin tarafından editlenebilir, her işlem
// konfigüratif" dedi. Kilitlenenler:
//   - süzgeç sayıları (Aktif / Konusu bulunamayan / Veri değişti / Arşiv) ve "Göster" ile yetim açılışı
//   - arşivle / geri al; kalıcı silme YALNIZ arşivde ve iki adımlı onayla (ilk tık silmez)
//   - geçmiş: her değişiklik ve önceki hali
//   - sınıf: yeni / düzenle (ad değişmez), istemci doğrulaması, varsayılan ve notlu sınıf silinemez
//   - okunamadı ≠ yok: tablo okunamazsa "Henüz not yok" / "0 aktif not" denmez; grafik yoksa yetim "?"
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor, within } from '@testing-library/react';
import { render } from '@/test/test-utils';
import type { ShKararlarSonuc, ShNotlarSonuc, ShSinif } from '@/api/serverHubApi';

const m = vi.hoisted(() => ({
  notlarListe: vi.fn(),
  notGecmisi: vi.fn(),
  notArsivle: vi.fn(),
  notGeriAl: vi.fn(),
  notKaliciSil: vi.fn(),
  sinifKaydet: vi.fn(),
  sinifSil: vi.fn(),
  iliskiKararlar: vi.fn(),
  iliskiKarar: vi.fn(),
  iliskiAra: vi.fn(),
  iliskiVarlik: vi.fn(),
  notEkle: vi.fn(),
  notGuncelle: vi.fn(),
}));
const toastM = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('@/api/serverHubApi', async (orig) => ({
  ...(await orig<typeof import('@/api/serverHubApi')>()),
  serverHubApi: m,
}));
vi.mock('@/hooks/useToast', () => ({ toast: toastM }));

import NotYonetimi, { SINIF_AD_RE } from '@/components/server_hub/NotYonetimi';
import RetirementAnaliziTab from '@/components/server_hub/RetirementAnaliziTab';

const SINIF: ShSinif[] = [
  {
    ad: 'BILINEN',
    baslik: 'Bilinen',
    renk: 'notr',
    etki: 'BILINEN',
    aciklama: '',
    sira: 10,
    varsayilan: true,
  },
  {
    ad: 'DUZELTILECEK',
    baslik: 'Düzeltilecek',
    renk: 'uyari',
    etki: 'BILGI',
    aciklama: '',
    sira: 30,
    varsayilan: true,
  },
  { ad: 'OZEL_A', baslik: 'Özel A', renk: 'bilgi', etki: 'BILGI', aciklama: 'boş sınıf', sira: 60 },
  { ad: 'OZEL_B', baslik: 'Özel B', renk: 'aksan', etki: 'BILGI', aciklama: '', sira: 70 },
];
type N = ShNotlarSonuc['notlar'][number];
const not = (id: number, ek: Partial<N>): N => ({
  id,
  konu: 'app:APP1',
  konu_tur: 'app',
  supheli_kod: null,
  sinif: 'DUZELTILECEK',
  etiketler: [],
  metin: `not ${id}`,
  yayilim: 'YALNIZ',
  durum: 'AKTIF',
  surum: 1,
  olusturan: 'ayse',
  olusturuldu: '2026-11-07T10:00:00.000Z',
  guncelleyen: null,
  guncellendi: null,
  yetim: false,
  veriDegisti: false,
  ...ek,
});
const veri = (ek: Partial<ShNotlarSonuc> = {}): ShNotlarSonuc => ({
  ok: true,
  okunamadi: false,
  hata: '',
  grafikYok: false,
  siniflar: SINIF,
  notlar: [
    not(1, { veriDegisti: true, etiketler: ['SCC-1'], metin: 'auto-start düzeltilecek' }),
    not(2, {
      konu: 'sunucu:ESKISRV',
      konu_tur: 'sunucu',
      sinif: 'OZEL_B',
      yetim: true,
      metin: 'eski sunucu',
    }),
    not(3, { konu: 'app:APP2', sinif: 'BILINEN', durum: 'ARSIV', metin: 'arşivdeki not' }),
    not(4, {
      konu: 'vhost:WEBSRV|IHS|a.ornek|443',
      konu_tur: 'vhost',
      sinif: 'BILINEN',
      metin: 'vhost notu',
    }),
  ],
  ...ek,
});
const notlar = () => screen.queryAllByTestId('yonetim-notu');
const dugme = (ad: string | RegExp, kap: HTMLElement = document.body) =>
  within(kap).getByRole('button', { name: ad });

beforeEach(() => {
  for (const f of [...Object.values(m), toastM.success, toastM.error]) f.mockReset();
  m.notlarListe.mockResolvedValue(veri());
  m.notArsivle.mockResolvedValue({ ok: true });
  m.notGeriAl.mockResolvedValue({ ok: true });
  m.notKaliciSil.mockResolvedValue({ ok: true });
  m.sinifKaydet.mockResolvedValue({ ok: true, okunamadi: false, siniflar: SINIF });
  m.sinifSil.mockResolvedValue({ ok: true, okunamadi: false, siniflar: SINIF });
});

describe('Not ve sınıf yönetimi', () => {
  it('NY1 süzgeç sayıları, arama, sınıf süzgeci; Analizde aç yalnız kartlı ve konusu olan notta', async () => {
    render(<NotYonetimi onKapat={vi.fn()} onAc={vi.fn()} />);
    await screen.findByText('auto-start düzeltilecek');
    for (const ad of ['Aktif 3', 'Konusu bulunamayan 1', 'Veri değişti 1', 'Arşiv 1'])
      expect(dugme(ad)).toBeInTheDocument();
    expect(dugme('Aktif 3')).toHaveAttribute('aria-pressed', 'true');
    expect(notlar()).toHaveLength(3);
    // app:APP1 açılır; yetim sunucu ve vhost (kartı yok) açılmaz
    expect(screen.getAllByRole('button', { name: 'Analizde aç' })).toHaveLength(1);
    fireEvent.change(screen.getByLabelText('Notlarda ara'), { target: { value: 'scc-1' } });
    expect(notlar()).toHaveLength(1);
    fireEvent.change(screen.getByLabelText('Notlarda ara'), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText('Sınıf süzgeci'), { target: { value: 'OZEL_B' } });
    expect(notlar()).toHaveLength(1);
    expect(notlar()[0]).toHaveTextContent('sunucu:ESKISRV');
    fireEvent.change(screen.getByLabelText('Sınıf süzgeci'), { target: { value: '' } });
    fireEvent.click(dugme('Arşiv 1'));
    expect(notlar()).toHaveLength(1);
    const a = notlar()[0];
    expect(a).toHaveTextContent('arşivde');
    expect(within(a).queryByRole('button', { name: 'Arşivle' })).toBeNull();
    expect(dugme('Geri al', a)).toBeInTheDocument();
    expect(dugme('Kalıcı sil', a)).toBeInTheDocument();
  });

  it('NY2 yetim başlangıcı: yalnız konusu bulunamayan; aktif notta kalıcı silme yok', async () => {
    // Arşivdeki yetim not "konusu bulunamayan" sayısına girmez (arşiv zaten kapanmış iş)
    const v = veri();
    v.notlar.push(not(5, { durum: 'ARSIV', yetim: true, metin: 'arşivde yetim' }));
    m.notlarListe.mockResolvedValue(v);
    render(<NotYonetimi baslangic="YETIM" onKapat={vi.fn()} />);
    await screen.findByText('eski sunucu');
    expect(dugme('Konusu bulunamayan 1')).toHaveAttribute('aria-pressed', 'true');
    expect(notlar()).toHaveLength(1);
    expect(notlar()[0]).toHaveTextContent('konusu bulunamadı');
    expect(within(notlar()[0]).queryByRole('button', { name: 'Kalıcı sil' })).toBeNull();
    expect(screen.queryByText('arşivde yetim')).toBeNull();
    expect(dugme('Arşiv 2')).toBeInTheDocument();
  });

  it('NY3 arşivle / geri al / kalıcı sil (iki adım); kapatınca "değişti" bildirilir', async () => {
    const onKapat = vi.fn();
    render(<NotYonetimi onKapat={onKapat} />);
    await screen.findByText('auto-start düzeltilecek');
    fireEvent.click(dugme('Arşivle', notlar()[0]));
    await waitFor(() => expect(m.notArsivle).toHaveBeenCalledWith(1));
    await waitFor(() => expect(m.notlarListe).toHaveBeenCalledTimes(2));
    expect(toastM.success).toHaveBeenCalledWith('Not arşivlendi.');
    fireEvent.click(dugme('Arşiv 1'));
    fireEvent.click(dugme('Geri al', notlar()[0]));
    await waitFor(() => expect(m.notGeriAl).toHaveBeenCalledWith(3));
    // Kalıcı sil: ilk tık yalnız sorar; İptal vazgeçirir; "Evet" siler
    fireEvent.click(dugme('Kalıcı sil', notlar()[0]));
    expect(m.notKaliciSil).not.toHaveBeenCalled();
    const soru = screen.getByRole('group', { name: /Not kalıcı silinsin mi\?/ });
    fireEvent.click(dugme('İptal', soru));
    expect(screen.queryByRole('group', { name: /Not kalıcı silinsin mi\?/ })).toBeNull();
    expect(m.notKaliciSil).not.toHaveBeenCalled();
    fireEvent.click(dugme('Kalıcı sil', notlar()[0]));
    fireEvent.click(dugme('Evet, kalıcı sil'));
    await waitFor(() => expect(m.notKaliciSil).toHaveBeenCalledWith(3));
    expect(m.notArsivle).toHaveBeenCalledTimes(1);
    fireEvent.click(dugme('Kapat'));
    expect(onKapat).toHaveBeenCalledWith(true);
  });

  it('NY3b yazılamazsa hata bildirilir, "değişti" denmez', async () => {
    m.notArsivle.mockRejectedValue(Object.assign(new Error('Not artık yok.'), { status: 409 }));
    const onKapat = vi.fn();
    render(<NotYonetimi onKapat={onKapat} />);
    await screen.findByText('auto-start düzeltilecek');
    fireEvent.click(dugme('Arşivle', notlar()[0]));
    await waitFor(() => expect(toastM.error).toHaveBeenCalledWith('Not artık yok.'));
    expect(m.notlarListe).toHaveBeenCalledTimes(1);
    fireEvent.click(dugme('Kapat'));
    expect(onKapat).toHaveBeenCalledWith(false);
  });

  it('NY4 geçmiş: işlemler ve önceki hali', async () => {
    m.notGecmisi.mockResolvedValue({
      ok: true,
      gecmis: [
        { islem: 'EKLE', onceki: null, kim: 'ayse', zaman: '2026-11-07T10:00:00.000Z' },
        {
          islem: 'GUNCELLE',
          onceki: { sinif: 'BILINEN', metin: 'eski metin' },
          kim: 'ali',
          zaman: '2026-11-07T11:30:00.000Z',
        },
      ],
    });
    render(<NotYonetimi onKapat={vi.fn()} />);
    await screen.findByText('auto-start düzeltilecek');
    fireEvent.click(dugme('Geçmiş', notlar()[0]));
    const g = await screen.findByTestId('not-gecmisi');
    expect(m.notGecmisi).toHaveBeenCalledWith(1);
    expect(g).toHaveTextContent('2026-11-07 10:00 · ayse · eklendi');
    expect(g).toHaveTextContent('ali · güncellendi — önceki: BILINEN · “eski metin”');
  });

  it('NY5 sınıflar: aktif not sayısı; varsayılan ve notlu sınıf silinemez; boş özel sınıf onayla silinir', async () => {
    render(<NotYonetimi baslangic="SINIFLAR" onKapat={vi.fn()} />);
    const satirlar = await screen.findAllByTestId('yonetim-sinifi');
    expect(satirlar).toHaveLength(4);
    const satir = (ad: string) => satirlar.find((s) => s.textContent!.includes(ad))!;
    expect(satir('OZEL_A')).toHaveTextContent('0 aktif not');
    expect(satir('OZEL_B')).toHaveTextContent('1 aktif not');
    expect(dugme('Sil', satir('BILINEN'))).toBeDisabled();
    expect(dugme('Sil', satir('BILINEN'))).toHaveAttribute(
      'title',
      expect.stringContaining('Varsayılan'),
    );
    expect(dugme('Sil', satir('OZEL_B'))).toBeDisabled();
    expect(dugme('Sil', satir('OZEL_B'))).toHaveAttribute(
      'title',
      expect.stringContaining('1 aktif not'),
    );
    fireEvent.click(dugme('Sil', satir('OZEL_A')));
    expect(m.sinifSil).not.toHaveBeenCalled();
    fireEvent.click(dugme('Evet, sil'));
    await waitFor(() => expect(m.sinifSil).toHaveBeenCalledWith('OZEL_A'));
  });

  it('NY6 sınıf formu: istemci doğrulaması, yeni sınıf gövdesi, düzenlemede ad değişmez, hata formu kapatmaz', async () => {
    render(<NotYonetimi baslangic="SINIFLAR" onKapat={vi.fn()} />);
    await screen.findAllByTestId('yonetim-sinifi');
    fireEvent.click(dugme('Yeni sınıf'));
    const form = screen.getByTestId('sinif-formu');
    // Boş form uyarı göstermez ama Kaydet kapalı
    expect(within(form).queryByText(/Ad BÜYÜK_HARF/)).toBeNull();
    expect(dugme('Kaydet', form)).toBeDisabled();
    fireEvent.change(within(form).getByLabelText('Sınıf adı'), { target: { value: 'a' } });
    expect(within(form).getByText(/Ad BÜYÜK_HARF/)).toBeInTheDocument();
    expect(dugme('Kaydet', form)).toBeDisabled();
    fireEvent.change(within(form).getByLabelText('Sınıf adı'), {
      target: { value: 'sahibi onayladi' },
    });
    expect(within(form).getByLabelText('Sınıf adı')).toHaveValue('SAHIBI_ONAYLADI');
    fireEvent.change(within(form).getByLabelText('Sınıf başlığı'), {
      target: { value: ' Sahibi onayladı ' },
    });
    fireEvent.change(within(form).getByLabelText('Sınıf rengi'), { target: { value: 'basari' } });
    fireEvent.change(within(form).getByLabelText('Sınıf etkisi'), { target: { value: 'BILINEN' } });
    fireEvent.click(dugme('Kaydet', form));
    await waitFor(() =>
      expect(m.sinifKaydet).toHaveBeenCalledWith({
        ad: 'SAHIBI_ONAYLADI',
        baslik: 'Sahibi onayladı',
        renk: 'basari',
        etki: 'BILINEN',
        aciklama: '',
        sira: 100,
      }),
    );
    await waitFor(() => expect(screen.queryByTestId('sinif-formu')).toBeNull());
    // Düzenle: ad salt okunur; sunucu reddi formu açık bırakır
    m.sinifKaydet.mockRejectedValueOnce(new Error('Sınıf kaydedilemedi: depo'));
    const bilinen = (await screen.findAllByTestId('yonetim-sinifi')).find((s) =>
      s.textContent!.includes('BILINEN'),
    )!;
    fireEvent.click(dugme('Düzenle', bilinen));
    const f2 = screen.getByTestId('sinif-formu');
    expect(within(f2).getByLabelText('Sınıf adı')).toHaveAttribute('readonly');
    fireEvent.change(within(f2).getByLabelText('Sınıf başlığı'), {
      target: { value: 'Biliniyor' },
    });
    fireEvent.click(dugme('Kaydet', f2));
    await waitFor(() => expect(toastM.error).toHaveBeenCalledWith('Sınıf kaydedilemedi: depo'));
    expect(screen.getByTestId('sinif-formu')).toBeInTheDocument();
    expect(SINIF_AD_RE.test('SAHIBI_ONAYLADI')).toBe(true);
    expect(SINIF_AD_RE.test('1ABC')).toBe(false);
  });

  it('NY7 okunamadı ≠ yok: liste hatası yeniden denenir; tablo okunamazsa sayı "?"; grafik yoksa yetim "?"', async () => {
    m.notlarListe.mockRejectedValueOnce(new Error('Sunucu hatası (HTTP 424).'));
    const { unmount } = render(<NotYonetimi onKapat={vi.fn()} />);
    expect(await screen.findByText('Notlar okunamadı')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Tekrar dene|Yeniden dene/ }));
    expect(await screen.findByText('auto-start düzeltilecek')).toBeInTheDocument();
    unmount();

    m.notlarListe.mockResolvedValue(veri({ okunamadi: true, hata: 'tablo yok', notlar: [] }));
    const { unmount: u2 } = render(<NotYonetimi onKapat={vi.fn()} />);
    expect(
      await screen.findByText(/Not tablosu okunamadı; notlar gösterilemiyor/),
    ).toBeInTheDocument();
    expect(screen.queryByText('Henüz not yok.')).toBeNull();
    fireEvent.click(dugme(/^Sınıflar/));
    const sat = await screen.findAllByTestId('yonetim-sinifi');
    expect(sat[0]).toHaveTextContent('? aktif not');
    expect(screen.queryByText(/· 0 aktif not/)).toBeNull();
    u2();

    m.notlarListe.mockResolvedValue(veri({ grafikYok: true }));
    render(<NotYonetimi onKapat={vi.fn()} />);
    expect(await screen.findByText(/İlişki grafiği okunamadı/)).toBeInTheDocument();
    expect(dugme('Konusu bulunamayan ?')).toBeInTheDocument();
    expect(dugme('Veri değişti ?')).toBeInTheDocument();
  });

  it('NY8 Analizde aç: kaydı seçer ve pencereyi kapatır', async () => {
    const onAc = vi.fn();
    const onKapat = vi.fn();
    render(<NotYonetimi onKapat={onKapat} onAc={onAc} />);
    await screen.findByText('auto-start düzeltilecek');
    fireEvent.click(dugme('Analizde aç'));
    expect(onAc).toHaveBeenCalledWith('app:APP1');
    expect(onKapat).toHaveBeenCalledWith(false);
  });

  it('NY9 Retirement Analizi: düğme ve "Göster" pencereyi açar; değişiklikten sonra kararlar tazelenir', async () => {
    const liste: ShKararlarSonuc = {
      ok: true,
      sayilar: { RETIRE_ADAYI: 0, SUPHELI: 0, KARAR_VERILEMEZ: 0, KULLANIMDA: 0, SORUN_YOK: 0 },
      bilinenSayisi: 0,
      notOkunamadi: false,
      siniflar: SINIF,
      yetimNotSayisi: 1,
      uygulamalar: [],
    };
    m.iliskiKararlar.mockResolvedValue(liste);
    render(<RetirementAnaliziTab />);
    await screen.findByText(/Konusu artık bulunamayan 1 not var/);
    fireEvent.click(dugme('Göster'));
    await screen.findByText('eski sunucu');
    expect(dugme('Konusu bulunamayan 1')).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(dugme('Kapat'));
    await waitFor(() => expect(screen.queryByTestId('not-yonetimi')).toBeNull());
    expect(m.iliskiKararlar).toHaveBeenCalledTimes(1);
    fireEvent.click(dugme('Notlar ve sınıflar'));
    await screen.findByText('auto-start düzeltilecek');
    fireEvent.click(dugme('Arşivle', notlar()[0]));
    await waitFor(() => expect(m.notArsivle).toHaveBeenCalledWith(1));
    fireEvent.click(dugme('Kapat'));
    await waitFor(() => expect(m.iliskiKararlar).toHaveBeenCalledTimes(2));
  });
});
