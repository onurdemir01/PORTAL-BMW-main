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
//   AO8 YOKLAYAN ACIK SEKME OTURUMU ACIK TUTMAZ: sunucunun listesinde OLMAYAN bir yoklama
//       surse bile bosta kalan oturum biter (eskiden sonsuza dek acik kaliyordu)
//   AO9 calisan kullanici atilmaz (girdi + yoklama birlikte)
//   AO10 uyari ekrandayken yoklama uyariyi gecersiz kilmaz; kapatip calismaya devam eden
//        kullanicinin girdisi sayilir
//   AO11 oturumu dusup cikis yapan kullanici yeniden girince kapi HEMEN acilir
//   AO12 sebebi BASKA sekme "tuketmis" olsa da bu sekme nedenini kendi saatinden bilir
//   AO13 React StrictMode'da (gelistirme) sekmeler arasi kanal OLMEZ: baska sekmedeki
//        giris bu sekmenin katmanini kapatir
//
// Sahte sunucu GERCEK sunucunun etkinlik kuralini uygular (session-policy.cjs etkinlikMi):
// her istek etkinliktir; `X-Portal-Activity: background` ve bilinen yoklama yollari degildir.
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
  /** true: extend 500 doner (ag/sunucu aksamasi) ve sureyi uzatmaz. */
  extendHata?: boolean;
}
let sv: Sunucu;
let cagrilar: { url: string; method: string; isaret: string | null }[];
// Ayarlanirsa Uygulama bu yolu 40 sn'de bir yoklar ("Taleplerim" paneli gibi).
let yoklamaYolu: string | null = null;

// server/auth/session-policy.cjs ARKA_PLAN_YOLLARI ile ayni.
const SUNUCU_ARKA_PLAN = new Set([
  '/api/users/online',
  '/api/visibility/version',
  '/api/ansible/awx/recent-jobs',
  '/api/ansible/ss/smart-tickets/mine',
  '/api/auth/session',
]);
function sunucuEtkinlikSayar(url: string, method: string, isaret: string | null): boolean {
  if (isaret === 'background') return false;
  if (isaret === 'user') return true;
  return !(method === 'GET' && SUNUCU_ARKA_PLAN.has(url));
}

function json(body: unknown, status = 200, ek: Record<string, string> = {}) {
  // Gercek sunucu gibi: oturum varken her yanit bitis basliklarini tasir.
  const bitis: Record<string, string> =
    sv.oturum && status < 400
      ? { 'X-Portal-Session-Expires': String(sv.idle), 'X-Portal-Session-Absolute': String(sv.abs) }
      : {};
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...bitis, ...ek },
  });
}

function oturumYok() {
  const h: Record<string, string> = { [SESSION_HEADER]: 'expired' };
  // Gercek sunucu gibi: sebep yalnizca suresi dolan oturuma gelen ILK istekte soylenir
  // (o istek oturumu siler); sonraki 401'ler sebepsizdir.
  if (sv.sebep) {
    h['X-Portal-Session-Reason'] = sv.sebep;
    sv.sebep = undefined;
  }
  return json({ ok: false, error: 'Oturum bulunamadı.' }, 401, h);
}

const USER = { username: 'ayse', role: 'User', displayName: 'Ayşe' };

