// src/components/admin/__tests__/smart-yeniden-tetikle.test.tsx — Admin > Smart Talepleri: zaman
// aşımına uğrayan talebi yeniden tetikle (2026-11-11).
//   YT1 yalnız TIMEOUT satırında "Tetikle" düğmesi
//   YT2 OCO'lu talep: yeni OCO numarası + gerekçe girilmeden düğme kapalı; gönderim gövdesi doğru
//   YT3 pencere dışı: onay kutusu işaretlenmeden düğme kapalı; gövdede outsideWindowConfirm
//   YT4 Smart reddettiyse form gösterilmez, düğme kapalı kalır
//   YT5 OCO'suz talep: yalnız gerekçe yeter (en az 10 karakter), gövdede mod yok
//   YT6 kontrol başarısız (ör. ScaleX bileti): hata gösterilir, form yok
//   YT7 iş başladı ama kayıt yazılamadı: başarı değil uyarı
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@/test/test-utils';

const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }));
vi.mock('@/hooks/useToast', () => ({ toast: toastMock }));
const api = vi.hoisted(() => ({
  smartTicketsAll: vi.fn(),
  cancelSmartTicket: vi.fn(),
  smartTicketRetriggerCheck: vi.fn(),
  smartTicketRetrigger: vi.fn(),
}));
vi.mock('@/api/ansibleApi', () => ({ ansibleApi: api }));
vi.mock('../tabs/OcoSchedulesPanel', () => ({ default: () => <div>OCO paneli</div> }));
import SmartTicketsTab from '../tabs/SmartTicketsTab';

const satir = (o: Record<string, unknown>) => ({
  externalTicketId: '23817089',
  username: 'halilir',
  smartStateName: 'Çalışıyor',
  module: 'Self Service',
  jobId: null,
  resolvedAt: '2026-11-10T23:00:00.000Z',
  createdAt: '2026-11-10T21:05:00.000Z',
  deadline: null,
  deadlineKaynak: null,
  ...o,
});

const NOT = 'onaycı izinde, ekip lideri onay verdi';

function liste() {
  api.smartTicketsAll.mockResolvedValue({
    ok: true,
    total: 2,
    limit: 50,
    offset: 0,
    summary: { TIMEOUT: 1, LAUNCHED: 1 },
    serverNow: '2026-11-11T08:00:00.000Z',
    tickets: [
      satir({ id: 329, status: 'TIMEOUT', templateName: 'Nginx - RVP Operations' }),
      satir({ id: 330, status: 'LAUNCHED', templateName: 'Log temizle', jobId: 7 }),
    ],
  });
}

const kontrol = (smart: Record<string, unknown>) => ({
  ok: true,
  notEnAz: 10,
  smart: { engel: false, stateName: 'Çalışıyor', message: 'Smart onayı hâlâ yok', ...smart },
  oco: {
    kapsamli: true,
    ocoNumber: '23737284',
    windowStartIso: '2026-11-10T20:00:00.000Z',
    windowEndIso: '2026-11-10T23:00:00.000Z',
  },
});

async function modaliAc() {
  render(<SmartTicketsTab />);
  await screen.findByText('Nginx - RVP Operations');
  const dugmeler = screen.getAllByRole('button', { name: /Tetikle/ });
  expect(dugmeler).toHaveLength(1);
  fireEvent.click(dugmeler[0]);
  await screen.findByRole('dialog');
}

const tetikle = () => screen.getByRole('button', { name: 'İşi tetikle' }) as HTMLButtonElement;

beforeEach(() => {
  for (const f of Object.values(api)) f.mockReset();
  for (const f of Object.values(toastMock)) f.mockReset();
  liste();
});

