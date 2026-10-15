// src/components/admin/__tests__/smart-talepleri-sayac.test.tsx — Admin > Smart Talepleri tablosunda
// onay bekleyen satirin "Süre" hucresinde zaman asimi sayaci (2026-10-15).
//   AS1 PENDING satirda kompakt sayac (kalan sure SUNUCU saatine gore); sonuclanmis satirda eski
//       acilis -> sonuclanma suresi aynen
//   AS2 (2026-10-15 denetim) Smart -> OCO -> Smart panel donusu: liste yeniden cekilmez, sayac
//       saklanmis yanitla yeniden kurulur; kalan sure yine GERCEK kalan (yanitin yasi kadar
//       fazla degil)
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within, fireEvent } from '@/test/test-utils';

const api = vi.hoisted(() => ({ smartTicketsAll: vi.fn(), cancelSmartTicket: vi.fn() }));
vi.mock('@/api/ansibleApi', () => ({ ansibleApi: api }));
// OCO paneli kendi API'sini cagirir; bu testin konusu degil.
vi.mock('../tabs/OcoSchedulesPanel', () => ({ default: () => <div>OCO paneli</div> }));
import SmartTicketsTab from '../tabs/SmartTicketsTab';

const SUNUCU = '2026-10-15T08:20:19.000Z';

const satir = (o: Record<string, unknown>) => ({
  externalTicketId: null,
  username: 'onur',
  smartStateName: null,
  module: 'Self Service',
  jobId: null,
  resolvedAt: null,
  createdAt: '2026-10-15T08:00:00.000Z',
  deadline: null,
  deadlineKaynak: null,
  ...o,
});

beforeEach(() => {
  for (const f of Object.values(api)) f.mockReset();
  // Yalniz Date sahte (findBy* icin zamanlayicilar gercek); istemci saati sunucudan 10 dk geride.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(Date.parse(SUNUCU) - 10 * 60_000));
});
afterEach(() => {
  vi.useRealTimers();
});

describe('Admin > Smart Talepleri zaman asimi sayaci', () => {
  it('AS1 PENDING satirda kompakt sayac, sonuclanmis satirda sure', async () => {
    api.smartTicketsAll.mockResolvedValue({
      ok: true,
      total: 2,
      limit: 50,
      offset: 0,
      summary: { PENDING: 1, LAUNCHED: 1 },
      serverNow: SUNUCU,
      tickets: [
        satir({ id: 1, status: 'PENDING', templateName: 'JBoss restart', deadline: '2026-10-15T08:30:00.000Z', deadlineKaynak: 'oco' }),
        satir({ id: 2, status: 'LAUNCHED', templateName: 'Log temizle', jobId: 55, resolvedAt: '2026-10-15T08:05:30.000Z' }),
      ],
    });
    render(<SmartTicketsTab />);
    const bekleyen = (await screen.findByText('JBoss restart')).closest('tr') as HTMLElement;
    const sayac = within(bekleyen).getByRole('timer');
    expect(within(sayac).getByTestId('sbs-metin').textContent).toBe('Kalan 09:41');
    const biten = screen.getByText('Log temizle').closest('tr') as HTMLElement;
    expect(within(biten).queryByRole('timer')).toBeNull();
    expect(within(biten).getByText('5dk 30sn')).toBeTruthy();
  });

  it('AS2 OCO paneline gidip donunce sayac gercek kalani gosterir (bayat yanitin yasi eklenmez)', async () => {
    api.smartTicketsAll.mockResolvedValue({
      ok: true,
      total: 1,
      limit: 50,
      offset: 0,
      summary: { PENDING: 1 },
      serverNow: SUNUCU,
      tickets: [satir({ id: 1, status: 'PENDING', templateName: 'JBoss restart', deadline: '2026-10-15T08:30:00.000Z', deadlineKaynak: 'genel' })],
    });
    render(<SmartTicketsTab />);
    const metin = () => {
      const tr = screen.getByText('JBoss restart').closest('tr') as HTMLElement;
      return within(within(tr).getByRole('timer')).getByTestId('sbs-metin').textContent;
    };
    await screen.findByText('JBoss restart');
    expect(metin()).toBe('Kalan 09:41');
    const cagri = api.smartTicketsAll.mock.calls.length;

    fireEvent.click(screen.getByRole('button', { name: 'OCO Zamanlamaları' }));
    expect(await screen.findByText('OCO paneli')).toBeTruthy();
    vi.setSystemTime(new Date(Date.now() + 5 * 60_000)); // 5 dk OCO panelinde
    fireEvent.click(screen.getByRole('button', { name: 'Smart Talepleri' }));
    await screen.findByText('JBoss restart');
    // Liste yeniden cekilmedi: satirlar ve serverNow 5 dk once alinan yanittan.
    expect(api.smartTicketsAll.mock.calls.length).toBe(cagri);
    expect(metin()).toBe('Kalan 04:41');
  });
});
