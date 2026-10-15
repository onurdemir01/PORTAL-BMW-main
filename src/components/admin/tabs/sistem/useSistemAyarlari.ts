// src/components/admin/tabs/sistem/useSistemAyarlari.ts — Admin > Sistem veri ve durum kancasi.
//
// GET/PUT /api/admin/system-config ve ekranin butun durumu burada; bilesenler yalniz cizer.
//
// KORUNAN DAVRANISLAR (eski SystemConfigTab'dan):
//   * Degerler okunamazsa "yukleniyor" sonsuza dek kalmaz: durum 'hata' olur (HY4).
//   * Restart karari PUT yanitindan gelir; sicak bir ayarda "yeniden baslatin" denmez (S13).
//   * Gizli deger duzenleyicisi BOS baslar; maskeli deger asla taslak olmaz.
// YENI:
//   * Ayni tick'te ikinci kayit gonderilmez (H1, ref korumasi).
//   * Bayat yanit yok sayilir (H2, yukleme numarasi); sokulmus bilesene yazilmaz.
//   * Kayit hatasi alanin altinda gosterilir (role=alert). Kayit surerken duzenleyici
//     kapatilamaz (Iptal/Esc); bilesen yine de sokulurse (admin sekmesi degisti) hata
//     bildirim balonuyla soylenir — aksi halde yeni sirrin kaydedilmedigi hic fark edilmezdi.
//     Ekran bagliyken hata `kaydet`in sonucunda da doner: kayit surerken grup elle kapatildiysa
//     ya da arama satiri listeden dusurduyse SystemConfigTab grubu acar / balonu gosterir.
//   * Basari bildirim balonuyla duyurulur (kendi aria-live bolgesi); ikinci gizli duyuru yok.
//   * Oturum deposu kullaniciya bagli (sistemOturumu.oturumSahibiniDogrula).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { okJson } from '@/api/http';
import { toast } from '@/hooks/useToast';
import { useAsyncEffect } from '@/hooks/useAsyncEffect';
import { useAuth } from '@/contexts/AuthContext';
import { ENV_VARS } from './ortamDegiskenleri';
import type { ConfigValue } from './ayarKurallari';
import {
  oturumSahibiniDogrula,
  restartBekleyeneEkle,
  restartListesiniTemizle,
  saklananTaslaklar,
  taslakSakla,
  taslakSil,
  useRestartBekleyen,
} from './sistemOturumu';

export type YuklemeDurumu = 'yukleniyor' | 'tamam' | 'hata';

/**
 * Kaydin sonucu. `hata` YALNIZ ekran bagliyken sunucu reddettiyse dolu: hata alanin altina
 * yazildi ama satir o an gorunmeyebilir, cagiran onu gorunur kilmakla yukumlu. Ekran
 * sokulduyse hata zaten bildirim balonuyla soylendi (`hata` bos); ayni tick'te ikinci
 * gonderim de `{ ok: false }` doner (hata yok, H1).
 */
export interface KayitSonucu {
  ok: boolean;
  hata?: string;
}

const UC = '/api/admin/system-config';
const META = new Map(ENV_VARS.map((m) => [m.key, m]));

/** Nesneden tek anahtari cikarir (degismez kopya). */
function anahtarsiz<T>(o: Record<string, T>, key: string): Record<string, T> {
  if (!(key in o)) return o;
  const k = { ...o };
  delete k[key];
  return k;
}

function hataMetni(e: unknown): string {
  const durumKodu = (e as { status?: number } | null)?.status;
  if (durumKodu === 403) return 'Bu ekran yalnız Admin rolüne açık (HTTP 403).';
  return e instanceof Error && e.message ? e.message : 'İstek başarısız.';
}

