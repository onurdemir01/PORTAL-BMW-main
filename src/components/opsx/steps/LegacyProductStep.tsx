// src/components/opsx/steps/LegacyProductStep.tsx — Legacy altında uygulama sunucusu
// ürünü: JBoss mu, WAS (IBM WebSphere) mı?
//
// NEDEN AYRI ADIM: iki ürünün envanteri (MWAppsInventory / WASAppsInventory), hedef
// birimi (server-config / application server) ve sunucu uçları farklı. WAS akışı
// JBoss sihirbazının içine karıştırılsaydı JBoss'a özgü çoklu seçim ekranları WAS'a
// sızardı; WAS'ta TOPLU İŞLEM YOK (tek sunucu + tek JVM).
import React from "react";
import { ServerStackIcon, CpuChipIcon } from "@heroicons/react/24/outline";

export type LegacyProduct = "jboss" | "was";

const LegacyProductStep: React.FC<{ onSelect: (p: LegacyProduct) => void; busy?: boolean }> = ({ onSelect, busy }) => (
  <div className="py-6">
    <p className="text-sm text-[var(--text-secondary)] text-center mb-6">
      Uygulamanız hangi uygulama sunucusunda çalışıyor?
    </p>
    <div className="grid grid-cols-2 gap-4">
      <button
        onClick={() => onSelect("jboss")}
        disabled={busy}
        className="flex flex-col items-center gap-3 p-6 border border-[var(--border)] rounded-2xl hover:border-[var(--accent)] hover:shadow-md transition-all active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none"
      >
        <ServerStackIcon className="w-8 h-8 text-[var(--text-primary)]" />
        <span className="text-sm font-semibold text-[var(--text-primary)]">JBoss</span>
        <span className="text-xs text-[var(--text-muted)] text-center">
          JBoss 7 / 8 uygulamaları — restart, stop, start, thread/heap dump
        </span>
      </button>
      <button
        onClick={() => onSelect("was")}
        disabled={busy}
        className="flex flex-col items-center gap-3 p-6 border border-[var(--border)] rounded-2xl hover:border-[var(--accent)] hover:shadow-md transition-all active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none"
      >
        <CpuChipIcon className="w-8 h-8 text-[var(--text-primary)]" />
        <span className="text-sm font-semibold text-[var(--text-primary)]">WAS</span>
        <span className="text-xs text-[var(--text-muted)] text-center">
          IBM WebSphere — tek sunucuda tek JVM için restart, stop, start
        </span>
      </button>
    </div>
  </div>
);

export default LegacyProductStep;
