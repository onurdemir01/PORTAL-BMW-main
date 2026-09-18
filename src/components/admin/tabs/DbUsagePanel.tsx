// src/components/admin/tabs/DbUsagePanel.tsx — Admin > DB Yedekleme > "Veritabanı Doluluğu":
// veri/log dosyalarının doluluğu (üst sınıra veya diske göre), log neden boşalmıyor, en
// büyük tablolar ve gece temizliğinin (logx_v2 blob/satır saklama) durumu.
// Kaynak: server/db/housekeeping.cjs — 2026-09-18'de veri dosyası %96'ya, log iki gün üst
// üste %100'e geldiği için eklendi; eşik aşılınca aynı modül Teams'e de uyarı atar.
import React, { useCallback, useEffect, useState } from "react";
import { ArrowPathIcon, PlayIcon, ExclamationTriangleIcon } from "@heroicons/react/24/outline";
import { toast } from "@/hooks/useToast";
import { fmtDateTime as fmt, fmtNumber } from "@/utils/datetime";

interface DbFile {
  name: string;
  kind: "data" | "log";
  physical_name: string;
  size_mb: number;
  used_mb: number;
  cap_mb: number | null;
  pct_of_file: number;
  growth: string;
  volume: string | null;
  volume_free_mb: number | null;
  volume_total_mb: number | null;
  alert_pct: number;
}
interface DbUsage {
  readAt: string;
  database: string | null;
  files: DbFile[];
  logReuseWait: string | null;
  recoveryModel: string | null;
  topTables: { name: string; rows: number; reserved_mb: number }[];
}
interface HkConfig {
  hour: number;
  checkIntervalMinutes: number;
  alertPercent: number;
  webhookUrl: string;
  logxBlobRetentionDays: number;
  logxRowRetentionDays: number;
  batchSize: number;
}
interface HkState {
  status: "idle" | "running" | "done" | "error";
  startedAt: string | null;
  finishedAt: string | null;
  logxBlobsCleared: number;
  logxRequestsDeleted: number;
  lastError: string | null;
  alertsSent: Record<string, string>;
}

