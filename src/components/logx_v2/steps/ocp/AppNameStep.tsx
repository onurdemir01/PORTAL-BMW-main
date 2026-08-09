// src/components/logx_v2/steps/ocp/AppNameStep.tsx — `oc get pods | grep -i <app>`
// semantiğine karşılık gelen uygulama seçimi. Eşleşen TÜM pod'ların logları backend
// tarafından otomatik toplanır (kullanıcı kararı — ayrı bir pod-seçim adımı yok).
//
// Kullanıcı uygulama adını EZBERDEN bilmek zorunda değil: namespace içindeki objeler
// paylaşımlı önbellekten listelenir. Önbellek boşsa "Bu namespace'i tara" ile canlı keşif
// tetiklenir. Serbest metin girişi HER ZAMAN durur — listede olmayan/yeni bir uygulamayı
// yazabilmek geriye uyum ve kaçış yoludur.
import React, { useEffect, useMemo, useState } from "react";
import { MagnifyingGlassIcon, MagnifyingGlassCircleIcon } from "@heroicons/react/24/outline";
import { logxV2Api, type OcpAppItem } from "@/api/logxV2Api";
import CacheBadge from "../../shared/CacheBadge";

interface Props {
  env?: string;
  tenant?: string;
  clusters?: string[];
  namespace?: string;
  /** Değiştiğinde önbellek yeniden okunur (keşif job'ı bittiğinde üst bileşen artırır). */
  reloadToken?: number;
  onSubmit: (appName: string) => void;
  /** Canlı uygulama keşfini tetikler (AWX job'ı). */
  onDiscover?: () => void;
  busy?: boolean;
}

