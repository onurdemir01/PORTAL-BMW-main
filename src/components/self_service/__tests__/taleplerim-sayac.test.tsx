// src/components/self_service/__tests__/taleplerim-sayac.test.tsx — "Taleplerim" kartinda Smart
// onayi zaman asimi sayaci (2026-10-15).
//
// Kullanici: "Smart onayinda beklerken bir zaman asimi sayaci olsun ... cita figuru sayacin basinda
// yurusun sonuna dogru kosmaya baslasin."
//   TS1 PENDING talepte kompakt sayac var (kalan sure SUNUCU saatine gore); LAUNCHED ve LAUNCHING
//       talepte yok; genel sure siniri varken ust bilgi "Süre sınırı yok" DEMEZ
//   TS4 OpsX production (deadlineKaynak 'islem') talebi varken de "Süre sınırı yok" DENMEZ
//   TS2 son tarihi olmayan bekleyen talep: sayac gecen sureyi gosterir, ust bilgi "Süre sınırı yok"
//   TS3 (2026-10-15 denetim) daralt / genislet: kartlar yenileme yaniti gelmeden saklanmis yanitla
//       kurulur; kalan sure yine gercek kalan, taze yanit gelince de kaymaz
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within, fireEvent, act } from '@/test/test-utils';

const api = vi.hoisted(() => ({
  smartTicketsMine: vi.fn(),
  smartTicketDetail: vi.fn(),
  ssJobStatus: vi.fn(),
  cancelSmartTicket: vi.fn(),
}));
vi.mock('@/api/ansibleApi', () => ({ ansibleApi: api }));
import RequestsSidePanel from '../RequestsSidePanel';

const SUNUCU = '2026-10-15T08:20:19.000Z';
// Istemci saati sunucudan 10 dk GERIDE: kayma duzeltilmezse "Kalan 19:41" gorunurdu.
const ISTEMCI = Date.parse(SUNUCU) - 10 * 60_000;

const talep = (o: Record<string, unknown>) => ({
  createdAt: '2026-10-15T08:00:00.000Z',
  smartStateName: null,
  jobId: null,
  errorMessage: null,
  resolvedAt: null,
  externalTicketId: null,
  deadline: null,
  deadlineKaynak: null,
  ...o,
});

const kart = (ad: string) => screen.getByText(ad).closest('.rounded-lg') as HTMLElement;

beforeEach(() => {
  for (const f of Object.values(api)) f.mockReset();
  try {
    window.localStorage.clear();
  } catch {
    /* yoksay */
  }
  // Yalniz Date sahte: setInterval / setTimeout gercek kalir (findBy* calissin), saat donuk.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(ISTEMCI));
});
afterEach(() => {
  vi.useRealTimers();
});

