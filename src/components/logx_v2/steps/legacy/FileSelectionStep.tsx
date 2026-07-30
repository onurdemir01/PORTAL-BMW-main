// src/components/logx_v2/steps/legacy/FileSelectionStep.tsx — Discovery sonucunu host
// bazında gruplu gösterir; her host içinde dosyalar LOG DİZİNİNE göre ayrılır. Çoklu-host
// keşifte (bkz. logx_legacy_discovery.yml — birleşik artifact düzeltmesi) TÜM sunucular
// ayrı kart olarak listelenir; kullanıcı sunucu / dizin / dosya düzeyinde toplu seçebilir.
// Seçim burada üretilen (host,path) çiftleri backend'de discovery_result_json'a TOCTOU-
// doğrulanır (bkz. server/logx/v2/legacy.cjs transfer()) — bu bileşen yalnızca UI.
import React, { useMemo, useRef, useState } from "react";
import { DocumentIcon, ServerIcon, FolderIcon } from "@heroicons/react/24/outline";
import type { LegacyDiscoveryResult } from "@/api/logxV2Api";

interface Props {
  result: LegacyDiscoveryResult;
  onSubmit: (selected: { host: string; path: string }[]) => void;
  busy?: boolean;
}

function envBadgeClass(env?: string) {
  const map: Record<string, string> = {
    PROD: "bg-red-50 text-red-700",
    TEST: "bg-yellow-50 text-yellow-700",
    DEV: "bg-green-50 text-green-700",
  };
  return map[env || ""] || "bg-[var(--bg-elevated)] text-[var(--text-secondary)]";
}

