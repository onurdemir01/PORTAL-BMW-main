// src/components/denetim/OwnerCell.tsx — uygulamanin sorumlu EKIBI.
//
// Kaynak (2026-11-02): once uygulamanin kendi CMDB sahibi (dbo.Openshift_App_Owners), yoksa
// namespace sahibi (dbo.Openshift_Namespace_Owners) — ikincisi "(namespace sahibi)" diye isaretlenir.
// Uc durum ayri gorunur:
//   - grup adi        : sahip cozulmus
//   - "bilinmiyor"    : namespace var ama CMDB'de sorumlu yok / cozulememis
//   - "veri yok"      : tablo hic okunamadi (DDL/akis yok) - ekran yanlis alarm uretmesin;
//                       ya da namespace tablosu okunamadi ve uygulamanin kendi sahibi yok (veriYokNs)
import React from 'react';
import type { AppOwner } from '@/api/denetimApi';
import { kaynakEtiketi, nsSahibiMi, NsSahibiIsareti, VERI_YOK_IPUCU } from './EkipKaynak';

/** Uzun AD grup adlarini kisalt: "GT-DIGITAL-BANKING-CH-DEVELOPERS" -> son parcalar okunur kalsin. */
function shortGroup(g: string): string {
  return g.length > 34 ? '…' + g.slice(-32) : g;
}

export function OwnerCell({ owner, ready = true }: { owner?: AppOwner; ready?: boolean }) {
  if (!ready) return <span className="text-[10px] text-[var(--text-muted)]" title="Sahiplik tabloları (dbo.Openshift_App_Owners / dbo.Openshift_Namespace_Owners) okunamadı">veri yok</span>;
  const veriYokNs = owner?.veriYokNs || [];
  if (owner && owner.groups.length === 0 && veriYokNs.length > 0 && owner.unknownNs.length === 0) {
    return (
      <span className="text-[10px] text-[var(--text-muted)]" title={`${VERI_YOK_IPUCU}: ${veriYokNs.join(', ')}`} data-veri-yok="1">
        veri yok
      </span>
    );
  }
  if (!owner || owner.groups.length === 0) {
    const ns = owner?.unknownNs?.length ? owner.unknownNs.join(', ') : '';
    return (
      <span className="text-[10px] text-[var(--text-muted)]" title={ns ? `CMDB'de sorumlu bulunamadı: ${ns}` : 'namespace bilinmiyor'}>
        bilinmiyor
      </span>
    );
  }
  return (
    <span className="inline-flex flex-wrap gap-1">
      {owner.groups.map((g, i) => {
        const k = owner.kaynaklar?.[i];
        return (
          <span key={g} className="inline-flex items-center gap-1">
            <span
              className="text-[10px] px-1.5 py-0.5 rounded border font-medium whitespace-nowrap"
              style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-elevated)', color: 'var(--text-secondary)' }}
              title={[
                g,
                owner.emails[i] || '',
                kaynakEtiketi(k),
                owner.namespaces?.length ? 'namespace: ' + owner.namespaces.join(', ') : '',
              ]
                .filter(Boolean)
                .join('\n')}
            >
              {shortGroup(g)}
            </span>
            {nsSahibiMi(k) && <NsSahibiIsareti />}
          </span>
        );
      })}
      {veriYokNs.length > 0 && (
        <span className="text-[10px] text-[var(--text-muted)]" title={`${VERI_YOK_IPUCU}: ${veriYokNs.join(', ')}`} data-veri-yok="1">
          +veri yok
        </span>
      )}
      {owner.unknownNs.length > 0 && (
        <span className="text-[10px] text-[var(--text-muted)]" title={`sahibi bilinmeyen namespace: ${owner.unknownNs.join(', ')}`}>
          +?
        </span>
      )}
    </span>
  );
}

/** Arama kutusu icin: grup adlari tek metin. */
export function ownerText(owner?: AppOwner): string {
  return owner ? owner.groups.join(' ').toLowerCase() : '';
}
