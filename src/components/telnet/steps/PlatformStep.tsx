// src/components/telnet/steps/PlatformStep.tsx — Telnet'in ilk adımı. OpsX'in
// PlatformStep'iyle BİREBİR aynı (kullanıcı isteği); yalnızca metinler bağlama göre değişir.
import React from "react";
import { ServerStackIcon, CubeTransparentIcon } from "@heroicons/react/24/outline";
import type { TelnetPlatform } from "@/api/telnetApi";

const PlatformStep: React.FC<{ onSelect: (p: TelnetPlatform) => void; busy?: boolean }> = ({ onSelect, busy }) => (
  <div className="py-6">
    <p className="text-sm text-[var(--text-secondary)] text-center mb-6">
      Hangi tipteki uygulamanız için bağlantı testi yapmak istiyorsunuz?
    </p>
    <div className="grid grid-cols-2 gap-4">
      <button
        onClick={() => onSelect("legacy")}
        disabled={busy}
        className="flex flex-col items-center gap-3 p-6 border border-[var(--border)] rounded-2xl hover:border-[var(--accent)] hover:shadow-md transition-all active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none"
      >
        <ServerStackIcon className="w-8 h-8 text-[var(--text-primary)]" />
        <span className="text-sm font-semibold text-[var(--text-primary)]">Legacy</span>
        <span className="text-xs text-[var(--text-muted)] text-center">
          Jboss/WAS geleneksel Linux sunucu uygulamalar için
        </span>
      </button>
      <button
        onClick={() => onSelect("openshift")}
        disabled={busy}
        className="flex flex-col items-center gap-3 p-6 border border-[var(--border)] rounded-2xl hover:border-[var(--accent)] hover:shadow-md transition-all active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none"
      >
        <CubeTransparentIcon className="w-8 h-8 text-[var(--text-primary)]" />
        <span className="text-sm font-semibold text-[var(--text-primary)]">Openshift</span>
        <span className="text-xs text-[var(--text-muted)] text-center">
          ARK/Non-ARK container uygulamaları için
        </span>
      </button>
    </div>
  </div>
);

export default PlatformStep;
