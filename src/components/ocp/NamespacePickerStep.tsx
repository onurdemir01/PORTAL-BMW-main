// src/components/ocp/NamespacePickerStep.tsx — Namespace listesini
// (cluster'lar arasında tekilleştirilmiş) aranabilir şekilde gösterir.
//
// PAYLAŞIMLI: LogX ve OpsX sihirbazlarının ikisi de bunu kullanır. Kopyalanmadı —
// önbellek rozeti, kısıtlama davranışı ve "hepsi başarısız" hata kartı tek yerde kalsın.
//
// Liste iki kaynaktan gelebilir: paylaşımlı önbellek (anında) veya canlı discovery job'ı.
// Bileşen kaynağı UMURSAMAZ — düz bir ad listesi alır; tazelik bilgisi `cache` prop'uyla
// gelir ve rozette gösterilir. Böylece "önce önbellek, istersen tazele" akışı tek yerde kalır.
import React, { useMemo, useState } from "react";
import { MagnifyingGlassIcon, ExclamationTriangleIcon, ArrowPathIcon } from "@heroicons/react/24/outline";
import CacheBadge from "./CacheBadge";

interface Props {
  namespaces: string[];
  /** Erişilemeyen cluster adları — canlı taramada dolar, önbellekte boştur. */
  failedClusters?: string[];
  /** Cluster başına HAM hata metni. Sadece ad göstermek yetmiyordu: üretimde gerçek sebep
   *  ("'username' is undefined") hiçbir ekranda görünmedi, kullanıcı boş liste gördü. */
  failedDetails?: { cluster: string; error: string }[];
  /** Liste önbellekten geldiyse tazelik bilgisi; canlı sonuçta null. */
  cache?: { fetchedAt: string | null; stale: boolean } | null;
  onRediscover?: () => void;
  busy?: boolean;
  onSelect: (ns: string) => void;
}

