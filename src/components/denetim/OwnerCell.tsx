// src/components/denetim/OwnerCell.tsx — uygulamanin sorumlu EKIBI (namespace sahibi).
//
// Kaynak: dbo.Openshift_Namespace_Owners (CMDB sorumlu grubu). Uc durum ayri gorunur:
//   - grup adi        : sahip cozulmus
//   - "bilinmiyor"    : namespace var ama CMDB'de sorumlu yok / cozulememis
//   - "veri yok"      : tablo hic okunamadi (DDL/akis yok) - ekran yanlis alarm uretmesin
import React from 'react';
import type { AppOwner } from '@/api/denetimApi';

/** Uzun AD grup adlarini kisalt: "GT-DIGITAL-BANKING-CH-DEVELOPERS" -> son parcalar okunur kalsin. */
function shortGroup(g: string): string {
  return g.length > 34 ? '…' + g.slice(-32) : g;
}

export function OwnerCell({ owner, ready = true }: { owner?: AppOwner; ready?: boolean }) {
  if (!ready) return <span className="text-[10px] text-[var(--text-muted)]" title="dbo.Openshift_Namespace_Owners okunamadı">veri yok</span>;
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
      {owner.groups.map((g, i) => (
        <span
          key={g}
          className="text-[10px] px-1.5 py-0.5 rounded border font-medium whitespace-nowrap"
          style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-elevated)', color: 'var(--text-secondary)' }}
          title={[g, owner.emails[i] || '', owner.namespaces?.length ? 'namespace: ' + owner.namespaces.join(', ') : ''].filter(Boolean).join('\n')}
        >
          {shortGroup(g)}
        </span>
      ))}
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
