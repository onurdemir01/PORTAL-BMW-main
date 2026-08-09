// src/components/logx_v2/shared/CacheBadge.tsx — Liste önbellekten geldiğinde kullanıcıya
// "bu veri ne kadar taze" bilgisini ve her durumda bir tazeleme yolunu verir.
//
// NEDEN: önbellek listeyi anında getirir ama kullanıcı ekranda gördüğü şeyin ne zamanki
// gerçeği yansıttığını bilmezse yanlış karar verir (silinmiş bir namespace'i seçer).
// Bayat veriyi GİZLEMİYORUZ — göstermek + tazeleme düğmesi sunmak, boş ekrandan iyidir.
import React from "react";
import { ArrowPathIcon, ClockIcon } from "@heroicons/react/24/outline";

interface Props {
  fetchedAt: string | null;
  stale: boolean;
  /** Canlı taramayı (AWX job'ı) tetikler. Yoksa buton hiç render edilmez. */
  onRediscover?: () => void;
  busy?: boolean;
  /** Buton metni — "Burada keşfet" varsayılan, adım bağlamına göre özelleştirilebilir. */
  actionLabel?: string;
}

// "2 saat önce" gibi kısa bir görelilik — mutlak tarih title'da kalır.
export function formatAge(iso: string | null): string {
  if (!iso) return "";
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "";
  const mins = Math.floor((Date.now() - t) / 60000);
  if (mins < 1) return "az önce";
  if (mins < 60) return `${mins} dk önce`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} saat önce`;
  return `${Math.floor(hours / 24)} gün önce`;
}

const CacheBadge: React.FC<Props> = ({ fetchedAt, stale, onRediscover, busy, actionLabel = "Burada keşfet" }) => {
  const absolute = fetchedAt ? new Date(fetchedAt).toLocaleString("tr-TR") : "";

  return (
    <div
      className={`flex items-center justify-between gap-3 rounded-xl border px-3 py-2 text-xs ${
        stale ? "bg-amber-50 border-amber-100 text-amber-800" : "bg-[var(--bg-elevated)] border-[var(--border)] text-[var(--text-secondary)]"
      }`}
    >
      <span className="flex items-center gap-1.5 min-w-0">
        <ClockIcon aria-hidden="true" className="w-3.5 h-3.5 flex-shrink-0" />
        <span className="truncate" title={absolute} aria-label={absolute ? `Liste ${absolute} tarihinde alındı` : undefined}>
          {stale
            ? `Bu liste ${formatAge(fetchedAt)} alındı, güncelliğini yitirmiş olabilir.`
            : `Önbellekten • ${formatAge(fetchedAt)}`}
        </span>
      </span>
      {onRediscover && (
        <button
          onClick={onRediscover}
          disabled={busy}
          title="Sunuculara bağlanıp listeyi yeniden tarar — 1-3 dakika sürebilir"
          className="flex items-center gap-1 flex-shrink-0 px-2.5 py-1 rounded-lg border border-current/30 font-medium hover:bg-white/60 transition-colors active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none"
        >
          <ArrowPathIcon aria-hidden="true" className={`w-3.5 h-3.5 ${busy ? "animate-spin" : ""}`} />
          {busy ? "Taranıyor…" : actionLabel}
        </button>
      )}
    </div>
  );
};

export default CacheBadge;
