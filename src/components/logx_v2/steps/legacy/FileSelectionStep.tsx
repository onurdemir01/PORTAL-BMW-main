// src/components/logx_v2/steps/legacy/FileSelectionStep.tsx — Discovery sonucunu host
// bazında gruplu gösterir; her host içinde dosyalar LOG DİZİNİNE göre ayrılır. Çoklu-host
// keşifte (bkz. logx_legacy_discovery.yml — birleşik artifact düzeltmesi) TÜM sunucular
// ayrı kart olarak listelenir; kullanıcı sunucu / dizin / dosya düzeyinde toplu seçebilir.
// Seçim burada üretilen (host,path) çiftleri backend'de discovery_result_json'a TOCTOU-
// doğrulanır (bkz. server/logx/v2/legacy.cjs transfer()) — bu bileşen yalnızca UI.
//
// ── 2026-08-28 TURU: DÖRT GERÇEK SORUN ───────────────────────────────────────────
//
// D1 · SIRALAMA. `mtime` tipte vardı ama HİÇ kullanılmıyordu; liste keşif sırasındaydı,
//      yani "en güncel log" ekranın ortasında kalabiliyordu. Artık her düzeyde
//      EN YENİ ÜSTTE ve her satırda "2 saat önce" yazıyor. Tip de yanlıştı (`string`;
//      `ansible.builtin.find` epoch **sayı** döner) — normalize edici her biçimi kabul
//      eder, hiçbiri yoksa dosya adındaki tarihe düşer.
//
// D2 · DONMA. Aramaya yazınca `filtering` TÜM grupları zorla açıyordu: 30 sunucu ×
//      ~500 dosya = ~15.000 satır tek seferde DOM'a. FileX aynı sorunu üretimde yaşayıp
//      çözmüş (FileListResultStep.tsx: *"tarayıcı sekmesini kilitleyip beyaz ekrana yol
//      açtı — üretimde gözlemlendi"*). Aynı desen: ağaç TEK bir düz satır listesine
//      çevrilir ve `@tanstack/react-virtual` ile yalnızca görünen satırlar çizilir.
//
// D3 · SESSİZ TAVAN. Legacy transferde hiçbir üst sınır yoktu (tek kontrol `=== 0`) ama
//      GERÇEK bir tavan vardı: istek gövdesi `express.json({limit:"2mb"})` parser'ından
//      geçiyor. Seçim büyüdüğünde istek handler'a HİÇ ULAŞMIYOR, body-parser 413
//      fırlatıyor, kullanıcı yalnızca "transfer başarısız" görüyordu. Artık gönderilecek
//      gövde GERÇEKTEN ölçülüp aynı sınırla karşılaştırılıyor ve kademeli uyarı veriliyor.
//
// D4 · ARAMA. Her tuş vuruşunda tüm ağaç yeniden süzülüyordu; debounce eklendi.
import React, { useDeferredValue, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  DocumentIcon, ServerIcon, FolderIcon, MagnifyingGlassIcon, ChevronRightIcon,
  ExclamationTriangleIcon, ClockIcon,
} from "@heroicons/react/24/outline";
import type { LegacyDiscoveryResult } from "@/api/logxV2Api";
import {
  // `toNumericSize` Onur'un uretim duzeltmesinden gelir (boyutlar tipte number,
  // calisma zamaninda string). `relativeTime`/`absoluteTime` ise buradan CIKTI:
  // artik ortak `@/utils/datetime` icindeler (asagidaki import).
  normalizeMtime, logKind, KIND_LABEL, KIND_CLASS,
  selectionPayloadBytes, selectionPressure, SELECTION_MAX_BYTES, fmtSize, toNumericSize,
} from "@/components/logx_v2/shared/logFileMeta";
import { fmtRelative, fmtDateTime } from "@/utils/datetime";

interface Props {
  result: LegacyDiscoveryResult;
  onSubmit: (selected: { host: string; path: string }[]) => void;
  busy?: boolean;
}

const ROW_HEIGHT = 34;      // dosya satırı
const GROUP_HEIGHT = 42;    // host / dizin başlığı
const LIST_HEIGHT = 420;

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

/** Zenginleştirilmiş dosya kaydı — mtime bir KEZ normalize edilir, her render'da değil. */
interface EnrichedFile {
  path: string;
  base: string;
  size?: number;
  environment?: string;
  at: number | null;      // normalize edilmiş mtime (ms) ya da null
  kind: ReturnType<typeof logKind>;
}

