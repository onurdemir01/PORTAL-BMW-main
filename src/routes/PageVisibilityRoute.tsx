// src/routes/PageVisibilityRoute.tsx — sayfa görünürlüğünü GERÇEKTEN uygular (önceden
// yalnızca nav linkini gizliyordu, URL'i doğrudan yazan kullanıcı sayfaya erişebiliyordu).
// AdminRoute deseniyle aynı: login değilse /login, sayfa kapalıysa /403.
//
// FAIL-OPEN PENCERESİ KAPATILDI: eskiden `pageVisibilityLoaded` bayrağına bakılıyordu; o
// bayrak istek BAŞARISIZ olsa bile `.finally()` içinde true oluyordu ve ayrıca ESKİ
// (legacy) uca aitti — element haritası hiç gelmemişken bile sayfa açılabiliyordu. Artık
// element motorunun gerçekten yüklendiğini gösteren `visibilityReady` beklenir; harita
// gelene kadar kısa bir yükleniyor durumu gösterilir (kapalı sayfanın bir an görünmesi
// yerine). Sunucu tarafı zaten fail-closed'dır; bu yalnızca UI'ın buna uymasını sağlar.
import React, { useContext } from "react";
import { Navigate, Outlet, useLocation } from "react-router-dom";
import { AuthContext } from "@/contexts/AuthContext";

export default function PageVisibilityRoute({ pageId }: { pageId: string }) {
  const { isAuthenticated, visibilityReady, visibilityFailed, canViewPage } = useContext(AuthContext);
  const location = useLocation();

  if (!isAuthenticated) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  // Motor kalıcı olarak okunamıyorsa (retry de başarısız) korumalı sayfayı AÇMA —
  // sunucu zaten 503/403 dönecek, kullanıcıyı boş ekranla baş başa bırakmayalım.
  if (visibilityFailed) {
    return <Navigate to="/403" replace state={{ from: location }} />;
  }

  if (!visibilityReady) {
    return (
      <div className="flex items-center justify-center py-16 text-sm text-[var(--text-muted)]">
        Yetkiler yükleniyor…
      </div>
    );
  }

  if (!canViewPage(pageId)) {
    return <Navigate to="/403" replace state={{ from: location }} />;
  }

  return <Outlet />;
}
