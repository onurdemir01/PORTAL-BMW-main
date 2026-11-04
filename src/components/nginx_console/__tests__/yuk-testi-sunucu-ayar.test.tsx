// src/components/nginx_console/__tests__/yuk-testi-sunucu-ayar.test.tsx — koşu öncesi sunucu ayarı (2026-11-04).
//
// SRV-1 Kutu yalniz sunucu hedefinde; kapaliyken govdede sunucuAyar yok (imza eskisi gibi).
// SRV-2 Kutu acik: seviye (br 1-11, gzip 1-9, identity'de gizli) ve dizin zorunlu; govde kanonik; ozet metninde gorunur.
// SRV-3 Kutu acikken h2 secimi /hedefler protokoller'inde h2 olmasa da serbest; kapaliyken eski davranis.
// SRV-4 Ayar degisince on kontrol eskir (imza); dizin localStorage'da hatirlanir.
// SRV-5 Kuyruk taslaginda static koşuya +180 sn; ozet metni.
// SRV-6 KosuAyrinti satiri; geri alma hata / uyari ve betik uyarilari gorunur; ok iken uyari yok; ayarsiz koşuda satir yok.
// SRV-7 Saf kurallar sunucunun dogrula.parametreler'iyle ayni; kanitsiz neden cumlesi; onay satiri.
// SRV-8 Geri alinamamis ayar: bitmis satirda "Sunucu ayarını geri al" (DONE, FAILED, on kontrol); bekliyor / ok iken yok.
// SRV-9 Saf: kalanSurecDurdurulabilir, butceTavani, parametreHatalari 30 dk.
// SRV-10 On kontrol ekraninda hazirlik uyarilari ve geri alma kutusu gorunur.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createRequire } from 'node:module';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { render } from '@/test/test-utils';
import { kosuNormalle, type NlKosuAyrinti, type NlParametreler, type NlSinirlar, type NlSunucuAyari, type NlVarsayilanlar } from '@/api/nginxLoadtestApi';
import { nedenAcikla } from '../yukTesti/nedenler';
import { SRV_DIZIN_ANAHTARI, butceTavani, hazirlikPayiSn, kalanSurecDurdurulabilir, parametreHatalari, parametreSunucuAyari, srvDizinGecerli, sunucuAyarHatalari, sunucuAyarMetni, sunucuAyariSatiri } from '../yukTesti/yukTestiOrtak';
import { yukMetni } from '../yukTesti/BaslatOnayi';

const api = vi.hoisted(() => ({
  hedefler: vi.fn(), senaryolar: vi.fn(), senaryo: vi.fn(), senaryoKaydet: vi.fn(), senaryoSil: vi.fn(), onKontrol: vi.fn(),
  baslat: vi.fn(), kosular: vi.fn(), kosu: vi.fn(), durum: vi.fn(), durdur: vi.fn(), yenidenOku: vi.fn(), karsilastir: vi.fn(), ipSinifi: vi.fn(),
  araclar: vi.fn(), araclariHazirla: vi.fn(), aracGeriCek: vi.fn(),
}));
vi.mock('@/api/nginxLoadtestApi', async (orijinal) => ({ ...(await orijinal<typeof import('@/api/nginxLoadtestApi')>()), nginxLoadtestApi: api }));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }));
vi.mock('@/hooks/useToast', () => ({ toast }));

import { YukTestiTab } from '../YukTestiTab';
import YeniKosu from '../yukTesti/YeniKosu';
import KosuAyrinti from '../yukTesti/KosuAyrinti';
import { SunucuAyarUyarilari } from '../yukTesti/YukUi';

