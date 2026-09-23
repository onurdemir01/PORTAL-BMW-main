// src/components/admin/tabs/DenetimAccessTab.tsx — Admin > "Denetim Erişimi" (2026-09-17).
//
// Kullanici: Denetim sayfasi Admin disinda herkese KAPALI; istedigim sayfalari istedigim
// kisiye ya da LDAP grubuna buradan acabileyim. Motor: mevcut gorunurluk kurallari
// (portal_element_visibility) — 'Denetim' sayfasina allow + secilen 'tab:denetim:<id>'
// elementlerine allow. Grup kurali oturumdaki AD gruplarindan (memberOf) eslesir; tam DN
// ya da yalin CN adi girilebilir.
//
// Panelin kendisi ortak (TabAccessPanel, 2026-09-23): Nginx Hub Erisimi ayni davranisi
// kullaniyor, burada yalniz METINLER ve API uclari sayfaya ozgudur.
import React from 'react';
import { denetimAccessApi } from '@/api/adminApi';
import { TabAccessPanel } from './TabAccessPanel';

const TAB_LABELS: Record<string, string> = {
  ocp: 'OpenShift', init: 'Init Script', deploy: 'Deployment Scripts', routetraffic: 'Route Trafiği', envanter: 'Envanter', degisim: 'Envanter Değişim', appenvs: 'JBoss/WAS', webapp: 'Web-App',
};

export default function DenetimAccessTab() {
  return (
    <TabAccessPanel
      api={denetimAccessApi}
      labels={TAB_LABELS}
      subject="Denetim"
      title="Denetim sayfası erişimi"
      emptyText="Henüz kimseye açılmamış — Denetim sayfasını yalnız yöneticiler görüyor."
      intro={
        <>
          Middleware İç Denetim sayfası <b>yalnız yöneticilere</b> açıktır. Buradan bir <b>kullanıcıya</b> ya da bir <b>LDAP (AD) grubuna</b> seçtiğiniz
          sekmeleri açabilirsiniz; kişi yalnız o sekmeleri görür, diğer sekmelerin verisi sunucu tarafında da kapalıdır (403).
          Grup için CN adı (örn. <code className="px-1 rounded bg-[var(--bg-elevated)]">GT-Middleware</code>) ya da tam DN girilebilir; eşleşme
          kullanıcının oturumundaki <code className="px-1 rounded bg-[var(--bg-elevated)]">memberOf</code> listesine göre yapılır. Değişiklik anında
          yayılır (açık oturumlar yeniden giriş yapmadan görür).
        </>
      }
    />
  );
}
