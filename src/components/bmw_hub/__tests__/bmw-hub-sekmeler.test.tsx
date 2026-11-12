// BMW Hub sekmeleri (2026-11-11): Reboot Kontrolü ve Retirement Server Hub'dan BMW Hub'a taşındı.
//   BS1 varsayılan sekme Açık İşler; ?sekme=reboot / ?sekme=retirement doğrudan açar (derin link)
//   BS2 sekme tıklanınca URL değişir; ziyaret edilen sekme sökülmez, gizlenir
//   BS3 Server Hub'dan gelen retirement önerisi (location.state) kayıt formuna bir kez iletilir
//   BS4 Server Hub'da bu iki sekme yok; "Retirement kaydı aç" BMW Hub'a yönlendirir
import React from 'react';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';

const oneriler: unknown[] = [];
vi.mock('@/components/server_hub/RebootKontroluTab', () => ({ default: () => <div>REBOOT_GOVDE</div> }));
vi.mock('@/components/server_hub/RetirementTab', () => ({
  default: ({ oneri }: { oneri: { uygulama: string; not: string; no: number } | null }) => {
    oneriler.push(oneri);
    return <div>RETIREMENT_GOVDE {oneri ? `${oneri.uygulama}#${oneri.no}` : 'yok'}</div>;
  },
}));
vi.mock('@/api/bmwHubApi', () => ({
  bmwHubApi: {
    liste: vi.fn(async () => ({
      isler: [],
      ozet: { acik: 0, gecikmis: 0, buHafta: 0, sahipsiz: 0, tamamlanan30: 0 },
      bugun: '2026-11-11',
      tavan: null,
    })),
  },
}));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { username: 'admin', displayName: 'Admin' } }) }));
vi.mock('@/hooks/useToast', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));

import BmwHubPage from '@/components/bmw_hub/BmwHubPage';

function Konum() {
  const l = useLocation();
  return <div data-testid="konum">{l.search}|{l.state ? 'state' : 'bos'}</div>;
}

function kur(giris: string | { pathname: string; search?: string; state?: unknown }) {
  return render(
    <MemoryRouter initialEntries={[giris]}>
      <Routes>
        <Route
          path="/bmw-hub"
          element={
            <>
              <BmwHubPage />
              <Konum />
            </>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  oneriler.length = 0;
});

describe('BMW Hub sekmeleri', () => {
  it('BS1 varsayılan Açık İşler; ?sekme= doğrudan açar', async () => {
    kur('/bmw-hub');
    expect(screen.getByRole('tab', { name: 'Açık İşler' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.queryByText('REBOOT_GOVDE')).toBeNull();
    expect(await screen.findByText('Yeni iş')).toBeInTheDocument();
  });

  it('BS1b ?sekme=reboot yalnız Reboot Kontrolü\'nü kurar', () => {
    kur('/bmw-hub?sekme=reboot');
    expect(screen.getByRole('tab', { name: 'Reboot Kontrolü' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('REBOOT_GOVDE')).toBeVisible();
    expect(screen.queryByText('Yeni iş')).toBeNull();
  });

  it('BS2 sekme URL\'e yazılır; ziyaret edilen sekme gizlenir, sökülmez', () => {
    kur('/bmw-hub');
    fireEvent.click(screen.getByRole('tab', { name: 'Reboot Kontrolü' }));
    expect(screen.getByTestId('konum').textContent).toContain('?sekme=reboot');
    expect(screen.getByText('REBOOT_GOVDE')).toBeVisible();
    fireEvent.click(screen.getByRole('tab', { name: 'Retirement' }));
    expect(screen.getByTestId('konum').textContent).toContain('?sekme=retirement');
    expect(screen.getByText('REBOOT_GOVDE')).not.toBeVisible();
    expect(screen.getByText(/RETIREMENT_GOVDE/)).toBeVisible();
    fireEvent.click(screen.getByRole('tab', { name: 'Açık İşler' }));
    expect(screen.getByTestId('konum').textContent?.startsWith('|')).toBe(true);
    expect(screen.getByText('Yeni iş')).toBeVisible();
  });

  it('BS3 Server Hub önerisi forma bir kez gider, state temizlenir', async () => {
    kur({ pathname: '/bmw-hub', search: '?sekme=retirement', state: { retireOneri: { uygulama: 'APP1', not: 'etiket' } } });
    expect(await screen.findByText('RETIREMENT_GOVDE APP1#1')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('konum').textContent).toBe('?sekme=retirement|bos'));
    expect(screen.getByText('RETIREMENT_GOVDE APP1#1')).toBeInTheDocument();
    const dolu = oneriler.filter(Boolean) as { no: number }[];
    expect(new Set(dolu.map((o) => o.no))).toEqual(new Set([1]));
  });
});

describe('BS4 Server Hub kaynak kapıları', () => {
  const sh = fs.readFileSync(path.join(__dirname, '..', '..', 'server_hub', 'ServerHubPage.tsx'), 'utf8');
  it('Reboot Kontrolü / Retirement sekmesi Server Hub\'da yok', () => {
    expect(sh).not.toMatch(/<RebootKontroluTab\b/);
    expect(sh).not.toMatch(/<RetirementTab\b/);
    expect(sh).not.toMatch(/id: 'reboot'|id: 'retirement'/);
  });
  it('retirementAc BMW Hub\'ın retirement sekmesine state ile yönlendirir', () => {
    expect(sh).toMatch(
      /navigate\('\/bmw-hub\?sekme=retirement', \{ state: \{ retireOneri: \{ uygulama, not \} \} \}\)/,
    );
  });
});
