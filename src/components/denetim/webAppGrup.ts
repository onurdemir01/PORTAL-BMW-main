// src/components/denetim/webAppGrup.ts — Denetim > Web-App: uygulama başına TEK satır (2026-10-16).
//
// Kullanıcı: "bir uygulamaya ait uygulama sunucularını ve onunla eşleşen web sunucularını tek sıraya
// işleyemez miyiz? sanki her bir uygulama sunucusu için ayrı ayrı aynı web sunucular tekrar tekrar
// yazılmış". Sunucu her (uygulama, uygulama sunucusu) çiftine bir satır döner; mod_cluster ve AJP
// eşleşmesi aynı site + ortamdaki web sunucularını HER uygulama sunucusu için ayrı ayrı getirdiği için
// aynı web sunucuları satır satır tekrarlanıyordu. Burada (uygulama, ortam) başına toplanır: uygulama
// sunucuları listelenir, web sunucuları (host + ip + port + server_name + conf) TEKİLLEŞTİRİLİR ve her
// birinin hangi uygulama sunucusundan geldiği saklanır. Ortam ayrı tutulur: aynı paket adı QA'da da
// çalışabilir (bkz. server/retirement/discover.cjs hedefOrtami) — prod ile QA tek satıra karışmamalı.
import type { WebAppRow, WebAppVhost } from '@/api/denetimApi';

export interface WebAppGrupVhost extends WebAppVhost {
  /** Bu vhost'u bulan uygulama sunucuları. */
  uygulamaSunuculari: string[];
  /** İlk bulan satır (DNS bölgesi geri düşüşü için). */
  satir: WebAppRow;
}

export interface WebAppGrup {
  anahtar: string;
  app: string;
  env: string;
  /** Tekil topolojiler (sunucular farklı topolojide olabilir). */
  tiers: string[];
  /** Uygulama sunucusu başına özgün satırlar (sıralı). */
  satirlar: WebAppRow[];
  web: WebAppGrupVhost[];
}

const vhostAnahtari = (w: WebAppVhost) =>
  [w.host, w.ip, w.port, (w.serverName || '').trim().toLowerCase(), w.confFile].map((x) => String(x ?? '').trim().toUpperCase()).join('|');

export function grupla(rows: WebAppRow[]): WebAppGrup[] {
  const gruplar = new Map<string, WebAppGrup>();
  for (const r of rows) {
    const anahtar = `${r.app}|${r.env}`;
    let g = gruplar.get(anahtar);
    if (!g) {
      g = { anahtar, app: r.app, env: r.env, tiers: [], satirlar: [], web: [] };
      gruplar.set(anahtar, g);
    }
    g.satirlar.push(r);
    if (!g.tiers.includes(r.tier)) g.tiers.push(r.tier);
    for (const w of r.web) {
      const k = vhostAnahtari(w);
      const var_ = g.web.find((x) => vhostAnahtari(x) === k);
      if (var_) {
        if (!var_.uygulamaSunuculari.includes(r.appHost)) var_.uygulamaSunuculari.push(r.appHost);
      } else {
        g.web.push({ ...w, uygulamaSunuculari: [r.appHost], satir: r });
      }
    }
  }
  return [...gruplar.values()];
}
