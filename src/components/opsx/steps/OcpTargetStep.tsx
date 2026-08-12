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
// ÇOKLU İŞLEM: kullanıcı birden fazla namespace/uygulama çiftini "Ekle" ile listeye
// biriktirebilir; tek POST'ta oc_input = "ns1,app1;ns2,app2" olarak sunucuya gider.
import React, { useEffect, useState } from "react";
import { PlusIcon, XMarkIcon } from "@heroicons/react/24/outline";
import { opsxApi, type OpsxOcpPair } from "@/api/opsxApi";
import FilterableList from "@/components/common/FilterableList";

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
  const [namespaceMode, setNamespaceMode] = useState<"list" | "free">("list");
  const [namespace, setNamespace] = useState("");
  // "Yaz" (serbest metin) kipinde `namespace` düz bir <input>'tan gelir ve HER TUŞ
  // VURUŞUNDA değişir. Bunu doğrudan "Uygulama Adı" bloğunun görünürlüğüne VE
  // getOcpApps çağrısına bağlamak, kullanıcı daha namespace'i yazarken her harfte o
  // bloğun belirip API'nin tekrar tekrar çağrılmasına yol açıyordu — ekran yazarken
  // zıplıyor, "alt alta bozulmuş" görünüyordu ("Listeden seç" kipinde FilterableList
  // değeri yalnızca TIKLAMADA commit ettiği için bu sorun yoktu). Kullanıcı yazmayı
  // KISA BİR SÜRE durdurunca (debounce) namespace burada "yerleşir".
  const [settledNamespace, setSettledNamespace] = useState("");
  // "Listeden seç" kipinde bir namespace'e TIKLANINCA true olur: liste (arama kutusu +
  // ~10 satırlık kaydırılabilir kutu) kapanıp tek satırlık "seçili: X · Değiştir" görünümüne
  // döner. Bu OLMADAN namespace VE uygulama listeleri aynı anda tam açık kalıyor, ikisi de
  // kendi arama kutusu+uzun listesiyle alt alta yığılıp ekranı gereksiz uzatıyordu.
  const [namespaceLocked, setNamespaceLocked] = useState(false);

  const [appOptions, setAppOptions] = useState<string[]>([]);
  const [appsLoading, setAppsLoading] = useState(false);
  const [application, setApplication] = useState("");
  // Uygulama listesi için AYNI "seç → kapan" deseni — namespace'in yanına ikinci bir
  // uzun liste daha eklenmesin.
  const [applicationLocked, setApplicationLocked] = useState(false);

  const [pairs, setPairs] = useState<OpsxOcpPair[]>([]);

  useEffect(() => {
    opsxApi.getClusters()
      .then((r) => setTree(r.tree))
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  }, []);

  const envs = Object.keys(tree).sort();
  const tenants = env ? Object.keys(tree[env] || {}).sort() : [];
  // Bu tenant/ortam grubundaki GERÇEK cluster'lar. Seçtirmiyoruz — iş her zaman grubun
  // tamamına gider (AWX `limit` denendi, sessizce yutuldu; bkz. server/opsx/index.cjs).
  // Ama kullanıcı neyin hedefleneceğini GÖRMELİ: sessizce "hepsi" demek, seçim yaptığını
  // sanma yanılgısının kaynağıydı.
  const groupClusters = env && tenant ? (tree[env]?.[tenant] || []) : [];

  // Ortam/cluster değişince namespace listesi yeniden çekilir; önceki secimler sıfırlanır.
  useEffect(() => {
    setNamespace(""); setSettledNamespace(""); setNamespaceLocked(false);
    setNamespaceOptions([]); setApplication(""); setAppOptions([]); setApplicationLocked(false);
    if (!env || !tenant) return;
    opsxApi.getOcpNamespaces(env, tenant)
      .then((r) => setNamespaceOptions(r.namespaces || []))
      .catch(() => setNamespaceOptions([]));
  }, [env, tenant]);

  // namespace listeden seçilince (tıklama, anında) YA DA serbest yazımda kısa bir süre
  // durunca (debounce) "yerleşir".
  useEffect(() => {
    const t = window.setTimeout(() => setSettledNamespace(namespace.trim()), 350);
    return () => window.clearTimeout(t);
  }, [namespace]);

  // Namespace yerleşince uygulama dropdown'u otomatik dolar.
  useEffect(() => {
    setApplication(""); setAppOptions([]); setApplicationLocked(false);
    if (!env || !tenant || !settledNamespace) return;
    setAppsLoading(true);
    opsxApi.getOcpApps(env, tenant, settledNamespace)
      .then((r) => setAppOptions(r.apps || []))
      .catch(() => setAppOptions([]))
      .finally(() => setAppsLoading(false));
  }, [env, tenant, settledNamespace]);

  const canAddPair = namespace.trim() && application.trim();

  function addPair() {
    if (!canAddPair) return;
    const ns = namespace.trim();
    const app = application.trim();
    if (pairs.some((p) => p.namespace === ns && p.application === app)) return;
    setPairs((prev) => [...prev, { namespace: ns, application: app }]);
    setNamespace(""); setSettledNamespace(""); setNamespaceLocked(false);
    setApplication(""); setAppOptions([]); setApplicationLocked(false);
  }

  function removePair(i: number) {
    setPairs((prev) => prev.filter((_, idx) => idx !== i));
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
        <p className="text-[11px] text-[var(--text-muted)]">
          Hedeflenecek cluster'lar:{" "}
          <span className="font-mono text-[var(--text-secondary)]">{groupClusters.join(", ")}</span>
          {groupClusters.length > 1 && " — grubun tamamı hedeflenir."}
        </p>
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
                    onClick={() => { setNamespaceMode("free"); setNamespaceLocked(false); }}
                    className={`px-2 py-0.5 rounded-full border ${namespaceMode === "free" ? "bg-[var(--accent)] text-white border-[var(--accent)]" : "border-[var(--border)] text-[var(--text-muted)]"}`}
                  >
                    Yaz
                  </button>
                </div>
              )}
            </div>

            {namespaceMode === "list" && namespaceOptions.length > 0 ? (
              namespaceLocked && namespace.trim() ? (
                /* Seçildi: uzun liste kapanır, ekran tek satırlık bir öze döner — "Uygulama
                   Adı" bloğuyla ikisi birden tam açıkken oluşan "alt alta yığılma" görünümü
                   böyle önlenir. */
                <div className="flex items-center justify-between gap-2 px-3 py-2 border border-[var(--border)] rounded-xl bg-[var(--bg-elevated)]">
                  <span className="text-sm font-mono text-[var(--text-primary)] truncate">{namespace}</span>
                  <button
                    onClick={() => setNamespaceLocked(false)}
                    className="text-xs text-[var(--accent)] hover:underline flex-shrink-0"
                  >
                    Değiştir
                  </button>
                </div>
              ) : (
                /* Arama + vurgulama + daha uzun liste. "Yaz" kipi ve serbest yazım kaçış
                   yolu OLDUĞU GİBİ duruyor — yalnızca liste kipi zenginleşti. */
                <FilterableList
                  options={namespaceOptions}
                  value={namespace}
                  onChange={(v) => { setNamespace(v); setNamespaceLocked(true); }}
                  placeholder="Namespace ara…"
                />
              )
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
                Bu cluster için envanterde henüz namespace kaydı yok — bildiğiniz namespace'i yazabilirsiniz.
              </p>
            )}
          </div>

          {settledNamespace && (
            <div>
              <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">Uygulama Adı</label>
              {appsLoading ? (
                <div className="text-xs text-[var(--text-muted)] py-2">Uygulamalar yükleniyor…</div>
              ) : appOptions.length === 0 ? (
                <p className="text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
                  Bu namespace için envanterde uygulama bulunamadı.
                </p>
              ) : applicationLocked && application.trim() ? (
                <div className="flex items-center justify-between gap-2 px-3 py-2 border border-[var(--border)] rounded-xl bg-[var(--bg-elevated)]">
                  <span className="text-sm font-mono text-[var(--text-primary)] truncate">{application}</span>
                  <button
                    onClick={() => setApplicationLocked(false)}
                    className="text-xs text-[var(--accent)] hover:underline flex-shrink-0"
                  >
                    Değiştir
                  </button>
                </div>
              ) : (
                /* Eskiden ayrı bir arama kutusu + `<select size>` vardı: eşleşen metin
                   vurgulanamıyor ve liste 3-6 satırla sınırlı kalıyordu. */
                <FilterableList
                  options={appOptions}
                  value={application}
                  onChange={(v) => { setApplication(v); setApplicationLocked(true); }}
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

      {pairs.length > 0 && (
        <div>
          <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">
            Eklenen İşlemler ({pairs.length})
          </label>
          <div className="space-y-1">
            {pairs.map((p, i) => (
              <div key={`${p.namespace}-${p.application}`} className="flex items-center justify-between gap-2 px-3 py-1.5 border border-[var(--border)] rounded-lg">
                <span className="text-sm font-mono text-[var(--text-primary)]">{p.namespace} / {p.application}</span>
                <button onClick={() => removePair(i)} disabled={busy} className="text-[var(--text-muted)] hover:text-red-600">
                  <XMarkIcon className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
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