/** Düz listeye çevrilmiş satır — sanallaştırma tek bir düz dizi ister. */
type Row =
  | { t: "host"; host: string; files: EnrichedFile[]; shown: number; total: number; bytes: number; newest: number | null }
  | { t: "dir"; host: string; dir: string; files: EnrichedFile[]; bytes: number; newest: number | null }
  | { t: "file"; host: string; f: EnrichedFile };

const DAY_MS = 24 * 60 * 60 * 1000;

const FileSelectionStep: React.FC<Props> = ({ result, onSubmit, busy }) => {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [onlySelected, setOnlySelected] = useState(false);
  const [onlyRecent, setOnlyRecent] = useState(false);   // "son 24 saat"
  const [openHosts, setOpenHosts] = useState<Set<string>>(new Set());
  const [openDirs, setOpenDirs] = useState<Set<string>>(new Set());
  const scrollRef = useRef<HTMLDivElement>(null);

  // D4 · Debounce. `useDeferredValue` React'in kendi mekanizması: yazma her zaman
  // akıcı kalır, ağır süzme işi düşük öncelikte yeniden yapılır. Sabit bir
  // setTimeout'tan daha iyisi — gecikme cihazın hızına göre kendi ayarlanır.
  const rawQuery = search.trim().toLowerCase();
  const query = useDeferredValue(rawQuery);
  const searchPending = rawQuery !== query;

  const key = (host: string, path: string) => `${host}::${path}`;

  const failedHosts = (result.hosts || []).filter((h) => h.status !== "ok");
  const okHosts = useMemo(() => (result.hosts || []).filter((h) => h.status === "ok"), [result.hosts]);

  // D1 · Zenginleştirme + SIRALAMA. Her düzeyde EN YENİ ÜSTTE:
  // dosyalar mtime'a göre, dizinler içindeki en yeni dosyaya göre, sunucular da öyle.
  // mtime'ı olmayan dosyalar (normalize edilemedi ve ad da yardımcı olmadı) EN ALTA
  // düşer — "bilinmiyor"u üste koymak, sıralamanın amacını yok ederdi.
  const grouped = useMemo(() => {
    const byNewestDesc = (a: { newest: number | null }, b: { newest: number | null }) => {
      if (a.newest === b.newest) return 0;
      if (a.newest === null) return 1;
      if (b.newest === null) return -1;
      return b.newest - a.newest;
    };

    return okHosts
      .map((h) => {
        const enriched: EnrichedFile[] = (h.files || []).map((f) => ({
          path: f.path,
          base: baseOf(f.path),
          // TEK NORMALIZASYON NOKTASI: boyut string gelebiliyor (bkz. logFileMeta.ts).
          // Burada sayiya cevrildigi icin asagidaki BES ayri toplama noktasi da
          // guvenli olur - string'lerde `+` TOPLAMA degil BIRLESTIRME yapardi
          // (0 + "512" -> "0512") ve ozet boyut cokme olmadan da yanlis cikardi.
          size: toNumericSize(f.size),
          environment: f.environment,
          at: normalizeMtime(f.mtime, f.path),
          kind: logKind(f.path),
        }));

        const dirMap = new Map<string, EnrichedFile[]>();
        for (const f of enriched) {
          const d = dirOf(f.path);
          if (!dirMap.has(d)) dirMap.set(d, []);
          dirMap.get(d)!.push(f);
        }

        const dirs = Array.from(dirMap.entries())
          .map(([dir, files]) => {
            const sorted = [...files].sort((a, b) => byNewestDesc({ newest: a.at }, { newest: b.at }));
            return {
              dir,
              files: sorted,
              bytes: sorted.reduce((n, f) => n + (f.size || 0), 0),
              newest: sorted.length ? sorted[0].at : null,
            };
          })
          .sort(byNewestDesc);

        return {
          host: h.host,
          files: enriched,
          dirs,
          bytes: enriched.reduce((n, f) => n + (f.size || 0), 0),
          newest: dirs.length ? dirs[0].newest : null,
        };
      })
      .sort(byNewestDesc);
  }, [okHosts]);

  const filtering = query.length > 0 || onlySelected || onlyRecent;
  const singleHost = grouped.length === 1;
  const recentCutoff = Date.now() - DAY_MS;

  // Süzgeçten geçen ağaç. Boş kalan dizin/sunucu HİÇ gösterilmez.
  const visible = useMemo(() => {
    const matches = (host: string, f: EnrichedFile) => {
      if (onlySelected && !selected.has(key(host, f.path))) return false;
      if (onlyRecent && (f.at === null || f.at < recentCutoff)) return false;
      if (!query) return true;
      return f.path.toLowerCase().includes(query);
    };
    return grouped
      .map((h) => {
        const dirs = h.dirs
          .map((d) => ({ ...d, files: d.files.filter((f) => matches(h.host, f)) }))
          .filter((d) => d.files.length > 0)
          .map((d) => ({ ...d, bytes: d.files.reduce((n, f) => n + (f.size || 0), 0) }));
        const files = dirs.flatMap((d) => d.files);
        return {
          host: h.host, dirs, files,
          totalFiles: h.files.length,
          bytes: files.reduce((n, f) => n + (f.size || 0), 0),
          newest: h.newest,
        };
      })
      .filter((h) => h.files.length > 0);
  }, [grouped, query, onlySelected, onlyRecent, selected, recentCutoff]);

  // D2 · Süzgeç etkinken gruplar AÇIK gösterilir (kullanıcı aradığını görsün), ama
  // artık bu "15.000 satırı DOM'a bas" anlamına GELMİYOR: liste sanallaştırılmış.
  const isHostOpen = (host: string) => filtering || singleHost || openHosts.has(host);
  const isDirOpen = (host: string, dir: string) =>
    filtering || singleHost || openDirs.has(`${host}::${dir}`);

  // Ağaç -> düz satır listesi. Sanallaştırıcı yalnızca düz dizi ile çalışır; iç içe
  // kaydırma alanları kurmak (host başına bir tane) hem ölçüm hem klavye gezinmesi
  // açısından kırılgan olurdu.
  const rows = useMemo<Row[]>(() => {
    const out: Row[] = [];
    for (const h of visible) {
      out.push({
        t: "host", host: h.host, files: h.files, shown: h.files.length,
        total: h.totalFiles, bytes: h.bytes, newest: h.newest,
      });
      if (!isHostOpen(h.host)) continue;
      for (const d of h.dirs) {
        out.push({ t: "dir", host: h.host, dir: d.dir, files: d.files, bytes: d.bytes, newest: d.newest });
        if (!isDirOpen(h.host, d.dir)) continue;
        for (const f of d.files) out.push({ t: "file", host: h.host, f });
      }
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, openHosts, openDirs, filtering, singleHost]);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (i) => (rows[i].t === "file" ? ROW_HEIGHT : GROUP_HEIGHT),
    overscan: 12,
  });

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

  // Seçim ÖZETİ tüm sunucular üzerinden — süzgeç bir şeyi gizlese de seçili kalır.
  // `chosen` aynı zamanda gönderilecek gövdedir; D3 ölçümü BUNUN üzerinden yapılır.
  const { chosen, summary } = useMemo(() => {
    const list: { host: string; path: string }[] = [];
    let bytes = 0;
    const hosts = new Set<string>();
    for (const h of grouped) {
      for (const f of h.files) {
        if (!selected.has(key(h.host, f.path))) continue;
        list.push({ host: h.host, path: f.path });
        bytes += f.size || 0;
        hosts.add(h.host);
      }
    }
    return { chosen: list, summary: { files: list.length, bytes, hosts: hosts.size } };
  }, [grouped, selected]);

  // D3 · Gerçek gövde ölçümü + kademeli basınç.
  const payloadBytes = useMemo(() => selectionPayloadBytes(chosen), [chosen]);
  const pressure = selectionPressure(payloadBytes);
  const overLimit = pressure === "over";

  const totalFiles = grouped.reduce((n, h) => n + h.files.length, 0);
  const shownFiles = visible.reduce((n, h) => n + h.files.length, 0);

  const pressureStyle = {
    ok: "",
    warn: "border-[var(--status-warning)] bg-[var(--status-warning-bg)] text-amber-800",
    danger: "border-[var(--status-warning)] bg-[var(--status-warning-bg)] text-amber-800",
    over: "border-[var(--status-danger)] bg-[var(--status-danger-bg)] text-red-700",
  }[pressure];

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
        {searchPending && (
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-[var(--text-muted)]">
            süzülüyor…
          </span>
        )}
      </div>

      <div className="flex items-center justify-between gap-2 text-xs">
        <div className="flex items-center gap-1.5 flex-wrap">
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
          {/* "Son 24 saat": bir olayı araştıran kullanıcının aslında istediği şey
              genelde budur — 500 dosyanın içinden elle bulmak zorunda kalmasın. */}
          <button
            onClick={() => setOnlyRecent((v) => !v)}
            className={`px-2.5 py-1 rounded-full border transition-colors inline-flex items-center gap-1 ${
              onlyRecent
                ? "bg-[var(--accent)] text-white border-[var(--accent)]"
                : "border-[var(--border)] text-[var(--text-secondary)] hover:border-[var(--text-muted)]"
            }`}
          >
            <ClockIcon aria-hidden="true" className="w-3.5 h-3.5" />
            Son 24 saat
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
        <span className="text-[var(--text-muted)] flex-shrink-0">
          {shownFiles} / {totalFiles} dosya · en yeni üstte
        </span>
      </div>

      {/* Seçim özeti — süzgeçten bağımsız, her zaman GERÇEK seçimi gösterir. */}
      {summary.files > 0 && (
        <div className={`flex items-center justify-between gap-2 rounded-xl border px-3 py-2 text-xs ${
          pressure === "ok" ? "border-[var(--accent)]/30 bg-[var(--bg-elevated)]" : pressureStyle
        }`}>
          <span className={pressure === "ok" ? "text-[var(--text-primary)]" : ""}>
            <strong>{summary.hosts}</strong> sunucu · <strong>{summary.files}</strong> dosya
            {summary.bytes > 0 && <> · {fmtSize(summary.bytes)}</>}
          </span>
          <button
            onClick={() => setSelected(new Set())}
            className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] underline flex-shrink-0"
          >
            Seçimi temizle
          </button>
        </div>
      )}

      {/* D3 · Kademeli uyarı. Sessizce sınıra dayanıp opak bir hata almak yerine
          kullanıcı yaklaştığını GÖRÜR. Ölçü gerçek gövde boyutudur. */}
      {pressure !== "ok" && (
        <div className={`flex items-start gap-2 rounded-xl border p-3 text-xs ${pressureStyle}`}>
          <ExclamationTriangleIcon aria-hidden="true" className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <span>
            {overLimit ? (
              <>
                Seçim, tek bir istekte gönderilebilecek sınırı <strong>aştı</strong>{" "}
                ({fmtSize(payloadBytes)} / {fmtSize(SELECTION_MAX_BYTES)}). Bu haliyle gönderilirse
                istek sunucuya <strong>hiç ulaşmaz</strong>. Seçimi azaltın ya da transferi
                birkaç parçaya bölün.
              </>
            ) : (
              <>
                Seçim istek sınırına yaklaşıyor ({fmtSize(payloadBytes)} / {fmtSize(SELECTION_MAX_BYTES)}).
                Sınır dosya <em>sayısı</em> değil, dosya <em>yollarının</em> toplam uzunluğudur —
                uzun yollu dizinlerde daha erken dolar.
              </>
            )}
          </span>
        </div>
      )}

      {/* D2 · SANALLAŞTIRILMIŞ LİSTE — DOM boyutu dosya sayısından BAĞIMSIZ sabittir. */}
      <div
        ref={scrollRef}
        className="overflow-y-auto rounded-xl border border-[var(--border)]"
        style={{ height: LIST_HEIGHT }}
      >
        {rows.length === 0 ? (
          <p className="text-sm text-[var(--text-muted)] text-center py-8">
            {filtering ? "Eşleşen dosya yok." : "Taranan sunucularda dosya bulunamadı."}
          </p>
        ) : (
          <div style={{ height: virtualizer.getTotalSize(), position: "relative", width: "100%" }}>
            {virtualizer.getVirtualItems().map((v) => {
              const row = rows[v.index];
              const common = {
                position: "absolute" as const,
                top: 0, left: 0, width: "100%",
                transform: `translateY(${v.start}px)`,
              };

              if (row.t === "host") {
                const sel = selState(row.host, row.files);
                const open = isHostOpen(row.host);
                return (
                  <div key={v.key} ref={virtualizer.measureElement} data-index={v.index} style={common}
                       className="flex items-center gap-2 px-3 py-2 bg-[var(--bg-surface)] border-b border-[var(--border)]">
                    <TriCheckbox
                      checked={sel.all}
                      indeterminate={sel.some}
                      onChange={() => setMany(row.files.map((f) => ({ host: row.host, path: f.path })), !sel.all)}
                      aria-label={`${row.host} görünen dosyaların tümünü seç`}
                    />
                    <button
                      onClick={() => toggleSet(setOpenHosts, row.host)}
                      disabled={filtering || singleHost}
                      aria-expanded={open}
                      className="flex items-center gap-2 flex-1 min-w-0 text-left disabled:cursor-default"
                    >
                      <ChevronRightIcon aria-hidden="true"
                        className={`w-4 h-4 text-[var(--text-muted)] flex-shrink-0 transition-transform ${open ? "rotate-90" : ""}`} />
                      <ServerIcon aria-hidden="true" className="w-4 h-4 text-[var(--text-muted)] flex-shrink-0" />
                      <span className="text-sm font-semibold text-[var(--text-primary)] truncate" title={row.host}>{row.host}</span>
                      <span className="text-xs text-[var(--text-muted)] flex-shrink-0 tabular-nums">
                        {row.shown}{row.shown !== row.total && ` / ${row.total}`} dosya
                        {row.bytes > 0 && ` · ${fmtSize(row.bytes)}`}
                        {sel.on > 0 ? ` · ${sel.on} seçili` : ""}
                      </span>
                    </button>
                    <span className="text-[10px] text-[var(--text-muted)] flex-shrink-0" title={fmtDateTime(row.newest)}>
                      {fmtRelative(row.newest)}
                    </span>
                  </div>
                );
              }

              if (row.t === "dir") {
                const sel = selState(row.host, row.files);
                const open = isDirOpen(row.host, row.dir);
                return (
                  <div key={v.key} ref={virtualizer.measureElement} data-index={v.index} style={common}
                       className="flex items-center gap-2 pl-6 pr-3 py-1.5 bg-[var(--bg-elevated)]/50 border-b border-[var(--border)]/60">
                    <TriCheckbox
                      checked={sel.all}
                      indeterminate={sel.some}
                      onChange={() => setMany(row.files.map((f) => ({ host: row.host, path: f.path })), !sel.all)}
                      aria-label={`${row.dir} dizinini seç`}
                    />
                    <button
                      onClick={() => toggleSet(setOpenDirs, `${row.host}::${row.dir}`)}
                      disabled={filtering || singleHost}
                      aria-expanded={open}
                      className="flex items-center gap-2 flex-1 min-w-0 text-left disabled:cursor-default"
                    >
                      <ChevronRightIcon aria-hidden="true"
                        className={`w-3.5 h-3.5 text-[var(--text-muted)] flex-shrink-0 transition-transform ${open ? "rotate-90" : ""}`} />
                      <FolderIcon aria-hidden="true" className="w-3.5 h-3.5 text-[var(--text-muted)] flex-shrink-0" />
                      <span className="text-[11px] text-[var(--text-secondary)] font-mono truncate flex-1" title={row.dir}>{row.dir}</span>
                      {/* Grup toplamı: "bu dizini komple seçersem ne kadar iner" sorusu
                          eskiden ancak seçtikten sonra cevaplanıyordu. */}
                      <span className="text-[10px] text-[var(--text-muted)] flex-shrink-0 tabular-nums">
                        {row.files.length}{row.bytes > 0 && ` · ${fmtSize(row.bytes)}`}{sel.on > 0 ? ` · ${sel.on}` : ""}
                      </span>
                    </button>
                  </div>
                );
              }

              const f = row.f;
              const isSel = selected.has(key(row.host, f.path));
              return (
                <label key={v.key} ref={virtualizer.measureElement} data-index={v.index} style={common}
                       className="flex items-center gap-2 pl-10 pr-3 py-1.5 hover:bg-[var(--bg-elevated)] cursor-pointer">
                  <input type="checkbox" checked={isSel} onChange={() => toggleFile(row.host, f.path)} className="rounded" />
                  <DocumentIcon aria-hidden="true" className="w-3.5 h-3.5 text-[var(--text-muted)] flex-shrink-0" />
                  <span className="text-xs text-[var(--text-primary)] font-mono truncate flex-1" title={f.path}>{f.base}</span>
                  {/* Log tipi rozeti: 200 dosyalık listede "hangisi hata logu" tek bakışta. */}
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full flex-shrink-0 ${KIND_CLASS[f.kind]}`}>
                    {KIND_LABEL[f.kind]}
                  </span>
                  <span className="text-[10px] text-[var(--text-muted)] flex-shrink-0 tabular-nums w-20 text-right"
                        title={fmtDateTime(f.at)}>
                    {fmtRelative(f.at) || "—"}
                  </span>
                  {f.size ? (
                    <span className="text-[10px] text-[var(--text-muted)] flex-shrink-0 tabular-nums w-14 text-right">{fmtSize(f.size)}</span>
                  ) : <span className="w-14 flex-shrink-0" />}
                  {f.environment && (
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full flex-shrink-0 ${envBadgeClass(f.environment)}`}>{f.environment}</span>
                  )}
                </label>
              );
            })}
          </div>
        )}
      </div>

      <button
        onClick={() => onSubmit(chosen)}
        disabled={selected.size === 0 || busy || overLimit}
        className="btn-primary w-full"
      >
        {busy ? "Hazırlanıyor…"
          : selected.size === 0 ? "En az bir dosya seçin"
          : overLimit ? "Seçim çok büyük — azaltın"
          : `${selected.size} dosyayı indirmeye hazırla`}
      </button>
    </div>
  );
};

export default FileSelectionStep;
