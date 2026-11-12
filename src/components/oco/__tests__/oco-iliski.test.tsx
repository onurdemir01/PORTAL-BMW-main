// src/components/oco/__tests__/oco-iliski.test.tsx — OCO Takvimi: açtığımız + bize açılan (2026-11-12).
// Kullanıcı: "bizim açtığımız OCO'lar kayboldu, hem bizim açtığımız OCO'lar hem bize açılan OCO'ları
// aynı anda gösteremez miyiz?"
//   OI1 iki ilişki aynı listede, satırda rozetle; süzgeç yalnız birini gösterir, sayılarıyla
//   OI2 sorgulardan biri düştüyse liste "eksik" der
import { describe, it, expect, vi, afterEach } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { render } from '@/test/test-utils';
import OcoTakvimiPage from '@/components/OcoTakvimiPage';

const satir = (oco: number, iliski: string[]) => ({
  oco, subject: `konu ${oco}`, explanation: '', statusText: '', statusCode: 0, impactText: '', processText: '',
  pcabRequired: false, plannedStart: '2099-01-0' + oco + 'T10:00:00.000Z', plannedEnd: null, actualStart: null,
  actualEnd: null, openedAt: null, iliski,
});
const yanit = (body: unknown) => {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => body })));
};
afterEach(() => vi.unstubAllGlobals());

describe('OCO Takvimi — açtığımız + bize açılan', () => {
  it('OI1 iki ilişki aynı listede; süzgeç ve sayılar', async () => {
    yanit({
      ok: true, rows: [satir(1, ['acan']), satir(2, ['acan', 'sorumlu']), satir(3, ['sorumlu'])], total: 3, fetched: 3,
      truncated: false, kaynak: { acan: { total: 2, fetched: 2, truncated: false }, sorumlu: { total: 2, fetched: 2, truncated: false } }, eksik: [],
    });
    render(<OcoTakvimiPage />);
    expect(await screen.findByText('konu 1')).toBeTruthy();
    const dugmeler = [...document.querySelectorAll('[data-testid="oco-iliski"] button')];
    expect(dugmeler.map((b) => b.textContent)).toEqual(['Tümü3', 'Açtığımız2', 'Bize açılan2']);
    expect(screen.getAllByText('açtığımız').length).toBe(2);
    expect(screen.getAllByText('bize açılan').length).toBe(2);
    fireEvent.click(dugmeler[2]);
    expect(screen.queryByText('konu 1')).toBeNull();
    expect(screen.getByText('konu 2')).toBeTruthy();
    expect(screen.getByText('konu 3')).toBeTruthy();
    expect(screen.getByText(/serviste açtığımız 2, bize açılan 2/)).toBeTruthy();
  });

  it('OI2 bir sorgu düştüyse "eksik" uyarısı', async () => {
    yanit({
      ok: true, rows: [satir(3, ['sorumlu'])], total: 1, fetched: 1, truncated: false,
      kaynak: { sorumlu: { total: 1, fetched: 1, truncated: false } },
      eksik: [{ rol: 'acan', message: "açtığımız OCO'lar alınamadı: zaman aşımı" }],
    });
    render(<OcoTakvimiPage />);
    expect((await screen.findByTestId('oco-eksik')).textContent).toMatch(/açtığımız OCO'lar alınamadı: zaman aşımı/);
  });
});

// OG1 (kullanici, 2026-11-12): gecmis OCO'lar 2024'e kadar birden aciliyordu; her tiklama 7 gun geri.
describe('OCO Takvimi — geçmiş 7 günlük adımlarla', () => {
  const gunOnce = (n: number) => {
    const d = new Date();
    d.setDate(d.getDate() - n);
    d.setHours(10, 0, 0, 0);
    return d.toISOString();
  };
  const r = (oco: number, gun: number) => ({ ...satir(oco, ['sorumlu']), plannedStart: gunOnce(gun) });
  it('OG1 ilk tıklama son 7 gün, sonraki her tıklama 7 gün daha; gizle sıfırlar', async () => {
    yanit({ ok: true, rows: [r(1, 3), r(2, 10), r(3, 400)], total: 3, fetched: 3, truncated: false, eksik: [] });
    render(<OcoTakvimiPage />);
    const ilk = await screen.findByText('Geçen haftanın OCO’larını göster');
    expect(screen.queryByText('konu 1')).toBeNull();
    fireEvent.click(ilk);
    expect(screen.getByText('konu 1')).toBeTruthy();
    expect(screen.queryByText('konu 2')).toBeNull();
    expect(screen.getByText(/son 7 gün · 1 geçmiş OCO · daha eski 2/)).toBeTruthy();
    fireEvent.click(screen.getByText('7 gün daha geriye git'));
    expect(screen.getByText('konu 2')).toBeTruthy();
    expect(screen.queryByText('konu 3')).toBeNull();
    fireEvent.click(screen.getByText('Geçmişi gizle'));
    expect(screen.queryByText('konu 1')).toBeNull();
  });
});
