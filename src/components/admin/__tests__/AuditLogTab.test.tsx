// @vitest-environment jsdom
// Admin > Denetim kayitlari sekmesi (2026-11-26, kapsam PR-2; %0): Portal kaynagi (sorgu parametreleri: kullanici,
// aksiyon, host, modul oneki, tarih araligi gun sonu, sayfalama), sunucu hatasi + tekrar dene, LogX kaynagi, sonuc
// rozetleri ve DB hatasi satiri, bos liste, sayfalama (fazladan bir kayit "sonraki" demektir), zincir dogrulama
// (saglam / kirik + ilk sorunlu kayit / eski format / hata) ve CSV.
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// jsdom'da olcum yok: sanal liste tum satirlari cizsin.
vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: (o: { count: number; estimateSize: () => number }) => ({
    getVirtualItems: () =>
      Array.from({ length: o.count }, (_, i) => ({
        index: i,
        key: i,
        start: i * o.estimateSize(),
      })),
    getTotalSize: () => o.count * o.estimateSize(),
  }),
}));
const audit = vi.hoisted(() => ({ list: vi.fn() }));
vi.mock('@/api/adminApi', () => ({ auditApi: audit }));
const csv = vi.hoisted(() => vi.fn());
vi.mock('@/utils/csv', () => ({ downloadCsv: csv }));

import AuditLogTab from '../tabs/AuditLogTab';

const kayit = (id: number, ek: Record<string, unknown> = {}) => ({
  id,
  created_at: '2026-11-25T10:00:00Z',
  username: `kullanici${id}`,
  role: 'User',
  action: 'scalex_stop',
  result: 'success',
  target_host: 'ORNAPP01',
  client_ip: '10.0.0.1',
  detail: `ayrinti ${id}`,
  ...ek,
});
type Yanit = { ok?: boolean; status?: number; body: unknown };
let yanitlar: Yanit[] = [];
const istekler: string[] = [];
const sahteFetch = vi.fn(async (url: string) => {
  // Diger bilesenlerin istekleri (marka bilgisi vb.) denetim yanit kuyrugunu tuketmez.
  if (!/^\/api\/(portal-audit|logx)/.test(url))
    return { ok: true, status: 200, json: async () => ({}) } as Response;
  istekler.push(url);
  const y = yanitlar.length > 1 ? yanitlar.shift()! : yanitlar[0];
  return {
    ok: y.ok !== false,
    status: y.status ?? 200,
    json: async () => {
      if (y.body instanceof Error) throw y.body;
      return y.body;
    },
  } as Response;
});

beforeEach(() => {
  yanitlar = [
    {
      body: {
        ok: true,
        logs: [
          kayit(1),
          kayit(2, { result: 'db_error', target_host: '' }),
          kayit(3, { result: 'denied', detail: '' }),
          kayit(4, { result: '' }),
        ],
      },
    },
  ];
  istekler.length = 0;
  vi.stubGlobal('fetch', sahteFetch);
  audit.list.mockReset();
  csv.mockReset();
});
afterEach(() => vi.unstubAllGlobals());

const dugme = (ad: string | RegExp) => screen.getByRole('button', { name: ad });

