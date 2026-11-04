// src/components/nginx_console/__tests__/yuk-testi-sade.test.tsx — Yük Testi sadeleştirme turu (2026-11-02).
//
// Kullanici geri bildirimi (R2, GBNGXT33, AWX 3474239): "girdiler ve ciktilar kafami karistirdi; cok parametre var, her
// birinin etkisi ne; ciktida kac istek gitti, medyan, p95, p99 nasil gorulur". R2 gecersizdi: kosu sirasinda nginx
// konfigurasyonu degisti ve iki kez reload oldu; ekran o adimlarda NEGATIF CPU-ms ve kapasite gosterdi.
// SD1 Hazir ayarlar her sinir kumesinde (genel, serbest, daraltilmis hedef, dar sure) ve iki motorda sunucu kurallarindan
//     (parametreHatalari) gecer, butce <= ust sinir; Hizli ~5 dk, Standart = sunucu varsayilani (sinira sigiyorsa),
//     Kapasite son kademesi hedef siniri; wrk kademeleri is parcacigina tam bolunur.
// SD2 hangiHazirAyar: varsayilan form Standart; tek alan degisince Özel (null); motorun ilgisiz alani secimi bozmaz.
// SD3 Her analiz neden / uyari kodu (sade_sozlesme 3 + analiz.cjs + cpu_kaydedici.sh) duz cumleye cevrilir, bilinmeyen kod
//     `bilinmiyor`; kaydedici uyarisi "kayit:<kesit>:..." neden kuralina (kayit:...) DUSMEZ; Turkce poller nedeni cumle.
// SD4 Kosu nedeni "<TUR>(a;b(c;d))" parantez icini bolmeden ayrilir.
// SD5 adimNormalle: negatif / sifir CPU-ms ve kapasite null + cpuOlculemedi (eski satir negatif_deger; reload nedeni
//     reload); sunucunun kodu korunur; reloadlar snake_case'ten.
// SD6 sonucOzetiHesapla (R2 benzeri): toplam istek, en iyi / en kotu p95 gecerli adimlardan, hata yok; 429 / 5xx toplami.
// SD7 sonucOzetiNormalle snake_case; bos nesne null.
// SD8 Yeni kosu formu: ustte hazir ayarlar (Standart basili), tahmini toplam sure buyuk; Gelişmiş ayarlar kapali (hidden)
//     ve her alanin etkisi yazili; Hizli deneme alanlari doldurur, sure 5 dk 10 sn, govde kanonik; elle degisince Özel;
//     gelismis alanda hata bolumu acar ve sayiyi soyler; hata duzelince bolum acik kalir, odak alanda kalir.
// SD9 Kosu ayrintisi R2: ozet satiri (toplam istek, en iyi / en kotu p95, hata yok), ozet tablo (istek, gercek hiz, p50,
//     p95, p99, hata, 429, 5xx, host CPU, sonuc; kolon ipuclari ve "Sütunlar ne anlatıyor?"), nedenler duz cumle ve TEK
//     kez (etkilenen adimlar + reload ani), negatif CPU hicbir yerde yok ("—" + neden); Ayrıntı kapali.
// SD10 Eski kosu (nIstek / p50 / p99 yok, sonucOzeti yok): tablo "—" ile cizilir, ozet adimlardan.
// SD11 Gercek R2 sayilari sunucu zincirinden (fikstur RG2'de kilitli): ozet tablo, iki reload ani, CPU "—".
// SD12 analiz.cjs NEDEN_KALIPLARI'ndaki her kod ekranda taninir (sunucu kalibina uyan ornek, duz cumle).
// SD13 Hazir ayarlar sunucunun KENDI dogrulamasindan (dogrula.parametreler) gecer; butce iki tarafta ayni.
// SD15 Ozet tablo kolon genislikleri toplami < 56rem (1280 + sol menude tablo kaymaz).
// SD14 Isinmada / boslukta / kosu oncesinde baslayip olcume tasan reload: neden altinda (evre suzgeci yok), ozet satiri
//     "ölçüm etkilenmedi" demez.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createRequire } from 'node:module';
import { screen, fireEvent, waitFor, within } from '@testing-library/react';
import { render } from '@/test/test-utils';
import { adimNormalle, sonucOzetiNormalle, type NlAdim, type NlKosuAyrinti, type NlSinirlar, type NlVarsayilanlar } from '@/api/nginxLoadtestApi';
import { nedenGruplari, ozetKolonlari, reloadOzetMetni } from '../yukTesti/SonucOzeti';
import { ALAN_ACIKLAMASI, HAZIR_AYAR_SIRASI, hangiHazirAyar, hazirAyar, hazirAyarParametresi, hazirAyarSuresiSn } from '../yukTesti/hazirAyarlar';
import { CPU_OLCULEMEDI, kosuNedeniniAyir, nedenAcikla, nedenleriBol, uyariAcikla } from '../yukTesti/nedenler';
import { butceSn, hedefSinirlari, parametreHatalari, sonucOzetiHesapla } from '../yukTesti/yukTestiOrtak';

// 2026-11-03 (K1): sunucunun SINIRLAR'i (hiz 5000, VU 1000, wrk baglanti 199, tavan 5000).
const SINIR: NlSinirlar = {
  maxHiz: 5000, maxTekrar: 3, sureMin: 40, sureMax: 300, isinmaMax: 60, maxVu: 1000, maxButceSn: 2700,
  baglantiMin: 1, maxBaglanti: 199, maxBaglantiSayisi: 5, isParcacigiMin: 1, maxIsParcacigi: 16, serbestTavanRps: 200, serbestMaxBaglanti: 50,
  maxTavanRps: 5000,
};
const VARSAYILAN: NlVarsayilanlar = {
  motor: 'k6', hizlar: [100, 250, 400], maxvu: 150, baglantilar: [2, 4, 8], is_parcacigi: 2, tekrar: 2, isinma: 30, sure: 120, bosluk: 30, bosta: 60,
  kip: 'yeni', ae: 'br', serbest: { hizlar: [50, 100, 200], maxvu: 50 },
};

describe('Yük Testi sade — hazır ayarlar (SD1, SD2)', () => {
  const KUMELER: [string, NlSinirlar, boolean][] = [
    ['genel', SINIR, false],
    ['serbest', hedefSinirlari(SINIR, null, { hedefTuru: 'serbest' }), true],
    // K2: olculmus limit artik daraltmaz; kucuk sinirli kume (eski sunucu / test) hazir ayar kuralini yine sinar.
    ['dar sinir (hiz 120, VU / baglanti 6)', { ...SINIR, maxHiz: 120, maxVu: 6, maxBaglanti: 6 }, false],
    ['cok dar sinir (3 / 3)', { ...SINIR, maxHiz: 3, maxVu: 3, maxBaglanti: 3 }, false],
    ['olculmus limit daraltmaz (limit_req 120, limit_conn 6)', hedefSinirlari(SINIR, { hizSiniri: 120, vuSiniri: 6 }), false],
    ['dar sure (min 100, butce 1000)', { ...SINIR, sureMin: 100, maxButceSn: 1000 }, false],
  ];
  it('SD1 her küme ve iki motorda sunucu kuralları geçer, bütçe ≤ üst sınır', () => {
    for (const [ad, sinir, serbest] of KUMELER) {
      for (const h of HAZIR_AYAR_SIRASI) {
        const d = hazirAyar(h, sinir, VARSAYILAN, { serbest });
        for (const motor of ['k6', 'wrk'] as const) {
          const p = hazirAyarParametresi(d, motor);
          // limit_conn < 10 olan hedefte k6 hic kosamaz (sunucu: maxvu 10..vuSiniri): yalniz VU alani hata verir.
          const vuImkansiz = motor === 'k6' && sinir.maxVu < 10;
          expect({ ad, h, motor, hata: parametreHatalari(p, sinir) }).toEqual({ ad, h, motor, hata: vuImkansiz ? { maxvu: `10–${sinir.maxVu}` } : {} });
          if (vuImkansiz) continue;
          expect(butceSn(p)).toBeLessThanOrEqual(sinir.maxButceSn);
          const kademe = motor === 'wrk' ? p.baglantilar! : p.hizlar!;
          expect([...kademe].sort((a, b) => a - b)).toEqual(kademe);
          expect(new Set(kademe).size).toBe(kademe.length);
        }
      }
    }
    // Hizli deneme: ~5 dk, kucuk yuk (eski 450 tavaninin %10 / %20'si: 5000 tavaninda da 45 / 90), tekrar yok.
    const hizli = hazirAyar('hizli', SINIR, VARSAYILAN);
    expect(hizli).toMatchObject({ hizlar: '45 90', baglantilar: '2 4', is_parcacigi: '2', tekrar: '1', sure: '40' });
    expect(hazirAyarSuresiSn(hizli, 'k6')).toBe(310);
    // Standart = sunucu varsayilani; serbestte serbest varsayilani.
    expect(hazirAyar('standart', SINIR, VARSAYILAN)).toEqual({ hizlar: '100 250 400', maxvu: '150', baglantilar: '2 4 8', is_parcacigi: '2', tekrar: '2', isinma: '30', sure: '120', bosluk: '30', bosta: '60' });
    expect(hazirAyar('standart', KUMELER[1][1], VARSAYILAN, { serbest: true })).toMatchObject({ hizlar: '50 100 200', maxvu: '50' });
    // Varsayilan hiz hedef sinirini asarsa olceklenir (120: %25 / %50 / %85).
    expect(hazirAyar('standart', KUMELER[2][1], VARSAYILAN).hizlar).toBe('30 60 100');
    // Kapasite: bes kademe, son kademe hedef siniri; VU sinirin tamami.
    expect(hazirAyar('kapasite', SINIR, VARSAYILAN)).toMatchObject({ hizlar: '1000 2000 3000 4000 5000', maxvu: '1000', baglantilar: '2 4 8 16 32' });
    expect(hazirAyarSuresiSn(hazirAyar('kapasite', SINIR, VARSAYILAN), 'k6')).toBe(60 + 5 * 2 * (30 + 120 + 30 + 20) + 120);
    // Olculmus limit hazir ayari DARALTMAZ (K2): uyari formda / on kontrolde.
    expect(hazirAyar('kapasite', hedefSinirlari(SINIR, { hizSiniri: 270, vuSiniri: 99 }), VARSAYILAN)).toMatchObject({ hizlar: '1000 2000 3000 4000 5000', maxvu: '1000' });
    // Dar sinirda (sinir 450 ve altinda) hizli deneme sinirin %10 / %20'si (eski davranis).
    expect(hazirAyar('hizli', { ...SINIR, maxHiz: 450 }, VARSAYILAN).hizlar).toBe('45 90');
    expect(hazirAyar('hizli', { ...SINIR, maxHiz: 120 }, VARSAYILAN).hizlar).toBe('12 25');
    expect(hazirAyar('kapasite', KUMELER[1][1], VARSAYILAN, { serbest: true })).toMatchObject({ hizlar: '40 80 120 160 200', maxvu: '50', baglantilar: '2 4 8 16 32' });
    expect(hazirAyar('kapasite', KUMELER[2][1], VARSAYILAN).baglantilar).toBe('2 4');
    // Butce dar: once tekrar, sonra sure, en son kademe (ortadan) azalir: 4 x 1 x (30+100+30+20) + 60 + 120 = 900.
    expect(hazirAyar('kapasite', KUMELER[5][1], VARSAYILAN)).toMatchObject({ tekrar: '1', sure: '100', hizlar: '1000 2000 4000 5000', baglantilar: '2 4 16 32' });
  });

  it('SD2 varsayılan form Standart; tek alan değişince Özel; ilgisiz motor alanı seçimi bozmaz', () => {
    const ayarlar = Object.fromEntries(HAZIR_AYAR_SIRASI.map((a) => [a, hazirAyar(a, SINIR, VARSAYILAN)])) as Record<(typeof HAZIR_AYAR_SIRASI)[number], ReturnType<typeof hazirAyar>>;
    const form = { ...ayarlar.standart };
    expect(hangiHazirAyar(form, 'k6', ayarlar)).toBe('standart');
    expect(hangiHazirAyar({ ...form, hizlar: '100,250,400' }, 'k6', ayarlar)).toBe('standart');
    expect(hangiHazirAyar({ ...form, sure: '90' }, 'k6', ayarlar)).toBeNull();
    expect(hangiHazirAyar({ ...form, baglantilar: '3 6' }, 'k6', ayarlar)).toBe('standart');
    expect(hangiHazirAyar({ ...form, baglantilar: '3 6' }, 'wrk', ayarlar)).toBeNull();
    expect(hangiHazirAyar({ ...ayarlar.kapasite }, 'wrk', ayarlar)).toBe('kapasite');
  });
});

