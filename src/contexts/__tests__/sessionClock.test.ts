// src/contexts/__tests__/sessionClock.test.ts — oturum saati (Faz B).
//
//   SC1 iki sekme: birinde "Surdur" → digerinin saati ilerler; hicbiri logout cagirmaz
//   SC2 etkinlik kisitli: 5 dk'da bir extend (bosta kalma kisaysa kalan surenin yarisi)
//   SC3 sure dolduktan sonraki etkinlik oturumu GERI GETIRMEZ (karar sunucunun)
//   SC4 yanit basliklari saati tazeler; degismeyen deger yayilmaz
//   SC5 cikis/giris diger sekmelere yayilir
//   SC6 mutlak sinir once geliyorsa uyari "uzatilamaz" der
//   SC7 sunucu-istemci saat sapmasi hesaba katilir
//   SC8 bitis sebebi yerelde cikarilir (sunucu sebebi yalnizca ilk istege soyler)
//   SC9 kanal sonradan baglanir/ayrilir: ayir-yeniden-bagla (StrictMode) sonrasi esitleme surer
//   SC10 surum yalnizca SUNUCU degerleri degisince artar; saat farki olcumu surumu degistirmez,
//        ama istemci-saati degisince aboneye haber verilir; ms'lik oynama yok sayilir
import { describe, it, expect, vi } from 'vitest';
import {
  oturumSaatiOlustur,
  uyariHesapla,
  bitisSebebi,
  UZATMA_ARALIGI_MS,
  type SaatKanali,
  type SaatMesaji,
} from '../sessionClock';

const DK = 60_000;

// Ayni surecte iki "sekme": birinin gonderdigi digerine gider (BroadcastChannel gibi
// gonderen KENDI mesajini almaz).
function kanalCifti(): [SaatKanali, SaatKanali] {
  const dinleyiciler: [Set<(m: SaatMesaji) => void>, Set<(m: SaatMesaji) => void>] = [new Set(), new Set()];
  const yap = (ben: 0 | 1): SaatKanali => ({
    gonder: (m) => dinleyiciler[ben === 0 ? 1 : 0].forEach((fn) => fn(structuredClone(m))),
    dinle: (fn) => {
      dinleyiciler[ben].add(fn);
      return () => dinleyiciler[ben].delete(fn);
    },
    kapat: () => dinleyiciler[ben].clear(),
  });
  return [yap(0), yap(1)];
}

function sunucu(baslangic: number) {
  let now = baslangic;
  let idle = now + 60 * DK;
  const abs = now + 12 * 60 * DK;
  const istek = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    const u = String(url);
    if (u === '/api/auth/session/extend' && init?.method === 'POST') idle = now + 60 * DK;
    if (u.startsWith('/api/auth/session')) {
      return new Response(
        JSON.stringify({ ok: true, serverNow: now, idleExpiresAt: idle, absoluteExpiresAt: abs, warnSeconds: 120 }),
        { status: 200 },
      );
    }
    return new Response('{}', { status: 404 });
  });
  return {
    istek: istek as unknown as typeof fetch,
    cagrilar: istek.mock.calls,
    ileri: (ms: number) => {
      now += ms;
    },
    simdi: () => now,
  };
}

