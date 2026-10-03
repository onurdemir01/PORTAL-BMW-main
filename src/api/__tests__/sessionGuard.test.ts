// src/api/__tests__/sessionGuard.test.ts — oturum-bitti kapisi (P1-3).
//
// En kritik bekci SG1'dir: UST SERVISTEN yansiyan bir 401 (AWX token'i dustu)
// kullaniciyi portaldan ATMAMALI. Ciplak durum koduna bakan bir kapi tam bunu
// yapardi ve arizayi tek bir kullaniciyla sinirli kalmaktan cikarip herkesi
// disari atmaya cevirirdi.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  sessionGuardKur,
  oturumDurumunuBildir,
  oturumBittiAbone,
  oturumBittiMi,
  _sessionGuardSifirla,
  SESSION_HEADER,
  oturumBasligiAbone,
  kullaniciEtkinligiBildir,
  kullaniciEtkinligiSifirla,
  ETKINLIK_PENCERESI_MS,
  BASLIK_ETKINLIK,
} from '../sessionGuard';
import { safeJson } from '../http';

function yanit(status: number, imzali: boolean): Response {
  const h: Record<string, string> = { 'content-type': 'application/json' };
  if (imzali) h[SESSION_HEADER] = 'expired';
  return new Response(JSON.stringify({ ok: false, error: 'x' }), { status, headers: h });
}

let ag: ReturnType<typeof vi.fn>;

beforeEach(() => {
  _sessionGuardSifirla();
  ag = vi.fn(async () => yanit(200, false));
  window.fetch = ag as unknown as typeof fetch;
  sessionGuardKur();
});

afterEach(() => _sessionGuardSifirla());

