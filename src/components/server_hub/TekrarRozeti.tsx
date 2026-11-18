// src/components/server_hub/TekrarRozeti.tsx — vhost'un tekrar eden (sağlık kontrolü benzeri) istekleri (2026-11-18).
// Kullanıcı: "health check istekleri hc.html / hc.jsp dışında farklı biçimlerde olabiliyor; yalnız tekrar
// eden satırlar varsa retire edilecek olabilir diye label'la; tespit edilen health check URI'sini yansıt".
// Tarayıcı (server_hub_scan.sh, scan_ver 2.6) VHOST.repeat_7d / repeat_uris yazar; assess repeat7d / repeatUris.
import type { ShVhost } from '@/api/serverHubApi';

export type TekrarDurumu = 'YALNIZ' | 'KISMEN' | null;

/** YALNIZ: 7 gündür yalnız tekrar eden istek; KISMEN: tekrar eden istek var ama gerçek istek de var; null: yok / ölçülemedi. */
export function tekrarDurumu(v: Pick<ShVhost, 'req7d' | 'repeat7d' | 'repeatUris'>): TekrarDurumu {
  const r = v.repeat7d;
  if (r == null || r <= 0 || v.req7d == null || v.req7d <= 0) return null;
  return r === v.req7d ? 'YALNIZ' : 'KISMEN';
}

export function TekrarRozeti({ v }: { v: Pick<ShVhost, 'req7d' | 'repeat7d' | 'repeatUris'> }) {
  const d = tekrarDurumu(v);
  if (!d) return null;
  const uriler = v.repeatUris || [];
  const baslik = `${d === 'YALNIZ' ? '7 gündür yalnız tekrar eden istek — retire adayı olabilir, elle doğrulayın' : `${v.repeat7d} / ${v.req7d} istek tekrar eden`}. Olası health check: ${
    uriler.map((u) => `${u.metot} ${u.yol} (${u.istek} istek, ${u.istemci} istemci)`).join('; ') ||
    'URI kaydı yok'
  }`;
  return (
    <div
      data-testid="vhost-tekrar"
      className="text-[9px] font-mono text-left truncate max-w-[12rem]"
      style={{ color: d === 'YALNIZ' ? 'var(--status-warning-text)' : 'var(--text-muted)' }}
      title={baslik}
    >
      {d === 'YALNIZ' ? 'yalnız tekrar' : 'olası HC'}
      {uriler[0] ? `: ${uriler[0].metot} ${uriler[0].yol}` : ''}
    </div>
  );
}
