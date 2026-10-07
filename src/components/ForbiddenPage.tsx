import React from "react";
import { Link } from "react-router-dom";

// 403 — yetkisiz erisim.
//
// DUGME METNI GORUNMUYORDU (2026-10-07, gercek tarayicida olculdu: kontrast 1.0). Baglanti
// `bg-blue-600 text-white` siniflariyla yaziliydi; `index.css`teki katmansiz
// `a { color: var(--accent) }` kurali Tailwind'in `text-white` siniflarini eziyor ve metin
// zeminle AYNI maviye boyaniyordu: ekranda bos mavi bir kutu duruyordu. `.btn-primary` kendi
// metin rengini (`--text-on-accent`) tasir ve iki temada da okunur. Sekme basligi
// `useDocumentTitle`daki menu disi yollar tablosundan gelir.
export default function ForbiddenPage() {
  return (
    <div className="card p-8 max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold text-[var(--text-primary)]">403 - Yetkisiz Erişim</h1>
      <p className="mt-2 text-[var(--text-secondary)]">
        Bu sayfaya erişim yetkiniz yok. Eğer erişim talebiniz varsa lütfen admin ile iletişime geçin.
      </p>

      <div className="mt-6 flex gap-3">
        <Link to="/dashboard" className="btn-primary">
          Dashboard’a Dön
        </Link>
      </div>
    </div>
  );
}