describe('sessionGuard', () => {
  it('SG1 — IMZASIZ 401 kapiyi KAPATMAZ (ust servis 401i kullaniciyi atmaz)', async () => {
    oturumDurumunuBildir(true);
    ag.mockResolvedValueOnce(yanit(401, false)); // AWX token'i dustu → route 401 yansitti
    await window.fetch('/api/ansible/awx/recent-jobs');
    expect(oturumBittiMi()).toBe(false);

    // ve sonraki istek AGA CIKMAYA DEVAM EDER
    await window.fetch('/api/ansible/servers');
    expect(ag).toHaveBeenCalledTimes(2);
  });

  it('SG2 — IMZALI 401 + oturum var → kapi kapanir ve abone haber alir', async () => {
    const haber = vi.fn();
    oturumBittiAbone(haber);
    oturumDurumunuBildir(true);
    ag.mockResolvedValueOnce(yanit(401, true));
    await window.fetch('/api/visibility/version');
    expect(oturumBittiMi()).toBe(true);
    expect(haber).toHaveBeenCalledTimes(1);
  });

  it('SG3 — giris ekraninda (oturum YOK) imzali 401 kapiyi kapatmaz', async () => {
    oturumDurumunuBildir(false);
    ag.mockResolvedValueOnce(yanit(401, true)); // acilistaki /api/auth/me — NORMAL
    await window.fetch('/api/auth/me');
    expect(oturumBittiMi()).toBe(false);
  });

  it('SG4 — kapi kapaliyken /api/* istegi AGA HIC CIKMAZ', async () => {
    oturumDurumunuBildir(true);
    ag.mockResolvedValueOnce(yanit(401, true));
    await window.fetch('/api/visibility/version');
    ag.mockClear();

    // Dongu donmeye devam etse bile sunucuya TEK BIR istek gitmez.
    for (let i = 0; i < 25; i++) await window.fetch('/api/ansible/ss/smart-tickets/mine');
    expect(ag).not.toHaveBeenCalled();
  });

  it('SG5 — sentetik yanit GERCEGININ AYNISI: 401 + imza + safeJson uyumlu', async () => {
    oturumDurumunuBildir(true);
    ag.mockResolvedValueOnce(yanit(401, true));
    await window.fetch('/api/visibility/version');

    const r = await window.fetch('/api/auth/prefs');
    expect(r.status).toBe(401);
    expect(r.headers.get(SESSION_HEADER)).toBe('expired');
    // Mevcut hata yollari degismeden calismali.
    const govde = await safeJson(r);
    expect(govde._httpStatus).toBe(401);
    expect(govde.ok).toBe(false);
  });

  it('SG6 — kapi kapaliyken bile GIRIS ucu aga cikar (kilit kendi anahtarini kilitlemesin)', async () => {
    oturumDurumunuBildir(true);
    ag.mockResolvedValueOnce(yanit(401, true));
    await window.fetch('/api/visibility/version');
    ag.mockClear();

    await window.fetch('/api/auth/login', { method: 'POST' });
    expect(ag).toHaveBeenCalledTimes(1);
  });

  it('SG7 — /api/ disi istekler DOKUNULMAZ', async () => {
    oturumDurumunuBildir(true);
    ag.mockResolvedValueOnce(yanit(401, true));
    await window.fetch('/api/visibility/version');
    ag.mockClear();

    await window.fetch('/assets/logo.svg');
    await window.fetch('https://baska-servis.ornek/veri');
    expect(ag).toHaveBeenCalledTimes(2);
  });

  it('SG8 — yeniden giris kapiyi ACAR', async () => {
    oturumDurumunuBildir(true);
    ag.mockResolvedValueOnce(yanit(401, true));
    await window.fetch('/api/visibility/version');
    expect(oturumBittiMi()).toBe(true);

    oturumDurumunuBildir(true); // basarili giris
    expect(oturumBittiMi()).toBe(false);
    ag.mockClear();
    await window.fetch('/api/auth/prefs');
    expect(ag).toHaveBeenCalledTimes(1);
  });

  it('SG9 — AYNI ANDA ucan istekler abonelere TEK haber verir', async () => {
    // Bu, sirali degil ES ZAMANLI durumdur ve dedup'in TEK gercek sinavi: oturum
    // oldugunde ucusta olan istekler kapi kapanmadan BASLAMISTIR, yani hepsi
    // gercek 401i gorur. Sirali bir dongu bunu sinayamaz — ilk istek kapiyi
    // kapatir ve kalanlar aga hic cikmaz.
    const haber = vi.fn();
    oturumBittiAbone(haber);
    oturumDurumunuBildir(true);
    ag.mockResolvedValue(yanit(401, true));
    await Promise.all([
      window.fetch('/api/visibility/version'),
      window.fetch('/api/auth/prefs'),
      window.fetch('/api/ansible/ss/smart-tickets/mine'),
      window.fetch('/api/presence/online'),
    ]);
    expect(ag).toHaveBeenCalledTimes(4); // dordude ucustaydi
    expect(haber).toHaveBeenCalledTimes(1);
  });

  it('SG10 — sessionGuardKur() iki kez cagrilinca sarmal UST USTE BINMEZ', async () => {
    sessionGuardKur();
    sessionGuardKur();
    await window.fetch('/api/auth/prefs');
    expect(ag).toHaveBeenCalledTimes(1);
  });

  it('SG11 — AYNI KOKENLI mutlak URL de kapiya tabidir', async () => {
    oturumDurumunuBildir(true);
    ag.mockResolvedValueOnce(yanit(401, true));
    await window.fetch('/api/visibility/version');
    ag.mockClear();

    await window.fetch(`${window.location.origin}/api/auth/prefs`);
    expect(ag).not.toHaveBeenCalled();
  });

  it('SG12 — eski oturumun gecikmis 401i yeni oturumu KAPATMAZ', async () => {
    const haber = vi.fn();
    let eskiYanitiVer!: (response: Response) => void;
    const eskiYanit = new Promise<Response>((resolve) => {
      eskiYanitiVer = resolve;
    });

    oturumBittiAbone(haber);
    oturumDurumunuBildir(true); // oturum A
    ag.mockReturnValueOnce(eskiYanit);
    const eskiIstek = window.fetch('/api/visibility/version');

    oturumDurumunuBildir(false); // A'dan cikis
    oturumDurumunuBildir(true); // oturum B
    eskiYanitiVer(yanit(401, true));
    await eskiIstek;

    expect(oturumBittiMi()).toBe(false);
    expect(haber).not.toHaveBeenCalled();
    await window.fetch('/api/auth/prefs');
    expect(ag).toHaveBeenCalledTimes(2);
  });

  it('SG13 — her yanittaki bitis basliklari oturum saatine iletilir; bozuk deger iletilmez', async () => {
    const dinle = vi.fn();
    oturumBasligiAbone(dinle);
    ag.mockResolvedValueOnce(
      new Response('{}', {
        status: 200,
        headers: { 'X-Portal-Session-Expires': '1000', 'X-Portal-Session-Absolute': '2000' },
      }),
    );
    await window.fetch('/api/herhangi');
    expect(dinle).toHaveBeenCalledWith({ idleExpiresAt: 1000, absoluteExpiresAt: 2000 });
    ag.mockResolvedValueOnce(
      new Response('{}', { status: 200, headers: { 'X-Portal-Session-Expires': 'abc' } }),
    );
    await window.fetch('/api/herhangi');
    expect(dinle).toHaveBeenCalledTimes(1);
  });

  it('SG14 — kapanis sebebi (idle/absolute) aboneye iletilir; bilinmeyen deger iletilmez', async () => {
    const haber = vi.fn();
    oturumBittiAbone(haber);
    oturumDurumunuBildir(true);
    ag.mockResolvedValueOnce(
      new Response('{}', {
        status: 401,
        headers: { [SESSION_HEADER]: 'expired', 'X-Portal-Session-Reason': 'absolute' },
      }),
    );
    await window.fetch('/api/x');
    expect(haber).toHaveBeenCalledWith('absolute');
    oturumDurumunuBildir(true);
    ag.mockResolvedValueOnce(
      new Response('{}', {
        status: 401,
        headers: { [SESSION_HEADER]: 'expired', 'X-Portal-Session-Reason': '<script>' },
      }),
    );
    await window.fetch('/api/x');
    expect(haber).toHaveBeenLastCalledWith(undefined);
  });

  // ── Arka plan isareti (2026-10-03) ────────────────────────────────────────
  // Sunucu varsayilan olarak her istegi etkinlik sayar. Listede olmayan tek bir
  // yoklama acik sekmede oturumu sonsuza dek acik tutuyordu; karar artik burada.
  const isaret = (cagri: unknown[]) => new Headers((cagri[1] as RequestInit | undefined)?.headers).get(BASLIK_ETKINLIK);

  it('SG15 — girdi tazeyken istek AYNEN gecer; bayatken arka plan isaretlenir', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(1_000_000);
      kullaniciEtkinligiBildir();
      await window.fetch('/api/x', { headers: { 'content-type': 'application/json' } });
      expect(ag.mock.calls[0][1]).toEqual({ headers: { 'content-type': 'application/json' } });
      await window.fetch('/api/x');
      expect(ag.mock.calls[1][1]).toBeUndefined();

      // Sinirin tam ustunde hala taze; 1 ms sonra bayat.
      vi.setSystemTime(1_000_000 + ETKINLIK_PENCERESI_MS);
      await window.fetch('/api/x');
      expect(isaret(ag.mock.calls[2])).toBeNull();
      vi.setSystemTime(1_000_000 + ETKINLIK_PENCERESI_MS + 1);
      await window.fetch('/api/yoklama', { method: 'GET', headers: { 'x-ozel': '1' } });
      expect(isaret(ag.mock.calls[3])).toBe('background');
      const h = new Headers((ag.mock.calls[3][1] as RequestInit).headers);
      expect(h.get('x-ozel')).toBe('1');
      expect((ag.mock.calls[3][1] as RequestInit).method).toBe('GET');

      // Yeni girdi: yeniden isaretsiz.
      kullaniciEtkinligiBildir();
      await window.fetch('/api/x');
      expect(ag.mock.calls[4][1]).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it('SG16 — uyari acilinca (sifirla) otomatik istekler HEMEN arka plan; cagiranin acik isareti ezilmez', async () => {
    kullaniciEtkinligiBildir();
    kullaniciEtkinligiSifirla();
    await window.fetch('/api/yoklama');
    expect(isaret(ag.mock.calls[0])).toBe('background');
    await window.fetch('/api/auth/session/extend', { method: 'POST', headers: { [BASLIK_ETKINLIK]: 'user' } });
    expect(isaret(ag.mock.calls[1])).toBe('user');
    // `/api` disi isteklere baslik EKLENMEZ (dis servise ozel baslik = CORS on-ucusu).
    await window.fetch('/assets/x.js');
    expect(ag.mock.calls[2][1]).toBeUndefined();
    // Request nesnesiyle gelen basliklar korunur.
    await window.fetch(new Request('http://localhost:3000/api/x', { headers: { 'x-ozel': '2' } }));
    const h = new Headers((ag.mock.calls[3][1] as RequestInit).headers);
    expect(h.get('x-ozel')).toBe('2');
    expect(h.get(BASLIK_ETKINLIK)).toBe('background');
  });

  it('SG17 — kapi kapaliyken giris ekrani ayari (session-policy) AGA CIKAR', async () => {
    oturumDurumunuBildir(true);
    ag.mockResolvedValueOnce(yanit(401, true));
    await window.fetch('/api/herhangi');
    expect(oturumBittiMi()).toBe(true);
    oturumDurumunuBildir(false); // kullanici katmandan "Cikis yap" dedi
    const once = ag.mock.calls.length;
    await window.fetch('/api/auth/session-policy');
    expect(ag.mock.calls.length).toBe(once + 1);
    await window.fetch('/api/baska');
    expect(ag.mock.calls.length).toBe(once + 1);
  });
});
