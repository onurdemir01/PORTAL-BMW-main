// src/components/admin/__tests__/SelfServisTasima.test.tsx — Admin > Self Servis Taşıma (2026-11-10).
//   UI1a varsayılan sunucu çifti adlardan (maestro2 → maestro3); rapor bu çiftle istenir
//   UI1b çipler sunucunun öncelik sırasıyla; HAZIR değilken "Taşı" pasif
//   UI1c toplu işlem: bir servisin hatası diğerini durdurmaz, sonuç her servis için ayrı
//   UI1d Taşı penceresi: deneme yoksa gerekçe kutusu (≥10 karakter) olmadan düğme pasif
//   UI1e düğmeler "İptal" der, "Vazgeç" hiç geçmez
//   UI2  servis Geçmiş süzgeci önceki bağları da kapsar
//   UI3  sekme Admin > Otomasyon'da, `{ id, label }` biçiminde
//   UI4  hedef başka yere bağlıysa survey düğmesi yok, toplu survey atlar; toplu yol plan hash'ini gönderir
//   UI5  toplu survey penceresi onay kutusu olmadan başlamaz
//   UI6  geri al: kart başka bağa dönmüşse 'Kaydı kapat' (onaylı), geriAl(kaydiKapat=true)
//   UI7  deneme: 'Koştur' doğrulama + gerçek iş onayı olmadan pasif
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const api = vi.hoisted(() => ({ servers: vi.fn(), surveySpecAdmin: vi.fn(), ssJobStatus: vi.fn() }));
vi.mock('@/api/ansibleApi', () => ({ ansibleApi: api }));
const tasima = vi.hoisted(() => ({
  plan: vi.fn(),
  detay: vi.fn(),
  hedefSec: vi.fn(),
  surveyYaz: vi.fn(),
  deneme: vi.fn(),
  tasi: vi.fn(),
  geriAlOnizleme: vi.fn(),
  geriAl: vi.fn(),
  hazirlikIptal: vi.fn(),
}));
vi.mock('@/api/ssTasimaApi', () => ({ ssTasimaApi: tasima }));
const toast = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }));
vi.mock('@/hooks/useToast', () => ({ toast }));

import SelfServisTasima, { topluCalistir, topluUygunluk, varsayilanCift } from '../tabs/SelfServisTasima';
import { DenemePenceresi, GeriAlPenceresi, TasiPenceresi } from '../tabs/SelfServisTasimaPencereleri';
import { servisinIsiMi } from '@/utils/ssBaglar';
import type { SsTasimaSatiri } from '@/api/ssTasimaApi';

function satir(ek: Partial<SsTasimaSatiri>): SsTasimaSatiri {
  return {
    itemId: 'a',
    title: 'Servis A',
    enabled: true,
    accessMode: 'herkes',
    kaynakTemplate: { id: 20, name: 'Sablon A' },
    hedefTemplate: { id: 30, name: 'Sablon A' },
    eslesme: 'ad',
    eslesmeNedeni: null,
    adaylar: [],
    durum: 'HAZIR',
    cipler: ['HAZIR'],
    nedenler: [],
    uyarilar: [],
    engeller: [],
    okunamayan: [],
    surveyEylemi: null,
    kaynakSurveyModu: 'AWX',
    hedefSurveyModu: 'AWX',
    tahminSurveyYazilirsa: null,
    hedefSurveyHash: 'hs1',
    planHash: 'h1',
    deneme: null,
    kayit: null,
    sonKayitDurumu: null,
    ...ek,
  };
}

const SUNUCULAR = [
  { id: 1, name: 'maestro', configured: true },
  { id: 2, name: 'maestro2', configured: true },
  { id: 3, name: 'Maestro3 yeni', configured: true },
];