// Aynı uygulama birden çok cluster'da ve birden çok obje tipinde (Deployment + Service +
// Route) çıkar. Kullanıcı için anlamlı birim UYGULAMA ADI'dır — tipleri altında toplarız.
export function groupApps(items: OcpAppItem[]): { name: string; kinds: string[]; replicas: number | null }[] {
  const byName = new Map<string, { name: string; kinds: Set<string>; replicas: number | null }>();
  for (const it of items || []) {
    const name = String(it?.name || "").trim();
    if (!name) continue;
    if (!byName.has(name)) byName.set(name, { name, kinds: new Set(), replicas: null });
    const g = byName.get(name)!;
    if (it.kind) g.kinds.add(it.kind);
    // Replica sayısı yalnız iş yüklerinde anlamlı; ilk dolu değeri koru.
    if (g.replicas === null && typeof it.replicas === "number") g.replicas = it.replicas;
  }
  return [...byName.values()]
    .map((g) => ({ name: g.name, kinds: [...g.kinds].sort(), replicas: g.replicas }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

const AppNameStep: React.FC<Props> = ({ env, tenant, clusters, namespace, reloadToken, onSubmit, onDiscover, busy }) => {
  const [appName, setAppName] = useState("");
  const [items, setItems] = useState<OcpAppItem[]>([]);
  const [cache, setCache] = useState<{ fetchedAt: string | null; stale: boolean } | null>(null);
  const [loadingCache, setLoadingCache] = useState(false);
  // "Kayit yok" ile "yetkin yok" AYRI seyler. Eskiden ikisi de ayni bos ekrani gosteriyordu;
  // kullanici "tara" deyip ancak o zaman 403 goruyordu.
  const [denied, setDenied] = useState(false);
  const [failed, setFailed] = useState<string[]>([]);

  const clusterKey = (clusters || []).join(",");

  // BİRİNCİL kaynak: dbo.Openshift_Inventory (portaldan bağımsız, zamanlanmış Ansible
  // job'ı besler — bkz. server/logx/v2/ocp-inventory.cjs başlığı). Tek senkron DB
  // okuması, AWX job'ı tetiklenmez. `onDiscover` (aşağıda) hâlâ canlı keşif fallback'i
  // sunar — envanterde henüz taranmamış YENİ bir namespace için kaçış yolu.
  useEffect(() => {
    if (!env || !tenant || !namespace || !clusterKey) return;
    let cancelled = false;
    setLoadingCache(true);
    (async () => {
      try {
        const r = await logxV2Api.inventoryApps(env, tenant, clusterKey.split(","), namespace).catch(() => null);
        if (cancelled) return;
        if (!r || !r.cached) {
          setItems([]);
          setFailed([]);
          setDenied(false);
          setCache(null);
          return;
        }
        setItems(r.items || []);
        setFailed([]);
        setDenied(false);
        setCache({ fetchedAt: r.fetchedAt, stale: r.stale });
      } finally {
        if (!cancelled) setLoadingCache(false);
      }
    })();
    return () => { cancelled = true; };
  }, [env, tenant, clusterKey, namespace, reloadToken]);

  const groups = useMemo(() => groupApps(items), [items]);
  const query = appName.trim().toLowerCase();
  const filtered = query ? groups.filter((g) => g.name.toLowerCase().includes(query)) : groups;

  return (
    <div className="space-y-3">
      {failed.length > 0 && (
        <div className="bg-amber-50 border border-amber-100 rounded-xl p-3 text-xs text-amber-800">
          Bu liste eksik olabilir — şu cluster'lardan yanıt alınamadı: {failed.join(", ")}
        </div>
      )}
      {cache && <CacheBadge fetchedAt={cache.fetchedAt} stale={cache.stale} onRediscover={onDiscover} busy={busy} actionLabel="Yeniden tara" />}

      <p className="text-sm text-[var(--text-secondary)]">
        <span className="font-mono text-[var(--text-primary)]">{namespace}</span> içindeki uygulamayı seçin
        {" — "}eşleşen TÜM pod'ların logları toplanacaktır.
      </p>

      <div className="relative">
        <MagnifyingGlassIcon className="w-4 h-4 text-[var(--text-muted)] absolute left-3 top-1/2 -translate-y-1/2" />
        <input
          autoFocus
          value={appName}
          onChange={(e) => setAppName(e.target.value)}
          placeholder="Uygulama adı yazın veya listeden seçin"
          className="w-full pl-9 pr-3 py-2.5 text-sm border border-[var(--border)] rounded-xl outline-none focus:border-[var(--accent)] focus:ring-1 focus:ring-[var(--accent)] transition font-mono"
        />
      </div>

      {groups.length > 0 ? (
        <div className="max-h-56 overflow-y-auto border border-[var(--border)] rounded-xl divide-y divide-[var(--border)]">
          {filtered.length === 0 ? (
            <p className="text-xs text-[var(--text-muted)] text-center py-4">
              Listede eşleşme yok — yazdığınız adla yine de devam edebilirsiniz.
            </p>
          ) : (
            filtered.map((g) => (
              <button
                key={g.name}
                onClick={() => setAppName(g.name)}
                className={`w-full text-left px-4 py-2 hover:bg-[var(--bg-elevated)] transition-colors ${
                  g.name === appName.trim() ? "bg-[var(--bg-elevated)]" : ""
                }`}
              >
                <span className="text-sm font-mono text-[var(--text-primary)]">{g.name}</span>
                <span className="ml-2 text-xs text-[var(--text-muted)]">
                  {g.kinds.join(", ")}
                  {g.replicas !== null && ` • ${g.replicas} replika`}
                </span>
              </button>
            ))
          )}
        </div>
      ) : (
        !loadingCache && (
          <div className="rounded-xl border border-[var(--border)] p-4 text-center space-y-2">
            <p className="text-xs text-[var(--text-muted)]">
              {denied
                ? "Bu namespace'in uygulama listesini görme yetkiniz yok. Uygulama adını biliyorsanız yukarıya yazabilirsiniz."
                : "Bu namespace için kayıtlı uygulama listesi yok. Adını biliyorsanız yukarıya yazın."}
            </p>
            {onDiscover && !denied && (
              <button
                onClick={onDiscover}
                disabled={busy}
                title="Sunuculara bağlanıp namespace içindeki uygulamaları listeler"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-[var(--border)] text-[var(--text-secondary)] hover:border-[var(--accent)] hover:text-[var(--text-primary)] transition-colors active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none"
              >
                <MagnifyingGlassCircleIcon aria-hidden="true" className="w-4 h-4" />
                {busy ? "Başlatılıyor…" : "Bu namespace'i tara"}
              </button>
            )}
          </div>
        )
      )}

      <button
        onClick={() => onSubmit(appName.trim())}
        disabled={!appName.trim() || busy}
        className="btn-primary w-full"
      >
        {busy ? "Başlatılıyor…" : "Logları Getir"}
      </button>
    </div>
  );
};

export default AppNameStep;
