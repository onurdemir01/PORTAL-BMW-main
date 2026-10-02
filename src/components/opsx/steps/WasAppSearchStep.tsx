// src/components/opsx/steps/WasAppSearchStep.tsx — WAS uygulaması (JVM adı) seçimi ve
// canlı keşfin hangi sunucularda koşacağı.
//
// Kaynak dbo.WASAppsInventory (JBoss envanterinden AYRI). "NOAPP" yer tutucusu listelenmez.
// AIX ve diğer Linux dışı sunucular GÖRÜNÜR ama seçilemez (v1 yalnız Linux).
//
// Keşif SALT OKUNURDUR ve tek seferde en çok 10 sunucuda koşar. Uygulamanın Linux sunucusu
// 10 veya daha azsa hepsi kendiliğinden keşfe girer; fazlaysa kullanıcı en çok 10 tane
// işaretler. İşlem (restart/stop/start) burada DEĞİL, keşiften sonra TEK JVM üzerinde seçilir.
import React, { useEffect, useMemo, useState } from "react";
import { MagnifyingGlassIcon, ExclamationTriangleIcon, ArrowPathIcon, ArrowLeftIcon } from "@heroicons/react/24/outline";
import { opsxWasApi, type WasHost } from "@/api/opsxApi";
import { WasEnvBadge } from "./WasBadges";

export interface WasAppSelection {
  app: string;
  // undefined: uygulamanın TÜM Linux sunucuları (en çok 10) — sunucu kendisi çözer.
  hosts?: string[];
  hostInfo: WasHost[];
}

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

