// isi-haritasi.test.ts — Envanter ısı haritası: her seviye İKİ temada AA (≥ 4.5) mı? (2026-11-07)
//
// Oranlar index.css token'larından hesaplanır: zemin = aksan %p + bg-surface %(100-p) (color-mix
// "transparent" ile; hücre bg-surface üstünde). Bir token ya da seviye değişip metin eşiğin altına
// düşerse kızarır. IH2 eski formülün açıkta gerçekten AA altında kaldığını gösterir (bekçi kör değil).
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ISI_SEVIYELERI, KOYU_METIN_SEVIYESI, isiSeviyesi, isiStili } from '../isiHaritasi';

const CSS = fs.readFileSync(path.resolve(__dirname, '../../../index.css'), 'utf8');
function blok(bas: string): Record<string, string> {
  const i = CSS.indexOf(bas);
  const b = CSS.slice(i, CSS.indexOf('\n}', i));
  return Object.fromEntries(
    [...b.matchAll(/(--[a-z0-9-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]),
  );
}
const ACIK = blok(':root {');
const KOYU = { ...ACIK, ...blok(':root[data-theme="dark"] {') };
const hex = (h: string) => {
  const m = /^#([0-9a-f]{6})$/i.exec(h.trim());
  if (!m) throw new Error(`hex değil: ${h}`);
  return [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16));
};
const lum = ([r, g, b]: number[]) => {
  const k = (v: number) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return 0.2126 * k(r) + 0.7152 * k(g) + 0.0722 * k(b);
};
const oran = (a: number[], b: number[]) => {
  const [x, y] = [lum(a), lum(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};
const karisim = (t: Record<string, string>, p: number) => {
  const a = hex(t['--accent']);
  const s = hex(t['--bg-surface']);
  return a.map((v, i) => (v * p + s[i] * (100 - p)) / 100);
};

describe('ısı haritası kontrastı', () => {
  it('IH1 her seviye iki temada metniyle ≥ 4.5', () => {
    const zayif: string[] = [];
    for (const [ad, t] of [
      ['açık', ACIK],
      ['koyu', KOYU],
    ] as const) {
      ISI_SEVIYELERI.forEach((p, i) => {
        const metin = i >= KOYU_METIN_SEVIYESI ? t['--isi-metin-koyu'] : t['--text-primary'];
        const o = oran(hex(metin), karisim(t, p));
        if (o < 4.5) zayif.push(`${ad} %${p}: ${o.toFixed(2)}`);
      });
    }
    expect(zayif).toEqual([]);
  });

  it('IH2 eski formül açık temada AA altındaydı (bekçi ölçüyor)', () => {
    // Eski: %86'da beyaz metin (--text-on-accent açıkta #fff).
    expect(oran(hex(ACIK['--text-on-accent']), karisim(ACIK, 86))).toBeLessThan(4.5);
  });

  it('IH3 seviye seçimi: karekök ölçek, uçlar, metin rengi', () => {
    expect(isiSeviyesi(0, 10).yuzde).toBe(ISI_SEVIYELERI[0]);
    expect(isiSeviyesi(10, 10)).toEqual({ yuzde: 72, koyuMetin: true });
    expect(isiSeviyesi(1, 100)).toEqual({ yuzde: 12, koyuMetin: false });
    expect(isiSeviyesi(30, 100).yuzde).toBe(42); // karekok(0.3) = 0.55 -> 4. seviye
    expect(isiSeviyesi(5, 0).yuzde).toBe(ISI_SEVIYELERI[0]);
    expect(isiStili(10, 10).color).toBe('var(--isi-metin-koyu)');
    expect(isiStili(1, 100).color).toBe('var(--text-primary)');
    expect(isiStili(1, 100).backgroundColor).toBe(
      'color-mix(in srgb, var(--accent) 12%, transparent)',
    );
  });
});
