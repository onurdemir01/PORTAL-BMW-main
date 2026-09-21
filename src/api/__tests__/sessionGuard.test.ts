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
});
