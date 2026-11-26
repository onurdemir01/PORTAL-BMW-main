// @vitest-environment jsdom
// Self Servis Tasima detay cekmecesi (2026-11-24, kapsam PR-2; %0): hedef secilmeden uyari, yukleme hatasi, tasinmis
// servis (tutarli / tutarsiz), template karsilastirmasi (olculemedi, acik / kapali), survey farki (aynilarin gizlenip
// acilmasi, parola varsayilani kopyalanmaz, farkli alan -> hedef degeri), uyum / tahmin, engeller / okunamayanlar /
// uyarilar, kayit listesi ve kapatma (dugme, arka plan, ESC).
import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SsTasimaDetay } from '@/api/ssTasimaApi';

const api = vi.hoisted(() => ({ detay: vi.fn() }));
vi.mock('@/api/ssTasimaApi', () => ({ ssTasimaApi: api }));

import SelfServisTasimaDetay, { KayitListesi } from '../tabs/SelfServisTasimaDetay';

const alan = (ek: Record<string, unknown> = {}) => ({
  question_name: 'Ortam',
  type: 'multiplechoice',
  required: true,
  default: 'qa',
  choices: ['qa', 'prod'],
  min: null,
  max: null,
  parola: false,
  ...ek,
});
const kayit = (ek: Record<string, unknown> = {}) => ({
  id: 1,
  status: 'TASINDI',
  fromServer: 1,
  fromTemplate: 41,
  toServer: 2,
  toTemplate: 51,
  eslesme: 'ad',
  createdBy: 'adm1',
  createdAt: '2026-11-20T10:00:00Z',
  tasiyan: 'adm2',
  tasindiAt: '2026-11-21T10:00:00Z',
  geriAlan: null,
  geriAlindiAt: null,
  denemeJobId: 700,
  surveyYazildi: true,
  denemesizGerekce: null,
  ...ek,
});
const detay = (ek: Record<string, unknown> = {}) =>
  ({
    tasindi: false,
    tutarsiz: false,
    satir: {
      title: 'Sifre Sifirla',
      kaynakTemplate: { id: 41 },
      hedefTemplate: { id: 51 },
      kaynakSurveyModu: 'acik',
      hedefSurveyModu: 'kapali',
      tahminSurveyYazilirsa: 'UYUMLU',
      engeller: [
        {
          anahtar: 'smart',
          adet: 2,
          baslik: 'Bekleyen Smart talebi',
          ipucu: 'onaylanmasini bekleyin',
        },
      ],
      okunamayan: [{ anahtar: 'oco', baslik: 'OCO kayitlari', hata: 'tablo kilitli' }],
      uyarilar: ['Hedef template son 30 gunde kosmadi'],
    },
    templateKarsilastirma: [
      { alan: 'playbook', etiket: 'Playbook', kaynak: 'a.yml', hedef: 'a.yml', farkli: false },
      { alan: 'ask_vars', etiket: 'Değişken sorar', kaynak: true, hedef: false, farkli: true },
      {
        alan: 'inv',
        etiket: 'Envanter',
        kaynak: '',
        hedef: null,
        farkli: false,
        hedefOlculemedi: true,
      },
    ],
    surveyFarki: [
      {
        variable: 'ayni_alan',
        etiket: 'ayni',
        kritik: false,
        farklar: [],
        kaynak: alan(),
        hedef: alan(),
      },
      {
        variable: 'env_mode',
        etiket: 'farkli',
        kritik: true,
        farklar: ['default', 'min'],
        kaynak: alan({ min: 1, max: 5 }),
        hedef: alan({ default: 'prod', min: 2, max: 5 }),
      },
      {
        variable: 'parola',
        etiket: 'yalniz_kaynakta',
        kritik: false,
        farklar: [],
        kaynak: alan({ parola: true }),
        hedef: null,
      },
      {
        variable: 'yeni',
        etiket: 'yalniz_hedefte',
        kritik: false,
        farklar: [],
        kaynak: null,
        hedef: alan({ question_name: 'Yeni soru', choices: [], required: false }),
      },
    ],
    uyum: { hatalar: ['SMART ayari hedefte yok'], uyarilar: ['Cikti filtresi hedefte farkli'] },
    uyumTahmin: { hatalar: ['alan sayisi tutmuyor'], uyarilar: [] },
    hedefAyarFarkli: true,
    kayitlar: [kayit()],
    kayitHatasi: null,
    ...ek,
  }) as unknown as SsTasimaDetay;

