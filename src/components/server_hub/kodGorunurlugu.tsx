// src/components/server_hub/kodGorunurlugu.tsx — Bulgular'da teknik kodları göster / gizle (2026-11-11).
//
// Kullanıcı: "bu sayfada gözüken kodlar/etiketler/tag'lar kafamızı karıştırıyor; bunları kapatılabilir /
// gözükmeyebilir hale getirir misin?" Kapalıyken ham kod (REBOOT_RISK, R7 …) yerine yalnız okunur adı
// yazılır; bilgi kaybolmaz, yalnız biçimi değişir. Seçim görüntüleyen başına tarayıcıda saklanır.
// Sağlayıcı dışında (başka ekranlar) kodlar her zaman görünür: varsayılan true.
import React, { createContext, useCallback, useContext, useState } from 'react';

const kimlik = (kod: string) => kod;
const KodGorunurContext = createContext<{ goster: boolean; ad: (kod: string) => string }>({ goster: true, ad: kimlik });

/** Bu bileşenin içinde teknik kodlar gösterilsin mi (sağlayıcı yoksa true). */
export const useKodGorunur = () => useContext(KodGorunurContext).goster;
/** Bulgu kodunun okunur adı (sağlayıcı yoksa kodun kendisi). */
export const useKodAdi = () => useContext(KodGorunurContext).ad;

export function KodGorunurSaglayici({
  goster,
  ad = kimlik,
  children,
}: {
  goster: boolean;
  ad?: (kod: string) => string;
  children: React.ReactNode;
}) {
  const deger = React.useMemo(() => ({ goster, ad }), [goster, ad]);
  return <KodGorunurContext.Provider value={deger}>{children}</KodGorunurContext.Provider>;
}

const ANAHTAR = 'server-hub:bulgu-kodlari-goster';

/** Kalıcı seçim: varsayılan KAPALI (kullanıcı kodlardan şikayetçi); depolama yoksa yine çalışır. */
export function useKodGosterSecimi(): [boolean, (v: boolean) => void] {
  const [goster, setGoster] = useState<boolean>(() => {
    try {
      return window.localStorage.getItem(ANAHTAR) === '1';
    } catch {
      return false;
    }
  });
  const degistir = useCallback((v: boolean) => {
    setGoster(v);
    try {
      window.localStorage.setItem(ANAHTAR, v ? '1' : '0');
    } catch {
      /* depolama yok: yalnız bu oturum */
    }
  }, []);
  return [goster, degistir];
}
