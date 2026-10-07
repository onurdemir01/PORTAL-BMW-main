// src/components/logx_v2/shared/FailedStep.tsx — İşlem başarısız olduğunda gösterilen son adım.
//
// NEDEN AYRI BİR BİLEŞEN: `JobProgress` job terminal duruma geçer geçmez unmount ediliyordu,
// dolayısıyla başarısız ekranında Ansible çıktısına ERİŞİM KALMIYORDU — kullanıcı gerçek
// nedeni görmek için AWX'e gitmek zorundaydı. Burada aynı `AnsibleLogTerminal` bileşeni
// kullanılır, çıktı TEK SEFER çekilir (job zaten bitti; polling yok).
//
// Mesaj bilinçli olarak SADEDİR: son kullanıcı Ansible/AWX bilmek zorunda değil. Teknik
// ayrıntı yalnızca Admin rolüne sunucu tarafından gönderilir (bkz. server/logx/v2/index.cjs).
import React, { useState } from "react";
import {
  ExclamationTriangleIcon, ArrowPathIcon, ChevronDownIcon, ChevronUpIcon,
} from "@heroicons/react/24/outline";
import AnsibleLogTerminal from "@/components/common/AnsibleLogTerminal";
import { logxV2Api } from "@/api/logxV2Api";

type Props = {
  /** Başarısız job — çıktı bunun üzerinden çekilir. Yoksa panel gösterilmez. */
  jobId?: number;
  message: string;
  /** Yalnızca Admin yanıtında gelir; normal kullanıcıya hiç gönderilmez. */
  technicalDetail?: string;
  onRestart: () => void;
  /** Legacy: sunucu secimine don (uygulama ve elle eklenen sunucular korunur). */
  onBackToHosts?: () => void;
  /** Playbook'un yayinladigi sunucu / dosya sebepleri (varsa mesajin hemen altinda durur). */
  children?: React.ReactNode;
};

const FailedStep: React.FC<Props> = ({
  jobId,
  message,
  technicalDetail,
  onRestart,
  onBackToHosts,
  children,
}) => {
  const [showOutput, setShowOutput] = useState(false);
  const [output, setOutput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadOutput() {
    if (!jobId) return;
    setLoading(true);
    setError(null);
    try {
      const r = await logxV2Api.jobOutput(jobId);
      setOutput(r.output || "");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  function toggleOutput() {
    const next = !showOutput;
    setShowOutput(next);
    if (next && !output && !loading) loadOutput();
  }

  return (
    <div className="flex flex-col items-center gap-4 py-8 text-center">
      <ExclamationTriangleIcon className="w-10 h-10 text-red-500" />
      <p className="text-sm max-w-xl text-[var(--text-primary)]">{message}</p>

      {/* SEBEPLER DUGMELERDEN ONCE: "neden olmadi" sorusunun cevabi ham Ansible ciktisinin
          icinde aranmak zorunda kalmasin. Eskiden yalnizca genel mesaj gorunuyordu. */}
      {children && (
        <div
          className="w-full max-w-2xl rounded-xl border border-[var(--border)] p-3"
          data-testid="logx-hata-sebep-kutusu"
        >
          {children}
        </div>
      )}

      <div className="flex items-center gap-2">
        {/* Tek secenek "her seyi sil, bastan basla" degil: Legacy'de uygulama ve elle
            girilen sunucular korunarak sunucu secimine donulebilir. */}
        {onBackToHosts && (
          <button onClick={onBackToHosts} className="btn-primary">
            Sunucu seçimine dön
          </button>
        )}
        <button onClick={onRestart} className={onBackToHosts ? 'btn-secondary' : 'btn-primary'}>
          <ArrowPathIcon className="w-4 h-4" />
          Yeniden Başla
        </button>
        {jobId && (
          <button
            onClick={toggleOutput}
            className="flex items-center gap-1 text-xs px-3 py-2 rounded-lg border border-[var(--border)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
          >
            {showOutput ? <ChevronUpIcon className="w-3.5 h-3.5" /> : <ChevronDownIcon className="w-3.5 h-3.5" />}
            {showOutput ? "Ayrıntıları gizle" : "Ayrıntıları göster"}
          </button>
        )}
      </div>

      {showOutput && jobId && (
        <div className="w-full mt-1 animate-fade-in text-left">
          {technicalDetail && (
            <div className="mb-2 rounded-xl px-3 py-2 text-xs bg-amber-50 text-amber-900">
              <span className="font-semibold">Yönetici notu: </span>{technicalDetail}
            </div>
          )}
          {error ? (
            <div className="rounded-xl px-3 py-2 text-sm bg-red-50 text-red-700">
              Çıktı alınamadı: {error}{" "}
              <button onClick={loadOutput} className="underline">Tekrar dene</button>
            </div>
          ) : (
            <>
              <AnsibleLogTerminal
                output={output}
                status="failed"
                title="ansible — işlem çıktısı"
                placeholder={loading ? "Çıktı yükleniyor…" : "Bu iş için çıktı bulunamadı."}
              />
              <button
                onClick={loadOutput}
                disabled={loading}
                className="mt-2 text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] underline disabled:opacity-50"
              >
                {loading ? "Yükleniyor…" : "Çıktıyı yenile"}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
};

export default FailedStep;
