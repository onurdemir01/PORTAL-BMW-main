// src/components/admin/tabs/CryptoAccessTab.tsx — Admin > "Crypto Hub Erişimi" (2026-10-01).
//
// Kullanıcı: "Admin merkezinde Crypto Hub'ın görünümünü komple ayır, erişime, Nginx Hub
// erişimi gibi ekle. Çünkü Metaco ve Wyden tarafını farklı ekiplere göstereceğiz."
//
// Model Nginx Hub ile aynı: sayfa + SEÇİLEN uygulamalar. Fark, buradaki öğelerin SIKI
// olması — Crypto Hub sayfası zaten sıkı (kullanıcının 2026-09-26 isteği), uygulama
// öğeleri de öyle. Açık kural olmadan hiçbiri görünmez ve admin muafiyeti de yoktur.
//
// E-POSTA SEÇENEĞİ VAR: Crypto Hub kuralları üretimde e-postayla giriliyor (LDAP kullanıcı
// adı bilinmeden). Denetim/Nginx panelleri eskisi gibi yalnız kullanıcı + grup gösterir.
import React from 'react';
import { cryptoAccessApi } from '@/api/adminApi';
import { TabAccessPanel } from './TabAccessPanel';

const APP_LABELS: Record<string, string> = {
  metaco: 'Metaco',
  wyden: 'Wyden',
};

export default function CryptoAccessTab() {
  return (
    <TabAccessPanel
      api={cryptoAccessApi}
      labels={APP_LABELS}
      subject="Crypto Hub"
      title="Crypto Hub uygulama erişimi"
      principalTypes={['email', 'user', 'group']}
      tabWord="uygulama"
      emptyText="Henüz kimseye açılmamış — Crypto Hub'ı kimse görmüyor (yöneticiler dahil)."
      intro={
        <>
          Crypto Hub <b>sıkı</b> bir sayfadır: açık bir kural olmadan <b>yönetici bile</b>{' '}
          göremez. Buradan bir <b>e-postaya</b>, <b>kullanıcıya</b> ya da <b>LDAP (AD) grubuna</b>{' '}
          sayfayı ve <b>seçtiğiniz uygulamaları</b> açarsınız.
          <br />
          Seçilmeyen uygulama hem seçim ağacında görünmez hem de verisi{' '}
          <b>sunucu tarafında kapalıdır</b> — tenant anahtarı elle gönderilse bile 403 döner.
          Örneğin yalnız <code className="px-1 rounded bg-[var(--bg-elevated)]">Metaco</code>{' '}
          seçilirse kişi Wyden ortamlarını hiç görmez.
          <br />
          Kaydı <b>kaldırmak</b> kişinin Crypto Hub erişimini tamamen kapatır. Grup için CN adı
          ya da tam DN girilebilir; eşleşme oturumdaki{' '}
          <code className="px-1 rounded bg-[var(--bg-elevated)]">memberOf</code> listesine göre
          yapılır ve değişiklik anında yayılır.
        </>
      }
    />
  );
}
