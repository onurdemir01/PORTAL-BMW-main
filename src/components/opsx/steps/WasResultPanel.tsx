// src/components/opsx/steps/WasResultPanel.tsx — WAS işleminin canlı çıktısı ve sonucu.
//
// DÖRT SONUÇ, DÖRT AYRI GÖRÜNÜM (playbook'un set_stats `opsx_was_op_result.result`):
//   OK          yeşil  — işlem yapıldı, son durum ölçüldü
//   SKIP        gri    — işlem anındaki durum işlemle uyuşmadı, komut ÇALIŞTIRILMADI
//   FAIL        kırmızı— işlem başarısız (ör. süre doldu, JVM geri geldi)
//   OLCULEMEDI  sarı   — GERÇEK DURUM BİLİNMİYOR. Bu "durdu" ya da "başarılı" DEĞİLDİR;
//                        envantere yazılmaz, yeni bir keşifle doğrulanmalıdır.
// Sonuç hiç gelmezse (artifact yok) sunucu OLCULEMEDI döner — sessizce "OK" gösterilmez.
import React from "react";
import {
  CheckCircleIcon,
  XCircleIcon,
  ExclamationTriangleIcon,
  MinusCircleIcon,
  ArrowPathIcon,
} from "@heroicons/react/24/outline";
import AnsibleLogTerminal from "@/components/common/AnsibleLogTerminal";
import type { WasOperation, WasRunStatus, WasTarget } from "@/api/opsxApi";
import { WasEnvBadge, WasStateBadge } from "./WasBadges";
import { WAS_OP_NOUNS, wasResultInfo, wasStepInfo } from "./wasLabels";

const TERMINAL = new Set(["successful", "failed", "error", "canceled"]);

const WasResultPanel: React.FC<{
  target: WasTarget;
  operation: WasOperation;
  env: string;
  jobId: number;
  awxStatus: string;
  output: string;
  run?: WasRunStatus;
  pollErr?: string;
  title: string;
  onNew: () => void;
  // Başlatma yanıtının uyarısı (ör. iş başladı ama Portal kaydı yazılamadı).
  launchWarning?: string;
}> = ({ target, operation, env, jobId, awxStatus, output, run, pollErr, title, onNew, launchWarning }) => {
  const terminal = TERMINAL.has(awxStatus) && !!run?.result;
  const res = run?.result;
  const sev = run?.severity;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-medium text-[var(--text-primary)] truncate">
            {WAS_OP_NOUNS[operation]}: <span className="font-mono">{target.server}</span> @{" "}
            <span className="font-mono">{target.host}</span>
          </p>
          <p className="mt-0.5 text-xs text-[var(--text-muted)]">AWX Job #{jobId}</p>
        </div>
        <WasEnvBadge env={env} />
      </div>

      {launchWarning && (
        <div className="flex items-start gap-2 rounded-xl border border-yellow-200 bg-yellow-50 px-3 py-2 text-xs text-yellow-800">
          <ExclamationTriangleIcon className="w-4 h-4 flex-shrink-0" />
          <span>{launchWarning}</span>
        </div>
      )}

      {!terminal && (
        <div className="flex items-center gap-2 text-sm text-[var(--text-muted)]">
          <ArrowPathIcon className="w-4 h-4 animate-spin" />
          <span>
            İşlem sürüyor… (durdurma en çok ~6 dk, başlatma en çok ~10 dk sürebilir; sayfadan ayrılsanız da iş takip edilir)
          </span>
        </div>
      )}

      {terminal && res && (
        <div
          className={`rounded-xl border p-4 space-y-2 ${
            sev === "ok"
              ? "bg-green-50 border-green-100 text-green-700"
              : sev === "fail"
                ? "bg-red-50 border-red-100 text-red-700"
                : sev === "skip"
                  ? "bg-gray-50 border-gray-200 text-gray-500"
                  : "bg-yellow-50 border-yellow-200 text-yellow-800"
          }`}
        >
          <div className="flex items-center gap-2 text-sm font-semibold">
            {sev === "ok" ? (
              <CheckCircleIcon className="w-5 h-5" />
            ) : sev === "fail" ? (
              <XCircleIcon className="w-5 h-5" />
            ) : sev === "skip" ? (
              <MinusCircleIcon className="w-5 h-5" />
            ) : (
              <ExclamationTriangleIcon className="w-5 h-5" />
            )}
            <span>
              {sev === "unknown"
                ? "Ölçülemedi — gerçek durum bilinmiyor"
                : sev === "skip"
                  ? "Atlandı — komut çalıştırılmadı"
                  : wasResultInfo(res.result).label}
            </span>
          </div>
          {sev === "unknown" && (
            <p className="text-xs">
              JVM çalışıyor da olabilir, durmuş da. Bu sonuç "durdu" ya da "başarılı" anlamına gelmez ve envantere
              yazılmadı. Durumu yeni bir keşifle doğrulayın.
            </p>
          )}
          {sev === "skip" && (
            <p className="text-xs">İşlem anında ölçülen durum bu işlemle uyuşmadı (ör. zaten durmuş); hiçbir şey değiştirilmedi.</p>
          )}
          <div className="flex items-center gap-2 text-xs">
            <span>Önce:</span>
            {res.before ? <WasStateBadge state={res.before} /> : <span>—</span>}
            <span>→ Sonra:</span>
            {res.after ? <WasStateBadge state={res.after} /> : <span>—</span>}
          </div>
          {run?.message && <p className="text-xs">{run.message}</p>}
        </div>
      )}

      {terminal && res && res.steps.length > 0 && (
        <div className="border border-[var(--border)] rounded-xl divide-y divide-[var(--border)]">
          {res.steps.map((s, i) => {
            const info = wasStepInfo(s);
            return (
              <div key={`${s.step}-${i}`} className="flex items-start gap-2 px-3 py-2 text-xs">
                <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border flex-shrink-0 ${info.cls}`}>
                  {info.label}
                </span>
                <span className="font-mono text-[var(--text-primary)] flex-shrink-0">{s.step}</span>
                <span className="text-[var(--text-secondary)] break-words min-w-0">{s.msg}</span>
              </div>
            );
          })}
        </div>
      )}

      {terminal && res?.line && (
        <pre className="text-[11px] font-mono whitespace-pre-wrap break-all bg-[var(--bg-elevated)] rounded-xl p-3">
          {res.line}
        </pre>
      )}

      <div className="text-left">
        <AnsibleLogTerminal output={output} status={awxStatus || "pending"} title={title} />
        {pollErr && <p className="mt-1.5 text-xs text-amber-600">{pollErr}</p>}
      </div>

      <div className="flex justify-center">
        <button onClick={onNew} className="btn-primary">
          <ArrowPathIcon className="w-4 h-4" />
          Yeni İşlem
        </button>
      </div>
    </div>
  );
};

export default WasResultPanel;
