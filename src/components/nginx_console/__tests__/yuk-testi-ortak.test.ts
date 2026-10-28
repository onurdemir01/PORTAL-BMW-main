// src/components/nginx_console/__tests__/yuk-testi-ortak.test.ts — Yük Testi saf yardimcilari (2026-10-27).
//
// YO1 butce formulu (sozlesme 3) ve 2700 sn siniri; YO2 hedefin limit_req'i sinirlari DARALTIR, genisletmez;
// YO3 artimli cikti: ofsetle yerlestirme, ofsetsiz tam metin / parca, yinelenme yok; YO4 on kontrol: sunucu listesi
// varsa o esas, yoksa ayni kurallar istemcide, set_stats durum != OK engel; YO5 hiz gruplamasi karsilastir.py
// kurali (CPU yalniz GECERLI, p95 GECERSIZ disi); YO6 normallestirme: olculmeyen deger null (asla 0), camel/snake.
// Inceleme duzeltmeleri (2026-10-27, S7): YO2b olculmus limit 0 "deger yok" degil; YO4c basarisiz on kontrolun
// ASIL nedeni engel, okunamayan log dizini ENGEL; YO7 adim tekrar / uyari / pencere kaynagi ve etiket-sira; YO8 kosu
// ayrintisi durdurIsi + sonuclandirmaDenemesi; YO9 OKUNAMADI metni (otomatik yeniden okuma vaadi YOK), dugme
// kosullari, durdur hata metni; YO10 liste suzgeci / sayfalama ve yeniden-oku ucu (fetch duzeyinde).
// Tur 3 (2026-10-28, elle hedef IP + wrk + D7): YO11 butce wrk (hizlar'siz p cokmez) ve adimDegerleri; YO12 wrk parametre
// denetimi (her mesaj, N%T, olculmus sifir sinir); YO13 on kontrol normallestirmesi yeni alanlar; YO14 geri donus
// degerlendirmesi (D7 server_name UYARI, wrk iki metin, serbestte hedef kurali yok); YO15 kosu normallestirmesi tur / motor
// varsayilanlari ve wrk parametreleri, durdur metni; YO16 liste suzgeci ip / hedefTuru / motor; YO17 /ip-sinifi istemcisi;
// YO18 serbest sinir daraltmasi ve wrk tavani; YO19 sozlesme 11 neden metinleri.
// Tur 3 incelemesi (2026-10-28): YO20 (WR2) wrk uyarisi tavanin ORTALAMA hizi sinirladigini, kumelenmeyi ve burst / 429
// riskini soyler ("aşamaz" demez); YO21 (UI1) hic yol denenmediyse olculmemis sikistirma sifirlari bilgi satirinda yok.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { adimNormalle, hedeflerNormalle, kosuNormalle, nginxLoadtestApi, onKontrolNormalle, type NlAdim, type NlKosuAyrinti, type NlSinirlar } from '@/api/nginxLoadtestApi';
import {
  GECERLILIK, HOST_LISTEDE_YOK_UYARISI, OKUNAMADI_ACIKLAMASI, SERBEST_ON_KONTROL_BILGISI, SERBEST_UYARISI, SINIR_SIFIR_METNI, WRK_UYARISI, adimDegerleri, adimEtiketi,
  adimSirala, baglantiBeklemesiMs, baglantilariAyristir, butceSn, ciktiBirlestir, durdurBaslatilamadiMetni, hedefEtiketi, hedefSinirlari, hizGrupla, hizlariAyristir,
  ipGecerli, kademeMetni, kalanSurecDurdurulabilir, motorOf, nedenMetni, onKontrolDegerlendir, onKontrolKalanMs, parametreHatalari, sonucOkunuyorMetni, tavanNedeni,
  tavanRps, uyarilariAyir, yenidenOkunabilir, ON_KONTROL_OMRU_MS,
} from '../yukTesti/yukTestiOrtak';

// sureMin 40 (2026-10-27, analiz-1): analiz penceresi [ilk+3, son-2] ve >= 30 sn ister; 30-36 sn her adimi GECERSIZ yapiyordu.
// Tur 3 alanlari (wrk + serbest) sunucunun SINIRLAR'iyla ayni.
const S: NlSinirlar = {
  maxHiz: 450, maxTekrar: 3, sureMin: 40, sureMax: 300, isinmaMax: 60, maxVu: 199, maxButceSn: 2700,
  baglantiMin: 1, maxBaglanti: 199, maxBaglantiSayisi: 5, isParcacigiMin: 1, maxIsParcacigi: 16, serbestTavanRps: 200, serbestMaxBaglanti: 50,
};
const P = { motor: 'k6' as const, hizlar: [100, 250, 400], tekrar: 2, isinma: 30, sure: 120, bosluk: 30, bosta: 60, maxvu: 150, kip: 'yeni' as const, ae: 'br' as const };
/** wrk kanonik parametresi: `hizlar` / `maxvu` YOK (sozlesme 9). */
const W = { motor: 'wrk' as const, baglantilar: [2, 4, 8], is_parcacigi: 2, tekrar: 2, isinma: 30, sure: 120, bosluk: 30, bosta: 60, kip: 'yeni' as const, ae: 'br' as const };
const SERBEST = { hedefTuru: 'serbest' as const };

