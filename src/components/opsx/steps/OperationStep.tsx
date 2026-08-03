// src/components/opsx/steps/OperationStep.tsx — hangi işlem yapılacak.
//
// Seçenekler SUNUCUDAN gelir (/api/opsx/operations) — ön yüz listeyi hardcode etmez,
// böylece izin verilen işlem kümesi tek yerde (server/opsx/index.cjs ALLOWED_OPERATIONS)
// tanımlı kalır. Sunucu her durumda gelen değeri o beyaz listeye karşı yeniden doğrular.
//
// DURUM KONTROLÜ: uygulamanın RUNNING/STOPPED durumu bir Ansible playbook'u tetiklenerek
// DEĞİL, doğrudan envanterden (MWAppsInventory.status, opsxApi.getHosts) okunur — bu
// yüzden anlık ve ucuzdur. Buna göre bazı işlemler ANLAMSIZ/TEHLİKELİ olabileceği için
// devre dışı bırakılır:
//   - Herhangi bir sunucu STOPPED ise: restart/stop/thread dump/heap dump seçilemez
//     (durmuş bir JVM'de dump alınamaz, zaten durmuşu tekrar durduramazsınız).
//   - Herhangi bir sunucu RUNNING ise: "başlat" seçilemez.
// Durum bilgisi eksik/beklenmedik bir değerse (envanterde status boşsa) fail-open
// DAVRANILMAZ — hangi işlemin güvenli olduğunu bilmeden hiçbir işlem seçilemez.
import React, { useEffect, useMemo, useState } from "react";
import { ArrowPathIcon, StopCircleIcon, PlayCircleIcon, DocumentMagnifyingGlassIcon, CircleStackIcon, ExclamationTriangleIcon } from "@heroicons/react/24/outline";
import { opsxApi, type OpsxOperation, type OpsxOperationDef } from "@/api/opsxApi";

const ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  restart: ArrowPathIcon,
  stop: StopCircleIcon,
  start: PlayCircleIcon,
  threaddump: DocumentMagnifyingGlassIcon,
  heapdump: CircleStackIcon,
};

// Bu işlemler, ilgili sunucu(lar) o durumdayken anlamsız/uygulanamaz.
const DISABLED_WHEN_STOPPED = new Set<OpsxOperation>(["restart", "stop", "threaddump", "heapdump"]);
const DISABLED_WHEN_RUNNING = new Set<OpsxOperation>(["start"]);

const STATUS_META: Record<string, { label: string; className: string }> = {
  running: { label: "ÇALIŞIYOR", className: "bg-emerald-50 text-emerald-700 border-emerald-100" },
  stopped: { label: "DURMUŞ", className: "bg-red-50 text-red-700 border-red-100" },
};

