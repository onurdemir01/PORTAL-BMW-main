// src/components/nginx_console/__tests__/yuk-testi-coklu.test.tsx — Yük Testi › Çoklu karşılaştırma (2026-11-04).
//
// CO1 cumle: karar kademesindeki CPU / p95 farkindan duz cumle (gurultu ici "değişmedi", olculmedi, hata artisi, karar sonucu)
// CO2 renk kurali: YALNIZ gurultu disi (iyi / kotu) renkli; gurultu ici / kurali yok / olculmedi soluk (saf + ekranda matris)
// CO3 siralama: CPU iyilesmesi, p95, etiket (Turkce, sayisal), tarih; olculmeyen sona; ref satiri ustte ve isaretli
// CO4 CSV: BOM, ';' ayirici, Turkce basliklar, ondalik virgul, ozet + secili olcu matrisi, formul enjeksiyonu korumasi
// CO5 URL durumu: oku / yaz (16 siniri, tekil, ref secimde degilse ilk), ekran URL'den acilir, secim degisince URL ve
//     istek guncellenir, varsayilan referans en eski; 16'da yeni secim kapali
// CO6 kuyruktan acma: "Hepsini karşılaştır" -> Çoklu karşılaştırma, ref = ilk biten oge, digerleri aday
// CO7 etiket kalemi: Admin listede ve ayrintida duzenler (PUT), İptal (Vazgeç yok), girdi kapisi; Admin olmayana kalem yok
// CO8 uyumsuz grup ve grafik lejanti: "Karşılaştırılamaz" nedenleriyle; lejant tiklaninca vurgu (aria-pressed)
// CO9 kosu ayrintisinda etiket kalemi (yalniz Admin), Enter ile kayit
// -- inceleme 2026-11-04 --
// CO10 adresteki olcu yalniz kendi anahtari: ?olcu=toString / __proto__ / constructor -> p95, ekran cokmez
// CO11 gece kuyrugu: 16'dan fazla biten kosu -> ilk 16 acilir, disarida kalanlar soylenir (MAX_COKLU); tek biten kosuda
//      "Hepsini karşılaştır" kapali
// CO12 409 listeleri ayri metinle: on kontrol / bitmemis kosu "silinmiş" denmeden cikarilir; baska kodda liste yok sayilir
// CO13 API: 409 kosu_uygun_degil / kosu_yok listeleri hataya tasinir
// -- tek tabloda karsilastirma 2026-11-04 --
// CO14 Fark metni: parcalar, yalniz referanstan farkli olan isaretli, static yok, eski kosu; normallestirme (dizin gecmez)
// CO15 sayfa notlari ve CSV fark kolonlari; ekranda vurgu ve notlar, ayni ayarda not yok
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { screen, fireEvent, waitFor, within } from '@testing-library/react';
import { useLocation } from 'react-router-dom';
import { render } from '@/test/test-utils';
import type { NlCokluAday, NlCokluHiz, NlCokluKarsilastirma, NlFark, NlKosu, NlKuyruk, NlKuyrukOge } from '@/api/nginxLoadtestApi';
import { cokluNormalle } from '@/api/nginxLoadtestApi';
import { csvMetinHucre, csvMetni, csvTarih, cumle, farkParcalari, farkYuzdeMetni, hucreTonu, karsilastirmaNotlari, seriStili, sirala, urlDurumuOku, urlDurumuYaz } from '../yukTesti/cokluKarsilastirma';
import { etiketHatasi } from '../yukTesti/EtiketDuzenle';

const api = vi.hoisted(() => ({
  hedefler: vi.fn(), senaryolar: vi.fn(), senaryo: vi.fn(), senaryoKaydet: vi.fn(), senaryoSil: vi.fn(), onKontrol: vi.fn(),
  baslat: vi.fn(), kosular: vi.fn(), kosu: vi.fn(), durum: vi.fn(), durdur: vi.fn(), yenidenOku: vi.fn(), karsilastir: vi.fn(), ipSinifi: vi.fn(),
  araclar: vi.fn(), araclariHazirla: vi.fn(), aracGeriCek: vi.fn(),
  kuyruklar: vi.fn(), kuyruk: vi.fn(), kuyrukOlustur: vi.fn(), kuyrukIptal: vi.fn(), kuyrukSira: vi.fn(), kuyrukOgeCikar: vi.fn(),
  karsilastirCoklu: vi.fn(), etiketDegistir: vi.fn(),
}));
vi.mock('@/api/nginxLoadtestApi', async (orijinal) => ({ ...(await orijinal<typeof import('@/api/nginxLoadtestApi')>()), nginxLoadtestApi: api }));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }));
vi.mock('@/hooks/useToast', () => ({ toast }));

import { YukTestiTab } from '../YukTestiTab';
import KosuAyrinti from '../yukTesti/KosuAyrinti';

