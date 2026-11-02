// src/components/nginx_console/__tests__/yuk-testi-h2.test.tsx — Yük Testi HTTP/2 protokol seçimi (2026-11-02).
//
// Kullanici istegi: "gercek tarayicilar cogunlukla HTTP/2 kullanir; protokol secebileyim (yalniz k6)". Sozlesme
// h2_sozlesme.md 5 (C). Varsayilan ve alani olmayan eski satir HTTP/1.1; h2 yalniz k6 ve keep-alive.
// H2-C1  Form: Protokol alani Gelişmiş ayarlarda (kapali), varsayilan HTTP/1.1, aciklama AYNEN; govde protokol 'h1'.
// H2-C2  h2 secimi: kip 'ka' olur, 'yeni' secenegi kapali, kipH2 aciklamasi; h1'e donus kipi degistirmez; govde h2 + ka.
// H2-C3  wrk: protokol secimi kapali, HTTP/1.1 gosterir, protokolWrk aciklamasi; once h2 secilmis olsa da govde h1.
// H2-C4  /hedefler `protokoller` yoksa (eski sunucu) secim kapali + protokolYok; govde h1.
// H2-C5  Gelişmiş ozeti h1'de BIREBIR eskisi, h2'de "HTTP/2"; protokol degisince on kontrol eskir (imza); sunucunun
//        protokol 400'u alan hatasi.
// H2-C6  BaslatOnayi yuk satiri: h1 k6 BIREBIR, h2 "· HTTP/2 ·", wrk BIREBIR.
// H2-C7  KosuListesi h2 cipi (h1 cipsiz); KosuAyrinti "Protokol" (wrk "HTTP/1.1 (wrk)"), h2 cipi, ozet satiri cipi ve
//        h2 kosu uyarisi bilgi kutusunda (analiz uyarisi sayilmaz).
// H2-C8  Neden cumleleri AYNEN (h2_disi, protokol_farkli, hatali_kosu, h2 uyarisi); olcum_kenari faz metni + "(ölçüm etkilenmedi)".
// H2-C9  OnKontrolPaneli h2 satiri (alpn true / false / null, curl h2'siz), h1'de satir yok; sunucu degerlendirmesi yoksa
//        istemci ayni engeli verir.
// H2-C10 Karşılaştır: farkli protokol bilgi kutusu, secicide "HTTP/2", karar satirinda iki tarafin protokolu.
// H2-C11 Normallestirme ve saf kurallar: protokoller / protokol / on kontrol h2 alanlari; parametreHatalari ve
//        hazirAyarParametresi h2 kurallari sunucunun dogrula.parametreler'iyle ayni.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createRequire } from 'node:module';
import { screen, fireEvent, waitFor, within } from '@testing-library/react';
import { render } from '@/test/test-utils';
import {
  adimNormalle, hedeflerNormalle, kosuNormalle, kosuSatiriNormalle, onKontrolNormalle, type NlKosuAyrinti, type NlParametreler, type NlSinirlar, type NlSonucOzeti, type NlVarsayilanlar,
} from '@/api/nginxLoadtestApi';
import { ALAN_ACIKLAMASI, HAZIR_AYAR_SIRASI, hazirAyar, hazirAyarParametresi } from '../yukTesti/hazirAyarlar';
import { H2_UYARI_CUMLESI, nedenAcikla, reloadZamanMetni, uyariAcikla } from '../yukTesti/nedenler';
import { onKontrolDegerlendir, parametreHatalari } from '../yukTesti/yukTestiOrtak';
import { reloadOzetMetni } from '../yukTesti/SonucOzeti';
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
import KosuAyrinti from '../yukTesti/KosuAyrinti';
import KosuListesi from '../yukTesti/KosuListesi';
import Karsilastir from '../yukTesti/Karsilastir';
import OnKontrolPaneli from '../yukTesti/OnKontrolPaneli';

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
const P_H2: NlParametreler = { motor: 'k6', hizlar: [100, 250, 400], maxvu: 150, tekrar: 2, isinma: 30, sure: 120, bosluk: 30, bosta: 60, kip: 'ka', ae: 'identity', protokol: 'h2' };
function ayrinti(o: Partial<NlKosuAyrinti> = {}): NlKosuAyrinti {
  return {
    id: 7, islem: 'kosu', etiket: null, adim: 'R7', hedefHost: 'GBNGXT33', hedefIp: '192.168.133.27', vhost: 'glomo-test.garantibbva.com.tr', yukHost: 'GBNGXT34',
    senaryoId: 3, senaryoAd: 'GLOMO', durum: 'DONE', gecerlilik: 'GECERLI', createdBy: 'onur', createdAt: '2026-11-02T11:45:00Z', startedAt: '2026-11-02T11:46:00Z',
    finishedAt: '2026-11-02T12:08:00Z', awxJobId: 3500000, hedefTuru: 'sunucu', motor: 'k6', protokol: 'h2', serbestAg: null, planUyarilari: [],
    parametreler: P_H2, onKontrol: null, gecersizNedenleri: [], sonucOzet: null, onKontrolKosuId: 6, sunucuDegerlendirmesi: null, onKontrolYasSn: null,
    isDurumu: 'OK', isHatasi: null, analiz: { nproc: 8, cpuTlsliPay: null, uyarilar: [], okumaHatasi: null }, durdurIsi: null, sonuclandirmaDenemesi: 0,
    aracId: null, aracSeti: null, sonucOzeti: null, ...o,
  };
}
const ADIM = { tur: 'R7_K_ka_identity_100_r1', senaryo: 'K', kip: 'ka', ae: 'identity', hiz: 100, n_istek: 12000, gercek_rps: 100, p50: 1.6, p95: 2.1, p99: 2.5, gecerlilik: 'GECERLI', nedenler: [], n_429: 0, n_5xx: 0, hata_orani: 0, dropped: 0 };

