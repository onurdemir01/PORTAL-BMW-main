// Etiket / Analiz karşılaştırma raporu (Faz 4, 2026-11-11).
//   KRR1 sayılar kartlarda; varsayılan liste uyumluları göstermez; kart tıklanınca o sınıf süzülür
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const m = vi.hoisted(() => ({ iliskiKarsilastirma: vi.fn() }));
vi.mock('@/api/serverHubApi', async (orig) => ({ ...(await orig<typeof import('@/api/serverHubApi')>()), serverHubApi: m }));

import KarsilastirmaRaporu from '@/components/server_hub/KarsilastirmaRaporu';

describe('Karşılaştırma raporu', () => {
  it('KRR1 sayılar, varsayılan süzgeç, sınıf seçimi', async () => {
    const satir = (sinif: string, konu: string) => ({ sinif, konu, ortam: 'PROD', nesil: 8, etiket: null, etiketSeviye: 'KESIN', kurallar: ['R1'], grup: null, grupKarar: 'KULLANIMDA' });
    m.iliskiKarsilastirma.mockResolvedValue({
      ok: true,
      latestScan: '2026-11-11',
      sayilar: { KRITIK_A_KESIN_B_KULLANIMDA: 1, A_KESIN_B_KARARSIZ: 0, B_ADAY_A_YOK: 0, B_ADAY_A_ENGEL: 0, A_ONLY_EAR_GIRDI: 0, ANAHTAR_ESLENEMEDI: 0, UYUM: 1 },
      satirlar: [satir('KRITIK_A_KESIN_B_KULLANIMDA', 'TEHLIKELI'), satir('UYUM', 'UYUMLU')],
    });
    render(<KarsilastirmaRaporu />);
    expect(await screen.findByText('TEHLIKELI')).toBeInTheDocument();
    expect(screen.queryByText('UYUMLU')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Uyumlu/ }));
    expect(screen.getByText('UYUMLU')).toBeInTheDocument();
    expect(screen.queryByText('TEHLIKELI')).toBeNull();
  });
});
