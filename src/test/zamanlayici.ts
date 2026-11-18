// src/test/zamanlayici.ts — sahte setInterval'li yoklama testleri icin ortak yardimci (2026-11-18).
import { act } from '@testing-library/react';
import { vi } from 'vitest';

/**
 * Sahte zamani ilerletmeden ONCE bir zamanlayicinin kurulmasini bekler, sonra ilerletir.
 *
 * Yoklama zamanlayicisini bir useEffect kurar. Ekran guncellendiginde effect yuk altinda henuz
 * kosmamis olabilir; o zaman zaman zamanlayicisiz ilerler, yoklama hic tetiklenmez ve test oynar
 * (CI'da ET11 / ETT17 / TT3). Zamanlayici hic kurulmazsa (orn. sekme gizli) en cok ~1 sn beklenir
 * ve yine ilerlenir: "istek yok" testlerinin anlami degismez.
 */
export async function zamanlayiciKuruluncaIlerlet(ms: number): Promise<void> {
  for (let i = 0; i < 200 && vi.getTimerCount() === 0; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 5));
    });
  }
  await act(async () => {
    vi.advanceTimersByTime(ms);
  });
}
