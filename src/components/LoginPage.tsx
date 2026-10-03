// src/components/LoginPage.tsx — OpenShift Console / Red Hat SSO giris ekrani deseni:
// koyu bir zemin ustunde ortalanmis beyaz form karti. Onceki surumdeki canvas ag
// animasyonu, aurora ve firca-darbesi aksani PF diline uymadigi icin kaldirildi;
// hareket yerine tipografi ve bosluk tasiyor.
import React, { useState, useContext, useEffect, useRef } from "react";
import { AuthContext } from "@/contexts/AuthContext";
import { EyeIcon, EyeSlashIcon, ExclamationCircleIcon } from "@heroicons/react/24/outline";
import { useLocation, useNavigate } from "react-router-dom";
import { PortalLogo } from "@/components/common/PortalLogo";

const LoginPage: React.FC = () => {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [rememberMe, setRememberMe] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  // "Beni hatirla" Admin'den kapatilabilir (SESSION_REMEMBER_DAYS=0): o zaman kutu
  // gosterilmez. Eskiden kutu vardi ama HICBIR SEY yapmiyordu (sunucuya gitmiyordu).
  const [hatirlaGun, setHatirlaGun] = useState<number | null>(null);
  const gonderiliyor = useRef(false);
  // Sunucu "bekle" dediyse (429 / esik asimi) dugme geri sayim boyunca kapali.
  const [bekleBitis, setBekleBitis] = useState(0);
  const [bekleSn, setBekleSn] = useState(0);
  const [capsLock, setCapsLock] = useState(false);

  useEffect(() => {
    if (!bekleBitis) return;
    const tik = () => {
      const kalan = Math.max(0, Math.ceil((bekleBitis - Date.now()) / 1000));
      setBekleSn(kalan);
      if (kalan === 0) setBekleBitis(0);
    };
    tik();
    const id = window.setInterval(tik, 1000);
    return () => window.clearInterval(id);
  }, [bekleBitis]);

  const capsKontrol = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (typeof e.getModifierState === "function") setCapsLock(e.getModifierState("CapsLock"));
  };

  useEffect(() => {
    let iptal = false;
    fetch("/api/auth/session-policy")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!iptal && d?.ok) setHatirlaGun(d.rememberEnabled ? Number(d.rememberDays) || 0 : 0);
      })
      .catch(() => {});
    return () => {
      iptal = true;
    };
  }, []);

  const { login, isAuthenticated } = useContext(AuthContext);
  const navigate = useNavigate();
  const location = useLocation();

  // Donus adresi YOL + SORGU + HASH: eskiden yalnizca yol korunuyordu; filtreli bir
  // listeden (`?q=...`) atilan kullanici filtresiz sayfaya donuyordu.
  const kaynak = (location.state as any)?.from;
  const from =
    kaynak && typeof kaynak.pathname === "string" && kaynak.pathname.startsWith("/") && kaynak.pathname !== "/login"
      ? `${kaynak.pathname}${typeof kaynak.search === "string" ? kaynak.search : ""}${typeof kaynak.hash === "string" ? kaynak.hash : ""}`
      : "/dashboard";

  // Zaten girisli kullanici giris formunu GORMEZ (2026-10-03). Iki durum:
  //   * baska bir sekmede giris yapildi — AuthContext kanaldan haber alip oturumu yukler;
  //     bu sekme eskiden formda takili kaliyordu (gercek tarayici testinde bulundu);
  //   * girisli kullanici adresi elle /login yazdi ya da yer imiyle acti.
  // Hedef, atildigi sayfadir (yoksa pano).
  useEffect(() => {
    if (isAuthenticated) navigate(from, { replace: true });
  }, [isAuthenticated, from, navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    // Cift gonderim (Enter + tik) iki giris istegi = iki oturum + bosa harcanan deneme.
    if (gonderiliyor.current || bekleSn > 0) return;
    setError("");

    if (!username.trim() || !password) {
      setError("Kullanıcı adı ve şifre gereklidir.");
      return;
    }

    gonderiliyor.current = true;
    setIsLoading(true);
    try {
      await login(username, password, rememberMe && !!hatirlaGun);
      navigate(from, { replace: true });
    } catch (err: any) {
      setError(err?.message || "Giriş başarısız. Lütfen tekrar deneyin.");
      if (err?.retryAfter > 0) setBekleBitis(Date.now() + err.retryAfter * 1000);
    } finally {
      gonderiliyor.current = false;
      setIsLoading(false);
    }
  };

  return (
    <div
      className="min-h-screen flex flex-col"
      /* Giris ekrani BILEREK koyu kalir — ayri bir marka ekranidir, uygulama kabugu
         degildir. Gradyan duraklari yalnizca PF6 notr grilerine tasindi
         (#1b1d21/#0f1214 PF5'in mavi-yesil calan tonlariydi). */
      style={{ background: "linear-gradient(150deg, #151515 0%, #292929 45%, #1f1f1f 100%)" }}
    >
      {/* Ust marka bandi */}
      <div className="flex items-center gap-3 px-6 py-6 lg:px-12">
        {/* Giris ekraninda logo TEK BASINA ve buyuk duruyor — referansin birebir
            karsiligi (bulut + mozaik + BMW wordmark) burada kullanilir. 56px:
            wordmark'in okunabildigi en kucuk boyut. Masthead'de ise yaninda zaten
            "BMW Portal" yazdigi icin sade `mark` varyanti kullanilir. */}
        <PortalLogo className="h-14 w-14" withWordmark />
        <p className="text-white text-lg leading-tight" style={{ fontFamily: "var(--font-display)", fontWeight: 500 }}>
          BMW Portal
        </p>
      </div>

      <div className="flex-1 flex items-start justify-center px-4 pb-16 pt-4 lg:pt-10">
        <div className="w-full max-w-[26rem]">
          {/* GIRIS KARTI BILEREK SABIT ACIK: bu ekran temayi izlemez, her zaman koyu
              bir zemin uzerinde beyaz bir karttir. Token'a baglamak koyu temada karti
              da koyulastirir ve okunurlugu bozardi — burasi uygulama kabugu degil,
              ayri bir marka ekrani. Metin renkleri de bu yuzden sabit; yalnizca PF5
              grilerinden PF6 notrlerine tasindilar (#6a6e73 -> #707070 vb.). */}
          <div className="px-8 py-8" style={{ background: "#ffffff", borderRadius: "var(--radius-md)", boxShadow: "var(--shadow-lg)" }}>
            <h1 style={{ fontFamily: "var(--font-display)", fontSize: "1.5rem", fontWeight: 500, color: "#151515" }}>
              Hesabınızla oturum açın
            </h1>
            <p className="mt-1 text-[0.875rem]" style={{ color: "#707070" }}>
              Kurumsal dizin (LDAP) kimlik bilgilerinizi kullanın.
            </p>

            <form className="mt-6 space-y-5" onSubmit={handleSubmit}>
              {error && (
                <div className="pf-alert pf-alert--danger" role="alert" style={{ color: "#151515" }}>
                  <ExclamationCircleIcon className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: "var(--status-danger)" }} />
                  <span>{error}</span>
                </div>
              )}

              <div>
                <label htmlFor="username" className="pf-label-text" style={{ color: "#151515" }}>Kullanıcı adı</label>
                <input
                  id="username"
                  name="username"
                  type="text"
                  autoComplete="username"
                  autoCapitalize="off"
                  spellCheck={false}
                  required
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="pf-input"
                />
              </div>

              <div>
                <label htmlFor="password" className="pf-label-text" style={{ color: "#151515" }}>Şifre</label>
                <div className="relative">
                  <input
                    id="password"
                    name="password"
                    type={showPassword ? "text" : "password"}
                    autoComplete="current-password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    onKeyDown={capsKontrol}
                    onKeyUp={capsKontrol}
                    className="pf-input pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    aria-label={showPassword ? "Şifreyi gizle" : "Şifreyi göster"}
                    className="absolute inset-y-0 right-0 px-3 flex items-center"
                    style={{ color: "#707070" }}
                  >
                    {showPassword ? <EyeSlashIcon className="h-5 w-5" /> : <EyeIcon className="h-5 w-5" />}
                  </button>
                </div>
                {capsLock && (
                  <p className="mt-1 text-[0.8125rem]" role="status" style={{ color: "#8a6100" }}>
                    Caps Lock açık — şifre büyük/küçük harfe duyarlıdır.
                  </p>
                )}
              </div>

              {!!hatirlaGun && (
              <div className="flex items-center gap-2">
                <input
                  id="remember-me"
                  name="remember-me"
                  type="checkbox"
                  checked={rememberMe}
                  onChange={(e) => setRememberMe(e.target.checked)}
                  className="h-4 w-4"
                  style={{ accentColor: "var(--accent)" }}
                />
                <label htmlFor="remember-me" className="text-[0.875rem]" style={{ color: "#151515" }}>
                  Beni hatırla ({hatirlaGun} gün)
                </label>
              </div>
              )}

              <button type="submit" disabled={isLoading || bekleSn > 0} className="btn-primary w-full py-2">
                {isLoading ? (
                  <span className="flex items-center justify-center gap-2">
                    <span className="h-4 w-4 rounded-full border-2 border-white/40 border-t-white animate-spin" />
                    Oturum açılıyor
                  </span>
                ) : bekleSn > 0 ? (
                  `Tekrar denemek için ${bekleSn} sn`
                ) : (
                  "Oturum aç"
                )}
              </button>
            </form>
          </div>

          <p className="mt-6 text-[0.75rem] leading-relaxed" style={{ color: "#8c8c8c" }}>
            Bu sistem yalnızca yetkili kullanıcılar içindir. Tüm oturum açma girişimleri kayıt altına alınır.
          </p>
          <p className="mt-2 text-[0.75rem]" style={{ color: "#707070" }}>
            © {new Date().getFullYear()} BMW Portal
          </p>
        </div>
      </div>
    </div>
  );
};

export default LoginPage;
