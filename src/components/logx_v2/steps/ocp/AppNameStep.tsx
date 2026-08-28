// src/components/logx_v2/steps/ocp/AppNameStep.tsx — namespace içeriğinden TOPLU seçim.
//
// NE DEĞİŞTİ (2026-08-10, kullanıcı geri bildirimi): keşif playbook'u
// `deployment,deploymentconfig,statefulset,daemonset,cronjob,pod,service,route` tiplerinin
// HEPSİNİ tek düz listeye döküyordu; kullanıcı `coexistence-app-v3` (Deployment),
// `coexistence-app-v3-8-822mh` (Pod) ve `coexistence-app-v3` (Route) satırlarını yan yana
// görüyordu. Ayrıca bir namespace'ten üç uygulama almak üç kez ekrana girip çıkmak
// demekti. Artık liste ÜÇ role ayrılıyor ve seçim ÇOKLU.
//
// Log her zaman UYGULAMA ADIYLA çekilir: playbook `oc get pods` çıktısında adı substring
// olarak arar, eşleşen TÜM pod'ların logunu tek arşivde toplar. Bu yüzden tek bir pod adı
// göndermek de geçerlidir — o zaman yalnızca o pod gelir (pod bölümünün var olma sebebi).
//
// Serbest metin girişi HER ZAMAN durur: listede olmayan/yeni bir uygulama adı yazılabilir.
import React, { useEffect, useMemo, useState } from "react";
import {
  MagnifyingGlassIcon, MagnifyingGlassCircleIcon, ChevronRightIcon, PlusIcon,
} from "@heroicons/react/24/outline";
import { logxV2Api, type OcpAppItem } from "@/api/logxV2Api";
import CacheBadge from "../../shared/CacheBadge";

interface Props {
  /** Devam butonunun metni. Varsayılan "Seçilenleri Listeye Ekle". */
  submitLabel?: string;
  env?: string;
  tenant?: string;
  clusters?: string[];
  namespace?: string;
  /** Değiştiğinde önbellek yeniden okunur (keşif job'ı bittiğinde üst bileşen artırır). */
  reloadToken?: number;
  /** Sepette kalan yer. Sınır aşılacaksa kullanıcı SUNUCUDAN 400 almadan önce görür. */
  remainingSlots?: number;
  /** Seçilen adlar tek seferde eklenir; ekleyen ekran namespace seçimine döner. */
  onSubmit: (appNames: string[]) => void;
  /** Canlı uygulama keşfini tetikler (AWX job'ı). */
  onDiscover?: () => void;
  busy?: boolean;
}

// ── Rol sınıflandırması ────────────────────────────────────────────────────────────
// `Unknown`, envanterden (dbo.Openshift_Inventory) gelen kayıtların tipidir: o tablo
// yalnızca UYGULAMA ADI tutar, obje tipi canlı taramadan gelir. Bilinmeyen yeni bir tip
// çıkarsa "uygulama" sayılır — listeden düşüp kaybolmasın.
export type OcpRole = "app" | "pod" | "network";

const POD_KINDS = new Set(["pod"]);
const NETWORK_KINDS = new Set(["service", "route", "ingress"]);

export function roleOfKind(kind: string): OcpRole {
  const k = String(kind || "").toLowerCase();
  if (POD_KINDS.has(k)) return "pod";
  if (NETWORK_KINDS.has(k)) return "network";
  return "app";
}

export interface AppGroup {
  name: string;
  kinds: string[];
  replicas: number | null;
  role: OcpRole;
}