const fmtMb = (mb: number | null | undefined) =>
  mb == null ? "—" : mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${Math.round(mb)} MB`;

const barColor = (pct: number, threshold: number) =>
  pct >= threshold ? "bg-red-500" : pct >= threshold - 15 ? "bg-amber-400" : "bg-green-500";

const DbUsagePanel: React.FC = () => {
  const [usage, setUsage] = useState<DbUsage | null>(null);
  const [config, setConfig] = useState<HkConfig | null>(null);
  const [hk, setHk] = useState<HkState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/db-usage");
      const data = await res.json();
      if (data.ok) {
        setUsage(data.usage);
        setConfig(data.config);
        setHk(data.state);
        setError(null);
      } else {
        setError(data.message || "Doluluk okunamadı.");
        if (data.state) setHk(data.state);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Temizlik calisirken 3 sn'de bir yenile
  useEffect(() => {
    if (hk?.status !== "running") return;
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, [hk?.status, load]);

  const runNow = async () => {
    setRunning(true);
    try {
      const res = await fetch("/api/admin/db-housekeeping/run", { method: "POST" });
      const data = await res.json();
      if (!data.ok) { toast.error(data.message || "Başlatılamadı."); return; }
      toast.success("Temizlik başlatıldı.");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  };

  const threshold = config?.alertPercent ?? 85;
  const critical = (usage?.files || []).filter((f) => f.alert_pct >= threshold);

  return (
    <div className="space-y-4 pt-6 border-t border-gray-200">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="section-label">Veritabanı Doluluğu</h2>
          <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>
            Veri ve log dosyalarının doluluğu; üst sınır tanımlıysa ona, yoksa diskteki boş alana göre.
            %{threshold} aşılınca Teams'e dosya başına günde bir uyarı gider
            {config && !config.webhookUrl && <span className="text-amber-700"> (webhook tanımlı değil — yalnız burada ve sunucu logunda görünür)</span>}.
          </p>
        </div>
        <button onClick={load} className="btn-secondary flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg" disabled={loading}>
          <ArrowPathIcon className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} /> Yenile
        </button>
      </div>

      {error && <div className="pf-alert pf-alert--danger p-3 text-sm" role="alert">{error}</div>}

      {critical.length > 0 && (
        <div className="pf-alert pf-alert--danger p-3 text-sm flex items-start gap-2" role="alert">
          <ExclamationTriangleIcon className="w-5 h-5 flex-shrink-0" />
          <div>
            <b>Eşik aşıldı:</b> {critical.map((f) => `${f.name} %${f.alert_pct.toFixed(1)}`).join(", ")}.{" "}
            {critical.some((f) => f.kind === "log") && (
              <>Log için <code>BACKUP LOG … TO DISK</code> (AG üyesi — yalnız log backup boşaltır). </>
            )}
            {critical.some((f) => f.kind === "data" && f.cap_mb) && (
              <>Veri dosyası üst sınırına dayandı: <code>ALTER DATABASE … MODIFY FILE (NAME=…, MAXSIZE=UNLIMITED, FILEGROWTH=512MB)</code>. </>
            )}
          </div>
        </div>
      )}

      {usage && (
        <div className="space-y-2">
          {usage.files.map((f) => (
            <div key={f.name} className="p-3 border border-gray-200 rounded-lg">
              <div className="flex items-center justify-between gap-2 text-sm flex-wrap">
                <div className="flex items-center gap-2">
                  <span className="font-semibold">{f.name}</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded border border-gray-200" style={{ color: "var(--text-muted)" }}>
                    {f.kind === "log" ? "log" : "veri"}
                  </span>
                  <span className="font-mono text-[11px]" style={{ color: "var(--text-muted)" }}>{f.physical_name}</span>
                </div>
                <div className="font-semibold tabular-nums">%{f.alert_pct.toFixed(1)}</div>
              </div>
              <div className="mt-2 h-2 rounded bg-gray-100 overflow-hidden">
                <div className={`h-full ${barColor(f.alert_pct, threshold)}`} style={{ width: `${Math.min(100, f.alert_pct)}%` }} />
              </div>
              <div className="mt-1.5 text-xs flex gap-4 flex-wrap" style={{ color: "var(--text-muted)" }}>
                <span>kullanılan {fmtMb(f.used_mb)} / dosya {fmtMb(f.size_mb)}</span>
                <span>üst sınır: {f.cap_mb ? fmtMb(f.cap_mb) : "sınırsız (disk kadar)"}</span>
                <span>büyüme: {f.growth}</span>
                {f.volume && <span>disk {f.volume} boş {fmtMb(f.volume_free_mb)} / {fmtMb(f.volume_total_mb)}</span>}
              </div>
            </div>
          ))}
          <div className="text-xs flex gap-4 flex-wrap" style={{ color: "var(--text-muted)" }}>
            <span>Kurtarma modeli: <b>{usage.recoveryModel || "?"}</b></span>
            <span>
              Log neden boşalmıyor: <b className={usage.logReuseWait && usage.logReuseWait !== "NOTHING" ? "text-amber-700" : ""}>{usage.logReuseWait || "?"}</b>
              {usage.logReuseWait === "LOG_BACKUP" && " — log backup bekliyor (AG); düzenli Agent log backup job'ı gerekir"}
            </span>
            <span>Okuma: {fmt(usage.readAt)}</span>
          </div>
        </div>
      )}

      {usage && usage.topTables.length > 0 && (
        <div className="p-3 border border-gray-200 rounded-lg">
          <div className="text-xs font-semibold mb-2" style={{ color: "var(--text-muted)" }}>En büyük 15 tablo (indeksler dahil ayrılmış alan)</div>
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left" style={{ color: "var(--text-muted)" }}>
                <th className="py-1 pr-2">Tablo</th>
                <th className="py-1 pr-2 text-right">Satır</th>
                <th className="py-1 text-right">Alan</th>
              </tr>
            </thead>
            <tbody>
              {usage.topTables.map((t) => (
                <tr key={t.name} className="border-t border-gray-100">
                  <td className="py-1 pr-2 font-mono">{t.name}</td>
                  <td className="py-1 pr-2 text-right tabular-nums">{fmtNumber(t.rows)}</td>
                  <td className="py-1 text-right tabular-nums">{fmtMb(t.reserved_mb)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="p-4 border border-gray-200 rounded-xl space-y-2">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="text-sm">
            <div className="font-semibold">Gece temizliği (LogX v2 kayıtları)</div>
            <div className="text-xs" style={{ color: "var(--text-muted)" }}>
              {config && (
                <>
                  Her gün {String(config.hour).padStart(2, "0")}:00 — {config.logxBlobRetentionDays} günden eski isteklerin JSON gövdeleri silinir,
                  {" "}{config.logxRowRetentionDays} günden eski istekler tamamen kaldırılır; {fmtNumber(config.batchSize)} satırlık partilerle (log şişmez).
                </>
              )}
            </div>
          </div>
          <button
            onClick={runNow}
            disabled={running || hk?.status === "running"}
            className="btn-primary flex items-center gap-2 px-3 py-2 text-sm rounded-lg disabled:opacity-50"
          >
            <PlayIcon className="w-4 h-4" />
            {hk?.status === "running" ? "Çalışıyor…" : "Şimdi Temizle"}
          </button>
        </div>
        {hk && (hk.status === "done" || hk.status === "error") && (
          <div className="text-xs flex gap-4 flex-wrap pt-2 border-t border-gray-100" style={{ color: "var(--text-muted)" }}>
            <span>Son çalışma: {fmt(hk.finishedAt)}</span>
            <span>JSON gövdesi temizlenen: {fmtNumber(hk.logxBlobsCleared)}</span>
            <span>Silinen istek: {fmtNumber(hk.logxRequestsDeleted)}</span>
          </div>
        )}
        {hk?.lastError && <div className="pf-alert pf-alert--danger p-2 text-xs" role="alert">{hk.lastError}</div>}
      </div>
    </div>
  );
};

export default DbUsagePanel;