const OperationStep: React.FC<{
  summary: React.ReactNode;
  application: string;
  hosts: string[];
  busy?: boolean;
  onSelect: (op: OpsxOperation) => void;
}> = ({ summary, application, hosts, busy, onSelect }) => {
  const [ops, setOps] = useState<OpsxOperationDef[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [statuses, setStatuses] = useState<Record<string, string>>({});
  const [statusLoading, setStatusLoading] = useState(true);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [checkNonce, setCheckNonce] = useState(0);

  useEffect(() => {
    opsxApi.getOperations()
      .then((r) => setOps(r.operations))
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    setStatusLoading(true);
    setStatusError(null);
    opsxApi.getHosts(application)
      .then((r) => {
        if (!r.ok) { setStatusError("Sunucu durumu alınamadı."); return; }
        const map: Record<string, string> = {};
        for (const h of r.hosts) map[h.host] = h.status;
        setStatuses(map);
      })
      .catch((err) => setStatusError(err instanceof Error ? err.message : String(err)))
      .finally(() => setStatusLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [application, checkNonce]);

  const anyRunning = useMemo(() => hosts.some((h) => statuses[h] === "running"), [hosts, statuses]);
  const anyStopped = useMemo(() => hosts.some((h) => statuses[h] === "stopped"), [hosts, statuses]);
  // Bir host icin envanterde status bos/beklenmedik bir degerse "running" da "stopped"
  // da DEGILDIR — guvenli varsayilan bilinmiyordur, "serbest birak" degil: TUM islemler
  // kilitli kalir.
  const anyUnknown = useMemo(() => hosts.some((h) => statuses[h] !== "running" && statuses[h] !== "stopped"), [hosts, statuses]);

  function disabledReason(op: OpsxOperation): string | null {
    if (statusLoading) return "Sunucu durumu kontrol ediliyor…";
    if (statusError) return "Durum kontrolü başarısız — işlem seçilemez.";
    if (anyUnknown) return "Seçili sunucu(lar)dan en az birinin durumu belirlenemedi.";
    if (DISABLED_WHEN_STOPPED.has(op) && anyStopped) return "Seçili sunucu(lar)dan en az biri durmuş durumda.";
    if (DISABLED_WHEN_RUNNING.has(op) && anyRunning) return "Seçili sunucu(lar)dan en az biri zaten çalışıyor.";
    return null;
  }

  if (loading) return <div className="py-8 text-center text-sm text-[var(--text-muted)]">Yükleniyor...</div>;
  if (error) return <div className="bg-red-50 border border-red-100 rounded-xl p-4 text-sm text-red-700">{error}</div>;

  return (
    <div className="space-y-4">
      <div>
        <p className="text-sm text-[var(--text-secondary)]">Hangi işlemi yapmak istiyorsunuz?</p>
        <div className="mt-1 text-xs text-[var(--text-muted)]">{summary}</div>
      </div>

      {/* Sunucu bazında envanterdeki durum — kullanıcı hangi işlemin neden kilitli olduğunu görsün. */}
      <div className="space-y-1.5">
        {hosts.map((h) => {
          const s = statuses[h];
          const meta = STATUS_META[s];
          return (
            <div key={h} className="flex items-center justify-between gap-2 px-3 py-1.5 border border-[var(--border)] rounded-lg">
              <span className="text-sm font-mono text-[var(--text-primary)]">{h}</span>
              {statusLoading ? (
                <span className="text-xs text-[var(--text-muted)]">kontrol ediliyor…</span>
              ) : meta ? (
                <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${meta.className}`}>{meta.label}</span>
              ) : (
                <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full border bg-gray-50 text-gray-500 border-gray-200">BİLİNMİYOR</span>
              )}
            </div>
          );
        })}
      </div>

      {statusError && (
        <div className="flex items-start gap-2 bg-red-50 border border-red-100 rounded-xl p-3 text-sm text-red-700">
          <ExclamationTriangleIcon className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <p>{statusError}</p>
            <button
              onClick={() => setCheckNonce((n) => n + 1)}
              className="mt-1.5 text-xs font-semibold text-red-700 underline hover:no-underline"
            >
              Tekrar dene
            </button>
          </div>
        </div>
      )}

      <div className="space-y-2">
        {ops.map((op) => {
          const Icon = ICONS[op.key] || ArrowPathIcon;
          const reason = disabledReason(op.key);
          const disabled = busy || !!reason;
          return (
            <button
              key={op.key}
              onClick={() => onSelect(op.key)}
              disabled={disabled}
              title={reason || undefined}
              className="w-full flex items-center gap-3 px-4 py-3 border border-[var(--border)] rounded-xl text-left hover:border-[var(--accent)] hover:shadow-sm transition-all active:scale-[0.99] disabled:opacity-50 disabled:pointer-events-none disabled:hover:border-[var(--border)]"
            >
              <Icon className="w-5 h-5 text-[var(--text-primary)] flex-shrink-0" />
              <div className="flex-1">
                <span className="text-sm font-medium text-[var(--text-primary)]">{op.label}</span>
                {reason && <p className="text-xs text-[var(--text-muted)] mt-0.5">{reason}</p>}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
};

export default OperationStep;