const f = (durum: NlFark['durum'], yuzde: number | null, esik: number | null = 10): NlFark => ({ yuzde, durum, esikYuzde: esik, gurultuBilinmiyor: false });
const kf = (o: Partial<Record<'cpu' | 'p95' | 'bant' | 'bellek' | 'hata', NlFark | null>>) => {
  const k = (x: NlFark | null | undefined, ref: number, aday: number) => (x ? { ...x, hiz: 250, ref, aday } : null);
  return { cpu: k(o.cpu, 1, 0.88), p95: k(o.p95, 20, 20.1), bant: k(o.bant, 1e8, 1.1e8), bellek: k(o.bellek, 50, 55), hata: k(o.hata, 0, 0) };
};
function hiz(h: number, o: Partial<NlCokluHiz> = {}): NlCokluHiz {
  return {
    hiz: h, p95: 20, p99: 40, cpuMsIstek: 1, hostCpu: 30, hata: 0, kapasite: 8000, bantBps: 1e8, bellekMb: 50, bellekKaynak: 'pss', kip: 'tamam',
    gecerlilik: 'GECERLI', tekrar: 2, gecerliTekrar: 2, gurultuCpu: 0.02, gurultuP95: 0.01, ...o,
  };
}
function aday(id: number, o: Partial<NlCokluAday> = {}): NlCokluAday {
  return {
    id, etiket: `[K3] A${id}`, createdAt: `2026-11-03T2${id % 10}:00:00Z`, createdBy: 'onur', durum: 'DONE', gecerlilik: 'GECERLI', motor: 'k6', protokol: 'h1',
    hedefTuru: 'sunucu', hedefHost: 'GBNGXT33', hedefIp: '10.0.0.9', vhost: 'app', senaryoId: 1, senaryoAd: 'S', karar: 'NOTR', kararNedenleri: ['referans=R1 aday=R2'],
    kademe: { cpu: 250, p95: 250 }, hizlar: [hiz(100, { fark: { p95: f('gurultu_ici', 1), cpuMsIstek: f('iyi', -12), p99: f('renklendirilmez', -30, null) } }), hiz(250)],
    kademeFarki: kf({ cpu: f('gurultu_ici', -2), p95: f('gurultu_ici', 0.5) }), ...o,
  };
}
const VERI: NlCokluKarsilastirma = {
  ok: true,
  ref: { ...aday(1), hizlar: [hiz(100), hiz(250, { p95: 30 })] },
  adaylar: [
    aday(2, { karar: 'KALICI', kademeFarki: kf({ cpu: f('iyi', -12), p95: f('gurultu_ici', 0.4) }) }),
    aday(3, { karar: 'RET', kademeFarki: kf({ cpu: f('gurultu_ici', 1), p95: f('kotu', 14) }) }),
    aday(4, { etiket: '=HYPERLINK("x")', createdAt: 'gecersiz', kademeFarki: kf({ cpu: null, p95: f('gurultu_ici', 2) }) }),
  ],
  karsilastirilamaz: [{ ...aday(5), nedenler: [{ kod: 'motor', metin: 'Yük aracı farklı (referans k6, bu koşu wrk); k6 istek/sn, wrk bağlantı sayar.' }], karar: null }],
  esikler: { esikCpu: 10, esikP95: 10, esikZarar: 5 },
};
function kosu(id: number, o: Partial<NlKosu> = {}): NlKosu {
  return {
    id, islem: 'kosu', etiket: `[K3] A${id}`, adim: `R${id}`, hedefHost: 'GBNGXT33', hedefIp: '10.0.0.9', vhost: 'app', yukHost: 'GBNGXT34', senaryoId: 1, senaryoAd: 'S',
    durum: 'DONE', gecerlilik: 'GECERLI', createdBy: 'onur', createdAt: `2026-11-0${(id % 3) + 1}T10:00:00Z`, startedAt: null, finishedAt: null, awxJobId: 1,
    hedefTuru: 'sunucu', motor: 'k6', protokol: 'h1', ...o,
  };
}

function Konum() {
  const l = useLocation();
  return <output data-testid="konum">{l.search}</output>;
}
const konum = () => new URLSearchParams(screen.getByTestId('konum').textContent || '');

beforeEach(() => {
  for (const x of Object.values(api)) x.mockReset();
  for (const x of Object.values(toast)) x.mockReset();
  api.kosular.mockResolvedValue({ ok: true, kosular: [1, 2, 3, 4, 5].map((i) => kosu(i)), dahaVar: false });
  api.karsilastirCoklu.mockResolvedValue(VERI);
  api.kuyruklar.mockResolvedValue({ ok: true, kuyruklar: [] });
});

