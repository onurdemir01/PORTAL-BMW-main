// src/components/telnet/steps/OcpTargetStep.tsx — Openshift hedefi: ortam → tenant/iş
// birimi → bir veya daha fazla namespace. OpsX'in OcpTargetStep'inden İKİ FARKI: (1)
// "Uygulama Adı" alanı YOK (kullanıcı isteği — Telnet testi için gerekli değil), (2)
// ayrı bir "Cluster" (checkbox listesi) adımı YOK — kullanıcı kararıyla kaldırıldı,
// ortam+tenant seçimi sonrası doğrudan namespace seçimine geçilir (bastion/terminal_host
// çözümlemesi backend'de de yok artık, bkz. server/telnet/index.cjs).
//
// NAMESPACE: OpsX'in OcpTargetStep'iyle BİREBİR aynı UX — envanterden (Openshift_Inventory)
// GÖRÜLMÜŞ namespace'ler dropdown'da listelenir, bilinmiyorsa serbest yazılabilir.
// "Ekle" ile listeye BİRİKTİRİLİR (birden fazla namespace seçilebilir) — OpsX'in
// namespace/uygulama çifti biriktirme deseninin aynısı, sadece uygulama alanı yok.
import React, { useEffect, useState } from "react";
import { PlusIcon, XMarkIcon } from "@heroicons/react/24/outline";
import { telnetApi } from "@/api/telnetApi";
import FilterableList from "@/components/common/FilterableList";