beforeEach(() => {
  for (const f of Object.values(api)) f.mockReset();
  for (const f of Object.values(toast)) f.mockReset();
  api.kosular.mockResolvedValue({ ok: true, kosular: [], dahaVar: false });
  api.senaryolar.mockResolvedValue({ ok: true, senaryolar: [SENARYO] });
  api.hedefler.mockResolvedValue(HEDEFLER);
  api.durum.mockResolvedValue({ ok: true, status: 'running', finished: false, output: '', result: null, kosuDurum: 'RUNNING' });
  api.ipSinifi.mockImplementation(async (ip: string) => ({
    ok: true, tur: 'sunucu', ip, host: 'GBNGXT33', env: 'TEST', vhostlar: ['glomo-test.garantibbva.com.tr'], vhostVerisi: true, hizSiniri: null, vuSiniri: null, uygun: true, neden: null, kod: null, kaynaklar: [],
  }));
});

async function formAc() {
  render(<YukTestiTab isAdmin />);
  fireEvent.click(await screen.findByRole('tab', { name: /Yeni koşu/ }));
  fireEvent.change(await screen.findByLabelText('Senaryo'), { target: { value: '3' } });
  fireEvent.change(screen.getByLabelText('Hedef sunucu (isteğe bağlı)'), { target: { value: 'GBNGXT33' } });
}
const okDugmesi = () => screen.getByRole('button', { name: /Ön kontrolü (başlat|yeniden çalıştır)/ });
const gelismisDugmesi = () => screen.getByRole('button', { name: /^Gelişmiş ayarlar/ });
const protokolSecimi = () => screen.getByLabelText('Protokol') as HTMLSelectElement;
const kipSecimi = () => screen.getByLabelText('Bağlantı') as HTMLSelectElement;
async function onKontrolGovdesi(n = 1) {
  await waitFor(() => expect(okDugmesi()).toBeEnabled(), { timeout: 3000 });
  fireEvent.click(okDugmesi());
  await waitFor(() => expect(api.onKontrol).toHaveBeenCalledTimes(n));
  return api.onKontrol.mock.calls[n - 1][0];
}

