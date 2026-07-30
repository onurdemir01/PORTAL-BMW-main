// src/components/logx_v2/shared/DownloadStep.tsx — İndirme hazır olduğunda gösterilen
// son adım. Platform-agnostik (hem Legacy hem OCP aynı bileşeni kullanır).
//
// İndirme artık düz `<a href>` navigasyonu DEĞİL: fetch ile (credentials dahil) blob olarak
// çekilir. Böylece hata durumunda tarayıcıda ham JSON sayfası açılmaz — kullanıcıya NET bir
// hata mesajı gösterilir (ör. "arşiv portalda bulunamadı / staging mount"). Başarıda dosya
// bir object URL ile indirilir.
import React, { useState } from "react";
import { ArrowDownTrayIcon, CheckCircleIcon, ExclamationTriangleIcon } from "@heroicons/react/24/outline";
import { logxV2Api, type DownloadInfo } from "@/api/logxV2Api";

const DownloadStep: React.FC<{ download: DownloadInfo; onRestart: () => void }> = ({ download, onRestart }) => {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDownload() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(logxV2Api.downloadUrl(download.token), { credentials: "include" });
      if (!res.ok) {
        // Backend JSON hata döner (401/403/404/410) — mesajı göster.
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { message?: string }).message || `İndirme başarısız (HTTP ${res.status}).`);
      }
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = download.filename || "logs.zip";
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-center justify-center py-10 gap-4 text-center">
      <CheckCircleIcon className="w-12 h-12 text-emerald-500" />
      <div>
        <p className="text-sm font-semibold text-[var(--text-primary)]">Log dosyanız hazır</p>
        <p className="text-xs text-[var(--text-muted)] mt-1">{download.filename}</p>
      </div>

      {error && (
        <div className="flex items-start gap-2 bg-red-50 border border-red-100 rounded-xl p-3 text-sm text-red-700 max-w-md text-left">
          <ExclamationTriangleIcon className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      <button onClick={handleDownload} disabled={busy} className="btn-primary active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none">
        <ArrowDownTrayIcon className="w-4 h-4" />
        {busy ? "İndiriliyor…" : error ? "Tekrar Dene" : "İndir (.zip)"}
      </button>

      <p className="text-xs text-[var(--text-muted)]">Bu bağlantı {new Date(download.expiresAt).toLocaleTimeString("tr-TR")} itibarıyla sona erecek.</p>
      <button onClick={onRestart} className="text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] underline mt-2">
        Yeni bir istek başlat
      </button>
    </div>
  );
};

export default DownloadStep;
