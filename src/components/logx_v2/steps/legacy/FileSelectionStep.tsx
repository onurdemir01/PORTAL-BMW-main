// src/components/logx_v2/steps/legacy/FileSelectionStep.tsx — Discovery sonucunu host
// bazında gruplu gösterir; her host içinde dosyalar LOG DİZİNİNE göre ayrılır. Çoklu-host
// keşifte (bkz. logx_legacy_discovery.yml — birleşik artifact düzeltmesi) TÜM sunucular
// ayrı kart olarak listelenir; kullanıcı sunucu / dizin / dosya düzeyinde toplu seçebilir.
// Seçim burada üretilen (host,path) çiftleri backend'de discovery_result_json'a TOCTOU-
// doğrulanır (bkz. server/logx/v2/legacy.cjs transfer()) — bu bileşen yalnızca UI.
import React, { useMemo, useRef, useState } from "react";
import { DocumentIcon, ServerIcon, FolderIcon, MagnifyingGlassIcon, ChevronRightIcon } from "@heroicons/react/24/outline";
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
  const [search, setSearch] = useState("");
  const [onlySelected, setOnlySelected] = useState(false);
  // Katlama durumu. 30 sunucu × ~300 dosya = ~9000 satır; hepsini açık render etmek hem
  // DOM'u hem kullanıcıyı boğuyordu. Sunucular VARSAYILAN KAPALI (tek sunucu varsa açık).
  const [openHosts, setOpenHosts] = useState<Set<string>>(new Set());
  const [openDirs, setOpenDirs] = useState<Set<string>>(new Set());

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

  const query = search.trim().toLowerCase();

  // Arama + "yalnızca seçilenler" süzgeci. Boş kalan dizin/sunucu HİÇ gösterilmez —
  // kullanıcı eşleşme olmayan kartları tek tek açıp boş bulmasın.
  const visible = useMemo(() => {
    const matches = (host: string, path: string) => {
      if (onlySelected && !selected.has(key(host, path))) return false;
      if (!query) return true;
      return path.toLowerCase().includes(query);
    };
    return grouped
      .map((h) => {
        const dirs = h.dirs
          .map(([dir, files]) => [dir, files.filter((f) => matches(h.host, f.path))] as const)
          .filter(([, files]) => files.length > 0);
        const files = dirs.flatMap(([, f]) => f);
        return { host: h.host, dirs, files, totalFiles: h.files.length };
      })
      .filter((h) => h.files.length > 0);
  }, [grouped, query, onlySelected, selected]);

  // Süzgeç etkinken eşleşen gruplar KENDİLİĞİNDEN açılır: kullanıcı aradığı dosyayı
  // bulmak için ayrıca tıklamak zorunda kalmasın.
  const filtering = query.length > 0 || onlySelected;
  const singleHost = grouped.length === 1;
  const isHostOpen = (host: string) => filtering || singleHost || openHosts.has(host);
  const isDirOpen = (host: string, dir: string) =>
    filtering || singleHost || openDirs.has(`${host}::${dir}`);

  function toggleSet(setter: React.Dispatch<React.SetStateAction<Set<string>>>, id: string) {
    setter((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

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

  // Seçim ÖZETİ tüm sunucular üzerinden — süzgeç bir şeyi gizlese de seçili kalır ve
  // kullanıcı neyi göndereceğini görebilir.
  const summary = useMemo(() => {
    let files = 0;
    let bytes = 0;
    const hosts = new Set<string>();
    for (const h of okHosts) {
      for (const f of h.files) {
        if (!selected.has(key(h.host, f.path))) continue;
        files++;
        bytes += f.size || 0;
        hosts.add(h.host);
      }
    }
    return { files, bytes, hosts: hosts.size };
  }, [okHosts, selected]);

  function submit() {
    const chosen: { host: string; path: string }[] = [];
    for (const h of okHosts) {
      for (const f of h.files) {
        if (selected.has(key(h.host, f.path))) chosen.push({ host: h.host, path: f.path });
      }
    }
    onSubmit(chosen);
  }

  const totalFiles = okHosts.reduce((n, h) => n + h.files.length, 0);

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

      <div className="relative">
        <MagnifyingGlassIcon className="w-4 h-4 text-[var(--text-muted)] absolute left-3 top-1/2 -translate-y-1/2" />
        <input
          autoFocus
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Dosya veya dizin ara… (ör. server.log, /audit/)"
          className="w-full pl-9 pr-3 py-2.5 text-sm border border-[var(--border)] rounded-xl outline-none focus:border-[var(--accent)] focus:ring-1 focus:ring-[var(--accent)] transition font-mono"
        />
      </div>

      <div className="flex items-center justify-between gap-2 text-xs">
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setOnlySelected((v) => !v)}
            disabled={summary.files === 0}
            className={`px-2.5 py-1 rounded-full border transition-colors disabled:opacity-40 ${
              onlySelected
                ? "bg-[var(--accent)] text-white border-[var(--accent)]"
                : "border-[var(--border)] text-[var(--text-secondary)] hover:border-[var(--text-muted)]"
            }`}
          >
            Yalnızca seçilenler
          </button>
          {!filtering && grouped.length > 1 && (
            <button
              onClick={() => setOpenHosts((prev) => (prev.size ? new Set() : new Set(grouped.map((h) => h.host))))}
              className="px-2.5 py-1 rounded-full border border-[var(--border)] text-[var(--text-secondary)] hover:border-[var(--text-muted)] transition-colors"
            >
              {openHosts.size ? "Tümünü kapat" : "Tümünü aç"}
            </button>
          )}
        </div>
        <span className="text-[var(--text-muted)]">
          {visible.reduce((n, h) => n + h.files.length, 0)} / {totalFiles} dosya
        </span>
      </div>

      {/* Seçim özeti — süzgeçten bağımsız, her zaman GERÇEK seçimi gösterir. */}
      {summary.files > 0 && (
        <div className="flex items-center justify-between gap-2 rounded-xl border border-[var(--accent)]/30 bg-[var(--bg-elevated)] px-3 py-2 text-xs">
          <span className="text-[var(--text-primary)]">
            <strong>{summary.hosts}</strong> sunucu · <strong>{summary.files}</strong> dosya
            {summary.bytes > 0 && <> · {fmtSize(summary.bytes)}</>}
          </span>
          <button
            onClick={() => setSelected(new Set())}
            className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] underline"
          >
            Seçimi temizle
          </button>
        </div>
      )}

      <div className="max-h-96 overflow-y-auto space-y-2">
        {visible.length === 0 ? (
          <p className="text-sm text-[var(--text-muted)] text-center py-8">
            {filtering ? "Eşleşen dosya yok." : "Taranan sunucularda dosya bulunamadı."}
          </p>
        ) : visible.map((h) => {
          const hostSel = selState(h.host, h.files);
          const hostFiles = h.files.map((f) => ({ host: h.host, path: f.path }));
          const open = isHostOpen(h.host);
          return (
            <div key={h.host} className="border border-[var(--border)] rounded-xl">
              <div className="flex items-center gap-2 p-3">
                <TriCheckbox
                  checked={hostSel.all}
                  indeterminate={hostSel.some}
                  onChange={() => setMany(hostFiles, !hostSel.all)}
                  aria-label={`${h.host} görünen dosyaların tümünü seç`}
                />
                <button
                  onClick={() => toggleSet(setOpenHosts, h.host)}
                  disabled={filtering || singleHost}
                  aria-expanded={open}
                  className="flex items-center gap-2 flex-1 min-w-0 text-left disabled:cursor-default"
                >
                  <ChevronRightIcon
                    aria-hidden="true"
                    className={`w-4 h-4 text-[var(--text-muted)] flex-shrink-0 transition-transform ${open ? "rotate-90" : ""}`}
                  />
                  <ServerIcon aria-hidden="true" className="w-4 h-4 text-[var(--text-muted)] flex-shrink-0" />
                  <span className="text-sm font-semibold text-[var(--text-primary)] truncate">{h.host}</span>
                  <span className="text-xs text-[var(--text-muted)] flex-shrink-0">
                    {h.files.length}
                    {h.files.length !== h.totalFiles && ` / ${h.totalFiles}`} dosya
                    {hostSel.on > 0 ? ` · ${hostSel.on} seçili` : ""}
                  </span>
                </button>
              </div>

              {open && (
                <div className="space-y-2 px-3 pb-3">
                  {h.dirs.map(([dir, files]) => {
                    const dirSel = selState(h.host, files);
                    const dirFiles = files.map((f) => ({ host: h.host, path: f.path }));
                    const dirOpen = isDirOpen(h.host, dir);
                    return (
                      <div key={dir} className="rounded-lg border border-[var(--border)]/60">
                        <div className="flex items-center gap-2 px-2 py-1.5 bg-[var(--bg-elevated)]/50 rounded-t-lg">
                          <TriCheckbox
                            checked={dirSel.all}
                            indeterminate={dirSel.some}
                            onChange={() => setMany(dirFiles, !dirSel.all)}
                            aria-label={`${dir} dizinini seç`}
                          />
                          <button
                            onClick={() => toggleSet(setOpenDirs, `${h.host}::${dir}`)}
                            disabled={filtering || singleHost}
                            aria-expanded={dirOpen}
                            className="flex items-center gap-2 flex-1 min-w-0 text-left disabled:cursor-default"
                          >
                            <ChevronRightIcon
                              aria-hidden="true"
                              className={`w-3.5 h-3.5 text-[var(--text-muted)] flex-shrink-0 transition-transform ${dirOpen ? "rotate-90" : ""}`}
                            />
                            <FolderIcon aria-hidden="true" className="w-3.5 h-3.5 text-[var(--text-muted)] flex-shrink-0" />
                            <span className="text-[11px] text-[var(--text-secondary)] font-mono truncate flex-1">{dir}</span>
                            <span className="text-[10px] text-[var(--text-muted)] flex-shrink-0">
                              {files.length}{dirSel.on > 0 ? ` · ${dirSel.on}` : ""}
                            </span>
                          </button>
                        </div>
                        {dirOpen && (
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
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
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