describe('Yük Testi HTTP/2 — yeni koşu formu (H2-C1..C5)', () => {
  it('H2-C1 Protokol alanı Gelişmiş ayarlarda, varsayılan HTTP/1.1, açıklama aynen; gövde protokol h1', async () => {
    api.onKontrol.mockResolvedValue({ ok: false, code: 'kilit_dolu', message: 'Başka bir yük testi sürüyor.', _httpStatus: 409 });
    await formAc();
    const p = protokolSecimi();
    expect(p).not.toBeVisible();
    expect(gelismisDugmesi()).toHaveAttribute('aria-expanded', 'false');
    expect(p.value).toBe('h1');
    expect(p).toBeEnabled();
    expect(p).toHaveAccessibleDescription('Tarayıcılar çoğunlukla HTTP/2 kullanır; HTTP/2 sunucunun CPU’sunu ve yanıt süresini HTTP/1.1’den farklı etkiler, bu yüzden sonuçlar yalnız aynı protokolle koşulan koşularla karşılaştırılır.');
    fireEvent.click(gelismisDugmesi());
    expect(within(p).getAllByRole('option').map((o) => o.textContent)).toEqual(['HTTP/1.1', 'HTTP/2']);
    // Protokol "Bağlantı"dan once.
    expect(p.compareDocumentPosition(kipSecimi()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const govde = await onKontrolGovdesi();
    expect(govde.parametreler).toEqual({ motor: 'k6', hizlar: [100, 250, 400], maxvu: 150, tekrar: 2, isinma: 30, sure: 120, bosluk: 30, bosta: 60, kip: 'yeni', ae: 'br', protokol: 'h1' });
  });

  it('H2-C2 h2 seçimi kip’i keep-alive yapar ve “yeni bağlantı”yı kapatır; h1’e dönüş kip’i değiştirmez; gövde h2 + ka', async () => {
    api.onKontrol.mockResolvedValue({ ok: false, code: 'kilit_dolu', message: 'Başka bir yük testi sürüyor.', _httpStatus: 409 });
    await formAc();
    fireEvent.click(gelismisDugmesi());
    expect(kipSecimi().value).toBe('yeni');
    fireEvent.change(protokolSecimi(), { target: { value: 'h2' } });
    expect(protokolSecimi().value).toBe('h2');
    expect(kipSecimi().value).toBe('ka');
    expect(within(kipSecimi()).getByRole('option', { name: 'yeni bağlantı' })).toBeDisabled();
    expect(within(kipSecimi()).getByRole('option', { name: 'keep-alive' })).toBeEnabled();
    expect(kipSecimi()).toHaveAccessibleDescription('HTTP/2 yalnız keep-alive ile koşulur: tarayıcılar HTTP/2’de bağlantıyı açık tutar, her isteğe yeni bağlantı açmaz.');
    expect(gelismisDugmesi().textContent).toContain('en çok 150 VU · HTTP/2 · keep-alive · brotli (br)');
    const g1 = await onKontrolGovdesi(1);
    expect(g1.parametreler).toMatchObject({ motor: 'k6', kip: 'ka', protokol: 'h2' });
    // h1'e donus: kip kendiliginden degismez (ka kalir), yeni secenegi yeniden acik.
    fireEvent.change(protokolSecimi(), { target: { value: 'h1' } });
    expect(kipSecimi().value).toBe('ka');
    expect(within(kipSecimi()).getByRole('option', { name: 'yeni bağlantı' })).toBeEnabled();
    expect(kipSecimi()).toHaveAccessibleDescription(ALAN_ACIKLAMASI.kip);
    const g2 = await onKontrolGovdesi(2);
    expect(g2.parametreler).toMatchObject({ kip: 'ka', protokol: 'h1' });
  });

  it('H2-C3 wrk: protokol seçimi kapalı ve HTTP/1.1; önceden h2 seçilmiş olsa da gövde h1', async () => {
    api.onKontrol.mockResolvedValue({ ok: false, code: 'kilit_dolu', message: 'Başka bir yük testi sürüyor.', _httpStatus: 409 });
    await formAc();
    fireEvent.click(gelismisDugmesi());
    fireEvent.change(protokolSecimi(), { target: { value: 'h2' } });
    fireEvent.click(screen.getByRole('radio', { name: /^wrk/ }));
    expect(protokolSecimi()).toBeDisabled();
    expect(protokolSecimi().value).toBe('h1');
    expect(protokolSecimi()).toHaveAccessibleDescription('wrk yalnız HTTP/1.1 konuşur; HTTP/2 için yük aracı olarak k6’yı seçin.');
    expect(gelismisDugmesi().textContent).not.toContain('HTTP/2');
    const govde = await onKontrolGovdesi();
    expect(govde.parametreler).toMatchObject({ motor: 'wrk', protokol: 'h1' });
    // wrk'de kip 'yeni' secilebilir; k6'ya donunce kullanicinin h2 secimi geri gelir ve kip yine 'ka' (h2 keep-alive ister).
    fireEvent.change(screen.getByLabelText('Bağlantı kipi'), { target: { value: 'yeni' } });
    fireEvent.click(screen.getByRole('radio', { name: /^k6/ }));
    expect(protokolSecimi().value).toBe('h2');
    expect(kipSecimi().value).toBe('ka');
    const g2 = await onKontrolGovdesi(2);
    expect(g2.parametreler).toMatchObject({ motor: 'k6', kip: 'ka', protokol: 'h2' });
  });

  it('H2-C4 sunucu protokoller vermezse (eski sunucu) seçim kapalı, protokolYok açıklaması, gövde h1', async () => {
    const { protokoller: _yok, ...eski } = HEDEFLER;
    void _yok;
    api.hedefler.mockResolvedValue({ ...eski, varsayilan: { ...VARSAYILAN, protokol: 'h2' } });
    api.onKontrol.mockResolvedValue({ ok: false, code: 'kilit_dolu', message: 'Başka bir yük testi sürüyor.', _httpStatus: 409 });
    await formAc();
    expect(protokolSecimi()).toBeDisabled();
    expect(protokolSecimi().value).toBe('h1');
    expect(protokolSecimi()).toHaveAccessibleDescription('Sunucu bu sürümde HTTP/2 koşusunu kabul etmiyor.');
    const govde = await onKontrolGovdesi();
    expect(govde.parametreler).toMatchObject({ kip: 'yeni', protokol: 'h1' });
  });

  it('H2-C5 özet h1’de birebir, protokol değişince ön kontrol eskir; sunucunun protokol reddi alan hatası', async () => {
    api.onKontrol.mockResolvedValueOnce({ ok: true, kosuId: 16, jobId: 900, awxServerId: 1 });
    api.kosu.mockResolvedValue({ ok: true, kosu: ayrinti({ id: 16, islem: 'on_kontrol', durum: 'FAILED', protokol: 'h1', parametreler: { ...P_H2, kip: 'yeni', protokol: 'h1' } }), adimlar: [] });
    await formAc();
    expect(gelismisDugmesi().textContent).toContain('tekrar 2 · ısınma 30 sn · bekleme 30 sn · başta 60 sn · en çok 150 VU · yeni bağlantı · brotli (br)');
    // Kip once keep-alive: protokol degisikligi govdede YALNIZ protokolu degistirir (imza protokolu icermeli).
    fireEvent.click(gelismisDugmesi());
    fireEvent.change(kipSecimi(), { target: { value: 'ka' } });
    fireEvent.click(gelismisDugmesi());
    await onKontrolGovdesi(1);
    expect(await screen.findByText('Yük üretilmez. Sonuç geldiğinde engeller ve onay isteyen uyarılar burada listelenir.')).toBeTruthy();
    fireEvent.click(gelismisDugmesi());
    fireEvent.change(protokolSecimi(), { target: { value: 'h2' } });
    expect(await screen.findByText('Form bu ön kontrolden sonra değişti: sonuç yeni değerleri kapsamıyor.')).toBeTruthy();
    // Sunucunun 400'u (eski istemci kurali kacirdi varsayimi): metin protokol alaninin altinda.
    api.onKontrol.mockResolvedValueOnce({ ok: false, code: 'gecersiz_istek', message: 'HTTP/2 yalnız keep-alive (ka) bağlantı kipiyle koşulur; HTTP/2’de her isteğe yeni bağlantı tarayıcı davranışı değildir.', _httpStatus: 400 });
    await waitFor(() => expect(okDugmesi()).toBeEnabled());
    fireEvent.click(okDugmesi());
    await waitFor(() => expect(protokolSecimi()).toHaveAccessibleDescription('HTTP/2 yalnız keep-alive (ka) bağlantı kipiyle koşulur; HTTP/2’de her isteğe yeni bağlantı tarayıcı davranışı değildir.'));
    expect(gelismisDugmesi()).toHaveAttribute('aria-expanded', 'true');
    // Secim degisince alan hatasi kalkar.
    fireEvent.change(protokolSecimi(), { target: { value: 'h1' } });
    expect(protokolSecimi()).toHaveAccessibleDescription(ALAN_ACIKLAMASI.protokol);
  });
});

describe('Yük Testi HTTP/2 — onay, liste, ayrıntı (H2-C6, H2-C7)', () => {
  it('H2-C6 yük satırı: h1 k6 birebir, h2 “· HTTP/2 ·”, wrk birebir', () => {
    const h1 = { ...P_H2, protokol: 'h1' as const };
    expect(yukMetni(h1)).toBe('100 · 250 · 400 istek/sn × 2 tekrar = 6 adım · keep-alive · sıkıştırmasız');
    const { protokol: _p, ...eski } = h1;
    void _p;
    expect(yukMetni(eski)).toBe('100 · 250 · 400 istek/sn × 2 tekrar = 6 adım · keep-alive · sıkıştırmasız');
    expect(yukMetni(P_H2)).toBe('100 · 250 · 400 istek/sn × 2 tekrar = 6 adım · HTTP/2 · keep-alive · sıkıştırmasız');
    const wrk: NlParametreler = { motor: 'wrk', baglantilar: [2, 4, 8], is_parcacigi: 2, tavan_rps: 450, tekrar: 2, isinma: 30, sure: 120, bosluk: 30, bosta: 60, kip: 'ka', ae: 'br', protokol: 'h1' };
    expect(yukMetni(wrk)).toBe('wrk · 2 · 4 · 8 bağlantı × 2 tekrar = 6 adım · 2 iş parçacığı · ortalama ≤ 450 istek/sn · keep-alive · brotli (br)');
  });

  it('H2-C7 liste HTTP/2 çipi (h1 çipsiz); ayrıntıda Protokol satırı, çip, özet çipi ve bilgi tonunda h2 uyarısı', async () => {
    api.kosular.mockResolvedValue({
      ok: true, dahaVar: false,
      kosular: [
        kosuSatiriNormalle({ ...ayrinti({ id: 41, etiket: 'h2 koşusu' }), protokol: undefined, parametreler: JSON.stringify(P_H2) }),
        kosuSatiriNormalle({ ...ayrinti({ id: 40, etiket: 'h1 koşusu' }), protokol: 'h1' }),
      ],
    });
    const { unmount } = render(<KosuListesi onAc={vi.fn()} />);
    const satir = async (etiket: string) => (await screen.findByText(etiket)).closest('tr') as HTMLElement;
    expect(within(await satir('h2 koşusu')).getByText('HTTP/2')).toBeTruthy();
    expect(within(await satir('h1 koşusu')).queryByText('HTTP/2')).toBeNull();
    unmount();

    const ozet: NlSonucOzeti = {
      adimSayisi: 1, gecerliAdimSayisi: 1, toplamIstek: 12000, p95EnIyi: { deger: 2.1, tur: ADIM.tur }, p95EnKotu: { deger: 2.1, tur: ADIM.tur }, p95Kapsam: 'gecerli',
      toplam429: 0, toplam5xx: 0, enYuksekHataOrani: 0, hataVar: false, cpuOlculemeyenAdim: 0, konfDegisti: false, reloadlar: [],
    };
    const k = kosuNormalle({ ...ayrinti(), protokol: undefined, sonucOzeti: ozet, sonucOzet: { durum: 'OK', portal_analiz: { uyarilar: ['h2_vu_basina_tek_akis(tarayici_coklamasi_olculmez)'] } } });
    expect(k.protokol).toBe('h2');
    api.kosu.mockResolvedValue({ ok: true, kosu: k, adimlar: [adimNormalle(ADIM)] });
    const r = render(<KosuAyrinti kosuId={7} isAdmin={false} onGeri={vi.fn()} />);
    const dt = await screen.findByText('Protokol');
    expect(dt.nextElementSibling?.textContent).toBe('HTTP/2');
    expect(screen.getAllByText('HTTP/2').length).toBeGreaterThanOrEqual(3);
    expect(screen.getByLabelText('Koşu özeti').parentElement?.textContent).toContain('Bu koşu HTTP/2 ile ölçüldü.');
    // h2 kosu uyarisi bilgi kutusunda, "analiz uyarısı" sayilmaz.
    const bilgi = screen.getByText(H2_UYARI_CUMLESI);
    expect(bilgi.closest('[role="status"]')).toBeTruthy();
    expect(screen.queryByText(/analiz uyarısı/)).toBeNull();
    r.unmount();

    // h1 (eski satir: protokol yok) ve wrk.
    api.kosu.mockResolvedValue({ ok: true, kosu: kosuNormalle({ ...ayrinti({ id: 8 }), protokol: undefined, parametreler: { ...P_H2, protokol: undefined, kip: 'yeni' } }), adimlar: [adimNormalle(ADIM)] });
    const r2 = render(<KosuAyrinti kosuId={8} isAdmin={false} onGeri={vi.fn()} />);
    expect((await screen.findByText('Protokol')).nextElementSibling?.textContent).toBe('HTTP/1.1');
    expect(screen.queryByText('HTTP/2')).toBeNull();
    expect(screen.queryByText('Bu koşu HTTP/2 ile ölçüldü.')).toBeNull();
    r2.unmount();
    api.kosu.mockResolvedValue({ ok: true, kosu: ayrinti({ id: 9, motor: 'wrk', protokol: 'h1', parametreler: { motor: 'wrk', baglantilar: [2, 4], is_parcacigi: 2, tavan_rps: 450, tekrar: 1, isinma: 10, sure: 40, bosluk: 10, bosta: 30, kip: 'ka', ae: 'br' } }), adimlar: [] });
    render(<KosuAyrinti kosuId={9} isAdmin={false} onGeri={vi.fn()} />);
    expect((await screen.findByText('Protokol')).nextElementSibling?.textContent).toBe('HTTP/1.1 (wrk)');
  });
});

describe('Yük Testi HTTP/2 — cümleler ve ön kontrol (H2-C8, H2-C9)', () => {
  it('H2-C8 neden / uyarı cümleleri aynen; olcum_kenari faz metni ve “(ölçüm etkilenmedi)”', () => {
    expect(nedenAcikla('h2_disi(3)')).toMatchObject({ cumle: 'HTTP/2 koşusunda 3 yanıt HTTP/2 dışında geldi; bu adım HTTP/2 ölçümü sayılmaz.', ton: 'hata', kod: 'h2_disi(3)' });
    expect(nedenAcikla('h2_disi(12001)').cumle).toBe('HTTP/2 koşusunda 12.001 yanıt HTTP/2 dışında geldi; bu adım HTTP/2 ölçümü sayılmaz.');
    expect(nedenAcikla('protokol_farkli(beklenen=h2,olculen=yok)').cumle).toBe('Yük aracı istenen protokolü kullanmadı (beklenen HTTP/2, ölçülen bilinmiyor); Ansible deposu eski olabilir.');
    expect(nedenAcikla('protokol_farkli(beklenen=h1,olculen=h2)').cumle).toBe('Yük aracı istenen protokolü kullanmadı (beklenen HTTP/1.1, ölçülen HTTP/2); Ansible deposu eski olabilir.');
    expect(nedenAcikla('protokol_farkli(beklenen=h3,olculen=h2)').bilinmiyor).toBe(true);
    expect(nedenAcikla('hatali_kosu(kos.sh_durdurdu)').cumle).toBe('Yük betiği bu adımı yarıda durdurdu (429, 5xx, soket hatası, yüksek hata oranı ya da beklenmeyen protokol).');
    expect(nedenAcikla('http2').cumle).toBe('İstekler HTTP/2 ile gitti; ölçüm HTTP/1.1 için kurulu olduğundan bu adım karşılaştırılamaz.');
    expect(uyariAcikla('h2_vu_basina_tek_akis(tarayici_coklamasi_olculmez)')).toMatchObject({
      ton: 'bilgi', cumle: 'HTTP/2 koşusu: k6 her sanal kullanıcıda tek bağlantı açar ve istekleri sırayla gönderir; tarayıcıdaki gibi tek bağlantıda çok sayıda eş zamanlı akış ölçülmez. Yalnız HTTP/2 koşularıyla karşılaştırın.',
    });
    const t = Date.parse('2026-11-02T14:59:12+03:00') / 1000;
    expect(reloadZamanMetni({ t, tOnce: null, tur: '100/sn · r1', faz: 'olcum_kenari' })).toBe('saat 14:59:12 civarında, 100/sn · r1 ölçümün başında ya da sonunda, CPU penceresi dışında');
    const ozet: NlSonucOzeti = {
      adimSayisi: 1, gecerliAdimSayisi: 1, toplamIstek: 1, p95EnIyi: null, p95EnKotu: null, p95Kapsam: null, toplam429: 0, toplam5xx: 0, enYuksekHataOrani: 0, hataVar: false,
      cpuOlculemeyenAdim: 0, konfDegisti: null,
      reloadlar: [{ t, tOnce: null, tSon: t + 2, tur: null, faz: 'olcum_kenari', kesit: 'R7_x', workerOnce: 8, workerSonra: 8, kapananEnCok: 8, etkilenenTurlar: [] }],
    };
    expect(reloadOzetMetni(ozet, [], 'istek/sn')).toBe('Koşu sırasında nginx 1 kez yeniden yüklendi (reload): saat 14:59:12 civarında, ölçümün başında ya da sonunda, CPU penceresi dışında (ölçüm etkilenmedi).');
  });

  const OK_H2 = {
    ip_yerel: true, server_name_var: true, master_sayisi: 1, web_log_df: 20, log_dizini_okunur: true, log_format_ua: true, statik_direktif: false,
    k6_var: true, k6_surum: 'k6 v0.49.0', yollar_toplam: 3, yollar_200: 3, ilk_hatalar: [], protokol: 'h2', curl_h2: true, yollar_yanitli: 3, yollar_h2: 3, alpn_h2: true,
  };
  const panel = (ok: Record<string, unknown>, o: Partial<NlKosuAyrinti> = {}) =>
    render(<OnKontrolPaneli kosu={{ durum: 'DONE', isDurumu: 'OK', motor: 'k6', protokol: 'h2', parametreler: P_H2, onKontrol: onKontrolNormalle(ok), sunucuDegerlendirmesi: null, ...o }} />);
  const satir = () => screen.getByText('HTTP/2 (ALPN)').closest('li') as HTMLElement;

  it('H2-C9 HTTP/2 (ALPN) satırı üç durum + curl h2’siz; h1’de satır yok; istemci engeli sunucuyla aynı', () => {
    const { unmount: u1 } = panel(OK_H2);
    expect(satir().textContent).toContain('3/3 yol HTTP/2 ile yanıt verdi · geçti');
    expect(screen.getByText('Ön kontrol temiz — koşu başlatılabilir.')).toBeTruthy();
    u1();
    const { unmount: u2 } = panel({ ...OK_H2, yollar_h2: 0, alpn_h2: false });
    expect(satir().textContent).toContain('Hedef bu Host için HTTP/2 sunmuyor (0/3 yol) · kaldı');
    expect(screen.getByText(/^Hedef bu Host için HTTP\/2 sunmuyor \(ALPN\): 0\/3 yol HTTP\/2 ile yanıt verdi\./)).toBeTruthy();
    u2();
    const { unmount: u3 } = panel({ ...OK_H2, yollar_yanitli: 0, yollar_h2: 0, alpn_h2: '-' });
    expect(satir().textContent).toMatch(/ölçülemedi$/);
    expect(satir().textContent).not.toContain('geçti');
    expect(screen.getByText('HTTP/2 desteği ölçülemedi (playbook HTTP/2 ön kontrolünü desteklemiyor olabilir; Ansible deposunu güncelleyin).')).toBeTruthy();
    u3();
    const { unmount: u4 } = panel({ ...OK_H2, curl_h2: false, alpn_h2: '-', yollar_yanitli: null, yollar_h2: null });
    expect(satir().textContent).toContain('curl HTTP/2 desteklemiyor · ölçülemedi');
    expect(screen.getByText('Yük sunucusundaki curl HTTP/2 desteklemiyor; HTTP/2 ön kontrolü yapılamadı.')).toBeTruthy();
    u4();
    // Eski playbook: h2 alanlari yok -> olculemedi (gecti DEGIL) ve engel.
    const { protokol: _a, curl_h2: _b, yollar_yanitli: _c, yollar_h2: _d, alpn_h2: _e, ...eskiOk } = OK_H2;
    void [_a, _b, _c, _d, _e];
    const { unmount: u5 } = panel(eskiOk);
    expect(satir().textContent).toMatch(/ölçülemedi$/);
    expect(onKontrolDegerlendir({ durum: 'DONE', isDurumu: 'OK', motor: 'k6', protokol: 'h2', onKontrol: onKontrolNormalle(eskiOk) }).engeller).toEqual(['HTTP/2 desteği ölçülemedi (playbook HTTP/2 ön kontrolünü desteklemiyor olabilir; Ansible deposunu güncelleyin).']);
    u5();
    // h1 on kontrolune dayanan h2 satiri: "HTTP/2 icin yapilmadi" (tek engel).
    expect(onKontrolDegerlendir({ durum: 'DONE', isDurumu: 'OK', motor: 'k6', protokol: 'h2', onKontrol: onKontrolNormalle({ ...OK_H2, protokol: 'h1', curl_h2: false }) }).engeller).toEqual(['Ön kontrol HTTP/2 için yapılmadı; ön kontrolü yeniden çalıştırın.']);
    // h1: satir ve h2 engeli YOK (h2 alanlari yok sayilir).
    panel({ ...OK_H2, alpn_h2: false }, { protokol: 'h1', parametreler: { ...P_H2, protokol: 'h1' } });
    expect(screen.queryByText('HTTP/2 (ALPN)')).toBeNull();
    expect(screen.getByText('Ön kontrol temiz — koşu başlatılabilir.')).toBeTruthy();
  });
});

describe('Yük Testi HTTP/2 — karşılaştır (H2-C10)', () => {
  it('H2-C10 farklı protokol bilgi kutusu, seçicide HTTP/2, karar satırında iki tarafın protokolü', async () => {
    api.kosular.mockResolvedValue({
      ok: true, dahaVar: false,
      kosular: [kosuSatiriNormalle(ayrinti({ id: 51, protokol: 'h2' })), kosuSatiriNormalle({ ...ayrinti({ id: 50 }), protokol: undefined, parametreler: { ...P_H2, protokol: undefined, kip: 'ka' } })],
    });
    api.karsilastir.mockResolvedValue({ ok: true, karar: 'VERI_YOK', nedenler: ['farkli protokol: referans HTTP/1.1, aday HTTP/2; ayni protokolle yeniden kosun'], tablo: [], ref: { id: 50, etiket: null, createdAt: null, protokol: 'h1' }, aday: { id: 51, etiket: null, createdAt: null, protokol: 'h2' }, kademe: null });
    render(<Karsilastir />);
    const ref = await screen.findByLabelText('Referans koşu');
    expect(await within(ref).findByRole('option', { name: /^#51 · GBNGXT33 · HTTP\/2 · / })).toBeTruthy();
    expect(within(ref).getByRole('option', { name: /^#50 · GBNGXT33 · \d/ })).toBeTruthy();
    fireEvent.change(ref, { target: { value: '50' } });
    expect(screen.queryByText(/farklı protokolle koşuldu/)).toBeNull();
    fireEvent.change(screen.getByLabelText('Aday koşu'), { target: { value: '51' } });
    expect(screen.getByText('İki koşu farklı protokolle koşuldu (HTTP/1.1 / HTTP/2); sonuç “Veri yok” döner, aynı protokolle yeniden koşun.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Karşılaştır/ }));
    expect(await screen.findByText('#50 (HTTP/1.1) → #51 (HTTP/2)')).toBeTruthy();
  });
});

const sunucuCjs = createRequire(import.meta.url);
describe('Yük Testi HTTP/2 — normalleştirme ve saf kurallar (H2-C11)', () => {
  it('H2-C11 protokoller / protokol / ön kontrol alanları; h2 kuralları sunucunun dogrula.parametreler’iyle aynı', () => {
    expect(hedeflerNormalle({ ...HEDEFLER }).protokoller).toEqual(['h1', 'h2']);
    expect(hedeflerNormalle({ ...HEDEFLER, protokoller: undefined }).protokoller).toEqual(['h1']);
    expect(hedeflerNormalle({ ...HEDEFLER, protokoller: ['h2', 'h3'] }).protokoller).toEqual(['h1', 'h2']);
    expect(hedeflerNormalle({ ...HEDEFLER, varsayilan: { ...VARSAYILAN, protokol: undefined } }).varsayilan.protokol).toBe('h1');
    expect(kosuSatiriNormalle({ id: 1 }).protokol).toBe('h1');
    expect(kosuSatiriNormalle({ id: 1, parametreler: '{"motor":"k6","protokol":"h2"}' }).protokol).toBe('h2');
    expect(kosuSatiriNormalle({ id: 1, protokol: 'h1', parametreler: { protokol: 'h2' } }).protokol).toBe('h1');
    expect(kosuSatiriNormalle({ id: 1, protokol: 'H2' }).protokol).toBe('h1');
    expect(onKontrolNormalle({ k6_var: true, protokol: 'h2', curl_h2: 'True', alpn_h2: 'False', yollar_yanitli: '4', yollar_h2: '1' })).toMatchObject({ protokol: 'h2', curlH2: true, alpnH2: false, yollarYanitli: 4, yollarH2: 1 });
    expect(onKontrolNormalle({ k6_var: true, alpn_h2: '-' })).toMatchObject({ protokol: null, curlH2: null, alpnH2: null, yollarYanitli: null, yollarH2: null });
    // Saf kurallar (sunucu 400 metinleriyle).
    const p = { ...P_H2 };
    expect(parametreHatalari(p, SINIR)).toEqual({});
    expect(parametreHatalari({ ...p, kip: 'yeni' }, SINIR)).toEqual({ kip: 'HTTP/2 yalnız keep-alive (ka) bağlantı kipiyle koşulur.' });
    expect(parametreHatalari({ motor: 'wrk', baglantilar: [2, 4], is_parcacigi: 2, tekrar: 1, isinma: 10, sure: 40, bosluk: 10, bosta: 30, kip: 'ka', ae: 'br', protokol: 'h2' }, SINIR)).toEqual({ protokol: 'HTTP/2 yalnız k6 ile seçilebilir; wrk yalnız HTTP/1.1 konuşur.' });
    expect(parametreHatalari({ ...p, protokol: 'h3' as never }, SINIR)).toEqual({ protokol: "protokol 'h1' ya da 'h2' olmalı." });
    // Hazir ayar + h2: kip ka, wrk h1; sunucunun kendi dogrulamasindan gecer (butce ayni).
    const dg = sunucuCjs('../../../../server/nginx-loadtest/dogrula.cjs') as {
      SINIRLAR: NlSinirlar; VARSAYILAN: NlVarsayilanlar;
      parametreler: (ham: unknown, o: { sni: boolean; hedefTuru?: string }) => { ok?: boolean; deger?: { protokol?: string; kip?: string; butceSn: number }; error?: unknown; message?: string };
    };
    for (const hz of HAZIR_AYAR_SIRASI) {
      const d = hazirAyar(hz, dg.SINIRLAR, dg.VARSAYILAN);
      const k6 = hazirAyarParametresi(d, 'k6', 'yeni', 'br', 'h2');
      expect(k6).toMatchObject({ kip: 'ka', protokol: 'h2' });
      expect(parametreHatalari(k6, dg.SINIRLAR)).toEqual({});
      const r = dg.parametreler(k6, { sni: false, hedefTuru: 'sunucu' });
      expect({ hz, ok: r.ok === true, protokol: r.deger?.protokol, kip: r.deger?.kip }).toEqual({ hz, ok: true, protokol: 'h2', kip: 'ka' });
      const wrk = hazirAyarParametresi(d, 'wrk', 'yeni', 'br', 'h2');
      expect(wrk).toMatchObject({ kip: 'yeni', protokol: 'h1' });
      expect(dg.parametreler(wrk, { sni: false, hedefTuru: 'sunucu' }).deger?.protokol).toBe('h1');
    }
    // Istemci ve sunucu ayni girdiyi reddeder.
    for (const kotu of [{ ...p, kip: 'yeni' as const }, { ...p, protokol: 'h3' as never }]) {
      expect(Object.keys(parametreHatalari(kotu, dg.SINIRLAR)).length).toBe(1);
      expect(dg.parametreler(kotu, { sni: false, hedefTuru: 'sunucu' }).ok).not.toBe(true);
    }
  });
});