async function sahteAg(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = String(input);
  const method = init?.method || 'GET';
  const isaret = new Headers(init?.headers).get('x-portal-activity');
  cagrilar.push({ url, method, isaret });
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
  if (url === '/api/auth/session/extend' && sv.extendHata) return json({ ok: false, error: 'gecici hata' }, 500);
  if (url === '/api/auth/session/extend' || sunucuEtkinlikSayar(url, method, isaret)) sv.idle = now + 60 * DK;
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
function Yoklayici({ yol }: { yol: string }) {
  React.useEffect(() => {
    const t = window.setInterval(() => void window.fetch(yol).catch(() => {}), 40_000);
    return () => window.clearInterval(t);
  }, [yol]);
  return null;
}

function Uygulama() {
  const a = useContext(AuthContext);
  const [taslak, setTaslak] = useState('');
  if (!a.user)
    return (
      <div>
        <p>giris-ekrani</p>
        <button type="button" onClick={() => void a.login('ayse', 'x')}>
          giris
        </button>
      </div>
    );
  return (
    <div>
      <p>merhaba {a.user.username}</p>
      {yoklamaYolu && <Yoklayici yol={yoklamaYolu} />}
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
  yoklamaYolu = null;
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
    await baslat();
    // Bitis 45 sn'lik gorunurluk yoklamasinin araligina dusmesin: karari ZAMANLAYICI versin.
    sv.idle = Date.now() + 60 * DK + 20_000;
    await act(async () => {
      await window.fetch('/api/auth/session'); // istemci saati yeni bitisi ogrensin
    });
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
    // Kullanici bir alanda yaziyordu: uyari kapaninca Modal odagi BURAYA geri verir. Bu
    // programatik odak "girdi" sayilirsa kapatmak sureyi kendiliginden uzatirdi.
    screen.getByLabelText('taslak').focus();
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

  it('AO8 yoklayan acik sekme oturumu sonsuza dek acik TUTMAZ', async () => {
    // Sunucunun listesinde OLMAYAN bir yol: korumayi liste degil istemci isareti saglamali.
    yoklamaYolu = '/api/herhangi/yoklama';
    await baslat();
    await ileri(62 * DK);
    const yoklamalar = cagrilar.filter((c) => c.url === yoklamaYolu);
    expect(yoklamalar.length).toBeGreaterThan(50);
    expect(yoklamalar.filter((c) => c.isaret === 'background').length).toBe(yoklamalar.length);
    expect(screen.getByTestId('relogin-overlay')).toBeInTheDocument();
    expect(screen.getByText(/işlem yapılmadığı için/)).toBeInTheDocument();
    expect(sayi('/api/auth/logout')).toBe(0);
  });

  it('AO9 calisan kullanici atilmaz: girdi tazeyken yoklama da etkinliktir', async () => {
    yoklamaYolu = '/api/herhangi/yoklama';
    await baslat();
    for (let dk = 0; dk < 70; dk += 4) {
      fireEvent.pointerDown(window);
      await ileri(4 * DK);
    }
    expect(screen.queryByTestId('relogin-overlay')).not.toBeInTheDocument();
    expect(screen.queryByText('Oturumu Sürdür')).not.toBeInTheDocument();
    // API cagrisi uretmeyen girdi `extend` ile bildirildi.
    expect(sayi('/extend', 'POST')).toBeGreaterThan(5);
    // Girdiden hemen sonra giden istek ISARETSIZDIR: sunucu onu etkinlik sayar.
    fireEvent.pointerDown(window);
    await act(async () => {
      await window.fetch('/api/herhangi/yoklama');
    });
    expect(cagrilar[cagrilar.length - 1].isaret).toBeNull();
    expect(sv.idle).toBe(Date.now() + 60 * DK);
  });

  it('AO10 uyari ekrandayken yoklama uyariyi gecersiz kilmaz; kapatip calisan kullanicinin girdisi sayilir', async () => {
    yoklamaYolu = '/api/herhangi/yoklama';
    await baslat();
    await ileri(58 * DK + 1000);
    expect(screen.getByText('Oturumu Sürdür')).toBeInTheDocument();
    const bitis = sv.idle;
    // Uyari acilmadan hemen once girdi olsaydi bile (fare masada kaydi) yoklama uzatmamali.
    fireEvent.mouseMove(window);
    await ileri(60_000);
    expect(sv.idle).toBe(bitis);
    expect(screen.getByText('Oturumu Sürdür')).toBeInTheDocument();
    expect(sayi('/extend')).toBe(0);

    // Kapat: sure uzamaz. Sonra GERCEK girdi: olagan kural (extend) isler.
    fireEvent.click(screen.getByLabelText('Kapat'));
    await ileri(10);
    expect(sayi('/extend')).toBe(0);
    fireEvent.keyDown(window, { key: 'a' });
    await ileri(10);
    expect(sayi('/extend', 'POST')).toBe(1);
    await ileri(3 * DK);
    expect(screen.queryByTestId('relogin-overlay')).not.toBeInTheDocument();
  });

  it('AO10c girdi tazeyken acilan uyariyi yoklama gecersiz kilmaz (extend dusmustu)', async () => {
    await baslat();
    sv.extendHata = true;
    await ileri(57 * DK + 45_000);
    // Gercek girdi: extend denenir ama DUSER (aksama). Girdi "taze" kalir.
    fireEvent.pointerDown(window);
    await ileri(10);
    expect(sayi('/extend', 'POST')).toBe(1);
    await ileri(16_000); // 58:01 — uyari acik
    expect(screen.getByText('Oturumu Sürdür')).toBeInTheDocument();
    const bitis = sv.idle;
    // Girdiden 20 sn sonra bir yoklama: uyari acilirken girdi sifirlanmasaydi ISARETSIZ
    // gider, sunucu etkinlik sayar ve uyari kullaniciya sorulmadan kapanirdi.
    await act(async () => {
      await window.fetch('/api/herhangi/yoklama');
    });
    expect(cagrilar[cagrilar.length - 1].isaret).toBe('background');
    expect(sv.idle).toBe(bitis);
    expect(screen.getByText('Oturumu Sürdür')).toBeInTheDocument();
  });

  it('AO7b baska uygulamadan PENCEREYE donus etkinliktir', async () => {
    await baslat();
    await ileri(6 * DK);
    fireEvent.focus(window);
    await ileri(10);
    expect(sayi('/extend', 'POST')).toBe(1);
  });

  it('AO10b arka plana tiklamak uyariyi kapatmaz', async () => {
    await baslat();
    await ileri(58 * DK + 1000);
    const dugme = screen.getByText('Oturumu Sürdür');
    const arkaPlan = dugme.closest('[role="dialog"]')!.firstElementChild as HTMLElement;
    fireEvent.mouseDown(arkaPlan);
    fireEvent.mouseUp(arkaPlan);
    fireEvent.click(arkaPlan);
    await ileri(10);
    expect(screen.getByText('Oturumu Sürdür')).toBeInTheDocument();
  });

  it('AO11 oturumu dusup cikis yapan kullanici yeniden girince kapi hemen acilir', async () => {
    await baslat();
    sv.oturum = false;
    await act(async () => {
      await window.fetch('/api/test/herhangi');
    });
    fireEvent.click(screen.getByText('Çıkış yap'));
    await ileri(10);
    expect(screen.getByText('giris-ekrani')).toBeInTheDocument();
    const haritaOnce = sayi('/api/visibility/resolved');
    fireEvent.click(screen.getByText('giris'));
    await ileri(10);
    expect(screen.getByText('merhaba ayse')).toBeInTheDocument();
    // 2,5 sn'lik yeniden deneme beklenmeden: harita girisle birlikte aga gitti.
    expect(sayi('/api/visibility/resolved')).toBe(haritaOnce + 1);
  });

  it('AO12 sebebi baska sekme tuketmis olsa da neden kendi saatinden bilinir', async () => {
    await baslat();
    sv.idle = Date.now() + 60 * DK + 20_000;
    await act(async () => {
      await window.fetch('/api/auth/session');
    });
    await ileri(60 * DK + 20_100);
    // "Diger sekme" suresi dolan oturuma ILK istegi atti: sebep ona soylendi, oturum silindi.
    const ilk = await sahteAg('/api/baska-sekme');
    expect(ilk.headers.get('X-Portal-Session-Reason')).toBe('idle');
    await ileri(1_500); // bu sekmenin zamanlayicisi: sebepsiz 401
    expect(screen.getByTestId('relogin-overlay')).toBeInTheDocument();
    expect(screen.getByText(/işlem yapılmadığı için/)).toBeInTheDocument();
  });

  it('AO13 StrictMode`da kanal olmez: baska sekmedeki giris bu sekmenin katmanini kapatir', async () => {
    render(
      <React.StrictMode>
        <AuthProvider>
          <Uygulama />
        </AuthProvider>
      </React.StrictMode>,
    );
    await ileri(10);
    expect(screen.getByText('merhaba ayse')).toBeInTheDocument();
    sv.oturum = false;
    await act(async () => {
      await window.fetch('/api/test/herhangi');
    });
    expect(screen.getByTestId('relogin-overlay')).toBeInTheDocument();

    // Baska sekme yeniden giris yapti: sunucuda oturum var, kanaldan haber geliyor.
    sv.oturum = true;
    sv.idle = Date.now() + 60 * DK;
    const mesaj = { tur: 'giris', username: 'ayse' };
    let bc: BroadcastChannel | null = null;
    if (typeof BroadcastChannel !== 'undefined') {
      bc = new BroadcastChannel('portal-session');
      bc.postMessage(mesaj);
    } else {
      window.dispatchEvent(
        new StorageEvent('storage', { key: 'portal-session-msg', newValue: JSON.stringify(mesaj) }),
      );
    }
    try {
      for (let i = 0; i < 50 && screen.queryByTestId('relogin-overlay'); i++) {
        await act(async () => {
          await new Promise((r) => setImmediate(r));
          await vi.advanceTimersByTimeAsync(5);
        });
      }
      expect(screen.queryByTestId('relogin-overlay')).not.toBeInTheDocument();
      expect(screen.getByText('merhaba ayse')).toBeInTheDocument();
    } finally {
      bc?.close();
    }
  });
});
