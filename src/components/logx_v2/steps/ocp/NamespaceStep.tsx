// src/components/logx_v2/steps/ocp/NamespaceStep.tsx — İki aşamalı namespace çözümlemesi
// (kullanıcı kararı): önce "namespace'inizi biliyor musunuz?" sorulur. Biliyorsa serbest
// metin (uyarı metniyle), bilmiyorsa ayrı bir discovery job'ı tetiklenir (üst bileşen
// tarafından — bkz. LogXWizardPage'in onDiscoverNamespaces prop'u).
import React, { useState } from "react";
import { ExclamationTriangleIcon } from "@heroicons/react/24/outline";

interface Props {
  onKnown: (namespace: string) => void;
  onTriggerDiscovery: () => void;
  busy?: boolean;
}

const NamespaceStep: React.FC<Props> = ({ onKnown, onTriggerDiscovery, busy }) => {
  const [mode, setMode] = useState<"ask" | "manual">("ask");
  const [namespace, setNamespace] = useState("");

  if (mode === "ask") {
    return (
      <div className="py-4 space-y-4">
        <p className="text-sm text-[var(--text-secondary)] text-center">Uygulamanızın namespace'ini (proje adını) biliyor musunuz?</p>
        <div className="grid grid-cols-2 gap-3">
          <button
            onClick={() => setMode("manual")}
            disabled={busy}
            className="p-4 border border-[var(--border)] rounded-xl hover:border-[var(--accent)] transition-colors text-sm font-medium text-[var(--text-primary)] active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none"
          >
            Evet, biliyorum
          </button>
          <button
            onClick={onTriggerDiscovery}
            disabled={busy}
            className="p-4 border border-[var(--border)] rounded-xl hover:border-[var(--accent)] transition-colors text-sm font-medium text-[var(--text-primary)] active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none"
          >
            {busy ? "Başlatılıyor…" : "Hayır, listele"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-start gap-2 bg-amber-50 border border-amber-100 rounded-xl p-3 text-xs text-amber-800">
        <ExclamationTriangleIcon className="w-4 h-4 flex-shrink-0 mt-0.5" />
        <span>prod/dev/test/qa genellikle AYRI namespace isimlerindedir — doğru ortamı yazdığınızdan emin olun.</span>
      </div>
      <input
        autoFocus
        value={namespace}
        onChange={(e) => setNamespace(e.target.value)}
        placeholder="örn. virtual-assistant-mgmt-test"
        className="w-full px-3 py-2.5 text-sm border border-[var(--border)] rounded-xl outline-none focus:border-[var(--accent)] focus:ring-1 focus:ring-[var(--accent)] transition font-mono"
      />
      <div className="flex gap-2">
        <button onClick={() => setMode("ask")} className="text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)]">← Geri</button>
        <button
          onClick={() => onKnown(namespace.trim())}
          disabled={!namespace.trim()}
          className="btn-primary flex-1"
        >
          Devam Et
        </button>
      </div>
    </div>
  );
};

export default NamespaceStep;