describe('Yük Testi — saf yardımcılar', () => {
  it('YO1 bütçe = boşta + hız x tekrar x (ısınma + süre + bekleme + 20) + 120; 2700 sn üstü hata', () => {
    expect(butceSn(P)).toBe(60 + 3 * 2 * (30 + 120 + 30 + 20) + 120);
    expect(parametreHatalari(P, S)).toEqual({});
    expect(parametreHatalari({ ...P, tekrar: 3, sure: 300 }, S).butce).toMatch(/üst sınır 45 dk/);
    expect(parametreHatalari({ ...P, hizlar: [100, 500] }, S).hizlar).toMatch(/1–450/);
    expect(parametreHatalari({ ...P, hizlar: [100, 100] }, S).hizlar).toMatch(/iki kez/);
    expect(parametreHatalari({ ...P, hizlar: [1, 2, 3, 4, 5, 6] }, S).hizlar).toBeTruthy();
    expect(parametreHatalari({ ...P, maxvu: 200 }, S).maxvu).toBeTruthy();
    expect(parametreHatalari({ ...P, bosta: 20 }, S).bosta).toBeTruthy();
    // Olcum suresi alt siniri sunucunun sinirlarindan (40): 39 red, 40 kabul.
    expect(parametreHatalari({ ...P, sure: 39 }, S).sure).toBe('40–300 sn');
    expect(parametreHatalari({ ...P, sure: 40 }, S).sure).toBeUndefined();
    expect(hizlariAyristir('100 250,400')).toEqual([100, 250, 400]);
    expect(hizlariAyristir('100 abc')).toBeNull();
    expect(hizlariAyristir('1000')).toBeNull();
  });

  it('YO2 hedef sınırı daraltır, genişletmez', () => {
    expect(hedefSinirlari(S, { hizSiniri: 270, vuSiniri: 120 })).toMatchObject({ maxHiz: 270, maxVu: 120 });
    expect(hedefSinirlari(S, { hizSiniri: 900, vuSiniri: null })).toMatchObject({ maxHiz: 450, maxVu: 199 });
    expect(hedefSinirlari(S, null)).toMatchObject({ maxHiz: 450, maxVu: 199 });
    expect(parametreHatalari(P, hedefSinirlari(S, { hizSiniri: 300 })).hizlar).toMatch(/1–300/);
  });

  it('YO2b ölçülmüş limit 0 gerçek sınırdır (genel üst sınıra dönmez); form sunucunun metnini söyler', () => {
    // 1 r/s'lik limit_req -> hizSiniri 0; limit_conn 1 -> vuSiniri 0. Eskiden 0 "veri yok" sayilip 450 / 199'a donuyordu.
    const dar = hedefSinirlari(S, { hizSiniri: 0, vuSiniri: 0 });
    expect(dar).toMatchObject({ maxHiz: 0, maxVu: 0 });
    const h = parametreHatalari(P, dar);
    expect(h.hizlar).toBe(SINIR_SIFIR_METNI);
    expect(h.maxvu).toBe(SINIR_SIFIR_METNI);
    expect(SINIR_SIFIR_METNI).toBe("Hedefin ölçülmüş limit_req değeri 2 r/s'nin altında (ya da limit_conn ≤ 1); bu hedefe yük testi yapılamaz.");
    expect(hedefSinirlari(S, { hizSiniri: 0, vuSiniri: null })).toMatchObject({ maxHiz: 0, maxVu: 199 });
    expect(hedefSinirlari(S, { hizSiniri: null, vuSiniri: undefined })).toMatchObject({ maxHiz: 450, maxVu: 199 });
    expect(parametreHatalari(P, hedefSinirlari(S, { hizSiniri: 1, vuSiniri: 0 })).hizlar).toMatch(/1–1 istek/);
  });

  it('YO3 artımlı çıktı: ofsetle yerleştirir; ofsetsiz tam metni değiştirir, parçayı ekler', () => {
    expect(ciktiBirlestir('abc', 'def', 3, 3)).toBe('abcdef');
    expect(ciktiBirlestir('abc', 'xyz', 3, 0)).toBe('xyz');
    expect(ciktiBirlestir('abcdef', 'Def', 6, 3)).toBe('abcDef');
    expect(ciktiBirlestir('abc', 'abcdef', 3)).toBe('abcdef');
    expect(ciktiBirlestir('abc', 'def', 3)).toBe('abcdef');
    expect(ciktiBirlestir('', 'abc', 0)).toBe('abc');
    expect(ciktiBirlestir('abc', '', 3, 3)).toBe('abc');
  });

  it('YO4 ön kontrol: sunucu listesi esas; yoksa istemci kuralları; set_stats FAIL engel', () => {
    const o = onKontrolNormalle({ ip_yerel: 'True', server_name_var: true, k6_var: true, master_sayisi: '1', web_log_df: 70, log_format_ua: 'false', yollar_toplam: 10, yollar_200: 9, sikistirma: { statik: 2 } });
    const temel = { durum: 'DONE', onKontrol: o } as Pick<NlKosuAyrinti, 'durum' | 'onKontrol'>;
    const istemci = onKontrolDegerlendir(temel);
    expect(istemci.engeller).toEqual([]);
    expect(istemci.uyarilar.length).toBe(4);
    const sunucu = onKontrolDegerlendir({ ...temel, sunucuDegerlendirmesi: { engeller: [], uyarilar: ['1/10 yol 200 dönmedi'] } });
    expect(sunucu.uyarilar).toEqual(['1/10 yol 200 dönmedi']);
    const engel = onKontrolDegerlendir({ ...temel, sunucuDegerlendirmesi: { engeller: ['k6 yük makinesinde bulunamadı'], uyarilar: [] } });
    expect(engel.engeller).toEqual(['K6 yük makinesinde bulunamadı']);
    expect(onKontrolDegerlendir({ ...temel, isDurumu: 'FAIL', isHatasi: 'assert' }).engeller[0]).toMatch(/FAIL: assert/);
    expect(onKontrolDegerlendir({ durum: 'FAILED', onKontrol: null }).engeller.length).toBe(1);
    expect(onKontrolDegerlendir({ durum: 'RUNNING', onKontrol: null }).engeller).toEqual([]);
    // Olculmus master != 1 ENGEL (cpu_kaydedici.sh baslamaz); olculemeyen master sessiz.
    const m2 = onKontrolDegerlendir({ durum: 'DONE', onKontrol: onKontrolNormalle({ ip_yerel: true, server_name_var: true, k6_var: true, master_sayisi: 2, yollar_toplam: 1, yollar_200: 1 }) });
    expect(m2.engeller.join()).toMatch(/2 nginx master/);
    expect(m2.uyarilar.join()).not.toMatch(/master/);
    expect(onKontrolDegerlendir({ ...temel, onKontrol: onKontrolNormalle({ ip_yerel: false, server_name_var: true, k6_var: true }) }).engeller[0]).toMatch(/yerel değil/);
  });

  it('YO4c başarısız ön kontrolün asıl nedeni engelde; okunamayan log dizini ENGEL (uyarı değil)', () => {
    const o = onKontrolNormalle({ ip_yerel: true, server_name_var: true, k6_var: true, master_sayisi: 1, log_dizini_okunur: false, yollar_toplam: 1, yollar_200: 1 });
    // Playbook engeli FAIL ile biter: set_stats hata metni (isHatasi) gosterilir, genel metin degil.
    const f = onKontrolDegerlendir({ durum: 'FAILED', onKontrol: o, isDurumu: 'FAIL', isHatasi: 'log dizini /web_log okunamiyor' });
    expect(f.engeller[0]).toBe('Ön kontrol başarısız: log dizini /web_log okunamiyor');
    expect(f.engeller.some((e) => /^Log dizini \/web_log okunamıyor/.test(e))).toBe(true);
    expect(f.uyarilar.join()).not.toMatch(/Log dizini/);
    // Neden yoksa eski genel metin.
    expect(onKontrolDegerlendir({ durum: 'CANCELED', onKontrol: null }).engeller).toEqual(['Ön kontrol durduruldu — iş çıktısına bakın, düzeltip yeniden çalıştırın.']);
    // DONE ama log dizini okunamiyor (sunucu degerlendirmesi yok: istemci kurali) -> engel.
    const d = onKontrolDegerlendir({ durum: 'DONE', onKontrol: o });
    expect(d.engeller).toEqual(['Log dizini /web_log okunamıyor — sunucu tarafı istek sayısı ve süreleri ölçülemez.']);
    expect(d.uyarilar).toEqual([]);
  });

  it('YO4b ön kontrol ömrü sunucu yaşından sayılır (istemci saati kayık olabilir)', () => {
    const simdi = 1_000_000_000;
    expect(onKontrolKalanMs({ finishedAt: '2000-01-01T00:00:00Z', onKontrolYasSn: 60 }, simdi, simdi - 5000)).toBe(ON_KONTROL_OMRU_MS - 60000 - 5000);
    expect(onKontrolKalanMs({ finishedAt: new Date(simdi - 60000).toISOString() }, simdi)).toBe(ON_KONTROL_OMRU_MS - 60000);
    expect(onKontrolKalanMs({ finishedAt: null }, simdi)).toBeNull();
  });

  it('YO5 hız gruplaması: CPU yalnız GEÇERLİ, p95 geçersiz dışı; KISMI / DOYMA / kapasite', () => {
    const a = (o: Partial<NlAdim>): NlAdim => adimNormalle({ tur: 'R1_K_yeni_br_250_r1', senaryo: 'K', kip: 'yeni', ae: 'br', hiz: 250, ...o });
    const g = hizGrupla([
      a({ deneme: 1, gecerlilik: 'GECERLI', p95: 10, cpuMsIstek: 2 }),
      a({ deneme: 2, gecerlilik: 'DOYMA', p95: 20, cpuMsIstek: 8 }),
      a({ deneme: 3, gecerlilik: 'GECERSIZ', p95: 1000, cpuMsIstek: 100 }),
    ], 4);
    expect(g).toHaveLength(1);
    expect(g[0]).toMatchObject({ hiz: 250, n: 3, nGecerli: 2, p95: 15, cpuMsIstek: 2, durum: 'KISMI' });
    expect(g[0].kapasiteRps).toBeCloseTo((4 * 1000 * 0.8) / 2);
    const doyma = hizGrupla([a({ gecerlilik: 'GECERLI', p95: 1 }), a({ gecerlilik: 'DOYMA', p95: 3 })]);
    expect(doyma[0].durum).toBe('DOYMA');
    expect(hizGrupla([a({ gecerlilik: 'HATALI', p95: 1 })])[0]).toMatchObject({ durum: 'GECERSIZ', p95: null, cpuMsIstek: null });
  });

  it('YO6 normalleştirme: camelCase ya da snake_case; boş / metin sayı; ölçülmeyen null (0 değil)', () => {
    const d = adimNormalle({ tur: 'x', hiz: '250', p95: '', ttfb_p95: '12.5', n_429: 0, cpuMsIstek: null, nedenler: '["429(3)","df>=65"]' });
    expect(d.hiz).toBe(250);
    expect(d.p95).toBeNull();
    expect(d.ttfbP95).toBe(12.5);
    expect(d.n429).toBe(0);
    expect(d.cpuMsIstek).toBeNull();
    expect(d.dropped).toBeNull();
    expect(d.nedenler).toEqual(['429(3)', 'df>=65']);
    expect(adimNormalle({ tur: 'y', nedenler: ['a'], n429: 2 }).n429).toBe(2);
    const o = onKontrolNormalle('{"ip_yerel":"False","web_log_df":"","yollar_200":"5","ilk_hatalar":[{"yol":"/a","status":404}]}');
    expect(o).toMatchObject({ ipYerel: false, webLogDf: null, yollar200: 5, k6Var: null, ilkHatalar: [{ yol: '/a', status: '404' }] });
    expect(onKontrolNormalle(null)).toBeNull();
    expect(onKontrolNormalle({})).toBeNull();
  });

  it('YO7 adım: tekrar TUR sonekinden (yoksa ham.tekrar), uyarılar ve pencere kaynağı ham’dan; etiket ve sıra tekrar’la', () => {
    const r2 = adimNormalle({ tur: 'R12_K_yeni_br_100_r2', hiz: 100, deneme: 1, ham: { tekrar: 9, uyarilar: ['diger_trafik_%50', 'saat_farki~12s(sunucu-istemci)'], pencere_kaynak: 'istemci_saati' } });
    expect(r2.tekrar).toBe(2);
    expect(r2.uyarilar).toEqual(['diger_trafik_%50', 'saat_farki~12s(sunucu-istemci)']);
    expect(r2.pencereKaynak).toBe('istemci_saati');
    // Sonek yoksa ham.tekrar; ham JSON metni olarak da gelebilir.
    const ham = adimNormalle({ tur: 'eski_tur', ham: '{"tekrar":3,"uyarilar":[],"pencere_kaynak":"log"}' });
    expect(ham).toMatchObject({ tekrar: 3, uyarilar: [], pencereKaynak: 'log' });
    expect(adimNormalle({ tur: 'x' })).toMatchObject({ tekrar: null, uyarilar: [], pencereKaynak: null });
    expect(adimEtiketi({ tekrar: 2, deneme: 1 })).toBe('r2');
    expect(adimEtiketi({ tekrar: 2, deneme: 3 })).toBe('r2 · deneme 3');
    expect(adimEtiketi({ tekrar: null, deneme: null })).toBe('r?');
    const a = (tur: string, hiz: number, deneme = 1) => adimNormalle({ tur, senaryo: 'K', kip: 'yeni', ae: 'br', hiz, deneme });
    const sirali = adimSirala([a('R1_K_yeni_br_250_r2', 250), a('R1_K_yeni_br_100_r10', 100), a('R1_K_yeni_br_100_r2', 100, 2), a('R1_K_yeni_br_100_r2', 100), a('R1_K_yeni_br_250_r1', 250)]);
    expect(sirali.map((x) => `${x.hiz}/${adimEtiketi(x)}`)).toEqual(['100/r2', '100/r2 · deneme 2', '100/r10', '250/r1', '250/r2']);
  });

  it('YO7b koşu uyarıları: katlanan adım uyarıları ("<TUR>: ..." ve özet satırı) ayrı listelenir', () => {
    const { genel, adim } = uyarilariAyir([
      'arka_plan_yok:R4_gbngxt33(kosu_disi_bosluk_bulunamadi)', 'kayit:R4_gbngxt33:disk_%70', 'R4_K_yeni_br_100_r1: diger_trafik_%12',
      'R4_K_yeni_br_250_r2: saat_farki', '… ve 3 adım uyarısı daha', 'log_baska_adim_satiri:12',
    ]);
    expect(genel).toEqual(['arka_plan_yok:R4_gbngxt33(kosu_disi_bosluk_bulunamadi)', 'kayit:R4_gbngxt33:disk_%70', 'log_baska_adim_satiri:12']);
    expect(adim).toEqual(['R4_K_yeni_br_100_r1: diger_trafik_%12', 'R4_K_yeni_br_250_r2: saat_farki', '… ve 3 adım uyarısı daha']);
  });

  it('YO8 koşu ayrıntısı: durdurIsi (awxJobId / jobId) ve sonuç okuma denemesi normalleşir', () => {
    expect(kosuNormalle({ id: 7, durdurIsi: { awxServerId: 3, awxJobId: 912 }, sonuclandirmaDenemesi: 2 })).toMatchObject({ durdurIsi: { awxServerId: 3, awxJobId: 912 }, sonuclandirmaDenemesi: 2 });
    expect(kosuNormalle({ id: 7, durdurIsi: { jobId: '913', awxServerId: '1' } }).durdurIsi).toEqual({ awxServerId: 1, awxJobId: 913 });
    expect(kosuNormalle({ id: 7, durdurIsi: { awxServerId: 3, awxJobId: null } }).durdurIsi).toBeNull();
    expect(kosuNormalle({ id: 7, durdurIsi: null }).durdurIsi).toBeNull();
    expect(kosuNormalle({ id: 7 })).toMatchObject({ durdurIsi: null, sonuclandirmaDenemesi: 0 });
    expect(kosuNormalle({ id: 7, sonuclandirma_denemesi: '3' }).sonuclandirmaDenemesi).toBe(3);
    expect(sonucOkunuyorMetni(2)).toBe('Sonuç okunuyor (deneme 2/3)');
    expect(sonucOkunuyorMetni(0)).toBe('Sonuç okunuyor');
  });

  it('YO9 OKUNAMADI: "Portal yeniden okumayı dener" vaadi yok; düğme koşulları; durdur hata metni sunucu kalıbında', () => {
    expect(GECERLILIK.OKUNAMADI.aciklama).toBe(OKUNAMADI_ACIKLAMASI);
    expect(OKUNAMADI_ACIKLAMASI).toBe('Portal sonucu 3 kez okumayı denedi ve okuyamadı. İş çıktısındaki /sw kopyalama adımını ve SHA256SUMS\'ı kontrol edip "Sonucu yeniden oku" ile tekrar deneyin.');
    for (const g of Object.values(GECERLILIK)) expect(g.aciklama).not.toMatch(/yeniden okumayı dener/);
    expect(yenidenOkunabilir({ islem: 'kosu', durum: 'OKUNAMADI', gecerlilik: null })).toBe(true);
    expect(yenidenOkunabilir({ islem: 'kosu', durum: 'FAILED', gecerlilik: 'OKUNAMADI' })).toBe(true);
    expect(yenidenOkunabilir({ islem: 'kosu', durum: 'DONE', gecerlilik: 'GECERLI' })).toBe(false);
    expect(yenidenOkunabilir({ islem: 'on_kontrol', durum: 'OKUNAMADI', gecerlilik: null })).toBe(false);
    expect(kalanSurecDurdurulabilir({ islem: 'kosu', durum: 'CANCELED' })).toBe(true);
    for (const durum of ['FAILED', 'DONE', 'OKUNAMADI', 'RUNNING'] as const) expect(kalanSurecDurdurulabilir({ islem: 'kosu', durum })).toBe(false);
    expect(kalanSurecDurdurulabilir({ islem: 'on_kontrol', durum: 'CANCELED' })).toBe(false);
    expect(durdurBaslatilamadiMetni({ iptal: { canceled: true }, durdurHatasi: 'AWX HTTP 503' })).toBe(
      "AWX işi iptal edildi, ancak durdurma işi başlatılamadı: AWX HTTP 503. Uzaktaki k6 / kaydedici sürüyor olabilir; Durdur'u yeniden deneyin. Kilitler koşunun süre sınırına kadar tutulur.");
    expect(durdurBaslatilamadiMetni({ iptal: null, durdurHatasi: null })).toMatch(/^AWX işi iptal edilemedi, ancak durdurma işi başlatılamadı: sunucu durdurma işini bildirmedi\./);
  });

  it('YO11 bütçe wrk: adım sayısı bağlantı kademesinden; hizlar’sız / bağlantısız p çökmez; motor’suz eski p k6', () => {
    expect(butceSn(W)).toBe(60 + 3 * 2 * (30 + 120 + 30 + 20) + 120);
    // wrk kaydinda hizlar YOK; alan hic yoksa 0 adim (cokmez).
    expect(() => butceSn({ motor: 'wrk', tekrar: 2, isinma: 30, sure: 120, bosluk: 30, bosta: 60 })).not.toThrow();
    expect(butceSn({ motor: 'wrk', tekrar: 2, isinma: 30, sure: 120, bosluk: 30, bosta: 60 })).toBe(180);
    // wrk'de kalmis bir hizlar alani adim sayisina girmez; eski (motor'suz) p k6 sayilir.
    expect(butceSn({ ...W, hizlar: [1] })).toBe(butceSn(W));
    expect(butceSn({ hizlar: [100, 250], tekrar: 1, isinma: 30, sure: 120, bosluk: 30, bosta: 60 })).toBe(60 + 2 * 200 + 120);
    expect(adimDegerleri(W)).toEqual({ motor: 'wrk', degerler: [2, 4, 8], birim: 'bağlantı' });
    expect(adimDegerleri({ hizlar: [100, 250] })).toEqual({ motor: 'k6', degerler: [100, 250], birim: 'istek/sn' });
    expect(adimDegerleri({ motor: 'wrk' })).toEqual({ motor: 'wrk', degerler: [], birim: 'bağlantı' });
    expect(adimDegerleri(null)).toEqual({ motor: 'k6', degerler: [], birim: 'istek/sn' });
    expect(motorOf({ motor: 'WRK' })).toBe('k6');
    expect(motorOf(undefined)).toBe('k6');
    expect(kademeMetni(8, 'bağlantı')).toBe('8 bağlantı');
    expect(kademeMetni(250, 'istek/sn')).toBe('250/sn');
    expect(kademeMetni(null, 'bağlantı')).toBe('—');
    expect(baglantilariAyristir('2 4,8')).toEqual([2, 4, 8]);
    expect(baglantilariAyristir('2 x')).toBeNull();
    expect(baglantilariAyristir('  ')).toBeNull();
  });

  it('YO12 parametre denetimi wrk: her mesaj; iş parçacığı en küçük bağlantıyı aşamaz ve her bağlantıyı böler; ölçülmüş sıfır sınır', () => {
    expect(parametreHatalari(W, S)).toEqual({});
    const b = (baglantilar: number[], is_parcacigi = 2) => parametreHatalari({ ...W, baglantilar, is_parcacigi }, S);
    expect(b([]).baglantilar).toBe('1 ile 5 arası bağlantı kademesi girin.');
    expect(b([2, 4, 6, 8, 10, 12]).baglantilar).toBe('1 ile 5 arası bağlantı kademesi girin.');
    expect(b([2, 200]).baglantilar).toBe('Her bağlantı 1–199 olmalı.');
    expect(b([0, 2]).baglantilar).toBe('Her bağlantı 1–199 olmalı.');
    expect(b([4, 4]).baglantilar).toBe('Aynı bağlantı sayısı iki kez yazılmış.');
    expect(b([2, 4], 0).is_parcacigi).toBe('İş parçacığı 1–16 olmalı.');
    expect(b([32, 64], 17).is_parcacigi).toBe('İş parçacığı 1–16 olmalı.');
    expect(b([2, 4, 8], 4).is_parcacigi).toBe('İş parçacığı en küçük bağlantı sayısından büyük olamaz.');
    // N % T != 0: wrk baglantilari c / t tam bolmesiyle dagitir (sozlesme K3).
    expect(b([3, 6, 9], 2).is_parcacigi).toBe('Her bağlantı sayısı iş parçacığı sayısına tam bölünmeli.');
    expect(b([3, 6, 9], 3)).toEqual({});
    // Baglantilar zaten hataliysa iliski kurali ikinci hata yazmaz.
    expect(b([0, 2], 2).is_parcacigi).toBeUndefined();
    // wrk'de k6 alanlari (hizlar, maxvu) denetlenmez; k6'da wrk alanlari.
    expect(parametreHatalari(W, S)).not.toHaveProperty('maxvu');
    expect(parametreHatalari(P, S)).not.toHaveProperty('baglantilar');
    // Hedefin limit_conn'u (vuSiniri) baglantiyi daraltir; serbest hedefte en cok 50.
    expect(parametreHatalari({ ...W, baglantilar: [2, 4, 128] }, hedefSinirlari(S, { vuSiniri: 99 })).baglantilar).toBe('Her bağlantı 1–99 olmalı.');
    expect(parametreHatalari({ ...W, baglantilar: [2, 52] }, hedefSinirlari(S, null, SERBEST)).baglantilar).toBe('Her bağlantı 1–50 olmalı.');
    // Olculmus sifir: toplam hiz tavani (hizSiniri) ya da baglanti tavani (vuSiniri) 0 -> sunucunun sinir_asildi metni.
    expect(parametreHatalari(W, hedefSinirlari(S, { hizSiniri: 0 })).baglantilar).toBe(SINIR_SIFIR_METNI);
    expect(parametreHatalari(W, hedefSinirlari(S, { vuSiniri: 0 })).baglantilar).toBe(SINIR_SIFIR_METNI);
    expect(parametreHatalari(W, { ...S, maxHiz: 0 }).baglantilar).toBe(SINIR_SIFIR_METNI);
    // Butce asimi wrk metniyle.
    expect(parametreHatalari({ ...W, baglantilar: [2, 4, 8, 16, 32], tekrar: 3, sure: 300 }, S).butce).toMatch(/üst sınır 45 dk\. Bağlantı kademesi, tekrar ya da süreyi azaltın\.$/);
    // k6 serbest: hiz <= 200, VU <= 50 (sunucudaki "serbest hedef tavanı" eki sunucu metninde).
    expect(parametreHatalari({ ...P, hizlar: [50, 201] }, hedefSinirlari(S, null, SERBEST)).hizlar).toBe('Her hız 1–200 istek/sn olmalı.');
    expect(parametreHatalari({ ...P, hizlar: [50, 100, 200], maxvu: 51 }, hedefSinirlari(S, null, SERBEST)).maxvu).toBe('10–50');
    expect(parametreHatalari({ ...P, hizlar: [50, 100, 200], maxvu: 50 }, hedefSinirlari(S, null, SERBEST))).toEqual({});
  });

  it('YO13 ön kontrol normalleştirmesi: ip_yuk_makinesinde, serbest_ag, wrk_* (snake / camel); eski özet null', () => {
    const o = onKontrolNormalle({
      ip_yerel: null, server_name_var: null, ip_yuk_makinesinde: 'False', serbest_ag: '10.20.30.0/24', k6_var: null, wrk_var: 'True', wrk_calisiyor: true,
      wrk_surum: 'wrk 4.2.0 [epoll] Copyright (C) 2012 Will Glozer', wrk_sha256: 'c'.repeat(64), yollar_toplam: 3, yollar_200: 3,
    });
    expect(o).toMatchObject({
      ipYerel: null, serverNameVar: null, ipYukMakinesinde: false, serbestAg: '10.20.30.0/24', k6Var: null, wrkVar: true, wrkCalisiyor: true,
      wrkSurum: 'wrk 4.2.0 [epoll] Copyright (C) 2012 Will Glozer', wrkSha256: 'c'.repeat(64),
    });
    expect(onKontrolNormalle({ ipYukMakinesinde: true, wrkVar: false, wrkCalisiyor: 'false', serbestAg: '' })).toMatchObject({ ipYukMakinesinde: true, wrkVar: false, wrkCalisiyor: false, serbestAg: null });
    expect(onKontrolNormalle({ ip_yerel: true, k6_var: true })).toMatchObject({ ipYukMakinesinde: null, serbestAg: null, wrkVar: null, wrkCalisiyor: null, wrkSurum: null, wrkSha256: null });
  });

  it('YO14 geri dönüş değerlendirmesi: D7 server_name uyarı (listenin başında, engel değil); wrk iki engel metni; serbestte hedef kuralı yok', () => {
    const temel = { ip_yerel: true, server_name_var: true, k6_var: true, master_sayisi: 1, web_log_df: 10, log_dizini_okunur: true, log_format_ua: true, yollar_toplam: 3, yollar_200: 3 };
    const d = (ok: Record<string, unknown>, ek: Partial<Pick<NlKosuAyrinti, 'hedefTuru' | 'motor' | 'parametreler' | 'sunucuDegerlendirmesi'>> = {}) => onKontrolDegerlendir({ durum: 'DONE', onKontrol: onKontrolNormalle(ok), ...ek });
    expect(d(temel)).toEqual({ engeller: [], uyarilar: [], bilgiler: [] });
    // D7: olculmedi (null) da yok (false) da UYARI; engel DEGIL; uyari listesinin basinda.
    for (const v of [false, null]) {
      const r = d({ ...temel, server_name_var: v, yollar_200: 2 });
      expect(r.engeller).toEqual([]);
      expect(r.uyarilar).toHaveLength(2);
      expect(r.uyarilar[0]).toBe(HOST_LISTEDE_YOK_UYARISI);
    }
    // wrk: calisiyor ama surum okunamadi / bulunamadi - iki ayri metin; sabit wrk uyarisi.
    const wrk = { ...temel, k6_var: null, wrk_var: false, wrk_calisiyor: true, wrk_surum: 'wrk  [epoll] Copyright (C) 2012 Will Glozer' };
    const w1 = d(wrk, { motor: 'wrk' });
    expect(w1.engeller).toEqual(['Yük sunucusunda wrk çalışıyor ama sürümü okunamadı ya da 4 altında (wrk  [epoll] Copyright (C) 2012 Will Glozer); wrk’yi make VER=4.2.0 ile yeniden derleyin.']);
    expect(w1.uyarilar).toEqual([WRK_UYARISI]);
    expect(d({ ...wrk, wrk_calisiyor: false, wrk_surum: null }, { motor: 'wrk' }).engeller).toEqual(['Yük sunucusunda wrk bulunamadı ya da çalıştırılamıyor.']);
    const w3 = d({ ...wrk, wrk_var: true, wrk_surum: 'wrk 4.2.0 [epoll] Copyright (C) 2012 Will Glozer', wrk_sha256: 'd'.repeat(64) }, { motor: 'wrk' });
    expect(w3.engeller).toEqual([]);
    expect(w3.bilgiler).toContain(`wrk 4.2.0 [epoll] Copyright (C) 2012 Will Glozer · sha256 ${'d'.repeat(12)}…`);
    // Motor satirda yoksa kanonik parametreden; k6'da wrk alani aranmaz, k6 engeli eskisi.
    expect(d(wrk, { parametreler: W }).engeller[0]).toMatch(/^Yük sunucusunda wrk çalışıyor/);
    expect(d({ ...temel, k6_var: false }).engeller).toEqual(['Yük sunucusunda k6 bulunamadı.']);
    // Serbest: hedef kurallari degerlendirilmez (yedi alan null), IP yuk sunucusunda yerel degil olmali.
    const sb = { ip_yerel: null, server_name_var: null, master_sayisi: null, web_log_df: null, log_dizini_okunur: null, log_format_ua: null, ip_yuk_makinesinde: false, serbest_ag: '10.20.30.0/24', k6_var: true, yollar_toplam: 3, yollar_200: 3 };
    const s1 = d(sb, SERBEST);
    expect(s1.engeller).toEqual([]);
    expect(s1.uyarilar).toEqual([SERBEST_UYARISI]);
    expect(s1.bilgiler).toContain(SERBEST_ON_KONTROL_BILGISI);
    for (const v of [true, null]) expect(d({ ...sb, ip_yuk_makinesinde: v }, SERBEST).engeller).toEqual(['Hedef IP yük sunucusunda yerel ya da ölçülemedi — istek gönderilmedi.']);
    expect(d({ ...sb, k6_var: null, wrk_var: true }, { hedefTuru: 'serbest', motor: 'wrk' }).uyarilar).toEqual([SERBEST_UYARISI, WRK_UYARISI]);
    // Sunucu listesi varsa O (plan uyarilari dahil); yerel kural eklenmez.
    expect(d({ ...temel, server_name_var: false }, { sunucuDegerlendirmesi: { engeller: [], uyarilar: ['host başlığı listede yok'] } }).uyarilar).toEqual(['Host başlığı listede yok']);
    // Sunucu metni cumle basinda buyuk harfle; arac adi "wrk" ile baslayan metin aynen (sozlesme metni).
    expect(d(temel, { sunucuDegerlendirmesi: { engeller: ['wrk yük makinesinde bulunamadı ya da çalıştırılamıyor'], uyarilar: [WRK_UYARISI] } })).toMatchObject({
      engeller: ['wrk yük makinesinde bulunamadı ya da çalıştırılamıyor'], uyarilar: [WRK_UYARISI],
    });
  });

  it('YO15 koşu normalleştirmesi: tür / motor varsayılanı sunucu / k6, motor parametreden; wrk parametreleriyle çökmez; durdur metni', () => {
    const eski = kosuNormalle({ id: 3, hedefHost: 'GBNGXT10', hedefIp: '10.1.2.3', parametreler: { hizlar: [100], tekrar: 1, isinma: 30, sure: 120, bosluk: 30, bosta: 60, maxvu: 50, kip: 'ka', ae: 'br' } });
    expect(eski).toMatchObject({ hedefTuru: 'sunucu', motor: 'k6', hedefHost: 'GBNGXT10', serbestAg: null, planUyarilari: [] });
    const w = kosuNormalle({
      id: 4, hedefTuru: 'serbest', hedefHost: '', hedefIp: '10.20.30.40', serbestAg: '10.20.30.0/24', planUyarilari: ['Host başlığı (a.example) son nginx taramasında ...'],
      parametreler: '{"motor":"wrk","baglantilar":[2,4],"is_parcacigi":2,"tavan_rps":200,"tekrar":1,"isinma":30,"sure":120,"bosluk":30,"bosta":60,"kip":"ka","ae":"br","sni":false}',
    });
    expect(w).toMatchObject({ hedefTuru: 'serbest', motor: 'wrk', hedefHost: null, hedefIp: '10.20.30.40', serbestAg: '10.20.30.0/24', planUyarilari: ['Host başlığı (a.example) son nginx taramasında ...'] });
    expect(kosuNormalle({ id: 5, parametreler: { motor: 'wrk' } }).motor).toBe('wrk');
    expect(kosuNormalle({ id: 5, motor: 'wrk', parametreler: null }).motor).toBe('wrk');
    expect(kosuNormalle({ id: 6, hedef_turu: 'serbest', motor: 'bilinmeyen', plan_uyarilari: '["a","b"]' })).toMatchObject({ hedefTuru: 'serbest', motor: 'k6', planUyarilari: ['a', 'b'] });
    // wrk kaydinda hizlar yok: adim degerleri ve butce baglantilardan.
    expect(adimDegerleri(w.parametreler)).toEqual({ motor: 'wrk', degerler: [2, 4], birim: 'bağlantı' });
    expect(butceSn(w.parametreler!)).toBe(60 + 2 * 1 * 200 + 120);
    // 424 durdur_baslatilamadi yedek metni: k6 + sunucu BIREBIR eskisi; serbestte kaydedici yok; arac adi motorla.
    const r = { iptal: null, durdurHatasi: 'x' };
    expect(durdurBaslatilamadiMetni(r)).toContain('Uzaktaki k6 / kaydedici sürüyor olabilir;');
    expect(durdurBaslatilamadiMetni(r, { hedefTuru: 'sunucu', motor: 'wrk' })).toContain('Uzaktaki wrk / kaydedici sürüyor olabilir;');
    expect(durdurBaslatilamadiMetni(r, { hedefTuru: 'serbest', motor: 'wrk' })).toContain('Uzaktaki wrk sürüyor olabilir;');
    expect(durdurBaslatilamadiMetni(r, { hedefTuru: 'serbest', motor: 'k6' })).toContain('Uzaktaki k6 sürüyor olabilir;');
  });

  it('YO18 serbest hedef iki motorda daraltır (200 istek/sn, 50 bağlantı / VU); wrk tavanı ve bekleme', () => {
    expect(hedefSinirlari(S, null, SERBEST)).toMatchObject({ maxHiz: 200, maxVu: 50, maxBaglanti: 50 });
    // Serbest daraltma genisletmez: hedef siniri daha dar ise o kalir.
    expect(hedefSinirlari(S, { hizSiniri: 120, vuSiniri: 30 }, SERBEST)).toMatchObject({ maxHiz: 120, maxVu: 30, maxBaglanti: 30 });
    // Sunucu: limit_conn (vuSiniri) VU'yu ve wrk baglantisini birlikte daraltir.
    expect(hedefSinirlari(S, { hizSiniri: 270, vuSiniri: 99 })).toMatchObject({ maxHiz: 270, maxVu: 99, maxBaglanti: 99 });
    expect(hedefSinirlari(S, null)).toMatchObject({ maxHiz: 450, maxVu: 199, maxBaglanti: 199 });
    // Tur 3 alanlari olmayan (eski sunucu) sinir nesnesi sozlesme sabitleriyle tamamlanir.
    const eskiS = { maxHiz: 450, maxTekrar: 3, sureMin: 40, sureMax: 300, isinmaMax: 60, maxVu: 199, maxButceSn: 2700 } as NlSinirlar;
    expect(hedefSinirlari(eskiS, null, SERBEST)).toMatchObject({ maxHiz: 200, maxVu: 50, maxBaglanti: 50, maxIsParcacigi: 16, maxBaglantiSayisi: 5 });
    expect(hedeflerNormalle({ ok: true, sinirlar: eskiS, varsayilan: P }).sinirlar).toMatchObject({ maxBaglanti: 199, serbestTavanRps: 200, serbestMaxBaglanti: 50 });
    // Tavan (sozlesme 3): sunucu min(450, hizSiniri > 0 ? hizSiniri : 450), serbest 200.
    expect(tavanRps(S, null, 'sunucu')).toBe(450);
    expect(tavanRps(S, { hizSiniri: 270 }, 'sunucu')).toBe(270);
    expect(tavanRps(S, { hizSiniri: 900 }, 'sunucu')).toBe(450);
    expect(tavanRps(S, { hizSiniri: 0 }, 'sunucu')).toBe(450);
    expect(tavanRps(S, { hizSiniri: 270 }, 'serbest')).toBe(200);
    expect(tavanRps(S, null, null)).toBe(450);
    expect(tavanNedeni(S, { hizSiniri: 270 }, 'sunucu')).toBe('hedefin ölçülmüş limit_req’inin %90’ı');
    expect(tavanNedeni(S, null, 'sunucu')).toBe('genel üst sınır');
    expect(tavanNedeni(S, null, 'serbest')).toBe('serbest hedef tavanı');
    // yuk_wrk.lua GECIKME_MS = ceil(N * 1000 / tavan).
    expect(baglantiBeklemesiMs(2, 450)).toBe(5);
    expect(baglantiBeklemesiMs(8, 450)).toBe(18);
    expect(baglantiBeklemesiMs(2, 200)).toBe(10);
    expect(baglantiBeklemesiMs(2, 0)).toBeNull();
    expect(ipGecerli('10.20.30.40')).toBe(true);
    for (const kotu of ['10.20.30', '010.1.1.1', '10.20.30.256', ' 10.1.1.1', '10.1.1.1/24']) expect(ipGecerli(kotu)).toBe(false);
  });

  it('YO19 sözleşme 11 metinleri: yeni neden eşlemeleri ve onay_metni; hedef etiketi', () => {
    expect(nedenMetni('ip_belirsiz')).toBe('IP birden çok sunucuya ait — hedef sunucuyu listeden seçin');
    expect(nedenMetni('ip_sahibi_cozulemedi')).toBe('IP’nin sahibi envanterde çözülemedi — yük testi yapılmaz');
    expect(nedenMetni('serbest_kapali')).toBe('envanterde olmayan IP’ye yük testi kapalı (NGINX_LOADTEST_SERBEST_AGLAR tanımlı değil)');
    expect(nedenMetni('ip_izinli_agda_degil')).toBe('IP izinli ağların (NGINX_LOADTEST_SERBEST_AGLAR) dışında');
    expect(nedenMetni('ip_yasakli_agda')).toBe('IP yasaklı bir ağda (NGINX_LOADTEST_SERBEST_YASAK)');
    expect(nedenMetni('ip_yasak_listesi_gecersiz')).toBe('yasak listesi (NGINX_LOADTEST_SERBEST_YASAK) okunamadı — yük testi kapalı');
    expect(nedenMetni('host_uretim')).toBe('Host başlığı yalnız üretim sunucularında tanımlı');
    expect(nedenMetni('envanter_bayat')).toBe('envanter / tarama bayat — yükleyici işlerini kontrol edin');
    expect(nedenMetni('onay_metni')).toBe('yazılan ad / IP hedefle aynı değil');
    expect(hedefEtiketi({ hedefHost: null, hedefIp: '10.20.30.40' })).toBe('10.20.30.40');
    expect(hedefEtiketi({ hedefHost: 'GBNGXT10', hedefIp: '10.1.2.3' })).toBe('GBNGXT10');
  });

  it('YO20 (WR2) wrk uyarısı: tavan ORTALAMA hızı sınırlar, istekler kümelenebilir, burst’ü küçük / burst’süz yolda 429 -> DUR; “aşamaz” demez', () => {
    expect(WRK_UYARISI.startsWith('wrk kapalı döngüdür: her bağlantı yanıtı alınca yeni istek gönderir.')).toBe(true);
    expect(WRK_UYARISI).toMatch(/toplam hız ORTALAMADA koşunun tavanını \(hedefin ölçülmüş limit_req'inin %90'ı, en çok 450; serbest hedefte 200 istek\/sn\) aşmaz;/);
    expect(WRK_UYARISI).not.toMatch(/aşamaz/);
    expect(WRK_UYARISI).toContain('bağlantılar birlikte başlar, ilk istekler rastgele yayılır ama istekler kümelenebilir.');
    expect(WRK_UYARISI).toContain("limit_req burst'ü bağlantı sayısından küçük ya da burst'süz yollarda 429 alınır ve koşu durur; böyle yollarda k6 kullanın ya da bağlantı sayısını düşük tutun.");
    // Sozlesme 4.3 kalibi: "wrk kapalı döngüdür: … wrk sonuçları k6 sonuçlarıyla karşılaştırılmaz."
    expect(WRK_UYARISI.endsWith('wrk sonuçları k6 sonuçlarıyla karşılaştırılmaz.')).toBe(true);
  });

  it('YO21 (UI1) hiç yol denenmediyse (0 / 0) sıkıştırma sıfırları bilgi satırına ölçülmüş gibi yazılmaz', () => {
    const d = (ok: Record<string, unknown>) => onKontrolDegerlendir({ durum: 'DONE', hedefTuru: 'serbest', onKontrol: onKontrolNormalle(ok), sunucuDegerlendirmesi: { engeller: [], uyarilar: [] } });
    const sb = { ip_yuk_makinesinde: false, serbest_ag: '10.20.30.0/24', k6_var: true, sikistirma: { statik: 0, dinamik: 0, sikistirmasiz: 0 } };
    expect(d({ ...sb, yollar_toplam: 0, yollar_200: 0 }).bilgiler.some((b) => b.startsWith('Sıkıştırma:'))).toBe(false);
    expect(d({ ...sb, yollar_toplam: null, yollar_200: null }).bilgiler.some((b) => b.startsWith('Sıkıştırma:'))).toBe(false);
    expect(d({ ...sb, yollar_toplam: 3, yollar_200: 3, sikistirma: { statik: 0, dinamik: 3, sikistirmasiz: 0 } }).bilgiler).toContain('Sıkıştırma: statik 0, dinamik 3, sıkıştırmasız 0');
  });
});

