// src/components/scalex/steps/ScopeStep.tsx — ortam → tenant → cluster (çoklu seçim).
//
// LogX'in ClusterSelectStep deseni: env çipleri → tenant çipleri → cluster checkbox'ları.
// Fark: burada seçim ÇOKLU ve seçim değiştikçe "kaç hedef" sayacı canlı güncelleniyor —
// kullanıcı bir sonraki adıma geçmeden kapsamı görüyor.
import React, { useEffect, useMemo, useState } from "react";
import { ExclamationTriangleIcon, ServerStackIcon } from "@heroicons/react/24/outline";
import { scalexApi, type ScaleXClusterTree } from "@/api/scalexApi";

interface Props {
  busy: boolean;
  initial?: { env: string; tenant: string; clusters: string[] };
  onSubmit: (v: { env: string; tenant: string; clusters: string[] }) => void;
}

const chip = (active: boolean) =>
  `px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
    active
      ? "bg-[var(--accent)] text-[var(--text-on-accent)] border-[var(--accent)]"
      : "bg-[var(--bg-surface)] text-[var(--text-secondary)] border-[var(--border)] hover:border-[var(--border-strong)]"
  }`;

const ScopeStep: React.FC<Props> = ({ busy, initial, onSubmit }) => {
  const [tree, setTree] = useState<ScaleXClusterTree>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [env, setEnv] = useState(initial?.env || "");
  const [tenant, setTenant] = useState(initial?.tenant || "");
  const [selected, setSelected] = useState<string[]>(initial?.clusters || []);

  useEffect(() => {
    let alive = true;
    scalexApi.clusters()
      .then((r) => { if (!alive) return; if (r.ok) setTree(r.tree || {}); else setError(r.message || "Cluster listesi alınamadı."); })
      .catch((e) => alive && setError(e.message))
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, []);

  const envs = useMemo(() => Object.keys(tree).sort(), [tree]);
  const tenants = useMemo(() => (env ? Object.keys(tree[env] || {}).sort() : []), [tree, env]);
  const clusters = useMemo(() => (env && tenant ? [...(tree[env]?.[tenant] || [])].sort() : []), [tree, env, tenant]);

  // PROD ayrı bir görsel ağırlık taşır — kullanıcı hangi ortamda olduğunu kaza eseri
  // öğrenmemeli. Ama seçimi ENGELLEMEZ; yalnızca görünür kılar.
  const isProd = ["prod", "production"].includes(env.toLowerCase());

  if (loading) return <div className="py-8 text-center text-sm text-[var(--text-muted)]">Cluster listesi yükleniyor…</div>;
  if (error) {
    return (
      <div className="flex items-start gap-2 bg-red-50 border border-red-100 rounded-xl p-3 text-sm text-red-700">
        <ExclamationTriangleIcon aria-hidden="true" className="w-4 h-4 flex-shrink-0 mt-0.5" />
        <span>{error}</span>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div>
        <p className="text-xs font-medium text-[var(--text-muted)] mb-2">Ortam</p>
        <div className="flex flex-wrap gap-2">
          {envs.map((e) => (
            // Secim yalnizca renkle anlatiliyordu; ekran okuyucu hangi ortamin secili
            // oldugunu anlayamiyordu (bkz. OperationStep'teki ayni duzeltme).
            <button key={e} type="button" disabled={busy} className={chip(env === e)}
              aria-pressed={env === e}
              onClick={() => { setEnv(e); setTenant(""); setSelected([]); }}>
              {e}
            </button>
          ))}
        </div>
      </div>

      {env && (
        <div>
          <p className="text-xs font-medium text-[var(--text-muted)] mb-2">Tenant / İş Birimi</p>
          <div className="flex flex-wrap gap-2">
            {tenants.map((t) => (
              <button key={t} type="button" disabled={busy} className={chip(tenant === t)}
                aria-pressed={tenant === t}
                onClick={() => { setTenant(t); setSelected([]); }}>
                {t}
              </button>
            ))}
          </div>
        </div>
      )}

      {env && tenant && (
        <div>
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-medium text-[var(--text-muted)]">Cluster ({clusters.length})</p>
            <div className="flex gap-2">
              <button type="button" disabled={busy} onClick={() => setSelected(clusters)}
                className="text-xs text-[var(--accent)] hover:underline">Tümünü seç</button>
              <button type="button" disabled={busy} onClick={() => setSelected([])}
                className="text-xs text-[var(--text-muted)] hover:underline">Temizle</button>
            </div>
          </div>
          <div className="rounded-xl border border-[var(--border)] divide-y divide-[var(--border-subtle)] max-h-72 overflow-y-auto">
            {clusters.map((c) => (
              <label key={c} className="flex items-center gap-2.5 px-3 py-2 text-sm cursor-pointer hover:bg-[var(--bg-inset)]">
                <input type="checkbox" disabled={busy} checked={selected.includes(c)}
                  onChange={(ev) => setSelected((prev) => (ev.target.checked ? [...prev, c] : prev.filter((x) => x !== c)))} />
                <span className="font-mono text-[var(--text-primary)]">{c}</span>
              </label>
            ))}
            {clusters.length === 0 && (
              <p className="px-3 py-6 text-center text-sm text-[var(--text-muted)]">Bu grupta aktif cluster yok.</p>
            )}
          </div>
        </div>
      )}

      {isProd && selected.length > 0 && (
        <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
          <ExclamationTriangleIcon aria-hidden="true" className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <span>
            <strong>Prod ortamı.</strong> Gerçek bir değişiklik uygularsan OCO penceresi
            kontrol edilecek ve SMART kaydı açılacak. Birden fazla cluster seçtiysen ikinci
            kişi onayı da istenir.
          </span>
        </div>
      )}

      <div className="flex items-center justify-between border-t border-[var(--border)] pt-4">
        <span className="inline-flex items-center gap-1.5 text-xs text-[var(--text-muted)]">
          <ServerStackIcon aria-hidden="true" className="w-4 h-4" />
          {selected.length} cluster seçildi
        </span>
        <button type="button" className="btn-primary" disabled={busy || !selected.length}
          onClick={() => onSubmit({ env, tenant, clusters: selected })}>
          Devam
        </button>
      </div>
    </div>
  );
};

export default ScopeStep;
