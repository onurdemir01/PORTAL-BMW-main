// src/components/common/EmptyState.tsx — "burada henuz bir sey yok" durumlari.
//
// Bilesen VARDI ama yalnizca IKI dosyada kullaniliyordu; buna karsilik repoda 76
// ayri elle yazilmis "bulunamadi" metni vardi. Sonuc: ayni durum ekrandan ekrana
// farkli yazi boyutu, farkli bosluk ve farkli renkle gorunuyordu.
//
// IKI BICIM var, cunku iki farkli baglam var:
//   * <EmptyState>     — SAYFA/BOLUM duzeyinde: ikon + baslik + aciklama + aksiyon.
//   * <TableEmptyRow>  — TABLO ICINDE: tek bir <tr><td colSpan>. Buraya ikonlu,
//     buyuk bir blok koymak tablo duzenini bozardi; ayni dili konusan ama satira
//     sigan bir bicim gerekiyordu.
import React from "react";

interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
}

// PatternFly EmptyState: ortalanmis gri ikon, 16px baslik, aciklama, birincil aksiyon.
export default function EmptyState({ icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center text-center py-12 px-6">
      {icon && (
        <div className="mb-4 text-[2.25rem] flex justify-center" style={{ color: "var(--text-muted)" }}>
          {icon}
        </div>
      )}
      <h2 style={{ fontFamily: "var(--font-display)", fontSize: "1rem", fontWeight: 500, color: "var(--text-primary)" }}>
        {title}
      </h2>
      {description && (
        <p className="mt-2 max-w-md text-[0.875rem]" style={{ color: "var(--text-muted)" }}>{description}</p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

/** Tablo govdesinde "kayit yok" satiri. `colSpan` ZORUNLU: eksik verilirse hucre
 *  tek kolona sikisir ve metin tablonun solunda ezik gorunur. */
export function TableEmptyRow({
  colSpan, title = "Kayıt bulunamadı.", description,
}: { colSpan: number; title?: string; description?: string }) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-3 py-10 text-center">
        <p className="text-[0.875rem]" style={{ color: "var(--text-secondary)" }}>{title}</p>
        {description && (
          <p className="mt-1 text-[0.75rem]" style={{ color: "var(--text-muted)" }}>{description}</p>
        )}
      </td>
    </tr>
  );
}