export function useSistemAyarlari() {
  const kullanici = useAuth()?.user?.username ?? '';
  const [durum, setDurum] = useState<YuklemeDurumu>('yukleniyor');
  const [hata, setHata] = useState<string | null>(null);
  const [degerler, setDegerler] = useState<Record<string, ConfigValue>>({});
  // Acik duzenleyiciler = bu haritanin anahtarlari. Gizli olmayan taslaklar oturum deposundan
  // geri yuklenir (admin sekmesi degisiminde kaybolmasin).
  const [taslaklar, setTaslaklar] = useState<Record<string, string>>(() => {
    // Depo baska bir kullaniciya aitse burada sifirlanir (abonelikten ONCE, ilk render).
    oturumSahibiniDogrula(kullanici);
    const t: Record<string, string> = {};
    for (const [k, v] of saklananTaslaklar()) t[k] = v.deger;
    return t;
  });
  const [bayat, setBayat] = useState<Record<string, string>>({});
  const [kaydediliyor, setKaydediliyor] = useState<ReadonlySet<string>>(new Set());
  const [alanHatasi, setAlanHatasi] = useState<Record<string, string>>({});
  const [yeniKaydedilen, setYeniKaydedilen] = useState<Record<string, true>>({});
  const restartBekleyen = useRestartBekleyen();

  const kaydediliyorRef = useRef<Set<string>>(new Set());
  const yuklemeNo = useRef(0);
  const bagliRef = useRef(true);
  useEffect(() => {
    bagliRef.current = true;
    return () => {
      bagliRef.current = false;
    };
  }, []);

  const yukle = useCallback(async () => {
    const no = ++yuklemeNo.current;
    try {
      const r = await okJson<{ ok: boolean; values?: ConfigValue[]; message?: string; error?: string }>(
        await fetch(UC),
      );
      if (!r.ok) throw new Error(r.message || r.error || 'Sunucu hatası.');
      if (!bagliRef.current || no !== yuklemeNo.current) return;
      const map: Record<string, ConfigValue> = {};
      for (const v of r.values || []) map[v.key] = v;
      // Geri yuklenen (ya da acik) taslagin temeli sunucuda degistiyse kullaniciya soylenir.
      const yeniBayat: Record<string, string> = {};
      for (const [k, t] of saklananTaslaklar()) {
        const cv = map[k];
        if (cv && !cv.masked && t.temel !== cv.value) yeniBayat[k] = cv.value;
      }
      setDegerler(map);
      setBayat(yeniBayat);
      setHata(null);
      setDurum('tamam');
    } catch (e: unknown) {
      if (!bagliRef.current || no !== yuklemeNo.current) return;
      setHata(hataMetni(e));
      setDurum('hata');
    }
  }, []);

  useAsyncEffect(
    async (alive) => {
      if (alive()) await yukle();
    },
    [],
  );

  const tekrarDene = useCallback(() => {
    setDurum('yukleniyor');
    void yukle();
  }, [yukle]);

  const temel = useCallback(
    (key: string) => {
      const cv = degerler[key];
      if (cv) return cv.masked ? '' : cv.value;
      return saklananTaslaklar().get(key)?.temel ?? '';
    },
    [degerler],
  );

  const kirliMi = useCallback(
    (key: string) => key in taslaklar && taslaklar[key] !== temel(key),
    [taslaklar, temel],
  );

  const kirliSayisi = useMemo(
    () => Object.keys(taslaklar).filter((k) => taslaklar[k] !== temel(k)).length,
    [taslaklar, temel],
  );

  const taslakYaz = useCallback(
    (key: string, v: string) => {
      setTaslaklar((t) => ({ ...t, [key]: v }));
      const cv = degerler[key];
      // GIZLI DEGER DEPOYA YAZILMAZ — yalniz bu bilesenin state'inde kalir.
      if (cv && !cv.masked) taslakSakla(key, v, cv.value);
    },
    [degerler],
  );

  const duzenlemeyiAc = useCallback(
    (key: string) => {
      const cv = degerler[key];
      if (!cv) return;
      taslakYaz(key, cv.masked ? '' : cv.value);
    },
    [degerler, taslakYaz],
  );

  // Kayit surerken duzenleyici bunu CAGIRMAZ (Iptal kapali, Esc yok sayilir — AyarDuzenleyici,
  // SA14); burada ikinci bir koruma yok, cunku iki kat koruma birbirinin mutasyonunu gizliyordu.
  const duzenlemeyiKapat = useCallback((key: string) => {
    setTaslaklar((o) => anahtarsiz(o, key));
    setAlanHatasi((o) => anahtarsiz(o, key));
    setBayat((o) => anahtarsiz(o, key));
    taslakSil(key);
  }, []);

  const kaydet = useCallback(
    async (key: string, deger: string): Promise<KayitSonucu> => {
      // H1: ayni tick'te ikinci gonderim yok (state degeri bu tick'te hala eski).
      if (kaydediliyorRef.current.has(key)) return { ok: false };
      kaydediliyorRef.current.add(key);
      setKaydediliyor(new Set(kaydediliyorRef.current));
      const etiket = META.get(key)?.label ?? key;
      try {
        const res = await fetch(UC, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ key, value: deger }),
        });
        const r = await okJson<{ ok: boolean; error?: string; restartRequired?: boolean }>(res);
        if (!r.ok) throw new Error(r.error || 'Kaydedilemedi.');
        // SUNUCU KARAR VERIR (S13): sicak yuklenen ayarda restart denmez.
        if (r.restartRequired !== false) restartBekleyeneEkle(key, etiket);
        taslakSil(key);
        if (bagliRef.current) {
          setTaslaklar((o) => anahtarsiz(o, key));
          setAlanHatasi((o) => anahtarsiz(o, key));
          setBayat((o) => anahtarsiz(o, key));
          setYeniKaydedilen((y) => ({ ...y, [key]: true }));
          setTimeout(() => {
            if (bagliRef.current) setYeniKaydedilen((o) => anahtarsiz(o, key));
          }, 3000);
        }
        toast.success(`${etiket} kaydedildi.`);
        await yukle();
        return { ok: true };
      } catch (e: unknown) {
        // Ekran aciksa hata alanin altinda kalir (role=alert, 3 sn'de kaybolmaz) ve cagirana
        // doner (satir gorunmuyorsa o gosterir). Ekran sokulduyse gosterecek alan yok: bildirim
        // balonu tek kanal.
        const metin = hataMetni(e);
        if (bagliRef.current) {
          setAlanHatasi((h) => ({ ...h, [key]: metin }));
          return { ok: false, hata: metin };
        }
        toast.error(`${etiket} kaydedilemedi: ${metin}`);
        return { ok: false };
      } finally {
        kaydediliyorRef.current.delete(key);
        if (bagliRef.current) setKaydediliyor(new Set(kaydediliyorRef.current));
      }
    },
    [yukle],
  );

  // Kaydedilmemis degisiklik varken sayfadan cikis tarayici onayi ister.
  const kirliVar = kirliSayisi > 0;
  useEffect(() => {
    if (!kirliVar) return;
    const uyar = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', uyar);
    return () => window.removeEventListener('beforeunload', uyar);
  }, [kirliVar]);

  return {
    durum,
    hata,
    degerler,
    tekrarDene,
    taslaklar,
    bayat,
    duzenlemeyiAc,
    taslakYaz,
    duzenlemeyiKapat,
    kirliMi,
    kirliSayisi,
    kaydet,
    kaydediliyor,
    alanHatasi,
    yeniKaydedilen,
    restartBekleyen,
    restartListesiniTemizle,
  };
}

export type SistemAyarlari = ReturnType<typeof useSistemAyarlari>;
