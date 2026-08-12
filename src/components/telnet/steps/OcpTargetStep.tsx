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
//
// 2026-08-12 (kullanıcı isteği): (1) namespace düz `<select>` yerine tek kutulu combobox
// (serbest yazım KORUNDU), (2) biriken namespace'ler ekran içi listeden üstteki ortak
// sepete taşındı, (3) CLUSTER SEÇİMİ geri geldi — ama eski "bastion çözümleme" biçiminde
// DEĞİL: seçilen gerçek cluster adları sunucuda AWX'in kendi `limit` alanına konur ve
// Ansible bunu `{{ cluster }}_{{ env }}` grubuyla kesiştirir (OpsX restart'ta kanıtlanmış
// mekanizma, commit ea686eb). Dış playbook'a dokunulmaz. Varsayılan tümü seçili =
// bugünkü davranış.
import React, { useEffect, useState } from "react";
import { PlusIcon } from "@heroicons/react/24/outline";
import { telnetApi } from "@/api/telnetApi";
import SearchableSelect from "@/components/common/SearchableSelect";
import SelectedItemsBar from "@/components/common/SelectedItemsBar";
import ClusterPickStep from "@/components/common/ClusterPickStep";

const OcpTargetStep: React.FC<{
  busy?: boolean;
  onSubmit: (v: { env: string; tenant: string; namespaces: string[]; clusters: string[] }) => void;
}> = ({ busy, onSubmit }) => {
  const [tree, setTree] = useState<Record<string, Record<string, string[]>>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [env, setEnv] = useState("");
  const [tenant, setTenant] = useState("");

  const [namespaceOptions, setNamespaceOptions] = useState<string[]>([]);
  const [namespace, setNamespace] = useState("");

  const [namespaces, setNamespaces] = useState<string[]>([]);
  // Hedeflenecek gerçek cluster'lar. Varsayılan: grubun TÜMÜ (kısıtlama yok).
  const [selectedClusters, setSelectedClusters] = useState<string[]>([]);

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

  // Tenant değişince cluster seçimi grubun TÜMÜ olarak sıfırlanır — kullanıcı hiçbir şey
  // yapmazsa iş bugünküyle aynı yere gider.
  const groupClusters = env && tenant ? (tree[env]?.[tenant] || []) : [];
  useEffect(() => {
    setSelectedClusters(groupClusters);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [env, tenant, groupClusters.join(",")]);

  function addNamespace() {
    const ns = namespace.trim();
    if (!ns || namespaces.includes(ns)) return;
    setNamespaces((prev) => [...prev, ns]);
    setNamespace("");
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
      {/* Sepet ÜSTTE (LogX/OpsX ile aynı desen): kullanıcı ne topladığını her an görür. */}
      <SelectedItemsBar
        title="Eklenen namespace'ler"
        submitLabel="Devam Et"
        busy={busy}
        groups={[{ items: namespaces.map((n) => ({ id: n, label: n })) }]}
        onRemove={(id) => setNamespaces((prev) => prev.filter((n) => n !== id))}
        onClear={() => setNamespaces([])}
        onSubmit={() => onSubmit({ env, tenant, namespaces, clusters: selectedClusters })}
      />

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
            <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">Namespace</label>
            {/* Serbest yazım korunuyor: envanterde henüz görünmeyen bir namespace de
                yazılabilsin (eski "Listeden seç / Yaz" ikilisinin yerini combobox aldı). */}
            <SearchableSelect
              id="telnet-ns"
              options={namespaceOptions}
              value={namespace}
              onChange={setNamespace}
              allowFreeText
              placeholder="Namespace ara veya yaz…"
              emptyText="Bu tenant için envanterde henüz namespace kaydı yok — bildiğinizi yazabilirsiniz."
            />
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

      {/* Cluster adımı YALNIZCA birden fazla gerçek cluster varsa gösterilir — tek
          cluster'lı bir tenant'ta boş bir karar ekranı ve fazladan bir tık olurdu. */}
      {env && tenant && groupClusters.length > 1 && (
        <div className="border border-[var(--border)] rounded-xl p-3">
          <ClusterPickStep
            clusters={groupClusters}
            selected={selectedClusters}
            onChange={setSelectedClusters}
            hint="Telnet testi hangi cluster'larda çalışsın?"
          />
        </div>
      )}

      <button
        onClick={() => onSubmit({ env, tenant, namespaces, clusters: selectedClusters })}
        disabled={!ready || busy || (groupClusters.length > 1 && selectedClusters.length === 0)}
        className="btn-primary w-full"
      >
        Devam Et
      </button>
    </div>
  );
};

export default OcpTargetStep;
