// @vitest-environment jsdom
// Self Servis Tasima islem pencereleri (2026-11-25, kapsam PR-2; dal %37). SelfServisTasima.test.tsx tasi / geri al /
// deneme penceresinin kilitlerini sinar; burada akislarin geri kalani:
//   survey yaz: ozet, silinecek sorular, parola uyarisi, onaysiz yazilmaz, hash yoksa yazilmaz, geri okuma farki,
//               parola elle listesi, kapatma kipi
//   deneme: senaryodan baslangic, gecersiz JSON, hedef ayar uzerine yazma onayi, dogrulama, kostur + yoklama, Smart talebi
//   tasi: gecerli deneme ile / gerekceli denemesiz, yaris uyarisi, red
//   geri al: onay gereken degisiklikler, engel / okunamayan, bilgi degisiklikleri, red ve istek hatasi
import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SsTasimaSatiri } from '@/api/ssTasimaApi';

const api = vi.hoisted(() => ({ surveySpecAdmin: vi.fn(), ssJobStatus: vi.fn() }));
vi.mock('@/api/ansibleApi', () => ({ ansibleApi: api }));
const tasima = vi.hoisted(() => ({
  detay: vi.fn(),
  surveyYaz: vi.fn(),
  deneme: vi.fn(),
  tasi: vi.fn(),
  geriAlOnizleme: vi.fn(),
  geriAl: vi.fn(),
}));
vi.mock('@/api/ssTasimaApi', () => ({ ssTasimaApi: tasima }));
const toast = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }));
vi.mock('@/hooks/useToast', () => ({ toast }));

import {
  DenemePenceresi,
  GeriAlPenceresi,
  SurveyYazPenceresi,
  TasiPenceresi,
} from '../tabs/SelfServisTasimaPencereleri';

const satir = (ek: Partial<SsTasimaSatiri> = {}): SsTasimaSatiri =>
  ({
    itemId: 'a',
    title: 'Servis A',
    kaynakTemplate: { id: 20, name: 'Sablon A' },
    hedefTemplate: { id: 30, name: 'Sablon B' },
    durum: 'HAZIR',
    planHash: 'h1',
    surveyEylemi: 'yaz',
    deneme: null,
    ...ek,
  }) as SsTasimaSatiri;

beforeEach(() => {
  for (const f of [...Object.values(api), ...Object.values(tasima)]) f.mockReset();
  toast.error.mockReset();
  toast.success.mockReset();
  api.surveySpecAdmin.mockResolvedValue({ ok: false });
});
afterEach(() => vi.useRealTimers());

const onayla = (ad: RegExp) => fireEvent.click(screen.getByRole('checkbox', { name: ad }));

