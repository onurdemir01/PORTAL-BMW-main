// src/components/filex/__tests__/FileXYoklama.test.tsx
//
// FILEX YOKLAMASI SUNUCU HATASINI GOSTERIR, GECICI HATADA ISI BIRAKMAZ (2026-10-14).
//
// Uretim (13 Ekim): 9 FileX isinin 3'unde sonuc hic gorunmedi. Sunucu "sonuc cok buyuk"
// diyordu ama 502 ile; kurumsal vekil 5xx govdesini degistirdigi icin ekran "Portal yeniden
// baslatiliyor, tekrar deneyin" dedi ve kullanici ayni isi iki kez daha baslatti.
//
// Ayni yoklamada iki kusur daha vardi:
//   - 4xx JSON (403 "size ait degil", yeni 422 "cok buyuk") `safeJson` tarafindan
//     REDDEDILMEZ; `s.finished` bos oldugu icin yoklama sonsuza dek sessizce donuyordu.
//   - Ilk gecici hatada (portal yeniden baslarken) yoklama duruyordu; is AWX'te surerken
//     kullanici yeniden baslatiyordu.
//
// API TAKLIT EDILMEZ: gercek `filexApi` + `safeJson` calisir, yalnizca `fetch` sahtedir.
// Adim bilesenleri (uygulama/surum/sunucu secimi) bu testin konusu degil, sade dugmelerle
// degistirilir.
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, fireEvent, act } from '@testing-library/react';
import { render } from '@/test/test-utils';

vi.mock('@/components/filex/steps/AppSearchStep', () => ({
  default: ({ onSelect }: { onSelect: (a: string) => void }) => (
    <button onClick={() => onSelect('UYG')}>uygulama-sec</button>
  ),
}));
vi.mock('@/components/filex/steps/JbossVersionStep', () => ({
  default: ({ onSubmit }: { onSubmit: (v: string[]) => void }) => (
    <button onClick={() => onSubmit(['jboss8'])}>surum-sec</button>
  ),
}));
vi.mock('@/components/filex/steps/HostSelectStep', () => ({
  default: ({ onSubmit }: { onSubmit: (h: string[]) => void }) => (
    <button onClick={() => onSubmit(['H1'])}>sunucu-sec</button>
  ),
}));
vi.mock('@/components/filex/steps/FileListResultStep', () => ({
  default: ({ result }: { result: { hosts: { files: unknown[] }[] } }) => (
    <div data-testid="sonuc">{result.hosts[0].files.length} dosya</div>
  ),
}));

import FileXWizardPage from '@/components/filex/FileXWizardPage';

const POLL = 2500;
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const html = (status: number) =>
  new Response('<!doctype html><html><body>vekil</body></html>', {
    status,
    headers: { 'content-type': 'text/html' },
  });

let durumYanitlari: Array<() => Response>;
let durumCagrisi: number;

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: false });
  durumCagrisi = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (String(url).includes('/api/filex/run')) {
        return json(200, { ok: true, jobId: 77, status: 'pending', awxServerId: 2 });
      }
      if (String(url).includes('/api/filex/job-status/2/77')) {
        durumCagrisi += 1;
        const sira = durumYanitlari.length ? durumYanitlari.shift()! : null;
        return sira
          ? sira()
          : json(200, { ok: true, status: 'running', finished: null, failed: false, result: null });
      }
      throw new Error(`beklenmeyen istek: ${url}`);
    }),
  );
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function isiBaslat() {
  render(<FileXWizardPage />);
  fireEvent.click(screen.getByText('uygulama-sec'));
  fireEvent.click(screen.getByText('surum-sec'));
  await act(async () => {
    fireEvent.click(screen.getByText('sunucu-sec'));
  });
  expect(screen.getByText(/taranıyor/)).toBeTruthy();
}

async function turlar(n: number) {
  for (let i = 0; i < n; i++) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL);
    });
  }
}

