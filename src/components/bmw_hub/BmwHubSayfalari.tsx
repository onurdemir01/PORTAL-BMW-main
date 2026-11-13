// src/components/bmw_hub/BmwHubSayfalari.tsx — BMW Hub menüsündeki ayrı sayfalar (2026-11-13).
//
// Kullanıcı: "IP Sorgu / OCP Uygulama Sorgu sekmeleri buraya (sol menü, BMW Hub grubu) gelmiyor. Ek olarak Yük Testi
// özelliğini de BMW Hub altına koyalım." Dün bu ikisi BMW Hub sayfasının (Açık İşler) içinde sekmeydi; artık sol
// menüde ayrı sayfalar. Eski adresler (/bmw-hub?sekme=ip|ocp, /self-service/ip-sorgu|openshift-sorgu,
// /nginx-console?tab=yuktesti) buraya yönlenir.
import React from 'react';
import SectionHeader from '@/components/common/SectionHeader';
import { useAuth } from '@/contexts/AuthContext';
import IpCheckSection from '@/components/self_service/IpCheckSection';
import OpenshiftCheckSection from '@/components/self_service/OpenshiftCheckSection';
import { YukTestiTab } from '@/components/nginx_console/YukTestiTab';

export function IpSorguPage() {
  return (
    <div className="space-y-5">
      <SectionHeader
        title="IP/Sunucu Sorgu"
        subtitle="Bir IP ya da sunucu adının envanterde neye karşılık geldiğini bulun; sunucu adlarından LB'de kullanılacak IP'leri çıkarın (LB Suspend Exclude List kuralları, AWX işi başlatmadan)."
      />
      <IpCheckSection />
    </div>
  );
}

export function OcpSorguPage() {
  return (
    <div className="space-y-5">
      <SectionHeader title="OCP Uygulama Sorgu" subtitle="OpenShift namespace / uygulama envanterinde arama." />
      <OpenshiftCheckSection />
    </div>
  );
}

export function YukTestiPage() {
  const { user } = useAuth();
  return <YukTestiTab isAdmin={user?.role === 'Admin'} kullaniciAdi={user?.username ?? null} />;
}
