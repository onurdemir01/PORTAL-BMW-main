// src/components/admin/tabs/LogXAdminTab.tsx — Admin > LOGX YÖNETİMİ.
//
// 2026-10-02 (kullanıcı: "LogX yönetimi daha ayrı belirgin olsun, ScaleX yönetimi
// gibi"): LogX'e özgü her şey tek sayfada, kart bölümlerle. Eskiden bu bölümler "OCP
// Yapılandırma" sekmesinin alt sekmeleri arasında dağınıktı — o sekme LogX, OpsX,
// Telnet ve ScaleX'in ORTAK OCP ayarlarını taşıdığı için LogX'i orada bulmak zordu.
//
// Cluster / vault anahtarı / bastion BURADA DEĞİL: ortak oldukları için OCP
// Yapılandırma'da kalır (ScaleX Yönetimi ile aynı sözleşme).
import React from 'react';
import { DocumentMagnifyingGlassIcon } from '@heroicons/react/24/outline';
import LogXErisim from './logxv2/LogXErisim';
import {
  EnvSuffixSection,
  MaskRulesSection,
  PlaybookReadinessPanel,
  RequestsSection,
} from './logxv2/LogXBolumleri';
import InventoryGapsTab from './InventoryGapsTab';

const BOLUMLER = [
  { id: 'logx-erisim', baslik: 'Erişim', aciklama: 'Kim, hangi uygulama / namespace / ortamın loglarını alabilir; kaynak sahipleri; "neden reddedildi?" ve red günlüğü.' },
  { id: 'logx-awx', baslik: 'AWX hazırlık durumu', aciklama: 'LogX işlerinin bağlı olduğu AWX şablonları başlatılmaya hazır mı.' },
  { id: 'logx-istekler', baslik: 'İstek İzleme', aciklama: 'Son LogX istekleri ve durumları.' },
  { id: 'logx-maske', baslik: 'Maskeleme Kuralları', aciklama: 'AI analizinde uygulanan PII maskeleri.' },
  { id: 'logx-sonek', baslik: 'Legacy Ortam Son-Eki', aciklama: 'EAR klasör son-eki ("-T") → ortam etiketi ("TEST"); Legacy ortam kısıtları buradan türer.' },
  { id: 'logx-bosluk', baslik: 'Envanter Boşlukları', aciklama: 'Kullanıcıların elle girdiği ama envanterde olmayan uygulama/sunucular.' },
] as const;

const ICERIK: Record<(typeof BOLUMLER)[number]['id'], React.ReactNode> = {
  'logx-erisim': <LogXErisim />,
  'logx-awx': <PlaybookReadinessPanel />,
  'logx-istekler': <RequestsSection />,
  'logx-maske': <MaskRulesSection />,
  'logx-sonek': <EnvSuffixSection />,
  'logx-bosluk': <InventoryGapsTab />,
};

const LogXAdminTab: React.FC = () => (
  <div className="space-y-5">
    <div className="flex items-start gap-2.5">
      <DocumentMagnifyingGlassIcon
        aria-hidden="true"
        className="w-5 h-5 flex-shrink-0 mt-0.5 text-[var(--text-secondary)]"
      />
      <div>
        <p className="text-sm font-semibold text-[var(--text-primary)]">LogX Yönetimi</p>
        <p className="mt-0.5 text-xs text-[var(--text-muted)]">
          LogX&apos;e özgü ayarlar. Cluster / vault anahtarı / bastion bilgisi
          <strong> burada değil</strong>: onlar OCP Yapılandırma sekmesinde, tek yerde tutulur ve
          OpsX, Telnet, ScaleX ile <strong>paylaşılır</strong>.
        </p>
      </div>
    </div>

    {/* Bölüm atlama: tek sayfa uzun; aradığına tek tıkla gidilsin. */}
    <nav aria-label="LogX Yönetimi bölümleri" className="flex flex-wrap gap-1.5">
      {BOLUMLER.map((b) => (
        <a
          key={b.id}
          href={`#${b.id}`}
          className="px-3 py-1 text-xs rounded-full border border-[var(--border)] text-[var(--text-secondary)] hover:border-[var(--accent)] hover:text-[var(--text-primary)] transition-colors"
        >
          {b.baslik}
        </a>
      ))}
    </nav>

    {BOLUMLER.map((b) => (
      <section
        key={b.id}
        id={b.id}
        data-testid={b.id}
        className="rounded-xl border border-[var(--border)] p-4 space-y-3 scroll-mt-4"
      >
        <div>
          <p className="text-sm font-semibold text-[var(--text-primary)]">{b.baslik}</p>
          <p className="mt-0.5 text-xs text-[var(--text-muted)]">{b.aciklama}</p>
        </div>
        {ICERIK[b.id]}
      </section>
    ))}
  </div>
);

export default LogXAdminTab;