describe('SurveyYazPenceresi', () => {
  const detay = (ek: Record<string, unknown> = {}) => ({
    hedefSurveyHash: 'hs1',
    surveyOzet: { kaynakSoru: 4, hedefSoru: 2, parolaSoru: 1 },
    surveyFarki: [
      { variable: 'eski_soru', etiket: 'yalniz_hedefte' },
      { variable: 'ortak', etiket: 'ayni' },
    ],
    ...ek,
  });

  it('ozet, onay, geri okuma farki ve parola elle listesi', async () => {
    tasima.detay.mockResolvedValue(detay());
    tasima.surveyYaz
      .mockResolvedValueOnce({
        ok: false,
        message: 'Geri okuma tutmadi',
        fark: [{ alan: 'default' }],
      })
      .mockResolvedValueOnce({ ok: true, parolaElle: ['db_parola'] });
    const bitti = vi.fn();
    render(<SurveyYazPenceresi satir={satir()} to={3} onKapat={vi.fn()} onBitti={bitti} />);
    expect(await screen.findByText(/hedefte şu an/)).toBeTruthy();
    expect(screen.getByText(/Hedefte silinecek sorular/).textContent).toContain('eski_soru');
    expect(screen.getByText(/Parola varsayılanları kaynaktan kopyalanamaz/)).toBeTruthy();
    const yaz = screen.getByTestId('survey-yaz-onay') as HTMLButtonElement;
    expect(yaz.disabled).toBe(true);
    onayla(/üzerine yazılacağını anladım/);
    fireEvent.click(yaz);
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Geri okuma tutmadi'));
    expect(tasima.surveyYaz).toHaveBeenCalledWith('a', 3, 30, 'hs1');
    expect(screen.getByText(/"alan": "default"/)).toBeTruthy();
    fireEvent.click(yaz);
    expect(
      await screen.findByText(/Şu parola sorularının varsayılanı AWX'te elle girilmeli/),
    ).toBeTruthy();
    expect(toast.success).toHaveBeenCalledWith(expect.stringContaining('db_parola'));
    expect(bitti).not.toHaveBeenCalled();
    expect((screen.getByTestId('survey-yaz-onay') as HTMLButtonElement).disabled).toBe(true);
    // Parola listesi gorulduktan sonra "İptal" bitirir (rapor tazelenir).
    fireEvent.click(screen.getByRole('button', { name: 'İptal' }));
    expect(bitti).toHaveBeenCalled();
  });

  it('kapatma kipi; hash yoksa yazilmaz; basari ve istek hatasi; detay hatasi', async () => {
    tasima.detay.mockResolvedValueOnce(detay({ hedefSurveyHash: null }));
    const bitti = vi.fn();
    const { unmount } = render(
      <SurveyYazPenceresi
        satir={satir({ surveyEylemi: 'kapat' })}
        to={3}
        onKapat={vi.fn()}
        onBitti={bitti}
      />,
    );
    expect(await screen.findByText(/Portal Survey Tasarımcısı kullanıyor/)).toBeTruthy();
    onayla(/üzerine yazılacağını anladım/);
    fireEvent.click(screen.getByTestId('survey-yaz-onay'));
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("Hedef survey'i okunamadı; raporu yenileyin."),
    );
    expect(tasima.surveyYaz).not.toHaveBeenCalled();
    unmount();

    tasima.detay.mockResolvedValueOnce(detay());
    tasima.surveyYaz
      .mockResolvedValueOnce({ ok: true })
      .mockRejectedValueOnce(new Error('ag koptu'));
    const r = render(
      <SurveyYazPenceresi
        satir={satir({ surveyEylemi: 'kapat' })}
        to={3}
        onKapat={vi.fn()}
        onBitti={bitti}
      />,
    );
    await screen.findByText(/Portal Survey Tasarımcısı/);
    onayla(/üzerine yazılacağını anladım/);
    fireEvent.click(screen.getByTestId('survey-yaz-onay'));
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith('Hedef survey kapatıldı ve doğrulandı.'),
    );
    expect(bitti).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTestId('survey-yaz-onay'));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('ag koptu'));
    r.unmount();

    tasima.detay.mockRejectedValueOnce(new Error('Detay yok'));
    render(<SurveyYazPenceresi satir={satir()} to={3} onKapat={vi.fn()} onBitti={vi.fn()} />);
    expect(await screen.findByText('Detay yok')).toBeTruthy();
  });
});

