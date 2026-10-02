// src/contexts/__tests__/AuthOturum.test.tsx — istemci oturum davranisi (Faz B).
//
// Gercek AuthProvider + gercek sessionGuard + sahte sunucu + sahte saat.
//
//   AO1 ESKI DAVRANIS GERI GELMEZ: 30+ dk bosta kalan sekme logout CAGIRMAZ
//       (eskiden sekme basina 30 dk sayac POST /logout ile ORTAK oturumu olduruyordu)
//   AO2 bitis aninda istemci logout degil, sunucuya sorar (GET /api/auth/session)
//   AO3 uyari sunucu bitisinden warnSeconds once acilir; KAPATMAK uzatmaz, Surdur uzatir
//   AO4 mutlak sinirda "Surdur" yok
//   AO5 oturum dusunce uygulama SOKULMEZ: yeniden giris katmani acilir, form durumu
//       korunur, ayni kullaniciyla giris kapiyi acar ve katman kapanir
//   AO6 gorunurluk yoklamasinin IMZASIZ 401'i kullaniciyi dusurmez
//   AO7 API cagrisi uretmeyen etkinlik (okuma/kaydirma) kisitli extend ile bildirilir
import React, { useContext, useState } from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { AuthContext, AuthProvider } from '../AuthContext';
import { sessionGuardKur, _sessionGuardSifirla, SESSION_HEADER } from '@/api/sessionGuard';
import SessionTimeoutModal from '@/components/SessionTimeoutModal';

const DK = 60_000;

interface Sunucu {
  oturum: boolean;
  idle: number;
  abs: number;
  sebep?: string;
  versiyon401?: boolean;
}
let sv: Sunucu;
let cagrilar: { url: string; method: string }[];

function json(body: unknown, status = 200, ek: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...ek } });
}

function oturumYok() {
  const h: Record<string, string> = { [SESSION_HEADER]: 'expired' };
  if (sv.sebep) h['X-Portal-Session-Reason'] = sv.sebep;
  return json({ ok: false, error: 'Oturum bulunamadı.' }, 401, h);
}

const USER = { username: 'ayse', role: 'User', displayName: 'Ayşe' };

async function sahteAg(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = String(input);
  const method = init?.method || 'GET';
  cagrilar.push({ url, method });
  const now = Date.now();
  // Sunucu yaptirimi (Faz A): sure dolduysa oturum yok.
  if (sv.oturum && (now >= sv.idle || now >= sv.abs)) {
    sv.sebep = now >= sv.abs ? 'absolute' : 'idle';
    sv.oturum = false;
  }
  if (url === '/api/auth/login') {
    sv.oturum = true;
    sv.sebep = undefined;
    sv.idle = now + 60 * DK;
    sv.abs = now + 12 * 60 * DK;
    return json({ ok: true, ...USER, session: { ok: true, serverNow: now, idleExpiresAt: sv.idle, absoluteExpiresAt: sv.abs, warnSeconds: 120 } });
  }
  if (url === '/api/auth/logout') {
    sv.oturum = false;
    return json({ ok: true });
  }
  if (url === '/api/auth/session-policy') return json({ ok: true, rememberEnabled: true, rememberDays: 7 });
  if (url === '/api/visibility/version' && sv.versiyon401) return json({ ok: false }, 401);
  if (!sv.oturum) return oturumYok();
  if (url === '/api/auth/session/extend') sv.idle = now + 60 * DK;
  if (url.startsWith('/api/auth/session')) {
    return json({ ok: true, serverNow: now, idleExpiresAt: sv.idle, absoluteExpiresAt: sv.abs, warnSeconds: 120 });
  }
  if (url === '/api/auth/me') return json({ ok: true, user: USER });
  if (url === '/api/visibility/resolved') return json({ ok: true, version: 1, visibility: {} });
  if (url === '/api/visibility/version') return json({ ok: true, version: 1 });
  if (url === '/api/visibility/pages') return json({ ok: true, visibility: {} });
  return json({ ok: true });
}

