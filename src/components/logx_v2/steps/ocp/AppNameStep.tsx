// src/components/logx_v2/steps/ocp/AppNameStep.tsx — `oc get pods | grep -i <app>`
// semantiğine karşılık gelen serbest metin girişi. Eşleşen TÜM pod'ların logları backend
// tarafından otomatik toplanır (kullanıcı kararı — ayrı bir pod-seçim adımı yok).
import React, { useState } from "react";

const AppNameStep: React.FC<{ onSubmit: (appName: string) => void; busy?: boolean }> = ({ onSubmit, busy }) => {
  const [appName, setAppName] = useState("");

  return (
    <div className="space-y-3">
      <p className="text-sm text-[var(--text-secondary)]">Uygulama adını girin — eşleşen TÜM pod'ların logları toplanacaktır.</p>
      <input
        autoFocus
        value={appName}
        onChange={(e) => setAppName(e.target.value)}
        placeholder="örn. virtual-assistant-card-bs"
        className="w-full px-3 py-2.5 text-sm border border-[var(--border)] rounded-xl outline-none focus:border-[var(--accent)] focus:ring-1 focus:ring-[var(--accent)] transition font-mono"
      />
      <button
        onClick={() => onSubmit(appName.trim())}
        disabled={!appName.trim() || busy}
        className="btn-primary w-full"
      >
        {busy ? "Başlatılıyor…" : "Logları Getir"}
      </button>
    </div>
  );
};

export default AppNameStep;