describe('Yük Testi — API istemcisi (fetch)', () => {
  afterEach(() => { vi.unstubAllGlobals(); });
  const jsonYanit = (govde: unknown, status = 200) => new Response(JSON.stringify(govde), { status, headers: { 'Content-Type': 'application/json' } });

  it('YO10 koşu listesi süzgeci + sayfalama sorgusu, dahaVar yalnız true; yeniden-oku POST ucu', async () => {
    const f = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async () => jsonYanit({ ok: true, kosular: [{ id: 5 }], dahaVar: true }));
    vi.stubGlobal('fetch', f);
    const r = await nginxLoadtestApi.kosular({ islem: 'kosu', durum: 'DONE', limit: 200, onceki: 41 });
    expect(f.mock.calls[0][0]).toBe('/api/nginx-loadtest/kosular?islem=kosu&durum=DONE&onceki=41&limit=200');
    expect(r).toMatchObject({ ok: true, kosular: [{ id: 5 }], dahaVar: true });
    f.mockImplementation(async () => jsonYanit({ ok: true, kosular: [], dahaVar: 'true' }));
    expect((await nginxLoadtestApi.kosular()).dahaVar).toBe(false);
    expect(f.mock.calls[1][0]).toBe('/api/nginx-loadtest/kosular');
    f.mockImplementation(async () => jsonYanit({ ok: false, code: 'yeniden_okunamaz', message: 'Yalnız sonucu okunamamış koşular yeniden okunabilir.' }, 409));
    const y = await nginxLoadtestApi.yenidenOku(17);
    expect(f.mock.calls[2][0]).toBe('/api/nginx-loadtest/kosular/17/yeniden-oku');
    expect(f.mock.calls[2][1]?.method).toBe('POST');
    expect(y).toMatchObject({ ok: false, code: 'yeniden_okunamaz', _httpStatus: 409 });
  });

  it('YO16 koşu listesi süzgeci ip / hedefTuru / motor; satırlar tür / motor ile normalleşir (serbestte hedefHost null)', async () => {
    const f = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async () => jsonYanit({
      ok: true, dahaVar: false,
      kosular: [{ id: 9, hedefHost: '', hedefIp: '10.20.30.40', hedefTuru: 'serbest', motor: 'wrk' }, { id: 8, hedefHost: 'GBNGXT10', hedefIp: '10.1.2.3' }],
    }));
    vi.stubGlobal('fetch', f);
    const r = await nginxLoadtestApi.kosular({ ip: '10.20.30.40', hedefTuru: 'serbest', motor: 'wrk', limit: 50 });
    expect(f.mock.calls[0][0]).toBe('/api/nginx-loadtest/kosular?ip=10.20.30.40&hedefTuru=serbest&motor=wrk&limit=50');
    expect(r.kosular[0]).toMatchObject({ id: 9, hedefHost: null, hedefIp: '10.20.30.40', hedefTuru: 'serbest', motor: 'wrk' });
    expect(r.kosular[1]).toMatchObject({ id: 8, hedefHost: 'GBNGXT10', hedefTuru: 'sunucu', motor: 'k6' });
    expect(r.kosular.map(hedefEtiketi)).toEqual(['10.20.30.40', 'GBNGXT10']);
    await nginxLoadtestApi.kosular({ hedef: 'GBNGXT10', islem: 'kosu', motor: 'k6' });
    expect(f.mock.calls[1][0]).toBe('/api/nginx-loadtest/kosular?islem=kosu&hedef=GBNGXT10&motor=k6');
  });

  it('YO17 /ip-sinifi istemcisi: sorguda ip + yukHost + hedefHost; iki şekil normalleşir; 409 / 424 ret gövdesi; bilinmeyen tür ret', async () => {
    const f = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>();
    vi.stubGlobal('fetch', f);
    f.mockResolvedValueOnce(jsonYanit({
      ok: true, tur: 'sunucu', ip: '10.1.2.5', host: 'GBNGXT10', env: 'TEST', vhostlar: ['a.example'], vhostVerisi: true, hizSiniri: '270', vuSiniri: null, uygun: true,
      neden: null, kod: null, kaynaklar: ['dbo.nginx_inventory', 'tarama'],
    }));
    const s = await nginxLoadtestApi.ipSinifi('10.1.2.5', { yukHost: 'GBNGXT34', hedefHost: 'GBNGXT10' });
    expect(f.mock.calls[0][0]).toBe('/api/nginx-loadtest/ip-sinifi?ip=10.1.2.5&yukHost=GBNGXT34&hedefHost=GBNGXT10');
    expect(s).toEqual({
      ok: true, tur: 'sunucu', ip: '10.1.2.5', host: 'GBNGXT10', env: 'TEST', vhostlar: ['a.example'], vhostVerisi: true, hizSiniri: 270, vuSiniri: null, uygun: true,
      neden: null, kod: null, kaynaklar: ['dbo.nginx_inventory', 'tarama'],
    });
    f.mockResolvedValueOnce(jsonYanit({ ok: true, tur: 'serbest', ip: '10.20.30.40', host: null, ag: '10.20.30.0/24', digerSahipler: [{ host: 'GBAPPT01', env: 'TEST' }, { env: 'TEST' }] }));
    expect(await nginxLoadtestApi.ipSinifi('10.20.30.40', { yukHost: null, hedefHost: null })).toEqual({
      ok: true, tur: 'serbest', ip: '10.20.30.40', host: null, ag: '10.20.30.0/24', digerSahipler: [{ host: 'GBAPPT01', env: 'TEST' }],
    });
    expect(f.mock.calls[1][0]).toBe('/api/nginx-loadtest/ip-sinifi?ip=10.20.30.40');
    f.mockResolvedValueOnce(jsonYanit({ ok: false, code: 'ip_belirsiz', message: '10.1.2.5 birden çok nginx sunucusunda tanımlı (GBNGXT10, GBNGXT11); hedef sunucuyu listeden seçin.', sahipler: [{ host: 'GBNGXT10', env: 'TEST', nginx: true, kaynaklar: ['tarama'] }] }, 409));
    const ret = await nginxLoadtestApi.ipSinifi('10.1.2.5', { yukHost: 'GBNGXT34' });
    expect(f.mock.calls[2][0]).toBe('/api/nginx-loadtest/ip-sinifi?ip=10.1.2.5&yukHost=GBNGXT34');
    expect(ret).toMatchObject({ ok: false, code: 'ip_belirsiz', _httpStatus: 409, sahipler: [{ host: 'GBNGXT10' }] });
    f.mockResolvedValueOnce(jsonYanit({ ok: false, code: 'envanter_bayat', message: 'Serbest hedef için envanter bayat: ...' }, 424));
    expect(await nginxLoadtestApi.ipSinifi('10.20.30.41')).toMatchObject({ ok: false, code: 'envanter_bayat', _httpStatus: 424 });
    f.mockResolvedValueOnce(jsonYanit({ ok: true, tur: 'bilinmeyen', ip: '10.20.30.42' }));
    expect(await nginxLoadtestApi.ipSinifi('10.20.30.42')).toMatchObject({ ok: false, code: 'beklenmeyen' });
  });
});
