// src/components/nginx_console/__tests__/yuk-testi-tab.test.tsx — Nginx Hub > Yük Testi ekrani (2026-10-27).
//
// YT1 Admin olmayan (sekme yetkisi olan) kullanici sonuclari okur: "Yeni koşu" sekmesi, "Yeni senaryo", silme,
//     "Durdur" ve canli "İş çıktısı" (Admin ucu /durum) HIC cizilmez; /durum hic cagrilmaz.
// YT2 Admin ayni ekranda bu dugmeleri gorur.
// YT3 Onay penceresi: hedef sunucu adi BIREBIR yazilmadan (kucuk harf de olmaz) dugme kapali; yapistirma kapali;
//     "İptal" var.
// YT4 On kontrol uyarisi varsa onay kutusu isaretlenmeden dugme kapali; gonderilen deger uyariOnay=true.
// YT5 Uctan uca (sahte API): form -> on kontrol (govdede istemci IP'si yalniz adaylardan) -> uyarili sonuc ->
//     onay penceresi -> sunucu 409 uyari_onayi -> kutu yeniden -> baslat; kosu ayrintisina gecis.
// Inceleme duzeltmeleri (2026-10-27, S7):
// YT7  Durdur: 424 durdur_baslatilamadi KALICI hata kutusu (sunucu mesaji), basari bildirimi yok; 200 ama durdur isi
//      yoksa da ayni (eski sunucuya karsi).
// YT8  Durdur: 409 baslatiliyor bilgi bildirimi; basari "Durdurma işi AWX #N başlatıldı ...".
// YT9  Ön kontrol satirinda pencere ve bildirim yalniz AWX iptalini soyler (k6 / kaydedici yok).
// YT10 Iptal edilmis KOSUDA Admin "Kalan süreçleri durdur" (ayni uc); baslikta "Durdurma işi AWX #N".
// YT11 Kosunun "Ön kontrol" sekmesi on kontrolu KENDI durumuyla (DONE/OK) gosterir: "Onaylanan uyarılar", cagri yok.
// YT12 Basarisiz on kontrolun asil nedeni engelde; okunamayan log dizini "kaldı".
// YT13 Taranmis ama adlandirilmis server_name'i olmayan hedef: vhost kapali + metin + on kontrol kapali; serbest
//      metin yalniz vhostVerisi === false.
// YT14 Adim tablosu: etiket tekrar'dan (r2; deneme > 1 ise eklenir), sira ve grafik etiketi tekrar'la; uyari cipi ve
//      ayrintida liste; pencere istemci saatinden ise sunucu rps "—".
// YT15 OKUNAMADI: dogru metin (otomatik yeniden okuma vaadi yok), Admin "Sonucu yeniden oku" -> POST yeniden-oku.
// YT16 FINALIZING: "Sonuç okunuyor (deneme N/3)".
// YT17 Karşılaştır secicisi sunucudan islem=kosu, durum=DONE, limit=200 ister.
// YT18 Koşular: dahaVar ise "Daha eski koşular" onceki=<en kucuk id> ile ekler; tazeleme eski sayfayi silmez.
// YT19 HAR ozetinde ";" parametresi atilan yol sayaci; kaydedilen satirlarda ve ozette oturum kimligi yok.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor, within, createEvent } from '@testing-library/react';
import { render } from '@/test/test-utils';
import type { NlKosuAyrinti } from '@/api/nginxLoadtestApi';

const KOSU_LISTE = {
  id: 17, islem: 'kosu', etiket: 'T0 — F5 öncesi', adim: 'R17', hedefHost: 'GBNGXT10', hedefIp: '10.1.2.3', vhost: 'glomo-test.fw.garantibbva.com.tr',
  yukHost: 'GBNGXT34', senaryoId: 3, senaryoAd: 'GLOMO 3 HAR', durum: 'RUNNING', gecerlilik: null, createdBy: 'onur', createdAt: '2026-10-27T08:00:00Z',
  startedAt: '2026-10-27T08:00:05Z', finishedAt: null, awxJobId: 4242,
};
const PARAM = { hizlar: [100, 250, 400], tekrar: 2, isinma: 30, sure: 120, bosluk: 30, bosta: 60, maxvu: 150, kip: 'yeni', ae: 'br' };
const ON_KONTROL_UYARILI = {
  ip_yerel: true, server_name_var: true, master_sayisi: 1, web_log_df: 40, log_dizini_okunur: true, log_format_ua: true, statik_direktif: false,
  k6_var: true, k6_surum: 'k6 v0.49.0', k6_sha256: 'a'.repeat(64), yollar_toplam: 264, yollar_200: 260,
  ilk_hatalar: [{ yol: '/app-v1/assets/eski.js', status: '404' }], sikistirma: { statik: 0, dinamik: 200, sikistirmasiz: 64 },
};
const SENARYO = { id: 3, ad: 'GLOMO 3 HAR', aciklama: null, vhost: 'glomo-test.fw.garantibbva.com.tr', senaryoTur: 'K', yolSayisi: 264, sha256: 'b'.repeat(64), kaynak: 'har', createdBy: 'onur', createdAt: '2026-10-26T10:00:00Z' };
const HEDEFLER = {
  ok: true,
  hedefler: [
    { host: 'GBNGXT10', env: 'TEST', ipler: ['10.1.2.3', '10.1.2.4'], vhostlar: ['glomo-test.fw.garantibbva.com.tr'], vhostVerisi: true, uygun: true, neden: null },
    { host: 'GBNGXP40', env: 'PROD', ipler: ['10.9.9.9'], vhostlar: [], vhostVerisi: false, uygun: false, neden: 'hedef_uretim' },
    // Taranmis, ama yalniz `server_name _;` / joker / regex: adlandirilmis vhost yok.
    { host: 'GBNGXT20', env: 'TEST', ipler: ['10.2.2.2'], vhostlar: [], vhostVerisi: true, uygun: true, neden: null },
    // Hic dokum yok (tarama verisi yok): vhost elle yazilir.
    { host: 'GBNGXT21', env: 'TEST', ipler: ['10.2.2.3'], vhostlar: [], vhostVerisi: false, uygun: true, neden: null },
  ],
  yukHostlari: [{ host: 'GBNGXT34', env: 'TEST', uygun: true, neden: null }],
  sinirlar: { maxHiz: 450, maxTekrar: 3, sureMin: 40, sureMax: 300, isinmaMax: 60, maxVu: 199, maxButceSn: 2700 },
  varsayilan: PARAM,
};