describe('Yük Testi sade — neden cümleleri (SD3, SD4)', () => {
  it('SD3 her kod düz cümleye çevrilir; bilinmeyen kod işaretlenir', () => {
    const NEDENLER: [string, RegExp][] = [
      ['k6_rc=99', /^k6 hata koduyla \(99\) bitti/],
      ['wrk_rc=1', /^wrk hata koduyla \(1\) bitti/],
      ['429(istemci=12,sunucu=11)', /^Hedef 12 isteği 429 ile reddetti .*sunucu logunda 11/],
      ['429(istemci=3)', /^Hedef 3 isteği 429 ile reddetti \(hız sınırı: limit_req \/ limit_conn\)/],
      ['5xx(istemci=4,sunucu=4)', /^Sunucu 4 isteğe 5xx hata yanıtı verdi \(sunucu logunda 4\)/],
      ['http2', /^İstekler HTTP\/2 ile gitti/],
      ['hata_%0.35(>%0.1)', /^İsteklerin %0,35’i başarısız oldu .*eşik %0,1/],
      ['log_istemci_farki_%3.4', /^Sunucu logundaki istek sayısı yük aracının gönderdiğinden %3,4 farklı/],
      ['kayit:log_dondu:access.log', /^Ölçüm sırasında nginx logu döndürüldü ya da küçüldü \(rotate: access\.log\)/],
      ['kayit:baska_bir_sey', /^CPU kaydedicisi bu adımı geçersiz saydı \(baska_bir_sey\)/],
      ['disk_%71', /^\/web_log diski %71 dolu/],
      ['konf_degisti', /^Test sırasında nginx konfigürasyonu değişti; bu adımın sonuçları güvenilir değil \(değişikliğin anı bilinmez/],
      ['pencere_kisa(12s)', /^CPU kaydedicisi ölçümün yalnız 12 saniyesini gördü/],
      ['reload(worker_pid_degisti)', /^Test sırasında nginx yeniden yüklendi \(reload\): worker süreçleri değişti; bu adımın CPU ölçümü ve sonuçları güvenilir değil\.$/],
      ['hatali_kosu(kos.sh_durdurdu)', /^Yük betiği bu adımı yarıda durdurdu/],
      ['tamamlanmadi(istemci_sonucu_yok)', /^Adım başladı ama sonucu yazılmadı/],
      ['istemci_sonucu_yok', /^Hiçbir adımın sonucu yazılmadı/],
      ['doyma:dropped=63', /^Yük aracı istenen hızı tutturamadı: 63 istek zamanında gönderilemedi \(dropped\)/],
      ['doyma:host_cpu_%93.5(>%90)', /^Hedefin CPU’su bu adımda ortalama %93,5 \(> %90\)/],
    ];
    for (const [kod, re] of NEDENLER) {
      const a = nedenAcikla(kod);
      expect({ kod, bilinmiyor: a.bilinmiyor ?? false, eslesti: re.test(a.cumle), cumle: a.cumle }).toMatchObject({ kod, bilinmiyor: false, eslesti: true });
      expect(a.kod).toBe(kod);
    }
    const UYARILAR: [string, RegExp][] = [
      ['dropped_iterations=4', /^4 istek zamanında gönderilemedi/],
      ['saat_farki~-3.5s(sunucu-istemci)', /saati yaklaşık -3,5 sn farklı/],
      ['log_satiri_yok:pencere_istemci_saatinden', /^Sunucu logunda bu adımın satırı bulunamadı/],
      ['sunucu_logunda_bu_tur_yok', /^Sunucu logunda bu adıma ait hiç satır yok/],
      ['yeni_kipinde_baglanti_yeniden_kullanilmis_%12', /isteklerin %12’i açık bir bağlantıyı yeniden kullandı/],
      ['sunucu_kaydi_yok', /^Bu adımın zaman aralığında CPU kaydı yok/],
      ['sunucu_kaydi_yok(cpu_olculmedi)', /^Hedef sunucunun CPU kaydı yok/],
      ['pencerede_ornek_yok', /^Ölçüm penceresinde CPU örneği yok/],
      ['arka_plan_yok(0_kabul)', /^Arka plan CPU’su ölçülemedi \(sıfır kabul edildi\)/],
      ['arka_plan_yok:R2_gbngxt33(kosu_disi_bosluk_bulunamadi)', /^Kayıt R2_gbngxt33: yük olmayan boş bir aralık bulunamadı/],
      ['arka_plan_az(20s)', /^Arka plan CPU’su yalnız 20 sn ölçüldü/],
      ['diger_trafik_%7', /test isteklerinin %7’i kadar/],
      ['perf_ek_yuku(kararda_kullanilmaz)', /^perf ölçümü açık/],
      ['kayit:R2_gbngxt33:konf_degisti(kayit_sirasinda):0dc6843c88ef3f73->648462d7a1358dd1', /^Kayıt sırasında hedefin nginx konfigürasyonu değişti \(özet 0dc6843c → 648462d7\)/],
      ['kayit:R2_gbngxt33:disk_%70:/web_log(>=65)', /^Hedefte \/web_log %70 dolu/],
      ['kayit:R2_gbngxt33:konf_okunamadi:/etc/nginx(NGINX_KONF_DIZIN verin)', /^CPU kaydedicisi nginx konfigürasyonunu okuyamadı/],
      ['kayit:R2_gbngxt33:okunabilir_log_yok:/web_log/*.log', /^CPU kaydedicisi okunabilir bir nginx logu bulamadı/],
      ['kayit:R2_gbngxt33:test_satiri_yok(yanlis_sunucu?_LOGDIR?_log_format_user-agent_iceriyor_mu?)', /^Sunucu logunda hiç test isteği görülmedi/],
      ['kesit_baska_adimin:R1_gbngxt33', /^Sonuç dizininde başka bir koşunun kaydı var \(R1_gbngxt33\)/],
      ['baska_adim_atlandi:R1_K_yeni_br_100_r1', /^Başka bir koşunun adımı \(R1_K_yeni_br_100_r1\)/],
      ['serbest_kosuda_sunucu_dosyalari_yok_sayildi(4)', /dizindeki 4 sunucu dosyası yok sayıldı/],
      ['sunucu_olcumu_yok(serbest_hedef)', /^Serbest hedef: CPU ve sunucu logu ölçülmez/],
      ['sunucu_logu_yok(log_istemci_karsilastirmasi_yapilmadi)', /^Hedefin nginx logu okunamadı/],
      ['wrk_tls_payi_hesaplanmaz(oturum_devami_ya_da_tls13_olabilir)', /^wrk TLS sürümünü sabitlemez/],
      ["tekrar_kosu_ayristirilamadi(log'da_deneme_kolonu_yok)", /^Adım yeniden denenmiş ama sunucu logunda denemeler ayırt edilemedi/],
      ['tekrar_kosu:deneme_2_kullanildi(1200_eski_satir_atildi)', /2\. deneme kullanıldı, önceki denemenin 1\.200 log satırı atıldı/],
      ['cpu_olculemedi(reload)', new RegExp(`^${CPU_OLCULEMEDI.reload.replace(/[()]/g, '\\$&')}$`)],
      ['cpu_olculemedi(sayac_geriledi)', /^CPU sayacı geriye gitti/],
      ['cpu_olculemedi(net_negatif)', /^Arka plan CPU’su ölçülenden büyük çıktı/],
    ];
    for (const [kod, re] of UYARILAR) {
      const a = uyariAcikla(kod);
      expect({ kod, bilinmiyor: a.bilinmiyor ?? false, eslesti: re.test(a.cumle), cumle: a.cumle }).toMatchObject({ kod, bilinmiyor: false, eslesti: true });
    }
    // Katlanmis adim uyarisi: TUR ayrilir.
    expect(uyariAcikla('R2_K_ka_identity_100_r2: dropped_iterations=4')).toMatchObject({ tur: 'R2_K_ka_identity_100_r2', kod: 'dropped_iterations=4' });
    // Bilinmeyen kod oldugu gibi, isaretli; Turkce poller nedeni cumle (kod degil).
    expect(nedenAcikla('yeni_bir_kod(3)')).toMatchObject({ cumle: 'yeni_bir_kod(3)', bilinmiyor: true });
    expect(nedenAcikla('Sonuç dosyası okunamadı: SHA256SUMS uyuşmuyor')).toMatchObject({ cumle: 'Sonuç dosyası okunamadı: SHA256SUMS uyuşmuyor', kod: '' });
    expect(nedenAcikla('Sonuç dosyası okunamadı: SHA256SUMS uyuşmuyor').bilinmiyor).toBeUndefined();
  });

  it('SD4 koşu nedeni TUR ve kodlarına parantez içi bölünmeden ayrılır', () => {
    expect(nedenleriBol('konf_degisti;reload(worker_pid_degisti);429(istemci=3,sunucu=3)')).toEqual(['konf_degisti', 'reload(worker_pid_degisti)', '429(istemci=3,sunucu=3)']);
    // Parantez icindeki ';' bolmez (ic ice kod), bos parca atilir.
    expect(nedenleriBol('a;b(c;d(e;f));;g')).toEqual(['a', 'b(c;d(e;f))', 'g']);
    expect(kosuNedeniniAyir('R3_K_yeni_br_100_r1(hatali_kosu(x;y);konf_degisti)')).toEqual({ tur: 'R3_K_yeni_br_100_r1', nedenler: ['hatali_kosu(x;y)', 'konf_degisti'] });
    expect(kosuNedeniniAyir('R2_K_ka_identity_100_r2(konf_degisti;reload(worker_pid_degisti))')).toEqual({ tur: 'R2_K_ka_identity_100_r2', nedenler: ['konf_degisti', 'reload(worker_pid_degisti)'] });
    expect(kosuNedeniniAyir('istemci_sonucu_yok')).toEqual({ tur: null, nedenler: ['istemci_sonucu_yok'] });
  });
});

describe('Yük Testi sade — normalleştirme ve özet (SD5–SD7)', () => {
  it('SD5 negatif / sıfır CPU-ms ve kapasite null + neden; sunucu kodu korunur; reloadlar', () => {
    const eski = adimNormalle({ tur: 'R2_K_ka_identity_100_r2', hiz: 100, cpu_ms_istek: -1.372, kapasite_rps: -4665, nedenler: ['konf_degisti'] });
    expect(eski).toMatchObject({ cpuMsIstek: null, kapasiteRps: null, cpuOlculemedi: 'negatif_deger', reloadlar: [] });
    const reload = adimNormalle({ tur: 'R2_K_ka_identity_250_r2', hiz: 250, cpu_ms_istek: 0.2, kapasite_rps: 30000, nedenler: '["konf_degisti","reload(worker_pid_degisti)"]' });
    expect(reload).toMatchObject({ cpuMsIstek: null, kapasiteRps: null, cpuOlculemedi: 'reload' });
    expect(adimNormalle({ tur: 'x', cpu_ms_istek: 0, kapasite_rps: null })).toMatchObject({ cpuMsIstek: null, cpuOlculemedi: 'negatif_deger' });
    const sunucu = adimNormalle({ tur: 'x', cpuMsIstek: null, kapasiteRps: null, cpuOlculemedi: 'sayac_geriledi', reloadlar: [{ t: 1761400000.5, t_once: 1761399998, t_son: 1761400030, tur: 'x', faz: 'olcum' }] });
    expect(sunucu).toMatchObject({ cpuOlculemedi: 'sayac_geriledi', reloadlar: [{ t: 1761400000.5, tOnce: 1761399998, tSon: 1761400030, tur: 'x', faz: 'olcum' }] });
    // Gecerli deger dokunulmaz; olculmeyen (null) adimda neden yazilmaz.
    expect(adimNormalle({ tur: 'x', cpu_ms_istek: 0.412, kapasite_rps: 15000 })).toMatchObject({ cpuMsIstek: 0.412, kapasiteRps: 15000, cpuOlculemedi: null });
    expect(adimNormalle({ tur: 'x' })).toMatchObject({ cpuMsIstek: null, cpuOlculemedi: null });
  });

  it('SD6 sonucOzetiHesapla: R2 benzeri adımlar', () => {
    const o = sonucOzetiHesapla(R2_ADIMLAR.map(adimNormalle));
    expect(o).toMatchObject({
      adimSayisi: 6, gecerliAdimSayisi: 4, toplamIstek: 12001 + 11996 + 30001 + 29937 + 48001 + 48000,
      p95EnIyi: { deger: 1.346, tur: 'R2_K_ka_identity_400_r2' }, p95EnKotu: { deger: 2.126, tur: 'R2_K_ka_identity_100_r1' }, p95Kapsam: 'gecerli',
      toplam429: 0, toplam5xx: 0, enYuksekHataOrani: 0, hataVar: false, cpuOlculemeyenAdim: 2,
    });
    // Gecersiz adimin uc p95'i en iyi / en kotuye girmez (gecerli adim varken).
    const karisik = sonucOzetiHesapla([
      adimNormalle({ tur: 'g', gecerlilik: 'GECERLI', p95: 5 }), adimNormalle({ tur: 'd', gecerlilik: 'DOYMA', p95: 7 }),
      adimNormalle({ tur: 'x', gecerlilik: 'GECERSIZ', p95: 50 }), adimNormalle({ tur: 'y', gecerlilik: 'HATALI', p95: 1 }),
    ]);
    expect(karisik).toMatchObject({ p95EnIyi: { deger: 5, tur: 'g' }, p95EnKotu: { deger: 7, tur: 'd' }, p95Kapsam: 'gecerli', gecerliAdimSayisi: 2 });
    const hatali = sonucOzetiHesapla([adimNormalle({ tur: 'a', gecerlilik: 'GECERSIZ', p95: 5, n_429: 3, n_5xx: 1, hata_orani: 0.02 })]);
    expect(hatali).toMatchObject({ toplam429: 3, toplam5xx: 1, hataVar: true, p95Kapsam: 'tum', p95EnIyi: { deger: 5, tur: 'a' }, toplamIstek: null });
  });

  it('SD7 sonucOzetiNormalle snake_case; boş nesne null', () => {
    expect(sonucOzetiNormalle({})).toBeNull();
    expect(sonucOzetiNormalle({
      adim_sayisi: 6, gecerli_adim_sayisi: 4, toplam_istek: 1000, p95_en_iyi: { deger: '1.3', tur: 'a' }, p95_en_kotu: null, p95_kapsam: 'gecerli',
      toplam_429: 0, toplam_5xx: 0, en_yuksek_hata_orani: 0, hata_var: false, cpu_olculemeyen_adim: 2, konf_degisti: true, yuk_doydu_adim: 1,
      reloadlar: [{ t: 10, t_once: 8, t_son: 40, tur: 'a', faz: 'olcum', kesit: 'R2_gbngxt33', worker_once: 8, worker_sonra: 8, kapanan_en_cok: 8, etkilenen_turlar: ['a'] }],
    })).toEqual({
      adimSayisi: 6, gecerliAdimSayisi: 4, toplamIstek: 1000, p95EnIyi: { deger: 1.3, tur: 'a' }, p95EnKotu: null, p95Kapsam: 'gecerli',
      toplam429: 0, toplam5xx: 0, enYuksekHataOrani: 0, hataVar: false, cpuOlculemeyenAdim: 2, yukDoyduAdim: 1, konfDegisti: true,
      reloadlar: [{ t: 10, tOnce: 8, tSon: 40, tur: 'a', faz: 'olcum', kesit: 'R2_gbngxt33', workerOnce: 8, workerSonra: 8, kapananEnCok: 8, etkilenenTurlar: ['a'] }],
    });
  });
});

// ── Ekran testleri ──────────────────────────────────────────────────────────────────
/** R2 (GBNGXT33, AWX 3474239) is ciktisindaki degerler; 100_r2 ve 250_r2 reload + konf_degisti ile gecersiz, eski
 *  analizin yazdigi negatif CPU-ms / kapasite ile. */
const R2_ADIMLAR = [
  { tur: 'R2_K_ka_identity_100_r1', hiz: 100, n_istek: 12001, gercek_rps: 100.008, p50: 1.609, p95: 2.126, p99: 2.534, cpu_ms_istek: 0.31, kapasite_rps: 20645, host_cpu_ort: 4 },
  { tur: 'R2_K_ka_identity_100_r2', hiz: 100, n_istek: 11996, gercek_rps: 99.967, p50: 1.542, p95: 1.984, p99: 5.203, dropped: 4, cpu_ms_istek: -1.372, kapasite_rps: -4665, host_cpu_ort: 3, gecerlilik: 'GECERSIZ', nedenler: ['konf_degisti', 'reload(worker_pid_degisti)'] },
  { tur: 'R2_K_ka_identity_250_r1', hiz: 250, n_istek: 30001, gercek_rps: 250.008, p50: 1.252, p95: 1.594, p99: 1.872, cpu_ms_istek: 0.28, kapasite_rps: 22857, host_cpu_ort: 8 },
  { tur: 'R2_K_ka_identity_250_r2', hiz: 250, n_istek: 29937, gercek_rps: 249.475, p50: 1.227, p95: 1.728, p99: 4.997, dropped: 63, cpu_ms_istek: -0.873, kapasite_rps: -7328, host_cpu_ort: 8, gecerlilik: 'GECERSIZ', nedenler: ['konf_degisti', 'reload(worker_pid_degisti)'] },
  { tur: 'R2_K_ka_identity_400_r1', hiz: 400, n_istek: 48001, gercek_rps: 400.008, p50: 1.026, p95: 1.404, p99: 1.953, cpu_ms_istek: 0.26, kapasite_rps: 24615, host_cpu_ort: 12 },
  { tur: 'R2_K_ka_identity_400_r2', hiz: 400, n_istek: 48000, gercek_rps: 400, p50: 1.033, p95: 1.346, p99: 1.662, cpu_ms_istek: 0.27, kapasite_rps: 23703, host_cpu_ort: 12 },
].map((a) => ({ senaryo: 'K', kip: 'ka', ae: 'identity', gecerlilik: 'GECERLI', nedenler: [], n_429: 0, n_5xx: 0, hata_orani: 0, dropped: 0, ...a }));

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

const HEDEFLER = {
  ok: true,
  hedefler: [{ host: 'GBNGXT33', env: 'TEST', ipler: ['192.168.133.27'], vhostlar: ['glomo-test.garantibbva.com.tr'], vhostVerisi: true, uygun: true, neden: null }],
  yukHostlari: [{ host: 'GBNGXT34', env: 'TEST', uygun: true, neden: null }],
  sinirlar: SINIR, varsayilan: VARSAYILAN, serbest: { acik: true, aglar: [] }, motorlar: ['k6', 'wrk'],
  araclar: { hazir: true, aracId: 5, k6Surum: 'v0.49.0', wrkSurum: '4.2.0', kod: null, mesaj: null },
};
const SENARYO = { id: 3, ad: 'GLOMO', aciklama: null, vhost: 'glomo-test.garantibbva.com.tr', senaryoTur: 'K', yolSayisi: 264, sha256: 'b'.repeat(64), kaynak: 'har', createdBy: 'onur', createdAt: '2026-10-26T10:00:00Z' };
function ayrinti(o: Partial<NlKosuAyrinti> = {}): NlKosuAyrinti {
  return {
    id: 2, islem: 'kosu', etiket: null, adim: 'R2', hedefHost: 'GBNGXT33', hedefIp: '192.168.133.27', vhost: 'glomo-test.garantibbva.com.tr', yukHost: 'GBNGXT34',
    senaryoId: 3, senaryoAd: 'GLOMO', durum: 'DONE', gecerlilik: 'KISMI', createdBy: 'onur', createdAt: '2026-11-02T11:45:00Z', startedAt: '2026-11-02T11:46:00Z',
    finishedAt: '2026-11-02T12:08:00Z', awxJobId: 3474239, hedefTuru: 'sunucu', motor: 'k6', serbestAg: null, planUyarilari: [],
    parametreler: { motor: 'k6', hizlar: [100, 250, 400], maxvu: 150, tekrar: 2, isinma: 30, sure: 120, bosluk: 30, bosta: 60, kip: 'ka', ae: 'identity' },
    onKontrol: null, gecersizNedenleri: ['R2_K_ka_identity_100_r2(konf_degisti;reload(worker_pid_degisti))', 'R2_K_ka_identity_250_r2(konf_degisti;reload(worker_pid_degisti))'],
    sonucOzet: null, onKontrolKosuId: 1, sunucuDegerlendirmesi: null, onKontrolYasSn: null, isDurumu: 'OK', isHatasi: null,
    analiz: { nproc: 8, cpuTlsliPay: null, uyarilar: ['kayit:R2_gbngxt33:konf_degisti(kayit_sirasinda):0dc6843c88ef3f73->648462d7a1358dd1'], okumaHatasi: null },
    durdurIsi: null, sonuclandirmaDenemesi: 0, aracId: null, aracSeti: null, sonucOzeti: null, protokol: 'h1', ...o,
  };
}
/** 14:59:12 Istanbul saati: ekran PORTAL_TZ'de yazar (test makinesinin saat dilimi sonucu degistirmez). */
const T_RELOAD = Date.parse('2026-11-02T14:59:12+03:00') / 1000;
const T_ISINMA = Date.parse('2026-11-02T15:02:20+03:00') / 1000;
/** Beklenen saat metni: epoch -> Istanbul (UTC+3, yaz saati yok) "SS:DD:ss", ekran kodundan bagimsiz hesap. */
const saat = (t: number) => new Date((t + 3 * 3600) * 1000).toISOString().slice(11, 19);

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

describe('Yük Testi sade — yeni koşu formu (SD8)', () => {
  it('SD8 hazır ayarlar, büyük tahmini süre, kapalı gelişmiş ayarlar ve açıklamalar; gövde kanonik', async () => {
    api.onKontrol.mockResolvedValue({ ok: false, code: 'kilit_dolu', message: 'Başka bir yük testi sürüyor.', _httpStatus: 409 });
    render(<YukTestiTab isAdmin />);
    fireEvent.click(await screen.findByRole('tab', { name: /Yeni koşu/ }));
    fireEvent.change(await screen.findByLabelText('Senaryo'), { target: { value: '3' } });
    const grup = screen.getByRole('group', { name: 'Hazır ayar' });
    const dugme = (ad: RegExp) => within(grup).getByRole('button', { name: ad });
    // Baslangic = sunucu varsayilani = Standart; sureler dugmelerde.
    expect(dugme(/^Standart/)).toHaveAttribute('aria-pressed', 'true');
    expect(dugme(/^Hızlı deneme/)).toHaveAttribute('aria-pressed', 'false');
    expect(dugme(/^Hızlı deneme/).textContent).toContain('≈ 5 dk 10 sn');
    expect(dugme(/^Standart/).textContent).toContain('≈ 23 dk 00 sn');
    expect(dugme(/^Kapasite/).textContent).toContain('≈ 36 dk 20 sn');
    // Ustte yalniz yuk ve olcum suresi; gelismis alanlar kapali (hidden), etkileri yazili.
    expect(screen.getByLabelText('Hızlar (istek/sn)')).toBeVisible();
    expect(screen.getByLabelText('Ölçüm süresi (sn)')).toBeVisible();
    const gelismis = screen.getByRole('button', { name: /^Gelişmiş ayarlar/ });
    expect(gelismis).toHaveAttribute('aria-expanded', 'false');
    for (const [etiket, aciklama] of [
      ['Tekrar', ALAN_ACIKLAMASI.tekrar], ['Isınma (sn)', ALAN_ACIKLAMASI.isinma], ['Adımlar arası bekleme (sn)', ALAN_ACIKLAMASI.bosluk],
      ['Başta boşta ölçüm (sn)', ALAN_ACIKLAMASI.bosta], ['En çok VU', ALAN_ACIKLAMASI.maxvu], ['Bağlantı', ALAN_ACIKLAMASI.kip], ['Sıkıştırma (Accept-Encoding)', ALAN_ACIKLAMASI.ae],
    ] as const) {
      const g = screen.getByLabelText(etiket);
      expect(g).not.toBeVisible();
      expect(g).toHaveAccessibleDescription(aciklama);
    }
    expect(screen.queryByRole('checkbox', { name: /SNI ile bağlan/ })).toBeNull();
    expect(gelismis.textContent).toContain('tekrar 2 · ısınma 30 sn · bekleme 30 sn · başta 60 sn · en çok 150 VU · yeni bağlantı · brotli (br)');
    fireEvent.click(gelismis);
    expect(screen.getByLabelText('Tekrar')).toBeVisible();
    expect(screen.getByRole('checkbox', { name: /SNI ile bağlan/ })).toBeTruthy();
    expect(screen.getByText(`— ${ALAN_ACIKLAMASI.sni}`)).toBeTruthy();
    fireEvent.click(gelismis);
    // Hizli deneme: alanlar dolar, tahmini sure buyuk metinde ve formulde.
    fireEvent.click(dugme(/^Hızlı deneme/));
    expect(dugme(/^Hızlı deneme/)).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByLabelText('Hızlar (istek/sn)')).toHaveValue('45 90');
    expect(screen.getByLabelText('Ölçüm süresi (sn)')).toHaveValue(40);
    expect(screen.getByLabelText('Tekrar')).toHaveValue(1);
    expect(screen.getByText('Tahmini toplam süre').parentElement?.textContent).toContain('≈ 5 dk 10 sn');
    expect(screen.getByText('2 adım (2 hız × 1 tekrar) × (ısınma 10 + ölçüm 40 + bekleme 10 + 20 sn pay) + başta 30 sn + 120 sn. Üst sınır 45 dk.')).toBeTruthy();
    // Elle degisiklik: Özel; gecerli kalir.
    fireEvent.change(screen.getByLabelText('Hızlar (istek/sn)'), { target: { value: '50 90' } });
    for (const b of within(grup).getAllByRole('button')) expect(b).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByText(/^Özel ayar: alanları kendiniz değiştirdiniz/)).toBeTruthy();
    // Gelismis alanda hata: bolum acilir, dugmede sayi. Hata duzelince bolum ACIK kalir, odak alanda (inceleme bulgusu 2).
    fireEvent.change(screen.getByLabelText('Tekrar'), { target: { value: '9' } });
    expect(screen.getByRole('button', { name: /^Gelişmiş ayarlar/ })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('1 alan hatalı')).toBeTruthy();
    expect(screen.getByLabelText('Tekrar')).toBeVisible();
    screen.getByLabelText('Tekrar').focus();
    fireEvent.change(screen.getByLabelText('Tekrar'), { target: { value: '1' } });
    expect(screen.queryByText('1 alan hatalı')).toBeNull();
    expect(screen.getByRole('button', { name: /^Gelişmiş ayarlar/ })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByLabelText('Tekrar')).toBeVisible();
    expect(document.activeElement).toBe(screen.getByLabelText('Tekrar'));
    fireEvent.click(screen.getByRole('button', { name: /^Gelişmiş ayarlar/ }));
    expect(screen.getByRole('button', { name: /^Gelişmiş ayarlar/ })).toHaveAttribute('aria-expanded', 'false');
    // Govde kanonik (protokol HER ZAMAN dolu, varsayilan h1 - h2_sozlesme.md 5.3): hedef secilip on kontrol istenir.
    fireEvent.change(screen.getByLabelText('Hedef sunucu (isteğe bağlı)'), { target: { value: 'GBNGXT33' } });
    const ok = screen.getByRole('button', { name: /Ön kontrolü başlat/ });
    await waitFor(() => expect(ok).toBeEnabled(), { timeout: 3000 });
    fireEvent.click(ok);
    await waitFor(() => expect(api.onKontrol).toHaveBeenCalledTimes(1));
    expect(api.onKontrol.mock.calls[0][0]).toEqual({
      senaryoId: 3, hedefHost: 'GBNGXT33', hedefIp: '192.168.133.27', vhost: 'glomo-test.garantibbva.com.tr', yukHost: 'GBNGXT34', sni: false,
      parametreler: { motor: 'k6', hizlar: [50, 90], maxvu: 150, tekrar: 1, isinma: 10, sure: 40, bosluk: 10, bosta: 30, kip: 'yeni', ae: 'br', protokol: 'h1' },
    });
    // wrk: ayni hazir ayar baglanti kademeleriyle.
    fireEvent.click(screen.getByRole('radio', { name: /^wrk/ }));
    fireEvent.click(dugme(/^Kapasite/));
    expect(screen.getByLabelText('Bağlantılar')).toHaveValue('2 4 8 16 32');
    expect(screen.getByLabelText('İş parçacığı')).toHaveValue(2);
    expect(screen.getByLabelText('İş parçacığı')).toHaveAccessibleDescription(`${ALAN_ACIKLAMASI.is_parcacigi} 1–16; her bağlantı sayısını tam bölmeli.`);
    // wrk TLS oturumunu surdurebilir: kip aciklamasi "TLS maliyeti olculur" deyip birakmaz (inceleme bulgusu 3).
    expect(screen.getByLabelText('Bağlantı kipi')).toHaveAccessibleDescription(`${ALAN_ACIKLAMASI.kip} wrk TLS oturumunu sürdürebilir; TLS payı hesaplanmaz.`);
    // Ustteki alandan gelen gelismis hata (3 6 baglanti, 2 is parcacigi bolmez): bolum acilir; is parcacigi
    // duzeltilince acik kalir, odak is parcacigi alaninda.
    expect(screen.getByRole('button', { name: /^Gelişmiş ayarlar/ })).toHaveAttribute('aria-expanded', 'false');
    fireEvent.change(screen.getByLabelText('Bağlantılar'), { target: { value: '3 6' } });
    expect(screen.getByRole('button', { name: /^Gelişmiş ayarlar/ })).toHaveAttribute('aria-expanded', 'true');
    const ip = screen.getByLabelText('İş parçacığı');
    ip.focus();
    fireEvent.change(ip, { target: { value: '3' } });
    expect(screen.getByRole('button', { name: /^Gelişmiş ayarlar/ }).textContent).not.toContain('alan hatalı');
    expect(screen.getByRole('button', { name: /^Gelişmiş ayarlar/ })).toHaveAttribute('aria-expanded', 'true');
    expect(ip).toBeVisible();
    expect(document.activeElement).toBe(ip);
  });
});

