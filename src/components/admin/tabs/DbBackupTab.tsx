// src/components/admin/tabs/DbBackupTab.tsx — Admin > DB Yedekleme: TBMWANS'taki HER
// tablonun günlük olarak ayrı CSV'ye yedeklendiği server/db/full-backup.cjs'in durumu
// ve manuel "Şimdi Çalıştır" tetikleyicisi. Ayrı bir Ansible job'ı DEĞİL — Portal
// sunucusunun kendi zamanlanmış görevi (bkz. full-backup.cjs dosya başı notu).
import React, { useCallback, useEffect, useRef, useState } from "react";
import { ArchiveBoxIcon, PlayIcon, ArrowPathIcon, CheckCircleIcon, XCircleIcon, ClockIcon } from "@heroicons/react/24/outline";
import { toast } from "@/hooks/useToast";

interface BackupState {
  status: "idle" | "running" | "done" | "error";
  startedAt: string | null;
  finishedAt: string | null;
  tableCount: number;
  doneCount: number;
  currentTable: string | null;
  failedTables: string[];
  totalRows: number;
  removedFiles: number;
  lastError: string | null;
}

interface BackupConfig {
  dir: string;
  retentionDays: number;
  hour: number;
  checkIntervalMinutes: number;
}

const STATUS_META: Record<BackupState["status"], { label: string; className: string; icon: React.ElementType }> = {
  idle:    { label: "Beklemede", className: "bg-gray-100 text-gray-600 border-gray-200", icon: ClockIcon },
  running: { label: "Çalışıyor", className: "bg-blue-50 text-blue-700 border-blue-200", icon: ArrowPathIcon },
  done:    { label: "Tamamlandı", className: "bg-green-50 text-green-700 border-green-200", icon: CheckCircleIcon },
  error:   { label: "Hata", className: "bg-red-50 text-red-700 border-red-200", icon: XCircleIcon },
};

function fmt(iso: string | null) {
  if (!iso) return "—";
  try { return new Date(iso).toLocaleString("tr-TR"); } catch { return iso; }
}

const DbBackupTab: React.FC = () => {
  const [state, setState] = useState<BackupState | null>(null);
  const [config, setConfig] = useState<BackupConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/db-full-backup/status");
      const data = await res.json();
      if (data.ok) { setState(data.state); setConfig(data.config); }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Calisirken 3sn'de bir otomatik yenilenir, bitince durur.
  useEffect(() => {
    if (state?.status === "running") {
      if (!pollRef.current) pollRef.current = setInterval(load, 3000);
    } else if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    return () => { if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; } };
  }, [state?.status, load]);

  const runNow = async () => {
    setRunning(true);
    try {
      const res = await fetch("/api/admin/db-full-backup/run", { method: "POST" });
      const data = await res.json();
      if (!data.ok) { toast.error(data.message || "Başlatılamadı."); return; }
      toast.success("Yedekleme başlatıldı.");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  };

  if (loading) return <div className="text-sm" style={{ color: "var(--text-muted)" }}>Yükleniyor…</div>;

  const meta = state ? STATUS_META[state.status] : STATUS_META.idle;
  const Icon = meta.icon;

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold">Veritabanı Tam Yedekleme</h2>
        <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>
          TBMWANS'taki her tablo, her gün ayrı bir CSV dosyasına yedeklenir (tablo listesi otomatik keşfedilir,
          yeni bir tablo eklendiğinde ayrıca bir şey yapmanız gerekmez). Ansible/AWX kullanılmaz — Portal
          sunucusunun kendi zamanlanmış görevidir.
        </p>
      </div>

      {config && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
          <div className="p-3 border border-gray-200 rounded-lg">
            <div className="text-xs" style={{ color: "var(--text-muted)" }}>Hedef Klasör</div>
            <div className="font-mono text-xs mt-0.5 break-all">{config.dir}</div>
          </div>
          <div className="p-3 border border-gray-200 rounded-lg">
            <div className="text-xs" style={{ color: "var(--text-muted)" }}>Saklama Süresi</div>
            <div className="font-semibold mt-0.5">{config.retentionDays} gün</div>
          </div>
          <div className="p-3 border border-gray-200 rounded-lg">
            <div className="text-xs" style={{ color: "var(--text-muted)" }}>Günlük Çalışma Saati</div>
            <div className="font-semibold mt-0.5">{String(config.hour).padStart(2, "0")}:00</div>
          </div>
          <div className="p-3 border border-gray-200 rounded-lg">
            <div className="text-xs" style={{ color: "var(--text-muted)" }}>Kontrol Sıklığı</div>
            <div className="font-semibold mt-0.5">{config.checkIntervalMinutes} dk</div>
          </div>
        </div>
      )}

      <div className="p-4 border border-gray-200 rounded-xl space-y-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <span className={`flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-lg border ${meta.className}`}>
              <Icon className={`w-3.5 h-3.5 ${state?.status === "running" ? "animate-spin" : ""}`} />
              {meta.label}
            </span>
            {state?.status === "running" && state.currentTable && (
              <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                {state.currentTable} ({state.doneCount}/{state.tableCount})
              </span>
            )}
          </div>
          <button
            onClick={runNow}
            disabled={running || state?.status === "running"}
            className="btn-primary flex items-center gap-2 px-3 py-2 text-sm rounded-lg disabled:opacity-50"
          >
            <PlayIcon className="w-4 h-4" />
            Şimdi Çalıştır
          </button>
        </div>

        {state && (state.status === "done" || state.status === "error") && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm pt-2 border-t border-gray-100">
            <div>
              <div className="text-xs" style={{ color: "var(--text-muted)" }}>Son Çalışma</div>
              <div className="mt-0.5">{fmt(state.finishedAt)}</div>
            </div>
            <div>
              <div className="text-xs" style={{ color: "var(--text-muted)" }}>Tablo</div>
              <div className="mt-0.5">{state.tableCount}</div>
            </div>
            <div>
              <div className="text-xs" style={{ color: "var(--text-muted)" }}>Toplam Satır</div>
              <div className="mt-0.5">{state.totalRows.toLocaleString("tr-TR")}</div>
            </div>
            <div>
              <div className="text-xs" style={{ color: "var(--text-muted)" }}>Silinen Eski Dosya</div>
              <div className="mt-0.5">{state.removedFiles}</div>
            </div>
          </div>
        )}

        {state?.lastError && (
          <div className="pf-alert pf-alert--danger p-3 text-sm" role="alert">{state.lastError}</div>
        )}
      </div>

      <div className="flex items-center gap-2 text-xs" style={{ color: "var(--text-muted)" }}>
        <ArchiveBoxIcon className="w-4 h-4 flex-shrink-0" />
        Bu değerler Admin &gt; Sistem'den (env değişkenleri) ayarlanabilir.
      </div>
    </div>
  );
};

export default DbBackupTab;