const bitti = (dosya: number) => () =>
  json(200, {
    ok: true,
    status: 'successful',
    finished: '2026-10-14T10:00:00Z',
    failed: false,
    result: {
      overall_status: 'success',
      hosts: [{ host: 'H1', status: 'ok', ear_dirs: [], files: Array(dosya).fill({}) }],
    },
  });

describe('FileX yoklamasi', () => {
  it('FX1 "sonuc cok buyuk" (422) gorunur ve yoklama DURUR', async () => {
    durumYanitlari = [
      () =>
        json(422, {
          ok: false,
          code: 'filex_result_too_large',
          message:
            'İş bitti (AWX iş #77) ama dosya listesi portalın gösterebileceği boyutu (32 MB) aşıyor.',
        }),
    ];
    await isiBaslat();
    await turlar(1);
    expect(screen.getByText(/AWX iş #77/)).toBeTruthy();
    expect(screen.queryByText(/yeniden başlatılıyor/)).toBeNull();
    const once = durumCagrisi;
    await turlar(4);
    expect(durumCagrisi, 'kalici hatadan sonra yoklama surdu').toBe(once);
  });

  it('FX2 4xx JSON (403) artik sessizce donmuyor: mesaj gorunur, yoklama durur', async () => {
    durumYanitlari = [() => json(403, { ok: false, message: 'Bu iş size ait değil.' })];
    await isiBaslat();
    await turlar(1);
    expect(screen.getByText('Bu iş size ait değil.')).toBeTruthy();
    const once = durumCagrisi;
    await turlar(3);
    expect(durumCagrisi).toBe(once);
  });

  it('FX3 gecici ag gecidi hatalari (portal yeniden baslarken) isi BIRAKMAZ', async () => {
    durumYanitlari = [
      () => html(503),
      () => html(502),
      () => json(500, { ok: false, message: 'AWX gecici' }),
      bitti(3),
    ];
    await isiBaslat();
    await turlar(4);
    expect(screen.getByTestId('sonuc').textContent).toBe('3 dosya');
    expect(screen.queryByText(/yeniden başlatılıyor/)).toBeNull();
    expect(screen.queryByText('AWX gecici')).toBeNull();
  });

  it('FX4 gecici hata SURERSE sonunda durur ve sebebi soyler', async () => {
    durumYanitlari = Array.from({ length: 40 }, () => () => html(502));
    await isiBaslat();
    await turlar(15);
    expect(screen.getByText(/yeniden başlatılıyor/)).toBeTruthy();
    const once = durumCagrisi;
    expect(once).toBeLessThan(15);
    await turlar(3);
    expect(durumCagrisi).toBe(once);
  });

  it('FX5 normal akis degismedi: calisiyor -> bitti -> sonuc', async () => {
    durumYanitlari = [
      () => json(200, { ok: true, status: 'running', finished: null, failed: false, result: null }),
      bitti(2),
    ];
    await isiBaslat();
    await turlar(1);
    expect(screen.getByText(/running/)).toBeTruthy();
    await turlar(1);
    expect(screen.getByTestId('sonuc').textContent).toBe('2 dosya');
  });

  it('FX6 tavan ART ARDA hata sayar: araya giren basarili yanit sayaci sifirlar', async () => {
    // Uzun bir iste ara ara gelen tekil 502'ler birikip isi erken BIRAKTIRMAMALI.
    const calisiyor = () =>
      json(200, { ok: true, status: 'running', finished: null, failed: false, result: null });
    durumYanitlari = [];
    for (let i = 0; i < 14; i++) durumYanitlari.push(() => html(502), calisiyor);
    durumYanitlari.push(bitti(4));
    await isiBaslat();
    await turlar(29);
    expect(screen.queryByText(/yeniden başlatılıyor/)).toBeNull();
    expect(screen.getByTestId('sonuc').textContent).toBe('4 dosya');
  });
});