// Aynı ad birden çok tipte gelebilir (Deployment + Service + Route). Kullanıcı için
// anlamlı birim ADdır — tipleri altında toplarız. Rol, en "güçlü" tipten gelir:
// bir ad hem Deployment hem Route ise o bir UYGULAMADIR; ağ objesi olarak ikinci kez
// listelenmesi kullanıcıyı şaşırtırdı.
export function groupApps(items: OcpAppItem[]): AppGroup[] {
  const byName = new Map<string, { name: string; kinds: Set<string>; replicas: number | null; roles: Set<OcpRole> }>();
  for (const it of items || []) {
    const name = String(it?.name || "").trim();
    if (!name) continue;
    if (!byName.has(name)) byName.set(name, { name, kinds: new Set(), replicas: null, roles: new Set() });
    const g = byName.get(name)!;
    if (it.kind) g.kinds.add(it.kind);
    g.roles.add(roleOfKind(it.kind));
    // Replica sayısı yalnız iş yüklerinde anlamlı; ilk dolu değeri koru.
    if (g.replicas === null && typeof it.replicas === "number") g.replicas = it.replicas;
  }
  return [...byName.values()]
    .map((g) => ({
      name: g.name,
      kinds: [...g.kinds].sort(),
      replicas: g.replicas,
      role: (g.roles.has("app") ? "app" : g.roles.has("pod") ? "pod" : "network") as OcpRole,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

// AWX template'i launch'a hazır mı? Hazır DEĞİLSE sebebi (kullanıcıya gösterilecek
// metnin anahtarı) döner, hazırsa null.
//
// NEDEN VAR (2026-08-10, üretim): `BMW Portal - LogX_OCP_App_Discovery` template'inde
// Variables > "Prompt on launch" kapalıydı. O kutu kapalıyken AWX, portalın gönderdiği
// extra_vars'ı SESSİZCE yok sayar; job başlar ve playbook boş girdiyle düşer. Portal
// bunu launch öncesi yakalıyordu ama hata 503 döndüğü için ters-proxy gövdeyi SPA ile
// değiştiriyor ve kullanıcı gerçek sebebi hiç görmüyordu. Artık job HİÇ açılmıyor.
async function checkReadiness(): Promise<string | null> {
  try {
    const out = await logxV2Api.playbookReadiness();
    const row = (out.rows || []).find((r) => r.keyName === "logx_ocp_app_discovery");
    // Bilinmiyor/hazır → engelleme yok (fail-open: meşru bir işi metadata eksikliği
    // yüzünden durdurmak, çözdüğü problemden büyük olurdu).
    return row && row.ready === false ? (row.reason || "unknown") : null;
  } catch {
    return null;
  }
}

const NOT_READY_TEXT: Record<string, string> = {
  prompt_on_launch_disabled:
    'AWX\'te uygulama keşfi job template\'i üzerinde Variables > "Prompt on launch" kapalı. ' +
    "O kutu kapalıyken AWX, portalın gönderdiği değişkenleri sessizce yok sayar ve tarama " +
    "boş girdiyle çalışıp hata verir — bu yüzden iş hiç başlatılmadı. Bir yönetici kutuyu " +
    "işaretleyip kaydettikten sonra tarama çalışacak.",
  template_missing:
    "Uygulama keşfi için AWX job template'i tanımlı değil. Yönetici Admin > Ansible " +
    "Yapılandırma ekranından template'i eşleştirmeli.",
  disabled: "Uygulama keşfi playbook'u yönetici tarafından devre dışı bırakılmış.",
  unknown: "Uygulama keşfi şu anda çalıştırılamıyor. Yöneticiye bildirin.",
};

// Tarih → "10 Ağu 12:34" (rozetlerde yer kaplamasın diye kısa).
function shortDate(value: string | null): string {
  if (!value) return "";
  const d = new Date(value);
  return Number.isFinite(d.getTime())
    ? d.toLocaleString("tr-TR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })
    : "";
}

const SECTION_META: Record<OcpRole, { title: string; hint: string; selectable: boolean }> = {
  app: {
    title: "Uygulamalar",
    hint: "Seçilen her uygulamanın eşleşen TÜM pod'larının logu tek arşivde toplanır.",
    selectable: true,
  },
  pod: {
    title: "Tek pod seç (ileri düzey)",
    hint: "Yalnızca tek bir pod'un logu gerekiyorsa. Uygulamayı seçerseniz zaten tüm pod'ları gelir.",
    selectable: true,
  },
  network: {
    title: "Ağ objeleri",
    hint: "Service/Route log üretmez — yalnızca namespace içeriğini göstermek için listelenir.",
    selectable: false,
  },
};

const AppNameStep: React.FC<Props> = ({
  env, tenant, clusters, namespace, reloadToken, remainingSlots, onSubmit, onDiscover, busy, submitLabel,
}) => {
  const [search, setSearch] = useState("");
  const [items, setItems] = useState<OcpAppItem[]>([]);
  const [cache, setCache] = useState<{ fetchedAt: string | null; stale: boolean; source?: string | null } | null>(null);
  // Ad → kaynak. Envanterde olmayan (kullanıcı taramasıyla gelen) uygulamalar rozetlenir;
  // kullanıcı listede bir adı NEDEN gördüğünü/göremediğini anlasın.
  const [sources, setSources] = useState<Record<string, string>>({});
  // Ad → hangi cluster'larda var. Seçili cluster'ların HEPSİNDE varsa rozet gösterilmez
  // (gürültü olur); yalnız bazılarında varsa o cluster adları yazılır. Pod adları
  // cluster'a göre farklı olduğu için bu ayrım özellikle pod bölümünde işe yarar.
  const [membership, setMembership] = useState<Record<string, string[]>>({});
  // Otomatik taramanın aynı seçim için tekrar tetiklenmesini engeller.
  const autoScanRef = React.useRef<string | null>(null);
  const [loadingCache, setLoadingCache] = useState(false);
  // "Kayit yok" ile "yetkin yok" AYRI seyler. Eskiden ikisi de ayni bos ekrani gosteriyordu;
  // kullanici "tara" deyip ancak o zaman 403 goruyordu.
  const [denied, setDenied] = useState(false);
  const [failed, setFailed] = useState<string[]>([]);
  // Tarandı ama BOŞ çıktı: "hiç taranmadı"dan ayrı bir durum (bkz. ocp_app_scan_log).
  // Bu bilgi olmadan sihirbaz aynı namespace'e her girişte yeni bir AWX job'ı açıyordu.
  const [scannedAt, setScannedAt] = useState<string | null>(null);
  // AWX template'i launch'a hazır değilse (ör. "Prompt on launch" kapalı) job HİÇ
  // başlatılmaz — AWX gönderilen değişkenleri sessizce yutacağı için sonuç garanti hata.
  const [notReady, setNotReady] = useState<string | null>(null);
  // Çoklu seçim: sepete TEK SEFERDE eklenecek adlar.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // Pod ve ağ bölümleri varsayılan KAPALI: liste onlarla birlikte okunamaz hâle geliyordu.
  const [openRoles, setOpenRoles] = useState<Record<OcpRole, boolean>>({ app: true, pod: false, network: false });
  // Cluster süzgeci — yalnızca birden çok cluster seçiliyken anlamlı.
  const [clusterFilter, setClusterFilter] = useState<string | null>(null);

  const clusterKey = (clusters || []).join(",");
  const clusterList = useMemo(() => clusters || [], [clusters]);
  const multiCluster = clusterList.length > 1;

  // BİRİNCİL kaynak: dbo.Openshift_Inventory (portaldan bağımsız, zamanlanmış Ansible
  // job'ı besler — bkz. server/logx/v2/ocp-inventory.cjs başlığı). Tek senkron DB
  // okuması, AWX job'ı tetiklenmez. `onDiscover` (aşağıda) hâlâ canlı keşif fallback'i
  // sunar — envanterde henüz taranmamış YENİ bir namespace için kaçış yolu.
  useEffect(() => {
    if (!env || !tenant || !namespace || !clusterKey) return;
    let cancelled = false;
    setLoadingCache(true);
    setSelected(new Set());
    (async () => {
      try {
        const r = await logxV2Api.inventoryApps(env, tenant, clusterKey.split(","), namespace).catch(() => null);
        if (cancelled) return;
        if (!r || !r.cached) {
          setItems([]);
          setFailed([]);
          setDenied(false);
          setCache(null);
          setSources({});
          setMembership({});
          setScannedAt(r?.scannedAt ?? null);
          // ZATEN TARANMIŞ VE BOŞ ÇIKMIŞSA tekrar tarama: namespace gerçekten boş.
          // Kullanıcı isterse elle tazeler. Bu kontrol olmadan boş bir namespace her
          // girişte (ve her kullanıcı için) ~1 dk'lık bir AWX job'ı açıyordu.
          if (r?.scannedEmpty) return;
          // KAYIT YOKSA KULLANICIYA SORMA, TARA. Aynı (cluster, namespace) için yalnız BİR
          // kez — ref olmadan her render yeni bir AWX job'ı açabilirdi. Kullanıcı yine de
          // uygulama adını elle yazıp devam edebilir (kaçış yolu korunur).
          const key = `${clusterKey}|${namespace}`;
          if (onDiscover && autoScanRef.current !== key) {
            autoScanRef.current = key;
            // BAŞARISIZ OLACAĞI BELLİ BİR JOB'I HİÇ AÇMA (bkz. checkReadiness başlığı).
            const blocked = await checkReadiness();
            if (cancelled) return;
            if (blocked) { setNotReady(blocked); return; }
            onDiscover();
          }
          return;
        }
        setItems(r.items || []);
        setFailed([]);
        setDenied(false);
        setScannedAt(r.scannedAt ?? null);
        setCache({ fetchedAt: r.fetchedAt, stale: r.stale, source: r.source });
        setSources(r.sources || {});
        setMembership(r.clusters || {});
      } finally {
        if (!cancelled) setLoadingCache(false);
      }
    })();
    return () => { cancelled = true; };
  }, [env, tenant, clusterKey, namespace, reloadToken]);

  // Elle tetiklenen taramalar da aynı kapıdan geçer: hazır değilse job açmak yerine
  // kullanıcıya ne yapılması gerektiğini söyler.
  async function handleDiscover() {
    if (!onDiscover) return;
    const blocked = await checkReadiness();
    if (blocked) { setNotReady(blocked); return; }
    setNotReady(null);
    onDiscover();
  }

  const groups = useMemo(() => groupApps(items), [items]);
  const query = search.trim().toLowerCase();

  // Rol bölümleri. Ağ objeleri arasında, adı bir UYGULAMAYLA aynı olanlar gösterilmez —
  // aynı ad iki bölümde birden çıkınca kullanıcı hangisini seçeceğini bilemiyordu.
  const sections = useMemo(() => {
    const appNames = new Set(groups.filter((g) => g.role === "app").map((g) => g.name));
    const keep = (g: AppGroup) => !(g.role === "network" && appNames.has(g.name));
    const inCluster = (name: string) => {
      if (!clusterFilter) return true;
      const owners = membership[name];
      // Üyelik bilgisi YOKSA gizleme: bilgisizlik, yokluk değildir.
      return !owners || owners.includes(clusterFilter);
    };
    const matches = (g: AppGroup) => (!query || g.name.toLowerCase().includes(query)) && inCluster(g.name);

    return (["app", "pod", "network"] as OcpRole[]).map((role) => {
      const all = groups.filter((g) => g.role === role && keep(g));
      return { role, rows: all.filter(matches), total: all.length };
    });
  }, [groups, query, clusterFilter, membership]);

  const hasAnyRow = sections.some((s) => s.total > 0);
  // Sınır: sepette kalan yer kadar seçilebilir. Sunucu da aynı sınırı uygular
  // (server/logx/v2/ocp.cjs MAX_TARGETS); buradaki amaç 400'e düşmeden söylemek.
  const limit = typeof remainingSlots === "number" ? remainingSlots : Infinity;
  const atLimit = selected.size >= limit;

  function toggle(name: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else if (next.size < limit) next.add(name);
      return next;
    });
  }

  // "Görünenleri seç" ARAMA/SÜZGEÇ sonucuna uygulanır: gizli satırları da seçmek
  // kullanıcıyı şaşırtırdı (legacy sunucu seçimiyle aynı kural).
  function toggleAllVisible(names: string[]) {
    const allOn = names.length > 0 && names.every((n) => selected.has(n));
    setSelected((prev) => {
      const next = new Set(prev);
      for (const n of names) {
        if (allOn) next.delete(n);
        else if (next.size < limit) next.add(n);
      }
      return next;
    });
  }

  // Listede olmayan bir ad: serbest metin kaçış yolu (yeni uygulama, envanter gecikmesi).
  const exactExists = groups.some((g) => g.name.toLowerCase() === query);
  const canAddFreeText = query.length > 0 && !exactExists && !selected.has(search.trim());

  return (
    <div className="space-y-3">
      {notReady && (
        <div className="bg-amber-50 border border-amber-100 rounded-xl p-3 text-xs text-amber-900 space-y-1">
          <p className="font-semibold">Uygulama taraması başlatılamıyor</p>
          <p>{NOT_READY_TEXT[notReady] || NOT_READY_TEXT.unknown}</p>
          <p className="text-amber-800">
            Bu arada uygulama adını biliyorsanız aşağıya yazıp ekleyebilirsiniz.
          </p>
        </div>
      )}
      {failed.length > 0 && (
        <div className="bg-amber-50 border border-amber-100 rounded-xl p-3 text-xs text-amber-800">
          Bu liste eksik olabilir — şu cluster'lardan yanıt alınamadı: {failed.join(", ")}
        </div>
      )}
      {cache && (
        <CacheBadge
          fetchedAt={cache.fetchedAt}
          stale={cache.stale}
          source={cache.source}
          discoveredCount={Object.values(sources).filter((v) => v === "discovery").length}
          onRediscover={handleDiscover}
          busy={busy}
          actionLabel="Yeniden tara"
        />
      )}

      <p className="text-sm text-[var(--text-secondary)]">
        <span className="font-mono text-[var(--text-primary)]">{namespace}</span> içinden
        {" "}<strong>birden fazla</strong> uygulama seçebilirsiniz — her biri ayrı bir arşiv olur.
      </p>

      <div className="relative">
        <MagnifyingGlassIcon className="w-4 h-4 text-[var(--text-muted)] absolute left-3 top-1/2 -translate-y-1/2" />
        <input
          autoFocus
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Ara veya listede olmayan bir uygulama adı yazın"
          className="w-full pl-9 pr-3 py-2.5 text-sm border border-[var(--border)] rounded-xl outline-none focus:border-[var(--accent)] focus:ring-1 focus:ring-[var(--accent)] transition font-mono"
        />
      </div>

      {canAddFreeText && (
        <button
          onClick={() => { toggle(search.trim()); setSearch(""); }}
          disabled={atLimit}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-dashed border-[var(--accent)] text-[var(--accent)] hover:bg-[var(--bg-elevated)] transition-colors disabled:opacity-50 disabled:pointer-events-none"
        >
          <PlusIcon aria-hidden="true" className="w-4 h-4" />
          Listede yok — <span className="font-mono">{search.trim()}</span> adını seçime ekle
        </button>
      )}

      {/* Cluster süzgeci: tek cluster seçiliyken hiç render edilmez (gereksiz gürültü). */}
      {multiCluster && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-[var(--text-muted)]">Cluster:</span>
          {[null, ...clusterList].map((c) => (
            <button
              key={c ?? "__all__"}
              onClick={() => setClusterFilter(c)}
              className={`px-2.5 py-1 text-xs rounded-full border transition-colors font-mono ${
                clusterFilter === c
                  ? "bg-[var(--accent)] text-white border-[var(--accent)]"
                  : "border-[var(--border)] text-[var(--text-secondary)] hover:border-[var(--text-muted)]"
              }`}
            >
              {c ?? "Tümü"}
            </button>
          ))}
        </div>
      )}

      {loadingCache && !hasAnyRow && (
        <p className="text-xs text-[var(--text-muted)] text-center py-4">Liste yükleniyor…</p>
      )}

      {hasAnyRow ? (
        <div className="space-y-2">
          {sections.map(({ role, rows, total }) => {
            if (total === 0) return null;
            const meta = SECTION_META[role];
            // Arama/süzgeç varken eşleşme olan bölüm KENDİLİĞİNDEN açılır: kullanıcı
            // aradığı pod'u bulmak için ayrıca tıklamak zorunda kalmasın.
            const open = openRoles[role] || (query.length > 0 && rows.length > 0);
            const selectedHere = rows.filter((r) => selected.has(r.name)).length;
            return (
              <div key={role} className="border border-[var(--border)] rounded-xl">
                <button
                  onClick={() => setOpenRoles((prev) => ({ ...prev, [role]: !prev[role] }))}
                  aria-expanded={open}
                  className="w-full flex items-center gap-2 p-3 text-left"
                >
                  <ChevronRightIcon
                    aria-hidden="true"
                    className={`w-4 h-4 text-[var(--text-muted)] flex-shrink-0 transition-transform ${open ? "rotate-90" : ""}`}
                  />
                  <span className="text-sm font-semibold text-[var(--text-primary)]">{meta.title}</span>
                  <span className="text-xs text-[var(--text-muted)]">
                    {rows.length}
                    {rows.length !== total && ` / ${total}`}
                    {selectedHere > 0 ? ` · ${selectedHere} seçili` : ""}
                  </span>
                </button>

                {open && (
                  <div className="px-3 pb-3 space-y-1.5">
                    <p className="text-[11px] text-[var(--text-muted)]">{meta.hint}</p>
                    {meta.selectable && rows.length > 1 && (
                      <button
                        onClick={() => toggleAllVisible(rows.map((r) => r.name))}
                        className="text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] underline underline-offset-2"
                      >
                        Görünenleri seç ({rows.length})
                      </button>
                    )}
                    <div className="max-h-56 overflow-y-auto divide-y divide-[var(--border)] border border-[var(--border)] rounded-lg">
                      {rows.map((g) => {
                        const owners = membership[g.name];
                        // Rozet YALNIZCA fark varsa: her cluster'da olan adı rozetlemek
                        // listeyi gürültüye boğardı.
                        const partial = multiCluster && owners && owners.length < clusterList.length;
                        const checked = selected.has(g.name);
                        const disabled = !meta.selectable || (!checked && atLimit);
                        return (
                          <label
                            key={g.name}
                            className={`flex items-center gap-2 px-3 py-2 ${
                              meta.selectable ? "cursor-pointer hover:bg-[var(--bg-elevated)]" : "opacity-70"
                            } ${disabled && meta.selectable ? "opacity-50" : ""}`}
                          >
                            {meta.selectable && (
                              <input
                                type="checkbox"
                                checked={checked}
                                disabled={disabled}
                                onChange={() => toggle(g.name)}
                                className="rounded"
                              />
                            )}
                            <span className="text-sm font-mono text-[var(--text-primary)] truncate flex-1" title={g.name}>{g.name}</span>
                            {g.kinds.filter((k) => k !== "Unknown").map((k) => (
                              <span
                                key={k}
                                className="text-[10px] px-1.5 py-0.5 rounded-full border border-[var(--border)] text-[var(--text-muted)] flex-shrink-0"
                              >
                                {k}
                              </span>
                            ))}
                            {g.replicas !== null && (
                              <span className="text-[10px] text-[var(--text-muted)] flex-shrink-0">{g.replicas} replika</span>
                            )}
                            {partial && owners.map((c) => (
                              <span
                                key={c}
                                title={`Yalnızca ${c} cluster'ında var`}
                                className="text-[10px] px-1.5 py-0.5 rounded-full bg-[var(--bg-elevated)] border border-[var(--border)] text-[var(--text-secondary)] font-mono flex-shrink-0"
                              >
                                {c}
                              </span>
                            ))}
                            {sources[g.name] === "discovery" && (
                              <span
                                className="text-[10px] px-1.5 py-0.5 rounded-full border border-[var(--border)] text-[var(--text-muted)] flex-shrink-0"
                                title="Zamanlanmış envanterde henüz yok — bir kullanıcının taramasıyla geldi."
                              >
                                tarama
                              </span>
                            )}
                          </label>
                        );
                      })}
                      {rows.length === 0 && (
                        <p className="text-xs text-[var(--text-muted)] text-center py-3">Bu bölümde eşleşme yok.</p>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        !loadingCache && (
          /* Boş durumun ÜÇ ayrı hâli var; eskiden hepsi aynı cümleyi gösteriyordu ve
             kullanıcı "tarandı mı, boş mu, yetkim mi yok" ayrımını yapamıyordu. */
          <div className="rounded-xl border border-[var(--border)] p-4 text-center space-y-2">
            <p className="text-xs text-[var(--text-muted)]">
              {denied
                ? "Bu namespace'in uygulama listesini görme yetkiniz yok. Uygulama adını biliyorsanız yukarıya yazabilirsiniz."
                : scannedAt
                  ? `Bu namespace ${shortDate(scannedAt)} tarihinde tarandı ve çalışan bir uygulama bulunamadı — namespace boş görünüyor.`
                  : "Bu namespace için kayıtlı uygulama listesi yok. Adını biliyorsanız yukarıya yazın."}
            </p>
            {onDiscover && !denied && (
              <button
                onClick={handleDiscover}
                disabled={busy}
                title="Sunuculara bağlanıp namespace içindeki uygulamaları listeler"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-[var(--border)] text-[var(--text-secondary)] hover:border-[var(--accent)] hover:text-[var(--text-primary)] transition-colors active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none"
              >
                <MagnifyingGlassCircleIcon aria-hidden="true" className="w-4 h-4" />
                {busy ? "Başlatılıyor…" : scannedAt ? "Yine de tekrar tara" : "Bu namespace'i tara"}
              </button>
            )}
          </div>
        )
      )}

      {atLimit && Number.isFinite(limit) && (
        <p className="text-xs text-[var(--text-muted)]">
          Sepette kalan yer doldu ({limit}). Her hedef ayrı bir <span className="font-mono">oc login</span> +
          pod taraması demek; devam etmek için önce mevcut seçimi çalıştırın.
        </p>
      )}

      <button
        onClick={() => { onSubmit([...selected]); setSelected(new Set()); }}
        disabled={selected.size === 0 || busy}
        className="btn-primary w-full"
      >
        {busy
          ? "Ekleniyor…"
          : selected.size === 0
            ? "En az bir uygulama seçin"
            : `${submitLabel ?? "Seçilenleri Listeye Ekle"} (${selected.size})`}
      </button>
    </div>
  );
};

export default AppNameStep;
