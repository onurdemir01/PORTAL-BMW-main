import React, { createContext, useState, useEffect, useCallback, useRef, useContext, useMemo } from "react";
import { User } from "@/types";
import { pageVisibilityApi, visibilityApi } from "@/api/adminApi";
import { fetchSessionWithRetry } from "./sessionRestore";
import {
  kullaniciEtkinligiBildir,
  kullaniciEtkinligiSifirla,
  oturumBasligiAbone,
  oturumBittiAbone,
  oturumDurumunuBildir,
  type OturumBitisSebebi,
} from "@/api/sessionGuard";
import { bitisSebebi, oturumSaatiOlustur, tarayiciKanali, uyariHesapla, type OturumOzeti } from "./sessionClock";
import ReloginOverlay from "@/components/ReloginOverlay";

interface AuthContextType {
  user: User | null;
  isAuthenticated: boolean;
  login: (username: string, password: string, remember?: boolean) => Promise<void>;
  logout: () => void;
  showTimeoutModal: boolean;
  countdown: number;
  /** "Surdur": sunucuda oturumu uzatir (POST /api/auth/session/extend). */
  extendSession: () => void;
  /** Uyariyi KAPATIR ama sureyi UZATMAZ (eskiden kapatmak da uzatiyordu). */
  dismissTimeoutModal: () => void;
  /** false: sinir mutlak sure — uzatilamaz, yalnizca yeniden giris. */
  timeoutExtendable: boolean;
  /** Giristen sonra BIR KEZ gosterilecek not (or. esanli oturum siniri eski oturumu kapatti). */
  girisNotu: string | null;
  girisNotunuTemizle: () => void;
  // Sayfa görünürlüğü: tek yerden fetch edilip hem Sidebar (nav gizleme) hem
  // route guard'ları (gerçek erişim engeli) tarafından paylaşılır — bkz.
  // src/routes/PageVisibilityRoute.tsx. "Admin" sayfası bilinçli olarak bu
  // sistemin DIŞINDA tutulur (her zaman yalnızca Admin, ayrı hardcoded kural).
  pageVisibility: Record<string, string[]>;
  pageVisibilityLoaded: boolean;
  canViewPage: (pageId: string) => boolean;
  // Dinamik görünürlük motoru: her element (page/tab/button/...) için per-user çözülmüş
  // görünürlük. `canSee` sayfa+tab+buton her seviyede kullanılır (bkz. useCanSee).
  // `canViewPage` geriye-uyumlu olarak bunun üzerine kuruludur.
  canSee: (elementKey: string) => boolean;
  // Görünürlük haritası SUNUCUDAN BAŞARIYLA yüklendi mi? Gated veri fetch'lerinin (ör.
  // /tasks/stats) yalnızca bu true iken tetiklenmesi için — aksi halde boş/default-open harita
  // yüzünden gated uç'lara istek atılıp 403 cascade oluşuyordu (bkz. Faz 1).
  visibilityReady: boolean;
  // Harita kalıcı olarak alınamadı mı (ilk deneme + bir retry başarısız)? Route guard'ları
  // bu durumda korumalı sayfayı AÇMAZ — sunucu tarafı da fail-closed davranır.
  visibilityFailed: boolean;
  // Görünürlük haritasını manuel tazeler (admin bir değişiklik kaydettikten hemen sonra).
  /** Görünürlük haritasını tazeler; harita GERÇEKTEN yüklendiyse true döner. */
  refreshVisibility: () => Promise<boolean>;
}

export const AuthContext = createContext<AuthContextType>({} as AuthContextType);

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
};

// Giris yaniti JSON degilse (502/HTML: portal yeniden basliyor) ham "Unexpected token
// '<'" yerine anlasilir mesaj.
async function girisYanitiOku(res: Response): Promise<any> {
  try {
    return await res.json();
  } catch {
    throw new Error(
      res.status >= 500
        ? "Portal şu an güncelleniyor ya da yanıt vermiyor. Birkaç saniye sonra tekrar deneyin."
        : "Sunucudan beklenmeyen yanıt alındı. Lütfen tekrar deneyin.",
    );
  }
}

