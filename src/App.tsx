import React, { Suspense } from "react";
import { Navigate, Route, Routes } from "react-router-dom";

// İlk boyama için kritik olanlar eager; geri kalan ağır sayfalar route bazlı code-splitting
// ile lazy yüklenir (1.2MB tek bundle → ilk yük belirgin küçülür — Sprint 4/D5).
import LoginPage from "@/components/LoginPage";
import DashboardPage from "@/components/DashboardPage";
import ForbiddenPage from "@/components/ForbiddenPage";

// DenetimPage eager kalmisti — oysa ilk boyama icin kritik DEGIL (kendi route'u var,
// giristen sonra ancak menuden acilir) ve kod tabanindaki en agir sayfalardan biri.
// Eager oldugu icin tum agirligi giris ekraninin bile indirdigi ana bundle'a giriyordu.
const DenetimPage = React.lazy(() => import("@/components/DenetimPage"));
const EnvanterPage = React.lazy(() => import("@/components/EnvanterPage"));
const DutyRosterPage = React.lazy(() => import("@/components/DutyRosterPage"));
const DynatracePage = React.lazy(() => import("@/components/dynatrace/DynatracePage"));
const SelfServicePage = React.lazy(() => import("@/components/SelfServicePage"));
const AnsiblePage = React.lazy(() => import("@/components/ansible/AnsiblePage"));
const LogXWizardPage = React.lazy(() => import("@/components/logx_v2/LogXWizardPage"));
const OpsXWizardPage = React.lazy(() => import("@/components/opsx/OpsXWizardPage"));
const FileXWizardPage = React.lazy(() => import("@/components/filex/FileXWizardPage"));
const TelnetWizardPage = React.lazy(() => import("@/components/telnet/TelnetWizardPage"));
const AdminPage = React.lazy(() => import("@/components/admin/AdminPage"));
const AiAnalystPage = React.lazy(() => import("@/components/ai_analyst/AiAnalystPage"));

import ProtectedRoute from "./routes/ProtectedRoute";
import AdminRoute from "./routes/AdminRoute";
import PageVisibilityRoute from "./routes/PageVisibilityRoute";
import AppLayout from "./layouts/AppLayout";

function PageFallback() {
  return (
    <div className="flex items-center justify-center py-24">
      <div className="w-8 h-8 border-2 border-[#0066CC] border-t-transparent rounded-full animate-spin" />
    </div>
  );
}

export default function App() {
  return (
    <Suspense fallback={<PageFallback />}>
    <Routes>
      <Route path="/login" element={<LoginPage />} />

      <Route element={<ProtectedRoute />}>
        <Route element={<AppLayout />}>
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="/403" element={<ForbiddenPage />} />
          <Route path="/logx-v2" element={<Navigate to="/logx" replace />} />

          {/* page-visibility.json'a göre gerçekten erişim kısıtlayan route'lar —
              önceden yalnızca Sidebar'daki nav linki gizleniyordu, bkz.
              src/routes/PageVisibilityRoute.tsx */}
          <Route element={<PageVisibilityRoute pageId="Dashboard" />}>
            <Route path="/dashboard" element={<DashboardPage />} />
          </Route>
          <Route element={<PageVisibilityRoute pageId="Envanter" />}>
            <Route path="/envanter" element={<EnvanterPage />} />
          </Route>
          <Route element={<PageVisibilityRoute pageId="Denetim" />}>
            <Route path="/denetim" element={<DenetimPage />} />
          </Route>
          <Route element={<PageVisibilityRoute pageId="Nöbet" />}>
            <Route path="/duty-roster" element={<DutyRosterPage />} />
          </Route>
          <Route element={<PageVisibilityRoute pageId="Performance" />}>
            <Route path="/performance" element={<DynatracePage />} />
          </Route>
          <Route element={<PageVisibilityRoute pageId="AI Analist" />}>
            <Route path="/ai-analyst" element={<AiAnalystPage />} />
          </Route>
          <Route element={<PageVisibilityRoute pageId="Self Service" />}>
            <Route path="/self-service" element={<SelfServicePage />} />
          </Route>
          <Route element={<PageVisibilityRoute pageId="LogX" />}>
            <Route path="/logx" element={<LogXWizardPage />} />
          </Route>
          <Route element={<PageVisibilityRoute pageId="OpsX" />}>
            <Route path="/opsx" element={<OpsXWizardPage />} />
          </Route>
          <Route element={<PageVisibilityRoute pageId="FileX" />}>
            <Route path="/filex" element={<FileXWizardPage />} />
          </Route>
          <Route element={<PageVisibilityRoute pageId="Telnet" />}>
            <Route path="/telnet" element={<TelnetWizardPage />} />
          </Route>
          {/* "Ansible" artık AdminRoute'un hardcoded admin-only kısıtı yerine
              genel, admin panelinden konfigüre edilebilir sisteme bağlı —
              varsayılan hâlâ Admin-only (DEFAULT_VISIBILITY), ama artık
              gerçekten değiştirilebilir. */}
          <Route element={<PageVisibilityRoute pageId="Ansible" />}>
            <Route path="/ansible" element={<AnsiblePage />} />
          </Route>

          {/* "Admin" bilinçli olarak configurable sistemin DIŞINDA — her zaman
              yalnızca Admin rolü (bkz. AuthContext.canViewPage). */}
          <Route element={<AdminRoute />}>
            <Route path="/admin" element={<AdminPage />} />
          </Route>

          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Route>
      </Route>
    </Routes>
    </Suspense>
  );
}
