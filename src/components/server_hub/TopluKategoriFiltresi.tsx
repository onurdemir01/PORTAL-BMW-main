// src/components/server_hub/TopluKategoriFiltresi.tsx — Toplu Auto-Start / Toplu Restart başarısızlık kümeleri (2026-11-15).
//
// Öğe tablosunun üstünde: başarısız / düşen öğelerin kategorilere göre sayımı (yalnız sıfır olmayanlar), tıklanınca
// tabloyu süzen çipler (Tümü + her kategori) ve seçili kategorinin "ne yapılır" satırı. Satırdaki küçük etiket
// (KategoriEtiketi) aynı saf fonksiyondan (topluSiniflama.ts siniflandir) gelir.
import React from 'react';
import { fmtNumber } from '@/utils/datetime';
import { KATEGORI, kategoriSayimi, siniflandir, type TopluKategori } from './topluSiniflama';

type Oge = { durum: string; neden?: string | null };

export function TopluKategoriFiltresi({
  ogeler,
  basarisiz,
  secili,
  onSec,
}: {
  ogeler: Oge[];
  basarisiz: Set<string>;
  secili: TopluKategori | null;
  onSec: (k: TopluKategori | null) => void;
}) {
  const sayim = kategoriSayimi(ogeler, basarisiz);
  if (!sayim.length) return null;
  const toplam = sayim.reduce((t, x) => t + x.adet, 0);
  const etkin = secili && sayim.some((x) => x.kategori === secili) ? secili : null;
  const cip = (aktif: boolean): React.CSSProperties => ({
    borderColor: aktif ? 'var(--accent)' : 'var(--border-subtle)',
    color: aktif ? 'var(--accent)' : 'var(--text-secondary)',
    background: aktif ? 'var(--bg-elevated)' : undefined,
  });
  return (
    <div className="space-y-1" role="group" aria-label="Başarısız öğe kategorileri">
      <div className="flex items-center gap-1.5 flex-wrap text-[11px]">
        <span style={{ color: 'var(--text-muted)' }}>
          Başarısız / düşen / atlanan {fmtNumber(toplam)}:
        </span>
        <button
          type="button"
          className="px-2 py-0.5 rounded-full border"
          style={cip(etkin == null)}
          aria-pressed={etkin == null}
          onClick={() => onSec(null)}
        >
          Tümü
        </button>
        {sayim.map((x) => (
          <button
            key={x.kategori}
            type="button"
            className="px-2 py-0.5 rounded-full border tabular-nums"
            style={cip(etkin === x.kategori)}
            aria-pressed={etkin === x.kategori}
            onClick={() => onSec(etkin === x.kategori ? null : x.kategori)}
          >
            {KATEGORI[x.kategori].etiket} {fmtNumber(x.adet)}
          </button>
        ))}
      </div>
      {etkin && (
        <div
          className="text-[11px]"
          style={{ color: 'var(--text-secondary)' }}
          data-testid="kategori-ne-yapilir"
        >
          Ne yapılır: {KATEGORI[etkin].ne}
        </div>
      )}
    </div>
  );
}

/** Başarısız öğe satırındaki küçük kategori etiketi; başarılı / süren öğede yok. */
export function KategoriEtiketi({ oge, basarisiz }: { oge: Oge; basarisiz: Set<string> }) {
  if (!basarisiz.has(oge.durum)) return null;
  const k = siniflandir(oge.neden, oge.durum);
  return (
    <span
      className="mr-1 px-1.5 py-px rounded border text-[10px] whitespace-nowrap"
      style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-muted)' }}
      title={KATEGORI[k].ne}
      data-kategori={k}
    >
      {KATEGORI[k].etiket}
    </span>
  );
}
