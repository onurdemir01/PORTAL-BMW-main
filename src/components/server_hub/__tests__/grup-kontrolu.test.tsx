// Retirement Analizi grup kontrolü (Faz 2b, 2026-11-11).
//   GK1 aday + kontrol bekliyor: doğrula formu, gerekçesiz kaydedilmez, kayıt imzayla gider
//   GK2 doğrulanmış aday grup: "Retirement kaydı aç" görünür ve uygulama adı + doğrulayanla çağrılır
//   GK3 aday olmayan grupta doğrulama yok; kontrol okunamadıysa hiçbir eylem yok ve uyarı var
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import type { ShGrupKarar } from '@/api/serverHubApi';

const m = vi.hoisted(() => ({ iliskiGrupKontrol: vi.fn() }));
vi.mock('@/api/serverHubApi', async (orig) => ({ ...(await orig<typeof import('@/api/serverHubApi')>()), serverHubApi: m }));
vi.mock('@/hooks/useToast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import GrupKontrolu from '@/components/server_hub/GrupKontrolu';

const grup = (o: Partial<ShGrupKarar> = {}): ShGrupKarar => ({
  anahtar: 'grup:APP1|PROD|8',
  ad: 'APP1',
  ortam: 'PROD',
  nesil: '8',
  karar: 'RETIRE_ADAYI',
  kararMetni: 'Retire adayı — son kontroller kaldı',
  ozet: '1 kopya: 1 kopya retire adayı',
  kopyalar: ['jvm:APPSRV01|8|APP1'],
  imza: 'a'.repeat(32),
  durum: 'BEKLIYOR',
  kontrol: null,
  kayitHazir: false,
  ...o,
});

beforeEach(() => m.iliskiGrupKontrol.mockReset());

describe('Grup kontrolü', () => {
  it('GK1 doğrula: gerekçe zorunlu, imzayla kaydedilir', async () => {
    const onRA = vi.fn();
    m.iliskiGrupKontrol.mockResolvedValue({ ok: true, grup: grup({ durum: 'DOGRULANDI', kayitHazir: true, kontrol: { sonuc: 'DOGRULANDI', aciklama: 'sahip onayladi', isaretleyen: 'onur', zaman: null } }) });
    render(<GrupKontrolu gruplar={[grup()]} onRetirementAc={onRA} />);
    expect(screen.queryByRole('button', { name: 'Retirement kaydı aç' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Doğrulandı olarak işaretle' }));
    const kaydet = screen.getByRole('button', { name: 'Kaydet' });
    expect(kaydet).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/Neye bakıldı/), { target: { value: 'sahip onayladi' } });
    fireEvent.click(kaydet);
    await waitFor(() => expect(m.iliskiGrupKontrol).toHaveBeenCalledWith({ anahtar: 'grup:APP1|PROD|8', sonuc: 'DOGRULANDI', aciklama: 'sahip onayladi', imza: 'a'.repeat(32) }));
    fireEvent.click(await screen.findByRole('button', { name: 'Retirement kaydı aç' }));
    expect(onRA).toHaveBeenCalledWith('APP1', expect.stringContaining('onur doğruladı'));
  });

  it('GK2 doğrulanmış ama veri değişmiş grupta kayıt düğmesi yok', () => {
    render(<GrupKontrolu gruplar={[grup({ durum: 'VERI_DEGISTI', kayitHazir: false, kontrol: { sonuc: 'DOGRULANDI', aciklama: 'x', isaretleyen: 'onur', zaman: null } })]} onRetirementAc={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Retirement kaydı aç' })).toBeNull();
    expect(screen.getByText(/veri değişti/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Doğrulandı olarak işaretle' })).toBeInTheDocument();
  });

  it('GK3 aday olmayan / okunamayan', () => {
    const { unmount } = render(<GrupKontrolu gruplar={[grup({ karar: 'KULLANIMDA', anahtar: 'grup:APP1|TEST|8' })]} onRetirementAc={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Doğrulandı olarak işaretle' })).toBeNull();
    unmount();
    render(<GrupKontrolu gruplar={[grup({ durum: 'BILINMIYOR' })]} okunamadi onRetirementAc={vi.fn()} />);
    const k = screen.getByTestId('grup-kontrolu');
    expect(within(k).getByText(/kontrol kayıtları okunamadı/)).toBeInTheDocument();
    expect(within(k).queryAllByRole('button')).toHaveLength(0);
  });
});
