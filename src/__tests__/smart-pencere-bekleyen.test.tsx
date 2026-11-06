// src/__tests__/smart-pencere-bekleyen.test.tsx — onaylı, pencere bekleyen Crypto Hub bileti (D8).
//
// Taleplerim ve Admin > Smart Talepleri bu bileti "onay bekliyor" gibi göstermez; pencereli bilet
// pencere sonundan önce dolduğu için "Süre sınırı yok" da demez.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const m = vi.hoisted(() => ({ mine: vi.fn(), all: vi.fn() }));
vi.mock('@/api/ansibleApi', () => ({
  ansibleApi: { smartTicketsMine: m.mine, smartTicketsAll: m.all },
}));

import RequestsSidePanel from '@/components/self_service/RequestsSidePanel';
import SmartTicketsTab from '@/components/admin/tabs/SmartTicketsTab';

const bilet = (id: number, ek: Record<string, unknown> = {}) => ({
  id,
  status: 'PENDING',
  smartStateName: 'Onay Bekliyor',
  templateName: `Is ${id}`,
  jobId: null,
  errorMessage: null,
  createdAt: new Date().toISOString(),
  externalTicketId: `SR-${id}`,
  approvedAt: null,
  deadline: null,
  deadlineKaynak: null,
  ...ek,
});
const son = () => new Date(Date.now() + 3600000).toISOString();
const onayli = (id: number) => bilet(id, { approvedAt: new Date().toISOString(), deadline: son(), deadlineKaynak: 'oco' });

async function panel(tickets: unknown[]) {
  m.mine.mockResolvedValue({ ok: true, tickets, serverNow: new Date().toISOString() });
  render(
    <MemoryRouter>
      <RequestsSidePanel />
    </MemoryRouter>,
  );
  await screen.findByText('Is 1');
}

beforeEach(() => {
  m.mine.mockReset();
  m.all.mockReset();
  window.localStorage.clear();
});
afterEach(cleanup);

describe('Taleplerim', () => {
  it('onaylı bekleyen bilet "onay bekliyor" sayılmaz; kartta ve bantta doğru metin', async () => {
    await panel([onayli(1)]);
    expect(screen.getByText(/1 talebiniz onaylandı, pencere bekleniyor\./)).toBeTruthy();
    expect(screen.getByText(/Onaylandı, pencere bekleniyor/, { selector: 'div.text-\\[11px\\]' })).toBeTruthy();
    expect(screen.queryByText(/Smart’ta bekliyor/)).toBeNull();
    expect(screen.queryByText(/onay bekliyor/)).toBeNull();
    expect(screen.queryByText(/TAMAMLA/)).toBeNull();
  });

  it('onaysız pencereli bilet: "Süre sınırı yok" demez', async () => {
    await panel([bilet(1, { deadline: son(), deadlineKaynak: 'oco' })]);
    expect(screen.getByText(/1 talebiniz Smart’ta bekliyor\./)).toBeTruthy();
    expect(screen.getByText(/Süre sınırı var/)).toBeTruthy();
    expect(screen.queryByText(/Süre sınırı yok/)).toBeNull();
    expect(screen.getByText('1 onay bekliyor')).toBeTruthy();
  });

  it('süresiz bilet: "Süre sınırı yok" kalır, kesinti penceresinden söz etmez', async () => {
    await panel([bilet(1)]);
    expect(screen.getByText(/Süre sınırı yok/)).toBeTruthy();
    expect(screen.queryByText(/kesinti penceresinin/)).toBeNull();
  });

  it('karışık liste: iki sayı ayrı', async () => {
    await panel([bilet(1), onayli(2), bilet(3)]);
    expect(screen.getByText('2 onay bekliyor')).toBeTruthy();
    expect(screen.getByText(/2 talebiniz Smart’ta bekliyor\./)).toBeTruthy();
    expect(screen.getByText(/1 talebiniz onaylandı, pencere bekleniyor\./)).toBeTruthy();
  });
});

describe('Admin Smart Talepleri', () => {
  it('yalnız onaylı bekleyen satırda metin görünür', async () => {
    m.all.mockResolvedValue({
      ok: true,
      total: 2,
      summary: {},
      serverNow: new Date().toISOString(),
      tickets: [onayli(1), bilet(2)].map((t) => ({ ...t, username: 'ali', flowKey: 'F', extraVars: {} })),
    });
    render(<SmartTicketsTab />);
    const metinler = await screen.findAllByText('Onaylandı, pencere bekleniyor');
    expect(metinler).toHaveLength(1);
    expect(metinler[0].closest('tr')?.textContent).toContain('SR-1');
  });
});