function dirOf(path: string) {
  const i = path.lastIndexOf("/");
  return i > 0 ? path.slice(0, i) : "/";
}
function baseOf(path: string) {
  const i = path.lastIndexOf("/");
  return i >= 0 ? path.slice(i + 1) : path;
}
function fmtSize(bytes?: number) {
  if (!bytes || bytes <= 0) return "";
  const u = ["B", "KB", "MB", "GB"];
  let n = bytes, i = 0;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(n < 10 && i > 0 ? 1 : 0)} ${u[i]}`;
}

// Bir <input type=checkbox>'a indeterminate (kısmen seçili) durumunu uygular.
const TriCheckbox: React.FC<{
  checked: boolean;
  indeterminate: boolean;
  onChange: () => void;
  "aria-label"?: string;
}> = ({ checked, indeterminate, onChange, ...rest }) => {
  const ref = useRef<HTMLInputElement>(null);
  React.useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate && !checked;
  }, [indeterminate, checked]);
  return <input ref={ref} type="checkbox" checked={checked} onChange={onChange} className="rounded" {...rest} />;
};

const FileSelectionStep: React.FC<Props> = ({ result, onSubmit, busy }) => {
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const key = (host: string, path: string) => `${host}::${path}`;

  const failedHosts = (result.hosts || []).filter((h) => h.status !== "ok");
  const okHosts = (result.hosts || []).filter((h) => h.status === "ok");

  // Her host için dosyaları dizine göre grupla (stabil sıra korunur).
  const grouped = useMemo(
    () =>
      okHosts.map((h) => {
        const dirs = new Map<string, typeof h.files>();
        for (const f of h.files) {
          const d = dirOf(f.path);
          if (!dirs.has(d)) dirs.set(d, []);
          dirs.get(d)!.push(f);
        }
        return { host: h.host, files: h.files, dirs: Array.from(dirs.entries()) };
      }),
    [okHosts]
  );

  function setMany(paths: { host: string; path: string }[], on: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const p of paths) {
        const k = key(p.host, p.path);
        if (on) next.add(k); else next.delete(k);
      }
      return next;
    });
  }
  const toggleFile = (host: string, path: string) =>
    setMany([{ host, path }], !selected.has(key(host, path)));

  function selState(host: string, files: { path: string }[]) {
    const total = files.length;
    const on = files.filter((f) => selected.has(key(host, f.path))).length;
    return { all: total > 0 && on === total, some: on > 0 && on < total, on, total };
  }

  function submit() {
    const chosen: { host: string; path: string }[] = [];
    for (const h of okHosts) {
      for (const f of h.files) {
        if (selected.has(key(h.host, f.path))) chosen.push({ host: h.host, path: f.path });
      }
    }
    onSubmit(chosen);
  }

  return (
    <div className="space-y-3">
      {result.overall_status === "partial" && (
        <div className="bg-amber-50 border border-amber-100 rounded-xl p-3 text-xs text-amber-800">
          Bazı sunuculara erişilemedi — aşağıda yalnızca başarıyla taranan sunucular gösteriliyor.
        </div>
      )}
      {failedHosts.length > 0 && (
        <div className="text-xs text-[var(--text-muted)]">
          Erişilemeyen sunucular: {failedHosts.map((h) => h.host).join(", ")}
        </div>
      )}
      {okHosts.length > 1 && (
        <div className="text-xs text-[var(--text-secondary)]">
          {okHosts.length} sunucu tarandı — her sunucunun log dizinlerini ayrı ayrı seçebilirsiniz.
        </div>
      )}

      <div className="max-h-96 overflow-y-auto space-y-3">
        {grouped.map((h) => {
          const hostSel = selState(h.host, h.files);
          const hostFiles = h.files.map((f) => ({ host: h.host, path: f.path }));
          return (
            <div key={h.host} className="border border-[var(--border)] rounded-xl p-3">
              <label className="flex items-center gap-2 mb-2 cursor-pointer">
                <TriCheckbox
                  checked={hostSel.all}
                  indeterminate={hostSel.some}
                  onChange={() => setMany(hostFiles, !hostSel.all)}
                  aria-label={`${h.host} tüm dosyaları seç`}
                />
                <ServerIcon className="w-4 h-4 text-[var(--text-muted)]" />
                <span className="text-sm font-semibold text-[var(--text-primary)]">{h.host}</span>
                <span className="text-xs text-[var(--text-muted)]">
                  ({h.files.length} dosya{hostSel.on > 0 ? ` · ${hostSel.on} seçili` : ""})
                </span>
              </label>

              <div className="space-y-2 pl-1">
                {h.dirs.map(([dir, files]) => {
                  const dirSel = selState(h.host, files);
                  const dirFiles = files.map((f) => ({ host: h.host, path: f.path }));
                  return (
                    <div key={dir} className="rounded-lg border border-[var(--border)]/60">
                      <label className="flex items-center gap-2 px-2 py-1.5 bg-[var(--bg-elevated)]/50 rounded-t-lg cursor-pointer">
                        <TriCheckbox
                          checked={dirSel.all}
                          indeterminate={dirSel.some}
                          onChange={() => setMany(dirFiles, !dirSel.all)}
                          aria-label={`${dir} dizinini seç`}
                        />
                        <FolderIcon className="w-3.5 h-3.5 text-[var(--text-muted)] flex-shrink-0" />
                        <span className="text-[11px] text-[var(--text-secondary)] font-mono truncate flex-1">{dir}</span>
                        <span className="text-[10px] text-[var(--text-muted)] flex-shrink-0">{files.length}</span>
                      </label>
                      <div className="space-y-0.5 p-1">
                        {files.map((f) => (
                          <label
                            key={f.path}
                            className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-[var(--bg-elevated)] cursor-pointer"
                          >
                            <input
                              type="checkbox"
                              checked={selected.has(key(h.host, f.path))}
                              onChange={() => toggleFile(h.host, f.path)}
                              className="rounded"
                            />
                            <DocumentIcon className="w-3.5 h-3.5 text-[var(--text-muted)] flex-shrink-0" />
                            <span className="text-xs text-[var(--text-primary)] font-mono truncate flex-1">{baseOf(f.path)}</span>
                            {f.size ? (
                              <span className="text-[10px] text-[var(--text-muted)] flex-shrink-0 tabular-nums">{fmtSize(f.size)}</span>
                            ) : null}
                            {f.environment && (
                              <span className={`text-[10px] px-1.5 py-0.5 rounded-full flex-shrink-0 ${envBadgeClass(f.environment)}`}>{f.environment}</span>
                            )}
                          </label>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      <button
        onClick={submit}
        disabled={selected.size === 0 || busy}
        className="btn-primary w-full"
      >
        {busy ? "Hazırlanıyor…" : selected.size === 0 ? "En az bir dosya seçin" : `${selected.size} dosyayı indirmeye hazırla`}
      </button>
    </div>
  );
};

export default FileSelectionStep;
