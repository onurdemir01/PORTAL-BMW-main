// src/components/admin/tabs/NginxAccessTab.tsx — Admin > "Nginx Hub Erişimi" (2026-09-23).
//
// Kullanıcı: "Nginx Hub'a da istediğim kullanıcıları sokmak istiyorum ama yine sadece
// istediğim sayfaları görsünler — CIS, SPA, API Envanteri, Envanter, Audit gibi."
//
// DENETİM'DEN FARKI: Nginx Hub sekmeleri varsayılan olarak AÇIKTIR (bugün sayfayı gören
// herkes tüm sekmeleri görüyor; bunu bir anda kapatmak çalışan ekranları karartırdı).
// Bu yüzden bir kişi/grup için kayıt açıldığında seçilmeyen sekmelere sunucu tarafında
// açıkça "kapalı" kuralı yazılır — yani kayıt, o kişiyi SEÇİLEN sekmelerle sınırlar.
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
      emptyText="Henüz kimse sınırlandırılmamış — Nginx Hub'ı görebilen herkes tüm sekmeleri görüyor."
      intro={
        <>
          Nginx Hub sekmeleri <b>varsayılan olarak açıktır</b>: sayfayı görebilen herkes tüm sekmeleri görür.
          Buradan bir <b>kullanıcıyı</b> ya da bir <b>LDAP (AD) grubunu</b> seçtiğiniz sekmelerle <b>sınırlarsınız</b> —
          sayfa o kişiye açılır, seçilmeyen sekmeler hem menüden kalkar hem de verisi sunucu tarafında kapanır (403).
          Örneğin yalnız <code className="px-1 rounded bg-[var(--bg-elevated)]">CIS</code>,{' '}
          <code className="px-1 rounded bg-[var(--bg-elevated)]">SPA</code>,{' '}
          <code className="px-1 rounded bg-[var(--bg-elevated)]">API Envanteri</code>,{' '}
          <code className="px-1 rounded bg-[var(--bg-elevated)]">Envanter</code> ve{' '}
          <code className="px-1 rounded bg-[var(--bg-elevated)]">Audit</code> seçilirse kişi diğer sekmeleri hiç görmez.
          Kaydı <b>kaldırmak</b> kişiyi varsayılana (tüm sekmeler) döndürür. Grup için CN adı ya da tam DN girilebilir;
          eşleşme oturumdaki <code className="px-1 rounded bg-[var(--bg-elevated)]">memberOf</code> listesine göre yapılır
          ve değişiklik anında yayılır.
        </>
      }
    />
  );
}
