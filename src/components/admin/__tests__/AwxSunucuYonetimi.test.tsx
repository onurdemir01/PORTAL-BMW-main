// src/components/admin/__tests__/AwxSunucuYonetimi.test.tsx — Admin > Ansible: AWX sunucusunu
// devre dışı bırak / etkinleştir (2026-10-26, maestro 1 kapatma).
//   AU1 liste: etkin / devre dışı; DB ile çalışan Portal ayrışırsa söylenir
//   AU2 bitmesi gereken iş varsa onay düğmesi kilitli, neden yazılı
//   AU3 temiz özet: onay -> enabled:false gider, liste ve sağlık yenilenir
//   AU4 sunucu 409 + güncel özet dönerse panel güncellenir, kapatıldı denmez
//   AU5 etkinleştirme onay ister; vazgeçilirse istek gitmez
//   AU6 bölüm Admin > Ansible sekmesine bağlı
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const api = vi.hoisted(() => ({
  awxSunucuYonetim: vi.fn(),
  awxSunucuBagimlilik: vi.fn(),
  awxSunucuDurum: vi.fn(),
}));
vi.mock('@/api/ansibleApi', () => ({ ansibleApi: api }));
const toast = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }));
vi.mock('@/hooks/useToast', () => ({ toast }));
import AwxSunucuYonetimi from '../tabs/AwxSunucuYonetimi';

const M1 = { no: 1, name: 'maestro', url: 'https://maestro.fwgaranti.com.tr', enabled: true, lastStatus: 'ok', lastCheckedAt: null, bellekte: true };
const M2 = { no: 2, name: 'maestro2', url: 'https://maestro2.fwgaranti.com.tr', enabled: true, lastStatus: 'ok', lastCheckedAt: null, bellekte: true };
const TEMIZ = { serverNo: 1, engeller: [], uyarilar: [], okunamayan: [], kapatilabilir: true };

