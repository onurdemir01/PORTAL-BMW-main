// src/components/opsx/steps/AppSearchStep.tsx — uygulama seçimi. LogX'in
// AppSearchStep'iyle BİREBİR aynı davranış (kullanıcı isteği): aranabilir liste,
// DB erişilemezse snapshot fallback uyarısı.
import React, { useEffect, useRef, useState } from "react";
import { MagnifyingGlassIcon, ExclamationTriangleIcon } from "@heroicons/react/24/outline";
import { opsxApi } from "@/api/opsxApi";
import { tekTamEslesme } from "@/utils/derinBaglanti";

// ÖN-DOLUM (Uygulama Hub derin bağlantısı, 2026-11-08): `initialSearch` arama kutusunu doldurur.
// `autoSelectExact` açıksa İLK arama sonucunda liste TEK satırsa ve o satır aranan adın KENDİSİYSE
// (büyük/küçük harf duyarsız) uygulama kendiliğinden seçilir. Taban ad verilip envanterde
// -D/-T/-Q varyantları varsa (arama LIKE %ad% — birden çok satır döner) seçim YAPILMAZ:
// arama dolu kalır, kullanıcı hangi varyantı istediğini kendisi seçer. Sunucu seçilen adı
// GET /api/opsx/hosts?app= ile ayrıca doğrular — bu bir kolaylık, güvenlik sınırı değil.
const AppSearchStep: React.FC<{
  onSelect: (app: string) => void;
  busy?: boolean;
  initialSearch?: string;
  autoSelectExact?: boolean;
}> = ({ onSelect, busy, initialSearch, autoSelectExact }) => {
  const [search, setSearch] = useState(initialSearch ?? "");
  const [apps, setApps] = useState<string[]>([]);
  const [fallbackMode, setFallbackMode] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [onDolumNotu, setOnDolumNotu] = useState<string | null>(null);
  // Otomatik seçim YALNIZ ilk aramada denenir; kullanıcı yazmaya başladıysa bir daha asla.
  const otomatikRef = useRef<string | null>(autoSelectExact && initialSearch ? initialSearch : null);
  const onSelectRef = useRef(onSelect);
  useEffect(() => { onSelectRef.current = onSelect; }, [onSelect]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setLoading(true);
      setError(null);
      opsxApi.searchApps(search)
        .then((r) => {
          setApps(r.apps);
          setFallbackMode(r.fallbackMode);
          const hedef = otomatikRef.current;
          if (hedef === null) return;
          otomatikRef.current = null;
          if (search !== hedef) return;
          const tam = tekTamEslesme(r.apps, hedef);
          if (tam) { onSelectRef.current(tam); return; }
          setOnDolumNotu(
            r.apps.length === 0
              ? `“${hedef}” envanterde bulunamadı — uygulamayı arayıp seçin.`
              : `“${hedef}” için ${r.apps.length} eşleşme var — işlem yapılacak uygulamayı seçin.`,
          );
        })
        .catch((err) => setError(err instanceof Error ? err.message : String(err)))
        .finally(() => setLoading(false));
    }, 250);
    return () => clearTimeout(timer);
  }, [search]);

  return (
    <div className="space-y-3">
      {onDolumNotu && (
        <div
          data-testid="opsx-app-ondolum-notu"
          className="flex items-start gap-2 rounded-xl border border-[var(--status-warning)] bg-[var(--status-warning-bg)] p-3 text-xs text-[var(--status-warning-text)]"
        >
          <ExclamationTriangleIcon className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <span>{onDolumNotu}</span>
        </div>
      )}
      {fallbackMode && (
        <div className="flex items-start gap-2 bg-amber-50 border border-amber-100 rounded-xl p-3 text-xs text-amber-800">
          <ExclamationTriangleIcon className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <span>Envanter veritabanına şu an erişilemiyor — son bilinen uygulama listesi (snapshot) gösteriliyor.</span>
        </div>
      )}
      <div className="relative">
        <MagnifyingGlassIcon className="w-4 h-4 text-[var(--text-muted)] absolute left-3 top-1/2 -translate-y-1/2" />
        <input
          autoFocus
          value={search}
          onChange={(e) => { otomatikRef.current = null; setSearch(e.target.value); }}
          placeholder="Uygulama adı ara..."
          className="w-full pl-9 pr-3 py-2.5 text-sm border border-[var(--border)] rounded-xl outline-none focus:border-[var(--accent)] focus:ring-1 focus:ring-[var(--accent)] transition"
        />
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="max-h-[70vh] overflow-y-auto border border-[var(--border)] rounded-xl divide-y divide-[var(--border)]">
        {loading ? (
          <p className="text-sm text-[var(--text-muted)] text-center py-6">Aranıyor...</p>
        ) : apps.length === 0 ? (
          <p className="text-sm text-[var(--text-muted)] text-center py-6">Sonuç yok.</p>
        ) : (
          apps.map((app) => (
            <button
              key={app}
              onClick={() => onSelect(app)}
              disabled={busy}
              className="w-full text-left px-4 py-2.5 text-sm text-[var(--text-primary)] hover:bg-[var(--bg-elevated)] transition-colors active:bg-[var(--bg-elevated)] disabled:opacity-50 disabled:pointer-events-none"
            >
              {app}
            </button>
          ))
        )}
      </div>
    </div>
  );
};

export default AppSearchStep;