const SINIR: NlSinirlar = {
  maxHiz: 450, maxTekrar: 3, sureMin: 40, sureMax: 300, isinmaMax: 60, maxVu: 199, maxButceSn: 2700,
  baglantiMin: 1, maxBaglanti: 199, maxBaglantiSayisi: 5, isParcacigiMin: 1, maxIsParcacigi: 16, serbestTavanRps: 200, serbestMaxBaglanti: 50,
};
const VARSAYILAN: NlVarsayilanlar = {
  motor: 'k6', hizlar: [100, 250, 400], maxvu: 150, baglantilar: [2, 4, 8], is_parcacigi: 2, tekrar: 2, isinma: 30, sure: 120, bosluk: 30, bosta: 60,
  kip: 'yeni', ae: 'br', serbest: { hizlar: [50, 100, 200], maxvu: 50 }, protokol: 'h1',
};
const HEDEFLER = {
  ok: true,
  hedefler: [{ host: 'GBNGXT33', env: 'TEST', ipler: ['192.168.133.27'], vhostlar: ['glomo-test.garantibbva.com.tr'], vhostVerisi: true, uygun: true, neden: null }],
  yukHostlari: [{ host: 'GBNGXT34', env: 'TEST', uygun: true, neden: null }],
  sinirlar: SINIR, varsayilan: VARSAYILAN, serbest: { acik: true, aglar: [] }, motorlar: ['k6', 'wrk'], protokoller: ['h1', 'h2'],
  araclar: { hazir: true, aracId: 5, k6Surum: 'v0.49.0', wrkSurum: '4.2.0', kod: null, mesaj: null },
};
const SENARYO = { id: 3, ad: 'GLOMO', aciklama: null, vhost: 'glomo-test.garantibbva.com.tr', senaryoTur: 'K', yolSayisi: 264, sha256: 'b'.repeat(64), kaynak: 'har', createdBy: 'onur', createdAt: '2026-10-26T10:00:00Z' };
const DIZIN = '/usr/nginx/applications/glomo';
const SERBEST_SINIF = { ok: true, tur: 'serbest', ip: '10.20.30.40', host: null, ag: '10.20.30.0/24', digerSahipler: [] };

beforeEach(() => {
  for (const f of Object.values(api)) f.mockReset();
  for (const f of Object.values(toast)) f.mockReset();
  window.localStorage.clear();
  api.kosular.mockResolvedValue({ ok: true, kosular: [], dahaVar: false });
  api.senaryolar.mockResolvedValue({ ok: true, senaryolar: [SENARYO] });
  api.hedefler.mockResolvedValue(HEDEFLER);
  api.durum.mockResolvedValue({ ok: true, status: 'running', finished: false, output: '', result: null, kosuDurum: 'RUNNING' });
  api.onKontrol.mockResolvedValue({ ok: false, code: 'kilit_dolu', message: 'Başka bir yük testi sürüyor.', _httpStatus: 409 });
  api.ipSinifi.mockImplementation(async (ip: string) => ({
    ok: true, tur: 'sunucu', ip, host: 'GBNGXT33', env: 'TEST', vhostlar: ['glomo-test.garantibbva.com.tr'], vhostVerisi: true, hizSiniri: null, vuSiniri: null, uygun: true, neden: null, kod: null, kaynaklar: [],
  }));
});

