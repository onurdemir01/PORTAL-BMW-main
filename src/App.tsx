import React, { Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';

// İlk boyama için kritik olanlar eager; geri kalan ağır sayfalar route bazlı code-splitting
// ile lazy yüklenir (1.2MB tek bundle → ilk yük belirgin küçülür — Sprint 4/D5).
import LoginPage from '@/components/LoginPage';
import DashboardPage from '@/components/DashboardPage';
import ForbiddenPage from '@/components/ForbiddenPage';

// DenetimPage eager kalmisti — oysa ilk boyama icin kritik DEGIL (kendi route'u var,
// giristen sonra ancak menuden acilir) ve kod tabanindaki en agir sayfalardan biri.
// Eager oldugu icin tum agirligi giris ekraninin bile indirdigi ana bundle'a giriyordu.
const DenetimPage = lazyWithRetry(() => import('@/components/DenetimPage'));
// Nginx Audit > tek sunucu sayfasi: kendi URL'i var, Denetim gorunurlugune tabi.
const NginxAuditHostPage = lazyWithRetry(() => import('@/components/denetim/NginxAuditHostPage'));
const EnvanterPage = lazyWithRetry(() => import('@/components/EnvanterPage'));
const DutyRosterPage = lazyWithRetry(() => import('@/components/DutyRosterPage'));
// ImportantLinksPage: 2026-09-19'da menu ve route kaldirildi (bilesen duruyor; bkz. elements.ts)
const DynatracePage = lazyWithRetry(() => import('@/components/dynatrace/DynatracePage'));
const SelfServicePage = lazyWithRetry(() => import('@/components/SelfServicePage'));
const AnsiblePage = lazyWithRetry(() => import('@/components/ansible/AnsiblePage'));
const LogXWizardPage = lazyWithRetry(() => import('@/components/logx_v2/LogXWizardPage'));
const OpsXWizardPage = lazyWithRetry(() => import('@/components/opsx/OpsXWizardPage'));
const NginxConsolePage = lazyWithRetry(() => import('@/components/nginx_console/NginxConsolePage'));
const ServerHubPage = lazyWithRetry(() => import('@/components/server_hub/ServerHubPage'));
const CryptoHubPage = lazyWithRetry(() => import('@/components/crypto_hub/CryptoHubPage'));
const ScaleXPage = lazyWithRetry(() => import('@/components/scalex/ScaleXPage'));
const FileXWizardPage = lazyWithRetry(() => import('@/components/filex/FileXWizardPage'));
const TelnetWizardPage = lazyWithRetry(() => import('@/components/telnet/TelnetWizardPage'));
const AdminPage = lazyWithRetry(() => import('@/components/admin/AdminPage'));
const AiAnalystPage = lazyWithRetry(() => import('@/components/ai_analyst/AiAnalystPage'));

import ProtectedRoute from './routes/ProtectedRoute';
import AdminRoute from './routes/AdminRoute';
import PageVisibilityRoute from './routes/PageVisibilityRoute';
import AppLayout from './layouts/AppLayout';
import { lazyWithRetry } from '@/utils/lazyWithRetry';

// DIS SUSPENSE — yalnizca AppLayout'un KENDISI (ve login gibi kabuksuz rotalar)
// lazy olsaydi diye duruyor. Sayfa iceriginin sinirini AppLayout kendi icinde,
// <Outlet/> etrafinda tutar (bkz. AppLayout PageSkeleton notu): boylece lazy bir
// sayfaya hard reload'da masthead ve menu AYAKTA KALIR.
//
// Renk hardcoded #0066CC degil: koyu temada --accent #2b9af3'tur ve sabit hex,
// spinner'i temanin disinda birakiyordu.
function PageFallback() {
  return (
    <div className="flex items-center justify-center py-24">
      <div className="w-8 h-8 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
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
              <Route path="/denetim/nginx-audit/:host" element={<NginxAuditHostPage />} />
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
              <Route path="/self-service/:slug" element={<SelfServicePage />} />
            </Route>
            <Route element={<PageVisibilityRoute pageId="LogX" />}>
              <Route path="/logx" element={<LogXWizardPage />} />
            </Route>
            <Route element={<PageVisibilityRoute pageId="ScaleX" />}>
              <Route path="/scalex" element={<ScaleXPage />} />
            </Route>
            <Route element={<PageVisibilityRoute pageId="OpsX" />}>
              <Route path="/opsx" element={<OpsXWizardPage />} />
            </Route>
            <Route element={<PageVisibilityRoute pageId="NginxConsole" />}>
              <Route path="/nginx-console" element={<NginxConsolePage />} />
            </Route>
            <Route element={<PageVisibilityRoute pageId="ServerHub" />}>
              <Route path="/server-hub" element={<ServerHubPage />} />
            </Route>
            <Route element={<PageVisibilityRoute pageId="CryptoHub" />}>
              <Route path="/crypto-hub" element={<CryptoHubPage />} />
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
