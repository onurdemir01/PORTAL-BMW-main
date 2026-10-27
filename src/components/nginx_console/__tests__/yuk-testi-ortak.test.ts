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
import { describe, it, expect, vi, afterEach } from 'vitest';
import { adimNormalle, kosuNormalle, nginxLoadtestApi, onKontrolNormalle, type NlAdim, type NlKosuAyrinti, type NlSinirlar } from '@/api/nginxLoadtestApi';
import {
  GECERLILIK, OKUNAMADI_ACIKLAMASI, SINIR_SIFIR_METNI, adimEtiketi, adimSirala, butceSn, ciktiBirlestir, durdurBaslatilamadiMetni, hedefSinirlari, hizGrupla,
  hizlariAyristir, kalanSurecDurdurulabilir, onKontrolDegerlendir, onKontrolKalanMs, parametreHatalari, sonucOkunuyorMetni, uyarilariAyir, yenidenOkunabilir, ON_KONTROL_OMRU_MS,
} from '../yukTesti/yukTestiOrtak';

// sureMin 40 (2026-10-27, analiz-1): analiz penceresi [ilk+3, son-2] ve >= 30 sn ister; 30-36 sn her adimi GECERSIZ yapiyordu.
const S: NlSinirlar = { maxHiz: 450, maxTekrar: 3, sureMin: 40, sureMax: 300, isinmaMax: 60, maxVu: 199, maxButceSn: 2700 };
const P = { hizlar: [100, 250, 400], tekrar: 2, isinma: 30, sure: 120, bosluk: 30, bosta: 60, maxvu: 150, kip: 'yeni' as const, ae: 'br' as const };

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
});
