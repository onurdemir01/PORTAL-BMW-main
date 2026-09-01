// src/components/scalex/steps/NamespaceStep.tsx — namespace seçimi (tek).
//
// Liste `ocp-catalog`tan gelir: dbo.Openshift_Inventory ∪ tarama önbelleği. Yetki
// kısıtıyla düşen namespace'ler GİZLENİR ama SAYISI söylenir — "neden göremiyorum?"
// sorusu cevapsız kalmasın.
import React, { useEffect, useMemo, useState } from "react";
import { ExclamationTriangleIcon, MagnifyingGlassIcon } from "@heroicons/react/24/outline";
import { scalexApi, type ScaleXNamespaceList } from "@/api/scalexApi";

interface Props {
  env: string; tenant: string; clusters: string[]; busy: boolean;
  initial?: string;
  onSubmit: (namespace: string) => void;
}

// Sistem namespace'leri listenin SONUNA — kullanıcı %99 kendi uygulamasını arıyor.
const SYSTEM_RE = /^(openshift|kube)(-|$)/;

const NamespaceStep: React.FC<Props> = ({ env, tenant, clusters, busy, initial, onSubmit }) => {
  const [data, setData] = useState<ScaleXNamespaceList | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState(initial || "");

  useEffect(() => {
    let alive = true;
    setLoading(true);
    scalexApi.namespaces(env, tenant, clusters)
      .then((r) => { if (!alive) return; if (r.ok) setData(r); else setError(r.message || "Namespace listesi alınamadı."); })
      .catch((e) => alive && setError(e.message))
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [env, tenant, clusters.join(",")]);

  const list = useMemo(() => {
    const items = data?.items || [];
    const q = query.trim().toLowerCase();
    const filtered = q ? items.filter((n) => n.toLowerCase().includes(q)) : items;
    return [...filtered].sort((a, b) => {
      const sa = SYSTEM_RE.test(a) ? 1 : 0;
      const sb = SYSTEM_RE.test(b) ? 1 : 0;
      return sa !== sb ? sa - sb : a.localeCompare(b, "tr");
    });
  }, [data, query]);

  if (loading) return <div className="py-8 text-center text-sm text-[var(--text-muted)]">Namespace listesi yükleniyor…</div>;
  if (error) {
    return (
      <div className="flex items-start gap-2 bg-red-50 border border-red-100 rounded-xl p-3 text-sm text-red-700">
        <ExclamationTriangleIcon aria-hidden="true" className="w-4 h-4 flex-shrink-0 mt-0.5" /><span>{error}</span>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="relative">
        <MagnifyingGlassIcon aria-hidden="true" className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
        <input
          type="text" value={query} onChange={(e) => setQuery(e.target.value)} disabled={busy}
          placeholder="Namespace ara…" aria-label="Namespace ara"
          className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-[var(--border)] bg-[var(--bg-surface)]
                     text-[var(--text-primary)] placeholder-[var(--text-muted)]
                     focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
        />
      </div>

      <div className="rounded-xl border border-[var(--border)] divide-y divide-[var(--border-subtle)] max-h-80 overflow-y-auto">
        {list.map((ns) => {
          const count = data?.counts?.[ns];
          return (
            <label key={ns} className="flex items-center justify-between gap-3 px-3 py-2 text-sm cursor-pointer hover:bg-[var(--bg-inset)]">
              <span className="flex items-center gap-2.5 min-w-0">
                <input type="radio" name="scalex-ns" disabled={busy} checked={picked === ns} onChange={() => setPicked(ns)} />
                <span className="font-mono truncate text-[var(--text-primary)]" title={ns}>{ns}</span>
              </span>
              <span className="text-xs text-[var(--text-muted)] whitespace-nowrap">
                {typeof count === "number" ? `${count} uygulama` : "uygulama kaydı yok"}
              </span>
            </label>
          );
        })}
        {list.length === 0 && (
          <p className="px-3 py-8 text-center text-sm text-[var(--text-muted)]">
            {query ? "Aramanla eşleşen namespace yok." : "Bu cluster grubunda namespace bulunamadı."}
          </p>
        )}
      </div>

      {!!data?.hiddenCount && (
        <p className="text-xs text-[var(--text-muted)]">
          {data.hiddenCount} namespace yetki kısıtı nedeniyle listede görünmüyor.
        </p>
      )}

      <div className="flex justify-end border-t border-[var(--border)] pt-4">
        <button type="button" className="btn-primary" disabled={busy || !picked} onClick={() => onSubmit(picked)}>
          Devam
        </button>
      </div>
    </div>
  );
};

export default NamespaceStep;
