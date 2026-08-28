// src/components/admin/tabs/BrandingTab.tsx — Admin > Marka: tarayici sekmesinde
// gorunen favicon'un VE giris/ana ekranda gorunen uygulama logosunun (PortalLogo.tsx)
// yuklenmesi. Iki slot da AYNI ImageAssetEditor bilesenini kullanir (bkz. server/admin/
// branding.cjs — favicon/logo AYNI desen, farkli endpoint+limit).
//
// Yukleme multipart DEGIL: dosya FileReader ile data URL'e cevrilip JSON olarak
// gonderilir (backend'de multer bagimliligi eklemekten kacinildi — bkz.
// server/admin/branding.cjs). Sunucu formati, boyutu ve dosya imzasini dogrular.
import React, { useEffect, useRef, useState } from "react";
import { ArrowUpTrayIcon, TrashIcon, PhotoIcon } from "@heroicons/react/24/outline";
import { fmtDateTime } from "@/utils/datetime";

interface AssetInfo {
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

interface BrandingState {
  favicon: AssetInfo | null;
  logo: AssetInfo | null;
  limits: { favicon: Limits; logo: Limits } | null;
}

function ImageAssetEditor({
  slot, title, description, recommendation, asset, limits, previewBox, onChanged,
}: {
  slot: "favicon" | "logo";
  title: string;
  description: string;
  recommendation: string;
  asset: AssetInfo | null;
  limits: Limits | null;
  previewBox: number;
  onChanged: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

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
      const res = await fetch(`/api/admin/branding/${slot}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dataUrl }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Yükleme başarısız.");
      setOkMsg("Görsel güncellendi.");
      await onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Bilinmeyen hata.");
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const onReset = async () => {
    if (!window.confirm("Görsel silinip varsayılana dönülecek. Devam edilsin mi?")) return;
    setBusy(true);
    setError(null);
    setOkMsg(null);
    try {
      const res = await fetch(`/api/admin/branding/${slot}`, { method: "DELETE" });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Silinemedi.");
      setOkMsg("Varsayılana dönüldü.");
      await onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Bilinmeyen hata.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h2 className="section-label">{title}</h2>
        <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>{description}</p>
      </div>

      {error && <div className="pf-alert pf-alert--danger p-3 text-sm" role="alert">{error}</div>}
      {okMsg && <div className="pf-alert pf-alert--success p-3 text-sm" role="status">{okMsg}</div>}

      <div className="flex items-center gap-5 flex-wrap">
        <div
          className="flex items-center justify-center rounded-lg"
          style={{ width: 96, height: 96, background: "var(--bg-elevated)", border: "1px solid var(--border)" }}
        >
          {asset ? (
            <img src={asset.dataUrl} alt="Mevcut görsel" style={{ maxWidth: previewBox, maxHeight: previewBox }} />
          ) : (
            <PhotoIcon className="w-8 h-8" style={{ color: "var(--text-muted)" }} />
          )}
        </div>

        <div className="text-sm space-y-1">
          {asset ? (
            <>
              <div><strong>Format:</strong> {asset.mime}</div>
              <div><strong>Boyut:</strong> {Math.round(asset.sizeBytes / 1024)} KB</div>
              {asset.updatedBy && <div><strong>Yükleyen:</strong> {asset.updatedBy}</div>}
              {asset.updatedAt && (
                <div style={{ color: "var(--text-muted)" }}>{fmtDateTime(asset.updatedAt)}</div>
              )}
            </>
          ) : (
            <div style={{ color: "var(--text-muted)" }}>Henüz yüklenmedi — varsayılan kullanılıyor.</div>
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
          {busy ? "Yükleniyor…" : asset ? "Yeni Görsel Yükle" : "Görsel Yükle"}
        </button>

        {asset && (
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
        <div><strong>Önerilen:</strong> {recommendation}</div>
        <div>SVG güvenlik nedeniyle kabul edilmez — çalıştırılabilir kod içerebildiği ve dosya portalla aynı adresten sunulduğu için.</div>
        <div>WEBP kabul edilmez — tarayıcıların işleme hattı bu formatı güvenilir şekilde çözmez; dosya yüklenir ama görsel değişmez.</div>
      </div>
    </div>
  );
}

const BrandingTab: React.FC = () => {
  const [state, setState] = useState<BrandingState>({ favicon: null, logo: null, limits: null });
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/branding");
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Yüklenemedi.");
      setState({ favicon: data.favicon, logo: data.logo, limits: data.limits });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  // Tarayicinin sekme ikonunu / (varsa) mount'lu PortalLogo ornemklerini yeniden
  // cekmesini tetikler — aksi halde kullanici sayfayi yenileyene kadar eskisini gorur.
  const refreshAssets = async () => {
    const link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
    if (link) link.href = `/api/branding/favicon?v=${Date.now()}`;
    await load();
  };

  if (loading) return <div className="text-sm" style={{ color: "var(--text-muted)" }}>Yükleniyor…</div>;

  return (
    <div className="space-y-8">
      <ImageAssetEditor
        slot="logo"
        title="Uygulama Logosu"
        description="Giriş ekranı ve ana ekranın üst bandındaki marka işareti (PortalLogo). Yüklenmezse varsayılan kırmızı dört-bölme logo kullanılır."
        recommendation="Kare, saydam arka planlı PNG (ör. 128×128)."
        asset={state.logo}
        limits={state.limits?.logo || null}
        previewBox={72}
        onChanged={refreshAssets}
      />

      <hr style={{ borderColor: "var(--border)" }} />

      <ImageAssetEditor
        slot="favicon"
        title="Sekme Logosu (Favicon)"
        description="Tarayıcı sekmesinde ve yer imlerinde görünen simge. Görsel veritabanında saklanır, sürüm yüklemelerinde kaybolmaz."
        recommendation="32×32 veya 64×64 piksel, kare, saydam arka planlı PNG."
        asset={state.favicon}
        limits={state.limits?.favicon || null}
        previewBox={64}
        onChanged={refreshAssets}
      />

      <div className="text-xs" style={{ color: "var(--text-muted)" }}>
        Yeni görsel bazı tarayıcılarda hemen görünmeyebilir; sekmeyi kapatıp açmak veya Ctrl+Shift+R yeterlidir.
      </div>
    </div>
  );
};

export default BrandingTab;
