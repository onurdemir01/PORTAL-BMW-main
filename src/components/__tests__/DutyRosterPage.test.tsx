// @vitest-environment jsdom
// Nobet cizelgesi (2026-11-26, kapsam PR-2; %0): bugunun nobetcisi karti (yedek, dahili / telefon / e-posta, avatar),
// alinamadi / baglanilamadi durumu, ay suzgeci ve "Tumu", bos takvim, kisinin TUM nobetleri penceresi (e-posta ile
// eslesme, ayni ad farkli kisi, e-posta yoksa ada dusme, asil / yedek sayimi, gecmis / bugun / yaklasan, siradaki),
// hizli baglantilar ve yardim penceresi.
import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ today: vi.fn(), list: vi.fn(), links: vi.fn() }));
vi.mock('@/api/nobetciApi', () => ({ nobetciApi: api }));

import DutyRosterPage from '../DutyRosterPage';

const kisi = (name: string | null, email: string | null, ek: Record<string, unknown> = {}) => ({
  name,
  email,
  intercom: null,
  phone: null,
  ...ek,
});
const ALI = kisi('Ali Yilmaz', 'ali@ornek.invalid', { intercom: '1234', phone: '0555 000 00 00' });
// Ayni ad, farkli kisi: e-posta farkli oldugu icin nobetleri karismamali.
const ALI2 = kisi('Ali Yilmaz', 'ali.y@ornek.invalid');
const AYSE = kisi('Ayse Kaya', null);
const kayit = (
  id: string,
  startDate: string,
  endDate: string,
  asNobetci: unknown,
  yedekNobetci: unknown,
  isToday = false,
) => ({
  asRecordId: id,
  startDate,
  endDate,
  isToday,
  asNobetci,
  yedekNobetci,
});
// Sira BILEREK karisik (r4 once): kisi penceresi tarihe gore siralar. r4'te e-posta buyuk harf ve bosluklu.
const KAYITLAR = [
  kayit(
    'r4',
    '2026-12-01',
    '2026-12-07',
    kisi('Ali Yilmaz', ' ALI@Ornek.invalid '),
    kisi('', null),
  ),
  kayit('r1', '2026-10-05', '2026-10-11', ALI, AYSE),
  kayit('r2', '2026-11-10', '2026-11-16', AYSE, ALI, true),
  kayit('r3', '2026-11-24', '2026-11-30', ALI2, null),
  kayit('r5', '2026-11-01', '2026-11-03', kisi('  ', null), kisi('ayse kaya', '')),
];

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-12T10:00:00'));
  api.today.mockReset().mockResolvedValue({
    ok: true,
    name: 'Ayse Kaya',
    title: 'Sistem Uzmani',
    department: 'Altyapi',
    intercom: '4321',
    phone: '0555 111 11 11',
    email: 'ayse@ornek.invalid',
    avatarUrl: null,
    yedekName: 'Ali Yilmaz',
    yedekIntercom: '1234',
    yedekEmail: 'ali@ornek.invalid',
    date: '12.11.2026',
  });
  api.list.mockReset().mockResolvedValue({ ok: true, records: KAYITLAR });
  api.links.mockReset().mockResolvedValue([
    { id: 'l1', label: 'Eskalasyon', url: 'https://ornek.invalid/eskalasyon', icon: '🚨' },
    { id: 'l2', label: 'Runbook', url: 'https://ornek.invalid/runbook' },
  ]);
});
afterEach(() => vi.useRealTimers());

const tablo = () => screen.getByText('Nöbet Takvimi').closest('.card') as HTMLElement;

