import React, { createContext, useState, useEffect, useCallback, useRef, useContext } from "react";
import { User } from "@/types";
import { pageVisibilityApi, visibilityApi } from "@/api/adminApi";

interface AuthContextType {
  user: User | null;
  isAuthenticated: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
  showTimeoutModal: boolean;
  countdown: number;
  extendSession: () => void;
  // Sayfa görünürlüğü: tek yerden fetch edilip hem Sidebar (nav gizleme) hem
  // route guard'ları (gerçek erişim engeli) tarafından paylaşılır — bkz.
  // src/routes/PageVisibilityRoute.tsx. "Admin" sayfası bilinçli olarak bu
  // sistemin DIŞINDA tutulur (her zaman yalnızca Admin, ayrı hardcoded kural).
  pageVisibility: Record<string, string[]>;
  pageVisibilityLoaded: boolean;
  canViewPage: (pageId: string) => boolean;
  // Dinamik görünürlük motoru: her element (page/tab/button/...) için per-user çözülmüş
  // görünürlük. `canSee` sayfa+tab+buton her seviyede kullanılır (bkz. <Gate>/useCanSee).
  // `canViewPage` geriye-uyumlu olarak bunun üzerine kuruludur.
  canSee: (elementKey: string) => boolean;
  // Görünürlük haritası SUNUCUDAN BAŞARIYLA yüklendi mi? Gated veri fetch'lerinin (ör.
  // /tasks/stats) yalnızca bu true iken tetiklenmesi için — aksi halde boş/default-open harita
  // yüzünden gated uç'lara istek atılıp 403 cascade oluşuyordu (bkz. Faz 1).
  visibilityReady: boolean;
  // Görünürlük haritasını manuel tazeler (admin bir değişiklik kaydettikten hemen sonra).
  refreshVisibility: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextType>({} as AuthContextType);

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
};

const SESSION_TIMEOUT = 30 * 60 * 1000; // 30 minutes
const TIMEOUT_WARNING = 2 * 60 * 1000;  // 2 minutes before

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [showTimeoutModal, setShowTimeoutModal] = useState(false);
  const [countdown, setCountdown] = useState(TIMEOUT_WARNING / 1000);
  const [loading, setLoading] = useState(true);
  const [pageVisibility, setPageVisibility] = useState<Record<string, string[]>>({});
  const [pageVisibilityLoaded, setPageVisibilityLoaded] = useState(false);
  // Element bazlı çözülmüş görünürlük haritası (key → görünür mü) + izlenen versiyon.
  const [visibilityMap, setVisibilityMap] = useState<Record<string, boolean>>({});
  const [visibilityReady, setVisibilityReady] = useState(false);
  const visibilityVersion = useRef(0);

  const timeoutId = useRef<number | null>(null);
  const warningTimeoutId = useRef<number | null>(null);
  const countdownIntervalId = useRef<number | null>(null);

  const clearTimers = useCallback(() => {
    if (timeoutId.current) window.clearTimeout(timeoutId.current);
    if (warningTimeoutId.current) window.clearTimeout(warningTimeoutId.current);
    if (countdownIntervalId.current) window.clearInterval(countdownIntervalId.current);
  }, []);

  const logout = useCallback(async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } catch {
      // ignore network errors on logout
    }
    setUser(null);
    setShowTimeoutModal(false);
    clearTimers();
  }, [clearTimers]);

  const resetSessionTimeout = useCallback(() => {
    clearTimers();
    setShowTimeoutModal(false);

    warningTimeoutId.current = window.setTimeout(() => {
      setShowTimeoutModal(true);
      setCountdown(TIMEOUT_WARNING / 1000);
      countdownIntervalId.current = window.setInterval(() => {
        setCountdown((prev) => (prev > 0 ? prev - 1 : 0));
      }, 1000);
    }, SESSION_TIMEOUT - TIMEOUT_WARNING);

    timeoutId.current = window.setTimeout(logout, SESSION_TIMEOUT);
  }, [clearTimers, logout]);

  const extendSession = () => resetSessionTimeout();

  // Restore session from backend on mount
  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.ok && data.user) {
          setUser({
            username:    data.user.username,
            role:        data.user.role,
            displayName: data.user.displayName || data.user.username,
            mail:        data.user.mail || "",
            photoUrl:    data.user.photoUrl || null,
            authSource:  data.user.authSource || "local",
          });
          resetSessionTimeout();
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));

    pageVisibilityApi.get()
      .then(setPageVisibility)
      .catch(() => {})
      .finally(() => setPageVisibilityLoaded(true));

    // Yeni element-bazlı çözülmüş görünürlük — canViewPage/canSee bunun üzerine kurulu.
    refreshVisibility();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Çözülmüş görünürlük haritasını (element→bool) sunucudan tazeler + versiyonu kaydeder.
  const refreshVisibility = useCallback(() => {
    return visibilityApi.getResolved()
      .then(({ version, visibility }) => {
        visibilityVersion.current = version;
        setVisibilityMap(visibility);
        setVisibilityReady(true); // BAŞARILI yükleme → gated fetch'ler artık tetiklenebilir
      })
      .catch(() => { /* açılışta authsız/401 olabilir — ready FALSE kalır, gated fetch atılmaz */ });
  }, []);

  // Canlı yayılım: admin bir görünürlük değişikliği yapınca versiyon artar; istemci hafif
  // version ucunu poll'leyip değişince haritayı yeniden çeker — reload GEREKMEZ.
  useEffect(() => {
    if (!user) return;
    const id = window.setInterval(() => {
      visibilityApi.getVersion()
        .then((v) => { if (v !== visibilityVersion.current) refreshVisibility(); })
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

  const login = async (username: string, password: string): Promise<void> => {
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: username.trim(), password }),
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || "Giriş başarısız");

    setUser({
      username:    data.username,
      role:        data.role,
      displayName: data.displayName || data.username,
      mail:        data.mail || "",
      photoUrl:    data.photoUrl || null,
      authSource:  data.authSource || "local",
    });
    resetSessionTimeout();
  };

  // Activity resets timeout
  useEffect(() => {
    if (!user) return;
    const events = ["mousemove", "keydown", "mousedown", "touchstart"];
    const handle = () => resetSessionTimeout();
    events.forEach((e) => window.addEventListener(e, handle, { passive: true }));
    return () => {
      events.forEach((e) => window.removeEventListener(e, handle));
      clearTimers();
    };
  }, [user, resetSessionTimeout, clearTimers]);

  if (loading) return null;

  return (
    <AuthContext.Provider
      value={{
        user, isAuthenticated: !!user, login, logout, showTimeoutModal, countdown, extendSession,
        pageVisibility, pageVisibilityLoaded, canViewPage, canSee, visibilityReady, refreshVisibility,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};
