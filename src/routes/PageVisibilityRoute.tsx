// src/routes/PageVisibilityRoute.tsx — page-visibility.json'daki rol kısıtlamasını
// GERÇEKTEN uygular (önceden yalnızca Sidebar'daki nav linkini gizliyordu, URL'i
// doğrudan yazan bir kullanıcı sayfaya yine erişebiliyordu — bkz. LogX v2 sonrası
// yapılan mimari inceleme). AdminRoute'un deseniyle aynı: login değilse /login,
// sayfa bu rol için kapalıysa /403.
import React, { useContext } from "react";
import { Navigate, Outlet, useLocation } from "react-router-dom";
import { AuthContext } from "@/contexts/AuthContext";

export default function PageVisibilityRoute({ pageId }: { pageId: string }) {
  const { isAuthenticated, pageVisibilityLoaded, canViewPage } = useContext(AuthContext);
  const location = useLocation();

  if (!isAuthenticated) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  // Görünürlük verisi henüz yüklenmediyse kısa bir an için varsayılan-açık davran
  // (yanlış-negatif 403 flaşı yerine) — canViewPage zaten "kayıt yoksa açık" mantığı
  // taşıyor, pageVisibilityLoaded burada yalnızca ekstra bir güvenlik notu.
  if (pageVisibilityLoaded && !canViewPage(pageId)) {
    return <Navigate to="/403" replace state={{ from: location }} />;
  }

  return <Outlet />;
}
