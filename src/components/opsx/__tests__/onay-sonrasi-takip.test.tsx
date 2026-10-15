// src/components/opsx/__tests__/onay-sonrasi-takip.test.tsx — OpsX Smart onayi sonrasi ana pencere.
//
// Kullanici (2026-10-14): "Smart kaydini onayladigim halde ... ana pencerede halen Smart talebi
// bekleniyormus gibi gozukuyor." Talep durumu aralikla sorulur; LAUNCHED olunca is takibine gecilir.
//   OS1 PENDING -> LAUNCHED: onBasladi (jobId + AWX sunucusu) cagrilir, yoklama durur
//   OS2 REJECTED: talepSonu doner, is BASLATILMAZ
//   OS3 gecici ag hatasi takibi durdurmaz
//   OS4 bekleyen talep yoksa hic sorulmaz
//   OS5 sihirbaz hook'u kullanir, sonucu cizer, "Yeni Islem" sifirlar
//   OS6 sonDurum: son yanit (createdAt / deadline / serverNow) doner; talep degisince eskisi tasinmaz
//   OS7 bekleme gorunumunde zaman asimi sayaci hook'un sonDurum'u ile cizilir (yalniz PENDING)
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const durum = vi.hoisted(() => vi.fn());
vi.mock('@/api/ansibleApi', () => ({ ansibleApi: { smartTicketStatus: durum } }));
import { useOnaySonrasiTakip } from '../useOnaySonrasiTakip';
import SmartTalepSayaci from '@/components/common/SmartTalepSayaci';

const HIZLI = { ilkMs: 5, aralikMs: 5 };

describe('useOnaySonrasiTakip', () => {
  // NEDEN suslu parantez (2026-10-15): mockReset() mock'un kendisini DONDURUR; vitest beforeEach'in
  // dondurdugu fonksiyonu test sonunda "temizlik" diye CAGIRIR - sahte API bir kez daha calisir ve
  // hic cozulmeyen bir yanit verilmisse (OS6) hook zaman asimina duser.
  beforeEach(() => {
    durum.mockReset();
  });

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

  it('OS6 sonDurum: son yanit doner; talep degisince onceki talebin yaniti tasinmaz', async () => {
    const BEKLER = {
      ok: true,
      status: 'PENDING',
      createdAt: '2026-10-15T08:00:00.000Z',
      deadline: '2026-10-15T10:00:00.000Z',
      deadlineKaynak: 'oco',
      serverNow: '2026-10-15T09:12:03.120Z',
    };
    durum.mockResolvedValue(BEKLER);
    const { result, rerender } = renderHook(({ id }) => useOnaySonrasiTakip(id, vi.fn(), HIZLI), {
      initialProps: { id: 80 },
    });
    expect(result.current.sonDurum).toBeNull();
    expect(result.current.sonDurumAlindiMs).toBeNull();
    const once = Date.now();
    await waitFor(() => expect(result.current.sonDurum).toEqual(BEKLER));
    expect(result.current.talepSonu).toBeNull();
    // Yanitin GELDIGI yerel an (sayac saat kaymasini bundan olcer - 2026-10-15 denetim).
    const alindi = result.current.sonDurumAlindiMs as number;
    expect(alindi).toBeGreaterThanOrEqual(once);
    expect(alindi).toBeLessThanOrEqual(Date.now());
    // Yeni talep: yaniti henuz gelmedi - onceki talebin son tarihi gorunmemeli.
    durum.mockReset();
    durum.mockReturnValue(new Promise(() => {}));
    rerender({ id: 81 });
    expect(result.current.sonDurum).toBeNull();
    expect(result.current.sonDurumAlindiMs).toBeNull();
  });

  it("OS7 bekleme gorunumu: sayac hook'un sonDurum'u ile cizilir, LAUNCHING'de kalkar", async () => {
    durum
      .mockResolvedValueOnce({
        ok: true,
        status: 'PENDING',
        createdAt: '2026-10-15T08:00:00.000Z',
        deadline: '2026-10-15T10:00:00.000Z',
        deadlineKaynak: 'oco',
        serverNow: '2026-10-15T09:12:03.120Z',
      })
      .mockResolvedValue({
        ok: true,
        status: 'LAUNCHING',
        createdAt: '2026-10-15T08:00:00.000Z',
        deadline: '2026-10-15T10:00:00.000Z',
        serverNow: '2026-10-15T09:12:08.000Z',
      });
    // Sihirbazdaki satirin aynisi (OS7 kaynak iddiasi asagida bunu sabitler).
    function Bekleme({ id }: { id: number }) {
      const { sonDurum: talepDurumu, sonDurumAlindiMs: talepDurumuAlindiMs } = useOnaySonrasiTakip(id, vi.fn(), {
        ilkMs: 5,
        aralikMs: 300,
      });
      return <SmartTalepSayaci talep={talepDurumu} serverNow={talepDurumu?.serverNow} alindiMs={talepDurumuAlindiMs} />;
    }
    render(<Bekleme id={82} />);
    expect(screen.queryByRole('timer')).toBeNull(); // ilk yanit gelmeden cizilmez
    const sayac = await screen.findByRole('timer');
    expect(sayac).toHaveAttribute('data-kip', 'geri');
    // Kalan sure SUNUCU saatine gore (serverNow 09:12:03 -> son tarih 10:00 = ~48 dk): yuru.
    expect(sayac).toHaveAttribute('data-evre', 'yuru');
    expect(sayac.querySelector('time')).toHaveAttribute('dateTime', '2026-10-15T10:00:00.000Z');
    expect(sayac).toHaveAttribute('aria-label', 'Zaman aşımına 47 dakika kaldı');
    // Onay geldi (LAUNCHING): poller sureyi artik uygulamaz, sayac kalkar.
    await waitFor(() => expect(screen.queryByRole('timer')).toBeNull());

    const s = readFileSync(join(__dirname, '..', 'OpsXWizardPage.tsx'), 'utf8');
    expect(s).toMatch(
      /sonDurum: talepDurumu,\s*sonDurumAlindiMs: talepDurumuAlindiMs,?\s*\} = useOnaySonrasiTakip\(bekleyenTalep,/,
    );
    const bekleme = s.slice(s.indexOf('Onay bekleniyor — iş henüz başlamadı.'), s.indexOf('<KapamaOnayiUyarisi smartNo='));
    expect(bekleme).toMatch(
      /<SmartTalepSayaci\s+talep=\{talepDurumu\}\s+serverNow=\{talepDurumu\?\.serverNow\}\s+alindiMs=\{talepDurumuAlindiMs\}/,
    );
  });
});
