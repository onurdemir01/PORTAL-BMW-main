import React, { useEffect } from "react";
import { createPortal } from "react-dom";
import { XMarkIcon, ShieldCheckIcon } from "@heroicons/react/24/outline";
import { useAuth } from "@/contexts/AuthContext";

export interface HelpSection {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  body: React.ReactNode;
  /** true ise yalnızca Admin rolündeki kullanıcılara gösterilir. */
  adminOnly?: boolean;
}

export interface HelpModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  sections: HelpSection[];
  /** Tüm rollere gösterilen adım listesi. */
  steps?: string[];
  /** Yalnızca Admin'e gösterilen ek adımlar — User oturumunda bu prop'un
   *  içeriği component gövdesinde filtrelenip hiç render edilmez. */
  adminSteps?: string[];
}

// Genel amaçlı, rol-farkında Yardım modalı. `adminOnly` işaretli section'lar ve
// `adminSteps`, User rolünde JSX'e hiç girmez (CSS display:none DEĞİL) — bu yüzden
// devtools'tan da görünmezler. bkz. docs/ — admin yönergelerinin user'a asla
// sızmaması gerektiği kuralını burada uyguluyoruz.
export default function HelpModal({ open, onClose, title, sections, steps, adminSteps }: HelpModalProps) {
  const { user } = useAuth();
  const isAdmin = user?.role === "Admin";

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const visibleSections = sections.filter((s) => !s.adminOnly || isAdmin);
  const visibleAdminSteps = isAdmin ? adminSteps ?? [] : [];

  // Portal ile doğrudan document.body'ye render edilir — sayfa köküne uygulanan
  // .page-enter (veya ileride eklenecek başka bir kart/hover animasyonu) bir
  // transform bırakırsa, position:fixed bu ata için değil viewport için
  // hesaplanmaya devam eder (bkz. animations.css'teki springIn notu).
  //
  // Dış overlay'de overflow-y-auto + kutunun tamamı max-h-[calc(100dvh-2rem)] ile
  // sınırlı — yalnızca iç içerik değil, TÜM kutu viewport'a göre sınırlanır. Çok
  // kısa bir viewport'ta (ör. yatay mobil) içerik taşarsa tüm overlay kaydırılabilir
  // (bkz. SelfServicePage.tsx'teki SurveyModal — aynı desen, oradan taşındı).
  return createPortal(
    <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm animate-fade-in overflow-y-auto p-4">
      <div className="min-h-full flex items-center justify-center" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
        <div className="rounded-2xl shadow-2xl w-full max-w-lg flex flex-col max-h-[calc(100dvh-2rem)] my-4 overflow-hidden animate-modal-pop" style={{ background: "var(--bg-surface)" }}>
          <div className="flex items-center justify-between px-6 py-4 flex-shrink-0" style={{ borderBottom: "1px solid var(--border)" }}>
            <h2 className="section-label">{title}</h2>
            <button
              onClick={onClose}
              className="rounded-lg p-1.5 transition-colors"
              style={{ color: "var(--text-muted)" }}
            >
              <XMarkIcon className="w-5 h-5" />
            </button>
          </div>

          <div className="px-6 py-5 space-y-5 flex-1 overflow-y-auto">
          {visibleSections.map((s, i) => {
            const Icon = s.icon;
            return (
              <div className="flex gap-3" key={i}>
                <span className="flex-shrink-0 mt-0.5" style={{ color: "var(--accent)" }}>
                  <Icon className="w-6 h-6" />
                </span>
                <div>
                  <p className="text-sm font-medium mb-1" style={{ color: "var(--text-primary)" }}>{s.title}</p>
                  <div className="text-sm leading-relaxed" style={{ color: "var(--text-muted)" }}>{s.body}</div>
                </div>
              </div>
            );
          })}

          {steps && steps.length > 0 && (
            <div className="rounded-xl p-4 text-sm space-y-1" style={{ background: "var(--bg-elevated)", color: "var(--text-muted)" }}>
              <p className="font-medium mb-2" style={{ color: "var(--text-primary)" }}>Adımlar:</p>
              {steps.map((step, i) => <p key={i}>{i + 1}. {step}</p>)}
            </div>
          )}

          {visibleAdminSteps.length > 0 && (
            <div className="rounded-xl p-4 text-sm space-y-1" style={{ background: "rgb(var(--accent-rgb) / 0.08)", color: "var(--text-secondary)" }}>
              <p className="font-medium mb-2 flex items-center gap-1.5" style={{ color: "var(--accent)" }}>
                <ShieldCheckIcon className="w-4 h-4" /> Yalnızca Admin:
              </p>
              {visibleAdminSteps.map((step, i) => <p key={i}>{i + 1}. {step}</p>)}
            </div>
          )}
          </div>

          <div className="px-6 py-4 flex justify-end flex-shrink-0" style={{ borderTop: "1px solid var(--border)" }}>
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium rounded-lg transition-colors text-white"
              style={{ background: "var(--text-primary)" }}
            >
              Anladım
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
