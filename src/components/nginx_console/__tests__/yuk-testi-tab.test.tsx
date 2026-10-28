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
// YT13 (D7 ile degisti, 2026-10-28) Taranmis ama adlandirilmis server_name'i olmayan hedef: Host basligi alani ACIK,
//      yazilan ad not ile, on kontrol ACIK; dokum hic yoksa "elle yazın" yardimi ve not yok.
// YT14 Adim tablosu: etiket tekrar'dan (r2; deneme > 1 ise eklenir), sira ve grafik etiketi tekrar'la; uyari cipi ve
//      ayrintida liste; pencere istemci saatinden ise sunucu rps "—".
// YT15 OKUNAMADI: dogru metin (otomatik yeniden okuma vaadi yok), Admin "Sonucu yeniden oku" -> POST yeniden-oku.
// YT16 FINALIZING: "Sonuç okunuyor (deneme N/3)".
// YT17 Karşılaştır secicisi sunucudan islem=kosu, durum=DONE, limit=200 ister.
// YT18 Koşular: dahaVar ise "Daha eski koşular" onceki=<en kucuk id> ile ekler; tazeleme eski sayfayi silmez.
// YT19 HAR ozetinde ";" parametresi atilan yol sayaci; kaydedilen satirlarda ve ozette oturum kimligi yok.
// Tur 3 (2026-10-28: elle hedef IP - sunucu | serbest -, wrk, D7 serbest Host basligi):
// YT20 Serbest akis: siniflandirma serbest -> serbest vhost / varsayilanlar -> govdede hedefHost null (once secilen host
//      gonderilmez) -> onay IP ister (host adi kabul edilmez), "İzinli ağ" satiri.
// YT21 Host secici: hedefHost /ip-sinifi sorgusunda ve on kontrol govdesinde, IP adaylardan; paylasilan VIP hedefHost'la
//      200 sunucu (dugme acik), ayni IP elle yazilinca 409 ip_belirsiz (dugme kapali); 200 uygun:false dugmeyi kapatir
//      (sinir_asildi, ip_hedefte_yok, hedef kapisi kodu; neden yoksa kodun metni).
// YT22 wrk: SNI kapali ve false, alanlar degisir, tavan satiri; govdede motor wrk + baglantilar (hizlar yok); onayda wrk
//      yuk satiri ve tahmini sure.
// YT23 Siniflandirma retleri (ip_belirsiz, ip_sahibi_cozulemedi, serbest_kapali, hedef_uretim) ve on kontrol host_uretim:
//      mesaj gorunur, dugme kapali (host_uretim'de ayni girdiyle); ret govdesindeki `sahipler` NESNELERI "[object Object]"
//      olarak cizilmez.
// YT24 Kosu ayrintisi wrk + serbest: cipler, baglanti birimi, CPU "—" (etikette CPU kademesi yok), p95 alt metni; serbest
//      adimda (pencere_kaynak '-') hicbir ipucu sunucu logundan soz etmez; yeni analiz uyarilari ve 429(istemci=N) /
//      wrk_rc= nedenleri ham; durdur yalniz yuk sunucusunu soyler.
// YT25 Karşılaştır: farkli motor uyarisi; iki serbest kosu farkli IP -> farkli hedef uyarisi; is parcacigi uyarisi; wrk birimi;
//      serbest ya da CPU'suz karar yolunda (analiz "CPU olculmedi (...)") baslikta "CPU kademesi" yazilmaz.
// YT29 (entegrasyon) GET /kosular/:id onKontrolUyarilari plan uyarilarini zaten basta tasir: panelde ve onayda tek kez.
// YT26 (D7) Listede olmayan Host basligi yazilabilir: not gorunur, dugme acik; listeden ad notu kaldirir.
// YT27 Koşular: serbest satir IP etiketiyle ve ciplerle; hedef suzgecinde null / bos secenek yok.
// YT28 On kontrol paneli: D7 server_name satiri "uyarı" (kaldı degil); wrk satiri uc durumlu; serbestte yuk sunucusu satirlari.
// Tur 3 incelemesi (2026-10-28):
// YT22 (WR2) wrk tavani ORTALAMA hizi sinirlar: tavan satiri "Ortalama toplam hız tavanı", uyari kutusu kumelenme / burst /
//      429 -> DUR ve "k6 kullanın" der; "tavanını aşamaz" hicbir yerde yok.
// YT23 (UI4) alan hatasi girdinin erisilebilir aciklamasi (hata > yardim).
// YT25 (UI3) Karşılaştır secicisi gecerliligi Turkce etiketle yazar (kısmen geçerli / geçersiz / okunamadı; ham kod degil).
// YT26 (UI4) D7 notu Host basligi girdisinin erisilebilir aciklamasi (not > yardim); datalist'e baglanmaz.
// YT30 (UI1) hic yol denenmemis on kontrol (izin reddi / IP yuk sunucusunda yerel / IP hedefte yerel degil: 0 / 0):
//      yollar satiri "hiçbir yol denenmedi · kaldı" (geçti DEGIL), izin satiri "kaldı", olculmemis sikistirma bilgisi yok.
//      Fikstur gercek Templar (Play 8) + sunucu degerlendirmesi (dogrula.onKontrolDegerlendir) ciktisindan.
// YT31 (UI2) yeniden siniflandirma surerken on kontrol dugmesi kapali, "IP sınıflandırılıyor…", eski sinif kutusu yok.
// YT32 (UI2) sira disi /ip-sinifi yaniti: bayat A yaniti yeni B sonucunu ezmez, ekran "sınıflandırılıyor"da takilmaz.
// YT33 (SA2) Karşılaştır: iki wrk kosusunun hiz tavani (tavan_rps) farkliysa uyari; ayni tavanda yok.
// Dogrulama turu (2026-10-28):
// YT30d (UV1) izin bloguna HIC gelinmemis serbest on kontrol (gercek erisilemezlik yolu, dzdo, kopya kapisi): serbest_ag
//      null ama izin satiri "ölçülemedi" (kaldı DEGIL); "kaldı" yalniz Play 3 ret metniyle (YT30a).
// YT3  (UV3) onay girdisinin erisilebilir aciklamasi ipucu ("Yapıştırma kapalı"); yanlis yazimda uyusmazlik metni de;
//      dogru yazimda aria-describedby gorunmeyen id gostermez.
// YT24 (UV4) KosuAyrinti "Bağlantılar" ve "Bağlantı" kolon ipuclari "ortalama toplam" der; YT22 (UV4) SNI notu tam opak.
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
  sinirlar: {
    maxHiz: 450, maxTekrar: 3, sureMin: 40, sureMax: 300, isinmaMax: 60, maxVu: 199, maxButceSn: 2700,
    baglantiMin: 1, maxBaglanti: 199, maxBaglantiSayisi: 5, isParcacigiMin: 1, maxIsParcacigi: 16, serbestTavanRps: 200, serbestMaxBaglanti: 50,
  },
  varsayilan: { motor: 'k6', ...PARAM, baglantilar: [2, 4, 8], is_parcacigi: 2, serbest: { hizlar: [50, 100, 200], maxvu: 50 } },
  serbest: { acik: true, aglar: ['10.20.30.0/24'] },
  motorlar: ['k6', 'wrk'],
};
/** /ip-sinifi yanitlari (istemcinin normallestirdigi sekil). */
const SUNUCU_SINIFI = (host: string, ip: string, o: Record<string, unknown> = {}) => ({
  ok: true, tur: 'sunucu', ip, host, env: 'TEST', vhostlar: ['glomo-test.fw.garantibbva.com.tr'], vhostVerisi: true, hizSiniri: null, vuSiniri: null,
  uygun: true, neden: null, kod: null, kaynaklar: ['dbo.nginx_inventory'], ...o,
});
const SERBEST_SINIFI = (ip: string, ag = '10.20.30.0/24') => ({ ok: true, tur: 'serbest', ip, host: null, ag, digerSahipler: [] });
/** Varsayilan siniflandirici: /hedefler adaylari sunucu, 10.20.30.0/24 serbest, digeri izinli ag disi (409). */
function varsayilanSinif(ip: string) {
  const h = HEDEFLER.hedefler.find((x) => x.ipler.includes(ip));
  if (h) return SUNUCU_SINIFI(h.host, ip, { env: h.env, vhostlar: h.vhostlar, vhostVerisi: h.vhostVerisi, uygun: h.uygun, neden: h.neden });
  if (ip.startsWith('10.20.30.')) return SERBEST_SINIFI(ip);
  return { ok: false, code: 'ip_izinli_agda_degil', message: `${ip} envanterdeki bir nginx sunucusuna ait değil ve izinli ağların (10.20.30.0/24) dışında.`, _httpStatus: 409 };
}
/** /ip-sinifi istegi 400 ms gecikmeli: bekleme siniri ondan genis. */
const SINIF_BEKLE = { timeout: 3000 };
const bekle = (ms: number) => new Promise((r) => setTimeout(r, ms));