function kullaniciCikar(d: any): User {
  return {
    username:    d.username,
    role:        d.role,
    displayName: d.displayName || d.username,
    mail:        d.mail || "",
    photoUrl:    d.photoUrl || null,
    authSource:  d.authSource || "local",
  };
}

// Kullanici etkinligi sayilan olaylar. Eskiden yalnizca mousemove/keydown/mousedown/
// touchstart idi: kaydirarak okuyan ya da baska sekmeden donen kullanici "bosta" sayiliyordu.
// `focus` YALNIZCA pencerenin kendisi icin sayilir (asagida): programatik odak — acilan /
// kapanan pencere, autofocus — kullanici girdisi degildir.
const ETKINLIK_OLAYLARI = ["pointerdown", "keydown", "wheel", "scroll", "touchstart", "mousemove", "focus"];

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  // Uyarinin acildigi SAAT SURUMU (null = kapali). Gorunurluk bundan TURETILIR: sunucunun
  // bitisi degisince (baska sekme uzatti) surum artar ve eski uyari kendiliginden kapanir.
  // Bitis ANI karsilastirilmaz: saat farki olcumu onu birkac ms oynatir (sessionClock.surum).
  const [uyariSurum, setUyariSurum] = useState<number | null>(null);
  const [countdown, setCountdown] = useState(0);
  const [girisNotu, setGirisNotu] = useState<string | null>(null);
  const girisNotunuTemizle = useCallback(() => setGirisNotu(null), []);
  // Oturum sunucuda bitti ama uygulama SOKULMEDI: ustte yeniden giris katmani acik.
  // Eskiden `setUser(null)` ile tum uygulama sokuluyor, acik form/sihirbaz kayboluyordu.
  const [oturumDustu, setOturumDustu] = useState<{ sebep: OturumBitisSebebi } | null>(null);
  // Kanal dinleyicileri guncel degeri okusun diye (abonelik bir kez kurulur).
  const userRef = useRef<User | null>(null);
  const oturumDustuRef = useRef<{ sebep: OturumBitisSebebi } | null>(null);
  const [loading, setLoading] = useState(true);
  // Acilista sunucuya ulasilamiyorsa (release penceresi) kacinci denemede oldugumuz:
  // 0 = sorun yok. >0 iken bos ekran yerine "Portal guncelleniyor" mesaji gosterilir.
  const [restoreAttempt, setRestoreAttempt] = useState(0);
  const [pageVisibility, setPageVisibility] = useState<Record<string, string[]>>({});
  const [pageVisibilityLoaded, setPageVisibilityLoaded] = useState(false);
  // Element bazlı çözülmüş görünürlük haritası (key → görünür mü) + izlenen versiyon.
  const [visibilityMap, setVisibilityMap] = useState<Record<string, boolean>>({});
  const [visibilityReady, setVisibilityReady] = useState(false);
  const [visibilityFailed, setVisibilityFailed] = useState(false);
  const visibilityVersion = useRef(0);
  useEffect(() => {
    userRef.current = user;
    oturumDustuRef.current = oturumDustu;
  }, [user, oturumDustu]);

  // Tek oturum saati; sekmeler arasi kanal (sessionClock.ts).
  const [saat] = useState(() => oturumSaatiOlustur());
  // Kanal bir efekt kaynagi: baglama ve ayirma AYNI efektte (StrictMode'un sok-yeniden-kur
  // turunda kanal yeniden acilir; eskiden kalici kapaniyordu).
  useEffect(() => saat.baglan(tarayiciKanali()), [saat]);
  // Her /api yanitindaki bitis basliklari saati tazeler (ek yoklama yok).
  useEffect(() => oturumBasligiAbone((b) => saat.basliklariUygula(b)), [saat]);

  // Kullanicinin BILEREK yaptigi cikis. Diger sekmelere de yayilir — onlar sunucuya
  // ayrica gitmez. Istemci bunun DISINDA hicbir kosulda kendi basina logout CAGIRMAZ.
  const logout = useCallback(async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } catch {
      // ignore network errors on logout
    }
    saat.cikisYay();
    saat.sifirla();
    setOturumDustu(null);
    setUser(null);
    setUyariSurum(null);
  }, [saat]);

  // Uyarinin EKRANDA oldugu saat surumu (0 = ekranda degil). `uyar()` icinde SENKRON
  // yazilir: uyari acilirken Modal odagi tasir ve o olay state guncellenmeden once gelir —
  // state'e bakan surum uyariyi kendi kendine uzatiyordu (Faz B dersi). Deger SURUM oldugu
  // icin sunucunun bitisi degisince (baska sekme uzatti) kendiliginden gecersiz kalir;
  // "takili kalan isaret" yuzunden etkinligin hic sayilmamasi mumkun degildir.
  //
  // ILK YAZIMDA bitis ANI tutuluyor ve canli saatle `===` karsilastiriliyordu. Uretim
  // derlemesiyle gercek tarayicida bozuldu: ag gecikmesinden dogan birkac ms'lik saat farki
  // iki degeri esitsiz kiliyor, uyari ekrandayken fare hareketi oturumu sessizce uzatiyordu.
  const uyariEkrandaSurum = useRef(0);

  const extendSession = useCallback(() => {
    uyariEkrandaSurum.current = 0;
    kullaniciEtkinligiBildir();
    setUyariSurum(null);
    void saat.uzat();
  }, [saat]);

  // Uyariyi yalnizca BU bitis ani icin kapatir; KAPATMAK sureyi uzatmaz. Kullanici
  // kapatip calismaya devam ederse sonraki GERCEK girdisi olagan kurallarla sayilir;
  // kapatip masadan kalkarsa oturum bitis aninda kapanir.
  const kapatilanSurum = useRef(0);
  const dismissTimeoutModal = useCallback(() => {
    kapatilanSurum.current = saat.durum().surum;
    uyariEkrandaSurum.current = 0;
    setUyariSurum(null);
  }, [saat]);

  // Restore session from backend on mount
  useEffect(() => {
    // Oturum geri yukleme GECICI hatalarda YENIDEN DENER. Eskiden tek istek atiliyor
    // ve `r.ok` degilse sonuc "oturum yok" sayiliyordu; release sirasinda backend
    // birkac saniye kapali oldugu icin o pencerede sayfayi acan/yenileyen herkes,
    // cerezi ve DB'deki oturumu GECERLI oldugu halde login ekranina dusuyordu.
    // Ayrim sunucuda zaten var: 401 = oturum yok (kesin), 5xx/ag hatasi = gecici.
    // Denemeler surerken `loading` true kaldigi icin kullanici login ekrani GORMEZ.
    let cancelled = false;
    (async () => {
      const data = await fetchSessionWithRetry({
        cancelled: () => cancelled,
        onRetry: (attempt) => { if (!cancelled) setRestoreAttempt(attempt); },
        onGiveUp: (attempts) =>
          console.warn(`[Auth] /api/auth/me ${attempts} denemede yanit vermedi — ` +
            "sunucu erisilemiyor olabilir; oturum acilmamis sayildi."),
      });
      if (cancelled) return;
      if (data?.ok && data.user) {
        setUser(kullaniciCikar(data.user));
        void saat.tazele();
      }
      setLoading(false);
    })();

    pageVisibilityApi.get()
      .then(setPageVisibility)
      .catch(() => {})
      .finally(() => setPageVisibilityLoaded(true));

    // Yeni element-bazlı çözülmüş görünürlük — canViewPage/canSee bunun üzerine kurulu.
    refreshVisibility();

    // Unmount sonrasi setState'i onler (StrictMode cift-mount dahil).
    return () => { cancelled = true; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Çözülmüş görünürlük haritasını (element→bool) sunucudan tazeler + versiyonu kaydeder.
  // Dönüş: harita GERÇEKTEN yüklendi mi (401/503/motor-hatası → false).
  const refreshVisibility = useCallback((): Promise<boolean> => {
    return visibilityApi.getResolved()
      .then(({ version, visibility }) => {
        visibilityVersion.current = version;
        setVisibilityMap(visibility);
        setVisibilityReady(true); // BAŞARILI yükleme → gated fetch'ler artık tetiklenebilir
        setVisibilityFailed(false);
        return true;
      })
      .catch(() => false); // açılışta authsız/401 olabilir — ready FALSE kalır, gated fetch atılmaz
  }, []);

  // İlk yüklemede harita gelmezse BİR kez daha dener; o da başarısızsa `visibilityFailed`
  // işaretlenir ve route guard'ları korumalı sayfaları açmaz (fail-closed). Yalnızca
  // oturum açmış kullanıcı için anlamlıdır — login öncesi 401 normaldir.
  useEffect(() => {
    if (!user || visibilityReady) return;
    const id = window.setTimeout(async () => {
      // State updater'ı saf tutmak için sonucu doğrudan refreshVisibility'den okuruz
      // (updater içinde başka setState çağırmak StrictMode'da iki kez çalışırdı).
      const ok = await refreshVisibility();
      if (!ok) setVisibilityFailed(true);
    }, 2500);
    return () => window.clearTimeout(id);
  }, [user, visibilityReady, refreshVisibility]);

  // ── OTURUM BITTI KAPISI (P1-3) ──────────────────────────────────────────────
  //
  // PR #117 gorunurluk yoklamasini `user` bagimliligina baglayarak durdurmustu.
  // Ama `user` kapisi OLMAYAN dongular vardi ve her yeni dongu ayni hatayi
  // yeniden getirebiliyordu (or. RequestsSidePanel `smart-tickets/mine`i 120
  // sn'de bir, kosulsuz yokluyordu — uretimde 854 adet 401).
  //
  // Artik karar TEK YERDE: sunucunun imzaladigi bir oturum-401'i goren
  // `sessionGuard` kapiyi kapatir; burasi yalnizca kullaniciyi giris ekranina
  // duser. Dongulerin durmasi bu satira BAGLI DEGIL — kapi zaten agi kesiyor;
  // bu, kullaniciya NE OLDUGUNU soyleyen kisim.
  //
  // 2026-10-02 (Faz B): kullanici giris ekranina ATILMAZ; uygulama yerinde kalir ve
  // ustte yeniden giris katmani acilir (AWS konsolu deseni) — acik form ve sihirbaz
  // durumu korunur. Sebep (bosta / mutlak) sunucunun basligindan gelir.
  useEffect(() => oturumBittiAbone((sebep) => {
    setUyariSurum(null);
    // Sunucu sebebi yalnizca ILK istege soyler; diger sekmeler kendi saatinden cikarir.
    setOturumDustu({ sebep: sebep ?? bitisSebebi(saat.durum(), Date.now()) });
  }), [saat]);

  // Diger sekmeden cikis: bu sekme de giris ekranina duser (sunucuya ayrica gitmez).
  useEffect(() => saat.cikisAbone(() => {
    saat.sifirla();
    setOturumDustu(null);
    setUser(null);
    setUyariSurum(null);
  }), [saat]);

  // Diger sekmede giris yapildi: bu sekme giris ekranindaysa ya da yeniden giris
  // katmani aciksa oturumu sunucudan okuyup devam eder. Farkli kullanici ise TAM
  // yenileme — onceki kullanicinin ekran verisi yeni kullaniciya gorunmesin.
  useEffect(() => saat.girisAbone(async (gelen) => {
    const mevcut = userRef.current;
    if (mevcut && !oturumDustuRef.current) return;
    if (mevcut && gelen.toLowerCase() !== mevcut.username.toLowerCase()) {
      window.location.reload();
      return;
    }
    oturumDurumunuBildir(true);
    try {
      const r = await fetch("/api/auth/me");
      const d = r.ok ? await r.json() : null;
      if (!d?.ok || !d.user) return;
      setOturumDustu(null);
      setUser(kullaniciCikar(d.user));
      void saat.tazele();
      void refreshVisibility();
    } catch {
      /* ag hatasi: katman acik kalir, kullanici kendisi girer */
    }
  }), [saat]); // eslint-disable-line react-hooks/exhaustive-deps


  // Kapi "oturum VARDI ve OLDU" ayrimini yapabilsin diye istemcinin inancini
  // bildirir. Giris ekranindaki 401 bitmis bir oturum DEGILDIR; orada kapi
  // kapanirsa henuz giris yapmamis kullanicinin istekleri sessizce yutulurdu.
  useEffect(() => oturumDurumunuBildir(!!user), [user]);

  // Canlı yayılım: admin bir görünürlük değişikliği yapınca versiyon artar; istemci hafif
  // version ucunu poll'leyip değişince haritayı yeniden çeker — reload GEREKMEZ.
  //
  // 401 GELDIGINDE YOKLAMA DURUR (2026-09-20). Eskiden oturum dustugunde bu
  // dongu SONSUZA DEK donmeye devam ediyordu: sunucu yeniden baslayip oturumlari
  // sildiginde `user` istemci tarafinda hala doluydu ve her 45 saniyede iki
  // istek (version + resolved) 401 uretiyordu. Uretimde 13,5 gunde 6.690 istek
  // yalnizca bu iki uctan geldi.
  //
  // Artik 401 "oturum bitti" demektir: `setUser(null)` ile uygulama giris
  // ekranina duser ve dongu (bagimlilik `user`) KENDILIGINDEN durur.
  useEffect(() => {
    if (!user) return;
    const id = window.setInterval(() => {
      visibilityApi.getVersion()
        .then(({ version, unauthorized }) => {
          // Karar YALNIZCA sessionGuard'in (imzali 401). Eskiden burada ciplak 401
          // kullaniciyi dusuruyordu — kapinin "yalnizca imzali 401" kuralini atlayan
          // ikinci bir yoldu (AWX token 401'i de buradan dusurebilirdi).
          if (unauthorized) return;
          if (version !== visibilityVersion.current) refreshVisibility();
        })
        .catch(() => {});
    }, 45_000);
    return () => window.clearInterval(id);
  }, [user, refreshVisibility]);

  // Tek element (page/tab/button/...) görünür mü? Registry'de OLMAYAN key → varsayılan
  // görünür (kayıtsız öğeyi yanlışlıkla gizlememek için — sunucu tarafı da aynı davranır).
  const canSee = useCallback((elementKey: string): boolean => {
    return elementKey in visibilityMap ? visibilityMap[elementKey] : true;
  }, [visibilityMap]);

  // Geriye-uyumlu sayfa kontrolü — element motorunun üzerine kurulu. "Admin" sayfası her
  // zaman yalnızca Admin rolüne (motor da aynı sonucu verir; güvenlik için burada da sabit).
  const canViewPage = useCallback((pageId: string): boolean => {
    if (pageId === "Admin") return user?.role === "Admin";
    return canSee(pageId);
  }, [canSee, user]);

  const girisIstegi = async (username: string, password: string, remember: boolean) => {
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: username.trim(), password, remember }),
    });
    const data = await girisYanitiOku(res);
    if (!data.ok) {
      // Sunucu bekleme suresi verdiyse (kullanici basina geri cekilme / IP siniri) giris
      // ekrani geri sayim gosterir.
      const e = new Error(data.error || "Giriş başarısız") as Error & { retryAfter?: number; code?: string };
      const ra = Number(data.retryAfter ?? res.headers.get("Retry-After"));
      if (ra > 0) e.retryAfter = ra;
      if (data.code) e.code = data.code;
      throw e;
    }
    return data as { session?: OturumOzeti } & Record<string, any>;
  };

  const login = async (username: string, password: string, remember = false): Promise<void> => {
    const data = await girisIstegi(username, password, remember);
    // Kapi HEMEN acilir: oturumu dusup cikis yapan kullanicida kapi kapali kalmis olabilir;
    // acilmazsa asagidaki gorunurluk istegi aga cikmaz ve harita 2,5 sn bos kalirdi.
    oturumDurumunuBildir(true);
    kullaniciEtkinligiBildir();
    if (Number(data.closedOthers) > 0) {
      setGirisNotu(
        `Eşzamanlı oturum sınırı nedeniyle en eski ${data.closedOthers} oturumunuz kapatıldı. ` +
          "Tanımadığınız bir giriş olduysa şifrenizi değiştirin.",
      );
    }
    setOturumDustu(null);
    setUser(kullaniciCikar(data));
    saat.ozetUygula(data.session);
    saat.girisYay(data.username);
    // Login ÖNCESİ çekilen harita 401 aldığı için boştur. Burada tazelenmezse kullanıcı
    // ilk versiyon poll'üne (45 sn) kadar boş haritayla, yani varsayılan-açık gezerdi.
    await refreshVisibility();
  };

  // Yerinde yeniden giris. AYNI kullanici: kapi yeniden acilir, uygulama yerinde devam
  // eder. FARKLI kullanici: tam yenileme (ekrandaki veri baskasina ait).
  const yenidenGiris = async (username: string, password: string): Promise<void> => {
    const data = await girisIstegi(username, password, saat.durum().remember);
    const onceki = userRef.current;
    if (onceki && String(data.username).toLowerCase() !== onceki.username.toLowerCase()) {
      saat.girisYay(data.username);
      window.location.reload();
      return;
    }
    oturumDurumunuBildir(true);
    kullaniciEtkinligiBildir();
    setUser(kullaniciCikar(data));
    saat.ozetUygula(data.session);
    setOturumDustu(null);
    saat.girisYay(data.username);
    await refreshVisibility();
  };

  // ── Uyari zamanlayicisi: SUNUCUNUN bitis zamanlarina gore ─────────────────────
  // Bitis aninda istemci logout CAGIRMAZ; sunucuya "saatim ne" diye sorar. Oturum
  // gercekten bittiyse imzali 401 kapiyi kapatir (yukaridaki abone katmani acar);
  // baska bir sekme uzattiysa yeni bitisler gelir ve uyari kendiliginden kapanir.
  const [saatDurumu, setSaatDurumu] = useState(() => saat.durum());
  useEffect(() => saat.abone(setSaatDurumu), [saat]);
  const uyariBilgisi = useMemo(() => (saatDurumu.bilinen ? uyariHesapla(saatDurumu) : null), [saatDurumu]);
  const timeoutExtendable = uyariBilgisi?.uzatilabilir ?? true;
  const showTimeoutModal = !!user && !oturumDustu && !!uyariBilgisi && uyariSurum === saatDurumu.surum;
  useEffect(() => {
    if (!user || oturumDustu || !uyariBilgisi) return;
    const { bitis, uyariAni } = uyariBilgisi;
    const surum = saatDurumu.surum;
    let geriSayim: number | null = null;
    const kalanSn = () => Math.max(0, Math.round((bitis - Date.now()) / 1000));
    const uyar = () => {
      if (kapatilanSurum.current === surum) return;
      // Uyari ekrandayken karar kullanicinin: ne girdi ne otomatik istek sureyi uzatir.
      uyariEkrandaSurum.current = surum;
      kullaniciEtkinligiSifirla();
      setCountdown(kalanSn());
      setUyariSurum(surum);
      geriSayim = window.setInterval(() => setCountdown(kalanSn()), 1000);
    };
    const t1 = window.setTimeout(uyar, Math.max(0, uyariAni - Date.now()));
    const t2 = window.setTimeout(() => void saat.tazele(), Math.max(0, bitis - Date.now()) + 1000);
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
      if (geriSayim !== null) window.clearInterval(geriSayim);
    };
  }, [user, oturumDustu, uyariBilgisi, saatDurumu.surum, saat]);

  // Etkinlik iki yere bildirilir: sessionGuard (isteklerin arka plan isareti) ve
  // sessionClock (API cagrisi uretmeyen etkinlik icin kisitli `extend`). Uyari
  // EKRANDAYKEN bildirilmez — karar kullanicinin acik tiklamasi ("Surdur") olmali.
  useEffect(() => {
    if (!user || oturumDustu) return;
    const etkin = () => {
      const ekrandaki = uyariEkrandaSurum.current;
      if (ekrandaki && ekrandaki === saat.durum().surum) return;
      kullaniciEtkinligiBildir();
      saat.etkinlik();
    };
    const handle = (e: Event) => {
      // Programatik odak (acilan/kapanan pencere, autofocus) kullanici girdisi degildir;
      // yalnizca PENCERENIN odagi geri almasi (baska uygulamadan donus) sayilir. Bir OGENIN
      // odaklanmasinda hedef bir DOM dugumudur; pencerenin odaklanmasinda degildir.
      if (e.type === "focus" && e.target instanceof Node) return;
      etkin();
    };
    const gorunurluk = () => {
      if (document.visibilityState !== "visible") return;
      // Sekmeye donus: once saati esitle (baska sekme uzatmis olabilir), sonra etkinlik.
      void saat.tazele().then(etkin);
    };
    ETKINLIK_OLAYLARI.forEach((e) => window.addEventListener(e, handle, { passive: true, capture: true }));
    document.addEventListener("visibilitychange", gorunurluk);
    return () => {
      ETKINLIK_OLAYLARI.forEach((e) => window.removeEventListener(e, handle, { capture: true }));
      document.removeEventListener("visibilitychange", gorunurluk);
    };
  }, [user, oturumDustu, saat]);

  if (loading) {
    if (restoreAttempt === 0) return null;
    // Sunucu (henuz) yanit vermiyor: buyuk olasilikla release. Oturum DB'de duruyor;
    // login ekranina DUSURMEDEN beklenir, sunucu gelince kaldigi yerden devam eder.
    return (
      <div className="min-h-screen flex items-center justify-center px-6" style={{ background: 'var(--bg-page, #f4f4f4)' }}>
        <div className="max-w-md w-full rounded-2xl border px-6 py-5 text-center" style={{ borderColor: 'var(--border-subtle, #ddd)', background: 'var(--bg-surface, #fff)' }}>
          <div className="text-base font-semibold" style={{ color: 'var(--text-primary, #111)' }}>Portal şu an yanıt vermiyor</div>
          <p className="mt-1.5 text-sm" style={{ color: 'var(--text-secondary, #444)' }}>
            Büyük olasılıkla bir güncelleme yapılıyor. Oturumunuz korunuyor; bağlantı gelince kaldığınız yerden devam edeceksiniz.
          </p>
          <p className="mt-2 text-xs tabular-nums" style={{ color: 'var(--text-muted, #777)' }}>yeniden deneniyor… ({restoreAttempt}. deneme)</p>
        </div>
      </div>
    );
  }

  return (
    <AuthContext.Provider
      value={{
        user, isAuthenticated: !!user, login, logout, showTimeoutModal, countdown, extendSession,
        dismissTimeoutModal, timeoutExtendable, girisNotu, girisNotunuTemizle,
        pageVisibility, pageVisibilityLoaded, canViewPage, canSee, visibilityReady, visibilityFailed, refreshVisibility,
      }}
    >
      {children}
      {user && oturumDustu && (
        <ReloginOverlay
          username={user.username}
          sebep={oturumDustu.sebep}
          onLogin={yenidenGiris}
          onLogout={logout}
        />
      )}
    </AuthContext.Provider>
  );
};
