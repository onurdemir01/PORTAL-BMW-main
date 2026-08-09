// src/components/filex/steps/FileListResultStep.tsx — playbook sonucunu (dosya + izin +
// sahip + grup + boyut + tarih + sha512) salt-okunur bir tablo olarak gösterir. Hiçbir
// dosya işlemi yapılmaz — kullanıcı yalnızca BAKAR, kendi repo'sundaki sha512 ile
// karşılaştırır.
import React, { useState } from "react";
import { ClipboardDocumentIcon, CheckIcon, ExclamationTriangleIcon } from "@heroicons/react/24/outline";
import type { FilexResult, FilexFileEntry } from "@/api/filexApi";

function formatSize(bytes: number): string {
  if (!Number.isFinite(bytes)) return "-";
  const units = ["B", "KB", "MB", "GB"];
  let v = bytes, i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
}

function formatMtime(epochSeconds: number): string {
  if (!Number.isFinite(epochSeconds)) return "-";
  return new Date(epochSeconds * 1000).toLocaleString("tr-TR");
}

const CopyButton: React.FC<{ value: string }> = ({ value }) => {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => { navigator.clipboard.writeText(value).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }); }}
      title="sha512 değerini kopyala"
      className="text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
    >
      {copied ? <CheckIcon className="w-3.5 h-3.5 text-green-600" /> : <ClipboardDocumentIcon className="w-3.5 h-3.5" />}
    </button>
  );
};

const FileRow: React.FC<{ file: FilexFileEntry }> = ({ file }) => (
  <tr className="border-b border-[var(--border)] last:border-0">
    <td className="px-3 py-2 text-xs font-mono text-[var(--text-primary)] break-all">{file.path}</td>
    <td className="px-3 py-2 text-xs font-mono text-[var(--text-secondary)] whitespace-nowrap">{file.mode}</td>
    <td className="px-3 py-2 text-xs text-[var(--text-secondary)] whitespace-nowrap">{file.owner}:{file.group}</td>
    <td className="px-3 py-2 text-xs font-mono text-[var(--text-secondary)] whitespace-nowrap text-right">{formatSize(file.size)}</td>
    <td className="px-3 py-2 text-xs text-[var(--text-secondary)] whitespace-nowrap">{formatMtime(file.mtime)}</td>
    <td className="px-3 py-2 text-xs font-mono text-[var(--text-muted)]">
      <div className="flex items-center gap-1.5">
        <span className="truncate max-w-[10rem]" title={file.sha512}>{file.sha512 || "-"}</span>
        {file.sha512 && <CopyButton value={file.sha512} />}
      </div>
    </td>
  </tr>
);

const FileListResultStep: React.FC<{ result: FilexResult; onRestart: () => void }> = ({ result, onRestart }) => {
  return (
    <div className="space-y-4">
      {result.overall_status !== "success" && (
        <div className="flex items-start gap-2 bg-amber-50 border border-amber-100 rounded-xl p-3 text-xs text-amber-800">
          <ExclamationTriangleIcon className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <span>
            {result.overall_status === "failed"
              ? "Hiçbir sunucudan sonuç alınamadı."
              : "Bazı sunuculardan sonuç alınamadı — aşağıda hangileri olduğu görünür."}
          </span>
        </div>
      )}

      {result.hosts.map((h) => (
        <div key={h.host} className="border border-[var(--border)] rounded-xl overflow-hidden">
          <div className="flex items-center justify-between px-4 py-2.5 bg-[var(--bg-elevated)]">
            <span className="text-sm font-medium font-mono text-[var(--text-primary)]">{h.host}</span>
            <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${
              h.status === "ok" ? "bg-emerald-50 text-emerald-700 border-emerald-100" : "bg-red-50 text-red-700 border-red-100"
            }`}>
              {h.status === "ok" ? `${h.files.length} DOSYA` : (h.status || "HATA").toUpperCase()}
            </span>
          </div>

          {h.status !== "ok" && h.error && (
            <p className="px-4 py-2 text-xs text-red-700 bg-red-50">{h.error}</p>
          )}

          {h.ear_dirs.length > 0 && (
            <p className="px-4 py-1.5 text-[11px] text-[var(--text-muted)] font-mono">{h.ear_dirs.join(", ")}</p>
          )}

          {h.status === "ok" && (
            h.files.length === 0 ? (
              <p className="px-4 py-4 text-xs text-[var(--text-muted)] text-center">Dosya bulunamadı.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="text-left text-[10px] uppercase tracking-wide text-[var(--text-muted)] border-b border-[var(--border)]">
                      <th className="px-3 py-1.5 font-medium">Yol</th>
                      <th className="px-3 py-1.5 font-medium">İzin</th>
                      <th className="px-3 py-1.5 font-medium">Sahip:Grup</th>
                      <th className="px-3 py-1.5 font-medium text-right">Boyut</th>
                      <th className="px-3 py-1.5 font-medium">Değiştirilme</th>
                      <th className="px-3 py-1.5 font-medium">SHA512</th>
                    </tr>
                  </thead>
                  <tbody>
                    {h.files.map((f) => <FileRow key={f.path} file={f} />)}
                  </tbody>
                </table>
              </div>
            )
          )}
        </div>
      ))}

      <button onClick={onRestart} className="btn-secondary w-full">
        Yeni Sorgu
      </button>
    </div>
  );
};

export default FileListResultStep;
