// src/components/server_hub/RetirementWebSatir.tsx — retirement web (vhost) satirinin ayirt edici bilgisi.
//
// 2026-10-23, Retirement #27 (GBCEPPOSDASHBOARD): "Web sunucusu kolonundaki duplike satirlar niye
// duplike?" Ayni host + ServerName birden cok satir olabilir (:80 / :443 bloklari, farkli conf dosyasi);
// ekran yalniz "host · ServerName" bastigi icin dordu ayni gorunuyordu.
import React from 'react';
import type { RtWeb } from '@/api/retirementApi';

/** Port · conf dosya adi · urun; tam conf yolu ipucunda. */
export function WebAyrinti({ w }: { w: RtWeb }) {
  const conf = String(w.confFile || '');
  const parca = [w.port ? `:${w.port}` : '', conf.split('/').pop() || '', w.product || ''].filter(Boolean);
  if (!parca.length) return null;
  return (
    <span className="ml-1 text-[9px]" style={{ color: 'var(--text-muted)' }} title={conf ? `conf: ${conf}` : undefined} data-testid="rt-web-ayrinti">
      {parca.join(' · ')}
    </span>
  );
}

/** Ayni host + ServerName birden cok satir olabilir; sira da anahtarda - React cocuklari cakismaz. */
export const webKey = (w: RtWeb, i: number) => `${w.host}|${w.serverName}|${w.port || ''}|${w.confFile || ''}|${i}`;
