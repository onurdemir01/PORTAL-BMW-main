// src/components/nginx_console/SourceNote.tsx — "Bu ekrandaki veri nereden geliyor?" (2026-09-22).
//
// Kullanici: "nginx job'lari iyice karismaya basladi; Nginx Hub'daki verilerin console_fetch'le
// baglantisi var mi? Ben Nginx Audit job'indan cekiyorsun saniyordum." Nginx Hub'da UC ayri kaynak
// yan yana duruyor (dokum / denetim tablolari / CIS tablolari). Her sekmenin basina hangi AWX
// isinin besledigi, verinin ne zamanki hali oldugu ve tazelemek icin ne yapilmasi gerektigi yazilir.
import React from 'react';
import { InformationCircleIcon } from '@heroicons/react/24/outline';

export type SourceKey = 'console' | 'audit' | 'cis' | 'spa' | 'api' | 'inventory';

const SOURCES: Record<SourceKey, { job: string; what: string; refresh: string }> = {
  console: {
    job: 'nginx_console_fetch',
    what: 'sunuculardan alınan konfigürasyon dökümü (/sw/BMW_PORTAL/nginx_console/raw)',
    refresh: 'Instances sekmesinden sunucu seçip “Seçilileri yenile”; tüm filo için AWX’te gece koşusu.',
  },
  audit: {
    job: 'nginx_audit',
    what: 'dbo.Nginx_Audit_* tabloları (nginx -T tabanlı denetim)',
    refresh: 'AWX’te nginx_audit job’ı (günlük); tarama 30-40 dk sürer.',
  },
  cis: {
    job: 'nginx_cis',
    what: 'dbo.Nginx_Cis_* tabloları (CIS Benchmark ölçümleri)',
    refresh: '“Skoru tazele” düğmesi tüm filoyu, satırdaki “tazele” tek sunucuyu yeniden tarar.',
  },
  spa: {
    job: 'nginx_config_audit + route_inventory',
    what: 'dbo.Nginx_Config_Audit ve OpenShift route envanteri',
    refresh: 'AWX’te nginx_config_audit ve route_inventory job’ları (günlük).',
  },
  api: {
    job: 'nginx_ratelimit_inventory',
    what: 'dbo.NginxRateLimitInventory (API/location ve rate limit taraması)',
    refresh: 'AWX’te nginx_ratelimit_inventory job’ı (günlük).',
  },
  inventory: {
    job: 'nginx_metadata',
    what: 'dbo.nginx_inventory (sunucu üst verisi; her koşuda sıfırdan yazılır)',
    refresh: 'AWX’te nginx_metadata job’ı (günlük).',
  },
};

/**
 * `scanDate`:
 *   - string → "son tarama <tarih>"
 *   - null   → "tarama kaydı yok" (uyarı rengiyle)
 *   - undefined → tarih hiç yazılmaz (sekmenin kendi özetinde zaten var)
 */
export function SourceNote({ source, scanDate, extra }: { source: SourceKey; scanDate?: string | null; extra?: React.ReactNode }) {
  const s = SOURCES[source];
  return (
    <div
      className="flex items-start gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px]"
      style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-elevated)', color: 'var(--text-muted)' }}
    >
      <InformationCircleIcon className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
      <div>
        <b style={{ color: 'var(--text-secondary)' }}>Kaynak:</b> <span className="font-mono">{s.job}</span> — {s.what}
        {scanDate ? <> · <b style={{ color: 'var(--text-secondary)' }}>son tarama {scanDate}</b></> : scanDate === null ? <> · <span style={{ color: 'var(--status-warning)' }}>tarama kaydı yok</span></> : null}
        <span> · Tazelemek için: {s.refresh}</span>
        {extra ? <> · {extra}</> : null}
      </div>
    </div>
  );
}

export { SOURCES as NGINX_SOURCES };
