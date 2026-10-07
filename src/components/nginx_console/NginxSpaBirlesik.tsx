// src/components/nginx_console/NginxSpaBirlesik.tsx — "SPA" ve "Gerçek SPA Keşfi"
// sekmeleri BİRLEŞTİRİLDİ (kullanıcı, 2026-10-08).
//
// Kullanıcı: "Bu Nginx Hub'daki SPA ile Gerçek SPA Keşfi sayfalarını birleştirelim
// istiyorum, çünkü kafa karıştırmaya başladı. Şimdi bu SPA sayfasında Dev/Test/QA/Prod
// diye çıkan bar gösterimleri var, bir de Production Taşımaları sayfası var. Bunlar
// olduğu gibi Gerçek SPA Keşfi sayfasına taşıyabiliriz."
//
// ── NEDEN SARMALAYICI, NEDEN BİLEŞENLERİN İÇİNE GİRİLMEDİ ──────────────────────────
// `NginxSpaDiscovery` 2.500 satır, `NginxSpaAudit` kendi katman anahtarını (internet /
// intranet / taşıma) taşıyor. İkisini tek bileşene eritmek, davranışı korumak istediğimiz
// yerde (kullanıcı "olduğu gibi" dedi) en riskli yol olurdu. Bu kabuk yalnızca ALT SEKME
// tutar; iki sayfa da olduğu gibi kalır.
//
// "Production Taşımaları" AYRI bir giriş GEREKTİRMEZ: `NginxSpaAudit`in kendi katman
// anahtarında zaten duruyor (tier='tasima'). Buraya üçüncü bir alt sekme koymak, aynı
// şeye iki kapı açmak olurdu - birleştirmenin amacı tam olarak bunu bitirmek.
//
// ── YETKİ ──────────────────────────────────────────────────────────────────────────
// İki sekmenin AYRI görünürlük anahtarı vardı (`tab:nginx:spa`, `tab:nginx:spadiscovery`).
// Birleşince anahtarlardan birini çöpe atmak, yalnız ona yetkisi olan kullanıcının
// erişimini SESSİZCE kaldırırdı. Bu yüzden `kapsamGorunur` dışarıdan gelir: Kapsam alt
// sekmesi yalnız eski `tab:nginx:spa` yetkisi olanlara görünür.
import React, { useState } from 'react';
import NginxSpaDiscovery from './NginxSpaDiscovery';
import { NginxSpaAudit } from '@/components/DenetimPage';

type Bolum = 'kesif' | 'kapsam';

interface Props {
  /** Eski `tab:nginx:spa` yetkisi — Kapsam & Taşıma alt sekmesini açar. */
  kapsamGorunur: boolean;
  /** Eski `tab:nginx:spadiscovery` yetkisi — Gerçek Keşif alt sekmesini açar. */
  kesifGorunur: boolean;
}

export default function NginxSpaBirlesik({ kapsamGorunur, kesifGorunur }: Props) {
  // İLK BÖLÜM YETKİYE GÖRE: yalnız Kapsam yetkisi olan kullanıcıya boş bir "Keşif"
  // ekranı açmak, "veri yok" ile "yetkin yok"u karıştırmak olurdu.
  const [bolum, setBolum] = useState<Bolum>(kesifGorunur ? 'kesif' : 'kapsam');

  const bolumler: { id: Bolum; label: string; aciklama: string; gorunur: boolean }[] = [
    {
      id: 'kesif',
      label: 'Gerçek SPA Keşfi',
      aciklama: 'Pod içinde nginx process ölçümü — uygulama GERÇEKTEN SPA mı',
      gorunur: kesifGorunur,
    },
    {
      id: 'kapsam',
      label: 'Kapsam & Taşıma',
      aciklama: 'Dev/Test/QA/Prod kapsam barları, route istatistikleri ve Production Taşımaları',
      gorunur: kapsamGorunur,
    },
  ];
  const acik = bolumler.filter((b) => b.gorunur);

  // HİÇBİR BÖLÜME YETKİ YOKSA bunu AÇIKÇA söyle. Boş bir kabuk göstermek, kullanıcının
  // veri bekleyip beklemediğini bilmemesi demekti.
  if (acik.length === 0) {
    return (
      <div className="text-sm px-4 py-6" style={{ color: 'var(--text-muted)' }}>
        Bu bölüm için görünürlük yetkiniz yok.
      </div>
    );
  }

  const etkin = acik.some((b) => b.id === bolum) ? bolum : acik[0].id;

  return (
    <div className="space-y-3">
      {/* Tek bölüm görünüyorsa alt sekme çubuğu GÖSTERİLMEZ: tıklanacak tek şey olan
          bir sekme çubuğu gürültüdür. */}
      {acik.length > 1 && (
        <div
          className="flex items-center gap-1 p-1 rounded-lg w-fit"
          style={{ background: 'var(--bg-elevated)' }}
        >
          {acik.map((b) => (
            <button
              key={b.id}
              type="button"
              onClick={() => setBolum(b.id)}
              title={b.aciklama}
              className={`px-3 py-1.5 text-xs font-medium rounded-md ${etkin === b.id ? 'shadow-sm' : ''}`}
              style={{
                background: etkin === b.id ? 'var(--bg-surface)' : 'transparent',
                color: etkin === b.id ? 'var(--text-primary)' : 'var(--text-muted)',
              }}
            >
              {b.label}
            </button>
          ))}
        </div>
      )}
      {etkin === 'kesif' ? <NginxSpaDiscovery /> : <NginxSpaAudit />}
    </div>
  );
}