const api = vi.hoisted(() => ({
  hedefler: vi.fn(), senaryolar: vi.fn(), senaryo: vi.fn(), senaryoKaydet: vi.fn(), senaryoSil: vi.fn(), onKontrol: vi.fn(),
  baslat: vi.fn(), kosular: vi.fn(), kosu: vi.fn(), durum: vi.fn(), durdur: vi.fn(), yenidenOku: vi.fn(), karsilastir: vi.fn(), ipSinifi: vi.fn(),
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
import {
  OKUNAMADI_ACIKLAMASI, SERBEST_CIP_IPUCU, SERBEST_UYARISI, SERBEST_VHOST_YARDIMI, SINIR_SIFIR_METNI, VHOST_LISTEDE_YOK_NOTU, WRK_CIP_IPUCU, WRK_UYARISI,
  onKontrolDegerlendir,
} from '../yukTesti/yukTestiOrtak';
import { adimNormalle, kosuNormalle, onKontrolNormalle } from '@/api/nginxLoadtestApi';

function ayrinti(o: Partial<NlKosuAyrinti> = {}): NlKosuAyrinti {
  return {
    ...(KOSU_LISTE as unknown as NlKosuAyrinti), hedefTuru: 'sunucu', motor: 'k6', serbestAg: null, planUyarilari: [],
    parametreler: { motor: 'k6', ...PARAM } as NlKosuAyrinti['parametreler'], onKontrol: null,
    gecersizNedenleri: [], sonucOzet: null, onKontrolKosuId: null, sunucuDegerlendirmesi: null, onKontrolYasSn: null, isDurumu: null, isHatasi: null,
    analiz: { nproc: null, cpuTlsliPay: null, uyarilar: [], okumaHatasi: null }, durdurIsi: null, sonuclandirmaDenemesi: 0, ...o,
  };
}
const kosuYukle = (o: Partial<NlKosuAyrinti> = {}, adimlar: unknown[] = []) => api.kosu.mockResolvedValue({ ok: true, kosu: ayrinti(o), adimlar });
/** Yeni koşu sekmesi + senaryo 3 secili (vhost oneri: senaryonun vhost'u). */
async function yeniKosuAc() {
  render(<YukTestiTab isAdmin />);
  fireEvent.click(await screen.findByRole('tab', { name: /Yeni koşu/ }));
  fireEvent.change(await screen.findByLabelText('Senaryo'), { target: { value: '3' } });
}
const hostSecici = () => screen.getByLabelText('Hedef sunucu (isteğe bağlı)');
const okDugmesi = () => screen.getByRole('button', { name: /Ön kontrolü (başlat|yeniden çalıştır)/ });

beforeEach(() => {
  for (const f of Object.values(api)) f.mockReset();
  for (const f of Object.values(toast)) f.mockReset();
  api.kosular.mockResolvedValue({ ok: true, kosular: [KOSU_LISTE], dahaVar: false });
  api.kosu.mockResolvedValue({ ok: true, kosu: ayrinti(), adimlar: [] });
  api.senaryolar.mockResolvedValue({ ok: true, senaryolar: [SENARYO] });
  api.hedefler.mockResolvedValue(HEDEFLER);
  api.durum.mockResolvedValue({ ok: true, status: 'running', finished: false, output: 'PLAY [x]\n', result: null, kosuDurum: 'RUNNING' });
  api.ipSinifi.mockImplementation(async (ip: string) => varsayilanSinif(ip));
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
    // UV3: yapistirma sessizce engellenmez; ipucu girdinin erisilebilir aciklamasi, yanlis yazimda uyusmazlik metni de.
    expect(girdi).toHaveAccessibleDescription(/Yapıştırma kapalı/);
    fireEvent.change(girdi, { target: { value: 'gbngxt10' } });
    expect(dugme).toBeDisabled();
    expect(girdi).toHaveAccessibleDescription(/hedefle aynı değil/);
    expect(girdi).toHaveAccessibleDescription(/Yapıştırma kapalı/);
    fireEvent.change(girdi, { target: { value: 'GBNGXT10 ' } });
    expect(dugme).toBeDisabled();
    const yapistir = createEvent.paste(girdi);
    fireEvent(girdi, yapistir);
    expect(yapistir.defaultPrevented).toBe(true);
    fireEvent.change(girdi, { target: { value: 'GBNGXT10' } });
    expect(dugme).toBeEnabled();
    // Dogru yazimda uyusmazlik metni cizilmez: aria-describedby gorunmeyen id gostermez.
    for (const id of (girdi.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean)) expect(document.getElementById(id)).not.toBeNull();
    expect(girdi).toHaveAccessibleDescription(/^Yapıştırma kapalı/);
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

    await yeniKosuAc();
    const hedefSecimi = hostSecici();
    expect(within(hedefSecimi).getByRole('option', { name: /GBNGXP40/ })).toBeDisabled();
    fireEvent.change(hedefSecimi, { target: { value: 'GBNGXT10' } });
    fireEvent.change(screen.getByLabelText('Hedef IP'), { target: { value: '10.1.2.4' } });
    const baslatDugmesi = screen.getByRole('button', { name: /Koşuyu başlat/ });
    expect(baslatDugmesi).toBeDisabled();
    // Siniflandirma (host secici yolu: hedefHost ile) bitince on kontrol acilir.
    await waitFor(() => expect(screen.getByRole('button', { name: /Ön kontrolü başlat/ })).toBeEnabled(), SINIF_BEKLE);
    fireEvent.click(screen.getByRole('button', { name: /Ön kontrolü başlat/ }));
    await waitFor(() => expect(api.onKontrol).toHaveBeenCalledTimes(1));
    expect(api.onKontrol.mock.calls[0][0]).toEqual({
      senaryoId: 3, hedefHost: 'GBNGXT10', hedefIp: '10.1.2.4', vhost: 'glomo-test.fw.garantibbva.com.tr', yukHost: 'GBNGXT34', sni: false, parametreler: { motor: 'k6', ...PARAM },
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
    await yeniKosuAc();
    fireEvent.change(hostSecici(), { target: { value: 'GBNGXT10' } });
    fireEvent.change(screen.getByLabelText('Hedef IP'), { target: { value: '10.1.2.3' } });
    await waitFor(() => expect(screen.getByRole('button', { name: /Ön kontrolü başlat/ })).toBeEnabled(), SINIF_BEKLE);
    fireEvent.click(screen.getByRole('button', { name: /Ön kontrolü başlat/ }));
    await waitFor(() => expect(screen.getByRole('button', { name: /Koşuyu başlat/ })).toBeEnabled());
    fireEvent.change(screen.getByLabelText('Tekrar'), { target: { value: '3' } });
    expect(screen.getByRole('button', { name: /Koşuyu başlat/ })).toBeDisabled();
    expect(screen.getByText(/Form ön kontrolden sonra değişti/)).toBeTruthy();
  });

  it('YT13 (D7) adlandırılmış server_name’i olmayan taranmış hedef: Host başlığı açık, yazılan ad notla, ön kontrol açık; döküm yoksa “elle yazın”', async () => {
    await yeniKosuAc();
    fireEvent.change(hostSecici(), { target: { value: 'GBNGXT20' } });
    // Tek aday IP otomatik; tur 2'nin "alan ve ön kontrol kapalı" kuralı D7 ile kalktı.
    expect(screen.getByLabelText('Hedef IP')).toHaveValue('10.2.2.2');
    const vhost = screen.getByLabelText('Host başlığı (vhost)');
    expect(vhost).toBeEnabled();
    expect(vhost).not.toHaveAttribute('list');
    // Bos listede senaryonun vhost'u da onerilmez (listede yok): elle yazilir, not cikar.
    fireEvent.change(vhost, { target: { value: 'glomo-test.fw.garantibbva.com.tr' } });
    expect(screen.getByText(VHOST_LISTEDE_YOK_NOTU)).toBeTruthy();
    await waitFor(() => expect(okDugmesi()).toBeEnabled(), SINIF_BEKLE);
    // Dokum hic yok (vhostVerisi false): "elle yazın" yardimi; liste bilinmedigi icin not YOK.
    fireEvent.change(hostSecici(), { target: { value: 'GBNGXT21' } });
    expect(screen.getByText('Bu hedef için server_name dökümü yok; adı elle yazın.')).toBeTruthy();
    expect(screen.queryByText(VHOST_LISTEDE_YOK_NOTU)).toBeNull();
    await waitFor(() => expect(okDugmesi()).toBeEnabled(), SINIF_BEKLE);
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
    // Sunucu hedefinde CPU kademesi etikette (serbestte yok: YT24).
    expect(screen.getByText('CPU-ms/istek @ 100/sn')).toBeTruthy();
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

// ── Tur 3: elle hedef IP (sunucu | serbest), wrk, D7 ─────────────────────────────────────
const SERBEST_ON_KONTROL = {
  ip_yerel: null, server_name_var: null, master_sayisi: null, web_log_df: null, log_dizini_okunur: null, log_format_ua: null, statik_direktif: null,
  ip_yuk_makinesinde: false, serbest_ag: '10.20.30.0/24', k6_var: true, k6_surum: 'k6 v0.49.0', k6_sha256: 'a'.repeat(64), yollar_toplam: 264, yollar_200: 264,
  ilk_hatalar: [], sikistirma: { statik: 0, dinamik: 200, sikistirmasiz: 64 },
};
/** Sunucunun kanonik wrk parametresi (tavan_rps sunucuda hesaplanir; hizlar / maxvu YOK). */
const WRK_P = { motor: 'wrk', baglantilar: [2, 4, 8], is_parcacigi: 2, tavan_rps: 450, tekrar: 2, isinma: 30, sure: 120, bosluk: 30, bosta: 60, kip: 'yeni', ae: 'br', sni: false, butceSn: 1380 };
const tamamOnKontrol = (o: Partial<NlKosuAyrinti> = {}) => ayrinti({ id: 16, islem: 'on_kontrol', durum: 'DONE', finishedAt: new Date().toISOString(), isDurumu: 'OK', ...o });

describe('Yük Testi — hedef IP ve sınıflandırma (2026-10-28)', () => {
  it('YT20 serbest: sınıflandırma serbest -> serbest vhost / varsayılanlar -> gövdede hedefHost null -> onay IP ister, İzinli ağ satırı', async () => {
    const okKayit = tamamOnKontrol({
      hedefTuru: 'serbest', hedefHost: null, hedefIp: '10.20.30.40', serbestAg: '10.20.30.0/24',
      parametreler: { motor: 'k6', hizlar: [50, 100, 200], maxvu: 50, tekrar: 2, isinma: 30, sure: 120, bosluk: 30, bosta: 60, kip: 'yeni', ae: 'br', sni: false },
      onKontrol: onKontrolNormalle(SERBEST_ON_KONTROL), sunucuDegerlendirmesi: { engeller: [], uyarilar: [SERBEST_UYARISI] },
    });
    api.onKontrol.mockResolvedValue({ ok: true, kosuId: 16, jobId: 900, awxServerId: 1 });
    api.kosu.mockImplementation(async (id: number) => ({ ok: true, kosu: id === 16 ? okKayit : ayrinti({ id: 18 }), adimlar: [] }));
    api.durum.mockResolvedValue({ ok: true, status: 'successful', finished: true, output: '', result: null, kosuDurum: 'DONE' });
    api.baslat.mockResolvedValue({ ok: true, kosuId: 18, jobId: 901, awxServerId: 1 });
    await yeniKosuAc();
    // Once bir host secilir, sonra "elle yazacağım"a donulur: eski host ne siniflandirmaya ne govdeye gider.
    fireEvent.change(hostSecici(), { target: { value: 'GBNGXT10' } });
    fireEvent.change(hostSecici(), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText('Hedef IP'), { target: { value: '10.20.30.40' } });
    expect(await screen.findByText('Serbest hedef (10.20.30.0/24 izinli ağında)', {}, SINIF_BEKLE)).toBeTruthy();
    expect(api.ipSinifi).toHaveBeenLastCalledWith('10.20.30.40', { yukHost: 'GBNGXT34', hedefHost: null });
    expect(screen.getByText(/^Envanterdeki bir nginx sunucusuna ait değil\. Hedefe bağlanılmaz \(SSH yok\)/)).toBeTruthy();
    expect(screen.getByText(SERBEST_VHOST_YARDIMI)).toBeTruthy();
    expect(screen.getByLabelText('Host başlığı (vhost)')).toHaveValue('glomo-test.fw.garantibbva.com.tr');
    // Serbest varsayilanlari (kullanici alani degistirmedi) ve sinirlari.
    expect(screen.getByLabelText('Hızlar (istek/sn)')).toHaveValue('50 100 200');
    expect(screen.getByLabelText('En çok VU')).toHaveValue(50);
    expect(screen.getByText(/Sınırlar: hız ≤ 200\/sn, VU ≤ 50/)).toBeTruthy();
    expect(screen.getByText('Serbest hedefte CPU kaydedici yok; bu süre beklenmez, yalnız süre bütçesine eklenir.')).toBeTruthy();
    await waitFor(() => expect(okDugmesi()).toBeEnabled());
    fireEvent.click(okDugmesi());
    await waitFor(() => expect(api.onKontrol).toHaveBeenCalledTimes(1));
    expect(api.onKontrol.mock.calls[0][0]).toEqual({
      senaryoId: 3, hedefHost: null, hedefIp: '10.20.30.40', vhost: 'glomo-test.fw.garantibbva.com.tr', yukHost: 'GBNGXT34', sni: false,
      parametreler: { motor: 'k6', hizlar: [50, 100, 200], maxvu: 50, tekrar: 2, isinma: 30, sure: 120, bosluk: 30, bosta: 60, kip: 'yeni', ae: 'br' },
    });
    // Serbest on kontrol paneli: yuk sunucusu satirlari ve bilgi.
    expect(await screen.findByText('IP yük sunucusunda yerel değil')).toBeTruthy();
    expect(screen.getByText('Yük sunucusu izin dosyası')).toBeTruthy();
    expect(screen.queryByText('IP hedefte yerel')).toBeNull();
    expect(screen.getByText(/Serbest hedef: hedef sunucu denetlenmedi \(SSH yok\); yalnız yük sunucusu ve yollar denetlendi\./)).toBeTruthy();
    await waitFor(() => expect(screen.getByRole('button', { name: /Koşuyu başlat/ })).toBeEnabled());
    expect(screen.getByText('Onay (hedef IP)')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Koşuyu başlat/ }));
    const pencere = await screen.findByRole('dialog');
    const girdi = within(pencere).getByLabelText(/Onaylamak için hedef IP’yi yazın/);
    const dugme = within(pencere).getByRole('button', { name: /Yük testini başlat/ });
    expect(within(pencere).getByText('Onay için hedef IP’yi yazın.')).toBeTruthy();
    expect(within(pencere).getByText('İzinli ağ')).toBeTruthy();
    expect(within(pencere).getByText('10.20.30.0/24 (Portal) · 10.20.30.0/24 (yük sunucusu)')).toBeTruthy();
    expect(within(pencere).getByText(/^Bu iş 10\.20\.30\.40 adresine gerçek trafik gönderir\. Hedef sunucuya bağlanılmaz/)).toBeTruthy();
    expect(within(pencere).getByText('Yapıştırma kapalı; IP birebir aynı olmalı.')).toBeTruthy();
    fireEvent.click(within(pencere).getByRole('checkbox', { name: /Uyarıları okudum/ }));
    // Host adi onay degildir (hedef sunucu yok).
    fireEvent.change(girdi, { target: { value: 'GBNGXT10' } });
    expect(dugme).toBeDisabled();
    expect(within(pencere).getByText('Yazılan IP hedefle aynı değil.')).toBeTruthy();
    const yapistir = createEvent.paste(girdi);
    fireEvent(girdi, yapistir);
    expect(yapistir.defaultPrevented).toBe(true);
    fireEvent.change(girdi, { target: { value: '10.20.30.40' } });
    expect(dugme).toBeEnabled();
    fireEvent.click(dugme);
    await waitFor(() => expect(api.baslat).toHaveBeenCalledWith({ onKontrolKosuId: 16, confirmText: '10.20.30.40', uyariOnay: true }));
    expect(within(pencere).getByRole('button', { name: 'İptal' })).toBeTruthy();
  });

  it('YT21 host seçici: hedefHost sorguda ve gövdede, IP adaylardan; paylaşılan VIP elle yazılınca ip_belirsiz; uygun:false düğmeyi kapatır', async () => {
    const BELIRSIZ = '10.1.2.4 birden çok nginx sunucusunda tanımlı (GBNGXT10, GBNGXT11); hedef sunucuyu listeden seçin.';
    api.ipSinifi.mockImplementation(async (ip: string, o: { hedefHost?: string | null } = {}) => {
      // 10.1.2.4 paylasilan VIP: host secici yolunda (hedefHost) sunucu, elle yazilinca belirsiz.
      if (ip === '10.1.2.4') return o.hedefHost === 'GBNGXT10' ? SUNUCU_SINIFI('GBNGXT10', ip) : { ok: false, code: 'ip_belirsiz', message: BELIRSIZ, _httpStatus: 409 };
      if (ip === '10.3.3.3') return SUNUCU_SINIFI('GBNGXT30', ip, { uygun: false, neden: SINIR_SIFIR_METNI, kod: 'sinir_asildi' });
      // Sunucunun diger uygun:false nedenleri (200): IP hostun aday listesinde degil; hedef kapisi (neden metni yoksa kod metni).
      if (ip === '10.3.3.4') return SUNUCU_SINIFI('GBNGXT30', ip, { uygun: false, neden: "10.3.3.4, GBNGXT30 için bilinen IP'lerden değil (10.3.3.9).", kod: 'ip_hedefte_yok' });
      if (ip === '10.3.3.5') return SUNUCU_SINIFI('GBNGXT31', ip, { uygun: false, neden: null, kod: 'hedef_uretim' });
      return varsayilanSinif(ip);
    });
    api.onKontrol.mockResolvedValue({ ok: true, kosuId: 16, jobId: 900, awxServerId: 1 });
    api.kosu.mockResolvedValue({ ok: true, kosu: tamamOnKontrol({ onKontrol: onKontrolNormalle({ ...ON_KONTROL_UYARILI, yollar_200: 264 }), sunucuDegerlendirmesi: { engeller: [], uyarilar: [] } }), adimlar: [] });
    api.durum.mockResolvedValue({ ok: true, status: 'successful', finished: true, output: '', result: null, kosuDurum: 'DONE' });
    await yeniKosuAc();
    fireEvent.change(hostSecici(), { target: { value: 'GBNGXT10' } });
    // Iki aday: IP otomatik secilmez; adaylardan biri tiklanir.
    expect(screen.getByLabelText('Hedef IP')).toHaveValue('');
    fireEvent.click(screen.getByRole('button', { name: '10.1.2.4' }));
    expect(screen.getByLabelText('Hedef IP')).toHaveValue('10.1.2.4');
    expect(await screen.findByText(/^Sunucu hedefi: GBNGXT10 \(TEST\) — CPU kaydedici ve nginx logu ölçülür/, {}, SINIF_BEKLE)).toBeTruthy();
    expect(api.ipSinifi).toHaveBeenLastCalledWith('10.1.2.4', { yukHost: 'GBNGXT34', hedefHost: 'GBNGXT10' });
    await waitFor(() => expect(okDugmesi()).toBeEnabled());
    fireEvent.click(okDugmesi());
    await waitFor(() => expect(api.onKontrol).toHaveBeenCalledTimes(1));
    expect(api.onKontrol.mock.calls[0][0]).toMatchObject({ hedefHost: 'GBNGXT10', hedefIp: '10.1.2.4' });
    await waitFor(() => expect(screen.getByRole('button', { name: /Koşuyu başlat/ })).toBeEnabled());
    // Ayni IP elle: hedefHost'suz siniflandirma -> 409 ip_belirsiz -> mesaj, on kontrol kapali.
    fireEvent.change(hostSecici(), { target: { value: '' } });
    expect(screen.getByLabelText('Hedef IP')).toHaveValue('10.1.2.4');
    expect(await screen.findByText(BELIRSIZ, {}, SINIF_BEKLE)).toBeTruthy();
    expect(api.ipSinifi).toHaveBeenLastCalledWith('10.1.2.4', { yukHost: 'GBNGXT34', hedefHost: null });
    expect(okDugmesi()).toBeDisabled();
    expect(screen.getByRole('button', { name: /Koşuyu başlat/ })).toBeDisabled();
    // 200 ama uygun:false (olculmus sifir sinir) -> neden gorunur, on kontrol kapali.
    fireEvent.change(screen.getByLabelText('Hedef IP'), { target: { value: '10.3.3.3' } });
    expect(await screen.findByText(SINIR_SIFIR_METNI, {}, SINIF_BEKLE)).toBeTruthy();
    expect(okDugmesi()).toBeDisabled();
    expect(screen.getByText('Hedef IP kullanılamaz — ayrıntı “Hedef ve yük sunucusu” bölümünde.')).toBeTruthy();
    for (const [ip2, metin] of [['10.3.3.4', "10.3.3.4, GBNGXT30 için bilinen IP'lerden değil (10.3.3.9)."], ['10.3.3.5', 'üretim (PROD) sinyali var — yük testi yapılamaz']]) {
      fireEvent.change(screen.getByLabelText('Hedef IP'), { target: { value: ip2 } });
      expect(await screen.findByText(metin, {}, SINIF_BEKLE)).toBeTruthy();
      expect(screen.getByText(metin).closest('[role="alert"]')).toBeTruthy();
      expect(okDugmesi()).toBeDisabled();
    }
    // 424: "Yeniden dene" ve dugme ACIK (karar sunucuda).
    api.ipSinifi.mockImplementation(async () => ({ ok: false, code: 'envanter_bayat', message: 'Serbest hedef için envanter bayat: dbo.IPInventory son yükleme 2026-10-25 08:00:00 (72 saat önce, en çok 48); yükleyici / tarama işlerini kontrol edin.', _httpStatus: 424 }));
    fireEvent.change(screen.getByLabelText('Hedef IP'), { target: { value: '10.20.30.40' } });
    expect(await screen.findByText(/envanter bayat/, {}, SINIF_BEKLE)).toBeTruthy();
    expect(okDugmesi()).toBeEnabled();
    const once = api.ipSinifi.mock.calls.length;
    fireEvent.click(screen.getByRole('button', { name: /Yeniden dene/ }));
    await waitFor(() => expect(api.ipSinifi.mock.calls.length).toBe(once + 1), SINIF_BEKLE);
  });

  it('YT22 wrk: SNI kapalı ve false, alanlar değişir, tavan satırı; gövdede motor wrk + bağlantılar (hizlar yok); onayda wrk yük satırı ve süre', async () => {
    const okKayit = tamamOnKontrol({
      motor: 'wrk', parametreler: WRK_P as NlKosuAyrinti['parametreler'],
      onKontrol: onKontrolNormalle({ ...ON_KONTROL_UYARILI, yollar_200: 264, k6_var: null, k6_surum: null, k6_sha256: null, wrk_var: true, wrk_calisiyor: true, wrk_surum: 'wrk 4.2.0 [epoll] Copyright (C) 2012 Will Glozer', wrk_sha256: 'e'.repeat(64) }),
      sunucuDegerlendirmesi: { engeller: [], uyarilar: [WRK_UYARISI] },
    });
    api.onKontrol.mockResolvedValue({ ok: true, kosuId: 16, jobId: 900, awxServerId: 1 });
    api.kosu.mockResolvedValue({ ok: true, kosu: okKayit, adimlar: [] });
    api.durum.mockResolvedValue({ ok: true, status: 'successful', finished: true, output: '', result: null, kosuDurum: 'DONE' });
    await yeniKosuAc();
    fireEvent.change(hostSecici(), { target: { value: 'GBNGXT10' } });
    fireEvent.click(screen.getByRole('button', { name: '10.1.2.3' }));
    const sni = screen.getByRole('checkbox', { name: /SNI ile bağlan/ });
    fireEvent.click(sni);
    expect(sni).toBeChecked();
    expect(screen.getByRole('radio', { name: 'k6 — açık döngü (sabit istek/sn)' })).toBeChecked();
    fireEvent.click(screen.getByRole('radio', { name: 'wrk — kapalı döngü (sabit bağlantı, hız tavanlı)' }));
    expect(screen.getByRole('radio', { name: 'wrk — kapalı döngü (sabit bağlantı, hız tavanlı)' })).toBeChecked();
    // wrk SNI'yi Host basligina gore secemez: kutu kapali ve isaretsiz, govdede false.
    expect(sni).toBeDisabled();
    expect(sni).not.toBeChecked();
    expect(screen.getByText('— wrk SNI’yi Host başlığına göre seçemez (IP adresi SNI olarak gider).')).toBeTruthy();
    // UV4: not tam opak (opacity 0.7 acik temada AA altinda kaliyordu).
    expect((screen.getByText('— wrk SNI’yi Host başlığına göre seçemez (IP adresi SNI olarak gider).').closest('label') as HTMLElement).style.opacity).toBe('');
    expect(screen.queryByLabelText('Hızlar (istek/sn)')).toBeNull();
    expect(screen.queryByLabelText('En çok VU')).toBeNull();
    expect(screen.getByLabelText('Bağlantılar')).toHaveValue('2 4 8');
    expect(screen.getByLabelText('İş parçacığı')).toHaveValue(2);
    // WR2: tavan ORTALAMA hizi sinirlar (kapali dongu istekleri kumeler; Portal burst'u okumaz): "aşamaz" denmez.
    expect(screen.getByText('Ortalama toplam hız tavanı: 450 istek/sn (bağlantı başına bekleme ≈ 5 ms; genel üst sınır)')).toBeTruthy();
    expect(screen.getByText('wrk kapalı döngüdür; Portal toplam hızı ORTALAMADA 450 istek/sn ile sınırlar. İlk 429 ya da 5xx yanıtta koşu durur (DUR).')).toBeTruthy();
    expect(screen.getByText('Bağlantılar birlikte başlar, ilk istekler rastgele yayılır ama istekler kümelenebilir: limit_req burst’ü bağlantı sayısından küçük ya da burst’süz yollarda 429 alınır ve koşu durur. Böyle yollarda k6 kullanın ya da küçük bağlantı sayılarıyla başlayın.')).toBeTruthy();
    expect(screen.getByText(/^Kapalı döngü: her adımda sabit bağlantı sayısı.*\(ortalama toplam ≤ 450 istek\/sn\)\./)).toBeTruthy();
    expect(screen.getByText('6 (3 bağlantı kademesi × 2)')).toBeTruthy();
    // Is parcacigi baglantiyi bolmuyorsa alan hatasi ve on kontrol kapali.
    fireEvent.change(screen.getByLabelText('Bağlantılar'), { target: { value: '3 6 9' } });
    expect(screen.getByText('Her bağlantı sayısı iş parçacığı sayısına tam bölünmeli.')).toBeTruthy();
    expect(okDugmesi()).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Bağlantılar'), { target: { value: '2 4 8' } });
    await waitFor(() => expect(okDugmesi()).toBeEnabled(), SINIF_BEKLE);
    fireEvent.click(okDugmesi());
    await waitFor(() => expect(api.onKontrol).toHaveBeenCalledTimes(1));
    const govde = api.onKontrol.mock.calls[0][0];
    expect(govde.sni).toBe(false);
    expect(govde.parametreler).toEqual({ motor: 'wrk', baglantilar: [2, 4, 8], is_parcacigi: 2, tekrar: 2, isinma: 30, sure: 120, bosluk: 30, bosta: 60, kip: 'yeni', ae: 'br' });
    expect(govde.parametreler).not.toHaveProperty('hizlar');
    expect(govde.parametreler).not.toHaveProperty('tavan_rps');
    // wrk on kontrol paneli ve bilgi satiri.
    expect(await screen.findByText('Yük sunucusunda wrk')).toBeTruthy();
    expect(screen.getByText(`wrk 4.2.0 [epoll] Copyright (C) 2012 Will Glozer · sha256 ${'e'.repeat(12)}…`, { exact: false })).toBeTruthy();
    // Onay isteyen wrk uyarisi (WR2): "ORTALAMADA ... aşmaz", tavanı "aşamaz" iddiasi yok.
    expect(screen.getByText(WRK_UYARISI)).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/tavanını \([^)]*\) aşamaz/);
    await waitFor(() => expect(screen.getByRole('button', { name: /Koşuyu başlat/ })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: /Koşuyu başlat/ }));
    const pencere = await screen.findByRole('dialog');
    expect(within(pencere).getByText('wrk · 2 · 4 · 8 bağlantı × 2 tekrar = 6 adım · 2 iş parçacığı · ortalama ≤ 450 istek/sn · yeni bağlantı · brotli (br)')).toBeTruthy();
    // Tahmini sure: 60 + 3 x 2 x (30 + 120 + 30 + 20) + 120 = 1380 sn.
    expect(within(pencere).getByText(/^≈ 23 dk 00 sn \(üst sınır/)).toBeTruthy();
    expect(within(pencere).queryByRole('alert')).toBeNull();
  });

  it('YT23 sınıflandırma retleri ve ön kontrol host_uretim: mesaj görünür, düğme kapalı', async () => {
    // Sunucu ret govdesindeki `sahipler` NESNE dizisidir ({ host, env, nginx, kaynaklar }): ekran metni sunucu mesajindan,
    // nesne hicbir yerde "[object Object]" olarak cizilmez.
    const SAHIP = (host: string, env: string) => ({ host, env, nginx: true, kaynaklar: ['tarama'] });
    const RETLER: Record<string, { code: string; message: string; sahipler?: ReturnType<typeof SAHIP>[] }> = {
      '10.4.4.1': { code: 'ip_belirsiz', message: '10.4.4.1 birden çok nginx sunucusunda tanımlı (GBNGXT10, GBNGXT11); hedef sunucuyu listeden seçin.', sahipler: [SAHIP('GBNGXT10', 'TEST'), SAHIP('GBNGXT11', 'TEST')] },
      '10.4.4.2': { code: 'ip_sahibi_cozulemedi', message: "10.4.4.2 adı çözülemeyen bir envanter kaydına ait (dbo.IPInventory); IP'nin sahibi bilinmediği için yük testi yapılmaz." },
      '10.4.4.3': { code: 'serbest_kapali', message: '10.4.4.3 envanterdeki bir nginx sunucusuna ait değil ve serbest hedef kapalı (NGINX_LOADTEST_SERBEST_AGLAR tanımlı değil).', sahipler: [] },
      '10.4.4.4': { code: 'hedef_uretim', message: '10.4.4.4, GBNGXP40 sunucusuna ait (ortamı PROD); yük testi yapılmaz.', sahipler: [SAHIP('GBNGXP40', 'PROD')] },
    };
    api.ipSinifi.mockImplementation(async (ip: string) => (RETLER[ip] ? { ok: false, ...RETLER[ip], _httpStatus: 409 } : varsayilanSinif(ip)));
    await yeniKosuAc();
    // Formda baska bir eksik de var (tekrar 9): IP reddi yine ONCE soylenir (parametre duzeltmek bu hedefi acmaz).
    expect(screen.getByLabelText('Tekrar')).toHaveAccessibleDescription('Her hız kaç kez koşulsun (gürültü ölçümü için ≥ 2).');
    fireEvent.change(screen.getByLabelText('Tekrar'), { target: { value: '9' } });
    // UI4: gorunen satir (hata > yardim) girdinin erisilebilir aciklamasi (ekran okuyucu odakta okur).
    expect(screen.getByLabelText('Tekrar')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('Tekrar')).toHaveAccessibleDescription('Aralık: 1–3');
    for (const [ip, r] of Object.entries(RETLER)) {
      fireEvent.change(screen.getByLabelText('Hedef IP'), { target: { value: ip } });
      expect(await screen.findByText(r.message, {}, SINIF_BEKLE)).toBeTruthy();
      expect(screen.getByText(r.message).closest('[role="alert"]')).toBeTruthy();
      expect(okDugmesi()).toBeDisabled();
      expect(screen.getByText('Hedef IP kullanılamaz — ayrıntı “Hedef ve yük sunucusu” bölümünde.')).toBeTruthy();
      expect(screen.queryByText('Önce formdaki eksikleri giderin.')).toBeNull();
      expect(document.body.textContent).not.toContain('[object Object]');
    }
    fireEvent.change(screen.getByLabelText('Tekrar'), { target: { value: '2' } });
    // host_uretim on kontrolde (sinif serbest): mesaj + ayni girdiyle dugme kapali; Host basligi degisince acilir.
    const HOST_URETIM = 'Host başlığı (glomo-test.fw.garantibbva.com.tr) son taramada yalnız üretim / EDU / ortamı bilinmeyen nginx sunucularında tanımlı (GBNGXP40); bu adla yük testi yapılmaz.';
    api.onKontrol.mockResolvedValueOnce({ ok: false, code: 'host_uretim', message: HOST_URETIM, sahipler: [SAHIP('GBNGXP40', 'PROD')], _httpStatus: 409 });
    fireEvent.change(screen.getByLabelText('Hedef IP'), { target: { value: '10.20.30.40' } });
    await waitFor(() => expect(okDugmesi()).toBeEnabled(), SINIF_BEKLE);
    fireEvent.click(okDugmesi());
    expect(await screen.findByText(HOST_URETIM)).toBeTruthy();
    expect(document.body.textContent).not.toContain('[object Object]');
    expect(okDugmesi()).toBeDisabled();
    expect(screen.getByText(/^Bu girdiyle ön kontrol reddedildi/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Host başlığı (vhost)'), { target: { value: 'glomo-test2.fw.garantibbva.com.tr' } });
    expect(okDugmesi()).toBeEnabled();
  });

  it('YT26 (D7) listede olmayan Host başlığı yazılabilir: not görünür, ön kontrol açık; listeden ad notu kaldırır', async () => {
    api.onKontrol.mockResolvedValue({ ok: true, kosuId: 16, jobId: 900, awxServerId: 1 });
    api.kosu.mockResolvedValue({ ok: true, kosu: tamamOnKontrol(), adimlar: [] });
    await yeniKosuAc();
    fireEvent.change(hostSecici(), { target: { value: 'GBNGXT10' } });
    fireEvent.click(screen.getByRole('button', { name: '10.1.2.3' }));
    const vhost = screen.getByLabelText('Host başlığı (vhost)');
    // Oneriler sunucunun server_name'leri (datalist); senaryonun vhost'u listede oldugu icin onerilir.
    expect(vhost.tagName).toBe('INPUT');
    expect(vhost).toHaveAttribute('list', 'yuk-vhost-oneriler');
    expect([...document.querySelectorAll('#yuk-vhost-oneriler option')].map((o) => o.getAttribute('value'))).toEqual(['glomo-test.fw.garantibbva.com.tr']);
    expect(vhost).toHaveValue('glomo-test.fw.garantibbva.com.tr');
    expect(screen.queryByText(VHOST_LISTEDE_YOK_NOTU)).toBeNull();
    // UI4: gorunen satir (not > yardim) girdiye aria-describedby ile bagli; yalniz girdi (datalist degil).
    expect(vhost).toHaveAccessibleDescription('İstekler bu Host başlığıyla gider.');
    fireEvent.change(vhost, { target: { value: 'joker-alt.fw.garantibbva.com.tr' } });
    expect(screen.getByText(VHOST_LISTEDE_YOK_NOTU)).toBeTruthy();
    expect(vhost).toHaveAccessibleDescription(VHOST_LISTEDE_YOK_NOTU);
    expect(document.getElementById('yuk-vhost-oneriler')).not.toHaveAttribute('aria-describedby');
    await waitFor(() => expect(okDugmesi()).toBeEnabled(), SINIF_BEKLE);
    fireEvent.change(vhost, { target: { value: 'glomo-test.fw.garantibbva.com.tr' } });
    expect(screen.queryByText(VHOST_LISTEDE_YOK_NOTU)).toBeNull();
    expect(vhost).toHaveAccessibleDescription('İstekler bu Host başlığıyla gider.');
    fireEvent.change(vhost, { target: { value: 'joker-alt.fw.garantibbva.com.tr' } });
    fireEvent.click(okDugmesi());
    await waitFor(() => expect(api.onKontrol).toHaveBeenCalledTimes(1));
    expect(api.onKontrol.mock.calls[0][0]).toMatchObject({ hedefHost: 'GBNGXT10', hedefIp: '10.1.2.3', vhost: 'joker-alt.fw.garantibbva.com.tr' });
  });
});

describe('Yük Testi — wrk ve serbest kayıtlar (2026-10-28)', () => {
  const adim = (o: Record<string, unknown>) => adimNormalle({ senaryo: 'K', kip: 'yeni', ae: 'br', gecerlilik: 'GECERLI', gercek_rps: 190, p95: 12, p50: 5, p99: 20, ...o });
  const SERBEST_WRK = { hedefTuru: 'serbest' as const, hedefHost: null, hedefIp: '10.20.30.40', serbestAg: '10.20.30.0/24', motor: 'wrk' as const, parametreler: WRK_P as NlKosuAyrinti['parametreler'] };

  it('YT24 koşu ayrıntısı wrk + serbest: çipler, bağlantı birimi, CPU “—”, p95 alt metni; durdur yalnız yük sunucusunu söyler', async () => {
    // analiz.cjs serbest ciktisi: pencere_kaynak '-' (olcum penceresi kurulmaz), 429 nedeninde sunucu sayisi YOK,
    // kosu uyarilari serbest / wrk metinleri (ekran ham gosterir; adim uyarisi degil, genel listede).
    const YENI_UYARILAR = ['serbest_kosuda_sunucu_dosyalari_yok_sayildi(4)', 'sunucu_olcumu_yok(serbest_hedef)', 'wrk_tls_payi_hesaplanmaz(oturum_devami_ya_da_tls13_olabilir)'];
    kosuYukle({ id: 40, durum: 'DONE', gecerlilik: 'KISMI', finishedAt: '2026-10-28T09:00:00Z', ...SERBEST_WRK, analiz: { nproc: null, cpuTlsliPay: null, uyarilar: YENI_UYARILAR, okumaHatasi: null } }, [
      adim({ tur: 'R40_K_yeni_br_2_r1', hiz: 2, ham: { pencere_kaynak: '-', uyarilar: [] } }), adim({ tur: 'R40_K_yeni_br_4_r1', hiz: 4, ham: { pencere_kaynak: '-', uyarilar: [] } }),
      adim({ tur: 'R40_K_yeni_br_8_r1', hiz: 8, p95: 20, ham: { pencere_kaynak: '-', uyarilar: [] } }),
      adim({ tur: 'R40_K_yeni_br_8_r2', hiz: 8, gecerlilik: 'GECERSIZ', nedenler: ['429(istemci=3)', 'wrk_rc=1'], n_429: 3, ham: { pencere_kaynak: '-', uyarilar: [] } }),
    ]);
    const { unmount } = render(<KosuAyrinti kosuId={40} isAdmin={false} onGeri={vi.fn()} />);
    expect(await screen.findByRole('heading', { name: /Koşu #40/ })).toBeTruthy();
    expect(screen.getByTitle(SERBEST_CIP_IPUCU).textContent).toBe('serbest');
    expect(screen.getByTitle(WRK_CIP_IPUCU).textContent).toBe('wrk');
    expect(screen.getByText('Hedef (serbest)')).toBeTruthy();
    expect(screen.getByText('Bağlantılar · tekrar')).toBeTruthy();
    expect(screen.getByText('2 · 4 · 8 bağlantı × 2')).toBeTruthy();
    // UV4 (WR2): ipucu tavanin ORTALAMA oldugunu soyler ("toplam ≤" asilmaz gibi okutur).
    expect(screen.getByText('2 · 4 · 8 bağlantı × 2').getAttribute('title')).toMatch(/ · ortalama toplam ≤ \d+ istek\/sn$/);
    expect(screen.queryByText('Hızlar · tekrar')).toBeNull();
    expect(screen.getByText('p95 @ 8 bağlantı')).toBeTruthy();
    expect(screen.getByText('istemci (wrk, CO düzeltmeli), geçerli adımların ortalaması')).toBeTruthy();
    // Serbestte CPU kademesi yok: etiket kademesiz, deger "—" (sunucu kipinde "CPU-ms/istek @ <kademe>", YT14).
    expect(screen.getByText('CPU-ms/istek')).toBeTruthy();
    expect(screen.queryByText(/CPU-ms\/istek @/)).toBeNull();
    // Serbestte CPU ve kapasite olculmez: "—" ve neden.
    expect(screen.getAllByText('serbest hedef: sunucu ölçümü yok')).toHaveLength(2);
    // Yeni analiz uyarilari ham kodla, genel listede (adim uyarisi katlamasinda degil).
    const kutu = screen.getByText('3 analiz uyarısı').closest('[role]') ?? document.body;
    for (const u of YENI_UYARILAR) expect(within(kutu as HTMLElement).getByText(u).closest('details')).toBeNull();
    const tablo = screen.getByRole('table', { name: 'Adım sonuçları' });
    expect(within(tablo).getByRole('columnheader', { name: 'Bağlantı' })).toBeTruthy();
    expect(within(tablo).getByRole('columnheader', { name: 'Bağlantı' }).getAttribute('title')).toContain('(kapalı döngü; ortalama toplam hız tavanlı)');
    expect(within(tablo).queryByRole('columnheader', { name: 'Hız' })).toBeNull();
    const satirlar = within(tablo).getAllByRole('row').slice(1);
    const [s1] = satirlar;
    expect(s1.textContent).toContain('2 bağlantı');
    expect(within(s1).getAllByTitle('serbest hedef: sunucu ölçümü yok')).toHaveLength(4);
    // Serbest adimda (pencere_kaynak '-') ipucu sunucu logundan SOZ ETMEZ: sunucu tarafi olcum hic yok.
    expect(within(tablo).queryAllByTitle(/sunucu logunda/)).toHaveLength(0);
    for (const s of satirlar) expect(within(s).getAllByTitle('serbest hedef: sunucu ölçümü yok').length).toBeGreaterThanOrEqual(4);
    // Serbest neden bicimi ham gosterilir: 429(istemci=N) ve wrk_rc=.
    const gecersiz = satirlar.find((s) => s.textContent?.includes('geçersiz')) as HTMLElement;
    expect(within(gecersiz).getByTitle('429(istemci=3); wrk_rc=1').textContent).toBe('429(istemci=3) +1');
    expect(screen.getAllByText('ms · yatay: bağlantı')).toHaveLength(2);
    unmount();
    // Durdur: serbestte yalniz yuk sunucusundaki wrk (kaydedici yok); basari metni motorla.
    kosuYukle({ id: 40, durum: 'RUNNING', ...SERBEST_WRK });
    api.durdur.mockResolvedValue({ ok: true, iptal: { canceled: true }, iptalHatasi: null, durdurIsi: { jobId: 920, awxServerId: 1 }, durdurHatasi: null });
    render(<KosuAyrinti kosuId={40} isAdmin onGeri={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Durdur' }));
    const pencere = await screen.findByRole('dialog');
    expect(pencere.textContent).toMatch(/GBNGXT34 üzerindeki wrk’yi sonlandırır \(serbest hedefe bağlanılmaz; kaydedici yoktur\)/);
    expect(pencere.textContent).not.toMatch(/CPU kaydedicisini/);
    fireEvent.click(within(pencere).getByRole('button', { name: 'Durdur' }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Durdurma işi AWX #920 başlatıldı; wrk durdurulduğunda kilitler bırakılır.'));
  });

  it('YT25 Karşılaştır: farklı motor uyarısı; iki serbest koşu farklı IP -> farklı hedef; iş parçacığı uyarısı; wrk kademe birimi', async () => {
    const K = (id: number, o: Record<string, unknown> = {}) => ({ ...KOSU_LISTE, id, durum: 'DONE', gecerlilik: 'GECERLI', etiket: `koşu ${id}`, hedefTuru: 'sunucu', motor: 'k6', ...o });
    api.kosular.mockResolvedValue({
      ok: true, dahaVar: false,
      kosular: [K(30), K(31, { motor: 'wrk' }), K(32, { hedefTuru: 'serbest', hedefHost: null, hedefIp: '10.20.30.40', motor: 'wrk' }), K(33, { hedefTuru: 'serbest', hedefHost: null, hedefIp: '10.20.30.41', motor: 'wrk' }),
        K(34, { motor: 'wrk' }), K(35, { gecerlilik: 'KISMI' }), K(36, { gecerlilik: 'GECERSIZ' }), K(37, { gecerlilik: 'OKUNAMADI' })],
    });
    api.kosu.mockImplementation(async (id: number) => ({ ok: true, kosu: ayrinti({ id, motor: 'wrk', parametreler: { ...WRK_P, is_parcacigi: id === 33 ? 4 : 2 } as NlKosuAyrinti['parametreler'] }), adimlar: [] }));
    api.karsilastir.mockResolvedValue({
      ok: true, karar: 'NOTR', nedenler: ['referans=#32 aday=#33 senaryo=K kip=yeni ae=br'], kademe: { cpu: 4, p95: 8 },
      tablo: [{ hiz: 4, ref: { p95: 10 }, aday: { p95: 10.2 }, farkYuzde: { p95: 2 } }],
      ref: { id: 32, etiket: null, createdAt: null, motor: 'wrk', hedefTuru: 'serbest' }, aday: { id: 33, etiket: null, createdAt: null, motor: 'wrk', hedefTuru: 'serbest' },
    });
    render(<Karsilastir />);
    const ref = await screen.findByLabelText('Referans koşu');
    expect(await within(ref).findByRole('option', { name: /^#33 · koşu 33 · 10\.20\.30\.41 \(serbest\) · wrk · / })).toBeTruthy();
    // UI3: gecerlilik ekranin geri kalaniyla ayni Turkce etiketle (GECERLILIK tablosu), ham kod ("kismi") degil; GECERLI yazilmaz.
    const secenek = (id: number) => within(ref).getAllByRole('option').find((o) => o.textContent?.startsWith(`#${id} `))?.textContent ?? '';
    expect(secenek(35)).toMatch(/ · kısmen geçerli$/);
    expect(secenek(36)).toMatch(/ · geçersiz$/);
    expect(secenek(37)).toMatch(/ · okunamadı$/);
    expect(within(ref).getAllByRole('option').map((o) => o.textContent).join('\n')).not.toMatch(/kismi|gecersiz|okunamadi/);
    expect(secenek(30)).not.toMatch(/geçerli$/);
    fireEvent.change(ref, { target: { value: '30' } });
    fireEvent.change(screen.getByLabelText('Aday koşu'), { target: { value: '31' } });
    expect(screen.getByText('Koşular farklı yük araçlarıyla alınmış (k6 / wrk): karar VERİ YOK döner.')).toBeTruthy();
    expect(screen.queryByText(/farklı hedef, vhost ya da senaryoyla/)).toBeNull();
    expect(api.kosu).not.toHaveBeenCalled();
    // Iki serbest kosu: host yok (ikisi de null), IP farkli -> farkli hedef; serbest uyarisi.
    fireEvent.change(ref, { target: { value: '32' } });
    fireEvent.change(screen.getByLabelText('Aday koşu'), { target: { value: '33' } });
    expect(screen.queryByText(/farklı yük araçlarıyla/)).toBeNull();
    expect(screen.getByText('İki koşu farklı hedef, vhost ya da senaryoyla yapılmış — karşılaştırma yalnız aynı ölçüm düzeninde anlamlıdır.')).toBeTruthy();
    expect(screen.getByText('Bir koşu serbest hedefte (CPU ölçülmedi): KALICI verilmez; karar p95 ve hata oranına göre.')).toBeTruthy();
    // Iki wrk kosusu: is parcacigi ayrintidan okunur (2 / 4).
    expect(await screen.findByText('Koşular farklı iş parçacığı sayısıyla alınmış: karar VERİ YOK döner.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Karşılaştır/ }));
    // Serbest tarafta CPU olculmez: karar basliginda "CPU kademesi" YAZILMAZ, p95 kademesi yazilir.
    expect(await screen.findByText(/^#32 → #33 · p95 kademesi 8 bağlantı$/)).toBeTruthy();
    expect(screen.queryByText(/CPU kademesi/)).toBeNull();
    const tablo = screen.getByRole('table', { name: 'Kademe karşılaştırması' });
    expect(within(tablo).getByRole('columnheader', { name: 'Bağlantı' })).toBeTruthy();
    expect(within(tablo).getByText('4 bağlantı')).toBeTruthy();
    // Iki sunucu wrk kosusu: CPU kademesi yazilir; analiz CPU'suz yolu sectiyse ("CPU olculmedi (wrk, ...)") yazilmaz.
    const SUNUCU = { ok: true as const, karar: 'NOTR' as const, kademe: { cpu: 4, p95: 8 }, tablo: [], ref: { id: 31, etiket: null, createdAt: null, motor: 'wrk' as const, hedefTuru: 'sunucu' as const }, aday: { id: 34, etiket: null, createdAt: null, motor: 'wrk' as const, hedefTuru: 'sunucu' as const } };
    api.karsilastir.mockResolvedValueOnce({ ...SUNUCU, nedenler: ['referans=R31 aday=R34 senaryo=K kip=yeni ae=br'] });
    fireEvent.change(ref, { target: { value: '31' } });
    fireEvent.change(screen.getByLabelText('Aday koşu'), { target: { value: '34' } });
    fireEvent.click(screen.getByRole('button', { name: /Karşılaştır/ }));
    expect(await screen.findByText(/^#31 → #34 · CPU kademesi 4 bağlantı · p95 kademesi 8 bağlantı$/)).toBeTruthy();
    api.karsilastir.mockResolvedValueOnce({ ...SUNUCU, nedenler: ['referans=R31 aday=R34 senaryo=K kip=yeni ae=br', 'CPU olculmedi (wrk, sunucu kaydi eksik): KALICI verilmez; karar p95 ve hata oranina gore'] });
    fireEvent.click(screen.getByRole('button', { name: /Karşılaştır/ }));
    expect(await screen.findByText(/^#31 → #34 · p95 kademesi 8 bağlantı$/)).toBeTruthy();
    expect(screen.queryByText(/CPU kademesi/)).toBeNull();
  });

  it('YT28 ön kontrol paneli: D7 server_name satırı “uyarı” (kaldı değil); wrk satırı üç durumlu; serbestte yük sunucusu satırları', () => {
    const satir = (ad: string) => (screen.getByText(ad).closest('li') as HTMLElement).textContent || '';
    const panel = (ok: Record<string, unknown>, ek: Partial<NlKosuAyrinti> = {}) => render(<OnKontrolPaneli kosu={{ durum: 'DONE', onKontrol: onKontrolNormalle(ok), sunucuDegerlendirmesi: { engeller: [], uyarilar: [] }, ...ek }} />);
    const r1 = panel({ ...ON_KONTROL_UYARILI, server_name_var: false });
    expect(satir('server_name nginx -T’de')).toMatch(/uyarı$/);
    expect(satir('Yük sunucusunda k6')).toMatch(/v0\.49\.0 · geçti$/);
    r1.unmount();
    const wrk = { ...ON_KONTROL_UYARILI, k6_var: null, k6_surum: null, wrk_var: true, wrk_calisiyor: true, wrk_surum: 'wrk 4.2.0 [epoll] Copyright (C) 2012 Will Glozer' };
    const r2 = panel(wrk, { motor: 'wrk' });
    expect(satir('Yük sunucusunda wrk')).toMatch(/^Yük sunucusunda wrk4\.2\.0 · geçti$/);
    r2.unmount();
    const r3 = panel({ ...wrk, wrk_var: false, wrk_surum: 'wrk  [epoll] Copyright (C) 2012 Will Glozer' }, { motor: 'wrk' });
    expect(satir('Yük sunucusunda wrk')).toMatch(/wrk çalışıyor, sürüm okunamadı · kaldı$/);
    r3.unmount();
    const r4 = panel({ ...wrk, wrk_var: false, wrk_calisiyor: false, wrk_surum: null }, { motor: 'wrk' });
    expect(satir('Yük sunucusunda wrk')).toMatch(/^Yük sunucusunda wrkkaldı$/);
    r4.unmount();
    const r5 = panel({ ...wrk, wrk_var: null, wrk_calisiyor: null, wrk_surum: null }, { motor: 'wrk' });
    expect(satir('Yük sunucusunda wrk')).toMatch(/ölçülemedi$/);
    r5.unmount();
    // Serbest: hedef satirlari yok; yuk sunucusu satirlari ve izin dosyasinda eslesen ag.
    panel({ ip_yuk_makinesinde: false, serbest_ag: '10.20.30.0/24', k6_var: true, yollar_toplam: 2, yollar_200: 2 }, { hedefTuru: 'serbest' });
    expect(satir('IP yük sunucusunda yerel değil')).toMatch(/geçti$/);
    expect(satir('Yük sunucusu izin dosyası')).toMatch(/10\.20\.30\.0\/24 · geçti$/);
    for (const ad of ['IP hedefte yerel', 'server_name nginx -T’de', 'Tek nginx master', 'Log dizini okunur']) expect(screen.queryByText(ad)).toBeNull();
  });

  it('YT27 Koşular: serbest satır IP etiketiyle ve çiplerle; hedef süzgecinde null / boş seçenek yok', async () => {
    api.kosular.mockResolvedValue({
      ok: true, dahaVar: false,
      kosular: [
        { ...KOSU_LISTE, id: 41, durum: 'DONE', gecerlilik: 'GECERLI', hedefTuru: 'serbest', hedefHost: null, hedefIp: '10.20.30.40', motor: 'wrk' },
        { ...KOSU_LISTE, id: 40, durum: 'DONE', gecerlilik: 'GECERLI' },
      ],
    });
    render(<KosuListesi onAc={vi.fn()} />);
    const satir = (await screen.findByRole('button', { name: 'Koşu 41 ayrıntısı' })).closest('tr') as HTMLElement;
    expect(within(satir).getByTitle('10.20.30.40').textContent).toBe('10.20.30.40');
    expect(within(satir).getByTitle(SERBEST_CIP_IPUCU).textContent).toBe('serbest');
    expect(within(satir).getByTitle(WRK_CIP_IPUCU).textContent).toBe('wrk');
    const k6Satir = screen.getByRole('button', { name: 'Koşu 40 ayrıntısı' }).closest('tr') as HTMLElement;
    expect(within(k6Satir).queryByTitle(SERBEST_CIP_IPUCU)).toBeNull();
    expect(within(k6Satir).queryByTitle(WRK_CIP_IPUCU)).toBeNull();
    const suzgec = screen.getByLabelText('Hedef sunucu ya da IP');
    expect(within(suzgec).getAllByRole('option').map((o) => [o.getAttribute('value'), o.textContent])).toEqual([['', 'Tüm hedefler'], ['10.20.30.40', '10.20.30.40'], ['GBNGXT10', 'GBNGXT10']]);
    fireEvent.change(suzgec, { target: { value: '10.20.30.40' } });
    expect(screen.getByRole('button', { name: 'Koşu 41 ayrıntısı' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Koşu 40 ayrıntısı' })).toBeNull();
  });

  it('YT29 (entegrasyon) plan uyarıları sunucunun onKontrolUyarilari’nda başta: panelde ve onayda TEK kez', () => {
    const P1 = 'Host başlığı (yok.test.local) son nginx taramasında hiçbir sunucunun server_name listesinde yok: hedefin (LB / yönetilmeyen sunucu) bu adı nereye yönlendireceği bilinmiyor.';
    const P2 = 'Yük sunucusu (GBNGXT34) bir internet reverse proxy’si; hedef VIP’in havuzunda kendisi de olabilir. Havuzu doğrulayın.';
    // GET /kosular/:id (sunucu sekli): planUyarilari ayrica VE onKontrolUyarilari = plan uyarilari basta + degerlendirme.
    const k = kosuNormalle({
      ...KOSU_LISTE, id: 16, islem: 'on_kontrol', durum: 'DONE', finishedAt: new Date().toISOString(), hedefTuru: 'serbest', hedefHost: '', hedefIp: '10.20.30.40',
      motor: 'k6', serbestAg: '10.20.30.0/24', planUyarilari: [P1, P2],
      parametreler: { motor: 'k6', ...PARAM }, sonucOzet: { durum: 'OK', run_id: '16', islem: 'on_kontrol' },
      onKontrol: { ip_yuk_makinesinde: false, serbest_ag: '10.20.30.0/24', k6_var: true, k6_surum: 'k6 v0.49.0', yollar_toplam: 2, yollar_200: 2 },
      onKontrolEngelleri: [], onKontrolUyarilari: [P1, P2, SERBEST_UYARISI],
    });
    expect(k.planUyarilari).toEqual([P1, P2]);
    const d = onKontrolDegerlendir(k);
    expect(d.uyarilar).toEqual([P1, P2, SERBEST_UYARISI]);
    const { unmount } = render(<OnKontrolPaneli kosu={k} />);
    for (const u of [P1, P2, SERBEST_UYARISI]) expect(screen.getAllByText(u)).toHaveLength(1);
    expect(screen.getByText('3 uyarı — başlatırken açıkça onaylamanız gerekir')).toBeTruthy();
    unmount();
    // Onay: ekranin listesi + sunucunun 409 uyari_onayi listesi (ayni metinler) birlesince de her uyari bir kez.
    render(<BaslatOnayi onKontrol={k} senaryo={null} uyarilar={d.uyarilar} sunucuUyarilari={[P1, P2, SERBEST_UYARISI]} busy={false} hata={null} onOnay={vi.fn()} onKapat={vi.fn()} />);
    for (const u of [P1, P2, SERBEST_UYARISI]) expect(screen.getAllByText(u)).toHaveLength(1);
    expect(screen.getByText('3 ön kontrol uyarısı')).toBeTruthy();
  });
});

// ── Tur 3 incelemesi (2026-10-28): UI1, UI2, SA2 ──────────────────────────────────────
/**
 * Hic yol denenmemis serbest on kontrol (UI1). `on_kontrol` gercek Templar ile canli Play 8 ifadelerinden (izin dosyasi
 * yok -> Play 3 yollari atlar: yollar 0 / 0, sikistirma 0/0/0, serbest_ag null; IP yuk sunucusunda yerel -> yollar
 * yine 0 / 0), engeller canli dogrula.onKontrolDegerlendir'den alindi (GET /kosular/:id sekli).
 */
const HIC_YOL_YOK = {
  ip_yerel: null, server_name_var: null, master_sayisi: null, web_log_df: null, log_dizini_okunur: null, log_format_ua: null, statik_direktif: null,
  ip_yuk_makinesinde: null, serbest_ag: null, k6_var: null, k6_surum: null, k6_sha256: null,
  wrk_var: true, wrk_calisiyor: true, wrk_surum: 'wrk 4.2.0 [epoll] Copyright (C) 2012 Will Glozer', wrk_sha256: 'f'.repeat(64),
  yollar_toplam: 0, yollar_200: 0, ilk_hatalar: [], sikistirma: { statik: 0, dinamik: 0, sikistirmasiz: 0 },
};
const hicYolDenenmemis = (onKontrol: Record<string, unknown>, hata: string, engeller = ['hedef IP yük makinesinde yerel ya da ölçülemedi', 'ön kontrolde hiçbir yol denenmedi']) => kosuNormalle({
  id: 16, islem: 'on_kontrol', durum: 'FAILED', hedefTuru: 'serbest', motor: 'wrk', hedefHost: null, hedefIp: '10.20.30.66', vhost: 'glomo-test.fw.garantibbva.com.tr',
  yukHost: 'GBNGXT34', createdAt: '2026-10-28T08:00:00Z', finishedAt: '2026-10-28T08:02:00Z', parametreler: { ...WRK_P, tavan_rps: 200, kip: 'ka' },
  planUyarilari: [], serbestAg: '10.20.30.0/24', onKontrol,
  onKontrolEngelleri: engeller, onKontrolUyarilari: [SERBEST_UYARISI, WRK_UYARISI],
  sonucOzet: { surum: 2, run_id: '16', islem: 'on_kontrol', hedef_turu: 'serbest', motor: 'wrk', durum: 'FAIL', hata },
});
/**
 * Izin bloguna HIC gelinmemis serbest on kontrol (UV1). Gercek erisilemezlik yolu (ansible-core 2.16.19 ile denendi):
 * ignore_unreachable altinda getent UNREACHABLE yok sayilir, 'Kosu dizini' set_fact duser, rescue yt_p3_hata yazar;
 * yt_serbest_izin / yt_yk_sonuc tanimsiz kalir. `on_kontrol` ve hata metni canli Play 8'in gercek Templar ciktisi (hata
 * 300 karakterde kesilir; "serbest izin listesi" gecmez), engeller canli dogrula.onKontrolDegerlendir'den. dzdo, kopya
 * kapisi ve "play tamamlanmadi" metinleri ayni `on_kontrol`u verir.
 */
const IZIN_OLCULMEDI = { ...HIC_YOL_YOK, wrk_var: false, wrk_calisiyor: false, wrk_surum: null, wrk_sha256: null };
const IZIN_OLCULMEDI_ENGELLERI = ['hedef IP yük makinesinde yerel ya da ölçülemedi', 'wrk yük makinesinde bulunamadı ya da çalıştırılamıyor', 'ön kontrolde hiçbir yol denenmedi'];
const IZIN_BLOGU_KOSMADI = [
  "yuk makinesi GBNGXT34: The task includes an option with an undefined variable. The error was: 'dict object' has no attribute 'getent_passwd'. 'dict object' has no attribute 'getent_passwd'\n\nThe error appears to be in '/runner/project/bmw_portal/nginx_loadtest/nginx_loadtest.yml': line 437,...",
  'yuk makinesi GBNGXT34: Timeout (12s) waiting for privilege escalation prompt: ; yuk makinesi: olculmedi; wrk yok ya da calistirilamiyor: /home/www/bin/wrk; hicbir yol denenmedi',
  'yuk makinesi GBNGXT34: betik/senaryo kopyasi dogrulanamadi (kopya ok, reddedilen on_kontrol.sh, senaryo sha256 esit, dizin sahibi/izni 1001/0700); hicbir sey calistirilmadi; yuk makinesi: olculmedi; wrk yok ya da calistirilamiyor: /home/www/bin/wrk; hicbir yol denenmedi',
  'yuk makinesi GBNGXT34: play tamamlanmadi (erisilemedi ya da dustu); yuk makinesi: olculmedi; wrk yok ya da calistirilamiyor: /home/www/bin/wrk; hicbir yol denenmedi',
];
const okSatirlari = () => [...document.querySelectorAll('ul[aria-label="Ön kontrol maddeleri"] li')].map((li) => li.textContent || '');
const okSatiri = (ad: string) => okSatirlari().find((t) => t.startsWith(ad)) ?? '(yok)';

describe('Yük Testi — tur 3 incelemesi (2026-10-28)', () => {
  it('YT30a (UI1) izin dosyası reddetti: yollar satırı “hiçbir yol denenmedi · kaldı”, izin satırı “kaldı”, ölçülmemiş sıkıştırma yok', () => {
    const { unmount } = render(<OnKontrolPaneli kosu={hicYolDenenmemis(HIC_YOL_YOK, 'yuk makinesi: serbest izin listesi: dizin /etc/portal_yuktesti yok, www sahibi ya da grup/diger yazabilir; istek gonderilmedi; hicbir yol denenmedi')} />);
    expect(okSatiri('Senaryo yolları 200')).toBe('Senaryo yolları 200hiçbir yol denenmedi · kaldı');
    expect(okSatiri('Yük sunucusu izin dosyası')).toBe('Yük sunucusu izin dosyasıkaldı');
    expect(okSatiri('IP yük sunucusunda yerel değil')).toMatch(/ölçülemedi$/);
    // Panel kendi engel kutusuyla celismez: engel "hiçbir yol denenmedi" der, satir "geçti" demez.
    expect(within(screen.getByText('Koşu başlatılamaz').closest('[role="alert"]') as HTMLElement).getByText('Ön kontrolde hiçbir yol denenmedi')).toBeTruthy();
    expect(document.body.textContent).not.toContain('Sıkıştırma:');
    expect(screen.getByText(/^wrk 4\.2\.0 \[epoll\]/)).toBeTruthy();
    unmount();
    // Kontrol: denenen yollar eskisi gibi "N / N · geçti" ve sikistirma bilgisi yazilir.
    render(<OnKontrolPaneli kosu={{ durum: 'DONE', hedefTuru: 'serbest', onKontrol: onKontrolNormalle(SERBEST_ON_KONTROL), sunucuDegerlendirmesi: { engeller: [], uyarilar: [SERBEST_UYARISI] } }} />);
    expect(okSatiri('Senaryo yolları 200')).toBe('Senaryo yolları 200264 / 264 · geçti');
    expect(screen.getByText(/Sıkıştırma: statik 0, dinamik 200, sıkıştırmasız 64/)).toBeTruthy();
  });

  it('YT30b (UI1) IP yük sunucusunda yerel: yollar satırı “kaldı”; izin satırı eşleşen ağla “geçti”', () => {
    render(<OnKontrolPaneli kosu={hicYolDenenmemis({ ...HIC_YOL_YOK, ip_yuk_makinesinde: true, serbest_ag: '10.20.30.0/24' }, 'yuk makinesi: hedef IP yuk makinesinde yerel ya da olculemedi (1); istek gonderilmedi; hicbir yol denenmedi')} />);
    expect(okSatiri('Senaryo yolları 200')).toBe('Senaryo yolları 200hiçbir yol denenmedi · kaldı');
    expect(okSatiri('IP yük sunucusunda yerel değil')).toMatch(/kaldı$/);
    expect(okSatiri('Yük sunucusu izin dosyası')).toMatch(/10\.20\.30\.0\/24 · geçti$/);
    expect(document.body.textContent).not.toContain('Sıkıştırma:');
  });

  it('YT30c (UI1) sunucu kipi, IP hedefte yerel değil (yollar atlanır, 0 / 0): yollar satırı “geçti” demez', () => {
    const ok = { ...ON_KONTROL_UYARILI, ip_yerel: false, yollar_toplam: 0, yollar_200: 0, ilk_hatalar: [], sikistirma: { statik: 0, dinamik: 0, sikistirmasiz: 0 } };
    render(<OnKontrolPaneli kosu={kosuNormalle({ id: 20, islem: 'on_kontrol', durum: 'FAILED', hedefTuru: 'sunucu', motor: 'k6', hedefHost: 'GBNGXT10', hedefIp: '10.1.2.3', onKontrol: ok,
      onKontrolEngelleri: ['seçilen IP hedef sunucuda yerel değil (ya da ölçülemedi)', 'ön kontrolde hiçbir yol denenmedi'], onKontrolUyarilari: [],
      sonucOzet: { durum: 'FAIL', hata: 'hedef IP 10.1.2.3 hedef sunucuda yerel degil; istek gonderilmedi; hicbir yol denenmedi' } })} />);
    expect(okSatiri('IP hedefte yerel')).toMatch(/kaldı$/);
    expect(okSatiri('Senaryo yolları 200')).toBe('Senaryo yolları 200hiçbir yol denenmedi · kaldı');
    expect(document.body.textContent).not.toContain('Sıkıştırma:');
  });

  it('YT30d (UV1) izin bloğuna hiç gelinmedi (erişilemedi / dzdo / kopya kapısı): izin satırı “ölçülemedi”, “kaldı” değil', () => {
    for (const hata of IZIN_BLOGU_KOSMADI) {
      const { unmount } = render(<OnKontrolPaneli kosu={hicYolDenenmemis(IZIN_OLCULMEDI, hata, IZIN_OLCULMEDI_ENGELLERI)} />);
      expect(okSatiri('Yük sunucusu izin dosyası')).toMatch(/ölçülemedi$/);
      // Asil neden engel kutusunda (Play 3 hatasi); satir operatoru izin dosyasina yoneltmez.
      expect(within(screen.getByText('Koşu başlatılamaz').closest('[role="alert"]') as HTMLElement).getByText(/^Ön kontrol başarısız: yuk makinesi GBNGXT34: /)).toBeTruthy();
      unmount();
    }
  });

  it('YT31 (UI2) yeniden sınıflandırma sürerken ön kontrol düğmesi kapalı, “IP sınıflandırılıyor…” görünür, eski sınıf kutusu kalkar', async () => {
    await yeniKosuAc();
    fireEvent.change(screen.getByLabelText('Hedef IP'), { target: { value: '10.20.30.40' } });
    expect(await screen.findByText('Serbest hedef (10.20.30.0/24 izinli ağında)', {}, SINIF_BEKLE)).toBeTruthy();
    await waitFor(() => expect(okDugmesi()).toBeEnabled());
    // Ikinci IP'nin siniflandirmasi yavas: sinif bilinmeden form sinirlari ve varsayilanlar bilinmez (fail-closed).
    api.ipSinifi.mockImplementation((ip: string) => new Promise((r) => setTimeout(() => r(SERBEST_SINIFI(ip)), 1500)));
    fireEvent.change(screen.getByLabelText('Hedef IP'), { target: { value: '10.20.30.41' } });
    expect(okDugmesi()).toBeDisabled();
    // Iki yerde: siniflandirma kutusu ve Plan'daki neden satiri.
    expect(screen.getAllByText('IP sınıflandırılıyor…')).toHaveLength(2);
    expect(screen.queryByText('Serbest hedef (10.20.30.0/24 izinli ağında)')).toBeNull();
    await waitFor(() => expect(okDugmesi()).toBeEnabled(), { timeout: 4000 });
    expect(api.ipSinifi).toHaveBeenLastCalledWith('10.20.30.41', { yukHost: 'GBNGXT34', hedefHost: null });
    expect(screen.getByText('Serbest hedef (10.20.30.0/24 izinli ağında)')).toBeTruthy();
    expect(screen.queryAllByText('IP sınıflandırılıyor…')).toHaveLength(0);
  }, 10000);

  it('YT32 (UI2) sıra dışı yanıt: geç gelen bayat A yanıtı B’nin sonucunu ezmez, ekran “sınıflandırılıyor”da takılmaz', async () => {
    const BELIRSIZ = '10.1.2.9 birden çok nginx sunucusunda tanımlı (GBNGXT10, GBNGXT11); hedef sunucuyu listeden seçin.';
    api.ipSinifi.mockImplementation(async (ip: string) => {
      if (ip === '10.1.2.9') { await bekle(1500); return { ok: false, code: 'ip_belirsiz', message: BELIRSIZ, _httpStatus: 409 }; }
      return varsayilanSinif(ip);
    });
    await yeniKosuAc();
    fireEvent.change(screen.getByLabelText('Hedef IP'), { target: { value: '10.1.2.9' } });
    await bekle(600);
    // Bekci korlugu olmasin: A istegi (400 ms gecikmeli) gercekten ucusta, yaniti 1500 ms surer.
    expect(api.ipSinifi).toHaveBeenLastCalledWith('10.1.2.9', { yukHost: 'GBNGXT34', hedefHost: null });
    fireEvent.change(screen.getByLabelText('Hedef IP'), { target: { value: '10.20.30.40' } });
    expect(await screen.findByText('Serbest hedef (10.20.30.0/24 izinli ağında)', {}, SINIF_BEKLE)).toBeTruthy();
    await bekle(1600); // A'nin bayat yaniti geldi
    expect(screen.queryByText(BELIRSIZ)).toBeNull();
    expect(screen.queryAllByText('IP sınıflandırılıyor…')).toHaveLength(0);
    expect(screen.getByText('Serbest hedef (10.20.30.0/24 izinli ağında)')).toBeTruthy();
    expect(okDugmesi()).toBeEnabled();
  }, 10000);

  it('YT33 (SA2) Karşılaştır: iki wrk koşusunun hız tavanı farklıysa uyarı (referans / aday sırasıyla); aynı tavanda yok', async () => {
    const K = (id: number) => ({ ...KOSU_LISTE, id, durum: 'DONE', gecerlilik: 'GECERLI', etiket: `koşu ${id}`, hedefTuru: 'sunucu', motor: 'wrk' });
    api.kosular.mockResolvedValue({ ok: true, dahaVar: false, kosular: [K(50), K(51), K(52)] });
    // 51: hedefe sonradan IP anahtarli bir zone eklendi (tavan 450 -> 90); 52: ayni tavan, farkli is parcacigi.
    const P_: Record<number, { tavan_rps: number; is_parcacigi: number }> = { 50: { tavan_rps: 450, is_parcacigi: 2 }, 51: { tavan_rps: 90, is_parcacigi: 2 }, 52: { tavan_rps: 450, is_parcacigi: 4 } };
    api.kosu.mockImplementation(async (id: number) => ({ ok: true, kosu: ayrinti({ id, motor: 'wrk', parametreler: { ...WRK_P, ...P_[id] } as NlKosuAyrinti['parametreler'] }), adimlar: [] }));
    render(<Karsilastir />);
    const ref = await screen.findByLabelText('Referans koşu');
    await within(ref).findByRole('option', { name: /^#52 / });
    const aday = screen.getByLabelText('Aday koşu');
    // Ayni tavan (450 / 450): is parcacigi uyarisi gorunur (iki ayrinti da okundu), tavan uyarisi YOK.
    fireEvent.change(ref, { target: { value: '50' } });
    fireEvent.change(aday, { target: { value: '52' } });
    expect(await screen.findByText('Koşular farklı iş parçacığı sayısıyla alınmış: karar VERİ YOK döner.')).toBeTruthy();
    expect(screen.queryByText(/^Farklı hız tavanı/)).toBeNull();
    // Farkli tavan (450 / 90): ayni baglanti kademesi farkli yuk.
    fireEvent.change(aday, { target: { value: '51' } });
    expect(await screen.findByText('Farklı hız tavanı: referans 450 istek/sn, aday 90 istek/sn — wrk’de aynı bağlantı kademesi farklı yük demektir; aynı tavanla yeniden koşun.')).toBeTruthy();
    expect(screen.queryByText(/farklı iş parçacığı/)).toBeNull();
    // Sira referans / aday secimine gore.
    fireEvent.change(aday, { target: { value: '' } });
    fireEvent.change(ref, { target: { value: '51' } });
    fireEvent.change(aday, { target: { value: '50' } });
    expect(await screen.findByText(/^Farklı hız tavanı: referans 90 istek\/sn, aday 450 istek\/sn — /)).toBeTruthy();
    // Ayrintilar bir kez okunur (kosu basina).
    expect(api.kosu.mock.calls.map((c) => c[0]).sort()).toEqual([50, 51, 52]);
  });
});