describe('Yük Testi sade — koşu ayrıntısı (SD9, SD10)', () => {
  it('SD9 R2: özet satırı, özet tablo + ipuçları, düz neden cümleleri (tek kez) ve reload anı; negatif CPU yok', async () => {
    const ozet = {
      adim_sayisi: 6, gecerli_adim_sayisi: 4, toplam_istek: 179936, p95_en_iyi: { deger: 1.346, tur: 'R2_K_ka_identity_400_r2' }, p95_en_kotu: { deger: 2.126, tur: 'R2_K_ka_identity_100_r1' },
      p95_kapsam: 'gecerli', toplam_429: 0, toplam_5xx: 0, en_yuksek_hata_orani: 0, hata_var: false, cpu_olculemeyen_adim: 2, konf_degisti: true,
      reloadlar: [{ t: T_RELOAD, t_once: T_RELOAD - 2, t_son: T_RELOAD + 30, tur: 'R2_K_ka_identity_250_r2', faz: 'olcum', kesit: 'R2_gbngxt33', worker_once: 8, worker_sonra: 8, kapanan_en_cok: 8, etkilenen_turlar: ['R2_K_ka_identity_250_r2'] },
        // Gecerli adimin isinmasindaki reload adimi gecersiz yapmaz (sade_sozlesme v2): kosu duzeyi satirda "ölçüm etkilenmedi".
        { t: T_ISINMA, t_once: null, t_son: T_ISINMA + 5, tur: 'R2_K_ka_identity_400_r1', faz: 'isinma', kesit: 'R2_gbngxt33', worker_once: 8, worker_sonra: 8, kapanan_en_cok: 8, etkilenen_turlar: ['R2_K_ka_identity_400_r1'] }],
    };
    const adimlar: NlAdim[] = R2_ADIMLAR.map((a) => adimNormalle({ ...a, reloadlar: ozet.reloadlar.filter((r) => r.etkilenen_turlar.includes(a.tur)) }));
    api.kosu.mockResolvedValue({ ok: true, kosu: ayrinti({ sonucOzeti: sonucOzetiNormalle(ozet) }), adimlar });
    render(<KosuAyrinti kosuId={2} isAdmin={false} onGeri={vi.fn()} />);
    const ozetSatiri = await screen.findByLabelText('Koşu özeti');
    expect(ozetSatiri.textContent).toContain('Gönderilen istek179.936');
    expect(ozetSatiri.textContent).toContain('En iyi p951,35 ms400/sn · 2. tekrar');
    expect(ozetSatiri.textContent).toContain('En kötü p952,13 ms100/sn · 1. tekrar');
    expect(ozetSatiri.textContent).toContain('Hata yok');
    // Ozet tablo: 11 kolon, ipuclari; satir degerleri.
    const tablo = screen.getByRole('table', { name: 'Adım sonuçları özeti' });
    const basliklar = within(tablo).getAllByRole('columnheader');
    expect(basliklar.map((b) => b.textContent)).toEqual(['Adım', 'İstek', 'Gerçek hız', 'Medyan', 'p95', 'p99', 'Hata', '429', '5xx', 'Host CPU', 'Sonuç']);
    for (const b of basliklar) expect((b.getAttribute('title') || '').length).toBeGreaterThan(20);
    expect(within(tablo).getByRole('columnheader', { name: 'p95' }).getAttribute('title')).toBe('İsteklerin %95’i bu süreden kısa sürede yanıtlandı (ms); en yavaş %5 bunun üstünde.');
    const satirlar = within(tablo).getAllByRole('row').slice(1);
    expect(satirlar).toHaveLength(6);
    const hucreler = (r: HTMLElement) => within(r).getAllByRole('cell').map((c) => c.textContent);
    expect(hucreler(satirlar[0])).toEqual(['100/sn1. tekrar', '12.001', '100/sn', '1,61', '2,13', '2,53', '%0', '0', '0', '%4', 'geçerli']);
    expect(hucreler(satirlar[1])).toEqual(['100/sn2. tekrar', '11.996', '100/sn', '1,54', '1,98', '5,2', '%0', '0', '0', '%3', 'geçersiz']);
    // Kolon aciklamalari acilir liste.
    const aciklamaDugmesi = screen.getByRole('button', { name: 'Sütunlar ne anlatıyor?' });
    expect(document.getElementById('yuk-ozet-kolonlar')).not.toBeVisible();
    fireEvent.click(aciklamaDugmesi);
    expect(document.getElementById('yuk-ozet-kolonlar')).toBeVisible();
    expect(screen.getByText('İsteklerin yarısı bu süreden kısa sürede yanıtlandı (ms, p50): tipik yanıt süresi.')).toBeTruthy();
    // Nedenler duz cumle, her neden TEK kez, etkilenen adimlarla; reload ani yerel saatle.
    const nedenler = screen.getByRole('list', { name: 'Nedenler' });
    const maddeler = within(nedenler).getAllByRole('listitem');
    expect(maddeler).toHaveLength(2);
    expect(maddeler[0].textContent).toContain('Test sırasında nginx konfigürasyonu değişti; bu adımın sonuçları güvenilir değil');
    expect(maddeler[0].textContent).toContain('Etkilenen adımlar: 100/sn · 2. tekrar, 250/sn · 2. tekrar');
    expect(maddeler[0].textContent).toContain('kod: konf_degisti');
    expect(maddeler[1].textContent).toContain('Test sırasında nginx yeniden yüklendi (reload): worker süreçleri değişti');
    expect(maddeler[1].textContent).toContain(`Reload saat ${saat(T_RELOAD)} civarında (${saat(T_RELOAD - 2)} – ${saat(T_RELOAD)} arasında), 250/sn adımının 2. tekrarında ölçüm sırasında.`);
    expect(screen.queryByText(/^R2_K_ka_identity_100_r2\(/)).toBeNull();
    expect(screen.getByText(`Ayrıca nginx 1 kez yeniden yüklendi (reload): saat ${saat(T_ISINMA)} civarında, 400/sn adımının 1. tekrarında ısınma sırasında (ölçüm etkilenmedi).`)).toBeTruthy();
    // Kaydedici uyarisi duz cumle.
    expect(screen.getByText('Kayıt sırasında hedefin nginx konfigürasyonu değişti (özet 0dc6843c → 648462d7); o sırada koşan adımlar geçersiz sayılır.')).toBeTruthy();
    // Ayrinti kapali; acilinca CPU-ms / kapasite: negatif yok, "—" + neden.
    const ayrintiDugmesi = screen.getByRole('button', { name: /^Ayrıntı/ });
    expect(ayrintiDugmesi).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByRole('table', { name: 'Adım sonuçları', hidden: true })).not.toBeVisible();
    fireEvent.click(ayrintiDugmesi);
    const teknik = screen.getByRole('table', { name: 'Adım sonuçları' });
    expect(teknik).toBeVisible();
    expect(teknik.textContent).not.toMatch(/[-−]\s?\d/);
    expect(document.body.textContent).not.toMatch(/-1[.,]372|-0[.,]873|-4[.,]?665|-7[.,]?328/);
    expect(within(teknik).getAllByTitle(CPU_OLCULEMEDI.reload).length).toBe(4);
  });

  it('SD10 eski koşu (p50 / p99 / istek yok, sunucu özeti yok): tablo "—" ile, özet adımlardan', async () => {
    const eski = [
      { tur: 'R7_K_yeni_br_100_r1', hiz: 100, p95: 12.5, gercek_rps: 99.9 },
      { tur: 'R7_K_yeni_br_250_r1', hiz: 250, p95: 30.25, gercek_rps: 249.1 },
    ].map((a) => adimNormalle({ senaryo: 'K', kip: 'yeni', ae: 'br', gecerlilik: 'GECERLI', ...a }));
    api.kosu.mockResolvedValue({ ok: true, kosu: ayrinti({ id: 7, gecerlilik: 'GECERLI', gecersizNedenleri: [], analiz: { nproc: null, cpuTlsliPay: null, uyarilar: [], okumaHatasi: null } }), adimlar: eski });
    render(<KosuAyrinti kosuId={7} isAdmin={false} onGeri={vi.fn()} />);
    const tablo = await screen.findByRole('table', { name: 'Adım sonuçları özeti' });
    const [s1] = within(tablo).getAllByRole('row').slice(1);
    expect(within(s1).getAllByRole('cell').map((c) => c.textContent)).toEqual(['100/sn1. tekrar', '—', '99,9/sn', '—', '12,5', '—', '—', '—', '—', '—', 'geçerli']);
    const ozet = screen.getByLabelText('Koşu özeti');
    expect(ozet.textContent).toContain('Gönderilen istek—');
    expect(ozet.textContent).toContain('En iyi p9512,5 ms100/sn · 1. tekrar');
    expect(ozet.textContent).toContain('En kötü p9530,3 ms250/sn · 1. tekrar');
    expect(screen.queryByRole('list', { name: 'Nedenler' })).toBeNull();
  });

  // SD15 (inceleme bulgusu 4): ozet tablo kolonlari toplami < 56rem; 1280 + sol menude icerik ~940 px (tablo 904 px'e
  // sigar, kendi icinde kaymaz; onizlemede olculdu: eski 63rem = 1008 px kayiyordu).
  it('SD15 özet tablo kolon genişlikleri toplamı 56rem altında (Adım 7, Sonuç 6,5, sayılar 4,5)', () => {
    for (const birim of ['istek/sn', 'bağlantı'] as const) {
      for (const serbest of [false, true]) {
        const k = ozetKolonlari(birim, serbest);
        expect(k.every((x) => /^[0-9.]+rem$/.test(x.genislik))).toBe(true);
        expect(k.reduce((t, x) => t + parseFloat(x.genislik), 0)).toBeLessThan(56);
        expect(Object.fromEntries(k.map((x) => [x.anahtar, x.genislik]))).toMatchObject({ adim: '7rem', sonuc: '6.5rem', istek: '4.5rem', rps: '4.5rem', cpu: '4.5rem' });
      }
    }
  });

  // SD14 (inceleme bulgusu 1): isinmada / boslukta / kosu oncesinde BASLAYIP olcume tasan reload adimi dusurur. Sunucu
  // (RG3) bunu artik 'olcum' yazar; ekran yine de adimin reloadlar'ini evre suzgeci olmadan nedenin altina koyar ve
  // reload'la dusen adima degen olaya "(ölçüm etkilenmedi)" demez (eski evre etiketli veri de celismez).
  it.each([
    ['isinma', 'R2_K_ka_identity_100_r2', 'R2_K_ka_identity_100_r2', ['R2_K_ka_identity_100_r2']],
    ['bosluk', 'R2_K_ka_identity_100_r2', 'R2_K_ka_identity_100_r1', ['R2_K_ka_identity_100_r1', 'R2_K_ka_identity_100_r2']],
    ['kosu_oncesi', 'R2_K_ka_identity_100_r1', null, ['R2_K_ka_identity_100_r1']],
  ] as const)('SD14 %s evresinde başlayıp ölçüme taşan reload: neden altında, "ölçüm etkilenmedi" yok', async (faz, dusen, tur, etkilenen) => {
    const olay = { t: T_RELOAD, t_once: T_RELOAD - 1, t_son: T_RELOAD + 10, tur, faz, kesit: 'R2_gbngxt33', worker_once: 8, worker_sonra: 8, kapanan_en_cok: 8, etkilenen_turlar: [...etkilenen] };
    const ozet = sonucOzetiNormalle({ adim_sayisi: 6, gecerli_adim_sayisi: 5, toplam_istek: 179936, p95_kapsam: 'gecerli', hata_var: false, cpu_olculemeyen_adim: 1, konf_degisti: false, reloadlar: [olay] });
    const adimlar: NlAdim[] = R2_ADIMLAR.map((a) => adimNormalle({
      ...a, gecerlilik: a.tur === dusen ? 'GECERSIZ' : 'GECERLI', nedenler: a.tur === dusen ? ['reload(worker_pid_degisti)'] : [],
      reloadlar: (etkilenen as readonly string[]).includes(a.tur) ? [olay] : [],
    }));
    const gruplar = nedenGruplari({ gecersizNedenleri: [`${dusen}(reload(worker_pid_degisti))`] }, adimlar, ozet);
    expect(gruplar.map((g) => [g.aciklama.kod, g.turlar, g.reloadlar.map((r) => r.t)])).toEqual([['reload(worker_pid_degisti)', [dusen], [T_RELOAD]]]);
    // Adimin reloadlar'i bossa (eski satir) kosu ozetindeki olay etkilenenTurlar'dan, yine evre suzgeci olmadan.
    const eskiAdimlar = adimlar.map((a) => ({ ...a, reloadlar: [] }));
    expect(nedenGruplari({ gecersizNedenleri: [] }, eskiAdimlar, ozet)[0].reloadlar.map((r) => r.t)).toEqual([T_RELOAD]);
    // Neden altinda gosterilmese bile ozet satiri "olcum etkilenmedi" demez.
    expect(reloadOzetMetni(ozet!, adimlar, 'istek/sn')).not.toContain('ölçüm etkilenmedi');
    expect(reloadOzetMetni(ozet!, adimlar, 'istek/sn', new Set([T_RELOAD]))).toBeNull();
    api.kosu.mockResolvedValue({ ok: true, kosu: ayrinti({ gecersizNedenleri: [`${dusen}(reload(worker_pid_degisti))`], sonucOzeti: ozet }), adimlar });
    render(<KosuAyrinti kosuId={2} isAdmin={false} onGeri={vi.fn()} />);
    const madde = within(await screen.findByRole('list', { name: 'Nedenler' })).getByText(/^Reload saat /);
    expect(madde.textContent).toContain(`saat ${saat(T_RELOAD)} civarında`);
    expect(document.body.textContent).not.toContain('ölçüm etkilenmedi');
    expect(screen.queryByText(/kez yeniden yüklendi/)).toBeNull();
  });
});