async function formAc() {
  render(<YukTestiTab isAdmin />);
  fireEvent.click(await screen.findByRole('tab', { name: /Yeni koşu/ }));
  fireEvent.change(await screen.findByLabelText('Senaryo'), { target: { value: '3' } });
  fireEvent.change(screen.getByLabelText('Hedef sunucu (isteğe bağlı)'), { target: { value: 'GBNGXT33' } });
  fireEvent.change(screen.getByLabelText('Hedef IP'), { target: { value: '192.168.133.27' } });
  await screen.findByLabelText(/Sunucuyu koşu öncesi ayarla/);
}
const okDugmesi = () => screen.getByRole('button', { name: /Ön kontrolü (başlat|yeniden çalıştır)/ });
const kutu = () => screen.getByLabelText(/Sunucuyu koşu öncesi ayarla/);
const seviye = () => screen.getByLabelText(/seviyesi \(1–/) as HTMLInputElement;
const dizin = () => screen.getByLabelText('Uygulama dizini') as HTMLInputElement;
async function onKontrolGovdesi(n = 1) {
  await waitFor(() => expect(okDugmesi()).toBeEnabled(), { timeout: 3000 });
  fireEvent.click(okDugmesi());
  await waitFor(() => expect(api.onKontrol).toHaveBeenCalledTimes(n));
  return api.onKontrol.mock.calls[n - 1][0];
}

describe('Yük Testi sunucu ayarı — form (SRV-1..5)', () => {
  it('SRV-1 kapalıyken gövdede sunucuAyar yok; serbest hedefte kutu yok', async () => {
    await formAc();
    expect(kutu()).not.toBeChecked();
    expect(screen.queryByLabelText('Uygulama dizini')).toBeNull();
    const g = await onKontrolGovdesi();
    expect('sunucuAyar' in g.parametreler).toBe(false);

    fireEvent.change(screen.getByLabelText('Hedef sunucu (isteğe bağlı)'), { target: { value: '' } });
    api.ipSinifi.mockResolvedValue(SERBEST_SINIF);
    fireEvent.change(screen.getByLabelText('Hedef IP'), { target: { value: '10.20.30.40' } });
    await waitFor(() => expect(screen.queryByLabelText(/Sunucuyu koşu öncesi ayarla/)).toBeNull(), { timeout: 3000 });
  });

  it('SRV-1b kutu işaretliyken hedef serbeste dönerse gövdeye girmez', async () => {
    await formAc();
    fireEvent.click(kutu());
    fireEvent.change(screen.getByLabelText('Hedef sunucu (isteğe bağlı)'), { target: { value: '' } });
    api.ipSinifi.mockResolvedValue(SERBEST_SINIF);
    fireEvent.change(screen.getByLabelText('Hedef IP'), { target: { value: '10.20.30.40' } });
    fireEvent.change(screen.getByLabelText('Host başlığı (vhost)'), { target: { value: 'glomo-test.garantibbva.com.tr' } });
    await waitFor(() => expect(screen.queryByLabelText(/Sunucuyu koşu öncesi ayarla/)).toBeNull(), { timeout: 3000 });
    const g = await onKontrolGovdesi();
    expect('sunucuAyar' in g.parametreler).toBe(false);
  });

  it('SRV-2 seviye ve dizin zorunlu, sınırlar ae’ye göre, identity’de seviye gizli; gövde kanonik; özet metni', async () => {
    await formAc();
    fireEvent.click(kutu());
    expect(okDugmesi()).toBeDisabled();
    expect(screen.getByText('Brotli seviyesi 1–11 olmalı.')).toBeInTheDocument();
    expect(screen.getByText(/Dizini yazın/)).toBeInTheDocument();
    fireEvent.change(seviye(), { target: { value: '12' } });
    expect(screen.getByText('Brotli seviyesi 1–11 olmalı.')).toBeInTheDocument();
    fireEvent.change(seviye(), { target: { value: '11' } });
    fireEvent.change(dizin(), { target: { value: '/usr/nginx/conf' } });
    expect(screen.getByText(/altında olmalı/)).toBeInTheDocument();
    fireEvent.change(dizin(), { target: { value: ` ${DIZIN} ` } });
    fireEvent.click(screen.getByLabelText(/static \(önceden sıkıştırılmış dosya\)/));
    const g = await onKontrolGovdesi();
    expect(g.parametreler.sunucuAyar).toEqual({ seviye: 11, static: true, dizin: DIZIN });
    expect(screen.getByRole('button', { name: /^Gelişmiş ayarlar/ }).textContent).toContain('sunucu ayarı: HTTP/2 kapalı · brotli 11 · static');

    // gzip en çok 9 (kullanıcının örneğindeki 10 geçersiz).
    fireEvent.change(screen.getByLabelText('Sıkıştırma (Accept-Encoding)'), { target: { value: 'gzip' } });
    expect(screen.getByLabelText('Gzip seviyesi (1–9)')).toBeInTheDocument();
    expect(screen.getByText('Gzip seviyesi 1–9 olmalı.')).toBeInTheDocument();
    fireEvent.change(seviye(), { target: { value: '10' } });
    expect(okDugmesi()).toBeDisabled();
    fireEvent.change(seviye(), { target: { value: '9' } });
    expect((await onKontrolGovdesi(2)).parametreler.sunucuAyar).toEqual({ seviye: 9, static: true, dizin: DIZIN });

    // identity: seviye alanı yok, gövdede null.
    fireEvent.change(screen.getByLabelText('Sıkıştırma (Accept-Encoding)'), { target: { value: 'identity' } });
    expect(screen.queryByLabelText(/seviyesi \(1–/)).toBeNull();
    expect((await onKontrolGovdesi(3)).parametreler.sunucuAyar).toEqual({ seviye: null, static: true, dizin: DIZIN });
  });

  it('SRV-3 kutu açıkken h2 /hedefler’de olmasa da seçilir; kutu kapalıyken eski davranış; wrk kapalı kalır', async () => {
    api.hedefler.mockResolvedValue({ ...HEDEFLER, protokoller: ['h1'] });
    await formAc();
    const prot = () => screen.getByLabelText('Protokol') as HTMLSelectElement;
    expect(prot()).toBeDisabled();
    fireEvent.click(kutu());
    fireEvent.change(seviye(), { target: { value: '6' } });
    fireEvent.change(dizin(), { target: { value: DIZIN } });
    expect(prot()).toBeEnabled();
    fireEvent.change(prot(), { target: { value: 'h2' } });
    const g = await onKontrolGovdesi();
    expect([g.parametreler.protokol, g.parametreler.kip]).toEqual(['h2', 'ka']);
    fireEvent.click(screen.getByRole('radio', { name: /^wrk/ }));
    expect(prot()).toBeDisabled();
    expect(prot().value).toBe('h1');
    fireEvent.click(screen.getByRole('radio', { name: /^k6/ }));
    fireEvent.click(kutu());
    expect(prot()).toBeDisabled();
    expect(prot().value).toBe('h1');
  });

  it('SRV-4 ayar değişince imza değişir (ön kontrol eskir); dizin yalnız geçerliyse hatırlanır ve yeni formda gelir', async () => {
    api.onKontrol.mockResolvedValue({ ok: true, kosuId: 11, jobId: 900 });
    api.kosu.mockResolvedValue({ ok: true, kosu: kosuNormalle({ id: 11, islem: 'on_kontrol', durum: 'RUNNING', hedefTuru: 'sunucu', parametreler: {} }), adimlar: [] });
    await formAc();
    fireEvent.click(kutu());
    fireEvent.change(seviye(), { target: { value: '6' } });
    fireEvent.change(dizin(), { target: { value: '/etc' } });
    expect(window.localStorage.getItem(SRV_DIZIN_ANAHTARI)).toBeNull();
    fireEvent.change(dizin(), { target: { value: DIZIN } });
    await waitFor(() => expect(window.localStorage.getItem(SRV_DIZIN_ANAHTARI)).toBe(DIZIN));
    await onKontrolGovdesi();
    await screen.findAllByText(/Ön kontrol #11/);
    fireEvent.change(seviye(), { target: { value: '7' } });
    expect(await screen.findByText(/Form bu ön kontrolden sonra değişti/)).toBeInTheDocument();
  });

  it('SRV-4b hatırlanan dizin formda gelir', async () => {
    window.localStorage.setItem(SRV_DIZIN_ANAHTARI, DIZIN);
    await formAc();
    fireEvent.click(kutu());
    expect(dizin().value).toBe(DIZIN);
  });

  it('SRV-5 kuyruk taslağı: static koşuya +180 sn, özet metni', async () => {
    const ekle = vi.fn();
    render(<YeniKosu onBasladi={vi.fn()} onSenaryolar={vi.fn()} onKuyrugaEkle={ekle} />);
    fireEvent.change(await screen.findByLabelText('Senaryo'), { target: { value: '3' } });
    fireEvent.change(screen.getByLabelText('Hedef sunucu (isteğe bağlı)'), { target: { value: 'GBNGXT33' } });
    fireEvent.change(screen.getByLabelText('Hedef IP'), { target: { value: '192.168.133.27' } });
    fireEvent.click(await screen.findByLabelText(/Sunucuyu koşu öncesi ayarla/));
    fireEvent.change(seviye(), { target: { value: '6' } });
    fireEvent.change(dizin(), { target: { value: DIZIN } });
    fireEvent.change(screen.getByLabelText('Kuyruk etiketi (zorunlu)'), { target: { value: 'A1' } });
    const ekleDugmesi = () => screen.getByRole('button', { name: /Kuyruğa ekle/ });
    await waitFor(() => expect(ekleDugmesi()).toBeEnabled(), { timeout: 3000 });
    fireEvent.click(ekleDugmesi());
    const kapali = ekle.mock.calls[0][0];
    expect(kapali.ozet).toContain('sunucu ayarı: HTTP/2 kapalı · brotli 6');
    fireEvent.click(screen.getByLabelText(/static \(önceden sıkıştırılmış dosya\)/));
    fireEvent.change(screen.getByLabelText('Kuyruk etiketi (zorunlu)'), { target: { value: 'A2' } });
    await waitFor(() => expect(ekleDugmesi()).toBeEnabled());
    fireEvent.click(ekleDugmesi());
    const acik = ekle.mock.calls[1][0];
    expect(acik.butceSn).toBe(kapali.butceSn + 180);
    expect(acik.govde.parametreler.sunucuAyar).toEqual({ seviye: 6, static: true, dizin: DIZIN });
  });
});

const P: NlParametreler = { motor: 'k6', hizlar: [100], maxvu: 150, tekrar: 1, isinma: 30, sure: 120, bosluk: 30, bosta: 60, kip: 'ka', ae: 'br', protokol: 'h2', sunucuAyar: { seviye: 6, static: true, dizin: DIZIN } };
function ayrinti(sunucuAyari?: NlSunucuAyari | null) {
  return {
    id: 7, islem: 'kosu', etiket: null, adim: 'R7', hedefHost: 'GBNGXT33', hedefIp: '192.168.133.27', vhost: 'glomo-test.garantibbva.com.tr', yukHost: 'GBNGXT34',
    senaryoId: 3, senaryoAd: 'GLOMO', durum: 'DONE', gecerlilik: 'GECERLI', createdBy: 'onur', createdAt: '2026-11-02T11:45:00Z', startedAt: '2026-11-02T11:46:00Z',
    finishedAt: '2026-11-02T12:08:00Z', awxJobId: 3500000, hedefTuru: 'sunucu', motor: 'k6', protokol: 'h2', parametreler: P, sunucuAyari,
  } as unknown as NlKosuAyrinti;
}
const AYAR: NlSunucuAyari = {
  http2: true, ae: 'br', seviye: 6, static: true, dizin: DIZIN,
  kanit: { durum: 'uyumlu', sapmalar: [], gzUretilen: 0, brUretilen: 100, atlanan: 20, uyarilar: [] }, geriAlma: { durum: 'ok', metin: null },
};

describe('Yük Testi sunucu ayarı — ayrıntı (SRV-6)', () => {
  const ac = async (a?: NlSunucuAyari | null) => {
    api.kosu.mockResolvedValue({ ok: true, kosu: kosuNormalle(ayrinti(a)), adimlar: [] });
    return render(<KosuAyrinti kosuId={7} isAdmin={false} onGeri={vi.fn()} />);
  };
  it('SRV-6 satır metni, ok iken uyarı yok', async () => {
    await ac(AYAR);
    expect((await screen.findByText('Sunucu ayarı')).nextElementSibling?.textContent).toBe('HTTP/2 açık · brotli 6 · static · 120 .br');
    expect(screen.queryByText(/Sunucu ayarı geri alın/)).toBeNull();
    const { container } = render(<SunucuAyarUyarilari ayar={AYAR} />);
    expect(container.querySelector('.space-y-2')).toBeNull();
  });
  it('SRV-6b geri alma hatası role=alert, uyarı ve betik uyarıları görünür', async () => {
    await ac({ ...AYAR, geriAlma: { durum: 'hata', metin: 'nginx -t düştü' } });
    const k = await screen.findByText('nginx -t düştü');
    expect(k.closest('[role="alert"]')).toBeTruthy();
    expect(screen.getByText('Sunucu ayarı geri alınamadı')).toBeInTheDocument();
  });
  it('SRV-6c uyarı metni ve betik uyarısı', async () => {
    await ac({ ...AYAR, geriAlma: { durum: 'uyari', metin: null }, kanit: { ...AYAR.kanit!, uyarilar: ['baska dosyada gzip_comp_level var'] } });
    expect(await screen.findByText('Sunucu ayarı geri alınırken uyarı')).toBeInTheDocument();
    expect(screen.getByText(/başkası tarafından değiştirilmiş/)).toBeInTheDocument();
    expect(screen.getByText('baska dosyada gzip_comp_level var')).toBeInTheDocument();
  });
  it('SRV-6d ayarsız koşuda satır yok', async () => {
    await ac(null);
    await screen.findByText('Protokol');
    expect(screen.queryByText('Sunucu ayarı')).toBeNull();
  });
});

describe('Yük Testi sunucu ayarı — geri alma düğmesi (SRV-8)', () => {
  const ac = async (a: NlSunucuAyari | null, ek: Record<string, unknown> = {}) => {
    api.kosu.mockResolvedValue({ ok: true, kosu: kosuNormalle({ ...ayrinti(a), ...ek }), adimlar: [] });
    return render(<KosuAyrinti kosuId={7} isAdmin onGeri={vi.fn()} />);
  };
  const HATA: NlSunucuAyari = { ...AYAR, kanit: null, geriAlma: { durum: 'hata', metin: 'Geri alma sonucu yok' } };
  const dugme = () => screen.queryByRole('button', { name: 'Sunucu ayarını geri al' });
  it('SRV-8 DONE koşuda hata: düğme, onay penceresi, durdurma işi', async () => {
    api.durdur.mockResolvedValue({ ok: true, iptal: { alreadyTerminal: true }, iptalHatasi: null, durdurIsi: { jobId: 901, awxServerId: 3 }, durdurHatasi: null });
    await ac(HATA);
    await screen.findByText('Geri alma sonucu yok');
    fireEvent.click(dugme() as HTMLElement);
    expect(await screen.findByText(/başka bir koşunun yedeği varsa ona dokunulmaz/)).toBeInTheDocument();
    const dugmeler = screen.getAllByRole('button', { name: 'Sunucu ayarını geri al' });
    fireEvent.click(dugmeler[dugmeler.length - 1]);
    await waitFor(() => expect(api.durdur).toHaveBeenCalledWith(7));
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    expect(toast.success.mock.calls[0][0]).toContain('AWX #901');
  });
  it('SRV-8b ayarlı ön kontrol: durdurma işi yoksa basarı denmez, FAILED satırda düğme var', async () => {
    api.durdur.mockResolvedValue({ ok: true, iptal: { alreadyTerminal: true }, iptalHatasi: null, durdurIsi: null, durdurHatasi: 'AWX yok' });
    await ac(HATA, { islem: 'on_kontrol', durum: 'FAILED', gecerlilik: null, adim: null });
    await screen.findByText('Geri alma sonucu yok');
    fireEvent.click(dugme() as HTMLElement);
    const dugmeler = await screen.findAllByRole('button', { name: 'Sunucu ayarını geri al' });
    fireEvent.click(dugmeler[dugmeler.length - 1]);
    await waitFor(() => expect(api.durdur).toHaveBeenCalled());
    await screen.findByText(/durdurma işi başlatılamadı/);
    expect(toast.success).not.toHaveBeenCalled();
  });
  it('SRV-8c bekliyor: kutu var, düğme yok; ok ve ayarsız bitmiş koşuda düğme yok; İptal edilmiş koşuda eski düğme', async () => {
    await ac({ ...HATA, geriAlma: { durum: 'bekliyor', metin: 'AWX #55 sonucu bekleniyor' } });
    expect(await screen.findByText('Sunucu ayarı geri alınıyor')).toBeInTheDocument();
    expect(screen.getByText('AWX #55 sonucu bekleniyor')).toBeInTheDocument();
    expect(dugme()).toBeNull();
    expect(screen.queryByRole('button', { name: 'Kalan süreçleri durdur' })).toBeNull();
    await ac(AYAR);
    await screen.findAllByText('Sunucu ayarı');
    expect(dugme()).toBeNull();
    await ac(null, { durum: 'FAILED' });
    await screen.findAllByText('Protokol');
    expect(dugme()).toBeNull();
    await ac(null, { durum: 'CANCELED' });
    expect(await screen.findByRole('button', { name: 'Kalan süreçleri durdur' })).toBeInTheDocument();
  });
  it('SRV-8d yönetici değilse düğme yok, uyarı görünür', async () => {
    api.kosu.mockResolvedValue({ ok: true, kosu: kosuNormalle(ayrinti(HATA)), adimlar: [] });
    render(<KosuAyrinti kosuId={7} isAdmin={false} onGeri={vi.fn()} />);
    await screen.findByText('Geri alma sonucu yok');
    expect(dugme()).toBeNull();
  });
});

describe('Yük Testi sunucu ayarı — ön kontrol ekranı (SRV-10)', () => {
  it('SRV-10 hazırlık uyarısı ve geri alma hatası ön kontrol panelinde görünür', async () => {
    await formAc();
    fireEvent.click(kutu());
    fireEvent.change(seviye(), { target: { value: '5' } });
    fireEvent.change(dizin(), { target: { value: DIZIN } });
    api.onKontrol.mockResolvedValue({ ok: true, kosuId: 9, jobId: 1 });
    const satir = { ...ayrinti({ ...AYAR, kanit: null, geriAlma: { durum: 'hata', metin: 'nginx -t düştü' }, uyarilar: ['vhost.conf icinde gzip_comp_level var; seviye ayari etkisiz olabilir'] }), id: 9, islem: 'on_kontrol', adim: null, gecerlilik: null };
    api.kosu.mockResolvedValue({ ok: true, kosu: kosuNormalle(satir), adimlar: [] });
    await onKontrolGovdesi();
    expect(await screen.findByText(/seviye ayari etkisiz olabilir/)).toBeInTheDocument();
    expect(screen.getByText('nginx -t düştü').closest('[role="alert"]')).toBeTruthy();
  });
});

describe('Yük Testi sunucu ayarı — saf kurallar (SRV-7)', () => {
  it('SRV-9 Durdur açık mı, bütçe tavanı', () => {
    const g = (durum: 'ok' | 'uyari' | 'hata' | 'bekliyor') => ({ ...AYAR, geriAlma: { durum, metin: null } });
    expect(kalanSurecDurdurulabilir({ islem: 'kosu', durum: 'CANCELED' })).toBe(true);
    expect(kalanSurecDurdurulabilir({ islem: 'kosu', durum: 'FAILED' })).toBe(false);
    expect(kalanSurecDurdurulabilir({ islem: 'on_kontrol', durum: 'CANCELED' })).toBe(false);
    expect(kalanSurecDurdurulabilir({ islem: 'kosu', durum: 'DONE', sunucuAyari: g('hata') })).toBe(true);
    expect(kalanSurecDurdurulabilir({ islem: 'on_kontrol', durum: 'CANCELED', sunucuAyari: g('hata') })).toBe(true);
    for (const d of ['ok', 'uyari', 'bekliyor'] as const) expect(kalanSurecDurdurulabilir({ islem: 'kosu', durum: 'DONE', sunucuAyari: g(d) })).toBe(false);
    expect(kalanSurecDurdurulabilir({ islem: 'kosu', durum: 'DONE', sunucuAyari: null })).toBe(false);
    expect(butceTavani({ maxButceSn: 2700 }, false)).toBe(2700);
    expect(butceTavani({ maxButceSn: 2700 }, true)).toBe(1800);
    expect(butceTavani({ maxButceSn: 2700, maxButceSnSunucuAyar: 1500 }, true)).toBe(1500);
    const uzun: NlParametreler = { ...P, hizlar: [100, 200, 300, 400, 500], tekrar: 1, isinma: 30, sure: 300, bosluk: 30, bosta: 60, maxvu: 150 };
    expect(parametreHatalari(uzun, { ...SINIR, maxHiz: 5000 }).butce).toMatch(/üst sınır 30 dk \(sunucu ayarlı koşu\)/);
    expect(parametreHatalari({ ...uzun, sunucuAyar: null }, { ...SINIR, maxHiz: 5000 }).butce).toBeUndefined();
  });
  it('SRV-7 metinler, neden cümlesi, onay satırı', () => {
    expect(sunucuAyarMetni({ http2: false, ae: 'gzip', seviye: 9, static: false })).toBe('HTTP/2 kapalı · gzip 9');
    expect(sunucuAyarMetni({ http2: true, ae: 'identity', seviye: null, static: true }, 7)).toBe('HTTP/2 açık · sıkıştırmasız · static · 7 .gz');
    expect(sunucuAyariSatiri({ ...AYAR, kanit: null })).toBe('HTTP/2 açık · brotli 6 · static');
    expect(sunucuAyariSatiri({ ...AYAR, ae: 'gzip', kanit: { ...AYAR.kanit!, gzUretilen: 5, atlanan: 1 } })).toBe('HTTP/2 açık · gzip 6 · static · 6 .gz');
    expect(sunucuAyariSatiri({ ...AYAR, static: false })).toBe('HTTP/2 açık · brotli 6');
    expect(parametreSunucuAyari({ ...P, sunucuAyar: null })).toBe('');
    expect(hazirlikPayiSn(P)).toBe(180);
    expect(hazirlikPayiSn({ sunucuAyar: { seviye: 6, static: false, dizin: DIZIN } })).toBe(0);
    expect(hazirlikPayiSn(null)).toBe(0);
    expect(yukMetni(P)).toContain('sunucu ayarı: HTTP/2 açık · brotli 6 · static');
    expect(yukMetni({ ...P, sunucuAyar: null })).not.toContain('sunucu ayarı');
    expect(nedenAcikla('sunucu_ayari_kanitsiz(yok)')).toMatchObject({ ton: 'hata', kod: 'sunucu_ayari_kanitsiz(yok)' });
    expect(nedenAcikla('sunucu_ayari_kanitsiz(yok)').cumle).toMatch(/hazırlık kanıtı yok/);
    expect(nedenAcikla('sunucu_ayari_kanitsiz(http2,seviye)').cumle).toContain('(http2, seviye)');
    expect(nedenAcikla('sunucu_ayari_kanitsiz(yok)').bilinmiyor).toBeFalsy();
  });

  it('SRV-7b form kuralı sunucunun kuralıyla aynı', () => {
    const require = createRequire(import.meta.url);
    const dg = require('../../../../server/nginx-loadtest/dogrula.cjs');
    expect({ ...dg.SRV_SEVIYE_MAX }).toEqual({ br: 11, gzip: 9 });
    const durumlar: [Parameters<typeof sunucuAyarHatalari>[0], string, string][] = [];
    for (const ae of ['br', 'gzip', 'identity'] as const) {
      for (const sv of ['', '0', '1', '9', '10', '11', '12']) {
        for (const d of [DIZIN, `${DIZIN}/alt.dizin`, '', '/usr/nginx/applications', '/usr/nginx/applications/', '/usr/nginx/applications/a/../b', '/usr/nginx/applications/a..b', '/etc/nginx', '/usr/nginx/applications/a b']) durumlar.push([ae, sv, d]);
      }
    }
    for (const [ae, sv, d] of durumlar) {
      const form = Object.keys(sunucuAyarHatalari(ae, sv, d)).length === 0;
      // identity'de form seviyeyi gondermez (alan gizli).
      const sunucu = dg.parametreler({ ae, sunucuAyar: { seviye: ae === 'identity' ? null : sv, dizin: d } }, { sni: false }).ok;
      expect([ae, sv, d, form]).toEqual([ae, sv, d, sunucu]);
    }
    expect(srvDizinGecerli(DIZIN)).toBe(true);
  });
});
