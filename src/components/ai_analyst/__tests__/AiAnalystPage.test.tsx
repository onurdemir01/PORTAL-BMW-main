// @vitest-environment jsdom
// AI Analist sayfasi (2026-11-24, kapsam PR-2): saglik uyarisi, akan sohbet olaylari (adim balonlari, metin
// birlestirme, hata), kayitli sohbet yukleme / silme (onayla), kaynak secimi, Log Analizi koprusu ve durdurma.
import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AnalystEvent } from '@/api/aiAnalystApi';

const api = vi.hoisted(() => ({
  health: vi.fn(),
  listConversations: vi.fn(),
  getConversation: vi.fn(),
  deleteConversation: vi.fn(),
  chat: vi.fn(),
  analyzeLogs: vi.fn(),
}));
vi.mock('@/api/aiAnalystApi', () => ({ aiAnalystApi: api }));
vi.mock('../LogAnalysisPanel', () => ({
  default: (p: {
    initialText?: string;
    autorun?: boolean;
    hostHint?: string;
    disabled?: boolean;
    onDeepDive?: (s: string) => void;
  }) => (
    <div data-testid="log-paneli">
      <span>metin:{p.initialText ?? '-'}</span>
      <span>autorun:{String(!!p.autorun)}</span>
      <span>host:{p.hostHint ?? '-'}</span>
      <span>kapali:{String(!!p.disabled)}</span>
      <button type="button" onClick={() => p.onDeepDive?.('log bulgulari')}>
        Derinlemesine
      </button>
    </div>
  ),
}));

import AiAnalystPage from '../AiAnalystPage';

function Konum() {
  const l = useLocation();
  return <span data-testid="konum">{l.search}</span>;
}
const goster = (yol = '/ai') =>
  render(
    <MemoryRouter initialEntries={[yol]}>
      <Routes>
        <Route
          path="/ai"
          element={
            <>
              <AiAnalystPage />
              <Konum />
            </>
          }
        />
      </Routes>
    </MemoryRouter>,
  );

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  Element.prototype.scrollIntoView = vi.fn();
  api.health.mockResolvedValue({ configured: true });
  api.listConversations.mockResolvedValue([]);
  api.deleteConversation.mockResolvedValue(true);
  api.chat.mockResolvedValue(undefined);
});
afterEach(() => {
  vi.useRealTimers();
});