const OcpTargetStep: React.FC<{
  busy?: boolean;
  onSubmit: (v: { env: string; tenant: string; namespaces: string[] }) => void;
}> = ({ busy, onSubmit }) => {
  const [tree, setTree] = useState<Record<string, Record<string, string[]>>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [env, setEnv] = useState("");
  const [tenant, setTenant] = useState("");

  const [namespaceOptions, setNamespaceOptions] = useState<string[]>([]);
  const [namespaceMode, setNamespaceMode] = useState<"list" | "free">("list");
  const [namespace, setNamespace] = useState("");

  const [namespaces, setNamespaces] = useState<string[]>([]);

  useEffect(() => {
    telnetApi.getClusters()
      .then((r) => setTree(r.tree))
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  }, []);

  const envs = Object.keys(tree).sort();
  const tenants = env ? Object.keys(tree[env] || {}).sort() : [];

  // Ortam/tenant değişince namespace listesi yeniden çekilir; önceki seçimler sıfırlanır.
  useEffect(() => {
    setNamespace(""); setNamespaceOptions([]); setNamespaces([]);
    if (!env || !tenant) return;
    telnetApi.getOcpNamespaces(env, tenant)
      .then((r) => setNamespaceOptions(r.namespaces || []))
      .catch(() => setNamespaceOptions([]));
  }, [env, tenant]);

  function addNamespace() {
    const ns = namespace.trim();
    if (!ns || namespaces.includes(ns)) return;
    setNamespaces((prev) => [...prev, ns]);
    setNamespace("");
  }

  function removeNamespace(i: number) {
    setNamespaces((prev) => prev.filter((_, idx) => idx !== i));
  }

  const ready = env && tenant && namespaces.length > 0;

  if (loading) return <div className="py-8 text-center text-sm text-[var(--text-muted)]">Yükleniyor...</div>;
  if (error) return <div className="bg-red-50 border border-red-100 rounded-xl p-4 text-sm text-red-700">{error}</div>;
  if (envs.length === 0) {
    return (
      <div className="bg-amber-50 border border-amber-100 rounded-xl p-4 text-sm text-amber-800">
        Henüz hiç cluster tanımlanmamış — admin panelinden "LogX v2 Yapılandırma" sekmesinden eklenmeli.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">Ortam</label>
        <div className="flex flex-wrap gap-1.5">
          {envs.map((e) => (
            <button
              key={e}
              onClick={() => { setEnv(e); setTenant(""); }}
              className={`px-3 py-1.5 text-xs rounded-full border transition-colors ${env === e ? "bg-[var(--accent)] text-white border-[var(--accent)]" : "border-[var(--border)] text-[var(--text-secondary)] hover:border-[var(--text-muted)]"}`}
            >
              {e}
            </button>
          ))}
        </div>
      </div>

      {env && (
        <div>
          <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">Tenant / İş Birimi</label>
          <div className="flex flex-wrap gap-1.5">
            {tenants.map((t) => (
              <button
                key={t}
                onClick={() => setTenant(t)}
                className={`px-3 py-1.5 text-xs rounded-full border transition-colors ${tenant === t ? "bg-[var(--accent)] text-white border-[var(--accent)]" : "border-[var(--border)] text-[var(--text-secondary)] hover:border-[var(--text-muted)]"}`}
              >
                {t}
              </button>
            ))}
          </div>
        </div>
      )}

      {env && tenant && (
        <div className="space-y-3 border border-[var(--border)] rounded-xl p-3">
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="block text-xs font-medium text-[var(--text-secondary)]">Namespace</label>
              {namespaceOptions.length > 0 && (
                <div className="flex gap-1 text-[10px]">
                  <button
                    onClick={() => setNamespaceMode("list")}
                    className={`px-2 py-0.5 rounded-full border ${namespaceMode === "list" ? "bg-[var(--accent)] text-white border-[var(--accent)]" : "border-[var(--border)] text-[var(--text-muted)]"}`}
                  >
                    Listeden seç
                  </button>
                  <button
                    onClick={() => setNamespaceMode("free")}
                    className={`px-2 py-0.5 rounded-full border ${namespaceMode === "free" ? "bg-[var(--accent)] text-white border-[var(--accent)]" : "border-[var(--border)] text-[var(--text-muted)]"}`}
                  >
                    Yaz
                  </button>
                </div>
              )}
            </div>

            {namespaceMode === "list" && namespaceOptions.length > 0 ? (
              /* Arama + vurgulama + daha uzun liste (OpsX ile aynı bileşen). "Yaz" kipi
                 ve serbest yazım kaçış yolu OLDUĞU GİBİ duruyor. */
              <FilterableList
                options={namespaceOptions}
                value={namespace}
                onChange={setNamespace}
                placeholder="Namespace ara…"
              />
            ) : (
              <input
                value={namespace}
                onChange={(e) => setNamespace(e.target.value)}
                placeholder="das-trading-management-qa"
                className="w-full px-3 py-2 text-sm font-mono border border-[var(--border)] rounded-xl outline-none focus:border-[var(--accent)] focus:ring-1 focus:ring-[var(--accent)] transition"
              />
            )}
            {namespaceOptions.length === 0 && (
              <p className="mt-1 text-[11px] text-[var(--text-muted)]">
                Bu tenant için envanterde henüz namespace kaydı yok — bildiğiniz namespace'i yazabilirsiniz.
              </p>
            )}
          </div>

          <button
            onClick={addNamespace}
            disabled={!namespace.trim() || namespaces.includes(namespace.trim())}
            className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-dashed border-[var(--border)] text-[var(--text-secondary)] hover:border-[var(--accent)] hover:text-[var(--accent)] transition-colors disabled:opacity-40 disabled:pointer-events-none"
          >
            <PlusIcon className="w-3.5 h-3.5" />
            Listeye Ekle
          </button>
        </div>
      )}

      {namespaces.length > 0 && (
        <div>
          <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">
            Eklenen Namespace'ler ({namespaces.length})
          </label>
          <div className="space-y-1">
            {namespaces.map((n, i) => (
              <div key={n} className="flex items-center justify-between gap-2 px-3 py-1.5 border border-[var(--border)] rounded-lg">
                <span className="text-sm font-mono text-[var(--text-primary)]">{n}</span>
                <button onClick={() => removeNamespace(i)} disabled={busy} className="text-[var(--text-muted)] hover:text-red-600">
                  <XMarkIcon className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <button
        onClick={() => onSubmit({ env, tenant, namespaces })}
        disabled={!ready || busy}
        className="btn-primary w-full"
      >
        Devam Et
      </button>
    </div>
  );
};

export default OcpTargetStep;
