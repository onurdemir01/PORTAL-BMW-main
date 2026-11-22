// src/components/layout/KurumAyarUyarisi.tsx — kurum ayari eksik / bozuksa ust bant (2026-11-20).
//
// Kurumun sunucu / cluster listeleri kod disinda, kurum ayarinda (server/util/kurum-ayari.cjs). Ayar yoksa
// uygulama calisir ama nginx / OCP / Crypto Hub listeleri bos gelir; bu bant sebebi acikca soyler ki bos
// liste "sunucu yok" diye okunmasin. Durum ilk HTML'e gomulur (window.__BMW_BOOT__.kurumAyarHatasi).

// window.__BMW_BOOT__ tipi tek yerde: src/components/common/PortalLogo.tsx (kurumAyarHatasi dahil).

export function KurumAyarUyarisi() {
  const hata = typeof window === 'undefined' ? null : window.__BMW_BOOT__?.kurumAyarHatasi;
  if (!hata) return null;
  return (
    <div
      role="alert"
      className="px-4 py-1.5 text-xs border-b"
      style={{
        borderColor: 'var(--status-warning)',
        background: 'var(--status-warning-bg)',
        color: 'var(--status-warning-text)',
      }}
    >
      Kurum ayarı yok ya da okunamadı ({hata}). Nginx, OpenShift ve Crypto Hub sunucu listeleri boş
      görünür; yöneticinin KURUM_AYAR_DOSYASI ayarını vermesi gerekir.
    </div>
  );
}
