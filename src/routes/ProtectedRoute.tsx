import React, { useContext } from "react";
import { Navigate, Outlet, useLocation } from "react-router-dom";
import { AuthContext } from "@/contexts/AuthContext";

export default function ProtectedRoute() {
  const { isAuthenticated } = useContext(AuthContext);
  const location = useLocation();

  if (!isAuthenticated) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  return <Outlet />;
}