describe('Self Servis Taşıma', () => {
  beforeEach(() => {
    Object.values(api).forEach((f) => f.mockReset());
    Object.values(tasima).forEach((f) => f.mockReset());
    api.servers.mockResolvedValue({ ok: true, servers: SUNUCULAR });
  });

  it('UI1a varsayılan çift maestro2 → maestro3; rapor bu çiftle istenir', async () => {
    tasima.plan.mockResolvedValue({ ok: true, kaynak: { id: 2, name: 'maestro2' }, hedef: { id: 3, name: 'Maestro3 yeni' }, izinListesiDolu: false, sunucuHatalari: [], kayitHatasi: null, hedefTemplateleri: [], satirlar: [] });
    render(<SelfServisTasima />);
    await waitFor(() => expect(tasima.plan).toHaveBeenCalled());
    expect(tasima.plan.mock.calls[0].slice(0, 2)).toEqual([2, 3]);
    expect(screen.getByText('Self Servis Taşıma (maestro2 → Maestro3 yeni)')).toBeTruthy();
    expect(varsayilanCift([{ id: 5, name: 'x', configured: true }])).toEqual({ from: null, to: null });
  });

  it('UI1b çipler sunucu sırasıyla; HAZIR değilken Taşı pasif', async () => {
    tasima.plan.mockResolvedValue({
      ok: true,
      kaynak: { id: 2, name: 'maestro2' },
      hedef: { id: 3, name: 'Maestro3 yeni' },
      izinListesiDolu: true,
      sunucuHatalari: [],
      kayitHatasi: null,
      hedefTemplateleri: [{ id: 30, name: 'Sablon A' }],
      satirlar: [
        satir({ itemId: 'a', title: 'Hazir servis' }),
        satir({ itemId: 'b', title: 'Engelli servis', durum: 'ENGEL', cipler: ['ENGEL', 'SURVEY_BOS'], surveyEylemi: 'yaz' }),
      ],
    });
    render(<SelfServisTasima />);
    await screen.findByText('Hazir servis');
    const cipler = within(screen.getByTestId('cipler-b')).getAllByText(/ENGEL|SURVEY_BOS/).map((e) => e.textContent);
    expect(cipler).toEqual(['ENGEL', 'SURVEY_BOS']);
    expect((screen.getByTestId('tasi-a') as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByTestId('tasi-b') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/Template izin listesi tanımlı/)).toBeTruthy();
    expect(screen.getAllByText("Survey'i hedefe yaz").length).toBe(1);
  });

  it('UI1c toplu işlemde bir servisin hatası diğerini durdurmaz', async () => {
    tasima.tasi.mockRejectedValueOnce(new Error('ag hatasi')).mockResolvedValueOnce({ ok: true });
    const sonuc = await topluCalistir(
      'tasi',
      [
        satir({ itemId: 'a', deneme: { jobId: 1, at: null, status: 'successful', gecerli: true, neden: null } }),
        satir({ itemId: 'b', deneme: { jobId: 2, at: null, status: 'successful', gecerli: true, neden: null } }),
        satir({ itemId: 'c', durum: 'ENGEL' }),
        satir({ itemId: 'd' }),
      ],
      3,
      '',
    );
    expect(sonuc.map((s) => s.tur)).toEqual(['hata', 'ok', 'atlandi', 'atlandi']);
    expect(tasima.tasi).toHaveBeenCalledTimes(2);
    expect(sonuc[3].sonuc).toMatch(/gerekçe/);
  });

  it('UI1d Taşı penceresi: deneme yoksa gerekçe olmadan düğme pasif', async () => {
    tasima.tasi.mockResolvedValue({ ok: true });
    const onBitti = vi.fn();
    render(<TasiPenceresi satir={satir({})} to={3} onKapat={() => {}} onBitti={onBitti} />);
    const dugme = screen.getByTestId('tasi-onay') as HTMLButtonElement;
    expect(dugme.disabled).toBe(true);
    fireEvent.click(screen.getByLabelText('Deneme koşusu olmadan taşı'));
    fireEvent.change(screen.getByLabelText('Denemesiz taşıma gerekçesi'), { target: { value: 'kisa' } });
    expect(dugme.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Denemesiz taşıma gerekçesi'), { target: { value: 'okuma servisi, zararsız' } });
    expect(dugme.disabled).toBe(false);
    fireEvent.click(dugme);
    await waitFor(() => expect(onBitti).toHaveBeenCalled());
    expect(tasima.tasi).toHaveBeenCalledWith('a', { to: 3, toT: 30, planHash: 'h1', denemesizGerekce: 'okuma servisi, zararsız' });
    expect(screen.getByText('İptal')).toBeTruthy();
  });

  it('UI1e "Vazgeç" hiçbir dosyada yok, "İptal" var', () => {
    for (const f of ['SelfServisTasima.tsx', 'SelfServisTasimaPencereleri.tsx', 'SelfServisTasimaDetay.tsx']) {
      const src = readFileSync(join(__dirname, '..', 'tabs', f), 'utf8');
      expect(src).not.toMatch(/Vazge[cç]/);
    }
    expect(readFileSync(join(__dirname, '..', 'tabs', 'SelfServisTasimaPencereleri.tsx'), 'utf8')).toMatch(/İptal/);
  });

  it('UI2 Geçmiş süzgeci önceki bağları kapsar', () => {
    const item = { awxServerId: 3, awxTemplateId: 30, oncekiBaglar: [{ awxServerId: 2, awxTemplateId: 20 }] };
    expect(servisinIsiMi(item, { awx_server_id: 2, template_id: 20 })).toBe(true);
    expect(servisinIsiMi(item, { awx_server_id: 3, template_id: 30 })).toBe(true);
    expect(servisinIsiMi(item, { awx_server_id: 3, template_id: 20 })).toBe(false);
    expect(servisinIsiMi({ awxServerId: 3, awxTemplateId: 30 }, { awx_server_id: 2, template_id: 20 })).toBe(false);
    const sayfa = readFileSync(join(__dirname, '..', '..', 'SelfServicePage.tsx'), 'utf8');
    expect(sayfa).toMatch(/filter\(\(h\) => !item \|\| servisinIsiMi\(item, h\)\)/);
  });

  it('UI3 sekme Otomasyon bölümünde', () => {
    const sayfa = readFileSync(join(__dirname, '..', 'AdminPage.tsx'), 'utf8');
    expect(sayfa).toMatch(/\{ id: 'sstasima', label: 'Self Servis Taşıma'/);
    expect(sayfa).toMatch(/ids: \['playbooks', 'sstasima', 'ansible'/);
    expect(sayfa).toMatch(/\{activeTab === 'sstasima' && <SelfServisTasima \/>\}/);
  });
  it('UI4 hedef başka yere bağlıysa survey düğmesi yok, toplu survey atlar; toplu yol hash gönderir', async () => {
    const bagli = satir({
      itemId: 'b',
      title: 'Bagli servis',
      durum: 'ENGEL',
      cipler: ['ENGEL', 'SURVEY_FARKLI'],
      surveyEylemi: 'yaz',
      engeller: [{ anahtar: 'hedef_baska_serviste', baslik: "Hedef template zaten 'Canli' servisine bağlı" }],
    });
    tasima.plan.mockResolvedValue({
      ok: true,
      kaynak: { id: 2, name: 'maestro2' },
      hedef: { id: 3, name: 'Maestro3 yeni' },
      izinListesiDolu: false,
      sunucuHatalari: [],
      kayitHatasi: null,
      hedefTemplateleri: [],
      satirlar: [satir({ itemId: 'a', title: 'Serbest', durum: 'SURVEY_BOS', surveyEylemi: 'yaz' }), bagli],
    });
    render(<SelfServisTasima />);
    await screen.findByText('Bagli servis');
    expect(screen.getAllByText("Survey'i hedefe yaz").length).toBe(1);
    expect(topluUygunluk('survey', bagli, '')).toMatch(/hedef bağlı/);
    expect(topluUygunluk('survey', satir({ surveyEylemi: 'yaz', hedefSurveyHash: null }), '')).toMatch(/okunamadı/);
    tasima.surveyYaz.mockResolvedValue({ ok: true });
    const sonuc = await topluCalistir('survey', [satir({ itemId: 'a', surveyEylemi: 'yaz' }), bagli], 3, '');
    expect(sonuc.map((x) => x.tur)).toEqual(['ok', 'atlandi']);
    expect(tasima.surveyYaz).toHaveBeenCalledTimes(1);
    expect(tasima.surveyYaz).toHaveBeenCalledWith('a', 3, 30, 'hs1');
  });

  it('UI5 toplu survey penceresi onay kutusu olmadan başlamaz', async () => {
    tasima.plan.mockResolvedValue({
      ok: true,
      kaynak: { id: 2, name: 'maestro2' },
      hedef: { id: 3, name: 'Maestro3 yeni' },
      izinListesiDolu: false,
      sunucuHatalari: [],
      kayitHatasi: null,
      hedefTemplateleri: [],
      satirlar: [satir({ itemId: 'a', title: 'Serbest', durum: 'SURVEY_BOS', surveyEylemi: 'yaz', hedefteSilinecekSoru: 2 })],
    });
    render(<SelfServisTasima />);
    await screen.findByText('Serbest');
    fireEvent.click(screen.getByLabelText('Serbest seç'));
    fireEvent.click(screen.getByText('Seçilenlere survey yaz'));
    const baslat = screen.getByTestId('toplu-baslat') as HTMLButtonElement;
    expect(baslat.disabled).toBe(true);
    expect(within(screen.getByTestId('toplu-tablo')).getByText('2')).toBeTruthy();
    fireEvent.click(screen.getByLabelText(/survey'lerinin üzerine yazılacağını anladım/));
    expect(baslat.disabled).toBe(false);
  });

  it('UI6 geri al: kart başka bağa dönmüşse yalnız kayıt kapatılır (onaylı)', async () => {
    tasima.geriAlOnizleme.mockResolvedValue({
      ok: true,
      kayit: { id: 7, itemId: 'a', fromServer: 2, fromTemplate: 20, toServer: 3, toTemplate: 30 },
      kaynakSunucuAdi: 'maestro2',
      bagUygun: false,
      bilgiDegisiklikleri: [],
      onayGerekenDegisiklikler: [],
      engeller: [],
      okunamayan: [],
      uyarilar: [],
    });
    tasima.geriAl.mockResolvedValue({ ok: true, kaydiKapatti: true });
    const onBitti = vi.fn();
    render(<GeriAlPenceresi satir={satir({ durum: 'ENGEL' })} onKapat={() => {}} onBitti={onBitti} />);
    const dugme = (await screen.findByText('Kaydı kapat')).closest('button') as HTMLButtonElement;
    expect(screen.getByText(/maestro2, template #/)).toBeTruthy();
    expect(dugme.disabled).toBe(true);
    fireEvent.click(screen.getByLabelText(/yalnız kayıt kapatılsın/));
    expect(dugme.disabled).toBe(false);
    fireEvent.click(dugme);
    await waitFor(() => expect(onBitti).toHaveBeenCalled());
    expect(tasima.geriAl).toHaveBeenCalledWith('a', 7, true, true);
  });

  it('UI7 deneme: Koştur doğrulama ve gerçek iş onayı olmadan pasif; Smart reddi mesajı gösterilir', async () => {
    api.surveySpecAdmin.mockResolvedValue({ ok: false });
    tasima.deneme
      .mockResolvedValueOnce({ ok: true, valid: true, resolvedExtraVars: {} })
      .mockResolvedValueOnce({ ok: false, smartGerekli: true, message: 'Bu servis Smart onayı istiyor.' });
    render(<DenemePenceresi satir={satir({})} to={3} onKapat={() => {}} onBitti={() => {}} />);
    const kostur = screen.getByTestId('deneme-kostur') as HTMLButtonElement;
    expect(kostur.disabled).toBe(true);
    fireEvent.click(screen.getByText('Hazırla ve doğrula'));
    await screen.findByText(/Doğrulama geçti/);
    expect(kostur.disabled).toBe(true);
    fireEvent.click(screen.getByLabelText(/GERÇEK bir iştir/));
    expect(kostur.disabled).toBe(false);
    fireEvent.click(kostur);
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Bu servis Smart onayı istiyor.'));
    expect(tasima.deneme.mock.calls[1][1]).toMatchObject({ sadeceDogrula: false, confirm: true });
  });
});
