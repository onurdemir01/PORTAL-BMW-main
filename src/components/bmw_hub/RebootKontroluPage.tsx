// src/components/bmw_hub/RebootKontroluPage.tsx — BMW Hub › Reboot Kontrolü (2026-11-13).
//
// Kullanıcı: "Reboot Kontrolü ile Retirement'ı Açık İşlerin içine koydun, BMW Hub'a eklemeni istemiştim." 2026-11-11'den
// beri BMW Hub sayfasında (Açık İşler) sekmeydi; artık sol menüde BMW Hub grubunda ayrı sayfa. Eski
// /bmw-hub?sekme=reboot adresi App.tsx'te buraya yönlenir. Ayrı dosya: tembel yüklenen parça yalnız bu sayfanın kodunu taşır.
import React from 'react';
import SectionHeader from '@/components/common/SectionHeader';
import RebootKontroluTab from '@/components/server_hub/RebootKontroluTab';

export default function RebootKontroluPage() {
  return (
    <div className="space-y-5">
      <SectionHeader
        title="Reboot Kontrolü"
        subtitle="Reboot öncesi ve sonrası çalıştırın: önce çalışan ürün ve JVM sonra da çalışmalı; kapalı kalan açılır, önce olmayan JVM kapatılır. Ölçülemeyen sunucu sorunsuz sayılmaz."
      />
      <RebootKontroluTab />
    </div>
  );
}