const api = vi.hoisted(() => ({
  hedefler: vi.fn(), senaryolar: vi.fn(), senaryo: vi.fn(), senaryoKaydet: vi.fn(), senaryoSil: vi.fn(), onKontrol: vi.fn(),
  baslat: vi.fn(), kosular: vi.fn(), kosu: vi.fn(), durum: vi.fn(), durdur: vi.fn(), yenidenOku: vi.fn(), karsilastir: vi.fn(),
}));
vi.mock('@/api/nginxLoadtestApi', async (orijinal) => ({ ...(await orijinal<typeof import('@/api/nginxLoadtestApi')>()), nginxLoadtestApi: api }));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }));
vi.mock('@/hooks/useToast', () => ({ toast }));

import { YukTestiTab } from '../YukTestiTab';
import BaslatOnayi from '../yukTesti/BaslatOnayi';
import KosuAyrinti from '../yukTesti/KosuAyrinti';
import KosuListesi from '../yukTesti/KosuListesi';
import Karsilastir from '../yukTesti/Karsilastir';
import OnKontrolPaneli from '../yukTesti/OnKontrolPaneli';
import Senaryolar from '../yukTesti/Senaryolar';
import { OKUNAMADI_ACIKLAMASI, VHOST_YOK_METNI } from '../yukTesti/yukTestiOrtak';
import { adimNormalle, onKontrolNormalle } from '@/api/nginxLoadtestApi';

function ayrinti(o: Partial<NlKosuAyrinti> = {}): NlKosuAyrinti {
  return {
    ...(KOSU_LISTE as unknown as NlKosuAyrinti), parametreler: PARAM as NlKosuAyrinti['parametreler'], onKontrol: null,
    gecersizNedenleri: [], sonucOzet: null, onKontrolKosuId: null, sunucuDegerlendirmesi: null, onKontrolYasSn: null, isDurumu: null, isHatasi: null,
    analiz: { nproc: null, cpuTlsliPay: null, uyarilar: [], okumaHatasi: null }, durdurIsi: null, sonuclandirmaDenemesi: 0, ...o,
  };
}
const kosuYukle = (o: Partial<NlKosuAyrinti> = {}, adimlar: unknown[] = []) => api.kosu.mockResolvedValue({ ok: true, kosu: ayrinti(o), adimlar });

beforeEach(() => {
  for (const f of Object.values(api)) f.mockReset();
  for (const f of Object.values(toast)) f.mockReset();
  api.kosular.mockResolvedValue({ ok: true, kosular: [KOSU_LISTE], dahaVar: false });
  api.kosu.mockResolvedValue({ ok: true, kosu: ayrinti(), adimlar: [] });
  api.senaryolar.mockResolvedValue({ ok: true, senaryolar: [SENARYO] });
  api.hedefler.mockResolvedValue(HEDEFLER);
  api.durum.mockResolvedValue({ ok: true, status: 'running', finished: false, output: 'PLAY [x]\n', result: null, kosuDurum: 'RUNNING' });
});