// SD11 / SD12 (entegrasyon): sunucu ciktisiyla capraz kontrol. SD11 gercek R2 sayilarinin sunucu zincirinden
// (analiz -> poller -> DB -> GET /kosular/:id) gecmis halini cizer: fikstur server/nginx-loadtest/__tests__/
// r2-gercek.test.cjs (RG2) tarafindan uretilir ve orada bayt bayt kilitlidir. SD12 analiz.cjs NEDEN_KALIPLARI'ndaki
// her kod icin bir ornegin sunucu kalibina uydugunu ve ekranin onu taniyip duz cumleye cevirdigini sinar (sunucuya
// yeni kod eklenip burada ornegi yoksa test KIRMIZI).
const sunucuCjs = createRequire(import.meta.url);
const R2_GERCEK = sunucuCjs('../../../../server/nginx-loadtest/__tests__/fixtures/r2-gercek-api.json') as {
  gecerlilik: string; gecersizNedenleri: string[]; uyarilar: string[]; sonucOzeti: unknown; adimlar: unknown[];
};
const { NEDEN_KALIPLARI } = sunucuCjs('../../../../server/nginx-loadtest/analiz.cjs') as { NEDEN_KALIPLARI: { kod: string; tur: 'neden' | 'uyari'; re: RegExp }[] };
const { KIP_KALIPLARI } = sunucuCjs('../../../../server/nginx-loadtest/gorunum.cjs') as { KIP_KALIPLARI: { kod: string; re: RegExp }[] };