describe('Admin > Smart Talepleri yeniden tetikleme', () => {
  it('YT1+YT2 yeni OCO ile tetikleme', async () => {
    api.smartTicketRetriggerCheck.mockResolvedValue(kontrol({ durum: 'bekliyor' }));
    api.smartTicketRetrigger.mockResolvedValue({ ok: true, status: 'LAUNCHED', jobId: 991 });
    await modaliAc();
    await screen.findByTestId('ss-retrigger-smart');
    expect(api.smartTicketRetriggerCheck).toHaveBeenCalledWith(329);
    expect(tetikle().disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Yeni OCO numarası'), { target: { value: '23800001' } });
    expect(tetikle().disabled).toBe(true);
    fireEvent.change(screen.getByLabelText(/Gerekçe/), { target: { value: NOT } });
    expect(tetikle().disabled).toBe(false);
    const onceki = api.smartTicketsAll.mock.calls.length;
    fireEvent.click(tetikle());
    await waitFor(() => expect(api.smartTicketRetrigger).toHaveBeenCalled());
    expect(api.smartTicketRetrigger).toHaveBeenCalledWith(329, { note: NOT, mode: 'oco', ocoNumber: '23800001' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(api.smartTicketsAll.mock.calls.length).toBe(onceki + 1);
  });

  it('YT3 pencere dışı onay kutusu ister', async () => {
    api.smartTicketRetriggerCheck.mockResolvedValue(kontrol({ durum: 'onayli' }));
    api.smartTicketRetrigger.mockResolvedValue({ ok: true, status: 'LAUNCHED', jobId: 5 });
    await modaliAc();
    await screen.findByTestId('ss-retrigger-smart');
    fireEvent.click(screen.getByLabelText(/Pencere dışında hemen çalıştır/));
    fireEvent.change(screen.getByLabelText(/Gerekçe/), { target: { value: NOT } });
    expect(tetikle().disabled).toBe(true);
    fireEvent.click(screen.getByRole('checkbox'));
    expect(tetikle().disabled).toBe(false);
    fireEvent.click(tetikle());
    await waitFor(() =>
      expect(api.smartTicketRetrigger).toHaveBeenCalledWith(329, {
        note: NOT,
        mode: 'pencereDisi',
        outsideWindowConfirm: true,
      }),
    );
  });

  it('YT4 Smart reddettiyse form yok, tetiklenemez', async () => {
    api.smartTicketRetriggerCheck.mockResolvedValue(
      kontrol({ durum: 'reddedildi', engel: true, message: 'Smart kaydı REDDEDİLMİŞ; iş tetiklenmez.' }),
    );
    await modaliAc();
    expect((await screen.findByTestId('ss-retrigger-smart')).textContent).toContain('REDDEDİLMİŞ');
    expect(screen.queryByLabelText(/Gerekçe/)).toBeNull();
    expect(screen.queryByLabelText('Yeni OCO numarası')).toBeNull();
    expect(tetikle().disabled).toBe(true);
    expect(api.smartTicketRetrigger).not.toHaveBeenCalled();
  });

  it('YT5 OCO suz talep: yalniz gerekce', async () => {
    api.smartTicketRetriggerCheck.mockResolvedValue({
      ...kontrol({ durum: 'bilinmiyor', statusCode: '300' }),
      oco: { kapsamli: false, ocoNumber: null, windowStartIso: null, windowEndIso: null },
    });
    api.smartTicketRetrigger.mockResolvedValue({ ok: true, status: 'LAUNCHED', jobId: 12 });
    await modaliAc();
    expect((await screen.findByTestId('ss-retrigger-smart')).textContent).toContain('kod 300');
    expect(screen.queryByLabelText('Yeni OCO numarası')).toBeNull();
    fireEvent.change(screen.getByLabelText(/Gerekçe/), { target: { value: '123456789' } });
    expect(tetikle().disabled).toBe(true);
    fireEvent.change(screen.getByLabelText(/Gerekçe/), { target: { value: NOT } });
    expect(tetikle().disabled).toBe(false);
    fireEvent.click(tetikle());
    await waitFor(() => expect(api.smartTicketRetrigger).toHaveBeenCalledWith(329, { note: NOT }));
    await waitFor(() => expect(toastMock.success).toHaveBeenCalled());
  });

  it('YT6 kontrol basarisiz: hata, form yok', async () => {
    api.smartTicketRetriggerCheck.mockResolvedValue({ ok: false, message: 'Bu talep bir ScaleX işlemine bağlı' });
    await modaliAc();
    expect((await screen.findByTestId('ss-retrigger-hata')).textContent).toContain('ScaleX');
    expect(screen.queryByLabelText(/Gerekçe/)).toBeNull();
    expect(tetikle().disabled).toBe(true);
  });

  it('YT7 kayit yazilamadi uyarisi basari gibi gosterilmez', async () => {
    api.smartTicketRetriggerCheck.mockResolvedValue({
      ...kontrol({ durum: 'onayli' }),
      oco: { kapsamli: false, ocoNumber: null, windowStartIso: null, windowEndIso: null },
    });
    api.smartTicketRetrigger.mockResolvedValue({ ok: true, warning: true, status: 'LAUNCHED', jobId: 4, message: 'kayıt güncellenemedi' });
    await modaliAc();
    await screen.findByTestId('ss-retrigger-smart');
    fireEvent.change(screen.getByLabelText(/Gerekçe/), { target: { value: NOT } });
    fireEvent.click(tetikle());
    await waitFor(() => expect(toastMock.warning).toHaveBeenCalled());
    expect(toastMock.success).not.toHaveBeenCalled();
  });
});