describe('Taleplerim zaman asimi sayaci', () => {
  it('TS1 PENDING talepte kompakt sayac var; LAUNCHED ve LAUNCHING talepte yok', async () => {
    api.smartTicketsMine.mockResolvedValue({
      ok: true,
      serverNow: SUNUCU,
      tickets: [
        talep({ id: 1, status: 'PENDING', templateName: 'JBoss restart', deadline: '2026-10-15T08:30:00.000Z', deadlineKaynak: 'genel' }),
        talep({ id: 2, status: 'LAUNCHED', templateName: 'Log temizle', jobId: 55, resolvedAt: '2026-10-15T08:05:00.000Z' }),
        // LAUNCHING'de sunucu deadline doner (sozlesme) ama poller sureyi uygulamaz -> sayac yok.
        talep({ id: 3, status: 'LAUNCHING', templateName: 'Disk temizle', deadline: '2026-10-15T08:30:00.000Z', deadlineKaynak: 'genel' }),
      ],
    });
    render(<RequestsSidePanel />);
    await screen.findByText('JBoss restart');

    const bekleyen = kart('JBoss restart');
    const sayac = within(bekleyen).getByRole('timer');
    expect(sayac).toHaveClass('sbs--kompakt');
    expect(within(sayac).getByTestId('sbs-metin').textContent).toBe('Kalan 09:41');
    expect(sayac).toHaveAttribute('data-evre', 'yuru'); // 30 dk'lik surede kalan 09:41 > %25 (7:30)
    expect(screen.getAllByRole('timer')).toHaveLength(1);
    expect(within(kart('Log temizle')).queryByRole('timer')).toBeNull();
    expect(within(kart('Disk temizle')).queryByRole('timer')).toBeNull();

    expect(screen.getByText(/Süre sınırı var/)).toBeTruthy();
    expect(screen.queryByText(/Süre sınırı yok/)).toBeNull();
  });

  it('TS4 OpsX production talebi (islem kurali, 15 dk): ust bilgi "Süre sınırı yok" DEMEZ', async () => {
    api.smartTicketsMine.mockResolvedValue({
      ok: true,
      serverNow: SUNUCU,
      tickets: [
        talep({ id: 6, status: 'PENDING', templateName: 'OpsX: restart', deadline: '2026-10-15T08:30:00.000Z', deadlineKaynak: 'islem' }),
      ],
    });
    render(<RequestsSidePanel />);
    await screen.findByText('OpsX: restart');
    expect(within(kart('OpsX: restart')).getByRole('timer')).toHaveAttribute('data-kip', 'geri');
    expect(screen.getByText(/Süre sınırı var/)).toBeTruthy();
    expect(screen.queryByText(/Süre sınırı yok/)).toBeNull();
  });

  it('TS2 son tarihi olmayan bekleyen talep: gecen sure, "Süre sınırı yok"', async () => {
    api.smartTicketsMine.mockResolvedValue({
      ok: true,
      serverNow: SUNUCU,
      tickets: [talep({ id: 4, status: 'PENDING', templateName: 'WAS restart' })],
    });
    render(<RequestsSidePanel />);
    await screen.findByText('WAS restart');
    const sayac = within(kart('WAS restart')).getByRole('timer');
    expect(sayac).toHaveAttribute('data-kip', 'sinirsiz');
    expect(within(sayac).getByTestId('sbs-metin').textContent).toBe('Bekliyor 20 dk');
    expect(screen.getByText(/Süre sınırı yok/)).toBeTruthy();
  });

  it('TS3 daralt / genislet: saklanmis yanitla kurulan sayac gercek kalani gosterir', async () => {
    const bekleyen = talep({ id: 5, status: 'PENDING', templateName: 'JBoss restart', deadline: '2026-10-15T08:30:00.000Z', deadlineKaynak: 'genel' });
    api.smartTicketsMine.mockResolvedValueOnce({ ok: true, serverNow: SUNUCU, tickets: [bekleyen] });
    render(<RequestsSidePanel />);
    await screen.findByText('JBoss restart');
    const metin = () => within(within(kart('JBoss restart')).getByRole('timer')).getByTestId('sbs-metin').textContent;
    expect(metin()).toBe('Kalan 09:41');

    fireEvent.click(screen.getByTitle('Daralt'));
    vi.setSystemTime(new Date(ISTEMCI + 14_000)); // 14 sn daraltilmis
    // Genisletince yenileme istenir; yaniti BILEREK bekletilir - kartlar once saklanmis yanitla cizilir.
    let yanitla: (v: unknown) => void = () => {};
    api.smartTicketsMine.mockReturnValueOnce(new Promise((r) => (yanitla = r)));
    fireEvent.click(screen.getByTitle("Taleplerim'i genişlet"));
    await screen.findByText('JBoss restart');
    expect(metin()).toBe('Kalan 09:27');

    // Taze yanit (sunucu saati de 14 sn ilerledi): sayi degismez.
    await act(async () => {
      yanitla({ ok: true, serverNow: '2026-10-15T08:20:33.000Z', tickets: [bekleyen] });
    });
    expect(metin()).toBe('Kalan 09:27');
  });
});
