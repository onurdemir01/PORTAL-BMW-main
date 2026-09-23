// src/components/admin/tabs/NginxAccessTab.tsx — Admin > "Nginx Hub Erişimi" (2026-09-23).
//
// Kullanıcı: "Nginx Hub'a da istediğim kullanıcıları sokmak istiyorum ama yine sadece
// istediğim sayfaları görsünler — CIS, SPA, API Envanteri, Envanter, Audit gibi."
//
// Model Denetim ile aynı (kullanıcı kararı, 2026-09-23): sayfa da sekmeler de VARSAYILAN
// KAPALI. Buradan bir kullanıcıya/AD grubuna sayfa + SEÇİLEN sekmeler açılır; seçilmeyen
// sekme hem menüde yok hem de ucu 403 döner. Kaydı kaldırmak erişimi tamamen kapatır.
import React from 'react';
import { nginxAccessApi } from '@/api/adminApi';
import { TabAccessPanel } from './TabAccessPanel';

const TAB_LABELS: Record<string, string> = {
  dashboard: 'Dashboard',
  instances: 'Instances',
  config: 'Konfigürasyon',
  changes: 'Değişiklikler',
  certs: 'Sertifikalar',
  orphans: 'Kullanılmayan',
  drift: 'Tutarlılık',
  cis: 'CIS',
  spa: 'SPA',
  api: 'API Envanteri',
  envanter: 'Envanter',
  audit: 'Audit',
};

export default function NginxAccessTab() {
  return (
    <TabAccessPanel
      api={nginxAccessApi}
      labels={TAB_LABELS}
      subject="Nginx Hub"
      title="Nginx Hub sekme erişimi"
      emptyText="Henüz kimseye açılmamış — Nginx Hub'ı yalnız yöneticiler görüyor."
      intro={
        <>
          Nginx Hub <b>yalnız yöneticilere</b> açıktır ve sekmeleri de <b>varsayılan olarak kapalıdır</b>.
          Buradan bir <b>kullanıcıya</b> ya da bir <b>LDAP (AD) grubuna</b> sayfayı ve <b>seçtiğiniz sekmeleri</b> açarsınız;
          seçilmeyen sekme hem menüde görünmez hem de verisi sunucu tarafında kapalıdır (403).
          Örneğin yalnız <code className="px-1 rounded bg-[var(--bg-elevated)]">CIS</code>,{' '}
          <code className="px-1 rounded bg-[var(--bg-elevated)]">SPA</code>,{' '}
          <code className="px-1 rounded bg-[var(--bg-elevated)]">API Envanteri</code>,{' '}
          <code className="px-1 rounded bg-[var(--bg-elevated)]">Envanter</code> ve{' '}
          <code className="px-1 rounded bg-[var(--bg-elevated)]">Audit</code> seçilirse kişi diğer sekmeleri hiç görmez.
          Kaydı <b>kaldırmak</b> kişinin Nginx Hub erişimini tamamen kapatır. Grup için CN adı ya da tam DN girilebilir;
          eşleşme oturumdaki <code className="px-1 rounded bg-[var(--bg-elevated)]">memberOf</code> listesine göre yapılır
          ve değişiklik anında yayılır.
        </>
      }
    />
  );
}
