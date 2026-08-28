// src/layouts/AppLayout.tsx — PatternFly Page iskeleti (OpenShift Console yerlesimi):
//
//   ┌──────────────── Masthead (siyah, sabit) ────────────────┐
//   ├─ PageNav (koyu, dikey) ─┬─ main (acik gri icerik alani) ─┤
//   └─────────────────────────┴───────────────────────────────┘
//
// Nav, >=lg ekranlarda sabit acik; kucuk ekranlarda masthead'deki toggle ile
// acilan bir overlay (PF "drawer" davranisi).
import React, { Suspense, useContext, useEffect, useState } from "react";
import { Outlet, useLocation } from "react-router-dom";
import Masthead from "@/components/layout/Masthead";
import PageNav from "@/components/layout/PageNav";
import SessionTimeoutModal from "@/components/SessionTimeoutModal";
import PageErrorBoundary from "@/components/common/PageErrorBoundary";
import { AuthContext } from "@/contexts/AuthContext";
import { ToastContainer } from "@/components/common/Toast";
import { CommandPalette } from "@/components/common/CommandPalette";
import { AppDataProvider } from "@/contexts/AppContext";
import { JobTrackerProvider } from "@/contexts/JobTrackerContext";
import JobTrackerBar from "@/components/common/JobTrackerBar";
import RequestsSidePanel from "@/components/self_service/RequestsSidePanel";

// Sayfa yuklenirken icerik alanini dolduran iskelet. Spinner yerine iskelet:
// gelecek icerigin KABA HATLARINI gosterdigi icin gecis "yukleniyor -> icerik"
// siciramasi gibi degil, ayni yerin dolmasi gibi hissettirir.
function PageSkeleton() {
  return (
    <div className="animate-pulse space-y-4" aria-busy="true" aria-label="Sayfa yükleniyor">
      <div className="h-7 w-64 rounded-md" style={{ background: "var(--bg-elevated)" }} />
      <div className="h-4 w-96 max-w-full rounded" style={{ background: "var(--bg-elevated)" }} />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 pt-2">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="h-28 rounded-xl border" style={{ background: "var(--bg-surface)", borderColor: "var(--border)" }} />
        ))}
      </div>
    </div>
  );
}

export default function AppLayout() {
  const location = useLocation();
  const { showTimeoutModal, extendSession, logout, countdown } = useContext(AuthContext);

  const [navOpen, setNavOpen] = useState(true);
  const [isMobile, setIsMobile] = useState(() => typeof window !== "undefined" && window.innerWidth < 1024);

  useEffect(() => {
    function onResize() {
      const mobile = window.innerWidth < 1024;
      setIsMobile(mobile);
      setNavOpen(!mobile);
    }
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // Mobilde sayfa degisince nav'i kapat.
  useEffect(() => {
    if (isMobile) setNavOpen(false);
  }, [location.pathname, isMobile]);

  return (
    <AppDataProvider>
    <JobTrackerProvider>
      <div className="flex flex-col h-screen overflow-hidden" style={{ background: "var(--bg-base)" }}>
        {/* ICERIGE ATLA (2026-08-28). Klavye kullanicisi HER sayfada once masthead'i
            (menu ac/kapa, arama, tema, kullanici menusu) sonra sol menudeki ~15
            baglantiyi geciyordu — yani asil icerige ulasmak icin her seferinde 20'ye
            yakin Tab. `:focus-visible` tabani zaten vardi (index.css); eksik olan tek
            parca buydu.
            Gorunmez ama ODAKLANINCA gorunur: `sr-only` + `focus:not-sr-only`. */}
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:absolute focus:z-[100] focus:top-2 focus:left-2 focus:px-3 focus:py-2 focus:rounded-md focus:no-underline"
          style={{ background: "var(--accent)", color: "var(--text-on-accent)" }}
        >
          İçeriğe atla
        </a>
        <Masthead onToggleNav={() => setNavOpen((v) => !v)} />

        <div className="flex flex-1 min-h-0 relative">
          {navOpen && (
            <>
              {isMobile && (
                <div
                  className="fixed inset-0 z-30"
                  style={{ background: "rgba(3,3,3,0.5)", top: "var(--masthead-h)" }}
                  onClick={() => setNavOpen(false)}
                />
              )}
              <div
                className={isMobile ? "fixed left-0 z-40 h-full" : "relative"}
                style={isMobile ? { top: "var(--masthead-h)", bottom: 0, height: "auto" } : undefined}
              >
                <PageNav onNavigate={() => { if (isMobile) setNavOpen(false); }} />
              </div>
            </>
          )}

          {/* `id` skip-link'in hedefi; `tabIndex={-1}` olmadan bazi tarayicilar
              atlamadan sonra odagi GERCEKTEN buraya tasimaz ve bir sonraki Tab yine
              masthead'e doner — yani baglanti gorsel olarak calisir, klavye icin
              calismaz. */}
          <main id="main-content" tabIndex={-1} className="flex-1 min-w-0 overflow-y-auto">
            <div className="px-4 py-5 lg:px-6 lg:py-6">
              {/* Bir sayfa render sırasında patlarsa masthead ve menü ayakta kalsın,
                  kullanıcı BEYAZ EKRAN yerine hata mesajı görsün (bkz. PageErrorBoundary).
                  `key` olarak yol verilir: başka bir sayfaya geçince sınır sıfırlanır,
                  aksi halde hata kartı yeni sayfada da takılı kalırdı. */}
              <PageErrorBoundary key={location.pathname}>
                {/* SUSPENSE SINIRI BURADA (2026-08-28). Eskiden App.tsx'te TUM
                    <Routes>'u sariyordu: lazy bir sayfaya hard reload yapildiginda
                    masthead ve menu de dahil HICBIR SEY cizilmiyor, ekranda yalnizca
                    ortada bir spinner duruyordu — sonra kabuk aniden beliriyordu.
                    Sinir Outlet'in etrafina alininca kabuk AYAKTA KALIR, yalnizca
                    icerik alani yuklenir. Iskelet, PageErrorBoundary ile ayni yerde
                    olmali: ikisi de "yalnizca sayfa" kapsaminda. */}
                <Suspense fallback={<PageSkeleton />}>
                  <Outlet />
                </Suspense>
              </PageErrorBoundary>
            </div>
          </main>

          {/* "Taleplerim" paneli — eskiden yalnizca Self Service sayfasinin icindeydi,
              2026-08-20'den beri HER sayfada sag kenarda duruyor (kullanici talebi:
              "hangi sayfaya gidersek gidelim kenarda her zaman gozuksun"). Kullanici
              daraltirsa ince bir serite kuculur, tercih localStorage'da saklanir.
              <lg ekranlarda gizli: 340px'lik panel dar ekranda icerigi ezerdi. */}
          <div className="hidden lg:block flex-shrink-0 overflow-y-auto py-6 pr-4">
            <RequestsSidePanel />
          </div>
        </div>

        <SessionTimeoutModal
          isOpen={showTimeoutModal}
          countdown={countdown}
          onExtend={extendSession}
          onLogout={logout}
        />
        <ToastContainer />
        <CommandPalette />
        <JobTrackerBar />
      </div>
    </JobTrackerProvider>
    </AppDataProvider>
  );
}
