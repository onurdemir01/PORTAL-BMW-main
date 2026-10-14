// src/components/opsx/__tests__/onay-sonrasi-takip.test.tsx — OpsX Smart onayi sonrasi ana pencere.
//
// Kullanici (2026-10-14): "Smart kaydini onayladigim halde ... ana pencerede halen Smart talebi
// bekleniyormus gibi gozukuyor." Talep durumu aralikla sorulur; LAUNCHED olunca is takibine gecilir.
//   OS1 PENDING -> LAUNCHED: onBasladi (jobId + AWX sunucusu) cagrilir, yoklama durur
//   OS2 REJECTED: talepSonu doner, is BASLATILMAZ
//   OS3 gecici ag hatasi takibi durdurmaz
//   OS4 bekleyen talep yoksa hic sorulmaz
//   OS5 sihirbaz hook'u kullanir, sonucu cizer, "Yeni Islem" sifirlar
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const durum = vi.hoisted(() => vi.fn());
vi.mock('@/api/ansibleApi', () => ({ ansibleApi: { smartTicketStatus: durum } }));
import { useOnaySonrasiTakip } from '../useOnaySonrasiTakip';

const HIZLI = { ilkMs: 5, aralikMs: 5 };

describe('useOnaySonrasiTakip', () => {
  beforeEach(() => durum.mockReset());

  it('OS1 PENDING sonra LAUNCHED: is takibine gecer', async () => {
    durum
      .mockResolvedValueOnce({ ok: true, status: 'PENDING' })
      .mockResolvedValueOnce({ ok: true, status: 'LAUNCHED', jobId: 3410554, awxServerId: 2 });
    const basladi = vi.fn();
    const { result } = renderHook(() => useOnaySonrasiTakip(77, basladi, HIZLI));
    await waitFor(() => expect(basladi).toHaveBeenCalledWith({ jobId: 3410554, awxServerId: 2 }));
    const cagri = durum.mock.calls.length;
    await new Promise((r) => setTimeout(r, 40));
    expect(durum.mock.calls.length).toBe(cagri);
    expect(result.current.talepSonu).toBeNull();
    expect(durum).toHaveBeenCalledWith(77);
  });

  it('OS2 REJECTED: talep sonu doner, is baslatilmaz', async () => {
    durum.mockResolvedValue({ ok: true, status: 'REJECTED', errorMessage: 'Onaylayan reddetti' });
    const basladi = vi.fn();
    const { result } = renderHook(() => useOnaySonrasiTakip(78, basladi, HIZLI));
    await waitFor(() => expect(result.current.talepSonu).toEqual({ status: 'REJECTED', errorMessage: 'Onaylayan reddetti' }));
    expect(basladi).not.toHaveBeenCalled();
  });

  it('OS3 gecici hata takibi durdurmaz', async () => {
    durum
      .mockRejectedValueOnce(new Error('ag'))
      .mockResolvedValueOnce({ ok: true, status: 'LAUNCHED', jobId: 5, awxServerId: 1 });
    const basladi = vi.fn();
    renderHook(() => useOnaySonrasiTakip(79, basladi, HIZLI));
    await waitFor(() => expect(basladi).toHaveBeenCalledWith({ jobId: 5, awxServerId: 1 }));
  });

  it('OS4 bekleyen talep yoksa sorulmaz', async () => {
    renderHook(() => useOnaySonrasiTakip(null, vi.fn(), HIZLI));
    await new Promise((r) => setTimeout(r, 30));
    expect(durum).not.toHaveBeenCalled();
  });

  it('OS5 sihirbaz hook\'u kullanir, sonucu cizer ve "Yeni Islem" sifirlar', () => {
    const s = readFileSync(join(__dirname, '..', 'OpsXWizardPage.tsx'), 'utf8');
    expect(s).toMatch(/useOnaySonrasiTakip\(bekleyenTalep,/);
    expect(s).toContain('pendingApproval: false, jobId, awxServerId');
    expect(s).toContain('if (podDeleteMode) setPodDeleteJob({ awxServerId, jobId });');
    expect(s).toContain('data-testid="opsx-talep-sonu"');
    const restart = s.slice(s.indexOf('function restart()'), s.indexOf('function restart()') + 800);
    expect(restart).toContain('talepSonuSifirla();');
  });
});
