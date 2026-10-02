// src/components/opsx/steps/WasConfirmStep.tsx — WAS işleminin açık onayı.
//
// ÜÇ KOŞUL, ÜÇÜ DE SUNUCUDA DA ARANIR (server/opsx/was.cjs POST /api/opsx/was/run):
//   1) "Sonuçları kabul ediyorum" kutusu          → confirmed === true
//   2) JVM adı ELLE yazılır (yapıştırma kapalı)   → confirmText === JVM adı (birebir)
//   3) Uyarı varsa (ASKIDA, son çalışan örnek)    → ackWarnings === true
// Playbook da aynı adı (`confirm_text == was_server`) ve onayı (`consent`) assert eder.
//
// Ortam rozeti her ortamda gösterilir; Production için ek kapı YOK (K4-a) ama
// onay ekranı Production'ı ayrıca belirgin yazar.
import React, { useState } from "react";
import { ExclamationTriangleIcon, ShieldExclamationIcon } from "@heroicons/react/24/outline";
import type { WasTarget, WasOperation } from "@/api/opsxApi";
import { WasEnvBadge, WasStateBadge } from "./WasBadges";
import { WAS_OP_LABELS, WAS_OP_NOUNS, wasClusterLabel } from "./wasLabels";

const WasConfirmStep: React.FC<{
  app: string;
  target: WasTarget;
  operation: WasOperation;
  env: string;
  busy?: boolean;
  onConfirm: (v: { confirmed: boolean; confirmText: string; ackWarnings: boolean }) => void;
}> = ({ app, target, operation, env, busy, onConfirm }) => {
  const [typed, setTyped] = useState("");
  const [consent, setConsent] = useState(false);
  const [ack, setAck] = useState(false);
  const warnings = target.warnings[operation] || [];
  const nameOk = typed === target.server;
  const canSubmit = !busy && nameOk && consent && (warnings.length === 0 || ack);

  return (
    <div className="space-y-4">
      {env === "Production" && (
        <div className="flex items-start gap-2 bg-red-50 border border-red-100 rounded-xl p-3 text-sm text-red-700">
          <ShieldExclamationIcon className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <span>
            <strong>PRODUCTION</strong> ortamındaki bir JVM üzerinde işlem yapmak üzeresiniz.
          </span>
        </div>
      )}

      <div className="bg-[var(--bg-elevated)] rounded-xl p-4 space-y-2 text-sm">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[var(--text-muted)]">İşlem</span>
          <span className="font-semibold text-[var(--text-primary)]">
            {WAS_OP_NOUNS[operation]} ({WAS_OP_LABELS[operation]})
          </span>
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="text-[var(--text-muted)]">Sunucu</span>
          <span className="flex items-center gap-2">
            <span className="font-mono text-[var(--text-primary)]">{target.host}</span>
            <WasEnvBadge env={env} />
          </span>
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="text-[var(--text-muted)]">JVM (application server)</span>
          <span className="font-mono text-[var(--text-primary)]">{target.server}</span>
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="text-[var(--text-muted)]">Profil / hücre / node</span>
          <span className="font-mono text-xs text-[var(--text-secondary)]">
            {target.profile} / {target.cell} / {target.node}
          </span>
        </div>
        {target.cluster && (
          <div className="flex items-center justify-between gap-2">
            <span className="text-[var(--text-muted)]">Küme</span>
            <span className="font-mono text-xs text-[var(--text-secondary)]">
              {wasClusterLabel(target.cluster)} · diğer örnekler {target.peers.running}/{target.peers.total} çalışıyor
            </span>
          </div>
        )}
        <div className="flex items-center justify-between gap-2">
          <span className="text-[var(--text-muted)]">Keşifteki durum</span>
          <WasStateBadge state={target.state} />
        </div>
        <p className="pt-1 text-[11px] text-[var(--text-muted)]">
          Uygulama {app} · yalnız bu tek JVM etkilenir; küme komutları (stopCluster/startCluster) kullanılmaz.
          İşlem anında durum yeniden ölçülür; işlemle uyuşmuyorsa komut çalıştırılmaz (Atlandı).
        </p>
      </div>

      {warnings.length > 0 && (
        <div className="bg-amber-50 border border-amber-100 rounded-xl p-3 text-xs text-amber-800 space-y-2">
          {warnings.map((w) => (
            <div key={w.code} className="flex items-start gap-2">
              <ExclamationTriangleIcon className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
              <span>{w.message}</span>
            </div>
          ))}
          <label className="flex items-center gap-2 pt-1 cursor-pointer">
            <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} disabled={busy} className="rounded" />
            <span className="font-medium">Uyarıları okudum, riski kabul ediyorum.</span>
          </label>
        </div>
      )}

      <label className="flex items-center gap-2 text-sm cursor-pointer">
        <input
          type="checkbox"
          checked={consent}
          onChange={(e) => setConsent(e.target.checked)}
          disabled={busy}
          className="rounded"
        />
        <span className="text-[var(--text-primary)]">Yaptığım işlemin sonuçlarını kabul ediyorum.</span>
      </label>

      <div className="space-y-1.5">
        <label htmlFor="was-confirm-name" className="text-xs text-[var(--text-secondary)]">
          Onaylamak için JVM adını yazın: <span className="font-mono font-semibold text-[var(--text-primary)]">{target.server}</span>
        </label>
        <input
          id="was-confirm-name"
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          onPaste={(e) => e.preventDefault()}
          onDrop={(e) => e.preventDefault()}
          autoComplete="off"
          spellCheck={false}
          disabled={busy}
          placeholder={target.server}
          className={`w-full px-3 py-2.5 text-sm font-mono border rounded-xl outline-none transition ${
            typed && !nameOk ? "border-red-100 focus:border-red-100" : "border-[var(--border)] focus:border-[var(--accent)]"
          }`}
        />
        <p className="text-[11px] text-[var(--text-muted)]">
          Yapıştırma kapalı; ad büyük/küçük harf dahil birebir aynı olmalı.
        </p>
      </div>

      <div className="flex items-center justify-end">
        <button
          onClick={() => onConfirm({ confirmed: consent, confirmText: typed, ackWarnings: warnings.length > 0 && ack })}
          disabled={!canSubmit}
          className="btn-primary"
        >
          {busy ? "Başlatılıyor…" : `${WAS_OP_LABELS[operation]}: ${target.server} @ ${target.host}`}
        </button>
      </div>
    </div>
  );
};

export default WasConfirmStep;