// Uygulamanin yerine: kullanici adi + korunmasi gereken yerel form durumu + uyari.
function Uygulama() {
  const a = useContext(AuthContext);
  const [taslak, setTaslak] = useState('');
  if (!a.user) return <p>giris-ekrani</p>;
  return (
    <div>
      <p>merhaba {a.user.username}</p>
      <input aria-label="taslak" value={taslak} onChange={(e) => setTaslak(e.target.value)} />
      <SessionTimeoutModal
        isOpen={a.showTimeoutModal}
        countdown={a.countdown}
        extendable={a.timeoutExtendable}
        onExtend={a.extendSession}
        onDismiss={a.dismissTimeoutModal}
        onLogout={a.logout}
      />
    </div>
  );
}

async function baslat() {
  render(
    <AuthProvider>
      <Uygulama />
    </AuthProvider>,
  );
  await act(async () => {
    await vi.advanceTimersByTimeAsync(10);
  });
  expect(screen.getByText('merhaba ayse')).toBeInTheDocument();
}

async function ileri(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

const sayi = (parca: string, method?: string) =>
  cagrilar.filter((c) => c.url.includes(parca) && (!method || c.method === method)).length;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
  vi.setSystemTime(new Date('2026-10-02T08:00:00Z'));
  const now = Date.now();
  sv = { oturum: true, idle: now + 60 * DK, abs: now + 12 * 60 * DK };
  cagrilar = [];
  _sessionGuardSifirla();
  window.fetch = sahteAg as unknown as typeof fetch;
  sessionGuardKur();
});

afterEach(() => {
  _sessionGuardSifirla();
  vi.useRealTimers();
});

