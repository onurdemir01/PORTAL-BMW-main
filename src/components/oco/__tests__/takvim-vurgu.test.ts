// src/components/oco/__tests__/takvim-vurgu.test.ts — OV1..OV5 (2026-10-08).
//
// Kullanici: "OCO takvimi sayfasinda bugunun OCO'larini biraz parlatir misin, highlight
// edelim - 'bugun bu calismalar yapilacak'. Gecmis calismalarini da sanki gecmis sekilde,
// kirmizi highlight edebilirsen sevinirim."
//
// EN PAHALI UC YANLIS:
//   1. SAAT bazinda karsilastirmak. OCO pencereleri gece yarisini asiyor (23:00-02:00);
//      saat karsilastirmasi gunu yanlis tarafa atar. Gruplama GUN anahtariyla yapiliyor,
//      vurgu da ayni birimde olmak ZORUNDA.
//   2. Tarihi OLMAYAN OCO'yu "gecmis" saymak. Bos dizge her seyden kucuktur; naif bir
//      `<` karsilastirmasi tarihsiz kayitlari KIRMIZIYA boyardi - oysa onlar "bilinmiyor".
//   3. "Bitis saati yok"u "pencere kapanmadi" saymak. Bilinmeyen bir sey hakkinda iddia
//      uretmek, bu depoda tekrar tekrar yasanan sinif ("olculemedi != yok").
//
// NOT: bu fonksiyonlar once OcoTakvimiPage.tsx icindeydi ve test onlari kaynaktan REGEX
// ile cikariyordu; TS tip ekleri soyulurken govde bozuldu ve iki test yanlis sebeple
// kirmizi yandi. Saf mantik ayri bir module tasindi, vitest dogrudan import ediyor.
import { describe, expect, test } from 'vitest';
import { gunSinifi, gunVurgu, pencereKapandi } from '../takvimVurgu';

describe('OCO takvimi vurgu kurali', () => {
  test('OV1 bugun / gecmis / gelecek GUN bazinda ayrilir', () => {
    expect(gunSinifi('2026-10-08', '2026-10-08')).toBe('bugun');
    expect(gunSinifi('2026-10-07', '2026-10-08')).toBe('gecmis');
    expect(gunSinifi('2026-10-09', '2026-10-08')).toBe('gelecek');
    // Ay/yil siniri: dizge karsilastirmasi ISO biciminde dogru siralar
    expect(gunSinifi('2026-09-30', '2026-10-01')).toBe('gecmis');
    expect(gunSinifi('2027-01-01', '2026-12-31')).toBe('gelecek');
  });

  test('OV2 TARIHSIZ kayit gecmis SAYILMAZ', () => {
    // Bos dizge her seyden kucuktur: naif bir `<` karsilastirmasi tarihsizleri KIRMIZI
    // boyardi. Onlar "bilinmiyor" - takvimde ayri bir baslikta duruyorlar.
    expect(gunSinifi('', '2026-10-08')).toBe('tarihsiz');
    expect(gunVurgu('tarihsiz')).toBeNull();
  });

  test('OV3 vurgu: bugun accent, gecmis KIRMIZI, gelecek SADE', () => {
    expect(gunVurgu('bugun')).toEqual({ renk: 'var(--accent)', etiket: 'BUGÜN' });
    expect(gunVurgu('gecmis')).toEqual({ renk: 'var(--status-danger)', etiket: 'GEÇMİŞ' });
    // GELECEK VURGULANMAZ: her satiri boyamak vurguyu anlamsizlastirirdi.
    expect(gunVurgu('gelecek')).toBeNull();
  });

  test('OV4 gunSinifi SAAT ALMAZ (gece yarisini asan pencere kaymaz)', () => {
    // 23:00-02:00 bir OCO baslangic gunune gore gruplaniyor; vurgu ayni birimde
    // calismak zorunda, yoksa blok ile satir ayrisir.
    expect(gunSinifi.length).toBe(2);
  });

  test('OV5 pencere kapanisi: bitis YOKSA/BOZUKSA iddia uretilmez', () => {
    const simdi = new Date('2026-10-08T15:00:00Z');
    expect(pencereKapandi('2026-10-08T12:00:00Z', simdi)).toBe(true);
    expect(pencereKapandi('2026-10-08T18:00:00Z', simdi)).toBe(false);
    // null = BILINMIYOR. false dondurmek "henuz kapanmadi" demek olurdu.
    expect(pencereKapandi(null, simdi)).toBeNull();
    expect(pencereKapandi('bozuk-tarih', simdi)).toBeNull();
  });
});
