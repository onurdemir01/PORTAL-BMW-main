// src/components/bmw_hub/RetirementPage.tsx — BMW Hub › Retirement (2026-11-13).
//
// Kullanıcı: "Reboot Kontrolü ile Retirement'ı Açık İşlerin içine koydun, BMW Hub'a eklemeni istemiştim." 2026-11-11'den
// beri BMW Hub sayfasında (Açık İşler) sekmeydi; artık sol menüde BMW Hub grubunda ayrı sayfa. Eski
// /bmw-hub?sekme=retirement adresi App.tsx'te router state'iyle birlikte buraya yönlenir.
import React, { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import SectionHeader from '@/components/common/SectionHeader';
import RetirementTab from '@/components/server_hub/RetirementTab';

export default function RetirementPage() {
  const location = useLocation();
  const navigate = useNavigate();
  // Server Hub (Bulgular / Uygulama 360 / Retirement Analizi) "Retirement kaydı aç" buraya location.state ile
  // gelir; her yeni istek kayıt formunu bir kez açar, durum hemen temizlenir (yenileme / geri tuşu formu tekrar
  // açmasın). URL'e uygulama adı yazılmaz.
  const [retireOneri, setRetireOneri] = useState<{ uygulama: string; not: string; no: number } | null>(null);
  const gelen = (location.state as { retireOneri?: { uygulama: string; not: string } } | null)?.retireOneri;
  // Render sırasında ayar (effect'te setState yok): her yeni geçiş (location.key) bir kez işlenir.
  const [islenenKey, setIslenenKey] = useState<string | null>(null);
  if (gelen?.uygulama && location.key !== islenenKey) {
    setIslenenKey(location.key);
    setRetireOneri((o) => ({ uygulama: gelen.uygulama, not: gelen.not || '', no: (o ? o.no : 0) + 1 }));
  }
  useEffect(() => {
    if (gelen?.uygulama) navigate(`${location.pathname}${location.search}`, { replace: true, state: null });
  }, [gelen, location.pathname, location.search, navigate]);
  return (
    <div className="space-y-5">
      <SectionHeader
        title="Retirement"
        subtitle="Uygulama retirement: Smart silme kaydı → tüm ortam/site keşfi → STOP (auto-start kapat, durdur, paketi .old) → seçilen tarihte silme → IP/LB/DNS kayıtları."
      />
      <RetirementTab oneri={retireOneri} />
    </div>
  );
}