describe('Yük Testi sade — sunucuyla çapraz kontrol (SD11, SD12)', () => {
  it('SD11 gerçek R2 sayıları sunucu zincirinden: özet tablo, iki reload anı, CPU “—” (negatif yok)', async () => {
    const adimlar = R2_GERCEK.adimlar.map(adimNormalle);
    const sonucOzeti = sonucOzetiNormalle(R2_GERCEK.sonucOzeti);
    expect(sonucOzeti?.reloadlar).toHaveLength(2);
    api.kosu.mockResolvedValue({
      ok: true, adimlar,
      kosu: ayrinti({ gecerlilik: 'GECERSIZ', gecersizNedenleri: R2_GERCEK.gecersizNedenleri, sonucOzeti, analiz: { nproc: 8, cpuTlsliPay: null, uyarilar: R2_GERCEK.uyarilar, okumaHatasi: null } }),
    });
    render(<KosuAyrinti kosuId={2} isAdmin={false} onGeri={vi.fn()} />);
    const ozet = await screen.findByLabelText('Koşu özeti');
    expect(ozet.textContent).toContain('Gönderilen istek179.936');
    expect(ozet.textContent).toContain('En iyi p951,35 ms400/sn · 2. tekrar · geçerli adım yok, tüm adımlardan');
    expect(ozet.textContent).toContain('En kötü p952,13 ms100/sn · 1. tekrar · geçerli adım yok, tüm adımlardan');
    expect(ozet.textContent).toContain('Hata yok');
    const tablo = screen.getByRole('table', { name: 'Adım sonuçları özeti' });
    const satirlar = within(tablo).getAllByRole('row').slice(1);
    const hucreler = (r: HTMLElement) => within(r).getAllByRole('cell').map((c) => c.textContent);
    expect(satirlar.map(hucreler)).toEqual([
      ['100/sn1. tekrar', '12.001', '100/sn', '1,61', '2,13', '2,53', '%0', '0', '0', '%4', 'geçersiz'],
      ['100/sn2. tekrar', '11.996', '100/sn', '1,54', '1,98', '5,2', '%0', '0', '0', '%4', 'geçersiz'],
      ['250/sn1. tekrar', '30.001', '250/sn', '1,25', '1,59', '1,87', '%0', '0', '0', '%4', 'geçersiz'],
      ['250/sn2. tekrar', '29.937', '249,5/sn', '1,23', '1,73', '5', '%0', '0', '0', '%4', 'geçersiz'],
      ['400/sn1. tekrar', '48.001', '400/sn', '1,03', '1,4', '1,95', '%0', '0', '0', '%4', 'geçersiz'],
      ['400/sn2. tekrar', '48.000', '400/sn', '1,03', '1,35', '1,66', '%0', '0', '0', '%4', 'geçersiz'],
    ]);
    const maddeler = within(screen.getByRole('list', { name: 'Nedenler' })).getAllByRole('listitem');
    expect(maddeler).toHaveLength(2);
    expect(maddeler[0].textContent).toContain('Test sırasında nginx konfigürasyonu değişti');
    expect(maddeler[0].textContent).toContain('Etkilenen adımlar: 100/sn · 1. tekrar, 100/sn · 2. tekrar, 250/sn · 1. tekrar, 250/sn · 2. tekrar, 400/sn · 1. tekrar, 400/sn · 2. tekrar');
    const [r1, r2] = sonucOzeti!.reloadlar;
    expect(maddeler[1].textContent).toContain('Test sırasında nginx yeniden yüklendi (reload)');
    expect(maddeler[1].textContent).toContain(`Reload saat ${saat(r1.t)} civarında (${saat(r1.tOnce!)} – ${saat(r1.t)} arasında), 100/sn adımının 2. tekrarında ölçüm sırasında; saat ${saat(r2.t)} civarında (${saat(r2.tOnce!)} – ${saat(r2.t)} arasında), 250/sn adımının 2. tekrarında ölçüm sırasında.`);
    // Ayni metin sabit saatle (Istanbul): 100_r2 olcumunun 60. sn'si ve 250_r2'ninki.
    expect(maddeler[1].textContent).toContain('Reload saat 14:54:22 civarında (14:54:21 – 14:54:22 arasında), 100/sn adımının 2. tekrarında ölçüm sırasında; saat 15:00:31 civarında');
    expect(maddeler[1].textContent).toContain('Etkilenen adımlar: 100/sn · 2. tekrar, 250/sn · 2. tekrar');
    // Olcum disi reload yok: ek "... kez yeniden yüklendi" satiri cikmaz.
    expect(screen.queryByText(/kez yeniden yüklendi \(reload\)/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /^Ayrıntı/ }));
    const teknik = screen.getByRole('table', { name: 'Adım sonuçları' });
    expect(teknik.textContent).not.toMatch(/[-−]\s?\d/);
    expect(within(teknik).getAllByTitle(CPU_OLCULEMEDI.reload).length).toBe(4);
  });

  it('SD16 gorunum.cjs KIP_KALIPLARI’ndaki her kip doğrulaması kodu düz cümle (bilinmeyen değil); bellek uyarıları bilgi tonunda', () => {
    const ORNEK: Record<string, string> = {
      kip_protokol: 'kip_protokol(istenen=h1,olculen=h2,uyumsuz=0)', kip_ka_yeni_baglanti: 'kip_ka_yeni_baglanti_%35',
      kip_yeni_yeniden_kullanim: 'yeni_kipinde_baglanti_yeniden_kullanilmis_%12', kip_sikistirma_az: 'kip_sikistirma_az(istenen=br,%22.2)',
      kip_sikistirma_beklenmeyen: 'kip_sikistirma_beklenmeyen(istenen=identity,%3.0)',
    };
    expect(Object.keys(ORNEK).sort()).toEqual(KIP_KALIPLARI.map((k) => k.kod).sort());
    for (const k of KIP_KALIPLARI) {
      const ornek = ORNEK[k.kod];
      expect({ kod: k.kod, uyar: k.re.test(ornek) }).toEqual({ kod: k.kod, uyar: true });
      const a = uyariAcikla(ornek);
      expect({ kod: k.kod, bilinmiyor: a.bilinmiyor ?? false, hamDegil: a.cumle !== ornek && /\s/.test(a.cumle) }).toEqual({ kod: k.kod, bilinmiyor: false, hamDegil: true });
    }
    expect(uyariAcikla('kip_sikistirma_az(istenen=br,%22.2)').cumle).toBe('br istendi ama 1 KB üstü yanıtların yalnız %22,2’i br; sunucu bu sıkıştırmayı uygulamıyor olabilir.');
    expect(uyariAcikla('kip_protokol(istenen=h2,olculen=h2,uyumsuz=4)').cumle).toBe('HTTP/2 istendi ama 4 yanıt başka bir protokolle geldi.');
    expect(uyariAcikla('bellek_bos_az(hedef,%9.9)')).toMatchObject({ ton: 'bilgi', cumle: 'Hedef sunucuda boş bellek en düşük %9,9 (%10’un altında); bellek baskısı ölçümü etkileyebilir.' });
    expect(uyariAcikla('R17_K_ka_br_90_r2: bellek_bos_az(yuk,%7.5)')).toMatchObject({ tur: 'R17_K_ka_br_90_r2', ton: 'bilgi' });
    expect(uyariAcikla('nginx_bellek_artisi(ilk=110MB,son=210MB,kosu_sonu=215MB)')).toMatchObject({ ton: 'bilgi', cumle: 'Olası bellek sızıntısı: nginx worker belleği adımlar boyunca sürekli arttı (110 MB → 210 MB) ve koşu sonunda geri inmedi (215 MB).' });
  });

  it('SD12 analiz.cjs NEDEN_KALIPLARI’ndaki her kod ekranda tanınır (örnek sunucu kalıbına uyar, cümle ham kod değil)', () => {
    const ORNEK: Record<string, string> = {
      k6_rc: 'k6_rc=99', wrk_rc: 'wrk_rc=1', 429: '429(istemci=12,sunucu=11)', '5xx': '5xx(istemci=3)', http2: 'http2', hata: 'hata_%0.35(>%0.1)',
      log_istemci_farki: 'log_istemci_farki_%3.4', kayit: 'kayit:log_dondu:access.log', disk: 'disk_%71', konf_degisti: 'konf_degisti',
      pencere_kisa: 'pencere_kisa(12s)', reload: 'reload(worker_pid_degisti)', hatali_kosu: 'hatali_kosu(kos.sh_durdurdu)',
      tamamlanmadi: 'tamamlanmadi(istemci_sonucu_yok)', doyma_dropped: 'doyma:dropped=63', doyma_host_cpu: 'doyma:host_cpu_%93.5(>%90)',
      doyma_yuk_cpu: 'doyma:yuk_cpu_bosta_%12.5(<%20)',
      saat_farki: 'saat_farki~-14s(sunucu-istemci)', log_satiri_yok: 'log_satiri_yok:pencere_istemci_saatinden', sunucu_logunda_bu_tur_yok: 'sunucu_logunda_bu_tur_yok',
      yeni_kipinde_yeniden_kullanim: 'yeni_kipinde_baglanti_yeniden_kullanilmis_%12', dropped_iterations: 'dropped_iterations=4', sunucu_kaydi_yok: 'sunucu_kaydi_yok',
      pencerede_ornek_yok: 'pencerede_ornek_yok', arka_plan_yok: 'arka_plan_yok(0_kabul)', arka_plan_az: 'arka_plan_az(12s)', diger_trafik: 'diger_trafik_%7',
      perf_ek_yuku: 'perf_ek_yuku(kararda_kullanilmaz)', tekrar_kosu_ayristirilamadi: "tekrar_kosu_ayristirilamadi(log'da_deneme_kolonu_yok)",
      tekrar_kosu_deneme: 'tekrar_kosu:deneme_2_kullanildi(120_eski_satir_atildi)', cpu_olculemedi: 'cpu_olculemedi(sayac_geriledi)',
      yuk_cpu_olculemedi: 'yuk_cpu_olculemedi',
      // HTTP/2 (h2_sozlesme.md 4.4).
      h2_disi: 'h2_disi(3)', sunucu_ayari_kanitsiz: 'sunucu_ayari_kanitsiz(yok)', protokol_farkli: 'protokol_farkli(beklenen=h2,olculen=yok)',
      // 2026-11-03 bellek (bilgi).
      bellek_bos_az: 'bellek_bos_az(yuk,%7.5)', nginx_bellek_artisi: 'nginx_bellek_artisi(ilk=110MB,son=210MB,kosu_sonu=215MB)',
      // 2026-11-03 bant genisligi (bilgi).
      ag_kullanim_yuksek: 'ag_kullanim_yuksek(hedef,%82.4)',
    };
    expect(Object.keys(ORNEK).sort()).toEqual(NEDEN_KALIPLARI.map((k) => k.kod).sort());
    for (const k of NEDEN_KALIPLARI) {
      const ornek = ORNEK[k.kod];
      expect({ kod: k.kod, uyar: k.re.test(ornek) }).toEqual({ kod: k.kod, uyar: true });
      const a = k.tur === 'neden' ? nedenAcikla(ornek) : uyariAcikla(ornek);
      expect({ kod: k.kod, bilinmiyor: a.bilinmiyor ?? false, hamDegil: a.cumle !== ornek && /\s/.test(a.cumle) }).toEqual({ kod: k.kod, bilinmiyor: false, hamDegil: true });
    }
    // cpu_olculemedi'nin uc alt kodu ve eski satirin kodu ayri cumle.
    for (const alt of ['reload', 'sayac_geriledi', 'net_negatif']) expect(uyariAcikla(`cpu_olculemedi(${alt})`).cumle).toBe(CPU_OLCULEMEDI[alt]);
    expect(Object.keys(CPU_OLCULEMEDI).sort()).toEqual(['negatif_deger', 'net_negatif', 'reload', 'sayac_geriledi']);
    // 2026-11-03: kosu uyarisi yuk_cpu_olculemedi(<neden>) dort nedeni de duz Turkce (analiz.cjs yukOlcumuDenetle).
    for (const [neden, parca] of [['kaydedici_baslamadi', 'kaydedici başlatılamadı'], ['kayit_yok', 'kayıt dosyası yok'], ['kayit_bozuk', 'kayıt dosyası okunamadı'], ['pencerede_ornek_yok', 'ölçüm penceresinde yeterli örnek yok']]) {
      const a = uyariAcikla(`yuk_cpu_olculemedi(${neden})`);
      expect({ neden, bilinmiyor: a.bilinmiyor ?? false, ton: a.ton }).toEqual({ neden, bilinmiyor: false, ton: 'uyari' });
      expect(a.cumle).toBe(`Yük makinesi CPU’su ölçülemedi (${parca}); “yük makinesi doydu” denetimi yapılamadı, sonuç yük makinesinin sınırını gösteriyor olabilir.`);
    }
    // B1: yeni playbook kaydedicinin son satirini ekler ('<neden>;son=<satir>'); satir parantez icerebilir.
    const s = uyariAcikla('yuk_cpu_olculemedi(kaydedici_baslamadi;son=HATA: /proc/stat okunamiyor (x))');
    expect([s.bilinmiyor ?? false, s.cumle]).toEqual([false, 'Yük makinesi CPU’su ölçülemedi (kaydedici başlatılamadı; kaydedicinin son çıktısı: “HATA: /proc/stat okunamiyor (x)”); “yük makinesi doydu” denetimi yapılamadı, sonuç yük makinesinin sınırını gösteriyor olabilir.']);
    // Sunucu bicimi analiz.test.cjs AN-Y9'da kilitli: 'yuk_cpu_olculemedi(<neden>;son=<ASCII, en cok 200>)'.
    const uzun = uyariAcikla(`yuk_cpu_olculemedi(pencerede_ornek_yok;son=${'x'.repeat(200)})`);
    expect([uzun.bilinmiyor ?? false, uzun.cumle.includes('ölçüm penceresinde yeterli örnek yok; kaydedicinin son çıktısı: “' + 'x'.repeat(200) + '”')]).toEqual([false, true]);
  });

  it('SD13 hazır ayarlar SUNUCUNUN kendi doğrulamasından (dogrula.parametreler, gerçek SINIRLAR / VARSAYILAN) geçer', () => {
    const dg = sunucuCjs('../../../../server/nginx-loadtest/dogrula.cjs') as {
      SINIRLAR: NlSinirlar; VARSAYILAN: NlVarsayilanlar;
      parametreler: (ham: unknown, o: { sni: boolean; hizSiniri?: number | null; vuSiniri?: number | null; hedefTuru?: string }) => { ok?: boolean; deger?: { butceSn: number }; error?: unknown };
    };
    const HEDEFLER_: [string, { hizSiniri: number | null; vuSiniri: number | null } | null, 'sunucu' | 'serbest'][] = [
      ['genel', null, 'sunucu'], ['limit_req 120 / limit_conn 6', { hizSiniri: 120, vuSiniri: 6 }, 'sunucu'],
      ['limit_req 37 / limit_conn 13', { hizSiniri: 37, vuSiniri: 13 }, 'sunucu'], ['limit_req 3 / limit_conn 3', { hizSiniri: 3, vuSiniri: 3 }, 'sunucu'],
      ['serbest', null, 'serbest'], ['serbest + limit 60 / 20', { hizSiniri: 60, vuSiniri: 20 }, 'serbest'],
    ];
    let sayac = 0;
    for (const [ad, h, hedefTuru] of HEDEFLER_) {
      const sinir = hedefSinirlari(dg.SINIRLAR, h, { hedefTuru });
      for (const hz of HAZIR_AYAR_SIRASI) {
        const d = hazirAyar(hz, sinir, dg.VARSAYILAN, { serbest: hedefTuru === 'serbest' });
        for (const motor of ['k6', 'wrk'] as const) {
          // limit_conn < 10: k6'nin maxvu alt siniri (10) karsilanamaz; sunucu da reddeder, ekran alan hatasi gosterir.
          if (motor === 'k6' && sinir.maxVu < 10) continue;
          const p = hazirAyarParametresi(d, motor, 'ka', 'identity');
          const r = dg.parametreler(p, { sni: false, hizSiniri: h?.hizSiniri ?? null, vuSiniri: h?.vuSiniri ?? null, hedefTuru });
          expect({ ad, hz, motor, ok: r.ok === true, hata: r.ok ? null : r }).toEqual({ ad, hz, motor, ok: true, hata: null });
          expect(r.deger!.butceSn).toBe(hazirAyarSuresiSn(d, motor));
          sayac++;
        }
      }
    }
    // 6 hedef x 3 ayar x 2 motor; K2 (2026-11-03): olculmus limit_conn VU'yu daraltmaz, hicbir k6 ayari atlanmaz.
    expect(sayac).toBe(6 * 3 * 2);
  });
});
