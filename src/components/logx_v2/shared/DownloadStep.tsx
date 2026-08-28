// src/components/logx_v2/shared/DownloadStep.tsx — İndirme hazır olduğunda gösterilen
// son adım. Platform-agnostik (hem Legacy hem OCP aynı bileşeni kullanır).
//
// İndirme düz `<a href>` navigasyonu DEĞİL: fetch ile (credentials dahil) blob olarak
// çekilir. Böylece hata durumunda tarayıcıda ham JSON sayfası açılmaz — kullanıcıya NET bir
// hata mesajı gösterilir (ör. "arşiv portalda bulunamadı / staging mount"). Başarıda dosya
// bir object URL ile indirilir.
//
// OCP çekiminde bir istek BİRDEN ÇOK arşiv üretebilir: iş birimi (cluster × namespace ×
// uygulama) başına bir arşiv. Dosya adı `<cluster>__<namespace>__<uygulama>__<id>.zip`
// biçimindedir. `downloads` doluysa her arşiv ayrı satır olarak listelenir; tek arşiv
// varsa görünüm eskisiyle aynıdır.
import React, { useState } from "react";
import { ArrowDownTrayIcon, CheckCircleIcon, ExclamationTriangleIcon } from "@heroicons/react/24/outline";
import { logxV2Api, type DownloadInfo } from "@/api/logxV2Api";
import { fmtSize } from "@/components/logx_v2/shared/logFileMeta";
import { fmtTime } from "@/utils/datetime";

function useBlobDownload() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(item: DownloadInfo) {
    if (busy) return;
    setBusy(true);
    setError(null);
    let url: string | null = null;
    try {
      const res = await fetch(logxV2Api.downloadUrl(item.token), { credentials: "include" });
      if (!res.ok) {
        // Backend JSON hata döner (401/403/404/410) — mesajı göster.
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { message?: string }).message || `İndirme başarısız (HTTP ${res.status}).`);
      }
      const blob = await res.blob();
      url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = item.filename || "logs.zip";
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (url) window.URL.revokeObjectURL(url);
      setBusy(false);
    }
  }

  return { busy, error, run };
}

const DownloadButton: React.FC<{ item: DownloadInfo; compact?: boolean }> = ({ item, compact }) => {
  const { busy, error, run } = useBlobDownload();
  return (
    <div className={compact ? "flex items-center gap-3 w-full" : "flex flex-col items-center gap-3"}>
      {compact && (
        <span className="text-xs text-[var(--text-secondary)] truncate flex-1 text-left" title={item.filename}>
          {item.filename}
          {/* BOYUT (2026-08-28): `sizeBytes` API'de VARDI ama hicbir yerde
              gosterilmiyordu. Indirme `res.blob()` ile TAMAMEN bellege alindigi icin
              kullanicinin ne kadarlik bir dosyaya bastigini ONCEDEN bilmesi gerekir. */}
          {item.sizeBytes ? (
            <span className="text-[var(--text-muted)] tabular-nums"> · {fmtSize(item.sizeBytes)}</span>
          ) : null}
        </span>
      )}
      <button
        onClick={() => run(item)}
        disabled={busy}
        className="btn-primary active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none"
      >
        <ArrowDownTrayIcon className="w-4 h-4" />
        {busy ? "İndiriliyor…" : error ? "Tekrar Dene" : "İndir (.zip)"}
      </button>
      {error && (
        <div className="flex items-start gap-2 bg-red-50 border border-red-100 rounded-xl p-3 text-sm text-red-700 max-w-md text-left">
          <ExclamationTriangleIcon className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}
    </div>
  );
};

const DownloadStep: React.FC<{ download: DownloadInfo; downloads?: DownloadInfo[]; onRestart: () => void }> = ({
  download, downloads, onRestart,
}) => {
  // Sunucu `downloads[]` göndermezse (eski backend) tekil kayda düşeriz.
  const items = downloads && downloads.length ? downloads : [download];
  const multi = items.length > 1;

  return (
    <div className="flex flex-col items-center justify-center py-10 gap-4 text-center">
      <CheckCircleIcon className="w-12 h-12 text-emerald-500" />
      <div>
        <p className="text-sm font-semibold text-[var(--text-primary)]">
          {multi ? `Log arşivleriniz hazır (${items.length} adet)` : "Log dosyanız hazır"}
        </p>
        {multi ? (
          <p className="text-xs text-[var(--text-muted)] mt-1">
            Her <strong>cluster / namespace / uygulama</strong> birleşimi için ayrı arşiv oluştu —
            dosya adı hangi arşivin neye ait olduğunu söyler.
            {(() => {
              const total = items.reduce((n, it) => n + (it.sizeBytes || 0), 0);
              return total > 0 ? <> Toplam <strong>{fmtSize(total)}</strong>.</> : null;
            })()}
          </p>
        ) : (
          <p className="text-xs text-[var(--text-muted)] mt-1">
            {items[0]?.filename}
            {items[0]?.sizeBytes ? <span className="tabular-nums"> · {fmtSize(items[0].sizeBytes)}</span> : null}
          </p>
        )}
      </div>

      {/* Arşiv paylaşımlı staging yerine kaynak host'un YEREL yedek dizinine düştüyse
          portal onu göremeyebilir. Eskiden kullanıcı bunu ancak indirmeye basıp 404
          alınca anlıyordu — sebebi ÖNCEDEN söylüyoruz. */}
      {items.some((it) => it.isFallback) && (
        <div className="w-full max-w-lg flex items-start gap-2 bg-amber-50 border border-amber-100 rounded-xl p-3 text-xs text-amber-800 text-left">
          <ExclamationTriangleIcon aria-hidden="true" className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <span>
            {items.filter((it) => it.isFallback).length} arşiv, paylaşımlı staging dizini yerine
            <strong> kaynak sunucunun yerel yedek dizinine</strong> yazıldı. Portal bu dizini
            göremiyorsa indirme başarısız olur — yöneticinize staging mount'unu kontrol ettirin.
          </span>
        </div>
      )}

      {multi ? (
        <div className="w-full max-w-lg flex flex-col gap-2">
          {items.map((it) => (
            <div key={it.token} className="border border-[var(--border)] rounded-xl px-3 py-2">
              <DownloadButton item={it} compact />
            </div>
          ))}
        </div>
      ) : (
        <DownloadButton item={items[0]} />
      )}

      <p className="text-xs text-[var(--text-muted)]">
        Bu bağlantı {fmtTime(items[0]?.expiresAt)} itibarıyla sona erecek.
      </p>
      <button onClick={onRestart} className="text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] underline mt-2">
        Yeni bir istek başlat
      </button>
    </div>
  );
};

export default DownloadStep;