describe('DutyRosterPage', () => {
  it('bugunun nobetcisi, yedek, takvim (bu ay), bugun satiri, hizli baglantilar', async () => {
    render(<DutyRosterPage />);
    expect(await screen.findByText('Bugünün Nöbetçisi')).toBeTruthy();
    expect(screen.getByText('Sistem Uzmani')).toBeTruthy();
    expect(screen.getByText('Altyapi')).toBeTruthy();
    expect(screen.getByText('4321')).toBeTruthy();
    expect(screen.getByText('0555 111 11 11')).toBeTruthy();
    expect(screen.getByTitle('ayse@ornek.invalid')).toBeTruthy();
    expect(screen.getByText('Yedek', { selector: 'span' })).toBeTruthy();
    expect(screen.getByText('12.11.2026')).toBeTruthy();
    // Avatar resmi yoksa bas harf.
    expect(screen.getByText('A', { selector: 'div' })).toBeTruthy();

    expect(await within(tablo()).findByText('3 kayıt')).toBeTruthy();
    // Bos adli kisi tikklanamaz; yedek bos ise "Yedek Yok".
    expect(within(tablo()).getByText('Yedek Yok')).toBeTruthy();
    // Bu ay: Ayse + Ali (r2), Ali (r3), "ayse kaya" (r5); r5'in bos adli nobetcisi dugme degil.
    expect(within(tablo()).getAllByTitle(/tüm nöbetlerini gör$/)).toHaveLength(4);
    const link = screen.getByText('Eskalasyon').closest('a') as HTMLAnchorElement;
    expect(link.href).toBe('https://ornek.invalid/eskalasyon');
    expect(link.rel).toBe('noopener noreferrer');
    expect(screen.getByText('🚨')).toBeTruthy();
    expect(screen.getByText('Runbook')).toBeTruthy();
  });

  it('ay suzgeci: baska ay, kayitsiz ay, Tumu', async () => {
    render(<DutyRosterPage />);
    expect(await within(tablo()).findByText('3 kayıt')).toBeTruthy();
    const ay = screen.getByLabelText('Ay');
    fireEvent.change(ay, { target: { value: '2026-10' } });
    expect(within(tablo()).getByText('1 kayıt')).toBeTruthy();
    fireEvent.change(ay, { target: { value: '2027-03' } });
    expect(within(tablo()).getByText('Bu ay için nöbet kaydı bulunamadı.')).toBeTruthy();
    fireEvent.click(within(tablo()).getByRole('button', { name: 'Tümü' }));
    expect(within(tablo()).getByText('5 kayıt')).toBeTruthy();
    expect(within(tablo()).queryByRole('button', { name: 'Tümü' })).toBeNull();
  });

  it('kisinin tum nobetleri: e-posta ile eslesir, ay suzgecinden etkilenmez', async () => {
    render(<DutyRosterPage />);
    await within(tablo()).findByText('3 kayıt');
    // Bu ay tablosunda Ali'nin yedek oldugu kayit var; pencere TUM kayitlari sayar.
    fireEvent.click(within(tablo()).getAllByTitle('Ali Yilmaz — tüm nöbetlerini gör')[0]);
    const pencere = await screen.findByRole('dialog');
    expect(within(pencere).getByText('3 nöbet kaydı')).toBeTruthy();
    expect(within(pencere).getByText('2 asıl · 1 yedek')).toBeTruthy();
    expect(
      within(pencere).getByText(/Dahili 1234 · 0555 000 00 00 · ali@ornek.invalid/),
    ).toBeTruthy();
    const satirlar = within(pencere).getAllByRole('row').slice(1);
    expect(satirlar.map((r) => r.textContent)).toEqual([
      expect.stringMatching(/^Asıl.*geçmiş$/),
      expect.stringMatching(/^Yedek.*bugün$/),
      expect.stringMatching(/^Asıl.*yaklaşan$/),
    ]);
    // Siradaki: bugunku (yedek) kayit.
    expect(within(pencere).getByText(/sıradaki:/).textContent).toContain('(yedek)');
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    // Ayni adli ikinci kisi: yalniz kendi kaydi.
    fireEvent.click(within(tablo()).getAllByTitle('Ali Yilmaz — tüm nöbetlerini gör')[1]);
    const ikinci = await screen.findByRole('dialog');
    expect(within(ikinci).getByText('1 nöbet kaydı')).toBeTruthy();
    expect(within(ikinci).getByText('1 asıl · 0 yedek')).toBeTruthy();
    expect(within(ikinci).getByText(/sıradaki:/).textContent).not.toContain('(yedek)');
  });

  it('e-postasi olmayan kisi ada duser (buyuk / kucuk harf ve bosluk farki onemsiz)', async () => {
    render(<DutyRosterPage />);
    await within(tablo()).findByText('3 kayıt');
    fireEvent.click(within(tablo()).getAllByTitle('Ayse Kaya — tüm nöbetlerini gör')[0]);
    const pencere = await screen.findByRole('dialog');
    // r1 (yedek), r2 (asil), r5 (yedek, "ayse kaya" + bos e-posta).
    expect(within(pencere).getByText('3 nöbet kaydı')).toBeTruthy();
    expect(within(pencere).getByText('1 asıl · 2 yedek')).toBeTruthy();
  });

  it('gecmis nobetleri olan kisi: siradaki yok; avatar resmi', async () => {
    api.today.mockResolvedValue({ ok: true, name: 'Can', avatarUrl: '/avatar/can.png' });
    api.list.mockResolvedValue({
      ok: true,
      records: [
        kayit('e1', '2026-11-01', '2026-11-02', kisi('Can', 'can@ornek.invalid'), null),
        // Bugun BITEN kayit gecmis sayilmaz (isToday bayragi olmasa da).
        kayit('e2', '2026-11-11', '2026-11-12', kisi('Dila', 'dila@ornek.invalid'), null),
      ],
    });
    render(<DutyRosterPage />);
    expect((await screen.findByAltText('Can')).getAttribute('src')).toBe('/avatar/can.png');
    expect(screen.queryByText('Yedek', { selector: 'span' })).toBeNull();
    fireEvent.click(await within(tablo()).findByTitle('Can — tüm nöbetlerini gör'));
    const pencere = await screen.findByRole('dialog');
    expect(within(pencere).getByText('1 nöbet kaydı')).toBeTruthy();
    expect(within(pencere).queryByText(/sıradaki:/)).toBeNull();
    expect(within(pencere).getByText('geçmiş')).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    fireEvent.click(within(tablo()).getByTitle('Dila — tüm nöbetlerini gör'));
    const dila = await screen.findByRole('dialog');
    expect(within(dila).getByText('yaklaşan')).toBeTruthy();
    expect(within(dila).getByText(/sıradaki:/)).toBeTruthy();
  });

  it('nobet bilgisi alinamadi / baglanilamadi; takvim ve baglanti hatalari bos sayilir', async () => {
    api.today.mockResolvedValueOnce({ ok: false, message: 'Nobet servisi yanit vermedi' });
    api.list.mockRejectedValueOnce(new Error('x'));
    api.links.mockRejectedValueOnce(new Error('y'));
    const { unmount } = render(<DutyRosterPage />);
    expect(await screen.findByText('Nobet servisi yanit vermedi')).toBeTruthy();
    expect(await screen.findByText('Nöbet takvimine ulaşılamadı veya kayıt yok.')).toBeTruthy();
    expect(screen.queryByText('Eskalasyon')).toBeNull();
    unmount();

    api.today.mockRejectedValueOnce(new Error('ag'));
    api.list.mockResolvedValueOnce({ ok: false });
    const ikinci = render(<DutyRosterPage />);
    expect(await screen.findByText('Bağlanılamadı')).toBeTruthy();
    expect(await screen.findByText('Nöbet takvimine ulaşılamadı veya kayıt yok.')).toBeTruthy();
    ikinci.unmount();

    api.today.mockResolvedValueOnce({ ok: false });
    render(<DutyRosterPage />);
    expect(await screen.findByText('Nöbet bilgisi alınamadı')).toBeTruthy();
  });

  it('yardim penceresi acilir', async () => {
    render(<DutyRosterPage />);
    await screen.findByText('Bugünün Nöbetçisi');
    fireEvent.click(screen.getByRole('button', { name: 'Nasıl kullanılır?' }));
    expect(await screen.findByText('Nöbet Çizelgesi — Nasıl Kullanılır?')).toBeTruthy();
    expect(screen.getByText('Bir Kişinin Tüm Nöbetleri')).toBeTruthy();
  });
});
