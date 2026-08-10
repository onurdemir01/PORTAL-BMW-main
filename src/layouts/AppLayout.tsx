// src/layouts/AppLayout.tsx — PatternFly Page iskeleti (OpenShift Console yerlesimi):
//
//   ┌──────────────── Masthead (siyah, sabit) ────────────────┐
//   ├─ PageNav (koyu, dikey) ─┬─ main (acik gri icerik alani) ─┤
//   └─────────────────────────┴───────────────────────────────┘
//
// Nav, >=lg ekranlarda sabit acik; kucuk ekranlarda masthead'deki toggle ile
// acilan bir overlay (PF "drawer" davranisi).
import React, { useContext, useEffect, useState } from "react";
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

          <main className="flex-1 min-w-0 overflow-y-auto">
            <div className="px-4 py-5 lg:px-6 lg:py-6">
              {/* Bir sayfa render sırasında patlarsa masthead ve menü ayakta kalsın,
                  kullanıcı BEYAZ EKRAN yerine hata mesajı görsün (bkz. PageErrorBoundary).
                  `key` olarak yol verilir: başka bir sayfaya geçince sınır sıfırlanır,
                  aksi halde hata kartı yeni sayfada da takılı kalırdı. */}
              <PageErrorBoundary key={location.pathname}>
                <Outlet />
              </PageErrorBoundary>
            </div>
          </main>
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
