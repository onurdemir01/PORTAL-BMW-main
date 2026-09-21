// src/index.tsx
import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";

import App from "./App";
import { AuthProvider } from "@/contexts/AuthContext";
import { ThemeProvider } from "@/contexts/ThemeContext";
import { sessionGuardKur } from "@/api/sessionGuard";
import "./index.css";

// RENDER'DAN ONCE: ilk `/api/auth/me` bile sarmalin icinden gecmeli, yoksa
// acilistaki oturum yoklamasi kapinin disinda kalirdi.
sessionGuardKur();

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error('Could not find root element "#root" to mount to');
}

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <ThemeProvider>
      <AuthProvider>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </AuthProvider>
    </ThemeProvider>
  </React.StrictMode>
);