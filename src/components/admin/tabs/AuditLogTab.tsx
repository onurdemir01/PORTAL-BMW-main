import React, { useState, useEffect, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { auditApi, type AuditLog } from "@/api/adminApi";
import {
  ArrowPathIcon,
  FunnelIcon,
  ShieldCheckIcon,
  ExclamationTriangleIcon,
  CheckCircleIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
} from "@heroicons/react/24/outline";
import { fmtDateTimeSeconds as formatDate } from "@/utils/datetime";

const PAGE_SIZE = 50;

// K-03: Show Turkey local time (UTC+3)


function resultBadge(result?: string) {
  if (!result) return "bg-gray-100 text-gray-500";
  if (result === "success") return "bg-green-50 text-green-700";
  if (result.includes("error") || result === "unauthorized" || result === "unreachable")
    return "bg-red-50 text-red-700";
  return "bg-amber-50 text-amber-700";
}

// K-02: Row highlight for db_error
function rowHighlight(result?: string): string {
  if (result === "db_error" || result === "error") return "bg-red-50/40";
  return "";
}

interface ChainResult {
  ok: boolean;
  verified: number;
  broken: number;
  firstBrokenId: number | null;
  // v2 hash şeması öncesi (doğrulama kapsamı dışı) kayıt sayısı
  legacyCount?: number;
}

const ROW_HEIGHT = 44;

// Iki denetim kaynagi: LogX akis kayitlari (logx_audit_logs) ve portal geneli
// admin/CRUD/login kayitlari (portal_audit_logs) — ayni tablo gorunumuyle gosterilir.
type AuditSource = "logx" | "portal";

const AuditLogTab: React.FC = () => {
  const [source, setSource] = useState<AuditSource>("portal");
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState({ username: "", targetHost: "", action: "" });
  const [showFilters, setShowFilters] = useState(false);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);

  const [verifying, setVerifying] = useState(false);
  const [chainResult, setChainResult] = useState<ChainResult | null>(null);

  const parentRef = useRef<HTMLDivElement>(null);

  const rowVirtualizer = useVirtualizer({
    count: logs.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 10,
  });

  async function load(p = page) {
    setLoading(true);
    setError(null);
    try {
      const params = {
        username: filters.username || undefined,
        targetHost: filters.targetHost || undefined,
        action: filters.action || undefined,
        limit: PAGE_SIZE + 1, // fetch one extra to detect hasMore
        offset: (p - 1) * PAGE_SIZE,
      };
      let data: AuditLog[];
      if (source === "portal") {
        const qs = new URLSearchParams();
        if (params.username) qs.set("username", params.username);
        if (params.action) qs.set("action", params.action);
        qs.set("limit", String(params.limit));
        qs.set("offset", String(params.offset));
        const r = await fetch(`/api/portal-audit?${qs.toString()}`);
        const d = await r.json();
        if (!d.ok) throw new Error(d.error || `HTTP ${r.status}`);
        data = d.logs as AuditLog[];
      } else {
        data = await auditApi.list(params);
      }
      setHasMore(data.length > PAGE_SIZE);
      setLogs(data.slice(0, PAGE_SIZE));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  async function verifyChain() {
    setVerifying(true);
    setChainResult(null);
    try {
      const r = await fetch(source === "portal" ? "/api/portal-audit/verify" : "/api/logx/admin/audit/verify");
      const data = await r.json();
      setChainResult(data);
    } catch {
      setChainResult({ ok: false, verified: 0, broken: -1, firstBrokenId: null });
    } finally {
      setVerifying(false);
    }
  }

  useEffect(() => { setPage(1); setChainResult(null); load(1); }, [source]); // eslint-disable-line react-hooks/exhaustive-deps

  function applyFilters() { setPage(1); load(1); }
  function goPage(p: number) { setPage(p); load(p); }

  const virtualItems = rowVirtualizer.getVirtualItems();
  const totalSize = rowVirtualizer.getTotalSize();

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          {/* Kaynak secici: Portal (admin/CRUD/login) | LogX (log akis kayitlari) */}
          <div className="flex gap-1 rounded-lg p-0.5 bg-gray-100">
            {([["portal", "Portal"], ["logx", "LogX"]] as const).map(([id, label]) => (
              <button key={id} onClick={() => setSource(id)}
                className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                  source === id ? "bg-white shadow-sm text-gray-900" : "text-gray-500 hover:text-gray-700"
                }`}>
                {label}
              </button>
            ))}
          </div>
          <p className="text-sm text-gray-500">{logs.length} kayıt (Sayfa {page})</p>
          {/* K-02: db_error legend */}
          <span className="text-xs px-2 py-0.5 bg-red-50 text-red-600 rounded-full">● db_error kırmızı</span>
        </div>
        <div className="flex gap-2">
          <button
            onClick={verifyChain}
            disabled={verifying}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
          >
            <ShieldCheckIcon className="w-4 h-4" />
            {verifying ? "Kontrol ediliyor..." : "Zincir Doğrula"}
          </button>
          <button
            onClick={() => setShowFilters(!showFilters)}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-sm border rounded-lg transition-colors
              ${showFilters ? "bg-black text-white border-black" : "border-gray-200 hover:bg-gray-50"}`}
          >
            <FunnelIcon className="w-4 h-4" />
            Filtrele
          </button>
          <button
            onClick={() => load()}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
          >
            <ArrowPathIcon className="w-4 h-4" />
            Yenile
          </button>
        </div>
      </div>

      {/* Chain verify result */}
      {chainResult && (
        <div className={`flex items-start gap-3 rounded-xl px-4 py-3 border ${chainResult.ok ? "bg-green-50 border-green-100" : "bg-red-50 border-red-100"}`}>
          {chainResult.ok
            ? <CheckCircleIcon className="w-4 h-4 text-green-600 flex-shrink-0 mt-0.5" />
            : <ExclamationTriangleIcon className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />}
          <div className="text-sm space-y-0.5">
            {chainResult.ok
              ? <span className="text-green-700"><strong>Zincir bütünlüğü doğrulandı.</strong> {chainResult.verified} kayıt kontrol edildi.</span>
              : chainResult.broken === -1
                ? <span className="text-red-700">Doğrulama sırasında hata oluştu.</span>
                : <span className="text-red-700">
                    <strong>Zincir kırık!</strong> {chainResult.verified} kayıttan {chainResult.broken} tanesi doğrulanamadı.
                    {chainResult.firstBrokenId && <span> İlk sorunlu kayıt ID: <code className="bg-red-100 px-1 rounded">{chainResult.firstBrokenId}</code></span>}
                  </span>}
            {(chainResult.legacyCount ?? 0) > 0 && (
              <p className={`text-xs ${chainResult.ok ? "text-green-600" : "text-red-500"} opacity-80`}>
                {chainResult.legacyCount} eski-format kayıt doğrulama kapsamı dışında (v2 öncesi).
              </p>
            )}
          </div>
        </div>
      )}

      {/* Filters */}
      {showFilters && (
        <div className="bg-gray-50 rounded-xl p-4 grid grid-cols-3 gap-3">
          {(["username", "targetHost", "action"] as const).map((key) => (
            <div key={key}>
              <label className="block text-xs font-medium text-gray-600 mb-1">
                {key === "targetHost" ? "Hedef Host" : key === "username" ? "Kullanıcı" : "Aksiyon"}
              </label>
              <input
                type="text"
                value={filters[key]}
                onChange={(e) => setFilters(prev => ({ ...prev, [key]: e.target.value }))}
                placeholder="Tümü"
                className="w-full px-3 py-1.5 text-sm border border-gray-200 rounded-lg outline-none focus:border-black transition"
              />
            </div>
          ))}
          <div className="col-span-3 flex justify-end">
            <button onClick={applyFilters} className="px-4 py-1.5 bg-black text-white text-sm rounded-lg hover:bg-gray-800 transition-colors">
              Uygula
            </button>
          </div>
        </div>
      )}

      {loading && <div className="py-8 text-center text-sm text-gray-400">Yükleniyor...</div>}
      {error && (
        <div className="bg-red-50 rounded-xl p-4 text-sm text-red-700">
          {error}
          <button onClick={() => load()} className="ml-3 underline">Tekrar dene</button>
        </div>
      )}

      {!loading && !error && (
        <>
          <div className="rounded-xl border border-gray-100 overflow-hidden">
            {/* Table header */}
            <div className="grid text-xs font-medium text-gray-500 bg-gray-50 border-b border-gray-100"
              style={{ gridTemplateColumns: "160px 120px 160px 130px 100px 1fr" }}>
              {["Zaman (TR)", "Kullanıcı", "Host", "Aksiyon", "Sonuç", "Detay"].map((h) => (
                <div key={h} className="px-4 py-3">{h}</div>
              ))}
            </div>

            {logs.length === 0 ? (
              <div className="py-10 text-center text-sm text-gray-400">Kayıt bulunamadı.</div>
            ) : (
              <div ref={parentRef} className="overflow-auto" style={{ height: Math.min(logs.length * ROW_HEIGHT, 500) }}>
                <div style={{ height: totalSize, width: "100%", position: "relative" }}>
                  {virtualItems.map((virtualRow) => {
                    const log = logs[virtualRow.index];
                    return (
                      <div
                        key={virtualRow.key}
                        className={`grid hover:bg-gray-50 transition-colors border-b border-gray-50 absolute top-0 left-0 w-full ${rowHighlight(log.result)}`}
                        style={{
                          gridTemplateColumns: "160px 120px 160px 130px 100px 1fr",
                          height: ROW_HEIGHT,
                          transform: `translateY(${virtualRow.start}px)`,
                        }}
                      >
                        <div className="px-4 flex items-center text-xs text-gray-500 whitespace-nowrap">{formatDate(log.created_at)}</div>
                        <div className="px-4 flex items-center font-medium text-gray-900 text-sm truncate" title={log.username}>{log.username}</div>
                        <div className="px-4 flex items-center text-gray-600 text-sm truncate" title={log.target_host || "—"}>{log.target_host || "—"}</div>
                        <div className="px-4 flex items-center text-gray-600 font-mono text-xs truncate" title={log.action}>{log.action}</div>
                        <div className="px-4 flex items-center">
                          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${resultBadge(log.result)}`}>
                            {log.result || "—"}
                          </span>
                        </div>
                        <div className="px-4 flex items-center text-xs text-gray-500 truncate" title={log.detail || ""}>
                          {log.detail || "—"}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* K-01: Pagination controls */}
          <div className="flex items-center justify-between">
            <p className="text-xs text-gray-400">Sayfa başına {PAGE_SIZE} kayıt gösteriliyor</p>
            <div className="flex items-center gap-2">
              <button
                onClick={() => goPage(page - 1)}
                disabled={page <= 1}
                className="p-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                <ChevronLeftIcon className="w-4 h-4" />
              </button>
              <span className="text-sm font-medium min-w-[60px] text-center">Sayfa {page}</span>
              <button
                onClick={() => goPage(page + 1)}
                disabled={!hasMore}
                className="p-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                <ChevronRightIcon className="w-4 h-4" />
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default AuditLogTab;