describe('istemci oturum (Faz B)', () => {
  it('AO1 30+ dk bosta kalan sekme logout CAGIRMAZ', async () => {
    await baslat();
    await ileri(45 * DK);
    expect(sayi('/api/auth/logout')).toBe(0);
    expect(screen.getByText('merhaba ayse')).toBeInTheDocument();
  });

  it('AO2 bitis aninda sunucuya sorar, kendi basina logout cagirmaz', async () => {
    // Bitis 45 sn'lik gorunurluk yoklamasinin araligina dusmesin: karari ZAMANLAYICI versin.
    sv.idle = Date.now() + 60 * DK + 20_000;
    await baslat();
    const once = sayi('/api/auth/session', 'GET');
    await ileri(60 * DK + 19_000);
    expect(screen.queryByTestId('relogin-overlay')).not.toBeInTheDocument();
    await ileri(2_500);
    expect(sayi('/api/auth/session', 'GET')).toBe(once + 1);
    expect(sayi('/api/auth/logout')).toBe(0);
    // Sunucu "bitti" dedi (imzali 401 + sebep): yeniden giris katmani.
    expect(screen.getByTestId('relogin-overlay')).toBeInTheDocument();
    expect(screen.getByText(/işlem yapılmadığı için/)).toBeInTheDocument();
  });

  it('AO3 uyari warnSeconds once acilir; kapatmak uzatmaz, Surdur uzatir', async () => {
    await baslat();
    await ileri(58 * DK - 1000);
    expect(screen.queryByText('Oturumu Sürdür')).not.toBeInTheDocument();
    await ileri(2000);
    expect(screen.getByText('Oturumu Sürdür')).toBeInTheDocument();
    // Uyari penceresinde etkinlik (tus, fare) sureyi SESSIZCE uzatmaz.
    fireEvent.keyDown(window, { key: 'a' });
    fireEvent.pointerDown(window);
    await ileri(10);
    expect(sayi('/extend')).toBe(0);
    fireEvent.click(screen.getByLabelText('Kapat'));
    await ileri(10);
    expect(screen.queryByText('Oturumu Sürdür')).not.toBeInTheDocument();
    expect(sayi('/extend')).toBe(0);

    // Yeni bir oturumda Surdur.
    await ileri(3 * DK); // sure doldu → katman
    expect(screen.getByTestId('relogin-overlay')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Şifre'), { target: { value: 'x' } });
    fireEvent.click(screen.getByText('Giriş yap ve devam et'));
    await ileri(10);
    await ileri(58 * DK);
    expect(screen.getByText('Oturumu Sürdür')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Oturumu Sürdür'));
    await ileri(10);
    expect(sayi('/extend', 'POST')).toBe(1);
    expect(screen.queryByText('Oturumu Sürdür')).not.toBeInTheDocument();
    await ileri(30 * DK);
    expect(screen.queryByTestId('relogin-overlay')).not.toBeInTheDocument();
  });

  it('AO7 okuyan kullanicinin etkinligi (API cagrisi olmadan) kisitli extend ile bildirilir', async () => {
    await baslat();
    fireEvent.pointerDown(window);
    expect(sayi('/extend')).toBe(0); // saat az once ogrenildi
    await ileri(6 * DK);
    fireEvent.wheel(window);
    fireEvent.scroll(window);
    await ileri(10);
    expect(sayi('/extend', 'POST')).toBe(1);
    await ileri(56 * DK);
    expect(screen.queryByText('Oturumu Sürdür')).not.toBeInTheDocument();
  });

  it('AO4 mutlak sinirda Surdur yok', async () => {
    sv.abs = Date.now() + 30 * DK;
    await baslat();
    await ileri(28 * DK + 1000);
    expect(screen.getByText('Oturum süresi doluyor')).toBeInTheDocument();
    expect(screen.queryByText('Oturumu Sürdür')).not.toBeInTheDocument();
  });

  it('AO5 oturum dusunce uygulama sokulmez; ayni kullaniciyla giris kaldigi yerden devam eder', async () => {
    await baslat();
    fireEvent.change(screen.getByLabelText('taslak'), { target: { value: 'yarim kalan is' } });
    sv.oturum = false; // sunucu yeniden basladi / iptal edildi
    sv.sebep = undefined;
    await act(async () => {
      await window.fetch('/api/test/herhangi');
    });
    expect(screen.getByTestId('relogin-overlay')).toBeInTheDocument();
    expect(screen.getByText(/Oturumunuz sona erdi/)).toBeInTheDocument();
    expect(screen.queryByText('giris-ekrani')).not.toBeInTheDocument();
    expect(screen.getByLabelText('taslak')).toHaveValue('yarim kalan is');

    const haritaOnce = sayi('/api/visibility/resolved');
    fireEvent.change(screen.getByLabelText('Şifre'), { target: { value: 'x' } });
    fireEvent.click(screen.getByText('Giriş yap ve devam et'));
    await ileri(10);
    expect(screen.queryByTestId('relogin-overlay')).not.toBeInTheDocument();
    expect(screen.getByLabelText('taslak')).toHaveValue('yarim kalan is');
    // Kapi girisin HEMEN ardindan acik: gorunurluk haritasi gercekten aga gidip tazelenir
    // (kapali kalsaydi sentetik 401 alir, kullanici bayat haritayla devam ederdi).
    expect(sayi('/api/visibility/resolved')).toBe(haritaOnce + 1);
    // Kapi yeniden acik: istek aga cikiyor.
    const once = cagrilar.length;
    await act(async () => {
      await window.fetch('/api/test/herhangi');
    });
    expect(cagrilar.length).toBe(once + 1);
  });

  it('AO6 gorunurluk yoklamasinin imzasiz 401i kullaniciyi dusurmez', async () => {
    await baslat();
    sv.versiyon401 = true;
    await ileri(46_000);
    expect(sayi('/api/visibility/version')).toBeGreaterThan(0);
    expect(screen.getByText('merhaba ayse')).toBeInTheDocument();
    expect(screen.queryByTestId('relogin-overlay')).not.toBeInTheDocument();
  });
});