describe('Yük Testi sekmesi — erişim', () => {
  it('YT1 Admin olmayan: Yeni koşu / Yeni senaryo / sil / Durdur / İş çıktısı yok, /durum çağrılmaz', async () => {
    render(<YukTestiTab isAdmin={false} />);
    expect(await screen.findByText('T0 — F5 öncesi')).toBeTruthy();
    expect(screen.queryByRole('tab', { name: /Yeni koşu/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Koşu 17 ayrıntısı' }));
    expect(await screen.findByRole('tab', { name: 'Sonuçlar' })).toBeTruthy();
    expect(screen.queryByRole('tab', { name: /İş çıktısı/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Durdur/ })).toBeNull();
    fireEvent.click(screen.getByRole('tab', { name: /Senaryolar/ }));
    expect(await screen.findByText('GLOMO 3 HAR')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Yeni senaryo/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /sil$/ })).toBeNull();
    expect(screen.getByRole('button', { name: /önizle$/ })).toBeTruthy();
    expect(api.durum).not.toHaveBeenCalled();
    expect(api.onKontrol).not.toHaveBeenCalled();
  });

  it('YT2 Admin: Yeni koşu sekmesi, Durdur, canlı iş çıktısı, Yeni senaryo ve sil var', async () => {
    render(<YukTestiTab isAdmin />);
    expect(await screen.findByRole('tab', { name: /Yeni koşu/ })).toBeTruthy();
    fireEvent.click(await screen.findByRole('button', { name: 'Koşu 17 ayrıntısı' }));
    expect(await screen.findByRole('button', { name: /Durdur/ })).toBeTruthy();
    expect(screen.getByRole('tab', { name: /İş çıktısı/ })).toHaveAttribute('aria-selected', 'true');
    await waitFor(() => expect(api.durum).toHaveBeenCalledWith(17, 0, expect.anything()));
    fireEvent.click(screen.getByRole('tab', { name: /Senaryolar/ }));
    expect(await screen.findByRole('button', { name: /Yeni senaryo/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'GLOMO 3 HAR sil' })).toBeTruthy();
  });
});

describe('Yük Testi — başlatma onayı', () => {
  const onKontrol = () => ayrinti({ id: 16, islem: 'on_kontrol', durum: 'DONE', finishedAt: new Date().toISOString() });

  it('YT3 hedef adı birebir yazılmadan düğme kapalı; yapıştırma kapalı; İptal kapatır', () => {
    const onOnay = vi.fn();
    const onKapat = vi.fn();
    render(<BaslatOnayi onKontrol={onKontrol()} senaryo={null} uyarilar={[]} sunucuUyarilari={null} busy={false} hata={null} onOnay={onOnay} onKapat={onKapat} />);
    const dugme = screen.getByRole('button', { name: /Yük testini başlat/ });
    const girdi = screen.getByLabelText(/hedef sunucunun adını yazın/);
    expect(dugme).toBeDisabled();
    fireEvent.change(girdi, { target: { value: 'gbngxt10' } });
    expect(dugme).toBeDisabled();
    fireEvent.change(girdi, { target: { value: 'GBNGXT10 ' } });
    expect(dugme).toBeDisabled();
    const yapistir = createEvent.paste(girdi);
    fireEvent(girdi, yapistir);
    expect(yapistir.defaultPrevented).toBe(true);
    fireEvent.change(girdi, { target: { value: 'GBNGXT10' } });
    expect(dugme).toBeEnabled();
    fireEvent.click(dugme);
    expect(onOnay).toHaveBeenCalledWith({ confirmText: 'GBNGXT10', uyariOnay: false });
    fireEvent.click(screen.getByRole('button', { name: 'İptal' }));
    expect(onKapat).toHaveBeenCalled();
  });

  it('YT4 uyarı varsa onay kutusu zorunlu; gönderilen uyariOnay=true', () => {
    const onOnay = vi.fn();
    render(<BaslatOnayi onKontrol={onKontrol()} senaryo={null} uyarilar={['4 / 264 yol 200 dönmedi']} sunucuUyarilari={null} busy={false} hata={null} onOnay={onOnay} onKapat={vi.fn()} />);
    fireEvent.change(screen.getByLabelText(/hedef sunucunun adını yazın/), { target: { value: 'GBNGXT10' } });
    const dugme = screen.getByRole('button', { name: /Yük testini başlat/ });
    expect(dugme).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox', { name: /Uyarıları okudum/ }));
    expect(dugme).toBeEnabled();
    fireEvent.click(dugme);
    expect(onOnay).toHaveBeenCalledWith({ confirmText: 'GBNGXT10', uyariOnay: true });
  });
});

describe('Yük Testi — yeni koşu akışı', () => {
  it('YT5 ön kontrol -> uyarılı sonuç -> 409 uyari_onayi -> onaylı başlatma -> koşu ayrıntısı', async () => {
    const okKayit = ayrinti({ id: 16, islem: 'on_kontrol', durum: 'DONE', finishedAt: new Date().toISOString(), onKontrol: onKontrolNormalle(ON_KONTROL_UYARILI) });
    api.onKontrol.mockResolvedValue({ ok: true, kosuId: 16, jobId: 900, awxServerId: 1 });
    api.kosu.mockImplementation(async (id: number) => ({ ok: true, kosu: id === 16 ? okKayit : ayrinti({ id: 18 }), adimlar: [] }));
    api.durum.mockResolvedValue({ ok: true, status: 'successful', finished: true, output: 'PLAY RECAP\n', result: null, kosuDurum: 'DONE' });
    api.baslat
      .mockResolvedValueOnce({ ok: false, code: 'uyari_onayi', message: 'Uyarılar onaylanmalı.', uyarilar: ['Sunucu: /web_log %70'], _httpStatus: 409 })
      .mockResolvedValueOnce({ ok: true, kosuId: 18, jobId: 901, awxServerId: 1 });

    render(<YukTestiTab isAdmin />);
    fireEvent.click(await screen.findByRole('tab', { name: /Yeni koşu/ }));
    fireEvent.change(await screen.findByLabelText('Senaryo'), { target: { value: '3' } });
    const hedefSecimi = screen.getByLabelText('Hedef sunucu');
    expect(within(hedefSecimi).getByRole('option', { name: /GBNGXP40/ })).toBeDisabled();
    fireEvent.change(hedefSecimi, { target: { value: 'GBNGXT10' } });
    fireEvent.change(screen.getByLabelText('Hedef IP'), { target: { value: '10.1.2.4' } });
    const baslatDugmesi = screen.getByRole('button', { name: /Koşuyu başlat/ });
    expect(baslatDugmesi).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: /Ön kontrolü başlat/ }));
    await waitFor(() => expect(api.onKontrol).toHaveBeenCalledTimes(1));
    expect(api.onKontrol.mock.calls[0][0]).toEqual({
      senaryoId: 3, hedefHost: 'GBNGXT10', hedefIp: '10.1.2.4', vhost: 'glomo-test.fw.garantibbva.com.tr', yukHost: 'GBNGXT34', sni: false, parametreler: PARAM,
    });
    expect(await screen.findByText(/uyarı — başlatırken açıkça onaylamanız gerekir/)).toBeTruthy();
    await waitFor(() => expect(screen.getByRole('button', { name: /Koşuyu başlat/ })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: /Koşuyu başlat/ }));

    const pencere = await screen.findByRole('dialog');
    fireEvent.change(within(pencere).getByLabelText(/hedef sunucunun adını yazın/), { target: { value: 'GBNGXT10' } });
    fireEvent.click(within(pencere).getByRole('checkbox', { name: /Uyarıları okudum/ }));
    fireEvent.click(within(pencere).getByRole('button', { name: /Yük testini başlat/ }));
    await waitFor(() => expect(api.baslat).toHaveBeenCalledTimes(1));
    expect(api.baslat.mock.calls[0][0]).toEqual({ onKontrolKosuId: 16, confirmText: 'GBNGXT10', uyariOnay: true });
    // Sunucu kendi uyarisini ekledi: pencere acik kalir, liste buyur, kutu yeniden isaretlenir.
    expect(await within(pencere).findByText('Sunucu: /web_log %70')).toBeTruthy();
    fireEvent.click(within(pencere).getByRole('button', { name: /Yük testini başlat/ }));
    await waitFor(() => expect(api.baslat).toHaveBeenCalledTimes(2));
    expect(await screen.findByRole('heading', { name: /Koşu #18/ })).toBeTruthy();
  });

  it('YT6 form ön kontrolden sonra değişirse Başlat kapanır', async () => {
    const okKayit = ayrinti({ id: 16, islem: 'on_kontrol', durum: 'DONE', finishedAt: new Date().toISOString(), onKontrol: onKontrolNormalle({ ...ON_KONTROL_UYARILI, yollar_200: 264 }) });
    api.onKontrol.mockResolvedValue({ ok: true, kosuId: 16, jobId: 900, awxServerId: 1 });
    api.kosu.mockResolvedValue({ ok: true, kosu: okKayit, adimlar: [] });
    api.durum.mockResolvedValue({ ok: true, status: 'successful', finished: true, output: '', result: null, kosuDurum: 'DONE' });
    render(<YukTestiTab isAdmin />);
    fireEvent.click(await screen.findByRole('tab', { name: /Yeni koşu/ }));
    fireEvent.change(await screen.findByLabelText('Senaryo'), { target: { value: '3' } });
    fireEvent.change(screen.getByLabelText('Hedef sunucu'), { target: { value: 'GBNGXT10' } });
    fireEvent.change(screen.getByLabelText('Hedef IP'), { target: { value: '10.1.2.3' } });
    fireEvent.click(screen.getByRole('button', { name: /Ön kontrolü başlat/ }));
    await waitFor(() => expect(screen.getByRole('button', { name: /Koşuyu başlat/ })).toBeEnabled());
    fireEvent.change(screen.getByLabelText('Tekrar'), { target: { value: '3' } });
    expect(screen.getByRole('button', { name: /Koşuyu başlat/ })).toBeDisabled();
    expect(screen.getByText(/Form ön kontrolden sonra değişti/)).toBeTruthy();
  });

  it('YT13 adlandırılmış server_name yoksa vhost kapalı + metin + ön kontrol kapalı; serbest metin yalnız vhostVerisi=false', async () => {
    render(<YukTestiTab isAdmin />);
    fireEvent.click(await screen.findByRole('tab', { name: /Yeni koşu/ }));
    fireEvent.change(await screen.findByLabelText('Senaryo'), { target: { value: '3' } });
    fireEvent.change(screen.getByLabelText('Hedef sunucu'), { target: { value: 'GBNGXT20' } });
    const vhost = screen.getByLabelText('Vhost (Host başlığı)');
    expect(vhost).toBeDisabled();
    expect(screen.getByText(VHOST_YOK_METNI)).toBeTruthy();
    expect(screen.getByRole('button', { name: /Ön kontrolü başlat/ })).toBeDisabled();
    // Dokum hic yok (vhostVerisi false): elle yazilir, on kontrol acilir.
    fireEvent.change(screen.getByLabelText('Hedef sunucu'), { target: { value: 'GBNGXT21' } });
    const serbest = screen.getByLabelText('Vhost (Host başlığı)');
    expect(serbest).toBeEnabled();
    expect(screen.queryByText(VHOST_YOK_METNI)).toBeNull();
    expect(screen.getByText('Bu hedef için server_name dökümü yok; adı elle yazın.')).toBeTruthy();
    fireEvent.change(serbest, { target: { value: 'glomo-test.fw.garantibbva.com.tr' } });
    expect(screen.getByRole('button', { name: /Ön kontrolü başlat/ })).toBeEnabled();
    // Dokumu olan hedef: secim kutusu, uyari metni yok.
    fireEvent.change(screen.getByLabelText('Hedef sunucu'), { target: { value: 'GBNGXT10' } });
    expect(screen.getByLabelText('Vhost (Host başlığı)').tagName).toBe('SELECT');
    expect(screen.queryByText(VHOST_YOK_METNI)).toBeNull();
  });
});

