// src/routes/TasinanSekme.tsx — Taşınan sekmenin eski adresini yeni sayfaya yönlendirir (2026-11-13).
//
// IP/Sunucu Sorgu ve OCP Uygulama Sorgu BMW Hub sayfasındaki sekmeden (?sekme=ip|ocp), Yük Testi Nginx Hub
// sekmesinden (?tab=yuktesti) BMW Hub menüsündeki ayrı sayfalara taşındı. Yer imleri ve paylaşılan bağlantılar
// (ör. Yük Testi'nin ?yt=coklu&kosular=... karşılaştırma adresleri) diğer parametreleri koruyarak yeni adrese gider.
// Reboot Kontrolü ve Retirement da (?sekme=reboot|retirement) aynı gün ayrı sayfa oldu. Yönlendirme router state'ini
// de taşır: eski adrese state ile gelen (ör. Server Hub'ın retireOneri'si) yeni sayfada kaybolmasın.
import React from 'react';
import { Navigate, useLocation, useSearchParams } from 'react-router-dom';

export default function TasinanSekme({ param, deger, hedef, children }: {
  param: string;
  deger: string | string[];
  hedef: string | Record<string, string>;
  children: React.ReactElement;
}) {
  const [sp] = useSearchParams();
  const location = useLocation();
  const v = sp.get(param);
  const degerler = Array.isArray(deger) ? deger : [deger];
  if (!v || !degerler.includes(v)) return children;
  const yol = typeof hedef === 'string' ? hedef : hedef[v];
  if (!yol) return children;
  const kalan = new URLSearchParams(sp);
  kalan.delete(param);
  const q = kalan.toString();
  return <Navigate to={`${yol}${q ? `?${q}` : ''}`} replace state={location.state} />;
}