const NamespacePickerStep: React.FC<Props> = ({
  namespaces, failedClusters = [], failedDetails = [], cache, onRediscover, busy, onSelect,
}) => {
  const [search, setSearch] = useState("");
  const [showErrors, setShowErrors] = useState(false);

  // Savunma amaçlı: backend normalize etmiş olsa da, `project.project.openshift.io/<ad>`
  // gibi API-group önekli değerler gelirse son `/`'ten sonrasını al (namespace adı).
  const cleanNs = (ns: string) => String(ns || "").replace(/^.*\//, "").trim();

  // OCP platform/sistem namespace'leri (openshift-*, kube-*, default...) genellikle aranmaz —
  // listede EN SONA sıralanır ki kullanıcının uygulama namespace'leri üste gelsin.
  const isSystemNs = (ns: string) =>
    /^(openshift|kube)(-|$)/.test(ns) || ["default", "default-broker"].includes(ns);

  const allNamespaces = useMemo(() => {
    const set = new Set<string>();
    for (const ns of namespaces || []) {
      // Yalnızca metin değerleri: çağıran yanlış şekilli bir sonuç geçirirse
      // "[object Object]" satırları basmak yerine sessizce elenirler.
      if (typeof ns !== "string") continue;
      const clean = cleanNs(ns);
      if (clean) set.add(clean);
    }
    return [...set].sort((a, b) => {
      const sa = isSystemNs(a), sb = isSystemNs(b);
      if (sa !== sb) return sa ? 1 : -1; // sistem namespace'leri sona
      return a.localeCompare(b);
    });
  }, [namespaces]);

  const filtered = allNamespaces.filter((ns) => ns.toLowerCase().includes(search.toLowerCase()));

  // Ayrıntı paneli hem kısmi hem tam başarısızlıkta aynı: tek yerde kurulur.
  const errorDetails = failedDetails.length > 0 && (
    <>
      <button
        onClick={() => setShowErrors((v) => !v)}
        aria-expanded={showErrors}
        className="underline underline-offset-2 hover:no-underline"
      >
        {showErrors ? "Ayrıntıyı gizle" : "Neden? Ayrıntıyı göster"}
      </button>
      {showErrors && (
        <ul className="mt-2 space-y-1.5">
          {failedDetails.map((d) => (
            <li key={d.cluster}>
              <span className="font-mono font-medium">{d.cluster}</span>
              <pre className="mt-0.5 whitespace-pre-wrap font-mono text-[11px] opacity-80">{d.error}</pre>
            </li>
          ))}
        </ul>
      )}
    </>
  );

  // HİÇBİR cluster liste döndüremediyse arama kutusu + boş liste göstermek anlamsız:
  // kullanıcı "boş ekran" görüyor ve neden olduğunu bilmiyordu (üretimde tam olarak bu
  // oldu). Bu durumda arama yerine hatayı ve yeniden deneme yolunu gösteririz.
  if (allNamespaces.length === 0 && failedClusters.length > 0) {
    return (
      <div className="space-y-3">
        <div className="bg-red-50 border border-red-100 rounded-xl p-4 text-xs text-red-800 space-y-2">
          <div className="flex items-start gap-2">
            <ExclamationTriangleIcon aria-hidden="true" className="w-4 h-4 shrink-0 mt-0.5" />
            <div>
              <p className="font-medium">Namespace listesi alınamadı.</p>
              <p className="mt-0.5">
                Seçilen cluster'ların hiçbirinden liste dönmedi: {failedClusters.join(", ")}.
              </p>
            </div>
          </div>
          {errorDetails}
        </div>
        {onRediscover && (
          <button
            onClick={onRediscover}
            disabled={busy}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-[var(--border)] text-[var(--text-secondary)] hover:border-[var(--accent)] hover:text-[var(--text-primary)] transition-colors disabled:opacity-50 disabled:pointer-events-none"
          >
            <ArrowPathIcon aria-hidden="true" className="w-4 h-4" />
            {busy ? "Başlatılıyor…" : "Yeniden tara"}
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {cache && <CacheBadge fetchedAt={cache.fetchedAt} stale={cache.stale} onRediscover={onRediscover} busy={busy} />}
      {failedClusters.length > 0 && (
        <div className="bg-amber-50 border border-amber-100 rounded-xl p-3 text-xs text-amber-800">
          Bazı cluster'lara erişilemedi: {failedClusters.join(", ")} — aşağıdaki liste EKSİK olabilir.
          {errorDetails && <div className="mt-1">{errorDetails}</div>}
        </div>
      )}
      <div className="flex items-center justify-between">
        <p className="text-xs text-[var(--text-secondary)]">Log çekmek istediğiniz namespace'i seçin</p>
        <span className="text-xs text-[var(--text-muted)]">
          {search ? `${filtered.length} / ${allNamespaces.length}` : `${allNamespaces.length} namespace`}
        </span>
      </div>
      <div className="relative">
        <MagnifyingGlassIcon className="w-4 h-4 text-[var(--text-muted)] absolute left-3 top-1/2 -translate-y-1/2" />
        <input
          autoFocus
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Namespace ara... (ör. uygulama adı)"
          className="w-full pl-9 pr-3 py-2.5 text-sm border border-[var(--border)] rounded-xl outline-none focus:border-[var(--accent)] focus:ring-1 focus:ring-[var(--accent)] transition"
        />
      </div>
      <div className="max-h-72 overflow-y-auto border border-[var(--border)] rounded-xl divide-y divide-[var(--border)]">
        {filtered.length === 0 ? (
          <p className="text-sm text-[var(--text-muted)] text-center py-6">Sonuç yok.</p>
        ) : (
          filtered.map((ns) => (
            <button
              key={ns}
              onClick={() => onSelect(ns)}
              className="w-full text-left px-4 py-2.5 text-sm text-[var(--text-primary)] hover:bg-[var(--bg-elevated)] transition-colors font-mono"
            >
              {ns}
            </button>
          ))
        )}
      </div>
      {/* Liste canlı taramadan geldiyse rozet yok — tazeleme yolu yine de sunulur. */}
      {!cache && onRediscover && (
        <button
          onClick={onRediscover}
          disabled={busy}
          className="text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors disabled:opacity-50"
        >
          Aradığınız namespace listede yok mu? Yeniden tara
        </button>
      )}
    </div>
  );
};

export default NamespacePickerStep;