describe('DenemePenceresi', () => {
  it('senaryo, gecersiz JSON, uzerine yazma onayi, dogrulama ve kostur + yoklama', async () => {
    api.surveySpecAdmin.mockResolvedValue({
      ok: true,
      surveyEnabled: true,
      fields: [
        { name: 'hedef', label: 'Hedef', type: 'text', required: true, defaultValue: 'ORNAPP01' },
      ],
    });
    tasima.deneme
      .mockResolvedValueOnce({
        ok: false,
        onayGerekli: true,
        degisiklikler: [{ alan: 'smart', once: null, simdi: true }],
      })
      .mockResolvedValueOnce({ ok: true, valid: true, resolvedExtraVars: { hedef: 'ORNAPP01' } })
      .mockResolvedValueOnce({ ok: true, jobId: 901 });
    api.ssJobStatus
      .mockRejectedValueOnce(new Error('gecici'))
      .mockResolvedValueOnce({ status: 'successful' });
    const bitti = vi.fn();
    render(<DenemePenceresi satir={satir()} to={3} onKapat={vi.fn()} onBitti={bitti} />);
    const metin = (await screen.findByDisplayValue(/ORNAPP01/)) as HTMLTextAreaElement;
    expect(api.surveySpecAdmin).toHaveBeenCalledWith(3, 30);
    fireEvent.change(metin, { target: { value: '[1]' } });
    fireEvent.click(screen.getByRole('button', { name: 'Hazırla ve doğrula' }));
    expect(toast.error).toHaveBeenCalledWith('extraVars geçerli bir JSON nesnesi olmalı.');
    expect(tasima.deneme).not.toHaveBeenCalled();
    fireEvent.change(metin, { target: { value: '{"hedef":"ORNAPP01"}' } });
    fireEvent.click(screen.getByRole('button', { name: 'Hazırla ve doğrula' }));
    expect(await screen.findByText(/Hedefte mevcut ayar var, üzerine yazılacak/)).toBeTruthy();
    expect(screen.getByText('smart').closest('li')?.textContent).toBe('smart: — → true');
    expect(
      (screen.getByRole('button', { name: 'Hazırla ve doğrula' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    onayla(/Hedefteki ayarın üzerine yazılsın/);
    fireEvent.click(screen.getByRole('button', { name: 'Hazırla ve doğrula' }));
    expect(await screen.findByText(/Doğrulama geçti/)).toBeTruthy();
    expect(tasima.deneme.mock.calls[1][1]).toMatchObject({
      sadeceDogrula: true,
      hedefAyarUzerineYaz: true,
      toT: 30,
    });
    const kostur = screen.getByTestId('deneme-kostur') as HTMLButtonElement;
    expect(kostur.disabled).toBe(true);
    onayla(/GERÇEK bir iştir/);
    vi.useFakeTimers({ shouldAdvanceTime: true });
    fireEvent.click(kostur);
    await waitFor(() => expect(screen.getByTestId('deneme-durum').textContent).toContain('#901'));
    expect(tasima.deneme.mock.calls[2][1]).toMatchObject({ sadeceDogrula: false, confirm: true });
    await act(async () => {
      vi.advanceTimersByTime(5000);
    });
    await waitFor(() => expect(bitti).toHaveBeenCalled());
    expect(screen.getByTestId('deneme-durum').textContent).toContain('successful');
  });

  it('gecersiz dogrulama ve Smart talebi; red ve hata mesajlari', async () => {
    tasima.deneme
      .mockResolvedValueOnce({ ok: true, valid: false, message: 'Zorunlu alan eksik' })
      .mockResolvedValueOnce({ ok: false, message: 'Hedef kilitli' })
      .mockRejectedValueOnce(new Error('ag koptu'))
      .mockResolvedValueOnce({ ok: true, valid: true })
      .mockResolvedValueOnce({ ok: true, pendingApproval: true, ticketId: 55 });
    const bitti = vi.fn();
    render(<DenemePenceresi satir={satir()} to={3} onKapat={vi.fn()} onBitti={bitti} />);
    const dogrula = () =>
      fireEvent.click(screen.getByRole('button', { name: 'Hazırla ve doğrula' }));
    dogrula();
    expect(await screen.findByText('Doğrulama başarısız: Zorunlu alan eksik')).toBeTruthy();
    expect(screen.queryByRole('checkbox', { name: /GERÇEK bir iştir/ })).toBeNull();
    dogrula();
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Hedef kilitli'));
    dogrula();
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('ag koptu'));
    dogrula();
    await screen.findByText(/Doğrulama geçti/);
    onayla(/GERÇEK bir iştir/);
    fireEvent.click(screen.getByTestId('deneme-kostur'));
    expect(await screen.findByText(/Gerçek bir Smart talebi açıldı \(#55\)/)).toBeTruthy();
    expect(bitti).toHaveBeenCalled();
  });
});

describe('TasiPenceresi', () => {
  it('gecerli deneme ile tasir; yaris uyarisi ve red', async () => {
    tasima.tasi
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: true, yarisUyarisi: 'Kart bu sirada degisti' })
      .mockResolvedValueOnce({ ok: false, message: 'Plan eskidi' })
      .mockRejectedValueOnce(new Error('ag koptu'));
    const bitti = vi.fn();
    render(
      <TasiPenceresi
        satir={satir({ deneme: { gecerli: true, jobId: 901 } } as never)}
        to={3}
        onKapat={vi.fn()}
        onBitti={bitti}
      />,
    );
    expect(screen.getByText(/Geçerli deneme koşusu: iş #901 başarılı/)).toBeTruthy();
    const tasi = screen.getByTestId('tasi-onay');
    fireEvent.click(tasi);
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Servis A hedefe taşındı.'));
    expect(tasima.tasi).toHaveBeenCalledWith('a', { to: 3, toT: 30, planHash: 'h1' });
    fireEvent.click(tasi);
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Kart bu sirada degisti'));
    expect(bitti).toHaveBeenCalledTimes(2);
    fireEvent.click(tasi);
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Plan eskidi'));
    fireEvent.click(tasi);
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('ag koptu'));
    expect(bitti).toHaveBeenCalledTimes(2);
  });

  it('denemesiz tasima gerekce ister; HAZIR olmayan servis tasinmaz', () => {
    const { unmount } = render(
      <TasiPenceresi
        satir={satir({ deneme: { gecerli: false, neden: 'eski' } } as never)}
        to={3}
        onKapat={vi.fn()}
        onBitti={vi.fn()}
      />,
    );
    expect(screen.getByText(/Geçerli bir deneme koşusu yok \(eski\)/)).toBeTruthy();
    onayla(/Deneme koşusu olmadan taşı/);
    fireEvent.change(screen.getByLabelText('Denemesiz taşıma gerekçesi'), {
      target: { value: 'acil degisiklik' },
    });
    fireEvent.click(screen.getByTestId('tasi-onay'));
    expect(tasima.tasi).toHaveBeenCalledWith(
      'a',
      expect.objectContaining({ denemesizGerekce: 'acil degisiklik' }),
    );
    unmount();
    render(
      <TasiPenceresi
        satir={satir({ durum: 'ENGEL' })}
        to={3}
        onKapat={vi.fn()}
        onBitti={vi.fn()}
      />,
    );
    onayla(/Deneme koşusu olmadan taşı/);
    fireEvent.change(screen.getByLabelText('Denemesiz taşıma gerekçesi'), {
      target: { value: 'acil degisiklik' },
    });
    expect((screen.getByTestId('tasi-onay') as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('GeriAlPenceresi', () => {
  const onizleme = (ek: Record<string, unknown> = {}) => ({
    bagUygun: true,
    kayit: { id: 9, toTemplate: 30, fromServer: 2, fromTemplate: 20 },
    kaynakSunucuAdi: 'maestro2',
    engeller: [],
    okunamayan: [],
    bilgiDegisiklikleri: [{ alan: 'title', once: 'Eski', simdi: 'Yeni' }],
    onayGerekenDegisiklikler: [
      {
        tur: 'ayar',
        baslik: 'Hedef ayari',
        farklar: [{ alan: 'smart', once: false, simdi: true }],
      },
    ],
    uyarilar: ['Hedefte 2 is gecmisi kalir'],
    ...ek,
  });

  it('onay gereken degisikliklerle geri alir; red ve hata', async () => {
    tasima.geriAlOnizleme.mockResolvedValue(onizleme());
    tasima.geriAl
      .mockResolvedValueOnce({ ok: false, message: 'Kart degisti' })
      .mockRejectedValueOnce(new Error('ag koptu'))
      .mockResolvedValueOnce({ ok: true });
    const bitti = vi.fn();
    render(<GeriAlPenceresi satir={satir()} onKapat={vi.fn()} onBitti={bitti} />);
    expect(
      await screen.findByText(/Kart #30 bağından kaynağa \(maestro2, template #20\)/),
    ).toBeTruthy();
    expect(screen.getByText('Taşımadan sonra kartta değişenler (korunur)')).toBeTruthy();
    expect(screen.getByText('Hedefte 2 is gecmisi kalir')).toBeTruthy();
    const dugme = screen.getByTestId('geri-al-onay') as HTMLButtonElement;
    expect(dugme.textContent).toBe('Geri al');
    expect(dugme.disabled).toBe(true);
    onayla(/Değişiklikleri gördüm, yine de geri al/);
    fireEvent.click(dugme);
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Kart degisti'));
    expect(tasima.geriAl).toHaveBeenCalledWith('a', 9, true, false);
    fireEvent.click(dugme);
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('ag koptu'));
    fireEvent.click(dugme);
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith('Servis A kaynağa geri alındı.'),
    );
    expect(bitti).toHaveBeenCalled();
  });

  it('engel ve okunamayan geri almayi kilitler; sunucu Portal da yoksa yazilir; onizleme hatasi', async () => {
    tasima.geriAlOnizleme.mockResolvedValueOnce(
      onizleme({
        kaynakSunucuAdi: null,
        engeller: [{ anahtar: 'smart', adet: 1, baslik: 'Bekleyen Smart talebi', ipucu: '' }],
        okunamayan: [{ anahtar: 'oco', baslik: 'OCO kayitlari', hata: 'kilitli' }],
        onayGerekenDegisiklikler: [],
        bilgiDegisiklikleri: [],
        uyarilar: [],
      }),
    );
    const { unmount } = render(
      <GeriAlPenceresi satir={satir()} onKapat={vi.fn()} onBitti={vi.fn()} />,
    );
    expect(await screen.findByText(/#2, Portal'da yok/)).toBeTruthy();
    expect(screen.getByText(/Bekleyen Smart talebi/).textContent).toContain(
      '1 × Bekleyen Smart talebi',
    );
    expect(screen.getByText(/Kontrol edilemedi: OCO kayitlari/)).toBeTruthy();
    expect((screen.getByTestId('geri-al-onay') as HTMLButtonElement).disabled).toBe(true);
    unmount();
    tasima.geriAlOnizleme.mockRejectedValueOnce(new Error('Onizleme yok'));
    render(<GeriAlPenceresi satir={satir()} onKapat={vi.fn()} onBitti={vi.fn()} />);
    expect(await screen.findByText('Onizleme yok')).toBeTruthy();
    expect((screen.getByTestId('geri-al-onay') as HTMLButtonElement).disabled).toBe(true);
  });
});
