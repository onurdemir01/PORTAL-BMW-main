// src/components/GlomoGecisPlaniPage.tsx — Nginx ARK SPA > Glomo Geçiş Planı (/ark-spa/glomo-gecis-plani).
// Icerik GlomoGecisPlani bileseninde; bu dosya yalniz sayfa cercevesi (2026-10-13: menude ayri sayfa).
import GlomoGecisPlani from '@/components/GlomoGecisPlani';

export default function GlomoGecisPlaniPage() {
  return (
    <div className="p-4 space-y-3">
      <h1 className="text-lg font-semibold">Glomo Geçiş Planı</h1>
      <GlomoGecisPlani />
    </div>
  );
}