beforeEach(() => api.detay.mockReset());

describe('SelfServisTasimaDetay', () => {
  it('hedef secilmeden uyari, istek atilmaz; kapatma dugmesi ve ESC', () => {
    const kapat = vi.fn();
    render(<SelfServisTasimaDetay itemId="x" to={2} toT={null} onKapat={kapat} />);
    expect(screen.getByRole('alert').textContent).toBe('Önce hedef template seçin.');
    expect(api.detay).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Kapat' }));
    fireEvent.keyDown(window, { key: 'Enter' });
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(kapat).toHaveBeenCalledTimes(2);
  });

  it('yukleme hatasi gosterilir', async () => {
    api.detay.mockRejectedValueOnce(new Error('Template okunamadi'));
    render(<SelfServisTasimaDetay itemId="x" to={2} toT={51} onKapat={vi.fn()} />);
    expect((await screen.findByRole('alert')).textContent).toBe('Template okunamadi');
    expect(api.detay).toHaveBeenCalledWith('x', 2, 51);
  });

  it('tasinmis servis: tutarli ve tutarsiz kayit metni, kayit listesi', async () => {
    api.detay.mockResolvedValueOnce(detay({ tasindi: true }));
    const { unmount } = render(
      <SelfServisTasimaDetay itemId="x" to={2} toT={51} onKapat={vi.fn()} />,
    );
    expect(await screen.findByText(/Bu servis taşınmış/)).toBeTruthy();
    expect(screen.getByText(/deneme işi #700/)).toBeTruthy();
    expect(screen.queryByText('1. Template karşılaştırması')).toBeNull();
    unmount();
    api.detay.mockResolvedValueOnce(detay({ tasindi: true, tutarsiz: true }));
    render(<SelfServisTasimaDetay itemId="x" to={2} toT={51} onKapat={vi.fn()} />);
    expect(await screen.findByText(/kart hedefe bağlı değil/)).toBeTruthy();
  });

  it('karsilastirma, survey farki, uyum ve engeller', async () => {
    const kapat = vi.fn();
    api.detay.mockResolvedValueOnce(detay());
    render(<SelfServisTasimaDetay itemId="x" to={2} toT={51} onKapat={kapat} />);
    expect(await screen.findByRole('heading', { name: 'Sifre Sifirla' })).toBeTruthy();
    const karsilastirma = screen
      .getByText('1. Template karşılaştırması')
      .closest('section') as HTMLElement;
    expect(within(karsilastirma).getByText('Kaynak #41')).toBeTruthy();
    expect(within(karsilastirma).getByText('açık')).toBeTruthy();
    expect(within(karsilastirma).getByText('kapalı')).toBeTruthy();
    expect(within(karsilastirma).getByText('ölçülemedi')).toBeTruthy();
    expect(within(karsilastirma).getByText('—')).toBeTruthy();
    expect(within(karsilastirma).getByText('Değişken sorar').closest('tr')?.className).toContain(
      'amber',
    );

    const survey = screen.getByText(/2\. Survey farkı/).closest('section') as HTMLElement;
    expect(within(survey).getByText(/kaynak: acik, hedef: kapali/)).toBeTruthy();
    expect(within(survey).queryByText('ayni_alan')).toBeNull();
    const env = within(survey).getByText('env_mode').closest('tr') as HTMLElement;
    expect(env.className).toContain('red');
    expect(within(env).getByText('qa → prod')).toBeTruthy();
    expect(within(env).getByText('1–5 → 2–5')).toBeTruthy();
    const parola = within(survey).getByText('parola').closest('tr') as HTMLElement;
    expect(within(parola).getByText('gizli – kopyalanamaz')).toBeTruthy();
    expect(within(parola).getByText('yalnız kaynakta')).toBeTruthy();
    const yeni = within(survey).getByText('yeni').closest('tr') as HTMLElement;
    expect(within(yeni).getByText('—Yeni soru')).toBeTruthy();
    fireEvent.click(within(survey).getByRole('button', { name: 'Aynı olan 1 soruyu göster' }));
    expect(within(survey).getByText('ayni_alan').closest('tr')?.className).toContain('gray-400');
    fireEvent.click(within(survey).getByRole('button', { name: 'Aynı olanları gizle' }));
    expect(within(survey).queryByText('ayni_alan')).toBeNull();

    expect(screen.getByText('SMART ayari hedefte yok')).toBeTruthy();
    expect(screen.getByText('Cikti filtresi hedefte farkli')).toBeTruthy();
    expect(screen.getByText(/Survey yazılırsa:/).textContent).toContain(
      'UYUMLU (alan sayisi tutmuyor)',
    );
    expect(screen.getByText(/deneme koşusu onu onayla ezer/)).toBeTruthy();
    expect(screen.getByText('Önce bitmesi gerekenler')).toBeTruthy();
    expect(screen.getByText(/Bekleyen Smart talebi/).textContent).toContain(
      '2 × Bekleyen Smart talebi',
    );
    expect(screen.getByText('Kontrol edilemeyenler')).toBeTruthy();
    expect(screen.getByText('Hedef template son 30 gunde kosmadi')).toBeTruthy();
    expect(screen.queryByText('Engel ya da uyarı yok.')).toBeNull();

    fireEvent.click(document.querySelector('[role="presentation"]') as HTMLElement);
    expect(kapat).toHaveBeenCalledTimes(1);
  });

  it('temiz durum: uyumlu, engelsiz, survey sorusu yok, kayit hatasi', async () => {
    api.detay.mockResolvedValueOnce(
      detay({
        satir: {
          ...(detay() as unknown as { satir: Record<string, unknown> }).satir,
          engeller: [],
          okunamayan: [],
          uyarilar: [],
          tahminSurveyYazilirsa: null,
          kaynakSurveyModu: null,
        },
        surveyFarki: [],
        uyum: { hatalar: [], uyarilar: [] },
        hedefAyarFarkli: false,
        kayitlar: [],
        kayitHatasi: 'tablo yok',
      }),
    );
    render(<SelfServisTasimaDetay itemId="x" to={2} toT={51} onKapat={vi.fn()} />);
    expect(await screen.findByText('Ayarlar hedefe uyumlu.')).toBeTruthy();
    expect(screen.getByText('Survey sorusu yok.')).toBeTruthy();
    expect(screen.getByText(/kaynak: —/)).toBeTruthy();
    expect(screen.getByText('Engel ya da uyarı yok.')).toBeTruthy();
    expect(screen.getByText('Kayıtlar okunamadı: tablo yok')).toBeTruthy();
    expect(screen.getByText('Kayıt yok.')).toBeTruthy();
    expect(screen.queryByText(/Survey yazılırsa/)).toBeNull();
  });

  it('kayit listesi: elle secim, geri alma ve denemesiz gerekce', () => {
    render(
      <KayitListesi
        kayitlar={
          [
            kayit({
              eslesme: 'elle',
              tasiyan: null,
              geriAlan: 'adm3',
              geriAlindiAt: '2026-11-22T10:00:00Z',
              denemeJobId: null,
              surveyYazildi: false,
              denemesizGerekce: 'acil',
              createdBy: null,
              createdAt: null,
            }),
          ] as never
        }
      />,
    );
    const satir = screen.getByRole('listitem').textContent || '';
    expect(satir).toContain('elle seçildi');
    expect(satir).toContain('açan —');
    expect(satir).toContain('geri alan adm3');
    expect(satir).toContain('denemesiz: acil');
    expect(satir).not.toContain('taşıyan');
    expect(satir).not.toContain('survey yazıldı');
  });
});