describe('AuditLogTab', () => {
  it('Portal kaynagi: satirlar, rozetler, DB hatasi satiri; suzgecler sorguya gider', async () => {
    render(<AuditLogTab />);
    expect(await screen.findByText('kullanici1')).toBeTruthy();
    expect(istekler[0]).toBe('/api/portal-audit?limit=51&offset=0');
    expect(screen.getByText('4 kayıt (Sayfa 1)')).toBeTruthy();
    expect(screen.getByText('db_error').className).toContain('red');
    expect(screen.getByText('denied').className).toContain('amber');
    expect(screen.getByText('success').className).toContain('green');
    expect(screen.getByText('kullanici2').parentElement?.className).toContain('bg-red-50');
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(3);

    fireEvent.click(dugme(/Filtrele/));
    const inputs = screen.getAllByPlaceholderText('Tümü');
    fireEvent.change(inputs[0], { target: { value: 'ali' } });
    fireEvent.change(inputs[1], { target: { value: 'ORNAPP01' } });
    fireEvent.change(inputs[2], { target: { value: 'scalex_stop' } });
    fireEvent.change(screen.getByLabelText('Modül'), { target: { value: 'scalex_' } });
    fireEvent.change(screen.getByLabelText('Başlangıç'), { target: { value: '2026-11-01' } });
    fireEvent.change(screen.getByLabelText('Bitiş'), { target: { value: '2026-11-25' } });
    fireEvent.click(dugme('Uygula'));
    await waitFor(() => expect(istekler).toHaveLength(2));
    const q = new URLSearchParams(istekler[1].split('?')[1]);
    expect(Object.fromEntries(q)).toEqual({
      username: 'ali',
      action: 'scalex_stop',
      targetHost: 'ORNAPP01',
      actionPrefix: 'scalex_',
      dateFrom: '2026-11-01',
      dateTo: '2026-11-25T23:59:59.999',
      limit: '51',
      offset: '0',
    });

    fireEvent.click(dugme('CSV indir'));
    const [ad, baslik, satirlar] = csv.mock.calls[0];
    expect(ad).toBe('denetim-portal');
    expect(baslik).toContain('istemci_ip');
    expect(satirlar[0][1]).toBe('kullanici1');
  });

  it('sayfalama: fazladan kayit sonraki sayfayi acar', async () => {
    yanitlar = [
      { body: { ok: true, logs: Array.from({ length: 51 }, (_, i) => kayit(i + 1)) } },
      // Tam sayfa (50) gelirse sonraki sayfa YOK: fazladan kayit gelmedi.
      { body: { ok: true, logs: Array.from({ length: 50 }, (_, i) => kayit(i + 60)) } },
      { body: { ok: true, logs: [kayit(1)] } },
    ];
    // Yukleme sirasinda tablo yeniden kurulur: dugmeler her adimda yeniden bulunur.
    const dugmeler = (n: number) =>
      Array.from(
        (
          screen.getByText(`Sayfa ${n}`, { selector: 'span' }).parentElement as HTMLElement
        ).querySelectorAll('button'),
      );
    render(<AuditLogTab />);
    expect(await screen.findByText('50 kayıt (Sayfa 1)')).toBeTruthy();
    expect(dugmeler(1)[0].disabled).toBe(true);
    expect(dugmeler(1)[1].disabled).toBe(false);
    fireEvent.click(dugmeler(1)[1]);
    expect(await screen.findByText('50 kayıt (Sayfa 2)')).toBeTruthy();
    expect(istekler.at(-1)).toContain('offset=50');
    expect(dugmeler(2)[1].disabled).toBe(true);
    fireEvent.click(dugmeler(2)[0]);
    await waitFor(() => expect(istekler.at(-1)).toContain('offset=0'));
  });

  it('sunucu hatasi ve tekrar dene; bos liste', async () => {
    yanitlar = [
      { ok: false, status: 503, body: { ok: false } },
      { body: { ok: false, error: 'Denetim tablosu yok' } },
      { body: new Error('json degil') },
      { body: { ok: true, logs: [] } },
    ];
    render(<AuditLogTab />);
    expect(await screen.findByText(/Sunucu hatası \(HTTP 503\)\./)).toBeTruthy();
    fireEvent.click(dugme('Tekrar dene'));
    expect(await screen.findByText(/Denetim tablosu yok/)).toBeTruthy();
    fireEvent.click(dugme('Tekrar dene'));
    expect(await screen.findByText(/Sunucu hatası \(HTTP 200\)\./)).toBeTruthy();
    fireEvent.click(dugme('Tekrar dene'));
    expect(await screen.findByText('Kayıt bulunamadı.')).toBeTruthy();
  });

  it('LogX kaynagi: auditApi kullanilir, modul / tarih suzgeci yok', async () => {
    audit.list.mockResolvedValue([kayit(9, { username: 'logxkullanici' })]);
    render(<AuditLogTab />);
    await screen.findByText('kullanici1');
    fireEvent.click(dugme('LogX'));
    expect(await screen.findByText('logxkullanici')).toBeTruthy();
    expect(audit.list).toHaveBeenCalledWith({
      username: undefined,
      targetHost: undefined,
      action: undefined,
      limit: 51,
      offset: 0,
    });
    fireEvent.click(dugme(/Filtrele/));
    expect(screen.queryByLabelText('Modül')).toBeNull();
    expect(screen.queryByLabelText('Başlangıç')).toBeNull();
    fireEvent.click(dugme('CSV indir'));
    expect(csv.mock.calls[0][0]).toBe('denetim-logx');
  });

  it('zincir dogrulama: saglam, kirik, eski format ve hata', async () => {
    render(<AuditLogTab />);
    await screen.findByText('kullanici1');
    yanitlar = [
      { body: { ok: true, verified: 120, broken: 0, firstBrokenId: null, legacyCount: 3 } },
    ];
    fireEvent.click(dugme(/Zincir Doğrula/));
    expect(await screen.findByText('Zincir bütünlüğü doğrulandı.')).toBeTruthy();
    expect(istekler.at(-1)).toBe('/api/portal-audit/verify');
    expect(screen.getByText(/3 eski-format kayıt/)).toBeTruthy();
    yanitlar = [{ body: { ok: false, verified: 120, broken: 2, firstBrokenId: 77 } }];
    fireEvent.click(dugme(/Zincir Doğrula/));
    expect(await screen.findByText('Zincir kırık!')).toBeTruthy();
    expect(screen.getByText('77')).toBeTruthy();
    yanitlar = [{ body: new Error('json degil') }];
    fireEvent.click(dugme(/Zincir Doğrula/));
    expect(await screen.findByText('Doğrulama sırasında hata oluştu.')).toBeTruthy();
    // LogX kaynaginda dogrulama LogX ucuna gider; kaynak degisince sonuc temizlenir.
    audit.list.mockResolvedValue([]);
    fireEvent.click(dugme('LogX'));
    await waitFor(() => expect(screen.queryByText('Doğrulama sırasında hata oluştu.')).toBeNull());
    yanitlar = [{ body: { ok: false, verified: 5, broken: 1, firstBrokenId: null } }];
    fireEvent.click(dugme(/Zincir Doğrula/));
    expect(await screen.findByText('Zincir kırık!')).toBeTruthy();
    expect(istekler.at(-1)).toBe('/api/logx/admin/audit/verify');
  });
});
