// src/components/__tests__/NavHafiza.test.tsx — sol menu bolum hafizasi (2026-11-08).
//
// Eskiden daraltilan bolumler her yenilemede yeniden aciliyordu ve uzun menunun altindaki
// sayfada (ScaleX, Telnet) etkin oge ekran disinda kaliyordu.
//   NH1 daraltilan bolum yenilemeden sonra da kapali
//   NH2 etkin sayfanin bolumu kayitli daraltmaya ragmen acik; o sayfadayken kapatilirsa kapanir
//   NH3 bozuk / dizi kayit: hepsi acik, cokme yok
//   NH4 depolama yazilamazsa daraltma yine calisir (yalniz bu oturum)
//   NH5 etkin oge menunun gorunur alaninin disindaysa menu (yalniz menu) kaydirilir
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import PageNav, { NAV_DARALTMA_ANAHTARI } from '@/components/layout/PageNav';
import { AuthContext } from '@/contexts/AuthContext';

vi.mock('@/api/adminApi', () => ({
  visibilityApi: { getNavGroups: vi.fn().mockResolvedValue([]) },
}));

function ciz(yol: string) {
  return render(
    <AuthContext.Provider
      value={
        { canViewPage: () => true, pageVisibilityLoaded: true, user: { role: 'Admin' } } as never
      }
    >
      <MemoryRouter initialEntries={[yol]}>
        <PageNav />
      </MemoryRouter>
    </AuthContext.Provider>,
  );
}

const kayit = () => JSON.parse(window.localStorage.getItem(NAV_DARALTMA_ANAHTARI) || 'null');

describe('sol menu bolum hafizasi', () => {
  beforeEach(() => window.localStorage.clear());
  afterEach(() => {
    vi.restoreAllMocks();
    window.localStorage.clear();
  });

  it('NH1 daraltilan bolum yenilemeden sonra da kapali', () => {
    ciz('/dashboard');
    expect(screen.getByRole('link', { name: 'SPA Raporu' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Nginx ARK SPA' }));
    expect(screen.queryByRole('link', { name: 'SPA Raporu' })).toBeNull();
    expect(kayit()).toEqual({ arkspa: true });

    cleanup();
    ciz('/dashboard');
    expect(screen.queryByRole('link', { name: 'SPA Raporu' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Nginx ARK SPA' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );

    // Yeniden acmak kaydi temizler.
    fireEvent.click(screen.getByRole('button', { name: 'Nginx ARK SPA' }));
    expect(screen.getByRole('link', { name: 'SPA Raporu' })).toBeInTheDocument();
    expect(kayit()).toEqual({});
  });

  it('NH2 etkin bolum kayitli daraltmaya ragmen acik; bu sayfadayken kapatilirsa kapanir', () => {
    // Denetim 2026-11-08'den beri BMW Hub grubunda (eskiden ayri 'Envanter' grubu).
    window.localStorage.setItem(NAV_DARALTMA_ANAHTARI, JSON.stringify({ bmwhub: true }));
    ciz('/denetim');
    expect(screen.getByRole('link', { name: 'Denetim' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'BMW Hub' }));
    expect(screen.queryByRole('link', { name: 'Denetim' })).toBeNull();
    expect(kayit()).toEqual({ bmwhub: true });

    // Baska bir sayfada (bolum etkin degil) kayit gecerli: kapali.
    cleanup();
    ciz('/dashboard');
    expect(screen.queryByRole('link', { name: 'Denetim' })).toBeNull();
  });

  it('NH3 bozuk ya da dizi kayit: hepsi acik, cokme yok', () => {
    for (const bozuk of ['{bozuk', '[1,2]', 'null', '"x"']) {
      window.localStorage.setItem(NAV_DARALTMA_ANAHTARI, bozuk);
      ciz('/dashboard');
      expect(screen.getByRole('link', { name: 'SPA Raporu' })).toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'Denetim' })).toBeInTheDocument();
      cleanup();
    }
  });

  it('NH4 depolama yazilamazsa daraltma yine calisir', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    ciz('/dashboard');
    fireEvent.click(screen.getByRole('button', { name: 'Nginx ARK SPA' }));
    expect(screen.queryByRole('link', { name: 'SPA Raporu' })).toBeNull();
  });

  it('NH5 etkin oge gorunur alanin altindaysa menu kaydirilir', () => {
    const kutu = (top: number, bottom: number) => ({ top, bottom }) as DOMRect;
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: Element,
    ) {
      if (this.classList.contains('pf-nav')) return kutu(0, 300);
      if (this.classList.contains('is-current')) return kutu(500, 520);
      return kutu(0, 0);
    });
    const { container } = ciz('/scalex');
    const nav = container.querySelector('nav.pf-nav') as HTMLElement;
    // 520 - 300 + 8 px pay
    expect(nav.scrollTop).toBe(228);
  });
});
