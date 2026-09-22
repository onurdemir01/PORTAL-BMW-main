// src/components/common/PageErrorBoundary.tsx — sayfa alanı için hata sınırı.
//
// NEDEN VAR (2026-08-10, üretim): LogXWizardPage'de bir React Hook kuralı ihlali sayfayı
// render sırasında düşürdü ve kullanıcı **bembeyaz bir ekran** gördü — ne mesaj, ne menü,
// ne de nereye gideceğine dair bir ipucu. HAR'da tüm istekler 200'dü; arıza yalnızca
// tarayıcı konsolunda görünüyordu, kullanıcıda hiçbir iz yoktu.
//
// Portalda o güne kadar HİÇ error boundary yoktu (`grep componentDidCatch src` → 0 sonuç),
// yani bu sessiz beyaz ekran LogX'e özel değil, her sayfa için geçerliydi. Sınır kasten
// AppLayout'un İÇİNE, `<Outlet />` etrafına konur: masthead ve sol menü ayakta kalır,
// kullanıcı başka bir sayfaya geçebilir.
//
// Hata sınırları YALNIZCA render/lifecycle hatalarını yakalar — event handler'daki ya da
// async koddaki hatalar buraya düşmez (onlar zaten ekranı beyaz bırakmıyor; adım
// bileşenleri kendi hata mesajlarını gösteriyor).
import React from "react";
import { isChunkLoadError, reloadForNewVersion } from "@/utils/lazyWithRetry";

interface Props {
  children: React.ReactNode;
}

interface State {
  error: Error | null;
  reloading: boolean;
}

class PageErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null, reloading: false };

  static getDerivedStateFromError(error: Error): State {
    // SURUM ATLAMASI (2026-09-22): yeni release'ten sonra acik sekme, silinmis chunk'i ister ve
    // "Failed to fetch dynamically imported module" alir. Bu bir ariza degil; sayfa bir kez
    // kendiliginden yenilenir (bkz. utils/lazyWithRetry). Yenileme baslatildiysa hata ekrani
    // yerine kisa bir bilgi gosterilir.
    if (isChunkLoadError(error)) return { error, reloading: reloadForNewVersion() };
    return { error, reloading: false };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // Tam yığın izi konsola: kullanıcıdan ekran görüntüsü isterken tek satırlık mesaj
    // yetmiyor, hangi bileşende patladığı gerekiyor.
    console.error("[PageErrorBoundary] sayfa render edilemedi:", error, info.componentStack);
  }

  render() {
    const { error, reloading } = this.state;
    if (!error) return this.props.children;

    if (reloading) {
      return (
        <div className="max-w-2xl mx-auto py-12 text-center text-sm" style={{ color: 'var(--text-muted)' }}>
          Portal yeni sürüme güncellendi; sayfa yenileniyor…
        </div>
      );
    }
    const chunk = isChunkLoadError(error);

    return (
      <div className="max-w-2xl mx-auto py-12">
        <div className="bg-red-50 border border-red-100 rounded-xl p-5 space-y-3">
          <h2 className="text-base font-semibold text-red-800">{chunk ? 'Sayfa dosyası indirilemedi' : 'Bu sayfa yüklenemedi'}</h2>
          <p className="text-sm text-red-700">
            {chunk
              ? 'Portal bu sırada güncellenmiş olabilir ya da ağ bağlantısı kesildi. "Sayfayı yenile" genelde çözer; sürerse ağ/VPN bağlantınızı kontrol edin.'
              : 'Sayfa çizilirken beklenmeyen bir hata oluştu. Soldaki menüden başka bir sayfaya geçebilir ya da yenilemeyi deneyebilirsiniz.'}
          </p>
          <pre className="text-xs font-mono text-red-800 bg-white/60 border border-red-100 rounded-lg p-3 overflow-x-auto whitespace-pre-wrap">
            {error.message || String(error)}
          </pre>
          <div className="flex items-center gap-2">
            <button onClick={() => window.location.reload()} className="btn-primary">
              Sayfayı yenile
            </button>
            {/* Sorun devam ederse teknik ekip konsoldaki yığın izine ihtiyaç duyar. */}
            <span className="text-xs text-red-700">
              Sorun sürerse tarayıcı konsolundaki hatayı ekip ile paylaşın.
            </span>
          </div>
        </div>
      </div>
    );
  }
}

export default PageErrorBoundary;
