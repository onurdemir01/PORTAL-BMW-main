// src/components/common/Skeleton.tsx — icerik yuklenirken gosterilen iskeletler.
//
// NEDEN SPINNER DEGIL: bos bir spinner "bir sey oluyor" der ama NE oldugunu
// soylemez; gelecek icerigin sekli gorunmedigi icin bekleme daha uzun hissettirir ve
// icerik gelince ekran SICRAR. Iskelet, gelecek yapinin kaba hatlarini gosterir —
// gecis "yukleniyor -> icerik" siicramasi gibi degil, ayni yerin dolmasi gibi olur.
//
// NEREYE UYGULANIR: bir LISTENIN ya da TABLONUN yerini tutan, sayfa/bolum duzeyindeki
// yuklemelere. BUTON ICINDEKI spinner'lara DOKUNULMAZ — orada dogru olan spinner'dir
// (kucuk, yerel, "bu dugme calisiyor" demek icin). Repodaki `animate-spin`
// kullanimlarinin buyuk cogunlugu (50 kadari) bu tur ve BILEREK oldugu gibi birakildi.
import React from "react";

/** Tek bir gri cubuk. `.skeleton` sinifi index.css'te tanimli (shimmer animasyonu). */
export function SkeletonBar({ className = "h-4 w-full" }: { className?: string }) {
  return <div className={`skeleton rounded ${className}`} aria-hidden="true" />;
}

/** Liste/tablo yerini tutan iskelet. `rows` gercek icerige yakin secilmeli:
 *  cok az satir ekrani bos gosterir, cok fazlasi icerik gelince sicratir. */
export function SkeletonList({ rows = 5, className = "" }: { rows?: number; className?: string }) {
  return (
    <div className={`space-y-2 ${className}`} role="status" aria-busy="true" aria-label="İçerik yükleniyor">
      {Array.from({ length: rows }, (_, i) => (
        <div
          key={i}
          className="flex items-center gap-3 px-3 py-2.5 rounded-lg border"
          style={{ borderColor: "var(--border-subtle)" }}
        >
          <SkeletonBar className="h-3.5 w-3.5 rounded-full flex-shrink-0" />
          {/* Genislikler BILEREK esit degil: esit uzunlukta cubuklar bir tabloya
              degil, bir yukleme cubuguna benziyor. */}
          <SkeletonBar className={`h-3.5 ${["w-1/3", "w-1/2", "w-2/5"][i % 3]}`} />
          <div className="flex-1" />
          <SkeletonBar className="h-3 w-16 flex-shrink-0" />
        </div>
      ))}
    </div>
  );
}
