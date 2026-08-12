// src/components/opsx/steps/OcpTargetStep.tsx — Openshift hedefi: ortam → cluster (tenant)
// + bir veya daha fazla namespace/uygulama çifti.
//
// NEDEN İKİ SEVİYE (env + oc_cluster): gerçek üretim playbook'ları (bmw_openshift_jobs/
// application_rollout.yaml) hedefi `hosts: "{{ oc_cluster }}_{{ env }}"` ile çözüyor — bu
// grup, o tenant/ortama ait TÜM gerçek cluster'ları (ör. ark_prod → gbocpprod1, gbocpprod2,
// gbocpprod4, ...) kapsıyor. Yani tek tek cluster_name seçimi YOK artık — LogX'teki üçüncü
// kademe (cluster checkbox listesi) burada bilinçli olarak KALDIRILDI.
//
// NAMESPACE: kullanıcı biliyorsa serbest yazar; bilmiyorsa Openshift_Inventory'den (günlük
// scheduled job ile beslenen envanter) o env/tenant'ta GÖRÜLMÜŞ namespace'ler listelenir.
//
// UYGULAMA: namespace seçilir seçilmez otomatik fetch edilir, SADECE dropdown'dan seçilir
// (serbest yazım yok) — arama filtre olarak kullanılabilir ama liste dışı değer kabul edilmez.
//
// 2026-08-12: namespace düz bir `<select>`, uygulama ise "ayrı arama kutusu + ayrı liste"
// idi; yüzlerce namespace'te aranan şey bulunamıyordu. İkisi de tek kutulu combobox'a
// (common/SearchableSelect) geçti — namespace'te serbest yazım KORUNDU (`allowFreeText`),
// uygulamada liste dışı değer hâlâ kabul edilmiyor. Biriken çiftler de ekran içi listeden
// üstteki ortak sepete (common/SelectedItemsBar) taşındı.
//
// ÇOKLU İŞLEM: kullanıcı birden fazla namespace/uygulama çiftini "Ekle" ile listeye
// biriktirebilir; tek POST'ta oc_input = "ns1,app1;ns2,app2" olarak sunucuya gider.
import React, { useEffect, useState } from "react";
import { PlusIcon } from "@heroicons/react/24/outline";
import { opsxApi, type OpsxOcpPair } from "@/api/opsxApi";
import SearchableSelect from "@/components/common/SearchableSelect";
import SelectedItemsBar from "@/components/common/SelectedItemsBar";