describe('AWX sunucu yönetimi', () => {
  beforeEach(() => {
    Object.values(api).forEach((f) => f.mockReset());
    toast.error.mockReset();
    toast.success.mockReset();
    api.awxSunucuYonetim.mockResolvedValue({ ok: true, servers: [M1, M2] });
  });

  it('AU1 liste ve ayrışma notu', async () => {
    api.awxSunucuYonetim.mockResolvedValue({ ok: true, servers: [{ ...M1, enabled: false, bellekte: true }, M2] });
    render(<AwxSunucuYonetimi />);
    const s1 = await screen.findByTestId('awx-sunucu-1');
    expect(within(s1).getByText('Devre dışı')).toBeInTheDocument();
    expect(within(s1).getByText(/hâlâ kullanıyor/)).toBeInTheDocument();
    expect(within(screen.getByTestId('awx-sunucu-2')).getByText('Etkin')).toBeInTheDocument();
  });

  it('AU2 engel varsa onay kilitli', async () => {
    api.awxSunucuBagimlilik.mockResolvedValue({
      ok: true,
      ozet: { ...TEMIZ, kapatilabilir: false, engeller: [{ anahtar: 'oco', baslik: 'OCO zamanlanmış başlatma', adet: 2, ipucu: 'iptal edin' }] },
    });
    render(<AwxSunucuYonetimi />);
    fireEvent.click(within(await screen.findByTestId('awx-sunucu-1')).getByRole('button', { name: /Devre dışı bırak/ }));
    const panel = await screen.findByTestId('awx-bagimlilik');
    expect(await within(panel).findByText(/OCO zamanlanmış başlatma/)).toBeInTheDocument();
    expect(within(panel).getByText(/bitmeden devre dışı bırakılamaz/)).toBeInTheDocument();
    expect(within(panel).getByTestId('awx-kapat-onay')).toBeDisabled();
    expect(api.awxSunucuDurum).not.toHaveBeenCalled();
  });

  it('AU3 temiz özet: onay -> kapatılır, yenilenir', async () => {
    api.awxSunucuBagimlilik.mockResolvedValue({
      ok: true,
      ozet: { ...TEMIZ, uyarilar: [{ anahtar: 'ss', baslik: 'Bu sunucuya bağlı Self Servis servisi', adet: 1, ornekler: ['RVP'], ipucu: 'x' }] },
    });
    api.awxSunucuDurum.mockResolvedValue({ ok: true, yuklendi: true, message: 'AWX #1 (maestro) devre dışı bırakıldı.' });
    const degisti = vi.fn();
    render(<AwxSunucuYonetimi onDegisti={degisti} />);
    fireEvent.click(within(await screen.findByTestId('awx-sunucu-1')).getByRole('button', { name: /Devre dışı bırak/ }));
    const onay = await screen.findByTestId('awx-kapat-onay');
    await waitFor(() => expect(onay).toBeEnabled());
    expect(screen.getByText(/RVP/)).toBeInTheDocument();
    fireEvent.click(onay);
    await waitFor(() => expect(api.awxSunucuDurum).toHaveBeenCalledWith(1, false));
    await waitFor(() => expect(degisti).toHaveBeenCalled());
    expect(toast.success).toHaveBeenCalledWith('AWX #1 (maestro) devre dışı bırakıldı.');
    expect(api.awxSunucuYonetim).toHaveBeenCalledTimes(2);
  });

  it('AU4 sunucu 409 + özet: panel güncellenir', async () => {
    api.awxSunucuBagimlilik.mockResolvedValue({ ok: true, ozet: TEMIZ });
    api.awxSunucuDurum.mockResolvedValue({
      ok: false,
      message: 'Önce bitmesi gereken işler var.',
      ozet: { ...TEMIZ, kapatilabilir: false, engeller: [{ anahtar: 'smart', baslik: 'Onay bekleyen Smart bileti', adet: 1, ipucu: 'bekleyin' }] },
    });
    const degisti = vi.fn();
    render(<AwxSunucuYonetimi onDegisti={degisti} />);
    fireEvent.click(within(await screen.findByTestId('awx-sunucu-1')).getByRole('button', { name: /Devre dışı bırak/ }));
    const onay = await screen.findByTestId('awx-kapat-onay');
    await waitFor(() => expect(onay).toBeEnabled());
    fireEvent.click(onay);
    expect(await screen.findByText(/Onay bekleyen Smart bileti/)).toBeInTheDocument();
    expect(toast.error).toHaveBeenCalledWith('Önce bitmesi gereken işler var.');
    expect(toast.success).not.toHaveBeenCalled();
    expect(degisti).not.toHaveBeenCalled();
  });

  it('AU5 etkinleştirme onay ister', async () => {
    api.awxSunucuYonetim.mockResolvedValue({ ok: true, servers: [{ ...M1, enabled: false, bellekte: false }, M2] });
    const onayla = vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<AwxSunucuYonetimi />);
    fireEvent.click(within(await screen.findByTestId('awx-sunucu-1')).getByRole('button', { name: /Etkinleştir/ }));
    expect(onayla).toHaveBeenCalled();
    expect(api.awxSunucuDurum).not.toHaveBeenCalled();
    onayla.mockReturnValue(true);
    api.awxSunucuDurum.mockResolvedValue({ ok: true, yuklendi: true, message: 'ok' });
    fireEvent.click(within(screen.getByTestId('awx-sunucu-1')).getByRole('button', { name: /Etkinleştir/ }));
    await waitFor(() => expect(api.awxSunucuDurum).toHaveBeenCalledWith(1, true));
    onayla.mockRestore();
  });

  it('AU6 Admin > Ansible sekmesi bölümü gösterir ve değişince sağlığı yeniler (kaynak)', () => {
    const s = readFileSync(join(__dirname, '..', 'tabs', 'AnsibleConfigTab.tsx'), 'utf8');
    expect(s).toMatch(/<AwxSunucuYonetimi onDegisti=\{reload\} \/>/);
  });
});
