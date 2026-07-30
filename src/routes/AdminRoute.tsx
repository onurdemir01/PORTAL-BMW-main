import React, { useContext } from "react";
import { Navigate, Outlet, useLocation } from "react-router-dom";
import { AuthContext } from "@/contexts/AuthContext";

export default function AdminRoute() {
  const { user, isAuthenticated } = useContext(AuthContext);
  const location = useLocation();

  // Kullanıcı login değilse önce login'e
  if (!isAuthenticated) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  // Admin değilse 403
  if (user?.role !== "Admin") {
    return <Navigate to="/403" replace state={{ from: location }} />;
  }

  return <Outlet />;
}