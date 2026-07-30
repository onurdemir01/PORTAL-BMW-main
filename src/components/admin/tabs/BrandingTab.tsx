// src/components/admin/tabs/BrandingTab.tsx — Admin > Marka: tarayici sekmesinde
// gorunen logonun (favicon) yuklenmesi.
//
// Yukleme multipart DEGIL: dosya FileReader ile data URL'e cevrilip JSON olarak
// gonderilir (backend'de multer bagimliligi eklemekten kacinildi — bkz.
// server/admin/branding.cjs). Sunucu formati, boyutu ve dosya imzasini dogrular.
import React, { useEffect, useRef, useState } from "react";
import { ArrowUpTrayIcon, TrashIcon, PhotoIcon } from "@heroicons/react/24/outline";

interface FaviconInfo {
  mime: string;
  sizeBytes: number;
  updatedAt: string | null;
  updatedBy: string | null;
  dataUrl: string;
}

interface Limits {
  maxBytes: number;
  allowedMime: string[];
}

const BrandingTab: React.FC = () => {
  const [favicon, setFavicon] = useState<FaviconInfo | null>(null);
  const [limits, setLimits] = useState<Limits | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/branding");
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Yüklenemedi.");
      setFavicon(data.favicon);
      setLimits(data.limits);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Bilinmeyen hata.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  // Tarayicinin sekme ikonunu yeniden cekmesini tetikler — aksi halde
  // kullanici sayfayi yenileyene kadar eski logoyu gorur.
  const refreshBrowserFavicon = () => {
    const link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
    if (link) link.href = `/api/branding/favicon?v=${Date.now()}`;
  };

  const onPick = async (file: File) => {
    setError(null);
    setOkMsg(null);

    if (limits && file.size > limits.maxBytes) {
      setError(`Dosya çok büyük (${Math.round(file.size / 1024)} KB). Üst sınır ${limits.maxBytes / 1024} KB.`);
      return;
    }

    const dataUrl = await new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.onerror = () => reject(new Error("Dosya okunamadı."));
      r.readAsDataURL(file);
    }).catch((e) => { setError(e.message); return null; });

    if (!dataUrl) return;

    setBusy(true);
    try {
      const res = await fetch("/api/admin/branding/favicon", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dataUrl }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Yükleme başarısız.");
      setOkMsg("Logo güncellendi. Sekme ikonu birkaç saniye içinde yenilenir.");
      refreshBrowserFavicon();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Bilinmeyen hata.");
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const onReset = async () => {
    if (!window.confirm("Logo silinip varsayılana dönülecek. Devam edilsin mi?")) return;
    setBusy(true);
    setError(null);
    setOkMsg(null);
    try {
      const res = await fetch("/api/admin/branding/favicon", { method: "DELETE" });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Silinemedi.");
      setOkMsg("Varsayılan logoya dönüldü.");
      refreshBrowserFavicon();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Bilinmeyen hata.");
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <div className="text-sm" style={{ color: "var(--text-muted)" }}>Yükleniyor…</div>;

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold">Sekme Logosu (Favicon)</h2>
        <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>
          Tarayıcı sekmesinde ve yer imlerinde görünen simge. Görsel veritabanında saklanır,
          sürüm yüklemelerinde kaybolmaz.
        </p>
      </div>

      {error && (
        <div className="pf-alert pf-alert--danger p-3 text-sm" role="alert">{error}</div>
      )}
      {okMsg && (
        <div className="pf-alert pf-alert--success p-3 text-sm" role="status">{okMsg}</div>
      )}

      <div className="flex items-center gap-5 flex-wrap">
        {/* Onizleme — sekmede gorunecegi olcude (16px) ve buyutulmus halde */}
        <div
          className="flex items-center justify-center rounded-lg"
          style={{ width: 96, height: 96, background: "var(--bg-elevated)", border: "1px solid var(--border)" }}
        >
          {favicon ? (
            <img src={favicon.dataUrl} alt="Mevcut logo" style={{ maxWidth: 64, maxHeight: 64 }} />
          ) : (
            <PhotoIcon className="w-8 h-8" style={{ color: "var(--text-muted)" }} />
          )}
        </div>

        <div className="text-sm space-y-1">
          {favicon ? (
            <>
              <div><strong>Format:</strong> {favicon.mime}</div>
              <div><strong>Boyut:</strong> {Math.round(favicon.sizeBytes / 1024)} KB</div>
              {favicon.updatedBy && <div><strong>Yükleyen:</strong> {favicon.updatedBy}</div>}
              {favicon.updatedAt && (
                <div style={{ color: "var(--text-muted)" }}>
                  {new Date(favicon.updatedAt).toLocaleString("tr-TR")}
                </div>
              )}
              {/* Sekmede gercek olcusunde nasil gorunecegi */}
              <div className="flex items-center gap-2 pt-1">
                <span style={{ color: "var(--text-muted)" }}>Sekmede:</span>
                <img src={favicon.dataUrl} alt="" style={{ width: 16, height: 16 }} />
                <span>BMW Portal</span>
              </div>
            </>
          ) : (
            <div style={{ color: "var(--text-muted)" }}>
              Henüz logo yüklenmedi — varsayılan simge kullanılıyor.
            </div>
          )}
        </div>
      </div>

      <div className="flex gap-2 flex-wrap">
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/x-icon,.ico"
          className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) onPick(f); }}
        />
        <button
          className="btn-primary flex items-center gap-2 px-3 py-2 text-sm rounded-lg"
          disabled={busy}
          onClick={() => fileRef.current?.click()}
        >
          <ArrowUpTrayIcon className="w-4 h-4" />
          {busy ? "Yükleniyor…" : favicon ? "Yeni Logo Yükle" : "Logo Yükle"}
        </button>

        {favicon && (
          <button
            className="btn-secondary flex items-center gap-2 px-3 py-2 text-sm rounded-lg"
            disabled={busy}
            onClick={onReset}
          >
            <TrashIcon className="w-4 h-4" />
            Varsayılana Dön
          </button>
        )}
      </div>

      <div className="text-xs space-y-1" style={{ color: "var(--text-muted)" }}>
        <div>
          <strong>Kabul edilen formatlar:</strong>{" "}
          {limits ? limits.allowedMime.join(", ") : "PNG, ICO, JPEG"}
        </div>
        <div><strong>En büyük dosya:</strong> {limits ? limits.maxBytes / 1024 : 512} KB</div>
        <div>
          <strong>Önerilen:</strong> 32×32 veya 64×64 piksel, kare, saydam arka planlı PNG.
        </div>
        <div>
          SVG güvenlik nedeniyle kabul edilmez — çalıştırılabilir kod içerebildiği ve dosya
          portalla aynı adresten sunulduğu için.
        </div>
        <div>
          WEBP kabul edilmez — tarayıcıların favicon işleme hattı bu formatı güvenilir
          şekilde çözmez; dosya yüklenir ama sekme ikonu değişmez.
        </div>
        <div>
          Yeni logo bazı tarayıcılarda hemen görünmeyebilir; sekmeyi kapatıp açmak veya
          Ctrl+Shift+R yeterlidir.
        </div>
      </div>
    </div>
  );
};

export default BrandingTab;
