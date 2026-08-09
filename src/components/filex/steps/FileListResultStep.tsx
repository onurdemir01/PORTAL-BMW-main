// src/components/filex/steps/FileListResultStep.tsx — playbook sonucunu (dosya + izin +
// sahip + grup + boyut + tarih + sha512) salt-okunur bir liste olarak gösterir. Hiçbir
// dosya işlemi yapılmaz — kullanıcı yalnızca BAKAR, kendi repo'sundaki sha512 ile
// karşılaştırır.
//
// VIRTUALIZED (bkz. @tanstack/react-virtual, AuditLogTab.tsx ile AYNI desen): kalabalık
// .ear dizinleri binlerce dosya döndürebiliyor — hepsini HAM <table> olarak DOM'a basmak
// tarayıcı sekmesini kilitleyip beyaz ekrana yol açtı (üretimde gözlemlendi). Sadece
// görünür satırlar render edilir, host başına dosya sayısından BAĞIMSIZ sabit DOM boyutu.
import React, { useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ClipboardDocumentIcon, CheckIcon, ExclamationTriangleIcon } from "@heroicons/react/24/outline";
import type { FilexResult, FilexHostResult, FilexFileEntry } from "@/api/filexApi";

const ROW_HEIGHT = 32;
const GRID_COLUMNS = "1fr 70px 130px 90px 160px 200px";

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
      className="text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors flex-shrink-0"
    >
      {copied ? <CheckIcon className="w-3.5 h-3.5 text-green-600" /> : <ClipboardDocumentIcon className="w-3.5 h-3.5" />}
    </button>
  );
};

// Bir host'un dosya listesini virtualized (yalnızca görünür satırlar DOM'da) gösterir.
// Ayrı bileşen olarak tutulur çünkü useVirtualizer bir HOOK'tur — hosts.map() döngüsü
// içinde doğrudan çağrılamaz (Rules of Hooks ihlali).
const HostFileList: React.FC<{ files: FilexFileEntry[] }> = ({ files }) => {
  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: files.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 15,
  });
  const virtualItems = virtualizer.getVirtualItems();

  return (
    <div>
      <div className="grid text-[10px] uppercase tracking-wide text-[var(--text-muted)] border-b border-[var(--border)] bg-[var(--bg-elevated)]"
        style={{ gridTemplateColumns: GRID_COLUMNS }}>
        <div className="px-3 py-1.5 font-medium">Yol</div>
        <div className="px-3 py-1.5 font-medium">İzin</div>
        <div className="px-3 py-1.5 font-medium">Sahip:Grup</div>
        <div className="px-3 py-1.5 font-medium text-right">Boyut</div>
        <div className="px-3 py-1.5 font-medium">Değiştirilme</div>
        <div className="px-3 py-1.5 font-medium">SHA512</div>
      </div>
      <div ref={parentRef} className="overflow-auto" style={{ height: Math.min(files.length * ROW_HEIGHT, 640) }}>
        <div style={{ height: virtualizer.getTotalSize(), width: "100%", position: "relative" }}>
          {virtualItems.map((vRow) => {
            const f = files[vRow.index];
            return (
              <div
                key={vRow.key}
                className="grid items-center hover:bg-[var(--bg-elevated)] transition-colors border-b border-[var(--border)] absolute top-0 left-0 w-full"
                style={{ gridTemplateColumns: GRID_COLUMNS, height: ROW_HEIGHT, transform: `translateY(${vRow.start}px)` }}
              >
                <div className="px-3 text-xs font-mono text-[var(--text-primary)] truncate" title={f.path}>{f.path}</div>
                <div className="px-3 text-xs font-mono text-[var(--text-secondary)] whitespace-nowrap">{f.mode}</div>
                <div className="px-3 text-xs text-[var(--text-secondary)] truncate">{f.owner}:{f.group}</div>
                <div className="px-3 text-xs font-mono text-[var(--text-secondary)] whitespace-nowrap text-right">{formatSize(f.size)}</div>
                <div className="px-3 text-xs text-[var(--text-secondary)] whitespace-nowrap">{formatMtime(f.mtime)}</div>
                <div className="px-3 flex items-center gap-1.5 min-w-0">
                  <span className="truncate font-mono text-xs text-[var(--text-muted)]" title={f.sha512}>{f.sha512 || "-"}</span>
                  {f.sha512 && <CopyButton value={f.sha512} />}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

const HostBlock: React.FC<{ h: FilexHostResult }> = ({ h }) => (
  <div className="border border-[var(--border)] rounded-xl overflow-hidden">
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
      h.files.length === 0
        ? <p className="px-4 py-4 text-xs text-[var(--text-muted)] text-center">Dosya bulunamadı.</p>
        : <HostFileList files={h.files} />
    )}
  </div>
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

      {result.hosts.map((h) => <HostBlock key={h.host} h={h} />)}

      <button onClick={onRestart} className="btn-secondary w-full">
        Yeni Sorgu
      </button>
    </div>
  );
};

export default FileListResultStep;
