// src/components/server_hub/__tests__/tekrar-rozeti.test.tsx — vhost tekrar eden istek rozeti (2026-11-18).
//   TR1 durum: yalnız tekrar / kısmen / yok; ölçülemedi (null, -1) ve trafiksiz vhost rozet üretmez
//   TR2 ekran: tespit edilen health check URI'si ve başlıkta istek / istemci sayıları
import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { render } from '@/test/test-utils';
import { TekrarRozeti, tekrarDurumu } from '@/components/server_hub/TekrarRozeti';

const uri = { metot: 'GET', yol: '/app/status', istek: 1008, istemci: 2 };

describe('Server Hub — tekrar eden istek rozeti', () => {
  it('TR1 durum', () => {
    expect(tekrarDurumu({ req7d: 2016, repeat7d: 2016, repeatUris: [uri] })).toBe('YALNIZ');
    expect(tekrarDurumu({ req7d: 2020, repeat7d: 2016, repeatUris: [uri] })).toBe('KISMEN');
    expect(tekrarDurumu({ req7d: 2020, repeat7d: 0, repeatUris: [] })).toBeNull();
    expect(tekrarDurumu({ req7d: 2020, repeat7d: -1 })).toBeNull();
    expect(tekrarDurumu({ req7d: 2020, repeat7d: null })).toBeNull();
    expect(tekrarDurumu({ req7d: 0, repeat7d: 0 })).toBeNull();
  });

  it('TR2 ekran: URI ve başlık', () => {
    const { unmount } = render(
      <TekrarRozeti v={{ req7d: 2016, repeat7d: 2016, repeatUris: [uri] }} />,
    );
    const r = screen.getByTestId('vhost-tekrar');
    expect(r).toHaveTextContent('yalnız tekrar: GET /app/status');
    expect(r.getAttribute('title')).toMatch(/retire adayı olabilir/);
    expect(r.getAttribute('title')).toMatch(/GET \/app\/status \(1008 istek, 2 istemci\)/);
    unmount();
    render(<TekrarRozeti v={{ req7d: 2020, repeat7d: 2016, repeatUris: [uri] }} />);
    expect(screen.getByTestId('vhost-tekrar')).toHaveTextContent('olası HC: GET /app/status');
  });

  it('TR3 rozet yoksa hiçbir şey çizilmez', () => {
    render(<TekrarRozeti v={{ req7d: 5, repeat7d: null }} />);
    expect(screen.queryByTestId('vhost-tekrar')).toBeNull();
  });
});
