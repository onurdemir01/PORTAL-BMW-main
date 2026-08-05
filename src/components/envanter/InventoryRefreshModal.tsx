// src/components/envanter/InventoryRefreshModal.tsx — "Envanteri Yenile" pop-up'ı.
//
// Envanter sayfasında "Ürün Envanteri" (Inventory) tablosu seçiliyken, sunuculara
// bağlanıp runtime'daki gerçek versiyonları çekerek envanteri güncelleyen bir AWX
// job'ı (sabit hedef: template #612 / Maestro2 — bkz. server/inventory/index.cjs)
// tetikler. "Tümü" diğer tüm seçeneklerle KARŞILIKLI DIŞLAYICI — seçilince diğerleri
// devre dışı kalır (sunucu tarafında da aynı kural tekrar doğrulanır).
import React, { useState } from "react";
import { createPortal } from "react-dom";
import { XMarkIcon, ArrowPathIcon } from "@heroicons/react/24/outline";
import { inventoryApi, type InventoryRefreshChoice } from "@/api/inventoryApi";
import { useJobTracker } from "@/contexts/JobTrackerContext";
import AnsibleLogTerminal from "@/components/common/AnsibleLogTerminal";

const OPTIONS: { value: InventoryRefreshChoice; label: string; description: string }[] = [
  {
    value: "all",
    label: "Tümü",
    description: "Tüm sunuculara bağlanarak güncel durum çekilerek envanter yenilenir. Eğer envantere bugün eklenmiş bir sunucu veya ürün var ise lütfen bunu çalıştırınız.",
  },
  {
    value: "nginx",
    label: "Nginx",
    description: "Envanterde gözüken mevcut Nginx sunucularına bağlanılır ve runtime'da bulunan versiyonlar çekilerek sadece Nginx bulunduran sunucuların değerleri yenilenir.",
  },
  {
    value: "ihs",
    label: "IHS",
    description: "Envanterde gözüken mevcut IHS sunucularına bağlanılır ve runtime'da bulunan versiyonlar çekilerek sadece IHS bulunduran sunucuların değerleri yenilenir.",
  },
  {
    value: "rha",
    label: "RHA",
    description: "Envanterde gözüken mevcut RHA sunucularına bağlanılır ve runtime'da bulunan versiyonlar çekilerek sadece RHA bulunduran sunucuların değerleri yenilenir.",
  },
  {
    value: "jboss",
    label: "Jboss",
    description: "Envanterde gözüken mevcut Jboss sunucularına bağlanılır ve runtime'da bulunan versiyonlar çekilerek sadece Jboss bulunduran sunucuların değerleri yenilenir.",
  },
  {
    value: "was",
    label: "WAS",
    description: "Envanterde gözüken mevcut WAS sunucularına bağlanılır ve runtime'da bulunan versiyonlar çekilerek sadece WAS bulunduran sunucuların değerleri yenilenir.",
  },
  {
    value: "ctg",
    label: "CTG",
    description: "Envanterde gözüken mevcut CTG sunucularına bağlanılır ve runtime'da bulunan versiyonlar çekilerek sadece CTG bulunduran sunucuların değerleri yenilenir.",
  },
];

export default function InventoryRefreshModal({ onClose }: { onClose: () => void }) {
  const [selected, setSelected] = useState<Set<InventoryRefreshChoice>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [jobId, setJobId] = useState<number | null>(null);
  const [trackedJobId, setTrackedJobId] = useState<string | null>(null);
  const { addJob, jobs } = useJobTracker();
  // Modal açıkken CANLI çıktı burada (inline) gösterilir — bkz. OpsXWizardPage.tsx'teki
  // aynı desen. Modal kapatılırsa iş arka planda takip edilmeye devam eder (alt çubuk).
  const trackedJob = trackedJobId ? jobs.find((j) => j.id === trackedJobId) : undefined;

  const allSelected = selected.has("all");
  const canApply = selected.size > 0 && !busy && jobId == null;

  function toggle(value: InventoryRefreshChoice) {
    setSelected((prev) => {
      if (value === "all") return prev.has("all") ? new Set() : new Set(["all"]);
      const next = new Set(prev);
      next.delete("all");
      if (next.has(value)) next.delete(value); else next.add(value);
      return next;
    });
  }

  async function apply() {
    if (!canApply) return;
    setBusy(true);
    setError("");
    try {
      const r = await inventoryApi.refreshRun([...selected]);
      if (!r.ok) throw new Error(r.message || "İş başlatılamadı.");
      setJobId(r.jobId);
      if (r.jobId != null) {
        const id = addJob({
          title: "Envanteri Yenile",
          fetchStatus: () =>
            inventoryApi.refreshJobStatus(r.jobId as number).then((res) => ({ status: res.status, output: res.output })),
        });
        setTrackedJobId(id);
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[1000] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="w-full max-w-lg rounded-2xl shadow-2xl flex flex-col animate-modal-pop"
        style={{ background: "var(--bg-surface)", maxHeight: "calc(100dvh - 2rem)" }}
      >
        {/* Başlık — sağ köşede "Uygula" + kapat */}
        <div className="flex items-start justify-between gap-3 px-6 pt-5 pb-3" style={{ borderBottom: "1px solid var(--border)" }}>
          <div className="min-w-0">
            <h2 className="text-[1.0625rem] font-semibold" style={{ color: "var(--text-primary)" }}>Envanteri Yenile</h2>
            <p className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>
              Yenilemek istediğiniz değerler hangisi veya hangileri?
            </p>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            {jobId == null && (
              <button
                onClick={apply}
                disabled={!canApply}
                className="btn-primary px-4 py-1.5 text-sm flex items-center gap-1.5 disabled:opacity-40"
              >
                {busy ? <ArrowPathIcon className="w-4 h-4 animate-spin" /> : null}
                Uygula
              </button>
            )}
            <button
              onClick={onClose}
              aria-label="Kapat"
              className="p-1.5 transition-colors"
              style={{ color: "var(--text-muted)" }}
            >
              <XMarkIcon className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="px-6 py-4 overflow-y-auto space-y-3">
          {error && (
            <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-xl px-3 py-2">{error}</div>
          )}

          {jobId == null ? (
            <div className="space-y-2">
              {OPTIONS.map((opt) => {
                const checked = selected.has(opt.value);
                const disabled = allSelected && opt.value !== "all";
                return (
                  <label
                    key={opt.value}
                    className={`flex items-start gap-3 p-3 rounded-xl border transition-colors ${disabled ? "opacity-40 cursor-not-allowed" : "cursor-pointer"}`}
                    style={{ borderColor: checked ? "var(--accent)" : "var(--border)", background: checked ? "var(--accent-glow)" : "transparent" }}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={disabled}
                      onChange={() => toggle(opt.value)}
                      className="mt-0.5 rounded"
                    />
                    <span className="min-w-0">
                      <span className="block text-sm font-medium" style={{ color: "var(--text-primary)" }}>{opt.label}</span>
                      <span className="block text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>{opt.description}</span>
                    </span>
                  </label>
                );
              })}
            </div>
          ) : (
            <div className="space-y-2">
              <p className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
                İş başlatıldı — AWX Job #{jobId}
              </p>
              {trackedJob && (
                <>
                  <AnsibleLogTerminal
                    output={trackedJob.output}
                    status={trackedJob.status}
                    title="Envanteri Yenile — AWX job"
                    placeholder="AWX job başlatıldı — konsol çıktısı akmaya başlayacak…"
                  />
                  {trackedJob.pollErr && <p className="text-xs text-amber-600">{trackedJob.pollErr}</p>}
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
