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
  /** Devam butonunun metni. Varsayılan "Listeye Ekle". */
  submitLabel?: string;
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

// Tarih → "10 Ağu 12:34" (liste rozetlerinde yer kaplamasın diye kısa).
function shortDate(value: string | null): string {
  if (!value) return "";
  const d = new Date(value);
  return Number.isFinite(d.getTime())
    ? d.toLocaleString("tr-TR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })
    : "";
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

const AppNameStep: React.FC<Props> = ({ env, tenant, clusters, namespace, reloadToken, onSubmit, onDiscover, busy, submitLabel }) => {
  const [appName, setAppName] = useState("");
  const [items, setItems] = useState<OcpAppItem[]>([]);
  const [cache, setCache] = useState<{ fetchedAt: string | null; stale: boolean; source?: string | null } | null>(null);
  // Ad → kaynak. Envanterde olmayan (kullanıcı taramasıyla gelen) uygulamalar rozetlenir;
  // kullanıcı listede bir adı NEDEN gördüğünü/göremediğini anlasın.
  const [sources, setSources] = useState<Record<string, string>>({});
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
          setSources({});
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
            // BAŞARISIZ OLACAĞI BELLİ BİR JOB'I HİÇ AÇMA: AWX template'inde "Prompt on
            // launch" kapalıysa gönderilen extra_vars sessizce yutulur ve playbook boş
            // girdiyle düşer. Üretimde bu, kullanıcıya "ters-proxy" hatası olarak
            // görünüyordu (2026-08-10).
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
  const query = appName.trim().toLowerCase();
  const filtered = query ? groups.filter((g) => g.name.toLowerCase().includes(query)) : groups;

  return (
    <div className="space-y-3">
      {notReady && (
        <div className="bg-amber-50 border border-amber-100 rounded-xl p-3 text-xs text-amber-900 space-y-1">
          <p className="font-semibold">Uygulama taraması başlatılamıyor</p>
          <p>{NOT_READY_TEXT[notReady] || NOT_READY_TEXT.unknown}</p>
          <p className="text-amber-800">
            Bu arada uygulama adını biliyorsanız yukarıya yazıp devam edebilirsiniz.
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
        <span className="font-mono text-[var(--text-primary)]">{namespace}</span> içindeki uygulamayı seçin
        {" — "}eşleşen TÜM pod'ların logları tek bir arşivde toplanır.
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
                {sources[g.name] === "discovery" && (
                  <span
                    className="ml-2 px-1.5 py-0.5 rounded-full border border-[var(--border)] text-[10px] font-semibold text-[var(--text-muted)]"
                    title="Zamanlanmış envanterde henüz yok — bir kullanıcının taramasıyla geldi."
                  >
                    tarama
                  </span>
                )}
              </button>
            ))
          )}
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

      {/* Tek calistirmada birden fazla (namespace, uygulama) cifti toplanabilir; secim
          dogrudan job baslatmaz, listeye eklenir (bkz. TargetListStep). */}
      <button
        onClick={() => onSubmit(appName.trim())}
        disabled={!appName.trim() || busy}
        className="btn-primary w-full"
      >
        {busy ? "Ekleniyor…" : (submitLabel ?? "Listeye Ekle")}
      </button>
    </div>
  );
};

export default AppNameStep;
