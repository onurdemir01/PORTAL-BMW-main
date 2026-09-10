// src/hooks/useAsyncEffect.ts — ASENKRON YUKLEMEYI EFFECT'TE DOGRU CALISTIRMAK.
//
// SORUN
//   Bu depoda tekrar eden bir desen var:
//
//     const load = useCallback(async () => { setLoading(true); ... }, []);
//     useEffect(() => { load(); }, [load]);
//
//   `load` ILK ISI OLARAK `setLoading(true)` cagiriyor ve bu, effect FLUSH
//   edilirken SENKRON calisiyor — React 19 bunu `set-state-in-effect` ile
//   isaretliyor (cascading render). Deponun uyari sayaci bir zamanlar 77 tanesini
//   bu sinifta sayiyordu.
//
//   OLCULDU (2026-09-10): `setLoading(true)`'yu `load`dan CIKARMAK YETMIYOR.
//   Kural, effect'ten cagrilan fonksiyonun ICINDEKI setState'i de "effect'te
//   senkron" sayiyor — `await`ten SONRA gelse bile. Yani her cagri yerinde istegi
//   effect ICINDE elle kurmak gerekiyordu; bu da ayni 12 satirin dosya dosya
//   kopyalanmasi demekti (alti dosyada tam olarak bu yapildi).
//
// COZUM
//   Zamanlamayi TEK BIR YERDE dogru yapmak. Bu hook state SAHIPLENMEZ — cagiran
//   kendi state'ini ve `reload()` fonksiyonunu korur (Yenile dugmesi onu cagirir
//   ve olay isleyicisinde setState zaten mesrudur). Hook yalnizca SU IKI SEYI
//   garanti eder:
//
//     1. Cagirilan is, effect flush'indan SONRAKI mikro-goreve ertelenir
//        (`await Promise.resolve()`). Boylece callback'in ILK satirinda
//        `setLoading(true)` olsa bile o setState effect govdesinde SENKRON
//        DEGILDIR — sikayet edilen davranis gercekten ortadan kalkar.
//     2. Iptal: bilesen sokulduyse callback'e verilen `alive()` false doner ve
//        cozulmus bir istek artik olmayan bir bilesene yazmaz.
//
// DURUSTLUK NOTU
//   ESLint kurali OZEL HOOK'LARIN ICINE BAKMAZ. Yani bu hook'u kullanan cagri
//   yerleri artik kural tarafindan DENETLENMIYOR. Takas bilincli: 30'dan fazla
//   ayri ayri isaretlenen yer yerine, TEK bir denetlenmis uygulama + onu koruyan
//   bir bekci (`useAsyncEffect` bekcisi: ertelemenin silinemeyecegini olcer).
//   Erteleme kaldirilirsa bekci kirmiziya doner.
import { useEffect, type DependencyList } from 'react';

/**
 * Bir asenkron yuklemeyi effect'te calistirir.
 *
 * @param run   Yapilacak is. `alive()` false donduyse bilesen sokulmustur —
 *              setState yapmayin.
 * @param deps  `useEffect` bagimlilik listesiyle AYNI anlamda.
 *
 * @example
 *   const [rows, setRows] = useState<Row[]>([]);
 *   const [loading, setLoading] = useState(true);
 *
 *   // Yenile dugmesi bunu cagirir (olay isleyicisi — setState mesru).
 *   const reload = useCallback(async () => {
 *     setLoading(true);
 *     try { setRows((await api.list()).rows); } finally { setLoading(false); }
 *   }, []);
 *
 *   useAsyncEffect(async (alive) => { if (alive()) await reload(); }, []);
 */
export function useAsyncEffect(
  run: (alive: () => boolean) => Promise<void> | void,
  deps: DependencyList,
): void {
  useEffect(() => {
    let live = true;
    void (async () => {
      // ERTELEME BURADA — hook'un butun anlami bu satir.
      // Effect flush'i sirasinda degil, ONDAN SONRAKI mikro-gorevde calisir.
      // Silinirse callback'in ilk setState'i yine effect govdesinde senkron olur
      // ve sikayet edilen cascading render geri gelir.
      await Promise.resolve();
      if (!live) return;
      await run(() => live);
    })();
    return () => {
      live = false;
    };
    // Bagimliliklar CAGIRANIN sozlesmesi; burada dogrulanamaz.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