describe('Yük Testi — çoklu karşılaştırma', () => {
  it('CO1 düz cümle', () => {
    expect(cumle({ karar: 'KALICI', kademeFarki: kf({ cpu: f('iyi', -12.3), p95: f('gurultu_ici', 0.4) }) }))
      .toBe('Referansa göre CPU %12 daha az, p95 değişmedi (gürültü içinde) → kalıcı iyileşme');
    expect(cumle({ karar: 'RET', kademeFarki: kf({ cpu: f('kotu', 7.25), p95: f('kotu', 14) }) }))
      .toBe('Referansa göre CPU %7,3 daha fazla, p95 %14 daha yüksek → kötüleşme, değişikliği geri alın');
    expect(cumle({ karar: 'NOTR', kademeFarki: kf({ cpu: null, p95: f('iyi', -11), hata: f('kotu', null) }) }))
      .toBe('Referansa göre CPU ölçülmedi, p95 %11 daha düşük, hata arttı → anlamlı fark yok');
    expect(cumle({ karar: 'DOYMA', kademeFarki: kf({ cpu: f('yok', null), p95: f('renklendirilmez', 3) }) }))
      .toBe('Referansa göre CPU ölçülmedi, p95 değişmedi (gürültü içinde) → sınırda (doyma), daha düşük hızla yineleyin');
    expect(farkYuzdeMetni(-12.34)).toBe('−12 %');
    expect(farkYuzdeMetni(3.44)).toBe('+3,4 %');
    expect(farkYuzdeMetni(0.01)).toBe('±0 %');
    expect(farkYuzdeMetni(null)).toBe('—');
  });

  it('CO2 renk kuralı: yalnız gürültü dışı farklar renkli', async () => {
    expect([hucreTonu(f('iyi', -12)), hucreTonu(f('kotu', 9)), hucreTonu(f('gurultu_ici', -30)), hucreTonu(f('renklendirilmez', -50)), hucreTonu(f('yok', null)), hucreTonu(undefined)])
      .toEqual(['basari', 'hata', null, null, null, null]);
    render(<YukTestiTab isAdmin={false} />, { initialEntries: ['/nginx?tab=yuktesti&yt=coklu&ref=1&kosular=1,2'] });
    const matris = await screen.findByRole('table', { name: /Yanıt süresi \(p95\) matrisi/ });
    // p95 @100: gurultu ici (+1 %) soluk.
    const satir2 = within(matris).getAllByRole('row').find((r) => r.getAttribute('data-matris') === '2') as HTMLElement;
    expect(within(satir2).getAllByText('+1 %')[0].getAttribute('data-ton')).toBe('soluk');
    // CPU olcusu: -12 % iyi (renkli); p99 -30 % renklendirilmez (soluk).
    fireEvent.click(screen.getByRole('radio', { name: 'İstek başına CPU' }));
    const m2 = await screen.findByRole('table', { name: /İstek başına CPU matrisi/ });
    expect(within(m2).getAllByText('−12 %').map((x) => x.getAttribute('data-ton'))).toContain('basari');
    fireEvent.click(screen.getByRole('radio', { name: 'Yanıt süresi (p99)' }));
    const m3 = await screen.findByRole('table', { name: /Yanıt süresi \(p99\) matrisi/ });
    expect(within(m3).getAllByText('−30 %')[0].getAttribute('data-ton')).toBe('soluk');
    // Ozet: KALICI satirinda CPU farki renkli, p95 farki soluk.
    const ozet = screen.getByRole('table', { name: 'Özet karşılaştırma' });
    const r2 = ozet.querySelector('[data-aday="2"]') as HTMLElement;
    expect(within(r2).getByText('−12 %').getAttribute('data-ton')).toBe('basari');
    expect(within(r2).getByText('+0,4 %').getAttribute('data-ton')).toBe('soluk');
    expect(within(r2).getByText('Referansa göre CPU %12 daha az, p95 değişmedi (gürültü içinde) → kalıcı iyileşme')).toBeTruthy();
  });

  it('CO3 sıralama; referans satırı üstte ve işaretli', async () => {
    const id = (l: NlCokluAday[]) => l.map((a) => a.id);
    expect(id(sirala(VERI.adaylar, 'cpu'))).toEqual([2, 3, 4]);
    expect(id(sirala(VERI.adaylar, 'p95'))).toEqual([2, 4, 3]);
    const et = [aday(7, { etiket: 'A10' }), aday(8, { etiket: 'A9' }), aday(9, { etiket: 'Ç1' }), aday(6, { etiket: 'C1' })];
    expect(id(sirala(et, 'etiket'))).toEqual([8, 7, 6, 9]);
    expect(id(sirala([aday(3), aday(2, { createdAt: null }), aday(1)], 'tarih'))).toEqual([1, 3, 2]);
    expect(id(sirala([aday(6, { createdAt: 'gecersiz' }), aday(3), aday(1)], 'tarih'))).toEqual([1, 3, 6]);
    render(<><YukTestiTab isAdmin={false} /><Konum /></>, { initialEntries: ['/nginx?tab=yuktesti&yt=coklu&ref=1&kosular=1,2,3,4'] });
    const ozet = await screen.findByRole('table', { name: 'Özet karşılaştırma' });
    const sira = () => [...ozet.querySelectorAll('tbody tr')].map((r) => (r.hasAttribute('data-ref-satiri') ? 'ref' : r.getAttribute('data-aday')));
    expect(sira()).toEqual(['ref', '2', '3', '4']);
    expect(within(ozet.querySelector('[data-ref-satiri]') as HTMLElement).getByText('REFERANS')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Sıralama'), { target: { value: 'p95' } });
    await waitFor(() => expect(sira()).toEqual(['ref', '2', '4', '3']));
    expect(konum().get('sira')).toBe('p95');
  });

  it('CO4 CSV içeriği', () => {
    const metin = csvMetni(VERI, 'p95', sirala(VERI.adaylar, 'cpu'));
    expect(metin.charCodeAt(0)).toBe(0xfeff);
    const satirlar = metin.slice(1).split(String.fromCharCode(13, 10));
    expect(satirlar[0]).toBe('Koşu;Etiket;Rol;Tarih;Karar;Açıklama;CPU kademesi;CPU-ms/istek farkı %;p95 kademesi;p95 farkı %;Test trafiği farkı %;Bellek farkı %;Fark;Protokol;Keepalive;Sıkıştırma;Seviye;Static;Referanstan farklı');
    expect(satirlar[1]).toBe(`#1;[K3] A1;Referans;${csvTarih('2026-11-03T21:00:00Z')};;;;;;;;;HTTP/1.1;HTTP/1.1;;;;;`);
    expect(csvTarih('2026-11-03T21:00:00Z')).toMatch(/^2026-11-0[34] \d\d:00$/);
    expect([csvTarih(null), csvTarih('gecersiz')]).toEqual(['', '']);
    expect(satirlar[2]).toBe(`#2;[K3] A2;Aday;${csvTarih('2026-11-03T22:00:00Z')};KALICI;Referansa göre CPU %12 daha az, p95 değişmedi (gürültü içinde) → kalıcı iyileşme;250;-12;250;0,4;;;HTTP/1.1;HTTP/1.1;;;;;`);
    // Formul enjeksiyonu: '=' ile baslayan etiket tek tirnakla, tirnak iceren hucre tirnaklanir.
    expect(satirlar.find((s) => s.startsWith('#4;'))).toContain(`;"'=HYPERLINK(""x"")";`);
    expect(satirlar.find((s) => s.startsWith('#5;'))).toContain('Karşılaştırılamaz');
    const bas = satirlar.indexOf('Yanıt süresi (p95) (ms)');
    expect(bas).toBeGreaterThan(0);
    expect(satirlar[bas + 1]).toBe('Hız;#1 [K3] A1 (referans);#2 [K3] A2;Fark %;#3 [K3] A3;Fark %;#4 =HYPERLINK("x");Fark %'.replace('#4 =HYPERLINK("x")', '"#4 =HYPERLINK(""x"")"'));
    expect(satirlar[bas + 2]).toBe('100;20;20;1;20;1;20;1');
    expect(satirlar[bas + 3]).toBe('250;30;20;;20;;20;');
    expect(csvMetinHucre('+cmd')).toBe("'+cmd");
    expect(csvMetinHucre('-2+3')).toBe("'-2+3");
    expect(csvMetinHucre('@SUM(A1)')).toBe("'@SUM(A1)");
    expect(csvMetinHucre(`${String.fromCharCode(9)}=1`)).toBe(`'${String.fromCharCode(9)}=1`);
    expect(csvMetinHucre(`${String.fromCharCode(13)}x`)).toBe(`"'${String.fromCharCode(13)}x"`);
    expect(csvMetinHucre('A-1')).toBe('A-1');
    expect(csvMetinHucre('a;b')).toBe('"a;b"');
    // Hata olcusu oran olarak (ondalik virgul).
    const h = csvMetni({ ...VERI, ref: { ...VERI.ref, hizlar: [hiz(100, { hata: 0.0012 })] }, adaylar: [] }, 'hata');
    expect(h).toContain('Hata oranı (oran)');
    expect(h).toContain('100;0,0012');
  });

  it('CO5 URL durumu: oku / yaz, ekrandan seçim, varsayılan referans, 16 sınırı', async () => {
    const d = urlDurumuOku(new URLSearchParams('ref=9&kosular=3,3,x,0,5,9&olcu=bilinmez&sira=etiket'));
    expect(d).toEqual({ ref: 9, kosular: [3, 5, 9], olcu: 'p95', sira: 'etiket' });
    expect(urlDurumuOku(new URLSearchParams('ref=7&kosular=3,5')).ref).toBe(3);
    expect(urlDurumuOku(new URLSearchParams(`kosular=${Array.from({ length: 20 }, (_, i) => i + 1).join(',')}`)).kosular).toHaveLength(16);
    const y = urlDurumuYaz(new URLSearchParams('tab=x&baska=1'), { ref: 5, kosular: [3, 5], olcu: 'cpuMsIstek', sira: 'cpu' });
    expect(y.toString()).toBe('tab=yuktesti&baska=1&yt=coklu&kosular=3%2C5&ref=5&olcu=cpuMsIstek&sira=cpu');

    render(<><YukTestiTab isAdmin={false} /><Konum /></>, { initialEntries: ['/nginx?tab=yuktesti&yt=coklu&ref=1&kosular=1,2,3'] });
    expect(await screen.findByRole('tab', { name: /Çoklu karşılaştırma/, selected: true })).toBeTruthy();
    await waitFor(() => expect(api.karsilastirCoklu).toHaveBeenCalledWith({ ref: 1, kosular: [2, 3] }));
    // Yeni kosu secilir: URL ve istek guncellenir.
    fireEvent.click(await screen.findByRole('checkbox', { name: '[K3] A4 seç' }));
    await waitFor(() => expect(konum().get('kosular')).toBe('1,2,3,4'));
    await waitFor(() => expect(api.karsilastirCoklu).toHaveBeenLastCalledWith({ ref: 1, kosular: [2, 3, 4] }));
    // Referans secimden cikarilinca en eski kalan referans olur (kosu 3: 2026-11-01).
    fireEvent.click(screen.getByRole('button', { name: '[K3] A1 seçimden çıkar' }));
    await waitFor(() => expect(konum().get('ref')).toBe('3'));
    // Referans elle degisir.
    fireEvent.click(screen.getByRole('radio', { name: '[K3] A2 referans' }));
    await waitFor(() => expect(konum().get('ref')).toBe('2'));
    await waitFor(() => expect(api.karsilastirCoklu).toHaveBeenLastCalledWith({ ref: 2, kosular: [3, 4] }));
    // Etiket aramasi listeyi suzer.
    fireEvent.change(screen.getByLabelText('Etiket ara'), { target: { value: 'a5' } });
    expect(screen.getAllByRole('checkbox')).toHaveLength(1);
  });

  it('CO5b 16 seçili iken yeni seçim kapalı; tek seçimde istek yok', async () => {
    api.kosular.mockResolvedValue({ ok: true, kosular: Array.from({ length: 17 }, (_, i) => kosu(i + 1)), dahaVar: false });
    const hepsi = Array.from({ length: 16 }, (_, i) => i + 1).join(',');
    render(<YukTestiTab isAdmin={false} />, { initialEntries: [`/nginx?tab=yuktesti&yt=coklu&ref=1&kosular=${hepsi}`] });
    const k17 = await screen.findByRole('checkbox', { name: '[K3] A17 seç' });
    expect(k17).toBeDisabled();
    expect(screen.getByText(/En çok 16 koşu seçilebilir/)).toBeTruthy();
    expect(screen.getByRole('checkbox', { name: '[K3] A16 seç' })).toBeEnabled();
    await waitFor(() => expect(api.karsilastirCoklu).toHaveBeenCalledTimes(1));
    expect(api.karsilastirCoklu.mock.calls[0][0].kosular).toHaveLength(15);
  });

  it('CO5c yalnız referans seçiliyken istek gitmez, yönlendirme yazısı görünür', async () => {
    render(<YukTestiTab isAdmin={false} />, { initialEntries: ['/nginx?tab=yuktesti&yt=coklu&ref=1&kosular=1'] });
    expect(await screen.findByText('Referansın yanında en az bir koşu daha seçin.')).toBeTruthy();
    await screen.findByRole('checkbox', { name: '[K3] A2 seç' });
    expect(api.karsilastirCoklu).not.toHaveBeenCalled();
  });

  it('CO6 kuyruktan "Hepsini karşılaştır": ref = ilk biten öğe', async () => {
    const kuyruk = { id: 7, ad: null, durum: 'BITTI', beklemeDk: 5, baslangicAt: null, enGecBitis: null, onayHedefi: 'GBNGXT33', hedefTuru: 'sunucu', onaylananTurler: [], createdBy: 'onur', createdAt: null, iptalEden: null, iptalAt: null, bitisAt: null, sonHata: null, dinlenmeKosuId: null, dinlenmeBitis: null, ogeSayisi: 3, bitenSayisi: 2 } as NlKuyruk;
    const oge = (id: number, kosuId: number | null, durum: NlKuyrukOge['durum']) => ({ id, sira: id, etiket: `A${id}`, durum, asama: 'kosu', onKontrolKosuId: null, kosuId, neden: null, butceSn: 600, uyariTurleri: [], baslamaAt: null, bitisAt: null, ayar: { senaryoId: 1, hedefIp: null, hedefHost: null, vhost: null, yukHost: null, parametreler: null } }) as NlKuyrukOge;
    api.kuyruklar.mockResolvedValue({ ok: true, kuyruklar: [kuyruk] });
    // Kosu numarasi olan ama BITTI olmayan oge (HATALI / IPTAL) karsilastirmaya gitmez.
    api.kuyruk.mockResolvedValue({ ok: true, kuyruk, ogeler: [oge(1, 3, 'BITTI'), oge(2, null, 'ATLANDI'), oge(3, 5, 'BITTI'), oge(5, 8, 'HATALI'), oge(6, 9, 'IPTAL'), oge(4, 2, 'BITTI')] });
    render(<><YukTestiTab isAdmin /><Konum /></>, { initialEntries: ['/nginx?tab=yuktesti'] });
    fireEvent.click(await screen.findByRole('tab', { name: /Gece kuyruğu/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Kuyruk #7' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Hepsini karşılaştır' }));
    expect(await screen.findByRole('tab', { name: /Çoklu karşılaştırma/, selected: true })).toBeTruthy();
    await waitFor(() => expect(api.karsilastirCoklu).toHaveBeenCalledWith({ ref: 3, kosular: [5, 2] }));
    expect(konum().get('ref')).toBe('3');
    expect(konum().get('kosular')).toBe('3,5,2');
    expect(konum().get('yt')).toBe('coklu');
    // Baska alt gorunume gecince yt kalkar.
    fireEvent.click(screen.getByRole('tab', { name: /Koşular/ }));
    await waitFor(() => expect(konum().get('yt')).toBeNull());
  });

  it('CO7 etiket kalemi: Admin düzenler, İptal, girdi kapısı; Admin olmayana kalem yok', async () => {
    expect(etiketHatasi('a'.repeat(120))).toBeNull();
    expect(etiketHatasi('a'.repeat(121))).toMatch(/120/);
    expect(etiketHatasi(`a${String.fromCharCode(10)}b`)).toMatch(/kontrol/);
    expect(etiketHatasi(`a${String.fromCharCode(0x2028)}b`)).toMatch(/kontrol/);
    api.etiketDegistir.mockResolvedValue({ ok: true, id: 2, etiket: '[K3] A2 brotli 4' });
    const { unmount } = render(<YukTestiTab isAdmin />);
    fireEvent.click(await screen.findByRole('button', { name: 'Koşu 2 etiketini düzenle' }));
    const girdi = screen.getByRole('textbox', { name: 'Yeni etiket' });
    fireEvent.change(girdi, { target: { value: 'x'.repeat(121) } });
    expect(screen.getByRole('button', { name: 'Kaydet' })).toBeDisabled();
    expect(screen.getByRole('alert').textContent).toMatch(/120/);
    fireEvent.click(screen.getByRole('button', { name: 'İptal' }));
    expect(screen.queryByRole('textbox', { name: 'Yeni etiket' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Vazgeç/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Koşu 2 etiketini düzenle' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Yeni etiket' }), { target: { value: ' [K3] A2 brotli 4 ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Kaydet' }));
    await waitFor(() => expect(api.etiketDegistir).toHaveBeenCalledWith(2, '[K3] A2 brotli 4'));
    expect(await screen.findByText('[K3] A2 brotli 4')).toBeTruthy();
    expect(api.kosu).not.toHaveBeenCalled();
    // Sunucu reddi satirda gorunur.
    api.etiketDegistir.mockResolvedValue({ ok: false, code: 'kosu_yok', message: 'Koşu bulunamadı.' });
    fireEvent.click(screen.getByRole('button', { name: 'Koşu 3 etiketini düzenle' }));
    fireEvent.click(screen.getByRole('button', { name: 'Kaydet' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Koşu bulunamadı.');
    unmount();
    render(<YukTestiTab isAdmin={false} />);
    await screen.findByRole('button', { name: 'Koşu 2 ayrıntısı' });
    expect(screen.queryByRole('button', { name: /etiketini düzenle/ })).toBeNull();
  });

  it('CO9 koşu ayrıntısında etiket kalemi (yalnız Admin); kayıt başlığı yerinde günceller', async () => {
    const ayrinti = {
      ...kosu(2, { etiket: null }), parametreler: { motor: 'k6', hizlar: [100], maxvu: 150, tekrar: 2, isinma: 30, sure: 120, bosluk: 30, bosta: 60, kip: 'ka', ae: 'br' },
      onKontrol: null, gecersizNedenleri: [], sonucOzet: null, onKontrolKosuId: 1, sunucuDegerlendirmesi: null, onKontrolYasSn: null, isDurumu: 'OK', isHatasi: null,
      analiz: { nproc: 8, cpuTlsliPay: null, uyarilar: [], okumaHatasi: null }, durdurIsi: null, sonuclandirmaDenemesi: 0, aracId: null, aracSeti: null, sonucOzeti: null, serbestAg: null, planUyarilari: [],
    };
    api.kosu.mockResolvedValue({ ok: true, kosu: ayrinti, adimlar: [] });
    api.etiketDegistir.mockResolvedValue({ ok: true, id: 2, etiket: 'A2 gzip 6' });
    const { unmount } = render(<KosuAyrinti kosuId={2} isAdmin onGeri={vi.fn()} />);
    expect(await screen.findByText('etiketsiz')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Koşu 2 etiketini düzenle' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Yeni etiket' }), { target: { value: 'A2 gzip 6' } });
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Yeni etiket' }), { key: 'Enter' });
    await waitFor(() => expect(api.etiketDegistir).toHaveBeenCalledWith(2, 'A2 gzip 6'));
    expect(await screen.findByText('A2 gzip 6')).toBeTruthy();
    unmount();
    render(<KosuAyrinti kosuId={2} isAdmin={false} onGeri={vi.fn()} />);
    await screen.findByText(/Koşu #2|#2/);
    expect(screen.queryByRole('button', { name: /etiketini düzenle/ })).toBeNull();
  });

  it('CO8 karşılaştırılamaz grubu, grafik lejantı vurgusu, 16 çizgi stili, normalleştirme', async () => {
    render(<YukTestiTab isAdmin={false} />, { initialEntries: ['/nginx?tab=yuktesti&yt=coklu&ref=1&kosular=1,2,3,4,5'] });
    const grup = await screen.findByText('Karşılaştırılamaz (1)');
    expect(within(grup.parentElement as HTMLElement).getByText(/Yük aracı farklı/)).toBeTruthy();
    const lejant = screen.getByRole('list', { name: /Lejant/ });
    const b = within(lejant).getByRole('button', { name: '[K3] A3' });
    expect(within(lejant).getByRole('button', { name: '[K3] A1 (referans)' })).toBeTruthy();
    fireEvent.click(b);
    expect(b.getAttribute('aria-pressed')).toBe('true');
    expect(document.querySelector('[data-seri="2"]')?.getAttribute('opacity')).toBe('0.18');
    expect(document.querySelector('[data-seri="3"]')?.getAttribute('opacity')).toBe('1');
    fireEvent.click(b);
    expect(b.getAttribute('aria-pressed')).toBe('false');
    // 16 cizgi: 8 ton x duz / kesikli, ref kalin; ikili (ton, kesik) tekrarsiz.
    const stiller = Array.from({ length: 15 }, (_, i) => seriStili(i));
    expect(new Set(stiller.map((s) => `${s.renk}|${s.kesik}`)).size).toBe(15);
    expect(seriStili(0, true)).toEqual({ renk: 'var(--text-primary)', kalinlik: 3.5, kesik: undefined });
    // Normallestirme: metin sayi -> sayi, bilinmeyen durum -> 'yok', eksik alan null.
    const n = cokluNormalle({ ref: { id: '1', hizlar: [{ hiz: '100', p95: '12.5' }] }, adaylar: [{ id: 2, karar: 'KALICI', hizlar: [{ hiz: 100, fark: { p95: { yuzde: '-3', durum: 'x' } } }], kademeFarki: { cpu: { hiz: 100, yuzde: -5, durum: 'iyi' } } }] });
    expect([n.ref.id, n.ref.hizlar[0].p95, n.ref.hizlar[0].bantBps, n.adaylar[0].hizlar[0].fark?.p95?.durum, n.adaylar[0].hizlar[0].fark?.p95?.yuzde, n.adaylar[0].kademeFarki.cpu?.durum, n.adaylar[0].kademeFarki.p95])
      .toEqual([1, 12.5, null, 'yok', -3, 'iyi', null]);
  });

  it('CO10 adresteki ölçü yalnız kendi anahtarı: toString / __proto__ / constructor p95 olur, ekran çökmez', async () => {
    for (const o of ['toString', '__proto__', 'constructor', 'hasOwnProperty', 'valueOf']) {
      expect(urlDurumuOku(new URLSearchParams(`kosular=1,2&olcu=${o}`)).olcu).toBe('p95');
    }
    expect(urlDurumuOku(new URLSearchParams('kosular=1,2&olcu=bellekMb')).olcu).toBe('bellekMb');
    render(<YukTestiTab isAdmin={false} />, { initialEntries: ['/nginx?tab=yuktesti&yt=coklu&ref=1&kosular=1,2&olcu=toString'] });
    expect(await screen.findByRole('table', { name: /Yanıt süresi \(p95\) matrisi/ })).toBeTruthy();
  });

  it('CO11 gece kuyruğu: 16’dan fazla biten koşu → ilk 16 açılır, dışarıda kalanlar söylenir; tek biten koşuda düğme kapalı', async () => {
    const kuyruk = { id: 8, ad: null, durum: 'BITTI', beklemeDk: 5, baslangicAt: null, enGecBitis: null, onayHedefi: 'GBNGXT33', hedefTuru: 'sunucu', onaylananTurler: [], createdBy: 'onur', createdAt: null, iptalEden: null, iptalAt: null, bitisAt: null, sonHata: null, dinlenmeKosuId: null, dinlenmeBitis: null, ogeSayisi: 18, bitenSayisi: 18 } as NlKuyruk;
    const oge = (id: number, kosuId: number | null, durum: NlKuyrukOge['durum']) => ({ id, sira: id, etiket: `A${id}`, durum, asama: 'kosu', onKontrolKosuId: null, kosuId, neden: null, butceSn: 600, uyariTurleri: [], baslamaAt: null, bitisAt: null, ayar: { senaryoId: 1, hedefIp: null, hedefHost: null, vhost: null, yukHost: null, parametreler: null } }) as NlKuyrukOge;
    api.kuyruklar.mockResolvedValue({ ok: true, kuyruklar: [kuyruk] });
    api.kuyruk.mockResolvedValue({ ok: true, kuyruk, ogeler: Array.from({ length: 18 }, (_, i) => oge(i + 1, 101 + i, 'BITTI')) });
    const { unmount } = render(<><YukTestiTab isAdmin /><Konum /></>, { initialEntries: ['/nginx?tab=yuktesti'] });
    fireEvent.click(await screen.findByRole('tab', { name: /Gece kuyruğu/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Kuyruk #8' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Hepsini karşılaştır' }));
    await waitFor(() => expect(konum().get('kosular')).toBe(Array.from({ length: 16 }, (_, i) => 101 + i).join(',')));
    expect(konum().get('ref')).toBe('101');
    const not = await screen.findByText('Gece kuyruğundan ilk 16 koşu alındı; 2 koşu dışarıda kaldı');
    const kutu = not.closest('[role="status"]') as HTMLElement;
    expect(kutu.textContent).toMatch(/Dışarıda kalanlar: #117, #118/);
    fireEvent.click(within(kutu).getByRole('button', { name: 'Kapat' }));
    expect(screen.queryByText(/koşu dışarıda kaldı/)).toBeNull();
    unmount();
    // Tek biten kosu: dugme kapali (karsilastirma en az iki kosu ister).
    api.kuyruk.mockResolvedValue({ ok: true, kuyruk, ogeler: [oge(1, 101, 'BITTI'), oge(2, 102, 'HATALI'), oge(3, null, 'ATLANDI')] });
    render(<YukTestiTab isAdmin />, { initialEntries: ['/nginx?tab=yuktesti'] });
    fireEvent.click(await screen.findByRole('tab', { name: /Gece kuyruğu/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Kuyruk #8' }));
    expect(await screen.findByRole('button', { name: 'Hepsini karşılaştır' })).toBeDisabled();
  });

  it('CO12 409 listeleri ayrı metinle: ön kontrol / bitmemiş koşu “silinmiş” denmeden çıkarılır', async () => {
    api.karsilastirCoklu.mockImplementation(async (o: { ref: number; kosular: number[] }) => {
      if (o.kosular.includes(3) || o.kosular.includes(4)) throw Object.assign(new Error('Karşılaştırılamayan koşu numarası'), { status: 409, code: 'kosu_uygun_degil', onKontrol: [3], bitmemis: [4] });
      return VERI;
    });
    render(<><YukTestiTab isAdmin={false} /><Konum /></>, { initialEntries: ['/nginx?tab=yuktesti&yt=coklu&ref=1&kosular=1,2,3,4'] });
    await waitFor(() => expect(konum().get('kosular')).toBe('1,2'));
    expect(konum().get('ref')).toBe('1');
    expect(await screen.findByText('Ön kontrol kaydı çıkarıldı: #3')).toBeTruthy();
    expect(screen.getByText('Bitmemiş koşu çıkarıldı: #4')).toBeTruthy();
    expect(screen.queryByText(/Silinmiş koşu çıkarıldı/)).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    await waitFor(() => expect(api.karsilastirCoklu).toHaveBeenLastCalledWith({ ref: 1, kosular: [2] }));
    // Baska koddaki hata (424) listeleri dikkate alinmaz: hata gosterilir, secim degismez.
    api.karsilastirCoklu.mockRejectedValue(Object.assign(new Error('Analiz okunamadı'), { status: 424, code: 'analiz_okunamadi', eksik: [2] }));
    fireEvent.click(await screen.findByRole('checkbox', { name: '[K3] A5 seç' }));
    expect(await screen.findByText('Analiz okunamadı')).toBeTruthy();
    expect(konum().get('kosular')).toBe('1,2,5');
  });

  it('CO13 API: 409 kosu_uygun_degil / kosu_yok listeleri hataya taşınır', async () => {
    const gercek = (await vi.importActual<typeof import('@/api/nginxLoadtestApi')>('@/api/nginxLoadtestApi')).nginxLoadtestApi;
    const yanit = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
    const f = vi.fn();
    vi.stubGlobal('fetch', f);
    try {
      f.mockResolvedValueOnce(yanit(409, { ok: false, code: 'kosu_uygun_degil', message: 'm', eksik: [], onKontrol: [3, 'x'], bitmemis: [4] }));
      const e = await gercek.karsilastirCoklu({ ref: 1, kosular: [3, 4] }).catch((x) => x);
      expect([e.code, e.eksik, e.onKontrol, e.bitmemis]).toEqual(['kosu_uygun_degil', undefined, [3], [4]]);
      f.mockResolvedValueOnce(yanit(409, { ok: false, code: 'kosu_yok', message: 'm', eksik: [9], onKontrol: [3], bitmemis: [] }));
      const e2 = await gercek.karsilastirCoklu({ ref: 1, kosular: [3, 9] }).catch((x) => x);
      expect([e2.eksik, e2.onKontrol, e2.bitmemis]).toEqual([[9], [3], undefined]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  const H2: Partial<NlCokluAday> = { protokol: 'h2', kip: 'ka', ae: 'gzip', sunucuAyar: { seviye: 4, static: true } };
  const REF: Partial<NlCokluAday> = { protokol: 'h1', kip: 'yeni', ae: 'br', sunucuAyar: { seviye: 6, static: false } };
  const metin = (l: { metin: string }[]) => l.map((p) => p.metin).join(' · ');

  it('CO14 Fark metni ve normalleştirme', () => {
    const ref = aday(1, REF);
    const a = aday(2, H2);
    const p = farkParcalari(a, ref);
    expect(metin(p)).toBe('HTTP/2 · keepalive · gzip 4 · static');
    expect(p.map((x) => x.farkli)).toEqual([true, true, true, true]);
    expect(metin(farkParcalari(ref, ref))).toBe('HTTP/1.1 · keepalive yok · brotli 6');
    expect(farkParcalari(ref, ref).some((x) => x.farkli)).toBe(false);
    // Yalniz seviye farki sikistirma parcasini isaretler.
    const s4 = farkParcalari(aday(3, { ...REF, sunucuAyar: { seviye: 4, static: false } }), ref);
    expect(s4.filter((x) => x.farkli).map((x) => x.metin)).toEqual(['brotli 4']);
    // Referans static, aday degil: "static yok" farkli.
    const sy = farkParcalari(ref, a).find((x) => x.tur === 'static');
    expect([sy?.metin, sy?.farkli]).toEqual(['static yok', true]);
    // Sikistirmasiz seviyesiz; eski kosu (kip / ae yok) fark sayilmaz.
    expect(metin(farkParcalari(aday(4, { ae: 'identity', kip: 'ka' }), ref))).toBe('HTTP/1.1 · keepalive · sıkıştırmasız');
    expect(farkParcalari(aday(5), ref)).toEqual([{ tur: 'protokol', metin: 'HTTP/1.1', farkli: false }]);
    expect(farkParcalari(ref, aday(5)).filter((x) => x.farkli)).toEqual([]);
    // Bilinmeyen sunucu ayari fark sayilmaz: referans eski ("brotli") ile "brotli 6" ayni; referans icin "static yok" varsayilmaz.
    const eski = aday(6, { kip: 'yeni', ae: 'br', sunucuAyar: null });
    const bilinen = aday(7, { kip: 'yeni', ae: 'br', sunucuAyar: { seviye: 6, static: true } });
    expect(farkParcalari(bilinen, eski).filter((x) => x.farkli)).toEqual([]);
    expect(metin(farkParcalari(bilinen, eski))).toBe('HTTP/1.1 · keepalive yok · brotli 6 · static');
    expect(farkParcalari(eski, bilinen).filter((x) => x.farkli)).toEqual([]);
    expect(metin(farkParcalari(eski, bilinen))).toBe('HTTP/1.1 · keepalive yok · brotli');
    // Sikistirma turu farki sunucu ayari bilinmese de farktir.
    expect(farkParcalari(aday(8, { ae: 'gzip', sunucuAyar: null }), bilinen).find((x) => x.tur === 'sikistirma')?.farkli).toBe(true);
    const n = cokluNormalle({ ref: { id: 1, kip: 'ka', ae: 'br', sunucuAyar: { seviye: 6, static: true, dizin: '/x' } }, adaylar: [{ id: 2, kip: 'x', ae: 'y', sunucuAyar: 'z' }], karsilastirilamaz: [] });
    expect([n.ref.kip, n.ref.ae, n.ref.sunucuAyar]).toEqual(['ka', 'br', { seviye: 6, static: true }]);
    expect([n.adaylar[0].kip, n.adaylar[0].ae, n.adaylar[0].sunucuAyar]).toEqual([null, null, null]);
  });

  it('CO15 sayfa notları, CSV fark kolonları, ekranda vurgu', async () => {
    const FARKLI = 'Farklı protokol / sıkıştırma karşılaştırılıyor; karar yalnız referansa göredir.';
    const ref = { ...aday(1, REF), hizlar: [hiz(100), hiz(250)] };
    expect(karsilastirmaNotlari({ ref, adaylar: [aday(2, REF)] })).toEqual([]);
    expect(karsilastirmaNotlari({ ref, adaylar: [aday(2, H2)] })).toEqual([FARKLI]);
    const tek = karsilastirmaNotlari({ ref, adaylar: [aday(2, { ...REF, hizlar: [hiz(100, { tekrar: 1 })] })] });
    expect(tek).toHaveLength(1);
    expect(tek[0]).toMatch(/gürültü ölçülmedi: yüzde birkaçlık fark kesin değildir/);
    const v: NlCokluKarsilastirma = { ...VERI, ref, adaylar: [aday(2, H2)], karsilastirilamaz: [{ ...aday(5, H2), nedenler: [{ kod: 'motor', metin: 'x' }], karar: null }] };
    const st = csvMetni(v, 'p95').slice(1).split(String.fromCharCode(13, 10));
    expect(st[1].endsWith(';HTTP/1.1 · keepalive yok · brotli 6;HTTP/1.1;hayır;brotli;6;hayır;')).toBe(true);
    expect(st[2].endsWith(';HTTP/2 · keepalive · gzip 4 · static;HTTP/2;evet;gzip;4;evet;HTTP/2, keepalive, gzip 4, static')).toBe(true);
    expect(st[3].split(';')).toHaveLength(st[0].split(';').length);
    api.karsilastirCoklu.mockResolvedValue(v);
    render(<YukTestiTab isAdmin={false} />, { initialEntries: ['/nginx?tab=yuktesti&yt=coklu&ref=1&kosular=1,2,5'] });
    expect(await screen.findByText(FARKLI)).toBeTruthy();
    const tablo = screen.getByRole('table', { name: 'Özet karşılaştırma' });
    expect(within(tablo).getByRole('columnheader', { name: 'Fark' })).toBeTruthy();
    const refSatir = tablo.querySelector('[data-ref-satiri]') as HTMLElement;
    expect(refSatir.querySelector('[data-kosu-farki]')?.textContent).toBe('HTTP/1.1 · keepalive yok · brotli 6');
    expect(refSatir.querySelector('[data-farkli]')).toBeNull();
    const satir = tablo.querySelector('[data-aday="2"]') as HTMLElement;
    expect(satir.querySelector('[data-kosu-farki]')?.textContent).toBe('HTTP/2 · keepalive · gzip 4 · static');
    expect(satir.querySelectorAll('[data-farkli]')).toHaveLength(4);
    expect(document.querySelector('[data-matris="2"] [data-kosu-farki]')?.textContent).toBe('HTTP/2 · keepalive · gzip 4 · static');
    expect(document.querySelector('[data-karsilastirilamaz] [data-kosu-farki]')).toBeTruthy();
  });
});