const WasHostPicker: React.FC<{
  app: string;
  busy?: boolean;
  onBack: () => void;
  onSubmit: (v: WasAppSelection) => void;
}> = ({ app, busy, onBack, onSubmit }) => {
  const [hosts, setHosts] = useState<WasHost[] | null>(null);
  const [max, setMax] = useState(10);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    opsxWasApi
      .getHosts(app)
      .then((r) => {
        if (cancelled) return;
        if (!r.ok) {
          setError(r.message || "Sunucu listesi alınamadı.");
          return;
        }
        setHosts(r.hosts || []);
        if (r.maxDiscoverHosts) setMax(r.maxDiscoverHosts);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(errText(e));
      });
    return () => {
      cancelled = true;
    };
  }, [app]);

  const selectable = useMemo(() => (hosts || []).filter((h) => h.selectable), [hosts]);
  const needPick = selectable.length > max;

  function toggle(host: string) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(host)) next.delete(host);
      else if (next.size < max) next.add(host);
      return next;
    });
  }

  function submit() {
    onSubmit({ app, hosts: needPick ? [...picked] : undefined, hostInfo: hosts || [] });
  }

  if (error) {
    return (
      <div className="space-y-3">
        <div className="flex items-start gap-2 bg-red-50 border border-red-100 rounded-xl p-4 text-sm text-red-700">
          <ExclamationTriangleIcon className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
        <button onClick={onBack} className="btn-secondary w-full text-sm">
          <ArrowLeftIcon className="w-4 h-4" />
          Başka uygulama seç
        </button>
      </div>
    );
  }

  if (!hosts) {
    return (
      <div className="py-8 text-center">
        <ArrowPathIcon className="w-5 h-5 mx-auto animate-spin text-[var(--text-muted)]" />
        <p className="mt-2 text-sm text-[var(--text-muted)]">Envanterdeki sunucular okunuyor…</p>
      </div>
    );
  }

  const canStart = !busy && selectable.length > 0 && (!needPick || picked.size > 0);

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm text-[var(--text-secondary)]">
            Uygulama (JVM): <span className="font-mono text-[var(--text-primary)]">{app}</span>
          </p>
          <p className="mt-1 text-xs text-[var(--text-muted)]">
            {needPick
              ? `Bu uygulamanın ${selectable.length} Linux sunucusu var; tek keşifte en çok ${max} sunucu taranır — taranacak sunucuları işaretleyin.`
              : "Keşif aşağıdaki Linux sunucularının hepsinde salt okunur olarak çalışır; hiçbir şey değiştirilmez."}
          </p>
        </div>
        <button
          onClick={onBack}
          disabled={busy}
          className="text-[11px] px-2 py-1 rounded-lg border border-[var(--border)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] disabled:opacity-50 flex-shrink-0"
        >
          Başka uygulama
        </button>
      </div>

      {selectable.length === 0 && (
        <div className="flex items-start gap-2 bg-amber-50 border border-amber-100 rounded-xl p-3 text-xs text-amber-800">
          <ExclamationTriangleIcon className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
          <span>Bu uygulamanın keşfedilebilecek Linux sunucusu yok (AIX ve diğerleri bu sürümde desteklenmiyor).</span>
        </div>
      )}

      <div className="max-h-72 overflow-y-auto border border-[var(--border)] rounded-xl divide-y divide-[var(--border)]">
        {hosts.map((h) => (
          <div
            key={h.host}
            className={`flex items-center gap-2 px-3 py-2 ${h.selectable ? "" : "opacity-60"}`}
            title={h.selectable ? undefined : h.reason}
          >
            {needPick && (
              <input
                type="checkbox"
                aria-label={`${h.host} keşfe dahil`}
                checked={picked.has(h.host)}
                onChange={() => toggle(h.host)}
                disabled={busy || !h.selectable || (!picked.has(h.host) && picked.size >= max)}
                className="rounded"
              />
            )}
            <span className="flex-1 text-sm font-mono text-[var(--text-primary)] truncate" title={h.host}>
              {h.host}
            </span>
            <WasEnvBadge env={h.env} />
            <span className="text-[10px] text-[var(--text-muted)] flex-shrink-0">
              {h.os || "OS ?"}
              {h.wasVersion ? ` · WAS ${h.wasVersion}` : ""}
            </span>
            {!h.selectable && <span className="text-[10px] text-[var(--text-muted)] flex-shrink-0">desteklenmiyor</span>}
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between gap-3">
        <span className="text-xs text-[var(--text-muted)]">
          {needPick ? `${picked.size} / ${max} sunucu seçildi` : `${selectable.length} sunucu taranacak`}
        </span>
        <button onClick={submit} disabled={!canStart} className="btn-primary">
          Canlı keşfi başlat
        </button>
      </div>
    </div>
  );
};

const WasAppSearchStep: React.FC<{ busy?: boolean; onSubmit: (v: WasAppSelection) => void }> = ({ busy, onSubmit }) => {
  const [search, setSearch] = useState("");
  const [apps, setApps] = useState<string[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [app, setApp] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setLoading(true);
      setError(null);
      opsxWasApi
        .searchApps(search)
        .then((r) => {
          if (cancelled) return;
          if (!r.ok) {
            setApps([]);
            setError(r.message || "Uygulama listesi alınamadı.");
            return;
          }
          setApps(r.apps || []);
          setTruncated(!!r.truncated);
        })
        .catch((e: unknown) => {
          if (!cancelled) setError(errText(e));
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [search]);

  if (app) {
    return <WasHostPicker app={app} busy={busy} onBack={() => setApp(null)} onSubmit={onSubmit} />;
  }

  return (
    <div className="space-y-3">
      <div className="relative">
        <MagnifyingGlassIcon className="w-4 h-4 text-[var(--text-muted)] absolute left-3 top-1/2 -translate-y-1/2" />
        <input
          autoFocus
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="WAS uygulama (JVM) adı ara..."
          className="w-full pl-9 pr-3 py-2.5 text-sm border border-[var(--border)] rounded-xl outline-none focus:border-[var(--accent)] focus:ring-1 focus:ring-[var(--accent)] transition"
        />
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {truncated && (
        <p className="text-xs text-amber-700">Liste kırpıldı — aradığınız uygulamayı görmüyorsanız aramayı daraltın.</p>
      )}
      <div className="max-h-72 overflow-y-auto border border-[var(--border)] rounded-xl divide-y divide-[var(--border)]">
        {loading ? (
          <p className="text-sm text-[var(--text-muted)] text-center py-6">Aranıyor...</p>
        ) : apps.length === 0 ? (
          <p className="text-sm text-[var(--text-muted)] text-center py-6">Sonuç yok.</p>
        ) : (
          apps.map((a) => (
            <button
              key={a}
              onClick={() => setApp(a)}
              disabled={busy}
              className="w-full text-left px-4 py-2.5 text-sm font-mono text-[var(--text-primary)] hover:bg-[var(--bg-elevated)] transition-colors active:bg-[var(--bg-elevated)] disabled:opacity-50 disabled:pointer-events-none"
            >
              {a}
            </button>
          ))
        )}
      </div>
    </div>
  );
};

export default WasAppSearchStep;
