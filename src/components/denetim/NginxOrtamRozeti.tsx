// src/components/denetim/NginxOrtamRozeti.tsx — Nginx Envanteri ortam rengi / adı ve rozeti.
//
// NginxEnvanteri ile NginxUpstreamEnvanteri (Envanter'in alt sekmesi) ikisi de kullanır; ayrı
// dosyada durur ki iki bileşen birbirini import etmesin (döngü olmasın).
import React from 'react';

const ORTAM_AD: Record<string, string> = { BILINMIYOR: 'Kalıp dışı' };
const ORTAM_RENK: Record<string, string> = {
  PROD: 'var(--nh-hub)',
  QA: 'var(--status-info)',
  TEST: 'var(--accent)',
  DEV: 'var(--ah-hue)',
  EDU: 'var(--bh-hue)',
  BILINMIYOR: 'var(--status-neutral)',
};
export const ortamAdi = (o: string) => ORTAM_AD[o] || o;
export const ortamRengi = (o: string) => ORTAM_RENK[o] || 'var(--status-neutral)';

export function OrtamRozeti({ ortam }: { ortam: string }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-semibold border whitespace-nowrap"
      style={{
        borderColor: 'var(--border-subtle)',
        color: 'var(--text-primary)',
        background: 'var(--bg-surface)',
      }}
    >
      <span
        aria-hidden="true"
        className="w-2 h-2 rounded-full"
        style={{ background: ortamRengi(ortam) }}
      />
      {ortamAdi(ortam)}
    </span>
  );
}