describe('sessionClock', () => {
  it('SC1 iki sekme tek saat: birinde Surdur digerini ilerletir, kimse logout cagirmaz', async () => {
    const s = sunucu(1_000_000);
    const [k1, k2] = kanalCifti();
    const a = oturumSaatiOlustur({ kanal: k1, istek: s.istek, simdi: s.simdi });
    const b = oturumSaatiOlustur({ kanal: k2, istek: s.istek, simdi: s.simdi });
    await a.tazele();
    expect(b.durum().idleExpiresAt).toBe(1_000_000 + 60 * DK);

    s.ileri(50 * DK);
    expect(await a.uzat()).toBe(true);
    expect(b.durum().idleExpiresAt).toBe(s.simdi() + 60 * DK);
    expect(s.cagrilar.some(([u]) => String(u).includes('/logout'))).toBe(false);
  });

  it('SC2 etkinlik kisitli: 5 dk dolmadan ikinci extend yok', async () => {
    const s = sunucu(0);
    const a = oturumSaatiOlustur({ istek: s.istek, simdi: s.simdi });
    await a.tazele();
    const extendSayisi = () => s.cagrilar.filter(([u]) => String(u).endsWith('/extend')).length;
    // Saat yeni ogrenildi (sunucu etkinligi az once kaydetti): hemen extend YOK.
    a.etkinlik();
    expect(extendSayisi()).toBe(0);
    s.ileri(UZATMA_ARALIGI_MS);
    a.etkinlik();
    expect(extendSayisi()).toBe(1);
    await vi.waitFor(() => expect(a.durum().idleExpiresAt).toBe(s.simdi() + 60 * DK));
    s.ileri(UZATMA_ARALIGI_MS - 1000);
    a.etkinlik();
    expect(extendSayisi()).toBe(1);
    s.ileri(1000);
    a.etkinlik();
    expect(extendSayisi()).toBe(2);
  });

  it('SC2b bosta kalma 5 dk ise kalan surenin yarisinda bir bildirilir (okuyan atilmaz)', async () => {
    let now = 0;
    const istek = vi.fn(async () => {
      const idle = now + 5 * DK;
      return new Response(
        JSON.stringify({ ok: true, serverNow: now, idleExpiresAt: idle, absoluteExpiresAt: 12 * 60 * DK }),
        { status: 200 },
      );
    });
    const a = oturumSaatiOlustur({ istek: istek as unknown as typeof fetch, simdi: () => now });
    await a.uzat();
    now = 2.5 * DK + 1;
    a.etkinlik();
    expect(istek).toHaveBeenCalledTimes(2);
  });

  it('SC3 sure dolduktan sonraki etkinlik oturumu geri getirmez', async () => {
    const s = sunucu(0);
    const a = oturumSaatiOlustur({ istek: s.istek, simdi: s.simdi });
    await a.tazele();
    s.ileri(60 * DK);
    a.etkinlik();
    expect(s.cagrilar.filter(([u]) => String(u).endsWith('/extend'))).toHaveLength(0);
  });

  it('SC4 yanit basliklari saati tazeler ve diger sekmeye yayar; ayni deger yayilmaz', () => {
    const [k1, k2] = kanalCifti();
    const gonder = vi.spyOn(k1, 'gonder');
    const a = oturumSaatiOlustur({ kanal: k1, simdi: () => 0 });
    const b = oturumSaatiOlustur({ kanal: k2, simdi: () => 0 });
    a.basliklariUygula({ idleExpiresAt: 100, absoluteExpiresAt: 200 });
    expect(b.durum()).toMatchObject({ bilinen: true, idleExpiresAt: 100, absoluteExpiresAt: 200 });
    a.basliklariUygula({ idleExpiresAt: 100, absoluteExpiresAt: 200 });
    expect(gonder).toHaveBeenCalledTimes(1);
  });

  it('SC5 cikis ve giris diger sekmelere yayilir', () => {
    const [k1, k2] = kanalCifti();
    const a = oturumSaatiOlustur({ kanal: k1 });
    const b = oturumSaatiOlustur({ kanal: k2 });
    const cikis = vi.fn();
    const giris = vi.fn();
    b.cikisAbone(cikis);
    b.girisAbone(giris);
    a.cikisYay();
    a.girisYay('ayse');
    expect(cikis).toHaveBeenCalledTimes(1);
    expect(giris).toHaveBeenCalledWith('ayse');
  });

  it('SC6 mutlak sinir once geliyorsa uzatilamaz', () => {
    const base = { surum: 1, bilinen: true, warnSeconds: 120, remember: false };
    expect(uyariHesapla({ ...base, idleExpiresAt: 1000_000, absoluteExpiresAt: 2000_000 })).toEqual({
      bitis: 1000_000,
      uyariAni: 1000_000 - 120_000,
      uzatilabilir: true,
    });
    expect(uyariHesapla({ ...base, idleExpiresAt: 2000_000, absoluteExpiresAt: 1500_000 }).uzatilabilir).toBe(false);
  });

  it('SC7 sunucu saati 10 dk ileriyse istemci saatine cevrilir', async () => {
    const istek = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ ok: true, serverNow: 10 * DK, idleExpiresAt: 70 * DK, absoluteExpiresAt: 100 * DK }),
          { status: 200 },
        ),
    );
    const a = oturumSaatiOlustur({ istek: istek as unknown as typeof fetch, simdi: () => 0 });
    await a.tazele();
    expect(a.durum().idleExpiresAt).toBe(60 * DK);
  });

  it('SC8 bitis sebebi: bitis aninda/sonrasinda cikarilir, oncesinde cikarilmaz', () => {
    const d = { surum: 1, bilinen: true, idleExpiresAt: 1_000_000, absoluteExpiresAt: 5_000_000, warnSeconds: 120, remember: false };
    expect(bitisSebebi(d, 1_000_000)).toBe('idle');
    expect(bitisSebebi(d, 1_001_000)).toBe('idle');
    expect(bitisSebebi(d, 995_000)).toBe('idle'); // 5 sn pay: saat sapmasi
    expect(bitisSebebi(d, 994_999)).toBeUndefined(); // bitisten once: iptal / yeniden baslatma
    expect(bitisSebebi(d, 5_000_000)).toBe('absolute');
    expect(bitisSebebi({ ...d, idleExpiresAt: 5_000_000 }, 5_000_000)).toBe('absolute');
    expect(bitisSebebi({ ...d, bilinen: false }, 9_000_000)).toBeUndefined();
  });

  it('SC9 kanal ayrilip yeniden baglaninca (StrictMode) aboneler ve esitleme yerinde', () => {
    const [k1, k2] = kanalCifti();
    const a = oturumSaatiOlustur({ simdi: () => 0 });
    const b = oturumSaatiOlustur({ kanal: k2, simdi: () => 0 });
    const giris = vi.fn();
    a.girisAbone(giris);
    // Efekt: bagla -> sok -> yeniden bagla.
    const ayir1 = a.baglan(k1);
    ayir1();
    const [k1bHam, k2b] = kanalCifti();
    // `storage` yedegi gibi: kapat() dinleyiciyi KALDIRMAZ — ayirma dinleyiciyi kendisi birakmali.
    const k1b = { ...k1bHam, kapat: () => {} };
    const b2 = oturumSaatiOlustur({ kanal: k2b, simdi: () => 0 });
    const ayir2 = a.baglan(k1b);
    b2.girisYay('ayse');
    expect(giris).toHaveBeenCalledWith('ayse');
    a.basliklariUygula({ idleExpiresAt: 100, absoluteExpiresAt: 200 });
    expect(b2.durum().idleExpiresAt).toBe(100);
    // Eski kanalin ayiricisi yeni kanala DOKUNMAZ.
    ayir1();
    b2.girisYay('veli');
    expect(giris).toHaveBeenLastCalledWith('veli');
    // Ayrilan kanaldan mesaj gelmez, gonderilmez.
    ayir2();
    b2.girisYay('ali');
    expect(giris).toHaveBeenCalledTimes(2);
    expect(b.durum().bilinen).toBe(false);
  });

  it('SC10 surum sunucu degerine baglidir; saat farki surumu oynatmaz ama aboneyi bilgilendirir', async () => {
    let now = 1_000_000;
    let serverNow = 1_000_000 - 7; // ag gecikmesi: sunucu yaniti 7 ms once uretti
    const istek = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ ok: true, serverNow, idleExpiresAt: 5_000_000, absoluteExpiresAt: 9_000_000 }),
          { status: 200 },
        ),
    );
    const a = oturumSaatiOlustur({ istek: istek as unknown as typeof fetch, simdi: () => now });
    const gorulen: number[] = [];
    a.abone((d) => gorulen.push(d.idleExpiresAt));

    // Uretimdeki sira: once bir yanitin BASLIKLARI gelir (saat farki henuz olculmedi)...
    a.basliklariUygula({ idleExpiresAt: 5_000_000, absoluteExpiresAt: 9_000_000 });
    const s1 = a.durum().surum;
    expect(gorulen).toEqual([5_000_000]);
    // ...sonra /session ozeti ayni degerlerle ama ILK saat farki olcumuyle.
    await a.tazele();
    expect(a.durum().surum).toBe(s1); // sunucu degeri degismedi: ayni oturum bitisi
    expect(a.durum().idleExpiresAt).toBe(5_000_007);
    // Abone bayat kalmamali: istemci-saatindeki deger degisti.
    expect(gorulen).toEqual([5_000_000, 5_000_007]);

    // Sonraki olcumlerde ms'lik oynama (gecikme farki) saati kipirdatmaz.
    now += 60_000;
    serverNow = now - 23;
    await a.tazele();
    expect(a.durum().idleExpiresAt).toBe(5_000_007);
    expect(gorulen).toHaveLength(2);
    // Gercek saat degisimi (>1 sn) uygulanir.
    serverNow = now + 5_000;
    await a.tazele();
    expect(a.durum().idleExpiresAt).toBe(5_000_000 - 5_000);
    expect(a.durum().surum).toBe(s1);

    // Sunucu bitisi ilerleyince surum artar.
    a.basliklariUygula({ idleExpiresAt: 6_000_000, absoluteExpiresAt: 9_000_000 });
    expect(a.durum().surum).toBe(s1 + 1);
    a.basliklariUygula({ idleExpiresAt: 6_000_000, absoluteExpiresAt: 9_000_000 });
    expect(a.durum().surum).toBe(s1 + 1);
  });
});