describe('Yük Testi — durdur (2026-10-27)', () => {
  const MESAJ_424 = "AWX işi iptal edildi, ancak durdurma işi başlatılamadı: AWX HTTP 503. Uzaktaki k6 / kaydedici sürüyor olabilir; Durdur'u yeniden deneyin. Kilitler koşunun süre sınırına kadar tutulur.";
  async function durdurOnayla(dugmeAdi = 'Durdur') {
    fireEvent.click(await screen.findByRole('button', { name: dugmeAdi }));
    const pencere = await screen.findByRole('dialog');
    fireEvent.click(within(pencere).getByRole('button', { name: dugmeAdi }));
    return pencere;
  }

  it('YT7 koşu: 424 durdur_baslatilamadi kalıcı hata kutusu (sunucu mesajı); 200 ama durdur işi yoksa da başarı denmez', async () => {
    api.durdur.mockResolvedValueOnce({ ok: false, code: 'durdur_baslatilamadi', message: MESAJ_424, iptal: { canceled: true }, iptalHatasi: null, durdurHatasi: 'AWX HTTP 503', _httpStatus: 424 });
    render(<KosuAyrinti kosuId={17} isAdmin onGeri={vi.fn()} />);
    await durdurOnayla();
    await waitFor(() => expect(api.durdur).toHaveBeenCalledWith(17));
    const kutu = (await screen.findByText(MESAJ_424)).closest('[role="alert"]');
    expect(kutu).toBeTruthy();
    expect(within(kutu as HTMLElement).getByText(/Durdurma işi başlatılamadı/)).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(toast.success).not.toHaveBeenCalled();
    // Kalici: yeniden okuma (yukle) kutuyu silmez; yalniz "Kapat" ya da basarili durdurma.
    await waitFor(() => expect(api.kosu.mock.calls.length).toBeGreaterThanOrEqual(2));
    expect(screen.getByText(MESAJ_424)).toBeTruthy();
    fireEvent.click(within(kutu as HTMLElement).getByRole('button', { name: 'Kapat' }));
    expect(screen.queryByText(MESAJ_424)).toBeNull();
    // Eski sunucu: 200 ama kosunun durdur isi yok -> yine kalici hata, basari yok.
    api.durdur.mockResolvedValueOnce({ ok: true, iptal: { canceled: true }, iptalHatasi: null, durdurIsi: null, durdurHatasi: 'AWX işi başlatılamadı: AWX HTTP 500' });
    await durdurOnayla();
    expect(await screen.findByText(/^AWX işi iptal edildi, ancak durdurma işi başlatılamadı: AWX işi başlatılamadı: AWX HTTP 500\./)).toBeTruthy();
    expect(toast.success).not.toHaveBeenCalled();
    // Yeniden deneme basarili: kalici kutu kalkar, basari bildirimi gelir.
    api.durdur.mockResolvedValueOnce({ ok: true, iptal: { alreadyTerminal: true }, iptalHatasi: null, durdurIsi: { jobId: 915, awxServerId: 1 }, durdurHatasi: null });
    await durdurOnayla();
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Durdurma işi AWX #915 başlatıldı; k6 ve kaydedici durdurulduğunda kilitler bırakılır.'));
    expect(screen.queryByText(/durdurma işi başlatılamadı/)).toBeNull();
    // AWX iptali olmadi ama durdur isi basladi: sunucu kilidi kosu isinde birakir; basari denmez, uyari verilir.
    toast.success.mockReset();
    api.durdur.mockResolvedValueOnce({ ok: true, iptal: null, iptalHatasi: 'AWX HTTP 403', durdurIsi: { jobId: 916, awxServerId: 1 }, durdurHatasi: null });
    await durdurOnayla();
    await waitFor(() => expect(toast.warning).toHaveBeenCalledWith('Durdurma işi AWX #916 başlatıldı, ancak koşunun AWX işi iptal edilemedi: AWX HTTP 403. Kilitler koşu işi bitince bırakılır.'));
    expect(toast.success).not.toHaveBeenCalled();
  });

  it('YT8 koşu: 409 baslatiliyor bilgi bildirimi; başarıda "Durdurma işi AWX #N başlatıldı"', async () => {
    api.durdur
      .mockResolvedValueOnce({ ok: false, code: 'baslatiliyor', message: 'Koşu başlatılıyor; birkaç saniye sonra yeniden deneyin.', _httpStatus: 409 })
      .mockResolvedValueOnce({ ok: true, iptal: { canceled: true }, iptalHatasi: null, durdurIsi: { jobId: 913, awxServerId: 1 }, durdurHatasi: null });
    render(<KosuAyrinti kosuId={17} isAdmin onGeri={vi.fn()} />);
    const pencere = await durdurOnayla();
    expect(within(pencere).getByText(/k6 ve CPU kaydedicisini sonlandırır/)).toBeTruthy();
    await waitFor(() => expect(toast.info).toHaveBeenCalledWith('Koşu başlatılıyor; birkaç saniye sonra yeniden deneyin.'));
    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
    expect(screen.queryByRole('alert')).toBeNull();
    await durdurOnayla();
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Durdurma işi AWX #913 başlatıldı; k6 ve kaydedici durdurulduğunda kilitler bırakılır.'));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('YT9 ön kontrol: pencere ve bildirim yalnız AWX iptalini söyler (k6 / kaydedici yok)', async () => {
    kosuYukle({ id: 16, islem: 'on_kontrol', durum: 'RUNNING' });
    api.durdur.mockResolvedValue({ ok: true, iptal: { canceled: true }, iptalHatasi: null, durdurIsi: null, durdurHatasi: null });
    render(<KosuAyrinti kosuId={16} isAdmin onGeri={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Durdur' }));
    const pencere = await screen.findByRole('dialog');
    expect(within(pencere).getByRole('heading', { name: 'Ön kontrol #16 durdurulsun mu?' })).toBeTruthy();
    expect(pencere.textContent).not.toMatch(/k6|kaydedici/i);
    expect(pencere.textContent).toMatch(/AWX işi iptal edilir/);
    fireEvent.click(within(pencere).getByRole('button', { name: 'Durdur' }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('AWX işi iptal ediliyor.'));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('YT10 iptal edilmiş koşuda Admin "Kalan süreçleri durdur" (aynı uç); başlıkta "Durdurma işi AWX #N"', async () => {
    kosuYukle({ durum: 'CANCELED', finishedAt: '2026-10-27T08:20:00Z', durdurIsi: { awxServerId: 1, awxJobId: 912 } });
    api.durdur.mockResolvedValue({ ok: true, iptal: { canceled: false, alreadyTerminal: true }, iptalHatasi: null, durdurIsi: { jobId: 914, awxServerId: 1 }, durdurHatasi: null });
    const { unmount } = render(<KosuAyrinti kosuId={17} isAdmin onGeri={vi.fn()} />);
    expect(await screen.findByText('Durdurma işi AWX #912')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Kalan süreçleri durdur' }));
    const pencere = await screen.findByRole('dialog');
    expect(within(pencere).getByRole('heading', { name: 'Koşu #17: kalan süreçler durdurulsun mu?' })).toBeTruthy();
    fireEvent.click(within(pencere).getByRole('button', { name: 'Kalan süreçleri durdur' }));
    await waitFor(() => expect(api.durdur).toHaveBeenCalledWith(17));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Durdurma işi AWX #914 başlatıldı; k6 ve kaydedici durdurulduğunda kilitler bırakılır.'));
    unmount();
    // Admin olmayan: bilgi var, dugme yok. FAILED kosu ve iptal edilmis on kontrol: dugme yok.
    const r1 = render(<KosuAyrinti kosuId={17} isAdmin={false} onGeri={vi.fn()} />);
    expect(await screen.findByText('Durdurma işi AWX #912')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /durdur/i })).toBeNull();
    r1.unmount();
    for (const o of [{ durum: 'FAILED' as const }, { islem: 'on_kontrol' as const, durum: 'CANCELED' as const }]) {
      kosuYukle({ ...o, finishedAt: '2026-10-27T08:20:00Z' });
      const r = render(<KosuAyrinti kosuId={17} isAdmin onGeri={vi.fn()} />);
      expect(await screen.findByRole('heading', { name: /#17/ })).toBeTruthy();
      expect(screen.queryByRole('button', { name: /durdur/i })).toBeNull();
      r.unmount();
    }
  });
});

describe('Yük Testi — koşu ayrıntısı (2026-10-27)', () => {
  it('YT11 koşunun "Ön kontrol" sekmesi ön kontrolü kendi durumuyla gösterir: "Onaylanan uyarılar", çağrı yok', async () => {
    kosuYukle({
      durum: 'FAILED', finishedAt: '2026-10-27T08:30:00Z', isDurumu: 'FAIL', isHatasi: 'kos.sh rc 1', onKontrolKosuId: 16,
      onKontrol: onKontrolNormalle(ON_KONTROL_UYARILI), sunucuDegerlendirmesi: { engeller: [], uyarilar: ['4 / 264 yol 200 dönmedi'] },
    });
    const { unmount } = render(<KosuAyrinti kosuId={17} isAdmin={false} onGeri={vi.fn()} />);
    fireEvent.click(await screen.findByRole('tab', { name: 'Ön kontrol' }));
    expect(screen.getByText('Onaylanan uyarılar')).toBeTruthy();
    expect(screen.getByText('4 / 264 yol 200 dönmedi')).toBeTruthy();
    const panel = screen.getByRole('tabpanel');
    expect(panel.textContent).not.toMatch(/Koşu başlatılamaz|başlatılabilir|Ön kontrol başarısız|açıkça onaylamanız/);
    unmount();
    // Bugunku kurallarla engel sayilan bulgu (kosu o gun baslamisti): baslik "Ön kontrol engelleri", "başlatılamaz" degil.
    kosuYukle({ durum: 'DONE', finishedAt: '2026-10-27T08:30:00Z', onKontrol: onKontrolNormalle(ON_KONTROL_UYARILI), sunucuDegerlendirmesi: { engeller: ['log dizini /web_log okunamıyor'], uyarilar: [] } });
    const r2 = render(<KosuAyrinti kosuId={17} isAdmin={false} onGeri={vi.fn()} />);
    fireEvent.click(await screen.findByRole('tab', { name: 'Ön kontrol' }));
    expect(within(screen.getByText('Ön kontrol engelleri').parentElement?.parentElement as HTMLElement).getByText('Log dizini /web_log okunamıyor')).toBeTruthy();
    expect(screen.getByRole('tabpanel').textContent).not.toMatch(/Koşu başlatılamaz/);
    r2.unmount();
    // Suren kosu, temiz on kontrol: "temiz" der ama "başlatılabilir" demez.
    kosuYukle({ onKontrol: onKontrolNormalle({ ...ON_KONTROL_UYARILI, yollar_200: 264 }), sunucuDegerlendirmesi: { engeller: [], uyarilar: [] } });
    render(<KosuAyrinti kosuId={17} isAdmin={false} onGeri={vi.fn()} />);
    fireEvent.click(await screen.findByRole('tab', { name: 'Ön kontrol' }));
    expect(screen.getByText('Ön kontrol temiz — engel ya da uyarı yoktu.')).toBeTruthy();
    expect(screen.getByRole('tabpanel').textContent).not.toMatch(/başlatılabilir/);
  });

  it('YT12 başarısız ön kontrolün asıl nedeni engelde; okunamayan log dizini "kaldı"', () => {
    render(<OnKontrolPaneli kosu={{ durum: 'FAILED', onKontrol: onKontrolNormalle({ ...ON_KONTROL_UYARILI, log_dizini_okunur: false }), isDurumu: 'FAIL', isHatasi: 'log dizini /web_log okunamiyor', sunucuDegerlendirmesi: null }} />);
    const engel = screen.getByText('Koşu başlatılamaz').closest('[role="alert"]') as HTMLElement;
    expect(within(engel).getByText('Ön kontrol başarısız: log dizini /web_log okunamiyor')).toBeTruthy();
    const satir = screen.getByText('Log dizini okunur').closest('li') as HTMLElement;
    expect(satir.textContent).toMatch(/kaldı$/);
  });

  it('YT14 adım tablosu: etiket ve sıra tekrar’la; uyarı çipi + ayrıntıda liste; pencere istemciden ise sunucu rps "—"', async () => {
    const adim = (o: Record<string, unknown>) => adimNormalle({ senaryo: 'K', kip: 'yeni', ae: 'br', gecerlilik: 'GECERLI', gercek_rps: 100, rps_sunucu: 98, p95: 10, ...o });
    kosuYukle({ durum: 'DONE', gecerlilik: 'GECERLI', finishedAt: '2026-10-27T08:40:00Z' }, [
      adim({ tur: 'R17_K_yeni_br_100_r2', hiz: 100, deneme: 1, rps_sunucu: 100, ham: { uyarilar: ['diger_trafik_%50'], pencere_kaynak: 'istemci_saati' } }),
      adim({ tur: 'R17_K_yeni_br_100_r1', hiz: 100, deneme: 2, ham: { pencere_kaynak: 'log', uyarilar: [] } }),
    ]);
    render(<KosuAyrinti kosuId={17} isAdmin={false} onGeri={vi.fn()} />);
    const tablo = await screen.findByRole('table', { name: 'Adım sonuçları' });
    const [, s1, s2] = within(tablo).getAllByRole('row');
    expect(within(s1).getByTitle('R17_K_yeni_br_100_r1').textContent).toBe('r1 · deneme 2');
    expect(within(s2).getByTitle('R17_K_yeni_br_100_r2').textContent).toBe('r2');
    expect(s1.textContent).toContain('100 / 98');
    expect(within(s1).queryByTitle(/pencere istemci saatinden/)).toBeNull();
    expect(within(s2).getByTitle('sunucu logunda bu adımın satırı yok; pencere istemci saatinden').textContent).toBe('—');
    expect(within(s2).getByTitle('diger_trafik_%50').textContent).toBe('1 uyarı');
    expect(within(s1).queryByText(/uyarı$/)).toBeNull();
    fireEvent.click(within(s2).getByRole('button', { name: 'R17_K_yeni_br_100_r2 ayrıntısı' }));
    expect(within(screen.getByRole('list', { name: 'R17_K_yeni_br_100_r2 uyarıları' })).getByText('diger_trafik_%50')).toBeTruthy();
    // Grafik ipuclari tekrar'la (deneme 1 yazilmaz).
    const ipuclari = [...document.querySelectorAll('svg title')].map((t) => t.textContent || '');
    expect(ipuclari.some((t) => t.startsWith('100/sn · r1 · deneme 2:'))).toBe(true);
    expect(ipuclari.some((t) => t.startsWith('100/sn · r2:'))).toBe(true);
    expect(ipuclari.some((t) => /deneme 1\b/.test(t))).toBe(false);
  });

  it('YT15 OKUNAMADI: doğru metin (otomatik yeniden okuma yok); Admin "Sonucu yeniden oku" -> POST yeniden-oku', async () => {
    kosuYukle({ durum: 'OKUNAMADI', gecerlilik: 'OKUNAMADI', finishedAt: '2026-10-27T08:40:00Z', gecersizNedenleri: ['sonuç 3 denemede okunamadı (Portal süreci okuma sırasında yeniden başlamış olabilir)'],
      analiz: { nproc: null, cpuTlsliPay: null, uyarilar: [], okumaHatasi: 'kosu dizini okunamadi: /sw/BMW_PORTAL/nginx_loadtest/17 (ENOENT)' } });
    api.yenidenOku
      .mockResolvedValueOnce({ ok: false, code: 'yeniden_okunamaz', message: 'Yalnız sonucu okunamamış koşular yeniden okunabilir.', _httpStatus: 409 })
      .mockResolvedValueOnce({ ok: true });
    const { unmount } = render(<KosuAyrinti kosuId={17} isAdmin onGeri={vi.fn()} />);
    expect(await screen.findByText(OKUNAMADI_ACIKLAMASI)).toBeTruthy();
    expect(screen.getAllByText(OKUNAMADI_ACIKLAMASI)).toHaveLength(1);
    expect(screen.getByText(/sonuç 3 denemede okunamadı/)).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/yeniden okumayı dener|okumayı yeniden dener/);
    const dugme = screen.getByRole('button', { name: 'Sonucu yeniden oku' });
    fireEvent.click(dugme);
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Yalnız sonucu okunamamış koşular yeniden okunabilir.'));
    const once = api.kosu.mock.calls.length;
    fireEvent.click(dugme);
    await waitFor(() => expect(toast.success).toHaveBeenCalledTimes(1));
    expect(api.yenidenOku).toHaveBeenNthCalledWith(2, 17);
    await waitFor(() => expect(api.kosu.mock.calls.length).toBeGreaterThan(once));
    unmount();
    render(<KosuAyrinti kosuId={17} isAdmin={false} onGeri={vi.fn()} />);
    expect(await screen.findByText(OKUNAMADI_ACIKLAMASI)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Sonucu yeniden oku' })).toBeNull();
  });

  it('YT16 FINALIZING: "Sonuç okunuyor (deneme N/3)"', async () => {
    kosuYukle({ durum: 'FINALIZING', sonuclandirmaDenemesi: 2 });
    render(<KosuAyrinti kosuId={17} isAdmin={false} onGeri={vi.fn()} />);
    expect(await screen.findByText('Sonuç okunuyor (deneme 2/3)')).toBeTruthy();
    expect(screen.getByText('deneme 2/3')).toBeTruthy();
  });
});

describe('Yük Testi — senaryo (2026-10-27)', () => {
  it('YT19 HAR özetinde ";" parametresi atılan yol sayacı; gönderilen satırda ve özette oturum kimliği yok', async () => {
    const H = 'https://glomo-test.fw.garantibbva.com.tr';
    const g = (url: string, mime = 'application/javascript') => ({ startedDateTime: '2026-10-26T10:00:00Z', request: { method: 'GET', url }, response: { status: 200, content: { size: 100, mimeType: mime } } });
    const HAR = JSON.stringify({ log: { entries: [g(`${H}/glomo/a;jsessionid=8F3A2B9C/b.js`), g(`${H}/glomo/a/b.js`), g(`${H}/glomo/login.jsf;jsessionid=8F3A2B9C`, 'text/html')] } });
    api.senaryoKaydet.mockResolvedValue({ ok: true, id: 9 });
    render(<Senaryolar isAdmin />);
    fireEvent.click(await screen.findByRole('button', { name: /Yeni senaryo/ }));
    fireEvent.change(screen.getByLabelText('Vhost (HAR’daki host)'), { target: { value: 'glomo-test.fw.garantibbva.com.tr' } });
    fireEvent.change(screen.getByLabelText('HAR dosyası seç'), { target: { files: [new File([HAR], 'oturum.har', { type: 'application/json' })] } });
    const sayac = await screen.findByText('“;” parametresi atılan yol');
    expect(sayac.textContent).toBe('“;” parametresi atılan yol 2');
    expect(screen.getByText(/“;” parametresi atılan 2/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText(/^Ad$/), { target: { value: 'oturumlu' } });
    fireEvent.click(screen.getByRole('button', { name: 'Senaryoyu kaydet' }));
    await waitFor(() => expect(api.senaryoKaydet).toHaveBeenCalledTimes(1));
    const govde = api.senaryoKaydet.mock.calls[0][0];
    expect(govde.satirlar.map((s: { yol: string; agirlik: number }) => [s.agirlik, s.yol])).toEqual([[2, '/glomo/a/b.js'], [1, '/glomo/login.jsf']]);
    expect(JSON.stringify(govde).toLowerCase()).not.toContain('jsessionid');
    expect(govde.ozet.harlar[0].parametresiAtilan).toBe(2);
  });
});

describe('Yük Testi — liste ve karşılaştırma (2026-10-27)', () => {
  const K = (id: number) => ({ ...KOSU_LISTE, id, durum: 'DONE', gecerlilik: 'GECERLI', etiket: `koşu ${id}`, finishedAt: '2026-10-27T09:00:00Z' });

  it('YT17 Karşılaştır seçicisi sunucudan islem=kosu, durum=DONE, limit=200 ister', async () => {
    api.kosular.mockResolvedValue({ ok: true, kosular: [K(30), K(29)], dahaVar: false });
    render(<Karsilastir />);
    await waitFor(() => expect(api.kosular).toHaveBeenCalledWith({ islem: 'kosu', durum: 'DONE', limit: 200 }));
    expect(await within(screen.getByLabelText('Referans koşu')).findByRole('option', { name: /#29/ })).toBeTruthy();
  });

  it('YT18 Koşular: dahaVar ise "Daha eski koşular" onceki=<en küçük id> ekler; tazeleme eski sayfayı silmez', async () => {
    api.kosular
      .mockResolvedValueOnce({ ok: true, kosular: [K(30), K(29)], dahaVar: true })
      .mockResolvedValueOnce({ ok: true, kosular: [K(28)], dahaVar: false })
      .mockResolvedValueOnce({ ok: true, kosular: [K(31), K(30)], dahaVar: true });
    render(<KosuListesi onAc={vi.fn()} />);
    expect(await screen.findByRole('button', { name: 'Koşu 29 ayrıntısı' })).toBeTruthy();
    expect(api.kosular).toHaveBeenNthCalledWith(1, { limit: 200 });
    expect(screen.getByText('2 kayıt yüklendi')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Daha eski koşular/ }));
    expect(await screen.findByRole('button', { name: 'Koşu 28 ayrıntısı' })).toBeTruthy();
    expect(api.kosular).toHaveBeenNthCalledWith(2, { limit: 200, onceki: 29 });
    expect(screen.queryByRole('button', { name: /Daha eski koşular/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Yenile/ }));
    expect(await screen.findByRole('button', { name: 'Koşu 31 ayrıntısı' })).toBeTruthy();
    expect(api.kosular).toHaveBeenNthCalledWith(3, { limit: 200 });
    expect(screen.getByRole('button', { name: 'Koşu 28 ayrıntısı' })).toBeTruthy();
    expect(screen.getAllByRole('button', { name: /^Koşu \d+ ayrıntısı$/ }).map((b) => b.getAttribute('aria-label'))).toEqual(
      ['Koşu 31 ayrıntısı', 'Koşu 30 ayrıntısı', 'Koşu 29 ayrıntısı', 'Koşu 28 ayrıntısı']);
    // En eski sayfa "daha yok" dedi: tazeleme dugmeyi geri getirmez.
    expect(screen.queryByRole('button', { name: /Daha eski koşular/ })).toBeNull();
  });
});