describe('AiAnalystPage', () => {
  it('anahtar tanimsizsa uyari, giris ve hazir analizler kapali', async () => {
    api.health.mockResolvedValue({ configured: false, message: 'Anahtar yok (ornek)' });
    goster();
    expect(await screen.findByText('Anahtar yok (ornek)')).toBeTruthy();
    expect((screen.getByLabelText('AI Analist sorusu') as HTMLInputElement).disabled).toBe(true);
    expect(
      (
        screen.getByRole('button', {
          name: 'Açık problemleri özetle ve önceliklendir',
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });

  it('saglik okunamazsa da kapali sayilir (varsayilan uyari metni)', async () => {
    api.health.mockRejectedValue(new Error('ag'));
    goster();
    expect(
      await screen.findByText('AI sağlayıcı anahtarı tanımlı değil — AI Analist devre dışı.'),
    ).toBeTruthy();
  });

  it('akan olaylar: sohbet kimligi, durum, adim + sonuc, birlesen metin, hata', async () => {
    api.chat.mockImplementation(async (_g: unknown, olay: (e: AnalystEvent) => void) => {
      olay({ type: 'conversation', id: 42 } as AnalystEvent);
      olay({ type: 'status', text: 'Araclar seciliyor' } as AnalystEvent);
      olay({ type: 'tool_call', name: 'dt_problems', args: { aralik: '1h' } } as AnalystEvent);
      olay({
        type: 'tool_result',
        name: 'dt_problems',
        preview: '3 problem',
        ok: true,
      } as AnalystEvent);
      olay({ type: 'tool_call', name: 'dt_logs', args: {} } as AnalystEvent);
      olay({ type: 'tool_result', name: 'dt_logs', preview: 'hata', ok: false } as AnalystEvent);
      olay({ type: 'text', text: 'Ilk paragraf' } as AnalystEvent);
      olay({ type: 'text', text: 'Ikinci paragraf' } as AnalystEvent);
      olay({ type: 'error', message: 'Kota doldu' } as AnalystEvent);
    });
    goster();
    await waitFor(() => expect(api.health).toHaveBeenCalled());
    fireEvent.click(
      await screen.findByRole('button', { name: 'Açık problemleri özetle ve önceliklendir' }),
    );
    expect(await screen.findByText('Kota doldu')).toBeTruthy();
    expect(api.chat.mock.calls[0][0]).toMatchObject({
      messages: [{ role: 'user', content: 'Açık problemleri özetle ve önceliklendir' }],
      sources: { dynatrace: true, instana: false },
      instanaEnv: 'nonprod',
      conversationId: null,
    });
    expect(screen.getByText('Araclar seciliyor')).toBeTruthy();
    // Iki metin olayi tek asistan balonunda birlesir.
    expect(screen.getByText(/Ilk paragraf\s+Ikinci paragraf/)).toBeTruthy();
    // Adim balonu acilinca argumanlar ve sonuc gorunur.
    fireEvent.click(screen.getByText('dt_problems'));
    expect(screen.getByText(/"aralik": "1h"/)).toBeTruthy();
    expect(screen.getByText('3 problem')).toBeTruthy();
    // Sohbet olayi listeyi tazeler (ilk yukleme + olay).
    expect(api.listConversations).toHaveBeenCalledTimes(2);
  });

  it('kayitli sohbet yuklenir, sonraki mesaj gecmisi ve sohbet kimligini tasir; silme onayla', async () => {
    api.listConversations.mockResolvedValue([
      { id: 7, title: 'Dunku olay' },
      { id: 8, title: '' },
    ]);
    api.getConversation.mockResolvedValue({
      conversation: { id: 7 },
      messages: [
        { role: 'user', content: 'ne oldu' },
        { role: 'tool', tool_name: 'dt_events', content: '{"x":1}' },
        { role: 'assistant', content: 'restart firtinasi' },
      ],
    });
    goster();
    const secim = (await screen.findByTitle('Kayitli sohbetler')) as HTMLSelectElement;
    expect(within(secim).getByText('Sohbet #8')).toBeTruthy();
    fireEvent.change(secim, { target: { value: '7' } });
    expect(await screen.findByText('restart firtinasi')).toBeTruthy();
    expect(screen.getByText('dt_events')).toBeTruthy();

    fireEvent.change(screen.getByLabelText('AI Analist sorusu'), { target: { value: 'devam et' } });
    fireEvent.keyDown(screen.getByLabelText('AI Analist sorusu'), { key: 'Enter' });
    await waitFor(() => expect(api.chat).toHaveBeenCalledTimes(1));
    expect(api.chat.mock.calls[0][0]).toMatchObject({
      conversationId: 7,
      messages: [
        { role: 'user', content: 'ne oldu' },
        { role: 'assistant', content: 'restart firtinasi' },
        { role: 'user', content: 'devam et' },
      ],
    });

    // Silme onay ister; iptal edilirse silinmez, onaylanirsa silinir ve sohbet temizlenir.
    fireEvent.click(screen.getByRole('button', { name: 'Sohbeti Sil' }));
    fireEvent.click(await screen.findByRole('button', { name: 'İptal' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Sil' })).toBeNull());
    expect(api.deleteConversation).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Sohbeti Sil' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Sil' }));
    await waitFor(() => expect(api.deleteConversation).toHaveBeenCalledWith(7));
    await waitFor(() => expect(screen.queryByText('restart firtinasi')).toBeNull());

    // Yeni sohbet secimi ekrani bosaltir.
    fireEvent.change(secim, { target: { value: '7' } });
    expect(await screen.findByText('restart firtinasi')).toBeTruthy();
    fireEvent.change(secim, { target: { value: '' } });
    await waitFor(() => expect(screen.queryByText('restart firtinasi')).toBeNull());
  });

  it('getConversation bos donerse ekran degismez', async () => {
    api.listConversations.mockResolvedValue([{ id: 9, title: 'Bozuk' }]);
    api.getConversation.mockResolvedValue(null);
    goster();
    const secim = (await screen.findByTitle('Kayitli sohbetler')) as HTMLSelectElement;
    fireEvent.change(secim, { target: { value: '9' } });
    await waitFor(() => expect(api.getConversation).toHaveBeenCalledWith(9));
    expect(screen.queryByRole('button', { name: 'Sohbeti Sil' })).toBeNull();
  });

  it('Instana secilince ortam secimi cikar ve istege gider; Dynatrace kapatilabilir', async () => {
    goster();
    await waitFor(() => expect(api.health).toHaveBeenCalled());
    fireEvent.click(screen.getByLabelText('Instana'));
    fireEvent.click(screen.getByLabelText('Dynatrace'));
    fireEvent.change(screen.getByDisplayValue('nonprod'), { target: { value: 'prod' } });
    fireEvent.change(screen.getByLabelText('AI Analist sorusu'), { target: { value: 'durum' } });
    fireEvent.click(screen.getByRole('button', { name: /Gönder/ }));
    await waitFor(() => expect(api.chat).toHaveBeenCalled());
    expect(api.chat.mock.calls[0][0]).toMatchObject({
      sources: { dynatrace: false, instana: true },
      instanaEnv: 'prod',
    });
  });

  it('istek hatasi hata balonu olur; iptal (AbortError) olmaz; Durdur istegi keser', async () => {
    let sinyal: AbortSignal | undefined;
    let bitir: () => void = () => {};
    api.chat.mockImplementationOnce(
      async (_g: unknown, _o: unknown, s: AbortSignal) =>
        new Promise<void>((resolve, reject) => {
          sinyal = s;
          bitir = resolve;
          s.addEventListener('abort', () =>
            reject(Object.assign(new Error('durduruldu'), { name: 'AbortError' })),
          );
        }),
    );
    api.chat.mockRejectedValueOnce(new Error('HTTP 502'));
    goster();
    await waitFor(() => expect(api.health).toHaveBeenCalled());
    fireEvent.change(screen.getByLabelText('AI Analist sorusu'), {
      target: { value: 'uzun soru' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Gönder/ }));
    expect(await screen.findByText('Analiz ediliyor…')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Durdur/ }));
    expect(sinyal?.aborted).toBe(true);
    await waitFor(() => expect(screen.queryByText('Analiz ediliyor…')).toBeNull());
    expect(screen.queryByText('durduruldu')).toBeNull();
    bitir();

    fireEvent.change(screen.getByLabelText('AI Analist sorusu'), { target: { value: 'ikinci' } });
    fireEvent.click(screen.getByRole('button', { name: /Gönder/ }));
    expect(await screen.findByText('HTTP 502')).toBeTruthy();
  });

  it('bos mesaj gonderilmez', async () => {
    goster();
    await waitFor(() => expect(api.health).toHaveBeenCalled());
    fireEvent.change(screen.getByLabelText('AI Analist sorusu'), { target: { value: '   ' } });
    fireEvent.keyDown(screen.getByLabelText('AI Analist sorusu'), { key: 'Enter' });
    expect(api.chat).not.toHaveBeenCalled();
  });

  it('?mode=logs Log Analizi ile acar; mod dugmeleri arasinda gecilir', async () => {
    goster('/ai?mode=logs');
    expect(await screen.findByTestId('log-paneli')).toBeTruthy();
    expect(screen.queryByLabelText('AI Analist sorusu')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Kaynak Analizi/ }));
    expect(screen.getByLabelText('AI Analist sorusu')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Log Analizi/ }));
    expect(screen.getByTestId('log-paneli')).toBeTruthy();
  });

  it('LogX koprusu: on dolum + autorun Log Analizine gecer, adres temizlenir, anahtarlar silinir', async () => {
    sessionStorage.setItem('aiAnalystPrefill', 'ERROR satiri');
    sessionStorage.setItem('aiAnalystPrefillHost', 'APP01');
    goster('/ai?autorun=1');
    const panel = await screen.findByTestId('log-paneli');
    expect(within(panel).getByText('metin:ERROR satiri')).toBeTruthy();
    expect(within(panel).getByText('autorun:true')).toBeTruthy();
    expect(within(panel).getByText('host:APP01')).toBeTruthy();
    await waitFor(() => expect(screen.getByTestId('konum').textContent).toBe(''));
    expect(sessionStorage.getItem('aiAnalystPrefill')).toBeNull();
    expect(sessionStorage.getItem('aiAnalystPrefillHost')).toBeNull();
  });

  it('log raporundan derin analiz: sohbete gecer ve bulgulari gonderir', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    goster('/ai?mode=logs');
    fireEvent.click(await screen.findByRole('button', { name: 'Derinlemesine' }));
    await act(async () => {
      vi.advanceTimersByTime(60);
    });
    await waitFor(() => expect(api.chat).toHaveBeenCalled());
    expect(api.chat.mock.calls[0][0].messages).toEqual([
      { role: 'user', content: 'log bulgulari' },
    ]);
  });

  it('Performans koprusu: sohbet on dolumu kendiliginden gonderilir', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    sessionStorage.setItem('aiAnalystChatPrefill', 'payment servisi yavas');
    goster();
    await act(async () => {
      vi.advanceTimersByTime(60);
    });
    await waitFor(() => expect(api.chat).toHaveBeenCalled());
    expect(api.chat.mock.calls[0][0].messages).toEqual([
      { role: 'user', content: 'payment servisi yavas' },
    ]);
    expect(sessionStorage.getItem('aiAnalystChatPrefill')).toBeNull();
  });
});