const OcpTargetStep: React.FC<{
  busy?: boolean;
  onSubmit: (v: { env: string; tenant: string; pairs: OpsxOcpPair[] }) => void;
}> = ({ busy, onSubmit }) => {
  const [tree, setTree] = useState<Record<string, Record<string, string[]>>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [env, setEnv] = useState("");
  const [tenant, setTenant] = useState("");

  const [namespaceOptions, setNamespaceOptions] = useState<string[]>([]);
  const [namespace, setNamespace] = useState("");

  const [appOptions, setAppOptions] = useState<string[]>([]);
  const [appsLoading, setAppsLoading] = useState(false);
  const [application, setApplication] = useState("");

  const [pairs, setPairs] = useState<OpsxOcpPair[]>([]);

  useEffect(() => {
    opsxApi.getClusters()
      .then((r) => setTree(r.tree))
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  }, []);

  // Bu tenant/ortam grubundaki GERÇEK cluster'lar. Seçtirmiyoruz (AWX `limit`i yutuyor —
  // bkz. server/opsx/index.cjs'teki not), ama kullanıcı neyin hedefleneceğini görmeli.
  const envs = Object.keys(tree).sort();
  const tenants = env ? Object.keys(tree[env] || {}).sort() : [];
  const groupClusters = env && tenant ? (tree[env]?.[tenant] || []) : [];

  // Ortam/cluster değişince namespace listesi yeniden çekilir; önceki secimler sıfırlanır.
  useEffect(() => {
    setNamespace(""); setNamespaceOptions([]); setApplication(""); setAppOptions([]);
    if (!env || !tenant) return;
    opsxApi.getOcpNamespaces(env, tenant)
      .then((r) => setNamespaceOptions(r.namespaces || []))
      .catch(() => setNamespaceOptions([]));
  }, [env, tenant]);

  // Namespace seçilince uygulama dropdown'u otomatik dolar.
  useEffect(() => {
    setApplication(""); setAppOptions([]);
    if (!env || !tenant || !namespace.trim()) return;
    setAppsLoading(true);
    opsxApi.getOcpApps(env, tenant, namespace.trim())
      .then((r) => setAppOptions(r.apps || []))
      .catch(() => setAppOptions([]))
      .finally(() => setAppsLoading(false));
  }, [env, tenant, namespace]);

  const canAddPair = namespace.trim() && application.trim();

  function addPair() {
    if (!canAddPair) return;
    const ns = namespace.trim();
    const app = application.trim();
    if (pairs.some((p) => p.namespace === ns && p.application === app)) return;
    setPairs((prev) => [...prev, { namespace: ns, application: app }]);
    setNamespace(""); setApplication(""); setAppOptions([]);
  }

  const ready = env && tenant && pairs.length > 0;

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
      {/* Sepet ÜSTTE: kullanıcı ekle → seç → ekle döngüsünde ne topladığını her an görür
          (LogX ile aynı desen). Boşken hiç render edilmez. */}
      <SelectedItemsBar
        title="Eklenen işlemler"
        submitLabel="Devam Et"
        busy={busy}
        groups={[...new Map(
          pairs.map((p) => [p.namespace, pairs.filter((x) => x.namespace === p.namespace)])
        ).entries()].map(([ns, list]) => ({
          title: ns,
          items: list.map((p) => ({ id: `${p.namespace}/${p.application}`, label: p.application })),
        }))}
        onRemove={(id) => setPairs((prev) => prev.filter((p) => `${p.namespace}/${p.application}` !== id))}
        onClear={() => setPairs([])}
        onSubmit={() => onSubmit({ env, tenant, pairs })}
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
          <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">Cluster</label>
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

      {env && tenant && groupClusters.length > 0 && (
        /* Cluster SEÇTİRMİYORUZ (bkz. dosya başı notu: AWX `limit`i yutuyor) ama kullanıcı
           neyin hedefleneceğini görmeli — sessizce "hepsi" demek, üretimde tam olarak bu
           yanılgıyı yaratmıştı. */
        <p className="text-[11px] text-[var(--text-muted)]">
          Hedeflenecek cluster'lar:{" "}
          <span className="font-mono text-[var(--text-secondary)]">{groupClusters.join(", ")}</span>
          {groupClusters.length > 1 && " — grubun tamamı hedeflenir."}
        </p>
      )}

      {env && tenant && (
        <div className="space-y-3 border border-[var(--border)] rounded-xl p-3">
          <div>
            <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">Namespace</label>
            {/* Serbest yazım korunuyor: envanterde henüz görünmeyen yeni bir namespace
                yazılabilsin diye (eski "Listeden seç / Yaz" ikili düğmesinin yerini
                combobox'ın kendisi aldı). */}
            <SearchableSelect
              id="opsx-ns"
              options={namespaceOptions}
              value={namespace}
              onChange={setNamespace}
              allowFreeText
              placeholder="Namespace ara veya yaz…"
              emptyText="Bu cluster için envanterde henüz namespace kaydı yok — bildiğinizi yazabilirsiniz."
            />
            {namespaceOptions.length === 0 && (
              <p className="mt-1 text-[11px] text-[var(--text-muted)]">
                Bu cluster için envanterde henüz namespace kaydı yok — bildiğiniz namespace'i yazabilirsiniz.
              </p>
            )}
          </div>

          {namespace.trim() && (
            <div>
              <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">Uygulama Adı</label>
              {appOptions.length === 0 && !appsLoading ? (
                <p className="text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
                  Bu namespace için envanterde uygulama bulunamadı.
                </p>
              ) : (
                /* Uygulama listesi KAPALI uçlu: liste dışı değer kabul edilmez, combobox
                   yalnızca süzer (allowFreeText verilmez). */
                <SearchableSelect
                  id="opsx-app"
                  options={appOptions}
                  value={application}
                  onChange={setApplication}
                  loading={appsLoading}
                  placeholder="Uygulama ara…"
                />
              )}
            </div>
          )}

          <button
            onClick={addPair}
            disabled={!canAddPair}
            className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-dashed border-[var(--border)] text-[var(--text-secondary)] hover:border-[var(--accent)] hover:text-[var(--accent)] transition-colors disabled:opacity-40 disabled:pointer-events-none"
          >
            <PlusIcon className="w-3.5 h-3.5" />
            Listeye Ekle
          </button>
        </div>
      )}

      <button
        onClick={() => onSubmit({ env, tenant, pairs })}
        disabled={!ready || busy}
        className="btn-primary w-full"
      >
        Devam Et
      </button>
    </div>
  );
};

export default OcpTargetStep;
